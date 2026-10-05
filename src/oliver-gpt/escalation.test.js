// escalation.test.js — [2026-10-05 · r7/r8] las PLANTILLAS al dueño (pasan la ventana de 24 h de Meta).
//
// `sendEscalationTemplate` existía sin test. Al sacar de ahí el envío para que lo use TAMBIÉN el aviso del
// satén perdido (`sendAvisoVidrioTemplate`), esto fija lo que no puede cambiar:
//   · la escalación sigue mandando EXACTAMENTE el mismo cuerpo (guardia de la refactorización);
//   · el aviso del satén reusa la MISMA plantilla aprobada (`informe_diario`, 4 parámetros): crear una
//     plantilla nueva en Meta requiere aprobación y deja al aviso sin salir mientras tanto;
//   · [r8] los parámetros son seguros para Meta en AMBAS (sin saltos de línea ni espacios en racha: 132018),
//     el recorte de etiquetas es por PUNTO DE CÓDIGO y deja el sufijo completo, y un abort por timeout se
//     marca `timedOut` (la request ya salió: es DUDOSO, no «no salió»).
// Hermético: `fetchFn` inyectado, nada sale de la máquina. Las respuestas del fetch falso tienen la FORMA
// REAL de /admin/send-template (index.js:5280): {ok, template, phone, result}.

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
function fetchEspia(respuesta = { ok: true, template: 'informe_diario', phone: '56900000009', result: { ok: true, msgId: 'wamid.T1' } }) {
  const llamadas = [];
  const fetchFn = async (url, opts) => {
    llamadas.push({ url: String(url), cuerpo: JSON.parse(opts.body), metodo: opts.method });
    return { ok: true, json: async () => respuesta };
  };
  return { fetchFn, llamadas };
}
const SURROGATE_SUELTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test('el aviso del satén sale por la plantilla aprobada informe_diario, con folio y etiqueta en sus parámetros', async () => {
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
  assert.equal(cuerpo.linea3,
    'dice "4+12+4 satén (baño)" y "Termopanel 5+12+5 esmerilado" pero se cotizó con vidrio claro; revisar precio',
    'la misma frase que el texto y el panel (fraseBanoPerdido), más el sufijo');
  assert.doesNotMatch(cuerpo.resumen, /ESCALACION|hablar contigo/, 'no es una escalación: no le dice al dueño que un cliente lo espera AHORA');
  assert.ok(cuerpo.fecha, 'los 4 parámetros que exige la plantilla');
  assert.ok(cuerpo.linea4);
});

test('los parámetros de la plantilla no llevan saltos de línea, tabs ni espacios en racha (Meta los rechaza: 132018)', async () => {
  const { fetchFn, llamadas } = fetchEspia();
  await conEntorno(ENTORNO, () => sendAvisoVidrioTemplate('CM-FR-004-2026-0702\n', ['4+12+4\nsatén   \t  (baño) [x]'], { fetchFn }));
  const { resumen, linea3, linea4 } = llamadas[0].cuerpo;
  for (const p of [resumen, linea3, linea4]) {
    assert.doesNotMatch(p, /[\n\r\t]/);
    assert.doesNotMatch(p, / {2,}/);
  }
  assert.match(linea3, /"4\+12\+4 satén \(baño\) \[x\]"/, 'la etiqueta no se altera más que por los espacios');
});

test('[r8 · BAJO-4] etiquetas largas se recortan por PUNTO DE CÓDIGO (sin par sustituto suelto) y el sufijo queda COMPLETO', async () => {
  const { fetchFn, llamadas } = fetchEspia();
  const larga = `satén ${'🪟'.repeat(200)}`;            // cada 🪟 son 2 unidades UTF-16
  await conEntorno(ENTORNO, () => sendAvisoVidrioTemplate('CM-FR-004-2026-0703', [larga], { fetchFn }));
  const { linea3 } = llamadas[0].cuerpo;
  assert.doesNotMatch(linea3, SURROGATE_SUELTO, 'un emoji partido por la mitad no es texto');
  assert.match(linea3, /pero se cotizó con vidrio claro; revisar precio$/, 'el sufijo no se lo come el recorte');
  assert.ok([...linea3].length < 200, `acotado: ${[...linea3].length}`);
  assert.match(linea3, /…"/, 'se nota que la etiqueta está recortada');
});

test('[r8 · BAJO-4] más de 5 etiquetas: salen las primeras y se dice cuántas faltan (el parámetro queda acotado, con el sufijo entero)', async () => {
  const { fetchFn, llamadas } = fetchEspia();
  const muchas = Array.from({ length: 8 }, (_, i) => `4+12+4 satén baño ${i + 1}`);
  await conEntorno(ENTORNO, () => sendAvisoVidrioTemplate('CM-FR-004-2026-0704', muchas, { fetchFn }));
  const { linea3 } = llamadas[0].cuerpo;
  assert.match(linea3, /baño 5"/);
  assert.doesNotMatch(linea3, /baño 6/);
  assert.match(linea3, /\(\+3 más\)/);
  assert.match(linea3, /revisar precio$/);
  assert.ok(linea3.length < 400);
});

test('sin ADMIN_PIN no hay llamada y se dice por qué; un fetch que lanza no revienta', async () => {
  const { fetchFn, llamadas } = fetchEspia();
  const sinPin = await conEntorno({ ...ENTORNO, ADMIN_PIN: undefined },
    () => sendAvisoVidrioTemplate('CM-FR-004-2026-0705', ['satén'], { fetchFn }));
  assert.deepEqual(sinPin, { ok: false, error: 'ADMIN_PIN_missing' });
  assert.equal(llamadas.length, 0, 'sin PIN ni siquiera se intenta');

  const lanza = async () => { throw new Error('ECONNREFUSED'); };
  const r = await conEntorno(ENTORNO, () => sendAvisoVidrioTemplate('CM-FR-004-2026-0705', ['satén'], { fetchFn: lanza }));
  assert.equal(r.ok, false);
  assert.match(r.error, /ECONNREFUSED/);
  assert.ok(!r.timedOut, 'una conexión rechazada NO es un timeout: ahí sí se sabe que no salió');
});

test('[r8 · BAJO-3] el abort por timeout (AbortSignal.timeout de 10 s) se marca `timedOut:true`: la request YA salió, es DUDOSO', async () => {
  // El abort de acá (10 s) vence antes que el axios del endpoint (20 s): el endpoint puede seguir y entregar la
  // plantilla después de que este código se rindió. Sin la marca, el llamador lo toma por «no salió» y reenvía.
  for (const nombre of ['TimeoutError', 'AbortError']) {
    const aborta = async () => { const e = new Error('The operation was aborted due to timeout'); e.name = nombre; throw e; };
    const r = await conEntorno(ENTORNO, () => sendAvisoVidrioTemplate('CM-FR-004-2026-0706', ['satén'], { fetchFn: aborta }));
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, true, nombre);
    const e2 = await conEntorno(ENTORNO, () => sendEscalationTemplate('Pedro', 'x', { fetchFn: aborta }));
    assert.equal(e2.timedOut, true, `${nombre}: también en la escalación (mismo núcleo)`);
  }
});

test('el endpoint dice ok:false (Meta rechazó la plantilla) ⇒ se devuelve tal cual, con el error en result.error, no se maquilla', async () => {
  const { fetchFn } = fetchEspia({ ok: false, template: 'informe_diario', phone: '56900000009', result: { ok: false, error: 'meta_credentials_missing' } });
  const r = await conEntorno(ENTORNO, () => sendAvisoVidrioTemplate('CM-FR-004-2026-0707', ['satén'], { fetchFn }));
  assert.equal(r.ok, false);
  assert.equal(r.result.error, 'meta_credentials_missing');
});

test('guardia de la refactorización — sendEscalationTemplate manda EXACTAMENTE el mismo cuerpo de siempre', async () => {
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

test('[r8] la limpieza de parámetros vive en el NÚCLEO: un nombre de cliente con salto de línea tampoco rompe la escalación', async () => {
  // Antes solo el aviso del satén limpiaba; el nombre del cliente viene de WhatsApp tal cual (perfil, firma).
  const { fetchFn, llamadas } = fetchEspia();
  await conEntorno(ENTORNO, () => sendEscalationTemplate('Pedro\nPérez   \t Soto', 'cliente pide\nhablar con humano', { fetchFn }));
  const { resumen, linea3 } = llamadas[0].cuerpo;
  assert.equal(resumen, 'ESCALACION: Pedro Pérez Soto pide hablar contigo AHORA');
  assert.equal(linea3, 'cliente pide hablar con humano');
  for (const p of [resumen, linea3]) assert.doesNotMatch(p, /[\n\r\t]| {2,}/);
});
