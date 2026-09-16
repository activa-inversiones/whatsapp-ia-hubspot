// avisoEntregaDudosa.test.js
// Kimi, compuerta 16-sep: "el cambio convierte 'posible duplicado' en 'posible pérdida
// silenciosa'". Estos tests fijan que la pérdida NO sea silenciosa.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mensajeEntregaDudosa, tocaAvisar, claveAviso, AVISO_REPETIR_MS, VERSION,
} from './avisoEntregaDudosa.js';

const AHORA = Date.parse('2026-09-16T12:00:00Z');

test('🔴 el aviso dice QUIÉN es el cliente — sin eso no se puede revisar nada', () => {
  // Dueño, 16-sep, textual: *"cómo se llama el cliente para revisar"*. La primera versión
  // mandaba solo `…2852` y lo obligaba a buscar un chat por cuatro dígitos.
  const m = mensajeEntregaDudosa({
    tipo: 'Informe térmico', folio: 'CM-FR-006-2026-0033',
    telefono: '56998702852', motivo: 'timeout', nombre: 'Katy Rossel',
  });
  assert.match(m, /Katy Rossel/, 'falta el nombre: es lo primero que preguntó el dueño');
  assert.match(m, /\+56998702852/, 'falta el teléfono completo para abrir el chat');
  assert.match(m, /CM-FR-006-2026-0033/, 'falta el folio');
  assert.match(m, /timeout/, 'falta el motivo');
  assert.match(m, /NO se reenvía solo/, 'falta la instrucción que evita el duplicado');
});

test('🔴 sin nombre lo DICE, no inventa un "Cliente" que no distingue a nadie', () => {
  const m = mensajeEntregaDudosa({ telefono: '56998702852' });
  assert.match(m, /sin nombre registrado/);
  assert.match(m, /\+56998702852/, 'sin nombre, el teléfono es lo único que queda');
});

test('el nombre en blanco cuenta como sin nombre', () => {
  assert.match(mensajeEntregaDudosa({ nombre: '   ' }), /sin nombre registrado/);
});

test('🔴 nunca avisado ⇒ se avisa', () => {
  assert.equal(tocaAvisar(null, AHORA), true);
  assert.equal(tocaAvisar(undefined, AHORA), true);
  assert.equal(tocaAvisar('', AHORA), true);
});

test('🔴 recién avisado ⇒ NO se repite (si grita siempre, se ignora)', () => {
  assert.equal(tocaAvisar(AHORA - 60_000, AHORA), false);
});

test('pasado el intervalo vuelve a avisar; justo en el intervalo también', () => {
  assert.equal(tocaAvisar(AHORA - AVISO_REPETIR_MS, AHORA), true);
  assert.equal(tocaAvisar(AHORA - AVISO_REPETIR_MS - 1, AHORA), true);
});

test('marca ilegible ⇒ se avisa igual: ante la duda, avisar', () => {
  assert.equal(tocaAvisar('no-es-fecha', AHORA), true);
  assert.equal(tocaAvisar(0, AHORA), true);
  assert.equal(tocaAvisar(-5, AHORA), true);
});

test('acepta fecha ISO, no solo epoch', () => {
  assert.equal(tocaAvisar(new Date(AHORA - 60_000).toISOString(), AHORA), false);
  assert.equal(tocaAvisar(new Date(AHORA - 7 * 3600_000).toISOString(), AHORA), true);
});

test('🔴 la llave es POR DOCUMENTO: dos informes del mismo cliente no se tapan', () => {
  assert.notEqual(claveAviso('termico', 'F1'), claveAviso('termico', 'F2'));
  assert.notEqual(claveAviso('termico', 'F1'), claveAviso('vientos', 'F1'));
  assert.equal(claveAviso('termico', 'F1'), claveAviso('termico', 'F1'));
});

test('expone VERSION', () => assert.match(VERSION, /^\d+\.\d+\.\d+$/));

// ─── [Kimi, compuerta 16-sep] Lo que hacía inservible al aviso ───────────────

test('🔴 "Cliente" NO es un nombre: en vientos el aviso decía "Cliente: *Cliente*"', () => {
  // Kimi, textual: *"el mensaje miente: parece un nombre real y no lo es"*. Y es el
  // problema original con otro disfraz — el dueño pidió el nombre PARA REVISAR.
  // `clientName` defaultea al literal 'Cliente' en el camino de vientos.
  const m = mensajeEntregaDudosa({ nombre: 'Cliente', telefono: '56998702852' });
  assert.match(m, /sin nombre registrado/);
  assert.ok(!/\*Cliente\*/.test(m), 'no puede presentarse un marcador como si fuera el nombre');
});

test('los otros marcadores tampoco pasan por nombre', () => {
  for (const x of ['cliente', 'CLIENTE', 'sin nombre', 'Desconocido', 'n/a']) {
    assert.match(mensajeEntregaDudosa({ nombre: x }), /sin nombre registrado/, `pasó: ${x}`);
  }
});

test('🔴 un nombre con marcas de WhatsApp no rompe el formato del aviso', () => {
  // El nombre va entre asteriscos de negrita: uno pegado en el apellido desbalancea el
  // markup y deja el resto del mensaje en negrita, o muestra los asteriscos crudos.
  const m = mensajeEntregaDudosa({ nombre: 'Katy *Rossel*', telefono: '569' });
  assert.match(m, /• Cliente: \*Katy Rossel\*/);
  assert.equal((m.match(/\*/g) || []).length % 2, 0, 'quedaron asteriscos desbalanceados');
});

test('🔴 un nombre con salto de línea no puede partir el aviso', () => {
  const m = mensajeEntregaDudosa({ nombre: 'Katy\nMotivo: cualquier cosa', telefono: '569' });
  assert.match(m, /• Cliente: \*Katy Motivo: cualquier cosa\*/);
  assert.equal(m.split('\n').filter((l) => /^• /.test(l)).length, 4,
    'el aviso tiene que seguir teniendo exactamente 4 viñetas');
});

test('🔴 los apellidos mapuches NO se tocan (ya nos pasó con el validador de nombres)', () => {
  // Lección del 15-sep: un validador propio rechazaba Huenchumilla, Curamil, Millaleo.
  for (const n of ['Lautaro Huenchumilla', 'Galvarino Curamil', 'Victoria Millaleo']) {
    assert.ok(mensajeEntregaDudosa({ nombre: n }).includes(`Cliente: *${n}*`), `se comió: ${n}`);
  }
});
