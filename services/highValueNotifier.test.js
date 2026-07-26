// highValueNotifier.test.js — RED ANTI-REGRESIÓN — tablero ACTIVA #58
// ═══════════════════════════════════════════════════════════════════════════
// Reproduce y fija las 2 fallas encontradas 21/22-jul (ver ESTADO-ACTIVA.md
// 2026-07-21 punto 1 + PENDIENTES-ACTIVA.md #58), verificadas contra el
// highValueNotifier.js REAL de este repo (v1.0.0, tiers STANDARD/MEDIUM/HIGH
// — no existe tier "VIP" ni texto ">1 MILLÓN" hardcodeado, eso era solo el
// draft de Gemini nunca mergeado):
//
//   (a) VIP falso: el score llega a HIGH (80 pts EXACTOS, reproducido con la
//       combo real: 5 items + "proyecto" + "urgente" + Temuco + nombre +
//       stageKey cotizacion_enviada) usando SOLO señales blandas, con
//       grand_total = 0. Un $0/null jamás debe puntuar al tier tope.
//   (b) Cooldown que silencia al VIP real: la key `${phone}:${reason}` no
//       distingue tier — una alerta previa de menor tier (el falso positivo
//       de (a)) deja la MISMA key seteada y silencia 2h la alerta siguiente
//       aunque esa sí sea un HIGH real (monto confirmado).
//
// Sin red, sin BD — mock de waSendFn. OWNER_NOTIFICATION_PHONE se setea ANTES
// del import dinámico porque el módulo lo lee en un const top-level.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.OWNER_NOTIFICATION_PHONE = '56900000000';
const { evaluateLeadValue, notifyHighValue } = await import('./highValueNotifier.js');

// Mock de waSendFn: no golpea red, solo registra los envíos.
function makeWaSendMock() {
  const calls = [];
  const fn = async (phone, msg) => { calls.push({ phone, msg }); return true; };
  fn.calls = calls;
  return fn;
}

// Sesión "caso real" del repro documentado: 5 items, "proyecto" + "urgente"
// en el mensaje, comuna Temuco, nombre, stage cotizacion_enviada, $0 total.
// `dataOverrides` se mergea DENTRO de `data` (no reemplaza el objeto entero).
function falsePositiveSession(dataOverrides = {}) {
  return {
    data: {
      grand_total: 0,
      items: [{ product: 'ventana' }, { product: 'ventana' }, { product: 'ventana' }, { product: 'ventana' }, { product: 'ventana' }],
      comuna: 'Temuco',
      name: 'Juan Pérez',
      stageKey: 'cotizacion_enviada',
      ...dataOverrides,
    },
    history: [
      { role: 'user', content: 'Tengo un proyecto urgente, necesito cotizar toda la casa' },
    ],
  };
}

// Sesión con monto REAL confirmado (cruza HIGH_VALUE_THRESHOLD=800000) — el
// "VIP real" que no debe quedar mudo.
function realHighValueSession(dataOverrides = {}) {
  return {
    data: {
      grand_total: 900000,
      items: [{ product: 'ventana' }, { product: 'ventana' }, { product: 'ventana' }],
      stageKey: 'cotizacion_enviada',
      ...dataOverrides,
    },
    history: [],
  };
}

// ── (a) GATE: $0/null nunca puntúa como tier tope ───────────────────────────
test('HVN-01: combo de señales blandas con grand_total=0 da 80 pts EXACTOS pero el tier queda topado a MEDIUM (nunca HIGH)', () => {
  const score = evaluateLeadValue(falsePositiveSession());
  assert.equal(score.value, 80, 'debe reproducir el puntaje exacto documentado (25 items + 15 keyword + 10 urgencia + 5 comuna + 10 nombre + 15 stage)');
  assert.notEqual(score.tier, 'HIGH', 'un $0 jamás debe alcanzar el tier tope solo con señales blandas');
  assert.equal(score.tier, 'MEDIUM');
});

test('HVN-02: mismo combo con grand_total=null se comporta igual que $0 (no HIGH)', () => {
  const score = evaluateLeadValue(falsePositiveSession({ grand_total: null }));
  assert.notEqual(score.tier, 'HIGH');
});

test('HVN-03: control — el mismo puntaje CON monto real (>0) sí puede llegar a HIGH (el gate no rompe el caso legítimo)', () => {
  // 80 pts de señales blandas + evidencia real de monto → debe seguir siendo HIGH.
  const score = evaluateLeadValue(falsePositiveSession({ grand_total: 1 }));
  assert.equal(score.tier, 'HIGH', 'con monto > 0 confirmado, 80 pts sí debe ser HIGH (no sobre-corregir)');
});

test('HVN-04: notifyHighValue con el falso positivo envía como "VALOR MEDIO", nunca "ALTO VALOR"', async () => {
  const waSend = makeWaSendMock();
  const result = await notifyHighValue(waSend, '56911111111', falsePositiveSession(), 'auto');
  assert.equal(result.sent, true, 'MEDIUM con reason=auto sí debe enviarse (solo STANDARD+auto se bloquea)');
  assert.equal(result.tier, 'MEDIUM');
  assert.equal(waSend.calls.length, 1);
  assert.match(waSend.calls[0].msg, /VALOR MEDIO/);
  assert.doesNotMatch(waSend.calls[0].msg, /ALTO VALOR/);
});

// ── (b) COOLDOWN: un ascenso de tier no debe quedar mudo ────────────────────
test('HVN-05: un falso positivo (MEDIUM) NO debe silenciar 2h al VIP real (HIGH) que llega después para el mismo teléfono/reason', async () => {
  const waSend = makeWaSendMock();
  const phone = '56922222222';

  // 1) Falso positivo primero: dispara y consume el cooldown de "phone:auto".
  const first = await notifyHighValue(waSend, phone, falsePositiveSession(), 'auto');
  assert.equal(first.sent, true);
  assert.equal(first.tier, 'MEDIUM');

  // 2) Acto seguido (mismo minuto, muy dentro de las 2h de cooldown) llega la
  //    cotización real de alto valor. Antes del fix, la key "phone:auto" ya
  //    estaba seteada por el falso positivo → esta alerta quedaba muda.
  const second = await notifyHighValue(waSend, phone, realHighValueSession(), 'auto');
  assert.equal(second.tier, 'HIGH', 'el segundo lead sí es HIGH real (monto confirmado)');
  assert.equal(second.sent, true, 'el VIP real NO debe quedar silenciado por el cooldown del falso positivo anterior');
  assert.equal(waSend.calls.length, 2);
  assert.match(waSend.calls[1].msg, /ALTO VALOR/);
});

test('HVN-06: control — dos alertas del MISMO tier para el mismo teléfono/reason sí respetan el cooldown (no se rompió el anti-spam)', async () => {
  const waSend = makeWaSendMock();
  const phone = '56933333333';

  const first = await notifyHighValue(waSend, phone, realHighValueSession(), 'auto');
  assert.equal(first.sent, true);
  assert.equal(first.tier, 'HIGH');

  // Repetir el MISMO tier HIGH inmediatamente después: debe seguir cooldowneado.
  const second = await notifyHighValue(waSend, phone, realHighValueSession(), 'auto');
  assert.equal(second.sent, false);
  assert.equal(second.reason, 'cooldown');
  assert.equal(waSend.calls.length, 1, 'no debe reenviar spam del mismo tier dentro de las 2h');
});
