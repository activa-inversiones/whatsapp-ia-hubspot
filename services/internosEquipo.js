// services/internosEquipo.js — [#1059 b, 2026-09-30] "Oliver interno": la lista del equipo.
//
// Pedido del dueño: las personas que cotizan como vendedores las carga ÉL en el cockpit
// (/equipo de sales-os, con su WhatsApp). Todo lo que llega de esos números es INTERNO:
//   · Oliver NO les manda seguimientos ni plantillas de seguimiento (el follow-up de 2 h,
//     el monitor de "lead pegado" y el re-enganche);
//   · si el dueño le prendió «Cotizar con Oliver en modo interno», Oliver les responde en
//     modo interno: cotización rápida, sin calificar ni ofrecer seguimiento.
//
// FUENTE ÚNICA: sales-os (GET /internal/equipo/internos, token operador). El bot NO tiene lista
// propia: la lee cada 5 min. Si sales-os no contesta, se queda con la ÚLTIMA lista buena (nunca la
// vacía por un error), y mientras no haya ninguna, nadie es interno por esta vía.
//
// [2026-09-30 · reordenamiento] Toda pregunta "¿quién es este número para el equipo?" se responde
// con UNA función: perfilEquipo(waId). Reemplaza a las 7 funciones sueltas de las rondas anteriores.
//
// NO decide qué se reporta a Meta/Google (eso vive en sales-os, numerosInternos.js).

import { digitos, completo, ult9 } from './telefono.js';

export const REFRESCO_MS = 5 * 60 * 1000;
/** Con la lista más vieja que esto, un vendedor puede TERMINAR (CLIENTE OFF) pero no FIJAR clientes. */
export const MAX_ANTIGUEDAD_LISTA_CLIENTE_MS = 30 * 60 * 1000;

/** El ÚNICO literal del número del dueño en el bot (index.js y webhook.js lo toman de acá). */
export const DUENIO_DEFAULT = '+56957296035';

/**
 * Teléfono del dueño (solo dígitos). Regla: ADMIN_PHONE y, si no está, el número por defecto.
 * ⚠️ OWNER_PHONE NO existe en el servicio del bot en Railway (verificado por el coordinador el
 * 30-sep): por eso no se consulta acá. index.js usaba ADMIN_PHONE para el comando CLIENTE.
 */
export function telefonoDuenio() {
  return digitos(process.env.ADMIN_PHONE || DUENIO_DEFAULT);
}

/** ¿Este número es el dueño? EL único lugar (index.js y perfilEquipo lo usan). */
export function esDuenio(waId) {
  const d = digitos(waId);
  return !!d && d === telefonoDuenio();
}

const VACIO = () => ({ at: 0, okAt: 0, internos: new Set(), modoInterno: new Set(), completosModoInterno: new Set(), completoPorUlt9: new Map() });
let _estado = VACIO();

/**
 * Aplica la respuesta de sales-os ({internos_ult9, vendedores:[{ult9, telefono, oliver_interno}],
 * lista_confiable, consultada_ok_at}).
 * [01-oct · Codex] `okAt` = hora de la última consulta BUENA de sales-os, y SOLO si la lista viene
 * marcada confiable. Con la BD de sales-os caída (lista_confiable:false) o un sales-os viejo que no
 * manda la marca, okAt = 0 ⇒ la lista no es vigente y CLIENTE se rechaza (fail-closed). `at` sigue
 * siendo la hora en que el bot la recibió: el ROL usa la última lista conocida.
 */
export function aplicarLista(data, ahora = Date.now()) {
  if (!data || !Array.isArray(data.internos_ult9)) return false;
  const vendedores = Array.isArray(data.vendedores) ? data.vendedores.filter(Boolean) : [];
  const okServidor = Number(data.consultada_ok_at);
  const okAt = data.lista_confiable === true ? (Number.isFinite(okServidor) && okServidor > 0 ? Math.min(okServidor, ahora) : ahora) : 0;
  _estado = {
    at: ahora,
    okAt,
    internos: new Set(data.internos_ult9.map(ult9).filter(Boolean)),
    modoInterno: new Set(vendedores.filter((v) => v.oliver_interno === true).map((v) => ult9(v.ult9)).filter(Boolean)),
    // Para el comando CLIENTE: solo vendedores con modo interno, por número COMPLETO. Si sales-os
    // no manda `telefono`, queda vacío y ningún vendedor puede fijar clientes (fail-closed).
    completosModoInterno: new Set(vendedores.filter((v) => v.oliver_interno === true).map((v) => completo(v.telefono)).filter(Boolean)),
    // cola de 9 → número completo, para distinguir un +34 912 345 678 de un +56 9 1234 5678.
    completoPorUlt9: new Map(vendedores.map((v) => [ult9(v.ult9 || v.telefono), completo(v.telefono)]).filter(([k, t]) => k && t)),
  };
  return true;
}

/** Solo tests. */
export function _reiniciarParaTests() { _estado = VACIO(); }

/**
 * ¿Quién es este número para el equipo? UNA sola respuesta para index.js y webhook.js.
 * @returns {{rol:'duenio'|'vendedor'|'vendedor_ambiguo'|null, puedeFijar:boolean, puedeTerminar:boolean,
 *            motivoBloqueo:null|'no_habilitado'|'lista_desactualizada', esEquipo:boolean}}
 *  · 'vendedor'          → número COMPLETO de un vendedor con modo interno (última lista conocida,
 *                          sin mirar antigüedad: una atribución ya fijada sigue valiendo).
 *                          puedeFijar exige además lista con ≤30 min; puedeTerminar no.
 *  · 'vendedor_ambiguo'  → en modo interno por la cola de 9, pero su vendedor NO tiene número
 *                          completo cargado: no se distingue de un cliente → no cotiza ni fija.
 *  · esEquipo            → para RECHAZAR este número como cliente del comando CLIENTE: el dueño, o
 *                          un integrante (por número completo si lo tiene; si no, por la cola).
 */
export function perfilEquipo(waId, ahora = Date.now()) {
  const nada = { rol: null, puedeFijar: false, puedeTerminar: false, motivoBloqueo: null, esEquipo: false };
  const d = digitos(waId);
  if (!d) return nada;
  if (esDuenio(d)) return { rol: 'duenio', puedeFijar: true, puedeTerminar: true, motivoBloqueo: null, esEquipo: true };
  const k = ult9(waId);
  const deLaLista = !!k && _estado.internos.has(k);
  const completoDeLaCola = k ? _estado.completoPorUlt9.get(k) : '';
  const esEquipo = deLaLista && (completoDeLaCola ? completoDeLaCola === completo(waId) : true);
  if (_estado.at && _estado.completosModoInterno.has(completo(waId))) {
    const fresca = listaEquipoVigente(ahora);   // confiable y con la última consulta buena ≤30 min
    return { rol: 'vendedor', puedeFijar: fresca, puedeTerminar: true, motivoBloqueo: fresca ? null : 'lista_desactualizada', esEquipo: true };
  }
  if (deLaLista && _estado.modoInterno.has(k) && !completoDeLaCola) {
    return { rol: 'vendedor_ambiguo', puedeFijar: false, puedeTerminar: false, motivoBloqueo: 'no_habilitado', esEquipo };
  }
  return { ...nada, esEquipo };
}

/**
 * Qué decirle a un vendedor que quiere cotizar SIN cliente fijado. Si su comando CLIENTE iba a ser
 * rechazado, pedírselo lo deja en bucle: se le dice la CAUSA real (perfil.motivoBloqueo).
 */
export function textoCorteVendedor(perfil) {
  if (perfil?.motivoBloqueo === 'no_habilitado') {
    return '⚠️ Tu número no está habilitado como vendedor en /equipo (falta tu WhatsApp completo o el permiso ' +
      'de cotizar con Oliver). Avísale al administrador para que lo revise.';
  }
  if (perfil?.motivoBloqueo === 'lista_desactualizada') {
    return '⚠️ La lista del equipo está desactualizada y por ahora no puedo fijar clientes. Intenta en unos minutos.';
  }
  return TEXTO_PEDIR_CLIENTE_INTERNO;
}

/** ¿El número es del equipo (dueño, bot o vendedor activo con WhatsApp cargado)? Para seguimientos. */
export function esNumeroDelEquipo(phone) {
  const k = ult9(phone);
  return !!k && _estado.internos.has(k);
}

/** ¿Oliver le responde en modo interno (texto del prompt)? Si es del equipo Y el dueño lo autorizó. */
export function modoInternoOliver(phone) {
  const k = ult9(phone);
  return !!k && _estado.internos.has(k) && _estado.modoInterno.has(k);
}

/** ¿Hay lista del equipo cargada y con ≤30 min? (sin ella no se puede validar a quién se fija con CLIENTE) */
export function listaEquipoVigente(ahora = Date.now()) {
  return _estado.okAt > 0 && ahora - _estado.okAt <= MAX_ANTIGUEDAD_LISTA_CLIENTE_MS;
}

export function estadoLista() {
  return { cargada: _estado.at > 0, at: _estado.at, internos: _estado.internos.size, modo_interno: _estado.modoInterno.size };
}

/**
 * Pide la lista a sales-os. Nunca lanza. Devuelve true si la aplicó.
 * @param {{url?:string, token?:string, fetchFn?:Function}} [o]
 */
export async function refrescarInternos({
  url = process.env.SALES_OS_URL || '',
  token = process.env.SALES_OS_OPERATOR_TOKEN || process.env.INTERNAL_OPERATOR_TOKEN || '',
  fetchFn = globalThis.fetch,
} = {}) {
  if (!url || !token || typeof fetchFn !== 'function') return false;
  try {
    const r = await fetchFn(`${url.replace(/\/$/, '')}/internal/equipo/internos`, {
      headers: { 'x-api-key': token },
      signal: AbortSignal.timeout(10000),
    });
    if (!r || !r.ok) return false;
    const j = await r.json().catch(() => null);
    if (!j || j.ok !== true) return false;
    return aplicarLista(j.data);
  } catch {
    return false; // se queda con la última lista buena
  }
}

let _timer = null;
/** Arranca el refresco periódico (idempotente; el timer no retiene el proceso). */
export function iniciarRefrescoInternos(opciones = {}) {
  if (_timer) return;
  refrescarInternos(opciones).catch(() => {});
  _timer = setInterval(() => { refrescarInternos(opciones).catch(() => {}); }, REFRESCO_MS);
  if (typeof _timer.unref === 'function') _timer.unref();
}

export const TEXTO_MODO_INTERNO = [
  '',
  '🟦 ═══ MODO INTERNO: TE ESCRIBE ALGUIEN DEL EQUIPO DE ACTIVA, NO UN CLIENTE. ═══',
  'Es un vendedor de la empresa cotizando para un cliente suyo. Reglas de este turno:',
  '• Cotización RÁPIDA: con medidas, producto y color, cotiza directo. No hagas preguntas de calificación comercial (presupuesto, plazos, "¿para cuándo lo necesita?").',
  '• NO ofrezcas seguimiento, visita, llamada ni "le escribo mañana": él maneja al cliente.',
  '• Trato directo y breve, de colega. Nada de saludos de bienvenida ni presentación de la empresa.',
  '• Si falta un dato para cotizar (medida, color, comuna), pídelo en una sola línea. No inventes datos.',
  // [2026-10-06] Antes decia «antes de cotizar tiene que haber un cliente fijado» y el LLM, que NO sabia si lo
  // habia, contestaba «Falta fijar el cliente» justo despues de la confirmacion (7 de 8 veces ese dia). La regla
  // la aplica el CODIGO (webhook corta antes del LLM si falta); si hay cliente, el contexto lo dice abajo.
  '• El cliente de la cotización lo maneja el sistema con el comando CLIENTE: NUNCA le pidas a quien te escribe ese comando, ni el nombre ni el teléfono del cliente. Si te llega este turno, cotiza.',
].join('\n');

// [2026-09-30] Decisión del dueño: la cotización de un vendedor cuenta al CLIENTE. Lo que
// el vendedor recibe si intenta cotizar sin haber fijado cliente. [Thermos conjunto #6] Fotos y
// audios DESPUÉS de la confirmación: lo que llega antes no tiene cliente al que asignarse.
export const TEXTO_PEDIR_CLIENTE_INTERNO =
  'Antes de emitir la propuesta, dime para qué cliente es (queda a su nombre, no al tuyo). ' +
  'Escríbeme en un mensaje aparte: CLIENTE Nombre Apellido +569XXXXXXXX — y espera mi confirmación ' +
  'antes de mandar fotos o audios.';
