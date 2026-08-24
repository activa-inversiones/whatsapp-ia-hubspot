// laminasThermal.test.js — [2026-08-24]
//
// Las láminas son un EXTRA sobre un EXTRA: el informe ya es un extra sobre la cotización.
// Entonces lo que hay que probar no es que se descarguen — es que cuando fallan NO se
// llevan puesto nada, y que lo que se afirma sobre ellas es sostenible.
//
// Verificados matando el mutante.

import test from 'node:test';
import assert from 'node:assert/strict';
import { descargarLaminas, perfilesConLaminas, laminasParaInforme, esPng, IDS_POR_DEFECTO } from './laminasThermal.js';

/** Un PNG mínimo VÁLIDO: firma + IHDR con ancho/alto. */
function pngFalso(ancho = 100, alto = 50, relleno = 200) {
  const b = Buffer.alloc(24 + relleno);
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(b, 0);
  b.writeUInt32BE(ancho, 16);
  b.writeUInt32BE(alto, 20);
  return b;
}

const LISTA_OK = {
  n: 1,
  perfiles: [{
    perfil: 'S60_proyectante', nombre_comercial: 'S60 proyectante WinHouse',
    n_laminas: 9, n_para_cliente: 7,
    aprobado_por: 'Marcelo Cifuentes', fecha_aprobacion: '2026-08-19',
  }],
};

function espia({ lista = LISTA_OK, png = pngFalso(), ok = true, status = 200 } = {}) {
  const llamadas = [];
  const f = async (url, opts) => {
    llamadas.push({ url, headers: opts?.headers || {} });
    if (url.includes('/api/v1/laminas')) {
      return { ok, status, json: async () => lista };
    }
    return { ok, status, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.length) };
  };
  f.llamadas = llamadas;
  return f;
}

const callado = () => {};

// ── Lo que NO puede pasar nunca ───────────────────────────────────────────────────────

test('🔒 si THERMAL no contesta, devuelve [] — el informe sale sin figuras, no se rompe', async () => {
  const r = await descargarLaminas('S60_proyectante', {
    fetchFn: async () => { throw new Error('ECONNREFUSED'); }, log: callado,
  });
  assert.deepEqual(r, []);
});

test('🔒 un timeout tampoco lanza', async () => {
  const r = await descargarLaminas('S60_proyectante', {
    fetchFn: async () => { const e = new Error('abort'); e.name = 'AbortError'; throw e; }, log: callado,
  });
  assert.deepEqual(r, []);
});

test('🔴 si THERMAL devuelve algo que NO es un PNG, se descarta — no se le pasa a pdfkit', async () => {
  // Un JSON de error con HTTP 200 metido en doc.image() revienta la generacion ENTERA:
  // el cliente se quedaria sin informe por culpa de un adorno.
  const basura = Buffer.from('{"error":"algo salio mal"}');
  const r = await descargarLaminas('S60_proyectante', {
    ids: ['10'],
    fetchFn: async () => ({ ok: true, status: 200, arrayBuffer: async () => basura.buffer.slice(basura.byteOffset, basura.byteOffset + basura.length) }),
    log: callado,
  });
  assert.deepEqual(r, [], 'sin firma PNG no entra al PDF');
});

test('una lámina que falla NO cancela a las demás', async () => {
  let n = 0;
  const f = async (url) => {
    n++;
    if (url.endsWith('/01')) return { ok: false, status: 500 };
    const p = pngFalso();
    return { ok: true, status: 200, arrayBuffer: async () => p.buffer.slice(p.byteOffset, p.byteOffset + p.length) };
  };
  const r = await descargarLaminas('S60_proyectante', { ids: ['10', '01', '02'], fetchFn: f, log: callado });
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((x) => x.id), ['10', '02']);
});

test('🔒 sin perfil no se pide nada (no se inventa una ruta)', async () => {
  const f = espia();
  const r = await descargarLaminas('', { fetchFn: f, log: callado });
  assert.deepEqual(r, []);
  assert.equal(f.llamadas.length, 0);
});

// ── El techo de peso: el PDF viaja por WhatsApp ───────────────────────────────────────

test('🔒 respeta el techo de bytes y CORTA, no manda un adjunto gigante', async () => {
  const grande = pngFalso(100, 50, 400_000);
  const f = async () => ({ ok: true, status: 200, arrayBuffer: async () => grande.buffer.slice(grande.byteOffset, grande.byteOffset + grande.length) });
  const avisos = [];
  const r = await descargarLaminas('S60_proyectante', {
    ids: ['10', '01', '02'], fetchFn: f, maxBytes: 500_000, log: (m) => avisos.push(m),
  });
  assert.equal(r.length, 1, 'entra una sola y se corta');
  assert.ok(avisos.some((a) => /techo/i.test(a)), 'el corte se dice, no se silencia');
});

// ── La API key (mismo criterio que informeTermico) ────────────────────────────────────

test('🔴 [Codex] el techo se mira ANTES de bajar el PNG, no despues', async () => {
  // Hallazgo de Codex en la compuerta: el tope de bytes se controlaba DESPUES de
  // materializar la respuesta entera con arrayBuffer(). O sea, protegia el tamaño del PDF
  // pero NO la memoria: una lamina gigante se bajaba completa y recien ahi se descartaba.
  // Ahora, si el servidor declara Content-Length y no entra, ni se descarga.
  let bajadas = 0;
  const grande = pngFalso(100, 50, 900_000);
  const f = async () => ({
    ok: true, status: 200,
    headers: { get: (k) => (k.toLowerCase() === 'content-length' ? String(grande.length) : null) },
    arrayBuffer: async () => { bajadas++; return grande.buffer.slice(grande.byteOffset, grande.byteOffset + grande.length); },
  });
  const avisos = [];
  const r = await descargarLaminas('S60_proyectante', {
    ids: ['10'], fetchFn: f, maxBytes: 100_000, log: (m) => avisos.push(m),
  });
  assert.deepEqual(r, []);
  assert.equal(bajadas, 0, 'no se baja a memoria algo que ya sabemos que no entra');
  assert.ok(avisos.some((a) => /techo/i.test(a)));
});

test('sin Content-Length el techo igual se aplica despues de bajar (red de seguridad)', async () => {
  const grande = pngFalso(100, 50, 900_000);
  const f = async () => ({
    ok: true, status: 200, headers: { get: () => null },
    arrayBuffer: async () => grande.buffer.slice(grande.byteOffset, grande.byteOffset + grande.length),
  });
  const r = await descargarLaminas('S60_proyectante', { ids: ['10'], fetchFn: f, maxBytes: 100_000, log: callado });
  assert.deepEqual(r, [], 'el control post-descarga sigue existiendo');
});

test('🔑 manda X-API-Key en la lista y en cada descarga', async () => {
  const previo = process.env.THERMAL_API_KEY;
  process.env.THERMAL_API_KEY = 'clave-prueba';
  try {
    const f = espia();
    await laminasParaInforme({ fetchFn: f, log: callado });
    assert.ok(f.llamadas.length >= 2);
    for (const l of f.llamadas) assert.equal(l.headers['X-API-Key'], 'clave-prueba');
  } finally {
    if (previo === undefined) delete process.env.THERMAL_API_KEY; else process.env.THERMAL_API_KEY = previo;
  }
});

test('🔴 un 401 al listar GRITA que falta la key', async () => {
  const avisos = [];
  const r = await perfilesConLaminas({
    fetchFn: async () => ({ ok: false, status: 401 }), log: (m) => avisos.push(m),
  });
  assert.deepEqual(r, []);
  assert.match(avisos[0] || '', /THERMAL_API_KEY/);
});

// ── El orden importa: la que vende va primera ─────────────────────────────────────────

test('🔥 el set por defecto es SOLO la comparacion aluminio vs warm-edge (07 y 08)', async () => {
  // Dos decisiones del dueno, en orden: primero bajo los cortes completos (01/02) — "a esta
  // le falta todo" — y despues, al verificar que los nudos 03/04 tambien tienen defectos
  // (burletes en espejo 106 vs 17 mm2, termopanel sin cerrar en la base — tablero #393b),
  // dejo SOLO la pareja que compara separadores: "usa las graficas de thermoflex warm edge
  // y de aluminio, solo dejar esas". No se agrega ninguna otra sin que el autor de las
  // laminas la de por buena.
  assert.deepEqual(IDS_POR_DEFECTO, ['07', '08']);
  for (const id of ['01', '02', '03', '04', '10']) {
    assert.ok(!IDS_POR_DEFECTO.includes(id), `la lamina ${id} quedo fuera por decision del evaluador que firma`);
  }
});

test('laminasParaInforme devuelve el perfil rotulado, no solo las imágenes', async () => {
  // El PDF TIENE que poder decir de que perfil es la figura. Mostrar un corte sin decir
  // cual es deja que el cliente asuma que es su ventana, y eso seria afirmar algo que
  // THERMAL explicitamente no respalda (las manda con X-No-Declarable: true).
  const r = await laminasParaInforme({ fetchFn: espia(), log: callado });
  assert.equal(r.perfil, 'S60_proyectante');
  assert.equal(r.nombre, 'S60 proyectante WinHouse');
  assert.equal(r.aprobadoPor, 'Marcelo Cifuentes');
  assert.equal(r.fecha, '2026-08-19');
  assert.equal(r.laminas.length, 2, 'las 2 del set por defecto: 07 y 08');
});

test('sin perfiles publicados devuelve vacío, sin romper', async () => {
  const r = await laminasParaInforme({ fetchFn: espia({ lista: { n: 0, perfiles: [] } }), log: callado });
  assert.equal(r.perfil, null);
  assert.deepEqual(r.laminas, []);
});

test('esPng reconoce la firma real y rechaza cualquier otra cosa', () => {
  assert.equal(esPng(pngFalso()), true);
  assert.equal(esPng(Buffer.from('no soy una imagen para nada, ni cerca de serlo')), false);
  assert.equal(esPng(Buffer.alloc(4)), false);
  assert.equal(esPng(null), false);
  assert.equal(esPng('texto'), false);
});
