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
import { TOOL_DEFS, toolDefsConMcp, runTool } from './tools.js';
import { extractComuna, detectConfirmation, sanitizeChilean } from './normalizers.js';
import * as realEngine from './engine.js';

const MAX_TOOL_ITERATIONS = 6;   // [FIX 2026-06-19 CLI-04] 3 no alcanzaba para cotizar N≥2 ventanas + generar el PDF en el MISMO turno (Regla #13)

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
      tools: await toolDefsConMcp(),
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

      // [2026-06-24] GUARD de apertura (determinístico): el LLM a veces cotiza una "fija"
      // como CORREDERA (precio 2x). La palabra que dijo el cliente MANDA sobre la del LLM.
      // Funciona con TEXTO ("4 ventanas fijas") Y con IMAGEN (la visión deja el texto
      // "...| fija | 80x200 |..." en userText → se detecta igual). Si el cliente menciona UNA
      // sola apertura y NO coincide con la que eligió el LLM, la corregimos antes de pegarle al
      // motor. Si hay VARIAS aperturas (pedido mixto), NO tocamos (el LLM cotiza cada una).
      if (name === 'calcular_cotizacion' || name === 'calcular_por_area') {
        const _t = String(userText || '').toLowerCase();
        const found = new Set();
        if (/\boscilo\s?batient/.test(_t)) found.add('OSCILOBATIENTE');
        if (/\bproyectant/.test(_t)) found.add('PROYECTANTE');
        if (/\bcorrediz/.test(_t) || /\bcorrederas?\b/.test(_t) || /\bdeslizant/.test(_t)) found.add('CORREDERA');
        if (/\bbatient/.test(_t) || /\babatibl/.test(_t)) found.add('BATIENTE');
        if (/\bfij[ao]s?\b/.test(_t)) found.add('FIJA');
        if (found.size === 1) {
          const apReal = [...found][0];
          if (String(input.tipo || '').toUpperCase() !== apReal) {
            console.warn(`[agent] apertura corregida: LLM='${input.tipo}' → cliente='${apReal}'`);
            input = { ...input, tipo: apReal };
          }
        }
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

  // El reply final se persiste en el historial. [2026-06-14 FIX re-saludo] Se guarda el userText
  // LIMPIO (NO userMsg, que lleva el contexto volátil): guardar userMsg llenaba el historial de
  // bloques "CONTEXTO DE LA SESIÓN" y el cerebro re-saludaba perdiendo el hilo. Honra el comentario L67-69.
  const newHistory = [...history, { role: 'user', content: userText }, { role: 'assistant', content: reply }];

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
