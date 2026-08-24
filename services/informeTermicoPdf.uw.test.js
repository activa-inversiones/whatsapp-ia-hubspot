// informeTermicoPdf.uw.test.js — [2026-08-24]
//
// EL DEFECTO, cazado por el dueño mirando un informe recién generado: el recuadro azul
// "LA VENTANA DE SU COTIZACIÓN" decía **«Uw calculado 0,00 W/m²K · CUMPLE»**. Un documento
// firmado por un Evaluador Energético acreditado MINVU declarando que una ventana cumple
// la norma con una transmitancia de cero.
//
// LA RAÍZ: `const num = (v) => Number.isFinite(Number(v)) ? Number(v) : null`. Pero
// `Number(null) === 0` y `Number('') === 0`, y `0` ES finito — así que la ausencia del dato
// entraba al PDF disfrazada de medición. El guard `if (uwCliente !== null)` estaba bien
// escrito; nunca se activaba, porque el valor ya no era null.
//
// EL SEGUNDO CAMINO, que no estaba a la vista: en toda comuna SIN Plan de Descontaminación
// la API de THERMAL devuelve `uw_max_Wm2K: null`, porque ahí la norma NO fija tope de Uw
// por elemento (verificado contra la API el 24-ago: Vilcún, `regimen: "sin_PDA"`). Ese null
// se volvía 0 y el informe acusaba «exigencia 0,00 W/m²K · NO CUMPLE». Le habríamos dicho a
// un cliente de Vilcún que su ventana incumple, contra un tope que no existe.
//
// Los dos son la misma confusión: AUSENCIA DE DATO tratada como VALOR CERO.
//
// POR QUÉ SE PRUEBA LA FUNCIÓN Y NO EL PDF: pdfkit escribe el texto como glifos hex de una
// fuente embebida con subsetting, así que leer «CUMPLE» del PDF exigiría resolver el CMap
// —un parser de PDF dentro de un test—. Por eso la decisión se extrajo a `veredictoUw()`,
// pura y exportada: lo que puede firmar un CUMPLE falso no puede ser intestable. El PDF
// queda cubierto por un humo que comprueba que se sigue emitiendo.
//
// Verificado matando el mutante (revirtiendo `num()` a la versión vieja): con la versión
// vieja caen los 5 primeros casos.

import test from 'node:test';
import assert from 'node:assert/strict';
import { veredictoUw, generarInformeTermicoPdf } from './informeTermicoPdf.js';

// ── El defecto que vio el dueño ──────────────────────────────────────────────────────

test('🔴 [P0] sin Uw del cliente NO se declara nada: ni 0,00 ni CUMPLE', () => {
  for (const ausente of [null, undefined, '']) {
    const v = veredictoUw(ausente, 3.2);
    assert.equal(v.uwCliente, null, `${JSON.stringify(ausente)} no es una medición`);
    assert.equal(v.cumple, null, 'sin dato no hay veredicto');
  }
});

test('🔴 [P0] comuna SIN PDA: no se inventa una exigencia, ni se acusa de incumplir', () => {
  // Vilcún, payload real: `uw_max_Wm2K: null`. La norma no fija tope por elemento.
  const v = veredictoUw(2.61, null);
  assert.equal(v.exigencia, null, 'no hay tope que declarar');
  assert.equal(v.cumple, null, 'sin tope legal no hay incumplimiento posible');
  assert.equal(v.uwCliente, 2.61, 'el Uw de su ventana sí se conoce y se conserva');
});

test('🔒 un Uw físicamente imposible se calla', () => {
  // Nada real baja de ~0,5 W/m²K. Bajo ese piso es dato corrupto — y siempre «CUMPLE»,
  // que es justo el error caro: un falso cumplimiento en un documento firmado.
  for (const imposible of [0, 0.02, -1]) {
    const v = veredictoUw(imposible, 3.2);
    assert.equal(v.uwCliente, null, `${imposible} no es una ventana`);
    assert.equal(v.cumple, null, 'y no puede arrastrar un CUMPLE consigo');
  }
});

test('un texto que no es número tampoco pasa', () => {
  const v = veredictoUw('sin dato', 3.2);
  assert.equal(v.uwCliente, null);
  assert.equal(v.cumple, null);
});

// ── La contracara: el fix no puede haber apagado el caso que sí funciona ─────────────

test('con Uw real y comuna con PDA, el veredicto SÍ sale', () => {
  const v = veredictoUw(2.61, 3.2);
  assert.deepEqual(v, { uwCliente: 2.61, exigencia: 3.2, cumple: true });
});

test('con Uw que no cumple, lo dice', () => {
  assert.equal(veredictoUw(3.9, 3.2).cumple, false, '3,9 > 3,2 y el informe no lo puede tapar');
});

test('el borde exacto cumple', () => {
  assert.equal(veredictoUw(3.2, 3.2).cumple, true, 'la norma dice «máximo», no «menor que»');
});

test('un Uw que llega como string numérico se acepta', () => {
  // La BD devuelve `numeric` como string: si esto se rompiera, se apagaría el veredicto
  // de todos los informes sin que nadie lo note.
  assert.deepEqual(veredictoUw('2.61', '3.2'), { uwCliente: 2.61, exigencia: 3.2, cumple: true });
});

// ── Humo: el informe se sigue emitiendo ──────────────────────────────────────────────

test('el PDF se emite igual sin el Uw del cliente', async () => {
  const pdf = await generarInformeTermicoPdf(
    { comuna: 'Temuco', regimen: 'PDA', uw_max_Wm2K: 3.2, zona_termica_NCh1079: 'F' },
    { suProducto: 'Ventana Proyectante PVC' },
  );
  assert.ok(pdf && pdf.length > 0, 'callar un dato no puede costar el informe entero');
});
