// burbujas.test.js — [2026-08-08]
// La respuesta de Oliver salía como un párrafo largo de una sola burbuja. Un vendedor real
// manda 2-3 mensajitos. Era la señal que quedaba viva después de arreglar los puntitos.

import test from "node:test";
import assert from "node:assert/strict";

import { partirEnBurbujas, MAX_CARACTERES_BURBUJA } from "./burbujas.js";
import { enviarComoPersona } from "./presenciaHumana.js";

test("un mensaje corto sale en UNA burbuja, sin trocear de más", () => {
  const t = "Perfecto, se la agendo para el jueves.";
  assert.deepEqual(partirEnBurbujas(t), [t]);
});

test("una respuesta larga se parte y ninguna burbuja queda gigante", () => {
  const largo = [
    "¡Qué bonito! Eso suena a una ventana proyectante, se abre hacia afuera con bisagras arriba.",
    "En termopanel le baja bastante la condensación, que es lo que más molesta en Temuco en invierno. " +
      "El perfil es PVC con refuerzo interior, fabricado acá mismo con precisión milimétrica.",
    "¿Las medidas las tiene más o menos, o quiere que le agende una visita para medir?",
  ].join("\n\n");
  const b = partirEnBurbujas(largo);
  assert.ok(b.length > 1, "no se partió");
  for (const x of b) assert.ok(x.length <= MAX_CARACTERES_BURBUJA + 40, `burbuja de ${x.length}`);
});

test("no se pierde ni se duplica texto al partir", () => {
  const t = "Uno. ".repeat(200);
  const junto = partirEnBurbujas(t).join(" ").replace(/\s+/g, " ").trim();
  assert.equal(junto, t.replace(/\s+/g, " ").trim());
});

test("un texto sin puntuación ni saltos igual se parte (último recurso)", () => {
  const t = "palabra ".repeat(200);
  const b = partirEnBurbujas(t);
  assert.ok(b.length > 1);
  for (const x of b) assert.ok(x.length <= MAX_CARACTERES_BURBUJA);
});

test("enviarComoPersona manda las burbujas EN ORDEN y completas", async () => {
  const enviadas = [];
  const texto = "Primero le cuento el detalle técnico de la ventana proyectante y por qué conviene. "
    .repeat(6) + "\n\n¿Le agendo la visita?";
  await enviarComoPersona(async (to, body) => { enviadas.push(body); }, "569", texto, null);

  assert.ok(enviadas.length > 1, "no se partió en burbujas");
  assert.match(enviadas.at(-1), /¿Le agendo la visita\?/, "la pregunta de cierre debe ir al final");
  assert.equal(
    enviadas.join(" ").replace(/\s+/g, " ").trim(),
    texto.replace(/\s+/g, " ").trim(),
    "el texto entregado no coincide con el original"
  );
});

test("la respuesta completa no tarda más que el tope, aunque sean varias burbujas", async () => {
  // Arreglar la señal de robot no puede crear una peor: un vendedor que no contesta.
  const texto = "Le explico con lujo de detalle este punto de la instalación. ".repeat(20);
  const t0 = Date.now();
  await enviarComoPersona(async () => {}, "569", texto, null);
  const ms = Date.now() - t0;
  assert.ok(ms <= 11000, `tardó ${ms} ms: demasiado para una sola respuesta`);
});

test("si una burbuja falla al enviarse, el error llega al llamador", async () => {
  const texto = "Hola. ".repeat(150);
  await assert.rejects(
    () => enviarComoPersona(async () => { throw new Error("meta_caida"); }, "569", texto, null),
    /meta_caida/
  );
});
