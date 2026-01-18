import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();
const app = express();
app.use(express.json());

// CONFIGURACIÓN DE IA
const openai = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY 
});

const { PHONE_NUMBER_ID, WHATSAPP_TOKEN, WEBHOOK_VERIFY_TOKEN } = process.env;

// --- RUTA DE VIDA (FUNDAMENTAL PARA RAILWAY) ---
app.get("/", (req, res) => {
    console.log("✅ Railway Health Check: Servidor Activa Inversiones Saludable");
    res.status(200).send("OPERATIVO");
});

// --- VERIFICACIÓN DE WEBHOOK ---
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
        console.log("✅ Webhook validado por Meta");
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

// --- PROCESAMIENTO DE MENSAJES ---
app.post("/webhook", async (req, res) => {
    res.sendStatus(200); // Responder a Meta de inmediato para evitar bloqueos

    try {
        const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

        if (message?.text?.body) {
            const from = message.from;
            const text = message.text.body;
            console.log(`📩 Mensaje recibido de ${from}: ${text}`);

            // Respuesta Inteligente
            const completion = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: "Eres el asistente inteligente de Activa Inversiones. Responde de forma breve y profesional." },
                    { role: "user", content: text }
                ],
            });

            const aiResponse = completion.choices[0].message.content;

            // Envío por WhatsApp
            await fetch(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    messaging_product: "whatsapp",
                    to: from,
                    text: { body: aiResponse }
                })
            });
            console.log(`🚀 Respuesta IA enviada a ${from}`);
        }
    } catch (error) {
        console.error("❌ Error en flujo:", error.message);
    }
});

// --- INICIO DEL SERVIDOR ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`
    *****************************************
    ✅ SERVIDOR ACTIVA INVERSIONES INICIADO
    🚀 Puerto Railway: ${PORT}
    *****************************************
    `);
});