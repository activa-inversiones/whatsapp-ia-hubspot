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
/**
 * EMISOR del documento. Sale del entorno, con los valores que dio el dueno el 24-ago como
 * respaldo: "Activa Inversiones EIRL, RUT 76.486.825-0". El DV se comprobo por modulo 11
 * (suma 187 -> DV 0 ✓): un digito verificador equivocado dentro del parrafo que pretende
 * tener valor juridico es peor que no ponerlo. Guardado por informeTermicoPdf.laminas.test.js.
 */
export const EMISOR = {
  razonSocial: String(process.env.EMISOR_RAZON_SOCIAL || 'Activa Inversiones EIRL').trim(),
  rut: String(process.env.EMISOR_RUT || '76.486.825-0').trim(),
};

export const CINTA_ENERGIA = ['#00A651', '#8DC63F', '#FFF200', '#F7941E', '#ED1C24'];

// Identidad del firmante. UNA sola fuente para los tres documentos: cuando el dueño cambia
// un título, cambia acá y no en tres archivos (así se coló "Calificador" en la propuesta
// mientras los informes ya decían "Evaluador").
export { FIRMA_ACTIVA } from './firmaActiva.js';

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

/**
 * Version CONDENSADA de la clausula, para el borde inferior de TODAS las hojas.
 * Pedido del dueno (25-sep): *"me referia que estuviera en todas las hojas en el borde
 * inferior"*. La version larga quedaba una sola vez al final; una hoja suelta fotocopiada
 * salia sin ninguna advertencia.
 */
export function textoConfidencialCorto(destinatario) {
  const quien = destinatario ? `de ${destinatario}` : 'de su destinatario';
  // Absorbe lo que decian los recuadros beige que los informes llevaban ARRIBA y que se
  // retiraron el 25-sep por orden del dueno (*"solo uno de informe confidencial"*): el uso
  // acotado AL PROYECTO y la prohibicion de usarlo para uno distinto. No se perdio nada.
  return 'CONFIDENCIAL · Uso exclusivo ' + quien + ' y del proyecto que lo motivó · Prohibida '
    + 'su reproducción, distribución o publicación, total o parcial, su alteración, y su uso '
    + `por terceros o para un proyecto distinto, sin autorización escrita previa de `
    + `${EMISOR.razonSocial}, RUT ${EMISOR.rut}; su incumplimiento facultará el ejercicio de `
    + 'las acciones civiles y penales que contemple la legislación chilena.';
}

/**
 * Sella la clausula en el BORDE INFERIOR DE CADA HOJA. Requiere `bufferPages: true` en el
 * PDFDocument; si el documento no lo tiene, no hace nada en vez de reventar.
 *
 * `margenInferior` = a que altura del borde se apoya. Cada documento tiene su propia franja
 * de pie y el texto va por encima de ella.
 *
 * 🔴 TAMANO 7,5 pt = 2,65 mm, NO 5,4. La Ley 19.496 art. 17 exige para los contratos de
 * adhesion "un tamano de letra no inferior a 2,5 milimetros", y sanciona lo que no cumple:
 * *"las clausulas que no cumplan con dichos requisitos no produciran efecto alguno respecto
 * del consumidor"*. Estos documentos no son un contrato de adhesion, pero una clausula que
 * pretende OBLIGAR al que la recibe no puede quedar por debajo de ese piso: si alguna vez
 * pasa a formar parte del contrato, en letra chica no vale nada.
 * El gris tambien se oscurecio (#5C6673): la norma pide "claramente legible", no solo un
 * tamano.
 */
export function sellarConfidencialidad(doc, { destinatario, margenInferior = 66, color = '#5C6673',
                                              tamano = 7.5, x = 50 } = {}) {
  if (typeof doc.bufferedPageRange !== 'function') return 0;
  let rango;
  try { rango = doc.bufferedPageRange(); } catch { return 0; }
  if (!rango || !rango.count) return 0;

  const texto = textoConfidencialCorto(destinatario);
  const ancho = doc.page.width - x * 2;
  for (let i = rango.start; i < rango.start + rango.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;            // sin esto pdfkit agrega hojas al escribir abajo
    doc.fillColor(color).fontSize(tamano).font('Helvetica')
       .text(texto, x, doc.page.height - margenInferior, { width: ancho, align: 'justify' });
  }
  return rango.count;
}

/**
 * Base de la pagina publica de verificacion. Del entorno para poder mudarla sin tocar codigo.
 */
export const URL_VERIFICACION = String(
  process.env.VERIFICACION_BASE_URL || 'https://ops.activalabs.ai/verificar').replace(/\/+$/, '');

/**
 * QR de verificacion, dibujado con RECTANGULOS vectoriales (no una imagen PNG): queda nitido
 * a cualquier zoom, pesa nada y no depende de un archivo en disco.
 *
 * ⚠️ El QR lleva SOLO el folio ISO. NO puede llevar la huella del PDF: el sha256 se calcula
 * SOBRE el archivo terminado, que todavia no existe mientras lo estamos dibujando.
 *
 * `folio` vacio => no dibuja nada. Un QR que apunta a un folio inexistente es peor que no
 * tener QR: le mostraria "no encontrado" al cliente.
 */
export function dibujarQR(doc, { x, y, lado = 46, folio, color = '#1F3A6E' }) {
  const f = String(folio || '').trim();
  if (!f) return null;
  const url = `${URL_VERIFICACION}/${encodeURIComponent(f)}`;
  let q;
  try {
    q = qrcode(0, 'M');            // version automatica, correccion media
    q.addData(url);
    q.make();
  } catch {
    return null;                   // sin QR el documento igual sale
  }
  const n = q.getModuleCount();
  const paso = lado / n;

  // ZONA DE SILENCIO: el estandar pide 4 modulos de blanco alrededor. jsQR decodifica igual
  // sin ella (probado), pero los lectores de telefono son menos tolerantes y aca el QR queda
  // pegado al resto del pie. Un fondo blanco explicito cuesta nada y quita el riesgo.
  const silencio = paso * 4;
  doc.rect(x - silencio, y - silencio, lado + silencio * 2, lado + silencio * 2).fill('#FFFFFF');

  doc.fillColor(color);
  for (let fila = 0; fila < n; fila++) {
    for (let col = 0; col < n; col++) {
      if (q.isDark(fila, col)) doc.rect(x + col * paso, y + fila * paso, paso + 0.12, paso + 0.12).fill(color);
    }
  }
  return url;
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
import qrcode from 'qrcode-generator';
import { FIRMA_ACTIVA } from './firmaActiva.js';

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
export function dibujarFirmaActiva(doc, { x = 50, y, ancho, paleta = {}, firma = null, folio = '' }) {
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
  const ANCHO_IZQ = 150;
  const xDer = x + ANCHO_IZQ + 14;
  const anchoDer = ancho - ANCHO_IZQ - 14 - 72;   // 72 = QR (62) + zona de silencio

  // ---------- columna izquierda: los dos logotipos + la credencial ----------
  let yIzq = yIni;
  const hayLogo  = imagenSiExiste(doc, RUTA_LOGO,  x,      yIzq + 8, { width: 68 });
  const haySello = imagenSiExiste(doc, RUTA_SELLO, x + 92, yIzq,     { width: 54 });
  yIzq += (hayLogo || haySello) ? 34 : 0;

  // credencial en caja verde (misma del correo)
  // DOS lineas medidas, no una que se parta sola: "EVALUADOR ENERGETICO ACREDITADO MINVU"
  // mide 145 pt y la caja tiene 140 utiles, asi que pdfkit la envolvia y la segunda linea
  // quedaba PISADA por "Res. 266/2025". Se ve en los PDF del 25-sep como "MINVU/266/2025".
  doc.rect(x, yIzq, ANCHO_IZQ, 21).fill('#EAF4EC');
  doc.rect(x, yIzq, 2.5, 21).fill('#00A651');
  doc.fillColor(VERDE).fontSize(6.2).font('Helvetica-Bold')
     .text('EVALUADOR ENERGÉTICO', x + 6, yIzq + 4.5, { width: ANCHO_IZQ - 10, lineBreak: false })
     .text('ACREDITADO MINVU · Res. 266/2025', x + 6, yIzq + 12, { width: ANCHO_IZQ - 10, lineBreak: false });
  yIzq += 24;

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
  const cargoLinea = f.resolucionCorta ? `${f.cargo} · ${f.resolucionCorta}` : f.cargo;
  doc.fillColor(NAVY).fontSize(7.5).font('Helvetica-Bold')
     .text(cargoLinea, xDer, yDer, { width: anchoDer, lineBreak: false });
  yDer += 12;
  // CONTACTO PINCHABLE. Pedido del dueno (25-sep): *"si quiero pinchar whatsapp, telefono,
  // link de la empresa... para que sea mas facil contactarnos"*. En PDF los enlaces se marcan
  // con `link:` y el lector abre el telefono, WhatsApp o el navegador. Se dibuja pieza por
  // pieza midiendo el ancho, porque cada una lleva SU url.
  const piezas = [
    { t: f.correo, url: f.correoUrl, color: GRAY },
    { t: '  ·  ', url: null, color: '#C9CDD4' },
    { t: f.telefono, url: f.telefonoUrl, color: GRAY },
    { t: '  ·  ', url: null, color: '#C9CDD4' },
    { t: 'WhatsApp', url: f.whatsappUrl, color: '#128C7E', negrita: true },
    { t: '  ·  ', url: null, color: '#C9CDD4' },
    { t: f.web, url: f.webUrl, color: NAVY, negrita: true },
  ];
  // ⚠️ El enlace NO se pasa dentro de `text({ link })`: en esta version de pdfkit, combinarlo
  // con `lineBreak: false` revienta con "unsupported number: NaN" (medido aislandolo). Se
  // dibuja el texto y despues se pone el rectangulo pinchable encima, que ademas es exacto.
  let xc = xDer;
  for (const pz of piezas) {
    if (!pz.t) continue;
    doc.font(pz.negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(pz.color);
    const w = doc.widthOfString(pz.t);
    doc.text(pz.t, xc, yDer, { lineBreak: false });
    if (pz.url) doc.link(xc, yDer - 1, w, 10, pz.url);
    xc += w;
  }
  yDer += 12;

  // QR de verificacion al extremo derecho. 62 pt y no 46: pedido del dueno (25-sep), *"deberia
  // ser un poco mas grande para que el cliente no le cueste tanto escanearlo si imprime la
  // hoja"*. A 62 pt impresos son ~2,2 cm de lado, que es el minimo comodo para la camara de un
  // telefono a un palmo de distancia.
  const LADO_QR = 62;
  const xQR = x + ancho - LADO_QR - 6;   // 6 = zona de silencio derecha
  const urlQR = dibujarQR(doc, { x: xQR, y: yIni + 2, lado: LADO_QR, folio, color: NAVY });
  if (urlQR) {
    // El QR tambien se puede PINCHAR: quien lea el PDF en el computador no tiene camara.
    doc.link(xQR, yIni + 2, LADO_QR, LADO_QR, urlQR);
    doc.fillColor(GRAY).fontSize(5.2).font('Helvetica')
       .text('Verifique este', xQR, yIni + LADO_QR + 5, { width: LADO_QR, align: 'center', lineBreak: false })
       .text('documento', xQR, yIni + LADO_QR + 11, { width: LADO_QR, align: 'center', lineBreak: false });
  }

  return Math.max(yIzq, yDer, yIni + LADO_QR + 18) + 6;
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
export const ALTO_PIE = 105;   // solo la firma: la clausula se sella por pagina

/**
 * Los dos juntos, que es como van en los tres documentos. Devuelve la Y siguiente.
 *
 * GUARDIA DE PAGINA: dibujar en una `y` absoluta que ya no cabe hace que pdfkit agregue una
 * pagina POR CADA linea. Al conectar esto la primera vez, los informes pasaron de 2 a 4
 * paginas y lo cazaron los tests de conteo. Si no cabe, se agrega UNA pagina y se empieza
 * arriba.
 */
export function dibujarPieDocumento(doc, { x = 50, y, ancho, destinatario, paleta, firma = null,
                                            folio = '', margenInferior = 60, alSaltar = null }) {
  const tope = doc.page.height - margenInferior;
  if (y + ALTO_PIE > tope) {
    doc.addPage();
    y = typeof alSaltar === 'number' ? alSaltar : 60;
  }
  // La clausula YA NO va aca: desde el 25-sep se sella en el borde inferior de TODAS las
  // hojas con `sellarConfidencialidad()`. Dejarla tambien aca la duplicaria en la ultima.
  return dibujarFirmaActiva(doc, { x, y, ancho, paleta, firma, folio });
}
