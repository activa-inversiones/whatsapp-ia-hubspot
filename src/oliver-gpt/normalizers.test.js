import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractComuna,
  detectConfirmation,
  normColor,
  sanitizeChilean,
  normMeasures,
} from "./normalizers.js";

/* ─── (a) extractComuna — FIX #4 ──────────────────────────────────────── */
test("extractComuna detecta comuna compuesta en texto libre", () => {
  assert.equal(
    extractComuna("vivo en Padre Las Casas, busco ventanas"),
    "Padre Las Casas"
  );
});

test("extractComuna devuelve null cuando no hay comuna", () => {
  assert.equal(extractComuna("hola"), null);
});

test("extractComuna es insensible a acentos y mayúsculas", () => {
  assert.equal(extractComuna("estoy en PUCON"), "Pucón");
  assert.equal(extractComuna("soy de pucón"), "Pucón");
});

/* ─── (b) detectConfirmation — FIX #3 ─────────────────────────────────── */
test("detectConfirmation true para 'si'", () => {
  assert.equal(detectConfirmation("si"), true);
});

test("detectConfirmation true para 'confirmo'", () => {
  assert.equal(detectConfirmation("confirmo"), true);
});

test("detectConfirmation true para variantes (dale, listo, de acuerdo, sí con tilde)", () => {
  assert.equal(detectConfirmation("dale"), true);
  assert.equal(detectConfirmation("listo"), true);
  assert.equal(detectConfirmation("de acuerdo"), true);
  assert.equal(detectConfirmation("sí"), true);
  assert.equal(detectConfirmation("así es"), true);
});

test("detectConfirmation false para una pregunta", () => {
  assert.equal(detectConfirmation("cuánto cuesta?"), false);
});

/* ─── (c) normColor — sin "GRIS" ──────────────────────────────────────── */
test("normColor('plomo') devuelve color de catálogo válido (no GRIS)", () => {
  const STOCK = ["BLANCO", "NOGAL", "ROBLE", "GRAFITO", "NEWBLACK"];
  const c = normColor("plomo");
  assert.ok(STOCK.includes(c), `esperaba color stock, obtuve ${c}`);
  assert.notEqual(c, "GRIS");
  assert.equal(c, "GRAFITO");
});

/* ─── (d) sanitizeChilean — anti-voseo ────────────────────────────────── */
test("sanitizeChilean reescribe 'vos podés' sin voseo", () => {
  const out = sanitizeChilean("vos podés");
  assert.equal(/\bpodés\b/i.test(out), false, "no debe quedar 'podés'");
  assert.equal(/\bvos\b/i.test(out), false, "no debe quedar 'vos'");
  assert.equal(out, "usted puede");
});

/* ─── (e) normMeasures — caso típico → mm ─────────────────────────────── */
test("normMeasures de caso típico devuelve ancho/alto en mm", () => {
  const m = normMeasures("3 ventanas 1500x1200");
  assert.deepEqual(m, { ancho_mm: 1500, alto_mm: 1200 });
});

test("normMeasures normaliza metros a mm", () => {
  const m = normMeasures("1.5 x 1.2");
  assert.deepEqual(m, { ancho_mm: 1500, alto_mm: 1200 });
});
