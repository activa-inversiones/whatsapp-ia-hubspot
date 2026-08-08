// reaccionesCliente.test.js
//
// [2026-08-08] Por qué existe este archivo:
// El emoji de las reacciones se descartaba en la ingesta — la BD guardaba "[reaction]".
// Al arreglarlo, el fix se aplicó a UNO SOLO de los tres parsers (el de Instagram/Facebook),
// y la suite pasó igual: 478 tests verdes sin un solo caso de reacción. La revisión cruzada
// lo cazó, no los tests.
//
// Por eso estos tests corren el MISMO caso contra los DOS parsers exportables. Si mañana
// alguien arregla o rompe uno solo, acá se ve.
// (extractMsg de index.js no se puede importar aislado: el monolito levanta el server.)

import test from "node:test";
import assert from "node:assert/strict";

import { textoDeReaccion } from "./reactionText.js";
import { extractText } from "./multiChannelHandler.js";
import { parseInbound } from "../src/sales-agent/whatsapp-adapter.js";

const envolver = (msg) => ({
  entry: [{ changes: [{ value: { messages: [msg], contacts: [{ profile: { name: "Cliente" } }] } }] }],
});

const reaccion = (emoji) => ({
  id: "wamid.TEST",
  from: "56971061075",
  type: "reaction",
  reaction: emoji === undefined ? undefined : { message_id: "wamid.ORIG", emoji },
});

// Los dos parsers que se pueden importar sin levantar el monolito.
// El nombre del segundo dice "rama whatsapp" y no "IG/FB" a propósito (observación de
// Codex): `extractText` vive en el handler de Instagram/Facebook, pero lo que se ejercita
// acá es su rama `channel === "whatsapp"`, que los endpoints de IG/FB no recorren.
const PARSERS = [
  ["parseInbound (Oliver GPT — el camino vivo)", (msg) => parseInbound(envolver(msg)).text],
  ["extractText (rama whatsapp)", (msg) => extractText("whatsapp", msg)],
];

for (const [nombre, parsear] of PARSERS) {
  test(`${nombre}: conserva el emoji de la reacción`, () => {
    assert.match(parsear(reaccion("👍")), /👍/);
    assert.match(parsear(reaccion("😢")), /😢/);
  });

  test(`${nombre}: una reacción negativa NO se ve igual que una positiva`, () => {
    // Este es el daño caro: la REGLA #9 del prompt manda avanzar ante 👍 y preguntar
    // ante 😢. Si los dos llegan como el mismo texto, Oliver avanza sobre una duda.
    assert.notEqual(parsear(reaccion("👍")), parsear(reaccion("😢")));
  });

  test(`${nombre}: emoji vacío = el cliente RETIRÓ la reacción, no es conformidad`, () => {
    const t = parsear(reaccion(""));
    assert.match(t, /retir/i);
    assert.doesNotMatch(t, /👍|❤️|🙏/);
  });

  test(`${nombre}: payload sin objeto reaction no se confunde con un retiro`, () => {
    // Un evento incompleto es algo que no entendemos, no una decisión del cliente.
    assert.doesNotMatch(parsear(reaccion(undefined)), /retir/i);
  });

  test(`${nombre}: un payload roto devuelve exactamente "[reacción incompleta]"`, () => {
    // La REGLA #9 del prompt dice "o recibís un mensaje [reaction]" → asumí conformidad
    // y avanzá. Si un evento incompleto devolviera ese token exacto, un error de Meta
    // haría avanzar la venta sola. Lo cazaron Gemini y Codex por separado.
    // Se afirma el valor EXACTO y no un "distinto de [reaction]": esa versión pasaba
    // igual si devolvíamos "👍 (reaccionó)", que sería peor todavía (observación de Codex).
    assert.equal(parsear(reaccion(undefined)), "[reacción incompleta]");
  });

  test(`${nombre}: texto e imagen siguen igual (sin regresión)`, () => {
    assert.equal(parsear({ id: "w", from: "569", type: "text", text: { body: "Son las q le mencioné" } }), "Son las q le mencioné");
    assert.equal(parsear({ id: "w", from: "569", type: "image", image: { id: "1" } }), "[image]");
  });
}

test("los dos parsers dan EXACTAMENTE el mismo texto para la misma reacción", () => {
  // La razón del bug fue tener tres copias del mismo parser y arreglar una.
  for (const emoji of ["👍", "❤️", "🙏", "😂", "😮", "😢", ""]) {
    const [a, b] = PARSERS.map(([, p]) => p(reaccion(emoji)));
    assert.equal(a, b, `divergen con "${emoji}"`);
  }
});

// El tercer parser, extractMsg, vive dentro de index.js y no se puede importar: el
// monolito levanta el server al cargarse. Esta prueba lee el FUENTE en vez de ejecutarlo.
// Es un guardarraíl, no un test de comportamiento — y va igual, porque el bug original fue
// exactamente que a ese parser le faltaba la rama y nadie se enteró (observación de Codex:
// "si se elimina de nuevo la rama reaction de extractMsg, todos estos tests siguen verdes").
test("extractMsg (index.js) tiene la rama de reacción — guardarraíl sobre el fuente", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const ruta = fileURLToPath(new URL("../index.js", import.meta.url));
  const fuente = readFileSync(ruta, "utf8");

  const cuerpo = fuente.slice(fuente.indexOf("function extractMsg("));
  const extractMsgFn = cuerpo.slice(0, cuerpo.indexOf("\n}"));

  assert.ok(extractMsgFn.length > 0, "no se encontró extractMsg en index.js");
  assert.match(
    extractMsgFn,
    /type === "reaction"[\s\S]*textoDeReaccion\(/,
    "extractMsg perdió la rama de reacción: las reacciones del /webhook legacy volverían a guardarse como [reaction]"
  );
});

test("textoDeReaccion no lanza con entradas basura", () => {
  for (const basura of [null, undefined, {}, { reaction: null }, { reaction: { emoji: 42 } }]) {
    assert.equal(typeof textoDeReaccion(basura), "string");
  }
});
