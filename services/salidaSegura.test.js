// salidaSegura.test.js — tests del embudo único de salida al cliente.
// Casos anclados a la fuga REAL medida en producción (conv 4d16c6ca, 14-sep-2026 22:34).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  limpiarParaCliente,
  MOTIVO,
  VERSION,
} from './salidaSegura.js';

// ─── Contrato ────────────────────────────────────────────────────────────────

test('devuelve SIEMPRE el mismo contrato, nunca a veces string', () => {
  const r = limpiarParaCliente('Hola');
  assert.deepEqual(Object.keys(r).sort(), ['bloquear', 'motivos', 'texto'].sort());
  assert.equal(typeof r.texto, 'string');
  assert.equal(typeof r.bloquear, 'boolean');
  assert.ok(Array.isArray(r.motivos));
});

test('texto normal pasa intacto y no bloquea', () => {
  const r = limpiarParaCliente('Perfecto. ¿Me confirma la comuna?');
  assert.equal(r.texto, 'Perfecto. ¿Me confirma la comuna?');
  assert.equal(r.bloquear, false);
  assert.deepEqual(r.motivos, []);
});

test('entradas no-string no revientan', () => {
  for (const v of [null, undefined, 42, {}, []]) {
    const r = limpiarParaCliente(v);
    assert.equal(r.bloquear, true);
    assert.equal(r.texto, '');
  }
});

// ─── LA FUGA REAL ────────────────────────────────────────────────────────────

test('FUGA REAL 14-sep: el bloque tool_call NO llega al cliente', () => {
  const real = 'Roble Dorado, anotado. Voy a prepararle la propuesta ahora mismo. <tool_call>\n' +
    '{"name": "calcular_cotizacion", "arguments": {"tipo": "CORREDERA", "medidas_texto": "2x2", ' +
    '"cantidad": 1, "color": "Roble Dorado", "comuna": "Temuco"}}\n</tool_call>\n' +
    '<tool_response>\n{"ok":true,"folio_temp":"TMP-2067","serie":"SLIDING_2H_1R","ancho_mm":2000}\n</tool_response>';
  const r = limpiarParaCliente(real);
  assert.ok(!r.texto.includes('tool_call'), 'quedó la etiqueta tool_call');
  assert.ok(!r.texto.includes('arguments'), 'quedó el JSON de arguments');
  assert.ok(!r.texto.includes('TMP-2067'), 'quedó el folio temporal');
  assert.ok(!r.texto.includes('SLIDING_2H_1R'), 'quedó el SKU interno');
  assert.equal(r.texto, 'Roble Dorado, anotado. Voy a prepararle la propuesta ahora mismo.');
  assert.ok(r.motivos.includes(MOTIVO.TOOL_ARTIFACT));
  assert.equal(r.bloquear, false, 'quedaba prosa útil: no hay que bloquear');
});

test('tool_call sin cerrar (stream cortado) igual se corta', () => {
  const r = limpiarParaCliente('Listo. <tool_call>\n{"name": "cotizar", "arguments": {"a":1}');
  assert.ok(!r.texto.includes('tool_call'));
  assert.ok(!r.texto.includes('arguments'));
  assert.equal(r.texto, 'Listo.');
});

test('si el mensaje era SOLO tool-call, bloquea para reintentar', () => {
  const r = limpiarParaCliente('<tool_call>{"name":"calcular_cotizacion","arguments":{"x":1}}</tool_call>');
  assert.equal(r.bloquear, true);
  assert.ok(r.motivos.includes(MOTIVO.TOOL_ARTIFACT));
  assert.ok(r.motivos.includes(MOTIVO.VACIO));
});

test('JSON suelto con name/arguments, sin etiquetas, tampoco pasa', () => {
  const r = limpiarParaCliente('Ahí va: {"name": "calcular_cotizacion", "arguments": {"tipo":"FIJO"}}');
  assert.ok(!r.texto.includes('arguments'));
  assert.ok(r.motivos.includes(MOTIVO.TOOL_ARTIFACT));
});

test('no confunde prosa que menciona la palabra arguments', () => {
  // [2026-09-15] El ejemplo cambió: el original decía "Le mando los argumentos de la
  // propuesta POR CORREO" y ahora lo corrige —con razón— el guardia de capacidades
  // (capacidadReal.js): Oliver NO puede mandar correos. Lo que este test prueba es otra
  // cosa: que la palabra "argumentos" no se confunda con la clave JSON `arguments`.
  const r = limpiarParaCliente('Le explico los argumentos de la propuesta por acá mismo.');
  assert.equal(r.texto, 'Le explico los argumentos de la propuesta por acá mismo.');
  assert.equal(r.bloquear, false);
});

// ─── Markdown que WhatsApp no renderiza ──────────────────────────────────────

test('**negrita** de Markdown se convierte a *negrita* de WhatsApp', () => {
  const r = limpiarParaCliente('¿son **2,13 metros** o **2,13 centímetros**?');
  assert.equal(r.texto, '¿son *2,13 metros* o *2,13 centímetros*?');
  assert.ok(r.motivos.includes(MOTIVO.MARKDOWN));
});

test('el asterisco simple de WhatsApp NO se toca', () => {
  const r = limpiarParaCliente('La emití a nombre de *Fernando Ortiz*.');
  assert.equal(r.texto, 'La emití a nombre de *Fernando Ortiz*.');
  assert.ok(!r.motivos.includes(MOTIVO.MARKDOWN));
});

test('__negrita__ tambien se normaliza', () => {
  const r = limpiarParaCliente('el alto es __2,13__ metros');
  assert.equal(r.texto, 'el alto es *2,13* metros');
});

test('una multiplicacion con asteriscos no se rompe', () => {
  const r = limpiarParaCliente('2 * 3 * 4 = 24');
  assert.equal(r.texto, '2 * 3 * 4 = 24');
});

// ─── Reglas heredadas de sanitizeForCustomer (no perder lo ganado) ───────────

test('hereda: array JSON de items va a [detalles en PDF]', () => {
  const r = limpiarParaCliente('Detalle: [{"id":1,"product":"corredera","unit_price":1000}]');
  assert.ok(r.texto.includes('[detalles en PDF]'));
  assert.ok(!r.texto.includes('unit_price'));
});

test('hereda: URL de SharePoint se reemplaza', () => {
  const r = limpiarParaCliente('Video: https://activaspacl-my.sharepoint.com/personal/x/Documents/a.mp4?t=abc');
  assert.ok(!r.texto.includes('sharepoint.com'));
  assert.ok(r.texto.includes('[video disponible'));
});

test('hereda: tokens tecnicos expuestos se borran', () => {
  const r = limpiarParaCliente('Guardado wamid: ABCD1234567890XYZ listo');
  assert.ok(!r.texto.includes('ABCD1234567890XYZ'));
});

// ─── Mensajes internos (alertas a Marcelo) ──────────────────────────────────

test('modo interno NO borra diagnostico tecnico', () => {
  const alerta = 'ESCALACION: {"id":1,"product":"corredera","unit_price":1000} phone=5699';
  const r = limpiarParaCliente(alerta, { destino: 'interno' });
  assert.equal(r.texto, alerta, 'a Marcelo se le manda el diagnostico completo');
  assert.equal(r.bloquear, false);
});

test('modo interno SI corta tool artifacts (ruido puro)', () => {
  const r = limpiarParaCliente('Alerta <tool_call>{"name":"x","arguments":{}}</tool_call>', { destino: 'interno' });
  assert.ok(!r.texto.includes('tool_call'));
});

// ─── Captions de adjuntos ────────────────────────────────────────────────────

test('caption se limpia igual que un texto', () => {
  const r = limpiarParaCliente('Su propuesta **CM-FR-004** <tool_call>{"name":"x","arguments":{}}</tool_call>', { destino: 'caption' });
  assert.equal(r.texto, 'Su propuesta *CM-FR-004*');
  assert.equal(r.bloquear, false);
});

test('caption vacio tras limpiar NO bloquea el adjunto', () => {
  const r = limpiarParaCliente('<tool_call>{"name":"x","arguments":{}}</tool_call>', { destino: 'caption' });
  assert.equal(r.texto, '');
  assert.equal(r.bloquear, false, 'el PDF se manda igual, solo sin caption');
});

// ─── Versionado ──────────────────────────────────────────────────────────────

test('expone VERSION', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});
