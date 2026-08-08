// webhook.voice.test.js — Golden tests HERMÉTICOS para el porteo F4 (voz saliente).
//
// SIN RED: TTS, upload y envío de audio se inyectan como fakes.
// Verifican:
//   (v1) inbound audio + VOICE habilitado → sintetiza + sube + envía nota de voz.
//   (v2) inbound texto → NO sintetiza (shouldSendVoice retorna false).
//   (v3) inbound audio pero shouldSendVoice retorna false → NO sintetiza.
//   (v4) TTS falla (synthesizeVoiceBuffer lanza) → no tumba el turno, texto ya enviado.
//   (v5) TTS devuelve null (sin proveedor) → no sube ni envía, sin error.
//
// Ejecutar:
//   node --test src/oliver-gpt/webhook.voice.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleWebhook } from './webhook.js';


/* =========================================================================
 * HELPERS
 * ========================================================================= */

function makeRes() {
  const r = { sentStatus: undefined, calls: [] };
  r.sendStatus = (code) => { r.sentStatus = code; r.calls.push(code); };
  return r;
}

function makeReq(body = {}) { return { body }; }

/**
 * Fábrica de deps inyectables con mínimo necesario para cada test.
 * @param {object} overrides
 */
function makeDeps(overrides = {}) {
  // Uno por test: si fuera de módulo, los tests de este archivo comparten el msgId y a
  // partir del segundo el handler los descartaría como repetidos.
  const _kv = new Map();
  const spy = {
    sendTextCalls: [],
    synthesizeCalls: [],
    uploadCalls: [],
    sendAudioCalls: [],
    handleTurnCalls: 0,
    convEvents: [],
  };

  const deps = {
    conv: new Map(),
    seen: new Set(),
    // [2026-08-08] Estado persistente falso y propio de cada test: el dedupe ahora se
    // respalda en Postgres para que un redeploy no deje pasar un reintento de Meta. Sin
    // esto los tests comparten el cache del modulo, reusan el msgId y se descartan solos.
    leerEstado: async (k) => _kv.get(k) ?? null,
    escribirEstado: (k, v) => _kv.set(k, v),


    parseInbound: (body) =>
      body?.__inbound || {
        ok: true,
        from: '56999000001',
        text: '[audio]',
        msgId: 'wamid.VOICE1',
        type: 'audio',  // inbound audio por defecto
      },

    sendWhatsAppText: async (to, text) => {
      spy.sendTextCalls.push({ to, text });
      return { ok: true };
    },

    // Voz: inyectables individuales
    shouldSendVoice: (_text, _session, opts) => opts?.incomingType === 'audio',

    synthesizeVoiceBuffer: async ({ text, waId }) => {
      spy.synthesizeCalls.push({ text, waId });
      return { buffer: Buffer.from('FAKE_OGG'), mime: 'audio/ogg', filename: 'reply.ogg' };
    },

    uploadWaAudio: async (buf, mime, filename) => {
      spy.uploadCalls.push({ bytes: buf.length, mime, filename });
      return 'media_id_fake_001';
    },

    sendWaAudio: async (to, mediaId, asVoice) => {
      spy.sendAudioCalls.push({ to, mediaId, asVoice });
    },

    handleTurn: async ({ userText, state }) => {
      spy.handleTurnCalls += 1;
      return {
        reply: 'Hola, soy Oliver. Le ayudo con su cotización.',
        history: [{ role: 'user', content: userText }],
        toolCalls: [],
        state: { ...state },
      };
    },

    bridge: {
      getConversationControl: async () => ({ ai_paused: false }),
      pushConversationEvent: async (e) => { spy.convEvents.push(e); return { ok: true }; },
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async () => ({ ok: true }),
    },

    notifyHighValue: async () => ({ sent: true }),
  };

  // overrides parciales de bridge
  const defaultBridge = deps.bridge;
  Object.assign(deps, overrides);
  if (overrides.bridge) deps.bridge = { ...defaultBridge, ...overrides.bridge };

  return { deps, spy };
}

/* =========================================================================
 * TESTS
 * ========================================================================= */

test('(v1) inbound audio + voice habilitado → sintetiza + sube + envía nota de voz', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook(makeReq(), makeRes(), deps);

  assert.equal(spy.handleTurnCalls, 1, 'handleTurn debe ejecutarse');
  assert.equal(spy.sendTextCalls.length, 1, 'debe enviar texto primero');
  assert.equal(spy.synthesizeCalls.length, 1, 'debe sintetizar la respuesta');
  assert.equal(spy.uploadCalls.length, 1, 'debe subir el audio a WhatsApp');
  assert.equal(spy.sendAudioCalls.length, 1, 'debe enviar la nota de voz');
  assert.equal(spy.sendAudioCalls[0].asVoice, true, 'debe enviarse como PTT (voice:true)');
  assert.equal(spy.sendAudioCalls[0].mediaId, 'media_id_fake_001');
});

test('(v2) inbound texto → NO sintetiza voz', async () => {
  const { deps, spy } = makeDeps({
    parseInbound: () => ({
      ok: true, from: '56999000002', text: 'Quiero cotizar', msgId: 'wamid.TEXT1', type: 'text',
    }),
  });
  await handleWebhook(makeReq(), makeRes(), deps);

  assert.equal(spy.sendTextCalls.length, 1, 'texto sí se envía');
  assert.equal(spy.synthesizeCalls.length, 0, 'NO debe sintetizar para inbound texto');
  assert.equal(spy.sendAudioCalls.length, 0, 'NO debe enviar audio');
});

test('(v3) inbound audio pero shouldSendVoice=false → NO sintetiza', async () => {
  const { deps, spy } = makeDeps({
    shouldSendVoice: () => false,  // VOICE_ENABLED=false simulado
  });
  await handleWebhook(makeReq(), makeRes(), deps);

  assert.equal(spy.sendTextCalls.length, 1, 'texto sí se envía');
  assert.equal(spy.synthesizeCalls.length, 0, 'voz deshabilitada: no debe sintetizar');
});

test('(v4) TTS lanza → no tumba el turno, texto ya enviado', async () => {
  const { deps, spy } = makeDeps({
    synthesizeVoiceBuffer: async () => { throw new Error('ElevenLabs timeout'); },
  });
  const res = makeRes();
  await handleWebhook(makeReq(), res, deps);

  assert.equal(res.sentStatus, 200, 'fail-safe: 200 enviado');
  assert.equal(spy.sendTextCalls.length, 1, 'el texto se envió antes del fallo de TTS');
  assert.equal(spy.uploadCalls.length, 0, 'no debe intentar upload si TTS falló');
});

test('(v5) TTS devuelve null (sin proveedor) → no sube ni envía audio, sin error', async () => {
  const { deps, spy } = makeDeps({
    synthesizeVoiceBuffer: async () => null,
  });
  const res = makeRes();
  await handleWebhook(makeReq(), res, deps);

  assert.equal(res.sentStatus, 200, '200 siempre');
  assert.equal(spy.sendTextCalls.length, 1, 'texto enviado');
  assert.equal(spy.uploadCalls.length, 0, 'null → no subir');
  assert.equal(spy.sendAudioCalls.length, 0, 'null → no enviar audio');
});

test('(v6) outbound event registra message_type=text+voice cuando hay voz', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook(makeReq(), makeRes(), deps);

  const outbound = spy.convEvents.find((e) => e.direction === 'outbound');
  assert.ok(outbound, 'debe existir evento outbound');
  assert.equal(outbound.message_type, 'text+voice', 'debe reflejar entrega dual');
});

test('(v7) outbound event registra message_type=text cuando es solo texto', async () => {
  const { deps, spy } = makeDeps({
    parseInbound: () => ({
      ok: true, from: '56999000003', text: 'Hola', msgId: 'wamid.TEXT2', type: 'text',
    }),
  });
  await handleWebhook(makeReq(), makeRes(), deps);

  const outbound = spy.convEvents.find((e) => e.direction === 'outbound');
  assert.equal(outbound.message_type, 'text');
});
