// 🛡️ [2026-10-06] LA DECISION, NO LA ETIQUETA: una ventana re-cotizada desde la etiqueta del motor conserva sus
// hojas, su riel y la central fija. Propuesta 0598: corredera 4 hojas cotizada bien, pero el bot re-cotiza por
// ETIQUETA al emitir el PDF y la etiqueta no decia las hojas ⇒ volvio a 2 (~$175.000 de subcobro). El motor ahora
// escribe "4 hojas" / "3 hojas, central fija" (quoteEngine.lineas.test.mjs); ESTE test comprueba que el bot, con
// VARIAS ventanas (el caso real: no lee el texto del cliente), le manda al motor lo mismo que se cotizo.
// Regla del dueño: 2 hojas si el cliente no dice nada; 3 (2 o 3 rieles) y 4 solo si las pide.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ACTIVA_ENGINE_URL = 'http://motor.test';
const enviados = [];
global.fetch = async (url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  if (String(url).includes('/api/quotes/calculate')) enviados.push(body);
  return new Response(JSON.stringify({ ok: true, total_clp: 100000, producto_label: 'x', input: body }),
    { status: 200, headers: { 'content-type': 'application/json' } });
};
const { priceAllEngine } = await import('./enginePricer.js');

test('🛡️ re-cotizar por etiqueta con varias ventanas: 4 hojas, 3 central fija, 3 triple riel y 2 por defecto', async () => {
  const d = {
    items: [
      { product: 'Corredera SLIDING H98 Doble Riel S75 4 hojas', measures: '4000x2000mm', color: 'NOGAL', qty: 1 },
      { product: 'Corredera SLIDING H98 Doble Riel S75 3 hojas, central fija', measures: '2700x2000mm', color: 'NOGAL', qty: 1 },
      { product: 'Corredera SLIDING H98 Triple Riel S75 3 hojas', measures: '2700x2000mm', color: 'NOGAL', qty: 1 },
      { product: 'Corredera SLIDING H98 Doble Riel S75', measures: '2000x2000mm', color: 'NOGAL', qty: 1 },
    ],
    comuna: 'Temuco',
    texto_cliente: 'corredera 4 hojas',   // con varias ventanas NO debe aplicarse a todas
  };
  await priceAllEngine(d);
  const corr = enviados.filter((b) => b.tipo === 'CORREDERA');
  assert.equal(corr.length, 4, `se esperaban 4 correderas al motor, llegaron ${corr.length}: ${JSON.stringify(enviados)}`);
  const [c4, c3f, c3t, c2] = corr;
  assert.equal(c4.hojas, 4);  assert.equal(c4.riel, 'DOBLE');
  assert.equal(c3f.hojas, 3); assert.equal(c3f.riel, 'DOBLE'); assert.equal(c3f.hojas_fijas, 1);
  assert.equal(c3t.hojas, 3); assert.equal(c3t.riel, 'TRIPLE'); assert.ok(!c3t.hojas_fijas);
  assert.ok(c2.hojas === undefined || c2.hojas === 2, `la de 2 hojas por defecto llego con ${c2.hojas}`);
});
