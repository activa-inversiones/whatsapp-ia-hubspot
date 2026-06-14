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
  const msgId = channel === "whatsapp"
    ? message.id
    : message.mid || `${channel}_${senderId}_${Date.now()}`;

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

    try {
      const normalized = normalizeIncoming(req.body);
      if (!normalized.ok) return;

      const { channel, senderId, senderName, text, msgId } = normalized;
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

    try {
      const normalized = normalizeIncoming(req.body);
      if (!normalized.ok) return;

      const { channel, senderId, senderName, text, msgId } = normalized;
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
  getUserProfile,
  normalizeIncoming,
  buildLeadPayload,
  registerMultiChannelRoutes,
};
