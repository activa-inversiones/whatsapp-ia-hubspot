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
  assert.equal(paginasDe(pdf), 1);
});

test('un bloque de curvas HUECO (motor declaro que no pudo) tampoco rompe', async () => {
  const datos = { ...datosBase(), curvas: { _hueco: true, por_que: 'x' } };
  const pdf = await generarInformeVientosPdf(datos, { nombre: 'M', comuna: 'L', numeroInforme: 'T-3' });
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
  const lineasConDash = SRC_PDF.split('\n')
    .filter((l) => l.includes('—'))
    .filter((l) => !l.includes('guion largo') && !l.startsWith('//'));
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
  assert.equal(p1, 2);
  assert.equal(p2, 2, 'un clima hueco no imprime pagina');
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
