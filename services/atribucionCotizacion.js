// atribucionCotizacion.js — cotizar A NOMBRE DE OTRO. ESM, sin dependencias.
//
// [2026-08-08] Por qué existe:
// El dueño lo pidió textual: *"esas cotizaciones que hago son de personas que me hablan
// directo a mí y yo le cotizo a Oliver para enviar una cotización; ¿cómo debería
// cotizársela para que quede como lead y no sea yo a quien le carguen la cotización?"*
//
// Hasta hoy no había forma: `guardar_lead` toma el teléfono de quien conversa, así que un
// cliente que llegó por recomendación quedaba registrado con el teléfono del dueño. Eso
// rompía tres cosas, ninguna cosmética:
//   1) el seguimiento automático nunca le llegaba al cliente (apuntaba al dueño),
//   2) la atribución de ads se ensuciaba (canal = WhatsApp del dueño),
//   3) en /mi-agenda ese cliente no aparecía como cliente: aparecía el dueño.
//
// 🔒 SOLO EL DUEÑO. Quien llama a fijar() debe haber verificado que el remitente es
// ADMIN_PHONE. Si cualquiera pudiera atribuir cotizaciones a terceros, se abre a que
// alguien cargue una cotización a nombre de otra persona.
//
// Vive en memoria a propósito: es una intención de minutos ("ahora estoy cotizando para
// Juan"), no un dato de negocio. Si el proceso reinicia se pierde y el dueño vuelve a
// escribir el comando — preferible a inventar una tabla para algo que dura una charla.
// Mismo criterio que CONV/RATE_MAP en webhook.js.

const ATRIBUCIONES = new Map(); // telefonoDelDuenio -> { phone, name, ts }

// Se vence sola: si el dueño fijó un cliente hace 3 horas y se olvidó, lo que cotice
// después NO debe irse al cliente equivocado. Ese error es peor que pedirle que repita
// el comando.
export const VIGENCIA_MS = Number(process.env.ATRIBUCION_VIGENCIA_MS || 2 * 60 * 60 * 1000);

const soloDigitos = (s) => String(s || '').replace(/\D/g, '');

/**
 * Parsea "CLIENTE Juan Pérez +56 9 1234 5678" (o al revés).
 * @returns {{ok:true, phone:string, name:string}|{ok:false, error:string}}
 */
export function parseComandoCliente(texto) {
  const t = String(texto || '').trim();
  // \b y no \s+: "CLIENTE" a secas también entra, para responder la ayuda en vez de un
  // "no_es_comando" que el dueño vería en pantalla sin entender nada. index.js intercepta
  // con el mismo criterio (/^\s*cliente\b/i), así que ambos tienen que coincidir.
  const m = /^\s*cliente\b\s*(.*)$/i.exec(t);
  if (!m) return { ok: false, error: 'no_es_comando' };
  const resto = m[1].trim();
  if (!resto) return { ok: false, error: 'Falta el nombre y el teléfono. Ej: CLIENTE Juan Pérez +56912345678' };

  if (/^(off|no|ninguno|salir|listo|fin)$/i.test(resto)) return { ok: true, limpiar: true };

  // El teléfono es el bloque de dígitos más largo (tolera +, espacios y guiones).
  const candidatos = resto.match(/[+\d][\d\s.-]{7,}/g) || [];
  let crudo = '';
  for (const c of candidatos) if (soloDigitos(c).length > soloDigitos(crudo).length) crudo = c;
  const phone = soloDigitos(crudo);
  if (phone.length < 8) {
    return { ok: false, error: 'No encontré un teléfono válido. Ej: CLIENTE Juan Pérez +56912345678' };
  }
  const name = resto.replace(crudo, ' ').replace(/\s+/g, ' ').trim();
  return { ok: true, phone: normalizar(phone), name };
}

/**
 * Normaliza a formato chileno sin +: 912345678 → 56912345678.
 * No inventa países: si ya trae 56 o mide más de 9 dígitos, se respeta tal cual.
 */
export function normalizar(raw) {
  const d = soloDigitos(raw);
  if (!d) return '';
  if (d.length === 9 && d.startsWith('9')) return '56' + d;   // celular chileno sin código
  if (d.length === 8) return '569' + d;                        // sin el 9 inicial
  return d;
}

/** 🔒 El llamador DEBE haber verificado que es el dueño. */
export function fijar(telefonoDuenio, phone, name) {
  const key = soloDigitos(telefonoDuenio);
  if (!key || !phone) return null;
  const dato = { phone: normalizar(phone), name: String(name || '').trim(), ts: Date.now() };
  ATRIBUCIONES.set(key, dato);
  return dato;
}

/** @returns {{phone:string,name:string}|null} null si no hay o si ya venció. */
export function obtener(telefonoDuenio) {
  const key = soloDigitos(telefonoDuenio);
  const d = ATRIBUCIONES.get(key);
  if (!d) return null;
  if (Date.now() - d.ts > VIGENCIA_MS) { ATRIBUCIONES.delete(key); return null; }
  return { phone: d.phone, name: d.name };
}

export function limpiar(telefonoDuenio) {
  return ATRIBUCIONES.delete(soloDigitos(telefonoDuenio));
}

/** Para tests. */
export function _reset() { ATRIBUCIONES.clear(); }

export default { parseComandoCliente, fijar, obtener, limpiar, normalizar, VIGENCIA_MS };
