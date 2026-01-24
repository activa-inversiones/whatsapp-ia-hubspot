/**
 * WhatsApp Cloud API Sales Bot (FULL humanization pack)
 * - Debounce (espera a que el cliente deje de escribir)
 * - Delays humanos + extras por mensaje largo/media
 * - 1 sola respuesta por turno + 1 sola pregunta por turno
 * - Anti-repetición (no volver a preguntar lo mismo)
 * - Loop guard (evita bucles y spam)
 * - Horario de atención + mensaje fuera de horario
 * - Handoff a humano por keywords / por loop / por baja confianza
 * - Memoria de sesión + perfil + últimos turnos
 * - IA opcional (OpenAI) con temperatura / max tokens / límites de salida
 * - SOLO: Ventanas y Puertas (PVC / Aluminio + DVH/termopanel)
 *
 * Node.js ESM (Railway)
 */

import express from "express";
import axios from "axios";
import OpenAI from "openai";

const app = express();
app.use(express.json({ limit: "2mb" }));

/* =========================
   ENV + Defaults (FULL)
========================= */

// WhatsApp / Meta
const PORT = Number(process.env.PORT || 8080);
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v22.0";
const REPLY_WITH_CONTEXT = toBool(process.env.REPLY_WITH_CONTEXT ?? "true");

// Identity / tone
const COMPANY_NAME = process.env.COMPANY_NAME || "Activa Inversiones EIRL";
const BRAND_SHORT = process.env.BRAND_SHORT || "Activa";
const AGENT_NAME = process.env.AGENT_NAME || "Marcelo Cifuentes";
const LANGUAGE = process.env.LANGUAGE || "es-CL";
const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || "America/Santiago";
const TONE = (process.env.TONE || "usted").toLowerCase(); // "usted" | "tu"
const GREETING_MODE = (process.env.GREETING_MODE || "first_message_only").toLowerCase(); // first_message_only | time_based | never
const SIGNATURE_MODE = (process.env.SIGNATURE_MODE || "first_message_only").toLowerCase(); // first_message_only | always | none
const EMOJI_LEVEL = Number(process.env.EMOJI_LEVEL || 0); // 0..2 (no emojis por defecto)
const FORMALITY_LEVEL = Number(process.env.FORMALITY_LEVEL || 2); // 0..3

// Human timing
const WAIT_AFTER_LAST_USER_MESSAGE_MS = Number(process.env.WAIT_AFTER_LAST_USER_MESSAGE_MS || 5500);
const MIN_RESPONSE_DELAY_MS = Number(process.env.MIN_RESPONSE_DELAY_MS || 1100);
const MAX_RESPONSE_DELAY_MS = Number(process.env.MAX_RESPONSE_DELAY_MS || 2600);
const EXTRA_DELAY_LONG_MESSAGES_MS = Number(process.env.EXTRA_DELAY_LONG_MESSAGES_MS || 700);
const EXTRA_DELAY_MEDIA_MS = Number(process.env.EXTRA_DELAY_MEDIA_MS || 1200);
const TYPING_SIMULATION = toBool(process.env.TYPING_SIMULATION ?? "true");
const TYPING_MIN_MS = Number(process.env.TYPING_MIN_MS || 900);
const TYPING_MAX_MS = Number(process.env.TYPING_MAX_MS || 1800);
const RATE_LIMIT_PER_USER_PER_MIN = Number(process.env.RATE_LIMIT_PER_USER_PER_MIN || 12);

// Output control
const SEND_SINGLE_MESSAGE = toBool(process.env.SEND_SINGLE_MESSAGE ?? "true");
const MAX_LINES_PER_REPLY = Number(process.env.MAX_LINES_PER_REPLY || 7);
const MAX_REPLY_CHARS = Number(process.env.MAX_REPLY_CHARS || 900);
const ONE_QUESTION_PER_TURN = toBool(process.env.ONE_QUESTION_PER_TURN ?? "true");
const ALLOW_BULLETS = toBool(process.env.ALLOW_BULLETS ?? "true");
const SPLIT_LONG_MESSAGES = toBool(process.env.SPLIT_LONG_MESSAGES ?? "false"); // recomendado false en WhatsApp ventas
const ANTI_REPEAT_WINDOW_MS = Number(process.env.ANTI_REPEAT_WINDOW_MS || 45 * 60 * 1000);

// Session / memory
const SESSION_TTL_MINUTES = Number(process.env.SESSION_TTL_MINUTES || 240);
const QUESTION_COOLDOWN_MINUTES = Number(process.env.QUESTION_COOLDOWN_MINUTES || 90);
const RECALL_LAST_N_TURNS = Number(process.env.RECALL_LAST_N_TURNS || 10);
const SUMMARIZE_CONTEXT = toBool(process.env.SUMMARIZE_CONTEXT ?? "true");

// Sales mode
const SALES_MODE = (process.env.SALES_MODE || "consultive").toLowerCase(); // consultive | transactional
const PILLARS = (process.env.PILLARS || "termico,acustico,seguridad")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean); // termico, acustico, seguridad
const DEFAULT_PRIORITY = (process.env.DEFAULT_PRIORITY || "balance").toLowerCase(); // balance | termico | acustico | seguridad
const EXPLAIN_BEFORE_ASK = toBool(process.env.EXPLAIN_BEFORE_ASK ?? "true");
const MAX_FIELDS_TO_REQUEST = Number(process.env.MAX_FIELDS_TO_REQUEST || 1);
const CLOSE_STEP = (process.env.CLOSE_STEP || "medicion_o_fotos").toLowerCase(); // medicion_o_fotos | llamada | agenda_directa
const CTA_STYLE = (process.env.CTA_STYLE || "soft").toLowerCase(); // soft | direct

// Handoff / business hours
const HUMAN_HANDOFF_ENABLED = toBool(process.env.HUMAN_HANDOFF_ENABLED ?? "true");
const BUSINESS_HOURS_ONLY = toBool(process.env.BUSINESS_HOURS_ONLY ?? "true");
const BUSINESS_HOURS_START = process.env.BUSINESS_HOURS_START || "09:00";
const BUSINESS_HOURS_END = process.env.BUSINESS_HOURS_END || "19:00";
const AFTER_HOURS_MESSAGE =
  process.env.AFTER_HOURS_MESSAGE ||
  "Gracias por escribir. Ahora estamos fuera de horario, pero le respondo apenas retomemos. Si me deja comuna y cantidad de unidades, avanzo con una base.";
const HUMAN_HANDOFF_KEYWORDS = (process.env.HUMAN_HANDOFF_KEYWORDS ||
  "ejecutivo,humano,llamar,urgente,queja,reclamo")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Loop guard
const LOOP_GUARD_MAX_REPLIES_PER_5MIN = Number(process.env.LOOP_GUARD_MAX_REPLIES_PER_5MIN || 6);
const LOOP_GUARD_ACTION = (process.env.LOOP_GUARD_ACTION || "handoff").toLowerCase(); // pause | handoff | silent
const LOOP_PAUSE_MINUTES = Number(process.env.LOOP_PAUSE_MINUTES || 20);

// Expert / credentials (solo si usted lo respalda)
const EXPERT_BADGE_ENABLED = toBool(process.env.EXPERT_BADGE_ENABLED ?? "false");
const MINVU_EXPERT_NOTE = process.env.MINVU_EXPERT_NOTE || "";
const MINVU_CREDENTIALS = process.env.MINVU_CREDENTIALS || "";

// AI (optional)
const AI_PROVIDER = (process.env.AI_PROVIDER || "").toLowerCase(); // openai | none
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const AI_MODEL_OPENAI = process.env.AI_MODEL_OPENAI || "gpt-4.1-mini";
const AI_TEMPERATURE = Number(process.env.AI_TEMPERATURE || 0.35);
const AI_MAX_OUTPUT_TOKENS = Number(process.env.AI_MAX_OUTPUT_TOKENS || 260);

// Optional: CRM webhook (not used yet)
const CRM_WEBHOOK_URL = process.env.CRM_WEBHOOK_URL || "";

// Base city fallback
const DEFAULT_CITY = process.env.DEFAULT_CITY || "Temuco";

/* =========================
   OpenAI client (optional)
========================= */
const openai =
  AI_PROVIDER === "openai" && OPENAI_API_KEY
    ? new OpenAI({ apiKey: OPENAI_API_KEY })
    : null;

/* =========================
   WhatsApp Graph API helpers
========================= */
const graphBase = `https://graph.facebook.com/${META_GRAPH_VERSION}/${PHONE_NUMBER_ID}`;

async function waPostMessages(payload) {
  const url = `${graphBase}/messages`;
  return axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });
}

/**
 * Mark message as read + best-effort typing indicator
 * Nota: WhatsApp Cloud API no garantiza que el “typing…” se muestre.
 */
async function markReadAndMaybeTyping(message_id) {
  if (!message_id) return;
  try {
    const payload = {
      messaging_product: "whatsapp",
      status: "read",
      message_id,
    };
    // Best effort (no siempre visible)
    if (TYPING_SIMULATION) payload.typing_indicator = { type: "text" };
    await waPostMessages(payload);
  } catch (e) {
    // Silencioso: no bloquea flujo
    console.warn("markReadAndMaybeTyping failed:", e?.response?.data || e.message);
  }
}

async function sendText(to, body, contextMessageId = null) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body, preview_url: false },
  };
  if (REPLY_WITH_CONTEXT && contextMessageId) payload.context = { message_id: contextMessageId };
  const r = await waPostMessages(payload);
  return r.data;
}

/* =========================
   Dedupe message ids
========================= */
const processedMessageIds = new Map();
const PROCESSED_TTL_MS = 10 * 60 * 1000;

function rememberProcessed(id) { processedMessageIds.set(id, Date.now()); }
function wasProcessed(id) {
  const t = processedMessageIds.get(id);
  if (!t) return false;
  if (Date.now() - t > PROCESSED_TTL_MS) { processedMessageIds.delete(id); return false; }
  return true;
}
setInterval(() => {
  const t = Date.now();
  for (const [id, ts] of processedMessageIds.entries()) {
    if (t - ts > PROCESSED_TTL_MS) processedMessageIds.delete(id);
  }
}, 60 * 1000).unref();

/* =========================
   Session store
========================= */
const sessions = new Map();
const SESSION_TTL_MS = SESSION_TTL_MINUTES * 60 * 1000;
const QUESTION_COOLDOWN_MS = QUESTION_COOLDOWN_MINUTES * 60 * 1000;

function getSession(wa_id) {
  if (!sessions.has(wa_id)) {
    sessions.set(wa_id, newSession(wa_id));
  }
  const s = sessions.get(wa_id);
  s.lastSeenAt = Date.now();
  return s;
}

function newSession(wa_id) {
  return {
    wa_id,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    flags: {
      greeted: false,
      handedOff: false,
      pausedUntil: 0,
    },
    askedAt: {}, // key -> timestamp
    lastQuestion: { text: "", at: 0 },
    // anti-repeat cache for any assistant outputs
    lastAssistantOutputs: [],
    // per-user rate limiting
    sentTimestamps: [], // assistant reply timestamps
    // conversation history (limited)
    history: [], // {role:"user"|"assistant", content, at}
    // short summary / notes
    notes: "",
    profile: {
      name: "",
      customerType: "",
      city: "",
      comuna: "",
      products: [],     // SOLO: ventanas / puertas
      priority: "",
      goal: "",         // condensación / ruido / etc.
      qty: null,
      dims: [],
      opening: "",
      install: "",
      material: "",     // pvc línea europea / pvc americano / aluminio
      schedule: "",     // plazo / urgencia
    },
    buffer: {
      timer: null,
      lastMsgId: null,
      lastFrom: null,
      lastAt: 0,
      contextId: null,
      parts: [],
      lastMsgType: "text",
    },
  };
}

// Session GC
setInterval(() => {
  const t = Date.now();
  for (const [k, s] of sessions.entries()) {
    if (t - s.lastSeenAt > SESSION_TTL_MS) sessions.delete(k);
  }
}, 60 * 1000).unref();

/* =========================
   Utilities
========================= */
function toBool(v) {
  return String(v).toLowerCase() === "true" || String(v) === "1";
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
function normalizeText(t) {
  return (t || "").toString().trim().replace(/\s+/g, " ");
}
function titleCaseName(name) {
  return (name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 4)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
function getLocalHour() {
  const parts = new Intl.DateTimeFormat(LANGUAGE, {
    timeZone: BUSINESS_TIMEZONE,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  return Number(parts.find(p => p.type === "hour")?.value || "12");
}
function getGreeting() {
  const hh = getLocalHour();
  if (hh >= 5 && hh < 12) return "Buenos días";
  if (hh >= 12 && hh < 20) return "Buenas tardes";
  return "Buenas noches";
}
function parseHHMM(hhmm) {
  const m = String(hhmm || "00:00").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { h: 0, min: 0 };
  const h = clamp(Number(m[1]), 0, 23);
  const min = clamp(Number(m[2]), 0, 59);
  return { h, min };
}
function isWithinBusinessHours() {
  const hh = getLocalHour();
  const parts = new Intl.DateTimeFormat(LANGUAGE, {
    timeZone: BUSINESS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find(p => p.type === "hour")?.value || "0");
  const min = Number(parts.find(p => p.type === "minute")?.value || "0");
  const nowMin = h * 60 + min;

  const s = parseHHMM(BUSINESS_HOURS_START);
  const e = parseHHMM(BUSINESS_HOURS_END);
  const startMin = s.h * 60 + s.min;
  const endMin = e.h * 60 + e.min;

  if (startMin === endMin) return true; // 24h
  // simple range (no overnight)
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  // overnight range
  return nowMin >= startMin || nowMin < endMin;
}

function expertFooter() {
  if (!EXPERT_BADGE_ENABLED) return "";
  const lines = [];
  if (MINVU_EXPERT_NOTE) lines.push(MINVU_EXPERT_NOTE);
  if (MINVU_CREDENTIALS) lines.push(MINVU_CREDENTIALS);
  return lines.length ? `\n${lines.join(" ")}` : "";
}

function cleanAndLimitText(text) {
  let out = normalizeText(text);

  // Enforce max chars
  if (MAX_REPLY_CHARS && out.length > MAX_REPLY_CHARS) {
    out = out.slice(0, MAX_REPLY_CHARS - 3).trimEnd() + "...";
  }

  // Enforce max lines
  if (MAX_LINES_PER_REPLY && out.includes("\n")) {
    const lines = out.split("\n").filter(l => l.trim().length);
    if (lines.length > MAX_LINES_PER_REPLY) {
      out = lines.slice(0, MAX_LINES_PER_REPLY).join("\n");
      // cut to chars again just in case
      if (MAX_REPLY_CHARS && out.length > MAX_REPLY_CHARS) {
        out = out.slice(0, MAX_REPLY_CHARS - 3).trimEnd() + "...";
      }
    }
  }

  // Force single message (no multi-send)
  if (SEND_SINGLE_MESSAGE && !SPLIT_LONG_MESSAGES) {
    // keep as-is; sendText sends one message.
  }

  return out;
}

function containsAnyKeyword(text, keywords) {
  const t = (text || "").toLowerCase();
  return keywords.some(k => k && t.includes(k));
}

function registerHistory(session, role, content) {
  session.history.push({ role, content: normalizeText(content), at: Date.now() });
  // limit to last N turns (both roles)
  const limit = clamp(RECALL_LAST_N_TURNS * 2, 4, 40);
  if (session.history.length > limit) session.history = session.history.slice(-limit);
}

function recordAssistantOutput(session, text) {
  session.lastAssistantOutputs.push({ text: normalizeText(text), at: Date.now() });
  // keep last 10
  if (session.lastAssistantOutputs.length > 10) session.lastAssistantOutputs = session.lastAssistantOutputs.slice(-10);
}

function recentlyRepeated(session, candidateText) {
  const t = Date.now();
  const c = normalizeText(candidateText).toLowerCase();
  // Check last outputs within anti-repeat window
  for (const item of session.lastAssistantOutputs) {
    if (t - item.at > ANTI_REPEAT_WINDOW_MS) continue;
    if (normalizeText(item.text).toLowerCase() === c) return true;
  }
  return false;
}

function canAsk(session, key) {
  const ts = session.askedAt[key];
  if (!ts) return true;
  return Date.now() - ts > QUESTION_COOLDOWN_MS;
}
function markAsked(session, key, questionText) {
  session.askedAt[key] = Date.now();
  if (questionText) session.lastQuestion = { text: normalizeText(questionText), at: Date.now() };
}

/* =========================
   Extraction (profile)
========================= */
function upsertUnique(arr, value) {
  if (!value) return arr;
  const v = value.toLowerCase();
  const s = new Set(arr.map(x => x.toLowerCase()));
  if (!s.has(v)) arr.push(value);
  return arr;
}

function extractInfo(session, userTextRaw) {
  const userText = normalizeText(userTextRaw);
  const t = userText.toLowerCase();

  // Name
  const nameMatch = userText.match(/\b(soy|me llamo)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){0,4})\b/i);
  if (nameMatch?.[2]) session.profile.name = titleCaseName(nameMatch[2]);

  // Products (ONLY windows/doors)
  if (t.includes("ventana")) upsertUnique(session.profile.products, "ventanas");
  if (t.includes("puerta")) upsertUnique(session.profile.products, "puertas");

  // Customer type
  if (t.includes("casa") || t.includes("depto") || t.includes("departamento") || t.includes("residenc")) session.profile.customerType = "residencial";
  else if (t.includes("local") || t.includes("negocio") || t.includes("comercial")) session.profile.customerType = "comercial";
  else if (t.includes("constructora") || t.includes("obra") || t.includes("licit")) session.profile.customerType = "constructora";
  else if (t.includes("arquitect") || t.includes("ito") || t.includes("oficina técnica") || t.includes("oficina tecnica")) session.profile.customerType = "arquitecto/oficina técnica";

  // City / comuna (basic)
  if (t.includes("temuco")) { session.profile.city = "Temuco"; session.profile.comuna = "Temuco"; }
  if (t.includes("pucón") || t.includes("pucon")) { session.profile.city = "Pucón"; session.profile.comuna = "Pucón"; }
  if (t.includes("padre las casas")) { session.profile.city = "Padre Las Casas"; session.profile.comuna = "Padre Las Casas"; }

  // Priority
  const wantsThermal = t.includes("térm") || t.includes("termic") || t.includes("aislacion term") || t.includes("aislación térm");
  const wantsAcoustic = t.includes("acust") || t.includes("ruido") || t.includes("sonido") || t.includes("aislacion acust");
  const wantsSecurity = t.includes("segur") || t.includes("antirrobo") || t.includes("cerradura") || t.includes("laminad");

  if (t.includes("todo") || t.includes("todas") || t.includes("balance")) session.profile.priority = "balance";
  else if (wantsThermal) session.profile.priority = "térmico";
  else if (wantsAcoustic) session.profile.priority = "acústico";
  else if (wantsSecurity) session.profile.priority = "seguridad";

  // Goal / concern
  if (t.includes("condens") || t.includes("humedad") || t.includes("empaña") || t.includes("empañ")) session.profile.goal = "condensación";
  if (t.includes("ruido") || t.includes("acust")) session.profile.goal = session.profile.goal || "ruido";

  // Material
  if (t.includes("pvc") && (t.includes("europe") || t.includes("línea europea") || t.includes("linea europea"))) session.profile.material = "pvc línea europea";
  else if (t.includes("pvc") && (t.includes("american") || t.includes("línea americana") || t.includes("linea americana"))) session.profile.material = "pvc americano";
  else if (t.includes("pvc")) session.profile.material = session.profile.material || "pvc";
  else if (t.includes("alumin")) session.profile.material = "aluminio";

  // Opening
  if (t.includes("corredera")) session.profile.opening = "corredera";
  if (t.includes("abatible") || t.includes("oscilobatiente")) session.profile.opening = t.includes("oscilobatiente") ? "oscilobatiente" : "abatible";

  // Install
  if (t.includes("con instalación") || t.includes("con instalacion") || t.includes("instalar") || t.includes("instalación incluida") || t.includes("instalacion incluida")) session.profile.install = "con instalación";
  if (t.includes("sin instalación") || t.includes("sin instalacion") || t.includes("solo fabricación") || t.includes("solo fabricacion")) session.profile.install = "sin instalación";

  // Qty
  const qtyMatch = t.match(/\b(\d{1,3})\b/);
  if (qtyMatch) {
    const q = Number(qtyMatch[1]);
    if (q >= 1 && q <= 500) session.profile.qty = q;
  }

  // Dims: 1200x1400
  const dimMatch = t.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/);
  if (dimMatch) {
    const w = Number(dimMatch[1]);
    const h = Number(dimMatch[2]);
    if (w >= 300 && h >= 300) session.profile.dims.push({ w_mm: w, h_mm: h, count: null });
  }

  // Schedule / plazo
  if (t.includes("urgente") || t.includes("esta semana")) session.profile.schedule = "urgente";
  if (t.includes("1 mes") || t.includes("un mes")) session.profile.schedule = "1 mes";
}

/* =========================
   Consultive content blocks
========================= */
function condensationExplainer() {
  return (
    "Sobre la condensación: normalmente aparece cuando hay **humedad relativa alta (sobre ~80%)** y una superficie fría (por ejemplo, alrededor de **12°C**). Ahí el vapor se transforma en gotitas.\n" +
    "Para reducirla, lo que manda es: **termopanel (DVH)**, buena **hermeticidad** (sellos/burletes) y una **instalación** que no deje puentes térmicos.\n" +
    "En **PVC línea europea**, por diseño multicámara y sellos, es muy difícil que se produzca condensación interior si el conjunto está bien especificado e instalado."
  );
}

function materialExplainer(material) {
  const base =
    "En materiales, **PVC americano**, **PVC línea europea** y **aluminio** pueden llevar **termopanel (DVH)**. La diferencia real está en el marco, los sellos, la hermeticidad y el detalle de instalación.";
  if (!material) return base;
  if (material.includes("línea europea") || material.includes("linea europea")) return base + " En PVC línea europea suele lograrse muy buen desempeño térmico y hermético.";
  if (material.includes("americano")) return base + " En PVC americano también se logra un buen resultado si se especifica bien el DVH y la instalación.";
  if (material.includes("aluminio")) return base + " En aluminio, para rendimiento térmico importa mucho el sistema (idealmente con buen diseño) además del DVH.";
  return base;
}

function simplePillars() {
  return "Nosotros lo trabajamos como solución integral en 3 pilares: **aislación térmica**, **aislación acústica** y **seguridad**.";
}

/* =========================
   Business logic (single question)
========================= */
function nextSingleQuestion(session) {
  const p = session.profile;
  const city = p.city || DEFAULT_CITY;

  // Only 1 field per turn (MAX_FIELDS_TO_REQUEST)
  // We enforce one question anyway (ONE_QUESTION_PER_TURN), so pick best next.
  if (!p.products.length && canAsk(session, "products")) {
    const q = "¿Qué necesita cotizar: **ventanas** o **puertas**?";
    markAsked(session, "products", q);
    return q;
  }
  if (!p.customerType && canAsk(session, "customerType")) {
    const q = `¿Es para vivienda (residencial) o para local/obra (comercial/constructora) en ${city}?`;
    markAsked(session, "customerType", q);
    return q;
  }
  if (!p.priority && canAsk(session, "priority")) {
    const q = "Para orientarle bien: ¿su foco principal hoy es **térmico**, **acústico**, **seguridad**, o prefiere una solución **balanceada** (las tres)?";
    markAsked(session, "priority", q);
    return q;
  }
  if (!p.qty && canAsk(session, "qty")) {
    const q = "¿Cuántas unidades son en total?";
    markAsked(session, "qty", q);
    return q;
  }
  if ((!p.dims || p.dims.length === 0) && canAsk(session, "dims")) {
    const q = "¿Tiene medidas aproximadas? (ej: 1200x1400)";
    markAsked(session, "dims", q);
    return q;
  }
  if (!p.opening && canAsk(session, "opening")) {
    const q = "¿Las prefiere **corredera** o **abatible/oscilobatiente**?";
    markAsked(session, "opening", q);
    return q;
  }
  if (!p.install && canAsk(session, "install")) {
    const q = "¿Las necesita **con instalación** o solo **fabricación**?";
    markAsked(session, "install", q);
    return q;
  }
  if (canAsk(session, "close")) {
    const q =
      CLOSE_STEP === "medicion_o_fotos"
        ? "Perfecto. ¿Prefiere que agendemos una medición o que me envíe fotos de los vanos para cerrar la cotización?"
        : CLOSE_STEP === "llamada"
        ? "Perfecto. ¿Le acomoda una llamada breve para cerrar detalles y enviarle la cotización?"
        : "Perfecto. ¿Agendamos medición para dejarlo cerrado?";
    markAsked(session, "close", q);
    return q;
  }
  return "";
}

/* =========================
   Core reply builder (base)
========================= */
function buildPrefix(session) {
  const greet = getGreeting();
  const name = session.profile.name ? ` ${session.profile.name}` : "";
  const intro =
    `${greet}${name}. Soy ${AGENT_NAME}, de ${COMPANY_NAME}.`;
  session.flags.greeted = true;

  // Signature behavior
  if (SIGNATURE_MODE === "always") return intro + " ";
  if (SIGNATURE_MODE === "first_message_only") return intro + " ";
  return `${greet}${name}. `;
}

function maybeGreetingPrefix(session) {
  if (GREETING_MODE === "never") return "";
  if (GREETING_MODE === "first_message_only" && session.flags.greeted) return "";
  // time_based or first_message_only when not greeted:
  if (!session.flags.greeted) return buildPrefix(session);
  return "";
}

function expertAnswer(session, userTextRaw) {
  const t = normalizeText(userTextRaw).toLowerCase();
  const city = session.profile.city || DEFAULT_CITY;

  // Handoff request
  if (HUMAN_HANDOFF_ENABLED && containsAnyKeyword(t, HUMAN_HANDOFF_KEYWORDS)) {
    session.flags.handedOff = true;
    return `De acuerdo. Le derivo con un ejecutivo para que lo ayude en detalle. ¿Me confirma su comuna y un horario de contacto?`;
  }

  // Condensation
  if (t.includes("condens") || t.includes("humedad") || t.includes("empaña") || t.includes("empañ")) {
    return `${condensationExplainer()}\n${materialExplainer(session.profile.material)}\n${ONE_QUESTION_PER_TURN ? "¿Las prefiere corredera o abatible/oscilobatiente?" : ""}`;
  }

  // Thermal / efficiency
  if (t.includes("eficiencia") || t.includes("valor u") || t.includes("transmit") || t.includes("normativa") || t.includes("oguc") || t.includes("minvu")) {
    return (
      `Eficiencia energética en ventanas significa que pase menos frío/calor. Se trabaja con **valor U** (más bajo = mejor), **hermeticidad** (menos infiltración) y una instalación sin puentes térmicos.\n` +
      `${simplePillars()}\n` +
      `${ONE_QUESTION_PER_TURN ? `¿Su proyecto es residencial en ${city} y su prioridad hoy es térmico, acústico o seguridad?` : ""}` +
      expertFooter()
    );
  }

  // DVH 4+12+4 / transmitance questions (sin inventar números)
  if (t.includes("4+12+4") || t.includes("4 12 4") || t.includes("dv h") || t.includes("dvh") || t.includes("termopanel") || t.includes("termopaneles")) {
    if (t.includes("transmit") || t.includes("valor u") || t.includes("u ")) {
      return (
        "La configuración **4+12+4 (DVH)** es una base muy usada. El desempeño final depende de: **tipo de vidrio** (normal o Low-E), **gas** (aire/argón) y **marco + sellos + instalación**.\n" +
        `${simplePillars()}\n` +
        (ONE_QUESTION_PER_TURN ? "¿Su foco principal hoy es térmico, acústico o seguridad?" : "")
      );
    }
    // general termopanel ask -> guide
    return (
      "Perfecto. Para termopanel (DVH) lo importante es definir objetivo: **térmico**, **acústico** o **seguridad**; y luego ajustamos espesor/Low-E/laminado según el caso.\n" +
      (ONE_QUESTION_PER_TURN ? "¿Qué le importa más hoy: térmico, acústico o seguridad?" : "")
    );
  }

  // PDA mention (responde sin prometer certificaciones)
  if (t.includes("pda") || t.includes("descontamin") || t.includes("leña") || t.includes("smog")) {
    return (
      `Sobre el PDA: busca bajar emisiones asociadas a calefacción. Una ventana eficiente ayuda porque reduce pérdidas térmicas e infiltraciones, por lo que necesita menos calefacción para el mismo confort.\n` +
      `En la práctica, el resultado depende de **DVH**, **hermeticidad** y **buena instalación**.\n` +
      (ONE_QUESTION_PER_TURN ? "¿Le preocupa más el confort térmico, el ruido o la seguridad?" : "") +
      expertFooter()
    );
  }

  // If user complains about speed / robot
  if (t.includes("robot") || t.includes("muy rápido") || t.includes("muy rapido") || t.includes("no me escuch") || t.includes("no responde")) {
    return "Entendido. Voy a responderle más ordenado y sin repetir preguntas. Dígame: ¿ventanas o puertas, y en qué comuna es el proyecto?";
  }

  return null;
}

function buildReplyBase(session, userTextRaw) {
  const userText = normalizeText(userTextRaw);
  const prefix = maybeGreetingPrefix(session);

  // If session paused (loop guard)
  if (session.flags.pausedUntil && Date.now() < session.flags.pausedUntil) {
    // In pause mode we respond minimally or not at all
    if (LOOP_GUARD_ACTION === "silent") return ""; // no response
    return `${prefix}Perfecto. Me quedo atento y apenas tenga el dato pendiente (comuna / cantidad / medidas) lo cierro.`;
  }

  const expert = expertAnswer(session, userText);
  if (expert) return `${prefix}${expert}`;

  // If outside business hours and BUSINESS_HOURS_ONLY is true: respond once and stop asking too much
  if (BUSINESS_HOURS_ONLY && !isWithinBusinessHours()) {
    // Still greet once if needed, then after-hours message
    return `${prefix}${AFTER_HOURS_MESSAGE}`;
  }

  // Consultive explain before ask
  const t = userText.toLowerCase();
  const p = session.profile;

  // If user says "no sé / oriénteme"
  if (t.includes("no sé") || t.includes("no se") || t.includes("oriént") || t.includes("orient")) {
    const explain =
      EXPLAIN_BEFORE_ASK
        ? `Perfecto, le explico simple: para una buena ventana/puerta consideramos ${simplePillars()} Luego ajustamos material (PVC o aluminio), tipo de apertura y el DVH según su objetivo.\n`
        : "";
    const q = nextSingleQuestion(session);
    return `${prefix}${explain}${q || "¿En qué comuna es y cuántas unidades necesita?"}`;
  }

  // Quote request
  if (t.includes("cotiza") || t.includes("cotización") || t.includes("precio") || t.includes("presupuesto")) {
    const prods = p.products.length ? p.products.join(" y ") : "ventanas";
    const qty = p.qty ? `${p.qty}` : "—";
    const lastDim = p.dims?.length ? p.dims[p.dims.length - 1] : null;
    const dimsText = lastDim ? `${lastDim.w_mm}x${lastDim.h_mm} mm` : "—";
    const explain =
      EXPLAIN_BEFORE_ASK
        ? `Perfecto. Para cotizar bien (y evitar sorpresas en instalación), definimos objetivo y cerramos medidas/apertura.\n`
        : "";
    const q = nextSingleQuestion(session);
    return (
      `${prefix}${explain}` +
      `Con lo que me indicó, ya puedo armar una **cotización base**:\n` +
      (ALLOW_BULLETS
        ? `• Producto: ${prods}\n• Comuna/ciudad: ${p.comuna || p.city || DEFAULT_CITY}\n• Cantidad: ${qty}\n• Medida ref.: ${dimsText}\n`
        : `Producto: ${prods}. Comuna/ciudad: ${p.comuna || p.city || DEFAULT_CITY}. Cantidad: ${qty}. Medida ref.: ${dimsText}.\n`) +
      (q ? `\n${q}` : "\nSi me confirma apertura y si es con instalación, se la dejo cerrada.")
    );
  }

  // Default: ask the single best next question
  const q = nextSingleQuestion(session);
  if (!q) {
    return `${prefix}Excelente. Con esto avanzamos bien. Si le parece, coordinamos medición o me envía fotos de los vanos y cierro la propuesta técnica y comercial.`;
  }
  return `${prefix}${q}`;
}

/* =========================
   AI polishing (optional)
========================= */
function stripRepeatedGreetingIfNeeded(session, text) {
  // if already greeted, prevent AI from greeting again
  if (!session.flags.greeted) return text;
  return (text || "")
    .replace(/^(hola|buenos días|buenas tardes|buenas noches)[,!\.\s]+/i, "")
    .trim();
}

function enforceOneQuestion(text) {
  if (!ONE_QUESTION_PER_TURN) return text;
  // crude but effective: keep only first '?' segment
  const s = text || "";
  const idx = s.indexOf("?");
  if (idx === -1) return s;
  // Keep up to first '?', remove other questions after it
  const first = s.slice(0, idx + 1);
  // Keep trailing text only if it doesn't contain another '?'
  const rest = s.slice(idx + 1);
  const restNoQ = rest.replace(/\?/g, "."); // neutralize
  return (first + restNoQ).trim();
}

function buildSystemPrompt() {
  const styleExamplesUsted =
    "Estilo chileno, cercano y profesional. Use expresiones como: “Perfecto”, “De acuerdo”, “Impecable”, “Buenísimo”. Trato: USTED.";
  const styleExamplesTu =
    "Estilo chileno, cercano y profesional. Use expresiones como: “Perfecto”, “De acuerdo”, “Impecable”, “Buenísimo”. Trato: TÚ.";

  return `
Usted es asesor comercial humano de ${COMPANY_NAME} (Chile). ${TONE === "tu" ? styleExamplesTu : styleExamplesUsted}

REGLAS ESTRICTAS:
- SOLO vendemos: VENTANAS y PUERTAS (PVC y/o aluminio). No ofrezca muro cortina ni tabiques ni otros.
- Objetivo: venta consultiva, sonar experto, cero “robot”.
- NO repita el saludo si greeted=true.
- 1 solo mensaje por turno.
- Máximo ${MAX_LINES_PER_REPLY} líneas y ${MAX_REPLY_CHARS} caracteres.
- Máximo 1 pregunta por turno.
- No repita preguntas que ya fueron respondidas (use el perfil).
- Si el usuario pregunta por condensación: explique HR alta (~80%) + superficie fría (~12°C), y solución DVH + hermeticidad + instalación.
- Siempre mencione los 3 pilares cuando corresponda: térmico, acústico, seguridad.
- No invente números normativos ni certificaciones. Si hay texto en MINVU_* se puede mencionar como “asesoría técnica”.
- Cierre suave: medición o fotos para cerrar cotización.

FORMATO:
- Respuestas claras, humanas, sin plantillas.
- Si enumera, use bullets solo si ALLOW_BULLETS=true.
`.trim();
}

async function aiPolish(session, userText, baseReply) {
  if (!openai) return baseReply;

  const system = buildSystemPrompt();

  // Build a compact context
  const profile = session.profile;
  const history = session.history
    .slice(-clamp(RECALL_LAST_N_TURNS * 2, 4, 40))
    .map(h => `${h.role === "user" ? "Cliente" : "Asesor"}: ${h.content}`)
    .join("\n");

  try {
    const resp = await openai.responses.create({
      model: AI_MODEL_OPENAI,
      temperature: clamp(AI_TEMPERATURE, 0, 1),
      max_output_tokens: clamp(AI_MAX_OUTPUT_TOKENS, 80, 800),
      input: [
        { role: "system", content: system },
        {
          role: "user",
          content:
            `greeted=${session.flags.greeted}\n` +
            `ALLOW_BULLETS=${ALLOW_BULLETS}\n` +
            `Perfil=${JSON.stringify(profile)}\n` +
            `Historial reciente:\n${history}\n\n` +
            `Cliente dice: ${userText}\n\n` +
            `Base (corrige sin cambiar el sentido): ${baseReply}`,
        },
      ],
    });

    let out = normalizeText(resp.output_text || "");
    out = stripRepeatedGreetingIfNeeded(session, out);
    out = enforceOneQuestion(out);
    out = cleanAndLimitText(out);
    return out || cleanAndLimitText(baseReply);
  } catch (e) {
    console.warn("OpenAI failed:", e?.message || e);
    return cleanAndLimitText(baseReply);
  }
}

/* =========================
   Rate limit + loop guard
========================= */
function checkRateLimit(session) {
  const now = Date.now();
  // per minute rate cap
  session.sentTimestamps = session.sentTimestamps.filter(ts => now - ts < 60 * 1000);
  if (session.sentTimestamps.length >= RATE_LIMIT_PER_USER_PER_MIN) return false;
  return true;
}

function checkLoopGuard(session) {
  const now = Date.now();
  // window 5 min
  const windowMs = 5 * 60 * 1000;
  const recent = session.sentTimestamps.filter(ts => now - ts < windowMs);
  if (recent.length >= LOOP_GUARD_MAX_REPLIES_PER_5MIN) return true;
  return false;
}

function applyLoopGuard(session) {
  if (LOOP_GUARD_ACTION === "silent") {
    session.flags.pausedUntil = Date.now() + LOOP_PAUSE_MINUTES * 60 * 1000;
    return { mode: "silent" };
  }
  if (LOOP_GUARD_ACTION === "pause") {
    session.flags.pausedUntil = Date.now() + LOOP_PAUSE_MINUTES * 60 * 1000;
    return { mode: "pause" };
  }
  // default: handoff
  session.flags.handedOff = true;
  return { mode: "handoff" };
}

/* =========================
   Debounce processing
========================= */
async function processBuffered(session) {
  const from = session.buffer.lastFrom;
  const contextId = session.buffer.contextId;
  const combined = normalizeText(session.buffer.parts.join(" "));
  const lastType = session.buffer.lastMsgType;

  // clear buffer first (avoid double send)
  session.buffer.parts = [];
  session.buffer.timer = null;

  if (!from || !combined) return;

  // store user msg in history
  registerHistory(session, "user", combined);

  // If already handed off, respond minimally (or not)
  if (session.flags.handedOff) {
    const prefix = maybeGreetingPrefix(session);
    const msg = cleanAndLimitText(`${prefix}De acuerdo. Ya lo dejo con un ejecutivo. ¿Me confirma comuna y un horario de contacto?`);
    if (msg) await sendText(from, msg, contextId);
    session.sentTimestamps.push(Date.now());
    recordAssistantOutput(session, msg);
    registerHistory(session, "assistant", msg);
    return;
  }

  // Business hours gating
  if (BUSINESS_HOURS_ONLY && !isWithinBusinessHours()) {
    const prefix = maybeGreetingPrefix(session);
    const msg = cleanAndLimitText(`${prefix}${AFTER_HOURS_MESSAGE}`);
    if (msg) await sendText(from, msg, contextId);
    session.sentTimestamps.push(Date.now());
    recordAssistantOutput(session, msg);
    registerHistory(session, "assistant", msg);
    return;
  }

  // Rate limit
  if (!checkRateLimit(session)) {
    // do not spam; silent
    return;
  }

  // Loop guard check (before composing)
  if (checkLoopGuard(session)) {
    const { mode } = applyLoopGuard(session);
    if (mode === "silent") return;

    const prefix = maybeGreetingPrefix(session);
    const msg =
      mode === "handoff"
        ? cleanAndLimitText(`${prefix}Para ayudarle bien (sin repetir preguntas), lo derivo con un ejecutivo. ¿Me confirma comuna y horario de contacto?`)
        : cleanAndLimitText(`${prefix}Perfecto. Pauso un momento para ordenar la información y no marearlo. ¿Me confirma comuna y cantidad, por favor?`);

    if (msg) await sendText(from, msg, contextId);
    session.sentTimestamps.push(Date.now());
    recordAssistantOutput(session, msg);
    registerHistory(session, "assistant", msg);
    return;
  }

  // Human delay: base + extras
  const baseDelay = clamp(randInt(MIN_RESPONSE_DELAY_MS, MAX_RESPONSE_DELAY_MS), 250, 12000);
  const extraLong = combined.length >= 120 ? EXTRA_DELAY_LONG_MESSAGES_MS : 0;
  const extraMedia = lastType !== "text" ? EXTRA_DELAY_MEDIA_MS : 0;

  // “Typing simulation” time (best effort): wait a bit more before sending
  const typingDelay = TYPING_SIMULATION ? clamp(randInt(TYPING_MIN_MS, TYPING_MAX_MS), 200, 8000) : 0;

  await sleep(baseDelay + extraLong + extraMedia + typingDelay);

  // Build reply
  const baseReplyRaw = buildReplyBase(session, combined);
  let baseReply = cleanAndLimitText(baseReplyRaw);

  // Anti-repeat: if exact same output recently, soften/adjust by asking next question or closing
  if (baseReply && recentlyRepeated(session, baseReply)) {
    const q = nextSingleQuestion(session);
    baseReply = cleanAndLimitText(
      q ? `Perfecto. Para avanzar sin repetirnos: ${q}` : "Perfecto. Con esto ya puedo avanzar. ¿Prefiere medición o fotos para cerrar la cotización?"
    );
  }

  // AI polish (optional)
  let finalReply = baseReply;
  if (openai && baseReply) {
    finalReply = await aiPolish(session, combined, baseReply);
  }

  finalReply = enforceOneQuestion(finalReply);
  finalReply = cleanAndLimitText(finalReply);

  if (!finalReply) return;

  // Send
  await sendText(from, finalReply, contextId);

  // Track sent
  session.sentTimestamps.push(Date.now());
  recordAssistantOutput(session, finalReply);
  registerHistory(session, "assistant", finalReply);

  // Optional: update notes summary
  if (SUMMARIZE_CONTEXT) {
    session.notes = summarizeSession(session);
  }
}

function summarizeSession(session) {
  const p = session.profile;
  const parts = [];
  if (p.name) parts.push(`Nombre: ${p.name}`);
  if (p.customerType) parts.push(`Tipo: ${p.customerType}`);
  if (p.comuna || p.city) parts.push(`Ubicación: ${p.comuna || p.city}`);
  if (p.products?.length) parts.push(`Productos: ${p.products.join(" y ")}`);
  if (p.priority) parts.push(`Prioridad: ${p.priority}`);
  if (p.goal) parts.push(`Tema: ${p.goal}`);
  if (p.qty) parts.push(`Cantidad: ${p.qty}`);
  if (p.dims?.length) {
    const d = p.dims[p.dims.length - 1];
    parts.push(`Medida ref: ${d.w_mm}x${d.h_mm}`);
  }
  if (p.opening) parts.push(`Apertura: ${p.opening}`);
  if (p.install) parts.push(`Instalación: ${p.install}`);
  if (p.material) parts.push(`Material: ${p.material}`);
  if (p.schedule) parts.push(`Plazo: ${p.schedule}`);
  return parts.join(" | ");
}

/* =========================
   Inbound enqueue (debounce)
========================= */
async function enqueueInboundMessage(message) {
  const messageId = message.id;
  const from = message.from;
  const type = message.type || "text";

  if (!from || !messageId) return;

  if (wasProcessed(messageId)) return;
  rememberProcessed(messageId);

  await markReadAndMaybeTyping(messageId);

  // Extract user text
  let userText = "";
  if (type === "text") userText = message.text?.body || "";
  else if (type === "interactive") {
    userText =
      message.interactive?.button_reply?.title ||
      message.interactive?.list_reply?.title ||
      "";
  } else {
    // media: ask for what we need but don't crash
    userText = message.caption || "";
  }

  userText = normalizeText(userText);
  if (!userText && type !== "text") {
    userText = "[media]";
  }
  if (!userText) return;

  const session = getSession(from);

  // Update profile from each chunk
  extractInfo(session, userText);

  // Buffer it
  session.buffer.lastMsgId = messageId;
  session.buffer.lastFrom = from;
  session.buffer.lastAt = Date.now();
  session.buffer.contextId = messageId;
  session.buffer.lastMsgType = type;
  session.buffer.parts.push(userText);

  // Debounce timer
  if (session.buffer.timer) clearTimeout(session.buffer.timer);
  session.buffer.timer = setTimeout(() => {
    processBuffered(session).catch((e) => console.error("processBuffered crashed:", e?.response?.data || e.message));
  }, WAIT_AFTER_LAST_USER_MESSAGE_MS);
}

/* =========================
   Webhooks
========================= */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", (req, res) => {
  // Respond fast to Meta
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body?.object !== "whatsapp_business_account") return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const messages = value.messages || [];
        for (const m of messages) {
          setImmediate(() => {
            enqueueInboundMessage(m).catch((e) =>
              console.error("enqueueInboundMessage crashed:", e?.response?.data || e.message)
            );
          });
        }
      }
    }
  } catch (e) {
    console.error("POST /webhook error:", e);
  }
});

app.get("/", (_req, res) => res.status(200).send("OK"));

/* =========================
   Boot
========================= */
app.listen(PORT, () => {
  console.log("BOOT: starting app...");
  console.log("ENV PORT:", PORT);
  console.log("ENV PHONE_NUMBER_ID:", PHONE_NUMBER_ID ? "OK" : "NOT_SET");
  console.log("ENV WHATSAPP_TOKEN:", WHATSAPP_TOKEN ? "OK" : "NOT_SET");
  console.log("ENV VERIFY_TOKEN:", VERIFY_TOKEN ? "OK" : "NOT_SET");
  console.log("ENV OPENAI_API_KEY:", OPENAI_API_KEY ? "OK" : "NOT_SET");
  console.log("ENV AI_PROVIDER:", AI_PROVIDER || "NOT_SET");
  console.log("ENV AI_MODEL_OPENAI:", AI_MODEL_OPENAI || "NOT_SET");
  console.log("ENV BUSINESS_TIMEZONE:", BUSINESS_TIMEZONE);
  console.log("ENV WAIT_AFTER_LAST_USER_MESSAGE_MS:", WAIT_AFTER_LAST_USER_MESSAGE_MS);
  console.log("ENV MIN/MAX_RESPONSE_DELAY_MS:", MIN_RESPONSE_DELAY_MS, "/", MAX_RESPONSE_DELAY_MS);
  console.log("ENV ONE_QUESTION_PER_TURN:", ONE_QUESTION_PER_TURN);
  console.log("ENV MAX_LINES_PER_REPLY:", MAX_LINES_PER_REPLY);
  console.log("ENV MAX_REPLY_CHARS:", MAX_REPLY_CHARS);
  console.log("ENV BUSINESS_HOURS_ONLY:", BUSINESS_HOURS_ONLY);
  console.log("ENV BUSINESS_HOURS:", BUSINESS_HOURS_START, "-", BUSINESS_HOURS_END);
  console.log("ENV HUMAN_HANDOFF_ENABLED:", HUMAN_HANDOFF_ENABLED);
  console.log("ENV CRM_WEBHOOK_URL:", CRM_WEBHOOK_URL ? "SET" : "NOT_SET");
  console.log(`✅ Server running on port ${PORT}`);
});
