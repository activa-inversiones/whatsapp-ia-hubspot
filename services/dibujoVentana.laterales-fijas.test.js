// [2026-10-14 · #1519] Guardias del ancla Winart 61156 / v72554 — las dos figuras que Oliver
// cotizaba mal o por separado:
//   (1) puerta envolvente exterior 560 + fijo 2000 = UNA compuesta (dos marcos + acople);
//   (2) corredera doble riel 3 hojas 4000×400 con las DOS laterales fijas y solo corre la del medio.
// Dueño, textual: «la corredera tiene los laterales fijos y solo el centro es corredera»;
// «necesito entregar a cliente la figura para que entienda lo que se le está cobrando».
import test from 'node:test';
import assert from 'node:assert/strict';
import { planoDeVentana, partesDesdeLabel, tipoDeParte } from './dibujoVentana.js';

const LBL = 'Corredera SLIDING H80 Doble Riel S75 3 hojas, laterales fijas';

test('corredera 3 hojas «laterales fijas»: solo corre la del medio, con manilla, en el riel interior', () => {
  const p = planoDeVentana({ measures: '4000x400mm', color: 'New Black', producto_label: LBL }, { x: 0, y: 0, w: 400, h: 300 });
  assert.equal(p.hojas.length, 3);
  const [izq, medio, der] = [0, 1, 2].map((i) => p.hojas.find((h) => h.idx === i));
  for (const lat of [izq, der]) {
    assert.equal(lat.tipo, 'CORREDERA', 'la lateral es una hoja corredera FIJADA (PI-SLD + suple), con bastidor');
    assert.equal(lat.sinBastidor, false);
    assert.equal(lat.fijaEnSitio, true);
    assert.equal(lat.flecha, 0, 'no corre: sin flecha');
    assert.equal(lat.manilla, null, 'no abre: sin manilla');
    assert.equal(lat.riel, 0, 'va por fuera, para que la del medio pase por delante');
  }
  assert.equal(medio.fijaEnSitio, false);
  assert.notEqual(medio.flecha, 0, 'la del medio es la UNICA que corre');
  assert.ok(medio.manilla, 'y cierra contra una lateral: lleva manilla');
  assert.equal(medio.riel, 1, 'riel interior (adelante)');
});

test('la «central fija» de antes NO cambia: siguen corriendo las dos laterales', () => {
  const it = { measures: '2710x1995mm', color: 'Blanco', producto_label: 'Corredera SLIDING H98 Doble Riel S75 — Triple hoja (central fija, laterales correderas)' };
  const p = planoDeVentana(it, { x: 0, y: 0, w: 400, h: 300 });
  assert.equal(p.hojas.find((h) => h.idx === 1).fijaEnSitio, true);
  assert.equal(p.hojas.find((h) => h.idx === 0).flecha, 1);
  assert.equal(p.hojas.find((h) => h.idx === 2).flecha, -1);
});

test('una corredera de 3 hojas normal (sin la frase) no se ve afectada', () => {
  const p = planoDeVentana({ measures: '3000x1200mm', producto_label: 'Corredera SLIDING H80 Doble Riel S75 3 hojas' }, { x: 0, y: 0, w: 400, h: 300 });
  assert.ok(p.hojas.every((h) => !h.fijaEnSitio));
});

test('compuesta con PUERTA_ENVOLVENTE: el paño puerta se dibuja como abatible, no como fijo', () => {
  assert.equal(tipoDeParte('PUERTA_ENVOLVENTE'), 'BATIENTE');
  assert.equal(tipoDeParte('PUERTA'), 'BATIENTE');
  const r = partesDesdeLabel({ producto_label: 'Ventana compuesta: Puerta envolvente 560mm + Fijo 2000mm' }, 2560, 1780);
  assert.ok(r && r.partes, 'se deriva del label');
  assert.deepEqual(r.partes.map((x) => x.tipo), ['BATIENTE', 'FIJA']);
  assert.deepEqual(r.partes.map((x) => x.ancho_mm), [560, 2000]);
});

test('compuesta puerta + fijo + puerta: tres paños, las dos puertas abatibles', () => {
  const r = partesDesdeLabel({ producto_label: 'Ventana compuesta: Puerta envolvente 560mm + Fijo 2180mm + Puerta envolvente 560mm' }, 3300, 1780);
  assert.ok(r && r.partes);
  assert.deepEqual(r.partes.map((x) => x.tipo), ['BATIENTE', 'FIJA', 'BATIENTE']);
});

// ── [#1519 · ronda 2] guardias de lo que cazaron Codex r1 y Thermos r1 ───────────────────────────

import { dibujarVentanaIso } from './dibujoIsometrico.js';
import { detectConfigCorredera, validateDimensionsLocal } from './enginePricer.js';

// Documento PDF falso que solo anota los textos que se escriben (el resto de la API devuelve el doc).
function docQueAnotaTextos() {
  const textos = [];
  const d = new Proxy({}, { get: (_o, k) => (k === 'textos' ? textos
    : (...a) => { if (k === 'text') textos.push(String(a[0])); return d; }) });
  return d;
}

test('🔒 [Codex r1 #5] el PDF rotula «FIJA» en LAS DOS laterales, no solo en la primera', () => {
  const d = docQueAnotaTextos();
  dibujarVentanaIso(d, { x: 0, y: 0, w: 400, h: 200 }, { measures: '4000x400mm', color: 'New Black', producto_label: LBL });
  assert.equal(d.textos.filter((t) => t === 'FIJA').length, 2);
});

test('🔒 [Thermos calidad] ida y vuelta: la frase que escribe el MOTOR es la que el dibujo reconoce, y nada más', () => {
  // Lo que escribe quoteEngine.sufijoHojasCorredera con hojas_fijas = 2:
  const p = planoDeVentana({ measures: '4000x400mm', producto_label: 'Corredera SLIDING H80 Doble Riel S75 3 hojas, laterales fijas' }, { x: 0, y: 0, w: 400, h: 300 });
  assert.equal(p.hojas.filter((h) => h.fijaEnSitio).length, 2);
  // Un texto libre que el motor NO cobró como laterales fijas no cambia la figura.
  const libre = planoDeVentana({ measures: '4000x400mm', producto_label: 'Corredera SLIDING H80 Doble Riel S75 3 hojas', descripcion: 'solo corre la del medio' }, { x: 0, y: 0, w: 400, h: 300 });
  assert.equal(libre.hojas.filter((h) => h.fijaEnSitio).length, 0, 'la figura muestra lo COBRADO, no lo escrito');
  // Y si el ítem trae el campo, manda el campo.
  const campo = planoDeVentana({ measures: '4000x400mm', producto_label: 'Corredera SLIDING H80 Doble Riel S75 3 hojas', hojas_fijas: 2 }, { x: 0, y: 0, w: 400, h: 300 });
  assert.equal(campo.hojas.filter((h) => h.fijaEnSitio).length, 2);
});

test('🔒 [Codex r1 #1] «no quiero laterales fijas» NO pide laterales fijas', () => {
  for (const t of ['corredera 3 hojas, no quiero laterales fijas', 'corredera 3 hojas, los lados no son fijos']) {
    const r = detectConfigCorredera(t, 3);
    assert.equal(r.lateralesFijas, false, t);
    assert.notEqual(r.activos, 1, t);
  }
});

test('🔒 [Codex r1 #2] gana la ÚLTIMA decisión; en la MISMA frase se contradice → escala', () => {
  const a = detectConfigCorredera('quiero triple riel. ahora prefiero laterales fijas', 3);
  assert.equal(a.lateralesFijas, true); assert.equal(a.riel, 'DOBLE'); assert.equal(a.activos, 1);
  const b = detectConfigCorredera('laterales fijas. mejor que corran las tres', 3);
  assert.equal(b.lateralesFijas, false); assert.equal(b.riel, 'TRIPLE');
  const c = detectConfigCorredera('laterales fijas pero que corran las tres', 3);
  assert.equal(c.ambiguo, true, 'dos configuraciones incompatibles en la misma frase');
  const e = detectConfigCorredera('la del medio fija y laterales fijas', 3);
  assert.equal(e.ambiguo, true);
});

test('🔒 [Codex r1 #3] «la central es corredera y las laterales también» NO son laterales fijas', () => {
  const r = detectConfigCorredera('corredera de 3 hojas, la central es corredera y las laterales también', 3);
  assert.equal(r.lateralesFijas, false);
  assert.notEqual(r.activos, 1);
});

test('🔒 [Thermos r1] una compuesta con PUERTA valida su alto contra el máximo de PUERTA (2400), no de ventana', () => {
  assert.equal(validateDimensionsLocal('Ventana compuesta: Puerta envolvente 560mm + Fijo 2000mm', 2560, 2100), null,
    '2100 de alto es una puerta normal');
  assert.ok(validateDimensionsLocal('Ventana compuesta: Puerta envolvente 560mm + Fijo 2000mm', 2560, 2500)?.referencial);
  assert.ok(validateDimensionsLocal('Ventana compuesta: Fijo 1200mm + Proyectante 800mm', 2000, 2100)?.referencial,
    'sin puerta sigue el límite de ventana');
});

test('🔒 [Thermos r1] el blindaje de precio reconoce «3 hojas, laterales fijas» como CORREDERA', async () => {
  // [Codex r2 #7] Se importa la función REAL del webhook (la que usa el blindaje en webhook.js), no una
  // copia reconstruida desde el fuente.
  const { aperturaFromLabel } = await import('../src/oliver-gpt/webhook.js');
  assert.equal(aperturaFromLabel('Corredera SLIDING H80 Doble Riel S75 3 hojas, laterales fijas'), 'CORREDERA');
  assert.equal(aperturaFromLabel('Corredera SLIDING H98 Doble Riel S75 3 hojas, central fija'), 'CORREDERA');
});

// ── [#1519 · ronda 3] guardias de lo que cazó Codex r2 ───────────────────────────────────────────
test('🔴 [Codex r2 #1] puerta + fijo de IGUAL medida NO se descartan: viajan los paños', async () => {
  const { partesParaMotor } = await import('../src/oliver-gpt/tools.js');
  const pf = [{ tipo: 'PUERTA_ENVOLVENTE', ancho_mm: 1000 }, { tipo: 'FIJA', ancho_mm: 1000 }];
  assert.deepEqual(partesParaMotor(pf), pf);
  const pfp = [{ tipo: 'PUERTA', ancho_mm: 560 }, { tipo: 'FIJA', ancho_mm: 560 }, { tipo: 'PUERTA', ancho_mm: 560 }];
  assert.deepEqual(partesParaMotor(pfp), pfp, 'tres paños nunca son el default');
  // El default de siempre (mitad fija + mitad proyectante iguales) se sigue dejando al motor.
  assert.equal(partesParaMotor([{ tipo: 'FIJA', ancho_mm: 1100 }, { tipo: 'PROYECTANTE', ancho_mm: 1100 }]), undefined);
  // Un reparto desigual explícito se respeta, como antes.
  const des = [{ tipo: 'FIJA', ancho_mm: 1200 }, { tipo: 'PROYECTANTE', ancho_mm: 800 }];
  assert.deepEqual(partesParaMotor(des), des);
});

test('🔴 [Codex r2 #2] la negación es por TRAMO: gana la última afirmación', () => {
  const a = detectConfigCorredera('no quiero laterales fijas. ahora quiero laterales fijas', 3);
  assert.equal(a.lateralesFijas, true, 'cambió de idea: la última manda');
  const b = detectConfigCorredera('laterales fijas no, que corran las tres', 3);
  assert.equal(b.lateralesFijas, false); assert.equal(b.ambiguo, false); assert.equal(b.riel, 'TRIPLE');
  const c = detectConfigCorredera('corredera 3 hojas, los laterales fijos no', 3);
  assert.equal(c.lateralesFijas, false);
  const d = detectConfigCorredera('laterales fijas. no quiero laterales fijas', 3);
  assert.equal(d.lateralesFijas, false, 'la última es la negación');
  // [NIM r1, verificado] la forma «solo corre la del medio» también se niega; «no, solo corre…» afirma.
  assert.equal(detectConfigCorredera('corredera 3 hojas, solo corre la del medio no', 3).lateralesFijas, false);
  assert.equal(detectConfigCorredera('corredera 3 hojas, no, solo corre la del medio', 3).lateralesFijas, true);
  assert.equal(detectConfigCorredera('corredera 3 hojas, no laterales fijas', 3).lateralesFijas, false);
});

test('🔴 [Codex r2 #4] una descripción libre no cambia la figura de lo cobrado', () => {
  const p = planoDeVentana({ measures: '4000x400mm', producto_label: 'Corredera SLIDING H80 Doble Riel S75 3 hojas', descripcion: 'el cliente dijo laterales fijas, falta recotizar' }, { x: 0, y: 0, w: 400, h: 300 });
  assert.equal(p.hojas.filter((h) => h.fijaEnSitio).length, 0);
});

test('🔒 [Codex r2 #6] «PUERTA COMPUESTA EXTERIOR» sigue siendo una puerta para el límite de medidas', () => {
  assert.ok(validateDimensionsLocal('PUERTA COMPUESTA EXTERIOR', 2500, 2000)?.referencial, 'puerta de 2500 de ancho avisa');
  assert.equal(validateDimensionsLocal('Ventana compuesta: Puerta envolvente 560mm + Fijo 2000mm', 2560, 1780), null,
    'la pieza del dueño (Winart v72554) NO sale referencial');
});
