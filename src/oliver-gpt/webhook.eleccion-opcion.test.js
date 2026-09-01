// webhook.eleccion-opcion.test.js — [2026-08-31 · tridente]
//
// LOS TRES DEFECTOS QUE EL TRIDENTE (Codex + Gemini + Copilot) DEVOLVIO NO APTOS SOBRE LAS
// TRES PROPUESTAS A/B/C. Los tres estaban verificados contra el codigo, no eran teoria:
//
//   1. 🟠 EL AVISO LE MENTIA AL CLIENTE SOBRE EL COLOR. Cuando de las tres quedaba UNA sola
//      entregada, el mensaje decia FIJO "se la preparé en *Blanco*". Pero la terna sale del
//      mas caro al mas economico, asi que la que queda de pie por defecto es la New Black:
//      el cliente leia "Blanco" y abria un PDF que decia New Black.
//
//   2. 🟠💰 "ME QUEDO CON LA B" DISPARABA UNA SEGUNDA CONVERSION. Codex lo reprodujo: primer
//      turno sin color → A/B/C con UNA conversion 'sent'. Segundo turno, "me quedo con la B"
//      → otro documento (…-D) y OTRA conversion 'sent' por otro monto. A Meta y a Google les
//      llegaban DOS ventas cotizadas por UN cliente: el algoritmo aprende que ese trafico
//      convierte el doble y reparte el presupuesto del dueño con un dato falso.
//
//   3. ⏱️ CINCO RECOTIZACIONES EN FILA. Con el motor lento (timeout 15 s) el cliente podia
//      quedar ~75 s sin respuesta. Una de las cinco era ademas REDUNDANTE: la guardia de
//      apertura y la recotizacion de la opcion A le preguntaban lo mismo al motor, una
//      detras de la otra, y el resultado de la primera lo pisaba la segunda.
//
// POR QUE CONTRA EL WEBHOOK ENTERO: la misma leccion del 29-ago que ya dejo escrita
// webhook.propuestas-abc.test.js. Un test que simula un mundo mas indulgente que produccion
// no prueba nada: aca el LLM falso hace lo que hace el de verdad — rellena 'Blanco' porque
// el system-prompt se lo ordena, aunque el cliente escribio "me quedo con la B".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleWebhook } from './webhook.js';
import {
  avisoColorNoElegido, colorDeCatalogo, letraElegidaEnTexto, opcionYaEntregada,
} from './propuestas-color.js';

function makeRes() { return { sendStatus() { return this; } }; }

// Precio por color, DISTINTO en cada uno — es la condicion sin la cual la terna no tendria
// sentido, y tambien la razon por la que una segunda conversion reporta OTRO monto.
const PRECIO = { Blanco: 300000, Nogal: 430000, 'New Black': 465000 };

const ITEM_BASE = {
  producto_label: 'Corredera SLIDING H80', product: 'Corredera SLIDING H80',
  measures: '1500x1200', qty: 1, glass_label: '4+12+4',
};

// Un telefono distinto por corrida: `RECENT_QUOTES` es un Map de MODULO (guard anti-doble
// folio de 2 min) compartido por todo el archivo.
let _telefonos = 0;

/**
 * Corre una conversacion de N turnos contra el webhook real.
 *
 * @param {Array<{texto:string, items?:Array}>} guion  un paso por mensaje del cliente;
 *        `items` = lo que el LLM le pasa a generar_pdf_cotizacion en ese turno (sin `items`
 *        el turno no llama la tool).
 * @param {object} opts
 * @param {(numero:string)=>boolean} [opts.entrega]  false para simular un envio fallido
 * @param {number} [opts.demoraMotorMs]  cuanto tarda el motor inyectado en contestar
 */
async function conversar(guion, opts = {}) {
  const spy = {
    documentos: [], quoteEvents: [], eventos: [], textos: [], pdfs: [],
    // Cuantas veces se le pidio un precio al motor REAL (guardia de apertura + termico), que
    // es lo que se mide para saber si se le pregunto lo mismo dos veces.
    calculate: 0,
    // Concurrencia observada en el motor inyectado: si las sondas de B y C se piden en
    // paralelo, en algun momento hay 2 en vuelo.
    enVuelo: 0, maxEnVuelo: 0,
  };
  const _kv = new Map();
  const telefono = `5692222${String(1000 + (_telefonos += 1))}`;
  let paso = null;

  const deps = {
    conv: new Map(), seen: new Set(), locks: new Map(),
    dormir: async () => {},
    leerEstado: async (k) => _kv.get(k) ?? null,
    escribirEstado: (k, v) => _kv.set(k, v),
    parseInbound: () => ({
      ok: true, from: telefono, type: 'text', text: paso.texto,
      msgId: `wamid.EL.${Math.random()}`,
    }),
    sendWhatsAppText: async (_to, texto) => { spy.textos.push(String(texto || '')); return { ok: true }; },
    generatePdf: async (data, numero) => {
      spy.pdfs.push({ numero, color: data.items?.[0]?.color || null, opcion: data.opcion || null });
      return Buffer.from(`%PDF-1.4 ${numero}`);
    },
    uploadWaDocument: async () => 'media-eleccion',
    sendWaDocument: async (_to, _media, filename) => {
      const numero = String(filename).replace(/\.pdf$/, '');
      const ok = opts.entrega ? opts.entrega(numero) : true;
      if (ok) spy.documentos.push(numero);
      return ok ? { ok: true, msgId: `sent-${numero}` } : { ok: false, error: 'meta_rechazo' };
    },
    priceAllEngine: async (d) => {
      spy.enVuelo += 1;
      spy.maxEnVuelo = Math.max(spy.maxEnVuelo, spy.enVuelo);
      await new Promise((r) => setTimeout(r, Number(opts.demoraMotorMs) || 20));
      for (const it of d.items || []) {
        // El motor no sabe cotizar NINGUN color: el PDF sale con el precio que ya traia.
        if (opts.motorCaido) { it.confidence = 'manual'; it.price_warning = 'motor caido'; continue; }
        const p = PRECIO[it.color];
        if (!p) { it.confidence = 'manual'; continue; }
        it.unit_price = p; it.total_price = p * (Number(it.qty) || 1);
        it.source = 'activa_engine'; it.confidence = 'high';
        it.producto_label = it.product; it.glass_label = '4+12+4';
      }
      spy.enVuelo -= 1;
      return { ok: true, total: 0, source: 'activa_engine', escalate: false };
    },
    mediaIdsDisponibles: async () => ({}),
    upsertZohoDeal: async () => null,
    addZohoNote: async () => ({ ok: true }),
    attachPdfToDeal: async () => ({ ok: true }),
    notifyHighValue: async () => ({ sent: true }),
    loadSession: async () => null,
    persistSession: () => {},
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async (p) => { spy.eventos.push(p); return { ok: true }; },
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async (p) => { spy.quoteEvents.push(p); return { ok: true }; },
    },
    handleTurn: async ({ history, userText, state, toolCtx }) => {
      let r = { message: '' };
      if (paso.items) {
        r = await toolCtx.generarPdf({ name: 'Vanessa', comuna: 'Temuco', items: paso.items() });
      }
      const reply = r.message || 'listo';
      return {
        reply,
        history: [...(history || []),
          { role: 'user', content: userText }, { role: 'assistant', content: reply }],
        toolCalls: [{ name: 'generar_pdf_cotizacion', result: r }],
        state: { ...state },
      };
    },
  };

  const fetchOriginal = global.fetch;
  const envPrevio = {
    url: process.env.SALES_OS_URL, tok: process.env.SALES_OS_OPERATOR_TOKEN,
    pausa: process.env.OLIVER_PRESENCIA_HUMANA, anticipo: process.env.PROPUESTA_ANTICIPO_MS,
  };
  process.env.SALES_OS_URL = 'https://sales-os.test';
  process.env.SALES_OS_OPERATOR_TOKEN = 'test-token';
  process.env.OLIVER_PRESENCIA_HUMANA = 'false';
  process.env.PROPUESTA_ANTICIPO_MS = '1';
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/internal/quotes/next-number')) {
      return { ok: true, json: async () => ({ quote_number: 'CM-FR-004-2026-0392' }) };
    }
    // El motor REAL (guardia label-precio + termico) pega aca. Se cuenta para saber cuantas
    // veces se le pregunto lo mismo.
    if (u.includes('/api/quotes/calculate')) spy.calculate += 1;
    return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '{}' };
  };
  try {
    for (const p of guion) {
      paso = p;
      await handleWebhook({ body: {} }, makeRes(), deps);
    }
  } finally {
    global.fetch = fetchOriginal;
    for (const [k, v] of [['SALES_OS_URL', envPrevio.url], ['SALES_OS_OPERATOR_TOKEN', envPrevio.tok],
      ['OLIVER_PRESENCIA_HUMANA', envPrevio.pausa], ['PROPUESTA_ANTICIPO_MS', envPrevio.anticipo]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
  return spy;
}

/** Turno 1: el cliente no dice color y el LLM rellena Blanco, como en produccion. */
const TURNO_TERNA = {
  texto: 'hola, quiero cotizar una ventana corredera de 1500x1200',
  items: () => [{ ...ITEM_BASE, color: 'Blanco', unit_price: PRECIO.Blanco }],
};

/* ═══════════════════ 1. EL AVISO NO PUEDE MENTIR SOBRE EL COLOR ═══════════════════ */

test('🟠 si queda UNA sola y es New Black, el aviso dice New Black — no "Blanco"', async () => {
  // Es el caso que reprodujo Codex: se entrega solo la A (New Black) y fallan la B y la C.
  const spy = await conversar([TURNO_TERNA], { entrega: (n) => !/-[BC]$/.test(n) });
  assert.deepEqual(spy.documentos, ['CM-FR-004-2026-0392'], 'solo la A tenia que llegar');

  const cierre = spy.textos[spy.textos.length - 1] || '';
  assert.match(cierre, /Se la preparé en \*New Black\*/,
    `el aviso tiene que nombrar el color que el cliente RECIBIO — decia: ${cierre}`);
  assert.doesNotMatch(cierre, /preparé en \*Blanco\*/,
    'el cliente abre un PDF que dice New Black: decirle Blanco es mentirle');
  // Y no se le ofrece como alternativa el color que ya tiene en la mano.
  assert.doesNotMatch(cierre, /Si prefiere[^.]*New Black/,
    'ofrecerle el color que ya recibio se lee como que no leimos lo que le mandamos');
  assert.match(cierre, /Si prefiere[^.]*Nogal/, 'y si se le ofrecen los que no recibio');
});

test('🟠 si el motor no cotiza ningun color, el PDF sale Blanco y el aviso dice Blanco', async () => {
  // El otro extremo del mismo defecto: aca el documento SI es blanco (los items se rotulan
  // Blanco para que la etiqueta cuadre con el precio que ya traian) y el aviso tiene que
  // seguir diciendo Blanco. El arreglo no puede romper el caso que ya estaba bien.
  const spy = await conversar([TURNO_TERNA], { motorCaido: true });
  assert.deepEqual(spy.documentos, ['CM-FR-004-2026-0392'], 'solo la A');
  const cierre = spy.textos[spy.textos.length - 1] || '';
  assert.match(cierre, /Se la preparé en \*Blanco\*/, `decia: ${cierre}`);
});

/* ═════════════ 2. ELEGIR UNA OPCION YA OFRECIDA NO ES UNA COTIZACION NUEVA ═════════════ */

test('🟠💰 "me quedo con la B": UNA sola conversion, ni un folio nuevo', async () => {
  const spy = await conversar([
    TURNO_TERNA,
    {
      texto: 'me quedo con la B',
      // 🔴 EL LLM HACE LO QUE HACE EL DE VERDAD: re-cotiza en Nogal, que es lo que producia
      // el segundo documento y la segunda conversion.
      items: () => [{ ...ITEM_BASE, color: 'Nogal', unit_price: PRECIO.Nogal }],
    },
  ]);

  const sent = spy.quoteEvents.filter((e) => e.status === 'sent');
  assert.equal(sent.length, 1,
    `💰 a Meta/Google les llegaron ${sent.length} ventas cotizadas por UN cliente: ${sent.map((e) => `${e.quote_number}=${e.amount_total}`).join(' · ')}`);
  assert.equal(sent[0].quote_number, 'CM-FR-004-2026-0392', 'la unica conversion es la del turno de la terna');

  // Ni documento nuevo ni letra nueva: el cliente ya tiene la B en la mano.
  assert.deepEqual(spy.documentos, [
    'CM-FR-004-2026-0392', 'CM-FR-004-2026-0392-B', 'CM-FR-004-2026-0392-C',
  ], 'elegir entre lo que ya se le mando no emite otro documento');
  assert.ok(!spy.documentos.some((n) => n.endsWith('-D')), 'no se quema otra letra del correlativo');

  // La eleccion SI queda registrada — como evento de conversacion (append-only), no como un
  // upsert sobre la fila del folio: esa fila ya existe con su lead_id y su receptor/RUT, y
  // reescribirla desde aca con menos datos de los que tiene puede borrar el RUT con el que se
  // emitio un documento formal.
  const elegida = spy.eventos.filter((e) => e.metadata && e.metadata.elegida === true);
  assert.equal(elegida.length, 1, 'la eleccion del cliente tiene que quedar en el registro');
  assert.equal(elegida[0].metadata.quote_number, 'CM-FR-004-2026-0392-B');
  assert.equal(elegida[0].metadata.opcion, 'B');
  assert.equal(elegida[0].metadata.motivo, 'cliente_eligio_opcion');
  // ⛔ Y NINGUN evento de cotizacion nuevo en el segundo turno: cualquiera de los estados que
  // `fireConversion` mapea reportaria de nuevo a Meta/Google.
  assert.equal(spy.quoteEvents.filter((e) => e.quote_number === 'CM-FR-004-2026-0392-B'
    && e.variante && e.variante.motivo === 'cliente_eligio_opcion').length, 0);

  // Y el cliente se entera de que quedo con la B.
  const cierre = spy.textos[spy.textos.length - 1] || '';
  assert.match(cierre, /opción B/i, `el cierre no confirma la opcion elegida: ${cierre}`);
  assert.match(cierre, /Nogal/, 'ni de que color es');
  assert.match(cierre, /CM-FR-004-2026-0392-B/, 'ni con que folio');
  assert.doesNotMatch(cierre, /\$\s?\d{1,3}(?:[.,]\d{3})+/, 'REGLA #13: ningun monto suelto en el chat');
});

test('🟠💰 el cliente dice "la B" y el modelo rellena Blanco: manda la LETRA', async () => {
  // El caso mas peligroso, y el que obliga a que la letra gane sobre el color: el
  // system-prompt le ORDENA al modelo rellenar Blanco, asi que en el turno de la eleccion el
  // color que llega es el nuestro, no el del cliente. Resolviendo por color se daria por
  // elegida la opcion BLANCA cuando el cliente pidio la NOGAL.
  const spy = await conversar([
    TURNO_TERNA,
    { texto: 'ya, me quedo con la B', items: () => [{ ...ITEM_BASE, color: 'Blanco', unit_price: PRECIO.Blanco }] },
  ]);
  const elegida = spy.eventos.filter((e) => e.metadata && e.metadata.elegida === true);
  assert.equal(elegida.length, 1);
  assert.equal(elegida[0].metadata.quote_number, 'CM-FR-004-2026-0392-B',
    'la letra que escribio el cliente manda sobre el color que rellenamos nosotros');
  assert.equal(elegida[0].metadata.color, 'Nogal');
  assert.equal(spy.quoteEvents.filter((e) => e.status === 'sent').length, 1);
});

test('🔒 "la B pero de 2 metros" SI es un documento nuevo: cambio el proyecto', async () => {
  // El limite del arreglo. Si el pedido ya no es el mismo, dar la eleccion por buena dejaria
  // al cliente con un documento que no dice lo que pidio.
  const spy = await conversar([
    TURNO_TERNA,
    {
      texto: 'me quedo con la B pero de 2000x1200',
      items: () => [{ ...ITEM_BASE, measures: '2000x1200', color: 'Nogal', unit_price: PRECIO.Nogal }],
    },
  ]);
  assert.ok(spy.documentos.some((n) => n.endsWith('-D')),
    `un pedido distinto tiene que emitir su propio documento: ${spy.documentos.join(', ')}`);
  assert.equal(spy.eventos.filter((e) => e.metadata && e.metadata.elegida === true).length, 0,
    'no es una eleccion: es otra cotizacion');
});

/* ═══════════════ 3. NO HACER ESPERAR AL CLIENTE MAS DE LA CUENTA ═══════════════ */

test('⏱️ los precios de las otras dos se le piden al motor EN PARALELO', async () => {
  const spy = await conversar([TURNO_TERNA], { demoraMotorMs: 60 });
  assert.equal(spy.documentos.length, 3, 'las tres tienen que salir igual');
  assert.ok(spy.maxEnVuelo >= 2,
    `las sondas de B y C se pidieron una detras de otra (concurrencia maxima ${spy.maxEnVuelo}): `
    + 'encadenadas suman sus plazos y con el motor lento el cliente queda esperando');
});

test('⏱️ con terna, al motor no se le pregunta lo mismo dos veces', async () => {
  // La guardia label-precio y la recotizacion de la opcion A pedian lo mismo, seguidas, y el
  // resultado de la primera lo pisaba la segunda. Con la terna activa queda UNA sola llamada
  // al motor real: la del informe termico.
  const spy = await conversar([TURNO_TERNA]);
  assert.equal(spy.calculate, 1,
    `se le pidio ${spy.calculate} veces el precio al motor real; con la terna alcanza con la del termico`);
});

test('🔒 sin terna, la guardia label↔precio sigue corriendo (no se perdio la revision)', async () => {
  // El arreglo de latencia no puede llevarse por delante el blindaje que nacio del bug
  // 0064/0065/0066 (una FIJA salia con precio de CORREDERA, ~2x). Cuando el cliente SI dijo
  // el color no hay terna que re-cotice, asi que la guardia tiene que correr como siempre.
  const spy = await conversar([{
    texto: 'quiero una ventana corredera NOGAL de 1500x1200',
    items: () => [{ ...ITEM_BASE, color: 'Nogal', unit_price: PRECIO.Nogal }],
  }]);
  assert.equal(spy.documentos.length, 1, 'el cliente eligio color: sale una sola');
  assert.equal(spy.calculate, 2,
    'faltan llamadas al motor: la guardia de apertura y el termico tienen que correr las dos');
});

/* ═══════════════════════ LAS PIEZAS, POR SEPARADO ═══════════════════════ */

test('avisoColorNoElegido: nombra el color entregado y ofrece los otros cuatro', () => {
  const t = avisoColorNoElegido('New Black');
  assert.match(t, /\*New Black\*/);
  assert.doesNotMatch(t, /Si prefiere[^.]*New Black/);
  for (const c of ['Blanco', 'Nogal', 'Roble Dorado', 'Grafito Antracita']) {
    assert.ok(t.includes(c), `no se le ofrece ${c}`);
  }
  // "Negro" es como lo llama la lista de texto; el PDF lo imprime "New Black". Se le habla
  // con la grafia del documento que tiene en la mano.
  assert.ok(avisoColorNoElegido('Blanco').includes('New Black'));
});

test('colorDeCatalogo: reconoce los 5, y devuelve null cuando NO hay color', () => {
  assert.equal(colorDeCatalogo('blanco'), 'Blanco');
  assert.equal(colorDeCatalogo('NOGAL'), 'Nogal');
  assert.equal(colorDeCatalogo('roble dorado'), 'Roble Dorado');
  assert.equal(colorDeCatalogo('grafito antracita'), 'Grafito Antracita');
  assert.equal(colorDeCatalogo('negro'), 'New Black');
  assert.equal(colorDeCatalogo('new black'), 'New Black');
  // ⛔ Lo que `normColor` NO puede dar: distinguir "no dijo color" de "dijo blanco". De eso
  // depende que un pedido se trate como eleccion o como cotizacion nueva.
  assert.equal(colorDeCatalogo(''), null);
  assert.equal(colorDeCatalogo('quiero cotizar una ventana'), null);
});

test('letraElegidaEnTexto: exige contexto y solo devuelve letras ofrecidas', () => {
  assert.equal(letraElegidaEnTexto('me quedo con la B', ['A', 'B', 'C']), 'B');
  assert.equal(letraElegidaEnTexto('prefiero la opción C', ['A', 'B', 'C']), 'C');
  assert.equal(letraElegidaEnTexto('la alternativa a', ['A', 'B', 'C']), 'A');
  // Una letra suelta no alcanza: un falso positivo daria por elegida una propuesta que el
  // cliente no eligio.
  assert.equal(letraElegidaEnTexto('b', ['A', 'B', 'C']), null);
  // Una letra que nunca se ofrecio no resuelve a nada.
  assert.equal(letraElegidaEnTexto('me quedo con la D', ['A', 'B', 'C']), null);
  // Dos letras en el mismo mensaje es una duda, no una eleccion.
  assert.equal(letraElegidaEnTexto('dudo entre la B y la C', ['A', 'B', 'C']), null);
  assert.equal(letraElegidaEnTexto('me quedo con la B', []), null);
});

test('opcionYaEntregada: sin firma de proyecto, sin rastro o vencido → null', () => {
  const opciones = [
    { letra: 'A', color: 'New Black', numero: 'X-0392' },
    { letra: 'B', color: 'Nogal', numero: 'X-0392-B' },
    { letra: 'C', color: 'Blanco', numero: 'X-0392-C' },
  ];
  const lq = { at: Date.now(), opciones, sig_proyecto: 'FIRMA' };
  const base = { lastQuote: lq, texto: 'me quedo con la B', color: 'Blanco',
    sigProyecto: 'FIRMA', ventanaMs: 48 * 3600 * 1000 };

  assert.equal(opcionYaEntregada(base).numero, 'X-0392-B');
  // El proyecto cambio ⇒ no es una eleccion, es otra cotizacion.
  assert.equal(opcionYaEntregada({ ...base, sigProyecto: 'OTRA' }), null);
  // Rastro de una version anterior, sin firma guardada: no se adivina.
  assert.equal(opcionYaEntregada({ ...base, lastQuote: { ...lq, sig_proyecto: undefined } }), null);
  // Vencido.
  assert.equal(opcionYaEntregada({ ...base, lastQuote: { ...lq, at: Date.now() - 49 * 3600 * 1000 } }), null);
  // Sin terna (una sola opcion) no hay nada entre que elegir.
  assert.equal(opcionYaEntregada({ ...base, lastQuote: { ...lq, opciones: [opciones[0]] } }), null);
  // Sin letra, manda el color: y "negro" es la New Black.
  assert.equal(opcionYaEntregada({ ...base, texto: 'la quiero negra', color: 'Negro' }).letra, 'A');
  // Sin letra y sin color reconocible: null (nunca se elige por defecto).
  assert.equal(opcionYaEntregada({ ...base, texto: 'gracias', color: '' }), null);
});
