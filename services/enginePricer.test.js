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
import { MENSAJE_PRODUCTO_FUERA_DE_ALCANCE } from "./productoFueraDeAlcance.js";

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

test("mapAperturaToEngine: PUERTA no cae silenciosamente en CORREDERA", () => {
  assert.throws(
    () => mapAperturaToEngine("puerta de patio"),
    /producto_fuera_de_alcance:puerta/i,
  );
});

test("mapAperturaToEngine: abatible → BATIENTE, fijo → FIJA, oscilo → OSCILOBATIENTE", () => {
  assert.equal(mapAperturaToEngine("ventana abatible"), "BATIENTE");
  assert.equal(mapAperturaToEngine("marco fijo"), "FIJA");
  assert.equal(mapAperturaToEngine("oscilobatiente"), "OSCILOBATIENTE");
});

// [REGRESIÓN 2026-06-24 — BUG RAÍZ COTIZADOR] El enum real es "FIJA"/"BATIENTE" y el label del
// PDF dice "Fija"; antes normTipoAperturaLocal solo veía "fijo"/"abatible" → "FIJA"/"BATIENTE" caían
// al fallback CORREDERA y se cotizaban como corredera (~2x). Estos casos DEBEN devolver su apertura.
test("mapAperturaToEngine: FIJA/BATIENTE y variantes NO caen a CORREDERA (bug 0064-0066)", () => {
  assert.equal(mapAperturaToEngine("FIJA"), "FIJA");
  assert.equal(mapAperturaToEngine("fija"), "FIJA");
  assert.equal(mapAperturaToEngine("fijas"), "FIJA");
  assert.equal(mapAperturaToEngine("Ventana Fija PVC línea europea"), "FIJA");
  assert.equal(mapAperturaToEngine("BATIENTE"), "BATIENTE");
  assert.equal(mapAperturaToEngine("ventana batiente"), "BATIENTE");
  // y no romper lo que ya andaba:
  assert.equal(mapAperturaToEngine("CORREDERA"), "CORREDERA");
  assert.equal(mapAperturaToEngine("Corredera SLIDING H80 Doble Riel S75"), "CORREDERA");
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
test("priceAllEngine: PUERTA escala sin llamar al Engine ni entregar precio", async () => {
  const fetchOriginal = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("el Engine no debe llamarse para una puerta");
  };

  const d = {
    items: [{ product: "puerta de patio", measures: "900x2100mm", qty: 1 }],
    comuna: "Temuco",
  };

  try {
    const res = await priceAllEngine(d);
    assert.equal(fetchCalls, 0);
    assert.equal(res.ok, false);
    assert.equal(res.escalate, true);
    assert.equal(res.reason, "producto_fuera_de_alcance:puerta");
    assert.equal(res.category, "puerta");
    assert.equal(res.customer_message, MENSAJE_PRODUCTO_FUERA_DE_ALCANCE);
    assert.equal(res.total, null);
    assert.equal(d.items[0].unit_price, undefined);
    assert.equal(d.items[0].price_warning, MENSAJE_PRODUCTO_FUERA_DE_ALCANCE);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

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
