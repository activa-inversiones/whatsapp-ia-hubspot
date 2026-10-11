// huella-informe.test.js — [2026-08-26]
//
// 🔴 QUÉ HACE QUE UN INFORME TÉRMICO SEA **OTRO** INFORME.
//
// El candado de 30 días existe para no mandarle al mismo cliente el mismo informe una y otra
// vez. Pero miraba SOLO el teléfono, y con eso bloqueaba informes que sí corresponden.
//
// Regla del dueño, textual: "es de sentido común que si el cliente coloca que es de la comuna
// de Temuco al principio, después se equivoca y dice «en realidad yo soy de Cunco»,
// claramente debemos entregarle la propuesta nueva con la reglamentación térmica de esa
// comuna... lo de los treinta días es solo para si el cliente NO sufre modificaciones".
//
// Caso medido: Paula tiene el CM-FR-006-2026-0008 emitido para CUNCO y hoy está en TEMUCO.

import test from 'node:test';
import assert from 'node:assert/strict';
import { huellaDelInforme, huellasDelInforme } from './webhook.js';

const CUNCO = { comuna: 'Cunco', producto: 'Ventana corredera', glassLabel: 'TP-M-5+12+5' };

test('🔴 el caso de Paula: cambiar de comuna es OTRO informe', () => {
  assert.notEqual(huellaDelInforme(CUNCO), huellaDelInforme({ ...CUNCO, comuna: 'Temuco' }));
});

test('🔴 cambiar el PRODUCTO también', () => {
  // "mejor necesito correderas en este proyecto, o proyectante en este otro, o puertas en
  // este otro: todas van a tener térmicas diferentes".
  const base = huellaDelInforme(CUNCO);
  assert.notEqual(base, huellaDelInforme({ ...CUNCO, producto: 'Ventana proyectante' }));
  assert.notEqual(base, huellaDelInforme({ ...CUNCO, producto: 'Puerta corredera' }));
});

test('🔴 y cambiar el VIDRIO: de ahí sale el Uw', () => {
  assert.notEqual(huellaDelInforme(CUNCO), huellaDelInforme({ ...CUNCO, glassLabel: 'TP-M-4+12+4' }));
});

test('🔒 las MEDIDAS no cambian el informe: un proyecto de 8 ventanas es UNO', () => {
  // Si las medidas entraran en la huella, agregar una novena ventana dispararía un informe
  // nuevo — y el dueño describió justo lo contrario: un proyecto con varias ventanas lleva
  // un informe, y recién si cambia el TIPO de producto corresponde otro.
  assert.equal(huellaDelInforme({ ...CUNCO, medidas: '1000x1000' }),
               huellaDelInforme({ ...CUNCO, medidas: '2000x3000' }));
});

test('🔒 la misma comuna escrita distinto es la misma comuna', () => {
  assert.equal(huellaDelInforme({ comuna: 'Cuncó' }), huellaDelInforme({ comuna: 'cunco' }));
  assert.equal(huellaDelInforme({ comuna: ' TEMUCO ' }), huellaDelInforme({ comuna: 'temuco' }));
  assert.equal(huellaDelInforme({ comuna: 'Padre Las Casas' }), huellaDelInforme({ comuna: 'padre-las-casas' }));
});

test('🔒 sin ningún dato la huella queda vacía y manda el candado de siempre', () => {
  // Degradar al comportamiento anterior es preferible a inventar una huella: una huella
  // inventada le daría a cada cliente un informe nuevo en cada cotización.
  for (const v of [{}, { comuna: '', producto: '', glassLabel: '' }, undefined]) {
    assert.equal(huellaDelInforme(v), '');
  }
});

test('🔒 la huella no crece sin límite', () => {
  // Un `producto` larguísimo (el label de una compuesta lo es) no puede hacer una clave de
  // KV interminable.
  const h = huellaDelInforme({ comuna: 'x'.repeat(300), producto: 'y'.repeat(300), glassLabel: 'z'.repeat(300) });
  assert.ok(h.length <= 3 * 40 + 2, `la huella mide ${h.length}`);
});

// ── [2026-08-26 · caso 0364] RESET suelta los candados del informe ──────────────────────
import { candadoVigente } from './webhook.js';

test('🔴 un candado ANTERIOR al RESET ya no vale; uno posterior si', () => {
  // El caso medido: candado de las 14:11 (pruebas de Paula), RESET a las 19:44, cotizacion
  // nueva a las 19:44 con la misma huella → el informe debe salir.
  const t1411 = 1756224660000, t1944 = 1756244640000;
  assert.equal(candadoVigente({ at: t1411 }, t1944), false, 'candado viejo + RESET → suelto');
  assert.equal(candadoVigente({ at: t1944 + 60000 }, t1944), true, 'entregado DESPUES del RESET → vale');
});

test('candados legacy (`true`, sin fecha): sin RESET valen; con RESET quedan sueltos', () => {
  assert.equal(candadoVigente(true, 0), true, 'sin marcador de RESET, todo sigue como antes');
  assert.equal(candadoVigente(true, 123), false, 'el RESET pide empezar de cero: suelto');
  assert.equal(candadoVigente(null, 0), false, 'sin candado nunca hubo envio');
  assert.equal(candadoVigente(undefined, 999), false);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 🔴 [2026-10-11 · lo cazó la suite primero y Codex lo completó en la compuerta] EL MISMO VIDRIO,
// ESCRITO DE CUALQUIER FORMA, ES EL MISMO INFORME.
//
// La huella incluía el rótulo del vidrio EN CRUDO. MEDIDO contra la BD viva (180 días): producción
// usa **19 formas distintas de escribir 4 vidrios** («4+12+4 satén», «DVH 4+12+4 satén»,
// «Termopanel 4+12+4 satén», «Termopanel 4+12+4 satén (baño)», …) según el camino que lo cotizó.
// Con el rótulo crudo, la MISMA ventana daba candados distintos ⇒ al cliente que ya tenía su
// informe se le volvía a mandar. Se vio al cambiar el rótulo por orden del dueño: 2 informes
// salieron de nuevo teniendo el candado vigente.
//
// Lo que este test defiende es la DECISIÓN: la huella compara el PRODUCTO, no cómo esté escrito.
// Y la otra mitad, que es la cara peligrosa: dos vidrios que SÍ son distintos no pueden colapsar,
// porque entonces a un cliente NO le llegaría un informe que le corresponde.
// ═══════════════════════════════════════════════════════════════════════════════════════════
test('🔴 el MISMO vidrio escrito de 6 formas da UNA sola huella; vidrios distintos nunca colapsan', () => {
  const h = (glassLabel) => huellaDelInforme({ comuna: 'Temuco', producto: 'Ventana corredera', glassLabel });
  // las 6 formas del satén que conviven HOY en producción (medidas en la BD viva)
  const saten = ['4+12+4 satén (baño)', '4+12+4 satén', 'DVH 4+12+4 satén', 'Termopanel 4+12+4 satén',
    'Termopanel DVH 4+12+4 satén', 'Termopanel DVH 4+12+4 Satén'].map(h);
  assert.equal(new Set(saten).size, 1, `6 formas del mismo satén tienen que dar 1 huella: ${[...new Set(saten)]}`);
  // y las 5 del claro, y las 5 del 5+12+5
  const claro = ['4+12+4', '4+12+4 DVH', 'DVH 4+12+4', 'Termopanel 4+12+4', 'Termopanel DVH 4+12+4'].map(h);
  assert.equal(new Set(claro).size, 1);
  const grande = ['5+12+5', '5+12+5 DVH', 'DVH 5+12+5', 'Termopanel 5+12+5', 'Termopanel DVH 5+12+5'].map(h);
  assert.equal(new Set(grande).size, 1);
  // 🔴 LA CARA PELIGROSA: tres vidrios DISTINTOS, tres huellas distintas. Si colapsaran, el cliente
  // se quedaría SIN un informe que le corresponde, que es peor que recibir uno de más.
  assert.equal(new Set([saten[0], claro[0], grande[0]]).size, 3, 'satén, claro y 5+12+5 son tres vidrios');
  // y un low-e tampoco se confunde con su hermano sin low-e
  assert.notEqual(h('Termopanel 4+12+4 low-e'), claro[0]);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 🔴 [2026-10-11 · lo cazó Thermos en la compuerta, y era el bloqueante del lote]
// CAMBIAR LA HUELLA NO ARREGLA LOS CANDADOS YA GUARDADOS: LOS VUELVE INALCANZABLES.
//
// La huella es parte de la CLAVE (`informe_termico:<cliente>:<huella>`) y el candado vive 30 DÍAS
// en caché. Al cambiar cómo se calcula, el candado viejo deja de encontrarse, el sistema cree que
// nunca mandó el informe, y se lo manda de nuevo al cliente — quemando un correlativo ISO NUEVO de
// una serie que la empresa está certificando.
//
// 📏 MEDIDO contra la BD viva el 11-10, sobre los candados VIGENTES en ese momento:
//   · informe_termico: 163 de 416 quedaban huérfanos ⇒ 41 clientes
//   · informe_vientos:  71 de 163 ⇒ 36 clientes
// Uno de esos candados reales era, literal:
//   `bot:activa:informe_termico:56931862981:|proyectantes60|termopaneldvh4124`
//
// Lo que este test defiende es la DECISIÓN: se ESCRIBE con la huella de hoy, se LEE con todas las
// que existieron. El día que alguien agregue una normalización nueva y NO la sume a la lista, este
// test se pone rojo antes de que decenas de clientes reciban un documento repetido.
// ═══════════════════════════════════════════════════════════════════════════════════════════
test('🔴 MIGRACIÓN: la huella vieja se sigue leyendo, o se reenvía el informe a quien ya lo tiene', () => {
  const proyecto = { comuna: 'Temuco', producto: 'Proyectante S60', glassLabel: 'Termopanel DVH 4+12+4' };
  const todas = huellasDelInforme(proyecto);

  // 1) lo que se ESCRIBE es la huella de hoy, y es la primera
  assert.equal(huellaDelInforme(proyecto), todas[0], 'se escribe con la de hoy');

  // 2) la huella que ESTÁ GUARDADA HOY en producción tiene que seguir encontrándose. Este valor es
  //    el candado real medido el 11-10, copiado tal cual: si deja de estar en la lista, los 41
  //    clientes que lo tienen reciben su informe otra vez.
  assert.ok(todas.includes('temuco|proyectantes60|termopaneldvh4124'),
    `la huella guardada en producción ya no se busca. Buscadas: ${JSON.stringify(todas)}`);

  // 3) y las dos normalizaciones que existieron el 11-10 también
  assert.ok(huellasDelInforme({ ...proyecto, glassLabel: 'Termopanel 4+12+4 satén (baño)' })
    .includes(huellaDelInforme({ ...proyecto, glassLabel: '4+12+4 satén' })),
    'las formas del mismo satén se encuentran entre sí');

  // 4) 🔴 LA CARA PELIGROSA: buscar de más no puede volverse buscar CUALQUIER COSA. Dos proyectos
  //    con vidrios DISTINTOS no pueden compartir ninguna huella, o a un cliente no le llega el
  //    informe que le corresponde — que es peor que recibir uno de más.
  const otro = huellasDelInforme({ ...proyecto, glassLabel: 'Termopanel 5+12+5' });
  assert.equal(todas.filter((h) => otro.includes(h)).length, 0,
    '4+12+4 y 5+12+5 no pueden compartir candado');
  const conSaten = huellasDelInforme({ ...proyecto, glassLabel: 'Termopanel 4+12+4 satén' });
  assert.equal(todas.filter((h) => conSaten.includes(h)).length, 0,
    'el claro y el satén tampoco');

  // 5) y cambiar la COMUNA sigue siendo otro proyecto, por todas las huellas
  const otraComuna = huellasDelInforme({ ...proyecto, comuna: 'Cunco' });
  assert.equal(todas.filter((h) => otraComuna.includes(h)).length, 0);
});
