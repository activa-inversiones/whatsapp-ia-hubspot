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
