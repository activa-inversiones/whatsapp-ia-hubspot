import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();
const app = express();
app.use(express.json());

// 1. SEGURO DE VIDA PARA RAILWAY (Ruta raíz)
app.get("/", (req, res) => {
  console.log("⚓ Health Check recibido de Railway");
  res.status(200).send("SERVIDOR OPERATIVO ✅");
});

// 2. CONFIGURACIÓN DE IA
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY 
});

const { PHONE_NUMBER_ID, WHATSAPP_TOKEN, WEBHOOK_VERIFY_TOKEN } = process.env;

// 3. VERIFICACIÓN DE WEBHOOK (Meta)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// 4. RECEPCIÓN DE MENSAJES
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Responder a Meta de inmediato

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (message?.text?.body) {
      const from = message.from;
      const text = message.text.body;
      console.log(`📩 Mensaje de ${from}: ${text}`);

      // IA - GPT-3.5 para máxima velocidad
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "Eres el asistente de Activa Inversiones. Responde de forma breve." },
          { role: "user", content: text }
        ],
      });

      const responseText = completion.choices[0].message.content;

      // Enviar a WhatsApp
      await fetch(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: from,
          text: { body: responseText }
        })
      });
      console.log(`🚀 Respuesta enviada a ${from}`);
    }
  } catch (error) {
    console.error("⚠️ Error en proceso:", error.message);
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ SERVIDOR ACTIVA INVERSIONES INICIADO EN PUERTO ${PORT}`);
});