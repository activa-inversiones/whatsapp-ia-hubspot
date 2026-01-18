import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// 1. Endpoint de Salud (CRUCIAL para que Railway no reinicie la app)
app.get('/', (req, res) => {
    res.status(200).send('Servidor Activo y Escuchando');
});

// 2. Webhook de Verificación (GET)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode && token === process.env.WEBHOOK_VERIFY_TOKEN) {
        console.log("Webhook verificado correctamente.");
        res.status(200).send(challenge);
    } else {
        res.status(403).end();
    }
});

// 3. Recepción de Mensajes (POST)
app.post('/webhook', async (req, res) => {
    console.log("Webhook POST recibido"); // Log para confirmar recepción
    
    const body = req.body;

    // Verificar si es un evento de WhatsApp
    if (body.object) {
        if (
            body.entry &&
            body.entry[0].changes &&
            body.entry[0].changes[0].value.messages &&
            body.entry[0].changes[0].value.messages[0]
        ) {
            const message = body.entry[0].changes[0].value.messages[0];
            const from = message.from;
            const msgBody = message.text?.body;

            console.log(`📩 Mensaje recibido de ${from}: ${msgBody}`);

            // Responder al usuario
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
                        text: { body: "¡Hola! He recibido tu mensaje correctamente en Railway 🚀" }
                    }
                });
                console.log("✅ Respuesta enviada exitosamente");
            } catch (e) {
                console.error("❌ Error al enviar respuesta:", e.response?.data || e.message);
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// 4. Iniciar Servidor (MODIFICADO para escuchar en 0.0.0.0)
const PORT = process.env.PORT || 8080;
// El '0.0.0.0' es vital para que Railway detecte el puerto
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});