// ---------------------------------------------------------------------------
// FORMA MONORRIEL — LA FUENTE UNICA de "¿esto es un monorriel?"
// ---------------------------------------------------------------------------
// 🔴 POR QUE EXISTE ESTE ARCHIVO (2026-09-23, reclamo del dueño sobre una propuesta REAL,
// CM-FR-004-2026-0515): el cliente pidio monorriel, el PRECIO salio bien ($193.891 = "Corredera
// ANDES 54 Monorriel", verificado en vivo contra el motor) y el DIBUJO salio mal: el PDF le
// mostro una corredera SLIDING de DOS hojas moviles, con dos flechas, sobre un producto que
// tiene UNA hoja y un paño fijo. Textual: *"OLIVER LE PIDIERON MONORRIEL ... Y MOSTRO IMAGEN DE
// SLIDING Y NO DICE MONORRIEL"*.
//
// La causa NO fue un regex mal escrito: fue que la misma pregunta se contestaba en DOS lugares
// con DOS criterios distintos. `enginePricer.esMonorrielPorForma` (calibrada en 4 vueltas de
// compuerta cruzada, con negaciones y conteo de hojas) decia SI; la copia debil que vivia en
// `dibujoVentana.esMonorriel` decia NO, porque exigia un conector "+"/"y" entre las palabras y
// el label real —"Corredera con paño fijo"— usa "con".
//
// Es exactamente la leccion L3 de DIBUJO-VENTANAS-ACTIVA.md, escrita el 11-sep:
//     "si el mismo dato se decide en mas de un lugar, no es un arreglo — es un parche".
// Por eso la funcion se MUDA aca en vez de parchearse: el precio y el dibujo ahora leen la
// misma, y no pueden volver a contradecirse. No se toco ni una linea de su logica.
//
// ⚠️ Vive en su propio archivo, y no en enginePricer, para que `dibujoVentana` pueda usarla sin
// arrastrar el cliente del motor (fetch, red, config de Railway) a un modulo que solo dibuja.
/**
 * Detecta nº de hojas si el cliente/foto lo indica ("3 hojas", "tres hojas", "triple").
 * Si no se sabe → undefined (el motor usa su default = 2 hojas / doble riel).
 * [Codex 3a vuelta] Se toma el MÁXIMO de todas las menciones "N hoja(s)" (dígito o palabra):
 * si el texto dice "2 y 3 hojas" no puede cotizar la de 2 (subcobro). La palabra-número solo
 * cuenta PEGADA a "hoja" — "una corredera grande" NO es 1 hoja (lo fija el test chileno).
 */
export function detectHojas(product) {
  const t = String(product || "").toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const NUMP = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4 };
  let max;
  const re = /(\d+|una|uno|un|dos|tres|cuatro)\s*hojas?/g;
  let m;
  while ((m = re.exec(t))) {
    const v = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMP[m[1]];
    if (Number.isFinite(v) && v >= 1) max = Math.max(max ?? 0, v);
  }
  if (max) return max;
  if (/\btriple\b/.test(t)) return 3;
  if (/\bcuadruple\b/.test(t)) return 4;
  return undefined;
}

/**
 * 🏭 ES UN MONORRIEL? = UNA hoja movil + UN paño FIJO, en UN marco.
 *
 * HECHO DEL NEGOCIO (dueño, textual 2026-09-18): *"una corredera un hoja paño fijo es andes
 * monorriel"*. Ya estaba escrito en el mallado desde el 11-sep y no se consulto:
 *   DIBUJO-VENTANAS-ACTIVA.md:57  "Monorriel = 1 hoja movil + 1 paño FIJO, en UN marco."
 *   DIBUJO-VENTANAS-ACTIVA.md:65  "'Mitad fija mitad corredera' = monorriel = ANDES."
 * Lo dice el listado de materiales de Winart del monorriel ANDES (v69117): UN marco
 * (PI-SLA-MMC), UNA hoja corredera (PI-SLA-A66), UN traslapo, UNA manilla.
 *
 * POR QUE VIVE ACA Y NO SOLO EN EL DIBUJO: el monorriel es linea ANDES, y `ANDES_AUTO_COTIZA`
 * esta en false ⇒ va a Marcelo. Pero la rama ANDES solo se activaba con la palabra "andes", y
 * el cliente NUNCA la escribe: describe la FORMA ("corredera con un paño fijo"). Resultado
 * medido: se cotizaba como ventana FIJA (producto equivocado) y, tras el fix de apertura del
 * 18-sep, habria pasado a SLIDING 2 hojas doble riel — otro producto equivocado, y encima
 * SLIDING no tiene monorriel (el motor responde `monorriel_no_disponible_en_sliding`).
 *
 * ⚠️ LA FRONTERA, Y ES DE PLATA: monorriel = UNA hoja MOVIL. La corredera de 3 hojas con la
 * central fija tiene DOS moviles ⇒ NO es monorriel, es SLIDING doble riel, y esa SI esta
 * calibrada contra Winart (v69621). Mandarla a escalar seria apagar la ventana que el dueño
 * acaba de pedir que se cotice.
 *
 * Hermano de `esMonorriel()` en services/dibujoVentana.js, que resuelve lo mismo para el DIBUJO
 * pero solo mira el label del item ya cotizado. Este mira el pedido del cliente.
 */
export function esMonorrielPorForma(texto) {
  const t = String(texto || "").normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Negacion: "que NO sea monorriel" no es monorriel (mismo criterio que la rama ANDES).
  // ⚠️ [Nemotron, tercer revisor] LA NEGACION LLEVA PALABRAS EN EL MEDIO. Textual:
  // *"«no quiero que sea monorriel»: hay palabras intermedias entre «no» y «sea», el patron no
  // coincide y la negacion no se detecta"*. MEDIDO: daba true. Ahora se admite lo que el
  // cliente mete en el medio ("no QUIERO QUE sea", "sin QUE VAYA").
  if (/\b(?:no|sin|tampoco)\b[^.]{0,25}\b(?:monorriel|mono\s*-?\s*riel|un\s*riel)\b/.test(t)) return false;
  // La PALABRA es inequivoca: si el cliente dice "monorriel", es monorriel y no hay que contar.
  if (/\bmono\s*-?\s*r?riel\b/.test(t)) return true;
  // ⚠️ [Codex, compuerta] ACA ESTABA EL BLOCKER: las señales de forma hacian `return true` ANTES
  // de contar, asi que un label como "Corredera 3 hojas (1 fija + 2 correderas)" apagaba la
  // ventana de 3 hojas que el dueño acaba de pedir que se cotice. Textual de Codex: *"el
  // comentario afirma que la cantidad de hojas decide, pero el flujo ejecutable dice lo
  // contrario"*. Tenia razon. Ahora el conteo manda sobre TODAS las señales de forma.
  const _fijaMasCorredera =
    /\bfij[ao][^+]{0,14}[+y][^+]{0,14}corred/.test(t)
    || /\bcorred[^+]{0,14}[+y][^+]{0,14}fij[ao]/.test(t)
    || /\bmitad\s+fij[ao][\s\S]{0,24}mitad\s+corred/.test(t)
    || /\bmitad\s+corred[\s\S]{0,24}mitad\s+fij[ao]/.test(t);
  // La corredera puede venir nombrada o dicha con VERBO ("una corre y la otra queda fija"),
  // que es como habla el cliente de verdad. Lo pidio Codex y es correcto.
  // ⚠️ [Nemotron] El cliente conjuga: "otro que se DESLICE", "que DESLIZA". MEDIDO: un
  // monorriel de verdad —"un paño fijo y otro que se deslice"— daba false y se cobraba 36% de
  // mas, como corredera de dos hojas que corren.
  // Ojo con la ortografia: el subjuntivo va con C ("que se desliCe"), no con Z.
  const _corrPorForma = /corredera|corrediz|sliding|desli[cz]/.test(t)
    || /\b(?:corre|corren|corran|corriendo)\b/.test(t);
  const _hayFija =
    /\b(?:hojas?|pa[nñ]os?|una|uno|1|lado|lateral(?:es)?|derech[ao]|izquierd[ao]|otra|otro)\b[^.]{0,20}\b(?:fij[ao]s?|no\s+abre)\b/.test(t)
    || /\bfij[ao]s?\b[^.]{0,14}\b(?:hojas?|pa[nñ]os?|lateral(?:es)?)\b/.test(t);
  // ⚠️ [Gemini, compuerta] UN FIJO **ADICIONAL** A LAS HOJAS SON 3+ PAÑOS, NO UN MONORRIEL.
  // Textual: *"corredera de dos hojas mas fijo lateral... fisicamente es un ventanal de 3 paños
  // (2 moviles + 1 fijo). Al ser procesado como monorriel, el bot re-escribe los parametros a
  // hojas:1, y se manda a fabricar una ventana de 2 paños en lugar de la de 3 que el cliente
  // necesita"*. Tenia razon, y ahora es peor que antes: ANTES este caso ESCALABA (seguro) y
  // desde que el monorriel se auto-cotiza terminaria fabricandose mal.
  // Un monorriel tiene EXACTAMENTE 2 paños: la hoja que corre y el fijo.
  // El conector tiene que ser ADITIVO: "2 hojas MAS un fijo" son 3 paños. "2 hojas CON una
  // hoja fija" son 2 paños —uno corre y el otro no— y ESO SI es un monorriel; incluir "con"
  // e "y" apagaba el caso mas comun de todos.
  if (/\b(?:dos|2|tres|3|cuatro|4)\s+hojas?\b[^.]{0,20}\b(?:mas|más|ademas|además|sumado)\b[^.]{0,20}\bfij[ao]/.test(t)) return false;
  // ⚠️ [Nemotron] Y TAMPOCO SI LAS HOJAS **CORREN** Y ADEMAS HAY UNA FIJA. Textual:
  // *"«corredera de 2 hojas que corren y una fija»... en realidad tiene 2 hojas moviles + 1
  // fija (= 3 paños), no es monorriel"*. MEDIDO: daba true, o sea subcobro del 27% y una
  // ventana de 2 paños fabricada donde el cliente pidio 3.
  // La diferencia con "2 hojas, una fija" (que SI es monorriel) es que ahi la fija es UNA DE
  // las dos; aca las dos corren y la fija es aparte.
  if (/\b(?:dos|2|tres|3|cuatro|4)\s+hojas?\s+que\s+(?:corren|corran|se\s+mueven|desliz\w*)\b[^.]{0,25}\bfij[ao]/.test(t)) return false;
  if (!_fijaMasCorredera && !(_corrPorForma && _hayFija)) return false;
  // 🔴 EL CONTEO DECIDE, Y ES DE PLATA. `detectHojas` cuenta hojas TOTALES (en "corredera 3
  // hojas la del medio fija" devuelve 3, de las cuales 2 son moviles). Con 3 o mas paños quedan
  // 2+ moviles: eso es SLIDING doble riel, calibrado contra Winart v69621, y NO se escala.
  // Sin conteo declarado, una corredera con un paño fijo son 2 paños = 1 sola movil.
  const n = detectHojas(t);
  return n === undefined || n <= 2;
}
