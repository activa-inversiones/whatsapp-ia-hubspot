// index.js — WhatsApp IA + Zoho CRM
// Ferrari 6.5.0 — MOTOR PRECIOS ECUACIONES + STAGES ZOHO AUTO + FALLBACK SEGURO
// Node 18+ | Railway | ESM
//
// ────────────────────────────────────────────────────────────
// CHANGELOG
// ─ Ferrari 6.5.0 (HOY)
//   [1] Reemplaza calculateInternalPrice() por motor real con ecuaciones (coeficientes)
//       + reglas: Puertas 1H/Doble, Corredera 80→98, Proyectante límite, Marco fijo auto 5+12+5.
//   [2] Fallback: si no hay ecuación cargada, usa el cálculo anterior (por área + multiplicadores).
//   [3] Zoho: Stage se calcula automáticamente por avance (diagnóstico/siembra/validación/propuesta/cierre).
//   [4] Zoho: Description incluye trazabilidad (dataset, reglas, modo, medidas, vidrio).
//
// ─ Ferrari 6.4.1 (anterior)
//   FIX ZOHO SEARCH (Eliminado fallback inválido para limpiar logs)
// ────────────────────────────────────────────────────────────

import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import crypto from "crypto";
import FormData from "form-data";
import PDFDocument from "pdfkit";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { createRequire } from "module";

dotenv.config();

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const app = express();

// ---------- Raw body para firma Meta ----------
app.use(
  express.json({
    limit: "20mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ============================================================
// HELPER LOGS (Anti-Spam Railway)
// ============================================================
function logError(context, e) {
  if (e.response) {
    console.error(
      `❌ ${context} [API]: ${e.response.status} - ${JSON.stringify(e.response.data).slice(0, 150)}...`
    );
  } else if (e.request) {
    console.error(`❌ ${context} [Network]: Sin respuesta.`);
  } else {
    console.error(`❌ ${context} [Code]: ${e.message}`);
  }
}

// ============================================================
// ENV CONFIGURATION
// ============================================================
const PORT = process.env.PORT || 8080;
const TZ = process.env.TZ || "America/Santiago";

const META = {
  GRAPH_VERSION: process.env.META_GRAPH_VERSION || "v22.0",
  TOKEN: process.env.WHATSAPP_TOKEN,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  APP_SECRET: process.env.APP_SECRET || "",
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL_OPENAI || "gpt-4o-mini";
const STT_MODEL = process.env.AI_MODEL_STT || "whisper-1";

const AUTO_SEND_PDF_WHEN_READY = false;

const REQUIRE_ZOHO = String(process.env.REQUIRE_ZOHO || "true") === "true";
const ZOHO = {
  CLIENT_ID: process.env.ZOHO_CLIENT_ID,
  CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET,
  REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN,
  REDIRECT_URI: process.env.ZOHO_REDIRECT_URI,
  API_DOMAIN: process.env.ZOHO_API_DOMAIN || "https://www.zohoapis.com",
  ACCOUNTS_DOMAIN: process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.com",
  LEAD_PROFILE_FIELD: process.env.ZOHO_LEAD_PROFILE_FIELD || "",
  DEAL_PROFILE_FIELD: process.env.ZOHO_DEAL_PROFILE_FIELD || "",
  DEAL_PHONE_FIELD: process.env.ZOHO_DEAL_PHONE_FIELD || "WhatsApp_Phone",
  DEFAULT_ACCOUNT_NAME: process.env.ZOHO_DEFAULT_ACCOUNT_NAME || "Clientes WhatsApp IA",
};

const COMPANY = {
  NAME: process.env.COMPANY_NAME || "Activa Inversiones",
  PHONE: process.env.COMPANY_PHONE || "+56 9 1234 5678",
  EMAIL: process.env.COMPANY_EMAIL || "ventas@activa.cl",
  ADDRESS: process.env.COMPANY_ADDRESS || "Temuco, La Araucanía, Chile",
  WEBSITE: process.env.COMPANY_WEBSITE || "www.activa.cl",
  RUT: process.env.COMPANY_RUT || "76.XXX.XXX-X",
};

const STAGE_MAP = {
  diagnostico: process.env.ZOHO_STAGE_DIAGNOSTICO || "Diagnóstico y Perfilado",
  siembra: process.env.ZOHO_STAGE_SIEMBRA || "Siembra de Confianza + Marco Normativo (OGUC/RT)",
  propuesta: process.env.ZOHO_STAGE_PROPUESTA || "Presentación de Propuesta",
  objeciones: process.env.ZOHO_STAGE_OBJECIONES || "Incubadora de Objeciones",
  validacion: process.env.ZOHO_STAGE_VALIDACION || "Validación Técnica y Normativa",
  cierre: process.env.ZOHO_STAGE_CIERRE || "Cierre y Negociación",
  ganado: process.env.ZOHO_STAGE_GANADO || "Cerrado ganado",
  perdido: process.env.ZOHO_STAGE_PERDIDO || "Cerrado perdido",
  competencia: process.env.ZOHO_STAGE_COMPETENCIA || "Perdido y cerrado para la competencia",
};

// ============================================================
// VALIDACIÓN ENV
// ============================================================
function assertEnv() {
  const missing = [];
  if (!META.TOKEN) missing.push("WHATSAPP_TOKEN");
  if (!META.PHONE_NUMBER_ID) missing.push("PHONE_NUMBER_ID");
  if (!META.VERIFY_TOKEN) missing.push("VERIFY_TOKEN");
  if (!OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (missing.length) {
    console.error("[FATAL] Missing ENV:", missing.join(", "));
    process.exit(1);
  }
}
assertEnv();

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ============================================================
// UTILIDADES
// ============================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeCLPhone(raw) {
  const s = String(raw || "").replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("56")) return `+${s}`;
  return `+${s}`;
}

function stripAccents(s) {
  return String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function normalizeYesNo(v) {
  const s = stripAccents(String(v || "")).trim().toLowerCase();
  if (!s) return "";
  if (["si", "sí", "s", "1", "true", "y", "yes"].includes(s)) return "Sí";
  if (["no", "n", "0", "false"].includes(s)) return "No";
  return "";
}

// ============================================================
// MOTOR DE PRECIOS — Ferrari 6.5.0 (NUEVO)
// ============================================================

// 1) Normalizar medidas del texto (mantienes tu lógica)
function normalizeMeasures(measures) {
  const t = String(measures || "").toLowerCase();
  let nums = t.match(/(\d+([.,]\d+)?)/g);
  if (!nums || nums.length < 2) return null;

  let a = parseFloat(nums[0].replace(",", "."));
  let b = parseFloat(nums[1].replace(",", "."));

  if (a < 10) a *= 1000;
  if (b < 10) b *= 1000;
  if (a >= 10 && a < 100) a *= 10;
  if (b >= 10 && b < 100) b *= 10;

  return { ancho_mm: Math.round(a), alto_mm: Math.round(b) };
}

// 2) Tu cálculo anterior (queda como Fallback seguro)
function calculateInternalPriceFallback({ ancho_mm, alto_mm, color, glass }) {
  if (!ancho_mm || !alto_mm) return 0;
  const area = (ancho_mm * alto_mm) / 1_000_000;
  let base = area * 120000;

  const colorUpper = String(color || "").toUpperCase();
  const glassUpper = String(glass || "").toUpperCase();

  if (["NEGRO", "ANTRACITA", "GRAFITO", "NOGAL"].some((c) => colorUpper.includes(c))) base *= 1.15;
  if (/TERMOPANEL|DVH|6-12-6|LOW/.test(glassUpper)) base *= 1.25;

  return Math.max(Math.round(base), 50000);
}

// 3) Normalización producto/color/vidrio (NUEVO)
function normalizeColorFromText(text = "") {
  const s = stripAccents(text).toUpperCase();
  if (s.includes("ANTRAC") || s.includes("GRAF") || s.includes("NEG")) return "NEGRO";
  if (s.includes("ROBLE") || s.includes("NOG")) return "NOGAL";
  return "BLANCO";
}

function normalizeProduct(productRaw = "") {
  const s = stripAccents(productRaw).toUpperCase();
  if (s.includes("PUERTA")) return "PUERTA";
  if (s.includes("PROYEC")) return "PROYECTANTE";
  if (s.includes("MARCO") || s.includes("FIJO")) return "MARCO_FIJO";
  if (s.includes("OSCILO")) return "OSCILOBATIENTE";
  if (s.includes("ABAT")) return "VENTANA_ABATIBLE";
  if (s.includes("CORREDERA") && s.includes("98")) return "CORREDERA_98";
  if (s.includes("CORREDERA") && s.includes("80")) return "CORREDERA_80";
  if (s.includes("CORREDERA")) return "CORREDERA_80";
  return "";
}

function normalizeGlass(glassRaw = "", defaultGlass = "TP4+12+4") {
  const s = stripAccents(glassRaw).toUpperCase();
  if (s.includes("5") && s.includes("12") && s.includes("5")) return "TP5+12+5";
  if (s.includes("4") && s.includes("12") && s.includes("4")) return "TP4+12+4";
  if (s.includes("TERMOPANEL") || s.includes("DVH")) return defaultGlass;
  return defaultGlass;
}

// 4) Ecuación por coeficientes (NUEVO)
function priceFromCoeffs(coeffs, W, H) {
  const { a, b, c, d, e, f } = coeffs;
  const p = a + b * W + c * H + d * W * H + e * W * W + f * H * H;
  return Math.max(0, Math.round(p));
}

// 5) Reglas de selección dataset (NUEVO)
function resolvePricingKey({ product, colorText, glass, W, H }) {
  let model = product;
  let COLOR = normalizeColorFromText(colorText);
  let GLASS = glass;
  const rulesApplied = [];

  if (!model) return { ok: false, reason: "Producto no reconocido" };

  // PROYECTANTE límite 1400x1400
  if (model === "PROYECTANTE" && (W > 1400 || H > 1400)) {
    return { ok: false, reason: "PROYECTANTE solo se fabrica hasta 1400x1400 mm" };
  }

  // MARCO FIJO: auto TP5+12+5 desde 1000x2000
  if (model === "MARCO_FIJO" && W >= 1000 && H >= 2000) {
    GLASS = "TP5+12+5";
    rulesApplied.push("MARCO_FIJO auto vidrio TP5+12+5 (>=1000x2000)");
  }

  // PUERTAS: 1 hoja / doble hoja
  if (model === "PUERTA") {
    if (W <= 1200 && H <= 2400) {
      model = "PUERTA_1H";
      rulesApplied.push("PUERTA => 1 HOJA (<=1200x2400)");
    } else if (W >= 1201 && W <= 2400 && H === 2400) {
      model = "PUERTA_DOBLE";
      rulesApplied.push("PUERTA => DOBLE HOJA (1201..2400 x 2400)");
    } else {
      return {
        ok: false,
        reason:
          "Puerta fuera de regla: 1 hoja hasta 1200x2400; desde 1201 a 2400 requiere alto 2400 y es doble hoja.",
      };
    }
    GLASS = "TP5+12+5";
    rulesApplied.push("PUERTA fuerza vidrio TP5+12+5");
  }

  // CORREDERA 80: 400..2000; si >=2001x2001 => 98
  if (model === "CORREDERA_80") {
    if (W < 400 || H < 400) return { ok: false, reason: "CORREDERA 80 mínimo 400x400 mm" };
    if (W >= 2001 && H >= 2001) {
      model = "CORREDERA_98";
      rulesApplied.push("CORREDERA_80 => CORREDERA_98 (>=2001x2001)");
    } else if (W > 2000 || H > 2000) {
      return { ok: false, reason: "Si supera 2000x2000, se cotiza como CORREDERA 98 (o ajustar medida)." };
    }
  }

  const key = `${model}::${COLOR}::${GLASS}`;
  return { ok: true, model, color: COLOR, glass: GLASS, key, rulesApplied };
}

// 6) COEFICIENTES (pegables) — hoy dejo puertas listas + estructura
// IMPORTANTE: agrega aquí los coeficientes restantes (proyectantes/correderas/oscilobatiente/abatible/marco fijo).
const COEFFS = {
  // Puertas (ya implementadas):
  "PUERTA_1H::BLANCO::TP5+12+5": { a: 140100.22733, b: 18.892589, c: 37.209872, d: 0.086863576, e: 0.003233095, f: -0.00113546 },
  "PUERTA_1H::NEGRO::TP5+12+5": { a: 136158.016292, b: 48.502605, c: 66.819891, d: 0.086863595, e: 0.003233068, f: -0.00113547 },
  "PUERTA_1H::NOGAL::TP5+12+5": { a: 137159.159293, b: 37.076508, c: 55.393745, d: 0.086863633, e: 0.003233092, f: -0.001135438 },

  "PUERTA_DOBLE::BLANCO::TP5+12+5": { a: 219814.229091, b: 20.214712, c: 59.663669, d: 0.086334711, e: 0.001420833, f: -0.001095857 },
  "PUERTA_DOBLE::NEGRO::TP5+12+5": { a: 215455.111736, b: 45.100687, c: 114.186203, d: 0.086334766, e: 0.001420816, f: -0.001096061 },
  "PUERTA_DOBLE::NOGAL::TP5+12+5": { a: 215652.196033, b: 36.128734, c: 94.176285, d: 0.086334711, e: 0.001420833, f: -0.001096061 },

  // 🔻 Aquí pegas el resto cuando lo quieras activar:
  // "PROYECTANTE::BLANCO::TP4+12+4": {...}
  // "CORREDERA_80::NEGRO::TP4+12+4": {...}
  // "MARCO_FIJO::BLANCO::TP5+12+5": {...}
};

// 7) Cotización por ecuación con fallback (NUEVO)
function quotePriceEngine({ productText, glassText, measuresText }) {
  const m = normalizeMeasures(measuresText);
  if (!m) return { ok: false, reason: "No pude leer medidas. Ej: 1200x1200 o 1.2x1.2" };

  const W = m.ancho_mm;
  const H = m.alto_mm;

  const product = normalizeProduct(productText);
  const glass = normalizeGlass(glassText, process.env.DEFAULT_GLASS || "TP4+12+4");
  const colorText = `${productText} ${glassText}`;

  const resolved = resolvePricingKey({ product, colorText, glass, W, H });
  if (!resolved.ok) return resolved;

  const coeffs = COEFFS[resolved.key];
  if (coeffs) {
    const price = priceFromCoeffs(coeffs, W, H);
    return { ok: true, price, mode: "equation", resolved, measures: m };
  }

  // Fallback seguro
  const priceFallback = calculateInternalPriceFallback({
    ancho_mm: W,
    alto_mm: H,
    color: colorText,
    glass: resolved.glass,
  });

  return {
    ok: true,
    price: priceFallback,
    mode: "fallback",
    resolved,
    measures: m,
    warning: `No hay ecuación cargada para ${resolved.key}. Se usó fallback referencial.`,
  };
}

// ============================================================
// ZOHO: Stage automático (NUEVO)
// ============================================================
function computeStageKey(d, session) {
  // Prioridad: si el cliente explícitamente confirma compra/avance
  if (d.stageKey === "cierre") return "cierre";
  if (session.pdfSent) return "propuesta";

  const hasProduct = !!d.product;
  const hasMeasures = !!d.measures;
  const hasComuna = !!(d.comuna || d.address);
  const hasGlass = !!d.glass;

  if (hasProduct && hasMeasures && hasComuna && hasGlass) return "validacion";
  if (hasProduct || hasMeasures) return "siembra";
  return "diagnostico";
}

function buildZohoDescription(d) {
  const lines = [];
  lines.push(`Producto: ${d.product || ""}`.trim());
  lines.push(`Medidas: ${d.measures || ""}`.trim());
  lines.push(`Vidrio: ${d.glass || ""}`.trim());
  if (d.internal_price) lines.push(`Precio: ${d.internal_price}`);
  if (d.price_mode) lines.push(`Modo precio: ${d.price_mode}`);
  if (d.price_key) lines.push(`Dataset: ${d.price_key}`);
  if (d.price_rules && d.price_rules.length) lines.push(`Reglas: ${d.price_rules.join(" | ")}`);
  if (d.price_warning) lines.push(`Aviso: ${d.price_warning}`);
  return lines.filter(Boolean).join("\n");
}

// ============================================================
// FECHAS / ETC (igual que tenías)
// ============================================================
function formatDateZoho(date = new Date()) {
  return date.toISOString().split("T")[0];
}

function formatDateCL(date = new Date()) {
  return date.toLocaleDateString("es-CL", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function generateQuoteNumber() {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = (now.getMonth() + 1).toString().padStart(2, "0");
  const d = now.getDate().toString().padStart(2, "0");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `COT-${y}${m}${d}-${rand}`;
}

function humanDelayMs(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  return 700 + Math.min(5300, words * 110);
}

// ============================================================
// WHATSAPP HELPERS
// ============================================================
const waBase = () => `https://graph.facebook.com/${META.GRAPH_VERSION}`;

function verifyMetaSignature(req) {
  if (!META.APP_SECRET) return true;
  const sig = req.get("X-Hub-Signature-256") || req.get("x-hub-signature-256");
  if (!sig) return false;
  if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", META.APP_SECRET).update(req.rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function waSendText(to, text) {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  try {
    const payload = { messaging_product: "whatsapp", to, type: "text", text: { body: text } };
    await axios.post(url, payload, { headers: { Authorization: `Bearer ${META.TOKEN}` }, timeout: 20000 });
  } catch (e) {
    logError("WA Send Text", e);
  }
}

async function waMarkReadAndTyping(waId, messageId) {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  try {
    if (messageId)
      await axios.post(
        url,
        { messaging_product: "whatsapp", status: "read", message_id: messageId },
        { headers: { Authorization: `Bearer ${META.TOKEN}` } }
      );
    if (waId)
      await axios.post(
        url,
        { messaging_product: "whatsapp", to: waId, typing_indicator: { type: "text" } },
        { headers: { Authorization: `Bearer ${META.TOKEN}` } }
      );
  } catch (e) {
    /* Ignorar errores de typing */
  }
}

async function waUploadPdf(buffer, filename = "Cotizacion.pdf") {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/media`;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buffer, { filename, contentType: "application/pdf" });
  try {
    const r = await axios.post(url, form, {
      headers: { Authorization: `Bearer ${META.TOKEN}`, ...form.getHeaders() },
      maxBodyLength: Infinity,
    });
    return r.data.id;
  } catch (e) {
    logError("WA Upload PDF", e);
    throw e;
  }
}

async function waSendPdfById(to, mediaId, caption, filename = "Cotizacion.pdf") {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "document", document: { id: mediaId, filename, caption } };
  try {
    await axios.post(url, payload, { headers: { Authorization: `Bearer ${META.TOKEN}` } });
  } catch (e) {
    logError("WA Send PDF", e);
  }
}

async function waGetMediaMeta(mediaId) {
  const url = `${waBase()}/${mediaId}`;
  try {
    const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${META.TOKEN}` } });
    return data;
  } catch (e) {
    logError("WA Get Media", e);
    throw e;
  }
}

async function waDownloadMedia(mediaUrl) {
  try {
    const { data, headers } = await axios.get(mediaUrl, {
      responseType: "arraybuffer",
      headers: { Authorization: `Bearer ${META.TOKEN}` },
    });
    return { buffer: Buffer.from(data), mime: headers["content-type"] || "application/octet-stream" };
  } catch (e) {
    logError("WA Download Media", e);
    throw e;
  }
}

// ============================================================
// MEDIA PROCESSING
// ============================================================
async function transcribeAudio(buffer, mime) {
  try {
    const file = await toFile(buffer, "audio.ogg", { type: mime });
    const r = await openai.audio.transcriptions.create({ model: STT_MODEL, file, language: "es" });
    return (r.text || "").trim();
  } catch (e) {
    logError("OpenAI Audio", e);
    return "";
  }
}

async function describeImage(buffer, mime) {
  try {
    const b64 = buffer.toString("base64");
    const dataUrl = `data:${mime};base64,${b64}`;
    const prompt =
      "Describe brevemente la imagen y extrae datos útiles para cotizar ventanas/puertas: producto, medidas, comuna, vidrio. Responde en español.";
    const resp = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUrl } }],
        },
      ],
      max_tokens: 250,
    });
    return (resp.choices?.[0]?.message?.content || "").trim();
  } catch (e) {
    logError("OpenAI Vision", e);
    return "";
  }
}

async function parsePdfToText(buffer) {
  try {
    const r = await pdfParse(buffer);
    const text = (r?.text || "").trim();
    return text.length > 6000 ? text.slice(0, 6000) + "\n..." : text;
  } catch (e) {
    return "";
  }
}

// ============================================================
// SESSIONS
// ============================================================
const sessions = new Map();
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

function createEmptySession() {
  return {
    lastUserAt: Date.now(),
    data: {
      name: "",
      product: "",
      measures: "",
      address: "",
      comuna: "",
      glass: "",
      install: "",
      wants_pdf: false,
      notes: "",
      profile: "",
      stageKey: "diagnostico",
      internal_price: null,

      // NUEVO: trazabilidad precios
      price_mode: "",
      price_key: "",
      price_rules: [],
      price_warning: "",
    },
    history: [],
    pdfSent: false,
    quoteNumber: null,
    zohoLeadId: null,
    zohoDealId: null,
  };
}

function getSession(waId) {
  if (!sessions.has(waId)) sessions.set(waId, createEmptySession());
  return sessions.get(waId);
}

function saveSession(waId, session) {
  session.lastUserAt = Date.now();
  sessions.set(waId, session);
}

function cleanupSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [waId, s] of sessions.entries()) {
    if ((s.lastUserAt || 0) < cutoff) sessions.delete(waId);
  }
}
setInterval(cleanupSessions, 3600000);

// ============================================================
// RATE LIMITING & LOCKS
// ============================================================
const processedMsgIds = new Map();
function isDuplicateMsg(msgId) {
  if (!msgId) return false;
  if (processedMsgIds.has(msgId)) return true;
  processedMsgIds.set(msgId, Date.now());
  return false;
}
setInterval(() => {
  const cutoff = Date.now() - 7200000;
  for (const [id, ts] of processedMsgIds.entries()) if (ts < cutoff) processedMsgIds.delete(id);
}, 600000);

const locks = new Map();
async function acquireLock(waId) {
  if (locks.has(waId)) await locks.get(waId);
  let release;
  const p = new Promise((r) => (release = r));
  locks.set(waId, p);
  return () => {
    release();
    locks.delete(waId);
  };
}

const rate = new Map();
function checkRate(waId) {
  const now = Date.now();
  if (!rate.has(waId)) rate.set(waId, { count: 1, resetAt: now + 60000 });
  const r = rate.get(waId);
  if (now >= r.resetAt) {
    r.count = 1;
    r.resetAt = now + 60000;
    return { allowed: true };
  }
  r.count++;
  return r.count > 15 ? { allowed: false, msg: "Estás escribiendo muy rápido. Dame unos segundos." } : { allowed: true };
}

// ============================================================
// WEBHOOK EXTRACTION
// ============================================================
function extractIncoming(reqBody) {
  const entry = reqBody?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;

  if (value?.statuses?.length) return { ok: false, reason: "status_update" };

  const msg = value?.messages?.[0];
  if (!msg) return { ok: false, reason: "no_message" };

  const waId = msg.from;
  const msgId = msg.id;
  const type = msg.type;

  const audioId = type === "audio" ? msg.audio?.id : null;
  const imageId = type === "image" ? msg.image?.id : null;
  const docId = type === "document" ? msg.document?.id : null;
  const docMime = type === "document" ? msg.document?.mime_type : null;

  let text = "";
  if (type === "text") text = msg.text?.body || "";
  else if (type === "button") text = msg.button?.text || "";
  else if (type === "interactive") text = JSON.stringify(msg.interactive || {});
  else text = `[${type}]`;

  return { ok: true, waId, msgId, type, text, audioId, imageId, docId, docMime };
}

// ============================================================
// LÓGICA DE NEGOCIO
// ============================================================
function nextMissingKey(d) {
  if (!d.product) return "producto";
  if (!d.measures) return "medidas";
  if (!d.address && !d.comuna) return "comuna";
  if (!d.glass) return "vidrio";
  return "";
}

function isComplete(d) {
  return !!(d.product && d.measures && (d.address || d.comuna) && d.glass);
}

// ============================================================
// PROMPT & TOOLS
// ============================================================
const tools = [
  {
    type: "function",
    function: {
      name: "update_customer_data",
      description: "Actualiza datos del cliente. Llama SOLO cuando el cliente proporcione información nueva.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          product: { type: "string" },
          measures: { type: "string" },
          address: { type: "string" },
          comuna: { type: "string" },
          glass: { type: "string" },
          install: { type: "string" },
          wants_pdf: { type: "boolean" },
          notes: { type: "string" },
        },
      },
    },
  },
];

const SYSTEM_PROMPT = `
Eres un ASESOR ESPECIALISTA EN SOLUCIONES DE VENTANAS Y CERRAMIENTOS
de ${COMPANY.NAME}.

NO eres un vendedor agresivo.
NO empujas ventas.
NO presionas decisiones.

Tu rol es acompañar, orientar y ayudar al cliente
a tomar una BUENA decisión técnica y económica.

────────────────────────
ENFOQUE PRINCIPAL: VENTA POR VALOR
────────────────────────
Las personas compran por confianza, durabilidad,
confort térmico/acústico y respaldo.
Tu misión es transmitir ese valor SIN imponerlo.

────────────────────────
CÓMO TE COMPORTAS
────────────────────────
- Conversas como un asesor experimentado, humano y chileno.
- Escuchas primero, hablas después.
- Si el cliente escribe poco o desordenado (fotos, audios), NO lo apuras.
  Agradeces y ordenas tú.
- Si el cliente solo está explorando, lo acompañas sin exigir datos.

Ejemplo de tono correcto:
“Perfecto 👍 con lo que me comentas ya se puede ir entendiendo el proyecto.”

────────────────────────
RELACIÓN CON EL PRECIO
────────────────────────
- El precio NO es el centro de la conversación.
- Si preguntan, explicas rangos orientativos y QUÉ influye
  (vidrio, perfil, instalación, uso del espacio).
- Dejas claro que el valor exacto requiere entender bien el proyecto
  para evitar errores posteriores.
- NUNCA uses urgencia artificial ni presión comercial.

────────────────────────
PROCESO NATURAL (NO FORZADO)
────────────────────────
1. Entender el proyecto.
2. Aclarar dudas y proponer soluciones (explicando el “por qué”).
3. Solo cuando esté claro o el cliente lo pida:
   ofrecer cotización formal (PDF).

Si el cliente no está listo para cotizar, NO lo empujes.

────────────────────────
TRASPASO A HUMANOS (SUAVE)
────────────────────────
Cuando corresponda, presenta al Equipo Alfa como apoyo:

“Si quieres, un consultor del Equipo Alfa
puede revisar contigo los detalles finos del proyecto.”

Nunca como presión. Siempre como respaldo.

────────────────────────
INSTRUCCIONES TÉCNICAS (OBLIGATORIAS PARA TI)
────────────────────────
1. USO DE HERRAMIENTAS:
   Si el cliente entrega datos nuevos (producto, medidas, comuna,
   vidrio, instalación, correo, etc.),
   DEBES llamar inmediatamente a la función:
   update_customer_data

2. DATOS FALTANTES:
   Si necesitas información para cotizar,
   pídela de a uno y con lenguaje humano,
   nunca como interrogatorio.

3. PERFILADO INTERNO (SILENCIOSO):
   Analiza el comportamiento y clasifica al cliente como UNO solo:
   - PRECIO → busca economía. Enfócate en durabilidad.
   - CALIDAD → busca estándar alto. Habla de terminaciones y garantía.
   - TECNICO → sabe del tema. Usa mm, DVH, normativa.
   - AFINIDAD → compra por confianza. Sé cercano.

────────────────────────
ETIQUETA INTERNA (OBLIGATORIA)
────────────────────────
Al FINAL de cada respuesta tuya,
incluye SOLO UNO de estos tags,
en una línea aparte y SIN explicarlo,
para uso interno del sistema:

<PROFILE:PRECIO>
<PROFILE:CALIDAD>
<PROFILE:TECNICO>
<PROFILE:AFINIDAD>

El cliente NUNCA debe notar estos tags.
`.trim();

async function runAI(session, userText) {
  const d = session.data;
  const missingKey = nextMissingKey(d);
  const complete = isComplete(d);

  const statusMsg = complete
    ? "DATOS COMPLETOS. Confirma si quiere PDF formal."
    : `FALTA: "${missingKey}". Conversa o pídelo amablemente.`;

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: statusMsg },
    { role: "system", content: `Memoria actual:\n${JSON.stringify(d, null, 2)}` },
    ...session.history.slice(-12),
    { role: "user", content: userText },
  ];

  try {
    const resp = await openai.chat.completions.create({
      model: AI_MODEL,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.3,
      max_tokens: 400,
    });

    const aiMsg = resp.choices?.[0]?.message;
    if (aiMsg?.content) {
      const match = aiMsg.content.match(/<PROFILE:(\w+)>/i);
      if (match) {
        const detected = match[1].toUpperCase();
        if (["PRECIO", "CALIDAD", "TECNICO", "AFINIDAD"].includes(detected)) {
          session.data.profile = detected;
        }
      }
    }

    return aiMsg;
  } catch (e) {
    logError("OpenAI Run", e);
    return { role: "assistant", content: "Dame un segundo, reviso la info..." };
  }
}

// ============================================================
// PDF
// ============================================================
async function createQuotePdf(data, quoteNumber) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      const primaryColor = "#1a365d";
      doc.rect(0, 0, 612, 100).fill(primaryColor);
      doc.fillColor("#ffffff").fontSize(24).font("Helvetica-Bold").text(COMPANY.NAME.toUpperCase(), 50, 30);
      doc.fontSize(10).font("Helvetica").text("Ventanas y Puertas Premium", 50, 58);
      doc.fontSize(20).font("Helvetica-Bold").text("COTIZACIÓN", 400, 35, { align: "right", width: 150 });
      doc.fontSize(10).font("Helvetica").text(quoteNumber, 400, 62, { align: "right", width: 150 });

      doc.y = 120;
      doc.fillColor("#4a5568").fontSize(9);
      doc.text(`Fecha: ${formatDateCL()}`, 400, 110, { align: "right", width: 150 });

      doc.y = 160;
      doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("DATOS DEL CLIENTE", 50);
      doc.moveDown(0.5);
      doc.fillColor("#4a5568").fontSize(10).font("Helvetica");
      doc.text(`Nombre: ${data.name || "Por confirmar"}`);
      doc.text(`Contacto: WhatsApp`);

      doc.moveDown(1);
      doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("DETALLE", 50);
      doc.moveDown(0.5);

      const items = [
        ["Producto", data.product],
        ["Medidas", data.measures],
        ["Vidrio", data.glass],
        ["Instalación", data.install],
        ["Notas", data.notes],
      ];

      let rowY = doc.y;
      doc.font("Helvetica");
      for (const [l, v] of items) {
        if (!v) continue;
        doc.text(l, 50, rowY);
        doc.text(v, 200, rowY, { width: 350 });
        rowY += 20;
      }

      doc.y = rowY + 20;
      doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("VALOR ESTIMADO");
      let precioTexto = "Por confirmar tras visita técnica.";
      if (data.internal_price) precioTexto = `$ ${Number(data.internal_price).toLocaleString("es-CL")} + IVA (Referencial)`;

      doc.rect(50, doc.y + 5, 512, 40).fill("#f7fafc");
      doc.fillColor(primaryColor).fontSize(14).text(precioTexto, 60, doc.y + 18, { align: "center", width: 490 });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ============================================================
// ZOHO CRM
// ============================================================
let zohoCache = { token: "", expiresAt: 0 };
let tokenRefreshPromise = null;

async function refreshZohoToken() {
  const url = `${ZOHO.ACCOUNTS_DOMAIN}/oauth/v2/token`;
  const params = new URLSearchParams();
  params.append("refresh_token", ZOHO.REFRESH_TOKEN);
  params.append("client_id", ZOHO.CLIENT_ID);
  params.append("client_secret", ZOHO.CLIENT_SECRET);
  params.append("grant_type", "refresh_token");
  try {
    const { data } = await axios.post(url, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    zohoCache.token = data.access_token;
    zohoCache.expiresAt = Date.now() + data.expires_in * 1000 - 60000;
    return zohoCache.token;
  } catch (e) {
    logError("Zoho Refresh Token", e);
    throw e;
  }
}

async function getZohoToken() {
  if (!REQUIRE_ZOHO) return "";
  if (zohoCache.token && Date.now() < zohoCache.expiresAt) return zohoCache.token;
  if (tokenRefreshPromise) return tokenRefreshPromise;
  tokenRefreshPromise = refreshZohoToken();
  try {
    return await tokenRefreshPromise;
  } finally {
    tokenRefreshPromise = null;
  }
}

async function zohoFindLead(phone) {
  const t = await getZohoToken();
  try {
    const r = await axios.get(
      `${ZOHO.API_DOMAIN}/crm/v2/Leads/search?criteria=(Mobile:equals:${encodeURIComponent(phone)})`,
      { headers: { Authorization: `Zoho-oauthtoken ${t}` } }
    );
    return r.data?.data?.[0];
  } catch (e) {
    if (e.response?.status !== 204) logError("Zoho Find Lead", e);
    return null;
  }
}

// FIX: Solo buscar por teléfono
async function zohoFindDeal(phone) {
  if (!ZOHO.DEAL_PHONE_FIELD) return null;
  const t = await getZohoToken();
  try {
    const r = await axios.get(
      `${ZOHO.API_DOMAIN}/crm/v2/Deals/search?criteria=(${ZOHO.DEAL_PHONE_FIELD}:equals:${encodeURIComponent(phone)})`,
      { headers: { Authorization: `Zoho-oauthtoken ${t}` } }
    );
    return r.data?.data?.[0];
  } catch (e) {
    if (e.response?.status !== 204) logError("Zoho Find Deal", e);
    return null;
  }
}

async function zohoCreate(module, data) {
  const t = await getZohoToken();
  try {
    const r = await axios.post(
      `${ZOHO.API_DOMAIN}/crm/v2/${module}`,
      { data: [data], trigger: ["workflow"] },
      { headers: { Authorization: `Zoho-oauthtoken ${t}` } }
    );
    return r.data?.data?.[0]?.details?.id;
  } catch (e) {
    logError(`Zoho Create ${module}`, e);
    return null;
  }
}

async function zohoUpdate(module, id, data) {
  const t = await getZohoToken();
  try {
    await axios.put(
      `${ZOHO.API_DOMAIN}/crm/v2/${module}/${id}`,
      { data: [data], trigger: ["workflow"] },
      { headers: { Authorization: `Zoho-oauthtoken ${t}` } }
    );
  } catch (e) {
    logError(`Zoho Update ${module}`, e);
  }
}

async function zohoCloseDeal(dealId) {
  if (!REQUIRE_ZOHO || !dealId) return;
  try {
    await zohoUpdate("Deals", dealId, { Stage: "Cerrado perdido", Description: "Cliente reinició cotización via WhatsApp" });
  } catch (e) {
    logError("Zoho Close Deal", e);
  }
}

async function zohoEnsureDefaultAccountId() {
  try {
    const t = await getZohoToken();
    const name = ZOHO.DEFAULT_ACCOUNT_NAME;
    const r = await axios.get(
      `${ZOHO.API_DOMAIN}/crm/v2/Accounts/search?criteria=(Account_Name:equals:${encodeURIComponent(name)})`,
      { headers: { Authorization: `Zoho-oauthtoken ${t}` } }
    );
    if (r.data?.data?.[0]) return r.data.data[0].id;

    const c = await axios.post(
      `${ZOHO.API_DOMAIN}/crm/v2/Accounts`,
      { data: [{ Account_Name: name }] },
      { headers: { Authorization: `Zoho-oauthtoken ${t}` } }
    );
    return c.data?.data?.[0]?.details?.id;
  } catch (e) {
    logError("Zoho Account", e);
    return null;
  }
}

async function zohoUpsertFull(session, phone) {
  if (!REQUIRE_ZOHO) return;
  const d = session.data;
  const phoneE164 = normalizeCLPhone(phone);

  try {
    // Lead
    let lead = await zohoFindLead(phoneE164);
    const leadData = {
      Last_Name: d.name || `Lead WA`,
      Mobile: phoneE164,
      Lead_Source: "WhatsApp IA",
      Description: `Perfil: ${d.profile || ""}`.trim(),
    };
    if (ZOHO.LEAD_PROFILE_FIELD && d.profile) leadData[ZOHO.LEAD_PROFILE_FIELD] = d.profile;

    if (lead) await zohoUpdate("Leads", lead.id, leadData);
    else await zohoCreate("Leads", leadData);

    // Deal
    let deal = await zohoFindDeal(phoneE164);

    // Stage automático
    const stageKey = computeStageKey(d, session);
    d.stageKey = stageKey;

    const dealData = {
      Deal_Name: `${d.product || "Ventanas"} [WA ${phone.slice(-4)}]`,
      Stage: STAGE_MAP[stageKey] || STAGE_MAP.diagnostico,
      Closing_Date: formatDateZoho(addDays(new Date(), 30)),
      Description: buildZohoDescription(d),
    };

    if (ZOHO.DEAL_PHONE_FIELD) dealData[ZOHO.DEAL_PHONE_FIELD] = phoneE164;

    if (deal) {
      session.zohoDealId = deal.id;
      await zohoUpdate("Deals", deal.id, dealData);
    } else {
      const accId = await zohoEnsureDefaultAccountId();
      if (accId) dealData.Account_Name = { id: accId };
      const newId = await zohoCreate("Deals", dealData);
      session.zohoDealId = newId;
    }
  } catch (e) {
    logError("Zoho Sync", e);
  }
}

// ============================================================
// WEBHOOK (Lógica Final)
// ============================================================
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === META.VERIFY_TOKEN) return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  if (!verifyMetaSignature(req)) return;

  const incoming = extractIncoming(req.body);
  if (!incoming.ok) return;

  const { waId, msgId, type } = incoming;

  if (isDuplicateMsg(msgId)) return;
  const rateC = checkRate(waId);
  if (!rateC.allowed) return waSendText(waId, rateC.msg);

  const release = await acquireLock(waId);
  try {
    const session = getSession(waId);
    session.lastUserAt = Date.now();
    await waMarkReadAndTyping(waId, msgId);

    let userText = incoming.text;

    // AUDIO / IMAGEN
    if (type === "audio" && incoming.audioId) {
      const meta = await waGetMediaMeta(incoming.audioId);
      const { buffer, mime } = await waDownloadMedia(meta.url);
      userText = `[Audio]: ${await transcribeAudio(buffer, mime)}`;
    }
    if (type === "image" && incoming.imageId) {
      const meta = await waGetMediaMeta(incoming.imageId);
      const { buffer, mime } = await waDownloadMedia(meta.url);
      userText = `[Imagen]: ${await describeImage(buffer, mime)}`;
    }

    // RESET
    if (/^reset|nueva cotizaci[oó]n|empezar de nuevo/i.test(userText)) {
      if (session.zohoDealId) await zohoCloseDeal(session.zohoDealId);

      session.data = createEmptySession().data;
      session.data.name = "Cliente";
      session.zohoDealId = null;
      session.pdfSent = false;

      await waSendText(waId, "🔄 *Carpeta Nueva Abierta*\n\nHe guardado el historial anterior. Empecemos de cero.");
      saveSession(waId, session);
      release();
      return;
    }

    // Señal de “cierre” (opcional pero útil)
    if (/(acepto|confirmo|avancemos|hagamos el pedido|quiero comprar|ok coticemos)/i.test(userText)) {
      session.data.stageKey = "cierre";
    }

    session.history.push({ role: "user", content: userText });

    const aiMsg = await runAI(session, userText);

    // TOOLS
    if (aiMsg?.tool_calls) {
      const tc = aiMsg.tool_calls[0];
      if (tc.function.name === "update_customer_data") {
        const args = JSON.parse(tc.function.arguments);
        session.data = { ...session.data, ...args };

        // ─────────────────────────────────────────
        // PRECIO (NUEVO Ferrari 6.5.0)
        // ─────────────────────────────────────────
        if (isComplete(session.data) || args.wants_pdf) {
          const q = quotePriceEngine({
            productText: session.data.product,
            glassText: session.data.glass,
            measuresText: session.data.measures,
          });

          if (q.ok) {
            session.data.internal_price = q.price;
            session.data.price_mode = q.mode;
            session.data.price_key = q.resolved?.key || "";
            session.data.price_rules = q.resolved?.rulesApplied || [];
            session.data.price_warning = q.warning || "";
          } else {
            session.data.internal_price = null;
            session.data.price_mode = "";
            session.data.price_key = "";
            session.data.price_rules = [];
            session.data.price_warning = q.reason || "No se pudo cotizar";
          }
        }

        const shouldSendPDF = isComplete(session.data) && (args.wants_pdf || /pdf|cotiza/i.test(userText));

        if (shouldSendPDF && !session.pdfSent) {
          await waSendText(waId, "Perfecto, genero tu cotización formal... 📄");
          const qNum = generateQuoteNumber();
          const pdfBuf = await createQuotePdf(session.data, qNum);
          const mediaId = await waUploadPdf(pdfBuf);
          await waSendPdfById(waId, mediaId, "Cotización Formal");

          await waSendText(waId, "📄 *Cotización Lista*\n\nEl *Equipo Alfa* ya tiene copia de esto para apoyarte en el cierre.");

          session.pdfSent = true;

          // Zoho: con Stage automático
          await zohoUpsertFull(session, waId);
        } else {
          const follow = await openai.chat.completions.create({
            model: AI_MODEL,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              ...session.history.slice(-12),
              aiMsg,
              { role: "tool", tool_call_id: tc.id, content: "Datos guardados." },
            ],
            temperature: 0.4,
          });

          const reply = follow.choices[0].message.content.replace(/<PROFILE:.*?>/gi, "").trim();
          await waSendText(waId, reply);
          session.history.push({ role: "assistant", content: reply });

          // Zoho siempre (para tener Lead/Deal al día con stage automático)
          zohoUpsertFull(session, waId).catch(() => {});
        }
      }
    } else {
      const reply = aiMsg?.content?.replace(/<PROFILE:.*?>/gi, "").trim() || "No te entendí bien, ¿puedes repetir?";
      await waSendText(waId, reply);
      session.history.push({ role: "assistant", content: reply });
    }

    saveSession(waId, session);
  } catch (e) {
    logError("Critical Webhook", e);
  } finally {
    release();
  }
});

app.listen(PORT, () => console.log(`🚀 Ferrari 6.5.0 ACTIVO`));
