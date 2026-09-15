// promesaIncumplida.test.js
// El caso Katy Rossel es REAL (conv 36f82b64, 15-sep-2026), confirmado por el
// dueño: "oliver no entregarte la propuesta técnico económica a katy, se la envié
// yo calculada en otra plataforma".
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectarPromesasIncumplidas,
  mensajePromesasIncumplidas,
  formatearEspera,
  MINUTOS_GRACIA,
  VERSION,
} from './promesaIncumplida.js';

/** La fila tal como la devolvería la query del caller para el caso Katy. */
function katy(over = {}) {
  return {
    id: '36f82b64-2536-4f90-9eba-11c68f39f8f4',
    customer_name: 'Katy Rossel',
    phone: '56998702852',
    promesa_at: '2026-09-15T17:59:36.914Z',
    pte_at: null,
    minutos_desde_promesa: 123,
    ai_paused: false,
    operator_status: 'ai',
    quote_number: 'CM-FR-004-2026-0462',
    ...over,
  };
}

// ─── EL CASO QUE LO ORIGINA ──────────────────────────────────────────────────

test('REAL: el caso Katy SÍ se detecta', () => {
  const r = detectarPromesasIncumplidas([katy()]);
  assert.equal(r.length, 1, 'no se detectó la promesa incumplida de Katy');
  assert.match(r[0].motivo, /folio CM-FR-004-2026-0462 reservado y sin documento/);
});

test('REAL: lo que stuckLeadMonitor NO podía ver — da igual cuánto escribió', () => {
  // Katy escribió 2 veces. stuckLeadMonitor exige >= 4 (stuckLeadMonitor.js:76)
  // y por eso es ciego con ella. Acá el disparador es la PROMESA, no la insistencia.
  const r = detectarPromesasIncumplidas([katy({ inbound_count: 2 })]);
  assert.equal(r.length, 1, 'un cliente que confió y no insistió debe detectarse igual');
});

// ─── Cuándo NO hay que avisar ────────────────────────────────────────────────

test('si la PTE salió, no se avisa', () => {
  const r = detectarPromesasIncumplidas([katy({ pte_at: '2026-09-15T18:01:00Z' })]);
  assert.equal(r.length, 0);
});

test('dentro de la gracia no se avisa (puede estar saliendo ahora)', () => {
  const r = detectarPromesasIncumplidas([katy({ minutos_desde_promesa: MINUTOS_GRACIA - 1 })]);
  assert.equal(r.length, 0, 'la entrega normal tarda 1-3 min: no despertar al dueño por eso');
});

test('justo en el borde de la gracia SÍ se avisa', () => {
  const r = detectarPromesasIncumplidas([katy({ minutos_desde_promesa: MINUTOS_GRACIA })]);
  assert.equal(r.length, 1);
});

test('si un humano tomó el caso, no se avisa', () => {
  assert.equal(detectarPromesasIncumplidas([katy({ ai_paused: true })]).length, 0);
  assert.equal(detectarPromesasIncumplidas([katy({ operator_status: 'human' })]).length, 0);
});

test('mas alla del techo no se avisa (ya no es accionable)', () => {
  const r = detectarPromesasIncumplidas([katy({ minutos_desde_promesa: 5000 })]);
  assert.equal(r.length, 0);
});

test('sin promesa no hay nada que reclamar', () => {
  const r = detectarPromesasIncumplidas([katy({ promesa_at: null })]);
  assert.equal(r.length, 0);
});

// ─── Orden y bordes ──────────────────────────────────────────────────────────

test('el que lleva mas esperando va primero', () => {
  const r = detectarPromesasIncumplidas([
    katy({ id: 'a', customer_name: 'A', minutos_desde_promesa: 20 }),
    katy({ id: 'b', customer_name: 'B', minutos_desde_promesa: 300 }),
    katy({ id: 'c', customer_name: 'C', minutos_desde_promesa: 60 }),
  ]);
  assert.deepEqual(r.map((x) => x.customer_name), ['B', 'C', 'A']);
});

test('entradas basura no revientan', () => {
  assert.deepEqual(detectarPromesasIncumplidas(null), []);
  assert.deepEqual(detectarPromesasIncumplidas(undefined), []);
  assert.deepEqual(detectarPromesasIncumplidas([null, 42, 'x']), []);
  assert.deepEqual(detectarPromesasIncumplidas([katy({ minutos_desde_promesa: 'abc' })]), []);
});

test('sin folio tambien se detecta, con otro motivo', () => {
  const r = detectarPromesasIncumplidas([katy({ quote_number: null })]);
  assert.equal(r.length, 1);
  assert.match(r[0].motivo, /sin folio/);
});

// ─── El mensaje al dueño ─────────────────────────────────────────────────────

test('mensaje con un solo caso nombra al cliente', () => {
  const msg = mensajePromesasIncumplidas(detectarPromesasIncumplidas([katy()]));
  assert.match(msg, /Katy Rossel/);
  assert.match(msg, /CM-FR-004-2026-0462/);
  assert.match(msg, /NO la Propuesta Técnica Económica/);
});

test('sin casos NO se manda mensaje', () => {
  assert.equal(mensajePromesasIncumplidas([]), '');
  assert.equal(mensajePromesasIncumplidas(null), '');
});

test('el mensaje corta en 10 y dice cuantos faltan', () => {
  const filas = Array.from({ length: 14 }, (_, i) =>
    katy({ id: `x${i}`, customer_name: `C${i}`, minutos_desde_promesa: 20 + i }));
  const msg = mensajePromesasIncumplidas(detectarPromesasIncumplidas(filas));
  assert.match(msg, /a 14 clientes/);
  assert.match(msg, /y 4 más/);
});

test('sin nombre usa el telefono, nunca "undefined"', () => {
  const msg = mensajePromesasIncumplidas(detectarPromesasIncumplidas([katy({ customer_name: '' })]));
  assert.match(msg, /56998702852/);
  assert.ok(!msg.includes('undefined'));
});

test('formatearEspera se lee sin hacer cuentas', () => {
  assert.equal(formatearEspera(18), '18 minutos');
  assert.equal(formatearEspera(60), '1 h');
  assert.equal(formatearEspera(125), '2 h 5 min');
  assert.equal(formatearEspera(123), '2 h 3 min', 'el caso Katy: 2 horas esperando');
});

test('expone VERSION', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});
