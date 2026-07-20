// services/productoFueraDeAlcance.test.js — node:test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectarProductoFueraDeAlcance,
  MENSAJE_PRODUCTO_FUERA_DE_ALCANCE,
} from './productoFueraDeAlcance.js';

test('detecta las cinco categorías mínimas fuera del alcance', () => {
  const casos = [
    ['Quiero una mosquitera para la ventana', 'mosquitero'],
    ['Necesito cotizar una puerta de patio', 'puerta'],
    ['Busco una ventana plegable tipo acordeón', 'plegable'],
    ['Quiero una ventana circular para el living', 'forma_irregular'],
    ['Quiero cotizar una ventana de la línea Andes', 'linea_no_soportada'],
  ];

  for (const [texto, categoria] of casos) {
    const resultado = detectarProductoFueraDeAlcance(texto);
    assert.equal(resultado.fueraDeAlcance, true, texto);
    assert.equal(resultado.categoria, categoria, texto);
    assert.equal(resultado.razon, `producto_fuera_de_alcance:${categoria}`, texto);
    assert.equal(resultado.mensajeCliente, MENSAJE_PRODUCTO_FUERA_DE_ALCANCE, texto);
  }
});

test('detecta variantes chilenas precisas sin depender del LLM', () => {
  const casos = [
    ['malla mosquitera', 'mosquitero'],
    ['tipo acordeon', 'plegable'],
    ['ventana redonda', 'forma_irregular'],
    ['ventana en arco', 'forma_irregular'],
    ['ventana hexagonal', 'forma_irregular'],
    ['sistema americano', 'linea_no_soportada'],
    ['línea Zenia', 'linea_no_soportada'],
    ['serie Venau', 'linea_no_soportada'],
  ];

  for (const [texto, categoria] of casos) {
    assert.equal(detectarProductoFueraDeAlcance(texto).categoria, categoria, texto);
  }
});

test('usa tipo y serie normalizados como segunda señal determinística', () => {
  assert.equal(
    detectarProductoFueraDeAlcance('', { tipo: 'PUERTA' }).categoria,
    'puerta',
  );
  assert.equal(
    detectarProductoFueraDeAlcance('', { serie: 'SOLO_MOSQUITERO' }).categoria,
    'mosquitero',
  );
  assert.equal(
    detectarProductoFueraDeAlcance('', { serie: 'S60_PLEGABLES' }).categoria,
    'plegable',
  );
  assert.equal(
    detectarProductoFueraDeAlcance('', { serie: 'FORMAS_IRREGULARES_S60' }).categoria,
    'forma_irregular',
  );
  assert.equal(
    detectarProductoFueraDeAlcance('', { serie: 'ANDES' }).categoria,
    'linea_no_soportada',
  );
});

test('no bloquea aperturas normales ni confunde la comuna Los Andes con una línea', () => {
  const textos = [
    'Quiero una ventana corredera normal de 120x100',
    'Necesito una ventana proyectante para el baño',
    'Cotizar una ventana fija de 100x80',
    'Busco una ventana oscilobatiente',
    'Necesito ventanas para una casa en Los Andes',
    'Quiero una ventana corredera al lado de la puerta de entrada',
    'Quiero una corredera normal, sin mosquitero',
    'No quiero una puerta, necesito una ventana fija',
    'Quiero una ventana rectangular, no circular',
    'Que no sea línea Andes; necesito una S60',
  ];

  for (const texto of textos) {
    assert.deepEqual(
      detectarProductoFueraDeAlcance(texto),
      { fueraDeAlcance: false, categoria: null, razon: null, mensajeCliente: null },
      texto,
    );
  }

  for (const tipo of ['CORREDERA', 'PROYECTANTE', 'FIJA', 'BATIENTE', 'OSCILOBATIENTE']) {
    assert.equal(
      detectarProductoFueraDeAlcance('', { tipo, serie: tipo === 'CORREDERA' ? 'SLIDING' : 'S60' }).fueraDeAlcance,
      false,
      tipo,
    );
  }
});

test('el mensaje al cliente es honesto, comercial y no dice "no puedo"', () => {
  assert.match(MENSAJE_PRODUCTO_FUERA_DE_ALCANCE, /Marcelo.*personalmente.*precio exacto/i);
  assert.doesNotMatch(MENSAJE_PRODUCTO_FUERA_DE_ALCANCE, /no puedo/i);
});

// ── [Ronda 2 2026-07-20] Regresiones de la revisión cruzada (Codex + workflow 152 agentes) ──

test('Ronda 2: el enum REAL de update_quote (V1) dispara la guarda — antes era no-op', () => {
  // "_" cuenta como \w y rompía \b: PUERTA_1H pasaba y se cotizaba como CORREDERA.
  assert.equal(detectarProductoFueraDeAlcance('PUERTA_1H').categoria, 'puerta');
  assert.equal(detectarProductoFueraDeAlcance('PUERTA_DOBLE').categoria, 'puerta');
});

test('Ronda 2: falsos negativos cazados — ventanal singular y ventana americana', () => {
  assert.equal(detectarProductoFueraDeAlcance('un ventanal plegable para el quincho').categoria, 'plegable');
  assert.equal(detectarProductoFueraDeAlcance('quiero una ventana americana').categoria, 'linea_no_soportada');
});

test('Ronda 2: negación con verbo NO escala — "sin incluir malla mosquitera"', () => {
  const r = detectarProductoFueraDeAlcance('una corredera de 2 hojas sin incluir malla mosquitera');
  assert.equal(r.fueraDeAlcance, false);
});

test('Ronda 2: proximidad de forma — adyacente y cercana detectan, lejana NO', () => {
  assert.equal(detectarProductoFueraDeAlcance('una ventana que sea redonda').categoria, 'forma_irregular');
  assert.equal(
    detectarProductoFueraDeAlcance('ventana proyectante al lado de un arco decorativo').fueraDeAlcance,
    false,
  );
});

test('Ronda 2: los valores legítimos del enum V1 siguen pasando', () => {
  for (const p of ['CORREDERA', 'PROYECTANTE', 'ABATIBLE', 'OSCILOBATIENTE', 'MARCO_FIJO']) {
    assert.equal(detectarProductoFueraDeAlcance(p).fueraDeAlcance, false, p);
  }
});

// ── [Ronda 2.1 2026-07-20] Regresiones exigidas por la revisión Codex de la Ronda 2 ──

test('Ronda 2.1: puntuación y conectores en formas (Codex)', () => {
  assert.equal(detectarProductoFueraDeAlcance('quiero una ventana, redonda').categoria, 'forma_irregular');
  assert.equal(detectarProductoFueraDeAlcance('una ventana en forma de arco').categoria, 'forma_irregular');
  assert.equal(detectarProductoFueraDeAlcance('la ventana junto al arco decorativo').fueraDeAlcance, false);
  assert.equal(detectarProductoFueraDeAlcance('una ventana con vista al arco').fueraDeAlcance, false);
});

test('Ronda 2.1: negaciones compuestas (Codex)', () => {
  assert.equal(detectarProductoFueraDeAlcance('una ventana sin que sea redonda').fueraDeAlcance, false);
  assert.equal(
    detectarProductoFueraDeAlcance('cotiza la corredera, sin incluir la puerta ventana plegable').fueraDeAlcance,
    false,
  );
});

test('Ronda 2.2: conectores que la 2.1 dejó fuera (regresión Codex)', () => {
  assert.equal(detectarProductoFueraDeAlcance('ventana con forma de arco').categoria, 'forma_irregular');
  assert.equal(detectarProductoFueraDeAlcance('ventana completamente redonda').categoria, 'forma_irregular');
  assert.equal(detectarProductoFueraDeAlcance('ventana que debe ser redonda').categoria, 'forma_irregular');
  // y los negativos de la 2.1 siguen sin escalar ("con" no reabre el falso positivo)
  assert.equal(detectarProductoFueraDeAlcance('una ventana con vista al arco').fueraDeAlcance, false);
  assert.equal(detectarProductoFueraDeAlcance('la ventana junto al arco decorativo').fueraDeAlcance, false);
});

test('Ronda 2.3: tortura Codex — artículo = objeto de escena, no producto', () => {
  // cadenas naturales largas SÍ escalan (ventana {0,4} + conectores sin artículo)
  assert.equal(detectarProductoFueraDeAlcance('ventana que tenga forma de arco').categoria, 'forma_irregular');
  assert.equal(detectarProductoFueraDeAlcance('ventana que debe ser completamente redonda').categoria, 'forma_irregular');
  // artículo antes de la forma = objeto del entorno → NO escala
  assert.equal(detectarProductoFueraDeAlcance('una ventana con el arco decorativo al fondo').fueraDeAlcance, false);
  // y todo lo anterior sigue igual
  assert.equal(detectarProductoFueraDeAlcance('ventana con forma de arco').categoria, 'forma_irregular');
  assert.equal(detectarProductoFueraDeAlcance('ventana completamente redonda').categoria, 'forma_irregular');
  assert.equal(detectarProductoFueraDeAlcance('una ventana con vista al arco').fueraDeAlcance, false);
  assert.equal(detectarProductoFueraDeAlcance('la ventana junto al arco decorativo').fueraDeAlcance, false);
});
