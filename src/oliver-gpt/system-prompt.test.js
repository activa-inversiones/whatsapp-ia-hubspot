// src/oliver-gpt/system-prompt.test.js
// Runner nativo: node --test src/oliver-gpt/system-prompt.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemBlocks, buildSessionContext } from './system-prompt.js';

const VOSEO_RE = /\b(sos|tenés|podés|querés|usá|avanzá|fijate|dale que)\b/i;

test('(a) buildSystemBlocks() NO contiene voseo', () => {
  const sys = buildSystemBlocks();
  const m = sys.match(new RegExp(VOSEO_RE, 'gi')) || [];
  assert.equal(
    m.length,
    0,
    `El system prompt contiene voseo prohibido: ${JSON.stringify(m)}`,
  );
});

test('[FIX 18-jun] siempre-PDF: obliga PDF en el mismo turno y NO permite precio verbal suelto', () => {
  const sys = buildSystemBlocks();
  assert.ok(/EN EL MISMO TURNO/i.test(sys) && /NUNCA PRECIO SUELTO/i.test(sys),
    'el prompt debe obligar generar el PDF en el mismo turno al cotizar (no dar precio suelto en texto)');
  assert.ok(!/puede dar un RANGO VERBAL estimado/i.test(sys),
    'NO debe quedar el permiso viejo de "rango verbal estimado" (era la causa del patrón informal)');
});

test('(b) buildSystemBlocks() contiene marcadores de áreas clave', () => {
  const sys = buildSystemBlocks();
  for (const marker of ['SPIN', 'B2B', 'MINVU', 'EN 12608', 'objeci', 'escal']) {
    assert.ok(
      sys.includes(marker),
      `Falta el marcador "${marker}" en el system prompt`,
    );
  }
});

test('(b2) buildSystemBlocks() incorpora el playbook real (técnica + objeciones AECR)', () => {
  const sys = buildSystemBlocks();
  // Conceptos técnicos reales de personality.md (descubrimiento dolor → vidrio).
  for (const marker of ['Low-E', 'control solar', 'laminado', 'asimétrico', 'CNC']) {
    assert.ok(
      sys.includes(marker),
      `Falta el concepto técnico real "${marker}" del playbook`,
    );
  }
  // Manejo de objeciones AECR con guion real.
  assert.ok(sys.includes('AECR'), 'Falta el loop AECR de manejo de objeciones');
  assert.ok(
    /Es muy caro|El aluminio es más barato/.test(sys),
    'Falta al menos un guion real de objeción',
  );
});

test('(b3) buildSystemBlocks() incluye tabla/lógica B2C vs B2B 50/50', () => {
  const sys = buildSystemBlocks();
  assert.ok(/B2C/.test(sys) && /B2B/.test(sys), 'Falta la segmentación B2C/B2B');
  assert.ok(/50\/50|50%/.test(sys), 'Falta la lógica 50/50 de B2C vs B2B');
});

test('(b4) buildSystemBlocks() incluye el framework de 7 pasos', () => {
  const sys = buildSystemBlocks();
  assert.ok(
    /7 PASOS|7 pasos/.test(sys),
    'Falta el framework Descubrimiento → Cotización de 7 pasos',
  );
});

test('(b5) buildSystemBlocks() incluye garantías reales (10 años perfiles)', () => {
  const sys = buildSystemBlocks();
  assert.ok(
    /10 años/.test(sys),
    'Falta la garantía de 10 años de perfiles WinHouse',
  );
});

test('(c) buildSessionContext({comuna:"Pucón"}) incluye "Pucón"', () => {
  const ctx = buildSessionContext({ comuna: 'Pucón' });
  assert.ok(ctx.includes('Pucón'), 'El contexto de sesión no incluye la comuna');
});

test('(d) ambas son funciones que devuelven string no vacío', () => {
  assert.equal(typeof buildSystemBlocks, 'function');
  assert.equal(typeof buildSessionContext, 'function');

  const sys = buildSystemBlocks();
  assert.equal(typeof sys, 'string');
  assert.ok(sys.trim().length > 0, 'buildSystemBlocks() devolvió string vacío');

  const ctx = buildSessionContext({});
  assert.equal(typeof ctx, 'string');
  assert.ok(ctx.trim().length > 0, 'buildSessionContext() devolvió string vacío');

  // También debe ser robusto sin argumento.
  const ctx2 = buildSessionContext();
  assert.equal(typeof ctx2, 'string');
  assert.ok(ctx2.trim().length > 0);
});
