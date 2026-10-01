// services/atribucionStore.js — la ATRIBUCIÓN: "ahora estoy cotizando para Juan". En memoria a
// propósito: es una intención de minutos, no un dato de negocio. Si el proceso reinicia se pierde y
// se repite el comando; lo que NO se pierde (el trabajo y el folio de Juan) vive en su carpeta
// (sesionCarpetas.js).
//
// Cada fijación tiene versión (`gen`): quien la consume (al aceptarse el envío del PDF) solo la borra
// si sigue siendo la misma — un "CLIENTE Pedro" posterior no se toca (limpiarSiMisma).

import { digitos, normalizarChileno } from './telefono.js';

const ATRIBUCIONES = new Map(); // dígitos de quien escribe -> { phone, name, ts, gen }
let _GEN = 0;

/** Vence a las VIGENCIA_MS desde que se FIJÓ (usarla no la renueva). */
export const VIGENCIA_MS = Number(process.env.ATRIBUCION_VIGENCIA_MS || 2 * 60 * 60 * 1000);
// Se relee en cada consulta (no solo al importar): así un cambio de env en tests o en caliente aplica.
const vigencia = () => Number(process.env.ATRIBUCION_VIGENCIA_MS || 2 * 60 * 60 * 1000);

/** 🔒 El llamador DEBE haber verificado el permiso (perfilEquipo.puedeFijar). */
export function fijar(quienEscribe, phone, name) {
  const key = digitos(quienEscribe);
  if (!key || !phone) return null;
  const dato = { phone: normalizarChileno(phone), name: String(name || '').trim(), ts: Date.now(), gen: ++_GEN };
  ATRIBUCIONES.set(key, dato);
  return dato;
}

/** @returns {{phone:string,name:string,gen:number}|null} null si no hay o si ya venció. */
export function obtener(quienEscribe) {
  const key = digitos(quienEscribe);
  const d = ATRIBUCIONES.get(key);
  if (!d) return null;
  if (Date.now() - d.ts > vigencia()) { ATRIBUCIONES.delete(key); return null; }
  return { phone: d.phone, name: d.name, gen: d.gen };
}

export function limpiar(quienEscribe) {
  return ATRIBUCIONES.delete(digitos(quienEscribe));
}

/** Borra la atribución SOLO si sigue siendo la versión `gen` (compare-and-delete). */
export function limpiarSiMisma(quienEscribe, gen) {
  const key = digitos(quienEscribe);
  const d = ATRIBUCIONES.get(key);
  if (!d || d.gen !== gen) return false;
  return ATRIBUCIONES.delete(key);
}

/** Solo tests. */
export function _resetAtribuciones() { ATRIBUCIONES.clear(); }
