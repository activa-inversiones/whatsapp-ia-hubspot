// [Thermos conjunto #3, 30-sep] "¿Ya nos escribió?" tiene que ver también a quien escribió ANTES de
// que el bot empezara a registrar `escribio:` (antes del deploy): se le pregunta a sales-os si hay
// mensajes entrantes de ese teléfono. Si no, a un cliente con historia se le marcaba "sin
// consentimiento" y el re-enganche lo ignoraba.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yaNosEscribio, _reset } from './atribucionCotizacion.js';

test('Thermos conjunto #3: sin marca local pero con mensajes entrantes en sales-os = YA nos escribió', async () => {
  _reset();
  assert.equal(await yaNosEscribio('56987654321', async () => null, async () => true), true);
});

test('Thermos conjunto #3: sin marca y sin mensajes en sales-os (o sales-os caído) = NO (se marca)', async () => {
  _reset();
  assert.equal(await yaNosEscribio('56987654321', async () => null, async () => false), false);
  assert.equal(await yaNosEscribio('56987654321', async () => null, async () => { throw new Error('red'); }), false);
});
