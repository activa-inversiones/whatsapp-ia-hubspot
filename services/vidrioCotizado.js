// vidrioCotizado.js — [2026-10-05] EL VIDRIO LO DECIDE EL MOTOR, como el precio y el Uw.
//
// `enginePricer.js` elige el vidrio de cada ventana (`pickGlassId`, por area y ambiente) y con
// ESE vidrio cobra y calcula el Uw. Una sola regla para WhatsApp (webhook.js) e IG/FB
// (channel-agent.js), y para las opciones A, B y C. Caso que la origino: propuesta 0588.
// Ramas probadas en vidrioCotizado.test.js.

/** ¿El motor cotizo esta ventana? Mismo criterio que las sondas de color de los dos canales. */
export function motorCotizo(cotizado) {
  return Boolean(cotizado) && Number(cotizado.unit_price) > 0 && cotizado.confidence === 'high';
}

/**
 * El vidrio con que el motor calculo EL PRECIO QUE SE IMPRIME, o null si no se puede afirmar:
 * el motor no la cotizo, no trae vidrio, o el precio impreso es otro (salio de otro calculo,
 * p. ej. con un ambiente "baño" que el PDF perdio: entonces el vidrio cobrado no es este).
 */
export function vidrioDelPrecio(cotizado, precioImpreso) {
  if (!motorCotizo(cotizado)) return null;
  const vidrio = String(cotizado.glass_label || '').trim();
  if (!vidrio) return null;
  if (Math.round(Number(precioImpreso)) !== Math.round(Number(cotizado.unit_price))) return null;
  return vidrio;
}

/** Pone en el item el vidrio cobrado, si se puede afirmar. Devuelve el vidrio puesto o null. */
export function aplicarVidrioDelMotor(item, cotizado) {
  if (!item) return null;
  const vidrio = vidrioDelPrecio(cotizado, item.unit_price);
  if (vidrio) item.glass_label = vidrio;
  return vidrio;
}
