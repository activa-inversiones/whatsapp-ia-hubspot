// src/sales-agent/system-prompt.vidrio-especial.test.js
// Runner nativo: node --test src/sales-agent/system-prompt.vidrio-especial.test.js
//
// [2026-10-05 · orden del coordinador, ronda Low-E automático, punto 6c] EL PILOTO v2 TENÍA EL MISMO TEXTO FALSO.
//
// `src/sales-agent/` es el piloto «Oliver v2» (`OLIVER_V2_ENABLED` + lista de números, index.js:5513). No es el
// cerebro de producción, pero tenía copiado lo mismo que se sacó de `src/oliver-gpt/system-prompt.js` en 15ea601:
// la mejora «30-40 %» del Low-E, «la L indica Low-E» (en el catálogo esos ids son laminado) y la orden de recomendar
// vidrios especiales con `listar_vidrios`. SOLO TEXTO: este piloto no tiene la señal `vidrio_especial` ni el respaldo
// del motor, así que para él Low-E sigue siendo «se cotiza aparte, lo ve Marcelo».

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSystemBlocks } from './system-prompt.js';
import { TOOL_DEFS } from './tools.js';

const textoDelPrompt = () => buildSystemBlocks().map((b) => b.text).join('\n\n');

function noHay(texto, re, mensaje) {
  const m = texto.match(re);
  assert.ok(!m, `${mensaje} — calzó: «${m && m[0].replace(/\s+/g, ' ').slice(0, 160)}»`);
}

test('🔴 P1 el piloto NO enseña que la "L" del código indica Low-E ni la mejora «30-40 %»', () => {
  const sys = textoDelPrompt();
  noHay(sys, /la\s+["“”«']?L["“”»']?\s+indica\s+Low-?E/i, 'falso: en el catálogo esos ids son laminado');
  noHay(sys, /TP-M-\d+\+\d+\+\d+L\b/, 'códigos de vidrio laminado presentados como Low-E');
  noHay(sys, /30\s*[-–]\s*40\s*%/, 'cifra sin fuente');
});

test('🔴 P2 el piloto no da cifras de mejora de ningún vidrio especial', () => {
  noHay(textoDelPrompt(),
    /(?:low-?e|control solar|asim[eé]trico|laminad|selective)[^]{0,160}?\d+\s*(?:[-–]\s*\d+\s*)?(?:%|dB)/i,
    'cifra de mejora de un vidrio especial (el dueño no los confirmó)');
});

test('🔴 P3 el piloto no recomienda Low-E por el frío ni manda a listar_vidrios «para recomendar»', () => {
  const sys = textoDelPrompt();
  noHay(sys, /opci[oó]n\s+\*{0,2}Low-?E/i, '«Termopanel base + opción Low-E»');
  noHay(sys, /fr[ií]o\s*(?:→|->)\s*Low-?E/i, '«frío→Low-E»');
  noHay(sys, /una cara con Low-?E/i, 'la frase modelo que ofrecía Low-E');
  noHay(sys, /listar_vidrios`?\s+para recomendar/i, 'listar_vidrios «para recomendar»');
  noHay(sys, /Educar si aplica\*{0,2}\s*—\s*Low-?E/i, 'paso 4 del flujo educando con Low-E / Control Solar');
});

test('✅ P4 el piloto dice la regla: Low-E se cotiza aparte con Marcelo; templado, control solar y demás, se consultan', () => {
  const sys = textoDelPrompt();
  assert.match(sys, /Low-?E[^]{0,300}APARTE|APARTE[^]{0,300}Low-?E/i);
  assert.match(sys, /notificar_marcelo/);
  assert.match(sys, /lo consulto con el Ing\. Marcelo/i);
});

test('🔴 P5 la herramienta listar_vidrios del piloto no se vende para «recomendar el vidrio que calza con el dolor»', () => {
  const def = TOOL_DEFS.find((t) => t.name === 'listar_vidrios');
  assert.ok(def, 'el piloto conserva la tool');
  noHay(def.description, /recomendar el vidrio/i, 'la descripción sigue mandando a recomendar vidrios');
  noHay(def.description, /\(Low-E, control solar, laminado, asim[eé]trico\)/i, 'la descripción ofrece como disponibles vidrios que el motor no cotiza');
});
