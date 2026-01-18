import express from "express";
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

// RUTA DE SALUD (Crítica para evitar el "Stopping Container")
app.get("/", (req, res) => {
    res.status(200).send("✅ INFRAESTRUCTURA ACTIVA OPERATIVA");
});

// VERIFICACIÓN DEL WEBHOOK
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

// PROCESAMIENTO DE MENSAJES
app.post("/webhook", async (req, res) => {
    res.sendStatus(200); // Respuesta inmediata a Meta

    try {
        const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (!message?.text?.body) return;

        const from = message.from;
        const text = message.text.body;

        // IA - Generación de respuesta
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: text }],
        });

        const aiResponse = completion.choices[0].message.content;

        // Envío nativo (sin librerías externas para evitar errores de despliegue)
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
        console.log(`🚀 Mensaje procesado para ${from}`);
    } catch (error) {
        console.error("⚠️ Error en ejecución:", error.message);
    }
});

// CONFIGURACIÓN DE PUERTO PARA RAILWAY
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ SERVIDOR ESTABLECIDO EN PUERTO ${PORT}`);
});