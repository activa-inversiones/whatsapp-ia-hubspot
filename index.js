import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// 1. RUTA DE SALUD (Vital para Railway)
app.get('/', (req, res) => {
    res.status(200).send('Servidor activo y listo 🚀');
});

// 2. VERIFICACIÓN DEL WEBHOOK (Meta)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode && token === process.env.WEBHOOK_VERIFY_TOKEN) {
        console.log("✅ Webhook verificado exitosamente.");
        res.status(200).send(challenge);
    } else {
        res.status(403).end();
    }
});

// 3. RECEPCIÓN DE MENSAJES
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object) {
        // Verificamos si hay un mensaje válido
        if (body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
            const message = body.entry[0].changes[0].value.messages[0];
            const from = message.from;
            const text = message.text?.body;
            
            console.log(`📩 Nuevo mensaje de ${from}: ${text}`);

            // Enviamos respuesta a WhatsApp
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
                        to: from,
                        type: "text",
                        text: { body: "🤖 Hola! Tu servidor en Railway me ha activado correctamente." }
                    }
                });
            } catch (error) {
                console.error("❌ Error al responder:", error.response?.data || error.message);
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// 4. ARRANQUE AUTOMÁTICO
// Usamos process.env.PORT (el que Railway quiera) o 3000 si es local
const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Servidor iniciado en puerto: ${port}`);
});