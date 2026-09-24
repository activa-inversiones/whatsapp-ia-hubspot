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

import { planoDeVentana, pintarTexturaPerfil, manillaFormas, pintarManilla } from './dibujoVentana.js';

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
  const b = Math.min(bisel, Math.abs(dx) * 0.45, Math.abs(dy) * 0.45, w / 4, h / 4);
  // 🔴 [2026-08-26 · Gemini NO-APTO] El bisel insetea el rectangulo trasero EN LOS DOS EJES.
  // El primer intento biselaba cada cara solo en su propio eje (superior en X, derecha en Y)
  // y en la esquina trasera compartida las caras no cerraban: fisura de b·√2 px con el fondo
  // blanco asomando, y el escalon/veta quebrados en la junta (demostrado con numeros por el
  // revisor). Con el inset en ambos ejes, las dos caras terminan en el MISMO vertice
  // (x+w+dx-b, y+dy+b) y toda linea de detalle es continua doblando la esquina.
  const linea = (fr) => [
    [[x + (dx + b) * fr, y + (dy + b) * fr], [x + w + (dx - b) * fr, y + (dy + b) * fr]],
    [[x + w + (dx - b) * fr, y + (dy + b) * fr], [x + w + (dx - b) * fr, y + h + (dy - b) * fr]],
  ];
  return {
    superior: [[x, y], [x + w, y], [x + w + dx - b, y + dy + b], [x + dx + b, y + dy + b]],
    derecha: [[x + w, y], [x + w, y + h], [x + w + dx - b, y + h + dy - b], [x + w + dx - b, y + dy + b]],
    // Lineas paralelas al frente a una fraccion `fr` de la profundidad: el corte a esa altura
    // es el rectangulo del frente corrido fuga·fr e inseteado bisel·fr — SOLO se escalan los
    // desplazamientos, nunca el ancho/alto (el primer intento escalaba el vector completo y
    // una veta al 80% se salia de la caja: lo cazo el test de contencion).
    linea,
    escalones: linea(0.55),
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

/**
 * Las DIAGONALES DE 45 GRADOS de las esquinas: la union soldada del perfil.
 *
 * 🔴 [2026-09-11, correccion del dueño] Nuestro dibujo no las tenia. Comparando nuestra imagen
 * con su plano de WinPerfil dijo, textual: *"NI SE PARECE"*. Es lo primero que salta a la vista:
 * en cualquier plano de una ventana de PVC el marco y la hoja muestran la diagonal en las cuatro
 * esquinas, porque los perfiles se cortan a 45 y se sueldan. Nuestros marcos eran rectangulos
 * lisos, sin una sola diagonal, y por eso se leian como una caja y no como una ventana.
 * @param {{x:number,y:number,w:number,h:number}} r rectangulo EXTERIOR del perfil
 * @param {number} g grueso del frente: la diagonal va de la esquina exterior a la interior
 */
// 🔴 [2026-09-24 · #883] `solo` limita el inglete a las esquinas del CONTORNO EXTERIOR.
// Lo pidió el dueño mirando el render de la ventana en esquina: *"esta tiene como cortados los
// perfiles en la parte superior"*. La causa: dos marcos pegados dibujaban CADA UNO su inglete
// en la esquina que comparten, y las dos diagonales se cruzaban formando un pico — se lee como
// un perfil cortado. En la ventana real esa junta no es una esquina de marco: es el montante
// donde va el poste, y ahí el perfil sigue derecho.
// `solo` es {ni,nd,si,sd} (norte-izq, norte-der, sur-izq, sur-der). Sin él se dibujan las
// cuatro, que es como se comportaba antes: ninguna ventana ya dibujada se mueve.
function esquinasEnIngle(doc, r, g, color, solo = null) {
  const gx = Math.min(g, r.w / 2), gy = Math.min(g, r.h / 2);
  if (!(gx > 0.4 && gy > 0.4)) return;   // a esta escala la diagonal no se leeria
  const x2 = r.x + r.w, y2 = r.y + r.h;
  const va = (k) => !solo || solo[k];
  doc.save().lineWidth(0.3).strokeColor(color);
  if (va('ni')) doc.moveTo(r.x, r.y).lineTo(r.x + gx, r.y + gy).stroke();
  if (va('nd')) doc.moveTo(x2, r.y).lineTo(x2 - gx, r.y + gy).stroke();
  if (va('si')) doc.moveTo(r.x, y2).lineTo(r.x + gx, y2 - gy).stroke();
  if (va('sd')) doc.moveTo(x2, y2).lineTo(x2 - gx, y2 - gy).stroke();
  doc.restore();
}
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
  // 🔴 [2026-09-18] ESTO SOLO SABIA DE DOS PROFUNDIDADES, y el triple riel tiene TRES. Reclamo
  // del dueño mirando la propuesta renderizada, textual: *"te quedo como 2 rieles, las hojas se
  // desplazan sobre rieles diferentes"*. Antes se encogia SOLO el riel 0 y todo lo demas quedaba
  // en el mismo plano: con tres hojas, dos de ellas se veian pegadas a la misma profundidad.
  // Ahora el encogido es por ESCALON de riel: cada via mas exterior encoge una vez mas. Con dos
  // rieles da exactamente lo de antes (riel 0 → 0,974 · riel 1 → 1), asi que ninguna ventana ya
  // dibujada se mueve; con tres da 0,974² · 0,974 · 1.
  const ENCOGE_EXTERIOR = 0.974;
  const rielMax = p.hojas.reduce((a, h) => Math.max(a, Number(h.riel) || 0), 0);
  const hojasExt = p.hojas.filter((h) => Number(h.riel) >= 0 && Number(h.riel) < rielMax);
  if (hojasExt.length) {
    const marcos = p.marcos || [p.marcoRect];
    const cx = marcos.reduce((a, m) => a + m.x + m.w / 2, 0) / marcos.length;
    const cy = marcos.reduce((a, m) => a + m.y + m.h / 2, 0) / marcos.length;
    // `k` = cuantos escalones de riel hacia afuera esta esta hoja. Con dos rieles siempre es 1
    // (lo de antes); con tres, la mas exterior es 2.
    const encoger = (r, f) => {
      if (!r) return r;
      return {
        ...r,
        x: cx + (r.x - cx) * f, y: cy + (r.y - cy) * f,
        w: r.w * f, h: r.h * f,
      };
    };
    for (const h of hojasExt) {
      const f = ENCOGE_EXTERIOR ** (rielMax - (Number(h.riel) || 0));
      const antes = { x: h.x, y: h.y, w: h.w, h: h.h };
      Object.assign(h, encoger(antes, f));
      h.vidrioRect = encoger(h.vidrioRect, f);
      h.junquilloRect = encoger(h.junquilloRect, f);
      h.manilla = encoger(h.manilla, f);
      if (Array.isArray(h.simbolo)) {
        h.simbolo = h.simbolo.map((sg) => ({
          x1: cx + (sg.x1 - cx) * f, y1: cy + (sg.y1 - cy) * f,
          x2: cx + (sg.x2 - cx) * f, y2: cy + (sg.y2 - cy) * f,
        }));
      }
    }
  }

  // ── 1. Las caras de profundidad, primero: quedan DETRÁS de la cara frontal ──
  // La de arriba recibe la luz (más clara) y la lateral queda en sombra. Es lo único que
  // convierte un rectángulo plano en un volumen.
  const claro = tinte(p.color.f, 1.18);
  const oscuro = tinte(p.color.f, 0.68);
  // 🔴 [2026-09-24 · #883] EN LA VENTANA EN ESQUINA LA PROFUNDIDAD SE DIBUJA UNA SOLA VEZ,
  // sobre el contorno del conjunto, no paño por paño.
  // Lo cazó el dueño mirando el render, textual: *"esta tiene como cortados los perfiles en la
  // parte superior ... la parte de abajo esta bien"*. Y el detalle de que ABAJO estuviera bien
  // es el que explica la causa: la fuga va hacia ARRIBA y a la derecha, así que las caras
  // superiores son las únicas que se pisan. Cada paño dibujaba SU parábola de profundidad y,
  // como los paños están pegados, la diagonal del que termina cruzaba con la del que empieza:
  // quedaba una muesca en V, que se lee como un perfil cortado.
  // En la ventana real el cabezal de los paños unidos es coplanar y CONTINUO — se lee como una
  // sola banda. Por eso el contorno del conjunto es más fiel que la suma de las partes.
  // ⚠️ Solo para ESQUINA: una compuesta lleva su acople de 2 mm a la vista a propósito (regla
  // del dueño, 25-ago: *"quedaron unidas y deben ser como separadas, ahí va la unión mini"*),
  // así que ahí las caras siguen siendo una por paño y nada se mueve.
  const marcosFondo = (p.tipo === 'ESQUINA' && marcos.length > 1)
    ? [{
      x: Math.min(...marcos.map((m) => m.x)),
      y: Math.min(...marcos.map((m) => m.y)),
      w: Math.max(...marcos.map((m) => m.x + m.w)) - Math.min(...marcos.map((m) => m.x)),
      h: Math.max(...marcos.map((m) => m.y + m.h)) - Math.min(...marcos.map((m) => m.y)),
      marco: marcos[0].marco,
    }]
    : marcos;
  for (const m of marcosFondo) {
    const c = carasPerfil(m, fuga, fuga.dx * 0.35);
    poligono(doc, c.superior, claro, p.color.e);
    poligono(doc, c.derecha, oscuro, p.color.e);
    // El escalon del perfil — es lo que rompe la lectura de "cubo". En el tono de la VETA si
    // la folia la tiene (roble/nogal/negro, muestras fisicas del dueño 26-ago); si no, un
    // tinte del canto. Sin opacity: no todos los pdfkit (ni el doble de tests) la tienen.
    const tonoEscalon = p.color.veta || tinte(p.color.f, 0.55);
    doc.save().lineWidth(0.3).strokeColor(tonoEscalon);
    for (const [a, b] of c.escalones) doc.moveTo(a[0], a[1]).lineTo(b[0], b[1]).stroke();
    // La TEXTURA del relieve en el canto, segun la folia (muestrario fisico, 26-ago):
    // madera = hebras largas paralelas al escalon; grano = motas cortas sobre las mismas
    // guias (el gofrado del grafito y el destello del negro); liso = nada mas que el escalon.
    if (p.color.veta && p.color.textura !== 'grano') {
      doc.lineWidth(0.2);
      for (const fr of [0.3, 0.8]) {
        for (const [a, b] of c.linea(fr)) doc.moveTo(a[0], a[1]).lineTo(b[0], b[1]).stroke();
      }
    } else if (p.color.veta && p.color.textura === 'grano') {
      // Motas deterministas: se caminan las guias de profundidad y se pinta un punto corto
      // cada tanto, alternando la veta oscura y un tinte claro (el destello).
      let sem = (Math.abs(Math.round(m.x * 7 + m.y * 13 + m.w * 31 + m.h * 57)) % 2147483645) + 1;
      const rnd = () => (sem = (sem * 48271) % 2147483647) / 2147483647;
      for (const fr of [0.25, 0.5, 0.75]) {
        for (const [a, b] of c.linea(fr)) {
          const pasos = Math.max(3, Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
          for (let i = 0; i < pasos; i++) {
            if (rnd() < 0.45) continue;                    // grano salteado, no una linea punteada
            const t0 = (i + rnd() * 0.6) / pasos;
            const px = a[0] + (b[0] - a[0]) * t0, py = a[1] + (b[1] - a[1]) * t0;
            doc.lineWidth(0.25).strokeColor(rnd() < 0.4 ? tinte(p.color.f, p.color.brillo || 1.3) : p.color.veta);
            doc.moveTo(px, py).lineTo(px + 0.5, py + 0.4).stroke();
          }
        }
      }
    }
    doc.restore();
  }

  // ── 2. La cara frontal: el mismo plano de siempre ──
  // [#883] En la esquina, una celda solo lleva inglete donde toca el borde EXTERIOR del
  // conjunto. Se compara contra el contorno con una tolerancia de 1 px, que es la junta con
  // que se dibujan los paños pegados.
  const _ext = (p.tipo === 'ESQUINA' && marcos.length > 1) ? {
    x: Math.min(...marcos.map((m) => m.x)), y: Math.min(...marcos.map((m) => m.y)),
    x2: Math.max(...marcos.map((m) => m.x + m.w)), y2: Math.max(...marcos.map((m) => m.y + m.h)),
  } : null;
  const soloExterior = (m) => {
    if (!_ext) return null;
    const T = 1.2;
    const izq = Math.abs(m.x - _ext.x) <= T, der = Math.abs(m.x + m.w - _ext.x2) <= T;
    const arr = Math.abs(m.y - _ext.y) <= T, aba = Math.abs(m.y + m.h - _ext.y2) <= T;
    return { ni: izq && arr, nd: der && arr, si: izq && aba, sd: der && aba };
  };
  for (const m of marcos) {
    doc.rect(m.x, m.y, m.w, m.h).lineWidth(0.6).fillAndStroke(p.color.f, p.color.e);
    // La folia de la cara frontal: misma textura y brillo que el plano 2D (muestrario 26-ago).
    pintarTexturaPerfil(doc, m, Math.min(m.marco || p.marco, m.w / 2, m.h / 2), p.color);
    esquinasEnIngle(doc, m, m.marco || p.marco, p.color.e, soloExterior(m));
  }

  for (const hoja of p.hojas) {
    if (hoja.sinBastidor) {
      // 🔴 [2026-09-11, correccion del dueño] EN LA PARTE FIJA NO HAY HOJA. Textual:
      // *"EN LA PARTE FIJA NO HAY HOJA ES SOLO EL MARCO CON TERMOPANEL"*.
      // Aca se trazaba igual el rectangulo de la hoja y el paño fijo quedaba con UNA LINEA DE
      // MAS, que lo hacia parecer una segunda hoja que tambien abre. El plano 2D ya tenia escrito
      // que ese contorno NO existe ("sinBastidor le dice al pintado que NO trace el rectangulo de
      // la hoja"), pero este pintor —el de VOLUMEN, el que sale en la propuesta— nunca lo cumplio.
      // El fijo es marco + junquillo + termopanel, nada mas. El junquillo se dibuja mas abajo.
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
      const gB = ((hoja.junquilloRect || hoja.vidrioRect || {}).x ?? hoja.x) - hoja.x;
      pintarTexturaPerfil(doc, hoja, gB, p.color);
      esquinasEnIngle(doc, hoja, gB, p.color.e);
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
      // 🔩 [2026-08-26, "una manilla mas real"] En una manilla REAL solo el CUELLO toca la
      // hoja: la palanca queda en VOLADIZO. La caja extruida anterior (roseta doble + caras
      // laterales completas) parecia un boton gigante. Ahora: (1) la SOMBRA de la silueta
      // sobre la hoja, en el tono del perfil; (2) el cuello cilindrico que conecta; (3) la
      // manilla realista (roseta+cuello+palanca con su brillo) elevada hacia el observador.
      const q = hoja.manilla;
      const saliente = Math.max(1, fuga.dx * 0.5);
      const hacia = { dx: -saliente, dy: saliente };
      const f = manillaFormas(q);
      if (f) {
        const sombra = tinte(p.color.f, 0.52);
        const R = (r, ddx, ddy) => doc.roundedRect(r.x + ddx, r.y + ddy, r.w, r.h, Math.min(r.r, r.w / 2, r.h / 2));
        // 1. La sombra que la palanca tira sobre la hoja (corrida al reves del realce).
        R(f.palanca, saliente * 0.35, saliente * 0.35).lineWidth(0).fill(sombra);
        R(f.roseta, saliente * 0.2, saliente * 0.2).lineWidth(0).fill(sombra);
        // 2. El cuello: el unico contacto real con la hoja — un lateral corto lo conecta.
        const c = carasHacia(f.cuello, hacia);
        poligono(doc, c.lateral, '#8F979F', '#5A6672');
        poligono(doc, c.horizontal, '#7A8188', '#5A6672');
        // 3. La manilla entera, elevada.
        pintarManilla(doc, f, hacia.dx, hacia.dy);
      } else {
        // Sin lugar para el detalle: el realce simple anterior.
        const radio = Math.min(q.w, q.h) / 2;
        doc.roundedRect(q.x, q.y, q.w, q.h, radio).lineWidth(0.3).fillAndStroke('#C8CDD3', '#5A6672');
        const c = carasHacia(q, hacia);
        poligono(doc, c.lateral, '#AEB5BC', '#5A6672');
        poligono(doc, c.horizontal, '#8F979F', '#5A6672');
        doc.roundedRect(q.x + hacia.dx, q.y + hacia.dy, q.w, q.h, radio)
           .lineWidth(0.3).fillAndStroke('#F2F4F7', '#5A6672');
      }
    }
  }

  // 🔴 [2026-09-18, correccion del dueño] LA HOJA FIJADA SE ROTULA "FIJA", ESCRITO.
  // Textual: *"y diga fija escrita, asi se ve como encima solamente"*. Sin la palabra, la unica
  // pista de que esa hoja no se abre es que le falta la flecha — y eso el cliente no lo lee.
  // Va sobre el vidrio de esa hoja, que a esta altura ya tiene las coordenadas finales (si esta
  // en el riel exterior, el encogido de perspectiva de mas arriba ya la movio).
  const fijada = p.hojas.find((h) => h.fijaEnSitio && h.vidrioRect);
  if (fijada) {
    const v = fijada.vidrioRect;
    const alto = 7;
    if (v.w > 16 && v.h > alto) {
      doc.fillColor('#5A6672').fontSize(6).font('Helvetica-Bold')
         .text('FIJA', v.x, v.y + v.h / 2 - alto / 2, { width: v.w, align: 'center' });
    }
  }

  // [2026-09-18] LA COTA DEL VIDRIO, debajo de la de la ventana. Pedido del dueño: *"a seria
  // prudente para que cliente asocie eso"*. El informe de resistencia al viento habla del PAÑO,
  // no de la ventana; sin este numero en la figura el cliente no puede atar las dos cosas.
  // Solo sale si el motor la calculo: una medida de vidrio inventada en un plano es peor que
  // ninguna. Si no cabe debajo, se omite antes que pisar el borde de la caja.
  const hayVidrio = Boolean(p.etiquetaVidrio);
  const yEtiqueta = caja.y + caja.h - (hayVidrio ? 10 : 2);
  doc.fillColor('#6B7B8D').fontSize(6.5).font('Helvetica')
     .text(p.etiqueta, caja.x, yEtiqueta, { width: caja.w, align: 'center' });
  if (hayVidrio) {
    doc.fillColor('#8A96A6').fontSize(5.8).font('Helvetica')
       .text(p.etiquetaVidrio, caja.x, yEtiqueta + 8, { width: caja.w, align: 'center' });
  }

  doc.restore();
  return p;
}

export default { dibujarVentanaIso, carasDe, vectorFuga };
