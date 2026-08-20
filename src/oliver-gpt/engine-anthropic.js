// src/oliver-gpt/engine-anthropic.js
//
// CEREBRO CLAUDE — adaptador Anthropic con la MISMA interfaz que engine.js.
// Se activa SOLO cuando AI_PROVIDER=anthropic (engine.js hace el switch).
//
// Devuelve EXACTAMENTE las mismas formas que el motor OpenAI (orchestratorPass1/2),
// así agent.js / channel-agent.js / webhook.js NO cambian en nada:
//   pass1 -> { tool_calls, content, raw }   (tool_calls con forma OpenAI)
//   pass2 -> string
//
// Conversión OpenAI <-> Anthropic:
//   - tools:    {type:'function',function:{name,description,parameters}} -> {name,description,input_schema}
//   - mensajes: role:'tool' -> bloque tool_result dentro de un user;
//               assistant.tool_calls -> bloques tool_use
//   - respuesta: bloques tool_use de Claude -> tool_calls forma OpenAI ({id,function:{name,arguments}})
//
// Gotchas Sonnet 4.6 manejados acá:
//   - max_tokens OBLIGATORIO (se pasa siempre).
//   - system va APARTE (con caché de prompt para abaratar el prompt grande).
//   - SIN prefill de assistant: en pass2 se descarta un assistant final (evita 400).
//   - effort por defecto 'low' (rápido/barato para chat); AI_EFFORT='' lo desactiva.
//
// ESM, Node 18+.

import Anthropic from '@anthropic-ai/sdk';
// [2026-08-20] El reporte de costo se mudó a services/reporteCosto.js: lo comparten los DOS
// motores (acá y engine.js/GPT) y ahora avisa cuando no está configurado. La copia local
// solo servía a Anthropic y callaba para siempre. Ver el encabezado de ese archivo.
import { reportarCosto as reportarCostoCompartido } from '../../services/reporteCosto.js';

const MODEL = () => process.env.AI_MODEL_ANTHROPIC || 'claude-sonnet-4-6';
const EFFORT = () => (process.env.AI_EFFORT ?? 'medium').trim();   // [2026-06-21] default medium (low loopeaba/no encadenaba PDF); '' => no enviar
const CACHE_ON = () => (process.env.AI_CACHE ?? '1') !== '0';
// [2026-07-08] TTL del caché de prompt. Default '1h': antes era 5min (ephemeral), y como los
// clientes responden espaciado el caché se vencía entre mensajes → se re-pagaba el prompt entero
// (system+tools ~27K tokens). '1h' lo mantiene vivo entre respuestas. AI_CACHE_TTL=5m revierte.
const CACHE_TTL = () => (process.env.AI_CACHE_TTL || '1h').trim();

// Log del modelo REAL que devuelve la API (prueba dura de qué cerebro responde).
// Una vez por proceso para no ensuciar los logs. Aparece en Railway → Console.
let _modelLogged = false;
function logModelOnce(resp) {
  if (_modelLogged || !resp || !resp.model) return;
  console.log(`[engine-anthropic] cerebro activo (modelo real de la API): ${resp.model}`);
  _modelLogged = true;
}

// [2026-07-08] Log de USO por llamada → ver el ahorro del caché en vivo (Railway Console).
// cache_read alto = caché funcionando (se cobra 0.1x); cache_write = primera vez / caché vencido.
function logUsage(tag, resp) {
  const u = resp?.usage; if (!u) return;
  console.log(`[engine-anthropic] ${tag} tokens: in=${u.input_tokens || 0} out=${u.output_tokens || 0} cache_write=${u.cache_creation_input_tokens || 0} cache_read=${u.cache_read_input_tokens || 0}`);
  reportarCosto(tag, resp);
}

// ════════════════════════════════════════════════════════════════════════════
// [2026-07-28 · reescrito 2026-08-20] REPORTE DE COSTO — ahora en un módulo compartido
// ════════════════════════════════════════════════════════════════════════════
// La lógica vive en services/reporteCosto.js (12 tests). Acá queda solo el cableado de
// env vars. Se movió porque esta copia (a) solo cubría Anthropic, dejando fuera el
// respaldo GPT, y (b) hacía `return` mudo sin URL/token: 3 semanas sin una sola fila en
// ai_cost_tracking y nadie se enteró.
const COSTO_URL = () => (process.env.SALES_OS_URL || '').replace(/\/+$/, '');
const COSTO_TOKEN = () => process.env.SALES_OS_INGEST_TOKEN || '';
const COSTO_TIMEOUT_MS = Number(process.env.COSTO_REPORT_TIMEOUT_MS || 2500);

function reportarCosto(tag, resp) {
  reportarCostoCompartido(
    { modulo: `oliver_${tag}`, modelo: resp?.model || MODEL(), usage: resp?.usage, cacheTtl: CACHE_TTL() },
    { url: COSTO_URL(), token: COSTO_TOKEN(), timeoutMs: COSTO_TIMEOUT_MS },
  );
}

/* Cliente Anthropic singleton (lazy). Importar este módulo NO exige la API key:
 * el cliente se crea recién en el primer uso real (con AI_PROVIDER=anthropic). */
let _client = null;
export function getAnthropicClient() {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Falta ANTHROPIC_API_KEY en el entorno. Setéela antes de usar el motor Anthropic.');
  }
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3 });
  return _client;
}

/* ============================ Conversores (exportados para tests) ============================ */

// TOOL_DEFS (OpenAI) -> tools (Anthropic).
export function _toAnthropicTools(tools = []) {
  return (tools || [])
    .filter((t) => t && t.function && t.function.name)
    .map((t) => ({
      name: t.function.name,
      description: t.function.description || '',
      input_schema: t.function.parameters || { type: 'object', properties: {} },
    }));
}

// messages (OpenAI: user / assistant+tool_calls / tool) -> messages (Anthropic con bloques).
// Los tool_result consecutivos se fusionan en UN solo turno user (lo que espera Anthropic).
export function _toAnthropicMessages(messages = []) {
  const out = [];
  for (const m of messages) {
    if (!m) continue;
    if (m.role === 'user') {
      out.push({ role: 'user', content: typeof m.content === 'string' ? m.content : (m.content || '') });
    } else if (m.role === 'assistant') {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: String(m.content) });
      for (const tc of (m.tool_calls || [])) {
        let input = {};
        try { input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { input = {}; }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function?.name, input });
      }
      if (blocks.length) out.push({ role: 'assistant', content: blocks });
    } else if (m.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
      };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block);            // fusiona con el user de tool_results previo
      } else {
        out.push({ role: 'user', content: [block] });
      }
    }
  }
  return out;
}

// pass2 NO debe terminar en assistant (eso es prefill -> 400 en Sonnet 4.6).
function dropTrailingAssistant(msgs) {
  const copy = msgs.slice();
  while (copy.length && copy[copy.length - 1].role === 'assistant') copy.pop();
  return copy;
}

// Respuesta Anthropic de pass1 -> { tool_calls (forma OpenAI), content, raw }.
export function _mapPass1Response(resp) {
  const text = [];
  const tool_calls = [];
  for (const block of (resp?.content || [])) {
    if (block.type === 'text') text.push(block.text || '');
    else if (block.type === 'tool_use') {
      tool_calls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
      });
    }
  }
  return { tool_calls, content: text.join('').trim(), raw: resp };
}

function systemParam(system) {
  const s = String(system || '');
  if (!CACHE_ON()) return s;
  // El caché en el bloque system cubre el prefijo COMPLETO (orden API: tools → system → messages),
  // así que cachea tools + system juntos. Solo cambia el COBRO, no lo que Oliver lee/responde.
  const cc = { type: 'ephemeral' };
  // GUARD (abogado del diablo): SOLO '1h' es extensión válida (SDK/API: ttl ∈ '5m'|'1h').
  // Cualquier otro valor (typo, '5min', un número) NO se envía → cae al default 5min ephemeral.
  // Así un env mal escrito al revertir NUNCA tira 400 en producción; como mucho vuelve a 5min.
  if (CACHE_TTL() === '1h') cc.ttl = '1h';
  return [{ type: 'text', text: s, cache_control: cc }];
}

function maybeOutputConfig() {
  const e = EFFORT();
  return e ? { output_config: { effort: e } } : {};
}

/* ================================ Pass 1 / Pass 2 ================================ */

export async function anthropicPass1({ system, messages = [], tools = [], _client } = {}) {
  const client = _client || getAnthropicClient();
  const resp = await client.messages.create({
    model: MODEL(),
    // [2026-07-14] 1800 -> 4096 (env OLIVER_PASS1_MAX_TOKENS): la planilla de 15 filas del 13-jul
    // choco el tope 3 veces (out=1800 exacto) — pass1 emite ~15 tool_use de calcular_cotizacion en
    // una pasada y el corte a mitad del JSON deja input={} -> cotizacion con filas PERDIDAS en
    // silencio. Mismo fix ya probado en index.js:2120/2342 ("900/500 truncaba tablas de 18 filas").
    // max_tokens es TECHO, no gasto: solo se paga lo generado. // [2026-06-21] subido de 1000.
    max_tokens: Number(process.env.OLIVER_PASS1_MAX_TOKENS) > 0 ? Number(process.env.OLIVER_PASS1_MAX_TOKENS) : 4096,
    system: systemParam(system),
    tools: _toAnthropicTools(tools),
    messages: _toAnthropicMessages(messages),
    ...maybeOutputConfig(),
  });
  logModelOnce(resp);
  logUsage('pass1', resp);
  if (resp?.stop_reason === 'max_tokens') console.warn('[engine-anthropic] pass1 truncado (max_tokens)');
  if (resp?.stop_reason === 'refusal') console.warn('[engine-anthropic] pass1 refusal — revisar stop_details');
  return _mapPass1Response(resp);
}

export async function anthropicPass2({ system, messages = [], _client } = {}) {
  const client = _client || getAnthropicClient();
  const conv = dropTrailingAssistant(_toAnthropicMessages(messages));
  const resp = await client.messages.create({
    model: MODEL(),
    max_tokens: 900, // [2026-06-21] subido de 650: evitar cortar respuestas/entrega de propuesta
    system: systemParam(system),
    messages: conv,
    ...maybeOutputConfig(),
  });
  logModelOnce(resp);
  logUsage('pass2', resp);
  if (resp?.stop_reason === 'max_tokens') console.warn('[engine-anthropic] pass2 truncado (max_tokens)');
  let out = '';
  for (const block of (resp?.content || [])) if (block.type === 'text') out += block.text || '';
  return out.trim();
}

export default { anthropicPass1, anthropicPass2, getAnthropicClient };
