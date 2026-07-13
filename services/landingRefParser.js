// landingRefParser.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ATRIBUCIÓN ORGÁNICA landing → WhatsApp (el espejo del ctwa_clid, para SEO).
//
// Las landings V3 (temp-cxm landingGeneratorV3.js, injectRef() v5.1.0) reescriben
// los wa.me agregando " [Ref:<uuid>]" al ?text= — el uuid es el lead_id que el
// beacon de la landing ya registró en lead_sessions/landing_events (CXM). Este
// módulo cierra el tramo que NUNCA se codeó (el changelog v5.1.0 lo prometía):
// Oliver detecta el tag en el PRIMER mensaje, lo quita del texto (el cliente y
// el LLM jamás lo ven de vuelta), y atribuye el lead a su landing de origen.
//
// Parser PURO (sin I/O) — mismo patrón que ctwaReferral.js (probado en prod).
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

const REF_RE = /\s*\[Ref:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\s*/i;

/**
 * Extrae el lead_id (uuid) del texto si viene con [Ref:...].
 * Devuelve { hasRef, leadId, cleanText } — cleanText SIN el tag, listo para
 * el LLM/historial/espejo (nunca mostrarle el ref al cliente ni al operador).
 */
export function parseLandingRef(text) {
  const t = String(text || '');
  const m = t.match(REF_RE);
  if (!m) return { hasRef: false, leadId: null, cleanText: t };
  return { hasRef: true, leadId: m[1].toLowerCase(), cleanText: t.replace(REF_RE, ' ').replace(/\s{2,}/g, ' ').trim() };
}

/**
 * Payload para bridge.pushLeadEvent (sales-os /api/ingest/lead), atribuyendo el
 * lead a su landing de origen Y PROPAGANDO los click ids que la landing capturó
 * (gclid/fbclid vienen en ctx desde GET /api/lead-event/ref/:id → lead_sessions).
 * [2026-07-12 fix señal-ads] Antes se descartaban acá y leads.gclid quedaba 0/775.
 * No pisa un click id ya guardado: upsertLead usa COALESCE(NULLIF($x,''), col).
 */
export function buildLandingLeadPayload(phone, ctx = {}, extra = {}) {
  const payload = {
    phone: String(phone || ''),
    source: 'landing_organic',
    channel: 'whatsapp',
    gclid: ctx.gclid || '',
    fbclid: ctx.fbclid || '',
    metadata: {
      landing_ref: ctx.lead_id || null,
      landing_slug: ctx.landing_slug || null,
      landing_servicio: ctx.service || ctx.landing_servicio || null,
      landing_comuna: ctx.comuna || ctx.landing_comuna || null,
    },
  };
  if (ctx.gclid || ctx.fbclid) payload.ad_click_id_source = 'landing_ref';
  if (extra.name) payload.name = String(extra.name);
  if (extra.message) payload.message = String(extra.message).slice(0, 300);
  return payload;
}

export default { parseLandingRef, buildLandingLeadPayload, VERSION };
