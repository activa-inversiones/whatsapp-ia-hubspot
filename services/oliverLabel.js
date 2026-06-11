// oliverLabel.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — etiqueta correcta de tipo por ÍTEM (gap G4, auditoría 2026-06-10).
//
// BUG QUE RESUELVE: el resumen de cotización usaba un tipo GLOBAL por defecto
// ("CORREDERA") en vez del tipo real de cada ítem. Casos reales:
//   - 07af59d0: una "puerta corredera" apareció como "Ventana corredera".
//   - 096cd370: un ítem "fijo" apareció como "CORREDERA".
// Daña la confianza del cliente en plena cotización.
//
// FIX: derivar el tipo DESDE el ítem mismo (campo tipo/apertura, o desde el
// nombre del producto), nunca desde un default global. Si no hay información
// → devolver "" (vacío), NO inventar "corredera".
//
// REGLA DE ORO: NUNCA llamar "Ventana" a una puerta ni "Puerta" a una ventana.
//               NUNCA forzar "corredera" si el ítem es fijo o proyectante.
// Módulo PURO, testeable, sin side-effects.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

// Aperturas válidas en el catálogo Winart / ACTIVA Engine.
export const APERTURAS_VALIDAS = ['CORREDERA', 'PROYECTANTE', 'FIJA', 'BATIENTE', 'OSCILOBATIENTE'];

// Mapa apertura normalizada → etiqueta legible en español.
const APERTURA_LABEL_MAP = {
  CORREDERA:      'corredera',
  PROYECTANTE:    'proyectante',
  FIJA:           'fija',
  BATIENTE:       'batiente',
  OSCILOBATIENTE: 'oscilobatiente',
};

// Palabras clave de apertura que pueden aparecer dentro del nombre del producto.
// Orden importa: "oscilobatiente" antes de "batiente" para no cortar.
const APERTURA_KEYWORDS = [
  ['oscilobatiente', 'OSCILOBATIENTE'],
  ['batiente',       'BATIENTE'],
  ['proyectante',    'PROYECTANTE'],
  ['corredera',      'CORREDERA'],
  ['fijo',           'FIJA'],
  ['fija',           'FIJA'],
  ['marco fijo',     'FIJA'],
];

/**
 * Clasifica el ítem como 'puerta' | 'ventana' | 'mampara' | 'otro'.
 * La lógica es estrictamente descriptiva: se basa en el nombre del producto,
 * sin asumir nada que no esté en el texto.
 * @param {{ product?: string }} item
 * @returns {'puerta'|'ventana'|'mampara'|'otro'}
 */
export function productKind(item) {
  const p = String(item?.product || '').toLowerCase().trim();
  if (!p) return 'ventana'; // default conservador para ítems sin nombre
  if (p.includes('puerta')) return 'puerta';
  if (p.includes('mampara')) return 'mampara';
  // ventana, marco, fijo, corredera, proyectante → ventana
  if (
    p.includes('ventana') ||
    p.includes('marco') ||
    p.includes('fijo') ||
    p.includes('fija') ||
    p.includes('corredera') ||
    p.includes('proyectante')
  ) return 'ventana';
  return 'ventana'; // default: ventana (productos PVC más comunes)
}

/**
 * Devuelve la etiqueta legible de apertura DEL ÍTEM (no un default global).
 * Orden de prioridad:
 *   1. item.tipo  (campo explícito del cotizador/motor)
 *   2. item.apertura
 *   3. Deducción desde item.product (keywords)
 * Si ninguna fuente da información válida → devuelve "" (NUNCA inventa).
 * @param {{ tipo?: string, apertura?: string, product?: string }} item
 * @returns {string}
 */
export function aperturaLabel(item) {
  // 1. Fuentes explícitas: item.tipo / item.apertura
  for (const fuente of [item?.tipo, item?.apertura]) {
    if (!fuente) continue;
    const key = String(fuente).trim().toUpperCase();
    if (APERTURA_LABEL_MAP[key]) return APERTURA_LABEL_MAP[key];
  }

  // 2. Deducir desde el nombre del producto
  const p = String(item?.product || '').toLowerCase().trim();
  if (p) {
    for (const [kw, apertura] of APERTURA_KEYWORDS) {
      if (p.includes(kw)) return APERTURA_LABEL_MAP[apertura];
    }
  }

  // 3. Sin información → vacío, no inventar
  return '';
}

/**
 * Etiqueta completa del ítem: combina kind + apertura en Title Case (primera palabra).
 * Ejemplos:
 *   puerta + corredera  → "Puerta corredera"
 *   ventana + fija      → "Ventana fija"
 *   ventana + proyectante → "Ventana proyectante"
 *   mampara             → "Mampara"
 *   ventana + ""        → "Ventana"
 * NUNCA llama "Ventana" a una puerta ni "Puerta" a una ventana.
 * NUNCA fuerza "corredera" si el ítem es fijo u otro tipo.
 * @param {{ product?: string, tipo?: string, apertura?: string }} item
 * @returns {string}
 */
export function itemTypeLabel(item) {
  const kind = productKind(item);

  // Capitaliza solo la primera letra de la primera palabra.
  const kindLabel = kind.charAt(0).toUpperCase() + kind.slice(1);

  const ap = aperturaLabel(item);
  if (!ap) return kindLabel;
  return `${kindLabel} ${ap}`;
}
