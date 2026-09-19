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
 * LA REGLA (actualizada 2026-09-19, Gemini): los numeros que puso el cliente se RESPETAN, y a
 * las ventanas que no traen numero se les da uno que no choque, siguiendo desde el mayor. Lo
 * unico que tira abajo toda la numeracion es un DUPLICADO, porque ahi la reconciliacion se
 * vuelve ambigua y es preferible 1..n, que es univoco.
 * Antes se exigia que la trajeran TODAS, y eso tenia un costo peor: faltando una, el cliente
 * que habia numerado 14,15,16,17 recibia V1..V4 y el papel de fabrica dejaba de coincidir con
 * lo que el cliente decia por WhatsApp.
 * Los SALTOS si se permiten (el cliente que numera 7, 9, 10 esta diciendo algo); lo que no se
 * permite son los duplicados, que es lo que vuelve ambigua la reconciliacion.
 *
 * @param {Array<object>} lista - las ventanas tal como van a salir en el documento
 * @returns {string[]} un rotulo por ventana, en el mismo orden
 */
/**
 * El numero que el CLIENTE le dio a esta ventana, o null.
 *
 * ⚠️ [Codex, compuerta] DOS DEFECTOS QUE ARREGLA, los dos medidos:
 *  1. Se tomaba el primer valor NO NULO, no el primer valor VALIDO: `{pos:'', posicion:12}`
 *     ignoraba el 12 —que es del cliente— y forzaba renumerar TODO el documento.
 *  2. `id_ventana` numerico se volvia numero visible: un id INTERNO 637 salia impreso "V637",
 *     como si el cliente hubiera numerado asi. Es el mismo defecto que ya se habia arreglado
 *     para `id`, y habia quedado vivo en el campo hermano.
 * Un `id_ventana` con forma de ETIQUETA ("V14") SI cuenta: ahi el numero es explicito.
 */
function numeroDelCliente(v) {
  const candidatos = [v?.pos, v?.posicion];
  const etq = String(v?.id_ventana ?? '').trim();
  if (/^v\s*\d+$/i.test(etq)) candidatos.push(etq);   // "V14" es explicito; un 637 pelado no
  for (const c of candidatos) {
    const n = Number(String(c ?? '').trim().replace(/^v/i, ''));
    if (Number.isInteger(n) && n > 0 && n < 1000) return n;   // el primero VALIDO, no el primero presente
  }
  return null;
}

export function rotulosDeVentanas(lista) {
  const arr = Array.isArray(lista) ? lista : [];
  // 🔴 [Codex, compuerta] `id` NO cuenta como numero del cliente. Puede ser un id INTERNO, y
  // entonces un 812 se imprimia "V812" fingiendo que el cliente numero asi. El numero del
  // cliente vive en `pos` / `posicion` / `id_ventana`, que son los campos que se llenan con SU
  // lista. `id` solo sirve como ETIQUETA DE TEXTO, que es como lo usaba el informe termico.
  const num = arr.map(numeroDelCliente);
  const puestos = num.filter((n) => n !== null);
  const sinRepetir = new Set(puestos).size === puestos.length;
  // 🔴 [Gemini, abogado del diablo · 2026-09-19] SI EL CLIENTE NUMERO ALGUNAS, ESAS SE RESPETAN.
  // Antes se exigia que estuvieran TODAS y, si faltaba una, se tiraban a la basura las demas: el
  // cliente numeraba "ventana 14, 15, 16, 17" y agregaba "la del baño" sin numero, y las cuatro
  // primeras pasaban a llamarse V1..V4. El cliente seguia hablando de su ventana 14 mientras el
  // papel de fabrica decia otra cosa — el mismo problema que esto vino a cerrar, causado por la
  // solucion. Lo que NO se puede permitir es que dos ventanas compartan rotulo: esa es la
  // propiedad que se defiende, y por eso un numero REPETIDO si tira todo abajo.
  // A las que no traen numero se les da uno que no choque, siguiendo desde el mayor.
  if (puestos.length && sinRepetir) {
    let siguiente = Math.max(...puestos) + 1;
    return num.map((n) => {
      if (n !== null) return `V${n}`;
      const libre = siguiente;
      siguiente += 1;
      return `V${libre}`;
    });
  }
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

/**
 * 🔴 NUMERA LA LISTA UNA SOLA VEZ, ANTES DE QUE NADIE LA FILTRE.
 *
 * ⚠️ [Codex, compuerta] ESTE ERA EL AGUJERO QUE QUEDABA, y es el MISMO defecto original
 * mudado a otro documento. Textual: *"la combinacion 'cliente sin pos + ventana intermedia
 * ilegible para Vientos' sigue produciendo documentos irreconciliables"*.
 * MEDIDO con 3 ventanas sin numerar, donde el informe de vientos descarta la del medio porque
 * no puede leerle el vidrio:
 *     propuesta -> V1, V2, V3
 *     vientos   -> V1, V2      ⇒ la MISMA ventana es "V3" en una y "V2" en el otro.
 * Cada documento numeraba por la posicion de SU lista, y las listas no son la misma.
 *
 * La regla: el numero se decide sobre la lista COMPLETA, antes de filtrar, y despues viaja
 * pegado a la ventana. Asi, saquen la que saquen, el numero no se mueve.
 *
 * TODO O NADA, igual que `rotulosDeVentanas`: si el cliente numero bien (todas, sin repetir),
 * mandan SUS numeros; si no, se numera por posicion pero se CONGELA aqui. Nunca se mezcla un
 * `pos` del cliente con un indice inventado, porque eso deja dos "V2" en el mismo documento
 * —lo advirtio Codex y tiene razon—.
 *
 * ⚠️ MUTA los items a proposito: los tres documentos se derivan de esta misma lista, asi que
 * escribir el numero aca es lo que garantiza que los tres lo hereden.
 *
 * @param {Array<object>} items - la lista COMPLETA del pedido, antes de cualquier filtro
 * @returns {Array<object>} los mismos items, cada uno con `pos` asignado
 */
export function numerarVentanas(items) {
  const arr = Array.isArray(items) ? items : [];
  if (!arr.length) return arr;
  // Se apoya en `rotulosDeVentanas` para no tener DOS reglas de numeracion en el mismo archivo:
  // el dia que se toque una y no la otra, la propuesta y el informe vuelven a discrepar.
  const nums = rotulosDeVentanas(arr).map((r) => {
    const m = /^V(\d+)$/.exec(String(r));
    return m ? Number(m[1]) : null;
  });
  arr.forEach((v, i) => {
    // [Codex] `pos` es la UNICA fuente de verdad despues de esto. `posicion` se sincroniza
    // para que no queden dos campos diciendo cosas distintas si algun documento mira el otro.
    if (v && typeof v === 'object') {
      // Si el rotulo era de TEXTO ("Living-A", "P-07"), no hay numero que escribir y se cae a
      // la posicion: `pos` es numerico por contrato con los tres documentos.
      v.pos = nums[i] === null ? i + 1 : nums[i];
      // 🔴 [Nemotron, abogado del diablo] `posicion` SOLO se sincroniza si ya tenia un NUMERO.
      // Antes se pisaba siempre, y en `posicion` puede venir DONDE VA la ventana ("dormitorio",
      // "A-1"): se destruia el unico dato que le dice al instalador en que vano montarla, para
      // dejar en su lugar un numero que ya estaba en `pos`. Se sincroniza cuando los dos campos
      // dicen lo mismo —un numero— y se respeta cuando dice otra cosa.
      if (v.posicion !== undefined && /^[vV]?\s*\d+$/.test(String(v.posicion).trim())) {
        v.posicion = v.pos;
      }
    }
  });
  return arr;
}
