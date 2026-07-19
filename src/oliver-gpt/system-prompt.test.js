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

test('[FIX 18-jun] referencial: el prompt obliga AVISAR cuando la medida es fuera de estándar (cotiza igual + se revisa tras aprobar)', () => {
  const sys = buildSystemBlocks();
  assert.ok(/REFERENCIAL/i.test(sys) && /referencial.*true|"referencial"/i.test(sys),
    'debe instruir el caso de cotización referencial (medida fuera de estándar)');
  assert.ok((/cubicaci[oó]n/i.test(sys) || /visita t[eé]cnica/i.test(sys)) && /aprob/i.test(sys),
    'debe decir que el precio final se confirma en cubicación/visita técnica tras aprobar');
});

test('[PRODUCTO FUERA DE ALCANCE] puerta no se mapea a apertura y T8 escala sin cotizar', () => {
  const sys = buildSystemBlocks();
  assert.doesNotMatch(sys, /["']puerta["']\s*(?:→|->)\s*PUERTA/i,
    'PUERTA no existe en el enum del Engine y no puede quedar como mapeo');
  assert.match(sys, /T8\s+Producto fuera de alcance/i);
  assert.match(sys, /8 TRIGGERS/i);
  for (const marcador of ['mosquiter', 'plegable', 'irregular', 'puerta', 'Andes', 'Zenia', 'Americana', 'Venau']) {
    assert.match(sys, new RegExp(marcador, 'i'), `falta ${marcador}`);
  }
  assert.match(sys, /Esto lo revisa Marcelo personalmente para darte el precio exacto/i);
  assert.match(sys, /REGLA #5[^]*producto fuera de alcance[^]*NO aplica/i);
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

// ── [2026-07-06] Dirección real de la fábrica en el prompt (caso "Avenida Alemania 0478" inventada) ──
test('[FIX 06-jul] dirección: el prompt trae la dirección REAL y prohíbe inventar otra', () => {
  const sys = buildSystemBlocks();
  assert.ok(sys.includes('Luis Durand 03619'),
    'el prompt debe contener la dirección NAP real de la fábrica (Av. Luis Durand 03619, Temuco)');
  assert.ok(/NUNCA invente otra calle|NUNCA invente otra direcci/i.test(sys),
    'el prompt debe prohibir explícitamente inventar direcciones de la empresa');
  assert.ok(!sys.includes('Avenida Alemania'),
    'la dirección alucinada del incidente no puede estar en el prompt');
});

// ── [2026-07-07] Correo de contacto real en el prompt (agregado por el dueño, anti-invención) ──
test('[FIX 07-jul] correo: el prompt trae el correo REAL y prohíbe inventar otro', () => {
  const sys = buildSystemBlocks();
  assert.ok(sys.includes('mcifuentes@activaspa.cl'),
    'el prompt debe contener el correo real de contacto');
  assert.ok(/NUNCA invente otra\s+dirección de correo/i.test(sys),
    'el prompt debe prohibir inventar otro correo');
});

// ── [2026-07-07] Link corto de agenda (WhatsApp partía la URL de Bookings por el '@') ──
test('[FIX 07-jul] agenda: el prompt entrega el link CORTO, nunca la URL larga de Bookings', () => {
  const sys = buildSystemBlocks();
  assert.ok(sys.includes('ops.activalabs.ai/agenda'),
    'el prompt debe entregar el link corto de agenda (clickeable en WhatsApp)');
  assert.ok(!sys.includes('bookwithme'),
    'la URL larga de Bookings (con @ que WhatsApp parte) no puede volver al prompt');
});
