import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

/* HEALTH */
app.get("/", (req, res) => res.send("OK"));

/* VERIFY */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/* RECEIVE MESSAGE */
app.post("/webhook", async (req, res) => {
  const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg || msg.type !== "text") return res.sendStatus(200);

  const from = msg.from;

  await fetch(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: from,
      type: "text",
      text: { body: "Hola 👋 Gracias por escribir a Activa Inversiones." }
    })
  });

  res.sendStatus(200);
});

/* START */
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0");
