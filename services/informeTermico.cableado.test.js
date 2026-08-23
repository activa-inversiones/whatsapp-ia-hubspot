// informeTermico.cableado.test.js — [2026-08-21]
//
// El modulo informeTermico.js ya tiene sus 26 tests. ESTE prueba otra cosa: que este
// CABLEADO donde tiene que estar. Un modulo perfecto que nadie llama no le sirve a nadie —
// es exactamente lo que paso con el reporte de costo de Oliver, que estuvo tres semanas
// "conectado" sin guardar una sola fila.
//
// Se verifica sobre la fuente porque el cableado son dos puntos de union entre archivos
// (tools.js dispara, webhook.js provee), y no hay forma de observarlos sin levantar el bot.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const leer = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

test('calcular_cotizacion DISPARA el informe — es el momento en que el cliente espera', async () => {
  const src = await leer('../src/oliver-gpt/tools.js');
  const bloque = src.slice(src.indexOf("case 'calcular_cotizacion'"), src.indexOf("case 'calcular_por_area'"));
  assert.match(bloque, /ctx\?\.enviarInformeTermico/,
    'sin esto el informe existe pero nadie lo manda');
  assert.match(bloque, /ctx\.enviarInformeTermico\(input\.comuna \|\| ''\)/,
    'tiene que pasarle la comuna capturada, no inventar una');
});

test('🔒 el disparo NO puede frenar ni demorar la cotizacion', async () => {
  const src = await leer('../src/oliver-gpt/tools.js');
  const bloque = src.slice(src.indexOf("case 'calcular_cotizacion'"), src.indexOf("case 'calcular_por_area'"));
  const linea = bloque.split('\n').find((l) => l.includes('ctx.enviarInformeTermico('));
  assert.ok(linea, 'no se encontro la llamada');
  assert.doesNotMatch(linea, /await/, 'con await, un THERMAL lento demoraria el precio del cliente');
  assert.match(linea, /try \{.*\} catch/, 'una excepcion aca no puede tumbar la cotizacion');
});

test('el disparo va DESPUES de que la cotizacion salio bien, no antes', async () => {
  // Si se disparara antes del guard de `unit_price > 0`, se le mandaria un informe a alguien
  // a quien despues no se le puede cotizar. Prometer y no cumplir es peor que no prometer.
  const src = await leer('../src/oliver-gpt/tools.js');
  const bloque = src.slice(src.indexOf("case 'calcular_cotizacion'"), src.indexOf("case 'calcular_por_area'"));
  const iFallo = bloque.indexOf('return falloDeCotizacion');
  const iInforme = bloque.indexOf('ctx.enviarInformeTermico');
  assert.ok(iFallo > 0 && iInforme > iFallo,
    'el informe tiene que ir despues del guard de fallo de cotizacion');
});

test('webhook.js PROVEE el hook, con candado de una sola vez por cliente', async () => {
  const src = await leer('../src/oliver-gpt/webhook.js');
  assert.match(src, /enviarInformeTermico: \(comuna\) =>/, 'el hook tiene que estar en toolCtx');
  assert.match(src, /informe_termico:\$\{String\(from\)/, 'el candado va por telefono');
  assert.match(src, /30 \* 24 \* 3600/, 'candado de 30 dias: un informe repetido es spam');
});

test('🔒 el candado se marca DESPUES del envio, no antes', async () => {
  // Si se marcara antes y el envio fallara, el cliente se quedaria sin informe para siempre.
  const src = await leer('../src/oliver-gpt/webhook.js');
  const i = src.indexOf('enviarInformeTermico: (comuna) =>');
  const bloque = src.slice(i, i + 1600);
  const iEnvio = bloque.indexOf('await enviarSinPausa(from, msg)');
  const iMarca = bloque.indexOf('escribirEstado)(clave, true');
  assert.ok(iEnvio > 0, 'no se encontro el envio');
  assert.ok(iMarca > iEnvio, 'el candado se marca despues de enviar: si falla, se reintenta');
});

test('🔒 sin dato verificado NO se manda nada — son citas normativas', async () => {
  const src = await leer('../src/oliver-gpt/webhook.js');
  const i = src.indexOf('enviarInformeTermico: (comuna) =>');
  const bloque = src.slice(i, i + 1600);
  assert.match(bloque, /if \(!msg\) return;/, 'si no hay informe valido, se calla');
});

test('el hook usa el nombre del cliente si lo hay', async () => {
  const src = await leer('../src/oliver-gpt/webhook.js');
  const i = src.indexOf('enviarInformeTermico: (comuna) =>');
  assert.match(src.slice(i, i + 1600), /nombre: state\.name \|\| ''/);
});
