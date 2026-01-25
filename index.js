// index.js — Activa Inversiones EIRL (WhatsApp IA)
// - Responde 200 inmediato (evita 502 / reintentos Meta)
// - Typing indicator real con keep-alive
// - Respuesta consultiva (residencial vs técnico)
// - Límites de fabricación Haustek incluidos (S60 + Sliding)
// - Sin mencionar RPT (no lo vendemos)
// - Reset de sesión por comando: reset / nuevo / start

import express from "express";
import axios from "axios";
import OpenAI from "openai";
import pdfParse from "pdf-parse";

// Carga .env en local (si no existe, no pasa nada)
try { await import("dotenv/config"); } catch {}

const app = express();
app.use(express.json({ limit: "20mb" }));

// =========================
// Helpers ENV
// =========================
const env = (k, d = "") => (process.env[k] ?? d);
const envBool = (k, d = false) => {
  const v = (process.env[k] ?? "").toString().trim().toLowerCase();
  if (!v) return d;
  return ["1", "true", "yes", "y", "on"].includes(v);
};
const envInt = (k, d) => {
  const n = parseInt(process.env[k] ?? "", 10);
  return Number.isFinite(n) ? n : d;
};

// =========================
// Config
// =========================
const PORT = envInt("PORT", 8080);

const ENV = {
  META_GRAPH_VERSION: env("META_GRAPH_VERSION", "v22.0"),
  WHATSAPP_TOKEN: env("WHATSAPP_TOKEN"),
  PHONE_NUMBER_ID: env("PHONE_NUMBER_ID"),
  VERIFY_TOKEN: env("VERIFY_TOKEN"),

  OPENAI_API_KEY: env("OPENAI_API_KEY"),
  AI_MODEL_OPENAI: env("AI_MODEL_OPENAI", "gpt-4o-mini"),
  AI_MODEL_VISION: env("AI_MODEL_VISION", "gpt-4o-mini"),
  AI_TEMPERATURE: Number(env("AI_TEMPERATURE", "0.35")),
  AI_MAX_OUTPUT_TOKENS: envInt("AI_MAX_OUTPUT_TOKENS", 320),

  // Humanización
  WAIT_AFTER_LAST_USER_MESSAGE_MS: envInt("WAIT_AFTER_LAST_USER_MESSAGE_MS", 5500),
  TYPING_SIMULATION: envBool("TYPING_SIMULATION", true),
  TYPING_MIN_MS: envInt("TYPING_MIN_MS", 900),
  TYPING_MAX_MS: envInt("TYPING_MAX_MS", 2100),
  EXTRA_DELAY_MEDIA_MS: envInt("EXTRA_DELAY_MEDIA_MS", 3200),
  MAX_LINES_PER_REPLY: envInt("MAX_LINES_PER_REPLY", 7),
  ONE_QUESTION_PER_TURN: envBool("ONE_QUESTION_PER_TURN", true),
  REPLY_WITH_CONTEXT: envBool("REPLY_WITH_CONTEXT", true),

  // Horario
  BUSINESS_TIMEZONE: env("BUSINESS_TIMEZONE", "America/Santiago"),
  BUSINESS_HOURS_ONLY: envBool("BUSINESS_HOURS_ONLY", false),
  BUSINESS_HOURS_START: env("BUSINESS_HOURS_START", "09:00"),
  BUSINESS_HOURS_END: env("BUSINESS_HOURS_END", "19:00"),
  AFTER_HOURS_MESSAGE: env(
    "AFTER_HOURS_MESSAGE",
    "Gracias por escribir a Activa. Estamos fuera de horario, pero mañana a primera hora le respondo."
  ),

  // Loop guard
  LOOP_GUARD_MAX_REPLIES_PER_5MIN: envInt("LOOP_GUARD_MAX_REPLIES_PER_5MIN", 6),

  // Identidad
  COMPANY_NAME: env("COMPANY_NAME", "Activa Inversiones EIRL"),
  AGENT_NAME: env("AGENT_NAME", "Marcelo Cifuentes"),
  LANGUAGE: env("LANGUAGE", "es-CL"),
  TONO: env("TONO", "usted"),
  PILLARS: env("PILLARS", "térmico, acústico, seguridad, eficiencia energética"),
  MINVU_EXPERT_NOTE: env(
    "MINVU_EXPERT_NOTE",
    "Somos especialistas en eficiencia energética, con certificación y respaldo de MINVU mediante resolución y publicación en Diario Oficial."
  ),
};

function logEnvOk(name, ok) {
  console.log(`ENV ${name}: ${ok ? "OK" : "MISSING"}`);
}

console.log(`Server booting...`);
console.log(`ENV META_GRAPH_VERSION: ${ENV.META_GRAPH_VERSION}`);
logEnvOk("PHONE_NUMBER_ID", !!ENV.PHONE_NUMBER_ID);
logEnvOk("WHATSAPP_TOKEN", !!ENV.WHATSAPP_TOKEN);
logEnvOk("VERIFY_TOKEN", !!ENV.VERIFY_TOKEN);
logEnvOk("OPENAI_API_KEY", !!ENV.OPENAI_API_KEY);
console.log(`ENV AI_MODEL_OPENAI: ${ENV.AI_MODEL_OPENAI}`);
console.log(`ENV AI_MODEL_VISION: ${ENV.AI_MODEL_VISION}`);
console.log(`TYPING_SIMULATION: ${ENV.TYPING_SIMULATION}`);

// OpenAI client
const openai = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });

// =========================
// Límites Haustek (desde tus 2 trípticos)
// =========================
const SIZE_LIMITS = {
  S60_EUROPEA: {
    ventana: { min: [400, 400], max: [1400, 1400] },     // mm
    puerta:  { min: [600, 1900], max: [1000, 2400] },    // mm
  },
  SLIDING_AMERICANA: {
    ventana: { min: [400, 500], max: [2250, 2300] },     // mm
    puerta:  { min: [1150, 2300], max: [2250, 2700] },   // mm
  },
};

// =========================
// Estado en memoria (simple)
// =========================
const sessions = new Map(); // waId -> { buffer, history[], timer, lastSeen, mediaSummary, counter[] }
const processedIds = new Map(); // msgId -> timestamp (limpieza periódica)

// Limpieza para evitar que crezca infinito
setInterval(() => {
  const now = Date.now();

  // processedIds: 2 horas
  for (const [id, ts] of processedIds.entries()) {
    if (now - ts > 2 * 60 * 60 * 1000) processedIds.delete(id);
  }

  // sessions: 24 horas sin actividad
  for (const [waId, s] of sessions.entries()) {
    if (now - (s.lastSeen || 0) > 24 * 60 * 60 * 1000) sessions.delete(waId);
  }
}, 10 * 60 * 1000);

// =========================
// Utilidades
// =========================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nowInChileHHMM() {
  const fmt = new Intl.DateTimeFormat("es-CL", {
    timeZone: ENV.BUSINESS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hh}:${mm}`;
}

function isWithinBusinessHours() {
  if (!ENV.BUSINESS_HOURS_ONLY) return true;
  const t = nowInChileHHMM();
  return t >= ENV.BUSINESS_HOURS_START && t <= ENV.BUSINESS_HOURS_END;
}

function loopGuardAllow(waId) {
  const s = sessions.get(waId) || {};
  const now = Date.now();
  s.counter = (s.counter || []).filter((ts) => now - ts < 5 * 60 * 1000);
  if (s.counter.length >= ENV.LOOP_GUARD_MAX_REPLIES_PER_5MIN) {
    sessions.set(waId, { ...s, lastSeen: now });
    return false;
  }
  s.counter.push(now);
  sessions.set(waId, { ...s, lastSeen: now });
  return true;
}

// =========================
// WhatsApp API helpers
// =========================
async function waPost(path, data) {
  return axios.post(`https://graph.facebook.com/${ENV.META_GRAPH_VERSION}/${ENV.PHONE_NUMBER_ID}/${path}`, data, {
    headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` },
    timeout: 15000,
  });
}

async function waSendText(to, body, contextMessageId) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    text: { body },
  };
  if (ENV.REPLY_WITH_CONTEXT && contextMessageId) {
    payload.context = { message_id: contextMessageId };
  }
  await waPost("messages", payload);
}

// Typing indicator real (keep-alive cada 18s)
async function startTypingKeepAlive(to, messageId) {
  if (!ENV.TYPING_SIMULATION) return () => {};

  const send = async () => {
    try {
      await waPost("messages", {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        typing_indicator: { type: "text" },
      });
    } catch {}
  };

  await send();
  const interval = setInterval(send, 18000);
  return () => clearInterval(interval);
}

function clampLines(text, maxLines) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, maxLines).join("\n");
}

function enforceOneQuestion(text) {
  // Si hay más de un '?', nos quedamos con el primero como “pregunta final”
  const idx = text.indexOf("?");
  if (idx === -1) return text;
  // Elimina otras preguntas posteriores
  const before = text.slice(0, idx + 1);
  const after = text.slice(idx + 1).replace(/\?/g, "."); // suaviza
  return (before + after).trim();
}

function addFinalQuestionIfMissing(text) {
  if (text.includes("?")) return text;
  return `${text}\n\n¿Prefiere que le cotice con fabricación + instalación, o solo fabricación?`;
}

function buildSystemPrompt() {
  return `
Eres ${ENV.AGENT_NAME}, representante senior de ${ENV.COMPANY_NAME}.
Hablas en ${ENV.LANGUAGE} y tratas de "${ENV.TONO}".
Rol: asesoría técnica + cierre comercial consultivo. ${ENV.MINVU_EXPERT_NOTE}

Productos y líneas (NO inventar otros):
- PVC Línea Europea (S60).
- PVC Línea Americana (Sliding).
- Aluminio (sin RPT; NO mencionar RPT).
Fabricamos e instalamos ventanas y puertas.

Pilares: ${ENV.PILLARS}.
Diferenciadores:
- Termopanel DVH con separador "Warm Edge" Thermoflex (reduce riesgo de condensación frente al separador de aluminio).
- Low-E (mejora aislación térmica).
- Control Solar (reduce sobrecalentamiento).
- Seguridad: laminados tipo Safety/Blindex (según requerimiento).
(Se puede explicar en simple si el cliente no es técnico.)

Condensación (guía):
- Explicar que es fenómeno físico por temperatura/humedad; no siempre es falla.
- Warm Edge + DVH + ventilación controlada ayudan a reducirla.

Límites Haustek (si el cliente pide dimensiones):
- S60 Europea:
  Ventana min 400x400 mm / max 1400x1400 mm.
  Puerta min 600x1900 mm / max 1000x2400 mm.
- Sliding Americana:
  Ventana min 400x500 mm / max 2250x2300 mm.
  Puerta min 1150x2300 mm / max 2250x2700 mm.
Si excede, propones alternativa (dividir paños / otro diseño / visita técnica), sin “retar” al cliente.

Estilo:
- Máximo ${ENV.MAX_LINES_PER_REPLY} líneas.
- Tono consultivo, concreto, sin “PDF”.
- Idealmente 1 pregunta final para avanzar (medición / visita / ubicación / instalación).
`.trim();
}

// =========================
// Media fetch
// =========================
async function fetchMediaBuffer(mediaId) {
  // GET /{media-id}?fields=url,mime_type,file_size
  const meta = await axios.get(
    `https://graph.facebook.com/${ENV.META_GRAPH_VERSION}/${mediaId}?fields=url,mime_type,file_size`,
    { headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` }, timeout: 15000 }
  );
  const url = meta.data?.url;
  const mime = meta.data?.mime_type || "";
  if (!url) throw new Error("No media URL from Meta");
  const buf = await axios.get(url, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` },
    timeout: 20000,
  });
  return { buffer: Buffer.from(buf.data), mime };
}

async function summarizePdf(buffer) {
  try {
    const parsed = await pdfParse(buffer);
    const txt = (parsed.text || "").replace(/\s+/g, " ").trim();
    // recorta para no explotar tokens
    return txt.slice(0, 2400);
  } catch {
    return "";
  }
}

async function summarizeImage(buffer) {
  try {
    const b64 = buffer.toString("base64");
    const resp = await openai.chat.completions.create({
      model: ENV.AI_MODEL_VISION,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Analiza el plano o imagen. Extrae medidas (ancho x alto), tipo de ventana/puerta y cantidad. Si hay texto con mm, respétalo." },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 220,
    });
    return (resp.choices?.[0]?.message?.content || "").trim();
  } catch {
    return "";
  }
}

// =========================
// IA: respuesta consultiva
// =========================
async function aiReply({ userText, mediaSummary, history }) {
  const system = buildSystemPrompt();
  const prompt = `
Cliente dice: ${userText || "(sin texto)"}
Archivos (si existen): ${mediaSummary || "(sin archivos)"}

Instrucción:
- Si el cliente es residencial (no técnico), explica en simple y recomienda una configuración segura.
- Si el cliente es técnico, responde con foco en DVH, condensación, Low-E, control solar, seguridad, y pide el dato crítico que falte.
- Siempre verificar medidas: si parecen en metros, asumir que fabricación trabaja en mm y pedir confirmación.
`.trim();

  const completion = await openai.chat.completions.create({
    model: ENV.AI_MODEL_OPENAI,
    messages: [
      { role: "system", content: system },
      ...(history || []).slice(-10),
      { role: "user", content: prompt },
    ],
    temperature: ENV.AI_TEMPERATURE,
    max_tokens: ENV.AI_MAX_OUTPUT_TOKENS,
  });

  let out = (completion.choices?.[0]?.message?.content || "").trim();

  // Post-procesado (reglas)
  out = clampLines(out, ENV.MAX_LINES_PER_REPLY);
  if (ENV.ONE_QUESTION_PER_TURN) out = enforceOneQuestion(out);
  out = addFinalQuestionIfMissing(out);

  return out;
}

// =========================
// WEBHOOKS
// =========================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === ENV.VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

app.post("/webhook", (req, res) => {
  // 200 inmediato (clave para evitar 502)
  res.sendStatus(200);

  // Procesa sin bloquear la request
  (async () => {
    try {
      const entry = req.body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const messages = value?.messages || [];
      if (!messages.length) return;

      const msg = messages[0];
      if (!msg?.id) return;

      // idempotencia
      if (processedIds.has(msg.id)) return;
      processedIds.set(msg.id, Date.now());

      const waId = msg.from;
      const messageId = msg.id;

      // horario
      if (!isWithinBusinessHours()) {
        await waSendText(waId, ENV.AFTER_HOURS_MESSAGE, messageId);
        return;
      }

      // loop guard
      if (!loopGuardAllow(waId)) return;

      // session
      const s = sessions.get(waId) || { buffer: "", history: [], timer: null, mediaSummary: "", lastSeen: Date.now(), counter: [] };
      s.lastSeen = Date.now();

      // reset command
      const incomingText = msg.type === "text" ? (msg.text?.body || "").trim().toLowerCase() : "";
      if (["reset", "nuevo", "start"].includes(incomingText)) {
        sessions.delete(waId);
        await waSendText(waId, "Listo. Reinicié su sesión. Cuénteme su solicitud como si fuera primera vez.", messageId);
        return;
      }

      // Media ACK + análisis
      if (msg.type === "document" || msg.type === "image") {
        const filename = msg.document?.filename || "archivo";
        await waSendText(waId, `Recibido: "${filename}". Deme unos segundos para revisarlo y extraer lo técnico.`, messageId);

        // delay humano “abrir archivo”
        await sleep(ENV.EXTRA_DELAY_MEDIA_MS);

        const stopTyping = await startTypingKeepAlive(waId, messageId);

        try {
          const mediaId = msg[msg.type]?.id;
          if (mediaId) {
            const { buffer, mime } = await fetchMediaBuffer(mediaId);

            if (msg.type === "document" && (mime.includes("pdf") || (msg.document?.mime_type || "").includes("pdf"))) {
              const pdfTxt = await summarizePdf(buffer);
              s.mediaSummary = pdfTxt ? `PDF: ${pdfTxt}` : "PDF recibido, sin texto extraíble.";
            }

            if (msg.type === "image") {
              const vision = await summarizeImage(buffer);
              s.mediaSummary = vision ? `IMAGEN: ${vision}` : "Imagen recibida, sin lectura automática concluyente.";
            }
          }
        } catch (e) {
          console.log("Media error:", e?.message || e);
        } finally {
          stopTyping();
        }
      }

      // Acumular texto
      if (msg.type === "text") {
        s.buffer = `${(s.buffer || "").trim()} ${msg.text?.body || ""}`.trim();
      }

      // Debounce: reagrupar mensajes seguidos
      if (s.timer) clearTimeout(s.timer);

      s.timer = setTimeout(async () => {
        const stopTyping = await startTypingKeepAlive(waId, messageId);

        try {
          // “micro-delay” humano para que se vean puntitos
          const typingDelay = ENV.TYPING_MIN_MS + Math.floor(Math.random() * Math.max(1, (ENV.TYPING_MAX_MS - ENV.TYPING_MIN_MS)));
          await sleep(typingDelay);

          const reply = await aiReply({
            userText: s.buffer,
            mediaSummary: s.mediaSummary,
            history: s.history,
          });

          // memoria breve
          s.history.push({ role: "user", content: s.buffer });
          s.history.push({ role: "assistant", content: reply });
          if (s.history.length > 20) s.history = s.history.slice(-20);

          // reset buffer
          s.buffer = "";
          s.mediaSummary = "";
          s.timer = null;

          stopTyping();
          await waSendText(waId, reply, messageId);
        } catch (e) {
          stopTyping();
          console.log("AI error:", e?.message || e);
        } finally {
          sessions.set(waId, s);
        }
      }, ENV.WAIT_AFTER_LAST_USER_MESSAGE_MS);

      sessions.set(waId, s);
    } catch (e) {
      console.log("Webhook error:", e?.message || e);
    }
  })();
});

app.get("/", (req, res) => res.send("Activa WhatsApp IA: ONLINE"));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
