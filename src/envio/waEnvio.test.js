// Guardias de la DECISIÓN (09-oct, compuerta del piloto Oliver interno): un «enviado» tiene que significar que Meta
// ACEPTÓ el mensaje, y si no salió se dice — distinguiendo «Meta dijo que no» (se puede reintentar) de «Meta no
// contestó» (reintentar puede duplicar el WhatsApp al cliente). Antes waSend se tragaba el error y operator-send
// contestaba ok:true siempre, sin el wamid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { enviarTextoWA, respuestaOperatorSend } from './waEnvio.js';

const http = (fn) => ({ post: async (url, body) => fn(url, body) });

test('Meta acepta → ok con el wamid', async () => {
  let llamado;
  const r = await enviarTextoWA(http((u, b) => { llamado = { u, b }; return { data: { messages: [{ id: 'wamid.ABC' }] } }; }), 'PID', '56911112222', 'hola');
  assert.deepEqual(r, { ok: true, wamid: 'wamid.ABC' });
  assert.equal(llamado.u, '/PID/messages'); assert.equal(llamado.b.text.body, 'hola');
});

test('Meta CONTESTA con error → ok:false, NO ambiguo (seguro que no salió)', async () => {
  const e = Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { error: { message: 'Re-engagement message', code: 131047 } } } });
  const r = await enviarTextoWA(http(() => { throw e; }), 'PID', '569', 'x', { logErr: () => {} });
  assert.equal(r.ok, false); assert.equal(r.ambiguo, false); assert.equal(r.codigo, 131047); assert.match(r.error, /Re-engagement/);
});

test('Meta NO contesta (timeout) → ok:false AMBIGUO (pudo haber salido)', async () => {
  const e = Object.assign(new Error('timeout of 20000ms exceeded'), { code: 'ECONNABORTED' });
  const r = await enviarTextoWA(http(() => { throw e; }), 'PID', '569', 'x', { logErr: () => {} });
  assert.equal(r.ok, false); assert.equal(r.ambiguo, true);
});

test('2xx SIN id de Meta → NO es éxito: ambiguo (Codex r2)', async () => {
  for (const data of [{}, { messages: [] }, '', null]) {
    const r = await enviarTextoWA(http(() => ({ data })), 'PID', '569', 'x');
    assert.equal(r.ok, false); assert.equal(r.ambiguo, true); assert.equal(r.error, 'meta_sin_id');
  }
});

test('nunca lanza, ni aunque el log reviente', async () => {
  const r = await enviarTextoWA(http(() => { throw new Error('x'); }), 'PID', '569', 'x', { logErr: () => { throw new Error('log'); } });
  assert.equal(r.ok, false);
});

test('operator-send: rechazo → 502 meta_rechazo · sin respuesta → 502 ambiguo · ok → 200 con message_id', () => {
  assert.deepEqual(respuestaOperatorSend({ ok: false, error: 'e', codigo: 131047, ambiguo: false }, '569').body.error, 'meta_rechazo');
  const amb = respuestaOperatorSend({ ok: false, error: 't', ambiguo: true }, '569');
  assert.equal(amb.http, 502); assert.equal(amb.body.ambiguo, true); assert.equal(amb.body.error, 'meta_sin_respuesta');
  const ok = respuestaOperatorSend({ ok: true, wamid: 'wamid.X' }, '569');
  assert.equal(ok.http, 200); assert.equal(ok.body.message_id, 'wamid.X'); assert.equal(ok.body.sent, true);
});

test('index.js está cableado: waSend delega y operator-send responde según el envío', async () => {
  const src = await readFile(new URL('../../index.js', import.meta.url), 'utf8');
  assert.match(src, /async function waSend\(to, body\) \{\s*return enviarTextoWA\(axiosWA, META\.PHONE_ID, to, body, \{ logErr \}\);/);
  assert.match(src, /const envio = await waSendH\(phone, text, true, \{/);
  assert.match(src, /const salida = respuestaOperatorSend\(envio, phone\);\s*res\.status\(salida\.http\)\.json\(salida\.body\);/);
  // Solo el handler de TEXTO (los de imagen/video/documento/voz siguen con su ok incondicional: tablero, aparte).
  const handler = src.slice(src.indexOf('app.post("/internal/operator-send",'), src.indexOf('// @patch:sales-os:operator-route:end'));
  assert.ok(handler.length > 500, 'se encontró el handler de operator-send');
  assert.doesNotMatch(handler, /res\.json\(\{ ok: true, sent: true, phone \}\)/, 'el ok:true incondicional no puede volver');
  // el historial de Oliver se escribe DESPUÉS y solo si salió
  const iEnvio = handler.indexOf('const envio = await waSendH(phone, text, true');
  const iHist = handler.indexOf('ses.history.push({ role: "assistant", content: text })');
  assert.ok(iEnvio > 0 && iHist > iEnvio, 'el historial va después del envío');
  assert.match(handler, /if \(envio && envio\.ok === true\) \{ ses\.history\.push/);
});
