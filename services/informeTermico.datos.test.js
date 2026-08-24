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

const FRESCO = { glassLabel: '4+12+4', uw: 2.61, producto: 'Corredera SLIDING H80' };
const VIEJO = { glassLabel: '4+12+4 low-e', uw: 1.9, producto: 'Proyectante S60' };

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
  assert.deepEqual(r.datos, FRESCO, 'la cotización de ahora manda sobre la memoria');
  assert.equal(r.recordar, true);
});

test('sin nada en ninguna parte, el informe sale sin recuadro (y no rompe)', () => {
  const r = datosDelInforme({ glassLabel: '', uw: null, producto: '' }, null);
  assert.deepEqual(r.datos, { glassLabel: '', uw: null, producto: '' });
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
  assert.deepEqual(r.datos, { glassLabel: '4+12+4', uw: null, producto: '' });
  assert.equal(JSON.parse(JSON.stringify(r.datos)).uw, null, 'sobrevive al viaje por JSON');
});

test('recordados corrupto no tumba nada', () => {
  // `leerEstado` puede devolver cualquier cosa: un string, un número, lo que quedó de una
  // versión anterior del formato.
  for (const basura of ['texto', 42, [], { otra: 'cosa' }]) {
    const r = datosDelInforme({ glassLabel: '', uw: null, producto: '' }, basura);
    assert.deepEqual(r.datos, { glassLabel: '', uw: null, producto: '' }, `con ${JSON.stringify(basura)}`);
  }
});
