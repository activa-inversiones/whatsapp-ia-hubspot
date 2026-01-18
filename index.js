import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

const { PHONE_NUMBER_ID, WHATSAPP_TOKEN, WEBHOOK_VERIFY_TOKEN } = process.env;

// --- MONITOREO DE SALUD ---
app.get("/", (req, res) => {
  res.status(200).json({ status: "online", service: "Activa Inversiones API", uptime: process.uptime() });
});

// --- VERIFICACIÓN DE WEBHOOK (META) ---
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    console.log("✅ WEBHOOK_VERIFIED");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- PROCESAMIENTO DE MENSAJES ---
app.post("/webhook", async (req, res) => {
  // Respondemos inmediatamente a Meta con 200 OK para evitar reintentos innecesarios
  res.sendStatus(200);

  try {
    const data = req.body;
    const message = data.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return;

    const from = message.from; // Número del cliente
    const msgType = message.type;

    console.log(`📩 Nuevo mensaje de [${from}] tipo [${msgType}]`);

    // Lógica: Solo respondemos a mensajes de texto o interacciones iniciales
    if (msgType === "text" || msgType === "button") {
      await sendWelcomeTemplate(from);
    }

  } catch (err) {
    console.error("❌ Error Crítico en Procesamiento:", err.message);
  }
});

// --- FUNCIÓN DE ENVÍO (RESILIENTE) ---
async function sendWelcomeTemplate(to) {
  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
  
  const payload = {
    messaging_product: "whatsapp",
    to: to,
    type: "template",
    template: { 
      name: "bienvenida_activa_inversiones", 
      language: { code: "es_CL" } 
    }
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${WHATSAPP_TOKEN}`, 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(`Meta API Error: ${result.error?.message || "Unknown error"}`);
    }

    console.log(`🚀 Plantilla enviada con éxito a: ${to}`);
  } catch (error) {
    console.error(`⚠️ Falló envío a ${to}:`, error.message);
  }
}

// --- INICIO DEL SERVIDOR ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`
  *****************************************
  🚀 SERVIDOR ACTIVA INVERSIONES INICIADO
  📡 Puerto: ${PORT}
  🔗 URL Webhook: /webhook
  *****************************************
  `);
});