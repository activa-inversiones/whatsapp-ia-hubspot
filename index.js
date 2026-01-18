import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();
const app = express();

// Aumentar el límite de procesamiento para evitar cierres
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { PHONE_NUMBER_ID, WHATSAPP_TOKEN, WEBHOOK_VERIFY_TOKEN } = process.env;

// --- RUTA DE SALUD (FUNDAMENTAL PARA RAILWAY) ---
// Esta ruta responde a Railway y evita el "Stopping Container"
app.get("/", (req, res) => {
    res.status(200).send("SERVIDOR ACTIVA INVERSIONES ONLINE ✅");
});

// --- VERIFICACIÓN WEBHOOK (META) ---
app.get("/webhook", (req, res) => {
    if (req.query["hub.verify_token"] === WEBHOOK_VERIFY_TOKEN) {
        return res.send(req.query["hub.challenge"]);
    }
    res.sendStatus(403);
});

// --- LÓGICA DE INTELIGENCIA ARTIFICIAL ---
app.post("/webhook", async (req, res) => {
    res.sendStatus(200); // Responder a Meta de inmediato
    
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (msg?.text?.body) {
        try {
            const completion = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: msg.text.body }]
            });

            await fetch(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    messaging_product: "whatsapp",
                    to: msg.from,
                    text: { body: completion.choices[0].message.content }
                })
            });
            console.log(`🚀 IA respondió a ${msg.from}`);
        } catch (error) {
            console.error("❌ Error:", error.message);
        }
    }
});

// ESCUCHAR EN TODAS LAS INTERFACES (0.0.0.0)
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ SERVIDOR ESTABLE EN PUERTO ${PORT}`);
});