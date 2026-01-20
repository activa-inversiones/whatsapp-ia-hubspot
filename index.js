import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// Obligatorio para Railway: Usar el puerto que ellos asignan o el 8080 de tus logs
const PORT = process.env.PORT || 8080;

// ✅ HEALTHCHECK: Vital para que Railway no apague el contenedor
app.get("/", (req, res) => res.status(200).send("BOT ACTIVA ONLINE 🟢"));
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

// ✅ VERIFICACIÓN DEL WEBHOOK (Sincronizado con tus Variables)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  
  // Usamos el token exacto de tu panel de variables
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mi_token_webhook_2026";

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado exitosamente.");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ✅ RECEPCIÓN DE MENSAJES
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.object && body.entry?.[0].changes?.[0].value.messages) {
      const message = body.entry[0].changes[0].value.messages[0];
      const from = message.from;
      const business_id = body.entry[0].changes[0].value.metadata.phone_number_id;

      await axios({
        method: "POST",
        url: `https://graph.facebook.com/v21.0/${business_id}/messages`,
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        data: {
          messaging_product: "whatsapp",
          to: from,
          type: "text",
          text: { body: "¡Hola! 🤖 El Bot de Activa Inversiones está configurado y estable. 🚀" }
        },
      });
    }
  } catch (error) {
    console.error("❌ Error enviando respuesta:", error.message);
  }
});

// ✅ ESCUCHAR EN 0.0.0.0 ES REQUISITO DE RAILWAY
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 SERVIDOR ESCUCHANDO EN: 0.0.0.0:${PORT}`);
});