// rutChile.test.js — [2026-08-30]
//
// El validador de RUT es lo único que separa "el documento lleva el RUT del cliente" de "el
// documento lleva UN NÚMERO en el lugar del RUT del cliente". Por eso se prueba contra RUT
// REALES que ya viven en el repo con su fuente, y no contra ejemplos inventados: un RUT
// inventado que "pasa" no prueba nada, porque el módulo 11 acepta 1 de cada 11 al azar.

import test from 'node:test';
import assert from 'node:assert/strict';
import { dvDeRut, validarRut, rutEsValido, formatearRut, limpiarRut } from './rutChile.js';

// Los tres con su procedencia. Si alguien rompe el algoritmo, se cae acá y no en un PDF.
const REALES = [
  ['76.486.825-0', 'emisor Activa Inversiones EIRL (informeTermicoPdf.js, dato del dueño)'],
  ['12.988.375-8', 'Marcelo Cifuentes (src/oliver-gpt/system-prompt.js:807)'],
  ['10.047.794-7', 'caso Alfredo, el que originó el pedido (src/oliver-gpt/pdf-intent.test.js:58)'],
];

test('módulo 11: los tres RUT reales del repo validan', () => {
  for (const [rut, fuente] of REALES) {
    assert.equal(rutEsValido(rut), true, `debió validar ${rut} — ${fuente}`);
    assert.equal(formatearRut(rut), rut, 'y sale con el mismo formato canónico');
  }
});

test('módulo 11: cambiarle el dígito verificador a un RUT real lo invalida', () => {
  // Ésta es la prueba que importa: el error típico del cliente es un DV mal tipeado.
  for (const [rut] of REALES) {
    const cuerpo = rut.slice(0, -1);
    for (const dv of '0123456789K') {
      const candidato = cuerpo + dv;
      if (candidato === rut) continue;
      assert.equal(rutEsValido(candidato), false, `${candidato} NO debió pasar`);
    }
  }
});

test('el DV se calcula, no se copia: K y 0 son los dos casos de borde del módulo 11', () => {
  // resto 10 -> K, resto 11 -> 0. Se comprueban con cuerpos cuyo resultado es verificable
  // recalculando a mano la suma ponderada.
  assert.equal(dvDeRut('76486825'), '0');   // suma 187, múltiplo de 11 -> DV 0
  assert.equal(dvDeRut('12988375'), '8');
  assert.equal(dvDeRut('10047794'), '7');
  assert.equal(dvDeRut(''), null);
  // Un cuerpo cuyo resto da 10 tiene que devolver K en mayúscula, nunca 'k' ni '10'.
  const conK = [...Array(200).keys()].map((i) => String(20000000 + i)).find((c) => dvDeRut(c) === 'K');
  assert.ok(conK, 'debía existir al menos un cuerpo con DV K en el rango probado');
  assert.equal(rutEsValido(`${conK}-k`), true, 'la k minúscula del cliente vale igual');
  assert.equal(formatearRut(`${conK}k`), formatearRut(`${conK}-K`), 'y se normaliza a K');
});

test('da lo mismo cómo lo escriba el cliente: puntos, guion, o nada', () => {
  const formas = ['10.047.794-7', '10047794-7', '100477947', ' 10.047.794 - 7 ', 'RUT: 10.047.794-7'];
  for (const f of formas) {
    assert.equal(formatearRut(f), '10.047.794-7', `no normalizó ${JSON.stringify(f)}`);
  }
});

test('lo que NO es un RUT no se imprime, y dice por qué', () => {
  const casos = [
    ['', 'vacio'],
    [null, 'vacio'],
    [undefined, 'vacio'],
    ['   ', 'vacio'],
    ['no tengo', 'vacio'],          // sin dígitos: no queda nada que validar
    ['7', 'sin_dv'],
    ['12345-6', 'largo'],           // cuerpo de 5: fuera del rango chileno
    ['123456789-0', 'largo'],       // cuerpo de 9: todavía no se emiten
    ['0000000-0', 'largo'],         // puros ceros: pasa módulo 11 y no es el RUT de nadie
    ['K1234567', 'largo'],          // la K solo puede ir al final
    ['10.047.794-9', 'dv'],         // el caso real con el DV cambiado
  ];
  for (const [entrada, motivo] of casos) {
    const v = validarRut(entrada);
    assert.equal(v.valido, false, `${JSON.stringify(entrada)} NO debió validar`);
    assert.equal(v.formateado, '', 'y no debe quedar nada que imprimir');
    assert.equal(v.motivo, motivo, `motivo esperado para ${JSON.stringify(entrada)}`);
  }
});

test('NUNCA completa ni corrige: un RUT sin DV no se "arregla" calculándoselo', () => {
  // Es la tentación obvia y sería inventar un dato tributario ajeno. 8 dígitos se leen como
  // cuerpo de 7 + DV, y si ese DV no calza, no hay RUT. Jamás se devuelve el DV "correcto".
  const v = validarRut('1004779');
  assert.equal(v.valido, false);
  assert.equal(v.formateado, '');
  assert.ok(!formatearRut('1004779').includes('-'), 'no debe fabricar un dígito verificador');
});

test('limpiarRut no se traga un 0 legítimo ni deja basura', () => {
  assert.equal(limpiarRut('76.486.825-0'), '764868250');
  assert.equal(limpiarRut(0), '0');
  assert.equal(limpiarRut(null), '');
});
