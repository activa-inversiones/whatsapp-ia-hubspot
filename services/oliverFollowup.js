// oliverFollowup.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — guardia de follow-up automático 2h.
//
// BUG QUE RESUELVE (2026-06-10): el cron de setInterval (sección 20 de index.js,
// líneas ~5696-5723) itera TODAS las sesiones en memoria. Cuando Marcelo escribe
// al bot (para dar un STATS, probar flujos, etc.) se crea una sesión con su
// número. Esa sesión puede llegar a stageKey="propuesta" en modo test y luego el
// cron le manda el mensaje de follow-up de cliente REAL — incluyendo a veces de
// madrugada, hasta 11 mensajes en 7 días.
//
// FIX: shouldSkipFollowup(phone) normaliza el número y lo compara contra
// MARCELO_PHONE y ESCALATION_PHONE leídos desde process.env en tiempo de
// ejecución (no al importar, para que los tests puedan sobreescribir env).
// Se puede extender con INTERNAL_PHONES (lista separada por comas en env) para
// otros números internos sin tocar el módulo.
//
// IMPORTANTE: NO modifica el copy del mensaje (ya personalizado en index.js ~5706).
// Solo decide si el envío debe saltarse.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

/**
 * Normaliza un número de teléfono a solo dígitos.
 * Elimina +, espacios, guiones, paréntesis.
 * Devuelve string vacío si el input es falsy.
 */
export function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d]/g, '');
}

/**
 * Devuelve true si el follow-up automático debe SALTARSE para este número.
 *
 * Se salta cuando el número normalizado coincide con:
 *   1. MARCELO_PHONE   (env)
 *   2. ESCALATION_PHONE (env) — suele ser el mismo, pero puede diferir
 *   3. OWNER_NOTIFICATION_PHONE (env)
 *   4. Cualquier número en INTERNAL_PHONES (env, separados por coma)
 *
 * Todos los env se leen en tiempo de llamada (no al importar) para que los
 * tests puedan sobreescribir process.env sin necesidad de mocks de módulo.
 *
 * @param {string} phone  — waId / número del destinatario del follow-up
 * @returns {boolean}
 */
export function shouldSkipFollowup(phone) {
  const candidate = normalizePhone(phone);
  if (!candidate) return false; // número vacío/inválido → no hay nada que saltarse

  // Construir set de números internos desde env (lectura en tiempo de llamada)
  const internalSet = new Set();

  const addEnv = (key) => {
    const val = normalizePhone(process.env[key]);
    if (val) internalSet.add(val);
  };

  addEnv('MARCELO_PHONE');
  addEnv('ESCALATION_PHONE');
  addEnv('OWNER_NOTIFICATION_PHONE');

  // Lista adicional separada por comas: INTERNAL_PHONES=5611111,5622222
  const extra = String(process.env.INTERNAL_PHONES || '');
  if (extra) {
    extra.split(',').forEach(p => {
      const n = normalizePhone(p);
      if (n) internalSet.add(n);
    });
  }

  return internalSet.has(candidate);
}
