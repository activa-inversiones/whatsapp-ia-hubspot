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

/**
 * Fondo del perfil, por SERIE, en mm.
 *
 * 🔴 [Gemini, compuerta] Estaba fijo en 60 para todo. Una corredera NO tiene el mismo fondo
 * que una ventana S60, asi que el volumen que veia el cliente no era el de su ventana.
 *
 * ⚠️ SOLO ENTRA ACA LO MEDIDO. El 60 de S60 sale del modelo real de Winart (`ps.sc = 60`,
 * version 66979). Las correderas todavia no se midieron: hasta que se saque el dato de una
 * version de Winart de esa linea, caen al fondo por defecto y el dibujo puede quedar corto o
 * largo en la profundidad. Inventar un numero seria peor: quedaria como medido para siempre.
 */
const FONDO_POR_SERIE = { S60: 60 };
const FONDO_MM = 60;

/** El fondo que corresponde al item; sin serie reconocida, el de la S60. */
export function fondoDe(it) {
  const serie = String(it?.serie || it?.linea || '').trim().toUpperCase();
  return FONDO_POR_SERIE[serie] || FONDO_MM;
}
/** En proyección "cabinet" la profundidad se dibuja a la mitad para que no se vea deformada. */
const FACTOR_FUGA = 0.5;

/**
 * Aclara u oscurece un color #RRGGBB. f > 1 aclara, f < 1 oscurece.
 *
 * 🔴 [Gemini, compuerta] Ante un color que no sea hex devolvia el valor tal cual, y pdfkit
 * revienta con eso ("blanco" no es un color). Hoy no es alcanzable — los colores salen de la
 * tabla COLORES, que son todos hex — pero un PDF que no se genera es una cotizacion que no
 * sale, y el seguro cuesta una linea.
 */
const GRIS_SEGURO = '#9AA0A6';
function tinte(hex, f) {
  const m = String(hex || '').match(/^#?([0-9a-f]{6})$/i);
  if (!m) return GRIS_SEGURO;
  const n = parseInt(m[1], 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * El vector de fuga: hacia dónde y cuánto se va la profundidad.
 * Arriba y a la derecha, que es como se mira una ventana desde adentro de la pieza.
 */
export function vectorFuga(escala, fondo_mm = FONDO_MM) {
  const f = Number(fondo_mm);
  const d = Math.max(2, (Number.isFinite(f) && f > 0 ? f : FONDO_MM) * escala * FACTOR_FUGA);
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

/**
 * Las dos caras visibles de un prisma que se va en CUALQUIER direccion.
 *
 * `carasDe` sirve para el marco, que siempre fuga hacia atras (arriba-derecha). La manilla va
 * al reves: SOBRESALE hacia quien mira, o sea abajo-izquierda. Con una fuga asi, las caras
 * que se ven son la de abajo y la izquierda — las contrarias a las del marco. Esta funcion
 * elige el par correcto segun el signo del vector, en vez de duplicar la logica invertida.
 */
export function carasHacia(r, { dx, dy }) {
  const { x, y, w, h } = r;
  const lateral = dx >= 0
    ? [[x + w, y], [x + w, y + h], [x + w + dx, y + h + dy], [x + w + dx, y + dy]]
    : [[x, y], [x, y + h], [x + dx, y + h + dy], [x + dx, y + dy]];
  const horizontal = dy <= 0
    ? [[x, y], [x + w, y], [x + w + dx, y + dy], [x + dx, y + dy]]
    : [[x, y + h], [x + w, y + h], [x + w + dx, y + h + dy], [x + dx, y + h + dy]];
  return { lateral, horizontal };
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
  // NO se reserva lugar para el saliente de la manilla, y esta medido: la manilla vive
  // pegada al vidrio, que ya esta metido hacia adentro el ancho del marco MAS el de la hoja
  // (98 mm entre los dos) — muchisimo mas de lo que sobresale. En la ventana mas chica que
  // dibujamos le sobran 15 px de margen contra el borde. Se habia agregado una reserva "por
  // las dudas"; el test de mutacion mostro que sacarla no rompe nada, asi que no va: codigo
  // defensivo que ningun caso justifica es codigo que despues nadie se atreve a tocar.
  const p = planoDeVentana(it, {
    x: caja.x, y: caja.y + reserva,
    w: Math.max(20, caja.w - reserva), h: Math.max(20, caja.h - reserva),
  });
  const fuga = vectorFuga(p.escala, fondoDe(it));
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

    // ── MANILLA EN RELIEVE ─────────────────────────────────────────────────
    // Es la unica pieza que SALE hacia afuera del plano de la ventana; todo lo demas se va
    // hacia atras. Dibujarla plana sobre un dibujo con volumen la hacia ver pegada.
    //
    // ⚠️ EL SALIENTE NO ESTA MEDIDO: es un realce visual, proporcional al fondo del perfil.
    // No sale de Winart y no se usa para nada que se fabrique ni se cobre. Si algun dia hace
    // falta la medida real de la manilla, se saca del modelo — no de aca.
    if (hoja.manilla) {
      const q = hoja.manilla;
      const saliente = Math.max(1, fuga.dx * 0.5);
      const hacia = { dx: -saliente, dy: saliente };
      const radio = Math.min(q.w, q.h) / 2;

      // La roseta: la base que queda apoyada contra la hoja.
      doc.roundedRect(q.x, q.y, q.w, q.h, radio).lineWidth(0.3).fillAndStroke('#C8CDD3', '#5A6672');
      // El cuerpo que sale hacia el que mira, con su cara iluminada y su sombra.
      const c = carasHacia(q, hacia);
      poligono(doc, c.lateral, '#AEB5BC', '#5A6672');
      poligono(doc, c.horizontal, '#8F979F', '#5A6672');
      // Y la cara de agarre, la mas clara: es la que recibe la luz de frente.
      doc.roundedRect(q.x + hacia.dx, q.y + hacia.dy, q.w, q.h, radio)
         .lineWidth(0.3).fillAndStroke('#F2F4F7', '#5A6672');
    }
  }

  doc.fillColor('#6B7B8D').fontSize(6.5).font('Helvetica')
     .text(p.etiqueta, caja.x, caja.y + caja.h - 2, { width: caja.w, align: 'center' });

  doc.restore();
  return p;
}

export default { dibujarVentanaIso, carasDe, vectorFuga };
