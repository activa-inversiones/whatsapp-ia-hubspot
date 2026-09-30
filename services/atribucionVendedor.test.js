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
  puedeUsarComandoCliente, identidadCotizacion, leadDeAtribucion, clickIdsDe, rolCotizador,
  cambiarCarpeta, claveCarpeta, CLAVES_INFRA_SESION, CARPETA_PROPIA,
  fijar, obtener, limpiarSiMisma, yaNosEscribio, _reset,
} from './atribucionCotizacion.js';
import { aplicarLista, puedeComandoCliente, _reiniciarParaTests } from './internosEquipo.js';

const ADMIN = '56957296035';
const VENDEDOR = '56911110000';
const OTRO = '56922220000';
const JUAN = '56987654321';
const PEDRO = '56912345678';

test('decisión dueño 30-sep: solo el dueño o un vendedor con oliver_interno (número COMPLETO) usan CLIENTE', () => {
  _reiniciarParaTests();
  const o = { adminPhone: ADMIN, esInterno: puedeComandoCliente };
  assert.equal(puedeUsarComandoCliente(VENDEDOR, o), false, 'lista nunca cargada ⇒ fail-closed');
  assert.equal(puedeUsarComandoCliente(ADMIN, o), true, 'el dueño sigue pudiendo');
  aplicarLista({ internos_ult9: ['911110000', '922220000'], vendedores: [
    { ult9: '911110000', telefono: VENDEDOR, oliver_interno: true },
    { ult9: '922220000', telefono: OTRO, oliver_interno: false },   // del equipo, sin modo interno
  ] });
  assert.equal(puedeUsarComandoCliente(VENDEDOR, o), true, 'vendedor con oliver_interno puede');
  assert.equal(puedeUsarComandoCliente('+56 9 1111 0000', o), true, 'mismo número, otro formato');
  assert.equal(puedeUsarComandoCliente(OTRO, o), false, 'del equipo sin modo interno NO puede');
  assert.equal(puedeUsarComandoCliente('34911110000', o), false, 'misma cola de 9, otro país: NO (Codex)');
  assert.equal(puedeUsarComandoCliente('56933334444', o), false, 'un cliente cualquiera NO puede');
  _reiniciarParaTests();
});

test('decisión dueño 30-sep: si sales-os no manda el teléfono completo, ningún vendedor usa CLIENTE', () => {
  _reiniciarParaTests();
  aplicarLista({ internos_ult9: ['911110000'], vendedores: [{ ult9: '911110000', oliver_interno: true }] });
  assert.equal(puedeComandoCliente(VENDEDOR), false);
  _reiniciarParaTests();
});

test('decisión dueño 30-sep: index.js y webhook.js usan la MISMA regla de autorización', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(dir, '..', 'index.js'), 'utf8');
  assert.match(src, /puedeUsarComandoCliente\(normalizeWaId\(_atInc\.waId\), \{ esInterno: puedeComandoCliente \}\)/);
  const wh = fs.readFileSync(path.join(dir, '..', 'src', 'oliver-gpt', 'webhook.js'), 'utf8');
  assert.match(wh, /rolCotizador\(from, \{ esInterno: puedeComandoCliente \}\)/);
});

test('decisión dueño 30-sep: con atribución la identidad es del CLIENTE y cotizado_por = últimos 9 de quien cotizó', () => {
  const id = identidadCotizacion(VENDEDOR, { phone: JUAN, name: 'Juan' });
  assert.equal(id.telefonoCliente, JUAN);
  assert.equal(id.claveCot, `${VENDEDOR}:${JUAN}`);
  assert.equal(id.cotizadoPor, '911110000');
  assert.deepEqual(id.extraLead, { external_id: JUAN, cotizado_por: '911110000', no_pisar: true, source: 'vendedor_equipo' });
  const sin = identidadCotizacion(VENDEDOR, null);
  assert.deepEqual(sin, { telefonoCliente: VENDEDOR, claveCot: VENDEDOR, cotizadoPor: null, atribuida: false, extraLead: {} });
});

test('decisión dueño 30-sep: con atribución no viajan los click-ids de quien escribe', () => {
  const s = { fbclid: 'f', gclid: 'g', ttclid: 't', ctwa_clid: 'c', ad_id: 'a', landing_lead_id: 'l' };
  assert.deepEqual(clickIdsDe(s, null), { fbclid: 'f', gclid: 'g', ttclid: 't', ctwa_clid: 'c', ad_id: 'a', landing_ref: 'l' });
  assert.deepEqual(clickIdsDe(s, { phone: JUAN }),
    { fbclid: null, gclid: null, ttclid: null, ctwa_clid: null, ad_id: null, landing_ref: null });
});

test('decisión dueño 30-sep: UNA regla de rol (dueño / vendedor / nadie)', () => {
  const esInterno = (p) => p === VENDEDOR;
  assert.equal(rolCotizador(ADMIN, { adminPhone: ADMIN, esInterno }), 'duenio');
  assert.equal(rolCotizador(VENDEDOR, { adminPhone: ADMIN, esInterno }), 'vendedor');
  assert.equal(rolCotizador(OTRO, { adminPhone: ADMIN, esInterno }), null);
});

test('decisión dueño 30-sep: al fijar cliente se crea su lead con su teléfono, sin pisar uno existente', () => {
  const l = leadDeAtribucion(VENDEDOR, '+56 9 8765 4321', 'Juan Pérez');
  assert.equal(l.phone, JUAN);
  assert.equal(l.external_id, JUAN);
  assert.equal(l.name, 'Juan Pérez');
  assert.equal(l.cotizado_por, '911110000');
  assert.equal(l.no_pisar, true);
  assert.equal(l.source, 'vendedor_equipo');
  assert.ok(!JSON.stringify(l).includes(VENDEDOR), 'no expone el número completo del vendedor');
});

test('E 30-sep: consumir la atribución solo borra la MISMA versión (carrera CLIENTE Juan → CLIENTE Pedro)', () => {
  _reset();
  const juan = fijar(VENDEDOR, JUAN, 'Juan');
  const pedro = fijar(VENDEDOR, PEDRO, 'Pedro');           // entra mientras se emitía lo de Juan
  assert.equal(limpiarSiMisma(VENDEDOR, juan.gen), false, 'el turno de Juan no borra a Pedro');
  assert.equal(obtener(VENDEDOR).phone, PEDRO);
  assert.equal(limpiarSiMisma(VENDEDOR, pedro.gen), true);
  assert.equal(obtener(VENDEDOR), null);
  _reset();
});

test('F1 30-sep: "ya nos escribió" solo si ese número escribió al bot (ser lead no cuenta)', async () => {
  _reset();
  assert.equal(await yaNosEscribio(JUAN, async () => null), false);
  assert.equal(await yaNosEscribio(JUAN, async () => { throw new Error('red'); }), false, 'ante error: se marca');
  assert.equal(await yaNosEscribio(JUAN, async (k) => (k === `escribio:${JUAN}` ? true : null)), true);
});

// ── Carpeta por cliente ───────────────────────────────────────────────────────────────────
function kvFalso() {
  const m = new Map();
  return { m, leer: async (k) => (m.has(k) ? structuredClone(m.get(k)) : null), escribir: async (k, v) => { m.set(k, structuredClone(v)); } };
}

test('decisión dueño 30-sep: la lista de claves que se comparten entre clientes está documentada', () => {
  // Agregar algo acá es decidir que pasa de un cliente al siguiente. last_quote, lockedData,
  // name, pending_quote e historial NO pueden estar.
  assert.deepEqual([...CLAVES_INFRA_SESION].sort(), [
    'ad_id', 'carpeta_activa', 'ctwaCaptured', 'ctwa_clid', 'fbclid', 'fecha', 'gclid',
    'landingRefCaptured', 'landing_lead_id', 'lastMessageAt', 'ref_status', 'telefono', 'ttclid',
  ]);
});

test('decisión dueño 30-sep: cambiar de cliente NO filtra nada y volver a Juan recupera SU trabajo', async () => {
  const kv = kvFalso();
  const history = [{ role: 'user', content: 'Juan: 3 ventanas' }];
  const state = { telefono: VENDEDOR, carpeta_activa: JUAN, name: 'Juan', lockedData: { comuna: 'Temuco' },
    last_quote: { quote_number: 'CM-FR-004-2026-0500' }, gclid: 'g-vendedor' };

  assert.equal(await cambiarCarpeta({ from: VENDEDOR, state, history, atribucion: { phone: PEDRO }, ...kv }), 'cambio');
  assert.equal(state.last_quote, undefined, 'el folio de Juan jamás queda para Pedro');
  assert.equal(state.name, undefined);
  assert.equal(state.lockedData, undefined);
  assert.equal(history.length, 0);
  assert.equal(state.carpeta_activa, PEDRO);
  assert.equal(state.gclid, 'g-vendedor', 'lo de infraestructura de quien escribe se queda');

  state.last_quote = { quote_number: 'CM-FR-004-2026-0501' };
  history.push({ role: 'user', content: 'Pedro: 1 puerta' });
  assert.equal(await cambiarCarpeta({ from: VENDEDOR, state, history, atribucion: { phone: JUAN }, ...kv }), 'cambio');
  assert.equal(state.last_quote.quote_number, 'CM-FR-004-2026-0500', 'volver a Juan devuelve SU folio');
  assert.equal(state.name, 'Juan');
  assert.deepEqual(history, [{ role: 'user', content: 'Juan: 3 ventanas' }]);
  assert.ok(kv.m.has(claveCarpeta(VENDEDOR, PEDRO)), 'lo de Pedro quedó guardado, no borrado');
});

test('decisión dueño 30-sep: consumir la atribución vuelve a la carpeta PROPIA (sin datos del cliente)', async () => {
  const kv = kvFalso();
  await kv.escribir(claveCarpeta(ADMIN, CARPETA_PROPIA), { state: { name: 'Marcelo' }, history: [{ role: 'user', content: 'lo mío' }] });
  const history = [{ role: 'user', content: 'para Juan' }];
  const state = { telefono: ADMIN, carpeta_activa: JUAN, name: 'Juan', lockedData: { comuna: 'Vilcún' },
    last_quote: { quote_number: 'CM-FR-004-2026-0600' } };
  assert.equal(await cambiarCarpeta({ from: ADMIN, state, history, atribucion: null, ...kv }), 'cambio');
  assert.equal(state.name, 'Marcelo');
  assert.equal(state.lockedData, undefined, 'la comuna de Juan no queda en la sesión del dueño');
  assert.equal(state.last_quote, undefined);
  assert.deepEqual(history, [{ role: 'user', content: 'lo mío' }]);
});

test('decisión dueño 30-sep: sin atribución y sin carpeta previa, la sesión no se toca', async () => {
  const kv = kvFalso();
  const history = [{ role: 'user', content: 'hola' }];
  const lq = { quote_number: 'CM-FR-004-2026-0400' };
  const state = { telefono: '56933334444', name: 'Ana', last_quote: lq };
  assert.equal(await cambiarCarpeta({ from: '56933334444', state, history, atribucion: null, ...kv }), 'igual');
  assert.equal(state.last_quote, lq);
  assert.equal(history.length, 1);
  assert.equal(kv.m.size, 0, 'no escribe nada');
});

test('B 30-sep: cotizó SIN cliente y después manda CLIENTE ⇒ ese trabajo se ADOPTA (no se borra)', async () => {
  const kv = kvFalso();
  const items = [{ product: 'corredera', measures: '1200x1000', color: 'blanco', unit_price: 300000, qty: 1 }];
  const history = [{ role: 'user', content: 'corredera 1200x1000 blanca' }];
  const state = { telefono: VENDEDOR, pending_quote: { items }, last_quote: { quote_number: 'CM-FR-004-2026-0100' } };
  assert.equal(await cambiarCarpeta({ from: VENDEDOR, state, history, atribucion: { phone: JUAN }, ...kv }), 'adopcion');
  assert.deepEqual(state.pending_quote.items, items, 'las mismas ventanas, ahora del cliente');
  assert.equal(history.length, 1);
  assert.equal(state.last_quote, undefined, 'el folio propio no viaja al cliente');
  assert.equal(state.carpeta_activa, JUAN);
  assert.deepEqual((await kv.leer(claveCarpeta(VENDEDOR, CARPETA_PROPIA))).state.last_quote, { quote_number: 'CM-FR-004-2026-0100' });
});
