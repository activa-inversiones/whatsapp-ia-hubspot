// Tests del dibujante de ventanas. Se prueba planoDeVentana (puro), no el pintado con pdfkit:
// lo que puede salir mal es la geometría, no el trazo.
import test from "node:test";
import assert from "node:assert/strict";
import {
  planoDeVentana, medidas, tipoDe, hojasDe, claveColor, claveVidrio,
  encajar, repartirHojas, simboloApertura, COLORES,
} from "./dibujoVentana.js";

const CAJA = { x: 0, y: 0, w: 120, h: 100 };

test("medidas: acepta metros y milímetros, coma y punto", () => {
  assert.deepEqual(medidas("1200x1500"), { ancho: 1200, alto: 1500 });
  assert.deepEqual(medidas("1.2x1.5"), { ancho: 1200, alto: 1500 });
  assert.deepEqual(medidas("1,2 X 1,5"), { ancho: 1200, alto: 1500 });
  assert.deepEqual(medidas("2×1"), { ancho: 2000, alto: 1000 });
});

test("medidas: sin dato no revienta, cae a 1000x1000", () => {
  assert.deepEqual(medidas(null), { ancho: 1000, alto: 1000 });
  assert.deepEqual(medidas("a medir en terreno"), { ancho: 1000, alto: 1000 });
});

test("encajar: NO deforma — la escala es la misma en x e y", () => {
  // Una ventana de 2000x500 tiene que verse chata, no estirada al alto de la caja.
  const r = encajar(2000, 500, 120, 100);
  assert.equal(Math.round((r.w / 2000) * 1e6), Math.round((r.h / 500) * 1e6));
  assert.ok(r.w <= 120 + 1e-9 && r.h <= 100 + 1e-9, "no se sale de la caja");
});

test("encajar: la ventana queda centrada en la caja", () => {
  const r = encajar(1000, 1000, 120, 100);
  assert.ok(r.dx > 0 && Math.abs(r.dy) < 1e-9, "cuadrada en caja apaisada: centra en x");
});

test("colores: usa el hex REAL de Winart, no el aproximado que había", () => {
  // El PDF venía dibujando grafito #3C4856; el real de Winart es #1c1c1c.
  assert.equal(COLORES.grafito.f, "#1c1c1c");
  assert.equal(COLORES.blanco.f, "#FFFFFF");
  assert.equal(COLORES.newblack.f, "#000000");
  assert.equal(claveColor("Grafito"), "grafito");
  assert.equal(claveColor("New Black"), "newblack");
  assert.equal(claveColor(undefined), "blanco", "sin color -> blanco");
});

test("claveVidrio: distingue bronce y satinado del incoloro", () => {
  assert.equal(claveVidrio("DVH 5+8+5 Bronce"), "bronce");
  assert.equal(claveVidrio("Satinado por norma"), "satinado");
  assert.equal(claveVidrio("DVH 4+12+4"), "incoloro");
});

test("tipo y hojas: la corredera asume 2 hojas, el resto 1", () => {
  assert.equal(tipoDe({ product: "Ventana Corredera 2 hojas" }), "CORREDERA");
  assert.equal(hojasDe({ product: "Ventana Corredera 2 hojas" }), 2);
  assert.equal(tipoDe({ product: "Proyectante" }), "PROYECTANTE");
  assert.equal(hojasDe({ product: "Proyectante" }), 1);
  assert.equal(tipoDe({ product: "Paño fijo" }), "FIJA");
});

test("tipo: OSCILOBATIENTE gana sobre BATIENTE (contiene la palabra)", () => {
  // "oscilobatiente" contiene "batiente": si el orden de los if está mal, se clasifica mal.
  assert.equal(tipoDe({ product: "Ventana Oscilobatiente" }), "OSCILOBATIENTE");
});

test("PUERTAS: no se dibujan como paño fijo (bug cazado por Codex)", () => {
  // El bot emite PUERTA_1H y PUERTA_DOBLE (index.js:3530). Caían al default => una puerta
  // salía en la cotización como un vidrio sin apertura.
  assert.equal(tipoDe({ product: "PUERTA_1H" }), "PUERTA");
  assert.equal(tipoDe({ product: "PUERTA_DOBLE" }), "PUERTA_DOBLE");
  assert.equal(hojasDe({ product: "PUERTA_DOBLE" }), 2, "la puerta doble lleva 2 hojas");
  assert.equal(hojasDe({ product: "PUERTA_1H" }), 1);
  // Y llevan símbolo de apertura, como cualquier batiente.
  assert.ok(simboloApertura(tipoDe({ product: "PUERTA_1H" }), { x: 0, y: 0, w: 10, h: 10 }).length > 0);
  assert.ok(simboloApertura(tipoDe({ product: "PUERTA_DOBLE" }), { x: 0, y: 0, w: 10, h: 10 }).length > 0);
});

test("MARCO_FIJO (nombre real del enum del bot) se dibuja como fijo", () => {
  assert.equal(tipoDe({ product: "MARCO_FIJO" }), "FIJA");
  assert.equal(simboloApertura("FIJA", { x: 0, y: 0, w: 10, h: 10 }).length, 0);
});

test("ABATIBLE (nombre real del enum) se clasifica como batiente", () => {
  assert.equal(tipoDe({ product: "ABATIBLE" }), "BATIENTE");
});

test("hojas: nunca menos de 1, aunque el dato venga en 0", () => {
  assert.equal(hojasDe({ corredera: { hojas: 0 } }), 1);
  assert.equal(hojasDe({}), 1);
});

test("repartirHojas: cubren el ancho exacto, sin huecos ni solape", () => {
  const hs = repartirHojas(10, 0, 90, 50, 3);
  assert.equal(hs.length, 3);
  assert.equal(hs[0].x, 10);
  assert.equal(hs[2].x + hs[2].w, 100);
  for (let i = 1; i < hs.length; i++) {
    assert.equal(hs[i].x, hs[i - 1].x + hs[i - 1].w, "hoja pegada a la anterior");
  }
});

test("símbolo: FIJA y CORREDERA no llevan diagonales", () => {
  const r = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(simboloApertura("FIJA", r).length, 0);
  assert.equal(simboloApertura("CORREDERA", r).length, 0);
});

test("símbolo PROYECTANTE: bisagra ARRIBA, vértice abajo al centro", () => {
  const r = { x: 0, y: 0, w: 10, h: 10 };
  const s = simboloApertura("PROYECTANTE", r);
  assert.equal(s.length, 2);
  // Las dos diagonales convergen en el mismo punto: centro del borde inferior.
  assert.deepEqual([s[0].x2, s[0].y2], [5, 10]);
  assert.deepEqual([s[1].x2, s[1].y2], [5, 10]);
  // Y arrancan de las esquinas SUPERIORES (donde van las bisagras).
  assert.equal(s[0].y1, 0);
  assert.equal(s[1].y1, 0);
});

test("símbolo BATIENTE: las diagonales salen del lado de la bisagra", () => {
  const r = { x: 0, y: 0, w: 10, h: 10 };
  const der = simboloApertura("BATIENTE", r, true);
  assert.ok(der.every((s) => s.x1 === 0), "mano derecha: bisagra a la izquierda");
  assert.ok(der.every((s) => s.x2 === 10 && s.y2 === 5), "vértice al centro del lado opuesto");
  const izq = simboloApertura("BATIENTE", r, false);
  assert.ok(izq.every((s) => s.x1 === 10), "mano izquierda: bisagra a la derecha");
});

test("símbolo OSCILOBATIENTE: lleva las DOS aperturas (4 diagonales)", () => {
  const s = simboloApertura("OSCILOBATIENTE", { x: 0, y: 0, w: 10, h: 10 });
  assert.equal(s.length, 4, "batiente lateral + oscilante inferior");
});

test("plano: una corredera de 2 hojas alterna el sentido de las flechas", () => {
  const p = planoDeVentana({ product: "Corredera 2 hojas", measures: "1.5x1.2" }, CAJA);
  assert.equal(p.hojas.length, 2);
  assert.equal(p.hojas[0].flecha, 1);
  assert.equal(p.hojas[1].flecha, -1);
});

test("plano: el vidrio queda DENTRO de su hoja, y la hoja dentro del marco", () => {
  const p = planoDeVentana({ product: "Corredera 2 hojas", measures: "1.5x1.2" }, CAJA);
  const m = p.marcoRect;
  for (const h of p.hojas) {
    assert.ok(h.x >= m.x - 1e-9 && h.x + h.w <= m.x + m.w + 1e-9, "hoja dentro del marco");
    const v = h.vidrioRect;
    assert.ok(v.x >= h.x && v.x + v.w <= h.x + h.w + 1e-9, "vidrio dentro de la hoja");
    assert.ok(v.y >= h.y && v.y + v.h <= h.y + h.h + 1e-9, "vidrio dentro de la hoja (y)");
  }
});

test("el vidrio NUNCA se sale de su hoja, en ninguna medida (bug cazado por Codex)", () => {
  // El test de arriba usaba UNA ventana cómoda y por eso pasaba. Con una hoja angosta el
  // vidrio se dibujaba fuera de la hoja, derramado sobre el marco. Se barren medidas y cajas.
  const casos = [];
  for (const med of ["300x1290", "400x2400", "2930x400", "600x600", "4000x300", "1500x1200"]) {
    for (const n of [1, 2, 3, 4]) {
      for (const caja of [{ x: 0, y: 0, w: 12, h: 42 }, { x: 0, y: 0, w: 100, h: 52 }, { x: 0, y: 0, w: 240, h: 190 }]) {
        casos.push({ med, n, caja });
      }
    }
  }
  for (const c of casos) {
    const p = planoDeVentana(
      { product: `Corredera ${c.n} hojas`, measures: c.med, corredera: { hojas: c.n } },
      c.caja
    );
    for (const h of p.hojas) {
      const v = h.vidrioRect;
      const dentro = v.x >= h.x - 1e-9 && v.y >= h.y - 1e-9 &&
                     v.x + v.w <= h.x + h.w + 1e-9 && v.y + v.h <= h.y + h.h + 1e-9;
      assert.ok(dentro, `vidrio fuera de la hoja en ${c.med}, ${c.n} hojas, caja ${c.caja.w}x${c.caja.h}`);
      assert.ok(v.w >= 0 && v.h >= 0, "vidrio con dimensión negativa");
      assert.ok(Number.isFinite(v.x) && Number.isFinite(v.w), "NaN en la geometría del vidrio");
    }
  }
});

test("plano: una ventana MUY chica no colapsa el marco a cero", () => {
  // Con escala mínima, marco y perfil tienen piso en px; si no, el dibujo sale sin marco.
  const p = planoDeVentana({ product: "Fija", measures: "300x300" }, { x: 0, y: 0, w: 20, h: 20 });
  assert.ok(p.marco >= 2.5, "el marco conserva un grosor visible");
  assert.ok(p.hojas[0].vidrioRect.w > 0, "el vidrio no queda con ancho negativo");
});

test("plano: una ventana MUY apaisada tampoco rompe la geometría", () => {
  const p = planoDeVentana({ product: "Fija", measures: "4000x400" }, CAJA);
  assert.ok(p.hojas[0].vidrioRect.h > 0, "el vidrio no queda con alto negativo");
  assert.ok(p.marcoRect.h <= CAJA.h, "no se sale de la caja");
});

test("plano: sin datos (ítem vacío) devuelve un dibujo válido y no tira", () => {
  const p = planoDeVentana({}, CAJA);
  assert.equal(p.tipo, "FIJA");
  assert.equal(p.color.nombre, "Blanco");
  assert.equal(p.hojas.length, 1);
});

/* =========================================================================
 * [2026-08-25] LA COMPUESTA SE DIBUJA COMO UNA SOLA VENTANA
 * =========================================================================
 * Hasta hoy el encabezado de este módulo declaraba que no se podía ("se cotiza como dos ítems
 * ⇒ no se puede dibujar como una sola"). Con el tipo COMPUESTA en el motor, `compuesta.partes`
 * trae el tipo y el ancho REAL de cada paño. Codex lo marcó en la compuerta: sin esto la
 * compuesta salía dibujada como UN paño (y encima como proyectante, porque su label contiene
 * la palabra).
 *
 * 📐 Se dibuja según el modelo REAL de Winart (proyecto 56570, medido): dos marcos completos
 * acoplados, no un marco con poste — por eso el montante es grueso.
 */
const itCompuesta = (partes, measures = '2002x1450') => ({
  producto_label: 'Ventana compuesta: ' + partes.map((p) => `${p.tipo} ${p.ancho_mm}mm`).join(' + '),
  product: 'COMPUESTA', measures, color: 'Roble', glass_label: '4+12+4',
  compuesta: { partes },
});

test('🔴 tipoDe reconoce COMPUESTA antes que las palabras de sus paños', () => {
  assert.equal(tipoDe(itCompuesta([{ tipo: 'FIJA', ancho_mm: 1200 }, { tipo: 'PROYECTANTE', ancho_mm: 800 }])), 'COMPUESTA');
  // sin la rama COMPUESTA primero, el label "…+ Proyectante 800mm" caía en PROYECTANTE
  assert.equal(tipoDe({ producto_label: 'Proyectante S60' }), 'PROYECTANTE');
  assert.equal(tipoDe({ producto_label: 'Corredera SLIDING H98' }), 'CORREDERA');
});

test('🔴 cada paño con su ANCHO REAL, no en partes iguales (la Pos.1 del dueño: 60/40)', () => {
  const p = planoDeVentana(itCompuesta([{ tipo: 'FIJA', ancho_mm: 1200 }, { tipo: 'PROYECTANTE', ancho_mm: 800 }]), { x: 0, y: 0, w: 200, h: 120 });
  assert.equal(p.tipo, 'COMPUESTA');
  assert.equal(p.hojas.length, 2);
  // La proporción se mide sobre los MARCOS: cada paño es una ventana completa, y su ancho
  // real es el del marco, no el del vidrio (el perfil descuenta lo mismo en los dos).
  const prop = p.marcos[0].w / (p.marcos[0].w + p.marcos[1].w);
  assert.ok(Math.abs(prop - 0.6) < 0.01, `el fijo debe ocupar 60%, ocupa ${(prop * 100).toFixed(1)}%`);
});

test('🔴 el paño FIJO no lleva símbolo y el que ABRE sí — es lo que los distingue', () => {
  const p = planoDeVentana(itCompuesta([{ tipo: 'FIJA', ancho_mm: 1200 }, { tipo: 'PROYECTANTE', ancho_mm: 800 }]), { x: 0, y: 0, w: 200, h: 120 });
  assert.equal(p.hojas[0].tipo, 'FIJA');
  assert.equal(p.hojas[0].simbolo.length, 0, 'un fijo dibujado con diagonales miente: parece que abre');
  assert.equal(p.hojas[1].tipo, 'PROYECTANTE');
  assert.ok(p.hojas[1].simbolo.length > 0, 'el que abre tiene que verse que abre');
});

test('🔴 tres paños (la Pos.2 del dueño): fijo + proyectante + fijo, en su proporción', () => {
  const partes = [{ tipo: 'FIJA', ancho_mm: 1530 }, { tipo: 'PROYECTANTE', ancho_mm: 900 }, { tipo: 'FIJA', ancho_mm: 820 }];
  const p = planoDeVentana(itCompuesta(partes, '3250x1460'), { x: 0, y: 0, w: 200, h: 120 });
  assert.equal(p.hojas.length, 3);
  assert.deepEqual(p.hojas.map((h) => h.tipo), ['FIJA', 'PROYECTANTE', 'FIJA']);
  assert.ok(p.marcos[0].w > p.marcos[1].w && p.marcos[1].w > p.marcos[2].w, '1530 > 900 > 820 también en el dibujo');
  assert.equal(p.hojas[0].simbolo.length + p.hojas[2].simbolo.length, 0, 'los dos fijos, sin símbolo');
});

test('🔴 [dueño 25-ago] son VENTANAS SEPARADAS: cada paño con su marco completo y el acople entre medio', () => {
  // La 1a version dibujaba UN marco exterior con los paños adentro, compartiendo los lados.
  // El dueño lo cazó contra el plano de Winart: *"quedaron unidas y deben ser como separadas,
  // ahí va la unión mini que le sacaste"*. Se fabrican dos ventanas terminadas y se acoplan.
  const p = planoDeVentana(itCompuesta([{ tipo: 'FIJA', ancho_mm: 1200 }, { tipo: 'PROYECTANTE', ancho_mm: 800 }]), { x: 10, y: 5, w: 200, h: 120 });
  assert.equal(p.marcoRect, null, 'no hay un marco exterior único que los envuelva');
  assert.equal(p.marcos.length, 2, 'hay un marco COMPLETO por paño');
  const [m1, m2] = p.marcos;
  assert.ok(m1.x + m1.w <= m2.x + 0.01, 'el primer marco termina antes de que empiece el segundo');
  assert.ok(m2.x - (m1.x + m1.w) > 0, 'y entre medio queda la junta del acople, no un borde compartido');
  assert.equal(m1.y, m2.y, 'los dos arrancan arriba a la misma altura');
  assert.equal(m1.h, m2.h, 'y tienen el mismo alto');
  assert.ok(m1.x >= 10 && m2.x + m2.w <= 210.01, 'el conjunto no se sale de la caja');
  for (let i = 0; i < 2; i++) {
    const h = p.hojas[i], m = p.marcos[i];
    assert.ok(h.x > m.x && h.x + h.w < m.x + m.w + 0.01, `la hoja ${i} queda DENTRO de su propio marco`);
    assert.ok(h.y > m.y && h.y + h.h < m.y + m.h + 0.01, `la hoja ${i} respeta el marco arriba y abajo`);
    assert.ok(h.vidrioRect.x >= h.x && h.vidrioRect.x + h.vidrioRect.w <= h.x + h.w + 0.01, 'el vidrio queda DENTRO de su hoja');
  }
});

test('🔒 el acople se cobra y se ve: una unión por cada junta', () => {
  const p = planoDeVentana(itCompuesta([
    { tipo: 'FIJA', ancho_mm: 1530 }, { tipo: 'PROYECTANTE', ancho_mm: 900 }, { tipo: 'FIJA', ancho_mm: 820 },
  ], '3250x1460'), { x: 0, y: 0, w: 200, h: 120 });
  assert.equal(p.marcos.length, 3);
  assert.ok(p.compuesta.acople > 0, 'la junta tiene ancho propio');
  for (let i = 1; i < 3; i++) {
    const prev = p.marcos[i - 1];
    assert.ok(Math.abs((p.marcos[i].x - (prev.x + prev.w)) - p.compuesta.acople) < 0.01, `junta ${i} = el acople`);
  }
});

test('🔒 una compuesta angosta no produce marcos ni vidrios negativos', () => {
  const p = planoDeVentana(itCompuesta([{ tipo: 'FIJA', ancho_mm: 1 }, { tipo: 'PROYECTANTE', ancho_mm: 3000 }]), { x: 0, y: 0, w: 12, h: 10 });
  for (const m of p.marcos) assert.ok(m.w > 0 && m.h > 0, 'marco con ancho positivo');
  for (const h of p.hojas) {
    assert.ok(h.w > 0 && h.h > 0, 'hoja con ancho positivo');
    assert.ok(h.vidrioRect.w >= 0 && h.vidrioRect.h >= 0, 'vidrio nunca negativo');
  }
});

test('🔒 sin datos de composición cae al dibujo de siempre, no rompe', () => {
  // Una compuesta vieja (cotizada antes de este cambio) no trae `compuesta.partes`.
  const p = planoDeVentana({ producto_label: 'Ventana compuesta', measures: '2000x1450', color: 'Blanco' }, { x: 0, y: 0, w: 200, h: 120 });
  assert.equal(p.tipo, 'COMPUESTA');
  assert.ok(p.hojas.length >= 1, 'dibuja algo razonable igual');
  assert.ok(!p.compuesta, 'y no inventa una composición que no tiene');
});

// ── COMPUESTA VERTICAL: los paños se APILAN ───────────────────────────────────
// Medido en Winart (version 66979): es la misma ventana rotada 90 grados. El dibujo tiene que
// mostrar el que ABRE arriba, porque es lo unico que el cliente necesita saber del plano.

function itCompuestaVert(partes, medidas = '1200x2002') {
  return {
    producto_label: 'Ventana compuesta vertical',
    measures: medidas, color: 'Roble',
    compuesta: { orientacion: 'vertical', partes },
  };
}

test('🔴 [vertical] los paños se apilan: mismo ancho, uno encima del otro', () => {
  const p = planoDeVentana(itCompuestaVert([
    { tipo: 'PROYECTANTE', alto_mm: 1000 }, { tipo: 'FIJA', alto_mm: 1000 },
  ]), { x: 10, y: 5, w: 200, h: 300 });
  assert.equal(p.marcos.length, 2);
  const [a, b] = p.marcos;
  assert.equal(a.x, b.x, 'los dos arrancan en el mismo borde izquierdo');
  assert.equal(a.w, b.w, 'y tienen el mismo ancho: el ancho no se reparte');
  assert.ok(a.y + a.h <= b.y + 0.01, 'el de arriba termina antes de que empiece el de abajo');
  assert.ok(b.y - (a.y + a.h) > 0, 'y entre medio queda la junta del acople');
});

test('🔴 [vertical] el que ABRE va ARRIBA y se ve que abre', () => {
  const p = planoDeVentana(itCompuestaVert([
    { tipo: 'PROYECTANTE', alto_mm: 1000 }, { tipo: 'FIJA', alto_mm: 1000 },
  ]), { x: 0, y: 0, w: 200, h: 300 });
  assert.equal(p.compuesta.orientacion, 'vertical');
  assert.ok(p.hojas[0].simbolo.length > 0, 'el proyectante de arriba lleva su simbolo');
  assert.equal(p.hojas[1].simbolo.length, 0, 'el fijo de abajo, ninguno');
});

test('🔴 [vertical] la proporcion es la real: un paño de 1400 se ve mas alto que uno de 600', () => {
  const p = planoDeVentana(itCompuestaVert([
    { tipo: 'PROYECTANTE', alto_mm: 600 }, { tipo: 'FIJA', alto_mm: 1400 },
  ]), { x: 0, y: 0, w: 200, h: 300 });
  const prop = p.marcos[0].h / (p.marcos[0].h + p.marcos[1].h);
  assert.ok(Math.abs(prop - 0.3) < 0.01, `el de arriba debe ocupar 30%, ocupa ${(prop * 100).toFixed(1)}%`);
});

test('🔒 [vertical] nada se sale de la caja ni queda negativo', () => {
  const p = planoDeVentana(itCompuestaVert([
    { tipo: 'PROYECTANTE', alto_mm: 1 }, { tipo: 'FIJA', alto_mm: 3000 },
  ]), { x: 4, y: 6, w: 15, h: 12 });
  for (const m of p.marcos) {
    assert.ok(m.w > 0 && m.h > 0, 'marco positivo');
    assert.ok(m.y >= 6 - 0.01 && m.y + m.h <= 18.01, 'dentro de la caja');
  }
  for (const h of p.hojas) {
    assert.ok(h.vidrioRect.w >= 0 && h.vidrioRect.h >= 0, 'vidrio nunca negativo');
    assert.ok(h.vidrioRect.y >= h.y - 0.01, 'el vidrio no se derrama sobre el marco');
  }
});

test('🔒 sin orientacion se dibuja HORIZONTAL: ninguna compuesta vieja cambia de plano', () => {
  const p = planoDeVentana({
    producto_label: 'Ventana compuesta', measures: '2002x1450', color: 'Roble',
    compuesta: { partes: [{ tipo: 'FIJA', ancho_mm: 1200 }, { tipo: 'PROYECTANTE', ancho_mm: 800 }] },
  }, { x: 0, y: 0, w: 200, h: 120 });
  assert.equal(p.compuesta.orientacion, 'horizontal');
  assert.equal(p.marcos[0].y, p.marcos[1].y, 'lado a lado, no apilados');
  assert.ok(p.marcos[0].w > p.marcos[1].w, '1200 > 800');
});

// ── ESCALA REAL DEL PERFIL S60 ────────────────────────────────────────────────
// [2026-08-25] El dueño preguntó si el dibujo estaba a escala. NO lo estaba. Los gruesos
// ahora salen del modelo real de Winart (versión 66979, campos `ps` y `fm.ew`):
// marco 40 mm el que abre · 48 mm el fijo · hoja 58 mm · junquillo 18,5 mm.

test('🔴 la HOJA es más gruesa que el marco, no al revés (58 vs 40 mm)', () => {
  // El error que tenía: marco 60 / hoja 40. En la ventana real el bastidor que abre es el
  // perfil más ancho de todos.
  const p = planoDeVentana({ producto_label: 'Ventana proyectante', measures: '1200x1000', color: 'Roble' }, { x: 0, y: 0, w: 300, h: 250 });
  assert.ok(p.perfilHoja > p.marco, `hoja (${p.perfilHoja}) debe ser mayor que marco (${p.marco})`);
  assert.ok(Math.abs(p.perfilHoja / p.marco - 58 / 40) < 0.02, 'y en la proporción real 58:40');
});

test('🔴 el junquillo es el perfil más FINO de los tres', () => {
  const p = planoDeVentana({ producto_label: 'Ventana proyectante', measures: '1200x1000', color: 'Roble' }, { x: 0, y: 0, w: 300, h: 250 });
  assert.ok(p.junquillo < p.marco && p.junquillo < p.perfilHoja, 'junquillo < marco < hoja');
  assert.ok(Math.abs(p.junquillo / p.marco - 18.5 / 40) < 0.02, 'proporción real 18,5:40');
});

test('🔴 el paño FIJO lleva marco MÁS ANCHO que el que abre (48 vs 40 mm)', () => {
  // Winart lo trae así: `ps.f` = 48 en el frame de la fija, 40 en el de la proyectante.
  const p = planoDeVentana({
    producto_label: 'Ventana compuesta vertical', measures: '1200x2002', color: 'Roble',
    compuesta: { orientacion: 'vertical', partes: [{ tipo: 'PROYECTANTE', alto_mm: 1000 }, { tipo: 'FIJA', alto_mm: 1000 }] },
  }, { x: 0, y: 0, w: 200, h: 300 });
  const [abre, fijo] = p.marcos;
  assert.ok(fijo.marco > abre.marco, `el fijo (${fijo.marco}) más ancho que el que abre (${abre.marco})`);
  assert.ok(Math.abs(fijo.marco / abre.marco - 48 / 40) < 0.02, 'en la proporción real 48:40');
});

// ── RÓTULOS, COTAS Y MANILLA ──────────────────────────────────────────────────
// [2026-08-25] Lo que faltaba para que nuestro plano y el de WinPerfil se lean igual.

test('🔴 cada paño lleva su rótulo del taller: A para el que abre, F para el fijo', () => {
  const p = planoDeVentana({
    producto_label: 'Ventana compuesta vertical', measures: '1200x2002', color: 'Roble',
    glass_label: 'TP-M-4+12+4 DVH 4/12/4',
    compuesta: { orientacion: 'vertical', partes: [{ tipo: 'PROYECTANTE', alto_mm: 1000 }, { tipo: 'FIJA', alto_mm: 1000 }] },
  }, { x: 0, y: 0, w: 200, h: 300 });
  assert.deepEqual(p.hojas.map((h) => h.rotulo), ['A1', 'F1']);
  assert.equal(p.glassCode, 'TP-M-4+12+4', 'el código de vidrio se extrae, no se inventa');
});

test('🔒 sin un código de vidrio reconocible NO se inventa uno', () => {
  const p = planoDeVentana({ producto_label: 'Ventana fija', measures: '1000x1000', color: 'Blanco', glass_label: 'vidrio normal' }, { x: 0, y: 0, w: 200, h: 200 });
  assert.equal(p.glassCode, null);
});

test('🔴 la manilla va SOLO en el paño que abre, y abajo en un proyectante', () => {
  const p = planoDeVentana({
    producto_label: 'Ventana compuesta vertical', measures: '1200x2002', color: 'Roble',
    compuesta: { orientacion: 'vertical', partes: [{ tipo: 'PROYECTANTE', alto_mm: 1000 }, { tipo: 'FIJA', alto_mm: 1000 }] },
  }, { x: 0, y: 0, w: 200, h: 300 });
  const [abre, fijo] = p.hojas;
  assert.ok(abre.manilla, 'el proyectante tiene manilla');
  assert.equal(fijo.manilla, null, 'un fijo NO se toma de ningún lado');
  const v = abre.vidrioRect;
  assert.ok(Math.abs((abre.manilla.x + abre.manilla.w / 2) - (v.x + v.w / 2)) < 0.5, 'centrada a lo ancho');
  assert.ok(abre.manilla.y > v.y + v.h / 2, 'y abajo: las bisagras de un proyectante van arriba');
});

test('🔴 las cotas dan la medida de CADA paño, no solo el total', () => {
  // El cliente compara "1000 arriba, 1000 abajo" con el hueco de su casa; un 2002 solo no sirve.
  const p = planoDeVentana({
    producto_label: 'Ventana compuesta vertical', measures: '1200x2002', color: 'Roble',
    compuesta: { orientacion: 'vertical', partes: [{ tipo: 'PROYECTANTE', alto_mm: 1000 }, { tipo: 'FIJA', alto_mm: 1000 }] },
  }, { x: 0, y: 0, w: 200, h: 300 });
  const textos = p.cotas.map((c) => c.texto);
  assert.ok(textos.includes('2002'), 'el alto total');
  assert.ok(textos.includes('1200'), 'el ancho total');
  assert.equal(textos.filter((t) => t === '1000').length, 2, 'y los dos paños de 1000');
  // Los paños van pegados a la ventana (fila 0) y los totales afuera (fila 1).
  assert.ok(p.cotas.filter((c) => c.fila === 0).every((c) => c.lado === 'izq'), 'en vertical se acota por el costado');
});

test('🔴 en HORIZONTAL los paños se acotan por ARRIBA', () => {
  const p = planoDeVentana({
    producto_label: 'Ventana compuesta', measures: '2002x1450', color: 'Roble',
    compuesta: { orientacion: 'horizontal', partes: [{ tipo: 'FIJA', ancho_mm: 1200 }, { tipo: 'PROYECTANTE', ancho_mm: 800 }] },
  }, { x: 0, y: 0, w: 300, h: 200 });
  const porPano = p.cotas.filter((c) => c.fila === 0);
  assert.ok(porPano.length === 2 && porPano.every((c) => c.lado === 'sup'));
  assert.deepEqual(porPano.map((c) => c.texto), ['1200', '800']);
});

test('🔒 una ventana simple igual se acota, sin cotas por paño', () => {
  const p = planoDeVentana({ producto_label: 'Ventana corredera 2 hojas', measures: '1500x1200', color: 'Blanco' }, { x: 0, y: 0, w: 250, h: 220 });
  assert.deepEqual(p.cotas.map((c) => c.texto).sort(), ['1200', '1500']);
  assert.ok(p.cotas.every((c) => c.fila === 1), 'las dos son totales');
});

// ── La manilla va SOBRE LA HOJA, y del tamaño de una mano ─────────────────────
// [2026-08-25, corrección del dueño] Estaba centrada en el borde del vidrio, o sea montada
// sobre el junquillo: "va sobre la hoja de la ventana". Y salía corta — una manilla se toma
// con la mano y mide unos 120 mm, no un puñado de píxeles proporcionales al paño.

test('🔴 la manilla NO pisa el vidrio: se apoya en el perfil de la hoja', () => {
  const p = planoDeVentana({ producto_label: 'Ventana proyectante', measures: '1000x800', color: 'Roble' }, { x: 0, y: 0, w: 300, h: 240 });
  const h = p.hojas[0], q = h.manilla, v = h.vidrioRect;
  assert.ok(q, 'hay manilla');
  assert.ok(q.y >= v.y + v.h - 0.01, 'arranca donde TERMINA el vidrio, no encima de él');
  assert.ok(q.y + q.h <= h.y + h.h + 0.01, 'y no se pasa del borde de la hoja');
});

test('🔴 la manilla mide ~120 mm de verdad, no una fracción del paño', () => {
  // Dos ventanas de MUY distinto tamaño dibujadas a la misma escala tienen que dar la misma
  // manilla: es la misma pieza de ferretería en las dos.
  const grande = planoDeVentana({ producto_label: 'Ventana proyectante', measures: '2000x1600', color: 'Roble' }, { x: 0, y: 0, w: 300, h: 240 });
  const chica = planoDeVentana({ producto_label: 'Ventana proyectante', measures: '1000x800', color: 'Roble' }, { x: 0, y: 0, w: 150, h: 120 });
  assert.ok(Math.abs(grande.escala - chica.escala) < 1e-9, 'misma escala en las dos');
  assert.ok(Math.abs(grande.hojas[0].manilla.w - chica.hojas[0].manilla.w) < 0.01,
    'la misma manilla, aunque una ventana sea el doble que la otra');
  assert.ok(Math.abs(grande.hojas[0].manilla.w - 120 * grande.escala) < 0.01, '120 mm a escala');
});

test('🔴 en una corredera la manilla va en el montante del costado, parada', () => {
  const p = planoDeVentana({ producto_label: 'Ventana corredera 2 hojas', measures: '1500x1200', color: 'Blanco' }, { x: 0, y: 0, w: 300, h: 240 });
  const q = p.hojas[0].manilla;
  assert.ok(q.h > q.w, 'una manilla de corredera se toma en vertical');
  const v = p.hojas[0].vidrioRect;
  assert.ok(q.x >= v.x + v.w - 0.01 || q.x + q.w <= v.x + 0.01, 'fuera del vidrio, sobre el perfil');
});

test('🔒 en un paño diminuto la manilla se achica en vez de desbordarse', () => {
  const p = planoDeVentana({ producto_label: 'Ventana proyectante', measures: '400x300', color: 'Blanco' }, { x: 0, y: 0, w: 30, h: 24 });
  const h = p.hojas[0], q = h.manilla;
  if (q) {
    assert.ok(q.w <= h.w + 0.01 && q.h <= h.h + 0.01, 'nunca más grande que su propia hoja');
    assert.ok(q.w > 0 && q.h > 0, 'y nunca negativa');
  }
});

// ── La hoja mide distinto según el modelo ─────────────────────────────────────
// [2026-08-25, dato del dueño] "la hoja tiene distintas alturas, por ejemplo 80 mm, 98 mm,
// depende del modelo". Son las mismas opciones que ya cotiza el motor (H80 económica / H98
// reforzada). El dibujo tiene que mostrar la que se le cotizó, no una fija para todas.

test('🔴 una corredera H98 tiene la hoja MÁS ANCHA que una H80', () => {
  const base = { producto_label: 'Ventana corredera 2 hojas', measures: '1500x1200', color: 'Blanco' };
  const h80 = planoDeVentana({ ...base, hoja_mm: 80 }, { x: 0, y: 0, w: 300, h: 240 });
  const h98 = planoDeVentana({ ...base, hoja_mm: 98 }, { x: 0, y: 0, w: 300, h: 240 });
  assert.ok(h98.perfilHoja > h80.perfilHoja, 'la H98 se ve más robusta, que es lo que es');
  assert.ok(Math.abs(h98.perfilHoja / h80.perfilHoja - 98 / 80) < 0.02, 'en la proporción real');
});

test('🔴 sin dato, una corredera usa H80 — y NO los 58 mm de la S60', () => {
  const corr = planoDeVentana({ producto_label: 'Ventana corredera 2 hojas', measures: '1500x1200', color: 'Blanco' }, { x: 0, y: 0, w: 300, h: 240 });
  assert.ok(Math.abs(corr.perfilHoja - 80 * corr.escala) < 0.01, 'H80, el default del motor');
});

test('🔒 una proyectante sigue con la hoja S60 de 58 mm', () => {
  const p = planoDeVentana({ producto_label: 'Ventana proyectante', measures: '1000x800', color: 'Roble' }, { x: 0, y: 0, w: 300, h: 240 });
  assert.ok(Math.abs(p.perfilHoja - 58 * p.escala) < 0.01);
});

test('🔴 [Gemini] los rótulos siguen el orden VISUAL, no el de pintado', () => {
  // En una corredera las hojas se ordenan por riel para pintarlas. Si los rótulos se
  // asignaran después, A1 podría terminar sobre la hoja de la derecha — y eso manda a
  // fabricar la manilla en la hoja equivocada.
  // Con 3 hojas: los rieles quedan 0,1,0 — al ordenar por riel el orden cambia de verdad
  // (0,2,1). Con 2 hojas el orden no cambia y el test no probaría nada.
  const p = planoDeVentana({ producto_label: 'Ventana corredera 3 hojas', measures: '2400x1200', color: 'Blanco' }, { x: 0, y: 0, w: 300, h: 240 });
  assert.equal(p.hojas.length, 3);
  const izqADer = [...p.hojas].sort((a, b) => a.x - b.x);
  assert.deepEqual(izqADer.map((h) => h.rotulo), ['A1', 'A2', 'A3'], 'A1 es la de más a la izquierda');
});

test('🔒 un dato de hoja basura no rompe el dibujo', () => {
  for (const malo of [0, -80, 'ochenta', null]) {
    const p = planoDeVentana({ producto_label: 'Ventana corredera 2 hojas', measures: '1500x1200', color: 'Blanco', hoja_mm: malo }, { x: 0, y: 0, w: 300, h: 240 });
    assert.ok(p.perfilHoja > 0 && Number.isFinite(p.perfilHoja), `hoja_mm=${malo}`);
  }
});

test('🔴 una corredera de 3 o 4 hojas se dibuja con 3 o 4, no con 2', () => {
  // `hojasDe` leía solo `product`, pero el motor emite `producto_label`: una corredera de 3
  // hojas caía al default de 2 y el cliente veía una ventana que no era la suya.
  for (const n of [2, 3, 4]) {
    const p = planoDeVentana({ producto_label: `Ventana corredera ${n} hojas`, measures: '2400x1200', color: 'Blanco' }, { x: 0, y: 0, w: 300, h: 240 });
    assert.equal(p.hojas.length, n, `${n} hojas`);
  }
  // Y sigue funcionando con el campo viejo.
  assert.equal(planoDeVentana({ product: 'Ventana corredera 3 hojas', measures: '2400x1200', color: 'Blanco' }, { x: 0, y: 0, w: 300, h: 240 }).hojas.length, 3);
});
