// avisoEntregaDudosa.test.js
// Kimi, compuerta 16-sep: "el cambio convierte 'posible duplicado' en 'posible pérdida
// silenciosa'". Estos tests fijan que la pérdida NO sea silenciosa.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mensajeEntregaDudosa, tocaAvisar, claveAviso, AVISO_REPETIR_MS, VERSION,
} from './avisoEntregaDudosa.js';

const AHORA = Date.parse('2026-09-16T12:00:00Z');

test('🔴 el aviso lleva la evidencia para que el dueño NO duplique', () => {
  const m = mensajeEntregaDudosa({
    tipo: 'Informe térmico', folio: 'CM-FR-006-2026-0033',
    telefono: '56998702852', motivo: 'timeout',
  });
  assert.match(m, /CM-FR-006-2026-0033/, 'falta el folio');
  assert.match(m, /2852/, 'falta cómo ubicar el chat');
  assert.match(m, /timeout/, 'falta el motivo');
  assert.match(m, /NO se reenvía solo/, 'falta la instrucción que evita el duplicado');
});

test('🔴 el teléfono NO va completo', () => {
  const m = mensajeEntregaDudosa({ telefono: '56998702852' });
  assert.ok(!m.includes('56998702852'));
});

test('sin datos no revienta y sigue siendo accionable', () => {
  const m = mensajeEntregaDudosa();
  assert.match(m, /sin folio/);
  assert.match(m, /sin teléfono/);
  assert.match(m, /NO se reenvía solo/);
});

test('🔴 nunca avisado ⇒ se avisa', () => {
  assert.equal(tocaAvisar(null, AHORA), true);
  assert.equal(tocaAvisar(undefined, AHORA), true);
  assert.equal(tocaAvisar('', AHORA), true);
});

test('🔴 recién avisado ⇒ NO se repite (si grita siempre, se ignora)', () => {
  assert.equal(tocaAvisar(AHORA - 60_000, AHORA), false);
});

test('pasado el intervalo vuelve a avisar; justo en el intervalo también', () => {
  assert.equal(tocaAvisar(AHORA - AVISO_REPETIR_MS, AHORA), true);
  assert.equal(tocaAvisar(AHORA - AVISO_REPETIR_MS - 1, AHORA), true);
});

test('marca ilegible ⇒ se avisa igual: ante la duda, avisar', () => {
  assert.equal(tocaAvisar('no-es-fecha', AHORA), true);
  assert.equal(tocaAvisar(0, AHORA), true);
  assert.equal(tocaAvisar(-5, AHORA), true);
});

test('acepta fecha ISO, no solo epoch', () => {
  assert.equal(tocaAvisar(new Date(AHORA - 60_000).toISOString(), AHORA), false);
  assert.equal(tocaAvisar(new Date(AHORA - 7 * 3600_000).toISOString(), AHORA), true);
});

test('🔴 la llave es POR DOCUMENTO: dos informes del mismo cliente no se tapan', () => {
  assert.notEqual(claveAviso('termico', 'F1'), claveAviso('termico', 'F2'));
  assert.notEqual(claveAviso('termico', 'F1'), claveAviso('vientos', 'F1'));
  assert.equal(claveAviso('termico', 'F1'), claveAviso('termico', 'F1'));
});

test('expone VERSION', () => assert.match(VERSION, /^\d+\.\d+\.\d+$/));
