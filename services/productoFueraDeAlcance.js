// Guarda determinística para productos que el cotizador automático no sabe calcular.
// Es pura, barata y no depende del LLM ni de servicios externos.

export const MENSAJE_PRODUCTO_FUERA_DE_ALCANCE =
  'Esto lo revisa Marcelo personalmente para darte el precio exacto. Le voy a avisar para que te contacte.';

const SIN_DETECCION = Object.freeze({
  fueraDeAlcance: false,
  categoria: null,
  razon: null,
  mensajeCliente: null,
});

function normalizar(value) {
  // El "_" cuenta como \w y rompe \b: "PUERTA_1H" (enum real de update_quote en V1)
  // no matcheaba \bpuertas?\b y la guarda era un no-op para el enum. Se separa ac\u00e1.
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .trim();
}

function normalizarCodigo(value) {
  return normalizar(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function quitarMencionesNegadas(texto) {
  // [Ronda 2.1 — Codex] "sin que sea X" + compuestos primero ("puerta ventana plegable"
  // se elimina COMPLETA; antes solo caía "puerta" y quedaba "ventana plegable" detectable).
  const productoNegado =
    /\b(?:sin\s+que\s+sea[ns]?|sin(?:\s+(?:incluir|considerar|contemplar|agregar|contar\s+con))?|no\s+(?:quiero|necesito|busco|cotizar)|que\s+no\s+sea|no)\s+(?:(?:una?|la|el|las|los)\s+)?(?:mallas?\s+mosquiteras?|mosquiter[ao]s?|(?:puertas?\s+)?(?:ventanas?|ventanal(?:es)?)\s+plegables?|puertas?\s+ventanas?|puertas?|plegables?|tipo\s+acordeon|circular(?:es)?|redond[ao]s?|ovalad[ao]s?|hexagonal(?:es)?|arcos?|(?:linea|serie|sistema)\s+(?:andes|zenia|venau|american[ao]))\b/g;
  return texto.replace(productoNegado, ' ');
}

// Sustantivo de ventana y forma irregular unidos SOLO por conectores ("que sea", "en
// forma de", "tipo", coma). [Ronda 2.1 — Codex] Un gap arbitrario NO basta: "ventana
// junto al arco" / "con vista al arco" describen el ENTORNO, no el producto → no escalan.
// "ventana, redonda" (coma) y "ventana en forma de arco" sí.
// [Ronda 3.1] + puertas?: una "puerta redonda"/"puerta en forma de arco" es forma
// irregular (S60_FORMAS) — fuera de alcance aunque las puertas abatibles ya se coticen.
const NOUN_VENTANA = '(?:ventanas?|ventanal(?:es)?|puertas?|panos?|vanos?|tragaluces?)';
const FORMA_IRREG = '(?:circular(?:es)?|redond[ao]s?|ovalad[ao]s?|hexagonal(?:es)?|octogonal(?:es)?|triangular(?:es)?|semicircular(?:es)?|arcos?)';
// [Ronda 2.3 — Codex] Heurística clave: SIN artículos en los conectores. Un artículo antes
// de la forma ("con EL arco decorativo") señala que la forma es un OBJETO de la escena, no
// el adjetivo de la ventana pedida — eso separa "con forma de arco" (producto, escala) de
// "con el arco decorativo al fondo" (contexto, no escala). Ventana {0,4} para cadenas
// naturales largas ("que tenga forma de", "que debe ser completamente").
const CONECTOR_FORMA = '(?:que|sean?|es|ser|debe(?:n)?|tengan?|de|con|en|tipo|estilo|formas?|formatos?|bien|muy|medi[oa]s?|completamente|totalmente)';
const FORMA_CERCA_RE = new RegExp(
  `\\b${NOUN_VENTANA}[\\s,]+(?:${CONECTOR_FORMA}[\\s,]+){0,4}${FORMA_IRREG}\\b` +
  `|\\b${FORMA_IRREG}[\\s,]+(?:${CONECTOR_FORMA}[\\s,]+){0,4}${NOUN_VENTANA}\\b`
);

function resultado(categoria) {
  return {
    fueraDeAlcance: true,
    categoria,
    razon: `producto_fuera_de_alcance:${categoria}`,
    mensajeCliente: MENSAJE_PRODUCTO_FUERA_DE_ALCANCE,
  };
}

/**
 * @param {string} textoCliente Texto literal del cliente o descripción del producto.
 * @param {{tipo?: string, serie?: string}} [normalizados] Tipo/serie ya normalizados, si existen.
 * @returns {{fueraDeAlcance:boolean,categoria:string|null,razon:string|null,mensajeCliente:string|null}}
 */
export function detectarProductoFueraDeAlcance(textoCliente, normalizados = {}) {
  const texto = normalizar(textoCliente);
  const tipo = normalizarCodigo(normalizados?.tipo);
  const serie = normalizarCodigo(normalizados?.serie);

  // Las señales estructuradas son exactas: aquí no existe la ambigüedad de una
  // palabra dentro de una frase libre (por ejemplo, la comuna Los Andes).
  const senalEstructurada = `${tipo} ${serie}`;
  if (/(?:^|[ _])(?:solo_)?mosquiter[ao](?:[ _]|$)/.test(senalEstructurada)) {
    return resultado('mosquitero');
  }
  if (/(?:^|[ _])plegables?(?:[ _]|$)/.test(senalEstructurada)) {
    return resultado('plegable');
  }
  if (/(?:^|[ _])formas?_irregulares?(?:[ _]|$)/.test(senalEstructurada)) {
    return resultado('forma_irregular');
  }
  // [Ronda 3 2026-07-20] 'puerta' YA NO es fuera de alcance: el motor cotiza las
  // abatibles con BOM real S60 (PUERTA / PUERTA_INTERIOR / PUERTA_DOBLE, verificado en
  // vivo + dato del dueño). Las puertas PLEGABLES siguen cayendo por la categoría
  // 'plegable' de abajo; mosquiteras de puerta por 'mosquitero'.
  if (/(?:^|[ _])(?:andes|zenia|venau)(?:[ _]|$)/.test(senalEstructurada)) {  // [2026-08-27] americana SALE (la maneja enginePricer). ANDES VUELVE: ver KILL-SWITCH en enginePricer.
    return resultado('linea_no_soportada');
  }

  const textoDetectable = quitarMencionesNegadas(texto);

  if (/\bmosquiter[ao]s?\b|\bmallas?\s+anti\s*mosquitos?\b/.test(textoDetectable)) {
    return resultado('mosquitero');
  }

  const productoPlegable =
    /\b(?:ventanas?|ventanal(?:es)?|puertas?)\s+plegables?\b/.test(textoDetectable) ||
    /\bplegables?\s+(?:ventanas?|ventanal(?:es)?|puertas?)\b/.test(textoDetectable) ||
    /\b(?:tipo|sistema)\s+acordeon\b/.test(textoDetectable) ||
    /\b(?:linea|serie|sistema)\s+(?:s60\s+)?plegables?\b/.test(textoDetectable);
  if (productoPlegable) return resultado('plegable');

  // [Ronda 2 2026-07-20] Proximidad ≤3 palabras entre sustantivo y forma: antes bastaba
  // que ambos aparecieran en CUALQUIER parte de la frase → "ventana proyectante al lado
  // de un arco decorativo" escalaba una ventana cotizable (falso positivo de la revisión
  // cruzada). "ventana redonda" y "una ventana que sea redonda" siguen detectando.
  if (/\bformas?\s+irregulares?\b/.test(textoDetectable) || FORMA_CERCA_RE.test(textoDetectable)) {
    return resultado('forma_irregular');
  }

  // [2026-08-27] americana quitada de esta lista: la línea Americana (corredera) YA se cotiza
  // con tope de tamaño en enginePricer. Andes/Zenia/Venau siguen fuera de alcance.
  const lineaNoSoportada =
    /\b(?:linea|serie|sistema|modelo|estilo)\s+(?:de\s+)?(?:andes|zenia|venau)\b/.test(textoDetectable) ||
    // [Codex 2026-08-27] Lookbehind: "despacho a Los Andes línea americana" matcheaba "andes linea"
    // y escalaba una AMERICANA cotizable. El "los" delata la COMUNA Los Andes, no la línea.
    // El lookbehind aplica SOLO a "andes": Zenia y Venau no son comunas y ponerlo en la alternancia
    // compartida hacía que "las Zenia línea..." dejara de detectarse (regresión que cazó Codex).
    /(?<!\blos\s)\bandes\s+(?:linea|serie|sistema|modelo|estilo)\b/.test(textoDetectable) ||
    /\b(?:zenia|venau)\s+(?:linea|serie|sistema|modelo|estilo)\b/.test(textoDetectable);
  if (lineaNoSoportada) return resultado('linea_no_soportada');

  return SIN_DETECCION;
}

export default detectarProductoFueraDeAlcance;
