// services/enginePricer.js — Cotizador ACTIVA Engine para Oliver GPT
//
// Migración del cotizador V1 al ACTIVA Engine, gated por PRICER_MODE=engine.
// Respeta EXACTAMENTE el contrato de retorno de priceAll (index.js):
//   { ok, total, source:'activa_engine', escalate, reason?, error?, partial? }
// y setea en cada d.items[i] los mismos campos que
// applyCotizadorResultToSessionItems: unit_price, total_price, source,
// confidence, price_warning.
//
// Contrato del Engine (vía src/oliver-gpt/engine-client.js):
//   POST /api/quotes/calculate con
//     { tipo (APERTURA), ancho_mm, alto_mm, color, glass_id, comuna, cantidad }
//   Devuelve { ok, total_clp, total_con_iva, items, ... }.
//   NUNCA tipo:'TERMOPANEL' (es vidrio, va por glass_id).
//
// ESM, Node 18+.

import { calcularCotizacion } from "../src/oliver-gpt/engine-client.js";
import { detectarProductoFueraDeAlcance } from "./productoFueraDeAlcance.js";

// glass_id por defecto (termopanel). Configurable por env.
const DEFAULT_GLASS_ID = Number(process.env.ACTIVA_ENGINE_DEFAULT_GLASS_ID) || 44;

// ── Selección de vidrio por ÁREA + AMBIENTE (regla del dueño 2026-06-06) ──────
//   < 2 m²  → 4+12+4 claro (id 34)
//   ≥ 2 m²  → 5+12+5 claro (id 61)
//   Baño/WC → 4+12+4 satén (id 38)  [detección por nombre del ambiente]
// IDs configurables por env por si cambian en el catálogo del motor.
const GLASS_STD     = Number(process.env.GLASS_ID_STD)            || 34;
const GLASS_LARGE   = Number(process.env.GLASS_ID_LARGE)          || 61;
const GLASS_BANO    = Number(process.env.GLASS_ID_BANO)           || 38;
const GLASS_AREA_M2 = Number(process.env.GLASS_AREA_THRESHOLD_M2) || 2;
function pickGlassId(ancho_mm, alto_mm, ambiente) {
  const amb = String(ambiente || '').toLowerCase();
  if (/ba[ñn]o|wc|w\/c|water/.test(amb)) return GLASS_BANO;   // baño → satén
  const area = (Number(ancho_mm) / 1000) * (Number(alto_mm) / 1000);
  return area >= GLASS_AREA_M2 ? GLASS_LARGE : GLASS_STD;
}

// Aperturas válidas del Engine (enum cerrado). TERMOPANEL NUNCA está aquí.
const APERTURAS_ENGINE = new Set([
  "CORREDERA",
  "PROYECTANTE",
  "FIJA",
  "BATIENTE",
  "OSCILOBATIENTE",
]);

/**
 * Réplica local de normTipoApertura (index.js) — NO exportada desde index.
 * Devuelve la familia coloquial, o **null si el texto NO nombra ninguna apertura**.
 *
 * 🔴 [2026-08-25] Antes esto devolvía "CORREDERA" cuando no reconocía nada, y ese default
 * era INDISTINGUIBLE de un cliente que pidió corredera de verdad. Separar "no dijo" de
 * "dijo corredera" es lo único que permite preguntar en vez de suponer. El default sigue
 * existiendo (`normTipoAperturaLocal`, abajo): lo que cambia es que ahora se puede saber
 * que se aplicó.
 */
function detectarAperturaLocal(text) {
  const t = String(text || "").toLowerCase();
  // [Ronda 3 2026-07-20 · afinada 3.1 por revisión Codex] PUERTAS ABATIBLES — PRIMERO
  // (antes del check "abatible": una "puerta abatible" es PUERTA, no ventana BATIENTE).
  // Guardas de la rama:
  //  (a) negación: "no quiero una puerta, necesito una ventana fija" NO es puerta;
  //  (b) sustantivo-primero: si "ventana(l)" aparece ANTES que "puerta" en la frase
  //      ("ventana para la puerta de la cocina"), el producto es la VENTANA;
  //      "puerta ventana" (puerta primero) sí es puerta;
  //  (c) deslizantes: corredera/corrediza/deslizante/sliding → ramo CORREDERA/SLIDING.
  // [Ronda 3.2 — Codex] Limpiar FRASES NEGADAS COMPLETAS (sustantivo + SUS MODIFICADORES)
  // y usar el texto limpio en TODAS las ramas: antes "no quiero puerta DOBLE, necesito
  // puerta simple" dejaba vivo el "doble" (→ PUERTA_DOBLE mal) y "no quiero puerta
  // ABATIBLE, necesito ventana corredera" dejaba vivo "abatible" (→ BATIENTE mal).
  // [3.3] La negación también viene POSPUESTA en chileno: "…, no puerta doble" (sin
  // verbo) y "puerta doble no; puerta simple sí" (negación después del sustantivo).
  const MODS = '(?:\\s+(?:abatibles?|dobles?|simples?|interior(?:es)?|exterior(?:es)?|correderas?|corredizas?|deslizantes?|fij[ao]s?|batientes?|oscilobatientes?|proyectantes?|basculantes?|plegables?|de\\s+(?:una|dos|1|2)\\s+hojas?))*';
  const tl = t
    .replace(
      new RegExp(`\\b(?:no\\s+(?:quiero|necesito|busco)|no|sin|que\\s+no\\s+sea)\\s+(?:(?:una?|la|el)\\s+)?(?:puertas?|ventanas?|ventanal(?:es)?)${MODS}\\b`, 'g'),
      " "
    )
    .replace(
      new RegExp(`\\b(?:puertas?|ventanas?|ventanal(?:es)?)${MODS}[\\s,;]*\\b(?:no|tampoco)\\b`, 'g'),
      " "
    );
  const iPuerta = tl.indexOf("puerta");
  const iVentana = tl.search(/ventan/);
  // "cambiar/reemplazar X POR Y": el producto pedido es Y aunque aparezca después
  // ("reemplazar la ventana por una puerta abatible" ES una puerta — regresión Codex).
  const porPuerta = /\b(?:por|hacia)\s+(?:una?\s+|la\s+)?puertas?\b/.test(tl);
  const porVentana = /\b(?:por|hacia)\s+(?:una?\s+|la\s+)?ventan/.test(tl);
  if (iPuerta >= 0 && !porVentana &&
      (porPuerta || iVentana < 0 || iPuerta < iVentana) &&
      !/corredera|corrediz|deslizant|desliza|sliding/.test(tl)) {
    if (tl.includes("interior")) return "PUERTA_INTERIOR";
    if (tl.includes("doble") || /\b(?:2|dos)\s*hojas?\b/.test(tl)) return "PUERTA_DOBLE";
    return "PUERTA";
  }
  if (tl.includes("abatible") || tl.includes("abatir")) return "ABATIBLE";
  if (tl.includes("oscilobatiente") || tl.includes("oscilo")) return "OSCILOBATIENTE";
  if (tl.includes("proyectante") || tl.includes("proy")) return "PROYECTANTE";
  // [FIX 2026-06-24 — BUG RAÍZ COTIZADOR] El enum real del bot es "FIJA"/"BATIENTE", pero antes
  // solo se matcheaba "fijo"/"abatible" → "FIJA" y "BATIENTE" caían al fallback CORREDERA y se
  // cotizaban (y rotulaban serie SLIDING) como CORREDERA: precio ~2x. Explica el caso 0064/0065/0066.
  // Probado: _test-apertura-bug.mjs (RED→GREEN). Ahora cubre fija/fijas/fijo/fijos y batiente.
  if (/\bfij[ao]s?\b/.test(tl) || tl.includes("marco fijo")) return "FIJO";
  if (tl.includes("corredera") || tl.includes("corrediz") || tl.includes("sliding") || tl.includes("deslizan")) return "CORREDERA";
  if (tl.includes("batiente")) return "ABATIBLE"; // (oscilobatiente ya capturado arriba)
  if (tl.includes("basculante")) return "BASCULANTE";
  if (tl.includes("plegable")) return "PLEGABLE";
  return null; // el texto no nombra ninguna apertura
}

/** Familia coloquial CON el default histórico. Mismo comportamiento de siempre. */
function normTipoAperturaLocal(text) {
  return detectarAperturaLocal(text) || "CORREDERA"; // más común
}

/**
 * ¿El cliente NOMBRÓ la apertura, o se la estamos poniendo nosotros?
 *
 * Nació de un reclamo del dueño (2026-08-25), textual: *"siempre está enviando imágenes
 * que igual le cotizamos corredera"*. El mecanismo era este archivo: cualquier texto que
 * no dijera una apertura —"ventana", "V1 | NO ESPECIFICADO | 2000x1450" que devuelve la
 * visión cuando no la ve— caía a CORREDERA **en silencio**, y el cliente recibía el precio
 * de una corredera sin que nadie le avisara. Es el mismo defecto del color, que costó que
 * TODAS las cotizaciones salieran blancas.
 *
 * Solo REPORTA. No cambia ni un peso del cálculo: quién pregunta es el gate del PDF.
 */
export function aperturaFueExplicita(text) {
  return detectarAperturaLocal(text) !== null;
}

/**
 * Mapea el producto del item a una APERTURA válida del Engine.
 * default CORREDERA si no se reconoce; NUNCA TERMOPANEL.
 * @param {string} product
 * @returns {'CORREDERA'|'PROYECTANTE'|'FIJA'|'BATIENTE'|'OSCILOBATIENTE'}
 */
export function mapAperturaToEngine(product) {
  const fueraDeAlcance = detectarProductoFueraDeAlcance(product);
  if (fueraDeAlcance.fueraDeAlcance) {
    throw new TypeError(fueraDeAlcance.razon);
  }
  const norm = normTipoAperturaLocal(product);
  switch (norm) {
    case "PROYECTANTE":
      return "PROYECTANTE";
    case "OSCILOBATIENTE":
      return "OSCILOBATIENTE";
    case "ABATIBLE":
      return "BATIENTE";
    case "FIJO":
      return "FIJA";
    case "CORREDERA":
      return "CORREDERA";
    // [Ronda 3 2026-07-20] Puertas abatibles: el motor las cotiza con BOM real S60
    // (verificado en vivo). Pasan tal cual — mapSerieToEngine las manda a S60.
    case "PUERTA":
      return "PUERTA";
    case "PUERTA_INTERIOR":
      return "PUERTA_INTERIOR";
    case "PUERTA_DOBLE":
      return "PUERTA_DOBLE";
    // BASCULANTE, PLEGABLE y cualquier otro → default seguro
    default:
      return "CORREDERA";
  }
}

/**
 * Mapea la apertura del Engine a la SERIE de perfiles.
 * Corredera = SLIDING (el motor elige hoja H80/H98 por área y riel por nº hojas);
 * el resto de aperturas = S60. Antes NO se mandaba serie → el motor asumía S60 y la
 * corredera cotizaba con perfiles equivocados (precio inventado). FIX 2026-06-06.
 * @param {'CORREDERA'|'PROYECTANTE'|'FIJA'|'BATIENTE'|'OSCILOBATIENTE'} tipoEngine
 * @returns {'SLIDING'|'S60'}
 */
export function mapSerieToEngine(tipoEngine) {
  return tipoEngine === "CORREDERA" ? "SLIDING" : "S60";
}

/**
 * Detecta nº de hojas si el cliente/foto lo indica ("3 hojas", "triple").
 * Si no se sabe → undefined (el motor usa su default = 2 hojas / doble riel).
 */
function detectHojas(product) {
  const t = String(product || "").toLowerCase();
  const m = t.match(/(\d)\s*hoja/);
  if (m) return Math.max(1, Number(m[1]));
  if (/triple/.test(t)) return 3;
  return undefined;
}

/**
 * Réplica local de normColor (index.js) — NO exportada desde index.
 * Catálogo: BLANCO | NOGAL | GRAFITO | NEWBLACK.
 */
function normColorLocal(text) {
  if (!text) return "BLANCO";
  const t = String(text).toLowerCase().trim();
  if (t.includes("blanco") || t.includes("white")) return "BLANCO";
  if (t.includes("nogal") || t.includes("roble") || t.includes("madera") || t.includes("dorado")) return "NOGAL";
  if (t.includes("grafito") || t.includes("antracita") || t.includes("gris") || t.includes("plomo")) return "GRAFITO";
  if (t.includes("negro") || t.includes("black") || t.includes("new black") || t.includes("newblack")) return "NEWBLACK";
  return "BLANCO";
}

/**
 * Réplica local de normMeasures (index.js) — NO exportada desde index.
 * Devuelve { ancho_mm, alto_mm } o null.
 */
export function normMeasuresLocal(raw) { // [LOTE2] export para test del sufijo mm (antes solo interna)
  const s = String(raw || "");

  // [2026-07-06 LOTE2] Formato INTERNO "AxBmm" (enteros pegados, sin espacios) = medidas YA resueltas
  // por calcular_cotizacion (incluida la confirmación de unidad del cliente) → tomar LITERAL, sin
  // heurísticas. Sin esto, este re-parseo re-manglaba lo ya confirmado (350x600 confirmado → ×10 →
  // 3500x600, caso real proyectante de baño 2026-07-06). El anclaje ^$ ESTRICTO evita falsos positivos
  // con texto de clientes ("140x100 mm" con espacio o "1,40x1,00 mm" con decimales → heurística, como
  // siempre). Bounds [50,6000] = defensa en profundidad (escéptico L2); validate/clamps deciden el resto.
  const mmExplicit = s.match(/^\s*(\d+)x(\d+)mm\s*$/i);
  if (mmExplicit) {
    const a = Number(mmExplicit[1]);
    const b = Number(mmExplicit[2]);
    if (a >= 50 && a <= 6000 && b >= 50 && b <= 6000) return { ancho_mm: a, alto_mm: b };
  }

  const dimMatch =
    s.match(/(\d+([.,]\d+)?)\s*[x×X]\s*(\d+([.,]\d+)?)/) ||
    s.match(/(\d+([.,]\d+)?)\s+por\s+(\d+([.,]\d+)?)/i);

  if (dimMatch) {
    let a = parseFloat(dimMatch[1].replace(",", "."));
    let b = parseFloat(dimMatch[3].replace(",", "."));
    if (a <= 6) a *= 1000;
    if (b <= 6) b *= 1000;
    if (a >= 7 && a < 400) a *= 10;   // [FIX 2026-06-18] cm→mm hasta <400 (antes <=300, sub-cotizaba grandes)
    if (b >= 7 && b < 400) b *= 10;
    return { ancho_mm: Math.round(a), alto_mm: Math.round(b) };
  }

  const nums = s.match(/(\d+([.,]\d+)?)/g);
  if (!nums || nums.length < 2) return null;

  const allNums = nums.map((n) => parseFloat(n.replace(",", ".")));
  const candidates = allNums.filter((n) => {
    if (n > 20) return true;
    if (!Number.isInteger(n) && n > 0) return true;
    return false;
  });

  if (candidates.length < 2) {
    const sorted = [...allNums].sort((a, b) => b - a);
    if (sorted.length < 2) return null;
    candidates.length = 0;
    candidates.push(sorted[0], sorted[1]);
  }

  let a = candidates[0];
  let b = candidates[1];
  if (a <= 6) a *= 1000;
  if (b <= 6) b *= 1000;
  if (a >= 7 && a < 400) a *= 10;   // [FIX 2026-06-19 COB-01] fallback faltaba: cm→mm hasta <400 (el replace_all del 18-jun no lo agarró por indentación)
  if (b >= 7 && b < 400) b *= 10;
  return { ancho_mm: Math.round(a), alto_mm: Math.round(b) };
}

const FABRICATION_LIMITS = {
  S60: {
    ventana: { minAncho: 400, maxAncho: 1930, minAlto: 400, maxAlto: 1930 },
    puerta: { minAncho: 800, maxAncho: 1970, minAlto: 1500, maxAlto: 2400 },
  },
  SLIDING: {
    H98: { minAncho: 500, maxAncho: 2930, minAlto: 500, maxAlto: 2150 },
    H80: { minAncho: 500, maxAncho: 3000, minAlto: 500, maxAlto: 2150 },
  },
};

/**
 * Réplica local de validateDimensions (index.js) — NO exportada desde index.
 * Devuelve null si OK, o { message, escalate, suggest? } si excede.
 */
export function validateDimensionsLocal(product, ancho_mm, alto_mm) {
  const p = String(product || "").toUpperCase();

  if (p.includes("CORREDERA")) {
    const lim = FABRICATION_LIMITS.SLIDING.H98;
    if (ancho_mm > lim.maxAncho || alto_mm > lim.maxAlto) {
      // [2026-06-10 FIX #C/GT-06] ANTES escalate:true → grand_total=null → PDF NUNCA salía aunque
      // el cliente confirmara (correderas piso-cielo >2150mm son comunísimas; caso Dalia). Ahora
      // referencial+clamp como index.js:771 (el dueño: "las grandes cotizarlas igual, solo avisar").
      return {
        message: `La corredera de ${ancho_mm}×${alto_mm} mm supera el máximo estándar (${lim.maxAncho}×${lim.maxAlto} mm); precio referencial acotado.`,
        referencial: true, clampAncho: lim.maxAncho, clampAlto: lim.maxAlto,
      };
    }
    // [2026-07-06 LOTE2] Bajo el mínimo → REFERENCIAL clamp-UP (pedido del dueño: cotizar igual por
    // tamaño/materiales; fabricar bajo el mínimo cuesta lo mismo que el mínimo). NUNCA escalate (GT-06).
    if (ancho_mm < lim.minAncho || alto_mm < lim.minAlto) {
      return {
        message: `La corredera de ${ancho_mm}×${alto_mm} mm está bajo el mínimo estándar (${lim.minAncho}×${lim.minAlto} mm); precio referencial del mínimo de fabricación.`,
        referencial: true,
        clampMinAncho: ancho_mm < lim.minAncho ? lim.minAncho : 0,
        clampMinAlto: alto_mm < lim.minAlto ? lim.minAlto : 0,
      };
    }
    return null;
  }

  if (p.includes("PUERTA")) {
    const lim = FABRICATION_LIMITS.S60.puerta;
    if (ancho_mm > lim.maxAncho || alto_mm > lim.maxAlto) {
      // [2026-06-10 FIX #C] alinear con index.js:781 — referencial+clamp en vez de escalate.
      return {
        message: `La puerta de ${ancho_mm}×${alto_mm} mm supera el máximo estándar (${lim.maxAncho}×${lim.maxAlto} mm); precio referencial acotado.`,
        referencial: true, clampAncho: lim.maxAncho, clampAlto: lim.maxAlto,
      };
    }
    // [2026-07-06 LOTE2] Puerta bajo mínimo (800×1500): mismo criterio referencial clamp-up. El PDF
    // muestra la medida pedida (measures_original) y el precio referencial se valida en visita técnica.
    if (ancho_mm < lim.minAncho || alto_mm < lim.minAlto) {
      return {
        message: `La puerta de ${ancho_mm}×${alto_mm} mm está bajo el mínimo estándar (${lim.minAncho}×${lim.minAlto} mm); precio referencial del mínimo de fabricación.`,
        referencial: true,
        clampMinAncho: ancho_mm < lim.minAncho ? lim.minAncho : 0,
        clampMinAlto: alto_mm < lim.minAlto ? lim.minAlto : 0,
      };
    }
    return null;
  }

  const lim = FABRICATION_LIMITS.S60.ventana;
  if (ancho_mm > lim.maxAncho || alto_mm > lim.maxAlto) {
    const slidingLim = FABRICATION_LIMITS.SLIDING.H98;
    if (ancho_mm <= slidingLim.maxAncho && alto_mm <= slidingLim.maxAlto) {
      return {
        message: `Medida ${ancho_mm}×${alto_mm} excede límite S60 (máx ${lim.maxAncho}×${lim.maxAlto}). Sugerencia: ventana corredera.`,
        suggest: "CORREDERA",
        escalate: false,
      };
    }
    return {
      message: `Medida ${ancho_mm}×${alto_mm} excede todos los límites de fabricación.`,
      escalate: true,
    };
  }
  // [2026-07-06 LOTE2] Ventana bajo el mínimo S60 (400×400) → REFERENCIAL clamp-UP y COTIZAR (caso real:
  // proyectante de baño 350×600 confirmada en mm era RECHAZADA; el dueño ordenó cotizar igual el valor
  // que corresponde por materiales = el del mínimo de fabricación). NUNCA escalate (regresión GT-06).
  if (ancho_mm < lim.minAncho || alto_mm < lim.minAlto) {
    return {
      message: `La ventana de ${ancho_mm}×${alto_mm} mm está bajo el mínimo estándar (${lim.minAncho}×${lim.minAlto} mm); precio referencial del mínimo de fabricación.`,
      referencial: true,
      clampMinAncho: ancho_mm < lim.minAncho ? lim.minAncho : 0,
      clampMinAlto: alto_mm < lim.minAlto ? lim.minAlto : 0,
    };
  }
  return null;
}

/**
 * Cotiza todos los items vía ACTIVA Engine.
 * Mismo contrato de retorno que priceAll de index.js.
 *
 * @param {object} d - sesión { items, comuna, default_color, ... }
 * @param {string} [customer_id]
 * @returns {Promise<{ok:boolean,total?:number,source?:string,escalate:boolean,reason?:string,error?:string,partial?:boolean}>}
 */
export async function priceAllEngine(d, customer_id = "") {
  if (!d || !Array.isArray(d.items) || d.items.length === 0) {
    return { ok: false, error: "No hay items para cotizar.", escalate: false };
  }

  let grandTotal = 0;
  let escaladas = 0;

  // ── PRE-PASS: orientación GLOBAL de las medidas (regla del dueño 2026-06-06) ──
  // El cliente manda TODA la lista en el MISMO orden (alto×ancho o ancho×alto), no mezclado.
  // Regla física: el ALTO de una ventana ≤ ~2400 mm (techo piso-cielo 2,4 m). Si CUALQUIER
  // item quedó con alto > 2400 mm, TODA la tabla vino alto×ancho → se intercambia ANCHO/ALTO
  // en TODOS los items (consistente, no solo en algunos). Así "210/270, 150/185, 50/190..."
  // se corrige completa (V16 50/190 → ancho 1900/alto 500), no solo las grandes.
  const measured = d.items.map((it) => normMeasuresLocal(it.measures || ""));
  const tableIsAltoAncho = measured.some((mm) => mm && mm.alto_mm > 2400);
  if (tableIsAltoAncho) {
    for (const mm of measured) {
      if (mm) { const _t = mm.ancho_mm; mm.ancho_mm = mm.alto_mm; mm.alto_mm = _t; }
    }
  }

  // [2026-06-10] FIX pedidos grandes (18 ventanas): cotizar cada ítem es INDEPENDIENTE y
  // TOLERANTE a fallo. ANTES: si UN ítem fallaba (timeout/engine/total inválido) se hacía
  // `return` y se perdía TODA la cotización. AHORA: un ítem que falla se marca como escalada
  // y NO mata al resto. Además se cotiza con CONCURRENCIA ACOTADA (lotes) para no encadenar
  // 18 latencias en serie. La reducción (suma) se hace después, secuencial → sin race.
  const priceOneItem = async (i) => {
    const item = d.items[i];

    // 0) Alcance real del catálogo automático. Esta guarda corre ANTES de
    // normalizar apertura, validar medidas o llamar al Engine: nunca convierte
    // silenciosamente un producto desconocido en una ventana CORREDERA.
    // [Ronda 2 2026-07-20] item.descripcion = palabras LITERALES del cliente (llegan del
    // tool vía descripcion_producto). Sin esto la guarda solo veía el enum ya colapsado
    // (CORREDERA/...) y era inalcanzable para mosquitero/plegable/forma irregular/líneas
    // en el camino GPT (hallazgo confirmado por revisión cruzada Codex+workflow).
    const fueraDeAlcance = detectarProductoFueraDeAlcance(
      [item.product, item.descripcion].filter(Boolean).join(' '),
      { tipo: item.tipo, serie: item.serie }
    );
    if (fueraDeAlcance.fueraDeAlcance) {
      item.price_warning = fueraDeAlcance.mensajeCliente;
      item.source = "activa_engine";
      item.confidence = "manual";
      item.out_of_scope_category = fueraDeAlcance.categoria;
      return { escalada: true, fueraDeAlcance };
    }

    // 1) Medidas (normalizadas + orientación corregida en el pre-pass)
    const m = measured[i];
    if (tableIsAltoAncho && m) item.measures_swapped = true;
    if (!m) {
      item.price_warning = "No pude normalizar medidas para el cotizador.";
      item.source = "activa_engine"; item.confidence = "manual";
      return { escalada: true };
    }

    // 2a) [Ronda 3.2 — Codex] Resolver el TIPO (con cinturón de descripción) ANTES de
    // validar medidas: una puerta 900x2200 con product=CORREDERA se clampaba al máximo
    // de VENTANA (2150) y después se cotizaba como PUERTA — límites equivocados.
    let tipo = mapAperturaToEngine(item.product);
    // Cinturón asimétrico LA DESCRIPCIÓN MANDA (solo hacia puerta): si el LLM contradijo
    // el prompt (tipo de ventana + descripción "puerta abatible"), se corrige al BOM de
    // puerta. Nunca al revés (normTipoAperturaLocal ya trae negación + sustantivo-primero
    // + regla "por X" + deslizantes).
    if (item.descripcion && !String(tipo).startsWith("PUERTA")) {
      try {
        const tipoDesc = mapAperturaToEngine(item.descripcion);
        if (String(tipoDesc).startsWith("PUERTA")) tipo = tipoDesc;
      } catch { /* descripción fuera de alcance: la guarda del paso 0 ya la habría cazado */ }
    }

    // 2) Validación de fabricación (igual que priceAll → marca y escala) — con el TIPO
    // resuelto, no con el texto crudo (límites de puerta ≠ límites de ventana).
    const dim = validateDimensionsLocal(tipo, m.ancho_mm, m.alto_mm);
    if (dim && dim.escalate) {
      item.price_warning = dim.message;
      item.source = "activa_engine"; item.confidence = "manual";
      return { escalada: true };
    }
    // [2026-06-10 FIX #C/GT-06] Fuera de rango pero REFERENCIAL: acotar al máx y COTIZAR (no escalar)
    // → grand_total tiene valor → el PDF SÍ sale (antes: escalate → null → sin PDF). Marcelo valida la medida exacta.
    if (dim && dim.referencial) {
      item.referencial = true;
      item.measures_original = `${m.ancho_mm}x${m.alto_mm}`;
      item.price_warning = dim.message;
      // Acotar SOLO la dimensión que excede (Math.min) — no sobre-cotizar la que sí cabe.
      if (dim.clampAncho) m.ancho_mm = Math.min(m.ancho_mm, dim.clampAncho);
      if (dim.clampAlto)  m.alto_mm  = Math.min(m.alto_mm,  dim.clampAlto);
      // [2026-07-06 LOTE2] Bajo mínimo → clamp-UP solo en la dimensión que falta (precio del mínimo).
      if (dim.clampMinAncho) m.ancho_mm = Math.max(m.ancho_mm, dim.clampMinAncho);
      if (dim.clampMinAlto)  m.alto_mm  = Math.max(m.alto_mm,  dim.clampMinAlto);
    }

    // 3) Serie de perfiles + nº hojas (el tipo ya quedó resuelto en 2a)
    const serie = mapSerieToEngine(tipo);     // CORREDERA→SLIDING, resto→S60
    const hojas = detectHojas(item.product);  // 3 hojas → triple riel; undefined → motor decide

    // 4) Color / glass_id / comuna / cantidad
    const color = normColorLocal(item.color || d.default_color || "");
    const glass_id = pickGlassId(m.ancho_mm, m.alto_mm, item.ambiente); // por área + baño
    item.glass_label = glass_id === GLASS_BANO ? "4+12+4 satén (baño)"
                     : glass_id === GLASS_LARGE ? "5+12+5"
                     : "4+12+4";
    const comuna = d.comuna || "";
    const cantidad = Math.max(1, Number(item.qty) || 1);

    // 5) Llamada al Engine — el fallo de ESTE ítem NO mata el resto (se marca y sigue)
    let r;
    try {
      r = await calcularCotizacion({
        tipo, serie, hojas,
        ancho_mm: m.ancho_mm, alto_mm: m.alto_mm,
        color, glass_id, comuna, cantidad,
      });
    } catch (err) {
      item.price_warning = "No se pudo cotizar automáticamente (motor); lo revisa un especialista.";
      item.source = "activa_engine"; item.confidence = "manual";
      return { escalada: true };
    }

    if (!r || r.ok === false) {
      item.price_warning = (r && (r.error || r.message)) || "No se pudo cotizar automáticamente; lo revisa un especialista.";
      item.source = "activa_engine"; item.confidence = "manual";
      return { escalada: true };
    }

    // 6) Totales: usar NETO (total_clp). El flujo del bot (resumen + PDF) AGREGA
    //    IVA 19% sobre el subtotal, así que los items deben ir SIN IVA. Usar
    //    total_con_iva acá causaba doble IVA (cobrar ~19% de más). FIX.
    // [FIX 2026-06-19 COB-02] total_con_iva ELIMINADO del fallback (el comentario decía FIX pero seguía ahí). Si el motor solo da con IVA → escalar, no cobrar 19% de más.
    const lineTotal = Number(r.total_clp ?? r.total_neto_clp ?? 0);
    if (!Number.isFinite(lineTotal) || lineTotal <= 0) {
      item.price_warning = "Total inválido del motor; lo revisa un especialista.";
      item.source = "activa_engine"; item.confidence = "manual";
      return { escalada: true };
    }

    const unit = Math.round(lineTotal / cantidad);
    item.unit_price = unit;
    item.total_price = lineTotal;
    item.source = "activa_engine";
    item.confidence = "high";
    // Persistir especificación para el PDF/etiqueta (antes se perdía): serie + hoja + riel
    item.serie = serie;
    if (r.producto_label) item.producto_label = r.producto_label;
    if (r.corredera) item.corredera = r.corredera;
    if (r.termico) item.termico = r.termico; // [thermal] hoja Uw (aditivo; null en H98/sin match → no se muestra)
    if (dim && dim.suggest) item.price_warning = dim.message;

    return { lineTotal };
  };

  // Cotizar en lotes de concurrencia acotada (no 18 en serie, no 18 de golpe)
  const CONC = 6;
  const results = new Array(d.items.length);
  for (let start = 0; start < d.items.length; start += CONC) {
    const idxs = [];
    for (let i = start; i < Math.min(start + CONC, d.items.length); i++) idxs.push(i);
    const settled = await Promise.all(idxs.map((i) =>
      priceOneItem(i).catch((e) => {
        console.error("[enginePricer] item", i, "error:", e?.message || e);
        if (d.items[i]) { d.items[i].source = "activa_engine"; d.items[i].confidence = "manual"; d.items[i].price_warning = "No se pudo cotizar automáticamente; lo revisa un especialista."; }
        return { escalada: true };
      })
    ));
    settled.forEach((res, k) => { results[idxs[k]] = res; });
  }
  // Reducción secuencial (sin race con la concurrencia de arriba)
  for (const res of results) {
    if (!res || res.escalada) { escaladas++; continue; }
    if (Number.isFinite(res.lineTotal)) grandTotal += res.lineTotal;
  }

  d.grand_total = grandTotal || null;

  if (escaladas > 0) {
    const fueraDeAlcance = results.find((res) => res?.fueraDeAlcance)?.fueraDeAlcance;
    return {
      ok: false,
      error: fueraDeAlcance?.mensajeCliente || "La cotización requiere revisión de especialista.",
      partial: true,
      total: d.grand_total,
      source: "activa_engine",
      escalate: true,
      reason: fueraDeAlcance?.razon || "partial_cotization",
      ...(fueraDeAlcance ? {
        category: fueraDeAlcance.categoria,
        customer_message: fueraDeAlcance.mensajeCliente,
      } : {}),
    };
  }

  return {
    ok: true,
    total: d.grand_total,
    source: "activa_engine",
    escalate: false,
  };
}

export { DEFAULT_GLASS_ID };
