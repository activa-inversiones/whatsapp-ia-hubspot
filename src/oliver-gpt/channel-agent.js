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
import { notifyHighValue as realNotifyHighValue } from '../../services/highValueNotifier.js';
import * as realBridge from '../../services/salesOsBridge.js';
import { sendWhatsAppText as realSendWhatsAppText } from '../sales-agent/whatsapp-adapter.js';
import { loadSession as realLoadSession, persistSession as realPersistSession, resetIfInactive } from './session-store.js';
import { generatePremiumQuotePdf as realGeneratePdf } from '../../services/quotePdf.js';
import { upsertZohoDeal as realUpsertZohoDeal, addZohoNote as realAddZohoNote } from '../../services/zohoCommercial.js';
import { sendChannelDocument as realSendChannelDocument } from '../../services/multiChannelHandler.js';

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

// [2026-06-15] ESCALACIÓN DETERMINISTA — no depende del LLM (que en prod a veces respondía el
// nombre de la tool 'notificar_marcelo' como texto, o no avisaba). La escalación es plata/reputación:
// se detecta el pedido de humano/molestia en CÓDIGO y se maneja siempre igual (aviso + mensaje fijo).
const BOOKINGS_URL = () => process.env.MARCELO_BOOKINGS_URL ||
  'https://outlook.office.com/bookwithme/user/35f7b8685a9041ae951cdb858eea458b@activaspa.cl/meetingtype/oi8VUtFlrEOffOOfJQCRiw2?anonymous&ismsaljsauthenabled&ep=mlink';
function escalationMessage() {
  return 'Te entiendo 🙌 Prefiero que te atienda directamente un experto.\n' +
    'Le avisé al Ing. Marcelo Cifuentes Méndez — Gerente de Ingeniería de Activa, Consultor Externo del ' +
    'Ministerio de Vivienda y Urbanismo y Evaluador Energético acreditado MINVU (Res. 266/2025). Te contacta personalmente.\n' +
    '📲 WhatsApp directo: +56 9 5729 6035\n' +
    '📅 O agenda tú mismo una hora: ' + BOOKINGS_URL();
}
function isEscalationRequest(text) {
  const t = String(text || '').toLowerCase();
  if (/hablar con (marcelo|un? (humano|persona|asesor|vendedor|ejecutivo)|el? (due[ñn]o|jefe|gerente))/.test(t)) return true;
  if (/(p[aá]same|comun[ií]came|conect[aá]me) .{0,15}(marcelo|humano|persona|asesor|vendedor|due[ñn]o)/.test(t)) return true;
  if (/\bescal(a|ar|en|o|ame)\b/.test(t) && /(marcelo|humano|persona|alguien)/.test(t)) return true;
  if (/(estoy|muy|tan|s[uú]per) (enojad|molest|furios|indignad|frustrad)/.test(t)) return true;
  if (/\b(reclamo|p[eé]simo servicio|p[eé]sima atenci|estafa)\b/.test(t)) return true;
  return false;
}

// [2026-06-15] Aviso GARANTIZADO al dueño por PLANTILLA de WhatsApp — bypasa la ventana 24h
// (el mensaje libre solo llega si Marcelo escribió al bot en 24h; la plantilla llega SIEMPRE → 100% auto).
// Usa 'informe_diario' (plantilla YA APROBADA por Meta, la misma que el windowOpener dispara a diario con
// éxito) por self-call a /admin/send-template (ADMIN_PIN seteado). El detalle completo del lead queda en el
// cockpit; la plantilla solo dispara la alerta para que Marcelo entre. 4 params: fecha, resumen, linea3, linea4.
async function sendEscalationTemplate(name, motivo, deps = {}) {
  const fetchFn = deps.fetchFn || fetch;
  const PIN = process.env.ADMIN_PIN || process.env.OLIVER_ADMIN_PIN || '';
  const owner = process.env.OWNER_NOTIFICATION_PHONE || process.env.ESCALATION_PHONE || process.env.MARCELO_PHONE || '56957296035';
  if (!PIN) return { ok: false, error: 'ADMIN_PIN_missing' };
  const base = (process.env.SELF_URL || `http://127.0.0.1:${process.env.PORT || 8080}`).replace(/\/$/, '');
  let fecha = '';
  try { fecha = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago' }); } catch { fecha = new Date().toISOString().slice(0, 10); }
  const body = {
    template: 'informe_diario',
    phone: owner,
    fecha,
    resumen: `ESCALACION: ${String(name || 'un cliente').slice(0, 40)} pide hablar contigo AHORA`,
    linea3: String(motivo || 'pide hablar con humano').replace(/[\[\]]/g, '').slice(0, 90),
    linea4: 'Revisa/toma el chat en ops.activalabs.ai (Oliver CRM)',
  };
  try {
    const r = await fetchFn(`${base}/admin/send-template?pin=${encodeURIComponent(PIN)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return await r.json().catch(() => ({ ok: r.ok }));
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

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
  const generatePdf           = deps.generatePdf           || realGeneratePdf;
  const upsertZohoDeal        = deps.upsertZohoDeal         || realUpsertZohoDeal;
  const addZohoNote           = deps.addZohoNote            || realAddZohoNote;
  const sendChannelDocument   = deps.sendChannelDocument   || realSendChannelDocument;
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
    if (!cached) {
      const fromStore = await safe('loadSession', () => loadSession(convKey));
      cached = fromStore || { history: [], state: {} };
    }
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
      await safe('escalate.persistIn', () => bridge.pushConversationEvent({
        channel, external_id: senderId, direction: 'inbound', actor_type: 'customer',
        actor_name: senderName || 'Cliente', message_type: 'text', body: text,
        metadata: { source: 'oliver_gpt_channel', msg_id: msgId, escalation: true },
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

          // Dedup por TELÉFONO real si lo hay (un lead = un folio aunque pase de IG a WhatsApp);
          // si no hay teléfono (IG/FB sin número), por canal:sender. [2026-06-14 review]
          const dedupKey = (input.phone && String(input.phone).replace(/\D/g, '').length >= 8)
            ? `tel:${String(input.phone).replace(/\D/g, '')}` : convKey;
          // GUARD anti-doble-folio: un lead = un folio en la ventana de 2 min.
          const prevQ = RECENT_QUOTES.get(dedupKey);
          if (prevQ && (Date.now() - prevQ.at) < QUOTE_DEDUP_MS) {
            log('info', 'generarPdf.dedup', `Cotización duplicada evitada para ${dedupKey}; reusando ${prevQ.quote_number}`);
            return { ok: true, quote_number: prevQ.quote_number, pdf_sent: false, deduped: true,
              message: `Ya te emití tu cotización N° ${prevQ.quote_number}.` };
          }

          const SALES_OS_URL = (process.env.SALES_OS_URL || '').replace(/\/$/, '');
          const OPERATOR_TOKEN = process.env.SALES_OS_OPERATOR_TOKEN || '';

          // Paso 1: correlativo ISO — MISMA fuente única que WhatsApp (un solo folio).
          let quoteNumber = null;
          try {
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
                `[${channel}] cliente pidió cotización formal pero el correlativo ISO no respondió — atender desde el inbox`));
            return { ok: false, reason: 'correlativo_no_disponible',
              message: 'Dame un momentito para emitir tu cotización formal con su folio; si se demora, Marcelo te la hace llegar enseguida.' };
          }
          RECENT_QUOTES.set(dedupKey, { quote_number: quoteNumber, at: Date.now() });
          // Evicción por antigüedad (no clear() ciego, que abría ventana de doble-folio en carga).
          if (RECENT_QUOTES.size > 500) {
            const cutoff = Date.now() - QUOTE_DEDUP_MS;
            for (const [k, v] of RECENT_QUOTES) if (!v || v.at < cutoff) RECENT_QUOTES.delete(k);
          }

          // Paso 2: PDF premium (mismo generador → folio ISO impreso en el documento).
          const clientName = input.name || state.name || senderName || 'Cliente';
          const clientPhone = input.phone || '';
          const clientComuna = input.comuna || state.comuna || '';
          const pdfData = {
            name: clientName, phone: clientPhone, comuna: clientComuna,
            address: state.address || '',
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
            sendChannelDocument(channel, senderId, pdfBuffer, filename, `Cotización ISO N° ${quoteNumber} · Activa Inversiones`));
          const pdfSent = !!(sr && sr.ok !== false);
          const outsideWindow = !!(sr && sr.outsideWindow);

          // Paso 4: Zoho CRM (fire-and-forget, channel-agnostic).
          const grandTotal = Number(input.grand_total) ||
            (input.items || []).reduce((s, it) => s + (Number(it.unit_price) || 0) * (Number(it.qty) || 1), 0);
          safe('generarPdf.zoho', async () => {
            const dealId = await upsertZohoDeal({
              phone: clientPhone || senderId, name: clientName, comuna: clientComuna,
              items: input.items || [], grand_total: grandTotal, stageKey: 'propuesta', quote_number: quoteNumber,
            });
            if (dealId) await addZohoNote(dealId, `Cotización enviada: ${quoteNumber}`,
              `PDF enviado al cliente por ${channel}.\nTotal: $${grandTotal.toLocaleString('es-CL')} CLP (IVA incl.)`);
          });

          // Paso 5: conversión multicanal (anti-cross-inject: canal del lead = el real IG/FB).
          safe('generarPdf.conversion', () =>
            bridge.pushQuoteEvent({
              phone: clientPhone || senderId, channel, customer_name: clientName,
              amount_total: grandTotal, currency: 'CLP', status: 'sent', quote_number: quoteNumber,
              fbclid: state.fbclid || null, gclid: state.gclid || null,
              ttclid: state.ttclid || null, ctwa_clid: state.ctwa_clid || null,
              payload: { comuna: clientComuna, ctwa_clid: state.ctwa_clid || null,
                fbclid: state.fbclid || null, gclid: state.gclid || null, ttclid: state.ttclid || null },
            })
          );

          // Si NO se entregó el PDF por el canal → escalar a Marcelo (no se pierde en silencio).
          if (!pdfSent) {
            await safe('generarPdf.escalate', () =>
              notifyHighValue(sendWhatsAppText, senderId,
                { data: { ...state, name: clientName, comuna: clientComuna, quote_number: quoteNumber }, history },
                `[${channel}] PDF ${quoteNumber} no se pudo entregar${outsideWindow ? ' (fuera de ventana 24h)' : ''} — enviarlo desde el inbox (ops.activalabs.ai)`));
            return { ok: true, quote_number: quoteNumber, pdf_sent: false,
              message: `Te preparé tu cotización formal N° ${quoteNumber}. Si no la ves acá en un momento, Marcelo te la hace llegar enseguida.` };
          }

          return { ok: true, quote_number: quoteNumber, pdf_sent: true,
            message: `Listo ✅ Te envié tu cotización formal N° ${quoteNumber} acá mismo (PDF). Cualquier duda la vemos.` };
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
        `Listo ✅ Te envié tu cotización formal${pdfRes?.quote_number ? ` N° ${pdfRes.quote_number}` : ''} acá mismo (PDF).`;
      await safe('pdf.send', () => sendFn(senderId, replyMsg));
      await safe('pdf.persistIn', () => bridge.pushConversationEvent({
        channel, external_id: senderId, direction: 'inbound', actor_type: 'customer',
        actor_name: senderName || 'Cliente', message_type: 'text', body: text,
        metadata: { source: 'oliver_gpt_channel', msg_id: msgId, pdf_confirm: true },
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
    const turn = await Promise.race([
      handleTurn({ history, userText: text, state, toolCtx }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('turn_timeout')), TURN_TIMEOUT_MS)),
    ]);
    const reply = turn?.reply || '';
    const newHistory = Array.isArray(turn?.history) ? turn.history : history;
    const newState = turn?.state && typeof turn.state === 'object' ? turn.state : state;
    const toolCalls = Array.isArray(turn?.toolCalls) ? turn.toolCalls : [];

    // Capturar la cotización (ítems con precio REAL del motor) para la ENTREGA DETERMINISTA del PDF al
    // confirmar (ver arriba). Solo se actualiza si este turno cotizó; si no, se conserva la anterior.
    const _quoteItems = itemsFromQuoteCalls(toolCalls, newState.default_color || state.default_color);
    if (_quoteItems.length) {
      newState.pending_quote = {
        items: _quoteItems,
        grand_total: _quoteItems.reduce((s, it) => s + it.unit_price * (Number(it.qty) || 1), 0),
        at: Date.now(),
      };
    }

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
