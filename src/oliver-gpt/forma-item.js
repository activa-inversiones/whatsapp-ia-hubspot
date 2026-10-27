// forma-item.js — [2026-10-27]
//
// LA FORMA DE UNA VENTANA, DE VUELTA AL MOTOR. Cuando el bot re-cotiza un item al emitir el PDF (sonda de
// color, revisión de precio, pending_quote), tiene que mandarle al pricer la MISMA forma que el motor publicó:
// los paños de la puerta con postes T (`puerta.panos`) y las divisiones del triángulo (`triangular.divisiones`).
// Vivía copiado en seis sitios (channel-agent ×3, webhook ×3): la lección del 06-oct (las hojas que se perdían
// al re-cotizar por etiqueta) es exactamente lo que pasa cuando una copia queda atrás. Thermos (calidad A5) lo
// pidió en un solo lugar; acá está.
//
// `alto_util_mm` (lo que el motor calculó) vuelve como `alto_mm`: el motor trata los altos de los paños como
// PROPORCIONES sobre el alto útil de la hoja, así que la geometría se reproduce igual (hay un test de ida y
// vuelta en sales-os: quoteEngine.formas1600.test.mjs).

/** @returns {{ puerta_panos?: Array<{relleno:string, alto_mm:number}>, divisiones_triangulo?: number }} */
export function formaParaReCotizar(it) {
  const out = {};
  const panos = it && it.puerta && Array.isArray(it.puerta.panos) ? it.puerta.panos : null;
  const label = `${String(it?.producto_label || '')} ${String(it?.product || '')} ${String(it?.producto || '')}`;
  if (panos && panos.length) {
    out.puerta_panos = panos.map((p) => ({ relleno: p.relleno, alto_mm: p.alto_mm ?? p.alto_util_mm }));
  } else {
    // [Codex r1 #5] ÚLTIMA RED POR ETIQUETA, la misma que usa el dibujo (`panosPuertaDe`): un item viejo guardado solo
    // con su label («· 2 paños (1 poste T): vidrio / machihembrado») vuelve con sus paños, no como puerta lisa.
    const m = /\d+\s*pa[ñn]os?[^:]*:\s*((?:vidrio|machihembrado)(?:\s*\/\s*(?:vidrio|machihembrado))*)/i.exec(label);
    if (m) out.puerta_panos = m[1].split('/').map((s) => ({ relleno: /machi/i.test(s) ? 'MACHIHEMBRADO' : 'VIDRIO' }));
  }
  const div = it && it.triangular ? it.triangular.divisiones : undefined;
  if (div !== undefined && div !== null) {
    out.divisiones_triangulo = div;
  } else if (/triangular/i.test(label)) {
    const m = /(\d)\s*pa[ñn]os?/i.exec(label);
    if (m) out.divisiones_triangulo = Number(m[1]);
  }
  return out;
}

export default formaParaReCotizar;
