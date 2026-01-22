import express from "express";
import axios from "axios";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Ruta de prueba
app.get("/", (req, res) => {
  res.status(200).send("🟢 BOT ACTIVA INVERSIONES CON IA - ONLINE");
});

// Verificación del Webhook (Meta)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("✅ Webhook verificado correctamente");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Recepción de mensajes
app.post("/webhook", async (req, res) => {
  // Responder 200 de inmediato para evitar reintentos/duplicados
  res.sendStatus(200);

  const body = req.body;

  try {
    // Validación de evento WhatsApp
    if (!body?.object || !body?.entry?.[0]?.changes?.[0]?.value) return;

    const changes = body.entry[0].changes[0].value;

    // Debe venir el mensaje
    const message = changes?.messages?.[0];
    if (!message) return;

    const from = message.from; // número del cliente (quien escribe)
    const phoneNumberIdFromWebhook = changes?.metadata?.phone_number_id; // número (API) que recibió
    if (!phoneNumberIdFromWebhook) {
      console.log("⚠️ No viene metadata.phone_number_id en el webhook");
      return;
    }

    // Solo texto por ahora
    if (message.type !== "text") {
      console.log(`ℹ️ Mensaje no-texto recibido de ${from}: type=${message.type}`);
      return;
    }

    const userMessage = message.text?.body || "";
    console.log(`📩 Mensaje recibido de ${from} (a ${phoneNumberIdFromWebhook}): ${userMessage}`);

    // 1) Respuesta con IA
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Eres un asistente virtual profesional y amable de 'Activa Inversiones EIRL'. Tu objetivo es ayudar a los clientes con dudas sobre inversiones, cotizaciones y servicios financieros. Responde de manera concisa y clara. Si no sabes algo, sugiere contactar a un humano.",
        },
        { role: "user", content: userMessage },
      ],
    });

    const aiResponse = completion?.choices?.[0]?.message?.content?.trim() || "¿Me puedes dar un poco más de detalle?";
    console.log(`🤖 Respuesta de GPT: ${aiResponse}`);

    // 2) Envío a WhatsApp (IMPORTANTE: responder usando el mismo phone_number_id que recibió)
    await axios({
      method: "POST",
      url: `https://graph.facebook.com/v22.0/${phoneNumberIdFromWebhook}/messages`,
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      data: {
        messaging_product: "whatsapp",
        to: from,
        type: "text",
        text: { body: aiResponse },
      },
    });

    console.log("✅ Respuesta enviada exitosamente");
  } catch (error) {
    console.error(
      "❌ Error procesando mensaje:",
      error?.response?.data ? JSON.stringify(error.response.data) : error?.message
    );
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 SERVIDOR LISTO EN PUERTO: ${PORT}`);
});
