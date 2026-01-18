import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

const { PHONE_NUMBER_ID, WHATSAPP_TOKEN, WEBHOOK_VERIFY_TOKEN } = process.env;

// --- RUTA RAIZ: Mantiene el servidor despierto ---
app.get("/", (req, res) => {
  res.status(200).send("✅ SERVIDOR ACTIVA INVERSIONES ONLINE Y FUNCIONANDO");
});

// --- WEBHOOK: Verificación de Meta ---
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// --- WEBHOOK: Recepción de Mensajes ---
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Responder rápido a Meta
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return;
    
    console.log(`📩 Mensaje recibido de: ${message.from}`);
    await sendWelcomeTemplate(message.from);
  } catch (err) {
    console.error("❌ Error interno:", err.message);
  }
});

async function sendWelcomeTemplate(to) {
  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to,
        type: "template",
        template: { name: "bienvenida_activa_inversiones", language: { code: "es_CL" } }
      })
    });
    if (response.ok) console.log(`🚀 Plantilla enviada a ${to}`);
  } catch (e) {
    console.error("❌ Error de red Meta:", e.message);
  }
}

// --- CONFIGURACIÓN DE PUERTO CRÍTICA PARA RAILWAY ---
const PORT = process.env.PORT || 8080;
// Escuchar en 0.0.0.0 es obligatorio para despliegues en la nube
app.listen(PORT, "0.0.0.0", () => {
  console.log("*****************************************");
  console.log(`🚀 SERVIDOR ACTIVA INVERSIONES INICIADO`);
  console.log(`📡 Puerto Railway: ${PORT}`);
  console.log("*****************************************");
});