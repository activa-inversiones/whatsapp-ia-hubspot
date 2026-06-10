// oliverProduct.test.js — RED ANTI-REGRESIÓN Oliver — GT-02 (producto especial → handoff cálido, no corte ciego)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyProduct, warmHandoffMessage } from './oliverProduct.js';

test('GT-02: pedido REAL de producto especial → handoff cálido (Activa lo fabrica)', () => {
  for (const t of ['quiero una mampara templada 1220x2300', 'necesito un cierre de terraza', 'cotizar muro cortina para mi edificio', 'ventanas de aluminio para la casa', 'me interesan unas lucarnas']) {
    const r = classifyProduct(t);
    assert.equal(r.specialRequest, true, `"${t}" debe ir a handoff cálido (no corte)`);
  }
});

test('GT-02b: MENCIÓN DE PASO no escala — el cliente quiere PVC nuevo, no el "especial"', () => {
  // El bug: "retiro de aluminio" cortaba la venta. Ahora fluye a cotizar.
  for (const t of ['quiero cambiar mis ventanas viejas de aluminio por pvc', 'retiro de ventanas de aluminio antiguas', 'sacar las mamparas viejas y poner ventanas pvc']) {
    const r = classifyProduct(t);
    assert.equal(r.specialRequest, false, `"${t}" es mención de paso → NO escalar, dejar cotizar`);
  }
});

test('productos PVC normales NO se clasifican como especiales (fluyen a cotizar)', () => {
  for (const t of ['ventana pvc corredera 1200x1000 blanco', 'puerta pvc línea europea', 'quiero 3 ventanas termopanel']) {
    assert.equal(classifyProduct(t).specialRequest, false, `"${t}" debe cotizarse normal`);
  }
});

test('el mensaje de handoff es CÁLIDO (afirma que se fabrica + pide hora, no corta en frío)', () => {
  const msg = warmHandoffMessage('mampara', 'Marcelo', 'Claudio');
  assert.match(msg, /fabricamos/i, 'debe afirmar que SÍ se fabrica');
  assert.match(msg, /Marcelo/, 'menciona al especialista');
  assert.match(msg, /hora|contacte/i, 'captura: pide hora de contacto');
});
