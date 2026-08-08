// services/reengagement.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// [2026-07-07 ZL-F2] ACTIVA / Oliver — Motor Zero-Leaks, Carril F2 (bot).
// Re-engagement determinista cuando sales-os (F1, el barredor de TTL) detecta
// que un lead quedó sin actividad y decide "hay que despertarlo".
//
// CONTRATO CON F1 (sales-os) — NO CAMBIAR sin avisar al otro carril:
//   POST /internal/reengage { phone, motivo, quote_number? }
//   auth: header x-api-key === process.env.SALES_OS_OPERATOR_TOKEN (mismo
//   secreto que YA comparten ambos servicios para el resto de /internal/*).
//
// DOBLE LLAVE DE SEGURIDAD (nadie le escribe a un cliente sin que el dueño
// lo autorice EXPLÍCITAMENTE):
//   1) process.env.ZERO_LEAKS_REENGAGE === 'true'  (default OFF) — si sales-os
//      llama pero el flag está apagado, NO se envía nada: {ok:false, reason:'flag_off'}.
//   2) Ventana de Meta: si la sesión tiene actividad <24h → mensaje DETERMINISTA
//      (plantilla de texto fija, SIN LLM: barato y predecible). Si >24h → la
//      ventana de WhatsApp está cerrada y Meta EXIGE una plantilla aprobada;
//      sin process.env.REENGAGE_TEMPLATE_NAME seteada (el dueño aún no la aprobó
//      en Meta) → {ok:false, reason:'sin_plantilla'}, CERO envío.
//   3) Candado de 1 re-engagement por cliente cada 24h (evita spam si F1 barre
//      varias veces o hay una carrera de eventos).
//
// Módulo PURO con deps inyectables (igual que oliverHandoff.js / stuckLeadMonitor.js):
// 100% testeable con mocks, sin red ni env vars reales en los tests.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

// Candado en memoria: phone -> timestamp del último re-engagement enviado.
// Piloto (un solo proceso, igual criterio que CONV/RATE_MAP de webhook.js).
// Si el proceso reinicia se pierde el candado — riesgo aceptado (mismo patrón
// que el resto del piloto in-memory); F1 igual no vuelve a barrer el mismo
// lead antes de que su propio TTL vuelva a vencer.
const LAST_REENGAGE = new Map();
const REENGAGE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * ¿La sesión tuvo actividad dentro de la ventana de 24h de Meta?
 * @param {object|null} session  { history, state } (shape de session-store.js) o null.
 * @param {number} [nowMs]  Inyectable para tests.
 * @returns {boolean}
 */
export function isWithinMetaWindow(session, nowMs = Date.now()) {
  const last = Number(session?.state?.lastMessageAt) || 0;
  if (!last) return false;
  return (nowMs - last) < 24 * 60 * 60 * 1000;
}

/**
 * ¿Ya se le mandó un re-engagement a este teléfono en las últimas 24h?
 * @param {string} phone
 * @param {Map} [store]  Inyectable para tests (default: Map módulo).
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function isLocked(phone, store = LAST_REENGAGE, nowMs = Date.now()) {
  const last = store.get(phone);
  if (!last) return false;
  return (nowMs - last) < REENGAGE_COOLDOWN_MS;
}

/** Marca el candado de 24h para phone. */
export function lock(phone, store = LAST_REENGAGE, nowMs = Date.now()) {
  store.set(phone, nowMs);
}

/**
 * Arma el mensaje DETERMINISTA de reactivación (dentro de ventana 24h, SIN LLM).
 * Inspirado en REGLA #15/#17 de system-prompt.js (re-engagement personalizado /
 * re-anclaje tras ghosting) pero fijo — no depende del LLM: predecible y sin costo.
 *
 * @param {object} params
 * @param {string} [params.name]  Nombre del cliente si se conoce.
 * @param {string} [params.quote_number]  Nº de cotización/propuesta si aplica.
 * @param {string} [params.motivo]  Motivo del barredor (informativo, no se muestra crudo al cliente).
 * @returns {string}
 */
export function buildDeterministicMessage({ name, quote_number } = {}) {
  const nombre = String(name || '').trim();
  const saludo = nombre ? `Hola ${nombre}` : 'Hola';
  if (quote_number) {
    return `${saludo} 👋 Le quedé debiendo el seguimiento de su propuesta N° ${quote_number}. ` +
      '¿Seguimos? Si me confirma el color o algún dato pendiente, avanzamos al tiro.';
  }
  return `${saludo} 👋 Quedamos en avanzar con su propuesta de ventanas y no quise dejarlo esperando. ` +
    '¿Seguimos? Cuénteme si le quedó alguna duda y se la resuelvo ahora.';
}

/**
 * Ejecuta el re-engagement para un cliente. Módulo PURO: todas las llamadas a
 * red/estado vienen inyectadas en `deps` → 100% testeable sin red ni env vars.
 *
 * @param {object} params
 * @param {string} params.phone  Teléfono del cliente (formato canónico).
 * @param {string} params.motivo  Motivo que dio sales-os (F1) al disparar el barrido.
 * @param {string} [params.quote_number]  Nº de cotización si aplica.
 * @param {object} [deps]
 * @param {Function} deps.loadSessionFn  async(phone) → {history, state}|null (session-store.loadSession).
 * @param {Function} deps.sendTextFn  async(phone, body) → {ok,...} (sendWhatsAppText).
 * @param {Function} [deps.sendTemplateFn]  async({phone, templateName, motivo, quote_number}) → {ok,...}
 *                                            Self-call a /admin/send-template (patrón sendEscalationTemplate).
 * @param {Function} [deps.pushConversationEventFn]  async(payload) → {ok,...} (bridge.pushConversationEvent).
 * @param {Map} [deps.lockStore]  Inyectable para tests (default Map módulo).
 * @param {boolean} [deps.flagOn]  Override de process.env.ZERO_LEAKS_REENGAGE==='true' (para tests).
 * @param {string} [deps.templateName]  Override de process.env.REENGAGE_TEMPLATE_NAME (para tests).
 * @param {number} [deps.nowMs]  Override de Date.now() (para tests).
 * @returns {Promise<{ok: boolean, reason?: string, canal?: string, mensaje?: string}>}
 */
export async function reengage({ phone, motivo, quote_number } = {}, deps = {}) {
  const {
    loadSessionFn,
    sendTextFn,
    sendTemplateFn,
    pushConversationEventFn,
    lockStore = LAST_REENGAGE,
    flagOn = process.env.ZERO_LEAKS_REENGAGE === 'true',
    templateName = process.env.REENGAGE_TEMPLATE_NAME || '',
    nowMs = Date.now(),
  } = deps;

  if (!phone) return { ok: false, reason: 'phone_requerido' };

  // ── LLAVE 1: flag apagado (default) — el dueño aún no dio el OK ──
  if (!flagOn) return { ok: false, reason: 'flag_off' };

  // ── CANDADO: máximo 1 re-engagement por cliente cada 24h ──
  if (isLocked(phone, lockStore, nowMs)) {
    return { ok: false, reason: 'candado_24h' };
  }

  // ── ¿Sesión activa dentro de la ventana de Meta (<24h)? ──
  let session = null;
  if (typeof loadSessionFn === 'function') {
    try { session = await loadSessionFn(phone); } catch { session = null; }
  }
  const dentroVentana = isWithinMetaWindow(session, nowMs);

  // ── LLAVE 4 [2026-08-08]: no escribirle a quien NUNCA nos escribió ──
  // Con el comando CLIENTE el dueño carga leads de gente que le habló a ÉL directo y que
  // jamás escribió al bot. Mandarle una plantilla a ese número es dos problemas a la vez:
  //   · legal (Ley 21.719, vigente 2026-12-01): no consintió que le ESCRIBAMOS. Que exista
  //     su ficha porque pidió una cotización es otra cosa y sí es legítimo.
  //   · Meta: plantillas a números sin opt-in bajan la calificación, y un número mal
  //     calificado deja de poder escribir.
  // (Lo levantó Gemini en la compuerta del 08-ago.)
  //
  // ⚠️ NO se usa "no tiene sesión" como señal: el primer intento hizo eso y rompió 7 tests
  // que documentan lo contrario a propósito — un cliente REAL de hace un mes tampoco tiene
  // sesión (se pierde en cada redeploy) y bloquearlo mataría el re-enganche legítimo.
  // La señal correcta es la marca explícita que deja el comando CLIENTE, y se borra sola en
  // cuanto esa persona escribe al bot por primera vez.
  if (typeof deps.sinConsentimientoFn === 'function' && deps.sinConsentimientoFn(phone)) {
    return { ok: false, reason: 'sin_consentimiento_nunca_escribio' };
  }

  let result;
  if (dentroVentana) {
    // ── LLAVE 2a: dentro de 24h → mensaje determinista, SIN LLM ──
    const mensaje = buildDeterministicMessage({ name: session?.state?.name, quote_number });
    if (typeof sendTextFn !== 'function') {
      return { ok: false, reason: 'sendTextFn_no_cableado' };
    }
    let sendRes;
    try { sendRes = await sendTextFn(phone, mensaje); }
    catch (e) { return { ok: false, reason: 'error_envio', error: e?.message || String(e) }; }
    if (!sendRes || sendRes.ok === false) {
      return { ok: false, reason: 'envio_fallo', error: sendRes?.error || 'desconocido' };
    }
    result = { ok: true, canal: 'mensaje_directo', mensaje };
  } else {
    // ── LLAVE 2b: ventana cerrada → requiere plantilla Meta aprobada por el dueño ──
    if (!templateName) {
      return { ok: false, reason: 'sin_plantilla' };
    }
    if (typeof sendTemplateFn !== 'function') {
      return { ok: false, reason: 'sendTemplateFn_no_cableado' };
    }
    let tplRes;
    // [fix escéptico ZL] pasar también el NOMBRE: las plantillas aprobadas (seguimiento_cotizacion/
    // recontacto_lead) esperan customer_name/quote_num en /admin/send-template.
    try { tplRes = await sendTemplateFn({ phone, templateName, motivo, quote_number, name: session?.state?.name || '' }); }
    catch (e) { return { ok: false, reason: 'error_envio_plantilla', error: e?.message || String(e) }; }
    if (!tplRes || tplRes.ok === false) {
      return { ok: false, reason: 'envio_plantilla_fallo', error: tplRes?.error || 'desconocido' };
    }
    result = { ok: true, canal: 'plantilla', template: templateName };
  }

  // Éxito → marca el candado y registra en la conversación (bitácora auditable ISO).
  lock(phone, lockStore, nowMs);
  if (typeof pushConversationEventFn === 'function') {
    try {
      await pushConversationEventFn({
        channel: 'whatsapp',
        external_id: phone,
        direction: 'outbound',
        actor_type: 'ai',
        actor_name: 'Oliver',
        message_type: 'text',
        body: result.mensaje || `[re-engagement por plantilla: ${result.template}]`,
        metadata: { source: 'zero_leaks_reengage', motivo: motivo || '', canal: result.canal, quote_number: quote_number || null },
      });
    } catch { /* no bloquea el resultado: el envío ya se hizo */ }
  }

  return result;
}
