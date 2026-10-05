// vidrioCotizado.test.js — [2026-10-05] la regla del vidrio, rama por rama.
//
// Decision del 05-oct: el MOTOR es el dueño del vidrio, como ya lo es del precio y del Uw.
// `enginePricer.js` lo elige por area/ambiente (`pickGlassId`) y PISA `item.glass_label`; con
// ESE vidrio cobra y calcula el Uw. Imprimir otro vidrio que el cobrado es imprimir un dato falso.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  motorCotizo, vidrioDelMotor, precioCoincide, elegirVidrio, aplicarVidrio, avisarVidrio, textoBanoPerdido,
} from './vidrioCotizado.js';

const cotizado = (extra = {}) => ({ unit_price: 130000, confidence: 'high', glass_label: '5+12+5', ...extra });

test('vidrioDelMotor: solo si el motor cotizo de verdad y trae vidrio', () => {
  assert.equal(vidrioDelMotor(cotizado()), '5+12+5');
  // OJO: `enginePricer` escribe `glass_label` ANTES de llamar al motor, asi que una copia cuyo
  // HTTP fallo TRAE vidrio. Por eso se exige la cotizacion completa, no solo el vidrio.
  for (const malo of [null, undefined, cotizado({ unit_price: 0 }), cotizado({ unit_price: undefined }),
    cotizado({ confidence: 'manual' }), cotizado({ confidence: undefined }), cotizado({ glass_label: '  ' })]) {
    assert.equal(vidrioDelMotor(malo), null);
  }
  assert.equal(motorCotizo(cotizado()), true);
  assert.equal(motorCotizo(cotizado({ confidence: 'manual' })), false);
  assert.equal([cotizado(), cotizado()].every(motorCotizo), true, 'sirve directo en .every');
});

test('el motor cotizo ⇒ manda SU vidrio, aunque el item traiga otro', () => {
  // 🔁 DADO VUELTA el 05-oct. La ronda anterior fijaba "un vidrio que el item ya trae NO se
  // pisa". Pero el precio y el Uw que se imprimen son SIEMPRE los del vidrio del motor
  // (enginePricer.js:1279-1281 lo elige por area y pisa item.glass_label): dejar el del LLM es
  // mostrar un vidrio distinto del cobrado. Decision del autor (coordinador), 05-oct.
  for (const delLlm of ['Termopanel DVH', 'Termopanel DVH 5+12+5', undefined, '']) {
    assert.deepEqual(elegirVidrio(delLlm, '5+12+5'), { vidrio: '5+12+5', aviso: null }, `con "${delLlm}"`);
  }
  assert.deepEqual(elegirVidrio('Termopanel DVH', null), { vidrio: 'Termopanel DVH', aviso: null },
    'sin vidrio del motor queda lo que venia');
});

test('precioCoincide: el bloque del Uw solo afirma el vidrio si imprime el precio que el motor calculo', () => {
  assert.equal(precioCoincide(cotizado(), 130000), true);
  assert.equal(precioCoincide(cotizado(), '130000'), true, 'el precio puede venir como texto');
  assert.equal(precioCoincide(cotizado(), 120000), false);
  assert.equal(precioCoincide(cotizado(), undefined), false, 'sin precio impreso no se afirma nada');
  assert.equal(precioCoincide(null, 130000), false);
});

test('[C2] la opcion se llama `mismoPrecio`: con otro precio el vidrio del motor NO es el cobrado y queda lo que venia', () => {
  assert.deepEqual(elegirVidrio('Termopanel DVH', '5+12+5', { mismoPrecio: false }),
    { vidrio: 'Termopanel DVH', aviso: null });
  assert.deepEqual(elegirVidrio('Termopanel DVH', '5+12+5', { mismoPrecio: true }),
    { vidrio: '5+12+5', aviso: null });
  assert.deepEqual(elegirVidrio('Termopanel DVH', '5+12+5', {}),
    { vidrio: '5+12+5', aviso: null }, 'sin la opcion, el default (true) vive SOLO en elegirVidrio');
  // aplicarVidrio la pasa tal cual: sin default propio.
  const item = { glass_label: 'Termopanel DVH' };
  aplicarVidrio(item, '5+12+5', { avisos: [], mismoPrecio: false });
  assert.equal(item.glass_label, 'Termopanel DVH');
  aplicarVidrio(item, '5+12+5', { avisos: [] });
  assert.equal(item.glass_label, '5+12+5');
});

test('🔴 [B3] la etiqueta dice satén/baño/esmerilado y el motor no ⇒ NO se reemplaza y queda el aviso', () => {
  // El PDF perdio el ambiente "baño" y la recotizacion eligio claro. El rastro del recinto se
  // conserva y se avisa (vidrio.bano_perdido): el reprecio a claro es un defecto de plata que
  // existia antes y va al tablero. Pase o no el precio.
  for (const opts of [{}, { mismoPrecio: false }]) {
    assert.deepEqual(elegirVidrio('4+12+4 satén (baño)', '4+12+4', opts), { vidrio: '4+12+4 satén (baño)', aviso: 'vidrio.bano_perdido' });
    assert.deepEqual(elegirVidrio('Termopanel DVH baño', '5+12+5', opts), { vidrio: 'Termopanel DVH baño', aviso: 'vidrio.bano_perdido' });
    // [r4] «esmerilado» es el mismo vidrio que el satén (dibujoVentana.claveVidrio ya los junta).
    assert.deepEqual(elegirVidrio('Termopanel 4+12+4 esmerilado', '4+12+4', opts),
      { vidrio: 'Termopanel 4+12+4 esmerilado', aviso: 'vidrio.bano_perdido' });
    assert.deepEqual(elegirVidrio('4+12+4 Esmerilada', '4+12+4', opts), { vidrio: '4+12+4 Esmerilada', aviso: 'vidrio.bano_perdido' });
  }
  assert.deepEqual(elegirVidrio('Termopanel 4+12+4 Satén', '4+12+4 satén (baño)'),
    { vidrio: '4+12+4 satén (baño)', aviso: null }, 'si el motor TAMBIEN es satén, manda el motor');
  assert.deepEqual(elegirVidrio('4+12+4 esmerilado', '4+12+4 satén (baño)'),
    { vidrio: '4+12+4 satén (baño)', aviso: null }, 'esmerilado + motor satén: manda el motor');
});

test('🔴 [B4] la etiqueta reemplazada describia OTRO producto ⇒ se reemplaza igual y queda el aviso', () => {
  for (const otro of ['DVH 4/12/4 low-e', 'Laminado 6+6', 'Control solar 6+12+6', 'Termopanel asimétrico 5+12+4',
    'Monolítico 6 mm', 'Selective Index']) {
    assert.deepEqual(elegirVidrio(otro, '4+12+4'), { vidrio: '4+12+4', aviso: 'vidrio.producto_distinto' }, otro);
  }
  assert.deepEqual(elegirVidrio('Laminado 6+6', '4+12+4', { mismoPrecio: false }),
    { vidrio: 'Laminado 6+6', aviso: null }, 'si no se reemplaza, no hay nada que avisar');
});

test('🔴 [B4 · r4] templado, tintado, bronce/gris/verde, reflectivo y catedral tambien son OTRO producto', () => {
  // Ninguno lo cotiza el motor: reemplazarlos por el vidrio claro cobrado sin decirlo es borrarle
  // al cliente lo que pidio. Sin espesor en la etiqueta, para aislar la palabra.
  for (const otro of ['Vidrio templado', 'Templada', 'DVH tintado', 'Termopanel bronce', 'Termopanel gris',
    'Termopanel verde', 'Vidrio reflectivo', 'Termopanel reflectante', 'Vidrio catedral']) {
    assert.deepEqual(elegirVidrio(otro, '4+12+4'), { vidrio: '4+12+4', aviso: 'vidrio.producto_distinto' }, otro);
  }
  // Control: el termopanel comun y corriente NO es "otro producto".
  for (const comun of ['Termopanel DVH', 'DVH 4+12+4', 'Termopanel claro 4+12+4']) {
    assert.equal(elegirVidrio(comun, '4+12+4').aviso, null, comun);
  }
});

test('🔴 [B4 · r4] espesores de termopanel DISTINTOS a los del motor ⇒ se reemplaza igual y queda el aviso', () => {
  // 6+12+6 es otro producto que 4+12+4 (otro peso, otro precio, otro Uw): el cliente lo pidio asi.
  for (const [etiqueta, motor] of [['6+12+6', '4+12+4'], ['Termopanel DVH 6/12/6', '4+12+4'], ['DVH 4-12-4', '5+12+5'],
    ['Termopanel 5+16+5', '5+12+5'], ['DVH 4/12/4', '5+12+5']]) {
    assert.deepEqual(elegirVidrio(etiqueta, motor), { vidrio: motor, aviso: 'vidrio.producto_distinto' }, `${etiqueta} vs ${motor}`);
  }
  // Mismo espesor escrito de otra forma, o sin espesor legible en alguno de los dos: no hay con que comparar.
  for (const [etiqueta, motor] of [['Termopanel DVH 5/12/5', '5+12+5'], ['DVH 5-12-5', '5+12+5'], ['Termopanel DVH', '5+12+5'],
    ['5+12+5', 'Termopanel DVH'], ['', '5+12+5']]) {
    assert.equal(elegirVidrio(etiqueta, motor).aviso, null, `${etiqueta} vs ${motor}`);
  }
  // Si no se reemplaza (otro precio), no hay nada que avisar.
  assert.deepEqual(elegirVidrio('6+12+6', '4+12+4', { mismoPrecio: false }), { vidrio: '6+12+6', aviso: null });
});

test('[C3] aplicarVidrio: `avisos` es obligatorio; escribe en el item y junta el aviso', () => {
  assert.throws(() => aplicarVidrio({ glass_label: 'Laminado 6+6' }, '4+12+4'), TypeError, 'sin opciones');
  assert.throws(() => aplicarVidrio({ glass_label: 'Laminado 6+6' }, '4+12+4', {}), /avisos/, 'sin avisos');

  const avisos = [];
  const a = { glass_label: 'Laminado 6+6' };
  const b = { glass_label: '4+12+4 satén (baño)' };
  const sinTocar = {};
  aplicarVidrio(a, '4+12+4', { avisos });
  aplicarVidrio(b, '4+12+4', { avisos });
  aplicarVidrio(sinTocar, null, { avisos });
  assert.equal(a.glass_label, '4+12+4');
  assert.equal(b.glass_label, '4+12+4 satén (baño)');
  assert.equal('glass_label' in sinTocar, false);
  assert.deepEqual(avisos.map((x) => x.aviso), ['vidrio.producto_distinto', 'vidrio.bano_perdido']);
});

test('avisarVidrio loguea cada aviso UNA vez con el folio (el bloque del Uw vuelve a pasar por el mismo item)', () => {
  const avisos = [];
  const b = { glass_label: '4+12+4 satén (baño)' };
  aplicarVidrio({ glass_label: 'Laminado 6+6' }, '4+12+4', { avisos });
  aplicarVidrio(b, '4+12+4', { avisos });
  aplicarVidrio(b, '4+12+4', { avisos });          // el bloque del Uw vuelve a pasar: no duplica el log

  const lineas = [];
  avisarVidrio(avisos, 'CM-FR-004-2026-0601', (aviso, texto) => lineas.push(`${aviso} ${texto}`));
  assert.equal(lineas.length, 2, JSON.stringify(lineas));
  assert.match(lineas[0], /^vidrio\.producto_distinto .*CM-FR-004-2026-0601.*Laminado 6\+6.*4\+12\+4/);
  assert.match(lineas[1], /^vidrio\.bano_perdido .*CM-FR-004-2026-0601.*satén/);
});

test('🔔 [r4 · decision 1] satén perdido ⇒ UN aviso al DUEÑO por folio, con el folio y todas las etiquetas', () => {
  const avisos = [];
  aplicarVidrio({ glass_label: '4+12+4 satén (baño)' }, '4+12+4', { avisos });
  aplicarVidrio({ glass_label: '4+12+4 satén (baño)' }, '4+12+4', { avisos });   // misma etiqueta: una vez
  aplicarVidrio({ glass_label: 'Termopanel 5+12+5 esmerilado' }, '5+12+5', { avisos });
  aplicarVidrio({ glass_label: 'Laminado 6+6' }, '4+12+4', { avisos });          // otro producto: NO es para el dueño

  const alDueno = [];
  avisarVidrio(avisos, 'CM-FR-004-2026-0601', () => {}, (texto) => alDueno.push(texto));
  assert.equal(alDueno.length, 1, `un solo aviso por folio: ${JSON.stringify(alDueno)}`);
  assert.match(alDueno[0], /CM-FR-004-2026-0601/);
  assert.match(alDueno[0], /"4\+12\+4 satén \(baño\)"/);
  assert.match(alDueno[0], /"Termopanel 5\+12\+5 esmerilado"/);
  assert.match(alDueno[0], /vidrio claro; revisar precio/);
  assert.doesNotMatch(alDueno[0], /Laminado/);
  assert.equal(alDueno[0], textoBanoPerdido('CM-FR-004-2026-0601', ['4+12+4 satén (baño)', 'Termopanel 5+12+5 esmerilado']));
});

test('🔔 [r4] sin satén perdido NO se molesta al dueño; sin canal de aviso solo se loguea', () => {
  const avisos = [];
  aplicarVidrio({ glass_label: 'Laminado 6+6' }, '4+12+4', { avisos });
  aplicarVidrio({ glass_label: 'Termopanel DVH' }, '4+12+4', { avisos });
  const alDueno = [];
  avisarVidrio(avisos, 'CM-FR-004-2026-0601', () => {}, (t) => alDueno.push(t));
  assert.deepEqual(alDueno, [], 'producto_distinto va al tablero, no al celular del dueño');
  avisarVidrio([], 'CM-FR-004-2026-0601', () => {}, (t) => alDueno.push(t));
  assert.deepEqual(alDueno, []);

  const bano = [];
  aplicarVidrio({ glass_label: '4+12+4 satén (baño)' }, '4+12+4', { avisos: bano });
  const lineas = [];
  assert.doesNotThrow(() => avisarVidrio(bano, 'CM-FR-004-2026-0601', (a, t) => lineas.push(`${a} ${t}`)));
  assert.equal(lineas.length, 1, 'sin canal de aviso al dueño, el log del tablero igual sale');
});

test('🔔 [r4] UNA vez por folio DE VERDAD: con el notificador REAL, el mismo folio dos veces ⇒ un solo WhatsApp', async () => {
  // La unicidad por folio la da el cooldown de highValueNotifier (clave = telefono + motivo), y
  // el motivo lleva el folio y las etiquetas: el mismo folio con las mismas etiquetas es la
  // misma clave. Se prueba con el modulo real, no con un doble que diga lo que uno quiere oir.
  process.env.OWNER_NOTIFICATION_PHONE = '56900000001';   // el modulo lo lee al importarse
  const { notifyHighValue } = await import('./highValueNotifier.js');
  const enviados = [];
  const waSend = async (a, t) => { enviados.push({ a, t }); };
  const sesion = { data: { items: [] }, history: [] };
  const avisos = [];
  aplicarVidrio({ glass_label: '4+12+4 satén (baño)' }, '4+12+4', { avisos });

  for (const folio of ['CM-FR-004-2026-0601', 'CM-FR-004-2026-0601', 'CM-FR-004-2026-0602']) {
    let pendiente = null;
    avisarVidrio(avisos, folio, () => {}, (texto) => { pendiente = notifyHighValue(waSend, '56911112222', sesion, `[whatsapp] ${texto}`); });
    await pendiente;
  }
  assert.equal(enviados.length, 2, `0601 una vez y 0602 una vez: ${JSON.stringify(enviados.map((e) => e.t.match(/CM-FR-\S+/)?.[0]))}`);
  assert.ok(enviados.every((e) => e.a === '56900000001'), 'va al dueño');
  assert.match(enviados[0].t, /CM-FR-004-2026-0601.*vidrio claro; revisar precio/s);
});
