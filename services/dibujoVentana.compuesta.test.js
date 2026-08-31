// ── El dibujo de la compuesta no puede inventar panos ────────────────────────
// [2026-08-31] Reclamo del dueno sobre la propuesta CM-FR-004-2026-0395-B, textual:
// "esa solo debio tener una proyectante arriba y una fija abajo". El PDF mostraba CUATRO
// panos apilados (proyectante, fija, proyectante, fija). El PRECIO estaba bien ($275.491 =
// las dos partes + el perfil que las une); lo que mentia era el DIBUJO, que es justamente
// lo que el cliente mira.
// CAUSA: `partesDesdeLabel` pegaba `product` + `producto_label` SIEMPRE, y cuando los dos
// traian la misma descripcion el buscador de panos la encontraba dos veces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { partesDesdeLabel, claveVidrio } from './dibujoVentana.js';

const L = 'Ventana compuesta vertical: Proyectante 748.5mm (arriba) + Fijo 748.5mm (abajo)';

test('🔴 los dos campos con el MISMO texto no duplican los panos', () => {
  const r = partesDesdeLabel({ product: L, producto_label: L }, 600, 1500);
  assert.ok(r, 'tiene que reconocer la compuesta');
  assert.equal(r.partes.length, 2, 'una proyectante arriba y una fija abajo, no cuatro');
  assert.equal(r.partes[0].tipo, 'PROYECTANTE');
  assert.equal(r.partes[1].tipo, 'FIJA');
});

test('los caminos de siempre siguen dando lo mismo', () => {
  for (const it of [{ producto_label: L }, { product: L }, { product: L, producto_label: 'Ventana' }]) {
    const r = partesDesdeLabel(it, 600, 1500);
    assert.ok(r, `no reconocio la compuesta en ${JSON.stringify(it).slice(0, 50)}`);
    assert.equal(r.partes.length, 2);
  }
});

test('🛟 los panos tienen que SUMAR la ventana, o no se dibujan', () => {
  // La red que caza cualquier lectura de mas, no solo la duplicacion. Un label que declara
  // panos que no caben en la medida real no puede terminar en el papel del cliente.
  const imposible = 'Ventana compuesta vertical: Proyectante 1200mm (arriba) + Fijo 1200mm (abajo)';
  assert.equal(partesDesdeLabel({ producto_label: imposible }, 600, 1500), null,
    '1200+1200 no cabe en 1500: mejor un dibujo simple que uno que no es su ventana');
  // Y la tolerancia real: 748.5+748.5 = 1497 en una ventana de 1500 (los 3 mm son el perfil).
  const r = partesDesdeLabel({ producto_label: L }, 600, 1500);
  assert.equal(r.partes.length, 2, 'la diferencia por el perfil que las une NO puede descartarlas');
});

test('una mencion suelta de "compuesta" sigue sin generar panos', () => {
  assert.equal(partesDesdeLabel({ producto_label: 'Ventana Fija' }, 600, 1500), null);
});

// ── El vidrio del baño no puede verse transparente ───────────────────────────
// [2026-08-31] Reclamo del dueno, textual: "a saten colocale un vidrio color saten, que es un
// vidrio que no deja ver en ninguna de las 2 direcciones, porque en la cotizacion se ve como
// si fuera vidrio normal". Dos defectos encadenados:
//   1. `claveVidrio` buscaba "satin" SIN tilde y el vidrio se rotula "saten" CON tilde, asi
//      que no calzaba y caia a incoloro. Un defecto de una sola letra.
//   2. Aun detectandolo, el color guardado (#E8ECEF) era casi el mismo celeste del incoloro
//      (#DEEBF7): en el PDF no se distinguian.
// Y la regla que pidio despues: "si dice bano ponerle [saten], porque el cliente puede decir
// o escribir de cualquier manera".

test('🔴 el saten se reconoce CON tilde, que es como lo rotula el motor', () => {
  assert.equal(claveVidrio('Termopanel DVH 4+12+4 satén (baño)'), 'satinado');
  assert.equal(claveVidrio('Termopanel DVH 4+12+4 saten'), 'satinado');
  assert.equal(claveVidrio('satinado'), 'satinado');
  // Como lo puede nombrar el cliente.
  for (const v of ['vidrio mate', 'opaco', 'translucido', 'esmerilado', 'acidado']) {
    assert.equal(claveVidrio(v), 'satinado', `"${v}" tiene que ser saten`);
  }
});

test('🔴 si el ambiente es baño va saten, escriba el cliente como escriba', () => {
  // Red de seguridad: no depende de como venga rotulado el vidrio.
  for (const a of ['Baño', 'bano', 'BAÑO', 'baño principal', 'WC', 'Ducha', 'banera']) {
    assert.equal(claveVidrio('Termopanel DVH 4+12+4', a), 'satinado',
      `ambiente "${a}" tiene que salir con vidrio que no se ve`);
  }
});

test('y lo que NO es baño sigue con vidrio transparente', () => {
  for (const a of ['Cocina', 'Living', 'Dormitorio', '', undefined]) {
    assert.equal(claveVidrio('Termopanel DVH 5+12+5', a), 'incoloro');
  }
  assert.equal(claveVidrio('Termopanel DVH bronce'), 'bronce');
  assert.equal(claveVidrio('Termopanel gris'), 'gris');
});
