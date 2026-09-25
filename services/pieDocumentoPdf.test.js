// Guardia del pie compartido. Nace del reclamo del dueno (25-sep): los tres documentos que
// ve el cliente tenian pies DISTINTOS y ninguno decia que eran confidenciales.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRMA_ACTIVA, CINTA_ENERGIA, textoConfidencial,
  dibujarPieDocumento, dibujarFirmaActiva,
} from './pieDocumentoPdf.js';

// Doble de pdfkit: registra lo que se dibujo, sin generar un PDF de verdad.
function docFalso() {
  const escrito = [], rects = [], imagenes = [];
  const d = {
    escrito, rects, imagenes,
    fillColor() { return d; }, fontSize() { return d; }, font() { return d; },
    text(t) { escrito.push(String(t)); return d; },
    rect(x, y, w, h) { rects.push({ x, y, w, h, color: null }); return d; },
    fill(c) { if (rects.length) rects[rects.length - 1].color = c; return d; },
    heightOfString() { return 30; },
    widthOfString(t) { return String(t).length * 4; },   // suficiente para medir el bloque dorado
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
  assert.match(todo, /CONFIDENCIAL/);
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
