// oliverOutOfCatalog.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — detección de pedido FUERA DE CATÁLOGO de Activa.
//
// BUG QUE RESUELVE (GT-05, 2026-06-10): cuando el cliente pide "vidrio para
// el shower / ducha / espejo / vidrio suelto", el LLM respondía:
//   "Le sugiero contactar a un proveedor especializado en vidrio"
// → el lead se moría y Oliver DERIVABA ACTIVAMENTE A LA COMPETENCIA.
//
// FIX: interceptar ANTES del LLM, responder sin mencionar competencia ni
// "proveedor especializado", y reconducir la conversación a lo que Activa
// SÍ ofrece (ventanas, mamparas de PVC, cierre de terraza, etc.).
//
// REGLA DE ORO: este módulo NUNCA inventa productos ni precios.
// Solo detecta y devuelve un mensaje de retención.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

// Términos que indican pedido fuera del catálogo de Activa.
// shower/ducha: vidrio de encuadre de ducha (Activa no fabrica piezas de vidrio suelto).
// espejo: espejos decorativos / de baño (tampoco).
// vidrio suelto / lámina de vidrio: cortado a medida sin marco (tampoco).
// NOTE: "mampara" aquí es SOLO "mampara de ducha/baño" (vidrio puro).
//   "mampara templada" o "cierre de terraza" las captura oliverProduct.js ANTES que este módulo.
const OUT_OF_CATALOG_TERMS = [
  'shower',
  'ducha',
  'espejo',
  'vidrio suelto',
  'vidrio solo',
  'lámina de vidrio',
  'lamina de vidrio',
  'vidrio cortado',
  'placa de vidrio',
  'cristal suelto',
  'cristal solo',
  'vidrio de baño',
  'mampara de ducha',
  'mampara de baño',
  'cancela de ducha',
  'cancela de baño',
];

// Contexto de MENCIÓN DE PASO: el cliente habla de lo viejo, no de pedir eso.
// Ejemplo: "tengo espejo roto y necesito ventanas" → NO es pedido de espejo.
const PASSING_CONTEXT = [
  'retiro', 'retirar', 'sacar', 'quitar',
  'roto', 'rota', 'rajado', 'rajada',
  'cambio de', 'cambiar', 'reemplaz',
  'viejas', 'viejos', 'antiguas', 'antiguos', 'existentes',
];

/**
 * Detecta si el mensaje es un pedido de producto fuera del catálogo de Activa.
 * @param {string} text  Mensaje del cliente (texto libre).
 * @returns {{ outOfCatalog: boolean, matched: string|null, passing: boolean }}
 *   outOfCatalog=true → responder con retención (NO derivar a competencia).
 *   passing=true       → mención de paso, NO interceptar (dejar fluir).
 */
export function detectOutOfCatalog(text) {
  const t = String(text || '').toLowerCase();
  const passing = PASSING_CONTEXT.some(c => t.includes(c));
  const matched = OUT_OF_CATALOG_TERMS.find(term => t.includes(term)) || null;
  // Mención de paso ("tengo espejo roto, busco ventanas") → NO interceptar
  const outOfCatalog = !!matched && !passing;
  return { outOfCatalog, matched, passing };
}

/**
 * Mensaje de retención para producto fuera de catálogo.
 * NO menciona "proveedor especializado", NO deriva a competencia.
 * Reconoce honestamente lo que Activa no fabrica, ofrece lo que SÍ hace,
 * y mantiene el lead vivo con una pregunta de apertura.
 *
 * @param {string} nombre  Nombre del cliente (puede ser vacío).
 * @returns {string}
 */
export function outOfCatalogRetentionMessage(nombre = '') {
  const saludo = nombre ? `, ${nombre}` : '';
  return `Ese tipo de vidrio no lo fabricamos nosotros${saludo} — nos especializamos en ventanas y puertas de PVC termopanel y cierres de terraza. 😊 Pero cuéntame: ¿hay ventanas o mamparas en tu proyecto que quieras cambiar o mejorar? Muchas veces los clientes llegan por el vidrio y terminan renovando toda la ventanería — y ahí sí te puedo cotizar algo concreto hoy.`;
}
