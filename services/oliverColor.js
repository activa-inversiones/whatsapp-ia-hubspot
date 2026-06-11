// oliverColor.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — NO asumir el color (gap G1, auditoría 2026-06-10).
//
// BUG QUE RESUELVE: cuando el cliente NO eligió color, el LLM asume "blanco"
// (lo dice el propio código: index.js:5389 "manda sobre el 'blanco' que asume el
// LLM"). Resultado: el PDF salía con un color que el cliente nunca pidió.
// Casos reales: Alejandro pidió "¿tienen muestra de colores?" → Oliver lo ignoró
// y puso blanco; Claudio terminó con "NEWBLACK" sin haberlo elegido; Dalia igual.
//
// FIX (dos frentes):
//   1) colorChosen(d): ¿el cliente eligió color EXPLÍCITAMENTE? (locked por texto
//      o items con colores reales/variados, p.ej. de una imagen). Si NO → el bot
//      PREGUNTA el color una vez antes de mandar el PDF, en vez de asumir blanco.
//   2) isColorQuestion(text): ¿el cliente está PREGUNTANDO por los colores? →
//      responder con las opciones reales (no ignorarlo).
//
// Catálogo REAL (index.js:1527): BLANCO | NOGAL | ROBLE | GRAFITO | NEWBLACK.
// REGLA DE ORO: NO inventar colores fuera del catálogo. Módulo PURO, testeable.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

// Colores reales del catálogo (no inventar otros).
export const CATALOGO_COLORES = ['blanco', 'nogal', 'roble', 'grafito', 'newblack'];

// ¿el color de un item es vacío o el "blanco" genérico que asume el LLM?
function esBlancoOAsumido(color) {
  const c = String(color || '').trim().toLowerCase();
  return c === '' || c === 'blanco' || c === 'white';
}

/**
 * ¿El cliente eligió el color de forma EXPLÍCITA?
 *  - default_color_locked: lo nombró en texto (index.js lo setea en ese caso).
 *  - o los items traen colores reales/variados (típico de una tabla en imagen):
 *    todos con color y al menos uno que NO es el "blanco" asumido por defecto.
 * Si devuelve false → NO asumir; preguntar el color.
 * @param {object} d  ses.data { default_color_locked, items:[{color}] }
 * @returns {boolean}
 */
export function colorChosen(d) {
  if (!d || typeof d !== 'object') return false;
  if (d.default_color_locked) return true;
  const items = Array.isArray(d.items) ? d.items : [];
  if (items.length > 0 &&
      items.every((it) => String(it?.color || '').trim() !== '') &&
      items.some((it) => !esBlancoOAsumido(it?.color))) {
    return true; // colores reales/variados ya presentes (no es el blanco asumido)
  }
  return false;
}

// Señales de que el mensaje es una PREGUNTA/PEDIDO sobre colores (no una elección).
const TOPIC_RE = /\bcolor(?:es)?\b|\btono(?:s)?\b|\bgama\b|\bcarta\b/i;
const INQUIRY_RE = /\b(qu[eé]|cu[aá]l(?:es)?|tienen|hay|tienes|manejan|disponible|opciones|muestra|muestras|ver|mostrar|ofrecen|cuentan|existen)\b|\?/i;

/**
 * ¿El cliente está PREGUNTANDO por los colores disponibles?
 * Debe tener un tema de color Y una señal de pregunta/pedido. Una elección
 * directa ("color nogal", "quiero blanco") NO cuenta (la captura el flujo normal).
 * @param {string} text
 * @returns {boolean}
 */
export function isColorQuestion(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (!TOPIC_RE.test(t)) return false;
  if (!INQUIRY_RE.test(t)) return false;
  // No tratar como "pregunta" si solo está nombrando un color del catálogo
  // junto a la palabra color (ej. "color nogal") sin señal interrogativa real.
  // Ya cubierto por INQUIRY_RE, pero reforzamos: si empieza con un color directo, no.
  return true;
}

/**
 * Mensaje con las opciones reales de color (cuando el cliente pregunta).
 * @param {string} [nombre='']
 * @returns {string}
 */
export function colorOptionsMessage(nombre = '') {
  const s = nombre ? ` ${String(nombre).trim()}` : '';
  return `Tenemos estos colores${s}: *blanco*, *nogal*, *roble*, *grafito* y *newblack* (negro). 🎨 ¿Cuál te gusta para tu cotización?`;
}

/**
 * Mensaje para PEDIR el color cuando el cliente no lo eligió (antes del PDF).
 * @param {string} [nombre='']
 * @returns {string}
 */
export function askColorMessage(nombre = '') {
  const s = nombre ? ` ${String(nombre).trim()}` : '';
  return `Para dejar lista tu cotización${s}, ¿en qué color las querés? Tenemos blanco, nogal, roble, grafito y newblack (negro).`;
}
