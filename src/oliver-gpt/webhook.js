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
import { mantenerEscribiendo, conPausaHumana, enviarComoPersona } from '../../services/presenciaHumana.js';
import { getClient as realGetClient } from './engine.js';
import { parseExcelWindows } from './parseExcel.js';
import {
  parseInbound as realParseInbound,
  sendWhatsAppText as realSendWhatsAppText,
  sendWhatsAppImageUrl as realSendImageUrl,
  sendWhatsAppVideoUrl as realSendVideoUrl,
  sendWhatsAppDocumentUrl as realSendDocumentUrl,
  uploadWaAudio as realUploadWaAudio,
  sendWaAudio as realSendWaAudio,
  uploadWaDocument as realUploadWaDocument,
  sendWaDocument as realSendWaDocument,
} from '../sales-agent/whatsapp-adapter.js';
import { generatePremiumQuotePdf as realGeneratePdf } from '../../services/quotePdf.js';
import { priceAllEngine } from '../../services/enginePricer.js'; // [2026-06-24] blindaje label↔precio en generarPdf
import { saveMedia } from '../../mediaStore.js'; // [#5] persistir media ENTRANTE (foto/audio/plano) para el cockpit
import { upsertZohoDeal as realUpsertZohoDeal, addZohoNote as realAddZohoNote, attachPdfToDeal as realAttachPdfToDeal, attachInboundToDeal, archivarEnWorkDrive } from '../../services/zohoCommercial.js';
import {
  shouldSendVoice as realShouldSendVoice,
  synthesizeVoiceBuffer as realSynthesizeVoiceBuffer,
} from '../../services/voiceBridge.js'; // [F4] voz saliente
import * as realBridge from '../../services/salesOsBridge.js';
import { notifyHighValue as realNotifyHighValue } from '../../services/highValueNotifier.js';
import { isPdfAffirmative, lastAssistantOfferedPdf, itemsFromQuoteCalls, stripMontos, stripAccionesFalsas, quoteDataComplete } from './pdf-intent.js'; // [PDF-01] PDF determinista compartido con channel-agent · [Ronda 4] anti acciones-falsas
import { toFile as realToFile } from 'openai/uploads';
import {
  loadSession as realLoadSession,
  persistSession as realPersistSession,
  resetIfInactive,
} from './session-store.js';
import { parseReferral, buildCtwaLeadPayload } from '../../services/ctwaReferral.js'; // [F3b] CTWA
import { saludoForReferral } from '../../services/ctwaSaludos.js'; // [2026-07-18] saludo por ángulo Ronda 1
import { parseLandingRef, buildLandingLeadPayload } from '../../services/landingRefParser.js'; // [2026-07-02] atribución orgánica landing→WA
import { isVisionUnreadable } from '../../services/oliverVision.js'; // [F3b] detector imagen ilegible
import { isEscalationRequest, escalationMessage, sendEscalationTemplate } from './escalation.js'; // [2026-06-18] escalación determinista compartida

/* =========================================================================
 * CONFIG
 * ========================================================================= */

// [2026-06-24] Deriva UNA apertura clara del texto de un label de producto (o null si no hay
// exactamente una). Mismo criterio que el guard de agent.js. Se usa para el blindaje label↔precio
// del PDF: solo validamos ítems cuya apertura es inequívoca (si no, no tocamos → conservador).
function aperturaFromLabel(text) {
  const t = String(text || '').toLowerCase();
  const f = new Set();
  if (/\boscilo\s?batient/.test(t)) f.add('OSCILOBATIENTE');
  if (/\bproyectant/.test(t)) f.add('PROYECTANTE');
  if (/\bcorrediz/.test(t) || /\bcorrederas?\b/.test(t) || /\bdeslizant/.test(t) || /\bsliding\b/.test(t)) f.add('CORREDERA');
  if (/\bbatient/.test(t) && !/\boscilo/.test(t)) f.add('BATIENTE');
  if (/\bfij[ao]s?\b/.test(t)) f.add('FIJA');
  return f.size === 1 ? [...f][0] : null;
}

const META = {
  VER: process.env.META_GRAPH_VERSION || 'v22.0',
  TOKEN: process.env.WHATSAPP_TOKEN,
};
const VISION_MODEL = () => process.env.AI_MODEL_OPENAI || 'gpt-4o';
const STT_MODEL = () => process.env.STT_MODEL || 'whisper-1';

// Tope de elementos guardados por conversación (bound de tokens del piloto).
const MAX_HISTORY = 40;

// [2026-07-06 LOTE2] Tope GLOBAL de alertas a Marcelo por respuesta vacía: si el fallo es sistémico
// (proveedor caído), 20 clientes mudos NO pueden ser 20 WhatsApp al dueño (abogado del diablo). Máx 3/h.
const REPLY_EMPTY_ALERTS = { windowStart: 0, count: 0 };
function replyEmptyAlertAllowed() {
  const now = Date.now();
  if (now - REPLY_EMPTY_ALERTS.windowStart > 3600000) { REPLY_EMPTY_ALERTS.windowStart = now; REPLY_EMPTY_ALERTS.count = 0; }
  REPLY_EMPTY_ALERTS.count += 1;
  return REPLY_EMPTY_ALERTS.count <= 3;
}

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
// [2026-06-14] Anti-duplicado de cotización: phone → { quote_number, at }.
// Evita quemar un correlativo ISO nuevo por doble "confirmo", reintentos o
// re-cálculo por pérdida de estado (el bug que generó 0003 y 0004 en el mismo chat).
const RECENT_QUOTES = new Map();
const QUOTE_DEDUP_MS = 120000; // 2 min
const CONTROL_CACHE = new Map(); // [FIX 2026-06-19 CON-02] último control conocido por waId → fail-closed hacia el operador si sales-os cae

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
    signal: AbortSignal.timeout(12000), // [FIX 2026-06-19 VIS-01] sin timeout, un cuelgue de Meta bloqueaba el lock del cliente
  });
  if (!metaRes.ok) throw new Error(`media_meta_${metaRes.status}`);
  const meta = await metaRes.json();
  const url = meta?.url;
  const mime = meta?.mime_type || 'application/octet-stream';
  if (!url) throw new Error('media_url_missing');
  // 2) Descargar el binario (requiere el mismo Bearer).
  const blobRes = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
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
              'Eres un lector experto de planos y listados de ventanas/puertas. Extrae TODAS las filas, sin omitir ninguna. ' +
              'Para CADA ventana/puerta lista una línea con: identificador (V1, V2… si aparece), tipo de apertura ' +
              '(corredera/fija/proyectante/abatir/oscilobatiente), medidas ancho x alto TAL CUAL aparezcan (mm o cm), ' +
              'cantidad y color. Si un dato no aparece, escribe "NO ESPECIFICADO" pero NO borres la fila. ' +
              'Formato por ítem: <id> | <tipo> | <ancho>x<alto> | cant <n> | <color>. ' +
              'NO resumas ni agrupes: lista cada ítem por separado. Responde solo con las filas, en español.',
          },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}`, detail: 'high' } },
        ],
      },
    ],
    max_tokens: 4096,
  }, { timeout: 30000 }); // [FIX 2026-06-19 VIS-01] si la visión cuelga, no bloquea el lock del cliente
  const raw = (r.choices?.[0]?.message?.content || '').trim();
  // [F3b] Si la visión devolvió rechazo / vacío / sin medidas → marcar ilegible.
  // Evita que el orquestador confirme medidas que nunca llegaron (anti-alucinación).
  if (isVisionUnreadable(raw)) {
    // [2026-07-06 OBS] Log del crudo para diagnosticar rachas de ilegibles (caso Flavio: 15/15 en 2 min,
    // sin saber si fue rechazo del modelo o texto sin medidas). Solo observabilidad, cero cambio de flujo.
    try { log('warn', 'vision.unreadable', { len: raw.length, snippet: raw.slice(0, 180) }); } catch {}
    return '[Imagen no legible]';
  }
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
  }, { timeout: 25000 }); // [FIX 2026-06-19 VIS-01] timeout STT — evita lock colgado
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
      // [#5-robustez 2026-06-21] La visión puede fallar (ej: sin saldo OPENAI_API_KEY). Aislamos el
      // describe en su propio try → así el saveMedia de abajo SIEMPRE corre (el operador ve la foto
      // aunque la IA esté caída, que es justo cuando MÁS lo necesita).
      let desc = '';
      try { desc = await (deps.describeImage || describeImage)(buffer, mime, deps); }
      catch (e) { log('error', 'media.image.vision', e); }
      // [#5] Persistir la imagen ENTRANTE (aunque sea ilegible o la visión falle) para que el operador la vea. Fire-and-forget.
      saveMedia({ phone: raw?.from, direction: 'inbound', mediaType: 'image', mimeType: mime,
        filename: `inbound_${raw?.from || 'wa'}_${mediaId}.jpg`, buffer, waMediaId: mediaId,
        aiDescription: (desc && desc !== '[Imagen no legible]') ? desc : '[imagen recibida]' }).catch(() => {});
      // [B1 2026-06-25] Adjuntar la imagen al Deal de Zoho CRM si ya existe (no force-crea). Fire-and-forget.
      attachInboundToDeal(raw?.from, buffer, `inbound_${raw?.from || 'wa'}_${mediaId}.jpg`, mime).catch(() => {});
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
      // [#5-robustez 2026-06-21] STT puede fallar (ej: sin saldo OPENAI_API_KEY). Aislamos la
      // transcripción → el saveMedia de abajo SIEMPRE corre (el operador escucha el audio aunque la IA esté caída).
      let transcript = '';
      try { transcript = await (deps.transcribeAudio || transcribeAudio)(buffer, mime, deps); }
      catch (e) { log('error', 'media.audio.stt', e); }
      // [#5] Persistir el audio ENTRANTE + su transcripción para el cockpit. Fire-and-forget.
      saveMedia({ phone: raw?.from, direction: 'inbound', mediaType: 'audio', mimeType: mime,
        filename: `inbound_${raw?.from || 'wa'}_${mediaId}.ogg`, buffer, waMediaId: mediaId,
        transcription: transcript || '', aiDescription: transcript || '[audio recibido]' }).catch(() => {});
      // [B1 2026-06-25] Adjuntar el audio al Deal de Zoho CRM si ya existe (no force-crea). Fire-and-forget.
      attachInboundToDeal(raw?.from, buffer, `inbound_${raw?.from || 'wa'}_${mediaId}.ogg`, mime).catch(() => {});
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

  // [#5] Documento entrante: persistir para el cockpit. Si es EXCEL con lista de ventanas → LEERLO y cotizar.
  if (type === 'document') {
    const raw = rawMessage(body);
    const mediaId = raw?.document?.id;
    const fn = raw?.document?.filename || `inbound_${raw?.from || 'wa'}_${mediaId}.bin`;
    if (mediaId) {
      try {
        const { buffer, mime } = await downloadWaMedia(mediaId, deps);
        saveMedia({ phone: raw?.from, direction: 'inbound', mediaType: 'document', mimeType: mime,
          filename: fn, buffer, waMediaId: mediaId, aiDescription: `Documento/plano entrante: ${fn}` }).catch(() => {});
        // [B1 2026-06-25] Adjuntar el documento al Deal de Zoho CRM si ya existe (no force-crea). Fire-and-forget.
        attachInboundToDeal(raw?.from, buffer, fn, mime).catch(() => {});
        // [2026-06-22 FIX] Si es Excel, LEER la lista de ventanas y cotizar (antes: pedía reescribir a mano → se perdían clientes).
        const esExcel = /\.xlsx?$/i.test(fn) || /spreadsheet|excel/i.test(mime || '');
        if (esExcel && buffer) {
          try {
            const parsed = parseExcelWindows(buffer);
            if (parsed.ok && parsed.items.length) {
              log('info', 'media.document.excel', `parseadas ${parsed.items.length} ventanas de ${fn}`);
              return { userText: parsed.promptText, mediaResolved: true };
            }
            log('info', 'media.document.excel', `no se pudo extraer lista (${parsed.reason || 'desconocido'}) — fallback a pedir texto`);
          } catch (e) { log('error', 'media.document.excel', e); }
        }
      } catch (err) { log('error', 'media.document', err); }
    }
    return {
      userText:
        'El cliente envió un documento/plano. Pídale, de forma amable, que confirme por texto el tipo de ventana, ' +
        'las medidas (ancho x alto), la cantidad y el color de cada una para poder cotizar.',
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

const ATTRIBUTION_STATE_KEYS = [
  'ctwa_clid', 'ad_id', 'gclid', 'fbclid', 'ttclid',
  'landing_lead_id', 'landingRefCaptured', 'ctwaCaptured',
];

// Copia solo valores presentes: un fetch parcial nunca borra atribucion ya persistida.
function copyAttributionState(target, source) {
  if (!target || typeof target !== 'object' || !source || typeof source !== 'object') return target;
  for (const key of ATTRIBUTION_STATE_KEYS) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') target[key] = value;
  }
  return target;
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
  // [2026-08-08] Mismo motivo que releaseLock: declarado FUERA del try para que el finally
  // corte el "escribiendo…" ante cualquier return intermedio o excepción. Si no, el cliente
  // ve a Oliver "escribiendo" hasta que Meta lo apaga a los 25 s — peor que no mostrarlo.
  let _detenerEscribiendo = () => {};
  try {
    const parseInbound    = deps.parseInbound    || realParseInbound;
    // [2026-08-08] conPausaHumana: espera lo que un humano tardaría en tipear ese texto
    // antes de mandarlo. Se envuelve ACÁ, en la constante local, porque los ~15 puntos de
    // envío del handler pasan todos por ella — un solo wrap los cubre a todos.
    // Un cliente notó que era IA "porque contestaron en el mismo momento". Ver
    // services/presenciaHumana.js. Apagable con OLIVER_PRESENCIA_HUMANA=false.
    const sendWhatsAppText = conPausaHumana(deps.sendWhatsAppText || realSendWhatsAppText);
    // [2026-08-08] SIN pausa: para lo que NO va a un cliente. Las alertas de
    // notifyHighValue van al celular de Marcelo (OWNER_PHONE, ver
    // services/highValueNotifier.js:241) — simular que un humano las tipea le retrasa
    // 5-6 s un aviso urgente sin engañar a nadie. (P2 de Codex, 2026-08-08.)
    const enviarSinPausa = deps.sendWhatsAppText || realSendWhatsAppText;
    const uploadWaAudio   = deps.uploadWaAudio   || realUploadWaAudio;
    const sendWaAudio     = deps.sendWaAudio     || realSendWaAudio;
    const uploadWaDocument = deps.uploadWaDocument || realUploadWaDocument;
    const sendWaDocument   = deps.sendWaDocument   || realSendWaDocument;
    const generatePdf      = deps.generatePdf      || realGeneratePdf;
    const upsertZohoDeal   = deps.upsertZohoDeal   || realUpsertZohoDeal;
    const addZohoNote      = deps.addZohoNote      || realAddZohoNote;
    const attachPdfToDeal  = deps.attachPdfToDeal  || realAttachPdfToDeal;
    const shouldSendVoice = deps.shouldSendVoice || realShouldSendVoice;
    const synthesizeVoiceBuffer = deps.synthesizeVoiceBuffer || realSynthesizeVoiceBuffer;
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

    const { from, msgId, push_name } = inbound; // push_name = nombre de perfil WhatsApp (fallback de nombre del cliente)

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
    const control = await safe('control', () => bridge.getConversationControl(from, 'whatsapp'));
    // [FIX 2026-06-19 CON-02] Fail-CLOSED hacia el operador: si la lectura del control falló
    // (sales-os caído / _error) y la última vez vimos takeover humano, NO respondemos encima del
    // operador (antes: fail-OPEN → el bot pisaba la negociación y arruinaba el cierre). Idéntico a channel-agent.js.
    let effectiveControl = control;
    if (!control || control._error) {
      const cached = CONTROL_CACHE.get(from);
      if (cached && (cached.ai_paused === true || (cached.operator_status && cached.operator_status !== 'ai'))) {
        effectiveControl = { ai_paused: true, operator_status: cached.operator_status || 'human', _fromCache: true };
        log('info', 'control.failclosed', `control no disponible; respeto takeover cacheado para ${from}`);
      }
    } else {
      CONTROL_CACHE.set(from, { ai_paused: control.ai_paused === true, operator_status: control.operator_status || 'ai' });
      if (CONTROL_CACHE.size > 5000) CONTROL_CACHE.clear();
    }
    const aiPaused =
      !!effectiveControl &&
      (effectiveControl.ai_paused === true ||
        (effectiveControl.operator_status && effectiveControl.operator_status !== 'ai'));

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
      // [FIX 2026-06-25 MEDIA-PAUSE] Capturar TAMBIÉN el adjunto cuando la IA está pausada (takeover humano).
      // BUG: este return salía ANTES de resolveUserText (↓ línea ~569) → downloadWaMedia + saveMedia NUNCA
      // corrían → el archivo del cliente se PERDÍA justo cuando un humano atiende (caso Nicolle: documento
      // mostrado como "no vinculable" en el cockpit). NO invoca la IA (respeta el takeover): solo descarga el
      // binario y lo persiste para que el operador lo vea. El ACK a Meta ya se envió arriba (res.sendStatus 200).
      // [REVISIÓN 2026-06-25] FIRE-AND-FORGET (SIN await): descargar el media puede tardar hasta ~27s (CDN Meta);
      // con await se retendría el lock del cliente y el operador vería sus mensajes siguientes con retraso. Se
      // dispara en background con su propio try/catch (safe) + los timeouts internos de downloadWaMedia.
      if (inbound.type === 'image' || inbound.type === 'audio' || inbound.type === 'document') {
        safe('control.captureMedia', async () => {
          const raw = rawMessage(req.body);
          const node = raw?.[inbound.type];            // raw.image / raw.audio / raw.document
          const mediaId = node?.id;
          if (!mediaId) return;
          const { buffer, mime } = await downloadWaMedia(mediaId, deps);
          const ext = inbound.type === 'image' ? 'jpg' : inbound.type === 'audio' ? 'ogg' : 'bin';
          const filename = node?.filename || `inbound_${from}_${mediaId}.${ext}`;
          await saveMedia({
            phone: from, direction: 'inbound', mediaType: inbound.type, mimeType: mime,
            filename, buffer, waMediaId: mediaId,
            aiDescription: `Adjunto recibido con IA pausada (operador): ${filename}`,
          });
          // [B1 2026-06-25] Adjuntar al Deal de Zoho CRM si ya existe (operador atendiendo un deal activo).
          attachInboundToDeal(from, buffer, filename, mime).catch(() => {});
        });
      }
      // [Ronda 2 2026-07-20] Capturar la atribución CTWA TAMBIÉN durante takeover: el primer
      // contacto pagado mientras un humano atiende salía por este return ANTES del bloque (4b)
      // y el ctwa_clid se perdía para siempre. Solo ingesta el lead (leads.ctwa_clid vía
      // COALESCE en sales-os); NO toca la sesión ni invoca la IA (respeta el takeover).
      // [Ronda 2.1 — Codex] CON await: fire-and-forget antes de un return podía morir con
      // un redeploy/crash inmediato y perder la captura (el ACK a Meta ya se envió arriba).
      // [Ronda 2.2 — Codex] tope de 5s: sin él, los retries del bridge retenían el mutex
      // del teléfono hasta ~21,5s y el operador veía el mensaje SIGUIENTE con retraso.
      // El POST típico cierra <1s; si excede el tope, el envío SIGUE en background (safe
      // no se cancela) y solo se libera el lock — degrada al comportamiento anterior.
      {
        const _capture = safe('control.ctwaCapture', () => {
          const _raw = rawMessage(req.body);
          const _ref = _raw ? (deps.parseReferral || parseReferral)(_raw) : null;
          if (_ref && _ref.isCtwaAd) {
            const _bridge = deps.bridge || realBridge;
            return _bridge.pushLeadEvent(
              (deps.buildCtwaLeadPayload || buildCtwaLeadPayload)(from, _ref, { name: '' })
            );
          }
        });
        let _capTimer = null;
        await Promise.race([
          _capture,
          new Promise((resolve) => { _capTimer = setTimeout(resolve, 5000); }),
        ]).finally(() => { if (_capTimer) clearTimeout(_capTimer); });
      }
      log('info', 'control', `IA pausada (takeover humano) para ${from}; inbound persistido`);
      return;
    }

    // ── (3b) "escribiendo…" + doble check azul ──────────────────────────
    // [2026-08-08] Arranca ACÁ y no antes, a propósito: recién en este punto sabemos que
    // la IA VA a responder. Puesto antes del chequeo de takeover, un cliente atendido por
    // Marcelo veía a Oliver "escribiendo…" y el doble check azul, y no llegaba nada nunca
    // — peor que no mostrar nada. (P1 de Codex, 2026-08-08.)
    // Meta lo apaga solo a los 25 s; el loop lo refresca cada 18. El stop() va en el
    // finally del handler y aborta también cualquier POST en vuelo.
    // Nota: el mismo POST lleva status:"read" ⇒ también le deja el doble check azul.
    try { _detenerEscribiendo = mantenerEscribiendo(msgId); } catch { /* cosmético */ }

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
    const state = {
      ...baseState,
      telefono: from,
      fecha: new Date().toISOString(),
      ctwa_clid: baseState.ctwa_clid || null,
      ad_id: baseState.ad_id || null,
      gclid: baseState.gclid || null,
      fbclid: baseState.fbclid || null,
      ttclid: baseState.ttclid || null,
    };
    // [Ronda 2 2026-07-20] Higiene: el flag one-shot del saludo JAMÁS debe venir hidratado
    // de Postgres (vive en variable local este turno). Si una versión vieja lo persistió,
    // se descarta acá — mata el "saludo tardío fantasma" señalado en revisión cruzada.
    delete state.ctwa_saludo_pending;

    // ── (4b) CTWA — Captura atribución Meta Ads (Click-to-WhatsApp). ────────
    // Solo en el primer mensaje con referral de la sesión (flag ctwaCaptured,
    // ya hidratado en state). Fire-and-forget vía safe(): no bloquea ni tumba.
    // Espeja index.js ~L4901-4913 usando el bridge probado (pushLeadEvent).
    // [tribunal 2026-07-18] El saludo por ángulo vive en variable LOCAL hasta justo
    // antes de handleTurn: así ningún early-return determinista (escalación, img-loop,
    // PDF) puede persistir el flag y resucitar el saludo en un turno posterior.
    let _ctwaSaludoTurn = null;
    try {
      const _rawMsg = rawMessage(req.body);
      if (_rawMsg) {
        const _ref = (deps.parseReferral || parseReferral)(_rawMsg);
        // [Ronda 2 2026-07-20] Re-atribución: un cliente que VUELVE clickeando OTRO anuncio
        // (ctwa_clid o ad_id distinto) refresca la atribución — antes ctwaCaptured congelaba
        // el click viejo para siempre y la cotización nueva se atribuía al anuncio antiguo
        // (hallazgo cruzado Codex). El saludo sigue gateado por history vacío más abajo:
        // el cliente antiguo NUNCA recibe re-saludo, solo se actualiza la atribución.
        const _refNuevo = _ref && _ref.isCtwaAd && (
          !state.ctwaCaptured ||
          (_ref.ctwaClid && _ref.ctwaClid !== state.ctwa_clid) ||
          (_ref.adId && String(_ref.adId) !== String(state.ad_id || ''))
        );
        if (_refNuevo) {
          state.ctwaCaptured = true;
          // [Ronda 2.1 — Codex] PRESERVAR el ID previo cuando el referral nuevo no lo trae:
          // un referral con solo ad_id nuevo NO debe pisar un ctwa_clid bueno con null
          // (regresión bloqueante reproducida en la revisión cruzada).
          state.ctwa_clid = _ref.ctwaClid || state.ctwa_clid || null;
          state.ad_id = _ref.adId || state.ad_id || null;
          const _bridge = deps.bridge || realBridge;
          const _payload = (deps.buildCtwaLeadPayload || buildCtwaLeadPayload)(
            from, _ref, { name: state.name || '' }
          );
          safe('ctwa.ingest', () => _bridge.pushLeadEvent(_payload));
          log('info', 'ctwa_attribution',
            `Lead CTWA capturado tel=${from} ad=${_ref.adId || '?'} clid=${_ref.ctwaClid ? 'sí' : 'no'}`);
          // [2026-07-18] Saludo por ángulo del anuncio (Ronda 1): Oliver abre coherente
          // con el anuncio que el cliente clickeó (anuncio→saludo→cotización).
          // Sin match/killswitch → saludo normal, cero cambio.
          // [tribunal] SOLO conversación NUEVA (history vacío): un cliente antiguo que
          // clickea el anuncio (retargeting) NO recibe el saludo frío a mitad de hilo
          // (violaría la ⛔ ANTI-RE-SALUDO). La atribución de arriba se captura igual.
          const _sal = (deps.saludoForReferral || saludoForReferral)(_ref);
          if (_sal) {
            state.ctwa_angle = _sal.angle; // persiste siempre: análisis/coherencia futura
            if (history.length === 0) {
              _ctwaSaludoTurn = _sal.saludo; // local: entra al state recién antes de handleTurn
              log('info', 'ctwa_saludo', `Saludo por ángulo '${_sal.angle}' para ${from}`);
            }
          }
        }
      }
    } catch (e) {
      log('error', 'ctwa.capture', e);
    }

    // ── (4c) LANDING REF — Atribución ORGÁNICA (landing V3 → wa.me con [Ref:uuid]). ──
    // [2026-07-02] El espejo del bloque CTWA de arriba, para SEO: las landings YA agregan el tag
    // al link de WhatsApp (injectRef v5.1.0) pero este tramo nunca se codeó → 0 leads orgánicos
    // atribuibles en toda la BD (auditoría). El tag se QUITA del texto ANTES de armar userText:
    // ni el cliente, ni el operador, ni el LLM lo ven jamás. El GET se comparte con los
    // consumidores de atribución; los POST auxiliares siguen fire-and-forget y fail-safe.
    let landingAttributionReady = Promise.resolve();
    try {
      if (inbound?.text && !state.landingRefCaptured) {
        const _lref = (deps.parseLandingRef || parseLandingRef)(inbound.text);
        if (_lref.hasRef) {
          state.landingRefCaptured = true;
          state.landing_lead_id = _lref.leadId;
          inbound.text = _lref.cleanText; // strip: el resto del pipeline no ve el tag
          const _bridge = deps.bridge || realBridge;
          const _cxmBase = (process.env.UNIFIED_CXM_BASE_URL || 'https://unified-cxm-ads-flow-production.up.railway.app').replace(/\/$/, '');
          const _apiKey = process.env.DASHBOARD_API_KEY || process.env.UNIFIED_CXM_DASHBOARD_API_KEY || '';
          landingAttributionReady = safe('landing_ref.context', async () => {
            // 1) contexto de la landing (slug/servicio/comuna) desde el collector del CXM
            let ctx = { lead_id: _lref.leadId };
            if (_apiKey) {
              try {
                const r = await fetch(`${_cxmBase}/api/lead-event/ref/${encodeURIComponent(_lref.leadId)}`, {
                  headers: { 'x-api-key': _apiKey }, signal: AbortSignal.timeout(4000),
                });
                if (r.ok) { const j = await r.json(); if (j?.lead || j?.ok) ctx = { ...ctx, ...(j.lead || j) }; }
              } catch (e) { log('error', 'landing_ref.fetch', e); }
            }
            copyAttributionState(state, ctx);
            safe('landing_ref.ingest', async () => {
              // 2) evento quote_started en landing_events (mismo collector público del beacon):
              //    "el lead ESCRIBIÓ a Oliver desde esta landing" — cierra leads_count por slug.
              try {
                await fetch(`${_cxmBase}/api/lead-event`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    lead_id: _lref.leadId, event_name: 'quote_started',
                    event_id: `oliver_wa_${_lref.leadId}`,
                    landing_slug: ctx.landing_slug || null,
                    landing_servicio: ctx.service || ctx.landing_servicio || null,
                    landing_comuna: ctx.comuna || ctx.landing_comuna || null,
                  }),
                  signal: AbortSignal.timeout(4000),
                });
              } catch (e) { log('error', 'landing_ref.event', e); }
              // 3) lead en sales-os con source=landing_organic (mismo bridge probado del CTWA)
              await _bridge.pushLeadEvent(
                (deps.buildLandingLeadPayload || buildLandingLeadPayload)(from, ctx, { name: state.name || '' })
              );
            });
          });
          log('info', 'landing_ref_attribution', `Lead ORGÁNICO capturado tel=${from} lead_id=${_lref.leadId}`);
        }
      }
    } catch (e) {
      log('error', 'landing_ref.capture', e);
    }

    // ── (5) MEDIA → userText útil (vision / STT). Resuelve la ceguera V2. ─
    const { userText, mediaResolved } = await resolveUserText(inbound, req.body, deps);
    if (!userText) {
      await landingAttributionReady;
      // [Ronda 2 2026-07-20] También persistir cuando la captura fue CTWA (antes solo
      // landing-ref): un primer mensaje de anuncio SIN texto útil (imagen sin caption con
      // visión caída) perdía el ctwa_clid recién capturado — reproducido en revisión cruzada.
      if (state.landingRefCaptured || state.ctwaCaptured) {
        const attributionOnly = { history, state: { ...state, lastMessageAt: Date.now() } };
        conv.set(from, attributionOnly);
        persistSessionFn(from, attributionOnly, deps);
      }
      return;
    }

    // ── (5a) [FIX 2026-06-19] Comando RESET — paridad con IG/FB (channel-agent.js). Limpia la
    //    sesión (cache + Postgres) → la próxima conversación arranca limpia, SIN re-saludo heredado.
    //    Antes WhatsApp NO tenía este comando → "reset" caía al cerebro y re-saludaba (visto en test en vivo).
    if (/^\s*reset(ear)?\s*$/i.test(userText)) {
      conv.delete(from);
      persistSessionFn(from, { history: [], state: {} }, deps);
      const resetMsg = 'Listo, partimos de cero 🙌 ¿En qué te ayudo con tus ventanas?';
      await safe('reset.send', () => sendWhatsAppText(from, resetMsg));
      await safe('reset.persistIn', () => bridge.pushConversationEvent({
        channel: 'whatsapp', external_id: from, direction: 'inbound', actor_type: 'customer',
        actor_name: 'Cliente', message_type: inbound.type || 'text', body: userText,
        metadata: { source: 'oliver_gpt_webhook', msg_id: msgId, command: 'reset' },
      }));
      log('info', 'reset', `sesión ${from} reiniciada por comando del cliente`);
      return; // el finally libera el lock
    }

    // ── (5a2) [2026-07-06 LOTE2] ANTI-LOOP de imágenes ilegibles ─────────
    // Caso real (Flavio, 15 fotos en 2 min): la visión falló en TODAS y Oliver repitió ~14 veces
    // "no me llegan" (FALSO: sí llegan y quedan en el panel vía saveMedia). Determinista, antes del
    // cerebro. Racha: 1ª = flujo normal (el cerebro pide texto); 2ª = escalar UNA vez a Marcelo y
    // avisar honesto (la promesa "se las paso a Marcelo" SOLO si la escalación realmente salió —
    // notifyHighValue retorna {sent}); 3ª+ = acuse breve cada 5, silencio el resto (ya avisamos).
    // El lock por cliente serializa la ráfaga → el contador no corre riesgo de carrera.
    const esImagenIlegible = inbound.type === 'image' && mediaResolved === false;
    state.unreadable_streak = esImagenIlegible ? (Number(state.unreadable_streak) || 0) + 1 : 0;
    if (esImagenIlegible && state.unreadable_streak >= 2) {
      // [escéptico L2] SIEMPRE persistir el inbound en el timeline del panel (como reset/escalación) —
      // sin esto, las fotos de los turnos silenciosos desaparecen del hilo que el operador reconstruye.
      await safe('imgloop.persistIn', () => bridge.pushConversationEvent({
        channel: 'whatsapp', external_id: from, direction: 'inbound', actor_type: 'customer',
        actor_name: 'Cliente', message_type: 'image', body: '[imagen no legible por IA]',
        metadata: { source: 'oliver_gpt_webhook', msg_id: msgId, img_unreadable_streak: state.unreadable_streak },
      }));
      let imgLoopMsg = null;
      if (state.unreadable_streak === 2) {
        const esc = await safe('imgloop.notify', () =>
          notifyHighValue(enviarSinPausa, from, { data: { ...state }, history },
            'oliver_gpt:imagenes_ilegibles — el cliente mandó varias fotos que la IA no pudo leer; las fotos SÍ están guardadas en el panel (media), cotizar desde ahí'));
        imgLoopMsg = (esc && esc.sent)
          ? 'Sus fotos SÍ quedaron guardadas de mi lado 👍 — se las paso a Marcelo para que le prepare la propuesta desde ahí. Si prefiere avanzar al tiro, también puede escribirme las medidas por texto (ancho × alto y tipo).'
          : 'Sus fotos quedaron guardadas 👍. Para avanzar de inmediato, ¿me escribe las medidas por texto? (ancho × alto, tipo de ventana y cantidad).';
      } else if (state.unreadable_streak % 5 === 0) {
        imgLoopMsg = 'Recibida 👍 — también quedó guardada para Marcelo.';
      }
      if (imgLoopMsg) {
        await safe('imgloop.send', () => sendWhatsAppText(from, imgLoopMsg));
        await safe('imgloop.persistOut', () => bridge.pushConversationEvent({
          channel: 'whatsapp', external_id: from, direction: 'outbound', actor_type: 'ai',
          actor_name: 'Oliver IA', message_type: 'text', body: imgLoopMsg,
          metadata: { source: 'oliver_gpt_webhook', img_unreadable_streak: state.unreadable_streak },
        }));
      }
      // Persistir el contador SIN pasar por el cerebro (el turno termina acá; el finally libera el lock).
      // [escéptico L2 — BLOQUEANTE] conv.set es OBLIGATORIO: el cache caliente gana sobre Postgres en el
      // próximo webhook — sin esto la racha se congelaba en 2 y se repetía el mensaje en cada foto
      // (el MISMO síntoma que este bloque arregla). + lastMessageAt como en el guardado normal.
      await landingAttributionReady;
      state.lastMessageAt = Date.now();
      conv.set(from, { history, state });
      persistSessionFn(from, { history, state }, deps);
      log('warn', 'imgloop', `racha de imágenes ilegibles=${state.unreadable_streak} para ${from}${imgLoopMsg ? '' : ' (silencio deliberado)'}`);
      return;
    }

    // ── (5b) ESCALACIÓN DETERMINISTA (no depende del LLM) ────────────────
    // [2026-06-18] Paridad con IG/FB (channel-agent.js): si el cliente pide humano/Marcelo
    // o está molesto, avisamos SIEMPRE + mensaje fijo correcto. En prod el LLM a veces NO
    // escalaba o respondía 'notificar_marcelo' como texto. La escalación es plata/reputación:
    // se maneja en CÓDIGO, no en el LLM. Mismo módulo compartido que IG/FB.
    const escalationTemplateFn = deps.sendEscalationTemplate || sendEscalationTemplate;
    if (isEscalationRequest(userText)) {
      await safe('escalate.notify', () =>
        notifyHighValue(enviarSinPausa, from, { data: { ...state }, history },
          'cliente pidió hablar con un humano / molesto'));
      await safe('escalate.template', () =>
        escalationTemplateFn(state.name || '', 'cliente pide hablar con humano'));
      const escMsg = escalationMessage();
      await safe('escalate.send', () => sendWhatsAppText(from, escMsg));
      await safe('escalate.persistIn', () => bridge.pushConversationEvent({
        channel: 'whatsapp', external_id: from, direction: 'inbound', actor_type: 'customer',
        actor_name: 'Cliente', message_type: inbound.type || 'text', body: inbound.text || userText,
        metadata: { source: 'oliver_gpt_webhook', msg_id: msgId, escalation: true },
      }));
      await safe('escalate.persistOut', () => bridge.pushConversationEvent({
        channel: 'whatsapp', external_id: from, direction: 'outbound', actor_type: 'ai',
        actor_name: 'Oliver', message_type: 'text', body: escMsg,
        metadata: { source: 'oliver_gpt_webhook', escalation: true },
      }));
      await landingAttributionReady;
      const escHist = [...history, { role: 'user', content: userText }, { role: 'assistant', content: escMsg }];
      const escStore = { history: escHist.length > MAX_HISTORY ? escHist.slice(-MAX_HISTORY) : escHist,
                         state: { ...state, lastMessageAt: Date.now() } };
      conv.set(from, escStore);
      persistSessionFn(from, escStore, deps);
      log('info', 'escalate', `escalación determinista para ${from}`);
      return; // el finally libera el lock
    }

    // ── (6) toolCtx cableado a servicios REALES ──────────────────────────
    const toolCtx = {
      telefono: from,

      // saveLead → pushLeadEvent (persistencia real del lead).
      saveLead: (leadState = {}) =>
        safe('saveLead', async () => {
          await landingAttributionReady;
          return bridge.pushLeadEvent({
            phone: from,
            channel: 'whatsapp',
            name: leadState.name || state.name || '',
            comuna: leadState.comuna || state.comuna || '',
            stage: leadState.stageKey || 'oliver_gpt',
            items: leadState.items || [],
            value: leadState.grand_total || null,
            ctwa_clid: leadState.ctwa_clid || state.ctwa_clid || null,
            ad_id: leadState.ad_id || state.ad_id || null,
            gclid: leadState.gclid || state.gclid || null,
            fbclid: leadState.fbclid || state.fbclid || null,
            ttclid: leadState.ttclid || state.ttclid || null,
            landing_ref: leadState.landing_ref || leadState.landing_lead_id || state.landing_lead_id || null,
            metadata: { source: 'oliver_gpt' },
          });
        }),

      // notifyMarcelo → escalación REAL (highValueNotifier a ESCALATION_PHONE).
      // highValueNotifier.notifyHighValue(waSendFn, customerPhone, session, reason).
      notifyMarcelo: (payload = {}) =>
        safe('notifyMarcelo', () =>
          notifyHighValue(
            // [2026-08-08] enviarSinPausa: esto termina en el celular de Marcelo
            // (ESCALATION_PHONE/OWNER_PHONE). Se le escapó a la primera corrección — los
            // otros 6 llamados sí se cambiaron y este quedó (P2 de Codex, 2ª pasada).
            enviarSinPausa, // waSendFn(to, body) — firma compatible
            from,
            {
              data: { ...state, ...(payload.data || {}) },
              history,
            },
            payload.reason || 'oliver_gpt_escalation'
          )
        ),

      // persistSession → no-op DELIBERADO [tribunal 2026-07-18]. agent.js llama
      // toolCtx.persistSession(nextState) con el STATE PLANO (sin {history,state}):
      // persistSessionFn leía undefined/undefined y hacía PUT {history:[],data:{}} →
      // BORRABA la sesión remota a mitad de turno; si el persist final (9) fallaba o
      // Railway redeployaba en esa ventana, amnesia total del cliente. El webhook YA
      // persiste el estado completo al final de cada camino (precedente idéntico:
      // channel-agent.js). NO "arreglar" el shape acá: persistiría ctwa_saludo_pending
      // a mitad de turno (antes del delete one-shot) y reviviría el saludo.
      persistSession: () => Promise.resolve(),

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

      // generarPdf → orquesta los 6 pasos del PDF ISO:
      //   1) correlativo ISO (POST sales-os /internal/quotes/next-number)
      //   2) generar PDF premium (quotePdf.js)
      //   3) enviar al cliente vía WA (uploadWaDocument + sendWaDocument)
      //   4) registrar Deal/Note en Zoho CRM (zohoCommercial.js)
      //   5) archivar en WorkDrive (NO-BLOQUEANTE, inerte hasta re-autorización OAuth)
      //   6) disparar conversión multicanal (bridge.pushQuoteEvent → server fireConversion → CXM)
      //
      // ANTI-CROSS-INJECT: solo se envía al canal del click_id capturado en F3b.
      // Los unit_price de input.items DEBEN venir de calcular_cotizacion (nunca del LLM).
      generarPdf: (input = {}) =>
        safe('generarPdf', async () => {
          // ── GUARDIA ANTI-ALUCINACIÓN DE PRECIOS (regla del dueño: marcar/pedir, NUNCA rellenar) ──
          // Si algún ítem no trae unit_price>0 (que DEBE venir de calcular_cotizacion), NO se genera
          // el PDF ni se quema un correlativo ISO. Convierte la defensa de "solo prompt" a "prompt+código".
          const itemsBad = (input.items || []).filter((it) => !(Number(it.unit_price) > 0));
          if (!input.items?.length || itemsBad.length) {
            log('error', 'generarPdf.guard',
              `PDF abortado: ${itemsBad.length}/${input.items?.length || 0} ítems sin unit_price>0 (posible alucinación de precios)`);
            return { ok: false, reason: 'precios_no_validados', detail: 'unit_price debe venir de calcular_cotizacion, no inventado' };
          }

          // ── [PDF-RACE 2026-07-01] GUARD de COMPLETITUD: PDF formal SOLO con datos confirmados ──
          // Casos reales BD: 0081/0085/0086 (Ximena), 0060 (Vivi), 0090 (Julio) — el PDF salía ANTES
          // de que el cliente respondiera nombre/color/tipo. Sin nombre real o ítems incompletos:
          // NO se quema folio ISO; se devuelve message para que Oliver pida el dato que falta.
          const _gate = quoteDataComplete(input, state);
          if (!_gate.ok) {
            log('error', 'generarPdf.gate', `PDF bloqueado por datos incompletos: ${_gate.missing.join(', ')}`);
            return { ok: false, reason: 'datos_incompletos', missing: _gate.missing,
              message: _gate.missing.includes('name')
                ? '¿A nombre de quién emito la Propuesta Técnica Económica? Con eso te la envío al tiro.'
                : 'Antes de emitir la propuesta formal necesito confirmar un detalle de las ventanas. Ya te pregunto.' };
          }

          // ── [2026-07-06 LOTE2] Medidas RESUELTAS: "AxBmm" es el transporte INTERNO de la confirmación
          // de unidad. Acá se separa en campos numéricos (los guards de abajo re-cotizan EXACTO, sin
          // re-parsear heurísticas) + string limpio para display (Zoho/PDF/alertas ven "350x600").
          (input.items || []).forEach((it) => {
            const _mres = String(it.measures || '').match(/^\s*(\d+)x(\d+)mm\s*$/i);
            if (_mres) {
              it.ancho_mm = Number(it.ancho_mm) || Number(_mres[1]);
              it.alto_mm  = Number(it.alto_mm)  || Number(_mres[2]);
              it.measures = `${_mres[1]}x${_mres[2]}`;
            }
          });
          const _measuresForEngine = (it) =>
            (Number(it.ancho_mm) > 0 && Number(it.alto_mm) > 0) ? `${it.ancho_mm}x${it.alto_mm}mm` : (it.measures || '');

          // ── BLINDAJE label↔precio (2026-06-24) — INVARIANTE: el precio DEBE corresponder a la
          // apertura que el cliente VE en el label. Causa raíz del bug 0064/0065/0066: una FIJA salía
          // con precio de CORREDERA (~2x). Aquí, en el ÚNICO punto de salida del PDF (cubre LLM,
          // entrega determinista y pending_quote viejo de antes de un deploy), re-cotizamos en el
          // MOTOR la apertura del label y, si el precio recibido no corresponde, lo CORREGIMOS al del
          // motor (NUNCA inventado). Conservador: solo ítems con apertura inequívoca; si el motor
          // falla, NO bloquea (el PDF sale con el precio que vino). Soporta pedido mixto (ítem×ítem).
          try {
            const _val = (input.items || [])
              .map((it) => ({ it, ap: aperturaFromLabel(it.producto_label || it.product || '') }))
              .filter((x) => x.ap);
            if (_val.length) {
              const _probe = {
                items: _val.map((x) => ({
                  product:  x.it.producto_label || x.it.product,  // label completo → conserva variantes (hojas/riel)
                  measures: _measuresForEngine(x.it), // [LOTE2] resueltas exactas si existen (sin re-mangle ×10)
                  color:    x.it.color || '',
                  qty:      Number(x.it.qty) || 1,
                  ambiente: x.it.ambiente || '',
                })),
                comuna: input.comuna || state.comuna || '',
              };
              await priceAllEngine(_probe);
              _val.forEach((x, k) => {
                const expected = Number(_probe.items[k]?.unit_price) || 0;
                const got = Number(x.it.unit_price) || 0;
                if (expected > 0 && Math.abs(expected - got) > Math.max(500, expected * 0.02)) {
                  log('error', 'generarPdf.guard.apertura',
                    `PRECIO CORREGIDO label='${x.ap}' recibido=${got} motor=${expected} (${x.it.producto_label || x.it.product})`);
                  x.it.unit_price = expected; // precio REAL del motor para la apertura del label → coherente
                }
              });
            }
          } catch (e) {
            log('error', 'generarPdf.guard.apertura.err', e?.message || e); // no bloquear el PDF si el motor no responde
          }

          // ── [thermal 2026-06-25] Uw SIEMPRE del MOTOR, nunca del LLM ───────
          // Re-cotiza CADA ventana en el motor (priceAllEngine → /api/quotes/calculate)
          // y toma su `termico` REAL (Uw certificado). Oliver NO pasa nada térmico:
          // el Uw no puede depender de que el LLM lo copie (como pasó con la 0071).
          // ROBUSTO: todo en try/catch → si el motor falla, termico queda null y el
          // PDF sale igual (NUNCA roto). NO toca precios (solo escribe it.termico).
          // H98 (sin perfil en la API thermal) → motor devuelve termico null → no se muestra.
          try {
            const _therm = {
              items: (input.items || []).map((it) => ({
                product:  it.producto_label || it.product || '',
                measures: _measuresForEngine(it), // [LOTE2] resueltas exactas si existen (sin re-mangle ×10)
                color:    it.color || '',
                qty:      Number(it.qty) || 1,
                ambiente: it.ambiente || '',
              })),
              comuna: input.comuna || state.comuna || '',
            };
            await priceAllEngine(_therm);
            (input.items || []).forEach((it, k) => {
              it.termico = _therm.items[k]?.termico || null; // motor manda; sin termico → null
              // [2026-07-07] referencial = medida fuera de estándar (sobre máx o bajo mín). Motor-truth
              // para TODOS los ítems (no depende de que el LLM lo pase) → dispara la escalación de abajo.
              if (_therm.items[k]?.referencial) {
                it.referencial = true;
                it.measures_original = _therm.items[k].measures_original || it.measures_original || it.measures;
              }
            });
          } catch (e) {
            log('error', 'generarPdf.termico.err', e?.message || e); // jamás bloquea el PDF
          }

          // ── GUARD ANTI-DUPLICADO (2026-06-14 · v2 2026-06-15) ─────────────
          // Si ya se generó una cotización IDÉNTICA para este número en los últimos
          // 2 min, NO quemar otro correlativo ISO: devolver la existente. Cubre doble
          // "confirmo" y reintentos. FIX 2026-06-15: ahora compara el CONTENIDO — si el
          // cliente cambió algo (producto, medida, color, total: ej. corredera→abatiente),
          // NO es duplicado → se regenera el PDF corregido (antes el dedup lo bloqueaba).
          const _quoteSig = JSON.stringify({
            items: (input.items || []).map((it) => [
              it.producto_label || it.product || '', it.measures || '',
              it.color || '', Number(it.qty) || 1, Number(it.unit_price) || 0,
            ]),
            total: Number(input.grand_total) || 0,
          });
          const _prevQuote = RECENT_QUOTES.get(from);
          if (_prevQuote && (Date.now() - _prevQuote.at) < QUOTE_DEDUP_MS && _prevQuote.sig === _quoteSig) {
            log('info', 'generarPdf.dedup',
              `Cotización IDÉNTICA duplicada evitada para ${from}; reusando ${_prevQuote.quote_number}`);
            return { ok: true, quote_number: _prevQuote.quote_number, pdf_sent: false, deduped: true };
          }

          // ── Paso 1: Correlativo ISO ──────────────────────────────────────────
          const SALES_OS_URL = (process.env.SALES_OS_URL || '').replace(/\/$/, '');
          const OPERATOR_TOKEN = process.env.SALES_OS_OPERATOR_TOKEN || '';
          let quoteNumber = null;
          let descuentoMercadoPct = 0; // [2026-06-24] viene del correlativo → se muestra en el PDF
          // [PDF-RACE 2026-07-01] REUSAR el folio de la sesión (ventana 48h): una corrección del
          // cliente = REVISIÓN del MISMO folio, no correlativo nuevo (antes: 0081→0085→0086 en una
          // sola sesión = 3 folios ISO quemados para la misma propuesta).
          const QUOTE_REUSE_MS = 48 * 60 * 60 * 1000;
          const _lq = state.last_quote;
          if (_lq && _lq.quote_number && (Date.now() - (_lq.at || 0)) < QUOTE_REUSE_MS) {
            quoteNumber = _lq.quote_number;
            descuentoMercadoPct = Number(_lq.descuento_mercado_pct) || 0;
            log('info', 'generarPdf.folio', `Reusando folio de la sesión ${quoteNumber} para ${from} (revisión, no folio nuevo)`);
          }
          if (!quoteNumber) try {
            const correlativoRes = await fetch(
              `${SALES_OS_URL}/internal/quotes/next-number`,
              {
                method: 'POST',
                headers: { 'x-api-key': OPERATOR_TOKEN, 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenant_id: 'activa' }),
                signal: AbortSignal.timeout(8000),
              }
            );
            if (correlativoRes.ok) {
              const cj = await correlativoRes.json();
              quoteNumber = cj.quote_number || cj.number || null;
              descuentoMercadoPct = Number(cj.descuento_cliente_pct) || 0;
            }
          } catch (err) {
            log('error', 'generarPdf.correlativo', err);
          }
          if (!quoteNumber) {
            // [FIX 2026-06-19 SES-03/PDF-02] El correlativo ISO no respondió. NO emitir un folio
            // FANTASMA (CM-FR-004-...-FALLBACK-XXXX no queda en BD → viola ISO 9001 §7.5 y Zoho/CXM
            // no lo pueden correlacionar). Mejor: NO generar el PDF, avisar a Marcelo, y que el cliente
            // sepa que ya viene. Igual que channel-agent.js (IG/FB).
            log('error', 'generarPdf.correlativo', 'correlativo ISO no disponible — NO se emite PDF, se escala a Marcelo');
            await safe('generarPdf.correlativo.escalate', () =>
              notifyHighValue(enviarSinPausa, from, { data: { ...state }, history },
                '[whatsapp] cliente pidió su Propuesta Técnica Económica pero el correlativo ISO no respondió — emitirla desde el inbox (ops.activalabs.ai)'));
            return { ok: false, requiere_revision: true, reason: 'correlativo_no_disponible',
              message: 'Dame un momentito para emitir tu Propuesta Técnica Económica con su folio; si se demora, Marcelo te la hace llegar enseguida.' };
          }

          // Correlativo quemado → registrar (con firma de contenido) para el guard anti-duplicado.
          RECENT_QUOTES.set(from, { quote_number: quoteNumber, at: Date.now(), sig: _quoteSig });
          if (RECENT_QUOTES.size > 500) RECENT_QUOTES.clear(); // backstop de memoria

          // ── Paso 2: Generar PDF premium ──────────────────────────────────────
          const clientName  = input.name  || state.name  || push_name || 'Cliente';
          const clientPhone = input.phone || state.telefono || from;
          const clientComuna = input.comuna || state.comuna || '';
          const pdfData = {
            name:    clientName,
            phone:   clientPhone,
            comuna:  clientComuna,
            address: state.address || '',
            descuento_pct: Number(input.descuento_pct) || 0,   // descuento MANUAL adicional en la propuesta (0 = sin descuento)
            descuento_mercado_pct: descuentoMercadoPct,         // descuento de mercado YA aplicado a los precios (se MUESTRA al cliente)
            is_partial:   Boolean(input.is_partial),            // [2026-07-02 BUG parcial] parte del pedido escaló a Marcelo
            partial_note: String(input.partial_note || '').slice(0, 200),
            default_color: (input.items?.[0]?.color) || state.default_color || '',
            items:   (input.items || []).map((it) => ({
              product:        it.producto_label || it.product || 'Ventana',
              producto_label: it.producto_label || it.product || 'Ventana',
              measures:       it.measures || '',
              color:          it.color || '',
              qty:            Number(it.qty) || 1,
              unit_price:     Number(it.unit_price) || 0,  // NUNCA inventado: viene del motor
              glass_label:    it.glass_label || 'Termopanel DVH',
              ambiente:       it.ambiente || '',
              termico:        it.termico || null,   // [thermal] Uw aditivo (null = no se muestra)
            })),
            quote_num: quoteNumber,
          };
          const pdfBuffer = await generatePdf(pdfData, quoteNumber);

          // ── Paso 3: Enviar al cliente vía WhatsApp ───────────────────────────
          const filename = `${quoteNumber}.pdf`;
          const caption  = `Propuesta Técnica Económica N° ${quoteNumber} · Activa Inversiones`;
          let waDocMediaId = null;
          let docSent = false;   // ← refleja el ENVÍO REAL (sendWaDocument.ok), no solo el upload
          try {
            waDocMediaId = await uploadWaDocument(pdfBuffer, filename);
            const sendRes = await sendWaDocument(from, waDocMediaId, filename, caption);
            // sendWaDocument NO lanza: devuelve {ok:false} si Meta rechaza → hay que leerlo.
            docSent = !!(sendRes && sendRes.ok);
            if (docSent) {
              log('info', 'generarPdf.wa', `PDF enviado a ${from} media_id=${waDocMediaId} msgId=${sendRes.msgId || '?'}`);
            } else {
              log('error', 'generarPdf.wa', `Documento NO entregado a ${from}: ${sendRes?.error || 'sin detalle'}`);
            }
          } catch (err) {
            log('error', 'generarPdf.wa', err);
            // No bloqueamos: el CRM/conversión se disparan igualmente.
          }

          // ── Paso 3a: GUARDAR el PDF en sales-os para que el operador lo ABRA desde el cockpit ──
          // [FIX 2026-06-19] Antes el link /api/v5/media/{wa_media_id} daba "not found": el PDF se enviaba a
          // WhatsApp pero NUNCA se guardaba en media_attachments. Ahora lo subimos (base64) con el MISMO
          // wa_media_id que usa el espejo → el cockpit lo encuentra y lo muestra. (PDFs ya enviados antes
          // de este fix no se pueden recuperar; aplica a los nuevos.)
          safe('generarPdf.storeMedia', async () => {
            if (!SALES_OS_URL) return;
            await fetch(`${SALES_OS_URL}/api/v5/media/store`, {
              method: 'POST',
              headers: { 'x-api-key': OPERATOR_TOKEN, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                phone: from, direction: 'outbound', media_type: 'document', mime_type: 'application/pdf',
                filename, wa_media_id: waDocMediaId || '', media_base64: pdfBuffer.toString('base64'),
                file_size: pdfBuffer.length, ai_description: `Propuesta ${quoteNumber}`,
              }),
              signal: AbortSignal.timeout(15000),
            });
          });

          // ── Paso 3b: ESPEJO al dashboard (visibilidad del PDF) ───────────────
          // FIX 2026-06-15: el dashboard solo reflejaba TEXTO → el operador veía "Te envié
          // el PDF" pero NO el archivo ("no está en ninguna parte"), aunque Meta lo aceptara
          // (msgId en el log). Ahora empujamos un evento message_type:'document' para que el
          // PDF SEA VISIBLE en el CRM (Oliver), con el estado real de entrega.
          safe('generarPdf.mirror', () => bridge.pushConversationEvent({
            channel:      'whatsapp',
            external_id:  from,
            direction:    'outbound',
            actor_type:   'ai',
            actor_name:   'Oliver',
            message_type: 'document',
            body:         docSent
              ? `📄 Propuesta ${filename} enviada al cliente`
              : `⚠️ Propuesta ${filename} NO se pudo entregar al cliente`,
            metadata: { source: 'oliver_gpt_pdf', quote_number: quoteNumber, filename,
                        media_id: waDocMediaId, pdf_sent: docSent },
          }));

          // ── Paso 4: Zoho CRM (Deal upsert + Note) ───────────────────────────
          // Fire-and-forget: si Zoho falla no bloquea el resto del flujo.
          // [FIX 2026-06-19 COB-07] SIEMPRE recalcular desde los items (unit_price NETO del motor);
          // ignorar input.grand_total (si el LLM lo alucina con IVA, inflaría el monto a Zoho/CXM).
          const grandTotal = (input.items || []).reduce((s, it) => s + (Number(it.unit_price) || 0) * (Number(it.qty) || 1), 0);
          safe('generarPdf.zoho', async () => {
            const dealId = await upsertZohoDeal({
              phone:      clientPhone,
              name:       clientName,
              comuna:     clientComuna,
              items:      input.items || [],
              grand_total: grandTotal,
              stageKey:   'propuesta',
              quote_number: quoteNumber,
            });
            if (dealId) {
              await addZohoNote(dealId, `Cotización enviada: ${quoteNumber}`,
                `PDF enviado al cliente por WhatsApp.\nTotal: $${grandTotal.toLocaleString('es-CL')} CLP (IVA incl.)`);
              // [#6] adjuntar el PDF AL Deal (trazabilidad ISO en el registro Zoho)
              await attachPdfToDeal(dealId, pdfBuffer, filename);
            }
          });

          // ── Paso 5: WorkDrive (INERTE — no-bloqueante) ───────────────────────
          // El dueño debe re-autorizar OAuth con scope WorkDrive.files.CREATE antes de activar.
          // El código queda preparado y falla suave.
          safe('generarPdf.workdrive', async () => {
            await archivarEnWorkDrive(pdfBuffer, filename);
          });

          // ── Paso 6: Conversión multicanal (anti-cross-inject) ────────────────
          // REGLA: solo se envía AL CANAL QUE TRAJO AL LEAD (skill activa-atribucion-multicanal).
          // La atribución se basó en el click_id capturado en F3b (state.ctwa_clid / gclid / ttclid).
          // Se llama bridge.pushQuoteEvent con status 'sent'; el server.js (sales-os) llama
          // fireConversion → CXM /api/conversions/track con el canal correcto.
          await landingAttributionReady;
          safe('generarPdf.conversion', () =>
            bridge.pushQuoteEvent({
              phone:           clientPhone,
              channel:         'whatsapp',
              customer_name:   clientName,
              amount_total:    grandTotal,
              currency:        'CLP',
              status:          'sent',       // server.js lo mapea a 'quote_sent'
              quote_number:    quoteNumber,
              // [ajuste abogado] click-ids a NIVEL RAÍZ: fireConversion (sales-os) los lee de
              // body.fbclid/body.gclid de raíz, NO de payload. Anti-cross-inject: un lead → un canal.
              fbclid:    state.fbclid    || null,
              gclid:     state.gclid     || null,
              ttclid:    state.ttclid    || null,
              ctwa_clid: state.ctwa_clid || null,
              ad_id:     state.ad_id     || null,
              landing_ref: state.landing_lead_id || null,
              // [2026-07-11 FIX lead_id NULL] sin este campo, quoteService.upsertQuote (sales-os)
              // no puede resolver lead_id → JOIN quotes→leads roto (auditoría BD viva confirmada).
              // Réplica de buildLeadPayload (index.js, ruta legacy) con los datos que el flujo
              // GPT v2 (WhatsApp) tiene a mano en este punto; lo no disponible queda null.
              lead: {
                source: 'oliver_gpt',
                channel: 'whatsapp',
                lead_name: clientName || null,
                name: clientName || null,
                phone: clientPhone || from || null,
                comuna: clientComuna || null,
                city: clientComuna || null,
                project_type: null,
                product_interest: (input.items?.[0]?.producto_label || input.items?.[0]?.product) || null,
                windows_qty: (input.items || []).length
                  ? String((input.items || []).reduce((acc, it) => acc + (Number(it.qty) || 1), 0))
                  : null,
                budget: grandTotal ? String(grandTotal) : null,
                message: null,
                status: 'quoted',
                zoho_deal_id: null,
                external_id: from || null,
                fbclid:    state.fbclid    || null,
                gclid:     state.gclid     || null,
                ttclid:    state.ttclid    || null,
                ctwa_clid: state.ctwa_clid || null,
                ad_id:     state.ad_id     || null,
                landing_ref: state.landing_lead_id || null,
              },
              payload: {
                comuna:   clientComuna,
                // Click ids — anti-cross-inject: solo el canal del lead.
                ctwa_clid: state.ctwa_clid || null,
                ad_id:     state.ad_id     || null,
                landing_ref: state.landing_lead_id || null,
                fbclid:    state.fbclid    || null,
                gclid:     state.gclid     || null,
                ttclid:    state.ttclid    || null,
              },
            })
          );

          // ── [2026-07-07] ESCALACIÓN por VENTANA FUERA DE ESTÁNDAR (instrucción del dueño) ──────
          // Toda ventana referencial (sobre el máximo o bajo el mínimo de fábrica) se cotiza IGUAL
          // (no se frena al cliente), pero Marcelo (Evaluador Energético Externo MINVU) DEBE revisar
          // la medida/precio antes de fabricar. Motor-truth (referencial se derivó del motor arriba),
          // no depende del LLM. Best-effort + cooldown 2h por cliente:motivo → no spamea. Corre para
          // ambos caminos (entregado o no) porque la revisión de ingeniería aplica igual.
          const _refItems = (input.items || []).filter((it) => it.referencial);
          if (_refItems.length) {
            const _lista = _refItems
              .map((it) => `• ${it.producto_label || it.product || 'Ventana'} (${it.measures_original || it.measures || 's/medida'})`)
              .join('\n');
            await safe('generarPdf.referencial.escalate', () =>
              notifyHighValue(enviarSinPausa, from,
                { data: { ...state, name: clientName, comuna: clientComuna, quote_number: quoteNumber, grand_total: grandTotal, items: input.items }, history },
                `oliver_gpt:ventana_fuera_estandar — 🔧 REVISIÓN DE INGENIERÍA: ${_refItems.length} ventana(s) fuera del estándar de fábrica en el folio ${quoteNumber}. Confirmar medida y precio final antes de fabricar:\n${_lista}`));
          }

          // [FIX 2026-06-19 CLI-02/CLI-03] si el PDF NO se entregó → AVISAR a Marcelo (no se pierde en silencio)
          // + devolver `message` para que el LLM diga la verdad y NO alucine "ya te lo envié".
          if (!docSent) {
            // [PDF-RACE 2026-07-01] rastro persistente del folio (reuso 48h) + estado real de entrega.
            state.last_quote = { quote_number: quoteNumber, at: Date.now(), pdf_sent: false,
              descuento_mercado_pct: descuentoMercadoPct };
            await safe('generarPdf.escalate', () =>
              notifyHighValue(enviarSinPausa, from,
                { data: { ...state, name: clientName, comuna: clientComuna, quote_number: quoteNumber }, history },
                `[whatsapp] PDF ${quoteNumber} no se pudo entregar al cliente — enviarlo desde el inbox (ops.activalabs.ai)`));
            return {
              ok: true, quote_number: quoteNumber, pdf_sent: false, media_id: waDocMediaId,
              // [2026-07-01 Bug#2 paridad] explícito y honesto: Marcelo la envía (no "si no la ves" vago).
              message: `Tu Propuesta Técnica Económica N° ${quoteNumber} está lista ✅ Tuve un problema para adjuntarte el archivo — el Ing. Marcelo Cifuentes te la enviará directamente en un momento. 📲 +56 9 5729 6035`,
            };
          }
          // [PDF-RACE 2026-07-01] entrega OK → registrar folio para reuso (revisiones = mismo folio).
          state.last_quote = { quote_number: quoteNumber, at: Date.now(), pdf_sent: true,
            descuento_mercado_pct: descuentoMercadoPct };
          return {
            ok: true,
            quote_number: quoteNumber,
            pdf_sent:     docSent,   // ← entrega REAL (sendWaDocument.ok), no solo el upload
            media_id:     waDocMediaId,
            message:      `Listo ✅ Te envié tu Propuesta Técnica Económica N° ${quoteNumber} acá mismo (PDF). Cualquier duda la vemos.`,
          };
        }),
    };

    // ── [FIX 2026-06-19 PDF-01] ENTREGA DETERMINISTA DEL PDF (NO depende del LLM) ──
    // Si el cliente CONFIRMA tras una cotización ya lista (state.pending_quote del turno
    // anterior), mandamos el PDF en CÓDIGO. En prod el LLM a veces escribía "[Enlace a la
    // cotización]" como texto sin llamar la tool → el cliente NO recibía el PDF. Portado de channel-agent.js.
    if (state.pending_quote && Array.isArray(state.pending_quote.items) && state.pending_quote.items.length
        && isPdfAffirmative(userText) && lastAssistantOfferedPdf(history)) {
      const pq = state.pending_quote;
      const pdfRes = await safe('pdf.deterministic', () => toolCtx.generarPdf({
        name: state.name || '', phone: state.telefono || from, comuna: state.comuna || '',
        items: pq.items, grand_total: pq.grand_total,
      }));
      const replyMsg = (pdfRes && pdfRes.message) ||
        `Listo ✅ Te preparé tu Propuesta Técnica Económica${pdfRes?.quote_number ? ` N° ${pdfRes.quote_number}` : ''} acá mismo (PDF).`;
      await safe('pdf.det.send', () => sendWhatsAppText(from, replyMsg));
      await safe('pdf.det.persistIn', () => bridge.pushConversationEvent({
        channel: 'whatsapp', external_id: from, direction: 'inbound', actor_type: 'customer',
        actor_name: 'Cliente', message_type: 'text', body: userText,
        metadata: { source: 'oliver_gpt_webhook', msg_id: msgId, pdf_confirm: true },
      }));
      await safe('pdf.det.persistOut', () => bridge.pushConversationEvent({
        channel: 'whatsapp', external_id: from, direction: 'outbound', actor_type: 'ai',
        actor_name: 'Oliver', message_type: 'text', body: replyMsg,
        metadata: { source: 'oliver_gpt_webhook', pdf_deterministic: true, quote_number: pdfRes?.quote_number },
      }));
      const histPdf = [...history, { role: 'user', content: userText }, { role: 'assistant', content: replyMsg }];
      await landingAttributionReady;
      const toStorePdf = { history: histPdf.length > MAX_HISTORY ? histPdf.slice(-MAX_HISTORY) : histPdf,
                           state: { ...state, pending_quote: null, lastMessageAt: Date.now() } };
      conv.set(from, toStorePdf);
      persistSessionFn(from, toStorePdf, deps);
      log('info', 'pdf.deterministic', `PDF determinista para ${from} (${pdfRes?.quote_number || 'sin folio'})`);
      return; // 200 ya enviado; el finally libera el lock
    }

    // ── Llamada al cerebro probado ──────────────────────────────────────
    // Si handleTurn lanza, lo captura el try externo → fail-safe (200 ya enviado).
    // [CTWA-SALUDO tribunal] recién AQUÍ el saludo entra al state: todas las salidas
    // deterministas ya pasaron, así que jamás se persiste fuera de este turno. Si el
    // LLM devuelve reply vacío (fallback de (7a)), el saludo se PIERDE — deliberado:
    // preferimos perderlo a un "primer mensaje" tardío; la alerta respuesta_vacia avisa.
    if (_ctwaSaludoTurn) state.ctwa_saludo_pending = _ctwaSaludoTurn;
    const turn = await handleTurn({ history, userText, state, toolCtx });
    let reply = turn?.reply || '';
    const newHistory = Array.isArray(turn?.history) ? turn.history : history;
    const newState = turn?.state && typeof turn.state === 'object' ? turn.state : state;
    const toolCalls = Array.isArray(turn?.toolCalls) ? turn.toolCalls : [];
    copyAttributionState(newState, state);
    // [PDF-RACE 2026-07-01] sin este merge se perdería el last_quote (folio de la sesión, estado
    // real de entrega) que generarPdf escribió DURANTE este turno vía toolCalls del LLM.
    if (state.last_quote) newState.last_quote = state.last_quote;
    // [CTWA-SALUDO 2026-07-18] one-shot: ya viajó en el contexto de ESTE turno → jamás repetir.
    if (newState.ctwa_saludo_pending) delete newState.ctwa_saludo_pending;

    // [FIX 2026-06-19 PDF-01] capturar la cotización del turno → pending_quote, para poder entregar
    // el PDF determinista si el cliente confirma en el próximo turno (bloque de arriba).
    const _qItems = itemsFromQuoteCalls(toolCalls, newState.default_color || state.default_color);
    if (_qItems.length) {
      // [FIX 2026-06-19] ACUMULAR ventanas entre turnos: el cliente que lista varias (una por mensaje)
      // debe terminar en UNA sola propuesta con TODAS, no un PDF por ventana. Dedup por producto+medidas+color.
      const _prev = (state.pending_quote && Array.isArray(state.pending_quote.items)) ? state.pending_quote.items : [];
      const _merged = [..._prev];
      for (const it of _qItems) {
        const k = `${it.product}|${it.measures}|${it.color}`;
        if (!_merged.some((m) => `${m.product}|${m.measures}|${m.color}` === k)) _merged.push(it);
      }
      newState.pending_quote = {
        items: _merged,
        grand_total: _merged.reduce((s, it) => s + it.unit_price * (Number(it.qty) || 1), 0),
        at: Date.now(),
      };
    }

    // [FIX 2026-06-19] Si en ESTE turno se generó el PDF, el texto al cliente ES la entrega
    // (usa el message del tool): NUNCA un saludo, NUNCA "no lo puedo enviar", NUNCA "cotización".
    // Mata el re-saludo + la contradicción vistos en el test en vivo. Si hubo PDF, también limpiamos
    // pending_quote (ya se entregó) para no re-disparar la entrega determinista.
    const _pdfCall = toolCalls.find((t) => t.name === 'generar_pdf_cotizacion' && t.result && t.result.message);
    if (_pdfCall) {
      reply = _pdfCall.result.message;                       // entrega exitosa O "dame un momentito" si el folio no salió
      // [Ronda 2 2026-07-20] Primer turno CTWA que ya genera PDF: anteponer el saludo aprobado
      // del anuncio en vez de tragárselo. No viola el anti-re-saludo del [FIX 2026-06-19]:
      // _ctwaSaludoTurn solo existe con history VACÍO (primera interacción de un lead pagado).
      if (_ctwaSaludoTurn) reply = `${_ctwaSaludoTurn}\n\n${reply}`;
      if (_pdfCall.result.ok) newState.pending_quote = null; // solo limpiar si realmente se entregó (si falló, dejar para reintento)
    }

    // [#2 2026-06-21] Blindaje anti precio-suelto (REGLA #13): el monto va SOLO en el PDF. Si el LLM
    // dejó un monto CLP en el texto, lo borra antes de enviar (conservador: no toca medidas/folios).
    const _replyPreFiltros = reply;
    reply = stripMontos(reply);
    // [Ronda 4 2026-07-20] Borrar acciones FALSAS narradas ("[Enlace a la cotización]",
    // "[Calculando...]") — casos reales 16-19 jul: el LLM las escribió pese al ⛔ del prompt.
    reply = stripAccionesFalsas(reply);
    // [Ronda 4.1 — Codex] la HISTORIA persiste lo que el cliente REALMENTE recibió: sin
    // esto el LLM veía su propio "[Enlace...]"/monto sin filtrar en el turno siguiente y
    // daba por enviado un link/precio que jamás llegó. La guarda de identidad protege el
    // caso PDF (ahí la historia guarda el texto del cerebro, no el reply reemplazado).
    if (reply !== _replyPreFiltros) {
      const _lastF = newHistory[newHistory.length - 1];
      if (_lastF && _lastF.role === 'assistant' && _lastF.content === _replyPreFiltros) _lastF.content = reply;
    }

    // ── (7) Enviar respuesta por WhatsApp ───────────────────────────────
    // (7a) Texto: siempre se envía (canal garantizado).
    // [2026-07-06 LOTE2] reply vacío = cliente SIN respuesta (caso real 56940732508: pedido de 11
    // ventanas quedó mudo un viernes noche). Instrumentación (cazar causa raíz en Railway) + FALLBACK
    // CONTEXTUAL. Acá NO hubo PDF en el turno (el branch _pdfCall ya habría sobreescrito reply con un
    // message no-vacío) → nunca duplica la entrega. Si hay cotización acumulada, invitamos el "sí" que
    // dispara la entrega determinista (bloque PDF-01 del próximo turno); si no, repetir + salida humana.
    if (!reply || !String(reply).trim()) {
      try { log('error', 'turn.reply_empty', { from, toolCalls: toolCalls.map((t) => t.name).join(',') || 'ninguno', historyLen: newHistory.length }); } catch {}
      reply = (newState.pending_quote && Array.isArray(newState.pending_quote.items) && newState.pending_quote.items.length)
        ? '¿Le genero la propuesta en PDF con lo que ya cotizamos? Responda *sí* y se la envío al tiro 👍'
        : 'Disculpe, se me trabó la respuesta 😅. ¿Me repite lo último, por favor? Si prefiere, Marcelo también puede atenderlo directo al +56 9 5729 6035.';
      // [escéptico L2 — BLOQUEANTE] El history que se persiste DEBE reflejar el fallback que el cliente
      // recibió (agent.js:163 lo armó con content:''): sin esto, lastAssistantOfferedPdf(history) del
      // turno siguiente ve '' y el "sí" del cliente NO dispara la entrega determinista del PDF.
      const _lastH = newHistory[newHistory.length - 1];
      if (_lastH && _lastH.role === 'assistant' && !String(_lastH.content || '').trim()) _lastH.content = reply;
      if (replyEmptyAlertAllowed()) {
        await safe('replyEmpty.notify', () =>
          notifyHighValue(enviarSinPausa, from, { data: { ...newState }, history: newHistory },
            'oliver_gpt:respuesta_vacia — el cerebro devolvió texto vacío (ver log turn.reply_empty); el cliente recibió un fallback'));
      }
    }
    if (reply) {
      // [2026-08-08] Cortar el loop de "escribiendo…" JUSTO acá y no recién en el finally:
      // entre este envío y el final del handler todavía corren el TTS y las persistencias,
      // y un refresco podía aterrizar en esa ventana y volver a encender los puntitos
      // DESPUÉS de que el cliente ya recibió la respuesta (P1 de Codex, 2ª pasada).
      // El finally sigue como respaldo: detener dos veces es inofensivo.
      try { _detenerEscribiendo(); } catch { /* ya detenido */ }
      // La respuesta principal va como la mandaría una persona: 2-3 burbujas cortas, con
      // "escribiendo…" entre medio. enviarSinPausa porque el ritmo lo pone esta función.
      await safe('sendWhatsAppText', () => enviarComoPersona(enviarSinPausa, from, reply, msgId));
    }

    // (7b) Voz saliente (F4): si el inbound fue audio Y VOICE_ENABLED, sintetizar
    // y enviar nota de voz ADEMÁS del texto. Fail-safe: si TTS/upload falla, el
    // cliente ya tiene el texto → no se pierde la respuesta.
    if (reply && shouldSendVoice(userText, null, { incomingType: inbound.type })) {
      await safe('voice.send', async () => {
        const audioResult = await synthesizeVoiceBuffer({ text: reply, waId: from });
        if (!audioResult || !audioResult.buffer) {
          log('info', 'voice.send', `TTS no devolvió audio para ${from}; se omite nota de voz`);
          return;
        }
        const mediaId = await uploadWaAudio(
          audioResult.buffer,
          audioResult.mime || 'audio/ogg',
          audioResult.filename || `reply_${Date.now()}.ogg`
        );
        // voice:true (PTT, ícono micrófono) SOLO si es ogg/opus; otros formatos
        // van como audio adjunto normal (ajuste del abogado del diablo).
        const asVoice = (audioResult.mime || '').toLowerCase().includes('ogg');
        await sendWaAudio(from, mediaId, asVoice);
        log('info', 'voice.sent', `nota de voz enviada a ${from} (${audioResult.buffer.length} bytes, voice=${asVoice})`);
      });
    }

    // ── (8) Persistencia POST del turno (inbound + outbound) ────────────
    await safe('persist.inbound', () =>
      bridge.pushConversationEvent({
        channel: 'whatsapp',
        external_id: from,
        customer_name: newState.name || push_name || '',
        direction: 'inbound',
        actor_type: 'customer',
        actor_name: 'Cliente',
        message_type: inbound.type || 'text',
        body: inbound.text || userText,
        metadata: { source: 'oliver_gpt_webhook', msg_id: msgId, resolved_text: userText },
      })
    );

    if (reply) {
      // message_type refleja si se entregó también como nota de voz (F4).
      const outboundType = shouldSendVoice(userText, null, { incomingType: inbound.type })
        ? 'text+voice'
        : 'text';
      await safe('persist.outbound', () =>
        bridge.pushConversationEvent({
          channel: 'whatsapp',
          external_id: from,
          customer_name: newState.name || push_name || '',
          direction: 'outbound',
          actor_type: 'ai',
          actor_name: 'Oliver',
          message_type: outboundType,
          body: reply,
          metadata: { source: 'oliver_gpt_webhook' },
        })
      );
    }

    // Cotización en el turno → pushQuoteEvent.
    const quote = extractQuote(toolCalls);
    if (quote) {
      await landingAttributionReady;
      copyAttributionState(newState, state);
      await safe('persist.quote', () =>
        bridge.pushQuoteEvent({
          phone: from,
          channel: 'whatsapp',
          customer_name: newState.name || push_name || 'Cliente WhatsApp',
          amount_total: quote.total || quote.grand_total || null,
          currency: 'CLP',
          status: 'draft',
          fbclid:    newState.fbclid    || null,
          gclid:     newState.gclid     || null,
          ttclid:    newState.ttclid    || null,
          ctwa_clid: newState.ctwa_clid || null,
          ad_id:     newState.ad_id     || null,
          landing_ref: newState.landing_lead_id || null,
          // [2026-07-11 FIX lead_id NULL] sin este campo, quoteService.upsertQuote (sales-os)
          // no puede resolver lead_id → JOIN quotes→leads roto (auditoría BD viva confirmada).
          // Réplica de buildLeadPayload con los datos que este punto del flujo GPT v2 tiene a
          // mano (draft, antes del PDF); lo no disponible queda null.
          lead: {
            source: 'oliver_gpt',
            channel: 'whatsapp',
            lead_name: newState.name || push_name || null,
            name: newState.name || push_name || null,
            phone: from || null,
            comuna: newState.comuna || null,
            city: newState.comuna || null,
            project_type: null,
            product_interest: null,
            windows_qty: null,
            budget: (quote.total || quote.grand_total) ? String(quote.total || quote.grand_total) : null,
            message: null,
            status: 'draft',
            zoho_deal_id: null,
            external_id: from || null,
            fbclid:    newState.fbclid    || null,
            gclid:     newState.gclid     || null,
            ttclid:    newState.ttclid    || null,
            ctwa_clid: newState.ctwa_clid || null,
            ad_id:     newState.ad_id     || null,
            landing_ref: newState.landing_lead_id || null,
          },
          payload: {
            comuna: newState.comuna || '',
            quote,
            ctwa_clid: newState.ctwa_clid || null,
            ad_id: newState.ad_id || null,
            landing_ref: newState.landing_lead_id || null,
            fbclid: newState.fbclid || null,
            gclid: newState.gclid || null,
            ttclid: newState.ttclid || null,
          },
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
    await landingAttributionReady;
    copyAttributionState(newState, state);
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
    // [2026-08-08] Cortar el "escribiendo…" pase lo que pase. Si el turno se cae, Oliver
    // no puede quedar "escribiendo" un mensaje que nunca va a llegar.
    try { _detenerEscribiendo(); } catch { /* ya detenido */ }
  }
}

export default { handleWebhook };
