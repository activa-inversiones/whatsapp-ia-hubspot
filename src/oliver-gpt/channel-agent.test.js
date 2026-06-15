// channel-agent.test.js — golden de la entrega de PDF multicanal (IG/FB) por SUBIDA BINARIA.
// Hermético: deps inyectadas + global.fetch stub (solo next-number). Cero red, cero URL pública.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleChannelTurn } from './channel-agent.js';

process.env.SALES_OS_URL = 'https://ops.activalabs.ai';
process.env.SALES_OS_OPERATOR_TOKEN = 'tok';

function stubFetch(quoteNumber = 'CM-FR-004-2026-0007', ok = true) {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/internal/quotes/next-number')) return { ok, json: async () => ({ quote_number: quoteNumber }) };
    return { ok: false, json: async () => ({}) };
  };
}

function mkDeps(overrides = {}) {
  const log = { quoteEvents: [], attachments: [], persisted: [], escalations: 0 };
  const deps = {
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({}),
      pushLeadEvent: async () => ({}),
      pushQuoteEvent: async (p) => { log.quoteEvents.push(p); return {}; },
    },
    notifyHighValue: async () => { log.escalations++; return { ok: true }; },
    sendWhatsAppText: async () => ({ ok: true }),
    generatePdf: async () => Buffer.from('%PDF-1.4 fake'),
    // SUBIDA BINARIA: (channel, recipientId, buffer, filename, caption)
    sendChannelDocument: async (...a) => { log.attachments.push(a); return { ok: true, messageId: 'mid1' }; },
    upsertZohoDeal: async () => 'deal1',
    addZohoNote: async () => {},
    loadSession: async () => null,
    persistSession: (k, s) => { log.persisted.push([k, s]); },
    conv: new Map(),
    seen: new Set(),
    locks: new Map(),
    ...overrides,
  };
  return { deps, log };
}

// handleTurn que pide el PDF (simula que el cerebro llamó la tool generar_pdf_cotizacion).
function mkHandleTurnPdf(extra = {}) {
  return async ({ toolCtx }) => {
    const r = await toolCtx.generarPdf({
      name: 'Marcelo', comuna: 'Temuco',
      items: [{ producto_label: 'Corredera SLIDING H80', measures: '1200x1000', color: 'blanco', qty: 1, unit_price: 324573, glass_label: '4+12+4' }],
      grand_total: 324573,
      ...extra,
    });
    return { reply: r.message, history: [{ role: 'user', content: 'cotiza' }], state: {}, toolCalls: [{ name: 'generar_pdf_cotizacion' }] };
  };
}
const handleTurnPdf = mkHandleTurnPdf();

test('IG: folio único + SUBIDA BINARIA del PDF (sin URL pública) + conversión instagram', async () => {
  stubFetch('CM-FR-004-2026-0007');
  const { deps, log } = mkDeps({ handleTurn: handleTurnPdf });
  const out = await handleChannelTurn(
    { channel: 'instagram', senderId: 'IG_happy', text: 'cotiza', msgId: 'h1', sendFn: async () => ({ ok: true }) }, deps);
  assert.equal(out.ok, true);
  assert.match(out.reply, /CM-FR-004-2026-0007/);
  assert.equal(log.attachments.length, 1, 'debe entregar 1 documento');
  assert.equal(log.attachments[0][0], 'instagram');                 // channel
  assert.ok(Buffer.isBuffer(log.attachments[0][2]), 'envía el BUFFER del PDF, no una URL'); // buffer binario
  assert.match(log.attachments[0][3], /CM-FR-004-2026-0007\.pdf/);  // filename
  const qe = log.quoteEvents[0];
  assert.ok(qe && qe.channel === 'instagram', 'conversión con canal instagram (anti-cross-inject)');
  assert.ok(log.persisted.length >= 1, 'sesión persistida a Postgres');
});

test('FB: también entrega el PDF binario', async () => {
  stubFetch('CM-FR-004-2026-0008');
  const { deps, log } = mkDeps({ handleTurn: handleTurnPdf });
  const out = await handleChannelTurn(
    { channel: 'facebook', senderId: 'FB_happy', text: 'cotiza', msgId: 'f1', sendFn: async () => ({ ok: true }) }, deps);
  assert.match(out.reply, /CM-FR-004-2026-0008/);
  assert.equal(log.attachments[0][0], 'facebook');
});

test('anti-doble-folio por canal:sender — 2da cotización reusa el folio', async () => {
  stubFetch('CM-FR-004-2026-0009');
  const conv = new Map();
  const { deps: d1 } = mkDeps({ handleTurn: handleTurnPdf, conv });
  await handleChannelTurn({ channel: 'instagram', senderId: 'IG_dup', text: 'a', msgId: 'd1', sendFn: async () => ({ ok: true }) }, d1);
  stubFetch('CM-FR-004-2026-9999'); // si pidiera folio nuevo saldría 9999 → NO debe
  const { deps: d2 } = mkDeps({ handleTurn: handleTurnPdf, conv });
  const out2 = await handleChannelTurn({ channel: 'instagram', senderId: 'IG_dup', text: 'b', msgId: 'd2', sendFn: async () => ({ ok: true }) }, d2);
  assert.match(out2.reply, /CM-FR-004-2026-0009/);
  assert.doesNotMatch(out2.reply, /9999/);
});

test('dedup por TELÉFONO — mismo número por IG y luego WhatsApp = UN folio', async () => {
  stubFetch('CM-FR-004-2026-0020');
  const htPhone = mkHandleTurnPdf({ phone: '56912345678' });
  const { deps: d1 } = mkDeps({ handleTurn: htPhone });
  await handleChannelTurn({ channel: 'instagram', senderId: 'IG_tel', text: 'a', msgId: 'p1', sendFn: async () => ({ ok: true }) }, d1);
  stubFetch('CM-FR-004-2026-7777');
  const { deps: d2 } = mkDeps({ handleTurn: htPhone });
  // distinto canal/sender pero MISMO teléfono → dedup por tel:
  const out2 = await handleChannelTurn({ channel: 'facebook', senderId: 'FB_tel', text: 'b', msgId: 'p2', sendFn: async () => ({ ok: true }) }, d2);
  assert.match(out2.reply, /CM-FR-004-2026-0020/, 'reusa el folio del mismo teléfono');
  assert.doesNotMatch(out2.reply, /7777/);
});

test('GUARDIA: ítem sin unit_price>0 NO genera PDF ni entrega documento', async () => {
  stubFetch();
  const handleTurnBad = async ({ toolCtx }) => {
    const r = await toolCtx.generarPdf({ items: [{ producto_label: 'x', qty: 1, unit_price: 0 }] });
    return { reply: r.message || 'abort', history: [], state: {}, toolCalls: [] };
  };
  const { deps, log } = mkDeps({ handleTurn: handleTurnBad });
  const out = await handleChannelTurn({ channel: 'facebook', senderId: 'FB_guard', text: 'cotiza', msgId: 'g1', sendFn: async () => ({ ok: true }) }, deps);
  assert.equal(log.attachments.length, 0);
  assert.match(out.reply, /calcular bien el precio/);
});

test('FALLBACK ISO: si next-number no responde NO se quema folio fantasma → escala', async () => {
  stubFetch('IGNORADO', false); // next-number devuelve ok:false
  const { deps, log } = mkDeps({ handleTurn: handleTurnPdf });
  const out = await handleChannelTurn({ channel: 'instagram', senderId: 'IG_nofolio', text: 'cotiza', msgId: 'n1', sendFn: async () => ({ ok: true }) }, deps);
  assert.equal(log.attachments.length, 0, 'no entrega PDF sin folio real');
  assert.ok(log.escalations >= 1, 'escala a Marcelo');
  assert.doesNotMatch(out.reply, /FALLBACK/);
  assert.match(out.reply, /momentito|Marcelo/);
});

test('PDF no entregable (IG sin Página / fuera de ventana) → escala, no se pierde', async () => {
  stubFetch('CM-FR-004-2026-0011');
  const { deps, log } = mkDeps({
    handleTurn: handleTurnPdf,
    sendChannelDocument: async () => ({ ok: false, outsideWindow: true, error: 'window' }),
  });
  const out = await handleChannelTurn({ channel: 'instagram', senderId: 'IG_win', text: 'cotiza', msgId: 'w1', sendFn: async () => ({ ok: true }) }, deps);
  assert.ok(log.escalations >= 1);
  assert.match(out.reply, /Marcelo te la hace llegar/);
});

test('sesión fría (redeploy): hidrata desde Postgres → recibe historial previo (no re-saluda)', async () => {
  stubFetch();
  let loaded = 0;
  const captured = [];
  const handleTurnCapture = async ({ history }) => {
    captured.push(history.slice());
    return { reply: 'ok', history: [...history, { role: 'user', content: 'sigo' }], state: {}, toolCalls: [] };
  };
  const { deps } = mkDeps({
    handleTurn: handleTurnCapture,
    loadSession: async () => { loaded++; return { history: [{ role: 'user', content: 'antes' }, { role: 'assistant', content: 'cotización previa $804.005' }], state: { comuna: 'Temuco' } }; },
    conv: new Map(),
  });
  await handleChannelTurn({ channel: 'instagram', senderId: 'IG_cold', text: 'sigo', msgId: 'c1', sendFn: async () => ({ ok: true }) }, deps);
  assert.equal(loaded, 1);
  assert.ok(captured[0].length >= 2);
});
