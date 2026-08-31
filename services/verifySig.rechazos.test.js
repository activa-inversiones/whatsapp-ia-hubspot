// [2026-08-31 · tablero #581] El rechazo por firma tiene que DEJAR RASTRO.
// Contexto: el 31-ago se cerró el fail-open del webhook (#578). Con la firma ya exigiéndose, el
// modo de falla cambió de lado: si APP_SECRET se rota mal, Oliver rechaza TODOS los mensajes de
// clientes devolviendo 200 y haciendo return — sordo, y en silencio.
// Este test reproduce la lógica de verifySig con su memoizado, que es la parte que se puede
// romper sin que se note: el handler la llama hasta 8 veces por request.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const SECRETO = 'secreto-de-prueba';

function nuevoVerificador() {
  const rechazos = { total: 0, sin_firma: 0, no_coincide: 0, ultimo_motivo: null };
  const registrar = (motivo) => {
    rechazos.total += 1; rechazos[motivo] += 1; rechazos.ultimo_motivo = motivo;
  };
  const verify = (req) => {
    if (req._sigOk !== undefined) return req._sigOk;
    const sig = req.headers['x-hub-signature-256'];
    if (!sig || !req.rawBody) { registrar('sin_firma'); req._sigOk = false; return false; }
    const exp = 'sha256=' + crypto.createHmac('sha256', SECRETO).update(req.rawBody).digest('hex');
    let ok = false;
    try { ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp)); } catch { ok = false; }
    if (!ok) registrar('no_coincide');
    req._sigOk = ok;
    return ok;
  };
  return { verify, rechazos };
}

const firmar = (cuerpo, secreto = SECRETO) =>
  'sha256=' + crypto.createHmac('sha256', secreto).update(cuerpo).digest('hex');

test('firma válida: pasa y NO cuenta rechazo', () => {
  const { verify, rechazos } = nuevoVerificador();
  const cuerpo = '{"hola":1}';
  const req = { headers: { 'x-hub-signature-256': firmar(cuerpo) }, rawBody: cuerpo };
  assert.equal(verify(req), true);
  assert.equal(rechazos.total, 0);
});

test('sin cabecera de firma: rechaza y lo cuenta como sin_firma', () => {
  const { verify, rechazos } = nuevoVerificador();
  const req = { headers: {}, rawBody: '{}' };
  assert.equal(verify(req), false);
  assert.equal(rechazos.sin_firma, 1);
  assert.equal(rechazos.ultimo_motivo, 'sin_firma');
});

test('SECRETO EQUIVOCADO: rechaza y lo cuenta como no_coincide — el caso que deja sordo a Oliver', () => {
  const { verify, rechazos } = nuevoVerificador();
  const cuerpo = '{"hola":1}';
  const req = { headers: { 'x-hub-signature-256': firmar(cuerpo, 'otro-secreto') }, rawBody: cuerpo };
  assert.equal(verify(req), false);
  assert.equal(rechazos.no_coincide, 1, 'debe distinguirse de sin_firma: este significa APP_SECRET malo');
});

test('firma de largo distinto no lanza (timingSafeEqual tira si difieren) y cuenta no_coincide', () => {
  const { verify, rechazos } = nuevoVerificador();
  const req = { headers: { 'x-hub-signature-256': 'sha256=corta' }, rawBody: '{}' };
  assert.doesNotThrow(() => verify(req));
  assert.equal(rechazos.no_coincide, 1);
});

test('MEMOIZADO: 8 llamadas en el mismo request cuentan UN solo rechazo', () => {
  const { verify, rechazos } = nuevoVerificador();
  const req = { headers: {}, rawBody: '{}' };
  for (let i = 0; i < 8; i++) verify(req);
  assert.equal(rechazos.total, 1,
    'el handler llama a verifySig hasta 8 veces por request: sin memoizado el contador se infla 8x');
});

test('el memoizado NO se comparte entre requests distintos', () => {
  const { verify, rechazos } = nuevoVerificador();
  verify({ headers: {}, rawBody: '{}' });
  verify({ headers: {}, rawBody: '{}' });
  assert.equal(rechazos.total, 2, 'dos mensajes rechazados son dos rechazos');
});
