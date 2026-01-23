import express from "express";
import axios from "axios";
import OpenAI from "openai";
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

// ===================== Memory =====================
const sessions = new Map(); // waId -> session
const processedMsgIds = new Set(); // idempotencia por msg.id
const seenTextWindow = new Map(); // key: sha(from|text) -> timestamp (anti duplicados por texto)

const SEEN_TEXT_TTL_MS = 90 * 1000; // 90 segundos: si llega mismo texto del mismo número, no respondemos 2 veces
const MSGIDS_MAX = 5000;

function now() {
  return Date.now();
}

function normalize(text = "") {
  return text.toLowerCase().trim();
}

function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function cleanup() {
  const t = now();
  for (const [k, ts] of seenTextWindow.entries()) {
    if (t - ts > SEEN_TEXT_TTL_MS) seenTextWindow.delete(k);
  }
  if (processedMsgIds.size > MSGIDS_MAX) {
    const arr = Array.from(processedMsgIds);
    arr.slice(0, 2000).forEach((id) => processedMsgIds.delete(id));
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
        glazing: null, // DVH, LOW_E, TRIPLE...
        timeline: null,
        notes: null,
        name: null,
        email: null,
      },
      flags: {
        greeted: false,
        typeConfirmAsked: false,
      },
    });
  }
  return sessions.get(waId);
}

// ===================== Parsers =====================
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
  if (/(aislaci[oó]n t[eé]rmica|fr[ií]o|calor|eficiencia energ[eé]tica)/i.test(t)) return "AISLACIÓN_TÉRMICA";
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
  // soporta: 1600x1900, 1.60x1.90 m, 160x190 cm, etc.
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
    else if (/más|2\s*mes|3\s*mes|\+1\s*mes/i.test(t)) lead.timeline = "+1 MES";
  }

  const em = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (em?.[0] && !lead.email) lead.email = em[0].toLowerCase();

  const nm = text.match(/me llamo\s+([a-záéíóúñ\s]{2,40})/i);
  if (nm?.[1] && !lead.name) lead.name = nm[1].trim();

  if (/pvc/i.test(t)) lead.notes = mergeTokenList(lead.notes, ["PVC"]);
  if (/alumin/i.test(t)) lead.notes = mergeTokenList(lead.notes, ["ALUMINIO"]);

  return lead;
}

// ===================== Next questions (hasta 2 por turno) =====================
function getMissing(lead) {
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
    case "city": return "¿En qué comuna/ciudad es?";
    case "products": return "¿Qué necesitas: ventanas, puertas, muro cortina o tabiques vidriados?";
    case "goal": return "¿Tu prioridad es térmico, acústico o controlar condensación?";
    case "quantities": return "¿Cuántas unidades son en total?";
    case "measures": return "¿Medidas aproximadas? (ej: 1600x1900mm)";
    case "timeline": return "¿Para cuándo lo necesitas?";
    default: return "¿Me das un poquito más de detalle para cotizar?";
  }
}

function buildShortReply(lead, missingKeys) {
  // Resumen 1 línea, muy corta
  const bits = [];
  if (lead.city) bits.push(lead.city);
  if ((lead.products || []).length) bits.push(lead.products.join(", ").toLowerCase());
  if (lead.goal) bits.push(lead.goal.toLowerCase().replace("_", " "));
  const summary = bits.length ? `Perfecto: ${bits.join(" · ")}.` : "Perfecto.";

  // Beneficio 1 línea (sin “Entiendo que…”)
  let benefit = "Te lo dejo bien claro y con buena recomendación.";
  if (lead.goal === "AISLACIÓN_TÉRMICA") {
    benefit = "Para Temuco suele rendir muy bien PVC + DVH; y si quieres lo mejor, Low-E marca la diferencia.";
  } else if (lead.goal === "AISLACIÓN_ACÚSTICA") {
    benefit = "Para ruido, lo que más manda es el vidrio (laminado/espesores) y un buen sellado.";
  } else if (lead.goal === "CONTROL_CONDENSACIÓN") {
    benefit = "Para condensación, clave: DVH + sellos correctos + buena instalación.";
  }

  // Hasta 2 preguntas máximo
  const questions = missingKeys.slice(0, 2).map((k) => questionFor(k));
  return `${summary}\n${benefit}\n${questions.join(" ")}`;
}

function readyToClose(lead) {
  return Boolean(
    lead.customerType &&
    lead.city &&
    (lead.products?.length || 0) > 0 &&
    (lead.quantities || lead.measures) &&
    lead.goal
  );
}

// ===================== WhatsApp Send =====================
async function sendWhatsAppText(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) throw new Error("Faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID");

  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body: text } };

  await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    timeout: 10000,
  });
}

async function sendToCRM(waId, lead) {
  if (!CRM_WEBHOOK_URL) return;
  await axios.post(
    CRM_WEBHOOK_URL,
    { waId, source: "whatsapp", business: BUSINESS_NAME, region: SALES_REGION, lead, ts: new Date().toISOString() },
    { timeout: 10000 }
  );
}

// ===================== Close message (IA opcional, corto) =====================
async function closeMessage(lead) {
  // Cierre determinístico corto (por defecto)
  const base =
    `Listo. Con eso ya puedo cotizar.\n` +
    `Recomendación top: DVH + Low-E (y buen sellado) para cumplir desempeño térmico y mejorar confort.\n` +
    `¿Agendamos medición o me mandas 2–3 fotos de los vanos para cotizar hoy?`;

  if (!openai) return base;

  // IA: SOLO para pulir tono, pero con límites estrictos
  const prompt = `
Escribe un cierre humano y corto (máx 5 líneas). Sin "Entiendo que".
Datos: ciudad=${lead.city}, tipo=${lead.customerType}, producto=${(lead.products||[]).join(", ")},
medidas=${lead.measures||"N/D"}, cantidad=${lead.quantities||"N/D"}, objetivo=${lead.goal}.
Incluye recomendación DVH+Low-E para térmico si aplica. Termina con: "¿Agendamos medición o me mandas fotos de los vanos?"
`;
  const r = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.2,
    max_tokens: 140,
    messages: [{ role: "user", content: prompt }],
  });

  return r?.choices?.[0]?.message?.content?.trim() || base;
}

// ===================== Main reply generator =====================
async function generateReply(session, userText) {
  const prevType = session.lead.customerType;
  session.lead = parseLeadFromText(session.lead, userText);

  // Si cambió el tipo, confirmar una sola vez (sin dar la lata)
  if (prevType && session.lead.customerType && prevType !== session.lead.customerType && !session.flags.typeConfirmAsked) {
    session.flags.typeConfirmAsked = true;
    return `Solo para no equivocarme: ¿confirmo que es **${session.lead.customerType.toLowerCase()}**?`;
  }

  const missing = getMissing(session.lead);

  // Saludo solo una vez
  if (!session.flags.greeted) {
    session.flags.greeted = true;
    // si está muy vacío, primer empujón corto
    if (missing.includes("customerType") || missing.includes("city") || missing.includes("products")) {
      const top = ["customerType", "city", "products"].filter((k) => missing.includes(k));
      return `Hola, soy ${BUSINESS_NAME}. Para ayudarte rápido:\n${top.slice(0, 2).map(questionFor).join(" ")}`;
    }
  }

  // Si ya está listo, cerrar
  if (readyToClose(session.lead)) return await closeMessage(session.lead);

  // Si falta info, preguntar máximo 2 cosas por turno
  // Priorización
  const priority = ["customerType", "city", "products", "goal", "quantities", "measures", "timeline"];
  const orderedMissing = priority.filter((k) => missing.includes(k));

  return buildShortReply(session.lead, orderedMissing);
}

// ===================== Webhook verify =====================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// ===================== POST webhook (ACK inmediato) =====================
app.post("/webhook", (req, res) => {
  res.sendStatus(200);
  setImmediate(() => handleWebhookEvent(req.body).catch((e) => console.error("handleWebhookEvent:", e)));
});

async function handleWebhookEvent(body) {
  cleanup();

  if (body.object !== "whatsapp_business_account") return;

  const entry = body.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  const messages = value?.messages;
  if (!messages || !messages.length) return;

  for (const msg of messages) {
    // Solo texto
    if (msg.type !== "text") continue;

    const msgId = msg.id;
    const from = msg.from;
    const text = msg?.text?.body || "";

    if (!from || !msgId || !text) continue;

    // 1) dedupe por msgId
    if (processedMsgIds.has(msgId)) continue;
    processedMsgIds.add(msgId);

    // 2) dedupe por texto (mismo from + mismo texto dentro de 90s)
    const textKey = sha1(`${from}|${normalize(text)}`);
    const lastSeen = seenTextWindow.get(textKey);
    if (lastSeen && now() - lastSeen < SEEN_TEXT_TTL_MS) continue;
    seenTextWindow.set(textKey, now());

    const session = getSession(from);

    const reply = await generateReply(session, text);

    await sendWhatsAppText(from, reply).catch((e) =>
      console.error("sendWhatsAppText error:", e?.response?.data || e?.message || e)
    );

    // CRM opcional
    if (CRM_WEBHOOK_URL) {
      if (session.lead.city && (session.lead.products?.length || 0) > 0) {
        sendToCRM(from, session.lead).catch((e) =>
          console.error("sendToCRM error:", e?.response?.data || e?.message || e)
        );
      }
    }
  }
}

// ===================== Health =====================
app.get("/", (req, res) => {
  res.status(200).json({ ok: true, service: "whatsapp-sales-bot", ts: new Date().toISOString() });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
