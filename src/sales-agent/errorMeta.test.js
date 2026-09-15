// errorMeta.test.js
// La regla del dueño (15-sep, textual): "2 veces la misma no se puede".
// Traducida a test: NINGÚN caso ambiguo puede salir reintentable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clasificar, sePuedeReintentar, RESULTADO, CODIGOS_NO_PROCESADO, VERSION } from './errorMeta.js';

// ─── EL CASO QUE LO ORIGINA ──────────────────────────────────────────────────

test('🔴 5xx de Meta es AMBIGUO: NUNCA reintentable', () => {
  // Kimi K3, compuerta 15-sep: Meta puede aceptar el mensaje internamente y
  // después fallar al responder. Hay entregas documentadas tras un error.
  for (const status of [500, 502, 503, 504]) {
    const c = clasificar({ ok: false, status });
    assert.equal(c.resultado, RESULTADO.DESCONOCIDO, `${status} salió como conocido`);
    assert.equal(c.reintentable, false, `${status} salió reintentable → puede duplicar`);
  }
});

test('🔴 timeout NUNCA es reintentable (es el desconocido canónico)', () => {
  const c = clasificar({ ok: false, timedOut: true });
  assert.equal(c.resultado, RESULTADO.DESCONOCIDO);
  assert.equal(c.reintentable, false);
  assert.equal(c.motivo, 'timeout');
});

test('🔴 un código que NO está en la whitelist no se reintenta', () => {
  const c = clasificar({ ok: false, status: 400, code: 999999 });
  assert.equal(c.reintentable, false, 'un código nuevo de Meta no puede volverse reintento por omisión');
  assert.match(c.motivo, /no_verificado/);
});

test('🔴 "ok" sin wamid NO es éxito', () => {
  const c = clasificar({ ok: true });
  assert.equal(c.resultado, RESULTADO.DESCONOCIDO);
  assert.equal(c.reintentable, false);
  assert.equal(c.motivo, 'ok_sin_wamid');
});

// ─── Lo que SÍ se puede reintentar ───────────────────────────────────────────

test('los códigos de rechazo por validación SÍ se reintentan', () => {
  for (const code of CODIGOS_NO_PROCESADO) {
    const c = clasificar({ ok: false, status: 400, code });
    assert.equal(c.resultado, RESULTADO.FALLO_CONOCIDO, `código ${code}`);
    assert.equal(c.reintentable, true);
  }
});

test('errores de red previos al envío SÍ se reintentan', () => {
  assert.equal(sePuedeReintentar({ ok: false, netCode: 'ENOTFOUND' }), true);
  assert.equal(sePuedeReintentar({ ok: false, netCode: 'ECONNREFUSED' }), true);
});

test('ECONNRESET NO se reintenta: puede haberse cortado DESPUÉS de mandar', () => {
  assert.equal(sePuedeReintentar({ ok: false, netCode: 'ECONNRESET' }), false);
});

test('envío exitoso con wamid', () => {
  const c = clasificar({ ok: true, wamid: 'wamid.HBgLNTY5...' });
  assert.equal(c.resultado, RESULTADO.ENTREGADO_A_META);
  assert.equal(c.reintentable, false, 'ya llegó: reintentar sería duplicar');
});

// ─── Precedencia: el timeout gana sobre todo ─────────────────────────────────

test('timeout con un código de la whitelist igual NO se reintenta', () => {
  // Si hubo timeout, el código que venga es ruido: no sabemos qué pasó del otro lado.
  const c = clasificar({ ok: false, timedOut: true, code: 131047 });
  assert.equal(c.reintentable, false, 'el timeout manda sobre la whitelist');
});

// ─── Bordes ──────────────────────────────────────────────────────────────────

test('entradas basura caen en DESCONOCIDO, nunca en reintento', () => {
  for (const v of [null, undefined, 42, 'error', {}, []]) {
    const c = clasificar(v);
    assert.equal(c.reintentable, false, `${JSON.stringify(v)} salió reintentable`);
  }
});

test('la whitelist arranca chica y a propósito', () => {
  assert.ok(CODIGOS_NO_PROCESADO.size <= 5,
    'si crece, cada código nuevo necesita su evidencia escrita en el módulo');
});

test('expone VERSION', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});
