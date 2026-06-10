// oliverIntent.test.js — RED ANTI-REGRESIÓN Oliver — GT-04 (confirmación con formato WhatsApp)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQuoteIntent, stripWhatsAppMarkup } from './oliverIntent.js';

test('GT-04: confirmación con marcado WhatsApp dispara intención (el bug que perdía PDFs)', () => {
  // El caso real que perdía leads: el cliente confirma con negrita *Si*
  assert.equal(isQuoteIntent('*Si*'), true, '"*Si*" debe contar como confirmación');
  assert.equal(isQuoteIntent('_Si_'), true, '"_Si_" (cursiva) debe contar');
  assert.equal(isQuoteIntent('*SÍ*'), true, '"*SÍ*" con tilde debe contar');
  assert.equal(isQuoteIntent('*ok*'), true, '"*ok*" debe contar');
  assert.equal(isQuoteIntent('*dale*'), true, '"*dale*" debe contar');
});

test('confirmaciones sin marcado siguen funcionando (no rompimos lo que ya servía)', () => {
  for (const t of ['Si', 'sí', 'ok', 'dale', 'confirmo no aplica pero envíamela', 'está bien', 'perfecto', 'mándala', 'quiero la cotización', 'gracias']) {
    assert.equal(isQuoteIntent(t), true, `"${t}" debe contar como intención`);
  }
});

test('NO confirmaciones: mensajes que NO deben disparar el PDF', () => {
  for (const t of ['no', 'todavía no', 'espera', 'cuánto cuesta', 'qué colores hay', 'cambiar la medida', 'aluminio']) {
    assert.equal(isQuoteIntent(t), false, `"${t}" NO debe disparar intención`);
  }
});

test('stripWhatsAppMarkup quita solo el marcado, conserva el texto', () => {
  assert.equal(stripWhatsAppMarkup('*Si*'), 'Si');
  assert.equal(stripWhatsAppMarkup('_dale_ ~ya~'), 'dale ya');
  assert.equal(stripWhatsAppMarkup('texto normal 1200x1000'), 'texto normal 1200x1000');
  assert.equal(stripWhatsAppMarkup(null), '');
});
