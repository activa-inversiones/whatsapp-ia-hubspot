// Tests del dibujante de ventanas. Se prueba planoDeVentana (puro), no el pintado con pdfkit:
// lo que puede salir mal es la geometría, no el trazo.
import test from "node:test";
import assert from "node:assert/strict";
import {
  dibujarVentana, planoDeVentana, medidas, tipoDe, hojasDe, claveColor, claveVidrio,
  encajar, repartirHojas, simboloApertura, COLORES, partesDesdeLabel,
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

test("colores: calibrados contra las MUESTRAS FISICAS del dueño (26-ago), no el hex del sistema", () => {
  // Historia del dato, porque cambio dos veces: primero se dibujaba grafito #3C4856 (a ojo);
  // el 09-ago se corrigio al hex de la API de Winart (#1c1c1c); el 26-ago el dueño mando la
  // FOTO de las muestras reales ("estos colores son reales y con el relieve que tienen") y
  // la muestra desmintio a la API: el GRAFITO ANTRACITA fisico es un gris azulado medio, no
  // un casi-negro — en el PDF grafito y negro se veian iguales. La muestra fisica manda: es
  // lo que el cliente compara en la mano.
  assert.equal(COLORES.grafito.f, "#474C54", 'grafito antracita real, distinguible del negro');
  assert.notEqual(COLORES.grafito.f, COLORES.newblack.f, 'grafito ≠ negro, que era el sintoma');
  assert.equal(claveColor("Grafito"), "grafito");
  assert.equal(claveColor("New Black"), "newblack");
  assert.equal(claveColor(undefined), "blanco", "sin color -> blanco");
  // El relieve: las folias veteadas lo declaran; las lisas no.
  assert.ok(COLORES.roble.veta && COLORES.nogal.veta, 'roble y nogal son folias con veta');
  assert.equal(COLORES.blanco.veta, null, 'el blanco es liso');
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

test('🛟 [0358] sin datos de composición se DERIVA del label — nunca más un paño único', () => {
  // La propuesta 0358 de Paula salió con las compuestas como UN PAÑO porque el dato del
  // motor no llegó al ítem del dibujo. El label visible ya dice todo: de ahí se reconstruye.
  const p = planoDeVentana({ producto_label: 'Ventana compuesta', measures: '2000x1450', color: 'Blanco' }, { x: 0, y: 0, w: 200, h: 120 });
  assert.equal(p.tipo, 'COMPUESTA');
  assert.equal(p.marcos.length, 2, 'dos marcos aunque el dato no haya viajado');
  assert.equal(p.compuesta.derivado_de, 'label_mitades', 'y queda DECLARADO que se derivó, no medido');
});

test('🛟 [0358] el caso exacto de producción: product contaminado + label con medidas', () => {
  // El ítem llegó con product='PROYECTANTE' (enum del LLM) y el label completo del motor.
  // Antes: product ganaba → proyectante de un paño. Ahora: se leen los dos campos y los
  // paños salen del label, CON sus medidas reales.
  const p = planoDeVentana({
    product: 'PROYECTANTE',
    producto_label: 'Ventana compuesta vertical: Proyectante 1100mm (arriba) + Fijo 1100mm (abajo)',
    measures: '1000x2200', color: 'New Black',
  }, { x: 0, y: 0, w: 156, h: 196 });
  assert.equal(p.tipo, 'COMPUESTA');
  assert.equal(p.marcos.length, 2);
  assert.equal(p.compuesta.orientacion, 'vertical');
  assert.deepEqual(p.hojas.map((h) => h.tipo), ['PROYECTANTE', 'FIJA'], 'el que abre arriba');
  assert.equal(p.compuesta.derivado_de, 'label_con_medidas', 'las medidas salieron del label');
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

test('🔴 la corredera usa las medidas MEDIDAS en el DWG, no estimadas', () => {
  // Marco 48 de frente y la hoja entrando 8 mm: los dos salen de medir
  // Ventana_Corredera_80_S75.dxf, sección A-A. Antes eran 54 y 6, estimados.
  const p = planoDeVentana({ producto_label: 'Ventana corredera 2 hojas', measures: '2000x1500', color: 'Blanco' }, { x: 0, y: 0, w: 300, h: 240 });
  assert.ok(Math.abs(p.marco - 48 * p.escala) < 0.01, 'marco de corredera = 48 mm de frente');
  // La hoja PISA el marco: arranca antes del borde interior del hueco.
  const izq = [...p.hojas].sort((a, b) => a.x - b.x)[0];
  const bordeInterior = p.marcoRect.x + p.marco;
  assert.ok(izq.x < bordeInterior, 'la hoja entra dentro del marco, no apoya al ras');
  assert.ok(Math.abs((bordeInterior - izq.x) - 8 * p.escala) < 0.01, 'y entra 8 mm');
});

test('🔒 [Gemini] mencionar "compuesta" DE PASADA no inventa dos paños', () => {
  // El caso que cazó la compuerta: un label de ventana FIJA que menciona la palabra por otro
  // motivo. Sin señal estructural (+, mitad, eje, posiciones) la última red NO se activa.
  const p = planoDeVentana({
    producto_label: 'Ventana Fija Termopanel (no confundir con la compuesta que cotizamos ayer)',
    measures: '1000x1000', color: 'Blanco',
  }, { x: 0, y: 0, w: 156, h: 196 });
  assert.ok(!p.marcos || p.marcos.length === 1, 'un solo paño: es una fija');
  assert.ok(p.hojas.every((h) => !h.simbolo || h.simbolo.length === 0), 'sin símbolo de apertura');
});

// ── [2026-08-26] TEXTURA + BRILLO de la folia (pedido del dueno sobre el muestrario) ────
// "debes darle el relieve veteado a los colores bien brillosos todos con su textura".
// Grabadora universal: registra cada llamada pdfkit (solo args escalares) y encadena.
function docGrabadora() {
  const ops = [];
  const d = new Proxy({}, {
    get: (_, k) => {
      if (k === "_ops") return ops;
      return (...args) => {
        ops.push([k, ...args.filter((a) => typeof a === "string" || typeof a === "number")]);
        return d;
      };
    },
  });
  return d;
}
const ITEM_TEX = { producto_label: "Ventana proyectante", measures: "1000x1000", glass_label: "TP-M-4+12+4", serie: "S60" };

test("textura: DETERMINISTA — dos corridas del mismo plano emiten exactamente lo mismo", () => {
  // La semilla sale de la geometria, no de Math.random: un PDF re-emitido no cambia por azar
  // (y este deepEqual es el guardia de que nadie meta azar despues).
  const a = docGrabadora(), b = docGrabadora();
  dibujarVentana(a, { x: 10, y: 10, w: 200, h: 200 }, { ...ITEM_TEX, color: "Roble" });
  dibujarVentana(b, { x: 10, y: 10, w: 200, h: 200 }, { ...ITEM_TEX, color: "Roble" });
  assert.deepEqual(a._ops, b._ops);
});

test("textura: el roble dibuja su VETA de madera (la muestra manda)", () => {
  const d = docGrabadora();
  dibujarVentana(d, { x: 10, y: 10, w: 200, h: 200 }, { ...ITEM_TEX, color: "Roble" });
  const colores = d._ops.filter(([m]) => m === "strokeColor").map(([, c]) => c);
  assert.ok(colores.includes(COLORES.roble.veta), "las hebras de veta se pintan con el tono declarado");
});

test("textura: el negro dibuja GRANO con destello (veta oscura + mota clara)", () => {
  const d = docGrabadora();
  dibujarVentana(d, { x: 10, y: 10, w: 200, h: 200 }, { ...ITEM_TEX, color: "New Black" });
  const colores = new Set(d._ops.filter(([m]) => m === "strokeColor").map(([, c]) => c));
  assert.ok(colores.has(COLORES.newblack.veta), "las motas oscuras");
  // El destello: el tinte claro del brillo (0x26*1.55 etc.) tiene que aparecer tambien.
  assert.ok([...colores].some((c) => /^#3[b-f]3[b-f]4[0-5]$/i.test(String(c))),
    `falta la mota clara del destello entre ${[...colores].join(", ")}`);
});

test("textura: el blanco es LISO — brillo si, hebras de veta no", () => {
  const d = docGrabadora();
  dibujarVentana(d, { x: 10, y: 10, w: 200, h: 200 }, { ...ITEM_TEX, color: "Blanco" });
  const colores = d._ops.filter(([m]) => m === "strokeColor").map(([, c]) => c);
  for (const v of [COLORES.roble.veta, COLORES.nogal.veta, COLORES.newblack.veta, COLORES.grafito.veta]) {
    assert.ok(!colores.includes(v), `el blanco no lleva la veta ${v} de otra folia`);
  }
  // Y menos trazos que una folia veteada: la diferencia ES la textura.
  const t = docGrabadora();
  dibujarVentana(t, { x: 10, y: 10, w: 200, h: 200 }, { ...ITEM_TEX, color: "Nogal" });
  assert.ok(t._ops.length > d._ops.length + 20, "la folia veteada dibuja bastante mas que la lisa");
});

// ── [2026-08-26] la manilla REAL: roseta en el extremo + palanca en voladizo ────────────
import { manillaFormas } from "./dibujoVentana.js";

test("🔩 manilla: roseta compacta en el extremo, palanca hasta la punta, todo dentro de q", () => {
  // "Una manilla mas real, la otra se ve muy falsa": la roseta ya no ocupa el largo entero.
  const q = { x: 10, y: 20, w: 24, h: 6 };
  const f = manillaFormas(q);
  assert.ok(f && f.horiz);
  assert.ok(f.roseta.w <= q.w * 0.3 + 0.01, "la roseta es compacta, no el largo completo");
  assert.ok(f.palanca.x > f.roseta.x, "la palanca nace en el cuello");
  assert.ok(Math.abs((f.palanca.x + f.palanca.w) - (q.x + q.w)) < 0.01, "y llega hasta la punta");
  for (const r of [f.roseta, f.palanca, f.cuello]) {
    assert.ok(r.x >= q.x - 0.01 && r.y >= q.y - 0.01
      && r.x + r.w <= q.x + q.w + 0.01 && r.y + r.h <= q.y + q.h + 0.01, "todo dentro de q");
  }
});

test("🔩 manilla vertical: cerrada apunta hacia ABAJO (roseta arriba)", () => {
  const f = manillaFormas({ x: 0, y: 0, w: 6, h: 24 });
  assert.ok(f && !f.horiz);
  assert.ok(f.roseta.y === 0 && f.roseta.h <= 24 * 0.3 + 0.01, "roseta arriba y compacta");
  assert.ok(f.palanca.y + f.palanca.h > 23, "la palanca cuelga hasta abajo");
});

test("🔩 manilla sin lugar: null (el pintor cae al pill simple)", () => {
  assert.equal(manillaFormas({ x: 0, y: 0, w: 5, h: 1.6 }), null);
  assert.equal(manillaFormas(null), null);
});

test('🔴 [2026-08-27] americana monorriel: UN paño fijo (sin hoja) + uno que corre', () => {
  // Corrección del dueño con el plano de Winart: "un lado no tiene hoja". Una hoja corre
  // (bastidor + manilla + flecha), la otra es vidrio fijo en el marco.
  const p = planoDeVentana(
    { producto_label: 'Corredera AMERICANA Monorriel', product: 'CORREDERA', measures: '1000x1000' },
    { x: 0, y: 0, w: 250, h: 250 });
  const fijos = p.hojas.filter((h) => h.sinBastidor);
  const corren = p.hojas.filter((h) => !h.sinBastidor);
  assert.equal(fijos.length, 1, 'exactamente un paño fijo');
  assert.equal(corren.length, 1, 'exactamente un paño que corre');
  assert.ok(corren[0].manilla, 'el que corre lleva manilla');
  assert.ok(!fijos[0].manilla, 'el fijo NO lleva manilla');
  assert.ok(corren[0].flecha !== 0, 'el que corre lleva flecha');
  assert.equal(fijos[0].flecha, 0, 'el fijo no lleva flecha');
});

test('una corredera SLIDING normal NO tiene paño fijo (las dos hojas corren)', () => {
  const p = planoDeVentana(
    { producto_label: 'Corredera SLIDING H80 Doble Riel S75', product: 'CORREDERA', measures: '1500x1200' },
    { x: 0, y: 0, w: 250, h: 250 });
  assert.equal(p.hojas.filter((h) => h.sinBastidor).length, 0, 'ninguna hoja fija en una sliding');
});

// ── LA CORREDERA DE UNA VENTANA COMPUESTA (2026-09-11) ───────────────────────────────────
// 🔴 POR QUE EXISTEN (correccion del dueño sobre una propuesta real, textual):
//   «PUSISTE LA FORMA DE PROYECTANTE DEBE SER LA FIGURA DE CORREDERA»
// Una "Ventana Fija+Corredera" de 1500x2100 salia dibujada con el TRIANGULO PUNTEADO del
// proyectante. El precio estaba bien; mentia el dibujo, que es lo primero que mira el cliente.
// La cadena tenia la corredera caida en TRES lugares a la vez:
//   1. `partesDesdeLabel` no buscaba "corredera": el label solo encontraba FIJA, quedaba con
//      un solo tipo y caia al default de ultimo recurso ['PROYECTANTE','FIJA'] — o sea que la
//      corredera desaparecia y en su lugar se INVENTABA una proyectante.
//   2. `tipoDeParte` no tenia rama CORREDERA y devolvia "FIJA" para el paño que corre.
//   3. En la compuesta la flecha estaba clavada en `0`, asi que aun con el tipo correcto el
//      paño quedaba sin la unica señal que dice hacia donde corre.

test("🔴 compuesta Fija+Corredera: los paños son CORREDERA y FIJA, no una proyectante inventada", () => {
  const r = partesDesdeLabel({ producto_label: "Ventana compuesta Fija+Corredera" }, 1500, 2100);
  assert.deepEqual(r.partes.map((p) => p.tipo), ["CORREDERA", "FIJA"]);
});

test("🔴 compuesta con medidas: 'Corredera 800mm + Fijo 700mm' se lee completa", () => {
  const r = partesDesdeLabel({ producto_label: "Ventana compuesta Corredera 800mm + Fijo 700mm" }, 1500, 2100);
  assert.deepEqual(r.partes.map((p) => p.tipo), ["CORREDERA", "FIJA"]);
  assert.equal(r.derivado_de, "label_con_medidas");
});

test("🔴 el monorriel se dibuja como UNA ventana: 1 hoja que corre + 1 paño fijo", () => {
  // Asi lo dice el material (Winart v69117): UN marco monorriel, UNA hoja, UN traslapo.
  // No son dos ventanas acopladas, que es como se dibujaba al caer en el camino de compuesta.
  const it = { producto_label: "Ventana Fija+Corredera", measures: "1500x2100" };
  assert.equal(tipoDe(it), "CORREDERA", "un fija+corredera es una corredera, no una compuesta");
  const p = planoDeVentana(it, CAJA);
  assert.equal(p.hojas.length, 2, "el monorriel se ve con dos paños");
  // ⚠️ Los paños vienen ORDENADOS PARA PINTAR (el de adelante ultimo), no por posicion. Por eso
  // se buscan por ROL y no por indice: si no, el test se rompe solo con cambiar el orden de pintado.
  const movil = p.hojas.find((h) => !h.sinBastidor);
  const fijo = p.hojas.find((h) => h.sinBastidor);
  assert.notEqual(movil.flecha, 0, "el paño que corre lleva flecha");
  assert.equal(movil.sinBastidor, false, "el que corre SI tiene hoja (bastidor)");
  assert.equal(fijo.flecha, 0, "el paño fijo no corre");
  assert.equal(fijo.sinBastidor, true, "el fijo NO lleva bastidor: va directo al marco");
});

test("🔴 NINGUN paño de una Fija+Corredera se dibuja como proyectante", () => {
  // La comprobacion directa del reclamo: el triangulo punteado no puede aparecer en ningun lado.
  for (const lab of ["Ventana Fija+Corredera", "Ventana compuesta Fija+Corredera",
                     "Corredera ANDES 66 Monorriel", "Corredera AMERICANA Monorriel"]) {
    const p = planoDeVentana({ producto_label: lab, measures: "1500x2100" }, CAJA);
    assert.equal(p.hojas.reduce((n, h) => n + h.simbolo.length, 0), 0,
      `"${lab}" no debe llevar ni una diagonal de apertura`);
    assert.ok(p.hojas.some((h) => h.flecha !== 0), `"${lab}" tiene que mostrar hacia donde corre`);
  }
});

test("🔴 la flecha apunta HACIA el paño fijo, como en el plano de Winart", () => {
  // En el plano de Winart (v69117 y v69118) la hoja movil es la IZQUIERDA (A2), la manilla va
  // en su canto izquierdo y la flecha apunta a la DERECHA, hacia el fijo (A1).
  const p = planoDeVentana({ producto_label: "Ventana Fija+Corredera", measures: "1500x2100" }, CAJA);
  const movil = p.hojas.find((h) => h.flecha !== 0);
  assert.equal(movil.idx, 0, "la hoja que corre es la IZQUIERDA");
  assert.equal(movil.flecha, 1, "y corre hacia la derecha, hacia el fijo");
});

test("las compuestas que SI son proyectante siguen dibujandose igual", () => {
  // La red que impide que este arreglo se lleve puesto el caso que ya funcionaba.
  const r = partesDesdeLabel({ producto_label: "Ventana compuesta Fijo 1100mm + Proyectante 1000mm" }, 2100, 1500);
  assert.deepEqual(r.partes.map((p) => p.tipo), ["FIJA", "PROYECTANTE"]);
  const p = planoDeVentana({ producto_label: "Ventana compuesta Fijo 1100mm + Proyectante 1000mm", measures: "2100x1500" }, CAJA);
  const proy = p.hojas.find((h) => h.tipo === "PROYECTANTE");
  assert.equal(proy.simbolo.length, 2, "el proyectante conserva sus dos diagonales");
  assert.equal(proy.flecha, 0, "y NO lleva flecha");
});

test("🔴 'americana' como AMBIENTE no convierte una ventana en corredera", () => {
  // En este repo "americana" tambien es un ambiente de la casa (cocina americana), no solo la
  // linea de ventanas. El `esAmericana` viejo no tenia este riesgo porque no decidia el TIPO:
  // solo el bastidor y la flecha de una ventana que YA era corredera. Al generalizarlo a
  // `esMonorriel` y usarlo para clasificar, una proyectante en una cocina americana se dibujaba
  // como corredera. Lo cazo Codex en la compuerta cruzada.
  assert.equal(tipoDe({ producto_label: "Proyectante S60 cocina americana" }), "PROYECTANTE");
  assert.equal(tipoDe({ producto_label: "Puerta abatible cocina americana" }), "PUERTA");
  assert.equal(tipoDe({ producto_label: "Oscilobatiente cocina americana" }), "OSCILOBATIENTE");
  // y la linea AMERICANA de verdad sigue siendo el monorriel que es
  assert.equal(tipoDe({ producto_label: "Corredera AMERICANA Monorriel" }), "CORREDERA");
});

test("🔴 la guardia NO puede tapar un monorriel que menciona otra apertura de pasada", () => {
  // La guardia de arriba va SOLO sobre la señal debil (la palabra "americana" suelta). Si tapara
  // tambien la señal fuerte, un "Corredera monorriel para salida a puerta de terraza" quedaba
  // descartado por la palabra "puerta" de una DESCRIPCION y se dibujaba con DOS hojas moviles
  // en vez de una. Lo cazo Gemini en la segunda pasada de la compuerta cruzada.
  const it = { producto_label: "Corredera monorriel para salida a puerta de terraza", measures: "2000x2100" };
  assert.equal(tipoDe(it), "CORREDERA");
  const p = planoDeVentana(it, CAJA);
  assert.equal(p.hojas.filter((h) => h.flecha !== 0).length, 1, "un monorriel tiene UNA hoja que corre");
  assert.equal(p.hojas.filter((h) => h.sinBastidor).length, 1, "y la otra es el paño fijo");
});

// ── LA MANILLA Y EL ORDEN DE LOS PAÑOS (2026-09-11) ──────────────────────────────────────
// 🔴 Reclamo del dueño comparando nuestro dibujo con el plano de Winart, textual:
//   «LA IMAGEN DEBE PARECER MONORRIEL Y LA MANILLA IGUAL PORQUE SE VE FALSA LA QUE ESTAMOS
//    ENTREGANDO»
// Eran dos cosas distintas:
//  1. A la corredera se le dibujaba la manilla de ROSETA + PALANCA, que es la de una ventana que
//     ABATE. Una corredera lleva manilla de EMBUTIR (la FORNAX del listado de materiales): una
//     barra angosta hundida en el montante. Por eso se veia falsa.
//  2. El paño FIJO se dibujaba MAS SALIENTE que la hoja movil (heredaba la regla de la corredera
//     de dos hojas: par atras / impar adelante), y su canto quedaba como un POSTE grueso en medio
//     de la ventana que en el plano de Winart no existe. En un monorriel hay UNA via: la hoja que
//     corre va adelante y el fijo va al ras, dentro del marco.

test("🔴 la corredera lleva manilla QUE GIRA, larga — nunca de embutir", () => {
  // 🔴 CORRECCION DEL DUEÑO, y me desdice a mi mismo del mismo dia. Textual:
  //   *"pero SIEMPRE usa manilla que gira LARGA, nunca de embutir"*.
  // Yo habia cambiado la corredera a una manilla de EMBUTIR (barra angosta hundida) porque
  // asumi que la FORNAX del listado de materiales (HI-MLA-FNX) era de ese tipo — lo deduje
  // del CODIGO del herraje, no de haber visto la pieza. Estaba mal y alcanzo a llegar a
  // produccion antes de que el dueño lo viera.
  // La leccion es la misma de todo el dia: un codigo de herraje NO dice como se ve la pieza.
  const p = planoDeVentana({ producto_label: "Corredera ANDES 66 Monorriel", measures: "1500x2100" },
    { x: 0, y: 0, w: 156, h: 200 });
  const movil = p.hojas.find((h) => !h.sinBastidor);
  const f = manillaFormas(movil.manilla);
  assert.ok(f.roseta && f.palanca, "la corredera lleva roseta + palanca, como la que abate");
  assert.equal(f.barra, undefined, "NO es una barra de embutir");
  // y LARGA: al menos los 120 mm de la constante, no los 160 angostos que le habia puesto.
  // [2026-09-18] ERA `=== 120`. Ahora puede salir MAS grande, a pedido del dueño: *"ademas
  // poner manilla grande para que se vea mejor"*. A la escala de la propuesta los 120 mm reales
  // daban ~7 px y la manilla no se leia. Se le puso un piso en PIXELES, asi que en cajas chicas
  // la manilla equivale a mas milimetros de los reales. Lo que este test protege sigue igual:
  // que sea LARGA y de roseta+palanca. Por eso pasa a ">=" en vez de aflojarse a cualquier cosa.
  assert.ok(Math.round(movil.manilla.h / p.escala) >= 120,
    `la manilla tiene que ser larga; salio ${Math.round(movil.manilla.h / p.escala)} mm equivalentes`);
});

test("🔴 una ventana que ABATE conserva su cremona de roseta y palanca", () => {
  // La red que impide que el cambio de la corredera se lleve puesta la manilla de las demas.
  // Caja del TAMAÑO REAL de la propuesta (156x196 px por fila): con la CAJA mini de arriba la
  // cremona no alcanza el tamaño minimo para dibujar el detalle y manillaFormas devuelve null
  // — limite viejo del dibujante, no de este cambio.
  const p = planoDeVentana({ producto_label: "Ventana abatible S60", measures: "800x1200" }, { x: 0, y: 0, w: 156, h: 196 });
  const f = manillaFormas(p.hojas.find((h) => h.manilla).manilla);
  assert.ok(f.roseta && f.palanca, "la abatible sigue con roseta + palanca");
  assert.ok(!f.corredera);
});

test("🔴 en el monorriel la hoja que corre va ADELANTE y el fijo no esta en riel", () => {
  const p = planoDeVentana({ producto_label: "Ventana Fija+Corredera", measures: "1500x2100" }, CAJA);
  assert.equal(p.hojas.find((h) => !h.sinBastidor).riel, 1, "la hoja movil va adelante");
  assert.equal(p.hojas.find((h) => h.sinBastidor).riel, null, "el paño fijo no corre por ningun riel");
  // y se pinta ADELANTE: el orden de la lista es orden de pintado, el ultimo queda arriba
  assert.equal(p.hojas[p.hojas.length - 1].sinBastidor, false, "la hoja movil se pinta encima del fijo");
});

test("la corredera de DOS hojas moviles conserva sus dos rieles", () => {
  // Otra red: el cambio es solo del monorriel. En una corredera de 2 hojas las dos corren, y
  // cada una va por su riel — eso lo corrigio el dueño en agosto y no se toca.
  const p = planoDeVentana({ producto_label: "Corredera SLIDING H98 Doble Riel S75", measures: "2000x1500" }, CAJA);
  assert.deepEqual(p.hojas.map((h) => h.riel), [0, 1]);
});

test("🔴 cada corredera se dibuja con SU perfil de hoja, no todas con 80", () => {
  // 🔴 Correccion del dueño mirando el dibujo al lado del plano de Winart, textual:
  //   «EL MARCO TIENE POR EJEMPLO UNA ALTURA Y LA HOJA OTRA Y LAS PUSISTE A LA MISMA ALTURA
  //    ME REFIERO AL PERFIL»
  // El item casi nunca trae `hoja_mm`, asi que TODA corredera caia al default de 80 mm: una
  // "ANDES 66" se dibujaba con hoja de 80 y una "SLIDING H98" tambien. El numero estaba escrito
  // en el propio label del motor y el dibujo no lo leia.
  const mm = (it) => {
    const p = planoDeVentana({ measures: "2000x1500", ...it }, { x: 0, y: 0, w: 156, h: 196 });
    return Math.round(p.perfilHoja / p.escala);
  };
  assert.equal(mm({ producto_label: "Corredera ANDES 66 Monorriel" }), 66);
  // 🔴 ESTE ASERTO DECIA 54 Y ERA MIO, Y ESTABA MAL. Yo habia asumido que el "54" de
  // "ANDES 54" era el frente de la hoja en elevacion. NO LO ES: la ficha del ANDES MONORRIEL
  // acota hoja 66 para una linea cuyo nombre tambien trae 66, pero las cuatro versiones que
  // baje de Winart daban otro numero para ese mismo campo. El 54/66 es otra cota del sistema.
  // Como del ANDES DOBLE RIEL NO tenemos ficha, hereda declaradamente los numeros del S75 en
  // vez de inventar: es lo que dice su `fuente` en la tabla PERFILES. Cuando llegue la ficha,
  // se cambia el numero en la tabla y este aserto pasa a ser el de la ficha. (#719)
  assert.equal(mm({ producto_label: "Corredera ANDES 54 Doble Riel" }), 80);
  assert.equal(mm({ producto_label: "Corredera SLIDING H98 Doble Riel S75" }), 98);
  assert.equal(mm({ producto_label: "Corredera SLIDING H80 Doble Riel S75" }), 80);
  // el campo explicito manda por sobre la etiqueta
  assert.equal(mm({ producto_label: "Corredera ANDES 66 Monorriel", hoja_mm: 54 }), 54);
});

test("🔴 el marco y la hoja NO miden lo mismo", () => {
  // Es el punto del reclamo: son dos perfiles distintos y tienen que verse distintos.
  for (const lab of ["Corredera ANDES 66 Monorriel", "Corredera SLIDING H98 Doble Riel S75",
                     "Ventana abatible S60"]) {
    const p = planoDeVentana({ producto_label: lab, measures: "2000x1500" }, { x: 0, y: 0, w: 156, h: 196 });
    const marco = Math.round(p.marco / p.escala), hoja = Math.round(p.perfilHoja / p.escala);
    assert.notEqual(marco, hoja, `${lab}: marco ${marco} y hoja ${hoja} no pueden ser iguales`);
  }
});

test("🎯 ANDES MONORRIEL: marco 50 y hoja 66, de la ficha de HAUSTEK", () => {
  // 🔴 Correccion del dueño, textual: *"la monorriel la hoja tiene 66mm y el marco 50mm, revisa
  // la imagen"* — mando el corte acotado de la ficha ANDES MONORRIEL de HAUSTEK. Antes se
  // dibujaba marco 48 / hoja 80 y el marco se veia *"como si tuviera esteroides"*.
  //
  // ⚠️ LA TRAMPA QUE ME COMI, ANOTADA PARA NO REPETIRLA: antes de la ficha saque los numeros del
  // `webccExport` de Winart (ps.f=36, ps.sa=52). Daban IGUALES en cuatro versiones ANDES, asi que
  // los di por buenos — pero yo habia supuesto que esos campos eran el frente en elevacion, y no
  // lo son. Cuatro mediciones consistentes del campo equivocado dan cuatro veces el numero
  // equivocado: la consistencia no valida la interpretacion.
  const perfiles = (it) => {
    const p = planoDeVentana({ measures: "1500x2100", ...it }, { x: 0, y: 0, w: 156, h: 196 });
    return { marco: Math.round(p.marco / p.escala), hoja: Math.round(p.perfilHoja / p.escala) };
  };
  assert.deepEqual(perfiles({ producto_label: "Corredera ANDES 66 Monorriel" }), { marco: 50, hoja: 66 });
  // "mitad fija mitad corredera" es monorriel y es ANDES (decision del dueño), asi que lleva
  // los mismos perfiles aunque el label no nombre la linea.
  assert.deepEqual(perfiles({ producto_label: "Ventana Fija+Corredera" }), { marco: 50, hoja: 66 });
});

test("🔴 lo que NO tiene ficha conserva sus perfiles", () => {
  // Solo tenemos la ficha del ANDES MONORRIEL. El doble riel ANDES tiene la suya y no la tenemos;
  // AMERICANA es otra linea. No se les cambia el dibujo sin el dato. (#719)
  const marco = (lab) => {
    const p = planoDeVentana({ producto_label: lab, measures: "1500x2100" }, { x: 0, y: 0, w: 156, h: 196 });
    return Math.round(p.marco / p.escala);
  };
  assert.equal(marco("Corredera ANDES 54 Doble Riel"), 48);
  assert.equal(marco("Corredera AMERICANA Monorriel"), 48);
  assert.equal(marco("Corredera SLIDING H98 Doble Riel S75"), 48);
  assert.equal(marco("Ventana abatible S60"), 40);
});

test("🎯 ANDES MONORRIEL: el dibujo reproduce las TRES cotas del corte de HAUSTEK", () => {
  // 🔴 El dueño mando el corte acotado y dijo: *"la imagen es exactamente como queda la hoja
  // sobre el marco"* y *"la hoja es mas alta, las dejaste del mismo alto"*. Las cotas de la
  // ficha cierran solas y son la prueba:
  //     marco 50 · hoja 66 · y del conjunto: 34 y 100
  //     34 + 66 = 100  =>  del marco quedan 34 A LA VISTA  =>  la hoja PISA 50 - 34 = 16 mm
  // Usabamos un pisado de 8 mm (medido sobre el DXF de una SLIDING S75, que es OTRA LINEA) y
  // por eso quedaban 42 de marco visible en vez de 34: el marco se veia mas gordo de lo que es.
  const p = planoDeVentana({ producto_label: "Corredera ANDES 66 Monorriel", measures: "1500x2100" },
    { x: 0, y: 0, w: 156, h: 200 });
  const mm = (v) => Math.round(v / p.escala);
  const movil = p.hojas.find((h) => !h.sinBastidor);
  const marcoALaVista = mm(movil.x - p.marcoRect.x);
  const hoja = mm(movil.vidrioRect.x - movil.x);
  assert.equal(marcoALaVista, 34, "marco a la vista");
  assert.equal(hoja, 66, "frente de la hoja");
  assert.equal(marcoALaVista + hoja, 100, "el conjunto");
  // y lo que el dueño repitio tres veces: la hoja NO puede verse igual o menor que el marco
  assert.ok(hoja > marcoALaVista * 1.5, `la hoja (${hoja}) tiene que verse bastante mas que el marco (${marcoALaVista})`);
});

test("🔴 el paño FIJO lleva marco + junquillo, no el ancho del bastidor", () => {
  // *"el marco se ve el doble que la hoja vista de elevacion"*. MEDIDO: el lado fijo daba 108 mm
  // contra los 66 de la hoja. La causa: el calculo miraba el tipo de la VENTANA y no el del PAÑO,
  // asi que al fijo —que no tiene hoja— le metia el vidrio 66 mm adentro como si la tuviera.
  const p = planoDeVentana({ producto_label: "Corredera ANDES 66 Monorriel", measures: "1500x2100" },
    { x: 0, y: 0, w: 156, h: 200 });
  const mm = (v) => Math.round(v / p.escala);
  const fijo = p.hojas.find((h) => h.sinBastidor);
  const banda = mm((p.marcoRect.x + p.marcoRect.w) - (fijo.vidrioRect.x + fijo.vidrioRect.w));
  assert.ok(banda < 70, `el lado fijo mide ${banda} mm; con el bastidor fantasma daba 108`);
});

/* =========================================================================
 * 🔴 [2026-09-18] LA FIGURA MOSTRABA DOS HOJAS EN UNA VENTANA DE TRES
 *
 * Reclamo del dueño sobre la propuesta REAL CM-FR-004-2026-0478 (Mario Grey), textual:
 * *"la figura deberia tener 3 hojas reales por medidas"*.
 * El PRECIO estaba bien ($759.729, el de 3 hojas). Lo unico equivocado era el dibujo — que es
 * justo lo que el cliente mira y aprueba.
 *
 * Dos fallos encadenados, medidos leyendo el item tal como quedo guardado en la tabla `quotes`:
 *   1. El item NO trae `corredera` (el bloque del motor con el n.o de hojas se pierde antes del
 *      PDF), asi que la unica fuente es el texto.
 *   2. El texto decia "Triple hoja" EN PALABRA y el regex pedia un DIGITO: /(\d)\s*hoja/.
 * Resultado: caia al default de 2.
 * ========================================================================= */

test('🔴 "Triple hoja" en PALABRA se dibuja con TRES paños', () => {
  const it = { producto_label: 'Corredera SLIDING H98 Doble Riel S75 — Triple hoja (central fija, laterales correderas)' };
  assert.equal(hojasDe(it), 3, 'el regex pedia un digito y el label trae la palabra');
});

test('🔒 las demas palabras-numero tambien (tres/cuatro/cuadruple), y el digito sigue', () => {
  assert.equal(hojasDe({ producto_label: 'Corredera de tres hojas' }), 3);
  assert.equal(hojasDe({ producto_label: 'Corredera cuatro hojas' }), 4);
  assert.equal(hojasDe({ producto_label: 'Corredera cuadruple hoja' }), 4);
  assert.equal(hojasDe({ producto_label: 'Corredera SLIDING 3 hojas' }), 3, 'el digito no se rompio');
  assert.equal(hojasDe({ producto_label: 'Corredera SLIDING H98' }), 2, 'sin dato, el default de corredera');
});

test('🔴 el campo `producto` tambien se lee (asi se llama en el item guardado)', () => {
  // El item de la tabla `quotes` usa `producto`, no `product` ni `producto_label`.
  const it = { producto: 'Corredera SLIDING H98 Doble Riel S75 — Triple hoja (central fija, laterales correderas)' };
  assert.equal(hojasDe(it), 3);
  assert.equal(tipoDe(it), 'CORREDERA', 'sin esto una corredera se dibujaba como pano FIJO');
});

test('🔴 la hoja del MEDIO es una HOJA CORREDERA FIJADA, no un termopanel pegado al marco', () => {
  // Correccion del dueno sobre el primer intento, textual: *"debe quedar con hoja corredera,
  // quedo solo termopanel"*. Y el BOM real de Winart (v69621) le da la razon: factura
  // `PI-SLD-H98` x3 —un perfil de hoja por pano, incluido el fijo— y la pieza que lo inmoviliza
  // se llama `HL-SUP-HCF-MA` = "SUPLE HOJA CORREDERA A FIJA". Es una hoja fijada, con bastidor.
  const it = {
    measures: '2710x1995mm', color: 'Blanco',
    producto_label: 'Corredera SLIDING H98 Doble Riel S75 — Triple hoja (central fija, laterales correderas)',
  };
  const p = planoDeVentana(it, { x: 0, y: 0, w: 400, h: 300 });
  assert.equal(p.hojas.length, 3);
  const medio = p.hojas.find((h) => h.idx === 1);
  assert.equal(medio.sinBastidor, false, 'LLEVA bastidor: es una hoja, no un vidrio suelto');
  assert.equal(medio.tipo, 'CORREDERA', 'el perfil que se fabrica es hoja corredera');
  assert.equal(medio.fijaEnSitio, true, 'pero no corre');
  assert.equal(medio.flecha, 0, 'por eso no lleva flecha de deslizamiento');
  assert.equal(medio.manilla, null, 'ni manilla: cierran contra ella las dos laterales');
});

test('🔴 las dos laterales corren HACIA la fija, como en el dibujo de Winart', () => {
  const it = {
    measures: '2710x1995mm', color: 'Blanco',
    producto_label: 'Corredera SLIDING H98 Doble Riel S75 — Triple hoja (central fija, laterales correderas)',
  };
  const p = planoDeVentana(it, { x: 0, y: 0, w: 400, h: 300 });
  assert.equal(p.hojas.find((h) => h.idx === 0).flecha, 1, 'la izquierda va hacia la derecha');
  assert.equal(p.hojas.find((h) => h.idx === 2).flecha, -1, 'la derecha va hacia la izquierda');
});

test('🔒 una corredera de 3 hojas SIN central fija se dibuja con las tres corriendo', () => {
  const it = { measures: '2710x1995mm', producto_label: 'Corredera SLIDING H98 Triple Riel S75 — 3 hojas' };
  const p = planoDeVentana(it, { x: 0, y: 0, w: 400, h: 300 });
  assert.equal(p.hojas.length, 3);
  assert.ok(p.hojas.every((h) => !h.fijaEnSitio), 'si las 3 corren, ninguna va fijada');
  assert.ok(p.hojas.every((h) => h.flecha !== 0), 'las tres llevan flecha');
});

test('🔒 la corredera de 2 hojas de siempre no se movio', () => {
  const it = { measures: '2000x1450mm', producto_label: 'Corredera SLIDING H80 Doble Riel S75' };
  const p = planoDeVentana(it, { x: 0, y: 0, w: 400, h: 300 });
  assert.equal(p.hojas.length, 2);
  assert.ok(p.hojas.every((h) => h.tipo === 'CORREDERA'));
  assert.deepEqual(p.hojas.map((h) => h.flecha).sort(), [-1, 1]);
});

test('🔴 EL CASO REAL: `product` generico NO puede tapar el nº de hojas del label', () => {
  // Asi llega el item en la propuesta de verdad: product="CORREDERA" (el tipo, sin el nº) y el
  // nº de hojas en producto_label. Con la cadena de OR ganaba "CORREDERA" y salia de 2 hojas.
  // Mi primer arreglo tenia ese bug y el test no lo cazaba porque solo ponia producto_label.
  const it = {
    product: 'CORREDERA',
    producto_label: 'Corredera SLIDING H98 Doble Riel S75 — Triple hoja (central fija, laterales correderas)',
    measures: '2710x1995mm', color: 'Blanco',
  };
  assert.equal(hojasDe(it), 3, 'el label manda aunque product traiga algo generico');
  const p = planoDeVentana(it, { x: 0, y: 0, w: 400, h: 300 });
  assert.equal(p.hojas.length, 3);
  const medio = p.hojas.find((h) => h.idx === 1);
  assert.equal(medio.fijaEnSitio, true, 'y la central sigue fijada');
  assert.equal(medio.sinBastidor, false, 'con su hoja corredera');
});

test('🔴 TRIPLE RIEL: tres hojas en TRES vias distintas, no dos', () => {
  // Reclamo del dueno mirando la propuesta renderizada, textual: *"te quedo como 2 rieles, las
  // hojas se desplazan sobre rieles diferentes"*. `repartirHojas` alterna par/impar porque
  // asume DOS vias (correcto para el doble riel, lo unico que existia hasta hoy).
  const it = {
    product: 'CORREDERA', measures: '2710x1995mm', color: 'Blanco',
    producto_label: 'Corredera SLIDING H98 Triple Riel S75 — Triple hoja, las tres corren',
  };
  const p = planoDeVentana(it, { x: 0, y: 0, w: 400, h: 300 });
  assert.equal(p.hojas.length, 3);
  assert.deepEqual(p.hojas.map((h) => h.riel).sort(), [0, 1, 2], 'una via por hoja');
});

test('🔴 TRIPLE RIEL: TODAS las flechas al mismo lado (se apilan contra un costado)', () => {
  const it = {
    product: 'CORREDERA', measures: '2710x1995mm', color: 'Blanco',
    producto_label: 'Corredera SLIDING H98 Triple Riel S75 — Triple hoja, las tres corren',
  };
  const p = planoDeVentana(it, { x: 0, y: 0, w: 400, h: 300 });
  const dirs = new Set(p.hojas.map((h) => h.flecha));
  assert.equal(dirs.size, 1, 'en el triple riel no se alternan: van todas al mismo lado');
  assert.ok(!p.hojas.some((h) => h.fijaEnSitio), 'y ninguna va fijada: las tres corren');
});

test('🔒 el doble riel de 2 hojas conserva sus DOS vias y sus flechas enfrentadas', () => {
  // La generalizacion del riel no puede tocar lo que ya se vende todos los dias.
  const p = planoDeVentana(
    { product: 'CORREDERA', producto_label: 'Corredera SLIDING H80 Doble Riel S75', measures: '2000x1450mm' },
    { x: 0, y: 0, w: 400, h: 300 });
  assert.equal(p.hojas.length, 2);
  assert.deepEqual(p.hojas.map((h) => h.riel).sort(), [0, 1]);
  assert.deepEqual(p.hojas.map((h) => h.flecha).sort(), [-1, 1]);
});

/* =========================================================================
 * 🔴 [2026-09-18] LA MANILLA VA EN EL LADO DEL MARCO, Y SE TIENE QUE VER
 *
 * Dos correcciones del dueno sobre la figura renderizada:
 *   *"las manillas van en el lado del marco"* (con la figura al lado: flecha a la derecha,
 *   manilla a la izquierda) y *"ademas poner manilla grande para que se vea mejor"*.
 *
 * Lo primero es fisico: la manilla vive en el montante que cierra contra la jamba, no en el
 * traslapo donde se encuentran dos hojas — ahi no habria donde poner el cerradero. Es tambien
 * lo que muestran los planos de Winart (v69621/69622: manillas en los bordes exteriores).
 * ========================================================================= */

test('🔴 la manilla va del lado contrario a la flecha (el lado del marco)', () => {
  const p = planoDeVentana(
    { product: 'CORREDERA', producto_label: 'Corredera SLIDING H98 Doble Riel S75', measures: '2000x1450mm' },
    { x: 0, y: 0, w: 156, h: 120 });
  for (const h of p.hojas) {
    if (!h.manilla) continue;
    const alaIzquierda = h.manilla.x < h.x + h.w / 2;
    assert.equal(alaIzquierda, h.flecha > 0,
      `la hoja que corre hacia ${h.flecha > 0 ? 'la derecha' : 'la izquierda'} cierra del lado contrario: ahi va la manilla`);
  }
});

test('🔒 con la central fija, las dos manillas quedan en los bordes de la ventana', () => {
  // Es la figura de Winart: la del medio sin manilla, y las laterales con la suya contra la jamba.
  const p = planoDeVentana({
    product: 'CORREDERA', measures: '2710x1995mm',
    producto_label: 'Corredera SLIDING H98 Doble Riel S75 — Triple hoja (central fija, laterales correderas)',
  }, { x: 0, y: 0, w: 156, h: 120 });
  assert.equal(p.hojas.find((h) => h.idx === 1).manilla, null, 'la fijada no lleva manilla');
  const izq = p.hojas.find((h) => h.idx === 0);
  const der = p.hojas.find((h) => h.idx === 2);
  assert.ok(izq.manilla.x < izq.x + izq.w / 2, 'la izquierda, a la izquierda');
  assert.ok(der.manilla.x > der.x + der.w / 2, 'la derecha, a la derecha');
});

test('🔴 a la escala de la propuesta la manilla SE VE (no 7 px invisibles)', () => {
  // Caja de 156x120 px, que es la de la fila de la propuesta.
  const p = planoDeVentana(
    { product: 'CORREDERA', producto_label: 'Corredera SLIDING H98 Doble Riel S75', measures: '2710x1995mm' },
    { x: 0, y: 0, w: 156, h: 120 });
  const m = p.hojas.find((h) => h.manilla).manilla;
  assert.ok(m.h >= 12, `la manilla tiene que leerse; salio de ${m.h.toFixed(1)} px de largo`);
  assert.ok(m.w >= 3, `y tener cuerpo; salio de ${m.w.toFixed(1)} px de grueso`);
});

test('🔒 pero nunca se sale de su hoja ni le tapa el vidrio', () => {
  for (const med of ['2710x1995mm', '800x2400mm', '600x600mm', '5000x1200mm']) {
    const p = planoDeVentana(
      { product: 'CORREDERA', producto_label: 'Corredera SLIDING H98 Doble Riel S75', measures: med },
      { x: 0, y: 0, w: 156, h: 120 });
    for (const h of p.hojas) {
      if (!h.manilla) continue;
      assert.ok(h.manilla.h <= h.h, `${med}: la manilla no puede ser mas alta que su hoja`);
      assert.ok(h.manilla.w <= h.w, `${med}: ni mas ancha`);
    }
  }
});

test('🔴 la cota del VIDRIO sale en el dibujo, y solo si el motor la calculo', () => {
  // Pedido del dueno: *"a seria prudente para que cliente asocie eso"* — el informe de
  // resistencia habla del pano, no de la ventana.
  const base = {
    product: 'CORREDERA', measures: '2710x1995mm',
    producto_label: 'Corredera SLIDING H98 Doble Riel S75 — Triple hoja (central fija, laterales correderas)',
  };
  const con = planoDeVentana({ ...base, pano_vidrio: { ancho_mm: 770, alto_mm: 1747, panos: 3 } },
    { x: 0, y: 0, w: 156, h: 120 });
  assert.equal(con.etiquetaVidrio, 'vidrio 770×1747 mm');  // sin glass_label no se afirma termopanel
  assert.equal(con.etiqueta, '2710×1995 mm', 'la de la ventana no se toca');
  // Sin el dato NO se inventa: una medida de vidrio falsa en un plano es peor que ninguna.
  assert.equal(planoDeVentana(base, { x: 0, y: 0, w: 156, h: 120 }).etiquetaVidrio, null);
  assert.equal(planoDeVentana({ ...base, pano_vidrio: { ancho_mm: 0, alto_mm: 1747 } },
    { x: 0, y: 0, w: 156, h: 120 }).etiquetaVidrio, null);
});

/* =========================================================================
 * 🔴 [2026-09-18] LA DEL CENTRO NO LLEVA MANILLA, Y LA COTA DICE "TERMOPANEL"
 *
 * Dos correcciones del dueno mirando el triple riel renderizado:
 *   *"la del centro es sin manilla"*
 *   *"donde dice vidrio deberia decir termopanel porque confundiria al cliente: si lee vidrio
 *    podria pensar que no es termopanel"*
 * ========================================================================= */

test('🔴 en las de 3 hojas van DOS manillas, no tres — tambien en el triple riel', () => {
  // MEDIDO en los cuatro listados de materiales de Winart: `HI-MLA-FNX` x2 en v69621, v69622,
  // v69623 y v69624. Dos manillas y dos cremonas en todos, corran dos hojas o corran las tres.
  // La razon fisica: la manilla cierra contra la JAMBA, y la del medio no toca ninguna.
  for (const lab of [
    'Corredera SLIDING H98 Triple Riel S75 — Triple hoja, las tres corren',
    'Corredera SLIDING H98 Doble Riel S75 — Triple hoja (central fija, laterales correderas)',
  ]) {
    const p = planoDeVentana({ product: 'CORREDERA', producto_label: lab, measures: '2710x1995mm' },
      { x: 0, y: 0, w: 156, h: 120 });
    assert.equal(p.hojas.length, 3, lab);
    assert.equal(p.hojas.filter((h) => h.manilla).length, 2, `${lab}: Winart factura 2 manillas`);
    assert.equal(p.hojas.find((h) => h.idx === 1).manilla, null, 'la del medio, ninguna');
  }
});

test('🔒 la corredera de 2 hojas conserva sus dos manillas', () => {
  const p = planoDeVentana(
    { product: 'CORREDERA', producto_label: 'Corredera SLIDING H80 Doble Riel S75', measures: '2000x1450mm' },
    { x: 0, y: 0, w: 156, h: 120 });
  assert.equal(p.hojas.filter((h) => h.manilla).length, 2);
});

test('🔴 la cota dice TERMOPANEL cuando lo es — no "vidrio", que siembra la duda', () => {
  const mk = (glass_label) => planoDeVentana({
    product: 'CORREDERA', producto_label: 'Corredera SLIDING H98 Doble Riel S75',
    measures: '2710x1995mm', glass_label, pano_vidrio: { ancho_mm: 770, alto_mm: 1747, panos: 3 },
  }, { x: 0, y: 0, w: 156, h: 120 });
  for (const g of ['DVH 5+12+5', 'Termopanel 4+12+4', 'TP-M-5+12+5']) {
    assert.match(mk(g).etiquetaVidrio, /^termopanel /, g);
  }
});

test('🔴 pero NO se miente al reves: un vidrio simple dice "vidrio"', () => {
  // Hay 18 vidrios simples cotizables en el catalogo. Rotular un monolitico como "termopanel"
  // seria peor que la duda que esto viene a evitar.
  const mk = (glass_label) => planoDeVentana({
    product: 'CORREDERA', producto_label: 'Corredera SLIDING H98 Doble Riel S75',
    measures: '2710x1995mm', glass_label, pano_vidrio: { ancho_mm: 770, alto_mm: 1747, panos: 3 },
  }, { x: 0, y: 0, w: 156, h: 120 });
  for (const g of ['Monolitico 4mm', 'LM-8MM', 'espejo 3mm', '']) {
    assert.match(mk(g).etiquetaVidrio, /^vidrio /, g || '(sin dato)');
  }
});
