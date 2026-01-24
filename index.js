import express from "express";
import axios from "axios";
import OpenAI from "openai";
import pdfParse from "pdf-parse";

// =====================
// ENV / CONFIG
// =====================
const app = express();
app.use(express.json({ limit: "12mb" }));

const PORT = process.env.PORT || 8080;

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v22.0";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";

const AI_PROVIDER = (process.env.AI_PROVIDER || "openai").toLowerCase();
const AI_MODEL_OPENAI = process.env.AI_MODEL_OPENAI || "gpt-4.1-mini";
// Modelo para IMÁGENES (visión). Recomendado:
const AI_MODEL_VISION = process.env.AI_MODEL_VISION || "gpt-4o-mini";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const COMPANY_NAME = process.env.COMPANY_NAME || "Activa Inversiones";
const BRAND_SHORT = process.env.BRAND_SHORT || "Activa";
const AGENT_NAME = process.env.AGENT_NAME || "Marcelo Cifuentes";

const GREETING_MODE = process.env.GREETING_MODE || "first_message_only"; // first_message_only | every_message | none
const SIGNATURE_MODE = process.env.SIGNATURE_MODE || "first_message_only";

const WAIT_AFTER_LAST_USER_MESSAGE_MS = Number(process.env.WAIT_AFTER_LAST_USER_MESSAGE_MS || 5500);
const HUMAN_DELAY_MS_MIN = Number(process.env.HUMAN_DELAY_MS_MIN || 2200);
const HUMAN_DELAY_MS_MAX = Number(process.env.HUMAN_DELAY_MS_MAX || 4800);

const MAX_LINES_PER_REPLY = Number(process.env.MAX_LINES_PER_REPLY || 10);
const MAX_REPLY_CHARS = Number(process.env.MAX_REPLY_CHARS || 1200);

const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || "America/Santiago";
const BUSINESS_HOURS_ONLY = String(process.env.BUSINESS_HOURS_ONLY || "false") === "true";
const BUSINESS_HOURS_START = process.env.BUSINESS_HOURS_START || "09:00";
const BUSINESS_HOURS_END = process.env.BUSINESS_HOURS_END || "19:00";
const AFTER_HOURS_MESSAGE =
  process.env.AFTER_HOURS_MESSAGE ||
  "Hola, gracias por escribir. En este momento estamos fuera de horario, pero mañana a primera hora te respondemos y avanzamos con tu cotización.";

const DEFAULT_PRIORITY = process.env.DEFAULT_PRIORITY || "aislación térmica, acústica y seguridad";

const RATE_LIMIT_PER_USER_PER_MIN = Number(process.env.RATE_LIMIT_PER_USER_PER_MIN || 12);
const SESSION_TTL_MINUTES = Number(process.env.SESSION_TTL_MINUTES || 60);

const ONE_QUESTION_PER_TURN = String(process.env.ONE_QUESTION_PER_TURN || "true") === "true";

// =====================
// OpenAI
// =====================
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// =====================
// In-memory sessions
// =====================
const sessions = new Map(); // waId => session

function nowMs() {
  return Date.now();
}

function clampText(text) {
  if (!text) return "";
  return text.length > MAX_REPLY_CHARS ? text.slice(0, MAX_REPLY_CHARS - 1) + "…" : text;
}

function splitLines(text) {
  const lines = (text || "").split("\n");
  if (lines.length <= MAX_LINES_PER_REPLY) return text;
  return lines.slice(0, MAX_LINES_PER_REPLY).join("\n") + "\n…";
}

function randomBetween(min, max) {
  const a = Math.min(min, max);
  const b = Math.max(min, max);
  return Math.floor(a + Math.random() * (b - a + 1));
}

function withinBusinessHours() {
  if (!BUSINESS_HOURS_ONLY) return true;
  try {
    const toMin = (hhmm) => {
      const [h, m] = hhmm.split(":").map(Number);
      return h * 60 + m;
    };
    const start = toMin(BUSINESS_HOURS_START);
    const end = toMin(BUSINESS_HOURS_END);

    const dt = new Date();
    const hh = Number(new Intl.DateTimeFormat("es-CL", { timeZone: BUSINESS_TIMEZONE, hour: "2-digit", hour12: false }).format(dt));
    const mm = Number(new Intl.DateTimeFormat("es-CL", { timeZone: BUSINESS_TIMEZONE, minute: "2-digit" }).format(dt));
    const cur = hh * 60 + mm;

    return cur >= start && cur <= end;
  } catch {
    return true;
  }
}

function getTimeGreeting() {
  try {
    const hour = Number(
      new Intl.DateTimeFormat("es-CL", { timeZone: BUSINESS_TIMEZONE, hour: "2-digit", hour12: false }).format(new Date())
    );
    if (hour >= 5 && hour < 12) return "Buenos días";
    if (hour >= 12 && hour < 20) return "Buenas tardes";
    return "Buenas noches";
  } catch {
    return "Hola";
  }
}

function getSession(waId) {
  const s = sessions.get(waId);
  const t = nowMs();
  if (!s) {
    const ns = {
      lastAt: t,
      timer: null,
      greeted: false,
      lastReplyAt: 0,
      rate: { windowStart: t, count: 0 },
      ttlAt: t + SESSION_TTL_MINUTES * 60_000,
      afterHoursSent: false,
    };
    sessions.set(waId, ns);
    return ns;
  }
  s.ttlAt = t + SESSION_TTL_MINUTES * 60_000;
  return s;
}

function cleanupSessions() {
  const t = nowMs();
  for (const [k, v] of sessions.entries()) {
    if (v.ttlAt && v.ttlAt < t) sessions.delete(k);
  }
}
setInterval(cleanupSessions, 60_000).unref();

function rateLimitOk(sess) {
  const t = nowMs();
  const win = 60_000;
  if (t - sess.rate.windowStart > win) {
    sess.rate.windowStart = t;
    sess.rate.count = 0;
  }
  sess.rate.count += 1;
  return sess.rate.count <= RATE_LIMIT_PER_USER_PER_MIN;
}

function maybeGreeting(sess) {
  const g = getTimeGreeting();
  if (GREETING_MODE === "none") return "";
  if (GREETING_MODE === "every_message") return `${g}, soy ${AGENT_NAME}. `;
  if (GREETING_MODE === "first_message_only" && !sess.greeted) return `${g}, soy ${AGENT_NAME}. `;
  return "";
}

function maybeSignature(sess) {
  if (SIGNATURE_MODE === "none") return "";
  if (SIGNATURE_MODE === "every_message") return `\n\n— ${AGENT_NAME} | ${BRAND_SHORT}`;
  if (SIGNATURE_MODE === "first_message_only" && !sess.greeted) return `\n\n— ${AGENT_NAME} | ${BRAND_SHORT}`;
  return "";
}

// =====================
// WhatsApp helpers
// =====================
async function waSendText(to, text) {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };
  await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    timeout: 30_000,
  });
}

async function waMarkRead(messageId) {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", status: "read", message_id: messageId };
  await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    timeout: 30_000,
  });
}

async function waGetMediaUrl(mediaId) {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${mediaId}`;
  const resp = await axios.get(url, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    timeout: 30_000,
  });
  return resp.data; // { url, mime_type, ... }
}

async function waDownloadMedia(mediaUrl) {
  const resp = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    responseType: "arraybuffer",
    timeout: 60_000,
  });
  return Buffer.from(resp.data);
}

// =====================
// Extract measures
// =====================
function extractMeasurements(text) {
  const t = (text || "").replace(/\s+/g, " ");
  const out = [];

  const re1 = /(\d{2,4}(?:[.,]\d{1,2})?)\s*[xX×]\s*(\d{2,4}(?:[.,]\d{1,2})?)/g;
  let m;
  while ((m = re1.exec(t))) out.push({ w: m[1], h: m[2], raw: m[0] });

  const re2 = /(\d(?:[.,]\d{1,2})?)\s*[xX×]\s*(\d(?:[.,]\d{1,2})?)\s*(m|mt|mts)?/g;
  while ((m = re2.exec(t))) out.push({ w: m[1], h: m[2], raw: m[0] });

  const seen = new Set();
  return out.filter((x) => {
    if (seen.has(x.raw)) return false;
    seen.add(x.raw);
    return true;
  });
}

// =====================
// Business reply logic
// =====================
function buildBaseConsultativeNote() {
  return (
    `Para recomendar bien, siempre miramos 3 condiciones: ${DEFAULT_PRIORITY}.\n` +
    `En general, la condensación interior no depende solo de la ventana: aparece cuando sube la humedad interior y baja la temperatura de la superficie interior. En PVC + DVH + buena instalación, eso es poco probable dentro de la casa; si ocurre, normalmente se corrige con ventilación y manejo de humedad.\n` +
    `Trabajamos PVC y aluminio (todos pueden llevar DVH/termopanel). Lo que cambia es hermeticidad, refuerzo, herrajes y desempeño final.`
  );
}

function buildNextQuestion(context) {
  if (!context.city) return "¿En qué ciudad se instalarían (Temuco / Padre Las Casas / Villarrica / Pucón)?";
  if (!context.qty) return "¿Cuántas ventanas y/o puertas necesitas en total (aprox.)?";
  if (!context.hasMeasures) return "¿Me confirmas medidas aproximadas (ancho x alto) de cada vano?";
  if (context.wantsInstall == null) return "¿Las necesitas con instalación incluida o solo fabricación?";
  return "¿Prefieres corredera u oscilobatiente/proyectante, o te recomiendo según ventilación y uso?";
}

function inferContextFromText(text) {
  const t = (text || "").toLowerCase();
  const city = /temuco|puc[oó]n|villarrica|padre\s+las\s+casas|valdivia|osorno|puerto\s+montt/.exec(t)?.[0];
  const qty = /(\d{1,3})\s*(ventanas|puertas)/.exec(t)?.[1];
  const wantsInstall =
    /con\s+instalaci[oó]n|incluye\s+instalaci[oó]n/.test(t) ? true : /solo\s+fabricaci[oó]n|sin\s+instalaci[oó]n/.test(t) ? false : null;
  const measures = extractMeasurements(text);
  return { city: city || null, qty: qty ? Number(qty) : null, wantsInstall, measures };
}

// =====================
// AI helpers (text + vision)
// =====================
async function aiDraftReply(userText) {
  if (!openai || AI_PROVIDER !== "openai") return null;

  const system = `
Eres asesor chileno especializado SOLO en ventanas y puertas.
Estilo: humano, consultivo, profesional. Sin emojis.
Máximo 1 pregunta al final.
Si el cliente envió PDF/imagen, agradece y confirma que revisaste medidas/datos.
`.trim();

  const resp = await openai.chat.completions.create({
    model: AI_MODEL_OPENAI,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userText },
    ],
    temperature: 0.4,
  });

  return resp.choices?.[0]?.message?.content?.trim() || null;
}

async function aiReadImage(buffer, mimeType = "image/jpeg") {
  if (!openai || AI_PROVIDER !== "openai") return null;

  const base64 = buffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const system = `
Eres un revisor técnico de ventanas/puertas.
Extrae desde la imagen SOLO información útil para cotización: medidas (ancho x alto), cantidades, tipos, notas.
Si no hay medidas claras, dilo explícitamente.
Devuelve texto corto y claro en español (Chile).
`.trim();

  const resp = await openai.chat.completions.create({
    model: AI_MODEL_VISION,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: "Lee esta imagen y extrae medidas/cantidades/tipos si aparecen." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    temperature: 0.2,
  });

  return resp.choices?.[0]?.message?.content?.trim() || null;
}

// =====================
// Delayed reply (anti-typing)
// =====================
async function scheduleReply(waId, lastMessageId, collectedText) {
  const sess = getSession(waId);
  sess.lastAt = nowMs();

  if (sess.timer) clearTimeout(sess.timer);

  sess.timer = setTimeout(async () => {
    try {
      if (!withinBusinessHours()) {
        if (!sess.afterHoursSent) {
          await waSendText(waId, AFTER_HOURS_MESSAGE);
          sess.afterHoursSent = true;
        }
        return;
      }

      if (!rateLimitOk(sess)) return;

      const ctx = inferContextFromText(collectedText);
      const hasMeasures = (ctx.measures?.length || 0) > 0;

      let reply =
        `${maybeGreeting(sess)}` +
        `Gracias por la información. ${buildBaseConsultativeNote()}\n`;

      if (hasMeasures) {
        reply += `\nVi estas medidas aproximadas: ${ctx.measures.map((m) => m.raw).join(", ")}. Con eso preparo una propuesta inicial y luego confirmamos en terreno.\n`;
      } else {
        reply += `\nSi me compartes medidas (ancho x alto) o un plano con cotas, preparo la propuesta inicial.\n`;
      }

      const question = buildNextQuestion({ city: ctx.city, qty: ctx.qty, hasMeasures, wantsInstall: ctx.wantsInstall });
      if (ONE_QUESTION_PER_TURN) reply += `\n${question}`;

      const ai = await aiDraftReply(collectedText);
      if (ai) reply = `${maybeGreeting(sess)}${ai}${maybeSignature(sess)}`;
      else reply += `${maybeSignature(sess)}`;

      reply = splitLines(clampText(reply));

      const waitBase = randomBetween(HUMAN_DELAY_MS_MIN, HUMAN_DELAY_MS_MAX);
      await new Promise((r) => setTimeout(r, waitBase));

      await waSendText(waId, reply);

      sess.greeted = true;
      sess.lastReplyAt = nowMs();

      if (lastMessageId) await waMarkRead(lastMessageId).catch(() => {});
    } catch (err) {
      console.error("Reply error:", err?.response?.data || err?.message || err);
    }
  }, WAIT_AFTER_LAST_USER_MESSAGE_MS);
}

// =====================
// Webhook verification (GET)
// =====================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

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

    let collectedText = "";

    // TEXT
    if (msg.type === "text") {
      collectedText = msg.text?.body || "";
      await scheduleReply(waId, messageId, collectedText);
      return res.sendStatus(200);
    }

    // DOCUMENT (PDF)
    if (msg.type === "document") {
      const mediaId = msg.document?.id;
      const mime = msg.document?.mime_type || "";
      const filename = msg.document?.filename || "documento";

      console.log("INCOMING DOCUMENT:", { mime, filename, mediaId });

      if (mediaId && mime.includes("pdf")) {
        const meta = await waGetMediaUrl(mediaId);
        const buffer = await waDownloadMedia(meta.url);

        let pdfText = "";
        try {
          const parsed = await pdfParse(buffer);
          pdfText = (parsed?.text || "").trim();
        } catch (e) {
          pdfText = "";
        }

        if (!pdfText || pdfText.length < 30) {
          collectedText =
            `El cliente envió un PDF (“${filename}”), pero parece escaneado o sin texto seleccionable.\n` +
            `Solicitar medidas en texto (ancho x alto) o una foto/plano con cotas claras.`;
        } else {
          const measures = extractMeasurements(pdfText);
          collectedText =
            `Cliente envió PDF: ${filename}.\n` +
            `Texto relevante extraído:\n${pdfText.slice(0, 2500)}\n` +
            (measures.length ? `\nMedidas detectadas: ${measures.map((m) => m.raw).join(", ")}.` : `\nNo se detectaron medidas con patrón ancho x alto.`);
        }

        await scheduleReply(waId, messageId, collectedText);
        return res.sendStatus(200);
      }

      collectedText = `Cliente envió un documento (“${filename}”). Para cotizar, por favor envía medidas ancho x alto o un plano con cotas.`;
      await scheduleReply(waId, messageId, collectedText);
      return res.sendStatus(200);
    }

    // IMAGE
    if (msg.type === "image") {
      const mediaId = msg.image?.id;
      const mime = msg.image?.mime_type || "image/jpeg";
      console.log("INCOMING IMAGE:", { mime, mediaId });

      if (mediaId) {
        const meta = await waGetMediaUrl(mediaId);
        const buffer = await waDownloadMedia(meta.url);

        let imgText = await aiReadImage(buffer, mime);
        if (!imgText) imgText = "Cliente envió una imagen, pero no pude extraer información útil automáticamente.";

        collectedText = `Cliente envió imagen.\n${imgText}`;
        await scheduleReply(waId, messageId, collectedText);
        return res.sendStatus(200);
      }

      collectedText = "Cliente envió una imagen. ¿Me confirmas medidas (ancho x alto) o un plano con cotas?";
      await scheduleReply(waId, messageId, collectedText);
      return res.sendStatus(200);
    }

    // OTHER TYPES
    collectedText = "Cliente envió un archivo/multimedia. Para avanzar rápido, envía medidas (ancho x alto) y ciudad de instalación.";
    await scheduleReply(waId, messageId, collectedText);
    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err?.response?.data || err?.message || err);
    return res.sendStatus(200);
  }
});

// Health check
app.get("/", (req, res) => res.status(200).send("OK"));

app.listen(PORT, () => {
  console.log("Starting Container");
  console.log(`Server running on port ${PORT}`);
  console.log(`ENV META_GRAPH_VERSION: ${META_GRAPH_VERSION}`);
  console.log(`ENV PHONE_NUMBER_ID: ${PHONE_NUMBER_ID ? "OK" : "MISSING"}`);
  console.log(`ENV WHATSAPP_TOKEN: ${WHATSAPP_TOKEN ? "OK" : "MISSING"}`);
  console.log(`ENV VERIFY_TOKEN: ${VERIFY_TOKEN ? "OK" : "MISSING"}`);
  console.log(`ENV OPENAI_API_KEY: ${OPENAI_API_KEY ? "OK" : "MISSING"}`);
  console.log(`ENV AI_PROVIDER: ${AI_PROVIDER}`);
  console.log(`ENV AI_MODEL_OPENAI: ${AI_MODEL_OPENAI}`);
  console.log(`ENV AI_MODEL_VISION: ${AI_MODEL_VISION}`);
  console.log(`STYLE GREETING_MODE: ${GREETING_MODE}`);
});
