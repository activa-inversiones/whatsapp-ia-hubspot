// index.js — WhatsApp IA + Venta Consultiva (Activa Ventanas) + ZOHO OAuth (refresh/test)
// Runtime: Node 18+ (Railway) | ESM ("type":"module" en package.json)

import express from "express";
import axios from "axios";
import OpenAI from "openai";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// ======================================================
// APP + RAW BODY (para verificación de firma opcional)
// ======================================================
const app = express();
app.use(
  express.json({
    limit: "20mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

const PORT = process.env.PORT || 8080;

// ======================================================
// ENV + CONFIG
// ======================================================
function truthy(v) {
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on", "si", "sí"].includes(s);
}

const ENV = {
  // Meta / WhatsApp
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  META_VERSION: process.env.META_GRAPH_VERSION || process.env.META_VERSION || "v22.0",

  // Seguridad (opcional)
  APP_SECRET: process.env.APP_SECRET,

  // OpenAI
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  AI_MODEL_TEXT: process.env.AI_MODEL_TEXT || process.env.MODEL_TEXT || "gpt-4.1-mini",
  AI_MODEL_VISION: process.env.AI_MODEL_VISION || "gpt-4o-mini",
  AI_MODEL_TRANSCRIBE: process.env.AI_MODEL_TRANSCRIBE || "gpt-4o-mini-transcribe",

  // Features
  ENABLE_VOICE_TRANSCRIPTION: truthy(process.env.ENABLE_VOICE_TRANSCRIPTION),
  ENABLE_PDF_QUOTES: truthy(process.env.ENABLE_PDF_QUOTES),
  TYPING_SIMULATION: truthy(process.env.TYPING_SIMULATION),

  // Límites
  MAX_REPLY_CHARS: Number(process.env.MAX_REPLY_CHARS || 1200),
  DEDUPE_TTL_MS: Number(process.env.DEDUPE_TTL_MS || 5 * 60 * 1000),
  SESSION_TTL_MS: Number(process.env.SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000),
  MAX_IMAGE_BYTES: Number(process.env.MAX_IMAGE_BYTES || 3_000_000),
  MAX_AUDIO_BYTES: Number(process.env.MAX_AUDIO_BYTES || 8_000_000),
  MAX_PDF_BYTES: Number(process.env.MAX_PDF_BYTES || 10_000_000),
};

// ======================================================
// ZOHO ENV
// ======================================================
const ZOHO = {
  CLIENT_ID: process.env.ZOHO_CLIENT_ID,
  CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET,
  REDIRECT_URI: process.env.ZOHO_REDIRECT_URI, // https://tu-app/zoho/callback
  DC: process.env.ZOHO_DC || "com", // com / eu / in / com.au / jp / uk / ca / sa
  REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN, // <- ESTE ES EL QUE DEBE SER refresh_token
};

// ======================================================
// BRAND / TONO
// ======================================================
const BRAND = {
  displayName: "Activa Ventanas",
  legalHint: "Fábrica de Ventanas Activa (Marcelo Cifuentes)",
  city: "Temuco / La Araucanía",
  whatWeDo:
    "Fabricamos e instalamos ventanas y puertas de PVC y aluminio, con termopanel y soluciones para clima frío (aislación térmica/acústica).",
  values: ["honorabilidad", "respeto", "paciencia", "claridad", "asesoría técnica", "venta consultiva"],
  promise:
    "Te guiamos para elegir la mejor solución según frío, ruido, seguridad y presupuesto; sin letra chica.",
  nextSteps:
    "Para cotizar bien pedimos: comuna, tipo de abertura, medidas (ancho x alto), color, tipo de vidrio y si es obra nueva o recambio.",
};

const SYSTEM_PROMPT_TEXT = `
Eres el asistente comercial y técnico de ${BRAND.displayName} (${BRAND.legalHint}), en Chile.
Objetivo: conversación humana y consultiva para convertir interés en cotización y visita/levantamiento.

Reglas de tono:
- Amable, cercano, respetuoso y paciente. Nada robótico.
- Confirmas lo pedido y haces 1-3 preguntas útiles (no 10).
- Si el cliente dice "paso frío" o "condensación", prioriza recomendación técnica: DVH/Low-E/cámara, sellos e instalación.
- Evita respuestas genéricas. Personaliza con lo que dijo el cliente.
- No inventes precios definitivos. Si faltan datos, entrega rango referencial y pide lo mínimo.
- No digas “soy un bot” ni “modelo de IA”.
- Mensajes cortos (2–6 líneas). Lista breve solo si aporta.

Reglas comerciales:
- Captura: nombre, comuna, producto (ventana/puerta), tipo (corredera/abatible/oscilobatiente), medidas, color, vidrio.
- Cierra con siguiente paso: “¿confirmamos X e Y para enviarte pre-cotización hoy?”.
`;

const VISION_EXTRACT_PROMPT =
  "Eres un extractor de datos desde imagen (tablas/listas/fotos) para ventanas y puertas.\n" +
  "Devuelve SOLO texto plano, sin saludo, sin explicaciones.\n" +
  "Formato: UNA LÍNEA POR ÍTEM:\n" +
  "QTY x ANCHO_MM x ALTO_MM | MODELO(opcional)\n" +
  "Reglas:\n" +
  "- Convierte m/cm a mm. 1,80 o 1.80 m = 1800 mm.\n" +
  "- Si no hay cantidad, QTY=1.\n" +
  "- Si no se ve claro: NO_CLARO: (qué faltó).\n" +
  "- No inventes números.\n";

// ======================================================
// OPENAI CLIENT (opcional)
// ======================================================
const openai = ENV.OPENAI_API_KEY ? new OpenAI({ apiKey: ENV.OPENAI_API_KEY }) : null;

// ======================================================
// HELPERS
// ======================================================
function nowISO() {
  return new Date().toISOString();
}
function safeStr(s, max = 1200) {
  const t = String(s ?? "").trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function toTitle(s) {
  return String(s)
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");
}
function logInfo(...args) {
  console.log("[INFO]", ...args);
}
function logWarn(...args) {
  console.warn("[WARN]", ...args);
}
function logErr(...args) {
  console.error("[ERROR]", ...args);
}

// ======================================================
// DEDUPE
// ======================================================
const seenMsg = new Map();
function dedupe(msgId) {
  const t = Date.now();
  for (const [k, ts] of seenMsg.entries()) {
    if (t - ts > ENV.DEDUPE_TTL_MS) seenMsg.delete(k);
  }
  if (seenMsg.has(msgId)) return true;
  seenMsg.set(msgId, t);
  return false;
}

// ======================================================
// SESSION STORE
// ======================================================
const sessions = new Map();
function getSession(wa_id) {
  const existing = sessions.get(wa_id);
  const s =
    existing ||
    ({
      wa_id,
      createdAt: nowISO(),
      lastAt: nowISO(),
      turns: [],
      facts: {
        name: null,
        comuna: null,
        product: null,
        type: null,
        color: null,
        glass: null,
        measures: [],
        notes: [],
      },
    });
  s.lastAt = nowISO();
  sessions.set(wa_id, s);
  return s;
}
function addTurn(session, role, content) {
  session.turns.push({ at: nowISO(), role, content: safeStr(content, 1500) });
  if (session.turns.length > 12) session.turns = session.turns.slice(-12);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions.entries()) {
    const last = Date.parse(s.lastAt || s.createdAt || nowISO());
    if (now - last > ENV.SESSION_TTL_MS) sessions.delete(k);
  }
}, 60_000).unref();

// ======================================================
// SIGNATURE VERIFY (OPCIONAL)
// ======================================================
function verifyMetaSignature(req) {
  if (!ENV.APP_SECRET) return true;
  const sig = req.headers["x-hub-signature-256"];
  if (!sig || typeof sig !== "string" || !sig.startsWith("sha256=")) return false;
  const their = sig.slice(7);
  const raw = req.rawBody || Buffer.from("");
  const ours = crypto.createHmac("sha256", ENV.APP_SECRET).update(raw).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(their), Buffer.from(ours));
  } catch {
    return false;
  }
}

// ======================================================
// WHATSAPP CLOUD API
// ======================================================
const WA_BASE = () => `https://graph.facebook.com/${ENV.META_VERSION}`;

async function waMarkRead(phone_number_id, msg_id) {
  if (!ENV.WHATSAPP_TOKEN || !phone_number_id || !msg_id) return;
  try {
    await axios.post(
      `${WA_BASE()}/${phone_number_id}/messages`,
      { messaging_product: "whatsapp", status: "read", message_id: msg_id },
      { headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` }, timeout: 30_000 }
    );
  } catch (_) {}
}

async function waSendText(phone_number_id, to, text) {
  if (!ENV.WHATSAPP_TOKEN || !phone_number_id) throw new Error("Missing WHATSAPP_TOKEN/PHONE_NUMBER_ID");
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: safeStr(text, 4096), preview_url: false },
  };
  await axios.post(`${WA_BASE()}/${phone_number_id}/messages`, payload, {
    headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` },
    timeout: 60_000,
  });
}

async function waTypingSim(toText) {
  if (!ENV.TYPING_SIMULATION) return;
  const chars = (toText || "").length;
  const ms = clamp(chars * 35, 700, 3500);
  await sleep(ms);
}

async function waGetMediaUrl(media_id) {
  const r = await axios.get(`${WA_BASE()}/${media_id}`, {
    headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` },
    timeout: 60_000,
  });
  return r?.data?.url;
}

async function waDownloadMedia(media_url) {
  const r = await axios.get(media_url, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` },
    timeout: 60_000,
  });
  return Buffer.from(r.data);
}

// ======================================================
// PARSERS / HECHOS
// ======================================================
function parseMeasuresFromText(text) {
  const t = String(text || "").toLowerCase();
  const normalized = t
    .replace(/,/g, ".")
    .replace(/mts|mt|metros|metro/g, "m")
    .replace(/centimetros|centimetro|cms|cm/g, "cm")
    .replace(/\s+por\s+/g, " x ")
    .replace(/\s*x\s*/g, "x");

  const matches = [];
  const re = /(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(m|cm)?/g;
  let m;
  while ((m = re.exec(normalized))) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    const unit = m[3] || null;

    const toMM = (v) => {
      if (unit === "m") return Math.round(v * 1000);
      if (unit === "cm") return Math.round(v * 10);
      if (v <= 10) return Math.round(v * 1000);
      if (v > 50) return Math.round(v);
      return Math.round(v * 10);
    };

    const w_mm = toMM(a);
    const h_mm = toMM(b);

    if (w_mm >= 200 && h_mm >= 200 && w_mm <= 6000 && h_mm <= 6000) {
      matches.push({ qty: 1, w_mm, h_mm, model: null });
    }
  }
  return matches;
}

function updateFactsFromText(session, text) {
  const t = String(text || "").trim();
  if (!t) return;
  const lc = t.toLowerCase();

  const comunaHints = [
    "temuco",
    "padre las casas",
    "villarrica",
    "pucón",
    "pucon",
    "cunco",
    "labranza",
    "imperial",
    "carahue",
    "freire",
    "lautaro",
    "nueva imperial",
    "angol",
    "collipulli",
  ];
  for (const c of comunaHints) {
    if (lc.includes(c)) session.facts.comuna = toTitle(c.replace("pucon", "pucón"));
  }

  if (lc.includes("blanco")) session.facts.color = "Blanco";
  if (lc.includes("nogal") || lc.includes("madera")) session.facts.color = "Nogal";
  if (lc.includes("grafito")) session.facts.color = "Grafito";
  if (lc.includes("negro")) session.facts.color = "Negro";

  if (lc.includes("corredera")) session.facts.type = "Corredera";
  if (lc.includes("abatible")) session.facts.type = "Abatible";
  if (lc.includes("oscil")) session.facts.type = "Oscilobatiente";
  if (lc.includes("puerta")) session.facts.product = "Puerta";
  if (lc.includes("ventana")) session.facts.product = "Ventana";

  if (lc.includes("termopanel") || lc.includes("dvh")) session.facts.glass = "Termopanel (DVH)";
  if (lc.includes("low-e") || lc.includes("low e")) session.facts.glass = "Termopanel (DVH) con Low-E";
  if (lc.includes("laminado")) session.facts.glass = "Laminado";
  if (lc.includes("templado")) session.facts.glass = "Templado";

  const parsed = parseMeasuresFromText(t);
  if (parsed.length) {
    const key = (x) => `${x.qty}|${x.w_mm}|${x.h_mm}|${x.model || ""}`;
    const existing = new Set((session.facts.measures || []).map(key));
    for (const it of parsed) {
      if (!existing.has(key(it))) session.facts.measures.push(it);
    }
  }
}

function inferIntent(text) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return "unknown";
  if (t.includes("cotiz") || t.includes("precio") || t.includes("presupuesto")) return "quote";
  if (t.includes("inform") || t.includes("catálogo") || t.includes("catalogo") || t.includes("modelos")) return "info";
  if (t.includes("frío") || t.includes("frio") || t.includes("helado") || t.includes("condens")) return "cold_problem";
  if (t.includes("vidrio") || t.includes("laminado") || t.includes("templado")) return "glass";
  if (t.includes("puerta")) return "door";
  if (t.includes("ventana")) return "window";
  return "general";
}

// ======================================================
// PRE-COTIZACIÓN (referencial)
// ======================================================
function round2(n) {
  return Math.round(n * 100) / 100;
}

function quoteEngine(session) {
  const facts = session.facts;
  const items = facts.measures || [];
  if (!items.length) return null;

  const color = (facts.color || "").toLowerCase();
  const glass = (facts.glass || "").toLowerCase();
  const type = (facts.type || "").toLowerCase();
  const product = (facts.product || "").toLowerCase();

  let pricePerM2 = 150000;
  if (color.includes("nogal") || color.includes("madera")) pricePerM2 = 160000;
  if (color.includes("negro") || color.includes("grafito")) pricePerM2 = 165000;

  let glassFactor = 1.0;
  if (glass.includes("low")) glassFactor += 0.12;
  if (glass.includes("laminado")) glassFactor += 0.18;
  if (glass.includes("templado")) glassFactor += 0.10;

  let typeFactor = 1.0;
  if (type.includes("oscil")) typeFactor += 0.10;
  if (type.includes("abat")) typeFactor += 0.06;
  if (product.includes("puerta")) typeFactor += 0.15;

  let totalArea = 0;
  let net = 0;

  const lineItems = items.map((it) => {
    const area = (it.w_mm / 1000) * (it.h_mm / 1000) * (it.qty || 1);
    const sub = area * pricePerM2 * glassFactor * typeFactor;
    totalArea += area;
    net += sub;
    return {
      qty: it.qty || 1,
      w_mm: it.w_mm,
      h_mm: it.h_mm,
      model: it.model || null,
      area_m2: round2(area),
      net: Math.round(sub),
    };
  });

  const iva = Math.round(net * 0.19);
  const total = net + iva;

  return {
    currency: "CLP",
    pricePerM2: Math.round(pricePerM2 * glassFactor * typeFactor),
    color: facts.color || "No indicado",
    glass: facts.glass || "Termopanel (DVH) sugerido",
    type: facts.type || "No indicado",
    product: facts.product || "Ventana/Puerta",
    totalArea: round2(totalArea),
    net,
    iva,
    total,
    lineItems,
    disclaimer:
      "Valores referenciales sujetos a confirmación de medidas, tipo de apertura, refuerzos, vidrio y condiciones de instalación.",
  };
}

// ======================================================
// PDF (lazy load)
// ======================================================
let pdfParse = null;
let PDFDocument = null;
let FormData = null;

function loadPdfDeps() {
  if (!pdfParse) {
    pdfParse = require("pdf-parse");
    PDFDocument = require("pdfkit");
    FormData = require("form-data");
  }
}

function buildQuotePdfBuffer(quote, session) {
  return new Promise((resolve, reject) => {
    try {
      loadPdfDeps();

      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      doc.fontSize(16).text(`${BRAND.displayName} - Pre-cotización`, { underline: true });
      doc.moveDown(0.5);

      doc.fontSize(10).text(`Fecha: ${new Date().toLocaleString("es-CL")}`);
      doc.text(`Cliente: ${session.facts.name || session.wa_id}`);
      doc.text(`Comuna: ${session.facts.comuna || "Por confirmar"}`);
      doc.moveDown(0.8);

      doc.fontSize(12).text("Resumen", { underline: true });
      doc.fontSize(10).text(`Producto: ${quote.product}`);
      doc.text(`Tipo: ${quote.type}`);
      doc.text(`Color: ${quote.color}`);
      doc.text(`Vidrio: ${quote.glass}`);
      doc.text(`Área total: ${quote.totalArea} m²`);
      doc.text(`Valor referencial: ${quote.pricePerM2.toLocaleString("es-CL")} + IVA / m²`);
      doc.moveDown(0.8);

      doc.fontSize(12).text("Detalle", { underline: true });
      doc.moveDown(0.3);

      quote.lineItems.forEach((li, idx) => {
        doc.fontSize(10).text(
          `${idx + 1}) ${li.qty} x ${li.w_mm} x ${li.h_mm} mm` +
            (li.model ? ` | ${li.model}` : "") +
            ` | ${li.area_m2} m² | Neto: ${li.net.toLocaleString("es-CL")}`
        );
      });

      doc.moveDown(0.8);
      doc.fontSize(10).text(`Neto: ${quote.net.toLocaleString("es-CL")}`);
      doc.text(`IVA (19%): ${quote.iva.toLocaleString("es-CL")}`);
      doc.fontSize(12).text(`Total: ${quote.total.toLocaleString("es-CL")}`, { underline: true });

      doc.moveDown(1.0);
      doc.fontSize(9).text(`Nota: ${quote.disclaimer}`);
      doc.moveDown(1.0);
      doc.fontSize(10).text(BRAND.promise);

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

async function waUploadMediaPDF(phone_number_id, pdfBuffer, filename = "cotizacion.pdf") {
  loadPdfDeps();

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append("file", pdfBuffer, { filename, contentType: "application/pdf" });

  const r = await axios.post(`${WA_BASE()}/${phone_number_id}/media`, form, {
    headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}`, ...form.getHeaders() },
    maxBodyLength: Infinity,
    timeout: 60_000,
  });

  return r?.data?.id;
}

async function waSendDocument(phone_number_id, to, media_id, filename, caption) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: { id: media_id, filename, caption: safeStr(caption, 1024) },
  };
  await axios.post(`${WA_BASE()}/${phone_number_id}/messages`, payload, {
    headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` },
    timeout: 60_000,
  });
}

// ======================================================
// OPENAI: AUDIO / VISIÓN / RESPUESTA
// ======================================================
async function transcribeAudioBuffer(audioBuffer) {
  if (!openai || !ENV.ENABLE_VOICE_TRANSCRIPTION) return null;
  if (!audioBuffer?.length) return null;
  if (audioBuffer.length > ENV.MAX_AUDIO_BYTES) return null;

  const tmp = path.join(os.tmpdir(), `wa-audio-${crypto.randomUUID()}.ogg`);
  fs.writeFileSync(tmp, audioBuffer);

  try {
    const tr = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmp),
      model: ENV.AI_MODEL_TRANSCRIBE,
    });
    return (tr?.text || "").trim() || null;
  } catch (e) {
    logErr("transcribeAudio error:", e?.message || e);
    return null;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {}
  }
}

async function extractFromImageBuffer(imageBuffer) {
  if (!openai) return null;
  if (!imageBuffer?.length) return null;
  if (imageBuffer.length > ENV.MAX_IMAGE_BYTES) {
    return { raw: "NO_CLARO: imagen muy pesada; envía una foto más nítida o recortada a la tabla.", items: [] };
  }

  try {
    const b64 = imageBuffer.toString("base64");
    const dataUrl = `data:image/jpeg;base64,${b64}`;

    const resp = await openai.chat.completions.create({
      model: ENV.AI_MODEL_VISION,
      messages: [
        { role: "system", content: VISION_EXTRACT_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Lee la tabla/lista y extrae medidas." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0.2,
    });

    const out = resp?.choices?.[0]?.message?.content?.trim() || "";
    if (!out || out.includes("NO_CLARO")) return { raw: out || "NO_CLARO: no se pudo leer.", items: [] };

    const lines = out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const items = [];
    for (const line of lines) {
      const m = line.match(/^(\d+)\s*x\s*(\d+)\s*x\s*(\d+)(?:\s*\|\s*(.*))?$/i);
      if (!m) continue;
      items.push({
        qty: Number(m[1]),
        w_mm: Number(m[2]),
        h_mm: Number(m[3]),
        model: (m[4] || "").trim() || null,
      });
    }
    return { raw: out, items };
  } catch (e) {
    logErr("extractFromImage error:", e?.message || e);
    return null;
  }
}

async function aiComposeReply({ session, userText, quote }) {
  if (!openai) {
    return `Hola, gracias por escribirnos. Para cotizar bien, indícame comuna, tipo (corredera/abatible/oscilobatiente), medidas (ancho x alto) y color.`;
  }

  const facts = session.facts;
  const intent = inferIntent(userText);

  const contextBlock = {
    time: new Date().toLocaleString("es-CL"),
    brand: BRAND,
    intent,
    known: {
      name: facts.name,
      comuna: facts.comuna,
      product: facts.product,
      type: facts.type,
      color: facts.color,
      glass: facts.glass,
      measures: facts.measures,
      notes: facts.notes?.slice(-5),
    },
    quote: quote || null,
    recentTurns: session.turns,
  };

  try {
    const resp = await openai.chat.completions.create({
      model: ENV.AI_MODEL_TEXT,
      temperature: 0.55,
      messages: [
        { role: "system", content: SYSTEM_PROMPT_TEXT },
        {
          role: "user",
          content:
            "Contexto (JSON):\n" +
            JSON.stringify(contextBlock, null, 2) +
            "\n\nMensaje del cliente:\n" +
            userText +
            "\n\nInstrucciones:\n" +
            "- Responde como Activa, humano y consultivo.\n" +
            "- Pide SOLO lo mínimo faltante.\n" +
            "- Si hay pre-cotización, entrégala clara y breve + disclaimer + siguiente paso.\n",
        },
      ],
    });

    const out = resp?.choices?.[0]?.message?.content || "";
    return safeStr(out, ENV.MAX_REPLY_CHARS);
  } catch (e) {
    logErr("aiComposeReply error:", e?.message || e);
    return `Gracias por tu mensaje. Para ayudarte bien, ¿me confirmas comuna y medidas (ancho x alto)? Si es para frío/ruido, dime también si quieres termopanel estándar o Low-E.`;
  }
}

// ======================================================
// ZOHO HELPERS (auth + refresh + test)
// ======================================================
function zohoAccountsBase(dc) {
  if (dc === "com") return "https://accounts.zoho.com";
  return `https://accounts.zoho.${dc}`;
}

async function zohoRefreshAccessToken() {
  if (!ZOHO.CLIENT_ID || !ZOHO.CLIENT_SECRET || !ZOHO.REFRESH_TOKEN) {
    return { ok: false, error: "Faltan ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN" };
  }

  const tokenUrl = `${zohoAccountsBase(ZOHO.DC)}/oauth/v2/token`;

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: ZOHO.CLIENT_ID,
    client_secret: ZOHO.CLIENT_SECRET,
    refresh_token: ZOHO.REFRESH_TOKEN,
  });

  try {
    const r = await axios.post(tokenUrl, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 20000,
    });

    // r.data debe traer access_token
    if (!r.data?.access_token) {
      return { ok: false, error: "Zoho no devolvió access_token", raw: r.data };
    }

    return {
      ok: true,
      access_token: r.data.access_token,
      api_domain: r.data.api_domain || "https://www.zohoapis.com",
      expires_in: r.data.expires_in,
      raw: r.data,
    };
  } catch (err) {
    return {
      ok: false,
      error: "No se obtuvo access_token desde refresh_token",
      raw: err?.response?.data || err?.message || String(err),
    };
  }
}

// ======================================================
// ROUTES
// ======================================================
app.get("/health", (_req, res) => res.status(200).send("ok"));

// WhatsApp webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === ENV.VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// WhatsApp webhook receiver
app.post("/webhook", async (req, res) => {
  if (!verifyMetaSignature(req)) return res.sendStatus(403);

  res.sendStatus(200);

  try {
    const body = req.body;
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0]?.value;

    const phone_number_id = changes?.metadata?.phone_number_id || ENV.PHONE_NUMBER_ID;
    const messages = changes?.messages;
    if (!messages || !messages.length) return;

    const contacts = changes?.contacts || [];
    const contact = contacts[0];

    const wa_id = contact?.wa_id || messages[0]?.from;
    if (!wa_id) return;

    for (const msg of messages) {
      const msg_id = msg?.id;
      if (!msg_id) continue;
      if (dedupe(msg_id)) continue;

      await waMarkRead(phone_number_id, msg_id);

      const session = getSession(wa_id);

      const profileName = contact?.profile?.name;
      if (profileName && !session.facts.name) session.facts.name = profileName;

      let userText = "";

      if (msg.type === "text") {
        userText = msg?.text?.body || "";
      } else if (msg.type === "image") {
        const media_id = msg?.image?.id;
        userText = msg?.image?.caption || "Imagen enviada";

        if (media_id) {
          try {
            const url = await waGetMediaUrl(media_id);
            const buf = await waDownloadMedia(url);

            const extracted = await extractFromImageBuffer(buf);
            if (extracted?.items?.length) {
              session.facts.measures.push(...extracted.items);
              session.facts.notes.push("Medidas extraídas desde imagen.");
              userText =
                (userText ? userText + "\n\n" : "") +
                "Adjunto imagen con medidas. Datos extraídos:\n" +
                extracted.raw;
            } else if (extracted?.raw) {
              session.facts.notes.push("Imagen recibida pero extracción no concluyente.");
              userText =
                (userText ? userText + "\n\n" : "") +
                "Adjunto imagen con medidas, pero no se pudo leer con certeza:\n" +
                extracted.raw;
            } else {
              session.facts.notes.push("Imagen recibida (sin extracción).");
            }
          } catch (e) {
            logErr("IMAGE flow error:", e?.message || e);
            session.facts.notes.push("Imagen recibida (error al descargar/leer).");
          }
        }
      } else if (msg.type === "audio" || msg.type === "voice") {
        const media_id = msg?.audio?.id || msg?.voice?.id;
        userText = "Audio recibido.";

        if (media_id && ENV.ENABLE_VOICE_TRANSCRIPTION) {
          try {
            const url = await waGetMediaUrl(media_id);
            const buf = await waDownloadMedia(url);

            const tr = await transcribeAudioBuffer(buf);
            if (tr) {
              userText = `Audio transcrito: ${tr}`;
              session.facts.notes.push("Audio transcrito.");
            } else {
              session.facts.notes.push("Audio recibido (sin transcripción).");
            }
          } catch (e) {
            logErr("AUDIO flow error:", e?.message || e);
            session.facts.notes.push("Audio recibido (error en descarga/transcripción).");
          }
        }
      } else if (msg.type === "document") {
        const media_id = msg?.document?.id;
        const filename = msg?.document?.filename || "documento";
        userText = `Documento recibido: ${filename}`;

        if (media_id && filename.toLowerCase().endsWith(".pdf")) {
          try {
            const url = await waGetMediaUrl(media_id);
            const buf = await waDownloadMedia(url);

            if (buf.length > ENV.MAX_PDF_BYTES) {
              session.facts.notes.push("PDF recibido pero muy pesado; no se procesó.");
              userText += "\nNota: el PDF es muy pesado; envía una versión más liviana o un extracto.";
            } else {
              try {
                loadPdfDeps();
                const parsed = await pdfParse(buf);
                const txt = (parsed?.text || "").trim();
                if (txt) {
                  userText += `\nResumen PDF (extracto):\n${txt.slice(0, 1200)}`;
                  session.facts.notes.push("PDF recibido y leído.");
                } else {
                  session.facts.notes.push("PDF recibido, sin texto extraíble.");
                }
              } catch (e) {
                logErr("PDF parse error:", e?.message || e);
                session.facts.notes.push("PDF recibido, pero no se pudo leer.");
                userText += "\nNota: recibí el PDF, pero no pude extraer texto. Si me indicas medidas y tipo, lo resolvemos igual.";
              }
            }
          } catch (e) {
            logErr("PDF flow error:", e?.message || e);
            session.facts.notes.push("PDF recibido (error al descargar).");
          }
        }
      } else {
        userText = "Mensaje recibido.";
      }

      addTurn(session, "user", userText);
      updateFactsFromText(session, userText);

      if (session.facts.measures.length && !session.facts.glass) session.facts.glass = "Termopanel (DVH)";
      const quote = quoteEngine(session);

      const reply = await aiComposeReply({ session, userText, quote });
      addTurn(session, "assistant", reply);

      await waTypingSim(reply);
      await waSendText(phone_number_id, wa_id, reply);

      if (ENV.ENABLE_PDF_QUOTES && quote && /pdf/i.test(userText)) {
        try {
          const pdfBuf = await buildQuotePdfBuffer(quote, session);
          const mediaId = await waUploadMediaPDF(phone_number_id, pdfBuf, "cotizacion.pdf");
          await waTypingSim("Adjunto PDF de pre-cotización.");
          await waSendDocument(
            phone_number_id,
            wa_id,
            mediaId,
            "cotizacion.pdf",
            "Adjunto pre-cotización referencial. Si confirmas comuna/tipo/color/vidrio, lo dejamos cerrado."
          );
        } catch (e) {
          logErr("PDF output error:", e?.message || e);
        }
      }
    }
  } catch (e) {
    logErr("Webhook error:", e?.message || e);
  }
});

// ==============================
// ZOHO OAUTH: AUTH + CALLBACK + TEST
// ==============================
app.get("/zoho/auth", (req, res) => {
  if (!ZOHO.CLIENT_ID || !ZOHO.REDIRECT_URI) {
    return res.status(500).send("Faltan ZOHO_CLIENT_ID o ZOHO_REDIRECT_URI");
  }

  const scope = encodeURIComponent("ZohoCRM.modules.ALL,ZohoCRM.settings.ALL,ZohoCRM.users.ALL");
  const state = encodeURIComponent("activa_zoho_" + Date.now());

  const authUrl =
    `${zohoAccountsBase(ZOHO.DC)}/oauth/v2/auth` +
    `?scope=${scope}` +
    `&client_id=${encodeURIComponent(ZOHO.CLIENT_ID)}` +
    `&response_type=code` +
    `&access_type=offline` +
    `&prompt=consent` +
    `&redirect_uri=${encodeURIComponent(ZOHO.REDIRECT_URI)}` +
    `&state=${state}`;

  return res.redirect(authUrl);
});

app.get("/zoho/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send("Callback sin ?code=. Reintenta desde /zoho/auth");

    if (!ZOHO.CLIENT_ID || !ZOHO.CLIENT_SECRET || !ZOHO.REDIRECT_URI) {
      return res.status(500).send("Faltan ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REDIRECT_URI");
    }

    const tokenUrl = `${zohoAccountsBase(ZOHO.DC)}/oauth/v2/token`;

    const params = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: ZOHO.CLIENT_ID,
      client_secret: ZOHO.CLIENT_SECRET,
      redirect_uri: ZOHO.REDIRECT_URI,
      code: String(code),
    });

    const r = await axios.post(tokenUrl, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 20000,
    });

    console.log("✅ ZOHO TOKEN RESPONSE:", r.data);

    return res
      .status(200)
      .send(
        "Zoho conectado. Revisa Railway Logs y copia el refresh_token COMPLETO. " +
          "Luego pégalo en Railway → Variables como ZOHO_REFRESH_TOKEN (sin comillas) y redeploy. " +
          "Después prueba /zoho/test."
      );
  } catch (err) {
    console.error("❌ ZOHO CALLBACK ERROR:", err?.response?.data || err.message);
    return res.status(500).send("Error en callback Zoho. Revisa logs en Railway.");
  }
});

// Test de refresh + llamada real a CRM
app.get("/zoho/test", async (_req, res) => {
  const r = await zohoRefreshAccessToken();
  if (!r.ok) {
    return res.status(200).json({
      ok: false,
      error: r.error,
      raw: r.raw,
      hint:
        "1) Asegura que ZOHO_REFRESH_TOKEN sea el refresh_token (no access_token) y esté completo sin comillas. " +
        "2) ZOHO_DC debe ser 'com' si api_domain es https://www.zohoapis.com. " +
        "3) Si persiste, regenera desde /zoho/auth y usa el nuevo refresh_token.",
    });
  }

  try {
    // Llamada simple: usuario actual
    const api = r.api_domain || "https://www.zohoapis.com";
    const me = await axios.get(`${api}/crm/v2/users?type=CurrentUser`, {
      headers: { Authorization: `Zoho-oauthtoken ${r.access_token}` },
      timeout: 20000,
    });

    return res.status(200).json({
      ok: true,
      api_domain: api,
      expires_in: r.expires_in,
      sample: me.data,
    });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      error: "Refresh OK pero falló llamada a Zoho CRM",
      detail: e?.response?.data || e?.message || String(e),
    });
  }
});

// ======================================================
// STARTUP
// ======================================================
function envStatus() {
  const lines = [
    "Starting Container",
    `ENV OPENAI_API_KEY: ${ENV.OPENAI_API_KEY ? "OK" : "MISSING"}`,
    `ENV WHATSAPP_TOKEN: ${ENV.WHATSAPP_TOKEN ? "OK" : "MISSING"}`,
    `ENV PHONE_NUMBER_ID: ${ENV.PHONE_NUMBER_ID ? "OK" : "MISSING"}`,
    `ENV VERIFY_TOKEN: ${ENV.VERIFY_TOKEN ? "OK" : "MISSING"}`,
    `ENV META_VERSION: ${ENV.META_VERSION}`,
    `ENV APP_SECRET(signature): ${ENV.APP_SECRET ? "OK" : "OFF"}`,
    `AI_MODEL_TEXT: ${ENV.AI_MODEL_TEXT}`,
    `AI_MODEL_VISION: ${ENV.AI_MODEL_VISION}`,
    `AI_MODEL_TRANSCRIBE: ${ENV.AI_MODEL_TRANSCRIBE}`,
    `ENABLE_VOICE_TRANSCRIPTION: ${ENV.ENABLE_VOICE_TRANSCRIPTION}`,
    `ENABLE_PDF_QUOTES: ${ENV.ENABLE_PDF_QUOTES}`,
    `TYPING_SIMULATION: ${ENV.TYPING_SIMULATION}`,
    `ZOHO_DC: ${ZOHO.DC}`,
    `ZOHO_CLIENT_ID: ${ZOHO.CLIENT_ID ? "OK" : "MISSING"}`,
    `ZOHO_CLIENT_SECRET: ${ZOHO.CLIENT_SECRET ? "OK" : "MISSING"}`,
    `ZOHO_REDIRECT_URI: ${ZOHO.REDIRECT_URI ? "OK" : "MISSING"}`,
    `ZOHO_REFRESH_TOKEN: ${ZOHO.REFRESH_TOKEN ? "OK" : "MISSING"}`,
  ];
  for (const l of lines) logInfo(l);
}

app.listen(PORT, () => {
  envStatus();
  logInfo(`Server running on port ${PORT}`);
});
