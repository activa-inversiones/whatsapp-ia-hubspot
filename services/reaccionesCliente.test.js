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

// Los dos caminos que atienden WhatsApp/Meta y que se pueden importar.
const PARSERS = [
  ["parseInbound (Oliver GPT)", (msg) => parseInbound(envolver(msg)).text],
  ["extractText (IG/FB)", (msg) => extractText("whatsapp", msg)],
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

test("textoDeReaccion no lanza con entradas basura", () => {
  for (const basura of [null, undefined, {}, { reaction: null }, { reaction: { emoji: 42 } }]) {
    assert.equal(typeof textoDeReaccion(basura), "string");
  }
});
