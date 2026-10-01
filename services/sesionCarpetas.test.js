// GUARDIAS de la carpeta por cliente (decisión del dueño 30-sep: la cotización de un vendedor
// cuenta al CLIENTE; rediseño tras el NO APTO del tridente). Si algo acá se pone rojo, se
// está mezclando el trabajo de un cliente con el de otro, o perdiendo trabajo.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cambiarCarpeta, claveCarpeta, CLAVES_INFRA_SESION, CARPETA_PROPIA, fusionarItems } from './sesionCarpetas.js';

const ADMIN = '56957296035';
const VENDEDOR = '56911110000';
const JUAN = '56987654321';
const PEDRO = '56912345678';

function kvFalso({ fallar = false } = {}) {
  const m = new Map();
  return {
    m,
    leer: async (k) => (m.has(k) ? structuredClone(m.get(k)) : null),
    escribir: async (k, v) => {
      if (fallar) return { ok: false, motivo: 'sales_os_no_confirmo' };
      m.set(k, structuredClone(v)); return { ok: true };
    },
  };
}

test('la lista de claves que se comparten entre clientes está documentada', () => {
  // Agregar algo acá es decidir que pasa de un cliente al siguiente. last_quote, lockedData,
  // name, pending_quote e historial NO pueden estar.
  assert.deepEqual([...CLAVES_INFRA_SESION].sort(), [
    'ad_id', 'carpeta_activa', 'ctwaCaptured', 'ctwa_clid', 'fbclid', 'fecha', 'gclid',
    'landingRefCaptured', 'landing_lead_id', 'lastMessageAt', 'ref_status', 'telefono', 'ttclid',
  ]);
});

test('cambiar de cliente NO filtra nada y volver a Juan recupera SU trabajo', async () => {
  const kv = kvFalso();
  const history = [{ role: 'user', content: 'Juan: 3 ventanas' }];
  const state = { telefono: VENDEDOR, carpeta_activa: JUAN, name: 'Juan', lockedData: { comuna: 'Temuco' },
    last_quote: { quote_number: 'CM-FR-004-2026-0500' }, gclid: 'g-vendedor' };

  assert.equal((await cambiarCarpeta({ from: VENDEDOR, state, history, cliente: PEDRO, ...kv })).mov, 'cambio');
  assert.equal(state.last_quote, undefined, 'el folio de Juan jamás queda para Pedro');
  assert.equal(state.name, undefined);
  assert.equal(state.lockedData, undefined);
  assert.equal(history.length, 0);
  assert.equal(state.carpeta_activa, PEDRO);
  assert.equal(state.gclid, 'g-vendedor', 'lo de infraestructura de quien escribe se queda');

  state.last_quote = { quote_number: 'CM-FR-004-2026-0501' };
  history.push({ role: 'user', content: 'Pedro: 1 puerta' });
  assert.equal((await cambiarCarpeta({ from: VENDEDOR, state, history, cliente: JUAN, ...kv })).mov, 'cambio');
  assert.equal(state.last_quote.quote_number, 'CM-FR-004-2026-0500', 'volver a Juan devuelve SU folio');
  assert.equal(state.name, 'Juan');
  assert.deepEqual(history, [{ role: 'user', content: 'Juan: 3 ventanas' }]);
  assert.ok(kv.m.has(claveCarpeta(VENDEDOR, PEDRO)), 'lo de Pedro quedó guardado, no borrado');
});

test('lo guardado es una COPIA: cambiar el estado activo después no altera la carpeta', async () => {
  const kv = kvFalso();
  const lockedData = { comuna: 'Temuco' };
  const state = { carpeta_activa: JUAN, lockedData };
  await cambiarCarpeta({ from: VENDEDOR, state, history: [], cliente: PEDRO, ...kv });
  lockedData.comuna = 'MUTADA';
  assert.equal((await kv.leer(claveCarpeta(VENDEDOR, JUAN))).state.lockedData.comuna, 'Temuco');
});

test('volver a la carpeta PROPIA (CLIENTE OFF / vencida) no deja datos del cliente', async () => {
  const kv = kvFalso();
  await kv.escribir(claveCarpeta(ADMIN, CARPETA_PROPIA), { state: { name: 'Marcelo' }, history: [{ role: 'user', content: 'lo mío' }] });
  const history = [{ role: 'user', content: 'para Juan' }];
  const state = { telefono: ADMIN, carpeta_activa: JUAN, name: 'Juan', lockedData: { comuna: 'Vilcún' },
    last_quote: { quote_number: 'CM-FR-004-2026-0600' } };
  assert.equal((await cambiarCarpeta({ from: ADMIN, state, history, cliente: null, ...kv })).mov, 'cambio');
  assert.equal(state.name, 'Marcelo');
  assert.equal(state.lockedData, undefined, 'la comuna de Juan no queda en la sesión del dueño');
  assert.equal(state.last_quote, undefined);
  assert.deepEqual(history, [{ role: 'user', content: 'lo mío' }]);
});

test('sin atribución y sin carpeta previa, la sesión no se toca ni se escribe nada', async () => {
  const kv = kvFalso();
  const history = [{ role: 'user', content: 'hola' }];
  const lq = { quote_number: 'CM-FR-004-2026-0400' };
  const state = { telefono: '56933334444', name: 'Ana', last_quote: lq };
  assert.equal((await cambiarCarpeta({ from: '56933334444', state, history, cliente: null, ...kv })).mov, 'igual');
  assert.equal(state.last_quote, lq);
  assert.equal(history.length, 1);
  assert.equal(kv.m.size, 0);
});

test('4 · si NO se confirma el guardado de la carpeta saliente, el estado activo NO se vacía', async () => {
  const kv = kvFalso({ fallar: true });
  const history = [{ role: 'user', content: 'Juan: 3 ventanas' }];
  const state = { carpeta_activa: JUAN, name: 'Juan', last_quote: { quote_number: 'X' } };
  const r = await cambiarCarpeta({ from: VENDEDOR, state, history, cliente: PEDRO, ...kv });
  assert.equal(r.mov, 'error');
  assert.equal(state.name, 'Juan');
  assert.equal(state.carpeta_activa, JUAN, 'sigue en la carpeta de Juan');
  assert.equal(history.length, 1);
});

test('B · cotizó SIN cliente y después manda CLIENTE ⇒ ese trabajo se ADOPTA (no se borra)', async () => {
  const kv = kvFalso();
  const items = [{ product: 'corredera', measures: '1200x1000', color: 'blanco', unit_price: 300000, qty: 1 }];
  const history = [{ role: 'user', content: 'corredera 1200x1000 blanca' }];
  const state = { telefono: VENDEDOR, pending_quote: { items }, last_quote: { quote_number: 'CM-FR-004-2026-0100' } };
  assert.equal((await cambiarCarpeta({ from: VENDEDOR, state, history, cliente: JUAN, ...kv })).mov, 'adopcion');
  assert.deepEqual(state.pending_quote.items, items, 'las mismas ventanas, ahora del cliente');
  assert.equal(history.length, 1);
  assert.equal(state.last_quote, undefined, 'el folio propio no viaja al cliente');
  assert.equal(state.carpeta_activa, JUAN);
  assert.deepEqual((await kv.leer(claveCarpeta(VENDEDOR, CARPETA_PROPIA))).state.last_quote, { quote_number: 'CM-FR-004-2026-0100' });
});

test('2 · adopción con carpeta del cliente YA existente: no se pisa, se FUSIONAN las ventanas', async () => {
  const kv = kvFalso();
  const deJuan = [{ product: 'corredera', measures: '1200x1000', color: 'blanco', qty: 1 }];
  await kv.escribir(claveCarpeta(VENDEDOR, JUAN), {
    state: { name: 'Juan', last_quote: { quote_number: 'CM-FR-004-2026-0700' }, pending_quote: { items: deJuan } },
    history: [{ role: 'user', content: 'lo de Juan' }],
  });
  const nuevas = [
    { product: 'corredera', measures: '1200x1000', color: 'blanco', qty: 1 },   // idéntica: no se duplica
    { product: 'abatible', measures: '600x800', color: 'blanco', qty: 2 },
  ];
  const history = [{ role: 'user', content: 'sin cliente' }];
  const state = { telefono: VENDEDOR, pending_quote: { items: nuevas } };
  const r = await cambiarCarpeta({ from: VENDEDOR, state, history, cliente: JUAN, ...kv });
  assert.equal(r.mov, 'fusion');
  assert.equal(r.agregados, 1);
  assert.equal(state.name, 'Juan', 'se restauró la carpeta de Juan');
  assert.equal(state.last_quote.quote_number, 'CM-FR-004-2026-0700', 'y su folio');
  assert.deepEqual(state.pending_quote.items.map((i) => i.measures), ['1200x1000', '600x800']);
  assert.deepEqual(history, [{ role: 'user', content: 'lo de Juan' }]);
});

test('fusionarItems no duplica idénticos', () => {
  const a = [{ product: 'x', measures: '1', color: 'b', qty: 1 }];
  assert.equal(fusionarItems(a, a).agregados, 0);
  assert.equal(fusionarItems(a, [{ product: 'x', measures: '1', color: 'b', qty: 2 }]).agregados, 1);
});
