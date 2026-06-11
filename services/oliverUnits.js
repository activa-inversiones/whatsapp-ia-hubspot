// oliverUnits.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — NO asumir unidades de medida (gap G6, auditoría 2026-06-10).
//
// BUG QUE RESUELVE: el cliente manda medidas ambiguas ("150x150", "8 cm de ancho")
// y Oliver las acepta sin validar → error de 10× en la cotización (plata real).
//
// Casos reales capturados:
//   • "150x150" → Oliver cotizaba 150mm×150mm (ventana de 15cm, absurdo).
//     Debió interpretar 150cm×150cm = 1500mm×1500mm.
//   • "8 cm ancho por 1.80 de alto" → 8cm de ancho es físicamente imposible
//     para cualquier ventana (un marco PVC tiene al menos 30cm de base).
//
// El bot trabaja internamente en MILÍMETROS (mm).
// Rangos reales de fabricación:
//   S60 ventana : 400–1930 ancho / 400–1930 alto
//   Corredera   : 500–2930 ancho / 500–2150 alto
//   Puerta      : 800–1970 ancho / 1500–2400 alto
//   → Una medida plausible parte desde ~300mm; bajo 100mm es físicamente imposible.
//
// LÓGICA (isMeasureSuspicious):
//   absurd     : algún lado < VENTANA_ABSURDO_MM (100mm) → imposible físico.
//   suspicious : algún lado < VENTANA_MIN_MM (300mm) pero no absurdo
//                → probable confusión cm/mm (el cliente escribió cm sin aclarar).
//   normal     : ambos lados ≥ VENTANA_MIN_MM → plausible.
//
// Módulo PURO, testeable. ESM, Node 18+.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

/** Bajo este valor (mm) la medida es SOSPECHOSA: probable cm escrito como mm. */
export const VENTANA_MIN_MM = 300;

/** Bajo este valor (mm) la medida es ABSURDA: físicamente imposible como ventana. */
export const VENTANA_ABSURDO_MM = 100;

/**
 * ¿La medida (en mm) es sospechosa o absurda?
 *
 * - Si algún lado < VENTANA_ABSURDO_MM → absurd:true (imposible).
 * - Si algún lado < VENTANA_MIN_MM pero ≥ VENTANA_ABSURDO_MM → suspicious:true
 *   (probable confusión cm/mm).
 * - Si ambos lados ≥ VENTANA_MIN_MM → suspicious:false, absurd:false.
 *
 * @param {number|string} ancho_mm  Ancho en milímetros.
 * @param {number|string} alto_mm   Alto en milímetros.
 * @returns {{ suspicious: boolean, absurd: boolean, reason: string }}
 */
export function isMeasureSuspicious(ancho_mm, alto_mm) {
  const a = Number(ancho_mm);
  const b = Number(alto_mm);

  // Detectar cuál(es) son problemáticas para la reason
  const aAbsurd = a < VENTANA_ABSURDO_MM;
  const bAbsurd = b < VENTANA_ABSURDO_MM;

  if (aAbsurd || bAbsurd) {
    const partes = [];
    if (aAbsurd) partes.push(`ancho ${a}mm`);
    if (bAbsurd) partes.push(`alto ${b}mm`);
    return {
      suspicious: false,
      absurd: true,
      reason: `${partes.join(' y ')} ${partes.length > 1 ? 'son imposibles' : 'es imposible'} para una ventana (mínimo ~${VENTANA_MIN_MM}mm por lado).`,
    };
  }

  const aSusp = a < VENTANA_MIN_MM;
  const bSusp = b < VENTANA_MIN_MM;

  if (aSusp || bSusp) {
    const partes = [];
    if (aSusp) partes.push(`ancho ${a}mm`);
    if (bSusp) partes.push(`alto ${b}mm`);
    return {
      suspicious: true,
      absurd: false,
      reason: `${partes.join(' y ')} ${partes.length > 1 ? 'parecen' : 'parece'} estar en centímetros (una ventana real mide al menos ${VENTANA_MIN_MM}mm por lado).`,
    };
  }

  return {
    suspicious: false,
    absurd: false,
    reason: '',
  };
}

// ── Heurísticas para looksLikeUnitAmbiguous ──────────────────────────────────
//
// Detección de patrones tipo "150x150", "60x80", "150 x 150" SIN unidad explícita
// Y con números en el rango [10, 300) donde cm y mm se confunden.
//
// NO dispara si:
//   - El texto trae "mm", "cm" o "m" (unidad explícita).
//   - Los números son ≥ 400 (claramente mm; no hay ambigüedad).
//   - Hay decimales con coma tipo "1,50" (claramente metros).
//
// Regex de medida sin unidad: dos números separados por "x" / "×" / " x ".
const DIM_RE = /\b(\d{1,4})\s*[x×]\s*(\d{1,4})\b/i;
// Unidad explícita presente en el texto
const UNIT_RE = /\b(mm|cm|m)\b/i;
// Decimal con coma → metros (ej. "1,50x1,80")
const DECIMAL_COMA_RE = /\d+,\d+/;

/**
 * ¿El texto contiene una medida tipo "150x150" que parece ambigua cm/mm?
 *
 * Devuelve true si:
 *   - Hay un par "NxN" SIN unidad explícita (mm/cm/m).
 *   - Ambos números están en [10, 300) → rango de confusión cm/mm.
 *
 * Devuelve false si:
 *   - Hay unidad explícita en el texto ("150x150 mm", "60x80 cm").
 *   - Los números son ≥ 400 (claramente mm; "1200x1000" no es ambiguo).
 *   - El texto trae decimales con coma ("1,50x1,50" → metros obvios).
 *   - No hay ningún patrón NxN ("quiero 3 ventanas").
 *
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeUnitAmbiguous(text) {
  const t = String(text || '').trim();
  if (!t) return false;

  // Unidad explícita → no ambiguo
  if (UNIT_RE.test(t)) return false;

  // Decimal con coma → probablemente metros, no ambiguo
  if (DECIMAL_COMA_RE.test(t)) return false;

  // Buscar par NxN
  const m = DIM_RE.exec(t);
  if (!m) return false;

  const n1 = Number(m[1]);
  const n2 = Number(m[2]);

  // Ambos deben estar en [10, 300) para considerar que hay ambigüedad
  const enRango = (n) => n >= 10 && n < 300;
  if (!enRango(n1) || !enRango(n2)) return false;

  return true;
}

/**
 * Pregunta amable al cliente para que confirme si sus medidas son en cm o mm.
 * No culpa al cliente; cita el motivo (no equivocarse en la cotización).
 *
 * @param {string} [detail='']  Detalle adicional opcional (ej. "60×80").
 * @returns {string}
 */
export function askUnitsMessage(detail = '') {
  const d = detail ? ` (${String(detail).trim()})` : '';
  return `Para no equivocarme en la cotización, esas medidas${d} ¿son en centímetros o milímetros?`;
}
