// services/comandoCliente.js — el comando "CLIENTE Nombre +569…": cotizar A NOMBRE DE OTRO.
//
// [2026-08-08] Pedido del dueño: los clientes que le hablan directo a él quedaban registrados con
// SU teléfono (seguimiento que no llegaba, ads sucios, él en vez del cliente en /mi-agenda).
// [2026-09-30] Decisión del dueño: también los vendedores que ÉL autorizó en /equipo con modo
// interno. Quién puede: perfilEquipo (internosEquipo.js). Lo fijado: atribucionStore.js.

import { digitos, normalizarChileno, esCelularChileno } from './telefono.js';
import { perfilEquipo, telefonoDuenio } from './internosEquipo.js';
import { fijar, limpiar, vigenciaMs } from './atribucionStore.js';
import { yaNosEscribio, marcarSinConsentimiento } from './consentimiento.js';
import { leadDeAtribucion } from './identidadCotizacion.js';

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

/**
 * Parsea "CLIENTE Juan Pérez +56 9 1234 5678" (o al revés). Regla SIMPLE (Thermos conjunto, H):
 * se saca el RUT, se toman los celulares chilenos y se acepta SOLO si queda exactamente uno.
 * @returns {{ok:true, phone:string, name:string}|{ok:true, limpiar:true}|{ok:false, error:string}}
 */
export function parseComandoCliente(texto) {
  const m = /^\s*cliente\b\s*(.*)$/i.exec(String(texto || '').trim());
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
  const t = String(texto || '').trim();
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
 * El comando entero: fijar/limpiar, crear el lead del cliente y la marca de consentimiento.
 * @returns {Promise<string>} el mensaje para quien mandó el comando
 */
export async function procesarComandoCliente({
  waId, texto, pushLead, escribio = yaNosEscribio, marcar = marcarSinConsentimiento, logErr = () => {},
  esDelEquipo = (p) => perfilEquipo(p).esEquipo,
  desde = null,   // [M2 r10] hora WhatsApp del comando: ordena contra los mensajes en vuelo
}) {
  const r = parseComandoCliente(texto || '');
  if (!r.ok) return `⚠️ ${r.error}`;
  if (r.limpiar) {
    limpiar(waId, { desde });
    return '✅ Listo. Lo que cotices ahora vuelve a quedar a tu nombre.';
  }
  // El cliente no puede ser quien escribe, el dueño ni nadie del equipo.
  let esEquipo = false;
  try { esEquipo = esDelEquipo(r.phone) === true; } catch { esEquipo = false; }
  if (r.phone === normalizarChileno(waId) || r.phone === telefonoDuenio() || esEquipo) {
    return `⚠️ Ese número es tuyo o de alguien del equipo, no de un cliente. Escribe el WhatsApp del cliente: ${EJEMPLO}`;
  }
  fijar(waId, r.phone, r.name, { desde });
  // Si el cliente no existe como lead, se crea (no_pisar: si existía, no se le cambia nada).
  try {
    Promise.resolve(pushLead(leadDeAtribucion(waId, r.phone, r.name)))
      .catch((e) => { try { logErr('cliente_atribucion_lead', e); } catch { /* */ } });
  } catch (e) { try { logErr('cliente_atribucion_lead', e); } catch { /* */ } }
  // Consentimiento: se marca SIEMPRE, salvo que ese número le haya escrito al bot.
  let _escribio = false;
  try { _escribio = await escribio(r.phone); } catch { _escribio = false; }
  if (!_escribio) { try { marcar(r.phone); } catch { /* */ } }
  return `✅ Cotizando para *${r.name}* (+${r.phone}).\n\n` +
    'Lo que cotices desde ahora queda a su nombre: el lead, el seguimiento y el CRM. ' +
    'El PDF te llega a vos para que se lo mandes.\n\n' +
    // [Thermos conjunto #6] Lo que llega antes de esta confirmación no tiene cliente al que asignarse.
    'Las fotos o audios del cliente mándalos DESPUÉS de esta confirmación.\n\n' +
    'Vale para UNA propuesta: cuando se envíe el PDF vuelve a tu nombre (para corregirla, manda ' +
    `de nuevo este mismo comando). Para cancelar antes: *CLIENTE OFF*. Vence a las ${Math.round(vigenciaMs() / 3600000)} h.` +
    (_escribio ? '' :
      '\n\n⚠️ Como nunca escribió al bot, el seguimiento automático NO le va a llegar ' +
      'hasta que él te escriba por acá. Es a propósito: no podemos mandarle mensajes ' +
      'sin que él haya iniciado la conversación.');
}

/** Tras aceptarse el envío del PDF la atribución se consume: cómo volver al cliente para corregir. */
export function mensajeTrasPdf(atribucion) {
  if (!atribucion?.phone) return '';
  const nombre = atribucion.name || 'el cliente';
  return `✅ Propuesta de *${nombre}* emitida. Para corregirla manda CLIENTE ${atribucion.name || 'Nombre'} +${atribucion.phone}`;
}
