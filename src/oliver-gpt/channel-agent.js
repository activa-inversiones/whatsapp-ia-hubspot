// src/oliver-gpt/channel-agent.js
//
// CEREBRO de Oliver para canales NO-WhatsApp (Instagram DM + Facebook Messenger).
// ─────────────────────────────────────────────────────────────────────────
// Reúsa el MISMO cerebro probado (agent.handleTurn) que atiende WhatsApp, pero
// con un toolCtx adaptado al canal: sin PDF-por-WhatsApp (el cliente IG/FB no
// está en WhatsApp), con escalación REAL a Marcelo y tracking de lead por canal.
//
// Antes (mini): IG/FB usaban un gpt-4o-mini que solo saludaba y redirigía a
// WhatsApp — NO cotizaba, NO usaba el motor. Esto lo reemplaza: Oliver atiende
// IG/FB con su cerebro completo (cotiza CORRECTO vía priceAllEngine en tools.js).
//
// CONTRATO:
//   · Idéntico fail-safe que webhook.js: todo en try/catch, nunca tumba el proceso.
//   · El ack 200 a Meta ya lo envía multiChannelHandler ANTES de llamar acá.
//   · sendFn(to, text) ya viene atado al canal correcto (graph.instagram.com para
//     IG con la API nueva; graph.facebook.com para FB).
//
// DEUDA TÉCNICA (paridad con WhatsApp — ver claude-mem obs 2158):
//   · [2026-06-14] Sesión: cache in-memory + persistencia en Postgres (session-store) →
//     sobrevive redeploys. ✔ resuelto.
//   · [2026-06-14] PDF formal (folio ISO CM-FR-004) SÍ se emite y entrega por IG/FB:
//     subida BINARIA a Meta (sin URL pública → los precios NO quedan expuestos). FB siempre;
//     IG si la cuenta está ligada a una Página de FB. Si el envío del archivo falla → se escala
//     a Marcelo (no se pierde el lead, no se expone nada). ✔ resuelto.
//   · Sin media SALIENTE rica (catálogos/fotos) en IG/FB ni voz/visión/STT de adjuntos
//     ENTRANTES: el cerebro describe por texto o pide reescribir. TODO.
//
// ESM, Node 18+.

import { handleTurn as realHandleTurn } from './agent.js';
import { recordarColor, textoDelCliente } from './normalizers.js';   // [2026-08-25] el color se recuerda entre turnos - [2026-08-31] y se mide en lo que dijo el cliente
// [2026-08-31] LAS TRES PROPUESTAS A/B/C POR COLOR - el MISMO modulo que usa WhatsApp
// (webhook.js). Los dos canales rotulan igual, usan las mismas letras del folio y le dicen lo
// mismo al cliente: dos copias de esta regla se desincronizarian, como ya paso con la
// escalacion (el titulo viejo de Marcelo quedo vivo en IG/FB durante semanas).
import { foliosDeOpciones, letrasReservadas, textoDeOpciones } from './propuestas-color.js';
// [2026-08-31] A NOMBRE DE QUIEN VA EL DOCUMENTO — el MISMO modulo que usa WhatsApp.
// Hasta hoy este archivo no lo importaba: el cliente de Instagram dictaba su RUT y su razon
// social y el PDF salia a nombre del contacto generico del chat. Se importa, no se copia: es
// el unico modulo 11 del repo y la unica compuerta de procedencia.
import { extraerReceptor, receptorParaDocumento, fusionarReceptor } from '../../services/receptorCliente.js';
import { priceAllEngine as realPriceAllEngine } from '../../services/enginePricer.js';   // precio REAL por color (motor LOCAL)
import { notifyHighValue as realNotifyHighValue } from '../../services/highValueNotifier.js';
import * as realBridge from '../../services/salesOsBridge.js';
import { sendWhatsAppText as realSendWhatsAppText } from '../sales-agent/whatsapp-adapter.js';
import { loadSession as realLoadSession, persistSession as realPersistSession, resetIfInactive } from './session-store.js';
import { generatePremiumQuotePdf as realGeneratePdf } from '../../services/quotePdf.js';
import { upsertZohoDeal as realUpsertZohoDeal, addZohoNote as realAddZohoNote, attachPdfToDeal as realAttachPdfToDeal } from '../../services/zohoCommercial.js';
import { sendChannelDocument as realSendChannelDocument } from '../../services/multiChannelHandler.js';
import { stripMontos, stripAccionesFalsas, quoteDataComplete } from './pdf-intent.js'; // [#2] filtro anti precio-suelto + [PDF-RACE] guard de completitud + [Ronda 4] anti acciones-falsas (compartidos con webhook.js)
// [2026-07-02 dedupe] escalación desde el módulo COMPARTIDO — las copias locales causaron el bug
// del título viejo de Marcelo en IG/FB (se actualizó escalation.js y las copias quedaron atrás).
import { escalationMessage, isEscalationRequest, sendEscalationTemplate } from './escalation.js';

/* =========================================================================
 * ESTADO IN-MEMORY (piloto) — por canal+sender.
 *  · CONV: Map<"canal:senderId", {history, state}>
 *  · SEEN: Set<msgId>  (idempotencia)
 * ========================================================================= */
const CONV = new Map();
const SEEN = new Set();
const SEEN_MAX = 5000;
const MAX_HISTORY = 40;
// [2026-06-14] Guard anti-doble-folio por canal:sender — un lead NO quema 2 correlativos ISO
// en la misma ventana (doble "confirmo", reintentos, re-cálculo). Mismo patrón que webhook.js.
const RECENT_QUOTES = new Map();
const QUOTE_DEDUP_MS = Number(process.env.QUOTE_DEDUP_MS) || 120000; // 2 min

// [2026-06-15 → 2026-07-02] ESCALACIÓN DETERMINISTA — no depende del LLM. Las 3 funciones
// (escalationMessage / isEscalationRequest / sendEscalationTemplate) viven ÚNICAMENTE en
// ./escalation.js (módulo compartido con webhook.js) — acá había copias locales byte-a-byte
// que se desincronizaron una vez (título viejo de Marcelo en IG/FB) y se eliminaron.

// [2026-06-15] ENTREGA DETERMINISTA DEL PDF — el PDF es la FORMALIDAD (dar solo el precio en texto = perder
// al cliente por informalidad). No puede depender de que el LLM llame generar_pdf_cotizacion (en prod a veces
// escribía "[Enlace a la cotización]" sin llamarla → el PDF no llegaba). Capturamos los ítems con precio REAL
// del motor (de calcular_cotizacion) y, al confirmar, disparamos el PDF en código.
function isPdfAffirmative(text) {
  const t = String(text || '').trim().toLowerCase();
  if (/\b(env[ií]a(mela|melo|la|lo)?|m[aá]nda(mela|melo|la|lo)?|quiero (el|la|mi) (pdf|cotiza|propuesta)|el pdf|la propuesta formal)\b/.test(t)) return true;
  // afirmación corta — solo cuenta si el bot venía OFRECIENDO el PDF (ver lastAssistantOfferedPdf).
  return /^(s[ií]|ok(ey)?|dale|ya|perfecto|listo|de acuerdo|claro|por ?fa(vor)?|bueno|obvio|as[ií] es|s[ií]\s*por ?favor)[\s.!👍🙌✅]*$/.test(t);
}
function lastAssistantOfferedPdf(history) {
  for (let i = (history || []).length - 1; i >= 0; i--) {
    const m = history[i];
    if (m && m.role === 'assistant') {
      return /\bpdf\b|propuesta formal|cotizaci[oó]n formal|te (la |lo )?env[ií]o|enviar(te)? (la|el)|¿te (gustar[ií]a|env[ií]o)|mando la propuesta/i.test(String(m.content || ''));
    }
  }
  return false;
}
function itemsFromQuoteCalls(toolCalls, defaultColor) {
  return (toolCalls || [])
    .filter(t => (t.name === 'calcular_cotizacion' || t.name === 'calcular_por_area') && t.result && t.result.ok && Number(t.result.unit_price) > 0)
    .map(t => ({
      product: t.result.producto_label || t.input?.tipo || 'Ventana',
      producto_label: t.result.producto_label || t.input?.tipo || 'Ventana',
      measures: t.input?.medidas_texto || t.input?.measures || t.result?.medidas_derivadas ||
        ((t.input?.ancho_mm && t.input?.alto_mm) ? `${t.input.ancho_mm}x${t.input.alto_mm}` : ''),
      color: t.input?.color || defaultColor || '',
      qty: Number(t.result.cantidad) || Number(t.input?.cantidad) || 1,
      unit_price: Number(t.result.unit_price) || 0,
      glass_label: t.result.glass_label || 'Termopanel DVH',
      ambiente: t.input?.ambiente || '',
    }))
    .filter(it => Number(it.unit_price) > 0);
}

/* =========================================================================
 * MUTEX por canal:sender — serializa turnos concurrentes del mismo cliente
 * (doble-tap: 2 mensajes seguidos con mid distinto). Sin esto, ambos turnos
 * leían el MISMO cache y el último conv.set() pisaba el historial del otro →
 * se perdía contexto (ej: la medida o "proyectante"). Porteado de webhook.js.
 * ========================================================================= */
const LOCKS = new Map();
// [2026-06-14] Cache del último control conocido por convKey. Si la lectura de control
// FALLA (sales-os caído) mientras un operador tenía el takeover, usamos esto para NO pisar
// al operador (fail-closed hacia el humano SOLO en IG/FB; WhatsApp mantiene su fail-open).
const CONTROL_CACHE = new Map();
async function acquireLock(key, locks = LOCKS) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  locks.set(key, next);
  await prev;
  return () => {
    release();
    if (locks.get(key) === next) locks.delete(key);
  };
}

function log(level, ctx, msg) {
  const fn = level === 'error' ? console.error : console.log;
  const detail = msg && msg.stack ? msg.stack : msg;
  fn(`[oliver-gpt/channel] ${ctx}:`, detail);
}

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

function copyAttributionState(target, source) {
  if (!target || typeof target !== 'object' || !source || typeof source !== 'object') return target;
  for (const key of ATTRIBUTION_STATE_KEYS) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') target[key] = value;
  }
  return target;
}

/**
 * [2026-07-14 IG/FB media→inbox] Resuelve message_type + metadata del evento inbound
 * cuando el turno traía un adjunto IG/FB ya guardado (o guardándose) en el MediaStore.
 * index.js lanza saveMedia fire-and-forget ANTES de llamar al cerebro y pasa acá la
 * promesa → cuando el persist corre (post-cerebro, segundos después) el guardado casi
 * siempre ya resolvió: costo ~0ms. El id devuelto por /api/v5/media/store viaja en
 * metadata.media_id → fast-path del inbox (inbox-ui.js pinta <img>/<audio> directo,
 * MISMO render que WhatsApp, sin depender de /media/resolve ni de ventanas de tiempo).
 * Best-effort REAL: sin adjunto o guardado fallido → null → el evento sale message_type
 * 'text' como siempre (evita burbujas "Cargando…"/"no vinculable" en el inbox).
 * NUNCA lanza: cualquier falla degrada al comportamiento actual.
 *
 * @param {{tipo:string, mime?:string, filename?:string, guardado?:Promise}|null} mediaEntrante
 * @returns {Promise<{message_type:string, metadata:object}|null>}
 */
async function resolveInboundMediaEvent(mediaEntrante) {
  try {
    if (!mediaEntrante || !mediaEntrante.tipo || !mediaEntrante.guardado) return null;
    // saveMedia (mediaStore.js) nunca lanza y tiene timeout propio de 10s; el race de
    // 12s es solo un cinturón extra para que el persist jamás quede colgado por esto.
    // [Ronda 2 2026-07-20] guardar el id y limpiar: sin esto cada media dejaba un timer
    // de 12s vivo aunque saveMedia resolviera al tiro (misma familia que el de 50s).
    let _mediaTimer = null;
    const saved = await Promise.race([
      Promise.resolve(mediaEntrante.guardado).catch(() => null),
      new Promise((resolve) => { _mediaTimer = setTimeout(resolve, 12000, null); }),
    ]).finally(() => { if (_mediaTimer) clearTimeout(_mediaTimer); });
    const mediaId = saved && saved.media && saved.media.id;
    if (!mediaId) return null;
    return {
      message_type: mediaEntrante.tipo, // 'image' | 'audio' (whitelist del bridge)
      metadata: {
        media_id: mediaId,
        mime_type: mediaEntrante.mime || '',
        filename: mediaEntrante.filename || '',
      },
    };
  } catch {
    return null;
  }
}

/**
 * handleChannelTurn — procesa un turno de Instagram DM / Facebook Messenger
 * con el cerebro de Oliver.
 *
 * @param {object} args
 * @param {string} args.channel    - "instagram" | "facebook"
 * @param {string} args.senderId   - ID del usuario en el canal
 * @param {string} [args.senderName]
 * @param {string} args.text       - texto del mensaje
 * @param {string} [args.msgId]    - id del mensaje (dedupe)
 * @param {Function} args.sendFn   - (to, text) => envío atado al canal
 * @param {object} [args.mediaEntrante] - [2026-07-14 media→inbox] OPCIONAL: {tipo, mime,
 *                                   filename, guardado:Promise} del adjunto IG/FB guardado
 *                                   en el MediaStore (ver resolveInboundMediaEvent). null =
 *                                   turno sin media → comportamiento idéntico al actual.
 * @param {object} [deps]          - inyectables para tests (handleTurn, bridge,
 *                                   notifyHighValue, sendWhatsAppText, conv, seen)
 * @returns {Promise<{ ok:boolean, reply?:string, reason?:string }>}
 */
export async function handleChannelTurn(
  { channel, senderId, senderName = '', text = '', msgId = '', sendFn, mediaEntrante = null },
  deps = {}
) {
  const handleTurn      = deps.handleTurn      || realHandleTurn;
  const bridge          = deps.bridge          || realBridge;
  const notifyHighValue = deps.notifyHighValue || realNotifyHighValue;
  const sendWhatsAppText = deps.sendWhatsAppText || realSendWhatsAppText;
  const generatePdf           = deps.generatePdf           || realGeneratePdf;
  const upsertZohoDeal        = deps.upsertZohoDeal         || realUpsertZohoDeal;
  const addZohoNote           = deps.addZohoNote            || realAddZohoNote;
  const attachPdfToDeal       = deps.attachPdfToDeal        || realAttachPdfToDeal;
  const sendChannelDocument   = deps.sendChannelDocument   || realSendChannelDocument;
  const priceAllFn            = deps.priceAllEngine        || realPriceAllEngine;   // [2026-08-31] precio por color, inyectable para poder probarlo
  const loadSession           = deps.loadSession            || realLoadSession;
  const persistSession        = deps.persistSession         || realPersistSession;
  const conv = deps.conv || CONV;
  const seen = deps.seen || SEEN;
  const locks = deps.locks || LOCKS;

  let release = null;
  try {
    if (!senderId || !text || !sendFn) {
      return { ok: false, reason: 'inbound_invalido' };
    }

    // ── Idempotencia ────────────────────────────────────────────────────
    if (msgId) {
      if (seen.has(msgId)) {
        log('info', 'dedupe', `msgId repetido ignorado: ${msgId}`);
        return { ok: false, reason: 'dedupe' };
      }
      if (seen.size >= SEEN_MAX) seen.clear();
      seen.add(msgId);
    }

    const convKey = `${channel}:${senderId}`;

    // ── MUTEX: serializar turnos del mismo sender (doble-tap) antes de leer/escribir cache.
    release = await acquireLock(convKey, locks);

    // ── Conversation control — respetar takeover humano (fail-safe a 'ai') ─
    // Pasamos el canal: el control del chat IG/FB vive en la fila de ESE canal.
    const control = await safe('control', () => bridge.getConversationControl(senderId, channel));
    // [2026-06-14] Fail-CLOSED hacia el operador: si la lectura falló (null por excepción o
    // _error del bridge) y la última vez vimos takeover humano, NO dejamos que el bot responda
    // encima del operador. Si la lectura fue exitosa, cacheamos el estado.
    let effectiveControl = control;
    if (!control || control._error) {
      const cached = CONTROL_CACHE.get(convKey);
      if (cached && (cached.ai_paused === true || (cached.operator_status && cached.operator_status !== 'ai'))) {
        effectiveControl = { ai_paused: true, operator_status: cached.operator_status || 'human', _fromCache: true };
        log('info', 'control.failclosed', `control no disponible; respeto takeover cacheado para ${convKey}`);
      }
    } else {
      CONTROL_CACHE.set(convKey, { ai_paused: control.ai_paused === true, operator_status: control.operator_status || 'ai' });
      if (CONTROL_CACHE.size > 5000) CONTROL_CACHE.clear();
    }
    const aiPaused =
      !!effectiveControl &&
      (effectiveControl.ai_paused === true ||
        (effectiveControl.operator_status && effectiveControl.operator_status !== 'ai'));
    if (aiPaused) {
      // [2026-07-14 media→inbox] En takeover Marcelo atiende desde el inbox: es CUANDO MÁS
      // necesita ver la foto/audio original del cliente. null si el turno no traía media.
      const mediaEvt = await resolveInboundMediaEvent(mediaEntrante);
      await safe('control.persistInbound', () =>
        bridge.pushConversationEvent({
          channel,
          external_id: senderId,
          direction: 'inbound',
          actor_type: 'customer',
          actor_name: senderName || 'Cliente',
          message_type: mediaEvt ? mediaEvt.message_type : 'text',
          body: text,
          metadata: { source: 'oliver_gpt_channel', msg_id: msgId, ai_paused: true, ...(mediaEvt ? mediaEvt.metadata : {}) },
        })
      );
      log('info', 'control', `IA pausada (takeover) para ${convKey}; inbound persistido`);
      return { ok: false, reason: 'ai_paused' };
    }

    // ── Comando RESET — el cliente pide empezar de cero. Limpia la sesión (in-memory +
    //    Postgres) → la próxima conversación arranca con historial vacío (sin re-saludo
    //    heredado). [2026-06-15] Antes "reset" no limpiaba nada → caía al cerebro y re-saludaba.
    if (/^\s*reset(ear)?\s*$/i.test(text)) {
      conv.delete(convKey);
      persistSession(convKey, { history: [], state: {} });
      await safe('reset.send', () => sendFn(senderId, 'Listo, partimos de cero 🙌 ¿En qué te ayudo con tus ventanas?'));
      await safe('reset.persistInbound', () =>
        bridge.pushConversationEvent({
          channel, external_id: senderId, direction: 'inbound', actor_type: 'customer',
          actor_name: senderName || 'Cliente', message_type: 'text', body: text,
          metadata: { source: 'oliver_gpt_channel', msg_id: msgId, command: 'reset' },
        }));
      log('info', 'reset', `sesión ${convKey} reiniciada por comando del cliente`);
      return { ok: true, reply: 'reset' };
    }

    // ── Hidratar sesión: cache caliente in-memory; si está FRÍA (redeploy de Railway),
    //    se reconstruye desde Postgres (session-store) → Oliver NO pierde el hilo ni
    //    re-saluda a mitad de conversación. [2026-06-14] Cierra el gap in-memory de IG/FB.
    let cached = conv.get(convKey);
    let _coldHydration = false;
    if (!cached) {
      const fromStore = await safe('loadSession', () => loadSession(convKey));
      cached = fromStore || { history: [], state: {} };
      _coldHydration = true;
    }
    const history = Array.isArray(cached.history) ? cached.history : [];
    const rawState = cached.state && typeof cached.state === 'object' ? cached.state : {};
    const baseState = resetIfInactive({ ...rawState, lastMessageAt: rawState.lastMessageAt || 0 });
    if (_coldHydration) {
      // [Ronda 2.1 — Codex] Poblar el cache con la versión YA SANEADA por resetIfInactive
      // (no la cruda): cachear la cruda hacía que el catch de error de turno persistiera
      // lockedData VENCIDA con timestamp fresco → zombie que ya nunca se limpiaba. El
      // objetivo original se mantiene: en sesión fría + 429/timeout, el catch ya no
      // persiste state:{} borrando los click-ids de Postgres.
      conv.set(convKey, { history, state: baseState });
    }
    const state = {
      ...baseState,
      telefono: senderId,           // identificador en el cerebro (no es teléfono real)
      canal: channel,               // hint de canal para el cerebro
      name: baseState.name || senderName || '',
      fecha: new Date().toISOString(),
      ctwa_clid: baseState.ctwa_clid || null,
      ad_id: baseState.ad_id || null,
      gclid: baseState.gclid || null,
      fbclid: baseState.fbclid || null,
      ttclid: baseState.ttclid || null,
    };

    // ── EL RUT / LA RAZON SOCIAL, CAPTURADOS EN CODIGO ──────────────────
    // 🔴 [2026-08-31] Paridad con WhatsApp (webhook.js): un cliente de Instagram dicta
    // "a nombre de Maya Mapu SpA, RUT 77.448.504-K" y hasta hoy eso no llegaba a ninguna
    // parte — el PDF salia a nombre del contacto del chat. La captura va ACA ARRIBA, antes
    // del cerebro, para que el documento de ESTE MISMO turno ya lo lleve: capturarlo despues
    // es el defecto que hizo reclamar cuatro veces a Alfredo por WhatsApp.
    // ⛔ Determinista y no via LLM, por la misma medicion que en webhook.js: de 249 sesiones
    // con actividad solo 6 tenian `data.name`. Un dato que depende del modelo se pierde.
    // ⛔ Un RUT que no pasa modulo 11 NO se guarda: queda `receptor_rechazado` para que Oliver
    // lo vuelva a pedir, y ningun documento lo ve nunca.
    {
      const _rut = extraerReceptor(text, { previo: state.receptor });
      if (_rut && _rut.ok) {
        state.receptor = _rut.receptor;
        // Nivel superior del state a proposito: `resetIfInactive` limpia `lockedData` a los
        // 7 dias y conserva el resto. El espejo en lockedData es para que el prompt no lo
        // vuelva a preguntar; que ese espejo caduque no borra el dato.
        state.lockedData = { ...(state.lockedData || {}), rut: _rut.receptor.rut };
        delete state.receptor_rechazado;
        log('info', 'receptor.rut', `RUT capturado para ${convKey} (${_rut.receptor.clienteTipo})`);
      } else if (_rut) {
        state.receptor_rechazado = { crudo: _rut.crudo, motivo: _rut.motivo, at: Date.now() };
        log('warn', 'receptor.rut', `RUT rechazado para ${convKey}: motivo=${_rut.motivo}`);
      }
    }

    // ── ESCALACIÓN DETERMINISTA (crítica, NO depende del LLM) ────────────
    // [2026-06-15] Si el cliente pide humano/Marcelo o está molesto: avisamos SIEMPRE +
    // mensaje FIJO correcto (nombre+cargo+número+agenda). En prod el LLM a veces respondía
    // 'notificar_marcelo' como texto o no avisaba → la escalación NO puede depender de eso.
    if (isEscalationRequest(text)) {
      await safe('escalate.notify', () =>
        notifyHighValue(sendWhatsAppText, senderId, { data: { ...state }, history },
          `[${channel}] cliente pidió hablar con un humano / molesto`));
      // Aviso GARANTIZADO por plantilla (bypasa ventana 24h → te llega aunque no hayas escrito al bot).
      await safe('escalate.template', () =>
        (deps.sendEscalationTemplate || sendEscalationTemplate)(state.name || senderName, `[${channel}] cliente pide hablar con humano`));
      const msg = escalationMessage();
      await safe('escalate.send', () => sendFn(senderId, msg));
      // [2026-07-14 media→inbox] Un AUDIO transcrito "quiero hablar con Marcelo" cae acá:
      // la burbuja debe mostrar el audio original igual que en el persist principal.
      const mediaEvtEsc = await resolveInboundMediaEvent(mediaEntrante);
      await safe('escalate.persistIn', () => bridge.pushConversationEvent({
        channel, external_id: senderId, direction: 'inbound', actor_type: 'customer',
        actor_name: senderName || 'Cliente', message_type: mediaEvtEsc ? mediaEvtEsc.message_type : 'text', body: text,
        metadata: { source: 'oliver_gpt_channel', msg_id: msgId, escalation: true, ...(mediaEvtEsc ? mediaEvtEsc.metadata : {}) },
      }));
      await safe('escalate.persistOut', () => bridge.pushConversationEvent({
        channel, external_id: senderId, direction: 'outbound', actor_type: 'ai',
        actor_name: 'Oliver', message_type: 'text', body: msg,
        metadata: { source: 'oliver_gpt_channel', escalation: true },
      }));
      const escHist = [...history, { role: 'user', content: text }, { role: 'assistant', content: msg }];
      const toStore = { history: escHist.length > MAX_HISTORY ? escHist.slice(-MAX_HISTORY) : escHist,
                        state: { ...state, lastMessageAt: Date.now() } };
      conv.set(convKey, toStore);
      persistSession(convKey, toStore);
      log('info', 'escalate', `escalación determinista para ${convKey}`);
      return { ok: true, reply: msg };
    }

    // ── toolCtx adaptado al canal IG/FB ─────────────────────────────────
    const toolCtx = {
      telefono: senderId,
      canal: channel,

      // saveLead → pushLeadEvent (lead con su canal real: instagram/facebook).
      saveLead: (leadState = {}) =>
        safe('saveLead', () =>
          bridge.pushLeadEvent({
            phone: senderId,
            channel,
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
            metadata: { source: 'oliver_gpt_channel', channel },
          })
        ),

      // notifyMarcelo → escalación REAL al WhatsApp de Marcelo (independiente del
      // canal del cliente). Incluye el canal en el motivo para que sepa de dónde viene.
      notifyMarcelo: (payload = {}) =>
        safe('notifyMarcelo', () =>
          notifyHighValue(
            sendWhatsAppText,
            senderId,
            { data: { ...state, ...(payload.data || {}) }, history },
            `[${channel}] ${payload.reason || 'oliver_gpt_escalation'}`
          )
        ),

      // persistSession → in-memory (piloto). Se guarda igual al final del turno.
      persistSession: () => Promise.resolve(),

      // sendMedia → NO disponible en IG/FB todavía: el cerebro lo describe por
      // texto u ofrece WhatsApp. Devuelve ok:false explícito (no rompe el turno).
      sendMedia: ({ catalog_key } = {}) => {
        log('info', 'sendMedia', `media no soportada en ${channel} (catalog_key=${catalog_key}); se ofrece por WhatsApp`);
        return Promise.resolve({
          ok: false,
          reason: 'media_solo_whatsapp',
          message: 'Por este canal aún no puedo enviar catálogos/fotos. Te lo puedo mandar por WhatsApp.',
        });
      },

      // generarPdf → ENTREGA del PDF ISO en IG/FB (2026-06-14). Reúsa el MISMO flujo que
      // WhatsApp (folio único CM-FR-004, PDF premium, Zoho CRM, conversión multicanal); solo
      // cambia el ENVÍO: el PDF se hostea en sales-os (URL pública tokenizada) y se manda por
      // la API oficial de Meta (type:file). Anti-doble-folio por canal:sender. Si no se puede
      // entregar (sin URL / fuera de ventana 24h) → escala a Marcelo para que lo mande del inbox.
      generarPdf: (input = {}) =>
        safe('generarPdf', async () => {
          // GUARDIA anti-alucinación: sin unit_price>0 (que viene del motor) NO se genera PDF
          // ni se quema correlativo. Igual que WhatsApp (webhook.js).
          const itemsBad = (input.items || []).filter((it) => !(Number(it.unit_price) > 0));
          if (!input.items?.length || itemsBad.length) {
            log('error', 'generarPdf.guard', `PDF abortado: ${itemsBad.length}/${input.items?.length || 0} ítems sin unit_price>0`);
            return { ok: false, reason: 'precios_no_validados',
              message: 'Necesito calcular bien el precio antes de emitir el PDF formal. Dame un momento.' };
          }

          // [IG-LOOP 2026-07-01] Cap duro PERSISTENTE (caso real: Juan Pablo, IG — Oliver repitió
          // "ya te emití" 3 veces, quemó folios 0073→0074 y el PDF nunca se envió). Si la entrega
          // ya se agotó (1 reintento) y quedó escalada, SIEMPRE el mismo mensaje fijo: sin folio
          // nuevo, sin reintentar envío, sin depender del LLM. REGLA #35 garantizada por código.
          // Reuso/estado del folio ACOTADO a 48h: pasado eso, la sesión se trata como nueva
          // (una cotización genuinamente nueva semanas después NO debe heredar un folio viejo).
          const QUOTE_REUSE_MS = 48 * 60 * 60 * 1000;
          const lq = (state.last_quote && (Date.now() - (state.last_quote.at || 0)) < QUOTE_REUSE_MS)
            ? state.last_quote : null;
          if (lq && lq.quote_number && lq.escalated) {
            // [2026-07-14 auto-recuperación] El lock permanente dejaba al cliente SIN PDF para
            // siempre aunque la CAUSA del fallo se arreglara (caso real HOY: META_PAGE_ACCESS_TOKEN
            // vencido → renovado, y este guard cortaba antes de probar la entrega). Se permite UN
            // reintento de ENTREGA por hora: MISMO folio (no quema correlativo), mensaje honesto,
            // y si vuelve a fallar re-escala y el candado sigue — nada del incidente IG-LOOP
            // (folios quemados + "ya te emití" en loop) puede repetirse con este cap.
            const RETRY_COOLDOWN_MS = 60 * 60 * 1000; // 1h
            const cooldownOk = (Date.now() - (lq.at || 0)) >= RETRY_COOLDOWN_MS;
            if (!cooldownOk) {
              log('info', 'generarPdf.escalated', `Entrega ya escalada para ${convKey} (${lq.quote_number}); sin reintentos`);
              return { ok: true, quote_number: lq.quote_number, pdf_sent: false, escalated: true,
                message: `Tu Propuesta Técnica Económica N° ${lq.quote_number} ya está lista y el Ing. Marcelo Cifuentes te la enviará personalmente por WhatsApp. 📲 +56 9 5729 6035` };
            }
            log('info', 'generarPdf.retry_post_escalation', `Cooldown 1h cumplido para ${convKey} (${lq.quote_number}); 1 reintento de entrega`);
            // sigue al flujo normal: el folio se REUSA más abajo y los intentos se re-registran.
          }

          // Dedup por TELÉFONO real si lo hay (un lead = un folio aunque pase de IG a WhatsApp);
          // si no hay teléfono (IG/FB sin número), por canal:sender. [2026-06-14 review]
          const dedupKey = (input.phone && String(input.phone).replace(/\D/g, '').length >= 8)
            ? `tel:${String(input.phone).replace(/\D/g, '')}` : convKey;
          // GUARD anti-doble-folio: un lead = un folio en la ventana de 2 min.
          const prevQ = RECENT_QUOTES.get(dedupKey);
          if (prevQ && (Date.now() - prevQ.at) < QUOTE_DEDUP_MS) {
            log('info', 'generarPdf.dedup', `Cotización duplicada evitada para ${dedupKey}; reusando ${prevQ.quote_number}`);
            // [IG-LOOP 2026-07-01] HONESTIDAD: si esa propuesta NO se entregó, no decir "ya te emití"
            // (era parte del loop que perdió al cliente). Decir la verdad: Marcelo la envía.
            const _undelivered = lq && lq.quote_number === prevQ.quote_number && lq.pdf_sent === false;
            return { ok: true, quote_number: prevQ.quote_number, pdf_sent: false, deduped: true,
              message: _undelivered
                ? `Tu Propuesta Técnica Económica N° ${prevQ.quote_number} está lista — el Ing. Marcelo Cifuentes te la hará llegar por WhatsApp. 📲 +56 9 5729 6035`
                : `Ya te emití tu Propuesta Técnica Económica N° ${prevQ.quote_number}.` };
          }

          const SALES_OS_URL = (process.env.SALES_OS_URL || '').replace(/\/$/, '');
          const OPERATOR_TOKEN = process.env.SALES_OS_OPERATOR_TOKEN || '';

          // ── [PDF-RACE 2026-07-01] GUARD de COMPLETITUD: PDF formal SOLO con datos confirmados ──
          // (compartido con webhook.js). Sin nombre real o ítems incompletos: NO se quema folio ISO.
          // 🔴 [2026-08-31] IG/FB YA PUEDE CAZAR EL "BLANCO QUE NADIE PIDIO" - Y SIN RIESGO.
          // Se pasa `textoColor` y NO `textoCliente`, y la diferencia es la que la compuerta
          // cruzada dejo escrita: `textoCliente` activa TAMBIEN el gate de la APERTURA, que SI
          // bloquea y que en este canal no tiene rama de pregunta ni reloj => dejaria PDFs
          // bloqueados con el mensaje generico y para siempre (Codex, 2a pasada). El gate del
          // color, desde hoy, no bloquea nada: entrega tres propuestas. Por eso es seguro.
          // TODO lo que el cliente escribio en la conversacion, no solo este turno. Lo usan
          // tres cosas: el gate del color, la compuerta de procedencia del receptor (un dato
          // del LLM tiene que APARECER en lo que el cliente escribio) y las sondas de precio.
          const _textoCliente = textoDelCliente(history, text);
          // [2026-09-03] `pushName`/`comuna`: con que nombre sale el documento cuando el cliente
          // no lo dio. En IG/FB el equivalente del push_name de WhatsApp es `senderName` (el
          // nombre publico del perfil), que este canal ya recibe.
          const _gate = quoteDataComplete(input, state, { textoColor: _textoCliente,
            pushName: senderName, comuna: state.comuna || input.comuna || '' });
          if (!_gate.ok) {
            log('error', 'generarPdf.gate', `PDF bloqueado por datos incompletos: ${_gate.missing.join(', ')}`);
            // 🔴 [2026-09-03] LA RAMA DEL NOMBRE YA NO EXISTE, y no es un olvido.
            // Decision del dueño: *"LA IDEA ES COTIZARLE IGUAL A CLIENTE SOLO ACTUALIZAR SI
            // DESPUES VIENE EL DATO CORRECTO"*. `quoteDataComplete` ya no mete 'name' en
            // `missing`, asi que preguntarlo aca dejaria un mensaje muerto. Lo que queda en
            // este gate son los datos SIN los cuales no hay nada que cotizar (items, medidas,
            // precio) — y esos no se le piden al cliente con un texto generico, se resuelven.
            return { ok: false, reason: 'datos_incompletos', missing: _gate.missing,
              message: 'Antes de emitir la propuesta formal necesito confirmar un detalle de las ventanas. Ya te pregunto.' };
          }

          // 🎨 [2026-08-31 - DECISION DEL DUENO] SIN COLOR -> TRES PROPUESTAS, TAMBIEN ACA.
          // *"cuando cliente no entrega color entreguemosle blanco, nogal y negro"*. La regla,
          // los colores, las letras y el texto son los MISMOS que en WhatsApp (propuestas-color.js):
          // lo unico distinto es la caneria de envio, que en este canal es `sendChannelDocument`.
          // ⛔ Igual que en WhatsApp: NO se escribe `state.default_color`. El cliente no eligio.
          let _coloresTerna = null;
          let _letrasTerna = 0;
          if (_gate.coloresPropuestos && _gate.coloresPropuestos.length > 1) {
            _coloresTerna = _gate.coloresPropuestos.slice();
            (input.items || []).forEach((it) => { it.color = _coloresTerna[0]; });
            log('info', 'generarPdf.color',
              `${convKey}: sin color del cliente -> ${_coloresTerna.length} propuestas (${_coloresTerna.join(' / ')})`);
          }

          // ── [2026-08-31] MEDIDAS RESUELTAS antes de pedirle nada al motor ──────────
          // Porteado de webhook.js: "AxBmm" es el transporte INTERNO de la confirmacion de
          // unidad. Aca se separa en campos numericos (las sondas de abajo re-cotizan EXACTO,
          // sin re-parsear heuristicas) + string limpio para el documento ("350x600").
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

          // ⛔ [2026-08-31] LA OPCION A TAMBIEN SE COTIZA PARA SU COLOR.
          // No alcanza con cambiarle la etiqueta arriba: el precio que trae `input.items` lo
          // compuso el turno anterior con el color por DEFECTO, y las opciones B/C SI se
          // re-cotizan (paso 3-bis). Mientras la A fue el Blanco coincidia por casualidad; al
          // pasar el orden a "del mas caro al mas economico" (decision del dueno) la A quedo
          // rotulada New Black CON EL PRECIO DEL BLANCO — un documento formal con la etiqueta
          // de un color y el precio de otro, que es justo lo que este archivo prohibe.
          // Si el motor no responde, se sigue con lo que habia: nunca se frena al cliente.
          if (_coloresTerna && _coloresTerna.length > 1) {
            // Se prueban los colores EN ORDEN y la A es el primero que el motor sepa cotizar.
            // Es la misma regla que ya aplicaban las B y C, que se descartan solas cuando su
            // color no se puede cotizar; la A era la unica excepcion.
            const _sinCotizar = [];
            let _colorAok = null;
            for (const _cand of _coloresTerna) {
              try {
                const _sondaA = {
                  items: (input.items || []).map((it) => ({
                    product:     it.producto_label || it.product || 'Ventana',
                    measures:    _measuresForEngine(it),
                    color:       _cand,
                    qty:         Number(it.qty) || 1,
                    ambiente:    it.ambiente || '',
                    descripcion: it.descripcion || it.ambiente || '',
                    orientacion: it.compuesta?.orientacion || it.orientacion || undefined,
                    partes:      Array.isArray(it.compuesta?.partes) ? it.compuesta.partes : undefined,
                  })),
                  comuna: input.comuna || state.comuna || '',
                  texto_cliente: _textoCliente,
                };
                await priceAllFn(_sondaA);
                const _todas = _sondaA.items.length === (input.items || []).length
                  && _sondaA.items.every((x) => Number(x.unit_price) > 0 && x.confidence === 'high');
                if (!_todas) { _sinCotizar.push(_cand); continue; }
                _sondaA.items.forEach((x, k) => {
                  const _it = (input.items || [])[k];
                  if (!_it) return;
                  _it.color       = _cand;
                  _it.unit_price  = Number(x.unit_price);
                  _it.total_price = Number(x.total_price) || Number(x.unit_price) * (Number(_it.qty) || 1);
                  _it.source      = x.source || _it.source;
                  _it.confidence  = x.confidence;
                });
                _colorAok = _cand;
                break;
              } catch (e) {
                _sinCotizar.push(_cand);
                log('error', 'generarPdf.opcionA.precio', `${_cand}: ${e?.message || e}`);
              }
            }
            if (!_colorAok) {
              // Ningun color de la terna se pudo cotizar. Se rotula BLANCO, que es el color al
              // que corresponde el precio que ya traia (es el defecto del motor), asi etiqueta
              // y precio quedan coherentes. La terna NO se anula: mas abajo, al quedar una
              // sola propuesta, sale el aviso de siempre. Anularla aca dejaba al cliente con
              // una blanca y SIN enterarse de que el color no lo eligio el.
              (input.items || []).forEach((it) => { it.color = 'Blanco'; });
              state.default_color = state.default_color || 'Blanco';
              log('error', 'generarPdf.opcionA.precio',
                `${convKey}: el motor no cotizo NINGUNO de los colores; sale una sola en Blanco con aviso`);
            } else if (_sinCotizar.length) {
              // Salen los que si se pudieron, y las letras se recalculan sobre esos: sin esto
              // se le prometeria al cliente un color que nunca va a llegar.
              _coloresTerna = _coloresTerna.filter((c) => !_sinCotizar.includes(c));
              log('warn', 'generarPdf.opcionA.precio',
                `${convKey}: el motor no cotizo ${_sinCotizar.join(' / ')}; la terna queda en ${_coloresTerna.join(' / ')}`);
              if (_coloresTerna.length < 2) _coloresTerna = null;
            }
          }

          // Paso 1: correlativo ISO — MISMA fuente única que WhatsApp (un solo folio).
          // [IG-LOOP 2026-07-01] Si la sesión YA tiene folio (state.last_quote persiste en Postgres),
          // se REUSA: correcciones y reintentos NO queman correlativos nuevos (antes: 0073→0074, y
          // 0081→0085→0086 por regenerar tras cada corrección). Folio nuevo = solo sesión sin folio.
          let quoteNumber = (lq && lq.quote_number) ? lq.quote_number : null;
          if (quoteNumber) log('info', 'generarPdf.folio', `Reusando folio de la sesión ${quoteNumber} para ${convKey}`);
          if (!quoteNumber) try {
            const cr = await fetch(`${SALES_OS_URL}/internal/quotes/next-number`, {
              method: 'POST',
              headers: { 'x-api-key': OPERATOR_TOKEN, 'Content-Type': 'application/json' },
              body: JSON.stringify({ tenant_id: 'activa' }),
              signal: AbortSignal.timeout(8000),
            });
            if (cr.ok) { const cj = await cr.json(); quoteNumber = cj.quote_number || cj.number || null; }
          } catch (err) { log('error', 'generarPdf.correlativo', err); }
          if (!quoteNumber) {
            // [2026-06-14 review] El fallback NO inventa un folio fantasma (rompía la trazabilidad
            // ISO y podía colisionar). Si el contador no responde: NO se emite PDF, se pide reintento
            // y se escala a Marcelo. Mejor demorar el PDF que quemar un folio no-trazable.
            log('error', 'generarPdf.correlativo', 'next-number no disponible → no se emite PDF (sin folio fantasma)');
            await safe('generarPdf.correlativo.escalate', () =>
              notifyHighValue(sendWhatsAppText, senderId,
                { data: { ...state, name: input.name || state.name || senderName }, history },
                `[${channel}] cliente pidió Propuesta Técnica Económica pero el correlativo ISO no respondió — atender desde el inbox`));
            return { ok: false, reason: 'correlativo_no_disponible',
              message: 'Dame un momentito para emitir tu Propuesta Técnica Económica con su folio; si se demora, Marcelo te la hace llegar enseguida.' };
          }
          RECENT_QUOTES.set(dedupKey, { quote_number: quoteNumber, at: Date.now() });
          // Evicción por antigüedad (no clear() ciego, que abría ventana de doble-folio en carga).
          if (RECENT_QUOTES.size > 500) {
            const cutoff = Date.now() - QUOTE_DEDUP_MS;
            for (const [k, v] of RECENT_QUOTES) if (!v || v.at < cutoff) RECENT_QUOTES.delete(k);
          }

          // 🎨 [2026-08-31] Los folios de las tres, de una sola vez: 0392 - 0392-B - 0392-C.
          // Un solo correlativo ISO; las variantes son LETRAS (verificado contra la BD viva:
          // la letra no consume correlativo). `alternativas` se arrastra en `last_quote` para
          // que una segunda terna del mismo cliente no reuse la B y la C.
          const _folios = _coloresTerna
            ? foliosDeOpciones(quoteNumber, _coloresTerna.length, Number((lq || {}).alternativas) || 0)
            : [];
          if (_coloresTerna && _folios.length < 2) {
            log('warn', 'generarPdf.opciones', `${convKey}: no se pudieron componer las letras sobre ${quoteNumber}; sale una sola`);
            _coloresTerna = null;
          }

          // Paso 2: PDF premium (mismo generador → folio ISO impreso en el documento).
          // [2026-09-03] Lo resuelve el gate (`resolverNombre`), igual que en WhatsApp: una sola
          // regla para los dos canales. Antes esta cascada y la del webhook eran dos copias, y
          // dos copias de una regla se desincronizan.
          const clientName = _gate.nombre || senderName || 'Cliente';
          const clientPhone = input.phone || '';
          // [2026-08-28] Identidad CRM por canal (caso Alfredo): en WhatsApp senderId ES el
          // teléfono del hilo real → manda senderId (el celular dictado para el documento creaba
          // conversaciones/leads fantasma). En IG/FB senderId es un PSID (no teléfono) → ahí el
          // celular dictado es el único teléfono real y se conserva el comportamiento anterior.
          const crmPhone = channel === 'whatsapp' ? (senderId || clientPhone) : (clientPhone || senderId);
          const clientComuna = input.comuna || state.comuna || '';

          // 🔴 [2026-08-31] A NOMBRE DE QUIEN VA LA PROPUESTA — paridad con webhook.js.
          // Dos fuentes, y el orden importa: MANDA lo que capturo el codigo (state.receptor,
          // extraido literal de lo que escribio el cliente) y el LLM solo RELLENA lo que
          // falte, tipicamente la razon social cuando el cliente la dijo en otro mensaje.
          // `fusionarReceptor(previo, nuevo)` hace ganar al `nuevo`, por eso el determinista
          // va segundo.
          // ⛔ ANTI-ALUCINACION: venga de donde venga, el RUT vuelve a pasar por modulo 11
          // dentro de `receptorParaDocumento`; si no cierra, el documento sale SIN RUT. Un RUT
          // inventado en una propuesta formal es un problema legal: el cliente la lleva a
          // facturar y no le cuadra.
          // Y por eso viaja `textoCliente` con TODA la conversacion: la compuerta de
          // procedencia exige que un dato de origen 'llm' APAREZCA en lo que el cliente
          // escribio. Sin este parametro la compuerta queda escrita pero muerta; con solo el
          // turno actual, el cliente que dicta el RUT y en el mensaje siguiente dice "dale,
          // cotizame" lo perderia por "inventado". Y la procedencia se mira POR CAMPO
          // (`origenCampos`): un RUT verdadero no le lava la procedencia a una razon social
          // inventada.
          const _receptorLLM = (input.rut || input.razon_social || input.cliente_tipo)
            ? {
              rut: String(input.rut || ''),
              razonSocial: String(input.razon_social || ''),
              clienteTipo: input.cliente_tipo === 'empresa' ? 'empresa'
                : (input.cliente_tipo === 'particular' ? 'particular' : ''),
              origen: 'llm',
            }
            : null;
          const receptorDoc = receptorParaDocumento(
            state.receptor ? fusionarReceptor(_receptorLLM, state.receptor) : _receptorLLM,
            { nombreFallback: clientName, textoCliente: _textoCliente || text }
          );
          // EL RECEPTOR SOBREVIVE AL TURNO. Si la razon social la aporto el LLM (porque el
          // cliente la escribio en un mensaje que el extractor no rotulo), sin esto se
          // perderia: el cerebro saca la foto del estado AL EMPEZAR, asi que todo lo que una
          // tool escriba durante el turno queda afuera. Se cierra con el merge del final
          // (`if (state.receptor) newState.receptor = state.receptor`), igual que last_quote.
          if (receptorDoc) {
            state.receptor = fusionarReceptor(state.receptor, {
              clienteTipo: receptorDoc.clienteTipo,
              razonSocial: receptorDoc.razonSocial,
              rut: receptorDoc.rut,          // ya validado por modulo 11 (vacio si no cerro)
            });
          }

          const pdfData = {
            name: clientName, phone: clientPhone, comuna: clientComuna,
            // { nombre, razonSocial, rut, clienteTipo } o null. Sin receptor la propuesta se
            // imprime EXACTAMENTE como antes de este cambio.
            receptor: receptorDoc,
            address: state.address || '',
            // 🎨 [2026-08-31] Que opcion es esta, visible al abrir el archivo (paridad con
            // WhatsApp). `undefined` sin terna => el documento sale exactamente como siempre.
            opcion: _coloresTerna ? { letra: _folios[0].letra, color: _coloresTerna[0] } : undefined,
            default_color: (input.items?.[0]?.color) || state.default_color || '',
            items: (input.items || []).map((it) => ({
              product: it.producto_label || it.product || 'Ventana',
              producto_label: it.producto_label || it.product || 'Ventana',
              measures: it.measures || '', color: it.color || '',
              qty: Number(it.qty) || 1, unit_price: Number(it.unit_price) || 0,
              glass_label: it.glass_label || 'Termopanel DVH', ambiente: it.ambiente || '',
            })),
            quote_num: quoteNumber,
          };
          const pdfBuffer = await generatePdf(pdfData, quoteNumber);

          // Paso 3: ENTREGAR el PDF por el canal con SUBIDA BINARIA a Meta (sin URL pública →
          // los precios NUNCA quedan expuestos). FB siempre; IG si la cuenta está ligada a la Página.
          const filename = `${quoteNumber}.pdf`;
          const sr = await safe('generarPdf.send', () =>
            sendChannelDocument(channel, senderId, pdfBuffer, filename, `Propuesta Técnica Económica N° ${quoteNumber} · Activa Inversiones`));
          const pdfSent = !!(sr && sr.ok !== false);
          const outsideWindow = !!(sr && sr.outsideWindow);

          // 🎨 Paso 3-bis: LAS OTRAS DOS PROPUESTAS (opciones B y C)
          // Mismo diseno que WhatsApp (webhook.js, Paso 3b-bis) y por las mismas razones:
          //   - CADA UNA AISLADA: el `try` va DENTRO del bucle, asi un fallo en la B no se
          //     lleva la C, y el cliente nunca queda sin nada por un error parcial.
          //   - EL PRECIO DE CADA COLOR SE LO DA EL MOTOR, nunca se deriva del blanco. Si el
          //     motor no cotiza ESE color para TODOS los items, la opcion se descarta entera:
          //     antes eso que un documento formal con la etiqueta de un color y el precio de
          //     otro (regla anti-alucinacion del proyecto).
          //   - `status:'alternativa'` y NO 'sent': guarda la fila (trazabilidad ISO, cada
          //     folio en su propia fila) y NO dispara conversion - un cliente que no eligio
          //     color es UNA oportunidad, no tres. Ver el comentario largo en webhook.js.
          const _opcionesEntregadas = [];
          if (_coloresTerna && _folios.length > 1) {
            // `total` viaja con cada opcion porque de el sale el monto que se le reporta a
            // Meta/Google mas abajo (`_montoReportado`).
            if (pdfSent) _opcionesEntregadas.push({ letra: _folios[0].letra, color: _coloresTerna[0], numero: quoteNumber,
              total: (input.items || []).reduce((s, it) => s + (Number(it.unit_price) || 0) * (Number(it.qty) || 1), 0) });
            for (let _i = 1; _i < _folios.length && _i < _coloresTerna.length; _i++) {
              const _colorOp = _coloresTerna[_i];
              const _numOp   = _folios[_i].numero;
              const _letraOp = _folios[_i].letra;
              try {
                // Mismo shape de sonda que la de la opcion A (probado), con TODOS los items y
                // con la composicion/orientacion: sin ellas una ventana COMPUESTA vertical se
                // re-cotizaba como un pano suelto horizontal, o el motor no la cotizaba y la
                // opcion se descartaba por un error que no era del color.
                const _sonda = {
                  items: (input.items || []).map((it) => ({
                    product:     it.producto_label || it.product || 'Ventana',
                    measures:    _measuresForEngine(it),
                    color:       _colorOp,
                    qty:         Number(it.qty) || 1,
                    ambiente:    it.ambiente || '',
                    descripcion: it.descripcion || it.ambiente || '',
                    orientacion: it.compuesta?.orientacion || it.orientacion || undefined,
                    partes:      Array.isArray(it.compuesta?.partes) ? it.compuesta.partes : undefined,
                  })),
                  comuna: clientComuna,
                  texto_cliente: _textoCliente,
                };
                await priceAllFn(_sonda);
                const _todosConPrecio = _sonda.items.length === (input.items || []).length
                  && _sonda.items.every((x) => Number(x.unit_price) > 0 && x.confidence === 'high');
                if (!_todosConPrecio) {
                  log('error', 'generarPdf.opcion',
                    `${convKey}: opcion ${_letraOp} (${_colorOp}) DESCARTADA - el motor no cotizo ese color para todos los items; ${_numOp} no se emite`);
                  continue;
                }
                const _pdfOp = {
                  ...pdfData,
                  quote_num: _numOp,
                  default_color: _colorOp,
                  opcion: { letra: _letraOp, color: _colorOp },
                  items: (input.items || []).map((it, k) => {
                    const _p = _sonda.items[k] || {};
                    return {
                      product:        _p.producto_label || it.producto_label || it.product || 'Ventana',
                      producto_label: _p.producto_label || it.producto_label || it.product || 'Ventana',
                      measures:       it.measures || '',
                      color:          _colorOp,
                      qty:            Number(it.qty) || 1,
                      unit_price:     Number(_p.unit_price) || 0,
                      glass_label:    _p.glass_label || it.glass_label || 'Termopanel DVH',
                      ambiente:       it.ambiente || '',
                      termico:        _p.termico || null,
                    };
                  }),
                };
                const _bufOp = await generatePdf(_pdfOp, _numOp);
                const _totalOp = _pdfOp.items.reduce((s, it) => s + (Number(it.unit_price) || 0) * (Number(it.qty) || 1), 0);
                const _srOp = await safe('generarPdf.opcion.send', () => sendChannelDocument(
                  channel, senderId, _bufOp, `${_numOp}.pdf`,
                  `Propuesta Técnica Económica N° ${_numOp} · Opción ${_letraOp} — ${_colorOp} · Activa Inversiones`));
                const _sentOp = !!(_srOp && _srOp.ok !== false);
                if (_sentOp) _opcionesEntregadas.push({ letra: _letraOp, color: _colorOp, numero: _numOp, total: _totalOp });
                else log('error', 'generarPdf.opcion', `${convKey}: opcion ${_letraOp} (${_colorOp}) ${_numOp} NO se pudo entregar`);

                await safe('generarPdf.opcion.registro', () => bridge.pushQuoteEvent({
                  phone: crmPhone, channel, customer_name: clientName,
                  amount_total: _totalOp, currency: 'CLP',
                  status: 'alternativa', quote_number: _numOp,
                  receptor: receptorDoc || null,
                  variante: { letra: _letraOp, color: _colorOp, base: _folios[0].numero,
                              motivo: 'cliente_no_declaro_color', pdf_sent: _sentOp },
                  items: _pdfOp.items.map((it) => ({
                    producto: it.producto_label || null, medidas: it.measures || null,
                    cantidad: Number(it.qty) || 1, unitario: Number(it.unit_price) || null,
                    color: it.color || null, vidrio: it.glass_label || null,
                    ambiente: it.ambiente || null, uw: it.termico?.uw ?? null,
                  })),
                  lead: {
                    source: channel || 'oliver_gpt', channel: channel || null,
                    lead_name: clientName || null, name: clientName || null,
                    phone: crmPhone || null, comuna: clientComuna || null, city: clientComuna || null,
                    status: 'quoted', external_id: senderId || null,
                  },
                  // ⛔ SIN click-ids: no dispara conversion y no debe invitar a que alguien
                  // "arregle" el status manana y triplique el reporte a Meta/Google.
                }));
              } catch (e) {
                log('error', 'generarPdf.opcion.err', `${_letraOp} (${_colorOp}) ${_numOp}: ${e?.message || e}`);
              }
            }
            // Las letras quedan consumidas aunque una haya fallado: reciclarlas pondria dos
            // documentos distintos bajo el mismo numero (el pisado del caso Paula).
            _letrasTerna = letrasReservadas(_folios);
            log('info', 'generarPdf.opciones',
              `${convKey}: ${_opcionesEntregadas.length}/${_folios.length} propuestas entregadas (${_opcionesEntregadas.map((o) => `${o.letra}=${o.color}`).join(', ') || 'ninguna'})`);
          }
          // Lo que se le dice al cliente: SOLO lo que de verdad salio. Con una sola no hay
          // terna que explicar, pero tampoco puede quedarse con una blanca sin enterarse de
          // que el color no lo eligio el.
          const _avisoOpciones = !_coloresTerna ? ''
            : _opcionesEntregadas.length >= 2
              // Se le pasan los colores que SIGUEN en pie (no los tres de catalogo): si el
              // motor no supo cotizar uno, no se le puede prometer al cliente un color que
              // nunca va a llegar.
              ? `\n\n${textoDeOpciones(_opcionesEntregadas, _coloresTerna)}`
              // En USTED, igual que `textoDeOpciones`: los dos textos se pegan al MISMO mensaje
              // y mezclar tu/usted en un parrafo es la falta que el system-prompt prohibe con
              // nombre y apellido (Gemini, compuerta del 28-ago).
              : '\n\n🎨 Se la preparé en *Blanco* mientras me confirma el color. Si prefiere'
                + ' Nogal, Roble Dorado, Grafito Antracita o Negro, me avisa y se la recotizo'
                + ' sin costo; el color cambia el precio, por eso se lo digo.';

          // Paso 4: Zoho CRM (fire-and-forget, channel-agnostic).
          const _totalDocA = Number(input.grand_total) ||
            (input.items || []).reduce((s, it) => s + (Number(it.unit_price) || 0) * (Number(it.qty) || 1), 0);

          // 💰 [2026-08-31] QUE MONTO SE LE REPORTA A META Y GOOGLE CUANDO SALEN TRES.
          // ESTO TOCA PLATA Y ES UNA DECISION DEL DUENO, no del codigo. Queda en UNA linea
          // (`_montoReportado`) justamente para que se pueda cambiar sin tocar nada mas.
          //
          // El cliente recibio tres propuestas y NO eligio ninguna todavia. Los tres precios
          // son distintos (el New Black sale ~44% mas que el Blanco), asi que "cuanto vale
          // esta cotizacion" no tiene una respuesta unica.
          //
          // Se reporta EL MAS BAJO de las que salieron, por dos razones:
          //   1. Es lo que las plataformas reciben HOY: antes la opcion A era el Blanco. Este
          //      cambio de orden es una decision de PRESENTACION al cliente y no tiene por que
          //      mover la senal que entrena el reparto de presupuesto.
          //   2. Es el piso real del negocio: si el cliente elige el mas barato, es lo que hay.
          //      Reportar el mas caro por algo que nadie eligio le ensena al algoritmo que ese
          //      trafico vale mas de lo que se sabe.
          // Cuando el cliente ELIGE, ahi si corresponde reportar lo que eligio — eso todavia
          // no existe (es el defecto B2: el sistema no entiende "quiero la B").
          const _montoReportado = (_opcionesEntregadas && _opcionesEntregadas.length > 1)
            ? Math.min(..._opcionesEntregadas.map((o) => Number(o.total) || Infinity).filter(Number.isFinite))
            : _totalDocA;
          const grandTotal = Number.isFinite(_montoReportado) && _montoReportado > 0 ? _montoReportado : _totalDocA;
          safe('generarPdf.zoho', async () => {
            const dealId = await upsertZohoDeal({
              phone: crmPhone, name: clientName, comuna: clientComuna, // [2026-08-28] Zoho dedupe por identidad CRM por canal
              // [2026-08-31] El RUT y la razon social al Deal: cuando Marcelo lo abre para
              // facturar los tiene ahi sin ir a buscar el PDF. Ya validado por modulo 11.
              receptor: receptorDoc,
              items: input.items || [], grand_total: grandTotal, stageKey: 'propuesta', quote_number: quoteNumber,
            });
            if (dealId) {
              await addZohoNote(dealId, `Cotización enviada: ${quoteNumber}`,
                `PDF enviado al cliente por ${channel}.\nTotal: $${grandTotal.toLocaleString('es-CL')} CLP (IVA incl.)`);
              await attachPdfToDeal(dealId, pdfBuffer, filename); // [#6 paridad] adjuntar PDF al Deal (trazabilidad ISO)
            }
          });

          // Paso 5: conversión multicanal (anti-cross-inject: canal del lead = el real IG/FB).
          // [2026-08-28] FIX identidad (caso real Alfredo 56952077379): el celular que el cliente
          // DICTA para el documento (input.phone, ej. "974266456") NO es la identidad del chat.
          // Con clientPhone primero, sales-os creaba conversaciones/leads FANTASMA con ese número
          // (974266456 y 56974266456, cero mensajes) y las cotizaciones quedaban colgadas ahí →
          // el inbox mostraba al cliente "Sin mensajes aún". crmPhone (arriba) es el hilo real.
          safe('generarPdf.conversion', () =>
            bridge.pushQuoteEvent({
              phone: crmPhone, channel, customer_name: clientName,
              amount_total: grandTotal, currency: 'CLP', status: 'sent', quote_number: quoteNumber,
              // 🔴 [2026-08-31] A NOMBRE DE QUIEN SE EMITIO. Un documento formal tiene que
              // poder reconstruirse desde la BD: si manana hay una disputa por una factura,
              // `quotes.payload->'receptor'` dice con que RUT y a que razon social salio esa
              // propuesta. `quoteService.upsertQuote` (sales-os) guarda el payload entero en
              // la columna jsonb, asi que con mandarlo alcanza — cero cambios del servidor.
              // Solo viaja si paso modulo 11: en la BD tampoco entra un RUT inventado.
              receptor: receptorDoc || null,
              fbclid: state.fbclid || null, gclid: state.gclid || null,
              ttclid: state.ttclid || null, ctwa_clid: state.ctwa_clid || null,
              ad_id: state.ad_id || null, landing_ref: state.landing_lead_id || null,
              // [2026-07-11 FIX lead_id NULL] sin este campo, quoteService.upsertQuote (sales-os)
              // no puede resolver lead_id → JOIN quotes→leads roto (auditoría BD viva confirmada).
              // Réplica de buildLeadPayload (index.js, ruta legacy WhatsApp) con los datos que
              // el flujo GPT v2 (IG/FB) tiene a mano en este punto; lo no disponible queda null.
              lead: {
                source: channel || 'oliver_gpt',
                channel: channel || null,
                lead_name: clientName || null,
                name: clientName || null,
                phone: crmPhone || null, // [2026-08-28] identidad CRM por canal, no el celular dictado
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
                external_id: senderId || null,
                fbclid: state.fbclid || null, gclid: state.gclid || null,
                ttclid: state.ttclid || null, ctwa_clid: state.ctwa_clid || null,
                ad_id: state.ad_id || null, landing_ref: state.landing_lead_id || null,
              },
              payload: { comuna: clientComuna, ctwa_clid: state.ctwa_clid || null,
                ad_id: state.ad_id || null, landing_ref: state.landing_lead_id || null,
                fbclid: state.fbclid || null, gclid: state.gclid || null, ttclid: state.ttclid || null },
            })
          );

          // Si NO se entregó el PDF por el canal → escalar a Marcelo (no se pierde en silencio).
          if (!pdfSent) {
            // [IG-LOOP 2026-07-01] rastro PERSISTENTE del fallo: 1 solo reintento permitido; al 2°
            // fallo queda escalated=true y el guard de arriba corta todo reintento futuro en código.
            const _attempts = ((lq && lq.quote_number === quoteNumber) ? (Number(lq.deliveryAttempts) || 0) : 0) + 1;
            state.last_quote = { quote_number: quoteNumber, at: Date.now(),
              deliveryAttempts: _attempts, escalated: _attempts >= 2, pdf_sent: false,
              // [2026-08-31] Las letras que la terna reservo: sin esto, una segunda terna del
              // mismo cliente volveria a componer -B y -C y habria dos documentos distintos
              // bajo el mismo folio (el pisado del caso Paula).
              alternativas: Math.max(Number((lq || {}).alternativas || 0), _letrasTerna) };
            await safe('generarPdf.escalate', () =>
              notifyHighValue(sendWhatsAppText, senderId,
                { data: { ...state, name: clientName, comuna: clientComuna, quote_number: quoteNumber }, history },
                `[${channel}] PDF ${quoteNumber} no se pudo entregar${outsideWindow ? ' (fuera de ventana 24h)' : ''} (intento ${_attempts}) — enviarlo desde el inbox (ops.activalabs.ai)`));
            return { ok: true, quote_number: quoteNumber, pdf_sent: false,
              // Si la A no salio pero las alternativas si, se le dice cuales tiene: quedarse
              // callado sobre archivos que el cliente YA recibio es peor que el fallo mismo.
              message: `Tu Propuesta Técnica Económica N° ${quoteNumber} está lista ✅ No pude enviarte el archivo por este canal — el Ing. Marcelo Cifuentes Méndez (Ingeniero Civil Industrial, Gerente de Ingeniería de Activa) te la enviará directamente a tu WhatsApp. 📲 +56 9 5729 6035`
                + (_opcionesEntregadas.length >= 2 ? `\n\n${textoDeOpciones(_opcionesEntregadas, _coloresTerna)}` : '') };
          }

          // [IG-LOOP 2026-07-01] entrega OK → registrar folio como entregado (dedup honesto + reuso).
          state.last_quote = { quote_number: quoteNumber, at: Date.now(),
            deliveryAttempts: 0, escalated: false, pdf_sent: true,
            alternativas: Math.max(Number((lq || {}).alternativas || 0), _letrasTerna) };
          return { ok: true, quote_number: quoteNumber, pdf_sent: true,
            // [2026-08-08] Mismo cierre activo que en webhook.js: este mensaje llega justo
            // cuando el cliente ve el precio, y decia "Cualquier duda la vemos" — el cierre
            // pasivo que el paso 8 prohibe. Esta en CODIGO, asi que el prompt no lo tocaba.
            message: `Listo ✅ Te envié tu Propuesta Técnica Económica N° ${quoteNumber} acá mismo (PDF).

Para que los números queden 100% finos lo ideal es ir a medir. ¿Le mando el link para que elija el día que le acomode, o prefiere que lo llame Marcelo y lo coordinan?${_avisoOpciones}` };
        }),
    };

    // ── ENTREGA DETERMINISTA DEL PDF (crítica, NO depende del LLM) ───────
    // [2026-06-15] Si el cliente CONFIRMA tras una cotización ya lista (state.pending_quote, capturada
    // del turno anterior), mandamos el PDF en CÓDIGO. El PDF es la formalidad: dar solo el precio en texto
    // pierde al cliente. En prod el LLM a veces escribía "[Enlace a la cotización]" sin llamar la tool.
    if (state.pending_quote && Array.isArray(state.pending_quote.items) && state.pending_quote.items.length
        && isPdfAffirmative(text) && lastAssistantOfferedPdf(history)) {
      const pq = state.pending_quote;
      const pdfRes = await safe('pdf.deterministic', () => toolCtx.generarPdf({
        name: state.name || senderName, phone: state.telefono || '', comuna: state.comuna || '',
        items: pq.items, grand_total: pq.grand_total,
      }));
      const replyMsg = (pdfRes && pdfRes.message) ||
        `Listo ✅ Te envié tu Propuesta Técnica Económica${pdfRes?.quote_number ? ` N° ${pdfRes.quote_number}` : ''} acá mismo (PDF).

Para que los números queden 100% finos lo ideal es ir a medir. ¿Le mando el link para que elija el día que le acomode, o prefiere que lo llame Marcelo y lo coordinan?`;
      await safe('pdf.send', () => sendFn(senderId, replyMsg));
      // [2026-07-14 media→inbox] Un AUDIO transcrito "sí" (confirmación de PDF) cae acá:
      // paridad con el persist principal para no perder la burbuja del audio original.
      const mediaEvtPdf = await resolveInboundMediaEvent(mediaEntrante);
      await safe('pdf.persistIn', () => bridge.pushConversationEvent({
        channel, external_id: senderId, direction: 'inbound', actor_type: 'customer',
        actor_name: senderName || 'Cliente', message_type: mediaEvtPdf ? mediaEvtPdf.message_type : 'text', body: text,
        metadata: { source: 'oliver_gpt_channel', msg_id: msgId, pdf_confirm: true, ...(mediaEvtPdf ? mediaEvtPdf.metadata : {}) },
      }));
      await safe('pdf.persistOut', () => bridge.pushConversationEvent({
        channel, external_id: senderId, direction: 'outbound', actor_type: 'ai',
        actor_name: 'Oliver', message_type: 'text', body: replyMsg,
        metadata: { source: 'oliver_gpt_channel', pdf_deterministic: true, quote_number: pdfRes?.quote_number },
      }));
      const histPdf = [...history, { role: 'user', content: text }, { role: 'assistant', content: replyMsg }];
      const toStorePdf = { history: histPdf.length > MAX_HISTORY ? histPdf.slice(-MAX_HISTORY) : histPdf,
                           state: { ...state, pending_quote: null, lastMessageAt: Date.now() } };
      conv.set(convKey, toStorePdf);
      persistSession(convKey, toStorePdf);
      log('info', 'pdf.deterministic', `PDF determinista para ${convKey} (${pdfRes?.quote_number || 'sin folio'})`);
      return { ok: true, reply: replyMsg };
    }

    // ── Llamada al cerebro probado (con presupuesto de latencia por turno) ──
    // [2026-06-14] Si el turno se cuelga (ej: 429 acumulados de OpenAI), no dejamos al
    // cliente esperando minutos: a los TURN_TIMEOUT_MS lanzamos → catch → fallback amable.
    const TURN_TIMEOUT_MS = Number(process.env.CHANNEL_TURN_TIMEOUT_MS) || 50000;
    // [Ronda 2 2026-07-20] clearTimeout en finally: antes cada turno dejaba vivo hasta 50s
    // un Timeout+Promise aunque el cerebro respondiera en 2s (fuga diagnosticada 07-19;
    // sin doble-envío, pero acumulaba handles bajo tráfico y colgaba las suites de test).
    let _turnTimer = null;
    const turn = await Promise.race([
      handleTurn({ history, userText: text, state, toolCtx }),
      new Promise((_, rej) => { _turnTimer = setTimeout(() => rej(new Error('turn_timeout')), TURN_TIMEOUT_MS); }),
    ]).finally(() => { if (_turnTimer) clearTimeout(_turnTimer); });
    let reply = turn?.reply || '';
    const newHistory = Array.isArray(turn?.history) ? turn.history : history;
    const newState = turn?.state && typeof turn.state === 'object' ? turn.state : state;
    const toolCalls = Array.isArray(turn?.toolCalls) ? turn.toolCalls : [];
    copyAttributionState(newState, state);
    // [IG-LOOP 2026-07-01] el cerebro devuelve su propio state: sin este merge se perdería el
    // last_quote que generarPdf escribió DURANTE este turno (folio/reintentos/escalado persistente).
    if (state.last_quote) newState.last_quote = state.last_quote;
    // [2026-08-31] Y lo mismo con el receptor: el cerebro devuelve la foto que saco AL
    // EMPEZAR, asi que sin este merge se perderia tanto el RUT capturado arriba en codigo
    // como la razon social que generarPdf fusiono DURANTE el turno.
    if (state.receptor) newState.receptor = state.receptor;
    if (state.receptor_rechazado) newState.receptor_rechazado = state.receptor_rechazado;
    else delete newState.receptor_rechazado;   // el RUT bueno del turno borra el rechazo viejo

    // Capturar la cotización (ítems con precio REAL del motor) para la ENTREGA DETERMINISTA del PDF al
    // confirmar (ver arriba). Solo se actualiza si este turno cotizó; si no, se conserva la anterior.
    const _quoteItems = itemsFromQuoteCalls(toolCalls, newState.default_color || state.default_color);
    // [2026-08-25] Mismo recuerdo del color que en webhook.js: ver `recordarColor`.
    recordarColor(newState, _quoteItems);
    if (_quoteItems.length) {
      newState.pending_quote = {
        items: _quoteItems,
        grand_total: _quoteItems.reduce((s, it) => s + it.unit_price * (Number(it.qty) || 1), 0),
        at: Date.now(),
      };
    }

    // [#2 paridad 2026-06-21] Si este turno SE generó el PDF, el texto ES la entrega (usa el message del
    // tool): nunca un saludo ni "no lo puedo enviar". Limpia pending_quote (ya se entregó). Igual que WhatsApp.
    const _pdfCall = toolCalls.find((t) => t.name === 'generar_pdf_cotizacion' && t.result && t.result.message);
    if (_pdfCall) {
      reply = _pdfCall.result.message;
      if (_pdfCall.result.ok) newState.pending_quote = null;
    }
    // [#2 2026-06-21] Blindaje anti precio-suelto (REGLA #13): borra cualquier monto CLP del texto antes de enviar.
    const _replyPreFiltros = reply;
    reply = stripMontos(reply);
    reply = stripAccionesFalsas(reply); // [Ronda 4] "[Enlace...]"/"[Calculando...]" jamás llegan al cliente
    // [Ronda 4.1 — Codex] paridad con webhook.js: la historia refleja lo filtrado que
    // el cliente recibió de verdad (guarda de identidad protege el caso PDF).
    if (reply !== _replyPreFiltros) {
      const _lastF = newHistory[newHistory.length - 1];
      if (_lastF && _lastF.role === 'assistant' && _lastF.content === _replyPreFiltros) _lastF.content = reply;
    }

    // ── Enviar respuesta por el canal ───────────────────────────────────
    // [2026-06-14] Capturamos el resultado: si el envío falla (ej: fuera de la ventana de
    // 24h de Meta), NO marcamos el outbound como entregado y escalamos a Marcelo para que
    // atienda al cliente desde el inbox (no se pierde en silencio).
    let sendResult = null;
    // [2026-07-06 LOTE2] Paridad con WhatsApp: reply vacío = cliente sin respuesta → log + fallback
    // contextual (acá tampoco hubo PDF: _pdfCall habría sobreescrito reply) + aviso a Marcelo
    // (cooldown por cliente:motivo de highValueNotifier protege del spam).
    if (!reply || !String(reply).trim()) {
      try { log('error', 'turn.reply_empty', `${convKey}: toolCalls=${(toolCalls || []).map((t) => t.name).join(',') || 'ninguno'}`); } catch {}
      reply = (newState.pending_quote && Array.isArray(newState.pending_quote.items) && newState.pending_quote.items.length)
        ? '¿Le genero la propuesta en PDF con lo que ya cotizamos? Responda *sí* y se la envío al tiro 👍'
        : 'Disculpe, se me trabó la respuesta 😅. ¿Me repite lo último, por favor? Si prefiere, Marcelo también puede atenderlo directo al +56 9 5729 6035.';
      // [escéptico L2 — BLOQUEANTE] el history persistido debe reflejar el fallback real (agent.js:163
      // lo armó con content:'') → si no, lastAssistantOfferedPdf del próximo turno no ve la oferta.
      const _lastH = newHistory[newHistory.length - 1];
      if (_lastH && _lastH.role === 'assistant' && !String(_lastH.content || '').trim()) _lastH.content = reply;
      await safe('replyEmpty.notify', () =>
        notifyHighValue(sendWhatsAppText, senderId, { data: { ...newState }, history: newHistory },
          'oliver_gpt:respuesta_vacia — el cerebro devolvió texto vacío en ' + channel + ' (ver log turn.reply_empty); el cliente recibió un fallback'));
    }
    if (reply) {
      sendResult = await safe('send', () => sendFn(senderId, reply));
    }
    const delivered = !reply || (sendResult && sendResult.ok !== false);
    if (reply && !delivered) {
      const outsideWindow = sendResult && sendResult.outsideWindow;
      log('error', 'send.failed', `No se entregó a ${convKey}${outsideWindow ? ' (fuera de ventana 24h)' : ''}: ${sendResult && sendResult.error}`);
      await safe('send.escalate', () =>
        notifyHighValue(
          sendWhatsAppText,
          senderId,
          { data: { ...newState, canal: channel }, history: newHistory },
          `[${channel}] ${outsideWindow ? 'fuera de ventana 24h' : 'fallo de envío'} — responder al cliente desde el inbox (ops.activalabs.ai)`
        )
      );
    }

    // ── Persistencia (inbound + outbound) ───────────────────────────────
    // [2026-07-14 media→inbox] Si el turno traía adjunto IG/FB guardado en el MediaStore,
    // el inbound sale con message_type real + metadata.media_id → el inbox pinta la
    // foto/audio original (fast-path, igual que WhatsApp). Sin media → 'text' como siempre.
    const mediaEvt = await resolveInboundMediaEvent(mediaEntrante);
    await safe('persist.inbound', () =>
      bridge.pushConversationEvent({
        channel,
        external_id: senderId,
        customer_name: newState.name || senderName || '',
        direction: 'inbound',
        actor_type: 'customer',
        actor_name: 'Cliente',
        message_type: mediaEvt ? mediaEvt.message_type : 'text',
        body: text,
        metadata: { source: 'oliver_gpt_channel', msg_id: msgId, ...(mediaEvt ? mediaEvt.metadata : {}) },
      })
    );
    if (reply) {
      await safe('persist.outbound', () =>
        bridge.pushConversationEvent({
          channel,
          external_id: senderId,
          customer_name: newState.name || senderName || '',
          direction: 'outbound',
          actor_type: 'ai',
          actor_name: 'Oliver',
          message_type: 'text',
          body: reply,
          metadata: { source: 'oliver_gpt_channel', delivered, ...(delivered ? {} : { delivery_error: (sendResult && sendResult.error) || 'send_failed', outside_window: !!(sendResult && sendResult.outsideWindow) }) },
        })
      );
    }

    // Evento de tracking (si el bridge lo expone).
    if (typeof bridge.logOliverEvent === 'function') {
      await safe('persist.event', () =>
        bridge.logOliverEvent('turn_completed', {
          phone: senderId,
          channel,
          tool_calls: toolCalls.map((t) => t.name),
        })
      );
    }

    // ── Guardar cache actualizado (hot in-memory + Postgres para sobrevivir redeploys) ──
    const trimmed = newHistory.length > MAX_HISTORY ? newHistory.slice(-MAX_HISTORY) : newHistory;
    const toStore = { history: trimmed, state: { ...newState, lastMessageAt: Date.now() } };
    conv.set(convKey, toStore);
    persistSession(convKey, toStore); // fire-and-forget; no-op si no hay SALES_OS_URL/token

    return { ok: true, reply };
  } catch (err) {
    log('error', 'handleChannelTurn', err);
    // [2026-06-14] PRESERVAR CONTEXTO: aunque el turno falló (ej: 429 de OpenAI),
    // guardamos el mensaje del cliente en la sesión para que el SIGUIENTE turno NO
    // pierda lo que dijo (ej: "proyectantes"). Sin esto, un turno caído borraba el dato
    // → Oliver cotizaba el producto equivocado en el turno siguiente.
    try {
      const k = `${channel}:${senderId}`;
      const prev = conv.get(k) || { history: [], state: {} };
      const hist = Array.isArray(prev.history) ? prev.history.slice() : [];
      // Dedupe: no anexar si el último ya es el mismo mensaje del cliente (evita
      // user-messages duplicados/colgados que rompen la alternancia user/assistant).
      const last = hist[hist.length - 1];
      const alreadyThere = last && last.role === 'user' && last.content === text;
      if (text && !alreadyThere) hist.push({ role: 'user', content: text });
      const errStore = {
        history: hist.length > MAX_HISTORY ? hist.slice(-MAX_HISTORY) : hist,
        state: { ...(prev.state || {}), lastMessageAt: Date.now() },
      };
      conv.set(k, errStore);
      persistSession(k, errStore); // preserva contexto entre redeploys aun en error
    } catch { /* no-op: el preservar contexto nunca debe romper el fallback */ }
    // Fallback amable: el cliente no se queda sin respuesta.
    await safe('send.fallback', () =>
      sendFn(
        senderId,
        '¡Hola! Soy Oliver de Activa Inversiones 👋 Dame un momento, en breve te ayudo. ' +
          'Si prefieres atención inmediata, escríbenos por WhatsApp.'
      )
    );
    return { ok: false, reason: 'error' };
  } finally {
    // Liberar SIEMPRE el candado (cubre returns intermedios y excepciones).
    if (release) { try { release(); } catch { /* ya liberado */ } }
  }
}

export default { handleChannelTurn };
