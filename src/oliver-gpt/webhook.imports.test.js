// webhook.imports.test.js — [2026-08-24]
//
// CAZA IMPORTS FALTANTES EN EL PATRON `deps.x || x`.
//
// 🔴 EL DEFECTO QUE LO MOTIVA, encontrado por Codex en la compuerta: el manejo de acuses
// llamaba a `borrarEstado(...)` y ESA FUNCION NO ESTABA IMPORTADA. En produccion eso lanza
// un ReferenceError que el `try/catch` de al lado se traga, asi que el candado del informe
// nunca se liberaba y el cliente quedaba 30 dias sin documento — en silencio absoluto.
//
// Y los tests estaban VERDES, porque todos inyectan `deps.borrarEstado`: el `||` nunca
// llegaba a evaluar el identificador roto. Un test que sustituye la dependencia no puede
// ver que la dependencia real no existe.
//
// Este test mira el modulo tal como corre en produccion, sin sustituir nada.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fuente = () => readFile(new URL('./webhook.js', import.meta.url), 'utf8');

test('🔴 todo `deps.x || x` tiene su `x` importado o declarado', async () => {
  const src = await fuente();

  // Los nombres que el codigo usa como fallback cuando no se inyecta la dependencia.
  const usados = [...src.matchAll(/deps\.(\w+)\s*\|\|\s*(\w+)\s*\)/g)].map((m) => m[2]);
  assert.ok(usados.length > 10, 'el patron `deps.x || x` deberia aparecer muchas veces');

  const faltantes = [...new Set(usados)].filter((nombre) => {
    // ¿Esta importado, o declarado como const/let/function en el modulo?
    const importado = new RegExp(`(?:^|[,{\\s])${nombre}(?:\\s*,|\\s*\\}|\\s*$)`, 'm')
      .test(src.slice(0, src.indexOf('/* =')));
    const declarado = new RegExp(`\\b(?:const|let|var|function|async function)\\s+${nombre}\\b`)
      .test(src);
    const alias = new RegExp(`\\bas\\s+${nombre}\\b`).test(src);
    return !(importado || declarado || alias);
  });

  assert.deepEqual(faltantes, [],
    `usados como fallback pero nunca importados ni declarados: ${faltantes.join(', ')}`);
});

test('🔒 el modulo se puede cargar de verdad (no solo parsear)', async () => {
  // `node --check` valida la sintaxis pero no resuelve los imports. Cargarlo de verdad es
  // lo unico que prueba que cada `import` apunta a algo que existe y exporta lo que dice.
  const mod = await import('./webhook.js');
  assert.equal(typeof mod.handleWebhook, 'function');
});
