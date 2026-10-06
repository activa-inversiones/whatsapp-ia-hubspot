// 🛡️ [2026-10-06] Decision del dueño (opcion 2): una propuesta corregida que CAMBIA LAS VENTANAS manda informes nuevos;
// si solo cambia el color, no se repiten. Caso 0597→0598 (V3 de 2 a 4 hojas): el candado de 30 dias no mando nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { huellaDelInforme } from './webhook.js';

const base = { comuna: 'Temuco', producto: 'Corredera SLIDING H98 Doble Riel S75', glassLabel: '5+12+5' };
const v = (extra = {}) => [
  { producto_label: 'Corredera SLIDING H98 Doble Riel S75', measures: '2000x2000', glass_label: '5+12+5', color: 'Nogal', qty: 1 },
  { producto_label: 'Corredera SLIDING H98 Doble Riel S75', measures: '4000x2000', glass_label: '5+12+5', color: 'Nogal', qty: 1, ...extra },
];

test('🛡️ cambia una ventana (2 → 4 hojas) ⇒ otra huella ⇒ informes nuevos', () => {
  assert.notEqual(huellaDelInforme({ ...base, ventanas: v() }),
    huellaDelInforme({ ...base, ventanas: v({ producto_label: 'Corredera SLIDING H98 Doble Riel S75 4 hojas' }) }));
});
test('🛡️ cambia una medida ⇒ otra huella', () => {
  assert.notEqual(huellaDelInforme({ ...base, ventanas: v() }), huellaDelInforme({ ...base, ventanas: v({ measures: '3800x2000' }) }));
});
test('🛡️ cambia SOLO el color ⇒ la misma huella (no se repiten los informes)', () => {
  assert.equal(huellaDelInforme({ ...base, ventanas: v() }), huellaDelInforme({ ...base, ventanas: v({ color: 'Blanco' }) }));
});
test('el orden de las ventanas no cambia la huella; las dos formas de item (propuesta e informe) se aceptan', () => {
  assert.equal(huellaDelInforme({ ...base, ventanas: v() }), huellaDelInforme({ ...base, ventanas: v().reverse() }));
  const comoInforme = [{ producto: 'Fijo S60', medidas: '1000x1000', vidrio: '4+12+4', cantidad: 2 }];
  const comoPropuesta = [{ producto_label: 'Fijo S60', measures: '1000x1000', glass_label: '4+12+4', qty: 2 }];
  assert.equal(huellaDelInforme({ ...base, ventanas: comoInforme }), huellaDelInforme({ ...base, ventanas: comoPropuesta }));
});
test('sin ventanas, la huella es la de siempre (comuna|producto|vidrio)', () => {
  assert.equal(huellaDelInforme(base).split('|').length, 3);
});

test('🛡️ "2000x1400" y "2000x1400mm" son la misma ventana (el formato no reenvia informes)', () => {
  const a = [{ producto_label: 'Fijo S60', measures: '2000x1400', glass_label: '4+12+4', qty: 1 }];
  const b = [{ producto_label: 'Fijo S60', measures: '2000x1400mm', glass_label: '4+12+4', qty: 1 }];
  assert.equal(huellaDelInforme({ ...base, ventanas: a }), huellaDelInforme({ ...base, ventanas: b }));
});
