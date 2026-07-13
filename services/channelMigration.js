// services/channelMigration.js — v1.1.0
// ═══════════════════════════════════════════════════════════════════════════
// "OFRECER WHATSAPP Y CAPTURAR TELÉFONO" — migración IG/FB → WhatsApp.
//
// Cuando un cliente de Instagram DM / Facebook Messenger comparte su número,
// esta función crea/actualiza el lead en sales-os (mismo bridge que ya usa el
// resto del bot) y dispara la apertura de una conversación de WhatsApp vía la
// plantilla ya aprobada en Meta — mismo patrón PROBADO que usa el flujo
// llamada→WhatsApp (POST /internal/inbound-call, index.js:4726-4830).
//
// 100% ADITIVO — ARCHIVO NUEVO, no modifica ningún archivo existente:
//   · NO toca channel-agent.js, multiChannelHandler.js ni index.js.
//   · NO se importa desde ningún archivo de producción todavía — queda listo
//     para que la integración (llamar a esta función desde el turno de
//     channel-agent.js) se haga en un paso posterior, explícitamente.
//   · Gateado por el flag maestro IG_FB_MEDIA_PARITY_ENABLED (default OFF):
//     con el flag apagado, maybeOfferWhatsAppMigration() es un no-op inmediato
//     (retorna {telefonoCapturado:false, mensajeExtra:null} sin ningún I/O).
//   · BEST-EFFORT: toda la función está envuelta en try/catch — un fallo acá
//     (sales-os caído, Meta caído, ADMIN_PIN faltante) JAMÁS debe tirar abajo
//     la respuesta normal del bot al cliente.
//
// DI para tests (5º parámetro opcional `deps`): pushLeadEvent / fetch /
// customerName / awaitingPhoneNumber — mismo patrón que handleChannelTurn(args, deps)
// en channel-agent.js. Sin deps, usa las implementaciones reales.
//
// CHANGELOG v1.1.0 — fixes de auditoría (2026-07-13), ver detalle en cada punto:
//   [FIX crítico] Candado anti-abuso re-indexado por CONVERSACIÓN (channel+senderId)
//     en vez de por teléfono (texto libre sin verificar) — cierra el vector de
//     "cicla N teléfonos distintos, dispara N plantillas reales de WhatsApp".
//   [FIX medio] pushLeadEvent ahora respeta el mismo candado de 6h (antes no
//     tenía ningún gate propio y se repetía en cada turno con el mismo teléfono).
//   [FIX medio] pushLeadEvent + triggerWhatsAppOpening corren EN PARALELO
//     (antes en secuencia: hasta ~30s bloqueando la respuesta del bot al cliente
//     si sales-os estaba lento).
//   [FIX medio] extractChileanPhone(textoCliente) — el fallback que escanea
//     texto libre — ahora requiere que el caller declare explícitamente
//     deps.awaitingPhoneNumber = true (antes era solo una recomendación en
//     comentario, no un guard real).
//   [FIX medio] candado reservado de forma SÍNCRONA antes de cualquier `await`
//     (cierra la ventana de carrera check-then-act ante reentregas de webhook).
// ═══════════════════════════════════════════════════════════════════════════

import * as realBridge from './salesOsBridge.js';

export const VERSION = '1.1.0';

// ── Candado por CONVERSACIÓN (channel+senderId), 6h — no reabrir WhatsApp ni
// reenviar el lead si ya se procesó hace poco. [FIX crítico 2026-07-13] Antes
// indexado por teléfono (texto libre sin verificar): un mismo remitente podía
// citar N teléfonos distintos y burlar el candado N veces. Mismo valor de
// cooldown que LAST_CALL_WA (index.js:4724-4725, CALL_WA_COOLDOWN_MS) — el
// teléfono real (autenticado) sigue viajando en el payload, solo cambia la key.
const LAST_MIGRATION_WA = new Map();
const MIGRATION_WA_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h
const MIGRATION_WA_MAP_MAX = 2000;

function evictOldCooldowns() {
  if (LAST_MIGRATION_WA.size <= MIGRATION_WA_MAP_MAX) return;
  const cutoff = Date.now() - MIGRATION_WA_COOLDOWN_MS;
  for (const [k, at] of LAST_MIGRATION_WA) if (at < cutoff) LAST_MIGRATION_WA.delete(k);
}

function log(level, ctx, msg) {
  const fn = level === 'error' ? console.error : console.log;
  const detail = msg && msg.stack ? msg.stack : msg;
  fn(`[channelMigration] ${ctx}:`, detail);
}

function flagOn() {
  // [Nota] El brief de esta pieza pidió gatear TODO por IG_FB_MEDIA_PARITY_ENABLED
  // (el mismo flag maestro del pipeline de media entrante), en vez de un flag propio
  // de migración — se sigue literal esa instrucción. Default OFF → no-op total.
  return String(process.env.IG_FB_MEDIA_PARITY_ENABLED || '').toLowerCase() === 'true';
}

/* ─────────────────────────────────────────────────────────────────────────
 * DETECCIÓN — regex CONSERVADOR de teléfono móvil chileno.
 * Acepta: "957296035" | "56957296035" | "+56957296035" | "+56 9 5729 6035"
 *         (con espacios/puntos/guiones entre dígitos).
 * Exige SIEMPRE el prefijo móvil "9" + 8 dígitos más (9 dígitos en total),
 * con "56"/"+56" opcional antes. NUNCA escanea números de 7-8 dígitos sueltos
 * (evita confundir medidas de ventana tipo "900x1200" con un teléfono).
 *
 * [Riesgo conocido, documentado] un código/orden de 9+ dígitos que empiece con
 * "9" puede dar falso positivo (limitación inherente a detección por regex).
 * [FIX medio 2026-07-13] Esto YA NO es solo una recomendación de comentario:
 * maybeOfferWhatsAppMigration() exige deps.awaitingPhoneNumber === true para
 * correr este fallback sobre texto libre (ver esa función más abajo). Sin ese
 * flag, solo se confía en un teléfono ya vetado por el caller (telefonoDetectado).
 * ───────────────────────────────────────────────────────────────────────── */
const PHONE_CANDIDATE_RE = /(?:\+?56)?[\s.-]*9(?:[\s.-]?\d){8}/g;

/**
 * Busca un teléfono móvil chileno válido dentro de un texto libre.
 * @param {string} text
 * @returns {string|null} normalizado como "+569XXXXXXXX", o null si no hay match.
 */
export function extractChileanPhone(text) {
  const t = String(text || '');
  const matches = t.match(PHONE_CANDIDATE_RE) || [];
  for (const raw of matches) {
    const digits = raw.replace(/\D/g, '');
    let core = digits;
    if (core.length === 11 && core.startsWith('56')) core = core.slice(2);
    if (core.length === 9 && core.startsWith('9')) return `+56${core}`;
  }
  return null;
}

/**
 * Normaliza y valida un teléfono YA detectado por el caller (ej. si channel-agent.js
 * u otro módulo ya corrió su propia extracción y solo quiere que esta función lo use
 * tal cual). Acepta los mismos formatos que extractChileanPhone; si no es válido,
 * cae a null (el caller puede entonces reintentar con extractChileanPhone(texto)).
 */
function normalizeDetectedPhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  let core = digits;
  if (core.length === 11 && core.startsWith('56')) core = core.slice(2);
  if (core.length === 9 && core.startsWith('9')) return `+56${core}`;
  return null;
}

/**
 * Señal de que el cliente podría querer migrar a WhatsApp: mención explícita,
 * o un placeholder de medio no resuelto (adjunto sin procesar) que el propio
 * pipeline de paridad IG/FB ya escribe hoy en el texto. Pura, sin I/O — útil
 * para que quien integre esta pieza decida CUÁNDO invitar a dejar el número.
 */
export function detectMigrationSignal(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^\[(image|audio|video|sticker|file|attachment|media)\]$/i.test(t)) return true;
  if (/\[(audio no reconocido|imagen no legible)\]/i.test(t)) return true;
  return /\b(whatsapp|wsp|wasap|whats app)\b/i.test(t);
}

/**
 * Payload para bridge.pushLeadEvent (sales-os /api/ingest/lead) — mismo shape
 * que landingRefParser.js::buildLandingLeadPayload, atribuyendo el lead a su
 * canal de origen real (instagram_migrado / facebook_migrado).
 */
export function buildChannelMigrationLeadPayload(phone, channel, senderId, extra = {}) {
  const source = channel === 'instagram' ? 'instagram_migrado'
    : channel === 'facebook' ? 'facebook_migrado'
    : `${channel || 'canal'}_migrado`;
  const payload = {
    phone: String(phone || ''),
    source,
    channel: 'whatsapp',
    metadata: {
      origin_channel: channel || null,
      origin_external_id: senderId || null,
      message: extra.message ? String(extra.message).slice(0, 300) : null,
    },
  };
  if (extra.name) payload.name = String(extra.name);
  return payload;
}

/**
 * Dispara la apertura de WhatsApp vía self-fetch loopback a /admin/send-template
 * — MISMO contrato verificado que usa /internal/inbound-call (index.js:4796-4808,
 * body real aceptado en index.js:4879-4931): {template, phone, customer_name}.
 * Evita import circular (este módulo no puede importar sendTemplateAperturaPorLlamada
 * de index.js sin crear un ciclo, ya que index.js importaría este módulo para usarlo).
 * Best-effort: nunca lanza, retorna boolean de éxito.
 */
async function triggerWhatsAppOpening(phone, customerName, deps = {}) {
  try {
    const PIN = process.env.ADMIN_PIN || process.env.OLIVER_ADMIN_PIN || '';
    if (!PIN) {
      log('error', 'triggerWhatsAppOpening', 'ADMIN_PIN no configurado — no se puede abrir WhatsApp');
      return false;
    }
    const base = (process.env.SELF_URL || `http://127.0.0.1:${process.env.PORT || 8080}`).replace(/\/$/, '');
    const fetchFn = deps.fetch || fetch;
    const resp = await fetchFn(`${base}/admin/send-template?pin=${encodeURIComponent(PIN)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: 'apertura_por_llamada',
        phone,
        customer_name: customerName || 'Cliente',
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await resp.json().catch(() => ({ ok: resp.ok }));
    if (!data || data.ok === false) {
      log('error', 'triggerWhatsAppOpening', `send-template respondió ok:false para ${phone}`);
      return false;
    }
    return true;
  } catch (err) {
    log('error', 'triggerWhatsAppOpening', err);
    return false;
  }
}

/**
 * maybeOfferWhatsAppMigration — orquesta la migración IG/FB → WhatsApp cuando
 * el cliente comparte su número.
 *
 * @param {string} channel          - "instagram" | "facebook"
 * @param {string} senderId         - ID del cliente en el canal (IG/FB PSID)
 * @param {string} textoCliente     - texto del turno actual (solo se usa para
 *                                    detectar el teléfono si `telefonoDetectado`
 *                                    no viene Y `deps.awaitingPhoneNumber===true`)
 * @param {string|null} telefonoDetectado - teléfono ya extraído/vetado por el
 *                                    caller con contexto de conversación.
 * @param {object} [deps]           - inyectables para tests / integración:
 *   - pushLeadEvent {function}   - override de realBridge.pushLeadEvent.
 *   - fetch {function}           - override de fetch global.
 *   - customerName {string}      - nombre para la plantilla de WhatsApp.
 *   - awaitingPhoneNumber {boolean} - [FIX medio 2026-07-13] debe ser `true`
 *     para que esta función intente extraer un teléfono de `textoCliente`
 *     (fallback de texto libre). Sin este flag en `true`, SOLO se confía en
 *     `telefonoDetectado` ya vetado por el caller — evita que un código de
 *     pedido o una medida dictada que empiece con "9" dispare un lead + una
 *     plantilla real de WhatsApp a un número ajeno. El caller debe setearlo
 *     solo cuando el estado de la conversación efectivamente está esperando
 *     el número (ej. state.awaiting_whatsapp_number).
 * @returns {Promise<{telefonoCapturado:boolean, mensajeExtra:string|null}>}
 */
export async function maybeOfferWhatsAppMigration(channel, senderId, textoCliente, telefonoDetectado, deps = {}) {
  const NOOP = { telefonoCapturado: false, mensajeExtra: null };
  try {
    // LLAVE: flag maestro OFF por defecto → cero I/O, cero side-effects.
    if (!flagOn()) return NOOP;
    if (channel !== 'instagram' && channel !== 'facebook') return NOOP;
    if (!senderId) return NOOP;

    // 1) Resolver teléfono: preferir el ya detectado/vetado por el caller.
    //    [FIX medio] El fallback que escanea texto libre (extractChileanPhone)
    //    SOLO corre si el caller declaró explícitamente deps.awaitingPhoneNumber
    //    (antes corría siempre que no viniera `telefonoDetectado`, escaneando
    //    cualquier mensaje libre del cliente — ver riesgo documentado arriba
    //    de PHONE_CANDIDATE_RE).
    const phoneFromCaller = normalizeDetectedPhone(telefonoDetectado);
    const phoneFromFreeText = deps.awaitingPhoneNumber ? extractChileanPhone(textoCliente) : null;
    const phone = phoneFromCaller || phoneFromFreeText;
    if (!phone) return NOOP;

    // 2) Candado anti-abuso/anti-duplicado — [FIX crítico] indexado por
    //    CONVERSACIÓN (channel+senderId), NO por teléfono: el teléfono es
    //    texto sin verificar (a diferencia del precedente /internal/inbound-call,
    //    donde llega autenticado por un secret interno). Indexar por teléfono
    //    permitía que un mismo remitente citara N teléfonos distintos y
    //    disparara N plantillas reales de WhatsApp (facturadas por Meta) en
    //    minutos. Con la key por remitente, esta conversación dispara como
    //    máximo UNA vez cada 6h, sin importar cuántos números distintos
    //    aparezcan en su texto.
    const cooldownKey = `${channel}:${senderId}`;
    const now = Date.now();
    const prevAt = LAST_MIGRATION_WA.get(cooldownKey);
    const onCooldown = prevAt && (now - prevAt) < MIGRATION_WA_COOLDOWN_MS;

    if (onCooldown) {
      // [FIX medio] Antes SOLO el envío de WhatsApp quedaba bloqueado por este
      // candado — pushLeadEvent se repetía en cada turno igual. Ahora el gate
      // cubre ambos: ni se reenvía el lead ni se reabre WhatsApp mientras la
      // conversación esté en cooldown. Tampoco repetimos el aviso al cliente.
      log('info', 'cooldown', `candado 6h activo para ${cooldownKey}; no se reenvía lead ni apertura`);
      return { telefonoCapturado: true, mensajeExtra: null };
    }

    // [FIX medio — race check-then-act] Reservar el candado de forma SÍNCRONA,
    // sin ningún `await` entre la lectura de arriba y este set. Node es
    // single-thread: esta franja corre de un tirón, así que una segunda
    // invocación concurrente para el MISMO remitente (ej. reentrega de webhook
    // de Meta, ya observado en este sistema — ver multiChannelHandler.js)
    // siempre encuentra el candado ya puesto, cerrando la ventana de carrera.
    LAST_MIGRATION_WA.set(cooldownKey, now);
    evictOldCooldowns();

    const pushLeadEvent = deps.pushLeadEvent || realBridge.pushLeadEvent;
    const customerName = deps.customerName || '';

    // 3) Lead + 4) apertura de WhatsApp — [FIX medio — latencia de turno]
    //    EN PARALELO (antes en secuencia: pushLeadEvent podía tardar hasta
    //    ~21.5s con reintento y luego triggerWhatsAppOpening otros ~10s más,
    //    hasta ~30s bloqueando la respuesta del bot al cliente si sales-os
    //    estaba lento/cayéndose). Son side-effects independientes entre sí —
    //    no hay razón para esperar uno antes de iniciar el otro. Ambos siguen
    //    siendo best-effort: un fallo de cualquiera de los dos NUNCA tira
    //    abajo la respuesta normal del bot.
    const [, sent] = await Promise.all([
      (async () => {
        try {
          const payload = buildChannelMigrationLeadPayload(phone, channel, senderId, {
            message: textoCliente,
            name: customerName,
          });
          await pushLeadEvent(payload);
        } catch (err) {
          log('error', 'pushLeadEvent', err);
          // no-throw: el lead falló pero seguimos — el teléfono SÍ se capturó
          // del texto y queremos avisarle al cliente / intentar abrir WhatsApp igual.
        }
      })(),
      triggerWhatsAppOpening(phone, customerName, deps),
    ]);

    if (!sent) {
      // El envío de WhatsApp falló: liberamos el candado para permitir un
      // reintento real más adelante — pero solo si nadie más lo reclamó
      // mientras tanto (comparación por timestamp exacto, defensivo).
      if (LAST_MIGRATION_WA.get(cooldownKey) === now) {
        LAST_MIGRATION_WA.delete(cooldownKey);
      }
    }

    return {
      telefonoCapturado: true,
      mensajeExtra: 'Perfecto, te escribo por WhatsApp también 📲',
    };
  } catch (err) {
    // Red de seguridad final: bajo NINGUNA circunstancia esto tira abajo la
    // respuesta normal del bot al cliente.
    log('error', 'maybeOfferWhatsAppMigration', err);
    return NOOP;
  }
}

export default {
  VERSION,
  extractChileanPhone,
  detectMigrationSignal,
  buildChannelMigrationLeadPayload,
  maybeOfferWhatsAppMigration,
};
