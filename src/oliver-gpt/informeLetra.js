// src/oliver-gpt/informeLetra.js — [2026-09-04]
// ═══════════════════════════════════════════════════════════════════════════
// DOS INFORMES DISTINTOS NO PUEDEN LLAMARSE IGUAL.
//
// Decision del dueño (#651), textual: *"2 informes distintos se llaman igual, deben
// diferenciarse igual que en propuesta como A B C D asi sucesivamente para no perderlos"*.
//
// 🔴 EL PROBLEMA, medido el 03-sep: el informe termico lleva ADENTRO la ventana del cliente
// (`suVidrio`, `suUw`, `suProducto`), asi que dos cotizaciones distintas en la misma comuna
// producen dos documentos DISTINTOS. Pero los dos salian como `Informe-Termico-Vilcun.pdf`.
// En el telefono del cliente el segundo PISA al primero al guardarlo, y no hay manera de
// saber cual corresponde a que ventana. De 86 informes termicos entregados en 14 dias, 84
// eran documentos distintos — casi todos compartiendo nombre.
//
// ⚠️ ESTO SE INTENTO ANTES Y SE REVIRTIO, y la historia importa para no repetirla: la primera
// version metia el CORRELATIVO ISO en el nombre
// (`Informe-Termico-Vilcun-CM-FR-006-2026-0093.pdf`) y rompio `webhook.informe.test.js:536`,
// que fija una decision deliberada — al cliente se le manda el nombre LEGIBLE a proposito, y
// el correlativo ya viaja en la copia de archivo de WorkDrive. Se reverte y se le pregunto al
// dueño. Eligio la letra, que resuelve las dos cosas: distingue sin volver el nombre un serial.
//
// ⚠️ POR QUE UN ALFABETO PROPIO Y NO EL DE LAS PROPUESTAS: `LETRAS_ALTERNATIVA` de
// propuestas-color.js empieza en **B**, porque ahi la primera propuesta NO lleva letra (el
// folio base ES la A). Aca la **A es explicita**, porque el dueño la pidio asi. Son dos
// reglas distintas para dos documentos distintos; una constante compartida tendria que hacer
// las dos cosas y se romperia la primera vez que alguien tocara una de las dos.
// ═══════════════════════════════════════════════════════════════════════════

export const LETRAS_INFORME = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * La letra que le toca al informe numero `i` (base 0) de este cliente.
 *
 * Pasado el alfabeto sigue con AA, AB, AC… en vez de repetir o romper: 26 informes al mismo
 * cliente no es un caso real, pero repetir la A seria volver al problema que esto arregla, y
 * lanzar dejaria al cliente sin informe por culpa de un nombre de archivo.
 */
export function letraDeInforme(i) {
  const n = Number(i);
  if (!Number.isFinite(n) || n < 0) return LETRAS_INFORME[0];
  const idx = Math.floor(n);
  if (idx < LETRAS_INFORME.length) return LETRAS_INFORME[idx];
  const alto = Math.floor(idx / LETRAS_INFORME.length) - 1;
  const bajo = idx % LETRAS_INFORME.length;
  return `${LETRAS_INFORME[alto] || 'Z'}${LETRAS_INFORME[bajo]}`;
}

/**
 * El nombre de archivo con su letra: `Informe-Termico-Vilcun.pdf` → `…-Vilcun-A.pdf`.
 *
 * DEGRADA al nombre de siempre cuando `i` no es un numero (null/undefined). Es deliberado y
 * es la regla de la casa: si el llamador no pudo contar —el KV caido, por ejemplo— tiene que
 * comportarse EXACTAMENTE como antes de este cambio. Un nombre repetido es molesto; un
 * informe que no sale porque no se pudo numerar es un cliente perdido.
 */
export function nombreConLetra(nombre, i) {
  const base = String(nombre || '');
  if (!base) return base;
  if (i === null || i === undefined) return base;
  const n = Number(i);
  if (!Number.isFinite(n)) return base;
  const sinExt = base.replace(/\.pdf$/i, '');
  return `${sinExt}-${letraDeInforme(n)}.pdf`;
}

export default { letraDeInforme, nombreConLetra, LETRAS_INFORME };
