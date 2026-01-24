import express from "express";
import axios from "axios";
import OpenAI from "openai";
import crypto from "crypto";

/**
 * =========================================================
 * CONFIG / ENV
 * =========================================================
 */
const app = express();
app.use(express.json({ limit: "12mb" }));

const PORT = process.env.PORT || 8080;

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v22.0";

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";

const AI_PROVIDER = (process.env.AI_PROVIDER || "openai").toLowerCase();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const AI_MODEL_OPENAI = process.env.AI_MODEL_OPENAI || "gpt-4.1-mini";

const COMPANY_NAME = process.env.COMPANY_NAME || "Activa Inversiones EIRL";
const BRAND_SHORT = process.env.BRAND_SHORT || "Activa";
const AGENT_NAME = process.env.AGENT_NAME || "Marcelo Cifuentes";

const LANGUAGE = process.env.LANGUAGE || "es-CL";
const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || "America/Santiago";

// Horario
const BUSINESS_HOURS_ONLY = String(process.env.BUSINESS_HOURS_ONLY || "false") === "true";
const BUSINESS_HOURS_START = process.env.BUSINESS_HOURS_START || "09:00";
const BUSINESS_HOURS_END = process.env.BUSINESS_HOURS_END || "19:00";
const AFTER_HOURS_MESSAGE =
  process.env.AFTER_HOURS_MESSAGE ||
  "Gracias por escribir. Ahora estamos fuera de horario, pero apenas retomemos te respondemos y coordinamos la cotización.";

// Espera para que el cliente “termine de escribir”
const WAIT_AFTER_LAST_USER_MESSAGE_MS = Number(process.env.WAIT_AFTER_LAST_USER_MESSAGE_MS || 5500);

// Delays humanos (recomendación aplicada)
const HUMAN_DELAY_MS_MIN = Number(process.env.HUMAN_DELAY_MS_MIN || 1800);
const HUMAN_DELAY_MS_MAX = Number(process.env.HUMAN_DELAY_MS_MAX || 4200);
const MIN_RESPONSE_DELAY_MS = Number(process.env.MIN_RESPONSE_DELAY_MS || 0);
const MAX_RESPONSE_DELAY_MS = Number(process.env.MAX_RESPONSE_DELAY_MS || 15000);
const EXTRA_DELAY_LONG_MESSAGES_MS = Number(process.env.EXTRA_DELAY_LONG_MESSAGES_MS || 900);
const EXTRA_DELAY_MEDIA_MS = Number(process.env.EXTRA_DELAY_MEDIA_MS || 1800);

// “Escribiendo…” simulado (solo delay, no puntitos reales)
const TYPING_SIMULATION = String(process.env.TYPING_SIMULATION || "true") === "true";
const TYPING_MIN_MS = Number(process.env.TYPING_MIN_MS || 900);
const TYPING_MAX_MS = Number(process.env.TYPING_MAX_MS || 2400);

// Estilo/tono (tolerante a tus formatos: 2,0,SOFT,first_message_only)
const TONE = process.env.TONE || "venta consultiva, cercano, técnico cuando corresponde";
const FORMALITY_LEVEL_RAW = String(process.env.FORMALITY_LEVEL || "medio").toLowerCase();
const FORMALITY_LEVEL =
  FORMALITY_LEVEL_RAW === "2" ? "medio" :
  FORMALITY_LEVEL_RAW === "3" ? "alto" :
  FORMALITY_LEVEL_RAW === "1" ? "bajo" :
  (["bajo","medio","alto"].includes(FORMALITY_LEVEL_RAW) ? FORMALITY_LEVEL_RAW : "medio");

const EMOJI_LEVEL_RAW = String(process.env.EMOJI_LEVEL || "off").toLowerCase();
const EMOJI_LEVEL =
  EMOJI_LEVEL_RAW === "0" ? "off" :
  EMOJI_LEVEL_RAW === "1" ? "bajo" :
  EMOJI_LEVEL_RAW === "2" ? "medio" :
  EMOJI_LEVEL_RAW === "3" ? "alto" :
  (["off","bajo","medio","alto"].includes(EMOJI_LEVEL_RAW) ? EMOJI_LEVEL_RAW : "off");

const CTA_STYLE_RAW = String(process.env.CTA_STYLE || "suave").toLowerCase();
const CTA_STYLE =
  (CTA_STYLE_RAW === "soft") ? "suave" :
  (CTA_STYLE_RAW === "suave" || CTA_STYLE_RAW === "directo") ? CTA_STYLE_RAW : "suave";

const GREETING_MODE_RAW = String(process.env.GREETING_MODE || "once").toLowerCase();
const GREETING_MODE =
  (GREETING_MODE_RAW === "first_message_only") ? "once" :
  (GREETING_MODE_RAW === "once" || GREETING_MODE_RAW === "always") ? GREETING_MODE_RAW : "once";

const ALLOW_BULLETS = String(process.env.ALLOW_BULLETS || "true") === "true";
const MAX_LINES_PER_REPLY = Number(process.env.MAX_LINES_PER_REPLY || 14);
const MAX_REPLY_CHARS = Number(process.env.MAX_REPLY_CHARS || 950);
const SIGNATURE_MODE = process.env.SIGNATURE_MODE || "auto"; // off|auto|always

// Flujo conversacional
const SEND_SINGLE_MESSAGE = String(process.env.SEND_SINGLE_MESSAGE || "true") === "true";
const SPLIT_LONG_MESSAGES = String(process.env.SPLIT_LONG_MESSAGES || "false") === "true";
const ONE_QUESTION_PER_TURN = String(process.env.ONE_QUESTION_PER_TURN || "true") === "true";
const MAX_FIELDS_TO_REQUEST = Number(process.env.MAX_FIELDS_TO_REQUEST || 1);
const EXPLAIN_BEFORE_ASK = String(process.env.EXPLAIN_BEFORE_ASK || "true") === "true";
const REPLY_WITH_CONTEXT = String(process.env.REPLY_WITH_CONTEXT || "true") === "true";
const CLOSE_STEP = process.env.CLOSE_STEP || "coordinar medición o recibir fotos";

// Anti-repetición / anti-bucle (recomendación aplicada)
const ANTI_REPEAT_WINDOW_MS = Number(process.env.ANTI_REPEAT_WINDOW_MS || 20000);
const LOOP_GUARD_MAX_REPLIES_PER_5MIN = Number(process.env.LOOP_GUARD_MAX_REPLIES_PER_5MIN || 5);
const LOOP_GUARD_ACTION = process.env.LOOP_GUARD_ACTION || "handoff"; // handoff|slowdown|silence

// Rate limit
const RATE_LIMIT_PER_USER_PER_MIN = Number(process.env.RATE_LIMIT_PER_USER_PER_MIN || 10);

// Defaults
const DEFAULT_CITY = process.env.DEFAULT_CITY || "";
const DEFAULT_PRIORITY = process.env.DEFAULT_PRIORITY || "balance";

// Pilares
const PILLARS =
  process.env.PILLARS ||
  "Aislación térmica, Aislación acústica, Seguridad";

// Handoff humano
const HUMAN_HANDOFF_ENABLED = String(process.env.HUMAN_HANDOFF_ENABLED || "true") === "true";
const HUMAN_HANDOFF_KEYWORDS =
  (process.env.HUMAN_HANDOFF_KEYWORDS || "humano, ejecutivo, asesor, llamar, emergencia, reclamo, postventa")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

// Contacto ventas
const SALES_PHONE = process.env.SALES_PHONE || "";
const SALES_EMAIL = process.env.SALES_EMAIL || "";

// Credenciales (solo si existen en ENV; no inventar)
const EXPERT_BADGE_ENABLED = String(process.env.EXPERT_BADGE_ENABLED || "true") === "true";
const MINVU_CREDENTIALS = process.env.MINVU_CREDENTIALS || "";
const MINVU_EXPERT_NOTE = process.env.MINVU_EXPERT_NOTE || "";

// Sesión
const SESSION_TTL_MINUTES = Number(process.env.SESSION_TTL_MINUTES || 180);

/**
 * =========================================================
 * LOGS STARTUP
 * =========================================================
 */
function logEnv(name, val) {
  console.log(`ENV ${name}:`, val ? "OK" : "NOT_SET");
}
console.log("BOOT: starting app...");
console.log("ENV PORT:", PORT);
console.log("ENV META_GRAPH_VERSION:", META_GRAPH_VERSION);
logEnv("PHONE_NUMBER_ID", PHONE_NUMBER_ID);
logEnv("WHATSAPP_TOKEN", WHATSAPP_TOKEN);
logEnv("VERIFY_TOKEN", VERIFY_TOKEN);
logEnv("OPENAI_API_KEY", OPENAI_API_KEY);
console.log("ENV AI_PROVIDER:", AI_PROVIDER);
console.log("ENV AI_MODEL_OPENAI:", AI_MODEL_OPENAI);
console.log("STYLE FORMALITY_LEVEL:", FORMALITY_LEVEL);
console.log("STYLE EMOJI_LEVEL:", EMOJI_LEVEL);
console.log("STYLE CTA_STYLE:", CTA_STYLE);
console.log("STYLE GREETING_MODE:", GREETING_MODE);

/**
 * =========================================================
 * HELPERS
 * =========================================================
 */
function nowMs() { return Date.now(); }
function randInt(min, max) {
  const a = Math.min(min, max);
  const b = Math.max(min, max);
  return Math.floor(a + Math.random() * (b - a + 1));
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function sha1(s) { return crypto.createHash("sha1").update(String(s)).digest("hex"); }
function normalizeSpaces(s) { return String(s || "").replace(/\s+/g, " ").trim(); }

function greetingByTime() {
  try {
    const parts = new Intl.DateTimeFormat(LANGUAGE, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: BUSINESS_TIMEZONE
    }).formatToParts(new Date());
    const hh = Number(parts.find(p => p.type === "hour")?.value || "0");
    if (hh < 12) return "Buenos días";
    if (hh < 20) return "Buenas tardes";
    return "Buenas noches";
  } catch {
    const hh = new Date().getHours();
    if (hh < 12) return "Buenos días";
    if (hh < 20) return "Buenas tardes";
    return "Buenas noches";
  }
}

function inBusinessHours() {
  if (!BUSINESS_HOURS_ONLY) return true;
  try {
    const parts = new Intl.DateTimeFormat(LANGUAGE, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: BUSINESS_TIMEZONE
    }).formatToParts(new Date());

    const hh = Number(parts.find(p => p.type === "hour")?.value || "0");
    const mm = Number(parts.find(p => p.type === "minute")?.value || "0");
    const cur = hh * 60 + mm;

    const [sh, sm] = BUSINESS_HOURS_START.split(":").map(Number);
    const [eh, em] = BUSINESS_HOURS_END.split(":").map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;

    return cur >= start && cur <= end;
  } catch {
    return true;
  }
}

function extractName(text) {
  const t = String(text || "").trim();
  const m = t.match(/(?:soy|me llamo|mi nombre es)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2})/i);
  if (!m) return null;
  const name = m[1].trim();
  return name.split(/\s+/).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function extractSizesFromText(text) {
  const t = String(text || "").replace(/,/g, ".").toLowerCase();
  const out = [];
  const re = /(\d{1,4}(?:\.\d{1,2})?)\s*(?:x|×)\s*(\d{1,4}(?:\.\d{1,2})?)\s*(mm|cm|m)?/g;
  let m;
  while ((m = re.exec(t))) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    const unit = m[3] || "mm";
    if (unit === "m") { a *= 1000; b *= 1000; }
    if (unit === "cm") { a *= 10; b *= 10; }
    if (a >= 200 && a <= 6000 && b >= 200 && b <= 6000) {
      out.push({ w: Math.round(a), h: Math.round(b), raw: m[0].trim() });
    }
  }
  return out;
}

function detectCity(text) {
  const t = String(text || "").toLowerCase();
  const list = [
    "temuco", "padre las casas", "pucón", "pucon", "villarrica",
    "valdivia", "osorno", "puerto montt", "santiago"
  ];
  for (const c of list) {
    if (t.includes(c)) return c.replace(/\b\w/g, ch => ch.toUpperCase());
  }
  return null;
}

// Solo VENTANAS y PUERTAS (como pediste)
function detectProduct(text) {
  const t = String(text || "").toLowerCase();
  if (t.includes("puerta")) return "puertas";
  if (t.includes("ventana")) return "ventanas";
  return null;
}

function detectProjectType(text) {
  const t = String(text || "").toLowerCase();
  if (t.includes("casa") || t.includes("depto") || t.includes("departamento") || t.includes("vivienda")) return "residencial";
  if (t.includes("local") || t.includes("tienda") || t.includes("comercial")) return "comercial";
  if (t.includes("constructora") || t.includes("obra") || t.includes("licitación")) return "constructor";
  if (t.includes("arquitecto") || t.includes("arquitectura")) return "arquitecto";
  return null;
}

function detectPriority(text) {
  const t = String(text || "").toLowerCase();
  const thermal = t.includes("térmic") || t.includes("termic") || t.includes("frío") || t.includes("frio") || t.includes("calef");
  const acoustic = t.includes("acústic") || t.includes("acustic") || t.includes("ruido");
  const security = t.includes("seguridad") || t.includes("robo") || t.includes("cerradura") || t.includes("laminado");
  if (thermal && !acoustic && !security) return "térmica";
  if (!thermal && acoustic && !security) return "acústica";
  if (!thermal && !acoustic && security) return "seguridad";
  if (thermal || acoustic || security) return "balance";
  return null;
}

function detectQty(text) {
  const m = String(text || "").match(/(\d{1,3})\s*(?:unidades|uds|u|ventanas|puertas)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (Number.isFinite(n) && n >= 1 && n <= 500) return n;
  return null;
}

function containsHandoffKeyword(text) {
  const t = String(text || "").toLowerCase();
  return HUMAN_HANDOFF_KEYWORDS.some(k => k && t.includes(k));
}

// Preguntas “técnicas” que deben responderse primero (sin interrogar)
function isTechnicalQuestion(text) {
  const t = String(text || "").toLowerCase();
  const keys = [
    "eficiencia", "energética", "energetica", "pda", "ces", "zona térmica", "zona termica",
    "transmitancia", "u ", "valor u", "uw", "ug", "condens", "humedad", "low-e", "dvh", "termopanel",
    "lluvia", "viento", "normativa", "minvu", "oguc", "dit ec", "ditec"
  ];
  return keys.some(k => t.includes(k));
}

function clipLines(text, maxLines) {
  const lines = String(text || "").split("\n").filter(l => l.trim().length);
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n").trim();
}

function clipChars(text, maxChars) {
  const t = String(text || "");
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars - 1).trimEnd() + "…";
}

function splitMessage(text, maxChars) {
  const chunks = [];
  let remaining = String(text || "");
  while (remaining.length > maxChars) {
    chunks.push(remaining.slice(0, maxChars));
    remaining = remaining.slice(maxChars);
  }
  if (remaining.trim()) chunks.push(remaining);
  return chunks;
}

/**
 * =========================================================
 * SESSION / DEDUPE / LIMITS
 * =========================================================
 */
const sessions = new Map();
const processedMsgIds = new Map();

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      createdAt: nowMs(),
      lastSeen: nowMs(),
      greeted: false,
      name: null,
      projectType: null,
      city: DEFAULT_CITY || null,
      product: null,
      priority: DEFAULT_PRIORITY || null,
      qty: null,
      sizes: [],
      timeline: null,

      buffer: [],
      timer: null,

      lastAskKey: null,
      lastAskAt: 0,

      replyTimestamps: [],
      lastBotHash: null,

      lastMinuteWindowStart: nowMs(),
      perMinCount: 0
    });
  }
  const s = sessions.get(waId);
  s.lastSeen = nowMs();
  return s;
}

function prune() {
  const ttl = SESSION_TTL_MINUTES * 60 * 1000;
  const t = nowMs();
  for (const [waId, s] of sessions.entries()) {
    if ((t - s.lastSeen) > ttl) sessions.delete(waId);
  }
  for (const [msgId, ts] of processedMsgIds.entries()) {
    if ((t - ts) > 24 * 60 * 60 * 1000) processedMsgIds.delete(msgId);
  }
}
setInterval(prune, 60_000).unref();

function shouldIgnoreDuplicateMsg(messageId) {
  if (!messageId) return false;
  if (processedMsgIds.has(messageId)) return true;
  processedMsgIds.set(messageId, nowMs());
  return false;
}

function rateLimitOk(session) {
  const t = nowMs();
  if ((t - session.lastMinuteWindowStart) > 60_000) {
    session.lastMinuteWindowStart = t;
    session.perMinCount = 0;
  }
  session.perMinCount += 1;
  return session.perMinCount <= RATE_LIMIT_PER_USER_PER_MIN;
}

function loopGuardOk(session) {
  const t = nowMs();
  session.replyTimestamps = session.replyTimestamps.filter(x => (t - x) <= 5 * 60_000);
  return session.replyTimestamps.length < LOOP_GUARD_MAX_REPLIES_PER_5MIN;
}

function shouldAsk(session, askKey) {
  const t = nowMs();
  if (session.lastAskKey === askKey && (t - session.lastAskAt) < ANTI_REPEAT_WINDOW_MS) return false;
  session.lastAskKey = askKey;
  session.lastAskAt = t;
  return true;
}

/**
 * =========================================================
 * WHATSAPP API
 * =========================================================
 */
async function waPost(payload) {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  return axios.post(url, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
  });
}

async function markAsRead(messageId) {
  if (!messageId) return;
  try {
    await waPost({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId
    });
  } catch (e) {
    console.log("WARN markAsRead:", e?.response?.data || e.message);
  }
}

async function sendText(to, body) {
  const text = normalizeSpaces(body);
  if (!text) return;
  await waPost({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text }
  });
}

async function getMediaUrl(mediaId) {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${mediaId}`;
  const r = await axios.get(url, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
  });
  return r.data?.url;
}

async function downloadMediaToBuffer(mediaUrl) {
  const r = await axios.get(mediaUrl, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
  });
  return Buffer.from(r.data);
}

async function tryExtractFromPdf(buffer) {
  // requiere: npm i pdf-parse
  try {
    const mod = await import("pdf-parse");
    const pdfParse = mod.default || mod;
    const data = await pdfParse(buffer);
    const txt = data?.text || "";
    return extractSizesFromText(txt);
  } catch {
    return [];
  }
}

/**
 * =========================================================
 * AI
 * =========================================================
 */
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

function minvuBadgeText() {
  if (!EXPERT_BADGE_ENABLED) return "";
  const creds = normalizeSpaces(MINVU_CREDENTIALS);
  const note = normalizeSpaces(MINVU_EXPERT_NOTE);
  if (!creds && !note) return "";
  return `\nCREDENCIALES (mencionar solo si lo preguntan): ${creds || ""} ${note || ""}`.trim();
}

// Base técnica (consultiva) — sin inventar certificados; solo si están en ENV.
const KNOWLEDGE = `
FOCO COMERCIAL:
- Cotizamos VENTANAS y PUERTAS (PVC y aluminio). Todas pueden llevar termopanel (DVH).

PILARES (siempre presentes):
1) Aislación térmica (confort y ahorro).
2) Aislación acústica (reducción de ruido).
3) Seguridad (herrajes, cerraduras, laminado y correcta instalación).

CONDENSACIÓN (explicación técnica en simple):
- Se produce por punto de rocío: aire interior con alta humedad + superficie fría.
- En práctica, cuando la humedad relativa se mantiene muy alta (ej: > 80%) y hay superficies a baja temperatura, puede aparecer condensación.
- Sistemas de PVC multicámara + buen DVH + instalación/sellos correctos reducen mucho el riesgo, pero igual recomendamos ventilación y control de humedad.

EFICIENCIA ENERGÉTICA / PDA / CES (orientación experta):
- Eficiencia: clave es el conjunto: perfil (multicámara), DVH, Low-E cuando corresponde, hermeticidad y correcta instalación (evitar puentes térmicos).
- PDA Temuco–Padre Las Casas: mejorar envolvente (ventanas) reduce demanda de calefacción y pérdidas térmicas, ayudando a disminuir emisiones por combustión residencial.
- CES: ventanas de buen desempeño aportan a confort térmico, acústico y eficiencia del edificio (según diseño/estándar del proyecto).
- Zonas/clima: en zonas frías y lluviosas se prioriza DVH + sellos + instalación muy cuidada; Low-E suele marcar diferencia.

MEDICIÓN PROFESIONAL:
- Aceptada la propuesta: asignamos especialista técnico.
- Verificación de vanos en terreno con telémetro láser y control de plomos/niveles.
- Informe técnico de verificación para minimizar errores de fabricación/instalación.

${minvuBadgeText()}
`.trim();

function systemPrompt() {
  return `
Eres asesor técnico-comercial humano de ${COMPANY_NAME} (Chile).
Tono: ${TONE}. Formalidad: ${FORMALITY_LEVEL}. Emojis: ${EMOJI_LEVEL}.
Reglas de conversación:
- Saluda según hora de Chile y preséntate como ${AGENT_NAME}. 
- Saluda SOLO 1 vez si GREETING_MODE=once.
- Si el cliente indica su nombre (ej: “soy Juan”), úsalo.
- SOLO ventanas y puertas. Si piden “muros cortina/tabiques”, redirige: “Nos enfocamos en ventanas y puertas; ¿qué necesitas exactamente?”.
- NO interrogues: responde primero las dudas técnicas y luego pide SOLO 1 dato para avanzar.
- Máximo ${MAX_FIELDS_TO_REQUEST} dato(s) por turno. ${ONE_QUESTION_PER_TURN ? "Solo 1 pregunta." : ""}
- Evita repetición de preguntas y frases tipo “Perfecto, ya entendí” en bucle.
- Máximo 1 mensaje por respuesta. (SEND_SINGLE_MESSAGE=${SEND_SINGLE_MESSAGE})
- Si piden humano o hay reclamo: deriva a especialista y pide SOLO 1 confirmación (llamada/WhatsApp).
Base técnica:
${KNOWLEDGE}
`.trim();
}

function buildUserContext(session, userText) {
  const known = {
    name: session.name || "no informado",
    city: session.city || "no informado",
    product: session.product || "no definido",
    projectType: session.projectType || "no definido",
    priority: session.priority || "no definido",
    qty: session.qty || "no definido",
    sizes: session.sizes?.length ? session.sizes.map(s => `${s.w}x${s.h}mm`).join(", ") : "no definido"
  };

  return `
DATOS CONOCIDOS:
${JSON.stringify(known, null, 2)}

MENSAJE DEL CLIENTE:
${userText}
`.trim();
}

/**
 * =========================================================
 * DEBOUNCE (espera que el cliente termine de escribir)
 * =========================================================
 */
async function scheduleProcess(waId) {
  const session = getSession(waId);
  if (session.timer) clearTimeout(session.timer);

  session.timer = setTimeout(async () => {
    session.timer = null;

    const combined = normalizeSpaces(session.buffer.join("\n"));
    session.buffer = [];
    if (!combined) return;

    if (!inBusinessHours()) {
      await sendText(waId, AFTER_HOURS_MESSAGE);
      return;
    }

    if (!rateLimitOk(session)) return;

    if (!loopGuardOk(session)) {
      if (LOOP_GUARD_ACTION === "silence") return;
      if (LOOP_GUARD_ACTION === "slowdown") await sleep(randInt(4000, 8000));
      if (LOOP_GUARD_ACTION === "handoff" && HUMAN_HANDOFF_ENABLED) {
        const msg = `${greetingByTime()}, para ayudarte bien prefiero derivarte con un especialista humano. ¿Te llamamos o seguimos por WhatsApp?`;
        await sendText(waId, msg);
        session.replyTimestamps.push(nowMs());
        return;
      }
    }

    let delay = randInt(HUMAN_DELAY_MS_MIN, HUMAN_DELAY_MS_MAX);
    delay = Math.max(delay, MIN_RESPONSE_DELAY_MS);
    delay = Math.min(delay, MAX_RESPONSE_DELAY_MS);
    if (combined.length > 140) delay += EXTRA_DELAY_LONG_MESSAGES_MS;
    if (TYPING_SIMULATION) delay += randInt(TYPING_MIN_MS, TYPING_MAX_MS);

    await sleep(delay);

    await processMessage(waId, combined, session);
  }, WAIT_AFTER_LAST_USER_MESSAGE_MS);
}

/**
 * =========================================================
 * CORE PROCESSING
 * =========================================================
 */
async function processMessage(waId, text, session) {
  // Handoff keywords
  if (HUMAN_HANDOFF_ENABLED && containsHandoffKeyword(text)) {
    const msg = `${greetingByTime()}, entendido. Te derivo con un especialista humano para que lo resolvamos bien. ¿Prefieres llamada o seguimos por WhatsApp?`;
    await sendText(waId, msg);
    session.replyTimestamps.push(nowMs());
    return;
  }

  // Actualiza memoria básica
  const nm = extractName(text);
  if (nm && !session.name) session.name = nm;

  const c = detectCity(text);
  if (c && !session.city) session.city = c;

  const p = detectProduct(text);
  if (p && !session.product) session.product = p;

  const pt = detectProjectType(text);
  if (pt && !session.projectType) session.projectType = pt;

  const pr = detectPriority(text);
  if (pr && !session.priority) session.priority = pr;

  const q = detectQty(text);
  if (q && !session.qty) session.qty = q;

  const sizes = extractSizesFromText(text);
  if (sizes.length) {
    const keys = new Set(session.sizes.map(s => `${s.w}x${s.h}`));
    for (const s of sizes) {
      const k = `${s.w}x${s.h}`;
      if (!keys.has(k)) session.sizes.push(s);
    }
  }

  // Saludo (solo 1 vez si GREETING_MODE=once)
  const greet =
    (GREETING_MODE === "always" || !session.greeted)
      ? `${greetingByTime()}, soy ${AGENT_NAME} de ${BRAND_SHORT}.`
      : "";
  if (GREETING_MODE === "once") session.greeted = true;

  // Si no hay IA
  if (!openai || AI_PROVIDER !== "openai") {
    const namePart = session.name ? ` ${session.name},` : "";
    const askKey = "fallback_min_fields";
    const canAsk = shouldAsk(session, askKey);

    // Responder primero si hay pregunta técnica
    const techFirst = isTechnicalQuestion(text);
    const question = canAsk
      ? (techFirst
        ? "¿En qué ciudad/comuna es el proyecto? Con eso te recomiendo la configuración más adecuada."
        : "¿En qué ciudad/comuna es el proyecto?")
      : "Cuéntame un poco más y lo dejamos cerrado.";

    const msg = `${greet}${namePart} trabajamos ventanas y puertas en PVC y aluminio con DVH. ${question}`;
    await sendText(waId, clipChars(msg, MAX_REPLY_CHARS));
    session.replyTimestamps.push(nowMs());
    return;
  }

  // IA
  const sys = systemPrompt();
  const user = buildUserContext(session, text);

  let reply = "";
  try {
    const resp = await openai.chat.completions.create({
      model: AI_MODEL_OPENAI,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user }
      ],
      temperature: 0.45
    });
    reply = (resp.choices?.[0]?.message?.content || "").trim();
  } catch (e) {
    console.log("ERROR OpenAI:", e?.response?.data || e.message);
  }

  // Fallback si IA falla
  if (!reply) {
    const namePart = session.name ? ` ${session.name},` : "";
    const askKey = "min_fields";
    const canAsk = shouldAsk(session, askKey);

    // Si el usuario hizo pregunta técnica, responder primero (breve) y pedir 1 dato
    const techFirst = isTechnicalQuestion(text);

    let first = techFirst
      ? "Sobre eficiencia/condensación: lo más importante es el conjunto (perfil + DVH + sellos + instalación). En zonas frías/lluviosas el DVH y una instalación bien sellada marcan la diferencia."
      : "Perfecto, te asesoro con una solución equilibrada entre térmico, acústico y seguridad.";

    const question = canAsk
      ? "¿En qué ciudad/comuna es el proyecto?"
      : "Cuéntame 1 dato más del proyecto y avanzamos.";

    reply = `${greet}${namePart} ${first} ${question}`;
  } else {
    // Prepend saludo si hace falta
    if (greet && !/buenos|buenas/i.test(reply)) {
      const namePart = session.name ? ` ${session.name},` : "";
      reply = `${greet}${namePart} ${reply}`;
    }
  }

  // Anti-bucle por hash
  const h = sha1(reply);
  if (session.lastBotHash && session.lastBotHash === h) {
    reply += "\n\nPara avanzar sin vueltas: envíame una foto del vano o un croquis con 1 medida y te armo la propuesta técnica.";
  }
  session.lastBotHash = sha1(reply);

  // Ajustes finales
  reply = clipLines(reply, MAX_LINES_PER_REPLY);
  reply = clipChars(reply, MAX_REPLY_CHARS);

  if (SIGNATURE_MODE === "always" || (SIGNATURE_MODE === "auto" && FORMALITY_LEVEL === "alto")) {
    reply += `\n\n— ${AGENT_NAME}`;
  }

  if (CTA_STYLE === "directo") {
    const extras = [];
    if (SALES_PHONE) extras.push(`Tel: ${SALES_PHONE}`);
    if (SALES_EMAIL) extras.push(`Email: ${SALES_EMAIL}`);
    if (extras.length) reply += `\n\nContacto: ${extras.join(" | ")}`;
  }

  if (SEND_SINGLE_MESSAGE) {
    if (SPLIT_LONG_MESSAGES && reply.length > MAX_REPLY_CHARS) {
      for (const chunk of splitMessage(reply, MAX_REPLY_CHARS)) await sendText(waId, chunk);
    } else {
      await sendText(waId, reply);
    }
  } else {
    await sendText(waId, reply);
  }

  session.replyTimestamps.push(nowMs());
}

/**
 * =========================================================
 * WEBHOOK VERIFY
 * =========================================================
 */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/**
 * =========================================================
 * WEBHOOK RECEIVER
 * =========================================================
 */
app.post("/webhook", async (req, res) => {
  try {
    res.sendStatus(200); // responder rápido a Meta

    const body = req.body;
    if (body.object !== "whatsapp_business_account") return;

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    const messages = value?.messages || [];
    if (!messages.length) return;

    for (const msg of messages) {
      const waId = msg.from;
      const messageId = msg.id;

      if (shouldIgnoreDuplicateMsg(messageId)) continue;

      // marcar como leído
      await markAsRead(messageId);

      const session = getSession(waId);

      if (msg.type === "text") {
        session.buffer.push(msg.text?.body || "");
        await scheduleProcess(waId);
        continue;
      }

      if (msg.type === "button") {
        session.buffer.push(msg.button?.text || "");
        await scheduleProcess(waId);
        continue;
      }

      if (msg.type === "image" || msg.type === "document") {
        await sleep(EXTRA_DELAY_MEDIA_MS);

        const caption = (msg.image?.caption || msg.document?.caption || "").trim();
        if (caption) session.buffer.push(caption);

        const mime = msg.document?.mime_type || "";
        const mediaId = msg.document?.id || msg.image?.id;

        if (mediaId && mime.toLowerCase().includes("pdf")) {
          try {
            const mediaUrl = await getMediaUrl(mediaId);
            const buf = await downloadMediaToBuffer(mediaUrl);
            const sizes = await tryExtractFromPdf(buf);

            if (sizes.length) {
              const list = sizes.slice(0, 10).map(s => `${s.w}x${s.h}mm`).join(", ");
              session.buffer.push(`(Del PDF detecté medidas: ${list}.)`);
            } else {
              session.buffer.push("Recibí el PDF. Si me confirmas 1 o 2 medidas principales (ej: 1200x1400), cierro la propuesta más rápido.");
            }
          } catch (e) {
            console.log("WARN PDF:", e?.response?.data || e.message);
            session.buffer.push("Recibí el PDF. Si me confirmas 1 o 2 medidas principales (ej: 1200x1400), cierro la propuesta más rápido.");
          }
        } else {
          session.buffer.push("Recibí la imagen. Si ahí están las medidas, dime al menos 1 (ej: 1200x1400) y sigo con la recomendación.");
        }

        await scheduleProcess(waId);
        continue;
      }

      session.buffer.push("Te leo. ¿Necesitas ventanas o puertas?");
      await scheduleProcess(waId);
    }
  } catch (e) {
    console.log("ERROR /webhook:", e?.response?.data || e.message);
  }
});

// Health
app.get("/", (req, res) => res.status(200).send("OK"));

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
