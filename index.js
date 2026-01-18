import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();
const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { PHONE_NUMBER_ID, WHATSAPP_TOKEN, WEBHOOK_VERIFY_TOKEN } = process.env;

// RUTA CRÍTICA: Evita que Railway apague el contenedor
app.get("/", (req, res) => {
  res.status(200).send("SERVIDOR ACTIVA INVERSIONES ONLINE ✅");
});

// Verificación de Webhook para Meta
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    console.log("✅ Webhook Verificado por Meta");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Procesamiento de Mensajes con IA
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Respuesta inmediata a Meta para evitar reintentos
  
  const body = req.body;
  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (message?.text?.body) {
    const from = message.from;
    const userText = message.text.body;
    console.log(`📩 Mensaje de ${from}: ${userText}`);

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "system", content: "Eres el asistente de Activa Inversiones. Sé breve." }, { role: "user", content: userText }],
      });

      const aiResponse = completion.choices[0].message.content;

      await fetch(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: from, text: { body: aiResponse } })
      });
      console.log(`🚀 IA respondió a ${from}`);
    } catch (error) {
      console.error("❌ Error de IA o Meta:", error.message);
    }
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ SERVIDOR ACTIVA INVERSIONES INICIADO EN PUERTO ${PORT}`);
});