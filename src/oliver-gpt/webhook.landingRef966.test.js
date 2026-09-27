// webhook.landingRef966.test.js — [#966 2026-09-27] GUARDIAS de conducta del bloque (4c) con el parser REAL (sin mock):
//  1. el tag [Ref:uuid] NUNCA llega al LLM ni al espejo de sales-os, ni siquiera cuando la sesión ya lo había capturado
//     (antes: 18 re-clics/60 d le mandaban el tag crudo al modelo y al operador);
//  2. un mensaje que es SOLO el tag (botones sin frase) recibe respuesta (antes: `return` mudo, 15-20 clientes/60 d);
//  3. el evento quote_started viaja con event_id uuid (antes 'oliver_wa_…': 0 filas en toda la historia);
//  4. ref_status / landing_lead_id viajan en la metadata del inbound y del lead (la medición por lead de #966);
//  5. en takeover humano el tag no se espeja crudo al operador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook } from './webhook.js';
import { TEXTO_SOLO_REF, BODY_SOLO_REF, quoteStartedEventId } from '../../services/landingRefParser.js';

const UUID = '3fbf86b0-1234-4abc-9def-0123456789ab';
const FROM = '56911113333';
const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function makeRes() { return { sendStatus() { return this; } }; }

function arnes({ aiPaused = false } = {}) {
  const kv = new Map();
  const r = { turnos: [], enviados: [], conversationEvents: [], leadEvents: [], fetches: [] };
  const deps = {
    conv: new Map(), seen: new Set(), locks: new Map(),
    leerEstado: async (k) => kv.get(k) ?? null, escribirEstado: (k, v) => kv.set(k, v),
    parseInbound: () => ({ ok: true, from: FROM, text: '', msgId: 'x', type: 'text', enviadoAt: '2026-09-27T15:00:00.000Z' }),
    sendWhatsAppText: async (to, text) => { r.enviados.push({ to, text }); return { ok: true }; },
    generatePdf: async () => Buffer.from('%PDF-1.4 fake'), uploadWaDocument: async () => 'media', sendWaDocument: async () => ({ ok: true, msgId: 'm' }),
    upsertZohoDeal: async () => null, loadSession: async () => null, persistSession: () => {},
    bridge: {
      getConversationControl: async () => (aiPaused ? { ai_paused: true, operator_status: 'human' } : { ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async (p) => { r.conversationEvents.push(p); return { ok: true }; },
      pushLeadEvent: async (p) => { r.leadEvents.push(p); return { ok: true }; },
      pushQuoteEvent: async () => ({ ok: true }),
    },
    handleTurn: async ({ userText, state }) => {
      r.turnos.push({ userText, state: { ...state } });
      return { reply: 'Hola, ¿qué ventana necesitás cotizar?', history: [{ role: 'user', content: userText }, { role: 'assistant', content: 'Hola, ¿qué ventana necesitás cotizar?' }], toolCalls: [], state: { ...state } };
    },
  };
  return { deps, r };
}

async function conFetchFalso(fn, fetches) {
  const originalFetch = global.fetch, key = process.env.DASHBOARD_API_KEY, so = process.env.SALES_OS_URL, tok = process.env.SALES_OS_OPERATOR_TOKEN;
  process.env.DASHBOARD_API_KEY = 'test-key'; process.env.SALES_OS_URL = 'https://sales-os.test'; process.env.SALES_OS_OPERATOR_TOKEN = 'tok';
  global.fetch = async (url, opts = {}) => {
    const u = String(url); fetches.push({ url: u, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes(`/api/lead-event/ref/${UUID}`)) return { ok: true, json: async () => ({ ok: true, lead: { lead_id: UUID, gclid: 'gclid-landing', landing_slug: 'ventanas-pvc-temuco' } }) };
    return { ok: true, status: 204, json: async () => ({ ok: true }) };
  };
  try { return await fn(); } finally {
    global.fetch = originalFetch;
    for (const [k, v] of [['DASHBOARD_API_KEY', key], ['SALES_OS_URL', so], ['SALES_OS_OPERATOR_TOKEN', tok]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const tick = () => new Promise((res) => setImmediate(res));

test('#966 · primer mensaje con tag: el LLM y sales-os reciben el texto limpio; quote_started con uuid; ref_status viaja', async () => {
  const { deps, r } = arnes();
  deps.parseInbound = () => ({ ok: true, from: FROM, text: `Hola Activa, quiero cotizar ventanas de PVC. [Ref:${UUID}]`, msgId: 'wamid.966.1', type: 'text', enviadoAt: '2026-09-27T15:00:00.000Z' });
  await conFetchFalso(() => handleWebhook({ body: {} }, makeRes(), deps), r.fetches);
  await tick(); await tick();
  assert.equal(r.turnos.length, 1); assert.equal(r.turnos[0].userText, 'Hola Activa, quiero cotizar ventanas de PVC.', 'sin el tag');
  assert.ok(!JSON.stringify(r.turnos[0].userText).includes('[Ref:'));
  const st = deps.conv.get(FROM).state;
  assert.equal(st.landingRefCaptured, true); assert.equal(st.landing_lead_id, UUID); assert.equal(st.gclid, 'gclid-landing');
  assert.equal(st.ref_status, 'con_ref'); assert.equal(st.ref_status_at, '2026-09-27T15:00:00.000Z', 'la hora REAL del cliente'); assert.equal(st.ref_solo_tag, undefined);
  const qs = r.fetches.find((f) => f.method === 'POST' && f.url.endsWith('/api/lead-event'));
  assert.ok(qs, 'POST quote_started al collector'); assert.equal(qs.body.event_name, 'quote_started'); assert.equal(qs.body.lead_id, UUID); assert.equal(qs.body.fuente, 'oliver');
  assert.match(qs.body.event_id, UUID_V5, 'uuid, no oliver_wa_…'); assert.equal(qs.body.event_id, quoteStartedEventId(UUID), 'determinístico por lead');
  const lead = r.leadEvents.find((e) => e.source === 'landing_organic');
  assert.ok(lead); assert.equal(lead.landing_ref, UUID); assert.equal(lead.metadata.ref_status, 'con_ref'); assert.equal(lead.gclid, 'gclid-landing'); assert.equal(lead.ad_click_id_source, 'landing_ref');
  const inbound = r.conversationEvents.find((e) => e.direction === 'inbound');
  assert.ok(inbound); assert.ok(!String(inbound.body).includes('[Ref:'), 'el espejo va limpio'); assert.equal(inbound.metadata.ref_status, 'con_ref'); assert.equal(inbound.metadata.landing_lead_id, UUID); assert.equal(inbound.metadata.enviado_at, '2026-09-27T15:00:00.000Z');
  assert.equal(r.enviados.length, 1, 'Oliver contestó');
});

test('#966 · re-clic con el MISMO tag en una sesión ya capturada: se limpia igual y no se re-captura; con OTRO uuid queda anotado', async () => {
  const { deps, r } = arnes();
  deps.parseInbound = () => ({ ok: true, from: FROM, text: `Quiero una corredera [Ref:${UUID}]`, msgId: 'wamid.966.2a', type: 'text' });
  await conFetchFalso(() => handleWebhook({ body: {} }, makeRes(), deps), r.fetches); await tick();
  deps.parseInbound = () => ({ ok: true, from: FROM, text: `Hola de nuevo [Ref:${UUID}]`, msgId: 'wamid.966.2b', type: 'text' });
  await conFetchFalso(() => handleWebhook({ body: {} }, makeRes(), deps), r.fetches); await tick();
  assert.equal(r.turnos.length, 2); assert.equal(r.turnos[1].userText, 'Hola de nuevo', 'antes: el tag crudo llegaba al LLM en el re-clic');
  assert.equal(r.fetches.filter((f) => f.url.includes('/api/lead-event/ref/')).length, 1, 'el contexto se pide UNA vez');
  assert.equal(r.conversationEvents.filter((e) => e.direction === 'inbound' && String(e.body).includes('[Ref:')).length, 0, 'ningún espejo lleva el tag');
  const otro = '00000000-0000-4000-8000-000000000000';
  deps.parseInbound = () => ({ ok: true, from: FROM, text: `Vengo de otro anuncio [Ref:${otro}]`, msgId: 'wamid.966.2c', type: 'text' });
  await conFetchFalso(() => handleWebhook({ body: {} }, makeRes(), deps), r.fetches); await tick();
  const st = deps.conv.get(FROM).state;
  assert.equal(st.landing_lead_id, UUID, 'NO se re-atribuye (decisión de plata pendiente del dueño)'); assert.equal(st.landing_ref_otro_uuid, otro, 'pero queda anotado');
  assert.equal(r.turnos[2].userText, 'Vengo de otro anuncio'); assert.equal(st.ref_status, 'con_ref', 'la clase del PRIMER texto no se re-escribe');
});

test('#966 · mensaje que es SOLO el tag (botón sin frase): Oliver contesta con la instrucción, ref_status = solo_ref', async () => {
  const { deps, r } = arnes();
  deps.parseInbound = () => ({ ok: true, from: FROM, text: ` [Ref:${UUID}]`, msgId: 'wamid.966.3', type: 'text' });
  await conFetchFalso(() => handleWebhook({ body: {} }, makeRes(), deps), r.fetches); await tick(); await tick();
  assert.equal(r.turnos.length, 1, 'antes: return mudo sin pasar por el LLM'); assert.equal(r.turnos[0].userText, TEXTO_SOLO_REF);
  assert.equal(r.enviados.length, 1, 'el cliente recibe respuesta');
  const st = deps.conv.get(FROM).state;
  assert.equal(st.ref_status, 'solo_ref'); assert.equal(st.ref_solo_tag, true); assert.equal(st.landingRefCaptured, true); assert.equal(st.landing_lead_id, UUID);
  const inbound = r.conversationEvents.find((e) => e.direction === 'inbound');
  assert.equal(inbound.metadata.ref_status, 'solo_ref'); assert.equal(inbound.metadata.ref_solo_tag, true); assert.ok(!String(inbound.body).includes('[Ref:'));
  assert.equal(inbound.body, BODY_SOLO_REF, 'el operador ve un marcador neutro, NO la instrucción al LLM (NIM r2)'); assert.equal(inbound.metadata.resolved_text, BODY_SOLO_REF);
  const lead = r.leadEvents.find((e) => e.source === 'landing_organic'); assert.equal(lead.metadata.ref_status, 'solo_ref');
});

test('#966 · frase de la web SIN tag y texto propio: se clasifican y no se captura nada', async () => {
  const { deps, r } = arnes();
  deps.parseInbound = () => ({ ok: true, from: FROM, text: 'Hola, vi su web y quiero cotizar ventanas pvc en Temuco', msgId: 'wamid.966.4', type: 'text' });
  await conFetchFalso(() => handleWebhook({ body: {} }, makeRes(), deps), r.fetches); await tick();
  const st = deps.conv.get(FROM).state;
  assert.equal(st.ref_status, 'texto_landing_sin_ref'); assert.equal(st.landingRefCaptured, undefined); assert.equal(r.fetches.filter((f) => f.url.includes('/api/lead-event')).length, 0);
  assert.equal(r.conversationEvents.find((e) => e.direction === 'inbound').metadata.ref_status, 'texto_landing_sin_ref');
  const { deps: d2, r: r2 } = arnes();
  d2.parseInbound = () => ({ ok: true, from: FROM, text: 'hola', msgId: 'wamid.966.4b', type: 'text' });
  await conFetchFalso(() => handleWebhook({ body: {} }, makeRes(), d2), r2.fetches); await tick();
  assert.equal(d2.conv.get(FROM).state.ref_status, 'otro_texto');
});

test('#966 · takeover humano: el tag no se espeja crudo al operador y queda anotado que venía', async () => {
  const { deps, r } = arnes({ aiPaused: true });
  deps.parseInbound = () => ({ ok: true, from: FROM, text: `Quiero hablar con alguien [Ref:${UUID}]`, msgId: 'wamid.966.5', type: 'text' });
  await conFetchFalso(() => handleWebhook({ body: {} }, makeRes(), deps), r.fetches); await tick();
  assert.equal(r.turnos.length, 0, 'la IA no interviene en takeover');
  const inbound = r.conversationEvents.find((e) => e.direction === 'inbound');
  assert.ok(inbound, 'el inbound se persiste para el operador'); assert.equal(inbound.body, 'Quiero hablar con alguien'); assert.equal(inbound.metadata.ai_paused, true); assert.equal(inbound.metadata.landing_ref_visible, true);
});

test('#966 r2 · tag MUTILADO: se clasifica ref_mutilada y NO llega al LLM ni al espejo', async () => {
  const { deps, r } = arnes();
  deps.parseInbound = () => ({ ok: true, from: FROM, text: `Hola, quiero cotizar [Ref:${UUID.slice(0, 20)}`, msgId: 'wamid.966.6', type: 'text' });
  await conFetchFalso(() => handleWebhook({ body: {} }, makeRes(), deps), r.fetches); await tick();
  assert.equal(deps.conv.get(FROM).state.ref_status, 'ref_mutilada');
  assert.equal(r.turnos[0].userText, 'Hola, quiero cotizar', 'el tag roto se limpia igual');
  assert.ok(!String(r.conversationEvents.find((e) => e.direction === 'inbound').body).includes('[Ref:'));
  assert.equal(deps.conv.get(FROM).state.landingRefCaptured, undefined, 'roto ⇒ no se captura (no hay uuid seguro)');
});

test('#966 r2 · tras 7 días sin hablar, el próximo texto se re-clasifica (una llegada nueva no hereda la clase vieja)', async () => {
  const { deps, r } = arnes();
  deps.conv.set(FROM, { history: [{ role: 'user', content: 'viejo' }], state: { ref_status: 'solo_ref', ref_solo_tag: true, lastMessageAt: Date.now() - 8 * 86400000 } });
  deps.parseInbound = () => ({ ok: true, from: FROM, text: 'Hola, vi su web y quiero cotizar ventanas pvc en Temuco', msgId: 'wamid.966.7', type: 'text' });
  await conFetchFalso(() => handleWebhook({ body: {} }, makeRes(), deps), r.fetches); await tick();
  const st = deps.conv.get(FROM).state;
  assert.equal(st.ref_status, 'texto_landing_sin_ref', 'se re-clasificó'); assert.equal(st.ref_solo_tag, undefined, 'y se soltó la marca vieja');
  const { deps: d2, r: r2 } = arnes();
  d2.conv.set(FROM, { history: [{ role: 'user', content: 'ayer' }], state: { ref_status: 'con_ref', lastMessageAt: Date.now() - 2 * 86400000 } });
  d2.parseInbound = () => ({ ok: true, from: FROM, text: 'hola', msgId: 'wamid.966.7b', type: 'text' });
  await conFetchFalso(() => handleWebhook({ body: {} }, makeRes(), d2), r2.fetches); await tick();
  assert.equal(d2.conv.get(FROM).state.ref_status, 'con_ref', 'hace 2 días: sigue siendo la misma conversación, la clase del primer texto se conserva');
});

test('#966 r2 · si el cerebro devuelve un state sin las claves nuevas, los merges del turno las conservan (ATTRIBUTION_STATE_KEYS)', async () => {
  const { deps, r } = arnes();
  deps.handleTurn = async ({ userText }) => ({ reply: 'ok', history: [{ role: 'user', content: userText }, { role: 'assistant', content: 'ok' }], toolCalls: [], state: { name: 'Ana' } });
  deps.parseInbound = () => ({ ok: true, from: FROM, text: ` [Ref:${UUID}]`, msgId: 'wamid.966.8', type: 'text' });
  await conFetchFalso(() => handleWebhook({ body: {} }, makeRes(), deps), r.fetches); await tick(); await tick();
  const st = deps.conv.get(FROM).state;
  assert.equal(st.name, 'Ana');
  assert.equal(st.ref_status, 'solo_ref', 'ref_status sobrevive un state del LLM que no la trae'); assert.equal(st.ref_solo_tag, true); assert.equal(st.landing_lead_id, UUID); assert.equal(st.landingRefCaptured, true);
  assert.ok(st.ref_status_at, 'ref_status_at también');
});
