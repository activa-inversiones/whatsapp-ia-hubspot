// services/sesionCarpetas.js — CARPETA POR CLIENTE (decisión del dueño 30-sep, «Cliente explícito»).
// ESM, sin red propia: leer/escribir se inyectan (en prod, estadoPersistente durable).
//
// La sesión de Oliver vive por el número de quien ESCRIBE. Cada cliente para el que se cotiza con
// CLIENTE tiene su CARPETA: al cambiar el cliente activo se GUARDA la sesión entera (estado +
// historial) en la carpeta del anterior y se RESTAURA la del nuevo (o vacía). Sin atribución =
// carpeta "propia". Nada se adopta ni se fusiona. Clave: `sesion_cliente:<quien>:<cliente|propia>`
// con números COMPLETOS.
//
// UNA sola política de falla: si no se puede guardar, no se pierde nada —
//   · cambiarCarpeta: lectura fallida o escritura no confirmada ⇒ {mov:'error'} y el estado activo
//     queda intacto (quien llama corta el turno y avisa);
//   · escribirCarpeta: devuelve {ok:false}; quien llama decide no avanzar (atribucionTurno.trasEmitir
//     NO consume la atribución).
// 'persistencia_apagada' (sin sales-os: desarrollo/tests) no es falla: ahí no hay más que memoria.

import { completo } from './telefono.js';

/**
 * Claves de INFRAESTRUCTURA: de quien escribe, no del cliente; no se mudan de carpeta.
 * Agregar algo acá es decidir que se comparte entre clientes (lo documenta un test).
 * carpeta_*: la marca de qué carpeta está activa, con qué atribución (gen) y si ya se cerró.
 */
export const CLAVES_INFRA_SESION = Object.freeze([
  'telefono', 'fecha', 'lastMessageAt',
  'carpeta_activa', 'carpeta_gen', 'carpeta_nombre', 'carpeta_cerrada',
  // atribución de anuncios de QUIEN ESCRIBE (con atribución a un cliente no viaja: clickIdsDe)
  'ctwa_clid', 'ad_id', 'gclid', 'fbclid', 'ttclid', 'ctwaCaptured',
  'landing_lead_id', 'landingRefCaptured', 'ref_status',
  // [L6 r10] hermanas que faltaban (las copia el webhook con copyAttributionState o las fija al llegar).
  'ref_status_at', 'ref_solo_tag', 'landing_ref_otro_uuid', 'ctwa_angle',
]);
export const CARPETA_PROPIA = 'propia';
export const TTL_CARPETA_S = 30 * 24 * 3600;

/** Clave de la carpeta. Un número incompleto se RECHAZA: una clave ambigua mezclaría clientes. */
export function claveCarpeta(from, carpeta) {
  const quien = completo(from);
  const de = carpeta === CARPETA_PROPIA ? CARPETA_PROPIA : completo(carpeta);
  if (!quien || !de) throw new Error('claveCarpeta: número incompleto');
  return `sesion_cliente:${quien}:${de}`;
}

const parteCliente = (state) => {
  const out = {};
  for (const [k, v] of Object.entries(state || {})) if (!CLAVES_INFRA_SESION.includes(k)) out[k] = v;
  return out;
};
const vacia = (state, history) => Object.keys(parteCliente(state)).length === 0 && !(history || []).length;

/** LA escritura de carpetas (copia profunda). Nunca lanza. @returns {Promise<{ok:boolean, error?:string}>} */
export async function escribirCarpeta({ from, carpeta, state, history, escribir }) {
  try {
    const r = await escribir(claveCarpeta(from, carpeta), structuredClone({ state: parteCliente(state), history: [...(history || [])] }), TTL_CARPETA_S);
    if (r && r.ok === false && r.motivo !== 'persistencia_apagada') return { ok: false, error: `escritura sin confirmar: ${r.motivo || 'sin_motivo'}` };
    return { ok: true };
  } catch (e) { return { ok: false, error: `escritura lanzó: ${e?.message || e}` }; }
}

/** Lee una carpeta. @returns {Promise<{ok:boolean, valor?:{state,history}|null, error?:string}>} Nunca lanza. */
export async function leerCarpeta({ from, carpeta, leer }) {
  try {
    const r = await leer(claveCarpeta(from, carpeta));
    return r && r.ok === true ? { ok: true, valor: r.valor || null } : { ok: false, error: 'lectura falló' };
  } catch (e) { return { ok: false, error: `lectura falló: ${e?.message || e}` }; }
}

/**
 * Cambia de carpeta si el cliente activo cambió. Muta `state` y `history` en el lugar (el webhook
 * le pasa COPIAS de la sesión en caché). Nunca lanza.
 * @returns {Promise<{mov:'igual'|'cambio'|'error', error?:string}>}
 */
export async function cambiarCarpeta({ from, state, history, cliente, leer, escribir, log = () => {} }) {
  const nueva = cliente ? (completo(cliente) || String(cliente)) : CARPETA_PROPIA;
  const previa = state.carpeta_activa || CARPETA_PROPIA;
  if (nueva === previa) return { mov: 'igual' };
  const fallar = (error) => {
    log('error', `carpeta: cambio ${previa} → ${nueva} abortado (${error})`);
    return { mov: 'error', error };
  };

  // (a) Primero se LEE la nueva: si no se sabe si existe, no se cambia ni se guarda nada.
  const leida = await leerCarpeta({ from, carpeta: nueva, leer });
  if (!leida.ok) return fallar(leida.error);

  // (b) Se guarda la saliente. [Thermos conjunto #2] Si la saliente está VACÍA (p. ej. la sesión
  // llegó sin nada tras un redeploy) NO se escribe: un vacío no puede pisar una carpeta con trabajo.
  if (!vacia(state, history)) {
    const g = await escribirCarpeta({ from, carpeta: previa, state, history, escribir });
    if (!g.ok) return fallar(g.error);
  }

  // (c) Se reemplaza el estado por la carpeta nueva (o vacía), conservando la infraestructura.
  const infra = {};
  for (const k of CLAVES_INFRA_SESION) if (k in state) infra[k] = state[k];
  const s = structuredClone(leida.valor?.state || {});
  const h = structuredClone(Array.isArray(leida.valor?.history) ? leida.valor.history : []);
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, s, infra);
  history.splice(0, history.length, ...h);
  state.carpeta_activa = nueva;
  return { mov: 'cambio' };
}
