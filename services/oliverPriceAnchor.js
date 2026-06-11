// oliverPriceAnchor.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — ancla de VALOR cuando preguntan precio sin dar medidas (G11).
//
// CONTEXTO (auditoría 2026-06-10, caso 47bc6a3c): el cliente pregunta "¿cuánto
// vale?" / "cada ventana?" SIN dar medidas. Oliver solo pedía medidas en seco y
// el lead se enfriaba. Conviene RETENER con valor + pedir el único dato que falta.
//
// REGLA DE ORO (CLAUDE.md anti-alucinación): JAMÁS inventar un número de precio.
// Este módulo NO da cifras — ancla en VALOR (cotización exacta y rápida) y pide
// la medida, que es el dato que destraba la cotización real del motor.
// Módulo PURO, testeable.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

// Pregunta por precio (sin necesariamente dar medidas).
const PRICE_RE = /\b(cu[aá]nto|precio|vale|cuesta|valor|costo|sale|presupuesto|tarifa)\b/i;
// Una medida en el texto (1234x1000, 120x60, 1,5x1,5, 210/270). Si la trae, NO es
// "pregunta sin medidas" → que siga al flujo de cotización normal.
const MEASURE_RE = /\d{1,4}\s*[.,]?\d{0,3}\s*[x×\/]\s*\d{1,4}/i;

/**
 * ¿El cliente pregunta por PRECIO pero SIN dar medidas?
 * @param {string} text
 * @returns {boolean}
 */
export function isPriceQuestionWithoutMeasures(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (!PRICE_RE.test(t)) return false;
  if (MEASURE_RE.test(t)) return false; // trae medida → al flujo de cotización
  return true;
}

/**
 * Mensaje ancla: NO da número (anti-alucinación), ancla en valor y pide la medida.
 * @param {string} [nombre='']
 * @returns {string}
 */
export function priceAnchorMessage(nombre = '') {
  const s = nombre ? ` ${String(nombre).trim()}` : '';
  return `El valor depende de la medida, el tipo de ventana y el color${s}, así que no te tiro un número al aire. 🙂 Pero te lo dejo EXACTO en minutos: pasame el *ancho × alto* (en mm o cm) y cuántas ventanas, y te armo la cotización formal hoy.`;
}
