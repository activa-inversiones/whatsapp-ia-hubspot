// color.test.js — [2026-08-25]
//
// 🔴 EL COLOR NUNCA LLEGABA AL MOTOR, ASI QUE **TODAS** LAS COTIZACIONES SALIAN BLANCAS.
//
// Lo reporto el dueño —*"revisé las cotizaciones y todas las entregas blancas sin importar
// el color que quiera el cliente"*— y se confirmo contra la BD viva: `default_color` estaba
// null o vacio en las 10 sesiones de las ultimas 20 h. En su propia prueba escribio "nogal"
// explicito y llego vacio.
//
// TOCA PLATA: el perfil en color cuesta mas que el blanco. Cotizar blanco y entregar nogal
// significa recotizar (y quedar mal) o comerse la diferencia.
//
// LA CADENA, cuatro eslabones y basta uno para que se pierda:
//   1. `color` es opcional en el schema de la tool: el LLM puede omitirlo.
//   2. `state.default_color` se LEIA en cuatro lugares y no se ESCRIBIA en ninguno.
//   3. `default_color: items[0].color || state.default_color || ''` → cadena vacia.
//   4. `quoteDataComplete` —el gate que frena el PDF por datos incompletos— validaba
//      nombre, medidas y precio, pero NO el color.
//
// El motor recibia vacio y caia a su valor por defecto: blanco. En silencio, siempre.

import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteDataComplete } from './pdf-intent.js';
import { recordarColor } from './normalizers.js';

const itemOk = (extra = {}) => ({
  product: 'Corredera S60', measures: '1500x1200mm', unit_price: 250000, qty: 1, ...extra,
});

/* =========================================================================
 * EL GATE AHORA EXIGE COLOR
 * ========================================================================= */

test('🔴 sin color en ninguna parte, el PDF NO se emite: se pregunta', () => {
  const r = quoteDataComplete({ name: 'Vanessa', items: [itemOk()] }, {});
  assert.equal(r.ok, false, 'no se cotiza blanco por defecto y en silencio');
  assert.ok(r.missing.includes('color'), `deberia pedir el color: ${r.missing.join(', ')}`);
});

test('con el color en el item, pasa', () => {
  const r = quoteDataComplete({ name: 'Vanessa', items: [itemOk({ color: 'Nogal' })] }, {});
  assert.equal(r.ok, true, r.missing.join(', '));
});

test('🔴 con el color recordado de la conversacion, pasa', () => {
  // El cliente dice "nogal" una vez, al principio. No hay por que volver a preguntarle en
  // cada ventana: el color queda en la sesion.
  const r = quoteDataComplete({ name: 'Vanessa', items: [itemOk()] }, { default_color: 'Nogal' });
  assert.equal(r.ok, true, r.missing.join(', '));
});

test('🔴 si UN item quedo sin color, tampoco pasa', () => {
  // Un proyecto mitad nogal y mitad "no sé" es justamente el caso donde hay que preguntar.
  const r = quoteDataComplete({
    name: 'Vanessa', items: [itemOk({ color: 'Nogal' }), itemOk()],
  }, {});
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes('color'));
});

test('un color en blanco o de relleno NO cuenta como color informado', () => {
  for (const malo of ['', '  ', null, undefined]) {
    const r = quoteDataComplete({ name: 'V', items: [itemOk({ color: malo })] }, {});
    assert.equal(r.ok, false, `"${malo}" no es un color`);
  }
});

test('🔒 el gate sigue exigiendo lo de antes (no se relajo nada)', () => {
  const conColor = { color: 'Blanco' };
  assert.ok(quoteDataComplete({ items: [itemOk(conColor)] }, {}).missing.includes('name'));
  assert.ok(quoteDataComplete({ name: 'V', items: [] }, {}).missing.includes('items'));
  assert.ok(quoteDataComplete({ name: 'V', items: [itemOk({ ...conColor, unit_price: 0 })] }, {})
    .missing.some((m) => m.includes('unit_price')));
});

/* =========================================================================
 * EL COLOR SE RECUERDA EN LA CONVERSACION
 * ========================================================================= */

test('🔴 un color dicho en una cotizacion queda recordado para las siguientes', () => {
  // La raiz del defecto: `state.default_color` se leia en cuatro lugares y NADIE lo
  // escribia. El cliente lista sus ventanas en varios mensajes y el color lo dice una vez.
  const state = {};
  recordarColor(state, [{ color: 'Nogal' }, { color: '' }]);
  assert.equal(state.default_color, 'Nogal');
});

test('el color se normaliza al catalogo real', () => {
  // Los 5 del catalogo: Blanco · Nogal · Roble Dorado · Grafito Antracita · Negro.
  const state = {};
  recordarColor(state, [{ color: '  nogal  ' }]);
  assert.equal(state.default_color, 'Nogal', 'sin espacios y con la capitalizacion del catalogo');
});

test('🔒 un color nuevo REEMPLAZA al anterior: el cliente cambio de opinion', () => {
  const state = { default_color: 'Blanco' };
  recordarColor(state, [{ color: 'Negro' }]);
  assert.equal(state.default_color, 'Negro');
});

test('🔒 sin color, NO se pisa el que ya estaba recordado', () => {
  const state = { default_color: 'Nogal' };
  recordarColor(state, [{ color: '' }, {}]);
  assert.equal(state.default_color, 'Nogal', 'una cotizacion sin color no borra la memoria');
});

test('recordarColor no rompe con basura', () => {
  const state = {};
  for (const basura of [null, undefined, 'texto', 42, [{ color: null }]]) {
    assert.doesNotThrow(() => recordarColor(state, basura));
  }
  assert.equal(state.default_color, undefined, 'y no inventa un color');
});
