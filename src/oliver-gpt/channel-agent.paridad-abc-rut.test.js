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
import * as canalIgFb from './channel-agent.js';   // solo para SONDA_VIDRIO_TOPE_MS
import { capturarLogs } from './capturarLogs.testutil.js';
import { claveAvisoVidrio, elegirVidrio } from '../../services/vidrioCotizado.js';

// Precio por color, DISTINTO en cada uno — como en la lista real (medido en el motor sobre el
// marco doble riel S70: Blanco $30.385 · Nogal $49.974 · New Black $54.356). Sin precios
// distintos, ninguno de los defectos 3 y 4 seria observable.
const PRECIO = { Blanco: 300000, Nogal: 430000, 'New Black': 465000 };

let _seq = 0;

/** deps.{leer,escribir,reservar,liberarReserva}Estado con un Map propio; la marca queda visible en `spy.estado`. */
function almacenFalsoPorTest(spy) {
  const kv = new Map();
  spy.estado = kv;
  let tok = 0;
  const vigente = (e) => e && (!e.expira || e.expira > Date.now());
  const poner = (k, v, ttl = 300) => { kv.set(k, { valor: v, expira: Date.now() + ttl * 1000 }); return v; };
  return {
    leerEstado: async (k) => (vigente(kv.get(k)) ? kv.get(k).valor : null),
    escribirEstado: poner,
    reservarEstado: (k, ttl = 300) => { if (vigente(kv.get(k))) return null; const t = `t${++tok}`; poner(k, t, ttl); return t; },
    liberarReserva: (k, t) => { const e = kv.get(k); if (!t || !vigente(e) || e.valor !== t) return false; kv.delete(k); return true; },
  };
}

/** Espera POR CONDICIÓN (sin timers a ojo): cede el event loop hasta que `cond()` o se acaba el tope. */
async function esperar(cond, ms = 4000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return true;
    await new Promise((r) => { setImmediate(r); });
  }
  return false;
}
const vaciar = () => new Promise((r) => { setImmediate(r); });

/**
 * @param {object} opts
 * @param {string} [opts.colorSinPrecio]  el motor se cae SOLO para ese color
 * @param {'colgado'|'429'|'rechaza_tarde'} [opts.motor]  'colgado' = el motor no contesta nunca; '429' = contesta como
 *                                        `priceAllEngine` ante un 429 o un fallo: NO lanza, devuelve ok:false y deja
 *                                        `confidence:'manual'`; 'rechaza_tarde' = rechaza su promesa a los 300 ms
 * @param {number} [opts.topeSonda]       tope TOTAL de la sonda del vidrio (#1088); sin él, el de producción
 * @param {object} [opts.item]            item que le pasa el LLM a la tool
 * @param {Array<{text:string, cotiza?:boolean, llm?:object}>} opts.turnos
 */
function armar(opts = {}) {
  const spy = { pdfs: [], documentos: [], quoteEvents: [], deals: [], sondas: [], textos: [], alertas: [], eventos: [], plantillas: [] };
  const senderId = `IG_paridad_${++_seq}`;
  spy.senderId = senderId;
  const conv = new Map();

  const deps = {
    conv, seen: new Set(), locks: new Map(),
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async (p) => { spy.eventos.push(p); return {}; },
      pushLeadEvent: async () => ({}),
      pushQuoteEvent: async (p) => { spy.quoteEvents.push(p); return {}; },
    },
    // El canal de avisos al dueño (highValueNotifier): (envio, id del cliente, sesion, motivo).
    // `opts.avisoDueno`: lo que devuelve el notificador (el real NO lanza: devuelve `{sent:false,...}`).
    notifyHighValue: async (_envio, cliente, _sesion, motivo) => { spy.alertas.push({ cliente, motivo: String(motivo) }); return opts.avisoDueno || { sent: true }; },
    sendWhatsAppText: async () => ({ ok: true }),
    // [r8] La plantilla al dueño (escalation.js → /admin/send-template), con la FORMA REAL de la respuesta del
    // endpoint (index.js:5280): {ok, template, phone, result}. `opts.plantilla` es lo que devuelve; por defecto
    // sale bien y no toca ninguna red (la suite corre sin ADMIN_PIN).
    sendAvisoVidrioTemplate: async (folio, etiquetas) => {
      spy.plantillas.push({ folio, etiquetas });
      return opts.plantilla || { ok: true, template: 'informe_diario', phone: '56900000009', result: { ok: true, msgId: 'wamid.T1' } };
    },
    // [r8] El almacén de «ya avisado» (reserva + marca), POR TEST y con la semántica de estadoPersistente.js: el
    // folio del correlativo falso es siempre el mismo, así que un almacén compartido filtraría la marca entre tests.
    ...almacenFalsoPorTest(spy),
    generatePdf: async (data, numero) => {
      spy.pdfs.push({
        numero, opcion: data.opcion || null, receptor: data.receptor || null,
        color: data.items?.[0]?.color || null, unit_price: data.items?.[0]?.unit_price || 0,
        measures: data.items?.[0]?.measures || '', vidrio: data.items?.[0]?.glass_label || null,
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
      if (opts.motor === 'colgado') return new Promise(() => {});          // nunca contesta: solo lo corta el tope de la sonda
      if (opts.motor === 'rechaza_tarde') return new Promise((_, rej) => { setTimeout(() => rej(new Error('motor caído (tarde)')), 300); });
      if (opts.motor === '429') {
        // La FORMA REAL de `priceAllEngine` cuando el motor responde 429 o falla (enginePricer.js): no lanza.
        for (const it of d.items || []) {
          it.source = 'activa_engine'; it.confidence = 'manual';
          it.price_warning = 'No se pudo cotizar automáticamente (motor); lo revisa un especialista.';
        }
        return { ok: false, partial: true, total: null, source: 'activa_engine', escalate: true, reason: 'partial_cotization',
          error: 'La cotización requiere revisión de especialista.' };
      }
      for (const it of d.items || []) {
        if (opts.colorSinPrecio && it.color === opts.colorSinPrecio) {
          throw new Error(`motor sin precio para ${it.color}`);
        }
        const p = PRECIO[it.color];
        if (!p) { it.confidence = 'manual'; continue; }
        it.unit_price = p; it.total_price = p * (Number(it.qty) || 1);
        it.source = 'activa_engine'; it.confidence = 'high';
        it.producto_label = it.product; it.glass_label = opts.vidrioMotor || '4+12+4';
      }
      return { ok: true, total: 0, source: 'activa_engine', escalate: false };
    },
    sondaVidrioTopeMs: opts.topeSonda,
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
  // `opts.lastQuote`: la cotizacion anterior de esta conversacion (ya en el cache de sesion), para probar el reuso del folio.
  if (opts.lastQuote) deps.conv.set(`instagram:${senderId}`, { history: [], state: { lastMessageAt: Date.now(), last_quote: opts.lastQuote } });
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
    ? { ok: true, json: async () => ({ quote_number: opts.folio || 'CM-FR-004-2026-0392' }) }
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

test('🔴 IG [05-oct · paridad con WhatsApp] A, B y C imprimen el vidrio con que el MOTOR las cotizo', async () => {
  // El LLM manda "Termopanel DVH" (el ejemplo de la tool, sin espesor). La B y la C ya salian
  // con el vidrio del motor; la A, que se recotiza en la MISMA sonda, se quedaba con el del LLM.
  // Regla unica en services/vidrioCotizado.js (probada ahi, rama por rama).
  const spy = await correr({
    vidrioMotor: '5+12+5',
    item: { producto_label: 'Corredera SLIDING H80', product: 'Corredera SLIDING H80',
      measures: '2000x2000', color: 'Blanco', qty: 1, unit_price: PRECIO.Blanco, glass_label: 'Termopanel DVH' },
    turnos: [{ cotiza: true, text: 'quiero cotizar una corredera de 2000x2000' }],
  });
  assert.equal(spy.pdfs.length, 3, `se esperaban A, B y C: ${spy.documentos.join(', ')}`);
  for (const p of spy.pdfs) assert.equal(p.vidrio, '5+12+5', `${p.numero} imprime "${p.vidrio}", no el vidrio cobrado`);
});

test('🔴 IG [05-oct · B3] satén con el baño perdido: A, B y C conservan el satén y queda el aviso con el folio', async () => {
  let spy;
  const lineas = await capturarLogs(async () => {
    spy = await correr({
      vidrioMotor: '4+12+4',
      item: { producto_label: 'Corredera SLIDING H80', product: 'Corredera SLIDING H80',
        measures: '1500x1000', color: 'Blanco', qty: 1, unit_price: PRECIO.Blanco, glass_label: '4+12+4 satén (baño)' },
      turnos: [{ cotiza: true, text: 'quiero cotizar una corredera de 1500x1000 para el baño' }],
    });
  });
  assert.equal(spy.pdfs.length, 3);
  // B y C imprimen lo MISMO que A: satén. No es casualidad: `elegirVidrio` conserva el satén cuando
  // el motor cotizo claro, en las tres. Y A avisa por todas (B y C no avisan a proposito).
  for (const p of spy.pdfs) assert.equal(p.vidrio, '4+12+4 satén (baño)', `${p.numero} perdio el rastro del baño`);
  assert.ok(lineas.some((l) => /vidrio\.bano_perdido.*CM-FR-004-2026-0392/.test(l)), 'falta el aviso con el folio');
});

/* ── r8: el CABLEADO de IG/FB hacia los tres canales del aviso ──────────────────────────────────────────
 * La lógica (texto Y plantilla siempre, una vez por folio, qué cuenta como «avisado») se prueba en
 * services/avisarVidrio.test.js y services/avisoVidrio.integracion.test.js. Acá solo se verifica que
 * channel-agent.js conecta cada canal a donde corresponde: el id del remitente, el prefijo del canal, el
 * folio, el KV que inyecta el llamador. */

const SATEN_IG = {
  vidrioMotor: '4+12+4',
  item: { producto_label: 'Corredera SLIDING H80', product: 'Corredera SLIDING H80',
    measures: '1500x1000', color: 'Blanco', qty: 1, unit_price: PRECIO.Blanco, glass_label: '4+12+4 satén (baño)' },
  turnos: [{ cotiza: true, text: 'quiero cotizar una corredera de 1500x1000 para el baño' }],
};
const avisosDeVidrio = (spy) => spy.alertas.filter((a) => /revisar precio/.test(a.motivo));
const eventosFallidos = (spy) => spy.eventos.filter((e) => e?.metadata?.aviso_fallido === true);
/** Un turno de IG con un satén perdido; espera POR CONDICIÓN a que el aviso (texto y plantilla) se haya intentado. */
async function correrSaten(extra = {}) {
  let corrida;
  await capturarLogs(async () => {
    corrida = await correr({ ...SATEN_IG, ...extra });
    assert.ok(await esperar(() => avisosDeVidrio(corrida).length > 0 && corrida.plantillas.length > 0),
      `falta el aviso: ${JSON.stringify({ a: corrida.alertas, p: corrida.plantillas })}`);
    await vaciar();
  });
  return corrida;
}

test('🔔 IG satén perdido ⇒ texto Y plantilla, UN aviso de cada uno (A, B y C son el mismo folio), con el id del cliente y el folio', async () => {
  const corrida = await correrSaten();
  assert.equal(corrida.pdfs.length, 3, 'las propuestas salen igual: nunca se frena al cliente');
  // TEXTO: por el notificador, con el prefijo del canal y el id del remitente (el cooldown es del cliente).
  const alertas = avisosDeVidrio(corrida);
  assert.equal(alertas.length, 1, `un aviso por folio: ${JSON.stringify(corrida.alertas)}`);
  assert.match(alertas[0].motivo, /^\[instagram\] /, 'el prefijo de canal manda el aviso al inbox correcto');
  assert.equal(alertas[0].cliente, corrida.senderId);
  assert.match(alertas[0].motivo, /CM-FR-004-2026-0392/);
  assert.match(alertas[0].motivo, /"4\+12\+4 satén \(baño\)"/);
  // PLANTILLA: sale AUNQUE el texto salió (sent:true): ver services/avisarVidrio.test.js (causa raíz de r7).
  assert.deepEqual(corrida.plantillas, [{ folio: 'CM-FR-004-2026-0392', etiquetas: ['4+12+4 satén (baño)'] }]);
  assert.deepEqual(eventosFallidos(corrida), []);
  assert.ok(corrida.estado.get(claveAvisoVidrio('vidrio', 'CM-FR-004-2026-0392', '4+12+4 satén (baño)', '4+12+4'))?.valor?.at > 0, 'la marca quedó escrita con deps.escribirEstado');
  assert.deepEqual(corrida.pdfs.map((p) => p.unit_price).sort((a, b) => a - b),
    [PRECIO.Blanco, PRECIO.Nogal, PRECIO['New Black']], 'los precios no cambian');
});

test('🔔 IG ninguno de los dos canales salió ⇒ UN evento de sistema en la conversación de IG del cliente (como la escalación #888)', async () => {
  const corrida = await correrSaten({
    avisoDueno: { sent: false, reason: 'envio_fallido', code: 131047, error: '{"error":{"code":131047}}' },
    plantilla: { ok: false, template: 'informe_diario', phone: '56900000009', result: { ok: false, error: 'meta_credentials_missing' } },
  });
  assert.equal(corrida.pdfs.length, 3, 'las propuestas salen igual: nunca se frena al cliente');
  const eventos = eventosFallidos(corrida);
  assert.equal(eventos.length, 1, JSON.stringify(corrida.eventos));
  assert.equal(eventos[0].channel, 'instagram', 'en el canal del cliente, que es donde se mira');
  assert.equal(eventos[0].external_id, corrida.senderId);
  assert.equal(eventos[0].direction, 'outbound');
  assert.equal(eventos[0].actor_type, 'system');
  assert.equal(eventos[0].metadata.source, 'oliver_gpt_channel');
  assert.equal(eventos[0].metadata.folio, 'CM-FR-004-2026-0392');
  assert.match(String(eventos[0].metadata.motivo_template), /meta_credentials_missing/);
  assert.equal(corrida.estado.has(claveAvisoVidrio('vidrio', 'CM-FR-004-2026-0392', '4+12+4 satén (baño)', '4+12+4')), false, 'no llegó ⇒ SIN marca: el reintento tiene que poder salir');
});

test('🔔 IG sin satén perdido NO se avisa al dueño del vidrio: ni texto ni plantilla ni evento', async () => {
  let corrida;
  await capturarLogs(async () => {
    corrida = await correr({
      vidrioMotor: '4+12+4',
      item: { producto_label: 'Corredera SLIDING H80', product: 'Corredera SLIDING H80',
        measures: '1500x1000', color: 'Blanco', qty: 1, unit_price: PRECIO.Blanco, glass_label: 'Laminado 6+6' },
      turnos: [{ cotiza: true, text: 'quiero cotizar una corredera de 1500x1000' }],
    });
    await vaciar();
  });
  assert.deepEqual([avisosDeVidrio(corrida), corrida.plantillas, eventosFallidos(corrida)], [[], [], []]);
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

/* =========================================================================
 * 4-bis) EL PLAZO EFECTIVO DEL FOLIO REUSADO SIGUE SIENDO 48 h (una sola constante: services/folioReuso.js)
 * Los dos canales y la marca del aviso de satén leen `FOLIO_REUSO_MS`; el de WhatsApp está en webhook.vientos.test.js.
 * ========================================================================= */

for (const [horas, reusa] of [[47, true], [49, false]]) {
  test(`📎 IG: la cotización anterior de hace ${horas} h ${reusa ? 'SE REUSA (revisión del mismo folio)' : 'ya NO se reusa: folio nuevo'}`, async () => {
    const FOLIO_PREVIO = 'CM-FR-004-2026-0300';
    const spy = await correr({
      lastQuote: { quote_number: FOLIO_PREVIO, at: Date.now() - horas * 3600_000, pdf_sent: true },
      item: { producto_label: 'Corredera SLIDING H80', product: 'Corredera SLIDING H80',
        measures: '1500x1200', color: 'Nogal', qty: 1, unit_price: PRECIO.Nogal, glass_label: '4+12+4' },
      turnos: [{ cotiza: true, text: 'quiero una corredera NOGAL de 1500x1200' }],
    });
    assert.deepEqual(spy.documentos, [reusa ? FOLIO_PREVIO : 'CM-FR-004-2026-0392']);
  });
}

/* =========================================================================
 * 5) [#1088] CON UN SOLO COLOR NOMBRADO, EL VIDRIO DEL MOTOR TAMBIÉN LLEGA AL DOCUMENTO
 *
 * CAUSA RAÍZ: en IG/FB, `aplicarVidrio` —lo único que escribe el vidrio del MOTOR en el documento y junta el aviso de
 * «satén perdido»— solo se llamaba desde la sonda de la opción A, que existe SOLO si hay terna (varios colores
 * propuestos). Cuando el cliente nombra UN color no hay terna, no hay sonda, y el documento imprimía la etiqueta que
 * mandó el LLM; si decía «satén» y el motor cotizó claro, el dueño no se enteraba. WhatsApp tiene la misma regla por
 * OTRO camino: el bloque «Uw SIEMPRE del MOTOR» (webhook.js, `_therm`) recotiza TODAS las ventanas en cada emisión, con o sin
 * terna, y aplica `aplicarVidrio(it, vidrioDelMotor(t), { mismoPrecio: precioCoincide(t, it.unit_price) })`.
 * Acá se usa ESE mismo mecanismo (misma sonda que la opción A, mismas funciones), sin tocar ningún monto.
 * Estas pruebas se pusieron en ROJO con el defecto puesto (51af7d4) antes de tocar el código.
 * ========================================================================= */

const ITEM_UN_COLOR = (extra = {}) => ({
  producto_label: 'Corredera SLIDING H80', product: 'Corredera SLIDING H80',
  measures: '1500x1000', color: 'Nogal', qty: 1, unit_price: PRECIO.Nogal, glass_label: 'Termopanel DVH', ...extra,
});

test('🔴 IG [#1088] UN color nombrado: el documento imprime el vidrio del MOTOR (5+12+5), no la etiqueta del LLM — y el precio no cambia', async () => {
  const spy = await correr({
    vidrioMotor: '5+12+5',
    item: ITEM_UN_COLOR({ measures: '2000x2000' }),
    turnos: [{ cotiza: true, text: 'quiero una corredera NOGAL de 2000x2000' }],
  });
  assert.equal(spy.documentos.length, 1, 'una sola propuesta (no hay terna: el cliente dijo el color)');
  assert.equal(spy.pdfs[0].vidrio, '5+12+5', `imprime "${spy.pdfs[0].vidrio}": tiene que ser el vidrio con que el motor cobró`);
  assert.equal(spy.pdfs[0].unit_price, PRECIO.Nogal, '💰 el precio es el de siempre: este cambio no calcula ni toca ningún monto');
  assert.equal(spy.quoteEvents.find((e) => e.status === 'sent')?.amount_total, PRECIO.Nogal, 'y lo que se reporta a las plataformas tampoco cambia');
});

test('🔴 IG [#1088] UN color nombrado + etiqueta satén + el motor cotizó claro: se conserva el satén y el dueño recibe el aviso (texto Y plantilla)', async () => {
  let spy;
  await capturarLogs(async () => {
    spy = await correr({
      vidrioMotor: '4+12+4',
      item: ITEM_UN_COLOR({ glass_label: '4+12+4 satén (baño)' }),
      turnos: [{ cotiza: true, text: 'quiero una corredera NOGAL de 1500x1000 para el baño' }],
    });
    assert.ok(await esperar(() => avisosDeVidrio(spy).length > 0 && spy.plantillas.length > 0),
      `falta el aviso: ${JSON.stringify({ a: spy.alertas, p: spy.plantillas })}`);
    await vaciar();
  });
  assert.equal(spy.pdfs[0].vidrio, '4+12+4 satén (baño)', 'el satén NO se reemplaza por el claro');
  assert.equal(spy.pdfs[0].unit_price, PRECIO.Nogal, '💰 el precio no cambia');
  const alertas = avisosDeVidrio(spy);
  assert.equal(alertas.length, 1, JSON.stringify(spy.alertas));
  assert.match(alertas[0].motivo, /^\[instagram\] /);
  assert.match(alertas[0].motivo, /CM-FR-004-2026-0392/);
  assert.match(alertas[0].motivo, /"4\+12\+4 satén \(baño\)"/);
  assert.deepEqual(spy.plantillas, [{ folio: 'CM-FR-004-2026-0392', etiquetas: ['4+12+4 satén (baño)'] }]);
});

test('🔴 IG [#1088 · paridad] el mismo caso con UN color y con TERNA (A/B/C): el documento A imprime lo mismo y el aviso al dueño es el mismo', async () => {
  // La regla es UNA (services/vidrioCotizado.js, `elegirVidrio`) y WhatsApp la aplica con o sin terna (webhook.vientos.test.js,
  // B y B3). Acá se prueba que IG también: cada caso corre con un color nombrado y sin color, y los dos tienen que coincidir
  // entre sí y con la regla compartida.
  const CASOS = [
    // [rotulo, glass_label del LLM, vidrio que cotizó el motor, vidrio esperado en el documento, ¿avisa al dueño?]
    ['el LLM mandó el ejemplo de la tool', 'Termopanel DVH', '5+12+5', '5+12+5', false],
    ['4+12+4 ↔ 5+12+5 es la regla de ÁREA del motor, no otro producto', '4+12+4', '5+12+5', '5+12+5', false],
    ['satén perdido: se conserva y se avisa', '4+12+4 satén (baño)', '4+12+4', '4+12+4 satén (baño)', true],
    ['otro producto (laminado): se reemplaza por lo cobrado, sin molestar al dueño', 'Laminado 6+6', '4+12+4', '4+12+4', false],
    ['sin etiqueta: el vidrio del motor', '', '4+12+4', '4+12+4', false],
  ];
  for (const [rotulo, etiqueta, motor, esperado, avisa] of CASOS) {
    assert.equal(elegirVidrio(etiqueta, motor).vidrio, esperado, `${rotulo}: control — la regla compartida`);
    const corridas = {};
    for (const modo of ['un_color', 'terna']) {
      let spy;
      await capturarLogs(async () => {
        spy = await correr({
          vidrioMotor: motor,
          item: modo === 'un_color'
            ? ITEM_UN_COLOR({ glass_label: etiqueta })
            : ITEM_UN_COLOR({ color: 'Blanco', unit_price: PRECIO.Blanco, glass_label: etiqueta }),
          turnos: [{ cotiza: true, text: modo === 'un_color' ? 'quiero una corredera NOGAL de 1500x1000' : 'quiero cotizar una corredera de 1500x1000' }],
        });
        if (avisa) assert.ok(await esperar(() => avisosDeVidrio(spy).length > 0 && spy.plantillas.length > 0), `${rotulo} (${modo}): falta el aviso`);
        await vaciar(); await vaciar();
      });
      corridas[modo] = spy;
      assert.equal(spy.pdfs[0].vidrio, esperado, `${rotulo} (${modo}): el documento A imprime "${spy.pdfs[0].vidrio}"`);
      assert.equal(avisosDeVidrio(spy).length, avisa ? 1 : 0, `${rotulo} (${modo}): aviso al dueño`);
      assert.equal(spy.plantillas.length, avisa ? 1 : 0, `${rotulo} (${modo}): plantilla`);
    }
    assert.equal(corridas.un_color.pdfs.length, 1, `${rotulo}: con un color sale UNA propuesta`);
    assert.equal(corridas.terna.pdfs.length, 3, `${rotulo}: sin color salen A, B y C`);
  }
});

test('🔒💰 IG [#1088] la guardia `precioCoincide` (como WhatsApp): si el precio impreso NO es el que el motor calcula ahora, la etiqueta del LLM queda y el monto NO se corrige', async () => {
  const PRECIO_LLM = PRECIO.Nogal + 7000;          // el LLM copió un precio que el motor ya no da
  const spy = await correr({
    vidrioMotor: '5+12+5',
    item: ITEM_UN_COLOR({ measures: '2000x2000', unit_price: PRECIO_LLM }),
    turnos: [{ cotiza: true, text: 'quiero una corredera NOGAL de 2000x2000' }],
  });
  assert.equal(spy.pdfs[0].vidrio, 'Termopanel DVH', 'el vidrio del motor es el de OTRO cálculo: no se estampa en un precio que no es el suyo');
  assert.equal(spy.pdfs[0].unit_price, PRECIO_LLM, '💰 y el monto impreso es el que venía: este mecanismo NUNCA escribe un precio');
});

test('🔒 IG [#1088] el costo es UNA recotización (misma sonda que la opción A, con el color del cliente) y si el motor falla el documento sale igual', async () => {
  const ok = await correr({
    vidrioMotor: '5+12+5',
    item: ITEM_UN_COLOR({ measures: '2000x2000' }),
    turnos: [{ cotiza: true, text: 'quiero una corredera NOGAL de 2000x2000' }],
  });
  assert.equal(ok.sondas.length, 1, 'una sola llamada extra al motor por documento');
  assert.deepEqual(ok.sondas[0].items.map((i) => [i.color, i.measures, i.qty]), [['Nogal', '2000x2000', 1]], 'el color es el que dijo el cliente, no uno de la terna');

  let caido;
  await capturarLogs(async () => {
    caido = await correr({
      colorSinPrecio: 'Nogal',                       // el motor LANZA para este color
      item: ITEM_UN_COLOR({ glass_label: '4+12+4 satén (baño)' }),
      turnos: [{ cotiza: true, text: 'quiero una corredera NOGAL de 1500x1000' }],
    });
    await vaciar(); await vaciar();
  });
  assert.equal(caido.documentos.length, 1, 'nunca se frena al cliente porque el motor no contestó');
  assert.equal(caido.pdfs[0].vidrio, '4+12+4 satén (baño)', 'sin motor no se inventa vidrio: queda lo que venía');
  assert.equal(caido.pdfs[0].unit_price, PRECIO.Nogal);
  assert.deepEqual([avisosDeVidrio(caido), caido.plantillas], [[], []], 'y sin cotización del motor no hay base para avisar de nada');
});

/* ── #1088 · el costo de la sonda: tope TOTAL y nada en silencio ─────────────────────────────────────────────────
 *
 * CAUSA RAÍZ (confirmada por el tridente con el `priceAllEngine` real y un `fetch` que solo termina al abortarse):
 *  · SIN TOPE TOTAL: el cliente HTTP del motor espera hasta 15 s POR LLAMADA y `priceAllEngine` agrupa de a 6 en serie,
 *    así que con el motor colgado la sonda sola tardaba 15 s por cada 6 ítems (7 ítems = 30 s, 13 = 45 s) con el mutex
 *    del cliente tomado y un tope de turno de 50 s.
 *  · SILENCIO: ante un 429 o un fallo, `priceAllEngine` NO lanza —devuelve ok:false y deja `confidence:'manual'`—, así que
 *    el `catch` de la sonda no se activaba y no quedaba NI UN log (12 ítems gastaban 12 de las 20 llamadas por minuto que
 *    el motor deja por IP, compartidas con WhatsApp, y nadie se enteraba).
 * Cada prueba se puso en ROJO con el defecto puesto (7f1ca59) antes de tocar el código. */

/** Si `promesa` no termina en `ms`, falla con `que`: en rojo, una emisión colgada no puede colgar la suite. */
async function conGuardia(promesa, ms, que) {
  let timer;
  try {
    return await Promise.race([promesa, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(que)), ms); })]);
  } finally { clearTimeout(timer); }
}
/** Los campos JSON que lleva una línea de log de la sonda: `<conv>: {"folio":…,"items":…}`. */
const camposDeLinea = (linea) => JSON.parse(linea.slice(linea.indexOf('{'), linea.lastIndexOf('}') + 1));

test('🔴 IG [#1088] motor COLGADO: la sonda tiene un tope TOTAL; el documento sale igual con la etiqueta que traía y queda el log vidrio.sonda_sin_tiempo', async () => {
  const TOPE = 120;
  const t0 = Date.now();
  let spy;
  const lineas = await capturarLogs(async () => {
    spy = await conGuardia(correr({
      motor: 'colgado', topeSonda: TOPE,
      item: ITEM_UN_COLOR({ glass_label: '4+12+4 satén (baño)' }),
      turnos: [{ cotiza: true, text: 'quiero una corredera NOGAL de 1500x1000 para el baño' }],
    }), 5000, 'la emisión quedó colgada: la sonda del vidrio no tiene tope total');
    await vaciar(); await vaciar();
  });
  assert.ok(Date.now() - t0 < 3000, 'la emisión sigue apenas vence el tope, no cuando el motor se digne');
  assert.equal(spy.documentos.length, 1, 'el documento sale igual: nunca se frena al cliente');
  assert.equal(spy.pdfs[0].vidrio, '4+12+4 satén (baño)', 'sin respuesta del motor no se inventa vidrio: queda lo que venía');
  assert.equal(spy.pdfs[0].unit_price, PRECIO.Nogal, '💰 el monto no cambia');
  const linea = lineas.find((l) => l.includes('vidrio.sonda_sin_tiempo'));
  assert.ok(linea, `falta el log vidrio.sonda_sin_tiempo: ${JSON.stringify(lineas.filter((l) => /vidrio/.test(l)))}`);
  assert.deepEqual(camposDeLinea(linea), { folio: null, items: 1, ms: TOPE }, 'sin folio previo en la conversación, folio es null');
  assert.deepEqual([avisosDeVidrio(spy), spy.plantillas], [[], []], 'y sin cotización del motor no hay base para avisar de nada');
});

test('🔴 IG [#1088] con el tope POR DEFECTO y 7 ítems, un motor colgado retrasa la emisión SOLO el tope (antes: 15 s por cada 6 ítems = 30 s)', async () => {
  const tope = canalIgFb.SONDA_VIDRIO_TOPE_MS;
  assert.ok(tope >= 2000 && tope <= 10_000, `el tope total tiene que ser de segundos, bien bajo los 15 s de UNA llamada colgada: ${tope}`);
  const siete = Array.from({ length: 7 }, (_, i) => ITEM_UN_COLOR({ measures: `${1000 + 100 * i}x1000` }));
  const t0 = Date.now();
  let spy;
  await capturarLogs(async () => {
    spy = await conGuardia(correr({
      motor: 'colgado',
      item: ITEM_UN_COLOR(),
      turnos: [{ cotiza: true, text: 'quiero siete correderas NOGAL', llm: { items: siete } }],
    }), tope + 12_000, 'la emisión quedó colgada: el tope por defecto no corta la sonda');
  });
  const dt = Date.now() - t0;
  assert.equal(spy.sondas[0]?.items.length, 7, 'control: la sonda llevó los 7 ítems');
  assert.equal(spy.documentos.length, 1);
  assert.ok(dt >= tope - 100, `salió en ${dt} ms: lo que la liberó fue el tope (${tope} ms)`);
  assert.ok(dt < tope + 6000, `salió en ${dt} ms: tiene que ser el tope más un margen, no 30 s`);
});

test('🔴 IG [#1088] el motor responde 429 / manual (priceAllEngine NO lanza): la etiqueta queda, el documento sale y queda el log vidrio.sonda_sin_cotizacion con el motivo y el folio', async () => {
  const FOLIO_PREVIO = 'CM-FR-004-2026-0300';
  let spy;
  const lineas = await capturarLogs(async () => {
    spy = await correr({
      motor: '429',
      lastQuote: { quote_number: FOLIO_PREVIO, at: Date.now() - 3600_000, pdf_sent: true },     // la conversación ya tiene folio
      item: ITEM_UN_COLOR({ glass_label: '4+12+4 satén (baño)' }),
      turnos: [{ cotiza: true, text: 'quiero una corredera NOGAL de 1500x1000 para el baño' }],
    });
    await vaciar(); await vaciar();
  });
  assert.deepEqual(spy.documentos, [FOLIO_PREVIO], 'el documento sale igual, con el folio de siempre');
  assert.equal(spy.pdfs[0].vidrio, '4+12+4 satén (baño)', 'la etiqueta queda intacta');
  assert.equal(spy.pdfs[0].unit_price, PRECIO.Nogal, '💰 el monto no cambia');
  const linea = lineas.find((l) => l.includes('vidrio.sonda_sin_cotizacion'));
  assert.ok(linea, `falta el log vidrio.sonda_sin_cotizacion: ${JSON.stringify(lineas.filter((l) => /vidrio/.test(l)))}`);
  const c = camposDeLinea(linea);
  assert.equal(c.folio, FOLIO_PREVIO);
  assert.equal(c.items, 1);
  assert.match(c.motivo, /partial_cotization/, 'lo que devolvió el motor');
  assert.match(c.motivo, /manual/, 'y cómo dejó el ítem');
  assert.ok(!lineas.some((l) => l.includes('vidrio.sonda_sin_tiempo')), 'no fue un problema de tiempo');
  assert.deepEqual([avisosDeVidrio(spy), spy.plantillas], [[], []]);
});

test('🔒 IG [#1088] un motor que RECHAZA después de vencido el tope no deja una promesa sin manejar ni cambia el documento', async () => {
  const sinManejar = [];
  const alRechazo = (e) => sinManejar.push(e);
  process.on('unhandledRejection', alRechazo);
  try {
    let spy;
    const lineas = await capturarLogs(async () => {
      spy = await correr({
        motor: 'rechaza_tarde', topeSonda: 50,
        item: ITEM_UN_COLOR({ glass_label: '4+12+4 satén (baño)' }),
        turnos: [{ cotiza: true, text: 'quiero una corredera NOGAL de 1500x1000 para el baño' }],
      });
      await new Promise((r) => { setTimeout(r, 450); });          // deja que la llamada en vuelo rechace DESPUÉS del tope
    });
    assert.deepEqual(sinManejar, [], 'la llamada en vuelo que falla tarde no puede quedar sin manejar');
    assert.ok(lineas.some((l) => l.includes('vidrio.sonda_sin_tiempo')));
    assert.equal(spy.documentos.length, 1);
    assert.equal(spy.pdfs[0].vidrio, '4+12+4 satén (baño)');
  } finally { process.off('unhandledRejection', alRechazo); }
});

test('IG [#1088] camino normal: el motor contesta ⇒ el vidrio llega igual que antes y NO queda ningún log de la sonda', async () => {
  let spy;
  const lineas = await capturarLogs(async () => {
    spy = await correr({
      vidrioMotor: '5+12+5', topeSonda: 120,
      item: ITEM_UN_COLOR({ measures: '2000x2000' }),
      turnos: [{ cotiza: true, text: 'quiero una corredera NOGAL de 2000x2000' }],
    });
    await vaciar(); await vaciar();
  });
  assert.equal(spy.pdfs[0].vidrio, '5+12+5');
  assert.equal(spy.pdfs[0].unit_price, PRECIO.Nogal);
  assert.deepEqual(lineas.filter((l) => /vidrio\.sonda_/.test(l)), [], 'sin problemas, sin ruido');
});
