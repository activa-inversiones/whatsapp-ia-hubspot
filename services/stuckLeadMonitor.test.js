// stuckLeadMonitor.test.js — RED ANTI-REGRESIÓN Oliver — caso Dalia
// Verifica que el monitor marca leads atascados "como Dalia" (insistió, sin PDF,
// sin humano, conversación viva) y NO marca los que están sanos (PDF enviado,
// humano a cargo, pocos intentos, o chat ya muerto). Sin red, BD ni env vars.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectStuckLeads, stuckLeadAlertMessage, isSessionStuck, sessionStuckAlertMessage, sessionToRow } from './stuckLeadMonitor.js';

// Helper: fila "sana" base; cada test sobreescribe lo que necesita.
const baseRow = (over = {}) => ({
  id: 1,
  customer_name: 'Cliente',
  quote_status: 'diagnostico',
  ai_paused: false,
  operator_status: 'ai',
  inbound_count: 5,
  has_pdf: false,
  minutes_since_last: 30,
  ...over,
});

// ── ST-01a: fila tipo Dalia SÍ se marca ─────────────────────────────────────
test('ST-01a: lead tipo Dalia (11 inbound, sin PDF, diagnostico, ai, sin pausa) ES marcado', () => {
  const dalia = baseRow({
    id: 42,
    customer_name: 'Dalia',
    inbound_count: 11,
    has_pdf: false,
    quote_status: 'diagnostico',
    operator_status: 'ai',
    ai_paused: false,
    minutes_since_last: 15,
  });

  const stuck = detectStuckLeads([dalia]);
  assert.equal(stuck.length, 1, 'Dalia debe quedar marcada como atascada');
  assert.equal(stuck[0].id, 42);
  assert.match(stuck[0].stuckReason, /11 mensajes sin cotización/);
  assert.match(stuck[0].stuckReason, /diagnostico/);
});

// ── ST-01b: PDF formal ya enviado → NO se marca ─────────────────────────────
test('ST-01b: fila con formal_sent / has_pdf=true NO se marca', () => {
  const conSent = baseRow({ quote_status: 'formal_sent', has_pdf: true, inbound_count: 9 });
  // También probamos quote_status formal_sent aunque has_pdf siguiera false:
  const soloEstado = baseRow({ id: 2, quote_status: 'formal_sent', has_pdf: false, inbound_count: 9 });

  assert.equal(detectStuckLeads([conSent]).length, 0, 'has_pdf=true no debe marcarse');
  assert.equal(detectStuckLeads([soloEstado]).length, 0, 'quote_status formal_sent no debe marcarse');
});

// ── ST-01c: caso en manos de un humano → NO se marca (aunque no haya PDF) ────
test('ST-01c: operator_status=human o ai_paused=true NO se marca aunque falte PDF', () => {
  const humano = baseRow({ operator_status: 'human', has_pdf: false, inbound_count: 8 });
  const pausado = baseRow({ id: 2, ai_paused: true, has_pdf: false, inbound_count: 8 });

  assert.equal(detectStuckLeads([humano]).length, 0, 'operator_status=human no debe marcarse');
  assert.equal(detectStuckLeads([pausado]).length, 0, 'ai_paused=true no debe marcarse');
});

// ── ST-01d: pocos intentos del cliente → NO se marca ────────────────────────
test('ST-01d: inbound_count=1 NO se marca (no insistió)', () => {
  const tibio = baseRow({ inbound_count: 1 });
  assert.equal(detectStuckLeads([tibio]).length, 0, 'inbound_count bajo no debe marcarse');
});

// ── ST-01e: conversación vieja/muerta → NO se marca ─────────────────────────
test('ST-01e: minutes_since_last=5000 (chat viejo) NO se marca', () => {
  const muerto = baseRow({ minutes_since_last: 5000, inbound_count: 9 });
  assert.equal(detectStuckLeads([muerto]).length, 0, 'chat sin actividad reciente no debe marcarse');
});

// ── ST-01f: stuckLeadAlertMessage — vacío → '' ; no vacío → contiene nombre ──
test('ST-01f: stuckLeadAlertMessage maneja vacío y arma mensaje con nombre', () => {
  assert.equal(stuckLeadAlertMessage([]), '', 'array vacío debe devolver string vacío');
  assert.equal(stuckLeadAlertMessage(null), '', 'input no-array debe devolver string vacío');

  const stuck = detectStuckLeads([baseRow({ customer_name: 'Dalia', inbound_count: 11 })]);
  const msg = stuckLeadAlertMessage(stuck);
  assert.equal(typeof msg, 'string');
  assert.ok(msg.length > 0, 'con leads atascados debe devolver un mensaje no vacío');
  assert.match(msg, /Dalia/, 'el mensaje debe contener el nombre del cliente');
  assert.match(msg, /⚠️ Leads sin cotizar/, 'debe incluir el header');
});

// ── ST-01g: fila sin nombre → "(sin nombre)" en el mensaje ──────────────────
test('ST-01g: lead sin customer_name aparece como "(sin nombre)"', () => {
  const stuck = detectStuckLeads([baseRow({ customer_name: null, inbound_count: 7 })]);
  const msg = stuckLeadAlertMessage(stuck);
  assert.match(msg, /\(sin nombre\)/, 'sin nombre debe mostrarse como "(sin nombre)"');
});

// ── ST-01h: opts.minInbound / opts.maxIdleMin configurables ─────────────────
test('ST-01h: umbrales configurables vía opts', () => {
  const tresMsg = baseRow({ inbound_count: 3 });
  assert.equal(detectStuckLeads([tresMsg]).length, 0, 'con default minInbound=4, 3 no se marca');
  assert.equal(detectStuckLeads([tresMsg], { minInbound: 3 }).length, 1, 'con minInbound=3, 3 sí se marca');

  const idle2h = baseRow({ minutes_since_last: 120, inbound_count: 6 });
  assert.equal(detectStuckLeads([idle2h], { maxIdleMin: 60 }).length, 0, 'con maxIdleMin=60, 120min no se marca');
});

// ── ST-01i: entradas inválidas no crashean ──────────────────────────────────
test('ST-01i: input no-array o filas nulas no crashean', () => {
  assert.deepEqual(detectStuckLeads(null), []);
  assert.deepEqual(detectStuckLeads(undefined), []);
  const mixto = [null, undefined, baseRow({ customer_name: 'Dalia', inbound_count: 11 })];
  assert.equal(detectStuckLeads(mixto).length, 1, 'filas nulas se ignoran, la válida se marca');
});

// ═══════════════════════════════════════════════════════════════════════════
// MODO TIEMPO-REAL (sesión viva del bot)
// ═══════════════════════════════════════════════════════════════════════════

// Helper: sesión viva con N mensajes entrantes del cliente.
const sesion = (over = {}) => ({
  history: Array.from({ length: over.userMsgs ?? 6 }, () => ({ role: 'user', content: 'x' })),
  pdfSent: over.pdfSent ?? false,
  data: { name: over.name ?? 'Dalia', grand_total: over.grand_total ?? null, handoffActive: over.handoffActive ?? false },
});

// ── ST-02a: sesión tipo Dalia (6 msgs, sin PDF, sin total, sin handoff) ES stuck
test('ST-02a: isSessionStuck=true para sesión con varios mensajes sin cotización', () => {
  assert.equal(isSessionStuck(sesion({ userMsgs: 6 }), '56999'), true);
});

// ── ST-02b: ya cotizada (grand_total o pdfSent) → NO stuck ───────────────────
test('ST-02b: con grand_total o pdfSent NO es stuck', () => {
  assert.equal(isSessionStuck(sesion({ userMsgs: 8, grand_total: 1500000 }), '56999'), false, 'con total no es stuck');
  assert.equal(isSessionStuck(sesion({ userMsgs: 8, pdfSent: true }), '56999'), false, 'con PDF enviado no es stuck');
});

// ── ST-02c: en handoff (Marcelo ya avisado) → NO stuck ───────────────────────
test('ST-02c: con handoffActive NO es stuck (ya está derivado a humano)', () => {
  assert.equal(isSessionStuck(sesion({ userMsgs: 9, handoffActive: true }), '56999'), false);
});

// ── ST-02d: pocos mensajes (umbral real-time = 5) → NO stuck ─────────────────
test('ST-02d: con 4 mensajes NO es stuck (umbral default 5 evita falsos positivos)', () => {
  assert.equal(isSessionStuck(sesion({ userMsgs: 4 }), '56999'), false, '4 < 5 no marca');
  assert.equal(isSessionStuck(sesion({ userMsgs: 5 }), '56999'), true, '5 ya marca');
});

// ── ST-02e: el mensaje de aviso contiene nombre, teléfono y conteo ───────────
test('ST-02e: sessionStuckAlertMessage arma aviso con nombre, teléfono y N mensajes', () => {
  const msg = sessionStuckAlertMessage(sesion({ userMsgs: 7, name: 'Dalia' }), '56957296035');
  assert.match(msg, /Dalia/);
  assert.match(msg, /56957296035/);
  assert.match(msg, /7 mensajes/);
  assert.match(msg, /Lead pegado/i);
});

// ── ST-02f: sessionToRow cuenta solo mensajes 'user' (no assistant) ──────────
test('ST-02f: sessionToRow cuenta inbound_count solo de mensajes role=user', () => {
  const ses = {
    history: [
      { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' }, { role: 'assistant', content: 'd' },
      { role: 'user', content: 'e' },
    ],
    pdfSent: false, data: { name: 'X' },
  };
  assert.equal(sessionToRow(ses, '569').inbound_count, 3, 'solo los 3 mensajes user');
});
