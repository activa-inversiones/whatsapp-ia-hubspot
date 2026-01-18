import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// Extraemos las variables de entorno
const {
  PHONE_NUMBER_ID,
  WHATSAPP_TOKEN,
  WEBHOOK_VERIFY_TOKEN
} = process.env;

/* =========================
   1. HEALTH CHECK (VITAL PARA RAILWAY)
   ========================= */
// Esto responde a Railway para confirmar que el bot está vivo
app.get("/", (req, res) => {
  res.status(200).send("✅ Bot de Activa Inversiones Operativo");
});

/* =========================
   2. VERIFICACIÓN DEL WEBHOOK
   ========================= */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    console.log("Webhook verificado correctamente.");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

/* =========================
   3. RECEPCIÓN DE MENSAJES (WEBHOOK)
   ========================= */
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    // Ignorar si no es un mensaje de texto (evita errores)
    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from; // Número del cliente
    console.log(`Mensaje recibido de: ${from}`);

    // Enviamos la plantilla de bienvenida
    await sendWelcomeTemplate(from);

    return res.sendStatus(200);
  } catch (err) {
    console.error("Error procesando webhook:", err.message);
    return res.sendStatus(500);
  }
});

/* =========================
   4. ENVÍO DE PLANTILLA (META API)
   ========================= */
async function sendWelcomeTemplate(to) {
  // Usamos la API v22.0 como configuramos en Meta
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
    console.log(`✅ Plantilla enviada con éxito a ${to}`);
  } else {
    console.error(`❌ Error de Meta API:`, data.error?.message);
  }
}

/* =========================
   5. INICIO DEL SERVIDOR (EL CAMBIO CLAVE)
   ========================= */
// Definimos el puerto con un respaldo (fallback) al 8080
const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {

