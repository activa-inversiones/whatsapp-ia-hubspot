/* ════════════════════════════════════════════════════════════════════════
   Oliver GPT — Normalizadores + FIX comuna/confirmación + anti-voseo
   ────────────────────────────────────────────────────────────────────────
   MÓDULO F3 del PLAN MAESTRO (Sección 1.1 #12-18,32-40 ; 2.4 #3,#4 ; 3.3).

   Contenido:
   · Funciones portadas TAL CUAL de V1 (index.js):
       strip, getZona / ZONA_COMUNAS / zonaInfo, FABRICATION_LIMITS /
       validateDimensions, detectSupplier / ALLOWED_SUPPLIERS, normProduct,
       normMeasures, normColor, normTipoApertura,
       canQuote / isComplete / nextMissing.
   · FIX nuevos:
       extractComuna(texto)      → FIX #4 (comuna nunca se parseaba)
       detectConfirmation(texto) → FIX #3 (no existía handler SÍ/CONFIRMO)
       sanitizeChilean(texto)    → red de seguridad anti-voseo (porta el
                                   mapeo de la Regla #24 de V1 / ANTI_VOSEO V2)

   Español de Chile profesional (sin voseo).
   ════════════════════════════════════════════════════════════════════════ */

/* ─── strip: quita acentos/diacríticos (PORTAR TAL CUAL — index.js 470) ─── */
export function strip(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/* ─── ZONA_COMUNAS / getZona / zonaInfo (PORTAR TAL CUAL — index.js 691) ─── */
export const ZONA_COMUNAS = {
  // ── Araucanía — Zona 5 (valle central / depresión intermedia) ──
  temuco: 5,
  "padre las casas": 5,
  lautaro: 5,
  victoria: 5,
  vilcun: 5,
  freire: 5,
  pitrufquen: 5,
  gorbea: 5,
  loncoche: 5,
  tolten: 5,
  "teodoro schmidt": 5,
  saavedra: 5,
  carahue: 5,
  "nueva imperial": 5,
  cholchol: 5,
  galvarino: 5,
  perquenco: 5,
  angol: 5,
  collipulli: 5,
  renaico: 5,
  "los sauces": 5,
  puren: 5,
  ercilla: 5,
  lumaco: 5,
  traiguen: 5,
  // ── Araucanía — Zona 6 (precordillera / lacustre) ──
  cunco: 6,
  villarrica: 6,
  pucon: 6,
  curarrehue: 6,
  melipeuco: 6,
  curacautin: 6,
  // ── Araucanía — Zona 7 (cordillera) ──
  lonquimay: 7,
};

export function getZona(raw) {
  if (!raw) return null;
  const c = strip(raw).toLowerCase().trim();
  if (ZONA_COMUNAS[c] !== undefined) return ZONA_COMUNAS[c];
  for (const [name, z] of Object.entries(ZONA_COMUNAS)) {
    if (c.includes(name) || name.includes(c)) return z;
  }
  return null;
}

export function zonaInfo(z) {
  if (!z) return { note: "" };
  return { note: `Zona térmica OGUC: Z${z}. Cumplimos OGUC 4.1.10 (acondicionamiento térmico).` };
}

/* ─── Nombre canónico (display) por clave normalizada de ZONA_COMUNAS ─────
   Usado por extractComuna para devolver el nombre con mayúsculas correctas. */
const COMUNA_DISPLAY = {
  temuco: "Temuco",
  "padre las casas": "Padre Las Casas",
  lautaro: "Lautaro",
  victoria: "Victoria",
  vilcun: "Vilcún",
  freire: "Freire",
  pitrufquen: "Pitrufquén",
  gorbea: "Gorbea",
  loncoche: "Loncoche",
  tolten: "Toltén",
  "teodoro schmidt": "Teodoro Schmidt",
  saavedra: "Saavedra",
  carahue: "Carahue",
  "nueva imperial": "Nueva Imperial",
  cholchol: "Cholchol",
  galvarino: "Galvarino",
  perquenco: "Perquenco",
  angol: "Angol",
  collipulli: "Collipulli",
  renaico: "Renaico",
  "los sauces": "Los Sauces",
  puren: "Purén",
  ercilla: "Ercilla",
  lumaco: "Lumaco",
  traiguen: "Traiguén",
  cunco: "Cunco",
  villarrica: "Villarrica",
  pucon: "Pucón",
  curarrehue: "Curarrehue",
  melipeuco: "Melipeuco",
  curacautin: "Curacautín",
  lonquimay: "Lonquimay",
};

/* ─── FIX #4 — extractComuna(texto) ───────────────────────────────────────
   Detecta cualquiera de las comunas de ZONA_COMUNAS en el texto libre
   (insensible a mayúsculas y acentos) y devuelve el nombre canónico, o null.
   ANTES (V1): la comuna nunca se parseaba → el resumen imprimía "Pendiente".
   ─────────────────────────────────────────────────────────────────────── */
export function extractComuna(texto) {
  if (!texto) return null;
  const t = strip(texto).toLowerCase();

  // Ordenar claves de mayor a menor longitud para priorizar nombres compuestos
  // (ej. "padre las casas" antes que coincidencias parciales).
  const claves = Object.keys(ZONA_COMUNAS).sort((a, b) => b.length - a.length);

  for (const clave of claves) {
    // límites de palabra para evitar falsos positivos dentro de otra palabra
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(clave)}([^a-z0-9]|$)`, "i");
    if (re.test(t)) return COMUNA_DISPLAY[clave] || clave;
  }
  return null;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ─── FIX #3 — detectConfirmation(texto) ──────────────────────────────────
   true si el texto es una confirmación afirmativa del cliente.
   Dispara confirm_quote (cotización definitiva) en lugar de que el LLM
   reinterprete y resetee el flujo.
   ─────────────────────────────────────────────────────────────────────── */
export function detectConfirmation(texto) {
  if (!texto) return false;
  const t = strip(texto).toLowerCase().trim();
  return /\b(si|confirmo|dale|de acuerdo|listo|ok|correcto|asi es)\b/i.test(t);
}

/* ─── FABRICATION_LIMITS + validateDimensions (PORTAR TAL CUAL — 748) ───── */
export const FABRICATION_LIMITS = {
  S60: {
    ventana: { minAncho: 400, maxAncho: 1930, minAlto: 400, maxAlto: 1930 },
    puerta:  { minAncho: 800, maxAncho: 1970, minAlto: 1500, maxAlto: 2400 },
  },
  SLIDING: {
    H98: { minAncho: 500, maxAncho: 2930, minAlto: 500, maxAlto: 2150 },
    H80: { minAncho: 500, maxAncho: 3000, minAlto: 500, maxAlto: 2150 },
  },
};

export function validateDimensions(product, ancho_mm, alto_mm) {
  const p = String(product || "").toUpperCase();

  // Correderas → SLIDING limits
  if (p.includes("CORREDERA")) {
    const lim = FABRICATION_LIMITS.SLIDING.H98;
    if (ancho_mm > lim.maxAncho || alto_mm > lim.maxAlto) {
      return { message: `Corredera ${ancho_mm}×${alto_mm} excede límite fabricación (máx ${lim.maxAncho}×${lim.maxAlto}).`, escalate: true };
    }
    return null; // OK
  }

  // Puertas → S60 puerta limits
  if (p.includes("PUERTA")) {
    const lim = FABRICATION_LIMITS.S60.puerta;
    if (ancho_mm > lim.maxAncho || alto_mm > lim.maxAlto) {
      return { message: `Puerta ${ancho_mm}×${alto_mm} excede límite (máx ${lim.maxAncho}×${lim.maxAlto}).`, escalate: true };
    }
    return null;
  }

  // Todas las demás (proyectante, abatible, oscilobatiente, fijo) → S60 ventana limits
  const lim = FABRICATION_LIMITS.S60.ventana;
  if (ancho_mm > lim.maxAncho || alto_mm > lim.maxAlto) {
    // Si cabe en SLIDING → sugerir corredera
    const slidingLim = FABRICATION_LIMITS.SLIDING.H98;
    if (ancho_mm <= slidingLim.maxAncho && alto_mm <= slidingLim.maxAlto) {
      return {
        message: `Medida ${ancho_mm}×${alto_mm} excede límite S60 (máx ${lim.maxAncho}×${lim.maxAlto}). Sugerencia: ventana corredera.`,
        suggest: "CORREDERA",
        escalate: false,
      };
    }
    return { message: `Medida ${ancho_mm}×${alto_mm} excede todos los límites de fabricación.`, escalate: true };
  }
  return null; // OK
}

/* ─── detectSupplier / ALLOWED_SUPPLIERS (PORTAR TAL CUAL — 1375) ───────── */
export const ALLOWED_SUPPLIERS = ["WINHOUSE_PVC", "SODAL_ALUMINIO"];

export function detectSupplier(text) {
  const s = strip(text).toLowerCase();
  if (/\baluminio\b|sodal|muro cortina/.test(s)) return "SODAL_ALUMINIO";
  return "WINHOUSE_PVC";
}

/* ─── normProduct (PORTAR TAL CUAL — index.js 1383) ───────────────────────── */
export function normProduct(raw = "") {
  const s = strip(raw).toUpperCase();
  if (s.includes("PUERTA") && /DOBLE|2\s*HOJ|DOS\s*HOJ/.test(s)) return "PUERTA_DOBLE";
  if (s.includes("PUERTA")) return "PUERTA_1H";
  if (s.includes("PROYEC")) return "PROYECTANTE";
  if (/MARCO|FIJO|PA[NÑ]O/.test(s)) return "MARCO_FIJO";
  if (s.includes("OSCILO")) return "OSCILOBATIENTE";
  if (s.includes("ABAT")) return "ABATIBLE";
  if (s.includes("CORREDERA") && s.includes("98")) return "CORREDERA_98";
  if (s.includes("CORREDERA") || s.includes("VENTANA")) return "CORREDERA";
  return "CORREDERA";
}

/* ─── normMeasures (PORTAR TAL CUAL — index.js 1401) ──────────────────────
   "3 ventanas 1500x1200" → busca patrón NxN primero → extrae 1500×1200.
   Si no hay NxN, toma los dos números mayores (ignora cantidades pequeñas).
   Devuelve { ancho_mm, alto_mm } en milímetros, o null.
   ─────────────────────────────────────────────────────────────────────── */
export function normMeasures(raw) {
  const s = String(raw || "");

  // 1) Patrón explícito: "1500x1200", "1.5 x 1.2", "150×120", "1500 por 1200"
  const dimMatch = s.match(
    /(\d+([.,]\d+)?)\s*[x×X]\s*(\d+([.,]\d+)?)/
  ) || s.match(
    /(\d+([.,]\d+)?)\s+por\s+(\d+([.,]\d+)?)/i
  );

  if (dimMatch) {
    let a = parseFloat(dimMatch[1].replace(",", "."));
    let b = parseFloat(dimMatch[3].replace(",", "."));
    if (a <= 6) a *= 1000;
    if (b <= 6) b *= 1000;
    // [FIX 2026-06-18] cm→mm hasta < 400 (antes <=300, BUG): una ventana fabricable mide
    // ≥400mm (S60 400 / SLIDING 500). "315"=315cm=3,15m (corredera grande), no 31,5mm.
    // El tope viejo de 300 dejaba 301–399cm leídos como mm → 0,08 m² → $301k en vez de $948k.
    if (a >= 7 && a < 400) a *= 10;
    if (b >= 7 && b < 400) b *= 10;
    return { ancho_mm: Math.round(a), alto_mm: Math.round(b) };
  }

  // 2) Fallback: extraer todos los números, filtrar cantidades pequeñas
  const nums = s.match(/(\d+([.,]\d+)?)/g);
  if (!nums || nums.length < 2) return null;

  const allNums = nums.map((n) => parseFloat(n.replace(",", ".")));

  // Filtrar: enteros ≤ 20 probablemente son cantidades, no medidas
  // EXCEPTO si son decimales (ej: 1.5 = metros)
  const candidates = allNums.filter((n) => {
    if (n > 20) return true;                    // claramente medida
    if (!Number.isInteger(n) && n > 0) return true; // decimal = metros
    return false;
  });

  if (candidates.length < 2) {
    // Si no hay suficientes candidatos, tomar los 2 más grandes
    const sorted = [...allNums].sort((a, b) => b - a);
    if (sorted.length < 2) return null;
    candidates.length = 0;
    candidates.push(sorted[0], sorted[1]);
  }

  let a = candidates[0];
  let b = candidates[1];
  if (a <= 6) a *= 1000;
  if (b <= 6) b *= 1000;
  if (a >= 7 && a < 400) a *= 10;   // [FIX 2026-06-18] ver nota arriba: cm hasta <400
  if (b >= 7 && b < 400) b *= 10;
  return { ancho_mm: Math.round(a), alto_mm: Math.round(b) };
}

/* ─── normColor (PORTAR TAL CUAL — index.js 5433) ─────────────────────────
   CATÁLOGO REAL: BLANCO | NOGAL | ROBLE | GRAFITO | NEWBLACK.
   Mapea coloquial chileno → color de catálogo. NUNCA devuelve "GRIS".
   ─────────────────────────────────────────────────────────────────────── */
export function normColor(text) {
  if (!text) return "BLANCO";
  const t = text.toLowerCase().trim();

  if (t.includes("blanco") || t.includes("white")) return "BLANCO";
  if (t.includes("nogal") || t.includes("roble") || t.includes("madera") || t.includes("dorado")) return "NOGAL";
  if (t.includes("grafito") || t.includes("antracita") || t.includes("gris") || t.includes("plomo")) return "GRAFITO";
  if (t.includes("negro") || t.includes("black") || t.includes("new black") || t.includes("newblack")) return "NEWBLACK";

  return "BLANCO"; // default
}

/* ─── normTipoApertura (PORTAR TAL CUAL — index.js 5445) ──────────────────── */
export function normTipoApertura(text) {
  const t = strip(text).toLowerCase();
  if (t.includes("abatible") || t.includes("abatir")) return "ABATIBLE";
  if (t.includes("oscilobatiente") || t.includes("oscilo")) return "OSCILOBATIENTE";
  if (t.includes("proyectante") || t.includes("proy")) return "PROYECTANTE";
  if (t.includes("fijo") || t.includes("marco fijo")) return "FIJO";
  if (t.includes("corredera") || t.includes("sliding")) return "CORREDERA";
  if (t.includes("basculante")) return "BASCULANTE";
  if (t.includes("plegable")) return "PLEGABLE";
  return "CORREDERA"; // más común
}

/* ─── Gates de completitud (PORTAR TAL CUAL — index.js 2376) ──────────────── */
export function nextMissing(d) {
  if (!d.items.length) return "productos (tipo, medidas y cantidad)";
  const noP = d.items.some((i) => !i.product);
  const noM = d.items.some((i) => !i.measures);
  if (noP || noM) return "completar datos de algunos items";
  if (!d.default_color && d.items.some((i) => !i.color)) return "color";
  if (!d.comuna && !d.address) return "comuna";
  return "";
}


/**
 * Los 5 colores REALES del catalogo. Ningun otro existe: si el cliente dice "cafe", el
 * prompt de Oliver lo mapea a Nogal antes de llegar aca.
 */
export const COLORES_CATALOGO = ['Blanco', 'Nogal', 'Roble Dorado', 'Grafito Antracita', 'Negro'];

/**
 * RECUERDA EL COLOR DE LA CONVERSACION.
 *
 * 🔴 [2026-08-25] Existe porque `state.default_color` se LEIA en cuatro lugares y no se
 * ESCRIBIA en ninguno. Resultado: llegaba vacio al motor y **todas** las cotizaciones
 * salian blancas, sin importar lo que pidiera el cliente. Lo reporto el dueño y se
 * confirmo contra la BD viva: `default_color` null o vacio en las 10 sesiones de las
 * ultimas 20 h — en una de ellas el cliente habia escrito "nogal" explicito.
 *
 * TOCA PLATA: el perfil en color cuesta mas que el blanco. Cotizar blanco y entregar
 * nogal es recotizar o comerse la diferencia.
 *
 * El cliente dice el color UNA vez y lista sus ventanas en varios mensajes, asi que el
 * color tiene que sobrevivir a los turnos siguientes. Un color nuevo reemplaza al viejo
 * (cambio de opinion); una cotizacion SIN color no borra lo recordado.
 *
 * @param {object} state  se modifica en el lugar (es el estado de la sesion)
 * @param {Array} items   items de la cotizacion, con su `color` si el LLM lo capturo
 */
export function recordarColor(state, items) {
  if (!state || typeof state !== 'object') return state;
  const lista = Array.isArray(items) ? items : [];
  for (const it of lista) {
    const crudo = String(it?.color || '').trim();
    if (!crudo) continue;
    // Se guarda con la grafia del catalogo: el motor y el PDF comparan por texto, y
    // "nogal" con minuscula podria no calzar con la lista de precios.
    const delCatalogo = COLORES_CATALOGO.find((c) => c.toLowerCase() === crudo.toLowerCase());
    state.default_color = delCatalogo || crudo;
  }
  return state;
}

/** Cuantas ventanas se listan antes de resumir. Mas que esto inunda el chat. */
const TOPE_RESUMEN = 8;

/**
 * EL ANTICIPO DE LA PROPUESTA: que se le cotizo, en una linea por ventana, enviado ANTES
 * del PDF para que el cliente corrija a tiempo.
 *
 * 🔴 [2026-08-25] Nacio como resumen pegado al cierre ("Le coticé: ..."), por el reclamo
 * del dueño: *"no le informamos qué cosa le cotizaríamos, como V1 1200x1000 CORREDERA"*.
 * 🔴 [2026-08-28] El dueño lo MOVIO al principio, textual: *"antes de enviar el archivo...
 * deberíamos decirle al principio... para que nos corrija el cliente si las medidas están
 * al revés"* + *"que sepa qué le estamos cotizando: si es corredera, proyectante,
 * oscilobatiente... además de informar el color igual"*. Por eso las medidas van con el
 * ancho y el alto NOMBRADOS (no "1000x1200" pelado), el tipo de apertura abre la linea y
 * el color va siempre que exista.
 *
 * ⚠️ VA EN CODIGO Y NO EN EL PROMPT a proposito. El proyecto ya aprendio esto caro: la
 * REGLA #12 del prompt prohibia repetir mensajes y Oliver mando el texto identico 73 veces
 * a 26 clientes. Una instruccion al cerebro se cumple casi siempre, y "casi siempre" sobre
 * el momento mas importante de la venta no alcanza.
 *
 * ⛔ SIN PRECIOS. Regla #13: el monto va SOLO en el PDF formal. Esto dice QUE, no CUANTO.
 *
 * @param {Array} items  items de la cotizacion ya resueltos por el motor
 * @returns {string} texto listo para enviar, o '' si no hay nada que decir
 */
export function anticipoDeLoCotizado(items) {
  const lista = Array.isArray(items) ? items : [];
  if (!lista.length) return '';

  const linea = (it, i, numerar) => {
    // [Gemini, compuerta 28-ago] La serie de fabrica (S60/M70/H98...) NO va al chat: la
    // regla vieja del bot ya decia 'NUNCA "S60"' y la doctrina del dueno pide siglas
    // explicadas o ninguna. Al cliente le importa "Proyectante" o "Corredera", que es
    // justo lo que el dueno pidio informar; la serie completa vive en el PDF.
    const tipo = String(it?.producto_label || it?.product || '').trim()
      .replace(/\b[SMH]\d{2,3}\b/g, '').replace(/\s{2,}/g, ' ').trim();
    const med = String(it?.measures_original || it?.measures || '').trim();
    // "1000x1200" -> "1000 de ancho × 1200 de alto": la convencion de la casa es
    // ancho×alto, y NOMBRARLA es lo que permite que el cliente cace una medida al reves.
    const m = med.match(/^(\d{2,4})\s*[x×]\s*(\d{2,4})\s*(?:mm)?$/i);
    const medTxt = m ? `${m[1]} de ancho × ${m[2]} de alto` : med.replace(/x/i, '×');
    const cant = Number(it?.qty) > 1 ? `${Number(it.qty)} × ` : '';
    const color = String(it?.color || '').trim();
    const amb = String(it?.ambiente || '').trim();
    // Solo lo que existe: un item incompleto no puede imprimir "undefined" en el chat.
    const partes = [cant + (tipo || 'Ventana'), medTxt, color, amb].filter(Boolean);
    return `${numerar ? `V${i + 1} · ` : ''}${partes.join(' · ')}`;
  };

  const numerar = lista.length > 1;   // "V1" de una sola ventana es ruido
  const visibles = lista.slice(0, TOPE_RESUMEN).map((x, i) => linea(x, i, numerar));
  const sobran = lista.length - visibles.length;

  return `Su Propuesta Técnica Económica considera:\n${visibles.join('\n')}`
    + (sobran > 0 ? `\n…y ${sobran} más, todo detallado en el documento.` : '')
    + `\n\nRevise por favor el tipo de apertura, el color y las medidas (las damos primero `
    + `de ancho y después de alto): si algo quedó al revés o no calza, me dice y lo corrijo al instante.`;
}

export function isComplete(d) {
  if (!d.items.length) return false;
  const hasColor = d.default_color || d.items.every((i) => i.color);
  const hasLoc = d.comuna || d.address;
  const allItems = d.items.every((i) => i.product && i.measures);
  return !!(hasColor && hasLoc && allItems);
}

export function canQuote(d) {
  if (!d.items.length) return false;
  const hasColor = d.default_color || d.items.every((i) => i.color);
  return d.items.every((i) => i.product && i.measures) && hasColor;
}

/* ─── sanitizeChilean(texto) — red de seguridad anti-voseo ────────────────
   Reescribe rioplatense → chileno formal ANTES de enviar al cliente.
   Porta el mapeo de la Regla #24 de V1 (index.js 2734) y el espíritu del
   ANTI_VOSEO de V2. Se integra dentro de sanitizeForCustomer del agente.

   Conserva mayúscula inicial y capitalización del término original.
   ─────────────────────────────────────────────────────────────────────── */
const ANTI_VOSEO = [
  // verbos voseo más frecuentes
  ["podés", "puede"],
  ["tenés", "tiene"],
  ["querés", "quiere"],
  ["sabés", "sabe"],
  ["venís", "viene"],
  ["hacés", "hace"],
  ["decís", "dice"],
  ["ponés", "pone"],
  ["sos", "es"],
  // imperativos voseo
  ["decime", "dígame"],
  ["contame", "cuénteme"],
  ["mirá", "mire"],
  ["cotizá", "cotice"],
  ["avisame", "avíseme"],
  ["escribime", "escríbame"],
  ["fijate", "fíjese"],
  ["dale", "adelante"],
  // léxico rioplatense
  ["bárbaro", "excelente"],
  ["laburo", "trabajo"],
  ["vos", "usted"],
];

// [2026-06-19] Activa NO usa la palabra "cotización" de cara al cliente: usa "propuesta"
// (forma corta de "Propuesta Técnica Económica", el nombre formal va en el PDF). Una regla en
// el prompt NO basta (el LLM ve "cotización" por todo el prompt como concepto y la copia), así
// que se reemplaza DETERMINISTAMENTE en CADA mensaje saliente, igual que el anti-voseo.
const TERM_REPLACEMENTS = [
  ["cotizaciones", "propuestas"],
  ["cotización", "propuesta"],
  ["cotizacion", "propuesta"],   // por si el LLM la escribe sin tilde
];

export function sanitizeChilean(texto) {
  if (!texto || typeof texto !== "string") return texto;
  let out = texto;
  for (const [from, to] of ANTI_VOSEO) {
    // \b...\b con flags g+i, insensible a mayúsculas; preserva capitalización
    const re = new RegExp(`\\b${escapeRegExp(from)}\\b`, "giu");
    out = out.replace(re, (match) => matchCase(match, to));
  }
  for (const [from, to] of TERM_REPLACEMENTS) {
    const re = new RegExp(`\\b${escapeRegExp(from)}\\b`, "giu");
    out = out.replace(re, (match) => matchCase(match, to));
  }
  return out;
}

// Aplica al reemplazo la capitalización del término original encontrado.
function matchCase(original, replacement) {
  if (original === original.toUpperCase() && original.length > 1) {
    return replacement.toUpperCase();
  }
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}
