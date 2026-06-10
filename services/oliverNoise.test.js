// oliverNoise.test.js — RED ANTI-REGRESIÓN Oliver — GT-05 (ruido/basura repetido → escalar)
//
// CASO REAL (conv e0b2a1a5): 119 msgs de basura distintos, bot respondió 20+ veces
// "no se entendió" sin escalar. detectClientLoop() no lo atrapaba porque compara
// texto EXACTO. Este módulo detecta ruido por CARACTERÍSTICAS, no por igualdad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNoise, detectNoiseLoop, noiseLoopMessage, DEFAULT_THRESHOLD } from './oliverNoise.js';

// ─── isNoise ─────────────────────────────────────────────────────────────────

test('GT-05a: isNoise detecta basura obvia', () => {
  for (const t of [
    'ksdhf',       // consonantes sin vocal
    '???!!!',      // solo símbolos
    'aaaaa',       // carácter repetido
    '123456',      // solo números sin letra
    'xz',          // demasiado corto
    '',            // vacío
    '   ',         // espacios
    '##$$%%',      // símbolos
  ]) {
    assert.equal(isNoise(t), true, `"${t}" debe detectarse como ruido`);
  }
});

test('GT-05b: isNoise NO clasifica mensajes legibles como ruido', () => {
  for (const t of [
    'hola',
    'quiero una ventana',
    'cuánto cuesta',
    'buenos días',
    '1200x1000',         // medida con letras (la x y los números)
    'sí',
    'ok',
    'pvc blanco',
  ]) {
    assert.equal(isNoise(t), false, `"${t}" NO debe ser ruido`);
  }
});

// ─── detectNoiseLoop ─────────────────────────────────────────────────────────

test('GT-05c (caso real e0b2a1a5): 5 mensajes basura DISTINTOS disparan loop tras umbral', () => {
  const ses = {};
  // Mensajes todos diferentes (el bug original: detectClientLoop no los atrapaba)
  const basuras = [
    'ksdhf',
    '???!!!',
    'xzqprt',
    '####',
    'bbbbb',
  ];
  let disparado = false;
  for (const msg of basuras) {
    if (detectNoiseLoop(ses, msg, { threshold: DEFAULT_THRESHOLD })) {
      disparado = true;
      break;
    }
  }
  assert.equal(disparado, true, 'Debe disparar loop tras 5 mensajes de basura distintos');
});

test('GT-05d: mensajes legibles no acumulan contador de ruido', () => {
  const ses = {};
  const msgs = ['hola', 'quiero una ventana', 'blanco', '1200x1000', 'pvc'];
  for (const msg of msgs) {
    const resultado = detectNoiseLoop(ses, msg, { threshold: DEFAULT_THRESHOLD });
    assert.equal(resultado, false, `"${msg}" es legible, no debe disparar`);
  }
});

test('GT-05e: mix ruido+legible — solo los ruidosos cuentan para el umbral', () => {
  const ses = {};
  // 3 basuras, 1 legible, 2 basuras → 5 ruidosos en ventana de 8 → dispara
  const msgs = ['ksdhf', 'xzq', '###', 'quiero ventana', 'bbbbb', 'mnpqr'];
  let count = 0;
  let disparado = false;
  for (const msg of msgs) {
    count++;
    if (detectNoiseLoop(ses, msg, { threshold: 5, window: 8 })) {
      disparado = true;
      break;
    }
  }
  assert.equal(disparado, true, 'Debe disparar aunque haya un legible intercalado');
});

test('GT-05f: threshold configurable — umbral 3 dispara más rápido', () => {
  const ses = {};
  const basuras = ['ksdhf', '???!!!', 'xzqprt'];
  let disparado = false;
  for (const msg of basuras) {
    if (detectNoiseLoop(ses, msg, { threshold: 3 })) {
      disparado = true;
      break;
    }
  }
  assert.equal(disparado, true, 'Con threshold=3 debe disparar al tercer mensaje de basura');
});

test('GT-05g: reset tras disparo — nueva secuencia empieza limpia', () => {
  const ses = {};
  const basuras = ['ksdhf', '???!!!', 'xzqprt', '####', 'bbbbb'];
  for (const msg of basuras) detectNoiseLoop(ses, msg);
  // Después del disparo, noiseWindow queda vacío
  assert.equal(ses.noiseWindow.length, 0, 'noiseWindow debe estar vacío tras disparo');
  // Mensaje legible posterior no dispara
  const resultado = detectNoiseLoop(ses, 'hola');
  assert.equal(resultado, false, 'Mensaje legible post-reset no dispara');
});

// ─── noiseLoopMessage ─────────────────────────────────────────────────────────

test('GT-05h: mensaje de escalación es amable y menciona agente', () => {
  const msg = noiseLoopMessage('Claudio', 'Marcelo');
  assert.match(msg, /Claudio/, 'incluye nombre del cliente');
  assert.match(msg, /Marcelo/, 'menciona al agente');
  assert.match(msg, /hora|llame/i, 'captura: pide hora de contacto');
});

test('GT-05i: mensaje funciona sin nombre de cliente', () => {
  const msg = noiseLoopMessage();
  assert.ok(msg.length > 10, 'mensaje no vacío');
  assert.match(msg, /Marcelo Cifuentes/, 'agente por defecto');
});
