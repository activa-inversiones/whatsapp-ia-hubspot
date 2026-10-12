// [2026-10-12 · #1500-A r3 · Thermos] LA RUTA DEL LECTOR VIVE EN SU MÓDULO, NO EN index.js.
// index.js (6.862 líneas) solo la registra en una línea: `registrarRutaLector(app, { validInternalOperatorToken })`.
// Hermético: app, auth y lector se inyectan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrarRutaLector, RUTA_LECTOR, TOPE_TEXTO } from './oliverInternoLector.js';

function appFalsa() {
  const rutas = {};
  return { rutas, post: (p, ...fns) => { rutas[p] = fns.at(-1); } };
}
function resFalsa() {
  const r = { codigo: 200, cuerpo: null };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  return r;
}
async function pedir({ auth = true, body, leer }) {
  const app = appFalsa();
  const vistos = [];
  registrarRutaLector(app, { validInternalOperatorToken: () => auth, leer: async (x) => { vistos.push(x); return leer ? leer(x) : { ok: true, lineas: [{ n: 1 }] }; } });
  const h = app.rutas[RUTA_LECTOR];
  assert.ok(h, `registra ${RUTA_LECTOR}`);
  const res = resFalsa();
  await h({ body, get: () => '' }, res);
  return { res, vistos };
}

test('[#1500-A r3] sin token interno válido → 401 y no se lee nada', async () => {
  const { res, vistos } = await pedir({ auth: false, body: { texto: 'x' } });
  assert.equal(res.codigo, 401);
  assert.equal(vistos.length, 0);
});

test('[#1500-A r3] texto vacío → 400; más de 20.000 caracteres → 400 (mismo tope que el cuadro de sales-os)', async () => {
  assert.equal(TOPE_TEXTO, 20000);
  assert.equal((await pedir({ body: { texto: '   ' } })).res.codigo, 400);
  assert.equal((await pedir({ body: { texto: 'x'.repeat(20001) } })).res.codigo, 400);
  assert.equal((await pedir({ body: { texto: 'x'.repeat(20000) } })).res.codigo, 200);
});

test('[#1500-A r3] el texto, la comuna, el color y el nombre llegan al lector recortados; la respuesta vuelve tal cual', async () => {
  const salida = { ok: true, lineas: [{ n: 1 }], bloqueadas: [], sospechosas: [], respuesta: '' };
  const { res, vistos } = await pedir({ body: { texto: '  bow window… ', comuna: ' Angol ', color: 'NOGAL', nombre: ' Mary ' }, leer: async () => salida });
  assert.deepEqual(vistos[0], { texto: 'bow window…', comuna: 'Angol', color: 'NOGAL', nombre: 'Mary' });
  assert.equal(res.codigo, 200);
  assert.deepEqual(res.cuerpo, salida);
});

test('[#1500-A r4 · Thermos] comuna, color y nombre se recortan a 80 caracteres antes de entrar al contexto del LLM', async () => {
  const largo = 'x'.repeat(500);
  const { vistos } = await pedir({ body: { texto: 'una ventana', comuna: largo, color: largo, nombre: largo } });
  assert.equal(vistos[0].comuna.length, 80);
  assert.equal(vistos[0].color.length, 80);
  assert.equal(vistos[0].nombre.length, 80);
});

test('[#1500-A r3] si el lector explota → 500 lector_fallo con detalle corto, nunca un 200 vacío', async () => {
  const { res } = await pedir({ body: { texto: 'x' }, leer: async () => { throw new Error('se cayó el LLM'); } });
  assert.equal(res.codigo, 500);
  assert.equal(res.cuerpo.ok, false);
  assert.equal(res.cuerpo.error, 'lector_fallo');
  assert.match(res.cuerpo.detalle, /se cayó el LLM/);
});
