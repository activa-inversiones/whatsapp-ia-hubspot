// [2026-10-16 · #1524] «LIBERAR → SOLO LOS INFORMES»: el webhook manda el térmico y/o el de clima y viento SIN propuesta.
//
// Pedido del dueño (14-oct), textual: «solo decir propuesta, informe térmico, informe clima y viento, los 3 por separado y
// listo». Caso que lo originó: la 0646 salió sin informes porque el cliente ya los tenía de la 0644, y no había forma de
// mandárselos sin emitir otra propuesta. Lo que defiende este archivo (la DECISIÓN, no la implementación):
//   · con `emisionInterna.soloInformes` NO se emite propuesta: ni PDF de cotización, ni folio CM-FR-004, ni LLM;
//   · sale SOLO lo marcado (térmico / vientos / los dos), con su correlativo ISO de siempre (CM-FR-006 / CM-FR-007);
//   · la marca de entrega (docs_entregado) queda SOLO si Meta aceptó el envío: un envío caído no se marca entregado;
//   · si el cliente ya lo tenía, se manda IGUAL (lo pidió una persona a mano), salvo el enfriamiento de 30 min del térmico.
// Hermético: `fetch` global falso (correlativos y registro de sales-os), KV en memoria, PDFs y THERMAL falsos.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SALES_OS_URL = 'http://sos.test';
process.env.SALES_OS_OPERATOR_TOKEN = 'tok-test';
process.env.ACTIVA_ENGINE_URL = 'http://motor.test'; // nada puede salir a un motor real aunque algo se escape
const { handleWebhook, huellaDelInforme, ventanasDelInformeTermico } = await import('./webhook.js');
const { claveEntrega } = await import('../../services/documentosCotizacion.js');

const MARCA = '⟦emisión interna desde la agenda⟧';
// Los ítems tal como los arma `itemsDesdeLineasBot` desde el borrador (con el Uw que devolvió el motor al retener).
const ITEMS = [
  { product: 'Ventana PVC S60 corredera', producto_label: 'Ventana PVC S60 corredera', measures: '2000x1400mm', measures_original: '2000x1400mm',
    glass_label: '5+12+5', qty: 1, unit_price: 130000, color: 'Nogal', pos: 3, termico: { uw: 2.7 } },
  { product: 'Ventana PVC H98 corredera 3 hojas', producto_label: 'Ventana PVC H98 corredera 3 hojas', measures: '3250x1460mm', measures_original: '3250x1460mm',
    glass_label: '5+12+5', qty: 1, unit_price: 130000, color: 'Nogal', pos: 7, termico: { uw: 2.7 } },
];

// fetch falso para TODO el archivo (correlativos y registro ISO de sales-os). Nada sale a la red.
let actual = { fetches: [] };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const body = (() => { try { return JSON.parse(opts.body || '{}'); } catch { return {}; } })();
  actual.fetches.push({ u, body });
  if (u.endsWith('/internal/informes/next-number')) {
    const n = body.tipo === 'vientos' ? 'CM-FR-007-2026-0042' : 'CM-FR-006-2026-0321';
    return { ok: true, status: 200, json: async () => ({ ok: true, informe_number: n }) };
  }
  if (u.endsWith('/internal/informes/registrar')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
  return { ok: false, status: 503, text: async () => '{}', json: async () => ({}) };
};
async function esperar(cond, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await new Promise((r) => { setTimeout(r, 10); }); }
  return cond();
}

let SEQ = 0;
const makeRes = () => ({ sendStatus() { return this; }, status: () => ({ json: () => {} }), json: () => {} });

function armar({ envioInforme = () => ({ ok: true, msgId: `doc.${Math.random()}` }), candados = {} } = {}) {
  const telefono = `5698152${String(++SEQ).padStart(4, '0')}`;
  const spy = { docs: [], textos: [], eventos: [], fetches: [], propuestas: 0, turnosLLM: 0, quotes: [] };
  const estado = new Map();
  let tok = 0;
  const vigente = (e) => e && (!e.expira || e.expira > Date.now());
  const poner = (k, v, ttl = 300) => { estado.set(k, { valor: v, expira: Date.now() + ttl * 1000 }); };
  for (const [k, v] of Object.entries(candados)) poner(k.replace('{tel}', telefono.slice(-9)), v, 30 * 24 * 3600);
  actual = spy; // el fetch falso de arriba anota en el arnés de ESTE test
  const deps = {
    conv: new Map(), seen: new Set(), locks: new Map(),
    dormir: async () => {},
    seqTermicoMs: 0,
    leerEstado: async (k) => (vigente(estado.get(k)) ? estado.get(k).valor : null),
    escribirEstado: poner,
    escribirEstadoDurable: async (k, v, ttl) => { poner(k, v, ttl); return { ok: true }; },
    reservarEstado: (k, ttl = 300) => { if (vigente(estado.get(k))) return null; const t = `t${++tok}`; poner(k, t, ttl); return t; },
    liberarReserva: (k, t) => { const e = estado.get(k); if (!t || !vigente(e) || e.valor !== t) return false; estado.delete(k); return true; },
    parseInbound: () => ({ ok: true, from: telefono, type: 'text', text: MARCA, msgId: `interno-${Math.random()}`, enviadoAt: Date.now() }),
    sendWhatsAppText: async (_to, t) => { spy.textos.push(String(t)); return { ok: true, msgId: `m${spy.textos.length}` }; },
    pedirInformeComuna: async () => ({ comuna: 'Angol', regimen: 'PDA', uw_max_Wm2K: 3.2, zona_termica_NCh1079: 'E', criterio_ref: 'PDA' }),
    generarInformeTermicoPdf: async () => Buffer.alloc(1024, 7),
    laminasParaInforme: async () => null,
    laminaTermopanel: async () => null,
    pedirVientos: async ({ ventanas: vs }) => ({
      ventanas: vs.map((v) => ({ nombre: v.nombre, ancho_mm: v.ancho_mm, alto_mm: v.alto_mm, cantidad: v.cantidad,
        capacidad: { lr_corta_kPa: 1.89 }, veredicto: { evaluable: true, cumple_corta: true } })),
      demanda: { presion_kPa: 0.675 },
    }),
    generarInformeVientosPdf: async () => Buffer.alloc(512, 9),
    generatePdf: async () => { spy.propuestas += 1; return Buffer.alloc(2048, 3); },
    uploadWaDocument: async () => 'media.1',
    sendWaDocument: async (to, mediaId, filename, caption) => {
      const tipo = /^Informe-Vientos/.test(filename || '') ? 'vientos' : (/^Informe-Termico/.test(filename || '') ? 'termico' : 'propuesta');
      spy.docs.push({ to, tipo, filename, caption });
      return tipo === 'propuesta' ? { ok: true, msgId: 'prop.1' } : envioInforme(tipo);
    },
    saveMedia: async () => ({ ok: true }),
    upsertZohoDeal: async () => 'deal.1',
    addZohoNote: async () => ({ ok: true }),
    attachPdfToDeal: async () => ({ ok: true }),
    loadSession: async () => ({ history: [{ role: 'user', content: 'hola' }], state: { name: 'Claudio', comuna: 'Angol' } }),
    persistSession: () => {},
    handleTurn: async () => { spy.turnosLLM += 1; return { reply: 'NO DEBERÍA LLAMARSE', history: [], toolCalls: [], state: {} }; },
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async (p) => { spy.eventos.push(p); return { ok: true }; },
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async (p) => { spy.quotes.push(p); return { ok: true }; },
    },
  };
  // El registro ISO de vientos es fire-and-forget (safe sin await): el fetch falso queda puesto todo el archivo para que
  // ninguna llamada tardía salga a la red real.
  const restaurar = () => {};
  return { deps, spy, telefono, estado, vigente, restaurar };
}

async function correr(h, soloInformes) {
  let resolver;
  const resultado = new Promise((r) => { resolver = r; });
  h.deps.emisionInterna = { items: ITEMS, nombre: 'Claudio Pérez', comuna: 'Angol', operador: 'Mary', soloInformes,
    deadline: Date.now() + 60000, onResultado: (r) => resolver(r) };
  await handleWebhook({ body: {} }, makeRes(), h.deps);
  return Promise.race([resultado, new Promise((res) => { setTimeout(() => res({ timeout: true }), 8000); })]);
}

const marcado = (h, tipo) => Boolean(h.vigente(h.estado.get(claveEntrega(h.telefono, tipo))));
const sinPropuesta = (h) => {
  assert.equal(h.spy.turnosLLM, 0, 'el LLM no interviene');
  assert.equal(h.spy.propuestas, 0, 'NO se arma el PDF de la propuesta');
  assert.equal(h.spy.docs.filter((d) => d.tipo === 'propuesta').length, 0, 'NO sale ninguna propuesta');
  assert.ok(!h.spy.fetches.some((f) => /\/internal\/quotes\/next-number/.test(f.u)), 'NO se quema un folio de cotización (CM-FR-004)');
  assert.equal(h.spy.quotes.length, 0, 'NO se registra ninguna cotización en sales-os');
};

test('[#1524] SOLO TÉRMICO: sale el informe térmico con su correlativo CM-FR-006, sin propuesta, y queda la marca de entrega', async () => {
  const h = armar();
  try {
    const r = await correr(h, { termico: true, vientos: false });
    assert.ok(!r.timeout, 'onResultado tiene que llamarse');
    assert.deepEqual({ ok: r.ok, solo: r.solo_informes, informes: r.informes }, { ok: true, solo: true, informes: { termico: 'enviado', vientos: null } });
    sinPropuesta(h);
    assert.deepEqual(h.spy.docs.map((d) => d.tipo), ['termico']);
    assert.equal(h.spy.docs[0].to, h.telefono, 'al cliente');
    assert.match(h.spy.docs[0].filename, /CM-FR-006-2026-0321/, 'el correlativo ISO del térmico va en el documento');
    assert.ok(await esperar(() => h.spy.fetches.some((f) => f.u.endsWith('/internal/informes/registrar') && f.body.informe_number === 'CM-FR-006-2026-0321')), 'registro ISO de la entrega');
    assert.equal(marcado(h, 'termico'), true, 'marca de entrega del térmico');
    assert.equal(marcado(h, 'vientos'), false, 'vientos no se pidió: no se marca');
    const ev = h.spy.eventos.find((e) => e.metadata && e.metadata.source === 'oliver_interno_informes');
    assert.ok(ev, 'queda en la ficha quién lo pidió');
    assert.equal(ev.actor_name, 'Mary');
    assert.match(ev.body, /informe térmico enviado desde la agenda por Mary \(sin propuesta\)/);
  } finally { h.restaurar(); }
});

test('[#1524] SOLO VIENTOS: sale el informe de clima y viento con CM-FR-007, sin térmico ni propuesta', async () => {
  const h = armar();
  try {
    const r = await correr(h, { termico: false, vientos: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.informes, { termico: null, vientos: 'enviado' });
    sinPropuesta(h);
    assert.deepEqual(h.spy.docs.map((d) => d.tipo), ['vientos']);
    assert.match(h.spy.docs[0].filename, /^Informe-Vientos-Angol/, 'de la comuna del borrador');
    assert.match(h.spy.docs[0].filename, /CM-FR-007-2026-0042/, 'correlativo ISO de vientos');
    assert.ok(await esperar(() => h.spy.fetches.some((f) => f.u.endsWith('/internal/informes/registrar') && f.body.tipo === 'vientos' && f.body.quote_number === null)),
      'registro ISO, sin amarrarlo a una cotización que no existe');
    assert.equal(marcado(h, 'vientos'), true);
    assert.equal(marcado(h, 'termico'), false);
  } finally { h.restaurar(); }
});

test('[#1524] LOS DOS: térmico y después clima y viento (el orden de la propuesta), los dos marcados', async () => {
  const h = armar();
  try {
    const r = await correr(h, { termico: true, vientos: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.informes, { termico: 'enviado', vientos: 'enviado' });
    sinPropuesta(h);
    assert.deepEqual(h.spy.docs.map((d) => d.tipo), ['termico', 'vientos']);
    assert.equal(marcado(h, 'termico'), true);
    assert.equal(marcado(h, 'vientos'), true);
  } finally { h.restaurar(); }
});

test('[#1524] META RECHAZA el informe: ok:false con el motivo y NO queda marcado como entregado', async () => {
  const h = armar({ envioInforme: () => ({ ok: false, status: 400, error: 'rechazado', code: 131000 }) });
  try {
    const r = await correr(h, { termico: true, vientos: true });
    assert.equal(r.ok, false);
    assert.notEqual(r.informes.termico, 'enviado');
    assert.notEqual(r.informes.vientos, 'enviado');
    assert.equal(marcado(h, 'termico'), false, 'un envío que no salió no se marca entregado (si no, el próximo no lo manda)');
    assert.equal(marcado(h, 'vientos'), false);
    await new Promise((r) => { setTimeout(r, 50); }); // lo fire-and-forget alcanza a correr si fuera a correr
    assert.ok(!h.spy.fetches.some((f) => f.u.endsWith('/internal/informes/registrar')), 'sin registro ISO de una entrega que no hubo');
    sinPropuesta(h);
  } finally { h.restaurar(); }
});

test('[#1524] el cliente YA TENÍA los dos (candados de 30 días vigentes, de hace 2 h): se mandan IGUAL, porque se pidieron a mano', async () => {
  const huella = huellaDelInforme({ comuna: 'Angol', producto: ITEMS[1].producto_label, glassLabel: '5+12+5', ventanas: ITEMS });
  const huellaT = huellaDelInforme({ comuna: 'Angol', producto: ITEMS[1].producto_label, glassLabel: '5+12+5', ventanas: ventanasDelInformeTermico(ITEMS) });
  const hace2h = { at: Date.now() - 2 * 3600e3 };
  const h = armar();
  try {
    // Las claves reales del candado del cliente (claves.informeTermico/informeVientos de turnoDeterminista) + sus marcas.
    const { resolverTurno } = await import('../../services/identidadCotizacion.js');
    const { claves } = resolverTurno(h.telefono, Date.now());
    h.deps.escribirEstado(claves.informeTermico(huellaT), hace2h, 30 * 24 * 3600);
    h.deps.escribirEstado(claves.informeVientos(huella), hace2h, 30 * 24 * 3600);
    h.deps.escribirEstado(claveEntrega(h.telefono, 'termico'), hace2h, 30 * 24 * 3600);
    h.deps.escribirEstado(claveEntrega(h.telefono, 'vientos'), hace2h, 30 * 24 * 3600);
    const r = await correr(h, { termico: true, vientos: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(h.spy.docs.map((d) => d.tipo), ['termico', 'vientos'], 'se mandan aunque el cliente ya los tuviera');
  } finally { h.restaurar(); }
});

test('[#1524] el térmico que salió hace MINUTOS no se duplica (enfriamiento de 30 min, decisión del 16-sep): se informa «ya_enviado»', async () => {
  const h = armar();
  try {
    const { resolverTurno } = await import('../../services/identidadCotizacion.js');
    const { claves } = resolverTurno(h.telefono, Date.now());
    const huellaT = huellaDelInforme({ comuna: 'Angol', producto: ITEMS[1].producto_label, glassLabel: '5+12+5', ventanas: ventanasDelInformeTermico(ITEMS) });
    h.deps.escribirEstado(claves.informeTermico(huellaT), { at: Date.now() - 5 * 60e3 }, 30 * 24 * 3600);
    const r = await correr(h, { termico: true, vientos: false });
    assert.equal(r.ok, false, 'no se dice «salió» cuando no salió');
    assert.equal(r.informes.termico, 'ya_enviado');
    assert.equal(h.spy.docs.length, 0);
  } finally { h.restaurar(); }
});

test('[#1524] las ventanas del informe térmico salen de UNA función: el número que puso el cliente (pos) y el Uw del motor viajan', () => {
  const v = ventanasDelInformeTermico(ITEMS);
  assert.deepEqual(v.map((x) => [x.pos, x.medidas, x.vidrio, x.uw]), [[3, '2000x1400mm', '5+12+5', 2.7], [7, '3250x1460mm', '5+12+5', 2.7]]);
  assert.deepEqual(ventanasDelInformeTermico(null), []);
});
