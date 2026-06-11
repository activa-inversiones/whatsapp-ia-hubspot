// manualConversion.test.js — RED ANTI-REGRESIÓN — registro manual de cotización/venta
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectKind, isManualConvTrigger, extractPhone, extractAmount, extractName,
  parseManualConversion, advanceGuided, startGuided, startGuidedAtChannel, confirmMessage,
  normalizeChannel, channelToPlatform, isAmountSuspicious, confirmAmountMessage,
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

test('flujo GUIADO: nombre → teléfono → monto → CANAL → done', () => {
  let st = startGuided('venta');
  let r = advanceGuided(st, 'Juan Pérez');
  assert.equal(r.state.name, 'Juan Pérez');
  assert.match(r.ask, /tel/i);
  r = advanceGuided(r.state, '+56912345678');
  assert.equal(r.state.phone, '56912345678');
  assert.match(r.ask, /monto/i);
  r = advanceGuided(r.state, '1.500.000');
  assert.match(r.ask, /canal/i, 'tras el monto debe preguntar el canal');
  r = advanceGuided(r.state, 'me vio en tiktok');
  assert.equal(r.done, true);
  assert.equal(r.data.amount, 1500000);
  assert.equal(r.data.name, 'Juan Pérez');
  assert.equal(r.data.channel, 'tiktok');
});

test('flujo GUIADO: "no" en teléfono → phone null, sigue hasta canal', () => {
  let st = startGuided('cotizacion');
  let r = advanceGuided(st, 'Ana');
  r = advanceGuided(r.state, 'no');
  assert.equal(r.state.phone, null);
  r = advanceGuided(r.state, '500000');
  assert.match(r.ask, /canal/i);
  r = advanceGuided(r.state, 'instagram');
  assert.equal(r.done, true);
  assert.equal(r.data.phone, null);
  assert.equal(r.data.channel, 'instagram');
});

test('CANALES: normalizeChannel reconoce sinónimos', () => {
  assert.equal(normalizeChannel('me vio en TikTok'), 'tiktok');
  assert.equal(normalizeChannel('instagram'), 'instagram');
  assert.equal(normalizeChannel('por face'), 'facebook');
  assert.equal(normalizeChannel('google maps'), 'maps');
  assert.equal(normalizeChannel('lo buscó en google'), 'google');
  assert.equal(normalizeChannel('me recomendó un amigo'), 'referido');
  assert.equal(normalizeChannel('xyz'), null);
});

test('CANALES: channelToPlatform aplica la regla anti-cross-inject', () => {
  assert.equal(channelToPlatform('facebook'), 'meta');
  assert.equal(channelToPlatform('instagram'), 'meta');
  assert.equal(channelToPlatform('google'), 'google');
  assert.equal(channelToPlatform('maps'), 'google');
  assert.equal(channelToPlatform('tiktok'), 'tiktok');
  assert.equal(channelToPlatform('referido'), null);
  assert.equal(channelToPlatform('web'), null);
});

test('CANALES: línea rápida con canal lo detecta y NO lo mete en el nombre', () => {
  const r = parseManualConversion('VENTA Juan Pérez +56912345678 1500000 tiktok');
  assert.equal(r.channel, 'tiktok');
  assert.equal(r.name, 'Juan Pérez', 'el canal no debe quedar en el nombre');
  assert.equal(r.complete, true);
});

test('CANALES: startGuidedAtChannel para línea rápida sin canal', () => {
  const st = startGuidedAtChannel({ kind: 'venta', name: 'Luis', phone: '56911112222', amount: 800000 });
  assert.equal(st.step, 'channel');
  const r = advanceGuided(st, 'facebook');
  assert.equal(r.done, true);
  assert.equal(r.data.channel, 'facebook');
  assert.equal(r.data.name, 'Luis');
});

test('FIX#2: isAmountSuspicious — montos absurdos para ventanas piden confirmación', () => {
  assert.equal(isAmountSuspicious(1500000), false, '$1.5M es normal');
  assert.equal(isAmountSuspicious(850000), false, '$850k es normal');
  assert.equal(isAmountSuspicious(15000000000), true, 'typo gigante (un cero de más) → sospechoso');
  assert.equal(isAmountSuspicious(5000), true, '$5.000 es muy bajo → sospechoso');
  assert.equal(isAmountSuspicious(50000000), true, '$50M para una venta es raro → confirmar');
  assert.match(confirmAmountMessage({ kind: 'venta', amount: 15000000000 }), /confirma/i);
  assert.match(confirmAmountMessage({ kind: 'venta', amount: 15000000000 }), /s[ií]/i);
});

test('confirmMessage: incluye tipo, nombre, monto, canal y estado de reporte', () => {
  const msg = confirmMessage({ kind: 'venta', name: 'Juan', phone: '56912345678', amount: 1500000, channel: 'facebook' }, { ok: true });
  assert.match(msg, /VENTA/);
  assert.match(msg, /Juan/);
  assert.match(msg, /1\.500\.000/);
  assert.match(msg, /Meta ✓/, 'canal facebook → reportado a Meta');
  assert.match(msg, /facebook/);
  const msg2 = confirmMessage({ kind: 'cotizacion', name: 'Ana', phone: null, amount: 500000, channel: 'instagram' }, { skipped: 'no_phone' });
  assert.match(msg2, /COTIZACIÓN/);
  assert.match(msg2, /no atribuible/i);
  const msg3 = confirmMessage({ kind: 'venta', name: 'Leo', phone: '569', amount: 700000, channel: 'tiktok' }, { skipped: 'channel_pending' });
  assert.match(msg3, /Fase 2/i, 'tiktok aún sin enviador → se avisa que se activa después');
});
