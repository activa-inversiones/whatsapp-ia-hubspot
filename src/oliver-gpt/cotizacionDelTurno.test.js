// cotizacionDelTurno.test.js
// CONTRACT TEST: el fixture NO se inventa, se copia de la forma REAL que devuelve
// `runTool` en tools.js:851. Ese fue justamente el defecto de webhook.test.js:238,
// que inventaba `{total:321593}` y por eso no cazó que amount_total salía NULL.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agregarCotizacionDelTurno,
  montoDeResultado,
  tieneMontoUtil,
  VERSION,
} from './cotizacionDelTurno.js';

/** Forma REAL de tools.js:851 (`case 'calcular_cotizacion'`). */
function resultadoRealDeLaTool({ unit_price = 321593, total_price = 321593, qty = 1 } = {}) {
  return {
    ok: true,
    unit_price,                       // NETO (sin IVA)
    total_neto: total_price,
    cantidad: qty,
    glass_label: 'DVH 4/12/4',
    producto_label: 'Corredera 2 hojas',
    serie: 'SLIDING_2H_1R',
    referencial: false,
    medidas_resueltas: '2000x2000mm',
    termico: null,
    _nota_precio: 'unit_price es NETO (sin IVA).',
  };
}

// ─── EL BUG ──────────────────────────────────────────────────────────────────

test('REGRESION: la forma real de la tool YA NO da monto nulo', () => {
  const dto = agregarCotizacionDelTurno([
    { name: 'calcular_cotizacion', result: resultadoRealDeLaTool() },
  ]);
  assert.notEqual(dto.amount_total, null, 'volvio a salir NULL: contrato roto de nuevo');
  assert.equal(dto.amount_total, 321593);
  assert.equal(tieneMontoUtil(dto), true);
});

test('REGRESION: el codigo viejo leia total/grand_total, que la tool NO manda', () => {
  const r = resultadoRealDeLaTool();
  assert.equal(r.total, undefined, 'la tool no manda `total`');
  assert.equal(r.grand_total, undefined, 'la tool no manda `grand_total`');
  assert.equal(montoDeResultado(r), 321593, 'pero el DTO igual encuentra el monto');
});

// ─── El segundo defecto: solo tomaba la primera ──────────────────────────────

test('suma TODAS las cotizaciones del turno, no solo la primera', () => {
  const dto = agregarCotizacionDelTurno([
    { name: 'calcular_cotizacion', result: resultadoRealDeLaTool({ total_price: 100000 }) },
    { name: 'calcular_cotizacion', result: resultadoRealDeLaTool({ total_price: 250000 }) },
    { name: 'calcular_por_area',   result: resultadoRealDeLaTool({ total_price: 50000 }) },
  ]);
  assert.equal(dto.amount_total, 400000);
  assert.equal(dto.items.length, 3);
  assert.equal(dto.parcial, false);
});

test('ignora tools que no son de precio', () => {
  const dto = agregarCotizacionDelTurno([
    { name: 'buscar_comuna', result: { ok: true, total_neto: 999999 } },
    { name: 'calcular_cotizacion', result: resultadoRealDeLaTool({ total_price: 7000 }) },
  ]);
  assert.equal(dto.amount_total, 7000);
  assert.equal(dto.items.length, 1);
});

test('ignora resultados con ok:false', () => {
  const dto = agregarCotizacionDelTurno([
    { name: 'calcular_cotizacion', result: { ok: false, error: 'fuera de catalogo' } },
    { name: 'calcular_cotizacion', result: resultadoRealDeLaTool({ total_price: 5000 }) },
  ]);
  assert.equal(dto.amount_total, 5000);
  assert.equal(dto.items.length, 1);
});

// ─── Bordes ──────────────────────────────────────────────────────────────────

test('turno sin cotizacion devuelve null (distinto de cotizar $0)', () => {
  assert.equal(agregarCotizacionDelTurno([]), null);
  assert.equal(agregarCotizacionDelTurno([{ name: 'buscar_comuna', result: { ok: true } }]), null);
  assert.equal(agregarCotizacionDelTurno(null), null);
  assert.equal(agregarCotizacionDelTurno(undefined), null);
});

test('marca parcial cuando un item no trae monto', () => {
  const dto = agregarCotizacionDelTurno([
    { name: 'calcular_cotizacion', result: resultadoRealDeLaTool({ total_price: 8000 }) },
    { name: 'calcular_cotizacion', result: { ok: true, producto_label: 'sin precio' } },
  ]);
  assert.equal(dto.amount_total, 8000);
  assert.equal(dto.sin_monto, 1);
  assert.equal(dto.parcial, true, 'hay que poder avisar que el monto quedo incompleto');
});

test('si NINGUN item trae monto, amount_total es null y no se persiste', () => {
  const dto = agregarCotizacionDelTurno([
    { name: 'calcular_cotizacion', result: { ok: true, producto_label: 'x' } },
  ]);
  assert.equal(dto.amount_total, null);
  assert.equal(tieneMontoUtil(dto), false);
});

test('NO suma unit_price cuando ya hay total (evita subcotizar/duplicar)', () => {
  const r = resultadoRealDeLaTool({ unit_price: 100, total_price: 300, qty: 3 });
  assert.equal(montoDeResultado(r), 300, 'debe usar el total, no el unitario');
});

test('ultimo recurso: unitario x cantidad cuando no hay ningun total', () => {
  assert.equal(montoDeResultado({ ok: true, unit_price: 1000, cantidad: 4 }), 4000);
  assert.equal(montoDeResultado({ ok: true, unit_price: 1000 }), 1000);
});

test('tolera montos no numericos sin romper', () => {
  assert.equal(montoDeResultado({ total_neto: 'abc' }), null);
  assert.equal(montoDeResultado({ total_neto: 0 }), null, '0 no es un monto util');
  assert.equal(montoDeResultado({ total_neto: -5 }), null);
  assert.equal(montoDeResultado(null), null);
});

test('expone VERSION', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});
