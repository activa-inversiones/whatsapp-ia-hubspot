// listaVentanas.test.js — [2026-09-18]
//
// Reclamo del dueno que lo origina (textual): *"los clientes si entregan una lista, la lista
// debe estar ordenada por columnas indicando posicion de ventana, nombre del lugar si es que
// lo tiene, ancho, alto y cantidad y modelo de ventana a cotizar, una sola en fila, porque
// cuando las envias todas juntas el cliente se enreda y esta toda la informacion pegada"*.

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatListaVentanas, medidasDe } from './listaVentanas.js';

// La lista real del cuaderno de Mario Grey (foto, 17 ventanas) — las 3 primeras.
const LISTA_REAL = [
  { posicion: 'N\u00b01', product: 'corredera', measures: '2710x1995mm', qty: 1, ambiente: 'Living' },
  { posicion: 'N\u00b02', product: 'corredera', measures: '1800x1970mm', qty: 1 },
  { posicion: 'N\u00b03', product: 'corredera', measures: '1800x1980mm', qty: 1 },
];

test('🔴 UNA VENTANA POR FILA — es el reclamo, y es lo unico que no se puede romper', () => {
  const out = formatListaVentanas(LISTA_REAL, { encabezado: false });
  const filas = out.split('\n').filter(Boolean);
  assert.equal(filas.length, 3, 'tres ventanas, tres filas: nada pegado');
  for (const f of filas) assert.ok(!/\n/.test(f));
});

test('🔴 cada fila trae las 6 columnas en el orden que pidio el dueno', () => {
  const [f1] = formatListaVentanas(LISTA_REAL, { encabezado: false }).split('\n');
  // posicion - lugar - ancho x alto - cantidad - modelo
  assert.match(f1, /^N\u00b01 \u00b7 Living \u00b7 2710 \u00d7 1995 mm \u00b7 1 un \u00b7 corredera$/);
});

test('🔒 el N.o que puso el CLIENTE manda sobre nuestro correlativo', () => {
  const out = formatListaVentanas([{ posicion: 'V7', measures: '1000x1000', qty: 1 }], { encabezado: false });
  assert.match(out, /^V7 \u00b7/, 'si el cliente numero sus ventanas, ese numero es el que conoce');
});

test('🔒 sin posicion, se numera 1,2,3 — nunca queda una fila sin identificar', () => {
  const out = formatListaVentanas(
    [{ measures: '1000x1000' }, { measures: '2000x2000' }], { encabezado: false });
  const filas = out.split('\n');
  assert.match(filas[0], /^1 \u00b7/);
  assert.match(filas[1], /^2 \u00b7/);
});

test('🔒 "NO ESPECIFICADO" de la vision NO se le muestra al cliente (es ruido, no dato)', () => {
  const out = formatListaVentanas(
    [{ posicion: 'V1', ambiente: 'NO ESPECIFICADO', product: 'corredera', measures: '1000x1000' }],
    { encabezado: false });
  assert.ok(!/NO ESPECIFICADO/i.test(out), 'se muestra una raya, no la muletilla del modelo');
  assert.match(out, /\u2014/);
});

test('🔴 una medida que no se entiende sale con RAYA, jamas inventada', () => {
  // Si le mostramos una medida inventada, la confirma sin mirar y fabricamos mal.
  const out = formatListaVentanas([{ posicion: 'V1', measures: 'ilegible', qty: 1 }], { encabezado: false });
  assert.match(out, /\u2014 \u00d7 \u2014 mm/);
});

test('🔒 el encabezado dice cuantas son y pide revisarlas una por una', () => {
  const out = formatListaVentanas(LISTA_REAL);
  assert.match(out, /3 ventanas/);
  assert.match(out, /una por una/);
  assert.match(out, /N\u00b0 \u00b7 lugar \u00b7 ancho \u00d7 alto \u00b7 cantidad \u00b7 modelo/, 'la leyenda de columnas');
});

test('🔒 singular cuando es una sola', () => {
  assert.match(formatListaVentanas([{ measures: '1000x1000' }]), /1 ventana\./);
});

test('🔒 sin items devuelve vacio (no un encabezado hablando de la nada)', () => {
  assert.equal(formatListaVentanas([]), '');
  assert.equal(formatListaVentanas(null), '');
});

test('🔒 SIN BACKTICKS: un backtick desbalanceado rompe el markup de TODO el mensaje', () => {
  const out = formatListaVentanas(LISTA_REAL);
  assert.ok(!out.includes('`'), 'nada de bloques monoespaciados en WhatsApp');
});

test('🔒 medidasDe lee las tres formas en que llegan las medidas en este repo', () => {
  assert.deepEqual(medidasDe({ ancho_mm: 2710, alto_mm: 1995 }), { ancho_mm: 2710, alto_mm: 1995 });
  assert.deepEqual(medidasDe({ measures: '2710x1995mm' }), { ancho_mm: 2710, alto_mm: 1995 });
  assert.deepEqual(medidasDe({ measures: '2710 \u00d7 1995' }), { ancho_mm: 2710, alto_mm: 1995 });
  assert.deepEqual(medidasDe({}), { ancho_mm: null, alto_mm: null });
});
