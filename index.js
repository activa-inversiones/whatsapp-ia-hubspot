<<<<<<< Updated upstream
// index.js (V3 - Estable y “a prueba de duplicados”)
// WhatsApp Cloud API + IA (ventas de ventanas) + PDF/Imagen + typing indicator + dedupe + session memory
// Node ESM: en package.json debe existir: { "type": "module" }
=======
// index.js (V4.0.0 - FULL: WhatsApp + IA + PDFKit (cotización PDF) + Whisper (audio) + PDF/Imagen lectura + typing + dedupe + ACK 200)
// Node ESM: package.json debe tener: { "type": "module" }
//
// DEPENDENCIAS (npm i):
//   npm i express axios openai pdf-parse pdfkit form-data
//
// ENV REQUIRED (Railway):
//   WHATSAPP_TOKEN
//   PHONE_NUMBER_ID
//   VERIFY_TOKEN
//   OPENAI_API_KEY
//
// ENV RECOMENDADAS:
//   META_GRAPH_VERSION=v22.0
//   AI_MODEL_OPENAI=gpt-4.1-mini
//   AI_MODEL_VISION=gpt-4o-mini
//   TYPING_SIMULATION=true
>>>>>>> Stashed changes

import express from "express";
import axios from "axios";
import OpenAI from "openai";
import pdfParse from "pdf-parse";
import PDFDocument from "pdfkit";
import FormData from "form-data";
import { Readable } from "stream";

// =====================
// App
// =====================
const app = express();
<<<<<<< Updated upstream
app.use(express.json({ limit: "10mb" }));
=======
app.use(express.json({ limit: "12mb" }));
>>>>>>> Stashed changes
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
const AI_MODEL_OPENAI = env("AI_MODEL_OPENAI", "gpt-4.1-mini");
const AI_MODEL_VISION = env("AI_MODEL_VISION", "gpt-4o-mini");
const AI_TEMPERATURE = Number(env("AI_TEMPERATURE", "0.35"));
<<<<<<< Updated upstream
const AI_MAX_OUTPUT_TOKENS = envInt("AI_MAX_OUTPUT_TOKENS", 360);
=======
const AI_MAX_OUTPUT_TOKENS = envInt("AI_MAX_OUTPUT_TOKENS", 420);
>>>>>>> Stashed changes

// =====================
// Brand / style
// =====================
const COMPANY_NAME = env("COMPANY_NAME", "Activa");
const AGENT_NAME = env("AGENT_NAME", "Marcelo Cifuentes");
const LANGUAGE = env("LANGUAGE", "es-CL");
const TONO = env("TONO", "usted"); // "usted" | "tu"
const PILLARS = env("PILLARS", "térmico, acústico, seguridad, eficiencia energética");
const MINVU_EXPERT_NOTE = env(
  "MINVU_EXPERT_NOTE",
  "Especialista en especificación de ventanas bajo normativa chilena, con foco en eficiencia energética y desempeño térmico."
);

// =====================
// Humanization / pacing
// =====================
<<<<<<< Updated upstream
const WAIT_AFTER_LAST_USER_MESSAGE_MS = envInt("WAIT_AFTER_LAST_USER_MESSAGE_MS", 2500);
const EXTRA_DELAY_MEDIA_MS = envInt("EXTRA_DELAY_MEDIA_MS", 2500);
const TYPING_SIMULATION = envBool("TYPING_SIMULATION", true);
const TYPING_MIN_MS = envInt("TYPING_MIN_MS", 900);
const TYPING_MAX_MS = envInt("TYPING_MAX_MS", 2100);
const MAX_LINES_PER_REPLY = envInt("MAX_LINES_PER_REPLY", 8);
const ONE_QUESTION_PER_TURN = envBool("ONE_QUESTION_PER_TURN", true);
const MAX_WA_CHARS = envInt("MAX_WA_CHARS", 3500);
=======
const WAIT_AFTER_LAST_USER_MESSAGE_MS = envInt("WAIT_AFTER_LAST_USER_MESSAGE_MS", 1800);
const EXTRA_DELAY_MEDIA_MS = envInt("EXTRA_DELAY_MEDIA_MS", 1800);
const TYPING_SIMULATION = envBool("TYPING_SIMULATION", true);
const TYPING_MIN_MS = envInt("TYPING_MIN_MS", 700);
const TYPING_MAX_MS = envInt("TYPING_MAX_MS", 1700);
const MAX_LINES_PER_REPLY = envInt("MAX_LINES_PER_REPLY", 8);
const ONE_QUESTION_PER_TURN = envBool("ONE_QUESTION_PER_TURN", true);
const MAX_WA_CHARS = envInt("MAX_WA_CHARS", 3300);
>>>>>>> Stashed changes

// Loop guard
const LOOP_GUARD_MAX_REPLIES_PER_5MIN = envInt("LOOP_GUARD_MAX_REPLIES_PER_5MIN", 6);

// Session caps
const HISTORY_MAX_ITEMS = envInt("HISTORY_MAX_ITEMS", 30);
const MEASURES_MAX_ITEMS = envInt("MEASURES_MAX_ITEMS", 30);

// Dedupe TTL
const DEDUPE_TTL_MS = envInt("DEDUPE_TTL_MS", 10 * 60 * 1000);

<<<<<<< Updated upstream
=======
// PDF options
const DEFAULT_PDF_FILENAME = env("PDF_FILENAME", "cotizacion_activa.pdf");

>>>>>>> Stashed changes
// Optional: Size limits JSON
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
// Logs (sanity)
// =====================
<<<<<<< Updated upstream
console.log("Starting Container");
=======
console.log("Starting Container - V4.0.0 (PDFKit + Whisper)");
>>>>>>> Stashed changes
console.log(`Server running on port ${PORT}`);
console.log(`ENV META_GRAPH_VERSION: ${META_GRAPH_VERSION}`);
console.log(`ENV PHONE_NUMBER_ID: ${PHONE_NUMBER_ID ? "OK" : "MISSING"}`);
console.log(`ENV WHATSAPP_TOKEN: ${WHATSAPP_TOKEN ? "OK" : "MISSING"}`);
console.log(`ENV VERIFY_TOKEN: ${VERIFY_TOKEN ? "OK" : "MISSING"}`);
console.log(`ENV OPENAI_API_KEY: ${OPENAI_API_KEY ? "OK" : "MISSING"}`);
console.log(`ENV AI_MODEL_OPENAI: ${AI_MODEL_OPENAI}`);
console.log(`ENV AI_MODEL_VISION: ${AI_MODEL_VISION}`);
console.log(`TYPING_SIMULATION: ${TYPING_SIMULATION}`);

// =====================
// Health
// =====================
app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", (req, res) => res.status(200).json({ ok: true }));

// =====================
// Webhook verification (GET /webhook)
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
<<<<<<< Updated upstream
=======
// Safe array helpers (ANTI push undefined)
// =====================
function ensureArray(obj, key) {
  if (!obj || typeof obj !== "object") return [];
  if (!Array.isArray(obj[key])) obj[key] = [];
  return obj[key];
}

// =====================
>>>>>>> Stashed changes
// Session store + normalization
// =====================
const sessions = new Map(); // waId -> session

function normalizeSession(session, waId = "") {
  if (!session || typeof session !== "object") session = {};
  if (!session.waId) session.waId = waId;
  if (!session.createdAt) session.createdAt = Date.now();
  if (!session.lastSeenAt) session.lastSeenAt = 0;
  if (!session.lastReplyAt) session.lastReplyAt = 0;

<<<<<<< Updated upstream
  if (!Array.isArray(session.history)) session.history = [];
  if (!Array.isArray(session.repliesIn5Min)) session.repliesIn5Min = [];

  if (!session.context || typeof session.context !== "object") session.context = {};
  if (!Array.isArray(session.context.measuresMm)) session.context.measuresMm = [];

  // Campos opcionales de contexto
=======
  ensureArray(session, "history");
  ensureArray(session, "repliesIn5Min");

  if (!session.context || typeof session.context !== "object") session.context = {};
  ensureArray(session.context, "measuresMm");

  // Context fields
>>>>>>> Stashed changes
  if (session.context.name === undefined) session.context.name = null;
  if (session.context.projectType === undefined) session.context.projectType = null;
  if (session.context.city === undefined) session.context.city = null;
  if (session.context.productInterest === undefined) session.context.productInterest = null;
<<<<<<< Updated upstream

  // Caps
  if (session.history.length > HISTORY_MAX_ITEMS) session.history = session.history.slice(-HISTORY_MAX_ITEMS);
  if (session.context.measuresMm.length > MEASURES_MAX_ITEMS)
    session.context.measuresMm = session.context.measuresMm.slice(-MEASURES_MAX_ITEMS);
=======
  if (session.context.glass === undefined) session.context.glass = null; // básico / Low-E / etc.
  if (session.context.openingType === undefined) session.context.openingType = null; // corredera/abatible/fija
  if (session.context.color === undefined) session.context.color = null; // blanco/nogal/etc.
  if (session.context.installType === undefined) session.context.installType = null; // obra nueva / recambio

  // Caps
  if (session.history.length > HISTORY_MAX_ITEMS) session.history = session.history.slice(-HISTORY_MAX_ITEMS);
  if (session.context.measuresMm.length > MEASURES_MAX_ITEMS) {
    session.context.measuresMm = session.context.measuresMm.slice(-MEASURES_MAX_ITEMS);
  }
>>>>>>> Stashed changes

  return session;
}

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(
      waId,
      normalizeSession(
        {
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
<<<<<<< Updated upstream
=======
            glass: null,
            openingType: null,
            color: null,
            installType: null,
>>>>>>> Stashed changes
          },
        },
        waId
      )
    );
  } else {
    sessions.set(waId, normalizeSession(sessions.get(waId), waId));
  }
  return sessions.get(waId);
}

function loopGuardOk(session) {
<<<<<<< Updated upstream
=======
  ensureArray(session, "repliesIn5Min");
>>>>>>> Stashed changes
  const now = Date.now();
  session.repliesIn5Min = session.repliesIn5Min.filter((t) => now - t < 5 * 60 * 1000);
  return session.repliesIn5Min.length < LOOP_GUARD_MAX_REPLIES_PER_5MIN;
}

function noteReply(session) {
<<<<<<< Updated upstream
  session.repliesIn5Min.push(Date.now());
=======
  ensureArray(session, "repliesIn5Min").push(Date.now());
>>>>>>> Stashed changes
  session.lastReplyAt = Date.now();
}

// =====================
// Dedupe (Map TTL)
// =====================
const processedMsgIds = new Map(); // msgId -> expireAt
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

// =====================
// WhatsApp API helpers
// =====================
const WA_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}/${PHONE_NUMBER_ID}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

<<<<<<< Updated upstream
  // retries + timeout
=======
>>>>>>> Stashed changes
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      return await axios.post(`${WA_BASE}/messages`, payload, { headers, timeout: 15000 });
    } catch (e) {
      lastErr = e;
<<<<<<< Updated upstream
      const status = e?.response?.status;
      const data = e?.response?.data;
      console.error("waSendText error retry", { i, status, data });
=======
      console.error("waSendText error retry", {
        i,
        status: e?.response?.status,
        data: e?.response?.data,
      });
>>>>>>> Stashed changes
      await sleep(900 * (i + 1));
    }
  }
  throw lastErr;
}

<<<<<<< Updated upstream
=======
async function waSendDocument(to, mediaId, filename = DEFAULT_PDF_FILENAME, caption = "Adjunto su cotización.") {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: {
      id: mediaId,
      filename,
      caption,
    },
  };

  return axios.post(`${WA_BASE}/messages`, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    timeout: 15000,
  });
}

>>>>>>> Stashed changes
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

// =====================
<<<<<<< Updated upstream
// Media download (Cloud API)
=======
// Media download + upload (Cloud API)
>>>>>>> Stashed changes
// =====================
async function waGetMediaUrl(mediaId) {
  const r = await axios.get(`https://graph.facebook.com/${META_GRAPH_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    timeout: 15000,
  });
  return r.data?.url;
}

async function waDownloadMediaBytes(mediaUrl) {
  const r = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    responseType: "arraybuffer",
    timeout: 30000,
  });
  return Buffer.from(r.data);
}

<<<<<<< Updated upstream
=======
// Upload PDF (Buffer) to WhatsApp /media -> returns media_id
async function waUploadMedia(buffer, filename = DEFAULT_PDF_FILENAME, mimeType = "application/pdf") {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${PHONE_NUMBER_ID}/media`;

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buffer, { filename, contentType: mimeType });

  const headers = {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    ...form.getHeaders(),
  };

  const r = await axios.post(url, form, { headers, timeout: 30000 });
  return r.data?.id; // media_id
}

>>>>>>> Stashed changes
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

  // 1200x1000 mm|cm|m
  const reX = /(\d{1,4}(\.\d{1,3})?)\s*[x×]\s*(\d{1,4}(\.\d{1,3})?)\s*(mm|cm|m)?/g;
  let m;
  while ((m = reX.exec(clean))) {
    const unit = m[5] || "mm";
    const w = toMm(m[1], unit);
    const h = toMm(m[3], unit);
    if (w && h) out.push({ w, h, unit: "mm", confidence: 0.75, raw: m[0] });
  }

  // ancho 1200 alto 1000
  const reAH =
    /(ancho|largo)\s*(\d{1,4}(\.\d{1,3})?)\s*(mm|cm|m)?[\s,;]+(alto|altura)\s*(\d{1,4}(\.\d{1,3})?)\s*(mm|cm|m)?/g;
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
<<<<<<< Updated upstream
// AI Prompt (ventas de ventanas)
=======
// PDF module (generate cotización PDF)
// =====================
async function generatePDF(waId, measures, meta = {}) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const buffers = [];
    doc.on("data", (d) => buffers.push(d));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    doc.fontSize(18).text(`Cotización - ${COMPANY_NAME}`, { align: "center" });
    doc.moveDown();

    doc.fontSize(11).text(`Cliente (WhatsApp): ${waId}`);
    if (meta.city) doc.text(`Comuna: ${meta.city}`);
    if (meta.color) doc.text(`Color: ${meta.color}`);
    if (meta.openingType) doc.text(`Apertura: ${meta.openingType}`);
    if (meta.glass) doc.text(`Vidrio: ${meta.glass}`);
    if (meta.installType) doc.text(`Instalación: ${meta.installType}`);
    doc.moveDown();

    doc.fontSize(12).text("Ítems:", { underline: true });
    doc.moveDown(0.5);

    measures.forEach((m, i) => {
      doc.text(`${i + 1}. Ventana/Puerta: ${m.w} x ${m.h} mm`);
    });

    doc.moveDown();
    doc.fontSize(9).fillColor("gray").text(
      "Nota: Cotización referencial sujeta a confirmación en visita/levantamiento y condiciones de instalación. Vigencia referencial 7 días.",
      { align: "left" }
    );

    doc.end();
  });
}

function wantsPdf(text = "") {
  const t = text.toLowerCase();
  return t.includes("pdf") || t.includes("cotizacion pdf") || t.includes("cotización pdf") || t.includes("en pdf");
}

// =====================
// Whisper module (audio -> text)
// =====================
async function transcribeVoice(buffer) {
  if (!openai) return "";
  const file = await OpenAI.toFile(Readable.from(buffer), "voice.ogg");
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
  });
  return transcription?.text || "";
}

// =====================
// AI Prompt (ventas ventanas) + regla "recomiéndame tú"
>>>>>>> Stashed changes
// =====================
function buildSystemPrompt(session) {
  const tono = TONO === "tu" ? "tú" : "usted";

  const offer = [
    `Eres ${AGENT_NAME} de ${COMPANY_NAME}.`,
<<<<<<< Updated upstream
    `Somos fábrica e instalación de ventanas y puertas (PVC/Aluminio sin RPT).`,
    `${MINVU_EXPERT_NOTE}`,
    `En termopanel (DVH) ofrecemos Low-E, Control Solar y opciones de seguridad (laminados) según necesidad.`,
=======
    `Somos fábrica e instalación de ventanas y puertas (PVC línea europea/americana y aluminio sin RPT).`,
    `${MINVU_EXPERT_NOTE}`,
    `En termopanel (DVH) ofrecemos básico y upgrades: Low-E, Control Solar y seguridad (laminados) según necesidad.`,
>>>>>>> Stashed changes
    `Pilares: ${PILLARS}.`,
  ].join("\n");

  const rules = [
    `Idioma: ${LANGUAGE}. Tratar al cliente de "${tono}".`,
<<<<<<< Updated upstream
    `Estilo: consultivo, humano, claro. Máximo ${MAX_LINES_PER_REPLY} líneas.`,
    `Objetivo: convertir consulta en cotización/visita técnica.`,
    `No inventes precios exactos sin datos. Si piden precio sin medidas/especificación, pide 1 dato clave.`,
    `No repitas preguntas si ya existen datos en sesión (medidas/comuna/tipo).`,
    `Siempre cerrar con un siguiente paso.`,
    ONE_QUESTION_PER_TURN ? `Haz como máximo 1 pregunta al final.` : `Puedes hacer preguntas necesarias.`,
    `Si el tema NO es ventanas/puertas, redirige educadamente al rubro.`,
  ].filter(Boolean).join("\n");

  const measures = (session?.context?.measuresMm || [])
=======
    `Estilo: consultivo, humano y claro. Máximo ${MAX_LINES_PER_REPLY} líneas.`,
    `Objetivo: convertir consulta en pre-cotización y siguiente paso.`,
    `No inventar precios exactos sin base.`,
    `No repetir preguntas si ya se entregó el dato en sesión (medidas/comuna/tipo/vidrio).`,
    `Cuando el cliente diga "recomiéndame tú / tú decide": propone configuración estándar y haz SOLO 1 pregunta final.`,
    ONE_QUESTION_PER_TURN ? `Máximo 1 pregunta al final.` : `Preguntas necesarias.`,
    `Cierre siempre con un siguiente paso.`,
  ].filter(Boolean).join("\n");

  const measures = ensureArray(session?.context || {}, "measuresMm")
>>>>>>> Stashed changes
    .slice(-6)
    .map((m) => `${m.w}x${m.h}mm (${m.source || "texto"})`)
    .join(", ");

  const sessionHint = [
    `Datos conocidos del cliente (si existen):`,
<<<<<<< Updated upstream
    `- Nombre: ${session?.context?.name || "no informado"}`,
    `- Tipo de proyecto: ${session?.context?.projectType || "no informado"}`,
    `- Ciudad/Comuna: ${session?.context?.city || "no informado"}`,
    measures ? `- Medidas detectadas: ${measures}` : `- Medidas detectadas: ninguna`,
=======
    `- Comuna: ${session?.context?.city || "no informada"}`,
    `- Apertura: ${session?.context?.openingType || "no informada"}`,
    `- Color: ${session?.context?.color || "no informado"}`,
    `- Vidrio: ${session?.context?.glass || "no informado"}`,
    measures ? `- Medidas: ${measures}` : `- Medidas: ninguna`,
>>>>>>> Stashed changes
  ].join("\n");

  return `${offer}\n\n${rules}\n\n${sessionHint}`.trim();
}

<<<<<<< Updated upstream
async function aiDraftReply({ session, userText, extractedMeasures, sizeCheck }) {
  if (!openai) {
    return "Perfecto. Para cotizar, indíqueme comuna y medidas (ancho x alto en mm) + tipo (corredera/abatible/fija). ¿Incluye instalación?";
=======
function wantsRecommendation(text = "") {
  const t = text.toLowerCase();
  return (
    t.includes("recomiendame") ||
    t.includes("recomiéndame") ||
    t.includes("tu decide") ||
    t.includes("tú decide") ||
    t.includes("recomendame") ||
    t.includes("decide tu") ||
    t.includes("decide tú")
  );
}

function simpleInfer(text = "") {
  const t = text.toLowerCase();

  let openingType = null;
  if (t.includes("corredera")) openingType = "corredera";
  if (t.includes("abatible")) openingType = "abatible";
  if (t.includes("fija")) openingType = "fija";
  if (t.includes("proyectante")) openingType = "proyectante";

  let glass = null;
  if (t.includes("low")) glass = "Low-E";
  if (t.includes("control solar")) glass = "Control Solar";
  if (t.includes("termopanel")) glass = "Termopanel";
  if (t.includes("básico") || t.includes("basico")) glass = "Termopanel básico";

  let color = null;
  if (t.includes("nogal")) color = "Nogal";
  if (t.includes("blanco")) color = "Blanco";
  if (t.includes("antracita")) color = "Antracita";

  // comuna básica (solo ejemplo: Temuco/Villarrica/Pucón/Padre Las Casas)
  let city = null;
  const cities = ["temuco", "padre las casas", "villarrica", "pucón", "pucon", "lautaro", "freire"];
  for (const c of cities) {
    if (t.includes(c)) {
      city = c.replace("pucon", "pucón");
      break;
    }
  }

  return { openingType, glass, color, city };
}

function buildRecommendationFallback({ w, h, comuna, prefersBasic = true }) {
  const size = w && h ? `${w}x${h} mm` : "esa medida";
  const loc = comuna ? `en ${comuna}` : "en su comuna";
  const dvh = prefersBasic ? "termopanel básico 4/12/4" : "termopanel Low-E (mejora térmica)";
  return [
    `Perfecto. Para ${size} ${loc}, le recomiendo una ventana corredera en PVC con ${dvh}.`,
    `Si es dormitorio o zona fría/húmeda, Low-E mejora el confort térmico y reduce condensación.`,
    `Si es primer piso, podemos reforzar con vidrio laminado de seguridad en una cara.`,
    `¿La instalación es recambio (retirar marco antiguo) u obra nueva?`,
  ].join("\n");
}

async function aiDraftReply({ session, userText, extractedMeasures, sizeCheck }) {
  // Regla dura: si el cliente pide recomendación, resolvemos sin “interrogar”
  if (wantsRecommendation(userText)) {
    const m = extractedMeasures?.[0] || session?.context?.measuresMm?.slice(-1)?.[0] || null;
    const w = m?.w || null;
    const h = m?.h || null;

    const prefersBasic =
      (userText || "").toLowerCase().includes("basico") || (userText || "").toLowerCase().includes("básico");

    const comuna = session?.context?.city || null;

    return buildRecommendationFallback({ w, h, comuna, prefersBasic });
  }

  if (!openai) {
    return "Perfecto. Para cotizar, indíqueme comuna, tipo (corredera/abatible/fija) y medidas (ancho x alto en mm). ¿Incluye instalación?";
>>>>>>> Stashed changes
  }

  const system = buildSystemPrompt(session);

  const measuresLine = extractedMeasures?.length
    ? `Medidas detectadas (mm): ${extractedMeasures.map((m) => `${m.w}x${m.h}`).join(", ")}.`
    : `No se detectaron medidas claras.`;

  const sizeLine = sizeCheck
    ? `Advertencia: posible fuera de rango para sistema ${sizeCheck.system}: ${sizeCheck.issue}.`
    : "";

  const user = [
    `Mensaje del cliente:`,
    userText || "(vacío)",
    "",
    measuresLine,
    sizeLine,
    "",
    `Tarea: Responde con asesoría práctica para cotización. Pide SOLO el dato más importante faltante (1 pregunta).`,
  ].join("\n");

  const messages = [
    { role: "system", content: system },
<<<<<<< Updated upstream
    ...session.history.slice(-10).map((h) => ({ role: h.role, content: h.content })),
=======
    ...ensureArray(session, "history").slice(-10).map((h) => ({ role: h.role, content: h.content })),
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
// PDF + Image understanding
=======
// PDF + Image understanding (incoming)
>>>>>>> Stashed changes
// =====================
async function parsePdfText(buffer) {
  try {
    const data = await pdfParse(buffer);
    return (data.text || "").slice(0, 12000);
  } catch (e) {
    console.error("PDF parse error:", e?.message || e);
    return "";
  }
}

async function visionExtract(buffer, mimeType, purpose = "imagen") {
  if (!openai) return "";
  try {
    const b64 = buffer.toString("base64");
    const r = await openai.chat.completions.create({
      model: AI_MODEL_VISION,
      messages: [
        {
          role: "system",
          content:
            "Eres un extractor para cotización de ventanas/puertas. Devuelve SOLO: (1) medidas (ancho x alto) + unidad, (2) tipo (corredera/proyectante/fija/abatible/puerta), (3) notas. Si no hay medidas, 'sin medidas legibles'.",
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
<<<<<<< Updated upstream
      max_tokens: 250,
=======
      max_tokens: 260,
>>>>>>> Stashed changes
    });

    return r.choices?.[0]?.message?.content?.trim() || "";
  } catch (e) {
    console.error("Vision error:", e?.message || e);
    return "";
  }
}

// =====================
// Reply scheduler (anti-doble mensaje)
// =====================
async function scheduleReply(waId, messageId, collectedText, { isMedia = false } = {}) {
  const session = getSession(waId);
  normalizeSession(session, waId);

<<<<<<< Updated upstream
  session.lastSeenAt = Date.now();

  // Espera “humana” para agrupar mensajes
=======
  // inferencias suaves (no obligatorias)
  const inferred = simpleInfer(collectedText || "");
  if (inferred.city && !session.context.city) session.context.city = inferred.city;
  if (inferred.openingType && !session.context.openingType) session.context.openingType = inferred.openingType;
  if (inferred.glass && !session.context.glass) session.context.glass = inferred.glass;
  if (inferred.color && !session.context.color) session.context.color = inferred.color;

  session.lastSeenAt = Date.now();

  // Espera humana para agrupar mensajes
>>>>>>> Stashed changes
  await sleep(WAIT_AFTER_LAST_USER_MESSAGE_MS);

  // Si llegó otro mensaje después, no respondemos este
  if (Date.now() - session.lastSeenAt < WAIT_AFTER_LAST_USER_MESSAGE_MS - 100) return;
  if (!loopGuardOk(session)) return;

  const tMin = TYPING_MIN_MS;
  const tMax = Math.max(TYPING_MAX_MS, tMin + 50);
  const typingDelay = Math.floor(tMin + Math.random() * (tMax - tMin));

  const stopTyping = startTypingPinger(messageId, "text");

  try {
    if (isMedia) await sleep(EXTRA_DELAY_MEDIA_MS);
    await sleep(typingDelay);

    const measures = extractMeasurements(collectedText);

    if (measures.length) {
<<<<<<< Updated upstream
      for (const m of measures) session.context.measuresMm.push({ w: m.w, h: m.h, source: isMedia ? "media" : "texto" });
      if (session.context.measuresMm.length > MEASURES_MAX_ITEMS) {
        session.context.measuresMm = session.context.measuresMm.slice(-MEASURES_MAX_ITEMS);
      }
    }

    const m0 = measures[0];
    const sizeCheck = m0 ? checkSizeAgainstLimits(m0.w, m0.h) : null;
=======
      const mm = ensureArray(session.context, "measuresMm");
      for (const m of measures) mm.push({ w: m.w, h: m.h, source: isMedia ? "media" : "texto" });
      if (mm.length > MEASURES_MAX_ITEMS) session.context.measuresMm = mm.slice(-MEASURES_MAX_ITEMS);
    }

    const lastM = measures[0] || session?.context?.measuresMm?.slice(-1)?.[0] || null;
    const sizeCheck = lastM ? checkSizeAgainstLimits(lastM.w, lastM.h) : null;

    // Si piden PDF explícitamente, generamos y enviamos
    if (wantsPdf(collectedText)) {
      const items = ensureArray(session.context, "measuresMm").slice(-6);
      if (!items.length) {
        await waSendText(
          waId,
          "Para generar el PDF necesito al menos una medida (ancho x alto en mm).",
          { replyToMessageId: messageId }
        );
        noteReply(session);
        return;
      }

      const pdfBuffer = await generatePDF(waId, items, {
        city: session.context.city,
        color: session.context.color,
        openingType: session.context.openingType,
        glass: session.context.glass || "Termopanel básico",
        installType: session.context.installType,
      });

      const mediaId = await waUploadMedia(pdfBuffer, DEFAULT_PDF_FILENAME, "application/pdf");
      await waSendDocument(
        waId,
        mediaId,
        DEFAULT_PDF_FILENAME,
        "Adjunto cotización referencial en PDF. Si desea, coordinamos visita técnica para confirmar instalación y detalles."
      );

      noteReply(session);
      return;
    }
>>>>>>> Stashed changes

    let reply = await aiDraftReply({
      session,
      userText: collectedText,
      extractedMeasures: measures,
      sizeCheck,
    });

    if (!reply) {
      reply =
<<<<<<< Updated upstream
        "Gracias por su mensaje. Para asesorarle bien, indíqueme comuna y medidas (ancho x alto en mm) + tipo (corredera, proyectante, fija o puerta).";
=======
        "Gracias por su mensaje. Para cotizar, indíqueme comuna y medidas (ancho x alto en mm) + tipo (corredera, abatible o fija).";
>>>>>>> Stashed changes
    }

    // Recorte de líneas y largo total
    const lines = reply
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, MAX_LINES_PER_REPLY);

    reply = lines.join("\n");
    if (reply.length > MAX_WA_CHARS) reply = reply.slice(0, MAX_WA_CHARS - 10) + "…";

    await waSendText(waId, reply, { replyToMessageId: messageId });

<<<<<<< Updated upstream
    // Guardar historial (cap)
    session.history.push({ role: "user", content: collectedText || "" });
    session.history.push({ role: "assistant", content: reply });
    if (session.history.length > HISTORY_MAX_ITEMS) session.history = session.history.slice(-HISTORY_MAX_ITEMS);
=======
    // Historial (cap)
    const h = ensureArray(session, "history");
    h.push({ role: "user", content: collectedText || "" });
    h.push({ role: "assistant", content: reply });
    if (h.length > HISTORY_MAX_ITEMS) session.history = h.slice(-HISTORY_MAX_ITEMS);
>>>>>>> Stashed changes

    noteReply(session);
  } catch (e) {
    console.error("AI/send error:", e?.response?.data || e?.message || e);
  } finally {
    stopTyping();
  }
}

// =====================
// POST /webhook  (ACK inmediato + procesamiento async)
// =====================
app.post("/webhook", (req, res) => {
<<<<<<< Updated upstream
  // 1) ACK inmediato a Meta (evita reintentos / duplicados)
=======
  // 1) ACK inmediato a Meta
>>>>>>> Stashed changes
  res.sendStatus(200);

  // 2) Procesar asíncrono
  setImmediate(async () => {
    try {
      const body = req.body;

      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      const messages = value?.messages || [];
      if (!messages.length) return;

      const msg = messages[0];
      const waId = msg.from;
      const messageId = msg.id;

      if (isProcessed(messageId)) return;
      markProcessed(messageId);

      const session = getSession(waId);
      normalizeSession(session, waId);

      // Reset de sesión
      const incomingText = msg.type === "text" ? (msg.text?.body || "").trim().toLowerCase() : "";
      if (["reset", "reiniciar", "nuevo", "start", "comenzar"].includes(incomingText)) {
        sessions.delete(waId);
        await waSendText(
          waId,
<<<<<<< Updated upstream
          "Listo. Reinicié su sesión. Envíeme su solicitud: tipo de ventana/puerta + medidas (mm) + comuna.",
=======
          "Listo. Reinicié su sesión. Envíeme su solicitud: tipo de ventana/puerta + medidas (mm) + comuna. Si quiere PDF, escriba “PDF”.",
>>>>>>> Stashed changes
          { replyToMessageId: messageId }
        );
        return;
      }

<<<<<<< Updated upstream
      // Ack corto para media
=======
>>>>>>> Stashed changes
      const sendAck = async (text) => {
        try {
          await waSendText(waId, text, { replyToMessageId: messageId });
        } catch {}
      };

<<<<<<< Updated upstream
      // Texto
=======
      // ===========
      // TEXT
      // ===========
>>>>>>> Stashed changes
      if (msg.type === "text") {
        await scheduleReply(waId, messageId, msg.text?.body || "");
        return;
      }

<<<<<<< Updated upstream
      // Imagen
      if (msg.type === "image") {
        const mediaId = msg.image?.id;
        const mime = msg.image?.mime_type || "image/jpeg";
        console.log("INCOMING IMAGE:", { mime, mediaId });

        await sendAck("Recibido. Déjeme revisar la imagen para identificar medidas y tipo de ventana.");

        const url = await waGetMediaUrl(mediaId);
        const bytes = await waDownloadMediaBytes(url);
        const visionText = await visionExtract(bytes, mime, "imagen");

        const combined = `Imagen recibida.\n${visionText || ""}`.trim();
        await scheduleReply(waId, messageId, combined, { isMedia: true });
        return;
      }

      // Documento (PDF)
      if (msg.type === "document") {
        const mime = msg.document?.mime_type || "";
        const filename = msg.document?.filename || "archivo";
        const mediaId = msg.document?.id;

        console.log("INCOMING DOCUMENT:", { mime, filename, mediaId });

=======
      // ===========
      // AUDIO (Whisper)
      // ===========
      if (msg.type === "audio") {
        const mediaId = msg.audio?.id;
        const mime = msg.audio?.mime_type || "audio/ogg";
        console.log("INCOMING AUDIO:", { mime, mediaId });

        await sendAck("Recibido. Estoy transcribiendo su audio para ayudarle con la cotización.");

        const url = await waGetMediaUrl(mediaId);
        const bytes = await waDownloadMediaBytes(url);

        const text = await transcribeVoice(bytes);
        const combined = `Audio transcrito:\n${text || "(no se pudo transcribir)"}`.trim();

        await scheduleReply(waId, messageId, combined, { isMedia: true });
        return;
      }

      // ===========
      // IMAGE (Vision)
      // ===========
      if (msg.type === "image") {
        const mediaId = msg.image?.id;
        const mime = msg.image?.mime_type || "image/jpeg";
        console.log("INCOMING IMAGE:", { mime, mediaId });

        await sendAck("Recibido. Déjeme revisar la imagen para identificar medidas y tipo de ventana.");

        const url = await waGetMediaUrl(mediaId);
        const bytes = await waDownloadMediaBytes(url);
        const visionText = await visionExtract(bytes, mime, "imagen");

        const combined = `Imagen recibida.\n${visionText || ""}`.trim();
        await scheduleReply(waId, messageId, combined, { isMedia: true });
        return;
      }

      // ===========
      // DOCUMENT (PDF read)
      // ===========
      if (msg.type === "document") {
        const mime = msg.document?.mime_type || "";
        const filename = msg.document?.filename || "archivo";
        const mediaId = msg.document?.id;

        console.log("INCOMING DOCUMENT:", { mime, filename, mediaId });

>>>>>>> Stashed changes
        await sendAck(`Recibido "${filename}". Déjeme revisarlo para identificar medidas y especificación.`);

        const url = await waGetMediaUrl(mediaId);
        const bytes = await waDownloadMediaBytes(url);

        let parsedText = "";
        if (mime.includes("pdf")) parsedText = await parsePdfText(bytes);

        const measures = extractMeasurements(parsedText);
        if (measures.length) {
<<<<<<< Updated upstream
          for (const m of measures) session.context.measuresMm.push({ w: m.w, h: m.h, source: "pdf" });
          if (session.context.measuresMm.length > MEASURES_MAX_ITEMS) {
            session.context.measuresMm = session.context.measuresMm.slice(-MEASURES_MAX_ITEMS);
          }
=======
          const mm = ensureArray(session.context, "measuresMm");
          for (const m of measures) mm.push({ w: m.w, h: m.h, source: "pdf" });
          if (mm.length > MEASURES_MAX_ITEMS) session.context.measuresMm = mm.slice(-MEASURES_MAX_ITEMS);
>>>>>>> Stashed changes
        }

        const combined = [
          `Documento recibido: ${filename} (${mime || "documento"}).`,
          parsedText ? `Texto extraído (resumen):\n${parsedText.slice(0, 2000)}` : "",
          measures.length ? `Medidas detectadas (mm): ${measures.map((m) => `${m.w}x${m.h}`).join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        await scheduleReply(waId, messageId, combined, { isMedia: true });
        return;
      }

<<<<<<< Updated upstream
      // Otros tipos
      await waSendText(
        waId,
        "Recibido. Por ahora puedo ayudar mejor con texto, imágenes o PDFs. ¿Qué necesita cotizar (tipo y medidas)?",
=======
      // ===========
      // OTHER
      // ===========
      await waSendText(
        waId,
        "Recibido. Por ahora puedo ayudar mejor con texto, audios, imágenes o PDFs. ¿Qué necesita cotizar (tipo y medidas)?",
>>>>>>> Stashed changes
        { replyToMessageId: messageId }
      );
    } catch (e) {
      console.error("Webhook async error:", e?.message || e);
    }
  });
});

app.listen(PORT, () => {
  console.log("Listening...");
<<<<<<< Updated upstream
});
=======
});
>>>>>>> Stashed changes
