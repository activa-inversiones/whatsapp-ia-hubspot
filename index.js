import express from "express";
import axios from "axios";
import OpenAI from "openai";
import pdfParse from "pdf-parse";
import dotenv from "dotenv";

// Railway maneja variables de entorno; dotenv solo para local
if (!process.env.RAILWAY_STATIC_URL) dotenv.config();

const app = express();
app.use(express.json({ limit: "15mb" })); // Aumentado para planos pesados

// =========================
// CONFIGURACIÓN MAESTRA
// =========================
const PORT = Number(process.env.PORT || 8080);
const META_VERSION = process.env.META_GRAPH_VERSION || "v22.0";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// IA - Preferimos gpt-4.1-mini si está disponible según tus logs
const MODEL_TEXT = process.env.AI_MODEL_OPENAI || "gpt-4.1-mini";
const MODEL_VISION = process.env.AI_MODEL_VISION || "gpt-4o-mini";

// Humanización
const DEBOUNCE_MS = Number(process.env.WAIT_AFTER_LAST_USER_MESSAGE_MS || 2500);
const EXTRA_DELAY_MEDIA = Number(process.env.EXTRA_DELAY_MEDIA_MS || 3500);

// =========================
// LÍMITES TÉCNICOS (Haustek / Activa)
// =========================
const SPECS = {
  S60_EURO: {
    ventana: { w: [400, 1400], h: [400, 1400] },
    puerta:  { w: [600, 1000], h: [1900, 2400] },
    ref: "PVC Europeo S60"
  },
  SLIDING_AMER: {
    ventana: { w: [400, 2250], h: [500, 2300] },
    puerta:  { w: [1150, 2250], h: [2300, 2700] },
    ref: "PVC Americano Sliding"
  }
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sessions = new Map();

// =========================
// GESTIÓN DE SESIONES
// =========================
function getSession(waId) {
  const now = Date.now();
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      greeted: false,
      history: [],
      lastActivity: now,
      timer: null,
      buffer: ""
    });
  }
  const s = sessions.get(waId);
  s.lastActivity = now;
  return s;
}

// Limpieza automática cada hora para liberar RAM
setInterval(() => {
  const threshold = Date.now() - (4 * 60 * 60 * 1000); // 4 horas
  for (const [id, s] of sessions) {
    if (s.lastActivity < threshold) sessions.delete(id);
  }
}, 3600000);

// =========================
// UTILIDADES TÉCNICAS
// =========================

// Validador de ingeniería rápido
function validateMeasures(w, h, system = "S60_EURO", type = "ventana") {
  const limit = SPECS[system]?.[type];
  if (!limit) return { ok: true };
  const ok = w >= limit.w[0] && w <= limit.w[1] && h >= limit.h[0] && h <= limit.h[1];
  return {
    ok,
    msg: ok ? "" : `⚠️ Nota técnica: Para ${SPECS[system].ref}, las dimensiones ideales son ${limit.w[0]}-${limit.w[1]}mm de ancho.`
  };
}

// =========================
// WHATSAPP CORE
// =========================

async function waApi(endpoint, data) {
  return axios.post(`https://graph.facebook.com/${META_VERSION}/${PHONE_ID}/${endpoint}`, data, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
  });
}

async function markAsRead(messageId) {
  try { await waApi("messages", { messaging_product: "whatsapp", status: "read", message_id: messageId }); } catch(e){}
}

async function sendTyping(to, messageId, active = true) {
  if (process.env.TYPING_SIMULATION !== "true") return;
  try {
    await waApi("messages", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      sender_action: active ? "typing_on" : "typing_off" // Algunos partners usan sender_action
    });
    // Fallback para Cloud API pura
    await waApi("messages", {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
      typing_indicator: { type: "text" }
    });
  } catch(e){}
}

// =========================
// PIPELINE DE IA
// =========================

async function getAiReply(session, contextData = "") {
  const systemPrompt = `
Usted es ${process.env.AGENT_NAME}, asesor senior en ${process.env.COMPANY_NAME}.
Experto MINVU en eficiencia energética.

Protocolo Activa:
1. TRATO: ${process.env.TONO || "Usted"}. Tono profesional, consultivo y chileno.
2. PRODUCTOS: PVC Europeo (S60), PVC Americano, Aluminio estándar. (NO RPT).
3. VALOR AGREGADO: Mencione separador Thermoflex (reduce condensación) y cristales Low-E/Control Solar.
4. REGLA DE ORO: Máximo 7 líneas. Solo 1 pregunta al final.
5. LÍMITES: Si detecta medidas críticas (ej. ventana >1.5mt ancho en S60), sugiera dividir paños o cambiar a Sliding.

Datos actuales del cliente: ${contextData}
`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...session.history.slice(-10),
    { role: "user", content: session.buffer }
  ];

  const completion = await openai.chat.completions.create({
    model: MODEL_TEXT,
    messages,
    temperature: 0.3,
    max_tokens: 400
  });

  return completion.choices[0].message.content;
}

// =========================
// WEBHOOK HANDLER
// =========================

app.post("/webhook", async (req, res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return res.sendStatus(200);

  const waId = msg.from;
  const session = getSession(waId);
  const messageId = msg.id;

  // 1. Visto inmediato
  await markAsRead(messageId);

  // 2. Acumular texto (Debounce)
  if (msg.type === "text") session.buffer += ` ${msg.text.body}`;

  // 3. Manejo de Medios (PDF/Imagen)
  let mediaExtra = "";
  if (msg.type === "document" || msg.type === "image") {
    await waApi("messages", {
      messaging_product: "whatsapp",
      to: waId,
      text: { body: "Recibido. Déjeme analizar los detalles técnicos del archivo..." }
    });
    
    // Aquí iría tu lógica de descarga y parsing (pdfParse / Vision)
    // Se asume que mediaExtra se llena con el texto extraído
    await sleep(EXTRA_DELAY_MEDIA);
  }

  // 4. Temporizador de respuesta (Human-like)
  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(async () => {
    await sendTyping(waId, messageId, true);
    
    const reply = await getAiReply(session, mediaExtra);
    
    // Guardar en historial
    session.history.push({ role: "user", content: session.buffer });
    session.history.push({ role: "assistant", content: reply });
    
    // Limpiar buffer
    session.buffer = "";
    session.timer = null;
    session.greeted = true;

    await waApi("messages", {
      messaging_product: "whatsapp",
      to: waId,
      text: { body: reply },
      context: { message_id: messageId }
    });
    
    await sendTyping(waId, messageId, false);
  }, DEBOUNCE_MS);

  res.sendStatus(20
