// index.js — WhatsApp IA (OpenAI Tools + Vision + Audio STT) + PDF Quotes + Zoho CRM
// Ferrari 3.0 — Stable / Anti-dup / Locks / TTL / RateLimit / Media (audio+image+pdf)
// Node 18+ | Railway | ESM

import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import crypto from "crypto";
import FormData from "form-data";
import PDFDocument from "pdfkit";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { createRequire } from "module";

dotenv.config();

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse"); // evita problemas ESM/default export

const app = express();

// ---------- Raw body para firma Meta ----------
app.use(
  express.json({
    limit: "20mb",
    verify: (req, res, buf) => {
      req.rawBody = buf; // Buffer
    },
  })
);

// ---------- ENV ----------
const PORT = process.env.PORT || 8080;
const TZ = process.env.TZ || "America/Santiago";

const META = {
  GRAPH_VERSION: process.env.META_GRAPH_VERSION || "v22.0",
  TOKEN: process.env.WHATSAPP_TOKEN,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  APP_SECRET: process.env.APP_SECRET || "", // opcional (recomendado)
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL_OPENAI || "gpt-4o-mini"; // texto+vision
const STT_MODEL = process.env.AI_MODEL_STT || "whisper-1";      // audio->texto

const AUTO_SEND_PDF_WHEN_READY = String(process.env.AUTO_SEND_PDF_WHEN_READY || "true") === "true";

const REQUIRE_ZOHO = String(process.env.REQUIRE_ZOHO || "true") === "true";
const ZOHO = {
  CLIENT_ID: process.env.ZOHO_CLIENT_ID,
  CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET,
  REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN,
  REDIRECT_URI: process.env.ZOHO_REDIRECT_URI, // 👈 agrega esto
  API_DOMAIN: process.env.ZOHO_API_DOMAIN || "https://www.zohoapis.com",
  ACCOUNTS_DOMAIN: process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.com",
};

function assertEnv() {
  const missing = [];
  if (!META.TOKEN) missing.push("WHATSAPP_TOKEN");
  if (!META.PHONE_NUMBER_ID) missing.push("PHONE_NUMBER_ID");
  if (!META.VERIFY_TOKEN) missing.push("VERIFY_TOKEN");
  if (!OPENAI_API_KEY) missing.push("OPENAI_API_KEY");

  if (REQUIRE_ZOHO) {
    if (!ZOHO.CLIENT_ID) missing.push("ZOHO_CLIENT_ID");
    if (!ZOHO.CLIENT_SECRET) missing.push("ZOHO_CLIENT_SECRET");
    if (!ZOHO.REFRESH_TOKEN) missing.push("ZOHO_REFRESH_TOKEN");
  }

  if (missing.length) {
    console.error("[FATAL] Missing ENV:", missing.join(", "));
    process.exit(1);
  }
}
assertEnv();

// ---------- OpenAI ----------
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ---------- Util ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- WhatsApp Graph base ----------
const waBase = () => `https://graph.facebook.com/${META.GRAPH_VERSION}`;

// ---------- Meta Signature (opcional) ----------
function verifyMetaSignature(req) {
  if (!META.APP_SECRET) return true;
  const sig = req.get("X-Hub-Signature-256") || req.get("x-hub-signature-256");
  if (!sig) return false;
  if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) return false;

  const expected =
    "sha256=" + crypto.createHmac("sha256", META.APP_SECRET).update(req.rawBody).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ---------- WhatsApp Send ----------
async function waSendText(to, text) {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body: text } };

  const r = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${META.TOKEN}` },
    timeout: 20000,
  });

  console.log("✅ WA send text", r.status, to);
}

async function waUploadPdf(buffer, filename = "Cotizacion_Activa.pdf") {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/media`;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buffer, { filename, contentType: "application/pdf" });

  const r = await axios.post(url, form, {
    headers: { Authorization: `Bearer ${META.TOKEN}`, ...form.getHeaders() },
    maxBodyLength: Infinity,
    timeout: 30000,
  });

  console.log("✅ WA upload pdf", r.status, r.data?.id);
  return r.data.id;
}

async function waSendPdfById(to, mediaId, caption) {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: { id: mediaId, filename: "Cotizacion_Activa.pdf", caption },
  };

  const r = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${META.TOKEN}` },
    timeout: 20000,
  });

  console.log("✅ WA send pdf", r.status, to, mediaId);
}

// ---------- WhatsApp Media Download ----------
async function waGetMediaMeta(mediaId) {
  const url = `${waBase()}/${mediaId}`;
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${META.TOKEN}` },
    timeout: 20000,
  });
  // data: { url, mime_type, sha256, file_size, id }
  return data;
}

async function waDownloadMedia(mediaUrl) {
  const { data, headers } = await axios.get(mediaUrl, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${META.TOKEN}` },
    timeout: 30000,
  });
  const mime = headers["content-type"] || "application/octet-stream";
  return { buffer: Buffer.from(data), mime };
}

// ---------- Audio -> Text ----------
async function transcribeAudio(buffer, mime) {
  const file = await toFile(buffer, "audio.ogg", { type: mime });
  const r = await openai.audio.transcriptions.create({
    model: STT_MODEL,
    file,
    language: "es",
  });
  return (r.text || "").trim();
}

// ---------- Image -> Text (Vision) ----------
async function describeImage(buffer, mime) {
  // Convert to data URL (sin subir a internet)
  const b64 = buffer.toString("base64");
  const dataUrl = `data:${mime};base64,${b64}`;

  const prompt = `
Describe brevemente la imagen y extrae datos útiles para cotizar ventanas/puertas:
- producto (ventana/puerta y tipo apertura si se entiende)
- medidas (si aparecen en el texto, croquis o etiqueta)
- comuna/dirección (si aparece)
- vidrio (termopanel/low-e/etc si aparece)
Responde en español, máximo 8 líneas. Si no hay datos, dilo.
`.trim();

  const resp = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    temperature: 0.2,
    max_tokens: 300,
  });

  return (resp.choices?.[0]?.message?.content || "").trim();
}

// ---------- PDF entrante -> Text ----------
async function parsePdfToText(buffer) {
  const r = await pdfParse(buffer);
  const text = (r?.text || "").trim();
  // Control de tamaño para no mandar PDFs gigantes al LLM
  const clipped = text.length > 6000 ? text.slice(0, 6000) + "\n...[recortado]" : text;
  return clipped;
}

// ---------- Sessions + TTL ----------
const sessions = new Map();
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const MAX_SESSIONS = 10000;

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      lastUserAt: Date.now(),
      data: {
        name: "",
        product: "",
        measures: "",
        address: "",
        comuna: "",
        glass: "",
        install: "",
        wants_pdf: false,
        notes: "",
      },
      history: [],
      pdfSent: false,
    });
  }
  return sessions.get(waId);
}

function cleanupSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  let deleted = 0;
  for (const [waId, s] of sessions.entries()) {
    if ((s.lastUserAt || 0) < cutoff) {
      sessions.delete(waId);
      deleted++;
    }
  }
  if (sessions.size > MAX_SESSIONS) {
    const sorted = [...sessions.entries()].sort((a, b) => (a[1].lastUserAt || 0) - (b[1].lastUserAt || 0));
    const toDelete = sorted.slice(0, sessions.size - MAX_SESSIONS);
    for (const [waId] of toDelete) {
      sessions.delete(waId);
      deleted++;
    }
  }
  if (deleted) console.log(`🧹 sessions cleaned: ${deleted}`);
}
setInterval(cleanupSessions, 60 * 60 * 1000);

// ---------- Dedupe msgId ----------
const processedMsgIds = new Map();
const MSGID_TTL_MS = 2 * 60 * 60 * 1000;

function isDuplicateMsg(msgId) {
  if (!msgId) return false;
  const now = Date.now();
  const ts = processedMsgIds.get(msgId);
  if (ts && now - ts < MSGID_TTL_MS) return true;
  processedMsgIds.set(msgId, now);
  return false;
}
setInterval(() => {
  const cutoff = Date.now() - MSGID_TTL_MS;
  for (const [id, ts] of processedMsgIds.entries()) {
    if (ts < cutoff) processedMsgIds.delete(id);
  }
}, 10 * 60 * 1000);

// ---------- Lock por waId (anti race) ----------
const locks = new Map();
async function acquireLock(waId, timeoutMs = 30000) {
  if (locks.has(waId)) await locks.get(waId);
  let release;
  const p = new Promise((r) => (release = r));
  const t = setTimeout(() => {
    release?.();
    locks.delete(waId);
  }, timeoutMs);
  locks.set(waId, p);
  return () => {
    clearTimeout(t);
    release?.();
    locks.delete(waId);
  };
}

// ---------- Rate limit ----------
const rate = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;

function checkRate(waId) {
  const now = Date.now();
  if (!rate.has(waId)) {
    rate.set(waId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true };
  }
  const r = rate.get(waId);
  if (now >= r.resetAt) {
    r.count = 1;
    r.resetAt = now + RATE_WINDOW_MS;
    return { allowed: true };
  }
  r.count++;
  if (r.count > RATE_MAX) {
    const resetIn = Math.ceil((r.resetAt - now) / 1000);
    return { allowed: false, msg: `Has enviado muchos mensajes. Espera ${resetIn}s y continuamos.` };
  }
  return { allowed: true };
}
setInterval(() => {
  const now = Date.now();
  for (const [waId, r] of rate.entries()) {
    if (now > r.resetAt + RATE_WINDOW_MS) rate.delete(waId);
  }
}, 5 * 60 * 1000);

// ---------- Webhook payload validate & extract ----------
function extractIncoming(reqBody) {
  const entry = reqBody?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;

  // Ignorar statuses
  if (value?.statuses?.length) return { ok: false, reason: "status_update" };

  const msg = value?.messages?.[0];
  if (!msg) return { ok: false, reason: "no_message" };
  if (!msg.from || !msg.id || !msg.type) return { ok: false, reason: "incomplete_message" };

  const waId = msg.from;
  const msgId = msg.id;
  const type = msg.type;

  // ids de media
  const audioId = type === "audio" ? msg.audio?.id : null;
  const imageId = type === "image" ? msg.image?.id : null;
  const docId = type === "document" ? msg.document?.id : null;
  const docMime = type === "document" ? msg.document?.mime_type : null;
  const docFilename = type === "document" ? msg.document?.filename : null;

  let text = "";
  if (type === "text") text = msg.text?.body || "";
  else if (type === "button") text = msg.button?.text || "";
  else if (type === "interactive") text = JSON.stringify(msg.interactive || {});
  else text = `[${type}]`;

  return { ok: true, waId, msgId, type, text, audioId, imageId, docId, docMime, docFilename };
}

// ---------- AI Tools ----------
const tools = [
  {
    type: "function",
    function: {
      name: "update_customer_data",
      description: "Actualiza datos del cliente para cotización/visita (ventanas/puertas).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          product: { type: "string" },
          measures: { type: "string" },
          address: { type: "string" },
          comuna: { type: "string" },
          glass: { type: "string" },
          install: { type: "string", enum: ["Si", "No"] },
          wants_pdf: { type: "boolean" },
          notes: { type: "string" },
        },
        required: [],
      },
    },
  },
];

const SYSTEM_PROMPT = `
Eres el asistente comercial de Activa Inversiones (Temuco / La Araucanía) para ventanas y puertas PVC/Aluminio.
Objetivo: cerrar visita/medición o enviar PDF referencial.

Reglas:
- Responde breve (1–4 líneas) y humano.
- NO entregues precios por chat. Si preguntan precio: "Te lo envío en PDF formal".
- Si el cliente entrega datos (producto, medidas, comuna/dirección, vidrio, instalación), llama la tool update_customer_data.
- Si falta info para PDF, pide SOLO 1 dato a la vez (el más importante).
- Si ya tienes el dato, NO lo vuelvas a pedir.
- Si llega una imagen o PDF con info, úsala para completar datos.
`.trim();

function isComplete(d) {
  return !!(d.product && d.measures && (d.address || d.comuna) && d.glass && d.install);
}

async function runAI(session, userText) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: `Memoria actual: ${JSON.stringify(session.data)}` },
    ...session.history.slice(-6),
    { role: "user", content: userText },
  ];

  try {
    const resp = await openai.chat.completions.create({
      model: AI_MODEL,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.3,
      max_tokens: 380,
    });

    return resp.choices?.[0]?.message || { role: "assistant", content: "¿Me confirmas medidas y comuna?" };
  } catch (e) {
    console.error("❌ OpenAI error", e?.response?.data || e.message);
    return { role: "assistant", content: "Tuve un problema técnico. ¿Me confirmas medidas (ancho x alto) y comuna?" };
  }
}

// ---------- PDF de cotización (saliente) ----------
function createQuotePdf(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 48 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("error", (e) => reject(e));
      doc.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (buf.length < 200) return reject(new Error("PDF demasiado pequeño"));
        resolve(buf);
      });

      doc.fontSize(18).text("Cotización Referencial — Activa Inversiones");
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor("#444").text(`Fecha: ${new Date().toLocaleString("es-CL", { timeZone: TZ })}`);
      doc.moveDown();

      doc.fillColor("#000").fontSize(12).text("Cliente");
      doc.fontSize(11);
      doc.text(`Nombre: ${data.name || "—"}`);
      doc.text(`Comuna/Dirección: ${data.address || data.comuna || "—"}`);
      doc.text(`Teléfono: (WhatsApp)`);
      doc.moveDown();

      doc.fontSize(12).text("Solicitud");
      doc.fontSize(11);
      doc.text(`Producto: ${data.product || "—"}`);
      doc.text(`Medidas: ${data.measures || "—"}`);
      doc.text(`Vidrio: ${data.glass || "—"}`);
      doc.text(`Instalación: ${data.install || "—"}`);

      if (data.notes) {
        doc.moveDown();
        doc.fontSize(11).text(`Notas: ${data.notes}`);
      }

      doc.moveDown();
      doc.fontSize(10).fillColor("#444").text(
        "Nota: Valores y plazos se confirman tras visita/medición. Documento referencial generado automáticamente."
      );

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ---------- Zoho ----------
let zohoCache = { token: "", expiresAt: 0 };

async function getZohoToken() {
  if (!REQUIRE_ZOHO) return "";
  const now = Date.now();
  if (zohoCache.token && now < zohoCache.expiresAt) return zohoCache.token;

  const url = `${ZOHO.ACCOUNTS_DOMAIN}/oauth/v2/token`;
  const params = new URLSearchParams();
  params.append("refresh_token", ZOHO.REFRESH_TOKEN);
  params.append("client_id", ZOHO.CLIENT_ID);
  params.append("client_secret", ZOHO.CLIENT_SECRET);
  params.append("grant_type", "refresh_token");

  const { data } = await axios.post(url, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000,
  });

  if (!data.access_token) throw new Error("Zoho no devolvió access_token");
  const expiresIn = Number(data.expires_in || 3600);
  zohoCache.token = data.access_token;
  zohoCache.expiresAt = now + expiresIn * 1000 - 60_000;
  console.log("🔄 Zoho token OK", expiresIn);
  return zohoCache.token;
}

async function zohoUpsertLead(d, phone, retries = 1) {
  if (!REQUIRE_ZOHO) return;
  try {
    const token = await getZohoToken();
    const url = `${ZOHO.API_DOMAIN}/crm/v2/Leads/upsert`;

    const payload = {
      data: [
        {
          Last_Name: d.name || `Cliente WhatsApp ${String(phone).slice(-4)}`,
          Mobile: phone,
          Lead_Source: "WhatsApp IA",
          Company: "Activa Inversiones Lead",
          Description: `Producto: ${d.product} | Medidas: ${d.measures} | Vidrio: ${d.glass} | Instalación: ${d.install} | Comuna/Dirección: ${d.address || d.comuna} | Notas: ${d.notes || ""}`,
        },
      ],
      duplicate_check_fields: ["Mobile"],
      trigger: ["workflow"],
    };

    const r = await axios.post(url, payload, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      timeout: 15000,
    });

    console.log("✅ Zoho upsert", r.data?.data?.[0]?.code || "SUCCESS");
  } catch (e) {
    const status = e?.response?.status;
    if (status === 401 && retries > 0) {
      console.warn("🔁 Zoho 401 retry");
      zohoCache = { token: "", expiresAt: 0 };
      await sleep(500);
      return zohoUpsertLead(d, phone, retries - 1);
    }
    console.warn("⚠️ Zoho upsert fail", status, e?.response?.data || e.message);
  }
}

// ---------- Routes ----------
app.get("/health", (req, res) => res.status(200).send("ok"));
// ===== ZOHO AUTH / CALLBACK / TEST =====
app.get("/zoho/auth", (req, res) => {
  if (!ZOHO.CLIENT_ID || !ZOHO.CLIENT_SECRET || !ZOHO.REDIRECT_URI) {
    return res.status(500).send("Faltan env Zoho: ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REDIRECT_URI");
  }

  const scope = encodeURIComponent("ZohoCRM.modules.ALL,ZohoCRM.users.ALL");
  const url =
    `${ZOHO.ACCOUNTS_DOMAIN}/oauth/v2/auth` +
    `?scope=${scope}` +
    `&client_id=${encodeURIComponent(ZOHO.CLIENT_ID)}` +
    `&response_type=code` +
    `&access_type=offline` +
    `&prompt=consent` +
    `&redirect_uri=${encodeURIComponent(ZOHO.REDIRECT_URI)}`;

  return res.redirect(url);
});

app.get("/zoho/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send("Falta ?code en callback");

    const params = new URLSearchParams();
    params.set("grant_type", "authorization_code");
    params.set("client_id", ZOHO.CLIENT_ID);
    params.set("client_secret", ZOHO.CLIENT_SECRET);
    params.set("redirect_uri", ZOHO.REDIRECT_URI);
    params.set("code", code);

    const tokenUrl = `${ZOHO.ACCOUNTS_DOMAIN}/oauth/v2/token`;
    const { data } = await axios.post(tokenUrl, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    });

    return res.status(200).json({
      ok: true,
      got_refresh_token: Boolean(data.refresh_token),
      refresh_token: data.refresh_token || null,
      access_token_preview: data.access_token ? data.access_token.slice(0, 8) + "..." : null,
      msg: "Copia refresh_token y pégalo en Railway como ZOHO_REFRESH_TOKEN",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.response?.data || e.message });
  }
});

app.get("/zoho/test", async (req, res) => {
  try {
    if (!ZOHO.REFRESH_TOKEN) return res.status(400).send("Falta ZOHO_REFRESH_TOKEN. Primero /zoho/auth");

    const tokenUrl = `${ZOHO.ACCOUNTS_DOMAIN}/oauth/v2/token`;
    const params = new URLSearchParams();
    params.set("grant_type", "refresh_token");
    params.set("client_id", ZOHO.CLIENT_ID);
    params.set("client_secret", ZOHO.CLIENT_SECRET);
    params.set("refresh_token", ZOHO.REFRESH_TOKEN);

    const { data: t } = await axios.post(tokenUrl, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    });

    const access = t.access_token;
    const url = `${ZOHO.API_DOMAIN}/crm/v2/users?type=CurrentUser`;

    const { data } = await axios.get(url, {
      headers: { Authorization: `Zoho-oauthtoken ${access}` },
      timeout: 15000,
    });

    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.response?.data || e.message });
  }
});


// Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === META.VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// Webhook receiver
app.post("/webhook", async (req, res) => {
  // ACK inmediato
  res.sendStatus(200);

  // Firma Meta (si APP_SECRET está seteado)
  if (!verifyMetaSignature(req)) {
    console.warn("⚠️ META signature fail");
    return;
  }

  const incoming = extractIncoming(req.body);
  if (!incoming.ok) {
    if (incoming.reason !== "status_update") console.log("⏭️ skip", incoming.reason);
    return;
  }

  const { waId, msgId, type } = incoming;

  if (isDuplicateMsg(msgId)) {
    console.log("⏭️ duplicate msgId", msgId);
    return;
  }

  const rateCheck = checkRate(waId);
  if (!rateCheck.allowed) {
    await waSendText(waId, rateCheck.msg);
    return;
  }

  const release = await acquireLock(waId);
  try {
    const session = getSession(waId);
    session.lastUserAt = Date.now();

    // Construimos userText enriquecido (texto + transcripción + vision + pdf text)
    let userText = incoming.text;

    // AUDIO
    if (type === "audio" && incoming.audioId) {
      console.log("🎧 AUDIO_IN", { waId, msgId, audioId: incoming.audioId });
      const meta = await waGetMediaMeta(incoming.audioId);
      const { buffer, mime } = await waDownloadMedia(meta.url);
      const transcript = await transcribeAudio(buffer, mime);
      console.log("📝 AUDIO_TXT", transcript);
      userText = transcript ? `Cliente envió audio (transcrito): ${transcript}` : "Cliente envió un audio pero no se pudo transcribir.";
    }

    // IMAGE
    if (type === "image" && incoming.imageId) {
      console.log("🖼️ IMG_IN", { waId, msgId, imageId: incoming.imageId });
      const meta = await waGetMediaMeta(incoming.imageId);
      const { buffer, mime } = await waDownloadMedia(meta.url);
      const imgText = await describeImage(buffer, mime);
      console.log("🧠 IMG_TXT", imgText);
      userText = `Cliente envió una imagen. Interpretación: ${imgText}`;
    }

    // PDF (document)
    if (type === "document" && incoming.docId) {
      console.log("📄 DOC_IN", { waId, msgId, docId: incoming.docId, mime: incoming.docMime, name: incoming.docFilename });
      const meta = await waGetMediaMeta(incoming.docId);
      const { buffer, mime } = await waDownloadMedia(meta.url);

      if ((incoming.docMime || mime) === "application/pdf") {
        const pdfText = await parsePdfToText(buffer);
        console.log("📄 PDF_TXT_LEN", pdfText.length);
        userText = `Cliente envió un PDF. Texto extraído (recortado):\n${pdfText}`;
      } else {
        // si no es PDF, pedir texto
        await waSendText(waId, "Recibí el archivo. ¿Me puedes escribir el detalle (producto, medidas, comuna, vidrio e instalación) para cotizar?");
        return;
      }
    }

    console.log("📩 IN", { waId, msgId, type, userTextPreview: String(userText).slice(0, 120) });

    // IA (tools)
    const aiMsg = await runAI(session, userText);

    let triggerPDF = false;

    // Tool calls
    if (aiMsg.tool_calls?.length) {
      for (const tc of aiMsg.tool_calls) {
        if (tc.type !== "function") continue;
        if (tc.function?.name !== "update_customer_data") continue;

        let args = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }

        session.data = { ...session.data, ...args };
        if (args.wants_pdf === true) triggerPDF = true;

        // Follow-up para texto final
        const follow = await openai.chat.completions.create({
          model: AI_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "system", content: `Memoria actual: ${JSON.stringify(session.data)}` },
            ...session.history.slice(-6),
            { role: "user", content: userText },
            aiMsg,
            { role: "tool", tool_call_id: tc.id, content: "OK, datos guardados." },
          ],
          temperature: 0.3,
          max_tokens: 260,
        });

        const finalText = follow.choices?.[0]?.message?.content?.trim();
        if (finalText) {
          await waSendText(waId, finalText);
          session.history.push({ role: "user", content: userText });
          session.history.push({ role: "assistant", content: finalText });
        }
      }
    } else {
      const reply = (aiMsg.content || "").trim();
      if (reply) {
        await waSendText(waId, reply);
        session.history.push({ role: "user", content: userText });
        session.history.push({ role: "assistant", content: reply });
      }
    }

    // Zoho (async)
    zohoUpsertLead(session.data, waId).catch(() => {});

    // PDF saliente
    const complete = isComplete(session.data);
    const askedPdf = /\bpdf\b/i.test(incoming.text) || /cotiz/i.test(incoming.text);
    const shouldSend = complete && !session.pdfSent && (triggerPDF || askedPdf || AUTO_SEND_PDF_WHEN_READY);

    if (shouldSend) {
      await waSendText(waId, "Perfecto, ya tengo todo. Te envío el PDF referencial ahora.");
      const pdf = await createQuotePdf(session.data);
      const mediaId = await waUploadPdf(pdf);
      await waSendPdfById(waId, mediaId, "Aquí tienes tu cotización referencial 📄");
      session.pdfSent = true;
    }
  } catch (e) {
    console.error("🔥 webhook error", e?.response?.data || e.message);
  } finally {
    release();
  }
});

// ---------- Boot ----------
console.log(`SERVER_OK port=${PORT} tz=${TZ}`);
console.log(`[INFO] META_VER=${META.GRAPH_VERSION}`);
console.log(`[INFO] PHONE_NUMBER_ID=${META.PHONE_NUMBER_ID}`);
console.log(`[INFO] MODEL=${AI_MODEL}`);
console.log(`[INFO] STT_MODEL=${STT_MODEL}`);
console.log(`[INFO] REQUIRE_ZOHO=${REQUIRE_ZOHO}`);
console.log(`[INFO] AUTO_SEND_PDF_WHEN_READY=${AUTO_SEND_PDF_WHEN_READY}`);

app.listen(PORT, () => console.log(`🚀 Server activo en puerto ${PORT}`));
