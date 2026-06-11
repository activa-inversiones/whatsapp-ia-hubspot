// oliverColor.test.js — RED ANTI-REGRESIÓN Oliver — G1 (no asumir el color)
// Casos reales (Alejandro/Claudio/Dalia): el bot asumía "blanco"/"newblack" sin que
// el cliente eligiera, y el PDF salía con el color equivocado. Exige: si no eligió →
// preguntar (colorChosen=false); si preguntó por colores → detectarlo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorChosen, isColorQuestion, colorOptionsMessage, askColorMessage, CATALOGO_COLORES } from './oliverColor.js';

// ── colorChosen ──────────────────────────────────────────────────────────────
test('G1: cliente NO eligió color (sin lock, items en blanco asumido) → colorChosen=false', () => {
  assert.equal(colorChosen({ items: [{ color: 'blanco' }, { color: 'blanco' }] }), false, 'todo blanco asumido = no eligió');
  assert.equal(colorChosen({ items: [{ color: '' }] }), false, 'sin color = no eligió');
  assert.equal(colorChosen({ items: [] }), false, 'sin items = no eligió');
  assert.equal(colorChosen({}), false);
  assert.equal(colorChosen(null), false);
});

test('G1: cliente eligió color EXPLÍCITO por texto (locked) → colorChosen=true', () => {
  assert.equal(colorChosen({ default_color_locked: true, default_color: 'NOGAL', items: [{ color: 'nogal' }] }), true);
  // aunque los items estén en blanco, si lo eligió explícito (locked) cuenta
  assert.equal(colorChosen({ default_color_locked: true, items: [{ color: 'blanco' }] }), true);
});

test('G1: colores reales/variados (típico de imagen) → colorChosen=true (no preguntar de más)', () => {
  assert.equal(colorChosen({ items: [{ color: 'nogal' }, { color: 'grafito' }] }), true, 'colores reales presentes');
  assert.equal(colorChosen({ items: [{ color: 'blanco' }, { color: 'nogal' }] }), true, 'al menos uno no-blanco');
});

// ── isColorQuestion ──────────────────────────────────────────────────────────
test('G1: detecta preguntas/pedidos sobre colores', () => {
  for (const q of [
    '¿qué colores tienen?',
    'que colores hay',
    'tienen muestra de colores?',
    'me muestras los colores disponibles',
    '¿cuáles son los tonos?',
    'tienen carta de colores',
    'qué color manejan',
  ]) {
    assert.equal(isColorQuestion(q), true, `"${q}" debe detectarse como pregunta de color`);
  }
});

test('G1: una ELECCIÓN de color directa NO es pregunta (no intercepta el flujo normal)', () => {
  for (const s of ['color nogal', 'quiero blanco', 'lo quiero en grafito', 'nogal', 'blanco por favor']) {
    assert.equal(isColorQuestion(s), false, `"${s}" es elección, NO pregunta`);
  }
});

test('G1: mensajes sin tema de color → no es pregunta de color', () => {
  assert.equal(isColorQuestion('¿cuánto cuesta?'), false);
  assert.equal(isColorQuestion('quiero 3 ventanas'), false);
  assert.equal(isColorQuestion(''), false);
});

// ── mensajes ─────────────────────────────────────────────────────────────────
test('G1: los mensajes solo ofrecen colores del catálogo real (no inventa)', () => {
  const msg = colorOptionsMessage('Alejandro');
  for (const c of CATALOGO_COLORES) {
    assert.match(msg.toLowerCase(), new RegExp(c), `debe mencionar ${c}`);
  }
  assert.match(msg, /Alejandro/);
  const ask = askColorMessage('');
  assert.match(ask.toLowerCase(), /blanco|nogal|grafito/);
  assert.match(ask, /color/i);
});
