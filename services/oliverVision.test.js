// oliverVision.test.js — RED ANTI-REGRESIÓN Oliver — G2 (imagen ilegible → no mentir)
// Casos reales: 096cd370 y b01170ca (la visión devolvió rechazo y Oliver dijo
// "✅ Recibí tus medidas" mintiendo). Exige que un fracaso de lectura se detecte
// y que una extracción VÁLIDA de productos NO se marque ilegible (no falsos positivos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVisionUnreadable, imageUnreadableMessage } from './oliverVision.js';

test('G2: vacío o whitespace → ilegible', () => {
  assert.equal(isVisionUnreadable(''), true);
  assert.equal(isVisionUnreadable('   \n  '), true);
  assert.equal(isVisionUnreadable(null), true);
  assert.equal(isVisionUnreadable(undefined), true);
});

test('G2: rechazos/disculpas de la visión → ilegible (el bug real)', () => {
  const rechazos = [
    'Lo siento, no puedo ayudar con eso',
    'No puedo identificar productos en esta imagen',
    'La imagen está borrosa, no se distingue',
    "I'm sorry, I cannot identify any windows",
    'No reconozco ventanas ni puertas en la foto',
    'No hay productos visibles',
    'As an AI, I cannot process this image',
  ];
  for (const r of rechazos) {
    assert.equal(isVisionUnreadable(r), true, `"${r}" debe marcarse ilegible (no confirmar medidas)`);
  }
});

test('G2: texto vago sin medidas ni columnas → ilegible', () => {
  assert.equal(isVisionUnreadable('una foto de una casa con cosas'), true);
  assert.equal(isVisionUnreadable('hola'), true);
});

test('G2: extracción VÁLIDA de productos NO se marca ilegible (sin falsos positivos)', () => {
  const validas = [
    '1. Cocina | CORREDERA | 1200x1000 | 2 | blanco',
    'Living | proyectante | 600x1600 | 3 | nogal\nBaño | fijo | 670x500 | 1 | blanco',
    'V1 Dormitorio 1500x1200 corredera blanco x2',
    '1. Recinto | Tipo | 210/270 | 1 | grafito', // formato con barra de medida
  ];
  for (const v of validas) {
    assert.equal(isVisionUnreadable(v), false, `"${v.slice(0,40)}…" es una lista real → NO debe marcarse ilegible`);
  }
});

test('G2: "NO ESPECIFICADO" en un campo NO marca ilegible (es un valor válido de la visión)', () => {
  // La visión usa "NO ESPECIFICADO" para un dato faltante dentro de una fila real.
  const conFaltante = '1. Cocina | CORREDERA | 1200x1000 | 2 | NO ESPECIFICADO';
  assert.equal(isVisionUnreadable(conFaltante), false, 'una fila con un campo faltante sigue siendo válida');
});

test('G2: el mensaje pide ESCRIBIR las medidas y NO confirma haberlas recibido', () => {
  const msg = imageUnreadableMessage('Dalia');
  assert.match(msg, /no pude leer/i, 'reconoce honestamente que no leyó');
  assert.match(msg, /medidas/i, 'pide las medidas');
  assert.match(msg, /Dalia/, 'usa el nombre si está');
  assert.doesNotMatch(msg, /recib[ií] tus medidas/i, 'NUNCA debe confirmar que recibió las medidas');
});
