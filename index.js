// index.js
import express from "express";
import axios from "axios";
import OpenAI from "openai";

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

const TONE = process.env.TONE || "consultivo, cercano y profesional (Chile)";
const FORMALITY_LEVEL = Number(process.env.FORMALITY_LEVEL || 2);
const EMOJI_LEVEL = Number(process.env.EMOJI_LEVEL || 0);
const CTA_STYLE = process.env.CTA_STYLE || "SOFT";

const GREETING_MODE = process.env.GREETING_MODE || "first_message_only"; // first_message_only | every_message | none
const SIGNATURE_MODE = process.env.SIGNATURE_MODE || "first_message_only";

const WAIT_AFTER_LAST_USER_MESSAGE_MS = Number(process.env.WAIT_AFTER_LAST_USER_MESSAGE_MS || 5500);
const HUMAN_DELAY_MS_MIN = Number(process.env.HUMAN_DELAY_MS_MIN || 2200);
const HUMAN_DELAY_MS_MAX = Number(process.env.HUMAN_DELAY_MS_MAX || 4800);
const MIN_RESPONSE_DELAY_MS = Number(process.env.MIN_RESPONSE_DELAY_MS || 0);
const MAX_RESPONSE_DELAY_MS = Number(process.env.MAX_RESPONSE_DELAY_MS || 0);

const MAX_FIELDS_TO_REQUEST = Number(process.env.MAX_FIELDS_TO_REQUEST || 1);
const ONE_QUESTION_PER_TURN = String(process.env.ONE_QUESTION_PER_TURN || "true") === "true";
const MAX_LINES_PER_REPLY = Number(process.env.MAX_LINES_PER_REPLY || 10);
const MAX_REPLY_CHARS = Number(process.env.MAX_REPLY_CHARS || 1200);

const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || "America/Santiago";
const BUSINESS_HOURS_ONLY = String(process.env.BUSINESS_HOURS_ONLY || "false") === "true";
const BUSINESS_HOURS_START = process.env.BUSINESS_HOURS_START || "09:00";
const BUSINESS_HOURS_END = process.env.BUSINESS_HOURS_END || "19:00";
const AFTER_HOURS_MESSAGE =
  process.env.AFTER_HOURS_MESSAGE ||
  "Hola, gracias por escribir. En este momento estamos fuera de horario, pero mañana a primera hora te respondemos y avanzamos con tu cotización.";

const DEFAULT_CITY = process.env.DEFAULT_CITY || "Temuco";
const DEFAULT_PRIORITY = process.env.DEFAULT_PRIORITY || "aislación térmica, acústica y seguridad";
const PILLARS =
  process.env.PILLARS ||
  "Aislación térmica, aislación acústica y seguridad. En PVC línea europea, con DVH y correcta instalación, la condensación interior es muy poco probable; normalmente depende de humedad interior alta y ventilación.";

const HUMAN_HANDOFF_ENABLED = String(process.env.HUMAN_HANDOFF_ENABLED || "true") === "true";
const HUMAN_HANDOFF_KEYWORDS = (process.env.HUMAN_HANDOFF_KEYWORDS || "humano,asesor,llamar,urgente,hablar con alguien,ejecutivo")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const RATE_LIMIT_PER_USER_PER_MIN = Number(process.env.RATE_LIMIT_PER_USER_PER_MIN || 12);
const SESSION_TTL_MINUTES = Number(process.env.SESSION_TTL_MINUTES || 60);

const ALLOW_BULLETS = String(process.env.ALLOW_BULLETS || "true") === "true";
const SEND_SINGLE_MESSAGE = String(process.env.SEND_SINGLE_MESSAGE || "true") === "true";
const SPLIT_LONG_MESSAGES = String(process.env.SPLIT_LONG_MESSAGES || "true") === "true";

// =====================
// OpenAI client (optional)
// =====================
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// =====================
// In-memory session store
// =====================
const sessions = new Map(); // key: waId => { lastAt, timer, greeted, lastReplyAt, rate, history, ttlAt }

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
  // Simple local greeting based on Chile time (approx, without external libs).
  // We rely on server time; Railway usually UTC. We'll approximate using Intl.
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

function shouldHandoff(text) {
  const t = (text || "").toLowerCase();
  return HUMAN_HANDOFF_ENABLED && HUMAN_HANDOFF_KEYWORDS.some((k) => t.includes(k));
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
      history: [],
      ttlAt: t + SESSION_TTL_MINUTES * 60_000,
      afterHoursSent: false,
    };
    sessions.set(waId, ns);
    return ns;
  }
  // TTL refresh
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
// WhatsApp send helpers
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

// =====================
// Extract measurements from plain text (PDF text or user text)
// =====================
function extractMeasurements(text) {
  const t = (text || "").replace(/\s+/g, " ");
  const out = [];

  // 1200x1400, 1200 x 1400, 1200X1400
  const re1 = /(\d{2,4}(?:[.,]\d{1,2})?)\s*[xX×]\s*(\d{2,4}(?:[.,]\d{1,2})?)/g;
  let m;
  while ((m = re1.exec(t))) {
    out.push({ w: m[1], h: m[2], raw: m[0] });
  }

  // 1.20 x 1.40 (meters style)
  const re2 = /(\d(?:[.,]\d{1,2})?)\s*[xX×]\s*(\d(?:[.,]\d{1,2})?)\s*(m|mt|mts)?/g;
  while ((m = re2.exec(t))) {
    out.push({ w: m[1], h: m[2], raw: m[0] });
  }

  // 1200 mm x 1400 mm
  const re3 = /(\d{2,4})\s*(mm|cm|m)\s*[xX×]\s*(\d{2,4})\s*(mm|cm|m)/g;
  while ((m = re3.exec(t))) {
    out.push({ w: m[1] + m[2], h: m[3] + m[4], raw: m[0] });
  }

  // Dedup by raw
  const seen = new Set();
  return out.filter((x) => {
    const k = x.raw;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// =====================
// Build consultative answer (Windows/doors only)
// =====================
function buildBaseConsultativeNote() {
  return (
    `Para que la solución quede bien recomendada, siempre miramos 3 condiciones clave: ${DEFAULT_PRIORITY}.\n` +
    `En general, la condensación interior no depende solo de la ventana: aparece cuando la humedad interior sube (típicamente sobre ~80% HR) y la superficie interior baja su temperatura. En PVC línea europea + DVH + buena hermeticidad e instalación, esa situación es poco probable dentro de la casa; y si ocurre, normalmente se corrige con ventilación controlada / manejo de humedad.\n` +
    `Trabajamos PVC americano, PVC línea europea y aluminio; todos pueden llevar DVH (termopanel). Lo que cambia es la hermeticidad, el refuerzo, los herrajes y el nivel de desempeño final.`
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

// Ask only one thing
function buildNextQuestion(context) {
  // context: { city, qty, hasMeasures, wantsInstall }
  if (!context.city) return "¿En qué ciudad se instalarían (por ejemplo, Temuco, Pucón, Villarrica)?";
  if (!context.qty) return "¿Cuántas ventanas y/o puertas necesitas en total (número aproximado)?";
  if (!context.hasMeasures) {
    return "¿Me puedes enviar medidas aproximadas (ancho x alto) o una foto/plano con las medidas? Con eso preparo una propuesta inicial.";
  }
  if (context.wantsInstall == null) return "¿Las necesitas con instalación incluida o solo fabricación?";
  return "¿Prefieres corredera u oscilobatiente/proyectante, o quieres que te recomiende según ventilación y uso?";
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
// AI (optional) - keep it simple
// =====================
async function aiDraftReply(userText, extractedMeasures) {
  if (!openai || AI_PROVIDER !== "openai") return null;

  const measuresTxt = extractedMeasures?.length
    ? `Medidas detectadas (aprox): ${extractedMeasures.map((m) => m.raw).join(", ")}.`
    : "No se detectaron medidas en el texto.";

  const system = `
Eres un asesor comercial-técnico chileno especializado SOLO en ventanas y puertas (no muros cortina).
Estilo: consultivo, cercano, humano, profesional. Sin emojis.
Siempre prioriza 3 pilares: aislación térmica, aislación acústica y seguridad.
Explica brevemente si corresponde que la condensación se relaciona con humedad interior y temperatura de superficie.
Siempre haz máximo 1 pregunta al final.
Si el cliente dice que enviará fotos o PDF, agradece y confirma que se revisarán medidas aproximadas, y que al aceptar se agenda visita técnica con telémetro láser y se entrega informe técnico.
Firma solo si corresponde al primer mensaje (el programa se encargará de saludo/firma).
`;

  const user = `
Cliente dice: ${userText}
${measuresTxt}
Genera una respuesta corta, humana y clara.`;

  const resp = await openai.chat.completions.create({
    model: AI_MODEL_OPENAI,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.4,
  });

  return resp.choices?.[0]?.message?.content?.trim() || null;
}

// =====================
// Core delayed response logic (prevents replying while user typing)
// =====================
async function scheduleReply(waId, lastMessageId, collectedText) {
  const sess = getSession(waId);
  sess.lastAt = nowMs();

  if (sess.timer) clearTimeout(sess.timer);

  sess.timer = setTimeout(async () => {
    try {
      // after-hours gate
      if (!withinBusinessHours()) {
        if (!sess.afterHoursSent) {
          await waSendText(waId, AFTER_HOURS_MESSAGE);
          sess.afterHoursSent = true;
        }
        return;
      }

      if (!rateLimitOk(sess)) return;

      // Optional human handoff
      if (shouldHandoff(collectedText)) {
        const msg = `${maybeGreeting(sess)}Perfecto. Te derivo con un asesor para que lo veamos en detalle. ¿Me confirmas tu ciudad y si es con instalación incluida?${maybeSignature(sess)}`;
        await waSendText(waId, msg);
        sess.greeted = true;
        return;
      }

      // Build consultive reply
      const ctx = inferContextFromText(collectedText);
      const hasMeasures = (ctx.measures?.length || 0) > 0;

      // Base message + proof of expertise
      let reply =
        `${maybeGreeting(sess)}` +
        `Gracias por la información. ${buildBaseConsultativeNote()}\n`;

      // If measures detected, acknowledge
      if (hasMeasures) {
        reply += `\nVi estas medidas aproximadas: ${ctx.measures.map((m) => m.raw).join(", ")}. Con esto puedo preparar una propuesta inicial y después afinamos con verificación en terreno.\n`;
      }

      // Mention technical specialist / laser measurement
      reply +=
        `\nCuando la propuesta se aprueba, asignamos un especialista técnico que verifica medidas en terreno con telémetro láser (alta precisión) y se entrega un informe técnico para fabricación e instalación.\n`;

      // Ask only one question (as you requested)
      const question = buildNextQuestion({ city: ctx.city, qty: ctx.qty, hasMeasures, wantsInstall: ctx.wantsInstall });
      if (ONE_QUESTION_PER_TURN) {
        reply += `\n${question}`;
      }

      // Optional: let AI rephrase into more human answer (if enabled)
      const ai = await aiDraftReply(collectedText, ctx.measures);
      if (ai) {
        // We keep greeting/signature from our system to preserve rules
        const g = maybeGreeting(sess);
        const sig = maybeSignature(sess);
        reply = `${g}${ai}${sig}`;
      } else {
        reply += `${maybeSignature(sess)}`;
      }

      // clean up
      reply = splitLines(clampText(reply));

      // delays to feel human
      const waitBase = randomBetween(HUMAN_DELAY_MS_MIN, HUMAN_DELAY_MS_MAX);
      const extra = randomBetween(MIN_RESPONSE_DELAY_MS, MAX_RESPONSE_DELAY_MS);
      await new Promise((r) => setTimeout(r, Math.max(0, waitBase + extra)));

      await waSendText(waId, reply);

      sess.greeted = true;
      sess.lastReplyAt = nowMs();

      // mark read if possible
      if (lastMessageId) {
        await waMarkRead(lastMessageId).catch(() => {});
      }
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
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
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
    const waId = msg.from; // user phone
    const messageId = msg.id;

    let collectedText = "";

    // Text message
    if (msg.type === "text") {
      collectedText = msg.text?.body || "";
    } else {
      // Other message types: image/document/audio/etc.
      // For now: ask user to send measures in text or as PDF/image with measures.
      // (You can extend: download media and parse PDF; needs additional endpoints.)
      collectedText = "Cliente envió un archivo o imagen con información del proyecto.";
    }

    // update session & schedule reply after user stops writing
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
  console.log(`STYLE GREETING_MODE: ${GREETING_MODE}`);
  console.log(`STYLE FORMALITY_LEVEL: ${FORMALITY_LEVEL}`);
  console.log(`STYLE EMOJI_LEVEL: ${EMOJI_LEVEL ? EMOJI_LEVEL : "off"}`);
  console.log(`STYLE CTA_STYLE: ${CTA_STYLE}`);
});
