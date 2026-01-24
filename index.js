import express from "express";
import axios from "axios";
import OpenAI from "openai";

const app = express();
app.use(express.json({ limit: "2mb" }));

// ===== ENV =====
const PORT = Number(process.env.PORT || 8080);

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v22.0";

const AI_PROVIDER = (process.env.AI_PROVIDER || "").toLowerCase();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const AI_MODEL_OPENAI = process.env.AI_MODEL_OPENAI || "gpt-4.1-mini";

const MIN_DELAY = Number(process.env.MIN_RESPONSE_DELAY_MS || 900);
const MAX_DELAY = Number(process.env.MAX_RESPONSE_DELAY_MS || 2200);

const COMPANY_NAME = process.env.COMPANY_NAME || "Activa Inversiones EIRL";
const DEFAULT_CITY = process.env.DEFAULT_CITY || "Temuco";

const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || "America/Santiago";
const REPLY_WITH_CONTEXT = String(process.env.REPLY_WITH_CONTEXT || "false").toLowerCase() === "true";

const TONE = (process.env.TONE || "usted").toLowerCase(); // "usted" o "tu"

// Texto opcional (no afirma nada si está vacío)
const MINVU_EXPERT_NOTE = process.env.MINVU_EXPERT_NOTE || "";
const MINVU_CREDENTIALS = process.env.MINVU_CREDENTIALS || "";

// ===== OpenAI =====
const openai =
  AI_PROVIDER === "openai" && OPENAI_API_KEY
    ? new OpenAI({ apiKey: OPENAI_API_KEY })
    : null;

// ===== Utils =====
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const now = () => Date.now();

function log(...args) { console.log(new Date().toISOString(), ...args); }
function warn(...args) { console.warn(new Date().toISOString(), ...args); }
function err(...args) { console.error(new Date().toISOString(), ...args); }

function envCheck(name, value) { log(`ENV ${name}:`, value ? "OK" : "NOT_SET"); }

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

function getGreeting() {
  const parts = new Intl.DateTimeFormat("es-CL", {
    timeZone: BUSINESS_TIMEZONE,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hh = Number(parts.find(p => p.type === "hour")?.value || "12");

  if (hh >= 5 && hh < 12) return "Buenos días";
  if (hh >= 12 && hh < 20) return "Buenas tardes";
  return "Buenas noches";
}

// ===== Dedupe webhook =====
const processedMessageIds = new Map();
const PROCESSED_TTL_MS = 10 * 60 * 1000;

function rememberProcessed(id) { processedMessageIds.set(id, now()); }
function wasProcessed(id) {
  const t = processedMessageIds.get(id);
  if (!t) return false;
  if (now() - t > PROCESSED_TTL_MS) { processedMessageIds.delete(id); return false; }
  return true;
}
setInterval(() => {
  const t = now();
  for (const [id, ts] of processedMessageIds.entries()) {
    if (t - ts > PROCESSED_TTL_MS) processedMessageIds.delete(id);
  }
}, 60 * 1000).unref();

// ===== Sessions (anti-repreguntas) =====
const sessions = new Map();
const QUESTION_COOLDOWN_MS = 45 * 60 * 1000;

function getSession(wa_id) {
  if (!sessions.has(wa_id)) {
    sessions.set(wa_id, {
      wa_id,
      createdAt: now(),
      flags: { greeted: false },
      askedAt: {},
      profile: {
        name: "",
        customerType: "",
        city: "",
        comuna: "",
        products: [],
        goal: "",
        qty: null,
        dims: [],
        timeline: "",
        opening: "",
        color: "",
        install: "",
      },
    });
  }
  return sessions.get(wa_id);
}

function canAsk(session, key) {
  const ts = session.askedAt[key];
  if (!ts) return true;
  return now() - ts > QUESTION_COOLDOWN_MS;
}
function markAsked(session, key) { session.askedAt[key] = now(); }

// ===== WhatsApp Cloud API =====
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

// Mark as read + typing indicator
async function markReadAndTyping(message_id) {
  if (!message_id) return;
  try {
    await waPostMessages({
      messaging_product: "whatsapp",
      status: "read",
      message_id,
      typing_indicator: { type: "text" },
    });
  } catch (e) {
    warn("markReadAndTyping failed:", e?.response?.data || e.message);
  }
}

async function sendText(to, body, contextMessageId = null) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body, preview_url: false },
  };
  if (REPLY_WITH_CONTEXT && contextMessageId) {
    payload.context = { message_id: contextMessageId };
  }
  const r = await waPostMessages(payload);
  return r.data;
}

// ===== Extractor local =====
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

  // Nombre
  const nameMatch =
    userText.match(/\b(soy|me llamo)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){0,4})\b/i);
  if (nameMatch?.[2]) session.profile.name = titleCaseName(nameMatch[2]);

  // Productos
  const prodMap = [
    { k: ["ventana", "ventanas"], v: "ventanas" },
    { k: ["puerta", "puertas"], v: "puertas" },
    { k: ["muro cortina", "muros cortina", "curtain wall"], v: "muro cortina" },
    { k: ["tabique", "tabiques", "tabique vidriado", "tabiques vidriados"], v: "tabiques vidriados" },
    { k: ["termopanel", "dvh", "doble vidrio", "igu", "ig u"], v: "termopanel" },
  ];
  for (const p of prodMap) if (p.k.some(kk => t.includes(kk))) upsertUnique(session.profile.products, p.v);

  // Tipo cliente
  if (t.includes("casa") || t.includes("depto") || t.includes("departamento") || t.includes("residenc")) session.profile.customerType = "residencial";
  else if (t.includes("local") || t.includes("negocio") || t.includes("comercial")) session.profile.customerType = "comercial";
  else if (t.includes("constructora") || t.includes("obra") || t.includes("licit")) session.profile.customerType = "constructora";
  else if (t.includes("arquitect") || t.includes("oficina técnica") || t.includes("ito")) session.profile.customerType = "arquitecto/oficina técnica";

  // Objetivo
  if (t.includes("acust") || t.includes("ruido") || t.includes("sonido")) session.profile.goal = "acústico";
  else if (t.includes("condens")) session.profile.goal = "condensación";
  else if (t.includes("térm") || t.includes("termic") || t.includes("aislaci")) session.profile.goal = "térmico";

  // Apertura
  if (t.includes("corredera")) session.profile.opening = "corredera";
  if (t.includes("abatible") || t.includes("oscilobatiente")) session.profile.opening = t.includes("oscilobatiente") ? "oscilobatiente" : "abatible";

  // Instalación
  if (t.includes("con instalación") || t.includes("instalacion") || t.includes("instalar")) session.profile.install = "con instalación";
  if (t.includes("sin instalación") || t.includes("sin instalacion")) session.profile.install = "sin instalación";

  // Ciudad/comuna (básico)
  if (t.includes("temuco")) { session.profile.city = "Temuco"; session.profile.comuna = "Temuco"; }

  // Cantidad
  const qtyMatch = t.match(/\b(\d{1,3})\b/);
  if (qtyMatch) {
    const q = Number(qtyMatch[1]);
    if (q >= 1 && q <= 500) session.profile.qty = q;
  }

  // Medidas 1200x1400
  const dimMatch = t.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/);
  if (dimMatch) {
    const w = Number(dimMatch[1]);
    const h = Number(dimMatch[2]);
    if (w >= 300 && h >= 300) session.profile.dims.push({ w_mm: w, h_mm: h, count: null });
  }
}

// ===== Respuestas expertas (sin inventar números) =====
function expertFooter() {
  const lines = [];
  if (MINVU_EXPERT_NOTE) lines.push(MINVU_EXPERT_NOTE);
  if (MINVU_CREDENTIALS) lines.push(MINVU_CREDENTIALS);
  return lines.length ? `\n${lines.join(" ")}` : "";
}

function expertAnswer(session, userTextRaw) {
  const t = normalizeText(userTextRaw).toLowerCase();
  const city = session.profile.city || DEFAULT_CITY;

  const usted = (TONE === "usted");
  const qPrioridad = usted
    ? "¿Su prioridad es térmico, acústico o controlar condensación?"
    : "¿Tu prioridad es térmico, acústico o controlar condensación?";

  // PDA
  if (t.includes("pda") || t.includes("descontamin") || t.includes("smog") || t.includes("leña") || t.includes("temuco padre las casas")) {
    return (
      `En ${city}, el PDA busca reducir emisiones (principalmente asociadas a calefacción). Las ventanas eficientes ayudan porque disminuyen pérdidas térmicas e infiltraciones, bajando la demanda de calefacción.\n` +
      `Para un buen desempeño en obra: DVH, sellos correctos y una instalación que evite puentes térmicos y problemas de condensación.\n` +
      `${qPrioridad}` +
      expertFooter()
    );
  }

  // Eficiencia / normativa
  if (t.includes("eficiencia") || t.includes("valor u") || t.includes("transmit") || t.includes("normativa") || t.includes("minvu") || t.includes("oguc")) {
    const qTipo = usted
      ? "¿Es para vivienda (residencial) o para local/obra (comercial/constructora)?"
      : "¿Es para vivienda (residencial) o para local/obra (comercial/constructora)?";
    return (
      `La eficiencia energética en ventanas significa que pase menos frío/calor. Se refleja en el **valor U** (mientras más bajo, mejor) y en la hermeticidad (infiltración de aire), además de una instalación correcta.\n` +
      `En términos prácticos: PVC + DVH funciona muy bien y, si se requiere un nivel superior, **Low-E** mejora el rendimiento y el confort.\n` +
      `${qTipo}` +
      expertFooter()
    );
  }

  // Zonas térmicas / lluvias
  if (t.includes("zona térmica") || t.includes("zona termica") || t.includes("zona de lluvia") || t.includes("lluvia") || t.includes("viento") || t.includes("agua")) {
    const qComuna = usted
      ? "¿En qué comuna está el proyecto y qué tipo de ventana requiere (corredera/abatible)?"
      : "¿En qué comuna está el proyecto y qué tipo de ventana requiere (corredera/abatible)?";
    return (
      `En Chile se usa zonificación climática para definir exigencias de la envolvente. En simple: a mayor exigencia, más relevante es especificar DVH/Low-E, perfiles, sellos y detalles de instalación.\n` +
      `La exposición a lluvia y viento influye en estanqueidad y desempeño: ahí importan drenajes, burletes, sellos y correcta instalación.\n` +
      `${qComuna}` +
      expertFooter()
    );
  }

  // CES
  if (t.includes("ces") || t.includes("certificación edificio sustentable") || t.includes("sustentable")) {
    const qTipo = usted
      ? "¿Su proyecto es habitacional, comercial o institucional?"
      : "¿Tu proyecto es habitacional, comercial o institucional?";
    return (
      `La CES evalúa desempeño del edificio (energía, confort, entre otros). Las ventanas aportan fuerte si se definen especificaciones: DVH/Low-E, control de infiltraciones y detalles de instalación.\n` +
      `Si el proyecto apunta a CES, conviene cerrar criterios técnicos desde el inicio para no sobredimensionar ni quedar corto.\n` +
      `${qTipo}` +
      expertFooter()
    );
  }

  return null;
}

// ===== Pregunta única con cooldown =====
function nextSingleQuestion(session) {
  const p = session.profile;
  const city = p.city || DEFAULT_CITY;
  const usted = (TONE === "usted");

  if (!p.products.length && canAsk(session, "products")) {
    markAsked(session, "products");
    return usted
      ? "¿Qué necesita cotizar: ventanas, puertas, muro cortina o tabiques vidriados?"
      : "¿Qué necesitas cotizar: ventanas, puertas, muro cortina o tabiques vidriados?";
  }
  if (!p.customerType && canAsk(session, "customerType")) {
    markAsked(session, "customerType");
    return usted
      ? `¿Es para vivienda (residencial) o para local/obra (comercial/constructora) en ${city}?`
      : `¿Es para vivienda (residencial) o para local/obra (comercial/constructora) en ${city}?`;
  }
  if (!p.goal && canAsk(session, "goal")) {
    markAsked(session, "goal");
    return usted
      ? "¿Su prioridad es térmico, acústico o controlar condensación?"
      : "¿Tu prioridad es térmico, acústico o controlar condensación?";
  }
  if (!p.qty && canAsk(session, "qty")) {
    markAsked(session, "qty");
    return usted ? "¿Cuántas unidades son en total?" : "¿Cuántas unidades son en total?";
  }
  if ((!p.dims || p.dims.length === 0) && canAsk(session, "dims")) {
    markAsked(session, "dims");
    return usted ? "¿Tiene medidas aproximadas? (ej: 1200x1400)" : "¿Tienes medidas aproximadas? (ej: 1200x1400)";
  }
  if (!p.opening && canAsk(session, "opening")) {
    markAsked(session, "opening");
    return usted ? "¿Las prefiere corredera o abatible/oscilobatiente?" : "¿Las prefieres corredera o abatible/oscilobatiente?";
  }
  if (!p.install && canAsk(session, "install")) {
    markAsked(session, "install");
    return usted ? "¿Las necesita con instalación o solo fabricación?" : "¿Las necesitas con instalación o solo fabricación?";
  }
  if (canAsk(session, "close")) {
    markAsked(session, "close");
    return usted
      ? "¿Prefiere que agendemos medición o que nos envíe fotos de los vanos para cerrar la cotización?"
      : "¿Prefieres que agendemos medición o que me envíes fotos de los vanos para cerrar la cotización?";
  }
  return "";
}

// ===== Respuesta principal (saludo 1 vez, 1 pregunta) =====
function buildReply(session, userTextRaw) {
  const userText = normalizeText(userTextRaw);
  const p = session.profile;
  const usted = (TONE === "usted");

  let prefix = "";
  if (!session.flags.greeted) {
    const greet = getGreeting();
    const name = p.name ? ` ${p.name}` : "";
    prefix = `${greet}${name}, un gusto saludarle. `;
    session.flags.greeted = true;
  }

  // Respuestas expertas
  const expert = expertAnswer(session, userText);
  if (expert) return `${prefix}${expert}`;

  // Si piden cotizar primero
  const t = userText.toLowerCase();
  if (t.includes("cotiza") || t.includes("cotización") || t.includes("precio") || t.includes("presupuesto")) {
    const city = p.city || DEFAULT_CITY;
    const prods = p.products.length ? p.products.join(", ") : "ventanas";
    const qty = p.qty ? `${p.qty}` : "—";
    const lastDim = p.dims?.length ? p.dims[p.dims.length - 1] : null;
    const dimsText = lastDim ? `${lastDim.w_mm}x${lastDim.h_mm} mm` : "—";
    const q = nextSingleQuestion(session);

    return (
      `${prefix}Perfecto. Con lo que me indicó, puedo preparar una cotización base:\n` +
      `• Producto: ${prods}\n• Ciudad: ${city}\n• Cantidad: ${qty}\n• Medida ref.: ${dimsText}\n` +
      `${q ? `\n${q}` : `\nSi me confirma apertura (corredera/abatible) y si es con instalación, se la dejo cerrada.`}`
    );
  }

  const q = nextSingleQuestion(session);
  if (!q) {
    const city = p.city || DEFAULT_CITY;
    return `${prefix}Perfecto. Con esta información avanzamos bien. Si le parece, agendamos medición en ${city} o nos envía fotos de los vanos y cierro la cotización.`;
  }

  return `${prefix}${q}`;
}

// ===== IA para pulir sin re-saludar =====
function stripRepeatedGreeting(session, text) {
  if (!text) return text;
  if (!session.flags.greeted) return text;
  return text
    .replace(/^(hola|buenos días|buenas tardes|buenas noches)[,!\.\s]+/i, "")
    .replace(/^(hola)\s+(?:[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)[,!\.\s]+/i, "");
}

async function aiPolish(session, userText, baseReply) {
  if (!openai) return baseReply;

  const system = `
Eres asesor comercial humano de ${COMPANY_NAME} (Chile). Trato formal: USTED.
Solo mejora redacción del mensaje base, sin cambiar el flujo.
Reglas:
- No saludar si greeted=true.
- Máx 6 líneas, un solo mensaje.
- No repetir solicitudes de información.
- Si el cliente pregunta por PDA/eficiencia/CES/zonas, mantenga tono experto sin inventar cifras.
`.trim();

  const input = [
    { role: "system", content: system },
    { role: "user", content: `greeted=${session.flags.greeted}\nPerfil=${JSON.stringify(session.profile)}\nCliente=${userText}\nBase=${baseReply}` },
  ];

  try {
    const resp = await openai.responses.create({
      model: AI_MODEL_OPENAI,
      input,
    });
    let out = normalizeText(resp.output_text || "");
    out = stripRepeatedGreeting(session, out);
    return out || baseReply;
  } catch (e) {
    warn("OpenAI failed:", e?.message || e);
    return baseReply;
  }
}

// ===== Handler =====
async function handleInboundMessage(message) {
  const messageId = message.id;
  const from = message.from;
  const type = message.type;

  if (!from || !messageId) return;

  if (wasProcessed(messageId)) {
    log("DUPLICATE ignored:", messageId);
    return;
  }
  rememberProcessed(messageId);

  await markReadAndTyping(messageId);

  let userText = "";
  if (type === "text") userText = message.text?.body || "";
  else if (type === "interactive") {
    userText =
      message.interactive?.button_reply?.title ||
      message.interactive?.list_reply?.title ||
      "";
  }

  userText = normalizeText(userText);
  if (!userText) return;

  const session = getSession(from);

  extractInfo(session, userText);

  await sleep(clamp(randInt(MIN_DELAY, MAX_DELAY), 250, 8000));

  const base = buildReply(session, userText);
  const finalReply = await aiPolish(session, userText, base);

  await sendText(from, finalReply, messageId);
}

// ===== Webhooks =====
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
            handleInboundMessage(m).catch((e) =>
              err("handleInboundMessage crashed:", e?.response?.data || e.message)
            );
          });
        }
      }
    }
  } catch (e) {
    err("POST /webhook error:", e);
  }
});

app.get("/", (_req, res) => res.status(200).send("OK"));

app.listen(PORT, () => {
  log("BOOT: starting app...");
  envCheck("PORT", String(PORT));
  envCheck("PHONE_NUMBER_ID", PHONE_NUMBER_ID);
  envCheck("WHATSAPP_TOKEN", WHATSAPP_TOKEN);
  envCheck("VERIFY_TOKEN", VERIFY_TOKEN);
  envCheck("OPENAI_API_KEY", OPENAI_API_KEY);
  log("ENV AI_PROVIDER:", AI_PROVIDER || "NOT_SET");
  log("ENV AI_MODEL_OPENAI:", AI_MODEL_OPENAI || "NOT_SET");
  log("ENV BUSINESS_TIMEZONE:", BUSINESS_TIMEZONE);
  log("ENV REPLY_WITH_CONTEXT:", String(REPLY_WITH_CONTEXT));
  log("ENV TONE:", TONE);
  envCheck("MINVU_EXPERT_NOTE", MINVU_EXPERT_NOTE);
  envCheck("MINVU_CREDENTIALS", MINVU_CREDENTIALS);
  log(`✅ Server running on port ${PORT}`);
});
