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
