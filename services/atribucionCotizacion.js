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
// 🔒 SOLO EL DUEÑO — y desde 2026-09-30 también los vendedores que el dueño autorizó en
// /equipo con modo interno (ver puedeUsarComandoCliente). Si cualquiera pudiera atribuir cotizaciones a terceros, se abre a que
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
  // [2026-09-30 · E] `gen` = versión de ESTA fijación. Quien la consume al emitir solo la borra
  // si sigue siendo la misma: si entre medio entró "CLIENTE Pedro", la de Pedro no se toca.
  const dato = { phone: normalizar(phone), name: String(name || '').trim(), ts: Date.now(), gen: ++_GEN };
  ATRIBUCIONES.set(key, dato);
  return dato;
}
let _GEN = 0;

/** @returns {{phone:string,name:string,gen:number}|null} null si no hay o si ya venció. */
export function obtener(telefonoDuenio) {
  const key = soloDigitos(telefonoDuenio);
  const d = ATRIBUCIONES.get(key);
  if (!d) return null;
  if (Date.now() - d.ts > VIGENCIA_MS) { ATRIBUCIONES.delete(key); return null; }
  return { phone: d.phone, name: d.name, gen: d.gen };
}

export function limpiar(telefonoDuenio) {
  return ATRIBUCIONES.delete(soloDigitos(telefonoDuenio));
}

/** [E] Borra la atribución SOLO si sigue siendo la versión `gen` (compare-and-delete). */
export function limpiarSiMisma(telefonoDuenio, gen) {
  const key = soloDigitos(telefonoDuenio);
  const d = ATRIBUCIONES.get(key);
  if (!d || d.gen !== gen) return false;
  return ATRIBUCIONES.delete(key);
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

const ESCRIBIERON = new Set();
const CLAVE_ESCRIBIO = (p) => `escribio:${p}`;

/**
 * [F1 · 30-sep] ¿Este número le escribió alguna vez al bot? Es la ÚNICA excepción para no
 * marcarlo "sin consentimiento" al fijar CLIENTE (que exista como lead NO es consentimiento).
 * Ante error de red, false ⇒ se marca (lado seguro de la Ley 21.719).
 */
export async function yaNosEscribio(phone, leer = leerEstado) {
  const p = normalizar(phone);
  if (!p) return false;
  if (ESCRIBIERON.has(p)) return true;
  try { return (await leer(CLAVE_ESCRIBIO(p))) === true; } catch { return false; }
}

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
  // [2026-09-30 · F1] Además queda registrado QUE ESCRIBIÓ (una vez por proceso, para no
  // escribir a Postgres en cada mensaje): el comando CLIENTE lo consulta para no marcar
  // "sin consentimiento" a quien sí inició una conversación.
  if (p && !ESCRIBIERON.has(p)) {
    ESCRIBIERON.add(p);
    escribirEstado(CLAVE_ESCRIBIO(p), true, TTL_CONSENT_S);
  }
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

// ── [2026-09-30] Vendedores del equipo (decisión del dueño, 30-sep) ─────────────────────
// Pedido del dueño: el teléfono del VENDEDOR lo carga solo el admin en /equipo (sales-os).
// Cuando un vendedor con «Cotizar con Oliver en modo interno» cotiza por WhatsApp, puede
// ratificar el teléfono del CLIENTE con el mismo comando CLIENTE; si el cliente no existe
// como lead se crea, y la cotización cuenta al CLIENTE (no al vendedor), con su folio ISO.
// Por eso el candado deja de ser "solo el dueño": pasa a ser "el dueño o un número que el
// dueño autorizó en /equipo con modo interno". Cualquier otro número sigue sin poder.

/**
 * ¿Este número puede usar el comando CLIENTE?
 * @param {string} waId
 * @param {{adminPhone:string, esInterno:(p:string)=>boolean}} o
 */
/**
 * @param {string} waId
 * @param {{adminPhone?:string, esInterno?:(p:string)=>boolean}} [opciones] esInterno DEBE comparar
 *   el número COMPLETO (internosEquipo.puedeComandoCliente), no los últimos 9.
 */
export function puedeUsarComandoCliente(waId, opciones = {}) {
  return rolCotizador(waId, opciones) !== null;
}

/**
 * Teléfono del dueño: UNA sola regla para index.js y webhook.js (antes cada uno tenía la suya).
 * ADMIN_PHONE primero (es la que usaba el comando CLIENTE en index.js), OWNER_PHONE de respaldo.
 */
export function telefonoDuenio() {
  return soloDigitos(process.env.ADMIN_PHONE || process.env.OWNER_PHONE || '56957296035');
}

/**
 * ¿Quién cotiza? 'duenio' · 'vendedor' (de /equipo con modo interno) · null (cualquier otro).
 * @param {string} waId
 * @param {{adminPhone?:string, esInterno?:(p:string)=>boolean}} [o]
 */
export function rolCotizador(waId, { adminPhone = telefonoDuenio(), esInterno = () => false } = {}) {
  const w = soloDigitos(waId);
  if (!w) return null;
  const a = soloDigitos(adminPhone);
  if (a && w === a) return 'duenio';
  try { return esInterno(w) === true ? 'vendedor' : null; } catch { return null; }
}

/** Últimos 9 dígitos: identifica a quien cotizó sin exponer el número completo. */
export const ultimos9 = (v) => { const d = soloDigitos(v); return d.length >= 8 ? d.slice(-9) : ''; };

const CLICK_IDS = ['fbclid', 'gclid', 'ttclid', 'ctwa_clid', 'ad_id'];

/**
 * Click-ids a mandar. Con atribución TODOS null: los de la sesión son de quien escribe
 * (vendedor/dueño), no del cliente — criterio de saveLead desde el 08-ago.
 * `landing_ref` sale de `landing_lead_id` de la sesión.
 */
export function clickIdsDe(src, atribucion) {
  const s = (!atribucion && src && typeof src === 'object') ? src : {};
  const out = {};
  for (const k of CLICK_IDS) out[k] = s[k] || null;
  out.landing_ref = s.landing_lead_id || null;
  return out;
}

/**
 * De quién es la cotización de este turno. FUENTE ÚNICA para todos los payloads.
 * Sin atribución: el cliente ES quien escribe (idéntico a antes: sin cotizado_por, sin extras).
 * `cotizado_por` va en la RAÍZ del objeto que se ingesta: sales-os guarda la raíz entera en
 * `quotes.payload` (quoteService.upsertQuote) y en `lead_events.payload` (leadService.upsertLead).
 */
export function identidadCotizacion(from, atribucion) {
  if (!atribucion || !atribucion.phone) {
    return { telefonoCliente: from, claveCot: from, cotizadoPor: null, atribuida: false, extraLead: {} };
  }
  const cotizadoPor = ultimos9(from) || null;
  return {
    telefonoCliente: atribucion.phone,
    claveCot: `${from}:${atribucion.phone}`,
    cotizadoPor,
    atribuida: true,
    // no_pisar: si el cliente ya es lead, sales-os solo completa lo vacío (no cambia su
    // origen, canal, nombre ni score). source marca que lo cargó alguien del equipo.
    extraLead: { external_id: atribucion.phone, cotizado_por: cotizadoPor, no_pisar: true, source: 'vendedor_equipo' },
  };
}

/** Lead mínimo del cliente al fijar la atribución (upsertLead de sales-os deduplica por teléfono). */
export function leadDeAtribucion(waIdVendedor, phone, name) {
  const p = normalizar(phone);
  const { extraLead } = identidadCotizacion(soloDigitos(waIdVendedor), { phone: p });
  return {
    phone: p,
    channel: 'whatsapp',
    name: String(name || '').trim(),
    ...extraLead,
    metadata: { via: 'comando_CLIENTE', cotizado_por: extraLead.cotizado_por },
  };
}

// ── CARPETA POR CLIENTE (rediseño 30-sep, tras el NO APTO del tridente) ─────────────────
// La sesión vive por el número de quien ESCRIBE. En vez de BORRAR estado al cambiar de
// cliente (dos rondas de parches mostraron que siempre quedaba algo acoplado), cada cliente
// tiene su CARPETA: al cambiar el cliente activo se GUARDA la sesión entera (estado + historial)
// en la carpeta del anterior y se RESTAURA la del nuevo (o vacía). Sin atribución = carpeta
// "propia" de quien escribe. Así nada se pierde (volver a Juan recupera su trabajo) y nada se
// filtra (Pedro nunca ve el folio, el nombre ni las medidas de Juan).
// Las carpetas viven en estadoPersistente (`sesion_cliente:<quien9>:<cliente9|propia>`), NO
// dentro del blob de sesión: no lo hinchan y sobreviven a un redeploy.

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

export function claveCarpeta(from, carpeta) {
  return `sesion_cliente:${ultimos9(from) || soloDigitos(from)}:${carpeta === CARPETA_PROPIA ? CARPETA_PROPIA : ultimos9(carpeta) || soloDigitos(carpeta)}`;
}

const tieneTrabajoPendiente = (s) => Array.isArray(s?.pending_quote?.items) && s.pending_quote.items.length > 0;

/**
 * Cambia de carpeta si el cliente activo cambió. Muta `state` y `history` en el lugar.
 * @param {{from:string, state:object, history:Array, atribucion:object|null,
 *          leer:(k)=>Promise<any>, escribir:(k,v,ttl)=>any}} o
 * @returns {Promise<'igual'|'cambio'|'adopcion'>}
 */
export async function cambiarCarpeta({ from, state, history, atribucion, leer, escribir }) {
  const nueva = atribucion?.phone ? normalizar(atribucion.phone) : CARPETA_PROPIA;
  const previa = state.carpeta_activa || CARPETA_PROPIA;
  if (nueva === previa) return 'igual';

  const infra = {};
  for (const k of CLAVES_INFRA_SESION) if (k in state) infra[k] = state[k];
  const soloCliente = () => {
    const out = {};
    for (const [k, v] of Object.entries(state)) if (!CLAVES_INFRA_SESION.includes(k)) out[k] = v;
    return out;
  };
  const reemplazar = (nuevoState, nuevoHistory) => {
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, nuevoState || {}, infra);
    history.splice(0, history.length, ...(Array.isArray(nuevoHistory) ? nuevoHistory : []));
    state.carpeta_activa = nueva;
  };

  // [B] ADOPCIÓN: quien escribe cotizó SIN cliente (carpeta propia con ventanas pendientes) y
  // recién ahora dice para quién es. Ese trabajo ES del cliente: se adopta, no se borra.
  // El folio propio (last_quote) NO viaja: queda en la carpeta propia.
  if (previa === CARPETA_PROPIA && nueva !== CARPETA_PROPIA && tieneTrabajoPendiente(state)) {
    const propio = { state: state.last_quote ? { last_quote: state.last_quote } : {}, history: [] };
    await escribir(claveCarpeta(from, CARPETA_PROPIA), propio, TTL_CARPETA_S);
    delete state.last_quote;
    state.carpeta_activa = nueva;
    return 'adopcion';
  }

  await escribir(claveCarpeta(from, previa), { state: soloCliente(), history: [...history] }, TTL_CARPETA_S);
  let guardada = null;
  try { guardada = await leer(claveCarpeta(from, nueva)); } catch { guardada = null; }
  reemplazar(guardada?.state, guardada?.history);
  return 'cambio';
}

/** Para tests. */
export function _reset() { ATRIBUCIONES.clear(); SIN_CONSENTIMIENTO.clear(); ESCRIBIERON.clear(); }

export default { parseComandoCliente, fijar, obtener, limpiar, normalizar, VIGENCIA_MS };
