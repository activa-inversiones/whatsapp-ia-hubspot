import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// Railway asigna el puerto dinámicamente, pero usaremos el 8080 como base
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => res.status(200).send("BOT ACTIVA ONLINE 🟢"));

// VERIFICACIÓN DEL WEBHOOK
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mi_token_webhook_2026";

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado por Meta");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// RECEPCIÓN Y RESPUESTA
app.post("/webhook", async (req, res) => {
  const body = req.body;
  console.log("📩 Evento recibido:", JSON.stringify(body));

  if (body.object && body.entry?.[0].changes?.[0].value.messages) {
    const message = body.entry[0].changes[0].value.messages[0];
    const from = message.from;
    const phone_id = process.env.PHONE_NUMBER_ID;

    try {
      await axios({
        method: "POST",
        url: `https://graph.facebook.com/v22.0/${phone_id}/messages`,
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        data: {
          messaging_product: "whatsapp",
          to: from,
          type: "text",
          text: { body: "¡Hola! 🤖 El Bot de Activa Inversiones está funcionando. 🚀" }
        },
      });
      console.log("🚀 Respuesta enviada correctamente");
    } catch (error) {
      console.error("❌ Error API Meta:", error.response ? JSON.stringify(error.response.data) : error.message);
    }
  }
  res.sendStatus(200); // Confirmación obligatoria a Meta
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 SERVIDOR ESCUCHANDO EN: 0.0.0.0:${PORT}`);
});