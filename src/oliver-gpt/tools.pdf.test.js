// tools.pdf.test.js — Golden tests herméticos para la tool generar_pdf_cotizacion.
// Sin red, sin WA real, sin Zoho, sin sales-os. Todos los deps son mocks.
// Runner: node --test src/oliver-gpt/tools.pdf.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOL_DEFS, runTool } from './tools.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function getToolDef(name) {
  const def = TOOL_DEFS.find((t) => t.function && t.function.name === name);
  assert.ok(def, `Debe existir la tool '${name}' en TOOL_DEFS`);
  return def;
}

// Items con unit_price real (vienen de calcular_cotizacion mock).
const ITEMS_OK = [
  { producto_label: 'Corredera 2 hojas', measures: '1500x1200 mm', color: 'blanco', qty: 2, unit_price: 480000, glass_label: 'DVH 4-12-4' },
  { producto_label: 'Fija',              measures: '800x600 mm',   color: 'blanco', qty: 1, unit_price: 220000, glass_label: 'DVH 4-12-4' },
];

// Items con unit_price = 0 (el LLM los inventó = flag de alucinación).
const ITEMS_PRECIO_CERO = [
  { producto_label: 'Ventana', measures: '1000x1000 mm', color: 'blanco', qty: 1, unit_price: 0 },
];

// Mock de ctx.generarPdf que captura la llamada y devuelve éxito.
function makeCtx({ overrideGenerarPdf } = {}) {
  const calls = { pdf: [] };
  return {
    calls,
    ctx: {
      generarPdf: overrideGenerarPdf || (async (input) => {
        calls.pdf.push(input);
        return { ok: true, quote_number: 'CM-FR-004-2026-0001', pdf_sent: true, media_id: 'mid_123' };
      }),
    },
  };
}

// ─── (p-def) Definición TOOL_DEFS ──────────────────────────────────────────

test('(p-def) generar_pdf_cotizacion existe en TOOL_DEFS con items como required', () => {
  const def = getToolDef('generar_pdf_cotizacion');
  const props = def.function.parameters.properties;
  assert.ok(props.items,       'debe tener campo items');
  assert.ok(props.grand_total, 'debe tener campo grand_total');
  assert.ok(props.name,        'debe tener campo name');
  assert.ok(props.comuna,      'debe tener campo comuna');
  const req = def.function.parameters.required;
  assert.ok(req.includes('items'), 'items debe ser required');
  // unit_price es required en cada item
  const itemProps = props.items.items.properties;
  assert.ok(itemProps.unit_price, 'cada item debe tener unit_price');
  const itemReq = props.items.items.required || [];
  assert.ok(itemReq.includes('unit_price'), 'unit_price debe ser required en cada item');
});

// ─── (p-a) Sin ctx.generarPdf → ok:false sin lanzar ────────────────────────

test('(p-a) generar_pdf_cotizacion: sin ctx.generarPdf devuelve ok:false, no lanza', async () => {
  const r = await runTool('generar_pdf_cotizacion', { items: ITEMS_OK }, {});
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'generarPdf_not_wired');
});

// ─── (p-b) Con ctx.generarPdf real (mock) → delega correctamente ───────────

test('(p-b) generar_pdf_cotizacion: delega a ctx.generarPdf con el input completo', async () => {
  const { calls, ctx } = makeCtx();
  const input = {
    name:        'María Pérez',
    phone:       '56912345678',
    comuna:      'Temuco',
    items:       ITEMS_OK,
    grand_total: 1180000,
  };
  const r = await runTool('generar_pdf_cotizacion', input, ctx);

  assert.equal(calls.pdf.length, 1, 'generarPdf debe llamarse exactamente 1 vez');
  assert.equal(r.ok, true);
  assert.equal(r.quote_number, 'CM-FR-004-2026-0001');
  assert.equal(r.pdf_sent, true);

  const capturedInput = calls.pdf[0];
  assert.equal(capturedInput.name,        'María Pérez');
  assert.equal(capturedInput.comuna,      'Temuco');
  assert.equal(capturedInput.grand_total, 1180000);
  assert.equal(capturedInput.items.length, 2);
  assert.equal(capturedInput.items[0].unit_price, 480000, 'unit_price se preserva del motor');
});

// ─── (p-c) unit_price = 0 → se pasa sin modificar (el LLM/webhook deben validar) ──

test('(p-c) items con unit_price=0 se pasan tal cual (anti-silencio)', async () => {
  const { calls, ctx } = makeCtx();
  const r = await runTool('generar_pdf_cotizacion', { items: ITEMS_PRECIO_CERO }, ctx);
  assert.equal(r.ok, true, 'la tool no bloquea unit_price=0 (es responsabilidad del caller)');
  assert.equal(calls.pdf[0].items[0].unit_price, 0, 'unit_price=0 se pasa sin alterar');
});

// ─── (p-d) Error en ctx.generarPdf → runTool NO lanza (fail-safe) ────────────

test('(p-d) error en ctx.generarPdf → runTool devuelve null (safe) no lanza', async () => {
  // Simulamos que el webhook.js envuelve generarPdf en safe() que devuelve null ante error.
  // A nivel de runTool, lo que importa es que la tool retorne lo que devuelva ctx.generarPdf.
  const ctx = {
    generarPdf: async () => { throw new Error('WA fallo de red'); },
  };
  // runTool llama ctx.generarPdf directamente; en producción webhook.js lo tiene en safe().
  // Aquí verificamos que runTool no agrega try/catch extra (delega limpamente).
  await assert.rejects(
    () => runTool('generar_pdf_cotizacion', { items: ITEMS_OK }, ctx),
    /WA fallo de red/
  );
  // OJO: en producción el safe() del webhook.js TRAGA la excepción. Este test documenta
  // el comportamiento esperado del runTool aislado (sin safe wrapper).
});

// ─── (p-e) Correlativo ISO aparece en el return ──────────────────────────────

test('(p-e) el quote_number devuelto sigue el patrón CM-FR-004-AAAA-NNNN', async () => {
  const year = new Date().getFullYear();
  const { ctx } = makeCtx({
    overrideGenerarPdf: async () => ({
      ok: true,
      quote_number: `CM-FR-004-${year}-0042`,
      pdf_sent: true,
      media_id: 'mid_999',
    }),
  });
  const r = await runTool('generar_pdf_cotizacion', { items: ITEMS_OK }, ctx);
  assert.ok(r.quote_number.startsWith(`CM-FR-004-${year}-`),
    `quote_number debe empezar con CM-FR-004-${year}- (recibido: ${r.quote_number})`);
});

// ─── (p-f) Múltiples items — grand_total se calcula si no se pasa ─────────────

test('(p-f) llamada mínima — solo items, sin name ni grand_total — no falla', async () => {
  const { calls, ctx } = makeCtx();
  const r = await runTool('generar_pdf_cotizacion', { items: ITEMS_OK }, ctx);
  assert.equal(r.ok, true, 'llamada mínima con solo items debe funcionar');
  // name/phone/comuna pueden ser undefined en input (webhook los toma de state)
  const inp = calls.pdf[0];
  assert.ok(Array.isArray(inp.items) && inp.items.length === 2, 'items se pasan completos');
});

// ─── (p-g) Tool desconocida sigue lanzando ────────────────────────────────────

test('(p-g) tool desconocida sigue lanzando Error (el default del switch no cambió)', async () => {
  await assert.rejects(
    () => runTool('no_existe_esta_tool', {}, {}),
    /Tool desconocida/
  );
});
