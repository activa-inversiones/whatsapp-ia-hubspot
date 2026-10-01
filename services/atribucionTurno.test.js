// Política ÚNICA de falla tras emitir (reordenamiento 30-sep): si el folio no se pudo guardar durable
// en la carpeta del cliente, la atribución NO se consume y se le avisa a quien cotiza.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trasEmitir } from './atribucionTurno.js';
import { fijar, obtener, _resetAtribuciones } from './atribucionStore.js';

const V = '56911110000';
const J = '56987654321';

function turnoCon(a) { return { quienEscribe: V, cliente: J, atribucion: a, _trasEmitirHecho: false }; }

test('r16 #4: ATRIBUCION_VIGENCIA_MS no numérico, 0 o negativo → la vigencia por defecto (2 h)', async () => {
  const { vigenciaMs } = await import('./atribucionStore.js');
  const prev = process.env.ATRIBUCION_VIGENCIA_MS;
  try {
    for (const malo of ['abc', '0', '-5', 'Infinity', '']) {
      process.env.ATRIBUCION_VIGENCIA_MS = malo;
      assert.equal(vigenciaMs(), 2 * 60 * 60 * 1000, `"${malo}"`);
    }
    process.env.ATRIBUCION_VIGENCIA_MS = '1000';
    assert.equal(vigenciaMs(), 1000);
  } finally { if (prev === undefined) delete process.env.ATRIBUCION_VIGENCIA_MS; else process.env.ATRIBUCION_VIGENCIA_MS = prev; }
});

test('r16 #5: re-fijar el MISMO cliente con la carpeta activa y la LECTURA falla → mov:error (no seguir sin su folio)', async () => {
  const { alEntrar } = await import('./atribucionTurno.js');
  const turno = { quienEscribe: V, cliente: J, atribucion: { phone: J, name: 'Juan', gen: 99 } };
  const state = { carpeta_activa: J, carpeta_gen: 1 };   // sesión recargada: dice Juan, gen vieja
  const r = await alEntrar({ turno, state, history: [],
    kv: { leer: async () => ({ ok: false }), escribir: async () => ({ ok: true }) } });
  assert.equal(r.mov, 'error');
  assert.ok(r.texto, 'con el texto para quien escribe');
});

test('falla al guardar el folio → NO consume y avisa', async () => {
  _resetAtribuciones();
  const a = fijar(V, J, 'Juan');
  const enviados = [];
  const r = await trasEmitir({ turno: turnoCon(a), state: { last_quote: { quote_number: 'X' } }, history: [],
    kv: { escribir: async () => ({ ok: false, motivo: 'bd' }) }, enviar: async (t) => enviados.push(t) });
  assert.deepEqual(r, { hecho: true, consumida: false });
  assert.equal(obtener(V)?.phone, J, 'sigue cotizando para Juan');
  assert.match(enviados[0], /no pude guardar su folio/);
  _resetAtribuciones();
});

test('guardado OK → consume (misma gen) y manda el mensaje UNA vez por turno', async () => {
  _resetAtribuciones();
  const a = fijar(V, J, 'Juan');
  const enviados = [];
  const turno = turnoCon(a);
  const o = { turno, state: {}, history: [], kv: { escribir: async () => ({ ok: true }) }, enviar: async (t) => enviados.push(t) };
  await trasEmitir(o); await trasEmitir(o);
  assert.equal(obtener(V), null);
  assert.equal(enviados.length, 1);
  _resetAtribuciones();
});
