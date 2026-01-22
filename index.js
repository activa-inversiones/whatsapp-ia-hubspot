// index.js
import express from "express";
import axios from "axios";
import OpenAI from "openai";

const app = express();

// IMPORTANT: Meta webhooks envían JSON
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 8080;

// ====== ENV (Railway Variables) ======
// OPENAI_API_KEY   = tu key OpenAI
// VERIFY_TOKEN     = el mismo texto que pusiste en Meta Webhooks (Identificador de verificación)
// WHATSAPP_TOKEN   = token permanente (System User / token largo)
// PHONE_NUMBER_ID  = (opcional) fallback si Meta no manda metadata.phone_number_id
// =====================================

const openai =
  process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY.trim() })
    : null;

// Dedupe simple en memoria (evita responder 2 veces si Meta reintenta)
const seenMessageIds = new Map(); // id -> timestamp
const DEDUPE_TTL_MS = 10 * 60 * 1000;

function dedupeHas(id) {
  const now = Date.now();
  // purge
  for (const [k, ts] of seenMessageIds.entries()) {
    if (now - ts > DEDUPE_TTL_MS) seenMessageIds.delete(k);
  }
  if (!id) return false;
  if (seenMessageIds.has(id)) return true;
  seenMessageIds.set(id, now);
  return false;
}

// Salud
app.get("/", (req, res) => {
  res.status(200).send("BOT ACTIVA INVERSIONES - ONLINE");
});

// Verificación webhook (Meta)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("✅ Webhook verificado correctamente");
    return res.status(200).send(challenge);
  }
  console.log("❌ Verificación fallida:", { mode, token });
  return res.sendStatus(403);
});

// Enviar WhatsApp
async function sendWhatsAppText({ phoneNumberId, to, text }) {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error("Falta WHATSAPP_TOKEN en Railway Variables");

  if (!phoneNumberId) {
    throw new Error(
      "Falta phoneNumberId (metadata.phone_number_id) y no hay PHONE_NUMBER_ID fallback"
    );
  }

  const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;

  await axios({
    method: "POST",
    url,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    data: {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    },
    timeout: 20000,
  });
}

// Webhook entrante
app.post("/webhook", async (req, res) => {
  // Siempre responder 200 rápido (Meta reintenta si demoras)
  res.sendStatus(200);

  try {
    const body = req.body;

    // Log mínimo para saber si llega algo
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!body?.object) {
      console.log("⚠️ POST /webhook sin body.object");
      return;
    }

    // Meta manda statuses muy seguido; no son mensajes entrantes
    if (value?.statuses?.length) {
      // Si quieres verlos, descomenta:
      // console.log("ℹ️ STATUS:", JSON.stringify(value.statuses[0], null, 2));
      return;
    }

    const messages = value?.messages;
    if (!messages || !messages.length) {
      console.log("ℹ️ Webhook recibido sin messages (posible evento distinto)");
      return;
    }

    // Para 2 números: viene aquí el phone_number_id del número que recibió
    const phoneNumberId =
      value?.metadata?.phone_number_id || process.env.PHONE_NUMBER_ID;

    if (!phoneNumberId) {
      console.log("❌ No viene metadata.phone_number_id y no hay PHONE_NUMBER_ID.");
      return;
    }

    for (const message of messages) {
      const msgId = message?.id;
      if (dedupeHas(msgId)) {
        console.log("↩️ Dedupe: mensaje repetido, id:", msgId);
        continue;
      }

      const from = message?.from; // cliente
      const type = message?.type;

      console.log(`📩 IN (${phoneNumberId}) FROM ${from} TYPE ${type} ID ${msgId}`);

      // Solo texto
      if (type !== "text") {
        await sendWhatsAppText({
          phoneNumberId,
          to: from,
          text: "Gracias por tu mensaje. Por ahora respondo solo texto. ¿Qué necesitas cotizar o consultar?",
        });
        console.log(`📤 OUT (${phoneNumberId}) TO ${from}: fallback no-text`);
        continue;
      }

      const userMessage = message?.text?.body?.trim() || "";
      if (!userMessage) {
        await sendWhatsAppText({
          phoneNumberId,
          to: from,
          text: "¿Podrías escribir tu consulta por favor?",
        });
        console.log(`📤 OUT (${phoneNumberId}) TO ${from}: empty-text`);
        continue;
      }

      let aiResponse =
        "Gracias por tu mensaje. Un ejecutivo te contactará en breve. ¿Me indicas tu nombre y comuna?";

      // IA (si está configurada)
      if (openai) {
        try {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "Eres un asistente virtual profesional y directo de Activa Inversiones EIRL. Responde breve, claro y orientado a ayudar/cotizar. Si falta un dato, pide ese dato. Si no puedes resolver, deriva a humano.",
              },
              { role: "user", content: userMessage },
            ],
          });

          aiResponse =
            completion?.choices?.[0]?.message?.content?.trim() || aiResponse;
        } catch (e) {
          console.log("⚠️ OpenAI falló:", e?.message);
        }
      } else {
        console.log("⚠️ OPENAI_API_KEY no configurada, respondo fallback.");
      }

      await sendWhatsAppText({
        phoneNumberId,
        to: from,
        text: aiResponse,
      });

      console.log(`📤 OUT (${phoneNumberId}) TO ${from}: ${aiResponse}`);
    }
  } catch (error) {
    const data = error?.response?.data;
    console.error("❌ Error en /webhook:", data || error?.message || error);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 SERVIDOR LISTO EN PUERTO: ${PORT}`);
  console.log("✅ Rutas: GET /  |  GET /webhook  |  POST /webhook");
});
