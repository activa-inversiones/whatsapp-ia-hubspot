// webhook.receptor-rut.test.js — [2026-08-30]
//
// EL RUT DEL CLIENTE LLEGA AL DOCUMENTO — de punta a punta, por el camino VIVO.
//
// CASO REAL: Alfredo Arias Luengo (conv 56952077379) pidió CUATRO veces que le agregaran el
// RUT a su cotización. El fix del 28-ago (pdf-intent.js:300) arregló el texto del CHAT; el
// PDF nunca tuvo campo de RUT. Y Oliver le escribió *"la propuesta quedó emitida a nombre de
// ..., RUT ..."*: una afirmación FALSA sobre el contenido de un documento formal.
//
// Lo que defiende esta red, en orden de gravedad:
//   1. ⛔ Un RUT que NO pasa módulo 11 jamás llega al documento, ni al CRM, ni a la BD.
//   2. El RUT válido llega EN EL MISMO TURNO en que el cliente lo escribe (si se capturara
//      después del turno, el cliente que dice "agrégale mi RUT" recibiría la propuesta de ese
//      turno todavía sin RUT — que es exactamente lo que enojó a Alfredo).
//   3. 🔴 No se lee un RUT donde no lo hay: decirle "ese RUT no me cuadra" a quien habló de
//      plata es el error simétrico del que obligó a parchar stripMontos.
//   4. El dato SOBREVIVE al turno (la foto del estado la saca agent.handleTurn al EMPEZAR).
//
// Hermético: `global.fetch` anulado salvo el correlativo ISO; todo lo que toca red inyectado.

import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook } from './webhook.js';

global.fetch = async (url) => {
  if (String(url).includes('/internal/quotes/next-number')) {
    return { ok: true, status: 200, json: async () => ({ quote_number: 'CM-FR-004-2026-9998' }) };
  }
  return { ok: false, status: 503, json: async () => ({}) };
};

let SEQ = 0;
const makeRes = () => ({ sendStatus() { return this; } });

// Las cotizaciones pasan por los gates de COLOR y de APERTURA (pdf-intent.js): si el cliente
// no nombra ninguno de los dos, el PDF se frena a propósito y se le pregunta. Eso es correcto y
// no es lo que se mide acá, así que cada mensaje de prueba lleva esta cola: los gates dan verde
// y el test puede observar lo único que le importa — el RUT.
const COTIZABLE = ', quiero la corredera en color nogal';

const ITEM = {
  product: 'Ventana PVC S60 corredera', producto_label: 'Ventana PVC S60 corredera',
  measures: '1200x1000mm', measures_original: '1200x1000mm', glass_label: 'DVH 5/12/5',
  ambiente: 'Living', qty: 1, unit_price: 100000, total_price: 100000, color: 'Nogal',
};

function armar(textosPorTurno) {
  const telefono = `5698${String(++SEQ).padStart(7, '0')}`;
  const estado = new Map();
  const conv = new Map();
  const vigente = (e) => e && (!e.expira || e.expira > Date.now());
  const spy = { pdfData: [], estadosVistos: [], quoteEvents: [], deals: [], informes: [] };
  let turno = 0;
  // La cantidad cambia en cada turno A PROPOSITO: el guard anti-duplicado de `generarPdf`
  // (REGLA #18) frena un segundo PDF con el MISMO contenido, y con razon. Variar la cantidad
  // simula al cliente que agrega una ventana, que es el caso que se quiere observar.
  let pdfSeq = 0;

  const deps = {
    conv, seen: new Set(), locks: new Map(),
    dormir: async () => {},
    leerEstado: async (k) => (vigente(estado.get(k)) ? estado.get(k).valor : null),
    escribirEstado: (k, v, ttl = 300) => estado.set(k, { valor: v, expira: Date.now() + ttl * 1000 }),
    fusionarEstado: (k, calc, ttl = 300) => {
      const e = estado.get(k);
      const { valor, guardar } = calc(vigente(e) ? e.valor : null) || {};
      if (guardar && valor != null) estado.set(k, { valor, expira: Date.now() + ttl * 1000 });
      return valor === undefined ? (vigente(e) ? e.valor : null) : valor;
    },
    reservarEstado: (k, ttl = 300) => {
      if (vigente(estado.get(k))) return null;
      const t = `t${Math.random()}`; estado.set(k, { valor: t, expira: Date.now() + ttl * 1000 }); return t;
    },
    liberarReserva: (k, t) => { const e = estado.get(k); if (!t || !vigente(e) || e.valor !== t) return false; estado.delete(k); return true; },

    parseInbound: () => ({ ok: true, from: telefono, text: textosPorTurno[turno++] || 'hola', msgId: `wamid.${Math.random()}`, type: 'text' }),
    sendWhatsAppText: async () => ({ ok: true, msgId: 'm1' }),

    pedirInformeComuna: async () => null,
    generarInformeTermicoPdf: async (_d, opts) => { spy.informes.push(opts); return null; },
    pedirVientos: async () => null,
    generatePdf: async (data) => { spy.pdfData.push(data); return Buffer.alloc(2048, 3); },
    uploadWaDocument: async () => 'media.1',
    sendWaDocument: async () => ({ ok: true, msgId: 'p1' }),
    saveMedia: async () => ({ ok: true }),
    mediaIdsDisponibles: async () => ({}),
    upsertZohoDeal: async (p) => { spy.deals.push(p); return null; },
    addZohoNote: async () => ({ ok: true }),
    attachPdfToDeal: async () => ({ ok: true }),
    persistSession: () => {},

    handleTurn: async ({ state, toolCtx }) => {
      // La foto del estado tal como la ve el cerebro: acá se comprueba que la captura
      // determinista corrió ANTES del turno.
      spy.estadosVistos.push({
        receptor: state.receptor ? { ...state.receptor } : null,
        rechazado: state.receptor_rechazado ? { ...state.receptor_rechazado } : null,
        lockedRut: state.lockedData?.rut || null,
      });
      await toolCtx.generarPdf({ items: [{ ...ITEM, qty: ++pdfSeq }], comuna: 'Temuco', name: 'Alfredo Arias Luengo' });
      return { reply: 'ok', history: [], toolCalls: [], state: { ...state, name: 'Alfredo Arias Luengo' } };
    },
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({ ok: true }),
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async (p) => { spy.quoteEvents.push(p); return { ok: true }; },
    },
    notifyHighValue: async () => ({ sent: true }),
  };
  return { deps, spy, telefono, conv };
}

/* ── 1) El caso del dueño: EMPRESA con razón social ───────────────────────── */

test('EMPRESA: "a nombre de X Spa, rut …" llega al PDF en el MISMO turno', async () => {
  const { deps, spy } = armar([`perfecto, a nombre de Maya Mapu Spa, rut 77.448.504-K${COTIZABLE}`]);
  await handleWebhook({ body: {} }, makeRes(), deps);

  const visto = spy.estadosVistos[0];
  assert.ok(visto, 'el cerebro corrió');
  assert.ok(visto.receptor, 'la captura corrió ANTES del turno: el estado ya trae el receptor');
  assert.equal(visto.receptor.rut, '77.448.504-K');
  assert.equal(visto.receptor.razonSocial, 'Maya Mapu Spa');
  assert.equal(visto.receptor.clienteTipo, 'empresa');
  assert.equal(visto.lockedRut, '77.448.504-K', 'espejado en lockedData para que no se re-pregunte');

  const pdf = spy.pdfData[0];
  assert.ok(pdf, 'se generó la propuesta');
  assert.ok(pdf.receptor, 'la propuesta lleva el receptor');
  assert.equal(pdf.receptor.rut, '77.448.504-K');
  assert.equal(pdf.receptor.razonSocial, 'Maya Mapu Spa');
  assert.equal(pdf.name, 'Alfredo Arias Luengo', 'el contacto del chat NO se pisa con la razón social');
});

test('el RUT viaja al Deal de Zoho y a quotes.payload (registro auditable)', async () => {
  const { deps, spy } = armar([`a nombre de Maya Mapu Spa, rut 77.448.504-K${COTIZABLE}`]);
  await handleWebhook({ body: {} }, makeRes(), deps);

  assert.equal(spy.deals[0]?.receptor?.rut, '77.448.504-K', 'Marcelo lo ve en el Deal sin abrir el PDF');
  assert.equal(spy.quoteEvents[0]?.receptor?.rut, '77.448.504-K',
    'y queda en quotes.payload->receptor: el documento emitido se puede reconstruir');
  assert.equal(spy.quoteEvents[0]?.receptor?.razonSocial, 'Maya Mapu Spa');
});

/* ── 2) PERSONA NATURAL ───────────────────────────────────────────────────── */

test('PERSONA NATURAL: nombre + RUT de la persona', async () => {
  const { deps, spy } = armar([`a nombre de Bayron Reyes, rut 20.712.345-5${COTIZABLE}`]);
  await handleWebhook({ body: {} }, makeRes(), deps);
  const r = spy.pdfData[0]?.receptor;
  assert.ok(r);
  assert.equal(r.clienteTipo, 'particular');
  assert.equal(r.nombre, 'Bayron Reyes');
  assert.equal(r.rut, '20.712.345-5');
  assert.equal(r.razonSocial, '', 'una persona natural no tiene razón social inventada');
});

/* ── 3) ⛔ EL RUT MALO NO LLEGA A NINGUNA PARTE ───────────────────────────── */

test('⛔ RUT con dígito verificador equivocado: NO se guarda, NO llega al PDF, y queda la marca para repreguntar', async () => {
  // El DV correcto de 76.486.825 es 0. Con 1 no cierra por módulo 11.
  const { deps, spy } = armar([`mi rut es 76.486.825-1 para la factura${COTIZABLE}`]);
  await handleWebhook({ body: {} }, makeRes(), deps);

  const visto = spy.estadosVistos[0];
  assert.equal(visto.receptor, null, 'no se guardó un RUT que no valida');
  assert.ok(visto.rechazado, 'queda la marca para que Oliver lo vuelva a pedir');
  assert.equal(visto.rechazado.crudo, '76.486.825-1', 'con lo que el cliente escribió, para repreguntar con precisión');
  assert.equal(visto.rechazado.motivo, 'dv');

  assert.equal(spy.pdfData[0]?.receptor, null, 'la propuesta sale SIN RUT antes que con uno equivocado');
  assert.equal(spy.deals[0]?.receptor, null, 'tampoco al CRM');
  assert.equal(spy.quoteEvents[0]?.receptor, null, 'tampoco a la BD');
});

/* ── 4) 🔴 Cero falsos positivos ──────────────────────────────────────────── */

test('🔴 un mensaje sobre PLATA no produce ni receptor ni rechazo', async () => {
  const { deps, spy } = armar([`quedamos en 1.200.000 - 3 cuotas entonces?${COTIZABLE}`]);
  await handleWebhook({ body: {} }, makeRes(), deps);
  const visto = spy.estadosVistos[0];
  assert.equal(visto.receptor, null);
  assert.equal(visto.rechazado, null, 'ni siquiera se le dice que "ese RUT no cuadra": no habló de RUT');
});

test('un cliente que nunca menciona el RUT recibe su propuesta exactamente como antes', async () => {
  const { deps, spy } = armar([`quiero cotizar una ventana de 1200x1000 en Temuco${COTIZABLE}`]);
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.equal(spy.estadosVistos[0].receptor, null, 'no se le molesta con nada');
  assert.equal(spy.pdfData[0]?.receptor, null, 'y el PDF no cambia');
});

/* ── 5) Sobrevive al turno y a los turnos siguientes ─────────────────────── */

test('el RUT sobrevive: el cliente lo da una vez y sigue en la propuesta del turno siguiente', async () => {
  const { deps, spy } = armar([
    `a nombre de Maya Mapu Spa, rut 77.448.504-K${COTIZABLE}`,
    `ah, y agrégame otra ventana igual por favor${COTIZABLE}`,
  ]);
  await handleWebhook({ body: {} }, makeRes(), deps);
  await handleWebhook({ body: {} }, makeRes(), deps);

  assert.equal(spy.estadosVistos.length, 2, 'corrieron los dos turnos');
  assert.equal(spy.estadosVistos[1].receptor?.rut, '77.448.504-K',
    'el receptor sobrevivió al turno anterior (si esto se pone rojo, se perdió como se perdían los relojes de los gates)');
  assert.equal(spy.pdfData[1]?.receptor?.rut, '77.448.504-K');
  assert.equal(spy.pdfData[1]?.receptor?.razonSocial, 'Maya Mapu Spa');
});

test('un RUT bueno en un turno posterior BORRA el rechazo anterior', async () => {
  const { deps, spy } = armar([
    `mi rut es 76.486.825-1${COTIZABLE}`,                      // inválido
    `perdón, el rut correcto es 76.486.825-0${COTIZABLE}`,
  ]);
  await handleWebhook({ body: {} }, makeRes(), deps);
  await handleWebhook({ body: {} }, makeRes(), deps);

  assert.ok(spy.estadosVistos[0].rechazado, 'el primer turno deja la marca');
  assert.equal(spy.estadosVistos[1].receptor?.rut, '76.486.825-0', 'el segundo lo captura bien');
  assert.equal(spy.estadosVistos[1].rechazado, null,
    'y borra el rechazo: Oliver no puede seguir pidiendo un RUT que el cliente ya corrigió');
});
