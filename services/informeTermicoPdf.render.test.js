// informeTermicoPdf.render.test.js — [2026-08-24 · hallazgo P2 de Codex en la compuerta]
//
// EL HUECO QUE SEÑALO CODEX, y tenia razon: todo lo que probaba la tabla multi-ventana lo
// hacia sobre funciones PURAS (`resumenVentanas`, `sintesisProyecto`) o sobre un generador
// de PDF sustituido por un mock que solo verificaba sus argumentos. Ninguno miraba el
// documento renderizado. Si alguien borra el bucle que dibuja las filas, los 25 tests
// puros siguen en verde y el cliente recibe un informe sin sus ventanas.
//
// Un test que verifica los argumentos de una funcion no verifica lo que esa funcion dibuja.
//
// Aca se genera el PDF DE VERDAD y se lee su texto: es la unica forma de afirmar "la
// ventana V7 aparece en el documento" sin creerle a nadie.

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { generarInformeTermicoPdf } from './informeTermicoPdf.js';

const DATOS = {
  comuna: 'Temuco', regimen: 'PDA', uw_max_Wm2K: 3.2,
  zona_termica_NCh1079: 'F', criterio_ref: 'PDA Temuco art. 27',
};

/**
 * Texto del PDF. pdfkit escribe los contenidos en streams FlateDecode; se descomprimen
 * todos y se juntan. Los literales van entre parentesis dentro de operadores Tj/TJ.
 */
function textoDelPdf(pdf) {
  // 🔴 [2026-08-25] SE CORTA POR `/Length`, NO POR REGEX SOBRE EL BINARIO.
  //
  // La version anterior buscaba `stream … endstream` con una expresion regular perezosa
  // sobre los bytes crudos. Cuando el contenido binario del stream contenia por casualidad
  // esa secuencia de corte, el trozo quedaba partido, `inflateSync` lanzaba, y el `catch`
  // se lo tragaba: el texto de esa pagina desaparecia SIN error. Medido el 25-ago: un
  // informe cuyo texto real ocupa ~8.000 caracteres devolvia 694, y el test daba rojo
  // aunque el PDF estuviera perfecto. Un test que dice "verifico el documento" y en
  // realidad tira una moneda es peor que no tenerlo.
  //
  // El PDF declara cuantos bytes mide cada stream en su `/Length`. Se usa ese numero.
  const buf = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
  const crudo = buf.toString('latin1');
  let salida = '';
  const re = /\/Length\s+(\d+)[^>]*>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(crudo)) !== null) {
    const ini = m.index + m[0].length;
    try { salida += zlib.inflateSync(buf.subarray(ini, ini + Number(m[1]))).toString('latin1'); }
    catch { /* fuentes e imagenes no son texto comprimido: se saltan */ }
  }
  // pdfkit escribe el texto en HEX, no como literal entre parentesis:
  //     [<41> 40 <43544956> 80 <4120494e56455253494f4e4553> 0] TJ
  // Con las 14 fuentes estandar (Helvetica) esos bytes son WinAnsi, o sea ASCII directo.
  // ⚠️ Si algun dia se embebe una fuente con subsetting, los codigos pasarian a ser glyph
  // ids y esto dejaria de leer texto: los tests fallarian ruidosamente, que es lo correcto.
  // Se cubren igual los literales `(texto) Tj` por si cambia el modo de escritura.
  const hex = (salida.match(/<([0-9A-Fa-f]+)>/g) || [])
    .map((t) => Buffer.from(t.slice(1, -1), 'hex').toString('latin1'));
  const literales = (salida.match(/\(((?:\\.|[^()\\])*)\)/g) || [])
    .map((t) => t.slice(1, -1).replace(/\\([()\\])/g, '$1'));
  return [...hex, ...literales].join('');
}

const ventana = (i, uw) => ({
  id: `V${i}`, producto: `Ventana PVC S60 corredera`, medidas: `${1000 + i}x1400mm`,
  vidrio: 'DVH 5/12/5', ambiente: 'Dormitorio', cantidad: 1, uw,
});

test('🔴 TODAS las ventanas del proyecto aparecen en el PDF renderizado', async () => {
  // El defecto original en su forma mas simple: 8 ventanas cotizadas, 1 sola en el informe.
  const ventanas = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ventana(i, i === 3 || i === 6 ? null : 2.5 + i / 20));
  const pdf = await generarInformeTermicoPdf(DATOS, { nombre: 'Vanessa Wainer', ventanas });
  const txt = textoDelPdf(pdf);

  for (const v of ventanas) {
    assert.ok(txt.includes(v.id), `la ventana ${v.id} no quedo dibujada en el documento`);
  }
  assert.ok(txt.includes('LAS VENTANAS DE SU PROYECTO'), 'el titulo va en plural');
});

test('🔴 las ventanas SIN Uw se dibujan con su motivo, no se omiten ni quedan en blanco', async () => {
  // Omitirlas haria parecer que el proyecto tiene menos ventanas de las que tiene; dejar el
  // hueco vacio se lee como un error del documento. Se rotulan.
  const ventanas = [ventana(1, 2.7), ventana(2, null)];
  const txt = textoDelPdf(await generarInformeTermicoPdf(DATOS, { ventanas }));
  assert.ok(txt.includes('V2'), 'la ventana sin Uw igual aparece');
  assert.match(txt, /certificaci/, 'y dice POR QUE no tiene numero');
});

test('🔴 un Uw ausente NUNCA se dibuja como 0,00 ni con veredicto', async () => {
  // La regla dura del proyecto, verificada sobre el documento y no sobre la funcion pura.
  const txt = textoDelPdf(await generarInformeTermicoPdf(DATOS, { ventanas: [ventana(1, null)] }));
  assert.doesNotMatch(txt, /0,00/, 'un cero espurio en un informe firmado');
});

test('una sola ventana: el recuadro grande, en singular', async () => {
  const txt = textoDelPdf(await generarInformeTermicoPdf(DATOS, { ventanas: [ventana(1, 2.7)] }));
  assert.ok(txt.includes('LA VENTANA DE SU COTIZACIÓN'), 'singular cuando es una sola');
  assert.ok(!txt.includes('LAS VENTANAS DE SU PROYECTO'));
});

test('🔴 la sintesis del conjunto llega al documento, no solo a la funcion pura', async () => {
  const cumplen = [ventana(1, 2.7), ventana(2, 2.8)];
  assert.match(textoDelPdf(await generarInformeTermicoPdf(DATOS, { ventanas: cumplen })),
    /Las 2 ventanas calculadas cumplen/);

  const ninguna = [ventana(1, 4.2), ventana(2, 3.9)];
  const txt = textoDelPdf(await generarInformeTermicoPdf(DATOS, { ventanas: ninguna }));
  assert.match(txt, /Ninguna de las 2 ventanas calculadas cumple/);
  assert.doesNotMatch(txt, /El resto cumple/,
    'no hay resto: afirmarlo es declarar cumplimiento de un conjunto vacio');
});

test('🔴 los recuentos del encabezado y de la sintesis no se contradicen', async () => {
  // El P1 de Codex, comprobado sobre el papel: dos partidas de 3 son 6 ventanas ARRIBA y
  // 6 ventanas ABAJO. Antes decia 6 arriba y "Las 2 ventanas calculadas" abajo.
  const ventanas = [{ ...ventana(1, 2.7), cantidad: 3 }, { ...ventana(2, 2.8), cantidad: 3 }];
  const txt = textoDelPdf(await generarInformeTermicoPdf(DATOS, { ventanas }));
  assert.ok(txt.includes('6 ventanas'), 'el encabezado cuenta unidades');
  assert.match(txt, /Las 6 ventanas calculadas cumplen/, 'y la sintesis, el mismo numero');
  assert.doesNotMatch(txt, /Las 2 ventanas calculadas/, 'contar filas contradice al encabezado');
});

test('un proyecto largo NO se corta: 30 ventanas entran todas, en varias paginas', async () => {
  const ventanas = Array.from({ length: 30 }, (_, i) => ventana(i + 1, i % 5 === 0 ? null : 2.6 + (i % 8) / 20));
  const pdf = await generarInformeTermicoPdf(DATOS, { ventanas });
  const txt = textoDelPdf(pdf);
  for (const v of ventanas) assert.ok(txt.includes(v.id), `falta ${v.id}: el informe se corto`);
  assert.ok((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length > 1,
    'tiene que haber paginado en vez de recortar');
});

// ── 🔴 [2026-08-24 · Codex, 2a pasada] UNA PARTIDA DE VARIAS UNIDADES ────────────────
// El singular se decidia por `filas.length === 1`, o sea por como se agrupo la cotizacion.
// Una sola partida de 4 unidades caia en el recuadro "LA VENTANA DE SU COTIZACION": sin
// el "×4", sin el encabezado "4 ventanas" y sin sintesis. El cliente compra cuatro y el
// documento le habla de una.
test('🔴 una partida de 4 unidades NO es "LA VENTANA": son 4', async () => {
  const ventanas = [{ ...ventana(1, 2.8), cantidad: 4 }];
  const txt = textoDelPdf(await generarInformeTermicoPdf(DATOS, { ventanas }));
  assert.ok(!txt.includes('LA VENTANA DE SU COTIZACIÓN'), 'no es una sola ventana');
  assert.ok(txt.includes('4 ventanas'), 'el encabezado tiene que contarlas');
  assert.match(txt, /×4/, 'y la fila decir cuantas son');
  assert.match(txt, /Las 4 ventanas calculadas cumplen/, 'con su sintesis');
});

test('una partida de UNA unidad sigue usando el recuadro grande', async () => {
  const txt = textoDelPdf(await generarInformeTermicoPdf(DATOS, { ventanas: [ventana(1, 2.7)] }));
  assert.ok(txt.includes('LA VENTANA DE SU COTIZACIÓN'));
});

test('🔴 [Codex P2] una ventana sin Uw no recibe NINGUN veredicto en el papel', async () => {
  // El test anterior solo miraba que no apareciera "0,00" — si el documento imprimiera
  // "CUMPLE" sin numero, pasaba igual. Un veredicto sin medicion es peor que un cero.
  const txt = textoDelPdf(await generarInformeTermicoPdf(DATOS, { ventanas: [ventana(1, null), ventana(2, null)] }));
  // Se mira SOLO el bloque de las ventanas. Mas abajo el informe explica la norma en
  // general ("una ventana que lo supere no cumple la norma vigente"), y eso es doctrina,
  // no un veredicto sobre SU ventana: buscar la palabra en todo el documento daria un
  // falso positivo y el test terminaria prohibiendo un texto correcto.
  const ini = txt.indexOf('LAS VENTANAS DE SU PROYECTO');
  const bloque = txt.slice(ini, txt.indexOf('QUÉ EXIGE LA NORMA', ini));
  assert.ok(ini >= 0 && bloque.length > 0, 'no se encontro el bloque de las ventanas');
  assert.doesNotMatch(bloque, /cumple/i, 'sin Uw no hay veredicto posible');
  assert.doesNotMatch(bloque, /0,00/);
  assert.match(bloque, /certificaci/, 'lo que si va es el motivo');
});
