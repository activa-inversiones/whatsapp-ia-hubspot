import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();
const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { PHONE_NUMBER_ID, WHATSAPP_TOKEN, WEBHOOK_VERIFY_TOKEN } = process.env;

// --- RUTA DE SALUD ---
app.get("/", (req, res) => {
  res.status(200).json({ status: "online", service: "Activa Inversiones IA" });
});

// --- VERIFICACIÓN DE META ---
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// --- PROCESAMIENTO DE MENSAJES ---
app.post("/webhook", async (req, res) => {
  // 1. Log detallado para ver la llegada del mensaje en Railway
  console.log("📩 NUEVA DATA RECIBIDA:", JSON.stringify(req.body, null, 2));
  
  res.sendStatus(200); // Respuesta rápida a Meta

  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    
    if (message?.text?.body) {
      const from = message.from;
      const userText = message.text.body;

      console.log(`🤖 PROCESANDO: "${userText}" de ${from}`);

      // 2. Consultar a la IA (OpenAI)
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: "Eres el asistente experto de Activa Inversiones. Responde de forma breve y profesional." },
          { role: "user", content: userText }
        ],
      });

      const aiResponse = completion.choices[0].message.content;

      // 3. Enviar respuesta por WhatsApp
      await sendWhatsApp(from, aiResponse);
    }
  } catch (error) {
    console.error("❌ ERROR EN PROCESAMIENTO:", error.message);
  }
});

async function sendWhatsApp(to, text) {
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
        to: to,
        type: "text",
        text: { body: text }
      })
    });
    
    const result = await response.json();
    if (response.ok) {
      console.log(`🚀 RESPUESTA ENVIADA A ${to}`);
    } else {
      console.error("⚠️ ERROR META API:", result.error?.message);
    }
  } catch (e) {
    console.error("❌ ERROR DE RED:", e.message);
  }
}

// --- INICIO ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ SERVIDOR ACTIVA INVERSIONES INICIADO EN PUERTO ${PORT}`);
});