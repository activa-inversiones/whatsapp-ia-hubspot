// index.js (Railway - WhatsApp Cloud API Webhook + envío de plantilla)
// Requisitos en Railway Variables:
// PHONE_NUMBER_ID, WHATSAPP_TOKEN, WEBHOOK_VERIFY_TOKEN

import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const { PHONE_NUMBER_ID, WHATSAPP_TOKEN, WEBHOOK_VERIFY_TOKEN } = process.env;

if (!PHONE_NUMBER_ID || !WHATSAPP_TOKEN || !WEBHOOK_VERIFY_TOKEN) {
  console.error(
    "Faltan variables de entorno. Revisa Railway → Variables: PHONE_NUMBER_ID, WHATSAPP_TOKEN, WEBHOOK_VERIFY_TOKEN"
  );
}

/* =========================
   HEALTHCHECK
========================= */
app.get("/", (req, res) => {
  res.status(200).send("OK");
});

/* =========================
   WEBHOOK VERIFY (Meta)
========================= */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/* =========================
   WEBHOOK RECEIVE
========================= */
app.post("/webhook", async (req, res) => {
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;

    // Ignorar eventos sin mensajes (statuses, etc.)
    const message = value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const from = message.from; // ej: "569XXXXXXXX"
    const text = message?.text?.body ?? "";

    console.log(`📩 Recibido de ${from}: ${text}`);

    // Respuesta segura: plantilla (válida para primer contacto / fuera de 24h)
    await sendWelcomeTemplate(from);

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error en /webhook:", err?.message || err);
    return res.sendStatus(200);
  }
});

/* =========================
   SEND TEMPLATE
========================= */
async function sendWelcomeTemplate(to) {
  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: "bienvenida_activa_inversiones",
      language: { code: "es_CL" }
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  console.log("📨 Meta status:", response.status);
  console.log("📨 Meta body:", data);

  if (!response.ok) {
    throw new Error(`Meta API error ${response.status}`);
  }

  console.log("✅ Plantilla enviada");
}

/* =========================
   START (Railway)
========================= */
const PORT = Number(process.env.PORT);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor escuchando en PORT=${PORT}`);
});
