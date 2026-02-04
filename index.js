// index.js — WhatsApp IA + Zoho CRM
// Ferrari 6.1.1 — Producción estable (Fix sintaxis + Audio + Imagen + Follow-up humano)
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
const pdfParse = require("pdf-parse");

const app = express();

/* ================= RAW BODY META ================= */
app.use(
  express.json({
    limit: "20mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

/* ================= ENV ================= */
const PORT = process.env.PORT || 8080;
const TZ = process.env.TZ || "America/Santiago";

const META = {
  GRAPH_VERSION: process.env.META_GRAPH_VERSION || "v22.0",
  TOKEN: process.env.WHATSAPP_TOKEN,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  APP_SECRET: process.env.APP_SECRET || "",
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AI_MODEL = process.env.AI_MODEL_OPENAI || "gpt-4o-mini";
const STT_MODEL = process.env.AI_MODEL_STT || "whisper-1";

const AUTO_SEND_PDF_WHEN_READY = false;

/* ================= ZOHO ================= */
const REQUIRE_ZOHO = String(process.env.REQUIRE_ZOHO || "true") === "true";
const ZOHO = {
  CLIENT_ID: process.env.ZOHO_CLIENT_ID,
  CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET,
  REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN,
  API_DOMAIN: process.env.ZOHO_API_DOMAIN || "https://www.zohoapis.com",
  ACCOUNTS_DOMAIN: process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.com",
  DEAL_PHONE_FIELD: process.env.ZOHO_DEAL_PHONE_FIELD || "WhatsApp_Phone",
  DEFAULT_ACCOUNT_NAME: process.env.ZOHO_DEFAULT_ACCOUNT_NAME || "Clientes WhatsApp IA",
};

/* ================= EMPRESA ================= */
const COMPANY = {
  NAME: process.env.COMPANY_NAME || "Activa Inversiones",
  EMAIL: process.env.COMPANY_EMAIL || "ventas@activa.cl",
};

/* ================= VALIDACIÓN ENV ================= */
function assertEnv() {
  const missing = [];
  if (!META.TOKEN) missing.push("WHATSAPP_TOKEN");
  if (!META.PHONE_NUMBER_ID) missing.push("PHONE_NUMBER_ID");
  if (!META.VERIFY_TOKEN) missing.push("VERIFY_TOKEN");
  if (!OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (missing.length) {
    console.error("[FATAL] Missing ENV:", missing.join(", "));
    process.exit(1);
  }
}
assertEnv();

/* ================= OPENAI ================= */
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ================= UTIL ================= */
function normalizeCLPhone(raw) {
  const s = String(raw || "").replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("56")) return `+${s}`;
  return `+${s}`;
}

/* ================= WHATSAPP ================= */
const waBase = () => `https://graph.facebook.com/${META.GRAPH_VERSION}`;

async function waSendText(to, text) {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  await axios.post(
    url,
    { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
    { headers: { Authorization: `Bearer ${META.TOKEN}` } }
  );
}

async function waMarkReadAndTyping(waId, messageId) {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  if (messageId) {
    await axios.post(
      url,
      { messaging_product: "whatsapp", status: "read", message_id: messageId },
      { headers: { Authorization: `Bearer ${META.TOKEN}` } }
    );
  }
  if (waId) {
    await axios.post(
      url,
      { messaging_product: "whatsapp", to: waId, typing_indicator: { type: "text" } },
      { headers: { Authorization: `Bearer ${META.TOKEN}` } }
    );
  }
}

/* ================= MEDIA ================= */
async function transcribeAudio(buffer, mime) {
  const file = await toFile(buffer, "audio.ogg", { type: mime });
  const r = await openai.audio.transcriptions.create({
    model: STT_MODEL,
    file,
    language: "es",
  });
  return (r.text || "").trim();
}

async function describeImage(buffer, mime) {
  const b64 = buffer.toString("base64");
  const dataUrl = `data:${mime};base64,${b64}`;
  const resp = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe la imagen para cotizar ventanas." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  return resp.choices[0].message.content.trim();
}

/* ================= SESSION ================= */
const sessions = new Map();
function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      data: { product: "", measures: "", glass: "", wants_pdf: false },
      history: [],
      pdfSent: false,
    });
  }
  return sessions.get(id);
}

/* ================= PROMPT ================= */
const SYSTEM_PROMPT = `
Eres el vendedor experto de ${COMPANY.NAME}.
Vendes con enfoque de VENTA CONSULTIVA.
Hablas humano, profesional, chileno.
Nunca inventas precios.
`.trim();

async function runAI(session, userText) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...session.history.slice(-12),
    { role: "user", content: userText },
  ];
  const r = await openai.chat.completions.create({
    model: AI_MODEL,
    messages,
    temperature: 0.3,
  });
  return r.choices[0].message;
}

/* ================= WEBHOOK ================= */
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === META.VERIFY_TOKEN)
    return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return;

  const waId = msg.from;
  const msgId = msg.id;
  let userText = msg.text?.body || "";

  const session = getSession(waId);
  await waMarkReadAndTyping(waId, msgId);

  session.history.push({ role: "user", content: userText });

  const aiMsg = await runAI(session, userText);
  const reply = aiMsg.content.trim();

  await waSendText(waId, reply);
  session.history.push({ role: "assistant", content: reply });
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log("🚀 Ferrari 6.1.1 RUNNING");
});
