// avisoVidrio.integracion.test.js — [2026-10-05 · r8] EL AVISO POR SATÉN, DE PUNTA A PUNTA con los módulos REALES.
//
// Real: highValueNotifier (el texto), escalation.sendAvisoVidrioTemplate (la plantilla, con un fetch falso con
// la forma de /admin/send-template), canalesAvisoVidrio (el cableado), vidrioCotizado.avisarVidrio y
// estadoPersistente (reserva + marca; en los tests es solo memoria). Falso: lo que habla con Meta y con sales-os.
//
// ¿Por qué un archivo aparte? `highValueNotifier` lee OWNER_NOTIFICATION_PHONE al IMPORTARSE; acá se fija el
// entorno ANTES de importar (los imports dinámicos van después), cosa que el import estático de
// vidrioCotizado.test.js no permite.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OWNER_NOTIFICATION_PHONE = '56900000009';
process.env.ADMIN_PIN = 'pin-de-prueba';
process.env.SELF_URL = 'http://bot.test';
delete process.env.OLIVER_ADMIN_PIN;

const { notifyHighValue } = await import('./highValueNotifier.js');
const { avisarVidrio, aplicarVidrio } = await import('./vidrioCotizado.js');
const { sendAvisoVidrioTemplate } = await import('../src/oliver-gpt/escalation.js');
const { crearCanalesAvisoVidrio, almacenDeAvisos } = await import('../src/oliver-gpt/canalesAvisoVidrio.js');
const estadoReal = await import('./estadoPersistente.js');

const ETIQUETA = '4+12+4 satén (baño)';

/**
 * Un turno de WhatsApp con el cableado real. `waSend` = lo que contesta Meta al texto libre; `endpoint` = lo que
 * contesta /admin/send-template (la forma REAL: {ok, template, phone, result}).
 */
function escenario({ folio, cliente, waSend, endpoint }) {
  const visto = { textos: [], plantillas: [], eventos: [], logs: [] };
  const fetchFn = async (url, opts) => {
    visto.plantillas.push({ url: String(url), cuerpo: JSON.parse(opts.body) });
    return { ok: true, json: async () => endpoint() };
  };
  const safe = async (_rotulo, fn) => { try { return await fn(); } catch { return null; } };
  const canales = crearCanalesAvisoVidrio({
    safe,
    bridge: { pushConversationEvent: async (p) => { visto.eventos.push(p); return { ok: true }; } },
    channel: 'whatsapp', externalId: cliente, source: 'oliver_gpt_webhook',
    notifyFn: notifyHighValue,
    waSend: async (a, t) => { visto.textos.push({ a, t }); return waSend(); },
    cliente, sesion: { data: { items: [] }, history: [] },
    plantillaFn: (f, e) => sendAvisoVidrioTemplate(f, e, { fetchFn }),
  });
  const avisos = () => { const a = []; aplicarVidrio({ glass_label: ETIQUETA }, '4+12+4', { avisos: a }); return a; };
  const avisar = () => avisarVidrio({
    avisos: avisos(), folio, logWarn: (a, t) => visto.logs.push(`${a} ${t}`), canales, estado: almacenDeAvisos(),
  });
  return { visto, avisar };
}
const ENDPOINT_OK = () => ({ ok: true, template: 'informe_diario', phone: '56900000009', result: { ok: true, msgId: 'wamid.T' } });
const ENDPOINT_FALLA = () => ({ ok: false, template: 'informe_diario', phone: '56900000009', result: { ok: false, error: 'meta_credentials_missing' } });

test('🔴 EL CASO MEDIDO (AGENTS.md:15-19): Meta ACEPTA el texto fuera de la ventana (200 + id) ⇒ el notificador dice sent:true Y LA PLANTILLA SALE IGUAL', async () => {
  estadoReal._reset();
  const e = escenario({ folio: 'CM-FR-004-2026-0801', cliente: '56911110801',
    waSend: async () => ({ ok: true, msgId: 'wamid.ACEPTADO_Y_FALLADO_DESPUES' }), endpoint: ENDPOINT_OK });
  await e.avisar();
  assert.equal(e.visto.textos.length, 1, 'el texto salió (y Meta lo marcará failed 131047 por webhook, que acá nadie ve)');
  assert.equal(e.visto.plantillas.length, 1, 'la plantilla sale igual: es la que SÍ pasa la ventana');
  const { url, cuerpo } = e.visto.plantillas[0];
  assert.equal(url, 'http://bot.test/admin/send-template?pin=pin-de-prueba');
  assert.equal(cuerpo.template, 'informe_diario');
  assert.equal(cuerpo.phone, '56900000009');
  assert.match(cuerpo.resumen, /CM-FR-004-2026-0801/);
  assert.match(cuerpo.linea3, /satén \(baño\)" pero se cotizó con vidrio claro; revisar precio$/);
  assert.deepEqual(e.visto.eventos, []);
  assert.deepEqual(e.visto.logs.filter((l) => /aviso_no_salio|canal_degradado/.test(l)), []);

  // Una vez por folio: ni otro texto ni otra plantilla.
  await e.avisar();
  assert.equal(e.visto.textos.length, 1);
  assert.equal(e.visto.plantillas.length, 1);
  estadoReal._reset();
});

test('Meta rechaza el texto de entrada (131047 síncrono) y la plantilla no sale ⇒ log + evento en el panel; arreglado el canal, el reintento SÍ avisa', async () => {
  estadoReal._reset();
  let sano = false;
  const e = escenario({ folio: 'CM-FR-004-2026-0802', cliente: '56911110802',
    waSend: async () => (sano ? { ok: true, msgId: 'w' } : { ok: false, error: '{"error":{"code":131047}}', status: 400, code: 131047 }),
    endpoint: () => (sano ? ENDPOINT_OK() : ENDPOINT_FALLA()) });
  await e.avisar();
  assert.equal(e.visto.eventos.length, 1);
  assert.equal(e.visto.eventos[0].external_id, '56911110802');
  assert.equal(e.visto.eventos[0].metadata.aviso_fallido, true);
  assert.match(e.visto.logs.find((l) => l.startsWith('vidrio.aviso_no_salio')), /131047.*meta_credentials_missing/);

  // Antes de r5 el cooldown quedaba fijado por el envío fallido y el reintento salía mudo 2 h. Y sin marca, reintenta.
  sano = true;
  await e.avisar();
  assert.equal(e.visto.textos.length, 2, 'el reintento le manda el texto');
  assert.equal(e.visto.plantillas.length, 2, 'y la plantilla');
  assert.equal(e.visto.eventos.length, 1, 'sin un segundo evento');
  estadoReal._reset();
});

test('el texto sale y el endpoint de plantillas falla ⇒ el dueño ESTÁ avisado (texto): sin evento en el panel, con el canal roto dicho en el log', async () => {
  estadoReal._reset();
  const e = escenario({ folio: 'CM-FR-004-2026-0803', cliente: '56911110803',
    waSend: async () => ({ ok: true, msgId: 'w' }), endpoint: ENDPOINT_FALLA });
  await e.avisar();
  assert.deepEqual(e.visto.eventos, []);
  const deg = e.visto.logs.find((l) => l.startsWith('vidrio.canal_degradado'));
  assert.match(deg, /plantilla/);
  assert.match(deg, /meta_credentials_missing/, 'el error de Meta, de result.error');
  estadoReal._reset();
});
