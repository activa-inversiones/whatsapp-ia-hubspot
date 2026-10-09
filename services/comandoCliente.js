// services/comandoCliente.js — el comando "CLIENTE Nombre +569…": cotizar A NOMBRE DE OTRO.
//
// [2026-08-08] Pedido del dueño: los clientes que le hablan directo a él quedaban registrados con
// SU teléfono (seguimiento que no llegaba, ads sucios, él en vez del cliente en /mi-agenda).
// [2026-09-30] Decisión del dueño: también los vendedores que ÉL autorizó en /equipo con modo
// interno. Quién puede: perfilEquipo (internosEquipo.js). Lo fijado: atribucionStore.js.

import { digitos, normalizarChileno, esCelularChileno } from './telefono.js';
import { perfilEquipo, telefonoDuenio, listaEquipoVigente } from './internosEquipo.js';
import { fijar, limpiar, vigenciaMs } from './atribucionStore.js';
import { yaNosEscribio, marcarSinConsentimiento } from './consentimiento.js';
import { borrar as borrarEstado } from './estadoPersistente.js';

const FORMAS_OFF = /^(off|no|ninguno|salir|listo|fin)$/i;
/** RUT chileno escrito con guion (con o sin puntos): 12.345.678-9, 56789012-3, 9.876.543-K. */
const RUT_RE = /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g;
const EJEMPLO = 'CLIENTE Juan Pérez +56912345678';
/** Un bloque contiguo que puede ser un teléfono ("+56 9 1234 5678", "9-1234-5678"). */
const BLOQUE_TEL = /[+\d][\d\s.-]{7,}/g;

/**
 * Los celulares chilenos que trae el texto (sin RUT). Un bloque con espacios se prueba entero
 * ("+56 9 1234 5678") y, si no es celular, por partes ("123456789 987654321"). Únicos por número.
 * @returns {{crudo:string, numero:string}[]}
 */
function celularesDelTexto(texto) {
  const sinRut = String(texto || '').replace(RUT_RE, ' ');
  const bloques = sinRut.match(BLOQUE_TEL) || [];
  const vistos = new Map();
  for (const b of bloques) {
    const partes = esCelularChileno(b) ? [b] : b.split(/\s+/).filter(Boolean);
    for (const p of partes) if (esCelularChileno(p) && !vistos.has(normalizarChileno(p))) vistos.set(normalizarChileno(p), p);
  }
  return [...vistos].map(([numero, crudo]) => ({ crudo, numero }));
}

/** La primera linea con texto del mensaje (el comando); lo de abajo es otra cosa (ventanas, notas). */
export function primeraLinea(texto) {
  return (String(texto || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean)) || '';
}
/** ¿Trae algo debajo del comando? (p. ej. las ventanas en el mismo mensaje) */
export function traeMasLineas(texto) {
  return String(texto || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length > 1;
}

/**
 * Parsea "CLIENTE Juan Pérez +56 9 1234 5678" (o al revés). Regla SIMPLE (Thermos conjunto, H):
 * se saca el RUT, se toman los celulares chilenos y se acepta SOLO si queda exactamente uno.
 * @returns {{ok:true, phone:string, name:string}|{ok:true, limpiar:true}|{ok:false, error:string}}
 */
export function parseComandoCliente(texto) {
  // [2026-10-06] Solo la PRIMERA linea es el comando: el dueño escribio «CLIENTE Alex Clark +569…» y las ventanas
  // debajo, y como `.` no cruza saltos de linea el patron no calzaba ⇒ «⚠️ no_es_comando» crudo (2 veces ese dia).
  const m = /^\s*cliente\b\s*(.*)$/i.exec(primeraLinea(texto));
  if (!m) return { ok: false, error: 'no_es_comando' };
  const resto = m[1].trim();
  if (!resto) return { ok: false, error: `Falta el nombre y el teléfono. Ej: ${EJEMPLO}` };
  if (FORMAS_OFF.test(resto)) return { ok: true, limpiar: true };

  const celulares = celularesDelTexto(resto);
  if (celulares.length > 1) {
    return { ok: false, error: `Hay más de un número en el mensaje y no sé cuál es el WhatsApp. Escríbelo solo, con el código de país: ${EJEMPLO}` };
  }
  if (!celulares.length) {
    // ⚠️ 9 dígitos mínimo, NO 8 (un typo se convertía en el número de OTRA persona — Codex 08-ago).
    const largo = Math.max(0, ...(resto.replace(RUT_RE, ' ').match(/[+\d][\d\s.-]{5,}/g) || []).map((b) => digitos(b).length));
    return largo >= 9
      ? { ok: false, error: `Ese número no es un celular chileno. Escribe el WhatsApp del cliente así: ${EJEMPLO}` }
      : { ok: false, error: `Ese teléfono no me cuadra. Escribilo completo, con los 9 dígitos: ${EJEMPLO}` };
  }
  const name = resto.replace(celulares[0].crudo, ' ').replace(/\s+/g, ' ').trim();
  // El nombre es obligatorio: va en la propuesta formal (Codex 08-ago).
  if (!name || name.length < 2) {
    return { ok: false, error: `Me falta el nombre del cliente. Va en la propuesta formal, así que no lo puedo inventar: ${EJEMPLO}` };
  }
  return { ok: true, phone: celulares[0].numero, name };
}

/**
 * ¿Es de verdad el comando, o el dueño escribió "cliente" en una frase normal? Se intercepta SOLO si
 * trae un teléfono largo o es la forma corta exacta (Codex 08-ago: "Cliente me pidió otra medida").
 */
export function pareceComando(texto) {
  const t = primeraLinea(texto);
  if (!/^\/?\s*cliente\b/i.test(t)) return false;
  const resto = t.replace(/^\/?\s*cliente\b/i, '').trim();
  if (!resto) return true;
  if (FORMAS_OFF.test(resto)) return true;
  // [M1 r10] Un BLOQUE contiguo de teléfono (el mismo patrón que celularesDelTexto), no la suma de
  // todos los dígitos: «Cliente quiere 2 ventanas de 1500x1200» se interceptaba como comando.
  return (resto.match(BLOQUE_TEL) || []).some((b) => digitos(b).length >= 8);
}

/** ¿Se le acepta a este número este comando? Terminar: perfil.puedeTerminar; fijar: puedeFijar. */
export function autorizaComandoCliente(waId, texto, ahora = Date.now()) {
  const p = perfilEquipo(waId, ahora);
  const esOff = parseComandoCliente(texto || '').limpiar === true;
  return esOff ? p.puedeTerminar : p.puedeFijar;
}

/**
 * El comando entero: autorizar (de nuevo), fijar/limpiar y la marca de consentimiento.
 * @returns {Promise<string>} el mensaje para quien mandó el comando
 */
export async function procesarComandoCliente({
  waId, texto, escribio = yaNosEscribio, marcar = marcarSinConsentimiento, logErr = () => {},
  esDelEquipo = (p) => perfilEquipo(p).esEquipo,
  desde = null,   // [M2 r10] hora WhatsApp del comando: ordena contra los mensajes en vuelo
  // [r11 #4] Se re-chequea ACÁ (dentro del lock en index.js): un permiso revocado mientras el
  // comando esperaba el lock no puede ejecutarse igual.
  autorizar = () => autorizaComandoCliente(waId, texto),
  listaVigente = () => listaEquipoVigente(),
  // [2026-10-09 · Fase 0, Codex r1 ALTO #2] CLIENTE (fijar u OFF) borra la marca PRUEBA del dueño EN EL MOMENTO:
  // antes se borraba recién en el turno siguiente con atribución, y PRUEBA → CLIENTE → CLIENTE OFF dejaba la
  // marca viva ⇒ lo siguiente volvía a cotizarse a nombre del dueño.
  borrarMarca = (k) => borrarEstado(k),
}) {
  let autorizado = false;
  try { autorizado = autorizar() === true; } catch { autorizado = false; }
  if (!autorizado) return '⚠️ Tu número no está habilitado para usar CLIENTE en este momento. Avísale al administrador.';
  const r = parseComandoCliente(texto || '');
  if (!r.ok) return r.error === 'no_es_comando'
    ? `⚠️ No entendí el comando. Escríbelo en la primera línea, así: ${EJEMPLO}`   // nunca el codigo crudo
    : `⚠️ ${r.error}`;
  const esDuenio = perfilEquipo(waId).rol === 'duenio';
  if (esDuenio) { try { borrarMarca(`modo_prueba:${digitos(waId)}`); } catch { /* el vencimiento de 2 h la apaga igual */ } }
  if (r.limpiar) {
    limpiar(waId, { desde });
    // [Fase 0] Para el dueño ya NO es verdad que «vuelve a quedar a tu nombre»: sin cliente no cotiza.
    return esDuenio
      ? '✅ Listo, cliente liberado. Para cotizar de nuevo: CLIENTE Nombre +569…, o PRUEBA si es una prueba del sistema.'
      : '✅ Listo. Lo que cotices ahora vuelve a quedar a tu nombre.';
  }
  // [r15 · Codex] Sin lista del equipo (nunca cargó, o >30 min sin refrescar) no se puede saber si el
  // número es de un vendedor: perfilEquipo diría "no es equipo" sin lanzar. Se rechaza para TODOS,
  // incluido el dueño. CLIENTE OFF (arriba) sigue funcionando.
  let hayLista = false;
  try { hayLista = listaVigente() === true; } catch { hayLista = false; }
  if (!hayLista) return '⚠️ La lista del equipo no está disponible, intenta en unos minutos.';
  // El cliente no puede ser quien escribe, el dueño ni nadie del equipo.
  // [r11 #4] FAIL-CLOSED: si no se puede saber si es del equipo, se rechaza (antes se aceptaba).
  let esEquipo;
  try { esEquipo = esDelEquipo(r.phone) === true; } catch (e) {
    try { logErr('cliente_equipo_indeterminado', e); } catch { /* */ }
    return '⚠️ No pude verificar ese número contra la lista del equipo. Intenta de nuevo en unos minutos.';
  }
  if (r.phone === normalizarChileno(waId) || r.phone === telefonoDuenio() || esEquipo) {
    return `⚠️ Ese número es tuyo o de alguien del equipo, no de un cliente. Escribe el WhatsApp del cliente: ${EJEMPLO}`;
  }
  fijar(waId, r.phone, r.name, { desde });
  // [r11 #6 · Codex] El lead del cliente NO se crea ni se reabre acá: se crea/reabre al COTIZAR
  // (borrador o emisión bajo atribución llevan `lead` con no_pisar). Un comando no es una
  // cotización: «CLIENTE Juan» + «CLIENTE OFF» revivía a un perdido sin que nadie le cotizara.
  // Consentimiento: se marca SIEMPRE, salvo que ese número le haya escrito al bot.
  let _escribio = false;
  try { _escribio = await escribio(r.phone); } catch { _escribio = false; }
  if (!_escribio) { try { marcar(r.phone); } catch { /* */ } }
  return `✅ Cotizando para *${r.name}* (+${r.phone}).\n\n` +
    'Lo que cotices desde ahora queda a su nombre: el lead, el seguimiento y el CRM. ' +
    'El PDF te llega a vos para que se lo mandes.\n\n' +
    // [Thermos conjunto #6] Lo que llega antes de esta confirmación no tiene cliente al que asignarse.
    'Las fotos o audios del cliente mándalos DESPUÉS de esta confirmación.\n\n' +
    // [2026-10-06] Decision del dueño: queda fijado hasta cambiar de cliente (tope de seguridad: vigenciaMs, 24 h).
    'Queda fijado mientras cotices para este cliente, también para corregir la propuesta. Para otro cliente ' +
    `manda CLIENTE con sus datos; para terminar, *CLIENTE OFF*. Vence a las ${Math.round(vigenciaMs() / 3600000)} h.` +
    // [2026-10-06] Si las ventanas venian debajo del comando, se avisa: este mensaje NO se cotiza (el comando
    // se procesa fuera del turno de Oliver, con su propio lock); hay que mandarlas aparte.
    (traeMasLineas(texto) ? '\n\n📋 Las ventanas que venían debajo del comando NO las cotizo desde este mensaje: ' +
      'mándamelas de nuevo en un mensaje aparte y salen a nombre de este cliente.' : '') +
    (_escribio ? '' :
      '\n\n⚠️ Como nunca escribió al bot, el seguimiento automático NO le va a llegar ' +
      'hasta que él te escriba por acá. Es a propósito: no podemos mandarle mensajes ' +
      'sin que él haya iniciado la conversación.');
}

/** Tras aceptarse el envío del PDF la atribución se consume: cómo volver al cliente para corregir. */
export function mensajeTrasPdf(atribucion) {
  if (!atribucion?.phone) return '';
  const nombre = atribucion.name || 'el cliente';
  // [2026-10-06] La atribucion ya no se consume con el PDF (decision del dueño): se sigue cotizando para el cliente.
  return `✅ Propuesta de *${nombre}* emitida. Sigues cotizando para ${nombre}: para corregirla, dime qué cambiar. ` +
    'Para otro cliente manda CLIENTE Nombre +569…; para terminar, *CLIENTE OFF*.';
}
