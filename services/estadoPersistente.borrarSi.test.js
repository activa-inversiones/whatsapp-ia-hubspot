// services/estadoPersistente.borrarSi.test.js — [2026-10-22]
// `borrarSi` compara y borra en UN paso (Codex, compuerta del candado Uw del piloto #1581).
// Sin red: con la persistencia apagada, la memoria es la fuente.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { borrarSi, escribir, leerLocal, _reset } from './estadoPersistente.js';

beforeEach(() => _reset());
const K = 'docs_entregado:uw_linea:V2N:940415964';
const deA = (v) => v?.msgId === 'wamid.A';

test('mismo msgId ⇒ borra', async () => {
  escribir(K, { msgId: 'wamid.A' });
  assert.deepEqual(await borrarSi(K, deA), { borrado: true });
  assert.equal(leerLocal(K), null);
});

test('otro msgId ⇒ no borra', async () => {
  escribir(K, { msgId: 'wamid.B' });
  assert.equal((await borrarSi(K, deA)).motivo, 'no_coincide');
  assert.equal(leerLocal(K).msgId, 'wamid.B');
});

test('sin candado ⇒ no borra ni falla', async () => {
  assert.equal((await borrarSi(K, deA)).motivo, 'no_existe');
});

test('candado sin msgId ⇒ no borra (no se puede probar que sea de ese envío)', async () => {
  escribir(K, { at: 1, dudoso: true });
  assert.equal((await borrarSi(K, deA)).borrado, false);
  assert.ok(leerLocal(K));
});

test('la condición que lanza ⇒ no borra', async () => {
  escribir(K, { msgId: 'wamid.A' });
  assert.equal((await borrarSi(K, () => { throw new Error('x'); })).borrado, false);
  assert.ok(leerLocal(K));
});

test('🔴 INTERCALACIÓN: el reenvío escribe B mientras el borrado de A espera ⇒ B sobrevive', async () => {
  escribir(K, { msgId: 'wamid.A' });
  const pendiente = borrarSi(K, deA);       // arranca y cede en el await de la lectura
  escribir(K, { msgId: 'wamid.B' });         // el reenvío reescribe el candado en el medio
  const r = await pendiente;
  assert.equal(r.borrado, false, 'compara contra lo vigente AL BORRAR, no contra lo leído antes');
  assert.equal(leerLocal(K).msgId, 'wamid.B');
});
