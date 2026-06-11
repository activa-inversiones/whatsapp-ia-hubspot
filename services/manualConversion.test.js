// manualConversion.test.js — RED ANTI-REGRESIÓN — registro manual de cotización/venta
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectKind, isManualConvTrigger, extractPhone, extractAmount, extractName,
  parseManualConversion, advanceGuided, startGuided, confirmMessage,
} from './manualConversion.js';

test('detectKind: VENTA / COTIZÓ y sinónimos', () => {
  assert.equal(detectKind('VENTA Juan 1500000'), 'venta');
  assert.equal(detectKind('vendí a Pedro'), 'venta');
  assert.equal(detectKind('COTIZÓ María 850000'), 'cotizacion');
  assert.equal(detectKind('cotice a Ana'), 'cotizacion');
  assert.equal(detectKind('presupuesto Luis'), 'cotizacion');
  assert.equal(detectKind('hola necesito ventanas'), null, 'mensaje de cliente NO es comando');
});

test('extractPhone: formatos chilenos → 569XXXXXXXX', () => {
  assert.equal(extractPhone('VENTA Juan +56912345678 1500000'), '56912345678');
  assert.equal(extractPhone('912345678'), '56912345678');
  assert.equal(extractPhone('+56 9 1234 5678'), '56912345678');
  assert.equal(extractPhone('Juan sin telefono 1500000'), null);
});

test('extractAmount: 1.500.000 / 1500000 / $850.000 / millones / mil', () => {
  assert.equal(extractAmount('VENTA Juan +56912345678 1500000'), 1500000);
  assert.equal(extractAmount('cotizó María 1.500.000'), 1500000);
  assert.equal(extractAmount('$850.000'), 850000);
  assert.equal(extractAmount('2 millones'), 2000000);
  assert.equal(extractAmount('1,5 millones'), 1500000);
  assert.equal(extractAmount('850 mil'), 850000);
  assert.equal(extractAmount('VENTA Pedro'), null, 'sin monto → null');
});

test('extractAmount: NO confunde el teléfono con el monto', () => {
  // teléfono 56912345678 + monto 1500000 → debe devolver 1500000, no el teléfono
  assert.equal(extractAmount('VENTA Juan 56912345678 1500000'), 1500000);
});

test('extractName: limpia keyword/teléfono/monto y deja el nombre', () => {
  assert.equal(extractName('VENTA Juan Pérez +56912345678 1500000'), 'Juan Pérez');
  assert.equal(extractName('cotizó María González 850000'), 'María González');
});

test('parseManualConversion: línea rápida completa', () => {
  const r = parseManualConversion('VENTA Juan Pérez +56912345678 1500000');
  assert.equal(r.kind, 'venta');
  assert.equal(r.name, 'Juan Pérez');
  assert.equal(r.phone, '56912345678');
  assert.equal(r.amount, 1500000);
  assert.equal(r.complete, true);
});

test('parseManualConversion: solo keyword → NO completa (dispara guiado)', () => {
  const r = parseManualConversion('VENTA');
  assert.equal(r.kind, 'venta');
  assert.equal(r.complete, false);
  assert.equal(isManualConvTrigger('VENTA'), true);
});

test('flujo GUIADO: nombre → teléfono → monto → done', () => {
  let st = startGuided('venta');
  let r = advanceGuided(st, 'Juan Pérez');
  assert.equal(r.state.name, 'Juan Pérez');
  assert.match(r.ask, /tel/i);
  r = advanceGuided(r.state, '+56912345678');
  assert.equal(r.state.phone, '56912345678');
  assert.match(r.ask, /monto/i);
  r = advanceGuided(r.state, '1.500.000');
  assert.equal(r.done, true);
  assert.equal(r.data.amount, 1500000);
  assert.equal(r.data.name, 'Juan Pérez');
});

test('flujo GUIADO: "no" en teléfono → phone null, sigue', () => {
  let st = startGuided('cotizacion');
  let r = advanceGuided(st, 'Ana');
  r = advanceGuided(r.state, 'no');
  assert.equal(r.state.phone, null);
  r = advanceGuided(r.state, '500000');
  assert.equal(r.done, true);
  assert.equal(r.data.phone, null);
});

test('confirmMessage: incluye tipo, nombre, monto formateado y estado Meta', () => {
  const msg = confirmMessage({ kind: 'venta', name: 'Juan', phone: '56912345678', amount: 1500000 }, { ok: true });
  assert.match(msg, /VENTA/);
  assert.match(msg, /Juan/);
  assert.match(msg, /1\.500\.000/);
  assert.match(msg, /Meta ✓/);
  const msg2 = confirmMessage({ kind: 'cotizacion', name: 'Ana', phone: null, amount: 500000 }, { skipped: true });
  assert.match(msg2, /COTIZACIÓN/);
  assert.match(msg2, /no atribuible/i);
});
