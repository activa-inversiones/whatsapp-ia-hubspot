// [Tridente r4 #4, 30-sep] Un 200 con {ok:false} de sales-os NO es éxito. escribirDurable y
// leerConEstado tienen que exigir j.ok === true además del 2xx (sales-os responde {ok:false}
// cuando la BD no guardó; un bot viejo lo leía como guardado y perdía la carpeta del cliente).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SALES_OS_URL = 'https://sales-os.test';
process.env.SALES_OS_OPERATOR_TOKEN = 'test-operator-token';
const respuestas = [];
global.fetch = async () => respuestas.shift() || { ok: true, json: async () => ({ ok: false }) };
const ep = await import('./estadoPersistente.js');

test('escribirDurable: 200 {ok:false} = NO guardado', async () => {
  respuestas.push({ ok: true, json: async () => ({ ok: false }) });
  const r = await ep.escribirDurable('k-durable-okfalso', { a: 1 }, 60);
  assert.equal(r.ok, false);
});

test('leerConEstado: 200 {ok:false} = no se pudo leer (no "no existe")', async () => {
  respuestas.push({ ok: true, json: async () => ({ ok: false }) });
  const r = await ep.leerConEstado('k-leer-okfalso');
  assert.equal(r.ok, false);
});

test('leerConEstado: 200 {ok:true, valor:null} = no existe', async () => {
  respuestas.push({ ok: true, json: async () => ({ ok: true, valor: null }) });
  const r = await ep.leerConEstado('k-leer-null');
  assert.deepEqual(r, { ok: true, valor: null });
});
