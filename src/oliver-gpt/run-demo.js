// src/oliver-gpt/run-demo.js
//
// SIMULADOR DE CONSOLA — REPL para Oliver GPT (plan 2.4).
//
// Toma mensajes tipeados, llama handleTurn manteniendo history + state, e
// imprime para cada turno:
//   [Pass1 tool_calls] · [tool results] · [reply].
//
// Modos:
//   · Interactivo (default): readline; escriba mensajes; "salir"/Ctrl-C para terminar.
//   · No-interactivo: pase mensajes como argv (cada arg es un turno). Ej.:
//       node src/oliver-gpt/run-demo.js "hola" "quiero 3 ventanas en Temuco" "confirmo"
//
// Requiere OPENAI_API_KEY en el entorno (Pass1/Pass2 llaman a OpenAI de verdad).
// Si falta, imprime instrucción clara y sale con código 1.
//
// NO cablea hooks de persistencia (saveLead / notifyMarcelo / persistSession):
// es solo el cerebro GPT + orquestación contra el Engine real. TODO F4.
//
// ESM, Node 18+.

import readline from 'node:readline';
import { handleTurn } from './agent.js';

// Carga .env si dotenv está disponible (el repo lo usa). Silencioso si no.
try {
  await import('dotenv/config');
} catch {
  /* dotenv opcional; si no está, se usan las env del proceso */
}

function fail(msg) {
  console.error(`\n[run-demo] ${msg}\n`);
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY) {
  fail(
    'Falta OPENAI_API_KEY.\n' +
      'Expórtela antes de correr el simulador, por ejemplo:\n' +
      '  PowerShell:  $env:OPENAI_API_KEY="sk-..."; node src/oliver-gpt/run-demo.js\n' +
      '  bash:        OPENAI_API_KEY=sk-... node src/oliver-gpt/run-demo.js\n' +
      'Opcional: AI_MODEL_OPENAI (default gpt-4o), ACTIVA_ENGINE_URL para el motor de cotización.'
  );
}

const SEP = '─'.repeat(60);

function printTurn(userText, out) {
  console.log(SEP);
  console.log(`👤 cliente: ${userText}`);

  if (out.toolCalls && out.toolCalls.length) {
    console.log(`\n[Pass1 tool_calls] (${out.toolCalls.length})`);
    for (const tc of out.toolCalls) {
      console.log(`  → ${tc.name}(${JSON.stringify(tc.input)})`);
    }
    console.log('\n[tool results]');
    for (const tc of out.toolCalls) {
      console.log(`  ← ${tc.name}: ${JSON.stringify(tc.result)}`);
    }
  } else {
    console.log('\n[Pass1 tool_calls] (ninguno)');
  }

  console.log(`\n[reply]\n🤖 Oliver: ${out.reply}`);
  if (out.state && out.state.comuna) {
    console.log(`\n(state.comuna = ${out.state.comuna}` +
      (out.state.confirmacion ? ', confirmacion = true)' : ')'));
  }
  console.log(SEP + '\n');
}

async function runNonInteractive(messages) {
  let history = [];
  let state = {};
  for (const userText of messages) {
    const out = await handleTurn({ history, userText, state, toolCtx: {} });
    printTurn(userText, out);
    history = out.history;
    state = out.state;
  }
}

async function runInteractive() {
  console.log('\nOliver GPT — simulador de consola. Escriba un mensaje y Enter.');
  console.log('Comandos: "salir" / "exit" para terminar.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let history = [];
  let state = {};

  const ask = () =>
    new Promise((resolve) => rl.question('👤 cliente> ', resolve));

  for (;;) {
    const userText = (await ask()).trim();
    if (!userText) continue;
    if (/^(salir|exit|quit)$/i.test(userText)) break;

    try {
      const out = await handleTurn({ history, userText, state, toolCtx: {} });
      printTurn(userText, out);
      history = out.history;
      state = out.state;
    } catch (err) {
      console.error(`[run-demo] Error en el turno: ${err.message}`);
    }
  }

  rl.close();
  console.log('\nHasta luego.\n');
}

const argMessages = process.argv.slice(2).filter(Boolean);

try {
  if (argMessages.length) {
    await runNonInteractive(argMessages);
  } else {
    await runInteractive();
  }
} catch (err) {
  fail(`Fallo inesperado: ${err.message}`);
}
