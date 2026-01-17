import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const {
  PHONE_NUMBER_ID,
  WHATSAPP_TOKEN,
  WEBHOOK_VERIFY_TOKEN
} = process.env;

/* =====================================================
   HEALTH CHECK
===================================================== */
app.get("/", (req, res) => {
  res.status(200).send("OK - WhatsApp API Activa");
});

/* =====================================================
   VERIFICACIÓN WEBHOOK (META)
===================================================== */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("🔎 Verificación webhook solicitada");

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    console.log("✅ Webhook verificado correctamente");
    return res.status(200).send(challenge);
  }

  console.log("❌ Falló verificación webhook");
  return res.sendStatus(403);
});

/* =====================================================
   RECEPCIÓN DE MENSAJES WHATSAPP
===================================================== */
app.post("/webhook", async (req, res) => {
  try {
    console.log("🔔 Webhook POST recibido");

    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      console.log("ℹ️ Evento sin mensaje (status/delivery)");
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body || "";

    console.log(`📩 Mensaje recibido de ${from}: ${text}`);
    console.log("➡️ Intentando enviar plantilla...");

    await sendWelcomeTemplate(from);

    console.log("✅ Plantilla enviada correctamente");
    res.sendStatus(200);

  } catch (error) {
    console.error("❌ ERROR EN WEBHOOK:", error.message);
    res.sendStatus(500);
  }
});

/* =====================================================
   ENVÍO DE PLANTILLA (PRIMER CONTACTO)
===================================================== */
async function sendWelcomeTemplate(to) {
  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

  console.log("📤 Enviando plantilla a:", to);
  console.log("📤 Phone Number ID:", PHONE_NUMBER_ID);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: "bienvenida_activa_inversiones",
        language: { code: "es_CL" }
      }
    })
  });

  const data = await response.json();

  console.log("📨 RESPUESTA META STATUS:", response.status);
  console.log("📨 RESPUESTA META BODY:", data);

  if (!response.ok) {
    throw new Error(`Meta API error ${response.status}`);
  }
}

/* =====================================================
   INICIO DEL SERVIDOR (RAILWAY)
===================================================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor activo en puerto ${PORT}`);
});
