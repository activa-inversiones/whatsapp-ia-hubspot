// orientacion-medidas.test.js — [2026-08-26]
//
// 🔴 NACIÓ DE UN ERROR QUE LE COSTÓ PLATA AL DUEÑO.
//
// Paula escribió, textual: *"LAS MEDIDAS ESTÁN ALTO POR ANCHO — 1 DE 220 x 200 CORREDERA,
// 1 DE 220x150 CORREDERA…"*. Se le cotizó al revés: 2200 de ancho × 2000 de alto, cuando
// pedía 2000 de ancho × 2200 de alto. Una corredera con las dos medidas cambiadas no vale
// lo mismo ni se fabrica igual.
//
// LA CAUSA: la orientación se DEDUCÍA por física — "ninguna ventana es más alta que el
// techo, así que si algún alto pasa los 2400 mm la tabla viene al revés". Con el máximo de
// Paula en 2200, la regla nunca se disparó. La deducción es un buen respaldo, pero cuando
// el cliente lo dice con todas las letras, lo que dice manda. Instrucción del dueño:
// *"cliente indica que son alto por ancho, eso está SOBRE la regla"*.

import test from 'node:test';
import assert from 'node:assert/strict';
import { orientacionDeclarada } from './enginePricer.js';

test('🔴 el caso de Paula, con sus palabras exactas', () => {
  const suyo = 'cliente PAULA DE LA COMUNA DE TEMUCO QUIERE 2 COTIZACIONES UNA DE COLOR NEGRO '
    + 'Y LA OTRA DE COLOR BLANCO ALAS MEDIDAS ESTÁN ALTO  POR  ANCHO  1 DE 220 x 200 CORREDERA';
  assert.equal(orientacionDeclarada(suyo), 'alto_ancho');
});

test('🔴 se entiende como lo escribe la gente de verdad', () => {
  for (const t of [
    'las medidas están alto por ancho',
    'LAS MEDIDAS ESTAN ALTO X ANCHO',
    'estan alto x ancho',
    'van alto-ancho',
    'alto, ancho',
    'primero el alto',
    'el alto va primero',
    'empiezan por el alto',
  ]) {
    assert.equal(orientacionDeclarada(t), 'alto_ancho', `debería ser alto×ancho: "${t}"`);
  }
  for (const t of [
    'las medidas van ancho por alto',
    'ancho x alto',
    'primero el ancho',
    'el ancho va primero',
  ]) {
    assert.equal(orientacionDeclarada(t), 'ancho_alto', `debería ser ancho×alto: "${t}"`);
  }
});

test('🔒 sin declaración NO se inventa una: manda la regla física de siempre', () => {
  // Lo que NO puede pasar es interpretar una frase cualquiera como una declaración de orden
  // y dar vuelta una lista que estaba bien.
  for (const t of [
    '1 de 220x200 corredera',
    'quiero una ventana alta y ancha',
    'la más ancha va en el living',
    'el alto del techo es 2.4',
    'necesito un ancho de puerta grande',
    '',
    null,
    undefined,
  ]) {
    assert.equal(orientacionDeclarada(t), null, `NO es una declaración: "${t}"`);
  }
});

test('🔴 lo que dice el cliente GANA sobre la deducción por tamaño', async () => {
  // El corazón del arreglo: con una lista chica (nada supera 2400) la regla física dice
  // "no hay nada que dar vuelta", y la frase del cliente tiene que imponerse igual.
  const { priceAllEngine } = await import('./enginePricer.js');
  const d = {
    texto_cliente: 'ALAS MEDIDAS ESTÁN ALTO POR ANCHO',
    items: [{ product: 'CORREDERA', measures: '220x200', qty: 1 }],
  };
  // No se cotiza de verdad (no hay motor acá): alcanza con que marque el swap.
  await priceAllEngine(d).catch(() => {});
  assert.equal(d.orientacion_declarada, 'alto_ancho', 'quedó registrado que el cliente lo dijo');
  assert.equal(d.items[0].measures_swapped, true, 'y la medida se dio vuelta');
});

test('🔒 si el cliente dice ANCHO por ALTO, no se da vuelta nada', async () => {
  const { priceAllEngine } = await import('./enginePricer.js');
  const d = {
    texto_cliente: 'las medidas van ancho por alto',
    items: [{ product: 'CORREDERA', measures: '220x200', qty: 1 }],
  };
  await priceAllEngine(d).catch(() => {});
  assert.equal(d.orientacion_declarada, 'ancho_alto');
  assert.ok(!d.items[0].measures_swapped, 'se respeta el orden que declaró');
});
