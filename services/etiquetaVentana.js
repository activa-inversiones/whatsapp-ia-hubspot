// etiquetaVentana.js — CON QUE NUMERO SALE CADA VENTANA EN LOS DOCUMENTOS.
//
// 🔴 POR QUE EXISTE (2026-09-19, medido contra documentos reales del cliente).
// Un cliente mando una lista NUMERADA de 17 ventanas. El PDF y el informe termico salieron con
// 16 —Oliver dejo una afuera— y el numero de cada ventana se recalculaba al dibujar, con
// `V${idx + 1}`. Eso no es un identificador: es la POSICION en el array. Resultado MEDIDO
// comparando su lista contra el informe emitido:
//
//     CLIENTE          PDF/INFORME
//     N°13  575x375    (no sale)
//     N°14  1215x993   V13     <- corrido
//     N°15  1110x990   V14     <- corrido
//     N°16  1998x1980  V15     <- corrido
//     N°17  1800x1992  V16     <- corrido
//
//   4 de 16 ventanas con un numero distinto al que uso el cliente. Y el aviso del PDF decia
//   "No incluye la ventana N°13 (575x375)" mientras el informe mostraba "V13 = 1215x993".
//   Gemini lo puso en plata: *"el cliente asumira que le estas quitando la ventana del
//   dormitorio por el mismo precio"*.
//
// QUE HACE: una sola funcion para los TRES renderizadores (propuesta, termico, vientos), que
// respeta la etiqueta que traiga la ventana y solo cae a la posicion cuando no hay ninguna.
// Antes cada documento la calculaba por su cuenta y por eso podian discrepar entre si.
//
// ⚠️ LO QUE ESTO NO RESUELVE, y hay que decirlo: hoy NADIE setea todavia `pos`. Esta funcion es
// el andamiaje —el punto unico donde enchufarlo— y mientras tanto se comporta EXACTAMENTE como
// antes. El identificador de verdad es una decision de arquitectura del dueño (tablero #798):
// Codex, en la compuerta, mostro que "ID de ventana" son en realidad TRES cosas distintas —la
// abertura SOLICITADA, la alternativa COTIZADA y la unidad FABRICADA— y que ninguna sola
// alcanza.

/**
 * Con que se rotula esta ventana en un documento.
 * @param {object} v - el item de la ventana
 * @param {number} i - su posicion en la lista que se esta dibujando (0-based)
 * @returns {string} p.ej. "V13"
 */
export function etiquetaVentana(v, i) {
  const propia = v?.pos ?? v?.id_ventana ?? v?.posicion ?? v?.id;
  const s = String(propia ?? '').trim();
  if (!s) return `V${i + 1}`;
  // Si ya viene rotulada ("V13"), se respeta tal cual; si es solo el numero, se le pone la V.
  return /^v\s*\d+$/i.test(s) ? s.toUpperCase().replace(/\s+/g, '') : (/^\d+$/.test(s) ? `V${s}` : s);
}
