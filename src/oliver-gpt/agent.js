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
import { extractComuna, extraerColor, nombreDelMensaje, detectConfirmation, sanitizeChilean } from './normalizers.js';
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
  // 🔴 [2026-09-18] EL COLOR TAMPOCO SE VOLVIA A PREGUNTAR... porque nunca se guardaba.
  // Reclamo del dueño, textual: *"le digo color blanco y me pide color"*. Aca solo se extraia la
  // comuna; la maquinaria del color (`colorFueExplicito` + `normColor`) existia hace meses y no
  // estaba conectada a `lockedData`, que es lo que el prompt marca como *"DEFINITIVOS: NO volver
  // a preguntar"*. Medido sobre su mensaje real: "…comuna de vilcul y color blanco" ahora deja
  // comuna=Vilcún y color=BLANCO antes de que el LLM lea nada.
  const color = extraerColor(userText);
  if (color) {
    nextState.color = color;
    nextState.lockedData = { ...(nextState.lockedData || {}), color };
  }
  // 🔴 [2026-09-19] Y EL NOMBRE TAMPOCO. Tercera vez que el dueño reclama lo mismo: *"Oliver me
  // volvió a pedir nombre, color, comuna cuando yo ya la había entregado"*.
  // `extractName()` existia hace meses y no se llamaba desde aca; ademas DESCARTA el mensaje
  // entero si trae palabras de pedido ('necesito', 'color', 'ventana'), asi que el texto real
  // del cliente —"soy a nombre de MARIO GREY comuna de vilcul y color blanco necesito lo
  // siguiente"— devolvia null. `nombreDelMensaje` busca la formula de presentacion y se queda
  // solo con el nombre. El nombre NO se pisa si ya estaba: el primero que dio el cliente manda.
  // ⚠️ [Codex, compuerta] EL NOMBRE NO SE BLOQUEA EN `lockedData`, A DIFERENCIA DE LA COMUNA Y
  // EL COLOR. Textual: *"el error decisivo es bloquear como definitivo el resultado de un regex
  // de baja precision... un falso positivo bloqueado puede generar un PDF formal a nombre de
  // 'Arquitecto' o 'Con Marcelo'"*. Tenia razon, y esos dos casos estaban MEDIDOS.
  // La comuna y el color salen de catalogos cerrados —o es Vilcun o no lo es—; un nombre es
  // texto libre y el detector puede errarle. Asi que va al contexto de la sesion, que el prompt
  // muestra como "Nombre del cliente" (con eso alcanza para que Oliver NO lo pregunte), pero
  // NO a lockedData, que el prompt declara DEFINITIVO e incambiable. Si salio mal, se corrige.
  const _nom = nombreDelMensaje(userText);
  if (_nom && !nextState.nombre && !nextState.name) {
    nextState.nombre = _nom;
    nextState.name = _nom;
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
        // 🔴 [2026-09-19] EL PDF TIENE QUE VER LO QUE YA SE COTIZO EN ESTE TURNO.
        // En la propuesta 0485 el cliente recibio 16 de 17 ventanas: Oliver cotizo las 17 y al
        // armar el PDF dejo una afuera. `generar_pdf_cotizacion` completa ahora con lo que el
        // motor SI cotizo, y para eso necesita las tool calls previas. Se pasa la referencia
        // viva de `toolCalls`, que en este punto ya tiene todo lo del turno.
        result = await execTool(name, input, { ...toolCtx, toolCallsDelTurno: toolCalls });
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
