// 🔴 GUARDIA DE UNA DECISION DEL DUEÑO (2026-10-08): el monorriel sobre medida se cotiza y el cliente
// lee, SUTIL, que ingenieria la revisa. Codex (tridente r1 y r2) mostro que la frase se perdia en los
// DOS caminos reales de entrega del PDF. Esto los prueba a traves del webhook real, no del helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook } from './webhook.js';

const CLIENTE = '56987650011';
const FRASE = /ingenier[ií]a las revisa antes de fabricar/i;
const ITEM = (extra = {}) => ({ producto_label: 'Corredera ANDES 66 Monorriel', product: 'Corredera ANDES 66 Monorriel',
  measures: '2540x2370', color: 'nogal', qty: 1, unit_price: 905000, ...extra });

function makeDeps(msgId, text, extra = {}) {
  const textos = extra.textos;
  const _kv = new Map();
  return {
    conv: new Map(), seen: new Set(), locks: new Map(),
    leerEstado: async (k) => _kv.get(k) ?? null, escribirEstado: (k, v) => _kv.set(k, v),
    parseInbound: () => ({ ok: true, from: CLIENTE, text, msgId, type: 'text' }),
    parseLandingRef: () => ({ hasRef: false }),
    sendWhatsAppText: async (to, t) => { textos.push({ to, t }); return { ok: true }; },
    generatePdf: async () => Buffer.from('%PDF-1.4 fake'),
    uploadWaDocument: async () => 'media-test',
    sendWaDocument: async () => ({ ok: true, msgId: 'sent-test' }),
    upsertZohoDeal: async () => null,
    loadSession: extra.loadSession || (async () => null),
    persistSession: () => {},
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({ ok: true }), pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async () => ({ ok: true }),
    },
    handleTurn: extra.handleTurn,
  };
}

async function correr(deps) {
  const orig = { fetch: global.fetch, url: process.env.SALES_OS_URL, tok: process.env.SALES_OS_OPERATOR_TOKEN };
  process.env.SALES_OS_URL = 'https://sales-os.test';
  process.env.SALES_OS_OPERATOR_TOKEN = 'test-operator-token';
  global.fetch = async (url) => {
    if (String(url).includes('/internal/quotes/next-number')) return { ok: true, json: async () => ({ quote_number: 'CM-FR-004-2026-0901' }) };
    return { ok: true, json: async () => ({ ok: true }), text: async () => '{}' };
  };
  try { await handleWebhook({ body: {} }, { sendStatus() { return this; } }, deps); }
  finally {
    global.fetch = orig.fetch;
    if (orig.url === undefined) delete process.env.SALES_OS_URL; else process.env.SALES_OS_URL = orig.url;
    if (orig.tok === undefined) delete process.env.SALES_OS_OPERATOR_TOKEN; else process.env.SALES_OS_OPERATOR_TOKEN = orig.tok;
  }
}

test('🔴 entrega DETERMINISTA (cliente confirma el turno siguiente): el mensaje lleva la frase', async () => {
  const textos = [];
  const deps = makeDeps('wamid.MONO.DET', 'sí, mándamela', {
    textos,
    loadSession: async () => ({
      history: [{ role: 'user', content: 'V1 2540x2370 una fija y una corredera' },
        { role: 'assistant', content: '¿Le preparo la propuesta en PDF?' }],
      state: { comuna: 'Villarrica', name: 'Cliente', pending_quote: { items: [ITEM({ revision_ingenieria: true })], grand_total: 905000 } },
    }),
    handleTurn: async () => { throw new Error('no debe llegar al LLM: lo entrega el codigo'); },
  });
  await correr(deps);
  const aCliente = textos.filter((x) => x.to === CLIENTE).map((x) => x.t).join('\n---\n');
  assert.match(aCliente, FRASE, `textos al cliente: ${aCliente}`);
});

test('🔴 entrega en el MISMO turno (_pdfCall): el sistema agrega la frase aunque el LLM no la diga', async () => {
  const textos = [];
  const deps = makeDeps('wamid.MONO.MISMO', 'cotiza V1 2540x2370 una fija y una corredera', {
    textos,
    handleTurn: async ({ userText, state, toolCtx }) => {
      const r = await toolCtx.generarPdf({ name: 'Cliente', comuna: 'Villarrica', items: [ITEM({ measures: '2541x2370' })] });
      return { reply: 'texto del LLM sin la frase', history: [{ role: 'user', content: userText }],
        toolCalls: [{ name: 'calcular_cotizacion', input: { tipo: 'CORREDERA', color: 'nogal' },
          result: { ok: true, unit_price: 905000, producto_label: 'Corredera ANDES 66 Monorriel', medidas_resueltas: '2541x2370mm', revision_ingenieria: true, referencial: true } },
        { name: 'generar_pdf_cotizacion', result: r }], state: { ...state } };
    },
  });
  await correr(deps);
  const aCliente = textos.filter((x) => x.to === CLIENTE).map((x) => x.t).join('\n---\n');
  assert.match(aCliente, FRASE, `textos al cliente: ${aCliente}`);
});
