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
// Hasta hoy había DOS definiciones de «esto es un baño»: esta (que manda el DIBUJO y el aviso al
// dueño) y la de `enginePricer.js` (que manda el PRECIO), y NO coincidían en 6 de 12 palabras.
// Consecuencia: una ventana podía dibujarse con vidrio opaco y cobrarse con vidrio claro, o al
// revés — el documento contradiciendo al cobro en una propuesta formal.
// Se alineó al PRECIO, nunca al revés: lo que se cobra manda, y así el cambio no mueve ni un peso.
// Medido ese día: 0 casos reales en 120 días (de 602 ambientes escritos, 129 dicen baño y NINGUNO
// dice wc, toilet, ducha ni bañera) ⇒ esto cierra un hueco dormido, no una fuga.
// ⛔ `ducha` y `bañera` salieron A PROPÓSITO — HECHO DEL NEGOCIO (dueño, textual 2026-10-11):
// «DUCHA ES MAMPARA DE VIDRIO TEMPLADA Y BAÑERA ES MAMPARA DE VIDRIO TEMPLADA». Son otro producto,
// no una ventana de baño. Sacarlas no quita ni un satén que hoy se cobre —el precio nunca las
// consideró baño—: lo único que cambia es que el dibujo deja de contradecirlo.
// 🔗 Si alguien cambia una de las dos, `vidrioSatinado.espejo-del-precio.test.js` se pone rojo.
// ⚠️ MISMO cuidado que PALABRAS_SATEN: NO se usa ``. Se exige que no haya una LETRA pegada a los
// lados, porque `` deja pasar «urbano» (la `r` no es borde) y porque `_` y los dígitos cuentan
// como letra para ``. MEDIDO el 11-10 contra la BD viva (365 días, 602 ambientes escritos): con
// la versión sin bordes, «urbano», «sector urbano», «living urbano» y «waterloo» se COBRABAN satén
// ($50.000/m² en vez de $42.679) — nunca ocurrió, pero estaba vivo. El único ambiente real que no
// es un «baño» pelado y sí matchea es «baños/despensa», y ese SÍ es un baño: sigue matcheando.
const AMBIENTE_BANO = /(?<![a-z])(?:ba[nñ]os?|wc|w\/c|water)(?![a-z])/;

/** ¿El rótulo del vidrio nombra un vidrio que NO se ve a través (satén, esmerilado, acidado, mate, opaco, translúcido)? */
export const dicePalabraSaten = (v) => PALABRAS_SATEN.test(sinTildes(v));

/** ¿El texto nombra un recinto que va con satén? Mismo criterio EXACTO que el precio. */
export const esAmbienteBano = (a) => AMBIENTE_BANO.test(sinTildes(a));
