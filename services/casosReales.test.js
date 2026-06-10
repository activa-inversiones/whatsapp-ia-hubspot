// services/casosReales.test.js — RED ANTI-REGRESIÓN sobre CONVERSACIONES REALES de producción.
//
// No son ejemplos inventados: son los pedidos EXACTOS que llegaron al bot (BD
// conversation_messages) y que se PERDIERON. Cada test reproduce el caso y exige
// que el resultado correcto se mantenga. Si un fix futuro vuelve a romperlos,
// `node --test` falla y no se despliega.
//
// Ejecutar desde temp-wa:  node --test services/casosReales.test.js
//
// ── Casos cubiertos ──────────────────────────────────────────────────────────
//  DALIA (13cab539, 2026-06-08): pedido de 8 tipos de ventana con 2 correderas
//    piso-cielo fuera de rango. El bot le repitió 5× "Algunas medidas necesitan
//    validación técnica. Le paso con nuestro equipo." y NUNCA cotizó. Lead caliente
//    perdido. Causa: 1 ítem fuera de rango bloqueaba TODA la cotización.
//    Exigencia: NINGÚN ítem de Dalia debe escalar; las 2 correderas grandes deben
//    quedar REFERENCIALES (clamp), el resto OK → la cotización CONTINÚA hasta el PDF.

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateDimensionsLocal } from "./enginePricer.js";

// ── Pedido REAL de Dalia Retama (transcrito de la BD, mm) ─────────────────────
// "medidas aproximadas" — cliente lo dijo explícitamente. Tipos según el resumen
// que el propio bot armó (correderas grandes + ventanas chicas fijas/proyectantes).
const PEDIDO_DALIA = [
  { product: "ventana cocina",        ancho: 650,  alto: 1650 }, // 65x1,65
  { product: "ventana living",        ancho: 600,  alto: 1600 }, // 60x1,60 (x3)
  { product: "corredera living",      ancho: 2250, alto: 2500 }, // 2,25 x 2,5  → FUERA DE RANGO (alto 2500>2150)
  { product: "ventana proyectante",   ancho: 850,  alto: 450  }, // 85x45 (x6, 4 fijas 2 proyectantes)
  { product: "ventana pasillo",       ancho: 1150, alto: 1500 }, // 1,15x1,5
  { product: "ventana baño",          ancho: 670,  alto: 500  }, // 67x50
  { product: "corredera habitación",  ancho: 2500, alto: 2400 }, // 2,5 x 2,4  → FUERA DE RANGO (alto 2400>2150)
];

test("DALIA: ningún ítem ESCALA (escalate=true) — el bug que la perdió no vuelve", () => {
  for (const it of PEDIDO_DALIA) {
    const r = validateDimensionsLocal(it.product, it.ancho, it.alto);
    assert.notEqual(
      r?.escalate, true,
      `"${it.product}" ${it.ancho}x${it.alto} NO debe escalar (bloquearía toda la cotización como pasó con Dalia)`
    );
  }
});

test("DALIA: las 2 correderas piso-cielo quedan REFERENCIALES con clamp (se cotizan igual)", () => {
  const grandes = PEDIDO_DALIA.filter(it => it.product.includes("corredera"));
  assert.equal(grandes.length, 2, "el pedido de Dalia tiene 2 correderas grandes");
  for (const it of grandes) {
    const r = validateDimensionsLocal(it.product, it.ancho, it.alto);
    assert.ok(r, `la corredera ${it.ancho}x${it.alto} debe gatillar warning (está fuera de rango)`);
    assert.equal(r.referencial, true, `la corredera ${it.ancho}x${it.alto} debe ser REFERENCIAL (no escalar)`);
    assert.ok(r.clampAncho > 0 && r.clampAlto > 0, "debe traer medida acotada para estimar precio");
    assert.ok(r.clampAlto <= 2150, "el alto acotado no supera el máximo fabricable de corredera");
  }
});

test("DALIA: las ventanas chicas (cocina/living/baño/pasillo) cotizan SIN warning", () => {
  const chicas = PEDIDO_DALIA.filter(it => !it.product.includes("corredera"));
  for (const it of chicas) {
    const r = validateDimensionsLocal(it.product, it.ancho, it.alto);
    // null = dentro de rango, cotiza directo. (proyectante 850x450 y demás están holgadas)
    assert.equal(r, null, `"${it.product}" ${it.ancho}x${it.alto} está en rango → no debe gatillar nada`);
  }
});

test("DALIA: el pedido completo es COTIZABLE — 0 escalaciones, 2 referenciales, 5 directas", () => {
  let escala = 0, refer = 0, ok = 0;
  for (const it of PEDIDO_DALIA) {
    const r = validateDimensionsLocal(it.product, it.ancho, it.alto);
    if (r?.escalate) escala++;
    else if (r?.referencial) refer++;
    else ok++;
  }
  assert.equal(escala, 0, "CERO escalaciones — la cotización nunca debe bloquearse");
  assert.equal(refer, 2, "2 correderas referenciales");
  assert.equal(ok, 5, "5 tipos de ventana cotizan directo");
});
