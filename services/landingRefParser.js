// landingRefParser.js — v1.1.0
// ═══════════════════════════════════════════════════════════════════════
// ATRIBUCIÓN ORGÁNICA landing → WhatsApp (el espejo del ctwa_clid, para SEO).
//
// Las landings V3 (temp-cxm landingGeneratorV3.js, injectRef() v5.1.0) reescriben
// los wa.me agregando " [Ref:<uuid>]" al ?text= — el uuid es el lead_id que el
// beacon de la landing ya registró en lead_sessions/landing_events (CXM). Este
// módulo cierra el tramo que NUNCA se codeó (el changelog v5.1.0 lo prometía):
// Oliver detecta el tag, lo quita del texto (el cliente y el LLM jamás lo ven de
// vuelta), y atribuye el lead a su landing de origen.
//
// [#966 v1.1.0 · 2026-09-27] Medido en 60 días (BD viva, 4 agentes + control temporal):
// de 138 sesiones pagadas que tocaron el botón de WhatsApp, 29-30 llegaron con la
// referencia (21 %), ≈6 mandaron un mensaje SIN la referencia (4 %, cota superior
// con control) y ≈100 no mandaron nada (75 %). Cuando el cliente manda la frase de
// la landing, la referencia sobrevive el 89 %. Lo que este módulo agrega:
//   · clasificarPrimerMensaje(): con_ref | solo_ref | ref_mutilada |
//     texto_landing_sin_ref | otro_texto | vacio — el estado que viaja a sales-os
//     para medir por lead, sin regex sobre el texto persistido (que llega limpio).
//   · quoteStartedEventId(): uuid DETERMINÍSTICO para el evento quote_started. El
//     bot mandaba `oliver_wa_<uuid>` y landing_events.event_id es tipo uuid: el
//     INSERT falló SIEMPRE (0 filas en toda la historia) y de paso creaba
//     sesiones fantasma 'direct' (198 en 60 d). Mismo lead ⇒ mismo event_id ⇒
//     ON CONFLICT DO NOTHING.
//   · TEXTO_SOLO_REF: los botones sin frase (nav/menú móvil) mandan SOLO el tag;
//     al quitarlo el texto quedaba vacío y Oliver se quedaba CALLADO (15-20
//     clientes en 60 d sin respuesta). Ahora el turno sigue con esta instrucción.
//
// Parser PURO (sin I/O) — mismo patrón que ctwaReferral.js (probado en prod).
// ═══════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';

export const VERSION = '1.2.0';

const REF_RE = /\s*\[Ref:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\s*/i;
// [r3 · Gemini A] versión GLOBAL: un cliente que pega dos tags («[Ref:a] [Ref:b]») antes dejaba el segundo crudo al LLM.
const REF_RE_G = new RegExp(REF_RE.source, 'gi');
// Un tag que el cliente mutiló al editar (falta el ']', metió texto adentro, borró un carácter):
// no se puede capturar con seguridad, pero SÍ se puede contar y quitar del texto.
// Dos formas: con corchete inicial («[Ref:3fbf…» mutilado al final o con texto adentro) o SIN él («Ref:3fbf86b0-1234-…», el cliente
// borró el «[»: uno de los 5 casos medidos — r4 · Codex A). La segunda exige ≥4 hex y un guion, sin espacios, para no comerse
// un «ref: 1234» legítimo. [r3 · NIM] la primera exige 4 hex tras «ref:»: «[ref: mi casa]» no cuenta como tag roto.
// Tres alternativas: cerrado con «]» (puede traer espacios adentro: «Balor venta») · abierto sin «]» (se corta en el primer espacio para
// no comerse el texto que sigue) · sin «[» (uuid con guion, sin espacios).
export const TAG_ROTO_RE = /\[\s*ref\s*:\s*[0-9a-f]{4}[^\]]{0,76}\]|\[\s*ref\s*:\s*[0-9a-f]{4}[^\]\s]{0,76}(?=\s|$)|(?:^|(?<=\s))ref\s*:\s*[0-9a-f]{4,8}-[0-9a-f-]{0,31}\]?/i;
const TAG_ROTO_RE_G = new RegExp(TAG_ROTO_RE.source, 'gi');
// Las frases prellenadas de los botones (landing V3 «Hola Activa, quiero cotizar…», WordPress
// «Hola, vi su web y quiero cotizar…», y la variante «Hola, necesito cotizar…» vista 11 veces en BD).
export const FRASE_LANDING_RE = /^\s*[¡!]?\s*hola(\s+activa)?[\s,!.]*(vi\s+su\s+web\s+y\s+)?(quiero|necesito)\s+cotizar/i;
// [r3 · Codex A + Gemini A] Cuando el único texto era el tag (botón sin frase), el LLM recibe ESTE MARCADOR NEUTRO —el mismo que ve
// el operador— y no una instrucción en tercera persona con rol `user`: la instrucción quedaba en el historial y el modelo podía
// citarla («¿qué fue lo primero que te escribí?»). Qué hacer con el marcador vive en el system prompt (REGLA #33), como los
// marcadores de imagen. `TEXTO_SOLO_REF` se conserva como alias por compatibilidad: es el MISMO string.
export const BODY_SOLO_REF = '[El cliente abrió el chat desde la web sin escribir texto]';
export const TEXTO_SOLO_REF = BODY_SOLO_REF;

/**
 * Extrae el lead_id (uuid) del texto si viene con [Ref:...].
 * Devuelve { hasRef, leadId, cleanText } — cleanText SIN el tag, listo para
 * el LLM/historial/espejo (nunca mostrarle el ref al cliente ni al operador).
 */
export function parseLandingRef(text) {
  const t = String(text || '');
  const m = t.match(REF_RE);
  if (!m) return { hasRef: false, leadId: null, cleanText: t };
  // El PRIMER uuid es el que se atribuye; TODOS los tags sanos se quitan del texto (r3: antes solo el primero).
  return { hasRef: true, leadId: m[1].toLowerCase(), cleanText: t.replace(REF_RE_G, ' ').replace(/\s{2,}/g, ' ').trim() };
}

/** ¿El texto es una de las frases prellenadas de los botones de la web? */
export function esTextoDeLanding(text) {
  return FRASE_LANDING_RE.test(String(text || ''));
}

/** ¿Trae un tag [Ref:…] que el regex estricto no acepta (mutilado por el cliente)? */
export function tieneTagRoto(text) {
  // [r3 · Gemini A] se evalúa sobre el texto SIN los tags sanos: «[Ref:uuid] [Ref:roto» antes devolvía false y el roto se colaba.
  return TAG_ROTO_RE.test(String(text || '').replace(REF_RE_G, ' '));
}

/** Quita los tags mutilados del texto (no se capturan, pero tampoco tienen que llegar al LLM ni al operador). Los sanos quedan. */
export function limpiarTagRoto(text) {
  const t = String(text || '').replace(/\u0000/g, '');   // [r3 · NIM] el placeholder de abajo no puede confundirse con texto del cliente
  if (!tieneTagRoto(t)) return t;
  const sanos = [];
  const protegido = t.replace(REF_RE_G, (m) => { sanos.push(m); return `\u0000${sanos.length - 1}\u0000`; });
  return protegido.replace(TAG_ROTO_RE_G, ' ').replace(/\u0000(\d+)\u0000/g, (_, i) => sanos[Number(i)]).replace(/\s{2,}/g, ' ').trim();
}
export const INACTIVIDAD_RECLASIFICAR_MS = 7 * 24 * 60 * 60 * 1000;   // mismo umbral que resetIfInactive: tras 7 días es una llegada nueva

/**
 * Estado de la referencia para el PRIMER texto de una sesión (se fija una vez y viaja a sales-os):
 *   con_ref               — trae el tag completo y además texto
 *   solo_ref              — trae SOLO el tag (botón sin frase): Oliver contesta igual (TEXTO_SOLO_REF)
 *   ref_mutilada          — trae un tag roto: no se captura, pero se cuenta
 *   texto_landing_sin_ref — mandó la frase de la web pero sin el tag (lo borró)
 *   otro_texto            — escribió lo suyo
 *   vacio                 — sin texto
 */
export function clasificarPrimerMensaje(text) {
  const t = String(text || '');
  const p = parseLandingRef(t);
  if (p.hasRef) return p.cleanText ? 'con_ref' : 'solo_ref';
  if (tieneTagRoto(t)) return 'ref_mutilada';
  if (esTextoDeLanding(t)) return 'texto_landing_sin_ref';
  return t.trim() ? 'otro_texto' : 'vacio';
}

/**
 * uuid v5-like DETERMINÍSTICO para el evento quote_started de un lead de landing
 * (sha1 de 'oliver_wa_<lead_id>' con los bits de versión y variante puestos).
 * landing_events.event_id es tipo uuid: cualquier otra cosa no entra.
 */
export function quoteStartedEventId(leadId) {
  const h = crypto.createHash('sha1').update(`oliver_wa_${String(leadId || '').toLowerCase()}`).digest('hex');
  const v = `${h.slice(0, 12)}5${h.slice(13, 16)}`;                       // versión 5
  const variant = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16); // variante RFC 4122
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${v.slice(12, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Payload para bridge.pushLeadEvent (sales-os /api/ingest/lead), atribuyendo el
 * lead a su landing de origen Y PROPAGANDO los click ids que la landing capturó
 * (gclid/fbclid vienen en ctx desde GET /api/lead-event/ref/:id → lead_sessions).
 * [2026-07-12 fix señal-ads] Antes se descartaban acá y leads.gclid quedaba 0/775.
 * No pisa un click id ya guardado: upsertLead usa COALESCE(NULLIF($x,''), col).
 * [#966] metadata.ref_status viaja para que sales-os lo persista en leads.landing_ref_estado.
 */
export function buildLandingLeadPayload(phone, ctx = {}, extra = {}) {
  const payload = {
    phone: String(phone || ''),
    source: 'landing_organic',
    channel: 'whatsapp',
    gclid: ctx.gclid || '',
    fbclid: ctx.fbclid || '',
    landing_ref: ctx.lead_id || null,
    metadata: {
      landing_ref: ctx.lead_id || null,
      landing_slug: ctx.landing_slug || null,
      landing_servicio: ctx.service || ctx.landing_servicio || null,
      landing_comuna: ctx.comuna || ctx.landing_comuna || null,
      ...(extra.ref_status ? { ref_status: extra.ref_status } : {}),
    },
  };
  if (ctx.gclid || ctx.fbclid) payload.ad_click_id_source = 'landing_ref';
  if (extra.name) payload.name = String(extra.name);
  if (extra.message) payload.message = String(extra.message).slice(0, 300);
  return payload;
}

export default { parseLandingRef, buildLandingLeadPayload, clasificarPrimerMensaje, esTextoDeLanding, tieneTagRoto, limpiarTagRoto, quoteStartedEventId, TEXTO_SOLO_REF, BODY_SOLO_REF, INACTIVIDAD_RECLASIFICAR_MS, VERSION };
