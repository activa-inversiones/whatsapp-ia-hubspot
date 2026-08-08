// webhook.escalation.test.js — Golden de la ESCALACIÓN DETERMINISTA en WhatsApp.
// [2026-06-18] Paridad con channel-agent.js (IG/FB). La escalación es plata/reputación:
// NO depende del LLM (en prod a veces no avisaba o escribía 'notificar_marcelo' como texto).
// Test HERMÉTICO: todas las deps inyectadas, nada toca Meta/OpenAI/Sales-OS.
//   node --test src/oliver-gpt/webhook.escalation.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook } from './webhook.js';


function makeRes() { return { sentStatus: undefined, sendStatus(c) { this.sentStatus = c; return this; } }; }
function makeReq(text) {
  return { body: { __inbound: { ok: true, from: '56988887777', text, msgId: 'wamid.ESC.' + Math.random().toString(36).slice(2), type: 'text' } } };
}
function makeDeps(overrides = {}) {
  // Uno por test: compartido, los tests reusan el msgId y se descartarian entre si.
  const _kv = new Map();
  const spy = { handleTurnCalls: 0, sendCalls: [], notifyCalls: [], convEvents: [], templateCalls: [] };
  const deps = {
    conv: new Map(), seen: new Set(),
    // [2026-08-08] Estado persistente falso y propio de cada test: el dedupe ahora se
    // respalda en Postgres para que un redeploy no deje pasar un reintento de Meta. Sin
    // esto los tests comparten el cache del modulo, reusan el msgId y se descartan solos.
    leerEstado: async (k) => _kv.get(k) ?? null,
    escribirEstado: (k, v) => _kv.set(k, v),

    parseInbound: (body) => body.__inbound,
    sendWhatsAppText: async (to, text) => { spy.sendCalls.push({ to, text }); return { ok: true }; },
    handleTurn: async ({ state }) => { spy.handleTurnCalls += 1; return { reply: 'cotizando…', history: [], toolCalls: [], state }; },
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async (p) => { spy.convEvents.push(p); return { ok: true }; },
      pushLeadEvent: async () => ({ ok: true }), pushQuoteEvent: async () => ({ ok: true }),
    },
    notifyHighValue: async (...a) => { spy.notifyCalls.push(a); return { sent: true }; },
    sendEscalationTemplate: async (...a) => { spy.templateCalls.push(a); return { ok: true }; },
    loadSession: async () => null,
    persistSession: () => {},
  };
  Object.assign(deps, overrides);
  return { deps, spy };
}

test('escalación: "quiero hablar con un humano" → escala y NO pasa por el LLM', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook(makeReq('Quiero hablar con un humano'), makeRes(), deps);
  assert.equal(spy.handleTurnCalls, 0, 'NO debe llamar al cerebro (LLM) al escalar');
  assert.equal(spy.notifyCalls.length, 1, 'debe avisar al dueño (notifyHighValue)');
  assert.equal(spy.templateCalls.length, 1, 'debe disparar la plantilla garantizada');
  assert.ok(spy.sendCalls.some(c => /\+56 9 5729 6035/.test(c.text)), 'debe enviar el mensaje con el WhatsApp directo de Marcelo');
  assert.ok(spy.convEvents.some(e => e.metadata && e.metadata.escalation === true), 'debe persistir marcado escalation:true');
});

test('escalación: cliente molesto ("estoy muy enojado") → escala', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook(makeReq('estoy muy enojado con la atención'), makeRes(), deps);
  assert.equal(spy.handleTurnCalls, 0, 'no pasa por el LLM');
  assert.equal(spy.notifyCalls.length, 1, 'avisa al dueño');
});

test('escalación: "pásame con Marcelo" → escala', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook(makeReq('pásame con Marcelo por favor'), makeRes(), deps);
  assert.equal(spy.notifyCalls.length, 1);
});

test('NO escala: cliente normal ("quiero cotizar una ventana") → pasa al cerebro', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook(makeReq('Hola, quiero cotizar una ventana de PVC'), makeRes(), deps);
  assert.equal(spy.handleTurnCalls, 1, 'debe llamar al cerebro normalmente');
  assert.equal(spy.notifyCalls.length, 0, 'NO debe escalar una consulta normal');
});

test('NO escala: agradecimiento ("muchas gracias") → flujo normal', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook(makeReq('perfecto, muchas gracias'), makeRes(), deps);
  assert.equal(spy.handleTurnCalls, 1);
  assert.equal(spy.notifyCalls.length, 0);
});
