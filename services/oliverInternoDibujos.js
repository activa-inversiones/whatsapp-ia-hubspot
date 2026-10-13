// ════════════════════════════════════════════════════════════════════════════
// [2026-10-13 · #1513 B] VISTA PREVIA DE LOS DIBUJOS DEL BORRADOR RETENIDO — SIN FOLIO, SIN ENVIAR.
//
// Pedido del dueño (dos veces el 13-oct): «no podemos revisar las ventanas vistas desde un PDF como
// la cotización antes de liberar al cliente». La propuesta real nace dentro de `generarPdf` del webhook
// (folio ISO + gates + envío + Zoho + informes, todo en un acto): no se puede renderizar sin emitir.
// Decisión del dueño: la B («el B debe armarse») = SOLO los dibujos, con los MISMOS módulos que usa la
// propuesta real (`dibujarVentanaIso`, `medidas`, `COLORES`, `rotulosDeVentanas`), en un PDF aparte:
//   · NO quema folio, NO manda nada, NO escribe en la sesión ni en sales-os. Módulo puro + ruta.
//   · Marca de agua «BORRADOR · no enviado al cliente» en cada hoja: no se puede confundir con la propuesta.
//   · Las líneas entran como las guardó sales-os al retener (`lineas_bot`) y se vuelven items con la
//     MISMA función que la emisión (`itemsDesdeLineasBot`): lo que se ve es lo que se emitiría.
// ════════════════════════════════════════════════════════════════════════════
import PDFDocument from 'pdfkit';
import { itemsDesdeLineasBot } from './oliverInternoLiberar.js';
import { dibujarVentanaIso } from './dibujoIsometrico.js';
import { medidas, claveColor, COLORES } from './dibujoVentana.js';
import { etiquetaVentana, rotulosDeVentanas } from './etiquetaVentana.js';
import { VIDRIO_RESPALDO } from './vidrioCotizado.js';

export const RUTA_DIBUJOS = '/internal/oliver-interno/dibujos';
/** Tope de líneas: el cuadro de sales-os ya corta en 20.000 caracteres; 200 ventanas es más que cualquier obra real. */
export const TOPE_LINEAS = 200;
/** Misma altura de fila que la propuesta (quotePdf.js: «210 px por decisión del dueño, la B»). */
const ROW_H = 210;
const DARK = '#1F2937';
const GRIS = '#6B7B8D';

function marcaDeAgua(doc) {
  doc.save();
  doc.rotate(-32, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.font('Helvetica-Bold').fontSize(54).fillColor('#DC2626').opacity(0.13)
    .text('BORRADOR · NO ENVIADO', 40, doc.page.height / 2 - 30, { width: doc.page.width - 80, align: 'center' });
  doc.restore();
}

function encabezado(doc, { nombre, total }) {
  doc.font('Helvetica-Bold').fontSize(14).fillColor(DARK).text('Vista previa de los dibujos · BORRADOR', 50, 44);
  doc.font('Helvetica').fontSize(9.5).fillColor(GRIS)
    .text(`${nombre ? 'Cliente: ' + nombre + ' · ' : ''}${total} ventana${total === 1 ? '' : 's'} · esto NO es la propuesta: no tiene folio y no se le envió nada al cliente.`, 50, 64, { width: doc.page.width - 100 });
  doc.moveTo(50, 84).lineTo(doc.page.width - 50, 84).lineWidth(0.6).strokeColor('#D1D5DB').stroke();
  return 96;
}

/**
 * PDF (Buffer) con una fila por ventana: dibujo en volumen + rótulo + medidas + color + vidrio + cantidad.
 * Puro: no toca red, sesión ni base. `lineas` = `payload.lineas_bot` del borrador retenido en sales-os.
 */
export async function pdfDibujosBorrador({ lineas, color = '', nombre = '' } = {}) {
  const items = itemsDesdeLineasBot(lineas, color);
  if (!items.length) return { ok: false, error: 'sin_lineas_cotizadas' };
  if (items.length > TOPE_LINEAS) return { ok: false, error: 'demasiadas_lineas', tope: TOPE_LINEAS };
  const rot = rotulosDeVentanas(items);
  const pdf = await new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      let y = encabezado(doc, { nombre: String(nombre || '').trim(), total: items.length });
      items.forEach((it, idx) => {
        if (y + ROW_H > doc.page.height - 60) { doc.addPage(); y = encabezado(doc, { nombre: String(nombre || '').trim(), total: items.length }); }
        doc.rect(50, y, doc.page.width - 100, ROW_H).fill(idx % 2 === 0 ? '#F7F9FC' : '#FFFFFF');
        // El MISMO recuadro que la propuesta real (quotePdf.js): si acá se ve bien, allá se ve igual.
        dibujarVentanaIso(doc, { x: 46, y: y + 6, w: 156, h: ROW_H - 14 }, it);
        const col = COLORES[claveColor(it.color)] || COLORES.blanco;
        const label = it.producto_label || String(it.product || 'Ventana').replace(/_/g, ' ');
        const ms = medidas(it.measures);
        const m2 = ((ms.ancho / 1000) * (ms.alto / 1000)).toFixed(2);
        const COL_X = 212, COL_W = doc.page.width - 100 - 170;
        let yTxt = y + 10;
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11);
        doc.text(`${rot[idx] || etiquetaVentana(it, idx)} · ${label}`, COL_X, yTxt, { width: COL_W, height: 28, ellipsis: true });
        yTxt += Math.min(28, doc.heightOfString(`${rot[idx] || etiquetaVentana(it, idx)} · ${label}`, { width: COL_W })) + 6;
        doc.font('Helvetica').fontSize(10).fillColor(DARK);
        const filas = [
          `Medidas: ${ms.ancho} × ${ms.alto} mm (ancho × alto) · ${m2} m²`,
          `Color: ${col.nombre || it.color || 'BLANCO'}`,
          `Vidrio: ${it.glass_label || VIDRIO_RESPALDO}`,
          `Cantidad: ${Number(it.qty) || 1}`,
        ];
        for (const f of filas) { doc.text(f, COL_X, yTxt, { width: COL_W }); yTxt += 15; }
        if (it.compuesta) { doc.fontSize(8.5).fillColor(GRIS).text('Ventana compuesta: se dibuja con sus partes, como en la propuesta.', COL_X, yTxt, { width: COL_W }); }
        y += ROW_H + 6;
      });
      const n = doc.bufferedPageRange();
      for (let i = n.start; i < n.start + n.count; i += 1) { doc.switchToPage(i); marcaDeAgua(doc); }
      doc.end();
    } catch (e) { reject(e); }
  });
  return { ok: true, pdf, ventanas: items.length };
}

/**
 * La ruta vive acá, no en index.js (como el lector y el liberar). Auth: el mismo token interno que operator-send.
 * Devuelve el PDF (application/pdf) o un JSON de error. Nunca escribe nada.
 */
export function registrarRutaDibujos(app, { validInternalOperatorToken, json = null, generar = pdfDibujosBorrador } = {}) {
  if (typeof validInternalOperatorToken !== 'function') throw new Error('registrarRutaDibujos: falta validInternalOperatorToken');
  const handler = async (req, res) => {
    try {
      if (!validInternalOperatorToken(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
      const lineas = req.body && Array.isArray(req.body.lineas) ? req.body.lineas : null;
      if (!lineas || !lineas.length) return res.status(400).json({ ok: false, error: 'lineas_requeridas' });
      if (lineas.length > TOPE_LINEAS) return res.status(400).json({ ok: false, error: 'demasiadas_lineas', tope: TOPE_LINEAS });
      const campo = (k) => String((req.body && req.body[k]) || '').trim().slice(0, 80);
      const out = await generar({ lineas, color: campo('color'), nombre: campo('nombre') });
      if (!out || out.ok !== true) return res.status(400).json({ ok: false, error: (out && out.error) || 'sin_dibujos', tope: out && out.tope });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="borrador-dibujos.pdf"');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Ventanas', String(out.ventanas || 0));
      return res.status(200).send(out.pdf);
    } catch (e) {
      console.error('[oliver-interno/dibujos] error:', e && e.message ? e.message : e);
      return res.status(500).json({ ok: false, error: 'dibujos_fallo', detalle: String(e && e.message ? e.message : e).slice(0, 200) });
    }
  };
  if (json) app.post(RUTA_DIBUJOS, json, handler); else app.post(RUTA_DIBUJOS, handler);
}

export default { pdfDibujosBorrador, registrarRutaDibujos, RUTA_DIBUJOS, TOPE_LINEAS };
