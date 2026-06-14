// session-store.js — Persistencia remota de sesiones Oliver GPT en Sales-OS.
//
// Porteado de index.js: loadSessionFromStore (~L2397) y persistSessionToStore
// (~L2442). Adaptado al shape del módulo GPT: { history, state } en vez del
// objeto ses de V1. Fire-and-forget en el PUT; fail-safe en ambos.
//
// El módulo exporta funciones puras con deps inyectables → 100 % testeable sin red.

/* =========================================================================
 * CONFIG (env idéntica a index.js)
 * ========================================================================= */
const SALES_OS_URL       = process.env.SALES_OS_URL || '';
const SALES_OS_OPERATOR_TOKEN =
  process.env.SALES_OS_OPERATOR_TOKEN ||
  process.env.INTERNAL_OPERATOR_TOKEN ||
  '';
const WA_PERSIST_TIMEOUT_MS = parseInt(process.env.WA_PERSIST_TIMEOUT_MS || '3000', 10);

/** true solo cuando ambas variables de entorno están presentes. */
export const WA_PERSISTENCE_ENABLED = !!(SALES_OS_URL && SALES_OS_OPERATOR_TOKEN);

/* =========================================================================
 * loadSession — GET /internal/wa-sessions/{waId}
 *
 * Devuelve { history, state } hidratatados desde Postgres, o null si:
 *   · WA_PERSISTENCE_ENABLED=false
 *   · el endpoint responde 404 (sesión nueva)
 *   · cualquier error de red / timeout (fail-safe)
 *
 * @param {string} waId
 * @param {{ fetchFn?: Function }} [deps]
 * @returns {Promise<{ history: Array, state: object } | null>}
 * ========================================================================= */
export async function loadSession(waId, deps = {}) {
  if (!WA_PERSISTENCE_ENABLED) return null;
  const fetchFn = deps.fetchFn || fetch;
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), WA_PERSIST_TIMEOUT_MS);
    const r = await fetchFn(
      `${SALES_OS_URL}/internal/wa-sessions/${encodeURIComponent(waId)}`,
      { headers: { 'x-api-key': SALES_OS_OPERATOR_TOKEN }, signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (!r.ok) return null; // 404 = sesión nueva → estado vacío
    const json   = await r.json();
    const stored = json?.session;
    if (!stored) return null;
    return {
      history: Array.isArray(stored.history) ? stored.history : [],
      // [2026-06-14 FIX] El estado del cerebro se persiste en la columna `data`.
      // saveSession (sales-os) solo acepta data+history; NO existe columna `state`.
      // Antes leíamos stored.state (inexistente) → el state SIEMPRE volvía vacío
      // (comuna/items/stage se perdían entre turnos → re-saludo y cotización duplicada).
      state:   (stored.data && typeof stored.data === 'object') ? stored.data : {},
    };
  } catch {
    // Timeout, red caída, sales-os caído → fail-safe, estado vacío
    return null;
  }
}

/* =========================================================================
 * persistSession — PUT /internal/wa-sessions/{waId}  (fire-and-forget)
 *
 * Envía history + state a Postgres. No espera respuesta; cualquier error se
 * traga en silencio para no bloquear el turno del bot.
 *
 * @param {string} waId
 * @param {{ history: Array, state: object }} session
 * @param {{ fetchFn?: Function }} [deps]
 * ========================================================================= */
export function persistSession(waId, session, deps = {}) {
  if (!WA_PERSISTENCE_ENABLED) return;
  const fetchFn = deps.fetchFn || fetch;
  const payload = {
    history: session.history || [],
    // [2026-06-14 FIX] Mandar el state como `data` → saveSession lo guarda en la
    // columna `data`. Antes iba como `state`, que saveSession ignoraba (el estado
    // del cerebro nunca persistía). Espejado en loadSession (lee stored.data).
    data:    session.state   || {},
  };
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WA_PERSIST_TIMEOUT_MS);
  fetchFn(
    `${SALES_OS_URL}/internal/wa-sessions/${encodeURIComponent(waId)}`,
    {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', 'x-api-key': SALES_OS_OPERATOR_TOKEN },
      body:    JSON.stringify(payload),
      signal:  ctrl.signal,
    }
  )
    .then(() => clearTimeout(timer))
    .catch(() => clearTimeout(timer)); // fire-and-forget: traga errores
}

/* =========================================================================
 * RESET POR INACTIVIDAD
 *
 * Si el último mensaje registrado en state tiene > 7 días, limpia lockedData
 * (campos bloqueados de cotización) para evitar contaminación entre sesiones
 * distintas del mismo número. Historia se conserva (viene de Postgres).
 *
 * Porteado de la lógica TTL de index.js (~L2481-2491).
 *
 * @param {{ lastMessageAt?: number, [key: string]: any }} state
 * @returns {object} state (posiblemente con lockedData limpio)
 * ========================================================================= */
const INACTIVITY_RESET_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

export function resetIfInactive(state) {
  if (!state || typeof state !== 'object') return state || {};
  const last = state.lastMessageAt || 0;
  if (last > 0 && (Date.now() - last) > INACTIVITY_RESET_MS) {
    // Limpia lockedData pero preserva datos de identidad y el timestamp mismo
    const { lockedData: _dropped, ...rest } = state;
    return { ...rest, lockedData: {} };
  }
  return state;
}
