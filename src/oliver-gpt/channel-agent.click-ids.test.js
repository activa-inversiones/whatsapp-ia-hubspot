import { after, test } from 'node:test';
import assert from 'node:assert/strict';

const originalSetInterval = global.setInterval;
const originalSetTimeout = global.setTimeout;
const importIntervals = [];
const turnTimeouts = [];

after(() => {
  global.setTimeout = originalSetTimeout;
  for (const interval of importIntervals) clearInterval(interval);
  for (const timeout of turnTimeouts) clearTimeout(timeout);
});

global.setInterval = (...args) => {
  const interval = originalSetInterval(...args);
  importIntervals.push(interval);
  return interval;
};

global.setTimeout = (...args) => {
  const timeout = originalSetTimeout(...args);
  turnTimeouts.push(timeout);
  return timeout;
};

let handleChannelTurn;
try {
  ({ handleChannelTurn } = await import('./channel-agent.js'));
} finally {
  global.setInterval = originalSetInterval;
}

test('saveLead de IG/FB conserva click-ids hidratados aunque el cerebro devuelva state vacío', async () => {
  const leadEvents = [];
  const persisted = [];
  const attribution = {
    ctwa_clid: 'ctwa-channel',
    ad_id: 'ad-channel',
    gclid: 'gclid-channel',
    fbclid: 'fbclid-channel',
    ttclid: 'ttclid-channel',
    landing_lead_id: 'landing-channel',
  };
  const deps = {
    conv: new Map(),
    seen: new Set(),
    locks: new Map(),
    loadSession: async () => ({ history: [], state: attribution }),
    persistSession: (key, session) => persisted.push({ key, session }),
    sendWhatsAppText: async () => ({ ok: true }),
    notifyHighValue: async () => ({ ok: true }),
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({ ok: true }),
      pushLeadEvent: async (payload) => {
        leadEvents.push(payload);
        return { ok: true };
      },
      pushQuoteEvent: async () => ({ ok: true }),
    },
    handleTurn: async ({ toolCtx }) => {
      await toolCtx.saveLead({ name: 'Ana' });
      return { reply: 'Listo', history: [], toolCalls: [], state: {} };
    },
  };

  const result = await handleChannelTurn({
    channel: 'instagram',
    senderId: 'IG_CLICK_IDS',
    text: 'Quiero cotizar',
    msgId: 'ig-click-ids-1',
    sendFn: async () => ({ ok: true }),
  }, deps);

  assert.equal(result.ok, true);
  assert.equal(leadEvents.length, 1);
  assert.equal(leadEvents[0].ctwa_clid, attribution.ctwa_clid);
  assert.equal(leadEvents[0].ad_id, attribution.ad_id);
  assert.equal(leadEvents[0].gclid, attribution.gclid);
  assert.equal(leadEvents[0].fbclid, attribution.fbclid);
  assert.equal(leadEvents[0].ttclid, attribution.ttclid);
  assert.equal(leadEvents[0].landing_ref, attribution.landing_lead_id);
  assert.equal(persisted.at(-1).session.state.gclid, attribution.gclid);
  assert.equal(persisted.at(-1).session.state.landing_lead_id, attribution.landing_lead_id);
});

test('pushQuoteEvent de IG/FB incluye ad_id y landing_ref hidratados', async () => {
  const originalFetch = global.fetch;
  const originalSalesOsUrl = process.env.SALES_OS_URL;
  const originalOperatorToken = process.env.SALES_OS_OPERATOR_TOKEN;
  const quoteEvents = [];
  const attribution = { ad_id: 'ad-channel-quote', landing_lead_id: 'landing-channel-quote' };

  process.env.SALES_OS_URL = 'https://sales-os.test';
  process.env.SALES_OS_OPERATOR_TOKEN = 'test-operator-token';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ quote_number: 'CM-FR-004-2026-0299' }),
  });

  const deps = {
    conv: new Map(),
    seen: new Set(),
    locks: new Map(),
    loadSession: async () => ({ history: [], state: attribution }),
    persistSession: () => {},
    sendWhatsAppText: async () => ({ ok: true }),
    notifyHighValue: async () => ({ ok: true }),
    generatePdf: async () => Buffer.from('%PDF-1.4 fake'),
    sendChannelDocument: async () => ({ ok: true, messageId: 'channel-doc-1' }),
    upsertZohoDeal: async () => null,
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({ ok: true }),
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async (payload) => {
        quoteEvents.push(payload);
        return { ok: true };
      },
    },
    handleTurn: async ({ toolCtx }) => {
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
        history: [],
        toolCalls: [{ name: 'generar_pdf_cotizacion', result }],
        state: {},
      };
    },
  };

  try {
    await handleChannelTurn({
      channel: 'instagram',
      senderId: 'IG_QUOTE_CLICK_IDS',
      text: 'Quiero cotizar',
      msgId: 'ig-quote-click-ids-1',
      sendFn: async () => ({ ok: true }),
    }, deps);
  } finally {
    global.fetch = originalFetch;
    if (originalSalesOsUrl === undefined) delete process.env.SALES_OS_URL;
    else process.env.SALES_OS_URL = originalSalesOsUrl;
    if (originalOperatorToken === undefined) delete process.env.SALES_OS_OPERATOR_TOKEN;
    else process.env.SALES_OS_OPERATOR_TOKEN = originalOperatorToken;
  }

  const sent = quoteEvents.find((event) => event.status === 'sent');
  assert.ok(sent);
  assert.equal(sent.ad_id, attribution.ad_id);
  assert.equal(sent.landing_ref, attribution.landing_lead_id);
  assert.equal(sent.lead.ad_id, attribution.ad_id);
  assert.equal(sent.payload.landing_ref, attribution.landing_lead_id);
});
