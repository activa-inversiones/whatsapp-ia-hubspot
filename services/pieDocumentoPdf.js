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
  titulos: 'Ingeniero Civil Industrial · Constructor Civil · Ingeniero Electrónico · '
         + 'MBA Magíster en Administración y Negocios · Magíster en Negocios',
  rol: 'Gerente de Ingeniería · Activa Inversiones',
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

/**
 * Firma completa y uniforme. `paleta` = { navy, gold, gray, verde } del documento que llama.
 * Devuelve la Y siguiente.
 */
export function dibujarFirmaActiva(doc, { x = 50, y, ancho, paleta = {} }) {
  const NAVY = paleta.navy || '#1F3A6E';
  const GRAY = paleta.gray || '#777777';
  const VERDE = paleta.verde || '#1B6B3A';
  const f = FIRMA_ACTIVA;

  let cur = dibujarCintaEnergetica(doc, x, y, ancho) + 9;
  doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold')
     .text(f.nombre, x, cur, { width: ancho, lineBreak: false });
  cur += 14;
  doc.fillColor(VERDE).fontSize(8.5).font('Helvetica-Bold')
     .text(f.cargo, x, cur, { width: ancho, lineBreak: false });
  cur += 12;
  doc.fillColor(GRAY).fontSize(7.5).font('Helvetica')
     .text(f.titulos, x, cur, { width: ancho, lineBreak: false });
  cur += 10;
  doc.text(f.rol, x, cur, { width: ancho, lineBreak: false });
  cur += 10;
  doc.text(f.contacto, x, cur, { width: ancho, lineBreak: false });
  return cur + 12;
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
export function dibujarPieDocumento(doc, { x = 50, y, ancho, destinatario, paleta }) {
  const y2 = dibujarFirmaActiva(doc, { x, y, ancho, paleta });
  return dibujarConfidencialidad(doc, { x, y: y2, ancho, destinatario, paleta });
}
