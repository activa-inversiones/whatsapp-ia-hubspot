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

export const VERSION = '1.1.0';

/** Cada cuánto se puede repetir el aviso del MISMO documento. */
export const AVISO_REPETIR_MS = 6 * 3600_000;

/**
 * Marcadores de posición que el sistema usa cuando NO sabe el nombre. Puestos acá y no en
 * el llamador porque el defecto lo levantó la compuerta en UN camino (vientos, donde
 * `clientName` defaultea al literal 'Cliente') y el otro lo tendría igual el día que
 * alguien copie el patrón.
 */
const NO_ES_NOMBRE = new Set(['cliente', 'sin nombre', 'desconocido', 'n/a']);

/**
 * El nombre, listo para meter en el mensaje.
 *
 * 🔴 [Kimi, compuerta 16-sep] DOS COSAS, LAS DOS MEDIDAS:
 * 1. *"el fallback nunca se alcanza en vientos porque clientName defaultea a 'Cliente'…
 *    el mensaje miente: parece un nombre real y no lo es"*. Y es el problema original con
 *    otro disfraz: el dueño pidió el nombre PARA REVISAR, y "Cliente" no le sirve.
 * 2. *"un nombre con `*`, `_`, `~` o backtick desbalancea el markup de WhatsApp"* — el
 *    nombre va entre asteriscos de negrita, así que un apellido con un asterisco pegado
 *    deja el resto del aviso en negrita o muestra los asteriscos crudos.
 */
function nombreParaAviso(nombre) {
  const limpio = String(nombre || '')
    .replace(/[*_~`]/g, '')        // marcas de formato de WhatsApp
    .replace(/\s+/g, ' ')          // saltos de línea incluidos: no pueden partir el mensaje
    .trim();
  if (!limpio) return null;
  return NO_ES_NOMBRE.has(limpio.toLowerCase()) ? null : limpio;
}

/**
 * El texto que le llega al dueño.
 *
 * Lleva la EVIDENCIA (quién, qué documento, de qué folio) porque él resuelve abriendo el
 * chat del cliente. Sin eso, el humano se vuelve el que duplica — es la misma lección que
 * ya está escrita en `entregaVigilanteReglas.js`.
 *
 * 🔴 [Dueño, 16-sep, textual: *"cómo se llama el cliente para revisar"*] VA EL NOMBRE Y EL
 * NÚMERO COMPLETO. La primera versión enmascaraba el teléfono (`…2852`) copiando el criterio
 * del Vigilante, y así el aviso quedaba INSERVIBLE: para actuar había que buscar un chat por
 * los últimos cuatro dígitos sin saber de quién era. El enmascarado del Vigilante se
 * justifica porque ese aviso puede ir a un canal compartido; éste va al celular del dueño
 * (OWNER_PHONE), sobre su propio cliente, y lo único que importa es que pueda abrir la
 * conversación ya.
 */
export function mensajeEntregaDudosa({ tipo, folio, telefono, motivo, nombre } = {}) {
  const tel = String(telefono || '').replace(/\D/g, '');
  const quien = nombreParaAviso(nombre);
  return [
    '⚠️ *Una entrega quedó sin confirmar*',
    // Sin nombre se dice ASÍ, y sin negrita: nada que parezca un nombre cuando no lo hay.
    quien ? `• Cliente: *${quien}*` : '• Cliente: sin nombre registrado',
    `• Teléfono: ${tel ? `+${tel}` : 'sin teléfono'}`,
    `• Documento: ${tipo || 'documento'} ${folio || 'sin folio'}`,
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
