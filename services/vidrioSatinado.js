// services/vidrioSatinado.js — [2026-10-05 · r5] QUÉ HACE QUE UN VIDRIO SEA «SATÉN». UNA sola definición.
//
// Antes había dos listas: la de `dibujoVentana.claveVidrio` (satin, saten, acid, esmeril, mate,
// opaco, transluc) y la de `vidrioCotizado.esBano` (solo saten, bano, esmeril), que decía ser
// «la misma» y no lo era. Resultado: el PDF dibujaba un vidrio opaco que el aviso al dueño por
// satén perdido no reconocía (hallazgo BAJO de Thermos, 449b255..30cca6d). Las dos importan de acá.
//
// Sin dependencias: lo importan el dibujo (pdfkit) y la regla del vidrio del bot.

/** Minúsculas y sin tildes ni ñ («Satén», «BAÑO» y «bano» caen en lo mismo). */
export const sinTildes = (v) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * «satinado» y «saten» son el mismo vidrio; «mate», «opaco» y «translúcido» son como lo nombra el cliente.
 *
 * [2026-10-05 · r6 · Thermos BAJO] Se anclan al INICIO DE PALABRA (no precedidas por una letra) y «mate»
 * además a su FIN. Sin ancla, «mate» calzaba dentro de «MATErial» y «acid» dentro de «capACIDad»: un
 * «Termopanel DVH material guardian» se dibujaba satén y disparaba el aviso de «satén perdido».
 * «mate» acepta sus flexiones (mates, mateado/a/os/as) y NADA más: «material», «matemática»… no calzan.
 * ⚠️ NO simplificar a `\b`: `\b` cuenta `_` y los dígitos como letras, y «dvh_acidado» / «4+12+4mate»
 * (que calzaban antes) dejarían de calzar. El texto llega SIN TILDES y en minúsculas (`sinTildes`), así que
 * «letra» es `[a-z]`.
 */
const PALABRAS_SATEN = /(?<![a-z])(?:satin|saten|acid|esmeril|opaco|transluc|mate(?:s|ad[oa]s?)?(?![a-z]))/;

/** Regla del dueño (31-ago): «si dice baño ponerle satén», con o sin tilde, con o sin la ñ. */
// 🔴 [2026-10-11] ESTO ES UN ESPEJO DE LO QUE SE COBRA, NO UNA SEGUNDA OPINIÓN.
// Hasta hoy había DOS definiciones de «esto es un baño»: esta (que manda el DIBUJO) y la de
// `enginePricer.js` (que manda el PRECIO), y NO coincidían en 6 de 12 palabras. Consecuencia: una
// ventana podía dibujarse opaca y cobrarse clara, o al revés, en una propuesta formal. Se alineó al
// PRECIO, nunca al revés: lo que se cobra manda, y así el cambio no mueve ni un peso.
// ⛔ `ducha` y `bañera` salieron A PROPÓSITO — HECHO DEL NEGOCIO (dueño, textual 2026-10-11):
// «DUCHA ES MAMPARA DE VIDRIO TEMPLADA Y BAÑERA ES MAMPARA DE VIDRIO TEMPLADA». Son otro producto,
// no una ventana de baño. ⚠️ OJO: eso vale para un AMBIENTE. Como palabra dentro del RÓTULO DE UN
// VIDRIO sí significan «baño» — ese vocabulario vive en `vidrioCotizado.js` y es otro, a propósito.
//
// ⚠️ POR QUÉ NO SE USA `\b`, Y EL MOTIVO IMPORTA (la primera versión de este comentario decía un
// motivo FALSO y lo cazó Thermos en la compuerta): `\b` NO deja pasar «urbano» — probado, la `r` y
// la `b` son las dos caracteres de palabra, así que no hay borde. Lo que cobraba satén a «urbano»
// era la regex VIEJA del precio, que no tenía anclas de ningún tipo.
// El lookaround está por otra razón, que es la que no hay que desarmar: `\b` cuenta `_` y los
// DÍGITOS como letra, así que `\bbanos?\b` PIERDE «baño2», «wc2» y «bano_1», que son formas reales
// de numerar recintos. Medido: con `\b` las tres dan false; con el lookaround, las tres dan true.
// Si alguien «simplifica» esto a `\b`, se pierden esos recintos en silencio.
//
// 📏 MEDIDO el 11-10 contra la BD viva (365 días, 99 ambientes distintos escritos por vendedores):
// las 8 formas de baño que existen de verdad siguen matcheando («baño» 115, «baño visitas» 4,
// «baños» 3, «baño uno» 2, «baño 1» 2, «baños/despensa» 1, «baño visita» 1, «baño 1er piso» 1), y
// «urbano», «living urbano» y «waterloo» dejan de cobrar satén.
// `antebaño` está explícito porque la regex vieja del precio SÍ lo tomaba (por no tener anclas) y
// sacarlo habría sido cobrarle $42.679/m² en vez de $50.000 a un recinto que es un baño.
// 🔗 Defendido por `services/vidrioSatinado.espejo-del-precio.test.js`: si alguien vuelve a declarar
// un criterio propio en `enginePricer.js`, ese test se pone rojo.
const AMBIENTE_BANO = /(?<![a-z])(?:(?:ante)?ba[nñ]os?|wc|w\/c|water)(?![a-z])/;

/** ¿El rótulo del vidrio nombra un vidrio que NO se ve a través (satén, esmerilado, acidado, mate, opaco, translúcido)? */
export const dicePalabraSaten = (v) => PALABRAS_SATEN.test(sinTildes(v));

/** ¿El texto nombra un recinto que va con satén? Mismo criterio EXACTO que el precio. */
export const esAmbienteBano = (a) => AMBIENTE_BANO.test(sinTildes(a));

/** 🔴 [2026-10-11 · lo cazó Thermos en la compuerta] EL VOCABULARIO DEL *RÓTULO* ES OTRO, Y A
 *  PROPÓSITO. Arriba se decide si un AMBIENTE es una ventana de baño: ahí `ducha` y `bañera` NO
 *  entran, porque como recinto son una mampara de vidrio templado, otro producto (orden del dueño,
 *  11-10). Pero cuando esas palabras aparecen DENTRO DEL RÓTULO DE UN VIDRIO que escribió el LLM
 *  («vidrio de ducha», «termopanel bañera»), lo que están diciendo es «esto no es el claro que
 *  cotizó el motor» — y el dueño tiene que enterarse.
 *  Al unificar la regla del ambiente, ese aviso se apagó EN SILENCIO: el rótulo pasaba a
 *  reemplazarse por un termopanel claro sin que nadie avisara. Es justo la degradación silenciosa
 *  que este sistema tiene prohibida, y el mensaje del commit que la causó decía que no cambiaba
 *  nada. Por eso son dos listas separadas y cada una dice para qué es. */
const ROTULO_DE_BANO = /(?<![a-z])(?:(?:ante)?ba[nñ]os?|wc|w\/c|water|toilet|banera|ducha)(?![a-z])/;

/** ¿El RÓTULO de un vidrio nombra un vidrio de baño? (no sirve para clasificar un AMBIENTE) */
export const diceRotuloDeBano = (t) => ROTULO_DE_BANO.test(sinTildes(t));
