// dibujoIsometrico.js — [2026-08-25]
//
// 🧊 LA MISMA VENTANA, CON PROFUNDIDAD. Vista oblicua (tipo "cabinet") del plano que ya
// calcula `planoDeVentana`: no hay geometría nueva ni un motor 3D detrás — se toma cada
// rectángulo del plano y se le agrega el espesor real del perfil hacia atrás.
//
// POR QUÉ ASÍ, y no un 3D de verdad (decisión del dueño, 25-ago): un 3D obliga a modelar el
// despiece del perfil, que es exactamente lo que tiene trabado el módulo MES hace meses. Esta
// vista da el 90% del efecto comercial con el 2% del trabajo, y se alimenta del MISMO dato que
// el plano: si mañana cambia un grueso, cambian las dos.
//
// ⚠️ ES UNA VISTA COMERCIAL, NO UN PLANO DE FABRICACIÓN. No lleva cotas a propósito: una cota
// sobre una cara en perspectiva se lee mal y se mide peor. Las medidas viven en el plano 2D.
//
// PROYECCIÓN: oblicua a 45°, con la profundidad reducida a la mitad (`FACTOR_FUGA`). Es la
// convención de dibujo técnico "cabinet" — la cara de frente queda a escala real y sin
// deformar, que es lo que el cliente necesita para reconocer su ventana.

import { planoDeVentana } from './dibujoVentana.js';

/** Profundidad del perfil S60: 60 mm de fondo. Es la serie que fabrica ACTIVA. */
const FONDO_MM = 60;
/** En proyección "cabinet" la profundidad se dibuja a la mitad para que no se vea deformada. */
const FACTOR_FUGA = 0.5;

/** Aclara u oscurece un color #RRGGBB. f > 1 aclara, f < 1 oscurece. */
function tinte(hex, f) {
  const m = String(hex || '').match(/^#?([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * El vector de fuga: hacia dónde y cuánto se va la profundidad.
 * Arriba y a la derecha, que es como se mira una ventana desde adentro de la pieza.
 */
export function vectorFuga(escala) {
  const d = Math.max(2, FONDO_MM * escala * FACTOR_FUGA);
  return { dx: d, dy: -d };
}

/**
 * Las dos caras laterales de un rectángulo extruido: la de ARRIBA y la de la DERECHA.
 * Devuelve polígonos (arrays de [x, y]) listos para pintar.
 *
 * Solo esas dos: con la fuga hacia arriba-derecha, las otras dos quedan escondidas detrás de
 * la cara frontal. Dibujarlas sería tinta que nadie ve.
 */
export function carasDe(r, { dx, dy }) {
  const { x, y, w, h } = r;
  return {
    superior: [[x, y], [x + w, y], [x + w + dx, y + dy], [x + dx, y + dy]],
    derecha: [[x + w, y], [x + w, y + h], [x + w + dx, y + h + dy], [x + w + dx, y + dy]],
  };
}

function poligono(doc, pts, relleno, borde) {
  doc.polygon(...pts).lineWidth(0.35).fillAndStroke(relleno, borde);
}

/**
 * Dibuja la ventana en vista isométrica dentro de la caja dada.
 *
 * @param {object} doc   documento pdfkit
 * @param {{x,y,w,h}} caja
 * @param {object} it    el mismo item que recibe el plano 2D
 * @returns {object} el plano usado (para tests y para reusar sus datos)
 */
export function dibujarVentanaIso(doc, caja, it) {
  // La fuga se come espacio arriba y a la derecha: se reserva ANTES de encajar la ventana,
  // si no la profundidad se sale de la caja y pisa lo que esté al lado.
  const reserva = Math.max(6, Math.min(caja.w, caja.h) * 0.16);
  const p = planoDeVentana(it, {
    x: caja.x, y: caja.y + reserva,
    w: Math.max(20, caja.w - reserva), h: Math.max(20, caja.h - reserva),
  });
  const fuga = vectorFuga(p.escala);
  const marcos = p.marcos || [p.marcoRect];

  doc.save();

  // ── 1. Las caras de profundidad, primero: quedan DETRÁS de la cara frontal ──
  // La de arriba recibe la luz (más clara) y la lateral queda en sombra. Es lo único que
  // convierte un rectángulo plano en un volumen.
  const claro = tinte(p.color.f, 1.18);
  const oscuro = tinte(p.color.f, 0.68);
  for (const m of marcos) {
    const c = carasDe(m, fuga);
    poligono(doc, c.superior, claro, p.color.e);
    poligono(doc, c.derecha, oscuro, p.color.e);
  }

  // ── 2. La cara frontal: el mismo plano de siempre ──
  for (const m of marcos) {
    doc.rect(m.x, m.y, m.w, m.h).lineWidth(0.6).fillAndStroke(p.color.f, p.color.e);
  }

  for (const hoja of p.hojas) {
    if (hoja.sinBastidor) {
      doc.rect(hoja.x, hoja.y, hoja.w, hoja.h).lineWidth(0.4).stroke(p.color.e);
    } else {
      // La hoja SOBRESALE del marco hacia el que mira: por eso lleva su propia sombra.
      const c = carasDe(hoja, { dx: fuga.dx * 0.28, dy: fuga.dy * 0.28 });
      poligono(doc, c.superior, claro, p.color.e);
      poligono(doc, c.derecha, oscuro, p.color.e);
      doc.rect(hoja.x, hoja.y, hoja.w, hoja.h).lineWidth(0.45).fillAndStroke(p.color.f, p.color.e);
    }

    const j = hoja.junquilloRect;
    if (j && j.w > 0 && j.h > 0) doc.rect(j.x, j.y, j.w, j.h).lineWidth(0.3).stroke(p.color.e);

    const v = hoja.vidrioRect;
    if (v.w > 0 && v.h > 0) {
      doc.rect(v.x, v.y, v.w, v.h).lineWidth(0.35).fillAndStroke(p.vidrio, p.color.e);
      // Reflejo: dos franjas diagonales, que es como se lee un vidrio en un render. Van
      // RECORTADAS al vidrio (`clip`) para que no se derramen sobre el marco.
      doc.save();
      doc.rect(v.x, v.y, v.w, v.h).clip();
      doc.fillOpacity(0.5).fillColor('#FFFFFF');
      const a = v.w * 0.42;
      doc.polygon([v.x - a, v.y + v.h], [v.x + a * 0.15, v.y], [v.x + a * 0.75, v.y], [v.x - a + a * 0.6, v.y + v.h]).fill();
      doc.fillOpacity(0.28);
      doc.polygon([v.x + a * 0.95, v.y], [v.x + a * 1.25, v.y], [v.x + a * 0.3, v.y + v.h], [v.x, v.y + v.h]).fill();
      doc.restore();
    }

    if (hoja.simbolo && hoja.simbolo.length) {
      doc.save().lineWidth(0.4).dash(1.6, { space: 1.4 }).strokeColor('#6B7B8D');
      for (const sg of hoja.simbolo) doc.moveTo(sg.x1, sg.y1).lineTo(sg.x2, sg.y2).stroke();
      doc.undash().restore();
    }

    if (hoja.manilla) {
      const q = hoja.manilla;
      doc.roundedRect(q.x, q.y, q.w, q.h, Math.min(q.w, q.h) / 2)
         .lineWidth(0.3).fillAndStroke('#F2F4F7', '#5A6672');
    }
  }

  doc.fillColor('#6B7B8D').fontSize(6.5).font('Helvetica')
     .text(p.etiqueta, caja.x, caja.y + caja.h - 2, { width: caja.w, align: 'center' });

  doc.restore();
  return p;
}

export default { dibujarVentanaIso, carasDe, vectorFuga };
