// listaVentanas.js — [2026-09-18]
//
// 🔴 CUANDO EL CLIENTE MANDA UNA LISTA, SE LE DEVOLVIA TODO PEGADO Y SE ENREDABA.
//
// Reclamo del dueno (18-sep, textual): *"los clientes si entregan una lista, la lista debe
// estar ordenada por columnas indicando posicion de ventana, nombre del lugar si es que lo
// tiene, ancho, alto y cantidad y modelo de ventana a cotizar, una sola en fila, porque
// cuando las envias todas juntas el cliente se enreda y esta toda la informacion pegada"*.
//
// El caso que lo destapo: la foto del cuaderno de Mario Grey, 17 ventanas. Lo que salia era
// un solo parrafo corrido — "N°1 | corredera | 2,71 x 1,99,5 | cant 1 | Blanco N°2 | corredera
// | 1,80 x 1,97 | cant 1 | Blanco N°3 | ..." — imposible de revisar una por una. Y revisarlas
// una por una es EXACTAMENTE lo que le estamos pidiendo al cliente que haga (Regla #32:
// confirmar las medidas antes de cotizar). Si no puede leerlas, no las puede confirmar, y
// confirma a ciegas: es el mismo problema de fondo que el de aprobar todo lo que se le pasa.
//
// ⚠️ SIN BACKTICKS NI BLOQUES MONOESPACIADOS. WhatsApp los usa como markup y un backtick
// desbalanceado rompe el formato de TODO el mensaje (ya anotado en avisoEntregaDudosa.js).
// Una fila por linea con separadores visibles se lee igual de bien y no puede romperse.

const EMDASH = '\u2014';

/** Medida en mm, sin decimales de mas: 2710 -> "2710". Si no hay dato, raya. */
function mm(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return EMDASH;
  return String(Math.round(n));
}

/** Un texto corto y limpio, o raya si no hay nada util. */
function txt(v) {
  const s = String(v ?? '').trim();
  if (!s) return EMDASH;
  // "NO ESPECIFICADO" es lo que escribe la vision cuando el dato no esta en la foto:
  // para el cliente eso es ruido, no informacion. Se muestra como raya.
  if (/^no\s+especificad[oa]$/i.test(s)) return EMDASH;
  return s.replace(/\s+/g, ' ').slice(0, 40);
}

/**
 * Una ventana por fila, en el orden de columnas que pidio el dueno:
 *   posicion - lugar - ancho x alto - cantidad - modelo
 *
 * `items` son los items de cotizacion tal como ya circulan en el bot. Se leen varios
 * nombres por campo porque segun el camino (vision, tool del LLM, pending_quote) el mismo
 * dato llega con distinto nombre — el mismo motivo por el que enginePricer mira varios
 * campos para el tipo. Devuelve "" si no hay nada que listar, para que quien llama no tenga
 * que preguntarse si mandar un encabezado vacio.
 */
export function formatListaVentanas(items, { encabezado = true } = {}) {
  const arr = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!arr.length) return '';

  const filas = arr.map((it, i) => {
    // POSICION: la que trae el cliente en su lista (V1, N°3) manda sobre el correlativo
    // nuestro. Si el cliente numero sus ventanas, ese numero es el que el conoce.
    const pos = txt(it.posicion ?? it.id_ventana ?? it.codigo ?? it.ref);
    const posicion = pos === EMDASH ? String(i + 1) : pos;
    const lugar = txt(it.lugar ?? it.ambiente ?? it.recinto ?? it.ubicacion);
    const { ancho_mm, alto_mm } = medidasDe(it);
    const cant = Math.max(1, Number(it.qty ?? it.cantidad) || 1);
    const modelo = txt(it.modelo ?? it.producto_label ?? it.product ?? it.producto ?? it.tipo);
    return `${posicion} \u00b7 ${lugar} \u00b7 ${mm(ancho_mm)} \u00d7 ${mm(alto_mm)} mm \u00b7 ${cant} un \u00b7 ${modelo}`;
  });

  if (!encabezado) return filas.join('\n');
  const n = arr.length;
  const titulo = n === 1
    ? 'Le anot\u00e9 1 ventana. Rev\u00edsela por favor:'
    : `Le anot\u00e9 ${n} ventanas. Rev\u00edselas una por una, por favor:`;
  // La leyenda va DESPUES de las filas: arriba estorba, y lo que el cliente busca es su lista.
  return `${titulo}\n\n${filas.join('\n')}\n\nN\u00b0 \u00b7 lugar \u00b7 ancho \u00d7 alto \u00b7 cantidad \u00b7 modelo`;
}

/**
 * Las medidas, vengan como vengan: {ancho_mm, alto_mm}, {ancho, alto} o el string
 * "2710x1995mm" que usa `measures` en los items del bot.
 * ⚠️ NO convierte unidades ni adivina: si el numero no se entiende, devuelve null y la fila
 * sale con una raya. Inventar una medida en una lista que el cliente va a confirmar es peor
 * que dejarla vacia — la confirmaria sin mirar.
 */
export function medidasDe(it) {
  const num = (v) => {
    const n = Number(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  let a = num(it?.ancho_mm ?? it?.ancho ?? it?.width_mm);
  let b = num(it?.alto_mm ?? it?.alto ?? it?.height_mm);
  if (!a || !b) {
    const m = String(it?.measures ?? it?.medidas ?? '').match(/(\d+(?:[.,]\d+)?)\s*[x\u00d7]\s*(\d+(?:[.,]\d+)?)/i);
    if (m) { a = a || num(m[1]); b = b || num(m[2]); }
  }
  return { ancho_mm: a, alto_mm: b };
}
