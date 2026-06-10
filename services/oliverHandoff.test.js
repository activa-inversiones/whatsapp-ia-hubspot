// oliverHandoff.test.js — RED ANTI-REGRESIÓN Oliver — GT-07
// Verifica que tras pedir un humano, el estado de handoff queda seteado
// (local EN MEMORIA + remoto mockeado). Sin red, sin env vars.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persistHandoff, isHandoffActive } from './oliverHandoff.js';

// ── GT-07a: capa LOCAL siempre funciona (no depende de Sales OS) ────────────
test('GT-07a: persistHandoff setea ses.handoffActive=true (capa local)', async () => {
  const ses = { data: { name: 'Test' }, history: [] };
  const result = await persistHandoff('56912345678', ses, { setHandoffFn: null });

  assert.equal(ses.handoffActive, true, 'debe mutar ses.handoffActive a true');
  assert.equal(result.local, true, 'result.local debe ser true');
  assert.equal(result.remote, false, 'sin bridge, remote debe ser false');
  assert.equal(result.remoteError, null, 'sin bridge, no hay remoteError');
});

// ── GT-07b: isHandoffActive lee la capa local correctamente ─────────────────
test('GT-07b: isHandoffActive devuelve true tras persistHandoff', async () => {
  const ses = {};
  assert.equal(isHandoffActive(ses), false, 'antes del handoff debe ser false');
  await persistHandoff('56912345678', ses);
  assert.equal(isHandoffActive(ses), true, 'después del handoff debe ser true');
});

// ── GT-07c: capa REMOTA — bridge exitoso ────────────────────────────────────
test('GT-07c: capa remota — bridge exitoso → result.remote=true', async () => {
  const calls = [];
  const mockBridge = async (phone, reason) => {
    calls.push({ phone, reason });
    return { ok: true };
  };

  const ses = {};
  const result = await persistHandoff('56912345678', ses, { setHandoffFn: mockBridge, reason: 'test_escalacion' });

  assert.equal(result.local, true);
  assert.equal(result.remote, true);
  assert.equal(result.remoteError, null);
  assert.equal(calls.length, 1, 'bridge llamado exactamente una vez');
  assert.equal(calls[0].phone, '56912345678');
  assert.equal(calls[0].reason, 'test_escalacion');
});

// ── GT-07d: capa REMOTA falla → resultado degradado, NO lanza excepción ─────
test('GT-07d: bridge falla con status 500 → remote=false pero NO lanza', async () => {
  const mockBridge = async () => ({ ok: false, status: 500, error: 'server_error' });
  const ses = {};

  let threw = false;
  let result;
  try {
    result = await persistHandoff('56912345678', ses, { setHandoffFn: mockBridge });
  } catch {
    threw = true;
  }

  assert.equal(threw, false, 'persistHandoff NO debe lanzar aunque el bridge falle');
  assert.equal(result.local, true, 'capa local sigue funcionando');
  assert.equal(result.remote, false);
  assert.equal(result.remoteError, 'server_error');
});

// ── GT-07e: bridge lanza excepción de red → resultado degradado, NO lanza ───
test('GT-07e: bridge lanza excepción → remote=false, remoteError poblado, NO relanza', async () => {
  const mockBridge = async () => { throw new Error('ECONNREFUSED'); };
  const ses = {};

  let threw = false;
  let result;
  try {
    result = await persistHandoff('56912345678', ses, { setHandoffFn: mockBridge });
  } catch {
    threw = true;
  }

  assert.equal(threw, false, 'persistHandoff NO debe relanzar la excepción de red');
  assert.equal(result.local, true);
  assert.equal(result.remote, false);
  assert.match(result.remoteError, /ECONNREFUSED/);
});

// ── GT-07f: isHandoffActive es falsy para sesión nula/undefined ─────────────
test('GT-07f: isHandoffActive maneja sesión nula sin crashear', () => {
  assert.equal(isHandoffActive(null), false);
  assert.equal(isHandoffActive(undefined), false);
  assert.equal(isHandoffActive({}), false);
});

// ── GT-07g: el bot NO reinicia tras handoff — guard local bloquea ────────────
// Simula el flujo: Oliver escala → persistHandoff → mensaje nuevo del cliente
// → isHandoffActive() devuelve true → el handler retorna sin responder.
test('GT-07g: guard local bloquea mensajes posteriores al handoff', async () => {
  const ses = { data: { name: 'Claudio' } };

  // Simula escalación
  await persistHandoff('56987654321', ses);

  // Simula mensaje entrante posterior
  const shouldSilence = isHandoffActive(ses);
  assert.equal(shouldSilence, true, 'mensaje post-handoff debe ser silenciado por el guard');
});

// ── GT-07h: el handoff se persiste en ses.data (sobrevive reinicio de Railway) ─
// session.data se guarda como jsonb en Postgres y se rehidrata al reiniciar.
// Si el flag SOLO viviera en ses.handoffActive (RAM), un reinicio lo perdería y
// el bot revivría la conversación ya derivada. Por eso persistHandoff lo escribe
// también en ses.data.handoffActive.
test('GT-07h: persistHandoff escribe el flag en ses.data (capa persistible)', async () => {
  const ses = { data: { name: 'Dalia' }, history: [] };
  await persistHandoff('56911112222', ses);
  assert.equal(ses.data.handoffActive, true, 'el flag debe quedar en ses.data para persistir a Postgres');
});

test('GT-07h2: tras un reinicio simulado (solo sobrevive ses.data), el guard sigue activo', () => {
  // Simula la sesión REHIDRATADA desde Postgres: el flag top-level se perdió,
  // solo quedó lo que estaba en data (jsonb). El guard debe seguir cortando.
  const sesRehidratada = { data: { name: 'Dalia', handoffActive: true }, history: [] };
  assert.equal(isHandoffActive(sesRehidratada), true, 'el handoff debe sobrevivir el reinicio vía ses.data');
});
