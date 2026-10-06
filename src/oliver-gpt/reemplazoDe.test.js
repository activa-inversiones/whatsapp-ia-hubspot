// 🛡️ [2026-10-06] Decision del dueño (opcion A): franja «reemplaza a la N° X» SOLO en correcciones de ventanas.
// Una alternativa de color (caso Paula: negra y blanca, las dos validas) NO reemplaza a la otra (Thermos x2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reemplazoDe } from './webhook.js';

const lq = { quote_number: 'CM-FR-004-2026-0598', sig_proyecto: 'P1' };
test('🛡️ correccion de ventanas ya entregada ⇒ reemplaza a la anterior', () => {
  assert.equal(reemplazoDe({ motivo: 'alternativa', lastQuote: lq, sigProyecto: 'P2' }), 'CM-FR-004-2026-0598');
});
test('🛡️ mismo proyecto en otro color (alternativa) ⇒ SIN franja', () => {
  assert.equal(reemplazoDe({ motivo: 'alternativa', lastQuote: lq, sigProyecto: 'P1' }), null);
});
test('🛡️ revision del mismo folio o folio nuevo ⇒ sin franja; propuesta vieja sin firma ⇒ sin franja', () => {
  assert.equal(reemplazoDe({ motivo: 'revision', lastQuote: lq, sigProyecto: 'P2' }), null);
  assert.equal(reemplazoDe({ motivo: 'sin_folio_previo', lastQuote: null, sigProyecto: 'P2' }), null);
  assert.equal(reemplazoDe({ motivo: 'alternativa', lastQuote: { quote_number: 'X' }, sigProyecto: 'P2' }), null);
});
