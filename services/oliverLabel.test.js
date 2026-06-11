// oliverLabel.test.js — RED ANTI-REGRESIÓN Oliver — G4 (tipo equivocado en resumen de cotización)
// Casos reales: 07af59d0 "puerta corredera" → mostró "Ventana corredera";
//               096cd370 ítem "fijo" → mostró "CORREDERA" (default global erróneo).
// Exige: el tipo se deriva del ÍTEM, nunca de un default global.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productKind, aperturaLabel, itemTypeLabel } from './oliverLabel.js';

// ── productKind ───────────────────────────────────────────────────────────────

test('G4 productKind: "puerta pvc corredera" → puerta', () => {
  assert.equal(productKind({ product: 'puerta pvc corredera' }), 'puerta');
});

test('G4 productKind: "puerta batiente" → puerta', () => {
  assert.equal(productKind({ product: 'puerta batiente' }), 'puerta');
});

test('G4 productKind: "puerta pvc" → puerta', () => {
  assert.equal(productKind({ product: 'puerta pvc' }), 'puerta');
});

test('G4 productKind: "ventana corredera" → ventana', () => {
  assert.equal(productKind({ product: 'ventana corredera' }), 'ventana');
});

test('G4 productKind: "ventana proyectante" → ventana', () => {
  assert.equal(productKind({ product: 'ventana proyectante' }), 'ventana');
});

test('G4 productKind: "marco fijo" → ventana (marco es marco de ventana)', () => {
  assert.equal(productKind({ product: 'marco fijo' }), 'ventana');
});

test('G4 productKind: "mampara baño" → mampara', () => {
  assert.equal(productKind({ product: 'mampara baño' }), 'mampara');
});

// ── aperturaLabel ─────────────────────────────────────────────────────────────

test('G4 aperturaLabel: toma item.tipo explícito (CORREDERA → "corredera")', () => {
  assert.equal(aperturaLabel({ tipo: 'CORREDERA' }), 'corredera');
});

test('G4 aperturaLabel: toma item.tipo FIJA → "fija"', () => {
  assert.equal(aperturaLabel({ tipo: 'FIJA' }), 'fija');
});

test('G4 aperturaLabel: toma item.tipo PROYECTANTE → "proyectante"', () => {
  assert.equal(aperturaLabel({ tipo: 'PROYECTANTE' }), 'proyectante');
});

test('G4 aperturaLabel: toma item.tipo BATIENTE → "batiente"', () => {
  assert.equal(aperturaLabel({ tipo: 'BATIENTE' }), 'batiente');
});

test('G4 aperturaLabel: toma item.tipo OSCILOBATIENTE → "oscilobatiente"', () => {
  assert.equal(aperturaLabel({ tipo: 'OSCILOBATIENTE' }), 'oscilobatiente');
});

test('G4 aperturaLabel: usa item.apertura si no hay item.tipo', () => {
  assert.equal(aperturaLabel({ apertura: 'FIJA' }), 'fija');
});

test('G4 aperturaLabel: deduce "fija" desde product "marco fijo" cuando no hay tipo', () => {
  assert.equal(aperturaLabel({ product: 'marco fijo' }), 'fija');
});

test('G4 aperturaLabel: deduce "corredera" desde product "ventana corredera"', () => {
  assert.equal(aperturaLabel({ product: 'ventana corredera' }), 'corredera');
});

test('G4 aperturaLabel: sin info → "" (NO inventa "corredera")', () => {
  assert.equal(aperturaLabel({}), '');
  assert.equal(aperturaLabel({ product: 'ventana pvc' }), '');
  assert.equal(aperturaLabel(null), '');
});

// ── itemTypeLabel — casos del bug real ────────────────────────────────────────

test('G4 (caso 07af59d0): puerta corredera → "Puerta corredera", NUNCA "Ventana corredera"', () => {
  const label = itemTypeLabel({ product: 'puerta corredera', tipo: 'CORREDERA' });
  assert.match(label, /Puerta corredera/);
  assert.doesNotMatch(label, /[Vv]entana/);
});

test('G4 (caso 096cd370): ítem fijo → contiene "fija", NUNCA "corredera"', () => {
  const label = itemTypeLabel({ product: 'marco fijo', tipo: 'FIJA' });
  assert.match(label, /fija/i);
  assert.doesNotMatch(label, /[Cc]orredera/);
});

test('G4: ventana proyectante → "Ventana proyectante"', () => {
  const label = itemTypeLabel({ product: 'ventana proyectante', tipo: 'PROYECTANTE' });
  assert.match(label, /Ventana proyectante/);
});

test('G4: ventana corredera → "Ventana corredera"', () => {
  const label = itemTypeLabel({ product: 'ventana corredera', tipo: 'CORREDERA' });
  assert.match(label, /Ventana corredera/);
  assert.doesNotMatch(label, /[Pp]uerta/);
});

test('G4: puerta batiente → "Puerta batiente", no "Ventana"', () => {
  const label = itemTypeLabel({ product: 'puerta batiente', tipo: 'BATIENTE' });
  assert.match(label, /Puerta batiente/);
  assert.doesNotMatch(label, /[Vv]entana/);
});

test('G4: mampara sin apertura → "Mampara" (sin inventar tipo)', () => {
  const label = itemTypeLabel({ product: 'mampara baño' });
  assert.match(label, /Mampara/);
});

// ── invariantes duras (no romper nunca) ────────────────────────────────────────

test('G4 invariante: un ítem fijo NUNCA devuelve "corredera"', () => {
  const fijoConTipo  = itemTypeLabel({ product: 'ventana pvc', tipo: 'FIJA' });
  const fijoDesdeNombre = itemTypeLabel({ product: 'marco fijo' });
  assert.doesNotMatch(fijoConTipo,    /[Cc]orredera/);
  assert.doesNotMatch(fijoDesdeNombre, /[Cc]orredera/);
});

test('G4 invariante: una puerta NUNCA devuelve "Ventana"', () => {
  for (const p of ['puerta pvc corredera', 'puerta batiente', 'puerta pvc', 'puerta corredera']) {
    const label = itemTypeLabel({ product: p, tipo: 'CORREDERA' });
    assert.doesNotMatch(label, /[Vv]entana/, `"${p}" no debe llamarse Ventana`);
  }
});

test('G4 invariante: una ventana NUNCA devuelve "Puerta"', () => {
  for (const p of ['ventana corredera', 'ventana proyectante', 'marco fijo']) {
    const label = itemTypeLabel({ product: p, tipo: 'CORREDERA' });
    assert.doesNotMatch(label, /[Pp]uerta/, `"${p}" no debe llamarse Puerta`);
  }
});
