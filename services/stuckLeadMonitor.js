// stuckLeadMonitor.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — Monitor de leads atascados ("stuck like Dalia").
//
// BUG QUE RESUELVE (caso Dalia): una clienta REAL (Dalia) entregó un pedido
// completo de 8 ventanas, pero el bot quedó en loop repitiendo 5 veces el
// mensaje de escalación SIN enviar nunca el PDF de cotización. Marcelo (dueño)
// NUNCA se enteró de que un lead caliente se estaba muriendo. Cero PDF, cero
// aviso, venta perdida en silencio.
//
// FIX: detectStuckLeads() recibe un snapshot de conversaciones (read-only, sin
// red ni BD dentro del módulo — el caller hace la query) y devuelve SOLO las que
// lucen "atascadas como Dalia": cliente insistió varias veces, sin PDF, sin
// humano a cargo, conversación AÚN viva (actividad reciente). El caller las pasa
// a stuckLeadAlertMessage() y avisa a Marcelo por WhatsApp.
//
// IMPORTANTE — qué NO se marca (para no falsear/spamear al dueño):
//   - Conversaciones con PDF ya enviado (has_pdf=true / quote_status='formal_sent').
//   - Conversaciones ya en manos de un humano (ai_paused=true u operator_status
//     ='human') → un humano YA es dueño del caso, está bien.
//   - Conversaciones con pocos intentos del cliente (inbound_count bajo) → aún no
//     hay señal de "lead caliente insistiendo".
//   - Conversaciones viejas/muertas (sin actividad reciente) → no despertar al
//     dueño por chats ya fríos.
//
// Módulo PURO: funciones deterministas sobre los datos de entrada. NO inventa
// precios ni datos de negocio. 100% testeable sin red, BD ni env vars.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

// Estados de cotización que cuentan como "todavía SIN PDF formal enviado".
// 'formal_sent' = PDF ya enviado → NO está atascado.
const STUCK_QUOTE_STATES = new Set(['diagnostico', 'validacion', 'propuesta']);

/**
 * Detecta las conversaciones atascadas dentro de un snapshot.
 *
 * Una conversación está ATASCADA cuando se cumplen TODAS:
 *   1. has_pdf === false                         → nunca recibió cotización.
 *   2. ai_paused === false && operator_status !== 'human'
 *                                                → no la tomó un humano (esas OK).
 *   3. inbound_count >= (opts.minInbound ?? 4)   → el cliente insistió varias veces.
 *   4. quote_status ∈ {diagnostico, validacion, propuesta}
 *                                                → NO es 'formal_sent' (PDF ya enviado).
 *   5. minutes_since_last <= (opts.maxIdleMin ?? 1440)
 *                                                → activa en las últimas 24h (viva).
 *
 * @param {Array<object>} conversations  Filas tipo:
 *   { id, customer_name, quote_status, ai_paused, operator_status,
 *     inbound_count, has_pdf, minutes_since_last }
 * @param {object} [opts]
 * @param {number} [opts.minInbound=4]  Mínimo de mensajes entrantes del cliente.
 * @param {number} [opts.maxIdleMin=1440]  Máximo de minutos de inactividad (24h).
 * @returns {Array<object>}  Subconjunto atascado, cada fila enriquecida con
 *                           `stuckReason` (string legible).
 */
export function detectStuckLeads(conversations, opts = {}) {
  if (!Array.isArray(conversations)) return [];

  const minInbound = opts.minInbound ?? 4;
  const maxIdleMin = opts.maxIdleMin ?? 1440;

  const stuck = [];

  for (const row of conversations) {
    if (!row || typeof row !== 'object') continue;

    // 1. nunca recibió PDF
    if (row.has_pdf !== false) continue;

    // 2. no está en manos de un humano
    if (row.ai_paused === true) continue;
    if (row.operator_status === 'human') continue;

    // 3. el cliente insistió varias veces
    if (!(Number(row.inbound_count) >= minInbound)) continue;

    // 4. todavía sin PDF formal enviado (estado de cotización elegible)
    if (!STUCK_QUOTE_STATES.has(row.quote_status)) continue;

    // 5. conversación aún viva (actividad reciente)
    if (!(Number(row.minutes_since_last) <= maxIdleMin)) continue;

    stuck.push({
      ...row,
      stuckReason: `${row.inbound_count} mensajes sin cotización (estado: ${row.quote_status})`,
    });
  }

  return stuck;
}

/**
 * Arma el mensaje de WhatsApp para el DUEÑO (Marcelo) listando los leads
 * atascados que necesitan su atención. NO inventa precios ni datos.
 *
 * @param {Array<object>} stuck  Resultado de detectStuckLeads().
 * @returns {string}  Mensaje listo para WhatsApp. '' si no hay nada que avisar.
 */
export function stuckLeadAlertMessage(stuck) {
  if (!Array.isArray(stuck) || stuck.length === 0) return '';

  const header = '⚠️ Leads sin cotizar que necesitan tu atención:';

  const lines = stuck.map((row) => {
    const name = row?.customer_name ? String(row.customer_name).trim() : '';
    const label = name || '(sin nombre)';
    const reason = row?.stuckReason || 'sin cotización';
    return `• ${label} — ${reason}`;
  });

  return `${header}\n${lines.join('\n')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODO TIEMPO-REAL (dentro del bot, por sesión viva)
// ═══════════════════════════════════════════════════════════════════════════
// El bot NO tiene acceso directo a Postgres, pero VE cada lead pegado en vivo al
// procesar cada mensaje. Estas funciones adaptan la sesión viva (`ses`) al mismo
// contrato de fila y REUSAN detectStuckLeads → una sola fuente de verdad. El
// caller (index.js) avisa a Marcelo con waSend (sin pausar el bot): solo-aviso,
// Marcelo decide saltar. Se dispara UNA vez por sesión (flag ses.stuckAlerted).

/**
 * Convierte una sesión viva del bot a una fila tipo conversación.
 * @param {object} session  ses del bot { history, pdfSent, data:{name,grand_total,handoffActive} }
 * @param {string} phone
 * @returns {object} fila para detectStuckLeads
 */
export function sessionToRow(session, phone) {
  const hist = Array.isArray(session?.history) ? session.history : [];
  const inbound_count = hist.filter((h) => h && h.role === 'user').length;
  const handoff = !!(session?.handoffActive || session?.data?.handoffActive);
  const hasQuote = !!session?.pdfSent || !!session?.data?.grand_total;
  return {
    id: phone || 'desconocido',
    customer_name: session?.data?.name || null,
    // Si ya hay total/PDF → 'formal_sent' (no pegado). Si no → 'diagnostico'.
    quote_status: hasQuote ? 'formal_sent' : 'diagnostico',
    ai_paused: handoff,
    operator_status: handoff ? 'human' : 'ai',
    inbound_count,
    has_pdf: hasQuote,
    minutes_since_last: 0, // tiempo real: acaba de llegar un mensaje
  };
}

/**
 * ¿La sesión viva luce pegada como Dalia? (real-time, por mensaje).
 * Umbral por defecto más alto (5) que el batch (4) para no falsear: un cliente
 * legítimo manda medidas en varios mensajes antes de cotizar.
 * @param {object} session
 * @param {string} phone
 * @param {object} [opts]  { minInbound=5 }
 * @returns {boolean}
 */
export function isSessionStuck(session, phone, opts = {}) {
  const minInbound = opts.minInbound ?? 5;
  return detectStuckLeads([sessionToRow(session, phone)], { minInbound, maxIdleMin: Infinity }).length > 0;
}

/**
 * Mensaje de aviso al dueño para un lead pegado en vivo (NO pausa el bot).
 * @param {object} session
 * @param {string} phone
 * @returns {string}
 */
export function sessionStuckAlertMessage(session, phone) {
  const row = sessionToRow(session, phone);
  const name = row.customer_name ? String(row.customer_name).trim() : '(sin nombre)';
  return `⚠️ Lead pegado — ${name} (${phone})\n${row.inbound_count} mensajes y aún SIN cotización. Oliver no logró cerrar la cotización solo. Quizá convenga que saltes tú.\n→ ops.activalabs.ai`;
}
