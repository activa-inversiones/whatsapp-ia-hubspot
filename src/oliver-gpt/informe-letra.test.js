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
// ⚠️ EL NOMBRE LLEVA LAS DOS COSAS, Y ASI SE LLEGO. El 03-sep meti el correlativo ISO solo,
// rompio `webhook.informe.test.js:536` —que fijaba el nombre pelado a proposito, por
// legibilidad— y lo revertí para preguntarle al dueno. Pidio la letra A/B/C. Al implementarla
// corrigio de nuevo, textual: *"pero debe tener el correlativo de registro ISO o no esta
// dentro del ISO"*. Tenia razon: la letra distingue un archivo de otro, pero solo el
// correlativo lo amarra al REGISTRO. Version final: `-A-CM-FR-006-2026-0093.pdf`, que
// distingue, es legible Y es auditable. Ninguna de las dos sola alcanzaba.

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

  test('🔴 [correccion del dueño] EL CORRELATIVO ISO VA EN EL NOMBRE', () => {
    // Textual: *"pero debe tener el correlativo de registro ISO o no esta dentro del ISO"*.
    // La letra distingue un archivo de otro; el correlativo lo amarra al REGISTRO. Un
    // documento formal cuyo nombre no permite encontrarlo en el registro no esta dentro del
    // sistema de gestion — y el nombre es lo unico que un auditor mira antes de abrirlo.
    const n = nombreConLetra('Informe-Vientos-Padre-Las-Casas.pdf', 2, 'CM-FR-007-2026-0004');
    assert.equal(n, 'Informe-Vientos-Padre-Las-Casas-C-CM-FR-007-2026-0004.pdf');
    assert.match(n, /Padre-Las-Casas/, 'la comuna sigue a la vista');
    assert.match(n, /CM-FR-007-2026-0004/, 'y el correlativo tambien');
  });

  test('sin folio sale solo con la letra: nunca se frena un envio por no numerarlo', () => {
    // Si sales-os no contesto, el informe SALE igual. Un documento entregado con nombre
    // incompleto se explica; uno que no salio, no.
    assert.equal(nombreConLetra('Informe-Termico-Temuco.pdf', 1), 'Informe-Termico-Temuco-B.pdf');
  });

  test('un folio con caracteres raros se limpia: el nombre viaja a Meta y a WorkDrive', () => {
    const n = nombreConLetra('Informe-Termico-Temuco.pdf', 0, 'CM/FR 006:2026*0001');
    assert.doesNotMatch(n, /[/:*]/, 'sin caracteres que rompan un envio');
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
    // …pero si hay folio, el folio va igual: el ISO no depende de que el contador funcione.
    assert.equal(nombreConLetra('Informe-Termico-Temuco.pdf', null, 'CM-FR-006-2026-0093'),
      'Informe-Termico-Temuco-CM-FR-006-2026-0093.pdf');
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
