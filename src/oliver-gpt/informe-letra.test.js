// informe-letra.test.js — [2026-09-04]
//
// DOS INFORMES DISTINTOS NO PUEDEN LLAMARSE IGUAL.
//
// Decision del dueno (#651), textual: *"2 informes distintos se llaman igual, deben
// diferenciarse igual que en propuesta como A B C D asi sucesivamente para no perderlos"*.
//
// 🔴 EL PROBLEMA, medido: el informe termico lleva ADENTRO la ventana del cliente (su vidrio,
// su Uw, su producto), asi que dos cotizaciones distintas en la misma comuna producen dos
// documentos DISTINTOS. Pero los dos se mandaban como `Informe-Termico-Vilcun.pdf`. En el
// telefono del cliente el segundo PISA al primero al guardarlo, y no hay forma de saber cual
// corresponde a que ventana. Medido el 03-sep: 86 informes termicos entregados, 84 documentos
// distintos — casi todos compartiendo nombre.
//
// ⚠️ ESTO YA SE INTENTO Y SE REVIRTIO EL 03-SEP. Aquella version metia el CORRELATIVO ISO en
// el nombre (`Informe-Termico-Vilcun-CM-FR-006-2026-0093.pdf`) y rompio
// `webhook.informe.test.js:536`, que fija una decision deliberada: al cliente se le manda el
// nombre LEGIBLE a proposito, y el correlativo ya viaja en la copia de archivo de WorkDrive.
// Se reverte y se le pregunto al dueno. El eligio la letra, que es lo mejor de los dos
// mundos: distingue sin convertir el nombre en un serial.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { letraDeInforme, nombreConLetra, LETRAS_INFORME } from './informeLetra.js';

describe('letraDeInforme — la posicion se convierte en letra', () => {
  test('el PRIMER informe es la A, no un nombre pelado', () => {
    // El dueno pidio "A B C D": la A es explicita. Es la diferencia con el folio de las
    // propuestas, donde la primera NO lleva letra y las alternativas empiezan en B.
    assert.equal(letraDeInforme(0), 'A');
    assert.equal(letraDeInforme(1), 'B');
    assert.equal(letraDeInforme(3), 'D');
  });

  test('mas alla del alfabeto NO se rompe ni se repite: sigue con AA, AB', () => {
    // 26 informes al mismo cliente no es un caso real, pero repetir la A seria volver al
    // problema que esto arregla, y romper dejaria al cliente sin informe por un nombre.
    assert.equal(letraDeInforme(26), 'AA');
    assert.equal(letraDeInforme(27), 'AB');
  });

  test('un indice invalido cae a la A en vez de explotar', () => {
    assert.equal(letraDeInforme(-1), 'A');
    assert.equal(letraDeInforme(null), 'A');
    assert.equal(letraDeInforme('x'), 'A');
  });
});

describe('nombreConLetra — el nombre que ve el cliente', () => {
  test('🔴 EL CASO: dos informes de Vilcun ya no se llaman igual', () => {
    assert.equal(nombreConLetra('Informe-Termico-Vilcun.pdf', 0), 'Informe-Termico-Vilcun-A.pdf');
    assert.equal(nombreConLetra('Informe-Termico-Vilcun.pdf', 1), 'Informe-Termico-Vilcun-B.pdf');
  });

  test('sigue siendo legible: la comuna se lee, no se convierte en un serial', () => {
    // Es la razon por la que la version con el correlativo ISO se reverte: el nombre que
    // llega al telefono tiene que poder leerse de un vistazo.
    const n = nombreConLetra('Informe-Vientos-Padre-Las-Casas.pdf', 2);
    assert.equal(n, 'Informe-Vientos-Padre-Las-Casas-C.pdf');
    assert.match(n, /Padre-Las-Casas/, 'la comuna sigue a la vista');
    assert.doesNotMatch(n, /CM-FR/, 'y NO se le mete el correlativo al cliente');
  });

  test('conserva la extension y no la duplica', () => {
    assert.match(nombreConLetra('Informe-Termico-Temuco.pdf', 0), /\.pdf$/);
    assert.equal((nombreConLetra('Informe-Termico-Temuco.pdf', 0).match(/\.pdf/g) || []).length, 1);
  });

  test('un nombre sin .pdf tambien funciona', () => {
    assert.equal(nombreConLetra('Informe-Termico-Temuco', 1), 'Informe-Termico-Temuco-B.pdf');
  });

  test('DEGRADA al nombre de siempre si el indice no se pudo saber', () => {
    // Regla de la casa: un llamador que no puede contar (KV caido) tiene que comportarse
    // EXACTAMENTE como antes. Es preferible un nombre repetido a un informe que no sale.
    assert.equal(nombreConLetra('Informe-Termico-Temuco.pdf', null), 'Informe-Termico-Temuco.pdf');
    assert.equal(nombreConLetra('Informe-Termico-Temuco.pdf', undefined), 'Informe-Termico-Temuco.pdf');
  });

  test('un nombre vacio no inventa nada', () => {
    assert.equal(nombreConLetra('', 0), '');
  });

  test('el alfabeto empieza en A — distinto al de las propuestas, y a proposito', () => {
    // `LETRAS_ALTERNATIVA` de propuestas-color.js empieza en B porque ahi la primera propuesta
    // NO lleva letra (el folio base ES la A). Aca la A es explicita porque el dueno la pidio
    // asi. Son dos reglas distintas para dos documentos distintos: por eso son dos constantes
    // y no una compartida que tendria que hacer las dos cosas.
    assert.equal(LETRAS_INFORME[0], 'A');
  });
});
