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

// Debounce: esperar X ms desde el último mensaje del cliente antes de responder
const WAIT_AFTER_LAST_USER_MESSAGE_MS = Number(process.env.WAIT_AFTER_LAST_USER_MESSAGE_MS || 4500);

const COMPANY_NAME = process.env.COMPANY_NAME || "Activa Inversiones EIRL";
const DEFAULT_CITY = process.env.DEFAULT_CITY || "Temuco";

const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || "America/Santiago";
const REPLY_WITH_CONTEXT = String(process.env.REPLY_WITH_CONTEXT || "false").toLowerCase() === "true";

const TONE = (process.env.TONE || "usted").toLowerCase(); // "usted" o "tu"
const AGENT_NAME = process.env.AGENT_NAME || "Marcelo Cifuentes";

// Opcionales (solo si usted define textos reales)
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

function expertFooter() {
  const lines = [];
  if (MINVU_EXPERT_NOTE) lines.push(MINVU_EXPERT_NOTE);
  if (MINVU_CREDENTIALS) lines.push(MINVU_CREDENTIALS);
  return lines.length ? `\n${lines.join(" ")}` : "";
}

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

// Marcar como leído + “intentarlo” como typing
async function markReadAndTyping(message_id) {
  if (!message_id) return;
  try {
    await waPostMessages({
      messaging_product: "whatsapp",
      status: "read",
      message_id,
      // Nota: no siempre se ve en el cliente. Aun así lo dejamos.
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
  if (REPLY_WITH_CONTEXT && contextMessageId) payload.context = { message_id: contextMessageId };
  const r = await waPostMessages(payload);
  return r.data;
}

// ===== Dedupe webhook (evitar duplicados) =====
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

// ===== Sessions + Debounce buffer =====
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
        products: [],     // SOLO: ventanas/puertas
        priority: "",     // térmico / acústico / seguridad / balance
        goal: "",         // condensación (si lo mencionan)
        qty: null,
        dims: [],
        opening: "",
        install: "",
        material: "",     // pvc línea europea / pvc americano / aluminio
      },
      // Buffer debounce
      buffer: {
        timer: null,
        lastMsgId: null,
        lastFrom: null,
        lastAt: 0,
        contextId: null,
        parts: [],
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

// ===== Extractor =====
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
  const nameMatch = userText.match(/\b(soy|me llamo)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){0,4})\b/i);
  if (nameMatch?.[2]) session.profile.name = titleCaseName(nameMatch[2]);

  // SOLO productos permitidos
  if (t.includes("ventana")) upsertUnique(session.profile.products, "ventanas");
  if (t.includes("puerta")) upsertUnique(session.profile.products, "puertas");

  // Tipo cliente
  if (t.includes("casa") || t.includes("depto") || t.includes("departamento") || t.includes("residenc")) session.profile.customerType = "residencial";
  else if (t.includes("local") || t.includes("negocio") || t.includes("comercial")) session.profile.customerType = "comercial";
  else if (t.includes("constructora") || t.includes("obra") || t.includes("licit")) session.profile.customerType = "constructora";
  else if (t.includes("arquitect") || t.includes("oficina técnica") || t.includes("ito")) session.profile.customerType = "arquitecto/oficina técnica";

  // Ciudad/comuna (básico)
  if (t.includes("temuco")) { session.profile.city = "Temuco"; session.profile.comuna = "Temuco"; }
  if (t.includes("pucón") || t.includes("pucon")) { session.profile.city = "Pucón"; session.profile.comuna = "Pucón"; }

  // Prioridad (3 pilares + balance)
  if (t.includes("térm") || t.includes("termic") || t.includes("aislaci")) session.profile.priority = "térmico";
  if (t.includes("acust") || t.includes("ruido") || t.includes("sonido")) session.profile.priority = "acústico";
  if (t.includes("segur") || t.includes("antirrobo") || t.includes("cerradura")) session.profile.priority = "seguridad";
  if (t.includes("todo") || t.includes("todas") || t.includes("balance")) session.profile.priority = "balance";

  // Condensación (tema)
  if (t.includes("condens") || t.includes("humedad") || t.includes("empaña") || t.includes("empañ")) session.profile.goal = "condensación";

  // Material
  if (t.includes("pvc") && (t.includes("europe") || t.includes("línea europea") || t.includes("linea europea"))) session.profile.material = "pvc línea europea";
  else if (t.includes("pvc") && (t.includes("american") || t.includes("línea americana") || t.includes("linea americana"))) session.profile.material = "pvc americano";
  else if (t.includes("alumin")) session.profile.material = "aluminio";

  // Apertura
  if (t.includes("corredera")) session.profile.opening = "corredera";
  if (t.includes("abatible") || t.includes("oscilobatiente")) session.profile.opening = t.includes("oscilobatiente") ? "oscilobatiente" : "abatible";

  // Instalación
  if (t.includes("con instalación") || t.includes("instalacion") || t.includes("instalar")) session.profile.install = "con instalación";
  if (t.includes("sin instalación") || t.includes("sin instalacion")) session.profile.install = "sin instalación";

  // Cantidad
  const qtyMatch = t.match(/\b(\d{1,3})\b/);
  if (qtyMatch) {
    const q = Number(qtyMatch[1]);
    if (q >= 1 && q <= 500) session.profile.qty = q;
  }

  // Medidas: 1200x1400
  const dimMatch = t.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/);
  if (dimMatch) {
    const w = Number(dimMatch[1]);
    const h = Number(dimMatch[2]);
    if (w >= 300 && h >= 300) session.profile.dims.push({ w_mm: w, h_mm: h, count: null });
  }
}

// ===== Respuestas consultivas =====
function condensationExplainer() {
  return (
    "Sobre la condensación: normalmente aparece cuando hay **humedad relativa alta (sobre ~80%)** y una superficie fría (por ejemplo, en torno a **12°C**). Ahí el vapor del ambiente se transforma en gotitas.\n" +
    "Para reducirla, lo que manda es: **termopanel (DVH)**, buena **hermeticidad** (sellos/burletes) y una **instalación** que no deje puentes térmicos.\n" +
    "En **PVC línea europea**, por su diseño multicámara y sellos, es muy difícil que se produzca condensación interior si el conjunto está bien especificado e instalado."
  );
}

function materialExplainer(material) {
  const base =
    "En materiales, tanto **PVC americano**, **PVC línea europea** y **aluminio** pueden llevar **termopanel (DVH)**. La diferencia está en el marco, los sellos y la hermeticidad del sistema.";
  if (!material) return base;
  if (material.includes("europea")) return base + " En PVC línea europea suele lograrse muy buen desempeño térmico y hermético.";
  if (material.includes("americano")) return base + " En PVC americano también se logra un buen resultado si se especifica bien el DVH y la instalación.";
  if (material.includes("aluminio")) return base + " En aluminio, para rendimiento térmico importa mucho el sistema y el detalle de instalación, además del DVH.";
  return base;
}

function expertAnswer(session, userTextRaw) {
  const t = normalizeText(userTextRaw).toLowerCase();
  const city = session.profile.city || DEFAULT_CITY;

  // PDA
  if (t.includes("pda") || t.includes("descontamin") || t.includes("smog") || t.includes("leña")) {
    return (
      `Sobre el PDA: busca reducir emisiones asociadas a calefacción. Las ventanas eficientes ayudan porque bajan pérdidas térmicas e infiltraciones; en simple, usted calefacciona menos para lograr el mismo confort.\n` +
      `En la práctica, el resultado depende de 3 cosas: buen **DVH**, buena **hermeticidad** y **correcta instalación**.\n` +
      `Para orientarle bien: ¿le preocupa más el confort térmico, el ruido o la seguridad?` +
      expertFooter()
    );
  }

  // Eficiencia / normativa (sin inventar valores)
  if (t.includes("eficiencia") || t.includes("valor u") || t.includes("transmit") || t.includes("normativa") || t.includes("minvu") || t.includes("oguc")) {
    return (
      `Eficiencia energética en ventanas significa que pase menos frío/calor. Se refleja en el **valor U** (más bajo = mejor), la **hermeticidad** (menos infiltración) y una instalación sin puentes térmicos.\n` +
      `Nosotros lo trabajamos como solución integral en 3 pilares: **aislación térmica**, **aislación acústica** y **seguridad**.\n` +
      `¿Su proyecto es residencial en ${city}, y su foco principal hoy es condensación, ruido o seguridad?` +
      expertFooter()
    );
  }

  // Condensación
  if (t.includes("condens") || t.includes("humedad") || t.includes("empaña") || t.includes("empañ")) {
    return (
      `${condensationExplainer()}\n` +
      `${materialExplainer(session.profile.material)}\n` +
      `Para recomendarle una configuración “bien cerrada”, ¿las prefiere **corredera** o **abatible/oscilobatiente**?`
    );
  }

  // “Transmitancia 4+12+4”
  if (t.includes("transmit") || t.includes("u ") || t.includes("4+12+4") || t.includes("4 12 4")) {
    return (
      "La configuración **4+12+4** (DVH) es una base muy usada. El desempeño final depende de tres factores: " +
      "**tipo de vidrio** (normal o Low-E), **gas** (aire/argón) y **marco + sellos + instalación**. " +
      "Si su objetivo es una solución “premium” (térmico + acústico + seguridad), normalmente se ajusta el DVH y herrajes según su caso.\n" +
      "¿Su foco principal es reducir frío/calor, ruido, o reforzar seguridad?"
    );
  }

  return null;
}

function nextSingleQuestion(session) {
  const p = session.profile;
  const city = p.city || DEFAULT_CITY;

  if (!p.products.length && canAsk(session, "products")) {
    markAsked(session, "products");
    return "¿Qué necesita cotizar: **ventanas** o **puertas**?";
  }
  if (!p.customerType && canAsk(session, "customerType")) {
    markAsked(session, "customerType");
    return `¿Es para vivienda (residencial) o para local/obra (comercial/constructora) en ${city}?`;
  }
  if (!p.priority && canAsk(session, "priority")) {
    markAsked(session, "priority");
    return "Para orientarle bien: ¿su foco principal es **térmico**, **acústico**, **seguridad**, o prefiere una solución **balanceada** (las tres)?";
  }
  if (!p.qty && canAsk(session, "qty")) {
    markAsked(session, "qty");
    return "¿Cuántas unidades son en total?";
  }
  if ((!p.dims || p.dims.length === 0) && canAsk(session, "dims")) {
    markAsked(session, "dims");
    return "¿Tiene medidas aproximadas? (ej: 1200x1400)";
  }
  if (!p.opening && canAsk(session, "opening")) {
    markAsked(session, "opening");
    return "¿Las prefiere **corredera** o **abatible/oscilobatiente**?";
  }
  if (!p.install && canAsk(session, "install")) {
    markAsked(session, "install");
    return "¿Las necesita **con instalación** o solo **fabricación**?";
  }
  if (canAsk(session, "close")) {
    markAsked(session, "close");
    return "Perfecto. ¿Prefiere que agendemos una medición o que nos envíe fotos de los vanos para cerrar la cotización?";
  }
  return "";
}

function buildReply(session, userTextRaw) {
  const userText = normalizeText(userTextRaw);
  const p = session.profile;
  const city = p.city || DEFAULT_CITY;

  let prefix = "";
  if (!session.flags.greeted) {
    const greet = getGreeting();
    const name = p.name ? ` ${p.name}` : "";
    // Se presenta como Marcelo Cifuentes (según su instrucción)
    prefix = `${greet}${name}. Soy ${AGENT_NAME}, de ${COMPANY_NAME}. `;
    session.flags.greeted = true;
  }

  const expert = expertAnswer(session, userText);
  if (expert) return `${prefix}${expert}`;

  const t = userText.toLowerCase();
  if (t.includes("no sé") || t.includes("no se") || t.includes("oriént") || t.includes("orient")) {
    const base =
      "Perfecto, le explico simple. Para una buena ventana o puerta buscamos 3 pilares: " +
      "**aislación térmica** (confort y ahorro), **aislación acústica** (menos ruido) y **seguridad** (herrajes/cierres y vidrio según necesidad). " +
      "Luego ajustamos el termopanel y el tipo de apertura según su caso.\n";
    const q = nextSingleQuestion(session);
    return `${prefix}${base}${q}`;
  }

  if (t.includes("cotiza") || t.includes("cotización") || t.includes("precio") || t.includes("presupuesto")) {
    const prods = p.products.length ? p.products.join(", ") : "ventanas";
    const qty = p.qty ? `${p.qty}` : "—";
    const lastDim = p.dims?.length ? p.dims[p.dims.length - 1] : null;
    const dimsText = lastDim ? `${lastDim.w_mm}x${lastDim.h_mm} mm` : "—";
    const q = nextSingleQuestion(session);

    return (
      `${prefix}Perfecto. Con lo que me indicó, ya puedo preparar una **cotización base**:\n` +
      `• Producto: ${prods}\n• Comuna/ciudad: ${p.comuna || city}\n• Cantidad: ${qty}\n• Medida ref.: ${dimsText}\n` +
      `${q ? `\n${q}` : "\nSi me confirma apertura y si es con instalación, se la dejo cerrada hoy."}`
    );
  }

  const q = nextSingleQuestion(session);
  if (!q) {
    return `${prefix}Excelente. Con esto avanzamos bien. Si le parece, coordinamos medición o me envía fotos de los vanos y cierro la propuesta técnica y comercial.`;
  }
  return `${prefix}${q}`;
}

// IA: chileno + consultivo + sin repetir
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
Usted es asesor comercial humano de ${COMPANY_NAME} (Chile). Trato formal: USTED.
Estilo: chileno, cercano y profesional (ej: "Perfecto", "Buenísimo", "De acuerdo", "Impecable").
Reglas:
- No saludar si greeted=true.
- Un solo mensaje, máximo 7 líneas.
- No preguntar más de 1 cosa por turno.
- No repetir solicitudes de información.
- SOLO vender: ventanas y puertas.
- En ventanas siempre considerar 3 pilares: térmico, acústico y seguridad.
- Condensación: HR alta + superficie fría; DVH + hermeticidad + instalación. PVC línea europea: muy difícil condensación interior si está bien ejecutado.
- No inventar cifras normativas ni afirmar certificaciones si no están en variables MINVU_*.
`.trim();

  try {
    const resp = await openai.responses.create({
      model: AI_MODEL_OPENAI,
      input: [
        { role: "system", content: system },
        { role: "user", content: `greeted=${session.flags.greeted}\nPerfil=${JSON.stringify(session.profile)}\nCliente=${userText}\nBase=${baseReply}` },
      ],
    });
    let out = normalizeText(resp.output_text || "");
    out = stripRepeatedGreeting(session, out);
    return out || baseReply;
  } catch (e) {
    warn("OpenAI failed:", e?.message || e);
    return baseReply;
  }
}

// ===== Core processing (se ejecuta SOLO cuando pasa el debounce) =====
async function processBuffered(session) {
  const from = session.buffer.lastFrom;
  const contextId = session.buffer.contextId;
  const combined = normalizeText(session.buffer.parts.join(" "));

  // Limpiar buffer antes de responder (evita doble envíos)
  session.buffer.parts = [];
  session.buffer.timer = null;

  if (!from || !combined) return;

  // Delay humano adicional (además del debounce)
  await sleep(clamp(randInt(MIN_DELAY, MAX_DELAY), 250, 8000));

  const base = buildReply(session, combined);
  const finalReply = await aiPolish(session, combined, base);

  await sendText(from, finalReply, contextId);
}

// ===== Enqueue inbound (debounce: espera a que el cliente “termine de escribir”) =====
async function enqueueInboundMessage(message) {
  const messageId = message.id;
  const from = message.from;
  const type = message.type;

  if (!from || !messageId) return;

  if (wasProcessed(messageId)) {
    log("DUPLICATE ignored:", messageId);
    return;
  }
  rememberProcessed(messageId);

  // Marcar leído y “typing” (best-effort)
  await markReadAndTyping(messageId);

  // Extraer texto
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

  // Actualizar perfil con cada fragmento
  extractInfo(session, userText);

  // Guardar en buffer
  session.buffer.lastMsgId = messageId;
  session.buffer.lastFrom = from;
  session.buffer.lastAt = now();
  session.buffer.contextId = messageId; // respondemos ligado al último msg del cliente
  session.buffer.parts.push(userText);

  // Reset timer (debounce)
  if (session.buffer.timer) clearTimeout(session.buffer.timer);

  session.buffer.timer = setTimeout(() => {
    processBuffered(session).catch((e) => err("processBuffered crashed:", e?.response?.data || e.message));
  }, WAIT_AFTER_LAST_USER_MESSAGE_MS);
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
            enqueueInboundMessage(m).catch((e) =>
              err("enqueueInboundMessage crashed:", e?.response?.data || e.message)
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
  log("ENV WAIT_AFTER_LAST_USER_MESSAGE_MS:", String(WAIT_AFTER_LAST_USER_MESSAGE_MS));
  log("ENV REPLY_WITH_CONTEXT:", String(REPLY_WITH_CONTEXT));
  log("ENV TONE:", TONE);
  log("ENV AGENT_NAME:", AGENT_NAME);
  envCheck("MINVU_EXPERT_NOTE", MINVU_EXPERT_NOTE);
  envCheck("MINVU_CREDENTIALS", MINVU_CREDENTIALS);
  log(`✅ Server running on port ${PORT}`);
});
