// ctwaReferral.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — captura de atribución de anuncios CTWA (Click-to-WhatsApp).
//
// CONTEXTO (MAPA-ACTIVA línea 72 + auditoría ciclo comercial 2026-06-11): el
// anuncio Meta "Enviar WhatsApp" manda, en el PRIMER mensaje del cliente, un
// objeto `referral` con el ctwa_clid (id de click) + el id del anuncio. Hoy
// `extractMsg` lo IGNORA → se paga publicidad de WhatsApp sin saber qué anuncio
// generó la cotización (ROAS ciego en el formato principal de Activa).
//
// Este módulo PURO parsea ese objeto. El bot luego lo persiste en el lead
// (leads.ctwa_clid vía /api/ingest/lead) y — cuando el lead cotiza — el bridge
// de conversiones lo manda a Meta CAPI con action_source 'business_messaging'.
//
// Doc del payload Meta (messages[].referral):
//   { source_url, source_id (=ad id), source_type ('ad'|'post'),
//     headline, body, media_type, ctwa_clid }
// NO inventa datos: si el campo no viene, devuelve null. 100% testeable.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

/**
 * Parsea el objeto referral de un mensaje entrante de WhatsApp.
 * @param {object} msg  El mensaje crudo de Meta (messages[0]).
 * @returns {{ isCtwaAd: boolean, ctwaClid: string|null, adId: string|null,
 *             sourceType: string|null, headline: string|null }}
 */
export function parseReferral(msg) {
  const ref = msg && typeof msg === 'object' ? msg.referral : null;
  if (!ref || typeof ref !== 'object') {
    return { isCtwaAd: false, ctwaClid: null, adId: null, sourceType: null, headline: null };
  }
  const ctwaClid = strOrNull(ref.ctwa_clid);
  const adId = strOrNull(ref.source_id);
  const sourceType = strOrNull(ref.source_type);
  const headline = strOrNull(ref.headline);
  // Es un lead de anuncio CTWA si trae ctwa_clid (lo que de verdad necesitamos
  // para atribuir) o si el source_type es 'ad' con un id de anuncio.
  const isCtwaAd = !!ctwaClid || (sourceType === 'ad' && !!adId);
  return { isCtwaAd, ctwaClid, adId, sourceType, headline };
}

/**
 * Arma el payload de ingest del lead (para POST /api/ingest/lead de Sales OS)
 * a partir de la atribución CTWA. Solo incluye campos presentes.
 * @param {string} phone  waId del cliente.
 * @param {object} ref    Resultado de parseReferral.
 * @param {object} [extra] { name, message } opcionales.
 * @returns {object}  payload para upsertLead.
 */
export function buildCtwaLeadPayload(phone, ref, extra = {}) {
  const payload = {
    phone: String(phone || ''),
    source: 'meta_ctwa',
    channel: 'whatsapp',
    ctwa_clid: ref?.ctwaClid || '',
    ad_id: ref?.adId || '',
    ad_click_id_source: 'ctwa',
  };
  if (extra.name) payload.name = String(extra.name);
  if (extra.message) payload.message = String(extra.message);
  return payload;
}

function strOrNull(v) {
  const s = (v === undefined || v === null) ? '' : String(v).trim();
  return s === '' ? null : s;
}
