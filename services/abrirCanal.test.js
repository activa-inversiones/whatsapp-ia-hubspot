// [#1514 (2) · 13-oct] Guardia: abrir el canal con la plantilla más barata, con el MISMO candado de 48 h,
// solo plantillas de apertura, solo con token interno. Sin red, sin BD.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registrarRutaAbrirCanal, plantillaDeApertura, RUTA_ABRIR_CANAL, PLANTILLAS_APERTURA } from './abrirCanal.js';

test('plantillaDeApertura: vacío → recontacto_lead; permitida tal cual; cualquier otra → null (apertura_por_llamada NO está en el candado de 48 h)', () => {
  assert.equal(plantillaDeApertura(''), 'recontacto_lead');
  assert.equal(plantillaDeApertura(undefined), 'recontacto_lead');
  assert.equal(plantillaDeApertura(' Recontacto_Lead '), 'recontacto_lead');
  assert.equal(plantillaDeApertura('apertura_por_llamada'), null);
  assert.equal(plantillaDeApertura('informe_diario'), null);
  assert.equal(plantillaDeApertura('solicitud_resena'), null);
  assert.deepEqual(PLANTILLAS_APERTURA, ['recontacto_lead']);
});

// [Thermos M2] Guardia con el candado REAL del repo: toda plantilla de apertura tiene que ser de seguimiento (con clave),
// si no sale sin dedupe y se cobra N veces.
test('toda plantilla de apertura está en el candado de seguimiento real (puedeEnviar devuelve clave)', async () => {
  const { puedeEnviar } = await import('./candadoSeguimiento.js');
  for (const t of PLANTILLAS_APERTURA) {
    const c = await puedeEnviar({ template: t, phone: '56954429329' }, { leer: async () => null, onError: () => {} });
    assert.equal(c.permitido, true);
    assert.ok(c.clave, `${t} tiene que tener clave de candado`);
  }
});

function armar({ permitido = true, clave = 'k1', envioOk = true } = {}) {
  const rutas = {};
  const app = { post: (r, ...f) => { rutas[r] = f[f.length - 1]; } };
  const llamadas = { envios: [], marcas: [], candados: [], eventos: [] };
  registrarRutaAbrirCanal(app, {
    validInternalOperatorToken: (req) => req.headers['x-api-key'] === 'ok',
    normPhone: (s) => String(s || '').replace(/\D/g, ''),
    enviar: {
      // forma REAL de _sendMetaTemplate: { ok, msgId }
      recontacto_lead: async (phone, nombre) => { llamadas.envios.push(['recontacto_lead', phone, nombre]); return envioOk ? { ok: true, msgId: 'wamid.1' } : { ok: false, error: 'meta_132000' }; },
    },
    candado: {
      puedeEnviar: async (args) => { llamadas.candados.push(args); return permitido ? { permitido: true, clave } : { permitido: false, razon: 'enviada_hace_menos_de_48h' }; },
      marcarEnviado: async (k) => { llamadas.marcas.push(k); },
      leer: async () => null, escribir: async () => {},
    },
    nombreDeSesion: () => 'Nombre de sesión',
    registrarEvento: (ev) => { llamadas.eventos.push(ev); },
  });
  return { h: rutas[RUTA_ABRIR_CANAL], llamadas };
}
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

test('sin token → 401 y no manda nada', async () => {
  const { h, llamadas } = armar();
  const r = res();
  await h({ headers: { 'x-api-key': 'no' }, body: { phone: '+56 9 5442 9329' } }, r);
  assert.equal(r.code, 401);
  assert.equal(llamadas.envios.length, 0);
});

test('manda la plantilla por defecto, con el nombre que vino, y marca el candado', async () => {
  const { h, llamadas } = armar();
  const r = res();
  await h({ headers: { 'x-api-key': 'ok' }, body: { phone: '+56 9 5442 9329', customer_name: 'Jorge Riffo', operador: 'Marcelo' } }, r);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, sent: true, template: 'recontacto_lead', phone: '56954429329', message_id: 'wamid.1' });
  assert.deepEqual(llamadas.envios, [['recontacto_lead', '56954429329', 'Jorge Riffo']]);
  assert.deepEqual(llamadas.candados[0], { template: 'recontacto_lead', phone: '56954429329' });
  assert.deepEqual(llamadas.marcas, ['k1']);
  // [Thermos M1] queda rastro en la conversación: el inbox lo ve y Oliver no saluda «como si nada»
  assert.equal(llamadas.eventos.length, 1);
  assert.equal(llamadas.eventos[0].message_type, 'template');
  assert.equal(llamadas.eventos[0].direction, 'outbound');
  assert.equal(llamadas.eventos[0].external_id, '56954429329');
  assert.match(llamadas.eventos[0].body, /\[plantilla recontacto_lead · abrir canal · por Marcelo\]/);
  assert.equal(llamadas.eventos[0].metadata.message_id, 'wamid.1');
});

test('sin nombre en el body usa el de la sesión del bot; plantilla no permitida → 400 (sin mandar ni registrar)', async () => {
  const { h, llamadas } = armar();
  let r = res();
  await h({ headers: { 'x-api-key': 'ok' }, body: { phone: '56954429329' } }, r);
  assert.equal(r.code, 200);
  assert.deepEqual(llamadas.envios[0], ['recontacto_lead', '56954429329', 'Nombre de sesión']);
  r = res();
  await h({ headers: { 'x-api-key': 'ok' }, body: { phone: '56954429329', template: 'apertura_por_llamada' } }, r);
  assert.equal(r.code, 400);
  assert.equal(r.body.error, 'plantilla_no_permitida');
  assert.equal(llamadas.envios.length, 1);
  assert.equal(llamadas.eventos.length, 1);
  r = res();
  await h({ headers: { 'x-api-key': 'ok' }, body: { phone: '56954429329', template: 'informe_diario' } }, r);
  assert.equal(r.code, 400);
  assert.equal(r.body.error, 'plantilla_no_permitida');
  assert.deepEqual(r.body.permitidas, PLANTILLAS_APERTURA);
});

test('candado de 48 h: no manda, responde sent:false con la razón y NO marca', async () => {
  const { h, llamadas } = armar({ permitido: false });
  const r = res();
  await h({ headers: { 'x-api-key': 'ok' }, body: { phone: '56954429329' } }, r);
  assert.equal(r.code, 200);
  assert.equal(r.body.sent, false);
  assert.equal(r.body.reason, 'enviada_hace_menos_de_48h');
  assert.equal(llamadas.envios.length, 0);
  assert.equal(llamadas.marcas.length, 0);
  assert.equal(llamadas.eventos.length, 0, 'sin envío no hay rastro falso');
});

test('Meta rechaza → 502 con el error, y el candado NO se marca (se puede reintentar)', async () => {
  const { h, llamadas } = armar({ envioOk: false });
  const r = res();
  await h({ headers: { 'x-api-key': 'ok' }, body: { phone: '56954429329' } }, r);
  assert.equal(r.code, 502);
  assert.equal(r.body.error, 'meta_132000');
  assert.equal(llamadas.marcas.length, 0);
  assert.equal(llamadas.eventos.length, 0, 'Meta rechazó: no se registra como enviada');
});
