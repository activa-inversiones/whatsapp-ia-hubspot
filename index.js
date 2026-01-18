import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

// Configuración de variables de entorno
dotenv.config();

const app = express();
app.use(express.json());

// Extraer variables de entorno
const { PHONE_NUMBER_ID, WHATSAPP_TOKEN, WEBHOOK_VERIFY_TOKEN } = process.env;

// 1. Salud del servidor (Crucial para que Railway mantenga el servicio activo)
app.get("/", (req, res) => { 
  res.status(200).send("✅ Servidor Activa Inversiones Online"); 
});

// 2. Verificación del Webhook de Meta (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    console.log("✅ Webhook verificado correctamente");
    return res.status(200).send(challenge);
  }
  
  console.error("❌ Falló la verificación del token");
  return res.sendStatus(403);
});

// 3. Recepción de mensajes del Webhook (POST)
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    console.log(`📩 Mensaje recibido de: ${from}`);

    // Enviar plantilla de bienvenida
    await sendWelcomeTemplate(from);

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error en el Webhook:", err.message);
    return res.sendStatus(500);
  }
});

// 4. Función para enviar la plantilla de WhatsApp
async function sendWelcomeTemplate(to) {
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
      console.error(`❌ Error de Meta API: ${data.error?.message}`);
    }
  } catch (error) {
    console.error("❌ Error de red al contactar a Meta:", error.message);
  }
}

// 5. Configuración del Puerto para Railway
// Usamos process.env.PORT y escuchamos en '0.0.0.0'
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor experto activo en puerto ${PORT}`);
});