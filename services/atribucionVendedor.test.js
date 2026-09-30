// GUARDIAS DE UNA DECISIÓN DEL DUEÑO (30-sep-2026), no de una implementación:
//   «Cuando un vendedor de /equipo con oliver_interno cotiza por WhatsApp con Oliver, puede
//    ratificar el teléfono del cliente; si el cliente no existe como lead se crea, y la
//    cotización cuenta al CLIENTE (no al vendedor), con su folio ISO normal».
// Si alguno de estos tests se pone rojo, alguien está deshaciendo esa decisión. Darlo vuelta
// requiere una orden nueva del dueño, escrita acá.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  puedeUsarComandoCliente, identidadCotizacion, aislarSesionPorCliente, leadDeAtribucion,
  clickIdsDe, rolCotizador, debeMarcarSinConsentimiento, SESION_CONSERVA,
} from './atribucionCotizacion.js';
import { aplicarLista, modoInternoOliver, _reiniciarParaTests } from './internosEquipo.js';

const ADMIN = '56957296035';
const VENDEDOR = '56911110000';
const OTRO = '56922220000';

test('decisión dueño 30-sep: un NO interno no puede usar el comando CLIENTE', () => {
  _reiniciarParaTests();
  aplicarLista({ internos_ult9: ['911110000', '922220000'], vendedores: [
    { ult9: '911110000', oliver_interno: true },
    { ult9: '922220000', oliver_interno: false },   // del equipo, pero sin modo interno
  ] });
  const o = { adminPhone: ADMIN, esInterno: modoInternoOliver };
  assert.equal(puedeUsarComandoCliente(ADMIN, o), true, 'el dueño sigue pudiendo');
  assert.equal(puedeUsarComandoCliente(VENDEDOR, o), true, 'vendedor con oliver_interno puede');
  assert.equal(puedeUsarComandoCliente(OTRO, o), false, 'del equipo sin modo interno NO puede');
  assert.equal(puedeUsarComandoCliente('56933334444', o), false, 'un cliente cualquiera NO puede');
  assert.equal(puedeUsarComandoCliente('', o), false);
  _reiniciarParaTests();
});

test('decisión dueño 30-sep: index.js usa el candado compartido para el comando CLIENTE', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(dir, '..', 'index.js'), 'utf8');
  assert.match(src, /puedeUsarComandoCliente\(normalizeWaId\(_atInc\.waId\)/);
  // Y webhook.js decide dueño/vendedor con la MISMA regla (sin número propio).
  const wh = fs.readFileSync(path.join(dir, '..', 'src', 'oliver-gpt', 'webhook.js'), 'utf8');
  assert.match(wh, /rolCotizador\(from, \{ esInterno: modoInternoOliver \}\)/);
  assert.doesNotMatch(wh, /const esDuenio = normalizarTel/);
  assert.match(src, /esInterno: modoInternoOliver/);
});

test('decisión dueño 30-sep: con atribución la identidad es del CLIENTE y cotizado_por = últimos 9 del vendedor', () => {
  const id = identidadCotizacion(VENDEDOR, { phone: '56987654321', name: 'Juan' });
  assert.equal(id.telefonoCliente, '56987654321');
  assert.equal(id.claveCot, `${VENDEDOR}:56987654321`);
  assert.equal(id.cotizadoPor, '911110000');
  assert.deepEqual(id.extraLead, {
    external_id: '56987654321', cotizado_por: '911110000', no_pisar: true, source: 'vendedor_equipo',
  });
  const sin = identidadCotizacion(VENDEDOR, null);
  assert.deepEqual(sin, { telefonoCliente: VENDEDOR, claveCot: VENDEDOR, cotizadoPor: null, atribuida: false, extraLead: {} });
});

test('decisión dueño 30-sep: con atribución no viajan los click-ids de quien escribe', () => {
  const s = { fbclid: 'f', gclid: 'g', ttclid: 't', ctwa_clid: 'c', ad_id: 'a', landing_lead_id: 'l' };
  assert.deepEqual(clickIdsDe(s, null), { fbclid: 'f', gclid: 'g', ttclid: 't', ctwa_clid: 'c', ad_id: 'a', landing_ref: 'l' });
  assert.deepEqual(clickIdsDe(s, { phone: '56987654321' }),
    { fbclid: null, gclid: null, ttclid: null, ctwa_clid: null, ad_id: null, landing_ref: null });
});

test('decisión dueño 30-sep: UNA regla de rol (dueño / vendedor / nadie)', () => {
  const esInterno = (p) => p === VENDEDOR;
  assert.equal(rolCotizador(ADMIN, { adminPhone: ADMIN, esInterno }), 'duenio');
  assert.equal(rolCotizador(VENDEDOR, { adminPhone: ADMIN, esInterno }), 'vendedor');
  assert.equal(rolCotizador(OTRO, { adminPhone: ADMIN, esInterno }), null);
});

test('L1 Thermos 30-sep: solo NO se marca sin-consentimiento si sales-os confirma que el lead ya existía', () => {
  assert.equal(debeMarcarSinConsentimiento({ ok: true, json: { action: 'updated' } }), false);
  assert.equal(debeMarcarSinConsentimiento({ ok: true, json: { action: 'created' } }), true);
  assert.equal(debeMarcarSinConsentimiento({ ok: false, error: 'timeout' }), true);
  assert.equal(debeMarcarSinConsentimiento(undefined), true);
});

test('decisión dueño 30-sep: la lista de lo que sobrevive a un cambio de cliente está documentada', () => {
  // Agregar un campo acá es decidir que se ARRASTRA de un cliente al siguiente. last_quote,
  // lockedData, name, click-ids NO pueden estar.
  assert.deepEqual([...SESION_CONSERVA].sort(), ['fecha', 'lastMessageAt', 'lq_por_cliente', 'telefono']);
});

test('M1 Thermos 30-sep: consumir la atribución al emitir NO borra la sesión, pero aparta el folio del cliente', () => {
  const history = [{ role: 'user', content: 'medidas…' }];
  const lqJuan = { quote_number: 'CM-FR-004-2026-0600', at: Date.now() };
  const state = { telefono: ADMIN, atrib_cliente: '56987654321', name: 'Marcelo', lockedData: { comuna: 'Temuco' }, last_quote: lqJuan };
  assert.equal(aislarSesionPorCliente(state, history, null), false, 'no es un aislamiento');
  assert.equal(history.length, 1, 'el historial sigue');
  assert.equal(state.name, 'Marcelo');
  assert.deepEqual(state.lockedData, { comuna: 'Temuco' });
  assert.equal(state.last_quote, undefined, 'el folio de Juan no queda para lo que cotice a su nombre');
  // Re-fijar el MISMO cliente (para corregir) no borra nada y le devuelve SU folio.
  assert.equal(aislarSesionPorCliente(state, history, { phone: '56987654321' }), false);
  assert.equal(history.length, 1);
  assert.equal(state.last_quote, lqJuan);
  assert.equal(state.atrib_cliente, '56987654321');
});

test('decisión dueño 30-sep: al fijar cliente se crea su lead con su teléfono (no el del vendedor)', () => {
  const l = leadDeAtribucion(VENDEDOR, '+56 9 8765 4321', 'Juan Pérez');
  assert.equal(l.phone, '56987654321');
  assert.equal(l.external_id, '56987654321');
  assert.equal(l.name, 'Juan Pérez');
  assert.equal(l.cotizado_por, '911110000');
  assert.equal(l.no_pisar, true, 'si ya existía, sales-os no le pisa origen/nombre/score (H1)');
  assert.equal(l.source, 'vendedor_equipo');
  assert.ok(!JSON.stringify(l).includes(VENDEDOR), 'no expone el número completo del vendedor');
});

test('decisión dueño 30-sep: cambiar de cliente NO arrastra el folio (last_quote) del anterior', () => {
  const history = [{ role: 'user', content: 'cotiza para Juan' }];
  const state = {
    telefono: VENDEDOR, atrib_cliente: '56987654321', name: 'Juan',
    lockedData: { comuna: 'Temuco' },
    last_quote: { quote_number: 'CM-FR-004-2026-0500', at: Date.now(), sig: 'x' },
  };
  const reinicio = aislarSesionPorCliente(state, history, { phone: '56912345678', name: 'Pedro' });
  assert.equal(reinicio, true);
  assert.equal(state.last_quote, undefined, 'el folio de Juan jamás queda para Pedro');
  assert.equal(state.lockedData, undefined);
  assert.equal(state.name, undefined);
  assert.equal(history.length, 0);
  assert.equal(state.atrib_cliente, '56912345678');
  assert.equal(state.telefono, VENDEDOR);

  // Volver a Juan restaura SU folio (corrección = mismo documento), nunca el de otro.
  state.last_quote = { quote_number: 'CM-FR-004-2026-0501', at: Date.now() };
  aislarSesionPorCliente(state, [], { phone: '56987654321', name: 'Juan' });
  assert.equal(state.last_quote.quote_number, 'CM-FR-004-2026-0500');

  // Soltar la atribución tampoco deja el folio del cliente a nombre del vendedor.
  aislarSesionPorCliente(state, [], null);
  assert.equal(state.last_quote, undefined);
  assert.equal(state.atrib_cliente, undefined);
});

test('decisión dueño 30-sep: sin atribución y sin marca previa, la sesión no se toca', () => {
  const history = [{ role: 'user', content: 'hola' }];
  const lq = { quote_number: 'CM-FR-004-2026-0400', at: Date.now() };
  const state = { telefono: '56933334444', name: 'Ana', last_quote: lq };
  assert.equal(aislarSesionPorCliente(state, history, null), false);
  assert.equal(state.last_quote, lq);
  assert.equal(state.name, 'Ana');
  assert.equal(history.length, 1);
});
