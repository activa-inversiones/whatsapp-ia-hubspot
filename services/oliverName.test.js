// oliverName.test.js — RED ANTI-REGRESIÓN Oliver — G5 (cliente sin nombre)
// Casos reales: 74bb24ee, 4ed83aa2, 4f7521b4 — el bot dejaba name="Cliente"
// en la BD y los follow-up decían "Hola Cliente". El módulo debe detectar la
// ausencia de nombre real y extraerlo de la respuesta del cliente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsName, extractName, isLikelyName, askNameMessage } from './oliverName.js';

// ── needsName ────────────────────────────────────────────────────────────────
test('G5: sin nombre (undefined/null/vacío) → needsName=true', () => {
  assert.equal(needsName({ name: undefined }), true, 'undefined → necesita nombre');
  assert.equal(needsName({ name: null }), true, 'null → necesita nombre');
  assert.equal(needsName({ name: '' }), true, 'cadena vacía → necesita nombre');
  assert.equal(needsName({ name: '   ' }), true, 'solo espacios → necesita nombre');
  assert.equal(needsName({}), true, 'sin propiedad name → necesita nombre');
  assert.equal(needsName(null), true, 'objeto null → necesita nombre');
});

test('G5: nombre genérico "Cliente" (y variantes) → needsName=true', () => {
  assert.equal(needsName({ name: 'Cliente' }), true, '"Cliente" es genérico');
  assert.equal(needsName({ name: 'cliente' }), true, 'minúsculas → genérico');
  assert.equal(needsName({ name: 'CLIENTE' }), true, 'mayúsculas → genérico');
  assert.equal(needsName({ name: 'cliente de ventanas' }), true, '"cliente de ventanas" → genérico');
  assert.equal(needsName({ name: 'desconocido' }), true, '"desconocido" → genérico');
  assert.equal(needsName({ name: 'sin nombre' }), true, '"sin nombre" → genérico');
});

test('G5: nombre real → needsName=false', () => {
  assert.equal(needsName({ name: 'Dalia' }), false, '"Dalia" es nombre real');
  assert.equal(needsName({ name: 'Juan Pérez' }), false, '"Juan Pérez" es nombre real');
  assert.equal(needsName({ name: 'Ana María' }), false, '"Ana María" es nombre real');
  assert.equal(needsName({ name: 'Pedro' }), false, '"Pedro" es nombre real');
  assert.equal(needsName({ name: 'Marcelo Cifuentes' }), false, '"Marcelo Cifuentes" es nombre real');
});

// ── extractName ──────────────────────────────────────────────────────────────
test('G5: extrae nombre de "soy [Nombre]"', () => {
  assert.equal(extractName('soy Juan'), 'Juan');
  assert.equal(extractName('soy Ana María'), 'Ana María');
  assert.equal(extractName('Soy Pedro Ramírez'), 'Pedro Ramírez');
});

test('G5: extrae nombre de "me llamo [Nombre]"', () => {
  assert.equal(extractName('me llamo ana maría'), 'Ana María');
  assert.equal(extractName('Me llamo Claudio'), 'Claudio');
  assert.equal(extractName('me llamo José Luis Martínez'), 'José Luis Martínez');
});

test('G5: extrae nombre de "mi nombre es [Nombre]"', () => {
  assert.equal(extractName('mi nombre es Pedro'), 'Pedro');
  assert.equal(extractName('Mi nombre es Dalia Retama'), 'Dalia Retama');
});

test('G5: extrae nombre de "habla con [Nombre]" / "les habla [Nombre]"', () => {
  assert.equal(extractName('habla con Claudio'), 'Claudio');
  assert.equal(extractName('les habla Roberto'), 'Roberto');
  assert.equal(extractName('habla con María José'), 'María José');
});

test('G5: nombre directo sin prefijo → extrae si parece nombre', () => {
  assert.equal(extractName('Dalia'), 'Dalia');
  assert.equal(extractName('Juan Pérez'), 'Juan Pérez');
});

test('G5: frases que NO son nombres → extractName devuelve null', () => {
  assert.equal(extractName('quiero cotizar'), null, '"quiero cotizar" no es un nombre');
  assert.equal(extractName('no sé'), null, '"no sé" no es un nombre');
  assert.equal(extractName('buenos días'), null, '"buenos días" es solo saludo');
  assert.equal(extractName(''), null, 'vacío → null');
  assert.equal(extractName('quiero 3 ventanas blanco'), null, '"quiero 3 ventanas" no es nombre');
});

test('G5: devuelve nombre en Title Case (normaliza minúsculas)', () => {
  assert.equal(extractName('soy juan'), 'Juan');
  assert.equal(extractName('me llamo ana'), 'Ana');
  assert.equal(extractName('mi nombre es pedro ramírez'), 'Pedro Ramírez');
});

// ── isLikelyName ─────────────────────────────────────────────────────────────
test('G5: nombre solo → isLikelyName=true', () => {
  assert.equal(isLikelyName('Dalia'), true, 'un nombre → true');
  assert.equal(isLikelyName('Pedro'), true, 'nombre simple → true');
  assert.equal(isLikelyName('Ana María'), true, 'nombre compuesto → true');
  assert.equal(isLikelyName('Dalia Retama'), true, 'nombre + apellido → true');
  assert.equal(isLikelyName('Juan Carlos'), true, 'doble nombre → true');
  assert.equal(isLikelyName('María José Rodríguez'), true, 'nombre + apellido compuesto → true');
});

test('G5: frases con palabras de comando → isLikelyName=false', () => {
  assert.equal(isLikelyName('quiero 3 ventanas'), false, 'tiene intención → false');
  assert.equal(isLikelyName('blanco'), false, '"blanco" es un color, no nombre → false');
  assert.equal(isLikelyName('nogal'), false, '"nogal" es un color → false');
  assert.equal(isLikelyName('cotizar ventanas'), false, 'cotizar → false');
  assert.equal(isLikelyName('buenos días'), false, 'saludo → false');
  assert.equal(isLikelyName('hola'), false, '"hola" → false');
  assert.equal(isLikelyName('gracias'), false, '"gracias" → false');
});

test('G5: mensajes con dígitos → isLikelyName=false', () => {
  assert.equal(isLikelyName('Juan 123'), false, 'tiene dígitos → false');
  assert.equal(isLikelyName('3 ventanas'), false, 'empieza con número → false');
});

test('G5: mensajes con signo de pregunta → isLikelyName=false', () => {
  assert.equal(isLikelyName('¿cuánto cuesta?'), false, 'pregunta → false');
  assert.equal(isLikelyName('Juan?'), false, 'con signo de pregunta → false');
});

test('G5: más de 4 palabras → isLikelyName=false', () => {
  assert.equal(isLikelyName('Juan Carlos María José Rodríguez'), false, 'demasiadas palabras → false');
});

// ── askNameMessage ────────────────────────────────────────────────────────────
test('G5: askNameMessage contiene una pregunta', () => {
  const msg = askNameMessage();
  assert.ok(
    msg.includes('?') || msg.includes('¿'),
    'el mensaje debe contener una pregunta'
  );
  assert.ok(msg.length > 10, 'el mensaje no debe estar vacío');
});

test('G5: askNameMessage menciona "nombre" o la idea de identificarse', () => {
  const msg = askNameMessage().toLowerCase();
  assert.ok(
    msg.includes('nombre') || msg.includes('quién') || msg.includes('gusto'),
    'debe pedir el nombre o identificarse'
  );
});
