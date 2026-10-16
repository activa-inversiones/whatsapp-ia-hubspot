// [2026-10-16 · #702 etapa 2] LLAMAR al cliente por WhatsApp: connect saliente, permiso del cliente y su respuesta.
// Meta se simula (llamarMeta / consultarMeta / enviarMeta inyectados): nada de esto sale a la red.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registrarRutaAccionLlamada, RUTA_ACCION_LLAMADA, registrarRutaPermisoLlamada, RUTA_PERMISO_LLAMADA, TEXTO_PEDIR_PERMISO,
  telefonoParaLlamar, respuestasPermisoLlamada, soloRespuestasPermiso, quitarRespuestasPermiso, interceptarRespuestasPermiso,
  reenviarRespuestasPermiso, normalizarPermiso, mensajePedirPermiso,
} from './llamadasWhatsapp.js';

const SDP = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n';
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.sendStatus = (c) => { r.code = c; return r; }; return r; };
const OK = { 'x-api-key': 'ok' };

function armarAccion(respuestaMeta = { ok: true, data: { messaging_product: 'whatsapp', calls: [{ id: 'wacid.SALIENTE' }] } }) {
  const rutas = {}; const aMeta = [];
  const app = { post: (r, ...f) => { rutas[r] = f[f.length - 1]; } };
  registrarRutaAccionLlamada(app, { validInternalOperatorToken: (req) => req.headers['x-api-key'] === 'ok', llamarMeta: async (b) => { aMeta.push(b); return respuestaMeta; } });
  return { h: rutas[RUTA_ACCION_LLAMADA], aMeta };
}

test('LLAMAR: connect manda a Meta el teléfono y la SDP OFERTA, y devuelve el call_id que crea Meta', async () => {
  const { h, aMeta } = armarAccion();
  const r = res();
  await h({ headers: OK, body: { action: 'connect', to: '+56 9 6528 7304', sdp: SDP } }, r);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(aMeta[0], { messaging_product: 'whatsapp', to: '56965287304', action: 'connect', session: { sdp_type: 'offer', sdp: SDP } });
  assert.equal(r.body.call_id, 'wacid.SALIENTE');
});

test('🔒 connect SOLO saliente y con teléfono validado: con call_id, sin teléfono, teléfono raro o SDP mala → 400 y nada llega a Meta', async () => {
  const { h, aMeta } = armarAccion();
  const casos = [
    { action: 'connect', call_id: 'wacid.ENTRANTE', to: '56965287304', sdp: SDP },   // no se «re-conecta» una entrante
    { action: 'connect', sdp: SDP },
    { action: 'connect', to: '123', sdp: SDP },
    { action: 'connect', to: '5696528730412345678', sdp: SDP },
    { action: 'connect', to: '56965287304; DROP', sdp: SDP },
    { action: 'connect', to: '56965287304', sdp: 'hola' },
  ];
  for (const body of casos) {
    const r = res(); await h({ headers: OK, body }, r);
    assert.equal(r.code, 400, JSON.stringify(body));
  }
  const sinToken = res(); await h({ headers: { 'x-api-key': 'no' }, body: { action: 'connect', to: '56965287304', sdp: SDP } }, sinToken);
  assert.equal(sinToken.code, 401);
  assert.equal(aMeta.length, 0);
});

test('connect: si Meta rechaza (138006 sin permiso) o contesta sin call_id → 502 con el motivo (no se inventa una llamada)', async () => {
  let m = armarAccion({ ok: false, error: '138006 No permission' });
  let r = res(); await m.h({ headers: OK, body: { action: 'connect', to: '56965287304', sdp: SDP } }, r);
  assert.equal(r.code, 502); assert.match(r.body.error, /138006/);
  m = armarAccion({ ok: true, data: { success: true } });
  r = res(); await m.h({ headers: OK, body: { action: 'connect', to: '56965287304', sdp: SDP } }, r);
  assert.equal(r.code, 502); assert.equal(r.body.error, 'meta_sin_call_id');
});

test('las acciones de la etapa 1 siguen exigiendo call_id (connect no abrió la puerta a acciones sin llamada)', async () => {
  const { h, aMeta } = armarAccion({ ok: true });
  const r = res(); await h({ headers: OK, body: { action: 'terminate' } }, r);
  assert.equal(r.code, 400); assert.equal(r.body.error, 'call_id_requerido');
  const t = res(); await h({ headers: OK, body: { action: 'terminate', call_id: 'wacid.SALIENTE' } }, t);
  assert.equal(t.code, 200);
  assert.deepEqual(aMeta, [{ messaging_product: 'whatsapp', call_id: 'wacid.SALIENTE', action: 'terminate' }]);
});

test('telefonoParaLlamar: dígitos E.164 o null', () => {
  assert.equal(telefonoParaLlamar('+56 9 6528 7304'), '56965287304');
  assert.equal(telefonoParaLlamar('(56) 9-6528-7304'), '56965287304');
  for (const malo of ['', null, '965287', 'abc56965287304', '56965287304@x', '1234567890123456']) assert.equal(telefonoParaLlamar(malo), null, String(malo));
});

function armarPermiso({ consulta = { ok: true, data: {} }, envio = { ok: true, data: { messages: [{ id: 'wamid.PERM' }] } } } = {}) {
  const rutas = {}; const consultas = []; const envios = [];
  const app = { post: (r, ...f) => { rutas[r] = f[f.length - 1]; } };
  registrarRutaPermisoLlamada(app, {
    validInternalOperatorToken: (req) => req.headers['x-api-key'] === 'ok',
    consultarMeta: async (t) => { consultas.push(t); return consulta; },
    enviarMeta: async (b) => { envios.push(b); return envio; },
  });
  return { h: rutas[RUTA_PERMISO_LLAMADA], consultas, envios };
}

test('PEDIR PERMISO: manda el interactive call_permission_request con el texto que fija el BOT (no el que mande la plataforma)', async () => {
  const { h, envios } = armarPermiso();
  const r = res();
  await h({ headers: OK, body: { phone: '56965287304', accion: 'pedir', texto: 'cualquier cosa' } }, r);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.message_id, 'wamid.PERM');
  assert.deepEqual(envios[0], {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '56965287304', type: 'interactive',
    interactive: { type: 'call_permission_request', action: { name: 'call_permission_request' }, body: { text: TEXTO_PEDIR_PERMISO } },
  });
  assert.equal(TEXTO_PEDIR_PERMISO, '¿Podemos llamarte por WhatsApp para resolver tu cotización?');
  assert.deepEqual(mensajePedirPermiso('1').interactive.action, { name: 'call_permission_request' });
});

test('🔒 pedir: sin token 401; teléfono malo 400; Meta sin message_id (200 vacío) NO cuenta como pedido → 502', async () => {
  let m = armarPermiso();
  let r = res(); await m.h({ headers: { 'x-api-key': 'x' }, body: { phone: '56965287304', accion: 'pedir' } }, r); assert.equal(r.code, 401);
  r = res(); await m.h({ headers: OK, body: { phone: 'hola', accion: 'pedir' } }, r); assert.equal(r.code, 400);
  r = res(); await m.h({ headers: OK, body: { phone: '56965287304', accion: 'borrar' } }, r); assert.equal(r.code, 400);
  assert.equal(m.envios.length, 0);
  m = armarPermiso({ envio: { ok: true, data: { messages: [] } } });
  r = res(); await m.h({ headers: OK, body: { phone: '56965287304', accion: 'pedir' } }, r);
  assert.equal(r.code, 502);
});

test('CONSULTAR permiso: lee call_permissions y lo devuelve normalizado (estado, vencimiento, si se puede pedir/llamar)', async () => {
  const data = { messaging_product: 'whatsapp', permission: { status: 'temporary', expiration_time: 1761200000 },
    actions: [
      { action_name: 'send_call_permission_request', can_perform_action: false, limits: [{ time_period: 'PT24H', max_allowed: 1, current_usage: 1, limit_expiration_time: 1760700000 }] },
      { action_name: 'start_call', can_perform_action: true, limits: [] },
    ] };
  const { h, consultas } = armarPermiso({ consulta: { ok: true, data } });
  const r = res(); await h({ headers: OK, body: { phone: '+56965287304', accion: 'consultar' } }, r);
  assert.equal(r.code, 200);
  assert.deepEqual(consultas, ['56965287304']);
  assert.equal(r.body.status, 'temporary');
  assert.equal(r.body.expira_ts, 1761200000);
  assert.equal(r.body.acciones.send_call_permission_request.puede, false);
  assert.deepEqual(r.body.acciones.send_call_permission_request.limites[0], { periodo: 'PT24H', max: 1, usados: 1, vence_ts: 1760700000 });
  assert.equal(r.body.acciones.start_call.puede, true);
  assert.equal(normalizarPermiso({ permission: { status: 'raro' } }).status, 'desconocido');
});

// ── La respuesta del cliente ─────────────────────────────────────────────────
const respuesta = (resp = 'accept', extra = {}) => ({
  from: '56965287304', id: 'wamid.RESP', timestamp: '1760600000', type: 'interactive',
  interactive: { type: 'call_permission_reply', call_permission_reply: { response: resp, is_permanent: false, expiration_timestamp: 1761204800, response_source: 'user_action', ...extra } },
});
const texto = { from: '56965287304', id: 'wamid.TXT', type: 'text', text: { body: 'hola, ¿me llaman?' } };
const cuerpo = (...changes) => ({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes }] });
const cambioMsgs = (...messages) => ({ field: 'messages', value: { messaging_product: 'whatsapp', contacts: [{ wa_id: '56965287304' }], messages } });

test('reconoce la respuesta de permiso (aceptó temporal, con vencimiento) y el rechazo', () => {
  const [a] = respuestasPermisoLlamada(cuerpo(cambioMsgs(respuesta())));
  assert.deepEqual(a, { msg_id: 'wamid.RESP', telefono: '56965287304', respuesta: 'accept', permanente: false, expira_ts: 1761204800, origen: 'user_action', ts: 1760600000 });
  const [b] = respuestasPermisoLlamada(cuerpo(cambioMsgs(respuesta('reject', { expiration_timestamp: undefined }))));
  assert.equal(b.respuesta, 'reject'); assert.equal(b.expira_ts, null);
  assert.deepEqual(respuestasPermisoLlamada(cuerpo(cambioMsgs(texto))), [], 'un texto normal no es una respuesta de permiso');
  assert.deepEqual(respuestasPermisoLlamada(null), []);
});

test('🔴 la respuesta de permiso NO llega a Oliver: un body que solo la trae se contesta acá (200 si la plataforma la guardó, 500 si no ⇒ Meta reintenta)', async () => {
  const b = cuerpo(cambioMsgs(respuesta()));
  assert.equal(soloRespuestasPermiso(b), true);
  const enviadas = [];
  let r = await interceptarRespuestasPermiso(b, { reenviar: async (x) => { enviadas.push(...x); return { ok: true }; } });
  assert.deepEqual({ accion: r.accion, status: r.status }, { accion: 'responder', status: 200 });
  assert.equal(enviadas.length, 1);
  r = await interceptarRespuestasPermiso(b, { reenviar: async () => ({ ok: false, status: 503 }) });
  assert.equal(r.status, 500, 'si la plataforma no la guardó, Meta tiene que reintentar');
  r = await interceptarRespuestasPermiso(b, { reenviar: async () => { throw new Error('caída'); } });
  assert.equal(r.status, 500, 'una excepción tampoco se traga el aviso');
});

test('🔴 NUNCA se pierde un mensaje del cliente: respuesta + texto en el MISMO cambio ⇒ el texto queda primero (lo que lee extractMsg)', async () => {
  const b = cuerpo(cambioMsgs(respuesta(), texto));
  assert.equal(soloRespuestasPermiso(b), false);
  const r = await interceptarRespuestasPermiso(b, { reenviar: async () => ({ ok: true }) });
  assert.equal(r.accion, 'seguir');
  const msgs = r.body.entry[0].changes[0].value.messages;
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].text.body, 'hola, ¿me llaman?');
  assert.deepEqual(r.body.entry[0].changes[0].value.contacts, [{ wa_id: '56965287304' }], 'el resto del cambio queda intacto');
});

test('🔴 respuesta en un cambio y texto en otro / estados al lado: el resto sigue; un cambio solo se va si quedó vacío', () => {
  const sts = { field: 'messages', value: { statuses: [{ id: 'wamid.X', status: 'read' }], messages: [respuesta()] } };
  const b = { entry: [{ changes: [cambioMsgs(respuesta())] }, { changes: [cambioMsgs(texto)] }, { changes: [sts] }] };
  assert.equal(soloRespuestasPermiso(b), false);
  const limpio = quitarRespuestasPermiso(b);
  assert.equal(limpio.entry.length, 2, 'la entrada que solo traía la respuesta se va');
  assert.equal(limpio.entry[0].changes[0].value.messages[0].id, 'wamid.TXT');
  assert.deepEqual(limpio.entry[1].changes[0].value.statuses, [{ id: 'wamid.X', status: 'read' }], 'los estados no se pierden');
  assert.deepEqual(limpio.entry[1].changes[0].value.messages, []);
  const sinNada = cuerpo(cambioMsgs(texto));
  assert.deepEqual(quitarRespuestasPermiso(sinNada), sinNada, 'sin respuestas el body no cambia');
});

test('un body sin respuestas de permiso sigue intacto y NO llama a la plataforma', async () => {
  let llamadas = 0;
  const b = cuerpo(cambioMsgs(texto));
  const r = await interceptarRespuestasPermiso(b, { reenviar: async () => { llamadas++; return { ok: true }; } });
  assert.equal(r.accion, 'seguir'); assert.equal(r.body, b); assert.equal(llamadas, 0);
});

test('reenvía las respuestas a la plataforma con el token; sin configuración no llama', async () => {
  const pedidos = [];
  const fetchImpl = async (url, o) => { pedidos.push({ url, o }); return { ok: true, status: 200 }; };
  const r = await reenviarRespuestasPermiso([{ telefono: '569' }], { fetchImpl, url: 'https://ops.x/', token: 't' });
  assert.equal(r.ok, true);
  assert.equal(pedidos[0].url, 'https://ops.x/internal/llamadas/permiso-respuesta');
  assert.equal(pedidos[0].o.headers['x-api-key'], 't');
  assert.deepEqual(JSON.parse(pedidos[0].o.body).respuestas, [{ telefono: '569' }]);
  assert.equal((await reenviarRespuestasPermiso([], { fetchImpl, url: '', token: '' })).error, 'sales_os_no_configurado');
});

// ⚠️ Guardia ESTRUCTURAL (lee index.js): no prueba conducta —eso lo hacen los tests de arriba sobre
// interceptarRespuestasPermiso—, solo que el cableado no se mueva de lugar. index.js no se puede levantar en un test
// (arranca el bot entero), y lo que hay que impedir es que alguien mueva el intercept DESPUÉS del primer extractMsg:
// ahí la respuesta de permiso ya habría llegado a los comandos y a Oliver como «texto del cliente».
test('🔴 [cableado] en POST /webhook el intercept de respuestas de permiso va ANTES del primer extractMsg y reemplaza req.body', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const ini = src.indexOf('app.post("/webhook"');
  assert.ok(ini > 0);
  const cuerpo = src.slice(ini);
  const intercept = cuerpo.indexOf('interceptarRespuestasPermiso(req.body');
  const primerExtract = cuerpo.indexOf('extractMsg(req.body)');
  assert.ok(intercept > 0 && primerExtract > 0 && intercept < primerExtract, 'el intercept tiene que ir antes que cualquier lector del mensaje');
  assert.match(cuerpo.slice(intercept, primerExtract), /req\.body = _perm\.body;/);
  assert.match(cuerpo.slice(intercept, primerExtract), /res\.sendStatus\(_perm\.status\); return;/);
});
