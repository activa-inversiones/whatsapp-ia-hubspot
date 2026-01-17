import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const {
  OPENAI_API_KEY,
  PHONE_NUMBER_ID,
  WHATSAPP_TOKEN,
  WEBHOOK_VERIFY_TOKEN
} = process.env;

/* =========================
   HEALTH CHECK (OBLIGATORIO)
========================= */
app.get("/", (req, res) => {
  res.status(200).send("OK - Servidor Funcionando");
});

/* =========================
   WEBHOOK VERIFICATION
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
   RECEIVE WHATSAPP MESSAGES
========================= */
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message || message.type !== "text") {
      return res.sendStatus(200);
    }

    const from = message.from;
    const userText = message.text.body;

    console.log(`📩 Mensaje de ${from}: ${userText}`);

    const aiReply = await askGPT(userText);
    await sendWhatsAppMessage(from, aiReply);

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error en webhook:", err.message);
    res.sendStatus(500);
  }
});

/* =========================
   GPT FUNCTION
========================= */
async function askGPT(text) {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Eres un asistente comercial de Activa Inversiones. Responde de forma clara y profesional."
          },
          { role: "user", content: text }
        ],
        temperature: 0.4
      })
    });

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error("❌ Error GPT:", error);
    return "Lo siento, tuve un problema al procesar tu solicitud.";
  }
}

/* =========================
   SEND WHATSAPP MESSAGE
========================= */
async function sendWhatsAppMessage(to, body) {
  try {
    const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
    await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body }
      })
    });
    console.log("✅ Respuesta enviada");
  } catch (error) {
    console.error("❌ Error enviando WhatsApp:", error);
  }
}

/* =========================
   START SERVER
========================= */
// IMPORTANTE: No fuerces el puerto 8080 en las variables de Railway.
// Deja que Railway asigne el puerto solo.
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
