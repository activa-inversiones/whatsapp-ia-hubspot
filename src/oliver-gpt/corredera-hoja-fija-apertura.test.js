import test from 'node:test';
import assert from 'node:assert/strict';
import { mapAperturaToEngine, detectConfigCorredera, detectHojas } from '../../services/enginePricer.js';

/* =========================================================================
 * 🔴 LA CAPA DE ARRIBA SE ROBABA LA VENTANA (2026-09-18)
 *
 * El dueno mando una lista real y las triple hoja salieron en el PDF como
 * "Ventana Compuesta: Fijo 1383,5 mm + Proyectante". Textual suyo: "error tras error".
 *
 * Investigando salio que el trabajo de deteccion de configuracion (riel, central fija)
 * funcionaba PERFECTO y nunca se ejecutaba, porque el tipo de ventana ya se habia decidido
 * mal una capa antes:
 *
 *     detectarAperturaLocal("CORREDERA DOBLE RIEL TRIPLE HOJA, LA DEL MEDIO FIJA")
 *       -> la rama /\bfij[ao]s?\b/ corre ANTES que la de corredera
 *       -> devuelve "FIJA"  (un pano fijo, serie S60)
 *
 * O sea la palabra "FIJA", que describe UNA HOJA de la corredera, se leia como el tipo de
 * la ventana entera. Y `buildItems` hace `let tipo = mapAperturaToEngine(item.product)`, asi
 * que ese tipo manda.
 *
 * ⚠️ El orden NO se puede invertir a lo bruto: la rama FIJO esta antes a proposito desde el
 * 2026-06-24, porque "FIJA"/"BATIENTE" caian al fallback CORREDERA y se cotizaban al DOBLE
 * de precio (casos 0064/0065/0066). Por eso la regla es angosta: la corredera gana solo
 * cuando el texto NOMBRA la corredera Y dice que la fija es UNA HOJA de ella.
 * ========================================================================= */

test('🔴 "corredera ... la del medio fija" es una CORREDERA, no un paño fijo', () => {
  for (const t of [
    'CORREDERA DOBLE RIEL TRIPLE HOJA, LA DEL MEDIO FIJA',
    'CORREDERA DOBRE RIEL TRIPLE HOJA, LA DEL MEDIO FIJA',   // el typo real de la lista
    'corredera tres hojas la del centro fija',
    'corredera 3 hojas central fija',
    'corredera de 3 hojas, la central es fija',
    'corredera 2 hojas con una hoja fija',
    'ventanal corredera con el paño central fijo',
  ]) {
    assert.equal(mapAperturaToEngine(t), 'CORREDERA', t);
  }
});

test('🔒 y ademas conserva la configuracion que ya sabiamos leer', () => {
  const t = 'CORREDERA DOBLE RIEL TRIPLE HOJA, LA DEL MEDIO FIJA';
  assert.equal(mapAperturaToEngine(t), 'CORREDERA');
  assert.equal(detectHojas(t), 3);
  const cfg = detectConfigCorredera(t, 3);
  assert.equal(cfg.riel, 'DOBLE');
  assert.equal(cfg.centralFija, true);
  assert.equal(cfg.ambiguo, false);
});

test('🔒 NO se rompe el fix de 2026-06-24: una ventana fija de verdad sigue siendo FIJA', () => {
  // Estos cotizaban al DOBLE (caian al fallback CORREDERA). El orden existe por esto.
  for (const t of ['ventana fija', 'paño fijo', 'fija 1200x800', 'marco fijo', 'ventanas fijas']) {
    assert.equal(mapAperturaToEngine(t), 'FIJA', t);
  }
});

test('🔒 las demas aperturas no se mueven', () => {
  assert.equal(mapAperturaToEngine('corredera de 2 hojas'), 'CORREDERA');
  assert.equal(mapAperturaToEngine('proyectante baño'), 'PROYECTANTE');
  assert.equal(mapAperturaToEngine('mitad fija mitad proyectante'), 'COMPUESTA');
  assert.equal(mapAperturaToEngine('oscilobatiente'), 'OSCILOBATIENTE');
});

/* =========================================================================
 * 🔱 LOS QUE CAZO LA COMPUERTA (Codex) SOBRE LA PRIMERA VERSION DE LA GUARDIA
 * Todos MEDIDOS, no supuestos. Dos eran defectos mios de verdad.
 * ========================================================================= */

test('🔴 AUTOGOL: el ejemplo del propio prompt caia en FIJA', () => {
  // Yo mismo escribi esta frase en la Regla #34 como el caso que Oliver debe reconocer...
  // y mi detector la mandaba a FIJA, porque no dice la palabra "corredera".
  // El cliente describe la corredera por el VERBO tanto como por el sustantivo.
  for (const t of [
    'paño central fijo y los laterales corren',
    'pano central fijo y los laterales corren',
    'la del medio fija y las otras dos se mueven',
  ]) {
    assert.equal(mapAperturaToEngine(t), 'CORREDERA', t);
  }
});

test('🔴 REGRESION QUE INTRODUJE: la negacion manda sobre la guardia', () => {
  // Antes de la guardia esto daba FIJA. Con la primera version daba CORREDERA: sobrecobro.
  for (const t of [
    'no quiero corredera, quiero hoja fija',
    'no quiero una corredera, necesito un paño fijo',
  ]) {
    assert.equal(mapAperturaToEngine(t), 'FIJA', t);
  }
});

test('🔴 REGRESION QUE INTRODUJE: "cambiar la corredera POR una hoja fija" es FIJA', () => {
  // Mismo criterio que ya existia para "reemplazar la ventana por una puerta".
  for (const t of [
    'cambiar la corredera por una hoja fija',
    'reemplazar la corredera por un paño fijo',
  ]) {
    assert.equal(mapAperturaToEngine(t), 'FIJA', t);
  }
});

test('🔒 una LISTA de varias ventanas no se resuelve inventando un ganador', () => {
  // La guardia mira el texto entero: si hay varias ventanas distintas en una linea, NO debe
  // convertirlas todas en corredera. Estas siguen como estaban (no se tocan).
  for (const t of ['pano fijo y una corredera', '3 fijas y 2 correderas']) {
    assert.equal(mapAperturaToEngine(t), 'FIJA', t);
  }
});

test('🔴 SEGUNDO AUTOGOL: la frase TEXTUAL de la lista del cliente, sin sustantivo ni verbo', () => {
  // "doble riel triple hoja la del medio fija" no dice "corredera" NI dice "corren".
  // Lo que la delata es la ESTRUCTURA: ninguna otra apertura tiene RIELES.
  // Codex la marco como blocker: era uno de los ejemplos normativos del propio prompt.
  for (const t of [
    'doble riel triple hoja la del medio fija',
    'triple riel, la del medio fija',
    'dos rieles, tres hojas, la central fija',
  ]) {
    assert.equal(mapAperturaToEngine(t), 'CORREDERA', t);
  }
});

test('🔒 los verbos llevan limites de palabra (inmoviles / recorren no cuentan)', () => {
  for (const t of ['hojas fijas inmoviles', 'recorren el pano fijo', 'las hojas no corren, son fijas']) {
    assert.equal(mapAperturaToEngine(t), 'FIJA', t);
  }
});

test('🔗 CADENA COMPLETA: las 2 ventanas reales arman el pedido correcto al motor', () => {
  // Codex, con razon: "estos tests solo prueban palabras; no demuestran que desaparecio la
  // subcotizacion". Esto asegura la TERNA que se le manda al motor, que es lo que fija el
  // precio. Los numeros en vivo (18-sep, motor ops.activalabs.ai) para esta terna fueron:
  //   V1 2710x1995 -> $896.122 con IVA   (el PDF malo decia $675.629 netos)
  //   V4 2325x980  -> $508.838 con IVA   (el PDF malo decia $327.463 netos)
  // El PDF malo las mandaba como COMPUESTA y repartia 50/50 fijo+proyectante: ~$178.000
  // netos de menos entre las dos.
  for (const t of [
    'CORREDERA DOBLE RIEL TRIPLE HOJA, LA DEL MEDIO FIJA',
    'CORREDERA DOBRE RIEL TRIPLE HOJA, LA DEL MEDIO FIJA',
  ]) {
    const tipo = mapAperturaToEngine(t);
    const hojas = detectHojas(t);
    const cfg = detectConfigCorredera(t, hojas);
    assert.equal(tipo, 'CORREDERA', `${t} -> tipo`);
    assert.notEqual(tipo, 'COMPUESTA', 'jamas COMPUESTA: eso subcotiza');
    assert.equal(hojas, 3, `${t} -> hojas`);
    assert.equal(cfg.riel, 'DOBLE', `${t} -> riel`);
    assert.equal(cfg.centralFija, true, `${t} -> central fija`);
    assert.equal(cfg.ambiguo, false, `${t} -> no escala`);
  }
});
