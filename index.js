// index.js (Railway + WhatsApp Cloud API)
// Variables en Railway:
// PHONE_NUMBER_ID, WHATSAPP_TOKEN, WEBHOOK_VERIFY_TOKEN

import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const { PHONE_NUMBER_ID, WHATSAPP_TOKEN, WEBHOOK_VERIFY_TOKEN } = process.env;

/* =========================
   HEALTHCHECKS (Railway)
========================= */
app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/healthz", (req, res) => res.status(200).send("OK"));

/* =========================
   WEBHOOK VERIFY (Meta)
========================= */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    console.log("✅ Webhook verificado");
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
    const message = value?.messages?.[0];

    // Ignora eventos sin mensajes (statuses, delivery, etc.)
    if (!message) return res.sendStatus(200);

    const from = message.from; // "569XXXXXXXX"
    const text = message?.text?.body ?? "";

    console.log(`📩 Recibido de ${from}: ${text}`);

    // Enviar plantilla (primer contacto / fuera de 24h)
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
  if (!PHONE_NUMBER_ID || !WHATSAPP_TOKEN) {
    console.error("Faltan PHONE_NUMBER_ID o WHATSAPP_TOKEN en Railway Variables");
    return;
  }

  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: "bienvenida_activa_inversiones",
        language: { code: "es_CL" },
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  console.log("📨 Meta status:", response.status);
  console.log("📨 Meta body:", data);

  if (!response.ok) throw new Error(`Meta API error ${response.status}`);
}

/* =========================
   START (Railway)
========================= */
const PORT = parseInt(process.env.PORT || "3000", 10);

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor escuchando en PORT=${PORT}`);
});

// Cierre ordenado cuando Railway redeploya
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM recibido. Cerrando servidor...");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
});
