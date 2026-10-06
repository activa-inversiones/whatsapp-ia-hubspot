// src/oliver-gpt/vidrio-lo-elige-el-motor.test.js
// Runner nativo: node --test src/oliver-gpt/vidrio-lo-elige-el-motor.test.js
//
// [2026-10-05 · orden del coordinador, ronda Low-E automático, punto 6a] «EL VIDRIO LO ELIGE EL MOTOR»
// también en las DESCRIPCIONES de las herramientas, no solo en el prompt.
//
// El informe de 15ea601 dejó listados tres residuos de la misma contradicción en `tools.js`:
//   · calcular_cotizacion (:233-234): «para usarlo, primero llama listar_vidrios y pasa su glass_id»,
//     a dos líneas de «NO pases glass_id; NO uses listar_vidrios». El LLM leía las dos órdenes.
//   · listar_vidrios (:209): «Use esta tool ANTES de cotizar para obtener el glass_id».
//   · calcular_por_area: glass_id OBLIGATORIO «de listar_vidrios», cuando el handler lo ignora
//     (`input.glass_id || 34`: «vidrio dummy: solo derivamos medidas; el precio se recalcula») y el
//     precio sale de `priceAllEngine`, que elige el vidrio solo.
// Y con ellos, dos líneas del prompt que daban por obligatorio ese glass_id.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOL_DEFS, runTool } from './tools.js';
import { buildSystemBlocks } from './system-prompt.js';

const getToolDef = (name) => {
  const def = TOOL_DEFS.find((t) => t.function && t.function.name === name);
  assert.ok(def, `Debe existir la tool '${name}' en TOOL_DEFS`);
  return def;
};

function noHay(texto, re, mensaje) {
  const m = texto.match(re);
  assert.ok(!m, `${mensaje} — calzó: «${m && m[0].replace(/\s+/g, ' ').slice(0, 160)}»`);
}

test('🔴 V1 calcular_cotizacion NO manda llamar listar_vidrios (se contradecía a sí misma)', () => {
  const d = getToolDef('calcular_cotizacion').function.description;
  noHay(d, /primero\s+llama\s+listar_vidrios/i, 'la descripción todavía manda llamar listar_vidrios primero');
  noHay(d, /pasa su glass_id/i, 'la descripción todavía manda pasar un glass_id');
  assert.match(d, /NO uses listar_vidrios/, 'la prohibición vigente se mantiene');
  assert.match(d, /SE ELIGEN SOLOS/);
});

test('🔴 V2 listar_vidrios es CONSULTA: no se usa «ANTES de cotizar» ni para obtener un glass_id', () => {
  const d = getToolDef('listar_vidrios').function.description;
  noHay(d, /ANTES de cotizar/i, 'listar_vidrios sigue mandándose usar antes de cotizar');
  noHay(d, /obtener el glass_id/i, 'listar_vidrios sigue vendiéndose como la fuente del glass_id');
  assert.match(d, /motor/i, 'debe decir que el vidrio lo elige el motor');
});

test('🔴 V3 calcular_por_area: el glass_id ya no es obligatorio ni «de listar_vidrios» (el motor lo elige)', () => {
  const def = getToolDef('calcular_por_area').function;
  assert.ok(!def.parameters.required.includes('glass_id'),
    'el handler lo reemplaza por un dummy y el precio sale de priceAllEngine: pedírselo al LLM lo obliga a llamar listar_vidrios');
  noHay(def.description, /glass_id es obligatorio/i, 'la descripción sigue dándolo por obligatorio');
  noHay(def.parameters.properties.glass_id.description, /de listar_vidrios/i, 'el campo sigue mandando a listar_vidrios');
  assert.match(def.parameters.properties.glass_id.description, /IGNORADO/);
  assert.ok(def.parameters.required.includes('area_m2'));
});

test('🔴 V4 el prompt no da por obligatorio un glass_id en calcular_por_area', () => {
  const sys = buildSystemBlocks();
  noHay(sys, /area_m2\s*\+\s*glass_id obligatorios/i, 'Área 6 todavía lo pide');
  noHay(sys, /calcular_por_area requiere area_m2 y glass_id/i, 'Operativas todavía lo pide');
  assert.match(sys, /calcular_por_area[^\n]*area_m2/, 'sigue explicando lo que sí necesita');
});

test('✅ V5 calcular_por_area cotiza SIN glass_id (el motor elige el vidrio)', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    bodies.push({ url: String(url), body });
    const payload = String(url).includes('calculate-by-area')
      ? { ok: true, derived_dimensions: { ancho_mm: 1500, alto_mm: 1000 } }
      : { ok: true, total_clp: 250000, producto_label: 'Corredera SLIDING H80 Doble Riel S75', serie: 'SLIDING' };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  try {
    const r = await runTool('calcular_por_area', { tipo: 'CORREDERA', area_m2: 1.5, descripcion_producto: 'ventana corredera' });
    assert.equal(r.ok, true, `debe cotizar sin glass_id: ${JSON.stringify(r)}`);
    const cotizacion = bodies.find((b) => b.url.endsWith('/api/quotes/calculate'));
    assert.ok(cotizacion, 'el precio sale de /api/quotes/calculate (priceAllEngine), no del endpoint por área');
    assert.equal(cotizacion.body.glass_id, 1607, '1,5 m² ⇒ 4+12+4 por la regla del motor');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
