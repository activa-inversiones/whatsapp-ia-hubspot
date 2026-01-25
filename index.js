// index.js (ESM)
// WhatsApp IA Hub - Activa Ventanas (Marcelo Cifuentes)
// - Webhook verify + incoming messages
// - Text + PDF + Image + Audio (Whisper)
// - Quote engine (m²) + PDF generation (pdfkit) + WhatsApp media upload
// - Typing indicator + session memory + loop guard
//
// Node: "type": "module"

import "dotenv/config";
import express from "express";
import axios from "axios";
import OpenAI from "openai";
import pdfParse from "pdf-parse";
import PDFDocument from "pdfkit";
import FormData from "form-data";

const app = express();
app.use(express.json({ limit: "12mb" }));

// =====================
// ENV helpers
// =====================
const env = (k, d = undefined) => process.env[k] ?? d;

const envBool = (k, d = false) => {
  const v = (process.env[k] ?? "").toString().toLowerCase().trim();
  if (!v) return d;
  return ["1", "true", "yes", "y", "on", "si", "sí"].includes(v);
};

const envInt = (k, d) => {
  const n = parseInt(process.env[k] ?? "", 10);
  return Number.isFinite(n) ? n : d;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// =====================
// Required ENV
// =====================
const PORT = envInt("PORT", 8080);

const WHATSAPP_TOKEN = env("WHATSAPP_TOKEN");
const PHONE_NUMBER_ID = env("PHONE_NUMBER_ID");
const VERIFY_TOKEN = env("VERIFY_TOKEN");
const META_GRAPH_VERSION = env("META_GRAPH_VERSION", "v22.0");

const OPENAI_API_KEY = env("OPENAI_API_KEY");

// =====================
// AI config
// =====================
const AI_MODEL_TEXT = env("AI_MODEL_OPENAI", "gpt-4o-mini");
const AI_MODEL_VISION = env("AI_MODEL_VISION", "gpt-4o-mini");
const AI_TEMPERATURE = Number(env("AI_TEMPERATURE", "0.35"));
const AI_MAX_OUTPUT_TOKENS = envInt("AI_MAX_OUTPUT_TOKENS", 380);

// =====================
// Brand / behavior
// =====================
const COMPANY_NAME = env("COMPANY_NAME", "Fábrica de Ventanas Activa");
const AGENT_NAME = env("AGENT_NAME", "Marcelo Cifuentes");
const LANGUAGE = env("LANGUAGE", "es-CL");
const TONO = env("TONO", "usted"); // usted | tu

// Humanization
const TYPING_SIMULATION = envBool("TYPING_SIMULATION", true);
const TYPING_MIN_MS = envInt("TYPING_MIN_MS", 800);
const TYPING_MAX_MS = envInt("TYPING_MAX_MS", 1800);
const WAIT_AFTER_LAST_USER_MESSAGE_MS = envInt("WAIT_AFTER_LAST_USER_MESSAGE_MS", 1200);
const EXTRA_DELAY_MEDIA_MS = envInt("EXTRA_DELAY_MEDIA_MS", 1800);
const MAX_LINES_PER_REPLY = envInt("MAX_LINES_PER_REPLY", 9);
const ONE_QUESTION_PER_TURN = envBool("ONE_QUESTION_PER_TURN", true);

// Guards
const LOOP_GUARD_MAX_REPLIES_PER_5MIN = envInt("LOOP_GUARD_MAX_REPLIES_PER_5MIN", 7);
const REPLY_WITH_CONTEXT = envBool("REPLY_WITH_CONTEXT", true);

// PDF / Voice
const ENABLE_PDF_QUOTES = envBool("ENABLE_PDF_QUOTES", true);
const AUTO_OFFER_PDF = envBool("AUTO_OFFER_PDF", true);
const ENABLE_VOICE_TRANSCRIPTION = envBool("ENABLE_VOICE_TRANSCRIPTION", true);

// =====================
// Pricing (CLP / m²) + VAT
// =====================
const IVA_RATE = Number(env("IVA_RATE", "0.19"));

const PRICE_WHITE_PER_M2 = envInt("PRICE_WHITE_PER_M2", 150000);
const PRICE_WOOD_PER_M2 = envInt("PRICE_WOOD_PER_M2", 160000); // nogal / roble dorado
const PRICE_DARK_PER_M2 = envInt("PRICE_DARK_PER_M2", 170000); // grafito / negro

// Colors
const PVC_EURO_COLORS = ["blanco", "nogal", "roble dorado", "grafito", "negro"];
const PVC_AMER_COLORS = ["blanco"];

// Systems offered
const SYSTEMS = {
  pvc_europeo: "PVC línea europea",
  pvc_americano: "PVC línea americana",
  aluminio: "Aluminio (sin RPT)",
};

// Glass options (no extra cost right now; we “upsell value” in texto)
const GLASS_OPTIONS = ["basico", "low-e", "control solar", "seguridad"];

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
console.log(`ENV AI_MODEL_TEXT: ${AI_MODEL_TEXT}`);
console.log(`ENV AI_MODEL_VISION: ${AI_MODEL_VISION}`);
console.log(`TYPING_SIMULATION: ${TYPING_SIMULATION}`);
console.log(`ENABLE_PDF_QUOTES: ${ENABLE_PDF_QUOTES}`);
console.log(`ENABLE_VOICE_TRANSCRIPTION: ${ENABLE_VOICE_TRANSCRIPTION}`);

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

  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// =====================
// Session store
// =====================
const sessions = new Map(); // key: waId
const processedMsgIds = new Set();
const maxProcessed = 2500;

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      waId,
      createdAt: Date.now(),
      lastSeenAt: 0,
      lastReplyAt: 0,
      repliesIn5Min: [],
      history: [],
      lastQuote: null,
      context: {
        introSent: false,

        // funnel
        stage: "start", // start | collecting | quoted

        // core variables
        city: null,            // Temuco / Pucón / etc.
        installType: null,     // con instalacion / solo fabricacion
        itemsCount: null,      // cantidad total ventanas/puertas

        // defaults
        defaultSystem: null,   // pvc_europeo | pvc_americano | aluminio
        defaultColor: null,    // blanco/nogal/roble dorado/grafito/negro
        defaultGlass: null,    // basico/low-e/control solar/seguridad
        defaultOpeningType: null, // corredera/abatible/proyectante/fija/puerta

        // windows list
        windows: [],           // { wMm, hMm, qty, openingType, system, color, glass }

        // pdf flow
        pdfOffered: false,
        pdfPendingConfirm: false
      },
    });
  }

  const s = sessions.get(waId);

  // harden (avoid undefined.push)
  if (!Array.isArray(s.repliesIn5Min)) s.repliesIn5Min = [];
  if (!Array.isArray(s.history)) s.history = [];
  if (!s.context) s.context = {};
  if (!Array.isArray(s.context.windows)) s.context.windows = [];

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

  if (replyToMessageId && REPLY_WITH_CONTEXT) payload.context = { message_id: replyToMessageId };

  return axios.post(`${WA_BASE}/messages`, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    timeout: 15000,
  });
}

async function waTypingIndicator(messageId, type = "text") {
  // Correct behavior: only run if simulation enabled
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

// Media download
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

// Upload media (PDF) to WhatsApp
async function waUploadMedia(buffer, filename = "document.pdf", mimeType = "application/pdf") {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buffer, { filename, contentType: mimeType });

  const r = await axios.post(`${WA_BASE}/media`, form, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      ...form.getHeaders(),
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 60000,
  });

  return r.data?.id;
}

async function waSendDocument(to, buffer, filename, caption, { replyToMessageId = null } = {}) {
  const mediaId = await waUploadMedia(buffer, filename, "application/pdf");

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: {
      id: mediaId,
      filename: filename || "documento.pdf",
      caption: caption || "",
    },
  };

  if (replyToMessageId && REPLY_WITH_CONTEXT) payload.context = { message_id: replyToMessageId };

  return axios.post(`${WA_BASE}/messages`, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    timeout: 15000,
  });
}

// =====================
// Text normalization helpers
// =====================
function norm(s) {
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isYes(text) {
  const t = norm(text);
  return ["si", "s", "dale", "ok", "oka", "ya", "envia", "enviar", "perfecto"].some(
    (x) => t === x || t.includes(x)
  );
}
function isNo(text) {
  const t = norm(text);
  return ["no", "nop", "despues", "luego", "mas tarde"].some((x) => t === x || t.includes(x));
}

// =====================
// Measurements parsing
// =====================
function toMm(value, unit) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  const u = (unit || "mm").toLowerCase();

  if (u.startsWith("m") && !u.startsWith("mm")) return Math.round(v * 1000);
  if (u.startsWith("cm")) return Math.round(v * 10);
  return Math.round(v); // mm
}

// Extract (w x h) from text
function extractMeasurements(text) {
  const out = [];
  if (!text) return out;

  const clean = norm(text).replace(/,/g, ".");
  const reX = /(\d{1,4}(\.\d{1,3})?)\s*[x×]\s*(\d{1,4}(\.\d{1,3})?)\s*(mm|cm|m)?/g;

  let m;
  while ((m = reX.exec(clean))) {
    const a = m[1];
    const b = m[3];
    const unit = m[5] || "mm";
    const w = toMm(a, unit);
    const h = toMm(b, unit);
    if (w && h) out.push({ wMm: w, hMm: h, raw: m[0] });
  }

  // "ancho 1200 alto 1500"
  const reAH = /(ancho|largo)\s*(\d{1,4}(\.\d{1,3})?)\s*(mm|cm|m)?[\s,;]+(alto|altura)\s*(\d{1,4}(\.\d{1,3})?)\s*(mm|cm|m)?/g;
  while ((m = reAH.exec(clean))) {
    const unit1 = m[4] || "mm";
    const unit2 = m[8] || unit1;
    const w = toMm(m[2], unit1);
    const h = toMm(m[6], unit2);
    if (w && h) out.push({ wMm: w, hMm: h, raw: m[0] });
  }

  return out;
}

// =====================
// Intent parsing (basic)
// =====================
function detectCity(text) {
  const t = norm(text);
  const candidates = [
    "temuco",
    "padre las casas",
    "villarrica",
    "pucon",
    "pucón",
    "collipulli",
    "angol",
    "lautaro",
    "freire",
    "imperial",
    "nueva imperial",
    "labranza"
  ];

  for (const c of candidates) {
    if (t.includes(norm(c))) return c === "pucón" ? "Pucón" : c.replace(/\b\w/g, (x) => x.toUpperCase());
  }
  return null;
}

function detectInstallType(text) {
  const t = norm(text);
  if (t.includes("con instal")) return "con instalacion";
  if (t.includes("sin instal") || t.includes("solo fabric")) return "solo fabricacion";
  return null;
}

function detectSystem(text) {
  const t = norm(text);
  if (t.includes("linea europea") || t.includes("europea") || t.includes("euro")) return "pvc_europeo";
  if (t.includes("linea americana") || t.includes("americano") || t.includes("americana")) return "pvc_americano";
  if (t.includes("aluminio")) return "aluminio";
  if (t.includes("pvc")) return "pvc_europeo"; // default when they say PVC
  return null;
}

function detectOpeningType(text) {
  const t = norm(text);
  if (t.includes("corredera") || t.includes("corrediza")) return "corredera";
  if (t.includes("abatible")) return "abatible";
  if (t.includes("proyectante")) return "proyectante";
  if (t.includes("fija")) return "fija";
  if (t.includes("puerta")) return "puerta";
  return null;
}

function detectGlass(text) {
  const t = norm(text);
  // Clients say "termopanel" meaning DVH (glass). We map as "basico" DVH.
  if (t.includes("termopanel") || t.includes("dvh")) return "basico";
  if (t.includes("low") || t.includes("low-e") || t.includes("baja emis")) return "low-e";
  if (t.includes("control solar") || t.includes("solar")) return "control solar";
  if (t.includes("laminad") || t.includes("seguridad") || t.includes("blindex")) return "seguridad";
  return null;
}

function detectColor(text) {
  const t = norm(text);

  if (t.includes("roble")) return "roble dorado";
  if (t.includes("nogal")) return "nogal";
  if (t.includes("grafito")) return "grafito";
  if (t.includes("negro")) return "negro";
  if (t.includes("blanco")) return "blanco";

  return null;
}

function detectCount(text) {
  const t = norm(text);
  const m = t.match(/(\d{1,3})\s*(ventanas|puertas|unidades|uds|ud)/);
  if (m) return Number(m[1]);

  // "son 2"
  const m2 = t.match(/\bson\s*(\d{1,3})\b/);
  if (m2) return Number(m2[1]);

  return null;
}

// =====================
// Quote engine
// =====================
function colorToTier(color) {
  const c = norm(color || "");
  if (!c) return null;

  if (c === "blanco") return { tier: "blanco", pricePerM2: PRICE_WHITE_PER_M2 };
  if (c === "nogal" || c === "roble dorado") return { tier: "madera", pricePerM2: PRICE_WOOD_PER_M2 };
  if (c === "grafito" || c === "negro") return { tier: "oscuro", pricePerM2: PRICE_DARK_PER_M2 };

  return null;
}

function mmToM2(wMm, hMm) {
  const w = Number(wMm);
  const h = Number(hMm);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 0;
  return (w / 1000) * (h / 1000);
}

function canQuoteNow(session) {
  const c = session.context;
  if (!c?.city) return false;
  if (!Array.isArray(c.windows) || c.windows.length === 0) return false;

  // Need at least: color + system + openingType + glass as defaults or per-window
  const hasColor = !!c.defaultColor || c.windows.some(w => !!w.color);
  const hasSystem = !!c.defaultSystem || c.windows.some(w => !!w.system);
  const hasOpen = !!c.defaultOpeningType || c.windows.some(w => !!w.openingType);
  const hasGlass = !!c.defaultGlass || c.windows.some(w => !!w.glass);

  return hasColor && hasSystem && hasOpen && hasGlass;
}

function computeQuote(session) {
  const c = session.context;
  const windows = (c.windows || []).map((w) => ({
    wMm: w.wMm,
    hMm: w.hMm,
    qty: w.qty ?? 1,
    openingType: w.openingType || c.defaultOpeningType,
    system: w.system || c.defaultSystem,
    color: w.color || c.defaultColor,
    glass: w.glass || c.defaultGlass,
  }));

  // Validate required
  if (!c.city || windows.length === 0) return null;

  // Normalize color based on system constraints:
  for (const w of windows) {
    const sys = w.system || "pvc_europeo";
    const col = w.color || "blanco";
    if (sys === "pvc_americano") {
      // only white
      w.color = "blanco";
    } else {
      // pvc_europeo allows full set; aluminum we keep color as requested (but quote uses tier)
      w.color = col;
    }
  }

  const items = windows.map((w, idx) => {
    const areaOne = mmToM2(w.wMm, w.hMm);
    const areaTotal = areaOne * (w.qty || 1);

    const tier = colorToTier(w.color) || { tier: "blanco", pricePerM2: PRICE_WHITE_PER_M2 };
    const net = Math.round(areaTotal * tier.pricePerM2);

    return {
      n: idx + 1,
      wMm: w.wMm,
      hMm: w.hMm,
      qty: w.qty || 1,
      areaOne,
      areaTotal,
      system: w.system,
      color: w.color,
      openingType: w.openingType,
      glass: w.glass,
      pricePerM2: tier.pricePerM2,
      net,
    };
  });

  const netSubtotal = items.reduce((a, x) => a + x.net, 0);
  const iva = Math.round(netSubtotal * IVA_RATE);
  const total = netSubtotal + iva;

  return {
    company: COMPANY_NAME,
    agent: AGENT_NAME,
    city: c.city,
    installType: c.installType || "por confirmar",
    createdAt: new Date().toISOString(),
    items,
    netSubtotal,
    iva,
    total,
    notes: [
      "Pre-cotización referencial sujeta a confirmación en terreno (niveles, escuadra, condiciones de instalación).",
      "Calidad: sellos perimetrales, herrajes de alto desempeño y DVH (termopanel).",
      "Diferenciador: separador warm-edge Thermoflex (tecnología inglesa) que reduce condensación vs separador de aluminio tradicional."
    ],
  };
}

function moneyCLP(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("es-CL");
}

function quoteToText(quote) {
  const lines = [];
  lines.push(`${COMPANY_NAME} - Pre-cotización referencial`);
  lines.push(`Comuna/Sector: ${quote.city}`);
  lines.push(`Modalidad: ${quote.installType}`);
  lines.push("");

  quote.items.slice(0, 8).forEach((it) => {
    const sysName = SYSTEMS[it.system] || it.system || "PVC línea europea";
    lines.push(
      `${it.n}) ${it.qty}u - ${it.wMm}x${it.hMm}mm (${it.openingType || "apertura"}) - ${sysName} - color ${it.color} - vidrio ${it.glass}`
    );
    lines.push(`   Área total: ${it.areaTotal.toFixed(2)} m² | $${moneyCLP(it.pricePerM2)}/m² | Neto: $${moneyCLP(it.net)}`);
  });

  if (quote.items.length > 8) {
    lines.push(`... +${quote.items.length - 8} ítems adicionales (incluidos en el total).`);
  }

  lines.push("");
  lines.push(`Subtotal Neto: $${moneyCLP(quote.netSubtotal)}`);
  lines.push(`IVA (${Math.round(IVA_RATE * 100)}%): $${moneyCLP(quote.iva)}`);
  lines.push(`Total: $${moneyCLP(quote.total)}`);
  lines.push("");
  lines.push("Thermoflex (warm-edge): reduce condensación y mejora confort térmico.");
  return lines.join("\n");
}

// =====================
// PDF generation (pdfkit)
// =====================
async function generateQuotePDF(waId, quote) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });

    const buffers = [];
    doc.on("data", (d) => buffers.push(d));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    doc.fontSize(18).text(`${COMPANY_NAME}`, { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(12).text(`Pre-cotización referencial`, { align: "center" });
    doc.moveDown(0.7);

    doc.fontSize(10).text(`Atiende: ${AGENT_NAME}`);
    doc.text(`Cliente (WA): ${waId}`);
    doc.text(`Comuna/Sector: ${quote.city}`);
    doc.text(`Modalidad: ${quote.installType}`);
    doc.text(`Fecha: ${new Date().toLocaleString("es-CL")}`);
    doc.moveDown(0.8);

    doc.fontSize(11).text("Detalle:", { underline: true });
    doc.moveDown(0.3);

    quote.items.forEach((it) => {
      const sysName = SYSTEMS[it.system] || it.system || "PVC línea europea";
      doc.fontSize(10).text(
        `${it.n}) ${it.qty}u  ${it.wMm}x${it.hMm}mm  | ${it.openingType || "-"} | ${sysName} | color ${it.color} | vidrio ${it.glass}`
      );
      doc.text(`   Área: ${it.areaTotal.toFixed(2)} m²  | $${moneyCLP(it.pricePerM2)}/m²  | Neto: $${moneyCLP(it.net)}`);
      doc.moveDown(0.2);
    });

    doc.moveDown(0.6);
    doc.fontSize(11).text("Totales:", { underline: true });
    doc.fontSize(10).text(`Subtotal Neto: $${moneyCLP(quote.netSubtotal)}`);
    doc.text(`IVA (${Math.round(IVA_RATE * 100)}%): $${moneyCLP(quote.iva)}`);
    doc.fontSize(11).text(`Total: $${moneyCLP(quote.total)}`);

    doc.moveDown(0.8);
    doc.fontSize(10).text("Notas:", { underline: true });
    quote.notes.forEach((n) => doc.text(`- ${n}`));

    doc.moveDown(0.6);
    doc.fontSize(9).text("Validez: referencial. Se confirma con visita/levantamiento y especificación final.", { align: "left" });

    doc.end();
  });
}

// =====================
// PDF parse
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
// Vision extract (image)
// =====================
async function visionExtract(buffer, mimeType) {
  if (!openai) return "";

  try {
    const b64 = buffer.toString("base64");
    const r = await openai.chat.completions.create({
      model: AI_MODEL_VISION,
      messages: [
        {
          role: "system",
          content:
            "Extrae SOLO datos para cotización de ventanas/puertas: (1) medidas ancho x alto y unidad, (2) cantidad, (3) tipo apertura (corredera/abatible/proyectante/fija/puerta), (4) color si aparece. Si no hay medidas legibles, responde 'sin medidas legibles'.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Analiza la imagen y extrae medidas/cantidad/apertura/color." },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${b64}` } },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 260,
    });

    return r.choices?.[0]?.message?.content?.trim() || "";
  } catch (e) {
    console.error("Vision error:", e?.message || e);
    return "";
  }
}

// =====================
// Whisper transcription (audio)
// =====================
async function transcribeVoice(buffer) {
  if (!openai) return "";
  const file = await OpenAI.toFile(buffer, "voice.ogg");
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
  });
  return (transcription.text || "").trim();
}

// =====================
// AI prompt builder
// =====================
function buildSystemPrompt(session) {
  const c = session.context || {};
  const tono = TONO === "tu" ? "tú" : "usted";

  return [
    `Idioma: ${LANGUAGE}. Tratar al cliente de "${tono}".`,
    ``,
    `Usted es ${AGENT_NAME} de ${COMPANY_NAME}.`,
    `Especialistas en fabricación e instalación de ventanas y puertas. No competimos por precio, competimos por valor y desempeño.`,
    ``,
    `Diferenciadores (mencione cuando aplique, sin exagerar):`,
    `- DVH/Termopanel es el vidrio doble; el marco puede ser PVC europeo, PVC americano o aluminio.`,
    `- Usamos separador warm-edge Thermoflex (tecnología inglesa) para reducir condensación respecto al separador de aluminio tradicional.`,
    `- Sellos perimetrales + herrajes de alto desempeño: confort térmico/acústico y hermeticidad.`,
    ``,
    `Reglas de conversación:`,
    `- Sea directo: evite "muchas gracias" repetidas.`,
    `- No repita preguntas si ya tiene el dato. Use la memoria de sesión.`,
    `- Haga máximo 1 pregunta al final.`,
    `- Si el cliente solo dice "termopanel", explique breve que es el vidrio y luego guíe a marco + color + apertura.`,
    `- Si falta información, pida solo lo mínimo para cotizar.`,
    ``,
    `Datos actuales (si existen):`,
    `- Comuna/sector: ${c.city || "no informado"}`,
    `- Sistema: ${c.defaultSystem ? SYSTEMS[c.defaultSystem] : "no informado"}`,
    `- Color: ${c.defaultColor || "no informado"}`,
    `- Vidrio: ${c.defaultGlass || "no informado"}`,
    `- Apertura: ${c.defaultOpeningType || "no informado"}`,
    `- Nº items detectados: ${(c.windows || []).length}`,
  ].join("\n");
}

// Build minimal next-question (deterministic)
function nextMissingQuestion(session) {
  const c = session.context;

  // Intro
  if (!c.introSent) return { kind: "intro" };

  if (!c.city) return { kind: "ask_city", text: "¿En qué comuna/sector de la Araucanía sería la instalación?" };

  // Need at least one measurement
  if (!c.windows || c.windows.length === 0) {
    return { kind: "ask_measures", text: "Envíeme las medidas en mm (ancho x alto) y la cantidad de ventanas/puertas." };
  }

  // Defaults
  if (!c.defaultSystem) return { kind: "ask_system", text: "¿Prefiere PVC línea europea, PVC línea americana o aluminio?" };

  if (!c.defaultColor) {
    // Provide guided options
    const sys = c.defaultSystem;
    if (sys === "pvc_americano") {
      return { kind: "ask_color", text: "En PVC línea americana trabajamos blanco. ¿Le sirve blanco?" };
    }
    return { kind: "ask_color", text: "¿Color del marco? (PVC europeo: blanco, nogal, roble dorado, grafito o negro)" };
  }

  if (!c.defaultOpeningType) return { kind: "ask_open", text: "¿Tipo de apertura? (corredera, abatible, proyectante, fija o puerta)" };

  if (!c.defaultGlass) return { kind: "ask_glass", text: "¿Vidrio termopanel básico o desea Low-E / Control Solar / Seguridad laminado?" };

  // If quoted, ask installType if missing
  if (!c.installType) return { kind: "ask_install", text: "¿La cotización es con instalación o solo fabricación?" };

  return { kind: "none" };
}

async function aiDraftReply(session, userText, quoteTextOrNull) {
  if (!openai) return null;

  const system = buildSystemPrompt(session);

  const messages = [
    { role: "system", content: system },
    ...session.history.slice(-10).map((h) => ({ role: h.role, content: h.content })),
    {
      role: "user",
      content: [
        `Mensaje del cliente: ${userText || "(vacío)"}`,
        quoteTextOrNull ? `\nContexto: ya existe una pre-cotización.\n${quoteTextOrNull}` : "",
        `\nTarea: Responda como asesor de ventanas (valor y desempeño). Sea breve y avance el flujo con 1 pregunta máximo.`,
      ].join("\n"),
    },
  ];

  try {
    const r = await openai.chat.completions.create({
      model: AI_MODEL_TEXT,
      messages,
      temperature: AI_TEMPERATURE,
      max_tokens: AI_MAX_OUTPUT_TOKENS,
    });

    return r.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error("AI error:", e?.message || e);
    return null;
  }
}

// =====================
// Update session context from text
// =====================
function applyTextToContext(session, text) {
  const c = session.context;
  const t = text || "";

  // city
  c.city = c.city || detectCity(t);

  // install
  c.installType = c.installType || detectInstallType(t);

  // defaults
  c.defaultSystem = c.defaultSystem || detectSystem(t);
  c.defaultOpeningType = c.defaultOpeningType || detectOpeningType(t);
  c.defaultGlass = c.defaultGlass || detectGlass(t);
  c.defaultColor = c.defaultColor || detectColor(t);

  // count
  c.itemsCount = c.itemsCount || detectCount(t);

  // measurements
  const ms = extractMeasurements(t);
  if (ms.length) {
    // If they sent multiple measures, we add windows each with qty=1 by default.
    for (const m of ms) {
      c.windows.push({
        wMm: m.wMm,
        hMm: m.hMm,
        qty: 1,
        openingType: null,
        system: null,
        color: null,
        glass: null
      });
    }
  }

  // If message says "son 2" and we have exactly 1 window, duplicate it
  if (c.itemsCount && c.windows.length === 1 && c.itemsCount > 1) {
    const base = c.windows[0];
    while (c.windows.length < c.itemsCount) c.windows.push({ ...base });
  }

  // If they say "correderas" etc and we have windows without openingType, set default
  const open = detectOpeningType(t);
  if (open) c.defaultOpeningType = c.defaultOpeningType || open;

  // If they say PVC americano and also ask color nogal/grafito -> keep system but normalize later in quote
  // (we handle in computeQuote)
}

// =====================
// Reply scheduler
// =====================
async function scheduleReply(waId, messageId, collectedText, { isMedia = false } = {}) {
  const session = getSession(waId);
  session.lastSeenAt = Date.now();

  // Debounce
  await sleep(WAIT_AFTER_LAST_USER_MESSAGE_MS);
  if (Date.now() - session.lastSeenAt < WAIT_AFTER_LAST_USER_MESSAGE_MS - 100) return;
  if (!loopGuardOk(session)) return;

  const stopTyping = startTypingPinger(messageId, "text");
  try {
    if (isMedia) await sleep(EXTRA_DELAY_MEDIA_MS);
    const typingDelay = Math.floor(
      TYPING_MIN_MS + Math.random() * Math.max(1, (TYPING_MAX_MS - TYPING_MIN_MS))
    );
    await sleep(typingDelay);

    // Apply data to context
    applyTextToContext(session, collectedText);

    // Intro once
    const c = session.context;
    let quoteText = null;

    if (!c.introSent) {
      c.introSent = true;
    }

    // Compute quote if possible
    if (canQuoteNow(session)) {
      const quote = computeQuote(session);
      if (quote) {
        session.lastQuote = quote;
        quoteText = quoteToText(quote);
        c.stage = "quoted";

        // Offer PDF once
        if (ENABLE_PDF_QUOTES && AUTO_OFFER_PDF && !c.pdfOffered) {
          c.pdfOffered = true;
          c.pdfPendingConfirm = true;
          quoteText += `\n\n¿Le envío esta pre-cotización en PDF formal ahora? (Responda: SI / NO)`;
        }
      }
    } else {
      c.stage = "collecting";
    }

    // Deterministic minimum message if no AI
    let fallback = null;
    const missing = nextMissingQuestion(session);

    if (missing.kind === "intro") {
      fallback = [
        `Hola, le habla ${AGENT_NAME} de ${COMPANY_NAME}.`,
        `Para cotizar rápido necesito: comuna/sector + medidas (mm) + color + tipo (corredera/abatible/proyectante/fija/puerta).`,
        `Nota: el “termopanel” es el vidrio; el marco puede ser PVC europeo, PVC americano o aluminio.`,
        ONE_QUESTION_PER_TURN ? `¿En qué comuna/sector sería la instalación?` : ""
      ].filter(Boolean).join("\n");
    } else if (missing.kind !== "none") {
      fallback = missing.text;
    } else if (!quoteText) {
      fallback = "Perfecto. Con lo que ya me indicó puedo avanzar. Envíeme por favor cualquier detalle adicional del tipo de apertura o color si falta.";
    }

    // AI reply
    const aiText = await aiDraftReply(session, collectedText, quoteText);

    let reply = aiText || quoteText || fallback || "Entendido. Envíeme medidas (mm) y comuna/sector para cotizar.";

    // Enforce max lines
    const lines = reply.split("\n").map((l) => l.trim()).filter(Boolean);
    reply = lines.slice(0, MAX_LINES_PER_REPLY).join("\n");

    // Send
    await waSendText(waId, reply, { replyToMessageId: messageId });

    // Save history
    session.history.push({ role: "user", content: collectedText || "" });
    session.history.push({ role: "assistant", content: reply });

    noteReply(session);
  } catch (e) {
    console.error("Send/schedule error:", e?.response?.data || e?.message || e);
  } finally {
    stopTyping();
  }
}

// =====================
// POST /webhook (ACK fast)
// =====================
app.post("/webhook", (req, res) => {
  // Always ACK 200 quickly to Meta
  res.sendStatus(200);

  // Process async to avoid retries/timeouts
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

      // Reset commands
      const incomingTextLower = msg.type === "text" ? norm(msg.text?.body || "") : "";
      if (["reset", "reiniciar", "nuevo", "start", "comenzar"].includes(incomingTextLower)) {
        sessions.delete(waId);
        await waSendText(
          waId,
          `Listo. Reinicié su sesión.\nEnvíeme: comuna/sector + medidas (mm) + color + tipo (corredera/abatible/proyectante/fija/puerta).`,
          { replyToMessageId: messageId }
        );
        return;
      }

      // PDF manual command at any time
      if (ENABLE_PDF_QUOTES && msg.type === "text") {
        const t = norm(msg.text?.body || "");
        if (t === "pdf" || t.includes("enviame el pdf") || t.includes("envie pdf")) {
          if (!session.lastQuote) {
            await waSendText(waId, "Aún no tengo una cotización lista. Envíeme medidas (mm) + color + tipo de apertura.", { replyToMessageId: messageId });
            return;
          }
          const pdfBuffer = await generateQuotePDF(waId, session.lastQuote);
          await waSendDocument(
            waId,
            pdfBuffer,
            `PreCotizacion_${COMPANY_NAME}.pdf`,
            "Adjunto pre-cotización referencial (sujeta a confirmación en terreno).",
            { replyToMessageId: messageId }
          );
          return;
        }
      }

      // PDF confirmation (SI/NO)
      if (ENABLE_PDF_QUOTES && msg.type === "text" && session.context?.pdfPendingConfirm) {
        const bodyText = msg.text?.body || "";

        if (isYes(bodyText)) {
          session.context.pdfPendingConfirm = false;

          if (!session.lastQuote) {
            await waSendText(waId, "Aún no tengo una cotización lista. Envíeme medidas (mm) + color + tipo de apertura.", { replyToMessageId: messageId });
            return;
          }

          const pdfBuffer = await generateQuotePDF(waId, session.lastQuote);
          await waSendDocument(
            waId,
            pdfBuffer,
            `PreCotizacion_${COMPANY_NAME}.pdf`,
            "Adjunto pre-cotización referencial (sujeta a confirmación en terreno).",
            { replyToMessageId: messageId }
          );
          return;
        }

        if (isNo(bodyText)) {
          session.context.pdfPendingConfirm = false;
          await waSendText(waId, "Perfecto. Si más adelante lo necesita, escriba: PDF.", { replyToMessageId: messageId });
          return;
        }
        // If not clear yes/no, continue normal flow below.
      }

      // TEXT
      if (msg.type === "text") {
        await scheduleReply(waId, messageId, msg.text?.body || "");
        return;
      }

      // IMAGE
      if (msg.type === "image") {
        const mediaId = msg.image?.id;
        const mime = msg.image?.mime_type || "image/jpeg";

        await waSendText(waId, "Recibido. Estoy revisando la imagen para extraer medidas y tipo de apertura.", { replyToMessageId: messageId });

        const stopTyping = startTypingPinger(messageId, "text");
        try {
          const url = await waGetMediaUrl(mediaId);
          const bytes = await waDownloadMediaBytes(url);
          const visionText = await visionExtract(bytes, mime);
          const combined = `Imagen analizada.\n${visionText || ""}`.trim();
          await scheduleReply(waId, messageId, combined, { isMedia: true });
        } finally {
          stopTyping();
        }
        return;
      }

      // DOCUMENT
      if (msg.type === "document") {
        const mime = msg.document?.mime_type || "";
        const filename = msg.document?.filename || "archivo";
        const mediaId = msg.document?.id;

        await waSendText(waId, `Recibido "${filename}". Estoy revisándolo para extraer especificación/medidas.`, { replyToMessageId: messageId });

        const stopTyping = startTypingPinger(messageId, "text");
        try {
          const url = await waGetMediaUrl(mediaId);
          const bytes = await waDownloadMediaBytes(url);

          let parsedText = "";
          if (mime.includes("pdf")) parsedText = await parsePdfText(bytes);

          const combined = [
            `Documento recibido: ${filename}.`,
            parsedText ? `Texto extraído (resumen):\n${parsedText.slice(0, 2500)}` : "",
          ].filter(Boolean).join("\n\n");

          await scheduleReply(waId, messageId, combined, { isMedia: true });
        } finally {
          stopTyping();
        }
        return;
      }

      // AUDIO (Whisper)
      if (msg.type === "audio" && ENABLE_VOICE_TRANSCRIPTION) {
        const mediaId = msg.audio?.id;

        await waSendText(waId, "Recibido. Estoy transcribiendo su audio para continuar.", { replyToMessageId: messageId });

        const stopTyping = startTypingPinger(messageId, "text");
        try {
          const url = await waGetMediaUrl(mediaId);
          const bytes = await waDownloadMediaBytes(url);

          const transcript = await transcribeVoice(bytes);
          const combined = transcript ? `Audio transcrito: ${transcript}` : "Audio transcrito: (no se logró entender claramente)";

          await scheduleReply(waId, messageId, combined, { isMedia: true });
        } catch (e) {
          console.error("Audio error:", e?.message || e);
          await waSendText(waId, "Tuve un problema leyendo el audio. ¿Puede enviarme el texto por WhatsApp?", { replyToMessageId: messageId });
        } finally {
          stopTyping();
        }
        return;
      }

      // Fallback
      await waSendText(
        waId,
        "Recibido. Puedo ayudar mejor con texto, imágenes, PDF o audios. Envíeme comuna/sector + medidas (mm) + color + tipo de apertura.",
        { replyToMessageId: messageId }
      );
    } catch (e) {
      console.error("Webhook process error:", e?.message || e);
    }
  });
});

// =====================
// Start server
// =====================
app.listen(PORT, () => {
  console.log("Listening...");
});
