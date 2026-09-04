// src/oliver-gpt/captionInforme.js — [2026-09-04]
// ═══════════════════════════════════════════════════════════════════════════
// EL CLIENTE TIENE QUE SABER QUE LE ESTAMOS MANDANDO.
//
// Pedido del dueño, textual: *"debemos indicarle a cliente antes lo que le enviamos porque
// no sabe que tiene el archivo adentro"*.
//
// 🔴 QUE PASABA: al informe termico lo acompanaba `Informe termico de Vilcun` y al de vientos
// `Informe de vientos de sus ventanas`. Una linea. El cliente recibe un PDF de varias paginas
// —zona termica segun NCh 1079, transmitancia maxima admisible, condensacion, el veredicto de
// SU ventana, isotermas del calculo— y no tiene forma de saber que hay ahi adentro. Un
// documento que no se sabe para que sirve no se abre, y si no se abre no vendio nada.
//
// ⚠️ VA EN EL CAPTION, NO EN UN MENSAJE APARTE, Y ES DELIBERADO. Un mensaje previo suma otra
// pieza a la secuencia — justo lo que se acaba de arreglar (54 rafagas de hasta 12 piezas
// seguidas, con el cliente escribiendo 3 minutos antes de que el bot parara). El caption viaja
// PEGADO al documento: el cliente se entera sin recibir un mensaje mas.
//
// ⚠️ SOLO SE PROMETE LO QUE EL DOCUMENTO TRAE. Es la regla que ya regia el caption de vientos
// ("el caption promete clima SOLO si el bloque vino del motor") y aca se extiende al termico:
// si no hay veredicto de Uw, no se nombra; si no hay isotermas, no se nombran. Prometer una
// seccion que el PDF no tiene es peor que no describirlo — el cliente lo abre buscando algo
// que no esta.
//
// LIMITE: WhatsApp corta el caption de un documento cerca de los 1.024 caracteres. Estos
// textos rondan los 300, con aire de sobra.
// ═══════════════════════════════════════════════════════════════════════════

/** Tope de WhatsApp para el caption de un documento. */
export const MAX_CAPTION = 1024;

const recortar = (t) => (t.length <= MAX_CAPTION ? t : `${t.slice(0, MAX_CAPTION - 1)}…`);

/**
 * Que dice el mensaje que acompana al INFORME TERMICO.
 *
 * @param {object} o
 * @param {string} o.comuna
 * @param {boolean} o.tieneUwNorma   hay tope de transmitancia de la norma para esa comuna
 * @param {boolean} o.tieneVeredicto se calculo el Uw de LA ventana del cliente
 * @param {boolean} o.tieneCondensacion
 * @param {boolean} o.tieneIsotermas
 * @param {boolean} o.esReferenciaRegional  los datos son de una comuna de referencia, no la suya
 */
export function captionTermico({
  comuna = '', tieneUwNorma = false, tieneVeredicto = false,
  tieneCondensacion = false, tieneIsotermas = false, esReferenciaRegional = false,
} = {}) {
  const donde = String(comuna || '').trim();
  const partes = [
    `📄 *Informe técnico térmico${donde ? ` — ${donde}` : ''}*`,
    'Le explico qué encontrará adentro:',
  ];

  const items = [];
  // La zona termica va siempre: es la base del documento y no depende de ningun calculo.
  items.push(`• La zona térmica que le corresponde según la norma chilena NCh 1079${donde ? ` en ${donde}` : ''}.`);
  if (tieneUwNorma) items.push('• El máximo de transmitancia (Uw) que la norma permite ahí.');
  if (tieneVeredicto) items.push('• El cálculo de *su* ventana y si cumple ese máximo.');
  if (tieneCondensacion) items.push('• A qué temperatura se condensaría, para que sepa si va a "llorar".');
  if (tieneIsotermas) items.push('• El corte del cálculo, para que vea por dónde se escapa el calor.');

  partes.push(items.join('\n'));
  if (esReferenciaRegional) {
    // Honestidad: si los datos son de una comuna de referencia, se dice ANTES de que lo lea
    // adentro y sienta que se lo escondimos.
    partes.push('_Los datos climáticos son de la comuna de referencia más cercana con estación medida._');
  }
  partes.push('Es un documento formal, con folio, que puede presentar donde lo necesite.');
  return recortar(partes.join('\n\n'));
}

/**
 * Que dice el mensaje que acompana al INFORME DE VIENTOS.
 *
 * @param {object} o
 * @param {string}  o.comuna
 * @param {boolean} o.tieneClima  el bloque de clima vino del motor (regla previa, se conserva)
 * @param {number}  o.nVentanas   cuantas ventanas se calcularon
 */
export function captionVientos({ comuna = '', tieneClima = false, nVentanas = 0 } = {}) {
  const donde = String(comuna || '').trim();
  const n = Number(nVentanas) || 0;
  const partes = [
    `📄 *Informe de vientos${tieneClima ? ' y clima' : ''}${donde ? ` — ${donde}` : ''}*`,
    'Le explico qué encontrará adentro:',
  ];
  const items = [
    `• La presión de viento que tiene que resistir ${n === 1 ? 'su ventana' : n > 1 ? `sus ${n} ventanas` : 'su ventana'} en esa ubicación.`,
    '• Si el sistema que le cotizamos aguanta esa presión.',
  ];
  if (tieneClima) items.push('• El clima del lugar: temperaturas, humedad y radiación.');
  partes.push(items.join('\n'));
  partes.push('Es un documento formal, con folio, que puede presentar donde lo necesite.');
  return recortar(partes.join('\n\n'));
}

export default { captionTermico, captionVientos, MAX_CAPTION };
