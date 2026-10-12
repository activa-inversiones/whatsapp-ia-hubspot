// [2026-10-12 · #1500-C] EL WEBHOOK EMITE LA PROPUESTA PARA EL OLIVER INTERNO POR EL CAMINO DETERMINISTA.
//
// `deps.emisionInterna` = {items, nombre, comuna, documentos, operador, onResultado}. El turno NO pasa por el
// LLM (handleTurn no se llama), usa el MISMO `toolCtx.generarPdf` que el «sí» del cliente (folio, PDF premium,
// envío por WhatsApp, Zoho, ISO, informes), no persiste la marca sintética como si fuera un mensaje del
// cliente, y no lo frena el takeover humano (lo está liberando una persona). Hermético: el harness es el de
// gate-reloj-persiste.test.js; `fetch` global se reemplaza para el folio y los registros en sales-os.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SALES_OS_URL = process.env.SALES_OS_URL || 'http://sos.test';
process.env.SALES_OS_OPERATOR_TOKEN = process.env.SALES_OS_OPERATOR_TOKEN || 'tok-test';
const { handleWebhook } = await import('./webhook.js');

const MARCA = '⟦emisión interna desde la agenda⟧';
const ITEMS = [{ producto_label: 'Bow window · 3 paños', measures: '3500x1500', color: 'NOGAL', qty: 1, unit_price: 792902, glass_label: 'Termopanel 5+12+5' }];

function makeRes() { return { sendStatus: () => {}, status: () => ({ json: () => {} }), json: () => {} }; }

// Un teléfono distinto por test: el pipeline tiene anti-duplicado por cliente (mismos ítems en minutos = misma
// propuesta, folio reusado) y eso es correcto en producción, pero acá haría que el 2.º test «reuse» el del 1.º.
let telefonoN = 0;
function harness({ emisionInterna, aiPaused = false, folioOk = true }) {
  telefonoN += 1;
  const TEL = `5694138${String(1000 + telefonoN).slice(-4)}`;
  const registro = { tel: TEL, turnos: 0, docs: [], textos: [], eventos: [], fetches: [], guardado: null, zoho: 0 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    registro.fetches.push(u);
    if (/\/internal\/quotes\/next-number/.test(u)) {
      return folioOk
        ? { ok: true, status: 200, json: async () => ({ quote_number: 'CM-FR-004-2026-0800' }), text: async () => '' }
        : { ok: false, status: 503, json: async () => ({}), text: async () => 'caido' };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, termico: false, vientos: false, origen: 'default_modificacion' }), text: async () => '{}' };
  };
  const deps = {
    conv: new Map(), seen: new Set(), locks: new Map(),
    dormir: async () => {},
    leerEstado: async () => null,
    escribirEstado: () => {},
    parseInbound: () => ({ ok: true, from: TEL, type: 'text', text: MARCA, msgId: `interno-${Math.random()}`, enviadoAt: Date.now() }),
    sendWhatsAppText: async (_to, texto) => { registro.textos.push(texto); return { ok: true, msgId: 'txt-1' }; },
    generatePdf: async () => Buffer.from('%PDF-1.4 fake'),
    uploadWaDocument: async () => 'media-x',
    sendWaDocument: async (to, media, filename, caption) => { registro.docs.push({ to, media, filename, caption }); return { ok: true, msgId: 'doc-1' }; },
    upsertZohoDeal: async () => { registro.zoho += 1; return { ok: true, id: 'deal-1' }; },
    attachPdfToDeal: async () => ({ ok: true }),
    addZohoNote: async () => ({ ok: true }),
    saveMedia: async () => ({ ok: true }),
    loadSession: async () => ({ history: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'Hola, ¿en qué le ayudo?' }], state: { name: 'Claudio', comuna: 'Angol' } }),
    persistSession: (_from, sesion) => { registro.guardado = sesion; },
    bridge: {
      getConversationControl: async () => ({ ai_paused: aiPaused, operator_status: aiPaused ? 'human' : 'ai' }),
      pushConversationEvent: async (ev) => { registro.eventos.push(ev); return { ok: true }; },
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async () => ({ ok: true }),
    },
    handleTurn: async () => { registro.turnos += 1; return { reply: 'NO DEBERÍA LLAMARSE', history: [], toolCalls: [], state: {} }; },
    ...(emisionInterna ? { emisionInterna } : {}),
  };
  return { deps, registro, restaurar: () => { globalThis.fetch = originalFetch; } };
}

function emision(extra = {}) {
  let resolver;
  const resultado = new Promise((r) => { resolver = r; });
  return { ei: { items: ITEMS, nombre: 'Claudio', comuna: 'Angol', operador: 'Mary', documentos: null, onResultado: (r) => resolver(r), ...extra }, resultado };
}

test('[#1500-C] con deps.emisionInterna el webhook emite la propuesta SIN LLM: PDF enviado al cliente, folio del mismo correlativo, onResultado con quote_number', async () => {
  const { ei, resultado } = emision();
  const { deps, registro, restaurar } = harness({ emisionInterna: ei });
  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
    const r = await Promise.race([resultado, new Promise((res) => { setTimeout(() => res({ timeout: true }), 8000); })]);
    assert.equal(registro.turnos, 0, 'el LLM no interviene');
    assert.ok(!r.timeout, 'onResultado tiene que llamarse');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.quote_number, 'CM-FR-004-2026-0800');
    assert.equal(registro.docs.length >= 1, true, 'el PDF salió por WhatsApp al cliente');
    assert.equal(registro.docs[0].to, registro.tel);
    assert.ok(registro.fetches.some((u) => /\/internal\/quotes\/next-number/.test(u)), 'el folio sale del mismo correlativo que WhatsApp');
  } finally { restaurar(); }
});

test('[#1500-C] la marca sintética NO se persiste como mensaje del cliente; lo que queda es un evento del operador con el folio', async () => {
  const { ei, resultado } = emision();
  const { deps, registro, restaurar } = harness({ emisionInterna: ei });
  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
    await Promise.race([resultado, new Promise((res) => { setTimeout(res, 8000); })]);
    const delCliente = registro.eventos.filter((e) => e.direction === 'inbound' && e.actor_type === 'customer' && String(e.body || '').includes(MARCA));
    assert.equal(delCliente.length, 0, 'ningún evento «Cliente: ⟦emisión interna⟧»');
    const delOperador = registro.eventos.find((e) => e.metadata && e.metadata.source === 'oliver_interno_liberar');
    assert.ok(delOperador, 'queda la huella de quién liberó');
    assert.equal(delOperador.actor_type, 'operator');
    assert.equal(delOperador.actor_name, 'Mary');
    assert.equal(delOperador.metadata.quote_number, 'CM-FR-004-2026-0800');
    assert.ok(registro.guardado, 'la sesión se persiste (pending_quote limpio, historia con la entrega)');
    assert.equal(registro.guardado.state.pending_quote, null);
  } finally { restaurar(); }
});

test('[#1500-C] el takeover humano (ai_paused) NO frena la emisión interna: la está liberando una persona', async () => {
  const { ei, resultado } = emision();
  const { deps, registro, restaurar } = harness({ emisionInterna: ei, aiPaused: true });
  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
    const r = await Promise.race([resultado, new Promise((res) => { setTimeout(() => res({ timeout: true }), 8000); })]);
    assert.ok(!r.timeout && r.ok === true, `con takeover también emite: ${JSON.stringify(r)}`);
    assert.equal(registro.docs.length >= 1, true);
  } finally { restaurar(); }
});

test('[#1500-C] sin folio (correlativo caído) no sale PDF: onResultado ok:false con motivo, y nada se le manda al cliente', async () => {
  const { ei, resultado } = emision();
  const { deps, registro, restaurar } = harness({ emisionInterna: ei, folioOk: false });
  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
    const r = await Promise.race([resultado, new Promise((res) => { setTimeout(() => res({ timeout: true }), 8000); })]);
    assert.ok(!r.timeout, 'onResultado se llama también cuando falla');
    assert.equal(r.ok, false);
    assert.ok(r.error, 'con motivo');
    assert.equal(registro.docs.length, 0, 'sin folio no hay PDF');
  } finally { restaurar(); }
});

test('[#1500-C] sin deps.emisionInterna el turno es el de siempre (handleTurn se llama)', async () => {
  const { deps, registro, restaurar } = harness({});
  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.equal(registro.turnos, 1);
  } finally { restaurar(); }
});
