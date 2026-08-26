// huella-informe.test.js — [2026-08-26]
//
// 🔴 QUÉ HACE QUE UN INFORME TÉRMICO SEA **OTRO** INFORME.
//
// El candado de 30 días existe para no mandarle al mismo cliente el mismo informe una y otra
// vez. Pero miraba SOLO el teléfono, y con eso bloqueaba informes que sí corresponden.
//
// Regla del dueño, textual: "es de sentido común que si el cliente coloca que es de la comuna
// de Temuco al principio, después se equivoca y dice «en realidad yo soy de Cunco»,
// claramente debemos entregarle la propuesta nueva con la reglamentación térmica de esa
// comuna... lo de los treinta días es solo para si el cliente NO sufre modificaciones".
//
// Caso medido: Paula tiene el CM-FR-006-2026-0008 emitido para CUNCO y hoy está en TEMUCO.

import test from 'node:test';
import assert from 'node:assert/strict';
import { huellaDelInforme } from './webhook.js';

const CUNCO = { comuna: 'Cunco', producto: 'Ventana corredera', glassLabel: 'TP-M-5+12+5' };

test('🔴 el caso de Paula: cambiar de comuna es OTRO informe', () => {
  assert.notEqual(huellaDelInforme(CUNCO), huellaDelInforme({ ...CUNCO, comuna: 'Temuco' }));
});

test('🔴 cambiar el PRODUCTO también', () => {
  // "mejor necesito correderas en este proyecto, o proyectante en este otro, o puertas en
  // este otro: todas van a tener térmicas diferentes".
  const base = huellaDelInforme(CUNCO);
  assert.notEqual(base, huellaDelInforme({ ...CUNCO, producto: 'Ventana proyectante' }));
  assert.notEqual(base, huellaDelInforme({ ...CUNCO, producto: 'Puerta corredera' }));
});

test('🔴 y cambiar el VIDRIO: de ahí sale el Uw', () => {
  assert.notEqual(huellaDelInforme(CUNCO), huellaDelInforme({ ...CUNCO, glassLabel: 'TP-M-4+12+4' }));
});

test('🔒 las MEDIDAS no cambian el informe: un proyecto de 8 ventanas es UNO', () => {
  // Si las medidas entraran en la huella, agregar una novena ventana dispararía un informe
  // nuevo — y el dueño describió justo lo contrario: un proyecto con varias ventanas lleva
  // un informe, y recién si cambia el TIPO de producto corresponde otro.
  assert.equal(huellaDelInforme({ ...CUNCO, medidas: '1000x1000' }),
               huellaDelInforme({ ...CUNCO, medidas: '2000x3000' }));
});

test('🔒 la misma comuna escrita distinto es la misma comuna', () => {
  assert.equal(huellaDelInforme({ comuna: 'Cuncó' }), huellaDelInforme({ comuna: 'cunco' }));
  assert.equal(huellaDelInforme({ comuna: ' TEMUCO ' }), huellaDelInforme({ comuna: 'temuco' }));
  assert.equal(huellaDelInforme({ comuna: 'Padre Las Casas' }), huellaDelInforme({ comuna: 'padre-las-casas' }));
});

test('🔒 sin ningún dato la huella queda vacía y manda el candado de siempre', () => {
  // Degradar al comportamiento anterior es preferible a inventar una huella: una huella
  // inventada le daría a cada cliente un informe nuevo en cada cotización.
  for (const v of [{}, { comuna: '', producto: '', glassLabel: '' }, undefined]) {
    assert.equal(huellaDelInforme(v), '');
  }
});

test('🔒 la huella no crece sin límite', () => {
  // Un `producto` larguísimo (el label de una compuesta lo es) no puede hacer una clave de
  // KV interminable.
  const h = huellaDelInforme({ comuna: 'x'.repeat(300), producto: 'y'.repeat(300), glassLabel: 'z'.repeat(300) });
  assert.ok(h.length <= 3 * 40 + 2, `la huella mide ${h.length}`);
});
