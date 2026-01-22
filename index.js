// index.js
import express from "express";
import axios from "axios";
import OpenAI from "openai";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 8080;

// OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Salud
app.get("/", (req, res) => {
  res.status(200).send("🟢 BOT ACTIVA INVERSIONES CON IA - ONLINE");
});

// Verificación webhook (Meta)
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

// Enviar WhatsApp
async function sendWhatsAppText({ phoneNumberId, to, text }) {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error("Falta WHATSAPP_TOKEN en variables de entorno");

  await axios({
    method: "POST",
    url: `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    data: {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    },
    timeout: 20000,
  });
}

// Webhook entrante (POST)
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    // LOG SIEMPRE (para confirmar que Meta pega el POST)
    console.log("🔔 WEBHOOK POST RAW:", JSON.stringify(body).slice(0, 2000));

    const change = body?.entry?.[0]?.changes?.[0]?.value;

    // Meta envía también "statuses"; los logueamos
    if (change?.statuses?.length) {
      console.log("📦 STATUSES:", JSON.stringify(change.statuses).slice(0, 2000));
      return res.sendStatus(200);
    }

    const messages = change?.messages;

    // Si no hay mensajes, responder 200
    if (!messages || !messages.length) {
      console.log("ℹ️ POST sin messages (ni statuses).");
      return res.sendStatus(200);
    }

    const message = messages[0];
    const from = message.from; // número cliente
    const phoneNumberId = change?.metadata?.phone_number_id; // CLAVE para 2 números

    console.log(
      `📥 IN: phone_number_id=${phoneNumberId} from=${from} type=${message.type}`
    );

    if (!phoneNumberId) {
      console.log("❌ No viene metadata.phone_number_id. Revisa suscripción 'messages'.");
      return res.sendStatus(200);
    }

    // Si no es texto, responder igual
    if (message.type !== "text") {
      await sendWhatsAppText({
        phoneNumberId,
        to: from,
        text: "Gracias por tu mensaje. Por ahora puedo responder texto. ¿En qué te ayudo?",
      });
      return res.sendStatus(200);
    }

    const userMessage = message.text?.body || "";
    console.log(`📝 TEXTO: ${userMessage}`);

    let aiResponse = "Gracias por tu mensaje. Un ejecutivo te contactará en breve.";

    // IA
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Eres un asistente virtual profesional y amable de 'Activa Inversiones EIRL'. Responde breve, claro y orientado a cotizar/ayudar. Si falta un dato, pide ese dato. Si es tema sensible o no sabes, deriva a humano.",
          },
          { role: "user", content: userMessage },
        ],
      });

      aiResponse = completion.choices?.[0]?.message?.content?.trim() || aiResponse;
    } catch (e) {
      console.log("⚠️ OpenAI falló:", e?.message);
    }

    // OUT
    await sendWhatsAppText({
      phoneNumberId,
      to: from,
      text: aiResponse,
    });

    console.log(`📤 OUT a ${from}: ${aiResponse}`);
    return res.sendStatus(200);
  } catch (error) {
    console.error("❌ Error webhook:", error?.response?.data || error.message);
    return res.sendStatus(200);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 SERVIDOR LISTO EN PUERTO: ${PORT}`);
});
