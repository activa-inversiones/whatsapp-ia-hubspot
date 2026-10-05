// vidrioCotizado.test.js — [2026-10-05] la regla del vidrio, rama por rama.
//
// Decision del 05-oct: el MOTOR es el dueño del vidrio, como ya lo es del precio y del Uw.
// `enginePricer.js` lo elige por area/ambiente (`pickGlassId`) y PISA `item.glass_label`; con
// ESE vidrio cobra y calcula el Uw. Imprimir otro vidrio que el cobrado es imprimir un dato falso.

import test from 'node:test';
import assert from 'node:assert/strict';
import { motorCotizo, vidrioDelPrecio, aplicarVidrioDelMotor } from './vidrioCotizado.js';

const cotizado = (extra = {}) => ({ unit_price: 130000, confidence: 'high', glass_label: '5+12+5', ...extra });

test('el motor cotizo ⇒ manda SU vidrio, aunque el item traiga otro', () => {
  // 🔁 DADO VUELTA el 05-oct. La ronda anterior fijaba "un vidrio que el item ya trae NO se
  // pisa". Pero el precio y el Uw que se imprimen son SIEMPRE los del vidrio del motor
  // (enginePricer.js:1279-1281 lo elige por area y pisa item.glass_label): dejar el del LLM es
  // mostrar un vidrio distinto del cobrado. Decision del autor (coordinador), 05-oct.
  for (const delLlm of ['DVH 4/12/4', 'Termopanel DVH', 'Termopanel DVH 5+12+5', undefined, '']) {
    const it = { unit_price: 130000, glass_label: delLlm };
    assert.equal(aplicarVidrioDelMotor(it, cotizado()), '5+12+5');
    assert.equal(it.glass_label, '5+12+5', `con "${delLlm}" el documento no imprime el vidrio cobrado`);
  }
});

test('⛔ el motor NO cotizo ⇒ no se inventa: el item queda como venia', () => {
  // OJO: `enginePricer` escribe `glass_label` ANTES de llamar al motor, asi que una copia cuyo
  // HTTP fallo TRAE vidrio. Por eso se exige la cotizacion completa, no solo el vidrio.
  for (const malo of [null, undefined, cotizado({ unit_price: 0 }), cotizado({ unit_price: undefined }),
    cotizado({ confidence: 'manual' }), cotizado({ confidence: undefined })]) {
    const it = { unit_price: 130000, glass_label: 'Termopanel DVH' };
    assert.equal(aplicarVidrioDelMotor(it, malo), null);
    assert.equal(it.glass_label, 'Termopanel DVH');
  }
  assert.equal(motorCotizo(cotizado()), true);
  assert.equal(motorCotizo(cotizado({ confidence: 'manual' })), false);
});

test('el motor cotizo pero SIN vidrio ⇒ no toca nada', () => {
  const it = { unit_price: 130000 };
  assert.equal(aplicarVidrioDelMotor(it, cotizado({ glass_label: '  ' })), null);
  assert.equal('glass_label' in it, false);
});

test('🔴 [BAJO-1] el precio impreso NO es el que el motor calculo ⇒ su vidrio no es el cobrado: no se pisa', () => {
  // El PDF perdio el ambiente "baño": el precio impreso es el del satén (lo cotizo
  // calcular_cotizacion con el ambiente), pero la recotizacion del PDF, sin ambiente, eligio
  // claro. Satén y claro tienen precios distintos (glass_catalog: 50.000 vs 42.679 $/m²), asi
  // que la diferencia de precio DELATA que ese vidrio no es el cobrado. Aplicar la regla a
  // ciegas imprimiria "4+12+4" claro sobre un precio satén — o "5+12+5" si pasa los 2 m², y el
  // informe de vientos calcularia con un vidrio 1 mm mas grueso que el real.
  const it = { unit_price: 120000, glass_label: '4+12+4 satén (baño)' };
  assert.equal(aplicarVidrioDelMotor(it, cotizado({ unit_price: 100000, glass_label: '4+12+4' })), null);
  assert.equal(it.glass_label, '4+12+4 satén (baño)');
  // Sin precio impreso tampoco se puede afirmar nada.
  assert.equal(vidrioDelPrecio(cotizado(), undefined), null);
});

test('B y C: el precio ES el del motor ⇒ su vidrio, siempre', () => {
  const p = cotizado({ unit_price: 685330 });
  assert.equal(vidrioDelPrecio(p, p.unit_price), '5+12+5');
  assert.equal(vidrioDelPrecio(p, '685330'), '5+12+5', 'el precio puede venir como texto');
});
