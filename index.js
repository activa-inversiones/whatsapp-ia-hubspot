// index.js — WhatsApp IA + Zoho CRM
// Ferrari 7.1 — COEFFS EXTERNALIZADOS + REGLAS EXACTAS + ZOHO STAGES + TYPING HUMANO
// Node 18+ | Railway | ESM
//
// ────────────────────────────────────────────────────────────
// CHANGELOG
// ─ Ferrari 7.1 (HOY)
//   [1] COEFFS externalizados: carga ./coefficients_v3.json (actualizable sin tocar código).
//   [2] Regla CORREDERA 80 → 98 exacta: si W>=2001 o H>=2001 => CORREDERA_98.
//   [3] Puertas: 1 hoja <=1200×2400; desde 1201 ancho => DOBLE (hasta 2400×2400).
//   [4] Marco fijo: desde 1000×2000 fuerza TP5+12+5.
//   [5] Zoho: busca Deal ACTIVO (no cerrado) y actualiza Stage automáticamente.
//   [6] Traza en Zoho: dataset, reglas aplicadas, modo, advertencias.
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
import fs from "fs";

dotenv.config();

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const app = express();

app.use(
  express.json({
    limit: "20mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ============================================================
// HELPER LOGS
// ============================================================
function logError(context, e) {
  if (e.response) {
    console.error(`❌ ${context} [API]: ${e.response.status} - ${JSON.stringify(e.response.data).slice(0, 200)}...`);
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

// ============================================================
// MOTOR DE PRECIOS — Ferrari 7.1 (COEFFS EXTERNALIZADOS)
// ============================================================

// 1) Normalizar medidas (acepta mm, cm, m)
function normalizeMeasures(measures) {
  const t = String(measures || "").toLowerCase();
  const nums = t.match(/(\d+([.,]\d+)?)/g);
  if (!nums || nums.length < 2) return null;

  let a = parseFloat(nums[0].replace(",", "."));
  let b = parseFloat(nums[1].replace(",", "."));

  // m → mm
  if (a < 10) a *= 1000;
  if (b < 10) b *= 1000;
  // cm → mm
  if (a >= 10 && a < 100) a *= 10;
  if (b >= 10 && b < 100) b *= 10;

  const ancho_mm = Math.round(a);
  const alto_mm = Math.round(b);

  return { ancho_mm, alto_mm };
}

// 2) Normalizar color (agrupa NEGRO/ANTRACITA/GRAFITO y NOGAL/ROBLE)
function normalizeColorFromText(text = "") {
  const s = stripAccents(text).toUpperCase();
  if (s.includes("ANTRAC") || s.includes("GRAF") || s.includes("NEG")) return "NEGRO";
  if (s.includes("ROBLE") || s.includes("NOG")) return "NOGAL";
  return "BLANCO";
}

// 3) Normalizar producto (desde texto libre)
function normalizeProduct(productRaw = "") {
  const s = stripAccents(productRaw).toUpperCase();
  if (s.includes("PUERTA") && (s.includes("DOBLE") || s.includes("2 HOJ") || s.includes("DOS HOJ"))) return "PUERTA_DOBLE";
  if (s.includes("PUERTA")) return "PUERTA_1H";
  if (s.includes("PROYEC")) return "PROYECTANTE";
  if (s.includes("MARCO") || s.includes("FIJO") || s.includes("PANO FIJO") || s.includes("PAÑO FIJO")) return "MARCO_FIJO";
  if (s.includes("OSCILO")) return "OSCILOBATIENTE";
  if (s.includes("ABAT")) return "ABATIBLE";
  if (s.includes("CORREDERA") && s.includes("98")) return "CORREDERA_98";
  if (s.includes("CORREDERA") && s.includes("80")) return "CORREDERA_80";
  if (s.includes("CORREDERA")) return "CORREDERA_80";
  return "";
}

// 4) Vidrio: por reglas del negocio, siempre Termopanel.
//    Igual normalizamos por si el texto incluye 5+12+5 o 4+12+4.
function normalizeGlass(glassRaw = "", defaultGlass = "TP4+12+4") {
  const s = stripAccents(glassRaw).toUpperCase();
  if (s.includes("5") && s.includes("12") && s.includes("5")) return "TP5+12+5";
  if (s.includes("4") && s.includes("12") && s.includes("4")) return "TP4+12+4";
  return defaultGlass;
}

// 5) Ecuación cuadrática: a + bW + cH + dWH + eW² + fH²
function priceFromCoeffs(coeffs, W, H) {
  const { a, b, c, d, e, f } = coeffs;
  const p = a + b * W + c * H + d * W * H + e * W * W + f * H * H;
  return Math.max(0, Math.round(p));
}

// 6) Cargar COEFFS desde archivo (ideal para mantener precios sin tocar código)
function loadCoeffs() {
  const path = process.env.PRICE_COEFFS_PATH || "./coefficients_v3.json";
  try {
    if (fs.existsSync(path)) {
      const raw = fs.readFileSync(path, "utf-8");
      const json = JSON.parse(raw);
      console.log(`✅ COEFFS cargados desde ${path} (${Object.keys(json).length} keys)`);
      return json;
    }
  } catch (e) {
    console.error("⚠️ No pude cargar COEFFS externos, usaré fallback interno.");
    logError("loadCoeffs", e);
  }
  return {}; // fallback vacío
}

const COEFFS = loadCoeffs();

// 7) Reglas de selección de dataset (TU LÓGICA)
function resolvePricingKey({ product, colorText, glass, W, H }) {
  let model = product;
  const COLOR = normalizeColorFromText(colorText);
  let GLASS = glass;
  const rulesApplied = [];

  if (!model) return { ok: false, reason: "Producto no reconocido" };

  // PROYECTANTE máximo 1400×1400
  if (model === "PROYECTANTE" && (W > 1400 || H > 1400)) {
    return {
      ok: false,
      reason: "PROYECTANTE solo se fabrica hasta 1400×1400 mm. Para medidas mayores, te sugiero Corredera 80/98 u Oscilobatiente.",
    };
  }

  // MARCO FIJO: auto TP5+12+5 desde 1000×2000
  if (model === "MARCO_FIJO" && (W >= 1000 && H >= 2000)) {
    GLASS = "TP5+12+5";
    rulesApplied.push("MARCO_FIJO => TP5+12+5 (>=1000×2000)");
  }

  // PUERTAS: 1 hoja <=1200×2400, desde 1201 ancho => doble (hasta 2400×2400)
  if (model === "PUERTA_1H") {
    if (W <= 1200 && H <= 2400) {
      rulesApplied.push("PUERTA 1 HOJA (<=1200×2400)");
    } else if (W >= 1201 && W <= 2400 && H <= 2400) {
      model = "PUERTA_DOBLE";
      rulesApplied.push("PUERTA => DOBLE HOJA (ancho >=1201)");
    } else {
      return { ok: false, reason: "Puerta 1 hoja: máximo 1200mm ancho × 2400mm alto." };
    }
    GLASS = "TP5+12+5";
    rulesApplied.push("PUERTA => TP5+12+5 (regla fija)");
  }

  if (model === "PUERTA_DOBLE") {
    if (W < 600 || W > 2400) return { ok: false, reason: "Puerta doble: ancho entre 600mm y 2400mm." };
    if (H > 2400) return { ok: false, reason: "Puerta doble: alto máximo 2400mm." };
    GLASS = "TP5+12+5";
    rulesApplied.push("PUERTA DOBLE => TP5+12+5 (regla fija)");
  }

  // CORREDERA 80: 400×400 hasta 2000×2000; desde >=2001 en cualquier eje => 98
  if (model === "CORREDERA_80") {
    if (W < 400 || H < 400) return { ok: false, reason: "CORREDERA 80 mínimo 400×400 mm" };
    if (W >= 2001 || H >= 2001) {
      model = "CORREDERA_98";
      rulesApplied.push("CORREDERA_80 => CORREDERA_98 (W>=2001 o H>=2001)");
    }
  }

  // Si el cliente escribe "corredera 98" explícito, se respeta.
  // (normalizeProduct ya lo maneja)

  const key = `${model}::${COLOR}::${GLASS}`;
  return { ok: true, model, color: COLOR, glass: GLASS, key, rulesApplied };
}

// 8) Motor principal
function quotePriceEngine({ productText, glassText, measuresText, colorText }) {
  const m = normalizeMeasures(measuresText);
  if (!m) return { ok: false, reason: "No pude leer las medidas. Ej: 1200×1200 o 1.2×1.2" };

  const W = m.ancho_mm;
  const H = m.alto_mm;

  const product = normalizeProduct(productText);
  const glass = normalizeGlass(glassText || "", "TP4+12+4");
  const colorCtx = `${productText} ${colorText || ""} ${glassText || ""}`;

  const resolved = resolvePricingKey({ product, colorText: colorCtx, glass, W, H });
  if (!resolved.ok) return resolved;

  const coeffs = COEFFS[resolved.key];
  if (!coeffs) {
    return {
      ok: false,
      reason: `No tengo ecuación cargada para ${resolved.key}. Escalaré a Equipo Alfa para cotización manual.`,
      resolved,
      measures: m,
    };
  }

  const price = priceFromCoeffs(coeffs, W, H);
  return { ok: true, price, mode: "equation", resolved, measures: m };
}

// ============================================================
// ZOHO: Stage automático
// ============================================================
function computeStageKey(d, session) {
  if (d.stageKey === "cierre") return "cierre";
  if (session.pdfSent) return "propuesta";
  const hasProduct = !!d.product;
  const hasMeasures = !!d.measures;
  const hasComuna = !!(d.comuna || d.address);
  const hasColor = !!d.color;
  if (hasProduct && hasColor && hasMeasures && hasComuna) return "validacion";
  if (hasProduct || hasMeasures) return "siembra";
  return "diagnostico";
}

function buildZohoDescription(d) {
  const lines = [];
  lines.push(`Producto: ${d.product || ""}`.trim());
  lines.push(`Color: ${d.color || ""}`.trim());
  lines.push(`Medidas: ${d.measures || ""}`.trim());
  lines.push(`Vidrio: ${d.glass || "Termopanel"}`.trim());
  if (d.internal_price) lines.push(`Precio: $${Number(d.internal_price).toLocaleString("es-CL")} + IVA`);
  if (d.price_mode) lines.push(`Modo precio: ${d.price_mode}`);
  if (d.price_key) lines.push(`Dataset: ${d.price_key}`);
  if (d.price_rules && d.price_rules.length) lines.push(`Reglas: ${d.price_rules.join(" | ")}`);
  if (d.price_warning) lines.push(`Aviso: ${d.price_warning}`);
  return lines.filter(Boolean).join("\n");
}

// ============================================================
// FECHAS / UTILS
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
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `COT-${y}${m}${d}-${rand}`;
}

// ============================================================
// TYPING HUMANO
// ============================================================
function humanDelayMs(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  const base = 1500 + Math.min(6500, words * 180);
  const jitter = base * (0.8 + Math.random() * 0.4);
  return Math.round(jitter);
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
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
}

async function waSendText(to, text) {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  try {
    await axios.post(url, { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
      { headers: { Authorization: `Bearer ${META.TOKEN}` }, timeout: 20000 });
  } catch (e) { logError("WA Send Text", e); }
}

async function waSetTyping(to) {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  try {
    await axios.post(url, { messaging_product: "whatsapp", to, typing_indicator: { type: "text" } },
      { headers: { Authorization: `Bearer ${META.TOKEN}` }, timeout: 5000 });
  } catch { /* ignore */ }
}

async function waSendTextHuman(to, text) {
  await waSetTyping(to);
  await sleep(humanDelayMs(text));
  await waSendText(to, text);
}

async function waSendMultipleHuman(to, messages) {
  for (const msg of messages) {
    if (!msg || !msg.trim()) continue;
    await waSetTyping(to);
    await sleep(humanDelayMs(msg));
    await waSendText(to, msg);
    await sleep(400 + Math.random() * 600);
  }
}

async function waMarkRead(messageId) {
  if (!messageId) return;
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  try {
    await axios.post(url, { messaging_product: "whatsapp", status: "read", message_id: messageId },
      { headers: { Authorization: `Bearer ${META.TOKEN}` } });
  } catch { /* ignore */ }
}

async function waUploadPdf(buffer, filename = "Cotizacion.pdf") {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/media`;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buffer, { filename, contentType: "application/pdf" });
  try {
    const r = await axios.post(url, form, { headers: { Authorization: `Bearer ${META.TOKEN}`, ...form.getHeaders() }, maxBodyLength: Infinity });
    return r.data.id;
  } catch (e) { logError("WA Upload PDF", e); throw e; }
}

async function waSendPdfById(to, mediaId, caption, filename = "Cotizacion.pdf") {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  try {
    await axios.post(url, { messaging_product: "whatsapp", to, type: "document", document: { id: mediaId, filename, caption } },
      { headers: { Authorization: `Bearer ${META.TOKEN}` } });
  } catch (e) { logError("WA Send PDF", e); }
}

async function waGetMediaMeta(mediaId) {
  const url = `${waBase()}/${mediaId}`;
  const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${META.TOKEN}` } });
  return data;
}

async function waDownloadMedia(mediaUrl) {
  const { data, headers } = await axios.get(mediaUrl, { responseType: "arraybuffer", headers: { Authorization: `Bearer ${META.TOKEN}` } });
  return { buffer: Buffer.from(data), mime: headers["content-type"] || "application/octet-stream" };
}

// ============================================================
// MEDIA PROCESSING
// ============================================================
async function transcribeAudio(buffer, mime) {
  try {
    const file = await toFile(buffer, "audio.ogg", { type: mime });
    const r = await openai.audio.transcriptions.create({ model: STT_MODEL, file, language: "es" });
    return (r.text || "").trim();
  } catch (e) { logError("OpenAI Audio", e); return ""; }
}

async function describeImage(buffer, mime) {
  try {
    const b64 = buffer.toString("base64");
    const dataUrl = `data:${mime};base64,${b64}`;
    const prompt = "Describe brevemente la imagen y extrae datos útiles para cotizar ventanas/puertas: producto, medidas, color, comuna. Responde en español.";
    const resp = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUrl } }] }],
      max_tokens: 250,
    });
    return (resp.choices?.[0]?.message?.content || "").trim();
  } catch (e) { logError("OpenAI Vision", e); return ""; }
}

async function parsePdfToText(buffer) {
  try {
    const r = await pdfParse(buffer);
    const text = (r?.text || "").trim();
    return text.length > 6000 ? text.slice(0, 6000) + "\n..." : text;
  } catch { return ""; }
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
      color: "",
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
      price_mode: "",
      price_key: "",
      price_rules: [],
      price_warning: "",
    },
    history: [],
    pdfSent: false,
    quoteNumber: null,
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
  return () => { release(); locks.delete(waId); };
}

const rate = new Map();
function checkRate(waId) {
  const now = Date.now();
  if (!rate.has(waId)) rate.set(waId, { count: 1, resetAt: now + 60000 });
  const r = rate.get(waId);
  if (now >= r.resetAt) { r.count = 1; r.resetAt = now + 60000; return { allowed: true }; }
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

  let text = "";
  if (type === "text") text = msg.text?.body || "";
  else if (type === "button") text = msg.button?.text || "";
  else if (type === "interactive") text = JSON.stringify(msg.interactive || {});
  else text = `[${type}]`;

  return { ok: true, waId, msgId, type, text, audioId, imageId };
}

// ============================================================
// LÓGICA DE NEGOCIO (mínimos para precio)
// ============================================================
function nextMissingKey(d) {
  if (!d.product) return "producto";
  if (!d.color) return "color";
  if (!d.measures) return "medidas";
  if (!d.address && !d.comuna) return "comuna";
  return "";
}

function isComplete(d) {
  return !!(d.product && d.color && d.measures && (d.address || d.comuna));
}

// ============================================================
// PROMPT & TOOLS
// ============================================================
const tools = [
  {
    type: "function",
    function: {
      name: "update_customer_data",
      description: "Actualiza datos del cliente. El vidrio SIEMPRE es Termopanel (no preguntar).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          product: { type: "string" },
          color: { type: "string" },
          measures: { type: "string" },
          address: { type: "string" },
          comuna: { type: "string" },
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

- Conversas humano y chileno.
- NO presionas.
- Pides datos de a uno.
- Máximo 3-4 líneas por mensaje; si es largo, separa en varios.

VIDRIO:
- Siempre cotizamos con Termopanel (DVH). No preguntes vidrio.

Al final agrega SOLO 1 tag:
<PROFILE:PRECIO> <PROFILE:CALIDAD> <PROFILE:TECNICO> <PROFILE:AFINIDAD>
`.trim();

async function runAI(session, userText) {
  const d = session.data;
  const missingKey = nextMissingKey(d);
  const complete = isComplete(d);

  const statusMsg = complete
    ? "DATOS COMPLETOS. Puedes confirmar si quiere PDF."
    : `FALTA: "${missingKey}". Pídelo amablemente.`;

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
      max_tokens: 350,
    });

    const aiMsg = resp.choices?.[0]?.message;
    if (aiMsg?.content) {
      const match = aiMsg.content.match(/<PROFILE:(\w+)>/i);
      if (match) session.data.profile = match[1].toUpperCase();
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
      doc.fillColor("#4a5568").fontSize(9).text(`Fecha: ${formatDateCL()}`, 400, 110, { align: "right", width: 150 });

      doc.y = 160;
      doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("DETALLE", 50);
      doc.moveDown(0.5);
      doc.fillColor("#4a5568").fontSize(10).font("Helvetica");
      doc.text(`Producto: ${data.product || "Por confirmar"}`);
      doc.text(`Color: ${data.color || "Por confirmar"}`);
      doc.text(`Medidas: ${data.measures || "Por confirmar"}`);
      doc.text(`Vidrio: ${data.glass || "Termopanel (DVH)"}`);
      if (data.install) doc.text(`Instalación: ${data.install}`);

      doc.moveDown(1);
      doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("VALOR ESTIMADO");
      const precioTexto = data.internal_price
        ? `$ ${Number(data.internal_price).toLocaleString("es-CL")} + IVA (Referencial)`
        : "Por confirmar (requiere revisión técnica).";

      doc.rect(50, doc.y + 5, 512, 40).fill("#f7fafc");
      doc.fillColor(primaryColor).fontSize(14).text(precioTexto, 60, doc.y + 18, { align: "center", width: 490 });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ============================================================
// ZOHO CRM — Deal activo (no pisa cerrados)
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
  const { data } = await axios.post(url, params.toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  zohoCache.token = data.access_token;
  zohoCache.expiresAt = Date.now() + data.expires_in * 1000 - 60000;
  return zohoCache.token;
}

async function getZohoToken() {
  if (!REQUIRE_ZOHO) return "";
  if (zohoCache.token && Date.now() < zohoCache.expiresAt) return zohoCache.token;
  if (tokenRefreshPromise) return tokenRefreshPromise;
  tokenRefreshPromise = refreshZohoToken();
  try { return await tokenRefreshPromise; } finally { tokenRefreshPromise = null; }
}

async function zohoCreate(module, data) {
  const t = await getZohoToken();
  try {
    const r = await axios.post(`${ZOHO.API_DOMAIN}/crm/v2/${module}`, { data: [data], trigger: ["workflow"] },
      { headers: { Authorization: `Zoho-oauthtoken ${t}` } });
    return r.data?.data?.[0]?.details?.id;
  } catch (e) { logError(`Zoho Create ${module}`, e); return null; }
}

async function zohoUpdate(module, id, data) {
  const t = await getZohoToken();
  try {
    await axios.put(`${ZOHO.API_DOMAIN}/crm/v2/${module}/${id}`, { data: [data], trigger: ["workflow"] },
      { headers: { Authorization: `Zoho-oauthtoken ${t}` } });
  } catch (e) { logError(`Zoho Update ${module}`, e); }
}

async function zohoEnsureDefaultAccountId() {
  try {
    const t = await getZohoToken();
    const name = ZOHO.DEFAULT_ACCOUNT_NAME;
    const r = await axios.get(`${ZOHO.API_DOMAIN}/crm/v2/Accounts/search?criteria=(Account_Name:equals:${encodeURIComponent(name)})`,
      { headers: { Authorization: `Zoho-oauthtoken ${t}` } });
    if (r.data?.data?.[0]) return r.data.data[0].id;

    const c = await axios.post(`${ZOHO.API_DOMAIN}/crm/v2/Accounts`, { data: [{ Account_Name: name }] },
      { headers: { Authorization: `Zoho-oauthtoken ${t}` } });
    return c.data?.data?.[0]?.details?.id;
  } catch (e) { logError("Zoho Account", e); return null; }
}

// Buscar Deal activo (no cerrado)
async function zohoFindActiveDeal(phoneE164) {
  if (!ZOHO.DEAL_PHONE_FIELD) return null;
  const t = await getZohoToken();
  try {
    const r = await axios.get(`${ZOHO.API_DOMAIN}/crm/v2/Deals/search?criteria=(${ZOHO.DEAL_PHONE_FIELD}:equals:${encodeURIComponent(phoneE164)})`,
      { headers: { Authorization: `Zoho-oauthtoken ${t}` } });

    const deals = r.data?.data || [];
    const closedStages = [
      STAGE_MAP.ganado, STAGE_MAP.perdido, STAGE_MAP.competencia,
      "Cerrado ganado", "Cerrado perdido",
    ];
    return deals.find((d) => !closedStages.includes(d.Stage)) || null;
  } catch (e) {
    if (e.response?.status !== 204) logError("Zoho Find Deal", e);
    return null;
  }
}

async function zohoUpsertDeal(session, waId) {
  if (!REQUIRE_ZOHO) return;
  const d = session.data;
  const phoneE164 = normalizeCLPhone(waId);

  const stageKey = computeStageKey(d, session);
  d.stageKey = stageKey;

  const dealData = {
    Deal_Name: `${d.product || "Ventanas"} ${d.color || ""} [WA ${String(waId).slice(-4)}]`.trim(),
    Stage: STAGE_MAP[stageKey] || STAGE_MAP.diagnostico,
    Closing_Date: formatDateZoho(addDays(new Date(), 30)),
    Description: buildZohoDescription(d),
  };
  if (ZOHO.DEAL_PHONE_FIELD) dealData[ZOHO.DEAL_PHONE_FIELD] = phoneE164;

  const active = await zohoFindActiveDeal(phoneE164);
  if (active?.id) {
    session.zohoDealId = active.id;
    await zohoUpdate("Deals", active.id, dealData);
  } else {
    const accId = await zohoEnsureDefaultAccountId();
    if (accId) dealData.Account_Name = { id: accId };
    const newId = await zohoCreate("Deals", dealData);
    session.zohoDealId = newId;
  }
}

// ============================================================
// WEBHOOK
// ============================================================
app.get("/health", (_req, res) => res.json({ ok: true, version: "Ferrari 7.1", coeffs: Object.keys(COEFFS).length }));

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
    await waMarkRead(msgId);
    await waSetTyping(waId);

    let userText = incoming.text;

    // AUDIO
    if (type === "audio" && incoming.audioId) {
      const meta = await waGetMediaMeta(incoming.audioId);
      const { buffer, mime } = await waDownloadMedia(meta.url);
      const t = await transcribeAudio(buffer, mime);
      userText = t ? `[Audio]: ${t}` : "[Audio no reconocido]";
    }

    // IMAGEN
    if (type === "image" && incoming.imageId) {
      const meta = await waGetMediaMeta(incoming.imageId);
      const { buffer, mime } = await waDownloadMedia(meta.url);
      userText = `[Imagen]: ${await describeImage(buffer, mime)}`;
    }

    // RESET
    if (/^reset|nueva cotizaci[oó]n|empezar de nuevo/i.test(userText)) {
      session.data = createEmptySession().data;
      session.data.name = "Cliente";
      session.pdfSent = false;
      await waSendTextHuman(waId, "🔄 Listo. Partamos de cero.\n¿Qué tipo de ventana/puerta necesitas?");
      saveSession(waId, session);
      release();
      return;
    }

    session.history.push({ role: "user", content: userText });

    const typingInterval = setInterval(() => waSetTyping(waId), 4000);
    const aiMsg = await runAI(session, userText);
    clearInterval(typingInterval);

    // TOOL CALL
    if (aiMsg?.tool_calls) {
      const tc = aiMsg.tool_calls[0];
      if (tc.function.name === "update_customer_data") {
        const args = JSON.parse(tc.function.arguments);

        // Merge datos
        for (const [k, v] of Object.entries(args)) {
          if (v !== undefined && v !== null && v !== "") session.data[k] = v;
        }

        // Vidrio automático (reglas)
        if (!session.data.glass) {
          const p = normalizeProduct(session.data.product);
          session.data.glass = (p === "PUERTA_1H" || p === "PUERTA_DOBLE") ? "TP5+12+5" : "TP4+12+4";
        }

        // PRECIO (solo cuando hay mínimo para cotizar)
        if (isComplete(session.data) || args.wants_pdf) {
          const q = quotePriceEngine({
            productText: session.data.product,
            glassText: session.data.glass,
            measuresText: session.data.measures,
            colorText: session.data.color,
          });

          if (q.ok) {
            session.data.internal_price = q.price;
            session.data.price_mode = q.mode;
            session.data.price_key = q.resolved?.key || "";
            session.data.price_rules = q.resolved?.rulesApplied || [];
            session.data.price_warning = "";
          } else {
            session.data.internal_price = null;
            session.data.price_mode = "";
            session.data.price_key = q.resolved?.key || "";
            session.data.price_rules = q.resolved?.rulesApplied || [];
            session.data.price_warning = q.reason || "No se pudo cotizar";
          }
        }

        const shouldSendPDF = isComplete(session.data) && (args.wants_pdf || /pdf|cotiza/i.test(userText));

        if (shouldSendPDF && !session.pdfSent) {
          await waSendTextHuman(waId, "Perfecto, te preparo la cotización formal... 📄");
          try {
            const qNum = generateQuoteNumber();
            session.quoteNumber = qNum;
            const pdfBuf = await createQuotePdf(session.data, qNum);
            const mediaId = await waUploadPdf(pdfBuf);
            await waSendPdfById(waId, mediaId, `Cotización ${qNum} - ${COMPANY.NAME}`, `Cotizacion_${qNum}.pdf`);
            session.pdfSent = true;
          } catch (e) {
            logError("PDF Generation", e);
            await waSendTextHuman(waId, "Tuve un inconveniente generando el PDF. El *Equipo Alfa* te lo enviará manualmente en breve 🙏");
          }
          await zohoUpsertDeal(session, waId);
        } else {
          // Follow-up para conversación
          const follow = await openai.chat.completions.create({
            model: AI_MODEL,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              ...session.history.slice(-12),
              aiMsg,
              { role: "tool", tool_call_id: tc.id, content: "Datos guardados." },
            ],
            temperature: 0.4,
            max_tokens: 260,
          });

          const reply = follow.choices[0].message.content.replace(/<PROFILE:.*?>/gi, "").trim();
          const parts = reply.split(/\n\n+/).filter(Boolean);
          if (parts.length > 1) await waSendMultipleHuman(waId, parts);
          else await waSendTextHuman(waId, reply);

          session.history.push({ role: "assistant", content: reply });

          // Sync Zoho en background
          zohoUpsertDeal(session, waId).catch(() => {});
        }
      }
    } else {
      // Respuesta directa
      const reply = aiMsg?.content?.replace(/<PROFILE:.*?>/gi, "").trim() || "No te entendí bien, ¿me lo repites?";
      const parts = reply.split(/\n\n+/).filter(Boolean);
      if (parts.length > 1) await waSendMultipleHuman(waId, parts);
      else await waSendTextHuman(waId, reply);
      session.history.push({ role: "assistant", content: reply });
    }

    saveSession(waId, session);
  } catch (e) {
    logError("Critical Webhook", e);
  } finally {
    release();
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Ferrari 7.1 ACTIVO — coeffs=${Object.keys(COEFFS).length} — ${new Date().toLocaleString("es-CL", { timeZone: TZ })}`);
});
