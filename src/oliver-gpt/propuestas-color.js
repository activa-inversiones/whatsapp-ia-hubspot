// src/oliver-gpt/propuestas-color.js — LAS TRES PROPUESTAS A / B / C POR COLOR (COMPARTIDO)
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 [2026-08-31 · DECISION DEL DUEÑO, textual en tres mensajes]
//   1) *"cuando cliente no entrega color entreguemosle blanco, nogal y negro"*
//   2) *"entregar 3 propuestas tecnica economicas una blanco, nogal y new black"*
//   3) *"identificando claramente cada una, ademas diferenciadas como a b c segun el acuerdo
//       de cada cotizacion pero le decimos a cliente cuel es cada una"*
//
// POR QUE EXISTE. Cuando el cliente no decia el color habia dos salidas y las dos costaban:
//   · INVENTAR un Blanco que nadie pidio → el defecto que el dueño reporto el 25-ago
//     (*"todas las entregas blancas sin importar el color que quiera el cliente"*), y que
//     toca plata: el perfil foliado vale 69-88 % mas que el blanco.
//   · FRENAR la propuesta hasta que conteste → medido: el plazo de gracia es PASIVO (solo se
//     re-evalua cuando el cliente vuelve a escribir), asi que el cliente que pregunta, no
//     contesta el color y se va NO RECIBE NADA. Y sin PDF no sale el evento de cotizacion:
//     Google Ads deja de recibir la conversion (webhook.click-ids.test.js).
// La decision del dueño rompe el dilema: ni inventar ni frenar. Salen las TRES, rotuladas.
//
// COMPARTIDO A PROPOSITO entre webhook.js (WhatsApp) y channel-agent.js (IG/FB): el repo ya
// aprendio que dos copias paralelas de una regla se desincronizan (por eso existe
// `datoQuePregunta` en pdf-intent.js). El rotulo, el orden de los colores, las letras del
// folio y el texto que lee el cliente viven ACA y en un solo lugar.

/**
 * LAS LETRAS DEL FOLIO ISO. Fuente unica: `numeroDeDocumento` y `alternativasEntregadas`
 * (webhook.js) la importan de aca en vez de repetir el literal.
 *
 * El sufijo NO es nuevo: nacio el 26-ago del caso Paula, que pidio dos cotizaciones —*"una de
 * color negro y la otra de color blanco"*— y las dos salieron con el folio 0353. Como la fila
 * de `quotes` se busca por `(tenant_id, quote_number)`, la segunda PISO a la primera y la
 * cotizacion negra que la clienta tiene en la mano NO EXISTE en el registro.
 * Regla del dueño de entonces: *"agregarle A B C D al final si hay, asi sera mas facil"*.
 *
 * ✅ VERIFICADO CONTRA LA BD VIVA (2026-08-31): `quote_counters.last_seq = 391` y la ultima
 * fila es `CM-FR-004-2026-0391-B` ⇒ **la letra NO consume correlativo ISO**. Y las variantes
 * ya conviven como filas separadas con distinto color (0356-B "Blanco" / 0356-C "Negro",
 * 0360-B/-C/-D "Nogal"). O sea: el mecanismo que estas tres propuestas necesitan ya existe,
 * ya esta en produccion y ya esta probado. Aca solo se REUSA.
 */
export const LETRAS_ALTERNATIVA = 'BCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * LOS TRES COLORES Y SU ORDEN. **El orden es A, B, C y el dueño puede querer cambiarlo.**
 *
 * 💰 NO ES COSMETICO: el primero es el que ANCLA el precio en la cabeza del cliente. Medido
 * en el motor sobre el marco doble riel S70 — Blanco $30.385 · Nogal $49.974 · New Black
 * $54.356 — el blanco es ~44 % mas barato que el negro. Abrir por el blanco ancla bajo y el
 * resto se lee "caro"; abrir por el negro ancla alto y el blanco se lee "conveniente".
 * Cambiar el orden es cambiar una decision comercial, asi que se cambia ACA, en una linea,
 * y queda dicho por que.
 *
 * ⛔ ANTI-ALUCINACION: los tres salen del catalogo REAL. Los cinco que existen son
 * Blanco · Nogal · Roble Dorado · Grafito Antracita · Negro (normalizers.js COLORES_CATALOGO),
 * y ningun otro. El dueño pidio estos tres.
 *
 * 📌 "New Black" es como lo nombro el dueño y como lo imprime el PDF: el dibujo lo tiene con
 * ese nombre (`services/dibujoVentana.js` → COLORES.newblack.nombre = "New Black") mientras
 * la lista de texto lo llama "Negro". Son el MISMO color y los dos caminos lo resuelven igual:
 * `normColorLocal` (enginePricer.js:321) manda "negro"/"black"/"new black" a NEWBLACK, y
 * `claveColor` (dibujoVentana.js) manda "black"/"negro" a la misma muestra. Verificado en
 * codigo antes de elegir el texto: ningun string de aca cae al blanco por defecto.
 */
// [2026-08-31] ORDEN DEFINIDO POR EL DUENO: DEL MAS CARO AL MAS ECONOMICO.
//   A = New Black ($54.356 el marco S70)  B = Nogal ($49.974)  C = Blanco ($30.385)
// No es estetica, es ANCLAJE: mostrar primero el caro deja al blanco leyendose como
// "la opcion economica" en vez de como el precio de referencia. Esta primera version
// salio al reves (barato primero) y estaba MAL; el tablero lo registra el 31-ago.
// Vive en una constante justamente para poder cambiarlo con una palabra.
export const COLORES_PROPUESTA = ['New Black', 'Nogal', 'Blanco'];

/**
 * LOS FOLIOS DE LAS OPCIONES, con su letra — reusando el sufijo que ya existe.
 *
 * ⚠️ SE PIDE UN SOLO CORRELATIVO Y SE COMPONEN LAS TRES. Pedir tres `next-number` quemaria
 * 0392/0393/0394 para un mismo cliente: auditable, pero contra la convencion ya acordada y
 * contra el sentido del correlativo (un proyecto = un numero, las variantes son letras).
 *
 * ⚠️ NO SE PUEDE USAR `numeroDeDocumento` EN BUCLE, y esa es la razon de que esta funcion
 * exista: aquella es SECUENCIAL —exige `state.last_quote.pdf_sent === true` de un turno
 * ANTERIOR— y dentro de una sola llamada a `generarPdf` el rastro recien se escribe al final.
 * Las tres se asignan de una, aca, con las MISMAS letras.
 *
 * La letra del rotulo se deriva del FOLIO, no de la posicion: asi lo que el cliente lee en el
 * mensaje ("opcion B") es literalmente el sufijo del archivo que recibe (`...-B.pdf`). Si el
 * cliente ya se habia llevado alternativas antes, la terna sale B/C/D en vez de A/B/C — sigue
 * identificando cada una sin ambiguedad y sin reusar una letra ya entregada, que en ISO es lo
 * que de verdad importa.
 *
 * @param {string} quoteNumber  folio base ya obtenido (puede venir con letra)
 * @param {number} cuantas      cuantas opciones se quieren (3)
 * @param {number} usadasPrevias `state.last_quote.alternativas`
 * @returns {Array<{numero:string, letra:string}>}
 */
export function foliosDeOpciones(quoteNumber, cuantas = 3, usadasPrevias = 0) {
  const crudo = String(quoteNumber || '').trim();
  if (!crudo) return [];
  const base = crudo.replace(/-[A-Z]$/, '');
  const letraActual = (crudo.match(/-([A-Z])$/) || [])[1] || '';
  // Cuantas letras estan YA consumidas. Se toma el MAYOR entre el rastro de la sesion y lo
  // que dice la propia letra: mismo criterio (y misma razon) que `alternativasEntregadas`.
  let usadas = Math.max(
    Number(usadasPrevias) || 0,
    letraActual ? LETRAS_ALTERNATIVA.indexOf(letraActual) + 1 : 0,
  );
  const out = [{ numero: crudo, letra: letraActual || 'A' }];
  const tope = Math.max(1, Number(cuantas) || 1);
  for (let i = 1; i < tope; i++) {
    // 26 alternativas para un mismo cliente no es un caso real; si pasa, se entregan las que
    // alcancen en vez de inventar una numeracion que nadie sabria leer (mismo criterio que
    // el 'sin_letras' de `numeroDeDocumento`).
    if (usadas >= LETRAS_ALTERNATIVA.length) break;
    out.push({ numero: `${base}-${LETRAS_ALTERNATIVA[usadas]}`, letra: LETRAS_ALTERNATIVA[usadas] });
    usadas += 1;
  }
  return out;
}

/**
 * Cuantas letras quedan CONSUMIDAS tras reservar la terna. Se cuentan TODAS las reservadas,
 * no solo las entregadas: si la B fallo y la C salio, la B NO se puede reciclar despues —
 * habria dos documentos distintos con el mismo numero, que es exactamente el pisado del caso
 * Paula. El hueco en la numeracion queda explicado en el log (en ISO un salto hay que poder
 * explicarlo; una colision no se puede explicar de ninguna manera).
 */
export function letrasReservadas(opciones = []) {
  return (Array.isArray(opciones) ? opciones : []).reduce((max, op) => {
    const l = (String(op?.numero || '').match(/-([A-Z])$/) || [])[1];
    return l ? Math.max(max, LETRAS_ALTERNATIVA.indexOf(l) + 1) : max;
  }, 0);
}

/**
 * LOS CINCO COLORES REALES, con la grafia que se le muestra al cliente.
 *
 * Es `normalizers.COLORES_CATALOGO` con "Negro" escrito "New Black", que es como lo nombro el
 * dueño y como lo imprime el PDF (`dibujoVentana.js` → COLORES.newblack.nombre). El motor los
 * resuelve igual (`normColorLocal`), asi que no hay riesgo de que uno caiga a blanco.
 * ⛔ Ningun otro color existe: si alguna vez se agrega uno, se agrega ACA y en el catalogo.
 */
const CATALOGO_VISIBLE = ['Blanco', 'Nogal', 'Roble Dorado', 'Grafito Antracita', 'New Black'];

/**
 * Los colores del catalogo que el cliente NO recibio — para ofrecerselos sin inventar ninguno.
 *
 * 🔴 Se calcula sobre lo ENTREGADO, no sobre la terna, y es lo que cierra el unico hueco que
 * dejaba el fallo parcial: el aviso previo le anuncia los tres colores ANTES de mandarlos (no
 * puede adivinar cual va a fallar), asi que si la del Nogal no sale, el cliente la esta
 * esperando. Ofreciendole el Nogal en el cierre —"me dice y se la cotizo"— la promesa se cumple
 * igual. Cazado por webhook.propuestas-abc.test.js, no razonando.
 */
function _restoDelCatalogo(colores = []) {
  const puestos = colores.map((c) => String(c).toLowerCase());
  return CATALOGO_VISIBLE.filter((c) => !puestos.includes(c.toLowerCase()));
}

/**
 * EL AVISO PREVIO, antes de que lleguen los archivos.
 *
 * Va pegado al ANTICIPO (webhook.js, Paso 2-bis) por una razon de cliente, no de sistema: tres
 * PDF seguidos sin explicacion se leen como un bot trabado. Primero se dice que vienen tres y
 * de que color es cada uno; despues llegan; y al final el mensaje de cierre repite el mapeo
 * con el numero de folio de cada uno, que es como los va a distinguir en el chat.
 */
export function avisoPrevioOpciones(colores = []) {
  const lista = (Array.isArray(colores) ? colores : []).filter(Boolean);
  if (lista.length < 2) return '';
  const enumerado = lista.length === 2
    ? `${lista[0]} y ${lista[1]}`
    : `${lista.slice(0, -1).join(', ')} y ${lista[lista.length - 1]}`;
  return `Como no me dijo el color, se la voy a mandar en ${lista.length}: ${enumerado}. `
    + 'Van una por una y abajo le digo cuál es cuál.';
}

/**
 * EL MENSAJE QUE LEE EL CLIENTE — pedido EXPLICITO del dueño: *"le decimos a cliente cuel es
 * cada una"*. El cliente no puede tener que adivinar cual archivo es cual.
 *
 * Escrito como lo escribiria un vendedor, no un sistema: espanol chileno, en USTED (el resto
 * del flujo habla de usted y mezclarlo es la falta que el system-prompt prohibe con nombre y
 * apellido), sin humo y sin adornos.
 *
 * ⛔ SIN MONTOS (REGLA #13: el precio va SOLO en el PDF formal). Se dice QUE cambia el precio,
 * nunca CUANTO — y tampoco se afirma cual es el mas barato: eso es un dato de la lista de
 * precios que puede cambiar, y una afirmacion de precio que envejece mal en un chat es
 * exactamente lo que la regla anti-alucinacion prohibe.
 *
 * Solo lista lo que DE VERDAD se entrego: si una de las tres fallo, no se la nombra. Un
 * mensaje que promete un archivo que no llego es peor que no mandar el mensaje.
 *
 * @param {Array<{letra:string, color:string, numero:string}>} entregadas
 */
export function textoDeOpciones(entregadas = []) {
  const ops = (Array.isArray(entregadas) ? entregadas : []).filter((o) => o && o.color && o.numero);
  if (ops.length < 2) return '';   // con una sola no hay nada que comparar: no es una terna

  // [2026-08-31] TEXTO APROBADO TEXTUAL POR EL DUENO. No se "mejora" ni se le agrega nada.
  // Dos decisiones suyas que estan adentro y no son adorno:
  //   1. trato de USTED, que es como Oliver le habla al cliente hoy.
  //   2. NO se nombran Roble Dorado ni Grafito. Los saco A PROPOSITO: desenfocan del cierre.
  //      Si el cliente los pide, ahi se ofrecen. La version anterior los ofrecia siempre en
  //      el cierre, contra esa decision.
  // Regla #13: NI UN MONTO en el chat. Los precios van solo en el PDF.
  const cuantas = ops.length === 3 ? 'los tres' : ops.length === 2 ? 'los dos' : `los ${ops.length}`;
  const lineas = ops.map((o) => `${o.letra} — ${o.color} · N° ${o.numero}`);

  // UNICA excepcion a "no ofrecer otros colores", y no la contradice: si una de las TRES que
  // el aviso previo ya le anuncio no llego a salir, el cliente la esta esperando. Callarsela
  // seria una promesa rota. No se ofrece nada del catalogo que no se le haya prometido.
  const salieron = new Set(ops.map((o) => String(o.color)));
  const prometidos = COLORES_PROPUESTA.filter((c) => !salieron.has(c));
  const cierre = prometidos.length
    ? ` Si prefiere ${prometidos.join(' o ')}, me dice y se la cotizo sin costo.`
    : '';

  return `Le preparé la propuesta en ${cuantas} colores que más se piden. El color cambia el`
    + ` precio, así que se la mando en ${cuantas} para que lo vea claro antes de decidir:\n\n`
    + `${lineas.join('\n')}\n\n`
    + 'Son la misma ventana: mismas medidas, mismo termopanel. Cambia solo el color del perfil.\n\n'
    + `Dígame cuál le acomoda y le dejo esa como propuesta definitiva.${cierre}`;
}



