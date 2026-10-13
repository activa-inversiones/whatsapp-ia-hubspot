// ruido.js — [#1505 · 13-oct] COMPUERTA DE RUIDO del WhatsApp de Oliver (reclamo del dueño 12-oct, textual: «llegan muchas
// personas que pasaron a llevar el mensaje, celular en el bolsillo, niños jugando, no son clientes; además envían links o
// archivos que podrían ser peligrosos»). Medido 7 d: 122 conversaciones, 36 «ruido probable», 14 con links, 3 documentos.
//
// Qué decide (PURO, sin red, sin estado; el webhook aplica):
//   1. PRIMER CONTACTO (sin historial) que llega sin texto con intención —sticker, reacción, «unsupported», ubicación,
//      contacto, video, imagen SIN caption, texto vacío/de 1-2 caracteres, o SOLO un link— es RUIDO: Oliver contesta UNA vez
//      pidiendo que escriba qué necesita, NO crea lead, NO llama al cerebro, NO le llega al dueño. El mensaje queda en el
//      cockpit marcado `ruido:true` (se cuenta en el brief). Con el primer texto con intención entra al embudo normal.
//   2. ARCHIVOS PELIGROSOS (ejecutables, scripts, comprimidos, html, apk…) van a CUARENTENA SIEMPRE, sea quien sea: no se
//      descargan ni se reenvían; queda el nombre y el tipo en el cockpit. Un documento en el PRIMER contacto también va a
//      cuarentena (no se descarga): se le pide por texto qué necesita. Imágenes y audios NO se tocan: se procesan como hoy
//      (visión y transcripción no ejecutan nada) y son el 80 % de lo que manda un cliente real.
//   3. Un cliente con historial NUNCA pasa por la compuerta de ruido (ya es cliente): solo le aplica la cuarentena de
//      archivos peligrosos.
// Lo que NO hace: no decide por contenido con IA, no bloquea números, no borra nada. Killswitch: RUIDO_COMPUERTA=off.

export const VERSION = '1.0.0';

// Tipos de mensaje de Meta que en un primer contacto no traen intención (un bolsillo o un niño mandan esto).
export const TIPOS_SIN_INTENCION = new Set(['sticker', 'reaction', 'unsupported', 'location', 'contacts', 'video', 'unknown']);

// Extensiones y MIME que NUNCA se descargan (podrían ejecutarse en el PC del dueño o del operador).
export const EXT_PELIGROSAS = /\.(exe|msi|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|scr|com|pif|cpl|jar|apk|ipa|lnk|iso|img|dmg|zip|rar|7z|gz|tar|tgz|htm|html|hta|svg|reg|sh)$/i;
export const MIME_PELIGROSOS = /(x-msdownload|x-msdos-program|x-executable|x-sh|x-shellscript|javascript|x-java-archive|vnd\.android\.package-archive|zip|x-rar|x-7z|gzip|x-tar|text\/html|x-msi|x-ms-shortcut)/i;

// Un link con nada más alrededor (o con 1-2 palabras sueltas como «mira», «jaja»).
const URL_RE = /(https?:\/\/\S+|www\.\S+|wa\.me\/\S+|\b\S+\.(com|cl|net|org|io|app|me|tv|co)\b\S*)/gi;

export function esSoloLink(texto) {
  const t = String(texto || '').trim();
  if (!t || !URL_RE.test(t)) { URL_RE.lastIndex = 0; return false; }
  URL_RE.lastIndex = 0;
  const resto = t.replace(URL_RE, ' ').replace(/[\s\p{P}\p{S}]+/gu, ' ').trim();
  URL_RE.lastIndex = 0;
  return resto.split(/\s+/).filter(Boolean).length <= 2;
}

/** Texto sin intención: vacío, solo signos/emojis, o 1-2 caracteres («k», «?», «👍», «...»). */
export function esTextoVacio(texto) {
  const t = String(texto || '').replace(/[\s\p{P}\p{S}\p{Extended_Pictographic}️]+/gu, '').trim();
  return t.length <= 2;
}

export function esArchivoPeligroso({ filename = '', mime = '' } = {}) {
  return EXT_PELIGROSAS.test(String(filename || '')) || MIME_PELIGROSOS.test(String(mime || ''));
}

/**
 * Decide qué hacer con un mensaje entrante ANTES de descargar nada y antes del cerebro.
 * @param {{ inbound:{type?:string, text?:string}, raw?:object, history?:Array, env?:object }} p
 *   raw = el mensaje crudo de Meta (raw.document.filename / mime_type, raw.image.caption).
 * @returns {{ accion:'seguir'|'ruido'|'cuarentena', motivo?:string, archivo?:{filename:string, mime:string} }}
 */
export function decidirEntrada({ inbound = {}, raw = null, history = [], env = process.env } = {}) {
  if (String(env?.RUIDO_COMPUERTA || '').toLowerCase() === 'off') return { accion: 'seguir', motivo: 'killswitch' };
  const type = String(inbound.type || 'text');
  const primerContacto = !Array.isArray(history) || history.length === 0;

  // 2 · cuarentena de archivos: siempre, con o sin historial.
  if (type === 'document') {
    const archivo = { filename: String(raw?.document?.filename || ''), mime: String(raw?.document?.mime_type || '') };
    if (esArchivoPeligroso(archivo)) return { accion: 'cuarentena', motivo: 'archivo_peligroso', archivo };
    if (primerContacto) return { accion: 'cuarentena', motivo: 'documento_en_primer_contacto', archivo };
    return { accion: 'seguir' };
  }

  // 3 · con historial, todo lo demás sigue como hoy.
  if (!primerContacto) return { accion: 'seguir' };

  // 1 · primer contacto sin intención.
  if (TIPOS_SIN_INTENCION.has(type)) return { accion: 'ruido', motivo: `tipo_${type}` };
  if (type === 'image') {
    const caption = String(raw?.image?.caption || '').trim();
    return caption ? { accion: 'seguir' } : { accion: 'ruido', motivo: 'imagen_sin_texto' };
  }
  if (type === 'audio') return { accion: 'seguir' };   // se transcribe; el webhook vuelve a preguntar si no dijo nada (decidirAudio)
  if (type === 'text' || type === 'button' || type === 'interactive') {
    const t = String(inbound.text || '');
    if (esSoloLink(t)) return { accion: 'ruido', motivo: 'solo_link' };
    if (esTextoVacio(t)) return { accion: 'ruido', motivo: 'texto_vacio' };
  }
  return { accion: 'seguir' };
}

/** Después de transcribir: un audio de primer contacto que no dijo nada (bolsillo) es ruido. */
export function decidirAudio({ transcript = '', mediaResolved = false, history = [] } = {}) {
  const primerContacto = !Array.isArray(history) || history.length === 0;
  if (!primerContacto) return { accion: 'seguir' };
  if (!mediaResolved || esTextoVacio(transcript)) return { accion: 'ruido', motivo: 'audio_sin_texto' };
  return { accion: 'seguir' };
}

// Lo que Oliver contesta UNA vez (el webhook lo limita a 1 por número cada 24 h). Sin saludo largo: si era un bolsillo,
// nadie lo lee; si era una persona, con esto alcanza para que escriba.
export const RESPUESTA_RUIDO = 'Hola 👋 Soy Oliver, de Activa Inversiones (ventanas de PVC con termopanel, Temuco). ' +
  'Si buscas cotizar, cuéntame por texto qué necesitas: tipo de ventana, medidas aproximadas y tu comuna.';
export const RESPUESTA_CUARENTENA = 'Recibí un archivo, pero por seguridad no abro archivos adjuntos. ' +
  'Si es un plano o una lista de ventanas, mándame una foto o escríbeme las medidas (ancho × alto), la cantidad y tu comuna. 👍';

/** ¿Corresponde contestar ahora? Una vez por número cada 24 h (state.ruido_aviso_at). */
export function debeAvisar(state = {}, ahora = Date.now(), ventanaMs = 24 * 3600 * 1000) {
  const ultimo = Number(state?.ruido_aviso_at) || 0;
  return ahora - ultimo >= ventanaMs;
}
