// 🔴 GUARDIA DE UNA DECISION DEL DUEÑO (2026-10-08). Textual: *"se entregan 2 cotizaciones una con el
// original del cliente y una otra con las correderas doble riel"* + *"el corte para la C va a 2100 de
// alto"* + *"C, unión a confirmar en visita técnica"*. El monorriel que se pasa de alto sale en la
// propuesta ORIGINAL y ademas en una 2a, que arma el SERVIDOR: corredera doble riel de 2100 + paño
// fijo arriba, con los precios del motor (el LLM no copia precios), que NO "reemplaza" a la primera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook } from './webhook.js';
import { itemsPropuestaRecomendada } from './pdf-intent.js';

const CLIENTE = '56987650022';
// El motor de mentira cobra DISTINTO cada configuracion: si la revision de precio del PDF re-rutea la
// pieza a monorriel (riesgo H1 de Thermos), el precio cambia y el test lo ve.
const precioMotor = (b) => (b.riel === 'MONORRIEL' ? 700000 : b.tipo === 'CORREDERA' ? 877759 : 108224);
const ALT = { nota: 'Unión entre la corredera y el paño fijo superior a confirmar en la visita técnica.', piezas: [
  { producto_label: 'Corredera SLIDING H98 Doble Riel S75', measures: '2540x2100', unit_price: 877759, qty: 3, color: 'nogal', glass_label: '5+12+5' },
  { producto_label: 'Fijo S60', measures: '2540x270', unit_price: 108224, qty: 3, color: 'nogal', glass_label: '4+12+4', referencial: true },
] };
const V1 = { product: 'Corredera ANDES 66 Monorriel', producto_label: 'Corredera ANDES 66 Monorriel', measures: '2540x2370',
  ancho_mm: 2540, alto_mm: 2370, color: 'nogal', qty: 3, unit_price: 700000, referencial: true, revision_ingenieria: true, alternativa_c: ALT };
const FIJO = { product: 'Fijo S60', producto_label: 'Fijo S60', measures: '2100x1200', ancho_mm: 2100, alto_mm: 1200, color: 'nogal', qty: 1, unit_price: 108224 };

async function correr(deps) {
  const orig = { fetch: global.fetch, url: process.env.SALES_OS_URL, tok: process.env.SALES_OS_OPERATOR_TOKEN };
  process.env.SALES_OS_URL = 'https://sales-os.test'; process.env.SALES_OS_OPERATOR_TOKEN = 't';
  let n = 900;
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/internal/quotes/next-number')) return { ok: true, json: async () => ({ quote_number: `CM-FR-004-2026-0${n++}` }) };
    if (u.includes('/quotes/calculate')) {
      const b = JSON.parse(init.body || '{}');
      const q = Number(b.cantidad) || 1; const data = { ok: true, unit_price: precioMotor(b), grand_total: precioMotor(b) * q, total_clp: precioMotor(b) * q, producto_label: 'x', materiales: { subtotal: 1 } };
      return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
    }
    return { ok: true, json: async () => ({ ok: true }), text: async () => '{}' };
  };
  try { await handleWebhook({ body: {} }, { sendStatus() { return this; } }, deps); }
  finally {
    global.fetch = orig.fetch;
    if (orig.url === undefined) delete process.env.SALES_OS_URL; else process.env.SALES_OS_URL = orig.url;
    if (orig.tok === undefined) delete process.env.SALES_OS_OPERATOR_TOKEN; else process.env.SALES_OS_OPERATOR_TOKEN = orig.tok;
  }
}

function deps(textos, pdfs) {
  return {
    conv: new Map(), seen: new Set(), locks: new Map(),
    leerEstado: async () => null, escribirEstado: () => {},
    parseInbound: () => ({ ok: true, from: CLIENTE, text: 'sí, mándamela', msgId: `wamid.REC.${Math.random()}`, type: 'text' }),
    parseLandingRef: () => ({ hasRef: false }),
    sendWhatsAppText: async (to, t) => { textos.push({ to, t }); return { ok: true }; },
    generatePdf: async (data, numero) => { pdfs.push({ data, numero }); return Buffer.from('%PDF-1.4 fake'); },
    uploadWaDocument: async () => 'media-test',
    sendWaDocument: async () => ({ ok: true, msgId: 'sent-test' }),
    upsertZohoDeal: async () => null,
    loadSession: async () => ({
      history: [{ role: 'user', content: 'V1 3 2540 2370 Una fija y una corredera (monorriel)' },
        { role: 'assistant', content: '¿Le preparo la propuesta en PDF?' }],
      state: { comuna: 'Villarrica', name: 'Cliente', default_color: 'nogal',
        pending_quote: { items: [V1, FIJO], grand_total: 2208224 } },
    }),
    persistSession: () => {},
    bridge: { getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({ ok: true }), pushLeadEvent: async () => ({ ok: true }), pushQuoteEvent: async () => ({ ok: true }) },
    handleTurn: async () => { throw new Error('lo entrega el codigo, no el LLM'); },
  };
}

test('itemsPropuestaRecomendada: cambia el monorriel por sus 2 piezas y deja el resto igual', () => {
  const r = itemsPropuestaRecomendada([V1, FIJO]);
  assert.deepEqual(r.items.map((x) => `${x.producto_label} ${x.measures} ${x.unit_price}x${x.qty}`), [
    'Corredera SLIDING H98 Doble Riel S75 2540x2100 877759x3', 'Fijo S60 2540x270 108224x3', 'Fijo S60 2100x1200 108224x1']);
  assert.equal(r.grand_total, 877759 * 3 + 108224 * 3 + 108224);
  assert.equal(itemsPropuestaRecomendada([FIJO]), null, 'sin monorriel alto no hay 2a propuesta');
});

test('🔴 el cliente recibe DOS propuestas: la original (monorriel) y la recomendada (doble riel + fijo), con precios del motor', async () => {
  const textos = []; const pdfs = [];
  await correr(deps(textos, pdfs));
  assert.equal(pdfs.length, 2, `PDFs emitidos: ${pdfs.map((p) => p.numero).join(', ')}`);
  const [orig, rec] = pdfs;
  const lineas = (p) => (p.data.items || p.data.lineas || []).map((x) => `${x.producto || x.producto_label} ${x.medidas || x.measures} ${x.unitario ?? x.unit_price}`);
  assert.ok(lineas(orig).some((l) => /Monorriel 2540x2370 700000/.test(l)), `original: ${lineas(orig)}`);
  assert.ok(lineas(rec).some((l) => /Doble Riel S75 2540x2100 877759/.test(l)), `recomendada: ${lineas(rec)}`);
  assert.ok(lineas(rec).some((l) => /Fijo S60 2540x270 108224/.test(l)), `recomendada: ${lineas(rec)}`);
  assert.ok(!lineas(rec).some((l) => /Monorriel/.test(l)), 'la recomendada no lleva el monorriel');
  assert.notEqual(rec.numero, orig.numero, 'cada una con su folio');
  assert.ok(!rec.data.reemplaza_a && !rec.data.reemplazaA, 'la recomendada NO reemplaza a la original');
  const aCliente = textos.filter((x) => x.to === CLIENTE).map((x) => x.t).join('\n');
  assert.match(aCliente, /recomienda nuestra área de ingeniería/);
  assert.match(aCliente, /a confirmar en la visita técnica/);
  assert.doesNotMatch(aCliente, /andes|monorriel/i);
});
