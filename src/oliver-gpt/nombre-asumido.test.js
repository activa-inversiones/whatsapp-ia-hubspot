// nombre-asumido.test.js — [2026-09-03]
//
// 🔴 EL NOMBRE DEJA DE FRENAR LA COTIZACION. Instruccion del dueño, textual:
//     *"LA IDEA ES COTIZARLE IGUAL A CLIENTE SOLO ACTUALIZAR SI DESPUES VIENE EL DATO
//       CORRECTO"*
//
// CASO QUE LO ORIGINA (real, medido contra la BD viva el 03-sep):
//   whatsapp_sessions wa_id 56994940848, 12:04 hora Chile. El cliente dio las medidas
//   ("4.15 de ancho por 2.10, y dos paños de 3.15 por 2.30 mts. Con puerta") y la comuna
//   ("Padre las casas"). Oliver pregunto "¿A nombre de quien preparo la propuesta?", el
//   cliente no contesto nunca, y la conversacion murio ahi: cero cotizacion, y por lo tanto
//   cero evento de conversion para Google/Meta.
//
// POR QUE PASABA: de los cuatro datos del gate, `name` era el UNICO sin plazo de gracia.
//   color / tipo / hojas: se preguntan una vez y, pasado el plazo, la propuesta sale igual.
//   name: `missing.push('name')` y bloqueaba PARA SIEMPRE.
// Y `datoQuePregunta` lo pone PRIMERO en la cascada, asi que era el que mas veces frenaba.
//
// LA MEDIDA (BD viva, 30 dias, conversaciones de >= 6 mensajes): 272 conversaciones,
//   210 con comuna guardada (77 %), **2 con nombre guardado (0,7 %)**.
//
// LO QUE ESTE ARCHIVO FIJA: con que nombre sale la propuesta cuando el cliente no lo dio,
// y que ese nombre venga siempre rotulado como ASUMIDO — para que el turno siguiente pueda
// avisarle al cliente y ofrecerle reemitirla.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { quoteDataComplete, resolverNombre } from './pdf-intent.js';

const items = [{ product: 'Corredera', producto_label: 'Corredera SLIDING H98', measures: '1500x1200', unit_price: 250000, color: 'Blanco' }];

describe('resolverNombre — de donde sale el nombre, y si el cliente lo dio o no', () => {
  test('lo que dijo el cliente MANDA sobre todo lo demas', () => {
    const r = resolverNombre({ input: { name: 'Luis Pérez' }, state: { name: 'Otro' }, pushName: 'Perfil WA' });
    assert.equal(r.nombre, 'Luis Pérez');
    assert.equal(r.asumido, false);
    assert.equal(r.origen, 'cliente');
  });

  test('el state vale cuando el turno no trae nombre (lo dijo en un turno anterior)', () => {
    const r = resolverNombre({ input: {}, state: { name: 'Ana' }, pushName: 'Perfil WA' });
    assert.equal(r.nombre, 'Ana');
    assert.equal(r.asumido, false);
  });

  test('sin nombre dicho, se usa el perfil de WhatsApp — y queda marcado como ASUMIDO', () => {
    // El push_name lo manda Meta en CADA mensaje entrante y ya se captura
    // (whatsapp-adapter.js:87). Era el dato que estaba ahi y el gate no miraba.
    const r = resolverNombre({ input: {}, state: {}, pushName: 'Luis', comuna: 'Padre Las Casas' });
    assert.equal(r.nombre, 'Luis');
    assert.equal(r.asumido, true);
    assert.equal(r.origen, 'perfil_whatsapp');
  });

  test('sin perfil, se rotula con la comuna — nunca se inventa un nombre de persona', () => {
    const r = resolverNombre({ input: {}, state: { comuna: 'Padre Las Casas' }, pushName: '' });
    assert.equal(r.nombre, 'Cliente de Padre Las Casas');
    assert.equal(r.asumido, true);
    assert.equal(r.origen, 'comuna');
  });

  test('sin nada, "Cliente" — pero sigue sin frenar', () => {
    const r = resolverNombre({ input: {}, state: {}, pushName: '' });
    assert.equal(r.nombre, 'Cliente');
    assert.equal(r.asumido, true);
    assert.equal(r.origen, 'generico');
  });

  test('un push_name que es un telefono NO es un nombre', () => {
    // Mucha gente tiene el numero como nombre de perfil. Poner "+56 9 9494 0848" en un
    // documento formal es peor que poner "Cliente de Padre Las Casas".
    const r = resolverNombre({ input: {}, state: { comuna: 'Temuco' }, pushName: '+56 9 9494 0848' });
    assert.equal(r.nombre, 'Cliente de Temuco');
    assert.equal(r.origen, 'comuna');
  });

  test('un push_name generico ("Cliente") tampoco cuenta', () => {
    const r = resolverNombre({ input: {}, state: { comuna: 'Freire' }, pushName: 'cliente' });
    assert.equal(r.nombre, 'Cliente de Freire');
  });

  test('el nombre que dio el cliente NO se pisa aunque sea corto', () => {
    const r = resolverNombre({ input: { name: 'Ana' }, state: {}, pushName: 'Otro' });
    assert.equal(r.nombre, 'Ana');
    assert.equal(r.asumido, false);
  });
});

describe('quoteDataComplete — el nombre ya NO bloquea (caso Luis, 03-sep)', () => {
  test('🔴 EL CASO LUIS: medidas y precio, sin nombre → la propuesta SALE', () => {
    const g = quoteDataComplete({ items }, {}, { pushName: 'Luis', comuna: 'Padre Las Casas' });
    assert.equal(g.ok, true, 'sin nombre la propuesta tiene que salir igual');
    assert.equal(g.missing.includes('name'), false);
    assert.equal(g.nombre, 'Luis');
    assert.equal(g.nombreAsumido, true, 'sale, pero rotulado: hay que avisarle al cliente');
  });

  test('sin nombre NI perfil NI comuna tampoco bloquea', () => {
    const g = quoteDataComplete({ items }, {}, {});
    assert.equal(g.ok, true);
    assert.equal(g.nombre, 'Cliente');
    assert.equal(g.nombreAsumido, true);
  });

  test('con nombre del cliente, nada cambia: sale y NO se rotula', () => {
    const g = quoteDataComplete({ name: 'Luis Pérez', items }, {}, {});
    assert.equal(g.ok, true);
    assert.equal(g.nombreAsumido, false);
    assert.equal(g.nombre, 'Luis Pérez');
  });

  test('"Cliente" como nombre del LLM sigue contando como ASUMIDO, no como dato', () => {
    // El guard viejo trataba /^cliente$/i como "sin nombre" y frenaba. Ahora no frena,
    // pero tampoco puede pasar por un nombre que el cliente dio: se marca asumido.
    const g = quoteDataComplete({ name: 'Cliente', items }, { comuna: 'Temuco' }, {});
    assert.equal(g.ok, true);
    assert.equal(g.nombreAsumido, true);
    assert.equal(g.nombre, 'Cliente de Temuco');
  });

  test('lo que SI sigue bloqueando: sin items, sin medidas, sin precio', () => {
    // Estos no son "datos que el cliente no quiso dar": sin ellos no hay nada que cotizar.
    assert.equal(quoteDataComplete({ items: [] }, {}, {}).missing.includes('items'), true);
    assert.equal(
      quoteDataComplete({ items: [{ product: 'Corredera', measures: '', unit_price: 1 }] }, {}, {}).ok,
      false, 'sin medidas no se puede cotizar nada');
    assert.equal(
      quoteDataComplete({ items: [{ product: 'Corredera', measures: '1500x1200', unit_price: 0 }] }, {}, {}).ok,
      false, 'precio 0 no es una cotizacion');
  });
});
