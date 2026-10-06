// services/atribucionStore.js — la ATRIBUCIÓN: "ahora estoy cotizando para Juan". En memoria a
// propósito: es una intención de minutos, no un dato de negocio. Si el proceso reinicia se pierde y
// se repite el comando; lo que NO se pierde (el trabajo y el folio de Juan) vive en su carpeta
// (sesionCarpetas.js).
//
// [r11 01-oct · Codex] HISTORIAL DE EVENTOS, no "actual + previa". Cada quien-escribe tiene una
// secuencia acotada de eventos {tipo: fijar|off|consumo, ts, llegada, dato}. `ts` es la hora
// WhatsApp del comando (o la hora local si no la hay: el consumo, un comando sin timestamp), y el
// empate de `ts` se resuelve por ORDEN DE LLEGADA. La atribución que rige un mensaje es el último
// evento con ts ≤ la hora WhatsApp del mensaje.
//   · Por qué la hora WhatsApp: el turno de Oliver y el comando CLIENTE son requests HTTP distintos
//     y Meta no garantiza el orden de entrega; tomar el lock antes no lo arregla.
//   · Con "actual + previa", Juan → Pedro → María dejaba a Juan sin rastro: un mensaje tardío con
//     hora de Juan caía en Pedro. La secuencia lo resuelve.
//   · Consumir (tras aceptarse el envío del PDF) agrega un evento `consumo` con la hora local: los
//     mensajes mandados ANTES siguen siendo de ese cliente (estaban en cola detrás del turno del PDF).
//   · Resolución de Meta = 1 s: un mensaje del MISMO segundo que el comando cuenta como posterior.
// Cada `fijar` tiene versión (`gen`): consumir es compare-and-set sobre la vigente (limpiarSiMisma).

import { digitos, normalizarChileno } from './telefono.js';

const EVENTOS = new Map(); // dígitos de quien escribe -> [{ tipo, ts, llegada, dato }]
const MAX_EVENTOS = 20;
let _GEN = 0;
let _LLEGADA = 0;

/** ÚNICA fuente de la vigencia (vencimiento y texto del comando). Se relee del env en cada uso. */
export function vigenciaMs() {
  // [r16 #4] Un valor no numérico, 0, negativo o infinito NO es una vigencia: se usa la de 2 h.
  // (Con NaN, `Date.now() - fijadoAt > NaN` es siempre false ⇒ la atribución no vencía nunca.)
  const v = Number(process.env.ATRIBUCION_VIGENCIA_MS);
  // [2026-10-06] 24 h (antes 2 h): el cliente queda fijado hasta que se cambie; este es el tope de seguridad (dueño).
  return Number.isFinite(v) && v > 0 ? v : 24 * 60 * 60 * 1000;
}

/** Hora de un mensaje de WhatsApp en ms (acepta segundos de Meta, ms o ISO). null si no hay. */
export function msDeMensaje(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string' && !/^\d+$/.test(v)) { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

const orden = (a, b) => (a.ts - b.ts) || (a.llegada - b.llegada);
const copia = (d) => (d ? { phone: d.phone, name: d.name, gen: d.gen } : null);

function agregar(key, tipo, ts, dato = null, gen = null) {
  const lista = EVENTOS.get(key) || [];
  lista.push({ tipo, ts: msDeMensaje(ts) || Date.now(), llegada: ++_LLEGADA, dato, gen });
  lista.sort(orden);
  while (lista.length > MAX_EVENTOS) lista.shift();
  EVENTOS.set(key, lista);
}

/**
 * El `fijar` que rige a la hora `ts` (Infinity = ahora), o null. Se recorre la secuencia:
 *   fijar → rige ese; off → nadie; consumo(gen) → nadie SOLO si el que regía es ESE gen.
 * [r13 #1 · Thermos] Antes el consumo era un OFF global: un «CLIENTE Pedro» mandado durante el turno
 * del PDF de Juan (hora Meta anterior al consumo, que lleva hora local) quedaba ordenado antes del
 * consumo y lo anulaba. Con el gen, un consumo solo apaga a SU cliente.
 */
function vigenteA(key, ts = Infinity) {
  const lista = EVENTOS.get(key);
  if (!lista) return null;
  let rige = null;
  for (const e of lista) {
    if (e.ts > ts) break;
    if (e.tipo === 'fijar') rige = e;
    else if (e.tipo === 'off') rige = null;
    else if (e.tipo === 'consumo' && rige && rige.dato.gen === e.gen) rige = null;
  }
  return rige;
}

/**
 * 🔒 El llamador DEBE haber verificado el permiso (perfilEquipo.puedeFijar).
 * @param {{desde?:number|string}} [o] hora WhatsApp del comando
 */
export function fijar(quienEscribe, phone, name, { desde } = {}) {
  const key = digitos(quienEscribe);
  if (!key || !phone) return null;
  const dato = { phone: normalizarChileno(phone), name: String(name || '').trim(), fijadoAt: Date.now(), gen: ++_GEN };
  agregar(key, 'fijar', desde, dato);
  return copia(dato);
}

/**
 * @param {{tsMensaje?:number|string}} [o] hora WhatsApp del mensaje que se procesa (sin ella, la última).
 * @returns {{phone:string,name:string,gen:number}|null} null si no rige ninguna o ya venció.
 */
export function obtener(quienEscribe, { tsMensaje } = {}) {
  const key = digitos(quienEscribe);
  const e = vigenteA(key, msDeMensaje(tsMensaje) || Infinity);
  if (!e || e.tipo !== 'fijar') return null;
  if (Date.now() - e.dato.fijadoAt > vigenciaMs()) return null; // usarla NO la renueva
  return copia(e.dato);
}

/** CLIENTE OFF. */
export function limpiar(quienEscribe, { desde } = {}) {
  const key = digitos(quienEscribe);
  if (!key || !EVENTOS.has(key)) return false;
  agregar(key, 'off', desde);
  return true;
}

/**
 * Consume la atribución SOLO si la que rige AHORA es la versión `gen` (compare-and-set). Los mensajes
 * con hora anterior al consumo siguen siendo de ese cliente.
 */
export function limpiarSiMisma(quienEscribe, gen) {
  const key = digitos(quienEscribe);
  const e = vigenteA(key);
  if (!e || e.dato.gen !== gen) return false;
  // [r13 #1] Hora del consumo: la local (no hay hora de Meta para "Meta aceptó el envío"), pero nunca
  // anterior al fijar que consume. Las horas de Meta y la local son ambas reloj real; el gen hace que
  // un desfase entre ellas ya no pueda apagar a OTRO cliente.
  agregar(key, 'consumo', Math.max(Date.now(), e.ts), null, gen);
  return true;
}

/** Solo tests. */
export function _resetAtribuciones() { EVENTOS.clear(); }
