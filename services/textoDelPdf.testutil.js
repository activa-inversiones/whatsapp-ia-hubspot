// textoDelPdf.testutil.js — leer el TEXTO de un PDF ya renderizado, para los tests.
//
// [2026-10-10 · hallazgo de Thermos] Nace de una duplicacion: esta funcion vivia COPIADA en
// `informeTermicoPdf.render.test.js` y en `informePdf.cliente.test.js`, y hacia falta una tercera
// copia para el test de extremo a extremo del parrafo de laminas. Una copia se arregla y las otras
// no: el arreglo del 25-ago (cortar por `/Length` en vez de por una regex sobre el binario) tuvo
// que aplicarse dos veces. Ahora hay una sola.
//
// No es codigo de produccion: solo lo usan los tests.

import zlib from 'node:zlib';

/**
 * Texto del PDF. pdfkit escribe los contenidos en streams FlateDecode; se descomprimen todos y
 * se juntan. Los literales van entre parentesis dentro de operadores Tj/TJ.
 */
export function textoDelPdf(pdf) {
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

export default { textoDelPdf };
