// index.js (ESM) - WhatsApp IA + Cotización + PDF + Voz (Activa Inversiones)
// Node 18.20+
// Railway: responde 200 inmediato y procesa asíncrono

import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import OpenAI from "openai";
import FormData from "form-data";
import PDFDocument from "pdfkit";
import { Readable } from "stream";

dotenv.config();

const app = express();
app.use(express.json({ limit: "20mb" }));

// =====================
// ENV / CONFIG
// =====================
const PORT = process.env.PORT || 8080;

const META_VERSION = process.env.META_GRAPH_VERSION || "v22.0";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AI_MODEL_TEXT = process.env.AI_MODEL_OPENAI || process.env.AI_MODEL_TEXT || "gpt-4.1-mini";

const TYPING_SIMULATION = String(process.env.TYPING_SIMULATION || "true").toLowerCase() === "true";
const ENABLE_PDF_QUOTES = String(process.env.ENABLE_PDF_QUOTES || "true").toLowerCase() === "true";
const ENABLE_VOICE_TRANSCRIPTION = String(process.env.ENABLE_VOICE_TRANSCRIPTION || "true").toLowerCase() === "true";

if (!WHATSAPP_TOKEN) console.warn("ENV WHATSAPP_TOKEN: MISSING");
if (!VERIFY_TOKEN) console.warn("ENV VERIFY_TOKEN: MISSING");
if (!PHONE_NUMBER_ID) console.warn("ENV PHONE_NUMBER_ID: MISSING");
if (!OPENAI_API_KEY) console.warn("ENV OPENAI_API_KEY: MISSING");

const WA_BASE = `https://graph.facebook.com/${META_VERSION}/${PHONE_NUMBER_ID}`;

// Cliente OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Axios defaults
axios.defaults.timeout = 25000;

// =====================
// Utilidades
// =====================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nowIso() {
  return new Date().toISOString();
}

function clampText(s, max = 3500) {
  if (!s) return "";
  const t = String(s);
  return t.length <= max ? t : t.slice(0, max - 3) + "...";
}

// Dedupe simple
const seenMessageIds = new Map(); // msgId -> ts
function markSeen(msgId) {
  if (!msgId) return false;
  const t = Date.now();
  // Limpieza TTL 10 min
  for (const [k, v] of seenMessageIds.entries()) {
    if (t - v > 10 * 60 * 1000) seenMessageIds.delete(k);
  }
  if (seenMessageIds.has(msgId)) return true;
  seenMessageIds.set(msgId, t);
  return false;
}

// Sesiones por cliente
const sessions = new Map(); // waId -> { data, lastQuote, lastAskedMissing, updatedAt }
function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      data: {},
      lastQuote: null,
      lastAskedMissing: null,
      updatedAt: Date.now(),
    });
  }
  const s = sessions.get(waId);
  s.updatedAt = Date.now();
  return s;
}

// =====================
// Precios / Reglas comerciales (inicial)
// =====================
const IVA_RATE = 0.19;

const PRICE_M2 = {
  blanco: 150000,
  roble: 160000,
  nogal: 160000,
  grafito: 170000,
  negro: 170000,
};

const PVC_EURO_COLORS = ["blanco", "roble", "roble dorado", "nogal", "grafito", "negro"];
const PVC_US_COLORS = ["blanco"];

// Normaliza color a clave base
function normalizeColor(raw) {
  if (!raw) return null;
  const c = String(raw).toLowerCase().trim();

  if (c.includes("roble")) return "roble";
  if (c.includes("nogal")) return "nogal";
  if (c.includes("grafit")) return "grafito";
  if (c.includes("negro")) return "negro";
  if (c.includes("blanc")) return "blanco";

  return null;
}

// Normaliza sistema/marco
function normalizeSystem(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();

  if (s.includes("alum")) return "aluminio";
  if (s.includes("americano")) return "pvc_americano";
  if (s.includes("europe") || s.includes("euro")) return "pvc_europeo";
  if (s.includes("pvc")) return "pvc_europeo";
  return null;
}

function normalizeOpening(raw) {
  if (!raw) return null;
  const t = String(raw).toLowerCase();
  if (t.includes("corre")) return "corredera";
  if (t.includes("abat")) return "abatible";
  if (t.includes("proyect")) return "proyectante";
  if (t.includes("fija")) return "fija";
  if (t.includes("puerta")) return "puerta";
  return null;
}

function isPdfRequest(text) {
  const t = (text || "").toLowerCase();
  return t.includes("pdf") || t.includes("adjunt") || t.includes("archivo");
}

function isReset(text) {
  const t = (text || "").toLowerCase().trim();
  return t === "reset" || t === "/reset" || t.includes("reinicia");
}

// =====================
// WhatsApp API helpers
// =====================
async function waSendText(to, text, { replyToMessageId = null } = {}) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: clampText(text) },
  };
  if (replyToMessageId) payload.context = { message_id: replyToMessageId };

  const headers = {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    "Content-Type": "application/json",
  };

  // reintentos básicos
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      return await axios.post(`${WA_BASE}/messages`, payload, { headers, timeout: 15000 });
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;
      const data = e?.response?.data;
      console.error("waSendText error retry", { i, status, data });
      await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

// Indicador typing (opcional). Meta no tiene "typing on" real; aquí marcamos como "read" para simular actividad.
// Si esto te molesta, lo desactivas con TYPING_SIMULATION=false
async function waTypingIndicator(messageId, type = "text") {
  if (!TYPING_SIMULATION) return;
  if (!messageId) return;

  const payload = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
    typing_indicator: { type },
  };

  const headers = {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    "Content-Type": "application/json",
  };

  try {
    await axios.post(`${WA_BASE}/messages`, payload, { headers, timeout: 15000 });
  } catch {
    // silencioso
  }
}

// Subir media a WhatsApp (/media) -> media_id
async function waUploadMedia(buffer, mimeType, filename = "archivo.pdf") {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", buffer, { filename, contentType: mimeType });

  const headers = {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    ...form.getHeaders(),
  };

  const res = await axios.post(`${WA_BASE}/media`, form, {
    headers,
    maxBodyLength: Infinity,
    timeout: 60000,
  });

  return res?.data?.id;
}

// Enviar documento por WhatsApp (requiere media_id)
async function waSendDocument(to, mediaId, filename, caption = "") {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: {
      id: mediaId,
      filename,
      caption: clampText(caption, 900),
    },
  };

  const headers = {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    "Content-Type": "application/json",
  };

  return axios.post(`${WA_BASE}/messages`, payload, { headers, timeout: 20000 });
}

// Descargar media (para audio)
async function waGetMediaUrl(mediaId) {
  const headers = { Authorization: `Bearer ${WHATSAPP_TOKEN}` };
  const res = await axios.get(`https://graph.facebook.com/${META_VERSION}/${mediaId}`, { headers, timeout: 20000 });
  return res?.data?.url;
}

async function waDownloadMedia(mediaUrl) {
  const headers = { Authorization: `Bearer ${WHATSAPP_TOKEN}` };
  const res = await axios.get(mediaUrl, { headers, responseType: "arraybuffer", timeout: 40000 });
  return Buffer.from(res.data);
}

// =====================
// PDF (Cotización Automática)
// =====================
async function generateQuotePDF({ customerName, waId, comuna, items, system, color, openingType, notes, totals }) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 40 });
    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    doc.fontSize(18).text("Pre-Cotización Referencial", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).text("Fábrica de Ventanas Activa (Activa Inversiones)", { align: "center" });
    doc.fontSize(9).text(`Fecha: ${new Date().toLocaleString("es-CL")} | ID: ${waId}`, { align: "center" });

    doc.moveDown(1);

    doc.fontSize(12).text("Datos del cliente", { underline: true });
    doc.fontSize(10).text(`Cliente: ${customerName || "Cliente WhatsApp"}`);
    doc.text(`WhatsApp: ${waId}`);
    if (comuna) doc.text(`Comuna/Sector: ${comuna}`);
    if (system) doc.text(`Sistema marco: ${system}`);
    if (color) doc.text(`Color: ${color}`);
    if (openingType) doc.text(`Tipo apertura: ${openingType}`);
    doc.moveDown(0.8);

    doc.fontSize(12).text("Detalle", { underline: true });
    doc.moveDown(0.4);

    // Tabla simple
    doc.fontSize(9);
    doc.text("Ítem", 40, doc.y, { continued: true });
    doc.text("Medidas (mm)", 90, doc.y, { continued: true });
    doc.text("Cant.", 180, doc.y, { continued: true });
    doc.text("m²", 230, doc.y, { continued: true });
    doc.text("Precio/m²", 280, doc.y, { continued: true });
    doc.text("Subtotal", 360, doc.y);

    doc.moveDown(0.4);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.4);

    items.forEach((it, idx) => {
      doc.text(String(idx + 1), 40, doc.y, { continued: true });
      doc.text(`${it.w_mm} x ${it.h_mm}`, 90, doc.y, { continued: true });
      doc.text(String(it.qty), 180, doc.y, { continued: true });
      doc.text(it.area_m2.toFixed(2), 230, doc.y, { continued: true });
      doc.text(`$${it.price_m2.toLocaleString("es-CL")}`, 280, doc.y, { continued: true });
      doc.text(`$${it.subtotal.toLocaleString("es-CL")}`, 360, doc.y);
    });

    doc.moveDown(0.8);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.6);

    doc.fontSize(11).text("Totales", { underline: true });
    doc.fontSize(10).text(`Neto: $${totals.net.toLocaleString("es-CL")}`);
    doc.text(`IVA (19%): $${totals.iva.toLocaleString("es-CL")}`);
    doc.text(`Total: $${totals.total.toLocaleString("es-CL")}`);

    doc.moveDown(0.8);
    doc.fontSize(9).text(
      notes ||
        "Cotización referencial sujeta a verificación de medidas en terreno, especificaciones finales, y condiciones de instalación."
    );

    doc.moveDown(0.8);
    doc.fontSize(9).text(
      "Incluye: Termopanel estándar (DVH) + enfoque en hermeticidad y confort. Opciones avanzadas (control solar/seguridad/Low-E) disponibles a solicitud."
    );

    doc.end();
  });
}

// =====================
// Voz (Whisper)
// =====================
async function transcribeVoice(buffer) {
  const file = await OpenAI.toFile(Readable.from(buffer), "voice.ogg");
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
  });
  return transcription?.text || "";
}

// =====================
// Extracción de datos (IA + fallback)
// =====================

// Fallback: extrae medidas como 1200x1500, 1200 x 1500, 1200*1500
function extractMeasuresFallback(text) {
  const t = text || "";
  const re = /(\d{2,4})\s*[xX\*]\s*(\d{2,4})(?:\s*(?:mm|milimetros|milímetros))?/g;
  const items = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    const w = parseInt(m[1], 10);
    const h = parseInt(m[2], 10);
    if (Number.isFinite(w) && Number.isFinite(h)) {
      items.push({ w_mm: w, h_mm: h, qty: 1 });
    }
  }
  return items;
}

function extractQtyFallback(text) {
  const t = (text || "").toLowerCase();
  // "son 2", "2 ventanas", "x2"
  const m1 = t.match(/\bson\s+(\d{1,2})\b/);
  if (m1) return parseInt(m1[1], 10);

  const m2 = t.match(/\b(\d{1,2})\s*(?:ventanas|puertas|unidades|uds|ud)\b/);
  if (m2) return parseInt(m2[1], 10);

  const m3 = t.match(/\bx\s*(\d{1,2})\b/);
  if (m3) return parseInt(m3[1], 10);

  return null;
}

function extractComunaFallback(text) {
  const t = (text || "").toLowerCase();
  // Lista mínima (ampliable)
  const comunas = ["temuco", "padre las casas", "villarrica", "pucon", "pucón", "lautaro", "freire", "carahue"];
  for (const c of comunas) {
    if (t.includes(c)) return c.replace("pucón", "pucon");
  }
  return null;
}

async function parseUserInputWithAI(userText) {
  if (!OPENAI_API_KEY) return null;

  const system = `
Eres un asistente comercial experto en ventanas/puertas. Debes extraer datos estructurados para cotizar SIN hacer bucles.
Devuelve SOLO JSON válido (sin markdown) con este esquema:

{
  "intent": "quote" | "info" | "pdf" | "reset" | "other",
  "customer_name": string|null,
  "comuna": string|null,
  "system": "pvc_europeo"|"pvc_americano"|"aluminio"|null,
  "color": string|null,
  "opening_type": "corredera"|"abatible"|"proyectante"|"fija"|"puerta"|null,
  "installation": "si"|"no"|null,
  "items": [{"w_mm": number, "h_mm": number, "qty": number}],
  "notes": string|null
}

Reglas:
- Si hay medidas en formato 1200x1500 o "1200 1500" interpretarlo como ancho x alto en mm.
- Si no hay color, deja null (no inventes).
- Si no hay sistema, deja null (no inventes).
- Si el usuario pide "pdf", intent="pdf".
- Si el usuario dice reset, intent="reset".
- No escribas texto, solo JSON.
`.trim();

  try {
    const res = await openai.chat.completions.create({
      model: AI_MODEL_TEXT,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText || "" },
      ],
      response_format: { type: "json_object" },
    });

    const content = res?.choices?.[0]?.message?.content;
    if (!content) return null;

    return JSON.parse(content);
  } catch (e) {
    console.error("AI parse error:", e?.message || e);
    return null;
  }
}

// =====================
// Motor de cotización (sin loops)
// =====================
function computeQuote({ items, colorKey }) {
  const price_m2 = PRICE_M2[colorKey] || PRICE_M2.blanco;

  const detailed = items.map((it) => {
    const area_unit = (it.w_mm * it.h_mm) / 1_000_000; // mm2 -> m2
    const area = area_unit * (it.qty || 1);
    const subtotal = Math.round(area * price_m2);
    return {
      ...it,
      area_m2: area,
      price_m2,
      subtotal,
    };
  });

  const net = detailed.reduce((acc, it) => acc + it.subtotal, 0);
  const iva = Math.round(net * IVA_RATE);
  const total = net + iva;

  return {
    items: detailed,
    totals: { net, iva, total },
  };
}

function buildQuoteText({ customerName, comuna, system, colorKey, openingType, installation, quote }) {
  const sysLabel =
    system === "pvc_europeo"
      ? "PVC europeo"
      : system === "pvc_americano"
      ? "PVC americano"
      : system === "aluminio"
      ? "Aluminio"
      : "PVC europeo";

  const colorLabel = colorKey ? colorKey : "blanco";
  const openLabel = openingType ? openingType : "corredera";

  const lines = [];
  lines.push(`Hola, le habla Marcelo Cifuentes (Fábrica de Ventanas Activa).`);
  if (comuna) lines.push(`Pre-cotización referencial para ${comuna}.`);
  lines.push(`Sistema: ${sysLabel} | Color: ${colorLabel} | Apertura: ${openLabel} | Vidrio: Termopanel estándar (DVH).`);
  if (installation) lines.push(`Instalación: ${installation === "si" ? "incluida" : "no incluida"}.`);
  lines.push("");
  lines.push("Detalle:");
  quote.items.forEach((it, idx) => {
    lines.push(` ${idx + 1}) ${it.qty} un — ${it.w_mm}x${it.h_mm} mm — ${it.area_m2.toFixed(2)} m² — Subtotal $${it.subtotal.toLocaleString("es-CL")}`);
  });
  lines.push("");
  lines.push(`Neto: $${quote.totals.net.toLocaleString("es-CL")} | IVA: $${quote.totals.iva.toLocaleString("es-CL")} | Total: $${quote.totals.total.toLocaleString("es-CL")}`);
  lines.push("");
  lines.push("Nota: valores referenciales sujetos a confirmación de medidas en terreno y especificaciones finales.");
  lines.push("Si desea, puedo adjuntar la misma cotización en PDF.");

  return lines.join("\n");
}

function missingFieldsForQuote(data) {
  const missing = [];

  // Items/medidas
  if (!Array.isArray(data.items) || data.items.length === 0) missing.push("medidas (ancho x alto en mm) y cantidad");

  // Comuna/sector (para logística)
  if (!data.comuna) missing.push("comuna/sector de instalación");

  return missing;
}

function applyDefaults(data) {
  const out = { ...data };

  // default system
  if (!out.system) out.system = "pvc_europeo";

  // default opening (si no viene y hablan de ventana, deja null para no asumir; pero para cotizar base usamos corredera si no hay info)
  // lo definimos al construir el texto

  // color: no forzamos, pero si falta, cotizaremos dos opciones (blanco y nogal) en vez de inventar

  // installation: si no viene, null

  // termopanel estándar siempre, por ahora

  return out;
}

// =====================
// Mensajería principal (sin loops)
// =====================
async function handleInboundText({ waId, messageId, text }) {
  const session = getSession(waId);

  if (isReset(text)) {
    session.data = {};
    session.lastQuote = null;
    session.lastAskedMissing = null;
    await waSendText(waId, "Listo. Reinicié su sesión. Envíeme: comuna/sector + medidas (mm) + cantidad. Ej: “Temuco 2 ventanas 1200x1500”.", { replyToMessageId: messageId });
    return;
  }

  // Si pide PDF y existe cotización previa
  if (ENABLE_PDF_QUOTES && isPdfRequest(text) && session.lastQuote?.pdfReady) {
    const { pdfBuffer, filename, caption } = session.lastQuote.pdfReady;
    const mediaId = await waUploadMedia(pdfBuffer, "application/pdf", filename);
    await waSendDocument(waId, mediaId, filename, caption);
    return;
  }

  await waTypingIndicator(messageId, "text");

  // Parse IA (si falla, fallback)
  let parsed = await parseUserInputWithAI(text);
  if (!parsed) parsed = { intent: "other", items: [], notes: null };

  // Fallback completar
  const fbMeasures = extractMeasuresFallback(text);
  if (!parsed.items || parsed.items.length === 0) parsed.items = fbMeasures;

  // qty fallback
  const fbQty = extractQtyFallback(text);
  if (fbQty && parsed.items && parsed.items.length > 0) {
    // si hay solo 1 medida, aplica cantidad a esa medida
    if (parsed.items.length === 1) parsed.items[0].qty = fbQty;
  }

  // comuna fallback
  if (!parsed.comuna) parsed.comuna = extractComunaFallback(text);

  // normalizaciones
  parsed.system = normalizeSystem(parsed.system) || normalizeSystem(text);
  parsed.color = parsed.color || text;
  parsed.opening_type = parsed.opening_type || normalizeOpening(text);
  parsed.installation = parsed.installation || (text.toLowerCase().includes("instal") ? "si" : null);

  // Guardar en sesión (merge)
  const merged = {
    ...session.data,
    customer_name: parsed.customer_name ?? session.data.customer_name ?? null,
    comuna: parsed.comuna ?? session.data.comuna ?? null,
    system: parsed.system ?? session.data.system ?? null,
    color: parsed.color ?? session.data.color ?? null,
    opening_type: parsed.opening_type ?? session.data.opening_type ?? null,
    installation: parsed.installation ?? session.data.installation ?? null,
    items: (parsed.items && parsed.items.length ? parsed.items : session.data.items) ?? [],
    notes: parsed.notes ?? session.data.notes ?? null,
  };

  session.data = applyDefaults(merged);

  // Si el usuario pide PDF pero aún no hay quote, seguimos a cotizar si se puede
  if (parsed.intent === "pdf" && session.lastQuote?.pdfReady) {
    const { pdfBuffer, filename, caption } = session.lastQuote.pdfReady;
    const mediaId = await waUploadMedia(pdfBuffer, "application/pdf", filename);
    await waSendDocument(waId, mediaId, filename, caption);
    return;
  }

  // Ver qué falta
  const missing = missingFieldsForQuote(session.data);

  // Si falta algo, preguntar MINIMO y evitar loop (no repetir lo mismo)
  if (missing.length > 0) {
    const key = missing.join("|");
    if (session.lastAskedMissing === key) {
      // Ya se lo preguntamos: ofrecer ejemplo claro + salida humana
      await waSendText(
        waId,
        `Para cotizar hoy necesito solo:\n- ${missing.join("\n- ")}\n\nEjemplo rápido: “Temuco 2 ventanas 1200x1500” (mm).\nSi prefiere, envíe una foto de las medidas y lo reviso.`,
        { replyToMessageId: messageId }
      );
      return;
    }
    session.lastAskedMissing = key;
    await waSendText(
      waId,
      `Para cotizar de inmediato, indíqueme:\n- ${missing.join("\n- ")}\nEj: “Temuco 2 ventanas 1200x1500”.`,
      { replyToMessageId: messageId }
    );
    return;
  }

  // Ya tenemos lo mínimo: cotizar altiro
  const colorKey = normalizeColor(session.data.color);

  // Si no hay color claro, cotizamos 2 opciones base (blanco y nogal)
  if (!colorKey) {
    const quoteWhite = computeQuote({ items: session.data.items, colorKey: "blanco" });
    const quoteNogal = computeQuote({ items: session.data.items, colorKey: "nogal" });

    const baseText = [
      `Hola, le habla Marcelo Cifuentes (Fábrica de Ventanas Activa).`,
      `Pre-cotización referencial para ${session.data.comuna}.`,
      `Base: ${session.data.system === "aluminio" ? "Aluminio" : session.data.system === "pvc_americano" ? "PVC americano" : "PVC europeo"} | Vidrio: Termopanel estándar (DVH).`,
      "",
      `Como no indicó color, le dejo 2 opciones base:`,
      "",
      `OPCIÓN A — Blanco ($${PRICE_M2.blanco.toLocaleString("es-CL")} + IVA / m²)`,
      `Neto: $${quoteWhite.totals.net.toLocaleString("es-CL")} | IVA: $${quoteWhite.totals.iva.toLocaleString("es-CL")} | Total: $${quoteWhite.totals.total.toLocaleString("es-CL")}`,
      "",
      `OPCIÓN B — Nogal ($${PRICE_M2.nogal.toLocaleString("es-CL")} + IVA / m²)`,
      `Neto: $${quoteNogal.totals.net.toLocaleString("es-CL")} | IVA: $${quoteNogal.totals.iva.toLocaleString("es-CL")} | Total: $${quoteNogal.totals.total.toLocaleString("es-CL")}`,
      "",
      `Si me confirma el color exacto (blanco/nogal/roble/grafito/negro), le cierro la cotización final. Si desea, se la adjunto en PDF.`,
    ].join("\n");

    // guardar última cotización (la de blanco por defecto para PDF si piden)
    session.lastQuote = {
      dataSnapshot: { ...session.data, colorKey: "blanco" },
      quote: quoteWhite,
      pdfReady: null,
    };

    // preparar PDF (blanco) para cuando pidan
    if (ENABLE_PDF_QUOTES) {
      const customerName = session.data.customer_name || "Cliente";
      const openingType = session.data.opening_type || "corredera";
      const sysLabel = session.data.system;
      const pdf = await generateQuotePDF({
        customerName,
        waId,
        comuna: session.data.comuna,
        items: quoteWhite.items,
        system: sysLabel,
        color: "blanco",
        openingType,
        notes: "Cotización referencial (base blanco). Si confirma color final, ajustamos al valor correspondiente.",
        totals: quoteWhite.totals,
      });

      session.lastQuote.pdfReady = {
        pdfBuffer: pdf,
        filename: "PreCotizacion_Fabrica_de_Ventanas_Activa.pdf",
        caption: "Adjunto pre-cotización referencial (base blanco).",
      };
    }

    await waSendText(waId, baseText, { replyToMessageId: messageId });
    return;
  }

  // Validación color vs sistema (pvc americano solo blanco)
  const sys = session.data.system || "pvc_europeo";
  if (sys === "pvc_americano" && colorKey !== "blanco") {
    await waSendText(
      waId,
      `Para PVC americano trabajamos solo color blanco. Si necesita ${colorKey}, le recomiendo PVC europeo (colores: blanco/roble/nogal/grafito/negro). ¿Qué prefiere?`,
      { replyToMessageId: messageId }
    );
    return;
  }

  // Calcular cotización
  const quote = computeQuote({ items: session.data.items, colorKey });

  const customerName = session.data.customer_name || "Cliente";
  const comuna = session.data.comuna;
  const openingType = session.data.opening_type || "corredera";
  const installation = session.data.installation;
  const quoteText = buildQuoteText({
    customerName,
    comuna,
    system: sys,
    colorKey,
    openingType,
    installation,
    quote,
  });

  // Guardar quote para PDF posterior
  session.lastQuote = {
    dataSnapshot: { ...session.data, colorKey },
    quote,
    pdfReady: null,
  };

  if (ENABLE_PDF_QUOTES) {
    const pdf = await generateQuotePDF({
      customerName,
      waId,
      comuna,
      items: quote.items,
      system: sys,
      color: colorKey,
      openingType,
      notes: "Cotización referencial sujeta a confirmación de medidas en terreno y especificaciones finales.",
      totals: quote.totals,
    });

    session.lastQuote.pdfReady = {
      pdfBuffer: pdf,
      filename: "PreCotizacion_Fabrica_de_Ventanas_Activa.pdf",
      caption: "Adjunto pre-cotización referencial (sujeta a confirmación en terreno).",
    };
  }

  await waSendText(waId, quoteText, { replyToMessageId: messageId });
}

// =====================
// Webhook Meta
// =====================

// Verificación webhook
app.get("/webhook", (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  } catch {
    return res.sendStatus(403);
  }
});

// Recepción eventos
app.post("/webhook", async (req, res) => {
  // responder inmediato
  res.sendStatus(200);

  try {
    const body = req.body;

    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    const messages = value?.messages || [];
    if (!messages.length) return;

    for (const msg of messages) {
      const waId = msg?.from;
      const messageId = msg?.id;

      if (!waId || !messageId) continue;
      if (markSeen(messageId)) continue;

      // Texto
      if (msg.type === "text") {
        const text = msg?.text?.body || "";
        await handleInboundText({ waId, messageId, text });
        continue;
      }

      // Audio -> transcribir y pasar por el mismo motor
      if (msg.type === "audio" && ENABLE_VOICE_TRANSCRIPTION) {
        const mediaId = msg?.audio?.id;
        if (!mediaId) continue;

        await waTypingIndicator(messageId, "text");

        try {
          const mediaUrl = await waGetMediaUrl(mediaId);
          const buffer = await waDownloadMedia(mediaUrl);
          const transcription = await transcribeVoice(buffer);

          const safeText = transcription?.trim();
          if (!safeText) {
            await waSendText(waId, "Recibí su audio, pero no pude transcribirlo. ¿Me envía las medidas en texto (ej: 1200x1500) y comuna?", { replyToMessageId: messageId });
            continue;
          }

          // Procesar como si fuera texto
          await handleInboundText({ waId, messageId, text: safeText });
        } catch (e) {
          console.error("voice error:", e?.message || e);
          await waSendText(waId, "Recibí su audio. Tuve un problema al procesarlo. ¿Me envía las medidas en texto (ej: 1200x1500) y comuna?", { replyToMessageId: messageId });
        }
        continue;
      }

      // Otros tipos: pedir texto mínimo (sin loops)
      await waSendText(
        waId,
        "Para cotizar rápido, envíeme: comuna/sector + cantidad + medidas (mm) en formato 1200x1500. Si quiere, también color (blanco/nogal/roble/grafito/negro).",
        { replyToMessageId: messageId }
      );
    }
  } catch (e) {
    console.error("webhook handler error:", e?.message || e);
  }
});

// Healthcheck
app.get("/", (_req, res) => {
  res.status(200).send(`OK ${nowIso()}`);
});

app.listen(PORT, () => {
  console.log("Starting Container");
  console.log(`Server running on port ${PORT}`);
  console.log(`ENV META_GRAPH_VERSION: ${META_VERSION}`);
  console.log(`ENV WHATSAPP_TOKEN: ${WHATSAPP_TOKEN ? "OK" : "MISSING"}`);
  console.log(`ENV VERIFY_TOKEN: ${VERIFY_TOKEN ? "OK" : "MISSING"}`);
  console.log(`ENV PHONE_NUMBER_ID: ${PHONE_NUMBER_ID ? "OK" : "MISSING"}`);
  console.log(`ENV OPENAI_API_KEY: ${OPENAI_API_KEY ? "OK" : "MISSING"}`);
  console.log(`AI_MODEL_TEXT: ${AI_MODEL_TEXT}`);
  console.log(`TYPING_SIMULATION: ${TYPING_SIMULATION}`);
  console.log(`ENABLE_PDF_QUOTES: ${ENABLE_PDF_QUOTES}`);
  console.log(`ENABLE_VOICE_TRANSCRIPTION: ${ENABLE_VOICE_TRANSCRIPTION}`);
  console.log("Listening...");
});
