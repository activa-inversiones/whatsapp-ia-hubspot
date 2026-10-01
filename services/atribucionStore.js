// services/atribucionStore.js — la ATRIBUCIÓN: "ahora estoy cotizando para Juan". En memoria a
// propósito: es una intención de minutos, no un dato de negocio. Si el proceso reinicia se pierde y
// se repite el comando; lo que NO se pierde (el trabajo y el folio de Juan) vive en su carpeta
// (sesionCarpetas.js).
//
// Cada fijación tiene versión (`gen`): quien la consume (al aceptarse el envío del PDF) solo la borra
// si sigue siendo la misma — un "CLIENTE Pedro" posterior no se toca (limpiarSiMisma).
//
// [M2 · 01-oct] ORDEN POR LA HORA DE WHATSAPP, no por la de llegada. El turno de Oliver hace I/O de
// red ANTES de tomar el lock (dedupe `msg:`), y el comando CLIENTE entra por otro request: un mensaje
// mandado JUSTO ANTES de "CLIENTE Pedro" podía procesarse después y quedar a nombre de Pedro. Tomar
// el lock antes no lo arregla: son dos requests HTTP distintos y Meta no garantiza el orden de
// entrega. La única referencia confiable es el `timestamp` que Meta le pone a cada mensaje. Por eso
// cada cambio guarda `desde` (hora WhatsApp del comando) y la atribución ANTERIOR: un mensaje con
// hora anterior a `desde` se procesa con la anterior (o sin atribución si no había).
// Resolución de Meta = 1 s: un mensaje del MISMO segundo que el comando cuenta como posterior.

import { digitos, normalizarChileno } from './telefono.js';

const ATRIBUCIONES = new Map(); // dígitos de quien escribe -> { actual: dato|null, previa: dato|null, desde: ms }
let _GEN = 0;

/** ÚNICA fuente de la vigencia (vencimiento y texto del comando). Se relee del env en cada uso. */
export function vigenciaMs() {
  return Number(process.env.ATRIBUCION_VIGENCIA_MS || 2 * 60 * 60 * 1000);
}

const vigente = (d, ahora = Date.now()) => !!d && ahora - d.ts <= vigenciaMs();
const copia = (d) => (d ? { phone: d.phone, name: d.name, gen: d.gen } : null);

/** Hora de un mensaje de WhatsApp en ms (acepta segundos de Meta, ms o ISO). null si no hay. */
export function msDeMensaje(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string' && !/^\d+$/.test(v)) { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function cambiar(key, actual, desde) {
  const e = ATRIBUCIONES.get(key);
  const previa = e && vigente(e.actual) ? e.actual : null;
  ATRIBUCIONES.set(key, { actual, previa, desde: msDeMensaje(desde) || Date.now() });
}

/**
 * 🔒 El llamador DEBE haber verificado el permiso (perfilEquipo.puedeFijar).
 * @param {{desde?:number|string}} [o] hora WhatsApp del comando (ver M2 arriba)
 */
export function fijar(quienEscribe, phone, name, { desde } = {}) {
  const key = digitos(quienEscribe);
  if (!key || !phone) return null;
  const dato = { phone: normalizarChileno(phone), name: String(name || '').trim(), ts: Date.now(), gen: ++_GEN };
  cambiar(key, dato, desde);
  return copia(dato);
}

/**
 * @param {{tsMensaje?:number|string}} [o] hora WhatsApp del mensaje que se procesa. Si es ANTERIOR al
 *   último cambio, se responde con la atribución que regía antes de ese cambio.
 * @returns {{phone:string,name:string,gen:number}|null} null si no hay o si ya venció.
 */
export function obtener(quienEscribe, { tsMensaje } = {}) {
  const key = digitos(quienEscribe);
  const e = ATRIBUCIONES.get(key);
  if (!e) return null;
  const ts = msDeMensaje(tsMensaje);
  const d = ts && ts < e.desde ? e.previa : e.actual;
  if (!vigente(d)) {
    if (d === e.actual && !vigente(e.previa)) ATRIBUCIONES.delete(key);
    return null;
  }
  return copia(d);
}

/** CLIENTE OFF. */
export function limpiar(quienEscribe, { desde } = {}) {
  const key = digitos(quienEscribe);
  if (!ATRIBUCIONES.has(key)) return false;
  cambiar(key, null, desde);
  return true;
}

/** Borra la atribución SOLO si sigue siendo la versión `gen` (compare-and-delete). La consume. */
export function limpiarSiMisma(quienEscribe, gen) {
  const key = digitos(quienEscribe);
  const e = ATRIBUCIONES.get(key);
  if (!e || !e.actual || e.actual.gen !== gen) return false;
  // Consumida: los mensajes que esperaban detrás del turno del PDF ya no son de nadie.
  ATRIBUCIONES.set(key, { actual: null, previa: null, desde: Date.now() });
  return true;
}

/** Solo tests. */
export function _resetAtribuciones() { ATRIBUCIONES.clear(); }
