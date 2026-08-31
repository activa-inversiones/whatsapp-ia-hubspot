// services/quotePdf.receptor.test.js — [2026-08-30]
//
// EL RUT EN LA PROPUESTA. Caso real: Alfredo Arias Luengo (conv 56952077379) pidió CUATRO
// veces que le agregaran el RUT. El fix del 28-ago (pdf-intent.js:300) arregló el texto del
// CHAT; el PDF nunca tuvo campo de RUT — `quotePdf.js` imprimía solo nombre·teléfono·comuna.
// Peor: Oliver le escribió "la propuesta quedó emitida a nombre de ..., RUT ...", una
// afirmación FALSA sobre el contenido de un documento formal.
//
// Esta red defiende las tres cosas que importan, en orden de gravedad:
//   1. Un RUT que no pasa módulo 11 NO llega al papel (el PDF sale idéntico al de siempre).
//   2. Cuando el RUT es válido, la línea entra de verdad en el documento.
//   3. Sin receptor, la propuesta se emite EXACTAMENTE como antes de este cambio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePremiumQuotePdf, lineaReceptorPropuesta } from './quotePdf.js';

const ITEMS = [{
  producto_label: 'Corredera 2 hojas', measures: '1500x1200 mm',
  qty: 2, unit_price: 180000, color: 'Blanco', glass_label: 'Termopanel DVH',
}];
const BASE = { name: 'Alfredo Arias Luengo', phone: '56952077379', comuna: 'Temuco', items: ITEMS };
const FOLIO = 'CM-FR-004-2026-0400';

/* ── La decisión, sin generar PDF ─────────────────────────────────────────── */

test('EMPRESA: razón social + RUT (el caso normal cuando piden factura)', () => {
  assert.equal(
    lineaReceptorPropuesta({ name: 'Jorge Barriga', receptor: { clienteTipo: 'empresa', razonSocial: 'Maya Mapu Spa', rut: '77448504K' } }),
    'Facturar a: Maya Mapu Spa  ·  RUT: 77.448.504-K',
    'normaliza el RUT sin puntos y rotula a quién se factura'
  );
});

test('PERSONA que NO es la del chat: se nombra al receptor sin pisar el contacto', () => {
  // Medido: en 4 de 6 casos reales el RUT es de un tercero (perfil "Mjose" → Bayron).
  assert.equal(
    lineaReceptorPropuesta({ name: 'Mjose', receptor: { clienteTipo: 'particular', nombre: 'Bayron Reyes', rut: '20.712.345-5' } }),
    'A nombre de: Bayron Reyes  ·  RUT: 20.712.345-5'
  );
});

test('PERSONA que ES la del chat: no se repite el nombre, solo se agrega el RUT', () => {
  assert.equal(
    lineaReceptorPropuesta({ name: 'Alfredo Arias Luengo', receptor: { clienteTipo: 'particular', rut: '20.712.345-5' } }),
    'RUT: 20.712.345-5'
  );
});

test('⛔ RUT inválido → línea VACÍA. Antes sin RUT que con uno equivocado', () => {
  // El DV correcto de 10.047.794 es 7; con 9 no cierra por módulo 11.
  assert.equal(lineaReceptorPropuesta({ name: 'Alfredo Arias Luengo', receptor: { clienteTipo: 'particular', rut: '10.047.794-9' } }), '');
  assert.equal(lineaReceptorPropuesta({ name: 'X', receptor: { rut: 'no-es-un-rut' } }), '');
});

test('sin receptor no hay línea, y no lanza con datos ausentes', () => {
  assert.equal(lineaReceptorPropuesta({ name: 'Alfredo Arias Luengo' }), '');
  assert.equal(lineaReceptorPropuesta({}), '');
  assert.equal(lineaReceptorPropuesta(), '');
  assert.equal(lineaReceptorPropuesta({ receptor: null }), '');
});

/* ── El PDF de verdad ─────────────────────────────────────────────────────── */

test('🔴 el RUT válido ENTRA al PDF; el inválido deja el documento BYTE A BYTE como el de siempre', async () => {
  const sinReceptor = await generatePremiumQuotePdf(BASE, FOLIO);
  const conRut = await generatePremiumQuotePdf(
    { ...BASE, receptor: { clienteTipo: 'empresa', razonSocial: 'Maya Mapu Spa', rut: '77448504K' } }, FOLIO);
  const rutMalo = await generatePremiumQuotePdf(
    { ...BASE, receptor: { clienteTipo: 'particular', rut: '10.047.794-9' } }, FOLIO);

  assert.ok(sinReceptor.length > 0, 'la propuesta sin receptor se genera igual que siempre');
  assert.ok(conRut.length > sinReceptor.length, 'con RUT válido el documento crece: la línea se dibujó');
  assert.equal(rutMalo.length, sinReceptor.length,
    'con RUT inválido el PDF pesa EXACTAMENTE lo mismo que sin receptor: nada se imprimió');
});

test('el PDF no se cae con una razón social larga ni con caracteres raros del perfil', async () => {
  const buf = await generatePremiumQuotePdf({
    ...BASE,
    name: 'Mjose 👩🏻‍💻',
    receptor: {
      clienteTipo: 'empresa',
      razonSocial: 'Sociedad Comercializadora e Inmobiliaria del Sur Austral Limitada',
      rut: '77.448.504-K',
    },
  }, FOLIO);
  assert.ok(buf.length > 0, 'genera el documento sin lanzar');
});
