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
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizarCodigo(value) {
  return normalizar(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function quitarMencionesNegadas(texto) {
  const productoNegado =
    /\b(?:sin|no\s+(?:quiero|necesito|busco|cotizar)|que\s+no\s+sea|no)\s+(?:(?:una?|la|el)\s+)?(?:mallas?\s+mosquiteras?|mosquiter[ao]s?|puertas?|(?:ventanas?|ventanales?)\s+plegables?|plegables?|tipo\s+acordeon|circular(?:es)?|redond[ao]s?|ovalad[ao]s?|hexagonal(?:es)?|arcos?|(?:linea|serie|sistema)\s+(?:andes|zenia|venau|american[ao]))\b/g;
  return texto.replace(productoNegado, ' ');
}

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
  if (/^puerta(?:_|$)/.test(tipo)) return resultado('puerta');
  if (/(?:^|[ _])(?:andes|zenia|venau|sistema_american[ao]|american[ao])(?:[ _]|$)/.test(senalEstructurada)) {
    return resultado('linea_no_soportada');
  }

  const textoDetectable = quitarMencionesNegadas(texto);

  if (/\bmosquiter[ao]s?\b|\bmallas?\s+anti\s*mosquitos?\b/.test(textoDetectable)) {
    return resultado('mosquitero');
  }

  const productoPlegable =
    /\b(?:ventanas?|ventanales?|puertas?)\s+plegables?\b/.test(textoDetectable) ||
    /\bplegables?\s+(?:ventanas?|ventanales?|puertas?)\b/.test(textoDetectable) ||
    /\b(?:tipo|sistema)\s+acordeon\b/.test(textoDetectable) ||
    /\b(?:linea|serie|sistema)\s+(?:s60\s+)?plegables?\b/.test(textoDetectable);
  if (productoPlegable) return resultado('plegable');

  const contextoVentana = /\b(?:ventanas?|ventanales?|panos?|vanos?|tragaluces?)\b/.test(textoDetectable);
  const formaEspecifica = /\b(?:circular(?:es)?|redond[ao]s?|ovalad[ao]s?|hexagonal(?:es)?|octogonal(?:es)?|triangular(?:es)?|semicircular(?:es)?|arcos?)\b/.test(textoDetectable);
  if (/\bformas?\s+irregulares?\b/.test(textoDetectable) || (contextoVentana && formaEspecifica)) {
    return resultado('forma_irregular');
  }

  const puertaEnTexto =
    /^\s*(?:(?:una?|la|\d+)\s+)?puertas?\b/.test(textoDetectable) ||
    /\b(?:quiero|necesito|busco)\s+(?:cotizar\s+)?(?:(?:una?|la|dos|tres|\d+)\s+)?puertas?\b/.test(textoDetectable) ||
    /\b(?:cotizar|cotizacion|precio|valor|fabricar|instalar)\s+(?:de\s+|para\s+)?(?:(?:una?|la|dos|tres|\d+)\s+)?puertas?\b/.test(textoDetectable);

  if (puertaEnTexto) return resultado('puerta');

  const lineaNoSoportada =
    /\b(?:linea|serie|sistema|modelo)\s+(?:de\s+)?(?:andes|zenia|venau|american[ao])\b/.test(textoDetectable) ||
    /\b(?:andes|zenia|venau|american[ao])\s+(?:linea|serie|sistema|modelo)\b/.test(textoDetectable);
  if (lineaNoSoportada) return resultado('linea_no_soportada');

  return SIN_DETECCION;
}

export default detectarProductoFueraDeAlcance;
