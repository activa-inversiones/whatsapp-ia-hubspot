// oliverUnits.test.js — RED ANTI-REGRESIÓN Oliver — G6 (no asumir unidades)
// Casos reales: "150x150" (cm confundido con mm → error 10× en cotización),
// "8 cm de ancho" (físicamente imposible), "1.80 de alto" (sin unidad clara).
// El bot trabaja en mm; una medida plausible parte desde ~300mm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isMeasureSuspicious,
  looksLikeUnitAmbiguous,
  askUnitsMessage,
  VENTANA_MIN_MM,
  VENTANA_ABSURDO_MM,
} from './oliverUnits.js';

// ── isMeasureSuspicious — casos normales (ni suspicious ni absurd) ───────────

test('G6: 1200×1000mm → ni suspicious ni absurd (medidas normales)', () => {
  const r = isMeasureSuspicious(1200, 1000);
  assert.equal(r.suspicious, false, '1200×1000mm es plausible');
  assert.equal(r.absurd, false);
  assert.equal(r.reason, '');
});

test('G6: VENTANA_MIN_MM (300) exacto en ambos lados → normal', () => {
  const r = isMeasureSuspicious(VENTANA_MIN_MM, VENTANA_MIN_MM);
  assert.equal(r.suspicious, false, '300×300mm es el límite mínimo plausible');
  assert.equal(r.absurd, false);
});

test('G6: medidas grandes corredera → normal', () => {
  const r = isMeasureSuspicious(2930, 2150);
  assert.equal(r.suspicious, false, 'corredera máxima es válida');
  assert.equal(r.absurd, false);
});

// ── isMeasureSuspicious — suspicious (probable cm escrito como mm) ───────────

test('G6: 150×150 → suspicious=true, absurd=false (caso real)', () => {
  const r = isMeasureSuspicious(150, 150);
  assert.equal(r.suspicious, true, '150mm es probable cm confundido con mm');
  assert.equal(r.absurd, false, 'no es absurdo, es ambiguo');
  assert.match(r.reason, /150/, 'reason debe mencionar la medida');
  assert.match(r.reason, /cent[ií]metros|cm/i, 'reason debe mencionar cm');
});

test('G6: 299×1200 → suspicious=true (un solo lado sospechoso)', () => {
  const r = isMeasureSuspicious(299, 1200);
  assert.equal(r.suspicious, true, '299mm sospechoso (justo bajo el límite)');
  assert.equal(r.absurd, false);
  assert.match(r.reason, /299/, 'reason debe mencionar 299');
});

test('G6: VENTANA_MIN_MM - 1 en ancho → suspicious', () => {
  const r = isMeasureSuspicious(VENTANA_MIN_MM - 1, 1500);
  assert.equal(r.suspicious, true);
  assert.equal(r.absurd, false);
});

// ── isMeasureSuspicious — absurd (físicamente imposible) ─────────────────────

test('G6: 80×1800 → absurd=true (caso real: "8 cm ancho")', () => {
  // 8 cm = 80mm → absurdo
  const r = isMeasureSuspicious(80, 1800);
  assert.equal(r.absurd, true, '80mm es absurdo para una ventana');
  assert.equal(r.suspicious, false, 'absurd toma precedencia');
  assert.match(r.reason, /80/, 'reason debe mencionar 80');
  assert.match(r.reason, /imposible|imposibles/i, 'reason debe explicar');
});

test('G6: 1×1 → absurd=true (trivialmente imposible)', () => {
  const r = isMeasureSuspicious(1, 1);
  assert.equal(r.absurd, true);
  assert.equal(r.suspicious, false);
});

test('G6: VENTANA_ABSURDO_MM - 1 exacto → absurd=true (límite)', () => {
  const r = isMeasureSuspicious(VENTANA_ABSURDO_MM - 1, 1200);
  assert.equal(r.absurd, true, 'justo bajo el umbral absurdo');
});

test('G6: VENTANA_ABSURDO_MM exacto (100) → NOT absurd, pero < MIN → suspicious', () => {
  // 100mm NO es "< VENTANA_ABSURDO_MM" (100 < 100 es false) → cae en suspicious
  const r = isMeasureSuspicious(100, 1200);
  assert.equal(r.absurd, false, '100mm exacto no es absurdo por la regla < 100');
  assert.equal(r.suspicious, true, '100mm < 300mm → suspicious');
});

// ── looksLikeUnitAmbiguous ───────────────────────────────────────────────────

test('G6: "150x150" → ambiguo (rango cm/mm, sin unidad)', () => {
  assert.equal(looksLikeUnitAmbiguous('150x150'), true);
});

test('G6: "150 x 150" (con espacios) → ambiguo', () => {
  assert.equal(looksLikeUnitAmbiguous('150 x 150'), true);
});

test('G6: "60x80" → ambiguo', () => {
  assert.equal(looksLikeUnitAmbiguous('60x80'), true);
});

test('G6: "1200x1000" → false (números ≥ 400, claramente mm)', () => {
  assert.equal(looksLikeUnitAmbiguous('1200x1000'), false);
});

test('G6: "150x150 mm" → false (unidad explícita)', () => {
  assert.equal(looksLikeUnitAmbiguous('150x150 mm'), false);
});

test('G6: "150x150 cm" → false (unidad explícita)', () => {
  assert.equal(looksLikeUnitAmbiguous('150x150 cm'), false);
});

test('G6: "1,50x1,50" → false (decimales con coma → metros obvios)', () => {
  assert.equal(looksLikeUnitAmbiguous('1,50x1,50'), false);
});

test('G6: "quiero 3 ventanas" → false (no hay patrón NxN)', () => {
  assert.equal(looksLikeUnitAmbiguous('quiero 3 ventanas'), false);
});

test('G6: string vacío → false', () => {
  assert.equal(looksLikeUnitAmbiguous(''), false);
});

test('G6: "400x400" → false (≥400, claramente mm)', () => {
  assert.equal(looksLikeUnitAmbiguous('400x400'), false);
});

// ── askUnitsMessage ──────────────────────────────────────────────────────────

test('G6: askUnitsMessage devuelve string con "centímetros" y "milímetros"', () => {
  const msg = askUnitsMessage();
  assert.equal(typeof msg, 'string');
  assert.match(msg, /cent[ií]metros/i, 'debe mencionar centímetros');
  assert.match(msg, /mil[ií]metros/i, 'debe mencionar milímetros');
});

test('G6: askUnitsMessage con detail lo incluye en la respuesta', () => {
  const msg = askUnitsMessage('60×80');
  assert.match(msg, /60/, 'debe incluir el detalle');
  assert.match(msg, /cent[ií]metros/i);
  assert.match(msg, /mil[ií]metros/i);
});

test('G6: askUnitsMessage sin detail no genera doble paréntesis ni espacios raros', () => {
  const msg = askUnitsMessage('');
  assert.doesNotMatch(msg, /\(\)/, 'no debe tener paréntesis vacíos');
  assert.doesNotMatch(msg, /  /, 'no debe tener doble espacio');
  assert.match(msg, /cent[ií]metros/i);
  assert.match(msg, /mil[ií]metros/i);
});
