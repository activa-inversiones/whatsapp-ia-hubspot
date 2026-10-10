// [2026-10-08 · #1403 · OK del dueño «dale con la a»] Guardia de la DECISIÓN: los acuses de Meta
// llegan a oliver-gpt (quien los procesa) y los mensajes de clientes siguen EXACTAMENTE su camino.
// Prueba de punta a punta con el bot real: tools/e2e-acuses.mjs (antes del arreglo: 0 de 1 lecturas).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { esSoloAcuses } from './soloAcuses.js';

const cambio = (value) => ({ entry: [{ changes: [{ value }] }] });

test('solo acuses → true (read, delivered, failed)', () => {
  for (const status of ['read', 'delivered', 'sent', 'failed']) {
    assert.equal(esSoloAcuses(cambio({ statuses: [{ id: 'w', status }] })), true, status);
  }
});

test('un mensaje de cliente → false: su camino no cambia', () => {
  assert.equal(esSoloAcuses(cambio({ messages: [{ id: 'm', from: '569', type: 'text' }] })), false);
});

test('webhook MIXTO (mensaje + acuse) → false: sigue el camino del mensaje', () => {
  assert.equal(esSoloAcuses(cambio({ messages: [{ id: 'm' }], statuses: [{ id: 'w', status: 'read' }] })), false);
  const dos = { entry: [{ changes: [{ value: { statuses: [{ id: 'w' }] } }, { value: { messages: [{ id: 'm' }] } }] }] };
  assert.equal(esSoloAcuses(dos), false);
});

test('basura o vacío → false', () => {
  for (const b of [null, undefined, {}, { entry: [] }, { entry: [{}] }, cambio({ statuses: [] }), 'x']) {
    assert.equal(esSoloAcuses(b), false);
  }
});

test('index.js desvía los acuses ANTES del routing por número, con firma y detrás del flag', async () => {
  const src = await readFile(new URL('../../index.js', import.meta.url), 'utf8');
  const desvio = src.indexOf('esSoloAcuses(req.body)');
  const routing = src.indexOf('const _incG = extractMsg(req.body);');
  assert.ok(desvio > 0 && routing > 0 && desvio < routing, 'el desvío tiene que ir antes del routing por número');
  const bloque = src.slice(desvio - 200, desvio + 400);
  assert.match(bloque, /process\.env\.OLIVER_GPT_ENABLED === "true" && esSoloAcuses\(req\.body\)/);
  assert.match(bloque, /if \(!verifySig\(req\)\) \{ res\.sendStatus\(200\); return; \}/);
  assert.match(bloque, /return await handleWebhook\(req, res\);/, 'sin await el catch no ve el rechazo (Copilot M1)');
});
