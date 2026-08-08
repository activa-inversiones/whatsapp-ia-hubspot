// webhook.test.js — Test HERMÉTICO del handler de producción de Oliver GPT.
//
// SIN RED: todas las dependencias (parseInbound, sendWhatsAppText, handleTurn,
// bridge, notifyHighValue) se INYECTAN vía el tercer argumento `deps` de
// handleWebhook. Nada toca Meta, OpenAI ni Sales-OS.
//
// Verifica el contrato fail-safe:
//   (a) responde 200 SIEMPRE, incluso si handleTurn lanza.
//   (b) dedupe ignora un message id repetido.
//   (c) si getConversationControl dice humano → NO llama handleTurn.
//   (d) llama pushConversationEvent para inbound y outbound.
//   (e) un error interno NO se propaga (fail-safe).
//
// Ejecutar desde C:\Users\mcifu\activa\temp-wa con:
//   node --test src/oliver-gpt/webhook.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleWebhook } from './webhook.js';

/* =========================================================================
 * FAKES / HELPERS
 * ========================================================================= */

// res fake: registra el status enviado y cuántas veces.
function makeRes() {
  const calls = [];
  return {
    calls,
    sentStatus: undefined,
    sendStatus(code) {
      this.sentStatus = code;
      calls.push(code);
      return this;
    },
  };
}

// req fake con un body de Meta mínimo (no se usa: parseInbound se inyecta).
function makeReq(body = { entry: [{ changes: [{ value: {} }] }] }) {
  return { body };
}

// Fabrica un set de deps inyectables con espías. Permite sobreescribir piezas.
function makeDeps(overrides = {}) {
  const spy = {
    handleTurnCalls: 0,
    sendCalls: [],
    convEvents: [],
    leadEvents: [],
    quoteEvents: [],
    notifyCalls: [],
    controlCalls: 0,
  };

  // Estado persistente falso, uno por test (mismo criterio que conv/seen).
  const _estadoTest = new Map();

  const deps = {
    // Aislamos el estado por test: cache y dedupe propios.
    conv: new Map(),
    seen: new Set(),
    // [2026-08-08] El dedupe ahora tiene respaldo en Postgres para que un redeploy no
    // deje pasar un reintento de Meta como mensaje nuevo. Acá se sustituye por un Map
    // propio: sin esto, los tests comparten el caché del módulo, reusan el mismo msgId
    // y el segundo en adelante se descarta como repetido.
    leerEstado: async (k) => _estadoTest.get(k) ?? null,
    escribirEstado: (k, v) => _estadoTest.set(k, v),

    parseInbound: (body) =>
      body?.__inbound || {
        ok: true,
        from: '56999999999',
        text: 'Hola, quiero cotizar una ventana',
        msgId: 'wamid.TEST1',
        type: 'text',
      },

    sendWhatsAppText: async (to, text) => {
      spy.sendCalls.push({ to, text });
      return { ok: true, msgId: 'sent.1' };
    },

    handleTurn: async ({ history, userText, state, toolCtx }) => {
      spy.handleTurnCalls += 1;
      spy.lastTurnArgs = { history, userText, state, toolCtx };
      return {
        reply: 'Con gusto le ayudo con su cotización.',
        history: [
          { role: 'user', content: userText },
          { role: 'assistant', content: 'Con gusto le ayudo con su cotización.' },
        ],
        toolCalls: [],
        state: { ...state },
      };
    },

    bridge: {
      getConversationControl: async () => {
        spy.controlCalls += 1;
        return { ai_paused: false, operator_status: 'ai' };
      },
      pushConversationEvent: async (payload) => {
        spy.convEvents.push(payload);
        return { ok: true };
      },
      pushLeadEvent: async (payload) => {
        spy.leadEvents.push(payload);
        return { ok: true };
      },
      pushQuoteEvent: async (payload) => {
        spy.quoteEvents.push(payload);
        return { ok: true };
      },
    },

    notifyHighValue: async (...args) => {
      spy.notifyCalls.push(args);
      return { sent: true };
    },
  };

  // Guardar el bridge con espías por defecto ANTES de aplicar overrides,
  // para poder mezclar overrides PARCIALES de bridge sin perder los demás espías.
  const defaultBridge = deps.bridge;
  Object.assign(deps, overrides);
  if (overrides.bridge) deps.bridge = { ...defaultBridge, ...overrides.bridge };
  return { deps, spy };
}

/* =========================================================================
 * TESTS
 * ========================================================================= */

test('(a) responde 200 SIEMPRE — camino feliz', async () => {
  const { deps } = makeDeps();
  const res = makeRes();
  await handleWebhook(makeReq(), res, deps);
  assert.equal(res.sentStatus, 200, 'debe ackear con 200');
  assert.equal(res.calls.length, 1, 'debe enviar el status exactamente una vez');
});

test('(a) responde 200 incluso si handleTurn LANZA', async () => {
  const { deps, spy } = makeDeps({
    handleTurn: async () => {
      throw new Error('fallo simulado del cerebro');
    },
  });
  const res = makeRes();

  // No debe lanzar hacia afuera (fail-safe).
  await handleWebhook(makeReq(), res, deps);

  assert.equal(res.sentStatus, 200, 'el 200 se envía antes de cualquier procesamiento');
  assert.equal(spy.sendCalls.length, 0, 'si el cerebro falla, no se intenta enviar reply');
});

test('(b) dedupe — un message id repetido se ignora (no reprocesa)', async () => {
  const { deps, spy } = makeDeps();

  const req = makeReq({
    __inbound: { ok: true, from: '56911112222', text: 'hola', msgId: 'wamid.DUP', type: 'text' },
  });

  await handleWebhook(req, makeRes(), deps);
  await handleWebhook(req, makeRes(), deps); // mismo msgId

  assert.equal(spy.handleTurnCalls, 1, 'handleTurn debe ejecutarse solo en el primer inbound');
});

test('(c) takeover humano — getConversationControl dice humano → NO llama handleTurn', async () => {
  const { deps, spy } = makeDeps({
    bridge: {
      getConversationControl: async () => ({ ai_paused: true, operator_status: 'human' }),
    },
  });
  const res = makeRes();

  await handleWebhook(makeReq(), res, deps);

  assert.equal(res.sentStatus, 200, 'igual ackea 200');
  assert.equal(spy.handleTurnCalls, 0, 'con IA pausada NO debe invocar al cerebro');
  assert.equal(spy.sendCalls.length, 0, 'con IA pausada NO debe responder por WhatsApp');
  // Debe persistir el inbound para que el operador lo vea.
  assert.equal(spy.convEvents.length, 1, 'debe persistir el inbound durante el takeover');
  assert.equal(spy.convEvents[0].direction, 'inbound');
  assert.equal(spy.convEvents[0].metadata.ai_paused, true);
});

test('(d) persiste pushConversationEvent para inbound Y outbound', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook(makeReq(), makeRes(), deps);

  const dirs = spy.convEvents.map((e) => e.direction);
  assert.ok(dirs.includes('inbound'), 'debe registrar el evento inbound');
  assert.ok(dirs.includes('outbound'), 'debe registrar el evento outbound');

  const outbound = spy.convEvents.find((e) => e.direction === 'outbound');
  assert.equal(outbound.actor_type, 'ai', 'el outbound es de la IA');
  assert.equal(outbound.body, 'Con gusto le ayudo con su cotización.');
});

test('(e) error interno NO se propaga — bridge.getConversationControl LANZA', async () => {
  const { deps, spy } = makeDeps({
    bridge: {
      getConversationControl: async () => {
        throw new Error('Sales-OS caído');
      },
    },
  });
  const res = makeRes();

  // No debe lanzar; el control que falla cae a default seguro (ai sigue).
  await handleWebhook(makeReq(), res, deps);

  assert.equal(res.sentStatus, 200, 'fail-safe: 200 igual');
  assert.equal(spy.handleTurnCalls, 1, 'default seguro: ante fallo del control, la IA sigue');
});

test('(e) error interno NO se propaga — pushConversationEvent LANZA', async () => {
  const { deps, spy } = makeDeps({
    bridge: {
      pushConversationEvent: async () => {
        throw new Error('ingest caído');
      },
    },
  });
  const res = makeRes();

  await handleWebhook(makeReq(), res, deps);

  assert.equal(res.sentStatus, 200, 'fail-safe: la persistencia rota no tumba el turno');
  // El reply igual se envió pese a que la persistencia falla.
  assert.equal(spy.sendCalls.length, 1, 'el WhatsApp se envía aunque falle el ingest');
});

test('quote — si hay cotización en toolCalls dispara pushQuoteEvent', async () => {
  const { deps, spy } = makeDeps({
    handleTurn: async ({ userText, state }) => ({
      reply: 'Su cotización es $321.593 + IVA.',
      history: [
        { role: 'user', content: userText },
        { role: 'assistant', content: 'Su cotización es $321.593 + IVA.' },
      ],
      toolCalls: [
        { name: 'calcular_cotizacion', input: {}, result: { ok: true, total: 321593 } },
      ],
      state: { ...state },
    }),
  });

  await handleWebhook(makeReq(), makeRes(), deps);

  assert.equal(spy.quoteEvents.length, 1, 'debe registrar la cotización');
  assert.equal(spy.quoteEvents[0].amount_total, 321593);
  assert.equal(spy.quoteEvents[0].currency, 'CLP');
  // [2026-07-11 FIX lead_id NULL] pushQuoteEvent debe incluir lead:{...} con phone poblado
  // (sales-os upsertQuote solo fija lead_id si payload.lead viene poblado; sin esto el JOIN
  // quotes→leads queda roto y la atribución de ads se pierde).
  assert.ok(spy.quoteEvents[0].lead, 'el quote-event debe incluir lead:{...}');
  assert.equal(spy.quoteEvents[0].lead.phone, '56999999999');
  assert.equal(spy.quoteEvents[0].lead.channel, 'whatsapp');
});

test('generarPdf (status sent) — pushQuoteEvent incluye lead:{...} con phone', async () => {
  const origFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/internal/quotes/next-number')) {
      return { ok: true, json: async () => ({ quote_number: 'CM-FR-004-2026-0099' }) };
    }
    return { ok: false, json: async () => ({}) };
  };

  const { deps, spy } = makeDeps({
    generatePdf: async () => Buffer.from('%PDF-1.4 fake'),
    uploadWaDocument: async () => 'media-1',
    sendWaDocument: async () => ({ ok: true, msgId: 'sent-1' }),
    upsertZohoDeal: async () => 'deal-1',
    addZohoNote: async () => {},
    attachPdfToDeal: async () => {},
    handleTurn: async ({ userText, state, toolCtx }) => {
      const r = await toolCtx.generarPdf({
        name: 'Marcelo', comuna: 'Temuco',
        items: [{ producto_label: 'Corredera SLIDING H80', measures: '1200x1000', color: 'blanco', qty: 1, unit_price: 324573 }],
      });
      return {
        reply: r.message,
        history: [{ role: 'user', content: userText }, { role: 'assistant', content: r.message }],
        toolCalls: [{ name: 'generar_pdf_cotizacion' }],
        state: { ...state },
      };
    },
  });

  try {
    await handleWebhook(makeReq(), makeRes(), deps);
  } finally {
    global.fetch = origFetch;
  }

  assert.equal(spy.quoteEvents.length, 1, 'debe registrar la cotización (status sent)');
  assert.equal(spy.quoteEvents[0].status, 'sent');
  const lead = spy.quoteEvents[0].lead;
  // [2026-07-11 FIX lead_id NULL] este era el call site roto en producción: pushQuoteEvent con
  // 'sent' se disparaba SIN lead:{...} → sales-os no podía resolver lead_id (JOIN quotes→leads roto).
  assert.ok(lead, 'el quote-event (sent) debe incluir lead:{...}');
  assert.equal(lead.phone, '56999999999');
  assert.equal(lead.name, 'Marcelo');
  assert.equal(lead.comuna, 'Temuco');
  assert.equal(lead.channel, 'whatsapp');
});

test('toolCtx cableado — saveLead/notifyMarcelo/persistSession son funciones', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook(makeReq(), makeRes(), deps);

  const ctx = spy.lastTurnArgs.toolCtx;
  assert.equal(typeof ctx.saveLead, 'function', 'saveLead cableado');
  assert.equal(typeof ctx.notifyMarcelo, 'function', 'notifyMarcelo cableado');
  assert.equal(typeof ctx.persistSession, 'function', 'persistSession cableado');
  assert.equal(ctx.telefono, '56999999999', 'telefono en toolCtx');

  // saveLead → pushLeadEvent real (vía bridge fake).
  await ctx.saveLead({ name: 'Ana', comuna: 'Temuco' });
  assert.equal(spy.leadEvents.length, 1, 'saveLead debe invocar pushLeadEvent');
  assert.equal(spy.leadEvents[0].name, 'Ana');

  // notifyMarcelo → notifyHighValue real (vía fake), con sendWhatsAppText como waSendFn.
  await ctx.notifyMarcelo({ reason: 'test' });
  assert.equal(spy.notifyCalls.length, 1, 'notifyMarcelo debe invocar notifyHighValue');
  assert.equal(typeof spy.notifyCalls[0][0], 'function', 'primer arg es waSendFn');
  assert.equal(spy.notifyCalls[0][1], '56999999999', 'segundo arg es el teléfono');
});

test('historial — el cache in-memory se reusa entre turnos del mismo from', async () => {
  const { deps, spy } = makeDeps();

  const req1 = makeReq({
    __inbound: { ok: true, from: '56933334444', text: 'primero', msgId: 'm1', type: 'text' },
  });
  const req2 = makeReq({
    __inbound: { ok: true, from: '56933334444', text: 'segundo', msgId: 'm2', type: 'text' },
  });

  await handleWebhook(req1, makeRes(), deps);
  await handleWebhook(req2, makeRes(), deps);

  // En el segundo turno, handleTurn recibe el history acumulado del primero.
  assert.ok(
    spy.lastTurnArgs.history.length >= 2,
    'el segundo turno debe recibir el historial previo desde el cache'
  );
});

test('inbound no válido — parseInbound ok:false → no procesa ni responde', async () => {
  const { deps, spy } = makeDeps({
    parseInbound: () => ({ ok: false }),
  });
  const res = makeRes();

  await handleWebhook(makeReq(), res, deps);

  assert.equal(res.sentStatus, 200, 'igual ackea a Meta');
  assert.equal(spy.handleTurnCalls, 0, 'no hay mensaje → no invoca al cerebro');
  assert.equal(spy.convEvents.length, 0, 'no persiste nada');
});

// ── Anti-repetición ───────────────────────────────────────────────────────
// [2026-08-08] Auditoría del módulo Oliver: en 60 días mandó el mensaje IDÉNTICO al
// anterior 73 veces a 26 clientes (2% de los envíos). El peor repitió "Aquí estoy cuando
// me necesite. 👍" ocho veces seguidas a alguien cuyo dictado por voz llegaba como ruido.
// La REGLA #12 del prompt se cumplía al pie de la letra y el resultado era absurdo.
test('no manda dos veces seguidas la misma respuesta', async () => {
  const { deps, spy } = makeDeps();
  // conv compartido entre los dos turnos: el estado del cliente tiene que persistir.
  deps.handleTurn = async () => ({ reply: 'Aquí estoy cuando me necesite. 👍', state: {}, history: [] });

  // Turno 1: el cliente escribe, Oliver responde.
  deps.parseInbound = () => ({ ok: true, from: '56941373454', text: 'Chao. Yo. No.', msgId: 'wamid.R1', type: 'text' });
  await handleWebhook(makeReq(), makeRes(), deps);
  const tras1 = spy.sendCalls.length;
  assert.equal(tras1, 1, 'la primera respuesta sí se manda');

  // Turno 2: el cliente manda más ruido y el cerebro devuelve LO MISMO.
  deps.parseInbound = () => ({ ok: true, from: '56941373454', text: 'Yo. No. Nasa.', msgId: 'wamid.R2', type: 'text' });
  await handleWebhook(makeReq(), makeRes(), deps);
  assert.equal(spy.sendCalls.length, tras1, 'la repetición NO se manda');
});

test('sí manda una respuesta distinta al turno siguiente', async () => {
  // El freno corta repeticiones, no la conversación.
  const { deps, spy } = makeDeps();
  let n = 0;
  deps.handleTurn = async () => ({ reply: n++ === 0 ? 'Primera' : 'Segunda, distinta', state: {}, history: [] });

  deps.parseInbound = () => ({ ok: true, from: '56941373455', text: 'hola', msgId: 'wamid.D1', type: 'text' });
  await handleWebhook(makeReq(), makeRes(), deps);
  deps.parseInbound = () => ({ ok: true, from: '56941373455', text: 'y cuánto sale', msgId: 'wamid.D2', type: 'text' });
  await handleWebhook(makeReq(), makeRes(), deps);

  assert.equal(spy.sendCalls.length, 2, 'dos respuestas distintas se mandan las dos');
});
