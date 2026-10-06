// 🛡️ [2026-10-06] EL LLM SABE QUE EL CLIENTE YA ESTA FIJADO. Caso real del dueño ese dia (conversacion
// 56931862981): confirmaba «✅ Cotizando para Alex Clark» y el turno siguiente Oliver contestaba «Falta fijar
// el cliente» — 7 de 8 veces. El codigo SI tenia el cliente (atribucion), pero al LLM solo se le decia la
// regla «antes de cotizar tiene que haber un cliente fijado» y NUNCA si lo habia: tenia que adivinar.
// Decision: la regla la aplica el CODIGO (corta antes del LLM si falta); el LLM nunca pide el comando.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionContext } from './system-prompt.js';
import { TEXTO_MODO_INTERNO } from '../../services/internosEquipo.js';

const txt = (b) => (Array.isArray(b) ? b.map((x) => x.text || x).join('\n') : String(b?.text ?? b));

test('🛡️ el texto del modo interno NO le ordena al LLM exigir el comando CLIENTE', () => {
  assert.doesNotMatch(TEXTO_MODO_INTERNO, /antes de cotizar tiene que haber un cliente fijado/i);
  assert.match(TEXTO_MODO_INTERNO, /NUNCA le pidas/i);
});

test('🛡️ con cliente fijado, el contexto lo dice con nombre y telefono y prohibe pedirlo', () => {
  const c = txt(buildSessionContext({ modo_interno: true, cliente_fijado: { name: 'Alex Clark', phone: '56974596798' } }));
  assert.match(c, /CLIENTE YA FIJADO/);
  assert.match(c, /Alex Clark/);
  assert.match(c, /56974596798/);
});

test('sin cliente fijado no aparece la linea (el dueño puede cotizar para si)', () => {
  const c = txt(buildSessionContext({ modo_interno: true }));
  assert.doesNotMatch(c, /CLIENTE YA FIJADO/);
});

// Codex (tridente 06-oct): el test de arriba arma el estado a mano y seguiria verde si se borrara el cableado.
import { readFileSync } from 'node:fs';
test('🛡️ el webhook SI le pasa el cliente fijado al turno (y lo borra antes de persistir)', () => {
  const src = readFileSync(new URL('./webhook.js', import.meta.url), 'utf8');
  assert.match(src, /state\.cliente_fijado\s*=\s*atribucion\s*\?/, 'el turno lleva el cliente fijado');
  assert.match(src, /delete newState\.cliente_fijado/, 'y no se guarda en la sesion');
  // Codex r2: el ORDEN importa — se asigna ANTES de llamar al cerebro y se borra DESPUES.
  const iAsig = src.search(/state\.cliente_fijado\s*=\s*atribucion\s*\?/);
  const iTurno = src.indexOf('await handleTurn(', iAsig);
  const iBorra = src.indexOf('delete newState.cliente_fijado', iAsig);
  assert.ok(iAsig > 0 && iTurno > iAsig, 'se asigna antes del turno del LLM');
  assert.ok(iBorra > iTurno, 'y se borra despues del turno');
});
