import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleWebhook } from './webhook.js';


function makeRes() {
  return { sendStatus() { return this; } };
}

function makeDeps(quoteEvents) {
  // Uno por invocacion: compartido, los tests reusan el msgId y se descartarian entre si.
  const _kv = new Map();
  return {
    conv: new Map(),
    seen: new Set(),
    // [2026-08-08] Estado persistente falso y propio de cada test: el dedupe ahora se
    // respalda en Postgres para que un redeploy no deje pasar un reintento de Meta. Sin
    // esto los tests comparten el cache del modulo, reusan el msgId y se descartan solos.
    leerEstado: async (k) => _kv.get(k) ?? null,
    escribirEstado: (k, v) => _kv.set(k, v),

    locks: new Map(),
    parseInbound: () => ({
      ok: true,
      from: '56911112222',
      text: 'Quiero cotizar una corredera [Ref:landing-gclid-test]',
      msgId: 'wamid.LANDING.GCLID',
      type: 'text',
    }),
    parseLandingRef: () => ({
      hasRef: true,
      leadId: 'landing-gclid-test',
      cleanText: 'Quiero cotizar una corredera',
    }),
    sendWhatsAppText: async () => ({ ok: true }),
    generatePdf: async () => Buffer.from('%PDF-1.4 fake'),
    uploadWaDocument: async () => 'media-landing-test',
    sendWaDocument: async () => ({ ok: true, msgId: 'sent-landing-test' }),
    upsertZohoDeal: async () => null,
    loadSession: async () => null,
    persistSession: () => {},
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({ ok: true }),
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async (payload) => {
        quoteEvents.push(payload);
        return { ok: true };
      },
    },
    handleTurn: async ({ userText, state, toolCtx }) => {
      const result = await toolCtx.generarPdf({
        name: 'Ana',
        comuna: 'Temuco',
        items: [{
          producto_label: 'Corredera SLIDING H80',
          measures: '1200x1000',
          color: 'blanco',
          qty: 1,
          unit_price: 324573,
        }],
      });
      return {
        reply: result.message,
        history: [{ role: 'user', content: userText }, { role: 'assistant', content: result.message }],
        toolCalls: [{ name: 'generar_pdf_cotizacion', result }],
        state: { ...state },
      };
    },
  };
}

test('un gclid recuperado desde landing llega al pushQuoteEvent sent', async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.DASHBOARD_API_KEY;
  const originalSalesOsUrl = process.env.SALES_OS_URL;
  const originalOperatorToken = process.env.SALES_OS_OPERATOR_TOKEN;
  const quoteEvents = [];

  process.env.DASHBOARD_API_KEY = 'test-dashboard-key';
  process.env.SALES_OS_URL = 'https://sales-os.test';
  process.env.SALES_OS_OPERATOR_TOKEN = 'test-operator-token';
  global.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/api/lead-event/ref/landing-gclid-test')) {
      return {
        ok: true,
        json: async () => ({ ok: true, lead: {
          gclid: 'gclid-from-landing',
          ad_id: 'ad-from-landing',
        } }),
      };
    }
    if (target.includes('/internal/quotes/next-number')) {
      return { ok: true, json: async () => ({ quote_number: 'CM-FR-004-2026-0199' }) };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  };

  try {
    await handleWebhook({ body: {} }, makeRes(), makeDeps(quoteEvents));
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.DASHBOARD_API_KEY;
    else process.env.DASHBOARD_API_KEY = originalApiKey;
    if (originalSalesOsUrl === undefined) delete process.env.SALES_OS_URL;
    else process.env.SALES_OS_URL = originalSalesOsUrl;
    if (originalOperatorToken === undefined) delete process.env.SALES_OS_OPERATOR_TOKEN;
    else process.env.SALES_OS_OPERATOR_TOKEN = originalOperatorToken;
  }

  const sent = quoteEvents.find((event) => event.status === 'sent');
  assert.ok(sent, 'debe emitir el quote-event sent');
  assert.equal(sent.gclid, 'gclid-from-landing');
  assert.equal(sent.ad_id, 'ad-from-landing');
  assert.equal(sent.lead.gclid, 'gclid-from-landing');
  assert.equal(sent.lead.ad_id, 'ad-from-landing');
  assert.equal(sent.payload.gclid, 'gclid-from-landing');
  assert.equal(sent.payload.ad_id, 'ad-from-landing');
});

test('saveLead recibe todos los identificadores recuperados desde landing', async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.DASHBOARD_API_KEY;
  const leadEvents = [];
  let turnState;

  process.env.DASHBOARD_API_KEY = 'test-dashboard-key';
  global.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/api/lead-event/ref/landing-gclid-test')) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          lead: {
            ctwa_clid: 'ctwa-from-landing',
            ad_id: 'ad-from-landing',
            gclid: 'gclid-from-landing',
            fbclid: 'fbclid-from-landing',
            ttclid: 'ttclid-from-landing',
          },
        }),
      };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  };

  const deps = makeDeps([]);
  deps.bridge.pushLeadEvent = async (payload) => {
    leadEvents.push(payload);
    return { ok: true };
  };
  deps.handleTurn = async ({ state, toolCtx }) => {
    turnState = state;
    await toolCtx.saveLead({ name: 'Ana' });
    return { reply: 'Listo', history: [], toolCalls: [], state: {} };
  };

  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.DASHBOARD_API_KEY;
    else process.env.DASHBOARD_API_KEY = originalApiKey;
  }

  const saved = leadEvents.find((event) => event.metadata?.source === 'oliver_gpt');
  assert.ok(saved, 'saveLead debe emitir su propio lead-event');
  assert.equal(saved.ctwa_clid, 'ctwa-from-landing');
  assert.equal(saved.ad_id, 'ad-from-landing');
  assert.equal(saved.gclid, 'gclid-from-landing');
  assert.equal(saved.fbclid, 'fbclid-from-landing');
  assert.equal(saved.ttclid, 'ttclid-from-landing');
  assert.equal(saved.landing_ref, 'landing-gclid-test');
  assert.equal(turnState.gclid, 'gclid-from-landing');
  assert.equal(deps.conv.get('56911112222').state.gclid, 'gclid-from-landing');
  assert.equal(deps.conv.get('56911112222').state.landing_lead_id, 'landing-gclid-test');
  assert.equal(deps.conv.get('56911112222').state.landingRefCaptured, true);
});

test('una salida temprana de escalacion espera la atribucion antes de persistir state', async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.DASHBOARD_API_KEY;
  let releaseContextFetch;

  process.env.DASHBOARD_API_KEY = 'test-dashboard-key';
  global.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/api/lead-event/ref/landing-gclid-test')) {
      return new Promise((resolve) => {
        releaseContextFetch = () => resolve({
          ok: true,
          json: async () => ({ ok: true, lead: { gclid: 'gclid-before-early-return' } }),
        });
      });
    }
    return { ok: true, json: async () => ({ ok: true }) };
  };

  const deps = makeDeps([]);
  deps.parseInbound = () => ({
    ok: true,
    from: '56911112222',
    text: 'Quiero hablar con un humano [Ref:landing-gclid-test]',
    msgId: 'wamid.LANDING.ESCALATION',
    type: 'text',
  });
  deps.parseLandingRef = () => ({
    hasRef: true,
    leadId: 'landing-gclid-test',
    cleanText: 'Quiero hablar con un humano',
  });
  deps.sendEscalationTemplate = async () => ({ ok: true });
  deps.handleTurn = async () => {
    throw new Error('la escalacion no debe llegar al cerebro');
  };

  try {
    const processing = handleWebhook({ body: {} }, makeRes(), deps);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(typeof releaseContextFetch, 'function');
    releaseContextFetch();
    await processing;
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.DASHBOARD_API_KEY;
    else process.env.DASHBOARD_API_KEY = originalApiKey;
  }

  assert.equal(deps.conv.get('56911112222').state.gclid, 'gclid-before-early-return');
  assert.equal(deps.conv.get('56911112222').state.landingRefCaptured, true);
});

// ── [Ronda 2 2026-07-20] Re-atribución: un cliente ANTIGUO que vuelve clickeando OTRO
// anuncio refresca ctwa_clid/ad_id (antes ctwaCaptured congelaba el click viejo para
// siempre — hallazgo high de la revisión cruzada Codex). El saludo frío JAMÁS sale
// (history no vacío). El lead se re-ingesta para que sales-os actualice por COALESCE.
test('Ronda 2: referral NUEVO refresca atribución de cliente antiguo sin re-saludar', async () => {
  const persisted = [];
  const leadEvents = [];
  const _kv = new Map();
  const deps = {
    conv: new Map(), seen: new Set(), locks: new Map(),
    // [2026-08-08] Estado persistente falso y propio de cada test: el dedupe ahora se
    // respalda en Postgres para que un redeploy no deje pasar un reintento de Meta. Sin
    // esto los tests comparten el cache del modulo, reusan el msgId y se descartan solos.
    leerEstado: async (k) => _kv.get(k) ?? null,
    escribirEstado: (k, v) => _kv.set(k, v),

    parseInbound: () => ({ ok: true, from: '56933334444', text: 'vengo del otro anuncio', msgId: 'wamid.CTWA.NEW', type: 'text' }),
    parseLandingRef: () => ({ hasRef: false }),
    parseReferral: () => ({ isCtwaAd: true, ctwaClid: 'CLID_NUEVO', adId: 'AD_NUEVO', headline: '' }),
    saludoForReferral: () => ({ angle: 'fabrica', saludo: 'SALUDO_QUE_NO_DEBE_SALIR' }),
    sendWhatsAppText: async () => ({ ok: true }),
    loadSession: async () => ({
      history: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'hola, soy Oliver' }],
      state: { ctwaCaptured: true, ctwa_clid: 'CLID_VIEJO', ad_id: 'AD_VIEJO' },
    }),
    persistSession: (fromArg, session) => { persisted.push(session); },
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({ ok: true }),
      pushLeadEvent: async (p) => { leadEvents.push(p); return { ok: true }; },
      pushQuoteEvent: async () => ({ ok: true }),
    },
    handleTurn: async ({ history, userText, state }) => ({
      reply: 'sigo con tu cotización',
      history: [...history, { role: 'user', content: userText }, { role: 'assistant', content: 'ok' }],
      toolCalls: [],
      state: { ...state },
    }),
  };
  const body = { entry: [{ changes: [{ value: { messages: [{ from: '56933334444', id: 'wamid.CTWA.NEW', type: 'text', text: { body: 'vengo del otro anuncio' } }] } }] }] };

  await handleWebhook({ body }, makeRes(), deps);

  const last = persisted[persisted.length - 1];
  assert.ok(last, 'la sesión debe persistirse al final del turno');
  assert.equal(last.state.ctwa_clid, 'CLID_NUEVO', 'el click nuevo debe pisar al viejo');
  assert.equal(String(last.state.ad_id), 'AD_NUEVO');
  assert.ok(leadEvents.length >= 1, 'el lead debe re-ingestarse con el click nuevo');
  assert.ok(!JSON.stringify(last.history).includes('SALUDO_QUE_NO_DEBE_SALIR'),
    'un cliente con historial NUNCA recibe el saludo frío del anuncio');
});

// [Ronda 2.1 — Codex] Re-atribución PARCIAL: un referral con SOLO ad_id nuevo (sin
// ctwa_clid) NO debe pisar un ctwa_clid bueno con null (regresión bloqueante reproducida
// por la revisión cruzada sobre la primera versión de la Ronda 2).
test('Ronda 2.1: referral con solo ad_id nuevo conserva el ctwa_clid previo', async () => {
  const persisted = [];
  const _kv = new Map();
  const deps = {
    conv: new Map(), seen: new Set(), locks: new Map(),
    // [2026-08-08] Estado persistente falso y propio de cada test: el dedupe ahora se
    // respalda en Postgres para que un redeploy no deje pasar un reintento de Meta. Sin
    // esto los tests comparten el cache del modulo, reusan el msgId y se descartan solos.
    leerEstado: async (k) => _kv.get(k) ?? null,
    escribirEstado: (k, v) => _kv.set(k, v),

    parseInbound: () => ({ ok: true, from: '56955556666', text: 'hola de nuevo', msgId: 'wamid.CTWA.PARTIAL', type: 'text' }),
    parseLandingRef: () => ({ hasRef: false }),
    parseReferral: () => ({ isCtwaAd: true, ctwaClid: null, adId: 'AD_NUEVO', headline: '' }),
    sendWhatsAppText: async () => ({ ok: true }),
    loadSession: async () => ({
      history: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'hola!' }],
      state: { ctwaCaptured: true, ctwa_clid: 'CLID_BUENO', ad_id: 'AD_VIEJO' },
    }),
    persistSession: (fromArg, session) => { persisted.push(session); },
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({ ok: true }),
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async () => ({ ok: true }),
    },
    handleTurn: async ({ history, userText, state }) => ({
      reply: 'ok', history: [...history, { role: 'user', content: userText }], toolCalls: [], state: { ...state },
    }),
  };
  const body = { entry: [{ changes: [{ value: { messages: [{ from: '56955556666', id: 'wamid.CTWA.PARTIAL', type: 'text', text: { body: 'hola de nuevo' } }] } }] }] };

  await handleWebhook({ body }, makeRes(), deps);

  const last = persisted[persisted.length - 1];
  assert.ok(last, 'la sesión debe persistirse');
  assert.equal(last.state.ctwa_clid, 'CLID_BUENO', 'el clid bueno JAMÁS se pisa con null');
  assert.equal(String(last.state.ad_id), 'AD_NUEVO', 'el ad_id nuevo sí se actualiza');
});
