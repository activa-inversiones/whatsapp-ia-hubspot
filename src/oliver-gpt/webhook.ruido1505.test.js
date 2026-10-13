// webhook.ruido1505.test.js — CONDUCTA de la compuerta de ruido dentro del webhook (#1505, 13-oct). Hermético: todo inyectado.
// Defiende lo que pidió el dueño: un primer contacto sin intención NO crea lead, NO pasa por el cerebro, NO le llega al dueño;
// Oliver contesta UNA vez; el mensaje queda en el cockpit marcado; un archivo peligroso NUNCA se descarga; un cliente con
// historial sigue como hoy.   node --test src/oliver-gpt/webhook.ruido1505.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook } from './webhook.js';
import { RESPUESTA_RUIDO, RESPUESTA_CUARENTENA } from './ruido.js';

function makeRes() { return { sentStatus: undefined, sendStatus(c) { this.sentStatus = c; return this; } }; }
let seq = 0;
function makeReq({ type = 'text', text = '', from = '56988887777', raw = null } = {}) {
  const msgId = `wamid.R.${++seq}`;
  const body = { __inbound: { ok: true, from, text, msgId, type } };
  if (raw) body.entry = [{ changes: [{ value: { messages: [{ id: msgId, from, type, timestamp: '1700000000', ...raw }] } }] }];
  return { body };
}
function makeDeps(overrides = {}) {
  const _kv = new Map();
  const spy = { handleTurnCalls: 0, sendCalls: [], notifyCalls: [], convEvents: [], leadEvents: [], downloads: 0, persisted: [] };
  const deps = {
    conv: new Map(), seen: new Set(),
    leerEstado: async (k) => _kv.get(k) ?? null, escribirEstado: (k, v) => _kv.set(k, v),
    parseInbound: (body) => body.__inbound,
    sendWhatsAppText: async (to, text) => { spy.sendCalls.push({ to, text }); return { ok: true }; },
    handleTurn: async ({ state }) => { spy.handleTurnCalls += 1; return { reply: 'cotizando…', history: [{ role: 'user', content: 'x' }], toolCalls: [], state }; },
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async (p) => { spy.convEvents.push(p); return { ok: true }; },
      pushLeadEvent: async (p) => { spy.leadEvents.push(p); return { ok: true }; }, pushQuoteEvent: async () => ({ ok: true }),
    },
    notifyHighValue: async (...a) => { spy.notifyCalls.push(a); return { sent: true }; },
    sendEscalationTemplate: async () => ({ ok: true }),
    loadSession: async () => null,
    persistSession: (from, ses) => { spy.persisted.push({ from, ses }); },
    fetchFn: async () => { spy.downloads += 1; throw new Error('no se descarga nada en este test'); },
  };
  Object.assign(deps, overrides);
  return { deps, spy };
}

describe('#1505 compuerta de ruido en el webhook', () => {
  test('sticker de un número nuevo: ni cerebro, ni lead, ni dueño; queda marcado ruido:true y Oliver contesta UNA vez', async () => {
    const { deps, spy } = makeDeps();
    await handleWebhook(makeReq({ type: 'sticker', text: '[sticker]' }), makeRes(), deps);
    assert.equal(spy.handleTurnCalls, 0); assert.equal(spy.leadEvents.length, 0); assert.equal(spy.notifyCalls.length, 0);
    const inb = spy.convEvents.find((e) => e.direction === 'inbound');
    assert.ok(inb); assert.equal(inb.metadata.ruido, true); assert.equal(inb.metadata.motivo, 'tipo_sticker');
    assert.equal(spy.sendCalls.length, 1); assert.equal(spy.sendCalls[0].text, RESPUESTA_RUIDO);
    assert.ok(spy.convEvents.some((e) => e.direction === 'outbound' && e.metadata.ruido_respuesta === true));
    // segundo sticker del mismo número en la misma hora: queda marcado pero NO se vuelve a contestar
    await handleWebhook(makeReq({ type: 'sticker', text: '[sticker]' }), makeRes(), deps);
    assert.equal(spy.sendCalls.length, 1, 'una respuesta por número cada 24 h');
    assert.equal(spy.convEvents.filter((e) => e.direction === 'inbound' && e.metadata.ruido).length, 2);
    assert.equal(spy.handleTurnCalls, 0);
  });
  test('solo un link (YouTube) de un número nuevo es ruido; «hola quiero cotizar» del mismo número después SÍ va al cerebro', async () => {
    const { deps, spy } = makeDeps();
    await handleWebhook(makeReq({ type: 'text', text: 'https://youtube.com/shorts/cjBJiN5AkWo?si=kCQC' }), makeRes(), deps);
    assert.equal(spy.handleTurnCalls, 0); assert.equal(spy.convEvents.find((e) => e.direction === 'inbound').metadata.motivo, 'solo_link');
    await handleWebhook(makeReq({ type: 'text', text: 'hola quiero cotizar una ventana' }), makeRes(), deps);
    assert.equal(spy.handleTurnCalls, 1, 'con intención entra al embudo normal');
  });
  test('un .exe de cualquiera va a cuarentena: NO se descarga, queda nombre y tipo en el cockpit, y Oliver avisa que no abre archivos', async () => {
    const { deps, spy } = makeDeps();
    // cliente con historial (sesión hidratada con mensajes previos)
    deps.loadSession = async () => ({ history: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'hola' }], state: {} });
    await handleWebhook(makeReq({ type: 'document', text: '[document]', raw: { document: { id: 'doc1', filename: 'factura_pendiente.exe', mime_type: 'application/x-msdownload' } } }), makeRes(), deps);
    assert.equal(spy.downloads, 0, 'jamás se descarga');
    assert.equal(spy.handleTurnCalls, 0);
    const inb = spy.convEvents.find((e) => e.direction === 'inbound');
    assert.equal(inb.metadata.cuarentena, true); assert.equal(inb.metadata.motivo, 'archivo_peligroso');
    assert.match(inb.body, /archivo en cuarentena: factura_pendiente\.exe/);
    assert.equal(spy.sendCalls[0].text, RESPUESTA_CUARENTENA);
    // [Copilot r2] el media id queda en el cockpit para que el operador lo baje a mano si hace falta
    assert.equal(inb.metadata.archivo.id, 'doc1');
    // segundo archivo peligroso en la misma hora: queda marcado pero NO se vuelve a contestar
    await handleWebhook(makeReq({ type: 'document', text: '[document]', raw: { document: { id: 'doc2', filename: 'otro.zip', mime_type: 'application/zip' } } }), makeRes(), deps);
    assert.equal(spy.sendCalls.length, 1, 'una respuesta de cuarentena por número cada 24 h');
  });
  test('[Codex r2] con un HUMANO atendiendo (takeover), un .exe tampoco se descarga: queda en cuarentena en el chat', async () => {
    const { deps, spy } = makeDeps();
    deps.bridge.getConversationControl = async () => ({ ai_paused: true, operator_status: 'human' });
    await handleWebhook(makeReq({ type: 'document', text: '[document]', raw: { document: { id: 'docX', filename: 'premio.exe', mime_type: 'application/x-msdownload' } } }), makeRes(), deps);
    await new Promise((r) => setTimeout(r, 50));   // la captura en takeover es fire-and-forget
    assert.equal(spy.downloads, 0, 'jamás se descarga');
    assert.equal(spy.handleTurnCalls, 0);
    const q = spy.convEvents.find((e) => e.metadata?.cuarentena === true);
    assert.ok(q, 'queda marcado en cuarentena'); assert.equal(q.metadata.archivo.id, 'docX'); assert.equal(q.metadata.ai_paused, true);
  });
  test('[Thermos r2 ALTO-1] el DUEÑO (su número) nunca es ruido aunque su carpeta esté vacía: un sticker suyo sigue al cerebro', async () => {
    const { deps, spy } = makeDeps();
    await handleWebhook(makeReq({ type: 'sticker', text: '[sticker]', from: '56957296035' }), makeRes(), deps);
    // (sin carpeta activa el flujo del dueño le pide el cliente; lo que se defiende acá es que JAMÁS se lo trate como ruido)
    assert.ok(!spy.convEvents.some((e) => e.metadata?.ruido), 'ningún registro marcado ruido');
    assert.ok(!spy.sendCalls.some((c) => c.text === RESPUESTA_RUIDO), 'nunca recibe el texto de ruido');
  });
  test('un sticker de un cliente CON historial sigue al cerebro como hoy (no es ruido)', async () => {
    const { deps, spy } = makeDeps();
    deps.loadSession = async () => ({ history: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'hola' }], state: {} });
    await handleWebhook(makeReq({ type: 'sticker', text: '[sticker]' }), makeRes(), deps);
    assert.equal(spy.handleTurnCalls, 1);
    assert.ok(!spy.convEvents.some((e) => e.metadata?.ruido));
  });
  test('killswitch RUIDO_COMPUERTA=off: el sticker nuevo va al cerebro como antes', async () => {
    const prev = process.env.RUIDO_COMPUERTA; process.env.RUIDO_COMPUERTA = 'off';
    try {
      const { deps, spy } = makeDeps();
      await handleWebhook(makeReq({ type: 'sticker', text: '[sticker]' }), makeRes(), deps);
      assert.equal(spy.handleTurnCalls, 1);
    } finally { if (prev === undefined) delete process.env.RUIDO_COMPUERTA; else process.env.RUIDO_COMPUERTA = prev; }
  });
  test('la escalación sigue teniendo prioridad sobre todo: «quiero hablar con un humano» de un número nuevo escala, no es ruido', async () => {
    const { deps, spy } = makeDeps();
    await handleWebhook(makeReq({ type: 'text', text: 'Quiero hablar con un humano' }), makeRes(), deps);
    assert.equal(spy.notifyCalls.length, 1);
  });
});
