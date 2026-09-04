// caption-informe.test.js — [2026-09-04]
//
// EL CLIENTE TIENE QUE SABER QUE LE ESTAMOS MANDANDO.
//
// Pedido del dueño, textual: *"debemos indicarle a cliente antes lo que le enviamos porque no
// sabe que tiene el archivo adentro"*.
//
// 🔴 QUE PASABA: el informe termico salia con `Informe termico de Vilcun` y el de vientos con
// `Informe de vientos de sus ventanas`. Una linea para un PDF de varias paginas. Un documento
// que el cliente no sabe para que sirve no se abre — y si no se abre, no vendio nada.
//
// LO QUE ESTE ARCHIVO FIJA, y es lo unico que importa: que el texto NO PROMETA UNA SECCION QUE
// EL PDF NO TIENE. Es la regla que ya regia el caption de vientos ("el caption promete clima
// SOLO si el bloque vino del motor"), extendida al termico. Prometer de mas es peor que no
// describir nada: el cliente abre el documento buscando algo que no esta.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { captionTermico, captionVientos, MAX_CAPTION } from './captionInforme.js';

describe('captionTermico', () => {
  const COMPLETO = {
    comuna: 'Vilcún', tieneUwNorma: true, tieneVeredicto: true,
    tieneCondensacion: true, tieneIsotermas: true,
  };

  test('con todo, se nombran las cuatro cosas y la comuna', () => {
    const c = captionTermico(COMPLETO);
    assert.match(c, /Vilcún/);
    assert.match(c, /NCh 1079/, 'la norma que da la zona térmica');
    assert.match(c, /transmitancia|Uw/i, 'el máximo que permite la norma');
    assert.match(c, /su\* ventana|su ventana/i, 'el cálculo de SU ventana');
    assert.match(c, /condensar|llorar/i, 'la condensación, en palabras del cliente');
  });

  test('🔴 SIN veredicto de Uw, NO se promete el cálculo de su ventana', () => {
    // Prometer una sección que el PDF no trae es peor que no describirlo: el cliente lo abre
    // buscando algo que no está y siente que le vendimos humo.
    const c = captionTermico({ ...COMPLETO, tieneVeredicto: false });
    assert.doesNotMatch(c, /si cumple|su\* ventana/i);
    assert.match(c, /NCh 1079/, 'pero lo que SI trae se sigue nombrando');
  });

  test('🔴 SIN condensación ni isotermas, tampoco se nombran', () => {
    const c = captionTermico({ ...COMPLETO, tieneCondensacion: false, tieneIsotermas: false });
    assert.doesNotMatch(c, /condensar|llorar/i);
    assert.doesNotMatch(c, /isoterma|corte del cálculo/i);
  });

  test('la comuna de REFERENCIA se avisa antes, no se esconde en el PDF', () => {
    // Si los datos climáticos no son de su comuna, el cliente lo va a leer adentro igual.
    // Decírselo antes es honestidad; callarlo es que lo descubra y desconfíe del resto.
    const c = captionTermico({ ...COMPLETO, esReferenciaRegional: true });
    assert.match(c, /referencia/i);
  });

  test('sin comuna no se rompe ni queda un guión suelto', () => {
    const c = captionTermico({ tieneUwNorma: true });
    assert.doesNotMatch(c, /— *\n|—\s*\*/, 'sin comuna, sin guión colgando');
    assert.ok(c.length > 40);
  });

  test('dice que es un documento formal con folio', () => {
    // Es la diferencia entre "un PDF que me mandaron" y "un documento que puedo presentar".
    assert.match(captionTermico(COMPLETO), /folio/i);
  });
});

describe('captionVientos', () => {
  test('nombra cuántas ventanas se calcularon, en plural o singular', () => {
    assert.match(captionVientos({ comuna: 'Freire', nVentanas: 1 }), /su ventana/i);
    assert.match(captionVientos({ comuna: 'Freire', nVentanas: 3 }), /sus 3 ventanas/i);
  });

  test('🔴 el clima se promete SOLO si vino del motor (regla que ya existía)', () => {
    // Es la regla que la compuerta cruzada dejó escrita el 28-ago para el caption viejo, y
    // que este cambio conserva: el título decía "y clima" aunque el bloque no viniera.
    const sin = captionVientos({ comuna: 'Freire', tieneClima: false, nVentanas: 2 });
    assert.doesNotMatch(sin, /clima|humedad|radiación/i);
    const con = captionVientos({ comuna: 'Freire', tieneClima: true, nVentanas: 2 });
    assert.match(con, /clima/i);
  });

  test('siempre dice lo esencial: la presión y si el sistema aguanta', () => {
    const c = captionVientos({ comuna: 'Toltén', nVentanas: 2 });
    assert.match(c, /presi[óo]n de viento/i);
    assert.match(c, /aguanta|resist/i);
  });
});

describe('el límite de WhatsApp', () => {
  test('ningún caption supera el tope, ni con todo activado', () => {
    // WhatsApp corta cerca de los 1.024 caracteres. Pasarse no da error visible: TRUNCA, y el
    // cliente lee media frase.
    const t = captionTermico({ comuna: 'San José de la Mariquina', tieneUwNorma: true,
      tieneVeredicto: true, tieneCondensacion: true, tieneIsotermas: true, esReferenciaRegional: true });
    const v = captionVientos({ comuna: 'San José de la Mariquina', tieneClima: true, nVentanas: 13 });
    assert.ok(t.length <= MAX_CAPTION, `térmico mide ${t.length}`);
    assert.ok(v.length <= MAX_CAPTION, `vientos mide ${v.length}`);
    // Y con aire: si un día se agrega una línea, no tiene que quedar al borde.
    assert.ok(t.length < MAX_CAPTION * 0.6, `térmico usa ${t.length} de ${MAX_CAPTION}`);
  });
});
