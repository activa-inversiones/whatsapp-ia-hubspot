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
// ENV
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

const PORT = envInt("PORT", 8080);

const WHATSAPP_TOKEN = env("WHATSAPP_TOKEN");
const PHONE_NUMBER_ID = env("PHONE_NUMBER_ID");
const VERIFY_TOKEN = env("VERIFY_TOKEN");
const META_GRAPH_VERSION = env("META_GRAPH_VERSION", "v22.0");

const OPENAI_API_KEY = env("OPENAI_API_KEY");
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const AI_MODEL_TEXT = env("AI_MODEL_OPENAI", "gpt-4o-mini");
const AI_MODEL_VISION = env("AI_MODEL_VISION", "gpt-4o-mini");
const AI_TEMPERATURE = Number(env("AI_TEMPERATURE", "0.35"));
const AI_MAX_OUTPUT_TOKENS = envInt("AI_MAX_OUTPUT_TOKENS", 380);

// comportamiento
const COMPANY_NAME = env("COMPANY_NAME", "Fábrica de Ventanas Activa");
const AGENT_NAME = env("AGENT_NAME", "Marcelo Cifuentes");
const LANGUAGE = env("LANGUAGE", "es-CL");
const TONO = env("TONO", "usted");

const TYPING_SIMULATION = envBool("TYPING_SIMULATION", true);
const WAIT_AFTER_LAST_USER_MESSAGE_MS = envInt("WAIT_AFTER_LAST_USER_MESSAGE_MS", 900);
const EXTRA_DELAY_MEDIA_MS = envInt("EXTRA_DELAY_MEDIA_MS", 1600);
const MAX_LINES_PER_REPLY = envInt("MAX_LINES_PER_REPLY", 9);
const LOOP_GUARD_MAX_REPLIES_PER_5MIN = envInt("LOOP_GUARD_MAX_REPLIES_PER_5MIN", 7);

const ENABLE_PDF_QUOTES = envBool("ENABLE_PDF_QUOTES", true);
const ENABLE_VOICE_TRANSCRIPTION = envBool("ENABLE_VOICE_TRANSCRIPTION", true);

const IVA_RATE = Number(env("IVA_RATE", "0.19"));
const PRICE_WHITE_PER_M2 = envInt("PRICE_WHITE_PER_M2", 150000);
const PRICE_WOOD_PER_M2 = envInt("PRICE_WOOD_PER_M2", 160000);
const PRICE_DARK_PER_M2 = envInt("PRICE_DARK_PER_M2", 170000);

// =====================
// Logs
// =====================
console.log("Starting Container");
console.log(`Server running on port ${PORT}`);
console.log(`ENV WHATSAPP_TOKEN: ${WHATSAPP_TOKEN ? "OK" : "MISSING"}`);
console.log(`ENV PHONE_NUMBER_ID: ${PHONE_NUMBER_ID ? "OK" : "MISSING"}`);
console.log(`ENV VERIFY_TOKEN: ${VERIFY_TOKEN ? "OK" : "MISSING"}`);
console.log(`ENV OPENAI_API_KEY: ${OPENAI_API_KEY ? "OK" : "MISSING"}`);
console.log(`ENV META_GRAPH_VERSION: ${META_GRAPH_VERSION}`);
console.log(`AI_MODEL_TEXT: ${AI_MODEL_TEXT}`);
console.log(`ENABLE_PDF_QUOTES: ${ENABLE_PDF_QUOTES}`);
console.log(`ENABLE_VOICE_TRANSCRIPTION: ${ENABLE_VOICE_TRANSCRIPTION}`);

app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", (req, res) => res.status(200).json({ ok: true }));

// =====================
// Webhook verify
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
const sessions = new Map();
const processedMsgIds = new Set();
const maxProcessed = 2500;

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      waId,
      lastSeenAt: 0,
      lastReplyAt: 0,
      repliesIn5Min: [],
      history: [],
      lastQuote: null,
      context: {
        introSent: false,
        stage: "start",

        city: null,
        installType: null, // "con instalacion" | "solo fabricacion" | null
        itemsCount: null,

        defaultSystem: null, // pvc_europeo | pvc_americano | aluminio
        defaultColor: null,  // blanco/nogal/roble dorado/grafito/negro
        defaultGlass: null,  // basico/low-e/control solar/seguridad
        defaultOpeningType: null, // corredera/abatible/proyectante/fija/puerta

        windows: [],

        pdfPendingConfirm: false
      },
    });
  }

  const s = sessions.get(waId);
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
// WhatsApp API
// =====================
const WA_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}/${PHONE_NUMBER_ID}`;

async function waSendText(to, text, { replyToMessageId = null } = {}) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };
  if (replyToMessageId) payload.context = { message_id: replyToMessageId };

  return axios.post(`${WA_BASE}/messages`, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    timeout: 15000,
  });
}

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
    if (Date.now() - startedAt > maxMs) return clearInterval(timer);
    waTypingIndicator(messageId, type).catch(() => {});
  }, intervalMs);

  return () => clearInterval(timer);
}

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

async function waUploadMedia(buffer, filename = "document.pdf", mimeType = "application/pdf") {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buffer, { filename, contentType: mimeType });

  const r = await axios.post(`${WA_BASE}/media`, form, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, ...form.getHeaders() },
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
    document: { id: mediaId, filename, caption: caption || "" },
  };
  if (replyToMessageId) payload.context = { message_id: replyToMessageId };

  return axios.post(`${WA_BASE}/messages`, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    timeout: 15000,
  });
}

// =====================
// Normalización
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
  return ["si", "sí", "s", "dale", "ok", "oka", "ya", "envia", "enviar", "perfecto"].some(
    (x) => t === x || t.includes(x)
  );
}
function isNo(text) {
  const t = norm(text);
  return ["no", "nop", "despues", "luego", "mas tarde"].some((x) => t === x || t.includes(x));
}
function userWantsQuoteNow(text) {
  const t = norm(text);
  return (
    t.includes("cotiza") ||
    t.includes("cotizacion") ||
    t.includes("cotización") ||
    t.includes("precio") ||
    t === "pdf" ||
    t.includes("pdf")
  );
}

// =====================
// Detectores
// =====================
function detectCity(text) {
  const t = norm(text);
  const candidates = ["temuco", "padre las casas", "villarrica", "pucon", "pucón", "lautaro", "freire", "imperial", "nueva imperial", "labranza"];
  for (const c of candidates) if (t.includes(norm(c))) return c === "pucón" ? "Pucón" : c.replace(/\b\w/g, (x) => x.toUpperCase());
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
  if (t.includes("pvc")) return "pvc_europeo";
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

// CLAVE: ahora “estándar” cuenta como “basico”
function detectGlass(text) {
  const t = norm(text);
  if (t.includes("estandar") || t.includes("estándar") || t.includes("standard") || t.includes("normal") || t.includes("basico") || t.includes("básico")) return "basico";
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
  const m2 = t.match(/\bson\s*(\d{1,3})\b/);
  if (m2) return Number(m2[1]);
  return null;
}

// =====================
// Medidas
// =====================
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
  if (!text) return out;

  const clean = norm(text).replace(/,/g, ".");
  const reX = /(\d{1,4}(\.\d{1,3})?)\s*[x×]\s*(\d{1,4}(\.\d{1,3})?)\s*(mm|cm|m)?/g;

  let m;
  while ((m = reX.exec(clean))) {
    const w = toMm(m[1], m[5] || "mm");
    const h = toMm(m[3], m[5] || "mm");
    if (w && h) out.push({ wMm: w, hMm: h, raw: m[0] });
  }
  return out;
}

// =====================
// Cotizador
// =====================
function mmToM2(wMm, hMm) {
  const w = Number(wMm);
  const h = Number(hMm);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 0;
  return (w / 1000) * (h / 1000);
}
function moneyCLP(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("es-CL");
}
function colorToTier(color) {
  const c = norm(color || "");
  if (c === "blanco") return { pricePerM2: PRICE_WHITE_PER_M2 };
  if (c === "nogal" || c === "roble dorado") return { pricePerM2: PRICE_WOOD_PER_M2 };
  if (c === "grafito" || c === "negro") return { pricePerM2: PRICE_DARK_PER_M2 };
  return { pricePerM2: PRICE_WHITE_PER_M2 };
}

// “Listo para cotizar” (sin exigir instalación)
function canQuoteNow(session) {
  const c = session.context;
  if (!c.city) return false;
  if (!Array.isArray(c.windows) || c.windows.length === 0) return false;

  const hasColor = !!c.defaultColor || c.windows.some((w) => !!w.color);
  const hasSystem = !!c.defaultSystem || c.windows.some((w) => !!w.system);
  const hasOpen = !!c.defaultOpeningType || c.windows.some((w) => !!w.openingType);
  const hasGlass = !!c.defaultGlass || c.windows.some((w) => !!w.glass);

  return hasColor && hasSystem && hasOpen && hasGlass;
}

// Forzar cotización (si cliente la pide): si falta vidrio, asumir básico
function ensureQuote(session) {
  const c = session.context;

  // si falta vidrio, asumir DVH básico por defecto
  if (!c.defaultGlass) c.defaultGlass = "basico";

  // si falta sistema, asumir pvc europeo (por defecto en su negocio)
  if (!c.defaultSystem) c.defaultSystem = "pvc_europeo";

  // si falta apertura, asumir corredera (lo más común)
  if (!c.defaultOpeningType) c.defaultOpeningType = "corredera";

  // si falta color, asumir blanco
  if (!c.defaultColor) c.defaultColor = "blanco";

  if (!c.city || !c.windows?.length) return null;

  // duplicar según cantidad si corresponde
  if (c.itemsCount && c.windows.length === 1 && c.itemsCount > 1) {
    const base = c.windows[0];
    while (c.windows.length < c.itemsCount) c.windows.push({ ...base });
  }

  const items = c.windows.map((w, idx) => {
    let system = w.system || c.defaultSystem;
    let color = w.color || c.defaultColor;

    // pvc americano => solo blanco
    if (system === "pvc_americano") color = "blanco";

    const glass = w.glass || c.defaultGlass;
    const openingType = w.openingType || c.defaultOpeningType;

    const qty = w.qty ?? 1;
    const areaOne = mmToM2(w.wMm, w.hMm);
    const areaTotal = areaOne * qty;

    const { pricePerM2 } = colorToTier(color);
    const net = Math.round(areaTotal * pricePerM2);

    return {
      n: idx + 1,
      qty,
      wMm: w.wMm,
      hMm: w.hMm,
      areaTotal,
      system,
      color,
      glass,
      openingType,
      pricePerM2,
      net,
    };
  });

  const netSubtotal = items.reduce((a, x) => a + x.net, 0);
  const iva = Math.round(netSubtotal * IVA_RATE);
  const total = netSubtotal + iva;

  const quote = {
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
      "Pre-cotización referencial (fabricación) sujeta a confirmación en terreno.",
      "DVH/Termopanel es el vidrio doble. El marco puede ser PVC europeo/americano o aluminio.",
      "Diferenciador: warm-edge Thermoflex (tecnología inglesa) para reducir condensación vs separador aluminio tradicional.",
      c.installType === "con instalacion"
        ? "Instalación: se confirma costo/condiciones en visita (no incluida en el valor por m² indicado)."
        : "Instalación: opcional (se cotiza aparte si aplica).",
    ],
  };

  session.lastQuote = quote;
  return quote;
}

function quoteToText(quote) {
  const lines = [];
  lines.push(`${COMPANY_NAME} - Pre-cotización referencial (fabricación)`);
  lines.push(`Comuna/Sector: ${quote.city}`);
  lines.push(`Instalación: ${quote.installType}`);
  lines.push("");

  quote.items.forEach((it) => {
    lines.push(`${it.n}) ${it.qty}u - ${it.wMm}x${it.hMm}mm - ${it.openingType} - ${it.system} - ${it.color} - vidrio ${it.glass}`);
    lines.push(`   Área: ${it.areaTotal.toFixed(2)} m² | $${moneyCLP(it.pricePerM2)}/m² | Neto: $${moneyCLP(it.net)}`);
  });

  lines.push("");
  lines.push(`Subtotal Neto: $${moneyCLP(quote.netSubtotal)}`);
  lines.push(`IVA (${Math.round(IVA_RATE * 100)}%): $${moneyCLP(quote.iva)}`);
  lines.push(`Total: $${moneyCLP(quote.total)}`);
  lines.push("");
  lines.push("¿Desea que le envíe el PDF ahora? (Responda: SI / NO)");
  return lines.join("\n");
}

// =====================
// PDF
// =====================
async function generateQuotePDF(waId, quote) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const buffers = [];
    doc.on("data", (d) => buffers.push(d));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    doc.fontSize(18).text(`${COMPANY_NAME}`, { align: "center" });
    doc.moveDown(0.2);
    doc.fontSize(12).text("Pre-cotización referencial (fabricación)", { align: "center" });
    doc.moveDown(0.8);

    doc.fontSize(10).text(`Atiende: ${AGENT_NAME}`);
    doc.text(`Cliente (WA): ${waId}`);
    doc.text(`Comuna/Sector: ${quote.city}`);
    doc.text(`Instalación: ${quote.installType}`);
    doc.text(`Fecha: ${new Date().toLocaleString("es-CL")}`);
    doc.moveDown(0.8);

    doc.fontSize(11).text("Detalle:", { underline: true });
    doc.moveDown(0.3);

    quote.items.forEach((it) => {
      doc.fontSize(10).text(
        `${it.n}) ${it.qty}u  ${it.wMm}x${it.hMm}mm  | ${it.openingType} | ${it.system} | ${it.color} | vidrio ${it.glass}`
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

    doc.end();
  });
}

// =====================
// IA (respuesta mejorada, pero sin eternizar preguntas)
// =====================
function buildSystemPrompt(session) {
  const c = session.context || {};
  const tono = TONO === "tu" ? "tú" : "usted";

  return [
    `Idioma: ${LANGUAGE}. Tratar al cliente de "${tono}".`,
    `Usted es ${AGENT_NAME} de ${COMPANY_NAME}.`,
    `No compite por precio: compite por valor (hermeticidad, confort, calidad).`,
    `Explique breve: “termopanel/DVH es el vidrio doble; el marco puede ser PVC europeo/americano o aluminio”.`,
    `No diga “gracias” repetidamente. Sea directo.`,
    `Haga máximo 1 pregunta al final SOLO si realmente falta un dato para cotizar.`,
    `Si el cliente pide “cotización” o “PDF”, entregue cotización inmediata usando defaults (DVH básico) si falta algo menor.`,
    `Contexto: comuna=${c.city || "no informado"}, sistema=${c.defaultSystem || "no"}, color=${c.defaultColor || "no"}, apertura=${c.defaultOpeningType || "no"}, vidrio=${c.defaultGlass || "no"}.`
  ].join("\n");
}

async function aiDraftReply(session, userText, quoteTextOrNull) {
  if (!openai) return null;

  const messages = [
    { role: "system", content: buildSystemPrompt(session) },
    ...session.history.slice(-8).map((h) => ({ role: h.role, content: h.content })),
    {
      role: "user",
      content: [
        `Mensaje cliente: ${userText || ""}`,
        quoteTextOrNull ? `\nCotización disponible:\n${quoteTextOrNull}` : "",
        `\nResponda breve y accionable.`
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
// Context updater
// =====================
function applyTextToContext(session, text) {
  const c = session.context;
  c.city = c.city || detectCity(text);
  c.installType = c.installType || detectInstallType(text);

  c.defaultSystem = c.defaultSystem || detectSystem(text);
  c.defaultOpeningType = c.defaultOpeningType || detectOpeningType(text);
  c.defaultGlass = c.defaultGlass || detectGlass(text);
  c.defaultColor = c.defaultColor || detectColor(text);

  c.itemsCount = c.itemsCount || detectCount(text);

  const ms = extractMeasurements(text);
  if (ms.length) {
    for (const m of ms) {
      c.windows.push({ wMm: m.wMm, hMm: m.hMm, qty: 1, openingType: null, system: null, color: null, glass: null });
    }
  }

  if (c.itemsCount && c.windows.length === 1 && c.itemsCount > 1) {
    const base = c.windows[0];
    while (c.windows.length < c.itemsCount) c.windows.push({ ...base });
  }
}

// =====================
// Reply engine
// =====================
async function scheduleReply(waId, messageId, userText, { isMedia = false } = {}) {
  const session = getSession(waId);
  session.lastSeenAt = Date.now();

  await sleep(WAIT_AFTER_LAST_USER_MESSAGE_MS);
  if (Date.now() - session.lastSeenAt < WAIT_AFTER_LAST_USER_MESSAGE_MS - 100) return;
  if (!loopGuardOk(session)) return;

  const stopTyping = startTypingPinger(messageId, "text");
  try {
    if (isMedia) await sleep(EXTRA_DELAY_MEDIA_MS);

    applyTextToContext(session, userText);

    const c = session.context;

    // Intro una sola vez (directo)
    if (!c.introSent) c.introSent = true;

    // Si el usuario pide cotización/PDF => forzar cierre y no seguir preguntando
    const wantsNow = userWantsQuoteNow(userText);

    let quote = null;
    if (wantsNow) {
      quote = ensureQuote(session);
    } else if (canQuoteNow(session)) {
      quote = ensureQuote(session);
    }

    // si hay quote, entregarla y dejar "pendiente confirmación PDF"
    if (quote) {
      const qText = quoteToText(quote);
      c.pdfPendingConfirm = true;

      const aiText = await aiDraftReply(session, userText, qText);
      const reply = (aiText || qText).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, MAX_LINES_PER_REPLY).join("\n");

      await waSendText(waId, reply, { replyToMessageId: messageId });

      session.history.push({ role: "user", content: userText || "" });
      session.history.push({ role: "assistant", content: reply });
      noteReply(session);
      return;
    }

    // Si no hay quote, pedir SOLO lo faltante (1 pregunta)
    let missing = null;
    if (!c.city) missing = "¿En qué comuna/sector sería la instalación?";
    else if (!c.windows.length) missing = "Envíeme medidas en mm (ancho x alto) y cantidad de ventanas/puertas.";
    else if (!c.defaultSystem) missing = "¿Prefiere PVC línea europea, PVC línea americana o aluminio?";
    else if (!c.defaultColor) missing = "¿Color del marco? (PVC europeo: blanco, nogal, roble dorado, grafito o negro)";
    else if (!c.defaultOpeningType) missing = "¿Tipo de apertura? (corredera, abatible, proyectante, fija o puerta)";
    else if (!c.defaultGlass) missing = "¿Vidrio DVH/termopanel básico (estándar) o Low-E / Control Solar / Seguridad?";

    const fallback = [
      `Hola, le habla ${AGENT_NAME} de ${COMPANY_NAME}.`,
      `Cotizamos por m² con enfoque en calidad (hermeticidad, herrajes y warm-edge Thermoflex).`,
      missing || "Envíeme comuna/sector + medidas (mm) + color + tipo."
    ].join("\n");

    const aiText = await aiDraftReply(session, userText, null);
    const reply = (aiText || fallback).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, MAX_LINES_PER_REPLY).join("\n");

    await waSendText(waId, reply, { replyToMessageId: messageId });

    session.history.push({ role: "user", content: userText || "" });
    session.history.push({ role: "assistant", content: reply });
    noteReply(session);
  } catch (e) {
    console.error("scheduleReply error:", e?.response?.data || e?.message || e);
  } finally {
    stopTyping();
  }
}

// =====================
// Webhook POST (ACK inmediato)
// =====================
app.post("/webhook", (req, res) => {
  res.sendStatus(200);

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

      // RESET
      if (msg.type === "text") {
        const t = norm(msg.text?.body || "");
        if (["reset", "reiniciar", "nuevo", "start", "comenzar"].includes(t)) {
          sessions.delete(waId);
          await waSendText(
            waId,
            `Listo. Reinicié su sesión.\nEnvíeme: comuna/sector + medidas (mm) + color + tipo (corredera/abatible/proyectante/fija/puerta).`,
            { replyToMessageId: messageId }
          );
          return;
        }
      }

      // Si estaba pendiente confirmación de PDF (SI/NO)
      if (ENABLE_PDF_QUOTES && msg.type === "text" && session.context?.pdfPendingConfirm) {
        const bodyText = msg.text?.body || "";
        if (isYes(bodyText)) {
          session.context.pdfPendingConfirm = false;

          // Si no hay quote, forzarla
          if (!session.lastQuote) ensureQuote(session);

          if (!session.lastQuote) {
            await waSendText(waId, "Aún me faltan medidas para generar la cotización. Envíeme ancho x alto en mm.", { replyToMessageId: messageId });
            return;
          }

          const pdfBuffer = await generateQuotePDF(waId, session.lastQuote);
          await waSendDocument(
            waId,
            pdfBuffer,
            `PreCotizacion_${COMPANY_NAME.replace(/\s+/g, "_")}.pdf`,
            "Adjunto pre-cotización referencial (fabricación).",
            { replyToMessageId: messageId }
          );
          return;
        }

        if (isNo(bodyText)) {
          session.context.pdfPendingConfirm = false;
          await waSendText(waId, "Perfecto. Si después lo necesita, escriba: PDF.", { replyToMessageId: messageId });
          return;
        }
        // si no es SI/NO, continúa flujo normal
      }

      // PDF comando directo
      if (ENABLE_PDF_QUOTES && msg.type === "text") {
        const t = norm(msg.text?.body || "");
        if (t === "pdf" || t.includes("enviame el pdf") || t.includes("envie pdf")) {
          if (!session.lastQuote) ensureQuote(session);

          if (!session.lastQuote) {
            await waSendText(waId, "Para generar el PDF necesito medidas (mm) y comuna/sector. Ej: Temuco 2 ventanas 1000x1000.", { replyToMessageId: messageId });
            return;
          }

          const pdfBuffer = await generateQuotePDF(waId, session.lastQuote);
          await waSendDocument(
            waId,
            pdfBuffer,
            `PreCotizacion_${COMPANY_NAME.replace(/\s+/g, "_")}.pdf`,
            "Adjunto pre-cotización referencial (fabricación).",
            { replyToMessageId: messageId }
          );
          return;
        }
      }

      // TEXT normal
      if (msg.type === "text") {
        await scheduleReply(waId, messageId, msg.text?.body || "");
        return;
      }

      // AUDIO (opcional)
      if (msg.type === "audio" && ENABLE_VOICE_TRANSCRIPTION && openai) {
        const mediaId = msg.audio?.id;
        await waSendText(waId, "Recibido. Estoy transcribiendo su audio para continuar.", { replyToMessageId: messageId });

        const stopTyping = startTypingPinger(messageId, "text");
        try {
          const url = await waGetMediaUrl(mediaId);
          const bytes = await waDownloadMediaBytes(url);
          const file = await OpenAI.toFile(bytes, "voice.ogg");
          const transcription = await openai.audio.transcriptions.create({ file, model: "whisper-1" });
          const transcript = (transcription.text || "").trim();

          await scheduleReply(waId, messageId, transcript ? `Audio: ${transcript}` : "Audio no legible.", { isMedia: true });
        } catch (e) {
          console.error("Audio error:", e?.message || e);
          await waSendText(waId, "Tuve un problema leyendo el audio. ¿Puede enviarme el texto por WhatsApp?", { replyToMessageId: messageId });
        } finally {
          stopTyping();
        }
        return;
      }

      // DOCUMENT (PDF parse opcional)
      if (msg.type === "document") {
        const mime = msg.document?.mime_type || "";
        const filename = msg.document?.filename || "archivo";
        const mediaId = msg.document?.id;

        await waSendText(waId, `Recibido "${filename}". Revisando…`, { replyToMessageId: messageId });

        const stopTyping = startTypingPinger(messageId, "text");
        try {
          const url = await waGetMediaUrl(mediaId);
          const bytes = await waDownloadMediaBytes(url);
          let parsedText = "";

          if (mime.includes("pdf")) {
            try {
              const data = await pdfParse(bytes);
              parsedText = (data.text || "").slice(0, 3000);
            } catch {
              parsedText = "";
            }
          }

          await scheduleReply(waId, messageId, parsedText ? `PDF: ${parsedText}` : "Documento recibido.", { isMedia: true });
        } finally {
          stopTyping();
        }
        return;
      }

      // fallback
      await waSendText(
        waId,
        "Recibido. Para cotizar rápido: comuna/sector + medidas (mm) + color + tipo de apertura. Si quiere PDF, escriba: PDF.",
        { replyToMessageId: messageId }
      );
    } catch (e) {
      console.error("Webhook process error:", e?.message || e);
    }
  });
});

app.listen(PORT, () => console.log("Listening…"));
