// GUARDIA DE LA REGLA del reordenamiento (dueño, 30-sep: vendedores cotizan a nombre del cliente):
//   `from` (= quien escribe) SOLO para el chat: envíos, acuses, sesión, mensajes.
//   TODO registro (lead, quote, informes, media, espejos, deal, entregas) usa turno.cliente.
// Cuatro rondas de compuerta encontraron, una y otra vez, un registro más con `from`. Este test lee
// webhook.js y falla si aparece `external_id: from`, `phone: from` o `telefono: String(from)` SIN la
// marca `[chat]` en la misma línea. La marca es la LISTA BLANCA explícita: quien la ponga tiene que
// poder explicar por qué ese dato es del chat y no un registro del cliente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const lineas = fs.readFileSync(path.join(dir, 'webhook.js'), 'utf8').split('\n');
const PROHIBIDOS = [/external_id:\s*from\b/, /\bphone:\s*from\b/, /telefono:\s*String\(from\)/, /\bphone:\s*raw\?\.from\b/];

test('ningún registro usa `from`: solo líneas marcadas [chat] (lista blanca explícita)', () => {
  const malas = [];
  lineas.forEach((l, i) => {
    if (/^\s*(\/\/|\*)/.test(l)) return;                 // comentarios
    if (PROHIBIDOS.some((re) => re.test(l)) && !/\[chat\]/.test(l)) malas.push(`${i + 1}: ${l.trim()}`);
  });
  assert.deepEqual(malas, [], 'registros con `from` (deben usar turno.cliente o marcarse [chat] con motivo)');
});

test('[r16 #6] ningún aviso a Marcelo (notifyHighValue) usa `from` como teléfono del cliente', () => {
  // Sin comentarios (los // del medio de una llamada partida en líneas no deben ocultar el argumento).
  const src = lineas.map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const malas = [];
  for (const m of src.matchAll(/notifyHighValue\(\s*([^,]+?)\s*,\s*([^,]+?)\s*,/g)) {
    // [r17] también el telefono del RASTRO como destinatario del aviso: es el chat (el vendedor).
    // `rastro.cliente || rastro.telefono || …` está bien: el cliente va primero.
    if (/^from$/.test(m[2].trim()) || /^rastro\.telefono\b/.test(m[2].trim())) malas.push(m[0].replace(/\s+/g, ' '));
  }
  assert.deepEqual(malas, [], 'el aviso (y su cooldown) es del cliente: usar turno.cliente');
});

test('la lista blanca existe y está acotada (si crece, que sea a propósito)', () => {
  const blancas = lineas.filter((l) => /\[chat\]/.test(l) && PROHIBIDOS.some((re) => re.test(l)));
  // 17 al 30-sep: mensajes inbound/outbound del chat (13), acuses de envío (3), telemetría (1).
  assert.ok(blancas.length <= 17, `crecieron las excepciones [chat]: ${blancas.length}`);
});
