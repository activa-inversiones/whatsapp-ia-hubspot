// node --test src/oliver-gpt/engine-anthropic.test.js
//
// Tests herméticos (sin red): validan la conversión OpenAI <-> Anthropic y que
// las formas devueltas por el adaptador Claude son IDÉNTICAS a las del motor OpenAI,
// para que agent.js / channel-agent.js / webhook.js funcionen sin cambios.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  _toAnthropicTools,
  _toAnthropicMessages,
  _mapPass1Response,
  anthropicPass1,
  anthropicPass2,
} from './engine-anthropic.js';

test('tools: OpenAI {function:{...}} -> Anthropic {name,description,input_schema}', () => {
  const t = _toAnthropicTools([
    { type: 'function', function: { name: 'calcular', description: 'desc', parameters: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] } } },
  ]);
  assert.equal(t.length, 1);
  assert.equal(t[0].name, 'calcular');
  assert.equal(t[0].description, 'desc');
  assert.deepEqual(t[0].input_schema, { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] });
  assert.equal('function' in t[0], false); // sin la envoltura OpenAI
});

test('mensajes: user/assistant(tool_calls)/tool -> bloques Anthropic + fusión de tool_results', () => {
  const a = _toAnthropicMessages([
    { role: 'user', content: 'hola' },
    { role: 'assistant', content: 'ok', tool_calls: [
      { id: 't1', type: 'function', function: { name: 'calc', arguments: '{"x":1}' } },
      { id: 't2', type: 'function', function: { name: 'calc', arguments: '{"x":2}' } },
    ] },
    { role: 'tool', tool_call_id: 't1', content: '{"ok":true}' },
    { role: 'tool', tool_call_id: 't2', content: '{"ok":true}' },
  ]);
  assert.equal(a[0].role, 'user');
  assert.equal(a[1].role, 'assistant');
  assert.equal(a[1].content[0].type, 'text');
  assert.equal(a[1].content[1].type, 'tool_use');
  assert.equal(a[1].content[1].id, 't1');
  assert.deepEqual(a[1].content[1].input, { x: 1 });
  // los 2 tool_results se fusionan en UN solo turno user
  assert.equal(a.length, 3);
  assert.equal(a[2].role, 'user');
  assert.equal(a[2].content.length, 2);
  assert.equal(a[2].content[0].type, 'tool_result');
  assert.equal(a[2].content[0].tool_use_id, 't1');
});

test('respuesta pass1: tool_use de Claude -> tool_calls forma OpenAI (arguments = JSON string)', () => {
  const r = _mapPass1Response({ content: [
    { type: 'text', text: 'voy a calcular' },
    { type: 'tool_use', id: 'tu_1', name: 'calcular', input: { a: 1 } },
  ], stop_reason: 'tool_use' });
  assert.equal(r.content, 'voy a calcular');
  assert.equal(r.tool_calls.length, 1);
  assert.equal(r.tool_calls[0].id, 'tu_1');
  assert.equal(r.tool_calls[0].type, 'function');
  assert.equal(r.tool_calls[0].function.name, 'calcular');
  assert.equal(r.tool_calls[0].function.arguments, '{"a":1}');
});

test('pass1/pass2 con cliente fake — mismas formas que el motor OpenAI', async () => {
  const fake = {
    messages: {
      create: async (params) => {
        if (params.tools && params.tools.length) {
          return { content: [{ type: 'tool_use', id: 'x', name: 'calcular_cotizacion', input: { tipo: 'CORREDERA' } }], stop_reason: 'tool_use' };
        }
        return { content: [{ type: 'text', text: 'Listo, te preparo la propuesta.' }], stop_reason: 'end_turn' };
      },
    },
  };
  const p1 = await anthropicPass1({
    system: 'S',
    messages: [{ role: 'user', content: 'hola' }],
    tools: [{ type: 'function', function: { name: 'calcular_cotizacion', description: 'd', parameters: { type: 'object', properties: {} } } }],
    _client: fake,
  });
  assert.equal(p1.tool_calls.length, 1);
  assert.equal(p1.tool_calls[0].function.name, 'calcular_cotizacion');

  const p2 = await anthropicPass2({ system: 'S', messages: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'previo' }], _client: fake });
  assert.equal(typeof p2, 'string');
  assert.equal(p2, 'Listo, te preparo la propuesta.');
});

test('pass2: descarta un assistant final (evita prefill -> 400 en Sonnet 4.6)', async () => {
  let captured = null;
  const fake = { messages: { create: async (p) => { captured = p; return { content: [{ type: 'text', text: 'ok' }] }; } } };
  await anthropicPass2({
    system: 'S',
    messages: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'NO debe ir como prefill' }],
    _client: fake,
  });
  const last = captured.messages[captured.messages.length - 1];
  assert.equal(last.role, 'user'); // NO termina en assistant
});

test('pass1: system viaja con caché de prompt (cache_control ephemeral)', async () => {
  let captured = null;
  const fake = { messages: { create: async (p) => { captured = p; return { content: [], stop_reason: 'end_turn' }; } } };
  await anthropicPass1({ system: 'PROMPT GRANDE', messages: [{ role: 'user', content: 'hi' }], tools: [], _client: fake });
  assert.ok(Array.isArray(captured.system));
  assert.equal(captured.system[0].cache_control.type, 'ephemeral');
  assert.equal(captured.max_tokens, 4096); // [2026-07-20] alineado con el default real (engine-anthropic.js:163, subido por abf0ca9; env OLIVER_PASS1_MAX_TOKENS lo pisa)
});
