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

// --- RUTA RAÍZ (OBLIGATORIA PARA RAILWAY) ---
// Sin esto, Railway detiene el contenedor a los pocos segundos
app.get("/", (req, res) => {
    res.status(200).send("SERVIDOR ACTIVA INVERSIONES ONLINE ✅");
});

// --- VERIFICACIÓN DE WEBHOOK (META) ---
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

// --- PROCESAMIENTO DE MENSAJES ---
app.post("/webhook", async (req, res) => {
    res.sendStatus(200); // Respuesta inmediata a Meta

    try {
        const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

        if (message?.text?.body) {
            const from = message.from;
            const text = message.text.body;
            console.log(`📩 Mensaje de ${from}: ${text}`);

            // Respuesta de IA
            const completion = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: text }],
            });

            const aiResponse = completion.choices[0].message.content;

            // Enviar WhatsApp
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
        }
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
});

// --- INICIO ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ SERVIDOR INICIADO EN PUERTO ${PORT}`);
});