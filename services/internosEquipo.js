// services/internosEquipo.js — [#1059 b, 2026-09-30] "Oliver interno": la lista del equipo.
//
// Pedido del dueño: las personas que cotizan como vendedores las carga ÉL en el cockpit
// (/equipo de sales-os, con su WhatsApp). Todo lo que llega de esos números es INTERNO:
//   · Oliver NO les manda seguimientos ni plantillas de seguimiento (el follow-up de 2 h,
//     el monitor de "lead pegado" y el re-enganche);
//   · si el dueño le prendió «Cotizar con Oliver en modo interno», Oliver les responde en
//     modo interno: cotización rápida, sin calificar ni ofrecer seguimiento.
//
// FUENTE ÚNICA: sales-os (GET /internal/equipo/internos, token operador — el mismo que ya usa
// el bot para /internal/agenda/*). El bot NO tiene lista propia: la lee cada 5 min.
// Si sales-os no contesta, se queda con la ÚLTIMA lista buena (nunca la vacía por un error),
// y mientras no haya ninguna, nadie es interno por esta vía — el comportamiento de siempre
// (oliverFollowup ya excluye al dueño por env).
//
// NO decide qué se reporta a Meta/Google (eso vive en sales-os, numerosInternos.js).

export const REFRESCO_MS = 5 * 60 * 1000;

export function ultimos9(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-9) : '';
}

let _estado = { at: 0, internos: new Set(), modoInterno: new Set() };

/** Aplica la respuesta de sales-os ({internos_ult9, vendedores:[{ult9, oliver_interno}]}). */
export function aplicarLista(data, ahora = Date.now()) {
  if (!data || !Array.isArray(data.internos_ult9)) return false;
  const internos = new Set(data.internos_ult9.map(ultimos9).filter(Boolean));
  const modoInterno = new Set(
    (Array.isArray(data.vendedores) ? data.vendedores : [])
      .filter((v) => v && v.oliver_interno === true)
      .map((v) => ultimos9(v.ult9))
      .filter(Boolean),
  );
  _estado = { at: ahora, internos, modoInterno };
  return true;
}

/** Solo tests. */
export function _reiniciarParaTests() { _estado = { at: 0, internos: new Set(), modoInterno: new Set() }; }

/** ¿El número es del equipo (dueño, bot o vendedor activo con WhatsApp cargado)? Síncrono. */
export function esNumeroDelEquipo(phone) {
  const k = ultimos9(phone);
  return !!k && _estado.internos.has(k);
}

/** ¿Oliver le responde en modo interno? Solo si es del equipo Y el dueño lo autorizó. */
export function modoInternoOliver(phone) {
  const k = ultimos9(phone);
  return !!k && _estado.internos.has(k) && _estado.modoInterno.has(k);
}

export function estadoLista() {
  return { cargada: _estado.at > 0, at: _estado.at, internos: _estado.internos.size, modo_interno: _estado.modoInterno.size };
}

/**
 * Pide la lista a sales-os. Nunca lanza. Devuelve true si la aplicó.
 * @param {{url?:string, token?:string, fetchFn?:Function}} [o]
 */
export async function refrescarInternos({
  url = process.env.SALES_OS_URL || '',
  token = process.env.SALES_OS_OPERATOR_TOKEN || process.env.INTERNAL_OPERATOR_TOKEN || '',
  fetchFn = globalThis.fetch,
} = {}) {
  if (!url || !token || typeof fetchFn !== 'function') return false;
  try {
    const r = await fetchFn(`${url.replace(/\/$/, '')}/internal/equipo/internos`, {
      headers: { 'x-api-key': token },
      signal: AbortSignal.timeout(10000),
    });
    if (!r || !r.ok) return false;
    const j = await r.json().catch(() => null);
    if (!j || j.ok !== true) return false;
    return aplicarLista(j.data);
  } catch {
    return false; // se queda con la última lista buena
  }
}

let _timer = null;
/** Arranca el refresco periódico (idempotente; el timer no retiene el proceso). */
export function iniciarRefrescoInternos(opciones = {}) {
  if (_timer) return;
  refrescarInternos(opciones).catch(() => {});
  _timer = setInterval(() => { refrescarInternos(opciones).catch(() => {}); }, REFRESCO_MS);
  if (typeof _timer.unref === 'function') _timer.unref();
}

export const TEXTO_MODO_INTERNO = [
  '',
  '🟦 ═══ MODO INTERNO: TE ESCRIBE ALGUIEN DEL EQUIPO DE ACTIVA, NO UN CLIENTE. ═══',
  'Es un vendedor de la empresa cotizando para un cliente suyo. Reglas de este turno:',
  '• Cotización RÁPIDA: con medidas, producto y color, cotiza directo. No hagas preguntas de calificación comercial (presupuesto, plazos, "¿para cuándo lo necesita?").',
  '• NO ofrezcas seguimiento, visita, llamada ni "le escribo mañana": él maneja al cliente.',
  '• Trato directo y breve, de colega. Nada de saludos de bienvenida ni presentación de la empresa.',
  '• Si falta un dato para cotizar (medida, color, comuna), pídelo en una sola línea. No inventes datos.',
].join('\n');
