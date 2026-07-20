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

// [Ronda 3 2026-07-20] Las puertas ABATIBLES ya se cotizan (BOM real S60 verificado en
// vivo; dato del dueño). Lo prohibido sigue siendo caer a CORREDERA en silencio.
test("mapAperturaToEngine: puertas abatibles mapean a su tipo real, JAMÁS a CORREDERA", () => {
  assert.equal(mapAperturaToEngine("puerta de patio"), "PUERTA");
  assert.equal(mapAperturaToEngine("puerta abatible"), "PUERTA");
  assert.equal(mapAperturaToEngine("puerta interior"), "PUERTA_INTERIOR");
  assert.equal(mapAperturaToEngine("puerta doble"), "PUERTA_DOBLE");
  assert.equal(mapAperturaToEngine("puerta de dos hojas"), "PUERTA_DOBLE");
  // la puerta CORREDERA de patio SÍ es el producto sliding:
  assert.equal(mapAperturaToEngine("puerta corredera"), "CORREDERA");
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
test("priceAllEngine: puerta PLEGABLE sigue escalando sin llamar al Engine", async () => {
  const fetchOriginal = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("el Engine no debe llamarse para una puerta plegable");
  };

  const d = {
    items: [{ product: "puerta plegable de patio", measures: "900x2100mm", qty: 1 }],
    comuna: "Temuco",
  };

  try {
    const res = await priceAllEngine(d);
    assert.equal(fetchCalls, 0);
    assert.equal(res.ok, false);
    assert.equal(res.escalate, true);
    assert.equal(res.reason, "producto_fuera_de_alcance:plegable");
    assert.equal(res.category, "plegable");
    assert.equal(res.customer_message, MENSAJE_PRODUCTO_FUERA_DE_ALCANCE);
    assert.equal(res.total, null);
    assert.equal(d.items[0].unit_price, undefined);
    assert.equal(d.items[0].price_warning, MENSAJE_PRODUCTO_FUERA_DE_ALCANCE);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// [Ronda 3 2026-07-20] GOLDEN EN VIVO de puertas (mismo patrón que el golden proyectante):
// el motor cotiza la abatible con BOM real. Falla solo sin red (como el otro golden).
test("GOLDEN EN VIVO: priceAllEngine puerta abatible 900x2100 → ok, total>0", async () => {
  const d = {
    items: [{ product: "PUERTA", measures: "900x2100mm", qty: 1 }],
    comuna: "Temuco",
  };
  const res = await priceAllEngine(d, "+56900000001");
  console.log("GOLDEN puerta total:", res.total);
  assert.equal(res.ok, true, `esperado ok:true, fue: ${JSON.stringify(res)}`);
  assert.ok(res.total > 0, "total de puerta debe ser > 0");
  assert.equal(d.items[0].source, "activa_engine");
  assert.ok(d.items[0].unit_price > 0);
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

// [Ronda 2→3 2026-07-20] El enum REAL de V1 (update_quote): en Ronda 2 escalaban (guarda);
// en Ronda 3 mapean al BOM de puerta correcto. El invariante de siempre: JAMÁS CORREDERA.
test("mapAperturaToEngine: PUERTA_1H / PUERTA_DOBLE (enum V1) mapean a puerta real", () => {
  assert.equal(mapAperturaToEngine("PUERTA_1H"), "PUERTA");
  assert.equal(mapAperturaToEngine("PUERTA_DOBLE"), "PUERTA_DOBLE");
});

// [Ronda 2 2026-07-20] La descripción LITERAL del cliente (descripcion_producto del tool)
// llega a la guarda vía item.descripcion: un enum válido (CORREDERA) ya no la tapa.
// Sin red: la guarda corre ANTES de llamar al Engine (fetch prohibido lo prueba).
test("priceAllEngine: item.descripcion fuera de alcance escala SIN llamar a la red", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("RED PROHIBIDA EN ESTE TEST"); };
  try {
    const d = {
      items: [{
        measures: "1200x1000mm", product: "CORREDERA", qty: 1, color: "", ambiente: "",
        descripcion: "una puerta ventana plegable para el quincho",
      }],
      comuna: "", default_color: "",
    };
    const r = await priceAllEngine(d);
    assert.equal(r.ok, false);
    assert.equal(r.escalate, true);
    assert.match(String(r.reason), /producto_fuera_de_alcance/);
    assert.equal(d.items[0].price_warning, MENSAJE_PRODUCTO_FUERA_DE_ALCANCE);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
