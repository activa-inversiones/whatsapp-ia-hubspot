// node --test src/oliver-gpt/engine.test.js
// Test del FALLBACK entre proveedores (runWithFallback). Función pura: no toca OpenAI/Anthropic reales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWithFallback } from './engine.js';

const okAnthropic = async () => 'ANTHROPIC_OK';
const okOpenai = async () => 'OPENAI_OK';
const boom = (msg) => async () => { const e = new Error(msg); e.status = 402; throw e; };

test('primario Anthropic OK → responde Anthropic, NO llama a OpenAI', async () => {
  let openaiLlamado = false;
  const r = await runWithFallback('pass1', true, okAnthropic, async () => { openaiLlamado = true; return okOpenai(); });
  assert.equal(r, 'ANTHROPIC_OK');
  assert.equal(openaiLlamado, false);
});

test('Anthropic falla (sin saldo) → cae a OpenAI y el cliente igual recibe respuesta', async () => {
  delete process.env.AI_FALLBACK; // default = activado
  const r = await runWithFallback('pass2', true, boom('insufficient credit'), okOpenai);
  assert.equal(r, 'OPENAI_OK');
});

test('primario OpenAI falla → cae a Anthropic (simétrico)', async () => {
  delete process.env.AI_FALLBACK;
  const r = await runWithFallback('pass1', false, okAnthropic, boom('429 rate limit persistente'));
  assert.equal(r, 'ANTHROPIC_OK');
});

test('ambos proveedores fallan → relanza el error PRIMARIO (arriba actúa el fallback amable)', async () => {
  delete process.env.AI_FALLBACK;
  await assert.rejects(
    () => runWithFallback('pass1', true, boom('primario sin saldo'), boom('secundario tambien caido')),
    /primario sin saldo/,
  );
});

test('AI_FALLBACK=0 → NO intenta el secundario, relanza el primario', async () => {
  process.env.AI_FALLBACK = '0';
  let openaiLlamado = false;
  await assert.rejects(
    () => runWithFallback('pass2', true, boom('primario cae'), async () => { openaiLlamado = true; return okOpenai(); }),
    /primario cae/,
  );
  assert.equal(openaiLlamado, false);
  delete process.env.AI_FALLBACK;
});
