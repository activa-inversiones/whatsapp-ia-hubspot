// src/oliver-gpt/posponer-seguimiento.test.js — [2026-07-07 ZL-F2] Motor Zero-Leaks.
// Tests de la tool posponer_seguimiento: schema en TOOL_DEFS + runTool llama al
// freeze de sales-os (contrato F1) con fetch mockeado (sin red real).
// Runner nativo: node --test src/oliver-gpt/posponer-seguimiento.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_DEFS, runTool, posponerSeguimiento } from './tools.js';

function getToolDef(name) {
  const def = TOOL_DEFS.find((t) => t.function && t.function.name === name);
  assert.ok(def, `Debe existir la tool '${name}' en TOOL_DEFS`);
  return def;
}

// ── (a) Schema válido en TOOL_DEFS ──────────────────────────────────────────
test('(a) posponer_seguimiento: existe en TOOL_DEFS con params dias+motivo obligatorios', () => {
  const def = getToolDef('posponer_seguimiento');
  const props = def.function.parameters.properties;
  assert.ok(props.dias, 'debe declarar el parámetro dias');
  assert.ok(props.motivo, 'debe declarar el parámetro motivo');
  assert.deepEqual(
    [...def.function.parameters.required].sort(),
    ['dias', 'motivo'],
    'dias y motivo deben ser obligatorios'
  );
  assert.equal(def.function.parameters.additionalProperties, false);
});

// ── (b) runTool sin ctx.telefono → ok:false, no explota ─────────────────────
test('(b) runTool(posponer_seguimiento) sin ctx.telefono devuelve ok:false sin lanzar', async () => {
  const result = await runTool('posponer_seguimiento', { dias: 30, motivo: 'el próximo mes' }, {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'telefono_not_wired');
});

// ── (c) runTool con ctx.telefono → delega a posponerSeguimiento con el phone correcto ──
test('(c) runTool(posponer_seguimiento) con ctx.telefono llama al freeze con ese phone', async () => {
  const origFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return {
      ok: true,
      json: async () => ({ ok: true }),
    };
  };
  const origEnvUrl = process.env.SALES_OS_URL;
  const origEnvTok = process.env.SALES_OS_OPERATOR_TOKEN;
  process.env.SALES_OS_URL = 'https://sales-os.test';
  process.env.SALES_OS_OPERATOR_TOKEN = 'tok123';

  try {
    const result = await runTool(
      'posponer_seguimiento',
      { dias: 15, motivo: 'aún no decide' },
      { telefono: '56912345678' }
    );
    assert.equal(result.ok, true);
    assert.ok(calls.some((c) => c.url.includes('/internal/ttl/freeze')), 'debe llamar al endpoint de freeze (contrato F1)');
    const freezeCall = calls.find((c) => c.url.includes('/internal/ttl/freeze'));
    const body = JSON.parse(freezeCall.opts.body);
    assert.equal(body.phone, '56912345678');
    assert.equal(body.dias, 15);
    assert.equal(freezeCall.opts.headers['x-api-key'], 'tok123');
  } finally {
    global.fetch = origFetch;
    process.env.SALES_OS_URL = origEnvUrl;
    process.env.SALES_OS_OPERATOR_TOKEN = origEnvTok;
  }
});

// ── (d) posponerSeguimiento: clamp de días 1-60 ──────────────────────────────
test('(d) posponerSeguimiento clampa dias fuera de rango [1,60] y usa default 7 si viene 0/NaN', async () => {
  const origFetch = global.fetch;
  const bodies = [];
  global.fetch = async (url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const origEnvUrl = process.env.SALES_OS_URL;
  const origEnvTok = process.env.SALES_OS_OPERATOR_TOKEN;
  process.env.SALES_OS_URL = 'https://sales-os.test';
  process.env.SALES_OS_OPERATOR_TOKEN = 'tok123';

  try {
    await posponerSeguimiento({ phone: '56911111111', dias: 999, motivo: 'x' });
    await posponerSeguimiento({ phone: '56911111111', dias: 0, motivo: 'x' });
    await posponerSeguimiento({ phone: '56911111111', dias: -5, motivo: 'x' });

    // primer body (freeze) de cada llamada: índices 0,2,4 (freeze,agenda,freeze,agenda,...)
    const freezeBodies = bodies.filter((_, i) => i % 2 === 0);
    assert.equal(freezeBodies[0].dias, 60, '999 días se clampa a 60');
    assert.equal(freezeBodies[1].dias, 7, '0 días usa default 7');
    assert.equal(freezeBodies[2].dias, 7, 'negativo usa default 7 (clamp a mínimo 1 no aplica por ser falsy)');
  } finally {
    global.fetch = origFetch;
    process.env.SALES_OS_URL = origEnvUrl;
    process.env.SALES_OS_OPERATOR_TOKEN = origEnvTok;
  }
});

// ── (e) sin SALES_OS_URL/TOKEN configurados → ok:false, no lanza ────────────
test('(e) posponerSeguimiento sin sales-os configurado devuelve ok:false sin red', async () => {
  const origEnvUrl = process.env.SALES_OS_URL;
  const origEnvTok = process.env.SALES_OS_OPERATOR_TOKEN;
  process.env.SALES_OS_URL = '';
  process.env.SALES_OS_OPERATOR_TOKEN = '';
  try {
    const result = await posponerSeguimiento({ phone: '56912345678', dias: 10, motivo: 'x' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'sales_os_no_configurado');
  } finally {
    process.env.SALES_OS_URL = origEnvUrl;
    process.env.SALES_OS_OPERATOR_TOKEN = origEnvTok;
  }
});

// ── (f) sin phone → ok:false ─────────────────────────────────────────────────
test('(f) posponerSeguimiento sin phone devuelve ok:false phone_requerido', async () => {
  const result = await posponerSeguimiento({ dias: 10, motivo: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'phone_requerido');
});
