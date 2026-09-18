// corredera-tres-hojas.test.js — [2026-09-18]
//
// 🔴 EL CLIENTE PIDIO TRES HOJAS CON LA DEL CENTRO FIJA Y SE LE COTIZO UNA DE DOS.
//
// Caso real CM-FR-004-2026-0477 (Mario Grey, Vilcun, 18-sep). Textual del cliente:
//   "a nombre de MARIO GREY 1 unidad de 2710x1995 corredera triple hoja en 2 rieles
//    central fija laterales corredera comuna de vilcun color blanco"
// La propuesta salio con el TEXTO correcto ("triple hoja (central fija / laterales
// correderas)") pero el DIBUJO de dos panos y el PRECIO de dos hojas: $878.714.
// Medido contra el motor en vivo con esas mismas medidas:
//     hojas=2 -> $878.714  (exactamente lo que se le cobro)
//     hojas=3 -> $893.149
// Subcobro: $14.435 en UNA ventana. Causa raiz: enginePricer leia el numero de hojas
// solo de `item.product`, y el pedido del cliente vive en `texto_cliente`.
//
// 🧭 LA REGLA DE NEGOCIO (instruccion del dueno, 18-sep, textual):
//   "cualquier lenguaje de cliente que indique que la central fija es de doble riel;
//    si quiere mover las tres hacia un lado es triple riel y se mueven las 3 en tres
//    rieles diferentes"
// No es interpretacion: es la taxonomia de modelos de Winart, leida de su API el 18-sep,
// y anclada en las dos versiones de referencia que dejo el dueno, MISMA ventana 2710x1995:
//     v69621 -> SLIDING-S75_DOBLERIEL_TRES_HOJA_98   (central fija)   material $702.722
//     v69622 -> SLIDING-S75_TRIPLERIEL_TRES_HOJA_98  (las 3 corren)   material $802.086
// Son DOS PRODUCTOS DISTINTOS separados por $99.364 de material. Hoy el motor cotiza los
// dos igual, porque el BOM de SLIDING usa el marco doble riel pase lo que pase.

import test from 'node:test';
import assert from 'node:assert/strict';
import { detectHojas, detectConfigCorredera } from '../../services/enginePricer.js';

const PEDIDO_REAL = 'a nombre de MARIO GREY 1 unidad de 2710x1995 corredera triple hoja '
  + 'en 2 rieles central fija laterales corredera comuna de vilcun color blanco';

/* =========================================================================
 * EL PEDIDO QUE SE COTIZO MAL
 * ========================================================================= */

test('🔴 el pedido real de Mario Grey se lee como TRES hojas', () => {
  assert.equal(detectHojas(PEDIDO_REAL), 3,
    'se cotizo de 2 hojas: $14.435 de subcobro medido contra el motor en vivo');
});

test('🔴 "triple hoja + central fija" es DOBLE riel, no triple (regla del dueno + Winart)', () => {
  const c = detectConfigCorredera(PEDIDO_REAL, 3);
  assert.equal(c.centralFija, true, 'la del centro va fija');
  assert.equal(c.riel, 'DOBLE', 'Winart lo llama S75_DOBLERIEL_TRES_HOJA_98 (version 69621)');
  assert.equal(c.activos, 2, 'cierran las 2 laterales contra la fija');
});

test('🔴 la palabra "triple" sola NO puede convertirse en triple riel', () => {
  // Este es el error de $99.364: "triple hoja" significa TRES HOJAS, no tres rieles.
  const c = detectConfigCorredera('corredera triple hoja, la del medio fija', 3);
  assert.equal(c.riel, 'DOBLE');
});

/* =========================================================================
 * EL OTRO PRODUCTO: LAS TRES CORREN
 * ========================================================================= */

test('🔒 "las 3 corren hacia un lado" es TRIPLE riel (version 69622)', () => {
  for (const txt of [
    'corredera de 3 hojas, las tres corren hacia un lado',
    'quiero una corredera de tres hojas con triple riel',
    'corredera 3 hojas en tres rieles',
    'que se muevan las 3 para un lado',
  ]) {
    assert.equal(detectConfigCorredera(txt, 3).riel, 'TRIPLE', txt);
  }
});

test('🔒 la central fija MANDA aunque el texto diga "triple"', () => {
  // "triple hoja ... 2 rieles ... central fija" — el pedido real tenia las dos senales.
  const c = detectConfigCorredera('corredera triple hoja en 2 rieles central fija', 3);
  assert.equal(c.riel, 'DOBLE', 'si la del centro es fija, no hay tres rieles que valgan');
});

/* =========================================================================
 * LO QUE NO SE PUEDE ROMPER: LA CORREDERA NORMAL DE 2 HOJAS
 * ========================================================================= */

test('🔒 una corredera comun no define riel ni activos (el motor usa su default calibrado)', () => {
  const c = detectConfigCorredera('quiero una corredera para el living, 1500x1200', undefined);
  assert.equal(c.riel, undefined, 'sin senal no se inventa un riel');
  assert.equal(c.activos, undefined);
  assert.equal(c.centralFija, false);
});

test('🔒 "doble riel" dicho por el cliente se respeta', () => {
  assert.equal(detectConfigCorredera('corredera doble riel 2 hojas', 2).riel, 'DOBLE');
});

test('🔒 activos solo se fija con central fija Y 3 hojas (no se extrapola)', () => {
  assert.equal(detectConfigCorredera('central fija', 2).activos, undefined,
    'una de 2 hojas con "central fija" es un pedido raro: lo decide el motor, no nosotros');
  assert.equal(detectConfigCorredera('las 3 corren', 3).activos, undefined,
    'si las tres corren, las tres cierran: no se baja a 2');
});

/* =========================================================================
 * 🔴 SEGUNDA VUELTA — LO QUE CAZO LA COMPUERTA CRUZADA (2026-09-18)
 *
 * La v1 de detectConfigCorredera fallaba 9 de 15 frases chilenas reales. Kimi (NVIDIA NIM,
 * linaje Moonshot) y Gemini 2.5 Pro dijeron NO APTO por separado, y los dos tenian razon:
 * se midio caso por caso antes de tocar nada. Cada test de abajo es una frase que FALLABA.
 * ========================================================================= */

const riel = (txt, hojas = 3) => detectConfigCorredera(txt, hojas).riel;

test('🔴 [Gemini] sinonimos de "fija" que el cliente usa de verdad', () => {
  assert.equal(riel('la de al medio no se abre'), 'DOBLE', '"no se abre" es tan fija como "no se mueve"');
  assert.equal(riel('solo se mueven las de los lados'), 'DOBLE', 'la central fija, dicha al reves');
  assert.equal(riel('fija al centro'), 'DOBLE');
});

test('🔴 [Kimi] "pano/panel/cuerpo central fijo" — media clientela no dice "hoja"', () => {
  assert.equal(riel('el pano central es fijo'), 'DOBLE');
  assert.equal(riel('ventanal con pano central fijo'), 'DOBLE');
});

test('🔴 [Gemini] las 3 corren, con las conjugaciones y el "pa" chilenos', () => {
  assert.equal(riel('que corran las tres'), 'TRIPLE');
  assert.equal(riel('se abren las 3'), 'TRIPLE');
  assert.equal(riel('corren todas pa un lado'), 'TRIPLE');
  assert.equal(riel('las corro todas para la derecha'), 'TRIPLE');
  assert.equal(riel('riel triple'), 'TRIPLE', '"riel triple" es lo mismo que "triple riel"');
});

test('🔴 [Kimi, el peor] LA NEGACION: negar un producto lo estaba PIDIENDO', () => {
  assert.equal(riel('no quiero triple riel, quiero doble'), 'DOBLE',
    'la v1 devolvia TRIPLE: se le cotizaba al cliente justo lo que acababa de descartar');
  assert.equal(riel('tres rieles no, dos rieles'), 'DOBLE');
  assert.equal(riel('la hoja central no es fija, todas corren'), 'TRIPLE',
    'negar la fija + "todas corren" es el triple riel: $99.364 de material de diferencia');
});

test('⚖️ ANTE CONTRADICCION SE ESCALA, NO SE ADIVINA', () => {
  const a = detectConfigCorredera('quiero la del medio fija pero que corran las tres', 3);
  assert.equal(a.ambiguo, true, 'son dos ventanas distintas: decide Marcelo, no una regex');
  assert.equal(a.riel, undefined, 'y NO se elige una de las dos a la suerte');
  assert.ok(a.motivo, 'con el motivo escrito, para que se pueda explicar');

  const b = detectConfigCorredera('triple riel no', 3);
  assert.equal(b.ambiguo, true, 'descarta el triple pero no dice que quiere');
});

test('🔒 "todas corren" en una de 2 HOJAS no puede inventar un triple riel', () => {
  // Al reves del subcobro: esto seria SOBREcobro, y ademas otro producto.
  assert.equal(riel('corredera 2 hojas, todas corren', 2), undefined);
});

test('🔒 la corredera normal sigue sin definir riel (el motor usa su default calibrado)', () => {
  assert.equal(riel('quiero una corredera para el living'), undefined);
  assert.equal(riel('corredera 1500x1200 blanca'), undefined);
  assert.equal(riel('corredera doble vidrio 2 hojas'), undefined,
    '"doble vidrio" es el termopanel, no el riel');
});
