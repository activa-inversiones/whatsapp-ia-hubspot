// turno-vigente.test.js — [2026-09-03]
//
// EL BOT SE DETIENE CUANDO EL CLIENTE ESCRIBE.
//
// 🔴 LO MEDIDO (BD viva, 14 dias): 54 rafagas de >= 5 piezas salientes seguidas sin ninguna
// entrada del cliente, a 29 clientes, peor caso 12 piezas. Y usando `enviado_at` —la hora
// REAL en que el cliente escribio, no la hora en que procesamos su mensaje— la mediana de
// respuesta tras una rafaga es NEGATIVA:
//     rafaga de 1 pieza  -> +0,3 min      rafaga 5-7 -> -2,5 min
//     rafaga de 3-4      -> -0,3 min      rafaga 8+  -> -2,8 min
// El cliente ya habia escrito ~3 minutos ANTES de que el bot terminara de mandarle
// documentos. Una persona se detiene cuando el otro empieza a hablar; Oliver no.
//
// POR QUE NO SE ENTERABA: el lock por telefono. La secuencia larga (mensaje de valor ->
// informe -> video -> vientos -> anticipo -> propuesta, con pausas deliberadas que suman
// 2-3 minutos) tiene el lock tomado. El mensaje nuevo del cliente queda ENCOLADO esperando
// a que termine. La secuencia no tiene forma de saber que llego.
//
// ═══ POR QUE ESTE DISENO Y NO EL OBVIO (compuerta cruzada del 03-sep) ═══
// La primera version tomaba una "foto" del ultimo inbound AL EMPEZAR la secuencia y
// comparaba contra ella. Codex la mato con un caso exacto:
//   A toma el lock -> B llega y actualiza el marcador -> A RECIEN AHI empieza la secuencia
//   y fotografia la marca DE B -> la comparacion da igual y no aborta nunca.
// Por eso el turno se numera AL LLEGAR, antes del lock, y cada turno lleva SU numero.
//
// Y no se aborta en cualquier lado. Codex tambien mostro que "no abortar si el folio ya se
// genero" se traga el arreglo entero (el folio y el PDF se crean ANTES de los informes, asi
// que la excepcion aplicaria siempre) y ademas obliga a mandar una propuesta que el cliente
// acaba de corregir. La regla correcta es al reves: **se corta ANTES de quemar el folio**,
// no despues. Nunca queda un correlativo ISO quemado sin documento.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { anotarLlegada, turnoVigente, _resetTurnos } from './webhook.js';

describe('numeracion de turnos — se anota AL LLEGAR, no al empezar la secuencia', () => {
  test('un turno solo es vigente si es el ultimo que llego de ese cliente', () => {
    _resetTurnos();
    const t1 = anotarLlegada('56999111222');
    assert.equal(turnoVigente('56999111222', t1), true, 'recien llegado: es el vigente');

    const t2 = anotarLlegada('56999111222');           // el cliente escribio de nuevo
    assert.equal(turnoVigente('56999111222', t1), false, 'el viejo ya no manda');
    assert.equal(turnoVigente('56999111222', t2), true, 'el nuevo si');
  });

  test('🔴 EL CASO QUE MATO AL DISENO ANTERIOR: B llega mientras A tiene el lock', () => {
    // Secuencia real: A entra y toma el lock. B llega y se queda esperando el lock. A recien
    // entonces arranca su secuencia larga. Con una "foto al empezar", A fotografiaba la marca
    // de B y creia ser el vigente. Con el numero tomado AL LLEGAR, A sabe que quedo viejo.
    _resetTurnos();
    const A = anotarLlegada('56999111222');   // A llega
    const B = anotarLlegada('56999111222');   // B llega mientras A todavia no empezo a mandar
    assert.equal(turnoVigente('56999111222', A), false,
      'A tiene que saber que quedo viejo AUNQUE recien ahora empiece a mandar');
    assert.equal(turnoVigente('56999111222', B), true);
  });

  test('los clientes no se pisan entre si', () => {
    _resetTurnos();
    const a = anotarLlegada('56911111111');
    const b = anotarLlegada('56922222222');
    assert.equal(turnoVigente('56911111111', a), true, 'que escriba OTRO cliente no corta lo mio');
    assert.equal(turnoVigente('56922222222', b), true);
  });

  test('el telefono se normaliza: +56 9 1111 1111 y 56911111111 son el mismo', () => {
    _resetTurnos();
    const t = anotarLlegada('+56 9 1111 1111');
    assert.equal(turnoVigente('56911111111', t), true);
  });

  test('sin numero de turno NO corta nada (los caminos que no lo pasan siguen igual)', () => {
    // Regla de degradacion: un llamador que todavia no anota su llegada tiene que comportarse
    // EXACTAMENTE como antes. Un arreglo que corta envios por un dato que no recibio es peor
    // que el defecto que vino a arreglar.
    _resetTurnos();
    anotarLlegada('56999111222');
    assert.equal(turnoVigente('56999111222', undefined), true);
    assert.equal(turnoVigente('56999111222', null), true);
    assert.equal(turnoVigente('', 5), true);
  });

  test('un cliente del que no sabemos nada no bloquea', () => {
    _resetTurnos();
    assert.equal(turnoVigente('56900000000', 7), true, 'sin registro previo, se sigue como siempre');
  });
});
