// capacidadReal.test.js
// El caso es REAL: Roxana Alvarado, conv 4d16c6ca, 14-sep-2026 22:50.
// Oliver dijo que le había mandado la propuesta por correo. NO PUEDE mandar correos.
// Seis minutos después ella escribió "No llego nada pésima atención".
import test from 'node:test';
import assert from 'node:assert/strict';
import { corregirPromesasImposibles, MOTIVO_CAPACIDAD, VERSION } from './capacidadReal.js';

// ─── EL CASO REAL ────────────────────────────────────────────────────────────

test('REAL: la frase exacta que le llegó a Roxana se corrige', () => {
  const real = 'Listo, Roxana. Le acabo de enviar la propuesta a su correo roxanalvaradoab@gmail.com.\n\n' +
    'Si no la ve en la bandeja principal, revise la carpeta de spam o promociones.';
  const r = corregirPromesasImposibles(real);
  assert.equal(r.corregido, true);
  assert.ok(!/le acabo de enviar la propuesta a su correo/i.test(r.texto),
    'quedó la promesa que no se puede cumplir');
  assert.match(r.texto, /no le puedo enviar correos/i);
  assert.deepEqual(r.motivos, [MOTIVO_CAPACIDAD]);
});

test('REAL: se conserva lo que venía ANTES de la frase falsa', () => {
  const r = corregirPromesasImposibles('Listo, Roxana. Le acabo de enviar la propuesta a su correo x@y.cl.');
  assert.match(r.texto, /^Listo, Roxana\./, 'se perdió el saludo');
});

test('NUNCA bloquea: un cliente sin respuesta es peor que una frase corregida', () => {
  const r = corregirPromesasImposibles('Se la mandé a su correo.');
  assert.ok(r.texto.length > 0);
  assert.equal('bloquear' in r, false);
});

// ─── Variantes de la misma mentira ───────────────────────────────────────────

test('caza las formas equivalentes', () => {
  const casos = [
    'Le envié la cotización a su correo.',
    'Ya se la mandé por email.',
    'Se lo envío a su mail ahora mismo.',
    'Acabo de enviarle la propuesta al correo.',
    'Le reenvío el documento a su correo.',
  ];
  for (const c of casos) {
    const r = corregirPromesasImposibles(c);
    assert.equal(r.corregido, true, `no cazó: "${c}"`);
  }
});

// ─── 🔴 LO QUE NO SE PUEDE TOCAR ─────────────────────────────────────────────

test('🔴 un HUMANO sí puede mandar correos: esas frases NO se tocan', () => {
  const ciertas = [
    'Marcelo le va a enviar la propuesta a su correo.',
    'Nuestro equipo le enviará el informe por correo.',
    'Lucas se la manda a su correo en un rato.',
  ];
  for (const c of ciertas) {
    const r = corregirPromesasImposibles(c);
    assert.equal(r.corregido, false, `rompió un mensaje verdadero: "${c}"`);
    assert.equal(r.texto, c);
  }
});

test('DAR el correo de la empresa es legítimo y no se toca', () => {
  const c = 'Puede escribirnos a mcifuentes@activaspa.cl y le respondemos.';
  const r = corregirPromesasImposibles(c);
  assert.equal(r.corregido, false);
  assert.equal(r.texto, c);
});

test('PEDIR el correo no es prometer mandarlo', () => {
  const c = '¿Me confirma su correo electrónico, por favor?';
  const r = corregirPromesasImposibles(c);
  assert.equal(r.corregido, false);
});

test('mandar por WhatsApp NO es mandar por correo', () => {
  const c = 'Le acabo de enviar la propuesta por acá mismo.';
  const r = corregirPromesasImposibles(c);
  assert.equal(r.corregido, false, 'el envío por WhatsApp sí ocurre de verdad');
});

test('hablar del correo sin prometer envío no se toca', () => {
  const c = 'La propuesta también queda registrada en nuestro correo interno.';
  const r = corregirPromesasImposibles(c);
  assert.equal(r.corregido, false);
});

// ─── Bordes ──────────────────────────────────────────────────────────────────

test('texto sin promesas queda idéntico', () => {
  const c = 'Perfecto. ¿Me confirma la comuna para incluirla en la propuesta?';
  const r = corregirPromesasImposibles(c);
  assert.equal(r.texto, c);
  assert.equal(r.corregido, false);
  assert.deepEqual(r.motivos, []);
});

test('entradas no-string no revientan', () => {
  for (const v of [null, undefined, 42, {}, []]) {
    const r = corregirPromesasImposibles(v);
    assert.equal(r.corregido, false);
    assert.equal(typeof r.texto, 'string');
  }
});

test('dos promesas en el mismo mensaje se corrigen ambas', () => {
  const c = 'Le envié la propuesta a su correo. Y también le mandé el informe a su email.';
  const r = corregirPromesasImposibles(c);
  assert.equal(r.corregido, true);
  assert.ok(!/le envié la propuesta a su correo/i.test(r.texto));
  assert.ok(!/le mandé el informe a su email/i.test(r.texto));
});

test('expone VERSION', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test('🔴 una dirección de correo NO parte la frase al medio', () => {
  // El punto de "gmail.com" partía la frase y dejaba un ".com." colgando del mensaje.
  const r = corregirPromesasImposibles('Listo, Roxana. Le acabo de enviar la propuesta a su correo roxanalvaradoab@gmail.com.');
  assert.equal(r.corregido, true);
  assert.ok(!/\.com\./.test(r.texto), `quedó basura del correo: ${r.texto}`);
  assert.ok(!/roxanalvaradoab/.test(r.texto), 'quedó la dirección de la clienta');
  assert.match(r.texto, /^Listo, Roxana\./);
});
