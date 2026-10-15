// [#702 · 14-oct] Llamadas de WhatsApp: el bot reconoce los avisos de Meta y ejecuta las acciones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventosDeLlamada, reenviarEventosLlamada, registrarRutaAccionLlamada, RUTA_ACCION_LLAMADA } from './llamadasWhatsapp.js';

const SDP = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n';
const aviso = (calls, statuses) => ({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'calls', value: { messaging_product: 'whatsapp', calls, statuses } }] }] });

test('reconoce una llamada ENTRANTE (connect, USER_INITIATED) con su SDP oferta', () => {
  const ev = eventosDeLlamada(aviso([{ id: 'wacid.ABC', from: '56965287304', to: '56984412961', event: 'connect', direction: 'USER_INITIATED', timestamp: '1760450000', session: { sdp_type: 'offer', sdp: SDP } }]));
  assert.equal(ev.length, 1);
  assert.deepEqual({ ...ev[0], sdp: ev[0].sdp.slice(0, 3) }, { call_id: 'wacid.ABC', evento: 'connect', direccion: 'USER_INITIATED', desde: '56965287304', hacia: '56984412961', sdp_tipo: 'offer', sdp: 'v=0', estado: null, duracion_s: null, ts: 1760450000 });
});

test('reconoce el corte (terminate con duración) y los estados de llamada en statuses', () => {
  const ev = eventosDeLlamada(aviso(
    [{ id: 'wacid.ABC', from: '56965287304', to: '56984412961', event: 'terminate', direction: 'USER_INITIATED', status: 'COMPLETED', duration: 125 }],
    [{ id: 'wacid.XYZ', type: 'call', status: 'RINGING', recipient_id: '56965287304' }, { id: 'wamid.1', status: 'delivered' }],
  ));
  assert.equal(ev.length, 2, 'el status de un MENSAJE no es de llamada');
  assert.equal(ev[0].evento, 'terminate'); assert.equal(ev[0].duracion_s, 125); assert.equal(ev[0].estado, 'COMPLETED');
  assert.equal(ev[1].evento, 'status'); assert.equal(ev[1].estado, 'RINGING');
});

test('🔒 un webhook de MENSAJES normal no tiene avisos de llamada (el flujo de Oliver sigue intacto)', () => {
  const msg = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [{ id: 'wamid.1', from: '569', type: 'text', text: { body: 'hola' } }] } }] }] };
  assert.deepEqual(eventosDeLlamada(msg), []);
  assert.deepEqual(eventosDeLlamada(null), []);
  assert.deepEqual(eventosDeLlamada({}), []);
});

test('reenvía a la plataforma con el token; sin configuración no llama y lo dice', async () => {
  const pedidos = [];
  const fetchImpl = async (url, o) => { pedidos.push({ url, o }); return { ok: true, status: 200 }; };
  const r = await reenviarEventosLlamada([{ call_id: 'x' }], { fetchImpl, url: 'https://ops.x/', token: 't' });
  assert.equal(r.ok, true);
  assert.equal(pedidos[0].url, 'https://ops.x/internal/llamadas/evento');
  assert.equal(pedidos[0].o.headers['x-api-key'], 't');
  assert.deepEqual(JSON.parse(pedidos[0].o.body).eventos, [{ call_id: 'x' }]);
  assert.equal((await reenviarEventosLlamada([], { fetchImpl, url: '', token: '' })).error, 'sales_os_no_configurado');
});

function armar(respuestaMeta = { ok: true }) {
  const rutas = {}; const aMeta = [];
  const app = { post: (r, ...f) => { rutas[r] = f[f.length - 1]; } };
  registrarRutaAccionLlamada(app, { validInternalOperatorToken: (req) => req.headers['x-api-key'] === 'ok', llamarMeta: async (b) => { aMeta.push(b); return respuestaMeta; } });
  return { h: rutas[RUTA_ACCION_LLAMADA], aMeta };
}
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

test('accept manda a Meta la SDP RESPUESTA con el call_id', async () => {
  const { h, aMeta } = armar();
  const r = res();
  await h({ headers: { 'x-api-key': 'ok' }, body: { call_id: 'wacid.ABC', action: 'accept', sdp: SDP } }, r);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(aMeta[0], { messaging_product: 'whatsapp', call_id: 'wacid.ABC', action: 'accept', session: { sdp_type: 'answer', sdp: SDP } });
});

test('🔒 sin token 401; acción desconocida 400; accept sin SDP válida 400; Meta rechaza → 502 (nada se da por hecho)', async () => {
  const { h, aMeta } = armar();
  let r = res(); await h({ headers: { 'x-api-key': 'no' }, body: { call_id: 'a', action: 'terminate' } }, r); assert.equal(r.code, 401);
  r = res(); await h({ headers: { 'x-api-key': 'ok' }, body: { call_id: 'a', action: 'connect' } }, r); assert.equal(r.code, 400);
  r = res(); await h({ headers: { 'x-api-key': 'ok' }, body: { call_id: 'a', action: 'accept', sdp: 'hola' } }, r); assert.equal(r.code, 400);
  assert.equal(aMeta.length, 0, 'nada de eso llega a Meta');
  const m = armar({ ok: false, error: '138006 sin permiso' });
  r = res(); await m.h({ headers: { 'x-api-key': 'ok' }, body: { call_id: 'a', action: 'terminate' } }, r);
  assert.equal(r.code, 502); assert.match(r.body.error, /138006/);
});

test('🔴 [revisión 14-oct] un body con llamada Y mensaje NO es «solo llamadas»: el mensaje sigue al flujo de Oliver', async () => {
  const { soloAvisosDeLlamada } = await import('./llamadasWhatsapp.js');
  const llamada = { field: 'calls', value: { calls: [{ id: 'wacid.A', event: 'connect', direction: 'USER_INITIATED' }] } };
  const mensaje = { field: 'messages', value: { messages: [{ id: 'wamid.1', type: 'text', text: { body: 'hola' } }] } };
  assert.equal(soloAvisosDeLlamada({ entry: [{ changes: [llamada] }] }), true);
  assert.equal(soloAvisosDeLlamada({ entry: [{ changes: [llamada, mensaje] }] }), false);
  assert.equal(soloAvisosDeLlamada({ entry: [{ changes: [llamada] }, { changes: [mensaje] }] }), false);
  assert.equal(soloAvisosDeLlamada({ entry: [] }), false);
  assert.equal(soloAvisosDeLlamada(null), false);
});

test('🔴 [Codex 15-oct · P0] aviso MIXTO: al quitar la llamada, el mensaje del cliente queda en changes[0] (lo que lee extractMsg)', async () => {
  const { quitarAvisosDeLlamada } = await import('./llamadasWhatsapp.js');
  const llamada = { field: 'calls', value: { calls: [{ id: 'wacid.A', event: 'connect', direction: 'USER_INITIATED' }] } };
  const mensaje = { field: 'messages', value: { messages: [{ id: 'wamid.1', type: 'text', text: { body: 'hola' } }] } };
  const limpio = quitarAvisosDeLlamada({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [llamada, mensaje] }] });
  assert.equal(limpio.entry[0].changes[0].field, 'messages');
  assert.equal(limpio.entry[0].changes[0].value.messages[0].text.body, 'hola');
  const soloLlamada = quitarAvisosDeLlamada({ entry: [{ changes: [llamada] }, { changes: [mensaje] }] });
  assert.equal(soloLlamada.entry.length, 1, 'una entrada que solo traía la llamada se va entera');
  assert.equal(soloLlamada.entry[0].changes[0].field, 'messages');
});
