import fetch from "node-fetch";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

/* =========================
   WEBHOOK VERIFICATION (META)
========================= */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
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
    const text = message.text.body;

    await sendWhatsAppMessage(
      from,
      "Hola 👋 Gracias por escribir a *Activa Inversiones*.\n\n¿Me comentas brevemente qué tipo de proyecto tienes?"
    );

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

/* =========================
   SEND WHATSAPP MESSAGE
========================= */
async function sendWhatsAppMessage(to, body) {
  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });
}

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
