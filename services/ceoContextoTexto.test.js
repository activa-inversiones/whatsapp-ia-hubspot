// services/ceoContextoTexto.test.js
// ═══════════════════════════════════════════════════════════════════════════
// EL DEFECTO QUE CLAVA ESTE TEST (2026-08-31, defecto-2)
//
// El dueno escribio a las 9:33 AM: "HOLA ESTAS BIEN NECESITO INFORME DE LEAD 24 HORAS".
// Y despues, textual: "LE PEDI LAS ULTIMAS 24 HORAS Y ME DIO OTRA INFORMACION".
//
// El bloque de contexto se titulaba "NUMEROS REALES DE HOY" y adentro habia UN solo numero de
// leads: el del dia calendario. A las 9:33 AM eso son 9 horas. El modelo no tenia de donde
// sacar las 24 h, asi que contesto con lo mas parecido.
//
// Aca se prueban las tres cosas que no pueden volver a pasar:
//   1) los dos periodos aparecen, con su numero, nombrados sin ambiguedad;
//   2) el titulo ya no empuja a contestar "hoy" a cualquier pregunta;
//   3) si sales-os todavia es el viejo y no manda el campo nuevo, el bloque NO se rompe
//      y NO pone el numero de hoy en el lugar de las 24 horas — dice que no lo tiene.
//
// Correr: node --test services/ceoContextoTexto.test.js
// ═══════════════════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import { construirBloqueNumeros, REGLA_PERIODOS } from './ceoContextoTexto.js';

// Payload como el que devuelve GET /internal/ceo/contexto del sales-os NUEVO.
// Los numeros de leads son los REALES medidos en la BD viva el 31-ago 09:55 CL.
const CONTEXTO_NUEVO = () => ({
  pulso: {
    leads_hoy: { hoy: 1, de_meta: 0, de_organico: 0, que_es: 'desde las 00:00 de HOY, hora de Chile' },
    leads_ultimas_24h: { n: 6, de_meta: 2, de_organico: 0, que_es: 'ventana MOVIL de 24 horas' },
    cotizaciones_hoy: {
      cotizaciones_enviadas_hoy: 1, monto_enviado_hoy: 939682,
      borradores_sin_precio_hoy: 4, hoy: 1, monto_hoy: 939682,
    },
    conversaciones_activas_24h: 10,
    recordatorios_pendientes: { n: 210 },
  },
  a_quien_llamar: {
    clientes_por_llamar: 230, en_juego_clp: 322425443,
    prioritarios: [{ customer_name: 'Antonio Lobos', amount_total: 12666466, dias_sin_respuesta: 50, es_vip: true }],
  },
  agenda: { sin_precio: 429, senales: 8, monto_senales_clp: 8391027, aprobados: 1, medicion: 0 },
  mes: { cotizaciones_mes: 178, monto_cotizado_clp: 257701181, ticket_promedio_clp: 1447759, borradores_sin_precio_mes: 425, ganadas_mes: 0 },
});

// El MISMO payload como lo devuelve el sales-os VIEJO: sin `leads_ultimas_24h`.
// (Deploys separados: no se sabe cual de los dos servicios sube primero.)
const CONTEXTO_VIEJO = () => {
  const d = CONTEXTO_NUEVO();
  delete d.pulso.leads_ultimas_24h;
  d.pulso.leads_hoy = { hoy: 1, de_meta: 0, de_organico: 0 }; // el viejo tampoco traia `que_es`
  return d;
};

const lineaDe = (txt, marca) => txt.split('\n').find(l => l.includes(marca));

test('los dos periodos salen por separado, con su numero y con su nombre', () => {
  const t = construirBloqueNumeros(CONTEXTO_NUEVO());

  const l24 = lineaDe(t, 'ÚLTIMAS 24 HORAS (ventana móvil');
  const lHoy = lineaDe(t, 'Leads de HOY');
  assert.ok(l24, 'tiene que haber una linea de leads de las ultimas 24 horas');
  assert.ok(lHoy, 'y otra, aparte, de los leads de hoy');

  assert.match(l24, /: 6\b/, 'la de 24 h dice 6, que es lo que midio la BD');
  assert.match(lHoy, /: 1\./, 'la de hoy dice 1');
  assert.notEqual(l24, lHoy);
  assert.match(l24, /desde ayer a esta misma hora/, 'hay que explicar que es una ventana movil');
  assert.match(lHoy, /00:00 de hoy, hora de Chile/, 'y que "hoy" arranca a medianoche en Chile');
});

test('el bloque ya no se titula "de HOY" ni le deja al modelo mezclar periodos', () => {
  const t = construirBloqueNumeros(CONTEXTO_NUEVO());
  // El titulo viejo era "NÚMEROS REALES DE HOY": empujaba a contestar el dia calendario
  // aunque le preguntaran por 24 horas.
  assert.ok(!/NÚMEROS REALES DE HOY/.test(t), 'el titulo no puede decir que TODO es de hoy');
  assert.ok(t.includes(REGLA_PERIODOS), 'la regla de periodos viaja dentro del bloque');
  assert.match(t, /Si te piden 24 horas/, 'tiene que decirle cual linea usar para cada pregunta');
  assert.match(t, /SIEMPRE decí de qué período/, 'y que declare el periodo en la respuesta');
});

test('sin el campo nuevo (sales-os viejo) el bloque no se rompe NI miente', () => {
  const t = construirBloqueNumeros(CONTEXTO_VIEJO());

  assert.ok(t.length > 0, 'el bloque tiene que seguir armandose');
  // Lo que NO puede pasar: que el numero de hoy se disfrace de "ultimas 24 horas".
  assert.ok(!/ÚLTIMAS 24 HORAS \(ventana móvil[^\n]*: \d/.test(t),
    'sin dato de 24 h no se inventa un numero de 24 h');
  assert.match(t, /Leads ÚLTIMAS 24 HORAS: NO TENGO ESE DATO/,
    'hay que avisarle al modelo que ese periodo no lo tiene');
  assert.match(t, /NO uses el número de hoy como si fueran 24 horas/);
  // Y lo que SI tiene que seguir funcionando: todo lo demas, igual que antes.
  assert.match(lineaDe(t, 'Leads de HOY'), /: 1\./);
  assert.match(t, /230 clientes cotizados sin cerrar/);
  assert.match(t, /\$322\.425\.443 EN JUEGO/);
});

test('los alias viejos del resto del payload siguen leyendose (deploy desfasado al reves)', () => {
  const d = CONTEXTO_NUEVO();
  // sales-os viejo: solo los nombres de la v1.0.0 para cotizaciones y agenda.
  d.pulso.cotizaciones_hoy = { hoy: 1, monto_hoy: 939682 };
  d.a_quien_llamar = { total_pendientes: 204, plata_en_juego_clp: 264755020, prioritarios: [] };
  const t = construirBloqueNumeros(d);
  assert.match(t, /se envió 1 cotización\(es\) con precio por \$939\.682/);
  assert.match(t, /204 clientes cotizados sin cerrar = \$264\.755\.020 EN JUEGO/);
  // Sin borradores en el payload viejo, no se inventa la frase de borradores.
  assert.ok(!/borrador\(es\) SIN precio/.test(t));
});

test('payload vacio o roto devuelve "" y no explota', () => {
  assert.equal(construirBloqueNumeros(null), '');
  assert.equal(construirBloqueNumeros(undefined), '');
  assert.equal(construirBloqueNumeros('no soy un objeto'), '');
  // Un payload a medias (sales-os respondio con error adentro) no puede tirar el asistente.
  const t = construirBloqueNumeros({});
  assert.ok(t.length > 0);
  assert.match(t, /Leads de HOY[^\n]*: \?/, 'lo que falta se muestra como "?", no como 0');
});

// ── [2026-09-01] EL TELÉFONO, PARA PODER LLAMAR ───────────────────────────
// Pedido del dueño, textual: "la idea es que me deje el resumen del cliente,
// pincharlo para que yo pueda llamarlo por teléfono".
// El bloque imprimía `customer_name || phone`: con nombre, el teléfono NO viajaba,
// así que el modelo no lo tenía y no podía dárselo aunque quisiera.
const unCliente = (p) => ({ a_quien_llamar: { prioritarios: [p] } });

test('el teléfono viaja aunque el cliente tenga nombre', () => {
  const t = construirBloqueNumeros(unCliente({
    customer_name: 'VICTOR ACEVEDO', phone: '56957296035',
    amount_total: 7245446, dias_sin_respuesta: 3, es_vip: true,
  }));
  assert.match(t, /VICTOR ACEVEDO/);
  assert.match(t, /\+56 9 5729 6035/, 'el teléfono tiene que estar, y en formato pinchable');
});

test('el teléfono va en formato que WhatsApp convierte en link', () => {
  // Sin el +56 y los espacios, WhatsApp lo deja como texto muerto y no se puede
  // tocar para llamar — que es justo lo que el dueño pidió poder hacer.
  const t = construirBloqueNumeros(unCliente({ customer_name: 'X', phone: '56911112222', amount_total: 100 }));
  assert.match(t, /\+56 9 1111 2222/);
});

test('sin nombre sigue mostrando el teléfono (no rompe el caso viejo)', () => {
  const t = construirBloqueNumeros(unCliente({ phone: '56957296035', amount_total: 500 }));
  assert.match(t, /\+56 9 5729 6035/);
});

test('un teléfono con formato raro se imprime tal cual en vez de desaparecer', () => {
  const t = construirBloqueNumeros(unCliente({ customer_name: 'Y', phone: '001234', amount_total: 1 }));
  assert.match(t, /001234/);
});
