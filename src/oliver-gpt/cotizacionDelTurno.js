// cotizacionDelTurno.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver GPT — DTO canónico de la cotización de un turno.
//
// BUG QUE RESUELVE (cazado por Codex en el tridente del 15-sep-2026, y
// reproducido en el código):
//   · la tool devuelve  `total_neto`            (tools.js:851)
//   · el draft leía     `quote.total || quote.grand_total`  (webhook.js:4656)
//   ⇒ `amount_total` salía NULL SIEMPRE.
// Medido en producción: 90 de 164 filas de `quotes` de la semana (55 %) quedaron
// en `status='draft'` con `quote_number`, `amount_total` y `total_clp` en NULL.
// El informe del 15-sep las llamó "basura de tabla". No lo eran: eran el síntoma
// de un contrato roto entre `tools.js` y `webhook.js`.
//
// POR QUÉ EL TEST NO LO CAZÓ: `webhook.test.js:238,247` no alimenta el evento con
// el retorno real de `runTool`, sino con un fixture inventado `{total:321593}`.
// Un test que inventa la forma del dato no prueba el contrato: lo esconde. Por eso
// este módulo trae un contract test alimentado con la forma REAL de la tool.
//
// SEGUNDO DEFECTO, del mismo sitio: `extractQuote` devolvía SOLO la primera
// cotización del turno (webhook.js:684,692). En un pedido de varias ventanas —el
// caso normal— el monto quedaba parcial aunque el campo no fuera NULL. Este módulo
// AGREGA todas las cotizaciones del turno.
//
// MÓDULO PURO, sin I/O, testeable.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

/** Tools que producen precio. Cualquier otra no aporta monto. */
const TOOLS_DE_PRECIO = new Set(['calcular_cotizacion', 'calcular_por_area']);

/**
 * Campos de monto TOTAL de un ítem, en orden de preferencia.
 * `total_neto` es el que devuelve la tool real hoy (tools.js:851). Los otros dos
 * se aceptan por si otra tool o una versión futura los usa: preferir un nombre y
 * tolerar los demás es lo que evita que este mismo bug vuelva con otro campo.
 * NO se incluye `unit_price`: es el precio UNITARIO y sumarlo subcotiza.
 */
const CAMPOS_TOTAL = ['total_neto', 'total_price', 'total', 'grand_total'];

function numeroValido(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Monto total de UN resultado de tool, o null si no trae ninguno reconocible. */
export function montoDeResultado(result) {
  if (!result || typeof result !== 'object') return null;
  for (const campo of CAMPOS_TOTAL) {
    const n = numeroValido(result[campo]);
    if (n !== null) return n;
  }
  // Último recurso: unitario × cantidad. Explícito, nunca silencioso.
  const unit = numeroValido(result.unit_price);
  if (unit !== null) {
    const qty = Number(result.cantidad ?? result.qty ?? 1);
    return unit * (Number.isFinite(qty) && qty > 0 ? qty : 1);
  }
  return null;
}

/**
 * Agrega TODAS las cotizaciones de un turno en un DTO canónico.
 *
 * @param {Array<{name?: string, result?: object}>} toolCalls
 * @returns {null | {
 *   items: object[],          // los results de precio del turno, en orden
 *   amount_total: number|null,// suma de los totales; null si ninguno trajo monto
 *   sin_monto: number,        // cuántos ítems no trajeron monto reconocible
 *   parcial: boolean          // true si al menos un ítem quedó sin monto
 * }}
 * Devuelve `null` cuando el turno no cotizó nada (no es lo mismo que cotizar $0).
 */
export function agregarCotizacionDelTurno(toolCalls = []) {
  if (!Array.isArray(toolCalls)) return null;

  const items = [];
  let suma = 0;
  let conMonto = 0;
  let sinMonto = 0;

  for (const tc of toolCalls) {
    if (!tc || !TOOLS_DE_PRECIO.has(tc.name)) continue;
    const r = tc.result;
    if (!r || r.ok === false) continue;

    items.push(r);
    const monto = montoDeResultado(r);
    if (monto === null) sinMonto++;
    else { suma += monto; conMonto++; }
  }

  if (items.length === 0) return null;

  return {
    items,
    amount_total: conMonto > 0 ? Math.round(suma) : null,
    sin_monto: sinMonto,
    parcial: sinMonto > 0,
  };
}

/**
 * ¿Este DTO merece persistirse como cotización con monto?
 * Un draft sin monto NO es un error de datos a esconder con un TTL: es señal de
 * que el contrato con la tool se rompió otra vez. Quien llame debe loguearlo.
 */
export function tieneMontoUtil(dto) {
  return !!dto && typeof dto.amount_total === 'number' && dto.amount_total > 0;
}

export default agregarCotizacionDelTurno;
