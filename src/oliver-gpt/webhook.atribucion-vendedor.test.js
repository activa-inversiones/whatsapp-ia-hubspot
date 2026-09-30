// GUARDIAS DE UNA DECISIÓN DEL DUEÑO (30-sep-2026): la cotización que hace un vendedor de
// /equipo (modo interno) con el comando CLIENTE cuenta al CLIENTE, no al vendedor.
// Si esto se pone rojo, alguien está deshaciendo esa decisión — no es un test para "arreglar".
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleWebhook } from './webhook.js';
import { fijar, _reset as resetAtribucion } from '../../services/atribucionCotizacion.js';
import { aplicarLista, _reiniciarParaTests } from '../../services/internosEquipo.js';

const VENDEDOR = '56911110000';
const CLIENTE = '56987654321';

function makeRes() { return { sendStatus() { return this; } }; }

function makeDeps(from, msgId, quoteEvents, pdfResults) {
  const _kv = new Map();
  return {
    conv: new Map(), seen: new Set(), locks: new Map(),
    leerEstado: async (k) => _kv.get(k) ?? null,
    escribirEstado: (k, v) => _kv.set(k, v),
    parseInbound: () => ({ ok: true, from, text: 'cotiza una corredera 1200x1000 blanca', msgId, type: 'text' }),
    parseLandingRef: () => ({ hasRef: false }),
    sendWhatsAppText: async () => ({ ok: true }),
    generatePdf: async () => Buffer.from('%PDF-1.4 fake'),
    uploadWaDocument: async () => 'media-test',
    sendWaDocument: async () => ({ ok: true, msgId: 'sent-test' }),
    upsertZohoDeal: async () => null,
    loadSession: async () => null,
    persistSession: () => {},
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({ ok: true }),
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async (p) => { quoteEvents.push(p); return { ok: true }; },
    },
    handleTurn: async ({ userText, state, toolCtx }) => {
      const result = await toolCtx.generarPdf({
        name: 'Juan Pérez', comuna: 'Temuco',
        items: [{ producto_label: 'Corredera SLIDING H80', measures: '1200x1000', color: 'blanco', qty: 1, unit_price: 324573 }],
      });
      pdfResults.push(result);
      return {
        reply: result?.message || 'ok',
        history: [{ role: 'user', content: userText }],
        toolCalls: [{ name: 'generar_pdf_cotizacion', result }],
        state: { ...state },
      };
    },
  };
}

async function correr(deps) {
  const orig = { fetch: global.fetch, url: process.env.SALES_OS_URL, tok: process.env.SALES_OS_OPERATOR_TOKEN };
  process.env.SALES_OS_URL = 'https://sales-os.test';
  process.env.SALES_OS_OPERATOR_TOKEN = 'test-operator-token';
  global.fetch = async (url) => {
    if (String(url).includes('/internal/quotes/next-number')) {
      return { ok: true, json: async () => ({ quote_number: 'CM-FR-004-2026-0777' }) };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  };
  try { await handleWebhook({ body: {} }, makeRes(), deps); }
  finally {
    global.fetch = orig.fetch;
    if (orig.url === undefined) delete process.env.SALES_OS_URL; else process.env.SALES_OS_URL = orig.url;
    if (orig.tok === undefined) delete process.env.SALES_OS_OPERATOR_TOKEN; else process.env.SALES_OS_OPERATOR_TOKEN = orig.tok;
  }
}

function prepararVendedor() {
  _reiniciarParaTests();
  resetAtribucion();
  aplicarLista({ internos_ult9: ['911110000'], vendedores: [{ ult9: '911110000', oliver_interno: true }] });
}

test('decisión dueño 30-sep: vendedor interno con CLIENTE fijado → la cotización va con el teléfono del cliente', async () => {
  prepararVendedor();
  fijar(VENDEDOR, CLIENTE, 'Juan Pérez');
  const ev = []; const pdf = [];
  try { await correr(makeDeps(VENDEDOR, 'wamid.VEND.ATRIB', ev, pdf)); }
  finally { _reiniciarParaTests(); resetAtribucion(); }

  const sent = ev.find((e) => e.status === 'sent');
  assert.ok(sent, `debe emitirse la propuesta (resultado: ${JSON.stringify(pdf[0])})`);
  assert.equal(sent.phone, CLIENTE);
  assert.equal(sent.lead.phone, CLIENTE);
  assert.equal(sent.lead.external_id, CLIENTE);
  assert.equal(sent.cotizado_por, '911110000');
  assert.equal(sent.lead.no_pisar, true, 'H1: si el cliente ya es lead, sales-os no lo pisa');
  assert.equal(sent.lead.source, 'vendedor_equipo');
  assert.equal(sent.gclid, null, 'sin click-ids de quien escribe');
  assert.equal(sent.quote_number, 'CM-FR-004-2026-0777', 'folio ISO normal');
  assert.ok(!JSON.stringify(sent).includes(VENDEDOR), 'el número completo del vendedor no viaja');
  for (const e of ev) {
    if (e.lead) assert.equal(e.lead.external_id, CLIENTE, `evento ${e.status}: external_id del cliente`);
  }
});

test('decisión dueño 30-sep: vendedor interno SIN CLIENTE no emite propuesta a su nombre', async () => {
  prepararVendedor();
  const ev = []; const pdf = []; const leads = [];
  const deps = makeDeps(VENDEDOR, 'wamid.VEND.SIN', ev, pdf);
  deps.bridge.pushLeadEvent = async (p) => { leads.push(p); return { ok: true }; };
  const turnoOriginal = deps.handleTurn;
  deps.handleTurn = async (args) => { await args.toolCtx.saveLead({ name: 'Vendedor' }); return turnoOriginal(args); };
  try { await correr(deps); }
  finally { _reiniciarParaTests(); resetAtribucion(); }

  // [M2 · Thermos 30-sep] ni lead ni borrador a nombre del vendedor
  assert.equal(leads.filter((l) => l.phone === VENDEDOR).length, 0, 'saveLead no guarda al vendedor como lead');
  assert.equal(ev.filter((e) => e.phone === VENDEDOR).length, 0, 'ningún quote-event a su número');
  assert.equal(pdf[0]?.reason, 'interno_sin_cliente');
  assert.match(pdf[0]?.message || '', /CLIENTE Nombre/);
  assert.equal(ev.find((e) => e.status === 'sent'), undefined, 'no se quema folio a nombre del vendedor');
});

test('decisión dueño 30-sep: sin atribución (cliente normal) el payload queda igual que antes', async () => {
  _reiniciarParaTests(); resetAtribucion();
  const FROM = '56933334444';
  const ev = []; const pdf = [];
  await correr(makeDeps(FROM, 'wamid.NORMAL', ev, pdf));

  const sent = ev.find((e) => e.status === 'sent');
  assert.ok(sent, `debe emitirse (resultado: ${JSON.stringify(pdf[0])})`);
  assert.equal(sent.phone, FROM);
  assert.equal(sent.lead.phone, FROM);
  assert.equal(sent.lead.external_id, FROM);
  assert.equal('cotizado_por' in sent, false);
  assert.equal('cotizado_por' in sent.lead, false);
  assert.equal('cotizado_por' in sent.payload, false);
  assert.equal('no_pisar' in sent.lead, false, 'un cliente normal sigue actualizando su lead como siempre');
  assert.equal(sent.lead.source, 'oliver_gpt');
});
