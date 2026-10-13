// [#1513 B · 13-oct] Guardia de la DECISIÓN del dueño: ver los dibujos del borrador ANTES de liberar,
// sin folio, sin enviar, con marca «BORRADOR». Si alguien hace que esta ruta emita o escriba, estos tests lo cazan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfDibujosBorrador, registrarRutaDibujos, RUTA_DIBUJOS, TOPE_LINEAS } from './oliverInternoDibujos.js';

const linea = (n, tipo, medidas, extra = {}) => ({
  n, herramienta: 'calcular_cotizacion',
  pedido: { tipo, cantidad: 1, color: 'NOGAL' },
  resultado: { ok: true, unit_price: 350000, cantidad: 1, producto_label: tipo, medidas_resueltas: medidas, glass_label: 'Termopanel 4+12+4', ...extra },
});

test('arma un PDF con una fila por ventana, sin tocar red ni sesión', async () => {
  const out = await pdfDibujosBorrador({
    lineas: [linea(1, 'Fijo S60', '1200x800mm'), linea(2, 'Corredera SLIDING Doble Riel', '1500x1500mm'), linea(3, 'Proyectante S60', '500x500mm')],
    color: 'NOGAL', nombre: 'Alexis Andrés',
  });
  assert.equal(out.ok, true);
  assert.equal(out.ventanas, 3);
  assert.ok(Buffer.isBuffer(out.pdf));
  assert.equal(out.pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(out.pdf.length > 5000, 'un PDF con tres dibujos no es un archivo vacío');
});

test('sin líneas cotizadas (resultado no ok o sin precio) no hay PDF: se dice por qué', async () => {
  const sinPrecio = linea(1, 'Fijo S60', '1200x800mm', { unit_price: 0 });
  const fallida = { n: 2, herramienta: 'calcular_cotizacion', pedido: {}, resultado: { ok: false } };
  assert.deepEqual(await pdfDibujosBorrador({ lineas: [sinPrecio, fallida] }), { ok: false, error: 'sin_lineas_cotizadas' });
  assert.deepEqual(await pdfDibujosBorrador({ lineas: [] }), { ok: false, error: 'sin_lineas_cotizadas' });
});

test('tope de líneas: más de TOPE_LINEAS se rechaza antes de dibujar', async () => {
  const muchas = Array.from({ length: TOPE_LINEAS + 1 }, (_, i) => linea(i + 1, 'Fijo S60', '1000x1000mm'));
  const out = await pdfDibujosBorrador({ lineas: muchas });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'demasiadas_lineas');
});

// ── Ruta: 401 sin token, 400 sin líneas, 200 application/pdf con líneas; nunca llama a nada más.
function appFalsa() {
  const rutas = {};
  return { rutas, post: (ruta, ...fns) => { rutas[ruta] = fns[fns.length - 1]; } };
}
function resFalsa() {
  const r = { code: 200, headers: {}, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  return r;
}

test('ruta: exige el token interno, exige líneas, y devuelve el PDF inline con Cache-Control no-store', async () => {
  const app = appFalsa();
  const llamadas = [];
  registrarRutaDibujos(app, {
    validInternalOperatorToken: (req) => req.headers['x-api-key'] === 'ok',
    generar: async (args) => { llamadas.push(args); return { ok: true, pdf: Buffer.from('%PDF-falso'), ventanas: 2 }; },
  });
  const h = app.rutas[RUTA_DIBUJOS];
  assert.ok(h, 'la ruta se registra en ' + RUTA_DIBUJOS);

  let res = resFalsa();
  await h({ headers: { 'x-api-key': 'no' }, body: { lineas: [{}] } }, res);
  assert.equal(res.code, 401);
  assert.equal(llamadas.length, 0);

  res = resFalsa();
  await h({ headers: { 'x-api-key': 'ok' }, body: {} }, res);
  assert.equal(res.code, 400);
  assert.equal(res.body.error, 'lineas_requeridas');

  res = resFalsa();
  await h({ headers: { 'x-api-key': 'ok' }, body: { lineas: [{ n: 1 }, { n: 2 }], color: 'NOGAL', nombre: 'X'.repeat(200) } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.match(res.headers['content-disposition'], /^inline;/);
  assert.equal(res.headers['x-ventanas'], '2');
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].color, 'NOGAL');
  assert.equal(llamadas[0].nombre.length, 80, 'los campos de texto se acotan a 80');
});

test('ruta: si el generador no produce PDF, 400 con el motivo (no 500, no PDF vacío)', async () => {
  const app = appFalsa();
  registerRutaOk(app, async () => ({ ok: false, error: 'sin_lineas_cotizadas' }));
  const res = resFalsa();
  await app.rutas[RUTA_DIBUJOS]({ headers: { 'x-api-key': 'ok' }, body: { lineas: [{ n: 1 }] } }, res);
  assert.equal(res.code, 400);
  assert.equal(res.body.error, 'sin_lineas_cotizadas');
});

function registerRutaOk(app, generar) {
  registrarRutaDibujos(app, { validInternalOperatorToken: (req) => req.headers['x-api-key'] === 'ok', generar });
}
