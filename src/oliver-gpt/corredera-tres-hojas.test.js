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

/* =========================================================================
 * 🔴 TERCERA VUELTA — LO PROBO EL DUENO EN EL CHAT REAL Y NO ENTREGABA NADA (18-sep)
 *
 * La 2a version leia `texto_cliente` como si fuera UN pedido. Pero `textoDelCliente`
 * (normalizers.js) pega TODOS los mensajes del cliente en orden. En una conversacion de verdad
 * el cliente CAMBIA DE IDEA, y ahi los dos indicios conviven en el texto acumulado:
 *     4:20  "...corredera triple hoja en 2 rieles central fija laterales corredera"
 *     4:22  "si quiero triple riel"
 * La guardia de contradiccion se disparaba con el acumulado y escalaba PARA SIEMPRE: el cliente
 * pedia el triple riel y no recibia ninguna propuesta. Textual del dueno: "tampoco me la entrego".
 *
 * La distincion que faltaba: CONTRADECIRSE no es CAMBIAR DE IDEA. Gana el indicio que aparece
 * mas tarde; solo se escala cuando los dos vienen en la MISMA frase.
 * ========================================================================= */

test('🔴 el cliente CAMBIA DE IDEA a triple riel y se le entrega el triple riel', () => {
  // Exactamente el chat del dueno: los mensajes llegan pegados, el ultimo manda.
  const conversacion = '1 unidad de 2710x1995 corredera triple hoja en 2 rieles central fija '
    + 'laterales corredera  si quiero triple riel';
  const r = detectConfigCorredera(conversacion, 3);
  assert.equal(r.ambiguo, false, 'cambiar de idea no es contradecirse: no se escala');
  assert.equal(r.riel, 'TRIPLE', 'lo ultimo que dijo el cliente manda');
});

test('🔒 y al reves: si despues se arrepiente y pide la central fija, gana la central fija', () => {
  const r = detectConfigCorredera('quiero triple riel  no, mejor la del medio fija', 3);
  assert.equal(r.riel, 'DOBLE');
  assert.equal(r.activos, 2, 'y vuelven a cerrar las 2 laterales');
});

test('🔒 la contradiccion DE VERDAD (misma frase) sigue escalando', () => {
  const r = detectConfigCorredera('quiero la del medio fija pero que corran las tres', 3);
  assert.equal(r.ambiguo, true,
    'en una sola frase pidiendo las dos cosas no hay "ultimo": son dos ventanas distintas');
});

test('🔒 el pedido original de Mario Grey, solo, sigue dando DOBLE', () => {
  // No se puede romper lo que se arreglo en la 1a vuelta: sin cambio de idea, manda la fija.
  const r = detectConfigCorredera(PEDIDO_REAL, 3);
  assert.equal(r.riel, 'DOBLE');
  assert.equal(r.ambiguo, false);
});

/* =========================================================================
 * 🔴 CUARTA VUELTA — LA LISTA REAL DE 17 VENTANAS (2026-09-18)
 *
 * El dueno probo con una lista de verdad y Oliver volvio a escalar las triple hoja:
 * *"Las triple hoja (1 y 4) las revisa Marcelo directamente"*. Textual suyo: "volvimos a lo
 * mismo".
 *
 * CAUSA: el modelo venia escrito "CORREDERA DOBLE RIEL TRIPLE HOJA, LA DEL MEDIO FIJA", y ahi
 * las palabras "RIEL TRIPLE" quedan pegadas POR CASUALIDAD —"doble riel" seguido de "triple
 * hoja"—. El patron sinonimo `riel triple` lo leia como pedido de TRIPLE riel, chocaba con la
 * central fija, se declaraba contradiccion y la ventana ESCALABA.
 * O sea: mi guardia anti-adivinanza se disparo con un texto perfectamente claro. El mismo
 * sintoma que este archivo vino a arreglar, entrando por otra puerta.
 *
 * El dueno confirmo que "riel triple" y "triple riel" SI son sinonimos, asi que el patron se
 * conserva — solo deja de valer cuando le sigue "hoja".
 * ========================================================================= */

test('🔴 "DOBLE RIEL TRIPLE HOJA, LA DEL MEDIO FIJA" se cotiza, no escala', () => {
  for (const t of [
    'CORREDERA DOBLE RIEL TRIPLE HOJA, LA DEL MEDIO FIJA',
    'CORREDERA DOBRE RIEL TRIPLE HOJA, LA DEL MEDIO FIJA',   // el typo real de la lista
    'corredera doble riel triple hoja',
  ]) {
    const r = detectConfigCorredera(t, detectHojas(t));
    assert.equal(r.ambiguo, false, `"${t}" no tiene NADA de ambiguo`);
    assert.equal(r.riel, 'DOBLE', t);
    assert.equal(detectHojas(t), 3, t);
  }
});

test('🔒 pero "riel triple" SIGUE siendo sinonimo de "triple riel" (lo confirmo el dueno)', () => {
  for (const t of [
    'corredera riel triple',
    'quiero riel triple',
    'corredera riel triple, las tres corren',
    // 🔴 ESTE lo cazo Codex refutando la PRIMERA version del fix, que prohibia "riel
    // triple" cada vez que le seguia "hoja". Este cliente esta pidiendo triple riel de verdad.
    'corredera riel triple hojas al mismo lado',
    'riel triple, 3 hojas corredizas',
  ]) {
    assert.equal(detectConfigCorredera(t, 3).riel, 'TRIPLE', t);
  }
});

test('🔒 "tres hojas triple riel" NO se puede perder (la regresion que me cazo Codex)', () => {
  // Habia agregado un guard "espejo" por simetria, para "HOJA TRIPLE RIEL DOBLE". Nadie mando
  // nunca ese texto; en cambio ESTOS son como habla un cliente de verdad, y el guard los
  // dejaba en undefined. Se saco. El caso real medido es uno solo y solo ese se parchea.
  for (const t of ['corredera tres hojas triple riel', 'ventana 3 hojas triple riel']) {
    assert.equal(detectConfigCorredera(t, 3).riel, 'TRIPLE', t);
  }
});
test('🔒 "tres riel" en singular tambien cuenta (lo midio Codex: rieles? no matchea "riel")', () => {
  assert.equal(detectConfigCorredera('corredera de tres riel', 3).riel, 'TRIPLE');
  assert.equal(detectConfigCorredera('corredera de tres rieles', 3).riel, 'TRIPLE');
});
test('🔒 las demas partidas de esa lista no cambian de comportamiento', () => {
  // Una lista real trae de todo; nada de esto debe inventar un riel.
  for (const t of ['CORREDERA', 'corredera', 'PROYECTANTE BAÑO', 'proyectante oficina', 'proyectante baño']) {
    const r = detectConfigCorredera(t, detectHojas(t));
    assert.equal(r.riel, undefined, t);
    assert.equal(r.ambiguo, false, `${t} tampoco puede escalar`);
  }
});
