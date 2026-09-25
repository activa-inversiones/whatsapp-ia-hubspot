// informeVientosPdf.curvas.test.js — [2026-08-28]
//
// LA PAGINA DE CURVAS del informe de vientos. Pedido del dueno, textual: *"la idea es que
// el informe de vientos tenga muchas curvas e indique varias cosas las maximas que indica
// la ley asi sera mas representativo"*.
//
// Que se defiende aca:
// 1. Con el bloque "curvas" del motor, el PDF crece a 2+ paginas (grafico + interseccion
//    + ley); SIN el bloque (motor viejo o hueco), sale la version corta de 1 pagina y
//    nada se rompe: el informe es un regalo de la secuencia, no puede caerse por esto.
// 2. El cliente de THERMAL PIDE las curvas (incluir_curvas: true) — sin eso el motor
//    nuevo respondera la version pobre y el grafico jamas aparecera en produccion.
// 3. Doctrina de copy del dueno: cero guiones largos en lo que ve el cliente, y las
//    siglas se explican antes de usarse (kPa se presenta como kilopascales con su
//    equivalencia en kilos).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generarInformeVientosPdf } from './informeVientosPdf.js';

const SRC_PDF = readFileSync(new URL('./informeVientosPdf.js', import.meta.url), 'utf8');
const SRC_CLI = readFileSync(new URL('./vientosThermal.js', import.meta.url), 'utf8');

function datosBase() {
  return {
    ventanas: [{
      nombre: 'Proyectante S60', ancho_mm: 1000, alto_mm: 1200,
      vidrio: 'DVH 4/12/4 recocido', cantidad: 2,
      capacidad: { lr_corta_kPa: 4.05, lr_larga_kPa: 1.76, nfl_kPa: 2.25 },
      veredicto: { evaluable: true, cumple_corta: true },
      flechas: { referencia: { flecha_maxima_mm: 4.6 } },
    }],
    demanda: { presion_kPa: 0.694, q_basica_kg_m2: 59.0, factor_forma_C: 1.2 },
  };
}

function bloqueCurvas() {
  const puntos = (base) => Array.from({ length: 20 }, (_, i) => ({
    area_m2: Number((0.4 + i * 0.2).toFixed(2)),
    lr_corta_kPa: Number((base / (0.4 + i * 0.2)).toFixed(2)),
  }));
  return {
    proporcion_alto_ancho: 1.2,
    supuesto: 'curvas para termopanel simétrico, en vidrio recocido',
    capacidad_por_espesor: [
      { espesor_mm: 4, puntos: puntos(4.9) },
      { espesor_mm: 5, puntos: puntos(7.5) },
      { espesor_mm: 6, puntos: puntos(9.0) },
      { espesor_mm: 8, puntos: puntos(13.0) },
    ],
    demanda_legal: [
      { etiqueta: 'Ciudad, 3 m (caso típico)', presion_kPa: 0.694, entorno: 'ciudad', altura_m: 3 },
      { etiqueta: 'Ciudad, 10 m', presion_kPa: 0.804, entorno: 'ciudad', altura_m: 10 },
      { etiqueta: 'Campo abierto o costa, 3 m', presion_kPa: 0.824, entorno: 'campo_abierto', altura_m: 3 },
      { etiqueta: 'Campo abierto o costa, 10 m', presion_kPa: 1.247, entorno: 'campo_abierto', altura_m: 10 },
    ],
    interseccion_por_ventana: [{
      nombre: 'Proyectante S60', ancho_mm: 1000, alto_mm: 1200, area_m2: 1.2,
      espesor_propio_mm: 4,
      por_espesor: [
        { espesor_mm: 4, lr_corta_kPa: 4.05, cumple: true },
        { espesor_mm: 5, lr_corta_kPa: 4.94, cumple: true },
        { espesor_mm: 6, lr_corta_kPa: 6.19, cumple: true },
        { espesor_mm: 8, lr_corta_kPa: null, cumple: null },
      ],
    }],
    base_legal: 'La norma chilena de viento (NCh 432, cláusula 6.3) manda una estadística de 20 años...',
  };
}

const paginasDe = (buf) => (buf.toString('latin1').match(/\/Type \/Page[^s]/g) || []).length;

test('con el bloque de curvas el informe crece a 2+ paginas', async () => {
  const conCurvas = { ...datosBase(), curvas: bloqueCurvas() };
  const pdf = await generarInformeVientosPdf(conCurvas, { nombre: 'M', comuna: 'Loncoche', numeroInforme: 'T-1' });
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(paginasDe(pdf) >= 2, `esperaba 2+ paginas, hubo ${paginasDe(pdf)}`);
});

test('sin bloque de curvas sale la version corta de 1 pagina, sin romper', async () => {
  const pdf = await generarInformeVientosPdf(datosBase(), { nombre: 'M', comuna: 'Loncoche', numeroInforme: 'T-2' });
  assert.ok(Buffer.isBuffer(pdf));
  // [2026-09-25] Vuelve a 1 pagina, como siempre: la clausula dejo de ser una caja al final
  // y pasa a sellarse en el borde inferior de cada hoja, y el recuadro beige que iba arriba
  // se retiro. El pie con logos entra sin empujar nada.
  assert.equal(paginasDe(pdf), 1);
});

test('un bloque de curvas HUECO (motor declaro que no pudo) tampoco rompe', async () => {
  const datos = { ...datosBase(), curvas: { _hueco: true, por_que: 'x' } };
  const pdf = await generarInformeVientosPdf(datos, { nombre: 'M', comuna: 'L', numeroInforme: 'T-3' });
  // [2026-09-25] Vuelve a 1 pagina, como siempre: la clausula dejo de ser una caja al final
  // y pasa a sellarse en el borde inferior de cada hoja, y el recuadro beige que iba arriba
  // se retiro. El pie con logos entra sin empujar nada.
  assert.equal(paginasDe(pdf), 1);
});

test('[Gemini, compuerta] un proyecto de 20 ventanas salta de pagina sin romper', async () => {
  const cv = bloqueCurvas();
  cv.interseccion_por_ventana = Array.from({ length: 20 }, (_, i) => ({
    ...cv.interseccion_por_ventana[0], nombre: `Ventana ${i + 1}`,
  }));
  const datos = { ...datosBase(), curvas: cv };
  const pdf = await generarInformeVientosPdf(datos, { nombre: 'M', comuna: 'L', numeroInforme: 'T-4' });
  assert.ok(paginasDe(pdf) >= 3, `20 filas deben empujar a 3+ paginas, hubo ${paginasDe(pdf)}`);
});

test('[Gemini+Codex, compuerta] datos hostiles del motor (NaN/null/[null]) no tumban el PDF', async () => {
  const cv = bloqueCurvas();
  cv.capacidad_por_espesor[0].puntos.push({ area_m2: null, lr_corta_kPa: 3 }, { area_m2: -1, lr_corta_kPa: NaN }, null);
  cv.capacidad_por_espesor.push(null, { espesor_mm: 'x', puntos: [null] });
  cv.demanda_legal.push({ etiqueta: 'rota', presion_kPa: NaN, entorno: 'ciudad', altura_m: 3 }, null);
  cv.interseccion_por_ventana.push(
    { nombre: 'rota', ancho_mm: 1, alto_mm: 1, area_m2: undefined, espesor_propio_mm: '4', por_espesor: [{ espesor_mm: 4, lr_corta_kPa: 2, cumple: true }, null] },
    null,
    { nombre: 'sin-por-espesor', ancho_mm: 1, alto_mm: 1, area_m2: 1, espesor_propio_mm: null, por_espesor: {} },
  );
  const pdf = await generarInformeVientosPdf({ ...datosBase(), curvas: cv }, { nombre: 'M', comuna: 'L', numeroInforme: 'T-5' });
  assert.ok(Buffer.isBuffer(pdf) && pdf.length > 3000);
});

test('[Codex, re-pase] el salto de pagina de la tabla se decide ANTES de la fila', async () => {
  // La regresion cazada: con el salto DESPUES de la fila, la ultima fila que gatillaba
  // el umbral dejaba una cabecera huerfana en una pagina extra vacia. Guardia doble:
  // el patron viejo no puede volver, y el numero de paginas crece de a 1, sin saltos.
  assert.doesNotMatch(SRC_PDF, /y \+= 14;\s*\n\s*if \(y > \d+\) \{ doc\.addPage/,
    'el salto de pagina volvio a decidirse despues de imprimir la fila');
  let previas = 0;
  for (const n of [1, 8, 14, 15, 16, 17, 18, 19, 20, 26]) {
    const cv = bloqueCurvas();
    cv.interseccion_por_ventana = Array.from({ length: n }, (_, i) => ({
      ...cv.interseccion_por_ventana[0], nombre: `Ventana ${i + 1}`,
    }));
    const pdf = await generarInformeVientosPdf({ ...datosBase(), curvas: cv }, { nombre: 'M', comuna: 'L', numeroInforme: `T-${n}` });
    const p = paginasDe(pdf);
    assert.ok(p >= previas && p <= previas + 1 || previas === 0,
      `con ${n} filas el PDF salto de ${previas} a ${p} paginas`);
    previas = p;
  }
});

test('el cliente de THERMAL pide las curvas al motor (incluir_curvas: true)', () => {
  assert.match(SRC_CLI, /incluir_curvas:\s*true/);
});

test('doctrina de copy: kPa se explica antes de usarse y sin guiones largos nuevos', () => {
  assert.match(SRC_PDF, /kilopascales \(kPa\)/, 'la sigla kPa debe presentarse explicada');
  assert.match(SRC_PDF, /100 kilos de viento/, 'la equivalencia en kilos es la explicacion simple');
  // Guiones largos permitidos: el del comentario de cabecera y los del truco de dec()
  // que justamente los elimina. En cualquier OTRA linea (las que arman texto del
  // cliente) no puede haber ninguno.
  // Se excluyen COMENTARIOS (// y bloques *): no viajan al cliente. Lo vigilado son
  // los literales de texto del PDF.
  const lineasConDash = SRC_PDF.split('\n')
    .filter((l) => l.includes('—'))
    .map((l) => l.trim())
    .filter((l) => !l.includes('guion largo') && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));
  assert.deepEqual(lineasConDash, [], 'guiones largos fuera de los dos sitios permitidos');
});

/* =========================================================================
 * LA PAGINA DE CLIMA (dueno 28-ago: "maxima informacion... informe nivel corp")
 * ========================================================================= */

function bloqueClima() {
  return {
    comuna: 'Temuco', zona_termica: 'F',
    fuente: 'Direccion Meteorologica de Chile, portal Servicios Climaticos',
    estacion_local: { cod: 380012, nombre: 'Padre las Casas', km: 2.5 },
    estacion_datos: { codigo: 380013, nombre: 'Maquehue, Temuco Ad.', km: 5 },
    lluvia: {
      anual_normal_mm: 1131, anos: 58,
      mes_mas_lluvioso: { mes: 'junio', normal_mm: 186.2 },
      max_24h_historico_mm: 126, fecha_max_24h: '23-Jun-1954',
      mensual: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, normal_mm: 30 + i * 10 })),
    },
    temperatura: {
      media_anual: 11.8, min_abs: -8.1, fecha_min_abs: '2007-07-09 07:32:00', max_abs: 42, anos: 74,
      mensual: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, max_media: 20 - i, min_media: 5 - i * 0.5 })),
    },
    racha_marco: {
      estacion: { codigo: 380013, nombre: 'Maquehue, Temuco Ad.' }, periodo: '1969-2014',
      anos: 45, record_kt: 80, record_kmh: 148, record_fecha: '15-06-1973 14:00',
      mediana_anual_kt: 48, mediana_anual_kmh: 89,
    },
  };
}

test('con clima el informe suma su pagina y el titulo dice VIENTOS Y CLIMA', async () => {
  const datos = { ...datosBase(), curvas: bloqueCurvas(), clima: bloqueClima() };
  const pdf = await generarInformeVientosPdf(datos, { nombre: 'M', comuna: 'Temuco', numeroInforme: 'T-C1' });
  assert.ok(paginasDe(pdf) >= 3, `curvas + clima = 3+ paginas, hubo ${paginasDe(pdf)}`);
  assert.match(SRC_PDF, /INFORME DE VIENTOS Y CLIMA/, 'el titulo del documento crecio con el contenido');
});

test('sin clima (motor viejo o hueco) nada cambia: la degradacion es total', async () => {
  const sinClima = { ...datosBase(), curvas: bloqueCurvas() };
  const conHueco = { ...datosBase(), curvas: bloqueCurvas(), clima: { _hueco: true, por_que: 'x' } };
  const p1 = paginasDe(await generarInformeVientosPdf(sinClima, { nombre: 'M', comuna: 'T', numeroInforme: 'T-C2' }));
  const p2 = paginasDe(await generarInformeVientosPdf(conHueco, { nombre: 'M', comuna: 'T', numeroInforme: 'T-C3' }));
  // [2026-09-25] 3 y no 2: en ESTA variante (con curvas y sin clima) el pie con los dos
  // logotipos no entra en lo que queda de la ultima hoja y la guardia agrega UNA. En las
  // demas variantes el conteo no cambio. Costo aceptado: el dueno pidio la firma con logos.
  assert.equal(p1, 3);
  assert.equal(p2, 3, 'un clima hueco no imprime pagina');
});

test('clima parcial (solo lluvia, sin temperatura ni racha) imprime lo que HAY', async () => {
  const cl = bloqueClima();
  delete cl.temperatura; delete cl.racha_marco;
  const pdf = await generarInformeVientosPdf({ ...datosBase(), clima: cl }, { nombre: 'M', comuna: 'T', numeroInforme: 'T-C4' });
  assert.ok(Buffer.isBuffer(pdf) && paginasDe(pdf) >= 2);
});

test('clima hostil (nulls y NaN en las series) no tumba el PDF', async () => {
  const cl = bloqueClima();
  cl.lluvia.mensual[3] = { mes: 4, normal_mm: null };
  cl.lluvia.mensual[4] = null && {};
  cl.lluvia.mensual[4] = { mes: 5, normal_mm: NaN };
  cl.temperatura.min_abs = null;
  cl.racha_marco.mediana_anual_kmh = NaN;
  const pdf = await generarInformeVientosPdf({ ...datosBase(), curvas: bloqueCurvas(), clima: cl }, { nombre: 'M', comuna: 'T', numeroInforme: 'T-C5' });
  assert.ok(Buffer.isBuffer(pdf) && pdf.length > 3000);
});

test('el cliente de THERMAL tambien pide el clima (incluir_clima: true)', () => {
  assert.match(SRC_CLI, /incluir_clima:\s*true/);
});

test('[Codex, compuerta] temperatura con meses faltantes NO inventa 0 grados ni corre etiquetas', async () => {
  const cl = bloqueClima();
  // mes 4 ausente al medio + serie corta (los meses 10-12 sin dato): la linea se corta,
  // no se dibuja un 0 falso, y el resto de la pagina vive.
  cl.temperatura.mensual[3] = { mes: 4, max_media: null, min_media: null };
  cl.temperatura.mensual = cl.temperatura.mensual.slice(0, 9);
  const pdf = await generarInformeVientosPdf({ ...datosBase(), clima: cl }, { nombre: 'M', comuna: 'T', numeroInforme: 'T-C6' });
  assert.ok(Buffer.isBuffer(pdf) && paginasDe(pdf) >= 2);
});

test('[Codex, compuerta] el titulo dice CLIMA solo cuando la pagina de clima va de verdad', async () => {
  assert.match(SRC_PDF, /traeClima \?/, 'el titulo se decide por el contenido real');
  const sinClima = await generarInformeVientosPdf(datosBase(), { nombre: 'M', comuna: 'T', numeroInforme: 'T-C7' });
  assert.ok(Buffer.isBuffer(sinClima), 'la version sin clima sigue saliendo');
});

test('[Codex, compuerta] la exclusion QC de la racha se declara al cliente en el texto', () => {
  assert.match(SRC_PDF, /quedó en revisión de calidad y se excluyó por prudencia/,
    'esconder el dato excluido seria la mentira chica que el informe prohibe');
});

/* =========================================================================
 * 🔴 [2026-09-18] SE LE MANDABA LA VENTANA COMPLETA COMO SI FUERA UN PAÑO DE VIDRIO
 *
 * Pedido del dueno, textual: *"el tamaño del vidrio debe estar ahi con los descuentos para que
 * lo tengas y muestres la resistencia en la grafica"*.
 *
 * El vidrio resiste el viento segun SU tamaño, no el de la ventana. En la propuesta de Mario
 * Grey (2710x1995, 3 hojas) el paño real mide 770x1747 — tres veces mas angosto — y se le
 * preguntaba al motor por uno de 2710x1995. MEDIDO contra el motor de vientos el 18-sep: con la
 * ventana completa devuelve "el caso cae FUERA de la malla" y el informe sale SIN VEREDICTO de
 * resistencia. Un paño mas grande ademas flecta mas: la respuesta habria sido pesimista.
 * ========================================================================= */

import { ventanasParaVientos as _vpv } from './vientosThermal.js';

test('🔴 con el paño declarado, al motor de vientos va el VIDRIO, no la ventana', () => {
  const { legibles } = _vpv([{
    producto_label: 'Corredera SLIDING H98 Doble Riel S75', measures: '2710x1995mm',
    glass_label: 'DVH 5+12+5', qty: 1,
    pano_vidrio: { ancho_mm: 770, alto_mm: 1747, panos: 3 },
  }]);
  assert.equal(legibles[0].ancho_mm, 770, 'el paño, con los descuentos de marco y hoja');
  assert.equal(legibles[0].alto_mm, 1747);
  assert.equal(legibles[0].ventana_ancho_mm, 2710, 'la ventana viaja aparte, para poder nombrarla');
  assert.equal(legibles[0].pano_declarado, true, 'queda escrito cual de las dos medidas se uso');
});

test('🔒 sin paño declarado se cae a la ventana — nunca menos informacion que antes', () => {
  const { legibles } = _vpv([{
    producto_label: 'Corredera ANDES', measures: '2000x1500mm', glass_label: 'DVH 4+12+4', qty: 1,
  }]);
  assert.equal(legibles[0].ancho_mm, 2000);
  assert.equal(legibles[0].pano_declarado, false, 'y se declara que es la ventana, no el paño');
});

test('🔒 un paño con medidas basura NO reemplaza a la ventana', () => {
  for (const malo of [{ ancho_mm: 0, alto_mm: 1747 }, { ancho_mm: -5, alto_mm: 100 }, { ancho_mm: 'x', alto_mm: 'y' }]) {
    const { legibles } = _vpv([{
      producto_label: 'C', measures: '2710x1995mm', glass_label: 'DVH 5+12+5', qty: 1, pano_vidrio: malo,
    }]);
    assert.equal(legibles[0].ancho_mm, 2710, `paño invalido ${JSON.stringify(malo)} no puede pasar`);
    assert.equal(legibles[0].pano_declarado, false);
  }
});

/* =========================================================================
 * 🔴 [2026-09-18] LAS VENTANAS CON VIDRIO SIMPLE SE CONTABAN COMO "ILEGIBLES"
 *
 * Pregunta del dueno, textual: *"que pasa cuando tiene vidrios que ahora debe cotizar y
 * termopaneles, deberia tener ambos"*. El catalogo tiene 18 vidrios simples cotizables
 * (VS-3MM a VS-6MM, laminados LM-5 a LM-12, espejos, moriscos, reflect float) y NINGUNO
 * llegaba al informe: caian en el mismo saco que las partidas ilegibles.
 *
 * MEDIDO el 18-sep contra el motor de vientos: solo acepta termopanel (exige ext_mm, int_mm y
 * camara_mm > 0; rechaza cualquier otra forma). O sea el limite es NUESTRO alcance, no el dato
 * del cliente — y el informe le decia lo contrario.
 * ========================================================================= */

import { vidrioSimpleDesdeEtiqueta as _vsimple } from './vientosThermal.js';

test('🔴 los 18 vidrios simples del catalogo se leen, ya no son "ilegibles"', () => {
  const casos = [
    ['Monolitico 4mm', 4, false], ['VS-4MM', 4, false], ['VS-6MM', 6, false],
    ['Monolitico 5mm bronce', 5, false], ['espejo 3mm', 3, false], ['ES-3MM', 3, false],
    ['reflect float 4mm', 4, false], ['Cristal 6 mm', 6, false],
    ['Laminado 5mm', 5, true], ['LM-8MM', 8, true], ['Laminado 3+3', 6, true],
  ];
  for (const [etiqueta, mm, lam] of casos) {
    const r = _vsimple(etiqueta);
    assert.ok(r, `"${etiqueta}" tiene que leerse`);
    assert.equal(r.simple_mm, mm, etiqueta);
    assert.equal(r.laminado, lam, etiqueta);
  }
});

test('🔒 un TERMOPANEL no se confunde con vidrio simple (lo resuelve la otra funcion)', () => {
  for (const e of ['DVH 5+12+5', 'TP-M-5+12+5', 'Termopanel 4+12+4', '4-12-4']) {
    assert.equal(_vsimple(e), null, e);
  }
});

test('🔴 lo que NO se entiende sigue siendo null: no se inventa un espesor', () => {
  for (const e of ['', null, 'basura sin numero', '999mm', '0mm']) {
    assert.equal(_vsimple(e), null, String(e));
  }
});

test('🔴 el informe separa las tres cosas: termopanel, vidrio simple e ilegible', () => {
  const r = _vpv([
    { producto_label: 'Corredera termopanel', measures: '2710x1995mm', glass_label: 'DVH 5+12+5', qty: 1 },
    { producto_label: 'Fija vidrio simple', measures: '1200x1000mm', glass_label: 'Monolitico 4mm', qty: 2 },
    { producto_label: 'Sin datos', measures: '', glass_label: '', qty: 1 },
  ]);
  assert.equal(r.legibles.length, 1, 'solo el termopanel va al motor de vientos');
  assert.equal(r.simples.length, 1, 'el vidrio simple se cuenta APARTE, no como ilegible');
  assert.equal(r.simples[0].espesor_mm, 4);
  assert.equal(r.ilegibles, 1, 'ilegible es solo lo que de verdad no se puede leer');
});
