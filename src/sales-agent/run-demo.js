// run-demo.js — Harness de prueba en consola para Oliver v2
// NO envía nada por WhatsApp. Conversa con Haiku 4.5 desde la terminal.
//
// Uso:
//   $env:ANTHROPIC_API_KEY="sk-..."   # PowerShell
//   node src/sales-agent/run-demo.js
//
// Escribe mensajes como cliente. Comandos: /salir, /estado, /reset.

import readline from "node:readline";
import { handleTurn, MODEL_ID } from "./agent.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

// Stubs de los hooks de side-effects (en producción los provee el webhook).
const toolCtx = {
  telefono: "569DEMO0000",
  saveLead: async (lead) => {
    console.log("  ↳ [stub] guardar_lead_postgres:", JSON.stringify(lead));
    return { saved: true, id: "lead_demo" };
  },
  notifyMarcelo: async (payload) => {
    console.log("  ↳ [stub] notificar_marcelo:", JSON.stringify(payload));
  },
};

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Falta ANTHROPIC_API_KEY en el entorno.");
    process.exit(1);
  }

  console.log(`\n🪟 Oliver v2 (demo consola) — modelo: ${MODEL_ID}`);
  console.log("Escribe como cliente. /salir para terminar, /estado para ver tokens.\n");

  let history = [];
  const state = { fecha: new Date().toISOString().slice(0, 10), telefono: toolCtx.telefono };
  let lastUsage = null;

  while (true) {
    const userText = (await ask("Cliente> ")).trim();
    if (!userText) continue;
    if (userText === "/salir") break;
    if (userText === "/reset") { history = []; console.log("(historial reiniciado)\n"); continue; }
    if (userText === "/estado") { console.log("usage:", JSON.stringify(lastUsage), "\n"); continue; }

    try {
      const res = await handleTurn({ history, userText, state, toolCtx });
      history = res.history;
      lastUsage = res.usage;
      if (res.toolCalls.length) {
        for (const tc of res.toolCalls) {
          console.log(`  ↳ tool: ${tc.name}(${JSON.stringify(tc.input)}) → ${tc.result.ok ? "ok" : "ERROR"}`);
        }
      }
      console.log(`\nOliver> ${res.reply}\n`);
    } catch (err) {
      console.error("Error:", err?.message || err, "\n");
    }
  }

  rl.close();
}

main();
