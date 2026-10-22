// ufDosModelos.test.js — [2026-10-22]
//
// GUARDIA de la decisión del dueño (21-oct): «declarar ambos Uf, explicando que vienen de modelos
// distintos». Imagen aprobada el 22-oct. Lo que no puede volver:
//  · que el informe muestre UN solo Uf cuando hay dos modelos para el mismo perfil;
//  · que los dos se promedien, o uno pise al otro;
//  · que el PDF al cliente diga «HUECO», «no comprada» o «no certificado».

import test from 'node:test';
import assert from 'node:assert/strict';
import { filasUfDosModelos, UF_FEM_TRI_POR_LINEA, TEXTO_UF_DOS_MODELOS } from './ufDosModelos.js';
import { generarInformeTermicoPdf } from './informeTermicoPdf.js';
import { textoDelPdf } from './textoDelPdf.testutil.js';

// El ítem tal como lo arma webhook.js: `producto` = rótulo del motor y `_perfil` = el ítem
// completo de calculateQuote, con `termico` = la respuesta de THERMAL `/uw` (uwClient.js).
const ventana = (producto, termico, extra = {}) => ({
  id: 'V1', producto, medidas: '2400x1800', vidrio: 'DVH 5-12-5', cantidad: 1,
  uw: termico?.uw ?? null, _perfil: { producto_label: producto, termico }, ...extra,
});
const H98 = (uf = 2.3) => ({ perfil: 'Sliding_H98', uw: 2.62, detalle: { perfil: 'Sliding_H98', uf } });
const DOBLE = 'Corredera SLIDING H98 Doble Riel S75';
const TRIPLE = 'Corredera SLIDING H98 Triple Riel S75';

test('🔴 los DOS Uf del mismo perfil, cada uno de su fuente, sin promediar', () => {
  const [f] = filasUfDosModelos([ventana(DOBLE, H98())]);
  assert.equal(f.ufModelo1, 2.3, 'modelo 1 = el Uf que THERMAL usó para el Uw (detalle.uf)');
  assert.deepEqual(f.nodos.map((n) => n.uf), [2.1, 2.2, 1.7], 'modelo 2 = Tabla 1 del folio 000012');
  assert.equal(f.folio, 'AT-NCH3137-2-2026-000012');
  // Ningún campo trae un promedio ni un valor «combinado».
  assert.deepEqual(Object.keys(f).sort(), ['folio', 'linea', 'nodos', 'ufModelo1']);
});

test('🔴 el modelo 1 se LEE del ítem: sale el número que de verdad entró al Uw', () => {
  const [f] = filasUfDosModelos([ventana(TRIPLE, H98(2.31))]);
  assert.equal(f.ufModelo1, 2.31, 'si THERMAL cambia el certificado, el informe lo sigue');
  assert.deepEqual(f.nodos.map((n) => n.uf), [2.4, 2.2, 2.5, 1.7], 'Tabla 1 del folio 000008');
});

test('🔴 sin el Uf del modelo 1 NO hay fila: no se inventa un 2,30 de memoria', () => {
  assert.deepEqual(filasUfDosModelos([ventana(DOBLE, null)]), []);
  assert.deepEqual(filasUfDosModelos([ventana(DOBLE, { perfil: 'Sliding_H98', uw: 2.6 })]), []);
  assert.deepEqual(filasUfDosModelos([ventana(DOBLE, H98(0))]), [], 'un 0 no es un Uf');
});

test('🔴 el modelo 1 tiene que ser del MISMO perfil que el fem-tri', () => {
  const h80 = { perfil: 'Sliding_H80', uw: 2.7, detalle: { perfil: 'Sliding_H80', uf: 2.3 } };
  assert.deepEqual(filasUfDosModelos([ventana(DOBLE, h80)]), [], 'un H80 al lado del fem-tri del H98 compara dos marcos distintos');
});

test('calce EXACTO del rótulo (regla del piloto Uw): con agregados no calza', () => {
  assert.deepEqual(filasUfDosModelos([ventana(`${DOBLE} - triple hoja central fija`, H98())]), []);
  assert.deepEqual(filasUfDosModelos([ventana('Corredera ANDES 66 Monorriel', H98())]), [], 'Andes: solo fem-tri, sin par');
  assert.deepEqual(filasUfDosModelos([ventana('Proyectante S60', { perfil: 'S60_proyectante_exterior', detalle: { uf: 1.69 } })]), []);
});

test('una fila por LÍNEA, no por ventana, en el orden del proyecto', () => {
  const filas = filasUfDosModelos([ventana(TRIPLE, H98()), ventana(DOBLE, H98()), ventana(TRIPLE, H98())]);
  assert.deepEqual(filas.map((f) => f.linea), ['Corredera S75 H98 triple riel', 'Corredera S75 H98 doble riel']);
});

test('🔴 [Codex r2-r3] misma línea con Uf distintos del modelo 1: esa línea NO se declara (ni el primero, ni juntos)', () => {
  const filas = filasUfDosModelos([ventana(DOBLE, H98(2.31)), ventana(DOBLE, H98(2.3)), ventana(TRIPLE, H98())]);
  assert.deepEqual(filas.map((f) => f.linea), ['Corredera S75 H98 triple riel'], 'la doble se cae; la triple sigue');
  // [Codex r5] Se compara EXACTO: dos Uf que se imprimirían igual («2,30») siguen siendo distintos.
  assert.deepEqual(filasUfDosModelos([ventana(DOBLE, H98(2.301)), ventana(DOBLE, H98(2.304))]), []);
  assert.equal(filasUfDosModelos([ventana(DOBLE, H98(2.3)), ventana(DOBLE, H98(2.3))]).length, 1, 'iguales sí');
});

test('🔴 [Codex r4 · Copilot r4] UNA ventana de la línea sin modelo 1 compatible invalida la LÍNEA entera', () => {
  const h80 = { perfil: 'Sliding_H80', uw: 2.7, detalle: { perfil: 'Sliding_H80', uf: 2.3 } };
  for (const mala of [null, { perfil: 'Sliding_H98', uw: 2.6 }, h80, H98(0)]) {
    assert.deepEqual(filasUfDosModelos([ventana(DOBLE, H98()), ventana(DOBLE, mala)]), [], `segunda ventana: ${JSON.stringify(mala)}`);
    assert.deepEqual(filasUfDosModelos([ventana(DOBLE, mala), ventana(DOBLE, H98())]), [], 'y en cualquier orden');
  }
});

test('[Codex r4] el Uf del modelo 1 tiene que ser un número: true / "2.3" no se declaran', () => {
  assert.deepEqual(filasUfDosModelos([ventana(DOBLE, H98(true))]), []);
  assert.deepEqual(filasUfDosModelos([ventana(DOBLE, H98('2.3'))]), []);
});

test('[Codex r3] el perfil sale del mismo objeto que el Uf: si los dos niveles discrepan, no se declara', () => {
  const raro = { perfil: 'Sliding_H80', uw: 2.6, detalle: { perfil: 'Sliding_H98', uf: 2.3 } };
  assert.deepEqual(filasUfDosModelos([ventana(DOBLE, raro)]), []);
});

test('🔴 [Codex r3] cada folio va con SUS valores (Tabla 1 del PDF oficial): cambiar uno sin el otro rompe', () => {
  const par = (k) => [UF_FEM_TRI_POR_LINEA[k].folio, UF_FEM_TRI_POR_LINEA[k].nodos.map((n) => n.uf)];
  assert.deepEqual(par('corredera sliding h98 doble riel s75'), ['AT-NCH3137-2-2026-000012', [2.1, 2.2, 1.7]]);
  assert.deepEqual(par('corredera sliding h98 triple riel s75'), ['AT-NCH3137-2-2026-000008', [2.4, 2.2, 2.5, 1.7]]);
});

test('la tabla fem-tri solo tiene líneas H98 con folio de informe de marcos', () => {
  for (const [k, e] of Object.entries(UF_FEM_TRI_POR_LINEA)) {
    assert.equal(e.perfil, 'Sliding_H98', k);
    assert.match(e.folio, /^AT-NCH3137-2-2026-\d{6}$/, k);
    assert.ok(e.nodos.length > 0 && e.nodos.every((n) => n.uf > 0), k);
  }
});

test('🔴 el texto al cliente declara el método y nunca dice HUECO / no comprada / no certificado', () => {
  const todo = Object.values(TEXTO_UF_DOS_MODELOS).join(' ');
  for (const prohibido of [/hueco/i, /no comprad/i, /no certificad/i]) assert.doesNotMatch(todo, prohibido);
  assert.match(todo, /THERM/);
  assert.match(todo, /fem-tri/);
  assert.match(todo, /NCh 3137\/2/);
  assert.match(todo, /No se promedian/);
});

test('🔴 [Copilot/Codex r1-r2] el modelo 1 dice que el informe es del H80 y que ACTIVA lo aplica al H98', () => {
  const T = TEXTO_UF_DOS_MODELOS;
  assert.match(T.modelo1, /hoja H80 \(tabla C\.1\)/);
  assert.match(T.modelo1, /ACTIVA aplica ese valor a la hoja H98/);
  assert.match(T.modelo1, /Es el Uf con que se calculó el Uw de las ventanas de cada línea/);
  // [Codex r5] el método del modelo 1 también se declara, no solo su procedencia.
  assert.match(T.modelo1, /programa THERM según NCh 3137\/2 con panel de sustitución: Uf = \(L2D - Up·bp\)\/bf/);
  assert.match(T.cierre, /perfil completo \/ nodo a nodo/);
  // Ni una causa no medida («difieren porque…») ni una verificabilidad que el cliente no recibe (QR).
  assert.doesNotMatch(Object.values(T).join(' '), /porque|QR/);
});

const DATOS = { comuna: 'Temuco', regimen: 'PDA', uw_max_Wm2K: 3.2, zona_termica_NCh1079: 'F', criterio_ref: 'PDA Temuco art. 27' };

test('🔴 PDF renderizado: la sección aparece con los dos Uf y los folios', async () => {
  const ventanas = [ventana(DOBLE, H98()), { ...ventana(TRIPLE, H98()), id: 'V2' }];
  const txt = textoDelPdf(await generarInformeTermicoPdf(DATOS, { ventanas }));
  assert.ok(txt.includes('dos modelos, lado a lado'), 'el título de la sección');
  assert.ok(txt.includes('2,30'), 'el Uf del modelo 1');
  for (const v of ['2,1', '2,2', '1,7', '2,4', '2,5']) assert.ok(txt.includes(v), `el Uf fem-tri ${v}`);
  assert.ok(txt.includes('AT-NCH3137-2-2026-000012') && txt.includes('AT-NCH3137-2-2026-000008'), 'los dos folios');
  assert.doesNotMatch(txt, /HUECO|no comprad|no certificad/i);
});

test('sin líneas con los dos modelos el informe sale como antes (sin la sección)', async () => {
  const ventanas = [ventana('Fijo S60', { perfil: 'S60_fijo', uw: 2.6, detalle: { uf: 1.49 } })];
  const txt = textoDelPdf(await generarInformeTermicoPdf(DATOS, { ventanas }));
  assert.ok(!txt.includes('dos modelos, lado a lado'));
});
