// informeLetra.correlativo.test.js
// Los nombres de archivo de estos tests son REALES: salen del WorkDrive del dueño
// (ISO ACTIVA / ISO REGISTROS / COTIZACIONES (CM-FR-004)), medidos el 15-sep-2026.
// Series confirmadas por el dueño: CM-FR-004 Propuesta Técnico Económica ·
// CM-FR-006 Informe Térmico · CM-FR-007 Informe de Vientos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nombreConLetra, conCorrelativoUnaVez } from './informeLetra.js';

test('REAL: el correlativo NO se duplica (bug del Drive, 15-sep)', () => {
  // Lo que produce hoy nombreConLetra:
  const nombre = nombreConLetra('Informe-Termico-Temuco.pdf', 0, 'CM-FR-006-2026-0169');
  assert.equal(nombre, 'Informe-Termico-Temuco-A-CM-FR-006-2026-0169.pdf');

  // Y lo que hacían webhook.js:1956 y :3381 encima. Ahora es idempotente.
  const archivado = conCorrelativoUnaVez(nombre, 'CM-FR-006-2026-0169');
  assert.equal(archivado, 'Informe-Termico-Temuco-A-CM-FR-006-2026-0169.pdf');
  assert.equal(
    (archivado.match(/CM-FR-006-2026-0169/g) || []).length, 1,
    'el correlativo aparece más de una vez'
  );
});

test('REAL: vientos, mismo caso (CM-FR-007)', () => {
  const nombre = nombreConLetra('Informe-Vientos-Temuco.pdf', 0, 'CM-FR-007-2026-0053');
  const archivado = conCorrelativoUnaVez(nombre, 'CM-FR-007-2026-0053');
  assert.equal(archivado, 'Informe-Vientos-Temuco-A-CM-FR-007-2026-0053.pdf');
  assert.equal((archivado.match(/CM-FR-007-2026-0053/g) || []).length, 1);
});

test('si el nombre NO trae el correlativo, se lo agrega (comportamiento viejo)', () => {
  assert.equal(
    conCorrelativoUnaVez('Informe-Termico-Temuco.pdf', 'CM-FR-006-2026-0169'),
    'Informe-Termico-Temuco-CM-FR-006-2026-0169.pdf'
  );
});

test('idempotente: aplicarlo dos veces da lo mismo', () => {
  const a = conCorrelativoUnaVez('Informe-Termico-Freire.pdf', 'CM-FR-006-2026-0165');
  const b = conCorrelativoUnaVez(a, 'CM-FR-006-2026-0165');
  assert.equal(a, b);
});

test('sin folio devuelve el nombre intacto (degrada, no rompe)', () => {
  assert.equal(conCorrelativoUnaVez('Informe-Termico-Temuco.pdf', null), 'Informe-Termico-Temuco.pdf');
  assert.equal(conCorrelativoUnaVez('Informe-Termico-Temuco.pdf', ''), 'Informe-Termico-Temuco.pdf');
  assert.equal(conCorrelativoUnaVez('Informe-Termico-Temuco.pdf', undefined), 'Informe-Termico-Temuco.pdf');
});

test('bordes: nombre vacio o nulo no revienta', () => {
  assert.equal(conCorrelativoUnaVez('', 'CM-FR-006-2026-0169'), '');
  assert.equal(conCorrelativoUnaVez(null, 'CM-FR-006-2026-0169'), '');
});

test('limpia caracteres que WorkDrive y Meta rechazan', () => {
  const r = conCorrelativoUnaVez('Informe.pdf', 'CM/FR:006*2026?0169');
  assert.ok(!/[\/:*?]/.test(r), `quedaron caracteres ilegales: ${r}`);
});

test('folios distintos de la misma serie NO se confunden', () => {
  const n = nombreConLetra('Informe-Termico-Temuco.pdf', 0, 'CM-FR-006-2026-0168');
  const r = conCorrelativoUnaVez(n, 'CM-FR-006-2026-0169');
  assert.ok(r.includes('CM-FR-006-2026-0168'));
  assert.ok(r.includes('CM-FR-006-2026-0169'), 'un folio distinto SÍ debe agregarse');
});
