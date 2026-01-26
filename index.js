import express from "express";
import axios from "axios";
import OpenAI from "openai";
import PDFDocument from "pdfkit";
import FormData from "form-data";
import multer from "multer";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 8080;

// ============================
// ENV
// ============================
const ENV = {
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  META_VERSION: process.env.META_GRAPH_VERSION || "v22.0",

  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  AI_MODEL_TEXT: process.env.AI_MODEL_TEXT || "gpt-4.1-mini",
  AI_MODEL_VISION: process.env.AI_MODEL_VISION || "gpt-4o-mini",

  ENABLE_PDF_QUOTES: (process.env.ENABLE_PDF_QUOTES || "true") === "true",
  ENABLE_VOICE_TRANSCRIPTION: (process.env.ENABLE_VOICE_TRANSCRIPTION || "true") === "true",
  TYPING_SIMULATION: (process.env.TYPING_SIMULATION || "true") === "true",

  // Marca / tono
  BRAND_NAME: process.env.BRAND_NAME || "Fábrica de Ventanas Activa",
  SIGN_NAME: process.env.SIGN_NAME || "Marcelo",
  CITY_DEFAULT: process.env.CITY_DEFAULT || "Temuco",

  // Precios (ajústalos cuando quieras)
  PRICE_M2_WHITE_NET: Number(process.env.PRICE_M2_WHITE_NET || 150000),
  PRICE_M2_NOGAL_NET: Number(process.env.PRICE_M2_NOGAL_NET || 160000),
  PRICE_M2_BLACK_NET: Number(process.env.PRICE_M2_BLACK_NET || 170000),

  // instalación (referencial)
  INSTALL_FEE_PER_UNIT_NET: Number(process.env.INSTALL_FEE_PER_UNIT_NET || 35000),

  IVA: Number(process.env.IVA || 0.19),

  // Para no “disparar” exceso de texto
  MAX_FOLLOWUP_QUESTIONS: Number(process.env.MAX_FOLLOWUP_QUESTIONS || 2)
};

function assertEnv() {
  const required = ["WHATSAPP_TOKEN", "VERIFY_TOKEN", "OPENAI_API_KEY"];
  const missing = required.filter((k) => !ENV[k]);
  if (missing.length) {
    console.error("Missing ENV:", missing);
  }
}
assertEnv();

const openai = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });

// ============================
// WhatsApp helpers
// ============================
const WA_BASE = `https://graph.facebook.com/${ENV.META_VERSION}/${ENV.PHONE_NUMBER_ID}`;
const GRAPH_BASE = `https://graph.facebook.com/${ENV.META_VERSION}`;

async function waSendText(to, body) {
  await axios.post(
    `${WA_BASE}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body }
    },
    {
      headers: {
        Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      timeout: 60000
    }
  );
}

async function waMarkRead(messageId) {
  // No es obligatorio, pero ayuda
  try {
    await axios.post(
      `${WA_BASE}/messages`,
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId
      },
      {
        headers: {
          Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        },
        timeout: 60000
      }
    );
  } catch (e) {
    // silencioso
  }
}

async function waUploadMedia(buffer, mimeType, filename = "archivo.pdf") {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", buffer, { filename, contentType: mimeType });

  const r = await axios.post(`${WA_BASE}/media`, form, {
    headers: {
      Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}`,
      ...form.getHeaders()
    },
    maxBodyLength: Infinity,
    timeout: 60000
  });

  return r.data.id; // media_id
}

async function waSendDocument(to, mediaId, filename, caption = "") {
  await axios.post(
    `${WA_BASE}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: {
        id: mediaId,
        filename,
        caption
      }
    },
    {
      headers: {
        Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      timeout: 60000
    }
  );
}

async function waGetMediaUrl(mediaId) {
  const r = await axios.get(`${GRAPH_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` },
    timeout: 60000
  });
  return r.data.url;
}

async function waDownloadMedia(url) {
  const r = await axios.get(url, {
    headers: { Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}` },
    responseType: "arraybuffer",
    timeout: 60000
  });
  return Buffer.from(r.data);
}

// ============================
// Memoria corta para no buclear
// (Se reinicia si Railway reinicia, pero sirve para 90% de casos)
// ============================
const seenMessageIds = new Map(); // message_id -> timestamp
const userState = new Map(); // wa_id -> { lastQuote, lastQuoteTs, profileName }

function gcMaps() {
  const now = Date.now();
  // message ids 10 minutos
  for (const [k, ts] of seenMessageIds.entries()) {
    if (now - ts > 10 * 60 * 1000) seenMessageIds.delete(k);
  }
  // quotes 24 horas
  for (const [k, st] of userState.entries()) {
    if (st?.lastQuoteTs && now - st.lastQuoteTs > 24 * 60 * 60 * 1000) {
      userState.set(k, { profileName: st.profileName }); // mantiene nombre
    }
  }
}
setInterval(gcMaps, 60 * 1000).unref();

// ============================
// Parsing / intent
// ============================
function normalizeText(s = "") {
  return s
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function looksAngry(text) {
  const t = normalizeText(text);
  return (
    t.includes("enoja") ||
    t.includes("molest") ||
    t.includes("pesimo") ||
    t.includes("no responden") ||
    t.includes("nunca contestan") ||
    t.includes("puro bot") ||
    t.includes("me hicieron perder") ||
    t.includes("voy a ir") ||
    t.includes("golpear") ||
    t.includes("estafa")
  );
}

function detectPdfRequest(text) {
  const t = normalizeText(text);
  return t === "pdf" || t.includes("en pdf") || t.includes("mandame el pdf") || t.includes("adjunta pdf");
}

function detectInfoRequest(text) {
  const t = normalizeText(text);
  return t.includes("informacion") || t.includes("modelos") || t.includes("precios") || t.includes("catalogo");
}

function detectQuoteRequest(text) {
  const t = normalizeText(text);
  return (
    t.includes("cotiza") ||
    t.includes("cotizacion") ||
    t.includes("presupuesto") ||
    t.includes("precio") ||
    t.includes("cuanto sale") ||
    t.includes("valor")
  );
}

function extractColor(text) {
  const t = normalizeText(text);
  if (t.includes("nogal")) return "nogal";
  if (t.includes("blanco")) return "blanco";
  if (t.includes("negro")) return "negro";
  if (t.includes("grafito")) return "grafito"; // lo tratamos como negro por ahora
  if (t.includes("roble")) return "roble"; // lo tratamos como nogal por ahora
  return null;
}

function colorToPrice(color) {
  if (!color) return null;
  const c = color.toLowerCase();
  if (c === "blanco") return ENV.PRICE_M2_WHITE_NET;
  if (c === "nogal" || c === "roble") return ENV.PRICE_M2_NOGAL_NET;
  if (c === "negro" || c === "grafito") return ENV.PRICE_M2_BLACK_NET;
  return null;
}

function extractMeasurementsFromText(text) {
  // Devuelve lista [{w_mm, h_mm, qty}]
  // Soporta: 1200x1200, 1.2x1.2, 2mt x 1.80, 1800 x 2000, etc.
  const src = (text || "").replace(/,/g, ".").toLowerCase();
  const items = [];

  // 1) patrones con x
  const re = /(\d+(?:\.\d+)?)\s*(mm|cm|m|mt|mts)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|mt|mts)?/gi;
  let m;
  while ((m = re.exec(src))) {
    const a = parseFloat(m[1]);
    const au = m[2] || null;
    const b = parseFloat(m[3]);
    const bu = m[4] || null;

    const w_mm = toMm(a, au);
    const h_mm = toMm(b, bu);

    if (w_mm && h_mm) items.push({ w_mm, h_mm, qty: 1 });
  }

  // 2) cantidad aproximada “2 ventanas … 1000x1000”
  const qtyRe = /(\d+)\s*(ventanas?|puertas?|unidades?)\b/gi;
  const qtyMatch = qtyRe.exec(src);
  if (qtyMatch && items.length === 1) {
    const qty = parseInt(qtyMatch[1], 10);
    if (qty > 1) items[0].qty = qty;
  }

  // evita duplicados exactos
  const uniq = [];
  const seen = new Set();
  for (const it of items) {
    const k = `${it.w_mm}-${it.h_mm}-${it.qty}`;
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(it);
    }
  }
  return uniq;
}

function toMm(value, unit) {
  if (!value || value <= 0) return null;
  const u = (unit || "").toLowerCase();
  if (!u || u === "mm") return Math.round(value); // si no especifica, asumimos mm si es >=100, si es <10 lo convertimos a m
  if (u === "cm") return Math.round(value * 10);
  if (u === "m" || u === "mt" || u === "mts") return Math.round(value * 1000);
  return Math.round(value);
}

function mmToM2(w_mm, h_mm, qty = 1) {
  const w_m = w_mm / 1000;
  const h_m = h_mm / 1000;
  return w_m * h_m * (qty || 1);
}

function formatMoneyCLP(n) {
  // sin depender de Intl por compat
  const s = Math.round(n).toString();
  return "$" + s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function buildQuote({ city, color, items, includeInstall }) {
  const priceNet = colorToPrice(color) ?? null;

  const totals = {
    area_m2: 0,
    net: 0,
    install_net: 0,
    iva: 0,
    total: 0
  };

  for (const it of items) totals.area_m2 += mmToM2(it.w_mm, it.h_mm, it.qty);

  // Si no hay color -> devolvemos 2 opciones (blanco / nogal)
  if (!color || !priceNet) {
    const optA = quoteWithPrice(items, ENV.PRICE_M2_WHITE_NET, includeInstall);
    const optB = quoteWithPrice(items, ENV.PRICE_M2_NOGAL_NET, includeInstall);

    return {
      kind: "two_options",
      city,
      base: {
        system: "PVC europeo",
        glass: "Termopanel estándar (DVH)"
      },
      includeInstall,
      options: [
        { label: "Blanco", price_m2_net: ENV.PRICE_M2_WHITE_NET, ...optA },
        { label: "Nogal", price_m2_net: ENV.PRICE_M2_NOGAL_NET, ...optB }
      ]
    };
  }

  // Una sola opción (color definido)
  const one = quoteWithPrice(items, priceNet, includeInstall);
  return {
    kind: "single",
    city,
    color,
    base: {
      system: "PVC europeo",
      glass: "Termopanel estándar (DVH)"
    },
    includeInstall,
    ...one
  };
}

function quoteWithPrice(items, price_m2_net, includeInstall) {
  const area = items.reduce((acc, it) => acc + mmToM2(it.w_mm, it.h_mm, it.qty), 0);
  const units = items.reduce((acc, it) => acc + (it.qty || 1), 0);
  const install_net = includeInstall ? units * ENV.INSTALL_FEE_PER_UNIT_NET : 0;

  const net = area * price_m2_net + install_net;
  const iva = net * ENV.IVA;
  const total = net + iva;

  return { area_m2: area, units, net, iva, total, install_net };
}

function humanIntro(name) {
  // Mensaje humano, corto, amable, sin parecer “robot”
  const n = name ? ` ${name}` : "";
  return `Hola${n}, gracias por escribir a ${ENV.BRAND_NAME}. Soy ${ENV.SIGN_NAME}.`;
}

function consultiveHook(text) {
  const t = normalizeText(text);
  if (t.includes("mucho frio") || t.includes("frio") || t.includes("condens")) {
    return "Entiendo. Si el problema es frío/condensación, con PVC + termopanel estándar ya mejoras, y si quieres un salto mayor podemos escalar a opciones térmicas (Equipo Beta/Alfa) sin obligarte a nada.";
  }
  return "Cuéntame qué necesitas y lo resolvemos rápido, sin hacerte perder tiempo.";
}

function renderQuoteText(profileName, quote, detailsItems) {
  const intro = humanIntro(profileName);
  const city = quote.city || ENV.CITY_DEFAULT;

  // Detalle de items en 1 línea (sin saturar)
  let resumen = "";
  if (detailsItems?.length) {
    const parts = detailsItems.slice(0, 5).map((it) => {
      const w = it.w_mm;
      const h = it.h_mm;
      const q = it.qty || 1;
      return `${q}× ${w}x${h} mm`;
    });
    resumen = `\nMedidas consideradas: ${parts.join(" | ")}${detailsItems.length > 5 ? " | …" : ""}`;
  }

  if (quote.kind === "two_options") {
    const a = quote.options[0];
    const b = quote.options[1];
    const installLine = quote.includeInstall ? "Incluye instalación referencial." : "Sin instalación (solo fabricación).";

    return (
      `${intro}\n` +
      `Listo. Te dejo una **pre-cotización referencial** para ${city} (base estándar: ${quote.base.system} + ${quote.base.glass}).\n` +
      `${installLine}\n` +
      `${resumen}\n\n` +
      `Opción A — ${a.label} (neto ${formatMoneyCLP(a.price_m2_net)}/m² aprox)\n` +
      `• Neto: ${formatMoneyCLP(a.net)} | IVA: ${formatMoneyCLP(a.iva)} | Total: ${formatMoneyCLP(a.total)}\n\n` +
      `Opción B — ${b.label} (neto ${formatMoneyCLP(b.price_m2_net)}/m² aprox)\n` +
      `• Neto: ${formatMoneyCLP(b.net)} | IVA: ${formatMoneyCLP(b.iva)} | Total: ${formatMoneyCLP(b.total)}\n\n` +
      `Si me confirmas el color final y si va con instalación, te la cierro y si quieres te la envío en PDF.`
    );
  }

  const installLine = quote.includeInstall
    ? `Incluye instalación referencial.`
    : `Sin instalación (solo fabricación).`;

  return (
    `${intro}\n` +
    `Perfecto. Te dejo una **pre-cotización referencial** para ${city} (base estándar: ${quote.base.system} + ${quote.base.glass}).\n` +
    `Color: ${quote.color}.\n` +
    `${installLine}\n` +
    `${resumen}\n\n` +
    `• Neto: ${formatMoneyCLP(quote.net)}\n` +
    `• IVA: ${formatMoneyCLP(quote.iva)}\n` +
    `• Total: ${formatMoneyCLP(quote.total)}\n\n` +
    `Si quieres, te la envío en PDF y coordinamos visita solo si deseas confirmar medidas en terreno.`
  );
}

// ============================
// OpenAI: transcripción y visión
// ============================
async function transcribeAudio(buffer) {
  if (!ENV.ENABLE_VOICE_TRANSCRIPTION) return null;
  // Nota: el SDK de OpenAI admite transcripción vía "audio.transcriptions.create"
  // Dependiendo del modelo disponible en tu cuenta.
  try {
    const file = new File([buffer], "audio.ogg", { type: "audio/ogg" });
    const tr = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe"
    });
    return tr.text || null;
  } catch (e) {
    console.error("transcribeAudio error:", e?.response?.data || e.message);
    return null;
  }
}

async function extractFromImage(buffer) {
  // Convierte a data URL para visión
  try {
    const b64 = buffer.toString("base64");
    const dataUrl = `data:image/jpeg;base64,${b64}`;

    const resp = await openai.chat.completions.create({
      model: ENV.AI_MODEL_VISION,
      messages: [
        {
          role: "system",
          content:
            "Extrae medidas y cantidades de ventanas/puertas desde la imagen. Devuelve SOLO texto plano con una lista tipo: 'QTY x ANCHO(mm) x ALTO(mm)' por línea. Si no se ve claro, di: 'NO_CLARO'."
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Lee la tabla/lista y extrae medidas." },
            { type: "image_url", image_url: { url: dataUrl } }
          ]
        }
      ],
      temperature: 0.2
    });

    const out = resp?.choices?.[0]?.message?.content?.trim() || "";
    if (!out || out.includes("NO_CLARO")) return null;
    return out;
  } catch (e) {
    console.error("extractFromImage error:", e?.response?.data || e.message);
    return null;
  }
}

// ============================
// PDF
// ============================
function generateQuotePdfBuffer({ profileName, quoteText }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      doc.fontSize(16).text(`${ENV.BRAND_NAME}`, { align: "left" });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor("gray").text(`Atención: ${ENV.SIGN_NAME}`);
      doc.fillColor("black");
      doc.moveDown();

      doc.fontSize(12).text(`Cliente: ${profileName || "Cliente"}`);
      doc.moveDown();

      doc.fontSize(11).text("Detalle (pre-cotización referencial):");
      doc.moveDown(0.5);

      doc.fontSize(10).text(quoteText.replace(/\*/g, ""), { width: 500 });
      doc.moveDown();

      doc.fontSize(9).fillColor("gray").text(
        "Nota: Valores referenciales sujetos a confirmación de medidas/especificaciones finales. Si lo desea, coordinamos visita técnica para validación en terreno.",
        { width: 500 }
      );

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ============================
// Conversación: lógica principal
// ============================
function chooseInstallHeuristic(text) {
  const t = normalizeText(text);
  if (t.includes("con instal") || t.includes("instalacion") || t.includes("instalar")) return true;
  if (t.includes("sin instal")) return false;
  return null; // desconocido
}

function minimalQuestionsNeeded({ hasMeasures, hasColor, hasCity, hasInstall }) {
  // Máximo 2 preguntas por tu regla
  const q = [];
  if (!hasMeasures) q.push("¿Me indicas las medidas (ancho x alto) y cuántas unidades son?");
  if (!hasCity) q.push(`¿En qué comuna/sector sería la instalación? (si es ${ENV.CITY_DEFAULT}, me confirmas)`);
  if (!hasInstall) q.push("¿Lo necesitas con instalación o solo fabricación?");
  if (!hasColor) q.push("¿Qué color prefieres? (si no, te doy blanco/nogal como base)");

  return q.slice(0, ENV.MAX_FOLLOWUP_QUESTIONS);
}

function friendlyMessageForInfo(profileName) {
  const intro = humanIntro(profileName);
  return (
    `${intro}\n` +
    `Te ayudo encantado. Para orientarte rápido:\n` +
    `• Trabajamos ventanas/puertas en PVC (base estándar: PVC europeo + termopanel DVH).\n` +
    `• Modelos típicos: correderas, abatibles y oscilobatientes.\n\n` +
    `¿Qué te gustaría cotizar hoy: ventana o puerta? Si me dices medidas (ancho x alto) y cantidad, te dejo el valor al tiro.`
  );
}

function friendlyFirstResponse(profileName, inboundText) {
  const intro = humanIntro(profileName);
  const hook = consultiveHook(inboundText);
  return `${intro}\n${hook}\n\nSi ya tienes medidas y cantidad, envíamelas y te cotizo de inmediato.`;
}

// ============================
// Webhook
// ============================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === ENV.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;

    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const value = change.value || {};
        const messages = value.messages || [];
        const contacts = value.contacts || [];

        for (const msg of messages) {
          const messageId = msg.id;
          if (!messageId) continue;

          // Dedup
          if (seenMessageIds.has(messageId)) continue;
          seenMessageIds.set(messageId, Date.now());

          const from = msg.from; // wa_id del cliente
          const profileName = contacts?.[0]?.profile?.name || userState.get(from)?.profileName || null;
          const stPrev = userState.get(from) || {};
          userState.set(from, { ...stPrev, profileName });

          if (ENV.TYPING_SIMULATION) {
            await waMarkRead(messageId);
          }

        let inboundText = "";

if (msg.type === "text") {
  inboundText = msg.text?.body || "";
} else if (msg.type === "audio" || msg.type === "voice") {
  if (!ENV.ENABLE_VOICE_TRANSCRIPTION) {
    inboundText = "";
  } else {
    const mediaId = msg.audio?.id || msg.voice?.id;
    if (mediaId) {
      const url = await waGetMediaUrl(mediaId);
      const buf = await waDownloadMedia(url);
      const tr = await transcribeAudio(buf);
      inboundText = tr || "";
    }
  }
} else if (msg.type === "image") {
  const mediaId = msg.image?.id;
  if (mediaId) {
    const url = await waGetMediaUrl(mediaId);
    const buf = await waDownloadMedia(url);
    const extracted = await extractFromImage(buf);
    inboundText = extracted || "";
  }
} else if (msg.type === "document") {
  const mediaId = msg.document?.id;
  const mime = msg.document?.mime_type || "";
  if (mediaId && mime.startsWith("image/")) {
    const url = await waGetMediaUrl(mediaId);
    const buf = await waDownloadMedia(url);
    const extracted = await extractFromImage(buf);
    inboundText = extracted || "";
  } else {
    inboundText = msg.document?.caption || "";
  }
} else {
  inboundText = "";
}


          const angry = looksAngry(inboundText);

          // 1) Si piden PDF -> si hay última cotización, enviar PDF sin preguntar
          if (detectPdfRequest(inboundText) && ENV.ENABLE_PDF_QUOTES) {
            const st = userState.get(from) || {};
            if (st.lastQuote && st.lastQuoteText) {
              const pdf = await generateQuotePdfBuffer({
                profileName,
                quoteText: st.lastQuoteText
              });
              const mediaId = await waUploadMedia(pdf, "application/pdf", "PreCotizacion_Activa.pdf");
              await waSendDocument(from, mediaId, "PreCotizacion_Activa.pdf", "Adjunto PDF de la pre-cotización referencial.");
            } else {
              await waSendText(
                from,
                `${humanIntro(profileName)}\nCon gusto te envío PDF. Para generarlo, dime medidas (ancho x alto), cantidad y comuna/sector, y lo preparo al tiro.`
              );
            }
            continue;
          }

          // 2) Si solo pide info
          if (detectInfoRequest(inboundText) && !detectQuoteRequest(inboundText)) {
            await waSendText(from, friendlyMessageForInfo(profileName));
            continue;
          }

          // 3) Intentar cotizar si hay medidas
          const color = extractColor(inboundText);
          const measures = extractMeasurementsFromText(inboundText);
          const hasMeasures = measures.length > 0;

          // comuna/ciudad: muy simple (si no detecta, usa default)
          const city = ENV.CITY_DEFAULT;
          const hasCity = true; // por ahora default; puedes endurecerlo luego

          const installHint = chooseInstallHeuristic(inboundText); // true/false/null
          const hasInstall = installHint !== null;

          // Si no pide cotización explícita pero mandó medidas, igual cotizamos (mejor UX)
          const wantsQuote = detectQuoteRequest(inboundText) || hasMeasures;

          if (!wantsQuote) {
            // respuesta humana general
            const msgText = angry
              ? `${humanIntro(profileName)}\nLamento la experiencia. Vamos a resolverlo rápido y claro.\n\nSi me dices qué necesitas (ventana o puerta) y las medidas (ancho x alto) con cantidad, te cotizo de inmediato.`
              : friendlyFirstResponse(profileName, inboundText);
            await waSendText(from, msgText);
            continue;
          }

          // Si faltan datos críticos, preguntar lo mínimo (máximo 2 preguntas)
          const hasColor = !!color; // si no hay, mostramos opciones
          const questions = minimalQuestionsNeeded({
            hasMeasures,
            hasColor, // no crítico (porque damos opciones)
            hasCity,
            hasInstall // no crítico (podemos asumir sin instalación)
          });

          // Heurística: si hay medidas, NO preguntar; cotizar al tiro.
          if (hasMeasures) {
            // Si no dijo instalación, asumimos “sin instalación” y lo dejamos claro + opción con instalación.
            const includeInstall = installHint === true ? true : false;

            const quote = buildQuote({
              city,
              color,
              items: measures,
              includeInstall
            });

            const quoteText = renderQuoteText(profileName, quote, measures);

            // guardamos última cotización (para PDF y para evitar bucles)
            const st = userState.get(from) || {};
            userState.set(from, {
              ...st,
              lastQuote: quote,
              lastQuoteText: quoteText,
              lastQuoteTs: Date.now()
            });

            // Mensaje extra humano si el cliente viene molesto
            if (angry) {
              await waSendText(
                from,
                `${humanIntro(profileName)}\nGracias por la paciencia. Para que no pierdas tiempo, ya te dejo el valor referencial con lo que enviaste:`
              );
            }

            await waSendText(from, quoteText);

            // Si piden “mucho frío”, ofrece escalamiento sin presionar
            const tNorm = normalizeText(inboundText);
            if (tNorm.includes("frio") || tNorm.includes("condens")) {
              await waSendText(
                from,
                `Si quieres, te hago 2 alternativas rápidas:\n` +
                  `1) Base estándar (ya incluida arriba)\n` +
                  `2) Mejora térmica (Equipo Beta/Alfa) para reducir frío/condensación.\n\n` +
                  `¿Te interesa que te calcule la alternativa 2 también?`
              );
            }

            continue;
          }

          // Si no hay medidas: preguntar lo mínimo, pero humano y conciliador
          const pre = angry
            ? `${humanIntro(profileName)}\nEntiendo la molestia. Para responderte bien en un solo paso:`
            : `${humanIntro(profileName)}\nPerfecto, te ayudo de inmediato:`;

          const qText =
            questions.length > 0
              ? questions.map((q, i) => `${i + 1}) ${q}`).join("\n")
              : "¿Me das un poco más de detalle para cotizarte bien?";

          await waSendText(from, `${pre}\n${qText}`);
        }
      }
    }
  } catch (e) {
    console.error("Webhook handler error:", e?.response?.data || e.message);
  }
});

// Salud
app.get("/", (req, res) => {
  res.status(200).send("OK - WhatsApp IA Hub running");
});

app.listen(PORT, () => {
  console.log("Starting Container");
  console.log("Server running on port", PORT);

  console.log("ENV WHATSAPP_TOKEN:", ENV.WHATSAPP_TOKEN ? "OK" : "MISSING");
  console.log("ENV PHONE_NUMBER_ID:", ENV.PHONE_NUMBER_ID ? "OK" : "MISSING");
  console.log("ENV VERIFY_TOKEN:", ENV.VERIFY_TOKEN ? "OK" : "MISSING");
  console.log("ENV OPENAI_API_KEY:", ENV.OPENAI_API_KEY ? "OK" : "MISSING");
  console.log("ENV META_GRAPH_VERSION:", ENV.META_VERSION);

  console.log("AI_MODEL_TEXT:", ENV.AI_MODEL_TEXT);
  console.log("AI_MODEL_VISION:", ENV.AI_MODEL_VISION);

  console.log("ENABLE_PDF_QUOTES:", ENV.ENABLE_PDF_QUOTES);
  console.log("ENABLE_VOICE_TRANSCRIPTION:", ENV.ENABLE_VOICE_TRANSCRIPTION);
  console.log("TYPING_SIMULATION:", ENV.TYPING_SIMULATION);

  console.log("Listening...");
});
