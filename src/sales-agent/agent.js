// agent.js — Loop de tool-use de Oliver v2 con Claude Haiku 4.5
// ESM | Node 18+ | @anthropic-ai/sdk
//
// Diseño:
//  - Loop manual (no tool-runner) para controlar la integración con WhatsApp.
//  - Prompt caching en el system prompt (estable) vía buildSystemBlocks().
//  - El contexto volátil de sesión va en messages, no en system.
//  - Haiku 4.5 NO acepta el parámetro `effort` (da 400) → se omite.
//
// Uso: ver run-demo.js (consola) e INTEGRATION.md (webhook de index.js).

import Anthropic from "@anthropic-ai/sdk";
import { buildSystemBlocks, buildSessionContext } from "./system-prompt.js";
import { TOOL_DEFS, runTool } from "./tools.js";
import { parseInbound, sendWhatsAppText } from "./whatsapp-adapter.js";

const MODEL_ID = process.env.OLIVER_MODEL || "claude-haiku-4-5";
const MAX_TOKENS = 1024; // respuestas de WhatsApp son cortas
const MAX_TOOL_ITERATIONS = 5; // tope de seguridad del loop agéntico

const client = new Anthropic(); // resuelve ANTHROPIC_API_KEY del entorno

const SYSTEM_BLOCKS = buildSystemBlocks(); // se construye una vez (estable → cacheable)

/**
 * Procesa un turno de conversación.
 *
 * @param {object} params
 * @param {Array<object>} params.history  Historial previo en formato Anthropic
 *        (array de { role, content }). Se MUTA: se le agregan los turnos nuevos.
 * @param {string} params.userText  Mensaje entrante del cliente.
 * @param {object} [params.state]  Contexto volátil de sesión (nombre, comuna, datos lockeados…).
 * @param {object} [params.toolCtx]  Contexto para executors ({ telefono, saveLead, notifyMarcelo }).
 * @returns {Promise<{ reply:string, history:Array, toolCalls:Array, usage:object }>}
 */
export async function handleTurn({ history = [], userText, state = {}, toolCtx = {} }) {
  // Inyecta el contexto volátil de sesión como prefijo del turno del usuario.
  // (No va en system: rompería el caché del prompt.)
  const sessionCtx = buildSessionContext(state);
  const userContent = sessionCtx
    ? `${sessionCtx}\n\n---\n\nCliente: ${userText}`
    : userText;

  history.push({ role: "user", content: userContent });

  const toolCalls = [];
  let lastUsage = null;
  let replyText = "";

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL_ID,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_BLOCKS, // cache_control en el último bloque
      tools: TOOL_DEFS,
      messages: history,
    });

    lastUsage = response.usage;

    // Persistir el turno del asistente COMPLETO (preserva bloques tool_use).
    history.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
      const toolResults = [];

      for (const block of toolUseBlocks) {
        const result = await runTool(block.name, block.input, toolCtx);
        toolCalls.push({ name: block.name, input: block.input, result });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result.ok ? result.data : { error: result.error }),
          is_error: !result.ok,
        });
      }

      history.push({ role: "user", content: toolResults });
      continue; // otra vuelta: Claude redacta con los resultados
    }

    // end_turn (o cualquier otro stop): extrae el texto final para el cliente.
    replyText = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    break;
  }

  if (!replyText) {
    replyText = "Dame un segundo y te confirmo 🙏";
  }

  return { reply: replyText, history, toolCalls, usage: lastUsage };
}

export { MODEL_ID };

/* =========================
   WEBHOOK DE WHATSAPP (Oliver v2)
   ========================= */

// Caché de historial por teléfono.
// ⚠️ PILOTO: in-memory. NO persiste entre redeploys / reinicios del proceso.
// TODO: cablear a Postgres (cargar/guardar history por teléfono) antes de
// escalar más allá del número único de piloto.
const CONV_HISTORY = new Map(); // Map<from(string), history[]>

// Tope de turnos guardados por conversación, para acotar tokens.
// Cada "turno" puede ser user / assistant / tool_result; 20 es un colchón
// razonable para una conversación de ventas corta.
const MAX_HISTORY_TURNS = 20;

/**
 * Entrypoint del webhook de WhatsApp para Oliver v2.
 *
 * Patrón (igual al webhook de index.js):
 *   1) Responde 200 INMEDIATAMENTE para ackear a Meta.
 *   2) Procesa el mensaje de forma asíncrona (try/catch — nunca lanza luego del 200).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleWebhook(req, res) {
  // 1) Ack inmediato a Meta (evita reintentos / timeouts del webhook).
  res.sendStatus(200);

  // 2) Procesamiento asíncrono — todo envuelto en try/catch.
  try {
    const inbound = parseInbound(req.body);
    if (!inbound.ok) return; // status de entrega o mensaje no parseable

    const { from, text } = inbound;
    if (!from || !text) return;

    // Historial por teléfono (piloto in-memory).
    const history = CONV_HISTORY.get(from) || [];

    const state = {
      telefono: from,
      fecha: new Date().toISOString(),
    };

    // saveLead / notifyMarcelo se dejan sin setear → tools.js usa stubs seguros.
    const toolCtx = { telefono: from };

    const { reply, history: newHistory } = await handleTurn({
      history,
      userText: text,
      state,
      toolCtx,
    });

    // Acota el historial a los últimos N elementos (bound de tokens).
    const trimmed =
      newHistory.length > MAX_HISTORY_TURNS
        ? newHistory.slice(-MAX_HISTORY_TURNS)
        : newHistory;
    CONV_HISTORY.set(from, trimmed);

    await sendWhatsAppText(from, reply);
  } catch (err) {
    // Nunca relanzar: el 200 ya se envió.
    console.error("[handleWebhook] error procesando mensaje:", err?.stack || err);
  }
}
