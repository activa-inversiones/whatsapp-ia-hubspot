// index.js — WhatsApp IA + Zoho CRM
// Ferrari 6.0 — Mejoras críticas: Redis Sessions, Mutex Token, OpenAI Unificado, PDF Pro
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

// ============================================================
// OPCIONAL: Redis para persistencia (descomentar si usas Redis)
// ============================================================
// import Redis from 'ioredis';
// const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

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

// Modelos IA
const AI_MODEL = process.env.AI_MODEL_OPENAI || "gpt-4o-mini";
const STT_MODEL = process.env.AI_MODEL_STT || "whisper-1";

const AUTO_SEND_PDF_WHEN_READY = String(process.env.AUTO_SEND_PDF_WHEN_READY || "true") === "true";

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
  DEAL_PHONE_FIELD: process.env.ZOHO_DEAL_PHONE_FIELD || "WhatsApp_Phone", // ← IMPORTANTE: crear este campo en Zoho
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

const STAGE_RANK = {
  diagnostico: 10,
  siembra: 20,
  propuesta: 40,
  objeciones: 60,
  validacion: 75,
  cierre: 90,
  ganado: 100,
  perdido: 0,
  competencia: 0,
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

  if (REQUIRE_ZOHO) {
    if (!ZOHO.CLIENT_ID) missing.push("ZOHO_CLIENT_ID");
    if (!ZOHO.CLIENT_SECRET) missing.push("ZOHO_CLIENT_SECRET");
    if (!ZOHO.REFRESH_TOKEN) missing.push("ZOHO_REFRESH_TOKEN");
  }

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

function containsPriceLike(text) {
  const t = String(text || "");
  if (/\bUF\b/i.test(t)) return true;
  if (/\bCLP\b/i.test(t)) return true;
  if (/\$\s*\d/.test(t)) return true;
  if (/\b\d{6,}\b/.test(t)) return true;
  if (/\d+\.\d{3}/.test(t)) return true;
  return false;
}

function humanDelayMs(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  return 700 + Math.min(5300, words * 110);
}

// ============================================================
// MÉTRICAS (Simple in-memory)
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

  const expected =
    "sha256=" + crypto.createHmac("sha256", META.APP_SECRET).update(req.rawBody).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function waSendText(to, text) {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body: text } };

  const r = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${META.TOKEN}` },
    timeout: 20000,
  });

  metrics.messagesSent++;
  console.log("✅ WA send text", r.status, to);
  return r.data;
}

async function waMarkReadAndTyping(messageId) {
  if (!messageId) return;
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
    typing_indicator: { type: "text" },
  };

  try {
    await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${META.TOKEN}` },
      timeout: 15000,
    });
  } catch (e) {
    console.warn("⚠️ WA typing/read fail", e?.response?.status || e.message);
  }
}

async function waUploadPdf(buffer, filename = "Cotizacion.pdf") {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/media`;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buffer, { filename, contentType: "application/pdf" });

  const r = await axios.post(url, form, {
    headers: { Authorization: `Bearer ${META.TOKEN}`, ...form.getHeaders() },
    maxBodyLength: Infinity,
    timeout: 30000,
  });

  console.log("✅ WA upload pdf", r.status, r.data?.id);
  return r.data.id;
}

async function waSendPdfById(to, mediaId, caption, filename = "Cotizacion.pdf") {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: { id: mediaId, filename, caption },
  };

  const r = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${META.TOKEN}` },
    timeout: 20000,
  });

  metrics.pdfsSent++;
  console.log("✅ WA send pdf", r.status, to, mediaId);
}

async function waGetMediaMeta(mediaId) {
  const url = `${waBase()}/${mediaId}`;
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${META.TOKEN}` },
    timeout: 20000,
  });
  return data;
}

async function waDownloadMedia(mediaUrl) {
  const { data, headers } = await axios.get(mediaUrl, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${META.TOKEN}` },
    timeout: 30000,
  });
  const mime = headers["content-type"] || "application/octet-stream";
  return { buffer: Buffer.from(data), mime };
}

// ============================================================
// MEDIA PROCESSING
// ============================================================
async function transcribeAudio(buffer, mime) {
  const file = await toFile(buffer, "audio.ogg", { type: mime });
  const r = await openai.audio.transcriptions.create({
    model: STT_MODEL,
    file,
    language: "es",
  });
  metrics.openaiCalls++;
  return (r.text || "").trim();
}

async function describeImage(buffer, mime) {
  const b64 = buffer.toString("base64");
  const dataUrl = `data:${mime};base64,${b64}`;

  const prompt = `Describe brevemente la imagen y extrae datos útiles para cotizar ventanas/puertas:
- producto (ventana/puerta y tipo apertura)
- medidas (si aparecen)
- comuna/dirección (si aparece)
- vidrio (termopanel/low-e/etc si aparece)
Responde en español, máximo 6 líneas. Si no hay datos relevantes, dilo.`;

  const resp = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    temperature: 0.2,
    max_tokens: 250,
  });

  metrics.openaiCalls++;
  return (resp.choices?.[0]?.message?.content || "").trim();
}

async function parsePdfToText(buffer) {
  const r = await pdfParse(buffer);
  const text = (r?.text || "").trim();
  return text.length > 6000 ? text.slice(0, 6000) + "\n...[recortado]" : text;
}

// ============================================================
// SESSIONS (con soporte futuro para Redis)
// ============================================================
const sessions = new Map();
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const MAX_SESSIONS = 10000;

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
    },
    history: [],
    pdfSent: false,
    quoteNumber: null,
    zohoLeadId: null,
    zohoDealId: null,
  };
}

// Para Redis (descomentar si usas):
// async function getSession(waId) {
//   const key = `session:${waId}`;
//   const data = await redis.get(key);
//   if (data) {
//     const session = JSON.parse(data);
//     session.lastUserAt = Date.now();
//     return session;
//   }
//   return createEmptySession();
// }
// 
// async function saveSession(waId, session) {
//   const key = `session:${waId}`;
//   await redis.setex(key, 6 * 3600, JSON.stringify(session));
// }

// Versión en memoria (actual):
function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, createEmptySession());
  }
  return sessions.get(waId);
}

function saveSession(waId, session) {
  session.lastUserAt = Date.now();
  sessions.set(waId, session);
}

function cleanupSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  let deleted = 0;
  for (const [waId, s] of sessions.entries()) {
    if ((s.lastUserAt || 0) < cutoff) {
      sessions.delete(waId);
      deleted++;
    }
  }
  if (sessions.size > MAX_SESSIONS) {
    const sorted = [...sessions.entries()].sort((a, b) => (a[1].lastUserAt || 0) - (b[1].lastUserAt || 0));
    const toDelete = sorted.slice(0, sessions.size - MAX_SESSIONS);
    for (const [waId] of toDelete) {
      sessions.delete(waId);
      deleted++;
    }
  }
  if (deleted) console.log(`🧹 sessions cleaned: ${deleted}`);
}
setInterval(cleanupSessions, 60 * 60 * 1000);

// ============================================================
// DEDUPLICACIÓN Y RATE LIMITING
// ============================================================
const processedMsgIds = new Map();
const MSGID_TTL_MS = 2 * 60 * 60 * 1000;

function isDuplicateMsg(msgId) {
  if (!msgId) return false;
  const now = Date.now();
  const ts = processedMsgIds.get(msgId);
  if (ts && now - ts < MSGID_TTL_MS) return true;
  processedMsgIds.set(msgId, now);
  return false;
}

setInterval(() => {
  const cutoff = Date.now() - MSGID_TTL_MS;
  for (const [id, ts] of processedMsgIds.entries()) {
    if (ts < cutoff) processedMsgIds.delete(id);
  }
}, 10 * 60 * 1000);

// Lock por usuario
const locks = new Map();
async function acquireLock(waId, timeoutMs = 30000) {
  if (locks.has(waId)) await locks.get(waId);
  let release;
  const p = new Promise((r) => (release = r));
  const t = setTimeout(() => {
    release?.();
    locks.delete(waId);
  }, timeoutMs);
  locks.set(waId, p);
  return () => {
    clearTimeout(t);
    release?.();
    locks.delete(waId);
  };
}

// Rate limit
const rate = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;

function checkRate(waId) {
  const now = Date.now();
  if (!rate.has(waId)) {
    rate.set(waId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true };
  }
  const r = rate.get(waId);
  if (now >= r.resetAt) {
    r.count = 1;
    r.resetAt = now + RATE_WINDOW_MS;
    return { allowed: true };
  }
  r.count++;
  if (r.count > RATE_MAX) {
    const resetIn = Math.ceil((r.resetAt - now) / 1000);
    return { allowed: false, msg: `Has enviado muchos mensajes. Espera ${resetIn}s y continuamos.` };
  }
  return { allowed: true };
}

setInterval(() => {
  const now = Date.now();
  for (const [waId, r] of rate.entries()) {
    if (now > r.resetAt + RATE_WINDOW_MS) rate.delete(waId);
  }
}, 5 * 60 * 1000);

// ============================================================
// WEBHOOK PAYLOAD EXTRACTION
// ============================================================
function extractIncoming(reqBody) {
  const entry = reqBody?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;

  // Procesar status updates (nuevo en 6.0)
  if (value?.statuses?.length) {
    const status = value.statuses[0];
    const statusType = status.status; // sent, delivered, read, failed
    
    if (statusType === "failed") {
      console.error("❌ MSG_FAILED:", status.id, status.errors);
    } else {
      console.log(`📊 MSG_STATUS: ${status.id} → ${statusType}`);
    }
    
    return { ok: false, reason: "status_update", statusData: status };
  }

  const msg = value?.messages?.[0];
  if (!msg) return { ok: false, reason: "no_message" };
  if (!msg.from || !msg.id || !msg.type) return { ok: false, reason: "incomplete_message" };

  const waId = msg.from;
  const msgId = msg.id;
  const type = msg.type;

  const audioId = type === "audio" ? msg.audio?.id : null;
  const imageId = type === "image" ? msg.image?.id : null;
  const docId = type === "document" ? msg.document?.id : null;
  const docMime = type === "document" ? msg.document?.mime_type : null;
  const docFilename = type === "document" ? msg.document?.filename : null;

  let text = "";
  if (type === "text") text = msg.text?.body || "";
  else if (type === "button") text = msg.button?.text || "";
  else if (type === "interactive") text = JSON.stringify(msg.interactive || {});
  else text = `[${type}]`;

  return { ok: true, waId, msgId, type, text, audioId, imageId, docId, docMime, docFilename };
}

// ============================================================
// LÓGICA DE DATOS Y ETAPAS
// ============================================================
function missingFields(d) {
  const missing = [];
  if (!d.product) missing.push("producto");
  if (!d.measures) missing.push("medidas");
  if (!d.address && !d.comuna) missing.push("ubicación");
  if (!d.glass) missing.push("vidrio");
  if (!d.install) missing.push("instalación");
  return missing;
}

function nextMissingKey(d) {
  if (!d.product) return "producto (ventana/puerta y tipo de apertura)";
  if (!d.measures) return "medidas (ancho x alto)";
  if (!d.address && !d.comuna) return "comuna o dirección";
  if (!d.glass) return "tipo de vidrio";
  if (!d.install) return "si necesitas instalación";
  return "";
}

function isComplete(d) {
  return !!(d.product && d.measures && (d.address || d.comuna) && d.glass && d.install);
}

function bumpStage(session, nextKey) {
  const prev = session.data?.stageKey || "diagnostico";
  const prevRank = STAGE_RANK[prev] ?? 10;
  const nextRank = STAGE_RANK[nextKey] ?? prevRank;

  const isLost = nextKey === "perdido" || nextKey === "competencia";
  const isWon = nextKey === "ganado";

  if (isLost || isWon) {
    session.data.stageKey = nextKey;
    return;
  }

  if (nextRank > prevRank) session.data.stageKey = nextKey;
}

function detectSignals(textRaw) {
  const t = String(textRaw || "").toLowerCase();

  if (/^#ganado/.test(t)) return { won: true };
  if (/^#perdido/.test(t)) return { lost: true };
  if (/^#competencia/.test(t)) return { competitor: true };

  const buying =
    /(comprar|compr[oé]|lo compro|me lo quedo|acepto|confirmo|dale|hag[aá]moslo|cerrar|firmar)/.test(t) ||
    /(envi[aá]me (los )?datos|cuenta|transferencia|pagar|pago|pag[ué]|abono|anticipo)/.test(t);

  const wantsAll = /(envi[aá]me todo|m[eé]ndame todo|pdf|cotizaci[oó]n|propuesta)/.test(t);

  const objection =
    /(muy caro|car[oí]simo|descuento|rebaja|mejor precio|competencia|otra empresa|me sale menos|presupuesto)/.test(t);

  const technical =
    /(oguc|reglamento t[eé]rmico|rt|minvu|transmitancia|u-?value|uw|ac[uú]stic|rw|laminad|termopanel|dv?h|perfil|mm|herrajes|microventilaci[oó]n|ruptura puente t[eé]rmico)/.test(t);

  const schedule =
    /(agendar|agenda|visita|medici[oó]n|medir|instalaci[oó]n|instalar|fecha|hora|lunes|martes|mi[eé]rcoles|jueves|viernes|s[áa]bado)/.test(t);

  const lost = /(no gracias|ya no|cancelar|no me interesa|olvida|deja|ya compr[eé]|no voy|descarto)/.test(t);

  const competitor = /(otra empresa|competencia|ya cotiz[eé] con|ya lo hice con|me voy con)/.test(t);

  return { buying, wantsAll, objection, technical, schedule, lost, competitor };
}

function determineStage(session) {
  const d = session.data || {};
  const text = session.lastUserText || "";

  const hasSome = !!(d.product || d.measures || d.comuna);
  if (hasSome) bumpStage(session, "siembra");

  const s = detectSignals(text);

  if (s.competitor) bumpStage(session, "competencia");
  else if (s.lost) bumpStage(session, "perdido");
  else {
    if (session.pdfSent) bumpStage(session, "propuesta");
    if (s.objection) bumpStage(session, "objeciones");
    if (s.technical) bumpStage(session, "validacion");
    if (s.schedule || s.buying) bumpStage(session, "cierre");
    if (s.won) bumpStage(session, "ganado");
  }

  return session.data.stageKey || "diagnostico";
}

// ============================================================
// IA UNIFICADA (clasificador + respuesta en una llamada)
// ============================================================
const tools = [
  {
    type: "function",
    function: {
      name: "update_customer_data",
      description: "Actualiza datos del cliente para cotización. Llama SOLO cuando el cliente proporcione información nueva.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nombre del cliente" },
          product: { type: "string", description: "Tipo de producto (ventana corredera, puerta, etc.)" },
          measures: { type: "string", description: "Medidas ancho x alto" },
          address: { type: "string", description: "Dirección completa" },
          comuna: { type: "string", description: "Comuna" },
          glass: { type: "string", description: "Tipo de vidrio (termopanel, DVH, Low-E, etc.)" },
          install: { type: "string", description: "Si/No - requiere instalación" },
          wants_pdf: { type: "boolean", description: "true si el cliente pide cotización/PDF" },
          notes: { type: "string", description: "Notas adicionales" },
        },
        required: [],
      },
    },
  },
];

// Instrucciones de tono por perfil
const TONE_INSTRUCTIONS = {
  PRECIO: `Cliente sensible al precio. NO des montos. Enfócate en: ahorro energético, durabilidad 20+ años, garantía, costo total vs alternativas baratas. PDF tiene el detalle.`,
  CALIDAD: `Cliente busca premium. Habla de: terminaciones europeas, herrajes de alta gama, perfiles multicámara. Lenguaje sobrio. Menciona garantía extendida.`,
  TECNICO: `Cliente técnico. Datos directos: composición termopanel, tipo perfil, U-value, estanquidad. Menciona normativa (OGUC 4.1.10) si viene al caso. Sin emociones.`,
  AFINIDAD: `Cliente compra por confianza. Respuesta cálida. Usa su nombre. "Nos encargamos de todo", "Te acompañamos". Ofrece visita técnica gratuita.`,
};

const NORMATIVA_SNIPPET = `
Contexto técnico Chile (solo si es relevante):
- OGUC art. 4.1.10: exige desempeño higrotérmico de la envolvente.
- NCh 853: criterios térmicos. NCh 891/892: estanquidad.
- DVH/Termopanel reduce pérdidas ~40-50% vs vidrio simple.
REGLA: menciona normativa SOLO si aporta valor o el cliente pregunta.
`.trim();

const SYSTEM_PROMPT = `
Eres el asistente comercial de ${COMPANY.NAME} (${COMPANY.ADDRESS}) para ventanas y puertas de PVC y Aluminio de alta gama.

OBJETIVO: Cerrar visita técnica O enviar PDF de cotización.

REGLAS DURAS:
1. PROHIBIDO dar precios por chat (ni CLP, UF, rangos, "desde", "aproximado"). Si preguntan: "Te envío el detalle formal en PDF."
2. Responde BREVE (1-4 líneas máximo).
3. Si el cliente da info (producto, medidas, comuna, vidrio, instalación), LLAMA update_customer_data.
4. Si falta info, pide SOLO 1 DATO a la vez.
5. Sé humano y natural.

CLASIFICACIÓN DE PERFIL (usa internamente):
- PRECIO: pregunta costos, descuentos, "barato"
- CALIDAD: marcas, durabilidad, garantía, "lo mejor"
- TECNICO: jerga técnica (termopanel, U-value, mm)
- AFINIDAD: emocional, saludos, familia, confianza

Al final de cada respuesta, incluye en formato interno (no visible):
<!-- PROFILE: TIPO -->
`.trim();

async function runAI(session, userText) {
  const d = session.data;
  const missingKey = nextMissingKey(d);
  const complete = isComplete(d);

  const profileHint = d.profile ? `Perfil detectado: ${d.profile}. ${TONE_INSTRUCTIONS[d.profile] || ""}` : "";

  const statusMsg = complete
    ? "✅ DATOS COMPLETOS. Confirma y ofrece PDF + visita técnica."
    : `⚠️ FALTA: "${missingKey}". Pide SOLO este dato.`;

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: NORMATIVA_SNIPPET },
    { role: "system", content: profileHint },
    { role: "system", content: statusMsg },
    { role: "system", content: `Memoria actual:\n${JSON.stringify(d, null, 2)}` },
    ...session.history.slice(-8),
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

    const aiMsg = resp.choices?.[0]?.message;
    if (!aiMsg) return { role: "assistant", content: "¿Me confirmas la comuna para avanzar?" };

    // Extraer perfil del contenido (si está)
    const profileMatch = aiMsg.content?.match(/<!--\s*PROFILE:\s*(\w+)\s*-->/i);
    if (profileMatch) {
      const detected = profileMatch[1].toUpperCase();
      if (["PRECIO", "CALIDAD", "TECNICO", "AFINIDAD"].includes(detected)) {
        d.profile = detected;
      }
      // Limpiar el tag del contenido visible
      aiMsg.content = aiMsg.content.replace(/<!--\s*PROFILE:\s*\w+\s*-->/gi, "").trim();
    }

    return aiMsg;
  } catch (e) {
    console.error("❌ OpenAI error", e?.response?.data || e.message);
    metrics.errors++;
    return { role: "assistant", content: "Tuve un problema técnico. ¿Me confirmas medidas y comuna?" };
  }
}

// ============================================================
// PDF PROFESIONAL
// ============================================================
async function createQuotePdf(data, quoteNumber) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("error", (e) => reject(e));
      doc.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (buf.length < 200) return reject(new Error("PDF demasiado pequeño"));
        resolve(buf);
      });

      const primaryColor = "#1a365d";
      const secondaryColor = "#4a5568";
      const lightGray = "#e2e8f0";

      // ===== HEADER =====
      doc.rect(0, 0, 612, 100).fill(primaryColor);
      
      doc.fillColor("#ffffff")
         .fontSize(24)
         .font("Helvetica-Bold")
         .text(COMPANY.NAME.toUpperCase(), 50, 30);
      
      doc.fontSize(10)
         .font("Helvetica")
         .text("Ventanas y Puertas Premium", 50, 58);
      
      doc.fontSize(20)
         .font("Helvetica-Bold")
         .text("COTIZACIÓN", 400, 35, { align: "right", width: 150 });
      
      doc.fontSize(10)
         .font("Helvetica")
         .text(quoteNumber, 400, 62, { align: "right", width: 150 });

      doc.y = 120;

      // ===== INFO EMPRESA Y FECHA =====
      doc.fillColor(secondaryColor).fontSize(9);
      doc.text(`${COMPANY.ADDRESS}`, 50, 110);
      doc.text(`Tel: ${COMPANY.PHONE} | ${COMPANY.EMAIL}`, 50, 122);
      
      doc.text(`Fecha: ${formatDateCL()}`, 400, 110, { align: "right", width: 150 });
      doc.text(`Válido por: 15 días`, 400, 122, { align: "right", width: 150 });

      doc.y = 150;

      // ===== LÍNEA SEPARADORA =====
      doc.strokeColor(lightGray).lineWidth(1).moveTo(50, 145).lineTo(562, 145).stroke();

      // ===== DATOS DEL CLIENTE =====
      doc.y = 160;
      doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("DATOS DEL CLIENTE", 50);
      doc.moveDown(0.5);
      
      doc.fillColor(secondaryColor).fontSize(10).font("Helvetica");
      doc.text(`Nombre: ${data.name || "Por confirmar"}`);
      doc.text(`Ubicación: ${data.address || data.comuna || "Por confirmar"}`);
      doc.text(`Contacto: WhatsApp`);
      
      doc.moveDown(1);

      // ===== DETALLE DE LA SOLICITUD =====
      doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("DETALLE DE LA SOLICITUD");
      doc.moveDown(0.5);

      // Tabla simple
      const tableTop = doc.y;
      const col1 = 50;
      const col2 = 200;
      
      doc.fillColor(primaryColor).fontSize(10).font("Helvetica-Bold");
      doc.text("Concepto", col1, tableTop);
      doc.text("Especificación", col2, tableTop);
      
      doc.strokeColor(lightGray).lineWidth(0.5).moveTo(50, tableTop + 15).lineTo(562, tableTop + 15).stroke();

      const items = [
        ["Producto", data.product || "Por confirmar"],
        ["Medidas", data.measures || "Por confirmar"],
        ["Tipo de vidrio", data.glass || "Por confirmar"],
        ["Instalación", data.install || "Por confirmar"],
      ];

      if (data.notes) {
        items.push(["Observaciones", data.notes]);
      }

      doc.font("Helvetica").fillColor(secondaryColor);
      let rowY = tableTop + 25;
      
      for (const [label, value] of items) {
        doc.text(label, col1, rowY);
        doc.text(value, col2, rowY, { width: 350 });
        rowY += 20;
      }

      doc.y = rowY + 20;

      // ===== VALOR =====
      doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("VALOR");
      doc.moveDown(0.3);
      
      doc.rect(50, doc.y, 512, 50).fill("#f7fafc").stroke(lightGray);
      doc.fillColor(primaryColor).fontSize(11).font("Helvetica");
      doc.text("El valor final será confirmado tras la visita técnica y medición en terreno.", 60, doc.y + 10, { width: 490 });
      doc.text("Incluye: fabricación, materiales de primera calidad y garantía.", 60, doc.y + 25, { width: 490 });

      doc.y += 70;

      // ===== SIGUIENTE PASO =====
      doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("SIGUIENTE PASO");
      doc.moveDown(0.5);
      
      doc.rect(50, doc.y, 512, 60).fill(primaryColor);
      doc.fillColor("#ffffff").fontSize(11).font("Helvetica-Bold");
      doc.text("📅 AGENDA TU VISITA TÉCNICA GRATUITA", 60, doc.y + 10, { width: 490, align: "center" });
      doc.font("Helvetica").fontSize(10);
      doc.text("Responde este mensaje o llámanos para coordinar.", 60, doc.y + 30, { width: 490, align: "center" });
      doc.text(`Tel: ${COMPANY.PHONE}`, 60, doc.y + 45, { width: 490, align: "center" });

      doc.y += 80;

      // ===== FOOTER =====
      doc.fontSize(8).fillColor("#a0aec0");
      doc.text(
        `Este documento es referencial. Los valores y plazos finales se confirman tras visita técnica. | ${COMPANY.NAME} | RUT: ${COMPANY.RUT}`,
        50,
        750,
        { align: "center", width: 512 }
      );

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ============================================================
// ZOHO CRM (con MUTEX para token)
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

  const { data } = await axios.post(url, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000,
  });

  if (!data.access_token) throw new Error("Zoho no devolvió access_token");
  const expiresIn = Number(data.expires_in || 3600);
  zohoCache.token = data.access_token;
  zohoCache.expiresAt = Date.now() + expiresIn * 1000 - 60_000;
  console.log("🔄 Zoho token OK", expiresIn);
  return zohoCache.token;
}

async function getZohoToken() {
  if (!REQUIRE_ZOHO) return "";
  
  // Si el token es válido, devolverlo
  if (zohoCache.token && Date.now() < zohoCache.expiresAt) {
    return zohoCache.token;
  }
  
  // MUTEX: si ya hay un refresh en progreso, esperar
  if (tokenRefreshPromise) {
    return tokenRefreshPromise;
  }
  
  // Iniciar refresh
  tokenRefreshPromise = refreshZohoToken();
  try {
    return await tokenRefreshPromise;
  } finally {
    tokenRefreshPromise = null;
  }
}

// ----- LEADS -----
async function zohoFindLeadByMobile(phoneE164) {
  const token = await getZohoToken();
  const criteria = `(Mobile:equals:${phoneE164})`;
  const url = `${ZOHO.API_DOMAIN}/crm/v2/Leads/search?criteria=${encodeURIComponent(criteria)}`;

  try {
    const r = await axios.get(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      timeout: 15000,
    });
    return r.data?.data?.[0] || null;
  } catch (e) {
    if (e?.response?.status === 204) return null;
    throw e;
  }
}

async function zohoCreateLead(payload) {
  const token = await getZohoToken();
  const url = `${ZOHO.API_DOMAIN}/crm/v2/Leads`;

  const r = await axios.post(
    url,
    { data: [payload], trigger: ["workflow"] },
    { headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 15000 }
  );

  return r.data?.data?.[0];
}

async function zohoUpdateLead(id, payload) {
  const token = await getZohoToken();
  const url = `${ZOHO.API_DOMAIN}/crm/v2/Leads/${id}`;

  const r = await axios.put(
    url,
    { data: [payload], trigger: ["workflow"] },
    { headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 15000 }
  );

  return r.data?.data?.[0];
}

// ----- ACCOUNTS -----
let zohoDefaultAccountCache = { id: null, name: null, expiresAt: 0 };

async function zohoFindAccountByName(accountName) {
  const token = await getZohoToken();
  const criteria = `(Account_Name:equals:${accountName})`;
  const url = `${ZOHO.API_DOMAIN}/crm/v2/Accounts/search?criteria=${encodeURIComponent(criteria)}`;
  try {
    const r = await axios.get(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 15000 });
    return r.data?.data?.[0] || null;
  } catch (e) {
    if (e?.response?.status === 204) return null;
    throw e;
  }
}

async function zohoCreateAccount(accountName) {
  const token = await getZohoToken();
  const url = `${ZOHO.API_DOMAIN}/crm/v2/Accounts`;
  const payload = { data: [{ Account_Name: accountName }] };
  const r = await axios.post(url, payload, { headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 20000 });
  return r.data;
}

async function zohoEnsureDefaultAccountId() {
  const name = ZOHO.DEFAULT_ACCOUNT_NAME;
  if (!name) return null;

  if (zohoDefaultAccountCache.id && zohoDefaultAccountCache.name === name && Date.now() < zohoDefaultAccountCache.expiresAt) {
    return zohoDefaultAccountCache.id;
  }

  let acc = await zohoFindAccountByName(name);
  if (!acc) {
    const created = await zohoCreateAccount(name);
    const id = created?.details?.id || null;
    zohoDefaultAccountCache = { id, name, expiresAt: Date.now() + 1000 * 60 * 60 * 6 };
    return id;
  }

  zohoDefaultAccountCache = { id: acc.id, name, expiresAt: Date.now() + 1000 * 60 * 60 * 6 };
  return acc.id;
}

// ----- DEALS -----
async function zohoFindDealByPhone(phoneE164) {
  const token = await getZohoToken();

  // Usar campo personalizado (RECOMENDADO)
  if (ZOHO.DEAL_PHONE_FIELD) {
    const criteria = `(${ZOHO.DEAL_PHONE_FIELD}:equals:${phoneE164})`;
    const url = `${ZOHO.API_DOMAIN}/crm/v2/Deals/search?criteria=${encodeURIComponent(criteria)}`;
    try {
      const r = await axios.get(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 15000 });
      return r.data?.data?.[0] || null;
    } catch (e) {
      if (e?.response?.status === 204) return null;
      // Si el campo no existe, continuar con fallback
      console.warn("⚠️ Campo DEAL_PHONE_FIELD no encontrado, usando fallback");
    }
  }

  // Fallback: buscar por nombre (menos preciso)
  const digits = String(phoneE164 || "").replace(/\D/g, "");
  const last9 = digits.slice(-9);
  const criteria = `(Deal_Name:contains:${last9})`;
  const url = `${ZOHO.API_DOMAIN}/crm/v2/Deals/search?criteria=${encodeURIComponent(criteria)}`;
  
  try {
    const r = await axios.get(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 15000 });
    return r.data?.data?.[0] || null;
  } catch (e) {
    if (e?.response?.status === 204) return null;
    return null;
  }
}

async function zohoCreateDeal(payload) {
  const token = await getZohoToken();
  const url = `${ZOHO.API_DOMAIN}/crm/v2/Deals`;

  const r = await axios.post(
    url,
    { data: [payload], trigger: ["workflow"] },
    { headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 15000 }
  );

  return r.data?.data?.[0];
}

async function zohoUpdateDeal(id, payload) {
  const token = await getZohoToken();
  const url = `${ZOHO.API_DOMAIN}/crm/v2/Deals/${id}`;

  const r = await axios.put(
    url,
    { data: [payload], trigger: ["workflow"] },
    { headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 15000 }
  );

  return r.data?.data?.[0];
}

function isZohoInvalidStageError(e) {
  const data = e?.response?.data;
  const txt = JSON.stringify(data || {});
  return /Stage/i.test(txt) && /INVALID_DATA/i.test(txt);
}

// ----- PAYLOADS -----
function buildLeadPayload(d, phoneE164) {
  const payload = {
    Last_Name: d.name || `Lead WhatsApp ${phoneE164.slice(-4)}`,
    Mobile: phoneE164,
    Lead_Source: "WhatsApp IA",
    Company: d.address || d.comuna || "Por confirmar",
    Description:
      `🤖 WhatsApp IA - Ferrari 6.0\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `Perfil: ${d.profile || "—"}\n` +
      `Producto: ${d.product || "—"}\n` +
      `Medidas: ${d.measures || "—"}\n` +
      `Vidrio: ${d.glass || "—"}\n` +
      `Instalación: ${d.install || "—"}\n` +
      `Comuna: ${d.comuna || "—"}\n` +
      `Dirección: ${d.address || "—"}\n` +
      `Notas: ${d.notes || "—"}`,
  };

  if (ZOHO.LEAD_PROFILE_FIELD && d.profile) {
    payload[ZOHO.LEAD_PROFILE_FIELD] = d.profile;
  }

  return payload;
}

function buildDealPayload(d, phoneE164, stageKey, accountId = null) {
  const stageName = STAGE_MAP[stageKey] || STAGE_MAP.diagnostico;
  const digits = String(phoneE164 || "").replace(/\D/g, "");
  const productPart = d.product || "Ventanas";
  const comunaPart = d.comuna || "Chile";
  const measuresPart = d.measures ? ` ${d.measures}` : "";
  const dealName = `${productPart}${measuresPart} - ${comunaPart} [WA ${digits}]`;

  const payload = {
    Deal_Name: dealName,
    Stage: stageName,
    Closing_Date: formatDateZoho(addDays(new Date(), 30)),
    Description:
      `🤖 WhatsApp IA - Ferrari 6.0\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `Etapa: ${stageName}\n` +
      `Perfil: ${d.profile || "—"}\n` +
      `Producto: ${d.product || "—"}\n` +
      `Medidas: ${d.measures || "—"}\n` +
      `Vidrio: ${d.glass || "—"}\n` +
      `Instalación: ${d.install || "—"}\n` +
      `Comuna: ${d.comuna || "—"}\n` +
      `Dirección: ${d.address || "—"}\n` +
      `Teléfono: ${phoneE164}\n` +
      `Notas: ${d.notes || "—"}`,
  };

  if (accountId) payload.Account_Name = { id: accountId };
  if (ZOHO.DEAL_PROFILE_FIELD && d.profile) payload[ZOHO.DEAL_PROFILE_FIELD] = d.profile;
  if (ZOHO.DEAL_PHONE_FIELD && phoneE164) payload[ZOHO.DEAL_PHONE_FIELD] = phoneE164;

  return payload;
}

// ----- UPSERT COMPLETO -----
async function zohoUpsertFull(session, phone, retries = 1) {
  if (!REQUIRE_ZOHO) return;

  const phoneE164 = normalizeCLPhone(phone);
  if (!phoneE164) return;

  const d = session.data;
  const stageKey = determineStage(session);

  try {
    // 1) LEAD
    let lead = await zohoFindLeadByMobile(phoneE164);
    const leadPayload = buildLeadPayload(d, phoneE164);

    if (lead) {
      await zohoUpdateLead(lead.id, leadPayload);
      session.zohoLeadId = lead.id;
      console.log("✅ Zoho LEAD updated", lead.id);
    } else {
      const created = await zohoCreateLead(leadPayload);
      session.zohoLeadId = created?.details?.id || null;
      console.log("✅ Zoho LEAD created", session.zohoLeadId);
    }

    // 2) DEAL
    const accountId = await zohoEnsureDefaultAccountId();
    let deal = await zohoFindDealByPhone(phoneE164);
    const dealPayload = buildDealPayload(d, phoneE164, stageKey, accountId);

    if (deal) {
      try {
        await zohoUpdateDeal(deal.id, dealPayload);
      } catch (e) {
        if (isZohoInvalidStageError(e)) {
          console.warn("⚠️ Zoho Stage inválida. Reintentando sin Stage.");
          const p2 = { ...dealPayload };
          delete p2.Stage;
          await zohoUpdateDeal(deal.id, p2);
        } else throw e;
      }
      session.zohoDealId = deal.id;
      console.log("✅ Zoho DEAL updated", deal.id, "Stage:", stageKey);
    } else {
      try {
        const created = await zohoCreateDeal(dealPayload);
        session.zohoDealId = created?.details?.id || null;
      } catch (e) {
        if (isZohoInvalidStageError(e)) {
          console.warn("⚠️ Zoho Stage inválida. Creando Deal sin Stage.");
          const p2 = { ...dealPayload };
          delete p2.Stage;
          const created = await zohoCreateDeal(p2);
          session.zohoDealId = created?.details?.id || null;
        } else throw e;
      }
      console.log("✅ Zoho DEAL created", session.zohoDealId, "Stage:", stageKey);
    }

    metrics.zohoUpserts++;

  } catch (e) {
    const status = e?.response?.status;
    if (status === 401 && retries > 0) {
      console.warn("🔁 Zoho 401 retry");
      zohoCache = { token: "", expiresAt: 0 };
      await sleep(500);
      return zohoUpsertFull(session, phone, retries - 1);
    }
    console.warn("⚠️ Zoho upsert fail", status, e?.response?.data || e.message);
    metrics.zohoErrors++;
  }
}

// ============================================================
// ROUTES
// ============================================================
app.get("/health", (_req, res) => res.status(200).send("ok"));

app.get("/", (_req, res) => res.status(200).json({ 
  status: "Ferrari 6.0 running",
  version: "6.0.0",
  uptime: Math.floor(process.uptime()),
  sessions: sessions.size,
  features: [
    "Leads+Deals",
    "Pipeline inteligente",
    "Perfil unificado",
    "PDF profesional",
    "Mutex token Zoho",
    "Status webhooks",
  ],
}));

app.get("/metrics", (_req, res) => {
  res.json({
    ...metrics,
    uptime: Math.floor((Date.now() - metrics.startedAt) / 1000),
    sessions: sessions.size,
    processedMsgIds: processedMsgIds.size,
  });
});

// ===== ZOHO AUTH =====
app.get("/zoho/auth", (_req, res) => {
  if (!ZOHO.CLIENT_ID || !ZOHO.CLIENT_SECRET || !ZOHO.REDIRECT_URI) {
    return res.status(500).send("Faltan env: ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REDIRECT_URI");
  }

  const scope = encodeURIComponent("ZohoCRM.modules.ALL,ZohoCRM.users.ALL");
  const url =
    `${ZOHO.ACCOUNTS_DOMAIN}/oauth/v2/auth` +
    `?scope=${scope}` +
    `&client_id=${encodeURIComponent(ZOHO.CLIENT_ID)}` +
    `&response_type=code` +
    `&access_type=offline` +
    `&prompt=consent` +
    `&redirect_uri=${encodeURIComponent(ZOHO.REDIRECT_URI)}`;

  return res.redirect(url);
});

app.get("/zoho/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send("Falta ?code en callback");

    const params = new URLSearchParams();
    params.set("grant_type", "authorization_code");
    params.set("client_id", ZOHO.CLIENT_ID);
    params.set("client_secret", ZOHO.CLIENT_SECRET);
    params.set("redirect_uri", ZOHO.REDIRECT_URI);
    params.set("code", code);

    const tokenUrl = `${ZOHO.ACCOUNTS_DOMAIN}/oauth/v2/token`;
    const { data } = await axios.post(tokenUrl, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    });

    return res.status(200).json({
      ok: true,
      got_refresh_token: Boolean(data.refresh_token),
      refresh_token: data.refresh_token || null,
      access_token_preview: data.access_token ? data.access_token.slice(0, 12) + "..." : null,
      msg: "Copia refresh_token y pégalo en Railway como ZOHO_REFRESH_TOKEN",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.response?.data || e.message });
  }
});

app.get("/zoho/test", async (req, res) => {
  try {
    if (!ZOHO.REFRESH_TOKEN) return res.status(400).send("Falta ZOHO_REFRESH_TOKEN");

    const token = await getZohoToken();
    const url = `${ZOHO.API_DOMAIN}/crm/v2/users?type=CurrentUser`;

    const { data } = await axios.get(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      timeout: 15000,
    });

    res.json({ ok: true, user: data?.users?.[0]?.full_name || "OK" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.response?.data || e.message });
  }
});

// ===== WEBHOOK =====
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === META.VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // ACK inmediato

  if (!verifyMetaSignature(req)) {
    console.warn("⚠️ META signature fail");
    return;
  }

  const incoming = extractIncoming(req.body);
  if (!incoming.ok) {
    if (incoming.reason !== "status_update") console.log("⏭️ skip", incoming.reason);
    return;
  }

  const { waId, msgId, type } = incoming;
  metrics.messagesReceived++;

  if (isDuplicateMsg(msgId)) {
    console.log("⏭️ duplicate msgId", msgId);
    return;
  }

  const rateCheck = checkRate(waId);
  if (!rateCheck.allowed) {
    await waSendText(waId, rateCheck.msg);
    return;
  }

  const release = await acquireLock(waId);
  try {
    const session = getSession(waId);
    session.lastUserAt = Date.now();
    session.lastUserText = "";

    await waMarkReadAndTyping(msgId);

    let userText = incoming.text;

    // AUDIO
    if (type === "audio" && incoming.audioId) {
      console.log("🎧 AUDIO_IN", { waId, msgId });
      const meta = await waGetMediaMeta(incoming.audioId);
      const { buffer, mime } = await waDownloadMedia(meta.url);
      const transcript = await transcribeAudio(buffer, mime);
      console.log("📝 AUDIO_TXT", transcript?.slice(0, 100));
      userText = transcript ? `[Audio transcrito]: ${transcript}` : "[Audio no transcrito]";
    }

    // IMAGE
    if (type === "image" && incoming.imageId) {
      console.log("🖼️ IMG_IN", { waId, msgId });
      const meta = await waGetMediaMeta(incoming.imageId);
      const { buffer, mime } = await waDownloadMedia(meta.url);
      const imgText = await describeImage(buffer, mime);
      console.log("🧠 IMG_TXT", imgText?.slice(0, 100));
      userText = `[Imagen]: ${imgText}`;
    }

    // PDF
    if (type === "document" && incoming.docId) {
      console.log("📄 DOC_IN", { waId, msgId, mime: incoming.docMime });
      const meta = await waGetMediaMeta(incoming.docId);
      const { buffer, mime } = await waDownloadMedia(meta.url);

      if ((incoming.docMime || mime) === "application/pdf") {
        const pdfText = await parsePdfToText(buffer);
        console.log("📄 PDF_TXT_LEN", pdfText.length);
        userText = `[PDF recibido]:\n${pdfText}`;
      } else {
        await waSendText(waId, "Recibí el archivo. ¿Me puedes escribir qué producto necesitas, medidas, comuna y tipo de vidrio?");
        saveSession(waId, session);
        return;
      }
    }

    session.lastUserText = userText;
    determineStage(session);

    console.log("📩 IN", { waId, type, preview: String(userText).slice(0, 80), stage: session.data.stageKey, profile: session.data.profile });

    // IA
    const aiMsg = await runAI(session, userText);
    let triggerPDF = false;

    // Tool calls
    if (aiMsg.tool_calls?.length) {
      for (const tc of aiMsg.tool_calls) {
        if (tc.type !== "function" || tc.function?.name !== "update_customer_data") continue;

        let args = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }

        if (args.install) {
          const yn = normalizeYesNo(args.install);
          if (yn) args.install = yn;
          else delete args.install;
        }

        session.data = { ...session.data, ...args };
        if (args.wants_pdf === true) triggerPDF = true;

        console.log("🔧 TOOL update_customer_data", args);

        // Follow-up
        const follow = await openai.chat.completions.create({
          model: AI_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "system", content: `Memoria actual: ${JSON.stringify(session.data)}` },
            ...session.history.slice(-6),
            { role: "user", content: userText },
            aiMsg,
            { role: "tool", tool_call_id: tc.id, content: "OK, datos guardados." },
          ],
          temperature: 0.3,
          max_tokens: 250,
        });
        metrics.openaiCalls++;

        let finalText = follow.choices?.[0]?.message?.content?.trim();

        // Guardarraíl
        if (containsPriceLike(finalText)) {
          const missing = nextMissingKey(session.data);
          finalText = `Perfecto, tengo los datos. Para el valor exacto te envío PDF formal.\n¿Me confirmas ${missing || "si agendamos visita"}?`;
        }

        if (finalText) {
          // Limpiar tags internos
          finalText = finalText.replace(/<!--\s*PROFILE:\s*\w+\s*-->/gi, "").trim();
          
          await sleep(humanDelayMs(finalText));
          await waSendText(waId, finalText);
          session.history.push({ role: "user", content: userText });
          session.history.push({ role: "assistant", content: finalText });
        }
      }
    } else {
      let reply = (aiMsg.content || "").trim();

      // Guardarraíl
      if (containsPriceLike(reply)) {
        const missing = nextMissingKey(session.data);
        reply = `Para darte un valor exacto, lo envío en PDF formal. Solo necesito confirmar ${missing || "un dato más"}.`;
      }

      if (reply) {
        await sleep(humanDelayMs(reply));
        await waSendText(waId, reply);
        session.history.push({ role: "user", content: userText });
        session.history.push({ role: "assistant", content: reply });
      }
    }

    // Zoho (async)
    const hasUsefulData = session.data.product || session.data.measures || session.data.comuna || session.data.profile;
    if (hasUsefulData) {
      zohoUpsertFull(session, waId).catch((e) => console.warn("⚠️ Zoho async fail", e.message));
    }

    // PDF
    const complete = isComplete(session.data);
    const askedPdf = /\bpdf\b/i.test(incoming.text) || /cotiz/i.test(incoming.text);
    const shouldSend = complete && !session.pdfSent && (triggerPDF || askedPdf || AUTO_SEND_PDF_WHEN_READY);

    if (shouldSend) {
      await waMarkReadAndTyping(msgId);
      await sleep(1200);
      await waSendText(waId, "Perfecto, ya tengo todo. Te envío el PDF de cotización referencial 📄");
      
      const quoteNumber = generateQuoteNumber();
      session.quoteNumber = quoteNumber;
      
      const pdf = await createQuotePdf(session.data, quoteNumber);
      const mediaId = await waUploadPdf(pdf, `Cotizacion_${quoteNumber}.pdf`);
      await waSendPdfById(waId, mediaId, `Cotización ${quoteNumber} — ${COMPANY.NAME}`, `Cotizacion_${quoteNumber}.pdf`);
      
      session.pdfSent = true;
      bumpStage(session, "propuesta");

      zohoUpsertFull(session, waId).catch((e) => console.warn("⚠️ Zoho post-PDF fail", e.message));
    }

    saveSession(waId, session);

  } catch (e) {
    console.error("🔥 webhook error", e?.response?.data || e.message);
    metrics.errors++;
  } finally {
    release();
  }
});

// ============================================================
// BOOT
// ============================================================
console.log("═══════════════════════════════════════════════════");
console.log("  🏎️  FERRARI 6.0 — WhatsApp IA + Zoho CRM");
console.log("═══════════════════════════════════════════════════");
console.log(`  PORT=${PORT}`);
console.log(`  TZ=${TZ}`);
console.log(`  AI_MODEL=${AI_MODEL}`);
console.log(`  STT_MODEL=${STT_MODEL}`);
console.log(`  REQUIRE_ZOHO=${REQUIRE_ZOHO}`);
console.log(`  AUTO_SEND_PDF=${AUTO_SEND_PDF_WHEN_READY}`);
console.log(`  ZOHO_DEAL_PHONE_FIELD=${ZOHO.DEAL_PHONE_FIELD || "(not set)"}`);
console.log("═══════════════════════════════════════════════════");

app.listen(PORT, () => console.log(`🚀 Server activo en puerto ${PORT}`));
