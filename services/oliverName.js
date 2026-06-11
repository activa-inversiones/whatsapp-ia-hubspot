// oliverName.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — NO dejar al cliente sin nombre (gap G5, auditoría 2026-06-10).
//
// BUG QUE RESUELVE: cuando el cliente no se presenta al inicio de la
// conversación, la sesión queda con name="Cliente" (o vacío) en la BD.
// Resultado: los follow-up dicen "Hola Cliente" y Marcelo no sabe a quién
// llamar. Casos reales: 74bb24ee, 4ed83aa2, 4f7521b4.
//
// FIX (tres frentes):
//   1) needsName(d): ¿la sesión NO tiene nombre real del cliente?
//      Genéricos como "Cliente", "cliente de ventanas", vacíos → true → el
//      bot pide el nombre ANTES de avanzar (en vez de dejarlo "Cliente").
//   2) extractName(text): extrae el nombre de respuestas típicas como
//      "soy Juan", "me llamo Ana María", "habla con Claudio". Devuelve
//      Title Case o null si el texto no parece un nombre.
//   3) isLikelyName(text): ¿el mensaje COMPLETO parece ser solo un nombre?
//      Útil para capturar cuando el bot acaba de preguntar el nombre y el
//      cliente responde directamente "Dalia" o "Pedro Ramírez".
//
// REGLA DE ORO: este módulo NUNCA inventa nombres ni asume; solo detecta
// y extrae. Módulo PURO, testeable.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

// Nombres genéricos que NO son un nombre real de persona.
// Se normalizan a minúsculas antes de comparar.
const GENERIC_NAMES = [
  'cliente',
  'cliente de ventanas',
  'cliente de pvc',
  'usuario',
  'desconocido',
  'sin nombre',
  'n/a',
  'na',
];

/**
 * ¿La sesión NO tiene nombre real del cliente?
 * Sin nombre: undefined/null/''/solo espacios, o un genérico (case-insensitive).
 * Con nombre real ("Dalia", "Juan Pérez") → false.
 * @param {object} d  ses.data { name }
 * @returns {boolean}
 */
export function needsName(d) {
  if (!d || typeof d !== 'object') return true;
  const raw = String(d.name ?? '').trim();
  if (!raw) return true;
  return GENERIC_NAMES.includes(raw.toLowerCase());
}

// ─── extractName ────────────────────────────────────────────────────────────

// Prefijos que preceden el nombre en respuestas típicas.
const PREFIX_RE = /^(?:soy|me\s+llamo|mi\s+nombre\s+es|habla\s+(?:con)?|les\s+habla|hola[,!]?\s*(?:soy)?|estimado[s]?[,!]?\s*(?:soy)?)\s*/i;

// Saludos y partículas iniciales que no son nombre.
const GREETING_RE = /^(?:buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|hola)[,!.]?\s*/i;

// Palabras que indican que el texto NO es un nombre (comandos/intenciones).
const NOT_NAME_WORDS = [
  'quiero', 'necesito', 'busco', 'quisiera', 'me\\ gustaría',
  'cotizar', 'cotización', 'ventana', 'puerta', 'terraza', 'mampara',
  'medidas?', 'precio', 'presupuesto', 'vidrio', 'pvc', 'termopanel',
  'color', 'blanco', 'nogal', 'roble', 'grafito', 'newblack',
  'cuánto', 'cuanto', 'cuántos', 'cuantos',
  'cómo', 'como', 'qué', 'que', 'cuál', 'cual',
  'gracias', 'por favor', 'no sé', 'no se',
  'sí', 'si', 'no',
  'commune', 'sector', 'ciudad', 'dirección', 'direccion',
];
const NOT_NAME_RE = new RegExp(`\\b(${NOT_NAME_WORDS.join('|')})\\b`, 'i');

// Palabras que son solo saludo, sin nombre.
const GREETING_ONLY_RE = /^(buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|hola)[!.,]?\s*$/i;

/**
 * Convierte un string a Title Case considerando acentos.
 * @param {string} str
 * @returns {string}
 */
function toTitleCase(str) {
  return str.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Extrae el nombre de una respuesta típica del cliente.
 * Limpia saludos, prefijos ("soy", "me llamo", etc.) y devuelve
 * el nombre en Title Case, o null si no parece un nombre.
 * @param {string} text
 * @returns {string|null}
 */
export function extractName(text) {
  let t = String(text || '').trim();
  if (!t) return null;

  // Descartar saludos puros sin nombre.
  if (GREETING_ONLY_RE.test(t)) return null;

  // Descartar mensajes con palabras de comando/intención.
  if (NOT_NAME_RE.test(t)) return null;

  // Quitar saludos al inicio antes de procesar prefijos.
  t = t.replace(GREETING_RE, '').trim();

  // Intentar extraer tras prefijo conocido.
  const withPrefix = PREFIX_RE.test(t);
  const candidate = t.replace(PREFIX_RE, '').trim();

  if (!candidate) return null;

  // Si no había prefijo, solo aceptamos si parece un nombre (1-4 palabras, letras).
  if (!withPrefix) {
    if (!isLikelyName(candidate)) return null;
  }

  // Descartar si el candidato sigue teniendo palabras de comando.
  if (NOT_NAME_RE.test(candidate)) return null;

  // Validar que el candidato tenga al menos 2 letras y no sean solo dígitos/signos.
  if (!/[a-záéíóúüñA-ZÁÉÍÓÚÜÑ]{2,}/.test(candidate)) return null;

  // Limpiar puntuación al final.
  const clean = candidate.replace(/[.,!?]+$/, '').trim();
  if (!clean) return null;

  return toTitleCase(clean);
}

// ─── isLikelyName ───────────────────────────────────────────────────────────

// Palabras de comando que invalidan un nombre aunque sean pocas palabras.
const COMMAND_WORDS = [
  'quiero', 'necesito', 'busco', 'quisiera',
  'cotizar', 'cotización', 'cotizacion', 'ventana', 'ventanas',
  'puerta', 'puertas', 'terraza', 'mampara', 'mamparas',
  'medida', 'medidas', 'precio', 'precios', 'presupuesto',
  'vidrio', 'pvc', 'termopanel', 'color', 'blanco', 'nogal',
  'roble', 'grafito', 'newblack',
  'cuánto', 'cuanto', 'cuántos', 'cuantos',
  'cómo', 'como', 'qué', 'que', 'cuál', 'cual',
  'gracias', 'hola', 'buenos', 'buenas', 'días', 'tardes', 'noches',
  'sí', 'si', 'no',
  'commune', 'sector', 'ciudad',
];
const COMMAND_SET = new Set(COMMAND_WORDS.map((w) => w.toLowerCase()));

/**
 * ¿El mensaje COMPLETO parece ser solo un nombre de persona?
 * Criterios: 1-4 palabras, mayormente letras/acentos, sin dígitos,
 * sin palabras de comando/intención, sin signos de pregunta.
 * @param {string} text
 * @returns {boolean}
 */
export function isLikelyName(text) {
  const t = String(text || '').trim();
  if (!t) return false;

  // Sin signos de pregunta.
  if (/[?¿]/.test(t)) return false;

  // Sin dígitos.
  if (/\d/.test(t)) return false;

  // Solo letras, espacios, acentos, apóstrofos, guiones (nombres compuestos).
  if (!/^[a-záéíóúüñA-ZÁÉÍÓÚÜÑ\s'\-]+$/.test(t)) return false;

  const words = t.split(/\s+/).filter(Boolean);

  // Entre 1 y 4 palabras.
  if (words.length < 1 || words.length > 4) return false;

  // Ninguna palabra debe ser de comando.
  if (words.some((w) => COMMAND_SET.has(w.toLowerCase()))) return false;

  // Al menos una palabra debe tener 2+ letras.
  if (!words.some((w) => w.length >= 2)) return false;

  return true;
}

// ─── askNameMessage ──────────────────────────────────────────────────────────

/**
 * Mensaje cálido y breve para pedir el nombre del cliente.
 * @returns {string}
 */
export function askNameMessage() {
  return '¿Con quién tengo el gusto? Así te preparo la propuesta a tu nombre. 😊';
}
