import express from "express";
import axios from "axios";
import OpenAI from "openai";
import pdfParse from "pdf-parse";
import PDFDocument from "pdfkit";
import FormData from "form-data";

const app = express();
app.use(express.json({ limit: "20mb" }));

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

// =====================
// AI config
// =====================
const AI_MODEL_OPENAI = env("AI_MODEL_OPENAI", "gpt-4.1-mini");
const AI_MODEL_VISION = env("AI_MODEL_VISION", "gpt-4o-mini");
const AI_TEMPERATURE = Number(env("AI_TEMPERATURE", "0.25"));
const AI_MAX_OUTPUT_TOKENS = envInt("AI_MAX_OUTPUT_TOKENS", 520);

// =====================
// Brand / style
// =====================
const COMPANY_NAME = env("COMPANY_NAME", "Activa");
const AGENT_NAME = env("AGENT_NAME", "Marcelo Cifuentes");
const LANGUAGE = env("LANGUAGE", "es-CL");
const TONO = env("TONO", "usted");

// Propuesta de valor (sin cifras duras)
const VALUE_PITCH = env(
  "VALUE_PITCH",
  "Nos diferenciamos por calidad y confort: hermeticidad, herrajes y un termopanel bien especificado. Usamos separador warm-edge Thermoflex (tecnología inglesa), que reduce la condensación frente al separador de aluminio tradicional."
);

// =====================
// Pacing / UX
// =====================
const WAIT_AFTER_LAST_USER_MESSAGE_MS = envInt("WAIT_AFTER_LAST_USER_MESSAGE_MS", 1200);
const EXTRA_DELAY_MEDIA_MS = envInt("EXTRA_DELAY_MEDIA_MS", 1500);
const TYPING_SIMULATION = envBool("TYPING_SIMULATION", true);
const TYPING_MIN_MS = envInt("TYPING_MIN_MS", 650);
const TYPING_MAX_MS = envInt("TYPING_MAX_MS", 1500);
const MAX_LINES_PER_REPLY = envInt("MAX_LINES_PER_REPLY", 7);
const ONE_QUESTION_PER_TURN = envBool("ONE_QUESTION_PER_TURN", true);
const LOOP_GUARD_MAX_REPLIES_PER_5MIN = envInt("LOOP_GUARD_MAX_REPLIES_PER_5MIN", 8);
const REPLY_WITH_CONTEXT = envBool("REPLY_WITH_CONTEXT", true);

// PDF quotes
const ENABLE_PDF_QUOTES = envBool("ENABLE_PDF_QUOTES", true);

// =====================
// Pricing (m² neto + IVA)
// =====================
const IVA_RATE = Number(env("IVA_RATE", "0.19"));
const ROUND_TO = envInt("ROUND_TO", 1000);

const PRICE_M2 = {
  blanco: envInt("PRICE_M2_WHITE", 150000),
  nogal_roble: envInt("PRICE_M2_WOOD", 160000),
  grafito_negro: envInt("PRICE_M2_DARK", 170000),
};

// Opcionales de vidrio (para futuro; por ahora "básico" = 0)
const GLASS_UPCHARGE_M2 = {
  basico: envInt("GLASS_UPCHARGE_BASIC", 0),
  lowe: envInt("GLASS_UPCHARGE_LOWE", 0),
  controlsolar: envInt("GLASS_UPCHARGE_SOLAR", 0),
  laminado: envInt("GLASS_UPCHARGE_LAMINATED", 0),
};

// =====================
// Catálogo colores por sistema
// =====================
const COLORS_PVC_EURO = ["blanco", "roble dorado", "nogal", "grafito", "negro"];
const COLORS_PVC_US = ["blanco"];

// =====================
// OpenAI client
// =====================
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// =====================
// Logs
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
console.log(`ENABLE_PDF_QUOTES: ${ENABLE_PDF_QUOTES}`);
console.log(`PRICE_M2:`, PRICE_M2);

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
// Utils
// =====================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || "").toString().trim().toLowerCase();

function roundTo(n, base = 1000) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n / base) * base;
}
function moneyCLP(n) {
  const v = Math.max(0, Math.round(n || 0));
  return v.toLocaleString("es-CL");
}
function areaM2FromMm(w, h) {
  const wm = Number(w) / 1000;
  const hm = Number(h) / 1000;
  const a = wm * hm;
  return Number.isFinite(a) ? a : 0;
}
function ensureArray(x) {
  return Array.isArray(x) ? x : [];
}

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

/**
 * Typing indicator
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

// Upload media (PDF)
async function waUploadMedia(buffer, mimeType, filename) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buffer, { filename, contentType: mimeType });

  const r = await axios.post(`${WA_BASE}/media`, form, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, ...form.getHeaders() },
    maxBodyLength: Infinity,
    timeout: 30000,
  });
  return r.data?.id;
}

async function waSendDocument(to, fileBuffer, filename, caption = "", { replyToMessageId = null } = {}) {
  const mediaId = await waUploadMedia(fileBuffer, "application/pdf", filename);
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: { id: mediaId, filename, caption: caption || undefined },
  };
  if (replyToMessageId && REPLY_WITH_CONTEXT) payload.context = { message_id: replyToMessageId };

  return axios.post(`${WA_BASE}/messages`, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    timeout: 15000,
  });
}

// Media download (images/docs)
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
// Session store + dedupe + guard
// =====================
const sessions = new Map();
const processedMsgIds = new Set();
const maxProcessed = 3000;

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      waId,
      createdAt: Date.now(),
      lastSeenAt: 0,
      repliesIn5Min: [],
      history: [],
      context: {
        introSent: false,
        stage: "start", // start -> got_city -> got_items -> got_measures -> got_opening -> got_system -> got_color -> got_glass -> got_install -> quoted
        city: null,
        itemsCount: null,
        windows: [], // [{w,h,openingType,system,color,glass}]
        defaultOpeningType: null,
        defaultSystem: null,
        defaultColor: null,
        defaultGlass: "basico",
        installType: null,
      },
      lastQuote: null,
    });
  }

  const s = sessions.get(waId);
  s.repliesIn5Min = ensureArray(s.repliesIn5Min);
  s.history = ensureArray(s.history);
  s.context = s.context || {};
  s.context.windows = ensureArray(s.context.windows);
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
}

// =====================
// Extraction helpers
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

  // 1200x1500 mm|cm|m
  const reX = /(\d{2,4}(\.\d{1,3})?)\s*[x×]\s*(\d{2,4}(\.\d{1,3})?)\s*(mm|cm|m)?/g;
  let m;
  while ((m = reX.exec(clean))) {
    const w = toMm(m[1], m[5] || "mm");
    const h = toMm(m[3], m[5] || "mm");
    if (w && h) out.push({ w, h, unit: "mm", raw: m[0] });
  }
  return out;
}

function detectOpeningType(text) {
  const t = norm(text);
  if (t.includes("corredera") || t.includes("corrediza")) return "corredera";
  if (t.includes("abatible")) return "abatible";
  if (t.includes("proyectante") || t.includes("proyect")) return "proyectante";
  if (t.includes("fija")) return "fija";
  if (t.includes("puerta")) return "puerta";
  return null;
}

function detectSystem(text) {
  const t = norm(text);
  if (t.includes("europe") || t.includes("línea europea") || t.includes("linea europea") || t.includes("pvc europeo"))
    return "pvc_europeo";
  if (t.includes("american") || t.includes("línea americana") || t.includes("linea americana") || t.includes("pvc americano"))
    return "pvc_americano";
  if (t.includes("aluminio")) return "aluminio";
  return null;
}

function detectColor(text) {
  const t = norm(text);
  if (t.includes("roble dorado")) return "roble dorado";
  if (t.includes("nogal")) return "nogal";
  if (t.includes("grafito")) return "grafito";
  if (t.includes("negro")) return "negro";
  if (t.includes("blanco")) return "blanco";
  return null;
}

function detectGlass(text) {
  const t = norm(text);
  if (t.includes("low-e") || t.includes("lowe")) return "lowe";
  if (t.includes("control solar") || t.includes("solar")) return "controlsolar";
  if (t.includes("laminado") || t.includes("seguridad") || t.includes("blindex")) return "laminado";
  if (t.includes("basico") || t.includes("normal")) return "basico";
  if (t.includes("termopanel") || t.includes("dvh")) return "basico"; // por defecto
  return null;
}

function detectInstallType(text) {
  const t = norm(text);
  if (t.includes("con instalación") || t.includes("con instalacion") || t.includes("instalación") || t.includes("instalacion"))
    return "con_instalacion";
  if (t.includes("solo fabricación") || t.includes("solo fabricacion") || t.includes("solo fabrica"))
    return "solo_fabricacion";
  if (t.includes("recambio") || t.includes("reemplazo")) return "recambio";
  if (t.includes("obra nueva") || t.includes("nuevo")) return "obra_nueva";
  return null;
}

function detectCity(text, currentCity) {
  if (currentCity) return currentCity;
  const raw = (text || "").trim();
  const tl = norm(raw);

  const m = tl.match(/\ben\s+([a-záéíóúñ\s]{3,24})\b/i);
  if (m?.[1]) return m[1].trim();

  if (raw.length <= 24 && !/\d/.test(raw) && raw.split(/\s+/).length <= 4) return raw;
  return null;
}

function detectItemsCount(text) {
  const t = norm(text);
  // "son 2", "2 ventanas", "necesito 7 ventanas"
  const m = t.match(/\b(\d{1,2})\s*(ventanas|puertas|items|ítems|aberturas|aperturas)\b/);
  if (m?.[1]) return Math.max(1, Math.min(50, parseInt(m[1], 10)));
  const m2 = t.match(/\bson\s+(\d{1,2})\b/);
  if (m2?.[1]) return Math.max(1, Math.min(50, parseInt(m2[1], 10)));
  return null;
}

// =====================
// Pricing engine
// =====================
function colorGroup(color) {
  const c = norm(color);
  if (!c) return "blanco";
  if (c === "blanco") return "blanco";
  if (c === "nogal" || c === "roble dorado") return "nogal_roble";
  if (c === "grafito" || c === "negro") return "grafito_negro";
  return "blanco";
}
function getRateByColor(color) {
  const g = colorGroup(color);
  return PRICE_M2[g] ?? PRICE_M2.blanco;
}
function glassUpcharge(glassKey) {
  const k = norm(glassKey || "basico");
  return GLASS_UPCHARGE_M2[k] ?? 0;
}

function computeQuote(session) {
  const c = session.context;
  const windows = ensureArray(c.windows);
  if (!windows.length) return null;

  const items = windows.map((w, idx) => {
    const area = areaM2FromMm(w.w, w.h);
    const rate = getRateByColor(w.color || c.defaultColor || "blanco");
    const up = glassUpcharge(w.glass || c.defaultGlass || "basico");
    const netRaw = area * (rate + up);

    return {
      idx: idx + 1,
      w: w.w,
      h: w.h,
      area_m2: area,
      openingType: w.openingType || c.defaultOpeningType || "N/I",
      system: w.system || c.defaultSystem || "N/I",
      color: w.color || c.defaultColor || "blanco",
      glass: w.glass || c.defaultGlass || "basico",
      rate_m2: rate,
      upcharge_m2: up,
      net: roundTo(netRaw, ROUND_TO),
    };
  });

  const subtotalNet = roundTo(items.reduce((a, b) => a + b.net, 0), ROUND_TO);
  const iva = roundTo(subtotalNet * IVA_RATE, ROUND_TO);
  const total = roundTo(subtotalNet + iva, ROUND_TO);

  return {
    meta: {
      city: c.city || null,
      installType: c.installType || null,
      iva_rate: IVA_RATE,
      round_to: ROUND_TO,
    },
    items,
    totals: { subtotalNet, iva, total },
    notes: [
      "Pre-cotización referencial sujeta a confirmación en terreno.",
      "Puede variar por refuerzos, herrajes, condición del vano, altura de instalación y tipo de montaje (recambio/obra nueva).",
    ],
  };
}

function quoteToText(quote) {
  const m = quote.meta;
  const lines = [];

  lines.push(`${COMPANY_NAME} • Pre-cotización referencial (fabricación)`);
  if (m.city) lines.push(`• Comuna/sector: ${m.city}`);
  if (m.installType) lines.push(`• Modalidad: ${m.installType}`);
  lines.push("");

  quote.items.forEach((it) => {
    lines.push(
      `${it.idx}) ${it.w}x${it.h} mm (${it.area_m2.toFixed(2)} m²) • ${it.openingType} • ${it.system}`
    );
    lines.push(
      `   Color: ${it.color} | Vidrio: ${it.glass} | Neto: $${moneyCLP(it.net)}`
    );
  });

  lines.push("");
  lines.push(`Subtotal neto: $${moneyCLP(quote.totals.subtotalNet)}`);
  lines.push(`IVA: $${moneyCLP(quote.totals.iva)}`);
  lines.push(`Total: $${moneyCLP(quote.totals.total)}`);
  lines.push("");
  lines.push(`Diferenciación: ${VALUE_PITCH}`);
  lines.push("Si desea el detalle en PDF, escriba: PDF");

  return lines.join("\n");
}

// =====================
// PDF generator
// =====================
async function generateQuotePDF(waId, quote) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    doc.fontSize(18).text(`${COMPANY_NAME} - Pre-cotización`, { align: "center" });
    doc.moveDown(0.5);

    doc.fontSize(11).text(`Asesor: ${AGENT_NAME}`);
    doc.text(`Cliente (WhatsApp): ${waId}`);
    doc.text(`Comuna/sector: ${quote.meta.city || "N/I"}`);
    doc.text(`Modalidad: ${quote.meta.installType || "N/I"}`);
    doc.moveDown();

    doc.fontSize(12).text("Ítems", { underline: true });
    doc.moveDown(0.3);

    quote.items.forEach((it) => {
      doc.fontSize(11).text(
        `${it.idx}) ${it.w} x ${it.h} mm | ${it.area_m2.toFixed(2)} m² | ${it.openingType} | ${it.system}`
      );
      doc.fontSize(10).text(
        `   Color: ${it.color} | Vidrio: ${it.glass} | Neto: $${moneyCLP(it.net)}`
      );
      doc.moveDown(0.2);
    });

    doc.moveDown();
    doc.fontSize(12).text("Totales", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(11).text(`Subtotal neto: $${moneyCLP(quote.totals.subtotalNet)}`);
    doc.fontSize(11).text(`IVA: $${moneyCLP(quote.totals.iva)}`);
    doc.fontSize(11).text(`Total: $${moneyCLP(quote.totals.total)}`);

    doc.moveDown();
    doc.fontSize(11).text("Notas", { underline: true });
    doc.moveDown(0.2);
    quote.notes.forEach((n) => doc.fontSize(10).text(`- ${n}`));

    doc.moveDown();
    doc.fontSize(11).text("Propuesta de valor", { underline: true });
    doc.moveDown(0.2);
    doc.fontSize(10).text(VALUE_PITCH);

    doc.end();
  });
}

// =====================
// PDF parse + Vision extract
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
            "Extrae SOLO: (1) medidas (ancho x alto) y unidad, (2) tipo (corredera/abatible/proyectante/fija/puerta), (3) si dice color. Si no hay medidas legibles: 'sin medidas legibles'.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Analiza y extrae medidas/tipo/color." },
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
// Conversational flow (stages)
// =====================
function introMessage() {
  return [
    `Hola, soy ${AGENT_NAME} de ${COMPANY_NAME} (fábrica e instalación de ventanas y puertas).`,
    `Para cotizar rápido, envíeme: comuna/sector + cantidad + medidas (mm) + tipo (corredera/abatible/proyectante/fija/puerta) + color.`,
    `Nota: el “termopanel” es el vidrio doble (DVH); el marco puede ser PVC o aluminio. ${VALUE_PITCH}`,
  ].join("\n");
}

function validateColorAgainstSystem(color, system) {
  const c = norm(color);
  if (!c || !system) return null;

  if (system === "pvc_americano") {
    if (!COLORS_PVC_US.includes(c)) return `En PVC línea americana el color disponible es blanco.`;
  }
  if (system === "pvc_europeo") {
    if (!COLORS_PVC_EURO.includes(c)) {
      return `En PVC línea europea trabajamos: ${COLORS_PVC_EURO.join(", ")}.`;
    }
  }
  return null;
}

function buildNextQuestion(session) {
  const c = session.context;

  if (!c.city) return "¿En qué comuna/sector de La Araucanía se instalarán?";
  if (!c.itemsCount) return "¿Cuántas ventanas/puertas son en total?";
  if (!c.windows.length) return "Envíeme las medidas en mm (ej: 1200x1500). Puede mandar varias en un mensaje.";
  if (!c.defaultOpeningType) return "¿Qué tipo son: corredera, abatible, proyectante, fija o puerta?";
  if (!c.defaultSystem) return "¿Marco en PVC línea europea, PVC línea americana o aluminio?";
  if (!c.defaultColor) {
    // si ya eligió sistema, sugerir colores correctos
    if (c.defaultSystem === "pvc_americano") return "¿Color blanco (PVC americano)?";
    return "¿Color blanco, nogal, roble dorado, grafito o negro?";
  }
  if (!c.defaultGlass) return "¿Vidrio básico (DVH estándar) o desea Low-E / Control Solar / Laminado?";
  if (!c.installType) return "¿Lo necesita con instalación o solo fabricación?";
  return null;
}

function canQuoteNow(session) {
  const c = session.context;
  if (!c.windows.length) return false;
  if (!c.defaultColor) return false; // porque el precio depende de color
  return true;
}

function normalizeWindows(session) {
  const c = session.context;
  c.windows = ensureArray(c.windows).map((w) => ({
    w: w.w,
    h: w.h,
    openingType: w.openingType || c.defaultOpeningType || null,
    system: w.system || c.defaultSystem || null,
    color: w.color || c.defaultColor || null,
    glass: w.glass || c.defaultGlass || "basico",
  }));
}

// =====================
// IA para mejorar respuestas (sin cambiar reglas)
// =====================
function buildSystemPrompt(session) {
  const tono = TONO === "tu" ? "tú" : "usted";
  const c = session.context;

  const measures = ensureArray(c.windows)
    .slice(0, 6)
    .map((w) => `${w.w}x${w.h}`)
    .join(", ");

  return `
Idioma: ${LANGUAGE}. Tratar al cliente de "${tono}".
Eres ${AGENT_NAME} de ${COMPANY_NAME}.
Objetivo: respuesta corta, humana, consultiva y orientada a valor (no precio).
Reglas:
- Máximo ${MAX_LINES_PER_REPLY} líneas.
- Máximo 1 pregunta al final (si falta dato).
- No abuse de "gracias".
- Si el cliente dice "termopanel": aclare 1 línea que es el vidrio; el marco puede ser PVC europeo/americano o aluminio.
- Propuesta de valor: mencionar Thermoflex solo si agrega valor.
Datos actuales:
- comuna: ${c.city || "N/I"}
- cantidad: ${c.itemsCount || "N/I"}
- medidas: ${measures || "N/I"}
- tipo: ${c.defaultOpeningType || "N/I"}
- sistema: ${c.defaultSystem || "N/I"}
- color: ${c.defaultColor || "N/I"}
- vidrio: ${c.defaultGlass || "N/I"}
- instalación: ${c.installType || "N/I"}
`.trim();
}

async function aiImprove(session, userText, draft, nextQuestion) {
  if (!openai) return draft;

  const system = buildSystemPrompt(session);
  const user = `
Mensaje cliente:
${userText || "(vacío)"}

Borrador:
${draft}

Siguiente pregunta (si aplica):
${nextQuestion || "NINGUNA"}

Tarea:
- Mejora el borrador manteniendo el mismo sentido.
- Si hay pregunta, deje SOLO esa pregunta al final.
- Mantenga tono profesional, claro y breve.
`.trim();

  const r = await openai.chat.completions.create({
    model: AI_MODEL_OPENAI,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: AI_TEMPERATURE,
    max_tokens: AI_MAX_OUTPUT_TOKENS,
  });

  return r.choices?.[0]?.message?.content?.trim() || draft;
}

// =====================
// Main scheduler
// =====================
async function scheduleReply(waId, messageId, incomingText, { isMedia = false } = {}) {
  const session = getSession(waId);
  session.lastSeenAt = Date.now();
  await sleep(WAIT_AFTER_LAST_USER_MESSAGE_MS);
  if (!loopGuardOk(session)) return;

  const stopTyping = startTypingPinger(messageId, "text");
  const typingDelay = Math.floor(
    TYPING_MIN_MS + Math.random() * (Math.max(TYPING_MAX_MS, TYPING_MIN_MS + 50) - TYPING_MIN_MS)
  );

  if (isMedia) await sleep(EXTRA_DELAY_MEDIA_MS);
  await sleep(typingDelay);

  const text = (incomingText || "").trim();

  // 1) Intro
  let draft = "";
  if (!session.context.introSent) {
    draft = introMessage();
    session.context.introSent = true;
  }

  // 2) Extract & update context
  const c = session.context;

  c.city = detectCity(text, c.city) || c.city;

  const cnt = detectItemsCount(text);
  if (cnt) c.itemsCount = cnt;

  const measures = extractMeasurements(text);
  if (measures.length) {
    // Si el cliente manda 2 medidas en un mensaje, agregamos 2 items
    measures.forEach((m) => {
      c.windows.push({ w: m.w, h: m.h });
    });
  }

  const ot = detectOpeningType(text);
  if (ot) c.defaultOpeningType = ot;

  const sys = detectSystem(text);
  if (sys) c.defaultSystem = sys;

  const col = detectColor(text);
  if (col) c.defaultColor = col;

  const g = detectGlass(text);
  if (g) c.defaultGlass = g;

  const inst = detectInstallType(text);
  if (inst) c.installType = inst;

  // Normalizar ventanas para que hereden defaults
  normalizeWindows(session);

  // 3) Validaciones de coherencia (color vs sistema)
  const colorWarn = validateColorAgainstSystem(c.defaultColor, c.defaultSystem);
  if (colorWarn) {
    const q = buildNextQuestion(session);
    const msg = [draft, colorWarn, q].filter(Boolean).join("\n");
    const final = await aiImprove(session, text, msg, q);

    await waSendText(waId, limitLines(final), { replyToMessageId: messageId });
    session.history.push({ role: "user", content: text });
    session.history.push({ role: "assistant", content: final });
    noteReply(session);
    stopTyping();
    return;
  }

  // 4) Si ya podemos cotizar, cotizamos
  let quoteText = "";
  if (canQuoteNow(session)) {
    const quote = computeQuote(session);
    if (quote) {
      session.lastQuote = quote;
      quoteText = quoteToText(quote);
      c.stage = "quoted";
    }
  }

  // 5) Armar pregunta siguiente (solo 1)
  const nextQ = buildNextQuestion(session);

  // 6) Mensaje final base
  let base = "";
  if (quoteText) {
    // si cotiza, no saturar; pregunta solo si falta algo relevante (instalación/comuna ya idealmente está)
    base = [draft, quoteText, nextQ ? `\n${nextQ}` : ""].filter(Boolean).join("\n");
  } else {
    base = [draft, nextQ || "Envíeme medidas (mm) + color para cotizar por m²."].filter(Boolean).join("\n");
  }

  // 7) Mejorar con IA
  let reply = base;
  try {
    reply = await aiImprove(session, text, base, nextQ);
  } catch (e) {
    console.error("AI error:", e?.message || e);
  }

  // 8) Enviar
  try {
    await waSendText(waId, limitLines(reply), { replyToMessageId: messageId });
    session.history.push({ role: "user", content: text });
    session.history.push({ role: "assistant", content: reply });
    noteReply(session);
  } catch (e) {
    console.error("Send error:", e?.response?.data || e?.message || e);
  } finally {
    stopTyping();
  }
}

function limitLines(text) {
  const lines = (text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(0, MAX_LINES_PER_REPLY).join("\n");
}

// =====================
// Webhook receiver (POST)
// =====================
app.post("/webhook", async (req, res) => {
  // responder rápido
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

    // Reset
    const txtLower = msg.type === "text" ? norm(msg.text?.body || "") : "";
    if (["reset", "reiniciar", "nuevo", "start", "comenzar"].includes(txtLower)) {
      sessions.delete(waId);
      await waSendText(
        waId,
        `Listo. Reinicié su sesión.\nEnvíeme: comuna/sector + cantidad + medidas (mm) + tipo + sistema + color.`,
        { replyToMessageId: messageId }
      );
      return;
    }

    // PDF
    if (ENABLE_PDF_QUOTES && msg.type === "text" && ["pdf", "cotizacion pdf", "cotización pdf"].includes(txtLower)) {
      const session = getSession(waId);
      if (!session.lastQuote) {
        await waSendText(
          waId,
          "Aún no tengo una cotización generada. Envíeme al menos: medidas (mm) + color (blanco/nogal/roble dorado/grafito/negro).",
          { replyToMessageId: messageId }
        );
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

    // TEXT
    if (msg.type === "text") {
      await scheduleReply(waId, messageId, msg.text?.body || "");
      return;
    }

    // IMAGE
    if (msg.type === "image") {
      const mediaId = msg.image?.id;
      const mime = msg.image?.mime_type || "image/jpeg";
      await waSendText(waId, "Recibido. Revisaré la imagen para extraer medidas y tipo.", { replyToMessageId: messageId });

      const stopTyping = startTypingPinger(messageId, "text");
      try {
        const url = await waGetMediaUrl(mediaId);
        const bytes = await waDownloadMediaBytes(url);
        const extracted = await visionExtract(bytes, mime);
        const combined = `Imagen:\n${extracted || ""}`.trim();
        await scheduleReply(waId, messageId, combined, { isMedia: true });
      } finally {
        stopTyping();
      }
      return;
    }

    // DOCUMENT (PDF)
    if (msg.type === "document") {
      const mime = msg.document?.mime_type || "";
      const filename = msg.document?.filename || "archivo";
      const mediaId = msg.document?.id;

      await waSendText(waId, `Recibido "${filename}". Revisaré el documento para extraer medidas.`, { replyToMessageId: messageId });

      const stopTyping = startTypingPinger(messageId, "text");
      try {
        const url = await waGetMediaUrl(mediaId);
        const bytes = await waDownloadMediaBytes(url);

        let parsed = "";
        if (mime.includes("pdf")) parsed = await parsePdfText(bytes);

        const combined = [
          `Documento: ${filename}`,
          parsed ? `Texto (resumen): ${parsed.slice(0, 1200)}` : "",
        ].filter(Boolean).join("\n");

        await scheduleReply(waId, messageId, combined, { isMedia: true });
      } finally {
        stopTyping();
      }
      return;
    }

    await waSendText(
      waId,
      "Recibido. Puedo ayudar mejor con texto, imágenes o PDF. Envíeme medidas (mm) + color para cotizar por m².",
      { replyToMessageId: messageId }
    );
  } catch (e) {
    console.error("Webhook error:", e?.message || e);
  }
});

// =====================
// Start
// =====================
app.listen(PORT, () => console.log("Listening..."));
