// estadoPersistente.test.js — [2026-08-08]
// Pregunta del dueño: "¿solucionaste el tema de cuando deployamos algo se pierde
// información?". Estos tests fijan que lo que NO puede perderse, no se pierde.

import test from 'node:test';
import assert from 'node:assert/strict';

// Simula el ciclo real: escribir → morir el proceso → arrancar de nuevo → leer.
// El "Postgres" es un Map que sobrevive al reinicio; la memoria del módulo, no.
function armarBackend() {
  const disco = new Map();
  const fetchFalso = async (url, opts = {}) => {
    const clave = decodeURIComponent(String(url).split('/internal/kv/')[1] || '');
    const metodo = opts.method || 'GET';
    if (metodo === 'GET') return { ok: true, json: async () => ({ ok: true, valor: disco.has(clave) ? disco.get(clave) : null }) };
    if (metodo === 'PUT') { disco.set(clave, JSON.parse(opts.body).valor); return { ok: true, json: async () => ({ ok: true }) }; }
    if (metodo === 'DELETE') { disco.delete(clave); return { ok: true, json: async () => ({ ok: true }) }; }
    return { ok: false, json: async () => ({}) };
  };
  return { disco, fetchFalso };
}

async function cargarModulo(fetchFalso, marca) {
  process.env.SALES_OS_URL = 'http://sales-os.test';
  process.env.SALES_OS_OPERATOR_TOKEN = 'token-de-prueba';
  global.fetch = fetchFalso;
  // Query distinta = instancia nueva del módulo = memoria vacía = "el proceso reinició".
  return import(`./estadoPersistente.js?reinicio=${marca}`);
}

test('lo escrito sobrevive a un reinicio del proceso', async () => {
  const { fetchFalso } = armarBackend();

  const antes = await cargarModulo(fetchFalso, 'a1');
  antes.escribir('consent:56912345678', true, 3600);
  await new Promise((r) => setTimeout(r, 20)); // el PUT es fire-and-forget
  assert.equal(antes.leerLocal('consent:56912345678'), true, 'debe estar en memoria');

  // ── acá "deployamos": módulo nuevo, memoria en cero ──
  const despues = await cargarModulo(fetchFalso, 'a2');
  assert.equal(despues.leerLocal('consent:56912345678'), null, 'la memoria arranca vacía');
  assert.equal(await despues.leer('consent:56912345678'), true, 'pero el dato se recupera de la base');
});

test('lo borrado NO revive tras un reinicio', async () => {
  // Si un cliente escribe y se levanta su marca, un deploy no puede resucitarla y volver
  // a bloquearle el seguimiento para siempre.
  const { fetchFalso } = armarBackend();
  const antes = await cargarModulo(fetchFalso, 'b1');
  antes.escribir('consent:56911111111', true, 3600);
  await new Promise((r) => setTimeout(r, 20));
  antes.borrar('consent:56911111111');
  await new Promise((r) => setTimeout(r, 20));

  const despues = await cargarModulo(fetchFalso, 'b2');
  assert.equal(await despues.leer('consent:56911111111'), null);
});

test('si la plataforma está caída NO rompe: se degrada a memoria sola', async () => {
  // Perder una marca es malo; dejar a un cliente sin respuesta es peor.
  const caido = async () => { throw new Error('sales-os no responde'); };
  const mod = await cargarModulo(caido, 'c1');
  assert.doesNotThrow(() => mod.escribir('x', 1, 60));
  assert.equal(mod.leerLocal('x'), 1, 'la memoria local sigue funcionando');
  assert.equal(await mod.leer('otra-clave'), null, 'y leer algo que no está devuelve null, no lanza');
});

test('sin credenciales queda inerte y no lanza (entorno de test/local)', async () => {
  delete process.env.SALES_OS_URL;
  delete process.env.SALES_OS_OPERATOR_TOKEN;
  const mod = await import('./estadoPersistente.js?sin=creds');
  assert.equal(mod.PERSISTENCIA_ACTIVA, false);
  assert.doesNotThrow(() => mod.escribir('y', 2, 60));
  assert.equal(mod.leerLocal('y'), 2, 'sigue sirviendo como caché en memoria');
});
