import express from 'express';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();
const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { PHONE_NUMBER_ID, WHATSAPP_TOKEN, WEBHOOK_VERIFY_TOKEN } = process.env;

// --- RESPUESTA INSTANTÁNEA PARA RAILWAY ---
// Esto detiene el "Stopping Container" al responder inmediatamente
app.get('/', (req, res) => {
    res.status(200).send('ESTADO: OPERATIVO ✅');
});

// WEBHOOK META
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === WEBHOOK_VERIFY_TOKEN) {
        return res.send(req.query['hub.challenge']);
    }
    res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (msg?.text?.body) {
        try {
            const ai = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: msg.text.body }]
            });
            await fetch(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ messaging_product: "whatsapp", to: msg.from, text: { body: ai.choices[0].message.content } })
            });
        } catch (e) { console.error("Error:", e.message); }
    }
});

// CONFIGURACIÓN DE RED AGRESIVA
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SERVIDOR ESCUCHANDO EN PUERTO ${PORT}`);
});

// Evitar que el servidor se cierre por inactividad de sockets
server.keepAliveTimeout = 120000; 
server.headersTimeout = 125000;