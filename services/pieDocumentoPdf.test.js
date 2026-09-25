// Guardia del pie compartido. Nace del reclamo del dueno (25-sep): los tres documentos que
// ve el cliente tenian pies DISTINTOS y ninguno decia que eran confidenciales.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRMA_ACTIVA, CINTA_ENERGIA, textoConfidencial, textoConfidencialCorto,
  dibujarPieDocumento, dibujarFirmaActiva, sellarConfidencialidad, dibujarQR, URL_VERIFICACION,
} from './pieDocumentoPdf.js';

// Doble de pdfkit: registra lo que se dibujo, sin generar un PDF de verdad.
function docFalso() {
  const escrito = [], rects = [], imagenes = [], enlaces = [];
  let paginas = 1;
  const d = {
    escrito, rects, imagenes, enlaces, get paginas() { return paginas; },
    fillColor() { return d; }, fontSize() { return d; }, font() { return d; },
    text(t) { escrito.push(String(t)); return d; },
    rect(x, y, w, h) { rects.push({ x, y, w, h, color: null }); return d; },
    fill(c) { if (rects.length) rects[rects.length - 1].color = c; return d; },
    heightOfString() { return 30; },
    page: { height: 792 },
    addPage() { paginas += 1; return d; },
    widthOfString(t) { return String(t).length * 4; },   // suficiente para medir el bloque dorado
    link(x, y, w, h, url) { enlaces.push({ x, y, w, h, url }); return d; },
    image(ruta) { imagenes.push(ruta); return d; },
  };
  return d;
}

test('la cláusula nombra al destinatario cuando se conoce', () => {
  const t = textoConfidencial('Maya Mapu SpA, RUT 77.123.456-0');
  assert.match(t, /uso exclusivo de Maya Mapu SpA, RUT 77\.123\.456-0/);
  assert.match(t, /CONFIDENCIAL/);
  assert.match(t, /acciones civiles y penales/);
});

test('🔴 SIN destinatario no imprime undefined ni una linea vacia', () => {
  const t = textoConfidencial('');
  assert.match(t, /uso exclusivo de su destinatario/);
  assert.ok(!/undefined|null/.test(t), 'jamas debe filtrar undefined a un documento formal');
  assert.equal(textoConfidencial(undefined), t, 'undefined y vacio se comportan igual');
});

test('la firma es UNA sola para los tres documentos, y dice Evaluador', () => {
  assert.match(FIRMA_ACTIVA.cargo, /Evaluador Energético/);
  assert.ok(!/Calificador/.test(FIRMA_ACTIVA.cargo),
    'el MINVU acredita Evaluadores, no Calificadores');
  const titulos = FIRMA_ACTIVA.titulos.join(' ');
  assert.ok(Array.isArray(FIRMA_ACTIVA.titulos), 'los titulos van por lineas: la columna mide 338pt');
  assert.match(titulos, /Constructor Civil/);
  assert.match(titulos, /Magíster en Negocios/);
});

test('la cinta dibuja los 5 colores de la etiqueta de eficiencia', () => {
  const d = docFalso();
  dibujarFirmaActiva(d, { y: 100, ancho: 500 });
  const colores = d.rects.map(r => r.color).filter(Boolean);
  assert.deepEqual(colores.slice(0, 5), CINTA_ENERGIA);
});

test('el pie completo escribe nombre, cargo, titulos, contacto y la clausula', () => {
  const d = docFalso();
  const yFinal = dibujarPieDocumento(d, { y: 100, ancho: 500, destinatario: 'Fulano, RUT 1-9' });
  const todo = d.escrito.join(' | ');
  assert.match(todo, /Marcelo Cifuentes Méndez/);
  assert.match(todo, /Evaluador Energético Externo acreditado MINVU/);
  assert.match(todo, /Constructor Civil/);
  assert.match(todo, /mcifuentes@activaspa\.cl/);
  // La clausula YA NO va en el bloque: desde el 25-sep se sella en el borde inferior de CADA
  // hoja (pedido del dueno). Si volviera aca, saldria DUPLICADA en la ultima pagina.
  assert.ok(!/CONFIDENCIAL/.test(todo), 'la clausula no va en el bloque, va por pagina');
  assert.ok(yFinal > 100, 'debe devolver la Y siguiente para que el llamador siga dibujando');
});

test('🔴 los DOS logotipos van en el pie (reclamo del dueno 25-sep: "pense que la firma la dejariamos asi")', () => {
  const d = docFalso();
  dibujarFirmaActiva(d, { y: 100, ancho: 512 });
  assert.equal(d.imagenes.length, 2, 'deben ir el logo de Activa Y el sello CEV');
  assert.match(d.imagenes.join(' '), /logo-activa\.png/);
  assert.match(d.imagenes.join(' '), /sello-cev\.png/);
});

test('el cargo va sobre bloque dorado, no como texto dorado (contraste 1,86:1 medido)', () => {
  const d = docFalso();
  dibujarFirmaActiva(d, { y: 100, ancho: 512, paleta: { gold: '#F5B222' } });
  assert.ok(d.rects.some(r => r.color === '#F5B222' && r.h === 13),
    'debe existir el rectangulo dorado del cargo');
});

test('🔴 GUARDIA DE PAGINA: si el pie no cabe agrega UNA pagina, no una por linea', () => {
  // El defecto real, medido al conectar esto: dibujar en una `y` absoluta que ya no cabe
  // hacia que pdfkit agregara una pagina POR CADA linea. Los informes pasaron de 2 a 4
  // paginas y lo cazaron los tests de conteo de informeVientosPdf.curvas.test.js.
  const d = docFalso();
  d.page.height = 792;
  dibujarPieDocumento(d, { y: 700, ancho: 512, destinatario: '' });   // 700 + 150 > 792 - 60
  assert.equal(d.paginas, 2, 'exactamente UNA pagina nueva');
});

test('si el pie cabe, NO agrega pagina', () => {
  const d = docFalso();
  d.page.height = 792;
  dibujarPieDocumento(d, { y: 200, ancho: 512, destinatario: '' });
  assert.equal(d.paginas, 1);
});


// ---------------------------------------------------------------------------
// SELLADO EN TODAS LAS HOJAS (pedido del dueno 25-sep: *"me referia que estuviera en todas
// las hojas en el borde inferior"*). Una hoja suelta fotocopiada tiene que llevar el aviso.
// ---------------------------------------------------------------------------
function docConPaginas(n) {
  const escrito = [];
  let actual = 0;
  return {
    escrito,
    page: { width: 595, height: 842, margins: { bottom: 50 } },
    bufferedPageRange() { return { start: 0, count: n }; },
    switchToPage(i) { actual = i; return this; },
    fillColor() { return this; }, fontSize() { return this; }, font() { return this; },
    text(t, x, y) { escrito.push({ pagina: actual, t: String(t), y }); return this; },
  };
}

test('🔴 la clausula se sella en TODAS las hojas, una vez por hoja', () => {
  const d = docConPaginas(3);
  const n = sellarConfidencialidad(d, { destinatario: 'Fulano, RUT 1-9' });
  assert.equal(n, 3);
  assert.deepEqual(d.escrito.map((e) => e.pagina), [0, 1, 2]);
  for (const e of d.escrito) assert.match(e.t, /CONFIDENCIAL/);
});

test('se apoya en el BORDE INFERIOR, no en el medio de la hoja', () => {
  const d = docConPaginas(1);
  sellarConfidencialidad(d, { destinatario: '', margenInferior: 66 });
  assert.equal(d.escrito[0].y, 842 - 66);
});

test('anula el margen inferior: sin eso pdfkit agrega hojas al escribir abajo', () => {
  const d = docConPaginas(1);
  sellarConfidencialidad(d, { destinatario: '' });
  assert.equal(d.page.margins.bottom, 0);
});

test('un documento SIN buffer de paginas no revienta: no sella y sigue', () => {
  const sinBuffer = { page: { width: 595, height: 842 } };
  assert.equal(sellarConfidencialidad(sinBuffer, { destinatario: '' }), 0);
});

test('la version corta nombra al destinatario y conserva la advertencia legal', () => {
  const t = textoConfidencialCorto('Maya Mapu SpA, RUT 77.123.456-0');
  assert.match(t, /Uso exclusivo de Maya Mapu SpA/);
  assert.match(t, /acciones civiles y penales/);
  assert.ok(textoConfidencialCorto('').length < textoConfidencial('').length,
    'la de cada hoja es mas corta que la larga');
});

// ---------------------------------------------------------------------------
// QR DE VERIFICACION. Apunta al FOLIO ISO (informe_number / quote_number), que es el mismo
// registro que ya se guardaba: *"los folios deben ser guardados como ISO registros como
// todas las demas cotizaciones"*. No hay numeracion paralela.
// ---------------------------------------------------------------------------
function docQR() {
  const rects = [];
  const d = {
    rects,
    page: { width: 595, height: 842, margins: { bottom: 50 } },
    fillColor() { return d; }, fontSize() { return d; }, font() { return d; },
    text() { return d; }, image() { return d; },
    rect(x, y, w, h) { rects.push({ x, y, w, h }); return d; },
    fill() { return d; },
    heightOfString() { return 20; }, widthOfString(t) { return String(t).length * 4; },
    link() { return d; },
  };
  return d;
}

test('🔴 SIN folio no se dibuja QR: uno que apunte a la nada es peor que ninguno', () => {
  assert.equal(dibujarQR(docQR(), { x: 0, y: 0, folio: '' }), null);
  assert.equal(dibujarQR(docQR(), { x: 0, y: 0, folio: '   ' }), null);
  assert.equal(dibujarQR(docQR(), { x: 0, y: 0 }), null);
});

test('el QR apunta al folio ISO, sobre la pagina publica de verificacion', () => {
  const url = dibujarQR(docQR(), { x: 0, y: 0, folio: 'AT-CM-FR-006-2026-0281' });
  assert.equal(url, URL_VERIFICACION + '/AT-CM-FR-006-2026-0281');
  assert.match(url, /\/verificar\//);
});

test('el folio se codifica: un folio con caracteres raros no rompe la URL', () => {
  const url = dibujarQR(docQR(), { x: 0, y: 0, folio: 'AT/2026 #1' });
  assert.ok(!/[ #]/.test(url.split('/verificar/')[1]), 'el folio va escapado');
});

test('el QR se dibuja con rectangulos (vectorial), no como imagen', () => {
  const d = docQR();
  dibujarQR(d, { x: 10, y: 20, lado: 46, folio: 'AT-CM-FR-006-2026-0281' });
  assert.ok(d.rects.length > 100, 'un QR real tiene cientos de modulos');
  // El PRIMER rectangulo es la zona de silencio (fondo blanco), que por definicion es mas
  // grande que el QR. Los modulos van despues y si deben caer dentro del lado declarado.
  const [silencio, ...modulos] = d.rects;
  assert.ok(silencio.w > 46 && silencio.h > 46, 'la zona de silencio rodea al QR');
  for (const r of modulos) {
    assert.ok(r.x >= 10 && r.x <= 10 + 46, 'ningun modulo se sale a la izquierda/derecha');
    assert.ok(r.y >= 20 && r.y <= 20 + 46, 'ningun modulo se sale arriba/abajo');
  }
});

test('🔴 LEY 19.496 art. 17: la clausula NO puede ir bajo 2,5 mm de alto de letra', () => {
  // *"Los contratos de adhesion... deberan estar escritos de modo claramente legible, con un
  // tamano de letra no inferior a 2,5 milimetros"*, y las clausulas que no cumplen "no
  // produciran efecto alguno respecto del consumidor". 1 pt = 0,35278 mm => el piso son
  // 7,0865 pt. Estaba en 5,4 (1,91 mm) y el dueno lo noto mirando el PDF, no un test.
  const d = docConPaginas(1);
  let usado = null;
  const fontSizeOrig = d.fontSize.bind(d);
  d.fontSize = (n) => { usado = n; return fontSizeOrig(n); };
  sellarConfidencialidad(d, { destinatario: 'X' });
  const mm = usado * 0.35278;
  assert.ok(mm >= 2.5, `la clausula quedo en ${mm.toFixed(2)} mm: bajo el minimo legal de 2,5`);
});
