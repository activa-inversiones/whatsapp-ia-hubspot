// oliverPriceAnchor.test.js — RED ANTI-REGRESIÓN Oliver — G11 (ancla de valor, sin inventar precio)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPriceQuestionWithoutMeasures, priceAnchorMessage } from './oliverPriceAnchor.js';

test('G11: pregunta de precio SIN medidas → true', () => {
  for (const q of ['¿cuánto cuesta?', 'cuanto vale una ventana', 'precio?', 'me das un valor', 'cuánto sale', 'qué presupuesto manejan']) {
    assert.equal(isPriceQuestionWithoutMeasures(q), true, `"${q}" debe anclar valor`);
  }
});

test('G11: pregunta de precio CON medida → false (va al flujo de cotización)', () => {
  for (const q of ['¿cuánto cuesta una de 1200x1000?', 'precio de 120x60', 'cuánto por 1,5x1,5']) {
    assert.equal(isPriceQuestionWithoutMeasures(q), false, `"${q}" trae medida → no anclar, cotizar`);
  }
});

test('G11: mensajes que NO son pregunta de precio → false', () => {
  for (const q of ['quiero cotizar ventanas', 'hola', 'color blanco', '']) {
    assert.equal(isPriceQuestionWithoutMeasures(q), false);
  }
});

test('G11: el mensaje NO contiene ningún número de precio (anti-alucinación)', () => {
  const msg = priceAnchorMessage('Pedro');
  assert.doesNotMatch(msg, /\$|\d{4,}|\bUF\b|peso/i, 'NO debe contener cifras de precio inventadas');
  assert.match(msg, /medida|ancho/i, 'debe pedir la medida (el dato que destraba)');
  assert.match(msg, /Pedro/, 'usa el nombre si está');
});
