// services/pieDocumentoPdf.js — [2026-09-25]
//
// EL PIE QUE COMPARTEN LOS TRES DOCUMENTOS QUE VE EL CLIENTE: la propuesta
// (quotePdf.js), el informe térmico (informeTermicoPdf.js) y el de clima y vientos
// (informeVientosPdf.js).
//
// POR QUÉ EXISTE: reclamo del dueño (25-sep), textual: *"pero no están iguales y no se
// cumplieron los colores ni nada, se ve muy simple; los pie deben decir que son informes
// confidenciales"*. Tenía razón y estaba medido: los tres pies eran distintos entre sí
// —el térmico con filete dorado y 11 pt, el de vientos 9 pt sin títulos ni contacto, la
// propuesta con otro tamaño y el cargo en verde— y NINGUNO decía que el documento es
// confidencial.
//
// MISMO CRITERIO QUE bloqueIdentidadPdf.js, que ya resolvió esto para el bloque del
// RECEPTOR: "los informes están escritos para verse de la misma casa… una divergencia se
// nota y duele". Acá se dibuja UNA vez y cada documento pasa su propia paleta.
//
// REGLAS DURAS:
//  1. SIN destinatario identificado la cláusula NO nombra a nadie: dice "su destinatario"
//     en vez de imprimir "undefined" o una línea vacía. Es el caso más común (el cliente
//     todavía no dio su RUT) y no puede empeorar el documento.
//  2. El texto legal NO es asesoría jurídica. Es una cláusula de confidencialidad estándar
//     y quedó escrito acá para que quien la revise sepa dónde tocarla.
//  3. La cinta de colores es la MISMA que la firma de correo: verde→rojo de la etiqueta de
//     eficiencia. Es la marca visual que hace que los tres se reconozcan como de la casa.

// Colores de la etiqueta de eficiencia energética (los mismos del sello CEV y de la firma
// de correo). No son decorativos: es lo que el cliente asocia a la calificación.
export const CINTA_ENERGIA = ['#00A651', '#8DC63F', '#FFF200', '#F7941E', '#ED1C24'];

// Identidad del firmante. UNA sola fuente para los tres documentos: cuando el dueño cambia
// un título, cambia acá y no en tres archivos (así se coló "Calificador" en la propuesta
// mientras los informes ya decían "Evaluador").
export const FIRMA_ACTIVA = {
  nombre: 'Marcelo Cifuentes Méndez',
  cargo: 'Evaluador Energético Externo acreditado MINVU · Res. 266/2025',
  titulos: [
    'Ingeniero Civil Industrial · Constructor Civil · Ingeniero Electrónico',
    'MBA Magíster en Administración y Negocios · Magíster en Negocios',
  ],
  rol: 'Gerente de Ingeniería',
  contacto: 'mcifuentes@activaspa.cl · +56 9 5729 6035',
};

/**
 * Cláusula de confidencialidad. `destinatario` sale de destinatarioLegal() del bloque de
 * identidad ("Fulano, RUT 12.345.678-9") o viene vacío.
 */
export function textoConfidencial(destinatario) {
  const quien = destinatario ? `de ${destinatario}` : 'de su destinatario';
  return 'CONFIDENCIAL · Este documento es de uso exclusivo ' + quien + ' y contiene '
    + 'información técnica y comercial de propiedad de Activa Inversiones. Su reproducción, '
    + 'distribución, publicación o uso por terceros, total o parcial, sin autorización escrita '
    + 'previa de su titular, queda prohibida y facultará a Activa Inversiones para ejercer las '
    + 'acciones civiles y penales que contemple la legislación chilena. Si usted recibió este '
    + 'documento por error, notifíquelo a mcifuentes@activaspa.cl y elimínelo.';
}

/** Cinta de 5 colores. Devuelve la Y siguiente. */
export function dibujarCintaEnergetica(doc, x, y, ancho, alto = 3) {
  const w = ancho / CINTA_ENERGIA.length;
  CINTA_ENERGIA.forEach((c, i) => doc.rect(x + i * w, y, w + 0.5, alto).fill(c));
  return y + alto;
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const _AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RUTA_LOGO  = path.join(_AQUI, '..', 'assets', 'firma', 'logo-activa.png');
export const RUTA_SELLO = path.join(_AQUI, '..', 'assets', 'firma', 'sello-cev.png');

/** Imagen solo si el archivo existe. Mejor un pie sin logo que un PDF que no sale. */
function imagenSiExiste(doc, ruta, x, y, opciones) {
  try {
    if (!fs.existsSync(ruta)) return false;
    doc.image(ruta, x, y, opciones);
    return true;
  } catch { return false; }
}

/**
 * Firma completa, con el MISMO dibujo que la firma de correo: cinta de eficiencia, los dos
 * logotipos, el cargo en bloque dorado y la credencial en caja verde.
 *
 * POR QUE DOS COLUMNAS Y LOS LOGOS LADO A LADO: apilados median ~110 pt de alto y el informe
 * termico ya avisa en su codigo que reservar de mas manda la firma a una SEGUNDA PAGINA vacia
 * (informeTermicoPdf.js:1122). Lado a lado el bloque entero mide ~70 pt y no empuja nada.
 *
 * `paleta` = { navy, gold, gray, verde }. Devuelve la Y siguiente.
 */
export function dibujarFirmaActiva(doc, { x = 50, y, ancho, paleta = {}, firma = null }) {
  const NAVY  = paleta.navy  || '#1F3A6E';
  const GOLD  = paleta.gold  || '#F5B222';
  const GRAY  = paleta.gray  || '#777777';
  const VERDE = paleta.verde || '#1B6B3A';
  // `firma` permite que un informe puntual lo firme OTRO profesional sin tocar el codigo.
  // Sin eso, conectar este modulo habria pisado en silencio el parametro `firma` que los dos
  // informes ya aceptaban.
  const f = firma ? { ...FIRMA_ACTIVA, ...firma } : FIRMA_ACTIVA;
  const titulos = Array.isArray(f.titulos) ? f.titulos : [String(f.titulos || '')];

  const yIni = dibujarCintaEnergetica(doc, x, y, ancho) + 10;
  const ANCHO_IZQ = 160;
  const xDer = x + ANCHO_IZQ + 14;
  const anchoDer = ancho - ANCHO_IZQ - 14;

  // ---------- columna izquierda: los dos logotipos + la credencial ----------
  let yIzq = yIni;
  const hayLogo  = imagenSiExiste(doc, RUTA_LOGO,  x,      yIzq + 8, { width: 68 });
  const haySello = imagenSiExiste(doc, RUTA_SELLO, x + 92, yIzq,     { width: 54 });
  yIzq += (hayLogo || haySello) ? 34 : 0;

  // credencial en caja verde (misma del correo)
  doc.rect(x, yIzq, ANCHO_IZQ, 19).fill('#EAF4EC');
  doc.rect(x, yIzq, 2.5, 19).fill('#00A651');
  doc.fillColor(VERDE).fontSize(6.2).font('Helvetica-Bold')
     .text('EVALUADOR ENERGÉTICO ACREDITADO MINVU', x + 6, yIzq + 4,
           { width: ANCHO_IZQ - 10, lineBreak: false })
     .text('Res. 266/2025', x + 6, yIzq + 11, { width: ANCHO_IZQ - 10, lineBreak: false });
  yIzq += 22;

  // ---------- filete dorado vertical ----------
  doc.rect(x + ANCHO_IZQ + 6, yIni, 2, Math.max(yIzq - yIni, 76)).fill(GOLD);

  // ---------- columna derecha: nombre, cargo y contacto ----------
  let yDer = yIni;
  doc.fillColor(NAVY).fontSize(10.5).font('Helvetica-Bold')
     .text(f.nombre, xDer, yDer, { width: anchoDer, lineBreak: false });
  yDer += 14;

  // cargo sobre bloque dorado: el dorado como texto sobre blanco da 1,86:1 y se lee lavado;
  // como FONDO con el azul encima da 5,97:1. Medido, no estimado.
  doc.font('Helvetica-Bold').fontSize(7.5);
  const anchoCargo = doc.widthOfString(f.rol.toUpperCase()) + 14;
  doc.rect(xDer, yDer, anchoCargo, 13).fill(GOLD);
  doc.fillColor(NAVY).text(f.rol.toUpperCase(), xDer + 7, yDer + 3.5, { lineBreak: false });
  yDer += 17;

  doc.fillColor(GRAY).fontSize(7.5).font('Helvetica');
  for (const linea of titulos) {
    doc.text(linea, xDer, yDer, { width: anchoDer, lineBreak: false });
    yDer += 9;
  }
  yDer += 3;
  doc.fillColor(NAVY).fontSize(7.5).font('Helvetica-Bold')
     .text(f.cargo, xDer, yDer, { width: anchoDer, lineBreak: false });
  yDer += 12;
  doc.fillColor(GRAY).fontSize(7.5).font('Helvetica')
     .text(f.contacto, xDer, yDer, { width: anchoDer, lineBreak: false });
  yDer += 12;

  return Math.max(yIzq, yDer) + 6;
}

/** Caja de confidencialidad. Devuelve la Y siguiente. */
export function dibujarConfidencialidad(doc, { x = 50, y, ancho, destinatario, paleta = {} }) {
  const GRAY = paleta.gray || '#777777';
  const texto = textoConfidencial(destinatario);
  doc.font('Helvetica').fontSize(7);
  const alto = doc.heightOfString(texto, { width: ancho - 12 }) + 10;
  doc.rect(x, y, ancho, alto).fill('#F7F9FC');
  doc.fillColor(GRAY).fontSize(7).font('Helvetica')
     .text(texto, x + 6, y + 5, { width: ancho - 12, align: 'justify' });
  return y + alto + 4;
}

/** Los dos juntos, que es como van en los tres documentos. Devuelve la Y siguiente. */
/** Alto que reserva el pie completo (firma + clausula). Medido renderizando. */
export const ALTO_PIE = 150;   // medido renderizando: 141 pt + margen

/**
 * Los dos juntos, que es como van en los tres documentos. Devuelve la Y siguiente.
 *
 * GUARDIA DE PAGINA: dibujar en una `y` absoluta que ya no cabe hace que pdfkit agregue una
 * pagina POR CADA linea. Al conectar esto la primera vez, los informes pasaron de 2 a 4
 * paginas y lo cazaron los tests de conteo. Si no cabe, se agrega UNA pagina y se empieza
 * arriba.
 */
export function dibujarPieDocumento(doc, { x = 50, y, ancho, destinatario, paleta, firma = null,
                                            margenInferior = 60, alSaltar = null }) {
  const tope = doc.page.height - margenInferior;
  if (y + ALTO_PIE > tope) {
    doc.addPage();
    y = typeof alSaltar === 'number' ? alSaltar : 60;
  }
  const y2 = dibujarFirmaActiva(doc, { x, y, ancho, paleta, firma });
  return dibujarConfidencialidad(doc, { x, y: y2, ancho, destinatario, paleta });
}
