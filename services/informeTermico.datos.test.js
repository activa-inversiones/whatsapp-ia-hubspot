// informeTermico.datos.test.js — [2026-08-24]
//
// EL DEFECTO: el informe térmico se dispara por dos caminos y solo uno trae los datos del
// cliente. `calcular_cotizacion` llega con el vidrio, el Uw y el producto recién
// calculados; la tool `enviar_informe_termico` —la que se usa cuando el cliente PIDE el
// informe o dice que no le llegó— delega con `{ forzar: true }` a secas.
//
// O sea: justo al cliente que lo pide se le mandaba el informe DESPERSONALIZADO, sin el
// recuadro "LA VENTANA DE SU COTIZACIÓN". Y hasta el fix del mismo día era peor, porque el
// Uw ausente se dibujaba como «0,00 W/m²K · CUMPLE».
//
// Importa hoy y no en abstracto: los 3 clientes que quedaron bloqueados por el bug del
// candado van a llegar por ESE camino, el del re-envío.
//
// Verificado matando el mutante.

import test from 'node:test';
import assert from 'node:assert/strict';
import { datosDelInforme } from './informeTermico.js';

const V_FRESCAS = [{ id: 'V1', producto: 'Corredera SLIDING H80', vidrio: '4+12+4', uw: 2.61 }];
const FRESCO = { glassLabel: '4+12+4', uw: 2.61, producto: 'Corredera SLIDING H80', ventanas: V_FRESCAS };
const V_VIEJAS = [{ id: 'V1', producto: 'Proyectante S60', vidrio: '4+12+4 low-e', uw: 1.9 }];
// [2026-08-24] `ventanasAt` = sello de la tanda. Sin el, la memoria se considera de otro
// proyecto y las ventanas nuevas REEMPLAZAN en vez de sumarse — que es el comportamiento
// correcto entre tandas, pero no el que estos tests quieren ejercitar.
const VIEJO = { glassLabel: '4+12+4 low-e', uw: 1.9, producto: 'Proyectante S60', ventanas: V_VIEJAS, ventanasAt: Date.now() };

test('con datos de la cotización se usan ESOS, y se recuerdan', () => {
  const r = datosDelInforme(FRESCO, null);
  assert.deepEqual({ ...r.datos, ventanasAt: undefined }, { ...FRESCO, ventanasAt: undefined });
  assert.ok(Number.isFinite(r.datos.ventanasAt), 'y queda sellada la tanda');
  assert.equal(r.recordar, true, 'hay que guardarlos para el re-envío que venga después');
});

test('🔴 el re-envío sin datos RESCATA los de la última cotización', () => {
  // Este es el caso de los 3 clientes del 24-ago: piden el informe, y la tool no tiene
  // de dónde sacar el Uw. Sin rescate, reciben un folleto.
  const r = datosDelInforme({ glassLabel: '', uw: null, producto: '' }, VIEJO);
  assert.deepEqual(r.datos, VIEJO);
  assert.equal(r.recordar, false, 'no se re-guarda lo que ya estaba guardado');
});

test('🔒 lo fresco NUNCA se pisa con lo viejo', () => {
  // La inversión sería silenciosa y cara: el cliente cambia a un vidrio mejor, recotiza, y
  // el informe le declara el Uw del vidrio anterior. Un número correcto de otro proyecto.
  const r = datosDelInforme(FRESCO, VIEJO);
  // [2026-08-24] El REEMPLAZO sigue valiendo para los tres campos de resumen. Lo que
  // cambio es `ventanas`, que ahora ACUMULA: son la coleccion del proyecto, no un dato
  // suelto. Confundir las dos cosas fue lo que dejo el informe con una sola ventana.
  assert.equal(r.datos.glassLabel, FRESCO.glassLabel, 'la cotización de ahora manda sobre la memoria');
  assert.equal(r.datos.uw, FRESCO.uw);
  assert.equal(r.datos.producto, FRESCO.producto);
  assert.equal(r.recordar, true);
});

test('sin nada en ninguna parte, el informe sale sin recuadro (y no rompe)', () => {
  const r = datosDelInforme({ glassLabel: '', uw: null, producto: '' }, null);
  assert.deepEqual(r.datos, { glassLabel: '', uw: null, producto: '', ventanas: [] });
  assert.equal(r.recordar, false, 'no tiene sentido recordar el vacío');
});

test('un dato solo alcanza para considerar que hay datos', () => {
  // Puede venir el Uw sin el label del vidrio, o al revés. Cualquiera de los tres
  // personaliza el informe, así que ninguno se descarta por venir solo.
  assert.equal(datosDelInforme({ glassLabel: '', uw: 2.61, producto: '' }, VIEJO).datos.uw, 2.61);
  assert.equal(datosDelInforme({ glassLabel: '4+12+4', uw: null, producto: '' }, VIEJO).datos.glassLabel, '4+12+4');
  assert.equal(datosDelInforme({ glassLabel: '', uw: null, producto: 'Fijo S60' }, VIEJO).datos.producto, 'Fijo S60');
});

test('🔒 un Uw de 0 no cuenta como dato', () => {
  // Mismo criterio que en el PDF: `0` es lo que devuelve `Number(null)`, no una medición.
  // Si contara, un cero espurio pisaría la memoria buena y se declararía en su lugar.
  const r = datosDelInforme({ glassLabel: '', uw: 0, producto: '' }, VIEJO);
  assert.deepEqual({ ...r.datos, ventanasAt: 0 }, { ...VIEJO, ventanasAt: 0 },
    'el cero no puede desplazar al dato real recordado');
});

test('normaliza los huecos: undefined y cadena vacía entran como null', () => {
  // Lo que se guarda se vuelve a leer más tarde; si se guardaran `undefined`, al volver de
  // la serialización JSON el campo desaparecería y el rescate fallaría en silencio.
  const r = datosDelInforme({ glassLabel: '4+12+4', uw: undefined, producto: undefined }, null);
  assert.deepEqual({ ...r.datos, ventanasAt: 0 }, { glassLabel: '4+12+4', uw: null, producto: '', ventanas: [], ventanasAt: 0 });
  assert.equal(JSON.parse(JSON.stringify(r.datos)).uw, null, 'sobrevive al viaje por JSON');
});

test('recordados corrupto no tumba nada', () => {
  // `leerEstado` puede devolver cualquier cosa: un string, un número, lo que quedó de una
  // versión anterior del formato.
  for (const basura of ['texto', 42, [], { otra: 'cosa' }]) {
    const r = datosDelInforme({ glassLabel: '', uw: null, producto: '' }, basura);
    assert.deepEqual(r.datos, { glassLabel: '', uw: null, producto: '', ventanas: [] }, `con ${JSON.stringify(basura)}`);
  }
});

test('🔴 un proyecto de VARIAS ventanas se recuerda entero', () => {
  // Pedido del dueño (24-ago): el informe lista todas las ventanas, no `items[0]`. Si la
  // memoria solo guardara el resumen, el cliente que PIDE el informe volvería a recibir
  // una sola ventana y perderíamos justo lo que se acaba de construir.
  const seis = Array.from({ length: 6 }, (_, i) => ({ id: `V${i + 1}`, producto: 'Corredera', vidrio: '4+12+4', uw: 2.6 + i / 100 }));
  const r = datosDelInforme({ glassLabel: '4+12+4', uw: 2.6, producto: 'Corredera', ventanas: seis }, null);
  assert.equal(r.datos.ventanas.length, 6, 'las seis viajan a la memoria');
  assert.equal(r.recordar, true);
  assert.equal(JSON.parse(JSON.stringify(r.datos)).ventanas.length, 6, 'y sobreviven al viaje por JSON');
});

test('🔴 un proyecto SIN NINGÚN Uw se recuerda igual: existe aunque no se pueda calcular', () => {
  // El caso medido en producción: correderas H98 (área ≥ 4 m²), cuyo perfil la API térmica
  // todavía no tiene cargado. Sin este criterio, `hay()` diría "no hay datos" y el proyecto
  // entero se perdería — el cliente vería un folleto en vez de sus 3 ventanas rotuladas
  // "perfil en certificación".
  const h98 = [
    { id: 'V1', producto: 'Corredera SLIDING H98', vidrio: '5+12+5', uw: null },
    { id: 'V2', producto: 'Corredera SLIDING H98', vidrio: '5+12+5', uw: null },
  ];
  const r = datosDelInforme({ glassLabel: '', uw: null, producto: '', ventanas: h98 }, null);
  assert.equal(r.recordar, true, 'un proyecto sin Uw sigue siendo un proyecto');
  assert.equal(r.datos.ventanas.length, 2);
});

test('🔴 las ventanas nuevas se SUMAN a las viejas, no las reemplazan', () => {
  // Este test decia lo contrario y estaba mal. Fijaba que el proyecto recien cotizado
  // pisara al recordado — que es justo lo que hacia que un cliente con ocho ventanas
  // recibiera un informe con la ultima. Ver el bloque de abajo para la evidencia.
  const nuevas = [{ id: 'V1', producto: 'Fijo S60', medidas: '900x900mm', vidrio: '5+12+5', uw: 2.4 }];
  const r = datosDelInforme({ glassLabel: '', uw: null, producto: '', ventanas: nuevas }, VIEJO);
  assert.equal(r.datos.ventanas.length, V_VIEJAS.length + 1, 'las de antes siguen ahí');
  assert.deepEqual(r.datos.ventanas.at(-1), nuevas[0], 'y la nueva se agrega al final');
  assert.equal(r.recordar, true);
});

// ── 🔴 [2026-08-24 · Codex, 2a pasada] LAS VENTANAS SE ACUMULAN ─────────────────────
// EL HALLAZGO: `calcular_cotizacion` cotiza UNA partida por llamada (tools.js arma
// `items: [{...}]`), asi que un cliente con ocho ventanas produce OCHO llamadas, cada una
// con SU ventana. Si la memoria REEMPLAZA, el informe termina con una sola — que es
// exactamente el defecto que este lote vino a arreglar, sobreviviendo al arreglo.
//
// Asi se lee la evidencia real: los folios 0003 (Uw 2,71) y 0004 (sin Uw) del mismo
// cliente no eran un informe repetido, eran sus DOS ventanas en documentos separados.
//
// Los otros tres campos (vidrio, Uw, producto) siguen la regla vieja —lo entrante manda—
// porque son el RESUMEN de la ultima cotizacion, no una coleccion.

test('🔴 las ventanas de dos cotizaciones se ACUMULAN, no se reemplazan', () => {
  const v1 = { id: 'V1', producto: 'Corredera S60', medidas: '2000x1400mm', vidrio: 'DVH 5/12/5', uw: 2.71 };
  const v2 = { id: 'V2', producto: 'Corredera H98', medidas: '3250x1460mm', vidrio: 'DVH 5/12/5', uw: null };
  const r = datosDelInforme({ glassLabel: 'DVH 5/12/5', uw: null, producto: 'Corredera H98', ventanas: [v2] },
    { glassLabel: 'DVH 5/12/5', uw: 2.71, producto: 'Corredera S60', ventanas: [v1], ventanasAt: Date.now() });
  assert.equal(r.datos.ventanas.length, 2, 'las dos ventanas del proyecto');
  assert.equal(r.datos.ventanas[0].medidas, '2000x1400mm', 'y en el orden en que se cotizaron');
  assert.equal(r.datos.ventanas[1].medidas, '3250x1460mm');
  assert.equal(r.recordar, true, 'hay que volver a guardar el acumulado');
});

test('🔴 DOS ventanas iguales son dos ventanas — no se deduplican', () => {
  // El primer intento deduplicaba por producto+medidas+vidrio y estaba mal por una razon
  // de negocio: un living con dos correderas gemelas es lo mas comun del mundo. Fusionarlas
  // hacia que el informe declarara una ventana menos de las que el cliente compra, o sea
  // el mismo defecto que este lote vino a arreglar, con otra cara.
  const v = { id: 'V1', producto: 'Corredera S60', medidas: '2000x1400mm', vidrio: 'DVH 5/12/5', uw: 2.71 };
  const r = datosDelInforme({ ventanas: [{ ...v, id: 'V2' }] }, { ventanas: [v], ventanasAt: Date.now() });
  assert.equal(r.datos.ventanas.length, 2, 'dos correderas gemelas son dos ventanas');
});

test('las ventanas se acumulan aunque el resto de los datos no cambie', () => {
  const a = { id: 'V1', producto: 'A', medidas: '1x1', vidrio: 'X', uw: 2.5 };
  const b = { id: 'V2', producto: 'B', medidas: '2x2', vidrio: 'X', uw: 2.6 };
  const c = { id: 'V3', producto: 'C', medidas: '3x3', vidrio: 'X', uw: null };
  const paso1 = datosDelInforme({ ventanas: [b] }, { ventanas: [a], ventanasAt: Date.now() }).datos;
  const paso2 = datosDelInforme({ ventanas: [c] }, paso1).datos;
  assert.deepEqual(paso2.ventanas.map((v) => v.producto), ['A', 'B', 'C'],
    'ocho llamadas tienen que dar ocho ventanas');
});

test('sin ventanas entrantes se conservan las recordadas', () => {
  const a = { id: 'V1', producto: 'A', medidas: '1x1', vidrio: 'X', uw: 2.5 };
  const r = datosDelInforme({ glassLabel: 'Y' }, { glassLabel: 'X', uw: 2.5, producto: 'A', ventanas: [a] });
  assert.equal(r.datos.ventanas.length, 1, 'el proyecto no se pierde por un dato suelto');
  assert.equal(r.datos.glassLabel, 'Y', 'pero el vidrio entrante sigue mandando');
});

// ── 🔴 [2026-08-24 · Gemini, 3a pasada] LA ACUMULACION SE CORTA POR TANDA ────────────
// EL RIESGO ESPEJO, y Gemini lo cazo con un caso que no habiamos pensado: la memoria vive
// 30 dias y no tenia ningun corte entre proyectos. Un cliente que cotiza 4 ventanas el
// lunes y otras 4 el viernes acumulaba OCHO. El candado de 30 dias evita el envio
// automatico —por eso creiamos que estaba cubierto— pero NO cubre el re-envio con
// `forzar: true`, que es cuando el cliente PIDE su informe: ahi recibia un documento
// firmado que mezcla el proyecto viejo, ya descartado, con el nuevo.
// Peor con la comuna: cotiza en Temuco y despues en Pucon, y el informe de Pucon certifica
// ventanas de Temuco contra la exigencia equivocada.
//
// El corte es por TIEMPO porque es el unico dato que tenemos: no hay id de proyecto ni de
// tanda. Dentro de la ventana se acumula (son las N llamadas de un mismo pedido); pasada
// la ventana, la cotizacion nueva REEMPLAZA, que es lo que el cliente quiere ver.

test('🔴 dos tandas separadas en el tiempo NO se mezclan', () => {
  const lunes = [{ id: 'V1', producto: 'Corredera', medidas: '1x1', vidrio: 'X', uw: 2.5 }];
  const viernes = { id: 'V1', producto: 'Proyectante', medidas: '2x2', vidrio: 'Y', uw: 2.4 };
  const t0 = 1_700_000_000_000;
  const r = datosDelInforme({ ventanas: [viernes] },
    { ventanas: lunes, ventanasAt: t0 }, t0 + 4 * 24 * 3600 * 1000);
  assert.equal(r.datos.ventanas.length, 1, 'el proyecto viejo no viaja al informe nuevo');
  assert.deepEqual(r.datos.ventanas[0], viernes);
});

test('🔴 dentro de la MISMA tanda se sigue acumulando', () => {
  // Las 8 llamadas de un proyecto llegan con ms de diferencia: eso es una sola tanda.
  const t0 = 1_700_000_000_000;
  const v1 = { id: 'V1', producto: 'A', medidas: '1x1', vidrio: 'X', uw: 2.5 };
  const v2 = { id: 'V2', producto: 'B', medidas: '2x2', vidrio: 'X', uw: 2.6 };
  const r = datosDelInforme({ ventanas: [v2] }, { ventanas: [v1], ventanasAt: t0 }, t0 + 300);
  assert.equal(r.datos.ventanas.length, 2, 'las dos ventanas del mismo pedido');
});

test('la marca de tiempo de la tanda se guarda para poder compararla', () => {
  const t0 = 1_700_000_000_000;
  const r = datosDelInforme({ ventanas: [{ id: 'V1', producto: 'A', medidas: '1x1', vidrio: 'X', uw: 2.5 }] }, null, t0);
  assert.equal(r.datos.ventanasAt, t0, 'sin el sello no hay forma de saber si es otra tanda');
});

test('memoria vieja SIN sello: se trata como otra tanda, no se mezcla', () => {
  // Compatibilidad hacia atras: lo guardado antes de este cambio no tiene `ventanasAt`.
  // Ante la duda, NO mezclar: mostrar de menos es recuperable, mezclar proyectos no.
  const viejo = { ventanas: [{ id: 'V1', producto: 'A', medidas: '1x1', vidrio: 'X', uw: 2.5 }] };
  const nueva = { id: 'V9', producto: 'Z', medidas: '9x9', vidrio: 'Y', uw: 2.2 };
  const r = datosDelInforme({ ventanas: [nueva] }, viejo, 1_700_000_000_000);
  assert.deepEqual(r.datos.ventanas, [nueva]);
});
