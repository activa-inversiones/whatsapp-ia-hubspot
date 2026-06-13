// whatsapp-adapter.js — Capa de WhatsApp (Meta Cloud API) para Oliver v2
// ESM | Node 18+ | axios
//
// Reutiliza EXACTAMENTE las mismas env vars que index.js (el monolito v11.8.1):
//   - META_GRAPH_VERSION  → versión del Graph API (default "v22.0")
//   - WHATSAPP_TOKEN       → access token (Bearer)
//   - PHONE_NUMBER_ID      → phone number id del número de WhatsApp
// Estas ya existen en el entorno de Railway; NO inventar nombres nuevos.

import axios from "axios";

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
  } else {
    // audio, image, document, location, sticker, etc.
    text = `[${type}]`;
  }

  return { ok: true, from: msg.from, text, msgId: msg.id, type };
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
