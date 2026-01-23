// index.js — WhatsApp Sales Bot (Activa Inversiones)
// - Respuesta humana + venta consultiva
// - Anti spam: ACK inmediato + dedupe + debounce
// - No repetir preguntas: "pending question" con TTL
// - IA opcional: OpenAI (AI_PROVIDER=openai) o none
// Requisitos Railway:
// VERIFY_TOKEN, WHATSAPP_TOKEN, PHONE_NUMBER_ID
// OPENAI_API_KEY (si AI_PROVIDER=openai)
// AI_PROVIDER=openai
// AI_MODEL_OPENAI=gpt-4.1-mini (recomendado)

import express from "express";
import axios from "axios";
import crypto from "crypto";

process.on("unhandledRejection", (err) =>
  console.error("UNHANDLED_REJECTION:", err?.response?.data || err?.message || err)
);
process.on("uncaughtException", (err) =>
  console.error("UNCAUGHT_EXCEPTION:", err?.response?.data || err?.message || err)
);

const app = express();
app.use(express.json({ limit: "2mb" }));
const PORT = process.env.PORT || 8080;

// ===================== ENV =====================
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";

// CRM (opcional)
const CRM_WEBHOOK_URL = process.env.CRM_WEBHOOK_URL || "";

// Identidad (opcional)
const BUSINESS_NAME = process.env.BUSINESS_NAME || "Activa Inversiones";
const SALES_REGION = process.env.SALES_REGION || "Temuco y alrededores";

// IA (opcional)
const AI_PROVIDER = (process.env.AI_PROVIDER || "none").toLowerCase();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Acepta ambos por si el nombre quedó mal escrito
const AI_MODEL_OPENAI =
  process.env.AI_MODEL_OPENAI ||
  process.env.AI_MODEL_OPENAI || // tolera typo si lo dejaste así
  "gpt-4.1-mini";

console.log("BOOT: starting app…");
console.log("ENV PORT:", process.env.PORT || PORT);
console.log("ENV PHONE_NUMBER_ID:", PHONE_NUMBER_ID ? "OK" : "MISSING");
console.log("ENV WHATSAPP_TOKEN:", WHATSAPP_TOKEN ? "OK" : "MISSING");
console.log("ENV VERIFY_TOKEN:", VERIFY_TOKEN ? "OK" : "MISSING");
console.log("ENV OPENAI_API_KEY:", OPENAI_API_KEY ? "OK" : "MISSING");
console.log("ENV AI_PROVIDER:", AI_PROVIDER || "none");
console.log("ENV AI_MODEL_OPENAI:", AI_MODEL_OPENAI);
console.log("ENV CRM_WEBHOOK_URL:", CRM_WEBHOOK_URL ? "OK" : "NOT_SET");

// ===================== Controls =====================
const DEBOUNCE_MS = 1200; // agrupa mensajes del usuario en 1 sola respuesta
const SEEN_TEXT_TTL_MS = 90 * 1000; // si llega mismo texto dentro de 90s, ignorar duplicado
const PENDING_TTL_MS = 5 * 60 * 1000; // no repetir la misma pregunta por 5 min
const MSGIDS_MAX = 6000;

// ===================== Stores =====================
const sessions = new Map(); // waId -> session
const processedMsgIds = new Set(); // msg.id -> processed
const seenTextWindow = new Map(); // sha(from|text) -> ts
const inboundBuffers = new Map(); // waId -> { texts: [], timer: null, processing: boolean }

function now() {
  return Date.now();
}
function normalize(text = "") {
  return text.toLowerCase().trim();
}
function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function cleanupStores() {
  const t = now();
  for (const [k, ts] of seenTextWindow.entries()) {
    if (t - ts > SEEN_TEXT_TTL_MS) seenTextWindow.delete(k);
  }
  if (processedMsgIds.size > MSGIDS_MAX) {
    const arr = Array.from(processedMsgIds);
    arr.slice(0, 2500).forEach((id) => processedMsgIds.delete(id));
  }
}

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      lead: {
        customerType: null, // RESIDENCIAL / COMERCIAL / CONSTRUCTOR / ARQUITECTO / INSTITUCIONAL
        city: null,
        products: [],
        goal: null, // AISLACIÓN_TÉRMICA / AISLACIÓN_ACÚSTICA / CONTROL_CONDENSACIÓN / SEGURIDAD
        quantities: null,
        measures: null,
        glazing: null, // DVH, LOW_E, TRIPLE, LAMINADO, ARGON
        timeline: null,
        notes: null,
        name: null,
        email: null,
      },
      flags: {
        greeted: false,
        typeConfirmAsked: false,
      },
      pending: {
        key: null,
        askedAt: 0,
      },
    });
  }
  return sessions.get(waId);
}

function setPending(session, key) {
  session.pending.key = key;
  session.pending.askedAt = now();
}
function clearPendingIfAnswered(session, key, value) {
  if (value && session.pending.key === key) {
    session.pending.key = null;
    session.pending.askedAt = 0;
  }
}
function pendingIsFresh(session, key) {
  return session.pending.key === key && now() - session.pending.askedAt < PENDING_TTL_MS;
}

// ===================== Extraction =====================
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
  const m = text.match(/(?:comuna|ciudad)\s+([a-záéíóúñ\s]{3,40})/i);
  if (m?.[1]) return titleCase(m[1].trim());
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
  if (/(aislaci[oó]n t[eé]rmica|fr[ií]o|calor|eficiencia energ[eé]tica|transmitancia|u[-\s]?value)/i.test(t))
    return "AISLACIÓN_TÉRMICA";
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
  if (/casa|hogar|residencial|depto|departamento/i.test(t)) return "RESIDENCIAL";
  if (/comercial|local|tienda|oficina|bodega|industrial/i.test(t)) return "COMERCIAL";
  if (/constructora|inmobiliaria|obra|licitaci[oó]n/i.test(t)) return "CONSTRUCTOR";
  if (/arquitect|proyectista|especificador/i.test(t)) return "ARQUITECTO";
  if (/colegio|cesfam|hospital|municipal|instituci[oó]n/i.test(t)) return "INSTITUCIONAL";
  return null;
}

function parseLeadFromText(session, text) {
  const lead = session.lead;
  const t = normalize(text);

  const prevType = lead.customerType;

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
    else if (/1\s*mes|mes|30 d/i.test(t)) lead.timeline = "1 MES";
    else if (/más|2\s*mes|3\s*mes|\+1\s*mes/i.test(t)) lead.timeline = "+1 MES";
  }

  const em = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (em?.[0] && !lead.email) lead.email = em[0].toLowerCase();

  const nm = text.match(/me llamo\s+([a-záéíóúñ\s]{2,40})/i);
  if (nm?.[1] && !lead.name) lead.name = nm[1].trim();

  if (/pvc/i.test(t)) lead.notes = mergeTokenList(lead.notes, ["PVC"]);
  if (/alumin/i.test(t)) lead.notes = mergeTokenList(lead.notes, ["ALUMINIO"]);

  // Limpia pending si ya respondió
  clearPendingIfAnswered(session, "customerType", lead.customerType);
  clearPendingIfAnswered(session, "city", lead.city);
  clearPendingIfAnswered(session, "products", (lead.products || []).length ? "ok" : "");
  clearPendingIfAnswered(session, "goal", lead.goal);
  clearPendingIfAnswered(session, "quantities", lead.quantities);
  clearPendingIfAnswered(session, "measures", lead.measures);
  clearPendingIfAnswered(session, "timeline", lead.timeline);

  return { prevType, newType: lead.customerType };
}

// ===================== Conversation =====================
function getMissingKeys(lead) {
  const missing = [];
  if (!lead.customerType) missing.push("customerType");
  if (!lead.city) missing.push("city");
  if (!lead.products || lead.products.length === 0) missing.push("products");
  if (!lead.goal) missing.push("goal");
  if (!lead.quantities) missing.push("quantities");
  if (!lead.measures) missing.push("measures");
  if (!lead.timeline) missing.push("timeline");
  return missing;
}

function questionFor(key) {
  switch (key) {
    case "customerType": return "¿Es para tu casa o para un local/negocio?";
    case "city": return "¿En qué comuna/ciudad es el proyecto?";
    case "products": return "¿Qué necesitas: ventanas, puertas, muro cortina o tabiques vidriados?";
    case "goal": return "¿Qué te importa más: térmico, acústico o controlar condensación?";
    case "quantities": return "¿Cuántas unidades son en total?";
    case "measures": return "¿Medidas aproximadas? (ej: 1600x1900mm)";
    case "timeline": return "¿Para cuándo lo necesitas?";
    default: return "¿Me das un poquito más de detalle para cotizar?";
  }
}

function summaryLine(lead) {
  const bits = [];
  if (lead.city) bits.push(lead.city);
  if ((lead.products || []).length) bits.push(lead.products.join(", ").toLowerCase());
  if (lead.goal) bits.push(lead.goal.toLowerCase().replace("_", " "));
  return bits.length ? `Perfecto: ${bits.join(" · ")}.` : "Perfecto.";
}

function benefitLine(lead) {
  if (lead.goal === "AISLACIÓN_TÉRMICA") {
    return "Para Temuco suele rendir muy bien PVC + DVH; y si quieres subir el nivel, Low-E marca la diferencia en confort y desempeño.";
  }
  if (lead.goal === "AISLACIÓN_ACÚSTICA") {
    return "Para ruido, el salto real lo da el vidrio (laminado/espesores) + un buen sellado e instalación.";
  }
  if (lead.goal === "CONTROL_CONDENSACIÓN") {
    return "Para condensación: DVH + sellos correctos + buena ventilación/instalación. Te propongo una configuración que reduzca ese problema.";
  }
  if (lead.goal === "SEGURIDAD") {
    return "Para seguridad: laminado + herrajes buenos. Te indico una configuración sólida.";
  }
  return "Te recomiendo una solución bien cerrada, pensando en desempeño y durabilidad.";
}

function readyToClose(lead) {
  return Boolean(
    lead.city &&
    lead.customerType &&
    (lead.products?.length || 0) > 0 &&
    lead.goal &&
    (lead.quantities || lead.measures)
  );
}

function chooseQuestions(session, missingKeys) {
  const priority = ["customerType", "city", "products", "goal", "quantities", "measures", "timeline"];
  const ordered = priority.filter((k) => missingKeys.includes(k));

  const picked = [];
  for (const k of ordered) {
    if (picked.length >= 2) break;
    if (pendingIsFresh(session, k)) continue;
    picked.push(k);
  }

  if (!picked.length && session.pending.key) return [session.pending.key];
  return picked;
}

async function openaiChat({ system, user }) {
  const r = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: AI_MODEL_OPENAI,
      temperature: 0.2,
      max_tokens: 220,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 12000,
    }
  );
  return r?.data?.choices?.[0]?.message?.content?.trim() || "";
}

async function buildCloseMessage(session) {
  const lead = session.lead;

  const base =
    `Listo, con eso ya puedo cotizar.\n` +
    `Recomendación: DVH${lead.goal === "AISLACIÓN_TÉRMICA" ? " + Low-E" : ""} y buen sellado.\n` +
    `¿Agendamos medición o me mandas 2–3 fotos de los vanos para cotizar hoy?`;

  if (AI_PROVIDER !== "openai") return base;
  if (!OPENAI_API_KEY) return base;

  const system =
    `Eres asesor comercial humano de ${BUSINESS_NAME} en Chile. ` +
    `Vendes ventanas PVC/aluminio, puertas, muros cortina, tabiques vidriados y termopanel. ` +
    `Responde corto, natural, vendedor y concreto. No repitas preguntas.`;

  const user =
    `Crea un cierre en máximo 5 líneas. Sin "Entiendo que".\n` +
    `Datos: ciudad=${lead.city}, tipo=${lead.customerType}, productos=${(lead.products || []).join(", ")}, ` +
    `cantidad=${lead.quantities || "N/D"}, medidas=${lead.measures || "N/D"}, objetivo=${lead.goal}, vidrio=${lead.glazing || "N/D"}.\n` +
    `Incluye recomendación breve (DVH y si es térmico agrega Low-E). ` +
    `Termina con una sola pregunta: "¿Agendamos medición o me mandas fotos de los vanos?"`;

  try {
    const txt = await openaiChat({ system, user });
    return txt || base;
  } catch (e) {
    console.error("AI close error:", e?.response?.data || e?.message || e);
    return base;
  }
}

async function generateReply(session, combinedUserText) {
  const { prevType, newType } = parseLeadFromText(session, combinedUserText);
  const lead = session.lead;

  // Si cambió el tipo, confirmar 1 vez
  if (prevType && newType && prevType !== newType && !session.flags.typeConfirmAsked) {
    session.flags.typeConfirmAsked = true;
    setPending(session, "customerType");
    return `Perfecto. Solo para no equivocarme: ¿confirmo que es **${newType.toLowerCase()}**?`;
  }

  const missing = getMissingKeys(lead);

  // Saludo una sola vez
  if (!session.flags.greeted) {
    session.flags.greeted = true;
    const top = chooseQuestions(session, missing.length ? missing : ["products", "city"]);
    top.forEach((k) => setPending(session, k));
    return `Hola, soy ${BUSINESS_NAME}. Para cotizar rápido:\n${top.map(questionFor).join(" ")}`;
  }

  // Cierre si ya está listo
  if (readyToClose(lead)) return await buildCloseMessage(session);

  // Preguntar 1–2 cosas, sin repetir la pendiente
  const picked = chooseQuestions(session, missing);
  picked.forEach((k) => setPending(session, k));

  // Si solo queda pendiente reciente, recordatorio suave
  if (picked.length === 1 && pendingIsFresh(session, picked[0])) {
    return `${summaryLine(lead)}\n${benefitLine(lead)}\nCuando puedas, solo dime esto: ${questionFor(picked[0])}`;
  }

  return `${summaryLine(lead)}\n${benefitLine(lead)}\n${picked.map(questionFor).join(" ")}`;
}

// ===================== WhatsApp send =====================
async function sendWhatsAppText(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) throw new Error("Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID");

  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body: text } };

  await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    timeout: 10000,
  });
}

// ===================== CRM (optional) =====================
async function sendToCRM(waId, lead) {
  if (!CRM_WEBHOOK_URL) return;
  await axios.post(
    CRM_WEBHOOK_URL,
    { waId, source: "whatsapp", business: BUSINESS_NAME, region: SALES_REGION, lead, ts: new Date().toISOString() },
    { timeout: 10000 }
  );
}

// ===================== Debounce inbound =====================
function enqueueInbound(waId, text, flushFn) {
  const entry = inboundBuffers.get(waId) || { texts: [], timer: null, processing: false };

  entry.texts.push(text);

  if (!entry.timer) {
    entry.timer = setTimeout(async () => {
      if (entry.processing) return;
      entry.processing = true;

      const combined = entry.texts.join("\n");
      entry.texts = [];
      entry.timer = null;
      inboundBuffers.set(waId, entry);

      try {
        await flushFn(combined);
      } finally {
        entry.processing = false;

        // si entró texto durante el procesamiento, dispara otra vez
        if (entry.texts.length > 0 && !entry.timer) {
          entry.timer = setTimeout(async () => {
            if (entry.processing) return;
            entry.processing = true;
            const combined2 = entry.texts.join("\n");
            entry.texts = [];
            entry.timer = null;
            inboundBuffers.set(waId, entry);
            try {
              await flushFn(combined2);
            } finally {
              entry.processing = false;
            }
          }, DEBOUNCE_MS);
        }
      }
    }, DEBOUNCE_MS);
  }

  inboundBuffers.set(waId, entry);
}

// ===================== Webhook verify =====================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// ===================== Webhook POST (ACK inmediato) =====================
app.post("/webhook", (req, res) => {
  res.sendStatus(200);
  setImmediate(() => {
    handleWebhookEvent(req.body).catch((err) =>
      console.error("handleWebhookEvent error:", err?.response?.data || err?.message || err)
    );
  });
});

async function handleWebhookEvent(body) {
  cleanupStores();

  if (body.object !== "whatsapp_business_account") return;

  const entry = body.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const messages = value?.messages;

  if (!messages || !messages.length) return;

  for (const msg of messages) {
    if (msg.type !== "text") continue;

    const msgId = msg.id;
    const from = msg.from;
    const text = msg?.text?.body || "";

    if (!from || !msgId || !text) continue;

    // 1) Dedupe por msgId
    if (processedMsgIds.has(msgId)) continue;
    processedMsgIds.add(msgId);

    // 2) Dedupe por texto (from+text) dentro de 90s
    const textKey = sha1(`${from}|${normalize(text)}`);
    const lastSeen = seenTextWindow.get(textKey);
    if (lastSeen && now() - lastSeen < SEEN_TEXT_TTL_MS) continue;
    seenTextWindow.set(textKey, now());

    // Debounce: agrupa mensajes del mismo usuario
    enqueueInbound(from, text, async (combinedText) => {
      const session = getSession(from);
      const reply = await generateReply(session, combinedText);

      await sendWhatsAppText(from, reply).catch((e) =>
        console.error("sendWhatsAppText error:", e?.response?.data || e?.message || e)
      );

      // CRM opcional
      if (CRM_WEBHOOK_URL) {
        const lead = session.lead;
        if (lead.city && (lead.products?.length || 0) > 0) {
          sendToCRM(from, lead).catch((e) =>
            console.error("sendToCRM error:", e?.response?.data || e?.message || e)
          );
        }
      }
    });
  }
}

// ===================== Health =====================
app.get("/", (req, res) => {
  res.status(200).json({ ok: true, service: "whatsapp-sales-bot", ts: new Date().toISOString() });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
