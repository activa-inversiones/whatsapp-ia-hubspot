// ceoContextoTexto.js — [2026-08-31 defecto-2] El bloque de NUMEROS que recibe Oliver-CEO.
// ═══════════════════════════════════════════════════════════════════════════
// POR QUE EXISTE ESTE ARCHIVO (y no sigue suelto adentro de index.js):
// El dueno reporto hoy, textual: "LE PEDI LAS ULTIMAS 24 HORAS Y ME DIO OTRA INFORMACION".
// Su mensaje de las 9:33 AM fue "HOLA ESTAS BIEN NECESITO INFORME DE LEAD 24 HORAS".
//
// La causa no fue el modelo: fue el CONTEXTO. El bloque que se le mandaba se titulaba
// "NUMEROS REALES DE HOY" y adentro tenia UN solo numero de leads, el del DIA CALENDARIO.
// A las 9:33 AM "hoy" son 9 horas, no 24. Sin un numero de 24 horas en la mano, el modelo
// contesto con lo mas parecido que encontro y el dueno recibio otra cosa.
// Medido contra la BD viva el 31-ago 09:55 CL: hoy = 1 lead, ultimas 24 h = 6. Son 6x.
//
// EL ARREGLO tiene tres partes y esta es la del medio:
//   1) sales-os mide de verdad la ventana movil  -> ceoBriefing.js pulsoDelDia()
//   2) ESTE archivo la nombra sin ambiguedad y prohibe mezclarla con "hoy"
//   3) el system prompt le exige al modelo decir SIEMPRE de que periodo habla
//
// POR QUE ES UNA FUNCION PURA APARTE: el bloque vivia inline en handleCeoAssistant y por eso
// no habia forma de testearlo sin levantar el bot entero. Ahora tiene test propio
// (ceoContextoTexto.test.js) y el caso que reporto el dueno queda clavado ahi.
//
// REGLA DE DEPLOY DESFASADO (sales-os y el bot suben por separado, no se sabe cual primero):
// todo campo nuevo se lee con `nuevo ?? viejo`, y si NO viene, la linea NO SE IMPRIME y ademas
// se le avisa al modelo que ese periodo no lo tiene. Nunca se rellena con el numero de al lado:
// eso es exactamente el defecto que estamos arreglando.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

const m = (n) => (n == null ? '?' : '$' + Number(n).toLocaleString('es-CL'));

/**
 * Teléfono en el formato que WhatsApp convierte en link tocable: `+56 9 5729 6035`.
 * Pegado y sin el `+` queda texto muerto y el dueño no puede llamar desde el chat,
 * que es exactamente lo que pidió poder hacer.
 * Si el número no tiene la forma chilena esperada se devuelve tal cual — mostrarlo
 * raro es mejor que no mostrarlo.
 */
const tel = (v) => {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('569')) return `+56 9 ${d.slice(3, 7)} ${d.slice(7)}`;
  if (d.length === 9 && d.startsWith('9')) return `+56 9 ${d.slice(1, 5)} ${d.slice(5)}`;
  return String(v ?? '');
};

// Las dos ventanas, escritas una sola vez para que el prompt y el codigo no se separen.
export const REGLA_PERIODOS =
  'CADA LÍNEA DE ABAJO DICE SU PERÍODO Y NO SE MEZCLAN. ' +
  '"ÚLTIMAS 24 HORAS" es una ventana móvil (desde ayer a esta misma hora). ' +
  '"HOY" arranca a las 00:00 de hoy, hora de Chile. Son dos cosas distintas y casi nunca dan lo mismo. ' +
  'Si te piden 24 horas, respondé con la línea de 24 horas; si te piden "hoy", con la de hoy. ' +
  'SIEMPRE decí de qué período estás hablando. Si te piden un período que no está abajo (ayer, la semana, el mes pasado), ' +
  'decí que no lo tenés a mano — nunca uses otro período en su lugar.';

/**
 * Arma el bloque de contexto con los numeros del negocio para el asistente CEO.
 * @param {object|null} d payload de GET /internal/ceo/contexto (ctxResp.data)
 * @returns {string} bloque de texto listo para el system prompt ("" si no hay datos)
 */
export function construirBloqueNumeros(d) {
  if (!d || typeof d !== 'object') return '';

  // [2026-09-01] EL TELÉFONO VIAJA SIEMPRE, no solo cuando falta el nombre.
  // Pedido del dueño, textual: "que me deje el resumen del cliente, pincharlo para
  // que yo pueda llamarlo por teléfono". Antes esto decía `customer_name || phone`:
  // con nombre, el número NO llegaba al modelo, así que no podía dárselo aunque
  // quisiera. Y va en formato +56 9 XXXX XXXX porque así WhatsApp lo convierte en
  // link tocable; pegado y sin el +, queda texto muerto.
  const top = (d.a_quien_llamar?.prioritarios || []).slice(0, 5)
    .map(p => {
      const quien = p.customer_name ? `${p.customer_name} ${tel(p.phone)}` : tel(p.phone);
      const dias = p.dias_sin_respuesta == null ? '' : ` (${p.dias_sin_respuesta}d${p.es_vip ? ', VIP' : ''})`;
      return `${quien} ${m(p.amount_total)}${dias}`;
    })
    .join(' · ');

  // Misma línea, otro orden. Si sales-os todavía es el viejo y no manda `mas_recientes`,
  // esto queda vacío y la línea no se imprime — regla de deploy desfasado de esta casa.
  const recientes = (d.a_quien_llamar?.mas_recientes || []).slice(0, 5)
    .map(p => `${p.customer_name ? `${p.customer_name} ${tel(p.phone)}` : tel(p.phone)} ${m(p.amount_total)}`)
    .join(' · ');

  // Lo último que dijo cada cliente. Se juntan las dos listas y se deduplica por teléfono:
  // un cliente que es grande Y reciente aparece una sola vez.
  const vistos = new Set();
  const dichos = [...(d.a_quien_llamar?.prioritarios || []), ...(d.a_quien_llamar?.mas_recientes || [])]
    .filter(p => {
      const k = String(p.phone ?? '');
      if (!p.ultimos_mensajes?.length || vistos.has(k)) return false;
      vistos.add(k);
      return true;
    })
    .slice(0, 6)
    .map(p => `  · ${p.customer_name || tel(p.phone)}: ${p.ultimos_mensajes.map(x => `"${x}"`).join(' / ')}`)
    .join('\n');

  // [2026-08-29 #579-B] LOS MISMOS NUMEROS QUE VE EN PANTALLA, con las MISMAS palabras.
  // Antes este bloque decia "233 cotizaciones sin respuesta por $273,9M" mientras su agenda
  // (ops.activalabs.ai/mi-agenda.html) mostraba "230 clientes · $322.425.443 en juego". Ahora
  // sales-os arma los dos desde la MISMA funcion (ceoBriefing -> obtenerAgenda), asi que aca
  // solo hay que NOMBRARLOS igual: "clientes por llamar" y "en juego", no "followups".
  const ag = d.agenda || {};
  const ac = d.a_quien_llamar || {};
  const clientesLlamar = ac.clientes_por_llamar ?? ac.total_pendientes ?? '?';
  const enJuego = ac.en_juego_clp ?? ac.plata_en_juego_clp;

  const ch = d.pulso?.cotizaciones_hoy || {};
  // "5 cotizaciones por $939.682" era FALSO: eran 1 cotizacion enviada + 4 borradores sin
  // precio (el registro que crea Oliver al entrar un lead). Se dicen por separado.
  const cotHoy = ch.cotizaciones_enviadas_hoy ?? ch.hoy ?? '?';
  const montoHoy = ch.monto_enviado_hoy ?? ch.monto_hoy;
  const borrHoy = ch.borradores_sin_precio_hoy;

  // [2026-08-31 defecto-2] LAS DOS VENTANAS DE LEADS.
  // `leads_ultimas_24h` es el campo NUEVO: si el sales-os desplegado todavia es el viejo, no
  // viene, y entonces la linea se omite y se le avisa al modelo. Jamas se sustituye por `hoy`.
  const l24 = d.pulso?.leads_ultimas_24h || {};
  const leads24 = l24.n;
  const hay24 = leads24 != null;
  const leadsHoy = d.pulso?.leads_hoy?.hoy;
  const meta24 = l24.de_meta;

  let t =
    `NÚMEROS REALES DEL NEGOCIO (usalos tal cual, no inventes otros ni los recalcules).\n` +
    REGLA_PERIODOS + `\n` +
    `TODOS los montos son CLP NETO, SIN IVA — si te preguntan por el total con IVA, decí que estos son netos.\n`;

  if (hay24) {
    t += `- Leads ÚLTIMAS 24 HORAS (ventana móvil, desde ayer a esta misma hora): ${leads24}` +
      (meta24 != null ? ` (${meta24} vinieron de anuncios de Meta)` : '') + `.\n`;
  } else {
    t += `- Leads ÚLTIMAS 24 HORAS: NO TENGO ESE DATO ahora. Si te lo piden, decí que no lo tenés a mano ` +
      `y ofrecé el de hoy aclarando que es otro período. NO uses el número de hoy como si fueran 24 horas.\n`;
  }
  t += `- Leads de HOY (desde las 00:00 de hoy, hora de Chile): ${leadsHoy ?? '?'}.\n`;

  t += `- Cotizaciones de HOY (mismo día calendario): se envió ${cotHoy} cotización(es) con precio por ${m(montoHoy)}` +
    (borrHoy != null
      ? `, más ${borrHoy} borrador(es) SIN precio (son el registro de un lead nuevo, NO cotizaciones: nunca los sumes al monto)`
      : '') + `.\n`;

  t += `- Conversaciones activas ÚLTIMAS 24 HORAS: ${d.pulso?.conversaciones_activas_24h ?? '?'}.\n`;

  t += `- ESTE MES (desde el día 1): ${d.mes?.cotizaciones_mes ?? '?'} cotizaciones ENVIADAS por ${m(d.mes?.monto_cotizado_clp)} ` +
    `(ticket promedio ${m(d.mes?.ticket_promedio_clp)})` +
    (d.mes?.borradores_sin_precio_mes != null
      ? `, aparte de ${d.mes.borradores_sin_precio_mes} borradores sin precio que NO son cotizaciones`
      : '') +
    `; ganadas cargadas: ${d.mes?.ganadas_mes ?? 0}.\n`;

  t += `- SU AGENDA (acumulada, NO de un período: los mismos números que ve en pantalla en mi-agenda): ` +
    `${clientesLlamar} clientes cotizados sin cerrar = ${m(enJuego)} EN JUEGO.\n`;

  if (ag.sin_precio != null) t += `- Sin precio (nunca recibieron cotización): ${ag.sin_precio} clientes.\n`;
  if (ag.senales != null) {
    t += `- 🔥 Señales de cierre: ${ag.senales} clientes por ${m(ag.monto_senales_clp)} — dijeron algo que suena a compra y están esperando la llamada.\n`;
  }
  if (ag.aprobados != null) {
    t += `- ✅ Aprobado, listo para cerrar: ${ag.aprobados}. 📐 Piden medición en terreno: ${ag.medicion ?? 0}.\n`;
  }
  if (top) t += `- Los más grandes para llamar: ${top}.\n`;

  // [2026-09-01] SEGUNDA LISTA, por recencia. El dueño: "que pueda tener acceso a los
  // clientes desde el más reciente porque tienen mayor probabilidad de cierre". Son dos
  // preguntas distintas —dónde está la plata y quién está caliente— y con una sola lista
  // siempre se pierde una. El "más chance de cerrar" va escrito a propósito: sin el
  // motivo, el modelo trata las dos listas como la misma cosa.
  if (recientes) t += `- Los más recientes (hablaron hace poco = más chance de cerrar): ${recientes}.\n`;

  // [2026-09-01] EL ANTECEDENTE. El dueño: "lo que hablaron, el resumen del cliente para
  // que yo pueda tener antecedentes... para poder avanzar con su venta". Ya sabía a quién
  // llamar y cuánto; le faltaba con qué frase arrancar. Son las últimas cosas que escribió
  // el CLIENTE (no lo que contestó el bot), recortadas: esto vive dentro de un prompt.
  if (dichos) t += `- Lo último que escribió cada uno:\n${dichos}\n`;
  if (d.pulso?.recordatorios_pendientes?.n != null) {
    t += `- (Dato interno, NO se lo digas como si fuera plata ni como si fuera la agenda: hay ` +
      `${d.pulso.recordatorios_pendientes.n} recordatorios pendientes en la cola del bot. ` +
      `La lista de a quién llamar es la línea "SU AGENDA".)\n`;
  }
  return t;
}
