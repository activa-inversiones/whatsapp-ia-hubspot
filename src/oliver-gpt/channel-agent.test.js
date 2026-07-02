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
  // [2026-07-01 Bug#2] mensaje explícito: Marcelo la envía por WhatsApp (antes: "te la hace llegar" vago)
  assert.match(out.reply, /Marcelo Cifuentes.*enviará directamente a tu WhatsApp/);
});

// [IG-LOOP 2026-07-01] Caso real Juan Pablo (Instagram): entrega falla → NO quemar folio nuevo,
// máx 1 reintento y luego mensaje fijo de escalación SIEMPRE (cap en código, no en el LLM).
test('IG-LOOP: entrega fallida reusa folio, cap de 1 reintento y luego escalado fijo', async () => {
  stubFetch('CM-FR-004-2026-0073');
  const conv = new Map();
  const sendDocFail = async () => ({ ok: false, error: 'no_attachment' });

  // Turno 1: cotiza → folio 0073, entrega falla (intento 1)
  const { deps: d1, log: l1 } = mkDeps({ handleTurn: handleTurnPdf, conv, sendChannelDocument: sendDocFail });
  const o1 = await handleChannelTurn({ channel: 'instagram', senderId: 'IG_loop', text: 'cotiza', msgId: 'l1', sendFn: async () => ({ ok: true }) }, d1);
  assert.match(o1.reply, /CM-FR-004-2026-0073/);
  assert.ok(l1.escalations >= 1, 'escala al primer fallo');

  // Simular que pasó la ventana de dedup de 2 min (RECENT_QUOTES): limpiar el Map module-level
  // no es posible desde el test → avanzar el reloj del entry en su lugar no aplica; el guard
  // nuevo por state.last_quote NO depende de la ventana, así que forzamos folio distinto para
  // detectar cualquier next-number indebido.
  stubFetch('CM-FR-004-2026-9074'); // si pidiera folio nuevo saldría 9074 → NO debe aparecer

  // Turno 2: cliente reclama → reusa 0073 (intento 2) → queda escalado
  const { deps: d2 } = mkDeps({ handleTurn: handleTurnPdf, conv, sendChannelDocument: sendDocFail });
  const o2 = await handleChannelTurn({ channel: 'instagram', senderId: 'IG_loop', text: 'no me llegó', msgId: 'l2', sendFn: async () => ({ ok: true }) }, d2);
  assert.match(o2.reply, /CM-FR-004-2026-0073/, 'reusa el MISMO folio');
  assert.doesNotMatch(o2.reply, /9074/, 'no quema folio nuevo');
  assert.doesNotMatch(o2.reply, /Ya te emití/, 'no miente que entregó');

  // Turno 3: otro reclamo → mensaje fijo de escalación, sin reintento de envío
  const { deps: d3, log: l3 } = mkDeps({ handleTurn: handleTurnPdf, conv, sendChannelDocument: sendDocFail });
  const o3 = await handleChannelTurn({ channel: 'instagram', senderId: 'IG_loop', text: 'sigo sin el pdf', msgId: 'l3', sendFn: async () => ({ ok: true }) }, d3);
  assert.match(o3.reply, /CM-FR-004-2026-0073/, 'sigue el MISMO folio');
  assert.match(o3.reply, /Marcelo Cifuentes/, 'mensaje fijo de escalación');
  assert.equal(l3.attachments.length, 0, 'NO reintenta el envío del documento');
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

test('ESCALACIÓN DETERMINISTA: "quiero hablar con marcelo" → avisa + mensaje fijo, SIN pasar por el LLM', async () => {
  let llmCalled = 0;
  const { deps, log } = mkDeps({ handleTurn: async () => { llmCalled++; return { reply: 'NO_DEBERIA', history: [], state: {}, toolCalls: [] }; } });
  const out = await handleChannelTurn({ channel: 'instagram', senderId: 'IG_esc', text: 'Quiero hablar con Marcelo', msgId: 'esc1', sendFn: async () => ({ ok: true }) }, deps);
  assert.equal(llmCalled, 0, 'la escalación NO pasa por el LLM');
  assert.ok(log.escalations >= 1, 'avisa a Marcelo SIEMPRE');
  assert.match(out.reply, /\+56 9 5729 6035/, 'incluye el número directo');
  assert.match(out.reply, /Marcelo Cifuentes/);
  assert.doesNotMatch(out.reply, /notificar_marcelo/, 'NUNCA filtra el nombre de la tool');
});

test('ESCALACIÓN: "Escala estoy enojado" también dispara escalación determinista', async () => {
  let llmCalled = 0;
  const { deps, log } = mkDeps({ handleTurn: async () => { llmCalled++; return { reply: 'x', history: [], state: {}, toolCalls: [] }; } });
  const out = await handleChannelTurn({ channel: 'facebook', senderId: 'FB_ang', text: 'Escala estoy enojado', msgId: 'esc2', sendFn: async () => ({ ok: true }) }, deps);
  assert.equal(llmCalled, 0);
  assert.ok(log.escalations >= 1);
  assert.match(out.reply, /\+56 9 5729 6035/);
});

test('NO escala una cotización normal (sin falsos positivos)', async () => {
  let llmCalled = 0;
  const { deps, log } = mkDeps({ handleTurn: async () => { llmCalled++; return { reply: 'cotizando', history: [], state: {}, toolCalls: [] }; } });
  await handleChannelTurn({ channel: 'instagram', senderId: 'IG_norm', text: 'quiero cotizar una corredera 1.2x1.0 en temuco', msgId: 'n1', sendFn: async () => ({ ok: true }) }, deps);
  assert.equal(llmCalled, 1, 'una cotización normal SÍ pasa por el cerebro');
  assert.equal(log.escalations, 0);
});

test('PDF DETERMINISTA: cotiza → "ok envíamela" entrega el PDF en código (sin que el LLM lo llame)', async () => {
  stubFetch('CM-FR-004-2026-0030');
  const conv = new Map();
  // Turno 1: el cerebro cotiza (calcular_cotizacion) y OFRECE el PDF.
  const htCotiza = async () => ({
    reply: '¿Te gustaría que te envíe la propuesta formal en PDF?',
    history: [{ role: 'user', content: 'cotiza' }, { role: 'assistant', content: '¿Te gustaría que te envíe la propuesta formal en PDF?' }],
    // [PDF-RACE 2026-07-01] el flujo nuevo exige NOMBRE antes del PDF (REGLA #13 + gate en código):
    // el cerebro ya lo capturó durante la cotización.
    state: { name: 'Juan Pérez' },
    toolCalls: [{ name: 'calcular_cotizacion',
      input: { tipo: 'corredera', medidas_texto: '1200x1000', cantidad: 4, color: 'blanco' },
      result: { ok: true, unit_price: 324573, cantidad: 4, glass_label: '4+12+4', producto_label: 'Corredera SLIDING H80' } }],
  });
  const { deps: d1, log: log1 } = mkDeps({ handleTurn: htCotiza, conv });
  await handleChannelTurn({ channel: 'instagram', senderId: 'IG_pdf', text: 'cotiza corredera 1.2x1.0 4 unidades', msgId: 'q1', sendFn: async () => ({ ok: true }) }, d1);
  assert.equal(log1.attachments.length, 0, 'turno 1 (cotización) NO manda PDF todavía');

  // Turno 2: el cliente CONFIRMA → el PDF se entrega DETERMINISTA, sin pasar por el LLM.
  let llm2 = 0;
  const { deps: d2, log: log2 } = mkDeps({ handleTurn: async () => { llm2++; return { reply: 'NO_DEBERIA', history: [], state: {}, toolCalls: [] }; }, conv });
  const out2 = await handleChannelTurn({ channel: 'instagram', senderId: 'IG_pdf', text: 'ok envíamela', msgId: 'q2', sendFn: async () => ({ ok: true }) }, d2);
  assert.equal(llm2, 0, 'la entrega del PDF NO pasa por el LLM');
  assert.equal(log2.attachments.length, 1, 'el PDF SE entrega al confirmar');
  assert.match(out2.reply, /CM-FR-004-2026-0030/, 'con el folio ISO real');
});

// [PDF-RACE 2026-07-01] GATE de completitud: sin NOMBRE real no se emite PDF ni se quema folio
// (casos BD: 0081/0085/0086 emitidos antes de que el cliente respondiera). Oliver pide el nombre.
test('GATE: sin nombre NO se emite PDF ni se quema folio → pide el nombre', async () => {
  stubFetch('CM-FR-004-2026-0500');
  const conv = new Map();
  const htCotizaSinNombre = async () => ({
    reply: '¿Te gustaría que te envíe la propuesta formal en PDF?',
    history: [{ role: 'user', content: 'cotiza' }, { role: 'assistant', content: '¿Te gustaría que te envíe la propuesta formal en PDF?' }],
    state: {},   // ← sin nombre
    toolCalls: [{ name: 'calcular_cotizacion',
      input: { tipo: 'corredera', medidas_texto: '1200x1000', cantidad: 1, color: 'blanco' },
      result: { ok: true, unit_price: 324573, cantidad: 1, glass_label: '4+12+4', producto_label: 'Corredera SLIDING H80' } }],
  });
  const { deps: d1 } = mkDeps({ handleTurn: htCotizaSinNombre, conv });
  await handleChannelTurn({ channel: 'instagram', senderId: 'IG_gate', text: 'cotiza', msgId: 'g1', sendFn: async () => ({ ok: true }) }, d1);

  const { deps: d2, log: log2 } = mkDeps({ handleTurn: async () => ({ reply: 'NO_DEBERIA', history: [], state: {}, toolCalls: [] }), conv });
  const out2 = await handleChannelTurn({ channel: 'instagram', senderId: 'IG_gate', text: 'sí envíamela', msgId: 'g2', sendFn: async () => ({ ok: true }) }, d2);
  assert.equal(log2.attachments.length, 0, 'NO entrega PDF sin nombre');
  assert.match(out2.reply, /a nombre de qui[eé]n/i, 'pide el nombre del cliente');
  assert.doesNotMatch(out2.reply, /CM-FR-004-2026-0500/, 'NO quemó folio');
});
