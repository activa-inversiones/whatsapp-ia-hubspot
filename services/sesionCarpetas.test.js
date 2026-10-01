// GUARDIAS de la carpeta por cliente (decisión del dueño 30-sep: la cotización de un vendedor
// cuenta al CLIENTE; diseño «Cliente explícito»: nada se adopta ni se adivina). Si algo acá se
// pone rojo, se está mezclando el trabajo de un cliente con el de otro, o perdiendo trabajo.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cambiarCarpeta, claveCarpeta, CLAVES_INFRA_SESION, CARPETA_PROPIA } from './sesionCarpetas.js';

const ADMIN = '56957296035';
const VENDEDOR = '56911110000';
const JUAN = '56987654321';
const PEDRO = '56912345678';

/** KV simulado con el contrato real: leer → {ok, valor}; escribir → {ok, motivo?} o lanza. */
function kvFalso({ leerFalla = false, escribir = null } = {}) {
  const m = new Map();
  return {
    m,
    leer: async (k) => (leerFalla ? { ok: false } : { ok: true, valor: m.has(k) ? structuredClone(m.get(k)) : null }),
    escribir: escribir || (async (k, v) => { m.set(k, structuredClone(v)); return { ok: true }; }),
  };
}

test('la lista de claves que se comparten entre clientes está documentada', () => {
  // Agregar algo acá es decidir que pasa de un cliente al siguiente. last_quote, lockedData,
  // name, pending_quote e historial NO pueden estar.
  assert.deepEqual([...CLAVES_INFRA_SESION].sort(), [
    // carpeta_gen/nombre/cerrada (reordenamiento 30-sep): marcas de la carpeta activa, no datos del cliente.
    'ad_id', 'carpeta_activa', 'carpeta_cerrada', 'carpeta_gen', 'carpeta_nombre', 'ctwaCaptured', 'ctwa_clid', 'fbclid', 'fecha', 'gclid',
    'landingRefCaptured', 'landing_lead_id', 'lastMessageAt', 'ref_status', 'telefono', 'ttclid',
  ]);
});

test('6 · la clave de carpeta usa el número COMPLETO normalizado (no la cola de 9)', () => {
  assert.equal(claveCarpeta(VENDEDOR, '+56 9 8765 4321'), `sesion_cliente:${VENDEDOR}:${JUAN}`);
  assert.equal(claveCarpeta('911110000', '987654321'), `sesion_cliente:${VENDEDOR}:${JUAN}`, 'celular chileno sin 56');
  assert.notEqual(claveCarpeta(VENDEDOR, '34987654321'), claveCarpeta(VENDEDOR, JUAN), 'otro país, misma cola: otra carpeta');
  assert.equal(claveCarpeta(VENDEDOR, CARPETA_PROPIA), `sesion_cliente:${VENDEDOR}:propia`);
  assert.throws(() => claveCarpeta(VENDEDOR, '12345678'), /incompleto/, 'un número incompleto no arma clave');
});

test('cambiar de cliente NO filtra nada y volver a Juan recupera SU trabajo (y su folio)', async () => {
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
  assert.equal(state.last_quote.quote_number, 'CM-FR-004-2026-0500', 'volver a Juan devuelve SU folio (corrección = mismo folio)');
  assert.equal(state.name, 'Juan');
  assert.deepEqual(history, [{ role: 'user', content: 'Juan: 3 ventanas' }]);
});

test('lo guardado es una COPIA: cambiar el estado activo después no altera la carpeta', async () => {
  const kv = kvFalso();
  const lockedData = { comuna: 'Temuco' };
  const state = { carpeta_activa: JUAN, lockedData };
  await cambiarCarpeta({ from: VENDEDOR, state, history: [], cliente: PEDRO, ...kv });
  lockedData.comuna = 'MUTADA';
  assert.equal(kv.m.get(claveCarpeta(VENDEDOR, JUAN)).state.lockedData.comuna, 'Temuco');
});

test('volver a la carpeta PROPIA (atribución consumida / OFF / vencida) no deja datos del cliente', async () => {
  const kv = kvFalso();
  kv.m.set(claveCarpeta(ADMIN, CARPETA_PROPIA), { state: { name: 'Marcelo' }, history: [{ role: 'user', content: 'lo mío' }] });
  const history = [{ role: 'user', content: 'para Juan' }];
  const state = { telefono: ADMIN, carpeta_activa: JUAN, name: 'Juan', lockedData: { comuna: 'Vilcún' },
    last_quote: { quote_number: 'CM-FR-004-2026-0600' } };
  assert.equal((await cambiarCarpeta({ from: ADMIN, state, history, cliente: null, ...kv })).mov, 'cambio');
  assert.equal(state.name, 'Marcelo');
  assert.equal(state.lockedData, undefined, 'la comuna de Juan no queda en la sesión del dueño');
  assert.equal(state.last_quote, undefined, 'su cotización propia nunca reusa el folio de Juan');
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

test('2 · «Cliente explícito»: lo cotizado SIN cliente NO se adopta — la carpeta propia queda propia', async () => {
  const kv = kvFalso();
  const items = [{ product: 'corredera', measures: '1200x1000', color: 'blanco', unit_price: 300000, qty: 1 }];
  const history = [{ role: 'user', content: 'corredera 1200x1000 blanca' }];
  const state = { telefono: VENDEDOR, pending_quote: { items } };
  assert.equal((await cambiarCarpeta({ from: VENDEDOR, state, history, cliente: JUAN, ...kv })).mov, 'cambio');
  assert.equal(state.pending_quote, undefined, 'el cliente arranca con SU carpeta (vacía), no con lo propio');
  assert.equal(history.length, 0);
  assert.deepEqual(kv.m.get(claveCarpeta(VENDEDOR, CARPETA_PROPIA)).state.pending_quote.items, items, 'lo propio queda guardado');
});

test('4 · si la LECTURA de la carpeta nueva falla, no se cambia de carpeta ni se guarda encima', async () => {
  const kv = kvFalso({ leerFalla: true });
  const history = [{ role: 'user', content: 'Juan' }];
  const state = { carpeta_activa: JUAN, name: 'Juan' };
  const logs = [];
  const r = await cambiarCarpeta({ from: VENDEDOR, state, history, cliente: PEDRO, ...kv, log: (n, m) => logs.push([n, m]) });
  assert.equal(r.mov, 'error');
  assert.equal(state.carpeta_activa, JUAN);
  assert.equal(state.name, 'Juan');
  assert.equal(history.length, 1);
  assert.equal(kv.m.size, 0, 'no se escribió nada');
  assert.ok(logs.some(([n]) => n === 'error'), 'queda registrado como error');
});

test('Tridente r3 #4 (30-sep): escritura sin confirmar de sales-os = ERROR (no se sigue): perder la carpeta tras un redeploy es peor que pedir reintentar', async () => {
  // Esta aserción se INVIRTIÓ a propósito (antes: 'cambio' con advertencia). Orden del coordinador
  // tras el tridente r3: la memoria local no sobrevive a un redeploy, y la carpeta del cliente
  // anterior se perdería en silencio.
  const kv = kvFalso({ escribir: async () => ({ ok: false, motivo: 'sales_os_no_confirmo' }) });
  const history = [{ role: 'user', content: 'Juan' }];
  const state = { carpeta_activa: JUAN, name: 'Juan' };
  assert.equal((await cambiarCarpeta({ from: VENDEDOR, state, history, cliente: PEDRO, ...kv })).mov, 'error');
  assert.equal(state.name, 'Juan', 'el estado activo no se toca');
  assert.equal(history.length, 1);
  // Persistencia apagada (desarrollo/tests, sin sales-os): eso NO es una falla, se sigue.
  const kv2 = kvFalso({ escribir: async () => ({ ok: false, motivo: 'persistencia_apagada' }) });
  assert.equal((await cambiarCarpeta({ from: VENDEDOR, state: { carpeta_activa: JUAN }, history: [], cliente: PEDRO, ...kv2 })).mov, 'cambio');
});

test('4 · si la escritura LANZA, el estado activo NO se vacía', async () => {
  const kv = kvFalso({ escribir: async () => { throw new Error('caída'); } });
  const history = [{ role: 'user', content: 'Juan: 3 ventanas' }];
  const state = { carpeta_activa: JUAN, name: 'Juan' };
  const r = await cambiarCarpeta({ from: VENDEDOR, state, history, cliente: PEDRO, ...kv });
  assert.equal(r.mov, 'error');
  assert.equal(state.name, 'Juan');
  assert.equal(state.carpeta_activa, JUAN);
  assert.equal(history.length, 1);
});
