// services/estadoPersistente.borrarSi.test.js — [2026-10-22]
// `borrarSi` compara y borra en UN paso (Codex, compuerta del candado Uw del piloto #1581).
// Sin red: con la persistencia apagada, la memoria es la fuente.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { borrarSi, actualizarSi, escribir, leerLocal, _reset } from './estadoPersistente.js';

beforeEach(() => _reset());
const K = 'docs_entregado:uw_linea:V2N:940415964';
const deA = (v) => v?.msgId === 'wamid.A';

test('mismo msgId ⇒ borra', async () => {
  escribir(K, { msgId: 'wamid.A' });
  assert.equal((await borrarSi(K, deA)).borrado, true);
  assert.equal(leerLocal(K), null);
});

test('otro msgId ⇒ no borra', async () => {
  escribir(K, { msgId: 'wamid.B' });
  assert.equal((await borrarSi(K, deA)).motivo, 'no_coincide');
  assert.equal(leerLocal(K).msgId, 'wamid.B');
});

test('sin candado ⇒ no borra ni falla', async () => {
  assert.equal((await borrarSi(K, deA)).motivo, 'no_existe');
});

test('candado sin msgId ⇒ no borra (no se puede probar que sea de ese envío)', async () => {
  escribir(K, { at: 1, dudoso: true });
  assert.equal((await borrarSi(K, deA)).borrado, false);
  assert.ok(leerLocal(K));
});

test('la condición que lanza ⇒ no borra', async () => {
  escribir(K, { msgId: 'wamid.A' });
  assert.equal((await borrarSi(K, () => { throw new Error('x'); })).borrado, false);
  assert.ok(leerLocal(K));
});

test('🔴 INTERCALACIÓN: el reenvío escribe B mientras el borrado de A espera ⇒ B sobrevive', async () => {
  escribir(K, { msgId: 'wamid.A' });
  const pendiente = borrarSi(K, deA);       // arranca y cede en el await de la lectura
  escribir(K, { msgId: 'wamid.B' });         // el reenvío reescribe el candado en el medio
  const r = await pendiente;
  assert.equal(r.borrado, false, 'compara contra lo vigente AL BORRAR, no contra lo leído antes');
  assert.equal(leerLocal(K).msgId, 'wamid.B');
});

// [Ronda 2 · Codex + Copilot] Caché VACÍA y lectura remota DEMORADA: si mientras viaja el GET (que
// trae A desde la base) el proceso escribe B, la hidratación no puede pisar B ni el borrado llevárselo.
// `leerConEstado` re-chequea la memoria después del await (compuerta 24-ago); este test lo fija.
test('🔴 caché vacía + GET remoto demorado: el reenvío escribe B durante la espera ⇒ B sobrevive', async () => {
  const fetchPrevio = global.fetch;
  let soltarGet;
  const getEnVuelo = new Promise((r) => { soltarGet = r; });
  const pedidos = [];
  global.fetch = async (url, opts = {}) => {
    const metodo = opts.method || 'GET';
    pedidos.push(metodo);
    if (metodo === 'GET') { await getEnVuelo; return { ok: true, json: async () => ({ ok: true, valor: { msgId: 'wamid.A' } }) }; }
    return { ok: true, json: async () => ({ ok: true }) };
  };
  process.env.SALES_OS_URL = 'http://sales-os.test';
  process.env.SALES_OS_OPERATOR_TOKEN = 'token-de-prueba';
  try {
    const m = await import('./estadoPersistente.js?borrarSi=remoto');   // instancia nueva: memoria vacía
    assert.equal(m.PERSISTENCIA_ACTIVA, true, 'control: la persistencia está prendida');
    const pendiente = m.borrarSi(K, deA);    // sale a buscar A a la base y espera
    await new Promise((r) => { setTimeout(r, 10); });
    m.escribir(K, { msgId: 'wamid.B' });     // el reenvío escribe B mientras el GET viaja
    soltarGet();                              // la base contesta con el A viejo
    const r = await pendiente;
    assert.equal(r.borrado, false, `no se borra: ${JSON.stringify(r)}`);
    assert.equal(m.leerLocal(K)?.msgId, 'wamid.B', 'la hidratación no pisó B');
    assert.ok(!pedidos.includes('DELETE'), 'ni se mandó a borrar a la base');
  } finally {
    global.fetch = fetchPrevio;
    delete process.env.SALES_OS_URL; delete process.env.SALES_OS_OPERATOR_TOKEN;
  }
});

// ── actualizarSi (2026-10-22 · entrega del Uw con `delivered`) ─────────────────────────────
const pendienteDeA = (v) => v?.msgId === 'wamid.A' && v?.pendiente === true;
const entregado = (v) => ({ ...v, pendiente: false });

test('actualizarSi: candado pendiente del mismo msgId ⇒ se promueve UNA vez (el 2º delivered no)', async () => {
  escribir(K, { msgId: 'wamid.A', pendiente: true });
  assert.equal((await actualizarSi(K, pendienteDeA, entregado, 60)).actualizado, true);
  assert.equal(leerLocal(K).pendiente, false);
  assert.equal((await actualizarSi(K, pendienteDeA, entregado, 60)).motivo, 'no_coincide');
});

test('actualizarSi: otro msgId o sin candado ⇒ no escribe', async () => {
  escribir(K, { msgId: 'wamid.B', pendiente: true });
  assert.equal((await actualizarSi(K, pendienteDeA, entregado, 60)).actualizado, false);
  assert.equal(leerLocal(K).pendiente, true);
  _reset();
  assert.equal((await actualizarSi(K, pendienteDeA, entregado, 60)).motivo, 'no_existe');
  assert.equal(leerLocal(K), null, 'no crea un candado que no existía');
});

test('🔴 actualizarSi INTERCALACIÓN: el reenvío escribe B mientras la promoción de A espera ⇒ B intacto', async () => {
  escribir(K, { msgId: 'wamid.A', pendiente: true });
  const pendiente = actualizarSi(K, pendienteDeA, entregado, 60);
  escribir(K, { msgId: 'wamid.B', pendiente: true });
  assert.equal((await pendiente).actualizado, false);
  assert.deepEqual(leerLocal(K), { msgId: 'wamid.B', pendiente: true });
});

test('🔴 [Codex r3] dos transiciones seguidas de la MISMA clave llegan a la base EN ORDEN aunque la red las desordene', async () => {
  const fetchPrevio = global.fetch;
  const base = new Map();
  let nPut = 0;
  global.fetch = async (url, opts = {}) => {
    const clave = decodeURIComponent(String(url).split('/internal/kv/')[1] || '');
    const metodo = opts.method || 'GET';
    if (metodo === 'GET') return { ok: true, json: async () => ({ ok: true, valor: base.has(clave) ? base.get(clave) : null }) };
    if (metodo === 'PUT') {
      const n = ++nPut;
      // el 2º PUT (en_curso) tarda MUCHO; el 3º (si) es rápido: sin orden, la base terminaría en «en_curso»
      await new Promise((r) => { setTimeout(r, n === 2 ? 150 : 5); });
      base.set(clave, JSON.parse(opts.body).valor);
      return { ok: true, json: async () => ({ ok: true }) };
    }
    if (metodo === 'DELETE') { base.delete(clave); return { ok: true, json: async () => ({ ok: true }) }; }
    return { ok: false, json: async () => ({}) };
  };
  process.env.SALES_OS_URL = 'http://sales-os.test';
  process.env.SALES_OS_OPERATOR_TOKEN = 'token-de-prueba';
  try {
    const m = await import('./estadoPersistente.js?orden=1');
    m.escribir(K, { msgId: 'wamid.A', archivo: 'no' }, 60);
    await new Promise((r) => { setTimeout(r, 30); });            // PUT 1 asentado
    const t1 = m.actualizarSi(K, (v) => v.archivo === 'no', (v) => ({ ...v, archivo: 'en_curso' }), 60);
    const t2 = m.actualizarSi(K, (v) => v.archivo === 'en_curso', (v) => ({ ...v, archivo: 'si' }), 60);
    const [r1, r2] = await Promise.all([t1, t2]);
    assert.equal(r1.actualizado && r2.actualizado, true, JSON.stringify([r1, r2]));
    assert.equal(m.leerLocal(K).archivo, 'si');
    assert.equal(base.get(K).archivo, 'si', `la base quedó en «${base.get(K)?.archivo}»: los PUT llegaron desordenados`);
  } finally {
    global.fetch = fetchPrevio;
    delete process.env.SALES_OS_URL; delete process.env.SALES_OS_OPERATOR_TOKEN;
  }
});

test('🔴 [Codex r4] escribir(A) con PUT LENTO y enseguida actualizarSi(→B) con PUT rápido: la base termina en B', async () => {
  const fetchPrevio = global.fetch;
  const base = new Map();
  let nPut = 0;
  global.fetch = async (url, opts = {}) => {
    const clave = decodeURIComponent(String(url).split('/internal/kv/')[1] || '');
    const metodo = opts.method || 'GET';
    if (metodo === 'GET') return { ok: true, json: async () => ({ ok: true, valor: base.has(clave) ? base.get(clave) : null }) };
    if (metodo === 'PUT') {
      const n = ++nPut;
      await new Promise((r) => { setTimeout(r, n === 1 ? 150 : 5); });   // el PUT de escribir(A) termina ÚLTIMO
      base.set(clave, JSON.parse(opts.body).valor);
      return { ok: true, json: async () => ({ ok: true }) };
    }
    if (metodo === 'DELETE') { await new Promise((r) => { setTimeout(r, 5); }); base.delete(clave); return { ok: true, json: async () => ({ ok: true }) }; }
    return { ok: false, json: async () => ({}) };
  };
  process.env.SALES_OS_URL = 'http://sales-os.test';
  process.env.SALES_OS_OPERATOR_TOKEN = 'token-de-prueba';
  try {
    const m = await import('./estadoPersistente.js?orden=2');
    m.escribir(K, { msgId: 'wamid.A', pendiente: true }, 60);          // SIN esperar
    const r = await m.actualizarSi(K, (v) => v.pendiente === true, (v) => ({ ...v, pendiente: false }), 60);
    assert.equal(r.actualizado, true);
    await new Promise((res) => { setTimeout(res, 250); });
    assert.equal(base.get(K)?.pendiente, false, `la base quedó con ${JSON.stringify(base.get(K))}: el PUT viejo pisó al nuevo`);
    // y un borrar() que sigue a un escribir() lento tampoco deja la clave viva en la base
    nPut = 0;
    m.escribir('otra', { x: 1 }, 60);
    m.borrar('otra');
    await new Promise((res) => { setTimeout(res, 250); });
    assert.equal(base.has('otra'), false, 'el DELETE salió después del PUT');
  } finally {
    global.fetch = fetchPrevio;
    delete process.env.SALES_OS_URL; delete process.env.SALES_OS_OPERATOR_TOKEN;
  }
});
