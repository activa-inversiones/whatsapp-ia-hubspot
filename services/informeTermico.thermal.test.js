// informeTermico.thermal.test.js — [2026-08-24]
//
// Cubre el CONTRATO con ACTIVA THERMAL, que es un proveedor externo: no se toca su codigo,
// se le pide por HTTP y se sigue de largo si no contesta.
// (contrato completo: temp-sales-os/_activa-docs/CONTRATO-OLIVER-THERMAL.md)
//
// Los dos huecos que cierran estos tests salieron de medir la API el 24-ago:
//
//   #383 — LA API KEY NO SE VALIDA. Las rutas que el contrato declara "anillo 1, la key
//          sigue siendo obligatoria" devuelven 200 sin header, y 200 con una key inventada.
//          Eso lo decide el dueño de THERMAL. Lo NUESTRO es que el dia que la validacion
//          se prenda, todo lo que llame sin key pasa a 401 de golpe.
//   #384 — el fallo era SILENCIOSO. `catch { return null }` es la conducta correcta (sin
//          dato verificado no hay informe), pero sin log el sintoma es "el informe dejo de
//          salir" y nadie sabe por que. Es el modo de falla mas caro de diagnosticar: el
//          mismo de `hotLeadNotifier` (0 avisos en meses) y de `costGuard` (3 semanas).
//
// Verificados matando el mutante.

import test from 'node:test';
import assert from 'node:assert/strict';
import { pedirInformeComuna } from './informeTermico.js';

const RESPUESTA_OK = { comuna: 'Temuco', regimen: 'PDA', uw_max: 3.2 };

/** fetch de mentira que anota la llamada y devuelve lo que se le pida. */
function espia({ ok = true, status = 200, json = RESPUESTA_OK } = {}) {
  const llamadas = [];
  const f = async (url, opts) => {
    llamadas.push({ url, opts, headers: opts?.headers || {} });
    return { ok, status, json: async () => json };
  };
  f.llamadas = llamadas;
  return f;
}

function conKey(valor, fn) {
  const previo = process.env.THERMAL_API_KEY;
  if (valor === undefined) delete process.env.THERMAL_API_KEY;
  else process.env.THERMAL_API_KEY = valor;
  try { return fn(); } finally {
    if (previo === undefined) delete process.env.THERMAL_API_KEY;
    else process.env.THERMAL_API_KEY = previo;
  }
}

// ── #383 · la key viaja aunque hoy no se valide ────────────────────────────────────────

test('🔑 manda X-API-Key cuando THERMAL_API_KEY esta puesta', async () => {
  const f = espia();
  await conKey('clave-de-prueba', () => pedirInformeComuna('Temuco', { fetchFn: f, log: () => {} }));
  assert.equal(f.llamadas[0].headers['X-API-Key'], 'clave-de-prueba',
    'sin esto, el dia que THERMAL prenda la validacion el informe se apaga de golpe');
});

test('sin THERMAL_API_KEY NO manda el header vacio (hoy la API no la exige)', async () => {
  const f = espia();
  await conKey(undefined, () => pedirInformeComuna('Temuco', { fetchFn: f, log: () => {} }));
  assert.equal('X-API-Key' in f.llamadas[0].headers, false,
    'un header vacio puede ser peor que ninguno si mañana valida el formato');
});

test('la key NO se filtra a la URL — solo va en el header', async () => {
  const f = espia();
  await conKey('secreto-que-no-debe-estar-en-la-url', () =>
    pedirInformeComuna('Temuco', { fetchFn: f, log: () => {} }));
  assert.doesNotMatch(f.llamadas[0].url, /secreto-que-no-debe-estar-en-la-url/,
    'un secreto en la query string queda en logs y en historiales');
});

// ── #384 · el fallo se dice en voz alta ───────────────────────────────────────────────

test('🔴 un 401 GRITA que la key empezo a validarse — no se confunde con "comuna desconocida"', async () => {
  const dichos = [];
  const r = await pedirInformeComuna('Temuco', {
    fetchFn: espia({ ok: false, status: 401 }), log: (m) => dichos.push(m),
  });
  assert.equal(r, null, 'sin dato verificado no hay informe: eso no cambia');
  assert.equal(dichos.length, 1);
  assert.match(dichos[0], /API KEY/i);
  assert.match(dichos[0], /THERMAL_API_KEY/, 'tiene que decir QUE variable poner');
});

test('un 403 se trata igual que el 401', async () => {
  const dichos = [];
  await pedirInformeComuna('Temuco', { fetchFn: espia({ ok: false, status: 403 }), log: (m) => dichos.push(m) });
  assert.match(dichos[0] || '', /API KEY/i);
});

test('🔇 un 404 NO ensucia el log: comuna fuera del registro es el caso NORMAL', async () => {
  // El cliente escribe "Labranza" (un sector, no una comuna) y THERMAL devuelve 404. Pasa
  // seguido y el llamador ya cae a Temuco como referencia regional. Avisarlo cada vez
  // entrenaria a ignorar el log, que es como se pierden los avisos que si importan.
  const dichos = [];
  const r = await pedirInformeComuna('Labranza', { fetchFn: espia({ ok: false, status: 404 }), log: (m) => dichos.push(m) });
  assert.equal(r, null);
  assert.equal(dichos.length, 0, 'el 404 es esperado, no una anomalia');
});

test('un 500 SI se avisa (no es esperado)', async () => {
  const dichos = [];
  await pedirInformeComuna('Temuco', { fetchFn: espia({ ok: false, status: 500 }), log: (m) => dichos.push(m) });
  assert.equal(dichos.length, 1);
  assert.match(dichos[0], /500/);
});

test('🔴 THERMAL caido se avisa, y aclara que la COTIZACION sigue normal', async () => {
  const dichos = [];
  const r = await pedirInformeComuna('Temuco', {
    fetchFn: async () => { throw new Error('ECONNREFUSED'); }, log: (m) => dichos.push(m),
  });
  assert.equal(r, null);
  assert.match(dichos[0], /ECONNREFUSED/);
  assert.match(dichos[0], /cotizacion sigue normal/i,
    'el precio NUNCA espera al termico: quien lea el log tiene que saber que no se rompio la venta');
});

test('un timeout se nombra como timeout, con su valor', async () => {
  const dichos = [];
  await pedirInformeComuna('Temuco', {
    timeoutMs: 1234,
    fetchFn: async () => { const e = new Error('abortado'); e.name = 'AbortError'; throw e; },
    log: (m) => dichos.push(m),
  });
  assert.match(dichos[0], /timeout de 1234 ms/);
});

test('🔒 el camino feliz NO loguea nada', async () => {
  const dichos = [];
  const r = await pedirInformeComuna('Temuco', { fetchFn: espia(), log: (m) => dichos.push(m) });
  assert.deepEqual(r, RESPUESTA_OK);
  assert.equal(dichos.length, 0);
});
