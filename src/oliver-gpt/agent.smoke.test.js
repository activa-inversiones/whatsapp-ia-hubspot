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

// ── [2026-08-20] EL MECANISMO POR EL QUE GPT NO COTIZABA COMO CLAUDE ────────
// El dueno lo noto en produccion: "algo pasa que al parecer no cotiza como claude".
// Medido: Claude entrego el PDF en 7,42% de sus turnos, GPT en 3,35%.
// Causa: OpenAI iba con parallel_tool_calls:false => UNA tool por vuelta. Con el tope de
// MAX_TOOL_ITERATIONS el bucle se agota antes del PDF. Claude pide todas de una pasada.

function motorQueCotiza({ ventanas, unaPorVuelta }) {
  let cotizadas = 0, pdfHecho = false;
  return {
    async orchestratorPass1() {
      const faltan = ventanas - cotizadas;
      if (faltan > 0) {
        const cuantas = unaPorVuelta ? 1 : faltan;
        const calls = Array.from({ length: cuantas }, (_, i) => ({
          id: `c${cotizadas + i}`, type: 'function',
          function: { name: 'calcular_cotizacion', arguments: '{"ancho_mm":1200,"alto_mm":1000}' },
        }));
        cotizadas += cuantas;
        return { tool_calls: calls, content: null };
      }
      if (!pdfHecho) {
        pdfHecho = true;
        return { tool_calls: [{ id: 'pdf', type: 'function',
          function: { name: 'generar_pdf_cotizacion', arguments: '{}' } }], content: null };
      }
      return { tool_calls: [], content: null };
    },
    async orchestratorPass2() { return 'Listo, te envie tu propuesta.'; },
  };
}

const toolFalsa = async (name) =>
  name === 'calcular_cotizacion' ? { ok: true, unit_price: 421560 } : { ok: true, quote_number: 'CM-TEST' };

async function cotizar(ventanas, unaPorVuelta) {
  const r = await handleTurn({
    userText: `Necesito ${ventanas} ventanas para mi casa en Temuco`,
    toolCtx: { engine: motorQueCotiza({ ventanas, unaPorVuelta }), runTool: toolFalsa },
  });
  const usadas = (r.toolCalls || []).map((t) => t.name || t);
  return { pdf: usadas.includes('generar_pdf_cotizacion'),
           calc: usadas.filter((n) => n === 'calcular_cotizacion').length };
}

test('pidiendo TODAS las tools de una vez, el PDF sale aunque sean 12 ventanas', async () => {
  for (const n of [1, 3, 5, 6, 8, 12]) {
    const r = await cotizar(n, false);
    assert.equal(r.calc, n, `cotizo ${r.calc} de ${n} ventanas`);
    assert.equal(r.pdf, true, `con ${n} ventanas NO alcanzo a mandar el PDF`);
  }
});

test('EL BUG: con UNA tool por vuelta, a las 6 ventanas el bucle se agota SIN mandar el PDF', async () => {
  // Documenta el comportamiento viejo, para que quede claro por que se cambio el flag.
  assert.equal((await cotizar(5, true)).pdf, true, 'con 5 ventanas llegaba JUSTO (6 vueltas)');
  assert.equal((await cotizar(6, true)).pdf, false, 'con 6 ya no: aca se perdia la cotizacion');
  const ocho = await cotizar(8, true);
  assert.equal(ocho.pdf, false);
  assert.ok(ocho.calc < 8, `ni siquiera alcanzo a cotizarlas todas: ${ocho.calc} de 8`);
});
