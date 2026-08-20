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

// ── Regresiones de la pasada propia (2026-08-20) ───────────────────────────

test("REGRESION: el emisor REAL devuelve {ok:false} y NO tira — igual tiene que llegar el fallo", async () => {
  // El test de arriba usaba `throw`, pero sendWhatsAppText (whatsapp-adapter.js:115) atrapa
  // el error de axios y devuelve {ok:false}. O sea el test certificaba un contrato que el
  // codigo de produccion NO cumple: un rechazo de Meta pasaba invisible y la BD lo anotaba
  // como entregado.
  const texto = "Hola. ".repeat(150);
  await assert.rejects(
    () => enviarComoPersona(async () => ({ ok: false, error: "(#130429) rate limit" }), "569", texto, null),
    /wa_send_failed/,
  );
});

test("REGRESION: si falla la SEGUNDA burbuja, el error dice que fue parcial", async () => {
  let n = 0;
  const texto = "Primera parte del mensaje con bastante texto. ".repeat(10);
  await assert.rejects(
    () => enviarComoPersona(async () => (++n === 1 ? { ok: true } : { ok: false, error: "500" }), "569", texto, null),
    (e) => {
      assert.equal(e.parcial, true, "el cliente ya recibio la primera: el fallo es PARCIAL");
      assert.equal(e.burbuja, 2);
      return true;
    },
  );
});

test("REGRESION: un emisor que devuelve undefined NO se toma como fallo", async () => {
  // Hay llamadores legitimos que no devuelven nada. Un undefined no es un error.
  const texto = "Hola. ".repeat(150);
  await assert.doesNotReject(() => enviarComoPersona(async () => undefined, "569", texto, null));
});

test("🔴 REGRESION: NO se pierde el texto que va despues del ultimo . ! ?", async () => {
  // Estaba ROTO EN PRODUCCION: el camino de oraciones usa .match(), que descarta la cola
  // posterior al ultimo signo. Pega justo en el cierre del mensaje: el link de la agenda,
  // el precio, el emoji. Reproducido contra el commit 3db74db.
  // ⚠️ Los tres casos estan CALIBRADOS: cada uno se comprobo que FALLA con el arreglo
  // removido (mutacion quirurgica). Un caso mas corto cae por el camino 4, que si preserva
  // el texto, y el test pasaria siempre — que es como se cuela un test decorativo.
  const casos = [
    // A) el repro original: link de agenda al final, 340 chars
    "Le cuento que la ventana proyectante en termopanel le baja la condensacion bastante, que es lo que mas molesta en Temuco durante el invierno. El perfil es PVC con refuerzo interior de acero galvanizado. Para afinar los numeros lo ideal es medir en terreno, sin costo. Puede elegir el dia que le acomode aca: https://ops.activalabs.ai/agenda",
    // B) precio al final sin punto: lo que mas duele perder
    "Perfecto, le explico con calma como funciona. El perfil europeo tiene cuatro camaras de aire y un refuerzo interior de acero galvanizado, por eso aisla de verdad y no se deforma. El termopanel corta la condensacion que tanto molesta en invierno aca en Temuco. Con instalacion incluida y garantia, su ventana le queda en $389.900",
    // C) pregunta de cierre con emoji, sin signo final
    "Primera oracion suficientemente larga como para pasar sin problema el limite de trescientos veinte caracteres que usa el modulo. Segunda oracion igual de larga para forzar el corte por el camino de oraciones y no por otro. Tercera oracion que suma el resto del texto ¿Le agendo la visita tecnica 😊",
  ];
  // Se compara SIN espacios: cada burbuja es un mensaje aparte y se le hace .trim(), así que
  // los espacios de junta desaparecen legítimamente. Lo que no puede faltar es un solo
  // carácter con contenido. El bug original comía "ai/agenda", así que esta aserción lo caza
  // igual — se verificó ejecutándola contra el commit 3db74db y falla.
  const sinEspacios = (x) => x.replace(/\s+/g, "");
  for (const t of casos) {
    const entregado = partirEnBurbujas(t).join("");
    assert.equal(sinEspacios(entregado), sinEspacios(t),
      `se perdio contenido. Final entregado: ${JSON.stringify(entregado.slice(-45))}`);
  }
});

test("🔴 REGRESION: un link al final del mensaje llega ENTERO", () => {
  const t = "Le explico el detalle del perfil europeo con cuatro camaras de aire y refuerzo interior de acero. El termopanel reduce la condensacion de forma notoria en invierno. Para dejar los numeros finos hay que medir en terreno, sin costo alguno para usted. Agende aca: https://ops.activalabs.ai/agenda";
  const entregado = partirEnBurbujas(t).join("");
  assert.ok(entregado.includes("https://ops.activalabs.ai/agenda"),
    `el link llego cortado: ${JSON.stringify(entregado.slice(-45))}`);
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
