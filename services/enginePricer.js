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
 * Devuelve la familia coloquial; luego se mapea al enum del Engine.
 */
function normTipoAperturaLocal(text) {
  const t = String(text || "").toLowerCase();
  if (t.includes("abatible") || t.includes("abatir")) return "ABATIBLE";
  if (t.includes("oscilobatiente") || t.includes("oscilo")) return "OSCILOBATIENTE";
  if (t.includes("proyectante") || t.includes("proy")) return "PROYECTANTE";
  if (t.includes("fijo") || t.includes("marco fijo")) return "FIJO";
  if (t.includes("corredera") || t.includes("sliding")) return "CORREDERA";
  if (t.includes("basculante")) return "BASCULANTE";
  if (t.includes("plegable")) return "PLEGABLE";
  return "CORREDERA"; // más común
}

/**
 * Mapea el producto del item a una APERTURA válida del Engine.
 * default CORREDERA si no se reconoce; NUNCA TERMOPANEL.
 * @param {string} product
 * @returns {'CORREDERA'|'PROYECTANTE'|'FIJA'|'BATIENTE'|'OSCILOBATIENTE'}
 */
export function mapAperturaToEngine(product) {
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
    // BASCULANTE, PLEGABLE y cualquier otro → default seguro
    default:
      return "CORREDERA";
  }
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
function normMeasuresLocal(raw) {
  const s = String(raw || "");

  const dimMatch =
    s.match(/(\d+([.,]\d+)?)\s*[x×X]\s*(\d+([.,]\d+)?)/) ||
    s.match(/(\d+([.,]\d+)?)\s+por\s+(\d+([.,]\d+)?)/i);

  if (dimMatch) {
    let a = parseFloat(dimMatch[1].replace(",", "."));
    let b = parseFloat(dimMatch[3].replace(",", "."));
    if (a <= 6) a *= 1000;
    if (b <= 6) b *= 1000;
    if (a >= 7 && a <= 300) a *= 10;
    if (b >= 7 && b <= 300) b *= 10;
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
  if (a >= 7 && a <= 300) a *= 10;
  if (b >= 7 && b <= 300) b *= 10;
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
function validateDimensionsLocal(product, ancho_mm, alto_mm) {
  const p = String(product || "").toUpperCase();

  if (p.includes("CORREDERA")) {
    const lim = FABRICATION_LIMITS.SLIDING.H98;
    if (ancho_mm > lim.maxAncho || alto_mm > lim.maxAlto) {
      return {
        message: `Corredera ${ancho_mm}×${alto_mm} excede límite fabricación (máx ${lim.maxAncho}×${lim.maxAlto}).`,
        escalate: true,
      };
    }
    return null;
  }

  if (p.includes("PUERTA")) {
    const lim = FABRICATION_LIMITS.S60.puerta;
    if (ancho_mm > lim.maxAncho || alto_mm > lim.maxAlto) {
      return {
        message: `Puerta ${ancho_mm}×${alto_mm} excede límite (máx ${lim.maxAncho}×${lim.maxAlto}).`,
        escalate: true,
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

  for (let i = 0; i < d.items.length; i++) {
    const item = d.items[i];

    // 1) Medidas (normalizadas + orientación corregida en el pre-pass)
    const m = measured[i];
    if (tableIsAltoAncho && m) item.measures_swapped = true;
    if (!m) {
      item.price_warning = "No pude normalizar medidas para el cotizador.";
      item.source = "activa_engine";
      item.confidence = "manual";
      escaladas++;
      continue;
    }

    // 2) Validación de fabricación (igual que priceAll → marca y escala)
    const dim = validateDimensionsLocal(item.product, m.ancho_mm, m.alto_mm);
    if (dim && dim.escalate) {
      item.price_warning = dim.message;
      item.source = "activa_engine";
      item.confidence = "manual";
      escaladas++;
      continue;
    }

    // 3) Mapeo de apertura (NUNCA TERMOPANEL)
    const tipo = mapAperturaToEngine(item.product);

    // 4) Color / glass_id / comuna / cantidad
    const color = normColorLocal(item.color || d.default_color || "");
    const glass_id = pickGlassId(m.ancho_mm, m.alto_mm, item.ambiente); // por área + baño
    item.glass_label = glass_id === GLASS_BANO ? "4+12+4 satén (baño)"
                     : glass_id === GLASS_LARGE ? "5+12+5"
                     : "4+12+4";
    const comuna = d.comuna || "";
    const cantidad = Math.max(1, Number(item.qty) || 1);

    // 5) Llamada al Engine
    let r;
    try {
      r = await calcularCotizacion({
        tipo,
        ancho_mm: m.ancho_mm,
        alto_mm: m.alto_mm,
        color,
        glass_id,
        comuna,
        cantidad,
      });
    } catch (err) {
      const isTimeout = /abort|timeout|red al llamar/i.test(String(err?.message || ""));
      return {
        ok: false,
        error: err?.message || "ACTIVA Engine no disponible.",
        escalate: true,
        reason: isTimeout ? "engine_timeout" : "engine_error",
      };
    }

    if (!r || r.ok === false) {
      return {
        ok: false,
        error: (r && (r.error || r.message)) || "ACTIVA Engine no disponible.",
        escalate: true,
        reason: "engine_error",
      };
    }

    // 6) Totales: usar NETO (total_clp). El flujo del bot (resumen + PDF) AGREGA
    //    IVA 19% sobre el subtotal, así que los items deben ir SIN IVA. Usar
    //    total_con_iva acá causaba doble IVA (cobrar ~19% de más). FIX.
    const lineTotal = Number(r.total_clp ?? r.total_neto_clp ?? r.total_con_iva ?? 0);
    if (!Number.isFinite(lineTotal) || lineTotal <= 0) {
      return {
        ok: false,
        error: "ACTIVA Engine devolvió un total inválido.",
        escalate: true,
        reason: "engine_invalid_total",
      };
    }

    const unit = Math.round(lineTotal / cantidad);
    item.unit_price = unit;
    item.total_price = lineTotal;
    item.source = "activa_engine";
    item.confidence = "high";
    if (dim && dim.suggest) {
      item.price_warning = dim.message;
    }

    grandTotal += lineTotal;
  }

  d.grand_total = grandTotal || null;

  if (escaladas > 0) {
    return {
      ok: false,
      error: "La cotización requiere revisión de especialista.",
      partial: true,
      total: d.grand_total,
      source: "activa_engine",
      escalate: true,
      reason: "partial_cotization",
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
