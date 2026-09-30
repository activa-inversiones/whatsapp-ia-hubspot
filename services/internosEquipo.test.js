// services/internosEquipo.test.js — [#1059 b, 2026-09-30] "Oliver interno".
// QUÉ DEFIENDE (la decisión del dueño): un número que él carga en /equipo no recibe
// seguimientos ni re-enganches, y si lo autorizó Oliver le responde en modo interno.
// Darlo de baja (la lista de sales-os deja de traerlo) lo vuelve cliente normal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  aplicarLista, esNumeroDelEquipo, modoInternoOliver, refrescarInternos, _reiniciarParaTests, TEXTO_MODO_INTERNO,
} from './internosEquipo.js';
import { shouldSkipFollowup } from './oliverFollowup.js';
import { reengage } from './reengagement.js';
import { buildSessionContext } from '../src/oliver-gpt/system-prompt.js';

const LISTA = {
  internos_ult9: ['957296035', '984412961', '911112222', '933334444'],
  vendedores: [{ ult9: '911112222', oliver_interno: true }, { ult9: '933334444', oliver_interno: false }],
};

test('un número de la lista NO dispara seguimiento; dado de baja, vuelve a ser cliente normal', () => {
  _reiniciarParaTests();
  const previo = { M: process.env.MARCELO_PHONE, E: process.env.ESCALATION_PHONE, O: process.env.OWNER_NOTIFICATION_PHONE, I: process.env.INTERNAL_PHONES };
  delete process.env.MARCELO_PHONE; delete process.env.ESCALATION_PHONE; delete process.env.OWNER_NOTIFICATION_PHONE; delete process.env.INTERNAL_PHONES;
  try {
    assert.equal(shouldSkipFollowup('56911112222'), false, 'sin lista cargada: comportamiento de siempre');
    aplicarLista(LISTA);
    assert.equal(shouldSkipFollowup('+56 9 1111 2222'), true, 'vendedor: sin follow-up');
    assert.equal(shouldSkipFollowup('56933334444'), true, 'también el que no tiene modo interno');
    assert.equal(shouldSkipFollowup('56955556666'), false, 'un cliente sigue recibiendo su follow-up');
    aplicarLista({ ...LISTA, internos_ult9: ['957296035', '984412961'], vendedores: [] }); // baja
    assert.equal(shouldSkipFollowup('56911112222'), false, 'de baja: cliente normal');
  } finally {
    for (const [k, v] of Object.entries({ MARCELO_PHONE: previo.M, ESCALATION_PHONE: previo.E, OWNER_NOTIFICATION_PHONE: previo.O, INTERNAL_PHONES: previo.I })) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('un número de la lista no se re-engancha (ni con el flag prendido)', async () => {
  _reiniciarParaTests();
  aplicarLista(LISTA);
  const r = await reengage({ phone: '56911112222', motivo: 'x' }, { flagOn: true });
  assert.deepEqual(r, { ok: false, reason: 'numero_del_equipo' });
});

test('modo interno SOLO si es del equipo Y el dueño lo autorizó', () => {
  _reiniciarParaTests();
  aplicarLista(LISTA);
  assert.equal(modoInternoOliver('56911112222'), true);
  assert.equal(modoInternoOliver('56933334444'), false, 'del equipo pero sin autorización');
  assert.equal(modoInternoOliver('56955556666'), false, 'cliente');
  assert.equal(esNumeroDelEquipo('56933334444'), true);
});

test('si sales-os no contesta se queda la ÚLTIMA lista buena (nunca se vacía por un error)', async () => {
  _reiniciarParaTests();
  const ok = await refrescarInternos({ url: 'http://so', token: 't', fetchFn: async (u, o) => {
    assert.equal(u, 'http://so/internal/equipo/internos');
    assert.equal(o.headers['x-api-key'], 't');
    return { ok: true, json: async () => ({ ok: true, data: LISTA }) };
  } });
  assert.equal(ok, true);
  assert.equal(esNumeroDelEquipo('56911112222'), true);
  assert.equal(await refrescarInternos({ url: 'http://so', token: 't', fetchFn: async () => { throw new Error('red'); } }), false);
  assert.equal(esNumeroDelEquipo('56911112222'), true, 'sigue la lista anterior');
  assert.equal(await refrescarInternos({ url: 'http://so', token: 't', fetchFn: async () => ({ ok: false, status: 500 }) }), false);
  assert.equal(esNumeroDelEquipo('56911112222'), true);
  assert.equal(await refrescarInternos({ url: '', token: 't' }), false, 'sin URL no llama');
});

test('el prompt lleva el bloque de modo interno solo cuando el turno lo marca', () => {
  assert.ok(buildSessionContext({ modo_interno: true }).includes('MODO INTERNO'));
  assert.ok(!buildSessionContext({}).includes('MODO INTERNO'));
  assert.match(TEXTO_MODO_INTERNO, /NO ofrezcas seguimiento/);
});

test('🔴 el webhook decide el modo por el NÚMERO en cada turno y no lo persiste', () => {
  const src = readFileSync(new URL('../src/oliver-gpt/webhook.js', import.meta.url), 'utf8');
  assert.match(src, /state\.modo_interno = modoInternoOliver\(from\);/);
  assert.match(src, /delete newState\.modo_interno;/);
  const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(idx, /iniciarRefrescoInternos\(/, 'el bot tiene que leer la lista al arrancar');
});
