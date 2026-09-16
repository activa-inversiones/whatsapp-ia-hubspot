// services/conciliacionDudosa.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA IMPERIUM — CERRAR UN CASO DUDOSO SIN ADIVINAR
//
// POR QUÉ EXISTE. Cuando un envío a Meta queda en resultado DESCONOCIDO (timeout), el
// sistema no reenvía —regla del dueño, *"2 veces la misma no se puede"*— y le avisa a él.
// Pero eso le deja UN TRABAJO: abrir el chat del cliente y mirar si el documento está.
//
// Kimi, compuerta del diseño (16-sep): *"la idempotencia por command_id es decorativa y la
// conciliación es el mecanismo real"*. Acá está esa conciliación, en su versión honesta.
//
// 🔴 EL PROBLEMA DE FONDO, DICHO DE FRENTE: un timeout NO devuelve `wamid`. Sin ese id no
// se puede cruzar el acuse con el envío, que es como se concilia todo lo demás. Lo único
// que queda es el TELÉFONO, que el acuse sí trae (`recipient_id`).
//
// Entonces esto NO afirma que el documento llegó. Afirma algo más chico y verdadero:
// *"Meta confirmó una entrega a este cliente a tal hora, y nosotros no tenemos registro de
// haberle mandado otra cosa"*. Es EVIDENCIA para que el dueño decida en cinco segundos en
// vez de abrir el chat — no un veredicto automático.
//
// Por eso tampoco suelta el candado: si el documento llegó, no hay nada que reenviar; y si
// no llegó, quien decide reenviar sigue siendo una persona. El mismo criterio que ya está
// escrito en `entregaArbitro.js`: wamid exacto cierra, wamid desconocido es sólo evidencia.
//
// MÓDULO PURO: sin red, sin base, sin reloj propio.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

/**
 * Cuánto después de un envío dudoso un acuse todavía puede ser DE ESE envío.
 * Meta entrega los acuses en segundos o minutos; dos horas es holgado y acota el riesgo
 * de atribuirle a un documento viejo un acuse que era de otra cosa.
 */
export const VENTANA_MS = 2 * 3600_000;

/** La llave del índice. Existe porque las huellas de candado NO se pueden enumerar. */
export function clavePendiente(telefono, tipo) {
  return `dudoso_pend:${String(telefono || '').replace(/\D/g, '')}:${tipo || 'doc'}`;
}

/**
 * ¿Este acuse sirve como evidencia para este caso dudoso?
 *
 * @param {{at:number, folio?:string, tipo?:string}} pendiente  lo que dejó el envío dudoso
 * @param {{estado:string, msgId:string, telefono:string}} acuse
 * @param {number} ahora
 * @returns {{sirve: boolean, motivo: string}}
 */
export function decidirConciliacion(pendiente, acuse, ahora = Date.now(), ventanaMs = VENTANA_MS) {
  if (!pendiente || !Number.isFinite(Number(pendiente.at))) {
    return { sirve: false, motivo: 'sin_caso_pendiente' };
  }
  if (!acuse || acuse.estado !== 'delivered') {
    // `sent` no prueba nada (Meta lo acepta y puede fallar después) y `read` ya implica
    // delivered, pero llega sólo si el cliente abre el chat: no se puede depender de eso.
    return { sirve: false, motivo: 'no_es_entrega_confirmada' };
  }
  const desde = ahora - Number(pendiente.at);
  // Un acuse ANTERIOR al envío dudoso no puede ser de ese envío. Pasa con relojes
  // desfasados y con reentregas tardías de webhooks viejos.
  if (desde < 0) return { sirve: false, motivo: 'acuse_anterior_al_envio' };
  if (desde > ventanaMs) return { sirve: false, motivo: 'fuera_de_ventana' };
  return { sirve: true, motivo: 'entrega_confirmada_al_mismo_cliente' };
}

/**
 * El mensaje de cierre para el dueño. Sigue al aviso de entrega dudosa.
 *
 * ⚠️ Está escrito para que NO se lea como una certeza. El dueño toma decisiones con esto:
 * si dijera "ya llegó" y no hubiera llegado, el cliente se queda sin documento y con él
 * convencido de lo contrario.
 */
export function mensajeConciliado({ tipo, folio, nombre } = {}) {
  const quien = String(nombre || '').replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();
  return [
    '✅ *Actualización de la entrega sin confirmar*',
    `• Cliente: ${quien || 'sin nombre registrado'}`,
    `• Documento: ${tipo || 'documento'} ${folio || 'sin folio'}`,
    '',
    'Meta confirmó una entrega a este cliente después de ese envío, y no tenemos registro',
    'de haberle mandado otra cosa en ese rato: lo más probable es que SÍ le haya llegado.',
    'No se reenvió nada.',
  ].join('\n');
}

export default decidirConciliacion;
