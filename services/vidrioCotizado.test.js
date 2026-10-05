// vidrioCotizado.test.js — [2026-10-05] la regla del vidrio, rama por rama.
//
// Decision del 05-oct: el MOTOR es el dueño del vidrio, como ya lo es del precio y del Uw.
// `enginePricer.js` lo elige por area/ambiente (`pickGlassId`) y PISA `item.glass_label`; con
// ESE vidrio cobra y calcula el Uw. Imprimir otro vidrio que el cobrado es imprimir un dato falso.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  motorCotizo, vidrioDelMotor, precioCoincide, elegirVidrio, aplicarVidrio, textoBanoPerdido,
  fraseBanoPerdido, motivoDeEnvio, AVISO_VIDRIO_REPETIR_MS,
} from './vidrioCotizado.js';
import { COOLDOWN_MS } from './highValueNotifier.js';
import { claveVidrio } from './dibujoVentana.js';
import { dicePalabraSaten } from './vidrioSatinado.js';

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
  for (const [etiqueta, motor] of [['6+12+6', '4+12+4'], ['Termopanel DVH 6/12/6', '4+12+4'],
    ['Termopanel 5+16+5', '5+12+5'], ['6+12+6', '5+12+5'],
    // Solo UNO de los dos es de los que el motor elige por area: el otro es un producto que el motor no cotiza.
    ['4+12+5', '5+12+5'], ['5+10+5', '4+12+4']]) {
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

test('🔴 [r5 · Thermos BAJO] 4+12+4 ↔ 5+12+5 NO es otro producto: es la regla de AREA del motor (pickGlassId, umbral 2 m²)', () => {
  // 🔁 DADO VUELTA el 05-oct (r5). La r4 fijaba `DVH 4-12-4` / `DVH 4/12/4` contra un motor 5+12+5
  // como `producto_distinto`. Pero `enginePricer.pickGlassId` elige entre ESAS DOS por area (<2 m² ⇒
  // 4+12+4, ≥2 m² ⇒ 5+12+5): el motor re-cotiza la MISMA ventana con el espesor que le corresponde
  // por tamaño, y el cliente que pidio "termopanel 4+12+4" para una ventana grande recibe lo que
  // corresponde. Avisar "producto distinto" ahi era ruido en el tablero. Hallazgo 3 de Thermos
  // (449b255..30cca6d); decision del coordinador, 05-oct.
  for (const [etiqueta, motor] of [
    ['DVH 4-12-4', '5+12+5'], ['DVH 4/12/4', '5+12+5'], ['Termopanel DVH 4+12+4', '5+12+5'], ['4+12+4', '5+12+5'],
    ['5+12+5', '4+12+4'], ['DVH 5/12/5', '4+12+4'], ['Termopanel 5-12-5', '4+12+4'],
  ]) {
    assert.deepEqual(elegirVidrio(etiqueta, motor), { vidrio: motor, aviso: null }, `${etiqueta} vs ${motor}`);
  }
  // El par solo vale para ESOS dos. Cualquier otra cosa sigue siendo otro producto (control).
  assert.equal(elegirVidrio('DVH 4/12/4 low-e', '5+12+5').aviso, 'vidrio.producto_distinto', 'low-e sigue siendo otro producto');
  assert.equal(elegirVidrio('Laminado 4+12+4 templado', '5+12+5').aviso, 'vidrio.producto_distinto', 'templado también');
  assert.equal(elegirVidrio('6+12+6', '5+12+5').aviso, 'vidrio.producto_distinto');
  assert.equal(elegirVidrio('4+16+4', '4+12+4').aviso, 'vidrio.producto_distinto', 'otra cámara no es regla de área');
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

// [r8] La orquestación del aviso (`avisarVidrio`: canales, deduplicación, qué cuenta como «avisado») vive en
// avisarVidrio.test.js. Acá, solo las funciones PURAS que ese módulo y escalation.js comparten.
test('[r8] fraseBanoPerdido / textoBanoPerdido: UNA sola frase para el texto, el panel y la plantilla', () => {
  const dos = ['4+12+4 satén (baño)', 'Termopanel 5+12+5 esmerilado'];
  assert.equal(fraseBanoPerdido(['4+12+4 satén (baño)']), 'dice "4+12+4 satén (baño)" pero se cotizó con vidrio claro');
  assert.equal(fraseBanoPerdido(dos), 'dice "4+12+4 satén (baño)" y "Termopanel 5+12+5 esmerilado" pero se cotizó con vidrio claro');
  // El texto que lee el dueño NO cambió con la extracción (el cooldown de highValueNotifier se calcula sobre él).
  assert.equal(textoBanoPerdido('CM-FR-004-2026-0601', dos),
    'La propuesta CM-FR-004-2026-0601 dice "4+12+4 satén (baño)" y "Termopanel 5+12+5 esmerilado" pero se cotizó con vidrio claro; revisar precio.');
});

test('[r8] motivoDeEnvio: el porqué de un envío que no salió, de cualquiera de los dos canales (nunca vacío)', () => {
  // Texto: lo que devuelve notifyHighValue.
  assert.equal(motivoDeEnvio({ sent: false, reason: 'envio_fallido', code: 131047, error: '{"e":1}' }), 'envio_fallido code=131047 {"e":1}');
  assert.equal(motivoDeEnvio({ sent: false, reason: 'no_owner_phone' }), 'no_owner_phone');
  assert.equal(motivoDeEnvio({ sent: false, reason: 'excepcion', error: 'boom' }), 'excepcion boom');
  // Plantilla: la FORMA REAL de /admin/send-template es {ok, template, phone, result}, y el error de Meta vive en `result.error`.
  assert.equal(motivoDeEnvio({ ok: false, template: 'informe_diario', phone: '569', result: { ok: false, error: 'meta_credentials_missing' } }),
    'meta_credentials_missing');
  assert.equal(motivoDeEnvio({ ok: false, error: 'ADMIN_PIN_missing' }), 'ADMIN_PIN_missing', 'el fallo propio de escalation.js: `error` arriba');
  // Un `error` vacío ('' / null) no deja el motivo vacío: cae a lo siguiente (`||`, no `??`).
  assert.equal(motivoDeEnvio({ ok: false, error: '', result: { error: 'x' } }), 'x');
  assert.equal(motivoDeEnvio({ ok: false, error: '', reason: 'raro' }), 'raro');
  // Sin nada que decir.
  assert.equal(motivoDeEnvio(null), 'excepcion', 'el envío lanzó y safe() lo tragó');
  assert.equal(motivoDeEnvio(undefined), 'excepcion');
  assert.equal(motivoDeEnvio({}), 'sin_confirmacion');
  assert.equal(motivoDeEnvio({ ok: false, error: '' }), 'sin_confirmacion');
  assert.equal(motivoDeEnvio({ error: 'x'.repeat(500) }).length, 200, 'acotado: va a un log y a un evento del panel');
});

test('[r8] la ventana de repetición ES el cooldown del texto: UNA constante, importada (no otra copia de «2 h»)', () => {
  // Si fuera MENOR, vencería la marca y volvería a salir la plantilla mientras el texto sigue en cooldown.
  assert.equal(AVISO_VIDRIO_REPETIR_MS, COOLDOWN_MS);
});

/* ── r5 · Thermos BAJO: «satén» es UNA definición, la del dibujo ───────────────────────────────────── */

test('🔴 [r5] esBano cubre lo que su comentario dice: satinado, satin, acidado, mate, opaco, translúcido (y el motor satén lo salva)', () => {
  for (const etiqueta of ['4+12+4 satinado', 'Termopanel 4+12+4 satin', 'DVH 4+12+4 acidado', 'Termopanel mate 4+12+4',
    'Vidrio opaco 4+12+4', 'Termopanel translúcido 4+12+4', 'Termopanel 4+12+4 translucido', 'TERMOPANEL SATINADO']) {
    assert.deepEqual(elegirVidrio(etiqueta, '4+12+4'), { vidrio: etiqueta, aviso: 'vidrio.bano_perdido' }, etiqueta);
    assert.equal(elegirVidrio(etiqueta, '4+12+4 satén (baño)').aviso, null, `${etiqueta}: si el motor TAMBIEN es satén, manda el motor`);
  }
  // Control: nada de esto es satén.
  for (const etiqueta of ['Termopanel DVH', '4+12+4', 'DVH 5/12/5 claro', 'Termopanel urbano 4+12+4']) {
    assert.notEqual(elegirVidrio(etiqueta, '4+12+4').aviso, 'vidrio.bano_perdido', etiqueta);
  }
});

test('🔴 [r5] UNA sola definición: esBano (vidrioCotizado) y claveVidrio (dibujoVentana) no pueden discrepar', () => {
  // Si alguien agrega una palabra en uno y no en el otro, el PDF dibujaría un vidrio opaco que el
  // aviso al dueño no reconoce (o al revés). Misma pregunta, misma respuesta; `claveVidrio(e, e)`
  // porque esBano también aplica la regla del ambiente a la etiqueta ("baño" suelto).
  for (const e of ['4+12+4 satén (baño)', '4+12+4 saten', 'satinado', 'esmerilado', 'Esmerilada', 'acidado', 'mate', 'opaco',
    'translucido', 'translúcido', 'Termopanel DVH baño', 'DVH 4+12+4 BAÑO', 'wc', 'Termopanel ducha',
    'Termopanel DVH', '4+12+4', 'DVH 5/12/5', 'laminado 6+6', 'Termopanel urbano', 'low-e',
    'Termopanel DVH material guardian', 'capacidad']) {
    assert.equal(elegirVidrio(e, '4+12+4').aviso === 'vidrio.bano_perdido', claveVidrio(e, e) === 'satinado', `"${e}"`);
  }
});

/* ── r6 · Thermos BAJO: «mate» y «acid» son PALABRAS, no pedazos de palabra ─────────────────────────── */

// CAUSA RAÍZ: `PALABRAS_SATEN` era una regex de SUBCADENA sin ancla (heredada tal cual del `t.includes(...)`
// de claveVidrio): «mate» calzaba dentro de «MATErial» y «acid» dentro de «capACIDad». Un rótulo
// «Termopanel DVH material guardian» se dibujaba satén (opaco) y, peor, disparaba el aviso al dueño por
// «satén perdido» contra un vidrio claro que estaba bien.
// Se ancla al INICIO de palabra con «no precedido por una LETRA», NO con `\b`: `\b` trata `_` y los dígitos
// como letras, y «dvh_acidado» / «4+12+4mate» —que calzaban antes— dejarían de calzar (regresión).
test('🔴 [r6] «material» y «capacidad» NO son satén: ni el dibujo, ni el aviso, ni dicePalabraSaten', () => {
  for (const e of ['material', 'Materiales', 'Termopanel DVH material guardian', 'MATERIAL', 'matemática', 'capacidad', 'Capacidad de carga',
    'Termopanel capacidad 4+12+4', 'tenacidad', 'veracidad']) {
    assert.equal(dicePalabraSaten(e), false, `dicePalabraSaten("${e}")`);
    assert.equal(claveVidrio(e), 'incoloro', `claveVidrio("${e}") dibuja un vidrio que se ve`);
    assert.notEqual(elegirVidrio(e, '4+12+4').aviso, 'vidrio.bano_perdido', `"${e}" no avisa «satén perdido»`);
    assert.deepEqual(elegirVidrio(e, '5+12+5'), { vidrio: '5+12+5', aviso: null }, `"${e}": manda el motor sin avisos`);
  }
});

test('🔴 [r6] control — lo que SÍ es satén sigue siéndolo, también pegado a `_`, dígitos y signos (no se rompió nada)', () => {
  for (const e of ['mate', 'Mate', 'MATE', 'mates', 'mateado', 'Mateada', 'vidrios mateados', 'Termopanel mate 4+12+4', 'vidrio mate.', 'DVH (mate)', 'DVH,mate', 'baño-mate',
    'acidado', 'Acidado', 'DVH acidado', 'vidrio acido', 'dvh_acidado', 'dvh_mate', '4+12+4mate', '4+12+4saten', 'dvh_saten',
    'Termopanel/acidado', 'satén', 'SATÉN', 'Satinado por norma', 'satinada', 'esmerilado', 'Esmerilada', 'opaco', 'dvh_opaco',
    'translúcido', 'Translucido', '4+12+4 translúcida']) {
    assert.equal(dicePalabraSaten(e), true, `dicePalabraSaten("${e}")`);
    assert.equal(claveVidrio(e), 'satinado', `claveVidrio("${e}")`);
    assert.equal(elegirVidrio(e, '4+12+4').aviso, 'vidrio.bano_perdido', `"${e}" sigue avisando «satén perdido»`);
  }
});


