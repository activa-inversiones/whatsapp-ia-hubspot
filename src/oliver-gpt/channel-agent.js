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
//   · Sesión in-memory por sender (no persiste entre redeploys). TODO: Postgres.
//   · Sin media saliente (catálogos/fotos) en IG/FB: Oliver describe por texto u
//     ofrece WhatsApp. TODO: enviar attachment por la API nueva de IG.
//   · Sin voz, sin visión/STT de adjuntos entrantes (IG/FB mandan adjuntos como
//     [attachment]; el cerebro pide describir por texto).
//   · PDF formal (correlativo ISO) NO se emite por IG/FB: se ofrece por WhatsApp
//     y se escala a Marcelo (decisión del dueño 2026-06-14: el flujo ISO/PDF vive
//     en WhatsApp, que es el que funciona; no arriesgar el camino que cobra).
//
// ESM, Node 18+.

import { handleTurn as realHandleTurn } from './agent.js';
import { notifyHighValue as realNotifyHighValue } from '../../services/highValueNotifier.js';
import * as realBridge from '../../services/salesOsBridge.js';
import { sendWhatsAppText as realSendWhatsAppText } from '../sales-agent/whatsapp-adapter.js';
import { resetIfInactive } from './session-store.js';

/* =========================================================================
 * ESTADO IN-MEMORY (piloto) — por canal+sender.
 *  · CONV: Map<"canal:senderId", {history, state}>
 *  · SEEN: Set<msgId>  (idempotencia)
 * ========================================================================= */
const CONV = new Map();
const SEEN = new Set();
const SEEN_MAX = 5000;
const MAX_HISTORY = 40;

/* =========================================================================
 * MUTEX por canal:sender — serializa turnos concurrentes del mismo cliente
 * (doble-tap: 2 mensajes seguidos con mid distinto). Sin esto, ambos turnos
 * leían el MISMO cache y el último conv.set() pisaba el historial del otro →
 * se perdía contexto (ej: la medida o "proyectante"). Porteado de webhook.js.
 * ========================================================================= */
const LOCKS = new Map();
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
 * @param {object} [deps]          - inyectables para tests (handleTurn, bridge,
 *                                   notifyHighValue, sendWhatsAppText, conv, seen)
 * @returns {Promise<{ ok:boolean, reply?:string, reason?:string }>}
 */
export async function handleChannelTurn(
  { channel, senderId, senderName = '', text = '', msgId = '', sendFn },
  deps = {}
) {
  const handleTurn      = deps.handleTurn      || realHandleTurn;
  const bridge          = deps.bridge          || realBridge;
  const notifyHighValue = deps.notifyHighValue || realNotifyHighValue;
  const sendWhatsAppText = deps.sendWhatsAppText || realSendWhatsAppText;
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
    const aiPaused =
      !!control &&
      (control.ai_paused === true ||
        (control.operator_status && control.operator_status !== 'ai'));
    if (aiPaused) {
      await safe('control.persistInbound', () =>
        bridge.pushConversationEvent({
          channel,
          external_id: senderId,
          direction: 'inbound',
          actor_type: 'customer',
          actor_name: senderName || 'Cliente',
          message_type: 'text',
          body: text,
          metadata: { source: 'oliver_gpt_channel', msg_id: msgId, ai_paused: true },
        })
      );
      log('info', 'control', `IA pausada (takeover) para ${convKey}; inbound persistido`);
      return { ok: false, reason: 'ai_paused' };
    }

    // ── Hidratar sesión (cache caliente in-memory) ──────────────────────
    const cached = conv.get(convKey) || { history: [], state: {} };
    const history = Array.isArray(cached.history) ? cached.history : [];
    const rawState = cached.state && typeof cached.state === 'object' ? cached.state : {};
    const baseState = resetIfInactive({ ...rawState, lastMessageAt: rawState.lastMessageAt || 0 });
    const state = {
      ...baseState,
      telefono: senderId,           // identificador en el cerebro (no es teléfono real)
      canal: channel,               // hint de canal para el cerebro
      name: baseState.name || senderName || '',
      fecha: new Date().toISOString(),
    };

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

      // generarPdf → en IG/FB NO se emite el PDF ISO (el cliente no está en
      // WhatsApp). Se ESCALA a Marcelo (lead caliente que pidió cotización formal)
      // y se le indica al cerebro que ofrezca enviar el PDF por WhatsApp.
      generarPdf: (input = {}) =>
        safe('generarPdf', async () => {
          await safe('generarPdf.notify', () =>
            notifyHighValue(
              sendWhatsAppText,
              senderId,
              { data: { ...state, ...input }, history },
              `[${channel}] cliente pidió cotización formal (PDF) — atender por WhatsApp`
            )
          );
          return {
            ok: false,
            reason: 'pdf_solo_whatsapp',
            message:
              'La cotización formal en PDF te la envío por WhatsApp. ' +
              '¿Me confirmas tu número de WhatsApp para mandártela? ' +
              'Mientras, ya te dejo el valor estimado por aquí.',
          };
        }),
    };

    // ── Llamada al cerebro probado ──────────────────────────────────────
    const turn = await handleTurn({ history, userText: text, state, toolCtx });
    const reply = turn?.reply || '';
    const newHistory = Array.isArray(turn?.history) ? turn.history : history;
    const newState = turn?.state && typeof turn.state === 'object' ? turn.state : state;
    const toolCalls = Array.isArray(turn?.toolCalls) ? turn.toolCalls : [];

    // ── Enviar respuesta por el canal ───────────────────────────────────
    // [2026-06-14] Capturamos el resultado: si el envío falla (ej: fuera de la ventana de
    // 24h de Meta), NO marcamos el outbound como entregado y escalamos a Marcelo para que
    // atienda al cliente desde el inbox (no se pierde en silencio).
    let sendResult = null;
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
    await safe('persist.inbound', () =>
      bridge.pushConversationEvent({
        channel,
        external_id: senderId,
        customer_name: newState.name || senderName || '',
        direction: 'inbound',
        actor_type: 'customer',
        actor_name: 'Cliente',
        message_type: 'text',
        body: text,
        metadata: { source: 'oliver_gpt_channel', msg_id: msgId },
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

    // ── Guardar cache actualizado ───────────────────────────────────────
    const trimmed = newHistory.length > MAX_HISTORY ? newHistory.slice(-MAX_HISTORY) : newHistory;
    conv.set(convKey, {
      history: trimmed,
      state: { ...newState, lastMessageAt: Date.now() },
    });

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
      conv.set(k, {
        history: hist.length > MAX_HISTORY ? hist.slice(-MAX_HISTORY) : hist,
        state: { ...(prev.state || {}), lastMessageAt: Date.now() },
      });
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
