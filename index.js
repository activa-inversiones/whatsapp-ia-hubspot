app.post("/webhook", (req, res) => {
  // 1) RESPONDE ALTIRO A META (evita 502 por timeout)
  res.sendStatus(200);

  // 2) Procesa después (sin bloquear la respuesta)
  setImmediate(() => {
    handleWebhookEvent(req.body).catch((err) => {
      console.error("handleWebhookEvent error:", err?.response?.data || err?.message || err);
    });
  });
});

// Mueve aquí la lógica que antes tenías dentro del POST
async function handleWebhookEvent(body) {
  if (body.object !== "whatsapp_business_account") return;

  const entry = body.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  const messages = value?.messages;
  if (!messages || !messages.length) return;

  const msg = messages[0];
  const msgId = msg.id;
  const from = msg.from;
  const text = msg?.text?.body || "";

  // Dedupe
  if (processedMsgIds.has(msgId)) return;
  processedMsgIds.add(msgId);
  if (processedMsgIds.size > 2000) {
    const arr = Array.from(processedMsgIds);
    arr.slice(0, 800).forEach((id) => processedMsgIds.delete(id));
  }

  const session = getSession(from);

  // Actualiza lead (parsing rápido)
  session.lead = parseLeadFromText(session.lead, text);

  // Genera respuesta
  const reply = await generateSalesReply({ waId: from, userText: text });
  const safeReply =
    reply ||
    `Gracias por escribir a ${BUSINESS_NAME}. Para cotizar rápido:
1) ¿Es residencial o comercial?
2) ¿Qué necesitas: ventanas/puertas/muro cortina/tabiques vidriados?
3) ¿En qué comuna/ciudad es el proyecto?`;

  // Enviar WhatsApp (NO bloquees la app si Meta/WA demora)
  safeSendWhatsAppText(from, safeReply);

  // CRM (opcional, también sin bloquear)
  if (shouldCloseLead(session.lead)) {
    safeSendToCRM(from, session.lead);
    session.stage = "READY_TO_QUOTE";
  }
}

// Envío “safe” para no botar el proceso por timeouts o tokens
function safeSendWhatsAppText(to, text) {
  sendWhatsAppText(to, text).catch((e) => {
    console.error("sendWhatsAppText error:", e?.response?.data || e.message);
  });
}

function safeSendToCRM(waId, lead) {
  sendToCRM(waId, lead).catch((e) => {
    console.error("sendToCRM error:", e?.response?.data || e.message);
  });
}

