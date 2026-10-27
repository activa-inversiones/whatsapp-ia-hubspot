// formas1600.test.js — [2026-10-27]
//
// 🪟 LAS TRES VENTANAS QUE OLIVER NO SABÍA COTIZAR (pedido del dueño, prioridad: «clientes reclaman»),
// del lado del BOT: que la apertura se reconozca, que la forma viaje al motor y que el PDF la dibuje.
// Las tres están dibujadas por el dueño en Winart (proyecto 61767, versión 73315):
//   1. puerta con poste T y paños machihembrados   2. compuesta con un paño partido arriba/abajo
//   3. fijo triangular 4500 × 1330 en dos paños
// El motor (sales-os quoteEngine.formas1600.test.mjs) defiende el BOM; esto defiende el CAMINO.

import test from 'node:test';
import assert from 'node:assert/strict';
import { detectarProductoFueraDeAlcance } from './productoFueraDeAlcance.js';
import { mapAperturaToEngine, aperturaFueExplicita, priceAllEngine, pickGlassId } from './enginePricer.js';
import { partesAnidadasParaMotor, partesParaMotor, errorPartesAnidadas } from '../src/oliver-gpt/tools.js';
import { APERTURAS } from '../src/oliver-gpt/engine-client.js';
import { planoDeVentana, tipoDe, panosPuertaDe } from './dibujoVentana.js';
import { formaParaReCotizar } from '../src/oliver-gpt/forma-item.js';

// ═══ 0. LA FORMA VUELVE AL MOTOR DESDE UN SOLO LUGAR (6 sitios de re-cotización la usan) ═══
test('🔴 formaParaReCotizar: puerta.panos → puerta_panos (alto útil como alto), triangular.divisiones → divisiones_triangulo', () => {
  assert.deepEqual(formaParaReCotizar({ puerta: { postes: 1, panos: [{ relleno: 'VIDRIO', alto_util_mm: 1000.5 }, { relleno: 'MACHIHEMBRADO', alto_util_mm: 680 }] } }),
    { puerta_panos: [{ relleno: 'VIDRIO', alto_mm: 1000.5 }, { relleno: 'MACHIHEMBRADO', alto_mm: 680 }] });
  assert.deepEqual(formaParaReCotizar({ triangular: { base_mm: 4500, alto_mm: 1330, divisiones: 2 } }), { divisiones_triangulo: 2 });
  assert.deepEqual(formaParaReCotizar({ producto_label: 'Ventana fija' }), {}, 'una ventana sin forma no agrega campos');
  assert.deepEqual(formaParaReCotizar(null), {});
  // [Codex r1 #5] un item viejo, guardado solo con su etiqueta, vuelve con su forma
  assert.deepEqual(formaParaReCotizar({ producto_label: 'Puerta abatible interior S60 · 2 paños (1 poste T): vidrio / machihembrado', measures: '1050x2000' }),
    { puerta_panos: [{ relleno: 'VIDRIO' }, { relleno: 'MACHIHEMBRADO' }] });
  assert.deepEqual(formaParaReCotizar({ producto_label: 'Fijo triangular S60 · base 4500 × alto 1330 mm, 2 paños' }), { divisiones_triangulo: 2 });
});

test('🔒 [Codex r1 #4] solo el FIJO triangular se cotiza: puerta o corredera «triangular» siguen escalando', () => {
  assert.equal(detectarProductoFueraDeAlcance('puerta triangular 1000x2000').categoria, 'forma_irregular');
  assert.equal(detectarProductoFueraDeAlcance('ventana triangular corredera 2000x1000').categoria, 'forma_irregular');
  assert.throws(() => mapAperturaToEngine('puerta triangular 1000x2000'));
  assert.equal(mapAperturaToEngine('reemplazar la ventana triangular por una puerta abatible 900x2000'), 'PUERTA');
});

test('🔒 [Codex r1 #2] una sola altura de las dos, o un paño compuesto sin tipos, se rechaza con el nombre del campo', () => {
  assert.match(errorPartesAnidadas([{ tipo: 'COMPUESTA', ancho_mm: 600, tipo_arriba: 'PROYECTANTE', tipo_abajo: 'FIJA', alto_arriba_mm: 1300 }]), /alto_arriba_mm y alto_abajo_mm/);
  assert.match(errorPartesAnidadas([{ tipo: 'COMPUESTA', ancho_mm: 600, tipo_arriba: 'PROYECTANTE' }]), /tipo_arriba y tipo_abajo/);
  assert.equal(errorPartesAnidadas([{ tipo: 'COMPUESTA', ancho_mm: 600, tipo_arriba: 'PROYECTANTE', tipo_abajo: 'FIJA' }]), null);
  assert.equal(errorPartesAnidadas([{ tipo: 'FIJA', ancho_mm: 600 }]), null);
});

// ═══ 1. TRIANGULAR: deja de escalar y se reconoce ═══
test('🔴 «ventana triangular» YA NO es forma irregular: se cotiza (decisión del dueño 27-oct)', () => {
  for (const t of ['ventana triangular 4500x1330', 'una ventana triángulo para el hastial', 'ventana fija triangular']) {
    assert.equal(detectarProductoFueraDeAlcance(t).fueraDeAlcance, false, t);
    assert.equal(mapAperturaToEngine(t), 'TRIANGULAR', t);
    assert.equal(aperturaFueExplicita(t), true, t);
  }
  // Las otras formas siguen escalando: no se abrió más de lo medido.
  assert.equal(detectarProductoFueraDeAlcance('ventana redonda').categoria, 'forma_irregular');
  assert.equal(detectarProductoFueraDeAlcance('ventana en forma de arco').categoria, 'forma_irregular');
  assert.ok(APERTURAS.includes('TRIANGULAR'));
});

test('🔒 una «ventana fija» sin triángulo sigue siendo FIJA (la rama nueva no se roba nada)', () => {
  assert.equal(mapAperturaToEngine('ventana fija 1000x1000'), 'FIJA');
  assert.equal(mapAperturaToEngine('puerta abatible 900x2000'), 'PUERTA');
  // [Thermos B1] la negación también cubre «triangular»: nunca se cotiza un triángulo que el cliente descartó.
  assert.notEqual(mapAperturaToEngine('ventana fija, no triangular, 1000x1000'), 'TRIANGULAR');
  assert.equal(mapAperturaToEngine('quiero una ventana fija de 1000x1000, nada de triangular'), 'FIJA');
  assert.equal(mapAperturaToEngine('proyectante 800x600, sin triángulo'), 'PROYECTANTE');
});

test('🔴 [Thermos M1] el TRIANGULAR no se da vuelta en el pre-pass «alto × ancho»: base 5000 × alto 2600 llega así al motor', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, opts) => {
    const b = JSON.parse(opts.body); bodies.push(b);
    const payload = { ok: true, total_clp: 900000, producto_label: `Fijo triangular S60 · base ${b.ancho_mm} × alto ${b.alto_mm} mm, 2 paños`, triangular: { base_mm: b.ancho_mm, alto_mm: b.alto_mm, divisiones: 2 } };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  try {
    // alto 2600 > 2400 dispara la regla física «la lista vino alto × ancho» para un rectángulo; el triángulo se exime.
    const d = { items: [{ product: 'TRIANGULAR', measures: '5000x2600mm', qty: 1, descripcion: 'ventana triangular para el hastial 5000x2600', divisiones_triangulo: 2 }], comuna: 'Temuco', texto_cliente: 'ventana triangular para el hastial 5000x2600' };
    const res = await priceAllEngine(d);
    assert.equal(res.ok, true);
    assert.equal(bodies[0].tipo, 'TRIANGULAR');
    assert.equal(bodies[0].ancho_mm, 5000, 'la base queda como base');
    assert.equal(bodies[0].alto_mm, 2600, 'el alto queda como alto');
    assert.equal(bodies[0].divisiones, 2, 'las divisiones viajan');
    assert.equal(d.items[0].measures_swapped, undefined, 'no se marca como girada');
    assert.match(String(d.items[0].measures), /^5000x2600/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('🔴 [Thermos M2] el vidrio del triángulo se elige por su área REAL (medio rectángulo): 2200×1700 = 1,87 m² → 4+12+4', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, opts) => {
    const b = JSON.parse(opts.body); bodies.push(b);
    const payload = { ok: true, total_clp: 500000, producto_label: 'Fijo triangular S60 · base 2200 × alto 1700 mm, 1 paño' };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  try {
    await priceAllEngine({ items: [{ product: 'TRIANGULAR', measures: '2200x1700mm', qty: 1, descripcion: 'ventana triangular 2200x1700' }], comuna: 'Temuco' });
    const rect = pickGlassId(2200, 1700, '');
    const tri = pickGlassId(2200, 850, '');
    assert.notEqual(rect, tri, 'el rectángulo de 3,74 m² y el triángulo de 1,87 m² caen en vidrios distintos');
    assert.equal(bodies[0].glass_id, tri, 'al motor va el del área real del triángulo');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ═══ 2. COMPUESTA ANIDADA: la forma del LLM se traduce a la del motor ═══
test('🔴 el paño COMPUESTA del LLM (tipo_arriba/tipo_abajo) viaja al motor como sub-paños con sus altos', () => {
  const partes = [
    { tipo: 'COMPUESTA', ancho_mm: 600, tipo_arriba: 'PROYECTANTE', tipo_abajo: 'FIJA', alto_arriba_mm: 1300, alto_abajo_mm: 800 },
    { tipo: 'FIJA', ancho_mm: 1100 },
  ];
  const out = partesParaMotor(partes, 'horizontal', 2100);
  assert.deepEqual(out, [
    { tipo: 'COMPUESTA', ancho_mm: 600, partes: [{ tipo: 'PROYECTANTE', alto_mm: 1300 }, { tipo: 'FIJA', alto_mm: 800 }] },
    { tipo: 'FIJA', ancho_mm: 1100 },
  ]);
});

test('🔴 sin las alturas de las mitades: mitad y mitad del alto común (no se inventa otra cosa)', () => {
  const out = partesAnidadasParaMotor([{ tipo: 'COMPUESTA', ancho_mm: 600, tipo_arriba: 'PROYECTANTE', tipo_abajo: 'FIJA' }], 2101);
  assert.deepEqual(out[0].partes, [{ tipo: 'PROYECTANTE', alto_mm: 1051 }, { tipo: 'FIJA', alto_mm: 1050 }]);
  // Sin alto común tampoco se inventa: queda undefined y el motor lo rechaza con su motivo.
  const sin = partesAnidadasParaMotor([{ tipo: 'COMPUESTA', ancho_mm: 600, tipo_arriba: 'FIJA', tipo_abajo: 'FIJA' }]);
  assert.equal(sin[0].partes[0].alto_mm, undefined);
});

test('🔒 las partes planas no cambian: el default fijo+proyectante iguales sigue sin viajar', () => {
  assert.equal(partesParaMotor([{ tipo: 'FIJA', ancho_mm: 800 }, { tipo: 'PROYECTANTE', ancho_mm: 800 }], undefined, 1450), undefined);
  assert.deepEqual(partesAnidadasParaMotor([{ tipo: 'FIJA', ancho_mm: 800 }], 1000), [{ tipo: 'FIJA', ancho_mm: 800 }]);
});

// ═══ 3. EL DIBUJO ═══
const caja = { x: 0, y: 0, w: 200, h: 200 };

test('🔴 la compuesta anidada se dibuja con TRES marcos (dos celdas apiladas + un fijo), rotulados A1 F1 F2', () => {
  const it = {
    producto_label: 'Ventana compuesta: [Proyectante 1300mm (arriba) + Fijo 798mm (abajo)] 600mm + Fijo 1100mm',
    measures: '1702x2100', color: 'NEW BLACK',
    compuesta: {
      orientacion: 'horizontal',
      partes: [
        { tipo: 'COMPUESTA', ancho_mm: 600, alto_mm: 2100, compuesta: { orientacion: 'vertical', partes: [{ tipo: 'PROYECTANTE', ancho_mm: 600, alto_mm: 1300 }, { tipo: 'FIJA', ancho_mm: 600, alto_mm: 798 }] } },
        { tipo: 'FIJA', ancho_mm: 1100, alto_mm: 2100 },
      ],
    },
  };
  assert.equal(tipoDe(it), 'COMPUESTA');
  const p = planoDeVentana(it, caja);
  assert.equal(p.marcos.length, 3, 'tres marcos completos');
  assert.deepEqual(p.hojas.map((h) => h.tipo), ['PROYECTANTE', 'FIJA', 'FIJA']);
  assert.deepEqual(p.hojas.map((h) => h.rotulo), ['A1', 'F1', 'F2']);
  // La celda de arriba del paño izquierdo está ENCIMA de la de abajo, y las dos a la izquierda del fijo.
  assert.ok(p.marcos[0].y < p.marcos[1].y && Math.abs(p.marcos[0].x - p.marcos[1].x) < 0.01);
  assert.ok(p.marcos[2].x > p.marcos[0].x + p.marcos[0].w - 0.01);
  // Las cotas: 600 y 1100 arriba, 1300 y 798 a la izquierda, y los totales.
  const textos = p.cotas.map((c) => c.texto);
  for (const t of ['600', '1100', '1300', '798', '1702', '2100']) assert.ok(textos.includes(t), `cota ${t}`);
});

test('🔴 el triángulo se dibuja como dos triángulos con su acople, y sus cotas son base y alto', () => {
  const it = { producto_label: 'Fijo triangular S60 · base 4500 × alto 1330 mm, 2 paños', measures: '4500x1330', color: 'NOGAL', triangular: { base_mm: 4500, alto_mm: 1330, divisiones: 2 } };
  assert.equal(tipoDe(it), 'TRIANGULAR');
  const p = planoDeVentana(it, caja);
  assert.equal(p.triangulo.divisiones, 2);
  assert.equal(p.triangulo.panos.length, 2);
  assert.ok(p.triangulo.acople, 'la junta del vértice');
  assert.equal(p.hojas.length, 0);
  assert.deepEqual(p.marcos, []);
  // El vidrio está ADENTRO del marco (encogido hacia el incentro), nunca más grande.
  const ext = p.triangulo.panos[0].exterior, vid = p.triangulo.panos[0].vidrio;
  const area = (t) => Math.abs((t[1].x - t[0].x) * (t[2].y - t[0].y) - (t[2].x - t[0].x) * (t[1].y - t[0].y)) / 2;
  assert.ok(area(vid) < area(ext) && area(vid) > 0);
  assert.deepEqual(p.cotas.map((c) => c.texto), ['4500', '1330']);
  // Sin el dato del motor, el label alcanza.
  const p2 = planoDeVentana({ producto_label: 'Fijo triangular S60 · base 2000 × alto 900 mm, 1 paño', measures: '2000x900' }, caja);
  assert.equal(p2.triangulo.divisiones, 1);
  assert.equal(p2.triangulo.acople, null);
});

test('🔴 la puerta con poste T se dibuja con sus paños: vidrio arriba, placa machihembrada abajo, y el poste entre medio', () => {
  const it = {
    producto_label: 'Puerta abatible interior S60 · 2 paños (1 poste T): vidrio / machihembrado', measures: '1050x2000', color: 'NOGAL',
    puerta: { postes: 1, panos: [{ relleno: 'VIDRIO', alto_util_mm: 1000 }, { relleno: 'MACHIHEMBRADO', alto_util_mm: 680 }] },
  };
  assert.equal(tipoDe(it), 'PUERTA');
  const p = planoDeVentana(it, caja);
  assert.equal(p.hojas.length, 1);
  const pp = p.hojas[0].panosPuerta;
  assert.ok(pp, 'la hoja lleva sus paños');
  assert.deepEqual(pp.celdas.map((c) => c.relleno), ['VIDRIO', 'MACHIHEMBRADO']);
  assert.equal(pp.postes.length, 1);
  assert.ok(pp.celdas[0].h > pp.celdas[1].h, 'el de arriba es más alto (1000 vs 680)');
  assert.ok(pp.postes[0].y >= pp.celdas[0].y + pp.celdas[0].h - 0.01 && pp.postes[0].y + pp.postes[0].h <= pp.celdas[1].y + 0.01);
  // Sin el dato del motor, el label alcanza; y una puerta lisa no lleva paños.
  assert.deepEqual(panosPuertaDe({ producto_label: 'Puerta abatible exterior con zapata S60 · 3 paños (2 postes T): machihembrado / vidrio / vidrio' }).map((c) => c.relleno), ['MACHIHEMBRADO', 'VIDRIO', 'VIDRIO']);
  assert.equal(panosPuertaDe({ producto_label: 'Puerta abatible exterior con zapata S60' }), null);
  assert.equal(planoDeVentana({ producto_label: 'Puerta abatible exterior con zapata S60', measures: '900x2000' }, caja).hojas[0].panosPuerta, undefined);
});
