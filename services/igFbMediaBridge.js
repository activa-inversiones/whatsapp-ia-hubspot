// igFbMediaBridge.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — Paridad de MEDIA para Instagram DM / Facebook Messenger
// con lo que WhatsApp ya hace hoy (transcripción de audio, análisis de
// imagen, y — opcionalmente — respuesta por voz).
//
// BUG QUE ATACA (gap "MEDIA sin procesar", auditoría 2026-06-12): hoy, cuando
// un cliente de IG/FB manda un audio o una foto, multiChannelHandler.js
// (extractText(), líneas 102-122) devuelve el placeholder literal "[image]"
// / "[audio]" — NUNCA descarga ni procesa el adjunto. El cerebro (LLM) recibe
// ese placeholder como si fuera texto tecleado por el cliente y responde a
// ciegas. Este módulo resuelve el adjunto real (descarga + Whisper/Vision) y
// devuelve un texto equivalente al que WhatsApp ya arma hoy en index.js
// (mismo espíritu del prefijo "[IMAGEN ANALIZADA - Productos detectados]:").
//
// REGLA DE ORO (dueño, 2026-07-13): 100% ADITIVO. CERO cambios al camino de
// WhatsApp existente, CERO riesgo de romper IG/FB en vivo (aunque sea con el
// placeholder de hoy). Con el flag maestro OFF (default), processIncomingMedia
// retorna null INMEDIATAMENTE — el llamador debe caer al comportamiento actual
// byte-idéntico. Este archivo NUNCA lanza excepciones hacia afuera: cualquier
// falla interna se traga y también cae al placeholder de siempre.
//
// DISEÑO — INYECCIÓN DE DEPENDENCIAS (no imports cruzados hacia index.js):
// index.js YA importa multiChannelHandler.js y channel-agent.js; channel-agent.js
// YA importa multiChannelHandler.js. Si este módulo importara stt()/vision()/
// ttsElevenlabs()/elevenLabsMimeInfo() DESDE index.js se cerraría un ciclo ESM
// real (index.js → igFbMediaBridge.js → index.js). Para evitar eso, index.js
// le PASA sus propias funciones internas como argumentos (stt, vision,
// ttsElevenlabs, elevenLabsMimeInfo, sendChannelAudio) en el punto exacto
// donde ya están en scope — cero 'export' nuevos en index.js, cero ciclo.
// Única excepción: isVisionUnreadable de ./oliverVision.js — módulo PURO
// (sin I/O, sin imports hacia index.js/multiChannelHandler.js), reusarlo
// directo no crea ningún ciclo.
//
// Los tokens de Meta (IG/FB) se resuelven leyendo process.env directamente
// en este archivo (mismos nombres de variable que multiChannelHandler.js:
// META_IG_ACCESS_TOKEN, META_PAGE_ACCESS_TOKEN, WHATSAPP_TOKEN de fallback)
// EN VEZ DE importar multiChannelHandler.js — duplicar 2 líneas es más barato
// que acoplar este módulo nuevo a la superficie interna de otro archivo.
//
// ENV VARS que este módulo lee:
//   IG_FB_MEDIA_PARITY_ENABLED   'true'/'false' (default false) — flag maestro.
//   IG_FB_MEDIA_MAX_PER_DAY      entero (default 10) — cap de audios+imágenes
//                                procesados por conversación (canal:senderId) cada 24h.
//   IG_FB_TTS_ENABLED            'true'/'false' (default false) — sub-flag TTS de salida.
//   IG_FB_TTS_MAX_PER_DAY        entero (default 5) — cap de notas de voz de salida
//                                por conversación cada 24h.
//   META_IG_ACCESS_TOKEN / META_PAGE_ACCESS_TOKEN / WHATSAPP_TOKEN — mismos
//                                tokens que ya usa multiChannelHandler.js.
//
// RIESGO CONOCIDO (documentado, no resuelto acá): el shape exacto de
// attachments[].payload.url para audio/imagen de Messenger/IG NUNCA fue
// verificado contra tráfico real en este repo. downloadIgFbAttachment()
// asume la forma estándar de la Graph API (payload.url = CDN pre-firmada).
// Si Meta cambia el shape, esta función retorna null (fallback seguro) en
// vez de reventar — pero conviene correr la Fase 0 (log temporal del payload
// crudo, ya agregado en multiChannelHandler.js detrás de IG_FB_LOG_RAW_ATTACHMENTS)
// antes de habilitar el flag maestro en producción.
// ═══════════════════════════════════════════════════════════════════════════

import { isVisionUnreadable } from "./oliverVision.js";

export const VERSION = "1.0.0";

// Prefijo que marca un turno entrante como transcripción de audio (no texto
// tecleado por el cliente). Reusado por synthesizeAndSend/maybeSynthesizeVoiceReply
// para decidir si vale la pena responder con voz, y por channelMigration.js
// (otro módulo) para detectar señales de "medio no resuelto" sin duplicar el string.
export const AUDIO_TURN_PREFIX = "[Cliente envió un audio";

const DOWNLOAD_TIMEOUT_MS = 15000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Timeout para las llamadas EXTERNAS inyectadas (stt/vision/tts) — a diferencia
// de downloadIgFbAttachment (que ya tiene su propio AbortController), estas
// funciones las pasa index.js y no exponen forma de cancelar la llamada real
// en curso; este timeout solo acota cuánto tiempo ESPERA este módulo antes de
// darse por vencido y caer al placeholder, para no acumular promesas colgadas
// por turno si OpenAI/ElevenLabs están lentos o degradados.
const EXTERNAL_AI_TIMEOUT_MS = 25000;

// ─────────────────────────────────────────────────────────────────────────
// 0. FLAGS — leídos inline en cada uso (NUNCA cacheados a nivel de módulo),
//    para que los tests puedan mockear process.env sin recargar el módulo.
// ─────────────────────────────────────────────────────────────────────────

/** @returns {boolean} flag maestro de paridad de media IG/FB (default OFF). */
export function isMediaParityEnabled() {
  return String(process.env.IG_FB_MEDIA_PARITY_ENABLED || "").toLowerCase() === "true";
}

/** @returns {boolean} sub-flag de respuesta por voz (TTS) en IG/FB (default OFF). */
export function isTtsReplyEnabled() {
  return String(process.env.IG_FB_TTS_ENABLED || "").toLowerCase() === "true";
}

function mediaMaxPerDay() {
  const n = Number(process.env.IG_FB_MEDIA_MAX_PER_DAY);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

function ttsMaxPerDay() {
  const n = Number(process.env.IG_FB_TTS_MAX_PER_DAY);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

// ─────────────────────────────────────────────────────────────────────────
// 1. TOKENS META — duplicado deliberado de multiChannelHandler.js (mismas
//    env vars) para no crear un import cruzado hacia ese archivo.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resuelve el token Meta correcto según canal — mismo criterio que
 * multiChannelHandler.js (IG usa su propio token de larga duración si
 * existe; si no, cae al token de página; FB siempre usa el de página).
 * @param {string} channel  'instagram' | 'facebook'
 * @returns {string}
 */
export function resolveMetaToken(channel) {
  const pageToken = process.env.META_PAGE_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || "";
  const igToken = process.env.META_IG_ACCESS_TOKEN || pageToken;
  return channel === "instagram" ? igToken : pageToken;
}

// ─────────────────────────────────────────────────────────────────────────
// 2. RATE LIMITER — simple, en memoria, por conversación (canal:senderId),
//    ventana fija de 24h desde el primer hit. Nunca bloquea el turno: solo
//    informa al caller que se llegó al tope para que caiga al placeholder.
//
//    LIMITACIÓN CONOCIDA (no resuelta en este módulo, documentada a propósito):
//    el Map vive solo en memoria del proceso — un redeploy de Railway (este
//    repo despliega automáticamente desde main varias veces al día) resetea
//    el contador a cero, y no se comparte entre réplicas si el servicio corre
//    con más de una instancia. El cap diario es una mitigación de COSTO, no
//    de seguridad — persistirlo (Redis/Postgres) es una decisión de
//    infraestructura nueva que corresponde proponer y aprobar con el dueño
//    (regla del proyecto: no auto-instalar conexiones nuevas a ciegas), no
//    algo para agregar dentro de un fix quirúrgico 100% aditivo. Mitigación
//    parcial ya vigente: el flag maestro (IG_FB_MEDIA_PARITY_ENABLED) sigue
//    en OFF por defecto, así que hoy este limiter no corre en producción.
// ─────────────────────────────────────────────────────────────────────────

function makeDailyLimiter() {
  /** @type {Map<string, {count:number, windowStart:number}>} */
  const store = new Map();
  return {
    /**
     * @param {string} key
     * @param {number} max
     * @returns {boolean} true = permitido (y consumido), false = tope alcanzado.
     */
    consume(key, max) {
      const now = Date.now();
      const entry = store.get(key);
      if (!entry || now - entry.windowStart >= DAY_MS) {
        store.set(key, { count: 1, windowStart: now });
        return true;
      }
      if (entry.count >= max) return false;
      entry.count += 1;
      return true;
    },
    /** Limpieza para tests — no se usa en producción. */
    __reset() {
      store.clear();
    },
  };
}

const mediaLimiter = makeDailyLimiter();
const ttsLimiter = makeDailyLimiter();

// ─────────────────────────────────────────────────────────────────────────
// 2b. IDEMPOTENCIA POR MENSAJE — Meta garantiza entrega "at-least-once" y
//    puede reentregar el mismo webhook aunque ya se haya respondido 200 (el
//    ack ocurre ANTES de procesar, en multiChannelHandler.js). Sin esto, una
//    redelivery del mismo msgId volvería a bajar el binario + llamar a
//    Whisper/Vision — gasto real duplicado. TTL corto: solo cubre la ventana
//    de redelivery de Meta (no reemplaza ni toca el `seen` de WhatsApp en
//    index.js ni el dedupe de handleChannelTurn — es un dedup propio, solo
//    para no gastar plata dos veces en el paso de MEDIA).
//    En memoria (Map), con purga perezosa — mismo espíritu simple que el
//    resto del módulo; no agrega ningún setInterval nuevo al proceso.
// ─────────────────────────────────────────────────────────────────────────

const MEDIA_MSG_DEDUP_TTL_MS = 5 * 60 * 1000; // 5 min — ventana típica de redelivery de Meta.
const MEDIA_MSG_DEDUP_MAX_SIZE = 2000; // dispara purga perezosa antes de iterar en cada llamada.
const processedMediaMsgIds = new Map(); // msgId -> timestamp de primer procesamiento.

/**
 * @param {string} [msgId]
 * @returns {boolean} true = este msgId ya se procesó dentro de la ventana TTL
 *   (es una redelivery, el caller debe caer al placeholder sin gastar plata).
 *   Sin msgId no hay forma de deduplicar — se retorna false (no bloquea el turno).
 */
function isDuplicateMediaMsg(msgId) {
  if (!msgId) return false;
  const now = Date.now();
  if (processedMediaMsgIds.size > MEDIA_MSG_DEDUP_MAX_SIZE) {
    for (const [id, ts] of processedMediaMsgIds) {
      if (now - ts > MEDIA_MSG_DEDUP_TTL_MS) processedMediaMsgIds.delete(id);
    }
  }
  const prevTs = processedMediaMsgIds.get(msgId);
  if (prevTs && now - prevTs <= MEDIA_MSG_DEDUP_TTL_MS) return true;
  processedMediaMsgIds.set(msgId, now);
  return false;
}

/** Solo para tests — reinicia el dedup de msgId en memoria. */
export function __resetMediaMsgDedupForTests() {
  processedMediaMsgIds.clear();
}

/** Expuesto para tests: ¿esta conversación puede procesar 1 medio más hoy? */
export function checkMediaRateLimit(convKey, maxOverride) {
  return mediaLimiter.consume(convKey, Number.isFinite(maxOverride) ? maxOverride : mediaMaxPerDay());
}

/** Expuesto para tests: ¿esta conversación puede recibir 1 nota de voz más hoy? */
export function checkTtsRateLimit(convKey, maxOverride) {
  return ttsLimiter.consume(convKey, Number.isFinite(maxOverride) ? maxOverride : ttsMaxPerDay());
}

/** Solo para tests — reinicia ambos limiters en memoria. */
export function __resetRateLimitersForTests() {
  mediaLimiter.__reset();
  ttsLimiter.__reset();
}

// ─────────────────────────────────────────────────────────────────────────
// 3. DESCARGA — fetch directo primero (las URLs de attachments de Messenger/
//    IG suelen ser CDN pre-firmadas, sin auth adicional); si falla con
//    401/403, reintenta agregando access_token. AbortController en el fetch
//    para nunca colgar el turno si Meta no responde.
// ─────────────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Acota cuánto tiempo se espera una promesa inyectada (stt/vision/tts) sin
 * poder cancelar la llamada real subyacente (el caller no expone signal).
 * Si se cumple el timeout, la promesa rechaza acá pero la llamada original
 * sigue corriendo en segundo plano hasta que resuelva por su cuenta — esto
 * solo evita que ESTE turno quede colgado esperándola.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label  Para el mensaje de error (fines de diagnóstico).
 * @returns {Promise<T>}
 */
function withExternalTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`igFbMediaBridge: timeout (${ms}ms) esperando ${label}`));
    }, ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

/**
 * Descarga un adjunto de IG/FB (audio o imagen) a un Buffer.
 * Maneja auth según canal: 1er intento sin token (URL pre-firmada), 2do
 * intento agregando ?access_token=<token> si el primero da 401/403.
 * Nunca lanza — cualquier error retorna null (el caller cae al placeholder).
 * @param {string} channel  'instagram' | 'facebook'
 * @param {string} url
 * @param {string} [token]  Si no se pasa, se resuelve con resolveMetaToken(channel).
 * @returns {Promise<{buffer:Buffer, mime:string}|null>}
 */
export async function downloadIgFbAttachment(channel, url, token) {
  if (!url || typeof url !== "string") return null;
  const tok = token || resolveMetaToken(channel);

  const attempt = async (withToken) => {
    const finalUrl = withToken && tok
      ? `${url}${url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(tok)}`
      : url;
    const resp = await fetchWithTimeout(finalUrl, DOWNLOAD_TIMEOUT_MS);
    if (!resp.ok) {
      const err = new Error(`igFbMediaBridge: descarga adjunto HTTP ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    const arrBuf = await resp.arrayBuffer();
    return {
      buffer: Buffer.from(arrBuf),
      mime: resp.headers.get("content-type") || "application/octet-stream",
    };
  };

  try {
    return await attempt(false);
  } catch (e) {
    const status = e && e.status;
    if (status === 401 || status === 403) {
      try {
        return await attempt(true);
      } catch (e2) {
        console.error("[igFbMediaBridge] downloadIgFbAttachment retry con token falló:", e2 && e2.message ? e2.message : e2);
        return null;
      }
    }
    console.error("[igFbMediaBridge] downloadIgFbAttachment falló:", e && e.message ? e.message : e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. TRANSCRIPCIÓN / VISIÓN — 100% inyectado. Este módulo NUNCA importa
//    stt()/vision() de index.js; el caller (index.js) se los pasa ya en
//    scope. Ambas funciones inyectadas ya se tragan sus propios errores
//    (index.js:2298-2311 y :2313-2349 retornan "" en catch), pero igual
//    envolvemos acá por si el caller inyecta un mock que sí lanza. Además,
//    ambas están acotadas con withExternalTimeout(EXTERNAL_AI_TIMEOUT_MS):
//    el cliente OpenAI de index.js no configura timeout propio, así que sin
//    esto un turno podía quedar colgado varios minutos si OpenAI está lento.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Transcribe un audio a texto usando la función stt() inyectada por index.js
 * (mismo servicio Whisper que ya usa WhatsApp — no es un proveedor nuevo).
 * @param {Buffer} buffer
 * @param {string} mime
 * @param {(buf:Buffer, mime:string)=>Promise<string>} sttFn
 * @returns {Promise<string>}  Texto transcrito, o '' si no se pudo.
 */
export async function transcribeAudioBuffer(buffer, mime, sttFn) {
  if (!buffer || typeof sttFn !== "function") return "";
  try {
    const texto = await withExternalTimeout(
      sttFn(buffer, mime || "audio/ogg"),
      EXTERNAL_AI_TIMEOUT_MS,
      "stt()"
    );
    return String(texto || "").trim();
  } catch (e) {
    console.error("[igFbMediaBridge] transcribeAudioBuffer falló:", e && e.message ? e.message : e);
    return "";
  }
}

/**
 * Describe una imagen usando la función vision() inyectada por index.js
 * (mismo modelo gpt-4o que ya paga WhatsApp hoy — no es un proveedor nuevo).
 * El filtro de "¿esto es basura?" (isVisionUnreadable) lo aplica el caller
 * (processIncomingMedia), no esta función — acá solo se resuelve el texto crudo.
 * @param {Buffer} buffer
 * @param {string} mime
 * @param {(buf:Buffer, mime:string)=>Promise<string>} visionFn
 * @returns {Promise<string>}  Descripción cruda de la visión, o '' si no se pudo.
 */
export async function describeImageBuffer(buffer, mime, visionFn) {
  if (!buffer || typeof visionFn !== "function") return "";
  try {
    const texto = await withExternalTimeout(
      visionFn(buffer, mime || "image/jpeg"),
      EXTERNAL_AI_TIMEOUT_MS,
      "vision()"
    );
    return String(texto || "").trim();
  } catch (e) {
    console.error("[igFbMediaBridge] describeImageBuffer falló:", e && e.message ? e.message : e);
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 5. ORQUESTADOR — processIncomingMedia(channel, message, senderId, deps).
//    SOLO actúa si IG_FB_MEDIA_PARITY_ENABLED === 'true'; si no, retorna
//    null INMEDIATAMENTE (el llamador hace fallback al comportamiento actual,
//    byte-idéntico a hoy). Nunca lanza excepciones hacia afuera.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Orquesta la resolución de un adjunto entrante de IG/FB: rate-limit →
 * descarga → transcripción (audio) o visión (imagen) → texto listo para
 * el cerebro (LLM), con el mismo espíritu de prefijo que ya usa WhatsApp.
 *
 * @param {string} channel   'instagram' | 'facebook'
 * @param {object} message   Mensaje crudo del webhook de Meta (o wrapper con
 *                           `.attachments`/`.message.attachments` — se acepta
 *                           cualquiera de las dos formas para no acoplar este
 *                           módulo a la forma exacta que arme el caller).
 * @param {string} senderId  ID del remitente (IGSID/PSID) — usado como parte
 *                           de la clave de rate-limit.
 * @param {string} [msgId]   ID del mensaje (idempotencia) — evita reprocesar
 *                           (y regastar Whisper/Vision) si Meta reentrega el
 *                           mismo webhook. Sin msgId no se puede deduplicar.
 * @param {{stt?:Function, vision?:Function}} [deps]  Funciones inyectadas
 *                           por index.js (stt/vision reales) — NUNCA importadas.
 * @returns {Promise<{textoParaBrain:string|null, huboMedia:boolean, tipoMedia:string|null, capped?:boolean, deduped?:boolean, buffer?:Buffer, mime?:string, transcripcion?:string, descripcion?:string}|null>}
 *   [2026-07-14 media→inbox] Con huboMedia:true vienen además buffer+mime (binario descargado)
 *   y transcripcion (audio) o descripcion (imagen) — para que el caller lo persista en el
 *   MediaStore y el inbox muestre el adjunto original (paridad con WhatsApp).
 *   null = flag OFF (o error inesperado) → el caller debe usar su placeholder/texto actual.
 *   objeto con huboMedia:false → tampoco hay texto nuevo (adjunto no soportado, sin url,
 *   descarga fallida, redelivery duplicada, o tope de rate-limit alcanzado) → el caller
 *   igual debe caer al placeholder.
 *   objeto con huboMedia:true → textoParaBrain trae la transcripción/análisis (o el texto
 *   de rechazo honesto '[Audio no reconocido]'/'[Imagen no legible]' si el modelo no pudo leer).
 */
export async function processIncomingMedia(channel, message, senderId, msgId, deps = {}) {
  if (!isMediaParityEnabled()) return null;

  try {
    const attachments =
      (message && (message.attachments || (message.message && message.message.attachments))) || [];
    const att = Array.isArray(attachments) ? attachments[0] : null;
    if (!att) return null; // sin adjunto real: nada que hacer, que el caller siga su flujo normal.

    const tipoMedia = String(att.type || "").toLowerCase() || null;

    // Filtro de tipo ANTES de rate-limit/dedup: video/sticker/file/otros están
    // fuera de alcance v1 → placeholder de siempre, SIN gastar cupo diario.
    if (tipoMedia !== "audio" && tipoMedia !== "image") {
      return { textoParaBrain: null, huboMedia: false, tipoMedia };
    }

    // Idempotencia ANTES de rate-limit/descarga: una redelivery de Meta del
    // mismo msgId no debe gastar cupo ni volver a llamar a Whisper/Vision.
    if (isDuplicateMediaMsg(msgId)) {
      return { textoParaBrain: null, huboMedia: false, tipoMedia, deduped: true };
    }

    const convKey = `${channel}:${senderId}`;

    // Rate limit ANTES de gastar plata en descarga/Whisper/Vision.
    if (!checkMediaRateLimit(convKey)) {
      return { textoParaBrain: null, huboMedia: false, tipoMedia, capped: true };
    }

    const url = (att.payload && att.payload.url) || att.url || null;
    if (!url) {
      return { textoParaBrain: null, huboMedia: false, tipoMedia };
    }

    const descargado = await downloadIgFbAttachment(channel, url, resolveMetaToken(channel));
    if (!descargado) {
      // No se pudo bajar el binario: anti-alucinación — no inventar, caer al placeholder.
      return { textoParaBrain: null, huboMedia: false, tipoMedia };
    }

    if (tipoMedia === "audio") {
      const texto = await transcribeAudioBuffer(descargado.buffer, descargado.mime, deps.stt);
      const textoParaBrain = texto
        ? `${AUDIO_TURN_PREFIX}, transcripción]: ${texto}`
        : "[Audio no reconocido]";
      // [2026-07-14 IG/FB media→inbox] Campos ADITIVOS (buffer/mime/transcripcion): el caller
      // (index.js) los usa para guardar el binario en el MediaStore y que el inbox muestre el
      // audio original (paridad con WhatsApp). Los callers existentes solo leen
      // textoParaBrain/huboMedia/tipoMedia → cero impacto en ramas actuales.
      return { textoParaBrain, huboMedia: true, tipoMedia, buffer: descargado.buffer, mime: descargado.mime, transcripcion: texto || "" };
    }

    // imagen
    const descripcion = await describeImageBuffer(descargado.buffer, descargado.mime, deps.vision);
    const textoParaBrain = isVisionUnreadable(descripcion)
      ? "[Imagen no legible]"
      : `[Cliente envió una imagen, análisis]: ${descripcion}`;
    // [2026-07-14 IG/FB media→inbox] buffer/mime/descripcion ADITIVOS — misma razón que en audio.
    // Se retorna el buffer aunque la imagen sea "no legible": el dueño igual necesita VER la foto
    // original en el inbox para verificar la cubicación (ese es justamente el gap que cerramos).
    return { textoParaBrain, huboMedia: true, tipoMedia, buffer: descargado.buffer, mime: descargado.mime, descripcion: descripcion || "" };
  } catch (e) {
    // Nunca lanzar: cualquier falla inesperada cae al comportamiento actual.
    console.error("[igFbMediaBridge] processIncomingMedia falló:", e && e.message ? e.message : e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 6. TTS DE SALIDA — sub-flag independiente IG_FB_TTS_ENABLED. 100%
//    inyectado (ttsElevenlabs/elevenLabsMimeInfo/sendChannelAudio pasados
//    como parámetros — cero imports de index.js/multiChannelHandler.js).
//    Se dispara solo cuando el turno ENTRANTE fue audio (marcado por el
//    AUDIO_TURN_PREFIX que processIncomingMedia ya escribió en el texto) —
//    reuso de esa marca, sin flag/estado adicional para "tipo de mensaje".
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {string} text  Texto del turno ENTRANTE (ya resuelto por processIncomingMedia,
 *                        o el texto tal cual llegó si la paridad de media está OFF).
 * @returns {boolean}  true si el turno entrante fue un audio transcrito.
 */
export function wasIncomingAudioTurn(text) {
  return typeof text === "string" && text.startsWith(AUDIO_TURN_PREFIX);
}

/**
 * Sintetiza la respuesta del bot en audio (ElevenLabs, MP3 plano — Messenger/IG
 * no tienen el concepto de "nota de voz OGG-Opus" de WhatsApp Cloud API, así
 * que NO se requiere ffmpeg acá) y la envía por el canal correspondiente.
 * Nunca lanza — cualquier falla retorna {sent:false} para que el caller haga
 * fallback al envío de texto de siempre (el cliente nunca se queda sin respuesta).
 *
 * @param {object} args
 * @param {string} args.channel        'instagram' | 'facebook'
 * @param {string} args.recipientId    IGSID/PSID destino.
 * @param {string} args.replyText      Texto de la respuesta del bot a sintetizar.
 * @param {boolean} args.wasAudioTurn  Resultado de wasIncomingAudioTurn(textoEntrante).
 * @param {string} [args.convKey]      Clave de rate-limit; default `${channel}:${recipientId}`.
 * @param {()=>{mime:string,ext:string}} args.elevenLabsMimeInfo  Inyectado por index.js.
 * @param {(text:string)=>Promise<Buffer>} args.ttsElevenlabs     Inyectado por index.js.
 * @param {(channel:string, recipientId:string, buffer:Buffer, filename:string, mime:string)=>Promise<any>} args.sendChannelAudio
 *        Inyectado — función nueva de multiChannelHandler.js (clon de sendChannelDocument
 *        con attachment.type:'audio'). Si aún no existe, el caller simplemente no la pasa
 *        y esta función retorna {sent:false, reason:'deps_missing'} sin romper nada.
 * @returns {Promise<{sent:boolean, reason?:string, error?:string, result?:any}>}
 */
export async function maybeSynthesizeVoiceReply({
  channel,
  recipientId,
  replyText,
  wasAudioTurn,
  convKey,
  elevenLabsMimeInfo,
  ttsElevenlabs,
  sendChannelAudio,
} = {}) {
  try {
    if (!isTtsReplyEnabled()) return { sent: false, reason: "disabled" };
    if (!wasAudioTurn) return { sent: false, reason: "not_audio_turn" };
    if (
      typeof ttsElevenlabs !== "function" ||
      typeof elevenLabsMimeInfo !== "function" ||
      typeof sendChannelAudio !== "function"
    ) {
      return { sent: false, reason: "deps_missing" };
    }
    if (!replyText || !String(replyText).trim()) {
      return { sent: false, reason: "empty_text" };
    }

    const key = convKey || `${channel}:${recipientId}`;
    if (!checkTtsRateLimit(key)) {
      return { sent: false, reason: "capped" };
    }

    const { mime, ext } = elevenLabsMimeInfo();
    const buffer = await withExternalTimeout(ttsElevenlabs(replyText), EXTERNAL_AI_TIMEOUT_MS, "ttsElevenlabs()");
    const filename = `igfb_reply_${Date.now()}.${ext}`;
    const result = await sendChannelAudio(channel, recipientId, buffer, filename, mime);
    return { sent: true, result };
  } catch (e) {
    console.error("[igFbMediaBridge] maybeSynthesizeVoiceReply falló:", e && e.message ? e.message : e);
    return { sent: false, reason: "error", error: e && e.message ? e.message : String(e) };
  }
}

export default {
  VERSION,
  AUDIO_TURN_PREFIX,
  isMediaParityEnabled,
  isTtsReplyEnabled,
  resolveMetaToken,
  checkMediaRateLimit,
  checkTtsRateLimit,
  __resetRateLimitersForTests,
  __resetMediaMsgDedupForTests,
  downloadIgFbAttachment,
  transcribeAudioBuffer,
  describeImageBuffer,
  processIncomingMedia,
  wasIncomingAudioTurn,
  maybeSynthesizeVoiceReply,
};
