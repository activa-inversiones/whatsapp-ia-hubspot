// index.js — WhatsApp IA + Zoho CRM
// Ferrari 6.2.1 FINAL — IA Conectada + Memoria Forzada + Typing ON
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
app.use(express.json({
  limit: "20mb",
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// ===================== LOG CONTROL =====================
function logError(ctx, e) {
  if (e?.response) {
    console.error(`❌ ${ctx}: ${e.response.status} ${JSON.stringify(e.response.data).slice(0,200)}`);
  } else {
    console.error(`❌ ${ctx}: ${e?.message}`);
  }
}

// ===================== ENV =====================
const PORT = process.env.PORT || 8080;
const TZ = "America/Santiago";

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

if (!META.TOKEN || !META.PHONE_NUMBER_ID || !META.VERIFY_TOKEN || !OPENAI_API_KEY) {
  console.error("❌ ENV faltantes");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ===================== HELPERS =====================
const waBase = () => `https://graph.facebook.com/${META.GRAPH_VERSION}`;

function verifyMetaSignature(req) {
  if (!META.APP_SECRET) return true;
  const sig = req.get("X-Hub-Signature-256");
  if (!sig || !req.rawBody) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", META.APP_SECRET).update(req.rawBody).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
  catch { return false; }
}

async function waSendText(to, text) {
  try {
    await axios.post(`${waBase()}/${META.PHONE_NUMBER_ID}/messages`, {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    }, { headers: { Authorization: `Bearer ${META.TOKEN}` } });
  } catch (e) { logError("WA Send", e); }
}

async function waTyping(waId, msgId) {
  try {
    if (msgId) {
      await axios.post(`${waBase()}/${META.PHONE_NUMBER_ID}/messages`, {
        messaging_product: "whatsapp",
        status: "read",
        message_id: msgId
      }, { headers: { Authorization: `Bearer ${META.TOKEN}` } });
    }
    await axios.post(`${waBase()}/${META.PHONE_NUMBER_ID}/messages`, {
      messaging_product: "whatsapp",
      to: waId,
      typing_indicator: { type: "text" }
    }, { headers: { Authorization: `Bearer ${META.TOKEN}` } });
  } catch {}
}

// ===================== SESSION =====================
const sessions = new Map();
function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      data: { product:"", measures:"", comuna:"", glass:"", internal_price:null },
      history: []
    });
  }
  return sessions.get(id);
}

// ===================== DATA DETECTOR (CLAVE) =====================
function looksLikeData(text) {
  return (
    /\d+\s*[xX]\s*\d+/.test(text) ||
    /pvc|aluminio|ventana|puerta/i.test(text) ||
    /temuco|padre las casas|villarrica|pucon/i.test(text) ||
    /termopanel|dvh|4mm|6mm/i.test(text)
  );
}

// ===================== PRICE =====================
function normalizeMeasures(m) {
  const n = m.match(/(\d+)[xX](\d+)/);
  if (!n) return null;
  return { w:+n[1], h:+n[2] };
}

function calcPrice({ w, h }) {
  const area = (w*h)/1_000_000;
  return Math.round(Math.max(area*120000, 50000));
}

// ===================== AI =====================
const tools = [{
  type: "function",
  function: {
    name: "update_customer_data",
    parameters: {
      type: "object",
      properties: {
        product:{type:"string"},
        measures:{type:"string"},
        comuna:{type:"string"},
        glass:{type:"string"}
      }
    }
  }
}];

const SYSTEM_PROMPT = `
Eres vendedor experto en ventanas PVC en Chile.
Venta consultiva, humano, cercano.
Si el cliente entrega datos, GUARDA.
Nunca repitas frases.
`.trim();

async function runAI(session, userText, forceTool=false) {
  const messages = [
    { role:"system", content:SYSTEM_PROMPT },
    ...session.history.slice(-10),
    { role:"user", content:userText }
  ];

  const r = await openai.chat.completions.create({
    model: AI_MODEL,
    messages,
    tools,
    tool_choice: forceTool
      ? { type:"function", function:{ name:"update_customer_data" } }
      : "auto",
    temperature: 0.3,
    max_tokens: 300
  });

  return r.choices[0].message;
}

// ===================== WEBHOOK =====================
app.post("/webhook", async (req,res)=>{
  res.sendStatus(200);
  if (!verifyMetaSignature(req)) return;

  const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return;

  const waId = msg.from;
  const msgId = msg.id;
  const text = msg.text?.body || "";

  const session = getSession(waId);
  await waTyping(waId, msgId);

  const forceTool = looksLikeData(text);
  const aiMsg = await runAI(session, text, forceTool);

  // TOOL
  if (aiMsg.tool_calls?.length) {
    const args = JSON.parse(aiMsg.tool_calls[0].function.arguments);
    session.data = { ...session.data, ...args };

    if (session.data.measures) {
      const m = normalizeMeasures(session.data.measures);
      if (m) session.data.internal_price = calcPrice(m);
    }

    const confirm = `Perfecto 👍 ya dejé anotado:\n` +
      `• ${session.data.product || "Producto"}\n` +
      `• ${session.data.measures || "Medidas"}\n` +
      `• ${session.data.comuna || "Comuna"}\n\nSeguimos avanzando.`;

    await waSendText(waId, confirm);
    session.history.push({ role:"assistant", content: confirm });
    return;
  }

  // NORMAL REPLY
  const reply = aiMsg.content || "Cuéntame un poco más del proyecto 👍";
  await waSendText(waId, reply);
  session.history.push({ role:"assistant", content: reply });
});

// ===================== VERIFY =====================
app.get("/webhook",(req,res)=>{
  if (req.query["hub.verify_token"] === META.VERIFY_TOKEN)
    return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.listen(PORT, ()=>console.log("🚀 Ferrari 6.2.1 ACTIVO"));
