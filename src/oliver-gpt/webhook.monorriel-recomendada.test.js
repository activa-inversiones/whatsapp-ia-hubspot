// 🔴 GUARDIA DE UNA DECISION DEL DUEÑO (2026-10-08). Textual: *"se entregan 2 cotizaciones una con el
// original del cliente y una otra con las correderas doble riel"* + *"el corte para la C va a 2100 de
// alto"* + *"C, unión a confirmar en visita técnica"*. El monorriel que se pasa de alto sale en la
// propuesta ORIGINAL y ademas en una 2a, que arma el SERVIDOR: corredera doble riel de 2100 + paño
// fijo arriba, con los precios del motor (el LLM no copia precios), que NO "reemplaza" a la primera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook } from './webhook.js';

const CLIENTE = '56987650022';
// El motor de mentira cobra DISTINTO cada configuracion: si la revision de precio del PDF re-rutea la
// pieza a monorriel (riesgo H1 de Thermos), el precio cambia y el test lo ve.
const precioMotor = (b) => (b.riel === 'MONORRIEL' ? 700000 : b.tipo === 'CORREDERA' ? 877759 : 108224);
const V1 = { product: 'Corredera ANDES 66 Monorriel', producto_label: 'Corredera ANDES 66 Monorriel', measures: '2540x2370',
  ancho_mm: 2540, alto_mm: 2370, color: 'nogal', qty: 3, unit_price: 700000, referencial: true, revision_ingenieria: true };
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
      const q = Number(b.cantidad) || 1; const data = { ok: true, unit_price: precioMotor(b), grand_total: precioMotor(b) * q, total_clp: precioMotor(b) * q, producto_label: b.riel === 'MONORRIEL' ? 'Corredera ANDES 66 Monorriel' : b.tipo === 'CORREDERA' ? 'Corredera SLIDING H98 Doble Riel S75' : 'Fijo S60', materiales: { subtotal: 1 } };
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

function deps(textos, pdfs, quotes = []) {
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
      pushConversationEvent: async () => ({ ok: true }), pushLeadEvent: async () => ({ ok: true }), pushQuoteEvent: async (q) => { quotes.push(q); return { ok: true }; } },
    handleTurn: async () => { throw new Error('lo entrega el codigo, no el LLM'); },
  };
}

test('🔴 el cliente recibe DOS propuestas: la original (monorriel) y la recomendada (doble riel + fijo), con precios del motor', async () => {
  const textos = []; const pdfs = []; const quotes = [];
  await correr(deps(textos, pdfs, quotes));
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
  // 💰 UNA sola conversion por cliente: la recomendada se registra 'alternativa' (no dispara fireConversion).
  const estados = quotes.map((q) => `${q.quote_number}:${q.status}`);
  assert.equal(quotes.filter((q) => q.status === 'sent').length, 1, `eventos: ${estados}`);
  assert.ok(quotes.some((q) => q.status === 'alternativa' && q.quote_number === rec.numero), `eventos: ${estados}`);
});

test('🔒 sin monorriel alto NO hay 2a propuesta', async () => {
  const textos = []; const pdfs = []; const quotes = [];
  const d = deps(textos, pdfs, quotes);
  d.loadSession = async () => ({
    history: [{ role: 'user', content: 'fijo 2100x1200' }, { role: 'assistant', content: '¿Le preparo la propuesta en PDF?' }],
    state: { comuna: 'Villarrica', name: 'Cliente', default_color: 'nogal', pending_quote: { items: [FIJO], grand_total: 108224 } },
  });
  await correr(d);
  assert.equal(pdfs.length, 1);
});

test('🔴 camino del LLM (mismo turno): tambien salen DOS, una sola conversion', async () => {
  const textos = []; const pdfs = []; const quotes = [];
  const d = deps(textos, pdfs, quotes);
  d.loadSession = async () => null;
  d.parseInbound = () => ({ ok: true, from: CLIENTE, text: 'V1 3 2540x2370 una fija y una corredera, nogal', msgId: 'wamid.REC.LLM', type: 'text' });
  d.handleTurn = async ({ userText, state, toolCtx }) => {
    const r = await toolCtx.generarPdf({ name: 'Cliente', comuna: 'Villarrica', items: [{ ...V1, measures: '2540x2370' }] });
    return { reply: 'listo', history: [{ role: 'user', content: userText }],
      toolCalls: [{ name: 'generar_pdf_cotizacion', result: r }], state: { ...state } };
  };
  await correr(d);
  assert.equal(pdfs.length, 2, `PDFs: ${pdfs.map((p) => p.numero)}`);
  assert.equal(quotes.filter((q) => q.status === 'sent').length, 1);
  assert.match(textos.filter((x) => x.to === CLIENTE).map((x) => x.t).join('\n'), /recomienda nuestra área de ingeniería/);
});

test('🔒 un reenvio IDENTICO inmediato no repite la recomendada (lo frena el dedup de 2 min; la revision posterior y la reemision por nombre las frena la guardia !esRevision && !_esReemisionNombre, sin test propio)', async () => {
  const textos = []; const pdfs = []; const quotes = [];
  const d = deps(textos, pdfs, quotes);
  d.loadSession = async () => null;
  d.parseInbound = () => ({ ok: true, from: CLIENTE, text: 'V1 3 2540x2370 una fija y una corredera, nogal', msgId: 'wamid.REC.REENVIO', type: 'text' });
  d.handleTurn = async ({ userText, state, toolCtx }) => {
    const it = { ...V1, measures: '2543x2370', ancho_mm: 2543 };
    const r1 = await toolCtx.generarPdf({ name: 'Cliente', comuna: 'Villarrica', items: [it] });
    // MISMO contenido = reenvio (revision, mismo folio). Uno con contenido DISTINTO es otra propuesta
    // (letra nueva) y ahi SI corresponde su propia recomendada.
    const r2 = await toolCtx.generarPdf({ name: 'Cliente', comuna: 'Villarrica', items: [{ ...it }] });
    return { reply: 'listo', history: [{ role: 'user', content: userText }],
      toolCalls: [{ name: 'generar_pdf_cotizacion', result: r2 || r1 }], state: { ...state } };
  };
  await correr(d);
  const recs = pdfs.filter((p) => p.data.items.some((x) => /Doble Riel/.test(x.producto_label || x.product || '')));
  assert.equal(recs.length, 1, `PDFs: ${pdfs.map((p) => p.numero)}`);
});

test('🔒 la REEMISION por el nombre no repite la recomendada (guardia !_esReemisionNombre, Thermos r2)', async () => {
  const textos = []; const pdfs = []; const quotes = [];
  const d = deps(textos, pdfs, quotes);
  d.loadSession = async () => ({ history: [{ role: 'user', content: 'me llamo Juan Perez' }],
    state: { comuna: 'Villarrica', name: 'Juan Perez', default_color: 'nogal',
      nombre_pendiente: { quote_number: 'CM-FR-004-2026-0700', at: Date.now(), items: [V1] } } });
  d.parseInbound = () => ({ ok: true, from: CLIENTE, text: 'me llamo Juan Perez', msgId: 'wamid.REC.NOMBRE', type: 'text' });
  d.handleTurn = async ({ userText, state, toolCtx }) => {
    const r = await toolCtx.generarPdf({ name: 'Juan Perez', comuna: 'Villarrica', reemision_nombre: true,
      items: [{ ...V1, measures: '2544x2370', ancho_mm: 2544 }] });
    return { reply: 'listo', history: [{ role: 'user', content: userText }],
      toolCalls: [{ name: 'generar_pdf_cotizacion', result: r }], state: { ...state } };
  };
  await correr(d);
  assert.ok(pdfs.length >= 1, 'la original se reemite');
  assert.equal(pdfs.filter((p) => p.data.items.some((x) => /Doble Riel/.test(x.producto_label || ''))).length, 0,
    `PDFs: ${pdfs.map((p) => p.numero)}`);
});

test('🔴 el PDF recomendado lleva la nota de la union IMPRESA y no repite el numero de ventana (Codex)', async () => {
  const textos = []; const pdfs = [];
  const d = deps(textos, pdfs);
  d.loadSession = async () => ({
    history: [{ role: 'user', content: 'V14 3 2545 2370 una fija y una corredera' }, { role: 'assistant', content: '¿Le preparo la propuesta en PDF?' }],
    state: { comuna: 'Villarrica', name: 'Cliente', default_color: 'nogal',
      pending_quote: { items: [{ ...V1, measures: '2545x2370', ancho_mm: 2545, pos: 14 }, { ...FIJO, pos: 17 }], grand_total: 1 } },
  });
  await correr(d);
  const rec = pdfs[1];
  assert.ok(rec, `PDFs: ${pdfs.map((p) => p.numero)}`);
  assert.match(rec.data.nota_variante || '', /visita t[eé]cnica/);
  assert.deepEqual(rec.data.items.map((x) => x.pos), [14, undefined, 17], 'la corredera conserva V14; el fijo no repite');
  assert.equal(pdfs[0].data.nota_variante, undefined, 'la original no lleva la nota');
});
