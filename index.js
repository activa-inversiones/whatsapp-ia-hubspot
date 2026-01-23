// index.js — WhatsApp Business API (Meta) + IA (OpenAI) para VENTAS (ventanas/puertas/muros cortina/tabiques vidriados/termopanel)
// Enfoque: 1 solo número, atención humana, calificación del tipo de cliente, captura de datos y listo para conectar CRM.
//
// ====== ENV (Railway Variables) ======
// OPENAI_API_KEY=...
// VERIFY_TOKEN=... (mismo token de verificación de Webhooks)
// WHATSAPP_TOKEN=... (token largo System User / permanente)
// PHONE_NUMBER_ID=... (ej: 936007209596307)
// CRM_WEBHOOK_URL=... (opcional: endpoint tuyo para enviar lead al CRM)
// BUSINESS_NAME=Activa Inversiones
// SALES_REGION=Región de La Araucanía
// DEFAULT_REPLY_FALLBACK=true

import express from "express";
import axios from "axios";
import OpenAI from "openai";

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
  SALES_REGION = "Chile",
  DEFAULT_REPLY_FALLBACK = "true",
} = process.env;

if (!WHATSAPP_TOKEN) console.warn("⚠️ Falta WHATSAPP_TOKEN");
if (!PHONE_NUMBER_ID) console.warn("⚠️ Falta PHONE_NUMBER_ID");
if (!VERIFY_TOKEN) console.warn("⚠️ Falta VERIFY_TOKEN");
if (!OPENAI_API_KEY) console.warn("⚠️ Falta OPENAI_API_KEY");

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ====== Estado simple en memoria (puedes reemplazar por Redis/DB) ======
const sessions = new Map(); // key: wa_id, value: { stage, profile, lead, lastMessageAt }
const processedMsgIds = new Set(); // dedupe

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      stage: "START",
      profile: {},
      lead: {
        customerType: null, // RESIDENCIAL / CONSTRUCTOR / ARQUITECTO / INSTITUCIONAL / COMERCIAL
        name: null,
        comuna: null,
        city: null,
        email: null,
        projectType: null, // CASA / DEPTO / OBRA / COLEGIO / HOSPITAL / LOCAL / OTRO
        products: [], // VENTANAS / PUERTAS / MURO_CORTINA / TABIQUES / TERMOPANEL / OTRO
        quantities: null,
        measures: null,
        glazing: null, // DVH / TRIPLE / LOWE / LAMINADO / SOLAR / ACUSTICO / ARGON / WARM_EDGE
        color: null,
        opening: null,
        installation: null, // SI/NO/RETIRO
        timeline: null, // URGENTE / 1-2 SEM / 1 MES / +1 MES
        budgetHint: null,
        notes: null,
        consent: null, // SI/NO para contacto
      },
      lastMessageAt: Date.now(),
    });
  }
  const s = sessions.get(waId);
  s.lastMessageAt = Date.now();
  return s;
}

// ====== Utilidades WhatsApp ======
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
    timeout: 15000,
  });

  return res.data;
}

async function sendToCRM(waId, lead) {
  if (!CRM_WEBHOOK_URL) return;
  try {
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
      { timeout: 12000 }
    );
  } catch (e) {
    console.warn("⚠️ CRM_WEBHOOK_URL falló:", e?.response?.data || e.message);
  }
}

// ====== Extracción básica de datos (heurística rápida) ======
function normalize(text = "") {
  return text.toLowerCase().trim();
}

function detectProducts(t) {
  const x = normalize(t);
  const products = new Set();
  if (/(ventana|ventanas|termopanel|dvh|triple|low[-\s]?e)/i.test(x)) products.add("VENTANAS/TERMOPANEL");
  if (/(puerta|puertas)/i.test(x)) products.add("PUERTAS");
  if (/(muro cortina|curtain wall|fachada)/i.test(x)) products.add("MURO_CORTINA");
  if (/(tabique vidriado|división vidriada|oficina|mampara)/i.test(x)) products.add("TABIQUES_VIDRIADOS");
  if (/(baranda|barandal|pasamanos)/i.test(x)) products.add("OTRO_BARANDAS");
  return Array.from(products);
}

function detectCustomerType(t) {
  const x = normalize(t);
  if (/(arquitect|especificador|proyectista)/i.test(x)) return "ARQUITECTO";
  if (/(constructor|constructora|inmobiliaria|obra|licitación|subcontrato)/i.test(x)) return "CONSTRUCTOR";
  if (/(municipal|servicio|hospital|cesfam|colegio|liceo|jard[ií]n|instituci[oó]n)/i.test(x)) return "INSTITUCIONAL";
  if (/(local|comercial|bodega|planta|industrial|tienda|oficina)/i.test(x)) return "COMERCIAL";
  return null;
}

function shouldCloseLead(lead) {
  // Si ya tenemos lo mínimo para cotizar / coordinar visita
  return Boolean(
    (lead.name || "").length >= 2 &&
      (lead.comuna || lead.city) &&
      (lead.products?.length || 0) > 0 &&
      (lead.timeline || lead.measures || lead.quantities || lead.projectType)
  );
}

// ====== Prompt maestro (ventas B2B/B2C + normativa de eficiencia energética) ======
function buildSystemPrompt({ session }) {
  return `
Eres un asesor comercial HUMANO (tono cercano, profesional, sin sonar robótico) de ${BUSINESS_NAME} en ${SALES_REGION}.
Tu objetivo: VENDER y AGENDAR (visita técnica / medición / cotización) ventanas, puertas, muros cortina, tabiques vidriados y todo tipo de termopanel.

Reglas:
- Haz preguntas de calificación cortas (máx 2 por mensaje) y avanza por etapas.
- Identifica tipo de cliente: RESIDENCIAL / CONSTRUCTOR / ARQUITECTO / INSTITUCIONAL / COMERCIAL.
- Ajusta el discurso: 
  * Residencial: confort térmico/acústico, ahorro, condensación, seguridad, estética, garantía.
  * Constructor/Inmobiliaria: plazos, cubicación, especificaciones, cumplimiento, fichas, coordinación de obra, facturación.
  * Arquitecto: prestaciones, detalles, soluciones, alternativas low-e/solar/acústico/laminado, compatibilidad de perfilería, normativa.
  * Institucional: licitaciones, trazabilidad, cumplimiento, documentación técnica, mantenimiento.
  * Comercial/Industrial: seguridad, control solar, resistencia, continuidad operativa.
- “Normativa nueva de eficiencia energética en Chile”: NO cites decretos exactos si no te los dan. Di “cumplimos exigencias vigentes de eficiencia energética / Reglamentación Térmica y criterios de desempeño (aislamiento, control de condensación, sellos y DVH)”.
- Nunca prometas “certificación oficial” si no se ha solicitado formalmente. Ofrece “documentación técnica, fichas y respaldo del sistema”.
- Si el cliente pide precio inmediato: entrega rangos orientativos SOLO si faltan datos y explica que la cotización final depende de medidas, apertura, vidrio y color.
- Siempre cierra con un CTA: “¿Te cotizo hoy?” / “¿Agendamos medición?”.
- Captura datos: nombre, comuna/ciudad, tipo de proyecto, productos, cantidad, medidas aproximadas, plazo.
- Si hay señales de urgencia, prioriza agendar medición.
- Evita textos largos. Máximo 8–10 líneas por mensaje.

Contexto de sesión (para que no repitas):
Tipo cliente actual: ${session.lead.customerType || "DESCONOCIDO"}
Productos mencionados: ${(session.lead.products || []).join(", ") || "N/A"}
Comuna/Ciudad: ${session.lead.comuna || session.lead.city || "N/A"}
Etapa: ${session.stage}
`;
}

// ====== Generación IA (con fallback) ======
async function generateSalesReply({ waId, userText }) {
  const session = getSession(waId);

  // Heurísticas rápidas antes de IA (para no depender 100% del modelo)
  const prod = detectProducts(userText);
  if (prod.length) session.lead.products = Array.from(new Set([...(session.lead.products || []), ...prod]));

  const inferredType = detectCustomerType(userText);
  if (inferredType && !session.lead.customerType) session.lead.customerType = inferredType;

  // Etapas mínimas
  if (session.stage === "START") session.stage = "QUALIFY_TYPE";

  // Respuesta IA
  if (!OPENAI_API_KEY) {
    // Fallback sin IA
    if (normalize(DEFAULT_REPLY_FALLBACK) !== "true") return null;

    const typeLine = session.lead.customerType ? `Perfecto. ¿Tu caso es más ${session.lead.customerType} o residencial?` : `Para ayudarte rápido: ¿eres cliente residencial, constructora/inmobiliaria, arquitecto o institución?`;
    const prodLine =
      (session.lead.products || []).length > 0
        ? `Entiendo que buscas: ${session.lead.products.join(", ")}.`
        : `¿Qué necesitas cotizar: ventanas/puertas/muro cortina/tabiques vidriados/termopanel?`;

    return `${prodLine}
${typeLine}
Y dime tu comuna/ciudad para coordinar medición o cotización.`;
  }

  const messages = [
    { role: "system", content: buildSystemPrompt({ session }) },
    {
      role: "assistant",
      content:
        "Si el usuario no ha entregado tipo de cliente, pregunta eso primero. Si ya lo entregó, pide (1) comuna/ciudad y (2) qué producto y cantidad. Mantén tono humano y vendedor.",
    },
    { role: "user", content: userText },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.4,
    max_tokens: 220,
    messages,
  });

  const reply = completion?.choices?.[0]?.message?.content?.trim();
  return reply || null;
}

// ====== Webhook Meta ======
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object !== "whatsapp_business_account") {
      return res.sendStatus(200);
    }

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const messages = value?.messages;
    if (!messages || !messages.length) {
      return res.sendStatus(200);
    }

    const msg = messages[0];
    const msgId = msg.id;
    const from = msg.from; // wa_id (tel)
    const text = msg?.text?.body || "";

    // Dedupe (Meta puede reenviar)
    if (processedMsgIds.has(msgId)) return res.sendStatus(200);
    processedMsgIds.add(msgId);
    if (processedMsgIds.size > 2000) {
      // limpieza simple
      const arr = Array.from(processedMsgIds);
      arr.slice(0, 800).forEach((id) => processedMsgIds.delete(id));
    }

    const session = getSession(from);

    // Intento de capturar datos (mínimo) si el usuario los entrega explícitos
    // (Puedes ampliar con parsing avanzado o IA estructurada)
    const t = normalize(text);
    if (!session.lead.customerType) {
      const ct = detectCustomerType(text);
      if (ct) session.lead.customerType = ct;
      if (/residencial|casa|departamento|hogar/i.test(t)) session.lead.customerType = "RESIDENCIAL";
    }
    if (!session.lead.name) {
      const m = text.match(/me llamo\s+([a-záéíóúñ\s]{2,40})/i);
      if (m?.[1]) session.lead.name = m[1].trim();
    }
    if (!session.lead.email) {
      const em = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      if (em?.[0]) session.lead.email = em[0].toLowerCase();
    }
    if (!session.lead.timeline) {
      if (/hoy|urgente|ya/i.test(t)) session.lead.timeline = "URGENTE";
      else if (/semana|7 d/i.test(t)) session.lead.timeline = "1-2 SEM";
      else if (/mes|30 d/i.test(t)) session.lead.timeline = "1 MES";
    }

    // Generar respuesta
    const reply = await generateSalesReply({ waId: from, userText: text });

    // Si no salió respuesta, fallback muy básico
    const safeReply =
      reply ||
      `Gracias por escribir a ${BUSINESS_NAME}. Para cotizar rápido:
1) ¿Eres cliente residencial, constructora/inmobiliaria, arquitecto o institución?
2) ¿Qué necesitas: ventanas/puertas/muro cortina/tabiques vidriados/termopanel?
3) ¿En qué comuna/ciudad es el proyecto?`;

    // Enviar WhatsApp
    await sendWhatsAppText(from, safeReply);

    // Si ya hay lead mínimo, enviar al CRM (opcional)
    if (shouldCloseLead(session.lead)) {
      await sendToCRM(from, session.lead);
      // También puedes cambiar etapa para cerrar
      session.stage = "READY_TO_QUOTE";
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err?.response?.data || err.message);
    return res.sendStatus(200);
  }
});

// Healthcheck
app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "whatsapp-sales-bot",
    business: BUSINESS_NAME,
    region: SALES_REGION,
    ts: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
