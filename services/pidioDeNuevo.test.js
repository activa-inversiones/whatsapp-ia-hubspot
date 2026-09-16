// pidioDeNuevo.test.js
// 🔴 EL RIESGO ACÁ ES EL FALSO POSITIVO. Si este detector se dispara de más, le reenvía un
// documento a un cliente que YA lo tiene — o sea, se convierte en la causa del duplicado que
// vino a evitar, y rompe la regla del dueño: *"2 veces la misma no se puede"*.
// Por eso la lista de lo que NO debe disparar es más larga que la de lo que sí.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pidioDeNuevo, VERSION } from './pidioDeNuevo.js';

const si = (t) => assert.equal(pidioDeNuevo(t).pidio, true, `debió detectar: "${t}"`);
const no = (t) => assert.equal(pidioDeNuevo(t).pidio, false, `NO debió detectar: "${t}"`);

test('🔴 dice que no le llegó, en las formas en que se dice de verdad', () => {
  [
    'no me llegó', 'no me llego', 'No me ha llegado nada', 'no llegó el informe',
    'no lo recibí', 'no la recibí', 'no recibí nada', 'no me llegaron',
    'no me aparece el archivo', 'no me aparece nada', 'no me sale el pdf',
    'no veo ningún archivo', 'no veo el documento', 'no tengo el pdf',
    'oiga no me llegó la propuesta', 'disculpe pero no me ha llegado',
    'no me mandaste nada', 'no me enviaron el informe',
  ].forEach(si);
});

test('🔴 pide el reenvío explícito', () => {
  [
    'me lo puede reenviar?', 'reenviamelo por favor', 'reenvíe la propuesta',
    'mándamelo de nuevo', 'me la manda otra vez?', 'envíamelo nuevamente',
    'vuelve a mandar el pdf', 'me lo podría reenviar', 'pásamelo de nuevo',
  ].forEach(si);
});

// ─── 🔴 LO QUE NO PUEDE DISPARAR ─────────────────────────────────────────────

test('🔴 un "no" pelado NUNCA alcanza', () => {
  ['no', 'No', 'no gracias', 'no por ahora', 'nop', 'no aún'].forEach(no);
});

test('🔴 el que YA lo tiene no puede recibirlo dos veces', () => {
  // Estas frases contienen "llegó"/"recibí" y con una regex ingenua dispararían.
  [
    'ya me llegó', 'ya me llegó gracias', 'sí llegó', 'si me llego',
    'llegó perfecto', 'llegó todo bien', 'ya lo recibí', 'ya la tengo',
    'gracias, ya me llegó', 'perfecto, lo recibí', 'ya lo vi gracias',
    'ya lo abrí', 'llegaron los dos gracias',
  ].forEach(no);
});

test('🔴 rechazar el precio o el color NO es pedir un reenvío', () => {
  [
    'no me sirve el precio', 'no me gusta el color', 'no quiero blanco',
    'no me convence', 'está muy caro no', 'no voy a comprar por ahora',
    'no tengo las medidas todavía', 'no sé la comuna',
  ].forEach(no);
});

test('conversación normal no dispara', () => {
  [
    'hola', 'cuánto cuesta una ventana de 1.5x1.2?', 'tengo otra ventana',
    'y el color nogal?', 'quiero cotizar', 'gracias', 'dale', 'perfecto',
    'necesito 8 ventanas para mi casa', '', '   ',
  ].forEach(no);
});

test('entradas basura no revientan', () => {
  [null, undefined, 123, {}, []].forEach((x) => {
    assert.equal(typeof pidioDeNuevo(x).pidio, 'boolean');
  });
});

test('el motivo dice POR QUÉ, para el log y para auditar un falso positivo', () => {
  assert.equal(pidioDeNuevo('no me llegó').motivo, 'dice_que_no_le_llego');
  assert.equal(pidioDeNuevo('reenviamelo').motivo, 'pide_reenvio');
  assert.equal(pidioDeNuevo('ya me llegó').motivo, 'confirma_que_lo_tiene');
  assert.equal(pidioDeNuevo('hola').motivo, 'no_corresponde');
});

test('expone VERSION', () => assert.match(VERSION, /^\d+\.\d+\.\d+$/));
