// services/candadoSeguimiento.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// [2026-08-19] CANDADO ÚNICO DE SEGUIMIENTO — un solo cliente, un solo mensaje.
//
// POR QUÉ EXISTE: hay DOS motores que le escriben al mismo cliente y no se hablan.
//   1. followupService del CXM — PRENDIDO. Medido sobre la BD viva el 19-ago:
//      141 envíos a 87 clientes en 90 días, todos OK, 21 respondieron dentro de
//      7 días (15% de respuesta). Dispara contra /admin/send-template del bot.
//   2. reengagement.js de Oliver — apagado por flag ZERO_LEAKS_REENGAGE.
//      También dispara contra /admin/send-template.
// Cada uno lleva su PROPIO dedupe, así que ninguno ve los envíos del otro. El día
// que se prenda el segundo, el mismo cliente recibe DOS plantillas el mismo día.
// Como ambos pasan por el mismo endpoint, el candado correcto vive ahí: es el
// único punto que los ve a los dos.
//
// QUÉ FRENA Y QUÉ NO: solo las plantillas de PERSEGUIR al cliente. Las
// transaccionales (envío de cotización, escalamiento, apertura por llamada,
// informe al dueño) son respuesta a algo que ACABA de pasar — frenarlas rompería
// el flujo y dejaría al cliente esperando.
//
// Módulo PURO con deps inyectables, igual que reengagement.js / oliverHandoff.js:
// se testea sin red, sin BD y sin env vars.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

/** Plantillas que PERSIGUEN al cliente. Todo lo demás pasa sin candado. */
export const TEMPLATES_DE_SEGUIMIENTO = new Set([
  'recontacto_lead',
  'seguimiento_cotizacion',
  'vigencia_precio',
  'solicitud_resena',
]);

export const CANDADO_HORAS = 48;

/** ¿Esta plantilla persigue al cliente? Tolera mayúsculas, espacios y basura. */
export function esSeguimiento(template) {
  return TEMPLATES_DE_SEGUIMIENTO.has(String(template ?? '').trim().toLowerCase());
}

/** Clave por teléfono normalizado: el mismo número entra como '+569…' y '569…'. */
export function claveCandado(phone) {
  return `followup:${String(phone ?? '').replace(/\D/g, '')}`;
}

/**
 * ¿Se puede enviar esta plantilla ahora?
 * @param {{template:string, phone:string}} args
 * @param {{leer:(k:string)=>Promise<any>, onError?:(e:Error)=>void}} deps
 * @returns {Promise<{permitido:boolean, razon:string, clave:string|null}>}
 */
export async function puedeEnviar({ template, phone } = {}, { leer, onError } = {}) {
  if (!esSeguimiento(template)) {
    return { permitido: true, razon: 'no_es_seguimiento', clave: null };
  }
  const clave = claveCandado(phone);
  let previo = false;
  try {
    previo = (await leer(clave)) === true;
  } catch (e) {
    // FAIL-OPEN A PROPÓSITO: si el almacén de estado falla, se envía igual. Un
    // mensaje repetido molesta; un cliente que nunca recibe seguimiento se pierde.
    // El riesgo asimétrico manda. (Mismo criterio que reengagement.js con la agenda.)
    if (onError) onError(e);
    return { permitido: true, razon: 'candado_ilegible', clave };
  }
  return previo
    ? { permitido: false, razon: 'candado_48h', clave }
    : { permitido: true, razon: 'sin_candado_previo', clave };
}

/**
 * Marca el candado. SOLO se llama si el envío salió bien: si Meta rechazó, el otro
 * motor tiene que poder reintentar.
 */
export async function marcarEnviado(clave, { escribir, onError } = {}) {
  if (!clave) return { ok: false, razon: 'sin_clave' };
  try {
    await escribir(clave, true, CANDADO_HORAS * 3600);
    return { ok: true };
  } catch (e) {
    if (onError) onError(e);
    return { ok: false, razon: 'escritura_fallo' };
  }
}

export default { puedeEnviar, marcarEnviado, esSeguimiento, claveCandado, TEMPLATES_DE_SEGUIMIENTO, CANDADO_HORAS, VERSION };
