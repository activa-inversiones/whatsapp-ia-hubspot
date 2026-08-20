import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  reportarCosto, normalizarUso, estadoReporteCosto, _resetReporteCosto,
} from './reporteCosto.js';

beforeEach(() => _resetReporteCosto());

const cfgOk = (capt) => ({
  url: 'https://ops.activalabs.ai/', token: 'tok',
  fetchFn: async (u, o) => { capt.url = u; capt.body = JSON.parse(o.body); capt.headers = o.headers; return { ok: true }; },
});

// ── normalizarUso ───────────────────────────────────────────────────────────

test('usage de ANTHROPIC se normaliza tal cual (los 4 contadores son propios)', () => {
  const u = normalizarUso({
    input_tokens: 1200, output_tokens: 300,
    cache_creation_input_tokens: 22000, cache_read_input_tokens: 0,
  });
  assert.deepEqual(u, { input: 1200, output: 300, cacheWrite: 22000, cacheRead: 0, total: 23500 });
});

test('EL CASO QUE ESTABA PERDIDO: usage de OPENAI (el respaldo GPT) tambien se entiende', () => {
  const u = normalizarUso({ prompt_tokens: 25000, completion_tokens: 400 });
  assert.equal(u.input, 25000);
  assert.equal(u.output, 400);
  assert.equal(u.total, 25400);
});

test('OpenAI cuenta los cacheados DENTRO de prompt_tokens: no se cobran dos veces', () => {
  // 25.000 prompt de los cuales 22.000 vinieron del cache => input real = 3.000
  const u = normalizarUso({
    prompt_tokens: 25000, completion_tokens: 400,
    prompt_tokens_details: { cached_tokens: 22000 },
  });
  assert.equal(u.input, 3000, 'los cacheados no pueden contarse como input nuevo');
  assert.equal(u.cacheRead, 22000);
  assert.equal(u.total, 25400, 'el total debe seguir siendo el que cobra OpenAI');
});

test('usage vacio, nulo o en cero devuelve null (no ensucia la tabla)', () => {
  for (const u of [null, undefined, {}, { input_tokens: 0, output_tokens: 0 }, 'texto', 7]) {
    assert.equal(normalizarUso(u), null, `${JSON.stringify(u)} deberia dar null`);
  }
});

test('valores basura o negativos se aplanan a 0, no revientan', () => {
  const u = normalizarUso({ input_tokens: -5, output_tokens: 'abc', cache_read_input_tokens: 10 });
  assert.deepEqual(u, { input: 0, output: 0, cacheWrite: 0, cacheRead: 10, total: 10 });
});

// ── reportarCosto ───────────────────────────────────────────────────────────

test('envia al endpoint correcto, con los dos headers y el payload que el sales-os espera', () => {
  const capt = {};
  const r = reportarCosto(
    { modulo: 'oliver_pass1', modelo: 'claude-sonnet-4-6', cacheTtl: '1h',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 22000 } },
    cfgOk(capt));
  assert.equal(r, 'enviado');
  assert.equal(capt.url, 'https://ops.activalabs.ai/api/ingest/ai-cost', 'la barra final del URL no puede duplicarse');
  assert.equal(capt.headers['x-internal-token'], 'tok');
  assert.equal(capt.headers['x-api-key'], 'tok');
  assert.equal(capt.body.module, 'oliver_pass1');
  assert.equal(capt.body.model, 'claude-sonnet-4-6');
  assert.equal(capt.body.cache_read_input_tokens, 22000);
  assert.equal(capt.body.cache_ttl, '1h');
});

test('EL SILENCIO QUE COSTO 3 SEMANAS: sin token avisa UNA vez y lo deja contado', () => {
  const avisos = [];
  const cfg = { url: 'https://x', token: '', log: (m) => avisos.push(m) };
  const usage = { input_tokens: 10, output_tokens: 5 };

  for (let i = 0; i < 50; i++) assert.equal(reportarCosto({ modulo: 'oliver_pass1', usage }, cfg), 'sin_configurar');

  assert.equal(avisos.length, 1, 'un solo aviso por proceso, no 50');
  assert.match(avisos[0], /NO se esta registrando/);
  const e = estadoReporteCosto();
  assert.equal(e.sin_configurar, 50, 'el contador si tiene que ver los 50');
  assert.equal(e.disparados, 0);
  assert.equal(e.configurado, false, '/health debe poder decir que esto no esta configurado');
  assert.equal(e.intentos, 50);
});

test('sin URL tambien cuenta como sin_configurar', () => {
  const r = reportarCosto({ modulo: 'x', usage: { input_tokens: 1 } }, { url: '', token: 'tok', log: () => {} });
  assert.equal(r, 'sin_configurar');
});

test('REGLA DURA: si el fetch explota, NO se propaga (la conversacion no se cae)', () => {
  const r = reportarCosto(
    { modulo: 'oliver_pass2', usage: { input_tokens: 10, output_tokens: 5 } },
    { url: 'https://x', token: 'tok', fetchFn: () => { throw new Error('red caida'); } });
  assert.equal(r, 'fallido', 'un fallo se llama fallo, no "no habia nada que reportar"');
  assert.equal(estadoReporteCosto().fallidos, 1);
});

test('REGLA DURA: si el fetch rechaza async, tampoco se propaga', async () => {
  const r = reportarCosto(
    { modulo: 'oliver_pass2', usage: { input_tokens: 10, output_tokens: 5 } },
    { url: 'https://x', token: 'tok', fetchFn: async () => { throw new Error('timeout'); } });
  assert.equal(r, 'enviado', 'dispara y sigue: el resultado no espera a la red');
  await new Promise((r2) => setImmediate(r2));
  assert.equal(estadoReporteCosto().fallidos, 1, 'el fallo queda contado, no tragado');
});

test('un usage vacio no manda nada y no gasta una llamada', () => {
  let llamadas = 0;
  const r = reportarCosto({ modulo: 'x', usage: {} },
    { url: 'https://x', token: 'tok', fetchFn: async () => { llamadas++; return { ok: true }; } });
  assert.equal(r, 'sin_uso');
  assert.equal(llamadas, 0);
});

test('los contadores separan los 4 desenlaces', async () => {
  const usage = { input_tokens: 10, output_tokens: 5 };
  reportarCosto({ modulo: 'a', usage }, { url: 'https://x', token: 't', fetchFn: async () => ({ ok: true }) });
  reportarCosto({ modulo: 'b', usage }, { url: '', token: '', log: () => {} });
  reportarCosto({ modulo: 'c', usage: {} }, { url: 'https://x', token: 't' });
  reportarCosto({ modulo: 'd', usage }, { url: 'https://x', token: 't', fetchFn: () => { throw new Error('x'); } });
  const e = estadoReporteCosto();
  // 'a' (async ok) y 'd' (throw sincronico) son los DOS intentos que llegaron a fetch.
  // 'd' ademas cuenta como fallido: `fallidos` es subconjunto de `disparados`.
  assert.equal(e.disparados, 2);
  assert.equal(e.fallidos, 1);
  assert.equal(e.ok, 1, 'solo una llego de verdad');
  assert.equal(e.sin_configurar, 1);
  assert.equal(e.sin_uso, 1, 'solo el usage vacio');
  assert.equal(e.intentos, 3, 'disparados + sin_configurar; el usage vacio no es un intento');
});

// ── Regresiones de la revisión cruzada (Copilot, 2026-08-20) ────────────────

test('REGRESION Copilot: al arrancar, `configurado` NO puede ser true', () => {
  // Antes: `sin_configurar === 0 || enviados > 0` daba TRUE con todos los contadores en 0,
  // o sea /health decia "configurado" sin haber intentado nada — justo el escenario que
  // este modulo vino a destapar.
  const e = estadoReporteCosto();
  assert.equal(e.intentos, 0);
  assert.equal(e.configurado, null, 'sin intentos la respuesta honesta es "no se sabe", no "si"');
});

test('REGRESION Copilot: configurado pasa a true recien tras un intento con URL+token', () => {
  reportarCosto({ modulo: 'x', usage: { input_tokens: 5 } },
    { url: 'https://x', token: 't', fetchFn: async () => ({ ok: true }) });
  const e = estadoReporteCosto();
  assert.equal(e.configurado, true);
  assert.equal(e.intentos, 1);
});

test('REGRESION Copilot: `fallidos` es SUBCONJUNTO de `disparados`, no otra categoria', async () => {
  reportarCosto({ modulo: 'x', usage: { input_tokens: 5 } },
    { url: 'https://x', token: 't', fetchFn: async () => { throw new Error('502'); } });
  await new Promise((r) => setImmediate(r));
  const e = estadoReporteCosto();
  assert.equal(e.disparados, 1, 'se disparo una');
  assert.equal(e.fallidos, 1, 'y esa misma fallo');
  assert.equal(e.ok, 0, 'ok = disparados - fallidos: ninguna llego');
});

test('REGRESION Copilot 2a pasada: `ok` NUNCA puede ser negativo', () => {
  // Si fetchFn tiraba sincronicamente, el catch sumaba `fallidos` pero `disparados` se
  // sumaba DESPUES del fetch y nunca se ejecutaba => ok = 0 - 1 = -1. Un contador negativo
  // en /health es la senal de salud mintiendo justo cuando algo se rompio.
  reportarCosto({ modulo: 'x', usage: { input_tokens: 5 } },
    { url: 'https://x', token: 't', fetchFn: () => { throw new Error('sync'); } });
  const e = estadoReporteCosto();
  assert.equal(e.disparados, 1, 'el intento existio, aunque haya muerto al instante');
  assert.equal(e.fallidos, 1);
  assert.equal(e.ok, 0, 'ok = disparados - fallidos');
  assert.ok(e.ok >= 0, 'ok jamas puede ser negativo');
});

test('REGRESION: un fallo sincronico no infla `disparados` dos veces', () => {
  reportarCosto({ modulo: 'x', usage: { input_tokens: 5 } },
    { url: 'https://x', token: 't', fetchFn: async () => ({ ok: true }) });
  assert.equal(estadoReporteCosto().disparados, 1, 'una llamada, un disparo');
});
