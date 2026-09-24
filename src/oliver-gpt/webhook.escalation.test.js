// webhook.escalation.test.js — Golden de la ESCALACIÓN DETERMINISTA en WhatsApp.
// [2026-06-18] Paridad con channel-agent.js (IG/FB). La escalación es plata/reputación:
// NO depende del LLM (en prod a veces no avisaba o escribía 'notificar_marcelo' como texto).
// Test HERMÉTICO: todas las deps inyectadas, nada toca Meta/OpenAI/Sales-OS.
//   node --test src/oliver-gpt/webhook.escalation.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook } from './webhook.js';


function makeRes() { return { sentStatus: undefined, sendStatus(c) { this.sentStatus = c; return this; } }; }
function makeReq(text) {
  return { body: { __inbound: { ok: true, from: '56988887777', text, msgId: 'wamid.ESC.' + Math.random().toString(36).slice(2), type: 'text' } } };
}
function makeDeps(overrides = {}) {
  // Uno por test: compartido, los tests reusan el msgId y se descartarian entre si.
  const _kv = new Map();
  const spy = { handleTurnCalls: 0, sendCalls: [], notifyCalls: [], convEvents: [], templateCalls: [] };
  const deps = {
    conv: new Map(), seen: new Set(),
    // [2026-08-08] Estado persistente falso y propio de cada test: el dedupe ahora se
    // respalda en Postgres para que un redeploy no deje pasar un reintento de Meta. Sin
    // esto los tests comparten el cache del modulo, reusan el msgId y se descartan solos.
    leerEstado: async (k) => _kv.get(k) ?? null,
    escribirEstado: (k, v) => _kv.set(k, v),

    parseInbound: (body) => body.__inbound,
    sendWhatsAppText: async (to, text) => { spy.sendCalls.push({ to, text }); return { ok: true }; },
    handleTurn: async ({ state }) => { spy.handleTurnCalls += 1; return { reply: 'cotizando…', history: [], toolCalls: [], state }; },
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async (p) => { spy.convEvents.push(p); return { ok: true }; },
      pushLeadEvent: async () => ({ ok: true }), pushQuoteEvent: async () => ({ ok: true }),
    },
    notifyHighValue: async (...a) => { spy.notifyCalls.push(a); return { sent: true }; },
    sendEscalationTemplate: async (...a) => { spy.templateCalls.push(a); return { ok: true }; },
    loadSession: async () => null,
    persistSession: () => {},
  };
  Object.assign(deps, overrides);
  return { deps, spy };
}

test('escalación: "quiero hablar con un humano" → escala y NO pasa por el LLM', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook(makeReq('Quiero hablar con un humano'), makeRes(), deps);
  assert.equal(spy.handleTurnCalls, 0, 'NO debe llamar al cerebro (LLM) al escalar');
  assert.equal(spy.notifyCalls.length, 1, 'debe avisar al dueño (notifyHighValue)');
  assert.equal(spy.templateCalls.length, 1, 'debe disparar la plantilla garantizada');
  assert.ok(spy.sendCalls.some(c => /\+56 9 5729 6035/.test(c.text)), 'debe enviar el mensaje con el WhatsApp directo de Marcelo');
  assert.ok(spy.convEvents.some(e => e.metadata && e.metadata.escalation === true), 'debe persistir marcado escalation:true');
});

test('escalación: cliente molesto ("estoy muy enojado") → escala', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook(makeReq('estoy muy enojado con la atención'), makeRes(), deps);
  assert.equal(spy.handleTurnCalls, 0, 'no pasa por el LLM');
  assert.equal(spy.notifyCalls.length, 1, 'avisa al dueño');
});

test('escalación: "pásame con Marcelo" → escala', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook(makeReq('pásame con Marcelo por favor'), makeRes(), deps);
  assert.equal(spy.notifyCalls.length, 1);
});

test('NO escala: cliente normal ("quiero cotizar una ventana") → pasa al cerebro', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook(makeReq('Hola, quiero cotizar una ventana de PVC'), makeRes(), deps);
  assert.equal(spy.handleTurnCalls, 1, 'debe llamar al cerebro normalmente');
  assert.equal(spy.notifyCalls.length, 0, 'NO debe escalar una consulta normal');
});

test('NO escala: agradecimiento ("muchas gracias") → flujo normal', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook(makeReq('perfecto, muchas gracias'), makeRes(), deps);
  assert.equal(spy.handleTurnCalls, 1);
  assert.equal(spy.notifyCalls.length, 0);
});

// 🔴 [#888 · 24-sep] EL FALLO DEL AVISO ERA INVISIBLE, Y AL CLIENTE SE LE DECÍA QUE NO.
// Lo encontró una auditoría de fan-out y se confirmó leyendo el camino completo:
//   · `safe()` solo loguea si la función LANZA (webhook.js:680)
//   · ni notifyHighValue ni sendEscalationTemplate lanzan: devuelven {sent:false} / {ok:false}
//   · ese valor se descartaba sin leerlo, y acto seguido se le manda al cliente un texto que dice
//     "Le avisé al Ing. Marcelo Cifuentes Méndez... Te contacta personalmente"
// O sea: con ADMIN_PIN sin setear, o SELF_URL mal, o un timeout de Meta, Marcelo NO se enteraba de
// que un cliente pidió hablar con una persona, NO quedaba rastro en ningún lado, y el cliente se iba
// creyendo que lo iban a llamar. Es lo más caro que pasa por este bot.
test('#888: si NINGUNO de los dos avisos sale, queda registrado en la conversación', async () => {
  const { deps, spy } = makeDeps({
    notifyHighValue: async () => ({ sent: false, error: 'timeout de Meta' }),
    sendEscalationTemplate: async () => ({ ok: false, error: 'ADMIN_PIN_missing' }),
  });
  await handleWebhook(makeReq('quiero hablar con un humano'), makeRes(), deps);

  const aviso = spy.convEvents.find((e) => e?.metadata?.aviso_fallido === true);
  assert.ok(aviso, 'sin esta marca, el fallo del aviso no existe para nadie: ni log, ni panel, ni informe');
  assert.match(aviso.body, /NO salió/, 'y tiene que decir qué pasó, no un código');
  assert.match(aviso.body, /a mano/, 'con qué hacer: llamarlo, porque el cliente quedó esperando');
  assert.equal(aviso.metadata.motivo_template, 'ADMIN_PIN_missing', 'y el motivo real, para poder arreglarlo');
  // El mensaje al cliente se sigue enviando: tiene el WhatsApp directo y el link para agendar, así que
  // NO dejarlo sin respuesta es lo correcto. Lo que se arregla es que el fallo dejaba de existir.
  assert.ok(spy.sendCalls.some((c) => /Marcelo Cifuentes/.test(c.text)), 'el cliente igual recibe respuesta');
});

test('#888: basta que UNO de los dos avisos salga para no marcar fallo (no se inventa una alarma)', async () => {
  const { deps, spy } = makeDeps({
    notifyHighValue: async () => ({ sent: false, reason: 'cooldown' }), // no-envío DELIBERADO, no una falla
    sendEscalationTemplate: async () => ({ ok: true }),
  });
  await handleWebhook(makeReq('pásame con Marcelo'), makeRes(), deps);
  assert.ok(!spy.convEvents.some((e) => e?.metadata?.aviso_fallido === true),
    'el template salió: Marcelo SÍ se enteró, marcar fallo sería ruido');
});

test('#888: con los dos avisos OK, nada cambia respecto de antes', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook(makeReq('estoy muy enojado'), makeRes(), deps);
  assert.ok(!spy.convEvents.some((e) => e?.metadata?.aviso_fallido === true));
  assert.equal(spy.notifyCalls.length, 1);
  assert.equal(spy.templateCalls.length, 1);
});

// 🔴 [#888 r2 · TRIDENTE, 24-sep] EL TEST QUE FALTABA, Y LO PIDIERON DOS REVISORES POR SEPARADO.
// Kimi K3 y Gemini, sin verse, encontraron el MISMO defecto de la r1: contar un no-envío DELIBERADO
// como si el aviso hubiera fallado. Verificado en highValueNotifier.js:190-193 — `cooldown` significa
// que YA se mandó una alerta con la misma key y tier igual o mayor hace poco. O sea: Marcelo YA SABE.
// Sin este arreglo, el cliente insiste dos veces en esa ventana, el template tiene un timeout, y se le
// escribe "hay que llamarlo a mano" por un aviso que sí salió. Fatiga de alarma, que es cómo se
// consigue que el dueño deje de leer el panel.
test('#888 r2: cooldown NO es una falla — el dueño ya se enteró, aunque el template falle', async () => {
  const { deps, spy } = makeDeps({
    notifyHighValue: async () => ({ sent: false, reason: 'cooldown' }), // ya avisado hace poco
    sendEscalationTemplate: async () => ({ ok: false, error: 'timeout' }),
  });
  await handleWebhook(makeReq('quiero hablar con un humano'), makeRes(), deps);
  assert.ok(!spy.convEvents.some((e) => e?.metadata?.aviso_fallido === true),
    'marcar "hay que llamarlo a mano" cuando ya se avisó es una alarma falsa');
});

// [#888 r2 · Kimi, MEDIA] Un no-envío por CONFIGURACIÓN ROTA sí es una falla, aunque el otro camino
// salve la situación: el canal principal queda muerto y antes no se decía nada.
test('#888 r2: no_owner_phone SÍ es una falla (config rota), pero si el template salió no hay pánico', async () => {
  const { deps, spy } = makeDeps({
    notifyHighValue: async () => ({ sent: false, reason: 'no_owner_phone' }),
    sendEscalationTemplate: async () => ({ ok: true }),
  });
  await handleWebhook(makeReq('pásame con Marcelo'), makeRes(), deps);
  assert.ok(!spy.convEvents.some((e) => e?.metadata?.aviso_fallido === true),
    'el aviso SÍ llegó por el template: no corresponde pedir una llamada a mano');
});

// [#888 r2 · Kimi MEDIA-ALTA, y Gemini lo confirmó] Alguien que pide hablar con una persona INSISTE,
// y con razón. Sin deduplicación, 5 mensajes = 5 eventos idénticos saturando el panel.
test('#888 r2: el aviso de fallo NO se duplica si el cliente insiste', async () => {
  const kv = new Map();
  const { deps, spy } = makeDeps({
    notifyHighValue: async () => ({ sent: false, error: 'timeout de Meta' }),
    sendEscalationTemplate: async () => ({ ok: false, error: 'ADMIN_PIN_missing' }),
    leerEstado: async (k) => kv.get(k) ?? null,
    escribirEstado: (k, v) => kv.set(k, v),
  });
  await handleWebhook(makeReq('quiero hablar con un humano'), makeRes(), deps);
  await handleWebhook(makeReq('hola? quiero hablar con una persona'), makeRes(), deps);
  await handleWebhook(makeReq('necesito hablar con un humano por favor'), makeRes(), deps);
  const fallidos = spy.convEvents.filter((e) => e?.metadata?.aviso_fallido === true);
  assert.equal(fallidos.length, 1, `se escribieron ${fallidos.length} eventos idénticos: satura el panel`);
  assert.match(fallidos[0].metadata.motivo_template, /ADMIN_PIN/, 'y el motivo real queda en la conversación');
});

test('#888 r2: si NO se puede leer la marca de deduplicación, avisa igual (ante la duda, avisa)', async () => {
  const { deps, spy } = makeDeps({
    notifyHighValue: async () => ({ sent: false, error: 'timeout' }),
    sendEscalationTemplate: async () => ({ ok: false, error: 'timeout' }),
    leerEstado: async () => { throw new Error('kv caido'); },
  });
  await handleWebhook(makeReq('quiero hablar con un humano'), makeRes(), deps);
  assert.ok(spy.convEvents.some((e) => e?.metadata?.aviso_fallido === true),
    'un evento repetido molesta; uno que falta deja a un cliente esperando una llamada que nadie hará');
});

// [#888 r2 · Codex en el tridente, MEDIA] EL CASO QUE FALTABA: notify OK + template fallido.
// Codex lo dijo exacto: "`avisoLlego = avisoTemplate` pasaría los tres tests nuevos". O sea que los
// tests no distinguían entre mirar los dos canales y mirar sólo uno. Este lo distingue.
test('#888 r2: si notify SALIÓ y el template falló, NO hay pánico (Marcelo ya se enteró)', async () => {
  const { deps, spy } = makeDeps({
    notifyHighValue: async () => ({ sent: true, score: { tier: 'HIGH' } }),
    sendEscalationTemplate: async () => ({ ok: false, error: 'ADMIN_PIN_missing' }),
  });
  await handleWebhook(makeReq('quiero hablar con un humano'), makeRes(), deps);
  assert.ok(!spy.convEvents.some((e) => e?.metadata?.aviso_fallido === true),
    'el aviso principal salió: pedir una llamada a mano sería una alarma falsa');
});
