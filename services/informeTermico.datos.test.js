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
const VIEJO = { glassLabel: '4+12+4 low-e', uw: 1.9, producto: 'Proyectante S60', ventanas: V_VIEJAS };

test('con datos de la cotización se usan ESOS, y se recuerdan', () => {
  const r = datosDelInforme(FRESCO, null);
  assert.deepEqual(r.datos, FRESCO);
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
  assert.deepEqual(r.datos, VIEJO, 'el cero no puede desplazar al dato real recordado');
});

test('normaliza los huecos: undefined y cadena vacía entran como null', () => {
  // Lo que se guarda se vuelve a leer más tarde; si se guardaran `undefined`, al volver de
  // la serialización JSON el campo desaparecería y el rescate fallaría en silencio.
  const r = datosDelInforme({ glassLabel: '4+12+4', uw: undefined, producto: undefined }, null);
  assert.deepEqual(r.datos, { glassLabel: '4+12+4', uw: null, producto: '', ventanas: [] });
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

test('🔴 el proyecto entrante REEMPLAZA al recordado (cada turno trae el suyo completo)', () => {
  const nuevas = [{ id: 'V1', producto: 'Fijo S60', medidas: '900x900mm', vidrio: '5+12+5', uw: 2.4 }];
  const r = datosDelInforme({ glassLabel: '', uw: null, producto: '', ventanas: nuevas }, VIEJO);
  assert.deepEqual(r.datos.ventanas, nuevas, 'manda el proyecto recien cotizado');
  assert.equal(r.recordar, true);
});

test('🔴 DOS ventanas iguales del mismo turno son DOS ventanas', () => {
  // Un living con dos correderas gemelas es lo mas comun del mundo: nada puede fusionarlas.
  const v = { id: 'V1', producto: 'Corredera S60', medidas: '2000x1400mm', vidrio: 'DVH 5/12/5', uw: 2.71 };
  const r = datosDelInforme({ ventanas: [v, { ...v, id: 'V2' }] }, null);
  assert.equal(r.datos.ventanas.length, 2);
});
