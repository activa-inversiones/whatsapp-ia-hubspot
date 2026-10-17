// Guardias de la decision del dueno (17-oct): los informes se piden a THERMAL; el local es respaldo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serializarBinarios, pedirPdfAThermal, _paraTests } from './informesThermal.js';

const PDF = Buffer.from('%PDF-1.3 fake');
const resp = (status, body = PDF) => ({ status, ok: status >= 200 && status < 300, arrayBuffer: async () => body });

test('🔴 con THERMAL arriba, el PDF que sale es el de THERMAL (no el local)', async () => {
  let localUsado = false;
  const local = async () => { localUsado = true; return Buffer.from('%PDF local'); };
  const out = await _paraTests.conRespaldo('termico', local, { a: 1 }, {}, { fetchImpl: async () => resp(200) });
  assert.equal(out.toString(), PDF.toString());
  assert.equal(localUsado, false);
});

test('🔴 THERMAL 422 (sin datos duros) = null, igual que el generador local: no se fabrica un informe', async () => {
  const out = await _paraTests.conRespaldo('vientos', async () => Buffer.from('%PDF x'), {}, {}, { fetchImpl: async () => resp(422) });
  assert.equal(out, null);
});

test('🔴 THERMAL caido / 5xx / respuesta que no es PDF: sale el respaldo LOCAL (el cliente no se queda sin informe)', async () => {
  for (const fetchImpl of [async () => { throw new Error('ECONNREFUSED'); }, async () => resp(503), async () => resp(200, Buffer.from('<html>'))]) {
    const out = await _paraTests.conRespaldo('termico', async () => Buffer.from('%PDF local'), {}, { numeroInforme: 'F-1' }, { fetchImpl });
    assert.equal(out.toString(), '%PDF local');
  }
});

test('INFORMES_DESDE_THERMAL=0 vuelve 100% al local sin llamar a THERMAL', async () => {
  process.env.INFORMES_DESDE_THERMAL = '0';
  try {
    let llamado = false;
    const out = await _paraTests.conRespaldo('termico', async () => Buffer.from('%PDF local'), {}, {},
      { fetchImpl: async () => { llamado = true; return resp(200); } });
    assert.equal(out.toString(), '%PDF local');
    assert.equal(llamado, false);
  } finally { delete process.env.INFORMES_DESDE_THERMAL; }
});

test('🔒 las laminas PNG viajan como {__b64__} y vuelven byte a byte', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const s = serializarBinarios({ laminas: [{ png, nombre: 'x' }], termopanel: { lamina: { png } } });
  assert.deepEqual(Buffer.from(s.laminas[0].png.__b64__, 'base64'), png);
  assert.equal(s.laminas[0].nombre, 'x');
  assert.deepEqual(Buffer.from(s.termopanel.lamina.png.__b64__, 'base64'), png);
});

test('el pedido va a la ruta de THERMAL con la key, y el cuerpo lleva datos+opciones', async () => {
  process.env.THERMAL_API_KEY = 'k-test';
  try {
    let visto;
    await pedirPdfAThermal('vientos', { v: 1 }, { numeroInforme: 'F-2' }, {
      fetchImpl: async (url, init) => { visto = { url, init }; return resp(200); },
    });
    assert.match(visto.url, /\/api\/v1\/informes\/vientos\.pdf$/);
    assert.equal(visto.init.headers['X-API-Key'], 'k-test');
    assert.deepEqual(JSON.parse(visto.init.body), { datos: { v: 1 }, opciones: { numeroInforme: 'F-2' } });
  } finally { delete process.env.THERMAL_API_KEY; }
});
