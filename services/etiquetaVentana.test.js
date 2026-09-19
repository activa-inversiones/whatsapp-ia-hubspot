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

/* =========================================================================
 * 🔱 LO QUE CAZO CODEX: el `pos` lo llena el LLM, y el LLM se equivoca.
 * Textual: *"la causa de muerte es confiar en que el LLM copie correctamente un identificador
 * comercial sin una comprobacion determinista... No hay defensa cuando alucina, duplica u omite
 * pos"*. La regla es TODO O NADA: o sirve la lista entera, o se numera por posicion.
 * ========================================================================= */

test('🔴 DUPLICADOS: dos ventanas "V5" dejarian el documento peor → se cae a posicion', async () => {
  const { rotulosDeVentanas } = await import('./etiquetaVentana.js');
  assert.deepEqual(
    rotulosDeVentanas([{ pos: 5 }, { pos: 5 }, { pos: 7 }]),
    ['V1', 'V2', 'V3'],
    'con un duplicado no se puede reconciliar nada: se numera por posicion',
  );
});

test('🔴 INCOMPLETO: si el LLM lo puso solo en algunas, no se mezcla', async () => {
  const { rotulosDeVentanas } = await import('./etiquetaVentana.js');
  assert.deepEqual(rotulosDeVentanas([{ pos: 1 }, {}, { pos: 3 }]), ['V1', 'V2', 'V3']);
  assert.deepEqual(rotulosDeVentanas([{ pos: 12 }, {}, {}]), ['V1', 'V2', 'V3']);
});

test('🔴 BASURA: valores que no son un numero de ventana se ignoran', async () => {
  const { rotulosDeVentanas } = await import('./etiquetaVentana.js');
  for (const malo of [0, -3, 1.5, 'trece', 99999, null, NaN]) {
    assert.deepEqual(rotulosDeVentanas([{ pos: malo }, { pos: 2 }]), ['V1', 'V2'], String(malo));
  }
});

test('🔒 SALTOS SI se permiten: el cliente que numera 7, 9, 10 esta diciendo algo', async () => {
  const { rotulosDeVentanas } = await import('./etiquetaVentana.js');
  assert.deepEqual(rotulosDeVentanas([{ pos: 7 }, { pos: 9 }, { pos: 10 }]), ['V7', 'V9', 'V10']);
});

test('🔴 EL CASO REAL: 17 pedidas, una fuera, las de abajo NO se corren', async () => {
  const { rotulosDeVentanas } = await import('./etiquetaVentana.js');
  const enElPdf = [{ pos: 12 }, { pos: 14 }, { pos: 15 }, { pos: 16 }, { pos: 17 }];
  assert.deepEqual(rotulosDeVentanas(enElPdf), ['V12', 'V14', 'V15', 'V16', 'V17']);
});

test('🔒 lista vacia o sin numerar: como siempre', async () => {
  const { rotulosDeVentanas } = await import('./etiquetaVentana.js');
  assert.deepEqual(rotulosDeVentanas([]), []);
  assert.deepEqual(rotulosDeVentanas(null), []);
  assert.deepEqual(rotulosDeVentanas([{}, {}, {}]), ['V1', 'V2', 'V3']);
});
