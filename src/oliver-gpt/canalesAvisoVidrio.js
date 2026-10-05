// src/oliver-gpt/canalesAvisoVidrio.js — [2026-10-05 · r8]
//
// LOS TRES CANALES con que `avisarVidrio` (services/vidrioCotizado.js) le avisa al dueño que una propuesta dice
// satén y se cotizó con vidrio claro: texto, plantilla y evento en el panel. UNA fábrica para WhatsApp
// (webhook.js) e IG/FB (channel-agent.js): antes cada archivo armaba su copia de los tres closures a 2.700 líneas
// de donde se resolvía la dependencia inyectable, y dos copias de una regla se desincronizan (ya pasó con la
// escalación). Cada canal solo dice quién es el cliente y por dónde escribe.
//
//  · texto(texto)                → `notifyFn` (highValueNotifier) al teléfono del dueño, con el prefijo `[canal]`
//                                   (que manda el aviso al inbox correcto en IG/FB).
//  · plantilla({folio, etiquetas}) → la plantilla aprobada de las escalaciones (escalation.js); pasa la ventana de 24 h.
//                                   `avisarVidrio` es dueño del folio: el closure ya no lo captura.
//  · panel({body, metadata})     → un evento de SISTEMA saliente en la conversación del cliente, como la escalación
//                                   #888 (webhook.js, `escalate.marcarAvisoFallido`). Devuelve lo que devuelve el
//                                   puente: `avisarVidrio` solo marca «ya puesto» si `ok === true`.
// Cada canal corre dentro del `safe` del llamador: si la dependencia lanza, devuelve null (que `avisarVidrio`
// lee como «lanzó») en vez de reventar el turno del cliente.

import { sendAvisoVidrioTemplate } from './escalation.js';
import { leer, escribir, reservar, liberarReserva } from '../../services/estadoPersistente.js';

/**
 * @param {object} p
 * @param {Function} p.safe        el `safe(rotulo, fn)` del llamador (devuelve null si `fn` lanza)
 * @param {object}   p.bridge      salesOsBridge (o el doble de los tests): `pushConversationEvent`
 * @param {string}   p.channel     'whatsapp' | 'instagram' | 'facebook'
 * @param {string}   p.externalId  el cliente del turno (en WhatsApp `turno.cliente`, no `from`; en IG/FB el id del remitente)
 * @param {string}   p.source      quién escribe el evento (`oliver_gpt_webhook` | `oliver_gpt_channel`)
 * @param {Function} p.notifyFn    `notifyHighValue(waSend, cliente, sesion, motivo)`
 * @param {Function} p.waSend      con qué se le escribe al dueño
 * @param {string}   p.cliente     el cliente del turno (el cooldown del texto es SUYO)
 * @param {object}   p.sesion      `{ data, history }` que lee el notificador
 * @param {Function} [p.plantillaFn]  `(folio, etiquetas) => Promise<respuesta de /admin/send-template>`; por defecto la real
 */
export function crearCanalesAvisoVidrio({
  safe, bridge, channel, externalId, source, notifyFn, waSend, cliente, sesion, plantillaFn = sendAvisoVidrioTemplate,
}) {
  return {
    texto: (texto) => safe('generarPdf.vidrio.aviso', () => notifyFn(waSend, cliente, sesion, `[${channel}] ${texto}`)),
    plantilla: ({ folio, etiquetas }) => safe('generarPdf.vidrio.plantilla', () => plantillaFn(folio, etiquetas)),
    panel: ({ body, metadata }) => safe('generarPdf.vidrio.panel', () => bridge.pushConversationEvent({
      channel, external_id: externalId, direction: 'outbound', actor_type: 'system',
      actor_name: 'Sistema', message_type: 'text', body,
      metadata: { source, ...metadata },
    })),
  };
}

/**
 * El almacén de «ya avisado» (reserva atómica + KV durable) que `avisarVidrio` recibe inyectado. Cada función cae
 * a la real de estadoPersistente.js si el llamador no inyectó la suya: la misma resolución `deps.X || X` que usa
 * webhook.js para sus otros avisos (los tests de webhook inyectan un almacén por test).
 */
export function almacenDeAvisos(deps = {}) {
  return {
    reservar: deps.reservarEstado || reservar,
    liberar: deps.liberarReserva || liberarReserva,
    leer: deps.leerEstado || leer,
    escribir: deps.escribirEstado || escribir,
  };
}
