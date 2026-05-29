// tools.test.js — Tests del esqueleto (no requieren red ni API key).
// Corre con: node --test src/sales-agent/tools.test.js
//
// Verifica: definiciones de tools bien formadas, executors con stubs, y
// que el system prompt mantiene el breakpoint de caché en el último bloque.

import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOL_DEFS, runTool } from "./tools.js";
import { buildSystemBlocks, buildSessionContext } from "./system-prompt.js";

test("TOOL_DEFS tienen name, description e input_schema válidos", () => {
  assert.ok(Array.isArray(TOOL_DEFS) && TOOL_DEFS.length === 7);
  for (const t of TOOL_DEFS) {
    assert.equal(typeof t.name, "string");
    assert.ok(t.description.length > 10);
    assert.equal(t.input_schema.type, "object");
    assert.equal(typeof t.input_schema.properties, "object");
  }
});

test("nombres de tools son únicos", () => {
  const names = TOOL_DEFS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
});

test("generar_link_simulador construye URL sin tocar la red", async () => {
  const res = await runTool("generar_link_simulador", { tipo: "TERMOPANEL", color: "blanco" }, {});
  assert.equal(res.ok, true);
  assert.match(res.data.url, /simulador/);
  assert.match(res.data.url, /tipo=TERMOPANEL/);
});

test("guardar_lead_postgres usa el hook ctx.saveLead cuando existe", async () => {
  let captured = null;
  const res = await runTool(
    "guardar_lead_postgres",
    { nombre: "Ana", comuna: "Temuco", segmento: "B2C" },
    { telefono: "569X", saveLead: async (lead) => { captured = lead; return { saved: true }; } },
  );
  assert.equal(res.ok, true);
  assert.equal(captured.nombre, "Ana");
  assert.equal(captured.telefono, "569X"); // toma el teléfono del ctx
});

test("notificar_marcelo sin hook devuelve stub (no lanza)", async () => {
  const res = await runTool("notificar_marcelo", { razon: "cliente molesto" }, {});
  assert.equal(res.ok, true);
  assert.equal(res.data.escalated, false);
});

test("tool desconocida devuelve ok:false sin lanzar", async () => {
  const res = await runTool("no_existe", {}, {});
  assert.equal(res.ok, false);
});

test("system prompt tiene el cache_control en el ÚLTIMO bloque", () => {
  const blocks = buildSystemBlocks();
  assert.ok(blocks.length >= 2);
  assert.equal(blocks[blocks.length - 1].cache_control?.type, "ephemeral");
  // El primer bloque (personalidad) NO debe llevar breakpoint propio.
  assert.equal(blocks[0].cache_control, undefined);
});

test("buildSessionContext omite campos vacíos y no rompe", () => {
  const ctx = buildSessionContext({ nombre: "Ana", comuna: "Temuco" });
  assert.match(ctx, /Ana/);
  assert.match(ctx, /Temuco/);
  assert.doesNotMatch(ctx, /undefined/);
});
