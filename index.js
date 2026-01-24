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

// ===== OpenAI client =====
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

function envCheck(name, value) {
  log(`ENV ${name}:`, value ? "OK" : "NOT_SET");
}

function getGreetingAndTime() {
  // Hora Chile, independiente del servidor (Railway puede estar en otra región)
  const parts = new Intl.DateTimeFormat("es-CL", {
    timeZone: BUSINESS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const hh = Number(parts.find(p => p.type === "hour")?.value || "12");

  let greet = "Hola";
  if (hh >= 5 && hh < 12) greet = "Buenos días";
  else if (hh >= 12 && hh < 20) greet = "Buenas tardes";
  else greet = "Buenas noches";

  return greet;
}

function normalizeText(t) {
  return (t || "")
    .toString()
    .trim()
    .replace(/\s+/g, " ");
}

// ===== Estado: dedupe + sessions =====
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

const sessions = new Map();
function getSession(wa_id) {
  if (!sessions.has(wa_id)) {
    sessions.set(wa_id, {
      wa_id,
      createdAt: now(),
      lastReplyAt: 0,
      flags: { greeted: false },
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
      },
      lastQuestionKey: "",
    });
  }
  return sessions.get(wa_id);
}

// ===== WhatsApp helpers =====
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

// Marca leído + typing indicator (Cloud API)
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

  // Si REPLY_WITH_CONTEXT=true, se verá como “respuesta a …” (quote “Tú: …”)
  if (REPLY_WITH_CONTEXT && contextMessageId) {
    payload.context = { message_id: contextMessageId };
  }

  try {
    const r = await waPostMessages(payload);
    return r.data;
  } catch (e) {
    err("sendText failed:", e?.response?.data || e.message);
    throw e;
  }
}

// ===== Extractor local (clave para no repetir) =====
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

  // Nombre: "soy Marcelo Cifuentes" / "me llamo Marcelo"
  const nameMatch =
    userText.match(/\b(soy|me llamo)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){0,3})\b/i);
  if (nameMatch?.[2]) {
    // Capitalización simple
    const name = nameMatch[2]
      .split(" ")
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
    session.profile.name = name;
  }

  // Productos
  const prodMap = [
    { k: ["ventana", "ventanas"], v: "ventanas" },
    { k: ["puerta", "puertas"], v: "puertas" },
    { k: ["muro cortina", "muros cortina", "curtain wall"], v: "muro cortina" },
    { k: ["tabique", "tabiques", "tabique vidriado", "tabiques vidriados"], v: "tabiques vidriados" },
    { k: ["termopanel", "dvh", "doble vidrio", "ig u", "igu"], v: "termopanel" },
  ];
  for (const p of prodMap) {
    if (p.k.some(kk => t.includes(kk))) {
      upsertUnique(session.profile.products, p.v);
    }
  }

  // Tipo cliente
  if (t.includes("casa") || t.includes("depto") || t.includes("departamento") || t.includes("residenc")) {
    session.profile.customerType = "residencial";
  } else if (t.includes("local") || t.includes("negocio") || t.includes("comercial")) {
    session.profile.customerType = "comercial";
  } else if (t.includes("constructora") || t.includes("obra") || t.includes("licit")) {
    session.profile.customerType = "constructora";
  } else if (t.includes("arquitect") || t.includes("oficina")) {
    session.profile.customerType = "arquitecto/oficina técnica";
  }

  // Objetivo
  if (t.includes("acust") || t.includes("ruido") || t.includes("sonido")) {
    session.profile.goal = "acústico";
  } else if (t.includes("condens")) {
    session.profile.goal = "condensación";
  } else if (t.includes("térm") || t.includes("termic") || t.includes("aislaci")) {
    session.profile.goal = "térmico";
  }

  // Ciudad/comuna (simple: si mencionan Temuco)
  if (t.includes("temuco")) {
    session.profile.city = "Temuco";
    session.profile.comuna = "Temuco";
  }

  // Cantidad (simple: primer número aislado)
  const qtyMatch = t.match(/\b(\d{1,3})\b/);
  if (qtyMatch && !session.profile.qty) {
    const q = Number(qtyMatch[1]);
    if (q >= 1 && q <= 200) session.profile.qty = q;
  }

  // Medidas (mm) tipo 1600x1900
  const dimMatch = t.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/);
  if (dimMatch) {
    const w = Number(dimMatch[1]);
    const h = Number(dimMatch[2]);
    if (w >= 300 && h >= 300) {
      session.profile.dims.push({ w_mm: w, h_mm: h, count: null });
    }
  }
}

// ===== IA (opcional) para respuesta final =====
async function aiReply(session, userText) {
  if (!openai) return null;

  const system = `
Eres asesor comercial humano de ${COMPANY_NAME} (Chile). Vendes ventanas/puertas (PVC y aluminio), termopanel (DVH), muros cortina y tabiques vidriados.
Reglas:
- Responde en 1 solo mensaje (máx 6 líneas).
- Primero responde si preguntan algo directo.
- Máximo 1 pregunta por turno.
- No repitas preguntas ya respondidas (usa el perfil).
- Tono cercano y profesional chileno.
- Cierra con un siguiente paso (medición / fotos de vanos / visita).
  `.trim();

  const profile = session.profile;

  try {
    const resp = await openai.responses.create({
      model: AI_MODEL_OPENAI,
      input: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Perfil actual: ${JSON.stringify(profile)}\nMensaje cliente: ${userText}`,
        },
      ],
    });

    const text = (resp.output_text || "").trim();
    return text || null;
  } catch (e) {
    warn("OpenAI failed:", e?.message || e);
    return null;
  }
}

// ===== Respuesta “humana” sin repetir =====
function buildReply(session, userTextRaw) {
  const userText = normalizeText(userTextRaw);
  const t = userText.toLowerCase();
  const p = session.profile;

  const greet = getGreetingAndTime();
  const name = p.name ? ` ${p.name}` : "";

  // Saludo solo 1 vez por sesión
  const helloPrefix = session.flags.greeted
    ? ""
    : `${greet}${name}, un gusto saludarte. `;

  // 1) Si preguntan algo directo: eficiencia / aislación / U / condensación
  if (t.includes("eficiencia") || t.includes("transmit") || t.includes("valor u") || t.includes("aislaci") || t.includes("condens")) {
    session.flags.greeted = true;
    const city = p.city || DEFAULT_CITY;

    // Respuesta + 1 pregunta útil (no repetir)
    let ask = "";
    if (!p.products.length) ask = "¿Es para ventanas, puertas o tabiques vidriados?";
    else if (!p.goal) ask = "¿Tu prioridad es térmico, acústico o controlar condensación?";
    else if (!p.customerType) ask = "¿Es para casa (residencial) o local/obra (comercial/constructora)?";
    else ask = "¿Prefieres corredera o abatible/oscilobatiente?";

    return (
      `${helloPrefix}Eficiencia energética en ventanas es que pase menos frío/calor. Se refleja en el **valor U**: mientras más bajo, mejor confort y menor gasto en calefacción. ` +
      `En ${city}, PVC + termopanel (DVH) funciona excelente; si quieres subir nivel, **Low-E** mejora harto el rendimiento y ayuda con condensación junto a buen sellado e instalación.\n` +
      `${ask}`
    );
  }

  // 2) Si ya dijo producto, no preguntarlo de nuevo
  if (!p.products.length) {
    session.flags.greeted = true;
    return `${helloPrefix}Para ayudarte rápido: ¿qué necesitas cotizar: ventanas, puertas, muro cortina o tabiques vidriados?`;
  }

  // 3) Orden de calificación sin repetir (1 pregunta a la vez)
  const city = p.city || DEFAULT_CITY;

  if (!p.customerType) {
    session.flags.greeted = true;
    return `${helloPrefix}Perfecto. ¿Es para casa (residencial) o para local/obra (comercial/constructora) en ${city}?`;
  }

  if (!p.goal) {
    session.flags.greeted = true;
    return `${helloPrefix}Excelente. Para afinar la solución: ¿tu prioridad es térmico, acústico o controlar condensación?`;
  }

  // Si no hay cantidad ni medidas, pedir una sola cosa
  if (!p.qty && (!p.dims || p.dims.length === 0)) {
    session.flags.greeted = true;
    return `${helloPrefix}¿Cuántas unidades son y qué medidas aproximadas tienes? (ej: 1600x1900)`;
  }

  // Si hay qty pero no medidas
  if (p.qty && (!p.dims || p.dims.length === 0)) {
    session.flags.greeted = true;
    return `${helloPrefix}Perfecto, ${p.qty} unidades. ¿Tienes medidas aproximadas por tipo de ventana? (ej: 1600x1900)`;
  }

  // Si hay medidas pero no qty
  if (!p.qty && p.dims?.length) {
    session.flags.greeted = true;
    const d = p.dims[p.dims.length - 1];
    return `${helloPrefix}Perfecto, tengo una medida ${d.w_mm}x${d.h_mm} mm. ¿Cuántas unidades son en total?`;
  }

  // 4) Ya tengo base: dar recomendación breve y cerrar siguiente paso
  session.flags.greeted = true;
  const prods = p.products.join(", ");
  const baseRec =
    p.goal === "acústico"
      ? "Para ruido, conviene mejorar vidrio (espesores/asimetría) y un sellado/instalación prolija."
      : p.goal === "condensación"
      ? "Para condensación, clave: DVH + buen sellado perimetral + instalación correcta (evitar puentes térmicos)."
      : "Para térmico, PVC + DVH rinde muy bien; Low-E sube el desempeño y se nota en confort.";

  return (
    `${helloPrefix}Listo: ${prods} en ${city}, ${p.qty} unidades aprox. ${baseRec}\n` +
    `Si te parece, hacemos lo siguiente: me mandas **fotos de los vanos** (1 por lado) o agendamos **medición**, y te envío una cotización cerrada. ¿Qué prefieres?`
  );
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

  // Marcar leído + typing
  await markReadAndTyping(messageId);

  // Texto entrante
  let userText = "";
  if (type === "text") userText = message.text?.body || "";
  else if (type === "interactive") {
    userText =
      message.interactive?.button_reply?.title ||
      message.interactive?.list_reply?.title ||
      "";
  } else {
    userText = "";
  }

  userText = normalizeText(userText);
  if (!userText) return;

  const session = getSession(from);

  // Extractor local SIEMPRE (aunque falle IA)
  extractInfo(session, userText);

  // Delay humano
  const delay = clamp(randInt(MIN_DELAY, MAX_DELAY), 250, 8000);
  await sleep(delay);

  // Respuesta base (no repetitiva)
  let replyText = buildReply(session, userText);

  // Si IA está activa, úsala para “humanizar” sin romper el flujo
  // (Si falla, nos quedamos con buildReply)
  const aiText = await aiReply(session, userText);
  if (aiText) {
    // Importante: no dejar que la IA re-pregunte lo mismo. Mantén la estructura corta.
    // Si la IA devuelve algo muy largo, igual lo recortamos.
    const trimmed = normalizeText(aiText);
    if (trimmed.length > 0) {
      replyText = trimmed.length > 900 ? trimmed.slice(0, 900) : trimmed;
    }
  }

  // Enviar (sin quote por defecto)
  await sendText(from, replyText, messageId);

  session.lastReplyAt = now();
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
  // Responder 200 de inmediato para evitar reintentos
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body?.object !== "whatsapp_business_account") return;

    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const value = change.value || {};
        const messages = value.messages || [];
        if (!messages.length) continue;

        for (const message of messages) {
          setImmediate(() => {
            handleInboundMessage(message).catch((e) =>
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
  log(`✅ Server running on port ${PORT}`);
});
