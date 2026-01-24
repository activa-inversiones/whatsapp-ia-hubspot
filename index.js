// index.js
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
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const LANGUAGE = process.env.LANGUAGE || "es-CL";
const COMPANY_NAME = process.env.COMPANY_NAME || "Activa Inversiones";
const BRAND_SHORT = process.env.BRAND_SHORT || "Activa";
const AGENT_NAME = process.env.AGENT_NAME || "Marcelo Cifuentes";

const GREETING_MODE = process.env.GREETING_MODE || "first_message_only"; // first_message_only | every_message | none
const SIGNATURE_MODE = process.env.SIGNATURE_MODE || "first_message_only";

const WAIT_AFTER_LAST_USER_MESSAGE_MS = Number(process.env.WAIT_AFTER_LAST_USER_MESSAGE_MS || 4500);
const HUMAN_DELAY_MS_MIN = Number(process.env.HUMAN_DELAY_MS_MIN || 1200);
const HUMAN_DELAY_MS_MAX = Number(process.env.HUMAN_DELAY_MS_MAX || 2600);

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

const ONE_QUESTION_PER_TURN = String(process.env.ONE_QUESTION_PER_TURN || "true") === "true";
const RATE_LIMIT_PER_USER_PER_MIN = Number(process.env.RATE_LIMIT_PER_USER_PER_MIN || 12);
const SESSION_TTL_MINUTES = Number(process.env.SESSION_TTL_MINUTES || 60);

// =====================
// OpenAI client
// =====================
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// =====================
// In-memory sessions
// =====================
const sessions = new Map(); // key: waId => { lastAt, timer, greeted, rate, ttlAt, afterHoursSent }

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

function withinBusinessHours() {
  if (!BUSINESS_HOURS_ONLY) return true;
  try {
    const parts = (s) => s.split(":").map((n) => Number(n));
    const [sh, sm] = parts(BUSINESS_HOURS_START);
    const [eh, em] = parts(BUSINESS_HOURS_END);

    const dt = new Date();
    const hh = Number(new Intl.DateTimeFormat("es-CL", { timeZone: BUSINESS_TIMEZONE, hour: "2-digit", hour12: false }).format(dt));
    const mm = Number(new Intl.DateTimeFormat("es-CL", { timeZone: BUSINESS_TIMEZONE, minute: "2-digit" }).format(dt));

    const cur = hh * 60 + mm;
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    return cur >= start && cur <= end;
  } catch {
    return true;
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

// =====================
// WhatsApp helpers
// =====================
async function waSendText(to, text) {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body: text } };
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

// DESCARGA MEDIA (PDF/IMG) DESDE WHATSAPP CLOUD API
async function waGetMediaInfo(mediaId) {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${mediaId}`;
  const r = await axios.get(url, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    timeout: 30_000,
  });
  return r.data; // {url, mime_type, ...}
}

async function waDownloadMedia(mediaUrl) {
  const r = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    responseType: "arraybuffer",
    timeout: 60_000,
  });
  return Buffer.from(r.data);
}

// =====================
// Extract measurements
// =====================
function extractMeasurements(text) {
  const t = (text || "").replace(/\s+/g, " ");
  const out = [];

  const re1 = /(\d{2,4}(?:[.,]\d{1,2})?)\s*[xX×]\s*(\d{2,4}(?:[.,]\d{1,2})?)/g;
  let m;
  while ((m = re1.exec(t))) out.push({ raw: m[0] });

  const re2 = /(\d(?:[.,]\d{1,2})?)\s*[xX×]\s*(\d(?:[.,]\d{1,2})?)\s*(m|mt|mts)?/g;
  while ((m = re2.exec(t))) out.push({ raw: m[0] });

  const seen = new Set();
  return out.filter((x) => (seen.has(x.raw) ? false : (seen.add(x.raw), true)));
}

// =====================
// Build response
// =====================
function buildBaseConsultativeNote() {
  return (
    `Para recomendar bien, miramos 3 condiciones: ${DEFAULT_PRIORITY}.\n` +
    `La condensación interior normalmente se relaciona con humedad interior alta + baja temperatura de superficie. Con PVC línea europea + DVH + buena instalación, es poco probable dentro de la vivienda; si aparece, suele corregirse con ventilación/manejo de humedad.\n` +
    `Si me confirmas ciudad, cantidad y si incluye instalación, preparo una propuesta inicial y luego verificamos en terreno.`
  );
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

function buildNextQuestion(context) {
  if (!context.city) return "¿En qué ciudad se instalarían?";
  if (!context.qty) return "¿Cuántas ventanas y/o puertas necesitas en total (aprox)?";
  if (!context.hasMeasures) return "¿Me confirmas medidas aproximadas (ancho x alto) o cuántos vanos son?";
  if (context.wantsInstall == null) return "¿Las necesitas con instalación incluida o solo fabricación?";
  return "¿Prefieres corredera u oscilobatiente/proyectante, o te recomiendo según uso?";
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
// AI: texto + visión (imagen)
// =====================
async function aiFromText(userText) {
  if (!openai || AI_PROVIDER !== "openai") return null;

  const system = `
Eres un asesor comercial-técnico chileno especializado SOLO en ventanas y puertas.
Estilo: humano, cercano, profesional. Sin emojis.
Prioriza 3 pilares: aislación térmica, acústica, seguridad.
Haz máximo 1 pregunta al final.
`.trim();

  const resp = await openai.chat.completions.create({
    model: AI_MODEL_OPENAI,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `Cliente: ${userText}\nResponde breve y claro, con 1 pregunta al final.` },
    ],
    temperature: 0.4,
  });

  return resp.choices?.[0]?.message?.content?.trim() || null;
}

async function aiReadImageToText(imageBuffer, mimeType = "image/jpeg") {
  if (!openai || AI_PROVIDER !== "openai") return null;

  const b64 = imageBuffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${b64}`;

  const system = `
Extrae texto útil desde la imagen (medidas ancho x alto, cantidades, observaciones técnicas).
Entrega SOLO:
1) Texto extraído resumido (máx 8 líneas)
2) Lista de medidas detectadas (si hay), separadas por coma
`.trim();

  const resp = await openai.chat.completions.create({
    model: AI_MODEL_OPENAI,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: "Lee la imagen y extrae medidas/texto relevante." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    temperature: 0.2,
  });

  return resp.choices?.[0]?.message?.content?.trim() || null;
}

// =====================
// Delayed reply
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

      let reply = `${maybeGreeting(sess)}Gracias por la información. ${buildBaseConsultativeNote()}\n`;

      if (hasMeasures) reply += `\nVi estas medidas aproximadas: ${ctx.measures.map((m) => m.raw).join(", ")}.\n`;

      const question = buildNextQuestion({ city: ctx.city, qty: ctx.qty, hasMeasures, wantsInstall: ctx.wantsInstall });

      // AI reescribe si está disponible
      const ai = await aiFromText(collectedText);
      if (ai) {
        reply = `${maybeGreeting(sess)}${ai}${maybeSignature(sess)}`;
      } else {
        reply += `\n${question}${maybeSignature(sess)}`;
      }

      reply = splitLines(clampText(reply));

      await new Promise((r) => setTimeout(r, randomBetween(HUMAN_DELAY_MS_MIN, HUMAN_DELAY_MS_MAX)));
      await waSendText(waId, reply);

      sess.greeted = true;

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

    if (msg.type === "text") {
      collectedText = msg.text?.body || "";
    }

    // PDF
    if (msg.type === "document" && msg.document?.id) {
      const mediaId = msg.document.id;
      const mime = msg.document.mime_type || "";
      const filename = msg.document.filename || "";

      console.log("INCOMING DOCUMENT:", { mime, filename, mediaId });

      const info = await waGetMediaInfo(mediaId);
      const buf = await waDownloadMedia(info.url);

      if (mime.includes("pdf") || filename.toLowerCase().endsWith(".pdf")) {
        const parsed = await pdfParse(buf);
        const text = (parsed?.text || "").trim();
        collectedText =
          `Cliente envió un PDF (${filename || "sin nombre"}).\n` +
          `Texto extraído (resumen):\n` +
          `${text.slice(0, 3500)}`;
      } else {
        collectedText = `Cliente envió un documento (${filename || "sin nombre"}). Por favor envía PDF o medidas en texto.`;
      }
    }

    // IMAGE
    if (msg.type === "image" && msg.image?.id) {
      const mediaId = msg.image.id;
      console.log("INCOMING IMAGE:", { mediaId });

      const info = await waGetMediaInfo(mediaId);
      const buf = await waDownloadMedia(info.url);
      const mime = info?.mime_type || "image/jpeg";

      const extracted = await aiReadImageToText(buf, mime);
      collectedText =
        extracted
          ? `Cliente envió una imagen.\nExtracción desde imagen:\n${extracted}`
          : `Cliente envió una imagen. (No pude extraer texto; por favor envía medidas en texto o PDF).`;
    }

    // Otros tipos
    if (!collectedText) {
      collectedText = "Cliente envió un archivo/medio. Por favor envía medidas (ancho x alto) en texto o un PDF.";
    }

    await scheduleReply(waId, messageId, collectedText);
    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err?.response?.data || err?.message || err);
    return res.sendStatus(200);
  }
});

// Health
app.get("/", (req, res) => res.status(200).send("OK"));

app.listen(PORT, () => {
  console.log("Starting Container");
  console.log(`Server running on port ${PORT}`);
  console.log(`ENV WHATSAPP_TOKEN: ${WHATSAPP_TOKEN ? "OK" : "MISSING"}`);
  console.log(`ENV META_GRAPH_VERSION: ${META_GRAPH_VERSION}`);
  console.log(`ENV VERIFY_TOKEN: ${VERIFY_TOKEN ? "OK" : "MISSING"}`);
  console.log(`ENV PHONE_NUMBER_ID: ${PHONE_NUMBER_ID ? "OK" : "MISSING"}`);
  console.log(`ENV OPENAI_API_KEY: ${OPENAI_API_KEY ? "OK" : "MISSING"}`);
  console.log(`ENV AI_PROVIDER: ${AI_PROVIDER}`);
  console.log(`ENV AI_MODEL_OPENAI: ${AI_MODEL_OPENAI}`);
  console.log(`STYLE GREETING_MODE: ${GREETING_MODE}`);
});
