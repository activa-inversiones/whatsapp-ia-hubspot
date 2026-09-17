// webhook.postventa.test.js — [2026-09-17 · #785-bis, pedido del dueño]
// OLIVER TIENE QUE SABER CUÁNDO EL CLIENTE YA COMPRÓ.
//
// 🔴 EL DEFECTO MEDIDO (16-09): `/internal/conversation-control/:phone` devuelve
// `ai_paused`, `operator_status` Y `quote_status` en la MISMA respuesta
// (server.js:1892). El webhook leía los dos primeros y TIRABA el tercero. Como
// además la sesión persistida de un cliente cerrado guarda teléfono y click-ids
// pero CERO turnos de historial (medido en `whatsapp_sessions`), un cliente que
// ya compró escribía "¿cuándo me instalan?" y Oliver arrancaba de cero: saludo,
// perfilamiento de la REGLA #28 ("¿es para su hogar, subsidio SERVIU, o es
// arquitecto?") y a cotizar de nuevo. Al cliente que acaba de pagar se le
// trataba como a un desconocido.
//
// Test HERMÉTICO: todas las deps inyectadas, nada toca Meta/Anthropic/Sales-OS.
//   node --test src/oliver-gpt/webhook.postventa.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook } from './webhook.js';
import { buildSessionContext } from './system-prompt.js';

function makeRes() { return { sentStatus: undefined, sendStatus(c) { this.sentStatus = c; return this; } }; }
function makeReq(text) {
  return { body: { __inbound: { ok: true, from: '56998844752', text, msgId: 'wamid.PV.' + Math.random().toString(36).slice(2), type: 'text' } } };
}
function makeDeps(control, overrides = {}) {
  const _kv = new Map();
  const spy = { estados: [] };
  const deps = {
    conv: new Map(), seen: new Set(),
    leerEstado: async (k) => _kv.get(k) ?? null,
    escribirEstado: (k, v) => _kv.set(k, v),
    parseInbound: (body) => body.__inbound,
    sendWhatsAppText: async () => ({ ok: true }),
    // Se espía el `state` con el que se llama al cerebro: ahí viaja la bandera.
    // 🔴 SE GUARDA UNA COPIA, NO LA REFERENCIA. El webhook borra `ya_compro` de
    // `newState` después del turno (es del turno, no de la sesión), y con la
    // referencia viva el espía veía la bandera BORRADA — un falso negativo del
    // test sobre un código que funciona. El cerebro real trabaja sobre su propia
    // copia (`agent.js:50: const nextState = { ...state }`), así que lee la
    // bandera antes de que nadie la toque; esta copia reproduce eso.
    handleTurn: async ({ state }) => {
      spy.estados.push({ ...state });
      return { reply: 'ya lo veo', history: [], toolCalls: [], state };
    },
    bridge: {
      getConversationControl: async () => control,
      pushConversationEvent: async () => ({ ok: true }),
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async () => ({ ok: true }),
    },
    notifyHighValue: async () => ({ sent: true }),
    sendEscalationTemplate: async () => ({ ok: true }),
    loadSession: async () => null,
    persistSession: () => {},
  };
  Object.assign(deps, overrides);
  return { deps, spy };
}

// ── El circuito completo: del control al cerebro ───────────────────────────
test('🔴 quote_status=won llega al cerebro como ya_compro', async () => {
  const { deps, spy } = makeDeps({ ai_paused: false, operator_status: 'ai', quote_status: 'won' });
  await handleWebhook(makeReq('hola, ¿cuándo me instalan?'), makeRes(), deps);
  assert.equal(spy.estados.length, 1, 'el turno tiene que llegar al cerebro');
  assert.equal(spy.estados[0].ya_compro, true,
    'si esto es false, el dato se sigue tirando y Oliver vuelve a tratar al cliente como un desconocido');
});

test('un cliente normal NO entra en postventa', async () => {
  for (const etapa of ['sent', 'aprobado', 'perdida', 'descartado', 'none', undefined]) {
    const { deps, spy } = makeDeps({ ai_paused: false, operator_status: 'ai', quote_status: etapa });
    await handleWebhook(makeReq('hola, quiero cotizar'), makeRes(), deps);
    assert.equal(spy.estados[0]?.ya_compro, false, `etapa ${etapa} no puede activar postventa`);
  }
});

// 🔴 SIN CONTROL, EL COMPORTAMIENTO ES EL DE SIEMPRE. El bridge devuelve
// `_error` cuando sales-os está caído: ahí no se sabe nada del cliente, y
// "no sé" nunca puede significar "ya compró".
test('🔴 si el control falla, NO se inventa una postventa', async () => {
  const { deps, spy } = makeDeps({ ai_paused: false, operator_status: 'ai', _error: true });
  await handleWebhook(makeReq('hola'), makeRes(), deps);
  assert.equal(spy.estados[0]?.ya_compro, false);
});

// Se puede apagar desde Railway sin deploy, como el resto de los interruptores
// del bot. Un comportamiento nuevo en el bot que NO se puede apagar es un
// comportamiento que hay que deployear dos veces para sacarlo.
test('OLIVER_POSTVENTA=false lo apaga sin tocar código', async () => {
  const previo = process.env.OLIVER_POSTVENTA;
  process.env.OLIVER_POSTVENTA = 'false';
  try {
    const { deps, spy } = makeDeps({ ai_paused: false, operator_status: 'ai', quote_status: 'won' });
    await handleWebhook(makeReq('hola'), makeRes(), deps);
    assert.equal(spy.estados[0]?.ya_compro, false);
  } finally {
    if (previo === undefined) delete process.env.OLIVER_POSTVENTA;
    else process.env.OLIVER_POSTVENTA = previo;
  }
});

// ── Y lo que el cerebro efectivamente lee ─────────────────────────────────
test('el contexto del turno le prohíbe perfilar y cotizar de nuevo', () => {
  const ctx = buildSessionContext({ ya_compro: true, nombre: 'Claudia Díaz' });
  assert.match(ctx, /YA COMPR/, 'tiene que decirlo con todas las letras');
  assert.match(ctx, /REGLA #28/, 'nombrar la regla que NO debe aplicar: perfilar a quien ya te compró');
  assert.match(ctx, /1 AÑO herrajes/,
    'la garantía real del PDF firmado: el 19-ago Oliver prometía 5 años y quedaba en evidencia');
  assert.match(ctx, /ESCALE A MARCELO/, 'un reclamo de garantía no lo resuelve un bot');
});

test('sin la bandera, el contexto queda exactamente como estaba', () => {
  const ctx = buildSessionContext({ nombre: 'Juan' });
  assert.doesNotMatch(ctx, /YA COMPR/);
  assert.match(ctx, /CONTEXTO DE LA SESI/, 'el resto del bloque no se toca');
});

// El cliente que ya compró y quiere OTRA cosa es una venta nueva: el bloque
// tiene que dejar esa puerta abierta, o le cerramos el negocio al que más
// confianza nos tiene.
test('la puerta a una venta NUEVA queda abierta', () => {
  const ctx = buildSessionContext({ ya_compro: true });
  assert.match(ctx, /algo NUEVO/);
  assert.match(ctx, /venta nueva/);
});

// 🔴 [compuerta cruzada · Codex #1] EL CASO QUE MATABA EL CAMBIO.
// Un control que falló (`_error: true`) no dice nada sobre el cliente. Si
// encima trajera un `quote_status` viejo o cacheado, la versión anterior lo
// creía: un LEAD que quiere comprar caía en postventa y Oliver dejaba de
// venderle. «No sé» nunca puede significar «ya compró».
test('🔴 _error con un quote_status won pegado NO activa postventa', async () => {
  const { deps, spy } = makeDeps({ ai_paused: false, operator_status: 'ai', quote_status: 'won', _error: true });
  await handleWebhook(makeReq('hola, quiero cotizar ventanas'), makeRes(), deps);
  assert.equal(spy.estados[0]?.ya_compro, false,
    'un control caído no puede mandar a postventa a alguien que viene a comprar');
});

test('un control nulo o basura tampoco la activa', async () => {
  for (const control of [null, undefined, 'won', 42]) {
    const { deps, spy } = makeDeps(control);
    await handleWebhook(makeReq('hola'), makeRes(), deps);
    assert.equal(spy.estados[0]?.ya_compro, false, 'control ' + JSON.stringify(control));
  }
});

// 🔴 [compuerta cruzada · Codex #3] LA BANDERA NO SE GUARDA EN LA SESIÓN.
// Se recalcula del control en cada turno. Persistirla dejaría «ya_compro: true»
// escrito en la BD después de que el dueño revierta una venta.
test('🔴 ya_compro no se persiste en la sesión', async () => {
  const guardado = [];
  const { deps } = makeDeps(
    { ai_paused: false, operator_status: 'ai', quote_status: 'won' },
    { persistSession: (...a) => guardado.push(a) },
  );
  await handleWebhook(makeReq('hola'), makeRes(), deps);
  for (const llamada of guardado) {
    const json = JSON.stringify(llamada);
    assert.ok(!json.includes('ya_compro'), 'la bandera del turno no puede quedar guardada: ' + json.slice(0, 200));
  }
});

// 🔴 [compuerta cruzada · Codex #4] LOS GATES MANDAN SOBRE LA POSTVENTA.
// Que el cliente haya comprado no puede colarse por encima del takeover: si un
// humano tiene el chat, el bot NO habla, compre quien compre.
test('🔴 won + chat tomado por un humano: el bot NO habla', async () => {
  for (const control of [
    { ai_paused: true, operator_status: 'human', quote_status: 'won' },
    { ai_paused: false, operator_status: 'human', quote_status: 'won' },
  ]) {
    const { deps, spy } = makeDeps(control);
    await handleWebhook(makeReq('¿cuándo me instalan?'), makeRes(), deps);
    assert.equal(spy.estados.length, 0,
      'el takeover manda: ni siquiera se llega al cerebro');
  }
});

// ── [compuerta cruzada · Gemini] LO QUE RECIBE EL CLIENTE ──────────────────
// 🔴 #2 — A QUIEN YA PAGÓ SE LE DEBE MÁS CALIDEZ, NO MENOS. El bloque es casi
// todo prohibiciones, y un modelo al que solo se le dice "no haga esto"
// contesta seco. La instrucción de tono tiene que estar y estar ARRIBA.
test('🔴 el bloque le pide calidez, no solo prohibiciones', () => {
  const ctx = buildSessionContext({ ya_compro: true });
  assert.match(ctx, /TONO: cálido/);
  assert.ok(ctx.indexOf('TONO: cálido') < ctx.indexOf('PROHIBIDO'),
    'la calidez va ANTES que la lista de prohibiciones, o el modelo se queda con lo último');
});

// 🔴 #1 — MARCELO ES UNO SOLO. Oliver no tiene el sistema de fábrica ni la
// agenda de las cuadrillas: con un "si no sabe, escale" pelado, cada "¿cómo va
// mi ventana?" le llegaba a Marcelo. Primero contesta lo que sí sabe.
test('🔴 una pregunta general de plazo la contesta él, no escala', () => {
  const ctx = buildSessionContext({ ya_compro: true });
  assert.match(ctx, /Pregunta GENERAL por plazos/);
  assert.match(ctx, /8 a 10 días hábiles desde que confirm/,
    'el dato que SÍ tiene, y es el mismo del PDF');
  assert.match(ctx, /DATO PUNTUAL/, 'y el límite claro de cuándo sí escalar');
});
