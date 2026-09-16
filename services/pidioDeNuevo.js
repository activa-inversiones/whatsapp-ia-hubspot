// services/pidioDeNuevo.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA IMPERIUM — "NO ME LLEGÓ": el destrabe que lo pide el cliente
//
// POR QUÉ EXISTE. Cuando un envío a Meta queda en resultado DESCONOCIDO (timeout), el
// sistema NO reenvía solo: reenviar lo que quizá llegó le manda al cliente el mismo
// documento dos veces, y eso el dueño lo prohibió textualmente —
// *"2 veces la misma no se puede es una falta de respeto al cliente"*.
//
// Pero el dueño tiene OTRA regla, igual de explícita: *"a todos los clientes que se le
// cotiza le llega el informe térmico, informe de vientos y la cotización"*. Las dos chocan
// justo acá, y la salida que eligió (16-sep) es esta: **no se reenvía solo NUNCA, y el
// cliente puede destrabarlo** — porque él es el único que sabe si le llegó.
//
// 🔴 EL RIESGO DE ESTE MÓDULO ES EL FALSO POSITIVO, NO EL FALSO NEGATIVO.
// Si no detecta, el cliente insiste o el dueño lo ve en el aviso: se pierde tiempo.
// Si detecta de más, se le reenvía un documento a alguien que YA lo tiene — o sea, este
// módulo se convierte en la causa del duplicado que vino a evitar. Por eso:
//   · un "no" pelado NUNCA alcanza;
//   · "ya me llegó" y "llegó perfecto" tienen que quedar afuera, aunque contengan "llegó";
//   · sólo dispara con una negación de recepción, o con un pedido explícito de reenvío.
//
// MÓDULO PURO: sin red, sin estado, sin reloj.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

/** Quita tildes y normaliza, para que "no me llegó" y "no me llego" sean lo mismo. */
function normalizar(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lo que dice que SÍ lo tiene. Se evalúa PRIMERO y manda.
 *
 * ⚠️ HONESTIDAD SOBRE QUÉ HACE ESTA LISTA HOY, porque el comentario anterior la vendía de
 * más. Se MIDIÓ (16-sep) desactivándola: ninguna de las ~60 frases de prueba cambia de
 * veredicto, sólo cambia el `motivo`. Lo que de verdad evita el falso positivo es que
 * `NO_LE_LLEGO` exige una NEGACIÓN explícita, así que "ya me llegó" no entra igual.
 *
 * Se deja igual, y a propósito: el día que alguien agregue a `NO_LE_LLEGO` un patrón que
 * matchee "llegó" sin el "no" —que es la forma natural de aflojar este detector— esta
 * lista es lo único que impide reenviarle el documento a quien acaba de agradecerlo. Es
 * defensa para el cambio futuro, no una guardia que esté atajando algo hoy.
 */
const YA_LO_TIENE = [
  /\b(ya|si|sii+|perfecto|gracias)\b[^.]{0,20}\b(llego|lleg[oó]|recibi|recibido|lo tengo|la tengo)\b/,
  /\b(llego|llegaron)\b[^.]{0,15}\b(bien|perfecto|todo|gracias|ok)\b/,
  /\bya (lo|la|los|las) (tengo|recibi|vi|abri)\b/,
  /\bgracias\b.{0,15}\b(llego|recibi)\b/,
];

/** Negación de recepción: "no me llegó", "no lo recibí", "no me aparece", "no veo nada". */
const NO_LE_LLEGO = [
  /\bno (me |nos |le )?(ha |han )?(llego|llegado|llegaron)\b/,
  /\bno (lo|la|los|las) (he |hemos )?(recibi|recibido|recibimos)\w*\b/,
  // "no recibi nada" / "no he recibido": sin objeto delante. Va DESPUES de YA_LO_TIENE,
  // que es quien salva a "ya lo recibi" y "perfecto, lo recibi" de caer aca.
  /\bno (he |hemos )?recib\w*\b/,
  /\bno (me |nos )?(aparece|figura|sale|abre|carga)\b/,
  /\bno (veo|encuentro|tengo)\b[^.]{0,25}\b(nada|archivo|pdf|documento|informe|propuesta|cotizacion|adjunto)\b/,
  /\bno (me |nos )?(mandaste|mando|enviaste|envio|enviaron)\b/,
  /\bno (me |nos )?lleg\w*\b/,
];

/** Pedido explícito de reenvío. No necesita negación: ya dice qué quiere. */
const PIDE_REENVIO = [
  /\b(reenvia|reenviar|reenvie|reenviame|reenviamelo|reenviamela)\w*\b/,
  /\b(manda|mandame|envia|enviame|mande|envie|pasame|pasa)\w*\b[^.]{0,25}\b(de nuevo|otra vez|nuevamente|denuevo)\b/,
  /\b(de nuevo|otra vez|nuevamente|denuevo)\b[^.]{0,25}\b(manda|mandame|envia|enviame|mandar|enviar|pasar)\w*\b/,
  /\bme (lo|la|los|las) (puede|podria|podes|puedes)\b[^.]{0,20}\b(reenviar|mandar|enviar|pasar)\b/,
  /\bvuelve a (mandar|enviar|pasar)\w*\b/,
];

/**
 * ¿El cliente está diciendo que NO le llegó, o pidiendo que se le reenvíe?
 *
 * @param {string} texto  lo que escribió el cliente
 * @returns {{pidio: boolean, motivo: string}}  `motivo` sirve para el log y para el test
 */
export function pidioDeNuevo(texto) {
  const t = normalizar(texto);
  if (!t) return { pidio: false, motivo: 'vacio' };

  // Manda lo que confirma recepción: ante la duda, NO se reenvía.
  for (const re of YA_LO_TIENE) {
    if (re.test(t)) return { pidio: false, motivo: 'confirma_que_lo_tiene' };
  }
  for (const re of NO_LE_LLEGO) {
    if (re.test(t)) return { pidio: true, motivo: 'dice_que_no_le_llego' };
  }
  for (const re of PIDE_REENVIO) {
    if (re.test(t)) return { pidio: true, motivo: 'pide_reenvio' };
  }
  return { pidio: false, motivo: 'no_corresponde' };
}

export default pidioDeNuevo;
