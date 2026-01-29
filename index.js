// index.js — WhatsApp IA + PDF + Zoho (Production-Ready)
// Node 18+ | Railway | ESM
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import crypto from "crypto";
import FormData from "form-data";
import PDFDocument from "pdfkit";
import { OpenAI } from "openai";

dotenv.config();

const app = express();

// ===== Meta sends JSON =====
app.use(express.json({ limit: "5mb" }));

// =====================
// ENV
// =====================
const PORT = process.env.PORT || 8080;
const TZ = process.env.TZ || "America/Santiago";

const META = {
  GRAPH_VERSION: process.env.META_GRAPH_VERSION || "v24.0",
  TOKEN: process.env.WHATSAPP_TOKEN,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID_FALLBACK,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  APP_SECRET: process.env.APP_SECRET || "", // optional (recommended)
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const AI_MODEL_TEXT = process.env.AI_MODEL_OPENAI || "gpt-4.1-mini";

const FEATURES = {
  TYPING_SIMULATION: String(process.env.TYPING_SIMULATION || "true") === "true",
  TYPING_MIN_MS: Number(process.env.TYPING_MIN_MS || 500),
  TYPING_MAX_MS: Number(process.env.TYPING_MAX_MS || 1600),
  WAIT_AFTER_LAST_USER_MESSAGE_MS: Number(process.env.WAIT_AFTER_LAST_USER_MESSAGE_MS || 900),
  ENABLE_PDF_QUOTES: String(process.env.ENABLE_PDF_QUOTES || "true") === "true",
  AUTO_SEND_PDF_WHEN_READY: String(process.env.AUTO_SEND_PDF_WHEN_READY || "true") === "true",
  DONT_SHOW_PRICES_IN_CHAT: String(process.env.DONT_SHOW_PRICES_IN_CHAT || "true") === "true",
};

// Zoho
const ZOHO = {
  CLIENT_ID: process.env.ZOHO_CLIENT_ID,
  CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET,
  REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN,
  REDIRECT_URI: process.env.ZOHO_REDIRECT_URI, // recomendado aunque refresh no siempre lo exige
  DC: process.env.ZOHO_DC || "com",
  API_DOMAIN: process.env.ZOHO_API_DOMAIN || "https://www.zohoapis.com",
  ACCOUNTS_DOMAIN: process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.com",
};

// =====================
// HARD FAIL if missing critical env
// =====================
function assertEnv() {
  const missing = [];
  if (!META.TOKEN) missing.push("WHATSAPP_TOKEN");
  if (!META.PHONE_NUMBER_ID) missing.push("PHONE_NUMBER_ID");
  if (!META.VERIFY_TOKEN) missing.push("VERIFY_TOKEN");
  if (!OPENAI_API_KEY) missing.push("OPENAI_API_KEY");

  // Zoho is optional at runtime (you can run bot without Zoho),
  // but you already want it connected, so we validate it too:
  if (!ZOHO.CLIENT_ID) missing.push("ZOHO_CLIENT_ID");
  if (!ZOHO.CLIENT_SECRET) missing.push("ZOHO_CLIENT_SECRET");
  if (!ZOHO.REFRESH_TOKEN) missing.push("ZOHO_REFRESH_TOKEN");

  if (missing.length) {
    console.error("[FATAL] Missing ENV:", missing.join(", "));
    process.exit(1);
  }
}
assertEnv();

// =====================
// OpenAI client
// =====================
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// =====================
// Bot profile (EDITABLE)
// =====================
// Aquí cambias “cómo habla”, tono, reglas, etc.
const BOT_PROFILE = `
Eres el asistente comercial de Activa Inversiones (ventanas/puertas PVC y aluminio en Temuco y La Araucanía).
Objetivo: atender rápido, humano y técnico, y cerrar visita/medición o enviar cotización PDF.

REGLAS DE COMUNICACIÓN:
- Responde corto (1–4 líneas). Nada de discursos.
- No repitas preguntas si ya tienes el dato.
- Si el cliente pide “PDF”, envía PDF si tienes: producto + medidas + comuna/dirección + teléfono.
- No muestres precios en el chat. Si preguntan por precio: “Te lo envío en PDF para que quede formal”.
- Prioriza: (1) confirmar producto y medidas, (2) comuna/dirección, (3) teléfono, (4) correo solo si es necesario.
- Si ya tienes teléfono (viene por WhatsApp), no lo pidas.
- Si el usuario pide visita: agenda (día/horario) y confirma dirección.
- Sé técnico cuando corresponde: U-value, Low-E, termopanel, herrajes, etc., pero siempre breve.

DATOS QUE DEBES CAPTURAR (solo si faltan):
1) comuna o dirección
2) tipo de producto y apertura
3) medidas (ancho x alto)
4) vidrio (normal / termopanel / Low-E)
5) instalación (sí/no) y si es obra nueva o recambio

FORMATO:
- Haz 1 pregunta a la vez.
- Si falta algo, pregunta SOLO lo que falta.
`;

// =====================
// In-memory session store (simple + efectivo)
// =====================
const sessions = new Map();
// session shape:
// { lastUserAt, data: {name?, address?, comuna?, email?, product?, measures?, glass?, install?}, lastBotMsg, pdfSent }

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, { lastUserAt: 0, data: {}, lastBotMsg: "", pdfSent: false });
  }
  return sessions.get(waId);
}

function now() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// typing simulation (no “typing indicator” oficial; hacemos delay realista)
async function simulateTyping() {
  if (!FEATURES.TYPING_SIMULATION) return;
  const ms =
    FEATURES.TYPING_MIN_MS +
    Math.floor(Math.random() * (FEATURES.TYPING_MAX_MS - FEATURES.TYPING_MIN_MS + 1));
  await sleep(ms);
}

// =====================
// WhatsApp helpers
// =====================
const graphBase = `https://graph.facebook.com/${META.GRAPH_VERSION}/${META.PHONE_NUMBER_ID}`;

async function waMarkRead(messageId) {
  try {
    await axios.post(
      `${graphBase}/messages`,
      { messaging_product: "whatsapp", status: "read", message_id: messageId },
      { headers: { Authorization: `Bearer ${META.TOKEN}` } }
    );
  } catch (e) {
    console.warn("[WA] mark_read failed:", e?.response?.data || e.message);
  }
}

async function waSendText(to, text) {
  await axios.post(
    `${graphBase}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    },
    { headers: { Authorization: `Bearer ${META.TOKEN}` } }
  );
}

async function waUploadMedia(buffer, filename, mimeType) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buffer, { filename, contentType: mimeType });

  const res = await axios.post(`${graphBase}/media`, form, {
    headers: { Authorization: `Bearer ${META.TOKEN}`, ...form.getHeaders() },
    maxBodyLength: Infinity,
  });

  return res.data.id;
}

async function waSendDocumentById(to, mediaId, filename, caption) {
  await axios.post(
    `${graphBase}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: {
        id: mediaId,
        filename,
        caption: caption || undefined,
      },
    },
    { headers: { Authorization: `Bearer ${META.TOKEN}` } }
  );
}

// =====================
// Zoho token (refresh)
// =====================
let zohoAccessToken = "";
let zohoExpiresAt = 0;

async function getZohoAccessToken() {
  const safetyMs = 60_000;
  if (zohoAccessToken && now() < zohoExpiresAt - safetyMs) return zohoAccessToken;

  const url = `${ZOHO.ACCOUNTS_DOMAIN}/oauth/v2/token`;
  const params = new URLSearchParams();
  params.append("refresh_token", ZOHO.REFRESH_TOKEN);
  params.append("client_id", ZOHO.CLIENT_ID);
  params.append("client_secret", ZOHO.CLIENT_SECRET);
  params.append("grant_type", "refresh_token");

  const { data } = await axios.post(url, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (!data.access_token) throw new Error(`Zoho token response missing access_token: ${JSON.stringify(data)}`);

  zohoAccessToken = data.access_token;
  const expiresInSec = Number(data.expires_in || 3600);
  zohoExpiresAt = now() + expiresInSec * 1000;

  console.log("ZOHO_TOKEN_OK expiresIn", expiresInSec);
  return zohoAccessToken;
}

// Minimal example: create/update Lead (puedes ampliar después)
async function zohoUpsertLead({ name, phone, email, address, notes }) {
  try {
    const token = await getZohoAccessToken();
    const url = `${ZOHO.API_DOMAIN}/crm/v2/Leads/upsert`;
    const payload = {
      data: [
        {
          Last_Name: name || phone || "Lead WhatsApp",
          Mobile: phone,
          Email: email || undefined,
          Street: address || undefined,
          Description: notes || undefined,
        },
      ],
      duplicate_check_fields: ["Mobile", "Email"],
    };

    const { data } = await axios.post(url, payload, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });

    return data;
  } catch (e) {
    console.warn("[ZOHO] upsert lead failed:", e?.response?.data || e.message);
    return null;
  }
}

// =====================
// PDF generation
// =====================
function buildQuotePdfBuffer({ customerName, phone, address, product, measures, glass, install }) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fontSize(18).text("Cotización Referencial — Activa Inversiones", { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#444").text(`Fecha: ${new Date().toLocaleString("es-CL", { timeZone: TZ })}`);
    doc.moveDown();

    doc.fillColor("#000").fontSize(12).text("Datos del cliente");
    doc.moveDown(0.3);
    doc.fontSize(11);
    doc.text(`Nombre: ${customerName || "-"}`);
    doc.text(`Teléfono: ${phone || "-"}`);
    doc.text(`Dirección/Comuna: ${address || "-"}`);

    doc.moveDown();
    doc.fontSize(12).text("Detalle técnico solicitado");
    doc.moveDown(0.3);
    doc.fontSize(11);
    doc.text(`Producto: ${product || "-"}`);
    doc.text(`Medidas: ${measures || "-"}`);
    doc.text(`Vidrio: ${glass || "-"}`);
    doc.text(`Instalación: ${install || "-"}`);

    doc.moveDown();
    doc.fontSize(10).fillColor("#444").text(
      "Nota: Valores finales y plazos se confirman tras visita/medición. Documento generado automáticamente para formalizar la solicitud."
    );

    doc.end();
  });
}

// =====================
// AI Orchestration
// =====================
function extractQuickFacts(text) {
  const t = (text || "").toLowerCase();

  const wantsPdf = /\bpdf\b/.test(t) || /cotiz/.test(t);
  const wantsVisit = /visita|medici|levantamiento|agendar/.test(t);

  return { wantsPdf, wantsVisit };
}

function missingFields(s) {
  const d = s.data || {};
  // teléfono viene de WhatsApp (waId), así que no lo pedimos como “campo”
  const missing = [];
  if (!d.product) missing.push("product");
  if (!d.measures) missing.push("measures");
  if (!d.glass) missing.push("glass");
  if (!d.address && !d.comuna) missing.push("address");
  if (!d.install) missing.push("install");
  return missing;
}

async function aiReply({ waId, userText, session }) {
  const d = session.data;

  const messages = [
    { role: "system", content: BOT_PROFILE.trim() },
    {
      role: "system",
      content:
        `Contexto (memoria corta): ${JSON.stringify(d)}\n` +
        `Regla: No repitas datos ya presentes. Si falta algo, pregunta SOLO 1 cosa.`,
    },
    { role: "user", content: userText },
  ];

  const resp = await openai.chat.completions.create({
    model: AI_MODEL_TEXT,
    messages,
    temperature: 0.3,
  });

  return (resp.choices?.[0]?.message?.content || "").trim();
}

// =====================
// Signature verification (optional, but recommended)
// =====================
function verifyMetaSignature(req) {
  if (!META.APP_SECRET) return true; // not enabled
  const signature = req.get("X-Hub-Signature-256");
  if (!signature) return false;

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", META.APP_SECRET).update(JSON.stringify(req.body)).digest("hex");

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// =====================
// Routes
// =====================
app.get("/health", (req, res) => res.status(200).send("ok"));

app.get("/zoho/test", async (req, res) => {
  try {
    const token = await getZohoAccessToken();
    // example call: users (simple sanity)
    const { data } = await axios.get(`${ZOHO.API_DOMAIN}/crm/v2/users?type=CurrentUser`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    res.json({ ok: true, api_domain: ZOHO.API_DOMAIN, expires_in: Math.floor((zohoExpiresAt - now()) / 1000), sample: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.response?.data || e.message });
  }
});

// Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === META.VERIFY_TOKEN) {
    console.log("WEBHOOK_VERIFY_OK");
    return res.status(200).send(challenge);
  }
  console.log("WEBHOOK_VERIFY_FAIL");
  return res.sendStatus(403);
});

// Webhook receiver
app.post("/webhook", async (req, res) => {
  // Always respond quickly
  res.sendStatus(200);

  try {
    if (!verifyMetaSignature(req)) {
      console.warn("META_SIGNATURE_FAIL");
      return;
    }

    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    const message = value?.messages?.[0];
    if (!message) return;

    const waId = message.from; // phone of user
    const msgId = message.id;

    const text =
      message.type === "text" ? (message.text?.body || "") :
      message.type === "button" ? (message.button?.text || "") :
      message.type === "interactive" ? JSON.stringify(message.interactive) :
      "[mensaje no-texto]";

    const session = getSession(waId);
    session.lastUserAt = now();

    // mark read early (feels human)
    await waMarkRead(msgId);

    // store some quick facts
    // (aquí podrías meter extractores de dirección/medidas si quieres después)
    const { wantsPdf, wantsVisit } = extractQuickFacts(text);

    // IMPORTANT: wait a bit to avoid “instant bot”
    await sleep(FEATURES.WAIT_AFTER_LAST_USER_MESSAGE_MS);
    await simulateTyping();

    // Decide PDF flow
    const miss = missingFields(session);
    const haveEnoughForPdf = miss.length === 0;

    // If user asks PDF and we have everything, send PDF (and do not keep asking)
    if (FEATURES.ENABLE_PDF_QUOTES && wantsPdf && haveEnoughForPdf && !session.pdfSent) {
      const pdf = await buildQuotePdfBuffer({
        customerName: session.data.name || "Cliente",
        phone: waId,
        address: session.data.address || session.data.comuna || "",
        product: session.data.product,
        measures: session.data.measures,
        glass: session.data.glass,
        install: session.data.install,
      });

      const mediaId = await waUploadMedia(pdf, "cotizacion.pdf", "application/pdf");
      await waSendDocumentById(
        waId,
        mediaId,
        "cotizacion.pdf",
        "Adjunto PDF referencial. Si confirmas dirección y horario, coordinamos visita/medición."
      );

      session.pdfSent = true;

      // Zoho upsert (opcional)
      await zohoUpsertLead({
        name: session.data.name,
        phone: waId,
        email: session.data.email,
        address: session.data.address || session.data.comuna,
        notes: `Solicitud PDF. Producto=${session.data.product} Medidas=${session.data.measures} Vidrio=${session.data.glass} Instalación=${session.data.install}`,
      });

      return;
    }

    // If wants visit: ask only address or schedule
    if (wantsVisit) {
      if (!session.data.address && !session.data.comuna) {
        await waSendText(waId, "Perfecto. ¿Me confirmas la comuna y dirección exacta para coordinar la visita/medición?");
        return;
      }
      await waSendText(waId, "Listo. ¿Qué día y rango horario te acomoda para la visita (mañana/tarde) en esa dirección?");
      return;
    }

    // Otherwise use AI reply (short + non repetitive)
    const reply = await aiReply({ waId, userText: text, session });

    // Safety: prevent repeating same bot message
    if (reply && reply !== session.lastBotMsg) {
      await waSendText(waId, reply);
      session.lastBotMsg = reply;
    }

    // Lightweight Zoho logging
    await zohoUpsertLead({
      name: session.data.name,
      phone: waId,
      email: session.data.email,
      address: session.data.address || session.data.comuna,
      notes: `Último mensaje: ${text}`,
    });
  } catch (e) {
    console.error("WEBHOOK_HANDLER_ERR:", e?.response?.data || e.message);
  }
});

// =====================
// Boot
// =====================
console.log(`SERVER_OK port=${PORT} tz=${TZ}`);
console.log(`[INFO] META_VER=${META.GRAPH_VERSION}`);
console.log(`[INFO] AI_MODEL_TEXT=${AI_MODEL_TEXT}`);
console.log(`[INFO] TYPING_SIMULATION=${FEATURES.TYPING_SIMULATION}`);

app.listen(PORT, () => {
  console.log(`[INFO] Server running on port ${PORT}`);
});
