import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// Railway usa el puerto 8080 según tus logs exitosos
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => res.status(200).send("BOT ACTIVA ONLINE 🟢"));

// VERIFICACIÓN DEL WEBHOOK
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  
  // Nombre exacto en tu panel de Railway
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN; 

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado correctamente");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// RECEPCIÓN DE MENSAJES
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); 
  const body = req.body;

  if (body.object && body.entry?.[0].changes?.[0].value.messages) {
    const message = body.entry[0].changes[0].value.messages[0];
    const from = message.from;
    
    // Sincronizado con tus variables de Railway
    const phone_id = process.env.PHONE_NUMBER_ID;
    const waba_token = process.env.WHATSAPP_TOKEN;

    try {
      await axios({
        method: "POST",
        // Usamos v22.0 que es la de tu panel de Meta
        url: `https://graph.facebook.com/v22.0/${phone_id}/messages`,
        headers: {
          Authorization: `Bearer ${waba_token}`,
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
      // Si falla, el log mostrará el motivo detallado de Meta
      console.error("❌ Error API Meta:", error.response ? JSON.stringify(error.response.data) : error.message);
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 SERVIDOR ESCUCHANDO EN: 0.0.0.0:${PORT}`);
});