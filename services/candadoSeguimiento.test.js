import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  puedeEnviar, marcarEnviado, esSeguimiento, claveCandado,
  CANDADO_HORAS,
} from './candadoSeguimiento.js';

const leerVacio = { leer: async () => null };

test('las plantillas transaccionales NUNCA se frenan', async () => {
  for (const t of ['envio_cotizacion', 'escalamiento_marcelo', 'apertura_por_llamada',
                   'informe_diario', 'bienvenida_activa_inversiones', 'confirmacion_cotizacion']) {
    const r = await puedeEnviar({ template: t, phone: '56999111222' },
      { leer: async () => true }); // candado PUESTO: igual debe pasar
    assert.equal(r.permitido, true, `${t} no puede quedar frenada por el candado`);
    assert.equal(r.razon, 'no_es_seguimiento');
  }
});

test('las 4 plantillas de seguimiento sí se frenan si ya se escribió', async () => {
  for (const t of ['recontacto_lead', 'seguimiento_cotizacion', 'vigencia_precio', 'solicitud_resena']) {
    const r = await puedeEnviar({ template: t, phone: '56999111222' }, { leer: async () => true });
    assert.equal(r.permitido, false, `${t} debía frenarse`);
    assert.equal(r.razon, 'candado_48h');
  }
});

test('sin candado previo, la plantilla de seguimiento pasa', async () => {
  const r = await puedeEnviar({ template: 'seguimiento_cotizacion', phone: '56999111222' }, leerVacio);
  assert.equal(r.permitido, true);
  assert.equal(r.razon, 'sin_candado_previo');
});

test('EL CASO QUE ORIGINA EL MODULO: los dos motores contra el mismo cliente', async () => {
  // Almacén compartido, que es justo lo que hoy NO existe entre CXM y Oliver.
  const almacen = new Map();
  const deps = { leer: async (k) => almacen.get(k) ?? null, escribir: async (k, v) => { almacen.set(k, v); } };

  // 1º el followupService del CXM, con el teléfono en formato '+56 9 ...'
  const cxm = await puedeEnviar({ template: 'seguimiento_cotizacion', phone: '+56 9 9911 1222' }, deps);
  assert.equal(cxm.permitido, true);
  await marcarEnviado(cxm.clave, deps);

  // 2º el reengagement de Oliver, MISMO cliente pero escrito distinto
  const oliver = await puedeEnviar({ template: 'recontacto_lead', phone: '56999111222' }, deps);
  assert.equal(oliver.permitido, false, 'el segundo motor NO puede escribirle de nuevo');
  assert.equal(oliver.razon, 'candado_48h');
});

test('el candado NO se marca si el envío falló (el otro motor debe poder reintentar)', async () => {
  const almacen = new Map();
  const deps = { leer: async (k) => almacen.get(k) ?? null, escribir: async (k, v) => { almacen.set(k, v); } };
  const r = await puedeEnviar({ template: 'seguimiento_cotizacion', phone: '56999111222' }, deps);
  // Meta rechazó → NO se llama marcarEnviado. El almacén queda vacío.
  assert.equal(almacen.size, 0);
  const reintento = await puedeEnviar({ template: 'seguimiento_cotizacion', phone: '56999111222' }, deps);
  assert.equal(reintento.permitido, true, 'tras un fallo, el reintento debe poder salir');
  assert.ok(r.clave);
});

test('FAIL-OPEN: si el almacén de estado se cae, el mensaje igual sale', async () => {
  const errores = [];
  const r = await puedeEnviar({ template: 'seguimiento_cotizacion', phone: '56999111222' },
    { leer: async () => { throw new Error('redis caido'); }, onError: (e) => errores.push(e) });
  assert.equal(r.permitido, true);
  assert.equal(r.razon, 'candado_ilegible');
  assert.equal(errores.length, 1, 'el error debe quedar registrado, no tragado en silencio');
});

test('la clave normaliza el teléfono: mismo cliente, un solo candado', () => {
  const esperada = 'followup:56999111222';
  for (const p of ['56999111222', '+56999111222', '+56 9 9911 1222', ' 56-999-111-222 ']) {
    assert.equal(claveCandado(p), esperada, `${p} debe dar la misma clave`);
  }
});

test('esSeguimiento tolera mayúsculas, espacios, null y undefined', () => {
  assert.equal(esSeguimiento(' Seguimiento_Cotizacion '), true);
  assert.equal(esSeguimiento('SEGUIMIENTO_COTIZACION'), true);
  assert.equal(esSeguimiento(null), false);
  assert.equal(esSeguimiento(undefined), false);
  assert.equal(esSeguimiento(''), false);
  assert.equal(esSeguimiento('envio_cotizacion'), false);
});

test('marcarEnviado usa la ventana de 48h y no revienta si la escritura falla', async () => {
  let ttlVisto = null;
  const ok = await marcarEnviado('followup:56999111222',
    { escribir: async (_k, _v, ttl) => { ttlVisto = ttl; } });
  assert.equal(ok.ok, true);
  assert.equal(ttlVisto, CANDADO_HORAS * 3600);

  const errores = [];
  const falla = await marcarEnviado('followup:1',
    { escribir: async () => { throw new Error('sin disco'); }, onError: (e) => errores.push(e) });
  assert.equal(falla.ok, false);
  assert.equal(falla.razon, 'escritura_fallo');
  assert.equal(errores.length, 1);

  assert.equal((await marcarEnviado(null, {})).razon, 'sin_clave');
});
