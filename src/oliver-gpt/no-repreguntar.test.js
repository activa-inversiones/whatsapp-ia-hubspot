import test from 'node:test';
import assert from 'node:assert/strict';
import { extractComuna, extraerColor } from './normalizers.js';

/* =========================================================================
 * 🔴 OLIVER PREGUNTABA DOS VECES LO QUE EL CLIENTE YA HABIA DICHO (2026-09-18)
 *
 * Reclamo del dueño, textual: *"contesta horrible porque pide 2 veces las mismas cosas; le digo
 * color blanco y me pide color, me pide comuna y ya se la habían enviado"*.
 *
 * El mensaje REAL del cliente, primera linea de la conversacion:
 *     "soy a nombre de MARIO GREY comuna de vilcul y color blanco necesito lo siguiente"
 *
 * Y lo que se midio:
 *   · `extractComuna(...)` -> null. Escribio "vilcuL" con L. La comuna no se guardaba, Oliver
 *     la preguntaba, el cliente contestaba "ya te dije", Oliver se disculpaba ("no le voy a
 *     volver a preguntar")... y la VOLVIA A PREGUNTAR en el mismo mensaje, porque seguia sin
 *     tenerla. No era el LLM portandose mal: era que el dato no existia.
 *   · el COLOR no se extraia NUNCA: agent.js solo llamaba a extractComuna. `colorFueExplicito`
 *     y `normColor` existian hace meses, sin conectar.
 * ========================================================================= */

test('🔴 el mensaje REAL del cliente deja comuna Y color, de una', () => {
  const t = 'soy a nombre de MARIO GREY comuna de vilcul y color blanco necesito lo siguiente';
  assert.equal(extractComuna(t), 'Vilcún', 'la comuna, aunque escriba "vilcuL"');
  assert.equal(extraerColor(t), 'BLANCO', 'y el color, que antes no se miraba nunca');
});

test('🔒 la tolerancia es de UNA letra y no inventa comunas', () => {
  // Bien escritas, como siempre.
  for (const [t, e] of [
    ['comuna de vilcun', 'Vilcún'], ['temuco', 'Temuco'], ['padre las casas', 'Padre Las Casas'],
    ['villarrica', 'Villarrica'], ['pucon', 'Pucón'], ['freire', 'Freire'], ['cunco', 'Cunco'],
  ]) assert.equal(extractComuna(t), e, t);
  // Lo que NO es una comuna nuestra sigue sin serlo. Si no esta, Oliver pregunta — que es lo
  // correcto: se tolera un typo, no se adivina un destino de despacho.
  for (const t of ['no dice comuna', 'santiago', 'valparaiso', 'buenos aires']) {
    assert.equal(extractComuna(t), null, t);
  }
});

test('🔒 el color solo cuenta si el cliente lo dijo como color', () => {
  assert.equal(extraerColor('color blanco'), 'BLANCO');
  assert.equal(extraerColor('ventanas blancas'), 'BLANCO');
  assert.equal(extraerColor('no digo color'), null);
  assert.equal(extraerColor(''), null);
  assert.equal(extraerColor(null), null);
});
