// engine.proveedor.test.js — [2026-08-08]
//
// Nació de una pregunta del dueño que NO se pudo responder: "¿pudo pasar a GPT porque se
// terminó el saldo de Claude?". Había un comportamiento degradado en producción (el mismo
// PDF enviado 3 veces) y ningún registro decía qué modelo había contestado.
//
// Su razón de fondo es mejor que el diagnóstico: "en algún momento podría ser indistinto
// quién atienda, y deberían contestar bien AMBOS, no solo Claude Sonnet". Para poder
// afirmar eso hace falta el dato: sin él, "los dos contestan bien" es una creencia.

import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithFallback, ultimoProveedor } from './engine.js';

const ok = (quien) => async () => ({ quien });
const cae = (msg, status) => async () => { const e = new Error(msg); e.status = status; throw e; };

test('registra que contestó el PRIMARIO cuando todo anda bien', async () => {
  await runWithFallback('t', true, ok('anthropic'), ok('openai'));
  const p = ultimoProveedor();
  assert.equal(p.proveedor, 'anthropic');
  assert.equal(p.fue_respaldo, false);
  assert.equal(p.motivo, null, 'sin respaldo no hay motivo que registrar');
});

test('registra el RESPALDO y POR QUÉ entró', async () => {
  // Sin el motivo, "contestó GPT" no dice si fue por saldo, por un 500 de Anthropic o por
  // un prompt inválido — y cada uno se arregla distinto.
  await runWithFallback('t', true, cae('credit balance is too low', 400), ok('openai'));
  const p = ultimoProveedor();
  assert.equal(p.proveedor, 'openai');
  assert.equal(p.fue_respaldo, true);
  assert.match(p.motivo, /anthropic falló/i);
  assert.match(p.motivo, /credit balance/i, 'el motivo real tiene que quedar legible');
});

test('funciona en la otra dirección: si el primario es OpenAI, el respaldo es Claude', async () => {
  await runWithFallback('t', false, ok('anthropic'), cae('rate limit', 429));
  const p = ultimoProveedor();
  assert.equal(p.proveedor, 'anthropic');
  assert.equal(p.fue_respaldo, true);
});

test('si los DOS fallan, relanza y NO deja un proveedor falso registrado', async () => {
  await runWithFallback('t', true, ok('anthropic'), ok('openai')); // deja un estado bueno
  await assert.rejects(
    () => runWithFallback('t', true, cae('cae uno', 500), cae('cae dos', 500)),
    /cae uno/,
    'se relanza el error del PRIMARIO, que es el que dice la causa real'
  );
  const p = ultimoProveedor();
  assert.equal(p.fue_respaldo, false, 'un turno fallido no puede figurar como respondido por el respaldo');
});

test('el motivo se recorta: un stacktrace largo no puede inflar la metadata de cada mensaje', async () => {
  await runWithFallback('t', true, cae('x'.repeat(900), 500), ok('openai'));
  assert.ok(ultimoProveedor().motivo.length < 200);
});

// ── [2026-08-20] Paridad GPT ↔ Claude en el camino de cotizar ───────────────
// El dueno lo noto en produccion sin ver el codigo: "algo pasa que al parecer no cotiza
// como claude". Medido sobre 60 dias de turnos reales: Claude entrego el PDF en el 7,42%
// de sus turnos y GPT en el 3,35% — menos de la mitad.
// Los dos contratos de abajo se verifican sobre la FUENTE porque son parametros de la
// llamada al SDK: no hay forma de leerlos sin pegarle a la API de verdad.

import { readFile } from 'node:fs/promises';

test('GPT pide TODAS las tools de una pasada — sin eso no alcanza a cotizar y mandar el PDF', async () => {
  const src = await readFile(new URL('./engine.js', import.meta.url), 'utf8');
  assert.match(src, /parallel_tool_calls:\s*true/,
    'con `false` OpenAI emite UNA tool por vuelta; el bucle de agent.js corta en 6 iteraciones, '
    + 'y la Regla #13 exige calcular_cotizacion POR VENTANA + generar_pdf en el MISMO turno. '
    + 'Con 6 ventanas el bucle se agota ANTES del PDF.');
  assert.doesNotMatch(src, /parallel_tool_calls:\s*false/);
});

test('los dos cerebros pueden escribir lo mismo: el techo de pass2 es 900 en ambos', async () => {
  const [gpt, claude] = await Promise.all([
    readFile(new URL('./engine.js', import.meta.url), 'utf8'),
    readFile(new URL('./engine-anthropic.js', import.meta.url), 'utf8'),
  ]);
  const tGpt = Number((gpt.match(/OLIVER_PASS2_MAX_TOKENS\) : (\d+)/) || [])[1]);
  const tClaude = Number((claude.match(/max_tokens: (\d+), \/\/ \[2026-06-21\]/) || [])[1]);
  assert.equal(tClaude, 900, 'referencia: el lado de Claude, subido el 21-jun');
  assert.equal(tGpt, 900,
    `GPT quedo en ${tGpt}. El 14,13% de sus mensajes llegaba a 620+ chars (contra 0,38% de `
    + 'Claude): se cortaba la entrega de la propuesta a mitad de frase.');
});
