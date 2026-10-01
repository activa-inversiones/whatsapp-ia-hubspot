// services/telefono.js — normalización de teléfonos del bot, UNA sola copia (hoja: sin imports).
// Espejo de temp-sales-os/src/lib/telefono.js para `completo` (misma regla en los dos repos).
//
//  · digitos(v)            → solo los dígitos.
//  · completo(v)           → número COMPLETO con código de país: celular chileno sin código
//                            (9 dígitos que empiezan con 9) → '56' + número; 10 o más → tal cual;
//                            cualquier otro caso → '' (incompleto: no se usa para autorizar ni comparar).
//  · ult9(v)               → últimos 9 dígitos (8+ dígitos), para mostrar o cruzar con la lista vieja.
//  · normalizarChileno(v)  → como `completo` pero NUNCA vacía: devuelve los dígitos si no completa
//                            (la regla histórica de atribución: no inventa país ni completa 8 dígitos).
//  · esCelularChileno(v)   → 56 9 + 8 dígitos.
//  · claveTelefono(v)      → la clave de mapas/locks por teléfono: completo, o los dígitos.

export const digitos = (v) => String(v ?? '').replace(/\D/g, '');

export function completo(v) {
  const d = digitos(v);
  if (d.length === 9 && d.startsWith('9')) return `56${d}`;
  return d.length >= 10 ? d : '';
}

export function ult9(v) {
  const d = digitos(v);
  return d.length >= 8 ? d.slice(-9) : '';
}

export function normalizarChileno(v) {
  const d = digitos(v);
  if (!d) return '';
  if (d.length === 9 && d.startsWith('9')) return `56${d}`;
  return d;
}

export function esCelularChileno(v) {
  return /^569\d{8}$/.test(normalizarChileno(v));
}

export function claveTelefono(v) {
  return completo(v) || digitos(v);
}
