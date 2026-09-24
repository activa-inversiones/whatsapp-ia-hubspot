// ---------------------------------------------------------------------------
// FORMA ESQUINA / BOW WINDOW — la FUENTE UNICA de "¿esto es una ventana en esquina?"
// ---------------------------------------------------------------------------
// 🔴 POR QUE EXISTE (2026-09-24, instruccion del dueño, textual):
//   *"cuando te pidan una ventana bow window 200x150x40, la primera medida es fija, la segunda
//    es la altura y la tercera es los laterales"*, y con el caso real de ese dia:
//   *"2000X1500X400 ... 2000MM DE ANCHO CENTRAL, 1500 EL ALTO Y LOS LATERALES DE 400X1500"*.
//
// 🔴 EL DEFECTO QUE CIERRA, MEDIDO ANTES DE ESCRIBIRLO: `medidas("2000x1500x400")` devuelve
// {ancho:2000, alto:1500}. **El tercer numero se descarta EN SILENCIO.** Los laterales
// desaparecen, se cotiza otra ventana, y no hay error ni aviso. Perder una medida que el
// cliente SI escribio es peor que no entenderla: si no se entiende, alguien pregunta.
//
// ⚠️ Vive en su propio archivo por la misma razon que `formaMonorriel.js` (#880): la pregunta
// se contesta en UN solo lugar, y lo leen tanto el que COTIZA como el que DIBUJA. Cuando la
// misma pregunta se contesta en dos lados, los dos se contradicen — ya paso, y el cliente vio
// una ventana que no era la que se le cobro.

/**
 * Lee la notacion de tres medidas del dueño. Devuelve {central_mm, alto_mm, lateral_mm} o null.
 *
 * `null` significa "esto NO es una notacion triple", no "hubo un error": una ventana normal
 * tiene dos medidas y tiene que seguir su camino de siempre.
 */
export function leerMedidaTriple(texto) {
  const t = String(texto || '');
  // Las tres medidas SEGUIDAS. El ancla `(?![\s]*[x×])` evita comerse una cuarta.
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i);
  if (!m) return null;
  const n = (s) => parseFloat(String(s).replace(',', '.'));
  let [a, b, c] = [n(m[1]), n(m[2]), n(m[3])];
  if (![a, b, c].every((v) => Number.isFinite(v) && v > 0)) return null;
  // UNIDAD: el mismo criterio que ya usa `medidas()` para dos numeros, extendido a tres.
  //  · <= 6      -> metros  (2 x 1,5 x 0,4)
  //  · <= 600    -> centimetros (200x150x40, que es como el dueño la escribio primero)
  //  · el resto  -> milimetros (2000x1500x400)
  // 🔴 LA CONVERSION ES DE LAS TRES O DE NINGUNA. Convertir solo la que "parece chica"
  // mezclaria unidades dentro de la misma ventana — un lateral de 400 mm junto a un central
  // de 2.000 mm es normal, y ahi el 400 NO son centimetros.
  const esc = (Math.max(a, b, c) <= 6) ? 1000 : (Math.max(a, b, c) <= 600 ? 10 : 1);
  [a, b, c] = [a * esc, b * esc, c * esc];
  return { central_mm: Math.round(a), alto_mm: Math.round(b), lateral_mm: Math.round(c) };
}

// La tipologia dicha por su nombre. "bow window" y sus deformaciones, y como se dice en Chile.
const NOMBRE = /\bbow\s*-?\s*window\b|\bbowindow\b|\bbow\s*window\b/i;
// "ventana/ventanal EN esquina", "esquinera", "en L". La preposicion importa: es lo que
// separa la TIPOLOGIA de la UBICACION.
const FORMA = /\bventanal?\s+(?:en\s+)?(?:esquina|esquinera|esquinada|l)\b/i;

/**
 * ¿El texto describe una ventana EN ESQUINA (tipologia), o solo menciona una esquina (lugar)?
 *
 * 🔴 LA TRAMPA, Y YA MORDIO UNA VEZ EN ESTE REPO: "esquina" en Chile es tambien un lugar
 * ("la ventana de la esquina del living", "proyectante esquina nororiente"). Es el mismo caso
 * de la *cocina* americana, que hacia que una proyectante se cotizara como corredera. Por eso
 * no alcanza con que aparezca la palabra: tiene que estar pegada a "ventana"/"ventanal", o
 * venir el nombre en ingles, que no es ambiguo.
 */
export function esBowPorForma(texto) {
  const t = String(texto || '');
  if (NOMBRE.test(t)) return true;
  // "ventana de la esquina" / "ventana de esquina de la casa" = ubicacion. "de la" la delata.
  if (/\bventanal?\s+de\s+la\s+esquina\b/i.test(t)) return false;
  return FORMA.test(t);
}
