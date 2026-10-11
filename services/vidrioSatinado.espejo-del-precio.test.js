// vidrioSatinado.espejo-del-precio.test.js — [2026-10-11]
//
// 🔴 EL INVARIANTE QUE ESTE LOTE VINO A ESTABLECER, Y QUE NO TENÍA GUARDIA.
//
// Hasta el 11-10 había DOS definiciones de «esto es un baño»: una en `enginePricer.pickGlassId`
// (que decide el PRECIO) y otra en `vidrioSatinado.esAmbienteBano` (que decide el DIBUJO y el aviso
// al dueño). Discrepaban en 6 de 12 palabras, así que una ventana podía DIBUJARSE opaca y COBRARSE
// clara, o al revés — el documento contradiciendo al cobro en una propuesta formal.
//
// Se unificó: el pricer importa `esAmbienteBano`. Pero un `import` se sombrea con un `const` local
// sin que falle nada, y el comentario de `vidrioSatinado.js` prometía ESTE archivo, que no existía
// (lo cazó Thermos en la compuerta: «el titular del lote está pendiente de defensa, no cerrado»).
//
// Lo que se defiende acá es la DECISIÓN —«el precio y el dibujo preguntan lo mismo»— y no dos
// implementaciones por separado. Por eso hay UN SOLO corpus: si alguien agrega una palabra en un
// lado y no en el otro, este test se pone rojo sin que haya que acordarse de tocar dos listas.
// (Antes de este archivo, los corpus estaban duplicados A MANO en `enginePricer.test.js` y en
// `dibujoVentana.compuesta.test.js`, y ya divergían: el mismo patrón que el lote vino a matar.)

import test from 'node:test';
import assert from 'node:assert/strict';
import { pickGlassId } from './enginePricer.js';
import { VIDRIO_BASE } from './vidriosBase.js';
import { esAmbienteBano, diceRotuloDeBano } from './vidrioSatinado.js';
import { claveVidrio } from './dibujoVentana.js';

/** UN SOLO corpus. Las 8 primeras son formas REALES medidas contra la BD viva (365 días, 99
 *  ambientes distintos escritos por vendedores); las demás son las que el lote decidió. */
const CORPUS = [
  // — las que SÍ son una ventana de baño —
  { amb: 'baño', bano: true, por: 'la forma más común: 115 casos reales' },
  { amb: 'baño visitas', bano: true, por: '4 casos reales' },
  { amb: 'baños', bano: true, por: '3 casos reales' },
  { amb: 'baño uno', bano: true, por: '2 casos reales' },
  { amb: 'baño 1', bano: true, por: '2 casos reales' },
  { amb: 'baños/despensa', bano: true, por: '1 caso real, y es un baño' },
  { amb: 'baño visita', bano: true, por: '1 caso real' },
  { amb: 'baño 1er piso', bano: true, por: '1 caso real' },
  { amb: 'bano', bano: true, por: 'sin la ñ' },
  { amb: 'BAÑO', bano: true, por: 'en mayúsculas' },
  { amb: 'baño2', bano: true, por: 'pegado a un dígito: por esto NO se usa \\b' },
  { amb: 'wc2', bano: true, por: 'ídem' },
  { amb: 'bano_1', bano: true, por: 'pegado a un guion bajo: \\b lo cuenta como letra y lo perdería' },
  { amb: 'wc', bano: true, por: null },
  { amb: 'W/C', bano: true, por: null },
  { amb: 'water', bano: true, por: null },
  { amb: 'antebaño', bano: true, por: 'la regla vieja del precio SÍ lo tomaba: sacarlo sería cobrar de menos' },
  // — las que NO lo son, y por qué —
  { amb: 'ducha', bano: false, por: 'HECHO DEL NEGOCIO (dueño 11-10): es mampara de vidrio templado' },
  { amb: 'bañera', bano: false, por: 'ídem: mampara de vidrio templado, otro producto' },
  { amb: 'mampara de ducha', bano: false, por: 'otro producto; además está fuera de catálogo' },
  { amb: 'urbano', bano: false, por: 'contiene «bano» y se COBRABA satén hasta el 11-10' },
  { amb: 'living urbano', bano: false, por: 'ídem' },
  { amb: 'waterloo', bano: false, por: 'contiene «water»' },
  { amb: 'urbanizacion', bano: false, por: 'ídem' },
  { amb: 'Cocina', bano: false, por: null },
  { amb: 'Living', bano: false, por: null },
  { amb: 'Dormitorio', bano: false, por: null },
  { amb: '', bano: false, por: 'sin ambiente no se supone nada' },
];

test('🔴 ESPEJO: el PRECIO y el DIBUJO contestan lo mismo a «¿esto es un baño?»', () => {
  for (const { amb, bano, por } of CORPUS) {
    const precio = pickGlassId(600, 400, amb) === VIDRIO_BASE.BANO;
    const dibujo = claveVidrio('Termopanel DVH 4+12+4', amb) === 'satinado';
    assert.equal(precio, dibujo,
      `«${amb}»: el precio dice ${precio ? 'baño' : 'no'} y el dibujo dice ${dibujo ? 'baño' : 'no'} — ` +
      'una propuesta formal no puede dibujar un vidrio distinto del que cobra');
    assert.equal(precio, bano, `«${amb}» tiene que ser ${bano ? 'baño' : 'NO baño'}${por ? ` (${por})` : ''}`);
  }
});

test('🔴 ESPEJO: la función del ambiente es la MISMA que usa el precio', () => {
  // Si alguien vuelve a declarar un criterio propio dentro de enginePricer.js, el test de arriba
  // sigue verde mientras las dos listas coincidan en estas palabras. Este lo caza igual.
  for (const { amb } of CORPUS) {
    assert.equal(pickGlassId(600, 400, amb) === VIDRIO_BASE.BANO, esAmbienteBano(amb),
      `«${amb}»: el precio dejó de preguntarle a esAmbienteBano`);
  }
});

// 🔴 [Thermos, compuerta 11-10] EL VOCABULARIO DEL RÓTULO ES OTRO, Y TIENE QUE SEGUIR SIÉNDOLO.
// Al unificar la regla del AMBIENTE se apagó EN SILENCIO el aviso al dueño por «satén perdido»
// cuando el rótulo que escribió el LLM decía «ducha»/«toilet»/«bañera»: el rótulo pasaba a
// reemplazarse por un termopanel claro y nadie se enteraba. Son dos dominios distintos: como
// RECINTO una ducha es una mampara; como palabra DENTRO DE UN RÓTULO es «esto no es el claro».
test('🔴 el vocabulario del RÓTULO incluye ducha/toilet/bañera, el del AMBIENTE no', () => {
  for (const t of ['vidrio de ducha', 'vidrio toilet', 'termopanel banera', 'Termopanel 4+12+4 satén (baño)']) {
    assert.equal(diceRotuloDeBano(t), true, `«${t}» como RÓTULO dice baño: el dueño tiene que enterarse`);
  }
  for (const a of ['ducha', 'bañera', 'toilet']) {
    assert.equal(esAmbienteBano(a), false, `«${a}» como AMBIENTE no es una ventana de baño`);
  }
});
