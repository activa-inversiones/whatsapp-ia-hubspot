// webhook.cerebro-respaldo.test.js — [2026-09-17 · pedido del dueño]
// SI OLIVER CAE AL CEREBRO DE RESPALDO, EL DUEÑO SE TIENE QUE ENTERAR.
//
// 🔴 LO MEDIDO (17-sep, BD viva, 30 días): 74 mensajes contestados por el cerebro
// de respaldo en CINCO episodios (5, 6, 7, 14 y 15 de septiembre), los 74 por la
// misma causa: "credit balance is too low". El 6-sep fue el día ENTERO — cero
// mensajes por el principal, 31 por el respaldo.
//
// 🔴 Y NADIE SE ENTERÓ NUNCA. El dato quedaba escrito en `metadata.cerebro` de
// cada mensaje y ninguna pantalla lo miraba. Un respaldo que no avisa no es un
// respaldo: es una degradación invisible sobre clientes reales, contestando con
// un modelo distinto a aquel sobre el que está calibrado todo el prompt.
//
// Test HERMÉTICO: nada toca Meta/Anthropic/Sales-OS.
//   node --test src/oliver-gpt/webhook.cerebro-respaldo.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mensajeCerebroRespaldo, causaDelRespaldo, claveAvisoRespaldo, RESPALDO_REPETIR_MS,
} from '../../services/avisoCerebroRespaldo.js';
import { tocaAvisar } from '../../services/avisoEntregaDudosa.js';
import { handleWebhook } from './webhook.js';

// El motivo crudo que devolvió Anthropic el 14-sep, tal cual quedó en la BD.
const MOTIVO_REAL = 'anthropic falló (400): 400 {"type":"error","error":{"type":"invalid_request_error",'
  + '"message":"Your credit balance is too low to access the Anthropic API"';

test('🔴 el motivo real del 14-sep se clasifica como SIN SALDO', () => {
  assert.equal(causaDelRespaldo(MOTIVO_REAL), 'sin_saldo');
});

test('las otras causas no se confunden con falta de saldo', () => {
  assert.equal(causaDelRespaldo('429 rate limit exceeded'), 'limite');
  assert.equal(causaDelRespaldo('529 overloaded_error'), 'sobrecarga');
  assert.equal(causaDelRespaldo('ECONNRESET'), 'otro');
  assert.equal(causaDelRespaldo(''), 'otro');
  assert.equal(causaDelRespaldo(null), 'otro');
});

// 🔴 EL AVISO TIENE QUE DECIR QUÉ HACER, NO SOLO QUE ALGO PASÓ. Regla del dueño
// (27-ago): "siempre dame el link y qué hacer si necesitas que me conecte a algo".
test('🔴 el aviso de saldo trae el link de facturación y el qué hacer', () => {
  const m = mensajeCerebroRespaldo({ causa: 'sin_saldo', proveedor: 'openai' });
  assert.match(m, /console\.anthropic\.com\/settings\/billing/);
  assert.match(m, /Auto-reload/, 'lo que corta el ciclo de raíz, no solo recargar una vez');
  assert.match(m, /respaldo/i);
});

test('cada causa dice algo distinto: una sobrecarga no se arregla recargando', () => {
  const saldo = mensajeCerebroRespaldo({ causa: 'sin_saldo' });
  const sobrecarga = mensajeCerebroRespaldo({ causa: 'sobrecarga' });
  assert.match(sobrecarga, /se normaliza solo/);
  assert.doesNotMatch(sobrecarga, /billing/,
    'mandarlo a recargar cuando el problema es del proveedor le hace perder el tiempo');
  assert.notEqual(saldo, sobrecarga);
});

// El texto lo lee una persona en el celular, no un log.
test('el aviso dice qué les pasa a los CLIENTES, no solo qué falló', () => {
  const m = mensajeCerebroRespaldo({ causa: 'sin_saldo', proveedor: 'openai' });
  assert.match(m, /clientes siguen siendo atendidos/,
    'lo primero que uno quiere saber es si se está perdiendo gente');
});

// ── El throttle ───────────────────────────────────────────────────────────
// 🔴 EL 6-SEP HUBO 31 RESPALDOS EN UN DÍA. Sin throttle serían 31 WhatsApps a
// Marcelo por un solo hecho, y el aviso 5 ya no se lee.
test('🔴 una vez por día: 31 caídas no son 31 avisos', () => {
  const clave = claveAvisoRespaldo('sin_saldo', new Date('2026-09-06T14:00:00Z'));   // 10:00 en Chile
  const misma = claveAvisoRespaldo('sin_saldo', new Date('2026-09-07T02:30:00Z'));   // 23:30 del MISMO dia chileno
  assert.equal(clave, misma, 'todo el dia chileno comparte llave');
  const otroDia = claveAvisoRespaldo('sin_saldo', new Date('2026-09-07T14:00:00Z')); // 10:00 del dia siguiente
  assert.notEqual(clave, otroDia, 'al dia siguiente vuelve a avisar: sigue roto');
});

// 🔴 [compuerta cruzada · Codex #4] EL DÍA ES EL DE CHILE, NO EL DE UTC.
// Con `toISOString()` la llave cambiaba a las 21:00 de Santiago y mandaba DOS
// avisos con minutos de diferencia dentro de la misma noche. Y no es teorico:
// los cinco episodios medidos empezaron de noche (00:17, 22:44, 01:57, 22:56),
// justo en ese borde. Este test fallaba con la version UTC — estaba escrito
// contra el comportamiento equivocado.
test('🔴 el borde de las 21:00 de Santiago NO parte el dia', () => {
  const antes   = claveAvisoRespaldo('sin_saldo', new Date('2026-09-06T23:59:00Z')); // 20:59 Chile
  const despues = claveAvisoRespaldo('sin_saldo', new Date('2026-09-07T00:10:00Z')); // 21:10 Chile, MISMO dia
  assert.equal(antes, despues,
    'en UTC son dias distintos; para el dueño, que es quien lee el WhatsApp, es la misma noche');
});

// Quedarse sin saldo y que la API esté sobrecargada se arreglan distinto: si
// cambia la causa, hay que avisar aunque sea el mismo día.
test('si cambia la CAUSA, se avisa igual aunque sea el mismo día', () => {
  const dia = new Date('2026-09-06T10:00:00Z');
  assert.notEqual(claveAvisoRespaldo('sin_saldo', dia), claveAvisoRespaldo('sobrecarga', dia));
});

test('la ventana del throttle es de un día', () => {
  assert.equal(RESPALDO_REPETIR_MS, 24 * 3600 * 1000);
  const ahora = Date.now();
  assert.equal(tocaAvisar(ahora - 3600 * 1000, ahora, RESPALDO_REPETIR_MS), false, 'hace 1 h: no');
  assert.equal(tocaAvisar(ahora - 25 * 3600 * 1000, ahora, RESPALDO_REPETIR_MS), true, 'hace 25 h: sí');
  assert.equal(tocaAvisar(null, ahora, RESPALDO_REPETIR_MS), true, 'sin marca previa: avisa');
});

// ── EL CABLEADO: ¿de verdad sale el WhatsApp? ──────────────────────────────
// 🔴 Los tests de arriba prueban el TEXTO y el THROTTLE. Este prueba que la
// alerta se dispare desde el webhook — que es donde un ReferenceError se lo
// traga el try externo y Oliver sigue andando sin que nadie se entere.

function makeRes() { return { sendStatus() { return this; } }; }
// 🔴 UN TELÉFONO DISTINTO POR TEST. El rate limiter y el mapa de locks del
// webhook son del MÓDULO, o sea compartidos entre tests: el test que manda 31
// turnos seguidos lo dispara, y los tests siguientes con el mismo número ven sus
// turnos descartados en silencio — un falso negativo que parece un bug del
// código. Cada test trae su propio número.
function makeReq(text, from = '56911112222') {
  return { body: { __inbound: { ok: true, from, text, msgId: 'wamid.CR.' + Math.random().toString(36).slice(2), type: 'text' } } };
}
function makeDeps(prov, overrides = {}) {
  const _kv = new Map();
  const _res = new Set();
  const spy = { enviados: [] };
  const deps = {
    conv: new Map(), seen: new Set(),
    leerEstado: async (k) => _kv.get(k) ?? null,
    escribirEstado: (k, v) => { _kv.set(k, v); return true; },
    // Reserva en memoria, como la real: atomica y sin depender del KV durable.
    reservarEstado: (k) => (_res.has(k) ? null : (_res.add(k), 'tok-' + k)),
    liberarReserva: (k) => _res.delete(k),
    parseInbound: (body) => body.__inbound,
    sendWhatsAppText: async (to, text) => { spy.enviados.push({ to, text }); return { ok: true }; },
    handleTurn: async ({ state }) => ({ reply: 'listo', history: [], toolCalls: [], state }),
    proveedorDelTurno: () => prov,
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({ ok: true }),
      pushLeadEvent: async () => ({ ok: true }), pushQuoteEvent: async () => ({ ok: true }),
    },
    notifyHighValue: async () => ({ sent: true }),
    sendEscalationTemplate: async () => ({ ok: true }),
    loadSession: async () => null, persistSession: () => {},
  };
  Object.assign(deps, overrides);
  return { deps, spy };
}
const esperar = () => new Promise((r) => setTimeout(r, 60));   // el aviso es fire-and-forget

test('🔴 con el cerebro de respaldo, a Marcelo le llega el aviso', async () => {
  const { deps, spy } = makeDeps({ cerebro: 'openai', cerebro_respaldo: true, cerebro_motivo: MOTIVO_REAL });
  await handleWebhook(makeReq('hola'), makeRes(), deps);
  await esperar();
  const aviso = spy.enviados.find((e) => /cerebro de respaldo/i.test(e.text));
  assert.ok(aviso, 'si esto falla, el respaldo vuelve a ser invisible');
  assert.match(aviso.text, /console\.anthropic\.com/);
});

test('con el cerebro normal NO se molesta a nadie', async () => {
  const { deps, spy } = makeDeps({ cerebro: 'anthropic', cerebro_respaldo: false });
  await handleWebhook(makeReq('hola'), makeRes(), deps);
  await esperar();
  assert.equal(spy.enviados.filter((e) => /cerebro de respaldo/i.test(e.text)).length, 0);
});

// Un turno sin modelo (comando determinista, takeover, PDF por código) devuelve {}.
test('un turno que no llamó al modelo no dispara nada', async () => {
  const { deps, spy } = makeDeps({});
  await handleWebhook(makeReq('hola'), makeRes(), deps);
  await esperar();
  assert.equal(spy.enviados.filter((e) => /cerebro de respaldo/i.test(e.text)).length, 0);
});

test('OLIVER_ALERTA_RESPALDO=false la apaga sin deploy', async () => {
  const previo = process.env.OLIVER_ALERTA_RESPALDO;
  process.env.OLIVER_ALERTA_RESPALDO = 'false';
  try {
    const { deps, spy } = makeDeps({ cerebro: 'openai', cerebro_respaldo: true, cerebro_motivo: MOTIVO_REAL });
    await handleWebhook(makeReq('hola'), makeRes(), deps);
    await esperar();
    assert.equal(spy.enviados.filter((e) => /cerebro de respaldo/i.test(e.text)).length, 0);
  } finally {
    if (previo === undefined) delete process.env.OLIVER_ALERTA_RESPALDO;
    else process.env.OLIVER_ALERTA_RESPALDO = previo;
  }
});

// 🔴 [compuerta cruzada · Codex #1] EL CASO QUE MATABA EL CAMBIO.
// La primera versión hacía leer → decidir → enviar, con "ante la duda, avisa".
// Con el KV caído eso es UN WHATSAPP POR TURNO: el 6-sep hubo 31 respaldos en un
// día ⇒ 31 avisos por un solo hecho, y el quinto ya nadie lo lee. La reserva vive
// en MEMORIA, así que corta igual aunque el almacenamiento durable no conteste.
test('🔴 con el KV caído, 31 turnos siguen siendo UN aviso', async () => {
  const { deps, spy } = makeDeps(
    { cerebro: 'openai', cerebro_respaldo: true, cerebro_motivo: MOTIVO_REAL },
    {
      // Falla SOLO la llave del aviso. Si se rompe todo el KV, se cae antes el
      // dedupe interno del webhook y el turno no llega hasta acá: se estaría
      // probando otra cosa.
      leerEstado: async (k) => {
        if (String(k).startsWith('aviso_cerebro_respaldo')) throw new Error('KV caído');
        return null;
      },
      escribirEstado: (k) => {
        if (String(k).startsWith('aviso_cerebro_respaldo')) throw new Error('KV caído');
        return true;
      },
    },
  );
  for (let i = 0; i < 31; i++) {
    await handleWebhook(makeReq('mensaje ' + i, '56933330001'), makeRes(), deps);
  }
  await esperar();
  const avisos = spy.enviados.filter((e) => /cerebro de respaldo/i.test(e.text));
  assert.equal(avisos.length, 1, `salieron ${avisos.length} avisos: el throttle no puede depender del KV`);
});

// Si el WhatsApp no salió, la reserva se suelta y el próximo turno reintenta:
// perder el único aviso del día por un error de red sería quedarse ciego igual.
test('🔴 si el aviso no sale, el próximo turno lo reintenta', async () => {
  // Se cuentan SOLO los intentos del aviso: `sendWhatsAppText` es la misma
  // funcion con la que se le contesta al cliente, y sumar esas respuestas daba
  // un numero que no medía nada.
  let intentos = 0;
  const { deps } = makeDeps(
    { cerebro: 'openai', cerebro_respaldo: true, cerebro_motivo: MOTIVO_REAL },
    {
      sendWhatsAppText: async (to, text) => {
        if (/cerebro de respaldo/i.test(text || '')) { intentos += 1; return { ok: false }; }
        return { ok: true };
      },
    },
  );
  await handleWebhook(makeReq('uno', '56933330002'), makeRes(), deps);
  await esperar();
  await handleWebhook(makeReq('dos', '56933330002'), makeRes(), deps);
  await esperar();
  assert.equal(intentos, 2, 'un envío fallido no puede consumir el aviso del día');
});

// 🔴 [compuerta cruzada · Codex #3] EL AVISO NUNCA LE LLEGA AL CLIENTE.
// El destino sale de variables de entorno. Un OWNER_PHONE mal pegado con el
// número de un cliente le mandaría a ESE cliente un mensaje interno diciendo que
// el bot está degradado, con un link de facturación.
test('🔴 si OWNER_PHONE es el número del cliente, NO se manda nada', async () => {
  const previo = process.env.OWNER_PHONE;
  process.env.OWNER_PHONE = '+56 9 3333 0003';          // el MISMO del cliente, con otro formato
  try {
    const { deps, spy } = makeDeps({ cerebro: 'openai', cerebro_respaldo: true, cerebro_motivo: MOTIVO_REAL });
    await handleWebhook(makeReq('hola', '56933330003'), makeRes(), deps);
    await esperar();
    assert.equal(spy.enviados.filter((e) => /cerebro de respaldo/i.test(e.text)).length, 0,
      'ni siquiera con el teléfono escrito en otro formato');
  } finally {
    if (previo === undefined) delete process.env.OWNER_PHONE;
    else process.env.OWNER_PHONE = previo;
  }
});

// 🔴 [#1094] LA RESERVA Y LA MARCA DURABLE NO PUEDEN SER LA MISMA CLAVE.
//
// CAUSA RAÍZ: `avisarCerebroDeRespaldo` usaba `k = claveAvisoRespaldo(causa)` para las DOS cosas: `reservarEstado(k)` y la
// marca durable `{at, causa}` que `escribirEstado(k)` deja tras un envío. Pero `estadoPersistente.reservar()` hace
// `escribir(clave, token)` —memoria + PUT a Postgres— (`reservar` en estadoPersistente.js). Tras un REDEPLOY (memoria vacía):
//   1. `reservar(k)` tiene éxito (la memoria está vacía; no mira Postgres) y PISA la marca durable con su token;
//   2. el `leerEstado(k)` siguiente pega en la MEMORIA, que ahora tiene ese token (un string, sin `.at`);
//   3. `tocaAvisar(undefined)` ⇒ true ⇒ el aviso sale OTRA VEZ, aunque el de hoy ya había salido.
// O sea: la «marca durable que cubre un redeploy en medio del episodio» (el comentario del código) no existía; el aviso
// se repetía una vez por redeploy durante el episodio. Es el mismo defecto que `avisarVidrio` ya evitaba.
//
// Por qué no lo cazaba ningún test: el `makeDeps` de arriba finge `reservarEstado` con un Set APARTE del KV, o sea no
// escribe el token en la clave que `leerEstado` lee. Este test usa el `estadoPersistente.js` REAL (contra un «Postgres»
// de mentira que sobrevive al reinicio) y simula el redeploy con una instancia nueva del módulo (memoria vacía).
function armarPostgresFalso() {
  const disco = new Map();
  const fetchFalso = async (url, opts = {}) => {
    const clave = decodeURIComponent(String(url).split('/internal/kv/')[1] || '');
    const metodo = opts.method || 'GET';
    if (metodo === 'GET') return { ok: true, json: async () => ({ ok: true, valor: disco.has(clave) ? disco.get(clave) : null }) };
    if (metodo === 'PUT') { disco.set(clave, JSON.parse(opts.body).valor); return { ok: true, json: async () => ({ ok: true }) }; }
    if (metodo === 'DELETE') { disco.delete(clave); return { ok: true, json: async () => ({ ok: true }) }; }
    return { ok: false, json: async () => ({}) };
  };
  return { disco, fetchFalso };
}

/** Una instancia NUEVA de estadoPersistente.js (= un proceso recién desplegado: memoria vacía) hablando con ese «Postgres». */
async function procesoNuevo(fetchFalso, marca) {
  const previo = { url: process.env.SALES_OS_URL, tok: process.env.SALES_OS_OPERATOR_TOKEN };
  process.env.SALES_OS_URL = 'http://sales-os.test';
  process.env.SALES_OS_OPERATOR_TOKEN = 'token-de-prueba';
  global.fetch = fetchFalso;
  try {
    // El módulo lee el entorno AL CARGARSE: se restaura enseguida para no filtrar la persistencia a otros tests.
    return await import(`../../services/estadoPersistente.js?redeploy=${marca}`);
  } finally {
    for (const [k, v] of [['SALES_OS_URL', previo.url], ['SALES_OS_OPERATOR_TOKEN', previo.tok]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}
const depsConEstado = (prov, est) => makeDeps(prov, {
  leerEstado: est.leer, escribirEstado: est.escribir, reservarEstado: est.reservar, liberarReserva: est.liberarReserva,
});

test('🔴 [#1094] tras un REDEPLOY (memoria vacía) con la marca durable de hoy vigente, NO se vuelve a avisar — y la marca durable no se pisa', async () => {
  const prov = { cerebro: 'openai', cerebro_respaldo: true, cerebro_motivo: MOTIVO_REAL };
  const clave = claveAvisoRespaldo(causaDelRespaldo(MOTIVO_REAL));
  const { disco, fetchFalso } = armarPostgresFalso();
  const fetchPrevio = global.fetch;
  try {
    // El aviso de hoy salió hace 1 h, desde el proceso ANTERIOR: lo único que queda de él es la marca en Postgres.
    const marcaDeHoy = { at: Date.now() - 3600 * 1000, causa: 'sin_saldo' };
    disco.set(clave, marcaDeHoy);
    const est = await procesoNuevo(fetchFalso, '1094-a');
    assert.equal(est.leerLocal(clave), null, 'control: la memoria del proceso nuevo arranca vacía');

    const { deps, spy } = depsConEstado(prov, est);
    await handleWebhook(makeReq('hola', '56933330005'), makeRes(), deps);
    await esperar();
    assert.equal(spy.enviados.filter((e) => /cerebro de respaldo/i.test(e.text)).length, 0,
      'el aviso de hoy ya salió: un redeploy en medio del episodio no puede mandarle OTRO al dueño');
    assert.deepEqual(disco.get(clave), marcaDeHoy, 'y la marca durable sigue siendo la del aviso (la reserva no la pisó con su token)');
  } finally { global.fetch = fetchPrevio; }
});

test('🔴 [#1094] el episodio completo a través de un redeploy: UN aviso antes del deploy, ninguno después', async () => {
  const prov = { cerebro: 'openai', cerebro_respaldo: true, cerebro_motivo: MOTIVO_REAL };
  const { disco, fetchFalso } = armarPostgresFalso();
  const fetchPrevio = global.fetch;
  const avisosDe = (spy) => spy.enviados.filter((e) => /cerebro de respaldo/i.test(e.text)).length;
  try {
    const antes = depsConEstado(prov, await procesoNuevo(fetchFalso, '1094-b1'));
    await handleWebhook(makeReq('uno', '56933330006'), makeRes(), antes.deps);
    await esperar();
    assert.equal(avisosDe(antes.spy), 1, 'control: el primer turno del episodio avisa');
    assert.ok(disco.get(claveAvisoRespaldo('sin_saldo'))?.at > 0, 'y deja la marca durable en Postgres');

    // «deployamos»: proceso nuevo, memoria vacía, el MISMO Postgres.
    const despues = depsConEstado(prov, await procesoNuevo(fetchFalso, '1094-b2'));
    await handleWebhook(makeReq('dos', '56933330007'), makeRes(), despues.deps);
    await handleWebhook(makeReq('tres', '56933330007'), makeRes(), despues.deps);
    await esperar();
    assert.equal(avisosDe(despues.spy), 0, 'el episodio de hoy ya se avisó: ni el primer turno del proceso nuevo ni los siguientes lo repiten');
  } finally { global.fetch = fetchPrevio; }
});

test('el aviso va al dueño, no a quien escribió', async () => {
  const previo = process.env.OWNER_PHONE;
  process.env.OWNER_PHONE = '56957296035';
  try {
    const { deps, spy } = makeDeps({ cerebro: 'openai', cerebro_respaldo: true, cerebro_motivo: MOTIVO_REAL });
    await handleWebhook(makeReq('hola', '56933330004'), makeRes(), deps);
    await esperar();
    const aviso = spy.enviados.find((e) => /cerebro de respaldo/i.test(e.text));
    assert.ok(aviso, 'el aviso tiene que salir');
    assert.equal(aviso.to, '56957296035');
    assert.notEqual(aviso.to, '56933330004', 'jamás al cliente');
  } finally {
    if (previo === undefined) delete process.env.OWNER_PHONE;
    else process.env.OWNER_PHONE = previo;
  }
});
