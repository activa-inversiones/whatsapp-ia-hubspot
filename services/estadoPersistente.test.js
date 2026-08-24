// estadoPersistente.test.js — [2026-08-08]
// Pregunta del dueño: "¿solucionaste el tema de cuando deployamos algo se pierde
// información?". Estos tests fijan que lo que NO puede perderse, no se pierde.

import test from 'node:test';
import assert from 'node:assert/strict';

// Simula el ciclo real: escribir → morir el proceso → arrancar de nuevo → leer.
// El "Postgres" es un Map que sobrevive al reinicio; la memoria del módulo, no.
function armarBackend() {
  const disco = new Map();
  const fetchFalso = async (url, opts = {}) => {
    const clave = decodeURIComponent(String(url).split('/internal/kv/')[1] || '');
    const metodo = opts.method || 'GET';
    if (metodo === 'GET') return { ok: true, json: async () => ({ ok: true, valor: disco.has(clave) ? disco.get(clave) : null }) };
    if (metodo === 'PUT') { disco.set(clave, JSON.parse(opts.body).valor); return { ok: true, json: async () => ({ ok: true }) }; }
    if (metodo === 'DELETE') { disco.delete(clave); return { ok: true, json: async () => ({ ok: true }) }; }
    return { ok: false, json: async () => ({}) };
  };
  return { disco, fetchFalso };
}

async function cargarModulo(fetchFalso, marca) {
  process.env.SALES_OS_URL = 'http://sales-os.test';
  process.env.SALES_OS_OPERATOR_TOKEN = 'token-de-prueba';
  global.fetch = fetchFalso;
  // Query distinta = instancia nueva del módulo = memoria vacía = "el proceso reinició".
  return import(`./estadoPersistente.js?reinicio=${marca}`);
}

test('lo escrito sobrevive a un reinicio del proceso', async () => {
  const { fetchFalso } = armarBackend();

  const antes = await cargarModulo(fetchFalso, 'a1');
  antes.escribir('consent:56912345678', true, 3600);
  await new Promise((r) => setTimeout(r, 20)); // el PUT es fire-and-forget
  assert.equal(antes.leerLocal('consent:56912345678'), true, 'debe estar en memoria');

  // ── acá "deployamos": módulo nuevo, memoria en cero ──
  const despues = await cargarModulo(fetchFalso, 'a2');
  assert.equal(despues.leerLocal('consent:56912345678'), null, 'la memoria arranca vacía');
  assert.equal(await despues.leer('consent:56912345678'), true, 'pero el dato se recupera de la base');
});

test('lo borrado NO revive tras un reinicio', async () => {
  // Si un cliente escribe y se levanta su marca, un deploy no puede resucitarla y volver
  // a bloquearle el seguimiento para siempre.
  const { fetchFalso } = armarBackend();
  const antes = await cargarModulo(fetchFalso, 'b1');
  antes.escribir('consent:56911111111', true, 3600);
  await new Promise((r) => setTimeout(r, 20));
  antes.borrar('consent:56911111111');
  await new Promise((r) => setTimeout(r, 20));

  const despues = await cargarModulo(fetchFalso, 'b2');
  assert.equal(await despues.leer('consent:56911111111'), null);
});

test('si la plataforma está caída NO rompe: se degrada a memoria sola', async () => {
  // Perder una marca es malo; dejar a un cliente sin respuesta es peor.
  const caido = async () => { throw new Error('sales-os no responde'); };
  const mod = await cargarModulo(caido, 'c1');
  assert.doesNotThrow(() => mod.escribir('x', 1, 60));
  assert.equal(mod.leerLocal('x'), 1, 'la memoria local sigue funcionando');
  assert.equal(await mod.leer('otra-clave'), null, 'y leer algo que no está devuelve null, no lanza');
});

test('sin credenciales queda inerte y no lanza (entorno de test/local)', async () => {
  delete process.env.SALES_OS_URL;
  delete process.env.SALES_OS_OPERATOR_TOKEN;
  const mod = await import('./estadoPersistente.js?sin=creds');
  assert.equal(mod.PERSISTENCIA_ACTIVA, false);
  assert.doesNotThrow(() => mod.escribir('y', 2, 60));
  assert.equal(mod.leerLocal('y'), 2, 'sigue sirviendo como caché en memoria');
});

// ── 🔴 [2026-08-24] RESERVAR: test-and-set ATOMICO ───────────────────────────
// Nacio de un duplicado MEDIDO en produccion: los DOS clientes atendidos el 24-ago
// recibieron su informe termico DOS veces (folios 0001/0002 y 0003/0004), con 90 y 310 ms
// entre emisiones. La causa no era la ventana humana que el candado de 5 min asumia: son
// dos `calcular_cotizacion` del MISMO turno —una por ventana del proyecto— corriendo en
// paralelo. El candado hacia `await leer(...)` y despues `await escribir(...)`, y CADA
// `await` cede el event loop: las dos ejecuciones leian "libre" antes de que ninguna
// escribiera, y las dos pasaban.
//
// `reservar` cierra la carrera porque no tiene NI UN await adentro: en el hilo unico de
// Node, entre el chequeo y la marca no puede colarse nadie.

test('🔒 reservar: el primero se la lleva, el segundo NO', async () => {
  const { fetchFalso } = armarBackend();
  const mod = await cargarModulo(fetchFalso, 'r1');
  const token = mod.reservar('informe:569', 300);
  assert.ok(token, 'la primera reserva se otorga y devuelve el token del dueño');
  assert.equal(mod.reservar('informe:569', 300), null, 'la segunda tiene que ser rechazada');
});

test('🔒 reservar: dos ejecuciones CONCURRENTES — solo una pasa', async () => {
  // Esta es la reproduccion del defecto real. Con el patron viejo (leer/escribir con
  // await) las dos pasaban; el test lo demuestra comparando ambos caminos.
  const { fetchFalso } = armarBackend();
  const mod = await cargarModulo(fetchFalso, 'r2');

  const intento = async (clave, i) => {
    await new Promise((r) => setTimeout(r, i));   // el desfase de ~ms que hubo en produccion
    return mod.reservar(clave, 300);
  };
  const conReserva = await Promise.all([intento('a', 0), intento('a', 1), intento('a', 2)]);
  assert.deepEqual(conReserva.filter(Boolean).length, 1, 'una sola ejecucion puede seguir');

  // El patron VIEJO, para que quede constancia de por que no servia:
  // Arrancan en el MISMO tick, que es lo que pasa cuando un turno dispara dos
  // cotizaciones: el `await` de `leer` cede el control y las tres entran antes de que
  // ninguna haya marcado nada.
  const viejo = async (clave) => {
    if (await mod.leer(clave)) return false;
    mod.escribir(clave, true, 300);
    return true;
  };
  const sinReserva = await Promise.all([viejo('b'), viejo('b'), viejo('b')]);
  assert.ok(sinReserva.filter(Boolean).length > 1,
    'el patron leer-luego-escribir deja pasar a mas de uno: por eso se cambio');
});

test('🔒 reservar: si el envio falla, liberar deja reintentar en el proximo turno', async () => {
  // Un candado que no se puede soltar es peor que no tener candado: dejaria al cliente
  // sin informe hasta que venza el TTL. Ya paso —4 clientes bloqueados 30 dias— y no
  // se repite.
  const { fetchFalso } = armarBackend();
  const mod = await cargarModulo(fetchFalso, 'r3');
  const token = mod.reservar('c', 300);
  assert.ok(token);
  assert.equal(mod.reservar('c', 300), null);
  assert.equal(mod.liberarReserva('c', token), true, 'el dueño puede soltarla');
  assert.ok(mod.reservar('c', 300), 'liberada, el proximo turno reintenta');
});

test('🔒 reservar: una reserva VENCIDA no bloquea para siempre', async () => {
  const { fetchFalso } = armarBackend();
  const mod = await cargarModulo(fetchFalso, 'r4');
  assert.ok(mod.reservar('d', 0.03));                    // 30 ms de vida
  assert.equal(mod.reservar('d', 0.03), null);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(mod.reservar('d', 300), 'vencida, se puede volver a tomar');
});

test('🔴 [Codex · compuerta] liberar SIN dueño podia borrar la reserva de otro', async () => {
  // LA SECUENCIA QUE CAZO CODEX: A reserva. Pasan los 5 min y la reserva vence. B, que es
  // otra cotizacion, toma una reserva NUEVA y valida. Recien ahi A falla y suelta... la de
  // B. Con la llave libre, C reserva tambien ⇒ dos envios, que es exactamente el duplicado
  // que este candado vino a matar.
  //
  // Por eso `liberar` deja de ser un `borrar` a secas: solo suelta el que tiene el token.
  const { fetchFalso } = armarBackend();
  const mod = await cargarModulo(fetchFalso, 'r5');

  const tokenA = mod.reservar('k', 0.03);
  assert.ok(tokenA);
  await new Promise((r) => setTimeout(r, 50));          // vence la de A
  const tokenB = mod.reservar('k', 300);
  assert.ok(tokenB, 'B toma una reserva nueva y legitima');
  assert.notEqual(tokenA, tokenB, 'cada reserva tiene su propio dueño');

  assert.equal(mod.liberarReserva('k', tokenA), false,
    'A ya no es el dueño: su liberacion tardia no puede tocar la reserva de B');
  assert.equal(mod.reservar('k', 300), null, 'y la de B sigue en pie: C no puede entrar');
  assert.equal(mod.liberarReserva('k', tokenB), true, 'el dueño real si puede soltarla');
});

test('liberarReserva sin token o con clave libre no hace nada ni lanza', async () => {
  const { fetchFalso } = armarBackend();
  const mod = await cargarModulo(fetchFalso, 'r6');
  assert.equal(mod.liberarReserva('nada', null), false);
  assert.equal(mod.liberarReserva('nada', 'token-inventado'), false);
});

test('🔴 [Codex 3a] un GET atrasado NO puede pisar lo que se fusiono mientras viajaba', async () => {
  // `leer()` va a Postgres y, al volver, CACHEA lo que trajo en la memoria local. Si
  // mientras ese GET viajaba alguien escribio, la respuesta vieja pisa lo nuevo — sin
  // error, en silencio.
  //
  // Lo encontro Codex sobre el diseño anterior (donde el informe se armaba juntando el
  // estado entre varias ejecuciones). Ese diseño ya no existe, pero la proteccion se queda:
  // `leer` es de uso general y esta clase de pisada es un defecto suyo, no de su llamador.
  const { disco, fetchFalso } = armarBackend();
  disco.set('p', ['VIEJA']);
  let soltar;
  const lento = async (url, opts = {}) => {
    if ((opts.method || 'GET') !== 'GET') return fetchFalso(url, opts);
    // El GET lee el disco AHORA —como haria la base de datos real al recibir la consulta—
    // y recien despues se cuelga. Si leyera al soltarse veria el PUT que ocurrio mientras
    // tanto y el defecto no se reproduciria: seria un test que se auto-arregla.
    const r = await fetchFalso(url, opts);
    const congelado = await r.json();
    await new Promise((res) => { soltar = res; });
    return { ok: true, json: async () => congelado };
  };
  const mod = await cargarModulo(lento, 'g1');

  const viaje = mod.leer('p');                        // GET en vuelo
  await new Promise((r) => setTimeout(r, 10));
  mod.escribir('p', ['VIEJA', 'A'], 60);                // escritura local mientras el GET viaja
  assert.deepEqual(mod.leerLocal('p'), ['VIEJA', 'A']);

  soltar();                                            // ahora vuelve el GET viejo
  await viaje;
  assert.deepEqual(mod.leerLocal('p'), ['VIEJA', 'A'],
    'lo que ya estaba en memoria es MAS NUEVO que la respuesta que venia en camino');
});
