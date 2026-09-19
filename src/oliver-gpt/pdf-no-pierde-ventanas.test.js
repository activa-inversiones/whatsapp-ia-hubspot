import test from 'node:test';
import assert from 'node:assert/strict';
import { runTool } from './tools.js';

/* =========================================================================
 * 🔴 EL CLIENTE RECIBIO 16 DE 17 VENTANAS (propuesta 0485, 2026-09-19)
 *
 * El PDF decia, textual:
 *   "PROPUESTA PARCIAL: No incluye la ventana N°13 (proyectante baño 575×375 mm), que Marcelo
 *    cotiza directamente por salir fuera de rango del sistema automático."
 * El motor la cotiza sin problema: $146.400 con IVA (verificado en vivo).
 *
 * QUE PASABA: Oliver cotiza las 17 con `calcular_cotizacion` —y la 13 vuelve OK, con precio—,
 * pero despues, al llamar `generar_pdf_cotizacion`, ELIGE que items manda. Vio el flag
 * `referencial: true` y la dejo afuera. Se le dijo que no lo hiciera en el prompt Y en el
 * resultado de la tool (`_nota_referencial`), pero las dos son INSTRUCCIONES: el LLM puede
 * desobedecerlas, y lo hizo.
 *
 * AUTORIZACION DEL DUEÑO, textual: *"autorizo cotizarla igual para todos los clientes que estan
 * bajo medida y sobre medidas"*.
 *
 * Esta es la garantia MECANICA: lo que se cotizo con precio en el turno no se puede perder de
 * camino al PDF. No depende de que el LLM haga caso.
 * ========================================================================= */

/** Una llamada a calcular_cotizacion que volvio OK, como la arma el agente. */
const cotizada = (ancho, alto, label, extra = {}) => ({
  name: 'calcular_cotizacion',
  input: { tipo: 'PROYECTANTE', medidas_texto: `${ancho}x${alto}mm`, cantidad: 1 },
  result: {
    ok: true, unit_price: 123000, cantidad: 1, producto_label: label,
    glass_label: '4+12+4', medidas_resueltas: `${ancho}x${alto}mm`, ...extra,
  },
});

test('🔴 si una ventana cotizada NO va en el PDF, se avisa a Marcelo', async () => {
  const toolCallsDelTurno = [
    cotizada(410, 580, 'Proyectante S60'),
    cotizada(810, 580, 'Proyectante S60'),
    cotizada(575, 375, 'Proyectante S60', { referencial: true }),   // la N°13
  ];
  let aviso = null;
  let recibido = null;
  await runTool('generar_pdf_cotizacion', {
    // Oliver manda SOLO 2 de las 3: dejo afuera la referencial.
    items: [
      { product: 'Proyectante S60', measures: '410x580', qty: 1, unit_price: 123000 },
      { product: 'Proyectante S60', measures: '810x580', qty: 1, unit_price: 123000 },
    ],
    is_partial: true,
    partial_note: 'No incluye la ventana N°13 por salir fuera de rango',
  }, {
    toolCallsDelTurno,
    notifyMarcelo: async (p) => { aviso = p; },
    generarPdf: async (input) => { recibido = input; return { ok: true }; },
  });

  assert.ok(aviso, 'tenia que avisarle a Marcelo');
  assert.match(aviso.texto, /575x375/, 'el aviso dice CUAL ventana quedo fuera');
  assert.equal(aviso.motivo, 'ventanas_cotizadas_fuera_del_pdf');
  // 🔴 Y el PDF NO se toca: agregarla sola confunde "el motor lo calculo" con "el cliente lo
  // quiere". Una recotizacion metia las dos medidas; una pregunta exploratoria entraba al PDF.
  assert.equal(recibido.items.length, 2, 'el PDF sale como lo armo Oliver: no se le agrega nada');
});

test('🔒 si no falta ninguna, no molesta a Marcelo', async () => {
  const toolCallsDelTurno = [cotizada(410, 580, 'Proyectante S60'), cotizada(810, 580, 'Proyectante S60')];
  let aviso = null;
  await runTool('generar_pdf_cotizacion', {
    items: [
      { product: 'Proyectante S60', measures: '410x580', qty: 1, unit_price: 123000 },
      { product: 'Proyectante S60', measures: '810x580', qty: 1, unit_price: 123000 },
    ],
  }, { toolCallsDelTurno, notifyMarcelo: async (p) => { aviso = p; }, generarPdf: async () => ({ ok: true }) });
  assert.equal(aviso, null);
});

test('🔒 sin toolCalls del turno, se comporta como siempre', async () => {
  let recibido = null;
  await runTool('generar_pdf_cotizacion', {
    items: [{ product: 'Corredera', measures: '1000x1000', qty: 1, unit_price: 50000 }],
  }, { generarPdf: async (input) => { recibido = input; return { ok: true }; } });
  assert.equal(recibido.items.length, 1);
});
