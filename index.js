// index.js — WhatsApp IA + Zoho CRM
// Ferrari 6.1.1 — Producción FINAL ESTABLE
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

// ================= RAW BODY (Meta Signature) =================
app.use(
  express.json({
    limit: "20mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ================= ENV =================
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

const REQUIRE_ZOHO = String(process.env.REQUIRE_ZOHO || "true") === "true";

const ZOHO = {
  CLIENT_ID: process.env.ZOHO_CLIENT_ID,
  CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET,
  REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN,
  API_DOMAIN: process.env.ZOHO_API_DOMAIN || "https://www.zohoapis.com",
  ACCOUNTS_DOMAIN: process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.com",
  DEAL_PHONE_FIELD: process.env.ZOHO_DEAL_PHONE_FIELD || "WhatsApp_Phone",
  DEFAULT_ACCOUNT_NAME: "Clientes WhatsApp IA",
};

const COMPANY = {
  NAME: "Activa Inversiones",
};

// ================= VALIDACIÓN =================
["WHATSAPP_TOKEN", "PHONE_NUMBER_ID", "VERIFY_TOKEN", "OPENAI_API_KEY"].forEach(
  (v) => {
    if (!process.env[v]) {
      console.error("❌ ENV faltante:", v);
      process.exit(1);
    }
  }
);

// ================= OPENAI =================
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ================= UTIL =================
function normalizeCLPhone(p) {
  if (!p) return "";
  return p.startsWith("+") ? p : `+${p}`;
}

function formatDateCL(date = new Date()) {
  return date.toLocaleDateString("es-CL", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function normalizeMeasures(txt) {
  const nums = txt.match(/(\d+([.,]\d+)?)/g);
  if (!nums || nums.length < 2) return null;
  let a = parseFloat(nums[0].replace(",", "."));
  let b = parseFloat(nums[1].replace(",", "."));
  if (a < 10) a *= 1000;
  if (b < 10) b *= 1000;
  return { ancho_mm: Math.round(a), alto_mm: Math.round(b) };
}

function calculateInternalPrice({ ancho_mm, alto_mm }) {
  const area = (ancho_mm * alto_mm) / 1_000_000;
  return Math.max(Math.round(area * 120000), 50000);
}

// ================= WHATSAPP =================
const waBase = () => `https://graph.facebook.com/${META.GRAPH_VERSION}`;

async function waSendText(to, text) {
  await axios.post(
    `${waBase()}/${META.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    },
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
      {
        messaging_product: "whatsapp",
        to: waId,
        typing_indicator: { type: "text" },
      },
      { headers: { Authorization: `Bearer ${META.TOKEN}` } }
    );
  }
}

// ================= PDF =================
async function createQuotePdf(data) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fontSize(18).text(COMPANY.NAME);
    doc.moveDown();
    doc.fontSize(12).text(`Fecha: ${formatDateCL()}`);
    doc.moveDown();
    doc.text(`Producto: ${data.product}`);
    doc.text(`Medidas: ${data.measures}`);
    doc.text(`Precio ref.: $${data.internal_price.toLocaleString("es-CL")} + IVA`);
    doc.end();
  });
}

// ================= ZOHO =================
let zohoToken = "";
let zohoExp = 0;

async function getZohoToken() {
  if (!REQUIRE_ZOHO) return "";
  if (zohoToken && Date.now() < zohoExp) return zohoToken;

  const r = await axios.post(
    `${ZOHO.ACCOUNTS_DOMAIN}/oauth/v2/token`,
    new URLSearchParams({
      refresh_token: ZOHO.REFRESH_TOKEN,
      client_id: ZOHO.CLIENT_ID,
      client_secret: ZOHO.CLIENT_SECRET,
      grant_type: "refresh_token",
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  zohoToken = r.data.access_token;
  zohoExp = Date.now() + r.data.expires_in * 1000 - 60000;
  return zohoToken;
}

// ================= SESSION =================
const sessions = new Map();
function getSession(id) {
  if (!sessions.has(id))
    sessions.set(id, { data: {}, history: [], pdfSent: false });
  return sessions.get(id);
}

// ================= WEBHOOK =================
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
  const text = msg.text?.body || "";

  const session = getSession(waId);
  await waMarkReadAndTyping(waId, msgId);

  session.history.push(text);

  if (!session.data.product && /ventana/i.test(text))
    session.data.product = "Ventana PVC";
  if (!session.data.measures && /\d/.test(text))
    session.data.measures = text;

  if (session.data.product && session.data.measures && !session.data.internal_price) {
    const m = normalizeMeasures(session.data.measures);
    if (m) session.data.internal_price = calculateInternalPrice(m);
  }

  if (session.data.internal_price && /cotiz/i.test(text) && !session.pdfSent) {
    const pdf = await createQuotePdf(session.data);
    await waSendText(
      waId,
      `📄 Cotización lista.\nPrecio referencial: $${session.data.internal_price.toLocaleString(
        "es-CL"
      )} + IVA\n\nEquipo Alfa te contactará.`
    );
    session.pdfSent = true;
    return;
  }

  await waSendText(
    waId,
    "Perfecto 👍 cuéntame medidas y tipo de ventana para afinar la cotización."
  );
});

// ================= START =================
app.listen(PORT, () => {
  console.log(`🚀 Ferrari 6.1.1 corriendo en puerto ${PORT}`);
});
