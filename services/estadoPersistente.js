// estadoPersistente.js — estado del bot que SOBREVIVE a un redeploy. ESM, sin deps.
//
// [2026-08-08] Por qué existe:
// Pregunta del dueño: *"¿solucionaste el tema de cuando deployamos algo se pierde
// información?"*. Las conversaciones ya sobrevivían (session-store.js → Postgres), pero
// había tres cosas en memoria del proceso que Railway borra en cada deploy, y cada una
// tiene consecuencia sobre un cliente de verdad:
//
//   1. La marca "cargado a mano y nunca nos escribió" (comando CLIENTE). Al perderse, el
//      re-enganche podía mandarle una plantilla a alguien que NO consintió que le
//      escribiéramos — problema legal (Ley 21.719) y de calificación con Meta.
//   2. El candado de 24 h del re-enganche. Al perderse, el mismo cliente podía recibir dos
//      mensajes seguidos.
//   3. El dedupe de mensajes. Al perderse, un reintento de Meta generaba respuesta duplicada.
//
// DISEÑO: memoria primero, Postgres detrás.
//   · Leer y escribir van a un Map local: el turno NUNCA espera a la red.
//   · La escritura a Postgres es fire-and-forget.
//   · La lectura solo va a Postgres si el dato NO está en memoria — o sea, básicamente
//     después de un reinicio, que es justo el caso que esto viene a cubrir.
//   · Si sales-os no responde, se degrada al comportamiento anterior (memoria sola). Nunca
//     rompe un turno: perder una marca es malo, pero dejar a un cliente sin respuesta es peor.
//
// No crea tabla nueva: usa `simple_cache` de la plataforma vía /internal/kv (§14b·bis).

const SALES_OS_URL = process.env.SALES_OS_URL || '';
const TOKEN =
  process.env.SALES_OS_OPERATOR_TOKEN ||
  process.env.INTERNAL_OPERATOR_TOKEN ||
  '';
const TIMEOUT_MS = Number(process.env.ESTADO_PERSISTENTE_TIMEOUT_MS || 2500);

export const PERSISTENCIA_ACTIVA = !!(SALES_OS_URL && TOKEN);

const MEMORIA = new Map(); // clave -> { valor, expira }

const vigente = (e) => e && (!e.expira || e.expira > Date.now());

async function pedir(metodo, clave, cuerpo) {
  if (!PERSISTENCIA_ACTIVA) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    const r = await fetch(`${SALES_OS_URL}/internal/kv/${encodeURIComponent(clave)}`, {
      method: metodo,
      headers: { 'x-api-key': TOKEN, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch {
    return null; // sales-os caído / timeout → se sigue con la memoria local
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lee. Primero memoria; si no está, va a Postgres y cachea lo que encuentre.
 * @returns {Promise<any|null>}
 */
export async function leer(clave) {
  const e = MEMORIA.get(clave);
  if (vigente(e)) return e.valor;
  if (e) MEMORIA.delete(clave);
  const j = await pedir('GET', clave);
  const valor = j && Object.prototype.hasOwnProperty.call(j, 'valor') ? j.valor : null;
  if (valor !== null && valor !== undefined) MEMORIA.set(clave, { valor, expira: null });
  return valor ?? null;
}

/** Lee SOLO memoria — para caminos calientes donde no se puede pagar una ida a la red. */
export function leerLocal(clave) {
  const e = MEMORIA.get(clave);
  if (!vigente(e)) { if (e) MEMORIA.delete(clave); return null; }
  return e.valor;
}

/**
 * Escribe: memoria al instante, Postgres en segundo plano.
 * @param {number} ttlSegundos  vida del dato. Tope de 30 días del lado del servidor.
 */
export function escribir(clave, valor, ttlSegundos = 3600) {
  MEMORIA.set(clave, { valor, expira: Date.now() + ttlSegundos * 1000 });
  // Fire-and-forget a propósito: el turno del cliente no espera a la base.
  pedir('PUT', clave, { valor, ttl_segundos: ttlSegundos }).catch(() => {});
  return valor;
}

export function borrar(clave) {
  MEMORIA.delete(clave);
  pedir('DELETE', clave).catch(() => {});
}

/** Para tests. */
export function _reset() { MEMORIA.clear(); }

export default { leer, leerLocal, escribir, borrar, PERSISTENCIA_ACTIVA };
