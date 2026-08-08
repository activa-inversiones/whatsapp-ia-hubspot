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

import {
  leer as leerEstado,
  leerLocal as leerEstadoLocal,
  escribir as escribirEstado,
  borrar as borrarEstado,
} from './estadoPersistente.js';

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
  // ⚠️ 9 dígitos mínimo, NO 8. La primera versión aceptaba 8 y les anteponía "569" sola:
  // un typo se convertía en el teléfono de OTRA persona, y la cotización le llegaba a un
  // desconocido. Es exactamente la regla anti-alucinación del proyecto: si falta un dato,
  // se pide — no se rellena en silencio. (Lo marcó Codex en la compuerta del 08-ago.)
  if (phone.length < 9) {
    return {
      ok: false,
      error: 'Ese teléfono no me cuadra. Escribilo completo, con los 9 dígitos: ' +
             'CLIENTE Juan Pérez +56912345678',
    };
  }
  const name = resto.replace(crudo, ' ').replace(/\s+/g, ' ').trim();
  // El nombre es obligatorio: sin él, el PDF formal salía con el nombre del DUEÑO tomado
  // de su propia sesión — una propuesta con identidad equivocada. (Codex, misma pasada.)
  if (!name || name.length < 2) {
    return {
      ok: false,
      error: 'Me falta el nombre del cliente. Va en la propuesta formal, así que no lo puedo inventar: ' +
             'CLIENTE Juan Pérez +56912345678',
    };
  }
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
  // ⚠️ El caso de 8 dígitos ("569" + d) se ELIMINÓ: adivinaba el número de otra persona a
  // partir de un typo. Ahora parseComandoCliente rechaza menos de 9 y pide que lo escriba
  // completo. Ver el comentario de allá.
  return d;
}

/**
 * ¿Este texto es de verdad el comando, o el dueño solo está escribiendo la palabra
 * "cliente" en una frase normal?
 *
 * [2026-08-08] Codex encontró que interceptar todo lo que empieza con "cliente" se comía
 * mensajes reales: "Cliente me pidió otra medida" nunca llegaba a Oliver, y el dueño no
 * tenía forma de saber por qué. Se intercepta SOLO si trae un teléfono largo o si es la
 * forma corta exacta (CLIENTE / CLIENTE OFF). Cualquier otra cosa sigue de largo al bot.
 */
export function pareceComando(texto) {
  const t = String(texto || '').trim();
  if (!/^\/?\s*cliente\b/i.test(t)) return false;
  const resto = t.replace(/^\/?\s*cliente\b/i, '').trim();
  if (!resto) return true;                                  // "CLIENTE" a secas → ayuda
  if (/^(off|no|ninguno|salir|listo|fin)$/i.test(resto)) return true;
  return soloDigitos(resto).length >= 8;                    // trae algo que parece teléfono
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

// ── Consentimiento de contacto ───────────────────────────────────────────────
// [2026-08-08] Teléfonos cargados con el comando CLIENTE que NUNCA le escribieron al bot.
// A esa gente no se le puede mandar una plantilla de re-enganche: no consintió que le
// escribiéramos (Ley 21.719, vigente 2026-12-01) y Meta baja la calificación del número
// por mandar plantillas sin opt-in.
// Que su ficha exista es otra cosa y sí es legítimo: pidió una cotización.
// La marca se borra SOLA en cuanto esa persona escribe al bot por primera vez — ahí ya
// hay conversación iniciada por ella y el re-enganche pasa a ser normal.
// [2026-08-08] Se respalda en Postgres: es lo ÚNICO de este módulo que no puede perderse
// en un redeploy. Si se pierde, el re-enganche le manda una plantilla a alguien que nunca
// consintió — y eso no se arregla después. La atribución, en cambio, dura minutos: si se
// pierde, el dueño repite el comando y no pasa nada.
const SIN_CONSENTIMIENTO = new Set();
const CLAVE_CONSENT = (p) => `consent:${p}`;
const TTL_CONSENT_S = 180 * 24 * 3600; // 180 días: dura lo que dure el lead

export function marcarSinConsentimiento(phone) {
  const p = normalizar(phone);
  if (!p) return p;
  SIN_CONSENTIMIENTO.add(p);
  escribirEstado(CLAVE_CONSENT(p), true, TTL_CONSENT_S);
  return p;
}

/** Se llama cuando entra un mensaje: si esa persona nos habló, ya hay consentimiento. */
export function registrarQueNosEscribio(phone) {
  const p = normalizar(phone);
  const habia = SIN_CONSENTIMIENTO.delete(p);
  // Se borra siempre, no solo si estaba en memoria: tras un redeploy la marca vive en
  // Postgres y no en este Set, y esa es justamente la que hay que levantar.
  borrarEstado(CLAVE_CONSENT(p));
  return habia;
}

/** Síncrono, para el camino caliente del webhook. */
export function sinConsentimiento(phone) {
  const p = normalizar(phone);
  return SIN_CONSENTIMIENTO.has(p) || leerEstadoLocal(CLAVE_CONSENT(p)) === true;
}

/**
 * Versión que SÍ consulta Postgres. La usa el re-enganche, que corre por cron y puede
 * pagar la ida a la red — y es el único lugar donde equivocarse tiene costo real.
 * Tras un redeploy, la marca está en la base y no en memoria: sin esto, el guardarraíl
 * no serviría justo cuando más se necesita.
 */
export async function sinConsentimientoAsync(phone) {
  const p = normalizar(phone);
  if (SIN_CONSENTIMIENTO.has(p)) return true;
  return (await leerEstado(CLAVE_CONSENT(p))) === true;
}

/** Para tests. */
export function _reset() { ATRIBUCIONES.clear(); SIN_CONSENTIMIENTO.clear(); }

export default { parseComandoCliente, fijar, obtener, limpiar, normalizar, VIGENCIA_MS };
