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
   HEALTH CHECK (OBLIGATORIO PARA RAILWAY)
========================= */
app.get("/", (req, res) => {
  res.status(200).send("OK - WhatsApp IA Activa");
});

/* =========================
   WEBHOOK VERIFICATION
========================= */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    console.log("✅ Webhook verificado correctamente");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

/* =========================
   RECEIVE WHATSAPP MESSAGES
========================= */
app.post("/webhook", async (req, res) => {
  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message || message.type !== "text") {
      return res.sendStatus(200);
    }

    const from = message.from;
    const userText = message.text.body;

    console.log("📩 Mensaje recibido:", userText);

    const aiReply = await askGPT(userText);

    await sendWhatsAppMessage(from, aiReply);

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error webhook:", err);
    res.sendStatus(500);
  }
});

/* =========================
   GPT FUNCTION
========================= */
async function askGPT(text) {
  const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Eres un asistente comercial de Activa Inversiones. Responde de forma clara, profesional y orientada a cotizar proyectos."
          },
          { role: "user", content: text }
        ],
        temperature: 0.4
      })
    }
  );

  const data = await response.json();
  return data.choices[0].message.content;
}

/* =========================
   SEND WHATSAPP MESSAGE
========================= */
async function sendWhatsAppMessage(to, body) {
  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body }
    })
  });

  console.log("✅ Respuesta enviada a:", to);
}

/* =========================
   START SERVER (RAILWAY)
========================= */
const PORT = process.env.PORT;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor activo con IA en puerto ${PORT}`);
});

