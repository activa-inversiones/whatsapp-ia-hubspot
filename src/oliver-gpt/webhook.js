// src/oliver-gpt/webhook.js
//
// HANDLER DE PRODUCCIÓN AISLADO — Oliver GPT (plan F4).
// ─────────────────────────────────────────────────────────────────────────
// Reúsa la tubería probada de Oliver GPT (agent.handleTurn) y la capa de
// WhatsApp de Oliver v2 (whatsapp-adapter), cableándolas a la persistencia
// REAL (salesOsBridge) y a la escalación REAL (highValueNotifier).
//
// NO toca el flujo de V1: es un módulo nuevo, sin estado compartido con
// index.js. El routing (montar este handler en una ruta Express) lo conecta
// el integrador; aquí solo se exporta handleWebhook(req, res).
//
// CONTRATO FAIL-SAFE:
//   1) res.sendStatus(200) se envía SIEMPRE e INMEDIATAMENTE (ack a Meta).
//      Meta reintenta si no recibe 200 rápido; el 200 corta los reintentos.
//   2) Absolutamente todo lo demás corre dentro de try/catch. Después del
//      200 NUNCA se relanza un error: se loguea y se traga. Un fallo en
//      cualquier servicio (control, IA, persistencia, WhatsApp) degrada
//      con gracia y jamás tumba el proceso ni dispara un 500 a Meta.
//   3) getConversationControl falla a "ai" (default seguro): ante error del
//      control NO se bloquea al bot. El takeover humano solo se respeta
//      cuando el control responde explícitamente que la IA está pausada.
//
// DEUDA TÉCNICA EXPLÍCITA (piloto):
//   · Historial in-memory (Map<from, {history, state}>). NO persiste entre
//     redeploys. TODO F5: reconstruir el contexto largo desde
//     conversation_messages al hidratar una sesión fría.
//   · persistSession es un placeholder (log). TODO F5: PUT a whatsapp_sessions
//     (ver index.js persistSessionToStore ~2281 como referencia).
//
// ESM, Node 18+.

import { handleTurn as realHandleTurn } from './agent.js';
import { getClient as realGetClient } from './engine.js';
import {
  parseInbound as realParseInbound,
  sendWhatsAppText as realSendWhatsAppText,
  sendWhatsAppImageUrl as realSendImageUrl,
  sendWhatsAppVideoUrl as realSendVideoUrl,
  sendWhatsAppDocumentUrl as realSendDocumentUrl,
} from '../sales-agent/whatsapp-adapter.js';
import * as realBridge from '../../services/salesOsBridge.js';
import { notifyHighValue as realNotifyHighValue } from '../../services/highValueNotifier.js';
import { toFile as realToFile } from 'openai/uploads';
import {
  loadSession as realLoadSession,
  persistSession as realPersistSession,
  resetIfInactive,
} from './session-store.js';
import { parseReferral, buildCtwaLeadPayload } from '../../services/ctwaReferral.js'; // [F3b] CTWA
import { isVisionUnreadable } from '../../services/oliverVision.js'; // [F3b] detector imagen ilegible

/* =========================================================================
 * CONFIG
 * ========================================================================= */
const META = {
  VER: process.env.META_GRAPH_VERSION || 'v22.0',
  TOKEN: process.env.WHATSAPP_TOKEN,
};
const VISION_MODEL = () => process.env.AI_MODEL_OPENAI || 'gpt-4o';
const STT_MODEL = () => process.env.STT_MODEL || 'whisper-1';

// Tope de elementos guardados por conversación (bound de tokens del piloto).
const MAX_HISTORY = 40;

/* =========================================================================
 * ESTADO IN-MEMORY (piloto)
 *  · CONV: Map<from, {history, state}>  → contexto conversacional.
 *  · SEEN: Set<msgId>                   → idempotencia (dedupe).
 * Ambos son aceptables para el piloto de un número único. NO persisten entre
 * reinicios del proceso. TODO F5: mover a Postgres / Redis.
 * ========================================================================= */
const CONV = new Map();
const SEEN = new Set();
// Cota defensiva del Set de dedupe para no crecer sin límite en un proceso
// de larga vida. Al superar el tope se vacía (riesgo aceptable en piloto:
// a lo sumo se reprocesaría un id muy viejo, improbable de reaparecer).
const SEEN_MAX = 5000;

/* =========================================================================
 * RATE-LIMIT — 18 mensajes por minuto por waId.
 * Porteado de index.js rateOk (~L2525). Map<waId, { n, resetAt }>.
 * ========================================================================= */
const RATE_MAP = new Map();

/**
 * Comprueba si el waId está dentro del límite de 18 msg/min.
 * @param {string} waId
 * @param {Map} [rateMap] — inyectable para tests.
 * @returns {{ ok: boolean, msg?: string }}
 */
function rateOk(waId, rateMap = RATE_MAP) {
  const now = Date.now();
  if (!rateMap.has(waId)) rateMap.set(waId, { n: 0, resetAt: now + 60_000 });
  const r = rateMap.get(waId);
  if (now >= r.resetAt) {
    r.n = 0;
    r.resetAt = now + 60_000;
  }
  r.n++;
  return r.n > 18
    ? { ok: false, msg: 'Escribes muy rápido 😅 Dame 10 seg.' }
    : { ok: true };
}

/* =========================================================================
 * MUTEX — serializa mensajes concurrentes del mismo waId (doble-tap).
 * Porteado de index.js acquireLock (~L2558).
 * Map<waId, Promise> — la promesa encadenada actúa como cola FIFO de 1.
 * ========================================================================= */
const LOCKS = new Map();

/**
 * Adquiere el lock para waId. Retorna una función release().
 * @param {string} waId
 * @param {Map} [locks] — inyectable para tests.
 * @returns {Promise<Function>}
 */
async function acquireLock(waId, locks = LOCKS) {
  const prev = locks.get(waId) || Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  locks.set(waId, next);
  await prev;
  return () => {
    release();
    if (locks.get(waId) === next) locks.delete(waId);
  };
}

/* =========================================================================
 * MEDIA — Resolución de imagen/audio entrantes a userText útil.
 *
 * parseInbound NO expone el media id (devuelve "[image]" / "[audio]"); el id
 * vive en el mensaje crudo de Meta, así que lo extraemos de req.body aquí.
 * Esto RESUELVE la ceguera de V2 ante adjuntos.
 * ========================================================================= */

// Extrae el mensaje crudo de Meta (mismo path que parseInbound).
function rawMessage(body) {
  return body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] || null;
}

// Descarga el binario de un media id de WhatsApp (2 pasos: URL firmada → blob).
async function downloadWaMedia(mediaId, deps) {
  const fetchFn = deps.fetchFn || fetch;
  const ver = META.VER;
  const token = META.TOKEN;
  // 1) Resolver la URL temporal del media.
  const metaRes = await fetchFn(`https://graph.facebook.com/${ver}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`media_meta_${metaRes.status}`);
  const meta = await metaRes.json();
  const url = meta?.url;
  const mime = meta?.mime_type || 'application/octet-stream';
  if (!url) throw new Error('media_url_missing');
  // 2) Descargar el binario (requiere el mismo Bearer).
  const blobRes = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!blobRes.ok) throw new Error(`media_blob_${blobRes.status}`);
  const buf = Buffer.from(await blobRes.arrayBuffer());
  return { buffer: buf, mime };
}

// Vision: describe la imagen (productos/medidas) → userText útil. Espeja el
// patrón de index.js ~2127.
async function describeImage(buffer, mime, deps) {
  const client = (deps.getClient || realGetClient)();
  const b64 = buffer.toString('base64');
  const r = await client.chat.completions.create({
    model: VISION_MODEL(),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Analiza esta imagen y extrae TODOS los productos de ventanas/puertas. ' +
              'Para CADA uno indica: tipo de apertura, medidas (ancho x alto), cantidad y color. ' +
              'Si hay un plano o cotización, transcribe los datos relevantes. Responde en español.',
          },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}`, detail: 'high' } },
        ],
      },
    ],
    max_tokens: 4096,
  });
  const raw = (r.choices?.[0]?.message?.content || '').trim();
  // [F3b] Si la visión devolvió rechazo / vacío / sin medidas → marcar ilegible.
  // Evita que el orquestador confirme medidas que nunca llegaron (anti-alucinación).
  if (isVisionUnreadable(raw)) return '[Imagen no legible]';
  return raw;
}

// STT: transcribe el audio → userText. Espeja index.js ~2112.
async function transcribeAudio(buffer, mime, deps) {
  const client = (deps.getClient || realGetClient)();
  const toFileFn = deps.toFile || realToFile;
  const file = await toFileFn(buffer, 'audio.ogg', { type: mime || 'audio/ogg' });
  const r = await client.audio.transcriptions.create({
    model: STT_MODEL(),
    file,
    language: 'es',
  });
  return (r.text || '').trim();
}

/**
 * Resuelve el userText efectivo de un inbound, manejando media.
 * @returns {Promise<{ userText:string, mediaResolved:boolean }>}
 *   mediaResolved=true cuando convertimos un adjunto en texto útil.
 *   Si el adjunto no se pudo resolver, devuelve un mensaje pidiendo texto.
 */
async function resolveUserText(inbound, body, deps) {
  const { type, text } = inbound;

  if (type === 'image') {
    const raw = rawMessage(body);
    const mediaId = raw?.image?.id;
    if (!mediaId) return { userText: text, mediaResolved: false };
    try {
      const { buffer, mime } = await downloadWaMedia(mediaId, deps);
      const desc = await (deps.describeImage || describeImage)(buffer, mime, deps);
      // [F3b] '[Imagen no legible]' NO es contenido válido → cae al fallback que pide
      // describir por texto (evita pasar una no-descripción como medidas reales).
      if (desc && desc !== '[Imagen no legible]') {
        return {
          userText: `[El cliente envió una imagen. Contenido detectado]: ${desc}`,
          mediaResolved: true,
        };
      }
    } catch (err) {
      log('error', 'media.image', err);
    }
    return {
      userText:
        'El cliente envió una imagen que no se pudo procesar. Pídale, de forma amable, ' +
        'que describa por texto el tipo de ventana, las medidas, la cantidad y el color.',
      mediaResolved: false,
    };
  }

  if (type === 'audio') {
    const raw = rawMessage(body);
    const mediaId = raw?.audio?.id;
    if (!mediaId) return { userText: text, mediaResolved: false };
    try {
      const { buffer, mime } = await downloadWaMedia(mediaId, deps);
      const transcript = await (deps.transcribeAudio || transcribeAudio)(buffer, mime, deps);
      if (transcript) return { userText: transcript, mediaResolved: true };
    } catch (err) {
      log('error', 'media.audio', err);
    }
    return {
      userText:
        'El cliente envió un audio que no se pudo transcribir. Pídale, de forma amable, ' +
        'que escriba su consulta por texto.',
      mediaResolved: false,
    };
  }

  // text / button / interactive → ya viene resuelto por parseInbound.
  return { userText: text, mediaResolved: false };
}

/* =========================================================================
 * LOGGING simple (no rompe nunca).
 * ========================================================================= */
function log(level, ctx, msg) {
  const fn = level === 'error' ? console.error : console.log;
  const detail = msg && msg.stack ? msg.stack : msg;
  fn(`[oliver-gpt/webhook] ${ctx}:`, detail);
}

/* =========================================================================
 * Helpers de persistencia (cableado REAL a salesOsBridge).
 * Cada uno traga su propio error: la persistencia NUNCA debe tumbar el turno.
 * ========================================================================= */
async function safe(label, fn) {
  try {
    return await fn();
  } catch (err) {
    log('error', label, err);
    return null;
  }
}

// Extrae la primera cotización calculada de los toolCalls del turno (si la hay).
function extractQuote(toolCalls = []) {
  for (const tc of toolCalls) {
    if (
      (tc.name === 'calcular_cotizacion' || tc.name === 'calcular_por_area') &&
      tc.result &&
      tc.result.ok !== false
    ) {
      return tc.result;
    }
  }
  return null;
}

/* =========================================================================
 * HANDLER PRINCIPAL
 * ========================================================================= */

/**
 * handleWebhook — Entrypoint del webhook de WhatsApp para Oliver GPT.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {object} [deps] - Dependencias inyectables (tests herméticos). Cada
 *   una cae a la implementación real si no se provee:
 *   { parseInbound, sendWhatsAppText, handleTurn, bridge, notifyHighValue,
 *     getClient, describeImage, transcribeAudio, toFile, fetchFn,
 *     loadSession, persistSession,
 *     conv (Map), seen (Set), rateMap (Map), locks (Map) }.
 */
export async function handleWebhook(req, res, deps = {}) {
  // ── (1) ACK INMEDIATO a Meta. Nada antes de esto puede lanzar. ──────────
  try {
    res.sendStatus(200);
  } catch (err) {
    // Si ni siquiera podemos ackear, logueamos y seguimos: no hay 500 útil.
    log('error', 'ack', err);
  }

  // ── (2..9) Todo el procesamiento envuelto: NUNCA relanza tras el 200. ───
  // releaseLock declarado AQUÍ (fuera del try) para que el finally lo libere
  // SIEMPRE, ante cualquier return intermedio o excepción (ajuste abogado).
  let releaseLock = null;
  try {
    const parseInbound    = deps.parseInbound    || realParseInbound;
    const sendWhatsAppText = deps.sendWhatsAppText || realSendWhatsAppText;
    const handleTurn      = deps.handleTurn      || realHandleTurn;
    const bridge          = deps.bridge          || realBridge;
    const notifyHighValue = deps.notifyHighValue  || realNotifyHighValue;
    const loadSession     = deps.loadSession     || realLoadSession;
    const persistSessionFn = deps.persistSession  || realPersistSession;
    const conv  = deps.conv  || CONV;
    const seen  = deps.seen  || SEEN;
    const rateMap = deps.rateMap || RATE_MAP;
    const locks   = deps.locks   || LOCKS;

    // ── (2) Parse + validación + idempotencia ───────────────────────────
    const inbound = parseInbound(req.body);
    if (!inbound || !inbound.ok || !inbound.from) return;

    const { from, msgId } = inbound;

    if (msgId) {
      if (seen.has(msgId)) {
        log('info', 'dedupe', `msgId repetido ignorado: ${msgId}`);
        return;
      }
      if (seen.size >= SEEN_MAX) seen.clear();
      seen.add(msgId);
    }

    // ── (2b) MUTEX — adquirir lock antes de cualquier I/O. Serializa ─────
    // mensajes concurrentes del mismo número (doble-tap). El release se llama
    // siempre en el bloque finally al final del handler.
    releaseLock = await acquireLock(from, locks);

    // ── (2c) RATE-LIMIT — 18 msg/min por waId ───────────────────────────
    const rate = rateOk(from, rateMap);
    if (!rate.ok) {
      log('info', 'rate_limit', `Rate exceeded para ${from}`);
      // Aviso amigable al cliente; no procesa el turno.
      await safe('rate.send', () => sendWhatsAppText(from, rate.msg));
      return; // el finally libera el lock
    }

    // ── (3) Conversation control — respetar takeover humano ──────────────
    // Default seguro: ante fallo del control, getConversationControl ya
    // devuelve { ai_paused:false } (no bloquea). Solo pausamos si lo dice
    // explícitamente.
    const control = await safe('control', () => bridge.getConversationControl(from));
    const aiPaused =
      !!control &&
      (control.ai_paused === true ||
        (control.operator_status && control.operator_status !== 'ai'));

    if (aiPaused) {
      // Persistir el inbound para que el operador humano lo vea, y salir SIN
      // invocar a la IA (respetamos el takeover).
      await safe('control.persistInbound', () =>
        bridge.pushConversationEvent({
          channel: 'whatsapp',
          external_id: from,
          direction: 'inbound',
          actor_type: 'customer',
          actor_name: 'Cliente',
          message_type: inbound.type || 'text',
          body: inbound.text || '',
          metadata: { source: 'oliver_gpt_webhook', msg_id: msgId, ai_paused: true },
        })
      );
      log('info', 'control', `IA pausada (takeover humano) para ${from}; inbound persistido`);
      return;
    }

    // ── (4) HIDRATACIÓN DE SESIÓN — cache in-memory o Postgres ──────────
    //
    // Orden de prioridad:
    //   1) Cache caliente (conv.get(from)) si existe y tiene historial.
    //   2) Postgres vía GET /internal/wa-sessions/{from} (loadSession).
    //   3) Estado vacío si ambos fallan (fail-safe).
    //
    // Después de hidratar se aplica resetIfInactive: si el último mensaje
    // tiene >7 días, se limpia lockedData para evitar contaminación de
    // cotizaciones anteriores (F2-2).
    let cached = conv.get(from);
    if (!cached || !Array.isArray(cached.history) || cached.history.length === 0) {
      // Cache frío — intentar hidratar desde Postgres.
      const remote = await loadSession(from, deps);
      if (remote) {
        cached = remote;
        conv.set(from, cached); // poblar cache para el siguiente turno
        log('info', 'session.hydrated', `Sesión hidratada desde Postgres para ${from}`);
      }
    }
    const safeCache = cached || { history: [], state: {} };
    const history   = Array.isArray(safeCache.history) ? safeCache.history : [];
    const rawState  = safeCache.state && typeof safeCache.state === 'object' ? safeCache.state : {};
    // Reset por inactividad: limpia lockedData si >7 días sin actividad.
    const baseState  = resetIfInactive({ ...rawState, lastMessageAt: rawState.lastMessageAt || 0 });
    const state = { ...baseState, telefono: from, fecha: new Date().toISOString() };

    // ── (4b) CTWA — Captura atribución Meta Ads (Click-to-WhatsApp). ────────
    // Solo en el primer mensaje con referral de la sesión (flag ctwaCaptured,
    // ya hidratado en state). Fire-and-forget vía safe(): no bloquea ni tumba.
    // Espeja index.js ~L4901-4913 usando el bridge probado (pushLeadEvent).
    try {
      const _rawMsg = rawMessage(req.body);
      if (_rawMsg) {
        const _ref = (deps.parseReferral || parseReferral)(_rawMsg);
        if (_ref && _ref.isCtwaAd && !state.ctwaCaptured) {
          state.ctwaCaptured = true;
          state.ctwa_clid = _ref.ctwaClid || null;
          state.ad_id = _ref.adId || null;
          const _bridge = deps.bridge || realBridge;
          const _payload = (deps.buildCtwaLeadPayload || buildCtwaLeadPayload)(
            from, _ref, { name: state.name || '' }
          );
          safe('ctwa.ingest', () => _bridge.pushLeadEvent(_payload));
          log('info', 'ctwa_attribution',
            `Lead CTWA capturado tel=${from} ad=${_ref.adId || '?'} clid=${_ref.ctwaClid ? 'sí' : 'no'}`);
        }
      }
    } catch (e) {
      log('error', 'ctwa.capture', e);
    }

    // ── (5) MEDIA → userText útil (vision / STT). Resuelve la ceguera V2. ─
    const { userText } = await resolveUserText(inbound, req.body, deps);
    if (!userText) return;

    // ── (6) toolCtx cableado a servicios REALES ──────────────────────────
    const toolCtx = {
      telefono: from,

      // saveLead → pushLeadEvent (persistencia real del lead).
      saveLead: (leadState = {}) =>
        safe('saveLead', () =>
          bridge.pushLeadEvent({
            phone: from,
            channel: 'whatsapp',
            name: leadState.name || state.name || '',
            comuna: leadState.comuna || state.comuna || '',
            stage: leadState.stageKey || 'oliver_gpt',
            items: leadState.items || [],
            value: leadState.grand_total || null,
            metadata: { source: 'oliver_gpt' },
          })
        ),

      // notifyMarcelo → escalación REAL (highValueNotifier a ESCALATION_PHONE).
      // highValueNotifier.notifyHighValue(waSendFn, customerPhone, session, reason).
      notifyMarcelo: (payload = {}) =>
        safe('notifyMarcelo', () =>
          notifyHighValue(
            sendWhatsAppText, // waSendFn(to, body) — firma compatible
            from,
            {
              data: { ...state, ...(payload.data || {}) },
              history,
            },
            payload.reason || 'oliver_gpt_escalation'
          )
        ),

      // persistSession → PUT real a /internal/wa-sessions/{from} (F2).
      // fire-and-forget: no bloquea el turno. Si falla → se traga el error.
      persistSession: (sessState) => {
        persistSessionFn(from, sessState || { history, state }, deps);
        return Promise.resolve();
      },

      // sendMedia → envío REAL de catálogos/fotos/videos por WhatsApp.
      // Resuelve la catalog_key a URL desde env vars y despacha con el helper correcto.
      sendMedia: ({ media_type, catalog_key, caption = '' } = {}) =>
        safe('sendMedia', async () => {
          const sendImageUrl = deps.sendImageUrl || realSendImageUrl;
          const sendVideoUrl = deps.sendVideoUrl || realSendVideoUrl;
          const sendDocumentUrl = deps.sendDocumentUrl || realSendDocumentUrl;
          // resolveCatalogUrl vive en tools.js; la replicamos aquí inline para no
          // crear una dependencia circular. Misma fuente de verdad: env vars.
          const CATALOG_MAP = {
            catalogo_pvc: process.env.CATALOGO_PVC_URL,
            catalogo_colores: process.env.CATALOGO_COLORES_URL,
            ficha_tecnica_s60: process.env.FICHA_S60_URL,
            ficha_tecnica_sliding: process.env.FICHA_SLIDING_URL,
            video_planta: process.env.VIDEO_PLANTA,
            video_oficina: process.env.VIDEO_OFICINA,
            video_instalaciones: process.env.VIDEO_INSTALACIONES,
            foto_proyecto_1: process.env.FOTO_PROYECTO_1_URL,
            foto_proyecto_2: process.env.FOTO_PROYECTO_2_URL,
            certificacion_tse: process.env.CERTIFICACION_TSE_URL,
          };
          const url = CATALOG_MAP[catalog_key] || null;
          if (!url) {
            log('error', 'sendMedia', `catalog_key '${catalog_key}' sin URL configurada`);
            return { ok: false, error: `catalog_not_configured: ${catalog_key}` };
          }
          if (media_type === 'image') {
            return sendImageUrl(from, url, caption);
          } else if (media_type === 'video') {
            return sendVideoUrl(from, url, caption);
          } else if (media_type === 'document') {
            return sendDocumentUrl(from, url, `${catalog_key}.pdf`, caption);
          }
          return { ok: false, error: `media_type_invalido: ${media_type}` };
        }),
    };

    // ── Llamada al cerebro probado ──────────────────────────────────────
    // Si handleTurn lanza, lo captura el try externo → fail-safe (200 ya enviado).
    const turn = await handleTurn({ history, userText, state, toolCtx });
    const reply = turn?.reply || '';
    const newHistory = Array.isArray(turn?.history) ? turn.history : history;
    const newState = turn?.state && typeof turn.state === 'object' ? turn.state : state;
    const toolCalls = Array.isArray(turn?.toolCalls) ? turn.toolCalls : [];

    // ── (7) Enviar respuesta por WhatsApp ───────────────────────────────
    if (reply) {
      await safe('sendWhatsAppText', () => sendWhatsAppText(from, reply));
    }

    // ── (8) Persistencia POST del turno (inbound + outbound) ────────────
    await safe('persist.inbound', () =>
      bridge.pushConversationEvent({
        channel: 'whatsapp',
        external_id: from,
        customer_name: newState.name || '',
        direction: 'inbound',
        actor_type: 'customer',
        actor_name: 'Cliente',
        message_type: inbound.type || 'text',
        body: inbound.text || userText,
        metadata: { source: 'oliver_gpt_webhook', msg_id: msgId, resolved_text: userText },
      })
    );

    if (reply) {
      await safe('persist.outbound', () =>
        bridge.pushConversationEvent({
          channel: 'whatsapp',
          external_id: from,
          customer_name: newState.name || '',
          direction: 'outbound',
          actor_type: 'ai',
          actor_name: 'Oliver',
          message_type: 'text',
          body: reply,
          metadata: { source: 'oliver_gpt_webhook' },
        })
      );
    }

    // Cotización en el turno → pushQuoteEvent.
    const quote = extractQuote(toolCalls);
    if (quote) {
      await safe('persist.quote', () =>
        bridge.pushQuoteEvent({
          phone: from,
          channel: 'whatsapp',
          customer_name: newState.name || 'Cliente WhatsApp',
          amount_total: quote.total || quote.grand_total || null,
          currency: 'CLP',
          status: 'draft',
          payload: { comuna: newState.comuna || '', quote },
        })
      );
    }

    // Evento de tracking (oliver_events) si el bridge expone el helper.
    if (typeof bridge.logOliverEvent === 'function') {
      await safe('persist.event', () =>
        bridge.logOliverEvent('turn_completed', {
          phone: from,
          tool_calls: toolCalls.map((t) => t.name),
          has_quote: !!quote,
        })
      );
    }

    // ── (9) Guardar el cache actualizado + persistir en Postgres ─────────
    const trimmed =
      newHistory.length > MAX_HISTORY ? newHistory.slice(-MAX_HISTORY) : newHistory;
    const sessionToSave = {
      history: trimmed,
      state: { ...newState, lastMessageAt: Date.now() },
    };
    conv.set(from, sessionToSave);
    // Persistencia remota fire-and-forget (F2-1): no bloquea el turno.
    persistSessionFn(from, sessionToSave, deps);
  } catch (err) {
    // Fail-safe absoluto: el 200 ya se envió; jamás relanzamos.
    log('error', 'handleWebhook', err);
  } finally {
    // Liberar SIEMPRE el lock: cubre returns intermedios (rate-limit, takeover,
    // sin userText) y excepciones. Sin esto un takeover dejaba el lock colgado.
    if (releaseLock) { try { releaseLock(); } catch { /* ya liberado */ } }
  }
}

export default { handleWebhook };
