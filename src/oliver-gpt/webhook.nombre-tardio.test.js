// webhook.nombre-tardio.test.js — [2026-09-03]
//
// EL CASO LUIS, DE PUNTA A PUNTA, SOBRE EL WEBHOOK DE PRODUCCION.
//
// 🔴 QUE PASO DE VERDAD (BD viva, whatsapp_sessions wa_id 56994940848, 03-sep 12:04 hora Chile):
//     cliente : "Solicito cotizar"
//     cliente : "4.15 de ancho por 2.10, y dos paños de 3.15 por 2.30 mts. Con puerta"
//     cliente : "Padre las casas"
//     Oliver  : "¿A nombre de quién preparo la propuesta?"   ← ultimo mensaje, nadie contesto
//   Medidas ✅, comuna ✅, y la conversacion murio ahi. Sin PDF no sale el evento de cotizacion,
//   asi que Google y Meta tampoco recibieron la conversion.
//
// DECISION DEL DUEÑO (textual): *"LA IDEA ES COTIZARLE IGUAL A CLIENTE SOLO ACTUALIZAR SI
// DESPUES VIENE EL DATO CORRECTO"*. Este archivo prueba LAS DOS MITADES:
//   1. sin nombre, la propuesta SALE — y se le avisa a nombre de quien salio;
//   2. si el nombre llega despues, se REEMITE con el MISMO folio (no se quema un correlativo).
//
// La segunda mitad va en CODIGO, no en el prompt, por la leccion del PDF-01 de junio: el LLM
// escribia "[Enlace a la cotizacion]" y el cliente no recibia nada. Un documento que el cliente
// lleva a facturar no puede depender de que el modelo se acuerde.
//
// Hermetico: `global.fetch` anulado, todo lo que toca red inyectado.

import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook } from './webhook.js';

// Cuantas veces se pidio un correlativo ISO nuevo. Reemitir NO puede sumar aca: con un stub
// que siempre devuelve el mismo numero, contar los PEDIDOS es la unica forma de distinguir
// "reuso el folio" de "quemo otro y dio la casualidad de que era igual".
let pedidosDeFolio = 0;

global.fetch = async (url) => {
  if (String(url).includes('/internal/quotes/next-number')) {
    pedidosDeFolio++;
    return { ok: true, status: 200, json: async () => ({ quote_number: 'CM-FR-004-2026-7777' }) };
  }
  return { ok: false, status: 503, json: async () => ({}) };
};

const makeRes = () => ({ sendStatus() { return this; } });
const vigente = (e) => e && (!e.expira || e.expira > Date.now());

// Las 3 ventanas que pidio Luis, en milimetros, tal como las devolveria el motor.
const ITEMS_DE_LUIS = [
  { product: 'Ventana PVC S60 corredera', producto_label: 'Ventana PVC S60 corredera',
    measures: '4150x2100mm', glass_label: 'DVH 5/12/5', ambiente: 'Living', qty: 1,
    unit_price: 890000, total_price: 890000, color: 'Blanco' },
  { product: 'Ventana PVC S60 corredera', producto_label: 'Ventana PVC S60 corredera',
    measures: '3150x2300mm', glass_label: 'DVH 5/12/5', ambiente: 'Comedor', qty: 2,
    unit_price: 760000, total_price: 1520000, color: 'Blanco' },
];

/**
 * Un cliente, varios turnos. `pushName` es el nombre de perfil de WhatsApp que Meta manda en
 * CADA mensaje entrante (lo captura whatsapp-adapter.js:87) — el dato que el gate no miraba.
 */
let SEQ = 0;

function armar(textosPorTurno, { pushName = '', comuna = 'Padre Las Casas' } = {}) {
  // Un telefono DISTINTO por test. El del caso real es 56994940848, pero los mapas de dedup
  // (`RECENT_QUOTES` y compania) viven a nivel de MODULO y se comparten entre tests del mismo
  // proceso: con el telefono fijo, el segundo test caia en el dedup de 2 minutos del primero
  // y `generarPdf` devolvia la cotizacion vieja sin volver a emitir. El sintoma era enganoso
  // —`message` undefined— y no tenia nada que ver con lo que se estaba midiendo.
  const telefono = `5699494${String(++SEQ).padStart(4, '0')}`;
  const estado = new Map();
  const conv = new Map();
  const spy = { propuestas: [], textos: [], resultados: [], folios: [] };
  let turno = 0;

  const deps = {
    conv, seen: new Set(), locks: new Map(),
    dormir: async () => {},
    leerEstado: async (k) => (vigente(estado.get(k)) ? estado.get(k).valor : null),
    escribirEstado: (k, v, ttl = 300) => estado.set(k, { valor: v, expira: Date.now() + ttl * 1000 }),
    fusionarEstado: (k, calc, ttl = 300) => {
      const e = estado.get(k);
      const { valor, guardar } = calc(vigente(e) ? e.valor : null) || {};
      if (guardar && valor != null) estado.set(k, { valor, expira: Date.now() + ttl * 1000 });
      return valor === undefined ? (vigente(e) ? e.valor : null) : valor;
    },
    reservarEstado: (k, ttl = 300) => {
      if (vigente(estado.get(k))) return null;
      const t = `t${Math.random()}`;
      estado.set(k, { valor: t, expira: Date.now() + ttl * 1000 });
      return t;
    },
    liberarReserva: (k, t) => {
      const e = estado.get(k);
      if (!t || !vigente(e) || e.valor !== t) return false;
      estado.delete(k);
      return true;
    },
    borrarEstado: () => true,

    parseInbound: () => ({
      ok: true, from: telefono, text: textosPorTurno[turno++] || 'hola',
      msgId: `wamid.${Math.random()}`, type: 'text', push_name: pushName,
    }),
    sendWhatsAppText: async (to, text) => { spy.textos.push(text); return { ok: true, msgId: 'm1' }; },

    pedirInformeComuna: async () => null,
    generarInformeTermicoPdf: async () => null,
    generatePdf: async () => Buffer.alloc(2048, 3),
    uploadWaDocument: async () => 'media.1',
    sendWaDocument: async (to, mediaId, filename) => { spy.propuestas.push(filename); return { ok: true, msgId: 'p1' }; },
    saveMedia: async () => ({ ok: true }),
    mediaIdsDisponibles: async () => ({}),
    upsertZohoDeal: async () => null,
    addZohoNote: async () => ({ ok: true }),
    attachPdfToDeal: async () => ({ ok: true }),

    // El cerebro pide la propuesta SIN nombre — que es exactamente lo que pasa cuando el
    // cliente no lo dio: el LLM no tiene de donde sacarlo.
    handleTurn: async ({ state, toolCtx }) => {
      const _r = await toolCtx.generarPdf({ items: ITEMS_DE_LUIS, comuna, grand_total: 2410000 });
      spy.resultados.push(_r);
      if (_r && _r.quote_number) spy.folios.push(_r.quote_number);
      return { reply: 'ok', history: [], toolCalls: [], state: { ...state, comuna } };
    },
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({ ok: true }),
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async () => ({ ok: true }),
    },
    notifyHighValue: async () => ({ sent: true }),
  };
  return { deps, spy, conv, telefono };
}

test('🔴 CASO LUIS: sin nombre, la propuesta SALE igual', async () => {
  pedidosDeFolio = 0;
  // El texto nombra la CORREDERA a proposito: la apertura tiene su propio gate (que si
  // bloquea, con su plazo de gracia) y este archivo mide el del NOMBRE. Mezclarlos haria
  // que un rojo aca no dijera cual de los dos se rompio.
  const { deps, spy } = armar(['4.15 de ancho por 2.10 corredera, y dos paños de 3.15 por 2.30 mts. Con puerta']);
  await handleWebhook({ body: {} }, makeRes(), deps);

  assert.equal(spy.propuestas.length, 1,
    'el 03-sep esto era 0: el cliente dio medidas y comuna, y se fue sin cotizacion');
  assert.equal(spy.resultados[0].ok, true);
  assert.match(spy.folios[0], /CM-FR-004-2026-7777/, 'con su folio ISO');
});

test('y se le DICE a nombre de quien salio, con la comuna como rotulo', async () => {
  const { deps, spy } = armar(['cotizame estas ventanas correderas']);
  await handleWebhook({ body: {} }, makeRes(), deps);
  const msg = spy.resultados[0].message;
  // El rotulo no afirma un nombre de persona: dice de donde es el cliente, que es lo unico
  // que sabemos de verdad.
  assert.match(msg, /Cliente de Padre Las Casas/, 'el rotulo exacto que quedo en el PDF');
  assert.match(msg, /reemit/i, 'y se le ofrece corregirla');
  assert.match(msg, /mismo n[uú]mero/i, 'aclarando que no seria una propuesta nueva');
});

test('con nombre de perfil de WhatsApp, sale a ESE nombre (era el dato que estaba ahi)', async () => {
  const { deps, spy } = armar(['cotizame estas ventanas correderas'], { pushName: 'Luis' });
  await handleWebhook({ body: {} }, makeRes(), deps);
  const msg = spy.resultados[0].message;
  assert.match(msg, /a nombre de \*Luis\*/, 'Meta nos manda el nombre en cada mensaje entrante');
  assert.doesNotMatch(msg, /Cliente de Padre Las Casas/, 'el rotulo de comuna es el PLAN B, no el A');
});

test('un push_name que es un TELEFONO no entra en un documento formal', async () => {
  const { deps, spy } = armar(['cotizame estas ventanas correderas'], { pushName: '+56 9 9494 0848' });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.match(spy.resultados[0].message, /Cliente de Padre Las Casas/,
    'mucha gente tiene su propio numero como nombre de perfil');
});

test('🔴 LA OTRA MITAD: el nombre llega DESPUES → se reemite con el MISMO folio', async () => {
  pedidosDeFolio = 0;
  const { deps, spy } = armar([
    'cotizame estas ventanas correderas',   // turno 1 → propuesta con rotulo
    'Luis Hernández',            // turno 2 → llega el nombre
  ]);
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.equal(spy.propuestas.length, 1, 'primero sale la propuesta con el rotulo');

  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.equal(spy.propuestas.length, 2, 'el nombre dispara la reemision, en codigo y no por el LLM');
  assert.equal(pedidosDeFolio, 1,
    'REEMITIR NO QUEMA UN CORRELATIVO ISO: el segundo documento reusa el folio del primero '
    + '(es el defecto del caso Jessica, 3 folios en 5 minutos)');
  const ultimo = spy.textos[spy.textos.length - 1];
  assert.match(ultimo, /corregi|corregí|reemit/i, 'y se le dice que es la MISMA, corregida');
});

test('un "ok gracias" NO dispara una reemision a nombre de "Ok"', async () => {
  const { deps, spy } = armar(['cotizame estas ventanas correderas', 'ok gracias']);
  await handleWebhook({ body: {} }, makeRes(), deps);
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.equal(spy.propuestas.length, 1,
    'solo un mensaje que PARECE un nombre corrige el documento');
});

/* =========================================================================
 * LOS HALLAZGOS DE LA COMPUERTA CRUZADA (Codex, 03-sep) — fijados para que no vuelvan
 * ========================================================================= */

test('🔴 [hallazgo 6] el cliente contesta SOLO su RUT → también se reemite', () => {
  // El aviso PROMETE: "dígame a nombre de quién va —o el RUT si la necesita para factura— y
  // se la reemito". Con solo los detectores de nombre, el que contestaba unicamente
  // "77.448.504-K" no gatillaba nada: el RUT quedaba en state.receptor y la propuesta seguia
  // a nombre del rotulo. Prometer y no cumplir es peor que no prometer.
  return (async () => {
    const { deps, spy } = armar([
      'cotizame estas ventanas correderas',
      '77.448.504-K',                       // ni nombre ni saludo: solo el RUT
    ]);
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.equal(spy.propuestas.length, 1);
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.equal(spy.propuestas.length, 2, 'el RUT corrige el documento igual que el nombre');
  })();
});

test('🔴 [hallazgo 7] con atribución del dueño NO se avisa un nombre asumido', async () => {
  // Si el dueño cargo al cliente a mano ("CLIENTE Juan +569..."), el documento sale a nombre de
  // Juan: decirle "todavia no tengo su nombre, la emiti como Juan" contradice el PDF que el
  // cliente tiene en la mano, y ademas dejaba un pendiente que despues le reenviaba el mismo
  // documento sin motivo.
  //
  // ⚠️ SE MIDE SOBRE LA FUENTE, y no montando un turno, porque `atribucion` solo existe cuando
  // el mensaje viene DEL DUEÑO (`esDuenio`): reproducir eso pide media conversacion del dueño
  // y el test terminaria midiendo el camino del takeover, no esta regla. Es el mismo recurso
  // que ya usa color.test.js para el aviso del color.
  const { readFile } = await import('node:fs/promises');
  const wh = await readFile(new URL('./webhook.js', import.meta.url), 'utf8');
  assert.match(wh, /const _nombreAsumido = _gate\.nombreAsumido && !atribucion\?\.name;/,
    'la atribucion del dueño apaga el "nombre asumido"');
  assert.match(wh, /if \(_nombreAsumido\) \{[\s\S]{0,40}?state\.nombre_pendiente/,
    'y por lo tanto tampoco deja un pendiente que reemitir');
});
