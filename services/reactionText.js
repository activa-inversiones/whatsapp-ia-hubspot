// reactionText.js — texto legible de una reacción de WhatsApp. ESM, sin dependencias.
//
// [2026-08-08] Por qué existe:
// Los tres parsers de mensajes entrantes (extractMsg en index.js, parseInbound en
// src/sales-agent/whatsapp-adapter.js y extractText en services/multiChannelHandler.js)
// mandaban las reacciones a su cajón de sastre final, que devuelve "[<tipo>]". El emoji
// se descartaba en la ingesta: la BD guardaba body = "[reaction]".
//
// Dos daños, uno visible y uno caro:
//   1. El dueño no ve QUÉ le reaccionaron al abrir la ficha del cliente.
//   2. La REGLA #9 del prompt de Oliver distingue 👍❤️🙏 (conformidad, avanzar) de
//      😮😢 (duda, preguntar) — pero nunca recibía el emoji, así que trataba una
//      reacción negativa a una cotización igual que una positiva.
//
// Vive en un módulo propio y no en uno de los tres parsers porque los tres son copias
// paralelas y el fix se aplicó a uno solo la primera vez. Un solo lugar = no vuelve a
// arreglarse a medias.
//
// Payload de Meta: entry[].changes[].value.messages[].reaction = { message_id, emoji }.
// Meta manda emoji: "" cuando el cliente RETIRA la reacción.

/**
 * @param {object} msg  El mensaje crudo de Meta (messages[0]), con type === "reaction".
 * @returns {string} Texto para persistir y para mostrarle al LLM.
 */
export function textoDeReaccion(msg) {
  const r = msg?.reaction;
  // Sin objeto `reaction` el payload está incompleto: NO es un retiro, es algo que no
  // entendemos. Decirlo así evita que un evento roto se lea como una decisión del cliente.
  //
  // ⚠️ NO devolver "[reaction]" acá. La REGLA #9 del prompt dice textualmente
  // "o recibís un mensaje [reaction]" → asumí conformidad y avanzá: un evento roto
  // haría avanzar la venta sola. Lo cazó la revisión semántica de Gemini (2026-08-08).
  if (!r || typeof r.emoji === "undefined" || r.emoji === null) return "[reacción incompleta]";
  const emoji = String(r.emoji).trim();
  if (!emoji) return "(retiró su reacción)";
  return `${emoji} (reaccionó)`;
}

export default textoDeReaccion;
