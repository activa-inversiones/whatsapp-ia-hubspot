// services/enginePricer.test.js — node:test
//
// (a) mapeo de apertura (proyectante→PROYECTANTE, corredera→CORREDERA,
//     default→CORREDERA, NUNCA TERMOPANEL)
// (b) GOLDEN EN VIVO: priceAllEngine contra el ACTIVA Engine real
// (c) el 'tipo' enviado al Engine NUNCA es TERMOPANEL
//
// Ejecutar desde temp-wa:  node --test services/enginePricer.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { mapAperturaToEngine, priceAllEngine } from "./enginePricer.js";

const APERTURAS_ENGINE = new Set([
  "CORREDERA",
  "PROYECTANTE",
  "FIJA",
  "BATIENTE",
  "OSCILOBATIENTE",
]);

// ── (a) mapeo de apertura ────────────────────────────────────────
test("mapAperturaToEngine: proyectante → PROYECTANTE", () => {
  assert.equal(mapAperturaToEngine("ventana proyectante"), "PROYECTANTE");
});

test("mapAperturaToEngine: corredera → CORREDERA", () => {
  assert.equal(mapAperturaToEngine("ventana corredera"), "CORREDERA");
});

test("mapAperturaToEngine: desconocido → CORREDERA (default)", () => {
  assert.equal(mapAperturaToEngine("algo raro"), "CORREDERA");
  assert.equal(mapAperturaToEngine(""), "CORREDERA");
  assert.equal(mapAperturaToEngine(undefined), "CORREDERA");
});

test("mapAperturaToEngine: abatible → BATIENTE, fijo → FIJA, oscilo → OSCILOBATIENTE", () => {
  assert.equal(mapAperturaToEngine("ventana abatible"), "BATIENTE");
  assert.equal(mapAperturaToEngine("marco fijo"), "FIJA");
  assert.equal(mapAperturaToEngine("oscilobatiente"), "OSCILOBATIENTE");
});

// ── (c) el tipo NUNCA es TERMOPANEL ──────────────────────────────
test("mapAperturaToEngine: NUNCA devuelve TERMOPANEL y siempre es apertura válida", () => {
  const entradas = [
    "termopanel",
    "ventana termopanel",
    "TERMOPANEL DVH",
    "ventana proyectante termopanel",
    "vidrio termopanel 4+12+4",
    "corredera",
    "lo que sea",
  ];
  for (const e of entradas) {
    const out = mapAperturaToEngine(e);
    assert.notEqual(out, "TERMOPANEL", `mapeo de '${e}' no debe ser TERMOPANEL`);
    assert.ok(
      APERTURAS_ENGINE.has(out),
      `mapeo de '${e}' debe ser apertura válida, fue '${out}'`
    );
  }
});

// ── (b) GOLDEN EN VIVO ───────────────────────────────────────────
// 10 × ventana proyectante 1m² (1000x1000) nogal, comuna Temuco.
// Referencia PDF real: ~3.3M CLP con IVA.
test("GOLDEN EN VIVO: priceAllEngine 10× proyectante 1m² nogal Temuco → ok, total>0", async () => {
  const d = {
    items: [
      { product: "ventana proyectante", measures: "1000x1000", color: "nogal", qty: 10 },
    ],
    comuna: "Temuco",
  };

  const res = await priceAllEngine(d, "+56900000000");

  // Registramos el total para inspección manual vs PDF (~3.3M con IVA).
  console.log("GOLDEN total:", res.total, "| res:", JSON.stringify(res));

  assert.equal(res.ok, true, `esperado ok:true, fue: ${JSON.stringify(res)}`);
  assert.equal(res.source, "activa_engine");
  assert.equal(res.escalate, false);
  assert.ok(typeof res.total === "number" && res.total > 0, "total debe ser > 0");

  // Verifica que los campos del item se hayan seteado.
  const it = d.items[0];
  assert.equal(it.source, "activa_engine");
  assert.equal(it.confidence, "high");
  assert.ok(it.total_price > 0, "total_price del item debe ser > 0");
  assert.ok(it.unit_price > 0, "unit_price del item debe ser > 0");
  assert.equal(it.total_price, res.total, "suma de líneas == total");
});
