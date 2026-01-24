import express from "express";
import axios from "axios";
import OpenAI from "openai";

/**
 * WhatsApp Cloud API + IA (OpenAI) + estilo humano
 * - Responde 200 rápido para evitar reintentos de Meta
 * - Deduplicación por message.id (wamid)
 * - Marca leído + typing indicator
 * - Delay aleatorio para “sensación humana”
 * - 1 solo mensaje por turno (no spam)
 * - No repite preguntas: usa memoria simple por contacto (in-memory)
 */

const app = express();
app.use(express.json({ limit: "2mb" }));

// ===== ENV =====
const PORT = Number(process.env.PORT || 8080);

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v22.0";

const AI_PROVIDER = (process.env.AI_PROVIDER || "").toLowerCase(); // "openai"
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const AI_MODEL_OPENAI = process.env.AI_MODEL_OPENAI || "gpt-4.1-mini";

const MIN_DELAY = Number(process.env.MIN_RESPONSE_DELAY_MS || 900);
const MAX_DELAY = Number(process.env.MAX_RESPONSE_DELAY_MS || 2200);

const COMPANY_NAME = process.env.COMPANY_NAME || "Activa Inversiones";
const DEFAULT_CITY = process.env.DEFAULT_CITY || "Temuco";

const SALES_EMAIL = process.env.SALES_EMAIL || "";
const SALES_PHONE = process.env.SALES_PHONE || "";

const CRM_WEBHOOK_URL = process.env.CRM_WEBHOOK_URL || ""; // opcional

// ===== OpenAI client (si aplica) =====
const openai =
  AI_PROVIDER === "openai" && OPENAI_API_KEY
    ? new OpenAI({ apiKey: OPENAI_API_KEY })
    : null;

// ===== Utilidades =====
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const now = () => Date.now();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}
function warn(...args) {
  console.warn(new Date().toISOString(), ...args);
}
function err(...args) {
  console.error(new Date().toISOString(), ...args);
}

function envCheck(name, value) {
  log(`ENV ${name}:`, value ? "OK" : "NOT_SET");
}

// ===== Estado (simple, en memoria) =====
/**
 * processedMessageIds evita duplicados si Meta reintenta webhooks.
 * TTL recomendado: 10 minutos.
 */
const processedMessageIds = new Map(); // id -> timestamp
const PROCESSED_TTL_MS = 10 * 60 * 1000;

function rememberProcessed(id) {
  processedMessageIds.set(id, now());
}
function wasProcessed(id) {
  const t = processedMessageIds.get(id);
  if (!t) return false;
  if (now() - t > PROCESSED_TTL_MS) {
    processedMessageIds.delete(id);
    return false;
  }
  return true;
}
function cleanupProcessed() {
  const t = now();
  for (const [id, ts] of processedMessageIds.entries()) {
    if (t - ts > PROCESSED_TTL_MS) processedMessageIds.delete(id);
  }
}
setInterval(cleanupProcessed, 60 * 1000).unref();

/**
 * sessions guarda contexto por wa_id para no repetir preguntas
 * (en producción ideal: Redis/DB, pero esto basta para estabilizar hoy).
 */
const sessions = new Map(); // wa_id -> session

function getSession(wa_id) {
  if (!sessions.has(wa_id)) {
    sessions.set(wa_id, {
      wa_id,
      createdAt: now(),
      lastReplyAt: 0,
      profile: {
        customerType: "", // residencial/comercial/constructora/arquitecto/...
        city: "",
        comuna: "",
        products: [], // ventanas, puertas, muro_cortina, tabiques_vidriados, termopanel
        goal: "", // termico/acustico/condensacion/seguridad/...
        qty: null,
        dims: [], // [{w_mm,h_mm,count}]
        timeline: "", // urgente/1 mes/2-3 meses/...
      },
      lastQuestionKey: "", // para no repetir
      lastUserText: "",
    });
  }
  return sessions.get(wa_id);
}

// ===== WhatsApp Cloud API helpers =====
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
 * Marca el mensaje como leído y muestra el typing indicator.
 * Esto hace que el cliente vea:
 * - doble check en su mensaje (leído)
 * - “escribiendo…” mientras procesas
 */
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
  if (contextMessageId) {
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

// ===== CRM webhook (opcional) =====
async function pushToCrm(event) {
  if (!CRM_WEBHOOK_URL) return;
  try {
    await axios.post(CRM_WEBHOOK_URL, event, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
  } catch (e) {
    warn("CRM webhook failed:", e?.response?.data || e.message);
  }
}

// ===== IA: 1 sola llamada que (1) actualiza perfil (2) responde humano (3) 1 pregunta max =====
async function aiReply(session, userText) {
  // Fallback sin IA:
  if (!openai) return null;

  const system = `
Eres un asesor comercial humano de ${COMPANY_NAME} (Chile). Vendes: ventanas y puertas (PVC/Aluminio), termopaneles, muros cortina y tabiques vidriados.
Objetivo: ayudar, calificar el tipo de cliente y cerrar siguiente paso (medición/visita/cotización).
Reglas estrictas:
- Responde SIEMPRE en 1 solo mensaje corto (máx 5-7 líneas).
- NO repitas preguntas ya respondidas (usa el perfil).
- Si el usuario hace una pregunta directa (ej: "qué es eficiencia energética"), RESPONDE primero y recién después pregunta 1 cosa.
- Haz MÁXIMO 1 pregunta por turno.
- Evita sonar robótico: lenguaje cercano chileno, profesional, sin exagerar.
- No prometas normas específicas si faltan datos; di "cumplimos exigencias térmicas vigentes y especificación del proyecto" y pide zona/comuna si aporta.
- Si ya hay cantidad y medidas: no vuelvas a pedirlo; pide lo que falte para cotizar (apertura, color, tipo vidrio, instalación, etc.).
- Cierre: propone siguiente paso claro (medición / fotos de vanos / llamada).
`;

  const profile = session.profile;

  const schema = {
    name: "SalesReply",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        updates: {
          type: "object",
          additionalProperties: false,
          properties: {
            customerType: { type: "string" },
            city: { type: "string" },
            comuna: { type: "string" },
            products: { type: "array", items: { type: "string" } },
            goal: { type: "string" },
            qty: { type: ["number", "null"] },
            timeline: { type: "string" },
            dims: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  w_mm: { type: "number" },
                  h_mm: { type: "number" },
                  count: { type: ["number", "null"] },
                },
                required: ["w_mm", "h_mm", "count"],
              },
            },
          },
          required: ["customerType", "city", "comuna", "products", "goal", "qty", "timeline", "dims"],
        },
        reply: { type: "string" },
        next_question_key: { type: "string" },
        crm: {
          type: "object",
          additionalProperties: false,
          properties: {
            lead_stage: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["lead_stage", "tags"],
        },
      },
      required: ["updates", "reply", "next_question_key", "crm"],
    },
  };

  const input = [
    {
      role: "system",
      content: system.trim(),
    },
    {
      role: "user",
      content: `
Contexto (perfil actual):
${JSON.stringify(profile, null, 2)}

Última pregunta hecha (para no repetir):
${session.lastQuestionKey || "(ninguna)"}

Mensaje del cliente:
${userText}
`.trim(),
    },
  ];

  try {
    const resp = await openai.responses.create({
      model: AI_MODEL_OPENAI,
      input,
      response_format: { type: "json_schema", json_schema: schema },
    });

    const text = resp.output_text || "";
    const parsed = JSON.parse(text);

    return parsed;
  } catch (e) {
    warn("OpenAI failed, fallback:", e?.message || e);
    return null;
  }
}

// ===== Fallback no-IA (muy básico) =====
function basicFallbackReply(session, userText) {
  const p = session.profile;
  const city = p.city || p.comuna || DEFAULT_CITY;

  // Responder preguntas simples frecuentes:
  const t = userText.toLowerCase();
  if (t.includes("eficiencia") || t.includes("aislaci") || t.includes("transmit")) {
    const cierre = "Si me dices 1) tipo de apertura (corredera/abatir) y 2) color (blanco/antracita), te cierro una propuesta y agendamos medición.";
    return `Eficiencia energética en ventanas = que pase menos frío/calor. Se refleja en el valor U (mientras más bajo, mejor) y en el control de condensación con buen termopanel + sellos + instalación.\nEn ${city}, PVC + termopanel (DVH) suele andar excelente; si quieres subir nivel, Low-E ayuda bastante.\n${cierre}`;
  }

  // Si no hay producto definido:
  if (!p.products?.length) {
    return `Hola, soy ${COMPANY_NAME}. Para ayudarte rápido: ¿qué necesitas cotizar: ventanas, puertas, muro cortina o tabiques vidriados?`;
  }

  // Si ya hay producto, pedir 1 dato faltante:
  return `Perfecto. Para cotizar bien en ${city}: ¿las ventanas serían corredera o abatible (oscilobatiente)? Con eso te doy recomendación y siguiente paso.`;
}

// ===== Orquestación por mensaje =====
async function handleInboundMessage(message, value) {
  const messageId = message.id;
  const from = message.from; // wa_id (teléfono del cliente)
  const type = message.type;

  if (!from || !messageId) return;

  // Deduplicación: si Meta reintenta, NO respondemos 2 veces
  if (wasProcessed(messageId)) {
    log("DUPLICATE webhook ignored:", messageId);
    return;
  }
  rememberProcessed(messageId);

  // Marcar como leído + typing (human UX)
  await markReadAndTyping(messageId);

  const session = getSession(from);

  // Obtener texto
  let userText = "";
  if (type === "text") userText = message.text?.body || "";
  else if (type === "interactive") {
    // si más adelante usas botones/listas
    userText =
      message.interactive?.button_reply?.title ||
      message.interactive?.list_reply?.title ||
      "";
  } else {
    userText = `(${type})`;
  }

  userText = (userText || "").trim();
  if (!userText) return;

  session.lastUserText = userText;

  // Delay aleatorio (parecer humano)
  const delay = clamp(randInt(MIN_DELAY, MAX_DELAY), 250, 8000);
  await sleep(delay);

  // Generar respuesta (IA o fallback)
  let replyText = "";
  let nextKey = "";

  const ai = await aiReply(session, userText);

  if (ai?.reply) {
    // Actualizar perfil para no repetir preguntas
    session.profile = {
      ...session.profile,
      ...ai.updates,
      products: Array.isArray(ai.updates?.products) ? ai.updates.products : session.profile.products,
      dims: Array.isArray(ai.updates?.dims) ? ai.updates.dims : session.profile.dims,
    };

    // Evitar repetir la misma pregunta si el modelo insiste
    nextKey = (ai.next_question_key || "").trim();
    if (nextKey && nextKey === session.lastQuestionKey) {
      // si repite, le quitamos la pregunta al final (simple)
      replyText = ai.reply.replace(/\?\s*$/, "").trim();
      nextKey = "";
    } else {
      replyText = ai.reply.trim();
    }

    // Empujar evento al CRM (opcional)
    await pushToCrm({
      source: "whatsapp",
      wa_id: from,
      message_id: messageId,
      user_text: userText,
      profile: session.profile,
      crm: ai.crm,
      ts: new Date().toISOString(),
    });
  } else {
    replyText = basicFallbackReply(session, userText);
  }

  // Anti-spam: 1 mensaje por turno, y no enviar si está vacío
  if (!replyText) return;

  // Enviar
  await sendText(from, replyText, messageId);

  // Guardar última pregunta
  session.lastReplyAt = now();
  session.lastQuestionKey = nextKey || session.lastQuestionKey;
}

// ===== WEBHOOKS =====
app.get("/webhook", (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  } catch (e) {
    err("GET /webhook error:", e);
    return res.sendStatus(500);
  }
});

app.post("/webhook", (req, res) => {
  // IMPORTANT: responder 200 INMEDIATO para que Meta no reintente
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

        // Procesar asíncrono (después del 200)
        for (const message of messages) {
          setImmediate(() => {
            handleInboundMessage(message, value).catch((e) =>
              err("handleInboundMessage crashed:", e?.response?.data || e.message)
            );
          });
        }
      }
    }
  } catch (e) {
    err("POST /webhook parse error:", e);
  }
});

// ===== Healthcheck =====
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
  envCheck("CRM_WEBHOOK_URL", CRM_WEBHOOK_URL);
  log(`✅ Server running on port ${PORT}`);
});
