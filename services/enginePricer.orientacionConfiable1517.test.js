// [#1517 · 13-oct] Guardia: con `orientacion_confiable` (emisión interna: las medidas las escribió el vendedor en
// ancho×alto) el pre-pass NO da vuelta la lista aunque un alto supere 2400. Caso real 0642-B (Christian Jélvez):
// un fijo de 2600×2700 hacía girar las 5 ventanas en la propuesta; el borrador de dibujos las mostraba bien.
// Sin el flag (WhatsApp) la regla física sigue igual: este test lo fija también.
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceAllEngine } from "./enginePricer.js";

const LISTA = () => ({
  items: [
    { product: "Fijo S60", measures: "2000x800", qty: 1, color: "NEW BLACK" },
    { product: "Fijo S60", measures: "680x2150", qty: 1, color: "NEW BLACK" },
    { product: "Fijo S60", measures: "2600x2700", qty: 1, color: "NEW BLACK" }, // alto 2700 > 2400: dispara la regla
  ],
  comuna: "Temuco",
  texto_cliente: "",
});

async function correr(d) {
  const fetchOriginal = globalThis.fetch;
  // El motor no se llama de verdad: lo que se mide es el pre-pass de orientación, que corre ANTES del fetch.
  globalThis.fetch = async () => { throw new Error("motor apagado en este test"); };
  try { await priceAllEngine(d); } finally { globalThis.fetch = fetchOriginal; }
  return d.items.map((it) => it.measures);
}

test("sin el flag (WhatsApp): un alto > 2400 da vuelta TODA la lista (regla física del dueño, 2026-06-06)", async () => {
  const d = LISTA();
  const m = await correr(d);
  assert.deepEqual(m, ["800x2000", "2150x680", "2700x2600"]);
  assert.ok(d.items.every((it) => it.measures_swapped === true));
});

test("con orientacion_confiable (emisión interna): NADA se da vuelta, ni la de 2700 de alto", async () => {
  const d = { ...LISTA(), orientacion_confiable: true };
  const m = await correr(d);
  assert.deepEqual(m, ["2000x800", "680x2150", "2600x2700"]);
  assert.ok(d.items.every((it) => !it.measures_swapped));
});

test("con el flag, la declaración del cliente tampoco gira nada (en la emisión interna no hay texto del cliente)", async () => {
  const d = { ...LISTA(), orientacion_confiable: true, texto_cliente: "las medidas están alto por ancho" };
  const m = await correr(d);
  assert.deepEqual(m, ["2000x800", "680x2150", "2600x2700"]);
});
