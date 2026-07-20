// ctwaSaludos.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — saludo de apertura por ÁNGULO del anuncio CTWA (Ronda 1).
//
// CONTEXTO (RUTA-ANUNCIOS-2026-07-17): la campaña Meta Ronda 1 tiene 3 anuncios
// (ángulos: termico / fabrica / precio). Cuando el cliente clickea "Enviar
// WhatsApp", el primer mensaje trae `referral` (ver ctwaReferral.js). Este
// módulo PURO decide el ángulo y entrega el saludo aprobado por el dueño, para
// que Oliver abra COHERENTE con el anuncio que gatilló la conversación
// (anuncio → saludo → cotización, pedido explícito del dueño 2026-07-17).
//
// Resolución del ángulo (en orden):
//   1. ad_id en el mapa (env CTWA_AD_ANGLE_MAP como JSON, o el default de la
//      Ronda 1 documentado en RUTA-ANUNCIOS) — precisión quirúrgica.
//   2. keywords del headline (acento-insensible) — fallback para anuncios
//      futuros aún no mapeados.
//   3. Sin match → null (el bot saluda normal; NUNCA inventa).
//
// Killswitch: env CTWA_SALUDOS_DISABLED='true' → apaga todo sin deploy.
// 100% puro y testeable: env inyectable en cada función.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

// Mapa anuncio→ángulo de la Ronda 1 (IDs reales, creados 2026-07-17).
// Fuente canónica: RUTA-ANUNCIOS-2026-07-17.md § CTWA_AD_ANGLE_MAP.
export const DEFAULT_AD_ANGLE_MAP = {
  '120251614379310092': 'termico',
  '120251614381940092': 'fabrica',
  '120251614384990092': 'precio',
};

// Saludos aprobados por el dueño (2026-07-17). Tono tú de Oliver.
// NO editar sin OK explícito: es la primera frase que ve un lead PAGADO.
export const SALUDOS = {
  termico:
    'Hola 👋 Si tus ventanas lloran en invierno, estás en el lugar correcto. ' +
    'Soy Oliver de Activa Inversiones — fabricamos ventanas PVC con termopanel acá en Temuco. ' +
    'Cuéntame en qué comuna estás y qué ventanas quieres cambiar. ' +
    'Y si necesitas evaluación energética MINVU, Marcelo (Evaluador acreditado) te asesora.',
  fabrica:
    'Hola 👋 Sí, somos fábrica — fabricamos tus ventanas PVC acá en Temuco, sin intermediarios. ' +
    'Soy Oliver. Cuéntame qué necesitas (medidas aproximadas y comuna) y te cotizo al tiro.',
  precio:
    'Hola 👋 ¿Comparando precios? Buena decisión. Soy Oliver de Activa — te explico honestamente ' +
    'qué pagas: ventana a medida, de fábrica directa y con facilidades de pago. ' +
    'Mándame una foto o las medidas y tu comuna, y te cotizo gratis.',
};

// Keywords por ángulo sobre el headline del anuncio, ya normalizado
// (minúsculas + sin acentos). Orden = prioridad de evaluación.
const HEADLINE_PATTERNS = [
  ['termico', /llora|lloran|invierno|termic|condensa|frio/],
  ['fabrica', /fabrica|revendedor|intermediari/],
  ['precio', /caro|precio|cuanto|sale mas/],
];

/**
 * Detecta el ángulo del anuncio desde el referral parseado (ctwaReferral.js).
 * @param {object} ref  Resultado de parseReferral ({ adId, headline, ... }).
 * @param {object} [env] process.env inyectable (tests).
 * @returns {string|null}  'termico' | 'fabrica' | 'precio' | null.
 */
export function detectAngle(ref, env = process.env) {
  if (!ref || typeof ref !== 'object') return null;

  // 1) ad_id en el mapa (env pisa al default; si el JSON del env viene roto, se ignora).
  let map = DEFAULT_AD_ANGLE_MAP;
  if (env && typeof env.CTWA_AD_ANGLE_MAP === 'string' && env.CTWA_AD_ANGLE_MAP.trim()) {
    try {
      const parsed = JSON.parse(env.CTWA_AD_ANGLE_MAP);
      if (parsed && typeof parsed === 'object') map = { ...DEFAULT_AD_ANGLE_MAP, ...parsed };
    } catch { /* env malformado → seguir con el default, nunca tumbar */ }
  }
  // [tribunal] validar el valor del mapa contra SALUDOS (clave PROPIA, no heredada):
  // un typo en el env ('termcio') NO debe pisar el default ni cortar el fallback por
  // headline — sin esto, editar mal la var en Railway apagaba el saludo en silencio.
  const mapped = ref.adId ? map[String(ref.adId)] : null;
  if (mapped && Object.hasOwn(SALUDOS, mapped)) return mapped;
  // [Ronda 2 2026-07-20] Si el env pisó con un valor INVÁLIDO un ad_id que el DEFAULT sí
  // conoce, usar el default en vez de perder el saludo (el typo en Railway ya no apaga
  // un anuncio de la Ronda 1; el fallback por headline sigue cubriendo al resto).
  const porDefecto = ref.adId ? DEFAULT_AD_ANGLE_MAP[String(ref.adId)] : null;
  if (porDefecto && Object.hasOwn(SALUDOS, porDefecto)) return porDefecto;

  // 2) keywords del headline (acento-insensible).
  const h = normalize(ref.headline);
  if (h) {
    for (const [angle, re] of HEADLINE_PATTERNS) {
      if (re.test(h)) return angle;
    }
  }
  return null; // 3) sin match → saludo normal del bot (no inventar).
}

/**
 * Saludo aprobado para un ángulo. Null si el ángulo no existe.
 * @param {string|null} angle
 * @returns {string|null}
 */
export function saludoForAngle(angle) {
  // Object.hasOwn: jamás servir claves heredadas del prototype ('constructor', etc.).
  return (angle && Object.hasOwn(SALUDOS, angle)) ? SALUDOS[angle] : null;
}

/**
 * Todo-en-uno para el webhook: referral → { angle, saludo } o null.
 * Respeta el killswitch CTWA_SALUDOS_DISABLED.
 * @param {object} ref  Resultado de parseReferral.
 * @param {object} [env] process.env inyectable (tests).
 * @returns {{ angle: string, saludo: string }|null}
 */
export function saludoForReferral(ref, env = process.env) {
  if (env && env.CTWA_SALUDOS_DISABLED === 'true') return null;
  const angle = detectAngle(ref, env);
  const saludo = saludoForAngle(angle);
  return angle && saludo ? { angle, saludo } : null;
}

function normalize(v) {
  if (v === undefined || v === null) return '';
  return String(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export default { VERSION, detectAngle, saludoForAngle, saludoForReferral, SALUDOS, DEFAULT_AD_ANGLE_MAP };
