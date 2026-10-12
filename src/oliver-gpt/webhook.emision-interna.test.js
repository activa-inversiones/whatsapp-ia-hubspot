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
  const registro = { tel: TEL, turnos: 0, docs: [], textos: [], eventos: [], fetches: [], guardado: null, zoho: 0, quotes: [] };
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
      pushQuoteEvent: async (p) => { registro.quotes.push(p); return { ok: true }; },
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

// [#1504 r5 · abogado del diablo de sales-os] LA PROPUESTA DEL BOT LLEVA EL ID DEL BORRADOR QUE LA PIDIÓ. sales-os marcaba
// «Sí le llegó» adivinando por teléfono + total + minutos cuál fila del bot era la de ese borrador; con dos borradores del mismo
// cliente en minutos podía atribuir el folio de A a B. Ahora `emisionInterna.borrador_id` viaja al quote-event ('sent') y
// sales-os ata por identidad.
test('[#1504 r5] el quote-event «sent» de una emisión interna lleva `borrador_id` (el id del borrador de sales-os que la pidió)', async () => {
  const { ei, resultado } = emision({ borrador_id: 'q-sales-os-1' });
  const { deps, registro, restaurar } = harness({ emisionInterna: ei });
  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
    const r = await Promise.race([resultado, new Promise((res) => { setTimeout(() => res({ timeout: true }), 8000); })]);
    assert.ok(!r.timeout && r.ok === true, JSON.stringify(r));
    const sent = registro.quotes.find((p) => p && p.status === 'sent');
    assert.ok(sent, 'se registró la propuesta en sales-os');
    assert.equal(sent.borrador_id, 'q-sales-os-1');
    assert.equal(sent.quote_number, r.quote_number);
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

test('[#1500-C r2 · Thermos M3] el texto de entrega que recibió el cliente queda ESPEJADO en la ficha (outbound ai), además del evento del operador', async () => {
  const { ei, resultado } = emision();
  const { deps, registro, restaurar } = harness({ emisionInterna: ei });
  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
    const r = await Promise.race([resultado, new Promise((res) => { setTimeout(() => res({ timeout: true }), 8000); })]);
    assert.ok(!r.timeout && r.ok === true, JSON.stringify(r));
    const textoEnviado = registro.textos.at(-1);
    assert.ok(textoEnviado, 'se le mandó el mensaje de entrega');
    const espejo = registro.eventos.find((e) => e.direction === 'outbound' && e.actor_type === 'ai' && e.body === textoEnviado);
    assert.ok(espejo, 'el mismo texto que recibió el cliente queda en su ficha como outbound de Oliver');
    assert.equal(espejo.metadata.emision_interna, true);
  } finally { restaurar(); }
});

test('[#1500-C r2 · Thermos M8] dos emisiones IDÉNTICAS al mismo cliente dentro de la ventana: la segunda contesta con el MISMO folio (no un folio nuevo ni un error mudo)', async () => {
  const { ei, resultado } = emision();
  const { deps, registro, restaurar } = harness({ emisionInterna: ei });
  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
    const r1 = await Promise.race([resultado, new Promise((res) => { setTimeout(() => res({ timeout: true }), 8000); })]);
    assert.ok(!r1.timeout && r1.ok === true, JSON.stringify(r1));
    const segunda = emision();
    const deps2 = { ...deps, emisionInterna: segunda.ei, seen: new Set() };
    await handleWebhook({ body: {} }, makeRes(), deps2);
    const r2 = await Promise.race([segunda.resultado, new Promise((res) => { setTimeout(() => res({ timeout: true }), 8000); })]);
    assert.ok(!r2.timeout, 'la segunda también contesta');
    assert.ok(r2.quote_number, `la segunda trae folio (reusado o revisión), no un vacío: ${JSON.stringify(r2)}`);
    assert.equal(r2.quote_number, r1.quote_number, 'mismos ítems en minutos = la misma propuesta (anti-duplicado del pipeline)');
    // [Thermos r3 · D-N3] Y lo dice como ÉXITO SIN ENVÍO (el cliente ya la tiene), no como «no emitida» → sales-os no reintenta.
    assert.equal(r2.ok, true, JSON.stringify(r2));
    assert.equal(r2.deduped, true);
    assert.equal(r2.pdf_sent, false);
    assert.ok(registro.docs.length >= 1);
  } finally { restaurar(); }
});

test('[#1500-C r3 · Codex D1] el límite de ritmo del chat no aplica: con el teléfono «pasado de mensajes» la emisión sale igual y el cliente no recibe el aviso de ritmo', async () => {
  const { ei, resultado } = emision();
  const { deps, registro, restaurar } = harness({ emisionInterna: ei });
  // rateMap: la estructura que lee rateOk(from, rateMap). Se llena como si el cliente hubiera mandado 50 mensajes en el minuto.
  const rateMap = new Map();
  rateMap.set(registro.tel, { n: 50, resetAt: Date.now() + 60_000 }); // la forma que lee rateOk(waId, rateMap)
  deps.rateMap = rateMap;
  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
    const r = await Promise.race([resultado, new Promise((res) => { setTimeout(() => res({ timeout: true }), 8000); })]);
    assert.ok(!r.timeout && r.ok === true, `emite aunque el ritmo esté pasado: ${JSON.stringify(r)}`);
    assert.ok(!registro.textos.some((t) => /Escribes muy r[aá]pido/i.test(t)), `ningún aviso de ritmo al cliente: ${JSON.stringify(registro.textos)}`);
  } finally { restaurar(); }
});

test('[#1500-C r3 · Codex D3] la marca sintética NO clasifica la atribución (ref_status) ni queda como «el cliente nos escribió»', async () => {
  const { ei, resultado } = emision();
  const { deps, registro, restaurar } = harness({ emisionInterna: ei });
  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
    await Promise.race([resultado, new Promise((res) => { setTimeout(res, 8000); })]);
    assert.ok(registro.guardado, 'la sesión se persiste');
    assert.equal(registro.guardado.state.ref_status, undefined, 'ref_status no se clasificó con la marca');
  } finally { restaurar(); }
});

test('[#1500-C r3 · Codex D2] si el teléfono es del EQUIPO (dueño), no se emite: cliente_es_del_equipo, sin PDF ni textos', async () => {
  const { ei, resultado } = emision();
  const { deps, registro, restaurar } = harness({ emisionInterna: ei });
  deps.parseInbound = () => ({ ok: true, from: '56957296035', type: 'text', text: MARCA, msgId: `interno-${Math.random()}`, enviadoAt: Date.now() });
  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
    const r = await Promise.race([resultado, new Promise((res) => { setTimeout(() => res({ timeout: true }), 8000); })]);
    assert.ok(!r.timeout, 'contesta');
    assert.equal(r.ok, false);
    assert.equal(r.error, 'cliente_es_del_equipo');
    assert.equal(registro.docs.length, 0);
    assert.equal(registro.textos.length, 0, 'tampoco el corte «usa CLIENTE…»');
  } finally { restaurar(); }
});

test('[#1500-C r3 · Thermos D-N1] el nombre lo puso el vendedor: el cliente NO recibe «como todavía no tengo su nombre» y no queda nombre_pendiente', async () => {
  const { ei, resultado } = emision({ nombre: 'Claudio Soto' });
  const { deps, registro, restaurar } = harness({ emisionInterna: ei });
  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
    const r = await Promise.race([resultado, new Promise((res) => { setTimeout(() => res({ timeout: true }), 8000); })]);
    assert.ok(!r.timeout && r.ok === true, JSON.stringify(r));
    assert.ok(!registro.textos.some((t) => /no tengo su nombre|no tengo tu nombre|la emit[ií] como/i.test(t)), `sin aviso de nombre asumido: ${JSON.stringify(registro.textos)}`);
    assert.equal(registro.guardado.state.nombre_pendiente, undefined);
  } finally { restaurar(); }
});

test('[#1500-C r3 · Thermos D-N2] si NO se emitió, la sesión igual se persiste (lo que generarPdf dejó en state no se pierde)', async () => {
  const { ei, resultado } = emision();
  const { deps, registro, restaurar } = harness({ emisionInterna: ei, folioOk: false });
  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
    const r = await Promise.race([resultado, new Promise((res) => { setTimeout(() => res({ timeout: true }), 8000); })]);
    assert.ok(!r.timeout && r.ok === false);
    assert.ok(registro.guardado, 'persistida también en fallo, como pdf.deterministic');
  } finally { restaurar(); }
});

test('[#1500-C r3 · Thermos E-1] con el plazo vencido antes de emitir, contesta «vencida» y no sale nada', async () => {
  const { ei, resultado } = emision({ deadline: Date.now() - 1000 });
  const { deps, registro, restaurar } = harness({ emisionInterna: ei });
  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
    const r = await Promise.race([resultado, new Promise((res) => { setTimeout(() => res({ timeout: true }), 8000); })]);
    assert.ok(!r.timeout && r.ok === false && r.error === 'vencida', JSON.stringify(r));
    assert.equal(registro.docs.length, 0);
    assert.equal(registro.textos.length, 0);
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

// [#1500-C r5 · NIM 12-oct] LA OPCIÓN DE LA TERNA YA ENTREGADA (webhook.js ~3636 + propuestas-color.js opcionYaEntregada).
// El cliente recibió por WhatsApp la terna de colores A/B/C (<48 h) y el vendedor libera desde la agenda el MISMO proyecto
// (producto + medidas + cantidad) con uno de esos colores: generarPdf no emite nada (la deja como definitiva) y devuelve
// eleccion:true con ESE folio. r4 lo rotulaba «pdf_no_entregado» y el vendedor veía un rechazo de Meta falso.
test('[#1500-C r5] terna ya entregada + color del vendedor = una de las opciones: no se emite ni se quema folio, nada al cliente, onResultado deduped+eleccion con el folio de esa opción', async () => {
  const { ei, resultado } = emision();
  const { deps, registro, restaurar } = harness({ emisionInterna: ei });
  const sigProyecto = JSON.stringify(ITEMS.map((it) => [String(it.producto_label).trim().toLowerCase(), String(it.measures).trim(), Number(it.qty) || 1]));
  const base = 'CM-FR-004-2026-0700';
  deps.loadSession = async () => ({
    history: [{ role: 'user', content: 'hola' }],
    state: { name: 'Claudio', comuna: 'Angol',
      last_quote: { quote_number: base, quote_base: base, at: Date.now() - 60_000, pdf_sent: true, sig: 'otra-firma', sig_proyecto: sigProyecto, alternativas: 2,
        opciones: [{ letra: 'A', numero: base, color: 'Blanco' }, { letra: 'B', numero: `${base}-B`, color: 'Nogal' }, { letra: 'C', numero: `${base}-C`, color: 'Roble Dorado' }] } },
  });
  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
    const r = await Promise.race([resultado, new Promise((res) => { setTimeout(() => res({ timeout: true }), 8000); })]);
    assert.ok(!r.timeout, 'onResultado tiene que llamarse');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.deduped, true, JSON.stringify(r));
    assert.equal(r.eleccion, true, JSON.stringify(r));
    assert.equal(r.quote_number, `${base}-B`, 'el folio de la opción que el cliente ya tiene (NOGAL = B)');
    assert.equal(r.pdf_sent, false);
    assert.equal(registro.docs.length, 0, 'no sale ningún PDF');
    assert.equal(registro.textos.length, 0, 'al cliente no se le manda nada: no escribió él, y ya tiene el documento');
    assert.ok(!registro.fetches.some((u) => /\/internal\/quotes\/next-number/.test(u)), 'no se quema folio');
    const traza = registro.eventos.find((e) => e.metadata && e.metadata.source === 'oliver_gpt_eleccion_opcion');
    assert.ok(traza, 'queda en la ficha qué opción quedó como definitiva');
    assert.equal(registro.guardado.state.last_quote.quote_number, `${base}-B`, 'la sesión recuerda la opción definitiva');
  } finally { restaurar(); }
});
