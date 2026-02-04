// index.js — WhatsApp IA + Zoho CRM
// Ferrari 6.1.1 — Versión Final Producción (Bugfix + Audio/Imagen + FollowUp Natural)
// Node 18+ | Railway | ESM

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

// 🔴 CONFIGURACIÓN: PDF MANUAL (Freno de mano activado para venta consultiva)
const AUTO_SEND_PDF_WHEN_READY = false;

// ----- Zoho -----
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

// ----- Empresa (para PDF) -----
const COMPANY = {
  NAME: process.env.COMPANY_NAME || "Activa Inversiones",
  PHONE: process.env.COMPANY_PHONE || "+56 9 1234 5678",
  EMAIL: process.env.COMPANY_EMAIL || "ventas@activa.cl",
  ADDRESS: process.env.COMPANY_ADDRESS || "Temuco, La Araucanía, Chile",
  WEBSITE: process.env.COMPANY_WEBSITE || "www.activa.cl",
  RUT: process.env.COMPANY_RUT || "76.XXX.XXX-X",
};

// ---------- Etapas del Pipeline ----------
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
// VALIDACIÓN DE ENV
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

// ============================================================
// OPENAI CLIENT
// ============================================================
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
// MOTOR DE PRECIOS
// ============================================================
function normalizeMeasures(measures) {
  const t = String(measures || "").toLowerCase();
  let nums = t.match(/(\d+([.,]\d+)?)/g);
  if (!nums || nums.length < 2) return null;
  
  let a = parseFloat(nums[0].replace(',', '.'));
  let b = parseFloat(nums[1].replace(',', '.'));
  
  if (a < 10) a *= 1000; // m -> mm
  if (b < 10) b *= 1000;
  if (a >= 10 && a < 100) a *= 10; // cm -> mm
  if (b >= 10 && b < 100) b *= 10;
  
  return { ancho_mm: Math.round(a), alto_mm: Math.round(b) };
}

function calculateInternalPrice({ ancho_mm, alto_mm, color, glass }) {
  if (!ancho_mm || !alto_mm) return 0;
  const area = (ancho_mm * alto_mm) / 1_000_000; 
  let base = area * 120000; // PRECIO BASE REFERENCIAL POR M2

  const colorUpper = String(color || "").toUpperCase();
  const glassUpper = String(glass || "").toUpperCase();

  if (["NEGRO", "ANTRACITA", "GRAFITO", "NOGAL"].some(c => colorUpper.includes(c))) base *= 1.15;
  if (/TERMOPANEL|DVH|6-12-6|LOW/.test(glassUpper)) base *= 1.25;
  
  return Math.max(Math.round(base), 50000);
}

function formatDateZoho(date = new Date()) {
  return date.toISOString().split("T")[0];
}

function formatDateCL(date = new Date()) {
  return date.toLocaleDateString("es-CL", { 
    timeZone: TZ, 
    day: "2-digit", 
    month: "2-digit", 
    year: "numeric" 
  });
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
// MÉTRICAS
// ============================================================
const metrics = {
  messagesReceived: 0,
  messagesSent: 0,
  pdfsSent: 0,
  zohoUpserts: 0,
  zohoErrors: 0,
  openaiCalls: 0,
  errors: 0,
  startedAt: Date.now(),
};

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
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body: text } };
  const r = await axios.post(url, payload, { headers: { Authorization: `Bearer ${META.TOKEN}` }, timeout: 20000 });
  metrics.messagesSent++;
  return r.data;
}

// 🔴 FIX: waMarkReadAndTyping ahora recibe waId correctamente
async function waMarkReadAndTyping(waId, messageId) {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  try {
    if (messageId) {
      await axios.post(url, { messaging_product: "whatsapp", status: "read", message_id: messageId }, { headers: { Authorization: `Bearer ${META.TOKEN}` } });
    }
    if (waId) {
      await axios.post(url, { messaging_product: "whatsapp", to: waId, typing_indicator: { type: "text" } }, { headers: { Authorization: `Bearer ${META.TOKEN}` } });
    }
  } catch (e) { }
}

async function waUploadPdf(buffer, filename = "Cotizacion.pdf") {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/media`;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buffer, { filename, contentType: "application/pdf" });
  const r = await axios.post(url, form, { headers: { Authorization: `Bearer ${META.TOKEN}`, ...form.getHeaders() }, maxBodyLength: Infinity });
  return r.data.id;
}

async function waSendPdfById(to, mediaId, caption, filename = "Cotizacion.pdf") {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "document", document: { id: mediaId, filename, caption } };
  await axios.post(url, payload, { headers: { Authorization: `Bearer ${META.TOKEN}` } });
  metrics.pdfsSent++;
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
// MEDIA PROCESSING (Restaurado)
// ============================================================
async function transcribeAudio(buffer, mime) {
  const file = await toFile(buffer, "audio.ogg", { type: mime });
  const r = await openai.audio.transcriptions.create({ model: STT_MODEL, file, language: "es" });
  metrics.openaiCalls++;
  return (r.text || "").trim();
}

async function describeImage(buffer, mime) {
  const b64 = buffer.toString("base64");
  const dataUrl = `data:${mime};base64,${b64}`;
  const prompt = `Describe brevemente la imagen y extrae datos útiles para cotizar ventanas/puertas:
- producto
- medidas (si aparecen)
- comuna
- vidrio
Responde en español, máximo 6 líneas.`;
  const resp = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUrl } }] }],
    max_tokens: 250,
  });
  metrics.openaiCalls++;
  return (resp.choices?.[0]?.message?.content || "").trim();
}

async function parsePdfToText(buffer) {
  const r = await pdfParse(buffer);
  const text = (r?.text || "").trim();
  return text.length > 6000 ? text.slice(0, 6000) + "\n..." : text;
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
      name: "", product: "", measures: "", address: "", comuna: "", glass: "", install: "",
      wants_pdf: false, notes: "", profile: "", stageKey: "diagnostico", internal_price: null
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
  const p = new Promise(r => release = r);
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
// WEBHOOK EXTRACTION (Mejorada 6.1.1)
// ============================================================
function extractIncoming(reqBody) {
  const entry = reqBody?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;

  if (value?.statuses?.length) {
    const status = value.statuses[0];
    if (status.status === "failed") console.error("❌ MSG_FAILED:", status.id, status.errors);
    else console.log(`📊 MSG_STATUS: ${status.id} → ${status.status}`);
    return { ok: false, reason: "status_update", statusData: status };
  }

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

function bumpStage(session, nextKey) {
  session.data.stageKey = nextKey;
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

const TONE_INSTRUCTIONS = {
  PRECIO: `Cliente sensible al precio. Enfócate en durabilidad y evitar doble gasto.`,
  CALIDAD: `Cliente busca premium. Habla de terminaciones y garantía.`,
  TECNICO: `Cliente técnico. Datos directos: termopanel, perfiles, normativa.`,
  AFINIDAD: `Cliente compra por confianza. Respuesta cálida, usa su nombre.`,
};

const SYSTEM_PROMPT = `
Eres el vendedor experto de ${COMPANY.NAME}.
Tu misión es orientar, educar y cotizar correctamente, no solo tomar pedidos.

Vendes con enfoque de VENTA CONSULTIVA:
ayudas al cliente a tomar una buena decisión, aunque no seas el más barato.

────────────────────────
TU PERSONALIDAD
────────────────────────
- Eres humano, cercano y profesional, con tono chileno natural.
- NO eres un formulario ni un bot rígido.
- Si el cliente escribe desordenado, manda fotos, audios o listas a mano,
  lo entiendes, agradeces y ordenas con calma.
- Primero generas confianza, luego pides datos.
- Explicas el porqué de las cosas, sin dar clases ni sermonear.

────────────────────────
CÓMO HABLAS DE PRECIOS
────────────────────────
- Puedes dar valores referenciales u orientativos.
- Nunca inventes precios exactos.
- El valor exacto siempre va en la cotización formal (PDF),
  explicando que es para evitar errores y problemas posteriores.

────────────────────────
REGLAS DE ORO
────────────────────────
1. NUNCA inventes precios ni medidas.
2. Si falta información, NO preguntes como robot.
   Usa frases humanas:
   “Perfecto, para afinar el lápiz y que no falle después,
    necesito confirmar X.”
3. Si el cliente envía fotos o audios:
   SIEMPRE confirma recepción y comenta algo útil.
   Ejemplo:
   “Buena foto 👍 ahí se ve clarito el ventanal corredizo.”
4. Tu objetivo es:
   - Enviar la cotización en PDF
   - Explicar brevemente qué incluye
   - Indicar que el Equipo Alfa (humanos) apoyará el cierre

────────────────────────
TRASPASO A HUMANOS
────────────────────────
Después de enviar la cotización, informa de forma natural:

“Desde aquí, uno de nuestros consultores del Equipo Alfa
puede apoyarte directamente para revisar el proyecto
y resolver cualquier duda antes de avanzar.”

Al final de tu respuesta, usa el tag interno si detectas perfil:
`.trim();

async function runAI(session, userText) {
  const d = session.data;
  const missingKey = nextMissingKey(d);
  const complete = isComplete(d);
  const profileHint = d.profile ? `Perfil detectado: ${d.profile}. ${TONE_INSTRUCTIONS[d.profile] || ""}` : "";
  const statusMsg = complete
    ? "✅ DATOS COMPLETOS. Confirma si quiere PDF formal."
    : `⚠️ FALTA: "${missingKey}". Conversa o pídelo amablemente.`;

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: profileHint },
    { role: "system", content: statusMsg },
    { role: "system", content: `Memoria actual:\n${JSON.stringify(d, null, 2)}` },
    // 🔴 FIX: Historial aumentado a 12 para mejor contexto en ventas consultivas
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
    metrics.openaiCalls++;
    return resp.choices?.[0]?.message;
  } catch (e) {
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
      doc.on("data", c => chunks.push(c));
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
        ["Producto", data.product], ["Medidas", data.measures],
        ["Vidrio", data.glass], ["Instalación", data.install], ["Notas", data.notes]
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
      if (data.internal_price) precioTexto = `$ ${data.internal_price.toLocaleString('es-CL')} + IVA (Referencial)`;
      
      doc.rect(50, doc.y + 5, 512, 40).fill("#f7fafc");
      doc.fillColor(primaryColor).fontSize(14).text(precioTexto, 60, doc.y + 18, { align: "center", width: 490 });

      doc.end();
    } catch (e) { reject(e); }
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
  const { data } = await axios.post(url, params.toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  zohoCache.token = data.access_token;
  zohoCache.expiresAt = Date.now() + (data.expires_in * 1000) - 60000;
  return zohoCache.token;
}

async function getZohoToken() {
  if (!REQUIRE_ZOHO) return "";
  if (zohoCache.token && Date.now() < zohoCache.expiresAt) return zohoCache.token;
  if (tokenRefreshPromise) return tokenRefreshPromise;
  tokenRefreshPromise = refreshZohoToken();
  try { return await tokenRefreshPromise; } finally { tokenRefreshPromise = null; }
}

async function zohoFindLead(phone) {
  const t = await getZohoToken();
  const r = await axios.get(`${ZOHO.API_DOMAIN}/crm/v2/Leads/search?criteria=(Mobile:equals:${encodeURIComponent(phone)})`, { headers: { Authorization: `Zoho-oauthtoken ${t}` } });
  return r.data?.data?.[0];
}

async function zohoFindDeal(phone) {
  const t = await getZohoToken();
  if (!ZOHO.DEAL_PHONE_FIELD) return null;
  try {
    const r = await axios.get(`${ZOHO.API_DOMAIN}/crm/v2/Deals/search?criteria=(${ZOHO.DEAL_PHONE_FIELD}:equals:${encodeURIComponent(phone)})`, { headers: { Authorization: `Zoho-oauthtoken ${t}` } });
    return r.data?.data?.[0];
  } catch { return null; }
}

async function zohoCreate(module, data) {
  const t = await getZohoToken();
  const r = await axios.post(`${ZOHO.API_DOMAIN}/crm/v2/${module}`, { data: [data], trigger: ["workflow"] }, { headers: { Authorization: `Zoho-oauthtoken ${t}` } });
  return r.data?.data?.[0]?.details?.id;
}

async function zohoUpdate(module, id, data) {
  const t = await getZohoToken();
  await axios.put(`${ZOHO.API_DOMAIN}/crm/v2/${module}/${id}`, { data: [data], trigger: ["workflow"] }, { headers: { Authorization: `Zoho-oauthtoken ${t}` } });
}

async function zohoCloseDeal(dealId) {
    if (!REQUIRE_ZOHO || !dealId) return;
    try {
        await zohoUpdate("Deals", dealId, { Stage: "Cerrado perdido", Description: "Cliente reinició cotización via WhatsApp" });
        console.log("🔒 Deal anterior cerrado:", dealId);
    } catch (e) { console.error("Error cerrando deal:", e.message); }
}

async function zohoUpsertFull(session, phone) {
  if (!REQUIRE_ZOHO) return;
  const d = session.data;
  const phoneE164 = normalizeCLPhone(phone);
  try {
    // Lead
    let lead = await zohoFindLead(phoneE164);
    const leadData = { Last_Name: d.name || `Lead WA`, Mobile: phoneE164, Lead_Source: "WhatsApp IA", Description: `Perfil: ${d.profile}` };
    if (ZOHO.LEAD_PROFILE_FIELD && d.profile) leadData[ZOHO.LEAD_PROFILE_FIELD] = d.profile;
    
    if (lead) await zohoUpdate("Leads", lead.id, leadData);
    else await zohoCreate("Leads", leadData);

    // Deal (Solo si ya hay PDF enviado)
    if (!session.pdfSent && !session.zohoDealId) return; 

    let deal = await zohoFindDeal(phoneE164);
    const dealData = {
        Deal_Name: `${d.product || "Ventanas"} [WA ${phone.slice(-4)}]`,
        Stage: STAGE_MAP.propuesta,
        Closing_Date: formatDateZoho(addDays(new Date(), 30)),
        Description: `Producto: ${d.product}\nMedidas: ${d.measures}\nPrecio: ${d.internal_price}`
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
  } catch (e) { console.error("Zoho Sync Error", e.message); }
}

async function zohoEnsureDefaultAccountId() {
    try {
        const t = await getZohoToken();
        const name = ZOHO.DEFAULT_ACCOUNT_NAME;
        const r = await axios.get(`${ZOHO.API_DOMAIN}/crm/v2/Accounts/search?criteria=(Account_Name:equals:${encodeURIComponent(name)})`, { headers: { Authorization: `Zoho-oauthtoken ${t}` } });
        if (r.data?.data?.[0]) return r.data.data[0].id;
        const c = await axios.post(`${ZOHO.API_DOMAIN}/crm/v2/Accounts`, { data: [{ Account_Name: name }] }, { headers: { Authorization: `Zoho-oauthtoken ${t}` } });
        return c.data?.data?.[0]?.details?.id;
    } catch { return null; }
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

    // 🔴 FIX: Lógica de Audio/Imagen restaurada
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

    // Reset Logic
    if (/^reset|nueva cotizaci[oó]n|empezar de nuevo/i.test(userText)) {
        if (session.zohoDealId) await zohoCloseDeal(session.zohoDealId);
        
        session.data = createEmptySession().data;
        session.data.name = "Cliente";
        session.zohoDealId = null;
        session.pdfSent = false;
        
        await waSendText(waId, "🔄 *Carpeta Nueva Abierta*\n\nHe guardado el historial anterior. Empecemos de cero.");
        saveSession(waId, session);
        release(); return;
    }

    session.history.push({ role: "user", content: userText });

    const aiMsg = await runAI(session, userText);
    
    // Tools handling
    if (aiMsg?.tool_calls) {
        const tc = aiMsg.tool_calls[0];
        if (tc.function.name === "update_customer_data") {
            const args = JSON.parse(tc.function.arguments);
            session.data = { ...session.data, ...args };
            
            // Precio maduro
            if (isComplete(session.data) || args.wants_pdf) {
                const m = normalizeMeasures(session.data.measures);
                if (m) session.data.internal_price = calculateInternalPrice({ ...m, glass: session.data.glass });
            }

            const shouldSendPDF = (isComplete(session.data) && (args.wants_pdf || /pdf|cotiza/i.test(userText)));

            if (shouldSendPDF && !session.pdfSent) {
                await waSendText(waId, "Perfecto, genero tu cotización formal... 📄");
                const qNum = generateQuoteNumber();
                const pdfBuf = await createQuotePdf(session.data, qNum);
                const mediaId = await waUploadPdf(pdfBuf);
                await waSendPdfById(waId, mediaId, "Cotización Formal");
                
                await waSendText(waId, "📄 *Cotización Lista*\n\nEl *Equipo Alfa* ya tiene copia de esto para apoyarte en el cierre.");
                
                session.pdfSent = true;
                await zohoUpsertFull(session, waId); // 🔴 Sincroniza SOLO aquí (Hito importante)
            } else {
                // 🔴 FIX: Generar Follow-up Natural (no respuesta fija)
                const follow = await openai.chat.completions.create({
                    model: AI_MODEL,
                    messages: [
                        { role: "system", content: SYSTEM_PROMPT },
                        ...session.history.slice(-12),
                        { role: "user", content: userText },
                        aiMsg,
                        { role: "tool", tool_call_id: tc.id, content: "Datos guardados." }
                    ],
                    temperature: 0.4
                });
                const reply = follow.choices[0].message.content.replace(//g, "").trim();
                await waSendText(waId, reply);
                session.history.push({ role: "assistant", content: reply });
            }
        }
    } else {
        const reply = aiMsg?.content || "No te entendí bien, ¿puedes repetir?";
        await waSendText(waId, reply.replace(//g, ""));
        session.history.push({ role: "assistant", content: reply });
    }

    saveSession(waId, session);
  } catch (e) {
    console.error("Error", e);
  } finally {
    release();
  }
});

app.listen(PORT, () => console.log(`🚀 Ferrari 6.1.1 ACTIVO`));
