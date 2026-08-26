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

/**
 * Las dos caras de profundidad de un PERFIL, no de un cubo.
 *
 * 🔴 [2026-08-26, correccion del dueño] *"¿existira la posibilidad de que los bordes queden
 * un poco menos rectos? parece cubos en vez de perfil"*. Tenia razon: la extrusion recta
 * lee como losa de madera maciza. Un perfil de PVC tiene el canto BISELADO (el borde de
 * atras entra hacia el centro) y un ESCALON a media profundidad (la silueta escalonada del
 * perfil). Las dos señas juntas convierten el cubo en perfil sin cambiar la proyeccion.
 *
 * `bisel` = cuanto entra el borde trasero, en px (fraccion de la fuga).
 */
export function carasPerfil(r, { dx, dy }, bisel = 0) {
  const { x, y, w, h } = r;
  const b = Math.min(bisel, Math.abs(dx) * 0.45, w / 4, h / 4);
  return {
    superior: [[x, y], [x + w, y], [x + w + dx - b, y + dy], [x + dx + b, y + dy]],
    derecha: [[x + w, y], [x + w, y + h], [x + w + dx, y + h + dy - b], [x + w + dx, y + dy + b]],
    // Lineas paralelas al frente a una fraccion `fr` de la profundidad. SOLO se escala el
    // desplazamiento de fuga — nunca el ancho/alto de la cara (el primer intento escalaba el
    // vector completo y una veta al 80% se salia de la caja: lo cazo el test de contencion).
    linea: (fr) => [
      [[x + (dx + b) * fr, y + dy * fr], [x + w + (dx - b) * fr, y + dy * fr]],
      [[x + w + dx * fr, y + (dy + b) * fr], [x + w + dx * fr, y + h + (dy - b) * fr]],
    ],
    escalones: [
      [[x + (dx + b) * 0.55, y + dy * 0.55], [x + w + (dx - b) * 0.55, y + dy * 0.55]],
      [[x + w + dx * 0.55, y + (dy + b) * 0.55], [x + w + dx * 0.55, y + h + (dy - b) * 0.55]],
    ],
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

  // ── 🔭 LA HOJA EXTERIOR SE VE MÁS CHICA, PORQUE ESTÁ MÁS LEJOS ──────────────
  // 🔴 [2026-08-26, correccion del dueño] *"la hoja exterior e interior se ven iguales en la
  // misma cota; si estan en distintos rieles eso es imposible, deberia verse la exterior mas
  // pequeña"*. Tenia razon, y el error era de fondo: esta es una proyeccion PARALELA, y en
  // una proyeccion paralela la profundidad no achica nada — dos objetos a distinta distancia
  // salen identicos. Correcto para un plano tecnico; falso para una foto.
  //
  // Se le agrega la unica perspectiva que importa aca: la hoja del riel EXTERIOR se dibuja
  // levemente mas chica, encogida hacia el centro de la ventana.
  //
  // 📐 DE DONDE SALE EL FACTOR, para que no sea un numero lindo: la hoja exterior esta ~45 mm
  // mas lejos que la interior (el fondo del riel), y una ventana se mira desde ~1,7 m. La
  // reduccion aparente es 1 - 45/1700 ≈ 0,974. La distancia de observacion es un SUPUESTO
  // DECLARADO, no una medicion: es lo que hace ver la ventana como se ve parado frente a ella.
  const ENCOGE_EXTERIOR = 0.974;
  const hojasExt = p.hojas.filter((h) => h.riel === 0);
  if (hojasExt.length) {
    const marcos = p.marcos || [p.marcoRect];
    const cx = marcos.reduce((a, m) => a + m.x + m.w / 2, 0) / marcos.length;
    const cy = marcos.reduce((a, m) => a + m.y + m.h / 2, 0) / marcos.length;
    const encoger = (r) => {
      if (!r) return r;
      return {
        ...r,
        x: cx + (r.x - cx) * ENCOGE_EXTERIOR, y: cy + (r.y - cy) * ENCOGE_EXTERIOR,
        w: r.w * ENCOGE_EXTERIOR, h: r.h * ENCOGE_EXTERIOR,
      };
    };
    for (const h of hojasExt) {
      const antes = { x: h.x, y: h.y, w: h.w, h: h.h };
      Object.assign(h, encoger(antes));
      h.vidrioRect = encoger(h.vidrioRect);
      h.junquilloRect = encoger(h.junquilloRect);
      h.manilla = encoger(h.manilla);
      if (Array.isArray(h.simbolo)) {
        h.simbolo = h.simbolo.map((sg) => ({
          x1: cx + (sg.x1 - cx) * ENCOGE_EXTERIOR, y1: cy + (sg.y1 - cy) * ENCOGE_EXTERIOR,
          x2: cx + (sg.x2 - cx) * ENCOGE_EXTERIOR, y2: cy + (sg.y2 - cy) * ENCOGE_EXTERIOR,
        }));
      }
    }
  }

  // ── 1. Las caras de profundidad, primero: quedan DETRÁS de la cara frontal ──
  // La de arriba recibe la luz (más clara) y la lateral queda en sombra. Es lo único que
  // convierte un rectángulo plano en un volumen.
  const claro = tinte(p.color.f, 1.18);
  const oscuro = tinte(p.color.f, 0.68);
  for (const m of marcos) {
    const c = carasPerfil(m, fuga, fuga.dx * 0.35);
    poligono(doc, c.superior, claro, p.color.e);
    poligono(doc, c.derecha, oscuro, p.color.e);
    // El escalon del perfil — es lo que rompe la lectura de "cubo". En el tono de la VETA si
    // la folia la tiene (roble/nogal/negro, muestras fisicas del dueño 26-ago); si no, un
    // tinte del canto. Sin opacity: no todos los pdfkit (ni el doble de tests) la tienen.
    const tonoEscalon = p.color.veta || tinte(p.color.f, 0.55);
    doc.save().lineWidth(0.3).strokeColor(tonoEscalon);
    for (const [a, b] of c.escalones) doc.moveTo(a[0], a[1]).lineTo(b[0], b[1]).stroke();
    // La VETA del relieve: dos hebras mas por cara, paralelas al escalon, solo si la folia
    // es veteada. Sugerencia sutil — el PDF no puede imprimir textura, pero si insinuarla.
    if (p.color.veta) {
      doc.lineWidth(0.2);
      for (const fr of [0.3, 0.8]) {
        for (const [a, b] of c.linea(fr)) doc.moveTo(a[0], a[1]).lineTo(b[0], b[1]).stroke();
      }
    }
    doc.restore();
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
      //
      // 🔴 [2026-08-25, correccion del dueño] EN UNA CORREDERA HAY DOS RIELES. Textual: *"las
      // estas colocando sobre el mismo riel y eso no es posible para que puedan deslizarse"*.
      // Tenia razon. La hoja del riel de ADELANTE sale mas hacia el observador que la de
      // atras, y esa diferencia de profundidad es justamente lo que hace ver que una pasa por
      // delante de la otra. En una ventana de un solo riel (`riel` null) no cambia nada.
      const salto = hoja.riel === 1 ? 0.5 : 0.28;
      const fugaHoja = { dx: fuga.dx * salto, dy: fuga.dy * salto };
      const c = carasPerfil(hoja, fugaHoja, fugaHoja.dx * 0.4);
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

    // ── FLECHA DE DESLIZAMIENTO (corredera) ────────────────────────────────
    // 🔴 [2026-08-25, correccion del dueño] Faltaban en la vista con volumen: el plano 2D ya
    // las dibujaba y aca se habian quedado afuera. En una corredera son la unica señal de
    // HACIA DONDE corre cada hoja — sin ellas el cliente no sabe por que lado va a abrir.
    // Van sobre el vidrio, que es donde no estorban al perfil ni a la manilla.
    if (hoja.flecha) {
      const v = hoja.vidrioRect;
      const cy = v.y + v.h / 2, cx = v.x + v.w / 2, dir = hoja.flecha;
      const a = Math.min(5, v.w * 0.14);
      if (a > 0.8) {
        doc.polygon(
          [cx - a * dir, cy - 1.8], [cx + a * 0.25 * dir, cy - 1.8], [cx + a * 0.25 * dir, cy - 3.6],
          [cx + a * 1.05 * dir, cy], [cx + a * 0.25 * dir, cy + 3.6], [cx + a * 0.25 * dir, cy + 1.8],
          [cx - a * dir, cy + 1.8],
        ).lineWidth(0.35).fillAndStroke('#FFFFFF', '#1A2332');
      }
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
      const fx = q.x + hacia.dx, fy = q.y + hacia.dy;
      doc.roundedRect(fx, fy, q.w, q.h, radio).lineWidth(0.3).fillAndStroke('#F2F4F7', '#5A6672');
      // [2026-08-26] La PALANCA adentro de la roseta, corrida al extremo por donde se toma
      // — la forma real, segun la foto del dueño. Sin esto parecia un tirador de mueble.
      const horiz = q.w >= q.h;
      const mg = Math.min(q.w, q.h) * 0.26;
      const pl = horiz
        ? { x: fx + q.w * 0.30, y: fy + mg, w: q.w * 0.62, h: Math.max(0.3, q.h - 2 * mg) }
        : { x: fx + mg, y: fy + q.h * 0.30, w: Math.max(0.3, q.w - 2 * mg), h: q.h * 0.62 };
      if (pl.w > 0.4 && pl.h > 0.4) {
        doc.roundedRect(pl.x, pl.y, pl.w, pl.h, Math.min(pl.w, pl.h) / 2)
           .lineWidth(0.28).fillAndStroke('#C8CDD3', '#5A6672');
      }
    }
  }

  doc.fillColor('#6B7B8D').fontSize(6.5).font('Helvetica')
     .text(p.etiqueta, caja.x, caja.y + caja.h - 2, { width: caja.w, align: 'center' });

  doc.restore();
  return p;
}

export default { dibujarVentanaIso, carasDe, vectorFuga };
