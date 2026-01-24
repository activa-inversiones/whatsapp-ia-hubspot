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

// Texto opcional (solo si usted lo define)
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

function ustedOn() {
  return TONE === "usted";
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

// ===== Sessions =====
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
        products: [],   // SOLO: ["ventanas","puertas"]
        priority: "",   // "térmico" | "acústico" | "seguridad" | "balance"
        goal: "",       // "condensación" si el cliente lo menciona
        qty: null,
        dims: [],
        opening: "",    // corredera / abatible / oscilobatiente
        install: "",    // con instalación / sin instalación
        material: "",   // pvc europeo / pvc americano / aluminio (si aparece)
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

// ===== WhatsApp API =====
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

// read + typing
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
  if (REPLY_WITH_CONTEXT && contextMessageId) payload.context = { message_id: contextMessageId };
  const r = await waPostMessages(payload);
  return r.data;
}

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
  const nameMatch =
    userText.match(/\b(soy|me llamo)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){0,4})\b/i);
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

  // Condensación (como tema, no como “prioridad”)
  if (t.includes("condens")) session.profile.goal = "condensación";

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
  // Técnica + consultiva, en “usted”
  return (
    "Sobre la condensación: normalmente aparece cuando hay **humedad relativa alta (sobre ~80%)** y una superficie fría (por ejemplo, en torno a **12°C**), por lo que el vapor del ambiente se “condensa” como agua.\n" +
    "En ventanas bien diseñadas y bien instaladas, lo que más ayuda es: **DVH/termopanel**, buena **hermeticidad**, y evitar **puentes térmicos** en la instalación. En **PVC línea europea**, por el diseño multicámara y sellos, es muy difícil que se produzca condensación interior si el conjunto está correcto.\n" +
    "También es importante la ventilación/uso del recinto (cocina, baños, secado de ropa), porque la humedad del ambiente manda."
  );
}

function materialExplainer(material) {
  const base =
    "En cuanto a materiales, tanto **PVC americano**, **PVC línea europea** y **aluminio** pueden llevar **termopanel (DVH)**. La diferencia está en el comportamiento del marco, los sellos y la hermeticidad del sistema.";
  if (!material) return base;

  if (material.includes("europea")) {
    return base + " En PVC línea europea suele lograrse muy buen desempeño térmico y hermético, ideal para confort y control de condensación.";
  }
  if (material.includes("americano")) {
    return base + " En PVC americano también se puede lograr un muy buen resultado, especialmente si se especifica correctamente el DVH y la instalación.";
  }
  if (material.includes("aluminio")) {
    return base + " En aluminio, lo clave para desempeño térmico es que sea sistema adecuado (idealmente con solución térmica cuando aplica) y un DVH bien especificado.";
  }
  return base;
}

function expertAnswer(session, userTextRaw) {
  const t = normalizeText(userTextRaw).toLowerCase();
  const city = session.profile.city || DEFAULT_CITY;

  // PDA / eficiencia / CES / zonas (se mantiene lo ya implementado)
  if (t.includes("pda") || t.includes("descontamin") || t.includes("smog") || t.includes("leña")) {
    return (
      `Sobre el PDA: busca reducir emisiones asociadas a calefacción. Ventanas eficientes ayudan porque disminuyen pérdidas térmicas e infiltraciones; eso reduce la necesidad de calefaccionar.\n` +
      `En la práctica, el resultado depende de 3 cosas: buen **termopanel**, buen **sello/hermeticidad** y **correcta instalación**.\n` +
      `¿Le preocupa más el confort térmico, el ruido o la seguridad?` +
      expertFooter()
    );
  }

  if (t.includes("eficiencia") || t.includes("valor u") || t.includes("transmit") || t.includes("normativa") || t.includes("minvu") || t.includes("oguc")) {
    return (
      `Eficiencia energética en ventanas significa que pase menos frío/calor. Se refleja en el **valor U** (mientras más bajo, mejor), y también en la **hermeticidad** (infiltración de aire) y una instalación sin puentes térmicos.\n` +
      `Cuando hacemos venta consultiva, siempre buscamos equilibrar tres condiciones: **aislación térmica**, **aislación acústica** y **seguridad**.\n` +
      `Para orientarle bien: ¿es casa nueva en ${city} y su foco principal es condensación, ruido o seguridad?` +
      expertFooter()
    );
  }

  if (t.includes("ces") || t.includes("certificación edificio sustentable") || t.includes("sustentable")) {
    return (
      `En proyectos con CES, la ventana aporta mucho en energía y confort. Lo importante es definir especificaciones (termopanel/DVH, hermeticidad, y detalles de instalación) desde el inicio.\n` +
      `Si su proyecto apunta a ese estándar, le puedo proponer una configuración técnica equilibrada.\n` +
      `¿Es proyecto residencial o comercial?` +
      expertFooter()
    );
  }

  // Condensación (respuesta elaborada)
  if (t.includes("condens") || t.includes("humedad") || t.includes("empaña") || t.includes("empañ")) {
    return (
      `${condensationExplainer()}\n` +
      `${materialExplainer(session.profile.material)}\n` +
      `Para recomendarle una configuración “cerrada” (térmico + acústico + seguridad), ¿sus ventanas las prefiere **correderas** o **abatibles/oscilobatientes**?`
    );
  }

  return null;
}

// ===== Pregunta única (solo ventanas/puertas) =====
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
  // Prioridad: se sugiere “balance” por defecto para consultivo
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

// ===== Respuesta principal (consultiva y más cercana) =====
function buildReply(session, userTextRaw) {
  const userText = normalizeText(userTextRaw);
  const p = session.profile;
  const city = p.city || DEFAULT_CITY;

  let prefix = "";
  if (!session.flags.greeted) {
    const greet = getGreeting();
    const name = p.name ? ` ${p.name}` : "";
    prefix = `${greet}${name}, un gusto saludarle. Soy del equipo de ${COMPANY_NAME}. `;
    session.flags.greeted = true;
  }

  // Respuesta experta si aplica
  const expert = expertAnswer(session, userText);
  if (expert) return `${prefix}${expert}`;

  // Si el cliente dice “no sé nada, oriénteme”
  const t = userText.toLowerCase();
  if (t.includes("no sé") || t.includes("no se") || t.includes("oriént") || t.includes("orient")) {
    const base =
      "Perfecto, le explico de forma simple y práctica. Para una buena ventana nos enfocamos en 3 pilares: " +
      "**aislación térmica** (confort y ahorro), **aislación acústica** (menos ruido) y **seguridad** (herrajes/cierres y vidrio según riesgo). " +
      "Luego ajustamos termopanel y tipo de apertura según su caso.\n";
    const q = nextSingleQuestion(session);
    return `${prefix}${base}${q}`;
  }

  // Si piden cotizar
  if (t.includes("cotiza") || t.includes("cotización") || t.includes("precio") || t.includes("presupuesto")) {
    const prods = p.products.length ? p.products.join(", ") : "ventanas";
    const qty = p.qty ? `${p.qty}` : "—";
    const lastDim = p.dims?.length ? p.dims[p.dims.length - 1] : null;
    const dimsText = lastDim ? `${lastDim.w_mm}x${lastDim.h_mm} mm` : "—";
    const q = nextSingleQuestion(session);

    return (
      `${prefix}Perfecto. Con lo que me indicó, ya puedo armar una **cotización base** y luego la cerramos con 1 dato pendiente:\n` +
      `• Producto: ${prods}\n• Comuna/ciudad: ${p.comuna || city}\n• Cantidad: ${qty}\n• Medida ref.: ${dimsText}\n` +
      `${q ? `\n${q}` : "\nSi me confirma apertura y si es con instalación, se la dejo cerrada hoy."}`
    );
  }

  // Flujo normal: 1 pregunta
  const q = nextSingleQuestion(session);
  if (!q) {
    return `${prefix}Excelente. Con esto avanzamos bien. Si le parece, coordinamos medición o nos envía fotos de los vanos y cierro la propuesta técnica y comercial.`;
  }
  return `${prefix}${q}`;
}

// ===== IA para pulir estilo (sin duplicar saludos, sin pedir todo) =====
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
Objetivo: mejorar redacción sin perder el contenido técnico (venta consultiva).
Reglas:
- No saludar si greeted=true.
- Un solo mensaje, máximo 7 líneas.
- No preguntar más de 1 cosa por turno.
- No repetir solicitudes de información.
- Ventas SOLO de: ventanas y puertas.
- En ventanas siempre considerar 3 pilares: térmico, acústico y seguridad.
- Si el cliente menciona condensación, explique (HR alta + superficie fría) y recomiende DVH + hermeticidad + instalación.
- No inventar cifras normativas específicas ni artículos de ley.
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
  if (wasProcessed(messageId)) { log("DUPLICATE ignored:", messageId); return; }
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
