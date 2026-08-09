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
