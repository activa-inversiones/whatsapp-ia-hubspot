// src/oliver-gpt/engine.js
//
// CEREBRO GPT — Cliente OpenAI singleton + orquestación 2-pass (plan 2.1).
//
// Porta el patrón de orchestratorPass1 / orchestratorPass2 de index.js
// (~líneas 1920-1992) a un módulo aislado y reutilizable para Oliver GPT.
// NO toca producción: es una pieza nueva, sin estado de sesión propio.
//
// Pass1: GPT decide acciones (tool calling). temp 0.3, max_tokens 4096,
//        tool_choice:'auto', parallel_tool_calls:TRUE (ver el porque en el propio flag).
// Pass2: GPT genera el texto final al cliente. temp 0.4, max_tokens 900.
//
// Modelo: process.env.AI_MODEL_OPENAI || 'gpt-4o'.
// API key: process.env.OPENAI_API_KEY.
//
// ESM, Node 18+.

import OpenAI from 'openai';
import { anthropicPass1, anthropicPass2 } from './engine-anthropic.js';
import { reportarCosto as reportarCostoCompartido } from '../../services/reporteCosto.js';

const MODEL = () => process.env.AI_MODEL_OPENAI || 'gpt-4o';

// [2026-08-20] REPORTE DE COSTO DEL RESPALDO GPT — antes NO existía.
// openaiPass1/openaiPass2 descartaban `r.usage` entero, así que el camino de GPT no dejaba
// rastro en ai_cost_tracking. Y GPT no es el camino raro: es el RESPALDO que entra cuando se
// agotan los tokens de Anthropic, o sea justo el momento que más importa medir. Verificado
// contra la BD viva el 19-ago: 0 filas de Oliver, de los dos motores.
// Mismo módulo compartido y misma regla dura que Anthropic: fire-and-forget, nunca puede
// tumbar una conversación.
const COSTO_URL_GPT = () => (process.env.SALES_OS_URL || '').replace(/\/+$/, '');
const COSTO_TOKEN_GPT = () => process.env.SALES_OS_INGEST_TOKEN || '';

function reportarCostoOpenAI(tag, r) {
  reportarCostoCompartido(
    // [2026-08-20] Se tarifa con el ALIAS CONFIGURADO, no con el eco de la API.
    // El eco puede traer una version con fecha (ej '-2026-08-01') que NO esta en la tabla
    // de precios del sales-os, y ahi el precio cae a un fallback MUDO: numero equivocado sin
    // una sola alerta. El modelo real viaja aparte, en `modelo_api`, para trazabilidad.
    { modulo: `oliver_${tag}_gpt`, modelo: MODEL(), modeloApi: r?.model || null,
      proveedor: 'openai', usage: r?.usage, cacheTtl: null },
    { url: COSTO_URL_GPT(), token: COSTO_TOKEN_GPT(), timeoutMs: Number(process.env.COSTO_REPORT_TIMEOUT_MS || 2500) },
  );
}

// [2026-06-19] SWITCH DE PROVEEDOR DEL CEREBRO.
//   AI_PROVIDER=anthropic  → Claude Sonnet 4.6 (vía engine-anthropic.js, misma interfaz).
//   sin setear / cualquier otro valor → OpenAI (comportamiento actual, sin cambios).
// REVERSIBLE: borrar/cambiar AI_PROVIDER en Railway → vuelve GPT-4o al instante.
const useAnthropic = () => (process.env.AI_PROVIDER || '').toLowerCase() === 'anthropic';

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

/* =========================================================================
 * FALLBACK ENTRE PROVEEDORES [2026-07-11]
 * Oliver le responde a clientes reales. Si el proveedor primario (el de AI_PROVIDER)
 * falla de forma persistente — el caso típico: se acabó el saldo de la API key —, en
 * vez de cortar la venta y mandar el fallback genérico, se reintenta con el OTRO proveedor.
 * Así un saldo en cero en Anthropic (o en OpenAI) NUNCA deja a un cliente sin respuesta real.
 *   - Solo se activa cuando el primario THROWS, o sea tras sus propios reintentos
 *     (OpenAI: withRetry; Anthropic SDK: maxRetries:3) → falla real, no un blip transitorio.
 *   - Si el secundario no está configurado (falta su API key) o también falla → se relanza el
 *     error original y arriba actúa el "fallback amable" de siempre. NUNCA empeora lo actual.
 *   - Kill-switch: AI_FALLBACK=0 en Railway lo desactiva (vuelve al modo single-provider).
 * ========================================================================= */
const FALLBACK_ON = () => (process.env.AI_FALLBACK ?? '1') !== '0';

/* [2026-08-08] QUIÉN CONTESTÓ EL ÚLTIMO TURNO.
 *
 * El dueño preguntó si Oliver podía estar corriendo con GPT porque a Claude se le acabó el
 * saldo. NO SE PODÍA RESPONDER: ningún registro decía qué modelo respondió cada turno. Se
 * detectó un comportamiento degradado en producción (el mismo PDF enviado 3 veces) y no
 * había forma de saber si era el modelo o el código.
 *
 * Esto lo cierra. Se guarda el proveedor de la ÚLTIMA llamada y su motivo, para que el
 * webhook lo persista junto al mensaje. Si el respaldo está actuando, se ve en la ficha del
 * cliente en vez de descubrirse cuando alguien se queja.
 *
 * ⚠️ Es un valor global: con turnos concurrentes de clientes distintos podría mezclarse.
 * Se lee INMEDIATAMENTE después del turno, que es cuando vale, y se acepta ese margen a
 * propósito — la alternativa era enhebrar el dato por seis funciones para un log. Si algún
 * día hace falta exactitud por turno, se pasa a un contexto por request.
 */
let _ultimoProveedor = { proveedor: null, fue_respaldo: false, motivo: null, at: null };

/** @returns {{proveedor:string|null, fue_respaldo:boolean, motivo:string|null, at:number|null}} */
export function ultimoProveedor() { return { ..._ultimoProveedor }; }

// Ejecuta el proveedor primario; si lanza, reintenta con el secundario. Exportada para tests.
export async function runWithFallback(label, primaryIsAnthropic, anthropicFn, openaiFn) {
  const primary = primaryIsAnthropic ? 'anthropic' : 'openai';
  const secondary = primaryIsAnthropic ? 'openai' : 'anthropic';
  try {
    const r = await (primaryIsAnthropic ? anthropicFn() : openaiFn());
    _ultimoProveedor = { proveedor: primary, fue_respaldo: false, motivo: null, at: Date.now() };
    return r;
  } catch (primaryErr) {
    if (!FALLBACK_ON()) throw primaryErr;
    const status = primaryErr?.status || primaryErr?.response?.status || '';
    console.error(`[engine] ${label} proveedor PRIMARIO ${primary} falló (${status} ${primaryErr?.message || primaryErr}). Fallback → ${secondary}.`);
    try {
      const r = await (primaryIsAnthropic ? openaiFn() : anthropicFn());
      // Queda registrado POR QUÉ entró el respaldo: sin el motivo, "contestó GPT" no dice
      // si fue por saldo, por un 500 de Anthropic o por un prompt inválido — y cada uno
      // se arregla distinto.
      _ultimoProveedor = {
        proveedor: secondary,
        fue_respaldo: true,
        motivo: `${primary} falló${status ? ` (${status})` : ''}: ${String(primaryErr?.message || primaryErr).slice(0, 120)}`,
        at: Date.now(),
      };
      console.warn(`[engine] ${label} respondido por FALLBACK ${secondary} — el cliente NO se quedó sin respuesta.`);
      return r;
    } catch (secondaryErr) {
      console.error(`[engine] ${label} fallback ${secondary} también falló (${secondaryErr?.message || secondaryErr}). Se relanza el error primario.`);
      throw primaryErr;
    }
  }
}

// --- Motor OpenAI (interno; el switch de proveedor + fallback lo hacen los orchestrator*) ---
async function openaiPass1({ system, messages = [], tools = [] }) {
  const client = getClient();
  const r = await withRetry(() => client.chat.completions.create({
    model: MODEL(),
    messages: [{ role: 'system', content: system }, ...messages],
    tools,
    tool_choice: 'auto',
    // 🔴 [2026-08-20] ERA `false`, Y POR ESO GPT NO COTIZABA COMO CLAUDE.
    // Con `false`, OpenAI emite UNA sola tool por pasada. El bucle de agent.js tiene tope de
    // MAX_TOOL_ITERATIONS (6), asi que GPT podia hacer 6 llamadas por turno COMO MAXIMO.
    // La REGLA #13 exige calcular_cotizacion (UNA POR VENTANA) + generar_pdf_cotizacion EN EL
    // MISMO TURNO: con 5 ventanas son 6 llamadas justas, y con 6 ventanas el bucle se agota
    // ANTES del PDF. Claude no tiene el problema — emite ~15 tool_use en una sola pasada
    // (ver el comentario de engine-anthropic.js:185).
    // MEDIDO sobre 60 dias: Claude entrego el PDF en el 7,42% de sus turnos y GPT en el
    // 3,35% — menos de la mitad. El dueno lo noto sin ver el codigo: "no cotiza como claude".
    // ⚠️ Esto YA estaba diagnosticado en _oliver-review.md y se arreglo A MEDIAS: se subio
    // MAX_TOOL_ITERATIONS de 3 a 6 y se dejo este flag en false. Subir el tope no alcanza
    // cuando el problema es que solo entra una tool por vuelta.
    parallel_tool_calls: true,
    temperature: 0.3,
    // [2026-07-14] 1000 -> 4096 (env OLIVER_PASS1_MAX_TOKENS): mismo fix que engine-anthropic
    // pass1 — este es el camino de RESPALDO (GPT) cuando se agotan los tokens de Anthropic;
    // con planillas de 15+ filas el tope de 1000 truncaba peor que el de Claude.
    // [FIX 2026-06-19 COB-04] 500 truncaba el JSON de tool_call → input={} silencioso.
    max_tokens: Number(process.env.OLIVER_PASS1_MAX_TOKENS) > 0 ? Number(process.env.OLIVER_PASS1_MAX_TOKENS) : 4096,
  }), 'pass1');
  reportarCostoOpenAI('pass1', r);
  const choice1 = r.choices?.[0] || {};
  if (choice1.finish_reason === 'length') console.warn('[engine] pass1 truncado (max_tokens) — el JSON de tool_call puede venir incompleto');
  const msg = choice1.message || {};
  return {
    tool_calls: msg.tool_calls || [],
    content: msg.content || '',
    raw: msg,
  };
}

async function openaiPass2({ system, messages = [] }) {
  const client = getClient();
  const r = await withRetry(() => client.chat.completions.create({
    model: MODEL(),
    messages: [{ role: 'system', content: system }, ...messages],
    temperature: 0.4,
    // [2026-08-20] 650 -> 900, igualando a Anthropic. El lado de Claude ya se habia subido a
    // 900 el 21-jun "para evitar cortar respuestas/entrega de propuesta" y este lado quedo
    // atras. MEDIDO: el 14,13% de los mensajes de GPT llegan a 620+ chars (rozando el tope de
    // 650) contra el 0,38% de Claude — 37 veces mas. Se cortaba la entrega de la propuesta.
    max_tokens: Number(process.env.OLIVER_PASS2_MAX_TOKENS) > 0 ? Number(process.env.OLIVER_PASS2_MAX_TOKENS) : 900,
  }), 'pass2');
  reportarCostoOpenAI('pass2', r);
  const choice2 = r.choices?.[0] || {};
  if (choice2.finish_reason === 'length') console.warn('[engine] pass2 truncado (max_tokens) — respuesta al cliente puede quedar cortada');
  return (choice2.message?.content || '').trim();
}

/**
 * orchestratorPass1 — Decisión de acciones (tool calling). Proveedor por AI_PROVIDER + fallback.
 * @param {object} args
 * @param {string} args.system - System prompt (string).
 * @param {Array}  args.messages - Mensajes de la conversación (sin el system).
 * @param {Array}  args.tools - Definiciones de tools (formato OpenAI).
 * @returns {Promise<{tool_calls:Array, content:string, raw:object}>}
 */
export async function orchestratorPass1({ system, messages = [], tools = [] }) {
  return runWithFallback('pass1', useAnthropic(),
    () => anthropicPass1({ system, messages, tools }),
    () => openaiPass1({ system, messages, tools }));
}

/**
 * orchestratorPass2 — Texto final para el cliente (sin tools). Proveedor por AI_PROVIDER + fallback.
 * @param {object} args
 * @param {string} args.system - System prompt (string).
 * @param {Array}  args.messages - Mensajes (incluye tool results de Pass1).
 * @returns {Promise<string>}
 */
export async function orchestratorPass2({ system, messages = [] }) {
  return runWithFallback('pass2', useAnthropic(),
    () => anthropicPass2({ system, messages }),
    () => openaiPass2({ system, messages }));
}

export default { getClient, orchestratorPass1, orchestratorPass2, runWithFallback, ultimoProveedor };
