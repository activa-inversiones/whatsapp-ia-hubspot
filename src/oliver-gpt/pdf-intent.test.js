// node --test src/oliver-gpt/pdf-intent.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPdfAffirmative, lastAssistantOfferedPdf, itemsFromQuoteCalls, stripMontos } from './pdf-intent.js';

test('isPdfAffirmative: afirmaciones cortas y explícitas', () => {
  for (const t of ['sí', 'Si', 'dale', 'ok', 'perfecto', 'listo', 'envíamela', 'quiero el pdf', 'mándamela', 'la propuesta formal'])
    assert.equal(isPdfAffirmative(t), true, `debió ser afirmativo: ${t}`);
});

test('isPdfAffirmative: NO afirmativo para preguntas o ruido', () => {
  for (const t of ['cuánto cuesta?', 'tengo otra ventana', 'no', 'y el color?', ''])
    assert.equal(isPdfAffirmative(t), false, `NO debió ser afirmativo: ${t}`);
});

test('lastAssistantOfferedPdf: detecta oferta de PDF en el último turno del asistente', () => {
  assert.equal(lastAssistantOfferedPdf([{ role: 'assistant', content: '¿Te envío la propuesta formal en PDF?' }]), true);
  assert.equal(lastAssistantOfferedPdf([{ role: 'assistant', content: 'Hola, ¿en qué te ayudo?' }]), false);
  assert.equal(lastAssistantOfferedPdf([]), false);
  // [multi-ventana] oferta tipo "¿se la preparo?" también cuenta como oferta de PDF
  assert.equal(lastAssistantOfferedPdf([{ role: 'assistant', content: 'Anotada ✅. ¿Tiene más ventanas o se la preparo con estas?' }]), true);
  // toma el ÚLTIMO assistant, ignora user posterior
  assert.equal(lastAssistantOfferedPdf([
    { role: 'assistant', content: 'te mando la propuesta formal' }, { role: 'user', content: 'sí' },
  ]), true);
});

test('itemsFromQuoteCalls: extrae items válidos de calcular_cotizacion, ignora fallidos', () => {
  const calls = [
    { name: 'calcular_cotizacion', input: { tipo: 'CORREDERA', medidas_texto: '1.5x1.2', color: 'BLANCO', cantidad: 2 },
      result: { ok: true, unit_price: 300000, cantidad: 2, producto_label: 'Corredera SLIDING', glass_label: '5+12+5' } },
    { name: 'calcular_cotizacion', input: { tipo: 'FIJA' }, result: { ok: false } }, // falla → se ignora
    { name: 'listar_vidrios', input: {}, result: { ok: true } },                      // no es cotización
  ];
  const items = itemsFromQuoteCalls(calls, 'BLANCO');
  assert.equal(items.length, 1);
  assert.equal(items[0].unit_price, 300000);
  assert.equal(items[0].qty, 2);
  assert.equal(items[0].producto_label, 'Corredera SLIDING');
});

test('stripMontos: borra montos CLP del texto (positivos)', () => {
  for (const c of [
    'te sale $289.000 con termopanel',
    'son $1.234.567 en total',
    'quedan en 1.200.000 pesos',
    'el valor es 890.000 CLP',
    'total 1.234.567 listo',
  ]) {
    const out = stripMontos(c);
    assert.ok(/valor en la propuesta formal/.test(out), `debió redirigir: ${c} → ${out}`);
    assert.ok(!/\d\.\d{3}/.test(out), `no debió quedar monto: ${c} → ${out}`);
  }
});

test('stripMontos: NO toca medidas/cantidades/folios/teléfonos (sin falsos positivos)', () => {
  for (const t of [
    'una corredera de 1.20 m por 1.50 m',
    'medidas 120x150 cm',
    'una ventana de 2.400 mm de ancho',
    'tengo 2 ventanas y 3 puertas',
    'tu Propuesta Técnica Económica N° 0021',
    'llámame al +56 9 5729 6035',
    'con un abono del 50%',
    '',
  ]) assert.equal(stripMontos(t), t, `NO debió cambiar: "${t}"`);
});

// ── [2026-07-06 LOTE2] medidas_resueltas → campos numéricos + string limpio en pending_quote ──
test('itemsFromQuoteCalls: medidas_resueltas "AxBmm" → ancho_mm/alto_mm numéricos + measures limpio', () => {
  const calls = [{
    name: 'calcular_cotizacion',
    input: { tipo: 'PROYECTANTE', medidas_texto: '350x600', ambiente: 'baño' },
    result: { ok: true, unit_price: 120000, cantidad: 1, producto_label: 'Proyectante S60', glass_label: '4+12+4 satén (baño)', medidas_resueltas: '350x600mm', referencial: true },
  }];
  const items = itemsFromQuoteCalls(calls, 'BLANCO');
  assert.equal(items.length, 1);
  assert.equal(items[0].measures, '350x600', 'display SIN sufijo (Zoho/PDF/alertas)');
  assert.equal(items[0].ancho_mm, 350, 'campo numérico para re-cotizaciones exactas');
  assert.equal(items[0].alto_mm, 600);
});

test('itemsFromQuoteCalls: sin medidas_resueltas cae al texto crudo (comportamiento histórico)', () => {
  const calls = [{
    name: 'calcular_cotizacion',
    input: { tipo: 'CORREDERA', medidas_texto: '150x150 cm' },
    result: { ok: true, unit_price: 350000, cantidad: 1, producto_label: 'Corredera SLIDING' },
  }];
  const items = itemsFromQuoteCalls(calls, '');
  assert.equal(items[0].measures, '150x150 cm');
  assert.equal(items[0].ancho_mm, undefined);
});
