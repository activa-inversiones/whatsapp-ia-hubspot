// dibujoIsometrico.test.js — [2026-08-25]
//
// 🧊 La vista con profundidad. Lo que estos tests protegen NO es que "se vea linda" — eso lo
// juzga el dueño mirando el PDF. Protegen que la vista siga siendo LA MISMA VENTANA: que salga
// del mismo plano, que no se salga de su caja, y que no invente volumen donde no lo hay.

import test from 'node:test';
import assert from 'node:assert/strict';
import { carasDe, carasPerfil, vectorFuga } from './dibujoIsometrico.js';

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

test('🔴 [dueño 25-ago] la corredera lleva sus flechas también en la vista con volumen', () => {
  // El plano 2D ya las dibujaba y en la isométrica se habían quedado afuera. En una corredera
  // son la única señal de hacia dónde corre cada hoja.
  const d = docFalso();
  const p = dibujarVentanaIso(d, { x: 0, y: 0, w: 250, h: 220 },
    { producto_label: 'Ventana corredera 2 hojas', measures: '1500x1200', color: 'Blanco' });
  const conFlecha = p.hojas.filter((h) => h.flecha);
  assert.equal(conFlecha.length, 2, 'las dos hojas tienen sentido de deslizamiento');
  assert.equal(conFlecha[0].flecha, -conFlecha[1].flecha, 'y corren en sentidos opuestos');
});

test('🔒 una ventana que NO corre no lleva flechas', () => {
  const p = dibujarVentanaIso(docFalso(), { x: 0, y: 0, w: 250, h: 220 },
    { producto_label: 'Ventana proyectante', measures: '1000x800', color: 'Roble' });
  assert.ok(p.hojas.every((h) => !h.flecha), 'un proyectante no desliza');
});

test('🔴 [dueño 25-ago] las hojas de una corredera van en RIELES distintos', () => {
  // "las estás colocando sobre el mismo riel y eso no es posible para que puedan deslizarse".
  const p = dibujarVentanaIso(docFalso(), { x: 0, y: 0, w: 250, h: 220 },
    { producto_label: 'Ventana corredera 2 hojas', measures: '1500x1200', color: 'Blanco' });
  const rieles = p.hojas.map((h) => h.riel);
  assert.deepEqual([...new Set(rieles)].sort(), [0, 1], 'una en cada riel');
  // Y se TRASLAPAN: si no, quedaría una rendija abierta al cerrar.
  const [a, b] = [...p.hojas].sort((x, y) => x.x - y.x);
  assert.ok(a.x + a.w > b.x + 0.01, 'la hoja izquierda se monta sobre la derecha');
});

test('🔒 una ventana que no corre no tiene rieles ni traslape', () => {
  const p = dibujarVentanaIso(docFalso(), { x: 0, y: 0, w: 250, h: 220 },
    { producto_label: 'Ventana proyectante', measures: '1000x800', color: 'Roble' });
  assert.ok(p.hojas.every((h) => h.riel === null || h.riel === undefined));
});

test('🔴 [dueño 26-ago] la hoja INTERIOR va adelante, tapando a la exterior', () => {
  // La ventana se dibuja vista DESDE ADENTRO (por eso se ve el junquillo), así que la hoja
  // del riel interior es la que queda a la vista. Si se invirtiera, el cliente vería su
  // ventana espejada: la hoja que él ve por delante quedaría atrás.
  const p = dibujarVentanaIso(docFalso(), { x: 0, y: 0, w: 300, h: 240 },
    { producto_label: 'Ventana corredera 2 hojas', measures: '2000x1500', color: 'Blanco' });
  const orden = p.hojas.map((h) => h.riel);
  assert.deepEqual(orden, [0, 1], 'se pinta primero la exterior (riel 0) y encima la interior (riel 1)');
  // Y la de adelante se traslapa sobre la de atrás: por eso al cerrarse se leen como un perfil.
  const atras = p.hojas.find((h) => h.riel === 0), adelante = p.hojas.find((h) => h.riel === 1);
  assert.ok(atras.x + atras.w > adelante.x, 'las dos comparten la franja del encuentro');
});

test('🔴 [dueño 26-ago] la hoja EXTERIOR se ve más chica que la interior', () => {
  // "si están en distintos rieles eso es imposible, debería verse la exterior más pequeña".
  // Es una proyección paralela: sin este ajuste las dos salen idénticas y el dibujo miente.
  const p = dibujarVentanaIso(docFalso(), { x: 0, y: 0, w: 300, h: 240 },
    { producto_label: 'Ventana corredera 2 hojas', measures: '2000x1500', color: 'Blanco' });
  const ext = p.hojas.find((h) => h.riel === 0), int = p.hojas.find((h) => h.riel === 1);
  assert.ok(ext.h < int.h, `la exterior (${ext.h.toFixed(2)}) más baja que la interior (${int.h.toFixed(2)})`);
  assert.ok(ext.w < int.w, 'y más angosta');
  // El encogimiento es SUTIL: una ventana no está en fuga, está a 1,7 m. Si se pasara, el
  // cliente vería una hoja notoriamente más chica que la otra, que tampoco es lo que ve.
  const razon = ext.h / int.h;
  assert.ok(razon > 0.94 && razon < 1, `razón ${razon.toFixed(3)} fuera del rango creíble`);
});

test('🔒 el vidrio y la manilla de la exterior se encogen CON su hoja', () => {
  // Si la hoja se encoge pero su vidrio no, el vidrio se sale del bastidor.
  const p = dibujarVentanaIso(docFalso(), { x: 0, y: 0, w: 300, h: 240 },
    { producto_label: 'Ventana corredera 2 hojas', measures: '2000x1500', color: 'Blanco' });
  const ext = p.hojas.find((h) => h.riel === 0);
  const v = ext.vidrioRect;
  assert.ok(v.x >= ext.x - 0.01 && v.x + v.w <= ext.x + ext.w + 0.01, 'el vidrio sigue dentro de su hoja');
  assert.ok(v.y >= ext.y - 0.01 && v.y + v.h <= ext.y + ext.h + 0.01, 'también en vertical');
  if (ext.manilla) {
    assert.ok(ext.manilla.x >= ext.x - 2 && ext.manilla.x <= ext.x + ext.w + 2, 'la manilla acompaña');
  }
});

// ── [2026-08-26 · Gemini NO-APTO] la esquina trasera del bisel CIERRA ───────────────────
test("🔴 bisel: las caras superior y derecha terminan en el MISMO vertice (sin fisura)", () => {
  // El defecto demostrado por Gemini: superior biselaba solo en X y derecha solo en Y, y en
  // la esquina trasera compartida quedaba una brecha de b·√2 px con el fondo blanco asomando.
  // Con el inset en ambos ejes, el vertice trasero es uno solo — y el escalon y la veta
  // doblan la esquina sin quebrarse, a CUALQUIER fraccion de profundidad.
  const c = carasPerfil({ x: 100, y: 100, w: 60, h: 40 }, { dx: 6, dy: -6 }, 2);
  const finSup = c.superior[2];      // vertice trasero-derecho de la cara superior
  const iniDer = c.derecha[3];       // vertice trasero-superior de la cara derecha
  assert.deepEqual(finSup, iniDer, `fisura en la esquina: ${finSup} vs ${iniDer}`);
  for (const fr of [0.3, 0.55, 0.8]) {
    const [sup, der] = c.linea(fr);
    assert.deepEqual(sup[1], der[0], `la linea al ${fr} de profundidad quiebra en la esquina`);
  }
  // Y el escalon ES la linea a media profundidad (misma matematica, no una copia divergente).
  assert.deepEqual(c.escalones, c.linea(0.55));
});

// ── EL PAÑO FIJO NO TIENE HOJA (2026-09-11, correccion del dueño) ───────────────────────────
// Textual: «EN LA PARTE FIJA NO HAY HOJA ES SOLO EL MARCO CON TERMOPANEL».
// El plano 2D ya lo tenia escrito desde agosto — `sinBastidor` existe justamente para eso y su
// comentario dice "en el plano real ese contorno no existe, y dibujarlo hace parecer que el fijo
// tambien abre". Pero ESTE pintor, el de volumen, el que sale en la propuesta que ve el cliente,
// trazaba igual el rectangulo de la hoja sobre el paño fijo.
//
// 🔴 POR QUE EL TEST ES ASI: el defecto no estaba en la geometria (el plano decia bien
// `sinBastidor: true`) sino en lo que el pintor DIBUJABA con esa geometria. Un test sobre
// `planoDeVentana` no lo habria visto nunca — de hecho no lo vio. Por eso aca se graba lo que el
// pintor traza y se comprueba que sobre el paño fijo no haya un contorno de hoja.
import { dibujarVentanaIso } from './dibujoIsometrico.js';

/** Doc falso que anota cada rectangulo trazado (x,y,w,h) y si fue con contorno. */
function docQueAnota() {
  const rects = [];
  let pend = [];
  const d = {
    save: () => d, restore: () => d, lineWidth: () => d, strokeColor: () => d, fillColor: () => d,
    fillOpacity: () => d, dash: () => d, undash: () => d, font: () => d, fontSize: () => d,
    clip: () => { pend = []; return d; },
    moveTo: () => d, lineTo: () => d, polygon: () => d, text: () => d,
    rect: (x, y, w, h) => { pend.push({ x, y, w, h }); return d; },
    roundedRect: (x, y, w, h) => { pend.push({ x, y, w, h }); return d; },
    fill: () => { pend = []; return d; },
    stroke: () => { rects.push(...pend); pend = []; return d; },
    fillAndStroke: () => { rects.push(...pend); pend = []; return d; },
    page: { width: 300, height: 250 },
  };
  d._rects = rects;
  return d;
}

test('🔴 el paño FIJO de un monorriel no lleva contorno de hoja: es marco + termopanel', () => {
  const doc = docQueAnota();
  const caja = { x: 60, y: 6, w: 156, h: 196 };
  dibujarVentanaIso(doc, caja, {
    producto_label: 'Ventana Fija+Corredera', measures: '1500x2100',
    color: 'blanco', glass_label: 'Termopanel 5+12+5',
  });
  // La mitad DERECHA del dibujo es el paño fijo. Ahi no puede haber un rectangulo del tamaño de
  // una hoja: solo el marco (que es mas grande y arranca a la izquierda), el junquillo y el vidrio.
  // Todo lo que arranca pasado el 35% del ancho y es casi tan alto como la ventana pertenece al
  // paño DERECHO (el fijo). El contorno de hoja fantasma arrancaba apenas 3 px antes del medio,
  // asi que un umbral pegado al centro lo dejaba pasar — la primera version de este test lo
  // dejo, y por eso estaba en verde con el defecto puesto. Se midio y se corrigio el umbral.
  // [2026-09-25] Umbral 0,75 -> 0,70. NO se relaja lo que el test custodia: sigue siendo que
  // en el pano fijo haya DOS rectangulos altos y no tres. Lo que cambio es el dibujo: ahora
  // reserva 24 pt abajo para la cota de elevacion (pedido del dueno), asi que los MISMOS dos
  // rectangulos quedan proporcionalmente mas bajos respecto de la caja.
  // MEDIDO con este mismo doble y esta misma ventana: los dos rectangulos del pano fijo miden
  // 138,6 y 136,1 pt. Umbral 0,75 = 147 pt -> no los alcanza (0). Umbral 0,68 = 133,3 pt -> los
  // dos, y solo esos dos. El contorno de hoja fantasma, si volviera, seria un tercero.
  const delFijo = doc._rects.filter((r) => r.x > caja.x + caja.w * 0.35 && r.h > caja.h * 0.68);
  // El fijo es marco + junquillo + termopanel: del marco no sale un rectangulo propio acá, asi
  // que quedan DOS (junquillo y vidrio). Un tercero es el contorno de hoja que no debe existir.
  assert.equal(delFijo.length, 2,
    `el paño fijo traza ${delFijo.length} rectangulos altos; con el contorno de hoja fantasma eran 3`);
});
