// index.js - WhatsApp IA HubSpot (Activa Ventanas) - Versión Conversacional/Consultiva
// Node 18+ (Railway) - ESM
import express from "express";
import axios from "axios";
import OpenAI from "openai";
import pdfParse from "pdf-parse";
import PDFDocument from "pdfkit";
import FormData from "form-data";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

// ======================================================
// CONFIG BÁSICA
// ======================================================
const app = express();

// Meta Webhooks envían JSON
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 8080;

const ENV = {
  // Meta / WhatsApp
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  META_VERSION: process.env.META_GRAPH_VERSION || process.env.META_VERSION || "v22.0",

  // OpenAI
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  AI_MODEL_TEXT: process.env.AI_MODEL_TEXT || process.env.MODEL_TEXT || "gpt-4.1-mini",
  AI_MODEL_VISION: process.env.AI_MODEL_VISION || "gpt-4o-mini",
  AI_MODEL_TRANSCRIBE: process.env.AI_MODEL_TRANSCRIBE || "gpt-4o-mini-transcribe",

  // Features
  ENABLE_VOICE_TRANSCRIPTION: truthy(process.env.ENABLE_VOICE_TRANSCRIPTION),
  ENABLE_PDF_QUOTES: truthy(process.env.ENABLE_PDF_QUOTES),
  TYPING_SIMULATION: truthy(process.env.TYPING_SIMULATION),

  // Seguridad / control
  MAX_REPLY_CHARS: Number(process.env.MAX_REPLY_CHARS || 1200),
  DEDUPE_TTL_MS: Number(process.env.DEDUPE_TTL_MS || 5 * 60 * 1000), // 5 min
};

// ======================================================
// IDENTIDAD Y TONO (ACTIVA)
// ======================================================
const BRAND = {
  displayName: "Activa Ventanas",
  legalHint: "Fábrica de Ventanas Activa (Marcelo Cifuentes)",
  city: "Temuco / La Araucanía",
  whatWeDo:
    "Fabricamos e instalamos ventanas y puertas de PVC y aluminio, con termopanel y soluciones para clima frío (aislación térmica/acústica).",
  values: [
    "honorabilidad",
    "respeto",
    "paciencia",
    "claridad",
    "asesoría técnica",
    "venta consultiva",
  ],
  promise:
    "Te guiamos para elegir la mejor solución según frío, ruido, seguridad y presupuesto; sin letra chica.",
  nextSteps:
    "Para cotizar bien pedimos: comuna, tipo de abertura, medidas (ancho x alto), color, tipo de vidrio y si es obra nueva o recambio.",
};

// Este es el “system prompt” que estabas buscando.
// NO es un archivo aparte: está aquí como constante.
const SYSTEM_PROMPT_TEXT = `
Eres el asistente comercial y técnico de ${BRAND.displayName} (${BRAND.legalHint}), en Chile.
Tu objetivo es CONVERSAR de forma humana y consultiva, y convertir el interés en una cotización y visita/levantamiento.

Reglas de tono (estrictas):
- Siempre amable, cercano, con respeto y paciencia. Nada robótico.
- Siempre confirmas lo que el cliente pidió y haces 1-3 preguntas útiles (no 10).
- Si el cliente dice "paso frío", prioriza recomendación técnica: termopanel, Low-E, cámara, sellos, instalación.
- Evita respuestas genéricas. Personaliza con lo que el cliente dijo.
- Nunca inventes datos técnicos o precios como definitivos. Si faltan datos, das rango o “pre-cotización referencial”.
- No uses emojis salvo que el cliente use emojis primero (por defecto: sin emojis).
- No digas “soy un bot” ni “modelo de IA”.
- Si el cliente manda una foto con medidas/lista: reconoce y confirma que leerás la imagen para extraer medidas.
- Si el cliente pide “modelos y precios”: ofrece 2-3 opciones claras y guía a la mejor según necesidad.

Reglas comerciales:
- Buscamos: nombre (si aparece), comuna, tipo (corredera/abatible/oscilobatiente/puerta), medidas ancho x alto, color, vidrio.
- Si pregunta por “2x2 corredera”: pide si es 2 hojas o 4 hojas, y si requiere fijo/mosquitero.
- Si pide “puerta 1.80x2.00”: pide si es 1 hoja o 2 hojas, si una fija y otra móvil, y si quiere cerradura de seguridad.
- Cierra con un siguiente paso: “¿te parece si confirmamos X y Y para enviarte la pre-cotización hoy?”

Formato:
- Mensajes cortos, 2-6 líneas.
- Lista breve solo cuando suma valor.
- Siempre una frase de apertura cálida.
`;

// Prompt de visión: SOLO extraer medidas/tablas de imagen (sin tono vendedor).
const VISION_EXTRACT_PROMPT =
  "Eres un extractor de datos desde imagen (tablas/listas/fotos) para ventanas y puertas.\n" +
  "Devuelve SOLO texto plano, sin saludo, sin explicaciones, sin viñetas.\n" +
  "Formato de salida: UNA LÍNEA POR ÍTEM, exactamente:\n" +
  "QTY x ANCHO_MM x ALTO_MM | MODELO(opcional)\n" +
  "\n" +
  "Reglas:\n" +
  "- Interpreta separadores: 'x', 'X', '*', 'por'.\n" +
  "- Si unidades están en m o cm, convierte a mm.\n" +
  "- Si aparece 1,80 o 1.80 (metros), equivale a 1800 mm.\n" +
  "- Si no indica cantidad, asume QTY=1.\n" +
  "- Si hay 'modelo' (corredera/abatible/oscilobatiente/puerta), ponlo después de '|'.\n" +
  "- Si algo no se ve claro, escribe: NO_CLARO: (qué faltó o qué parte es ilegible).\n" +
  "- No inventes números.";

// ======================================================
// OPENAI CLIENT
// ======================================================
const openai = ENV.OPENAI_API_KEY
  ? new OpenAI({ apiKey: ENV.OPENAI_API_KEY })
  : null;

// ======================================================
// HELPERS
// ======================================================
function truthy(v) {
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on", "si", "sí"].includes(s);
}

function mask(s) {
  if (!s) return "MISSING";
  const str = String(s);
  if (str.length <= 8) return "OK";
  return str.slice(0, 4) + "…" + str.slice(-4);
}

function nowISO() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeStr(s, max = 1200) {
  const t = String(s ?? "").trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// Deduplicación de mensajes para evitar loops/reintentos
const seenMsg = new Map(); // msgId -> timestamp
function dedupe(msgId) {
  const t = Date.now();
  // purge
  for (const [k, ts] of seenMsg.entries()) {
    if (t - ts > ENV.DEDUPE_TTL_MS) seenMsg.delete(k);
  }
  if (seenMsg.has(msgId)) return true;
  seenMsg.set(msgId, t);
  return false;
}

// Sesiones simples (memoria en RAM)
const sessions = new Map(); // wa_id -> session

function getSession(wa_id) {
  const s = sessions.get(wa_id) || {
    wa_id,
    createdAt: nowISO(),
    lastAt: nowISO(),
    turns: [],
    facts: {
      name: null,
      comuna: null,
      product: null, // ventana/puerta
      type: null, // corredera/abatible/oscilobatiente
      color: null,
      glass: null, // dvh/low-e/laminado/etc
      measures: [], // [{qty, w_mm, h_mm, model}]
      notes: [],
    },
  };
  s.lastAt = nowISO();
  sessions.set(wa_id, s);
  return s;
}

function addTurn(session, role, content) {
  session.turns.push({ at: nowISO(), role, content: safeStr(content, 1500) });
  // Mantener las últimas 12 interacciones
  if (session.turns.length > 12) session.turns = session.turns.slice(-12);
}

// ======================================================
// META GRAPH / WHATSAPP API
// ======================================================
const WA_BASE = () => `https://graph.facebook.com/${ENV.META_VERSION}`;

async function waMarkRead(phone_number_id, msg_id) {
  if (!ENV.WHATSAPP_TOKEN || !phone_number_id || !msg_id) return;
  try {
    await axios.post(
      `${WA_BASE()}/${phone_number_id}/messages`,
      { messaging_product: "whatsapp", status: "read", message_id: msg_id },
      { headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` } }
    );
  } catch (_) {}
}

async function waSendText(phone_number_id, to, text) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: safeStr(text, 4096), preview_url: false },
  };

  await axios.post(`${WA_BASE()}/${phone_number_id}/messages`, payload, {
    headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` },
    timeout: 60000,
  });
}

async function waTypingSim(toText) {
  if (!ENV.TYPING_SIMULATION) return;
  const chars = (toText || "").length;
  // 35ms por char aprox, acotado
  const ms = clamp(chars * 35, 700, 3500);
  await sleep(ms);
}

async function waGetMediaUrl(media_id) {
  const r = await axios.get(`${WA_BASE()}/${media_id}`, {
    headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` },
    timeout: 60000,
  });
  return r?.data?.url;
}

async function waDownloadMedia(media_url) {
  const r = await axios.get(media_url, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` },
    timeout: 60000,
  });
  return Buffer.from(r.data);
}

// ======================================================
// PARSERS / EXTRACCIÓN (NO IA)
// ======================================================
function parseMeasuresFromText(text) {
  // Extrae patrones tipo: "2.00 x 2.00", "2000x1800", "1,80 por 2mt"
  const t = String(text || "").toLowerCase();

  // Reemplazos comunes
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

    // Heurística: si unit = m -> mm = *1000 ; si cm -> *10 ; si sin unit:
    // - si a<=10 y b<=10 -> asumir metros
    // - si a>50 -> asumir mm
    // - si a<=50 -> asumir cm (poco probable) -> mejor metros si <=10
    const toMM = (v) => {
      if (unit === "m") return Math.round(v * 1000);
      if (unit === "cm") return Math.round(v * 10);
      if (v <= 10) return Math.round(v * 1000);
      if (v > 50) return Math.round(v);
      return Math.round(v * 10);
    };

    const w_mm = toMM(a);
    const h_mm = toMM(b);
    // evitar basura
    if (w_mm >= 200 && h_mm >= 200 && w_mm <= 6000 && h_mm <= 6000) {
      matches.push({ qty: 1, w_mm, h_mm, model: null });
    }
  }
  return matches;
}

function inferIntent(text) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return "unknown";

  if (t.includes("cotiz") || t.includes("precio") || t.includes("presupuesto"))
    return "quote";
  if (t.includes("inform") || t.includes("catálogo") || t.includes("modelos"))
    return "info";
  if (t.includes("frío") || t.includes("helado") || t.includes("condens"))
    return "cold_problem";
  if (t.includes("vidrio") || t.includes("laminado") || t.includes("templado"))
    return "glass";
  if (t.includes("puerta")) return "door";
  if (t.includes("ventana")) return "window";

  return "general";
}

// ======================================================
// MOTOR PRE-COTIZACIÓN (DETERMINÍSTICO + CONSULTIVO)
// ======================================================
function quoteEngine(session) {
  // Motor simple referencial por m², para que la IA lo explique humano y pida datos faltantes.
  // Ajusta valores a tu realidad luego.
  const facts = session.facts;
  const items = facts.measures || [];
  if (!items.length) return null;

  const color = (facts.color || "").toLowerCase();
  const glass = (facts.glass || "").toLowerCase();
  const type = (facts.type || "").toLowerCase();
  const product = (facts.product || "").toLowerCase();

  // Base por m² (referencial)
  let pricePerM2 = 150000; // blanco base
  if (color.includes("nogal") || color.includes("madera")) pricePerM2 = 160000;
  if (color.includes("negro") || color.includes("grafito")) pricePerM2 = 165000;

  // Ajuste por vidrio
  let glassFactor = 1.0;
  if (glass.includes("low") || glass.includes("low-e")) glassFactor += 0.12;
  if (glass.includes("laminado")) glassFactor += 0.18;
  if (glass.includes("templado")) glassFactor += 0.10;

  // Ajuste por tipología
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
    glass: facts.glass || "Termopanel estándar (DVH) sugerido",
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

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ======================================================
// PDF COTIZACIÓN (OPCIONAL)
// ======================================================
function buildQuotePdfBuffer(quote, session) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      doc.fontSize(16).text(`${BRAND.displayName} - Pre-cotización`, { bold: true });
      doc.moveDown(0.5);

      doc.fontSize(10).text(`Fecha: ${new Date().toLocaleString("es-CL")}`);
      doc.text(`Cliente: ${session.facts.name || session.wa_id}`);
      doc.text(`Comuna: ${session.facts.comuna || "Por confirmar"}`);
      doc.moveDown(0.8);

      doc.fontSize(12).text(`Resumen`, { underline: true });
      doc.fontSize(10).text(`Producto: ${quote.product}`);
      doc.text(`Tipo: ${quote.type}`);
      doc.text(`Color: ${quote.color}`);
      doc.text(`Vidrio: ${quote.glass}`);
      doc.text(`Área total: ${quote.totalArea} m²`);
      doc.text(`Valor referencial: ${quote.pricePerM2.toLocaleString("es-CL")} + IVA / m²`);
      doc.moveDown(0.8);

      doc.fontSize(12).text(`Detalle`, { underline: true });
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

      doc.moveDown(1.2);
      doc.fontSize(10).text(`${BRAND.promise}`);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

async function waUploadMediaPDF(phone_number_id, pdfBuffer, filename = "cotizacion.pdf") {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append("file", pdfBuffer, { filename, contentType: "application/pdf" });

  const r = await axios.post(`${WA_BASE()}/${phone_number_id}/media`, form, {
    headers: {
      Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}`,
      ...form.getHeaders(),
    },
    maxBodyLength: Infinity,
    timeout: 60000,
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
    timeout: 60000,
  });
}

// ======================================================
// OPENAI: TRANSCRIPCIÓN / VISIÓN / RESPUESTA TEXTO
// ======================================================
async function transcribeAudioBuffer(audioBuffer) {
  if (!openai || !ENV.ENABLE_VOICE_TRANSCRIPTION) return null;

  // Guardar temporal para usar ReadStream (más compatible)
  const tmp = path.join(os.tmpdir(), `wa-audio-${crypto.randomUUID()}.ogg`);
  fs.writeFileSync(tmp, audioBuffer);

  try {
    const tr = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmp),
      model: ENV.AI_MODEL_TRANSCRIBE,
    });
    return (tr?.text || "").trim() || null;
  } catch (e) {
    console.error("transcribeAudio error:", e?.message || e);
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

async function extractFromImageBuffer(imageBuffer) {
  if (!openai) return null;

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
    if (!out || out.includes("NO_CLARO")) return { raw: out, items: [] };

    // Parse salida: "QTY x ANCHO x ALTO | MODELO"
    const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
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
    console.error("extractFromImage error:", e?.message || e);
    return null;
  }
}

async function aiComposeReply({ session, userText, quote }) {
  if (!openai) {
    // Fallback sin IA (no debería pasar si pagas IA)
    return `Hola, gracias por escribirnos. Para ayudarte a cotizar, indícame comuna, tipo (corredera/abatible/oscilobatiente), medidas (ancho x alto) y color.`;
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
          "- Resuelve lo preguntado y pide SOLO lo mínimo que falta.\n" +
          "- Si hay pre-cotización disponible, entrégala clara y breve + disclaimer + siguiente paso.\n" +
          "- Si el cliente reporta frío, recomienda mejoras concretas (DVH/Low-E/instalación) y pregunta 1 dato clave.\n",
      },
    ],
  });

  const out = resp?.choices?.[0]?.message?.content || "";
  return safeStr(out, ENV.MAX_REPLY_CHARS);
}

// ======================================================
// NORMALIZACIÓN DE HECHOS (captura de datos)
// ======================================================
function updateFactsFromText(session, text) {
  const t = String(text || "").trim();
  if (!t) return;

  // Comuna (heurística simple)
  const lc = t.toLowerCase();
  const comunaHints = ["temuco", "padre las casas", "villarrica", "pucón", "cunco", "labranza", "imperial", "carahue"];
  for (const c of comunaHints) {
    if (lc.includes(c)) session.facts.comuna = toTitle(c);
  }

  // Color
  if (lc.includes("blanco")) session.facts.color = "Blanco";
  if (lc.includes("nogal")) session.facts.color = "Nogal";
  if (lc.includes("grafito")) session.facts.color = "Grafito";
  if (lc.includes("negro")) session.facts.color = "Negro";

  // Tipo / producto
  if (lc.includes("corredera")) session.facts.type = "Corredera";
  if (lc.includes("abatible")) session.facts.type = "Abatible";
  if (lc.includes("oscil")) session.facts.type = "Oscilobatiente";
  if (lc.includes("puerta")) session.facts.product = "Puerta";
  if (lc.includes("ventana")) session.facts.product = "Ventana";

  // Vidrio
  if (lc.includes("termopanel") || lc.includes("dvh")) session.facts.glass = "Termopanel (DVH)";
  if (lc.includes("low-e") || lc.includes("low e") || lc.includes("low")) {
    session.facts.glass = "Termopanel (DVH) con Low-E";
  }
  if (lc.includes("laminado")) session.facts.glass = "Laminado";
  if (lc.includes("templado")) session.facts.glass = "Templado";

  // Medidas desde texto
  const parsed = parseMeasuresFromText(t);
  if (parsed.length) {
    // si ya había, sumamos sin duplicar exactos
    const key = (x) => `${x.qty}|${x.w_mm}|${x.h_mm}|${x.model || ""}`;
    const existing = new Set((session.facts.measures || []).map(key));
    for (const it of parsed) {
      if (!existing.has(key(it))) session.facts.measures.push(it);
    }
  }
}

function toTitle(s) {
  return String(s)
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

// ======================================================
// WEBHOOKS
// ======================================================
app.get("/health", (req, res) => res.status(200).send("ok"));

// Verificación de webhook (Meta)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === ENV.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Recepción de eventos
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    // Confirmar rápido a Meta
    res.sendStatus(200);

    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0]?.value;

    const phone_number_id =
      changes?.metadata?.phone_number_id || ENV.PHONE_NUMBER_ID;

    const messages = changes?.messages;
    if (!messages || !messages.length) return;

    const contacts = changes?.contacts || [];
    const contact = contacts[0];
    const wa_id = contact?.wa_id || messages[0]?.from;

    for (const msg of messages) {
      const msg_id = msg?.id;
      if (!msg_id) continue;

      // Dedupe: evita loops por reintentos
      if (dedupe(msg_id)) continue;

      // Mark read ASAP
      await waMarkRead(phone_number_id, msg_id);

      // Sesión
      const session = getSession(wa_id);

      // Intentar capturar nombre
      const profileName = contact?.profile?.name;
      if (profileName && !session.facts.name) session.facts.name = profileName;

      // Procesar por tipo
      let userText = "";

      // TEXT
      if (msg.type === "text") {
        userText = msg?.text?.body || "";
      }

      // IMAGE
      else if (msg.type === "image") {
        const media_id = msg?.image?.id;
        userText = msg?.image?.caption || "Imagen enviada";
        if (media_id) {
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
        }
      }

      // AUDIO / VOICE
      else if (msg.type === "audio" || msg.type === "voice") {
        const media_id = msg?.audio?.id || msg?.voice?.id;
        userText = "Audio recibido.";
        if (media_id && ENV.ENABLE_VOICE_TRANSCRIPTION) {
          const url = await waGetMediaUrl(media_id);
          const buf = await waDownloadMedia(url);
          const tr = await transcribeAudioBuffer(buf);
          if (tr) {
            userText = `Audio transcrito: ${tr}`;
            session.facts.notes.push("Audio transcrito.");
          } else {
            session.facts.notes.push("Audio recibido (sin transcripción).");
          }
        }
      }

      // DOCUMENT (PDF/otros)
      else if (msg.type === "document") {
        const media_id = msg?.document?.id;
        const filename = msg?.document?.filename || "documento";
        userText = `Documento recibido: ${filename}`;
        if (media_id && filename.toLowerCase().endsWith(".pdf")) {
          const url = await waGetMediaUrl(media_id);
          const buf = await waDownloadMedia(url);
          const parsed = await pdfParse(buf);
          const txt = (parsed?.text || "").trim();
          if (txt) {
            userText += `\nResumen PDF (extracto):\n${txt.slice(0, 1200)}`;
            session.facts.notes.push("PDF recibido y leído.");
          } else {
            session.facts.notes.push("PDF recibido, sin texto extraíble.");
          }
        }
      }

      else {
        userText = "Mensaje recibido.";
      }

      // Registrar turno usuario
      addTurn(session, "user", userText);

      // Actualizar hechos desde texto
      updateFactsFromText(session, userText);

      // Si hay medidas y no hay vidrio definido, sugerir DVH
      if (session.facts.measures.length && !session.facts.glass) {
        session.facts.glass = "Termopanel (DVH)";
      }

      // Generar pre-cotización si hay medidas
      const quote = quoteEngine(session);

      // IA compone respuesta humana
      const reply = await aiComposeReply({ session, userText, quote });

      addTurn(session, "assistant", reply);

      // Enviar con typing simulation
      await waTypingSim(reply);
      await waSendText(phone_number_id, wa_id, reply);

      // Si cliente pide PDF y está habilitado + hay quote
      if (
        ENV.ENABLE_PDF_QUOTES &&
        quote &&
        /pdf/i.test(userText)
      ) {
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
          console.error("PDF flow error:", e?.message || e);
        }
      }
    }
  } catch (e) {
    // Ojo: ya respondimos 200 arriba, aquí solo log
    console.error("Webhook error:", e?.message || e);
  }
});

// ======================================================
// STARTUP LOGS
// ======================================================
function envStatus() {
  const lines = [
    "Starting Container",
    `ENV OPENAI_API_KEY: ${ENV.OPENAI_API_KEY ? "OK" : "MISSING"}`,
    `ENV WHATSAPP_TOKEN: ${ENV.WHATSAPP_TOKEN ? "OK" : "MISSING"}`,
    `ENV PHONE_NUMBER_ID: ${ENV.PHONE_NUMBER_ID ? "OK" : "MISSING"}`,
    `ENV VERIFY_TOKEN: ${ENV.VERIFY_TOKEN ? "OK" : "MISSING"}`,
    `ENV META_GRAPH_VERSION: ${ENV.META_VERSION}`,
    `AI_MODEL_TEXT: ${ENV.AI_MODEL_TEXT}`,
    `AI_MODEL_VISION: ${ENV.AI_MODEL_VISION}`,
    `ENABLE_VOICE_TRANSCRIPTION: ${ENV.ENABLE_VOICE_TRANSCRIPTION}`,
    `ENABLE_PDF_QUOTES: ${ENV.ENABLE_PDF_QUOTES}`,
    `TYPING_SIMULATION: ${ENV.TYPING_SIMULATION}`,
  ];
  for (const l of lines) console.log(l);
}

app.listen(PORT, () => {
  envStatus();
  console.log(`Server running on port ${PORT}`);
});
