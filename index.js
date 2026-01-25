// index.js - WhatsApp IA Hub (Activa Inversiones) - Ventanas/Puertas
// Node ESM ("type":"module")
// Features:
// - Meta WhatsApp Cloud API Webhook (GET verify + POST messages)
// - Session memory + loop guard + dedupe
// - Smart slot-filling for window quotes (comuna/sector, medidas, apertura, sistema, color, vidrio, instalación)
// - Value-selling messaging (Thermoflex warm-edge, condensación, confort)
// - Typing indicator keepalive (Meta typing_indicator)
// - Media: image vision extraction + PDF text extraction
// - OPTIONAL: PDF quote generation (pdfkit) + send as WhatsApp document
// - OPTIONAL: Voice notes transcription (Whisper) for audio messages (requires form-data)
// ------------------------------------------------------------

import express from "express";
import axios from "axios";
import OpenAI from "openai";
import pdfParse from "pdf-parse";
import PDFDocument from "pdfkit";
import { Readable } from "stream";
import FormData from "form-data";

const app = express();
app.use(express.json({ limit: "12mb" }));

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
const AI_TEMPERATURE = Number(env("AI_TEMPERATURE", "0.25"));
const AI_MAX_OUTPUT_TOKENS = envInt("AI_MAX_OUTPUT_TOKENS", 450);

// =====================
// Brand / style
// =====================
const COMPANY_NAME = env("COMPANY_NAME", "Activa");
const AGENT_NAME = env("AGENT_NAME", "Marcelo Cifuentes");
const LANGUAGE = env("LANGUAGE", "es-CL");
const TONO = env("TONO", "usted"); // "usted" | "tu"

// Value proposition
const VALUE_PITCH = env(
  "VALUE_PITCH",
  "Nos diferenciamos por calidad y confort: hermeticidad, herrajes, y termopanel de alto desempeño. Usamos separador warm-edge Thermoflex (tecnología inglesa), que reduce significativamente la condensación frente al separador de aluminio tradicional."
);

// Offer pillars
const PILLARS = env("PILLARS", "térmico, acústico, seguridad, eficiencia energética");

// =====================
// Humanization / pacing
// =====================
const WAIT_AFTER_LAST_USER_MESSAGE_MS = envInt("WAIT_AFTER_LAST_USER_MESSAGE_MS", 1400);
const EXTRA_DELAY_MEDIA_MS = envInt("EXTRA_DELAY_MEDIA_MS", 1600);
const TYPING_SIMULATION = envBool("TYPING_SIMULATION", true);
const TYPING_MIN_MS = envInt("TYPING_MIN_MS", 650);
const TYPING_MAX_MS = envInt("TYPING_MAX_MS", 1400);
const MAX_LINES_PER_REPLY = envInt("MAX_LINES_PER_REPLY", 7);
const ONE_QUESTION_PER_TURN = envBool("ONE_QUESTION_PER_TURN", true);

// Loop guard
const LOOP_GUARD_MAX_REPLIES_PER_5MIN = envInt("LOOP_GUARD_MAX_REPLIES_PER_5MIN", 7);

// Reply context
const REPLY_WITH_CONTEXT = envBool("REPLY_WITH_CONTEXT", true);

// PDF / voice features toggles
const ENABLE_PDF_QUOTES = envBool("ENABLE_PDF_QUOTES", true);
const ENABLE_VOICE_TRANSCRIBE = envBool("ENABLE_VOICE_TRANSCRIBE", true);

// =====================
// Optional size limits (JSON)
// Example:
// {
//   "PVC_EURO": { "min": {"w":400,"h":400}, "max":{"w":2400,"h":2400} },
//   "PVC_US":   { "min": {"w":800,"h":900}, "max":{"w":3600,"h":2400} }
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
// Sanity logs
// =====================
console.log("Starting Container");
console.log(`Server running on port ${PORT}`);
console.log(`ENV META_GRAPH_VERSION: ${META_GRAPH_VERSION}`);
console.log(`ENV WHATSAPP_TOKEN: ${WHATSAPP_TOKEN ? "OK" : "MISSING"}`);
console.log(`ENV VERIFY_TOKEN: ${VERIFY_TOKEN ? "OK" : "MISSING"}`);
console.log(`ENV PHONE_NUMBER_ID: ${PHONE_NUMBER_ID ? "OK" : "MISSING"}`);
console.log(`ENV OPENAI_API_KEY: ${OPENAI_API_KEY ? "OK" : "MISSING"}`);
console.log(`ENV AI_MODEL_OPENAI: ${AI_MODEL_OPENAI}`);
console.log(`ENV AI_MODEL_VISION: ${AI_MODEL_VISION}`);
console.log(`TYPING_SIMULATION: ${TYPING_SIMULATION}`);
console.log(`ENABLE_PDF_QUOTES: ${ENABLE_PDF_QUOTES}`);
console.log(`ENABLE_VOICE_TRANSCRIBE: ${ENABLE_VOICE_TRANSCRIBE}`);

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

  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// =====================
// Session store + dedupe
// =====================
const sessions = new Map(); // key: waId
const processedMsgIds = new Set();
const maxProcessed = 2500;

function ensureArray(x) {
  return Array.isArray(x) ? x : [];
}

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
        introSent: false,

        // customer slots
        name: null,
        city: null, // comuna/sector
        measuresMm: [], // [{w,h,source}]
        qty: null,
        openingType: null, // corredera/abatible/proyectante/fija/puerta
        system: null, // pvc_europeo/pvc_americano/aluminio
        color: null,
        glass: null, // basico/low-e/control solar/seguridad
        installType: null, // con instalacion / solo fabricacion / recambio / obra nueva
        colorConflict: false,
      },
    });
  }

  // Normalize any older session shapes
  const s = sessions.get(waId);
  s.context = s.context || {};
  s.context.measuresMm = ensureArray(s.context.measuresMm);
  s.history = ensureArray(s.history);
  s.repliesIn5Min = ensureArray(s.repliesIn5Min);
  return s;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// =====================
// WhatsApp API helpers
// =====================
const WA_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}/${PHONE_NUMBER_ID}`;

async function waSendText(to, text, { replyToMessageId = null } = {}) {
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body: text } };
  if (replyToMessageId && REPLY_WITH_CONTEXT) payload.context = { message_id: replyToMessageId };

  return axios.post(`${WA_BASE}/messages`, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    timeout: 15000,
  });
}

async function waSendDocument(to, fileBuffer, filename = "cotizacion.pdf", caption = "", { replyToMessageId = null } = {}) {
  // WhatsApp Cloud API requires uploaded media id, not direct bytes.
  // We'll upload to /media first, then send document with that id.
  const mediaId = await waUploadMedia(fileBuffer, "application/pdf", filename);
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: {
      id: mediaId,
      filename,
      caption: caption || undefined,
    },
  };
  if (replyToMessageId && REPLY_WITH_CONTEXT) payload.context = { message_id: replyToMessageId };

  return axios.post(`${WA_BASE}/messages`, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    timeout: 15000,
  });
}

async function waUploadMedia(buffer, mimeType, filename) {
  // POST /{phone-number-id}/media
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buffer, { filename, contentType: mimeType });

  const r = await axios.post(`${WA_BASE}/media`, form, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      ...form.getHeaders(),
    },
    maxBodyLength: Infinity,
    timeout: 30000,
  });

  return r.data?.id;
}

/**
 * Typing Indicators (correct method):
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
    timeout: 15000,
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

// =====================
// Media download (Cloud API)
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

// =====================
// Slot extraction helpers (basic Spanish)
// =====================
function norm(s) {
  return (s || "").toString().trim().toLowerCase();
}

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

  // "1200x1500" / "1200 × 1500" unit optional
  const reX = /(\d{2,4}(\.\d{1,3})?)\s*[x×]\s*(\d{2,4}(\.\d{1,3})?)\s*(mm|cm|m)?/g;
  let m;
  while ((m = reX.exec(clean))) {
    const a = m[1];
    const b = m[3];
    const unit = m[5] || "mm";
    const w = toMm(a, unit);
    const h = toMm(b, unit);
    if (w && h) out.push({ w, h, unit: "mm", confidence: 0.8, raw: m[0] });
  }

  // "ancho 1200 alto 1500"
  const reAH = /(ancho|largo)\s*(\d{2,4}(\.\d{1,3})?)\s*(mm|cm|m)?[\s,;]+(alto|altura)\s*(\d{2,4}(\.\d{1,3})?)\s*(mm|cm|m)?/g;
  while ((m = reAH.exec(clean))) {
    const unit1 = m[4] || "mm";
    const unit2 = m[8] || unit1;
    const w = toMm(m[2], unit1);
    const h = toMm(m[6], unit2);
    if (w && h) out.push({ w, h, unit: "mm", confidence: 0.75, raw: m[0] });
  }

  return out;
}

function detectQty(text) {
  const t = norm(text);
  const m = t.match(/\b(\d{1,2})\s*(unid|unidad|unidades|ventanas|puertas)\b/);
  if (m) return parseInt(m[1], 10);
  if (t.includes("son 2")) return 2;
  return null;
}

function detectOpeningType(text) {
  const t = norm(text);
  if (t.includes("corredera") || t.includes("corrediza")) return "corredera";
  if (t.includes("abatible")) return "abatible";
  if (t.includes("proyectante") || t.includes("proyección") || t.includes("proyect")) return "proyectante";
  if (t.includes("fija")) return "fija";
  if (t.includes("oscilobatiente") || t.includes("oscilo")) return "oscilobatiente";
  if (t.includes("puerta")) return "puerta";
  return null;
}

const SYSTEMS = {
  PVC_EURO: "pvc_europeo",
  PVC_US: "pvc_americano",
  ALUMINIO: "aluminio",
};

const COLOR_CATALOG = {
  [SYSTEMS.PVC_EURO]: ["blanco", "roble dorado", "nogal", "grafito", "negro"],
  [SYSTEMS.PVC_US]: ["blanco"],
};

function detectSystem(text) {
  const t = norm(text);
  if (!t) return null;
  if (t.includes("europe") || t.includes("línea europea") || t.includes("linea europea") || t.includes("pvc europeo"))
    return SYSTEMS.PVC_EURO;
  if (t.includes("american") || t.includes("línea americana") || t.includes("linea americana") || t.includes("pvc americano"))
    return SYSTEMS.PVC_US;
  if (t.includes("aluminio")) return SYSTEMS.ALUMINIO;
  return null;
}

function detectColor(text) {
  const t = norm(text);
  if (!t) return null;

  if (t.includes("roble dorado")) return "roble dorado";
  if (t.includes("nogal")) return "nogal";
  if (t.includes("grafito")) return "grafito";
  if (t.includes("negro")) return "negro";
  if (t.includes("blanco")) return "blanco";

  return null;
}

function detectGlass(text) {
  const t = norm(text);
  if (!t) return null;

  // Clients often say "termopanel" = dvh basic
  if (t.includes("termopanel") || t.includes("dvh")) return "termopanel_basico";
  if (t.includes("low") && t.includes("e")) return "low-e";
  if (t.includes("control solar") || t.includes("solar")) return "control_solar";
  if (t.includes("laminado") || t.includes("seguridad") || t.includes("blindex")) return "seguridad_laminado";
  if (t.includes("normal") || t.includes("simple")) return "vidrio_simple";
  return null;
}

function detectInstallType(text) {
  const t = norm(text);
  if (!t) return null;

  if (t.includes("con instalación") || t.includes("con instalacion") || t.includes("instalación") || t.includes("instalacion"))
    return "con_instalacion";
  if (t.includes("solo fabricación") || t.includes("solo fabricacion") || t.includes("solo marco") || t.includes("solo ventan"))
    return "solo_fabricacion";
  if (t.includes("recambio") || t.includes("reemplazo")) return "recambio";
  if (t.includes("obra nueva") || t.includes("nuevo")) return "obra_nueva";
  return null;
}

function looksLikeCity(text) {
  // Very light heuristic: if message is short single token or known comuna patterns
  const t = (text || "").trim();
  if (!t) return false;
  if (t.length > 28) return false;
  if (/\d/.test(t)) return false;
  if (t.split(/\s+/).length <= 4) return true;
  return false;
}

function colorAllowed(system, color) {
  if (!system || !color) return true;
  if (!COLOR_CATALOG[system]) return true;
  return COLOR_CATALOG[system].includes(color);
}

function suggestedColorQuestion(system) {
  if (system === SYSTEMS.PVC_US) {
    return "¿Le sirve color blanco? (en PVC americano el color es solo blanco)";
  }
  if (system === SYSTEMS.PVC_EURO) {
    return "¿Qué color prefiere: blanco, nogal, roble dorado, grafito o negro?";
  }
  // system not chosen yet: offer quick choice + rule
  return "¿Qué color prefiere: blanco (estándar) o nogal (premium)? Nota: nogal/grafito/negro/roble dorado aplican en PVC europeo; en PVC americano es solo blanco.";
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

function nextMissingQuestion(session) {
  const c = session.context || {};
  if (!c.city) return "¿En qué comuna o sector se instalará?";
  if (!c.measuresMm || c.measuresMm.length === 0) return "¿Me indica las medidas en mm (ancho x alto) de cada ventana/puerta?";
  if (!c.openingType) return "¿Qué tipo de apertura necesita: corredera, abatible, proyectante, fija o puerta?";
  if (!c.color) return suggestedColorQuestion(c.system || null);
  if (!c.installType) return "¿Lo necesita con instalación o solo fabricación?";
  return null;
}

function shouldOfferPDF(session) {
  const c = session.context || {};
  return !!(c.city && (c.measuresMm?.length || 0) > 0 && c.openingType && c.color && c.installType);
}

// =====================
// Prompt builder
// =====================
function buildSystemPrompt(session) {
  const tono = TONO === "tu" ? "tú" : "usted";
  const c = session?.context || {};

  const measures = ensureArray(c.measuresMm)
    .slice(-6)
    .map((m) => `${m.w}x${m.h}mm (${m.source || "texto"})`)
    .join(", ");

  const rules = [
    `Idioma: ${LANGUAGE}. Tratar al cliente de "${tono}".`,
    `Rol: eres ${AGENT_NAME} de ${COMPANY_NAME} (fábrica e instalación de ventanas y puertas).`,
    `Vender por VALOR, no por precio: confort térmico, hermeticidad, menos condensación, durabilidad, buena instalación.`,
    `Si el cliente dice "termopanel": explicar en 1 línea que termopanel es el vidrio doble; el marco puede ser PVC o aluminio.`,
    `Diferenciador: "separador warm-edge Thermoflex (tecnología inglesa) que reduce significativamente la condensación vs separador de aluminio tradicional".`,
    `No uses más de 1 "gracias" en toda la conversación (ideal: 0).`,
    `Máximo ${MAX_LINES_PER_REPLY} líneas. Sin párrafos largos.`,
    ONE_QUESTION_PER_TURN ? `Haz como máximo 1 pregunta al final (solo si falta un dato).` : `Puedes hacer preguntas necesarias.`,
    `No repitas datos ya conocidos en sesión.`,
    `Colores disponibles: PVC europeo = blanco, roble dorado, nogal, grafito, negro. PVC americano = solo blanco.`,
    `No inventes colores fuera de catálogo. Si el cliente pide un color no compatible con PVC americano, propone PVC europeo.`,
    `Si el cliente dice "recomiéndame", recomienda una configuración acorde al sur de Chile (Araucanía): PVC + termopanel + warm-edge.`,
    `Si ya tienes comuna + medidas + apertura + color + instalación, cierra ofreciendo PDF.`,
  ].join("\n");

  const known = [
    `Datos conocidos:`,
    `- Comuna/sector: ${c.city || "no informado"}`,
    `- Apertura: ${c.openingType || "no informado"}`,
    `- Sistema: ${c.system || "no informado"}`,
    `- Color: ${c.color || "no informado"}`,
    `- Vidrio: ${c.glass || "no informado"}`,
    `- Instalación: ${c.installType || "no informado"}`,
    `- Medidas: ${measures || "ninguna"}`,
  ].join("\n");

  return `${rules}\n\n${known}`.trim();
}

// =====================
// AI: Draft + Refine
// =====================
async function aiDraftReply({ session, userText, sizeCheck, nextQuestion }) {
  if (!openai) return null;

  const system = buildSystemPrompt(session);
  const c = session.context || {};

  // short factual summary for the model
  const summary = [
    `Mensaje del cliente: ${userText || "(vacío)"}`,
    sizeCheck ? `Advertencia tamaño: ${sizeCheck.system} ${sizeCheck.issue}` : "",
    c.colorConflict ? `Color conflict: Cliente pidió "${c.color}", pero PVC americano solo permite blanco.` : "",
    `Pregunta faltante sugerida: ${nextQuestion || "NINGUNA (cerrar con PDF)"}`,
    "",
    `Tarea: Responde como vendedor consultivo por VALOR. Confirma lo entendido en 1–2 líneas.`,
    `Si hay conflicto color/sistema, acláralo simple (sin discutir).`,
    `Si falta dato, termina con SOLO 1 pregunta (la sugerida).`,
    `Si ya está todo, ofrece enviar PDF y confirma plazo referencial.`,
  ]
    .filter(Boolean)
    .join("\n");

  const messages = [
    { role: "system", content: system },
    ...session.history.slice(-8).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: summary },
  ];

  const r = await openai.chat.completions.create({
    model: AI_MODEL_OPENAI,
    messages,
    temperature: AI_TEMPERATURE,
    max_tokens: AI_MAX_OUTPUT_TOKENS,
  });

  return r.choices?.[0]?.message?.content?.trim() || null;
}

async function aiRefineReply({ session, draftText, userText }) {
  if (!openai) return draftText;

  const tono = TONO === "tu" ? "tú" : "usted";
  const c = session?.context || {};
  const measures = ensureArray(c.measuresMm).slice(-6).map((m) => `${m.w}x${m.h}mm`).join(", ") || "N/I";

  const system = `
Eres ${AGENT_NAME} de ${COMPANY_NAME}, fábrica e instalación de ventanas y puertas.
Objetivo: respuesta humana, directa, consultiva y vendedora por VALOR (confort, menos condensación, hermeticidad, durabilidad).

REGLAS:
- Idioma ${LANGUAGE}. Tratar al cliente de "${tono}".
- Si session.context.introSent es false, incluye una presentación corta 1 vez. Si es true, NO te presentes.
- No uses más de 1 "gracias" (ideal: 0).
- Máximo ${MAX_LINES_PER_REPLY} líneas.
- Máximo 1 pregunta al final (solo si falta un dato).
- No repitas datos ya conocidos.
- Colores: PVC europeo = blanco, roble dorado, nogal, grafito, negro. PVC americano = solo blanco.
- Diferenciador: "warm-edge Thermoflex (tecnología inglesa) reduce significativamente la condensación vs separador de aluminio tradicional".
- Si el cliente dice "termopanel", explica en 1 línea: termopanel es vidrio doble; marco PVC o aluminio.

Datos sesión: comuna=${c.city || "N/I"}, apertura=${c.openingType || "N/I"}, sistema=${c.system || "N/I"}, color=${c.color || "N/I"}, vidrio=${c.glass || "N/I"}, instalación=${c.installType || "N/I"}, medidas=${measures}.
  `.trim();

  const user = `
Mensaje del cliente:
${userText || "(vacío)"}

Borrador:
${draftText}

Tarea: reescribe el borrador para que suene más natural y vendedor por valor, respetando reglas.
  `.trim();

  const r = await openai.chat.completions.create({
    model: AI_MODEL_OPENAI,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    max_tokens: Math.min(AI_MAX_OUTPUT_TOKENS, 380),
  });

  return r.choices?.[0]?.message?.content?.trim() || draftText;
}

// =====================
// PDF module (quote)
// =====================
async function generatePDF(waId, session) {
  const c = session?.context || {};
  const measures = ensureArray(c.measuresMm).slice(-20);

  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    doc.fontSize(18).text(`${COMPANY_NAME} - Pre-Cotización`, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Asesor: ${AGENT_NAME}`);
    doc.text(`Cliente (WhatsApp): ${waId}`);
    doc.text(`Comuna/Sector: ${c.city || "N/I"}`);
    doc.text(`Tipo apertura: ${c.openingType || "N/I"}`);
    doc.text(`Sistema: ${c.system || "N/I"}`);
    doc.text(`Color: ${c.color || "N/I"}`);
    doc.text(`Vidrio: ${c.glass || "N/I"}`);
    doc.text(`Instalación: ${c.installType || "N/I"}`);
    doc.moveDown();

    doc.fontSize(12).text("Medidas (ancho x alto):", { underline: true });
    doc.moveDown(0.3);

    measures.forEach((m, i) => {
      doc.fontSize(11).text(`${i + 1}. ${m.w} x ${m.h} mm (${m.source || "texto"})`);
    });

    doc.moveDown();
    doc.fontSize(11).text("Nota:", { underline: true });
    doc
      .fontSize(10)
      .text(
        "Esta es una pre-cotización referencial. El valor final depende de verificación en terreno, tipo de refuerzo, configuración exacta del termopanel, herrajes y condiciones de instalación."
      );

    doc.moveDown();
    doc.fontSize(10).text("Diferenciador de calidad:");
    doc.fontSize(10).text(VALUE_PITCH);

    doc.end();
  });
}

// =====================
// Voice transcription (Whisper-1)
// =====================
async function transcribeVoice(buffer) {
  if (!openai) return "";
  // Use OpenAI file helper
  const file = await OpenAI.toFile(Readable.from(buffer), "voice.ogg");
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
  });
  return transcription.text || "";
}

// =====================
// PDF + Image understanding
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
      temperature: 0.1,
      max_tokens: 260,
    });

    return r.choices?.[0]?.message?.content?.trim() || "";
  } catch (e) {
    console.error("Vision error:", e?.message || e);
    return "";
  }
}

// =====================
// Intro message (once per session)
// =====================
function introMessage() {
  return [
    `Hola, soy ${AGENT_NAME} de ${COMPANY_NAME} (fábrica e instalación de ventanas y puertas).`,
    `Para cotizar rápido envíeme: comuna/sector + medidas (ancho x alto en mm) + tipo (corredera/abatible/proyectante/fija/puerta) + color + si incluye instalación.`,
  ].join("\n");
}

// =====================
// Reply scheduler
// =====================
async function scheduleReply(waId, messageId, collectedText, { isMedia = false } = {}) {
  const session = getSession(waId);
  session.lastSeenAt = Date.now();

  // Delay to batch multi-messages
  await sleep(WAIT_AFTER_LAST_USER_MESSAGE_MS);
  if (Date.now() - session.lastSeenAt < WAIT_AFTER_LAST_USER_MESSAGE_MS - 80) return;
  if (!loopGuardOk(session)) return;

  // Typing simulation
  const tMin = TYPING_MIN_MS;
  const tMax = Math.max(TYPING_MAX_MS, tMin + 50);
  const typingDelay = Math.floor(tMin + Math.random() * (tMax - tMin));
  const stopTyping = startTypingPinger(messageId, "text");

  if (isMedia) await sleep(EXTRA_DELAY_MEDIA_MS);
  await sleep(typingDelay);

  // ---------------------
  // Update slots from text
  // ---------------------
  const text = (collectedText || "").trim();

  // name heuristic (if user says "soy X")
  const tnorm = norm(text);
  if (!session.context.name) {
    const mName = tnorm.match(/\b(soy|me llamo)\s+([a-záéíóúñ]+\s+[a-záéíóúñ]+)/i);
    if (mName?.[2]) session.context.name = mName[2].trim();
  }

  // city heuristic: if message is single token like "Temuco", "Pucón"
  if (!session.context.city && looksLikeCity(text) && text.length <= 22) {
    session.context.city = text.trim();
  } else {
    // if message contains "en Temuco" / "en Pucón"
    const mCity = tnorm.match(/\ben\s+([a-záéíóúñ\s]{3,22})\b/i);
    if (!session.context.city && mCity?.[1]) session.context.city = mCity[1].trim();
  }

  // qty
  const qty = detectQty(text);
  if (qty) session.context.qty = qty;

  // measures
  const measures = extractMeasurements(text);
  if (measures.length) {
    for (const m of measures) session.context.measuresMm.push({ w: m.w, h: m.h, source: isMedia ? "media" : "texto" });
  }

  // opening type
  const ot = detectOpeningType(text);
  if (ot) session.context.openingType = ot;

  // system
  const sys = detectSystem(text);
  if (sys) session.context.system = sys;

  // color
  const col = detectColor(text);
  if (col) session.context.color = col;

  // glass
  const gl = detectGlass(text);
  if (gl) session.context.glass = gl;

  // install
  const inst = detectInstallType(text);
  if (inst) session.context.installType = inst;

  // Color conflict rule (PVC US only white)
  if (session.context.system === SYSTEMS.PVC_US && session.context.color && session.context.color !== "blanco") {
    session.context.colorConflict = true;
  } else {
    session.context.colorConflict = false;
  }

  // Size check (first measure)
  const m0 = session.context.measuresMm?.[0];
  const sizeCheck = m0 ? checkSizeAgainstLimits(m0.w, m0.h) : null;

  // ---------------------
  // Build baseline draft
  // ---------------------
  let draft = "";

  // Intro once (soft)
  if (!session.context.introSent) {
    draft = introMessage();
    session.context.introSent = true;
    // If the user already sent clear data, we continue with next question in the same message using AI
    // (We'll let AI refine and append the best single question.)
  }

  const missingQ = nextMissingQuestion(session);

  // If everything is present: offer PDF
  if (!missingQ && shouldOfferPDF(session)) {
    draft = [
      draft ? draft : "",
      `Perfecto. Con la información que me envió puedo preparar una pre-cotización referencial.`,
      `¿Quiere que se la envíe en PDF por este mismo WhatsApp?`,
    ]
      .filter(Boolean)
      .join("\n");
  } else if (!missingQ) {
    // Edge case: no missing but doesn't qualify for pdf (should not happen often)
    draft = [
      draft ? draft : "",
      `Perfecto. Para avanzar, envíeme comuna/sector + medidas (mm) + tipo de apertura + color + si incluye instalación.`,
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    // We have at least one missing question
    // Keep it short; AI will refine.
    const confirmLine = (() => {
      const c = session.context;
      const haveMeasures = (c.measuresMm?.length || 0) > 0;
      const parts = [];
      if (c.city) parts.push(`comuna ${c.city}`);
      if (haveMeasures) {
        const last = c.measuresMm.slice(-2).map((m) => `${m.w}x${m.h}mm`).join(" y ");
        parts.push(`medidas ${last}`);
      }
      if (c.openingType) parts.push(`apertura ${c.openingType}`);
      if (c.color) parts.push(`color ${c.color}`);
      if (parts.length === 0) return "";
      return `Perfecto, confirmo: ${parts.join(", ")}.`;
    })();

    draft = [draft ? draft : "", confirmLine, missingQ].filter(Boolean).join("\n");
  }

  // ---------------------
  // AI enhancement (always)
  // ---------------------
  let aiText = null;
  try {
    aiText = await aiDraftReply({
      session,
      userText: text,
      sizeCheck,
      nextQuestion: missingQ,
    });
  } catch (e) {
    console.error("AI draft error:", e?.message || e);
  }

  let reply = aiText || draft;

  // Ensure refine (better wording)
  try {
    reply = await aiRefineReply({ session, draftText: reply, userText: text });
  } catch (e) {
    console.error("AI refine error:", e?.message || e);
    // keep reply as is
  }

  // Post-processing: line limit
  const lines = reply
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  reply = lines.slice(0, MAX_LINES_PER_REPLY).join("\n");

  // ---------------------
  // Send reply
  // ---------------------
  try {
    await waSendText(waId, reply, { replyToMessageId: messageId });

    // Save history for better continuity
    session.history.push({ role: "user", content: text || "" });
    session.history.push({ role: "assistant", content: reply });
    noteReply(session);
  } catch (e) {
    console.error("Send error:", e?.response?.data || e?.message || e);
  } finally {
    stopTyping();
  }
}

// =====================
// Webhook receiver (POST)
// =====================
app.post("/webhook", async (req, res) => {
  // Always respond 200 quickly to Meta. We'll do async work inside.
  res.sendStatus(200);

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

    if (processedMsgIds.has(messageId)) return;
    addProcessed(messageId);

    const session = getSession(waId);

    // Reset command
    const incomingTextLower =
      msg.type === "text" ? (msg.text?.body || "").trim().toLowerCase() : "";

    if (["reset", "reiniciar", "nuevo", "start", "comenzar"].includes(incomingTextLower)) {
      sessions.delete(waId);
      await waSendText(
        waId,
        `Listo. Reinicié su sesión.\nEnvíeme su solicitud con: comuna/sector + medidas (mm) + tipo (corredera/abatible/proyectante/fija/puerta) + color + si incluye instalación.`,
        { replyToMessageId: messageId }
      );
      return;
    }

    // "pdf" command to force PDF quote if eligible
    if (ENABLE_PDF_QUOTES && msg.type === "text" && ["pdf", "cotizacion pdf", "cotización pdf"].includes(incomingTextLower)) {
      if (shouldOfferPDF(session)) {
        const pdfBuffer = await generatePDF(waId, session);
        await waSendDocument(
          waId,
          pdfBuffer,
          `PreCotizacion_${COMPANY_NAME}.pdf`,
          "Adjunto pre-cotización referencial (validación final en terreno).",
          { replyToMessageId: messageId }
        );
      } else {
        const q = nextMissingQuestion(session) || "Envíeme comuna/sector + medidas (mm) + tipo + color + si incluye instalación.";
        await waSendText(waId, `Para generar el PDF, primero me falta:\n${q}`, { replyToMessageId: messageId });
      }
      return;
    }

    // Helper ack
    const ack = async (text) => {
      try {
        await waSendText(waId, text, { replyToMessageId: messageId });
      } catch {}
    };

    // -------------------------
    // Message types
    // -------------------------
    if (msg.type === "text") {
      await scheduleReply(waId, messageId, msg.text?.body || "");
      return;
    }

    if (msg.type === "image") {
      const mediaId = msg.image?.id;
      const mime = msg.image?.mime_type || "image/jpeg";
      console.log("INCOMING IMAGE:", { mime, mediaId });

      await ack("Recibido. Estoy revisando la imagen para extraer medidas y tipo de ventana.");

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
      return;
    }

    if (msg.type === "document") {
      const mime = msg.document?.mime_type || "";
      const filename = msg.document?.filename || "archivo";
      const mediaId = msg.document?.id;

      console.log("INCOMING DOCUMENT:", { mime, filename, mediaId });

      await ack(`Recibido "${filename}". Estoy revisándolo para extraer especificación y medidas.`);

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
          parsedText ? `Texto extraído (resumen):\n${parsedText.slice(0, 1800)}` : "",
          measures.length ? `Medidas detectadas (mm): ${measures.map((m) => `${m.w}x${m.h}`).join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        await scheduleReply(waId, messageId, combined, { isMedia: true });
      } finally {
        stopTyping();
      }

      return;
    }

    if (msg.type === "audio") {
      if (!ENABLE_VOICE_TRANSCRIBE) {
        await ack("Recibí su audio. Por ahora, ¿me lo puede enviar como texto o con medidas (ancho x alto) y comuna?");
        return;
      }

      const mediaId = msg.audio?.id;
      console.log("INCOMING AUDIO:", { mediaId });

      await ack("Recibí su audio. Déjeme transcribirlo para avanzar con la cotización.");

      const stopTyping = startTypingPinger(messageId, "text");
      try {
        const url = await waGetMediaUrl(mediaId);
        const bytes = await waDownloadMediaBytes(url);
        const text = await transcribeVoice(bytes);
        const combined = `Audio transcrito:\n${text}`.trim();
        await scheduleReply(waId, messageId, combined, { isMedia: true });
      } catch (e) {
        console.error("Voice error:", e?.message || e);
        await ack("Tuve un problema transcribiendo el audio. ¿Me lo puede resumir en texto (comuna + medidas + tipo + color)?");
      } finally {
        stopTyping();
      }
      return;
    }

    await waSendText(
      waId,
      "Recibido. Puedo ayudar mejor con texto, imágenes, PDFs o audios. ¿Qué necesita cotizar (medidas + comuna + tipo + color)?",
      { replyToMessageId: messageId }
    );
  } catch (e) {
    console.error("Webhook async error:", e?.message || e);
  }
});

// =====================
// Start server
// =====================
app.listen(PORT, () => {
  console.log("Listening...");
});
