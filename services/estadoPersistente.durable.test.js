// estadoPersistente.durable.test.js
// 🔴 [Codex, compuerta 16-sep] `escribir()` es fire-and-forget A PROPOSITO: el turno del
// cliente no espera a la base. Eso esta bien para lo que se puede perder, y MAL para un
// candado que existe para sobrevivir a un reinicio. Codex lo dijo del candado que se
// escribio ese mismo dia: *"el await escribirEstado(...) nuevo no espera PostgreSQL... un
// fallo del PUT o una caida del proceso puede perder el supuesto candado durable"*.
// Parecia durable y no lo era. Estos tests fijan la diferencia.
import test from 'node:test';
import assert from 'node:assert/strict';

// La persistencia se decide al importar el modulo, asi que el entorno se arma ANTES.
process.env.SALES_OS_URL = 'http://kv.invalido.local';
process.env.SALES_OS_OPERATOR_TOKEN = 'tok-de-prueba';

const { escribirDurable, escribir, leerLocal, _reset, PERSISTENCIA_ACTIVA } =
  await import('./estadoPersistente.js');

const fetchReal = global.fetch;
function conFetch(fn) { global.fetch = fn; }
function restaurar() { global.fetch = fetchReal; }

test('la persistencia quedo activa en el arnes (si no, estos tests no miden nada)', () => {
  assert.equal(PERSISTENCIA_ACTIVA, true);
});

test('🔴 si la base CONFIRMA, dice ok:true', async () => {
  _reset();
  conFetch(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  const r = await escribirDurable('candado:1', { dudoso: true }, 60);
  restaurar();
  assert.deepEqual(r, { ok: true, enMemoria: true });
});

test('🔴 si la base NO responde, dice ok:false — y NO miente', async () => {
  // Este es el caso que importa: antes se escribia igual y el llamador creia que habia
  // quedado guardado. Ahora puede decir la verdad en el log y en el aviso.
  _reset();
  conFetch(async () => { throw new Error('ECONNREFUSED'); });
  const r = await escribirDurable('candado:2', { dudoso: true }, 60);
  restaurar();
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'sales_os_no_confirmo');
});

test('🔴 un 5xx tampoco es confirmacion', async () => {
  _reset();
  conFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  const r = await escribirDurable('candado:3', {}, 60);
  restaurar();
  assert.equal(r.ok, false);
});

test('🔴 aunque la base falle, la MEMORIA queda marcada: la guarda del proceso no se pierde', async () => {
  _reset();
  conFetch(async () => { throw new Error('caida'); });
  await escribirDurable('candado:4', { dudoso: true, motivo: 'timeout' }, 60);
  restaurar();
  assert.deepEqual(leerLocal('candado:4'), { dudoso: true, motivo: 'timeout' });
});

test('🔴 ESPERA de verdad: no devuelve antes de que la base conteste', async () => {
  // La diferencia con `escribir()` es justamente esta. Si no esperara, el llamador seguiria
  // de largo creyendo que el candado quedo puesto.
  _reset();
  let resolver;
  conFetch(() => new Promise((res) => { resolver = () => res({ ok: true, json: async () => ({}) }); }));
  let termino = false;
  const p = escribirDurable('candado:5', {}, 60).then(() => { termino = true; });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(termino, false, 'devolvio sin esperar a la base: no es durable');
  resolver();
  await p;
  restaurar();
  assert.equal(termino, true);
});

test('el `escribir` de siempre NO espera (sigue siendo el camino caliente)', async () => {
  _reset();
  let llamado = false;
  conFetch(() => { llamado = true; return new Promise(() => {}); });   // nunca resuelve
  const antes = Date.now();
  escribir('rapido:1', { x: 1 }, 60);
  const ms = Date.now() - antes;
  restaurar();
  assert.ok(ms < 50, `escribir() tardo ${ms}ms: dejaria de servir para el camino caliente`);
  assert.equal(llamado, true, 'igual lanza el guardado, solo que sin esperarlo');
  assert.deepEqual(leerLocal('rapido:1'), { x: 1 });
});
