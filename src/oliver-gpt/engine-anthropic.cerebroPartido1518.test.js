// [#1518 · 14-oct] Cerebro partido por pasada, por variables. Guardia de la DECISIÓN del dueño: Opus donde se
// cotiza (pass1) y Sonnet donde se escribe (pass2), sin tocar código; y sin variables, TODO queda como estaba.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anthropicPass1, anthropicPass2 } from './engine-anthropic.js';

const VARS = ['AI_MODEL_ANTHROPIC', 'AI_MODEL_ANTHROPIC_PASS1', 'AI_MODEL_ANTHROPIC_PASS2', 'AI_EFFORT', 'AI_EFFORT_PASS1', 'AI_EFFORT_PASS2', 'OLIVER_PASS2_MAX_TOKENS', 'OLIVER_PASS1_MAX_TOKENS'];
const conEnv = async (env, fn) => {
  const antes = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  Object.assign(process.env, env);
  try { return await fn(); } finally { for (const k of VARS) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; } }
};
const captura = () => { const c = { p1: null, p2: null }; const fake = { messages: { create: async (p) => { if (p.tools) { c.p1 = p; return { content: [{ type: 'text', text: 'x' }] }; } c.p2 = p; return { content: [{ type: 'text', text: 'ok' }] }; } } }; return { c, fake }; };
const correr = async (fake) => {
  await anthropicPass1({ system: 'S', messages: [{ role: 'user', content: 'hola' }], tools: [{ type: 'function', function: { name: 't', description: 'd', parameters: { type: 'object', properties: {} } } }], _client: fake });
  await anthropicPass2({ system: 'S', messages: [{ role: 'user', content: 'hola' }], _client: fake });
};

test('sin variables nuevas: las dos pasadas usan AI_MODEL_ANTHROPIC, AI_EFFORT y el tope 900 de siempre', async () => {
  await conEnv({ AI_MODEL_ANTHROPIC: 'claude-sonnet-4-6', AI_EFFORT: 'medium' }, async () => {
    const { c, fake } = captura(); await correr(fake);
    assert.equal(c.p1.model, 'claude-sonnet-4-6');
    assert.equal(c.p2.model, 'claude-sonnet-4-6');
    assert.deepEqual(c.p1.output_config, { effort: 'medium' });
    assert.deepEqual(c.p2.output_config, { effort: 'medium' });
    assert.equal(c.p2.max_tokens, 900);
    assert.equal(c.p1.max_tokens, 4096);
  });
});

test('cerebro partido: pass1 Opus 5.5 effort medium · pass2 Sonnet 5.5 effort low · tope de pass2 por variable', async () => {
  await conEnv({
    AI_MODEL_ANTHROPIC: 'claude-sonnet-4-6', AI_EFFORT: 'medium',
    AI_MODEL_ANTHROPIC_PASS1: 'claude-opus-5-5', AI_MODEL_ANTHROPIC_PASS2: 'claude-sonnet-5-5',
    AI_EFFORT_PASS2: 'low', OLIVER_PASS2_MAX_TOKENS: '2000', OLIVER_PASS1_MAX_TOKENS: '8192',
  }, async () => {
    const { c, fake } = captura(); await correr(fake);
    assert.equal(c.p1.model, 'claude-opus-5-5');
    assert.equal(c.p2.model, 'claude-sonnet-5-5');
    assert.deepEqual(c.p1.output_config, { effort: 'medium' }, 'pass1 hereda AI_EFFORT');
    assert.deepEqual(c.p2.output_config, { effort: 'low' });
    assert.equal(c.p2.max_tokens, 2000);
    assert.equal(c.p1.max_tokens, 8192);
    // Lo que Opus 5.5 / Sonnet 5.5 RECHAZAN no se manda: ni thinking configurado, ni tool_choice forzado, ni temperature
    for (const p of [c.p1, c.p2]) { assert.equal(p.thinking, undefined); assert.equal(p.tool_choice, undefined); assert.equal(p.temperature, undefined); }
  });
});

test('AI_EFFORT_PASS2 vacío = no mandar output_config en pass2 (mismo contrato que AI_EFFORT=\'\')', async () => {
  await conEnv({ AI_EFFORT: 'medium', AI_EFFORT_PASS2: '' }, async () => {
    const { c, fake } = captura(); await correr(fake);
    assert.deepEqual(c.p1.output_config, { effort: 'medium' });
    assert.equal(c.p2.output_config, undefined);
  });
});
