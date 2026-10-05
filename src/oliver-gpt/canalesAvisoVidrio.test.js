// canalesAvisoVidrio.test.js — [2026-10-05 · r8] EL CABLEADO de los tres canales del aviso por satén perdido.
//
// webhook.js (WhatsApp) y channel-agent.js (IG/FB) armaban cada uno su copia de los tres closures
// (texto/plantilla/panel) a 2.700 líneas de donde se resolvía la dependencia inyectable. Ahora hay UNA fábrica,
// y los dos canales solo dicen quién es el cliente y por dónde escribe. Acá se fija qué sale por cada canal;
// la lógica de cuándo usar cuál vive en services/avisarVidrio.test.js.
//
// Hermético: `safe`, `bridge`, `notifyFn` y `plantillaFn` falsos.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearCanalesAvisoVidrio, almacenDeAvisos } from './canalesAvisoVidrio.js';
import * as estadoReal from '../../services/estadoPersistente.js';

/** El `safe` real de webhook.js / channel-agent.js: devuelve null si la función lanza, y deja el rótulo. */
function safeFalso() {
  const rotulos = [];
  const safe = async (rotulo, fn) => { rotulos.push(rotulo); try { return await fn(); } catch { return null; } };
  return { safe, rotulos };
}

function armar(extra = {}) {
  const { safe, rotulos } = safeFalso();
  const visto = { notify: [], plantilla: [], eventos: [] };
  const args = {
    safe,
    bridge: { pushConversationEvent: async (p) => { visto.eventos.push(p); return { ok: true }; } },
    channel: 'whatsapp',
    externalId: '56911112222',
    source: 'oliver_gpt_webhook',
    notifyFn: async (...a) => { visto.notify.push(a); return { sent: true }; },
    waSend: async () => ({ ok: true }),
    cliente: '56911112222',
    sesion: { data: { name: 'Dady' }, history: [] },
    plantillaFn: async (folio, etiquetas) => { visto.plantilla.push({ folio, etiquetas }); return { ok: true }; },
    ...extra,
  };
  return { canales: crearCanalesAvisoVidrio(args), visto, rotulos, args };
}

test('devuelve SIEMPRE los tres canales (texto, plantilla, panel): avisarVidrio no tiene un «modo sin canal»', () => {
  const { canales } = armar();
  assert.deepEqual(Object.keys(canales).sort(), ['panel', 'plantilla', 'texto']);
  for (const f of Object.values(canales)) assert.equal(typeof f, 'function');
});

test('texto: notifyFn(waSend, cliente, sesion, "[canal] texto") — el cliente del turno, el prefijo del canal; devuelve lo que devuelve el notificador', async () => {
  const { canales, visto, args, rotulos } = armar({ channel: 'instagram', cliente: 'IG_9' });
  const r = await canales.texto('La propuesta X dice "satén"…');
  assert.deepEqual(r, { sent: true });
  assert.equal(visto.notify.length, 1);
  const [waSend, cliente, sesion, motivo] = visto.notify[0];
  assert.equal(waSend, args.waSend);
  assert.equal(cliente, 'IG_9', 'el aviso (y su cooldown) es del CLIENTE');
  assert.equal(sesion, args.sesion);
  assert.equal(motivo, '[instagram] La propuesta X dice "satén"…', 'el prefijo de canal manda el aviso al inbox correcto');
  assert.deepEqual(rotulos, ['generarPdf.vidrio.aviso']);
});

test('plantilla: avisarVidrio pasa {folio, etiquetas} y el cierre del llamador YA NO captura el folio', async () => {
  const { canales, visto, rotulos } = armar();
  const r = await canales.plantilla({ folio: 'CM-FR-004-2026-0701', etiquetas: ['4+12+4 satén (baño)'] });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(visto.plantilla, [{ folio: 'CM-FR-004-2026-0701', etiquetas: ['4+12+4 satén (baño)'] }]);
  assert.deepEqual(rotulos, ['generarPdf.vidrio.plantilla']);
});

test('plantilla: sin `plantillaFn` usa el sendAvisoVidrioTemplate REAL (sin ADMIN_PIN no sale nada y lo dice)', async () => {
  const previo = { a: process.env.ADMIN_PIN, o: process.env.OLIVER_ADMIN_PIN };
  delete process.env.ADMIN_PIN; delete process.env.OLIVER_ADMIN_PIN;
  try {
    const { canales } = armar({ plantillaFn: undefined });
    assert.deepEqual(await canales.plantilla({ folio: 'F', etiquetas: ['satén'] }), { ok: false, error: 'ADMIN_PIN_missing' });
  } finally {
    if (previo.a !== undefined) process.env.ADMIN_PIN = previo.a;
    if (previo.o !== undefined) process.env.OLIVER_ADMIN_PIN = previo.o;
  }
});

test('panel: un evento de SISTEMA saliente en la conversación del cliente, con la marca de quién lo escribió', async () => {
  const { canales, visto, rotulos } = armar({ channel: 'whatsapp', externalId: '56911112222', source: 'oliver_gpt_webhook' });
  const r = await canales.panel({ body: '⚠️ …', metadata: { aviso_fallido: true, folio: 'CM-FR-004-2026-0701' } });
  assert.deepEqual(r, { ok: true }, 'devuelve lo que devuelve el puente: avisarVidrio solo marca si ok === true');
  assert.deepEqual(visto.eventos, [{
    channel: 'whatsapp', external_id: '56911112222', direction: 'outbound', actor_type: 'system',
    actor_name: 'Sistema', message_type: 'text', body: '⚠️ …',
    metadata: { source: 'oliver_gpt_webhook', aviso_fallido: true, folio: 'CM-FR-004-2026-0701' },
  }]);
  assert.deepEqual(rotulos, ['generarPdf.vidrio.panel']);
  // IG/FB: el canal y el id del remitente son los del cliente.
  const ig = armar({ channel: 'instagram', externalId: 'IG_9', source: 'oliver_gpt_channel' });
  await ig.canales.panel({ body: 'b', metadata: { folio: 'F' } });
  assert.equal(ig.visto.eventos[0].channel, 'instagram');
  assert.equal(ig.visto.eventos[0].external_id, 'IG_9');
  assert.equal(ig.visto.eventos[0].metadata.source, 'oliver_gpt_channel');
});

test('un canal cuya dependencia LANZA devuelve null (el `safe` del llamador) y no revienta: avisarVidrio lo lee como «lanzó»', async () => {
  const lanza = async () => { throw new Error('boom'); };
  const { canales } = armar({ notifyFn: lanza, plantillaFn: lanza, bridge: { pushConversationEvent: lanza } });
  assert.equal(await canales.texto('t'), null);
  assert.equal(await canales.plantilla({ folio: 'F', etiquetas: ['e'] }), null);
  assert.equal(await canales.panel({ body: 'b', metadata: {} }), null);
});

test('almacenDeAvisos: lo inyectado por `deps` gana; sin deps, el almacén REAL de estadoPersistente (el mismo que usa webhook.js)', () => {
  const real = almacenDeAvisos();
  assert.equal(real.reservar, estadoReal.reservar);
  assert.equal(real.liberar, estadoReal.liberarReserva);
  assert.equal(real.leer, estadoReal.leer);
  assert.equal(real.escribir, estadoReal.escribir);

  const falsos = { reservarEstado: () => 't', liberarReserva: () => true, leerEstado: async () => null, escribirEstado: () => 1 };
  const e = almacenDeAvisos(falsos);
  assert.equal(e.reservar, falsos.reservarEstado);
  assert.equal(e.liberar, falsos.liberarReserva);
  assert.equal(e.leer, falsos.leerEstado);
  assert.equal(e.escribir, falsos.escribirEstado);
  // Parcial: lo que falta cae al real (los tests de webhook inyectan solo parte).
  assert.equal(almacenDeAvisos({ leerEstado: falsos.leerEstado }).escribir, estadoReal.escribir);
});
