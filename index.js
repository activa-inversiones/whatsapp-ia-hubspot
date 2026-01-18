import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// Endpoint de salud para Railway
app.get('/', (req, res) => res.status(200).send('Servidor Activo'));

// Webhook de Meta
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode && token === process.env.WEBHOOK_VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.status(403).end();
    }
});

app.post('/webhook', async (req, res) => {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (message) {
        const from = message.from;
        const msgBody = message.text?.body;
        console.log(`Mensaje de ${from}: ${msgBody}`);
        
        // Respuesta simple de prueba
        try {
            await axios({
                method: 'POST',
                url: `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
                headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}` },
                data: {
                    messaging_product: "whatsapp",
                    to: from,
                    type: "text",
                    text: { body: "Hola! Tu bot ya está funcionando correctamente." }
                }
            });
        } catch (e) { console.error("Error al enviar:", e.response?.data || e.message); }
    }
    res.status(200).send('OK');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));