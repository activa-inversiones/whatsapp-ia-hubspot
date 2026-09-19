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

/**
 * 🔴 LOS ROTULOS DE TODA LA LISTA, DECIDIDOS DE UNA SOLA VEZ.
 *
 * ⚠️ [Codex, compuerta] POR QUE NO ALCANZA CON `etiquetaVentana` ITEM POR ITEM:
 * el `pos` lo llena el LLM, y textual de Codex: *"la causa de muerte es confiar en que el LLM
 * copie correctamente un identificador comercial sin una comprobacion determinista. El mismo
 * componente que puede omitir una ventana ahora controla la etiqueta usada para reconciliar el
 * pedido. No hay defensa cuando alucina, duplica u omite pos"*. Tenia razon: dos ventanas
 * rotuladas "V5", o la mitad con numero del cliente y la otra mitad con el del array, dejan el
 * documento PEOR que antes de todo esto.
 *
 * LA REGLA ES TODO O NADA: los numeros del cliente se usan solo si la lista entera los trae,
 * son enteros positivos y no se repiten. Ante cualquier duda se cae a la numeracion por
 * posicion, que es el comportamiento de siempre — nunca queda peor que antes.
 * Los SALTOS si se permiten (el cliente que numera 7, 9, 10 esta diciendo algo); lo que no se
 * permite son los duplicados, que es lo que vuelve ambigua la reconciliacion.
 *
 * @param {Array<object>} lista - las ventanas tal como van a salir en el documento
 * @returns {string[]} un rotulo por ventana, en el mismo orden
 */
export function rotulosDeVentanas(lista) {
  const arr = Array.isArray(lista) ? lista : [];
  // 🔴 [Codex, compuerta] `id` NO cuenta como numero del cliente. Puede ser un id INTERNO, y
  // entonces un 812 se imprimia "V812" fingiendo que el cliente numero asi. El numero del
  // cliente vive en `pos` / `posicion` / `id_ventana`, que son los campos que se llenan con SU
  // lista. `id` solo sirve como ETIQUETA DE TEXTO, que es como lo usaba el informe termico.
  const num = arr.map((v) => {
    const x = v?.pos ?? v?.posicion ?? v?.id_ventana;
    const n = Number(String(x ?? '').trim().replace(/^v/i, ''));
    return Number.isInteger(n) && n > 0 && n < 1000 ? n : null;
  });
  const todos = num.length > 0 && num.every((n) => n !== null);
  const sinRepetir = new Set(num).size === num.length;
  if (todos && sinRepetir) return num.map((n) => `V${n}`);
  // 🔴 [Codex, compuerta] Y SI NO HAY NUMERACION DEL CLIENTE, NO SE PIERDEN LAS ETIQUETAS DE
  // TEXTO. Esto era una REGRESION que introduje: el informe termico imprimia `v.id` desde
  // siempre, asi que un rotulo como "Living-A" o "P-07" salia en el documento; al unificar todo
  // en esta funcion empezaron a salir como "V1". Se restaura el comportamiento de antes.
  return arr.map((v, i) => {
    const txt = String(v?.id_ventana ?? v?.id ?? v?.posicion ?? v?.pos ?? '').trim();
    // Una etiqueta tiene que PARECER una etiqueta de codigo: una letra Y un digito o un guion
    // ("Living-A", "P-07", "Dormitorio 1"). Asi un `pos: -3` no sale rotulado "-3", y un
    // `pos: "trece"` —el LLM poniendo cualquier cosa— tampoco se imprime tal cual: los dos
    // caen a la numeracion por posicion, que es lo seguro. Lo cazo el test de basura.
    const pareceEtiqueta = /[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]/.test(txt)
      && /[\d-]/.test(txt)
      && !/^(?:nan|null|undefined)$/i.test(txt);
    if (pareceEtiqueta) return /^v\s*\d+$/i.test(txt) ? txt.toUpperCase().replace(/\s+/g, '') : txt;
    return `V${i + 1}`;
  });
}
