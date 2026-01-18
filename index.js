import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();
const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { PHONE_NUMBER_ID, WHATSAPP_TOKEN, WEBHOOK_VERIFY_TOKEN } = process.env;

app.get("/", (req, res) => res.send("Servidor Activa ✅"));

// Verificación para Meta
app.get("/webhook", (req, res) => {
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (token === WEBHOOK_VERIFY_TOKEN) return res.send(challenge);
  res.sendStatus(403);
});

// Recepción de mensajes
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Respuesta inmediata a Meta
  
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (msg?.text?.body) {
    const from = msg.from;
    console.log(`📩 Mensaje de ${from}: ${msg.text.body}`);

    try {
      // 1. Respuesta con IA
      const ai = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: msg.text.body }],
      });

      // 2. Enviar por WhatsApp
      await fetch(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: from,
          text: { body: ai.choices[0].message.content }
        })
      });
      console.log(`🚀 IA respondió a ${from}`);
    } catch (e) {
      console.error("❌ Error:", e.message);
    }
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ SERVIDOR ACTIVA INVERSIONES INICIADO EN PUERTO ${PORT}`);
});