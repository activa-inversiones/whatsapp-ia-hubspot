// services/avisoEntregaDudosa.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA IMPERIUM — EL AVISO DE LA ENTREGA DUDOSA
//
// POR QUÉ EXISTE. Al conectar `errorMeta.clasificar()` al envío de documentos, un
// timeout dejó de reintentarse: si Meta alcanzó a aceptar el POST, reintentar le manda
// al cliente el MISMO informe dos veces, y la regla del dueño es textual —
// *"2 veces la misma no se puede es una falta de respeto al cliente"*.
//
// 🔴 PERO ESO SOLO MUEVE EL PROBLEMA SI NADIE SE ENTERA. Lo levantó Kimi en la compuerta:
// *"el cambio convierte 'posible duplicado' en 'posible pérdida silenciosa'"*. Y tiene
// razón: es EXACTAMENTE el caso Katy (15-sep), donde faltó un documento y nadie lo supo
// en dos horas. Un log que nadie lee no es enterarse.
//
// Entonces: cuando no sabemos si llegó, no se reintenta Y SE AVISA. La decisión de
// reenviar la toma un humano mirando el chat del cliente — nunca este código.
//
// MÓDULO PURO en lo que decide; el envío lo hace el que llama.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

/** Cada cuánto se puede repetir el aviso del MISMO documento. */
export const AVISO_REPETIR_MS = 6 * 3600_000;

/**
 * El texto que le llega al dueño.
 *
 * ⚠️ Lleva la EVIDENCIA (qué documento, de qué folio, a qué teléfono) porque él resuelve
 * abriendo el chat del cliente. Sin eso, el humano se vuelve el que duplica — es la misma
 * lección que ya está escrita en `entregaVigilanteReglas.js`.
 *
 * El teléfono va ENMASCARADO: alcanza para ubicar el chat y no vuelca el número completo
 * en un canal que queda en historiales.
 */
export function mensajeEntregaDudosa({ tipo, folio, telefono, motivo } = {}) {
  const tel = String(telefono || '').replace(/\D/g, '');
  const quien = tel ? `…${tel.slice(-4)}` : 'sin teléfono';
  return [
    '⚠️ *Una entrega quedó sin confirmar*',
    `• ${tipo || 'documento'} ${folio || 'sin folio'} — ${quien}`,
    `• Motivo: ${motivo || 'desconocido'}`,
    '',
    'No sabemos si le llegó, así que NO se reenvía solo.',
    'Abrí el chat del cliente y fijate si el documento está.',
  ].join('\n');
}

/**
 * ¿Toca avisar de este documento, o ya se avisó hace poco?
 *
 * @param {number|string|null} ultimoAvisoAt  epoch ms o fecha ISO del último aviso
 * @param {number} ahora
 * @returns {boolean}
 */
export function tocaAvisar(ultimoAvisoAt, ahora = Date.now(), repetirMs = AVISO_REPETIR_MS) {
  if (ultimoAvisoAt == null || ultimoAvisoAt === '') return true;
  const t = typeof ultimoAvisoAt === 'number' ? ultimoAvisoAt : new Date(ultimoAvisoAt).getTime();
  // Ante una marca ilegible se AVISA. Un aviso de más molesta; uno de menos deja al
  // cliente sin su documento y sin que nadie lo sepa.
  if (!Number.isFinite(t) || t <= 0) return true;
  return (ahora - t) >= repetirMs;
}

/** La llave del throttle. Por documento, no por cliente: son entregas distintas. */
export function claveAviso(tipo, folio) {
  return `aviso_dudoso:${tipo || 'doc'}:${folio || 'sin_folio'}`;
}

export default mensajeEntregaDudosa;
