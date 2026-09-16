// conciliacionDudosa.test.js
// Lo que se prueba acá no es "adivinar bien", es NO AFIRMAR DE MÁS. El dueño decide con
// este mensaje: si dijera "ya llegó" y no hubiera llegado, el cliente se queda sin su
// documento y con él convencido de lo contrario.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decidirConciliacion, mensajeConciliado, clavePendiente, VENTANA_MS, VERSION,
} from './conciliacionDudosa.js';

const AHORA = Date.parse('2026-09-16T15:00:00Z');
const pend = (over = {}) => ({ at: AHORA - 60_000, tipo: 'termico', folio: 'F1', ...over });
const ac = (over = {}) => ({ estado: 'delivered', msgId: 'wamid.X', telefono: '56998702852', ...over });

test('🔴 una entrega confirmada al mismo cliente, poco después, SÍ es evidencia', () => {
  const r = decidirConciliacion(pend(), ac(), AHORA);
  assert.equal(r.sirve, true);
  assert.equal(r.motivo, 'entrega_confirmada_al_mismo_cliente');
});

test('🔴 un `sent` NO sirve: Meta lo acepta y puede fallar después', () => {
  assert.equal(decidirConciliacion(pend(), ac({ estado: 'sent' }), AHORA).sirve, false);
});

test('🔴 un acuse ANTERIOR al envío dudoso no puede ser de ese envío', () => {
  // Pasa con relojes desfasados y con reentregas tardías de webhooks viejos.
  const r = decidirConciliacion(pend({ at: AHORA + 60_000 }), ac(), AHORA);
  assert.equal(r.sirve, false);
  assert.equal(r.motivo, 'acuse_anterior_al_envio');
});

test('🔴 fuera de la ventana no se atribuye nada', () => {
  const r = decidirConciliacion(pend({ at: AHORA - VENTANA_MS - 1 }), ac(), AHORA);
  assert.equal(r.sirve, false);
  assert.equal(r.motivo, 'fuera_de_ventana');
});

test('justo en el borde de la ventana todavía sirve', () => {
  assert.equal(decidirConciliacion(pend({ at: AHORA - VENTANA_MS }), ac(), AHORA).sirve, true);
});

test('sin caso pendiente no hay nada que conciliar', () => {
  assert.equal(decidirConciliacion(null, ac(), AHORA).sirve, false);
  assert.equal(decidirConciliacion({ at: 'basura' }, ac(), AHORA).sirve, false);
});

test('entradas basura no revientan', () => {
  for (const x of [null, undefined, 0, 'x', {}]) {
    assert.equal(typeof decidirConciliacion(pend(), x, AHORA).sirve, 'boolean');
  }
});

test('🔴 el mensaje NO afirma que llegó: dice qué se vio', () => {
  const m = mensajeConciliado({ tipo: 'Informe térmico', folio: 'CM-FR-006-2026-0033', nombre: 'Katy Rossel' });
  assert.match(m, /lo más probable/, 'tiene que sonar a probabilidad, no a certeza');
  assert.ok(!/ya le llegó/i.test(m), 'no puede afirmar la entrega');
  assert.match(m, /No se reenvió nada/, 'el dueño tiene que saber que nadie mandó nada de más');
  assert.match(m, /Katy Rossel/);
  assert.match(m, /CM-FR-006-2026-0033/);
});

test('el nombre se limpia igual que en el aviso (no rompe el formato)', () => {
  assert.match(mensajeConciliado({ nombre: 'Katy *Rossel*' }), /Katy Rossel/);
  assert.match(mensajeConciliado({}), /sin nombre registrado/);
});

test('🔴 la llave del índice es por cliente Y por documento', () => {
  assert.notEqual(clavePendiente('56998702852', 'termico'), clavePendiente('56998702852', 'vientos'));
  assert.notEqual(clavePendiente('56911111111', 'termico'), clavePendiente('56922222222', 'termico'));
  assert.equal(clavePendiente('+56 9 9870 2852', 'termico'), clavePendiente('56998702852', 'termico'));
});

test('expone VERSION', () => assert.match(VERSION, /^\d+\.\d+\.\d+$/));
