// burbujas.js — parte una respuesta larga en varias burbujas de WhatsApp. ESM, sin deps.
//
// [2026-08-08] Esta función VIVÍA dentro de index.js (smartSplitForWhatsApp, línea ~1776) y
// solo la usaba el V1. El cerebro que atiende hoy (src/oliver-gpt/webhook.js) mandaba un
// párrafo largo de una sola burbuja — una de las señales por las que un cliente notó que
// hablaba con una IA. Se MUEVE acá (no se copia) para que los dos caminos usen la misma:
// este repo ya se comió un bug caro por tener tres copias del mismo parser.
//
// Lógica intacta respecto del original: párrafos > oraciones > líneas > corte por espacio.

export const MAX_CARACTERES_BURBUJA = Number(process.env.WA_MAX_BUBBLE_CHARS || 320);

/**
 * @param {string} texto
 * @returns {string[]} una o más burbujas, en orden.
 */
export function partirEnBurbujas(texto) {
  if (!texto || texto.length <= MAX_CARACTERES_BURBUJA) return [texto];

  // 1) Por párrafos (doble salto de línea), re-uniendo los que quedan muy cortos.
  const parrafos = texto.split(/\n\n+/).filter(Boolean);
  if (parrafos.length > 1) {
    const unidos = [];
    let actual = "";
    for (const p of parrafos) {
      if (actual && (actual.length + p.length + 2) > MAX_CARACTERES_BURBUJA) {
        unidos.push(actual.trim());
        actual = p;
      } else {
        actual = actual ? actual + "\n\n" + p : p;
      }
    }
    if (actual.trim()) unidos.push(actual.trim());
    if (unidos.length > 1) return unidos;
  }

  // 2) Por oraciones.
  const oraciones = texto.match(/[^.!?]+[.!?]+\s*/g);
  if (oraciones && oraciones.length > 1) {
    const res = [];
    let actual = "";
    for (const o of oraciones) {
      if (actual && (actual.length + o.length) > MAX_CARACTERES_BURBUJA) {
        res.push(actual.trim());
        actual = o;
      } else {
        actual += o;
      }
    }
    if (actual.trim()) res.push(actual.trim());
    if (res.length > 1) return res;
  }

  // 3) Por saltos de línea simples.
  const lineas = texto.split(/\n/).filter(Boolean);
  if (lineas.length > 1) {
    const res = [];
    let actual = "";
    for (const l of lineas) {
      if (actual && (actual.length + l.length + 1) > MAX_CARACTERES_BURBUJA) {
        res.push(actual.trim());
        actual = l;
      } else {
        actual = actual ? actual + "\n" + l : l;
      }
    }
    if (actual.trim()) res.push(actual.trim());
    return res;
  }

  // 4) Último recurso: cortar en el espacio anterior al límite.
  const res = [];
  let resto = texto;
  while (resto.length > MAX_CARACTERES_BURBUJA) {
    let corte = resto.lastIndexOf(" ", MAX_CARACTERES_BURBUJA);
    if (corte < 100) corte = MAX_CARACTERES_BURBUJA;
    res.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto.trim()) res.push(resto.trim());
  return res;
}

export default partirEnBurbujas;
