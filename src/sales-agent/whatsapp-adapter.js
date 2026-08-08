// whatsapp-adapter.js — Capa de WhatsApp (Meta Cloud API) para Oliver v2
// ESM | Node 18+ | axios
//
// Reutiliza EXACTAMENTE las mismas env vars que index.js (el monolito v11.8.1):
//   - META_GRAPH_VERSION  → versión del Graph API (default "v22.0")
//   - WHATSAPP_TOKEN       → access token (Bearer)
//   - PHONE_NUMBER_ID      → phone number id del número de WhatsApp
// Estas ya existen en el entorno de Railway; NO inventar nombres nuevos.

import axios from "axios";
import { textoDeReaccion } from "../../services/reactionText.js";

const META = {
  VER: process.env.META_GRAPH_VERSION || "v22.0",
  TOKEN: process.env.WHATSAPP_TOKEN,
  PHONE_ID: process.env.PHONE_NUMBER_ID,
};

// Cliente axios espejo del `axiosWA` de index.js (mismo baseURL + Bearer).
const axiosWA = axios.create({
  baseURL: `https://graph.facebook.com/${META.VER}`,
  headers: { Authorization: `Bearer ${META.TOKEN}` },
  timeout: 15000,
});

/**
 * Parsea el body entrante del webhook de Meta.
 * Espeja `extractMsg` de index.js (línea ~2349).
 *
 * @param {object} body  req.body del POST de Meta.
 * @returns {{ ok:boolean, from?:string, text?:string, msgId?:string, type?:string }}
 *   ok:false para statuses de entrega o cuando no hay mensaje.
 *   Para tipos no-texto (audio/imagen/etc.) devuelve text = "[<tipo>]" para
 *   que el agente pueda pedir que escriban en texto.
 */
export function parseInbound(body) {
  const val = body?.entry?.[0]?.changes?.[0]?.value;
  // statuses[] presente → es un status de entrega/lectura, no un mensaje.
  if (val?.statuses?.length) return { ok: false };

  const msg = val?.messages?.[0];
  if (!msg) return { ok: false };

  // [2026-06-22] Nombre de perfil de WhatsApp (push_name) → fallback de nombre del cliente en el cockpit/propuesta.
  const pushName = (val?.contacts?.[0]?.profile?.name || '').trim();

  const type = msg.type;
  let text = "";
  if (type === "text") {
    text = msg.text?.body || "";
  } else if (type === "button") {
    text = msg.button?.text || "";
  } else if (type === "interactive") {
    // Best-effort: title del reply de botón o de lista.
    const it = msg.interactive || {};
    text =
      it.button_reply?.title ||
      it.list_reply?.title ||
      it.nfm_reply?.response_json ||
      `[${type}]`;
  } else if (type === "reaction") {
    // [2026-08-08] Ver services/reactionText.js. Este parser es el del webhook de
    // Oliver GPT: es el que venía guardando "[reaction]" y tirando el emoji, dejando
    // ciega a la REGLA #9 del prompt (que distingue 👍 de 😢).
    text = textoDeReaccion(msg);
  } else {
    // audio, image, document, location, sticker, etc.
    text = `[${type}]`;
  }

  // [2026-08-08] enviadoAt: el momento REAL en que el cliente mandó el mensaje, según Meta
  // (unix en segundos). Sin esto no se puede medir cuánto tarda Oliver en contestar: el
  // `created_at` de conversation_messages es la hora en que GUARDAMOS la fila, y el inbound
  // y el outbound de un mismo turno se persisten juntos con ~50 ms de diferencia. Medir con
  // eso daba "mediana 0 segundos", que no significaba nada.
  // Es un requisito de la 9001 §9.1.1: no se puede vigilar lo que no se registra.
  const enviadoAt = Number(msg.timestamp) > 0 ? new Date(Number(msg.timestamp) * 1000).toISOString() : null;
  return { ok: true, from: msg.from, text, msgId: msg.id, type, push_name: pushName, enviadoAt };
}

/**
 * Envía un mensaje de texto por WhatsApp (Meta Cloud API).
 * Espeja el POST a `/{PHONE_ID}/messages` de index.js.
 * Traga/loguea errores: NUNCA lanza hacia el webhook.
 *
 * @param {string} to    Número destino (waId, sin '+').
 * @param {string} body  Texto a enviar.
 * @returns {Promise<{ ok:boolean, msgId?:string, error?:string }>}
 */
export async function sendWhatsAppText(to, body) {
  if (!META.TOKEN || !META.PHONE_ID) {
    console.error("[wa-adapter] meta_credentials_missing (WHATSAPP_TOKEN / PHONE_NUMBER_ID)");
    return { ok: false, error: "meta_credentials_missing" };
  }
  if (!to || !body) {
    return { ok: false, error: "missing_to_or_body" };
  }
  try {
    const payload = {
      messaging_product: "whatsapp",
      to: String(to).replace(/^\+/, ""),
      type: "text",
      text: { body: String(body) },
    };
    const r = await axiosWA.post(`/${META.PHONE_ID}/messages`, payload);
    const msgId = r.data?.messages?.[0]?.id;
    console.log(`[wa-adapter] text_sent to=${to} msgId=${msgId || "?"}`);
    return { ok: true, msgId };
  } catch (err) {
    const errBody = err.response?.data || err.message;
    console.error(
      "[wa-adapter] text_send_failed:",
      typeof errBody === "string" ? errBody : JSON.stringify(errBody)
    );
    return { ok: false, error: typeof errBody === "string" ? errBody : JSON.stringify(errBody) };
  }
}

/**
 * Envía una imagen desde URL pública por WhatsApp.
 * Espeja waSendImageUrl de index.js ~L4270.
 */
export async function sendWhatsAppImageUrl(to, imageUrl, caption = '') {
  if (!META.TOKEN || !META.PHONE_ID) return { ok: false, error: 'meta_credentials_missing' };
  if (!to || !imageUrl) return { ok: false, error: 'missing_to_or_url' };
  try {
    const r = await axiosWA.post(`/${META.PHONE_ID}/messages`, {
      messaging_product: 'whatsapp',
      to: String(to).replace(/^\+/, ''),
      type: 'image',
      image: { link: imageUrl, caption: caption || '' },
    });
    return { ok: true, msgId: r.data?.messages?.[0]?.id };
  } catch (err) {
    const e = err.response?.data || err.message;
    console.error('[wa-adapter] image_send_failed:', typeof e === 'string' ? e : JSON.stringify(e));
    return { ok: false, error: typeof e === 'string' ? e : JSON.stringify(e) };
  }
}

/**
 * Envía un video desde URL pública por WhatsApp.
 * Espeja waSendVideoUrl de index.js ~L4312.
 */
export async function sendWhatsAppVideoUrl(to, videoUrl, caption = '') {
  if (!META.TOKEN || !META.PHONE_ID) return { ok: false, error: 'meta_credentials_missing' };
  if (!to || !videoUrl) return { ok: false, error: 'missing_to_or_url' };
  try {
    const r = await axiosWA.post(`/${META.PHONE_ID}/messages`, {
      messaging_product: 'whatsapp',
      to: String(to).replace(/^\+/, ''),
      type: 'video',
      video: { link: videoUrl, caption: caption || '' },
    });
    return { ok: true, msgId: r.data?.messages?.[0]?.id };
  } catch (err) {
    const e = err.response?.data || err.message;
    console.error('[wa-adapter] video_send_failed:', typeof e === 'string' ? e : JSON.stringify(e));
    return { ok: false, error: typeof e === 'string' ? e : JSON.stringify(e) };
  }
}

/**
 * Envía un documento PDF desde URL pública por WhatsApp.
 * Espeja waSendDocumentUrl de index.js ~L4326.
 */
export async function sendWhatsAppDocumentUrl(to, docUrl, filename = 'documento.pdf', caption = '') {
  if (!META.TOKEN || !META.PHONE_ID) return { ok: false, error: 'meta_credentials_missing' };
  if (!to || !docUrl) return { ok: false, error: 'missing_to_or_url' };
  try {
    const r = await axiosWA.post(`/${META.PHONE_ID}/messages`, {
      messaging_product: 'whatsapp',
      to: String(to).replace(/^\+/, ''),
      type: 'document',
      document: { link: docUrl, filename, caption: caption || '' },
    });
    return { ok: true, msgId: r.data?.messages?.[0]?.id };
  } catch (err) {
    const e = err.response?.data || err.message;
    console.error('[wa-adapter] doc_send_failed:', typeof e === 'string' ? e : JSON.stringify(e));
    return { ok: false, error: typeof e === 'string' ? e : JSON.stringify(e) };
  }
}

export { META };

/**
 * Sube un buffer de audio a WhatsApp Media (2-pasos) y devuelve el media_id.
 * Espeja waUploadAudio del V1 (index.js ~L1949).
 *
 * @param {Buffer} audioBuffer
 * @param {string} mimeType   p.ej. 'audio/ogg; codecs=opus'
 * @param {string} filename   p.ej. 'reply.ogg'
 * @returns {Promise<string>} media_id
 */
export async function uploadWaAudio(audioBuffer, mimeType, filename) {
  if (!META.TOKEN || !META.PHONE_ID) {
    throw new Error('[wa-adapter] uploadWaAudio: meta_credentials_missing');
  }
  // form-data: importación dinámica igual que el V1 para compatibilidad CJS/ESM
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'audio');
  form.append('file', audioBuffer, { filename, contentType: mimeType });
  const resp = await axiosWA.post(`/${META.PHONE_ID}/media`, form, {
    headers: form.getHeaders(),
    timeout: 30000,
  });
  const mediaId = resp.data?.id;
  if (!mediaId) throw new Error('[wa-adapter] uploadWaAudio: no se obtuvo media_id de WhatsApp');
  return mediaId;
}

/**
 * Envía un audio ya subido como nota de voz (voice:true = icono de micrófono).
 * Espeja waSendAudio+voice del V1 (index.js ~L2196-2208).
 *
 * @param {string} to       waId destino
 * @param {string} mediaId  id devuelto por uploadWaAudio
 * @param {boolean} [asVoice=true]  true → pttAudio (nota de voz); false → adjunto de audio
 */
export async function sendWaAudio(to, mediaId, asVoice = true) {
  if (!META.TOKEN || !META.PHONE_ID) {
    throw new Error('[wa-adapter] sendWaAudio: meta_credentials_missing');
  }
  const payload = {
    messaging_product: 'whatsapp',
    to: String(to).replace(/^\+/, ''),
    type: 'audio',
    audio: { id: mediaId },
  };
  if (asVoice) {
    // voice:true hace que WhatsApp lo muestre como nota de voz (PTT)
    payload.audio.voice = true;
  }
  await axiosWA.post(`/${META.PHONE_ID}/messages`, payload);
}

/**
 * Sube un buffer de documento (PDF u otro) a WhatsApp Media y devuelve el media_id.
 * Espeja waSendPdf de index.js ~L4203 (paso 1 de 2).
 *
 * @param {Buffer} docBuffer
 * @param {string} filename   p.ej. 'CM-FR-004-2026-0001.pdf'
 * @returns {Promise<string>} media_id
 */
export async function uploadWaDocument(docBuffer, filename) {
  if (!META.TOKEN || !META.PHONE_ID) {
    throw new Error('[wa-adapter] uploadWaDocument: meta_credentials_missing');
  }
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'document');
  form.append('file', docBuffer, { filename, contentType: 'application/pdf' });
  const resp = await axiosWA.post(`/${META.PHONE_ID}/media`, form, {
    headers: form.getHeaders(),
    timeout: 30000,
  });
  const mediaId = resp.data?.id;
  if (!mediaId) throw new Error('[wa-adapter] uploadWaDocument: no se obtuvo media_id de WhatsApp');
  return mediaId;
}

/**
 * Envía un documento PDF ya subido como adjunto de WhatsApp.
 * Espeja waSendPdf de index.js ~L4218 (paso 2 de 2).
 *
 * @param {string} to        waId destino (sin '+')
 * @param {string} mediaId   id devuelto por uploadWaDocument
 * @param {string} filename  nombre de archivo que verá el receptor
 * @param {string} [caption] texto que acompaña al documento (opcional)
 * @returns {Promise<{ ok: boolean, msgId?: string, error?: string }>}
 */
export async function sendWaDocument(to, mediaId, filename, caption = '') {
  if (!META.TOKEN || !META.PHONE_ID) {
    throw new Error('[wa-adapter] sendWaDocument: meta_credentials_missing');
  }
  try {
    const r = await axiosWA.post(`/${META.PHONE_ID}/messages`, {
      messaging_product: 'whatsapp',
      to: String(to).replace(/^\+/, ''),
      type: 'document',
      document: { id: mediaId, filename, caption: caption || '' },
    });
    const msgId = r.data?.messages?.[0]?.id;
    console.log(`[wa-adapter] document_sent to=${to} file=${filename} msgId=${msgId || '?'}`);
    return { ok: true, msgId };
  } catch (err) {
    const e = err.response?.data || err.message;
    console.error('[wa-adapter] document_send_failed:', typeof e === 'string' ? e : JSON.stringify(e));
    return { ok: false, error: typeof e === 'string' ? e : JSON.stringify(e) };
  }
}
