// oliverNoise.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — detector de RUIDO/MENSAJES BASURA repetidos.
//
// CASO REAL (conv e0b2a1a5): el cliente envió 119 mensajes de basura/sin-sentido.
// El bot respondió "no se entendió" 20+ veces sin jamás escalar, porque
// detectClientLoop() compara texto EXACTO — los strings de basura eran todos
// DISTINTOS entre sí, así que el contador nunca se disparaba.
//
// FIX: en vez de comparar texto exacto, este módulo detecta si un mensaje ES
// ruido/sin-sentido (cadena corta, sin vocales legibles, sin palabras reales)
// y cuenta cuántos mensajes de ese tipo llegan consecutiva o acumuladamente
// en la conversación reciente. Tras el umbral → escalar/silenciar.
//
// DISEÑO (funciones puras, sin side-effects, 100% testeables):
//   isNoise(text)            → boolean: ¿este mensaje es basura/sin-sentido?
//   detectNoiseLoop(ses, text, opts?) → boolean: ¿acumulación supera umbral?
//   noiseLoopMessage(nombre?, agente?) → string: mensaje de escalación
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

// ─── Configuración por defecto ───────────────────────────────────────────────
// Umbral: cuántos mensajes ruidosos acumulados en la ventana disparan la alarma.
export const DEFAULT_THRESHOLD = 5;
// Ventana: cuántos mensajes recientes se consideran (rolling window).
export const DEFAULT_WINDOW = 8;

// ─── Criterios de ruido ───────────────────────────────────────────────────────
// Un mensaje se considera ruido/basura si cumple ALGUNO de estos criterios:

// 1. Muy corto (< MIN_CHARS caracteres después de trim).
//    2 chars porque "sí", "ok", "no" son respuestas legítimas.
const MIN_CHARS = 2;

// 2. Sin ninguna vocal hispanohablante (imposible que sea lenguaje natural).
const VOWEL_RE = /[aeiouáéíóúüàèìòùâêîôûäëïöü]/i;

// 3. Sin ninguna letra (solo símbolos/números/emojis sueltos sin contexto).
const LETTER_RE = /[a-záéíóúñüA-ZÁÉÍÓÚÑÜ]/;

// 4. Proporción de caracteres no-alfanuméricos muy alta (>70% del total).
//    Captura "??!!??", "###$$$", ".....", etc.
function highSymbolRatio(text) {
  if (!text.length) return true;
  const alphaNum = (text.match(/[a-z0-9áéíóúñü]/gi) || []).length;
  return alphaNum / text.length < 0.30;
}

// 5. Texto compuesto por repetición del mismo carácter (aaaaa, bbbbb, 11111).
function isRepeatedChar(text) {
  return /^(.)\1{2,}$/.test(text.trim());
}

// 6. Detecta si el texto parece una medida/dimensión (ej: "1200x1000", "2300x1400 mm").
//    DEBE contener un separador (x, ×, /, *) entre números — un número solo NO es dimensión.
const DIMENSION_RE = /^\d[\d\s.]*[x×\/,*][\d\s.x×\/,*]*\d(?:\s*(?:mm|cm|m))?$/i;

/**
 * Decide si un mensaje es ruido/basura (no parseable como lenguaje natural).
 * @param {string} text
 * @returns {boolean}
 */
export function isNoise(text) {
  const t = String(text || '').trim();
  // Vacío o demasiado corto → ruido
  if (t.length < MIN_CHARS) return true;
  // Sin ninguna letra → solo dígitos/símbolos sueltos
  //   EXCEPCIÓN: si parece una dimensión compuesta (1200x1000, 2300×1400) → no es ruido.
  //   Número solo ("123456") sí es ruido — no aporta contexto parseable.
  if (!LETTER_RE.test(t)) {
    if (DIMENSION_RE.test(t)) return false; // dimensión válida
    return true;
  }
  // Si parece una expresión de dimensión (letras solo como separador "x") → no es ruido
  if (DIMENSION_RE.test(t)) return false;
  // Sin ninguna vocal → ruido (consonantes puras: "brrt", "xzkqp", etc.)
  if (!VOWEL_RE.test(t)) return true;
  // Alta proporción de símbolos → ruido
  if (highSymbolRatio(t)) return true;
  // Repetición de un solo carácter → ruido
  if (isRepeatedChar(t)) return true;
  return false;
}

// ─── Estado de sesión ─────────────────────────────────────────────────────────
// Se almacena en ses.noiseWindow: array de booleans (true = ruidoso, false = legible)
// mantenido como rolling window de tamaño DEFAULT_WINDOW.
// Reseteado cuando llega un mensaje legible O cuando se dispara la escalación.

/**
 * Registra el mensaje en la ventana de ruido de la sesión y decide si se
 * debe escalar. NO produce side-effects fuera de ses.noiseWindow.
 *
 * @param {Object} ses   - objeto sesión (mutado: ses.noiseWindow)
 * @param {string} text  - mensaje del cliente
 * @param {Object} [opts]
 * @param {number} [opts.threshold=DEFAULT_THRESHOLD] - mensajes ruidosos para disparar
 * @param {number} [opts.window=DEFAULT_WINDOW]       - tamaño de ventana rolling
 * @returns {boolean} true si se superó el umbral de ruido → escalar
 */
export function detectNoiseLoop(ses, text, opts = {}) {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const windowSize = opts.window ?? DEFAULT_WINDOW;

  ses.noiseWindow = ses.noiseWindow || [];

  const noisy = isNoise(text);
  ses.noiseWindow.push(noisy);

  // Mantener tamaño de ventana
  if (ses.noiseWindow.length > windowSize) ses.noiseWindow.shift();

  // Contar cuántos mensajes ruidosos hay en la ventana actual
  const noisyCount = ses.noiseWindow.filter(Boolean).length;

  if (noisyCount >= threshold) {
    // Resetear para no re-disparar en el siguiente mensaje inmediato
    ses.noiseWindow = [];
    return true;
  }

  // Si llegó un mensaje legible, no se resetea la ventana completa (queremos
  // detectar patrones mixtos), pero sí aclaramos: el umbral solo cuenta el
  // acumulado de ruidosos, un mensaje legible no resetea el historial.
  return false;
}

/**
 * Mensaje de escalación para el cliente (tono amable, no acusa al usuario).
 * @param {string} [nombre='']  - nombre del cliente (sin coma ni espacio inicial)
 * @param {string} [agente='Marcelo Cifuentes']
 * @returns {string}
 */
export function noiseLoopMessage(nombre = '', agente = 'Marcelo Cifuentes') {
  const saludo = nombre ? `, ${nombre}` : '';
  return `Disculpá${saludo}, parece que hay algún problema con los mensajes que me están llegando. Para que no pierdas tiempo, te conecto directo con ${agente}. ¿A qué hora te queda bien que te llame hoy?`;
}
