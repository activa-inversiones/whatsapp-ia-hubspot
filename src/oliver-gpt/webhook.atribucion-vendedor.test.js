// GUARDIAS DE UNA DECISIÓN DEL DUEÑO (30-sep-2026): la cotización que hace un vendedor de
// /equipo (modo interno) con el comando CLIENTE cuenta al CLIENTE, no al vendedor.
// Diseño elegido por el dueño el 30-sep: «Cliente explícito» — Oliver NO adivina de qué cliente
// es un mensaje: sin CLIENTE fijado, el vendedor no cotiza; tras el PDF, la atribución se consume.
// Si esto se pone rojo, alguien está deshaciendo esa decisión — no es un test para "arreglar".
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleWebhook } from './webhook.js';
import { conLockDeTelefono } from '../../services/lockTelefono.js'; // el MISMO lock que usa index.js
import { fijar, obtener, _resetAtribuciones } from '../../services/atribucionStore.js';
import { _resetConsentimiento } from '../../services/consentimiento.js';
const resetAtribucion = () => { _resetAtribuciones(); _resetConsentimiento(); };
import { aplicarLista, _reiniciarParaTests } from '../../services/internosEquipo.js';

const VENDEDOR = '56911110000';
const CLIENTE = '56987654321';

function makeRes() { return { sendStatus() { return this; } }; }

function makeDeps(from, msgId, quoteEvents, pdfResults, extra = {}) {
  const _kv = new Map();
  const conversaciones = extra.conversaciones || [];
  const textos = extra.textos || [];
  return {
    conv: new Map(), seen: new Set(), locks: new Map(),
    // Carpetas aisladas por test: sin esto viven en el estado del módulo y un test le hereda a otro
    // la carpeta de Juan (con su folio), y la "propuesta nueva" sale como corrección -B.
    carpetas: kvCarpetas(),
    leerEstado: async (k) => _kv.get(k) ?? null,
    escribirEstado: (k, v) => _kv.set(k, v),
    parseInbound: () => ({ ok: true, from, text: 'cotiza una corredera 1200x1000 blanca', msgId, type: 'text' }),
    parseLandingRef: () => ({ hasRef: false }),
    sendWhatsAppText: async (to, t) => { textos.push({ to, t }); return { ok: true }; },
    generatePdf: async () => Buffer.from('%PDF-1.4 fake'),
    uploadWaDocument: async () => 'media-test',
    sendWaDocument: async () => ({ ok: true, msgId: 'sent-test' }),
    upsertZohoDeal: async () => null,
    loadSession: async () => null,
    persistSession: () => {},
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async (p) => { conversaciones.push(p); return { ok: true }; },
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async (p) => { quoteEvents.push(p); return { ok: true }; },
    },
    handleTurn: async ({ userText, state, toolCtx }) => {
      const result = await toolCtx.generarPdf({
        name: 'Juan Pérez', comuna: 'Temuco',
        // Medida distinta por test: el dedup de folio (2 min, por par vendedor+cliente) vive en el
        // módulo, y dos tests con la MISMA cotización se devolverían el folio uno al otro.
        items: [{ producto_label: 'Corredera SLIDING H80', measures: extra.medida || '1200x1000', color: 'blanco', qty: 1, unit_price: 324573 }],
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

async function correr(deps, mediaStore = []) {
  const orig = { fetch: global.fetch, url: process.env.SALES_OS_URL, tok: process.env.SALES_OS_OPERATOR_TOKEN };
  process.env.SALES_OS_URL = 'https://sales-os.test';
  process.env.SALES_OS_OPERATOR_TOKEN = 'test-operator-token';
  global.fetch = async (url, init) => {
    if (String(url).includes('/internal/quotes/next-number')) {
      return { ok: true, json: async () => ({ quote_number: 'CM-FR-004-2026-0777' }) };
    }
    if (String(url).includes('/api/v5/media/store')) mediaStore.push(JSON.parse(init.body));
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
  aplicarLista({ internos_ult9: ['911110000'], vendedores: [{ ult9: '911110000', telefono: VENDEDOR, oliver_interno: true }] });
}

const HACE_31_MIN = () => Date.now() - 31 * 60 * 1000;

test('Thermos r4 (30-sep): lista del equipo con >30 min — la atribución ya fijada SIGUE valiendo (la antigüedad solo frena fijar)', async () => {
  _reiniciarParaTests(); resetAtribucion();
  aplicarLista({ internos_ult9: ['911110000'], vendedores: [{ ult9: '911110000', telefono: VENDEDOR, oliver_interno: true }] }, HACE_31_MIN());
  fijar(VENDEDOR, CLIENTE, 'Juan Pérez');
  const ev = []; const pdf = [];
  try { await correr(makeDeps(VENDEDOR, 'wamid.VEND.VIEJA', ev, pdf, { medida: '1500x1000' })); }
  finally { _reiniciarParaTests(); resetAtribucion(); }
  const sent = ev.find((e) => e.status === 'sent');
  assert.ok(sent, `debe emitirse (resultado: ${JSON.stringify(pdf[0])})`);
  assert.equal(sent.phone, CLIENTE, 'la cotización sigue a Juan, no al vendedor');
});

test('Tridente r3 #3 (30-sep): lista con >30 min y vendedor SIN cliente → se corta y se dice la CAUSA (no pedir CLIENTE en bucle)', async () => {
  _reiniciarParaTests(); resetAtribucion();
  aplicarLista({ internos_ult9: ['911110000'], vendedores: [{ ult9: '911110000', telefono: VENDEDOR, oliver_interno: true }] }, HACE_31_MIN());
  const ev = []; const pdf = []; const textos = [];
  const deps = makeDeps(VENDEDOR, 'wamid.VEND.VIEJA.SIN', ev, pdf, { textos });
  let llego = false;
  deps.handleTurn = async () => { llego = true; return { reply: 'x', history: [], toolCalls: [], state: {} }; };
  try { await correr(deps); }
  finally { _reiniciarParaTests(); resetAtribucion(); }
  assert.equal(llego, false, 'no cotiza a su propio número');
  // Su CLIENTE no sería aceptado (lista vieja): pedirle el comando lo deja en bucle.
  assert.ok(textos.some((x) => /lista del equipo está desactualizada/.test(x.t)), `textos: ${JSON.stringify(textos.map((x) => x.t))}`);
  assert.ok(!textos.some((x) => /CLIENTE Nombre Apellido/.test(x.t)), 'no le pide un comando que va a ser rechazado');
});

test('Tridente r3 #3 (30-sep): en modo interno (ult9) sin número completo confirmado → se corta y se dice que no está habilitado', async () => {
  _reiniciarParaTests(); resetAtribucion();
  aplicarLista({ internos_ult9: ['911110000'], vendedores: [{ ult9: '911110000', oliver_interno: true }] }); // sin `telefono`
  const ev = []; const pdf = []; const textos = [];
  const deps = makeDeps(VENDEDOR, 'wamid.VEND.SINROL', ev, pdf, { textos });
  let llego = false;
  deps.handleTurn = async () => { llego = true; return { reply: 'x', history: [], toolCalls: [], state: {} }; };
  try { await correr(deps); }
  finally { _reiniciarParaTests(); resetAtribucion(); }
  assert.equal(llego, false);
  assert.ok(textos.some((x) => /no está habilitado como vendedor en \/equipo/.test(x.t)), `textos: ${JSON.stringify(textos.map((x) => x.t))}`);
  assert.ok(!textos.some((x) => /CLIENTE Nombre Apellido/.test(x.t)), 'no le pide un comando que va a ser rechazado');
});

test('Tridente r4 #1 (30-sep): CLIENTE Pedro que entra a mitad de un turno de Juan ESPERA al turno (mismo lock) y el turno sigue siendo de Juan', async () => {
  prepararVendedor();
  fijar(VENDEDOR, CLIENTE, 'Juan Pérez');
  const ev = []; const pdf = [];
  const deps = makeDeps(VENDEDOR, 'wamid.VEND.LOCK', ev, pdf, { medida: '1700x1000' });
  let soltar; const pausa = new Promise((r) => { soltar = r; });
  let enTurno; const entro = new Promise((r) => { enTurno = r; });
  const turnoOriginal = deps.handleTurn;
  const orden = [];
  deps.handleTurn = async (args) => {
    enTurno(); await pausa;
    const r = await turnoOriginal(args);
    orden.push('fin-turno-juan');          // dentro del turno (con el lock tomado)
    return r;
  };
  try {
    const turno = correr(deps);
    await entro;
    const comando = conLockDeTelefono(VENDEDOR, async () => { orden.push('cliente-pedro'); fijar(VENDEDOR, '56912345678', 'Pedro'); }, deps.locks);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(orden, [], 'el comando NO corre mientras el turno de Juan tiene el lock');
    soltar();
    await turno; await comando;
  } finally { _reiniciarParaTests(); resetAtribucion(); }
  assert.deepEqual(orden, ['fin-turno-juan', 'cliente-pedro']);
  assert.equal(ev.find((e) => e.status === 'sent')?.phone, CLIENTE, 'la propuesta del turno es de Juan');
});

test('Tridente r4 #2 (30-sep): si el turno FALLA después de cambiar de carpeta, la sesión en caché NO queda mezclada', async () => {
  prepararVendedor();
  fijar(VENDEDOR, '56912345678', 'Pedro');
  const ev = []; const pdf = [];
  const deps = makeDeps(VENDEDOR, 'wamid.VEND.FALLA', ev, pdf);
  const historialJuan = [{ role: 'user', content: 'Juan: 3 ventanas' }];
  deps.conv.set(VENDEDOR, { history: historialJuan, state: { carpeta_activa: CLIENTE, name: 'Juan' } });
  deps.handleTurn = async () => { throw new Error('el cerebro se cayó'); };
  try { await correr(deps); }
  finally { _reiniciarParaTests(); resetAtribucion(); }
  const enCache = deps.conv.get(VENDEDOR);
  assert.deepEqual(enCache.history, [{ role: 'user', content: 'Juan: 3 ventanas' }], 'el historial de Juan sigue intacto en la caché');
  assert.equal(enCache.state.carpeta_activa, CLIENTE, 'y su carpeta también');
});

test('Tridente r4 #3 (30-sep): antes de consumir la atribución, el folio del cliente queda guardado DURABLE en su carpeta', async () => {
  prepararVendedor();
  fijar(VENDEDOR, CLIENTE, 'Juan Pérez');
  const ev = []; const pdf = []; const escrituras = [];
  const deps = makeDeps(VENDEDOR, 'wamid.VEND.DURABLE', ev, pdf, { medida: '1800x1000' });
  deps.carpetas = {
    leer: async () => ({ ok: true, valor: null }),
    escribir: async (k, v) => { escrituras.push({ k, v, atribucionAlEscribir: obtener(VENDEDOR) }); return { ok: true }; },
  };
  try { await correr(deps); }
  finally { _reiniciarParaTests(); resetAtribucion(); }
  const sent = ev.find((e) => e.status === 'sent');
  assert.ok(sent);
  const deJuan = escrituras.find((e) => e.k === `sesion_cliente:${VENDEDOR}:${CLIENTE}`);
  assert.ok(deJuan, `se guardó la carpeta de Juan (escrituras: ${JSON.stringify(escrituras.map((e) => e.k))})`);
  assert.equal(deJuan.v.state.last_quote?.quote_number, sent.quote_number, 'con SU folio');
  assert.ok(deJuan.atribucionAlEscribir, 'y ANTES de consumir la atribución');
});

// ── Thermos sobre el CONJUNTO (30-sep), bugs 1, 2, 4 y 5 ───────────────────────────────────
function kvCarpetas(inicial = {}) {
  const m = new Map(Object.entries(inicial));
  return {
    m,
    leer: async (k) => ({ ok: true, valor: m.has(k) ? structuredClone(m.get(k)) : null }),
    escribir: async (k, v) => { m.set(k, structuredClone(v)); return { ok: true }; },
  };
}

test('Thermos conjunto #1: re-fijar al MISMO cliente tras un redeploy recupera SU folio de la carpeta (no pide uno nuevo)', async () => {
  prepararVendedor();
  const FOLIO = 'CM-FR-004-2026-0501';
  const kv = kvCarpetas({ [`sesion_cliente:${VENDEDOR}:${CLIENTE}`]: {
    state: { last_quote: { quote_number: FOLIO, at: Date.now(), pdf_sent: true, sig: 'x', quote_base: FOLIO } }, history: [],
  } });
  const ev = []; const pdf = [];
  const deps = makeDeps(VENDEDOR, 'wamid.VEND.REFIJA', ev, pdf, { medida: '1900x1000' });
  deps.carpetas = kv;
  // La sesión recargada tras el redeploy: dice que Juan está activo, pero vino SIN el folio.
  deps.loadSession = async () => ({ history: [{ role: 'user', content: 'x' }], state: { carpeta_activa: CLIENTE, carpeta_gen: -1 } });
  fijar(VENDEDOR, CLIENTE, 'Juan Pérez');
  try { await correr(deps); }
  finally { _reiniciarParaTests(); resetAtribucion(); }
  const sent = ev.find((e) => e.status === 'sent');
  assert.ok(sent, `debe emitirse (resultado: ${JSON.stringify(pdf[0])})`);
  assert.equal(sent.quote_number.replace(/-[A-Z]$/, ''), FOLIO, 'la corrección conserva el folio de Juan (con o sin letra)');
});

test('Thermos conjunto #2: una sesión VACÍA no pisa una carpeta propia con trabajo', async () => {
  prepararVendedor();
  const clavePropia = `sesion_cliente:${VENDEDOR}:propia`;
  const kv = kvCarpetas({ [clavePropia]: { state: { pending_quote: { items: [{ product: 'x' }] } }, history: [{ role: 'user', content: 'lo mío' }] } });
  const ev = []; const pdf = [];
  const deps = makeDeps(VENDEDOR, 'wamid.VEND.VACIA', ev, pdf, { medida: '1910x1000' });
  deps.carpetas = kv;
  deps.loadSession = async () => null; // la sesión llegó vacía (redeploy)
  fijar(VENDEDOR, CLIENTE, 'Juan Pérez');
  try { await correr(deps); }
  finally { _reiniciarParaTests(); resetAtribucion(); }
  assert.deepEqual(kv.m.get(clavePropia).history, [{ role: 'user', content: 'lo mío' }], 'la carpeta propia sigue con su trabajo');
});

test('Thermos conjunto #4: el dueño con la carpeta de un cliente activa y SIN atribución (redeploy) recibe cómo retomarla', async () => {
  _reiniciarParaTests(); resetAtribucion();
  const DUENO = '56957296035';
  const ev = []; const pdf = []; const textos = [];
  const deps = makeDeps(DUENO, 'wamid.DUENO.REDEPLOY', ev, pdf, { textos });
  deps.carpetas = kvCarpetas();
  deps.loadSession = async () => ({ history: [{ role: 'user', content: 'para Juan' }], state: { carpeta_activa: CLIENTE, carpeta_nombre: 'Juan Pérez', name: 'Juan Pérez' } });
  deps.handleTurn = async ({ state }) => ({ reply: 'ok', history: [], toolCalls: [], state: { ...state } });
  try { await correr(deps); }
  finally { _reiniciarParaTests(); resetAtribucion(); }
  assert.ok(textos.some((x) => x.to === DUENO && /quedó guardada.*CLIENTE Juan Pérez \+56987654321/s.test(x.t)),
    `textos: ${JSON.stringify(textos.map((x) => x.t))}`);
});

test('Thermos conjunto #5: si en un turno salen DOS propuestas, el mensaje "Propuesta de…" sale UNA vez', async () => {
  prepararVendedor();
  fijar(VENDEDOR, CLIENTE, 'Juan Pérez');
  const ev = []; const pdf = []; const textos = [];
  const deps = makeDeps(VENDEDOR, 'wamid.VEND.DOS', ev, pdf, { textos });
  deps.handleTurn = async ({ state, toolCtx }) => {
    for (const medida of ['1920x1000', '1930x1000']) {
      pdf.push(await toolCtx.generarPdf({ name: 'Juan Pérez', comuna: 'Temuco',
        items: [{ producto_label: 'Corredera SLIDING H80', measures: medida, color: 'blanco', qty: 1, unit_price: 324573 }] }));
    }
    return { reply: 'ok', history: [], toolCalls: [], state: { ...state } };
  };
  try { await correr(deps); }
  finally { _reiniciarParaTests(); resetAtribucion(); }
  const avisos = textos.filter((x) => /Propuesta de \*Juan Pérez\* emitida/.test(x.t));
  assert.equal(avisos.length, 1, `avisos: ${avisos.length}`);
});

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
  assert.equal(sent.lead.no_pisar, true, 'si el cliente ya es lead, sales-os no lo pisa');
  assert.equal(sent.lead.source, 'vendedor_equipo');
  assert.equal(sent.gclid, null, 'sin click-ids de quien escribe');
  assert.equal(sent.quote_number, 'CM-FR-004-2026-0777', 'folio ISO normal');
  assert.ok(!JSON.stringify(sent).includes(VENDEDOR), 'el número completo del vendedor no viaja');
  for (const e of ev) {
    if (e.lead) assert.equal(e.lead.external_id, CLIENTE, `evento ${e.status}: external_id del cliente`);
  }
});

// ── Ronda de cierre r10 (01-oct): L2, L3, L4 ────────────────────────────────────────────────
const textoDe = (deps, texto) => {
  const orig = deps.parseInbound;
  deps.parseInbound = (...a) => ({ ...orig(...a), text: texto });
  return deps;
};

test('L2 r10: RESET con cliente fijado vacía TAMBIÉN la carpeta de ese cliente', async () => {
  prepararVendedor();
  const claveJuan = `sesion_cliente:${VENDEDOR}:${CLIENTE}`;
  const kv = kvCarpetas({ [claveJuan]: { state: { pending_quote: { items: [{ product: 'x' }] } }, history: [{ role: 'user', content: 'de Juan' }] } });
  const ev = []; const pdf = []; const textos = [];
  const deps = textoDe(makeDeps(VENDEDOR, 'wamid.VEND.RESET.JUAN', ev, pdf, { textos }), 'reset');
  deps.carpetas = kv;
  fijar(VENDEDOR, CLIENTE, 'Juan Pérez');
  try { await correr(deps); }
  finally { _reiniciarParaTests(); resetAtribucion(); }
  assert.ok(textos.some((x) => /partimos de cero/.test(x.t)), `textos: ${JSON.stringify(textos.map((x) => x.t))}`);
  assert.deepEqual(kv.m.get(claveJuan), { state: {}, history: [] }, 'la carpeta de Juan quedó vacía (no se restaura después)');
});

test('L3 r10: un vendedor SIN cliente fijado puede usar RESET (no lo corta el pedido de CLIENTE)', async () => {
  prepararVendedor();
  const ev = []; const pdf = []; const textos = [];
  const deps = textoDe(makeDeps(VENDEDOR, 'wamid.VEND.RESET.SIN', ev, pdf, { textos }), 'reset');
  try { await correr(deps); }
  finally { _reiniciarParaTests(); resetAtribucion(); }
  assert.ok(textos.some((x) => /partimos de cero/.test(x.t)), `textos: ${JSON.stringify(textos.map((x) => x.t))}`);
});

test('L4 r10: tras emitir, la carpeta del cliente queda con el turno COMPLETO (no la foto de mitad de generarPdf)', async () => {
  prepararVendedor();
  const kv = kvCarpetas();
  const ev = []; const pdf = [];
  const deps = makeDeps(VENDEDOR, 'wamid.VEND.CIERRE', ev, pdf, { medida: '1950x1000' });
  deps.carpetas = kv;
  fijar(VENDEDOR, CLIENTE, 'Juan Pérez');
  try { await correr(deps); }
  finally { _reiniciarParaTests(); resetAtribucion(); }
  const deJuan = kv.m.get(`sesion_cliente:${VENDEDOR}:${CLIENTE}`);
  assert.ok(deJuan, 'hay carpeta de Juan');
  assert.ok(deJuan.history.some((h) => h.role === 'user' && /corredera/.test(h.content)),
    `el historial del turno quedó en la carpeta: ${JSON.stringify(deJuan.history)}`);
  assert.ok(deJuan.state.last_quote?.quote_number, 'con su folio');
});

test('calidad 1 r10: index.js y webhook.js usan la MISMA instancia de lock (services/lockTelefono.js)', async () => {
  const fs = await import('node:fs');
  const idx = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  const wh = fs.readFileSync(new URL('./webhook.js', import.meta.url), 'utf8');
  assert.match(idx, /import \{ conLockDeTelefono, acquireLock \} from "\.\/services\/lockTelefono\.js"/);
  assert.doesNotMatch(idx, /const locks = new Map\(\)/, 'index.js no tiene locks propios');
  assert.doesNotMatch(idx, /function acquireLock\(/, 'ni su propio acquireLock');
  assert.match(wh, /const locks\s+= deps\.locks\s+\|\| LOCKS;/, 'webhook usa LOCKS de lockTelefono por defecto');
  assert.match(wh, /import \{ acquireLock, LOCKS \} from '\.\.\/\.\.\/services\/lockTelefono\.js'/);
});

test('«Cliente explícito» 30-sep: tras el PDF la atribución se CONSUME y se dice cómo corregir', async () => {
  prepararVendedor();
  fijar(VENDEDOR, CLIENTE, 'Juan Pérez');
  const ev = []; const pdf = []; const textos = [];
  let despues = 'sin-medir';
  try { await correr(makeDeps(VENDEDOR, 'wamid.VEND.CONSUME', ev, pdf, { textos, medida: '1300x1000' })); despues = obtener(VENDEDOR); }
  finally { _reiniciarParaTests(); resetAtribucion(); }
  assert.ok(ev.find((e) => e.status === 'sent'), 'se emitió');
  assert.equal(despues, null, 'tras el PDF no queda ningún cliente fijado');
  assert.ok(textos.some((x) => x.to === VENDEDOR
    && /Propuesta de \*Juan Pérez\* emitida\. Para corregirla manda CLIENTE Juan Pérez \+56987654321/.test(x.t)),
    `el vendedor recibe cómo corregir (textos: ${JSON.stringify(textos.map((x) => x.t))})`);
});

test('«Cliente explícito» 30-sep: vendedor SIN CLIENTE → Oliver pide el cliente y NO cotiza (no llega al LLM)', async () => {
  prepararVendedor();
  const ev = []; const pdf = []; const textos = [];
  const deps = makeDeps(VENDEDOR, 'wamid.VEND.SIN', ev, pdf, { textos });
  let llegoAlCerebro = false;
  deps.handleTurn = async () => { llegoAlCerebro = true; return { reply: 'x', history: [], toolCalls: [], state: {} }; };
  try { await correr(deps); }
  finally { _reiniciarParaTests(); resetAtribucion(); }

  assert.equal(llegoAlCerebro, false, 'no toma medidas ni cotiza');
  assert.ok(textos.some((x) => x.to === VENDEDOR && /CLIENTE Nombre Apellido \+569XXXXXXXX/.test(x.t)),
    `se le pide el comando (textos: ${JSON.stringify(textos.map((x) => x.t))})`);
  assert.equal(ev.length, 0, 'ningún quote-event');
});

test('7 · decisión 30-sep: bajo atribución los documentos van a la ficha del CLIENTE (media/store y espejo del PDF)', async () => {
  prepararVendedor();
  fijar(VENDEDOR, CLIENTE, 'Juan Pérez');
  const ev = []; const pdf = []; const conversaciones = []; const media = [];
  try { await correr(makeDeps(VENDEDOR, 'wamid.VEND.DOCS', ev, pdf, { conversaciones, medida: '1400x1000' }), media); }
  finally { _reiniciarParaTests(); resetAtribucion(); }
  const prop = media.find((m) => /Propuesta/.test(m.ai_description || ''));
  assert.ok(prop, 'se guardó el PDF');
  assert.equal(prop.phone, CLIENTE, 'el PDF queda en la ficha del cliente');
  const espejo = conversaciones.find((c) => c.metadata?.source === 'oliver_gpt_pdf');
  assert.ok(espejo, 'hay espejo del PDF');
  assert.equal(espejo.external_id, CLIENTE);
});

test('decisión dueño 30-sep: sin atribución (cliente normal) el payload y los documentos quedan igual que antes', async () => {
  _reiniciarParaTests(); resetAtribucion();
  const FROM = '56933334444';
  const ev = []; const pdf = []; const conversaciones = []; const media = [];
  await correr(makeDeps(FROM, 'wamid.NORMAL', ev, pdf, { conversaciones }), media);

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
  assert.equal(media.find((m) => /Propuesta/.test(m.ai_description || ''))?.phone, FROM);
  assert.equal(conversaciones.find((c) => c.metadata?.source === 'oliver_gpt_pdf')?.external_id, FROM);
});
