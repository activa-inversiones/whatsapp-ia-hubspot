// dibujoIsometrico.test.js — [2026-08-25]
//
// 🧊 La vista con profundidad. Lo que estos tests protegen NO es que "se vea linda" — eso lo
// juzga el dueño mirando el PDF. Protegen que la vista siga siendo LA MISMA VENTANA: que salga
// del mismo plano, que no se salga de su caja, y que no invente volumen donde no lo hay.

import test from 'node:test';
import assert from 'node:assert/strict';
import { carasDe, vectorFuga } from './dibujoIsometrico.js';

const R = { x: 100, y: 100, w: 60, h: 40 };

test('🔴 la fuga va hacia ARRIBA y a la DERECHA', () => {
  // Es como se mira una ventana parado adentro de la pieza. Si se invirtiera, la ventana se
  // vería desde afuera y el paño que abre quedaría del lado equivocado.
  const f = vectorFuga(0.1);
  assert.ok(f.dx > 0, 'a la derecha');
  assert.ok(f.dy < 0, 'y hacia arriba');
  assert.equal(f.dx, -f.dy, 'a 45 grados');
});

test('🔴 la profundidad sale del FONDO REAL del perfil, no de un valor lindo', () => {
  // S60 = 60 mm de fondo, a la mitad por la proyección "cabinet".
  const escala = 0.1;
  assert.equal(vectorFuga(escala).dx, 60 * escala * 0.5);
  // Y escala con el dibujo: una ventana dibujada al doble tiene el doble de fondo.
  assert.ok(Math.abs(vectorFuga(0.2).dx - 2 * vectorFuga(0.1).dx) < 1e-9);
});

test('🔒 una ventana diminuta igual tiene volumen visible', () => {
  // Con escalas chicas la profundidad matemática sería sub-píxel y la ventana se vería plana.
  assert.ok(vectorFuga(0.0001).dx >= 2, 'hay un piso en px');
});

test('🔴 las dos caras comparten el borde del frente: el volumen no queda despegado', () => {
  const f = vectorFuga(0.1);
  const { superior, derecha } = carasDe(R, f);
  // La cara superior arranca en el borde de arriba del rectángulo…
  assert.deepEqual(superior[0], [R.x, R.y]);
  assert.deepEqual(superior[1], [R.x + R.w, R.y]);
  // …y la derecha en el borde derecho. La esquina es la MISMA en las dos.
  assert.deepEqual(derecha[0], [R.x + R.w, R.y]);
  assert.deepEqual(derecha[1], [R.x + R.w, R.y + R.h]);
  assert.deepEqual(superior[1], derecha[0], 'comparten la esquina superior derecha');
});

test('🔴 las caras se van EXACTAMENTE por el vector de fuga', () => {
  const f = vectorFuga(0.1);
  const { superior, derecha } = carasDe(R, f);
  assert.deepEqual(superior[2], [R.x + R.w + f.dx, R.y + f.dy]);
  assert.deepEqual(superior[3], [R.x + f.dx, R.y + f.dy]);
  assert.deepEqual(derecha[2], [R.x + R.w + f.dx, R.y + R.h + f.dy]);
  assert.deepEqual(derecha[3], [R.x + R.w + f.dx, R.y + f.dy]);
  assert.deepEqual(superior[2], derecha[3], 'las dos caras cierran contra la misma arista');
});

test('🔒 los cuatro puntos de cada cara son distintos (nada colapsa a una línea)', () => {
  for (const caja of [R, { x: 0, y: 0, w: 1, h: 1 }, { x: -50, y: 20, w: 300, h: 2 }]) {
    const c = carasDe(caja, vectorFuga(0.1));
    for (const cara of [c.superior, c.derecha]) {
      const unicos = new Set(cara.map((pt) => pt.join(',')));
      assert.equal(unicos.size, 4, `4 puntos distintos en ${JSON.stringify(caja)}`);
    }
  }
});

// ── El test que de verdad importa: NADA se sale de su caja ────────────────────
// La fuga empuja el dibujo hacia arriba y a la derecha. Si no se reservara ese espacio, el
// volumen se pintaría encima de la ventana de al lado o del texto — y eso, en un PDF que va
// a un cliente, se ve como un error de imprenta.

import { dibujarVentanaIso } from './dibujoIsometrico.js';

/**
 * Un pdfkit de mentira que anota por dónde pasó el lápiz.
 *
 * ⚠️ MODELA EL `clip()`, y no es un detalle: el reflejo del vidrio se dibuja a propósito con
 * un polígono MÁS GRANDE que el vidrio y se recorta contra él. Un doble falso que ignorara el
 * recorte reportaría que el dibujo se sale de la caja cuando en el PDF real no se sale — y así
 * el test enseñaría a "arreglar" algo que está bien. (Pasó: la primera versión de este test
 * falló por esto.) Mientras hay un recorte activo, lo que se pinta queda acotado por él, que
 * ya fue anotado.
 */
function docFalso() {
  const pts = [];
  let recortes = 0;
  const pila = [];
  const anota = (x, y) => {
    if (recortes > 0) return;
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
  };
  const d = {
    pts,
    save: () => { pila.push(recortes); return d; },
    restore: () => { recortes = pila.pop() ?? 0; return d; },
    clip: () => { recortes += 1; return d; },
    lineWidth: () => d, fillOpacity: () => d,
    fillColor: () => d, strokeColor: () => d, fill: () => d, stroke: () => d,
    fillAndStroke: () => d, dash: () => d, undash: () => d,
    font: () => d, fontSize: () => d, text: () => d,
    rect: (x, y, w, h) => { anota(x, y); anota(x + w, y + h); return d; },
    roundedRect: (x, y, w, h) => { anota(x, y); anota(x + w, y + h); return d; },
    moveTo: (x, y) => { anota(x, y); return d; },
    lineTo: (x, y) => { anota(x, y); return d; },
    polygon: (...p) => { for (const [x, y] of p) anota(x, y); return d; },
  };
  return d;
}

const CASOS = [
  ['compuesta vertical', { producto_label: 'Ventana compuesta vertical', measures: '1200x2002', color: 'Roble', glass_label: 'TP-M-4+12+4', compuesta: { orientacion: 'vertical', partes: [{ tipo: 'PROYECTANTE', alto_mm: 1000 }, { tipo: 'FIJA', alto_mm: 1000 }] } }],
  ['compuesta horizontal 3 paños', { producto_label: 'Ventana compuesta', measures: '3250x1460', color: 'Roble', compuesta: { orientacion: 'horizontal', partes: [{ tipo: 'FIJA', ancho_mm: 1530 }, { tipo: 'PROYECTANTE', ancho_mm: 900 }, { tipo: 'FIJA', ancho_mm: 820 }] } }],
  ['corredera', { producto_label: 'Ventana corredera 2 hojas', measures: '1500x1200', color: 'Blanco' }],
  ['fija simple', { producto_label: 'Ventana fija', measures: '800x600', color: 'Blanco' }],
  ['altísima y angosta', { producto_label: 'Ventana proyectante', measures: '400x2400', color: 'Blanco' }],
  ['larguísima y baja', { producto_label: 'Ventana fija', measures: '3000x400', color: 'Blanco' }],
];

test('🔴 el volumen NUNCA se sale de su caja, en ningún tipo ni proporción', () => {
  const caja = { x: 50, y: 40, w: 200, h: 260 };
  for (const [nombre, it] of CASOS) {
    const d = docFalso();
    dibujarVentanaIso(d, caja, it);
    assert.ok(d.pts.length > 8, `${nombre}: se dibujó algo`);
    for (const [x, y] of d.pts) {
      assert.ok(x >= caja.x - 0.01, `${nombre}: se sale por la izquierda (x=${x})`);
      assert.ok(x <= caja.x + caja.w + 0.01, `${nombre}: se sale por la derecha (x=${x})`);
      assert.ok(y >= caja.y - 0.01, `${nombre}: se sale por arriba (y=${y})`);
      assert.ok(y <= caja.y + caja.h + 0.01, `${nombre}: se sale por abajo (y=${y})`);
    }
  }
});

test('🔒 una caja ridículamente chica no rompe ni produce coordenadas inválidas', () => {
  for (const caja of [{ x: 0, y: 0, w: 12, h: 10 }, { x: 5, y: 5, w: 30, h: 8 }]) {
    const d = docFalso();
    dibujarVentanaIso(d, caja, CASOS[0][1]);
    for (const [x, y] of d.pts) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y), 'sin NaN ni Infinity');
    }
  }
});

// ── Los dos hallazgos de Gemini en la compuerta ───────────────────────────────

test('🔴 [Gemini] el fondo sale de la SERIE, no fijo en 60 para todo', async () => {
  const { fondoDe } = await import('./dibujoIsometrico.js');
  assert.equal(fondoDe({ serie: 'S60' }), 60, 'S60: el valor medido en Winart');
  assert.equal(fondoDe({ serie: 's60' }), 60, 'sin importar cómo venga escrito');
  // Una serie que todavía NO se midió cae al fondo por defecto — no se le inventa un número,
  // porque un número inventado queda como medido para siempre.
  assert.equal(fondoDe({ serie: 'SLIDING' }), 60);
  assert.equal(fondoDe({}), 60);
  assert.equal(fondoDe(null), 60);
});

test('🔴 [Gemini] un color que no es hex NO rompe el PDF', async () => {
  // Una cotización que no se genera es una venta que no sale. Hoy no es alcanzable (los
  // colores salen de una tabla de hex), pero el seguro cuesta una línea.
  const { dibujarVentanaIso } = await import('./dibujoIsometrico.js');
  const d = docFalso();
  assert.doesNotThrow(() => dibujarVentanaIso(d, { x: 0, y: 0, w: 200, h: 200 },
    { producto_label: 'Ventana fija', measures: '1000x1000', color: 'un color que no existe' }));
  assert.ok(d.pts.length > 4, 'igual dibujó la ventana');
});

test('🔒 un fondo basura no produce una profundidad inválida', async () => {
  const { vectorFuga } = await import('./dibujoIsometrico.js');
  for (const malo of [0, -80, NaN, 'ochenta', null, undefined]) {
    const f = vectorFuga(0.1, malo);
    assert.ok(Number.isFinite(f.dx) && f.dx >= 2, `fondo=${malo} → profundidad válida`);
  }
});

test('🔴 la manilla SALE hacia el que mira, no hacia atrás como el marco', async () => {
  // Es la única pieza que sobresale del plano de la ventana. Si fugara para el mismo lado que
  // el marco, se vería hundida en la hoja — al revés de lo que es.
  const { carasHacia, vectorFuga } = await import('./dibujoIsometrico.js');
  const f = vectorFuga(0.1);
  const hacia = { dx: -f.dx * 0.5, dy: f.dx * 0.5 };
  assert.ok(hacia.dx < 0 && hacia.dy > 0, 'abajo-izquierda: hacia el observador');
  const r = { x: 100, y: 100, w: 20, h: 8 };
  const c = carasHacia(r, hacia);
  // Con esa dirección, las caras visibles son la IZQUIERDA y la de ABAJO — las contrarias
  // a las del marco, que se ve por arriba y por la derecha.
  assert.deepEqual(c.lateral[0], [r.x, r.y], 'la cara lateral arranca en el borde izquierdo');
  assert.deepEqual(c.horizontal[0], [r.x, r.y + r.h], 'y la horizontal, en el de abajo');
});

test('🔒 carasHacia elige el par correcto en las cuatro direcciones', async () => {
  const { carasHacia } = await import('./dibujoIsometrico.js');
  const r = { x: 0, y: 0, w: 10, h: 10 };
  assert.deepEqual(carasHacia(r, { dx: 3, dy: -3 }).lateral[0], [10, 0], 'derecha');
  assert.deepEqual(carasHacia(r, { dx: -3, dy: -3 }).lateral[0], [0, 0], 'izquierda');
  assert.deepEqual(carasHacia(r, { dx: 3, dy: -3 }).horizontal[0], [0, 0], 'arriba');
  assert.deepEqual(carasHacia(r, { dx: 3, dy: 3 }).horizontal[0], [0, 10], 'abajo');
});
