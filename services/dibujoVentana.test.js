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
  const prop = p.hojas[0].w / (p.hojas[0].w + p.hojas[1].w);
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
  assert.ok(p.hojas[0].w > p.hojas[1].w && p.hojas[1].w > p.hojas[2].w, '1530 > 900 > 820 también en el dibujo');
  assert.equal(p.hojas[0].simbolo.length + p.hojas[2].simbolo.length, 0, 'los dos fijos, sin símbolo');
});

test('🔒 los paños no se pisan ni se salen del marco', () => {
  const p = planoDeVentana(itCompuesta([{ tipo: 'FIJA', ancho_mm: 1200 }, { tipo: 'PROYECTANTE', ancho_mm: 800 }]), { x: 10, y: 5, w: 200, h: 120 });
  const [a, b] = p.hojas;
  assert.ok(a.x + a.w <= b.x + 0.01, 'el primer paño termina antes de que empiece el segundo');
  assert.ok(b.x - (a.x + a.w) >= 3, 'y entre medio va el montante (dos marcos + acople), no una línea');
  assert.ok(a.x >= p.marcoRect.x, 'nada se sale del marco por la izquierda');
  assert.ok(b.x + b.w <= p.marcoRect.x + p.marcoRect.w + 0.01, 'ni por la derecha');
  for (const h of p.hojas) {
    assert.ok(h.vidrioRect.x >= h.x && h.vidrioRect.x + h.vidrioRect.w <= h.x + h.w + 0.01, 'el vidrio queda DENTRO de su paño');
  }
});

test('🔒 sin datos de composición cae al dibujo de siempre, no rompe', () => {
  // Una compuesta vieja (cotizada antes de este cambio) no trae `compuesta.partes`.
  const p = planoDeVentana({ producto_label: 'Ventana compuesta', measures: '2000x1450', color: 'Blanco' }, { x: 0, y: 0, w: 200, h: 120 });
  assert.equal(p.tipo, 'COMPUESTA');
  assert.ok(p.hojas.length >= 1, 'dibuja algo razonable igual');
  assert.ok(!p.compuesta, 'y no inventa una composición que no tiene');
});
