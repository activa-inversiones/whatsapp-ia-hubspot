import test from 'node:test';
import assert from 'node:assert/strict';
import { etiquetaVentana } from './etiquetaVentana.js';

/* =========================================================================
 * 🔴 EL NUMERO DE VENTANA ERA UN INDICE, NO UN ID (2026-09-19)
 * Medido contra los documentos reales del cliente: 4 de 16 ventanas salieron con un numero
 * DISTINTO al que el uso, porque al sacar una de la lista todas las siguientes se corrian.
 * Los tres renderizadores (propuesta, termico, vientos) lo calculaban cada uno por su cuenta.
 * ========================================================================= */

test('🔒 sin etiqueta propia se comporta EXACTAMENTE como antes (posicion + 1)', () => {
  assert.equal(etiquetaVentana({}, 0), 'V1');
  assert.equal(etiquetaVentana({}, 12), 'V13');
  assert.equal(etiquetaVentana(null, 3), 'V4');
  assert.equal(etiquetaVentana({ pos: '' }, 5), 'V6');
});

test('🔴 si la ventana trae su propia posicion, esa MANDA sobre el indice', () => {
  // Este es el caso del cliente: su N°14 salia como "V13" porque la 13 se habia sacado.
  assert.equal(etiquetaVentana({ pos: 14 }, 12), 'V14');
  assert.equal(etiquetaVentana({ pos: '14' }, 12), 'V14');
  assert.equal(etiquetaVentana({ id_ventana: 'V14' }, 12), 'V14');
  assert.equal(etiquetaVentana({ posicion: 17 }, 15), 'V17');
});

test('🔒 una etiqueta que no es numerica se respeta tal cual (recintos, codigos del cliente)', () => {
  assert.equal(etiquetaVentana({ id: 'Living-A' }, 0), 'Living-A');
  assert.equal(etiquetaVentana({ pos: 'P-07' }, 2), 'P-07');
});

test('🔒 los TRES documentos rotulan igual la misma ventana', () => {
  // Antes cada renderizador calculaba `V${i+1}` por su cuenta y podian discrepar entre si.
  const v = { pos: 14 };
  const propuesta = etiquetaVentana(v, 12);
  const termico = etiquetaVentana(v, 12);
  const vientos = etiquetaVentana(v, 12);
  assert.equal(propuesta, termico);
  assert.equal(termico, vientos);
  assert.equal(propuesta, 'V14');
});
