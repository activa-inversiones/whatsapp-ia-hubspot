// src/oliver-gpt/agent.js
//
// ORQUESTACIÓN — handleTurn() de Oliver GPT (plan 2.2).
//
// Un turno completo:
//   (a) Pre-proceso con normalizers: extractComuna → state.comuna,
//       detectConfirmation → flag.
//   (b) system = buildSystemBlocks(); contexto VOLÁTIL = buildSessionContext(state)
//       que se antepone al userText en el mensaje del usuario.
//   (c) Pass1 con TOOL_DEFS → si hay tool_calls, ejecuta runTool(name, input, toolCtx)
//       y arma los tool results (loop hasta 3 iteraciones máx).
//   (d) Pass2 → texto final.
//   (e) sanitizeChilean(reply) antes de devolver.
//   (f) devuelve { reply, history, toolCalls, state }.
//
// Historial in-memory por ahora (el llamador conserva `history`).
//
// INYECCIÓN PARA TESTS: el motor OpenAI se inyecta vía toolCtx.engine
// (con orchestratorPass1 / orchestratorPass2). Si no se inyecta, usa el
// motor real de ./engine.js. Esto permite tests herméticos sin red.
//
// PERSISTENCIA (hooks opcionales — NO cableados en el simulador):
//   toolCtx.saveLead(state)        → TODO F4: guardar lead calificado.
//   toolCtx.notifyMarcelo(payload) → TODO F4: alertar a Marcelo (escalación real).
//   toolCtx.persistSession(state)  → TODO F4: persistir la sesión.
//
// ESM, Node 18+.

import { buildSystemBlocks, buildSessionContext } from './system-prompt.js';
import { TOOL_DEFS, runTool } from './tools.js';
import { extractComuna, detectConfirmation, sanitizeChilean } from './normalizers.js';
import * as realEngine from './engine.js';

const MAX_TOOL_ITERATIONS = 3;

/**
 * handleTurn — Procesa un turno de conversación de Oliver GPT.
 * @param {object} args
 * @param {Array}  [args.history=[]] - Historial in-memory (mensajes OpenAI previos).
 * @param {string} args.userText - Texto del cliente en este turno.
 * @param {object} [args.state={}] - Estado de la sesión (comuna, lockedData, etc.).
 * @param {object} [args.toolCtx={}] - Contexto para tools + hooks + engine inyectable.
 * @returns {Promise<{reply:string, history:Array, toolCalls:Array, state:object}>}
 */
export async function handleTurn({ history = [], userText, state = {}, toolCtx = {} } = {}) {
  const engine = toolCtx.engine || realEngine;
  // runTool inyectable: por defecto el real (toca el Engine vía red); los tests
  // herméticos pasan toolCtx.runTool para evitar cualquier llamada de red.
  const execTool = typeof toolCtx.runTool === 'function' ? toolCtx.runTool : runTool;
  const nextState = { ...state };
  const toolCalls = []; // registro plano de tool_calls ejecutados (para el simulador/tests)

  // ── (a) Pre-proceso con normalizers ──────────────────────────────────────
  const comuna = extractComuna(userText);
  if (comuna) {
    nextState.comuna = comuna;
    nextState.lockedData = { ...(nextState.lockedData || {}), comuna };
  }
  const confirmed = detectConfirmation(userText);
  if (confirmed) nextState.confirmacion = true;

  // ── (b) system + contexto volátil antepuesto al userText ──────────────────
  const system = buildSystemBlocks();
  const sessionContext = buildSessionContext(nextState);
  const userContent = `${sessionContext}\n\n─── Mensaje del cliente ───\n${userText}`;

  // El historial es in-memory: se conserva el userText "limpio" (sin el
  // contexto volátil) para no contaminar turnos futuros. El contexto volátil
  // solo viaja en el mensaje de ESTE turno.
  const userMsg = { role: 'user', content: userContent };
  const workingMessages = [...history, userMsg];

  // ── (c) Pass1 + loop de ejecución de tools (máx 3 iteraciones) ────────────
  let iterations = 0;
  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations += 1;

    const pass1 = await engine.orchestratorPass1({
      system,
      messages: workingMessages,
      tools: TOOL_DEFS,
    });

    const calls = pass1.tool_calls || [];
    if (!calls.length) {
      // No hay más acciones que ejecutar; el mensaje del assistant (si trae
      // contenido) queda en el working set y pasamos a Pass2.
      if (pass1.content) {
        workingMessages.push({ role: 'assistant', content: pass1.content });
      }
      break;
    }

    // El mensaje del assistant con los tool_calls DEBE preceder a los tool results.
    workingMessages.push({
      role: 'assistant',
      content: pass1.content || null,
      tool_calls: calls,
    });

    // Ejecutar cada tool y anexar su resultado como mensaje role:'tool'.
    for (const call of calls) {
      const name = call.function?.name;
      let input = {};
      try {
        input = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        input = {};
      }

      let result;
      try {
        result = await execTool(name, input, toolCtx);
      } catch (err) {
        result = { ok: false, error: String(err && err.message ? err.message : err) };
      }

      toolCalls.push({ name, input, result });
      workingMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
    // Volvemos al inicio del loop: Pass1 con los tool results en contexto.
  }

  // ── (d) Pass2: texto final al cliente ─────────────────────────────────────
  let reply = await engine.orchestratorPass2({
    system,
    messages: workingMessages,
  });

  // ── (e) Red de seguridad anti-voseo antes de devolver ─────────────────────
  reply = sanitizeChilean(reply);

  // El reply final se persiste en el historial in-memory.
  const newHistory = [...history, userMsg, { role: 'assistant', content: reply }];

  // ── Hooks de persistencia (opcionales — TODO F4: cablear en producción) ───
  // En el simulador NO se cablean; quedan como puntos de extensión claros.
  if (typeof toolCtx.persistSession === 'function') {
    try {
      await toolCtx.persistSession(nextState);
    } catch {
      /* TODO F4: manejo de error de persistencia */
    }
  }
  // toolCtx.saveLead(state) y toolCtx.notifyMarcelo(payload) quedan disponibles
  // para que el cableado de F4 los invoque desde las tools guardar_lead /
  // notificar_marcelo (aún no implementadas en runTool).

  return { reply, history: newHistory, toolCalls, state: nextState };
}

export default { handleTurn };
