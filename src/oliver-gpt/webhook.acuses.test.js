// webhook.acuses.test.js — [2026-08-24]
//
// QUE HACE EL BOT CON LOS ACUSES DE META. El parser ya los lee (whatsapp-acuses.test.js);
// aca se prueba que sirvan para algo:
//
//   · un `failed` de un DOCUMENTO tiene que verse en la conversacion y avisarle a Marcelo,
//     porque significa que el cliente NO tiene su propuesta o su informe;
//   · si el que fallo era el informe termico, hay que SOLTAR el candado de 30 dias: si no,
//     el cliente queda sin informe un mes por un envio que nunca llego;
//   · un acuse nunca puede disparar un turno del bot ni contestarle nada al cliente.
//
// Nacio de un caso medido: un informe figuraba "entregado" en la base, con hora, y en el
// WhatsApp del cliente no habia nada.

import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook } from './webhook.js';

function makeRes() {
  return { sentStatus: undefined, sendStatus(c) { this.sentStatus = c; return this; } };
}

const acuse = (status, msgId = 'wamid.DOC1', extra = {}) => ({
  entry: [{ changes: [{ value: { statuses: [{
    id: msgId, status, recipient_id: '56940415964', ...extra,
  }] } }] }],
});

function makeDeps({ enviado = null, overrides = {} } = {}) {
  const spy = { convEvents: [], avisos: [], turnos: 0, borrados: [] };
  const estado = new Map();
  if (enviado) estado.set(`wamsg:${enviado.msgId}`, { valor: enviado, expira: null });
  estado.set('informe_termico:56940415964', { valor: true, expira: null });

  const deps = {
    conv: new Map(), seen: new Set(), locks: new Map(),
    leerEstado: async (k) => (estado.has(k) ? estado.get(k).valor : null),
    escribirEstado: (k, v) => estado.set(k, { valor: v, expira: null }),
    borrarEstado: (k) => { spy.borrados.push(k); estado.delete(k); },
    handleTurn: async () => { spy.turnos += 1; return { reply: 'x', history: [], toolCalls: [], state: {} }; },
    sendWhatsAppText: async () => ({ ok: true, msgId: 'm1' }),
    notifyHighValue: async (...a) => { spy.avisos.push(a); return { sent: true }; },
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async (p) => { spy.convEvents.push(p); return { ok: true }; },
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async () => ({ ok: true }),
    },
    _estado: estado,
  };
  Object.assign(deps, overrides);
  return { deps, spy };
}

test('🔒 un acuse NO despierta al bot ni le contesta al cliente', async () => {
  const { deps, spy } = makeDeps();
  const res = makeRes();
  await handleWebhook({ body: acuse('delivered') }, res, deps);
  assert.equal(res.sentStatus, 200, 'igual se ackea a Meta');
  assert.equal(spy.turnos, 0, 'un acuse no es un mensaje del cliente');
});

test('🔴 un documento que FALLA se ve en la conversacion', async () => {
  // Sin esto, el operador ve "propuesta enviada" y el cliente no tiene nada: la version
  // del sistema y la realidad se separan y nadie se entera.
  const { deps, spy } = makeDeps({
    enviado: { msgId: 'wamid.DOC1', tipo: 'informe_termico', folio: 'CM-FR-006-2026-0005', telefono: '56940415964' },
  });
  await handleWebhook({ body: acuse('failed', 'wamid.DOC1', {
    errors: [{ code: 131047, title: 'Re-engagement message' }],
  }) }, makeRes(), deps);
  await new Promise((r) => setTimeout(r, 120));

  const ev = spy.convEvents.find((e) => e.metadata?.source === 'oliver_gpt_acuse');
  assert.ok(ev, 'tiene que quedar el rastro del fallo');
  assert.match(ev.body, /NO se entreg/i, 'y decir claramente que no llego');
  assert.match(ev.body, /CM-FR-006-2026-0005/, 'con el folio, para poder ubicarlo');
  assert.equal(ev.metadata.codigo, 131047, 'y el motivo de Meta, que es lo que permite corregir');
});

test('🔴 si fallo el INFORME, se suelta el candado de 30 dias', async () => {
  // Si no, el cliente queda un mes sin informe por un envio que nunca llego — el mismo
  // bug que ya dejo a 4 clientes bloqueados.
  const { deps, spy } = makeDeps({
    enviado: { msgId: 'wamid.DOC1', tipo: 'informe_termico', folio: 'CM-FR-006-2026-0005', telefono: '56940415964' },
  });
  await handleWebhook({ body: acuse('failed', 'wamid.DOC1') }, makeRes(), deps);
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(spy.borrados.includes('informe_termico:56940415964'),
    'el candado tiene que soltarse para que el proximo intento pueda reenviar');
});

test('🔴 un documento que falla se le AVISA a Marcelo', async () => {
  const { deps, spy } = makeDeps({
    enviado: { msgId: 'wamid.DOC1', tipo: 'propuesta', folio: 'CM-FR-004-2026-0336', telefono: '56940415964' },
  });
  await handleWebhook({ body: acuse('failed', 'wamid.DOC1') }, makeRes(), deps);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(spy.avisos.length, 1, 'una propuesta que no llego es plata parada');
  assert.match(JSON.stringify(spy.avisos[0]), /CM-FR-004-2026-0336/);
});

test('un acuse BUENO no genera ruido: ni aviso ni evento de fallo', async () => {
  const { deps, spy } = makeDeps({
    enviado: { msgId: 'wamid.DOC1', tipo: 'informe_termico', folio: 'F1', telefono: '56940415964' },
  });
  for (const s of ['sent', 'delivered', 'read']) {
    await handleWebhook({ body: acuse(s, 'wamid.DOC1') }, makeRes(), deps);
  }
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(spy.avisos.length, 0, 'no se molesta al dueño con lo que si funciona');
  assert.equal(spy.convEvents.filter((e) => /NO se entreg/i.test(e.body || '')).length, 0);
  assert.deepEqual(spy.borrados, [], 'y NO se suelta el candado de algo que si llego');
});

test('un fallo de un mensaje que no rastreamos no rompe nada', async () => {
  // Los textos comunes no se registran uno por uno: solo los DOCUMENTOS, que son los que
  // importan. Un acuse de algo que no seguimos se ignora en silencio.
  const { deps, spy } = makeDeps();
  const res = makeRes();
  await handleWebhook({ body: acuse('failed', 'wamid.DESCONOCIDO') }, res, deps);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(res.sentStatus, 200);
  assert.equal(spy.avisos.length, 0);
});

test('🔴 [Codex final] un acuse REPETIDO no duplica avisos ni borra dos veces', async () => {
  // Meta reintrega los webhooks: el mismo `failed` puede llegar varias veces. Sin consumir
  // el rastro, cada copia generaba su evento, su aviso a Marcelo y su borrado de candado.
  const { deps, spy } = makeDeps({
    enviado: { msgId: 'wamid.DOC1', tipo: 'informe_termico', folio: 'F9', telefono: '56940415964' },
  });
  for (let i = 0; i < 3; i++) {
    await handleWebhook({ body: acuse('failed', 'wamid.DOC1') }, makeRes(), deps);
    await new Promise((r) => setTimeout(r, 60));
  }
  assert.equal(spy.avisos.length, 1, 'un solo aviso, aunque Meta reintregue');
  assert.equal(spy.convEvents.filter((e) => e.metadata?.source === 'oliver_gpt_acuse').length, 1);
});

test('🔴 [Codex final] un `failed` TARDIO no puede borrar el candado de un envio NUEVO', async () => {
  // Secuencia real: falla el envio A, se reintenta y el B SI llega (candado puesto), y
  // recien ahi aparece el acuse tardio de A. Si ese acuse borra el candado, el cliente
  // recibe un segundo informe por un fallo viejo.
  const { deps, spy } = makeDeps({
    enviado: { msgId: 'wamid.VIEJO', tipo: 'informe_termico', folio: 'F-A', telefono: '56940415964' },
  });
  // el envio B ya entrego y dejo su propio rastro + candado
  deps._estado.set('wamsg:wamid.NUEVO', { valor: { msgId: 'wamid.NUEVO', tipo: 'informe_termico', folio: 'F-B', telefono: '56940415964' }, expira: null });
  deps._estado.set('informe_termico:56940415964:ultimo_msg', { valor: 'wamid.NUEVO', expira: null });

  await handleWebhook({ body: acuse('failed', 'wamid.VIEJO') }, makeRes(), deps);
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(!spy.borrados.includes('informe_termico:56940415964'),
    'el acuse de un envio que ya fue reemplazado no toca el candado del vigente');
});

test('🔴 [Codex final] al fallar se suelta TAMBIEN el candado corto', async () => {
  // Si solo se suelta el de 30 dias, el reintento cae dentro de los 5 min del candado
  // corto, se descarta, y no queda programado para despues: el cliente igual se queda sin
  // informe.
  const { deps, spy } = makeDeps({
    enviado: { msgId: 'wamid.DOC1', tipo: 'informe_termico', folio: 'F1', telefono: '56940415964' },
  });
  await handleWebhook({ body: acuse('failed', 'wamid.DOC1') }, makeRes(), deps);
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(spy.borrados.includes('informe_termico:56940415964'), 'el de 30 dias');
  assert.ok(spy.borrados.includes('informe_termico:56940415964:en_curso'), 'y el corto');
});

test('🔴 [Codex final] un acuse de OTRO destinatario no toca los candados de este', async () => {
  // Se buscaba por msgId y despues se confiaba en el telefono guardado, sin compararlo con
  // el `recipient_id` del acuse. Un acuse cruzado actuaba sobre los candados y la
  // conversacion de un cliente que no era. Meta manda a quien fue: hay que mirarlo.
  const { deps, spy } = makeDeps({
    enviado: { msgId: 'wamid.DOC1', tipo: 'informe_termico', folio: 'F1', telefono: '56940415964' },
  });
  await handleWebhook({ body: acuse('failed', 'wamid.DOC1', { recipient_id: '56999999999' }) },
    makeRes(), deps);
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(spy.borrados.filter((k) => k.startsWith('informe_termico:')), [],
    'no se tocan los candados de un cliente por un acuse que era de otro');
  assert.equal(spy.avisos.length, 0);
});

test('🔴 [Codex final] un `failed` YA REEMPLAZADO no ordena reenviar', async () => {
  // `esElVigente=false` solo evitaba borrar candados: el evento y el aviso salian igual, y
  // decian "reenviarlo". Marcelo reenviaba un documento que el cliente YA tenia.
  const { deps, spy } = makeDeps({
    enviado: { msgId: 'wamid.VIEJO', tipo: 'informe_termico', folio: 'F-A', telefono: '56940415964' },
  });
  deps._estado.set('informe_termico:56940415964:ultimo_msg', { valor: 'wamid.NUEVO', expira: null });
  await handleWebhook({ body: acuse('failed', 'wamid.VIEJO') }, makeRes(), deps);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(spy.avisos.length, 0, 'el envio siguiente ya llego: no hay nada que reenviar');
  assert.equal(spy.convEvents.filter((e) => e.metadata?.source === 'oliver_gpt_acuse').length, 0);
});
