// burbujas.test.js — [2026-08-08]
// La respuesta de Oliver salía como un párrafo largo de una sola burbuja. Un vendedor real
// manda 2-3 mensajitos. Era la señal que quedaba viva después de arreglar los puntitos.

import test from "node:test";
import assert from "node:assert/strict";

import { partirEnBurbujas, MAX_CARACTERES_BURBUJA, MAX_BURBUJAS, LIMITE_DURO_WA, aplicarTope } from "./burbujas.js";
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
  // [2026-08-20] El contrato CAMBIÓ con el tope de burbujas: antes se exigía que TODAS
  // midieran <= MAX_CARACTERES_BURBUJA. Ahora las primeras sí, pero la última puede venir
  // más larga porque absorbe a las que pasan del tope — un mensaje largo sale más barato
  // que tres cobrados (Meta cobra por mensaje desde el 1-oct-2026). Lo que sigue siendo
  // inviolable es el techo de WhatsApp.
  for (const x of b.slice(0, -1)) assert.ok(x.length <= MAX_CARACTERES_BURBUJA);
  for (const x of b) assert.ok(x.length <= LIMITE_DURO_WA, "ninguna burbuja puede pasar el techo de WhatsApp");
});

test("TOPE: nunca más de MAX_BURBUJAS, aunque el texto dé para siete", () => {
  const t = Array.from({ length: 7 }, (_, i) => `Parrafo numero ${i} con texto suficiente. `.repeat(12)).join("\n\n");
  const b = partirEnBurbujas(t);
  assert.ok(b.length <= MAX_BURBUJAS, `salieron ${b.length} burbujas, el tope es ${MAX_BURBUJAS}`);
});

test("TOPE: no se pierde ni una palabra al re-unir", () => {
  const partes = ["Uno alfa.", "Dos beta.", "Tres gamma.", "Cuatro delta.", "Cinco epsilon."];
  const original = partes.join(" ");
  const b = aplicarTope(partes, 2);
  assert.equal(b.length, 2);
  assert.equal(b.join(" ").replace(/\n\n/g, " "), original, "el texto completo tiene que sobrevivir");
});

test("TOPE: el techo de WhatsApp le gana al tope de burbujas", () => {
  // 5 bloques de 2.000 caracteres: re-unirlos daría 10.000 y Meta rechazaría el body.
  const gordas = Array.from({ length: 5 }, (_, i) => String.fromCharCode(97 + i).repeat(2000));
  const b = aplicarTope(gordas, 2);
  assert.ok(b.length > 2, "prefiere pasarse del tope antes que armar un mensaje que no se entrega");
  for (const x of b) assert.ok(x.length <= LIMITE_DURO_WA, `una burbuja quedó en ${x.length}`);
  assert.equal(b.join("").replace(/\n/g, ""), gordas.join(""), "tampoco acá se puede perder texto");
});

test("TOPE: WA_MAX_BUBBLES=0 lo desactiva (válvula de escape)", () => {
  const partes = ["a", "b", "c", "d"];
  assert.deepEqual(aplicarTope(partes, 0), partes);
});

test("TOPE: si ya viene bajo el tope, no toca nada", () => {
  const partes = ["hola", "chao"];
  assert.equal(aplicarTope(partes, 2), partes, "misma referencia: no rearma al pedo");
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

test("REGRESION Copilot: una burbuja que YA pasa el techo se trocea, no se deja pasar", () => {
  // Antes: el corte solo actuaba con `cola` no vacia, asi que la primera burbuja entraba
  // con cola="" y salia intacta. Reproducido: 5.000 chars -> Meta lo rechaza.
  const gigante = "x".repeat(5000);
  const b = aplicarTope([gigante, "chica"], 2);
  for (const x of b) assert.ok(x.length <= LIMITE_DURO_WA, `quedo una burbuja de ${x.length}`);
  assert.equal(b.join("").replace(/\n/g, ""), gigante + "chica", "no se puede perder ni un caracter");
});

test("REGRESION Copilot: trocear corta en espacios cuando los hay", () => {
  const texto = ("palabra ".repeat(900)).trim();   // ~7.200 chars con espacios
  const b = aplicarTope([texto, "fin"], 2);
  for (const x of b) assert.ok(x.length <= LIMITE_DURO_WA);
  assert.equal(b.join(" ").replace(/\s+/g, " ").trim(), (texto + " fin").replace(/\s+/g, " "),
    "el texto tiene que sobrevivir palabra por palabra");
});

test("REGRESION Copilot: un texto gigante SIN espacios igual respeta el techo", () => {
  const b = aplicarTope(["y".repeat(9000), "z"], 2);
  for (const x of b) assert.ok(x.length <= LIMITE_DURO_WA, `burbuja de ${x.length}`);
  assert.equal(b.join("").replace(/\n/g, ""), "y".repeat(9000) + "z");
});

test("REGRESION Copilot 3a pasada: un valor que no es string no tumba el envio", () => {
  // aplicarTope es exportada y en el camino de re-union el flatMap corre sobre TODO el
  // arreglo: con un null adentro, texto.length tiraba TypeError y se caia el mensaje.
  for (const raro of [null, undefined, 42, {}, []]) {
    assert.doesNotThrow(() => aplicarTope(["a", "b", raro, "c"], 2), `reventó con ${JSON.stringify(raro)}`);
  }
  assert.doesNotThrow(() => aplicarTope([null, "x".repeat(5000)], 2));
});
