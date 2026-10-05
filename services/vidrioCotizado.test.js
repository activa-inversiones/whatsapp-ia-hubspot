// vidrioCotizado.test.js — [2026-10-05] la regla del vidrio, rama por rama.
//
// Decision del 05-oct: el MOTOR es el dueño del vidrio, como ya lo es del precio y del Uw.
// `enginePricer.js` lo elige por area/ambiente (`pickGlassId`) y PISA `item.glass_label`; con
// ESE vidrio cobra y calcula el Uw. Imprimir otro vidrio que el cobrado es imprimir un dato falso.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  motorCotizo, vidrioDelMotor, precioCoincide, elegirVidrio, aplicarVidrio, avisarVidrio, VIDRIO_RESPALDO,
} from './vidrioCotizado.js';

const cotizado = (extra = {}) => ({ unit_price: 130000, confidence: 'high', glass_label: '5+12+5', ...extra });

test('vidrioDelMotor: solo si el motor cotizo de verdad y trae vidrio', () => {
  assert.equal(vidrioDelMotor(cotizado()), '5+12+5');
  // OJO: `enginePricer` escribe `glass_label` ANTES de llamar al motor, asi que una copia cuyo
  // HTTP fallo TRAE vidrio. Por eso se exige la cotizacion completa, no solo el vidrio.
  for (const malo of [null, undefined, cotizado({ unit_price: 0 }), cotizado({ unit_price: undefined }),
    cotizado({ confidence: 'manual' }), cotizado({ confidence: undefined }), cotizado({ glass_label: '  ' })]) {
    assert.equal(vidrioDelMotor(malo), null);
  }
  assert.equal(motorCotizo(cotizado()), true);
  assert.equal(motorCotizo(cotizado({ confidence: 'manual' })), false);
  assert.equal([cotizado(), cotizado()].every(motorCotizo), true, 'sirve directo en .every');
});

test('el motor cotizo ⇒ manda SU vidrio, aunque el item traiga otro', () => {
  // 🔁 DADO VUELTA el 05-oct. La ronda anterior fijaba "un vidrio que el item ya trae NO se
  // pisa". Pero el precio y el Uw que se imprimen son SIEMPRE los del vidrio del motor
  // (enginePricer.js:1279-1281 lo elige por area y pisa item.glass_label): dejar el del LLM es
  // mostrar un vidrio distinto del cobrado. Decision del autor (coordinador), 05-oct.
  for (const delLlm of ['DVH 4/12/4', 'Termopanel DVH', 'Termopanel DVH 5+12+5', undefined, '']) {
    assert.deepEqual(elegirVidrio(delLlm, '5+12+5'), { vidrio: '5+12+5', aviso: null }, `con "${delLlm}"`);
  }
  assert.deepEqual(elegirVidrio('Termopanel DVH', null), { vidrio: 'Termopanel DVH', aviso: null },
    'sin vidrio del motor queda lo que venia');
  assert.equal(VIDRIO_RESPALDO, 'Termopanel DVH');
});

test('precioCoincide: el bloque del Uw solo afirma el vidrio si imprime el precio que el motor calculo', () => {
  assert.equal(precioCoincide(cotizado(), 130000), true);
  assert.equal(precioCoincide(cotizado(), '130000'), true, 'el precio puede venir como texto');
  assert.equal(precioCoincide(cotizado(), 120000), false);
  assert.equal(precioCoincide(cotizado(), undefined), false, 'sin precio impreso no se afirma nada');
  assert.equal(precioCoincide(null, 130000), false);
  // Precio distinto ⇒ el vidrio del motor NO es el cobrado: queda lo que venia, sin aviso.
  assert.deepEqual(elegirVidrio('Termopanel DVH', '5+12+5', { precioCoincide: false }),
    { vidrio: 'Termopanel DVH', aviso: null });
});

test('🔴 [B3] la etiqueta dice satén/baño y el motor no ⇒ NO se reemplaza y queda el aviso', () => {
  // El PDF perdio el ambiente "baño" y la recotizacion eligio claro. El rastro del recinto se
  // conserva y se avisa (vidrio.bano_perdido): el reprecio a claro es un defecto de plata que
  // existia antes y va al tablero. Pase o no el precio.
  for (const opts of [{}, { precioCoincide: false }]) {
    assert.deepEqual(elegirVidrio('4+12+4 satén (baño)', '4+12+4', opts), { vidrio: '4+12+4 satén (baño)', aviso: 'vidrio.bano_perdido' });
    assert.deepEqual(elegirVidrio('Termopanel DVH baño', '5+12+5', opts), { vidrio: 'Termopanel DVH baño', aviso: 'vidrio.bano_perdido' });
  }
  assert.deepEqual(elegirVidrio('Termopanel 4+12+4 Satén', '4+12+4 satén (baño)'),
    { vidrio: '4+12+4 satén (baño)', aviso: null }, 'si el motor TAMBIEN es satén, manda el motor');
});

test('🔴 [B4] la etiqueta reemplazada describia OTRO producto ⇒ se reemplaza igual y queda el aviso', () => {
  for (const otro of ['DVH 4/12/4 low-e', 'Laminado 6+6', 'Control solar 6+12+6', 'Termopanel asimétrico 5+12+4',
    'Monolítico 6 mm', 'Selective Index']) {
    assert.deepEqual(elegirVidrio(otro, '4+12+4'), { vidrio: '4+12+4', aviso: 'vidrio.producto_distinto' }, otro);
  }
  assert.deepEqual(elegirVidrio('Laminado 6+6', '4+12+4', { precioCoincide: false }),
    { vidrio: 'Laminado 6+6', aviso: null }, 'si no se reemplaza, no hay nada que avisar');
});

test('aplicarVidrio: escribe en el item y junta el aviso; avisarVidrio lo loguea una vez con el folio', () => {
  const avisos = [];
  const a = { glass_label: 'Laminado 6+6' };
  const b = { glass_label: '4+12+4 satén (baño)' };
  aplicarVidrio(a, '4+12+4', { avisos });
  aplicarVidrio(b, '4+12+4', { avisos });
  aplicarVidrio(b, '4+12+4', { avisos });          // el bloque del Uw vuelve a pasar: no duplica el log
  const sinTocar = {};
  aplicarVidrio(sinTocar, null, { avisos });
  assert.equal(a.glass_label, '4+12+4');
  assert.equal(b.glass_label, '4+12+4 satén (baño)');
  assert.equal('glass_label' in sinTocar, false);

  const lineas = [];
  avisarVidrio(avisos, 'CM-FR-004-2026-0601', (aviso, texto) => lineas.push(`${aviso} ${texto}`));
  assert.equal(lineas.length, 2, JSON.stringify(lineas));
  assert.match(lineas[0], /^vidrio\.producto_distinto .*CM-FR-004-2026-0601.*Laminado 6\+6.*4\+12\+4/);
  assert.match(lineas[1], /^vidrio\.bano_perdido .*CM-FR-004-2026-0601.*satén/);
});
