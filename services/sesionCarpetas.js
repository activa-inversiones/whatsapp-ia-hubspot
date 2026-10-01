// services/sesionCarpetas.js — CARPETA POR CLIENTE (decisión del dueño 30-sep, diseño «Cliente
// explícito»). ESM, sin dependencias de red propias: leer/escribir se inyectan.
//
// La sesión de Oliver vive por el número de quien ESCRIBE. Cuando un vendedor (o el dueño) cotiza
// para distintos clientes con el comando CLIENTE, cada cliente tiene su CARPETA: al cambiar el
// cliente activo se GUARDA la sesión entera (estado + historial) en la carpeta del anterior y se
// RESTAURA la del nuevo (o vacía). Sin atribución = carpeta "propia" de quien escribe.
// Nada se ADOPTA ni se fusiona: lo propio queda propio (Oliver no adivina de quién es un trabajo).
// Las carpetas viven en estadoPersistente (`sesion_cliente:<quien>:<cliente|propia>`, números
// COMPLETOS normalizados), NO dentro del blob de sesión.
//
// 🔒 Un solo canal de error: cambiarCarpeta NUNCA lanza; devuelve {mov:'error'} y no toca el estado
// activo si (a) la LECTURA de la carpeta nueva falló (no se sabe si existe: no se pisa nada) o
// (b) la ESCRITURA de la saliente lanzó. Una escritura que sales-os no confirmó (la memoria local
// ya la tiene) es advertencia y se sigue.

import { telefonoCompleto } from './internosEquipo.js';


/**
 * Claves de INFRAESTRUCTURA: son de quien escribe, no del cliente, y no se mudan de carpeta.
 * Exportada para que un test documente la lista: agregar algo acá es decidir que se comparte
 * entre clientes.
 */
export const CLAVES_INFRA_SESION = Object.freeze([
  'telefono', 'fecha', 'lastMessageAt', 'carpeta_activa',
  // atribución de anuncios de QUIEN ESCRIBE (con atribución a un cliente no viaja: clickIdsDe)
  'ctwa_clid', 'ad_id', 'gclid', 'fbclid', 'ttclid', 'ctwaCaptured',
  'landing_lead_id', 'landingRefCaptured', 'ref_status',
]);
export const CARPETA_PROPIA = 'propia';
export const TTL_CARPETA_S = 30 * 24 * 3600;

/**
 * Clave de la carpeta. Los números se normalizan con telefonoCompleto (celular chileno de 9 → 56…);
 * un número incompleto (menos de 9 dígitos útiles) se RECHAZA: una clave ambigua mezclaría clientes.
 */
export function claveCarpeta(from, carpeta) {
  const quien = telefonoCompleto(from);
  const de = carpeta === CARPETA_PROPIA ? CARPETA_PROPIA : telefonoCompleto(carpeta);
  if (!quien || !de) throw new Error('claveCarpeta: número incompleto');
  return `sesion_cliente:${quien}:${de}`;
}

/**
 * Cambia de carpeta si el cliente activo cambió. Muta `state` y `history` en el lugar.
 * @param {{from:string, state:object, history:Array, cliente:string|null,
 *          leer:(k)=>Promise<{ok:boolean, valor?:any}>, escribir:(k,v,ttl)=>Promise<{ok:boolean,motivo?:string}>,
 *          log?:(nivel:string, msg:string)=>void}} o   cliente = teléfono normalizado, o null (propia)
 * @returns {Promise<{mov:'igual'|'cambio'|'error', error?:string, aviso?:string}>}
 */
export async function cambiarCarpeta({ from, state, history, cliente, leer, escribir, log = () => {} }) {
  const nueva = cliente ? (telefonoCompleto(cliente) || String(cliente)) : CARPETA_PROPIA;
  const previa = state.carpeta_activa || CARPETA_PROPIA;
  if (nueva === previa) return { mov: 'igual' };

  const fallar = (error) => {
    log('error', `carpeta: cambio ${previa} → ${nueva} abortado (${error})`);
    return { mov: 'error', error };
  };

  // (a) Primero se LEE la nueva: si no se sabe si existe, no se cambia ni se guarda nada.
  let leida;
  try { leida = await leer(claveCarpeta(from, nueva)); } catch (e) { leida = { ok: false, error: e?.message }; }
  if (!leida || leida.ok !== true) return fallar(`lectura falló${leida?.error ? `: ${leida.error}` : ''}`);
  const guardada = leida.valor || null;

  // (b) Se guarda la saliente (copia profunda). Si lanza, el estado activo queda intacto.
  const soloCliente = {};
  for (const [k, v] of Object.entries(state)) if (!CLAVES_INFRA_SESION.includes(k)) soloCliente[k] = v;
  let aviso;
  try {
    const r = await escribir(claveCarpeta(from, previa), structuredClone({ state: soloCliente, history: [...history] }), TTL_CARPETA_S);
    if (r && r.ok === false && r.motivo !== 'persistencia_apagada') {
      aviso = `escritura sin confirmar (${r.motivo || 'sin_motivo'}); queda en memoria`;
      log('warn', `carpeta ${previa}: ${aviso}`);
    }
  } catch (e) {
    return fallar(`escritura lanzó: ${e?.message || e}`);
  }

  // (c) Se reemplaza el estado por la carpeta nueva (o vacía), conservando la infraestructura.
  const infra = {};
  for (const k of CLAVES_INFRA_SESION) if (k in state) infra[k] = state[k];
  const s = structuredClone(guardada?.state || {});
  const h = structuredClone(Array.isArray(guardada?.history) ? guardada.history : []);
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, s, infra);
  history.splice(0, history.length, ...h);
  state.carpeta_activa = nueva;
  return aviso ? { mov: 'cambio', aviso } : { mov: 'cambio' };
}
