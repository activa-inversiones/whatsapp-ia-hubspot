// oliverHumanRequest.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — NO ignorar pedidos de atención humana (gap G7, auditoría 2026-06-10).
//
// BUG QUE RESUELVE: cuando el cliente pide hablar con un vendedor/persona real,
// Oliver responde "Soy Oliver, del equipo de Marcelo..." ignorando la solicitud
// en vez de escalar/derivar al equipo humano.
// Caso real 096cd370: cliente escribió "vendedor" y el bot no derivó.
//
// FIX (dos frentes):
//   1) detectHumanRequest(text): ¿el cliente está PIDIENDO hablar con una
//      persona real / vendedor / asesor? Si true → el bot debe escalar (no
//      responder como si nada). Prioriza patrones CLAROS de pedido; evita
//      falsos positivos en menciones neutras ("soy una persona ocupada",
//      "vendedor de autos").
//   2) humanRequestAck(nombre): mensaje cálido que CONFIRMA la derivación y
//      captura nombre+comuna para el handoff (Marcelo necesita esos datos para
//      llamar).
//
// REGLA DE ORO: si hay duda, preferir false (no interrumpir el flujo normal)
// antes que generar falsos positivos molestos. Módulo PURO, testeable.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

// ─── Patrones de detección ───────────────────────────────────────────────────

// Palabras/frases que, solas o en contexto de pedido, identifican a quién
// quiere hablar el cliente (roles de persona humana).
// NOTA: "una persona" NO está aquí (demasiado genérico; "soy una persona ocupada"
// daría falso positivo). El caso "comunicar con una persona" ya lo cubre
// EXPLICIT_PHRASES_RE. "persona real" sí es específico y se mantiene.
const HUMAN_ROLES_RE = /\b(vendedor[a]?|ejecutiv[oa]|asesor[a]?|operador[a]?|encargad[oa]?|responsable|agente|representante|humano|persona\s+real)\b/i;

// Verbos/frases de contacto que convierten un rol en un PEDIDO explícito.
const CONTACT_VERBS_RE = /\b(quiero|quisiera|necesito|puedo|pueden|me\s+pueden|p[aá]same\s+con|pásame\s+con|pasame\s+con|comunicar(?:me)?|contactar(?:me)?|hablar|habla|hab[ií]a|con\s+alguien|atender(?:me)?|atenci[oó]n)\b/i;

// Frases completas inequívocas (no requieren verbo adicional).
const EXPLICIT_PHRASES_RE = /\b(hablar\s+con\s+alguien|con\s+alguien|atenci[oó]n\s+humana|me\s+atiende\s+alguien|quiero\s+hablar\s+con|comunicar(?:me)?\s+con|contactar(?:me)?\s+con\s+un|habla(?:r)?\s+con\s+alguien)\b/i;

// "Marcelo" como pedido de contacto: debe ir acompañado de verbo de contacto O
// construcciones como "pásame con", "con Marcelo", "hablar con Marcelo".
// NO dispara en "me dijo Marcelo que...", "Marcelo me comentó...", etc.
const MARCELO_CONTACT_RE = /(?:(?:p[aá]same\s+con|pasame\s+con|hablar?\s+con|comunicar(?:me)?\s+con|contactar(?:me)?\s+con|quiero\s+(?:hablar\s+)?con|me\s+comunic[ao]\s+con)\s+marcelo|con\s+marcelo\b)/i;

// ─── detectHumanRequest ──────────────────────────────────────────────────────

/**
 * ¿El cliente está PIDIENDO hablar con una persona real?
 *
 * Estrategia por capas (orden de evaluación):
 *  1. Frases explícitas inequívocas (atención humana, hablar con alguien…).
 *  2. Pedido de Marcelo con verbo de contacto.
 *  3. Rol humano (vendedor/asesor/etc.) + verbo de contacto/pedido.
 *  4. Rol humano como mensaje MUY corto (≤3 palabras), sin contexto que lo anule.
 *
 * LÍMITES CONOCIDOS:
 *  - "vendedor de autos usados" → actualmente da TRUE porque "vendedor" aparece
 *    solo y el texto es corto (3 palabras con "de"). El contexto "de autos" es
 *    suficientemente inusual en Activa (ventanas PVC) que se acepta como límite;
 *    el asesor humano puede manejar ese caso. Ver test con comentario al respecto.
 *  - "soy una persona ocupada" → FALSE correcto (no tiene rol ni verbo de contacto).
 *  - "me dijo Marcelo que cotice" → FALSE correcto (no hay verbo de contacto con Marcelo).
 *
 * @param {string} text
 * @returns {boolean}
 */
export function detectHumanRequest(text) {
  const t = String(text || '').trim();
  if (!t) return false;

  // Capa 1: frases explícitas inequívocas.
  if (EXPLICIT_PHRASES_RE.test(t)) return true;

  // Capa 2: pedido de Marcelo con verbo de contacto.
  if (MARCELO_CONTACT_RE.test(t)) return true;

  // Capa 3: rol humano + verbo/frase de contacto en el mismo mensaje.
  if (HUMAN_ROLES_RE.test(t) && CONTACT_VERBS_RE.test(t)) return true;

  // Capa 4: rol humano como mensaje muy corto (mensaje directo tipo "vendedor",
  // "necesito un asesor", "un ejecutivo"). Máximo 6 palabras y sin contexto
  // que lo neutralice (ej. "de autos", "de seguros" — contextos ajenos a Activa).
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 6 && HUMAN_ROLES_RE.test(t)) {
    // Contextos ajenos que neutralizan el rol (fuera del rubro ventanas/PVC).
    const OFF_CONTEXT_RE = /\b(autos?|autom[oó]vil(?:es)?|seguros?|inmuebles?|propiedades?|viajes?|turismo|salud|seguros?\s+de\s+vida)\b/i;
    if (!OFF_CONTEXT_RE.test(t)) return true;
  }

  return false;
}

// ─── humanRequestAck ─────────────────────────────────────────────────────────

/**
 * Mensaje cálido que CONFIRMA la derivación a un asesor humano.
 * Captura nombre y comuna para el handoff (datos mínimos que necesita Marcelo
 * para contactar al cliente).
 *
 * @param {string} [nombre='']
 * @returns {string}
 */
export function humanRequestAck(nombre = '') {
  const n = String(nombre || '').trim();
  const saludo = n ? `, ${n}` : '';
  return `¡Claro${saludo}! Te paso con un asesor del equipo. Para que te contacte rápido, ¿me confirmás tu nombre y la comuna?`;
}
