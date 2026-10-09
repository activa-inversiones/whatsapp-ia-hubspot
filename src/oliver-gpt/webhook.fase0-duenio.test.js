// 🔴 GUARDIA DE UNA DECISIÓN DEL DUEÑO (09-oct-2026, «sí, empieza con la fase 0», tras el tridente del Oliver interno):
// el DUEÑO tampoco cotiza sin cliente fijado. DA VUELTA la regla del 30-sep («el dueño queda afuera: puede cotizar para
// sí»). Motivo medido: 136 de las 190 cotizaciones huérfanas de 2 meses salieron del teléfono del dueño y su cliente real
// aparecía "sin precio". Salida para pruebas del sistema: PRUEBA (2 h, a su nombre, fuera de los KPI).
// Si esto se pone rojo, alguien está deshaciendo esa decisión — no es un test para "arreglar".
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleWebhook, TEXTO_PEDIR_CLIENTE_DUENIO, TEXTO_MODO_PRUEBA } from './webhook.js';
import { fijar, _resetAtribuciones } from '../../services/atribucionStore.js';
import { _resetConsentimiento } from '../../services/consentimiento.js';
import { _reiniciarParaTests, telefonoDuenio } from '../../services/internosEquipo.js';
const resetAtribucion = () => { _resetAtribuciones(); _resetConsentimiento(); };

const DUENIO = telefonoDuenio();
const CLIENTE = '56987654321';
const OTRO = '56933334444';

function makeRes() { return { sendStatus() { return this; } }; }

function makeDeps(from, msgId, quoteEvents, pdfResults, extra = {}) {
  const _kv = new Map();
  const conversaciones = extra.conversaciones || [];
  const textos = extra.textos || [];
  return {
    conv: new Map(), seen: new Set(), locks: new Map(),
    // Carpetas aisladas por test: sin esto viven en el estado del módulo y un test le hereda a otro
    // la carpeta de Juan (con su folio), y la "propuesta nueva" sale como corrección -B.
    carpetas: kvCarpetas(),
    leerEstado: async (k) => _kv.get(k) ?? null,
    escribirEstado: (k, v) => _kv.set(k, v),
    parseInbound: () => ({ ok: true, from, text: 'cotiza una corredera 1200x1000 blanca', msgId, type: 'text' }),
    parseLandingRef: () => ({ hasRef: false }),
    sendWhatsAppText: async (to, t) => { textos.push({ to, t }); return { ok: true }; },
    generatePdf: async () => Buffer.from('%PDF-1.4 fake'),
    uploadWaDocument: async () => 'media-test',
    sendWaDocument: async () => ({ ok: true, msgId: 'sent-test' }),
    upsertZohoDeal: async () => null,
    loadSession: async () => null,
    persistSession: () => {},
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async (p) => { conversaciones.push(p); return { ok: true }; },
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async (p) => { quoteEvents.push(p); return { ok: true }; },
    },
    handleTurn: async ({ userText, state, toolCtx }) => {
      const result = await toolCtx.generarPdf({
        name: 'Juan Pérez', comuna: 'Temuco',
        // Medida distinta por test: el dedup de folio (2 min, por par vendedor+cliente) vive en el
        // módulo, y dos tests con la MISMA cotización se devolverían el folio uno al otro.
        items: [{ producto_label: 'Corredera SLIDING H80', measures: extra.medida || '1200x1000', color: 'blanco', qty: 1, unit_price: 324573 }],
      });
      pdfResults.push(result);
      return {
        reply: result?.message || 'ok',
        history: [{ role: 'user', content: userText }],
        toolCalls: [{ name: 'generar_pdf_cotizacion', result }],
        state: { ...state },
      };
    },
  };
}

async function correr(deps, mediaStore = []) {
  const orig = { fetch: global.fetch, url: process.env.SALES_OS_URL, tok: process.env.SALES_OS_OPERATOR_TOKEN };
  process.env.SALES_OS_URL = 'https://sales-os.test';
  process.env.SALES_OS_OPERATOR_TOKEN = 'test-operator-token';
  global.fetch = async (url, init) => {
    if (String(url).includes('/internal/quotes/next-number')) {
      return { ok: true, json: async () => ({ quote_number: 'CM-FR-004-2026-0777' }) };
    }
    if (String(url).includes('/api/v5/media/store')) mediaStore.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ ok: true }) };
  };
  try { await handleWebhook({ body: {} }, makeRes(), deps); }
  finally {
    global.fetch = orig.fetch;
    if (orig.url === undefined) delete process.env.SALES_OS_URL; else process.env.SALES_OS_URL = orig.url;
    if (orig.tok === undefined) delete process.env.SALES_OS_OPERATOR_TOKEN; else process.env.SALES_OS_OPERATOR_TOKEN = orig.tok;
  }
}

function kvCarpetas(inicial = {}) {
  const m = new Map(Object.entries(inicial));
  return {
    m,
    leer: async (k) => ({ ok: true, valor: m.has(k) ? structuredClone(m.get(k)) : null }),
    escribir: async (k, v) => { m.set(k, structuredClone(v)); return { ok: true }; },
  };
}

function preparar() { _reiniciarParaTests(); resetAtribucion(); }
const sinTurno = (deps) => { const o = { llego: false }; deps.handleTurn = async () => { o.llego = true; return { reply: 'x', history: [], toolCalls: [], state: {} }; }; return o; };

test('Fase 0: el dueño SIN cliente ni PRUEBA no cotiza — se le pide CLIENTE o PRUEBA', async () => {
  preparar();
  const ev = []; const pdf = []; const textos = [];
  const deps = makeDeps(DUENIO, 'wamid.F0.SIN', ev, pdf, { textos });
  const t = sinTurno(deps);
  try { await correr(deps); } finally { preparar(); }
  assert.equal(t.llego, false, 'no llega al LLM: no cotiza a su propio número');
  assert.equal(ev.length, 0, 'no se registra ninguna cotización');
  assert.ok(textos.some((x) => x.t === TEXTO_PEDIR_CLIENTE_DUENIO), `textos: ${JSON.stringify(textos.map((x) => x.t))}`);
  assert.match(TEXTO_PEDIR_CLIENTE_DUENIO, /CLIENTE Nombre Apellido \+569/);
  assert.match(TEXTO_PEDIR_CLIENTE_DUENIO, /PRUEBA/);
});

test('Fase 0: PRUEBA activa el modo prueba por 2 h (sin llamar al LLM)', async () => {
  preparar();
  const ev = []; const pdf = []; const textos = [];
  const deps = makeDeps(DUENIO, 'wamid.F0.PRUEBA', ev, pdf, { textos });
  deps.parseInbound = () => ({ ok: true, from: DUENIO, text: 'prueba', msgId: 'wamid.F0.PRUEBA', type: 'text' });
  const escritos = [];
  const esc0 = deps.escribirEstado; deps.escribirEstado = (k, v, ttl) => { escritos.push({ k, ttl }); return esc0(k, v); };
  const t = sinTurno(deps);
  try { await correr(deps); } finally { preparar(); }
  assert.equal(t.llego, false);
  assert.ok(escritos.some((e) => e.k === `modo_prueba:${DUENIO}` && e.ttl === 7200), `escritos: ${JSON.stringify(escritos)}`);
  assert.ok(textos.some((x) => x.t === TEXTO_MODO_PRUEBA));
});

test('Fase 0: en modo prueba el dueño cotiza como antes (a su nombre) y la prueba se renueva', async () => {
  preparar();
  const ev = []; const pdf = [];
  const deps = makeDeps(DUENIO, 'wamid.F0.ENPRUEBA', ev, pdf, { medida: '1300x1000' });
  await deps.escribirEstado(`modo_prueba:${DUENIO}`, { at: Date.now() });
  const renov = [];
  const esc0 = deps.escribirEstado; deps.escribirEstado = (k, v, ttl) => { if (k.startsWith('modo_prueba:')) renov.push(ttl); return esc0(k, v); };
  try { await correr(deps); } finally { preparar(); }
  const sent = ev.find((e) => e.status === 'sent');
  assert.ok(sent, `debe emitirse en modo prueba (resultado: ${JSON.stringify(pdf[0])})`);
  assert.equal(String(sent.phone).replace(/\D/g, ''), DUENIO, 'en prueba queda a nombre del dueño, como antes');
  assert.ok(renov.includes(7200), 'cada mensaje en prueba renueva las 2 h');
});

test('Fase 0: el dueño CON cliente fijado cotiza a nombre del CLIENTE (no necesita PRUEBA)', async () => {
  preparar();
  fijar(DUENIO, CLIENTE, 'Juan Pérez');
  const ev = []; const pdf = [];
  try { await correr(makeDeps(DUENIO, 'wamid.F0.CLIENTE', ev, pdf, { medida: '1400x1000' })); } finally { preparar(); }
  const sent = ev.find((e) => e.status === 'sent');
  assert.ok(sent, `debe emitirse (resultado: ${JSON.stringify(pdf[0])})`);
  assert.equal(sent.phone, CLIENTE, 'la cotización va al cliente fijado');
});

test('Fase 0: un CLIENTE normal no se toca (no se le pide nada, cotiza como siempre)', async () => {
  preparar();
  const ev = []; const pdf = []; const textos = [];
  try { await correr(makeDeps(OTRO, 'wamid.F0.OTRO', ev, pdf, { textos, medida: '1600x1000' })); } finally { preparar(); }
  assert.ok(ev.find((e) => e.status === 'sent'), 'el cliente cotiza normal');
  assert.ok(!textos.some((x) => x.t === TEXTO_PEDIR_CLIENTE_DUENIO), 'al cliente nunca se le pide CLIENTE/PRUEBA');
});
