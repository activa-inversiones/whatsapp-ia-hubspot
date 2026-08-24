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
