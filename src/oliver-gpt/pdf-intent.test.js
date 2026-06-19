// node --test src/oliver-gpt/pdf-intent.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPdfAffirmative, lastAssistantOfferedPdf, itemsFromQuoteCalls } from './pdf-intent.js';

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
