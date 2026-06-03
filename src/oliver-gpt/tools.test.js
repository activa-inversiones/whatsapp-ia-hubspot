// tools.test.js — Tests del modulo F2 (tools OpenAI + cliente ACTIVA Engine).
// Runner nativo: ejecutar desde C:\Users\mcifu\activa\temp-wa con:
//   node --test src/oliver-gpt/tools.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOL_DEFS } from './tools.js';
import { calcularCotizacion, calcularPorArea, APERTURAS } from './engine-client.js';

const APERTURAS_ESPERADAS = ['CORREDERA', 'PROYECTANTE', 'FIJA', 'BATIENTE', 'OSCILOBATIENTE'];

function getToolDef(name) {
  const def = TOOL_DEFS.find((t) => t.function && t.function.name === name);
  assert.ok(def, `Debe existir la tool '${name}' en TOOL_DEFS`);
  return def;
}

// (a) El enum de 'tipo' en calcular_cotizacion excluye TERMOPANEL y solo admite
//     las 5 aperturas.
test("(a) calcular_cotizacion: enum 'tipo' = 5 aperturas, SIN TERMOPANEL", () => {
  const def = getToolDef('calcular_cotizacion');
  const tipoEnum = def.function.parameters.properties.tipo.enum;

  assert.ok(Array.isArray(tipoEnum), "el campo 'tipo' debe declarar un enum");
  assert.ok(
    !tipoEnum.includes('TERMOPANEL'),
    "el enum de 'tipo' NUNCA debe incluir TERMOPANEL"
  );
  assert.deepEqual(
    [...tipoEnum].sort(),
    [...APERTURAS_ESPERADAS].sort(),
    "el enum debe ser exactamente las 5 aperturas"
  );
  // glass_id debe ser obligatorio.
  assert.ok(
    def.function.parameters.required.includes('glass_id'),
    'glass_id debe ser obligatorio en calcular_cotizacion'
  );
});

test("(a bis) calcular_por_area: enum 'tipo' = 5 aperturas SIN TERMOPANEL y usa area_m2", () => {
  const def = getToolDef('calcular_por_area');
  const props = def.function.parameters.properties;
  const tipoEnum = props.tipo.enum;

  assert.ok(!tipoEnum.includes('TERMOPANEL'), "calcular_por_area: enum sin TERMOPANEL");
  assert.deepEqual([...tipoEnum].sort(), [...APERTURAS_ESPERADAS].sort());

  // Campo correcto: area_m2 (NO m2).
  assert.ok(props.area_m2, "debe existir el parametro 'area_m2'");
  assert.ok(!props.m2, "no debe existir el parametro 'm2'");
  assert.ok(def.function.parameters.required.includes('area_m2'));
  assert.ok(def.function.parameters.required.includes('glass_id'));
});

test('(a) APERTURAS del engine-client coincide con las 5 esperadas', () => {
  assert.deepEqual([...APERTURAS].sort(), [...APERTURAS_ESPERADAS].sort());
});

// El cliente debe rechazar localmente tipo:'TERMOPANEL' antes de llamar a la red.
test("calcularCotizacion rechaza tipo:'TERMOPANEL' sin tocar la red", async () => {
  await assert.rejects(
    () =>
      calcularCotizacion({
        tipo: 'TERMOPANEL',
        ancho_mm: 1500,
        alto_mm: 1200,
        glass_id: 44,
      }),
    /TERMOPANEL/i
  );
});

// (c) calcularPorArea sin glass_id rechaza.
test('(c) calcularPorArea sin glass_id rechaza', async () => {
  await assert.rejects(
    () => calcularPorArea({ tipo: 'CORREDERA', area_m2: 3.6 }),
    /glass_id/i
  );
});

// (b) TEST GOLDEN EN VIVO. Si el Engine esta caido, NO falla el suite:
//     se registra un blocker y el test pasa (no-red), dejando intactos los de enum.
test('(b) GOLDEN EN VIVO: CORREDERA 1500x1200 glass_id=44 Temuco => ok:true, total>0', async (t) => {
  let res;
  try {
    res = await calcularCotizacion({
      tipo: 'CORREDERA',
      ancho_mm: 1500,
      alto_mm: 1200,
      color: 'blanco',
      glass_id: 44,
      comuna: 'Temuco',
    });
  } catch (err) {
    // Engine caido / sin red: marcar blocker pero no romper el suite.
    t.diagnostic(`BLOCKER: Engine no disponible para el golden en vivo: ${err.message}`);
    t.skip('Engine no disponible; golden en vivo omitido (tests de enum siguen verdes)');
    return;
  }

  assert.equal(res && res.ok, true, 'la respuesta del Engine debe traer ok:true');

  const total =
    res.total ??
    res.total_clp ??
    (res.totals && (res.totals.total ?? res.totals.total_clp)) ??
    (res.quote && (res.quote.total ?? res.quote.total_clp));

  assert.ok(typeof total === 'number' && total > 0, `total debe ser > 0 (recibido: ${total})`);
  t.diagnostic(`GOLDEN total devuelto = ${total}`);
});
