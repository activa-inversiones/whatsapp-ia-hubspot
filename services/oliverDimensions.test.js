// oliverDimensions.test.js — RED ANTI-REGRESIÓN Oliver — GT-06 (corredera piso-cielo → referencial, no escala)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDimensionsLocal } from './enginePricer.js';

test('GT-06: corredera piso-cielo (alto>2150) → REFERENCIAL+clamp, NO escala (eso mataba el PDF)', () => {
  const r = validateDimensionsLocal('CORREDERA', 2500, 2250); // alto 2250 > max 2150
  assert.ok(r, 'debe devolver resultado');
  assert.equal(r.referencial, true, 'debe ser referencial (cotizable acotado)');
  assert.ok(!r.escalate, 'NO debe escalar — escalar dejaba grand_total=null → sin PDF (caso Dalia)');
  assert.equal(r.clampAlto, 2150, 'acota el alto al máximo estándar');
  assert.ok(r.clampAncho >= 2500, 'el clamp de ancho no recorta una medida que sí cabe');
});

test('corredera dentro de rango → null (cotiza normal, sin avisos)', () => {
  assert.equal(validateDimensionsLocal('CORREDERA', 2000, 2000), null);
});

test('puerta fuera de rango → referencial (alineada con index.js, no escala)', () => {
  const r = validateDimensionsLocal('PUERTA', 3000, 3000);
  assert.ok(r && r.referencial === true && !r.escalate, 'puerta grande: referencial, no escalar');
});

test('el engine y index.js NO divergen: corredera grande NUNCA devuelve escalate:true', () => {
  // Era el bug raíz: enginePricer escalaba, index.js cotizaba referencial → el PDF nunca salía.
  const r = validateDimensionsLocal('CORREDERA', 3500, 2400);
  assert.notEqual(r?.escalate, true, 'la corredera grande no debe escalar en el engine');
});
