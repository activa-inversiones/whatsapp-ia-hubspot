// multiChannelHandler.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════
// ACTIVA — Multi-Channel Message Handler
// ═══════════════════════════════════════════════════════════════════
// Maneja mensajes de Instagram DM, Facebook Messenger y WhatsApp
// a través de la Meta Graph API unificada.
// ═══════════════════════════════════════════════════════════════════
// INSTALACIÓN:
// 1. Subir a whatsapp-ia-hubspot/services/multiChannelHandler.js
// 2. Agregar import en index.js (ver PATCH)
// 3. Agregar variables en Railway (ver abajo)
// ═══════════════════════════════════════════════════════════════════
// VARIABLES RAILWAY (whatsapp-ia-hubspot):
//   META_PAGE_ACCESS_TOKEN=<token de página Facebook>
//   META_PAGE_ID=<ID página Facebook>
//   META_IG_BUSINESS_ID=<ID cuenta IG business>
// ═══════════════════════════════════════════════════════════════════

const PAGE_TOKEN = process.env.META_PAGE_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || "";
const PAGE_ID = process.env.META_PAGE_ID || "";
const IG_ID = process.env.META_IG_BUSINESS_ID || "";
// [2026-06-14] API NUEVA de Instagram (graph.instagram.com) con su propio token de larga duración.
// Antes IG se enviaba por el modelo viejo (graph.facebook.com/{PAGE_ID}) — eso requería vincular
// la cuenta IG a una Página de FB. El modelo nuevo manda directo con META_IG_ACCESS_TOKEN.
const IG_TOKEN = process.env.META_IG_ACCESS_TOKEN || PAGE_TOKEN;
const GRAPH_VER = process.env.META_GRAPH_VERSION || "v22.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VER}`;
const IG_GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VER}`;

// [2026-07-13 sec] fetch con timeout/AbortController — mismo patrón que
// services/igFbMediaBridge.js (fetchWithTimeout, líneas 176-184) para que
// las llamadas a Graph API nunca queden colgadas indefinidamente si Meta
// no responde. Cambio quirúrgico: solo envuelve fetch(), no cambia el
// resultado en el camino feliz (mismo response, mismo try/catch del caller).
const FETCH_TIMEOUT_MS = 15000;
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 1. DETECTAR CANAL DEL WEBHOOK
// ═══════════════════════════════════════════════════════════════════

/**
 * Analiza el body del webhook de Meta y detecta el canal.
 * Meta envía webhooks de WhatsApp, Instagram y Messenger por el mismo endpoint.
 * 
 * @param {object} body - req.body del webhook
 * @returns {{ channel: string, message: object|null, senderId: string, senderName: string, pageId: string }}
 */
export function detectChannel(body) {
  const entry = body?.entry?.[0];
  if (!entry) return { channel: "unknown", message: null, senderId: "", senderName: "", pageId: "" };

  // WHATSAPP — tiene entry.changes[0].value.messaging_product === "whatsapp"
  const changes = entry.changes?.[0];
  if (changes?.value?.messaging_product === "whatsapp") {
    const msg = changes.value.messages?.[0];
    if (!msg) return { channel: "whatsapp", message: null, senderId: "", senderName: "", pageId: "" };
    const contact = changes.value.contacts?.[0];
    return {
      channel: "whatsapp",
      message: msg,
      senderId: msg.from,
      senderName: contact?.profile?.name || "",
      pageId: changes.value.metadata?.phone_number_id || "",
      isStatus: !!changes.value.statuses?.length,
    };
  }

  // INSTAGRAM — tiene entry.messaging con instagram-specific fields
  const messaging = entry.messaging?.[0];
  if (messaging) {
    const isInstagram = entry.id === IG_ID || messaging?.sender?.id?.length < 20;

    // Detectar si es Instagram o Facebook Messenger
    if (isInstagram || body?.object === "instagram") {
      return {
        channel: "instagram",
        message: messaging.message || null,
        senderId: messaging.sender?.id || "",
        senderName: "",
        pageId: entry.id || "",
        isEcho: !!messaging.message?.is_echo,
        timestamp: messaging.timestamp,
      };
    }

    // FACEBOOK MESSENGER
    return {
      channel: "facebook",
      message: messaging.message || null,
      senderId: messaging.sender?.id || "",
      senderName: "",
      pageId: messaging.recipient?.id || entry.id || "",
      isEcho: !!messaging.message?.is_echo,
      timestamp: messaging.timestamp,
      postback: messaging.postback || null,
    };
  }

  return { channel: "unknown", message: null, senderId: "", senderName: "", pageId: "" };
}

// ═══════════════════════════════════════════════════════════════════
// 2. EXTRAER TEXTO DEL MENSAJE
// ═══════════════════════════════════════════════════════════════════

/**
 * Extrae el texto del mensaje sin importar el canal.
 */
export function extractText(channel, message) {
  if (!message) return "";

  if (channel === "whatsapp") {
    if (message.type === "text") return message.text?.body || "";
    if (message.type === "button") return message.button?.text || "";
    if (message.type === "interactive") {
      const ir = message.interactive;
      return ir?.button_reply?.title || ir?.list_reply?.title || JSON.stringify(ir);
    }
    // [2026-08-08] La reacción caía en el cajón de sastre de abajo y se guardaba como
    // "[reaction]", tirando el emoji. Dos daños: el dueño no ve QUÉ le reaccionaron, y
    // Oliver — cuyo prompt dice "ante emoji asuma conformidad y avance" — leía igual un
    // 👍 que un 😢. Emoji vacío = el cliente RETIRÓ la reacción, no es conformidad.
    if (message.type === "reaction") {
      const e = message.reaction?.emoji;
      return e ? `${e} (reaccionó)` : "(retiró su reacción)";
    }
    return `[${message.type || "media"}]`;
  }

  // Instagram / Facebook Messenger
  if (message.text) return message.text;
  if (message.attachments?.length) {
    const att = message.attachments[0];
    return `[${att.type || "attachment"}]`;
  }
  return "";
}

// ═══════════════════════════════════════════════════════════════════
// 3. ENVIAR MENSAJE POR CANAL
// ═══════════════════════════════════════════════════════════════════

/**
 * Envía un mensaje al usuario por el canal correcto.
 * 
 * @param {string} channel - "whatsapp" | "instagram" | "facebook"
 * @param {string} recipientId - ID del destinatario
 * @param {string} text - Texto del mensaje
 * @param {Function} waSend - Función existente de envío WhatsApp (para reusar)
 */
export async function sendMessage(channel, recipientId, text, waSend) {
  if (channel === "whatsapp") {
    // Usar la función existente del bot
    if (waSend) return waSend(recipientId, text);
    return { ok: false, error: "waSend not provided" };
  }

  if (channel === "instagram" || channel === "facebook") {
    try {
      // [2026-06-14] Instagram usa la API NUEVA (graph.instagram.com/{ver}/me/messages con IG_TOKEN).
      // Facebook Messenger sigue con la API vieja (graph.facebook.com/{PAGE_ID}/messages con PAGE_TOKEN).
      const isIG = channel === "instagram";
      const url = isIG
        ? `${IG_GRAPH_BASE}/me/messages`
        : `${GRAPH_BASE}/${PAGE_ID}/messages`;
      const token = isIG ? IG_TOKEN : PAGE_TOKEN;

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: text.substring(0, 2000) },
          messaging_type: "RESPONSE",
        }),
      });

      const data = await resp.json();
      if (data.error) {
        // [2026-06-14] Ventana de 24h de Meta: code 10 / subcode 2018278 (fuera de la sesión de
        // mensajería estándar). Lo distinguimos para que el cerebro/operador NO crea que entregó.
        const code = data.error.code;
        const sub = data.error.error_subcode;
        const outsideWindow = code === 10 || sub === 2018278 || sub === 2022;
        console.error(`[multiChannel] Error enviando a ${channel}:`, data.error.message, outsideWindow ? "(fuera de ventana 24h)" : "");
        return { ok: false, error: data.error.message, code, error_subcode: sub, outsideWindow };
      }
      return { ok: true, messageId: data.message_id };
    } catch (e) {
      console.error(`[multiChannel] Error enviando a ${channel}:`, e.message);
      return { ok: false, error: e.message };
    }
  }

  return { ok: false, error: `Canal no soportado: ${channel}` };
}

// ═══════════════════════════════════════════════════════════════════
// 3b. ENTREGAR DOCUMENTO (PDF) POR CANAL — SUBIDA BINARIA  [2026-06-14]
//     El PDF se sube DIRECTO a Meta (multipart, como WhatsApp) → NUNCA queda en una
//     URL pública: la competencia no puede ver precios. FB siempre; IG si la cuenta
//     está ligada a una Página de FB (IG Business). Si falla → el llamador hace fallback
//     (escala / WhatsApp). PDF ≤ 25 MB, filename ASCII (Meta rechaza no-ASCII).
// ═══════════════════════════════════════════════════════════════════

/**
 * Sube un archivo binario a Meta (Attachment Upload API) → attachment_id.
 * Upload SIEMPRE por graph.facebook.com/{PAGE_ID}/message_attachments con PAGE_TOKEN
 * (para IG se agrega platform=instagram; requiere la cuenta IG ligada a la Página).
 * @returns {Promise<{ok:boolean, attachmentId?:string, error?:string}>}
 */
export async function uploadChannelMedia(channel, buffer, filename = "documento.pdf", mimeType = "application/pdf") {
  if (channel !== "instagram" && channel !== "facebook") return { ok: false, error: `canal no soportado: ${channel}` };
  if (!PAGE_ID || !PAGE_TOKEN) return { ok: false, error: "META_PAGE_ID/META_PAGE_ACCESS_TOKEN no configurados (requeridos para subir adjuntos)" };
  try {
    const safeName = String(filename).replace(/[^\x20-\x7E]/g, "_"); // Meta rechaza nombres no-ASCII
    const form = new FormData();
    form.append("message", JSON.stringify({ attachment: { type: "file", payload: { is_reusable: false } } }));
    if (channel === "instagram") form.append("platform", "instagram");
    form.append("filedata", new Blob([buffer], { type: mimeType }), safeName);
    const url = `${GRAPH_BASE}/${PAGE_ID}/message_attachments?access_token=${encodeURIComponent(PAGE_TOKEN)}`;
    const resp = await fetch(url, { method: "POST", body: form });
    const data = await resp.json();
    if (data.error || !data.attachment_id) {
      console.error(`[multiChannel] upload adjunto ${channel}:`, data.error?.message || "sin attachment_id");
      return { ok: false, error: data.error?.message || "sin attachment_id" };
    }
    return { ok: true, attachmentId: data.attachment_id };
  } catch (e) {
    console.error(`[multiChannel] upload adjunto ${channel}:`, e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Entrega un PDF (buffer) por IG/FB: lo sube binario a Meta y lo envía por attachment_id.
 * NUNCA usa una URL pública. Body IG (graph.instagram.com, SIN messaging_type — IG lo rechaza
 * con #100) vs FB (graph.facebook.com, con messaging_type:RESPONSE). El caption va como texto aparte.
 * @returns {Promise<{ok:boolean, messageId?:string, error?:string, outsideWindow?:boolean}>}
 */
export async function sendChannelDocument(channel, recipientId, buffer, filename = "cotizacion.pdf", caption = "") {
  if (channel !== "instagram" && channel !== "facebook") return { ok: false, error: `canal no soportado: ${channel}` };
  const up = await uploadChannelMedia(channel, buffer, filename, "application/pdf");
  if (!up.ok) return { ok: false, error: up.error };
  try {
    const isIG = channel === "instagram";
    const url = isIG ? `${IG_GRAPH_BASE}/me/messages` : `${GRAPH_BASE}/${PAGE_ID}/messages`;
    const token = isIG ? IG_TOKEN : PAGE_TOKEN;
    const body = {
      recipient: { id: recipientId },
      message: { attachment: { type: "file", payload: { attachment_id: up.attachmentId } } },
    };
    if (!isIG) body.messaging_type = "RESPONSE"; // solo FB; IG rechaza messaging_type (#100)
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.error) {
      const code = data.error.code, sub = data.error.error_subcode;
      const outsideWindow = code === 10 || sub === 2018278 || sub === 2022;
      console.error(`[multiChannel] Error enviar doc ${channel}:`, data.error.message, outsideWindow ? "(fuera de ventana 24h)" : "");
      return { ok: false, error: data.error.message, code, error_subcode: sub, outsideWindow };
    }
    if (caption) await sendMessage(channel, recipientId, caption, null).catch(() => {});
    return { ok: true, messageId: data.message_id };
  } catch (e) {
    console.error(`[multiChannel] Error enviar doc ${channel}:`, e.message);
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 3c. ENTREGAR AUDIO POR CANAL — SUBIDA BINARIA  [2026-07-13]
//     CLON de uploadChannelMedia + sendChannelDocument, pero con attachment type "audio"
//     (Meta exige un tipo distinto a "file" para que el cliente lo reciba como nota de voz
//     reproducible en vez de un adjunto descargable). Duplica la lógica de upload INLINE
//     a propósito — NO toca uploadChannelMedia/sendChannelDocument existentes (cero riesgo
//     sobre el flujo de PDF de cotización ya en producción).
// ═══════════════════════════════════════════════════════════════════

/**
 * Sube un audio (buffer) a Meta y lo entrega por IG/FB como attachment type "audio".
 * @returns {Promise<{ok:boolean, messageId?:string, error?:string, outsideWindow?:boolean}>}
 */
export async function sendChannelAudio(channel, recipientId, buffer, filename = "audio.mp3", mimeType = "audio/mpeg") {
  if (channel !== "instagram" && channel !== "facebook") return { ok: false, error: `canal no soportado: ${channel}` };
  if (!PAGE_ID || !PAGE_TOKEN) return { ok: false, error: "META_PAGE_ID/META_PAGE_ACCESS_TOKEN no configurados (requeridos para subir adjuntos)" };

  // Upload (duplicado inline de uploadChannelMedia, con type:"audio" en vez de "file")
  let attachmentId;
  try {
    const safeName = String(filename).replace(/[^\x20-\x7E]/g, "_"); // Meta rechaza nombres no-ASCII
    const form = new FormData();
    form.append("message", JSON.stringify({ attachment: { type: "audio", payload: { is_reusable: false } } }));
    if (channel === "instagram") form.append("platform", "instagram");
    form.append("filedata", new Blob([buffer], { type: mimeType }), safeName);
    const uploadUrl = `${GRAPH_BASE}/${PAGE_ID}/message_attachments?access_token=${encodeURIComponent(PAGE_TOKEN)}`;
    const upResp = await fetchWithTimeout(uploadUrl, { method: "POST", body: form });
    const upData = await upResp.json();
    if (upData.error || !upData.attachment_id) {
      console.error(`[multiChannel] upload audio ${channel}:`, upData.error?.message || "sin attachment_id");
      return { ok: false, error: upData.error?.message || "sin attachment_id" };
    }
    attachmentId = upData.attachment_id;
  } catch (e) {
    console.error(`[multiChannel] upload audio ${channel}:`, e.message);
    return { ok: false, error: e.message };
  }

  // Send (duplicado inline de sendChannelDocument, con attachment type:"audio")
  try {
    const isIG = channel === "instagram";
    const url = isIG ? `${IG_GRAPH_BASE}/me/messages` : `${GRAPH_BASE}/${PAGE_ID}/messages`;
    const token = isIG ? IG_TOKEN : PAGE_TOKEN;
    const body = {
      recipient: { id: recipientId },
      message: { attachment: { type: "audio", payload: { attachment_id: attachmentId } } },
    };
    if (!isIG) body.messaging_type = "RESPONSE"; // solo FB; IG rechaza messaging_type (#100)
    const resp = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.error) {
      const code = data.error.code, sub = data.error.error_subcode;
      const outsideWindow = code === 10 || sub === 2018278 || sub === 2022;
      console.error(`[multiChannel] Error enviar audio ${channel}:`, data.error.message, outsideWindow ? "(fuera de ventana 24h)" : "");
      return { ok: false, error: data.error.message, code, error_subcode: sub, outsideWindow };
    }
    return { ok: true, messageId: data.message_id };
  } catch (e) {
    console.error(`[multiChannel] Error enviar audio ${channel}:`, e.message);
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 3d. ENVIAR MEDIA POR URL DIRECTA (catálogo público)  [2026-07-13]
//     A diferencia del PDF de cotización (sendChannelDocument, SIEMPRE binario porque el
//     precio no puede ser público), acá el activo YA es público a propósito (fotos de
//     catálogo, videos institucionales) → se envía por URL, sin subir el binario a Meta.
//     Mismo patrón de detección de ventana 24h que sendMessage/sendChannelDocument.
// ═══════════════════════════════════════════════════════════════════

/**
 * Envía un asset (imagen/video/audio/file) por URL pública directa.
 * @param {string} mediaType - "image" | "video" | "audio" | "file" (tipo de attachment de Meta)
 * @returns {Promise<{ok:boolean, messageId?:string, error?:string, outsideWindow?:boolean}>}
 */
export async function sendChannelMediaAsset(channel, recipientId, url, mediaType = "image", caption = "") {
  if (channel !== "instagram" && channel !== "facebook") return { ok: false, error: `canal no soportado: ${channel}` };
  try {
    const isIG = channel === "instagram";
    const apiUrl = isIG ? `${IG_GRAPH_BASE}/me/messages` : `${GRAPH_BASE}/${PAGE_ID}/messages`;
    const token = isIG ? IG_TOKEN : PAGE_TOKEN;
    const body = {
      recipient: { id: recipientId },
      message: { attachment: { type: mediaType, payload: { url, is_reusable: true } } },
    };
    if (!isIG) body.messaging_type = "RESPONSE"; // solo FB; IG rechaza messaging_type (#100)
    const resp = await fetchWithTimeout(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.error) {
      const code = data.error.code, sub = data.error.error_subcode;
      const outsideWindow = code === 10 || sub === 2018278 || sub === 2022;
      console.error(`[multiChannel] Error enviar media ${channel}:`, data.error.message, outsideWindow ? "(fuera de ventana 24h)" : "");
      return { ok: false, error: data.error.message, code, error_subcode: sub, outsideWindow };
    }
    if (caption) await sendMessage(channel, recipientId, caption, null).catch(() => {});
    return { ok: true, messageId: data.message_id };
  } catch (e) {
    console.error(`[multiChannel] Error enviar media ${channel}:`, e.message);
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 4. OBTENER PERFIL DEL USUARIO
// ═══════════════════════════════════════════════════════════════════

const profileCache = new Map();

/**
 * Obtiene el nombre del usuario desde Meta Graph API.
 */
export async function getUserProfile(channel, userId) {
  const cacheKey = `${channel}:${userId}`;
  if (profileCache.has(cacheKey)) return profileCache.get(cacheKey);

  if (channel === "whatsapp") {
    // WhatsApp no tiene endpoint de perfil — se obtiene del webhook
    return { name: "", channel };
  }

  try {
    // [2026-06-14] Instagram usa la API NUEVA (graph.instagram.com + IG_TOKEN). Con el modelo
    // viejo (graph.facebook.com + PAGE_TOKEN) el IGSID no resolvía → el nombre quedaba vacío
    // y el lead salía como "IG_<id>". Facebook sigue con la API vieja.
    const isIG = channel === "instagram";
    const url = isIG
      ? `${IG_GRAPH_BASE}/${userId}?fields=name,username&access_token=${IG_TOKEN}`
      : `${GRAPH_BASE}/${userId}?fields=name,profile_pic&access_token=${PAGE_TOKEN}`;
    const resp = await fetch(url);
    const data = await resp.json();
    const profile = {
      name: data.name || data.username || "",
      profilePic: data.profile_pic || "",
      channel,
    };
    profileCache.set(cacheKey, profile);
    // Limpiar cache cada 1000 entradas
    if (profileCache.size > 1000) {
      const oldest = profileCache.keys().next().value;
      profileCache.delete(oldest);
    }
    return profile;
  } catch (e) {
    return { name: "", channel };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 5. NORMALIZAR MENSAJE PARA EL PIPELINE
// ═══════════════════════════════════════════════════════════════════

/**
 * Normaliza un mensaje entrante de cualquier canal al formato interno.
 * Este formato es compatible con el pipeline existente del bot.
 */
export function normalizeIncoming(body) {
  const detected = detectChannel(body);
  const { channel, message, senderId, senderName, isEcho, isStatus } = detected;

  // Ignorar ecos y statuses
  if (isEcho || isStatus || !message) {
    return { ok: false, reason: isEcho ? "echo" : isStatus ? "status" : "no_message" };
  }

  const text = extractText(channel, message);
  // [2026-06-14] Si Meta no manda mid (eventos raros), derivar un id ESTABLE del
  // timestamp del evento + el texto — NO de Date.now() (que cambiaba en cada reintrega
  // de Meta y burlaba el dedupe → respuestas duplicadas).
  const msgId = channel === "whatsapp"
    ? message.id
    : (message.mid || `${channel}_${senderId}_${detected.timestamp || 0}_${(text || "").slice(0, 40)}`);

  return {
    ok: true,
    channel,
    senderId,
    senderName,
    msgId,
    text,
    type: channel === "whatsapp" ? (message.type || "text") : "text",
    audioId: message.audio?.id || null,
    imageId: message.image?.id || (message.attachments?.[0]?.type === "image" ? message.attachments[0].payload?.url : null),
    raw: message,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 6. PUSH A SALES-OS CON CANAL
// ═══════════════════════════════════════════════════════════════════

/**
 * Construye el payload para pushLeadEvent con info del canal.
 */
export function buildLeadPayload(channel, senderId, senderName, text, direction = "inbound", actorType = "customer") {
  const channelIcons = {
    whatsapp: "🟢",
    instagram: "📸",
    facebook: "💬",
    web: "🌐",
    phone: "📞",
  };

  return {
    channel,
    external_id: senderId,
    customer_name: senderName,
    body: text,
    direction,
    actor_type: actorType,
    actor_name: actorType === "customer" ? senderName : "Bot IA",
    message_type: "text",
    metadata: {
      source: `${channel}_webhook`,
      channel_icon: channelIcons[channel] || "💬",
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 6b. DEDUP + RATE LIMIT — [2026-07-13 sec]
//     WhatsApp ya tiene isDup()+rateOk() en index.js (líneas 2564-2583,
//     cap 18 msj/min) pero el webhook de IG/FB no tenía NINGÚN freno —
//     cualquier DM público podía mandar decenas de mensajes/audios por
//     minuto y cada uno disparaba una llamada completa al cerebro (LLM).
//     Mismo patrón acá, self-contained (archivo separado, variables
//     propias — CERO cambio al camino de WhatsApp). Solo bloquea tráfico
//     duplicado (reintentos de Meta) o abusivo (ráfagas); un cliente
//     real escribiendo normal nunca lo nota.
// ═══════════════════════════════════════════════════════════════════

const _seenChannelMsgIds = new Map(); // msgId -> timestamp (dedup reintentos de Meta)
const _rateByChannelSender = new Map(); // senderId -> { n, resetAt } (ráfagas por minuto)

const _DEDUP_TTL_MS = 2 * 60_000; // 2 min — igual a SEEN_TTL de index.js
const _RATE_WINDOW_MS = 60_000; // 1 min
const _RATE_MAX_PER_MIN = Number(process.env.IG_FB_RATE_LIMIT_PER_MIN) > 0
  ? Number(process.env.IG_FB_RATE_LIMIT_PER_MIN)
  : 18; // mismo tope que WhatsApp (index.js rateOk)

/** @returns {boolean} true si msgId ya fue procesado (reintento de Meta a descartar). */
function isDupChannelMsg(msgId) {
  if (!msgId) return false;
  if (_seenChannelMsgIds.has(msgId)) return true;
  _seenChannelMsgIds.set(msgId, Date.now());
  return false;
}

/** @returns {{ok:boolean, msg?:string}} cap de mensajes/minuto por remitente (canal:senderId). */
function channelRateOk(convKey) {
  if (!convKey) return { ok: true };
  const now = Date.now();
  let r = _rateByChannelSender.get(convKey);
  if (!r || now >= r.resetAt) {
    r = { n: 0, resetAt: now + _RATE_WINDOW_MS };
    _rateByChannelSender.set(convKey, r);
  }
  r.n++;
  return r.n > _RATE_MAX_PER_MIN
    ? { ok: false, msg: "Escribes muy rápido 😅 Dame 10 seg." }
    : { ok: true };
}

// Purga periódica — evita memory leak (mismo espíritu que el cleanup de
// index.js líneas 2585-2600: sin esto, los Map crecen sin límite).
// [Ronda 2 2026-07-20] .unref(): el interval NO mantiene vivo el proceso — en producción
// corre igual (el server siempre está vivo), pero cualquier test que importe este módulo
// (vía channel-agent) ya no queda colgado esperando un interval de 5 min (causa real de
// que `npm test` NUNCA terminara solo, cazada en la auditoría cruzada).
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of _seenChannelMsgIds) {
    if (now - ts > _DEDUP_TTL_MS) _seenChannelMsgIds.delete(id);
  }
  for (const [id, r] of _rateByChannelSender) {
    if (now - r.resetAt > _RATE_WINDOW_MS * 5) _rateByChannelSender.delete(id);
  }
}, 5 * 60_000).unref();

// ═══════════════════════════════════════════════════════════════════
// 6c. REDACTAR ADJUNTOS ANTES DE LOGUEAR — [2026-07-13 sec]
//     El log FASE 0 (IG_FB_LOG_RAW_ATTACHMENTS) volcaba attachments[] CRUDO,
//     incluyendo payload.url (URL real de CDN de Meta del adjunto del
//     cliente) en texto plano a los logs de Railway. Cualquiera con acceso
//     a esos logs podía abrir la foto/audio privado mientras la firma de
//     la URL siguiera vigente. Se conserva el "shape" (type, presencia y
//     longitud de la url) que FASE 0 necesita para diseñar igFbMediaBridge,
//     pero se redacta el valor real.
// ═══════════════════════════════════════════════════════════════════

function redactAttachmentsForLog(attachments) {
  if (!Array.isArray(attachments)) return attachments;
  return attachments.map((att) => {
    if (!att || typeof att !== "object") return att;
    const copy = { ...att };
    if (copy.payload && typeof copy.payload === "object") {
      const payloadCopy = { ...copy.payload };
      if (typeof payloadCopy.url === "string") {
        payloadCopy.url = `[REDACTED len=${payloadCopy.url.length}]`;
      }
      copy.payload = payloadCopy;
    }
    return copy;
  });
}

// ═══════════════════════════════════════════════════════════════════
// 7. REGISTRO DE RUTAS MULTI-CANAL
// ═══════════════════════════════════════════════════════════════════

/**
 * Registra webhook endpoints para Instagram y Facebook Messenger.
 * WhatsApp ya tiene su propio webhook en /webhook.
 * 
 * NOTA: Meta permite usar el MISMO endpoint /webhook para todo,
 * pero separamos para claridad. Si prefieres unificar, usa detectChannel()
 * dentro del handler /webhook existente.
 */
export function registerMultiChannelRoutes(app, { processMessage, waSend, logInfo, logErr, verifySig }) {
  // Verificación de webhook (Meta usa GET para verificar)
  app.get("/webhook/instagram", (req, res) => {
    const VERIFY = process.env.VERIFY_TOKEN;
    if (req.query["hub.verify_token"] === VERIFY) {
      return res.send(req.query["hub.challenge"]);
    }
    res.sendStatus(403);
  });

  app.get("/webhook/facebook", (req, res) => {
    const VERIFY = process.env.VERIFY_TOKEN;
    if (req.query["hub.verify_token"] === VERIFY) {
      return res.send(req.query["hub.challenge"]);
    }
    res.sendStatus(403);
  });

  // Instagram DM webhook
  app.post("/webhook/instagram", async (req, res) => {
    res.sendStatus(200);

    // [2026-06-14 sec] Validar firma de Meta (X-Hub-Signature-256), igual que WhatsApp.
    // Sin esto, cualquiera con la URL podía inyectar mensajes falsos (gasta IA, ensucia CRM, spamea).
    if (typeof verifySig === "function" && !verifySig(req)) {
      logErr("instagram.webhook", new Error("firma_invalida"));
      return;
    }

    // [2026-07-13 FASE 0, temporal] Loguear el shape real de attachments[] (imagen/audio) antes
    // de construir igFbMediaBridge.js — solo con flag ON, no cambia ningún comportamiento.
    // [2026-07-13 sec] Adjuntos REDACTADOS antes de loguear (ver redactAttachmentsForLog):
    // el payload.url crudo es la URL real de CDN del archivo del cliente, no debe llegar a los logs.
    if (process.env.IG_FB_LOG_RAW_ATTACHMENTS === "true" && req.body?.entry?.[0]?.messaging?.[0]?.message?.attachments) {
      logInfo("igfb.raw_attachment", JSON.stringify(redactAttachmentsForLog(req.body.entry[0].messaging[0].message.attachments)));
    }

    try {
      const normalized = normalizeIncoming(req.body);
      if (!normalized.ok) return;

      const { channel, senderId, senderName, text, msgId } = normalized;

      // [2026-07-13 sec] Dedup (reintentos de Meta) + rate-limit (ráfagas) — mismo
      // freno que ya tiene WhatsApp (index.js isDup/rateOk). Sin esto, cualquier DM
      // público podía mandar decenas de mensajes/min y cada uno llegaba al cerebro (LLM).
      if (isDupChannelMsg(msgId)) return;
      const rc = channelRateOk(`instagram:${senderId}`);
      if (!rc.ok) {
        await sendMessage("instagram", senderId, rc.msg, null).catch(() => {});
        return;
      }

      logInfo("instagram", `Mensaje de ${senderId}: ${text.substring(0, 50)}`);

      // Obtener perfil
      const profile = await getUserProfile("instagram", senderId);
      const name = profile.name || senderName || `IG_${senderId}`;

      // Procesar con el mismo pipeline del bot
      if (processMessage) {
        await processMessage({
          channel: "instagram",
          senderId,
          senderName: name,
          text,
          msgId,
          attachments: normalized.raw?.attachments || null,
          sendFn: (to, msg) => sendMessage("instagram", to, msg),
        });
      }
    } catch (e) {
      logErr("instagram.webhook", e);
    }
  });

  // Facebook Messenger webhook
  app.post("/webhook/facebook", async (req, res) => {
    res.sendStatus(200);

    // [2026-06-14 sec] Validar firma de Meta (X-Hub-Signature-256), igual que WhatsApp.
    if (typeof verifySig === "function" && !verifySig(req)) {
      logErr("facebook.webhook", new Error("firma_invalida"));
      return;
    }

    // [2026-07-13 FASE 0, temporal] Loguear el shape real de attachments[] (imagen/audio) antes
    // de construir igFbMediaBridge.js — solo con flag ON, no cambia ningún comportamiento.
    // [2026-07-13 sec] Adjuntos REDACTADOS antes de loguear (ver redactAttachmentsForLog):
    // el payload.url crudo es la URL real de CDN del archivo del cliente, no debe llegar a los logs.
    if (process.env.IG_FB_LOG_RAW_ATTACHMENTS === "true" && req.body?.entry?.[0]?.messaging?.[0]?.message?.attachments) {
      logInfo("igfb.raw_attachment", JSON.stringify(redactAttachmentsForLog(req.body.entry[0].messaging[0].message.attachments)));
    }

    try {
      const normalized = normalizeIncoming(req.body);
      if (!normalized.ok) return;

      const { channel, senderId, senderName, text, msgId } = normalized;

      // [2026-07-13 sec] Dedup (reintentos de Meta) + rate-limit (ráfagas) — mismo
      // freno que ya tiene WhatsApp (index.js isDup/rateOk). Sin esto, cualquier DM
      // público podía mandar decenas de mensajes/min y cada uno llegaba al cerebro (LLM).
      if (isDupChannelMsg(msgId)) return;
      const rc = channelRateOk(`facebook:${senderId}`);
      if (!rc.ok) {
        await sendMessage("facebook", senderId, rc.msg, null).catch(() => {});
        return;
      }

      logInfo("facebook", `Mensaje de ${senderId}: ${text.substring(0, 50)}`);

      // Obtener perfil
      const profile = await getUserProfile("facebook", senderId);
      const name = profile.name || senderName || `FB_${senderId}`;

      // Procesar con el mismo pipeline del bot
      if (processMessage) {
        await processMessage({
          channel: "facebook",
          senderId,
          senderName: name,
          text,
          msgId,
          attachments: normalized.raw?.attachments || null,
          sendFn: (to, msg) => sendMessage("facebook", to, msg),
        });
      }
    } catch (e) {
      logErr("facebook.webhook", e);
    }
  });

  // Endpoint para enviar mensajes desde el dashboard (cualquier canal)
  app.post("/api/send-message", async (req, res) => {
    const key = req.get("x-api-key") || "";
    if (key !== (process.env.DASHBOARD_API_KEY || "")) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const { channel, recipientId, text } = req.body;
    if (!channel || !recipientId || !text) {
      return res.status(400).json({ ok: false, error: "channel, recipientId, text required" });
    }

    try {
      const result = await sendMessage(channel, recipientId, text, waSend);
      res.json({ ok: result.ok, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Estado de canales
  app.get("/api/channels/status", (req, res) => {
    res.json({
      ok: true,
      channels: {
        whatsapp: { active: true, configured: !!process.env.WHATSAPP_TOKEN },
        instagram: { active: !!IG_ID, configured: !!IG_ID && !!IG_TOKEN },
        facebook: { active: !!PAGE_ID, configured: !!PAGE_ID && !!PAGE_TOKEN },
        web: { active: true, configured: true },
        phone: { active: true, configured: !!process.env.ESCALATION_PHONE },
      },
    });
  });

  logInfo("multiChannel", `✅ Multi-channel routes registered — IG: ${IG_ID ? "ON" : "OFF"}, FB: ${PAGE_ID ? "ON" : "OFF"}`);
}

export default {
  detectChannel,
  extractText,
  sendMessage,
  sendChannelDocument,
  sendChannelAudio,
  sendChannelMediaAsset,
  uploadChannelMedia,
  getUserProfile,
  normalizeIncoming,
  buildLeadPayload,
  registerMultiChannelRoutes,
};
