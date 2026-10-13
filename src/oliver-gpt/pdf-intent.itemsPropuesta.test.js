// [#1516 · 13-oct] Guardia de la DECISIÓN del dueño (#798): el número que el CLIENTE le puso a su ventana sale en la
// propuesta. Lo cazó el dueño comparando el borrador de dibujos (V1, V2, V10, V5, V8) con la propuesta 0642-B (V1..V5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { itemsParaPropuestaPdf } from './pdf-intent.js';
import { rotulosDeVentanas } from '../../services/etiquetaVentana.js';

const ITEMS = [
  { producto_label: 'Fijo S60', measures: '2000x800', color: 'NEW BLACK', qty: 1, unit_price: 182000, glass_label: 'Termopanel 4+12+4', pos: 1 },
  { producto_label: 'Fijo S60', measures: '680x2150', color: 'NEW BLACK', qty: 1, unit_price: 171000, pos: 2 },
  { producto_label: 'Ventana compuesta vertical: Proyectante 1300mm (arriba) + Fijo 900mm (abajo)', measures: '1400x2200', color: 'NEW BLACK', qty: 1, unit_price: 489000, pos: 10 },
  { producto_label: 'Fijo S60', measures: '2600x2700', color: 'NEW BLACK', qty: 1, unit_price: 674000, pos: 5 },
  { producto_label: 'Fijo S60', measures: '2100x1800', color: 'NEW BLACK', qty: 1, unit_price: 433000, pos: 8 },
];

test('la propuesta recibe `pos` y los rótulos salen V1, V2, V10, V5, V8 (no V1..V5)', () => {
  const items = itemsParaPropuestaPdf(ITEMS);
  assert.deepEqual(items.map((i) => i.pos), [1, 2, 10, 5, 8]);
  assert.deepEqual(rotulosDeVentanas(items), ['V1', 'V2', 'V10', 'V5', 'V8']);
});

test('sin `pos` (lista sin numerar) se numera por posición, como siempre', () => {
  const items = itemsParaPropuestaPdf(ITEMS.map(({ pos: _p, ...r }) => r));
  assert.ok(items.every((i) => i.pos === undefined));
  assert.deepEqual(rotulosDeVentanas(items), ['V1', 'V2', 'V3', 'V4', 'V5']);
});

test('los demás campos salen EXACTAMENTE como antes del cambio (sin precios inventados)', () => {
  const [a] = itemsParaPropuestaPdf([{ product: 'corredera', measures: '1200x1000', termico: { uw: 2.1 } }]);
  assert.deepEqual(a, {
    product: 'corredera', producto_label: 'corredera', measures: '1200x1000', color: '', qty: 1, unit_price: 0,
    glass_label: a.glass_label, ambiente: '', termico: { uw: 2.1 },
  });
  assert.ok(typeof a.glass_label === 'string' && a.glass_label.length > 0, 'vidrio de respaldo');
  // basura en pos no se copia
  const [b] = itemsParaPropuestaPdf([{ product: 'x', pos: 'trece' }, { product: 'y', pos: -3 }]);
  assert.equal(b.pos, undefined);
  assert.equal(itemsParaPropuestaPdf(null).length, 0);
});
