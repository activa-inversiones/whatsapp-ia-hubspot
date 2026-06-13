// src/oliver-gpt/sim-scenarios.mjs
// ════════════════════════════════════════════════════════════════════════════
// ARNÉS DE SIMULACIÓN — 100 escenarios contra el CEREBRO REAL de Oliver.
//
// Qué hace:
//   · Corre N escenarios (default 100) de conversaciones de cliente, multi-turno,
//     llamando handleTurn() — el MISMO cerebro que atiende en producción.
//   · El LLM PIENSA de verdad (OpenAI real) → atrapa bugs de criterio como
//     "medidas fantasma", negar la dirección, no escalar, etc.
//   · TODO lo demás está MOCKEADO vía toolCtx.runTool: ni BD, ni motor, ni
//     sales-os, ni WhatsApp, ni Zoho, ni correlativo ISO. NADA persiste.
//   · No cablea persistSession/saveLead/notifyMarcelo → cero escritura.
//
// Requiere: OPENAI_API_KEY en el entorno (o en temp-wa/.env, que está gitignored).
// Uso:
//   node src/oliver-gpt/sim-scenarios.mjs           # 100 escenarios
//   node src/oliver-gpt/sim-scenarios.mjs 20        # primeros 20 (prueba rápida)
//   node src/oliver-gpt/sim-scenarios.mjs 100 8     # 100 escenarios, concurrencia 8
//
// Salida: resumen en consola + reporte en src/oliver-gpt/sim-report.md (archivo
// local, NO la BD).
//
// ESM, Node 18+.
// ════════════════════════════════════════════════════════════════════════════

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

try { await import('dotenv/config'); } catch { /* dotenv opcional */ }

const { handleTurn } = await import('./agent.js');

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.OPENAI_API_KEY) {
  console.error('\n[sim] Falta OPENAI_API_KEY.');
  console.error('  PowerShell:  $env:OPENAI_API_KEY="sk-..."; node src/oliver-gpt/sim-scenarios.mjs');
  console.error('  o ponla en temp-wa/.env (que está en .gitignore, no se sube).\n');
  process.exit(1);
}

// ── MOCK de runTool: deterministaa, sin red, sin BD, sin side-effects ────────
function mockRunTool(name, input = {}) {
  switch (name) {
    case 'listar_vidrios':
      return { ok: true, vidrios: [
        { glass_id: 'dvh_4_6_4', nombre: 'Termopanel DVH 4/6/4' },
        { glass_id: 'monolitico_4', nombre: 'Monolítico 4mm' },
      ] };
    case 'calcular_cotizacion': {
      const w = Number(input.ancho_mm) || 1000;
      const h = Number(input.alto_mm) || 1000;
      const qty = Math.max(1, Number(input.cantidad) || 1);
      const m2 = (w * h) / 1e6;
      const unit = Math.max(45000, Math.round(m2 * 85000)); // NETO simulado
      return { ok: true, unit_price: unit, total_neto: unit * qty, cantidad: qty,
        _nota_precio: 'unit_price es NETO (simulado). Pásalo tal cual a generar_pdf_cotizacion.' };
    }
    case 'calcular_por_area': {
      const m2 = Number(input.area_m2) || 1;
      const unit = Math.max(45000, Math.round(m2 * 85000));
      return { ok: true, unit_price: unit, total_neto: unit, cantidad: 1 };
    }
    case 'generar_pdf_cotizacion':
      // Fake: NO quema correlativo ISO, NO envía WhatsApp, NO toca sales-os.
      return { ok: true, quote_number: 'SIM-0000', pdf_url: '(simulado)', enviado: true };
    case 'notificar_marcelo':
      return { ok: true, notificado: true };
    case 'send_media':
    case 'generar_link_simulador':
    case 'generar_link_aprobacion':
    case 'guardar_lead':
      return { ok: true };
    default:
      return { ok: true, _mock: name };
  }
}

// ── Generación de escenarios ─────────────────────────────────────────────────
const PRODUCTOS = ['ventana corredera de PVC', 'ventana fija de PVC', 'ventana termopanel',
  'mampara de baño', 'puerta termopanel'];
const MEDIDAS = ['1500x1000', '1200x1100', '800x600', '2000x1200', '120x100 cm'];
const COLORES = ['blanco', 'nogal', 'grafito', 'negro'];
const COMUNAS = ['Temuco', 'Padre Las Casas', 'Villarrica', 'Pucón', 'Vilcún'];
const NOMBRES = ['Pedro', 'María', 'Jorge', 'Carla', 'Luis', 'Ana'];

function pick(arr, i) { return arr[i % arr.length]; }

const scenarios = [];

// (A) HAPPY PATH paramétrico — debe llegar a cotizar sin alucinar medidas.
for (let i = 0; scenarios.length < 70; i++) {
  const prod = pick(PRODUCTOS, i);
  const med = pick(MEDIDAS, i + 1);
  const col = pick(COLORES, i + 2);
  const com = pick(COMUNAS, i + 3);
  const nom = pick(NOMBRES, i + 4);
  const qty = (i % 8) + 1;
  scenarios.push({
    id: `happy-${i + 1}`, cat: 'happy',
    turns: [
      `Hola, quiero cotizar ${prod} en ${com}`,
      `Necesito ${qty}`,
      `Las medidas son ${med}`,
      `Color ${col}`,
      `Mi nombre es ${nom}`,
      `Confirmo, genérame la cotización`,
    ],
  });
}

// (B) MEDIDAS FANTASMA — el cliente NUNCA da números. El bot NO debe confirmarlas.
const SIN_MEDIDA = [
  'No tengo claro las medidas', 'No sé las medidas', 'Déjame revisar y te aviso',
  'No las tengo a mano', 'Todavía no las mido', 'Ni idea de cuánto miden',
  'Las tengo que ver con el maestro', 'No estoy seguro de las medidas',
  'Mañana las mido', 'No cacho las medidas exactas',
];
for (const txt of SIN_MEDIDA) {
  scenarios.push({
    id: `sinmedida-${scenarios.length}`, cat: 'no_measures',
    turns: ['Hola, quiero cotizar ventanas de PVC', 'Necesito 3', txt, 'Color blanco'],
  });
}

// (C) DIRECCIÓN — el cliente pregunta dónde están. NO debe negarse en seco.
const DIRECCION = [
  '¿Cuál es su dirección en Temuco?', '¿Dónde están ubicados?',
  '¿Tienen local para ir a ver?', '¿Puedo pasar a la tienda?', '¿Dónde queda la oficina?',
];
for (const txt of DIRECCION) {
  scenarios.push({ id: `direccion-${scenarios.length}`, cat: 'address',
    turns: ['Hola, me interesan sus ventanas', txt] });
}

// (D) PIDE HUMANO — debe escalar / ofrecer handoff, no quedar en vago.
const HUMANO = [
  'Quiero hablar con un vendedor', 'Necesito que me llame una persona',
  'Prefiero hablar con alguien del equipo', '¿Me puede llamar Marcelo?',
  'Quiero atención humana',
];
for (const txt of HUMANO) {
  scenarios.push({ id: `humano-${scenarios.length}`, cat: 'human',
    turns: ['Hola', txt] });
}

// (E) MEDIDAS FUERA DE RANGO — debe pedir confirmación, no cotizar a ciegas.
const RANGO = ['Quiero una ventana de 50x50', 'Necesito una de 12000x8000',
  'Una ventanita de 10x10', 'Mide 9 metros por 9 metros', 'Es de 5x5'];
for (const txt of RANGO) {
  scenarios.push({ id: `rango-${scenarios.length}`, cat: 'range',
    turns: ['Hola, quiero cotizar una ventana de PVC', txt] });
}

// (F) OBJECIÓN DE PRECIO / COMPETENCIA — debe diferenciar, no capitular.
const PRECIO = ['Vi más barato en Sodimac', 'DVP me cotizó menos',
  'Está muy caro', 'En Euromas me sale la mitad', 'Me dijeron que ustedes son caros'];
for (const txt of PRECIO) {
  scenarios.push({ id: `precio-${scenarios.length}`, cat: 'competitor',
    turns: ['Hola, cotizo 4 ventanas 1200x1000 blanco en Temuco', txt] });
}

// ── Aserciones por categoría (heurísticas sobre la salida REAL del LLM) ───────
function joinReplies(replies) { return replies.join(' \n ').toLowerCase(); }

const ASSERTIONS = {
  happy: (s) => {
    const calc = s.toolsUsed.includes('calcular_cotizacion') || s.toolsUsed.includes('calcular_por_area');
    if (!calc) return 'no llamó a calcular_cotizacion (no llegó a cotizar)';
    return checkNoFantasma(s, /* clienteDioMedidas */ true);
  },
  no_measures: (s) => {
    if (s.toolsUsed.includes('generar_pdf_cotizacion')) return 'generó PDF SIN que el cliente diera medidas';
    const t = joinReplies(s.replies);
    if (/recib[ií][^.]{0,20}medidas/.test(t)) return 'dijo "recibí tus medidas" cuando el cliente NO dio ninguna (MEDIDAS FANTASMA)';
    if (/\b\d{3,4}\s*[x×]\s*\d{3,4}\b/.test(t)) return 'inventó una medida numérica que el cliente nunca dio';
    return null; // ok
  },
  address: (s) => {
    const t = joinReplies(s.replies);
    if (/no (proporcion|damos|entrego|doy|comparto)[^.]{0,30}direcci/.test(t)) return 'negó la dirección en seco';
    if (/no (podemos|puedo)[^.]{0,30}(direcci|ubicaci)/.test(t)) return 'negó la ubicación';
    return null;
  },
  human: (s) => {
    if (s.toolsUsed.includes('notificar_marcelo')) return null;
    const t = joinReplies(s.replies);
    if (/marcelo|te (paso|comunico|deriv)|especialista|te (llam|contact)/.test(t)) return null;
    return 'no escaló ni ofreció contacto humano';
  },
  range: (s) => {
    const t = joinReplies(s.replies);
    if (/confirm|seguro|verific|fuera de rango|muy (grande|grand|chic|peque)|revisar la medida|esa medida/.test(t)) return null;
    if (s.toolsUsed.includes('generar_pdf_cotizacion')) return 'cotizó una medida imposible sin chequear';
    return null; // tolerante: si no cotizó, ok
  },
  competitor: (s) => {
    const t = joinReplies(s.replies);
    if (/garant|instalaci|minvu|calidad|15 d[ií]as|valor|diferenci|incluye/.test(t)) return null;
    return 'no diferenció por valor frente a la competencia';
  },
};

function checkNoFantasma(s) {
  // Para happy: el cliente SÍ dio medidas, así que "recibí tus medidas" es válido.
  return null;
}

// ── Runner ────────────────────────────────────────────────────────────────────
async function runScenario(sc) {
  let history = [];
  let state = {};
  const replies = [];
  const toolsUsed = [];
  const toolCtx = { runTool: (name, input) => { toolsUsed.push(name); return mockRunTool(name, input); } };
  // NO se pasan persistSession/saveLead/notifyMarcelo → nada persiste.
  for (const userText of sc.turns) {
    const out = await handleTurn({ history, userText, state, toolCtx });
    replies.push(out.reply || '');
    history = out.history;
    state = out.state;
  }
  const ctx = { ...sc, replies, toolsUsed };
  const fail = ASSERTIONS[sc.cat] ? ASSERTIONS[sc.cat](ctx) : null;
  return { id: sc.id, cat: sc.cat, pass: !fail, reason: fail, replies, toolsUsed };
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try { out[i] = await fn(items[i], i); }
      catch (e) { out[i] = { id: items[i].id, cat: items[i].cat, pass: false, reason: 'ERROR: ' + e.message, replies: [], toolsUsed: [] }; }
      process.stdout.write(out[i].pass ? '.' : 'X');
    }
  }
  await Promise.all(Array.from({ length: size }, worker));
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const N = Math.min(scenarios.length, parseInt(process.argv[2] || '100', 10) || 100);
const CONC = parseInt(process.argv[3] || '6', 10) || 6;
const subset = scenarios.slice(0, N);

console.log(`\n[sim] Corriendo ${subset.length} escenarios contra el cerebro REAL (conc=${CONC}). Nada toca la BD.\n`);
const t0 = Date.now();
const results = await pool(subset, CONC, runScenario);
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const byCat = {};
for (const r of results) {
  byCat[r.cat] = byCat[r.cat] || { total: 0, pass: 0, fails: [] };
  byCat[r.cat].total++;
  if (r.pass) byCat[r.cat].pass++; else byCat[r.cat].fails.push(r);
}
const passed = results.filter(r => r.pass).length;

console.log(`\n\n══════ RESUMEN (${secs}s) ══════`);
console.log(`TOTAL: ${passed}/${results.length} OK\n`);
for (const [cat, d] of Object.entries(byCat)) {
  const icon = d.pass === d.total ? '✅' : '🔴';
  console.log(`${icon} ${cat}: ${d.pass}/${d.total}`);
}
const allFails = results.filter(r => !r.pass);
if (allFails.length) {
  console.log(`\n── FALLAS (${allFails.length}) ──`);
  for (const f of allFails.slice(0, 30)) {
    console.log(`  [${f.cat}] ${f.id}: ${f.reason}`);
    if (f.replies.length) console.log(`     último reply: "${(f.replies.at(-1) || '').slice(0, 120)}"`);
  }
}

// Reporte a archivo local (NO la BD)
let md = `# Reporte simulación Oliver — ${passed}/${results.length} OK (${secs}s)\n\n`;
for (const [cat, d] of Object.entries(byCat)) md += `- ${d.pass === d.total ? '✅' : '🔴'} **${cat}**: ${d.pass}/${d.total}\n`;
md += `\n## Fallas\n\n`;
for (const f of allFails) {
  md += `### [${f.cat}] ${f.id}\n- **Motivo:** ${f.reason}\n- **Tools:** ${f.toolsUsed.join(', ') || '(ninguna)'}\n- **Replies:**\n`;
  f.replies.forEach((r, i) => { md += `  ${i + 1}. ${r.replace(/\n/g, ' ')}\n`; });
  md += `\n`;
}
const reportPath = join(__dirname, 'sim-report.md');
writeFileSync(reportPath, md, 'utf8');
console.log(`\n📄 Reporte completo: ${reportPath}\n`);
process.exit(allFails.length ? 1 : 0);
