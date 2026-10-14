// [2026-10-14 · #1522] Guardias del borrador 70a138c1 (Oliver interno, lista de 15 renglones del dueño).
// Lo que pasó, medido en la BD viva:
//  (1) la corredera de 2 hojas 2560×2390 salió «3 hojas, laterales fijas»: el cotizador leyó la NOTA ENTERA
//      (donde otra línea decía «3 hojas, laterales fijas») como si fuera el texto de esa sola ventana;
//  (2) la palabra «corredera» de otras líneas le puso avisos de corredera a fijos y proyectantes;
//  (3) el fijo 400×2500 salió 2500×400 (la regla de WhatsApp «alto > 2400 ⇒ la lista vino al revés»);
//  (4) 18 llamadas para 15 renglones: la 2560×2390 tres veces y el fijo 2500×400 dos, agregadas AL FINAL.
// Dueño, textual: «me da error en varias … al parecer no sé por qué desordena lo que le envío».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerYCotizar } from './oliverInternoLector.js';
import { textoDeEstaVentana } from '../src/oliver-gpt/tools.js';

const NOTA = [
  '6 × Proyectante S60 560×1780 mm NEWBLACK · Termopanel 4+12+4',
  '2 × Fijo S60 400x2500 mm NEWBLACK · Termopanel 4+12+4',
  '1 × Corredera SLIDING H98 Doble Riel S75 2 hojas,  2560×2390 mm NEWBLACK · Termopanel 5+12+5',
  '6 × Corredera SLIDING H80 Doble Riel S75 3 hojas, laterales fijas 4000×400 mm NEWBLACK · Termopanel 5+12+5',
].join('\n');

test('🔴 (1)(2) cada ventana ve SOLO su renglón de la lista, no el de las otras', () => {
  const t = textoDeEstaVentana(NOTA, { medidas_texto: '2560×2390 mm' });
  assert.match(t, /2 hojas/);
  assert.doesNotMatch(t, /laterales fijas/, 'el «laterales fijas» es de OTRA ventana');
  assert.doesNotMatch(t, /3 hojas/);
  const f = textoDeEstaVentana(NOTA, { medidas_texto: '400x2500 mm' });
  assert.doesNotMatch(f, /corredera/i, 'al fijo no le llega la palabra corredera de otras líneas');
});

test('🔒 con UNA sola medida en el texto, va entero como siempre (el WhatsApp de una ventana no cambia)', () => {
  const uno = 'hola, necesito una corredera 3 hojas con la del medio fija, 2710x1995, nogal';
  assert.equal(textoDeEstaVentana(uno, { medidas_texto: '2710x1995' }), uno);
});

test('🔒 los renglones SIN medidas (contexto general) se conservan para todas', () => {
  const t = textoDeEstaVentana(`medidas ancho x alto\n${NOTA}`, { medidas_texto: '560×1780 mm' });
  assert.match(t, /ancho x alto/);
  assert.match(t, /560×1780/);
  assert.doesNotMatch(t, /4000×400/);
});

// ── (3) y (4): el lector interno ───────────────────────────────────────────────────────────────
function motorFalso(llamadas) {
  let pasada = 0;
  return {
    async orchestratorPass1() {
      pasada += 1;
      if (pasada > 1) return { tool_calls: [], content: '', raw: {} };
      return { content: null, raw: {}, tool_calls: llamadas.map((c, i) => ({ id: `call_${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input || {}) } })) };
    },
    async orchestratorPass2() { return ''; },
  };
}
function ejecutorFalso() {
  const pedidos = [];
  const runTool = async (name, input, ctx) => {
    pedidos.push({ name, input, ctx });
    return { ok: true, unit_price: 1000, cantidad: input.cantidad || 1, producto_label: input.descripcion_producto, measures: input.medidas_texto };
  };
  return { runTool, pedidos };
}
const L = (desc, medidas, cantidad) => ({ name: 'calcular_cotizacion', input: { tipo: 'FIJA', descripcion_producto: desc, medidas_texto: medidas, cantidad } });
const PROY = 'Proyectante S60 560×1780 mm NEWBLACK';
const FIJO = 'Fijo S60 400x2500 mm NEWBLACK';
const CORR = 'Corredera SLIDING H98 Doble Riel S75 2 hojas,  2560×2390 mm NEWBLACK';
const LAT = 'Corredera SLIDING H80 Doble Riel S75 3 hojas, laterales fijas 4000×400 mm NEWBLACK';

test('🔴 (3) el lector interno marca la orientación como confiable (el vendedor escribe ancho × alto)', async () => {
  const { runTool, pedidos } = ejecutorFalso();
  await leerYCotizar({ texto: NOTA, comuna: 'Vilcún', color: 'NEGRO', deps: { engine: motorFalso([L(FIJO, '400x2500 mm', 2)]), runTool } });
  assert.equal(pedidos[0].ctx.orientacionConfiable, true);
});

test('🔴 (4) los REINTENTOS de más se descartan y la línea queda en SU lugar (el caso real: 3 veces la 2560×2390)', async () => {
  const { runTool } = ejecutorFalso();
  const engine = motorFalso([L(PROY, '560×1780 mm', 6), L(FIJO, '400x2500 mm', 2), L(CORR, '2560×2390 mm', 1),
    L(LAT, '4000×400 mm', 6), L(CORR, '2560×2390 mm', 1), L(FIJO, '400x2500 mm', 2), L(CORR, '2560×2390 mm', 1)]);
  const out = await leerYCotizar({ texto: NOTA, comuna: 'Vilcún', color: 'NEGRO', deps: { engine, runTool } });
  assert.deepEqual(out.lineas.map((l) => l.pedido.descripcion_producto), [PROY, FIJO, CORR, LAT], 'el orden es el de la nota');
  assert.equal(out.reintentos_descartados, 3);
});

test('🔒 (4) «2 ×» partido en dos llamadas de 1 son DOS unidades: no se descarta nada', async () => {
  const { runTool } = ejecutorFalso();
  const engine = motorFalso([L(FIJO, '400x2500 mm', 1), L(FIJO, '400x2500 mm', 1)]);
  const out = await leerYCotizar({ texto: NOTA, comuna: 'Vilcún', color: 'NEGRO', deps: { engine, runTool } });
  assert.equal(out.lineas.length, 2);
  assert.equal(out.reintentos_descartados, 0);
});

test('🔒 (4) una descripción que no está en la nota no se puede contar: se conserva', async () => {
  const { runTool } = ejecutorFalso();
  const engine = motorFalso([L('algo que el LLM inventó', '1000x1000', 1), L('algo que el LLM inventó', '1000x1000', 1)]);
  const out = await leerYCotizar({ texto: NOTA, comuna: 'Vilcún', color: 'NEGRO', deps: { engine, runTool } });
  assert.equal(out.lineas.length, 2);
});

test('🔴 [#1522] la corredera 6200×3000 (Winart v72556) ya no se devuelve como «medida dudosa»', async () => {
  const { resolverMedidasMm } = await import('../src/oliver-gpt/tools.js');
  const r = resolverMedidasMm({ ancho_mm: 6200, alto_mm: 3000, medidas_texto: '6200×3000 mm' });
  assert.equal(r.ok, true);
  assert.equal(r.ancho_mm, 6200);
  // El tope sigue cazando un error de unidad grosero.
  assert.equal(resolverMedidasMm({ ancho_mm: 62000, alto_mm: 3000, medidas_texto: '62000×3000 mm' }).ok, false);
});

test('🔴 [#1522] un FIJO grande se cotiza (decide el motor); una ventana que abre igual de grande sigue frenada', async () => {
  const { validateDimensionsLocal } = await import('./enginePricer.js');
  // La lista del dueño, borrador 84aa783e: estos dos se caían con «excede todos los límites».
  assert.equal(validateDimensionsLocal('Fijo S60 1500×2340 mm NEWBLACK', 1500, 2340), null);
  assert.equal(validateDimensionsLocal('Fijo S60 400x2500 mm NEWBLACK', 400, 2500), null);
  assert.equal(validateDimensionsLocal('Proyectante S60', 1500, 2340)?.escalate, true, 'la proyectante tiene tope real');
});

// ── [Codex post-despliegue 14-oct] guardias de la ronda que se hizo sobre lo ya desplegado ─────────────
test('🔴 [P0] dos renglones DISTINTOS que el LLM normaliza igual siguen siendo DOS ventanas (no se descarta ninguna)', async () => {
  const { runTool } = ejecutorFalso();
  const nota = '1 x Ventana fija S60 1000x1000\n1 x Fijo S60 1000x1000';
  const engine = motorFalso([L('Fijo S60 1000x1000', '1000x1000', 1), L('Fijo S60 1000x1000', '1000x1000', 1)]);
  const out = await leerYCotizar({ texto: nota, comuna: 'Vilcún', color: 'NEGRO', deps: { engine, runTool } });
  assert.equal(out.lineas.length, 2);
  assert.equal(out.reintentos_descartados, 0);
});

test('🔒 [P0] el descarte nunca deja menos unidades que la nota (2 × X + 1 × X con dos intentos de 2)', async () => {
  const { runTool } = ejecutorFalso();
  const nota = '2 x Fijo S60 1000x1000\n1 x Fijo S60 1000x1000';
  const engine = motorFalso([L('Fijo S60 1000x1000', '1000x1000', 2), L('Fijo S60 1000x1000', '1000x1000', 2)]);
  const out = await leerYCotizar({ texto: nota, comuna: 'Vilcún', color: 'NEGRO', deps: { engine, runTool } });
  const u = out.lineas.reduce((s, l) => s + Number(l.pedido.cantidad), 0);
  assert.ok(u >= 3, `quedaron ${u} unidades para una nota de 3`);
});

test('🔴 [P0] WhatsApp junta burbujas con DOS espacios: la frase general de otra burbuja se conserva', () => {
  const t = textoDeEstaVentana('todas en 3 hojas  Corredera 1000x800\nCorredera 2000x1500', { medidas_texto: '2000x1500' });
  assert.match(t, /todas en 3 hojas/);
  assert.match(t, /2000x1500/);
  assert.doesNotMatch(t, /1000x800/);
});

test('🔴 [P0] una medida CUADRADA no se borra a sí misma; metros con coma y bow de 3 cifras se reconocen', () => {
  assert.match(textoDeEstaVentana('Fijo 2000x2000\nFijo 1000x1000', { medidas_texto: '2000x2000' }), /2000x2000/);
  const m = textoDeEstaVentana('corredera 2 hojas 2,5x1,2\ncorredera 3 hojas, laterales fijas 4000x400', { medidas_texto: '2,5x1,2' });
  assert.doesNotMatch(m, /laterales fijas/);
  const b = textoDeEstaVentana('bow 2500x1500x500 con proyectantes\nbow 2500x1500x700 fijo', { medidas_texto: '2500x1500x700' });
  assert.match(b, /x700 fijo/);
  assert.doesNotMatch(b, /con proyectantes/);
});

test('🔒 [P0] si no reconoce SU renglón, va el texto entero (como antes), nunca vacío', () => {
  const t = 'Fijo 2000x1500\nFijo 1000x1000';
  assert.equal(textoDeEstaVentana(t, { medidas_texto: '777x777' }), t);
});

test('🔴 [P1] PROYECTANTE + FIJA iguales en horizontal NO es el default (abre del otro lado): viaja', async () => {
  const { partesParaMotor } = await import('../src/oliver-gpt/tools.js');
  const inv = [{ tipo: 'PROYECTANTE', ancho_mm: 1000 }, { tipo: 'FIJA', ancho_mm: 1000 }];
  assert.deepEqual(partesParaMotor(inv, 'horizontal'), inv);
  assert.equal(partesParaMotor(inv, 'vertical'), undefined, 'en vertical ESE es el default (abre arriba)');
  assert.equal(partesParaMotor([{ tipo: 'FIJA', ancho_mm: 1000 }, { tipo: 'PROYECTANTE', ancho_mm: 1000 }]), undefined);
});

test('🔒 [P3] hojas_fijas [2] (dato corrupto) NO pinta laterales fijas', async () => {
  const { planoDeVentana } = await import('./dibujoVentana.js');
  const p = planoDeVentana({ measures: '4000x400mm', producto_label: 'Corredera SLIDING H80 Doble Riel S75 3 hojas', hojas_fijas: [2] }, { x: 0, y: 0, w: 400, h: 300 });
  assert.equal(p.hojas.filter((h) => h.fijaEnSitio).length, 0);
});
