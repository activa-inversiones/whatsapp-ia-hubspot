// oliverIntent.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — detección de intención de CONFIRMACIÓN (mandar la propuesta/PDF).
//
// BUG QUE RESUELVE (#2/#D del audit 2026-06-10): WhatsApp envía la negrita como
// "*Si*" y la cursiva como "_Si_". El regex de intención ancla al inicio
// (^\s*s[ií]\b), así que el "*" inicial lo rompía → el cliente confirmaba "*Si*"
// y el PDF NUNCA se enviaba (caso real: Dalia confirmó 3 veces, 0 PDF).
//
// FIX: quitar el marcado WhatsApp (* _ ~) ANTES de aplicar el regex de intención.
// Se aísla en un módulo puro y testeable para no romper otros parseos (replace
// solo se aplica a la copia que evalúa el regex, no al userText global).
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

// Quita marcado WhatsApp (*negrita*, _cursiva_, ~tachado~) sin tocar el resto.
export function stripWhatsAppMarkup(text) {
  return String(text || '').replace(/[*_~]/g, '');
}

// Mismo set de intención que ya usaba index.js (compat), evaluado sobre el texto
// SIN marcado. Devuelve true si el mensaje es una confirmación / pedido de propuesta.
// NOTA: el `\b` original tras "s[ií]" NO funcionaba con "í" acentuada (no es word-char ASCII),
// así que "sí"/"SÍ" — la confirmación más natural en español — JAMÁS matcheaba. Se reemplaza
// por un lookahead negativo de letra: matchea "si"/"sí" standalone pero no "siempre"/"sino".
const INTENT_RE = /pdf|cotiza|cotizaci[oó]n|formal|env[ií]a|env[ií]amela|manda|m[aá]ndala|propuesta|dale|listo|perfecto|de acuerdo|est[aá]\s*bien|^\s*s[ií](?![a-záéíóúñ])|^\s*ok\b|gracias|quiero/i;

export function isQuoteIntent(userText) {
  return INTENT_RE.test(stripWhatsAppMarkup(userText));
}
