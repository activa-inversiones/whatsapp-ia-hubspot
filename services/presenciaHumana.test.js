// presenciaHumana.test.js
//
// [2026-08-08] Un cliente le dijo al dueño que se dio cuenta de que era IA porque
// "no le aparecieron los puntitos y le contestaron en el mismo momento".
// Estos tests fijan las dos propiedades que lo delataban.

import test from "node:test";
import assert from "node:assert/strict";

import { pausaPara, conPausaHumana } from "./presenciaHumana.js";

test("la pausa nunca es cero: contestar al instante es lo que delató a Oliver", () => {
  for (const t of ["Sí", "Hola", "a"]) {
    assert.ok(pausaPara(t) >= 500, `"${t}" salió con ${pausaPara(t)} ms`);
  }
});

test("un texto largo tarda más que uno corto", () => {
  const corto = "Sí, dale.";
  const largo = "Le cuento: la ventana proyectante se abre hacia afuera con bisagras arriba, "
    + "así ventila sin que entre lluvia. ¿Le tomo las medidas o le agendo una visita?";
  // Se compara el techo del corto contra el piso del largo para que el ±20% de azar
  // no haga fallar el test una vez cada tantas corridas (test escamoso = test que se ignora).
  let maxCorto = 0, minLargo = Infinity;
  for (let i = 0; i < 200; i++) {
    maxCorto = Math.max(maxCorto, pausaPara(corto));
    minLargo = Math.min(minLargo, pausaPara(largo));
  }
  assert.ok(maxCorto < minLargo, `corto máx ${maxCorto} ms no quedó bajo largo mín ${minLargo} ms`);
});

test("la pausa tiene techo: el cliente no espera de verdad", () => {
  // El techo de 6500 ms se respeta INCLUSO en el peor caso del azar: la base se divide
  // por 1,2 antes de aplicarlo. Se prueba muchas veces porque el azar hace que un solo
  // intento pueda no tocar el extremo.
  const biblia = "x".repeat(5000);
  for (let i = 0; i < 300; i++) {
    const ms = pausaPara(biblia);
    assert.ok(ms <= 6500, `${ms} ms supera el techo prometido`);
  }
});

test("la pausa varía: un valor siempre idéntico delata igual que no tener pausa", () => {
  // ⚠️ Este test medía SOLO un texto corto y por eso pasó mientras el azar estaba roto:
  // el techo se aplicaba después del jitter, así que desde ~329 caracteres TODA respuesta
  // esperaba exactamente 6500 ms. Y las respuestas de venta de Oliver superan ese largo
  // seguido — o sea que el azar no existía justo donde más importaba. Lo cazó Codex.
  // Ahora se prueban los tres tamaños, incluido uno por encima del techo.
  const textos = {
    corto: "Hola, ¿cómo está?",
    medio: "x".repeat(200),
    largo: "x".repeat(1200), // por encima del techo: acá vivía el bug
  };
  for (const [nombre, t] of Object.entries(textos)) {
    const vistos = new Set();
    for (let i = 0; i < 60; i++) vistos.add(pausaPara(t));
    assert.ok(vistos.size > 1, `la pausa es constante para el texto ${nombre}`);
  }
});

test("conPausaHumana espera ANTES de enviar, y manda el mismo texto intacto", async () => {
  const recibido = [];
  const enviar = conPausaHumana(async (to, body, extra) => {
    recibido.push({ to, body, extra });
    return { ok: true };
  });
  const t0 = Date.now();
  const r = await enviar("56971061075", "Le paso la cotización", "extra");
  const transcurrido = Date.now() - t0;

  assert.deepEqual(r, { ok: true });
  assert.equal(recibido.length, 1);
  assert.equal(recibido[0].to, "56971061075");
  assert.equal(recibido[0].body, "Le paso la cotización", "el texto no puede alterarse");
  assert.equal(recibido[0].extra, "extra", "los argumentos extra deben pasar tal cual");
  assert.ok(transcurrido >= 500, `envió a los ${transcurrido} ms: no esperó`);
});

// [2026-08-08] Este test nació de un susto que resultó ser MEDIO falso: se creyó que
// AbortSignal.any() era de Node 20.3 y que rompería en producción (`node:18-slim`). Lo
// corrigió Codex y se verificó en el changelog: entró en 18.17.0, así que habría andado.
//
// El test se deja igual, y vale más que el susto: el local corre Node 24 mientras
// producción corre 18, y una API nueva acá falla EN SILENCIO (la llamada vive en un
// try/catch ⇒ el "escribiendo…" simplemente no aparecería, sin un error a la vista).
// Sin este test, esa diferencia de versiones no la vigila nadie.
test("no usa APIs que falten en el Node de producción (node:18-slim)", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const bruto = readFileSync(fileURLToPath(new URL("./presenciaHumana.js", import.meta.url)), "utf8");
  // Sin comentarios: el archivo ADVIERTE por escrito que no se use AbortSignal.any, y esa
  // advertencia hacía fallar al test. Se mira el código que se ejecuta, no lo que se explica.
  const fuente = bruto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  // API → primera versión de Node que la tiene. Ampliar al agregar código.
  // (AbortSignal.any NO va acá: está desde 18.17 — ese fue el error de la primera versión.)
  const MINIMA_DE_PRODUCCION = 18;
  const APIS = [
    [".toSorted(", 20],
    [".toReversed(", 20],
    [".findLast(", 18],       // ok, queda de ejemplo del formato
    ["Object.groupBy", 21],
    ["Array.fromAsync", 22],
    ["process.getBuiltinModule", 22],
  ];
  for (const [api, desde] of APIS) {
    if (desde <= MINIMA_DE_PRODUCCION) continue;
    assert.ok(
      !fuente.includes(api),
      `${api} necesita Node ${desde} y producción corre ${MINIMA_DE_PRODUCCION}: fallaría en silencio`
    );
  }
});

test("el Dockerfile sigue en Node 18 — si sube, revisar la lista de arriba", async () => {
  // Codex marcó que la versión anterior solo verificaba "FROM node:<número>" sin exigir
  // que ese número fuera 18: pasaba igual con node:22. Ahora se afirma la versión.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const df = readFileSync(fileURLToPath(new URL("../Dockerfile", import.meta.url)), "utf8");
  const m = df.match(/FROM\s+node:(\d+)/i);
  assert.ok(m, "no se pudo leer la versión de Node del Dockerfile");
  assert.equal(
    Number(m[1]), 18,
    "el Dockerfile cambió de versión de Node: revisar la lista de APIs del test anterior"
  );
});

test("si la función envuelta falla, el error sigue llegando al llamador", async () => {
  // La pausa es cosmética: no puede tragarse un fallo de envío y hacerlo pasar por éxito.
  const enviar = conPausaHumana(async () => { throw new Error("meta_caida"); });
  await assert.rejects(() => enviar("569", "hola"), /meta_caida/);
});
