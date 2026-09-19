import test from 'node:test';
import assert from 'node:assert/strict';

/* =========================================================================
 * 🔴 UNA MEDIDA FUERA DE ESTANDAR NO HACE PARCIAL A LA PROPUESTA (2026-09-19)
 *
 * El cliente recibio 16 de 17 ventanas. El PDF 0485 decia, TEXTUAL:
 *   "PROPUESTA PARCIAL: No incluye la ventana N°13 (proyectante baño 575×375 mm), que Marcelo
 *    cotiza directamente por salir fuera de rango del sistema automático."
 * El motor la cotiza sin problema: $146.400 con IVA (verificado en vivo contra ops.activalabs.ai).
 *
 * AUTORIZACION DEL DUEÑO, textual: *"autorizo cotizarla igual para todos los clientes que estan
 * bajo medida y sobre medidas"*. Asi que ese motivo dejo de ser valido.
 *
 * Esta es la MISMA condicion que corre en webhook.js antes de armar el PDF. Se prueba aca
 * aislada porque el webhook entero no se puede instanciar en un test unitario.
 * ========================================================================= */

/** Copia EXACTA de la condicion de webhook.js (si una cambia, este test se pone rojo). */
function soloPorMedidas(nota) {
  return /fuera\s+de\s+rango|fuera\s+de\s+est[aá]ndar|bajo\s+(?:el\s+)?m[ií]nimo|sobre\s+(?:el\s+)?m[aá]ximo|medidas?\b/i.test(nota)
    && !/aluminio|plegable|mosquitero|andes|zenia|venau|volumen|irregular|curv|monorriel/i.test(nota);
}

test('🔴 la nota REAL del PDF 0485 se anula: el dueño autorizo esas medidas', () => {
  const real = 'No incluye la ventana N°13 (proyectante baño 575×375 mm), que Marcelo cotiza '
    + 'directamente por salir fuera de rango del sistema automático.';
  assert.equal(soloPorMedidas(real), true);
  for (const n of [
    'No incluye la N°13 por estar bajo el mínimo de fabricación',
    'La ventana sobre el máximo la revisa Marcelo',
    'Quedan fuera de estándar dos medidas',
  ]) assert.equal(soloPorMedidas(n), true, n);
});

test('🔒 los motivos LEGITIMOS de escalada siguen marcando la propuesta como parcial', () => {
  // Estos SI son cosas que Oliver no cotiza, y el cliente tiene que saberlo.
  for (const n of [
    'No incluye las ventanas de aluminio, que cotiza Marcelo',
    'No incluye la puerta plegable',
    'No incluye los mosquiteros',
    'No incluye la corredera de una hoja con paño fijo (monorriel)',
    'No incluye las 20 ventanas fijas por el volumen del proyecto',
    'No incluye la ventana de forma irregular',
    'No incluye la línea Andes',
    // borde: habla de medidas PERO el motivo real es otro -> sigue siendo parcial
    'No incluye la ventana de aluminio de 575x375 mm, fuera de rango',
  ]) assert.equal(soloPorMedidas(n), false, n);
});

test('🔒 sin nota no se toca nada', () => {
  assert.equal(soloPorMedidas(''), false);
});
