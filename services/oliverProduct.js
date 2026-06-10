// oliverProduct.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — clasificación de "producto especial" para handoff CÁLIDO.
//
// CONTEXTO (audit 2026-06-10 #A + dato del dueño): Activa FABRICA mamparas
// templadas, terrazas, aluminio, muro cortina, lucarnas — pero el COTIZADOR aún
// no les calcula precio (los $/m² quedan "para después"). El bot ANTES cortaba
// en FRÍO cualquier mensaje con esas palabras (escalación ciega) — y peor, también
// cortaba MENCIONES DE PASO ("retiro de ventanas viejas de aluminio", donde el
// cliente en realidad quiere ventanas PVC nuevas). Resultado: leads muertos.
//
// FIX: este módulo decide si es un PEDIDO REAL de producto especial (→ handoff
// CÁLIDO que captura: "sí lo fabricamos, te paso con un especialista") vs una
// MENCIÓN DE PASO (→ NO escalar, dejar que fluya al flujo de cotización PVC).
// NUNCA inventa precio. La lista NO se quita: se vuelve handoff cálido, no corte.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

// Productos que Activa fabrica pero el cotizador aún NO precia → handoff cálido.
const SPECIAL_PRODUCTS = [
  'templado', 'vidrio templado', 'mampara', 'cierre de terraza', 'cierre terraza',
  'celosia', 'celosía', 'cortina', 'reja', 'muro cortina', 'lucarna', 'lucarnas',
];
// "aluminio" se trata aparte: es producto (ventana/puerta de aluminio = handoff)
// PERO también aparece en menciones de paso ("retiro de aluminio" = quiere PVC).

// Contexto de MENCIÓN DE PASO: el cliente habla de sacar/cambiar lo viejo, no de
// pedir ese producto. En ese caso NO se escala — fluye a cotizar PVC nuevo.
const PASSING_CONTEXT = ['retiro', 'retirar', 'sacar', 'quitar', 'cambio de', 'cambiar', 'reemplaz', 'viejas', 'viejos', 'antiguas', 'antiguos', 'existentes'];

/**
 * Clasifica el mensaje del cliente.
 * @returns {{ specialRequest: boolean, matched: string|null, passing: boolean }}
 *   specialRequest=true → handoff CÁLIDO (Activa lo fabrica, especialista da el valor).
 *   passing=true        → mención de paso, NO escalar (dejar fluir a cotizar PVC).
 */
export function classifyProduct(text) {
  const t = String(text || '').toLowerCase();
  const passing = PASSING_CONTEXT.some(c => t.includes(c));

  let matched = SPECIAL_PRODUCTS.find(p => t.includes(p)) || null;
  // aluminio: solo cuenta como pedido especial si NO es mención de paso
  if (!matched && t.includes('aluminio') && !passing) matched = 'aluminio';

  // Si hay producto especial Y es mención de paso ("cambiar mis mamparas viejas")
  // → NO es pedido del especial; deja fluir (probablemente quiere PVC).
  const specialRequest = !!matched && !passing;
  return { specialRequest, matched, passing };
}

// Mensaje CÁLIDO de handoff (afirma que SÍ se fabrica, captura, pide hora).
export function warmHandoffMessage(matched, agente, nombre = '') {
  const saludo = nombre ? `, ${nombre}` : '';
  const prod = matched ? `tu ${matched}` : 'eso';
  return `¡Sí${saludo}, eso lo fabricamos! 🙌 Para darte el valor exacto de ${prod} te paso con ${agente}, nuestro especialista. ¿A qué hora te queda bien que te contacte hoy?`;
}
