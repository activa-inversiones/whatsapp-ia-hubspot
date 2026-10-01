// services/consentimiento.js — ¿a quién se le puede escribir primero?
//
// [2026-08-08] Teléfonos cargados con el comando CLIENTE que NUNCA le escribieron al bot. A esa
// gente no se le puede mandar una plantilla de re-enganche: no consintió que le escribiéramos
// (Ley 21.719, vigente 2026-12-01) y Meta baja la calificación del número por mandar plantillas
// sin opt-in. Que su ficha exista es otra cosa y sí es legítimo: pidió una cotización.
// La marca se borra SOLA en cuanto esa persona escribe al bot — ahí ya hay conversación iniciada
// por ella y el re-enganche pasa a ser normal. Se respalda en el KV de sales-os (sobrevive a un
// redeploy).
//
// ⚠️ TTL: 30 días, el TOPE del KV de sales-os (/internal/kv). Antes se pedían 180 y el servidor los
// recortaba a 30 en silencio. Pasado el mes la marca desaparece de la base (en memoria dura lo que
// el proceso): si hace falta más, es una tabla propia — lo decide el dueño.

import {
  leer as leerEstado,
  leerLocal as leerEstadoLocal,
  escribir as escribirEstado,
  borrar as borrarEstado,
} from './estadoPersistente.js';
import { normalizarChileno } from './telefono.js';

const SIN_CONSENTIMIENTO = new Set();
const CLAVE_CONSENT = (p) => `consent:${p}`;
// 30 días = el tope real de /internal/kv (pedir 180 era decir algo que el servidor no cumple).
// Para `escribio:` el tope no hace daño: pasado el mes, yaNosEscribio le pregunta a sales-os.
const TTL_CONSENT_S = 30 * 24 * 3600;

const ESCRIBIERON = new Set();
const CLAVE_ESCRIBIO = (p) => `escribio:${p}`;

/**
 * ¿sales-os tiene mensajes ENTRANTES de este teléfono? Cubre a quien escribió ANTES de que el bot
 * empezara a registrar `escribio:` (Thermos conjunto #3). Ante cualquier falla: false (se marca).
 */
export async function consultarSiEscribioEnSalesOs(p, {
  url = process.env.SALES_OS_URL || '',
  token = process.env.SALES_OS_OPERATOR_TOKEN || process.env.INTERNAL_OPERATOR_TOKEN || '',
  fetchFn = globalThis.fetch,
} = {}) {
  if (!url || !token || typeof fetchFn !== 'function' || !p) return false;
  try {
    const r = await fetchFn(`${url.replace(/\/$/, '')}/internal/conversations/escribio/${encodeURIComponent(p)}`, {
      headers: { 'x-api-key': token }, signal: AbortSignal.timeout(5000),
    });
    if (!r || !r.ok) return false;
    const j = await r.json().catch(() => null);
    return !!(j && j.ok === true && j.escribio === true);
  } catch { return false; }
}

/**
 * ¿Este número le escribió alguna vez al bot? Es la ÚNICA excepción para no marcarlo "sin
 * consentimiento" al fijar CLIENTE (que exista como lead NO es consentimiento). Mira: memoria del
 * proceso → marca `escribio:` del KV → conversación con mensajes entrantes en sales-os.
 * Ante error de red, false ⇒ se marca (lado seguro de la Ley 21.719).
 */
export async function yaNosEscribio(phone, leer = leerEstado, consultar = consultarSiEscribioEnSalesOs) {
  const p = normalizarChileno(phone);
  if (!p) return false;
  if (ESCRIBIERON.has(p)) return true;
  try { if ((await leer(CLAVE_ESCRIBIO(p))) === true) return true; } catch { /* sigue */ }
  try { return (await consultar(p)) === true; } catch { return false; }
}

export function marcarSinConsentimiento(phone) {
  const p = normalizarChileno(phone);
  if (!p) return p;
  SIN_CONSENTIMIENTO.add(p);
  escribirEstado(CLAVE_CONSENT(p), true, TTL_CONSENT_S);
  return p;
}

/** Se llama cuando entra un mensaje: si esa persona nos habló, ya hay consentimiento. */
export function registrarQueNosEscribio(phone) {
  const p = normalizarChileno(phone);
  // Queda registrado QUE ESCRIBIÓ (una vez por proceso, para no escribir a Postgres en cada mensaje).
  if (p && !ESCRIBIERON.has(p)) {
    ESCRIBIERON.add(p);
    try { escribirEstado(CLAVE_ESCRIBIO(p), true, TTL_CONSENT_S); } catch { /* nunca tumba el turno */ }
  }
  const habia = SIN_CONSENTIMIENTO.delete(p);
  // Se borra siempre: tras un redeploy la marca vive en Postgres y no en este Set.
  borrarEstado(CLAVE_CONSENT(p));
  return habia;
}

/** Síncrono, para el camino caliente del webhook. */
export function sinConsentimiento(phone) {
  const p = normalizarChileno(phone);
  return SIN_CONSENTIMIENTO.has(p) || leerEstadoLocal(CLAVE_CONSENT(p)) === true;
}

/** Versión que SÍ consulta Postgres (la usa el re-enganche, que corre por cron). */
export async function sinConsentimientoAsync(phone) {
  const p = normalizarChileno(phone);
  if (SIN_CONSENTIMIENTO.has(p)) return true;
  return (await leerEstado(CLAVE_CONSENT(p))) === true;
}

/** Solo tests. */
export function _resetConsentimiento() { SIN_CONSENTIMIENTO.clear(); ESCRIBIERON.clear(); }
