// src/oliver-gpt/engine.js
//
// CEREBRO GPT — Cliente OpenAI singleton + orquestación 2-pass (plan 2.1).
//
// Porta el patrón de orchestratorPass1 / orchestratorPass2 de index.js
// (~líneas 1920-1992) a un módulo aislado y reutilizable para Oliver GPT.
// NO toca producción: es una pieza nueva, sin estado de sesión propio.
//
// Pass1: GPT decide acciones (tool calling). temp 0.3, max_tokens 500,
//        tool_choice:'auto', parallel_tool_calls:false.
// Pass2: GPT genera el texto final al cliente. temp 0.4, max_tokens 350.
//
// Modelo: process.env.AI_MODEL_OPENAI || 'gpt-4o'.
// API key: process.env.OPENAI_API_KEY.
//
// ESM, Node 18+.

import OpenAI from 'openai';

const MODEL = () => process.env.AI_MODEL_OPENAI || 'gpt-4o';

/* =========================================================================
 * Cliente OpenAI singleton (lazy). Se crea una sola vez al primer uso, así
 * importar este módulo no exige tener OPENAI_API_KEY presente (los tests
 * herméticos inyectan un fake y nunca tocan esta función).
 * ========================================================================= */
let _client = null;

/**
 * getClient() — Devuelve el cliente OpenAI singleton. Lo crea perezosamente.
 * @returns {OpenAI}
 */
export function getClient() {
  if (_client) return _client;
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'Falta OPENAI_API_KEY en el entorno. Expórtela antes de usar el motor OpenAI.'
    );
  }
  _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

/**
 * orchestratorPass1 — Decisión de acciones (tool calling).
 * @param {object} args
 * @param {string} args.system - System prompt (string).
 * @param {Array}  args.messages - Mensajes de la conversación (sin el system).
 * @param {Array}  args.tools - Definiciones de tools (formato OpenAI).
 * @returns {Promise<{tool_calls:Array, content:string, raw:object}>}
 */
export async function orchestratorPass1({ system, messages = [], tools = [] }) {
  const client = getClient();
  const r = await client.chat.completions.create({
    model: MODEL(),
    messages: [{ role: 'system', content: system }, ...messages],
    tools,
    tool_choice: 'auto',
    parallel_tool_calls: false,
    temperature: 0.3,
    max_tokens: 500,
  });
  const msg = r.choices?.[0]?.message || {};
  return {
    tool_calls: msg.tool_calls || [],
    content: msg.content || '',
    raw: msg,
  };
}

/**
 * orchestratorPass2 — Texto final para el cliente (sin tools).
 * @param {object} args
 * @param {string} args.system - System prompt (string).
 * @param {Array}  args.messages - Mensajes (incluye tool results de Pass1).
 * @returns {Promise<string>}
 */
export async function orchestratorPass2({ system, messages = [] }) {
  const client = getClient();
  const r = await client.chat.completions.create({
    model: MODEL(),
    messages: [{ role: 'system', content: system }, ...messages],
    temperature: 0.4,
    max_tokens: 350,
  });
  return (r.choices?.[0]?.message?.content || '').trim();
}

export default { getClient, orchestratorPass1, orchestratorPass2 };
