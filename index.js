// index.js — WhatsApp IA + Zoho CRM
// Ferrari 6.1.2 — Producción Estable (Railway OK, Anti-Spam, Venta Consultiva)
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

/* =========================================================
   RAW BODY (Meta signature)
========================================================= */
app.use(
  express.json({
    limit: "20mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

/* =========================================================
   ENV
========================================================= */
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
  DEFAULT_ACCOUNT_NAME: process.env.ZOHO_DEFAULT_ACCOUNT_NAME || "Clientes WhatsApp IA",
};

const COMPANY = {
  NAME: process.env.COMPANY_NAME || "Activa Inversiones",
  EMAIL: process.env.COMPANY_EMAIL || "ventas@activa.cl",
};

/* =========================================================
   VALIDACIÓN ENV
========================================================= */
["WHATSAPP_TOKEN", "PHONE_NUMBER_ID", "VERIFY_TOKEN", "OPENAI_API_KEY"].forEach(
  (k) => {
    if (!process.env[k]) {
      console.error(`[FATAL] Falta variable ENV: ${k}`);
      process.exit(1);
    }
  }
);

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* =========================================================
   HELPERS
========================================================= */
function normalizeCLPhone(raw) {
  const s = String(raw || "").replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("56")) return `+${s}`;
  return `+56${s}`;
}

function formatDateCL(date = new Date()) {
  return date.toLocaleDateString("es-CL", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function normalizeMeasures(text) {
  const nums = String(text || "").match(/(\d+([.,]\d+)?)/g);
  if (!nums || nums.length < 2) return null;
  let a = parseFloat(nums[0].replace(",", "."));
  let b = parseFloat(nums[1].replace(",", "."));
  if (a < 10) a *= 1000;
  if (b < 10) b *= 1000;
  return { ancho_mm: Math.round(a), alto_mm: Math.round(b) };
}

function calculateInternalPrice({ ancho_mm, alto_mm, glass }) {
  const area = (ancho_mm * alto_mm) / 1_000_000;
  let base = area * 120000;
  if (/termopanel|dvh|6-12-6|low/i.test(glass || "")) base *= 1.25;
  return Math.max(Math.round(base), 50000);
}

/* =========================================================
   WHATSAPP
========================================================= */
const waBase = () => `https://graph.facebook.com/${META.GRAPH_VERSION}`;

function verifyMetaSignature(req) {
  if (!META.APP_SECRET) return true;
  const sig = req.get("x-hub-signature-256");
  if (!sig || !req.rawBody) return false;
  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", META.APP_SECRET)
      .update(req.rawBody)
      .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(sig),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

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

async function waUploadPdf(buffer) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buffer, { filename: "Cotizacion.pdf" });

  const r = await axios.post(
    `${waBase()}/${META.PHONE_NUMBER_ID}/media`,
    form,
    { headers: { Authorization: `Bearer ${META.TOKEN}`, ...form.getHeaders() } }
  );
  return r.data.id;
}

async function waSendPdf(to, mediaId) {
  await axios.post(
    `${waBase()}/${META.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: { id: mediaId, filename: "Cotizacion.pdf" },
    },
    { headers: { Authorization: `Bearer ${META.TOKEN}` } }
  );
}

/* =========================================================
   PDF
========================================================= */
async function createQuotePdf(data) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fontSize(22).text(COMPANY.NAME);
    doc.moveDown();
    doc.text(`Fecha: ${formatDateCL()}`);
    doc.moveDown();
    doc.text(`Producto: ${data.product}`);
    doc.text(`Medidas: ${data.measures}`);
    doc.text(`Vidrio: ${data.glass}`);
    doc.moveDown();
    doc.text(
      `Valor estimado: $${data.internal_price?.toLocaleString(
        "es-CL"
      )} + IVA`
    );

    doc.end();
  });
}

/* =========================================================
   SESSION
========================================================= */
const sessions = new Map();

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      data: {
        product: "",
        measures: "",
        glass: "",
        internal_price: null,
      },
      history: [],
      pdfSent: false,
    });
  }
  return sessions.get(waId);
}

/* =========================================================
   WEBHOOK
========================================================= */
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === META.VERIFY_TOKEN)
    return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  if (!verifyMetaSignature(req)) return;

  const value = req.body?.entry?.[0]?.changes?.[0]?.value;

  // 🔴 IGNORAR STATUS UPDATES (ANTI-LOOP)
  if (value?.statuses) return;

  const msg = value?.messages?.[0];
  if (!msg) return;

  const waId = msg.from;
  const text = msg.text?.body || "";

  const session = getSession(waId);
  session.history.push(text);

  // RESET
  if (/nueva cotizaci[oó]n|reset/i.test(text)) {
    sessions.delete(waId);
    await waSendText(
      waId,
      "🔄 Perfecto, partimos desde cero. ¿Qué ventana necesitas cotizar?"
    );
    return;
  }

  // DATOS
  if (!session.data.product && /ventana|puerta/i.test(text))
    session.data.product = text;
  if (!session.data.measures) session.data.measures = text;
  if (!session.data.glass && /vidrio|termo/i.test(text))
    session.data.glass = text;

  if (
    session.data.product &&
    session.data.measures &&
    session.data.glass &&
    !session.data.internal_price
  ) {
    const m = normalizeMeasures(session.data.measures);
    if (m)
      session.data.internal_price = calculateInternalPrice({
        ...m,
        glass: session.data.glass,
      });
  }

  // PDF
  if (/cotiza|pdf/i.test(text) && session.data.internal_price && !session.pdfSent) {
    const pdf = await createQuotePdf(session.data);
    const mediaId = await waUploadPdf(pdf);
    await waSendPdf(waId, mediaId);
    await waSendText(
      waId,
      "📄 Te envié la cotización. Un consultor del *Equipo Alfa* te apoyará en el cierre."
    );
    session.pdfSent = true;
    return;
  }

  await waSendText(
    waId,
    "Perfecto 👍 cuéntame un poco más del proyecto y lo revisamos bien."
  );
});

/* =========================================================
   START
========================================================= */
app.listen(PORT, () =>
  console.log(`🚀 Ferrari 6.1.2 ACTIVO y ESTABLE en puerto ${PORT}`)
);
