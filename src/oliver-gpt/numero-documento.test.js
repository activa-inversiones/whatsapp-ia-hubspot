// numero-documento.test.js — [2026-08-26]
//
// 🔴 QUÉ NÚMERO LLEVA CADA DOCUMENTO ISO. Nació de una pérdida de información medida:
//
// Paula pidió dos cotizaciones, "una de color negro y la otra de color blanco". Las dos
// salieron con el folio CM-FR-004-2026-0353 y, como la fila se guarda POR NÚMERO, la segunda
// PISÓ a la primera — fila creada 16:21:08, actualizada 16:21:10, y quedó solo el blanco.
// La cotización negra que la clienta tiene en la mano NO EXISTE en el registro.
//
// Regla del dueño: "agregarle A B C D al final si hay, así será más fácil".
// La regla en una línea: una CORRECCIÓN conserva el número; una ALTERNATIVA lleva letra.

import test from 'node:test';
import assert from 'node:assert/strict';
import { numeroDeDocumento } from './webhook.js';

const VENTANA = 48 * 60 * 60 * 1000;
const AHORA = 1_756_000_000_000;
const entregado = (extra = {}) => ({
  quote_number: 'CM-FR-004-2026-0353', quote_base: 'CM-FR-004-2026-0353',
  at: AHORA - 60_000, pdf_sent: true, sig: 'FIRMA-NEGRO', alternativas: 0, ...extra,
});

test('🔴 el caso de Paula: la segunda cotización lleva su propia letra', () => {
  const r = numeroDeDocumento({ lastQuote: entregado(), sig: 'FIRMA-BLANCO', ventanaMs: VENTANA, ahora: AHORA });
  assert.equal(r.numero, 'CM-FR-004-2026-0353-B');
  assert.equal(r.motivo, 'alternativa');
});

test('🔴 y la tercera sigue la serie', () => {
  const lq = entregado({ quote_number: 'CM-FR-004-2026-0353-B', sig: 'FIRMA-BLANCO', alternativas: 1 });
  const r = numeroDeDocumento({ lastQuote: lq, sig: 'FIRMA-GRAFITO', ventanaMs: VENTANA, ahora: AHORA });
  assert.equal(r.numero, 'CM-FR-004-2026-0353-C', 'la letra sale de la BASE, no se encadena');
});

test('🔒 corregir una medida NO gasta una letra: es la misma propuesta', () => {
  // Lo que se arregló el 08-ago (caso Jessica: 3 correlativos quemados en 5 minutos mientras
  // la clienta todavía daba las medidas). Si el cliente aún no recibió el PDF, es la misma.
  const lq = entregado({ pdf_sent: false });
  const r = numeroDeDocumento({ lastQuote: lq, sig: 'OTRA-FIRMA', ventanaMs: VENTANA, ahora: AHORA });
  assert.equal(r.numero, 'CM-FR-004-2026-0353');
  assert.equal(r.motivo, 'mismo_folio');
});

test('🔒 reenviar lo MISMO tampoco gasta letra', () => {
  const r = numeroDeDocumento({ lastQuote: entregado(), sig: 'FIRMA-NEGRO', ventanaMs: VENTANA, ahora: AHORA });
  assert.equal(r.numero, 'CM-FR-004-2026-0353');
  assert.equal(r.motivo, 'revision');
});

test('🔒 pasadas las 48 h se pide un folio nuevo, no una letra', () => {
  const lq = entregado({ at: AHORA - VENTANA - 1 });
  const r = numeroDeDocumento({ lastQuote: lq, sig: 'FIRMA-BLANCO', ventanaMs: VENTANA, ahora: AHORA });
  assert.equal(r.numero, null);
  assert.equal(r.motivo, 'folio_vencido');
});

test('🔒 sin folio previo, folio nuevo', () => {
  assert.equal(numeroDeDocumento({ lastQuote: null, sig: 'X', ventanaMs: VENTANA }).numero, null);
  assert.equal(numeroDeDocumento({ lastQuote: {}, sig: 'X', ventanaMs: VENTANA }).numero, null);
});

test('🔒 sin firma guardada NO se inventa una alternativa', () => {
  // Un rastro viejo (de antes de este cambio) no trae `sig`. Sin ella no se puede saber si el
  // contenido cambió, y ante la duda se conserva el número: inventar una letra sería afirmar
  // que son documentos distintos sin tener con qué.
  const lq = entregado({ sig: undefined });
  const r = numeroDeDocumento({ lastQuote: lq, sig: 'FIRMA-BLANCO', ventanaMs: VENTANA, ahora: AHORA });
  assert.equal(r.numero, 'CM-FR-004-2026-0353');
});

test('🔒 con 26 alternativas se avisa, no se inventa numeración', () => {
  const lq = entregado({ alternativas: 26 });
  const r = numeroDeDocumento({ lastQuote: lq, sig: 'OTRA', ventanaMs: VENTANA, ahora: AHORA });
  assert.equal(r.numero, 'CM-FR-004-2026-0353');
  assert.equal(r.motivo, 'sin_letras', 'queda en el log para que alguien lo mire');
});
