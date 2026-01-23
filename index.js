// index.js — WhatsApp Business API (Meta) + IA (OpenAI) Ventas Activa Inversiones
// Objetivo: Conversación humana, sin repetir preguntas, califica cliente, vende y prepara lead para CRM.
// Solución clave: ACK inmediato (200) a Meta para evitar 502 timeouts.

import express from "express";
import axios from "axios";
import OpenAI from "openai";

// ====== Boot safety logs (para Railway) ======
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED_REJECTION:", err?.response?.data || err?.message || err);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT_EXCEPTION:", err?.response?.data || err?.message || err);
});
console.log("BOOT: starting app…");

// ====== App ======
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
  BUSINESS_NAME = "Activa Inversiones EIRL",
  SALES_REGION = "Región de La Araucanía, Chile",
} = process.env;

console.log("ENV PORT:", process.env.PORT);
console.log("ENV PHONE_NUMBER_ID:", PHONE_NUMBER_ID ? "OK" : "MISSING");
console.log("ENV WHATSAPP_TOKEN:", WHATSAPP_TOKEN ? "OK" : "MISSING");
console.log("ENV VERIFY_TOKEN:", VERIFY_TOKEN ? "OK" : "MISSING");
console.log("ENV OPENAI_API_KEY:", OPENAI_API_KEY ? "OK" : "MISSING");
console.log("ENV CRM_WEBHOOK_URL:", CRM_WEBHOOK_URL ? "OK" : "NOT_SET");

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// ====== Estado en memoria ======
const sessions = new Map(); // key: wa_id
const processedMsgIds = new Set();

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      stage: "START",
      profile: {
        typeConfirmed: false,
      },
      lead: {
        customerType: null, // RESIDENCIAL / COMERCIAL / CONSTRUCTOR / ARQUITECTO / INSTITUCIONAL
        name: null,
        comuna: null,
        city: null,
        email: null,
        projectType: null,
        products: [],
        quantities: null,
        measures: null,
        glazing: null, // "DVH, LOW_E, TRIPLE..."
        opening: null,
        installation: null,
        timeline: null,
        goal: null, // AISLACIÓN_TÉRMICA / ...
        notes: null,
      },
      lastMessageAt: Date.now(),
    });
  }
  const s = sessions.get(waId);
  s.lastMessageAt = Date.now();
  return s;
}

function normalize(text = "") {
  return text.toLowerCase().trim();
}

// ====== Detectores / Parsers ======
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

function detectCityOrComuna(text = "") {
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
  if (/(condensaci[oó]n|empa[nñ]amiento|hongo|humedad)/i.test(t)) return "CONTROL_CONDENSACIÓN";
  if (/(seguridad|laminad|antirrobo)/i.test(t)) return "SEGURIDAD";
  return null;
}

function mergeNote(current, add) {
  const c = (current || "").trim();
  if (!c) return add;
  if (c.toLowerCase().includes(add.toLowerCase())) return c;
  return `${c} | ${add}`;
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

function parseLeadFromText(lead, text) {
  const t = normalize(text);

  // Tipo cliente
  if (/residencial|casa|depto|departamento|hogar/i.test(t)) lead.customerType = "RESIDENCIAL";
  if (/comercial|local|tienda|oficina|bodega|industrial/i.test(t)) lead.customerType = "COMERCIAL";
  if (/constructora|inmobiliaria|obra|licitaci[oó]n/i.test(t)) lead.customerType = "CONSTRUCTOR";
  if (/arquitect|proyectista|especificador/i.test(t)) lead.customerType = "ARQUITECTO";
  if (/colegio|cesfam|hospital|municipal|instituci[oó]n/i.test(t)) lead.customerType = "INSTITUCIONAL";

  // Ciudad/Comuna
  const city = detectCityOrComuna(text);
  if (city) {
    lead.city = city;
    lead.comuna = city;
  }

  // Productos
  const prods = detectProducts(text);
  if (prods.length) {
    lead.products = Array.from(new Set([...(lead.products || []), ...prods]));
  }

  // Material
  if (/pvc/i.test(t)) lead.notes = mergeNote(lead.notes, "Interés en PVC");
  if (/alumin/i.test(t)) lead.notes = mergeNote(lead.notes, "Interés en aluminio");

  // Vidrio / termopanel
  if (/(termopanel|dvh)/i.test(t)) lead.glazing = mergeTokenList(lead.glazing, ["DVH"]);
  if (/(triple)/i.test(t)) lead.glazing = mergeTokenList(lead.glazing, ["TRIPLE"]);
  if (/(low[-\s]?e|baja emisividad)/i.test(t)) lead.glazing = mergeTokenList(lead.glazing, ["LOW_E"]);
  if (/(laminad)/i.test(t)) lead.glazing = mergeTokenList(lead.glazing, ["LAMINADO"]);
  if (/(argon)/i.test(t)) lead.glazing = mergeTokenList(lead.glazing, ["ARGON"]);

  // Objetivo
  const goal = detectGoal(text);
  if (goal) lead.goal = goal;

  // Email
  if (!lead.email) {
    const em = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (em?.[0]) lead.email = em[0].toLowerCase();
  }

  // Nombre (simple)
  if (!lead.name) {
    const m = text.match(/me llamo\s+([a-záéíóúñ\s]{2,40})/i);
    if (m?.[1]) lead.name = m[1].trim();
  }

  // Plazo
  if (!lead.timeline) {
    if (/hoy|urgente|ya/i.test(t)) lead.timeline = "URGENTE";
    else if (/semana|7 d/i.test(t)) lead.timeline = "1-2 SEM";
    else if (/mes|30 d/i.test(t)) lead.timeline = "1 MES";
    else if (/\+?1\s*mes|2\s*mes|3\s*mes|más/i.test(t)) lead.timeline = "+1 MES";
  }

  return lead;
}

function detectContradiction(prevLead, newLead) {
  if (!prevLead?.customerType || !newLead?.customerType) return null;
  if (prevLead.customerType !== newLead.customerType) {
    return { from: prevLead.customerType, to: newLead.customerType };
  }
  return null;
}

function pickNextQuestion(lead) {
  if (!lead.customerType) return { key: "customerType", q: "¿Es para casa (residencial) o para un local/negocio (comercial)?" };
  if (!lead.city && !lead.comuna) return { key: "city", q: "¿En qué comuna/ciudad es el proyecto?" };
  if (!lead.products || lead.products.length === 0) return { key: "products", q: "¿Qué necesitas cotizar: ventanas, puertas, muro cortina o tabiques vidriados?" };
  if (!lead.goal) return { key: "goal", q: "¿Tu prioridad es aislación térmica, acústica o controlar condensación?" };
  if (!lead.quantities && !lead.measures) return { key: "scope", q: "¿Cuántas unidades son y tienes medidas aproximadas? (aunque sea estimado)" };
  if (!lead.timeline) return { key: "timeline", q: "¿Para cuándo lo necesitas? (urgente / 1-2 semanas / 1 mes / más)" };
  return null;
}

function shouldCloseLead(lead) {
  return Boolean(
    (lead.city || lead.comuna) &&
      (lead.products?.length || 0) > 0 &&
      (lead.goal || lead.timeline || lead.measures || lead.quantities)
  );
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

function safeSendWhatsAppText(to, text) {
  sendWhatsAppText(to, text).catch((e) => {
    console.error("sendWhatsAppText error:", e?.response?.data || e?.message || e);
  });
}

async function sendToCRM(waId, lead) {
  if (!CRM_WEBHOOK_URL) return;
  await axios.post(
    CRM_WEBHOOK_URL,
    {
      waId,
      source: "whatsapp",
      business: BUSINESS_NAME,
      region: SALES_REGION,
      lead,
      ts: new Date().toISOString(),
    },
    { timeout: 10000 }
  );
}

function safeSendToCRM(waId, lead) {
  sendToCRM(waId, lead).catch((e) => {
    console.error("sendToCRM error:", e?.response?.data || e?.message || e);
  });
}

// ====== IA prompt ======
function buildSystemPrompt(session) {
  const lead = session.lead || {};
  return `
Eres un asesor comercial HUMANO de ${BUSINESS_NAME} en ${SALES_REGION}.
Vendes: ventanas PVC/aluminio, puertas, muros cortina, tabiques vidriados y termopanel (DVH/Low-E/Acústico/Laminado/Argón).

REGLAS:
- No suenes robótico. Usa frases cortas, naturales y concretas.
- NO repitas preguntas ya respondidas: usa el lead como memoria.
- Máximo 1 pregunta por mensaje.
- Estructura: 1) resumen breve de lo entendido (1–2 líneas), 2) beneficio/valor (1 línea), 3) una sola pregunta.
- Normativa eficiencia energética Chile: habla de “exigencias vigentes” y desempeño (aislación, sellos, control de condensación). No cites decretos ni números.
- Si piden precio y faltan datos: da orientación general y pide el dato faltante clave.

MEMORIA (lead):
Tipo cliente: ${lead.customerType || "N/D"}
Ciudad/Comuna: ${lead.city || lead.comuna || "N/D"}
Productos: ${(lead.products || []).join(", ") || "N/D"}
Vidrio: ${lead.glazing || "N/D"}
Objetivo: ${lead.goal || "N/D"}
Plazo: ${lead.timeline || "N/D"}
Notas: ${lead.notes || "N/D"}
`;
}

// ====== Generación respuesta (anti repetición) ======
async function generateSalesReply({ waId, userText }) {
  const session = getSession(waId);

  const prev = { ...session.lead };
  session.lead = parseLeadFromText(session.lead, userText);

  const contradiction = detectContradiction(prev, session.lead);
  if (contradiction && !session.profile.typeConfirmed) {
    session.profile.typeConfirmed = true;
    return `Perfecto, para no equivocarme: me dijiste *${contradiction.from}* y ahora *${contradiction.to}*. ¿Confirmo que es **${contradiction.to.toLowerCase()}**?`;
  }

  const next = pickNextQuestion(session.lead);

  // Si no hay OpenAI, fallback inteligente
  if (!openai) {
    const summaryParts = [];
    if (session.lead.city) summaryParts.push(`En ${session.lead.city}`);
    if ((session.lead.products || []).length) summaryParts.push(`por ${session.lead.products.join(", ")}`);
    if (session.lead.goal) summaryParts.push(`(prioridad: ${session.lead.goal.toLowerCase().replace("_", " ")})`);
    const summary = summaryParts.length ? `${summaryParts.join(" ")}.` : "Perfecto, ya te entendí.";

    const benefit =
      session.lead.goal === "AISLACIÓN_TÉRMICA"
        ? "PVC + termopanel (ideal Low-E) mejora mucho confort y ayuda a cumplir exigencias vigentes de desempeño térmico."
        : "Te propongo una solución orientada a desempeño, sellos y buena durabilidad.";

    return next ? `${summary}\n${benefit}\n${next.q}` : `${summary}\n${benefit}\n¿Prefieres medición en terreno o me envías medidas/fotos para cotizar hoy?`;
  }

  // Con IA
  const requiredKey = next?.key || "closing";
  const requiredQuestion = next?.q || "¿Prefieres medición en terreno o me envías medidas/fotos para cotizar hoy?";

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.35,
    max_tokens: 180,
    messages: [
      { role: "system", content: buildSystemPrompt(session) },
      {
        role: "user",
        content: `Mensaje del cliente: "${userText}".
Reglas: no repetir preguntas, máximo 1 pregunta.
La única pregunta que corresponde ahora es sobre: ${requiredKey}.
Si ya está todo, cierra con: "${requiredQuestion}".`,
      },
    ],
  });

  const reply = completion?.choices?.[0]?.message?.content?.trim();
  return reply || requiredQuestion;
}

// ====== Webhook verify (GET) ======
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ====== POST webhook (ACK inmediato) ======
app.post("/webhook", (req, res) => {
  // RESPONDER INMEDIATO A META
  res.sendStatus(200);

  // PROCESAR DESPUÉS
  setImmediate(() => {
    handleWebhookEvent(req.body).catch((err) => {
      console.error("handleWebhookEvent error:", err?.response?.data || err?.message || err);
    });
  });
});

async function handleWebhookEvent(body) {
  if (body.object !== "whatsapp_business_account") return;

  const entry = body.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  const messages = value?.messages;
  if (!messages || !messages.length) return;

  const msg = messages[0];
  const msgId = msg.id;
  const from = msg.from;
  const text = msg?.text?.body || "";

  if (!from || !msgId) return;

  // Dedupe
  if (processedMsgIds.has(msgId)) return;
  processedMsgIds.add(msgId);
  if (processedMsgIds.size > 2000) {
    const arr = Array.from(processedMsgIds);
    arr.slice(0, 800).forEach((id) => processedMsgIds.delete(id));
  }

  const reply = await generateSalesReply({ waId: from, userText: text });

  const safeReply =
    reply ||
    `Gracias por escribir a ${BUSINESS_NAME}.
Para cotizar rápido: ¿en qué comuna/ciudad es el proyecto y cuántas unidades son?`;

  safeSendWhatsAppText(from, safeReply);

  // Si ya está listo, envía al CRM
  const session = getSession(from);
  if (shouldCloseLead(session.lead)) {
    safeSendToCRM(from, session.lead);
  }
}

// ====== Health ======
app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "whatsapp-sales-bot",
    ts: new Date().toISOString(),
  });
});

// ====== Listen ======
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
