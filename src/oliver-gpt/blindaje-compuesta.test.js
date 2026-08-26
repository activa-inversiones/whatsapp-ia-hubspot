// blindaje-compuesta.test.js — [2026-08-26]
//
// 🔴 EL PRECIO DE LA COMPUESTA TIENE QUE PASAR POR EL MOTOR, COMO TODOS.
//
// El blindaje label↔precio re-cotiza cada ventana en el motor y CORRIGE el precio si no
// corresponde al producto del label. Actuaba solo sobre ítems con una apertura inequívoca…
// y el label de una compuesta —"Proyectante (arriba) + Fija (abajo)"— tiene DOS aperturas,
// así que caía a null y el ítem quedaba FUERA de la revisión.
//
// La compuesta era el único producto cuyo precio nadie verificaba.
//
// COSTO MEDIDO: en la propuesta 0356-C/-D de Paula las dos compuestas salieron $130.000 MÁS
// BARATAS cada una que lo que dice el motor ($277.725 contra $407.060). Un error así no se ve
// mirando el PDF: el número parece razonable.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// La función vive dentro del webhook (no exportada). Se lee del fuente y se evalúa: es una
// función pura de texto, y probarla importa más que la elegancia de cómo se obtiene.
const src = fs.readFileSync(new URL('./webhook.js', import.meta.url), 'utf8');
const cuerpo = src.match(/function aperturaFromLabel\(text\)\s*\{([\s\S]*?)\n\}/)[1];
const aperturaFromLabel = new Function('text', cuerpo);

test('🔴 una compuesta se declara COMPUESTA, no ambigua', () => {
  for (const t of [
    'Compuesta Vertical: Proyectante (arriba) + Fija (abajo)',
    'Ventana compuesta: Fijo 1200mm + Proyectante 800mm',
    'Ventana compuesta vertical: Proyectante 1098.5mm (arriba) + Fijo 1098.5mm (abajo)',
    'V3 · Compuesta vertical — Negro',
  ]) {
    assert.equal(aperturaFromLabel(t), 'COMPUESTA', `"${t.slice(0, 40)}…"`);
  }
});

test('🔒 y por eso ENTRA a la revisión de precio', () => {
  // El blindaje filtra por `ap` truthy: null = no se revisa. Que devuelva 'COMPUESTA' es
  // exactamente lo que hace que el precio se compare contra el motor.
  assert.ok(aperturaFromLabel('Compuesta vertical: Proyectante + Fija'),
    'sin esto el ítem se filtra y su precio no se verifica');
});

test('🔒 los demás tipos no cambian', () => {
  assert.equal(aperturaFromLabel('Corredera SLIDING H98 Doble Riel S75'), 'CORREDERA');
  assert.equal(aperturaFromLabel('Proyectante S60'), 'PROYECTANTE');
  assert.equal(aperturaFromLabel('Ventana fija S60'), 'FIJA');
  assert.equal(aperturaFromLabel('Oscilobatiente S60'), 'OSCILOBATIENTE');
});

test('🔒 un label REALMENTE ambiguo sigue sin revisarse — conservador a propósito', () => {
  // Si no se sabe qué producto es, re-cotizar contra "algo" y corregir sería peor que no
  // tocar: se le cambiaría el precio al cliente por una suposición.
  assert.equal(aperturaFromLabel('Ventana corredera y proyectante'), null);
  assert.equal(aperturaFromLabel('Ventana'), null);
  assert.equal(aperturaFromLabel(''), null);
  assert.equal(aperturaFromLabel(null), null);
});

test('🔴 la sonda del blindaje le pasa al motor lo que necesita para el EJE', () => {
  // Sin la orientación ni las partes, una compuesta VERTICAL se re-cotizaría HORIZONTAL: el
  // "precio del motor" con el que se compara sería el de otra ventana, y la revisión quedaría
  // peor que no tenerla — corregiría un precio correcto por uno equivocado.
  const sonda = src.slice(src.indexOf('const _probe = {'), src.indexOf('await priceAllEngine(_probe)'));
  assert.match(sonda, /orientacion:/, 'la sonda manda la orientación');
  assert.match(sonda, /partes:/, 'y los paños');
  assert.match(sonda, /texto_cliente:/, 'y el texto del cliente, que decide el orden de las medidas');
});
