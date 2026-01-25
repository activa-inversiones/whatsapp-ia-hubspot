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

// AI
const AI_PROVIDER = (process.env.AI_PROVIDER || "openai").toLowerCase();
const AI_MODEL_OPENAI = process.env.AI_MODEL_OPENAI || "gpt-4.1-mini";
const AI_MODEL_VISION = process.env.AI_MODEL_VISION || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Style / business
const LANGUAGE = process.env.LANGUAGE || "es-CL";
const COMPANY_NAME = process.env.COMPANY_NAME || "Activa Inversiones";
const BRAND_SHORT = process.env.BRAND_SHORT || "Activa";
const AGENT_NAME = process.env.AGENT_NAME || "Marcelo Cifuentes";

const DEFAULT_CITY = process.env.DEFAULT_CITY || "Temuco";
const DEFAULT_PRIORITY = process.env.DEFAULT_PRIORITY || "aislación térmica, acústica y seguridad";

// Reply pacing (human)
const WAIT_AFTER_LAST_USER_MESSAGE_MS = Number(process.env.WAIT_AFTER_LAST_USER_MESSAGE_MS || 2500);
const HUMAN_DELAY_MS_MIN = Number(process.env.HUMAN_DELAY_MS_MIN || 700);
const HUMAN_DELAY_MS_MAX = Number(process.env.HUMAN_DELAY_MS_MAX || 1600);

const MAX_LINES_PER_REPLY = Number(process.env.MAX_LINES_PER_REPLY || 10);
const MAX_REPLY_CHARS = Number(process.env.MAX_REPLY_CHARS || 1200);
const ONE_QUESTION_PER_TURN = String(process.env.ONE_QUESTION_PER_TURN || "true") === "true";

// Business hours
const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || "America/Santiago";
const BUSINESS_HOURS_ONLY = String(process.env.BUSINESS_HOURS_ONLY || "false") === "true";
const BUSINESS_HOURS_START = process.env.BUSINESS_HOURS_START || "09:00";
const BUSINESS_HOURS_END = process.env.BUSINESS_HOURS_END || "19:00";
const AFTER_HOURS_MESSAGE =
  process.env.AFTER_HOURS_MESSAGE ||
  "Hola, gracias por escribir. En este momento estamos fuera de horario, pero mañana a primera hora te respondemos y avanzamos con tu cotización.";

// Handoff
const HUMAN_HANDOFF_ENABLED = String(process.env.HUMAN_HANDOFF_ENABLED || "true") === "true";
const HUMAN_HANDOFF_KEYWORDS = (process.env.HUMAN_HANDOFF_KEYWORDS || "humano,asesor,llamar,urgente,hablar con alguien,ejecutivo")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Rate limit / sessions
const RATE_LIMIT_PER_USER_PER_MIN = Number(process.env.RATE_LIMIT_PER_USER_PER_MIN || 12);
const SESSION_TTL_MINUTES = Number(process.env.SESSION_TTL_MINUTES || 60);

// Typing indicator (puntitos)
const TYPING_SIMULATION = String(process.env.TYPING_SIMULATION || "true") === "true";
const TYPING_MIN_MS = Number(process.env.TYPING_MIN_MS || 900);
const TYPING_MAX_MS = Number(process.env.TYPING_MAX_MS || 2100);
// WhatsApp typing indicator drops after ~25s or when you answer. Keep under 20s for safety.
const TYPING_HARD_CAP_MS = 20000;

// =====================
// OpenAI client (optional)
// =====================
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// =====================
// In-memory session store
// =====================
const sessions = new Map(); // waId => session

function nowMs() {
  return Date.now();
}

function randomBetween(min, max) {
  const a = Math.min(min, max);
  const b = Math.max(min, max);
  return Math.floor(a + Math.random() * (b - a + 1));
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

// REAL typing indicator (WhatsApp Cloud API):
// send status=read + typing_indicator with message_id (per Meta-style pattern). :contentReference[oaicite:1]{index=1}
async function waTypingIndicator(messageId) {
  if (!TYPING_SIMULATION) return;
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
    typing_indicator: { type: "text" },
  };
  await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    timeout: 30_000,
  });
}

// =====================
// Media download (PDF / images)
// =====================
async function waGetMediaInfo(mediaId) {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${mediaId}`;
  const resp = await axios.get(url, {
    params: { fields: "url,mime_type,file_size,filename" },
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    timeout: 30_000,
  });
  return resp.data; // { url, mime_type, file_size, ... }
}

async function waDownloadMedia(downloadUrl) {
  const resp = await axios.get(downloadUrl, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    timeout: 60_000,
  });
  return Buffer.from(resp.data);
}

// =====================
// Extract measurements from text
// =====================
function extractMeasurements(text) {
  const t = (text || "").replace(/\s+/g, " ");
  const out = [];

  const re1 = /(\d{2,4}(?:[.,]\d{1,2})?)\s*[xX×]\s*(\d{2,4}(?:[.,]\d{1,2})?)/g;
  let m;
  while ((m = re1.exec(t))) out.push({ w: m[1], h: m[2], raw: m[0] });

  const re2 = /(\d(?:[.,]\d{1,2})?)\s*[xX×]\s*(\d(?:[.,]\d{1,2})?)\s*(m|mt|mts)?/g;
  while ((m = re2.exec(t))) out.push({ w: m[1], h: m[2], raw: m[0] });

  const re3 = /(\d{2,4})\s*(mm|cm|m)\s*[xX×]\s*(\d{2,4})\s*(mm|cm|m)/g;
  while ((m = re3.exec(t))) out.push({ w: m[1] + m[2], h: m[3] + m[4], raw: m[0] });

  const seen = new Set();
  return out.filter((x) => {
    if (seen.has(x.raw)) return false;
    seen.add(x.raw);
    return true;
  });
}

// =====================
// Consultative response
// =====================
function buildBaseConsultativeNote() {
  return (
    `Para recomendar bien, siempre miramos 3 condiciones: ${DEFAULT_PRIORITY}.\n` +
    `La condensación interior no depende solo de la ventana: aparece cuando sube la humedad interior y baja la temperatura de la superficie. En PVC línea europea + DVH + buena hermeticidad e instalación, es poco probable; y si ocurre, suele corregirse con ventilación/manejo de humedad.\n` +
    `Trabajamos PVC (americano y línea europea) y aluminio; todos pueden llevar DVH (termopanel). Lo que cambia es hermeticidad, refuerzos, herrajes y desempeño final.`
  );
}

function maybeGreeting(sess) {
  if (sess.greeted) return "";
  return `${getTimeGreeting()}, soy ${AGENT_NAME}. `;
}

function maybeSignature(sess) {
  if (sess.greeted) return "";
  return `\n\n— ${AGENT_NAME} | ${BRAND_SHORT}`;
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

function buildNextQuestion(context) {
  if (!context.city) return "¿En qué ciudad se instalarían (por ejemplo, Temuco, Pucón, Villarrica)?";
  if (!context.qty) return "¿Cuántas ventanas y/o puertas necesitas en total (número aproximado)?";
  if (!context.hasMeasures) return "¿Me envías medidas aproximadas (ancho x alto) o una foto/plano con las medidas?";
  if (context.wantsInstall == null) return "¿Las necesitas con instalación incluida o solo fabricación?";
  return "¿Prefieres corredera u oscilobatiente/proyectante, o te recomiendo según ventilación y uso?";
}

// =====================
// AI drafts (optional)
// =====================
async function aiDraftReply(userText, extractedMeasures) {
  if (!openai || AI_PROVIDER !== "openai") return null;

  const measuresTxt = extractedMeasures?.length
    ? `Medidas detectadas (aprox): ${extractedMeasures.map((m) => m.raw).join(", ")}.`
    : "No se detectaron medidas en el texto.";

  const system = `
Eres un asesor comercial-técnico chileno especializado SOLO en ventanas y puertas.
Estilo: consultivo, cercano, humano, profesional. Sin emojis.
Prioriza 3 pilares: aislación térmica, aislación acústica y seguridad.
Explica brevemente si corresponde condensación = humedad interior + temperatura de superficie.
Máximo 1 pregunta al final.
Respuesta corta.
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
    temperature: 0.35,
  });

  return resp.choices?.[0]?.message?.content?.trim() || null;
}

async function visionExtractTextFromImage(imageBuffer, mimeType) {
  if (!openai || AI_PROVIDER !== "openai") return null;
  const b64 = imageBuffer.toString("base64");
  const dataUrl = `data:${mimeType || "image/jpeg"};base64,${b64}`;

  const system = `
Eres un especialista en interpretación de imágenes para cotización de ventanas.
Tarea: extrae texto y especialmente medidas (ancho x alto), cantidades, tipos (corredera/proyectante), y cualquier nota.
Devuelve SOLO texto plano en español, sin formato complejo.
`;

  const resp = await openai.chat.completions.create({
    model: AI_MODEL_VISION,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: "Extrae el contenido útil para cotización (medidas, cantidades, tipos, observaciones)." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    temperature: 0.2,
  });

  return resp.choices?.[0]?.message?.content?.trim() || null;
}

// =====================
// Typing simulation timing
// =====================
async function maybeTyping(messageId, startedAtMs) {
  if (!TYPING_SIMULATION || !messageId) return;
  try {
    await waTypingIndicator(messageId);
  } catch {
    // If typing fails, continue silently.
  }

  // Ensure a minimum "typing" time, but never exceed safe cap.
  const desired = Math.min(randomBetween(TYPING_MIN_MS, TYPING_MAX_MS), TYPING_HARD_CAP_MS);
  const elapsed = nowMs() - startedAtMs;
  const remaining = Math.max(0, desired - elapsed);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
}

// =====================
// Core delayed reply logic
// =====================
async function scheduleReply(waId, lastMessageId, collectedText) {
  const sess = getSession(waId);
  sess.lastAt = nowMs();

  if (sess.timer) clearTimeout(sess.timer);

  sess.timer = setTimeout(async () => {
    const startProcessing = nowMs();
    try {
      if (!withinBusinessHours()) {
        if (!sess.afterHoursSent) {
          await waSendText(waId, AFTER_HOURS_MESSAGE);
          sess.afterHoursSent = true;
        }
        return;
      }

      if (!rateLimitOk(sess)) return;

      // Turn on typing indicator early (so user sees dots while we "think")
      await maybeTyping(lastMessageId, startProcessing);

      // Optional human handoff
      if (shouldHandoff(collectedText)) {
        const msg = `${maybeGreeting(sess)}Perfecto. Te derivo con un asesor para verlo en detalle. ¿Me confirmas tu ciudad y si es con instalación incluida?${maybeSignature(sess)}`;
        await waSendText(waId, msg);
        sess.greeted = true;
        return;
      }

      const ctx = inferContextFromText(collectedText);
      const hasMeasures = (ctx.measures?.length || 0) > 0;

      let reply =
        `${maybeGreeting(sess)}` +
        `Gracias por la información. ${buildBaseConsultativeNote()}\n`;

      if (hasMeasures) {
        reply += `\nVi estas medidas aproximadas: ${ctx.measures.map((m) => m.raw).join(", ")}. Con esto preparo una propuesta inicial y luego afinamos con verificación en terreno.\n`;
      }

      reply += `\nCuando se aprueba la propuesta, verificamos medidas en terreno y dejamos listo para fabricación e instalación.\n`;

      if (ONE_QUESTION_PER_TURN) {
        const q = buildNextQuestion({ city: ctx.city, qty: ctx.qty, hasMeasures, wantsInstall: ctx.wantsInstall });
        reply += `\n${q}`;
      }

      // AI rewrite (optional)
      const ai = await aiDraftReply(collectedText, ctx.measures);
      if (ai) {
        reply = `${maybeGreeting(sess)}${ai}${maybeSignature(sess)}`;
      } else {
        reply += `${maybeSignature(sess)}`;
      }

      reply = splitLines(clampText(reply));

      // Small human delay (already showed typing)
      const humanDelay = randomBetween(HUMAN_DELAY_MS_MIN, HUMAN_DELAY_MS_MAX);
      await new Promise((r) => setTimeout(r, humanDelay));

      await waSendText(waId, reply);
      sess.greeted = true;
      sess.lastReplyAt = nowMs();

      // Mark read (safe)
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
    const waId = msg.from; // user phone
// Reset session command (simulate "new client")
const incomingText = msg.type === "text" ? (msg.text?.body || "").trim().toLowerCase() : "";
if (incomingText === "reset" || incomingText === "nuevo" || incomingText === "start") {
  sessions.delete(waId);
  await waSendText(waId, "Listo. Reinicié tu sesión. Escribe tu solicitud como si fuera primera vez.");
  return res.sendStatus(200);
}

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
      const mime = msg.document?.mime_type || "";
      const filename = msg.document?.filename || "archivo";
      const mediaId = msg.document?.id;

      console.log("INCOMING DOCUMENT:", { mime, filename, mediaId });

      if (mediaId && mime.includes("pdf")) {
        // show typing while we process
        try { await waTypingIndicator(messageId); } catch {}

        const info = await waGetMediaInfo(mediaId);
        const fileBuf = await waDownloadMedia(info.url);
        const parsed = await pdfParse(fileBuf);

        const text = (parsed?.text || "").trim();
        const measures = extractMeasurements(text);

        collectedText =
          `Cliente envió PDF: ${filename}\n` +
          (measures.length ? `Medidas detectadas: ${measures.map((m) => m.raw).join(", ")}\n` : "") +
          `Contenido:\n${text.slice(0, 6000)}`;

        await scheduleReply(waId, messageId, collectedText);
        return res.sendStatus(200);
      }

      collectedText = `Cliente envió documento (${filename}). Si trae medidas, ideal si me las confirmas como ancho x alto o en el PDF.`;
      await scheduleReply(waId, messageId, collectedText);
      return res.sendStatus(200);
    }

    // IMAGE
    if (msg.type === "image") {
      const mediaId = msg.image?.id;
      const mime = msg.image?.mime_type || "image/jpeg";

      console.log("INCOMING IMAGE:", { mime, mediaId });

      if (mediaId && openai) {
        try { await waTypingIndicator(messageId); } catch {}

        const info = await waGetMediaInfo(mediaId);
        const imgBuf = await waDownloadMedia(info.url);

        const extracted = await visionExtractTextFromImage(imgBuf, mime);
        collectedText =
          `Cliente envió imagen con información del proyecto.\n` +
          (extracted ? `Texto/medidas extraídas:\n${extracted}` : "No pude extraer texto con claridad. Si puedes, envía medidas como ancho x alto.");

        await scheduleReply(waId, messageId, collectedText);
        return res.sendStatus(200);
      }

      collectedText = "Cliente envió una imagen. Si me confirmas medidas (ancho x alto) y cantidad, preparo la propuesta inicial.";
      await scheduleReply(waId, messageId, collectedText);
      return res.sendStatus(200);
    }

    // Other types (audio/video/etc.)
    collectedText = "Cliente envió un archivo. Si incluye medidas, por favor confírmalas en texto (ancho x alto) para cotizar rápido.";
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
  console.log(`TYPING_SIMULATION: ${TYPING_SIMULATION}`);
});
