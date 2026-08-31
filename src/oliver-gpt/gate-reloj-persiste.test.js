// gate-reloj-persiste.test.js — [2026-08-25]
//
// 🔴 EL RELOJ DEL PLAZO DE GRACIA SE PERDIA AL TERMINAR EL TURNO ⇒ EL PLAZO NO VENCIA NUNCA.
//
// Nacio de una pregunta que dejo abierta la compuerta cruzada: si el gate del color lleva
// todo el dia en produccion, ¿por que NINGUNA de las 794 sesiones persistidas tiene
// `color_preguntado_at`? Medido contra la BD viva (25-ago): 794 sesiones · 0 con reloj de
// color · 0 con reloj de apertura · pero 224 CON `default_color`.
//
// LA CAUSA, y esta escrita en el propio webhook.js: `agent.handleTurn` hace
// `const nextState = { ...state }` AL EMPEZAR el turno, y el webhook se queda con ESA copia
// (`newState = turn.state`). Todo lo que una tool le escriba al `state` DURANTE el turno
// queda afuera. Por eso ya existe un merge explicito para `last_quote`, con este comentario:
// *"sin este merge se perderia el last_quote que generarPdf escribio DURANTE este turno"*.
// Los relojes de los gates se escriben en el mismo lugar y NO estaban en ese merge.
//
// `default_color` si persiste porque `recordarColor(newState, …)` se escribe DESPUES del
// turno, sobre la copia que se guarda. Eso explica el 224 contra 0.
//
// CONSECUENCIA REAL: se le pregunta al cliente, el reloj no queda guardado, y en el turno
// siguiente el gate lo ve en cero y vuelve a preguntar. El plazo de gracia NO vence JAMAS y
// la propuesta "asumida" no sale nunca. El cliente que no contesta el dato queda en un bucle
// de preguntas. Aplica IGUAL al gate del color, que ya esta en produccion.
//
// ⚠️ POR QUE NO LO CAZO NINGUN TEST HASTA HOY: los `handleTurn` de prueba devuelven
// `state: { ...state }` DESPUES de haber llamado la tool, asi que la copia SI incluye la
// mutacion — al reves que el agente real, que la toma antes. El fake era mas indulgente que
// produccion y tapaba el defecto. Este test copia la semantica REAL: saca la foto del estado
// ANTES de ejecutar la tool.

import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook } from './webhook.js';

global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });

const makeRes = () => ({ sendStatus() { return this; } });

/**
 * Corre un turno en el que el gate BLOQUEA (el cliente no nombro la apertura) y devuelve el
 * estado tal como quedaria guardado.
 *
 * El `handleTurn` falso imita al de verdad (agent.js:50): la foto del estado se toma ANTES
 * de llamar la tool. Si el reloj sobrevive a eso, sobrevive en produccion.
 */
async function turnoQueBloquea() {
  let guardado = null;
  const deps = {
    conv: new Map(), seen: new Set(), locks: new Map(),
    dormir: async () => {},
    leerEstado: async () => null,
    escribirEstado: () => {},
    parseInbound: () => ({
      ok: true, from: '56900000001', type: 'text',
      text: 'hola, cuánto sale una ventana de 1500x1000',   // sin nombrar la apertura
      msgId: `wamid.${Math.random()}`,
    }),
    sendWhatsAppText: async () => ({ ok: true }),
    generatePdf: async () => Buffer.from('%PDF-1.4 fake'),
    uploadWaDocument: async () => 'media-x',
    sendWaDocument: async () => ({ ok: true, msgId: 'sent-x' }),
    loadSession: async () => null,
    persistSession: (_from, sesion) => { guardado = sesion; },
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({ ok: true }),
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async () => ({ ok: true }),
    },
    handleTurn: async ({ userText, state, toolCtx }) => {
      // 👇 EL PUNTO DEL TEST: la foto se toma ACA, antes de la tool — igual que agent.js:50.
      const nextState = { ...state };
      await toolCtx.generarPdf({
        name: 'Juan Carlos', comuna: 'Temuco',
        items: [{ producto_label: 'Corredera S60', measures: '1500x1000',
                  color: 'Blanco', qty: 1, unit_price: 250000 }],
      });
      return {
        reply: 'ok',
        history: [{ role: 'user', content: userText }],
        toolCalls: [],
        state: nextState,
      };
    },
  };

  await handleWebhook({ body: {} }, makeRes(), deps);
  return guardado;
}

test('🔴 el reloj de la apertura SOBREVIVE al turno, o el plazo no vence nunca', async () => {
  const guardado = await turnoQueBloquea();
  assert.ok(guardado, 'la sesion tiene que persistirse');
  assert.ok(
    guardado.state.tipo_preguntado_at,
    'se le pregunto la apertura y el reloj NO quedo guardado: el proximo turno lo ve en cero, '
    + 'vuelve a preguntar, y la propuesta asumida no sale nunca',
  );
});

test('🔴 el reloj del COLOR tambien — el mismo defecto, y ese ya esta en produccion', async () => {
  // Se prueba aparte a proposito: el gate del color se desplego hoy y arrastra el mismo
  // problema. Un arreglo que cierre solo la apertura deja la mitad viva.
  let guardado = null;
  const deps = {
    conv: new Map(), seen: new Set(), locks: new Map(),
    dormir: async () => {},
    leerEstado: async () => null,
    escribirEstado: () => {},
    parseInbound: () => ({
      ok: true, from: '56900000002', type: 'text',
      text: 'quiero una corredera de 1500x1000',   // apertura SI, color NO
      msgId: `wamid.${Math.random()}`,
    }),
    sendWhatsAppText: async () => ({ ok: true }),
    generatePdf: async () => Buffer.from('%PDF-1.4 fake'),
    uploadWaDocument: async () => 'media-y',
    sendWaDocument: async () => ({ ok: true, msgId: 'sent-y' }),
    loadSession: async () => null,
    persistSession: (_from, sesion) => { guardado = sesion; },
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({ ok: true }),
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async () => ({ ok: true }),
    },
    handleTurn: async ({ userText, state, toolCtx }) => {
      const nextState = { ...state };
      await toolCtx.generarPdf({
        name: 'Juan Carlos', comuna: 'Temuco',
        items: [{ producto_label: 'Corredera S60', measures: '1500x1000',
                  qty: 1, unit_price: 250000 }],   // sin color
      });
      return { reply: 'ok', history: [{ role: 'user', content: userText }], toolCalls: [], state: nextState };
    },
  };

  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(guardado, 'la sesion tiene que persistirse');
  // [2026-08-31] ESTE CASO CAMBIO DE DESENLACE POR UNA DECISION DEL DUENO, no por un arreglo.
  // Antes, sin color, el gate PREGUNTABA y guardaba `color_preguntado_at`; el reloj existia
  // para que la propuesta asumida saliera igual cuando el cliente no contestaba, y este test
  // defendia que ese reloj se persistiera (si no, bucle: se pregunta para siempre).
  // Desde el 31-ago no se pregunta ni se frena: salen TRES propuestas rotuladas A/B/C. Sin
  // espera no hay reloj que persistir, y sin freno no hay bucle posible.
  // Lo que este test protege ahora es lo que de verdad importa: que al cliente NO se lo frene
  // por un dato que no dio. El reloj del TIPO DE APERTURA, que sigue vigente, se prueba en el
  // test de arriba y no se toco.
  assert.equal(guardado.state.color_preguntado_at, undefined,
    'ya no se pregunta el color: no hay reloj que arrancar');
  assert.ok(!(guardado.state.pendiente_color || guardado.state.esperando_color),
    'y no queda al cliente esperando por un dato que ya no bloquea');
});

/* =========================================================================
 * EL RELOJ RANCIO SE REINICIA — SI NO, VUELVE EL BUCLE POR OTRA PUERTA
 * ========================================================================= */
// 🔴 [2026-08-25] La trampa que anticipo Gemini, en su version real. Al hacer que el reloj
// CADUQUE a las 2 h, el reinicio no puede seguir condicionado a `!state.X`: un cliente que
// vuelve a los tres dias trae un reloj rancio, `!state.X` da false, el reloj NO se reinicia, la
// pregunta nunca vuelve a ser vigente y el plazo NO VENCE JAMAS. Es el mismo bucle que ya
// cerramos, entrando por el reloj viejo. La condicion correcta es `!preguntaVigente(state.X)`.

test('🔴 el cliente que vuelve a los 3 dias: se le pregunta Y el reloj se reinicia', async () => {
  const rancio = Date.now() - 3 * 24 * 60 * 60 * 1000;
  let guardado = null;
  const deps = {
    conv: new Map(), seen: new Set(), locks: new Map(),
    dormir: async () => {},
    leerEstado: async () => null,
    escribirEstado: () => {},
    parseInbound: () => ({
      ok: true, from: '56900000003', type: 'text',
      text: 'hola, ahora necesito 2 ventanas de 1200x1000',   // proyecto nuevo, sin apertura
      msgId: `wamid.${Math.random()}`,
    }),
    // La sesion vieja vuelve del almacenamiento CON el reloj de hace tres dias.
    loadSession: async () => ({ history: [], state: { tipo_preguntado_at: rancio } }),
    sendWhatsAppText: async () => ({ ok: true }),
    generatePdf: async () => Buffer.from('%PDF-1.4 fake'),
    uploadWaDocument: async () => 'media-z',
    sendWaDocument: async () => ({ ok: true, msgId: 'sent-z' }),
    persistSession: (_from, sesion) => { guardado = sesion; },
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({ ok: true }),
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async () => ({ ok: true }),
    },
    handleTurn: async ({ userText, state, toolCtx }) => {
      const nextState = { ...state };
      const r = await toolCtx.generarPdf({
        name: 'Juan Carlos', comuna: 'Temuco',
        items: [{ producto_label: 'Corredera S60', measures: '1200x1000',
                  color: 'Blanco', qty: 1, unit_price: 250000 }],
      });
      return { reply: r?.message || 'ok', history: [{ role: 'user', content: userText }],
               toolCalls: [], state: nextState };
    },
  };

  await handleWebhook({ body: {} }, makeRes(), deps);

  assert.ok(guardado, 'la sesion tiene que persistirse');
  assert.notEqual(guardado.state.tipo_preguntado_at, rancio,
    'el reloj rancio quedo tal cual: la pregunta nunca vuelve a ser vigente y el plazo NO VENCE '
    + 'jamas — el bucle, entrando por el reloj viejo');
  assert.ok(Date.now() - guardado.state.tipo_preguntado_at < 60_000,
    'se le pregunto de nuevo, asi que el reloj tiene que arrancar AHORA');
});
