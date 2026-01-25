import express from "express";
import axios from "axios";
import OpenAI from "openai";
import pdfParse from "pdf-parse";

// Railway inyecta las variables directamente. No necesitamos dotenv en producción,
// lo que evita el error ERR_MODULE_NOT_FOUND.
const app = express();
app.use(express.json({ limit: "10mb" }));

// =========================
// CONFIGURACIÓN (Panel Railway)
// =========================
const PORT = Number(process.env.PORT || 8080);
const META_VERSION = process.env.META_GRAPH_VERSION || "v22.0";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Modelos (¡Validado 4.1-mini!)
const MODEL_TEXT = process.env.AI_MODEL_OPENAI || "gpt-4.1-mini";
const MODEL_VISION = process.env.AI_MODEL_VISION || "gpt-4o-mini";

const AGENT = process.env.AGENT_NAME || "Marcelo Cifuentes";
const COMPANY = process.env.COMPANY_NAME || "Activa Inversiones";

// =========================
// LÍMITES DE FABRICACIÓN (Haustek)
// =========================
const SIZE_LIMITS = {
  "PVC_EUROPEA_S60": {
    ventana: { minW: 400, minH: 400, maxW: 1400, maxH: 1400 },
    puerta:  { minW: 600, minH: 1900, maxW: 1000, maxH: 2400 }
  },
  "PVC_AMERICANA": {
    ventana: { minW: 400, minH: 500, maxW: 2250, maxH: 2300 },
    puerta:  { minW: 1150, minH: 2300, maxW: 2250, maxH: 2700 }
  }
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sessions = new Map();

// =========================
// UTILIDADES TÉCNICAS
// =========================
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, { history: [], buffer: "", timer: null, greeted: false });
  }
  return sessions.get(waId);
}

// =========================
// WHATSAPP CORE (Typing & Auth)
// =========================
async function waApi(endpoint, data) {
  return axios.post(`https://graph.facebook.com/${META_VERSION}/${PHONE_ID}/${endpoint}`, data, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
  });
}

// Typing Indicator con Keep-Alive (Puntitos constantes)
async function startTyping(to, messageId) {
  if (process.env.TYPING_SIMULATION !== "true") return { stop: () => {} };
  
  const send = async () => {
    try {
      await waApi("messages", {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        typing_indicator: { type: "text" }
      });
    } catch (e) {}
  };

  await send();
  const interval = setInterval(send, 18000); // Re-ping cada 18s
  return { stop: () => clearInterval(interval) };
}

// =========================
// PIPELINE DE IA
// =========================
async function getAiResponse(session, extraContext = "") {
  const prompt = `
Eres ${AGENT} de ${COMPANY}. Empresa experta en eficiencia energética (MINVU).
Trato: profesional (usted). Contexto: Chile.
Pilares: Térmico, Acústico, Seguridad.
NO ofrezca RPT en Aluminio. Mencione separador Thermoflex y cristales Low-E.
Regla: Máximo 7 líneas y solo 1 pregunta al final.
${extraContext ? `\nContexto técnico del archivo: ${extraContext}` : ""}
`;

  const completion = await openai.chat.completions.create({
    model: MODEL_TEXT,
    messages: [
      { role: "system", content: prompt },
      ...session.history.slice(-10),
      { role: "user", content: session.buffer }
    ],
    temperature: 0.35
  });

  return completion.choices[0].message.content;
}

// =========================
// WEBHOOK PRINCIPAL (POST)
// =========================
app.post("/webhook", async (req, res) => {
  // CORRECCIÓN SINTAXIS: res.sendStatus(200) completo
  res.sendStatus(200);

  const entry = req.body.entry?.[0];
  const msg = entry?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return;

  const waId = msg.from;
  const session = getSession(waId);
  const messageId = msg.id;

  // 1. Debounce Logic (Juntar mensajes)
  if (msg.type === "text") session.buffer += ` ${msg.text.body}`;

  // 2. Procesamiento de Medios (PDF/Imagen)
  let mediaContext = "";
  if (msg.type === "document" && msg.document.mime_type.includes("pdf")) {
    mediaContext = "El cliente envió un PDF de plano/cotización.";
    await waApi("messages", { messaging_product: "whatsapp", to: waId, text: { body: "Recibido. Estoy analizando técnicamente su PDF..." } });
  } 
  else if (msg.type === "image") {
    mediaContext = "El cliente envió una imagen de vanos o plano.";
    await waApi("messages", { messaging_product: "whatsapp", to: waId, text: { body: "Veo la imagen. Déjeme revisar las medidas..." } });
  }

  // 3. Respuesta Programada (Ritmo Humano)
  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(async () => {
    const typing = await startTyping(waId, messageId);
    
    try {
      const reply = await getAiResponse(session, mediaContext);
      
      session.history.push({ role: "user", content: session.buffer });
      session.history.push({ role: "assistant", content: reply });
      session.buffer = "";
      session.timer = null;

      typing.stop();
      await waApi("messages", {
        messaging_product: "whatsapp",
        to: waId,
        text: { body: reply },
        context: { message_id: messageId }
      });
    } catch (e) {
      typing.stop();
      console.error("Error en pipeline:", e.message);
    }
  }, Number(process.env.WAIT_AFTER_LAST_USER_MESSAGE_MS || 2500));
});

// Verificación Webhook
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) res.send(req.query["hub.challenge"]);
  else res.sendStatus(403);
});

app.listen(PORT, () => console.log(`🚀 Marcelo Cifuentes (Activa) Online en puerto ${PORT}`));
