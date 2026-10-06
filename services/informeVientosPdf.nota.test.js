// services/informeVientosPdf.nota.test.js
// Runner nativo: node --test services/informeVientosPdf.nota.test.js
//
// [2026-10-05 · orden del coordinador, ronda Low-E automático, punto 6d] La frase bajo el gráfico de radiación solar
// del informe de vientos le sugería al cliente «un vidrio adecuado (con control solar o Low-E)». El dueño NO confirmó el
// control solar (solo Low-E se consigue). Un documento firmado no puede insinuar un producto que la empresa no vende:
// queda lo que se vende.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as informe from './informeVientosPdf.js';

test('🔴 N1 la nota de radiación solar NO nombra el control solar (no está confirmado)', () => {
  assert.equal(typeof informe.notaRadiacionSolar, 'function', 'la frase vive en una función exportada para poder probarla');
  const t = informe.notaRadiacionSolar(5.234);
  assert.doesNotMatch(t, /control solar/i);
});

test('✅ N2 la nota conserva el dato del cliente (promedio del año) y nombra solo Low-E', () => {
  const t = informe.notaRadiacionSolar(5.234);
  assert.match(t, /Promedio del año: 5,2 kWh\/m² al día/);
  assert.match(t, /Low-E/);
  assert.doesNotMatch(t, /\d\s*%/, 'sin cifras de mejora');
});
