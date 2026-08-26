// compuesta-vertical.test.js — [2026-08-25]
//
// 🔃 LA COMPUESTA VERTICAL: proyectante arriba + fijo abajo, apilados.
//
// Pedida por el dueño el 25-ago, y NO se construyó suponiendo que "debería ser igual": se
// midió en Winart primero. Las versiones 66979 (1200×2000, su ventana) y 66943 (2002×1450,
// la horizontal ya calibrada) devuelven la MISMA estructura — dos marcos completos + un
// Connector con tag ACOPLE_MINI de 2 mm — rotada 90°. Recién con eso medido se escribió el
// código, y por eso el motor reparte por un EJE en vez de tener dos caminos separados.
//
// Estos tests protegen el lado del BOT: que se detecte cómo lo pide el cliente y que los
// límites de fabricación miren el eje correcto. La composición y el precio se prueban en el
// motor (temp-sales-os, quoteEngine.compuesta.test.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import { esCompuestaVertical, validateDimensionsLocal } from './enginePricer.js';

test('🔴 se detecta cómo habla el cliente de verdad', () => {
  for (const t of [
    'ventana compuesta proyectante arriba y fija abajo',
    'mitad proyectante arriba mitad fija abajo',
    'arriba proyectante, abajo fijo',
    'quiero una fija arriba y proyectante abajo',
    'fijo superior y proyectante inferior',
    'ventana compuesta apilada',
    'compuesta vertical 1200x2000',
  ]) {
    assert.equal(esCompuestaVertical(t), true, `debería ser vertical: "${t}"`);
  }
});

test('🔒 "arriba" a secas es una UBICACIÓN, no una composición', () => {
  // El caso que hace daño: cotizar apilada una ventana que el cliente quiere lado a lado
  // solo porque mencionó dónde va. Se exige que el arriba/abajo esté pegado a un tipo de paño.
  for (const t of [
    'la ventana de arriba del living, compuesta',
    'la compuesta va arriba en el segundo piso',
    'mitad fija mitad proyectante',
    'ventana compuesta 1200x1450',
    'corredera 2000x1000',
    '',
    null,
  ]) {
    assert.equal(esCompuestaVertical(t), false, `NO debería ser vertical: "${t}"`);
  }
});

test('🔴 en vertical el límite mira el ANCHO, no el alto', () => {
  // La ventana del dueño: 1200 × 2002. Los 2002 son la SUMA de dos paños de 1000; ningún
  // paño mide eso. Validar el alto acá la rechazaría por una medida que no existe.
  const r = validateDimensionsLocal('Ventana compuesta proyectante arriba fija abajo', 1200, 2002);
  assert.equal(r, null, 'la ventana del dueño se cotiza sin advertencia');
});

test('🔴 y una vertical DEMASIADO ANCHA sí se marca como referencial', () => {
  // El ancho en vertical lo comparten todos los paños: ahí sí es un límite real de fabricación.
  const r = validateDimensionsLocal('Ventana compuesta proyectante arriba fija abajo', 3000, 2000);
  assert.ok(r && r.referencial, 'se marca referencial');
  assert.match(r.message, /3000 mm de ancho/);
});

test('🔒 la HORIZONTAL sigue validando el alto, exactamente como antes', () => {
  const ok = validateDimensionsLocal('Ventana compuesta: Fijo 1200mm + Proyectante 800mm', 2002, 1450);
  assert.equal(ok, null);
  const alta = validateDimensionsLocal('Ventana compuesta: Fijo 1200mm + Proyectante 800mm', 2002, 4000);
  assert.ok(alta && alta.referencial, 'una horizontal altísima sigue saliendo referencial');
  assert.match(alta.message, /de alto/);
});
