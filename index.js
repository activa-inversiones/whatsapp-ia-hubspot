import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const {
  PHONE_NUMBER_ID,
  WHATSAPP_TOKEN,
  WEBHOOK_VERIFY_TOKEN
} = process.env;

// 1. RUTA DE SALUD (Obligatoria para Railway)
app.get("/", (req, res) => {
  res.status(200).send("Servidor Activo");
});

// 2. VERIFICACIÓN DEL WEBHOOK
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// 3. RECEPCIÓN DE MENSAJES
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const from = message.from;
    console.log(`📩 Mensaje recibido de ${from}`);

    await sendWelcomeTemplate(from);
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Error en Webhook:", error);
    res.sendStatus(500);
  }
});

// 4. FUNCIÓN PARA ENVIAR PLANTILLA
async function sendWelcomeTemplate(to) {
  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
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
    console.log("✅ Resultado envío:", data);
  } catch (error) {
    console.error("❌ Error enviando plantilla:", error);
  }
}

// 5. INICIO DEL SERVIDOR (Configuración para Railway)
// Deja que process.env.PORT use lo que Railway asigne automáticamente
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor funcionando en puerto ${PORT}`);
});