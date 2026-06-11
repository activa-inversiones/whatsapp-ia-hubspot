// oliverVision.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — detección de IMAGEN ILEGIBLE (gap G2, auditoría 2026-06-10).
//
// BUG QUE RESUELVE: cuando el cliente manda una foto y la visión (gpt-4o) NO logra
// extraer productos (devuelve un rechazo tipo "Lo siento, no puedo identificar..."
// o texto vago), index.js igual lo enmarcaba como
//   "[IMAGEN ANALIZADA — Productos detectados]: <basura>"
// → el orquestador lo trataba como productos reales y Oliver respondía
//   "✅ Recibí tus medidas. Gracias!"  ← MENTIRA: no recibió nada.
// El cliente cree que ya tiene la info cargada, las medidas reales se pierden, y
// la cotización sale mal o nunca sale. (Casos reales: 096cd370, b01170ca.)
//
// FIX: isVisionUnreadable(ext) decide si el texto que devolvió la visión es un
// fracaso de lectura (rechazo, vacío, o no se parece a una lista de productos).
// Si lo es → el caller marca la imagen como "[Imagen no legible]" y pide al cliente
// que ESCRIBA las medidas, en vez de confirmar en falso.
//
// REGLA DE ORO: NO confirmar datos que no se tienen (anti-alucinación).
// Módulo PURO: sin red, sin estado. 100% testeable.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

// Frases que delatan que la visión NO leyó productos (rechazo / disculpa / vaguedad).
// Se comparan en minúsculas. NO incluir "no especificado": ese token es VÁLIDO
// (la visión lo usa para un campo faltante dentro de una fila real de producto).
const REFUSAL_PATTERNS = [
  'no puedo', 'no pude', 'no logro', 'no logré', 'no identific', 'no reconoz',
  'no se puede', 'no es posible', 'no aparece', 'no se distingue', 'no se ve',
  'no alcanzo a', 'no contiene', 'no hay productos', 'no hay ventanas',
  'ninguna ventana', 'ningún producto', 'imagen borrosa', 'está borrosa',
  'lo siento', 'disculpa', 'unable', "can't", 'cannot', "i'm sorry", 'sorry',
  'as an ai', 'no information', 'cannot identify', 'unable to',
];

/**
 * ¿El texto que devolvió la visión indica que NO se leyeron productos?
 * @param {string} ext  Salida cruda de vision() (puede ser vacía).
 * @returns {boolean}  true = ilegible / sin productos → NO confirmar medidas.
 */
export function isVisionUnreadable(ext) {
  const t = String(ext || '').trim().toLowerCase();

  // 1. Vacío → ilegible.
  if (!t) return true;

  // 2. Frase de rechazo/disculpa → ilegible.
  if (REFUSAL_PATTERNS.some((p) => t.includes(p))) return true;

  // 3. Estructural: una lista de productos real trae AL MENOS una medida
  //    (1234x1000, 210/270, 120×60) o el separador de columnas "|". Si no tiene
  //    ninguna de las dos, no se parece a una extracción válida → ilegible.
  const hasMeasure = /\d{2,4}\s*[x×\/]\s*\d{2,4}/.test(t);
  const hasPipe = t.includes('|');
  if (!hasMeasure && !hasPipe) return true;

  return false;
}

/**
 * Mensaje honesto cuando la imagen no se pudo leer: NO confirma medidas,
 * pide que las escriba. Tono cálido, no culpa al cliente.
 * @param {string} [nombre='']
 * @returns {string}
 */
export function imageUnreadableMessage(nombre = '') {
  const saludo = nombre ? ` ${String(nombre).trim()}` : '';
  return `Uy${saludo}, no pude leer bien la imagen 😅. ¿Me escribís las medidas (ancho × alto, en mm o cm) y la cantidad de cada ventana? Con eso te preparo la cotización al toque.`;
}
