// services/atribucionTurno.js — lo que la atribución le hace a UN turno de Oliver, en dos momentos:
//   · alEntrar   → la carpeta del cliente (cambiar, recuperar su folio, avisar si quedó algo guardado);
//   · trasEmitir → cuando Meta ACEPTA el envío del PDF: guardar el folio en la carpeta del cliente,
//                  consumir la atribución y decir cómo corregir. UNA vez por turno aunque salgan
//                  varios PDF (alternativas A/B/C).
// La foto de la atribución es `turno` (identidadCotizacion.resolverTurno): nadie la relee.

import { cambiarCarpeta, escribirCarpeta, leerCarpeta, CARPETA_PROPIA } from './sesionCarpetas.js';
import { limpiarSiMisma } from './atribucionStore.js';
import { mensajeTrasPdf } from './comandoCliente.js';

/**
 * @param {{turno:object, state:object, history:Array, kv:{leer,escribir}, log?:Function}} o
 * @returns {Promise<{mov:'igual'|'cambio'|'error', error?:string, aviso?:string}>}
 */
export async function alEntrar({ turno, state, history, kv, log = () => {} }) {
  const a = turno.atribucion;
  const previa = state.carpeta_activa || CARPETA_PROPIA;

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
  if (mov.mov === 'error') return mov;

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
  return aviso && mov.mov === 'cambio' ? { ...mov, aviso } : mov;
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
  try { await enviar(mensajeTrasPdf(a)); } catch { /* el aviso no tumba el turno */ }
  return { hecho: true, consumida: true };
}
