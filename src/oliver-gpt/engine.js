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

/* =========================================================================
 * RETRY/BACKOFF ante rate-limit (429) y errores transitorios (5xx).
 * [2026-06-14] En chat asíncrono (IG/WhatsApp) esperar unos segundos y reintentar
 * es MUCHO mejor que cortar el turno y mandar el fallback genérico (que pierde la
 * cotización y el contexto). OpenAI dice "try again in Xs"; lo respetamos.
 * OJO: esto es paliativo — el fix de raíz es subir el tier de OpenAI (TPM 30k es muy
 * bajo); bajo carga sostenida el retry no alcanza.
 * ========================================================================= */
const RETRY_TRIES = Number(process.env.OPENAI_RETRY_TRIES) || 2;        // intento inicial + (tries-1) reintentos
const RETRY_MAX_WAIT_MS = Number(process.env.OPENAI_RETRY_MAX_WAIT_MS) || 35000;

// Extrae cuánto esperar: header retry-after (seg) o el "try again in 28.958s" del mensaje.
export function parseRetryAfterMs(err) {
  const ra = err?.headers?.['retry-after'] || err?.response?.headers?.['retry-after'];
  if (ra && Number(ra) > 0) return Number(ra) * 1000;
  const m = String(err?.message || '').match(/try again in ([\d.]+)\s*(ms|s)\b/i);
  if (m) {
    const n = parseFloat(m[1]);
    return m[2].toLowerCase() === 'ms' ? n : n * 1000;
  }
  return 0;
}

export async function withRetry(fn, label = 'openai') {
  let lastErr;
  for (let attempt = 1; attempt <= RETRY_TRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.status || err?.response?.status;
      const retriable = status === 429 || status === 500 || status === 502 || status === 503;
      if (!retriable || attempt === RETRY_TRIES) throw err;
      let waitMs = parseRetryAfterMs(err);
      if (!(waitMs > 0)) waitMs = 1000 * 2 ** (attempt - 1); // backoff exponencial si no hay sugerencia
      waitMs = Math.min(waitMs + 600, RETRY_MAX_WAIT_MS);    // +600ms de colchón para limpiar la ventana
      console.warn(`[engine] ${label} ${status} — reintento ${attempt}/${RETRY_TRIES - 1} en ${Math.round(waitMs / 1000)}s`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
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
  const r = await withRetry(() => client.chat.completions.create({
    model: MODEL(),
    messages: [{ role: 'system', content: system }, ...messages],
    tools,
    tool_choice: 'auto',
    parallel_tool_calls: false,
    temperature: 0.3,
    max_tokens: 1000,   // [FIX 2026-06-19 COB-04] 500 truncaba el JSON de tool_call (PDF con varios items) → input={} silencioso → PDF no se generaba
  }), 'pass1');
  const choice1 = r.choices?.[0] || {};
  if (choice1.finish_reason === 'length') console.warn('[engine] pass1 truncado (max_tokens) — el JSON de tool_call puede venir incompleto');
  const msg = choice1.message || {};
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
  const r = await withRetry(() => client.chat.completions.create({
    model: MODEL(),
    messages: [{ role: 'system', content: system }, ...messages],
    temperature: 0.4,
    max_tokens: 650,   // [FIX 2026-06-19 CLI-05] 350 cortaba respuestas multi-ítem + disclaimer + precio a mitad de frase
  }), 'pass2');
  const choice2 = r.choices?.[0] || {};
  if (choice2.finish_reason === 'length') console.warn('[engine] pass2 truncado (max_tokens) — respuesta al cliente puede quedar cortada');
  return (choice2.message?.content || '').trim();
}

export default { getClient, orchestratorPass1, orchestratorPass2 };
