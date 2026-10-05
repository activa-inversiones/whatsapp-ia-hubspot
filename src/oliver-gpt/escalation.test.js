// escalation.test.js — [2026-10-05 · r7] las PLANTILLAS al dueño (pasan la ventana de 24 h de Meta).
//
// `sendEscalationTemplate` existía sin test. Al sacar de ahí el envío para que lo use TAMBIÉN el aviso del
// satén perdido (`sendAvisoVidrioTemplate`), esto fija las dos cosas que no pueden cambiar:
//   · la escalación sigue mandando EXACTAMENTE el mismo cuerpo (guardia de la refactorización);
//   · el aviso del satén reusa la MISMA plantilla aprobada (`informe_diario`, 4 parámetros): crear una
//     plantilla nueva en Meta requiere aprobación y deja al aviso sin salir mientras tanto.
// Hermético: `fetchFn` inyectado, nada sale de la máquina.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendEscalationTemplate, sendAvisoVidrioTemplate } from './escalation.js';

/** Corre `fn` con el entorno dado y lo restaura (valores de PRUEBA; nunca un secreto real). */
async function conEntorno(env, fn) {
  const previo = {};
  for (const k of Object.keys(env)) previo[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(previo)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const ENTORNO = { ADMIN_PIN: 'pin-de-prueba', OLIVER_ADMIN_PIN: undefined, OWNER_NOTIFICATION_PHONE: '56900000009', SELF_URL: 'http://bot.test/' };

/** fetch falso que guarda lo que se le mandó y responde como /admin/send-template. */
function fetchEspia(respuesta = { ok: true, template: 'informe_diario' }) {
  const llamadas = [];
  const fetchFn = async (url, opts) => {
    llamadas.push({ url: String(url), cuerpo: JSON.parse(opts.body), metodo: opts.method });
    return { ok: true, json: async () => respuesta };
  };
  return { fetchFn, llamadas };
}

test('r7: el aviso del satén sale por la plantilla aprobada informe_diario, con folio y etiqueta en sus parámetros', async () => {
  const { fetchFn, llamadas } = fetchEspia();
  const r = await conEntorno(ENTORNO, () => sendAvisoVidrioTemplate('CM-FR-004-2026-0701',
    ['4+12+4 satén (baño)', 'Termopanel 5+12+5 esmerilado'], { fetchFn }));
  assert.equal(r.ok, true);
  assert.equal(llamadas.length, 1);
  const { url, cuerpo, metodo } = llamadas[0];
  assert.equal(metodo, 'POST');
  assert.equal(url, 'http://bot.test/admin/send-template?pin=pin-de-prueba', 'self-call al endpoint de siempre');
  assert.equal(cuerpo.template, 'informe_diario', 'la MISMA plantilla de la escalación; no se crea otra');
  assert.equal(cuerpo.phone, '56900000009', 'va al dueño');
  assert.match(cuerpo.resumen, /CM-FR-004-2026-0701/, 'el folio en el parámetro corto, que no se trunca');
  assert.match(cuerpo.linea3, /"4\+12\+4 satén \(baño\)"/);
  assert.match(cuerpo.linea3, /"Termopanel 5\+12\+5 esmerilado"/, 'todas las etiquetas');
  assert.match(cuerpo.linea3, /vidrio claro; revisar precio/);
  assert.doesNotMatch(cuerpo.resumen, /ESCALACION|hablar contigo/, 'no es una escalación: no le dice al dueño que un cliente lo espera AHORA');
  assert.ok(cuerpo.fecha, 'los 4 parámetros que exige la plantilla');
  assert.ok(cuerpo.linea4);
});

test('r7: los parámetros de la plantilla no llevan saltos de línea ni espacios en racha (Meta los rechaza: 132018)', async () => {
  const { fetchFn, llamadas } = fetchEspia();
  await conEntorno(ENTORNO, () => sendAvisoVidrioTemplate('CM-FR-004-2026-0702', ['4+12+4\nsatén   \t  (baño) [x]'], { fetchFn }));
  const { resumen, linea3, linea4 } = llamadas[0].cuerpo;
  for (const p of [resumen, linea3, linea4]) {
    assert.doesNotMatch(p, /[\n\r\t]/);
    assert.doesNotMatch(p, / {2,}/);
    assert.doesNotMatch(p, /[[\]]/);
  }
  assert.match(linea3, /4\+12\+4 satén \(baño\) x/);
});

test('r7: sin ADMIN_PIN no hay llamada y se dice por qué; un fetch que lanza no revienta', async () => {
  const { fetchFn, llamadas } = fetchEspia();
  const sinPin = await conEntorno({ ...ENTORNO, ADMIN_PIN: undefined },
    () => sendAvisoVidrioTemplate('CM-FR-004-2026-0703', ['satén'], { fetchFn }));
  assert.deepEqual(sinPin, { ok: false, error: 'ADMIN_PIN_missing' });
  assert.equal(llamadas.length, 0, 'sin PIN ni siquiera se intenta');

  const lanza = async () => { throw new Error('ECONNREFUSED'); };
  const r = await conEntorno(ENTORNO, () => sendAvisoVidrioTemplate('CM-FR-004-2026-0703', ['satén'], { fetchFn: lanza }));
  assert.equal(r.ok, false);
  assert.match(r.error, /ECONNREFUSED/);
});

test('r7: el endpoint dice ok:false (Meta rechazó la plantilla) ⇒ se devuelve tal cual, no se maquilla', async () => {
  const { fetchFn } = fetchEspia({ ok: false, error: 'meta_credentials_missing' });
  const r = await conEntorno(ENTORNO, () => sendAvisoVidrioTemplate('CM-FR-004-2026-0704', ['satén'], { fetchFn }));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'meta_credentials_missing');
});

test('r7: guardia de la refactorización — sendEscalationTemplate manda EXACTAMENTE el mismo cuerpo de siempre', async () => {
  const { fetchFn, llamadas } = fetchEspia();
  const r = await conEntorno(ENTORNO, () => sendEscalationTemplate('Pedro', '[instagram] cliente pide hablar con humano', { fetchFn }));
  assert.equal(r.ok, true);
  const { cuerpo, url } = llamadas[0];
  assert.equal(url, 'http://bot.test/admin/send-template?pin=pin-de-prueba');
  assert.equal(cuerpo.template, 'informe_diario');
  assert.equal(cuerpo.phone, '56900000009');
  assert.equal(cuerpo.resumen, 'ESCALACION: Pedro pide hablar contigo AHORA');
  assert.equal(cuerpo.linea3, 'instagram cliente pide hablar con humano', 'los corchetes se quitan, como siempre');
  assert.equal(cuerpo.linea4, 'Revisa/toma el chat en ops.activalabs.ai (Oliver CRM)');
  assert.match(cuerpo.fecha, /\d/);

  const sinPin = await conEntorno({ ...ENTORNO, ADMIN_PIN: undefined }, () => sendEscalationTemplate('Pedro', 'x', { fetchFn }));
  assert.deepEqual(sinPin, { ok: false, error: 'ADMIN_PIN_missing' });
});
