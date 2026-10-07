// laminasThermal.test.js — [2026-08-24]
//
// Las láminas son un EXTRA sobre un EXTRA: el informe ya es un extra sobre la cotización.
// Entonces lo que hay que probar no es que se descarguen — es que cuando fallan NO se
// llevan puesto nada, y que lo que se afirma sobre ellas es sostenible.
//
// Verificados matando el mutante.

import test from 'node:test';
import assert from 'node:assert/strict';
import { descargarLaminas, perfilesConLaminas, laminasParaInforme, perfilLaminasDe, perfilesLaminasDe, perfilDeVentana, laminaTermopanel, elegirPerfilTermopanel, esPng, IDS_POR_DEFECTO } from './laminasThermal.js';

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
    await laminasParaInforme({ preferido: 'S60_proyectante', fetchFn: f, log: callado });
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
  const r = await laminasParaInforme({ preferido: 'S60_proyectante', fetchFn: espia(), log: callado });
  assert.equal(r.perfil, 'S60_proyectante');
  assert.equal(r.nombre, 'S60 proyectante WinHouse');
  assert.equal(r.aprobadoPor, 'Marcelo Cifuentes');
  assert.equal(r.fecha, '2026-08-19');
  assert.equal(r.laminas.length, 2, 'las 2 del set por defecto: 07 y 08');
});

test('sin perfiles publicados devuelve vacío, sin romper', async () => {
  const r = await laminasParaInforme({ preferido: 'S60_proyectante', fetchFn: espia({ lista: { n: 0, perfiles: [] } }), log: callado });
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

// ── La lamina del termopanel (perfil aparte) ──────────────────────────────────────────

test('laminaTermopanel: la trae cuando THERMAL publica el perfil', async () => {
  const lista = { n: 2, perfiles: [
    LISTA_OK.perfiles[0],
    { perfil: 'termopanel_4-12-4', nombre_comercial: 'Termopanel 4-12-4 · borde ALUMINIO vs WARM-EDGE',
      n_laminas: 1, aprobado_por: 'Marcelo Cifuentes', fecha_aprobacion: '2026-08-24' },
  ] };
  const r = await laminaTermopanel({ fetchFn: espia({ lista }), log: callado });
  assert.equal(r.perfil, 'termopanel_4-12-4');
  assert.match(r.nombre, /Termopanel 4-12-4/);
  assert.ok(esPng(r.lamina.png));
});

test('🔒 laminaTermopanel: hasta que THERMAL deployee el perfil, devuelve null SIN ruido', async () => {
  // Es el caso NORMAL en produccion hasta que el dueno mergee la rama de THERMAL. Loguearlo
  // cada 5 minutos entrenaria a ignorar el log.
  const avisos = [];
  const r = await laminaTermopanel({ fetchFn: espia(), log: (m) => avisos.push(m) });
  assert.equal(r, null);
  assert.equal(avisos.length, 0, 'perfil ausente = silencio, no error');
});

test('laminaTermopanel: THERMAL caido -> null, nunca lanza', async () => {
  const r = await laminaTermopanel({ fetchFn: async () => { throw new Error('ECONNREFUSED'); }, log: callado });
  assert.equal(r, null);
});

// ── [#394] La eleccion del perfil por el vidrio del cliente ──────────────────────────

const PERFILES_394 = [
  { perfil: 'S60_proyectante' },
  { perfil: 'termopanel_4-12-4' },
  { perfil: 'termopanel_DVH_4-12-4' },
  { perfil: 'termopanel_DVH_4-12-4_LOWE_KGLASS' },
  { perfil: 'termopanel_DVH_5-12-5' },
  { perfil: 'termopanel_DVH_4-16Ar-4_KGLASS' },
  { perfil: 'termopanel_DVH_4-16Ar-4_OPTITHERM_S1PLUS' },
  { perfil: 'termopanel_DVH_4-16Ar-4_WINHOUSE_CERTIFICADO' },
];

test('🔎 [#394] el vidrio del cliente elige SU lamina: 5+12+5 -> la del 5-12-5', () => {
  const r = elegirPerfilTermopanel(PERFILES_394, '5+12+5 incoloro');
  assert.equal(r.perfil, 'termopanel_DVH_5-12-5');
});

test('🔎 [#394] low-e desempata: 4+12+4 low-e -> la LOWE, 4+12+4 pelado -> la comun', () => {
  assert.equal(elegirPerfilTermopanel(PERFILES_394, '4+12+4 low-e').perfil,
    'termopanel_DVH_4-12-4_LOWE_KGLASS');
  const pelado = elegirPerfilTermopanel(PERFILES_394, '4+12+4');
  // '4124' matchea la DVH_4-12-4 y la generica no-DVH; cualquiera de las dos es correcta
  // mientras NO sea la low-e.
  assert.ok(!/LOWE/i.test(pelado.perfil), 'sin low-e en el pedido no puede salir la low-e');
});

test('🏆 [#394] entre tres variantes 4-16Ar-4 low-e gana la CERTIFICADA', () => {
  const r = elegirPerfilTermopanel(PERFILES_394, '4+16+4 low-e argon');
  assert.equal(r.perfil, 'termopanel_DVH_4-16Ar-4_WINHOUSE_CERTIFICADO');
});

test('🔒 [#394] el 1 de S1PLUS no envenena los espesores (regex DVH, no digitos sueltos)', () => {
  // digitos('...OPTITHERM_S1PLUS') seria '41641' con un digitos() ingenuo y no matchearia
  // nunca — o peor, matchearia mal. El regex del codigo DVH lo aisla.
  const solo = [{ perfil: 'termopanel_DVH_4-16Ar-4_OPTITHERM_S1PLUS' }];
  const r = elegirPerfilTermopanel(solo, '4+16+4 low-e');
  assert.equal(r.perfil, 'termopanel_DVH_4-16Ar-4_OPTITHERM_S1PLUS');
});

test('↩️ [#394] vidrio sin lamina propia cae a la generica 4-12-4', () => {
  const r = elegirPerfilTermopanel(PERFILES_394, '10+20+10 triple');
  assert.equal(r.perfil, 'termopanel_4-12-4');
});

test('sin glassLabel tambien cae a la generica', () => {
  assert.equal(elegirPerfilTermopanel(PERFILES_394, '').perfil, 'termopanel_4-12-4');
});

test('sin ningun perfil termopanel devuelve null', () => {
  assert.equal(elegirPerfilTermopanel([{ perfil: 'S60_proyectante' }], '4+12+4'), null);
});


// ─────────────────────────────────────────────────────────────────────────────────────────
// 🔴 [2026-10-07] LAS LÁMINAS SON DEL PERFIL COTIZADO. Antes se pedían sin decir qué se cotizó
// y se tomaba el primer perfil publicado (el S60, por orden alfabético): un cliente de corredera
// habría recibido las isotermas de una proyectante. Decisión del dueño (07-oct): "sin láminas
// antes que láminas de otro perfil". Estos tests defienden esa decisión, no la implementación.
// ─────────────────────────────────────────────────────────────────────────────────────────

const LISTA_DOS = {
  n: 2,
  perfiles: [
    { perfil: 'S60_proyectante', nombre_comercial: 'S60 proyectante WinHouse', aprobado_por: 'Marcelo Cifuentes', fecha_aprobacion: '2026-08-19' },
    { perfil: 'Sliding_H98', nombre_comercial: 'Corredera S75 Hoja 98 (H98)', aprobado_por: 'Marcelo Cifuentes', fecha_aprobacion: '2026-10-07' },
  ],
};
const claves = (r) => r.grupos.map((g) => `${g.perfil}:${g.propio ? 'propio' : 'ref'}`);

test('🔴 corredera H98 cotizada → SOLO sus láminas, como PROPIAS (descarga real de los 3 nudos)', async () => {
  const f = espia({ lista: LISTA_DOS });
  const r = await laminasParaInforme({ perfiles: ['Sliding_H98'], desconocidas: false, fetchFn: f, log: callado });
  assert.deepEqual(claves(r), ['Sliding_H98:propio']);
  assert.equal(r.referencial, false);
  assert.deepEqual(r.grupos[0].laminas.map((l) => l.id), ['01', '02', '03']);
  assert.ok(f.llamadas.every((l) => !l.url.includes('/lamina/S60_proyectante/')), 'no baja figuras de otro perfil');
});

test('🔴 proyecto MIXTO (S60 + H98) → los DOS como propios, ninguno de referencia', async () => {
  const r = await laminasParaInforme({ perfiles: ['Sliding_H98', 'S60_proyectante'], desconocidas: false,
    fetchFn: espia({ lista: LISTA_DOS }), log: callado });
  assert.deepEqual(claves(r), ['Sliding_H98:propio', 'S60_proyectante:propio']);
  assert.equal(r.referencial, false);
});

test('🔴 perfil del cliente NO modelado → AMBOS perfiles como REFERENCIA (decisión del dueño)', async () => {
  const r = await laminasParaInforme({ perfiles: [], desconocidas: true, fetchFn: espia({ lista: LISTA_DOS }), log: callado });
  assert.deepEqual(claves(r), ['S60_proyectante:ref', 'Sliding_H98:ref']);
  assert.equal(r.referencial, true);
});

test('🔴 proyecto con H98 + una ventana sin modelo → H98 propia y S60 de referencia', async () => {
  const r = await laminasParaInforme({ perfiles: ['Sliding_H98'], desconocidas: true, fetchFn: espia({ lista: LISTA_DOS }), log: callado });
  assert.deepEqual(claves(r), ['Sliding_H98:propio', 'S60_proyectante:ref']);
});

test('🔴 perfil cotizado que THERMAL no publica → referencia, nunca "propio"', async () => {
  const r = await laminasParaInforme({ preferido: 'Sliding_H98', fetchFn: espia(), log: callado });
  assert.deepEqual(claves(r), ['S60_proyectante:ref']);
  assert.equal(r.referencial, true);
});

test('⏱️ plazo vencido → no se baja nada y no se cuelga', async () => {
  const r = await laminasParaInforme({ perfiles: ['Sliding_H98'], hasta: Date.now() - 1, fetchFn: espia({ lista: LISTA_DOS }), log: callado });
  assert.deepEqual(r.grupos, []);
});

test('📦 tope de bytes del CONJUNTO: el segundo perfil no puede sumar por encima del tope global', async () => {
  const previo = process.env.THERMAL_LAMINAS_MAX_BYTES_TOTAL;
  process.env.THERMAL_LAMINAS_MAX_BYTES_TOTAL = String(3 * 224);   // 3 PNG falsos de 224 bytes
  try {
    const r = await laminasParaInforme({ perfiles: [], desconocidas: true, fetchFn: espia({ lista: LISTA_DOS }), log: callado });
    const total = r.grupos.reduce((a, g) => a + g.laminas.reduce((b, l) => b + l.bytes, 0), 0);
    assert.ok(total <= 3 * 224, `total ${total} supera el tope global`);
  } finally {
    if (previo === undefined) delete process.env.THERMAL_LAMINAS_MAX_BYTES_TOTAL; else process.env.THERMAL_LAMINAS_MAX_BYTES_TOTAL = previo;
  }
});

test('perfilDeVentana: mapeo por SERIE y HOJA, no por una palabra suelta (Codex r5)', () => {
  assert.equal(perfilDeVentana({ producto: 'Proyectante S60' }), 'S60_proyectante');
  assert.equal(perfilDeVentana({ producto: 'Ventana proyectante' }), '', 'proyectante SIN serie no se declara S60');
  assert.equal(perfilDeVentana({ producto: 'Proyectante Americana' }), '');
  assert.equal(perfilDeVentana({ producto: 'Corredera SLIDING H98 Doble Riel S75' }), 'Sliding_H98');
  // [Codex r13] Rótulos CANÓNICOS EXACTOS: 'Corredera S75' no es un rótulo del motor para la H98 => referencia (fail-closed).
  assert.equal(perfilDeVentana({ producto: 'Corredera S75', hoja_mm: 98 }), '', 'rótulo no canónico');
  assert.equal(perfilDeVentana({ producto: 'Corredera SLIDING H80' }), '');
  assert.equal(perfilDeVentana({ producto: 'Corredera S60', hoja_mm: 98 }), '', 'corredera S60 no es la S75');
  assert.equal(perfilDeVentana({ producto: 'Corredera Andes Doble Riel 66' }), '');
  assert.equal(perfilDeVentana({ producto: 'Ventana fija' }), '');
});

test('perfilesLaminasDe: proyecto completo, ordenado por unidades, y marca las ventanas sin modelo', () => {
  assert.deepEqual(perfilesLaminasDe([
    { producto: 'Proyectante S60', cantidad: 2 },
    { producto: 'Corredera SLIDING H98 Doble Riel S75', cantidad: 5 },
  ]), { perfiles: ['Sliding_H98', 'S60_proyectante'], desconocidas: false });
  assert.deepEqual(perfilesLaminasDe([{ producto: 'Ventana fija' }]), { perfiles: [], desconocidas: true });
  assert.deepEqual(perfilesLaminasDe([]), { perfiles: [], desconocidas: true });
  assert.equal(perfilLaminasDe([{ producto: 'Proyectante S60' }]), 'S60_proyectante');
});

test('⏱️ el LISTADO también respeta el plazo: un THERMAL lento no estira el informe (Codex r6)', async () => {
  const lento = async (url, o) => new Promise((res, rej) => {
    const t = setTimeout(() => res({ ok: true, status: 200, json: async () => LISTA_DOS }), 2000);
    o?.signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('abort'), { name: 'AbortError' })); });
  });
  const t0 = Date.now();
  const r = await laminasParaInforme({ perfiles: ['Sliding_H98'], hasta: Date.now() + 80, fetchFn: lento, log: callado });
  assert.ok(Date.now() - t0 < 1000, `tardó ${Date.now() - t0} ms con plazo de 80 ms`);
  assert.deepEqual(r.grupos, []);
});

test('perfilDeVentana: H98 exige la línea SLIDING/S75; un rótulo genérico no tapa al detallado (Codex r6)', () => {
  assert.equal(perfilDeVentana({ producto: 'Corredera', hoja_mm: 98 }), '', 'corredera de hoja 98 sin serie: no se declara H98');
  assert.equal(perfilDeVentana({ producto: 'Ventana corredera 2 hojas', producto_label: 'Corredera SLIDING H98 Doble Riel S75' }),
    'Sliding_H98', 'el label detallado no lo tapa un producto genérico');
});

test('🔴 perfilDeVentana NO arma una identidad con pedazos de rótulos ni con rótulos contradictorios (Codex r7)', () => {
  assert.equal(perfilDeVentana({ producto_label: 'Proyectante', producto: 'S60' }), '');
  assert.equal(perfilDeVentana({ producto_label: 'Corredera', producto: 'S75', product: 'H98' }), '');
  assert.equal(perfilDeVentana({ producto_label: 'Corredera SLIDING H98 Doble Riel S75', producto: 'Proyectante S60' }), '',
    'contradicción: no se declara ninguno');
  assert.equal(perfilDeVentana({ producto_label: 'Proyectante S60', producto: 'Proyectante S60' }), 'S60_proyectante');
});

test('🔴 H98 contra un rótulo de OTRA línea no modelada (ANDES/monorriel/S60/H80) => sin perfil propio (Codex r8)', () => {
  const h98 = 'Corredera SLIDING H98 Doble Riel S75';
  for (const otro of ['Corredera ANDES monorriel', 'Corredera S60', 'Corredera SLIDING H80', 'Proyectante Americana']) {
    assert.equal(perfilDeVentana({ producto_label: h98, producto: otro }), '', `${otro} contradice al H98`);
  }
  assert.equal(perfilDeVentana({ producto_label: h98, producto: 'Ventana corredera 2 hojas' }), 'Sliding_H98',
    'un rótulo genérico no contradice');
});

test('🔴 contradicciones de HOJA y dentro de un MISMO rótulo => sin perfil propio (Codex r9)', () => {
  assert.equal(perfilDeVentana({ hoja_mm: 98, producto_label: 'Corredera SLIDING H98 Doble Riel S75', producto: 'Corredera SLIDING H80' }), '');
  assert.equal(perfilDeVentana({ hoja_mm: 80, producto_label: 'Corredera SLIDING H98 Doble Riel S75' }), '');
  assert.equal(perfilDeVentana({ producto_label: 'Corredera SLIDING H98 Doble Riel S75 Americana' }), '');
  assert.equal(perfilDeVentana({ producto_label: 'Corredera SLIDING H98 H80' }), '');
  assert.equal(perfilDeVentana({ producto_label: 'Corredera SLIDING H98 S60' }), '');
  assert.equal(perfilDeVentana({ producto_label: 'Proyectante S60 Americana' }), '');
  assert.equal(perfilDeVentana({ producto_label: 'Proyectante S60 S75' }), '');
  // y los positivos legítimos siguen funcionando
  assert.equal(perfilDeVentana({ hoja_mm: 98, producto_label: 'Corredera SLIDING H98 Doble Riel S75' }), 'Sliding_H98');
  assert.equal(perfilDeVentana({ producto_label: 'Proyectante S60' }), 'S60_proyectante');
});

test('🔴 contradicción de APERTURA (también con sinónimos) => sin perfil propio (Codex r10)', () => {
  const h98 = 'Corredera SLIDING H98 Doble Riel S75';
  assert.equal(perfilDeVentana({ producto_label: h98, producto: 'Proyectante' }), '');
  assert.equal(perfilDeVentana({ producto_label: 'Proyectante S60', producto: 'Ventana deslizante' }), '');
  assert.equal(perfilDeVentana({ producto_label: 'Proyectante S60 corrediza' }), '');
  assert.equal(perfilDeVentana({ producto_label: h98, producto: 'Ventana fija' }), '');
  assert.equal(perfilDeVentana({ producto_label: 'Proyectante S60', producto: 'Puerta' }), '');
  // sinónimos COMPATIBLES no anulan
  assert.equal(perfilDeVentana({ producto_label: h98, producto: 'Ventana corrediza 2 hojas' }), 'Sliding_H98');
  assert.equal(perfilDeVentana({ producto_label: 'Proyectante S60', producto: 'Ventana proyectante' }), 'S60_proyectante');
});

test('🔴 LISTA BLANCA: una sola palabra desconocida, otra serie o un truco de escritura anula (prueba adversarial 07-oct)', () => {
  const malos = ['Proyectante S60 aluminio', 'Proyectante S60 M70', 'Proyectante S60 H 98', 'Proyectante S60 Serie 75',
    'Proyectante S60 tilt', 'Proyectante S60 Americano', 'Proyectante S60 Аndes', 'Proyectante S60 Ame­ricana',
    'Proyectante S60 Puérta', 'Proyectante S60 ａｎｄｅｓ'];
  for (const m of malos) assert.equal(perfilDeVentana({ producto_label: m }), '', m);
  const h98 = 'Corredera SLIDING H98 Doble Riel S75';
  for (const m of ['Corredera SLIDING S75 H 80', 'Corredera SLIDING S75 H-80', 'Corredera Sliding H98 Serie 60',
    'Corredera SLIDING H98 S75 M70', 'Corredera Sliding H98 Mono-riel', 'Corredera Sliding H98 aluminio']) {
    assert.equal(perfilDeVentana({ producto_label: m, hoja_mm: 98 }), '', m);
  }
  assert.equal(perfilDeVentana({ producto_label: 'Proyectante S60', product: 'M70' }), '');
  assert.equal(perfilDeVentana({ producto_label: 'Proyectante S60', product: 'Ventana en esquina' }), '');
  assert.equal(perfilDeVentana({ producto_label: 'Proyectante S60', hoja_mm: 98 }), '', 'una proyectante no trae hoja');
  assert.equal(perfilDeVentana({ producto_label: h98, label: 'Corredera ANDES 54' }), '', 'label tambien se lee');
  assert.equal(perfilDeVentana({ producto_label: h98, hoja_mm: '98 mm' }), '', 'hoja ilegible: no se adivina');
  assert.equal(perfilDeVentana({ producto_label: 'Proyectante S60', partes: [{ tipo: 'FIJO' }] }), '', 'compuesta');
  assert.equal(perfilDeVentana({ producto_label: 'Proyectante S60', product: 'Ventana 2 hojas' }), '', 'hojas no es de proyectante');
  // positivos legítimos
  assert.equal(perfilDeVentana({ producto_label: h98, hoja_mm: 98 }), 'Sliding_H98');
  assert.equal(perfilDeVentana({ producto_label: 'PROYECTANTE S60' }), 'S60_proyectante');
  assert.equal(perfilDeVentana({ producto_label: h98, producto: 'Ventana PVC' }), 'Sliding_H98');
});

test('🔴 Codex r12: rótulos crudos (_perfil) mandan, hoja estricta, triple hoja sí / triple riel no, deslizante', () => {
  // el webhook reduce el rótulo a uno solo; _perfil trae TODOS y una compuesta debe anular
  assert.deepEqual(perfilesLaminasDe([{ producto: 'Proyectante S60',
    _perfil: { producto_label: 'Proyectante S60', product: 'CORREDERA', compuesta: { partes: [{ tipo: 'FIJA' }] } } }]),
  { perfiles: [], desconocidas: true });
  const h98 = 'Corredera SLIDING H98 Doble Riel S75';
  assert.equal(perfilDeVentana({ producto_label: 'Corredera S75', hoja_mm: '0x62' }), '', 'coerción hexadecimal');
  assert.equal(perfilDeVentana({ producto_label: h98, hoja_mm: '   ' }), '', 'hoja en blanco');
  assert.equal(perfilDeVentana({ producto_label: h98, hoja_mm: '98' }), 'Sliding_H98');
  assert.equal(perfilDeVentana({ producto_label: `${h98} — Triple hoja (central fija, laterales correderas)`, hoja_mm: 98 }),
    'Sliding_H98', 'la triple hoja en doble riel es el mismo sistema modelado');
  assert.equal(perfilDeVentana({ producto_label: 'Corredera SLIDING H98 Triple Riel S75', hoja_mm: 98 }), '', 'triple riel es otra geometría');
  assert.equal(perfilDeVentana({ producto_label: h98, product: 'Ventana deslizante' }), 'Sliding_H98');
});

test('🔴 corredera H98 "fija" sin ser la triple hoja => sin perfil (prueba adversarial)', () => {
  assert.equal(perfilDeVentana({ producto_label: 'Corredera SLIDING H98 S75 fija', hoja_mm: 98 }), '');
});

test('🔴 Codex r13: SOLO rótulos canónicos exactos; variantes de riel/fija/coerciones/no-texto anulan', () => {
  for (const m of ['Corredera SLIDING H98 S75 triple fija', 'Corredera SLIDING H98 S75 riel triple', 'Corredera SLIDING H98 S75 3 riel']) {
    assert.equal(perfilDeVentana({ producto_label: m, hoja_mm: 98 }), '', m);
  }
  const h98 = 'Corredera SLIDING H98 Doble Riel S75';
  assert.equal(perfilDeVentana({ producto_label: h98, description: 'Proyectante S60' }), '');
  assert.equal(perfilDeVentana({ producto_label: h98, panos: [{ tipo: 'FIJO' }] }), '');
  assert.equal(perfilDeVentana({ producto_label: h98, hoja_mm: '98.0' }), '');
  assert.equal(perfilDeVentana({ producto_label: h98, hoja_mm: [98] }), '');
  assert.equal(perfilDeVentana({ producto_label: h98, tipo: { valor: 'ANDES' } }), '');
  assert.equal(perfilDeVentana({ producto_label: h98, corredera: { hojas: 3, riel: 'TRIPLE' } }), '');
  // el ítem real del motor (tipo/serie/corredera estructurada) sigue siendo H98
  assert.equal(perfilDeVentana({ producto_label: h98, tipo: 'CORREDERA', serie: 'S75', hoja_mm: 98,
    corredera: { hojas: 3, riel: 'DOBLE' } }), 'Sliding_H98');
  assert.equal(perfilDeVentana({ producto_label: 'Proyectante S60', tipo: 'PROYECTANTE', serie: 'S60' }), 'S60_proyectante');
  // y por el camino del webhook (_perfil = ítem completo)
  assert.deepEqual(perfilesLaminasDe([{ producto: h98, _perfil: { producto_label: h98, description: 'Proyectante S60' } }]),
    { perfiles: [], desconocidas: true });
});

test('🔴 Codex r14: corredera estructurada incompleta, hoja 0 explícita => sin perfil; "H 98"/"Serie 75" se reconocen', () => {
  const h98 = 'Corredera SLIDING H98 Doble Riel S75';
  for (const c of [{}, { hojas: 2 }, { riel: 'DOBLE' }, false, { hojas: [3], riel: 'DOBLE' }, { hojas: 3, riel: 'DOBLE', x: 1 }, { hojas: 4, riel: 'DOBLE' }]) {
    assert.equal(perfilDeVentana({ producto_label: h98, corredera: c }), '', JSON.stringify(c));
  }
  assert.equal(perfilDeVentana({ producto_label: h98, corredera: { hojas: 3, riel: 'DOBLE' } }), 'Sliding_H98');
  for (const hm of [0, '00', '000']) {
    assert.equal(perfilDeVentana({ producto_label: h98, hoja_mm: hm }), '', `H98 hoja ${hm}`);
    assert.equal(perfilDeVentana({ producto_label: 'Proyectante S60', hoja_mm: hm }), '', `S60 hoja ${hm}`);
  }
  assert.equal(perfilDeVentana({ producto_label: 'Corredera SLIDING H 98 Doble Riel Serie 75' }), 'Sliding_H98');
  assert.equal(perfilDeVentana({ producto_label: 'Corredera SLIDING H-98 Doble Riel S-75' }), 'Sliding_H98');
});

test('🔴 Codex r15: CUALQUIER campo que describa la ventana (apertura, uno nuevo) contradice', () => {
  const base = { producto_label: 'Corredera SLIDING H98 Doble Riel S75', tipo: 'CORREDERA', serie: 'S75', hoja_mm: 98,
    corredera: { hojas: 2, riel: 'DOBLE' }, measures: '3000x2000', glass_label: 'DVH 5/12/5', qty: 1, unit_price: 1 };
  assert.equal(perfilDeVentana(base), 'Sliding_H98', 'el ítem real del motor sigue valiendo');
  assert.equal(perfilDeVentana({ ...base, apertura: 'FIJA' }), '');
  assert.equal(perfilDeVentana({ ...base, apertura: 'PROYECTANTE' }), '');
  assert.equal(perfilDeVentana({ ...base, linea: 'ANDES' }), '', 'un campo nuevo también se lee');
  assert.equal(perfilDeVentana({ ...base, apertura: 'CORREDERA' }), 'Sliding_H98');
});

test('🔴 Codex r15: la cobertura incompleta se conserva aunque falle la descarga de referencia', async () => {
  const f = async (url) => {
    if (url.includes('/api/v1/laminas')) return { ok: true, status: 200, json: async () => LISTA_DOS };
    if (url.includes('/S60_proyectante/')) return { ok: false, status: 503 };
    const png = pngFalso();
    return { ok: true, status: 200, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.length) };
  };
  const r = await laminasParaInforme({ perfiles: ['Sliding_H98'], desconocidas: true, fetchFn: f, log: callado });
  assert.deepEqual(r.grupos.map((g) => g.perfil), ['Sliding_H98']);
  assert.equal(r.coberturaIncompleta, true);
});
