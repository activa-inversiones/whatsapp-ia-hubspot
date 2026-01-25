import "dotenv/config";
import express from "express";
import axios from "axios";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import pdfParse from "pdf-parse";

const app = express();
app.use(express.json({ limit: "10mb" }));

/**
 * =========================
 * ENV REQUIRED (Railway)
 * =========================
 * WHATSAPP_TOKEN        = Token permanente (System User) con permisos WhatsApp
 * PHONE_NUMBER_ID       = WhatsApp Business Phone Number ID
 * VERIFY_TOKEN          = texto para verificación webhook (Meta)
 * META_GRAPH_VERSION    = v22.0 (o la que uses)
 * OPENAI_API_KEY        = API Key OpenAI
 *
 * =========================
 * OPTIONAL (Recomendadas)
 * =========================
 * PORT                         = 8080 (Railway normalmente inyecta PORT)
 * NODE_ENV                     = production
 *
 * AI_PROVIDER                   = openai
 * AI_MODEL_OPENAI               = gpt-4.1-mini  (si lo tienes) o gpt-4o-mini
 * AI_MODEL_VISION               = gpt-4o-mini
 * AI_TEMPERATURE                = 0.35
 * AI_MAX_OUTPUT_TOKENS          = 350
 *
 * COMPANY_NAME                  = Fabrica de Ventanas Activa
 * AGENT_NAME                    = Marcelo Cifuentes
 * LANGUAGE                      = es-CL
 * TONO                          = usted
 * PILLARS                       = termico, acustico, seguridad, eficiencia energetica
 * MINVU_EXPERT_NOTE             = Especialistas certificados por MINVU (resolución publicada en Diario Oficial) en eficiencia energética para ventanas y puertas.
 *
 * REPLY_WITH_CONTEXT            = true   (cita el mensaje del cliente)
 * STYLE_GREETING_MODE           = first_message_only
 *
 * WAIT_AFTER_LAST_USER_MESSAGE_MS= 2500  (debounce: espera por si el cliente escribe varios mensajes)
 * TYPING_SIMULATION             = true
 * TYPING_MIN_MS                 = 900
 * TYPING_MAX_MS                 = 2100
 * TYPING_PING_MS                = 18000  (mantiene “puntitos” antes de que caduquen)
 * EXTRA_DELAY_MEDIA_MS          = 3500   (humano: “abrir” PDF/imagen)
 *
 * MAX_LINES_PER_REPLY           = 7
 * ONE_QUESTION_PER_TURN         = true
 *
 * KB_PDF_DIR                    = ./kb   (carpeta con PDFs internos (Ditec, condensación, etc.))
 */

const PORT = process.env.PORT || 8080;

const ENV = {
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  META_GRAPH_VERSION: process.env.META_GRAPH_VERSION || "v22.0",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,

  AI_PROVIDER: process.env.AI_PROVIDER || "openai",
  AI_MODEL_OPENAI: process.env.AI_MODEL_OPENAI || "gpt-4.1-mini",
  AI_MODEL_VISION: process.env.AI_MODEL_VISION || "gpt-4o-mini",
  AI_TEMPERATURE: Number(process.env.AI_TEMPERATURE || "0.35"),
  AI_MAX_OUTPUT_TOKENS: Number(process.env.AI_MAX_OUTPUT_TOKENS || "350"),

  COMPANY_NAME: process.env.COMPANY_NAME || "Activa Inversiones EIRL",
  AGENT_NAME: process.env.AGENT_NAME || "Marcelo Cifuentes",
  LANGUAGE: process.env.LANGUAGE || "es-CL",
  TONO: process.env.TONO || "usted",
  PILLARS: process.env.PILLARS || "termico, acustico, seguridad, eficiencia energetica",
  MINVU_EXPERT_NOTE:
    process.env.MINVU_EXPERT_NOTE ||
    "Especialistas certificados por MINVU (resolución publicada en Diario Oficial) en eficiencia energética para ventanas y puertas.",

  REPLY_WITH_CONTEXT: (process.env.REPLY_WITH_CONTEXT || "true").toLowerCase() === "true",
  STYLE_GREETING_MODE: process.env.STYLE_GREETING_MODE || "first_message_only",

  WAIT_AFTER_LAST_USER_MESSAGE_MS: Number(process.env.WAIT_AFTER_LAST_USER_MESSAGE_MS || "2500"),
  TYPING_SIMULATION: (process.env.TYPING_SIMULATION || "true").toLowerCase() === "true",
  TYPING_MIN_MS: Number(process.env.TYPING_MIN_MS || "900"),
  TYPING_MAX_MS: Number(process.env.TYPING_MAX_MS || "2100"),
  TYPING_PING_MS: Number(process.env.TYPING_PING_MS || "18000"),
  EXTRA_DELAY_MEDIA_MS: Number(process.env.EXTRA_DELAY_MEDIA_MS || "3500"),

  MAX_LINES_PER_REPLY: Number(process.env.MAX_LINES_PER_REPLY || "7"),
  ONE_QUESTION_PER_TURN: (process.env.ONE_QUESTION_PER_TURN || "true").toLowerCase() === "true",

  KB_PDF_DIR: process.env.KB_PDF_DIR || "./kb",
};

// OpenAI client
const openai = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });

// Session memory (simple in-memory)
const sessions = new Map();
/**
 * session = {
 *   greeted: boolean,
 *   lastUserAt: number,
 *   pendingTimer: NodeJS.Timeout | null,
 *   lastMessageId: string | null,
 *   buffer: string[],
 *   profile: { customerType?: "residencial"|"tecnico"|"empresa", city?: string, comuna?: string }
 * }
 */

// Knowledge base loaded from PDFs in ./kb (optional)
let KB_TEXT = "";
try {
  if (fs.existsSync(ENV.KB_PDF_DIR)) {
    const files = fs.readdirSync(ENV.KB_PDF_DIR).filter((f) => f.toLowerCase().endsWith(".pdf"));
    // Carga “ligera”: extrae texto de PDFs internos para apoyar respuestas técnicas
    // Nota: si el PDF es solo imagen, pdf-parse tendrá poco texto, pero no rompe el flujo.
    const loadAll = async () => {
      let acc = [];
      for (const f of files) {
        const full = path.join(ENV.KB_PDF_DIR, f);
        try {
          const data = await pdfParse(fs.readFileSync(full));
          const cleaned = (data.text || "").replace(/\s+/g, " ").trim();
          if (cleaned) acc.push(`[[KB:${f}]] ${cleaned}`.slice(0, 8000));
        } catch (e) {
          // ignore per-file errors
        }
      }
      KB_TEXT = acc.join("\n\n").slice(0, 24000);
    };
    loadAll();
  }
} catch (_) {
  // ignore
}

function envCheck() {
  const ok = (v) => (v ? "OK" : "MISSING");
  console.log(`Server running on port ${PORT}`);
  console.log("ENV META_GRAPH_VERSION:", ENV.META_GRAPH_VERSION);
  console.log("ENV PHONE_NUMBER_ID:", ok(ENV.PHONE_NUMBER_ID));
  console.log("ENV WHATSAPP_TOKEN:", ok(ENV.WHATSAPP_TOKEN));
  console.log("ENV VERIFY_TOKEN:", ok(ENV.VERIFY_TOKEN));
  console.log("ENV OPENAI_API_KEY:", ok(ENV.OPENAI_API_KEY));
  console.log("ENV AI_PROVIDER:", ENV.AI_PROVIDER);
  console.log("ENV AI_MODEL_OPENAI:", ENV.AI_MODEL_OPENAI);
  console.log("ENV AI_MODEL_VISION:", ENV.AI_MODEL_VISION);
  console.log("TYPING_SIMULATION:", ENV.TYPING_SIMULATION);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function randInt(min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}

function clampLines(text, maxLines) {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= maxLines) return lines.join("\n");
  return lines.slice(0, maxLines).join("\n");
}

function looksTechnical(text) {
  const t = (text || "").toLowerCase();
  return [
    "condens",
    "transmit",
    "u-value",
    "valor u",
    "dvh",
    "low-e",
    "low e",
    "solar control",
    "control solar",
    "ditec",
    "minvu",
    "oguc",
    "nch",
    "puente térmico",
    "puente termico",
    "mm",
    "laminado",
    "safety",
  ].some((k) => t.includes(k));
}

/**
 * =========================
 * WhatsApp Cloud API helpers
 * =========================
 */
function waHeaders() {
  return {
    Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function waSendText(to, body, contextMessageId = null) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: String(body || "") },
  };

  if (ENV.REPLY_WITH_CONTEXT && contextMessageId) {
    payload.context = { message_id: contextMessageId };
  }

  await axios.post(
    `https://graph.facebook.com/${ENV.META_GRAPH_VERSION}/${ENV.PHONE_NUMBER_ID}/messages`,
    payload,
    { headers: waHeaders() }
  );
}

async function waMarkReadWithTypingIndicator(messageId, typingType = "text") {
  // Meta doc: typing indicator is sent using the messages endpoint, with status: "read"
  const payload = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
    typing_indicator: { type: typingType },
  };

  await axios.post(
    `https://graph.facebook.com/${ENV.META_GRAPH_VERSION}/${ENV.PHONE_NUMBER_ID}/messages`,
    payload,
    { headers: waHeaders() }
  );
}

function startTypingLoop(messageId, typingType = "text") {
  if (!ENV.TYPING_SIMULATION || !messageId) return () => {};

  let stopped = false;
  // primer ping inmediato
  waMarkReadWithTypingIndicator(messageId, typingType).catch(() => {});
  const timer = setInterval(() => {
    if (stopped) return;
    waMarkReadWithTypingIndicator(messageId, typingType).catch(() => {});
  }, Math.min(Math.max(ENV.TYPING_PING_MS, 5000), 24000)); // siempre < 25s

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * =========================
 * Media download helpers
 * =========================
 */
async function waGetMediaUrl(mediaId) {
  const r = await axios.get(
    `https://graph.facebook.com/${ENV.META_GRAPH_VERSION}/${mediaId}`,
    { headers: waHeaders() }
  );
  return r.data?.url;
}

async function waDownloadMedia(url) {
  const r = await axios.get(url, {
    headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` },
    responseType: "arraybuffer",
  });
  return Buffer.from(r.data);
}

/**
 * =========================
 * AI: consultive sales + technical depth
 * =========================
 */
function buildSystemPrompt({ customerType, lastUserText }) {
  const tono = (ENV.TONO || "usted").toLowerCase().includes("usted") ? "usted" : "tú";
  const pillars = ENV.PILLARS;

  const baseCompany = `
Eres ${ENV.AGENT_NAME} de ${ENV.COMPANY_NAME}. Somos fabricantes e instaladores de ventanas y puertas.
Especialidad: eficiencia energética en envolvente (ventanas/puertas). ${ENV.MINVU_EXPERT_NOTE}

Catálogo (NO mencionar aluminio con RPT porque NO lo ofrecemos):
- PVC línea europea
- PVC línea americana
- Aluminio (sin RPT)

Vidrios/termopanel (DVH) y tecnologías:
- Separador Thermoflex (tecnología inglesa): reduce significativamente el riesgo de condensación vs separador aluminio tradicional.
- Low-E: mejora la aislación térmica.
- Control Solar: reduce ganancia de calor/exceso de sol.
- Seguridad: laminados tipo Safety (ej. Blindex/Lirquén según disponibilidad), para protección y normativa.

Reglas de estilo:
- Español Chile (es-CL). Trato de ${tono}.
- Respuestas consultivas: educa al cliente (la mayoría no conoce el producto).
- Siempre haz 1 pregunta final para avanzar (si ONE_QUESTION_PER_TURN=true).
- Máximo ${ENV.MAX_LINES_PER_REPLY} líneas.
- Si el cliente es técnico, puedes usar conceptos: condensación (fenómeno físico), transmitancia/U, DVH, separador, Low-E, control solar, seguridad.
- Si faltan datos, pide SOLO lo mínimo para cotizar (tipo, medidas, ubicación/comuna, instalación sí/no).
- Si preguntan por “condensación”: explica que depende de temperatura y humedad interior/exterior; no siempre es falla. Indica que DVH + Thermoflex ayuda a mitigar.
- No inventes certificaciones específicas que no estén en el mensaje; si no está claro, ofrece enviar respaldo.
- No menciones RPT en aluminio.
`;

  const perfil = customerType
    ? `Perfil del cliente: ${customerType}.`
    : `Detecta el perfil: si el usuario usa términos técnicos (U, DVH, condensación, etc.) trátalo como "técnico"; si no, "residencial".`;

  const kb = KB_TEXT ? `\nConocimiento interno (extractos):\n${KB_TEXT}\n` : "";

  const objetivo = `
Objetivo:
1) Entender requerimiento (tipo de ventana/puerta, cantidad, medidas, ubicación).
2) Recomendar opción (PVC europeo/americano o aluminio) según necesidad (térmico/acústico/seguridad/eficiencia).
3) Recomendar DVH (Thermoflex + configuración de vidrio) según clima, orientación y uso.
4) Proponer siguiente paso: cotización preliminar o visita/medición.
`;

  const contexto = `
Contexto del último mensaje del cliente (para adaptar tono y profundidad):
"${(lastUserText || "").slice(0, 700)}"
`;

  return [baseCompany, perfil, objetivo, contexto, kb].join("\n");
}

async function openaiChat({ system, user }) {
  // Estrategia robusta: intenta modelo principal; si falla por “model not found”, cae a gpt-4o-mini
  const primary = ENV.AI_MODEL_OPENAI || "gpt-4.1-mini";
  const fallback = "gpt-4o-mini";

  const payload = {
    model: primary,
    temperature: ENV.AI_TEMPERATURE,
    max_output_tokens: ENV.AI_MAX_OUTPUT_TOKENS,
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  try {
    const r = await openai.responses.create(payload);
    return r.output_text || "";
  } catch (e) {
    const msg = String(e?.message || "");
    if (msg.toLowerCase().includes("model") && msg.toLowerCase().includes("not")) {
      const r = await openai.responses.create({ ...payload, model: fallback });
      return r.output_text || "";
    }
    throw e;
  }
}

async function openaiVision({ system, imageBuffer, userText }) {
  const model = ENV.AI_MODEL_VISION || "gpt-4o-mini";

  const b64 = imageBuffer.toString("base64");
  const r = await openai.responses.create({
    model,
    temperature: 0.2,
    max_output_tokens: 450,
    input: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "input_text", text: userText || "Extrae medidas, textos, y cualquier dato útil para cotización (ancho x alto, tipo de ventana, notas)." },
          { type: "input_image", image_url: `data:image/jpeg;base64,${b64}` },
        ],
      },
    ],
  });

  return r.output_text || "";
}

/**
 * =========================
 * Session + scheduler
 * =========================
 */
function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      greeted: false,
      lastUserAt: 0,
      pendingTimer: null,
      lastMessageId: null,
      buffer: [],
      profile: {},
    });
  }
  return sessions.get(waId);
}

async function scheduleReply(waId, messageId, collectedText, meta = {}) {
  const s = getSession(waId);
  s.lastUserAt = Date.now();
  s.lastMessageId = messageId;

  // buffer: si el cliente manda 2-3 mensajes juntos, los unimos
  if (collectedText) s.buffer.push(collectedText);

  if (s.pendingTimer) clearTimeout(s.pendingTimer);

  s.pendingTimer = setTimeout(async () => {
    const userText = s.buffer.join("\n").trim();
    s.buffer = [];
    s.pendingTimer = null;

    // saludos: solo primera vez (si corresponde)
    const shouldGreet = ENV.STYLE_GREETING_MODE === "first_message_only" ? !s.greeted : true;
    if (shouldGreet) s.greeted = true;

    // typing loop
    const stopTyping = startTypingLoop(messageId, "text");

    // delay humano inicial
    const typingDelay = randInt(ENV.TYPING_MIN_MS, ENV.TYPING_MAX_MS);
    await sleep(typingDelay);

    // define perfil (residencial/técnico) por heurística
    const customerType = meta.customerType || (looksTechnical(userText) ? "tecnico" : "residencial");

    const system = buildSystemPrompt({ customerType, lastUserText: userText });
    let reply = await openaiChat({ system, user: userText });

    // recorte / reglas de salida
    reply = clampLines(reply, ENV.MAX_LINES_PER_REPLY);

    // fuerza 1 pregunta al final si está activo
    if (ENV.ONE_QUESTION_PER_TURN) {
      // si no hay "?" agregamos una pregunta mínima
      if (!reply.includes("?")) {
        reply = `${reply}\n\n¿Me indica el tipo (corredera/proyectante/abatible), las medidas (ancho x alto) y la comuna para cotizar?`;
      }
    }

    // envía
    await waSendText(waId, reply, messageId).catch(async (e) => {
      // fallback: si falla por contexto, intenta sin contexto
      await waSendText(waId, reply, null);
    });

    stopTyping();
  }, ENV.WAIT_AFTER_LAST_USER_MESSAGE_MS);
}

/**
 * =========================
 * Webhook verify (GET)
 * =========================
 */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === ENV.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/**
 * =========================
 * Webhook receiving (POST)
 * =========================
 */
app.post("/webhook", async (req, res) => {
  // responde rápido para evitar timeouts de Meta
  res.sendStatus(200);

  try {
    const body = req.body;
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const messages = value?.messages || [];
    if (!messages.length) return;

    const msg = messages[0];
    const waId = msg.from; // user phone
    const messageId = msg.id;

    const s = getSession(waId);

    // reset session command
    const incomingText = msg.type === "text" ? (msg.text?.body || "").trim().toLowerCase() : "";
    if (incomingText === "reset" || incomingText === "nuevo" || incomingText === "start") {
      sessions.delete(waId);
      await waSendText(waId, "Listo. Reinicié su sesión. Escríbame su solicitud como si fuera primera vez.");
      return;
    }

    // TEXT
    if (msg.type === "text") {
      await scheduleReply(waId, messageId, msg.text?.body || "");
      return;
    }

    // DOCUMENT (PDF)
    if (msg.type === "document") {
      const mime = msg.document?.mime_type || "";
      const filename = msg.document?.filename || "archivo";
      const mediaId = msg.document?.id;

      console.log("INCOMING DOCUMENT:", { mime, filename, mediaId });

      // ACK humano + typing
      await waSendText(waId, `Recibido: ${filename}. Déjeme revisarlo para identificar medidas y especificaciones.`);
      const stopTyping = startTypingLoop(messageId, "text");
      await sleep(ENV.EXTRA_DELAY_MEDIA_MS);

      if (mediaId && mime.includes("pdf")) {
        const url = await waGetMediaUrl(mediaId);
        const fileBuf = await waDownloadMedia(url);

        // extraer texto PDF
        let pdfText = "";
        try {
          const data = await pdfParse(fileBuf);
          pdfText = (data.text || "").replace(/\s+/g, " ").trim();
        } catch (_) {}

        const userPrompt = `
Analiza este PDF (texto extraído) para cotización de ventanas/puertas.
1) Extrae medidas (ancho x alto), tipos (corredera/proyectante/abatible/puerta), cantidades, ubicación/obra, notas.
2) Si faltan datos, pide SOLO lo mínimo.
3) Si hay menciones técnicas (condensación/U/DVH), responde con enfoque técnico.
Texto extraído:
${pdfText || "[Sin texto claro; puede ser PDF con imágenes]"}
        `.trim();

        const customerType = looksTechnical(pdfText) ? "tecnico" : "residencial";
        const system = buildSystemPrompt({ customerType, lastUserText: `PDF: ${filename}` });

        let reply = await openaiChat({ system, user: userPrompt });
        reply = clampLines(reply, ENV.MAX_LINES_PER_REPLY);

        await waSendText(waId, reply, messageId).catch(async () => {
          await waSendText(waId, reply, null);
        });

        stopTyping();
        return;
      }

      // si no es PDF: respuesta estándar
      stopTyping();
      await waSendText(
        waId,
        "Gracias. Para avanzar, ¿me confirma si ese archivo trae medidas (ancho x alto) y cuántas unidades requiere?"
      );
      return;
    }

    // IMAGE
    if (msg.type === "image") {
      const mediaId = msg.image?.id;
      console.log("INCOMING IMAGE:", { mediaId });

      await waSendText(waId, "Recibido. Déjeme revisar la imagen para identificar medidas y detalles.");
      const stopTyping = startTypingLoop(messageId, "text");
      await sleep(ENV.EXTRA_DELAY_MEDIA_MS);

      if (mediaId) {
        const url = await waGetMediaUrl(mediaId);
        const imgBuf = await waDownloadMedia(url);

        const customerType = "residencial";
        const system = buildSystemPrompt({ customerType, lastUserText: "Imagen con información de ventanas/puertas" });

        const visionText = await openaiVision({
          system,
          imageBuffer: imgBuf,
          userText:
            "Extrae medidas (ancho x alto), tipo de ventana/puerta, notas, y cualquier texto útil. Luego redacta respuesta consultiva para cotización en Chile.",
        });

        let reply = clampLines(visionText, ENV.MAX_LINES_PER_REPLY);

        // Si vision no logra: fallback
        if (!reply || reply.length < 10) {
          reply =
            "Revisé la imagen, pero no logro leer con claridad las medidas. ¿Me indica ancho x alto en milímetros y el tipo (corredera/proyectante/abatible), por favor?";
        }

        await waSendText(waId, reply, messageId).catch(async () => {
          await waSendText(waId, reply, null);
        });

        stopTyping();
        return;
      }

      stopTyping();
      await waSendText(waId, "¿Me puede reenviar la imagen o indicar las medidas (ancho x alto) para cotizar?");
      return;
    }

    // otros tipos
    await waSendText(waId, "Gracias. ¿Me indica si es ventana o puerta, y las medidas (ancho x alto) para cotizar?");
  } catch (e) {
    console.error("Webhook error:", e?.response?.data || e?.message || e);
  }
});

app.listen(PORT, () => envCheck());
