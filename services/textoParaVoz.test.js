// services/textoParaVoz.test.js
// ═══════════════════════════════════════════════════════════════════════════
// [2026-08-31] Tests del normalizador de texto para la nota de voz de Oliver.
//
// Cubre LOS DOS LADOS del problema:
//   A) los MONTOS se dicen como numero ("seis millones doscientos mil pesos"),
//   B) telefono / RUT / medida / folio / hora / fecha quedan INTACTOS.
//
// Se comprueba tanto la salida acentuada (la que se le manda al TTS) como el
// texto sin tildes que pidio el dueno, para que ninguna de las dos se rompa.
//
// Correr:  node --test services/textoParaVoz.test.js
// ═══════════════════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import { textoParaVoz, numeroAPalabras, montoAPalabras } from './textoParaVoz.js';

// Quita tildes para comparar contra el texto literal del dueno.
function sinTildes(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ───────────────────────────────────────────────────────────────────────────
// A) MONTOS — el defecto reportado por el dueno
// ───────────────────────────────────────────────────────────────────────────

test('monto: $6.200.000 se dice como millones, no digito por digito', () => {
  const out = textoParaVoz('El total es $6.200.000');
  assert.equal(out, 'El total es seis millones doscientos mil pesos');
  assert.equal(sinTildes(out), 'El total es seis millones doscientos mil pesos');
});

test('monto: $323.016', () => {
  const out = textoParaVoz('$323.016');
  assert.equal(out, 'trescientos veintitrés mil dieciséis pesos');
  assert.equal(sinTildes(out), 'trescientos veintitres mil dieciseis pesos');
});

test('monto: $1.000.000 dice "un millon DE pesos" (no "uno millon")', () => {
  const out = textoParaVoz('$1.000.000');
  assert.equal(out, 'un millón de pesos');
  assert.equal(sinTildes(out), 'un millon de pesos');
});

test('monto: $2.500', () => {
  assert.equal(textoParaVoz('$2.500'), 'dos mil quinientos pesos');
});

test('monto: no duplica la palabra pesos si ya venia escrita', () => {
  assert.equal(textoParaVoz('$2.500 pesos'), 'dos mil quinientos pesos');
});

test('monto: sin signo peso pero con la palabra', () => {
  assert.equal(textoParaVoz('salen 6.200.000 pesos'), 'salen seis millones doscientos mil pesos');
});

test('monto: numero con forma de millones sin signo NO inventa la palabra pesos', () => {
  assert.equal(textoParaVoz('quedaron 6.200.000 en total'), 'quedaron seis millones doscientos mil en total');
});

test('monto: dos montos en la misma frase', () => {
  assert.equal(
    textoParaVoz('De $323.016 bajamos a $2.500'),
    'De trescientos veintitrés mil dieciséis pesos bajamos a dos mil quinientos pesos'
  );
});

test('monto: con decimales chilenos (coma)', () => {
  assert.equal(textoParaVoz('$2.500,50'), 'dos mil quinientos pesos con cincuenta');
});

// ───────────────────────────────────────────────────────────────────────────
// A2) FORMAS IRREGULARES DEL CASTELLANO
// ───────────────────────────────────────────────────────────────────────────

test('irregulares: 21 / 100 / 101 / 500 / 700 / 900 / 1M / 2M', () => {
  assert.equal(numeroAPalabras(21), 'veintiún');       // apocope: "veintiún mil pesos"
  assert.equal(numeroAPalabras(100), 'cien');
  assert.equal(numeroAPalabras(101), 'ciento un');
  assert.equal(numeroAPalabras(500), 'quinientos');
  assert.equal(numeroAPalabras(700), 'setecientos');
  assert.equal(numeroAPalabras(900), 'novecientos');
  assert.equal(numeroAPalabras(1000000), 'un millón');
  assert.equal(numeroAPalabras(2000000), 'dos millones');
});

test('irregulares: 21.000 es "veintiun mil", no "veintiuno mil"', () => {
  assert.equal(sinTildes(montoAPalabras(21000)), 'veintiun mil pesos');
  assert.equal(sinTildes(montoAPalabras(31000)), 'treinta y un mil pesos');
  assert.equal(montoAPalabras(1000), 'mil pesos');       // no "un mil"
  assert.equal(montoAPalabras(100000), 'cien mil pesos');
  assert.equal(sinTildes(montoAPalabras(101000)), 'ciento un mil pesos');
});

// ───────────────────────────────────────────────────────────────────────────
// B) LO QUE NO SE TOCA — aca es donde se rompe una solucion ingenua
// ───────────────────────────────────────────────────────────────────────────

test('INTACTO: telefonos chilenos', () => {
  assert.equal(textoParaVoz('Llamalo al +56957296035'), 'Llamalo al +56957296035');
  assert.equal(textoParaVoz('56957423389'), '56957423389');
  assert.equal(textoParaVoz('mi numero es 9 5729 6035'), 'mi numero es 9 5729 6035');
});

test('INTACTO: RUT', () => {
  assert.equal(textoParaVoz('RUT 76.123.456-7'), 'RUT 76.123.456-7');
  assert.equal(textoParaVoz('RUT 12.345.678-K'), 'RUT 12.345.678-K');
});

test('INTACTO: medidas de ventana', () => {
  assert.equal(textoParaVoz('ventana 1500x1200'), 'ventana 1500x1200');
  assert.equal(textoParaVoz('mide 1,50 x 1,20 m'), 'mide 1,50 x 1,20 m');
  assert.equal(textoParaVoz('vidrio de 34 mm'), 'vidrio de 34 mm');
  assert.equal(textoParaVoz('perfil S70 y S60'), 'perfil S70 y S60');
});

test('INTACTO: folios de cotizacion', () => {
  assert.equal(textoParaVoz('cotizacion N° 0392'), 'cotizacion N° 0392');
  assert.equal(textoParaVoz('la 0392-B'), 'la 0392-B');
});

test('INTACTO: horas y fechas', () => {
  assert.equal(textoParaVoz('a las 9:33'), 'a las 9:33');
  assert.equal(textoParaVoz('a las 15:00'), 'a las 15:00');
  assert.equal(textoParaVoz('el 31/08'), 'el 31/08');
  assert.equal(textoParaVoz('el 31-08-2026'), 'el 31-08-2026');
});

test('INTACTO: porcentajes y numeros chicos', () => {
  assert.equal(textoParaVoz('un 15% de descuento'), 'un 15% de descuento');
  assert.equal(textoParaVoz('son 3 ventanas'), 'son 3 ventanas');
  assert.equal(textoParaVoz('20 comunas'), '20 comunas');
});

test('INTACTO: URL con numeros adentro', () => {
  assert.equal(
    textoParaVoz('mira https://ops.activalabs.ai/q/2026000123'),
    'mira https://ops.activalabs.ai/q/2026000123'
  );
});

// ───────────────────────────────────────────────────────────────────────────
// C) MENSAJE REALISTA: monto + telefono + medida en la misma frase
// ───────────────────────────────────────────────────────────────────────────

test('mezcla real: monto convertido, telefono/medida/folio/hora intactos', () => {
  const entrada =
    'Cotizacion N° 0392: 2 ventanas de 1500x1200 en S70, total $6.200.000. ' +
    'Te llamo a las 15:00 al +56957296035.';
  const salida = textoParaVoz(entrada);
  assert.equal(
    salida,
    'Cotizacion N° 0392: 2 ventanas de 1500x1200 en S70, total seis millones doscientos mil pesos. ' +
      'Te llamo a las 15:00 al +56957296035.'
  );
  // Y por si algun dia cambia el fraseo: lo importante, punto por punto.
  assert.ok(salida.includes('seis millones doscientos mil pesos'));
  assert.ok(salida.includes('+56957296035'));
  assert.ok(salida.includes('1500x1200'));
  assert.ok(salida.includes('N° 0392'));
  assert.ok(salida.includes('15:00'));
  assert.ok(!/\$/.test(salida));
});

test('mezcla real: RUT + monto en la misma frase', () => {
  const salida = textoParaVoz('Cliente RUT 76.123.456-7, abono de $323.016.');
  assert.equal(salida, 'Cliente RUT 76.123.456-7, abono de trescientos veintitrés mil dieciséis pesos.');
});

// ───────────────────────────────────────────────────────────────────────────
// D) LIMPIEZA DE FORMATO (emojis, markdown, vinetas, saltos)
// ───────────────────────────────────────────────────────────────────────────

test('limpieza: emojis fuera', () => {
  assert.equal(textoParaVoz('Listo ✅ quedo la cotizacion 🎉'), 'Listo quedo la cotizacion');
});

test('limpieza: markdown de WhatsApp fuera', () => {
  assert.equal(textoParaVoz('El total es *$2.500*'), 'El total es dos mil quinientos pesos');
  assert.equal(textoParaVoz('**Importante** revisar'), 'Importante revisar');
  assert.equal(textoParaVoz('esto es `codigo`'), 'esto es codigo');
});

test('limpieza: vinetas y saltos de linea pasan a pausa hablada', () => {
  const salida = textoParaVoz('Resumen:\n- 2 ventanas\n- total $2.500');
  assert.equal(salida, 'Resumen: 2 ventanas. total dos mil quinientos pesos');
  assert.ok(!salida.includes('-'));
  assert.ok(!salida.includes('\n'));
});

test('limpieza: link markdown deja solo el texto', () => {
  assert.equal(textoParaVoz('mira [la cotizacion](https://ops.activalabs.ai/q/1)'), 'mira la cotizacion');
});

// ───────────────────────────────────────────────────────────────────────────
// E) BORDES — nunca debe reventar
// ───────────────────────────────────────────────────────────────────────────

test('bordes: null / undefined / vacio / solo emoji', () => {
  assert.equal(textoParaVoz(null), '');
  assert.equal(textoParaVoz(undefined), '');
  assert.equal(textoParaVoz(''), '');
  assert.equal(textoParaVoz('   '), '');
  assert.equal(textoParaVoz('👍'), '');
});

test('bordes: numeroAPalabras rechaza lo no convertible', () => {
  assert.equal(numeroAPalabras(NaN), null);
  assert.equal(numeroAPalabras(-5), null);
  assert.equal(numeroAPalabras(1.5), null);
  assert.equal(numeroAPalabras(0), 'cero');
});

test('bordes: texto sin numeros pasa igual', () => {
  assert.equal(textoParaVoz('Hola Marcelo, todo listo.'), 'Hola Marcelo, todo listo.');
});

// ── REGRESION 2026-08-31 ──────────────────────────────────────────────────────
// Lo cazo el abogado del diablo, NO los tests originales: el blindaje de unidades
// era /\b\d+...(?:mm|cm|m²|m2|kg|%|m)\b/ y la alternativa `m` suelta enganchaba la
// "m" de "mas" CON TILDE. En JS \b es ASCII, asi que entre la m y la a-tilde hay
// frontera de palabra: se blindaba "200.000 m" de ADENTRO del monto, lo partia, y
// el "$6" suelto se convertia solo.
//   "$6.200.000 mas IVA"  (sin tilde) -> bien
//   "$6.200.000 más IVA"  (con tilde) -> "seis pesos.200.000 más IVA"
// Un numero FALSO dicho con naturalidad, en la plata. "mas IVA" es de las cosas
// que Oliver mas dice.
test('REGRESION: un monto seguido de "mas" con tilde se dice entero', () => {
  assert.equal(textoParaVoz('El total es $6.200.000 más IVA'),
    'El total es seis millones doscientos mil pesos más IVA');
  assert.equal(textoParaVoz('$323.016 más despacho'),
    'trescientos veintitrés mil dieciséis pesos más despacho');
  assert.equal(textoParaVoz('$1.500.000 más flete'),
    'un millón quinientos mil pesos más flete');
  assert.equal(textoParaVoz('Le bajé $6.200.000 más $200.000 de flete'),
    'Le bajé seis millones doscientos mil pesos más doscientos mil pesos de flete');
});

test('REGRESION: y las unidades de verdad siguen blindadas', () => {
  // El arreglo no puede haberse llevado puesto el blindaje que si servia.
  assert.equal(textoParaVoz('vidrio de 34 mm'), 'vidrio de 34 mm');
  assert.equal(textoParaVoz('perfil S70 de 1,50 m'), 'perfil S70 de 1,50 m');
  assert.equal(textoParaVoz('pesa 8 kg'), 'pesa 8 kg');
  assert.equal(textoParaVoz('subio un 25%'), 'subio un 25%');
  assert.equal(textoParaVoz('mide 12 m2'), 'mide 12 m2');
  assert.equal(textoParaVoz('corredera de 1500x1200'), 'corredera de 1500x1200');
});
