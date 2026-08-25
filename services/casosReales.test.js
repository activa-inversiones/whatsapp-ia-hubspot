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
import { classifyProduct } from "./oliverProduct.js";
import { isNoise, detectNoiseLoop } from "./oliverNoise.js";

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

// [2026-08-25 ACTUALIZADO — instruccion nueva del dueño, caso Martin 0341] El clamp del
// precio SE ELIMINO: cobraba una corredera de 5560 como si midiera 2930 (~$413 mil de menos
// en una ventana). Lo que DALIA protegia se mantiene INTACTO: referencial, sin escalate, la
// cotizacion llega al PDF. Lo que cambia: el precio sale de las medidas REALES.
test("DALIA: las 2 correderas piso-cielo quedan REFERENCIALES y el precio usa las medidas REALES", () => {
  const grandes = PEDIDO_DALIA.filter(it => it.product.includes("corredera"));
  assert.equal(grandes.length, 2, "el pedido de Dalia tiene 2 correderas grandes");
  for (const it of grandes) {
    const r = validateDimensionsLocal(it.product, it.ancho, it.alto);
    assert.ok(r, `la corredera ${it.ancho}x${it.alto} debe gatillar warning (está fuera de rango)`);
    assert.equal(r.referencial, true, `la corredera ${it.ancho}x${it.alto} debe ser REFERENCIAL (no escalar)`);
    assert.ok(!r.clampAncho && !r.clampAlto,
      "el clamp de maximos cobraba de menos en silencio (caso Martin 0341) — no puede volver");
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

// ── CASO c7a5 (conv 10618adf, 2026-06-09) ─────────────────────────────────────
// Mensaje REAL del cliente (transcrito de la BD conversation_messages):
//   "Buenas tardes.\nNecesito cotizar:\n 4 ventanas 1,50x 1,50\n2 ventanas 1,00x 1,00
//    Con instalación y retiro de ventanas antiguas de aluminio, es un casa prefabricada"
//
// EL BUG: la palabra "aluminio" gatilló "te paso con Marcelo" y el bot NUNCA cotizó
// las 6 ventanas estándar (4× 1,50x1,50 + 2× 1,00x1,00). Pero el cliente NO pide un
// producto de aluminio: pide ventanas PVC NUEVAS y, de paso, que le RETIREN las
// ANTIGUAS de aluminio. Es una MENCIÓN DE PASO ("retiro de ventanas antiguas de
// aluminio") → specialRequest debe ser false para que el flujo cotice el PVC.
const MSG_C7A5 =
  "Buenas tardes.\nNecesito cotizar:\n 4 ventanas 1,50x 1,50\n2 ventanas 1,00x 1,00\n" +
  "Con instalación y retiro de ventanas antiguas de aluminio, es un casa prefabricada";

test("c7a5: 'retiro de ventanas antiguas de aluminio' es MENCIÓN DE PASO → NO escala, COTIZA", () => {
  const r = classifyProduct(MSG_C7A5);
  assert.equal(
    r.specialRequest, false,
    "specialRequest debe ser false: el cliente quiere PVC nuevo, 'aluminio' es solo lo que se RETIRA (el bug que perdió el lead)"
  );
  assert.equal(r.passing, true, "se detecta el contexto de paso (retiro/antiguas) que neutraliza el match de 'aluminio'");
});

// ── CASO e0b2a1a5 (la conversación de 119 mensajes basura) ────────────────────
// EL BUG: el bot respondió "no entendí" 20+ veces y NUNCA escaló, porque comparaba
// el texto EXACTO de mensaje contra mensaje — y la basura era toda distinta entre sí,
// así que el contador de repeticiones jamás se disparaba. FIX (oliverNoise.js):
// detectar que el mensaje ES ruido por forma (sin vocales, puro símbolo, repetición,
// etc.) y acumular en una ventana rolling hasta superar el umbral → escalar.
//
// Nota: el prompt original sugería "asdkj" como string basura, pero esa cadena tiene
// una vocal legible ('a') y estructura pronunciable, así que isNoise() la trata —
// correctamente — como NO ruido. Se reemplaza por "wqrtp" (mash de consonantes puro,
// sin vocales) que sí es basura real. Los otros 4 (????, ...., xqzpt, 11111) se mantienen.
const JUNK_STRINGS = ["wqrtp", "????", "....", "xqzpt", "11111"];

test("e0b2a1a5: cada string basura representativo es detectado como RUIDO", () => {
  for (const s of JUNK_STRINGS) {
    assert.equal(isNoise(s), true, `"${s}" debe clasificarse como ruido/basura`);
  }
});

test("e0b2a1a5: respuestas legítimas cortas y dimensiones NO son ruido (no falso-positivo)", () => {
  const legit = [
    "Si",                  // confirmación corta legítima
    "ok",                  // confirmación corta legítima
    "1200x1000",           // dimensión válida (mm), no es basura
    "Hola, necesito cotizar dos ventanas para mi living",  // frase real
  ];
  for (const s of legit) {
    assert.equal(isNoise(s), false, `"${s}" es un mensaje legítimo, NO debe marcarse como ruido`);
  }
});

test("e0b2a1a5: detectNoiseLoop ESCALA tras ~5 mensajes basura distintos (el bot ya no se queda en bucle)", () => {
  const ses = {}; // sesión fresca, sin noiseWindow previa
  let fired = false;
  for (const s of JUNK_STRINGS) {
    fired = detectNoiseLoop(ses, s);
  }
  assert.equal(
    fired, true,
    "tras 5 mensajes basura distintos detectNoiseLoop debe disparar → escalar (el bug e0b2a1a5 no vuelve)"
  );
});
