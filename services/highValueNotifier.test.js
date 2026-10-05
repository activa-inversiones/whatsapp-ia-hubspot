// highValueNotifier.test.js — RED ANTI-REGRESIÓN — tablero ACTIVA #58
// ═══════════════════════════════════════════════════════════════════════════
// Reproduce y fija las 2 fallas encontradas 21/22-jul (ver ESTADO-ACTIVA.md
// 2026-07-21 punto 1 + PENDIENTES-ACTIVA.md #58), verificadas contra el
// highValueNotifier.js REAL de este repo (v1.0.0, tiers STANDARD/MEDIUM/HIGH
// — no existe tier "VIP" ni texto ">1 MILLÓN" hardcodeado, eso era solo el
// draft de Gemini nunca mergeado):
//
//   (a) VIP falso: el score llega a HIGH (80 pts EXACTOS, reproducido con la
//       combo real: 5 items + "proyecto" + "urgente" + Temuco + nombre +
//       stageKey cotizacion_enviada) usando SOLO señales blandas, con
//       grand_total = 0. Un $0/null jamás debe puntuar al tier tope.
//   (b) Cooldown que silencia al VIP real: la key `${phone}:${reason}` no
//       distingue tier — una alerta previa de menor tier (el falso positivo
//       de (a)) deja la MISMA key seteada y silencia 2h la alerta siguiente
//       aunque esa sí sea un HIGH real (monto confirmado).
//
// Sin red, sin BD — mock de waSendFn. OWNER_NOTIFICATION_PHONE se setea ANTES
// del import dinámico porque el módulo lo lee en un const top-level.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.OWNER_NOTIFICATION_PHONE = '56900000000';
const { evaluateLeadValue, notifyHighValue } = await import('./highValueNotifier.js');

// Mock de waSendFn: no golpea red, solo registra los envíos.
function makeWaSendMock() {
  const calls = [];
  const fn = async (phone, msg) => { calls.push({ phone, msg }); return true; };
  fn.calls = calls;
  return fn;
}

test('r19: rastro sin cliente identificado → la alerta NO afirma cliente ni dice «responde directo» con el teléfono del chat', async () => {
  const send = makeWaSendMock();
  const r = await notifyHighValue(send, '56911110000', { sin_cliente: true, data: { telefono: '56911110000', folio: 'F-1' }, history: [] },
    'oliver_gpt:x [whatsapp] Propuesta F-1 NO se entregó (no entregable) — reenviarlo desde el inbox');
  assert.equal(r.sent, true);
  const msg = send.calls[0].msg;
  assert.match(msg, /cliente no identificado en el rastro/i);
  assert.doesNotMatch(msg, /responde directo al/i);
  assert.doesNotMatch(msg, /📞 Cliente: 56911110000/);
});

// Sesión "caso real" del repro documentado: 5 items, "proyecto" + "urgente"
// en el mensaje, comuna Temuco, nombre, stage cotizacion_enviada, $0 total.
// `dataOverrides` se mergea DENTRO de `data` (no reemplaza el objeto entero).
function falsePositiveSession(dataOverrides = {}) {
  return {
    data: {
      grand_total: 0,
      items: [{ product: 'ventana' }, { product: 'ventana' }, { product: 'ventana' }, { product: 'ventana' }, { product: 'ventana' }],
      comuna: 'Temuco',
      name: 'Juan Pérez',
      stageKey: 'cotizacion_enviada',
      ...dataOverrides,
    },
    history: [
      { role: 'user', content: 'Tengo un proyecto urgente, necesito cotizar toda la casa' },
    ],
  };
}

// Sesión con monto REAL confirmado (cruza HIGH_VALUE_THRESHOLD=800000) — el
// "VIP real" que no debe quedar mudo.
function realHighValueSession(dataOverrides = {}) {
  return {
    data: {
      grand_total: 900000,
      items: [{ product: 'ventana' }, { product: 'ventana' }, { product: 'ventana' }],
      stageKey: 'cotizacion_enviada',
      ...dataOverrides,
    },
    history: [],
  };
}

// ── (a) GATE: $0/null nunca puntúa como tier tope ───────────────────────────
test('HVN-01: combo de señales blandas con grand_total=0 da 80 pts EXACTOS pero el tier queda topado a MEDIUM (nunca HIGH)', () => {
  const score = evaluateLeadValue(falsePositiveSession());
  assert.equal(score.value, 80, 'debe reproducir el puntaje exacto documentado (25 items + 15 keyword + 10 urgencia + 5 comuna + 10 nombre + 15 stage)');
  assert.notEqual(score.tier, 'HIGH', 'un $0 jamás debe alcanzar el tier tope solo con señales blandas');
  assert.equal(score.tier, 'MEDIUM');
});

test('HVN-02: mismo combo con grand_total=null se comporta igual que $0 (no HIGH)', () => {
  const score = evaluateLeadValue(falsePositiveSession({ grand_total: null }));
  assert.notEqual(score.tier, 'HIGH');
});

test('HVN-03: control — el mismo puntaje CON monto real (>0) sí puede llegar a HIGH (el gate no rompe el caso legítimo)', () => {
  // 80 pts de señales blandas + evidencia real de monto → debe seguir siendo HIGH.
  const score = evaluateLeadValue(falsePositiveSession({ grand_total: 1 }));
  assert.equal(score.tier, 'HIGH', 'con monto > 0 confirmado, 80 pts sí debe ser HIGH (no sobre-corregir)');
});

test('HVN-04: notifyHighValue con el falso positivo envía como "VALOR MEDIO", nunca "ALTO VALOR"', async () => {
  const waSend = makeWaSendMock();
  const result = await notifyHighValue(waSend, '56911111111', falsePositiveSession(), 'auto');
  assert.equal(result.sent, true, 'MEDIUM con reason=auto sí debe enviarse (solo STANDARD+auto se bloquea)');
  assert.equal(result.tier, 'MEDIUM');
  assert.equal(waSend.calls.length, 1);
  assert.match(waSend.calls[0].msg, /VALOR MEDIO/);
  assert.doesNotMatch(waSend.calls[0].msg, /ALTO VALOR/);
});

// ── (b) COOLDOWN: un ascenso de tier no debe quedar mudo ────────────────────
test('HVN-05: un falso positivo (MEDIUM) NO debe silenciar 2h al VIP real (HIGH) que llega después para el mismo teléfono/reason', async () => {
  const waSend = makeWaSendMock();
  const phone = '56922222222';

  // 1) Falso positivo primero: dispara y consume el cooldown de "phone:auto".
  const first = await notifyHighValue(waSend, phone, falsePositiveSession(), 'auto');
  assert.equal(first.sent, true);
  assert.equal(first.tier, 'MEDIUM');

  // 2) Acto seguido (mismo minuto, muy dentro de las 2h de cooldown) llega la
  //    cotización real de alto valor. Antes del fix, la key "phone:auto" ya
  //    estaba seteada por el falso positivo → esta alerta quedaba muda.
  const second = await notifyHighValue(waSend, phone, realHighValueSession(), 'auto');
  assert.equal(second.tier, 'HIGH', 'el segundo lead sí es HIGH real (monto confirmado)');
  assert.equal(second.sent, true, 'el VIP real NO debe quedar silenciado por el cooldown del falso positivo anterior');
  assert.equal(waSend.calls.length, 2);
  assert.match(waSend.calls[1].msg, /ALTO VALOR/);
});

test('HVN-06: control — dos alertas del MISMO tier para el mismo teléfono/reason sí respetan el cooldown (no se rompió el anti-spam)', async () => {
  const waSend = makeWaSendMock();
  const phone = '56933333333';

  const first = await notifyHighValue(waSend, phone, realHighValueSession(), 'auto');
  assert.equal(first.sent, true);
  assert.equal(first.tier, 'HIGH');

  // Repetir el MISMO tier HIGH inmediatamente después: debe seguir cooldowneado.
  const second = await notifyHighValue(waSend, phone, realHighValueSession(), 'auto');
  assert.equal(second.sent, false);
  assert.equal(second.reason, 'cooldown');
  assert.equal(waSend.calls.length, 1, 'no debe reenviar spam del mismo tier dentro de las 2h');
});

// ── (c) [05-oct · r5 · Thermos MEDIO-BAJO] un envío que Meta RECHAZA no es un envío ──────────────
// CAUSA RAÍZ (medida leyendo el contrato de los dos lados): `sendWhatsAppText` —el waSendFn con
// que llaman webhook.js y channel-agent.js— NO LANZA cuando Meta rechaza: devuelve `{ok:false, ...}`
// (whatsapp-adapter.js, errorEstructurado). Pero `notifyHighValue` solo miraba si el `await`
// LANZABA (try/catch): un `{ok:false}` pasaba por el camino feliz ⇒ fijaba el cooldown de 2 h y
// devolvía `sent:true`. El aviso al dueño se perdía en silencio Y la repetición quedaba silenciada
// 2 h. 131047 = «re-engagement»: pasa cuando el dueño no le escribió al bot en las últimas 24 h.
// Contrato que se fija: SOLO un rechazo EXPLÍCITO (`{ok:false}` / `false`) cuenta como no-enviado.
// `waSend` de index.js no devuelve nada (undefined) y los fakes devuelven `true`: eso sigue siendo enviado.
const rechazoMeta = (extra = {}) => async () => ({
  ok: false, error: '{"error":{"code":131047,"message":"Re-engagement message"}}', status: 400, code: 131047, timedOut: false, ...extra,
});

test('HVN-07 [r5]: Meta rechaza el envío ({ok:false, code:131047}) ⇒ sent:false con el motivo y el código, y SIN cooldown', async () => {
  const phone = '56944444441';
  const first = await notifyHighValue(rechazoMeta(), phone, realHighValueSession(), 'auto');
  assert.equal(first.sent, false, 'un envío rechazado por Meta NO es un aviso enviado');
  assert.equal(first.reason, 'envio_fallido');
  assert.equal(first.code, 131047, 'el código de Meta viaja: sin él nadie distingue "fuera de ventana" de otra falla');
  assert.match(String(first.error), /131047/, 'el texto del rechazo viaja en `error` (es lo que leen los llamadores)');

  // Sin cooldown: el aviso NUNCA llegó, así que el reintento (con el canal ya sano) tiene que salir.
  const waSend = makeWaSendMock();
  const second = await notifyHighValue(waSend, phone, realHighValueSession(), 'auto');
  assert.equal(second.sent, true, 'un envío que falló no puede silenciar 2 h al siguiente');
  assert.equal(waSend.calls.length, 1);
});

test('HVN-08 [r5]: lo que NO es un rechazo explícito sigue contando como enviado (undefined de index.js:waSend, true, {ok:true})', async () => {
  for (const [i, devuelve] of [[1, undefined], [2, true], [3, { ok: true, msgId: 'wamid.1' }], [4, { ok: true }]]) {
    const calls = [];
    const waSend = async (to, msg) => { calls.push({ to, msg }); return devuelve; };
    const phone = `5695555555${i}`;
    const first = await notifyHighValue(waSend, phone, realHighValueSession(), 'auto');
    assert.equal(first.sent, true, `waSend que devuelve ${JSON.stringify(devuelve)} cuenta como enviado`);
    const second = await notifyHighValue(waSend, phone, realHighValueSession(), 'auto');
    assert.equal(second.sent, false);
    assert.equal(second.reason, 'cooldown', `y fija el cooldown (devuelve ${JSON.stringify(devuelve)})`);
    assert.equal(calls.length, 1);
  }
});

test('HVN-09 [r5]: `false` y las salidas bloqueadas / sin credenciales ({ok:false, error}) también son no-enviado', async () => {
  const casos = [
    ['false a secas', async () => false, 'envio_fallido'],
    ['salida bloqueada por el embudo', async () => ({ ok: false, error: 'salida_bloqueada', motivos: ['tool_call'] }), 'envio_fallido'],
    ['credenciales de Meta ausentes', async () => ({ ok: false, error: 'meta_credentials_missing' }), 'envio_fallido'],
  ];
  for (const [i, [nombre, waSend, reason]] of casos.entries()) {
    const r = await notifyHighValue(waSend, `5696666666${i}`, realHighValueSession(), 'auto');
    assert.equal(r.sent, false, nombre);
    assert.equal(r.reason, reason, nombre);
  }
});

test('HVN-10 [r5]: control — un waSend que LANZA ya devolvía sent:false+error y no fijaba cooldown (no se rompió)', async () => {
  const phone = '56977777771';
  const lanza = async () => { throw new Error('socket hang up'); };
  const first = await notifyHighValue(lanza, phone, realHighValueSession(), 'auto');
  assert.equal(first.sent, false);
  assert.match(String(first.error), /socket hang up/);
  const waSend = makeWaSendMock();
  const second = await notifyHighValue(waSend, phone, realHighValueSession(), 'auto');
  assert.equal(second.sent, true, 'tampoco fijó cooldown');
});

// ── (d) [05-oct · r6 · Thermos BAJO-MEDIO] un TIMEOUT no es un rechazo: Meta pudo haber entregado ──
// CAUSA RAÍZ: la salida de r5 trata TODO `{ok:false}` como «no salió, sin cooldown». Pero el adapter
// (whatsapp-adapter.js, errorEstructurado) marca `timedOut:true` cuando vence el axios de 15 s: la
// request YA SALIÓ y Meta pudo haber entregado el aviso (errorMeta.clasificar lo llama DESCONOCIDO, no
// «fallo conocido»). Sin cooldown, cada reintento reenvía ⇒ el dueño recibe duplicados, y tools.js
// (falloDeCotizacion) llama a notifyMarcelo UNA VEZ POR VENTANA fuera de alcance ⇒ N ventanas = N envíos.
// Contrato que se fija: `timedOut === true` ⇒ SÍ se fija el cooldown y se devuelve `envio_dudoso`.
// Cualquier otro `{ok:false}` (rechazo de Meta, salida bloqueada, sin credenciales) sigue SIN cooldown (HVN-07/09).
const sinRespuesta = () => ({ ok: false, error: 'timeout of 15000ms exceeded', status: undefined, code: undefined, timedOut: true, netCode: 'ECONNABORTED' });

test('HVN-11 [r6]: timeout del adapter ({ok:false, timedOut:true}) ⇒ sent:false/envio_dudoso Y fija cooldown: dos llamadas ⇒ UN solo envío', async () => {
  const phone = '56988888881';
  const calls = [];
  const waSend = async (to, msg) => { calls.push({ to, msg }); return sinRespuesta(); };
  const first = await notifyHighValue(waSend, phone, realHighValueSession(), 'auto');
  assert.equal(first.sent, false, 'no se puede afirmar que salió');
  assert.equal(first.reason, 'envio_dudoso', 'y se dice la verdad: no sabemos si Meta lo entregó');
  assert.match(String(first.error), /timeout/, 'el texto del timeout viaja en `error` (es lo que leen los llamadores)');
  const second = await notifyHighValue(waSend, phone, realHighValueSession(), 'auto');
  assert.equal(second.sent, false);
  assert.equal(second.reason, 'cooldown', 'el reintento NO reenvía: el aviso pudo haber llegado');
  assert.equal(calls.length, 1, 'un timeout que pudo entregar no se reenvía: el dueño no recibe duplicados');
});

test('HVN-12 [r6]: N ventanas fuera de alcance con el envío en timeout ⇒ 1 solo envío (la amplificación de falloDeCotizacion)', async () => {
  // Misma forma que tools.js falloDeCotizacion: mismo teléfono, mismo reason `oliver_gpt:producto_fuera_de_alcance:…`,
  // sesión sin monto (tier STANDARD, que las escalaciones explícitas de oliver_gpt: nunca bloquean).
  const phone = '56988888882';
  const calls = [];
  const waSend = async (to, msg) => { calls.push({ to, msg }); return sinRespuesta(); };
  const sesion = { data: { items: [] }, history: [] };
  const resultados = [];
  for (let i = 0; i < 3; i++) {
    resultados.push(await notifyHighValue(waSend, phone, sesion, 'oliver_gpt:producto_fuera_de_alcance:andes'));
  }
  assert.equal(calls.length, 1, '3 ventanas ⇒ 1 aviso, no 3');
  assert.deepEqual(resultados.map((r) => r.reason), ['envio_dudoso', 'cooldown', 'cooldown']);
});

test('HVN-13 [r6]: control — solo `timedOut === true` cuenta: `false`/ausente/«true» siguen SIN cooldown (rechazo verificable)', async () => {
  for (const [i, timedOut] of [false, undefined, 'true', 1].entries()) {
    const calls = [];
    const waSend = async (to, msg) => { calls.push({ to, msg }); return { ok: false, error: 'x', timedOut }; };
    const phone = `5699999991${i}`;
    const first = await notifyHighValue(waSend, phone, realHighValueSession(), 'auto');
    assert.equal(first.reason, 'envio_fallido', `timedOut=${JSON.stringify(timedOut)}`);
    const second = await notifyHighValue(waSend, phone, realHighValueSession(), 'auto');
    assert.equal(second.reason, 'envio_fallido', `sin cooldown (timedOut=${JSON.stringify(timedOut)})`);
    assert.equal(calls.length, 2);
  }
});

// ── (e) [05-oct · r7] la rama `catch` TAMBIÉN dice POR QUÉ no envió ────────────────────────────────
// CAUSA RAÍZ: todas las demás salidas con `sent:false` traen `reason` (`cooldown`, `standard_lead`,
// `no_owner_phone`, `envio_fallido`, `envio_dudoso`), pero el `catch` devolvía `{sent:false, error}` SIN
// `reason`. tools.js (`notificar_marcelo`) arma `motivo: result?.reason` ⇒ quedaba `undefined` justo
// cuando el notificador reventó, y el LLM no podía distinguir «lanzó» de «sin confirmación».
test('HVN-14 [r7]: un waSend que LANZA ⇒ sent:false, reason:\'excepcion\' y el texto en `error` (antes `reason` era undefined)', async () => {
  const phone = '56977777772';
  const lanza = async () => { throw new Error('socket hang up'); };
  const r = await notifyHighValue(lanza, phone, realHighValueSession(), 'auto');
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'excepcion', 'todo no-envío trae su motivo; el catch era el único que no');
  assert.match(String(r.error), /socket hang up/, 'y el detalle sigue viajando en `error`');
  // Sin cooldown (como siempre): el reintento con el canal sano tiene que salir.
  const waSend = makeWaSendMock();
  assert.equal((await notifyHighValue(waSend, phone, realHighValueSession(), 'auto')).sent, true);
});

test('HVN-15 [r7]: de punta a punta — notificar_marcelo con el notificador REAL que lanza ⇒ `motivo:\'excepcion\'` (no undefined)', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  const lanza = async () => { throw new Error('boom'); };
  // La misma forma que cablea webhook.js: ctx.notifyMarcelo({reason, data}) → notifyHighValue(..., reason).
  const ctx = { notifyMarcelo: ({ reason, data }) => notifyHighValue(lanza, '56977777773', { data, history: [] }, reason) };
  const r = await runTool('notificar_marcelo', { motivo: 'pide humano' }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.enviado, false);
  assert.equal(r.motivo, 'excepcion', 'el LLM ve que el aviso reventó, no un motivo vacío');
  assert.match(r.reason, /^oliver_gpt:pide humano/, '`reason` sigue siendo el motivo de ENTRADA');
});
