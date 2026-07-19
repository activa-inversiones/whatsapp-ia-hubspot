import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleWebhook } from './webhook.js';

function makeRes() {
  return { sendStatus() { return this; } };
}

function makeDeps(quoteEvents) {
  return {
    conv: new Map(),
    seen: new Set(),
    locks: new Map(),
    parseInbound: () => ({
      ok: true,
      from: '56911112222',
      text: 'Quiero cotizar [Ref:landing-gclid-test]',
      msgId: 'wamid.LANDING.GCLID',
      type: 'text',
    }),
    parseLandingRef: () => ({
      hasRef: true,
      leadId: 'landing-gclid-test',
      cleanText: 'Quiero cotizar',
    }),
    sendWhatsAppText: async () => ({ ok: true }),
    generatePdf: async () => Buffer.from('%PDF-1.4 fake'),
    uploadWaDocument: async () => 'media-landing-test',
    sendWaDocument: async () => ({ ok: true, msgId: 'sent-landing-test' }),
    upsertZohoDeal: async () => null,
    archivarEnWorkDrive: async () => null,
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
