// ruido.js — [#1505 · 13-oct] COMPUERTA DE RUIDO del WhatsApp de Oliver (reclamo del dueño 12-oct, textual: «llegan muchas
// personas que pasaron a llevar el mensaje, celular en el bolsillo, niños jugando, no son clientes; además envían links o
// archivos que podrían ser peligrosos»). Medido 7 d: 122 conversaciones, 36 «ruido probable», 14 con links, 3 documentos.
// Medido 30 d sobre el PRIMER mensaje de 353 conversaciones: 336 texto normal, 3 solo link, 2 cortitos, 1 sticker, 1 reacción,
// 1 contactos, 1 imagen, 2 audio.
//
// Qué decide (PURO, sin red, sin estado; el webhook aplica):
//   1. PRIMER CONTACTO (sin historial) que llega sin texto con intención —sticker, reacción, «unsupported», texto vacío o de
//      1-2 caracteres sin sentido, SOLO un link, o un audio que se transcribió y no dijo nada— es RUIDO: Oliver contesta UNA
//      vez por número cada 24 h pidiendo que escriba qué necesita, NO crea lead, NO llama al cerebro, NO le llega al dueño.
//      El mensaje queda en el cockpit marcado `ruido:true` (se cuenta en el brief). Con el primer texto con intención entra
//      al embudo normal.
//   2. ARCHIVOS PELIGROSOS (ejecutables, scripts, macros de Office, comprimidos, html, apk, accesos directos…) van a
//      CUARENTENA SIEMPRE, sea quien sea: no se descargan ni se reenvían; quedan nombre, tipo y el media id en el cockpit por si
//      el operador decide bajarlo a mano. PDF, Excel, Word, imágenes y audios siguen como hoy (se guardan y se procesan).
//   3. Un cliente con historial NUNCA pasa por la compuerta de ruido (ya es cliente): solo le aplica la cuarentena.
//
// r2 (13-oct, Copilot + NIM): lo que NO es ruido aunque sea el primer mensaje, porque un cliente real lo manda así:
//   · una FOTO sin texto (la ventana), una UBICACIÓN («estoy en Labranza»), un VIDEO, un CONTACTO, una REACCIÓN → siguen al cerebro;
//   · un BOTÓN o un INTERACTIVE (respuesta a una plantilla) → siguen siempre;
//   · «ok», «sí», «no», «ya», «dale» (respuesta corta a una plantilla que no está en el historial del bot) → siguen;
//   · un AUDIO con la transcripción CAÍDA → sigue (el cerebro ya pide texto en ese caso); solo el audio que SÍ se transcribió y
//     no dijo nada es ruido;
//   · un documento PDF/XLSX/DOCX en el primer contacto → sigue (un plano real es el caso de uso); solo lo peligroso va a cuarentena.
// Lo que NO hace: no decide por contenido con IA, no bloquea números, no borra nada. Killswitch: RUIDO_COMPUERTA=off.

export const VERSION = '1.1.0';

// Tipos de Meta que en un primer contacto no traen intención. Ubicación/contacto/video NO están: los manda gente real.
// [Codex r2] una REACCIÓN tampoco: casi siempre es a un mensaje nuestro (plantilla del operador que el bot no tiene en su historial).
export const TIPOS_SIN_INTENCION = new Set(['sticker', 'unsupported', 'unknown']);

// Extensiones y MIME que NUNCA se descargan (podrían ejecutarse o traer macros en el PC del dueño o del operador).
export const EXT_PELIGROSAS = /\.(exe|msi|msix|appx|bat|cmd|ps1|psm1|vbs|vbe|vb|js|jse|wsf|wsh|ws|scr|com|pif|cpl|jar|apk|ipa|lnk|url|iso|img|vhd|vhdx|dmg|pkg|deb|rpm|zip|rar|7z|gz|bz2|xz|tar|tgz|cab|htm|html|hta|chm|svg|reg|sh|dll|xll|docm|dotm|xlsm|xlsb|xlam|pptm|potm|rtf)$/i;
export const MIME_PELIGROSOS = /(x-msdownload|x-msdos-program|x-executable|x-sh|x-shellscript|javascript|x-java-archive|vnd\.android\.package-archive|application\/zip|x-zip-compressed|x-rar|x-7z|gzip|x-bzip|x-xz|x-tar|text\/html|x-msi|x-ms-shortcut|vnd\.ms-(excel|word|powerpoint)\.[a-z]+\.macroenabled|rtf|x-ms-application)/i;

// Un link con nada más alrededor (o con 1-2 palabras sueltas como «mira», «jaja»). [Thermos r2] Solo cuenta como link lo que
// trae esquema, «www.» o «wa.me/»: un dominio pelado («ventanas.cl») o un correo son texto de una persona, no un link suelto.
const URL_UNA = /(https?:\/\/\S+|www\.\S+|wa\.me\/\S+)/i;
const URL_TODAS = /(https?:\/\/\S+|www\.\S+|wa\.me\/\S+)/gi;
const PALABRAS_CORTAS_CON_INTENCION = new Set(['ok', 'si', 'sí', 'no', 'ya', 'dale', 'va', 'oka', 'oki']);

export function esSoloLink(texto) {
  const t = String(texto || '').trim();
  if (!t || !URL_UNA.test(t)) return false;
  const resto = t.replace(URL_TODAS, ' ').replace(/[\s\p{P}\p{S}]+/gu, ' ').trim();
  return resto.split(/\s+/).filter(Boolean).length <= 2;
}

/** Texto sin intención: vacío, solo signos/emojis, o 1-2 caracteres que no son una respuesta («k», «?», «👍», «...»). */
export function esTextoVacio(texto) {
  const t = String(texto || '').replace(/[\s\p{P}\p{S}\p{Extended_Pictographic}️]+/gu, '').trim();
  if (PALABRAS_CORTAS_CON_INTENCION.has(t.toLowerCase())) return false;
  return t.length <= 2;
}

export function esArchivoPeligroso({ filename = '', mime = '' } = {}) {
  return EXT_PELIGROSAS.test(String(filename || '').trim()) || MIME_PELIGROSOS.test(String(mime || '').trim());
}

/**
 * Decide qué hacer con un mensaje entrante ANTES de descargar nada y antes del cerebro.
 * @param {{ inbound:{type?:string, text?:string}, raw?:object, history?:Array, env?:object }} p
 *   raw = el mensaje crudo de Meta (raw.document.id / filename / mime_type).
 * @returns {{ accion:'seguir'|'ruido'|'cuarentena', motivo?:string, archivo?:{id:string, filename:string, mime:string} }}
 */
export function decidirEntrada({ inbound = {}, raw = null, history = [], env = process.env } = {}) {
  if (String(env?.RUIDO_COMPUERTA || '').toLowerCase() === 'off') return { accion: 'seguir', motivo: 'killswitch' };
  const type = String(inbound.type || 'text');
  const primerContacto = !Array.isArray(history) || history.length === 0;

  // 2 · cuarentena de archivos peligrosos: siempre, con o sin historial. Lo demás (pdf, excel, word) sigue como hoy.
  if (type === 'document') {
    const archivo = { id: String(raw?.document?.id || ''), filename: String(raw?.document?.filename || '').trim(), mime: String(raw?.document?.mime_type || '').trim() };
    if (esArchivoPeligroso(archivo)) return { accion: 'cuarentena', motivo: 'archivo_peligroso', archivo };
    return { accion: 'seguir' };
  }

  // 3 · con historial, todo lo demás sigue como hoy.
  if (!primerContacto) return { accion: 'seguir' };

  // 1 · primer contacto sin intención. Botones e interactivos son respuestas a plantillas: siguen siempre.
  if (TIPOS_SIN_INTENCION.has(type)) return { accion: 'ruido', motivo: `tipo_${type}` };
  if (type === 'text') {
    const t = String(inbound.text || '');
    if (esSoloLink(t)) return { accion: 'ruido', motivo: 'solo_link' };
    if (esTextoVacio(t)) return { accion: 'ruido', motivo: 'texto_vacio' };
  }
  return { accion: 'seguir' };
}

/** Después de transcribir: un audio de primer contacto que SÍ se transcribió y no dijo nada (bolsillo) es ruido.
 *  Si la transcripción falló (STT caída) NO es ruido: el cerebro ya sabe pedir texto en ese caso. */
export function decidirAudio({ transcript = '', mediaResolved = false, history = [] } = {}) {
  const primerContacto = !Array.isArray(history) || history.length === 0;
  if (!primerContacto || !mediaResolved) return { accion: 'seguir' };
  if (esTextoVacio(transcript)) return { accion: 'ruido', motivo: 'audio_sin_texto' };
  return { accion: 'seguir' };
}

// Lo que Oliver contesta UNA vez por número cada 24 h. Sin saludo largo: si era un bolsillo, nadie lo lee; si era una
// persona, con esto alcanza para que escriba.
export const RESPUESTA_RUIDO = 'Hola 👋 Soy Oliver, de Activa Inversiones (ventanas de PVC con termopanel, Temuco). ' +
  'Si buscas cotizar, cuéntame por texto qué necesitas: tipo de ventana, medidas aproximadas y tu comuna.';
export const RESPUESTA_CUARENTENA = 'Recibí un archivo, pero por seguridad no abro ese tipo de documento. ' +
  'Si es un plano o una lista de ventanas, mándamelo en PDF o Excel, o una foto, o escríbeme las medidas (ancho × alto), la cantidad y tu comuna. 👍';

/** ¿Corresponde contestar ahora? Una vez por número cada 24 h, por motivo (ruido y cuarentena llevan reloj aparte). */
export function debeAvisar(state = {}, ahora = Date.now(), ventanaMs = 24 * 3600 * 1000, clave = 'ruido_aviso_at') {
  const ultimo = Number(state?.[clave]) || 0;
  return ahora - ultimo >= ventanaMs;
}
