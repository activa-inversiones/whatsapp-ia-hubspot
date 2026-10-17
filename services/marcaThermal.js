// informes_pdf/services/marcaThermal.js — cabecera de marca ACTIVA THERMAL (2026-10-17).
// ───────────────────────────────────────────────────────────────────────────────────────────
// Decision del dueno (17-oct): los informes tecnicos (termico CM-FR-006, vientos y clima
// CM-FR-007) salen desde ACTIVA THERMAL, la unidad de I+D+i, con su logo aprobado ese dia
// (A con isotermas reales; ambar #F8B117 / azul #2059A7; generador tools/marca/logo_activa_thermal.py).
// Antes la franja decia "ACTIVA INVERSIONES" en texto: esa identidad legal NO desaparece, sigue en
// el pie de cada pagina y en la firma (quien emite y responde por el documento).
//
// Una sola funcion para los dos informes: si mañana cambia el logo, cambia en un lugar.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const _AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RUTA_LOGO_THERMAL_NEGATIVO = path.join(_AQUI, '..', 'assets', 'marca', 'ACTIVA_THERMAL_cabecera_sobre_0B3D6F.jpg');

// Logo negativo YA compuesto sobre el NAVY de la franja (#0B3D6F): una sola imagen JPEG (calidad 92, sin submuestreo de color), sin mascara
// alfa (con alfa pdfkit incrusta 2 objetos). Si cambia el NAVY, regenerar el JPG.
// Proporcion medida (1200 x 354 px; reducido desde 2723 x 804: a 62 pt de alto alcanza
// ~430 dpi; en JPEG el informe pesa ~101-114 KB contra ~139 KB con el PNG grande). Alto en la franja de 90 pt: 62 pt, centrado.
const PROPORCION = 1200 / 354;
export const ALTO_LOGO_PT = 62;

/**
 * Dibuja la franja de cabecera con el logo ACTIVA THERMAL. Devuelve true si el logo se dibujo.
 * Si el archivo no esta (despliegue incompleto), cae al texto de marca: un informe sin logo sale;
 * un informe que no sale porque falta una imagen, no (misma regla que la firma).
 */
export function dibujarCabeceraThermal(doc, { ancho, navy, gold, altoFranja = 90 }) {
  doc.rect(0, 0, ancho, altoFranja).fill(navy);
  const y = (altoFranja - ALTO_LOGO_PT) / 2;
  // [24-ago, dueno] "Evaluacion energetica acreditada MINVU" estaba en la franja vieja: no se pierde.
  // Va chica, bajo la insignia de la derecha (que dice EVALUACION ENERGETICA).
  // Tercera linea de la insignia (dibujada en x = ancho-195; su texto arranca 83 pt mas a la derecha, medido en el render).
  doc.fillColor('#fff').fontSize(7.5).font('Helvetica-Bold')
    .text('ACREDITADA MINVU', ancho - 195 + 83, 57, { lineBreak: false, characterSpacing: 0.4 });
  if (fs.existsSync(RUTA_LOGO_THERMAL_NEGATIVO)) {
    try {
      doc.image(RUTA_LOGO_THERMAL_NEGATIVO, 40, y, { width: ALTO_LOGO_PT * PROPORCION, height: ALTO_LOGO_PT });
      return true;
    } catch (e) { console.error(`[marca] no se pudo dibujar el logo ACTIVA THERMAL: ${e?.message || e}`); }
  }
  if (!fs.existsSync(RUTA_LOGO_THERMAL_NEGATIVO)) console.error(`[marca] falta ${RUTA_LOGO_THERMAL_NEGATIVO}: cabecera en texto`);
  doc.fillColor(gold).fontSize(22).font('Helvetica-Bold').text('ACTIVA', 50, 24, { continued: true })
    .fillColor('#fff').font('Helvetica').text(' THERMAL');
  doc.fillColor('#fff').fontSize(8.5).text('I+D+i · Investigación · Desarrollo · Innovación', 50, 54);
  return false;
}
