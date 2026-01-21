import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// Forzamos el puerto 8080 o el que diga Railway
const PORT = process.env.PORT || 8080;

// Ruta de inicio para ver el estado
app.get("/", (req, res) => {
  res.status(200).send("🟢 BOT ACTIVA INVERSIONES ONLINE");
});

// VERIFICACIÓN DEL WEBHOOK
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  
  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("✅ Webhook verificado correctamente");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// RECEPCIÓN DE MENSAJES
app.post("/webhook", async (req, res) => {
  const body = req.body;
  console.log("📩 Evento recibido:", JSON.stringify(body));

  if (body.object && body.entry?.[0].changes?.[0].value.messages) {
    const message = body.entry[0].changes[0].value.messages[0];
    const from = message.from;

    try {
      await axios({
        method: "POST",
        url: `https://graph.facebook.com/v22.0/${process.env.PHONE_NUMBER_ID}/messages`,
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        data: {
          messaging_product: "whatsapp",
          to: from,
          type: "text",
          text: { body: "¡Hola! 🤖 Bot Activa Inversiones funcionando correctamente. 🚀" }
        },
      });
      console.log("🚀 Respuesta enviada exitosamente");
    } catch (error) {
      console.error("❌ Error API:", error.response ? JSON.stringify(error.response.data) : error.message);
    }
  }
  
  // Respondemos 200 OK siempre al final
  res.sendStatus(200); 
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 SERVIDOR ESCUCHANDO EN: 0.0.0.0:${PORT}`);
});