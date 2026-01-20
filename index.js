import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => res.status(200).send("BOT ACTIVA ONLINE 🟢"));
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

// VERIFICACIÓN DEL WEBHOOK
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mi_token_webhook_2026";

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado por Meta.");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// RECEPCIÓN DE MENSAJES
app.post("/webhook", async (req, res) => {
  const body = req.body;

  // LOG PARA VER QUÉ LLEGA (Esto aparecerá en tu pantalla negra de Railway)
  console.log("📩 Evento recibido:", JSON.stringify(body, null, 2));

  if (body.object && body.entry?.[0].changes?.[0].value.messages) {
    const message = body.entry[0].changes[0].value.messages[0];
    const from = message.from; 
    
    // Usamos el ID de tus variables o el de la metadata que llega
    const phone_id = process.env.PHONE_NUMBER_ID || body.entry[0].changes[0].value.metadata.phone_number_id;

    try {
      console.log(`📤 Intentando responder al número: ${from} desde el ID: ${phone_id}`);
      
      const response = await axios({
        method: "POST",
        // Actualizado a v22.0 como muestra tu captura de Meta
        url: `https://graph.facebook.com/v22.0/${phone_id}/messages`,
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        data: {
          messaging_product: "whatsapp",
          to: from,
          type: "text",
          text: { body: "¡Hola! 🤖 Bot Activa Inversiones funcionando. 🚀" }
        },
      });

      console.log("🚀 Respuesta enviada correctamente:", response.data);
    } catch (error) {
      // LOG DETALLADO DEL ERROR 400
      console.error("❌ Error en Meta API:", error.response ? JSON.stringify(error.response.data) : error.message);
    }
  }
  
  res.sendStatus(200);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 SERVIDOR ESCUCHANDO EN: 0.0.0.0:${PORT}`);
});