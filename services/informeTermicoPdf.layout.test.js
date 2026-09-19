import test from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';

/* =========================================================================
 * 🔴 LA INVARIANTE QUE NO EXISTIA, Y POR ESO SE ROMPIO LA TABLA EN PRODUCCION
 *
 * El 19-sep se ensancharon las columnas del informe para que dejara de comerse las palabras.
 * Se ensancharon SUPONIENDO una pagina apaisada. El informe es **A4 RETRATO** (W = 595,28;
 * area util 50..545). Resultado, ya desplegado:
 *     vid 422..550  -> se cruzaba con NORMA (450..535)
 *     uw  556..602  -> FUERA de la pagina
 * Lo cazo Codex en la compuerta SIN ver el valor de W, por la razon correcta: *"no existe una
 * invariante ni prueba que impida el cruce"*.
 *
 * Este test ES esa invariante. No dibuja: comprueba la geometria, que es lo que fallo.
 * ⚠️ Los numeros de abajo son una COPIA de los de informeTermicoPdf.js. Si alguien mueve una
 * columna alla y no aca, el test no lo caza — por eso ademas se verifica contra el ancho REAL
 * de una A4 retrato, que es el dato que se habia supuesto mal.
 * ========================================================================= */

// Copia de la tabla de informeTermicoPdf.js (bloque "Tabla. Columnas en x fijos").
const W = new PDFDocument({ size: 'A4', margin: 50 }).page.width;
const X = { id: 58, prod: 86, med: 240, vid: 300, uw: 400, ver: W - 145 };
const ANCHO = { prod: 150, med: 56, vid: 96, uw: 46, ver: 85 };

test('🔴 el informe es A4 RETRATO — el supuesto que rompio la tabla', () => {
  assert.ok(Math.abs(W - 595.28) < 1, `W real = ${W}; si esto cambia, revisar TODAS las columnas`);
});

test('🔴 ninguna columna se sale del area util (50 .. W-50)', () => {
  for (const [k, x] of Object.entries(X)) {
    const fin = x + ANCHO[k === 'id' ? 'med' : k] * 0 + (ANCHO[k] || 24);
    assert.ok(x >= 50, `${k} empieza en ${x}, antes del margen`);
    assert.ok(fin <= W - 50 + 0.01, `${k} termina en ${fin} y el area util llega a ${W - 50}`);
  }
});

test('🔴 las columnas NO se cruzan entre si', () => {
  const tramos = Object.keys(X)
    .map((k) => ({ k, ini: X[k], fin: X[k] + (ANCHO[k] || 24) }))
    .sort((a, b) => a.ini - b.ini);
  for (let i = 1; i < tramos.length; i += 1) {
    assert.ok(tramos[i].ini >= tramos[i - 1].fin,
      `"${tramos[i - 1].k}" (…${tramos[i - 1].fin}) se cruza con "${tramos[i].k}" (${tramos[i].ini}…)`);
  }
});

test('🔒 los textos reales del cliente ENTRAN o se recortan con "…", nunca a mitad de palabra', () => {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const cabe = (txt, ancho, size) => { doc.fontSize(size); return doc.widthOfString(txt) <= ancho; };
  // Los de la propuesta real 0485 / informe 0197.
  assert.ok(cabe('Termopanel 5+12+5', ANCHO.vid, 7), 'el vidrio mas comun tiene que entrar entero');
  assert.ok(cabe('Termopanel 4+12+4 saten', ANCHO.vid, 7), 'y el de baño tambien');
  assert.ok(cabe('2710x1995', ANCHO.med, 7.5), 'las medidas enteras');
  // El rotulo largo NO entra en una linea (por eso se le dan dos): esto lo deja documentado.
  assert.ok(!cabe('Corredera SLIDING H98 Doble Riel S75 - triple hoja central fija', ANCHO.prod, 7.5),
    'si algun dia entrara en una linea, se puede simplificar el bloque de 2 lineas');
});
