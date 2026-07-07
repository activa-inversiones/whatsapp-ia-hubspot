// services/reengagement.test.js — [2026-07-07 ZL-F2] Motor Zero-Leaks, carril F2.
// Tests del módulo PURO reengagement.js: flag off, candado 24h, ventana Meta
// (mensaje determinista vs plantilla), sin plantilla configurada, y bitácora.
// Runner nativo: node --test services/reengagement.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reengage,
  isWithinMetaWindow,
  isLocked,
  lock,
  buildDeterministicMessage,
} from './reengagement.js';

const NOW = Date.now();

// ── flag OFF (default) ──────────────────────────────────────────────────────
test('ZL-F2a: flag ZERO_LEAKS_REENGAGE apagado → ok:false reason:flag_off, NO envía nada', async () => {
  let sendCalled = false;
  const result = await reengage(
    { phone: '56911112222', motivo: 'ttl_vencido' },
    {
      flagOn: false,
      sendTextFn: async () => { sendCalled = true; return { ok: true }; },
      loadSessionFn: async () => ({ state: { lastMessageAt: NOW } }),
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'flag_off');
  assert.equal(sendCalled, false, 'con el flag apagado NUNCA debe llamar a sendTextFn');
});

// ── phone requerido ──────────────────────────────────────────────────────────
test('ZL-F2b: sin phone → ok:false reason:phone_requerido', async () => {
  const result = await reengage({ motivo: 'x' }, { flagOn: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'phone_requerido');
});

// ── dentro de ventana Meta (<24h) → mensaje determinista, SIN LLM ───────────
test('ZL-F2c: sesión activa <24h → envía mensaje determinista por sendTextFn', async () => {
  const sent = [];
  const lockStore = new Map();
  const result = await reengage(
    { phone: '56922223333', motivo: 'ttl_vencido', quote_number: '0099' },
    {
      flagOn: true,
      lockStore,
      loadSessionFn: async () => ({ state: { lastMessageAt: NOW - 60_000, name: 'Patricia' } }),
      sendTextFn: async (phone, body) => { sent.push({ phone, body }); return { ok: true }; },
      nowMs: NOW,
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.canal, 'mensaje_directo');
  assert.equal(sent.length, 1, 'debe llamar sendTextFn exactamente una vez');
  assert.equal(sent[0].phone, '56922223333');
  assert.match(sent[0].body, /Patricia/);
  assert.match(sent[0].body, /0099/);
  assert.equal(isLocked('56922223333', lockStore, NOW), true, 'debe marcar el candado tras enviar');
});

// ── fuera de ventana Meta (>24h) sin plantilla configurada → sin_plantilla ──
test('ZL-F2d: sesión >24h SIN REENGAGE_TEMPLATE_NAME → ok:false reason:sin_plantilla, no envía', async () => {
  let tplCalled = false;
  const result = await reengage(
    { phone: '56933334444', motivo: 'ttl_vencido' },
    {
      flagOn: true,
      templateName: '',
      loadSessionFn: async () => ({ state: { lastMessageAt: NOW - 30 * 60 * 60 * 1000 } }), // 30h atrás
      sendTemplateFn: async () => { tplCalled = true; return { ok: true }; },
      nowMs: NOW,
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'sin_plantilla');
  assert.equal(tplCalled, false);
});

// ── fuera de ventana Meta CON plantilla configurada → envía por plantilla ───
test('ZL-F2e: sesión >24h CON REENGAGE_TEMPLATE_NAME → envía por sendTemplateFn', async () => {
  const calls = [];
  const lockStore = new Map();
  const result = await reengage(
    { phone: '56944445555', motivo: 'cotizacion_enviada_24h', quote_number: '0100' },
    {
      flagOn: true,
      templateName: 'reengage_v1',
      lockStore,
      loadSessionFn: async () => ({ state: { lastMessageAt: NOW - 48 * 60 * 60 * 1000 } }),
      sendTemplateFn: async (args) => { calls.push(args); return { ok: true }; },
      nowMs: NOW,
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.canal, 'plantilla');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].templateName, 'reengage_v1');
  assert.equal(calls[0].phone, '56944445555');
});

// ── sin sesión previa (null) → se trata como ventana cerrada ────────────────
test('ZL-F2f: sin sesión (null) → trata como fuera de ventana (requiere plantilla)', async () => {
  const result = await reengage(
    { phone: '56955556666', motivo: 'x' },
    {
      flagOn: true,
      templateName: '',
      loadSessionFn: async () => null,
      nowMs: NOW,
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'sin_plantilla');
});

// ── candado 24h: segundo intento al mismo cliente dentro de 24h → bloqueado ─
test('ZL-F2g: candado 24h — segundo re-engagement al mismo cliente se bloquea', async () => {
  const lockStore = new Map();
  lock('56966667777', lockStore, NOW - 60_000); // ya se envió hace 1 min
  const result = await reengage(
    { phone: '56966667777', motivo: 'x' },
    {
      flagOn: true,
      lockStore,
      loadSessionFn: async () => ({ state: { lastMessageAt: NOW } }),
      sendTextFn: async () => ({ ok: true }),
      nowMs: NOW,
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'candado_24h');
});

// ── candado vence tras 24h → puede reintentar ───────────────────────────────
test('ZL-F2h: candado vencido (>24h) → permite un nuevo re-engagement', async () => {
  const lockStore = new Map();
  lock('56977778888', lockStore, NOW - 25 * 60 * 60 * 1000); // hace 25h
  const result = await reengage(
    { phone: '56977778888', motivo: 'x' },
    {
      flagOn: true,
      lockStore,
      loadSessionFn: async () => ({ state: { lastMessageAt: NOW } }),
      sendTextFn: async () => ({ ok: true }),
      nowMs: NOW,
    }
  );
  assert.equal(result.ok, true);
});

// ── falla de envío → ok:false con detalle, no lanza excepción ───────────────
test('ZL-F2i: sendTextFn falla → ok:false, no lanza, NO marca candado', async () => {
  const lockStore = new Map();
  let threw = false;
  let result;
  try {
    result = await reengage(
      { phone: '56988889999', motivo: 'x' },
      {
        flagOn: true,
        lockStore,
        loadSessionFn: async () => ({ state: { lastMessageAt: NOW } }),
        sendTextFn: async () => ({ ok: false, error: 'wa_api_down' }),
        nowMs: NOW,
      }
    );
  } catch { threw = true; }
  assert.equal(threw, false, 'reengage NUNCA debe lanzar');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'envio_fallo');
  assert.equal(isLocked('56988889999', lockStore, NOW), false, 'si no se envió, no se marca el candado');
});

// ── registra en la conversación tras éxito (bitácora auditable) ─────────────
test('ZL-F2j: éxito → llama pushConversationEventFn con outbound', async () => {
  const events = [];
  await reengage(
    { phone: '56999990000', motivo: 'ttl_vencido' },
    {
      flagOn: true,
      loadSessionFn: async () => ({ state: { lastMessageAt: NOW } }),
      sendTextFn: async () => ({ ok: true }),
      pushConversationEventFn: async (payload) => { events.push(payload); },
      nowMs: NOW,
    }
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].direction, 'outbound');
  assert.equal(events[0].external_id, '56999990000');
});

// ── helpers puros ────────────────────────────────────────────────────────────
test('ZL-F2k: isWithinMetaWindow — true <24h, false >24h, false sin sesión', () => {
  assert.equal(isWithinMetaWindow({ state: { lastMessageAt: NOW - 1000 } }, NOW), true);
  assert.equal(isWithinMetaWindow({ state: { lastMessageAt: NOW - 25 * 60 * 60 * 1000 } }, NOW), false);
  assert.equal(isWithinMetaWindow(null, NOW), false);
  assert.equal(isWithinMetaWindow({}, NOW), false);
});

test('ZL-F2l: buildDeterministicMessage — usa nombre y numero de cotizacion si vienen', () => {
  const withName = buildDeterministicMessage({ name: 'Ronald', quote_number: '0055' });
  assert.match(withName, /Ronald/);
  assert.match(withName, /0055/);

  const generic = buildDeterministicMessage({});
  assert.match(generic, /^Hola/);
  assert.ok(generic.length > 0);
});
