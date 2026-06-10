// oliverHandoff.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — Persistencia de handoff (#B / GT-07).
//
// BUG QUE RESUELVE: cuando Oliver escala ("te paso con Marcelo") NUNCA setea
// ai_paused / operator_status='human' en BD → el guard (index.js:5133) no
// dispara → el bot revive en el próximo mensaje del cliente y reinicia la
// conversación como si nada. 11 conversaciones atrapadas en este loop.
//
// FIX (dos capas, seguro por diseño):
//   CAPA 1 — LOCAL: setea ses.handoffActive = true en la sesión en memoria.
//             El guard extendido lo lee SIN round-trip a Sales OS.
//             Funciona aunque Sales OS esté caído.
//   CAPA 2 — REMOTA: llama POST /internal/conversation-handoff/:phone en
//             Sales OS (usa SALES_OS_OPERATOR_TOKEN) → persiste ai_paused=true +
//             operator_status='human' en BD. Si falla, la capa 1 sigue cubriendo
//             la sesión actual (en RAM). Al reiniciar el proceso, el bot lee
//             la BD vía getConversationControl() — que YA existía — y el guard
//             5133 funciona igual.
//
// RIESGO CRÍTICO GESTIONADO: si Sales OS NO responde (aviso a Marcelo no llega
// Y pausamos el bot), el cliente quedaría mudo. Por eso:
//   - persistHandoff() NUNCA lanza excepción: siempre devuelve { local, remote }.
//   - El caller (index.js) PRIMERO envía el aviso al operador → LUEGO llama
//     persistHandoff(). Si el aviso falló, persistHandoff() nunca se llama
//     (la lógica está en el caller, ver wiring).
//   - gate=requiere_verificacion: NO desplegar sin confirmar que sendEscalationAlert
//     (WhatsApp a Marcelo) llega antes de silenciar el bot.
//
// Módulo PURO: recibe la función de bridge como parámetro → 100% testeable
// con mocks sin tocar variables de entorno ni red.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

/**
 * Persiste el estado de handoff en dos capas (local + remota).
 *
 * @param {string}   phone          Teléfono del cliente (formato canónico, ej: "56912345678").
 * @param {object}   session        Objeto `ses` vivo de la sesión (se muta en capa 1).
 * @param {object}   [opts]
 * @param {Function} [opts.setHandoffFn]  Función async(phone) → {ok, skipped?, error?}.
 *                                         Por defecto: setConversationHandoff de salesOsBridge.
 *                                         Inyectable para tests.
 * @param {string}   [opts.reason]  Motivo legible (para logs).
 * @returns {Promise<{ local: boolean, remote: boolean, remoteError: string|null }>}
 */
export async function persistHandoff(phone, session, opts = {}) {
  const { setHandoffFn = null, reason = 'escalacion_humano' } = opts;

  const result = { local: false, remote: false, remoteError: null };

  // ── CAPA 1: local (inmediata, sin red) ──
  if (session && typeof session === 'object') {
    session.handoffActive = true;
    result.local = true;
  }

  // ── CAPA 2: remota (Sales OS) ──
  if (typeof setHandoffFn === 'function') {
    try {
      const r = await setHandoffFn(phone, reason);
      result.remote = !!(r?.ok);
      if (!r?.ok && !r?.skipped) {
        result.remoteError = r?.error || `status_${r?.status || 'unknown'}`;
      }
    } catch (err) {
      result.remoteError = err?.message || String(err);
    }
  }

  return result;
}

/**
 * Guard local para el mensaje entrante SIGUIENTE.
 * Retorna true si la sesión tiene handoff activo (capa 1).
 * El guard remoto (ai_paused / operator_status='human') ya existe en index.js:5133.
 *
 * @param {object} session  Objeto `ses` de la sesión.
 * @returns {boolean}
 */
export function isHandoffActive(session) {
  return !!(session?.handoffActive);
}
