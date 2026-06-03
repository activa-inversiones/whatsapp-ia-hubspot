// agent.smoke.test.js — Smoke test HERMÉTICO del wiring de handleTurn (plan 2.2/2.4).
//
// Verifica el CABLEADO, sin red ni API real:
//   · extractComuna setea state.comuna a partir del userText.
//   · detectConfirmation detecta 'confirmo' (state.confirmacion = true).
//   · runTool NUNCA recibe tipo:'TERMOPANEL' (el fake emite CORREDERA).
//   · sanitizeChilean se aplica al reply (voseo del Pass2 → chileno profesional).
//
// HERMÉTICO: tanto el motor OpenAI (toolCtx.engine) como el ejecutor de tools
// (toolCtx.runTool) se INYECTAN. NADA toca la red, OpenAI ni el Engine.
//
// Ejecutar desde C:\Users\mcifu\activa\temp-wa con:
//   node --test src/oliver-gpt/agent.smoke.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleTurn } from './agent.js';

// ── Fake de engine (NO red): Pass1 emite un tool_call calcular_cotizacion con
//    tipo CORREDERA; Pass2 devuelve texto con voseo para probar sanitizeChilean. ──
function makeFakeEngine() {
  const seen = { pass1Calls: 0, pass2Calls: 0 };
  return {
    seen,
    async orchestratorPass1({ messages }) {
      seen.pass1Calls += 1;
      // Solo emitir el tool_call en la PRIMERA iteración; cuando ya hay un tool
      // result en contexto, no pedir más tools → corta el loop.
      const yaHayToolResult = messages.some((m) => m.role === 'tool');
      if (yaHayToolResult) {
        return { tool_calls: [], content: 'listo', raw: {} };
      }
      return {
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'calcular_cotizacion',
              // CORREDERA, jamás TERMOPANEL. glass_id presente.
              arguments: JSON.stringify({
                tipo: 'CORREDERA',
                ancho_mm: 1500,
                alto_mm: 1200,
                glass_id: 44,
                comuna: 'Temuco',
              }),
            },
          },
        ],
        content: '',
        raw: {},
      };
    },
    async orchestratorPass2() {
      seen.pass2Calls += 1;
      // Texto con voseo a propósito: sanitizeChilean debe corregirlo.
      return 'Perfecto, si querés te paso el detalle. Vos contame y dale.';
    },
  };
}

// ── Fake de runTool (NO red): captura los inputs y devuelve un quote fake.
//    Aserta in-situ que jamás llega tipo:'TERMOPANEL'. ──
function makeFakeRunTool() {
  const captured = [];
  const runTool = async (name, input) => {
    captured.push({ name, input });
    if (name === 'calcular_cotizacion' || name === 'calcular_por_area') {
      assert.notEqual(
        String(input.tipo).toUpperCase(),
        'TERMOPANEL',
        "runTool NUNCA debe recibir tipo:'TERMOPANEL'"
      );
    }
    return { ok: true, total: 321593, fake: true };
  };
  return { runTool, captured };
}

test('wiring: extractComuna setea state.comuna (Temuco)', async () => {
  const engine = makeFakeEngine();
  const { runTool } = makeFakeRunTool();
  const out = await handleTurn({
    history: [],
    userText: 'Hola, quiero 3 ventanas en Temuco',
    state: {},
    toolCtx: { engine, runTool },
  });
  assert.equal(out.state.comuna, 'Temuco', 'comuna debe extraerse del userText');
  assert.equal(out.state.lockedData?.comuna, 'Temuco', 'comuna debe quedar en lockedData');
});

test("wiring: detectConfirmation detecta 'confirmo'", async () => {
  const engine = makeFakeEngine();
  const { runTool } = makeFakeRunTool();
  const out = await handleTurn({
    history: [],
    userText: 'confirmo',
    state: {},
    toolCtx: { engine, runTool },
  });
  assert.equal(out.state.confirmacion, true, "detectConfirmation debe marcar 'confirmo'");
});

test("wiring: runTool NUNCA recibe tipo:'TERMOPANEL' (el fake emite CORREDERA)", async () => {
  const engine = makeFakeEngine();
  const { runTool, captured } = makeFakeRunTool();

  const out = await handleTurn({
    history: [],
    userText: 'cotiza una ventana',
    state: {},
    toolCtx: { engine, runTool },
  });

  assert.ok(captured.length >= 1, 'runTool debe haberse ejecutado al menos una vez');
  for (const c of captured) {
    if (c.name === 'calcular_cotizacion' || c.name === 'calcular_por_area') {
      assert.notEqual(String(c.input.tipo).toUpperCase(), 'TERMOPANEL');
      assert.equal(c.input.tipo, 'CORREDERA', 'el fake debe emitir CORREDERA');
    }
  }
  // El resultado del tool fake quedó registrado en out.toolCalls.
  assert.ok(out.toolCalls.some((t) => t.result && t.result.fake === true));
});

test('wiring: sanitizeChilean se aplica al reply (voseo → chileno)', async () => {
  const engine = makeFakeEngine();
  const { runTool } = makeFakeRunTool();
  const out = await handleTurn({
    history: [],
    userText: 'hola',
    state: {},
    toolCtx: { engine, runTool },
  });

  // El Pass2 fake devolvió voseo ("querés", "Vos", "dale"); el reply final
  // debe venir ya saneado.
  assert.ok(!/\bquerés\b/i.test(out.reply), "no debe quedar 'querés' (voseo)");
  assert.ok(!/\bvos\b/i.test(out.reply), "no debe quedar 'vos'");
  assert.match(out.reply, /quiere/i, "voseo 'querés' debe reescribirse a 'quiere'");
  assert.equal(engine.seen.pass2Calls, 1, 'Pass2 debe haberse llamado una vez');
});

test('wiring: loop de tools corta y produce reply + history', async () => {
  const engine = makeFakeEngine();
  const { runTool } = makeFakeRunTool();
  const out = await handleTurn({
    history: [],
    userText: 'cotiza',
    state: {},
    toolCtx: { engine, runTool },
  });
  assert.ok(engine.seen.pass1Calls <= 3, 'no debe exceder 3 iteraciones de Pass1');
  assert.ok(typeof out.reply === 'string' && out.reply.length > 0, 'debe haber reply');
  // history conserva el userText limpio + el reply.
  assert.equal(out.history.length, 2, 'history debe tener el user y el assistant del turno');
});
