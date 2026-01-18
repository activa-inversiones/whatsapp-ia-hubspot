import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const {
  PHONE_NUMBER_ID,
  WHATSAPP_TOKEN,
  WEBHOOK_VERIFY_TOKEN
} = process.env;

/* =========================
   1. HEALTH CHECK
   ========================= */
app.get("/", (req, res) => {
  res.status(200).send("✅ Servidor Experto Activo");
});

/* =========================
   2. VERIFICACIÓN DEL WEBHOOK
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
   3. RECEPCIÓN DE MENSAJES
   ========================= */
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const from = message.from;
    console.log(`Mensaje de: ${from}`);

    await sendWelcomeTemplate(from);

    return res.sendStatus(200);
  } catch (err) {
    console.error("Error en webhook:", err.message);
    return res.sendStatus(500);
  }
});

/* =========================
   4. ENVÍO DE PLANTILLA
   ========================= */
async function sendWelcomeTemplate(to) {
  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to,
      type: "template",
      template: {
        name: "bienvenida_activa_inversiones",
        language: { code: "es_CL" }
      }
    })
  });

  const data = await response.json();
  if (response.ok) {
    console.log(`✅ Éxito enviando a ${to}`);
  } else {
    console.error(`❌ Error Meta: ${data.error?.message}`);
  }
}

/* =========================
   5. INICIO DEL SERVIDOR
   ========================= */
const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
  console.log(`Conectado al ID: ${PHONE_NUMBER_ID}`);
});

// --- FIN DEL ARCHIVO ---
