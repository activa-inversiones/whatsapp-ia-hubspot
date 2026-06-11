// oliverOutOfCatalog.test.js — RED ANTI-REGRESIÓN Oliver — GT-05
// (fuera de catálogo → retención, NO deriva a competencia)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectOutOfCatalog, outOfCatalogRetentionMessage } from './oliverOutOfCatalog.js';

// ── GT-05: el caso reportado ────────────────────────────────────────────────
test('GT-05: "vidrio para el shower" → detectado como fuera de catálogo', () => {
  const r = detectOutOfCatalog('vidrio para el shower');
  assert.equal(r.outOfCatalog, true, 'debe detectar pedido fuera de catálogo');
  assert.ok(r.matched, 'debe indicar qué término coincidió');
});

test('GT-05: mensaje de retención NO menciona "proveedor especializado"', () => {
  const msg = outOfCatalogRetentionMessage();
  assert.doesNotMatch(
    msg,
    /proveedor\s+especializado/i,
    'NO debe sugerir "proveedor especializado" (deriva a competencia)'
  );
});

test('GT-05: mensaje de retención SÍ ofrece alternativa Activa (ventanas / mamparas)', () => {
  const msg = outOfCatalogRetentionMessage();
  assert.match(
    msg,
    /ventana|mampara|terraza|pvc|termopanel/i,
    'debe ofrecer algo de lo que Activa SÍ fabrica'
  );
});

// ── Variantes de shower/ducha ───────────────────────────────────────────────
test('detecta variantes: ducha, espejo, vidrio suelto, mampara de ducha', () => {
  const casos = [
    'quiero vidrio para la ducha',
    'necesito un espejo para el baño',
    'busco vidrio suelto cortado a medida',
    'mampara de ducha 800x1800',
    'cancela de ducha transparente',
    'vidrio de baño templado',
    'placa de vidrio 60x90',
    'cristal suelto 60x80 para el baño',
  ];
  for (const t of casos) {
    const r = detectOutOfCatalog(t);
    assert.equal(r.outOfCatalog, true, `"${t}" debe detectarse como fuera de catálogo`);
  }
});

// ── G10 (2026-06-11, decisión del dueño): biombo / separador NO se fabrica ──
test('G10: "biombo" y "separador de ambiente" → fuera de catálogo (caso 096cd370)', () => {
  for (const t of ['quiero cotizar un biombo', 'necesito un separador de ambiente', 'hacen biombos?', 'un panel separador para la oficina']) {
    const r = detectOutOfCatalog(t);
    assert.equal(r.outOfCatalog, true, `"${t}" debe detectarse fuera de catálogo (no fabricamos biombo)`);
  }
});

test('G10: el mensaje generalizado ya NO dice "ese tipo de vidrio" (sirve para biombo)', () => {
  const msg = outOfCatalogRetentionMessage('Ana');
  assert.doesNotMatch(msg, /ese tipo de vidrio/i, 'el mensaje no debe hardcodear "vidrio" (no calza con biombo)');
  assert.match(msg, /no lo fabricamos/i, 'debe decir honestamente que no se fabrica');
  assert.match(msg, /ventana|mampara/i, 'debe reconducir a lo que Activa sí hace');
});

test('lámina de vidrio con contexto de rotura → mención de paso (quiere repararla, no comprarla)', () => {
  // "rota" es contexto de paso: el cliente describe lo que tiene roto, probablemente quiere ventanas PVC
  const r = detectOutOfCatalog('una lámina de vidrio para la ventana rota');
  assert.equal(r.passing, true, 'debe marcarse como mención de paso');
  assert.equal(r.outOfCatalog, false, 'NO debe interceptarse — dejar fluir a cotizar PVC');
});

// ── Productos de Activa NO deben interceptarse ──────────────────────────────
test('productos del catálogo Activa NO se detectan como fuera de catálogo', () => {
  const catalogo = [
    'ventana pvc corredera 1200x1000',
    'puerta pvc línea europea blanco',
    'quiero 3 ventanas termopanel',
    'cierre de terraza con tejido',
    'mampara templada para terraza',   // este lo captura oliverProduct, no este módulo
    'ventanas de aluminio para la casa',
  ];
  for (const t of catalogo) {
    const r = detectOutOfCatalog(t);
    assert.equal(r.outOfCatalog, false, `"${t}" NO debe interceptarse (es catálogo Activa o lo maneja otro módulo)`);
  }
});

// ── Mención de paso: el cliente habla de lo viejo, no de pedir eso ──────────
test('mención de paso NO intercepta (el cliente quiere ventanas, no un espejo)', () => {
  const menciones = [
    'tengo un espejo roto y necesito ventanas nuevas',
    'quiero sacar el vidrio viejo y poner pvc',
    'retiro de vidrio suelto antiguo',
  ];
  for (const t of menciones) {
    const r = detectOutOfCatalog(t);
    assert.equal(r.outOfCatalog, false, `"${t}" es mención de paso → NO interceptar`);
    assert.equal(r.passing, true, `"${t}" debe marcarse como mención de paso`);
  }
});

// ── Mensaje con nombre ───────────────────────────────────────────────────────
test('el mensaje de retención incluye el nombre del cliente si se proporciona', () => {
  const msg = outOfCatalogRetentionMessage('Carmen');
  assert.match(msg, /Carmen/, 'debe incluir el nombre del cliente');
});

// ── El mensaje NO usa la palabra "competencia" ni derivación ─────────────────
test('el mensaje de retención NO menciona competidores ni "especializado"', () => {
  const msg = outOfCatalogRetentionMessage('Luis');
  assert.doesNotMatch(msg, /contact[ae].*proveedor|busqu[eé].*proveedor|vidrier[oí]a|cristaler[oí]a|ferretera/i,
    'NO debe derivar a ningún competidor o especialista externo');
});
