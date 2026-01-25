import "dotenv/config";
import express from "express";
import axios from "axios";
import OpenAI from "openai";
import pdfParse from "pdf-parse";
import PDFDocument from "pdfkit";
import FormData from "form-data";
import { Readable } from "stream";

/**
 * WhatsApp IA Hub (Activa) - FULL
 * - Webhook verification (GET /webhook)
 * - Incoming messages (POST /webhook) -> 200 inmediato + procesamiento async
 * - Text + Image + PDF + Voice transcription (Whisper)
 * - Cotización referencial por m² + PDF automático
 * - Sesiones + checklist (evita preguntas infinitas)
 *
 * Node: ESM ("type":"module")
 */

const app = express();
app.use(express.json({ limit: "15mb" }));

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
const PORT = envInt("PORT", 8080);

const WHATSAPP_TOKEN = env("WHATSAPP_TOKEN");
const PHONE_NUMBER_ID = env("PHONE_NUMBER_ID");
const VERIFY_TOKEN = env("VERIFY_TOKEN");
const META_GRAPH_VERSION = env("META_GRAPH_VERSION", "v22.0");

const OPENAI_API_KEY = env("OPENAI_API_KEY");
const AI_MODEL_TEXT = env("AI_MODEL_TEXT", "gpt-4.1-mini");
const AI_MODEL_VISION = env("AI_MODEL_VISION", "gpt-4o-mini");
const AI_TEMPERATURE = Number(env("AI_TEMPERATURE", "0.35"));
const AI_MAX_OUTPUT_TOKENS = envInt("AI_MAX_OUTPUT_TOKENS", 340);
const AI_ENHANCE_ALWAYS = envBool("AI_ENHANCE_ALWAYS", true);

// =====================
// Feature flags
// =====================
const ENABLE_PDF_QUOTES = envBool("ENABLE_PDF_QUOTES", true);
const ENABLE_VOICE_TRANSCRIPTION = envBool("ENABLE_VOICE_TRANSCRIPTION", true);
const ENABLE_IMAGE_VISION = envBool("ENABLE_IMAGE_VISION", true);

// =====================
// Humanization / pacing
// =====================
const TYPING_SIMULATION = envBool("TYPING_SIMULATION", true);
const WAIT_AFTER_LAST_USER_MESSAGE_MS = envInt("WAIT_AFTER_LAST_USER_MESSAGE_MS", 1200);
const EXTRA_DELAY_MEDIA_MS = envInt("EXTRA_DELAY_MEDIA_MS", 1200);
const TYPING_MIN_MS = envInt("TYPING_MIN_MS", 600);
const TYPING_MAX_MS = envInt("TYPING_MAX_MS", 1400);

const MAX_LINES_PER_REPLY = envInt("MAX_LINES_PER_REPLY", 8);
const ONE_QUESTION_PER_TURN = envBool("ONE_QUESTION_PER_TURN", true);

// Loop guard
const LOOP_GUARD_MAX_REPLIES_PER_5MIN = envInt("LOOP_GUARD_MAX_REPLIES_PER_5MIN", 8);

// =====================
// Brand / positioning
// =====================
const COMPANY_NAME = env("COMPANY_NAME", "Fábrica de Ventanas Activa");
const AGENT_NAME = env("AGENT_NAME", "Marcelo Cifuentes");
const LANGUAGE = env("LANGUAGE", "es-CL");
const TONO = env("TONO", "usted"); // usted | tu

// Diferenciador de valor (sin prometer % “duro”)
const VALUE_PITCH = env(
  "VALUE_PITCH",
  "Nos enfocamos en calidad y desempeño (hermeticidad, instalación y confort térmico). Trabajamos DVH/termopanel con separador warm-edge Thermoflex para reducir condensación frente al separador de aluminio tradicional."
);

// =====================
// Pricing (m²) - NETO
// =====================
const PRICE_WHITE = envInt("PRICE_WHITE", 150000);
const PRICE_WOOD = envInt("PRICE_WOOD", 160000); // nogal/roble
const PRICE_DARK = envInt("PRICE_DARK", 170000); // grafito/negro
const VAT_RATE = Number(env("VAT_RATE", "0.19"));

// Colores disponibles
const COLORS_EU = (env("PVC_EU_COLORS", "blanco,roble dorado,nogal,grafito,negro"))
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const COLORS_US = (env("PVC_US_COLORS", "blanco"))
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Defaults controlados
const DEFAULT_GLASS = env("DEFAULT_GLASS", "termopanel normal (DVH estándar)");
const DEFAULT_SYSTEM = env("DEFAULT_SYSTEM", "pvc europeo"); // para pre-cotizar en valor
const DEFAULT_TYPE = env("DEFAULT_TYPE", "corredera");
const DEFAULT_COLOR = env("DEFAULT_COLOR", "blanco");
const ALT_COLOR = env("ALT_COLOR", "nogal");

// =====================
// OpenAI client
// =====================
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// =====================
// Logs
// =====================
console.log("Starting Container");
console.log(`Server running on port ${PORT}`);
console.log(`ENV WHATSAPP_TOKEN: ${WHATSAPP_TOKEN ? "OK" : "MISSING"}`);
console.log(`ENV PHONE_NUMBER_ID: ${PHONE_NUMBER_ID ? "OK" : "MISSING"}`);
console.log(`ENV VERIFY_TOKEN: ${VERIFY_TOKEN ? "OK" : "MISSING"}`);
console.log(`ENV OPENAI_API_KEY: ${OPENAI_API_KEY ? "OK" : "MISSING"}`);
console.log(`AI_MODEL_TEXT: ${AI_MODEL_TEXT}`);
console.log(`AI_MODEL_VISION: ${AI_MODEL_VISION}`);
console.log(`TYPING_SIMULATION: ${TYPING_SIMULATION}`);
console.log(`ENABLE_PDF_QUOTES: ${ENABLE_PDF_QUOTES}`);
console.log(`ENABLE_VOICE_TRANSCRIPTION: ${ENABLE_VOICE_TRANSCRIPTION}`);

// =====================
// Health
// =====================
app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", (req, res) => res.status(200).json({ ok: true }));

// =====================
// Webhook verification
// =====================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// =====================
// Session store (in-memory)
// =====================
const sessions = new Map(); // waId -> session
const processedMsgIds = new Set();
const maxProcessed = 4000;

function addProcessed(id) {
  if (!id) return;
  processedMsgIds.add(id);
  if (processedMsgIds.size > maxProcessed) {
    const first = processedMsgIds.values().next().value;
    processedMsgIds.delete(first);
  }
}

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      waId,
      createdAt: Date.now(),
      lastSeenAt: 0,
      lastReplyAt: 0,
      repliesIn5Min: [],
      history: [], // {role, content}
      context: {
        name: null,
        comuna: null,
        sector: null,
        system: null,     // pvc europeo | pvc americano | aluminio
        color: null,
        type: null,       // corredera | abatible | proyectante | fija | puerta
        glass: null,      // termopanel normal...
        quantity: null,
        items: [],        // [{wMm,hMm,qty,type,color,system}]
        lastQuote: null
      },
      debounceTimer: null,
      pendingText: ""
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// =====================
// WhatsApp API helpers
// =====================
const WA_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}/${PHONE_NUMBER_ID}`;

function waHeadersJSON() {
  return { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" };
}

async function waSendText(to, text, { replyToMessageId = null } = {}) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text }
  };
  if (replyToMessageId && envBool("REPLY_WITH_CONTEXT", true)) payload.context = { message_id: replyToMessageId };

  return axios.post(`${WA_BASE}/messages`, payload, { headers: waHeadersJSON(), timeout: 20000 });
}

/**
 * Typing indicator correcto:
 * POST /messages con status:"read" + message_id + typing_indicator:{type:"text"}
 */
async function waTypingIndicator(messageId, type = "text") {
  if (!TYPING_SIMULATION) return;
  if (!messageId) return;

  const payload = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
    typing_indicator: { type }
  };
  return axios.post(`${WA_BASE}/messages`, payload, { headers: waHeadersJSON(), timeout: 15000 });
}

function startTypingPinger(messageId, type = "text") {
  if (!TYPING_SIMULATION || !messageId) return () => {};
  waTypingIndicator(messageId, type).catch(() => {});
  const intervalMs = 20000;
  const maxMs = 65000;
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - startedAt > maxMs) return clearInterval(timer);
    waTypingIndicator(messageId, type).catch(() => {});
  }, intervalMs);
  return () => clearInterval(timer);
}

// Media fetch (Cloud API)
async function waGetMediaUrl(mediaId) {
  const r = await axios.get(`https://graph.facebook.com/${META_GRAPH_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    timeout: 20000
  });
  return r.data?.url;
}
async function waDownloadMediaBytes(mediaUrl) {
  const r = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    responseType: "arraybuffer",
    timeout: 30000
  });
  return Buffer.from(r.data);
}

/**
 * Upload media to WhatsApp /media (multipart)
 * Returns media_id
 */
async function waUploadMedia(buffer, mimeType, filename = "archivo.pdf") {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buffer, { filename, contentType: mimeType });

  const r = await axios.post(`${WA_BASE}/media`, form, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, ...form.getHeaders() },
    maxBodyLength: Infinity,
    timeout: 60000
  });

  return r.data?.id;
}

async function waSendDocument(to, mediaId, filename, caption = "", { replyToMessageId = null } = {}) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: { id: mediaId, filename }
  };
  if (caption) payload.document.caption = caption;
  if (replyToMessageId && envBool("REPLY_WITH_CONTEXT", true)) payload.context = { message_id: replyToMessageId };

  return axios.post(`${WA_BASE}/messages`, payload, { headers: waHeadersJSON(), timeout: 20000 });
}

// =====================
// Text normalization & extraction
// =====================
function norm(s) {
  return (s || "").toString().trim();
}
function normLower(s) {
  return norm(s).toLowerCase();
}
function stripAccents(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function toMm(value, unit) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  const u = (unit || "mm").toLowerCase();
  if (u.startsWith("m") && !u.startsWith("mm")) return Math.round(v * 1000);
  if (u.startsWith("cm")) return Math.round(v * 10);
  return Math.round(v);
}

function extractMeasurements(text) {
  const out = [];
  const clean = normLower(text).replace(/,/g, ".");
  // 1000x1200 mm / 1.2x1.5 m / 120x150 cm
  const reX = /(\d{1,4}(\.\d{1,3})?)\s*[x×]\s*(\d{1,4}(\.\d{1,3})?)\s*(mm|cm|m)?/g;
  let m;
  while ((m = reX.exec(clean))) {
    const w = toMm(m[1], m[5] || "mm");
    const h = toMm(m[3], m[5] || "mm");
    if (w && h) out.push({ wMm: w, hMm: h, raw: m[0] });
  }
  return out;
}

function extractQuantity(text) {
  const t = stripAccents(normLower(text));
  // "son 2", "2 ventanas", "cantidad 7"
  let m = t.match(/\b(?:son|cantidad|cant)\s*(\d{1,3})\b/);
  if (m) return parseInt(m[1], 10);
  m = t.match(/\b(\d{1,3})\s*(?:ventanas|puertas|unidades|uds|ud)\b/);
  if (m) return parseInt(m[1], 10);
  // "2" suelto (no perfecto)
  m = t.match(/^\s*(\d{1,3})\s*$/);
  if (m) return parseInt(m[1], 10);
  return null;
}

function extractType(text) {
  const t = stripAccents(normLower(text));
  if (t.includes("corredera") || t.includes("corrediza")) return "corredera";
  if (t.includes("abatible")) return "abatible";
  if (t.includes("proyectante") || t.includes("basculante")) return "proyectante";
  if (t.includes("fija")) return "fija";
  if (t.includes("puerta")) return "puerta";
  return null;
}

function extractSystem(text) {
  const t = stripAccents(normLower(text));
  if (t.includes("pvc europeo") || t.includes("linea europea") || t.includes("europea")) return "pvc europeo";
  if (t.includes("pvc americano") || t.includes("linea americana") || t.includes("americana")) return "pvc americano";
  if (t.includes("aluminio")) return "aluminio";
  return null;
}

function extractColor(text) {
  const t = stripAccents(normLower(text));

  // Mapeos simples
  if (t.includes("nogal")) return "nogal";
  if (t.includes("roble")) return "roble dorado";
  if (t.includes("grafito")) return "grafito";
  if (t.includes("negro")) return "negro";
  if (t.includes("blanco")) return "blanco";

  return null;
}

function extractComuna(text) {
  // Heurística simple: detecta comunas frecuentes; si no, intenta por “en <palabra>”
  const t = stripAccents(normLower(text));
  const known = ["temuco", "padre las casas", "villarrica", "pucon", "pucón", "freire", "lautaro", "angol", "collipulli", "loncoche"];
  for (const k of known) {
    const kk = stripAccents(k);
    if (t.includes(kk)) return k.replace("pucón", "pucón");
  }
  const m = t.match(/\ben\s+([a-zñ\s]{3,30})\b/);
  if (m) return m[1].trim();
  return null;
}

function extractGlass(text) {
  const t = stripAccents(normLower(text));
  if (t.includes("termopanel") || t.includes("dvh") || t.includes("doble vidrio")) return DEFAULT_GLASS;
  if (t.includes("vidrio normal") || t.includes("monolitico") || t.includes("simple")) return "vidrio normal";
  return null;
}

// =====================
// Quote calculator
// =====================
function pricePerM2ByColor(color) {
  const c = stripAccents(normLower(color || ""));
  if (c.includes("nogal") || c.includes("roble")) return PRICE_WOOD;
  if (c.includes("grafito") || c.includes("negro")) return PRICE_DARK;
  return PRICE_WHITE;
}

function mmToM(mm) {
  return mm / 1000;
}

function computeQuote(items) {
  // items: [{wMm,hMm,qty,color}]
  const lines = [];
  let net = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const wM = mmToM(it.wMm);
    const hM = mmToM(it.hMm);
    const area = Math.max(0, wM * hM);
    const unitNet = area * pricePerM2ByColor(it.color);
    const qty = it.qty || 1;
    const lineNet = unitNet * qty;

    net += lineNet;

    lines.push({
      idx: i + 1,
      wMm: it.wMm,
      hMm: it.hMm,
      qty,
      area: Number(area.toFixed(3)),
      color: it.color,
      system: it.system,
      type: it.type,
      glass: it.glass,
      unitNet: Math.round(unitNet),
      lineNet: Math.round(lineNet)
    });
  }

  const iva = Math.round(net * VAT_RATE);
  const total = net + iva;

  return { lines, net: Math.round(net), iva, total };
}

// =====================
// PDF generator
// =====================
function moneyCLP(n) {
  try {
    return new Intl.NumberFormat("es-CL").format(n);
  } catch {
    return String(n);
  }
}

async function generateQuotePDF({ session, quote, title = "Pre-cotización referencial" }) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    doc.fontSize(16).text(`${COMPANY_NAME}`, { align: "center" });
    doc.moveDown(0.2);
    doc.fontSize(12).text(`${title}`, { align: "center" });
    doc.moveDown(0.8);

    doc.fontSize(10).text(`Atiende: ${AGENT_NAME}`);
    doc.text(`Cliente (WhatsApp): ${session.waId}`);
    const comuna = session.context.comuna || session.context.sector || "No informado";
    doc.text(`Comuna/Sector: ${comuna}`);
    doc.text(`Fecha: ${new Date().toLocaleString("es-CL")}`);
    doc.moveDown(0.8);

    doc.fontSize(11).text("Especificación base considerada:", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).text(`- Vidrio: ${session.context.glass || DEFAULT_GLASS}`);
    doc.text(`- Marco: ${session.context.system || DEFAULT_SYSTEM}`);
    doc.text(`- Apertura: ${session.context.type || DEFAULT_TYPE}`);
    doc.text(`- Enfoque: ${VALUE_PITCH}`);
    doc.moveDown(0.8);

    doc.fontSize(11).text("Detalle de ítems:", { underline: true });
    doc.moveDown(0.4);

    quote.lines.forEach((l) => {
      doc.fontSize(10).text(
        `${l.idx}) ${l.qty} ud | ${l.wMm} x ${l.hMm} mm | ${l.type} | ${l.system} | color ${l.color} | área ${l.area} m² | neto línea $${moneyCLP(l.lineNet)}`
      );
    });

    doc.moveDown(0.8);
    doc.fontSize(11).text("Resumen:", { underline: true });
    doc.moveDown(0.4);

    doc.fontSize(10).text(`Neto: $${moneyCLP(quote.net)}`);
    doc.text(`IVA (${Math.round(VAT_RATE * 100)}%): $${moneyCLP(quote.iva)}`);
    doc.fontSize(12).text(`Total: $${moneyCLP(quote.total)}`, { underline: true });

    doc.moveDown(1);
    doc.fontSize(9).text(
      "Nota: Pre-cotización referencial sujeta a confirmación en terreno (medidas finales, condiciones de instalación y especificación definitiva).",
      { align: "left" }
    );

    doc.end();
  });
}

// =====================
// Voice transcription (Whisper)
// =====================
async function transcribeVoice(buffer) {
  if (!openai) return "";
  const file = await OpenAI.toFile(Readable.from(buffer), "voice.ogg");
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1"
  });
  return transcription?.text || "";
}

// =====================
// AI reply (mejora de redacción)
// =====================
function buildSystemPrompt(session) {
  const tono = TONO === "tu" ? "tú" : "usted";

  return [
    `Idioma: ${LANGUAGE}. Tratar al cliente de "${tono}".`,
    `Usted es ${AGENT_NAME} de ${COMPANY_NAME}.`,
    `Posicionamiento: NO competir por precio; competir por valor (hermeticidad, instalación, confort térmico).`,
    `Aclaración clave: "Termopanel/DVH es el vidrio; el marco puede ser PVC europeo, PVC americano o aluminio".`,
    `No mencionar aluminio con RPT (no se vende).`,
    `Siempre ser directo, sin exceso de "gracias".`,
    `Máximo ${MAX_LINES_PER_REPLY} líneas.`,
    ONE_QUESTION_PER_TURN ? `Hacer máximo 1 pregunta al final.` : `Puede hacer las preguntas necesarias.`,
    `Si faltan datos, usar supuestos controlados: vidrio DVH estándar; color blanco (alternativa nogal); tipo corredera; sistema PVC europeo referencial.`,
    `Cuando haya suficientes datos, entregar pre-cotización con subtotal neto, IVA y total, y ofrecer PDF si está habilitado.`,
    `Si el cliente pide evaluación normativa/energética, ofrecer escalamiento a Equipo Alfa.`,
    `Datos sesión: comuna=${session.context.comuna || "?"}, sistema=${session.context.system || "?"}, color=${session.context.color || "?"}, tipo=${session.context.type || "?"}.`
  ].join("\n");
}

async function aiCompose({ session, intent, facts }) {
  if (!openai) return null;

  const sys = buildSystemPrompt(session);
  const user = [
    `INTENCIÓN: ${intent}`,
    `HECHOS/CONTEXTO (no inventar):`,
    facts,
    `Redacte respuesta final lista para WhatsApp, clara, consultiva y breve.`
  ].join("\n\n");

  const r = await openai.chat.completions.create({
    model: AI_MODEL_TEXT,
    messages: [
      { role: "system", content: sys },
      ...session.history.slice(-10),
      { role: "user", content: user }
    ],
    temperature: AI_TEMPERATURE,
    max_tokens: AI_MAX_OUTPUT_TOKENS
  });

  return r.choices?.[0]?.message?.content?.trim() || null;
}

// =====================
// Image vision (optional)
// =====================
async function visionExtract(buffer, mimeType) {
  if (!openai || !ENABLE_IMAGE_VISION) return "";
  try {
    const b64 = buffer.toString("base64");
    const r = await openai.chat.completions.create({
      model: AI_MODEL_VISION,
      messages: [
        {
          role: "system",
          content:
            "Extrae SOLO: (1) medidas ancho x alto y unidad, (2) cantidad si aparece, (3) tipo (corredera/proyectante/fija/abatible/puerta), (4) color si aparece. Si no se ve, diga 'sin datos legibles'."
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Analiza la imagen y extrae medidas/cantidad/tipo/color." },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${b64}` } }
          ]
        }
      ],
      temperature: 0.2,
      max_tokens: 220
    });

    return r.choices?.[0]?.message?.content?.trim() || "";
  } catch (e) {
    console.error("Vision error:", e?.message || e);
    return "";
  }
}

// =====================
// State machine (evita preguntas infinitas)
// =====================
function applyExtractedToContext(session, text) {
  const t = norm(text);
  if (!t) return;

  const ctx = session.context;

  // Nombre (si el cliente se presenta)
  const lc = stripAccents(normLower(t));
  const nameMatch = lc.match(/\b(me llamo|soy)\s+([a-zñ\s]{3,40})\b/);
  if (nameMatch && !ctx.name) ctx.name = nameMatch[2].trim().split(" ").slice(0, 3).join(" ");

  const comuna = extractComuna(t);
  if (comuna && !ctx.comuna) ctx.comuna = comuna;

  const qty = extractQuantity(t);
  if (qty && !ctx.quantity) ctx.quantity = qty;

  const type = extractType(t);
  if (type && !ctx.type) ctx.type = type;

  const system = extractSystem(t);
  if (system && !ctx.system) ctx.system = system;

  const color = extractColor(t);
  if (color && !ctx.color) ctx.color = color;

  const glass = extractGlass(t);
  if (glass && !ctx.glass) ctx.glass = glass;

  const measures = extractMeasurements(t);
  if (measures.length) {
    // Si vienen varias, se asumen como ítems; si no hay qty por ítem, usa quantity global si existe.
    for (const m of measures) {
      ctx.items.push({
        wMm: m.wMm,
        hMm: m.hMm,
        qty: 1,
        type: ctx.type || null,
        color: ctx.color || null,
        system: ctx.system || null,
        glass: ctx.glass || null
      });
    }
  }
}

function ensureDefaults(session) {
  const ctx = session.context;

  if (!ctx.glass) ctx.glass = DEFAULT_GLASS;
  if (!ctx.system) ctx.system = DEFAULT_SYSTEM;
  if (!ctx.type) ctx.type = DEFAULT_TYPE;

  // Color: si no hay, cotizar con blanco y ofrecer nogal como alternativa (no forzar)
  if (!ctx.color) ctx.color = DEFAULT_COLOR;

  // Si no hay items pero hay medidas por contexto (no), aquí no aplica: items se arma con medidas.
}

function normalizeItems(session) {
  const ctx = session.context;

  // Si no hay items, no hay medidas => no cotiza
  if (!ctx.items || !Array.isArray(ctx.items)) ctx.items = [];

  // Si el cliente dijo “son 2” y solo hay 1 medida, aplicar qty a ese ítem
  if (ctx.quantity && ctx.items.length === 1) ctx.items[0].qty = ctx.quantity;

  // Si hay múltiples medidas y el cliente dijo “son 2” pero envió 2 medidas: qty=1 cada una (por defecto)
  // Si el cliente dijo “son 2” y envió 2 medidas pero quería 2 de cada, se confirma luego.

  // Completar campos faltantes por ítem
  for (const it of ctx.items) {
    if (!it.type) it.type = ctx.type || DEFAULT_TYPE;
    if (!it.system) it.system = ctx.system || DEFAULT_SYSTEM;
    if (!it.glass) it.glass = ctx.glass || DEFAULT_GLASS;
    if (!it.color) it.color = ctx.color || DEFAULT_COLOR;
    if (!it.qty) it.qty = 1;
  }

  // Validación: si sistema pvc americano, colores solo blanco
  if ((ctx.system || "").includes("americano")) {
    for (const it of ctx.items) {
      if (!COLORS_US.includes(stripAccents(it.color))) it.color = "blanco";
    }
  }
}

function hasMinimumForQuote(session) {
  const ctx = session.context;
  const hasMeasures = ctx.items && ctx.items.length > 0;
  const hasComuna = !!(ctx.comuna || ctx.sector);
  // quantity puede venir por item (si items>0) así que no es obligatorio global
  return hasMeasures && hasComuna;
}

function nextBestQuestion(session) {
  const ctx = session.context;

  if (!ctx.comuna && !ctx.sector) return "¿En qué comuna/sector de La Araucanía se instalarán?";
  if (!ctx.items || ctx.items.length === 0) return "¿Me indica las medidas ancho x alto (mm) y cuántas unidades son?";
  // Si hay items pero no tipo explícito y se está asumiendo corredera, pregunte solo si el cliente busca otra cosa
  if (!extractType(ctx.pendingText || "") && !ctx.type) return "¿Qué tipo de apertura prefiere: corredera, abatible, proyectante, fija o puerta?";
  // Si no hay color, ya usamos blanco; ofrecer alternativa sin frenar
  return null;
}

// =====================
// Debounced reply scheduler (alto rendimiento)
// =====================
async function scheduleReply(waId, messageId, collectedText, { isMedia = false } = {}) {
  const session = getSession(waId);
  session.lastSeenAt = Date.now();
  session.pendingText = collectedText || "";

  // Debounce: acumula mensajes cercanos
  session.pendingText = (session.pendingText ? session.pendingText + "\n" : "") + (collectedText || "");
  if (session.debounceTimer) clearTimeout(session.debounceTimer);

  session.debounceTimer = setTimeout(async () => {
    try {
      if (!loopGuardOk(session)) return;

      const stopTyping = startTypingPinger(messageId, "text");
      try {
        await sleep(WAIT_AFTER_LAST_USER_MESSAGE_MS);
        if (isMedia) await sleep(EXTRA_DELAY_MEDIA_MS);
        const typingDelay = Math.floor(TYPING_MIN_MS + Math.random() * (Math.max(TYPING_MAX_MS, TYPING_MIN_MS + 50) - TYPING_MIN_MS));
        await sleep(typingDelay);

        const text = session.pendingText || collectedText || "";
        session.pendingText = "";

        // 1) Extraer y aplicar
        applyExtractedToContext(session, text);

        // 2) Defaults + normalización
        ensureDefaults(session);
        normalizeItems(session);

        // 3) Decidir: cotizar o preguntar 1 cosa
        let replyText = "";
        let quote = null;

        if (hasMinimumForQuote(session)) {
          quote = computeQuote(session.context.items);
          session.context.lastQuote = quote;

          const colorWasDefault = stripAccents(normLower(text)).includes("color") ? false : false; // no perfecto; se maneja abajo
          const usedColor = session.context.color || DEFAULT_COLOR;
          const alt = ALT_COLOR;

          const facts = [
            `Comuna/sector: ${session.context.comuna || session.context.sector}`,
            `Sistema: ${session.context.system}`,
            `Tipo: ${session.context.type}`,
            `Vidrio: ${session.context.glass}`,
            `Color base usado: ${usedColor} (si no indicó color, este es el estándar).`,
            `Tarifas netas por m²: blanco ${PRICE_WHITE}, nogal/roble ${PRICE_WOOD}, grafito/negro ${PRICE_DARK}.`,
            `Detalle líneas:`,
            quote.lines
              .map(
                (l) =>
                  `${l.qty} ud ${l.wMm}x${l.hMm}mm | ${l.type} | ${l.system} | color ${l.color} | neto línea $${moneyCLP(l.lineNet)}`
              )
              .join("\n"),
            `Neto $${moneyCLP(quote.net)} | IVA $${moneyCLP(quote.iva)} | Total $${moneyCLP(quote.total)}.`,
            `Nota: pre-cotización referencial sujeta a confirmación en terreno.`
          ].join("\n");

          const intent = "ENTREGAR PRE-COTIZACIÓN + cierre (una pregunta si falta confirmación)";
          const ai = AI_ENHANCE_ALWAYS ? await aiCompose({ session, intent, facts }) : null;

          replyText =
            ai ||
            [
              `${AGENT_NAME} • ${COMPANY_NAME}`,
              `Pre-cotización referencial (DVH estándar + enfoque en hermeticidad).`,
              ...quote.lines.map(
                (l) => `• ${l.qty} ud ${l.wMm}x${l.hMm}mm (${l.type}) color ${l.color}: neto $${moneyCLP(l.lineNet)}`
              ),
              `Neto: $${moneyCLP(quote.net)} | IVA: $${moneyCLP(quote.iva)} | Total: $${moneyCLP(quote.total)}`,
              `Si no indicó color, cotizamos base en ${DEFAULT_COLOR} (alternativa ${ALT_COLOR}).`,
              ONE_QUESTION_PER_TURN ? "¿Confirmamos color y tipo para formalizar (y agendar visita si desea)?" : ""
            ]
              .filter(Boolean)
              .join("\n");

          // PDF automático (si habilitado)
          if (ENABLE_PDF_QUOTES) {
            const pdfBuffer = await generateQuotePDF({ session, quote, title: "Pre-cotización referencial" });
            const filename = `PreCotizacion_${COMPANY_NAME.replace(/\s+/g, "_")}.pdf`;
            const mediaId = await waUploadMedia(pdfBuffer, "application/pdf", filename);
            await waSendDocument(waId, mediaId, filename, "Adjunto pre-cotización referencial (sujeta a confirmación en terreno).", {
              replyToMessageId: messageId
            });
          }
        } else {
          // Falta algo: preguntar solo lo mínimo (1 pregunta)
          const question = nextBestQuestion(session) || "¿Me indica comuna/sector y medidas ancho x alto (mm)?";

          const facts = [
            `Presentación corta + propuesta de valor.`,
            `Aclarar: termopanel es el vidrio; marco puede ser PVC europeo/americano o aluminio.`,
            `Supuestos: DVH estándar; color base blanco; alternativa nogal.`,
            `Pregunta única: ${question}`
          ].join("\n");

          const intent = "PEDIR DATOS MÍNIMOS SIN ALARGAR (1 pregunta, sin exceso de gracias)";
          const ai = AI_ENHANCE_ALWAYS ? await aiCompose({ session, intent, facts }) : null;

          replyText =
            ai ||
            [
              `Hola, le habla ${AGENT_NAME} de ${COMPANY_NAME}.`,
              `${VALUE_PITCH}`,
              `Para cotizar rápido: ${question}`
            ].join("\n");
        }

        // Limitar líneas
        const lines = replyText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, MAX_LINES_PER_REPLY);
        replyText = lines.join("\n");

        await waSendText(waId, replyText, { replyToMessageId: messageId });

        // Guardar historial (para que AI sea coherente)
        session.history.push({ role: "user", content: text || "" });
        session.history.push({ role: "assistant", content: replyText });
        noteReply(session);
      } finally {
        stopTyping();
      }
    } catch (e) {
      console.error("scheduleReply error:", e?.response?.data || e?.message || e);
    }
  }, 450);
}

// =====================
// PDF parse for incoming docs
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

// =====================
// Webhook receiving (POST)
// - responde 200 inmediato, procesa async
// =====================
app.post("/webhook", (req, res) => {
  // RESPONDER 200 YA (evita reintentos/latencia)
  res.sendStatus(200);

  // Procesar en background
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

      if (!waId || !messageId) return;
      if (processedMsgIds.has(messageId)) return;
      addProcessed(messageId);

      const session = getSession(waId);

      const incomingText = msg.type === "text" ? norm(msg.text?.body) : "";
      const lower = normLower(incomingText);

      // Reset
      if (["reset", "reiniciar", "nuevo", "start", "comenzar"].includes(lower)) {
        sessions.delete(waId);
        await waSendText(
          waId,
          `Listo. Reinicié su sesión.\nEnvíeme: comuna/sector + medidas (mm) + cantidad + color (si aplica) + tipo (corredera/abatible/proyectante/fija/puerta).`,
          { replyToMessageId: messageId }
        );
        return;
      }

      // ACK helper
      const ack = async (text) => {
        try {
          await waSendText(waId, text, { replyToMessageId: messageId });
        } catch {}
      };

      // TEXT
      if (msg.type === "text") {
        await scheduleReply(waId, messageId, incomingText);
        return;
      }

      // IMAGE
      if (msg.type === "image") {
        const mediaId = msg.image?.id;
        const mime = msg.image?.mime_type || "image/jpeg";
        await ack("Recibido. Estoy revisando la imagen para extraer medidas y preparar la pre-cotización.");

        try {
          const url = await waGetMediaUrl(mediaId);
          const bytes = await waDownloadMediaBytes(url);
          const extracted = await visionExtract(bytes, mime);
          const combined = `Imagen recibida.\n${extracted || ""}`.trim();
          await scheduleReply(waId, messageId, combined, { isMedia: true });
        } catch (e) {
          console.error("image flow error:", e?.message || e);
          await scheduleReply(waId, messageId, "No pude leer la imagen. Envíeme medidas ancho x alto (mm) y comuna/sector.", { isMedia: true });
        }
        return;
      }

      // DOCUMENT (PDF)
      if (msg.type === "document") {
        const mime = msg.document?.mime_type || "";
        const filename = msg.document?.filename || "archivo";
        const mediaId = msg.document?.id;

        await ack(`Recibido "${filename}". Estoy extrayendo texto/medidas para cotizar.`);

        try {
          const url = await waGetMediaUrl(mediaId);
          const bytes = await waDownloadMediaBytes(url);

          let parsedText = "";
          if (mime.includes("pdf")) parsedText = await parsePdfText(bytes);

          const combined = [
            `Documento: ${filename} (${mime || "documento"}).`,
            parsedText ? `Texto extraído (resumen):\n${parsedText.slice(0, 2500)}` : ""
          ]
            .filter(Boolean)
            .join("\n\n");

          await scheduleReply(waId, messageId, combined, { isMedia: true });
        } catch (e) {
          console.error("document flow error:", e?.message || e);
          await scheduleReply(waId, messageId, "No pude leer el documento. Envíeme medidas ancho x alto (mm) y comuna/sector.", { isMedia: true });
        }
        return;
      }

      // AUDIO / VOICE
      if (msg.type === "audio" || msg.type === "voice") {
        if (!ENABLE_VOICE_TRANSCRIPTION) {
          await ack("Recibido. Por ahora respondo mejor si me envía el texto o medidas por escrito.");
          return;
        }

        const mediaId = msg.audio?.id || msg.voice?.id;
        const mime = msg.audio?.mime_type || msg.voice?.mime_type || "audio/ogg";

        await ack("Recibido. Estoy transcribiendo su audio para preparar la pre-cotización.");

        try {
          const url = await waGetMediaUrl(mediaId);
          const bytes = await waDownloadMediaBytes(url);
          const text = await transcribeVoice(bytes);

          const combined = `Audio transcrito:\n${text || ""}`.trim();
          await scheduleReply(waId, messageId, combined, { isMedia: true });
        } catch (e) {
          console.error("voice flow error:", e?.message || e);
          await scheduleReply(waId, messageId, "No pude transcribir el audio. Envíeme comuna/sector + medidas (mm) por texto.", { isMedia: true });
        }
        return;
      }

      // Fallback
      await waSendText(
        waId,
        "Recibido. Puedo ayudar mejor con texto, imágenes, PDFs o audios. Envíeme: comuna/sector + medidas (mm) + cantidad + color (si aplica) + tipo.",
        { replyToMessageId: messageId }
      );
    } catch (e) {
      console.error("Webhook async error:", e?.message || e);
    }
  });
});

app.listen(PORT, () => {
  console.log("Listening...");
});
