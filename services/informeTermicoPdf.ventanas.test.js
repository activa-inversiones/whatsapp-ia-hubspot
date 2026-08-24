// informeTermicoPdf.ventanas.test.js — [2026-08-24]
//
// PEDIDO DEL DUEÑO, textual: *"no podemos cotizarle una ventana al cliente teniendo ocho
// ventanas con transmitancias térmicas [distintas]"*. Hasta hoy el informe térmico firmado
// declaraba el Uw de `items[0]` bajo el rótulo "LA VENTANA DE SU COTIZACIÓN", en singular.
// Las otras siete no existían para el documento.
//
// LO QUE SE PRUEBA ACÁ es lo que se le DECLARA al cliente en un documento firmado por un
// Evaluador Energético acreditado MINVU. Por eso `resumenVentanas` es pura y exportada, y
// no tres expresiones dentro del código de dibujo: pdfkit escribe glifos hex, y una
// decisión que puede firmar un "todo cumple" falso no puede ser intestable.
//
// EL CASO REAL QUE LO MOTIVA (medido en la BD viva, 24-ago): el cliente 56995420506 recibió
// DOS informes con folios distintos —CM-FR-006-2026-0003 y 0004— uno declarando Uw 2,71
// (corredera H80) y el otro con el Uw en blanco (corredera H98, perfil no cargado en la API
// térmica). Dos documentos firmados, del mismo proyecto, contándose distinto.
//
// Verificado matando el mutante.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resumenVentanas } from './informeTermicoPdf.js';

const TOPE = 3.2;   // PDA Temuco / Padre Las Casas

const PROYECTO = [
  { id: 'V1', producto: 'Corredera SLIDING H80 Doble Riel S75', medidas: '1200x1000', vidrio: '4+12+4', ambiente: 'living', cantidad: 2, uw: 2.71 },
  { id: 'V2', producto: 'Fijo S60', medidas: '600x800', vidrio: '4+12+4', ambiente: '', cantidad: 1, uw: 2.61 },
  { id: 'V3', producto: 'Corredera SLIDING H98 Doble Riel S75', medidas: '2400x1800', vidrio: '5+12+5', ambiente: 'terraza', cantidad: 1, uw: null },
];

test('🔴 el proyecto entero: una fila por ventana, ninguna se pierde', () => {
  const r = resumenVentanas(PROYECTO, TOPE);
  assert.equal(r.filas.length, 3, 'las tres ventanas están en el informe');
  assert.deepEqual(r.filas.map((f) => f.id), ['V1', 'V2', 'V3']);
  assert.equal(r.totalVentanas, 4, 'V1 son 2 unidades: el proyecto tiene 4 ventanas');
});

test('🔴 la ventana SIN Uw se lista igual, rotulada — no se omite', () => {
  // Decisión del dueño, aprobada explícitamente. Omitirla haría parecer que el proyecto
  // tiene menos ventanas de las que tiene, y eso es peor que decir la verdad.
  const r = resumenVentanas(PROYECTO, TOPE);
  const v3 = r.filas.find((f) => f.id === 'V3');
  assert.ok(v3, 'la H98 sigue en la tabla');
  assert.equal(v3.uw, null, 'sin Uw no se inventa un número');
  assert.equal(v3.cumple, null, 'y sin Uw no hay veredicto');
  assert.equal(v3.motivo, 'perfil en certificación', 'se dice POR QUÉ falta, con la redacción aprobada');
  assert.equal(r.sinUw, 1);
  assert.equal(r.conUw, 2);
});

test('🔴 NUNCA se afirma que todo el proyecto cumple si falta un Uw', () => {
  // El error caro: extender un veredicto a una ventana que no se midió, en un documento
  // firmado. Las dos que sí se midieron cumplen — y aun así el conjunto no se dictamina.
  const r = resumenVentanas(PROYECTO, TOPE);
  assert.equal(r.filas.find((f) => f.id === 'V1').cumple, true);
  assert.equal(r.filas.find((f) => f.id === 'V2').cumple, true);
  assert.equal(r.todasCumplen, null, 'con una ventana sin calcular no hay veredicto de conjunto');
});

test('con TODAS medidas y todas bajo el tope, sí se dictamina el conjunto', () => {
  const r = resumenVentanas(PROYECTO.slice(0, 2), TOPE);
  assert.equal(r.todasCumplen, true);
});

test('una sola ventana sobre el tope tumba el veredicto del conjunto', () => {
  const conMala = [...PROYECTO.slice(0, 2), { id: 'V3', producto: 'Ventana simple', vidrio: '4+12+4', uw: 3.9 }];
  const r = resumenVentanas(conMala, TOPE);
  assert.equal(r.todasCumplen, false, 'basta una que no cumpla');
  assert.equal(r.filas[2].cumple, false);
});

test('🔒 comuna SIN PDA: se listan los Uw pero no se dictamina nada', () => {
  // Vilcún, `uw_max_Wm2K: null`: la norma no fija tope por elemento. Declarar un
  // incumplimiento contra un tope inexistente sería acusar al cliente sin regla que aplicar.
  const r = resumenVentanas(PROYECTO, null);
  assert.equal(r.exigencia, null);
  assert.equal(r.todasCumplen, null);
  assert.ok(r.filas.every((f) => f.cumple === null), 'ninguna fila dictamina');
  assert.equal(r.filas[0].uw, 2.71, 'pero el Uw calculado SÍ se informa: es un dato real');
});

test('los termopanel distintos del proyecto se identifican, sin repetir', () => {
  // Pedido del dueño: *"si hay distintos tipos de termopaneles… identificar esos y también
  // hacer el análisis con respecto a los dos"*.
  const r = resumenVentanas(PROYECTO, TOPE);
  assert.deepEqual(r.vidrios, ['4+12+4', '5+12+5'], 'dos tipos, en orden de aparición y sin duplicar');
});

test('peor y mejor Uw del proyecto salen de las ventanas medidas', () => {
  const r = resumenVentanas(PROYECTO, TOPE);
  assert.equal(r.peorUw, 2.71);
  assert.equal(r.mejorUw, 2.61);
});

test('🔒 un Uw imposible se trata como ausente, no como excelente', () => {
  // Bajo el piso físico de 0,5 W/m²K no hay ventana: hay dato corrupto. Y un Uw absurdo
  // SIEMPRE "cumple", que es justo el falso positivo caro.
  const r = resumenVentanas([{ id: 'V1', producto: 'X', vidrio: '4+12+4', uw: 0 }], TOPE);
  assert.equal(r.filas[0].uw, null);
  assert.equal(r.filas[0].motivo, 'perfil en certificación');
  assert.equal(r.todasCumplen, null, 'y no arrastra un "todo cumple"');
});

test('sin ventanas no se inventa un veredicto', () => {
  for (const vacio of [[], null, undefined, 'no es un array']) {
    const r = resumenVentanas(vacio, TOPE);
    assert.equal(r.filas.length, 0, `con ${JSON.stringify(vacio)}`);
    assert.equal(r.todasCumplen, null);
    assert.equal(r.totalVentanas, 0);
  }
});

test('items corruptos no tumban la tabla', () => {
  // Los ítems vienen del motor a través de la tool: cualquier campo puede faltar.
  const r = resumenVentanas([{}, { uw: 2.5 }, null], TOPE);
  assert.equal(r.filas.length, 3);
  assert.equal(r.filas[0].id, 'V1', 'sin id, se numera por posición');
  assert.equal(r.filas[0].producto, 'Ventana', 'sin producto, un rótulo neutro');
  assert.equal(r.filas[1].uw, 2.5);
  assert.equal(r.filas[2].cantidad, 1, 'sin cantidad, una');
});

test('la cantidad se respeta y se normaliza', () => {
  const r = resumenVentanas([
    { id: 'V1', uw: 2.6, cantidad: 6 },
    { id: 'V2', uw: 2.6, cantidad: 0 },
    { id: 'V3', uw: 2.6, cantidad: '3' },
    { id: 'V4', uw: 2.6, cantidad: -2 },
  ], TOPE);
  assert.equal(r.totalVentanas, 6 + 1 + 3 + 1, 'cero y negativo caen a 1: una ventana existe');
});

// ── 🔴 [2026-08-24] LA SINTESIS DEL CONJUNTO — LAS FRASES QUE VAN FIRMADAS ───────────
// Estas dos o tres lineas son lo unico que un cliente apurado lee de todo el informe: el
// resumen en negrita bajo la tabla. Estaban embebidas en el dibujo del PDF, o sea no se
// podian probar, y tenian un defecto que la compuerta cruzada destapo a medias.
//
// EL DEFECTO GRAVE (lo encontre revisando el hallazgo P2 de Gemini sobre la redaccion):
// la rama de incumplimiento cerraba SIEMPRE con "El resto cumple", incluso cuando NO HAY
// resto. Un proyecto de 8 ventanas donde las 8 exceden la exigencia imprimia:
//     "Sobre la exigencia de su comuna: V1, V2, V3, V4, V5, V6, V7, V8. El resto cumple."
// Es una afirmacion de cumplimiento sobre un conjunto VACIO, en un documento firmado por
// un evaluador acreditado MINVU, entregada a alguien que esta por gastar varios millones.
// Ademas "Sobre la exigencia" se lee ambiguo en Chile ("respecto a" vs "por encima de"),
// que era el P2 que Gemini si vio.

import { sintesisProyecto } from './informeTermicoPdf.js';

const proyDe = (uws, exigencia = 3.2) =>
  resumenVentanas(uws.map((uw, i) => ({ id: `V${i + 1}`, producto: 'Ventana', uw })), exigencia);

const textos = (p) => sintesisProyecto(p).map((l) => l.texto).join(' ');

test('todas cumplen → se dice, y con el numero exacto de calculadas', () => {
  const t = textos(proyDe([2.8, 2.9, 3.0]));
  assert.match(t, /Las 3 ventanas calculadas cumplen/);
  assert.doesNotMatch(t, /no cumple/i);
});

test('algunas no cumplen → se nombran, y "el resto cumple" es cierto', () => {
  const t = textos(proyDe([2.8, 3.9, 2.9]));
  assert.match(t, /V2/, 'hay que decir CUAL no cumple');
  // [Gemini 3a] Singular: en este caso falla UNA sola (V2). El plural iba a un sujeto singular.
  assert.match(t, /No cumple la exigencia/, 'categorico: nada de "sobre la exigencia"');
  assert.match(t, /El resto cumple/, 'y aca si hay resto que cumple');
});

test('🔴 NINGUNA cumple → NO puede decir "el resto cumple": no hay resto', () => {
  const t = textos(proyDe([3.9, 4.1, 3.5]));
  assert.doesNotMatch(t, /El resto cumple/,
    'afirmar cumplimiento de un conjunto vacio en un documento firmado');
  assert.match(t, /Ninguna de las 3 ventanas calculadas cumple/);
});

test('🔴 una sola ventana y no cumple → tampoco hay resto', () => {
  const t = textos(proyDe([4.5]));
  assert.doesNotMatch(t, /El resto cumple/);
});

test('falta algun Uw → NUNCA se afirma nada del conjunto', () => {
  const t = textos(proyDe([2.8, null, 2.9]));
  assert.doesNotMatch(t, /cumplen la exigencia/,
    'con un Uw ausente no hay veredicto de conjunto posible');
  assert.match(t, /1 de 3 ventanas queda/, 'pero si se dice cuantas quedan pendientes');
});

test('la frase de pendientes concuerda en numero (P2 de Gemini)', () => {
  const t = textos(proyDe([2.8, null, null]));
  assert.match(t, /Se lo informamos apenas esté disponible/,
    '"se las informamos apenas esté disponible" mezclaba plural y singular');
  assert.match(t, /2 de 3 ventanas quedan/, 'plural cuando son varias');
  const uno = textos(proyDe([2.8, null]));
  assert.match(uno, /1 de 2 ventanas queda /, 'singular cuando es una');
});

test('sin exigencia (comuna sin PDA) no se inventa ningun veredicto', () => {
  const t = textos(proyDe([2.8, 3.9], null));
  assert.doesNotMatch(t, /cumple/i, 'sin tope normativo no hay nada que declarar');
});

test('un proyecto vacio no produce ninguna frase', () => {
  assert.deepEqual(sintesisProyecto(resumenVentanas([], 3.2)), []);
});

// ── 🔴 [2026-08-24 · Codex, compuerta cruzada] PARTIDAS vs UNIDADES ──────────────────
// EL DEFECTO: el encabezado contaba UNIDADES (suma de cantidades) y la sintesis contaba
// FILAS. Dos items de cantidad 3 producian, en la misma pagina de un documento firmado:
//     encabezado → "6 ventanas"
//     sintesis   → "Las 2 ventanas calculadas cumplen la exigencia de su comuna."
// Y peor con lo pendiente: una fila de cantidad 5 sin Uw junto a otra medida anunciaba
// "1 de 2 ventanas" con el calculo pendiente cuando en realidad son 5 de 6.
//
// Un cliente que suma las cifras del informe y no le cuadran deja de creerle al resto del
// informe, que es lo unico que este documento tiene para ofrecer.
//
// LA REGLA: el cliente compra UNIDADES, asi que TODO lo que se le declara se cuenta en
// unidades. Las filas son un detalle de como se agrupo la cotizacion, no una magnitud.

const proyCant = (items, exigencia = 3.2) =>
  resumenVentanas(items.map((it, i) => ({ id: `V${i + 1}`, producto: 'Ventana', ...it })), exigencia);

test('🔴 unidades y filas no pueden contradecirse: dos partidas de 3 son 6 ventanas', () => {
  const p = proyCant([{ uw: 2.8, cantidad: 3 }, { uw: 2.9, cantidad: 3 }]);
  assert.equal(p.totalVentanas, 6);
  assert.equal(p.unidadesConUw, 6);
  assert.equal(p.unidadesSinUw, 0);
  assert.match(textos(p), /Las 6 ventanas calculadas cumplen/,
    'la sintesis tiene que hablar del mismo numero que el encabezado');
});

test('🔴 pendientes en UNIDADES: 5 sin calcular de 6 no es "1 de 2"', () => {
  const p = proyCant([{ uw: null, cantidad: 5 }, { uw: 2.8, cantidad: 1 }]);
  assert.equal(p.unidadesSinUw, 5);
  assert.equal(p.totalVentanas, 6);
  assert.match(textos(p), /5 de 6 ventanas quedan con el cálculo pendiente/);
});

test('ninguna cumple, contado en unidades', () => {
  const p = proyCant([{ uw: 3.9, cantidad: 4 }]);
  assert.match(textos(p), /Ninguna de las 4 ventanas calculadas cumple/);
});

// ── 🔴 [Codex] LA CANTIDAD NO SE INVENTA ────────────────────────────────────────────
// `Number(qty) || 1` convertia `undefined`, `0`, `'abc'` y los negativos en un 1 que nadie
// informo. Que una fila exista prueba que hay AL MENOS una ventana —de eso vino el item
// cotizado— pero no prueba que sea exactamente una. Se sigue usando 1 como piso para no
// romper los conteos, y ademas queda MARCADO, que es lo que faltaba: un dato supuesto que
// no se distingue de uno informado es indistinguible de una invencion.
test('🔴 una cantidad ausente o basura queda MARCADA como incierta', () => {
  for (const mala of [undefined, null, 0, -3, 'abc', NaN, 2.5]) {
    const [f] = proyCant([{ uw: 2.8, cantidad: mala }]).filas;
    assert.equal(f.cantidad, 1, `piso de 1 para ${String(mala)}: la ventana existe`);
    assert.equal(f.cantidadIncierta, true, `y marcada: ${String(mala)} no es una cantidad`);
  }
});

test('una cantidad informada NO se marca como incierta', () => {
  const [f] = proyCant([{ uw: 2.8, cantidad: 4 }]).filas;
  assert.equal(f.cantidad, 4);
  assert.equal(f.cantidadIncierta, false);
});

// ── [2026-08-24 · Gemini, 2a y 3a pasada] CONCORDANCIA Y LISTAS ──────────────────────
// Cuatro defectos de redaccion en frases que van dentro de un documento firmado:
//   "Las 1 ventanas calculadas cumplen"  ·  "Ninguna de las 1 ventanas calculadas cumple"
//   "No cumplen la exigencia de su comuna: V1"  ·  "3 termopaneles: A y B y C"
//
// ⚠️ ESTOS TESTS SE ESCRIBIERON DOS VECES. La primera vez el arreglo y sus tests se
// perdieron al restaurar un archivo de respaldo mientras se mataban mutantes, y la suite
// quedo en verde porque los tests que los protegian ya no existian — un verde que no
// probaba nada. Lo cazo Gemini reportando los mismos hallazgos otra vez.
// La leccion no es "tener cuidado": es que los respaldos por `cp` no sirven para volver a
// un estado conocido. Se restaura desde el indice de git, que es el estado que se va a
// commitear.
//
// 🔎 ALCANCE HONESTO: los dos casos de una sola ventana NO son alcanzables hoy desde el
// PDF — con una unidad se dibuja el recuadro grande y esta sintesis ni se llama. Se
// corrigen igual porque `sintesisProyecto` es publica y es la funcion que decide que se
// afirma en un documento firmado.
test('una sola ventana que cumple: singular, no "Las 1 ventanas"', () => {
  assert.match(textos(proyDe([2.8])), /^La ventana calculada cumple la exigencia de su comuna\./);
});

test('una sola ventana que no cumple: singular, no "Ninguna de las 1"', () => {
  const t = textos(proyDe([4.2]));
  assert.match(t, /La ventana calculada no cumple la exigencia de su comuna\./);
  assert.doesNotMatch(t, /Ninguna de las 1/);
});

test('una sola PARTIDA de 3 unidades sigue en plural: son 3 ventanas', () => {
  assert.match(textos(proyCant([{ uw: 2.8, cantidad: 3 }])), /Las 3 ventanas calculadas cumplen/);
});

test('🔴 [Gemini 3a] UNA sola ventana fallada: "No cumple", no "No cumplen"', () => {
  const t = textos(proyDe([2.8, 4.2, 2.9]));
  assert.match(t, /No cumple la exigencia de su comuna: V2\. El resto cumple\./);
  assert.doesNotMatch(t, /No cumplen/);
});

test('varias ventanas falladas: plural', () => {
  assert.match(textos(proyDe([2.8, 4.2, 3.9])), /No cumplen la exigencia de su comuna: V2, V3\./);
});

test('tres o mas termopaneles se listan con comas, no "A y B y C"', () => {
  const p = resumenVentanas(
    ['DVH 4/12/4', 'DVH 5/12/5 Low-E', 'DVH 6/12/6'].map((vidrio, i) =>
      ({ id: `V${i + 1}`, producto: 'Ventana', vidrio, uw: 2.8 })), 3.2);
  const t = textos(p);
  assert.match(t, /DVH 4\/12\/4, DVH 5\/12\/5 Low-E y DVH 6\/12\/6/);
  assert.doesNotMatch(t, /4\/12\/4 y DVH 5/, 'la "y" repetida no se usa en un informe tecnico');
});

test('dos termopaneles siguen con "y" a secas', () => {
  const p = resumenVentanas([
    { id: 'V1', producto: 'Ventana', vidrio: 'DVH 4/12/4', uw: 2.8 },
    { id: 'V2', producto: 'Ventana', vidrio: 'DVH 6/12/6', uw: 2.9 }], 3.2);
  assert.match(textos(p), /DVH 4\/12\/4 y DVH 6\/12\/6/);
});

test('🔴 [Codex 3a] los N° salen del PROYECTO, no de la llamada que cotizo cada ventana', () => {
  // `calcular_cotizacion` numeraba con el indice de SU propio array, que tiene un solo
  // item: ocho ventanas cotizadas daban ocho "V1". Y el PDF usa ese numero para decir cual
  // no cumple, o sea el informe podia decir "No cumplen: V1, V1, V1" — ilegible y ademas
  // inutil para ubicar la ventana en la obra.
  // La numeracion la hace ESTA funcion, que es la unica que ve el proyecto completo.
  const sinId = [2.7, 3.9, 2.8].map((uw) => ({ producto: 'Corredera', medidas: '1x1', vidrio: 'X', uw }));
  const p = resumenVentanas(sinId, 3.2);
  assert.deepEqual(p.filas.map((f) => f.id), ['V1', 'V2', 'V3']);
  assert.match(textos(p), /No cumple la exigencia de su comuna: V2\./,
    'y el veredicto puede senalar CUAL de las tres');
});
