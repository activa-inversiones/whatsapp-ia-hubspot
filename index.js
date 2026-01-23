// index.js — WhatsApp Business API + Ventas (Activa) + Anti-duplicados + Lenguaje cercano
// Claves:
// 1) ACK inmediato (Meta no reintenta por timeout)
// 2) Dedupe fuerte (msg.id + fingerprint) + throttle por contacto
// 3) Slot-filling determinístico (NO repite preguntas)
// 4) Respuestas cortas, humanas, 1 sola pregunta por mensaje

import express from "express";
import axios from "axios";
import OpenAI from "openai";
import crypto from "crypto";

// ====== Safety logs ======
process.on("unhandledRejection", (err) =>
  console.error("UNHANDLED_REJECTION:", err?.response?.data || err?.message || err)
);
process.on("uncaughtException", (err) =>
  console.error("UNCAUGHT_EXCEPTION:", err?.response?.data || err?.message || err)
);

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 8080;

// ====== ENV ======
const {
  OPENAI_API_KEY,
  VERIFY_TOKEN,
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  CRM_WEBHOOK_URL,
  BUSINESS_NAME = "Activa Inversiones",
  SALES_REGION = "Temuco y alrededores",
} = process.env;

console.log("BOOT: starting app…");
console.log("ENV PORT:", process.env.PORT || PORT);
console.log("ENV PHONE_NUMBER_ID:", PHONE_NUMBER_ID ? "OK" : "MISSING");
console.log("ENV WHATSAPP_TOKEN:", WHATSAPP_TOKEN ? "OK" : "MISSING");
console.log("ENV VERIFY_TOKEN:", VERIFY_TOKEN ? "OK" : "MISSING");
console.log("ENV OPENAI_API_KEY:", OPENAI_API_KEY ? "OK" : "MISSING");
console.log("ENV CRM_WEBHOOK_URL:", CRM_WEBHOOK_URL ? "OK" : "NOT_SET");

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// ====== Memory (RAM) ======
const sessions = new Map(); // waId -> session
const processedMsgIds = new Set(); // idempotencia por msg.id
const processedFingerprints = new Map(); // fingerprint -> timestamp (TTL)
const FINGERPRINT_TTL_MS = 10 * 60 * 1000; // 10 min
const REPLY_THROTTLE_MS = 2500; // evita ráfagas duplicadas al mismo contacto

function now() {
  return Date.now();
}

function normalize(text = "") {
  return text.toLowerCase().trim();
}

function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function cleanupFingerprints() {
  const t = now();
  for (const [k, ts] of processedFingerprints.entries()) {
    if (t - ts > FINGERPRINT_TTL_MS) processedFingerprints.delete(k);
  }
  // limpieza simple de msgIds
  if (processedMsgIds.size > 4000) {
    const arr = Array.from(processedMsgIds);
    arr.slice(0, 1500).forEach((id) => processedMsgIds.delete(id));
  }
}

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      lead: {
        customerType: null, // RESIDENCIAL / COMERCIAL / CONSTRUCTOR / ARQUITECTO / INSTITUCIONAL
        city: null,
        products: [],
        goal: null, // AISLACIÓN_TÉRMICA / ...
        quantities: null,
        measures: null,
        glazing: null, // DVH, LOW_E, TRIPLE...
        timeline: null,
        notes: null,
        name: null,
        email: null,
      },
      profile: {
        typeConfirmed: false,
      },
      lastReplyAt: 0,
      lastFingerprint: null,
      lastMessageAt: now(),
    });
  }
  const s = sessions.get(waId);
  s.lastMessageAt = now();
  return s;
}

// ====== City / Products / Goal / Measures / Quantities ======
const CITY_KEYWORDS = [
  "temuco",
  "padre las casas",
  "villarrica",
  "pucon",
  "pucón",
  "lautaro",
  "freire",
  "labranza",
  "carahue",
  "nueva imperial",
  "imperial",
  "angol",
  "victoria",
  "collipulli",
];

function titleCase(str) {
  return str.replace(/\b\w/g, (m) => m.toUpperCase());
}

function detectCity(text = "") {
  const t = normalize(text);
  for (const c of CITY_KEYWORDS) {
    if (t.includes(c)) return titleCase(c);
  }
  return null;
}

function detectProducts(text = "") {
  const x = normalize(text);
  const products = new Set();
  if (/(ventana|ventanas|termopanel|dvh|triple|low[-\s]?e)/i.test(x)) products.add("VENTANAS/TERMOPANEL");
  if (/(puerta|puertas)/i.test(x)) products.add("PUERTAS");
  if (/(muro cortina|curtain wall|fachada)/i.test(x)) products.add("MURO_CORTINA");
  if (/(tabique vidriado|división vidriada|mampara|oficina)/i.test(x)) products.add("TABIQUES_VIDRIADOS");
  return Array.from(products);
}

function detectGoal(text = "") {
  const t = normalize(text);
  if (/(aislaci[oó]n t[eé]rmica|fr[ií]o|calor|temperatura|eficiencia energ[eé]tica)/i.test(t)) return "AISLACIÓN_TÉRMICA";
  if (/(ruido|ac[uú]stic|sonido)/i.test(t)) return "AISLACIÓN_ACÚSTICA";
  if (/(condensaci[oó]n|empa[nñ]amiento|humedad)/i.test(t)) return "CONTROL_CONDENSACIÓN";
  if (/(seguridad|laminad|antirrobo)/i.test(t)) return "SEGURIDAD";
  return null;
}

function mergeTokenList(current, tokens = []) {
  const set = new Set(
    (current || "")
      .split(/[,\|]/)
      .map((x) => x.trim())
      .filter(Boolean)
  );
  tokens.forEach((x) => set.add(x));
  return Array.from(set).join(", ");
}

function extractQuantities(text = "") {
  const t = normalize(text);
  if (/^\d{1,4}$/.test(t)) return parseInt(t, 10);
  const m = t.match(/(?:son|serian|serían|aprox|aproximadamente)?\s*(\d{1,4})\s*(?:unidades|uds|u|ventanas|puertas|marcos|paños)?/i);
  if (m?.[1]) return parseInt(m[1], 10);
  return null;
}

function extractMeasures(text = "") {
  const raw = text.toLowerCase();
  const measures = [];
  const re = /(\d{1,4}(?:[.,]\d{1,2})?)\s*[x×]\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*(mm|cm|m)?/gi;

  let match;
  while ((match = re.exec(raw)) !== null) {
    let a = parseFloat(String(match[1]).replace(",", "."));
    let b = parseFloat(String(match[2]).replace(",", "."));
    const unit = (match[3] || "mm").toLowerCase();

    if (unit === "m") { a *= 1000; b *= 1000; }
    if (unit === "cm") { a *= 10; b *= 10; }

    const A = Math.round(a);
    const B = Math.round(b);

    if (A >= 200 && B >= 200 && A <= 6000 && B <= 6000) measures.push(`${A}x${B}mm`);
  }

  if (!measures.length) return null;
  return Array.from(new Set(measures)).join(" | ");
}

function detectCustomerType(text = "") {
  const t = normalize(text);
  if (/residencial|casa|depto|departamento|hogar/i.test(t)) return "RESIDENCIAL";
  if (/comercial|local|tienda|oficina|bodega|industrial/i.test(t)) return "COMERCIAL";
  if (/constructora|inmobiliaria|obra|licitaci[oó]n/i.test(t)) return "CONSTRUCTOR";
  if (/arquitect|proyectista|especificador/i.test(t)) return "ARQUITECTO";
  if (/colegio|cesfam|hospital|municipal|instituci[oó]n/i.test(t)) return "INSTITUCIONAL";
  return null;
}

function parseLeadFromText(lead, text) {
  const t = normalize(text);

  const type = detectCustomerType(text);
  if (type) lead.customerType = type;

  const city = detectCity(text);
  if (city) lead.city = city;

  const prods = detectProducts(text);
  if (prods.length) lead.products = Array.from(new Set([...(lead.products || []), ...prods]));

  const goal = detectGoal(text);
  if (goal) lead.goal = goal;

  if (/(termopanel|dvh)/i.test(t)) lead.glazing = mergeTokenList(lead.glazing, ["DVH"]);
  if (/(triple)/i.test(t)) lead.glazing = mergeTokenList(lead.glazing, ["TRIPLE"]);
  if (/(low[-\s]?e|baja emisividad)/i.test(t)) lead.glazing = mergeTokenList(lead.glazing, ["LOW_E"]);
  if (/(laminad)/i.test(t)) lead.glazing = mergeTokenList(lead.glazing, ["LAMINADO"]);
  if (/(argon)/i.test(t)) lead.glazing = mergeTokenList(lead.glazing, ["ARGON"]);

  const q = extractQuantities(text);
  if (q && !lead.quantities) lead.quantities = String(q);

  const ms = extractMeasures(text);
  if (ms && !lead.measures) lead.measures = ms;

  if (!lead.timeline) {
    if (/hoy|urgente|ya/i.test(t)) lead.timeline = "URGENTE";
    else if (/semana|7 d/i.test(t)) lead.timeline = "1-2 SEM";
    else if (/mes|30 d/i.test(t)) lead.timeline = "1 MES";
  }

  const em = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (em?.[0] && !lead.email) lead.email = em[0].toLowerCase();

  const nm = text.match(/me llamo\s+([a-záéíóúñ\s]{2,40})/i);
  if (nm?.[1] && !lead.name) lead.name = nm[1].trim();

  if (/pvc/i.test(t)) lead.notes = (lead.notes ? `${lead.notes} | ` : "") + "PVC";
  if (/alumin/i.test(t)) lead.notes = (lead.notes ? `${lead.notes} | ` : "") + "Aluminio";

  return lead;
}

function detectContradiction(prevLead, newLead) {
  if (!prevLead?.customerType || !newLead?.customerType) return null;
  if (prevLead.customerType !== newLead.customerType) return { from: prevLead.customerType, to: newLead.customerType };
  return null;
}

function pickNextQuestion(lead) {
  if (!lead.customerType) return { key: "customerType", q: "¿Es para tu casa (residencial) o para un local/negocio (comercial)?" };
  if (!lead.city) return { key: "city", q: "¿En qué comuna/ciudad es el proyecto?" };
  if (!lead.products || lead.products.length === 0) return { key: "products", q: "¿Qué necesitas cotizar: ventanas, puertas, muro cortina o tabiques vidriados?" };
  if (!lead.goal) return { key: "goal", q: "¿Qué te importa más: aislación térmica, acústica o controlar condensación?" };
  if (!lead.quantities) return { key: "quantities", q: "Perfecto. ¿Cuántas unidades son en total?" };
  if (!lead.measures) return { key: "measures", q: "¿Me das medidas aproximadas? (ej: 1000x2000mm)" };
  if (!lead.timeline) return { key: "timeline", q: "¿Para cuándo lo necesitas? (urgente / 1-2 semanas / 1 mes / más)" };
  return null;
}

function shouldCloseLead(lead) {
  return Boolean(lead.city && (lead.products?.length || 0) > 0 && (lead.quantities || lead.measures));
}

// ====== WhatsApp send ======
async function sendWhatsAppText(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) throw new Error("Faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID");

  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  const res = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    timeout: 10000,
  });

  return res.data;
}

// Envío con throttle + anti ráfaga
async function safeSendWhatsAppOnce(waId, text) {
  const s = getSession(waId);

  // Throttle: si por duplicado llega el mismo evento, no envía otra vez
  if (now() - s.lastReplyAt < REPLY_THROTTLE_MS) return;

  s.lastReplyAt = now();
  await sendWhatsAppText(waId, text).catch((e) => {
    console.error("sendWhatsAppText error:", e?.response?.data || e?.message || e);
  });
}

// ====== CRM (opcional) ======
async function sendToCRM(waId, lead) {
  if (!CRM_WEBHOOK_URL) return;
  await axios.post(
    CRM_WEBHOOK_URL,
    { waId, source: "whatsapp", business: BUSINESS_NAME, region: SALES_REGION, lead, ts: new Date().toISOString() },
    { timeout: 10000 }
  );
}

// ====== Respuesta humana (determinística) ======
function humanSummary(lead) {
  const parts = [];
  if (lead.city) parts.push(lead.city);
  if (lead.goal) parts.push(lead.goal.toLowerCase().replace("_", " "));
  if ((lead.products || []).length) parts.push(lead.products.join(", ").toLowerCase());
  return parts.length ? `Ya, perfecto: ${parts.join(" · ")}.` : "Perfecto, ya te entendí.";
}

function humanBenefit(lead) {
  if (lead.goal === "AISLACIÓN_TÉRMICA") {
    return "Para Temuco normalmente anda muy bien PVC + termopanel (DVH). Si quieres subir el nivel, Low-E ayuda harto en confort y desempeño.";
  }
  if (lead.goal === "AISLACIÓN_ACÚSTICA") {
    return "Para ruido, lo que más cambia la diferencia es el vidrio (espesores/laminado) y un buen sellado perimetral.";
  }
  if (lead.goal === "CONTROL_CONDENSACIÓN") {
    return "Para condensación, clave: DVH + sellos correctos + ventilación. Te recomiendo una configuración que reduzca ese problema.";
  }
  return "Te armo una solución buena y bien cerrada, pensando en desempeño y durabilidad.";
}

// ====== IA SOLO para cierre (si quieres). Si no, cierre determinístico ======
async function aiClose(lead) {
  if (!openai) return null;

  const prompt = `
Eres asesor comercial humano en Chile. Responde corto y cercano (máx 6 líneas).
Datos lead:
- Ciudad: ${lead.city}
- Producto: ${(lead.products || []).join(", ")}
- Objetivo: ${lead.goal}
- Cantidad: ${lead.quantities || "N/D"}
- Medidas: ${lead.measures || "N/D"}
- Vidrio: ${lead.glazing || "N/D"}

Tarea:
1) Confirma lo entendido en 1 línea (sin "Entiendo que...")
2) Propón recomendación breve (ej: DVH + Low-E para térmica)
3) Cierra con 1 pregunta: "¿Agendamos medición o me envías fotos de los vanos para cotizar hoy?"
No repitas preguntas ya respondidas.`;

  const r = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.25,
    max_tokens: 160,
    messages: [{ role: "user", content: prompt }],
  });

  return r?.choices?.[0]?.message?.content?.trim() || null;
}

async function generateReply(session, userText) {
  const prev = { ...session.lead };
  session.lead = parseLeadFromText(session.lead, userText);

  const contradiction = detectContradiction(prev, session.lead);
  if (contradiction && !session.profile.typeConfirmed) {
    session.profile.typeConfirmed = true;
    return `Solo para no equivocarme: ¿confirmo que es **${contradiction.to.toLowerCase()}**?`;
  }

  const next = pickNextQuestion(session.lead);

  // Si falta algo, respuesta determinística (corta, 1 pregunta)
  if (next) {
    return `${humanSummary(session.lead)}\n${humanBenefit(session.lead)}\n${next.q}`;
  }

  // Si ya está lo mínimo, cierre (IA opcional) o determinístico
  const lead = session.lead;
  const closeAI = await aiClose(lead);
  if (closeAI) return closeAI;

  return `Listo. Con ${lead.quantities} unidades y medidas ${lead.measures}, te puedo cotizar una propuesta buena para ${lead.city}.\n¿Agendamos medición o me envías fotos de los vanos para cotizar hoy?`;
}

// ====== Webhook verify ======
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// ====== POST webhook (ACK inmediato + procesamiento async) ======
app.post("/webhook", (req, res) => {
  res.sendStatus(200);

  setImmediate(() => {
    handleWebhookEvent(req.body).catch((err) =>
      console.error("handleWebhookEvent error:", err?.response?.data || err?.message || err)
    );
  });
});

async function handleWebhookEvent(body) {
  cleanupFingerprints();

  if (body.object !== "whatsapp_business_account") return;

  const entry = body.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  const messages = value?.messages;
  if (!messages || !messages.length) return;

  // Procesa solo mensajes de texto
  for (const msg of messages) {
    if (msg.type !== "text") continue;

    const msgId = msg.id;
    const from = msg.from;
    const text = msg?.text?.body || "";
    const ts = msg.timestamp || "";

    if (!from || !msgId || !text) continue;

    // Dedupe por msgId
    if (processedMsgIds.has(msgId)) continue;
    processedMsgIds.add(msgId);

    // Dedupe por fingerprint (por si Meta reintenta con otro id)
    const fingerprint = sha1(`${from}|${ts}|${normalize(text)}`);
    if (processedFingerprints.has(fingerprint)) continue;
    processedFingerprints.set(fingerprint, now());

    const session = getSession(from);

    // Extra anti-ráfagas: si llega idéntico otra vez, no respondes
    if (session.lastFingerprint === fingerprint) continue;
    session.lastFingerprint = fingerprint;

    const reply = await generateReply(session, text);

    // Envía solo UNA respuesta
    await safeSendWhatsAppOnce(from, reply);

    // CRM opcional
    if (shouldCloseLead(session.lead)) {
      sendToCRM(from, session.lead).catch((e) =>
        console.error("sendToCRM error:", e?.response?.data || e?.message || e)
      );
    }
  }
}

// ====== Health ======
app.get("/", (req, res) => {
  res.status(200).json({ ok: true, service: "whatsapp-sales-bot", ts: new Date().toISOString() });
});

// ====== Listen ======
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
