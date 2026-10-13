// turnoDeterminista.js — [#1505 · 13-oct, Thermos calidad] cierre de un TURNO DETERMINISTA del webhook (sin cerebro).
// Hoy el webhook tiene cuatro copias del mismo patrón (reset, anti-loop de imágenes, escalación y la compuerta de ruido):
// persistir el inbound → contestar → persistir el outbound → esperar la atribución → guardar sesión → log → return.
// Este módulo nace con la compuerta de ruido; migrar las otras tres copias es un lote aparte (regla de mirar antes:
// llevan meses funcionando). Todo inyectado: no importa el webhook ni la red.

import { debeAvisar, RESPUESTA_RUIDO, RESPUESTA_CUARENTENA } from './ruido.js';

/**
 * Lo que pasa cuando decidirEntrada/decidirAudio dicen «ruido» o «cuarentena».
 * El mensaje queda en el cockpit marcado (ruido:true / cuarentena:true + motivo + archivo {id, filename, mime}: el operador
 * puede bajarlo a mano desde Meta con el id), Oliver contesta UNA vez por número cada 24 h (reloj aparte para ruido y
 * cuarentena), NO se crea lead, NO se llama al LLM, NO se avisa al dueño. Nada se descarga.
 * @returns {Promise<{accion:string, motivo:string, avisado:boolean}>}
 */
export async function aplicarCompuertaRuido({ dec, from, msgId, inbound, state, history, bridge, sendWhatsAppText, conv, persistSessionFn, deps, landingAttributionReady, safe, log, ahora = Date.now }) {
  const esCuarentena = dec.accion === 'cuarentena';
  const nombre = dec.archivo?.filename || 'sin nombre';
  const mime = dec.archivo?.mime || 'tipo desconocido';
  await safe('ruido.persistIn', () => bridge.pushConversationEvent({
    channel: 'whatsapp', external_id: from /* [chat] mensaje del chat */, direction: 'inbound', actor_type: 'customer', actor_name: 'Cliente',
    message_type: inbound.type || 'text',
    body: esCuarentena ? `[archivo en cuarentena: ${nombre} · ${mime}]` : (inbound.text || `[${inbound.type || 'mensaje'}]`),
    metadata: { source: 'oliver_gpt_webhook', msg_id: msgId, ruido: !esCuarentena, cuarentena: esCuarentena, motivo: dec.motivo,
      ...(dec.archivo ? { archivo: dec.archivo } : {}) },
  }));
  let avisado = false;
  // [Copilot r2] una respuesta por número cada 24 h, con reloj aparte para la cuarentena (5 archivos ≠ 5 respuestas).
  const claveAviso = esCuarentena ? 'cuarentena_aviso_at' : 'ruido_aviso_at';
  if (debeAvisar(state, ahora(), undefined, claveAviso)) {
    const texto = esCuarentena ? RESPUESTA_CUARENTENA : RESPUESTA_RUIDO;
    const r = await safe('ruido.send', () => sendWhatsAppText(from, texto));
    avisado = Boolean(r && r.ok !== false);
    if (avisado) {
      state[claveAviso] = ahora();
      await safe('ruido.persistOut', () => bridge.pushConversationEvent({
        channel: 'whatsapp', external_id: from /* [chat] mensaje del chat */, direction: 'outbound', actor_type: 'ai', actor_name: 'Oliver IA',
        message_type: 'text', body: texto, metadata: { source: 'oliver_gpt_webhook', ruido_respuesta: true, motivo: dec.motivo },
      }));
    }
  }
  await landingAttributionReady;
  state.lastMessageAt = ahora();
  conv.set(from, { history, state });
  persistSessionFn(from, { history, state }, deps);
  log('warn', 'ruido', `${dec.accion} (${dec.motivo}) para …${String(from).slice(-4)}${avisado ? ' · avisado' : ' · sin aviso (ya se avisó en 24 h)'}`);
  return { accion: dec.accion, motivo: dec.motivo, avisado };
}
