// services/atribucionTurno.js — lo que la atribución le hace a UN turno de Oliver, en dos momentos:
//   · alEntrar   → la carpeta del cliente (cambiar, recuperar su folio, avisar si quedó algo guardado);
//   · trasEmitir → cuando Meta ACEPTA el envío del PDF: guardar el folio en la carpeta del cliente,
//                  consumir la atribución y decir cómo corregir. UNA vez por turno aunque salgan
//                  varios PDF (alternativas A/B/C).
// La foto de la atribución es `turno` (identidadCotizacion.resolverTurno): nadie la relee.
//
// 📌 DISEÑO DEL CONSUMO (r11 #2, decisión 01-oct; Codex propuso consumir recién con `delivered`):
//   la atribución se CONSUME cuando Meta ACEPTA el envío del PDF, no cuando lo entrega. Motivo: el
//   PDF va AL VENDEDOR (quien escribe), no al cliente; si la entrega falla, el vendedor lo ve en su
//   propio chat y re-fija el MISMO cliente con CLIENTE: su carpeta trae su estado y su folio
//   (alEntrar, Thermos conjunto #1), así que la corrección no quema un folio nuevo. Esperar el
//   `delivered` dejaría la atribución abierta indefinidamente si el acuse no llega.

import { cambiarCarpeta, escribirCarpeta, leerCarpeta, CARPETA_PROPIA } from './sesionCarpetas.js';
import { limpiarSiMisma } from './atribucionStore.js';
import { completo } from './telefono.js';
import { mensajeTrasPdf } from './comandoCliente.js';

/** Lo que se le dice a quien escribe si no se pudo abrir/guardar la carpeta al cambiar de cliente. */
export const TEXTO_ERROR_CARPETA =
  '⚠️ No pude abrir la cotización de ese cliente. No perdí nada: vuelve a escribirme en un momento y sigo.';

/**
 * @param {{turno:object, state:object, history:Array, kv:{leer,escribir}, log?:Function}} o
 * @returns {Promise<{mov:'igual'|'cambio'|'error', previa?:string, error?:string, aviso?:string, texto?:string}>}
 *   previa = la carpeta con la que llegó el turno (RESET la vacía también).
 */
export async function alEntrar({ turno, state, history, kv, log = () => {} }) {
  const a = turno.atribucion;
  const previa = state.carpeta_activa || CARPETA_PROPIA;   // se devuelve: RESET la vacía también (r11 #5)

  // [Thermos conjunto #4] Sin atribución pero con la carpeta de un cliente activa y SIN cerrar
  // (un redeploy borró la atribución de memoria): no se pierde nada —la carpeta queda guardada— y
  // se le dice cómo retomarla.
  let aviso;
  if (!a && previa !== CARPETA_PROPIA && state.carpeta_cerrada !== previa) {
    const nombre = state.carpeta_nombre || 'tu cliente';
    aviso = `ℹ️ Tu cotización de *${nombre}* quedó guardada. Para seguirla manda CLIENTE ${state.carpeta_nombre || 'Nombre'} +${previa}`;
  }

  const mov = await cambiarCarpeta({
    from: turno.quienEscribe, state, history, cliente: a ? turno.cliente : null,
    leer: kv.leer, escribir: kv.escribir, log,
  });
  if (mov.mov === 'error') return { ...mov, texto: TEXTO_ERROR_CARPETA };
  // La sesión es de quien escribe: tras restaurar la carpeta, el teléfono de la sesión es el suyo.
  if (mov.mov === 'cambio') state.telefono = turno.quienEscribe;

  if (a) {
    // [Thermos conjunto #1] Re-fijar al MISMO cliente (gen nueva) con la carpeta ya activa: tras un
    // redeploy la sesión puede venir más vieja que la carpeta (el folio se guardó en la carpeta al
    // emitir). Se lee la carpeta y, si su folio es más nuevo, se recupera.
    if (mov.mov === 'igual' && state.carpeta_gen !== a.gen) {
      const leida = await leerCarpeta({ from: turno.quienEscribe, carpeta: turno.cliente, leer: kv.leer });
      const lq = leida.ok ? leida.valor?.state?.last_quote : null;
      if (lq && (!state.last_quote || Number(lq.at || 0) > Number(state.last_quote.at || 0))) state.last_quote = lq;
    }
    state.carpeta_gen = a.gen;
    state.carpeta_nombre = a.name || state.carpeta_nombre;
    delete state.carpeta_cerrada;
  } else if (mov.mov === 'cambio') {
    delete state.carpeta_gen; delete state.carpeta_nombre; delete state.carpeta_cerrada;
  }
  return { ...mov, previa, ...(aviso && mov.mov === 'cambio' ? { aviso } : {}) };
}

/**
 * Tras ACEPTARSE el envío del PDF. Una vez por turno.
 * Política de falla (única): si el folio no se pudo guardar durable en la carpeta del cliente, NO se
 * consume la atribución (sigue cotizando para ese cliente) y se le avisa a quien cotiza.
 * @returns {Promise<{hecho:boolean, consumida?:boolean}>}
 */
export async function trasEmitir({ turno, state, history, kv, enviar, log = () => {} }) {
  const a = turno.atribucion;
  if (!a || turno._trasEmitirHecho) return { hecho: false };
  turno._trasEmitirHecho = true;
  const g = await escribirCarpeta({ from: turno.quienEscribe, carpeta: turno.cliente, state, history, escribir: kv.escribir });
  if (!g.ok) {
    log('warn', `carpeta del cliente sin guardar tras emitir (${g.error}); la atribución NO se consume`);
    try {
      await enviar(`⚠️ La propuesta de *${a.name || 'tu cliente'}* salió, pero no pude guardar su folio. ` +
        `Sigues cotizando para ${a.name || 'ese cliente'}: si hay que corregirla, hazlo ahora; para terminar manda *CLIENTE OFF*.`);
    } catch { /* el aviso no tumba el turno */ }
    return { hecho: true, consumida: false };
  }
  limpiarSiMisma(turno.quienEscribe, a.gen);
  state.carpeta_cerrada = turno.cliente;
  turno._carpetaPorCerrar = true;   // [L4 r10] al final del turno se reescribe completa (alCerrarTurno)
  try { await enviar(mensajeTrasPdf(a)); } catch { /* el aviso no tumba el turno */ }
  return { hecho: true, consumida: true };
}

/**
 * [L4 r10] trasEmitir guarda la carpeta A MITAD de generarPdf, sin lo que el resto del turno agrega
 * (respuesta, historial, estado que el cerebro devuelve). Al terminar un turno con emisión, se
 * reescribe la carpeta COMPLETA del cliente. Si falla, el folio ya quedó guardado: solo se registra.
 */
export async function alCerrarTurno({ turno, state, history, kv, log = () => {} }) {
  if (!turno._carpetaPorCerrar) return { hecho: false };
  const g = await escribirCarpeta({ from: turno.quienEscribe, carpeta: turno.cliente, state, history, escribir: kv.escribir });
  if (!g.ok) log('warn', `carpeta del cliente sin reescribir al cerrar el turno (${g.error}); el folio ya estaba guardado`);
  return { hecho: true, ok: g.ok };
}

/**
 * RESET explícito: se vacían DURABLEMENTE las carpetas que el turno tocó, para que nada viejo resucite.
 *  · [L2 r10] la del cliente fijado (si no, el turno siguiente la restauraba);
 *  · [r11 #5 · Codex] la que estaba activa al llegar aunque ya no haya atribución (p. ej. el dueño
 *    tras un redeploy con la carpeta de Juan activa);
 *  · [r11 #5] la carpeta activa ahora, INCLUIDA la 'propia': la regla «un vacío no pisa una carpeta»
 *    (cambiarCarpeta) es para cambios de cliente; acá el vacío ES lo pedido. Sin esto, la propia
 *    durable con lo VIEJO reaparecía al volver de otro cliente.
 * @returns {Promise<{ok:boolean, error?:string}>} ok=false ⇒ quien llama NO confirma el RESET.
 */
export async function alResetear({ turno, state, previa = null, kv, log = () => {} }) {
  // Sin número completo no hay carpetas posibles (claveCarpeta lo rechaza): nada que vaciar.
  if (!completo(turno.quienEscribe)) return { ok: true };
  // [r13 #2 · Thermos] Un CLIENTE NORMAL (sin rol del equipo y sin carpeta de un cliente) resetea
  // como siempre: sin I/O de carpetas, así una falla del KV no le cambia la respuesta.
  const deCliente = (c) => !!c && c !== CARPETA_PROPIA;
  if (!turno.rol && !turno.atribucion && !deCliente(previa) && !deCliente(state?.carpeta_activa)) return { ok: true };
  const carpetas = new Set([state?.carpeta_activa || CARPETA_PROPIA]);
  if (previa) carpetas.add(previa);
  if (turno.atribucion) carpetas.add(turno.cliente);
  for (const carpeta of carpetas) {
    const g = await escribirCarpeta({ from: turno.quienEscribe, carpeta, state: {}, history: [], escribir: kv.escribir });
    if (!g.ok) {
      log('warn', `RESET: no pude vaciar la carpeta ${carpeta === CARPETA_PROPIA ? 'propia' : `…${String(carpeta).slice(-4)}`} (${g.error})`);
      return { ok: false, error: g.error };
    }
  }
  return { ok: true };
}

/** Lo que se dice si el RESET no pudo vaciar lo guardado (no se confirma «partimos de cero»). */
export const TEXTO_RESET_FALLIDO = '⚠️ No pude reiniciar la conversación del todo. Vuelve a mandar RESET en un minuto.';

/** Marcas de carpeta que se escriben DURANTE el turno y el estado que devuelve el cerebro no trae. */
export function conservarMarcas(newState, state) {
  if (state.carpeta_cerrada) newState.carpeta_cerrada = state.carpeta_cerrada;
}
