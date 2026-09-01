// channel-agent.paridad-abc-rut.test.js — [2026-08-31]
//
// LO QUE EL CLIENTE DE INSTAGRAM RECIBIA PEOR QUE EL DE WHATSAPP.
//
// IG/FB y WhatsApp tienen caminos SEPARADOS (channel-agent.js vs webhook.js) y a IG/FB le
// faltaba media caneria. Son ~1% del trafico (2 conversaciones de 200), asi que no es urgente,
// pero el que escribe por Instagram recibia un documento peor. Los cuatro huecos que cierra
// esta red, en orden de gravedad:
//
//   1. 🔴 EL RUT NO VIAJABA. El cliente dictaba "a nombre de Maya Mapu SpA, RUT 77.448.504-K"
//      y el PDF salia a nombre del contacto generico del chat — sin RUT, sin razon social, y
//      sin nada de eso en el Deal de Zoho ni en `quotes.payload`.
//   2. 🔴 LA SONDA DE PRECIO DE LAS OPCIONES B/C IBA INCOMPLETA: sin `orientacion`, sin
//      `partes` y con las medidas crudas ⇒ una ventana COMPUESTA vertical se re-cotizaba como
//      un pano suelto, o el motor no la cotizaba y la opcion se descartaba por un error que
//      no era del color.
//   3. 🟠 LA OPCION A NO SE RECOTIZABA PARA SU COLOR: reusaba el precio del turno anterior,
//      calculado con el color por DEFECTO. Con A = New Black (el mas caro) el PDF salia
//      rotulado "New Black" CON EL PRECIO DEL BLANCO.
//   4. 🟠💰 SE LE REPORTABA A META/GOOGLE EL MONTO DE LA MAS CARA, por un cliente que recibio
//      tres y no eligio ninguna. En WhatsApp se reporta el mas bajo de las entregadas.
//
// Hermetico: deps inyectadas + `global.fetch` solo para el correlativo ISO. Cero red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleChannelTurn } from './channel-agent.js';

// Precio por color, DISTINTO en cada uno — como en la lista real (medido en el motor sobre el
// marco doble riel S70: Blanco $30.385 · Nogal $49.974 · New Black $54.356). Sin precios
// distintos, ninguno de los defectos 3 y 4 seria observable.
const PRECIO = { Blanco: 300000, Nogal: 430000, 'New Black': 465000 };

let _seq = 0;

/**
 * @param {object} opts
 * @param {string} [opts.colorSinPrecio]  el motor se cae SOLO para ese color
 * @param {object} [opts.item]            item que le pasa el LLM a la tool
 * @param {Array<{text:string, cotiza?:boolean, llm?:object}>} opts.turnos
 */
function armar(opts = {}) {
  const spy = { pdfs: [], documentos: [], quoteEvents: [], deals: [], sondas: [], textos: [] };
  const senderId = `IG_paridad_${++_seq}`;
  const conv = new Map();

  const deps = {
    conv, seen: new Set(), locks: new Map(),
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({}),
      pushLeadEvent: async () => ({}),
      pushQuoteEvent: async (p) => { spy.quoteEvents.push(p); return {}; },
    },
    notifyHighValue: async () => ({ sent: true }),
    sendWhatsAppText: async () => ({ ok: true }),
    generatePdf: async (data, numero) => {
      spy.pdfs.push({
        numero, opcion: data.opcion || null, receptor: data.receptor || null,
        color: data.items?.[0]?.color || null, unit_price: data.items?.[0]?.unit_price || 0,
        measures: data.items?.[0]?.measures || '',
      });
      return Buffer.from(`%PDF-1.4 ${numero}`);
    },
    sendChannelDocument: async (_canal, _to, _buf, filename) => {
      spy.documentos.push(String(filename).replace(/\.pdf$/, ''));
      return { ok: true, messageId: `mid-${spy.documentos.length}` };
    },
    // El motor de precios, FALSO pero fiel: cada color a un precio distinto, y guardando la
    // sonda COMPLETA que recibio — es lo unico que permite ver si viajo la orientacion.
    priceAllEngine: async (d) => {
      spy.sondas.push(JSON.parse(JSON.stringify(d)));
      for (const it of d.items || []) {
        if (opts.colorSinPrecio && it.color === opts.colorSinPrecio) {
          throw new Error(`motor sin precio para ${it.color}`);
        }
        const p = PRECIO[it.color];
        if (!p) { it.confidence = 'manual'; continue; }
        it.unit_price = p; it.total_price = p * (Number(it.qty) || 1);
        it.source = 'activa_engine'; it.confidence = 'high';
        it.producto_label = it.product; it.glass_label = '4+12+4';
      }
      return { ok: true, total: 0, source: 'activa_engine', escalate: false };
    },
    upsertZohoDeal: async (d) => { spy.deals.push(d); return 'deal1'; },
    addZohoNote: async () => ({ ok: true }),
    attachPdfToDeal: async () => true,
    loadSession: async () => null,
    persistSession: () => {},
  };

  return { deps, spy, senderId };
}

/** Corre los turnos de una conversacion IG con el mismo cache (la sesion no se pierde). */
async function correr(opts = {}) {
  const { deps, spy, senderId } = armar(opts);
  const item = opts.item || {
    producto_label: 'Corredera SLIDING H80', product: 'Corredera SLIDING H80',
    measures: '1500x1200', color: 'Blanco', qty: 1, unit_price: PRECIO.Blanco,
    glass_label: '4+12+4',
  };
  // El historial lo devuelve el cerebro; sin el, `textoDelCliente` no ve los turnos previos.
  const historial = [];

  const fetchPrevio = global.fetch;
  const envPrevio = { url: process.env.SALES_OS_URL, tok: process.env.SALES_OS_OPERATOR_TOKEN };
  process.env.SALES_OS_URL = 'https://sales-os.test';
  process.env.SALES_OS_OPERATOR_TOKEN = 'test-token';
  global.fetch = async (url) => (String(url).includes('/internal/quotes/next-number')
    ? { ok: true, json: async () => ({ quote_number: 'CM-FR-004-2026-0392' }) }
    : { ok: false, json: async () => ({}) });

  try {
    for (const turno of (opts.turnos || [])) {
      deps.handleTurn = async ({ userText, state, toolCtx }) => {
        historial.push({ role: 'user', content: userText });
        if (!turno.cotiza) {
          const t = 'Perfecto, lo anoto.';
          historial.push({ role: 'assistant', content: t });
          return { reply: t, history: [...historial], state: { ...state }, toolCalls: [] };
        }
        // 🔴 EL LLM HACE LO QUE HACE EL DE VERDAD: rellena 'Blanco' porque el system-prompt se
        // lo ordena, aunque el cliente NO lo dijo. Ese es el caso de produccion.
        const r = await toolCtx.generarPdf({
          name: 'Vanessa', comuna: 'Temuco', items: [{ ...item }], ...(turno.llm || {}),
        });
        historial.push({ role: 'assistant', content: r.message || '' });
        return {
          reply: r.message, history: [...historial], state: { ...state },
          toolCalls: [{ name: 'generar_pdf_cotizacion', result: r }],
        };
      };
      await handleChannelTurn({
        channel: 'instagram', senderId, text: turno.text, msgId: `mid.${Math.random()}`,
        sendFn: async (_to, t) => { spy.textos.push(String(t || '')); return { ok: true }; },
      }, deps);
    }
  } finally {
    global.fetch = fetchPrevio;
    for (const [k, v] of [['SALES_OS_URL', envPrevio.url], ['SALES_OS_OPERATOR_TOKEN', envPrevio.tok]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
  return spy;
}

/* =========================================================================
 * 1) EL RUT VIAJA — al PDF, al Deal de Zoho y a `quotes.payload`
 * ========================================================================= */

test('🔴 IG: el RUT y la razon social que dicta el cliente llegan al PDF, a Zoho y a la BD', async () => {
  const spy = await correr({
    // Dice el color a proposito: sin terna que explicar, lo unico que se observa es el RUT.
    item: { producto_label: 'Corredera SLIDING H80', product: 'Corredera SLIDING H80',
      measures: '1500x1200', color: 'Nogal', qty: 1, unit_price: PRECIO.Nogal, glass_label: '4+12+4' },
    turnos: [{ cotiza: true, text: 'cotizame una corredera nogal de 1500x1200, a nombre de Maya Mapu SpA, RUT 77.448.504-K' }],
  });

  const pdf = spy.pdfs[0];
  assert.ok(pdf, 'no se emitio el PDF');
  assert.ok(pdf.receptor, 'el PDF salio SIN receptor: es el defecto que se esta cerrando');
  assert.equal(pdf.receptor.rut, '77.448.504-K');
  assert.equal(pdf.receptor.razonSocial, 'Maya Mapu SpA');
  assert.equal(pdf.receptor.clienteTipo, 'empresa');

  // Marcelo abre el Deal para facturar y lo tiene ahi, sin ir a buscar el PDF.
  assert.equal(spy.deals[0]?.receptor?.rut, '77.448.504-K');
  // Y la propuesta se puede reconstruir desde la BD si manana hay una disputa por la factura.
  const sent = spy.quoteEvents.find((e) => e.status === 'sent');
  assert.equal(sent?.receptor?.rut, '77.448.504-K');
  assert.equal(sent?.receptor?.razonSocial, 'Maya Mapu SpA');
});

test('⛔ IG: un RUT que el cliente NUNCA escribio no entra al documento (compuerta de procedencia)', async () => {
  // El modulo 11 dice si un RUT esta BIEN ESCRITO, no si alguien lo dijo: 1 de cada 11
  // numeros al azar lo pasa. Sin `textoCliente` la compuerta queda escrita pero muerta.
  const spy = await correr({
    item: { producto_label: 'Corredera SLIDING H80', product: 'Corredera SLIDING H80',
      measures: '1500x1200', color: 'Nogal', qty: 1, unit_price: PRECIO.Nogal, glass_label: '4+12+4' },
    turnos: [{ cotiza: true, text: 'hola, cotizame una corredera nogal de 1500x1200',
      llm: { rut: '77.448.504-K', razon_social: 'Constructora Los Andes SpA', cliente_tipo: 'empresa' } }],
  });
  assert.equal(spy.pdfs[0].receptor, null,
    'el documento salio con un RUT y una razon social que el cliente nunca escribio');
  // El campo TIENE que existir (aunque venga en null): si no esta, es que el receptor no
  // esta cableado y este test estaria pasando por la razon equivocada.
  const sent = spy.quoteEvents.find((e) => e.status === 'sent');
  assert.ok(sent && 'receptor' in sent, 'el evento de cotizacion no lleva el campo receptor');
  assert.equal(sent.receptor, null);
});

test('⛔ IG: un RUT verdadero NO le lava la procedencia a una razon social inventada', async () => {
  // Procedencia POR CAMPO (`origenCampos`): el cliente dicta su RUT, el LLM agrega una razon
  // social que nadie escribio. El RUT entra; la razon social no.
  const spy = await correr({
    item: { producto_label: 'Corredera SLIDING H80', product: 'Corredera SLIDING H80',
      measures: '1500x1200', color: 'Nogal', qty: 1, unit_price: PRECIO.Nogal, glass_label: '4+12+4' },
    turnos: [{ cotiza: true, text: 'corredera nogal 1500x1200, mi rut es 77.448.504-K',
      llm: { razon_social: 'Inmobiliaria Fantasma SpA' } }],
  });
  const r = spy.pdfs[0].receptor;
  assert.ok(r, 'el RUT verdadero si tiene que llegar');
  assert.equal(r.rut, '77.448.504-K');
  assert.equal(r.razonSocial, '', 'la razon social inventada entro al documento formal');
});

test('🔴 IG: la compuerta mira TODA la conversacion, no solo el ultimo mensaje', async () => {
  // El cliente escribe la razon social en un mensaje y el RUT en el siguiente. Si la
  // compuerta comparara solo contra el turno actual, la razon social se caeria por
  // "inventada" — que es justo el caso que justifica el parametro `razon_social` del LLM.
  const spy = await correr({
    item: { producto_label: 'Corredera SLIDING H80', product: 'Corredera SLIDING H80',
      measures: '1500x1200', color: 'Nogal', qty: 1, unit_price: PRECIO.Nogal, glass_label: '4+12+4' },
    turnos: [
      { text: 'hola, la factura va a nombre de Maya Mapu SpA' },
      { cotiza: true, text: 'listo, mi rut es 77.448.504-K, cotizame la corredera nogal de 1500x1200',
        llm: { razon_social: 'Maya Mapu SpA' } },
    ],
  });
  const r = spy.pdfs[0].receptor;
  assert.ok(r, 'no llego receptor al documento');
  assert.equal(r.rut, '77.448.504-K');
  assert.equal(r.razonSocial, 'Maya Mapu SpA',
    'la razon social que el cliente escribio un mensaje antes se perdio');
});

/* =========================================================================
 * 2) LA SONDA DE PRECIO VA COMPLETA
 * ========================================================================= */

test('🔴 IG: la sonda que recotiza los colores lleva orientacion, partes y medidas resueltas', async () => {
  // Sin esto una COMPUESTA vertical se re-cotiza como un pano suelto horizontal: el precio
  // que sale en el documento es el de otra ventana.
  const spy = await correr({
    item: {
      producto_label: 'Compuesta 2 panos', product: 'Compuesta 2 panos',
      measures: '1500x1200mm', color: 'Blanco', qty: 1, unit_price: PRECIO.Blanco,
      glass_label: '4+12+4',
      compuesta: { orientacion: 'vertical', partes: [{ tipo: 'fijo' }, { tipo: 'corredera' }] },
    },
    turnos: [{ cotiza: true, text: 'quiero cotizar una ventana compuesta de 1500x1200' }],
  });

  assert.ok(spy.sondas.length >= 2, `se esperaban varias sondas, hubo ${spy.sondas.length}`);
  for (const s of spy.sondas) {
    const it = s.items[0];
    assert.equal(it.orientacion, 'vertical', 'la sonda perdio la orientacion de la compuesta');
    assert.equal(Array.isArray(it.partes) && it.partes.length, 2, 'la sonda perdio las partes');
    // Medidas RESUELTAS: el motor recibe el string exacto, no una heuristica re-parseada.
    assert.equal(it.measures, '1500x1200mm', `medidas crudas en la sonda: ${it.measures}`);
    assert.ok(String(s.texto_cliente || '').includes('compuesta'),
      'la sonda no lleva el texto del cliente');
  }
});

/* =========================================================================
 * 3) LA OPCION A SE COTIZA PARA SU COLOR
 * ========================================================================= */

test('🔴 IG: A = New Black, B = Nogal, C = Blanco, cada una con SU precio del motor', async () => {
  const spy = await correr({ turnos: [{ cotiza: true, text: 'quiero cotizar una corredera de 1500x1200' }] });

  assert.deepEqual(spy.documentos, [
    'CM-FR-004-2026-0392', 'CM-FR-004-2026-0392-B', 'CM-FR-004-2026-0392-C',
  ], `documentos entregados: ${spy.documentos.join(', ')}`);

  const porNumero = Object.fromEntries(spy.pdfs.map((p) => [p.numero, p]));
  for (const [numero, letra, color] of [
    ['CM-FR-004-2026-0392', 'A', 'New Black'],
    ['CM-FR-004-2026-0392-B', 'B', 'Nogal'],
    ['CM-FR-004-2026-0392-C', 'C', 'Blanco'],
  ]) {
    const p = porNumero[numero];
    assert.ok(p, `no se genero el PDF ${numero}`);
    assert.equal(p.color, color, `${numero} tiene que ser ${color}`);
    // ⛔ Un documento formal no puede llevar la etiqueta de un color y el precio de otro.
    assert.equal(p.unit_price, PRECIO[color], `${numero} lleva el precio de otro color`);
    assert.equal(p.opcion?.letra, letra);
    assert.equal(p.opcion?.color, color);
  }
});

test('🔴 IG: si el motor no cotiza el color de la A, la A NO sale con el precio de otro', async () => {
  // Es el caso que encontro Copilot en el tridente: el `try/catch` dejaba pasar el precio que
  // ya venia y el PDF salia rotulado "New Black" con el precio del Blanco.
  const spy = await correr({
    colorSinPrecio: 'New Black',
    turnos: [{ cotiza: true, text: 'quiero cotizar una corredera de 1500x1200' }],
  });
  const a = spy.pdfs.find((p) => p.numero === 'CM-FR-004-2026-0392');
  assert.ok(a, 'la propuesta principal tiene que salir igual: nunca se frena al cliente');
  assert.notEqual(a.color, 'New Black', 'el color que el motor no supo cotizar NO puede salir');
  for (const p of spy.pdfs) {
    assert.equal(p.unit_price, PRECIO[p.color], `${p.numero}: etiqueta ${p.color} con precio de otro`);
  }
  // Y no se le promete al cliente un color que no se pudo cotizar.
  assert.doesNotMatch(spy.textos.join('\n'), /New Black/);
});

/* =========================================================================
 * 4) 💰 QUE MONTO SE LE REPORTA A META Y GOOGLE
 * ========================================================================= */

test('🔴💰 IG: se reporta el monto MAS BAJO de las entregadas, y una sola conversion', async () => {
  const spy = await correr({ turnos: [{ cotiza: true, text: 'quiero cotizar una corredera de 1500x1200' }] });

  const sent = spy.quoteEvents.filter((e) => e.status === 'sent');
  const alt = spy.quoteEvents.filter((e) => e.status === 'alternativa');
  assert.equal(sent.length, 1, `debe haber UNA sola conversion, hubo ${sent.length}`);
  assert.equal(alt.length, 2, 'las otras dos quedan registradas, sin disparar conversion');
  // 💰 Decision del dueno: el mas bajo. Reportar el mas caro por algo que nadie eligio le
  // ensena al algoritmo que ese trafico vale mas de lo que se sabe.
  assert.equal(sent[0].amount_total, PRECIO.Blanco,
    `se reporto ${sent[0].amount_total}: el cliente recibio tres y no eligio ninguna`);
  for (const e of alt) {
    assert.ok(!e.gclid && !e.fbclid && !e.ctwa_clid && !e.ttclid,
      'sin click-ids: no dispara conversion');
  }
});

test('🔒 IG: si el cliente SI dijo el color, sale UNA sola y se reporta su monto — como siempre', async () => {
  const spy = await correr({
    item: { producto_label: 'Corredera SLIDING H80', product: 'Corredera SLIDING H80',
      measures: '1500x1200', color: 'Nogal', qty: 1, unit_price: PRECIO.Nogal, glass_label: '4+12+4' },
    turnos: [{ cotiza: true, text: 'quiero una corredera NOGAL de 1500x1200' }],
  });
  assert.equal(spy.documentos.length, 1, `una propuesta con el color correcto es mejor que tres: ${spy.documentos.join(', ')}`);
  assert.ok(!spy.pdfs[0].opcion, 'el documento sale sin rotulo de opcion, como siempre');
  const sent = spy.quoteEvents.filter((e) => e.status === 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].amount_total, PRECIO.Nogal);
});
