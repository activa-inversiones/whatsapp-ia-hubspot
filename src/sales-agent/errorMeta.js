// errorMeta.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — ¿Meta dijo que NO lo entregó, o no sabemos si lo entregó?
//
// POR QUÉ EXISTE (#778, tridente 15-sep-2026).
// La regla del dueño, textual: *"debemos enviarle una sola y si él la modifica otra, o los
// colores que quiera, pero 2 veces la misma no se puede: es una falta de respeto al cliente"*.
// Para cumplirla hay que poder distinguir DOS situaciones que hoy salen idénticas del adapter:
//
//   · FALLO CONOCIDO   → Meta respondió un error que significa "no lo procesé".
//                        Sabemos que NO llegó ⇒ se puede reintentar sin duplicar nada.
//   · RESULTADO DESCONOCIDO → timeout, socket cortado, o un error ambiguo.
//                        NO sabemos si llegó ⇒ NUNCA se reintenta solo: va a revisión humana.
//
// 🔴 POR QUÉ NO ALCANZA MIRAR EL STATUS HTTP (hallazgo bloqueante de Kimi K3 en la compuerta):
// un 5xx de Meta es AMBIGUO. Meta puede haber aceptado el mensaje internamente, encolarlo para
// entrega, y DESPUÉS fallar al responder. Hay entregas documentadas tras una respuesta de error
// de la Cloud API. Clasificar "5xx ⇒ no llegó ⇒ reintento" produciría duplicados con sello de
// aprobado — justo lo que la regla prohíbe.
// ⇒ La clasificación es por WHITELIST de códigos, no por familia HTTP.
//
// 🔴 Y LA WHITELIST ARRANCA CASI VACÍA, A PROPÓSITO. Solo entran códigos cuyo significado
// ("Meta no procesó el mensaje") está verificado. Todo lo demás —incluido cualquier código que
// no conozcamos— cae en DESCONOCIDO. Un código nuevo de Meta NO puede volverse un reintento
// automático por omisión: el default seguro es no reenviar.
//
// ⚠️ LÍMITE HONESTO: el comportamiento real de Meta por código sale de SU documentación o de
// logs reales, no de este repo. Esta lista se amplía SOLO con evidencia, nunca de memoria.
//
// MÓDULO PURO, sin red ni I/O.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

export const RESULTADO = {
  ENTREGADO_A_META: 'entregado_a_meta', // Meta aceptó (hay wamid)
  FALLO_CONOCIDO: 'fallo_conocido',     // Meta dijo que no lo procesó → reintentable
  DESCONOCIDO: 'desconocido',           // no sabemos → NUNCA reintento automático
};

/**
 * [2026-10-05] Los rechazos que hablan del DESTINATARIO, no del mensaje: fuera de la ventana de
 * 24 h o número que no recibe. Otro documento al mismo número en el mismo turno falla igual — y
 * si lleva folio ISO, lo quema sin registro. Son un subconjunto de CODIGOS_NO_PROCESADO.
 */
const CODIGOS_FUERA_DE_VENTANA = new Set([
  131047, // Re-engagement: fuera de la ventana de 24 h. Meta rechaza antes de encolar.
]);
const CODIGOS_DESTINATARIO = new Set([
  ...CODIGOS_FUERA_DE_VENTANA,
  131026, // Mensaje no entregable: el número no está en WhatsApp / no puede recibir.
]);

/**
 * Códigos de la WhatsApp Cloud API que significan, sin ambigüedad, que el mensaje
 * NO fue procesado. Reintentar uno de estos no puede duplicar nada.
 *
 * Se parte con los tres de rechazo por VALIDACIÓN, que son los únicos donde Meta
 * ni siquiera llega a encolar. Cualquier agregado futuro necesita su evidencia
 * (link a la doc de Meta o caso real en logs) escrito acá al lado.
 */
export const CODIGOS_NO_PROCESADO = new Set([
  ...CODIGOS_DESTINATARIO,
  132000, // Number of parameters mismatch: la plantilla no cuadra. Rechazo de validación.
]);

/** El código numérico de Meta del resultado, o null si no trae uno válido (un string no cuenta). */
function codigoDe(r) {
  return r && Number.isFinite(r.code) ? Number(r.code) : null;
}

/** Errores de transporte que garantizan que la request NUNCA llegó a salir. */
const NUNCA_SALIO = new Set([
  'ENOTFOUND',    // no resolvió el DNS
  'ECONNREFUSED', // el servidor rechazó la conexión
]);

/**
 * Clasifica el resultado de un intento de envío a Meta.
 *
 * @param {{ok?: boolean, wamid?: string, status?: number, code?: number,
 *           error_subcode?: number, timedOut?: boolean, netCode?: string}} r
 * @returns {{resultado: string, reintentable: boolean, motivo: string}}
 *   `reintentable:true` SOLO cuando sabemos que no llegó.
 */
export function clasificar(r) {
  if (!r || typeof r !== 'object') {
    return out(RESULTADO.DESCONOCIDO, 'sin_resultado');
  }

  // Meta aceptó: hay identificador de mensaje. Es el único "salió bien".
  if (r.ok === true && r.wamid) {
    return out(RESULTADO.ENTREGADO_A_META, 'wamid_recibido');
  }

  // "ok" sin wamid NO es éxito: sin identificador no hay forma de rastrear la entrega
  // ni de que el acuse de Meta resuelva el caso después.
  if (r.ok === true && !r.wamid) {
    return out(RESULTADO.DESCONOCIDO, 'ok_sin_wamid');
  }

  // El timeout es el caso DESCONOCIDO canónico: la request salió y no sabemos qué pasó.
  if (r.timedOut === true) {
    return out(RESULTADO.DESCONOCIDO, 'timeout');
  }

  // Estos errores de red ocurren ANTES de mandar nada.
  if (r.netCode && NUNCA_SALIO.has(r.netCode)) {
    return out(RESULTADO.FALLO_CONOCIDO, `red_${r.netCode.toLowerCase()}`);
  }

  // La whitelist manda. Nunca la familia del status.
  const code = codigoDe(r);
  if (code !== null && CODIGOS_NO_PROCESADO.has(code)) {
    return out(RESULTADO.FALLO_CONOCIDO, `codigo_${code}`);
  }

  // Todo lo demás —5xx incluido, código desconocido incluido, sin código incluido—
  // es DESCONOCIDO. El default seguro es no reenviar.
  if (Number.isFinite(r.status) && r.status >= 500) {
    return out(RESULTADO.DESCONOCIDO, `status_${r.status}_ambiguo`);
  }
  if (code !== null) {
    return out(RESULTADO.DESCONOCIDO, `codigo_${code}_no_verificado`);
  }
  return out(RESULTADO.DESCONOCIDO, 'sin_clasificar');
}

/** ¿Meta rechazó el envío por el DESTINATARIO (24 h / número que no recibe)? Ver CODIGOS_DESTINATARIO. */
export function rechazoDelDestinatario(r) {
  const code = codigoDe(r);
  return code !== null && CODIGOS_DESTINATARIO.has(code);
}

/**
 * [2026-10-05 · r7] ¿Meta rechazó el TEXTO LIBRE por estar fuera de la ventana de 24 h (131047)? Es el único
 * rechazo en que una PLANTILLA aprobada SÍ pasa al mismo destinatario (131026, número que no recibe, la
 * rechazaría igual). Es un fallo CONOCIDO: Meta no encoló nada, así que mandar la plantilla no puede duplicar.
 */
export function fueraDeVentana24h(r) {
  const code = codigoDe(r);
  return code !== null && CODIGOS_FUERA_DE_VENTANA.has(code);
}

/** Atajo: ¿se puede reintentar automáticamente sin riesgo de duplicar? */
export function sePuedeReintentar(r) {
  return clasificar(r).reintentable === true;
}

function out(resultado, motivo) {
  return { resultado, reintentable: resultado === RESULTADO.FALLO_CONOCIDO, motivo };
}

export default clasificar;
