// informeTermicoPdf.laminas.test.js — [2026-08-24]
//
// Prueba de COMPORTAMIENTO (no de fuente): se genera el PDF de verdad y se cuentan las
// imágenes que quedaron dentro. Nació del P0 que encontró Gemini en la compuerta cruzada.
//
// EL DEFECTO. El bloque de figuras se dibujaba con `if (figuras.length)`, pero la
// advertencia —la que dice QUÉ perfil se está mostrando y que los valores salen del
// cálculo y no de la figura— colgaba de un `if (laminas?.nombre)` aparte. Si THERMAL
// devolvía un perfil con los nombres vacíos, las isotermas se imprimían SIN ROTULAR
// dentro de un informe firmado por un evaluador acreditado MINVU. Un cliente que ve tres
// cortes térmicos a color sin una línea que los relativice asume que le simularon SU
// ventana. Eso es exactamente lo que la regla anti-alucinación prohíbe.
//
// Verificado matando el mutante.

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { generarInformeTermicoPdf } from './informeTermicoPdf.js';

/** Un PNG 1x1 REAL (pdfkit lo tiene que poder decodificar, no alcanza la cabecera). */
function pngReal() {
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
    return (~c) >>> 0;
  };
  const chunk = (tipo, datos) => {
    const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(cuerpo));
    return Buffer.concat([largo, cuerpo, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8 bits, RGB
  const idat = zlib.deflateSync(Buffer.from([0x00, 0xFF, 0x00, 0x00]));  // 1 fila, 1 px rojo
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const DATOS = {
  comuna: 'Temuco', regimen: 'PDA', uw_max_Wm2K: 3.2,
  zona_termica_NCh1079: 'F',
  criterio_ref: 'PDA Temuco-Padre Las Casas art. 27',
};

const conLaminas = (nombre) => ({
  perfil: nombre ? 'S60_proyectante' : '',
  nombre,
  aprobadoPor: 'Marcelo Cifuentes',
  fecha: '2026-08-19',
  laminas: [{ id: '10', png: pngReal() }, { id: '01', png: pngReal() }],
});

const contarImagenes = (pdf) => (pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;

test('con perfil rotulado, las isotermas SÍ entran al PDF', async () => {
  const pdf = await generarInformeTermicoPdf(DATOS, { laminas: conLaminas('S60 proyectante WinHouse') });
  assert.ok(pdf && pdf.length > 0);
  assert.equal(contarImagenes(pdf), 2);
});

test('🔴 [P0 · Gemini] SIN nombre de perfil NO se dibuja ninguna figura', async () => {
  // Preferimos un informe sin figuras a un informe con figuras que el cliente pueda tomar
  // por la simulación de su ventana. Si no podemos decir QUÉ estamos mostrando, no se muestra.
  const pdf = await generarInformeTermicoPdf(DATOS, { laminas: conLaminas('') });
  assert.ok(pdf && pdf.length > 0, 'el informe sale igual, solo que sin las figuras');
  assert.equal(contarImagenes(pdf), 0, 'una figura sin rótulo en un informe firmado no puede salir');
});

test('sin láminas el informe se genera normal', async () => {
  const pdf = await generarInformeTermicoPdf(DATOS, {});
  assert.ok(pdf && pdf.length > 0);
  assert.equal(contarImagenes(pdf), 0);
});

test('una lámina sin png se ignora sin romper el resto', async () => {
  const l = conLaminas('S60 proyectante WinHouse');
  l.laminas.push({ id: '02', png: null });
  const pdf = await generarInformeTermicoPdf(DATOS, { laminas: l });
  assert.equal(contarImagenes(pdf), 2, 'las dos buenas entran, la vacía se descarta');
});

test('🔒 un PNG corrupto NO tumba la generación del informe', async () => {
  // pdfkit lanza si no puede decodificar. El informe es lo que el cliente recibe; una
  // figura es un adorno. Un adorno no puede costar el documento.
  const l = conLaminas('S60 proyectante WinHouse');
  l.laminas[0].png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(40)]);
  const pdf = await generarInformeTermicoPdf(DATOS, { laminas: l });
  assert.ok(pdf && pdf.length > 0, 'el PDF sale igual');
  assert.equal(contarImagenes(pdf), 1, 'la sana entra, la corrupta se saltea');
});

// ── Lo que trajo Codex en la compuerta (24-ago), todo MEDIDO ─────────────────────────

test('🔴 [P1 · Codex] un PNG de muchos megapixeles NO se dibuja — puede matar el proceso', async () => {
  // MEDIDO, no teorico: un PNG uniforme 3000x3000 RGBA ocupa 34 KB en disco y hace subir el
  // RSS 129 MB al generar el PDF. Uno de 10000x10000 entra comodo bajo cualquier techo de
  // BYTES y se come ~1,4 GB. Eso no deja al cliente sin informe: mata el proceso del bot y
  // se cae la atencion de TODOS los clientes por culpa de un adorno.
  // (pdfkit incrusta un PNG RGB sin decodificar; un RGBA lo TIENE que decodificar para
  //  separar el alfa. Las laminas de THERMAL son RGBA, o sea caen del lado caro.)
  const enorme = Buffer.from(pngReal());
  enorme.writeUInt32BE(4000, 16);      // 4000 x 4000 = 16 MPx, sobre el tope de 8
  enorme.writeUInt32BE(4000, 20);
  const l = conLaminas('S60 proyectante WinHouse');
  l.laminas = [{ id: '10', png: enorme }, { id: '01', png: pngReal() }];
  const pdf = await generarInformeTermicoPdf(DATOS, { laminas: l });
  assert.equal(contarImagenes(pdf), 1, 'la enorme se saltea, la sana entra');
});

test('🔴 [P1 · Codex] espacios en blanco NO alcanzan como rotulo', async () => {
  // Antes `'   '` pasaba el truthy y salia "Corte del sistema   ": un rotulo vacio es lo
  // mismo que no tener rotulo, y las figuras quedaban sin identificar en un documento
  // firmado. Con AMBOS campos en blanco no hay identidad de ningun tipo ⇒ no se dibuja.
  const l = conLaminas('   ');
  l.perfil = '   ';
  const pdf = await generarInformeTermicoPdf(DATOS, { laminas: l });
  assert.equal(contarImagenes(pdf), 0, 'sin identidad fiable, no salen figuras');
});

test('cae al id del perfil si falta el nombre comercial', async () => {
  const l = conLaminas('');
  l.perfil = 'S60_proyectante';
  const pdf = await generarInformeTermicoPdf(DATOS, { laminas: l });
  assert.equal(contarImagenes(pdf), 2, 'con identidad, aunque sea el id tecnico, si se dibujan');
});

test('🔒 [P2 · Codex] un nombre absurdamente largo no descuadra la pagina', async () => {
  // Los campos vienen de una API ajena. Un `nombre` de 1000 caracteres empujaba el rotulo
  // varias lineas mientras la imagen se dibujaba a una altura fija: se superponian.
  const l = conLaminas('X'.repeat(1000));
  const pdf = await generarInformeTermicoPdf(DATOS, { laminas: l });
  assert.ok(pdf && pdf.length > 0);
  assert.equal(contarImagenes(pdf), 2, 'el informe sale igual, con el nombre acotado');
});

test('🔴 el pie de la lamina 10 NO puede prometer que no condensa', async () => {
  // La lamina del termopanel del propio ACTIVA reporta, para Temuco a 65 % de HR:
  //   borde aluminio 9,2 C -> CONDENSA · borde warm-edge 11,8 C -> CONDENSA
  //   (umbral que devuelve la API para Temuco: 12,28 C)
  // O sea el borde condensa con LOS DOS separadores. Un texto que insinue lo contrario
  // contradice al motor de la empresa en un documento que ella misma firma.
  // Se junta el texto REAL que ve el cliente: el pie está partido en varios literales
  // concatenados, así que comparar sobre la fuente cruda da falsos negativos.
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('./informeTermicoPdf.js', import.meta.url), 'utf8');
  const i = src.indexOf("'10':");
  const crudo = src.slice(i, src.indexOf('});', i));
  const pie = [...crudo.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]).join('');

  assert.doesNotMatch(pie, /no se empa|nunca condensa|evita la condensaci|sin condensaci/i,
    'no se puede prometer ausencia de condensacion');
  assert.match(pie, /puede alcanzar igual la temperatura de condensaci/i,
    'tiene que decir que el borde puede condensar con los dos separadores');
  assert.match(pie, /con uno u otro separador/i, 'y que aplica a AMBOS, no solo al aluminio');
  assert.match(pie, /secci[óo]n de condensaci[óo]n/i, 'y remitir al dato calculado');
});

test('🔒 los numeros de la figura NO se transcriben al PDF', async () => {
  // Leer un valor de una imagen y ponerlo en un documento firmado es exactamente lo que el
  // contrato con THERMAL prohibe: las laminas viajan con X-No-Declarable.
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('./informeTermicoPdf.js', import.meta.url), 'utf8');
  const i = src.indexOf("const PIES_LAMINA");
  const bloque = src.slice(i, src.indexOf('});', i));
  const pies = bloque.split(String.fromCharCode(10)).filter((l) => !l.trim().startsWith('//')).join(' ');
  for (const n of ['9,2', '11,8', '13,3', '12,28']) {
    assert.ok(!pies.includes(n), `el valor ${n} sale de leer la figura y no puede ir al PDF`);
  }
});

test('🔒 [#392] el aviso legal lleva la razon social Y el RUT verificados del dueno', async () => {
  // Los dio el dueno el 24-ago: "Activa Inversiones EIRL, RUT 76.486.825-0". El DV se
  // comprobo por modulo 11 antes de escribirlo (suma 187 -> DV 0 ✓): un digito verificador
  // equivocado dentro del parrafo que pretende tener valor juridico es peor que no ponerlo.
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('./informeTermicoPdf.js', import.meta.url), 'utf8');
  assert.ok(src.includes("EMISOR_RAZON_SOCIAL || 'Activa Inversiones EIRL'"), 'razon social exacta');
  assert.ok(src.includes("EMISOR_RUT || '76.486.825-0'"), 'RUT exacto');
  assert.ok(src.includes('RUT ${rutEmisor}'), 'y aparece en el texto legal');
});
