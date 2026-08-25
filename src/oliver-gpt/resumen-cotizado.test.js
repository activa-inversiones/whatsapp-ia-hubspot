// resumen-cotizado.test.js — [2026-08-25]
//
// 🔴 EL CLIENTE NO SABE QUE LE COTIZARON.
//
// Reclamo del dueño tras la prueba en vivo: *"no le informamos qué cosa le cotizaríamos,
// como V1 1200x1000 CORREDERA por ejemplo"*. Oliver emitia la propuesta y decia "Listo ✅ te
// envié tu Propuesta N° …", sin una palabra sobre QUE contiene. El cliente tiene que abrir
// el PDF para saber si le entendieron bien — y si no le entendieron, se entera tarde.
//
// ⚠️ POR QUE VA EN CODIGO Y NO EN EL PROMPT. El proyecto ya aprendio esto a los golpes: la
// REGLA #12 del prompt prohibia repetir mensajes y Oliver mando el mismo texto 73 veces a 26
// clientes; el freno tuvo que ponerse en codigo (webhook.js). Una instruccion en el prompt
// se cumple casi siempre, y "casi siempre" sobre el momento mas importante de la venta no
// alcanza. Esto ocurre SIEMPRE, sin depender de que el cerebro se acuerde.
//
// ⛔ SIN PRECIOS. La regla #13 del proyecto es que el monto va SOLO en el PDF formal, nunca
// en el texto del chat, y hay un filtro (`stripMontos`) que lo hace cumplir. Este resumen
// dice QUE se cotizo, no cuanto sale.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resumenDeLoCotizado } from './normalizers.js';

const it = (extra = {}) => ({
  producto_label: 'Corredera S60', measures: '1500x1200', qty: 1, color: 'Blanco', ...extra,
});

test('🔴 lista lo cotizado con numero, cantidad, tipo y medidas', () => {
  const t = resumenDeLoCotizado([
    it({ measures: '360x900', qty: 2, ambiente: 'Baño' }),
    it({ measures: '1560x900', qty: 1, producto_label: 'Corredera S60' }),
  ]);
  assert.match(t, /V1/, 'numerado, para poder referirse a una ventana puntual');
  assert.match(t, /V2/);
  assert.match(t, /2 ×|2 x/, 'la cantidad');
  assert.match(t, /360×900|360x900/, 'las medidas');
  assert.match(t, /Corredera S60/, 'el tipo');
});

test('🔴 el color aparece, que es justo lo que se estaba perdiendo', () => {
  assert.match(resumenDeLoCotizado([it({ color: 'Nogal' })]), /Nogal/);
});

test('el ambiente aparece cuando lo hay: ubica la ventana en la casa', () => {
  const t = resumenDeLoCotizado([it({ ambiente: 'Baño' })]);
  assert.match(t, /Baño/);
});

test('⛔ NUNCA lleva precios: el monto va solo en el PDF (regla #13)', () => {
  const t = resumenDeLoCotizado([
    it({ unit_price: 250000, total_price: 500000, qty: 2 }),
  ]);
  assert.doesNotMatch(t, /\$/, 'ni el signo peso');
  assert.doesNotMatch(t, /250\.?000|500\.?000/, 'ni el numero');
});

test('una sola ventana no se numera: "V1" de una sola cosa es ruido', () => {
  const t = resumenDeLoCotizado([it({ measures: '1500x1200' })]);
  assert.doesNotMatch(t, /V1/);
  assert.match(t, /1500×1200|1500x1200/, 'pero si dice que es');
});

test('🔒 un proyecto largo no inunda el chat: se corta y se dice', () => {
  const muchas = Array.from({ length: 14 }, (_, i) => it({ measures: `${1000 + i}x900` }));
  const t = resumenDeLoCotizado(muchas);
  const lineas = t.split('\n').filter((l) => /^V\d+/.test(l.trim()));
  assert.ok(lineas.length <= 8, `se corta en 8, no en ${lineas.length}`);
  assert.match(t, /6 m[áa]s|y 6/, 'y avisa cuantas quedaron fuera');
});

test('🔒 sin items devuelve vacio, no una lista huerfana', () => {
  for (const nada of [[], null, undefined, 'texto']) {
    assert.equal(resumenDeLoCotizado(nada), '', `con ${JSON.stringify(nada)}`);
  }
});

test('🔒 un item incompleto no imprime "undefined"', () => {
  const t = resumenDeLoCotizado([{ measures: '900x900' }, {}]);
  assert.doesNotMatch(t, /undefined|null|NaN/);
});

test('🔴 el resumen LLEGA al mensaje de la propuesta, no se queda en una variable', async () => {
  // Ya paso hoy con el aviso del color: se construia y nadie lo usaba, asi que el cliente
  // no se enteraba de nada. Un texto que no se manda no existe.
  const { readFile } = await import('node:fs/promises');
  const wh = await readFile(new URL('./webhook.js', import.meta.url), 'utf8');
  assert.match(wh, /resumenDeLoCotizado/, 'el webhook tiene que usarlo');
  const i = wh.indexOf(') + _avisoColor');
  assert.ok(i > 0, 'no se encontro el mensaje de la propuesta');
  const bloque = wh.slice(Math.max(0, i - 300), i + 200);
  assert.match(bloque, /_resumenCotizado|resumenDeLoCotizado/,
    'el resumen se concatena al mensaje que recibe el cliente');
});

test('🔴 el cierre pregunta por MODIFICACIONES y CUANDO contactarlo', async () => {
  // Instruccion del dueño: *"Oliver debe seguir a cliente después de entregar la cotización
  // porque no hace nada y debería al menos preguntar si la cotización necesita alguna
  // modificación, cuándo la puede contactar nuevamente"*.
  //
  // El cierre anterior solo ofrecia ir a medir. Medir es un paso mas adelante en la venta:
  // si el cliente todavia no sabe si la cotizacion refleja lo que pidio, ofrecerle una
  // visita tecnica se salta el paso que importa.
  const { readFile } = await import('node:fs/promises');
  const wh = await readFile(new URL('./webhook.js', import.meta.url), 'utf8');
  const i = wh.indexOf('Te envié tu Propuesta Técnica Económica');
  assert.ok(i > 0, 'no se encontro el mensaje de cierre');
  const bloque = wh.slice(i, i + 600);

  assert.match(bloque, /modificaci|cambiar|ajust/i, 'tiene que preguntar si hay que modificar algo');
  assert.match(bloque, /cuándo|cuando/i, 'y cuándo lo puede contactar');
});
