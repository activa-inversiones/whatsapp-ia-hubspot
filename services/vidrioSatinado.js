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
const AMBIENTE_BANO = /\bbanos?\b|\bwc\b|\btoilet|\bbanera|\bducha/;

/** ¿El rótulo del vidrio nombra un vidrio que NO se ve a través (satén, esmerilado, acidado, mate, opaco, translúcido)? */
export const dicePalabraSaten = (v) => PALABRAS_SATEN.test(sinTildes(v));

/** ¿El texto nombra un recinto que va con satén (baño, WC, toilet, bañera, ducha)? */
export const esAmbienteBano = (a) => AMBIENTE_BANO.test(sinTildes(a));
