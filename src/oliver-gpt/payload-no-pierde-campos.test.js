import test from 'node:test';
import assert from 'node:assert/strict';
import { priceAllEngine } from '../../services/enginePricer.js';

/* =========================================================================
 * 🔴 LA LISTA BLANCA QUE SE COME LOS CAMPOS — TERCERA VEZ EN LA MISMA FUNCION
 *
 * `calcularCotizacion` (src/oliver-gpt/engine-client.js) arma el body HTTP con una lista
 * EXPLICITA de campos. Tres veces alguien agrego un campo en el pricer y olvido agregarlo ahi,
 * y el campo se cayo EN SILENCIO — el pricer lo calculaba bien, lo pasaba bien, y nunca salia:
 *
 *   25-ago  `partes`       -> toda compuesta salia 50/50 aunque el cliente diera los anchos
 *   26-ago  `orientacion`  -> toda compuesta vertical se cotizaba horizontal (propuesta de Paula)
 *   18-sep  `riel`, `activos`, `hojas_fijas`  <- ESTA
 *
 * COSTO MEDIDO DE LA TERCERA: la propuesta CM-FR-004-2026-0483 cobro las dos correderas de 3
 * hojas como si NINGUNA fuera fija. V1 2710x1995 salio $759.729 netos, que es exactamente el
 * precio de 3 hojas doble riel SIN hoja fija ($904.077 con IVA). Con la hoja fija declarada son
 * $896.122. Se cobraron herrajes que la ventana no lleva, y el BOM a fabrica era otro.
 *
 * ESTE TEST NO PRUEBA UN CAMPO: prueba que NINGUNO se caiga. Compara lo que el pricer decidio
 * contra lo que efectivamente salio por HTTP. Si mañana alguien agrega un campo nuevo al pricer
 * y olvida la lista blanca, esto se pone rojo solo.
 * ========================================================================= */

function conMotorStub(fn) {
  const orig = globalThis.fetch;
  const enviados = [];
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('/quotes/calculate')) enviados.push(JSON.parse(opts.body || '{}'));
    return { ok: true, status: 200, async json() {
      return { ok: true, grand_total: 100, total_clp: 100, unit_price: 100,
        producto_label: 'Corredera SLIDING', materiales: { subtotal: 80 } };
    } };
  };
  return Promise.resolve(fn(enviados)).finally(() => { globalThis.fetch = orig; });
}

test('🔴 la corredera de 3 hojas con la central fija viaja COMPLETA hasta el HTTP', async () => {
  await conMotorStub(async (enviados) => {
    await priceAllEngine({
      comuna: 'Vilcun',
      items: [
        // Las dos lineas TEXTUALES de la lista del cliente (17 ventanas, 18-sep). "DOBRE" es su typo.
        { measures: '2710x1995mm', product: 'CORREDERA', qty: 1,
          descripcion: 'CORREDERA DOBRE RIEL TRIPLE HOJA, LA DEL MEDIO FIJA' },
        { measures: '2325x980mm', product: 'CORREDERA', qty: 1,
          descripcion: 'CORREDERA DOBRE RIEL TRIPLE HOJA, LA DEL MEDIO FIJA' },
      ],
    });
    assert.equal(enviados.length, 2, 'las dos tienen que llegar al motor');
    for (const b of enviados) {
      assert.equal(b.tipo, 'CORREDERA', 'tipo');
      assert.equal(b.serie, 'SLIDING', 'serie');
      assert.equal(b.hojas, 3, 'son TRES hojas');
      assert.equal(b.riel, 'DOBLE', 'la central fija va en DOBLE riel (regla del dueño)');
      assert.equal(b.hojas_fijas, 1, '🔴 LA HOJA FIJA: sin esto se cobran herrajes que no van');
      assert.equal(b.activos, 2, 'con la central fija son DOS las que cierran');
    }
  });
});

test('🔒 una corredera comun no inventa riel ni hojas fijas', async () => {
  await conMotorStub(async (enviados) => {
    await priceAllEngine({
      comuna: 'Vilcun',
      items: [{ measures: '1800x1970mm', product: 'CORREDERA', descripcion: 'CORREDERA', qty: 1 }],
    });
    const b = enviados[0];
    assert.equal(b.riel, undefined, 'sin señal del cliente, el motor usa su default');
    assert.equal(b.hojas_fijas, undefined);
    assert.equal(b.activos, undefined);
  });
});

test('🛡️ GUARDIA: ningun campo que el pricer decide puede caerse en la lista blanca', async () => {
  // Es la guardia que faltaba las tres veces. No mira un campo concreto: mira que el contrato
  // completo sobreviva el salto al HTTP.
  const OBLIGATORIOS = ['tipo', 'serie', 'ancho_mm', 'alto_mm', 'glass_id', 'hojas', 'riel', 'hojas_fijas', 'activos'];
  await conMotorStub(async (enviados) => {
    await priceAllEngine({
      comuna: 'Vilcun',
      items: [{ measures: '2710x1995mm', product: 'CORREDERA', qty: 1,
        descripcion: 'CORREDERA DOBRE RIEL TRIPLE HOJA, LA DEL MEDIO FIJA' }],
    });
    const b = enviados[0] || {};
    const faltan = OBLIGATORIOS.filter((k) => b[k] === undefined);
    assert.deepEqual(faltan, [],
      `estos campos NO llegaron al motor y se cayeron en silencio: ${faltan.join(', ')}. `
      + 'Revisá la lista blanca de calcularCotizacion en src/oliver-gpt/engine-client.js.');
  });
});

/* =========================================================================
 * 🔴 Y EL MISMO PATRON, UN SALTO MAS ADELANTE: del item al PDF.
 * El item que se guarda (y del que sale el dibujo) es una version FLACA. No llevaba
 * `corredera`, que es el bloque del motor con el nº de hojas y el riel. MEDIDO con hojasDe():
 *     con `corredera` -> 3 paños   ·   sin `corredera` -> 2 paños
 * Por eso las dos correderas de 3 hojas de la propuesta CM-FR-004-2026-0483 salieron
 * DIBUJADAS CON DOS HOJAS: el texto del label ("Corredera SLIDING H98 Doble Riel S75") no dice
 * cuantas hojas son, asi que el dibujo caia al default de 2.
 * ========================================================================= */

test('🔴 el dibujo saca 3 paños solo si el item lleva `corredera` del motor', async () => {
  const { hojasDe } = await import('../../services/dibujoVentana.js');
  const label = 'Corredera SLIDING H98 Doble Riel S75';
  // Como llega hoy desde el motor (con el bloque): bien.
  assert.equal(hojasDe({ producto_label: label, corredera: { hojas: 3, riel: 'DOBLE' } }), 3);
  // Como se guardaba ANTES (flaco, sin el bloque): dibujaba 2 hojas en una ventana de 3.
  assert.equal(hojasDe({ producto: label }), 2,
    'esto documenta el defecto: sin `corredera`, el label solo no alcanza');
  // Y con el bloque puesto en el item guardado, vuelve a 3.
  assert.equal(hojasDe({ producto: label, corredera: { hojas: 3, riel: 'DOBLE' } }), 3);
});
