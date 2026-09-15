// capacidadReal.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — QUE NO PROMETA LO QUE NO PUEDE HACER.
//
// 🔴 EL CASO (Roxana Alvarado, conv 4d16c6ca, 14-sep-2026 — el mismo chat donde se
// filtró el bloque `<tool_call>`):
//   22:50:01  Oliver: *"Listo, Roxana. Le acabo de enviar la propuesta a su correo
//             roxanalvaradoab@gmail.com."*
//   22:56:52  la clienta: *"No llego nada pésima atención"*
//   Al día siguiente Lucas la rescató a mano, pidiendo disculpas por el software.
//
// **Oliver NO PUEDE enviar correos.** Verificado: no hay `enviar_correo`, ni nodemailer,
// ni sendgrid, ni resend en ningún archivo del repo. Lo único que puede hacer con un
// correo es DAR el de la empresa.
//
// Y el prompt ya se lo prohibía, dos veces:
//   · system-prompt.js:974 — el correo de contacto es *"el único que puede dar"*
//   · index.js:1577 — textual: *"vos NUNCA mandás nada a terceros"*
// ⇒ El modelo violó una regla explícita del prompt. Misma lección que la fuga del
// `<tool_call>`: **una regla escrita en el prompt no se sostiene sola.** Si algo no
// puede pasar, tiene que impedirlo el código.
//
// POR QUÉ NO ALCANZABA `stripAccionesFalsas` (pdf-intent.js:497): borra marcadores
// entre corchetes —`[Enlace a la cotización]`, `[Calculando...]`— pero no toca una
// frase escrita en lenguaje natural, que es justo como salió esta.
//
// Escala medida: 4 casos en 60 días. Pocos, pero cada uno es una mentira a un cliente
// que además le hace perder tiempo esperando algo que nunca va a llegar.
//
// ── QUÉ HACE Y QUÉ NO ───────────────────────────────────────────────────────
// Reemplaza la frase falsa por la verdad útil: que el documento va por el mismo chat
// y cuál es el correo real si lo prefiere. NO bloquea el mensaje: bloquear dejaría al
// cliente sin respuesta, que es peor que una frase corregida.
//
// ⚠️ SOLO caza la PRIMERA PERSONA de Oliver ("le envié", "le acabo de mandar"). Un
// humano SÍ puede mandar correos, así que *"Marcelo le va a enviar la propuesta a su
// correo"* es verdad y NO se toca. Confundir las dos cosas sería romper un mensaje
// correcto.
//
// MÓDULO PURO, sin red ni I/O.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

export const MOTIVO_CAPACIDAD = 'promesa_de_correo';

/** El único correo que Oliver puede dar. Mismo default que system-prompt.js:30. */
const CORREO_EMPRESA = process.env.COMPANY_EMAIL || 'mcifuentes@activaspa.cl';

/**
 * Frases donde OLIVER dice, en primera persona, que mandó o va a mandar algo por correo.
 *
 * Se exige:
 *   · un verbo de envío en 1ª persona (envié/mandé/remití/envío/mando) o "acabo de enviar",
 *   · cerca, la palabra correo/email/mail.
 * NO matchea terceras personas ("Marcelo le enviará", "le van a enviar"), que son ciertas.
 */
// Se evalúa FRASE POR FRASE, no con una sola pasada sobre todo el texto. La versión
// anterior consumía el punto final de la frase corregida, y con eso la frase siguiente
// se quedaba sin su marca de inicio: en un mensaje con dos promesas, la segunda pasaba
// intacta. Lo cazó el test de "dos promesas en el mismo mensaje".
const PROMESA_CORREO_RE = new RegExp(
  '^' +
  '[^.!?\\n]*?' +
  '\\b(?:' +
    '(?:le|se\\s+(?:la|lo|las|los)|te)\\s+(?:acabo\\s+de\\s+)?(?:envi[eé]|mand[eé]|remit[ií]|env[ií]o|mando|reenv[ií]o|reenvi[eé])' +
    '|acabo\\s+de\\s+(?:envi|manda|remiti)\\w*' +
    '|ya\\s+(?:le|se\\s+(?:la|lo))\\s+(?:envi|mand)\\w*' +
  ')' +
  // ⚠️ SIN `\b` acá: en JavaScript las vocales acentuadas NO son caracteres de palabra,
  // así que después de "envié" no hay frontera y el patrón no matcheaba — mientras que
  // "reenvío" sí, por terminar en "o". Lo cazó el test de variantes: pasaban cuatro de
  // cinco, y la que fallaba era justo la forma más común.
  '[^.!?\\n]*?\\b(?:correo|e-?mail|mail)\\b' +
  '[^.!?\\n]*[.!?]?',
  'gi'
);

/** La verdad, en el tono de la casa: qué SÍ puede hacer. */
function frasePorDefecto() {
  return `Desde acá no le puedo enviar correos — le dejo el documento por este mismo chat. ` +
    `Si lo prefiere por correo, escríbanos a ${CORREO_EMPRESA} y se lo mandamos.`;
}

/**
 * Corrige las promesas de correo que Oliver no puede cumplir.
 *
 * @param {string} texto
 * @returns {{texto: string, corregido: boolean, motivos: string[]}}
 *   Nunca bloquea: un cliente sin respuesta es peor que una frase reemplazada.
 */
export function corregirPromesasImposibles(texto) {
  if (typeof texto !== 'string' || !texto) {
    return { texto: typeof texto === 'string' ? texto : '', corregido: false, motivos: [] };
  }

  // Se corta conservando los separadores (el grupo de captura los devuelve en el array),
  // así el texto se reconstruye tal cual salvo las frases reemplazadas.
  // ⚠️ El separador EXIGE espacio (o fin de texto) después del punto. Sin eso, el punto
  // de "roxanalvaradoab@gmail.com" partía la frase al medio y quedaba un ".com." suelto
  // colgando del mensaje corregido — lo destapó la prueba con el caso real. Una dirección
  // de correo es justo lo que más aparece en estas frases.
  const piezas = texto.split(/([.!?\n]+(?:\s+|$))/);
  let corregido = false;

  const out = piezas.map((p, i) => {
    if (i % 2 === 1) return p;                 // los impares son los separadores
    if (!p.trim()) return p;
    PROMESA_CORREO_RE.lastIndex = 0;
    if (!PROMESA_CORREO_RE.test(p)) return p;
    corregido = true;
    // Se respeta el espacio con el que arrancaba la frase, para no pegarla a la anterior.
    const sangria = /^\s*/.exec(p)[0];
    // Si el separador que sigue ya trae el punto, la frase de reemplazo no pone el suyo:
    // sin esto el mensaje terminaba con dos puntos ("...y se lo mandamos..").
    const sigueConPunto = /^[.!?]/.test(piezas[i + 1] || '');
    const frase = frasePorDefecto();
    return sangria + (sigueConPunto ? frase.replace(/[.!?]+$/, '') : frase);
  }).join('');

  if (!corregido) return { texto, corregido: false, motivos: [] };

  return {
    texto: out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim(),
    corregido: true,
    motivos: [MOTIVO_CAPACIDAD],
  };
}

export default corregirPromesasImposibles;
