import express from "express";
import axios from "axios";
import OpenAI from "openai";
import pdf from "pdf-parse";

/**
 * WhatsApp IA Hub (Activa)
 * - Webhook verification (GET /webhook)
 * - Incoming messages (POST /webhook)
 * - Text + PDF + Image processing
 * - Humanized typing indicator (Meta typing_indicator)
 * - Session memory + loop guard
 *
 * Node: ESM ("type": "module")
 */

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 8080;

// =====================
// ENV helpers
// =====================
const env = (k, d = undefined) => process.env[k] ?? d;
const envBool = (k, d = false) => {
  const v = (process.env[k] ?? "").toString().toLowerCase().trim();
  if (!v) return d;
  return ["1", "true", "yes", "y", "on"].includes(v);
};
const envInt = (k, d) => {
  const n = parseInt(process.env[k] ?? "", 10);
  return Number.isFinite(n) ? n : d;
};

// =====================
// Required ENV
// =====================
const WHATSAPP_TOKEN = env("WHATSAPP_TOKEN");
const PHONE_NUMBER_ID = env("PHONE_NUMBER_ID");
const VERIFY_TOKEN = env("VERIFY_TOKEN");
const META_GRAPH_VERSION = env("META_GRAPH_VERSION", "v22.0");
const OPENAI_API_KEY = env("OPENAI_API_KEY");

// =====================
// AI config
// =====================
const AI_PROVIDER = env("AI_PROVIDER", "openai"); // reserved
const AI_MODEL_OPENAI = env("AI_MODEL_OPENAI", "gpt-4o-mini"); // safe default
const AI_MODEL_VISION = env("AI_MODEL_VISION", "gpt-4o-mini");
const AI_TEMPERATURE = Number(env("AI_TEMPERATURE", "0.35"));
const AI_MAX_OUTPUT_TOKENS = envInt("AI_MAX_OUTPUT_TOKENS", 320);

// =====================
// Brand / style
// =====================
const COMPANY_NAME = env("COMPANY_NAME", "Activa");
const AGENT_NAME = env("AGENT_NAME", "Marcelo Cifuentes");
const LANGUAGE = env("LANGUAGE", "es-CL");
const TONO = env("TONO", "usted"); // usted | tu
const PILLARS = env("PILLARS", "térmico, acústico, seguridad, eficiencia energética");
const MINVU_EXPERT_NOTE = env(
  "MINVU_EXPERT_NOTE",
  "Especialista en especificación de ventanas bajo normativa chilena, con certificación MINVU (resolución y publicación en Diario Oficial)."
);

// =====================
// Humanization / pacing
// =====================
const WAIT_AFTER_LAST_USER_MESSAGE_MS = envInt("WAIT_AFTER_LAST_USER_MESSAGE_MS", 2500);
const EXTRA_DELAY_MEDIA_MS = envInt("EXTRA_DELAY_MEDIA_MS", 2500);
const TYPING_SIMULATION = envBool("TYPING_SIMULATION", true);
const TYPING_MIN_MS = envInt("TYPING_MIN_MS", 900);
const TYPING_MAX_MS = envInt("TYPING_MAX_MS", 2100);
const MAX_LINES_PER_REPLY = envInt("MAX_LINES_PER_REPLY", 8);
const ONE_QUESTION_PER_TURN = envBool("ONE_QUESTION_PER_TURN", true);

// Loop guard
const LOOP_GUARD_MAX_REPLIES_PER_5MIN = envInt("LOOP_GUARD_MAX_REPLIES_PER_5MIN", 6);

// =====================
// Optional size limits (JSON)
// Example:
// {
//   "PVC_EURO_S60": { "min": {"w":400,"h":400}, "max":{"w":2400,"h":2400} },
//   "PVC_SLIDING": { "min": {"w":800,"h":900}, "max":{"w":3600,"h":2400} }
// }
// =====================
let SIZE_LIMITS = {};
try {
  SIZE_LIMITS = JSON.parse(env("SIZE_LIMITS_JSON", "{}"));
} catch {
  SIZE_LIMITS = {};
}

// =====================
// OpenAI client
// =====================
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// =====================
// Basic sanity logs
// =====================
console.log("Starting Container");
console.log(`Server running on port ${PORT}`);
console.log(`ENV WHATSAPP_TOKEN: ${WHATSAPP_TOKEN ? "OK" : "MISSING"}`);
console.log(`ENV META_GRAPH_VERSION: ${META_GRAPH_VERSION}`);
console.log(`ENV VERIFY_TOKEN: ${VERIFY_TOKEN ? "OK" : "MISSING"}`);
console.log(`ENV PHONE_NUMBER_ID: ${PHONE_NUMBER_ID ? "OK" : "MISSING"}`);
console.log(`ENV OPENAI_API_KEY: ${OPENAI_API_KEY ? "OK" : "MISSING"}`);
console.log(`ENV AI_PROVIDER: ${AI_PROVIDER}`);
console.log(`ENV AI_MODEL_OPENAI: ${AI_MODEL_OPENAI}`);
console.log(`ENV AI_MODEL_VISION: ${AI_MODEL_VISION}`);
console.log(`TYPING_SIMULATION: ${TYPING_SIMULATION}`);

// =====================
// Health
// =====================
app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", (req, res) => res.status(200).json({ ok: true }));

// =====================
// Webhook verification (GET)
// =====================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// =====================
// Session store
// =====================
const sessions = new Map(); // key: waId
const processedMsgIds = new Set(); // basic dedupe
const maxProcessed = 2000;

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      waId,
      createdAt: Date.now(),
      lastSeenAt: 0,
      lastReplyAt: 0,
      repliesIn5Min: [],
      history: [], // {role:"user"|"assistant", content:"..."}
      context: {
        name: null,
        projectType: null,
        city: null,
        productInterest: null,
        measuresMm: [], // [{w,h,source}]
      },
    });
  }
  return sessions.get(waId);
}

function addProcessed(id) {
  if (!id) return;
  processedMsgIds.add(id);
  if (processedMsgIds.size > maxProcessed) {
    const first = processedMsgIds.values().next().value;
    processedMsgIds.delete(first);
  }
}

function loopGuardOk(session) {
  const now = Date.now();
  session.repliesIn5Min = session.repliesIn5Min.filter((t) => now - t < 5 * 60 * 1000);
  return session.repliesIn5Min.length < LOOP_GUARD_MAX_REPLIES_PER_5MIN;
}

function noteReply(session) {
  session.repliesIn5Min.push(Date.now());
  session.lastReplyAt = Date.now();
}

// =====================
// WhatsApp API helpers
// =====================
const WA_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}/${PHONE_NUMBER_ID}`;

async function waSendText(to, text, { replyToMessageId = null } = {}) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  if (replyToMessageId && envBool("REPLY_WITH_CONTEXT", true)) {
    payload.context = { message_id: replyToMessageId };
  }

  return axios.post(`${WA_BASE}/messages`, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });
}

/**
 * WhatsApp Typing Indicators (correct method):
 * POST /messages with:
 *  - status: "read"
 *  - message_id: <incoming WA message id>
 *  - typing_indicator: { type: "text" }
 */
async function waTypingIndicator(messageId, type = "text") {
  if (!TYPING_SIMULATION) return;
  if (!messageId) return;

  const payload = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
    typing_indicator: { type },
  };

  return axios.post(`${WA_BASE}/messages`, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });
}

function startTypingPinger(messageId, type = "text") {
  if (!TYPING_SIMULATION || !messageId) return () => {};
  waTypingIndicator(messageId, type).catch(() => {});

  const intervalMs = 20000;
  const startedAt = Date.now();
  const maxMs = 65000;
  const timer = setInterval(() => {
    if (Date.now() - startedAt > maxMs) {
      clearInterval(timer);
      return;
    }
    waTypingIndicator(messageId, type).catch(() => {});
  }, intervalMs);

  return () => clearInterval(timer);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// =====================
// Media download (Cloud API)
// =====================
async function waGetMediaUrl(mediaId) {
  const r = await axios.get(`https://graph.facebook.com/${META_GRAPH_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });
  return r.data?.url;
}

async function waDownloadMediaBytes(mediaUrl) {
  const r = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    responseType: "arraybuffer",
  });
  return Buffer.from(r.data);
}

// =====================
// Measurement helpers
// =====================
function toMm(value, unit) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  const u = (unit || "").toLowerCase();
  if (u.startsWith("m") && !u.startsWith("mm")) return Math.round(v * 1000);
  if (u.startsWith("cm")) return Math.round(v * 10);
  return Math.round(v);
}

function extractMeasurements(text) {
  const out = [];
  if (!text) return out;

  const clean = text.replace(/,/g, ".").toLowerCase();

  const reX = /(\d{1,4}(\.\d{1,3})?)\s*[x×]\s*(\d{1,4}(\.\d{1,3})?)\s*(mm|cm|m)?/g;
  let m;
  while ((m = reX.exec(clean))) {
    const a = m[1];
    const b = m[3];
    const unit = m[5] || "mm";
    const w = toMm(a, unit);
    const h = toMm(b, unit);
    if (w && h) out.push({ w, h, unit, confidence: 0.75, raw: m[0] });
  }

  const reAH = /(ancho|largo)\s*(\d{1,4}(\.\d{1,3})?)\s*(mm|cm|m)?[\s,;]+(alto|altura)\s*(\d{1,4}(\.\d{1,3})?)\s*(mm|cm|m)?/g;
  while ((m = reAH.exec(clean))) {
    const unit1 = m[4] || "mm";
    const unit2 = m[8] || unit1;
    const w = toMm(m[2], unit1);
    const h = toMm(m[6], unit2);
    if (w && h) out.push({ w, h, unit: "mm", confidence: 0.7, raw: m[0] });
  }

  return out;
}

function checkSizeAgainstLimits(w, h) {
  if (!w || !h) return null;
  const candidates = Object.entries(SIZE_LIMITS || {});
  if (!candidates.length) return null;

  for (const [system, lim] of candidates) {
    const minW = lim?.min?.w ?? null;
    const minH = lim?.min?.h ?? null;
    const maxW = lim?.max?.w ?? null;
    const maxH = lim?.max?.h ?? null;

    if (minW && w < minW) return { system, issue: `bajo mínimo (${w}mm < ${minW}mm)` };
    if (minH && h < minH) return { system, issue: `bajo mínimo (${h}mm < ${minH}mm)` };
    if (maxW && w > maxW) return { system, issue: `sobre máximo (${w}mm > ${maxW}mm)` };
    if (maxH && h > maxH) return { system, issue: `sobre máximo (${h}mm > ${maxH}mm)` };
  }
  return null;
}

// =====================
// AI prompt builder
// =====================
function buildSystemPrompt(session) {
  const tono = TONO === "tu" ? "tú" : "usted";

  const offer = [
    `Eres ${AGENT_NAME} de ${COMPANY_NAME}.`,
    `Somos fábrica e instalación de ventanas y puertas. Especialistas en eficiencia energética.`,
    `${MINVU_EXPERT_NOTE}`,
    `Trabajamos principalmente con: PVC línea europea, PVC línea americana y aluminio (sin RPT).`,
    `En termopanel (DVH) trabajamos con configuraciones de alto desempeño. Usamos separador warm-edge Thermoflex (tecnología inglesa) para reducir condensación respecto al separador de aluminio tradicional; y ofrecemos vidrios Low-E (mejora térmica), Control Solar (reduce sobrecalentamiento) y Seguridad (Safety/laminados tipo Blindex) de proveedores como Lirquén.`,
    `Tus pilares de asesoría: ${PILLARS}.`,
  ].join("\n");

  const rules = [
    `Idioma: ${LANGUAGE}. Tratar al cliente de "${tono}".`,
    `Estilo: consultivo, claro; si el cliente es técnico, entrar en U-value/transmitancia/condensación con explicaciones simples.`,
    `No inventes medidas ni modelos. Si ya tienes medidas, NO pidas lo mismo otra vez: úsalo y pide solo 1 dato faltante.`,
    `No nombres aluminio con RPT (no lo vendemos).`,
    `Si el cliente pregunta por condensación: explica que es un fenómeno físico por humedad + diferencia de temperatura; el DVH y separador warm-edge lo reducen, y la ventilación/uso de calefacción también influye.`,
    `Máximo ${MAX_LINES_PER_REPLY} líneas. Evita párrafos eternos.`,
    ONE_QUESTION_PER_TURN ? `Haz como máximo 1 pregunta al final.` : `Puedes hacer preguntas necesarias.`,
    `Si no puedes cotizar con precisión, ofrece una pre-cotización referencial y sugiere visita/levantamiento.`,
  ].filter(Boolean).join("\n");

  const measures = (session?.context?.measuresMm || [])
    .slice(-6)
    .map((m) => `${m.w}x${m.h}mm (${m.source || "texto"})`)
    .join(", ");

  const sessionHint = [
    `Datos conocidos del cliente (si existen):`,
    `- Nombre: ${session?.context?.name || "no informado"}`,
    `- Tipo de proyecto: ${session?.context?.projectType || "no informado"}`,
    `- Ciudad/Comuna: ${session?.context?.city || "no informado"}`,
    measures ? `- Medidas detectadas: ${measures}` : `- Medidas detectadas: ninguna`,
  ].join("\n");

  return `${offer}\n\n${rules}\n\n${sessionHint}`.trim();
}

async function aiDraftReply({ session, userText, extractedMeasures, sizeCheck }) {
  if (!openai) return null;

  const system = buildSystemPrompt(session);

  const measuresLine = extractedMeasures?.length
    ? `Medidas detectadas (mm): ${extractedMeasures.map((m) => `${m.w}x${m.h}`).join(", ")}.`
    : `No se detectaron medidas claras.`;

  const sizeLine = sizeCheck ? `Advertencia: posible fuera de rango para sistema ${sizeCheck.system}: ${sizeCheck.issue}.` : "";

  const user = [
    `Mensaje del cliente:`,
    userText || "(vacío)",
    "",
    measuresLine,
    sizeLine,
    "",
    `Tarea: Responde con asesoría práctica y consultiva. Propón alternativa (PVC europea/americana o aluminio) según uso. Indica qué dato falta para cotizar.`,
  ].join("\n");

  const messages = [
    { role: "system", content: system },
    ...session.history.slice(-10).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: user },
  ];

  const r = await openai.chat.completions.create({
    model: AI_MODEL_OPENAI,
    messages,
    temperature: AI_TEMPERATURE,
    max_tokens: AI_MAX_OUTPUT_TOKENS,
  });

  return r.choices?.[0]?.message?.content?.trim() || null;
}

// =====================
// PDF + Image understanding
// =====================
async function parsePdfText(buffer) {
  try {
    const data = await pdf(buffer);
    return (data.text || "").slice(0, 12000);
  } catch (e) {
    console.error("PDF parse error:", e?.message || e);
    return "";
  }
}

async function visionExtract(buffer, mimeType, purpose = "image") {
  if (!openai) return "";
  try {
    const b64 = buffer.toString("base64");
    const r = await openai.chat.completions.create({
      model: AI_MODEL_VISION,
      messages: [
        {
          role: "system",
          content:
            "Eres un extractor para cotización de ventanas/puertas. Devuelve SOLO: (1) medidas claras (ancho x alto) y unidad, (2) tipo (corredera/proyectante/fija/abatible/puerta), (3) notas relevantes. Si no hay medidas, indica 'sin medidas legibles'.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Analiza esta ${purpose} y extrae medidas/tipo.` },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${b64}` } },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 250,
    });

    return r.choices?.[0]?.message?.content?.trim() || "";
  } catch (e) {
    console.error("Vision error:", e?.message || e);
    return "";
  }
}

// =====================
// Reply scheduler
// =====================
async function scheduleReply(waId, messageId, collectedText, { isMedia = false } = {}) {
  const session = getSession(waId);

  session.lastSeenAt = Date.now();
  await sleep(WAIT_AFTER_LAST_USER_MESSAGE_MS);

  if (Date.now() - session.lastSeenAt < WAIT_AFTER_LAST_USER_MESSAGE_MS - 100) return;
  if (!loopGuardOk(session)) return;

  const tMin = TYPING_MIN_MS;
  const tMax = Math.max(TYPING_MAX_MS, tMin + 50);
  const typingDelay = Math.floor(tMin + Math.random() * (tMax - tMin));

  const stopTyping = startTypingPinger(messageId, "text");

  if (isMedia) await sleep(EXTRA_DELAY_MEDIA_MS);
  await sleep(typingDelay);

  const measures = extractMeasurements(collectedText);
  if (measures.length) {
    for (const m of measures) session.context.measuresMm.push({ w: m.w, h: m.h, source: "texto" });
  }

  const m0 = measures[0];
  const sizeCheck = m0 ? checkSizeAgainstLimits(m0.w, m0.h) : null;

  const aiText = await aiDraftReply({
    session,
    userText: collectedText,
    extractedMeasures: measures,
    sizeCheck,
  });

  let reply =
    aiText ||
    "Gracias por tu mensaje. Para asesorarte bien, indícame el alto y ancho (en mm) y el tipo de ventana (corredera, proyectante, fija o puerta).";

  const lines = reply.split("\n").map((l) => l.trim()).filter(Boolean);
  reply = lines.slice(0, MAX_LINES_PER_REPLY).join("\n");

  try {
    await waSendText(waId, reply, { replyToMessageId: messageId });
    session.history.push({ role: "user", content: collectedText || "" });
    session.history.push({ role: "assistant", content: reply });
    noteReply(session);
  } catch (e) {
    console.error("Send error:", e?.response?.data || e?.message || e);
  } finally {
    stopTyping();
  }
}

// =====================
// Webhook receiving (POST)
// =====================
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const messages = value?.messages || [];
    if (!messages.length) return res.sendStatus(200);

    const msg = messages[0];
    const waId = msg.from;
    const messageId = msg.id;

    if (processedMsgIds.has(messageId)) return res.sendStatus(200);
    addProcessed(messageId);

    const session = getSession(waId);

    const incomingText = msg.type === "text" ? (msg.text?.body || "").trim().toLowerCase() : "";
    if (["reset", "reiniciar", "nuevo", "start", "comenzar"].includes(incomingText)) {
      sessions.delete(waId);
      await waSendText(
        waId,
        "Listo. Reinicié tu sesión. Escríbeme tu solicitud como si fuera la primera vez (tipo de ventana + medidas en mm + comuna).",
        { replyToMessageId: messageId }
      );
      return res.sendStatus(200);
    }

    const sendAck = async (text) => {
      try {
        await waSendText(waId, text, { replyToMessageId: messageId });
      } catch {}
    };

    if (msg.type === "text") {
      await scheduleReply(waId, messageId, msg.text?.body || "");
      return res.sendStatus(200);
    }

    if (msg.type === "image") {
      const mediaId = msg.image?.id;
      const mime = msg.image?.mime_type || "image/jpeg";
      console.log("INCOMING IMAGE:", { mime, mediaId });

      await sendAck("Recibido. Déjeme revisar la imagen para identificar medidas y tipo de ventana.");

      const stopTyping = startTypingPinger(messageId, "text");
      try {
        const url = await waGetMediaUrl(mediaId);
        const bytes = await waDownloadMediaBytes(url);
        const visionText = await visionExtract(bytes, mime, "imagen");
        const combined = `Imagen recibida.\n${visionText || ""}`.trim();
        await scheduleReply(waId, messageId, combined, { isMedia: true });
      } finally {
        stopTyping();
      }

      return res.sendStatus(200);
    }

    if (msg.type === "document") {
      const mime = msg.document?.mime_type || "";
      const filename = msg.document?.filename || "archivo";
      const mediaId = msg.document?.id;

      console.log("INCOMING DOCUMENT:", { mime, filename, mediaId });

      await sendAck(`Recibido "${filename}". Déjeme revisarlo para identificar medidas y especificación.`);

      const stopTyping = startTypingPinger(messageId, "text");
      try {
        const url = await waGetMediaUrl(mediaId);
        const bytes = await waDownloadMediaBytes(url);

        let parsedText = "";
        if (mime.includes("pdf")) parsedText = await parsePdfText(bytes);

        const measures = extractMeasurements(parsedText);
        if (measures.length) {
          for (const m of measures) session.context.measuresMm.push({ w: m.w, h: m.h, source: "pdf" });
        }

        const combined = [
          `Documento recibido: ${filename} (${mime || "documento"}).`,
          parsedText ? `Texto extraído (resumen):\n${parsedText.slice(0, 2000)}` : "",
          measures.length ? `Medidas detectadas (mm): ${measures.map((m) => `${m.w}x${m.h}`).join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        await scheduleReply(waId, messageId, combined, { isMedia: true });
      } finally {
        stopTyping();
      }

      return res.sendStatus(200);
    }

    await waSendText(
      waId,
      "Recibido. Por ahora puedo ayudarte mejor con texto, imágenes o PDFs. ¿Me indicas qué necesitas cotizar?",
      { replyToMessageId: messageId }
    );
    return res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error:", e?.message || e);
    return res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log("Listening...");
});
