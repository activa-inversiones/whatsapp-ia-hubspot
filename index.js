import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// 1. ENDPOINT DE SALUD (Para evitar el "Stopping Container")
app.get('/', (req, res) => {
    res.status(200).send('Servidor Activo');
});

// 2. VERIFICACIÓN DEL WEBHOOK
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

// 3. RECEPCIÓN DE MENSAJES
app.post('/webhook', async (req, res) => {
    try {
        const entry = req.body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];

        if (message) {
            const from = message.from;
            const msgBody = message.text?.body;

            console.log(`Mensaje recibido de ${from}: ${msgBody}`);

            // Respuesta automática de prueba
            await sendWhatsAppMessage(from, "Hola, recibí tu mensaje correctamente.");
        }
        res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
        console.error("Error en webhook:", error);
        res.status(500).end();
    }
});

// 4. FUNCIÓN PARA ENVIAR (Compatible con categoría Marketing)
async function sendWhatsAppMessage(to, text) {
    try {
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
            headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: {
                messaging_product: "whatsapp",
                to: to,
                type: "text",
                text: { body: text }
            }
        });
        console.log("Respuesta enviada a WhatsApp.");
    } catch (error) {
        console.error("Error al enviar:", error.response?.data || error.message);
    }
}

// 5. PUERTO 8080 OBLIGATORIO
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 SERVIDOR FUNCIONANDO EN PUERTO ${PORT}`);
});