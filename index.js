import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();
const app = express();
app.use(express.json());

// Configuración de OpenAI
const openai = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY 
});

// Variables de entorno de Meta
const { PHONE_NUMBER_ID, WHATSAPP_TOKEN, WEBHOOK_VERIFY_TOKEN } = process.env;

// Ruta de salud para Railway
app.get("/", (req, res) => {
    res.status(200).send("Servidor Activa Inversiones Operativo ✅");
});

// Verificación del Webhook (Handshake con Meta)
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
        console.log("✅ Webhook verificado correctamente");
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

// Recepción y respuesta de mensajes
app.post("/webhook", async (req, res) => {
    // Confirmamos a Meta que recibimos la petición de inmediato
    res.sendStatus(200);

    const data = req.body;
    const message = data.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message?.text?.body) {
        const from = message.from;
        const text = message.text.body;
        console.log(`📩 Mensaje de ${from}: ${text}`);

        try {
            // 1. Consultar a la IA
            const aiCompletion = await openai.chat.completions.create({
                model: "gpt-3.5-turbo", // O "gpt-4" si tienes créditos
                messages: [
                    { role: "system", content: "Eres el asistente inteligente de Activa Inversiones. Responde de forma cordial, profesional y breve." },
                    { role: "user", content: text }
                ],
            });

            const aiResponse = aiCompletion.choices[0].message.content;

            // 2. Enviar respuesta por WhatsApp
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
            console.log(`🚀 Respuesta enviada a ${from}`);
        } catch (error) {
            console.error("❌ Error procesando IA o WhatsApp:", error.message);
        }
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ SERVIDOR ACTIVA INVERSIONES INICIADO EN PUERTO ${PORT}`);
});