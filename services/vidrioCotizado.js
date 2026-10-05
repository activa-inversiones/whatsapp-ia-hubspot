// vidrioCotizado.js — [2026-10-05] EL VIDRIO LO DECIDE EL MOTOR, como el precio y el Uw.
//
// `enginePricer.js` elige el vidrio de cada ventana (`pickGlassId`, por area y ambiente) y con
// ESE vidrio cobra y calcula el Uw. Una sola regla para WhatsApp (webhook.js) e IG/FB
// (channel-agent.js), y para las opciones A, B y C. Caso que la origino: propuesta 0588.
// Ramas probadas en vidrioCotizado.test.js.

/** Lo que se imprime cuando nadie sabe el vidrio (ni el LLM ni el motor). */
export const VIDRIO_RESPALDO = 'Termopanel DVH';

const _plano = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esBano = (t) => /saten|bano/.test(_plano(t));
const esOtroProducto = (t) => /low[\s-]?e|lamin|control\s*solar|asimetric|monolitic|selective/.test(_plano(t));

/** ¿El motor cotizo esta ventana? Mismo criterio que las sondas de color (sirve en `.every`). */
export function motorCotizo(cotizado) {
  return Boolean(cotizado) && Number(cotizado.unit_price) > 0 && cotizado.confidence === 'high';
}

/** El vidrio con que el motor cotizo, o null si no la cotizo o no trae vidrio. */
export function vidrioDelMotor(cotizado) {
  if (!motorCotizo(cotizado)) return null;
  return String(cotizado.glass_label || '').trim() || null;
}

/**
 * SOLO para el bloque del Uw de webhook.js, que recotiza con los datos del PDF: ¿el precio que
 * se imprime es el que el motor calculo ahora? Si no, salio de otro calculo (p. ej. con un
 * ambiente "baño" que el PDF perdio) y el vidrio de esta recotizacion no es el cobrado.
 */
export function precioCoincide(cotizado, precioImpreso) {
  if (!cotizado) return false;
  return Math.round(Number(precioImpreso)) === Math.round(Number(cotizado.unit_price));
}

/**
 * Que vidrio va al documento. `aviso` es para el log (va al tablero, no cambia nada):
 *  · 'vidrio.bano_perdido': la etiqueta dice satén/baño y el motor no ⇒ NO se reemplaza.
 *  · 'vidrio.producto_distinto': la etiqueta reemplazada describia otro producto (low-e,
 *    laminado...) que el motor no cotiza.
 */
export function elegirVidrio(etiqueta, vidrioMotor, { precioCoincide: coincide = true } = {}) {
  const actual = String(etiqueta || '').trim();
  if (!vidrioMotor) return { vidrio: actual, aviso: null };
  if (esBano(actual) && !esBano(vidrioMotor)) return { vidrio: actual, aviso: 'vidrio.bano_perdido' };
  if (!coincide) return { vidrio: actual, aviso: null };
  return { vidrio: vidrioMotor, aviso: esOtroProducto(actual) ? 'vidrio.producto_distinto' : null };
}

/** Aplica `elegirVidrio` sobre el item y junta el aviso en `avisos` (si se pasa). */
export function aplicarVidrio(item, vidrioMotor, { avisos = null, precioCoincide: coincide = true } = {}) {
  if (!item) return;
  const original = String(item.glass_label || '').trim();
  const { vidrio, aviso } = elegirVidrio(original, vidrioMotor, { precioCoincide: coincide });
  if (vidrio && vidrio !== original) item.glass_label = vidrio;
  if (aviso && Array.isArray(avisos)) avisos.push({ aviso, original, motor: vidrioMotor });
}

/** Loguea los avisos juntados, UNA vez cada uno, con el folio del documento. */
export function avisarVidrio(avisos, folio, logWarn) {
  const vistos = new Set();
  for (const a of avisos || []) {
    const k = `${a.aviso}|${a.original}|${a.motor}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    logWarn(a.aviso, `${folio}: etiqueta "${a.original}" · vidrio del motor "${a.motor}"`);
  }
}
