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


// El tipo de UN paño, normalizado a lo que entienden el motor Y el dibujo. Vive aca porque
// `esquinaDesdeLabel` es el unico que lo necesita desde los dos lados (precio y figura).
function tipoDeParte(t) {
  const s = String(t || "").toUpperCase();
  if (s.includes("OSCILO")) return "OSCILOBATIENTE";
  if (s.includes("PROYECT")) return "PROYECTANTE";
  if (s.includes("ABAT") || s.includes("BATIENTE")) return "BATIENTE";
  if (s.startsWith("COMPUEST")) return "COMPUESTA";
  return "FIJA";
}

/**
 * Lee la composicion de una VENTANA EN ESQUINA desde la etiqueta que arma el motor.
 * Devuelve {partes:[...]} o null si la etiqueta no es de una esquina.
 *
 * El formato lo produce `calculateBowQuote`:
 *   "Ventana en esquina (N paños, union 90°): <paño> + <paño> + <paño>"
 * y cada paño es "Fijo 2000mm" o "Compuesto 400mm (Proyectante 750mm (arriba) + Fijo 750mm (abajo))".
 * El separador de PAÑOS es " + " a nivel 0: el " + " de adentro del parentesis pertenece al
 * paño compuesto, asi que se corta contando parentesis en vez de con split (un split partia
 * "Compuesto 400mm (Proyectante 750mm" por la mitad y dejaba media ventana).
 */
export function esquinaDesdeLabel(it) {
  const label = String(it?.producto_label || it?.product || it?.producto || "");
  // [#887] Se acepta el nombre nuevo ("Bow window · ventana en esquina (...)") y el viejo:
  // hay propuestas ya emitidas con el anterior y tienen que seguir dibujandose igual.
  const m = label.match(/(?:bow\s*-?\s*window|ventana\s+en\s+esquina)[^:]*:\s*([\s\S]+)$/i);
  if (!m) return null;
  const trozos = [];
  let nivel = 0, actual = "";
  for (let i = 0; i < m[1].length; i++) {
    const ch = m[1][i];
    if (ch === "(") nivel++;
    else if (ch === ")") nivel = Math.max(0, nivel - 1);
    if (ch === "+" && nivel === 0) { trozos.push(actual); actual = ""; continue; }
    actual += ch;
  }
  if (actual.trim()) trozos.push(actual);
  const partes = [];
  for (const t of trozos) {
    const cab = t.trim().match(/^([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\s+(\d+(?:[.,]\d+)?)\s*mm/i);
    if (!cab) return null;                       // formato inesperado: NO se adivina
    const tipo = tipoDeParte(cab[1]);
    const ancho_mm = parseFloat(cab[2].replace(",", "."));
    if (!Number.isFinite(ancho_mm) || ancho_mm <= 0) return null;
    // Un paño COMPUESTO trae sus mitades entre parentesis.
    const sub = [...t.matchAll(/([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\s+(\d+(?:[.,]\d+)?)\s*mm\s*\((?:arriba|abajo|izquierda|derecha)\)/gi)];
    // 🔴 [2026-09-24 · #887] UN PAÑO "Compuesto" SIN DETALLE SIGUE SIENDO COMPUESTO.
    // Reclamo del dueño sobre la propuesta 0541: *"no puso la ventana proyectante a los lados
    // de las bow windows"*. La etiqueta que llega al PDF a veces viene SIN los sub-paños
    // ("... Compuesto 400mm + Fijo 2000mm + Compuesto 400mm") y el lateral salia dibujado
    // como un paño fijo entero — justo lo contrario de lo que el cliente pidio.
    // Dibujar un "Compuesto" como FIJO no es prudencia: es afirmar que NO abre, que es una
    // afirmacion mas fuerte que la que evita. Sin detalle se usa el default del motor de
    // compuestas —mitad proyectante arriba + mitad fija abajo—, que es el que el motor aplica
    // cuando el cliente no desglosa, asi que el dibujo coincide con lo que se COTIZO.
    // Queda declarado aparte de `label` para que se vea que aca hubo un default.
    if (/^compuest/i.test(cab[1]) && sub.length < 2) {
      partes.push({
        tipo: "COMPUESTA", ancho_mm, derivado_de: "label_sin_detalle",
        compuesta: { orientacion: "vertical", partes: [{ tipo: "PROYECTANTE" }, { tipo: "FIJA" }] },
      });
      continue;
    }
    if (/^compuest/i.test(cab[1]) && sub.length >= 2) {
      partes.push({
        tipo: "COMPUESTA", ancho_mm,
        compuesta: {
          orientacion: "vertical",
          partes: sub.map((x) => ({ tipo: tipoDeParte(x[1]), alto_mm: parseFloat(x[2].replace(",", ".")) })),
        },
      });
    } else {
      partes.push({ tipo, ancho_mm });
    }
  }
  if (partes.length < 2) return null;
  return { partes, uniones: partes.length - 1, derivado_de: "label" };
}
