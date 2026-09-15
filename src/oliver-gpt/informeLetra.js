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
export function nombreConLetra(nombre, i, folio) {
  const base = String(nombre || '');
  if (!base) return base;
  const sinExt = base.replace(/\.pdf$/i, '');
  const n = Number(i);
  const letra = (i === null || i === undefined || !Number.isFinite(n)) ? '' : `-${letraDeInforme(n)}`;
  // 🔴 [2026-09-04 · correccion del dueño] EL CORRELATIVO ISO VA EN EL NOMBRE.
  // Textual: *"pero debe tener el correlativo de registro ISO o no esta dentro del ISO"*.
  // Tenia razon y mi version anterior se quedaba corta: la letra distingue un archivo de
  // otro para el cliente, pero NO lo amarra al registro. Un documento formal cuyo nombre no
  // permite encontrarlo en el registro no esta dentro del sistema de gestion — es lo unico
  // que un auditor mira antes de abrirlo.
  // Se limpia a `[\w-]` porque el nombre viaja a Meta y a WorkDrive: un caracter raro en el
  // nombre de archivo se convierte en un envio rechazado.
  const iso = folio ? `-${String(folio).replace(/[^\w-]/g, '')}` : '';
  // Si no hay ni letra ni folio, se devuelve el nombre de siempre: degradar al comportamiento
  // anterior es preferible a frenar un envio por no poder numerarlo.
  if (!letra && !iso) return base;
  return `${sinExt}${letra}${iso}.pdf`;
}

/**
 * Agrega el correlativo ISO al nombre SOLO si todavía no lo trae.
 *
 * 🔴 BUG QUE RESUELVE (medido 15-sep-2026 en el WorkDrive del dueño, carpeta
 * ISO ACTIVA / ISO REGISTROS / COTIZACIONES (CM-FR-004)):
 *   Informe-Termico-Temuco-A-CM-FR-006-2026-0169-CM-FR-006-2026-0169.pdf
 *   Informe-Vientos-Temuco-A-CM-FR-007-2026-0053-CM-FR-007-2026-0053.pdf
 * El correlativo aparecía DOS VECES en cada informe archivado.
 *
 * Causa: el 04-sep se agregó el folio dentro de `nombreConLetra` (corrección del
 * dueño: *"debe tener el correlativo de registro ISO o no está dentro del ISO"*),
 * pero quedaron vivos los dos `replace(/\.pdf$/i, `-${folio}.pdf`)` que ya hacían
 * lo mismo antes: webhook.js:1956 (térmico) y webhook.js:3381 (vientos). Sus
 * comentarios siguen diciendo que al cliente le llega el nombre SIN correlativo
 * — eso dejó de ser cierto ese día, y nadie volvió a mirarlo.
 *
 * No es cosmético: el nombre del archivo ES el índice del registro ISO 9001 §7.5.
 * Un auditor busca `CM-FR-006-2026-0169` y encuentra un nombre que no coincide
 * con el correlativo impreso en la portada.
 *
 * @param {string} nombre  nombre de archivo, con o sin el correlativo ya puesto
 * @param {string} folio   correlativo ISO (ej. `CM-FR-006-2026-0169`)
 * @returns {string}
 */
export function conCorrelativoUnaVez(nombre, folio) {
  const base = String(nombre || '');
  if (!base || !folio) return base;
  const f = String(folio).replace(/[^\w-]/g, '');
  if (!f) return base;
  // Ya lo trae (lo puso `nombreConLetra`): se devuelve tal cual.
  if (base.includes(f)) return base;
  return base.replace(/\.pdf$/i, '') + `-${f}.pdf`;
}

export default { letraDeInforme, nombreConLetra, conCorrelativoUnaVez, LETRAS_INFORME };
