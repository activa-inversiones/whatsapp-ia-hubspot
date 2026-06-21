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

const MODEL = () => process.env.AI_MODEL_ANTHROPIC || 'claude-sonnet-4-6';
const EFFORT = () => (process.env.AI_EFFORT ?? 'medium').trim();   // [2026-06-21] default medium (low loopeaba/no encadenaba PDF); '' => no enviar
const CACHE_ON = () => (process.env.AI_CACHE ?? '1') !== '0';

// Log del modelo REAL que devuelve la API (prueba dura de qué cerebro responde).
// Una vez por proceso para no ensuciar los logs. Aparece en Railway → Console.
let _modelLogged = false;
function logModelOnce(resp) {
  if (_modelLogged || !resp || !resp.model) return;
  console.log(`[engine-anthropic] cerebro activo (modelo real de la API): ${resp.model}`);
  _modelLogged = true;
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
  return [{ type: 'text', text: s, cache_control: { type: 'ephemeral' } }];
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
    max_tokens: 1800, // [2026-06-21] subido de 1000: 1000 truncaba el JSON del tool -> input={} -> loop/cotiza vacio
    system: systemParam(system),
    tools: _toAnthropicTools(tools),
    messages: _toAnthropicMessages(messages),
    ...maybeOutputConfig(),
  });
  logModelOnce(resp);
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
  if (resp?.stop_reason === 'max_tokens') console.warn('[engine-anthropic] pass2 truncado (max_tokens)');
  let out = '';
  for (const block of (resp?.content || [])) if (block.type === 'text') out += block.text || '';
  return out.trim();
}

export default { anthropicPass1, anthropicPass2, getAnthropicClient };
