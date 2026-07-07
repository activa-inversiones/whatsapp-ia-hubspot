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

// ── [2026-07-06 LOTE2] Bajo mínimo = referencial clamp-UP (caso real: proyectante baño 350×600) ──
import { normMeasuresLocal } from './enginePricer.js';
import { test as testL2 } from 'node:test';
import assertL2 from 'node:assert/strict';

testL2('LOTE2: bajo mínimo → referencial clamp-up, NUNCA escalate', () => {
  const d = validateDimensionsLocal('PROYECTANTE', 350, 600);
  assertL2.ok(d && d.referencial === true && !d.escalate, 'ventana bajo mínimo debe ser referencial');
  assertL2.equal(d.clampMinAncho, 400, 'clamp-up SOLO en la dimensión que falta');
  assertL2.equal(d.clampMinAlto, 0, 'el alto 600 ya cumple el mínimo → no se toca');
  const c = validateDimensionsLocal('CORREDERA', 450, 600);
  assertL2.ok(c && c.referencial === true && !c.escalate);
  assertL2.equal(c.clampMinAncho, 500);
  const p = validateDimensionsLocal('PUERTA', 700, 1400);
  assertL2.ok(p && p.referencial === true && !p.escalate);
  assertL2.equal(p.clampMinAncho, 800);
  assertL2.equal(p.clampMinAlto, 1500);
});

testL2('LOTE2: dentro de rango sigue devolviendo null (sin regresión)', () => {
  assertL2.equal(validateDimensionsLocal('PROYECTANTE', 400, 400), null);
  assertL2.equal(validateDimensionsLocal('CORREDERA', 500, 500), null);
  assertL2.equal(validateDimensionsLocal('PROYECTANTE', 1930, 1930), null);
});

testL2('LOTE2: normMeasuresLocal respeta sufijo "mm" explícito (sin re-manglar ×10)', () => {
  assertL2.deepEqual(normMeasuresLocal('350x600mm'), { ancho_mm: 350, alto_mm: 600 });
  assertL2.deepEqual(normMeasuresLocal('3500x600mm'), { ancho_mm: 3500, alto_mm: 600 });
  assertL2.deepEqual(normMeasuresLocal('350x600'), { ancho_mm: 3500, alto_mm: 600 }, 'sin sufijo: heurística histórica intacta');
  assertL2.deepEqual(normMeasuresLocal('1,40x1,00 mm'), { ancho_mm: 1400, alto_mm: 1000 }, 'metros mal etiquetados como mm → heurística (umbral ≥100)');
});

testL2('LOTE2: formato interno estricto — solo "AxBmm" exacto es literal; texto de cliente va a heurística', () => {
  assertL2.deepEqual(normMeasuresLocal('80x90mm'), { ancho_mm: 80, alto_mm: 90 }, 'sin umbral 100: literal (escéptico L2)');
  assertL2.deepEqual(normMeasuresLocal('140x100 mm'), { ancho_mm: 1400, alto_mm: 1000 }, 'espacio antes de mm = texto de cliente → heurística histórica');
  // Fuera de bounds ([50,6000]) el literal NO aplica y cae a la heurística; medidas absurdas las
  // frena validateDimensionsLocal / el guard de plausibilidad aguas arriba, no esta función.
});
