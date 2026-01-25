import express from "express";
import axios from "axios";
import OpenAI from "openai";
import pdf from "pdf-parse";

/**
 * WhatsApp IA Hub (Activa) - V2.1
 * Fixes:
 * - Responde 200 inmediato al webhook (evita reintentos Meta)
 * - Typing indicator unificado (evita doble timer)
 * - Retries + timeouts al enviar WhatsApp
 * - Límites de memoria por sesión (history / medidas)
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
const AI_MODEL_OPENAI = env("AI_MODEL_OPENAI", "gpt-4o-mini");
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

// WhatsApp practical max (evita error por body enorme)
const MAX_WA_CHARS = envInt("MAX_WA_CHARS", 3500);

// Loop guard
const LOOP_GUARD_MAX_REPLIES_PER_5MIN = envInt("LOOP_GUARD_MAX_REPLIES_PER_5MIN", 6);

// Session memory caps
const HISTORY_MAX_ITEMS = envInt("HISTORY_MAX_ITEMS", 30);
const MEASURES_MAX_ITEMS = envInt("MEASURES_MAX_ITEMS", 30);

// =====================
// Optional size limits (JSON)
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

// Dedupe con TTL (mejor que Set puro)
const processedMsgIds = new Map(); // msgId -> expireAt
const DEDUPE_TTL_MS = envInt("DEDUPE_TTL_MS", 10 * 60 * 1000);

function cleanDedupe() {
  const now = Date.now();
  for (const [id, exp] of processedMsgIds.entries()) {
    if (exp <= now) processedMsgIds.delete(id);
  }
}
function isProcessed(id) {
  if (!id) return false;
  cleanDedupe();
  return processedMsgIds.has(id);
}
function markProcessed(id) {
  if (!id) return;
  cleanDedupe();
  processedMsgIds.set(id, Date.now() + DEDUPE_TTL_MS);
}

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      waId,
      createdAt: Date.now(),
      lastSeenAt: 0,
      lastReplyAt: 0,
      repliesIn5Min: [],
      history: [],
      context: {
        name: null,
        projectType: null,
        city: null,
        productInterest: null,
        measuresMm: [],
      },
    });
  }
  return sessions.get(waId);
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

  const headers = {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    "Content-Type": "application/json",
  };

  // retries + timeout
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      return await axios.post(`${WA_BASE}/messages`, payload, { headers, timeout: 15000 });
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;
      const data = e?.response?.data;
      console.error("waSendText error retry", { i, status, data });
      await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

/**
 * Typing indicator:
 * POST /messages con status read + message_id + typing_indicator
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

  const headers = {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    "Content-Type": "application/json",
  };

  return axios.post(`${WA_BASE}/messages`, payload, { headers, timeout: 15000 });
}

function startTypingPinger(messageId, type = "text") {
  if (!TYPING_SIMULATION || !messageId) return () => {};
  waTypingIndicator(messageId, type).catch(() => {});

  const intervalMs = 2000
