// index.js — WhatsApp IA (OpenAI Tools + Vision + Audio STT) + PDF Quotes + Zoho CRM
// Ferrari 5.3 — Leads + Deals automático + Perfil Psicológico ("Detective") + Tono Dinámico ("Camaleón") + Normativa + Anti-dup/locks/TTL
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

// ---------- ENV ----------
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
const AI_MODEL_CLASSIFIER = process.env.AI_MODEL_CLASSIFIER || "gpt-4o-mini";
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

  // Campos personalizados en Leads (opcional)
  LEAD_PROFILE_FIELD: process.env.ZOHO_LEAD_PROFILE_FIELD || "",

  // Campos personalizados en Deals/Potentials (opcional)
  DEAL_PROFILE_FIELD: process.env.ZOHO_DEAL_PROFILE_FIELD || "",

  // Si creas un campo personalizado en Deals para guardar el teléfono, pon aquí su API Name.
  // Ej: Phone_E164 / WhatsApp_Phone / Mobile_1
  DEAL_PHONE_FIELD: process.env.ZOHO_DEAL_PHONE_FIELD || "",

  // Nombre de cuenta por defecto para Deals (si Account_Name es obligatorio)
  DEFAULT_ACCOUNT_NAME: process.env.ZOHO_DEFAULT_ACCOUNT_NAME || "Clientes WhatsApp IA",
};

// ---------- Etapas del Pipeline (Tratos/Deals) ----------
// IMPORTANTE: Los valores deben coincidir EXACTAMENTE con el picklist "Fase/Stage" en Zoho.
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

// Orden (nunca retroceder en el funnel automáticamente)
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

// ---------- OpenAI ----------
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ---------- Util ----------
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
  if (["si", "sí", "s", "1", "true", "y", "yes"].includes(s)) return "Si";
  if (["no", "n", "0", "false"].includes(s)) return "No";
  return "";
}

function formatDateZoho(date = new Date()) {
  // Formato YYYY-MM-DD para Zoho
  return date.toISOString().split("T")[0];
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// ---------- WhatsApp Graph base ----------
const waBase = () => `https://graph.facebook.com/${META.GRAPH_VERSION}`;

// ---------- Meta Signature (opcional) ----------
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

// ---------- WhatsApp Send ----------
async function waSendText(to, text) {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body: text } };

  const r = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${META.TOKEN}` },
    timeout: 20000,
  });

  console.log("✅ WA send text", r.status, to);
}


async function waMarkReadAndTyping(messageId, type = "text") {
  // WhatsApp Cloud API: marca como leído y muestra indicador de "escribiendo..."
  // Requiere msgId del mensaje entrante.
  if (!messageId) return;
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
    typing_indicator: { type }, // "text"
  };

  try {
    await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${META.TOKEN}` },
      timeout: 15000,
    });
  } catch (e) {
    // No bloquea el flujo si falla.
    console.warn("⚠️ WA typing/read fail", e?.response?.status || "", e?.response?.data?.error?.message || e.message);
  }
}

function humanDelayMs(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  // 700ms base + 110ms por palabra, cap 6s
  const ms = 700 + Math.min(5300, words * 110);
  return ms;
}

async function waUploadPdf(buffer, filename = "Cotizacion_Activa.pdf") {
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

async function waSendPdfById(to, mediaId, caption) {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: { id: mediaId, filename: "Cotizacion_Activa.pdf", caption },
  };

  const r = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${META.TOKEN}` },
    timeout: 20000,
  });

  console.log("✅ WA send pdf", r.status, to, mediaId);
}

// ---------- WhatsApp Media Download ----------
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

// ---------- Audio -> Text ----------
async function transcribeAudio(buffer, mime) {
  const file = await toFile(buffer, "audio.ogg", { type: mime });
  const r = await openai.audio.transcriptions.create({
    model: STT_MODEL,
    file,
    language: "es",
  });
  return (r.text || "").trim();
}

// ---------- Image -> Text (Vision) ----------
async function describeImage(buffer, mime) {
  const b64 = buffer.toString("base64");
  const dataUrl = `data:${mime};base64,${b64}`;

  const prompt = `
Describe brevemente la imagen y extrae datos útiles para cotizar ventanas/puertas:
- producto (ventana/puerta y tipo apertura si se entiende)
- medidas (si aparecen en el texto, croquis o etiqueta)
- comuna/dirección (si aparece)
- vidrio (termopanel/low-e/etc si aparece)
Responde en español, máximo 8 líneas. Si no hay datos, dilo.
`.trim();

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
    max_tokens: 300,
  });

  return (resp.choices?.[0]?.message?.content || "").trim();
}

// ---------- PDF entrante -> Text ----------
async function parsePdfToText(buffer) {
  const r = await pdfParse(buffer);
  const text = (r?.text || "").trim();
  const clipped = text.length > 6000 ? text.slice(0, 6000) + "\n...[recortado]" : text;
  return clipped;
}

// ---------- Sessions + TTL ----------
const sessions = new Map();
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const MAX_SESSIONS = 10000;

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
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
        profile: "", // PRECIO | CALIDAD | TECNICO | AFINIDAD
        stageKey: "diagnostico", // clave interna
      },
      history: [],
      pdfSent: false,
      zohoLeadId: null,
      zohoDealId: null,
    });
  }
  return sessions.get(waId);
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

// ---------- Dedupe msgId ----------
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

// ---------- Lock por waId (anti race) ----------
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

// ---------- Rate limit ----------
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

// ---------- Webhook payload validate & extract ----------
function extractIncoming(reqBody) {
  const entry = reqBody?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;

  if (value?.statuses?.length) return { ok: false, reason: "status_update" };

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

// ---------- "Detective" (Clasificador de Perfil) ----------
const CLASSIFIER_SYSTEM = `
ERES UN ANALISTA DE PERFILES PSICOLÓGICOS PARA UNA EMPRESA DE VENTANAS DE ALTA GAMA.
TU OBJETIVO: Clasificar el mensaje del usuario en una de las 4 categorías psicológicas.

CATEGORÍAS:
1. "PRECIO": pregunta por costos, descuentos, "barato", presupuesto, formas de pago, financiamiento.
2. "CALIDAD": pregunta por marcas/origen, durabilidad, garantía, "lo mejor", estética premium, terminaciones.
3. "TECNICO": usa jerga técnica (termopanel, transmitancia/U, puente térmico, mm, herrajes, DVH, Low-E).
4. "AFINIDAD": emocional, saludos largos, emojis, familia/casa, busca confianza y buen trato, agradecimientos.

REGLAS:
- Analiza SOLO el último mensaje del usuario.
- Si hay mezcla, elige la categoría DOMINANTE (la que tenga más peso en el mensaje).
- RESPONDE ÚNICAMENTE CON UNA PALABRA: "PRECIO", "CALIDAD", "TECNICO" o "AFINIDAD".
- No expliques nada. Solo la palabra.
`.trim();

async function classifyProfile(lastUserMessage) {
  const text = String(lastUserMessage || "").trim();
  if (!text || text.length < 3) return "AFINIDAD";

  try {
    const r = await openai.chat.completions.create({
      model: AI_MODEL_CLASSIFIER,
      messages: [
        { role: "system", content: CLASSIFIER_SYSTEM },
        { role: "user", content: text },
      ],
      temperature: 0,
      max_tokens: 5,
    });

    const out = (r.choices?.[0]?.message?.content || "").trim().toUpperCase();
    if (["PRECIO", "CALIDAD", "TECNICO", "AFINIDAD"].includes(out)) return out;
    return "AFINIDAD";
  } catch (e) {
    console.warn("⚠️ classifyProfile fail", e?.response?.data || e.message);
    return "AFINIDAD";
  }
}

function toneInstruction(profile) {
  switch (profile) {
    case "PRECIO":
      return `Cliente sensible al precio. 
- NO des montos ni valores por chat (NUNCA).
- Enfócate en: ahorro energético a largo plazo, durabilidad (20+ años), garantía, costo total de propiedad vs alternativas baratas.
- Menciona que el PDF tiene el detalle formal.
- Sé educado pero firme. No te disculpes por no dar precios.`;

    case "CALIDAD":
      return `Cliente busca excelencia/premium.
- Habla de: terminaciones europeas, herrajes de alta gama, perfiles multicámara, control de calidad en fábrica.
- Usa lenguaje sobrio y de alta gama. Evita diminutivos.
- Menciona garantía extendida y respaldo técnico.`;

    case "TECNICO":
      return `Cliente técnico/profesional.
- Responde directo y con datos: composición termopanel (ej: 4-12-4), tipo perfil PVC/aluminio, herrajes, U-value referencial, estanquidad.
- Puedes mencionar normativa (OGUC 4.1.10, NCh) si viene al caso.
- Evita lenguaje emocional. Ve al grano.`;

    case "AFINIDAD":
    default:
      return `Cliente compra por confianza.
- Respuesta cálida y empática. Usa su nombre si lo tienes.
- Transmite seguridad: "Nos encargamos de todo", "Te acompañamos en el proceso".
- Ofrece visita técnica gratuita como siguiente paso.`;
  }
}

// ---------- Normativa (contexto) ----------
const NORMATIVA_SNIPPET = `
Contexto técnico (Chile, referencias reales):
- Reglamentación Térmica MINVU (OGUC art. 4.1.10): exige desempeño higrotérmico de la envolvente (incluye ventanas). Se evalúa transmitancia U y porcentaje/criterios por orientación. Actualización vigente desde nov 2025 refuerza exigencias.
- Normas técnicas de ventanas/ensayos:
  * NCh 853: criterios térmicos y cálculo.
  * NCh 891: estanquidad al agua.
  * NCh 892: ventanas - ensayos de aire/viento.
- En Temuco/Padre Las Casas/Araucanía: el PDA por material particulado (MP) refuerza la importancia de mejorar hermeticidad y eficiencia para reducir demanda de calefacción.
- DVH/Termopanel reduce pérdidas térmicas en ~40-50% vs vidrio simple.

REGLA: menciona normativa SOLO si aporta valor o si el cliente lo pide expresamente. NUNCA inventes certificaciones o datos que no tengas.
`.trim();

// ---------- Helper: completar datos sin repetir ----------
function missingFields(d) {
  const missing = [];
  if (!d.product) missing.push("producto (ventana/puerta + tipo de apertura)");
  if (!d.measures) missing.push("medidas (ancho x alto en cm o mm)");
  if (!d.address && !d.comuna) missing.push("comuna o dirección");
  if (!d.glass) missing.push("vidrio (ej: termopanel 4-12-4, DVH, Low-E)");
  if (!d.install) missing.push("instalación (¿requiere instalación? Sí/No)");
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

function nextMissingKeyShort(d) {
  if (!d.product) return "producto";
  if (!d.measures) return "medidas";
  if (!d.address && !d.comuna) return "comuna";
  if (!d.glass) return "vidrio";
  if (!d.install) return "instalación";
  return "";
}

function isComplete(d) {
  return !!(d.product && d.measures && (d.address || d.comuna) && d.glass && d.install);
}

function containsPriceLike(text) {
  const t = String(text || "");
  if (/\bUF\b/i.test(t)) return true;
  if (/\bCLP\b/i.test(t)) return true;
  if (/\$\s*\d/.test(t)) return true;
  if (/\b\d{6,}\b/.test(t)) return true; // números de 6+ dígitos (precios típicos CLP)
  if (/\d+\.\d{3}/.test(t)) return true; // formato 1.234.567
  return false;
}

// ---------- Determinar etapa automáticamente ----------
function bumpStage(session, nextKey) {
  const prev = session.data?.stageKey || "diagnostico";
  const prevRank = STAGE_RANK[prev] ?? 10;
  const nextRank = STAGE_RANK[nextKey] ?? prevRank;

  // Lost stages are terminal but low probability. Only set them if explicitly detected.
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

  // Admin/operador override (útil cuando tú escribes desde el mismo WA)
  if (/^#ganado/.test(t)) return { won: true };
  if (/^#perdido/.test(t)) return { lost: true };
  if (/^#competencia/.test(t)) return { competitor: true };

  const buying =
    /(comprar|compr[oé]|lo compro|me lo quedo|acepto|confirmo|dale|hag[aá]moslo|cerrar|firmar)/.test(t) ||
    /(envi[aá]me (los )?datos|cuenta|transferencia|pagar|pago|pag[ué]|abono|anticipo)/.test(t);

  const wantsAll =
    /(envi[aá]me todo|m[eé]ndame todo|pdf|cotizaci[oó]n|propuesta)/.test(t);

  const objection =
    /(muy caro|car[oí]simo|descuento|rebaja|mejor precio|competencia|otra empresa|me sale menos|presupuesto)/.test(t);

  const technical =
    /(oguc|reglamento t[eé]rmico|rt|minvu|transmitancia|u-?value|uw|ac[uú]stic|rw|laminad|termopanel|dv?h|perfil|mm|herrajes|microventilaci[oó]n|ruptura puente t[eé]rmico)/.test(t);

  const schedule =
    /(agendar|agenda|visita|medici[oó]n|medir|instalaci[oó]n|instalar|fecha|hora|lunes|martes|mi[eé]rcoles|jueves|viernes|s[áa]bado)/.test(t);

  const lost =
    /(no gracias|ya no|cancelar|no me interesa|olvida|deja|ya compr[eé]|no voy|descarto)/.test(t);

  const competitor =
    /(otra empresa|competencia|ya cotiz[eé] con|ya lo hice con|me voy con)/.test(t);

  return { buying, wantsAll, objection, technical, schedule, lost, competitor };
}

function determineStage(session) {
  const d = session.data || {};
  const text = session.lastUserText || "";

  // Base: por avance de datos (sin saltarse el funnel)
  const hasSome = !!(d.product || d.measures || d.comuna);
  if (hasSome) bumpStage(session, "siembra");

  // Señales del cliente (esto sí puede acelerar etapas)
  const s = detectSignals(text);

  if (s.competitor) bumpStage(session, "competencia");
  else if (s.lost) bumpStage(session, "perdido");
  else {
    if (session.pdfSent) bumpStage(session, "propuesta");
    if (s.objection) bumpStage(session, "objeciones");
    if (s.technical) bumpStage(session, "validacion");
    if (s.schedule || s.buying) bumpStage(session, "cierre");
    // Ganado solo con señal fuerte
    if (s.won) bumpStage(session, "ganado");
  }

  return session.data.stageKey || "diagnostico";
}

// ---------- AI Tools ----------
const tools = [
  {
    type: "function",
    function: {
      name: "update_customer_data",
      description: "Actualiza datos del cliente para cotización de ventanas/puertas. Llama SOLO cuando el cliente proporcione información nueva.",
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

const BASE_SYSTEM_PROMPT = `
Eres el asistente comercial de Activa Inversiones (Temuco / La Araucanía) para ventanas y puertas de PVC y Aluminio de alta gama.

OBJETIVO PRINCIPAL: Cerrar una visita técnica/medición O enviar PDF de cotización referencial.

REGLAS DURAS (NUNCA romper):
1. PROHIBIDO entregar precios/montos por chat (ni CLP, ni UF, ni rangos, ni "desde", ni "aproximado"). Si preguntan precio: "Te envío el detalle formal en PDF para que tengas todo claro."
2. Responde BREVE (1-4 líneas máximo). Nada de párrafos largos.
3. Si el cliente da información (producto, medidas, comuna, vidrio, instalación), LLAMA la tool update_customer_data.
4. Si falta información para cotizar, pide SOLO 1 DATO a la vez (el más prioritario). NUNCA pidas datos que ya tengas en "Memoria actual".
5. Si llega imagen o PDF con información, ÚSALA para completar datos automáticamente.
6. Si preguntan por normativa: menciona SOLO referencias del contexto. NUNCA inventes certificaciones.
7. Sé humano y natural. Nada de respuestas robóticas.

FLUJO IDEAL:
- Saludo → Entender necesidad → Recopilar datos (1 a la vez) → Ofrecer PDF → Ofrecer visita técnica gratuita
`.trim();

async function runAI(session, userText) {
  const d = session.data;
  const missingKey = nextMissingKey(d);
  const complete = isComplete(d);

  const messages = [
    { role: "system", content: BASE_SYSTEM_PROMPT },
    { role: "system", content: `Normativa/Contexto técnico:\n${NORMATIVA_SNIPPET}` },
    { role: "system", content: `Perfil cliente detectado: ${d.profile || "AFINIDAD"}\nInstrucción de tono:\n${toneInstruction(d.profile)}` },
    {
      role: "system",
      content: complete
        ? "✅ DATOS COMPLETOS. Confirma al cliente y ofrece enviar el PDF de cotización referencial. También puedes ofrecer agendar visita técnica gratuita."
        : `⚠️ FALTA INFORMACIÓN. El siguiente dato a solicitar es: "${missingKey}". Pide SOLO este dato de forma natural (no hagas lista de todo lo que falta).`,
    },
    { role: "system", content: `Memoria actual del cliente:\n${JSON.stringify(d, null, 2)}` },
    ...session.history.slice(-8), // últimos 8 mensajes para contexto
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

    return resp.choices?.[0]?.message || { role: "assistant", content: "¿Me confirmas la comuna para avanzar?" };
  } catch (e) {
    console.error("❌ OpenAI error", e?.response?.data || e.message);
    return { role: "assistant", content: "Tuve un problema técnico. ¿Me confirmas medidas y comuna?" };
  }
}

// ---------- PDF de cotización (saliente) ----------
function createQuotePdf(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 48 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("error", (e) => reject(e));
      doc.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (buf.length < 200) return reject(new Error("PDF demasiado pequeño"));
        resolve(buf);
      });

      // Header
      doc.fontSize(20).fillColor("#1a365d").text("Cotización Referencial", { align: "center" });
      doc.fontSize(12).fillColor("#4a5568").text("Activa Inversiones — Ventanas y Puertas Premium", { align: "center" });
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor("#718096").text(`Fecha: ${new Date().toLocaleString("es-CL", { timeZone: TZ })}`, { align: "center" });
      doc.moveDown(1.5);

      // Línea separadora
      doc.strokeColor("#e2e8f0").lineWidth(1).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
      doc.moveDown(1);

      // Datos del cliente
      doc.fillColor("#2d3748").fontSize(14).text("Datos del Cliente", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor("#4a5568");
      doc.text(`Nombre: ${data.name || "Por confirmar"}`);
      doc.text(`Ubicación: ${data.address || data.comuna || "Por confirmar"}`);
      doc.text(`Contacto: WhatsApp`);
      doc.moveDown(1);

      // Solicitud
      doc.fillColor("#2d3748").fontSize(14).text("Detalle de la Solicitud", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor("#4a5568");
      doc.text(`Producto: ${data.product || "Por confirmar"}`);
      doc.text(`Medidas: ${data.measures || "Por confirmar"}`);
      doc.text(`Vidrio: ${data.glass || "Por confirmar"}`);
      doc.text(`Instalación: ${data.install || "Por confirmar"}`);

      if (data.notes) {
        doc.moveDown(0.5);
        doc.text(`Observaciones: ${data.notes}`);
      }

      doc.moveDown(1.5);

      // Disclaimer
      doc.fontSize(9).fillColor("#a0aec0").text(
        "Nota: Este documento es referencial. Los valores finales y plazos se confirman tras visita técnica y medición en terreno. Cotización generada automáticamente por WhatsApp IA.",
        { align: "justify" }
      );

      doc.moveDown(1);
      doc.fontSize(10).fillColor("#2d3748").text("📞 Agenda tu visita técnica GRATUITA respondiendo este mensaje.", { align: "center" });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ========== ZOHO CRM ==========
let zohoCache = { token: "", expiresAt: 0 };

async function getZohoToken() {
  if (!REQUIRE_ZOHO) return "";
  const now = Date.now();
  if (zohoCache.token && now < zohoCache.expiresAt) return zohoCache.token;

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
  zohoCache.expiresAt = now + expiresIn * 1000 - 60_000;
  console.log("🔄 Zoho token OK", expiresIn);
  return zohoCache.token;
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
    zohoDefaultAccountCache = { id, name, expiresAt: Date.now() + 1000 * 60 * 60 * 6 }; // 6h
    return id;
  }

  zohoDefaultAccountCache = { id: acc.id, name, expiresAt: Date.now() + 1000 * 60 * 60 * 6 };
  return acc.id;
}

function isZohoInvalidStageError(e) {
  const data = e?.response?.data;
  const txt = JSON.stringify(data || {});
  return /Stage/i.test(txt) && /INVALID_DATA/i.test(txt);
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

// ----- DEALS (Tratos/Potentials) -----
async function zohoFindDealByPhone(phoneE164) {
  const token = await getZohoToken();

  const digits = String(phoneE164 || "").replace(/\D/g, "");
  const last9 = digits.slice(-9);

  // Preferir campo personalizado si existe
  if (ZOHO.DEAL_PHONE_FIELD) {
    const criteria = `(${ZOHO.DEAL_PHONE_FIELD}:equals:${phoneE164})`;
    const url = `${ZOHO.API_DOMAIN}/crm/v2/Deals/search?criteria=${encodeURIComponent(criteria)}`;
    try {
      const r = await axios.get(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 15000 });
      return r.data?.data?.[0] || null;
    } catch (e) {
      if (e?.response?.status === 204) return null;
      return null;
    }
  }

  // Fallback: buscar por nombre que contenga los últimos 9 dígitos (mucho mejor que últimos 4)
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

// ----- UPSERT COMPLETO (Lead + Deal) -----
function buildLeadPayload(d, phoneE164) {
  const payload = {
    Last_Name: d.name || `Lead WhatsApp ${phoneE164.slice(-4)}`,
    Mobile: phoneE164,
    Lead_Source: "WhatsApp IA",
    Company: d.address || d.comuna || "Por confirmar",
    Description:
      `🤖 WhatsApp IA - Ferrari 5.3\n` +
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
    Closing_Date: formatDateZoho(addDays(new Date(), 30)), // +30 días
    Description:
      `🤖 WhatsApp IA - Ferrari 5.3\n` +
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

  // Si Account_Name es obligatorio en tu layout, este campo evita fallos de creación.
  if (accountId) payload.Account_Name = { id: accountId };

  // Campo personalizado (opcional) para perfil
  if (ZOHO.DEAL_PROFILE_FIELD && d.profile) {
    payload[ZOHO.DEAL_PROFILE_FIELD] = d.profile;
  }

  // Campo personalizado (opcional) para teléfono
  if (ZOHO.DEAL_PHONE_FIELD && phoneE164) {
    payload[ZOHO.DEAL_PHONE_FIELD] = phoneE164;
  }

  return payload;
}

async function zohoUpsertFull(session, phone, retries = 1) {
  if (!REQUIRE_ZOHO) return;

  const phoneE164 = normalizeCLPhone(phone);
  if (!phoneE164) return;

  const d = session.data;
  const stageKey = determineStage(session);

  try {
    // 1) LEAD: buscar o crear
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

    // 2) DEAL: buscar o crear (siempre, para que el funnel avance)
    const accountId = await zohoEnsureDefaultAccountId();
    let deal = await zohoFindDealByPhone(phoneE164);

    const dealPayload = buildDealPayload(d, phoneE164, stageKey, accountId);
    const stageName = dealPayload.Stage;

    if (deal) {
      try {
        await zohoUpdateDeal(deal.id, dealPayload);
      } catch (e) {
        // Si la etapa no existe (picklist mismatch), reintenta sin Stage para que al menos guarde los datos
        if (isZohoInvalidStageError(e)) {
          console.warn("⚠️ Zoho Stage inválida (picklist no coincide). Reintentando sin Stage:", stageName);
          const p2 = { ...dealPayload };
          delete p2.Stage;
          await zohoUpdateDeal(deal.id, p2);
        } else throw e;
      }

      session.zohoDealId = deal.id;
      console.log("✅ Zoho DEAL updated", deal.id, "StageKey:", stageKey, "Stage:", stageName);
    } else {
      try {
        const created = await zohoCreateDeal(dealPayload);
        session.zohoDealId = created?.details?.id || null;
      } catch (e) {
        if (isZohoInvalidStageError(e)) {
          console.warn("⚠️ Zoho Stage inválida (picklist no coincide). Creando Deal sin Stage:", stageName);
          const p2 = { ...dealPayload };
          delete p2.Stage;
          const created = await zohoCreateDeal(p2);
          session.zohoDealId = created?.details?.id || null;
        } else throw e;
      }
      console.log("✅ Zoho DEAL created", session.zohoDealId, "StageKey:", stageKey, "Stage:", stageName);
    }

  } catch (e) {
    const status = e?.response?.status;
    if (status === 401 && retries > 0) {
      console.warn("🔁 Zoho 401 retry");
      zohoCache = { token: "", expiresAt: 0 };
      await sleep(500);
      return zohoUpsertFull(session, phone, retries - 1);
    }
    console.warn("⚠️ Zoho upsert fail", status, e?.response?.data || e.message);
  }
}

// ---------- Routes ----------
app.get("/health", (_req, res) => res.status(200).send("ok"));
app.get("/", (_req, res) => res.status(200).json({ 
  status: "Ferrari 5.3 running",
  version: "5.3.0",
  features: ["Leads+Deals", "Pipeline inteligente", "Typing indicator", "Perfil Psicológico", "Anti-precio"]
}));

// ===== ZOHO AUTH / CALLBACK / TEST =====
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

app.get("/zoho/test-deal", async (req, res) => {
  try {
    const token = await getZohoToken();
    
    // Crear deal de prueba
    const testPayload = {
      Deal_Name: "TEST - WhatsApp IA Ferrari 5.3",
      Stage: STAGE_MAP.diagnostico,
      Closing_Date: formatDateZoho(addDays(new Date(), 30)),
      Description: "Deal de prueba creado desde WhatsApp IA",
    };

    const url = `${ZOHO.API_DOMAIN}/crm/v2/Deals`;
    const { data } = await axios.post(
      url,
      { data: [testPayload], trigger: ["workflow"] },
      { headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 15000 }
    );

    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.response?.data || e.message });
  }
});

// Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === META.VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// Webhook receiver
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

    // Guardar último texto para inferir etapa del funnel
    session.lastUserText = "";

    // Mostrar 'escribiendo...' mientras procesamos
    await waMarkReadAndTyping(msgId, "text");

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
        await waSendText(waId, "Recibí el archivo. ¿Me puedes escribir qué producto necesitas (ventana/puerta), medidas, comuna y tipo de vidrio?");
        return;
      }
    }

    session.lastUserText = userText;
    // Inferir etapa con señales del mensaje (sin retroceder)
    determineStage(session);

    console.log("📩 IN", { waId, type, preview: String(userText).slice(0, 80), stageKey: session.data.stageKey });

    // 1) Detective: clasificar perfil
    const profile = await classifyProfile(userText);
    session.data.profile = profile;
    console.log("🎭 PROFILE", profile);

    // 2) IA (Camaleón + Tools)
    const aiMsg = await runAI(session, userText);

    let triggerPDF = false;

    // Tool calls
    if (aiMsg.tool_calls?.length) {
      for (const tc of aiMsg.tool_calls) {
        if (tc.type !== "function") continue;
        if (tc.function?.name !== "update_customer_data") continue;

        let args = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }

        // Normalizar install
        if (args.install) {
          const yn = normalizeYesNo(args.install);
          if (yn) args.install = yn;
          else delete args.install;
        }

        // Merge datos
        session.data = { ...session.data, ...args };
        if (args.wants_pdf === true) triggerPDF = true;

        console.log("🔧 TOOL update_customer_data", args);

        // Follow-up para texto final
        const follow = await openai.chat.completions.create({
          model: AI_MODEL,
          messages: [
            { role: "system", content: BASE_SYSTEM_PROMPT },
            { role: "system", content: `Perfil: ${session.data.profile}. Tono: ${toneInstruction(session.data.profile)}` },
            { role: "system", content: `Memoria actual: ${JSON.stringify(session.data)}` },
            ...session.history.slice(-6),
            { role: "user", content: userText },
            aiMsg,
            { role: "tool", tool_call_id: tc.id, content: "OK, datos guardados." },
          ],
          temperature: 0.3,
          max_tokens: 250,
        });

        let finalText = follow.choices?.[0]?.message?.content?.trim();

        // Guardarraíl: bloquear precios
        if (containsPriceLike(finalText)) {
          finalText = `Perfecto, tengo los datos. Para darte el valor exacto lo envío en PDF formal.\n¿Me confirmas ${nextMissingKeyShort(session.data) || "si agendamos visita"}?`;
        }

        if (finalText) {
          await sleep(humanDelayMs(finalText));
          await waSendText(waId, finalText);
          session.history.push({ role: "user", content: userText });
          session.history.push({ role: "assistant", content: finalText });
        }
      }
    } else {
      let reply = (aiMsg.content || "").trim();

      // Guardarraíl: bloquear precios
      if (containsPriceLike(reply)) {
        reply = `Para darte un valor exacto, lo envío en PDF formal. Solo necesito confirmar ${nextMissingKeyShort(session.data) || "un dato más"}.`;
      }

      if (reply) {
        await sleep(humanDelayMs(reply));
        await waSendText(waId, reply);
        session.history.push({ role: "user", content: userText });
        session.history.push({ role: "assistant", content: reply });
      }
    }

    // 3) Zoho (async) — solo si hay datos útiles
    const hasUsefulData = session.data.product || session.data.measures || session.data.comuna || session.data.profile;
    if (hasUsefulData) {
      zohoUpsertFull(session, waId).catch((e) => console.warn("⚠️ Zoho async fail", e.message));
    }

    // 4) PDF saliente
    const complete = isComplete(session.data);
    const askedPdf = /\bpdf\b/i.test(incoming.text) || /cotiz/i.test(incoming.text);
    const shouldSend = complete && !session.pdfSent && (triggerPDF || askedPdf || AUTO_SEND_PDF_WHEN_READY);

    if (shouldSend) {
      await waMarkReadAndTyping(msgId, "text");
      await sleep(1200);
      await waSendText(waId, "Perfecto, ya tengo todo. Te envío el PDF de cotización referencial 📄");
      const pdf = await createQuotePdf(session.data);
      const mediaId = await waUploadPdf(pdf);
      await waSendPdfById(waId, mediaId, "Cotización referencial — Activa Inversiones");
      session.pdfSent = true;
      bumpStage(session, "propuesta");

      // Actualizar Zoho con etapa "propuesta"
      zohoUpsertFull(session, waId).catch((e) => console.warn("⚠️ Zoho post-PDF fail", e.message));
    }

  } catch (e) {
    console.error("🔥 webhook error", e?.response?.data || e.message);
  } finally {
    release();
  }
});

// ---------- Boot ----------
console.log("═══════════════════════════════════════════════════");
console.log("  🏎️  FERRARI 5.0 — WhatsApp IA + Zoho CRM");
console.log("═══════════════════════════════════════════════════");
console.log(`  PORT=${PORT}`);
console.log(`  TZ=${TZ}`);
console.log(`  AI_MODEL=${AI_MODEL}`);
console.log(`  AI_MODEL_CLASSIFIER=${AI_MODEL_CLASSIFIER}`);
console.log(`  STT_MODEL=${STT_MODEL}`);
console.log(`  REQUIRE_ZOHO=${REQUIRE_ZOHO}`);
console.log(`  AUTO_SEND_PDF=${AUTO_SEND_PDF_WHEN_READY}`);
console.log("═══════════════════════════════════════════════════");

app.listen(PORT, () => console.log(`🚀 Server activo en puerto ${PORT}`));
