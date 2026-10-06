// services/informeVientosPdf.nota.test.js
// Runner nativo: node --test services/informeVientosPdf.nota.test.js
//
// La frase bajo el gráfico de radiación solar del informe de vientos le sugería a TODOS los clientes «un vidrio
// adecuado (con control solar o Low-E)». Regla del dueño (05-oct): Oliver no ofrece vidrios especiales por su cuenta,
// solo si el cliente los pide; y el control solar ni siquiera está confirmado. Un documento firmado que llega a todos
// no puede recomendar un vidrio que la propuesta no lleva.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as informe from './informeVientosPdf.js';

test('🔴 N1 la nota de radiación solar NO recomienda ningún vidrio especial', () => {
  assert.equal(typeof informe.notaRadiacionSolar, 'function', 'la frase vive en una función exportada para poder probarla');
  const t = informe.notaRadiacionSolar(5.234);
  assert.doesNotMatch(t, /control solar/i);
  assert.doesNotMatch(t, /low[\s-]?e/i);
  assert.doesNotMatch(t, /vidrio/i, 'no recomienda vidrios');
});

test('✅ N2 la nota conserva el dato del cliente (promedio del año) y no da cifras de mejora', () => {
  const t = informe.notaRadiacionSolar(5.234);
  assert.match(t, /Promedio del año: 5,2 kWh\/m² al día/);
  assert.doesNotMatch(t, /\d\s*%/, 'sin cifras de mejora');
});
