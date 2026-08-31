// informePdf.cliente.test.js — [2026-08-30]
//
// A NOMBRE DE QUIÉN SALE EL DOCUMENTO. Defiende el bloque que el dueño pidió el 30-ago para
// los DOS informes (térmico y vientos/clima), a partir del caso real de Alfredo Arias Luengo
// (conv 56952077379, cuatro reclamos por lo mismo).
//
// Se prueba sobre el PDF RENDERIZADO, no sobre funciones puras: la lección del 24-ago en este
// mismo repo fue que 25 tests puros seguían verdes mientras el cliente recibía un documento
// sin sus ventanas. Acá se lee el texto del PDF y, además, LA POSICIÓN de cada línea del
// encabezado — porque el defecto que se está evitando es geométrico (textos encimados), y eso
// no se ve leyendo strings.

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { generarInformeTermicoPdf } from './informeTermicoPdf.js';
import { generarInformeVientosPdf } from './informeVientosPdf.js';

const DATOS_T = {
  comuna: 'Temuco', regimen: 'PDA', uw_max_Wm2K: 3.2, zona_termica_NCh1079: 'F', criterio_ref: 'PDA Temuco art. 27',
  condensacion: { clima: { theta_e_C: 4.2, phi_e: 0.86 }, f_rsi_minimo: { '0.65': { theta_si_min_C: 9.1 }, '0.75': { theta_si_min_C: 11.3 } } },
};
const DATOS_V = {
  ventanas: [{
    nombre: 'Proyectante S60', ancho_mm: 1000, alto_mm: 1200, vidrio: 'DVH 4/12/4 recocido', cantidad: 2,
    capacidad: { lr_corta_kPa: 4.05, lr_larga_kPa: 1.76, nfl_kPa: 2.25 },
    veredicto: { evaluable: true, cumple_corta: true }, flechas: { referencia: { flecha_maxima_mm: 4.6 } },
  }],
  demanda: { presion_kPa: 0.694, q_basica_kg_m2: 59.0, factor_forma_C: 1.2 },
};

/** Los dos informes, con las mismas opciones de cliente: lo que vale para uno vale para el otro. */
async function ambos(opts) {
  return {
    termico: await generarInformeTermicoPdf(DATOS_T, { ...opts, numeroInforme: 'CM-FR-2026-0042' }),
    vientos: await generarInformeVientosPdf(DATOS_V, { ...opts, comuna: 'Loncoche', numeroInforme: 'INF-V-2026-0007' }),
  };
}

/** Descomprime los streams del PDF cortando por /Length (ver informeTermicoPdf.render.test.js). */
function streamsDelPdf(pdf) {
  const buf = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
  const crudo = buf.toString('latin1');
  const re = /\/Length\s+(\d+)[^>]*>>\s*stream\r?\n/g;
  const salida = [];
  let m;
  while ((m = re.exec(crudo)) !== null) {
    const ini = m.index + m[0].length;
    try { salida.push(zlib.inflateSync(buf.subarray(ini, ini + Number(m[1]))).toString('latin1')); }
    catch { /* fuentes e imagenes no son texto comprimido */ }
  }
  return salida;
}

function textoDelPdf(pdf) {
  const s = streamsDelPdf(pdf).join('');
  const hex = (s.match(/<([0-9A-Fa-f]+)>/g) || []).map((t) => Buffer.from(t.slice(1, -1), 'hex').toString('latin1'));
  const lit = (s.match(/\(((?:\\.|[^()\\])*)\)/g) || []).map((t) => t.slice(1, -1).replace(/\\([()\\])/g, '$1'));
  return [...hex, ...lit].join('');
}

/**
 * Cada texto de la PRIMERA página con su posición real: { x, yBase, size, txt }.
 * pdfkit escribe `1 0 0 1 x y Tm` dentro de un `cm` volteado, así que la `y` de página es
 * 841.89 - y, y corresponde a la LÍNEA BASE del texto.
 */
function lineasConPosicion(pdf) {
  const stream = streamsDelPdf(pdf).find((s) => s.includes(' Tm')) || '';
  const out = [];
  let size = 0;
  let x = 0;
  let yBase = 0;
  for (const linea of stream.split('\n')) {
    const f = linea.match(/\/F\d+\s+([\d.]+)\s+Tf/);
    if (f) size = Number(f[1]);
    const tm = linea.match(/^1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/);
    if (tm) { x = Number(tm[1]); yBase = 841.89 - Number(tm[2]); }
    if (/(TJ|Tj)\s*$/.test(linea)) {
      const hex = (linea.match(/<([0-9A-Fa-f]+)>/g) || []).map((t) => Buffer.from(t.slice(1, -1), 'hex').toString('latin1')).join('');
      const lit = (linea.match(/\(((?:\\.|[^()\\])*)\)/g) || []).map((t) => t.slice(1, -1)).join('');
      const txt = (hex + lit).trim();
      if (txt) out.push({ x, yBase, size, txt });
    }
  }
  return out;
}

const paginas = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

// Caso real que originó el pedido. El RUT es el que ya está en pdf-intent.test.js:58.
const ALFREDO = { nombre: 'Alfredo Arias Luengo', rut: '10.047.794-7' };

test('PERSONA: el nombre y su RUT validado salen en los DOS informes', async () => {
  const pdfs = await ambos(ALFREDO);
  for (const [cual, pdf] of Object.entries(pdfs)) {
    const txt = textoDelPdf(pdf);
    assert.ok(txt.includes('PREPARADO PARA'), `${cual}: falta el rótulo del bloque`);
    assert.ok(txt.includes('Alfredo Arias Luengo'), `${cual}: falta el nombre`);
    assert.ok(txt.includes('RUT 10.047.794-7'), `${cual}: falta el RUT del cliente`);
    // Y el párrafo legal, que es el que pretende tener valor jurídico, nombra al mismo.
    assert.ok(txt.replace(/\s+/g, '').includes('AlfredoAriasLuengo,RUT10.047.794-7'),
      `${cual}: el aviso legal no identifica al destinatario con su RUT`);
  }
});

test('EMPRESA: manda la razón social, y la persona que la pidió queda como contacto', async () => {
  // Las dos formas que el dueño describió: "rut empresa con nombre de rut empresa o nombre
  // de la persona que la pide". Acá vienen las dos y no se pierde ninguna.
  const pdfs = await ambos({
    nombre: 'Alfredo Arias Luengo', razonSocial: 'Constructora Los Robles SpA',
    rut: '77.123.456-9', clienteTipo: 'empresa',
  });
  for (const [cual, pdf] of Object.entries(pdfs)) {
    const txt = textoDelPdf(pdf);
    assert.ok(txt.includes('Constructora Los Robles SpA'), `${cual}: falta la razón social`);
    assert.ok(txt.includes('RUT 77.123.456-9'), `${cual}: falta el RUT de la empresa`);
    assert.ok(txt.includes('Contacto: Alfredo Arias Luengo'), `${cual}: se perdió quién la pidió`);
    assert.ok(txt.replace(/\s+/g, '').includes('ConstructoraLosRoblesSpA,RUT77.123.456-9'),
      `${cual}: el aviso legal debe obligar a la empresa, que es la titular`);
  }
});

test('🔴 UN RUT QUE NO PASA MÓDULO 11 NO SE IMPRIME EN NINGUNA PARTE', async () => {
  // La regla dura de todo este cambio. Un RUT mal escrito en un documento formal es peor que
  // no ponerlo: el cliente lo lleva a facturar y no le cuadra.
  const pdfs = await ambos({ nombre: 'Alfredo Arias Luengo', rut: '10.047.794-9' });   // DV cambiado
  for (const [cual, pdf] of Object.entries(pdfs)) {
    const txt = textoDelPdf(pdf);
    assert.ok(txt.includes('Alfredo Arias Luengo'), `${cual}: el nombre sí debe salir igual`);
    assert.ok(!txt.includes('10.047.794-9'), `${cual}: imprimió un RUT inválido`);
    assert.ok(!txt.includes('10.047.794'), `${cual}: imprimió el cuerpo del RUT inválido`);
    // El RUT del EMISOR no se toca: ése está verificado y documentado.
    assert.ok(txt.includes('76.486.825-0'), `${cual}: se perdió el RUT del emisor`);
  }
});

test('🔴 SIN DATO el informe sale como salía siempre: sin bloque, sin huecos, sin undefined', async () => {
  // Hoy es el caso más frecuente: webhook.js cae a 'Cliente' cuando la conversación todavía
  // no dijo un nombre. Un documento formal que declara en negrita "Cliente" se ve roto.
  for (const opts of [{}, { nombre: '' }, { nombre: 'Cliente' }, { nombre: 'Cliente', rut: 'no tengo' }]) {
    const pdfs = await ambos(opts);
    for (const [cual, pdf] of Object.entries(pdfs)) {
      const txt = textoDelPdf(pdf);
      assert.ok(!txt.includes('PREPARADO PARA'), `${cual}: abrió bloque sin datos (${JSON.stringify(opts)})`);
      assert.ok(!/undefined|NaN/.test(txt), `${cual}: dejó undefined/NaN (${JSON.stringify(opts)})`);
      // Y el nombre, si lo hay, sigue colgado de la línea "Emitido" tal como antes del cambio.
      if (opts.nombre) assert.ok(txt.includes('Preparado para: Cliente'), `${cual}: se perdió la línea de siempre`);
    }
  }
});

test('🔴 el bloque NO empuja el cuerpo: el informe de vientos corto sigue siendo de UNA página', async () => {
  // Medido durante este cambio: metido debajo de la línea "Emitido", el bloque bajaba 22 px
  // todo el documento y este informe se pasaba a dos páginas. Por eso vive a la derecha del
  // título, en coordenadas absolutas, sin correr nada.
  // ⚠️ Alcance real de este test, comprobado con un mutante: NO se cae si alguien solo mueve
  // el bloque de lugar (al no haber reflujo, la página no cambia); se cae si alguien lo vuelve
  // a meter en el flujo del documento, que es el error caro. Que el bloque no invada nada lo
  // defiende el test de GEOMETRÍA de más abajo, que sí se puso rojo con ese mutante.
  for (const opts of [{}, ALFREDO, { razonSocial: 'Constructora Los Robles SpA', rut: '77.123.456-9', clienteTipo: 'empresa' }]) {
    const pdf = await generarInformeVientosPdf(DATOS_V, { ...opts, comuna: 'Loncoche', numeroInforme: 'INF-V-2026-0007' });
    assert.equal(paginas(pdf), 1, `el informe corto debe caber en 1 página (${JSON.stringify(opts)})`);
  }
});

test('🔴 GEOMETRÍA: el bloque vive en su franja y no se cruza con nada de la izquierda', async () => {
  // El peor caso posible junto: título largo, razón social de dos líneas, RUT, contacto, y el
  // folio de 40 caracteres que el código admite.
  const peor = {
    nombre: 'Maria Jose Fernandez Valdivieso',
    razonSocial: 'Servicio Agricola y Construccion Limitada del Sur',
    rut: '77.123.456-9', clienteTipo: 'empresa',
    numeroInforme: 'X'.repeat(40),
  };
  const pdfs = {
    termico: await generarInformeTermicoPdf(DATOS_T, { ...peor, esReferenciaRegional: true }),
    vientos: await generarInformeVientosPdf(DATOS_V, { ...peor, comuna: 'San Jose de la Mariquina' }),
  };
  for (const [cual, pdf] of Object.entries(pdfs)) {
    const lineas = lineasConPosicion(pdf);
    const bloque = lineas.filter((l) => l.x > 300 && l.yBase > 100 && l.yBase < 200);
    assert.ok(bloque.length >= 3, `${cual}: no se encontró el bloque a la derecha`);
    for (const l of bloque) {
      assert.ok(l.x >= 360, `${cual}: "${l.txt}" invade la columna del título (x=${l.x})`);
      assert.ok(l.yBase <= 161, `${cual}: "${l.txt}" baja hasta la línea Emitido (y=${l.yBase})`);
    }
    // Y la caja de alcance, que empieza en 178, sigue teniendo su texto donde siempre.
    const alcance = lineas.find((l) => l.txt.startsWith('Este documento informa'));
    assert.ok(alcance && alcance.yBase > 185 && alcance.yBase < 195,
      `${cual}: se movió la caja de alcance (y=${alcance && alcance.yBase})`);
  }
});

test('lo que la fuente del PDF no puede dibujar no llega al documento (emojis del perfil de WhatsApp)', async () => {
  // Los nombres vienen del push_name de WhatsApp. Un carácter que Helvetica no puede dibujar
  // dentro del documento "genera desconfianza" (lección del dueño, 24-ago).
  const pdfs = await ambos({ nombre: 'Ale 🏠🔥 Muñoz', rut: '100477947' });
  for (const [cual, pdf] of Object.entries(pdfs)) {
    const txt = textoDelPdf(pdf);
    assert.ok(txt.includes('Ale Muñoz'), `${cual}: se rompió el nombre al limpiarlo`);
    assert.ok(txt.includes('RUT 10.047.794-7'), `${cual}: el RUT sin puntos debe salir formateado`);
  }
});
