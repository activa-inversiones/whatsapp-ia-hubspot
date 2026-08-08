// atribucionCotizacion.test.js — [2026-08-08]
// El dueño cotiza a Oliver para clientes que le hablan directo. Sin esto, el lead quedaba
// con SU teléfono: el seguimiento automático nunca le llegaba al cliente, la atribución de
// ads se ensuciaba, y en /mi-agenda aparecía él en vez del cliente.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseComandoCliente, normalizar, fijar, obtener, limpiar, _reset } from './atribucionCotizacion.js';

test('parsea nombre y teléfono en cualquier formato chileno', () => {
  const casos = [
    'CLIENTE Juan Pérez +56912345678',
    'cliente Juan Pérez 56912345678',
    'CLIENTE Juan Pérez +56 9 1234 5678',
    'Cliente  Juan Pérez  9-1234-5678',
  ];
  for (const t of casos) {
    const r = parseComandoCliente(t);
    assert.ok(r.ok, `no parseó: ${t}`);
    assert.equal(r.phone, '56912345678', `teléfono mal en: ${t}`);
    assert.match(r.name, /Juan Pérez/, `nombre mal en: ${t}`);
  }
});

test('el teléfono puede ir antes del nombre', () => {
  const r = parseComandoCliente('CLIENTE +56912345678 Juan Pérez');
  assert.ok(r.ok);
  assert.equal(r.phone, '56912345678');
  assert.equal(r.name, 'Juan Pérez');
});

test('sin teléfono válido AVISA en vez de adivinar', () => {
  // Anti-alucinación: nunca inventar un número. Si se equivoca, la cotización se le carga
  // a un desconocido y el seguimiento le llega a otra persona.
  for (const t of ['CLIENTE Juan Pérez', 'CLIENTE 123', 'CLIENTE']) {
    const r = parseComandoCliente(t);
    assert.equal(r.ok, false, `debió rechazar: ${t}`);
    assert.match(r.error, /tel|nombre/i);
  }
});

test('CLIENTE OFF limpia la atribución', () => {
  const r = parseComandoCliente('CLIENTE off');
  assert.ok(r.ok);
  assert.equal(r.limpiar, true);
});

test('normalizar no inventa países', () => {
  assert.equal(normalizar('912345678'), '56912345678');   // celular sin código
  assert.equal(normalizar('12345678'), '56912345678');    // sin el 9
  assert.equal(normalizar('56912345678'), '56912345678'); // ya completo
  assert.equal(normalizar('+1 650 555 1234'), '16505551234'); // extranjero: se respeta
});

test('fijar y obtener: lo que se guarda es lo que sale', () => {
  _reset();
  fijar('56957296035', '912345678', 'Juan Pérez');
  const a = obtener('56957296035');
  assert.equal(a.phone, '56912345678');
  assert.equal(a.name, 'Juan Pérez');
});

test('cada dueño tiene la suya y no se cruzan', () => {
  _reset();
  fijar('56957296035', '911111111', 'Uno');
  assert.equal(obtener('56900000000'), null, 'otro número no debe ver la atribución ajena');
});

test('limpiar la deja sin efecto', () => {
  _reset();
  fijar('56957296035', '911111111', 'Uno');
  limpiar('56957296035');
  assert.equal(obtener('56957296035'), null);
});

test('vence sola: una atribución vieja NO se aplica', async () => {
  // Si el dueño fijó un cliente hace horas y se olvidó, lo que cotice después no puede
  // irse al cliente equivocado. Ese error es peor que pedirle que repita el comando.
  _reset();
  process.env.ATRIBUCION_VIGENCIA_MS = '30';
  const mod = await import('./atribucionCotizacion.js?vencimiento=1');
  mod.fijar('56957296035', '911111111', 'Uno');
  assert.ok(mod.obtener('56957296035'), 'debería estar vigente recién fijada');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(mod.obtener('56957296035'), null, 'pasada la vigencia debe devolver null');
  delete process.env.ATRIBUCION_VIGENCIA_MS;
});

test('sin atribución activa no cambia nada (el caso normal)', () => {
  _reset();
  assert.equal(obtener('56957296035'), null);
});
