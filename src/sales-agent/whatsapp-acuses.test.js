// whatsapp-acuses.test.js — [2026-08-24]
//
// LOS ACUSES DE META. Cuando mandamos un mensaje, WhatsApp responde 200 al toque: eso
// significa "recibi tu pedido", NO "el cliente lo tiene". El resultado real llega DESPUES,
// por el mismo webhook, en `statuses[]`: sent → delivered → read, o `failed` con el motivo.
//
// Los estabamos descartando sin leerlos (`if (val?.statuses?.length) return { ok: false }`),
// asi que el sistema no tenia forma de distinguir un documento entregado de uno rechazado.
//
// 🔴 POR QUE IMPORTA, medido el 24-ago: el informe termico de un cliente figuraba como
// "entregado" en la base —con hora y todo— y en su WhatsApp no habia nada. El dueño lo
// dijo mejor que nadie: *"que tu hayas enviado tal vez un ok, no quiere decir que este ok"*.
// Y no afecta solo al informe: LAS PROPUESTAS usan el mismo criterio, asi que puede haber
// cotizaciones marcadas como enviadas que nunca llegaron.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInbound, parseStatuses } from './whatsapp-adapter.js';

const envolver = (value) => ({ entry: [{ changes: [{ value }] }] });

const acuse = (status, extra = {}) => envolver({
  statuses: [{
    id: 'wamid.HBgLNTY5OTQwNDE1OTY0',
    status,
    timestamp: '1756060916',
    recipient_id: '56940415964',
    ...extra,
  }],
});

test('parseStatuses lee los acuses que antes se tiraban a la basura', () => {
  const r = parseStatuses(acuse('delivered'));
  assert.equal(r.length, 1);
  assert.equal(r[0].msgId, 'wamid.HBgLNTY5OTQwNDE1OTY0');
  assert.equal(r[0].estado, 'delivered');
  assert.equal(r[0].telefono, '56940415964');
  assert.equal(r[0].fallo, false);
});

test('🔴 un `failed` se reconoce como fallo, con su motivo', () => {
  // El motivo es lo que permite distinguir "el numero no tiene WhatsApp" de "el archivo
  // era muy grande". Sin el, un fallo es un misterio y no se puede corregir.
  const r = parseStatuses(acuse('failed', {
    errors: [{ code: 131047, title: 'Re-engagement message', message: 'Fuera de la ventana de 24h' }],
  }));
  assert.equal(r[0].fallo, true);
  assert.equal(r[0].codigo, 131047);
  assert.match(r[0].motivo, /Re-engagement|24h/);
});

test('sent y read NO son fallos', () => {
  for (const s of ['sent', 'delivered', 'read']) {
    assert.equal(parseStatuses(acuse(s))[0].fallo, false, `${s} no es un fallo`);
  }
});

test('varios acuses en un mismo webhook se leen todos', () => {
  const body = envolver({
    statuses: [
      { id: 'wamid.A', status: 'delivered', recipient_id: '56911111111' },
      { id: 'wamid.B', status: 'failed', recipient_id: '56922222222', errors: [{ code: 470 }] },
    ],
  });
  const r = parseStatuses(body);
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((x) => x.fallo), [false, true]);
});

test('un webhook sin acuses devuelve lista vacia, no lanza', () => {
  for (const body of [undefined, null, {}, envolver({}), envolver({ messages: [{ id: 'x' }] })]) {
    assert.deepEqual(parseStatuses(body), [], `con ${JSON.stringify(body)}`);
  }
});

test('un acuse con forma rara no rompe ni inventa datos', () => {
  const r = parseStatuses(envolver({ statuses: [{ status: 'delivered' }] }));
  assert.equal(r.length, 0, 'sin id no se puede saber DE QUE mensaje habla');
});

test('🔒 parseInbound sigue sin confundir un acuse con un mensaje del cliente', () => {
  // La guarda original se queda: un acuse no es un mensaje y no puede disparar un turno
  // del bot. Lo que cambia es que ahora ADEMAS se lee, en vez de solo descartarse.
  assert.equal(parseInbound(acuse('delivered')).ok, false);
  assert.equal(parseInbound(acuse('failed')).ok, false);
});
