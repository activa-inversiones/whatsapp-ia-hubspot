// 🛡️ [2026-10-06] Caso real del dueño (conversacion 56931862981, 11:20 y 11:29): el comando CLIENTE en la
// primera linea y las ventanas debajo ⇒ el bot contestaba «⚠️ no_es_comando», crudo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseComandoCliente, pareceComando, primeraLinea, traeMasLineas } from './comandoCliente.js';

test('🛡️ CLIENTE con las ventanas en las lineas de abajo: el comando se lee de la primera linea', () => {
  const t = 'CLIENTE Alex Clark +56 9 7459 6798\nPuerta corredera PVC color nogal 2x2\nventana fija 2x2';
  assert.deepEqual(parseComandoCliente(t), { ok: true, phone: '56974596798', name: 'Alex Clark' });
  assert.equal(pareceComando(t), true);
  assert.equal(traeMasLineas(t), true);
  assert.equal(traeMasLineas('CLIENTE Alex Clark +56974596798'), false);
  assert.equal(primeraLinea('\n  CLIENTE OFF \nalgo'), 'CLIENTE OFF');
});

test('🛡️ "Cliente me pidio otra medida" con un telefono en OTRA linea no es comando', () => {
  assert.equal(pareceComando('Cliente me pidió otra medida\n+56 9 7459 6798'), false);
});

test('🛡️ el error interno no_es_comando nunca se le muestra crudo al vendedor', async () => {
  const { procesarComandoCliente } = await import('./comandoCliente.js');
  const msg = await procesarComandoCliente({ waId: '56931862981', texto: 'hola', autorizar: () => true });
  assert.doesNotMatch(msg, /no_es_comando/);
  assert.match(msg, /primera línea/);
});
