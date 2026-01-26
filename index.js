// index.js - WhatsApp AI Bot (Activa Inversiones / Fábrica de Ventanas Activa)
// FULL: IA consultiva + motor de cotización + PDF (pdfkit) + Voz (Whisper) + Anti-loops + Dedup
import "dotenv/config";
import express from "express";
import axios from "axios";
import FormData from "form-data";
import PDFDocument from "pdfkit";
import mime from "mime-types";
import OpenAI from "openai";
import { Readable } from "stream";
import crypto from "crypto";

const app = express();
app.use(express.json({ limit: "20mb" }));

// =====================
// ENV
// =====================
const PORT = process.env.PORT || 8080;

const ENV = {
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  META_VERSION: process.env.META_GRAPH_VERSION || "v22.0",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  AI_MODEL_TEXT: process.env.AI_MODEL_TEXT || "gpt-4.1-mini",
  ENABLE_VOICE_TRANSCRIPTION: String(process.env.ENABLE_VOICE_TRANSCRIPTION || "true") === "true",
  ENABLE_PDF_QUOTES: String(process.env.ENABLE_PDF_QUOTES || "true") === "true",
  TYPING_SIMULATION: String(process.env.TYPING_SIMULATION || "true") === "true"
};

const WA_BASE = `https://graph.facebook.com/${ENV.META_VERSION}/${ENV.PHONE_NUMBER_ID}`;

const openai = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });

// =====================
// Config negocio (precios/reglas)
// =====================
const IVA_RATE = 0.19;

// Precio neto por m² (CLP)
const PRICE_PER_M2 = {
  blanco: 150000,
  roble: 160000, // roble dorado
  nogal: 160000,
  grafito: 170000,
  negro: 170000
};

const PVC_EURO_COLORS = new Set(["blanco", "roble", "roble dorado", "nogal", "grafito", "negro"]);
const PVC_US_COLORS = new Set(["blanco"]);

const DEFAULT_GLASS = "Termopanel estándar (DVH)";
const DEFAULT_SYSTEM = "PVC europeo";
const DEFAULT_OPENING = "corredera";

// =====================
// Memoria en runtime (simple y efectiva)
// =====================
const sessions = new Map(); // waId -> state
const seenMessageIds = new Map(); // msgId -> timestamp

function now() {
  return Date.now();
}

function pruneSeen() {
  const ttl = 1000 * 60 * 20; // 20 min
  const t = now();
  for (const [id, ts] of seenMessageIds.entries()) {
    if (t - ts > ttl) seenMessageIds.delete(id);
  }
}

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      waId,
      createdAt: now(),
      lastReplyAt: 0,
      lastUserText: "",
      data: {
        city: null,
        region: null,
        installation: null, // true/false/null
        system: null, // PVC europeo / PVC americano / Aluminio
        color: null, // blanco/nogal/...
        opening: null, // corredera/abatible/proyectante/fija/puerta
        glass: DEFAULT_GLASS,
        items: [] // { w_mm, h_mm, qty, label }
      }
    });
  }
  return sessions.get(waId);
}

// =====================
// Util
// =====================
function clampText(s, max = 1800) {
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

function toIntSafe(x) {
  const n = Number(String(x).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normalizeColor(c) {
  if (!c) return null;
  const t = c.trim().toLowerCase();
  if (t.includes("roble")) return "roble";
  if (t.includes("nogal")) return "nogal";
  if (t.includes("graf")) return "grafito";
  if (t.includes("negr")) return "negro";
  if (t.includes("blanc")) return "blanco";
  return t;
}

function normalizeSystem(s) {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  if (t.includes("americano")) return "PVC americano";
  if (t.includes("alumin")) return "Aluminio";
  if (t.includes("euro")) return "PVC europeo";
  if (t === "pvc") return "PVC europeo";
  return null;
}

function normalizeOpening(o) {
  if (!o) return null;
  const t = o.trim().toLowerCase();
  if (t.includes("corre")) return "corredera";
  if (t.includes("abat")) return "abatible";
  if (t.includes("proy")) return "proyectante";
  if (t.includes("fija")) return "fija";
  if (t.includes("puert")) return "puerta";
  return null;
}

function computeAreaM2(w_mm, h_mm, qty = 1) {
  const w = w_mm / 1000;
  const h = h_mm / 1000;
  const area = w * h * qty;
  return Number.isFinite(area) ? area : 0;
}

function money(n) {
  const x = Math.round(Number(n) || 0);
  return x.toLocaleString("es-CL");
}

function summarizeItems(items) {
  if (!items?.length) return "";
  return items
    .map((it, i) => `${i + 1}) ${it.qty || 1}u ${it.w_mm}x${it.h_mm} mm (${computeAreaM2(it.w_mm, it.h_mm, it.qty).toFixed(2)} m²)`)
    .join("\n");
}

// =====================
// WhatsApp API helpers
// =====================
async function waSendText(to, text) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: clampText(text, 3500) }
  };

  await axios.post(`${WA_BASE}/messages`, payload, {
    headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` },
    timeout: 60000
  });
}

async function waUploadMedia(buffer, mimeType, filename = "archivo.pdf") {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", buffer, { filename, contentType: mimeType });

  const res = await axios.post(`${WA_BASE}/media`, form, {
    headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}`, ...form.getHeaders() },
    maxBodyLength: Infinity,
    timeout: 60000
  });

  return res.data?.id;
}

async function waSendDocument(to, mediaId, filename, caption) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: {
      id: mediaId,
      filename: filename || "cotizacion.pdf",
      caption: clampText(caption || "", 900)
    }
  };

  await axios.post(`${WA_BASE}/messages`, payload, {
    headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` },
    timeout: 60000
  });
}

async function waGetMediaUrl(mediaId) {
  const res = await axios.get(`https://graph.facebook.com/${ENV.META_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` },
    timeout: 60000
  });
  return res.data?.url;
}

async function downloadBuffer(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` },
    timeout: 60000
  });
  return Buffer.from(res.data);
}

// =====================
// PDF
// =====================
async function generateQuotePDF(quote) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 40 });
    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    doc.fontSize(18).text("Fábrica de Ventanas Activa", { align: "left" });
    doc.fontSize(10).text("Pre-cotización referencial (sujeta a confirmación en terreno).");
    doc.moveDown(0.5);

    doc.fontSize(12).text(`Cliente (WhatsApp): ${quote.waId}`);
    doc.fontSize(12).text(`Ciudad/Comuna: ${quote.city || "Por confirmar"}`);
    doc.fontSize(12).text(`Sistema: ${quote.system}`);
    doc.fontSize(12).text(`Color: ${quote.color}`);
    doc.fontSize(12).text(`Apertura: ${quote.opening}`);
    doc.fontSize(12).text(`Vidrio: ${quote.glass}`);
    doc.moveDown(0.8);

    doc.fontSize(12).text("Detalle de partidas:", { underline: true });
    doc.moveDown(0.3);

    quote.items.forEach((it, i) => {
      const area = computeAreaM2(it.w_mm, it.h_mm, it.qty);
      doc.fontSize(11).text(
        `${i + 1}) ${it.qty}u - ${it.w_mm} x ${it.h_mm} mm | Área: ${area.toFixed(2)} m² | Neto: $${money(it.net)}`
      );
    });

    doc.moveDown(0.8);
    doc.fontSize(12).text(`Superficie total: ${quote.totalArea.toFixed(2)} m²`);
    doc.fontSize(12).text(`Neto: $${money(quote.net)}`);
    doc.fontSize(12).text(`IVA (19%): $${money(quote.iva)}`);
    doc.fontSize(12).text(`Total: $${money(quote.total)}`);
    doc.moveDown(0.8);

    doc.fontSize(10).text(
      "Notas: Valores referenciales. Confirmación final tras validación de medidas en terreno y especificaciones. " +
        "Podemos asesorar mejoras (control de condensación, hermeticidad, eficiencia).",
      { align: "left" }
    );

    doc.end();
  });
}

// =====================
// Whisper (Voz)
// =====================
async function transcribeVoiceFromBuffer(buffer) {
  const file = await OpenAI.toFile(Readable.from(buffer), "voice.ogg");
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1"
  });
  return transcription.text || "";
}

// =====================
// IA: extractor + redactor (para no verse “bot”)
// =====================
async function aiParseAndCompose({ waId, userText, sessionData }) {
  const schema = {
    name: "activa_whatsapp_intake",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        intent: { type: "string", enum: ["quote", "question", "support", "other"] },
        sentiment: { type: "string", enum: ["calm", "urgent", "angry"] },
        wants_pdf: { type: "boolean" },
        wants_human: { type: "boolean" },
        city: { type: ["string", "null"] },
        system: { type: ["string", "null"], enum: ["PVC europeo", "PVC americano", "Aluminio", null] },
        color: { type: ["string", "null"] },
        opening: { type: ["string", "null"], enum: ["corredera", "abatible", "proyectante", "fija", "puerta", null] },
        installation: { type: ["boolean", "null"] },
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              w_mm: { type: "integer" },
              h_mm: { type: "integer" },
              qty: { type: "integer" },
              label: { type: ["string", "null"] }
            },
            required: ["w_mm", "h_mm", "qty"]
          }
        },
        key_need: {
          type: "string",
          enum: ["none", "city", "measures", "color", "system", "opening", "installation"]
        },
        reply_style: { type: "string", enum: ["warm_consultative", "short_direct"] },
        coaching: { type: "string" }
      },
      required: ["intent", "sentiment", "wants_pdf", "wants_human", "city", "system", "color", "opening", "installation", "items", "key_need", "reply_style", "coaching"]
    }
  };

  const system = `
Eres el asistente comercial de "Fábrica de Ventanas Activa" en Chile.
Objetivo: convertir conversaciones en cotización rápida, humana y consultiva, sin sonar como bot.
Reglas:
- Si el cliente ya dio ciudad/comuna y medidas, entrega PRE-COTIZACIÓN de inmediato aunque falten variables.
- Si falta color, ofrece 2 bases: Blanco y Nogal (para PVC europeo). No te quedes preguntando.
- Vidrio por defecto: Termopanel estándar (DVH). No menciones Low-E/control solar a menos que el cliente lo pida o el dolor sea condensación/frío.
- PVC europeo colores: blanco, roble dorado, nogal, grafito, negro. PVC americano: solo blanco.
- Apertura por defecto si no la dan: corredera (pero indícalo como "asumido").
- Sé cálido: preséntate como Marcelo Cifuentes, sin excesos de agradecimientos.
- Si hay enojo: baja tensión, responde con solución concreta y rápida.
- No entres en loop de preguntas. Máximo 1 pregunta al final, y solo si realmente falta algo para cerrar.
Devuelve JSON según el esquema.`;

  const user = `
Contexto actual (lo que ya sabemos):
${JSON.stringify(sessionData, null, 2)}

Mensaje del cliente:
${userText}
`;

  const resp = await openai.responses.create({
    model: ENV.AI_MODEL_TEXT,
    input: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    response_format: { type: "json_schema", json_schema: schema }
  });

  const text = resp.output_text || "{}";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {
      intent: "other",
      sentiment: "calm",
      wants_pdf: /pdf/i.test(userText),
      wants_human: /humano|marcelo|llam|hablar/i.test(userText),
      city: null,
      system: null,
      color: null,
      opening: null,
      installation: null,
      items: [],
      key_need: "none",
      reply_style: "warm_consultative",
      coaching: ""
    };
  }
  // Normalizaciones extra
  if (parsed.color) parsed.color = normalizeColor(parsed.color);
  return parsed;
}

// =====================
// Motor de cotización
// =====================
function enforceBusinessRules(data) {
  // Defaults
  const system = data.system || DEFAULT_SYSTEM;
  let color = data.color ? normalizeColor(data.color) : null;
  const opening = data.opening || DEFAULT_OPENING;

  // Reglas de colores según sistema
  if (system === "PVC americano") {
    if (color && !PVC_US_COLORS.has(color)) color = "blanco";
    if (!color) color = "blanco";
  }

  if (system === "PVC europeo") {
    // si no viene color, lo manejamos como "opciones" (blanco/nogal) fuera
    if (color && !PVC_EURO_COLORS.has(color)) color = null;
  }

  // aluminio: no restringimos aquí (pero mantenemos tu tabla base por color)
  return { system, color, opening };
}

function pricePerM2ForColor(color) {
  const c = normalizeColor(color || "");
  if (!c) return null;
  if (c === "roble dorado") return PRICE_PER_M2.roble;
  return PRICE_PER_M2[c] ?? null;
}

function buildQuote({ waId, city, system, color, opening, glass, items }) {
  const ppm2 = pricePerM2ForColor(color) ?? PRICE_PER_M2.blanco;

  const lines = items.map((it) => {
    const area = computeAreaM2(it.w_mm, it.h_mm, it.qty);
    const net = area * ppm2;
    return { ...it, area, net: Math.round(net) };
  });

  const totalArea = lines.reduce((a, b) => a + b.area, 0);
  const net = lines.reduce((a, b) => a + b.net, 0);
  const iva = Math.round(net * IVA_RATE);
  const total = net + iva;

  return {
    waId,
    city,
    system,
    color,
    opening,
    glass,
    items: lines,
    totalArea,
    net,
    iva,
    total
  };
}

// =====================
// Respuesta humana (sin verse bot)
// =====================
function composeHumanQuoteText({ nameHint, quote, assumed = {} , includeColorOptions = false }) {
  const who = nameHint || "Hola";
  const header =
    `Hola, le habla Marcelo Cifuentes de Fábrica de Ventanas Activa.\n` +
    `Le preparo una **pre-cotización referencial** para avanzar hoy mismo.`;

  const base =
    `\n\nCiudad/Comuna: ${quote.city || "Por confirmar"}\n` +
    `Sistema: ${quote.system}${assumed.system ? " (asumido)" : ""}\n` +
    `Apertura: ${quote.opening}${assumed.opening ? " (asumida)" : ""}\n` +
    `Vidrio: ${quote.glass}\n` +
    (quote.color ? `Color: ${quote.color}\n` : "");

  const detail =
    `\nDetalle:\n${quote.items
      .map((it, i) => {
        return `${i + 1}) ${it.qty}u ${it.w_mm}x${it.h_mm} mm — ${it.area.toFixed(2)} m² — Neto $${money(it.net)}`;
      })
      .join("\n")}`;

  const totals =
    `\n\nSuperficie total: ${quote.totalArea.toFixed(2)} m²\n` +
    `Neto: $${money(quote.net)}\n` +
    `IVA (19%): $${money(quote.iva)}\n` +
    `Total: $${money(quote.total)}`;

  const closingNotes =
    `\n\nNota: valores referenciales sujetos a confirmación de medidas en terreno y especificaciones finales.`;

  let options = "";
  if (includeColorOptions) {
    options =
      `\n\nComo no me indicó color, le dejo 2 opciones base para que elija:\n` +
      `A) Blanco ($${money(PRICE_PER_M2.blanco)} + IVA / m²)\n` +
      `B) Nogal ($${money(PRICE_PER_M2.nogal)} + IVA / m²)\n`;
  }

  return `${header}${base}${options}${detail}${totals}${closingNotes}\n\n¿Le preparo el PDF y se lo envío por acá?`;
}

function composeOneQuestion(keyNeed, system) {
  // Máximo 1 pregunta para cerrar, no loops.
  switch (keyNeed) {
    case "city":
      return "¿En qué comuna/ciudad se instalarán?";
    case "measures":
      return "¿Me indica las medidas (ancho x alto en mm) y cuántas unidades son?";
    case "installation":
      return "¿La cotización la necesita con instalación o solo fabricación?";
    case "system":
      return "¿Prefiere PVC europeo, PVC americano o aluminio para el marco?";
    case "opening":
      return "¿Las aperturas son corredera, abatible, proyectante, fija o puerta?";
    case "color":
      if (system === "PVC americano") return "En PVC americano solo trabajamos blanco. ¿Le sirve en blanco?";
      return "¿Qué color prefiere: blanco, roble dorado, nogal, grafito o negro?";
    default:
      return null;
  }
}

// =====================
// Webhook Meta (GET/POST)
// =====================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === ENV.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.get("/", (_req, res) => res.status(200).send("OK"));

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    pruneSeen();

    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const messages = value?.messages;
    if (!messages || !messages.length) return;

    const msg = messages[0];
    const waId = msg.from;
    const msgId = msg.id;

    if (seenMessageIds.has(msgId)) return;
    seenMessageIds.set(msgId, now());

    const session = getSession(waId);

    // =============== Obtener texto del usuario (text o voz) ===============
    let userText = "";

    if (msg.type === "text") {
      userText = msg.text?.body || "";
    } else if (msg.type === "audio" || msg.type === "voice") {
      if (!ENV.ENABLE_VOICE_TRANSCRIPTION) {
        await waSendText(waId, "Recibí su audio. En este momento estoy habilitado para texto. ¿Me escribe su solicitud en una línea?");
        return;
      }
      const mediaId = msg.audio?.id || msg.voice?.id;
      if (!mediaId) return;

      const url = await waGetMediaUrl(mediaId);
      const buff = await downloadBuffer(url);
      userText = await transcribeVoiceFromBuffer(buff);
    } else if (msg.type === "image") {
      // Si trae caption lo usamos; si no, pedimos medidas y listo (sin loop)
      userText = msg.image?.caption || "";
      if (!userText) {
        await waSendText(
          waId,
          "Ya vi la imagen. Para cotizar rápido, escríbame por favor: comuna/ciudad + medidas (ancho x alto en mm) + cantidad. Si no tiene color definido, puedo cotizar base en blanco o nogal."
        );
        return;
      }
    } else {
      // Otros tipos (document, sticker, etc.)
      await waSendText(waId, "Recibido. Para avanzar, envíeme comuna/ciudad + medidas (mm) + cantidad, y si desea fabricación o con instalación.");
      return;
    }

    userText = String(userText || "").trim();
    if (!userText) return;

    // Reset explícito
    if (/^\s*(reset|reiniciar|reinicia)\s*$/i.test(userText)) {
      sessions.delete(waId);
      await waSendText(
        waId,
        "Listo. Reinicié la sesión.\nEnvíeme: comuna/sector + medidas (mm) + cantidad.\nSi no tiene color, cotizo base en blanco o nogal."
      );
      return;
    }

    session.lastUserText = userText;

    // =============== IA: extraer variables + decidir tono ===============
    const ai = await aiParseAndCompose({ waId, userText, sessionData: session.data });

    // Merge a sesión (sin borrar lo anterior si AI no trae)
    if (ai.city) session.data.city = ai.city;
    if (ai.system) session.data.system = ai.system;
    if (ai.color) session.data.color = ai.color;
    if (ai.opening) session.data.opening = ai.opening;
    if (typeof ai.installation === "boolean") session.data.installation = ai.installation;
    if (ai.items?.length) {
      // Agrega items nuevos (si repiten, se puede mejorar después; por ahora sumamos)
      for (const it of ai.items) {
        if (it?.w_mm && it?.h_mm) {
          session.data.items.push({
            w_mm: it.w_mm,
            h_mm: it.h_mm,
            qty: it.qty || 1,
            label: it.label || null
          });
        }
      }
    }

    // Si el usuario escribió medidas tipo "1200x1800 2200x1880" sin IA, igual intentamos parse rápido
    if (!ai.items?.length) {
      const matches = userText
        .replace(/,/g, " ")
        .match(/(\d{2,4})\s*[xX]\s*(\d{2,4})(?:\s*(mm|cm|m))?/g);
      if (matches?.length) {
        for (const m of matches) {
          const parts = m.match(/(\d{2,4})\s*[xX]\s*(\d{2,4})/);
          if (!parts) continue;
          const w = toIntSafe(parts[1]);
          const h = toIntSafe(parts[2]);
          if (w && h) session.data.items.push({ w_mm: w, h_mm: h, qty: 1, label: null });
        }
      }
    }

    // Anti-loop: si no hay medidas aún, una sola pregunta y listo
    const haveMeasures = session.data.items.length > 0;
    const haveCity = !!session.data.city;

    // Si cliente está enojado: respuesta inmediata, concreta
    const angryPrefix =
      ai.sentiment === "angry"
        ? "Entiendo perfecto. Vamos a resolverlo ahora, sin vueltas.\n"
        : "";

    // Si pidieron “pdf” y aún no hay datos mínimos, pedir lo mínimo
    const wantsPdf = ai.wants_pdf || /pdf/i.test(userText);

    if (!haveMeasures || !haveCity) {
      const need = !haveCity ? "city" : "measures";
      const q = composeOneQuestion(need, session.data.system || DEFAULT_SYSTEM);
      await waSendText(
        waId,
        angryPrefix +
          `Hola, le habla Marcelo Cifuentes de Fábrica de Ventanas Activa.\n` +
          `Le cotizo rápido apenas tenga 2 datos: comuna/ciudad + medidas.\n` +
          (q ? `\n${q}` : "")
      );
      return;
    }

    // =============== Construir cotización inmediata (sin preguntar de más) ===============
    const enforced = enforceBusinessRules(session.data);
    const systemFinal = enforced.system;
    const openingFinal = enforced.opening;

    // Si no hay color → enviar 2 opciones base (blanco/nogal) y cerrar igual
    const colorFinal = enforced.color; // puede ser null si no indicado o no válido
    const includeColorOptions = !colorFinal;

    // Si no definieron sistema/apertura, lo asumimos (pero lo declaramos)
    const assumed = {
      system: !session.data.system,
      opening: !session.data.opening
    };

    // Para cada opción de color base, si no viene color:
    if (includeColorOptions) {
      const baseItems = session.data.items;

      const qBlanco = buildQuote({
        waId,
        city: session.data.city,
        system: systemFinal,
        color: "blanco",
        opening: openingFinal,
        glass: DEFAULT_GLASS,
        items: baseItems
      });

      const qNogal = buildQuote({
        waId,
        city: session.data.city,
        system: systemFinal,
        color: "nogal",
        opening: openingFinal,
        glass: DEFAULT_GLASS,
        items: baseItems
      });

      const text =
        `${angryPrefix}Hola, le habla Marcelo Cifuentes de Fábrica de Ventanas Activa.\n` +
        `Le dejo una **pre-cotización inmediata** (referencial) para que hoy mismo tenga un número claro.\n\n` +
        `Ciudad/Comuna: ${session.data.city}\n` +
        `Sistema: ${systemFinal}${assumed.system ? " (asumido)" : ""}\n` +
        `Apertura: ${openingFinal}${assumed.opening ? " (asumida)" : ""}\n` +
        `Vidrio: ${DEFAULT_GLASS}\n\n` +
        `Como no indicó color, le dejo 2 opciones base:\n` +
        `A) Blanco — Total: $${money(qBlanco.total)} (Neto $${money(qBlanco.net)} + IVA)\n` +
        `B) Nogal — Total: $${money(qNogal.total)} (Neto $${money(qNogal.net)} + IVA)\n\n` +
        `Medidas consideradas:\n${summarizeItems(baseItems)}\n\n` +
        `Si me confirma el color definitivo (blanco/nogal/roble/grafito/negro), se la cierro final.\n` +
        `¿Quiere que se la envíe en PDF ahora?`;

      await waSendText(waId, text);

      // Si pidió PDF explícito, lo enviamos con una opción por defecto: Blanco (o si responde color después, se regenera)
      if (wantsPdf && ENV.ENABLE_PDF_QUOTES) {
        const pdf = await generateQuotePDF(qBlanco);
        const mediaId = await waUploadMedia(pdf, "application/pdf", "PreCotizacion_Activa.pdf");
        await waSendDocument(
          waId,
          mediaId,
          "PreCotizacion_Activa.pdf",
          "Adjunto pre-cotización referencial (opción base en Blanco). Si me confirma color definitivo, la ajusto y re-envío."
        );
      }
      return;
    }

    // Si hay color válido, cotizamos directo en ese color
    const quote = buildQuote({
      waId,
      city: session.data.city,
      system: systemFinal,
      color: colorFinal,
      opening: openingFinal,
      glass: DEFAULT_GLASS,
      items: session.data.items
    });

    // Respuesta consultiva (no fría): si el cliente menciona frío/condensación, empatía y recomendación sin vender humo
    const mentionsCold = /fr[ií]o|condens|humedad|moho|se moja|empa[nñ]a/i.test(userText);

    let humanText =
      angryPrefix +
      `Hola, le habla Marcelo Cifuentes de Fábrica de Ventanas Activa.\n` +
      (mentionsCold
        ? "Entiendo lo del frío. En estos casos lo clave es hermeticidad + buen DVH, para bajar infiltraciones y condensación.\n"
        : "") +
      composeHumanQuoteText({
        quote,
        assumed,
        includeColorOptions: false
      });

    // Si el usuario NO pidió PDF, igual damos opción clara y no repetimos preguntas.
    await waSendText(waId, humanText);

    // PDF automático si lo pide
    if (wantsPdf && ENV.ENABLE_PDF_QUOTES) {
      const pdf = await generateQuotePDF(quote);
      const mediaId = await waUploadMedia(pdf, "application/pdf", "PreCotizacion_Activa.pdf");
      await waSendDocument(
        waId,
        mediaId,
        "PreCotizacion_Activa.pdf",
        "Adjunto pre-cotización referencial (sujeta a confirmación en terreno)."
      );
    }
  } catch (err) {
    console.error("Webhook error:", err?.response?.data || err);
    // No reventar el proceso
  }
});

// =====================
// Arranque + verificación ENV
// =====================
function envOk(label, v) {
  const ok = !!v;
  console.log(`${label}: ${ok ? "OK" : "MISSING"}`);
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  envOk("ENV WHATSAPP_TOKEN", ENV.WHATSAPP_TOKEN);
  envOk("ENV PHONE_NUMBER_ID", ENV.PHONE_NUMBER_ID);
  envOk("ENV VERIFY_TOKEN", ENV.VERIFY_TOKEN);
  envOk("ENV OPENAI_API_KEY", ENV.OPENAI_API_KEY);
  console.log(`ENV META_GRAPH_VERSION: ${ENV.META_VERSION}`);
  console.log(`AI_MODEL_TEXT: ${ENV.AI_MODEL_TEXT}`);
  console.log(`ENABLE_VOICE_TRANSCRIPTION: ${ENV.ENABLE_VOICE_TRANSCRIPTION}`);
  console.log(`ENABLE_PDF_QUOTES: ${ENV.ENABLE_PDF_QUOTES}`);
  console.log(`TYPING_SIMULATION: ${ENV.TYPING_SIMULATION}`);
  console.log("Listening...");
});

// Hardening
process.on("unhandledRejection", (reason) => console.error("unhandledRejection", reason));
process.on("uncaughtException", (err) => console.error("uncaughtException", err));
