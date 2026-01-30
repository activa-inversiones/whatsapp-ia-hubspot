// index.js — WhatsApp IA (OpenAI Tools) + PDF + Zoho CRM
// Ferrari 2.1 — Stable / Anti-dup / TTL / RateLimit / Signature OK
// Node 18+ | Railway | ESM

import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import crypto from "crypto";
import FormData from "form-data";
import PDFDocument from "pdfkit";
import OpenAI from "openai";

dotenv.config();

const app = express();

// ============ Raw body for Meta signature ============
app.use(
  express.json({
    limit: "5mb",
    verify: (req, res, buf) => {
      req.rawBody = buf; // Buffer
    },
  })
);

// ============ ENV ============
const PORT = process.env.PORT || 8080;
const TZ = process.env.TZ || "America/Santiago";

const META = {
  GRAPH_VERSION: process.env.META_GRAPH_VERSION || "v22.0",
  TOKEN: process.env.WHATSAPP_TOKEN,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  APP_SECRET: process.env.APP_SECRET || "", // opcional
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL_OPENAI || "gpt-4o-mini";

// Zoho (opcional: puedes desactivar con REQUIRE_ZOHO=false)
const REQUIRE_ZOHO = String(process.env.REQUIRE_ZOHO || "true") === "true";
const ZOHO = {
  CLIENT_ID: process.env.ZOHO_CLIENT_ID,
  CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET,
  REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN,
  API_DOMAIN: process.env.ZOHO_API_DOMAIN || "https://www.zohoapis.com",
  ACCOUNTS_DOMAIN: process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.com",
};

// ============ Guard: ENV ============
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

// ============ OpenAI ============
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ============ WhatsApp base ============
const waBase = () => `https://graph.facebook.com/${META.GRAPH_VERSION}/${META.PHONE_NUMBER_ID}`;

async function waSendText(to, text) {
  const url = `${waBase()}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body: text } };
  try {
    const r = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${META.TOKEN}` },
      timeout: 15000,
    });
    console.log("✅ WA send text", r.status, to);
  } catch (e) {
    console.error("❌ WA send text FAIL", e?.response?.status, e?.response?.data || e.message);
    throw e;
  }
}

async function waUploadPdf(buffer, filename = "Cotizacion_Activa.pdf") {
  const url = `${waBase()}/media`;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buffer, { filename, contentType: "application/pdf" });

  try {
    const r = await axios.post(url, form, {
      headers: { Authorization: `Bearer ${META.TOKEN}`, ...form.getHeaders() },
      maxBodyLength: Infinity,
      timeout: 30000,
    });
    console.log("✅ WA upload pdf", r.status, r.data?.id);
    return r.data.id;
  } catch (e) {
    console.error("❌ WA upload pdf FAIL", e?.response?.status, e?.response?.data || e.message);
    throw e;
  }
}

async function waSendPdfById(to, mediaId, caption) {
  const url = `${waBase()}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: { id: mediaId, filename: "Cotizacion_Activa.pdf", caption },
  };
  try {
    const r = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${META.TOKEN}` },
      timeout: 20000,
    });
    console.log("✅ WA send pdf", r.status, to, mediaId);
  } catch (e) {
    console.error("❌ WA send pdf FAIL", e?.response?.status, e?.response?.data || e.message);
    throw e;
  }
}

// ============ Meta Signature ============
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

// ============ Sessions + TTL cleanup ============
const sessions = new Map();
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas
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

// ============ Dedupe by msgId (Meta retries) ============
const processedMsgIds = new Map(); // msgId -> ts
const MSGID_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas

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

// ============ Per-waId lock (anti race condition) ============
const locks = new Map(); // waId -> Promise

async function acquireLock(waId, timeoutMs = 30000) {
  if (locks.has(waId)) {
    await locks.get(waId);
  }
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

// ============ Rate limit (simple) ============
const rate = new Map(); // waId -> {count, resetAt}
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;

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

// ============ Webhook payload validation ============
function extractIncoming(reqBody) {
  const entry = reqBody?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;

  // Ignorar statuses
  if (value?.statuses?.length) return { ok: false, reason: "status_update" };

  const msg = value?.messages?.[0];
  if (!msg) return { ok: false, reason: "no_message" };
  if (!msg.from || !msg.id || !msg.type) return { ok: false, reason: "incomplete_message" };

  // Texto (si no es texto, igual lo registramos)
  let text = "";
  if (msg.type === "text") text = msg.text?.body || "";
  else if (msg.type === "button") text = msg.button?.text || "";
  else if (msg.type === "interactive") text = JSON.stringify(msg.interactive || {});
  else text = `[${msg.type}]`;

  return { ok: true, waId: msg.from, msgId: msg.id, text, type: msg.type };
}

// ============ OpenAI Tools ============
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
          wants_pdf: { type: "boolean" }
        },
        required: []
      }
    }
  }
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
`;

// Completo mínimo para PDF
function isComplete(d) {
  return !!(d.product && d.measures && (d.address || d.comuna) && d.glass && d.install);
}

// ============ PDF ============
function createPdf(data) {
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

// ============ Zoho ============
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
          Description: `Producto: ${d.product} | Medidas: ${d.measures} | Vidrio: ${d.glass} | Instalación: ${d.install} | Comuna/Dirección: ${d.address || d.comuna}`,
        },
      ],
      duplicate_check_fields: ["Mobile"],
      trigger: ["workflow"],
    };

    const r = await axios.post(url, payload, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      timeout: 15000,
    });

    console.log("✅ Zoho upsert", r.data?.data?.[0]?.code);
  } catch (e) {
    const status = e?.response?.status;
    if (status === 401 && retries > 0) {
      console.warn("🔁 Zoho 401 retry");
      zohoCache = { token: "", expiresAt: 0 };
      await new Promise((r) => setTimeout(r, 500));
      return zohoUpsertLead(d, phone, retries - 1);
    }
    console.warn("⚠️ Zoho upsert fail", status, e?.response?.data || e.message);
  }
}

// ============ AI Orchestration ============
async function runAI(session, userText) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT.trim() },
    { role: "system", content: `Memoria: ${JSON.stringify(session.data)}` },
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
      max_tokens: 350,
      timeout: 15000,
    });

    const msg = resp.choices?.[0]?.message;
    return msg || { role: "assistant", content: "Disculpa, ¿me repites tu consulta?" };
  } catch (e) {
    console.error("❌ OpenAI error", e.message);
    return { role: "assistant", content: "Tuve un problema técnico. ¿Me confirmas solo medidas (ancho x alto) y comuna?" };
  }
}

// ============ Routes ============
app.get("/health", (req, res) => res.status(200).send("ok"));

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === META.VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  // ACK inmediato
  res.sendStatus(200);

  // Firma (si está activa)
  if (!verifyMetaSignature(req)) {
    console.warn("⚠️ META signature fail");
    return;
  }

  const incoming = extractIncoming(req.body);
  if (!incoming.ok) {
    if (incoming.reason !== "status_update") console.log("⏭️ skip", incoming.reason);
    return;
  }

  const { waId, msgId, text } = incoming;

  // Dedupe por msgId (Meta retries)
  if (isDuplicateMsg(msgId)) {
    console.log("⏭️ duplicate msgId", msgId);
    return;
  }

  // Rate limit
  const r = checkRate(waId);
  if (!r.allowed) {
    await waSendText(waId, r.msg);
    return;
  }

  // Lock por usuario (anti duplicados)
  const release = await acquireLock(waId);
  try {
    const session = getSession(waId);
    session.lastUserAt = Date.now();

    console.log("📩 IN", { waId, msgId, text });

    // AI (puede incluir tool_calls)
    const aiMsg = await runAI(session, text);

    // Procesar tool calls (pueden venir varios)
    let triggerPDF = false;

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

        // Respuesta “tool ack” para que el modelo continúe con texto final
        const follow = await openai.chat.completions.create({
          model: AI_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT.trim() },
            { role: "system", content: `Memoria: ${JSON.stringify(session.data)}` },
            ...session.history.slice(-6),
            { role: "user", content: text },
            aiMsg,
            { role: "tool", tool_call_id: tc.id, content: "OK, datos guardados." },
          ],
          temperature: 0.3,
          max_tokens: 250,
          timeout: 15000,
        });

        const finalText = follow.choices?.[0]?.message?.content?.trim();
        if (finalText) {
          await waSendText(waId, finalText);
          session.history.push({ role: "user", content: text });
          session.history.push({ role: "assistant", content: finalText });
        }
      }
    } else {
      // Respuesta normal
      const reply = (aiMsg.content || "").trim();
      if (reply) {
        await waSendText(waId, reply);
        session.history.push({ role: "user", content: text });
        session.history.push({ role: "assistant", content: reply });
      }
    }

    // Sincroniza Zoho (no bloqueante “perfecto”, pero aquí simple)
    zohoUpsertLead(session.data, waId).catch(() => {});

    // PDF: si completo y (lo pidió o triggerPDF), envía una sola vez
    const complete = isComplete(session.data);
    const askedPdf = /\bpdf\b/i.test(text) || /cotiz/i.test(text);
    if (!session.pdfSent && complete && (triggerPDF || askedPdf)) {
      await waSendText(waId, "Perfecto, ya tengo todo. Te envío el PDF referencial ahora.");
      const pdf = await createPdf(session.data);
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

// ============ Boot ============
console.log(`SERVER_OK port=${PORT} tz=${TZ}`);
console.log(`[INFO] META_VER=${META.GRAPH_VERSION}`);
console.log(`[INFO] PHONE_NUMBER_ID=${META.PHONE_NUMBER_ID}`);
console.log(`[INFO] MODEL=${AI_MODEL}`);
console.log(`[INFO] REQUIRE_ZOHO=${REQUIRE_ZOHO}`);

app.listen(PORT, () => console.log(`🚀 Server activo en puerto ${PORT}`));
