// webhook.propuestas-abc.test.js — [2026-08-31]
//
// LAS TRES PROPUESTAS A/B/C, CONTRA EL WEBHOOK ENTERO. Decision del dueño:
//   *"cuando cliente no entrega color entreguemosle blanco, nogal y negro"* +
//   *"entregar 3 propuestas tecnica economicas una blanco, nogal y new black"* +
//   *"identificando claramente cada una... pero le decimos a cliente cuel es cada una"*.
//
// POR QUE CONTRA EL WEBHOOK Y NO SOLO CONTRA EL GATE: la leccion del 29-ago. El gate del color
// se desplego el 25-ago con tests verdes y fue CODIGO MUERTO cuatro dias — no disparo NI UNA
// vez en 852 sesiones— porque los tests simulaban un mundo (items sin color) que en produccion
// no existe: el system-prompt le ORDENA al modelo rellenar Blanco. Un test que simula un mundo
// mas indulgente que el real no prueba nada. Por eso aca el LLM falso hace lo que hace el de
// verdad: manda `color: 'Blanco'` sin que el cliente lo haya dicho.
//
// LO QUE SE MIDE, y por que cada cosa:
//   1. Salen TRES documentos con TRES folios distintos (A, -B, -C) → el pisado por numero del
//      caso Paula no puede volver.
//   2. Cada uno con SU precio del motor para SU color → un documento formal no puede llevar la
//      etiqueta de un color y el precio de otro.
//   3. UNA sola conversion 'sent'; las otras dos 'alternativa' → 💰 reportarle tres
//      quote_sent a Meta/Google por un cliente le enseña al algoritmo que ese trafico convierte
//      el triple, y el algoritmo reparte el presupuesto con eso.
//   4. El mensaje le dice al cliente cual es cual.
//   5. Si una falla, las otras salen igual y queda registrado cual fallo.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleWebhook } from './webhook.js';

function makeRes() { return { sendStatus() { return this; } }; }

// Precio por color, DISTINTO en cada uno — como en la lista real (medido en el motor sobre el
// marco doble riel S70: Blanco $30.385 · Nogal $49.974 · New Black $54.356).
const PRECIO = { Blanco: 300000, Nogal: 430000, 'New Black': 465000 };

/**
 * @param {object} opts
 * @param {(numero:string)=>boolean} [opts.entrega]  false para simular un envio fallido
 * @param {boolean} [opts.motorCaido]  el motor no cotiza los colores alternativos
 * @param {string}  [opts.colorSinPrecio]  el motor se cae SOLO para ese color
 */
// Un telefono distinto por corrida: `RECENT_QUOTES` es un Map de MODULO (guard anti-doble
// folio de 2 min) y se comparte entre los tests del archivo — con el mismo numero, el segundo
// test caeria en el dedupe y no emitiria nada.
let _telefonos = 0;

function armar(opts = {}) {
  const spy = { documentos: [], quoteEvents: [], textos: [], pdfs: [] };
  const _kv = new Map();
  const telefono = `5691111${String(1000 + (_telefonos += 1))}`;
  const deps = {
    conv: new Map(), seen: new Set(), locks: new Map(),
    dormir: async () => {},
    leerEstado: async (k) => _kv.get(k) ?? null,
    escribirEstado: (k, v) => _kv.set(k, v),
    parseInbound: () => ({
      ok: true, from: telefono, type: 'text',
      // El cliente nombra la apertura (para que el gate de la apertura no se meta) y NO
      // nombra ningun color: es el caso que dispara la terna.
      text: 'hola, quiero cotizar una ventana corredera de 1500x1200',
      msgId: `wamid.ABC.${Math.random()}`,
    }),
    sendWhatsAppText: async (_to, texto) => { spy.textos.push(String(texto || '')); return { ok: true }; },
    generatePdf: async (data, numero) => {
      spy.pdfs.push({ numero, opcion: data.opcion || null, color: data.items?.[0]?.color || null,
        unit_price: data.items?.[0]?.unit_price || 0 });
      return Buffer.from(`%PDF-1.4 ${numero}`);
    },
    uploadWaDocument: async () => 'media-abc',
    sendWaDocument: async (_to, _media, filename) => {
      const numero = String(filename).replace(/\.pdf$/, '');
      const ok = opts.entrega ? opts.entrega(numero) : true;
      if (ok) spy.documentos.push(numero);
      return ok ? { ok: true, msgId: `sent-${numero}` } : { ok: false, error: 'meta_rechazo' };
    },
    // El motor de precios, FALSO pero fiel: cotiza cada color a un precio distinto, que es la
    // condicion sin la cual estas tres propuestas no tendrian sentido.
    priceAllEngine: async (d) => {
      for (const it of d.items || []) {
        if (opts.motorCaido) { it.confidence = 'manual'; it.price_warning = 'motor caido'; continue; }
        // [2026-08-31] El motor puede caerse SOLO para un color. Es el caso adversarial que
        // encontro Copilot en el tridente y que la opcion A no manejaba.
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
    mediaIdsDisponibles: async () => ({}),   // sin video de cortesia: no es lo que se mide aca
    upsertZohoDeal: async () => null,
    addZohoNote: async () => ({ ok: true }),
    attachPdfToDeal: async () => ({ ok: true }),
    notifyHighValue: async () => ({ sent: true }),
    loadSession: async () => null,
    persistSession: () => {},
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({ ok: true }),
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async (p) => { spy.quoteEvents.push(p); return { ok: true }; },
    },
    handleTurn: async ({ userText, state, toolCtx }) => {
      // 🔴 EL LLM HACE LO QUE HACE EL DE VERDAD: rellena 'Blanco' porque el system-prompt se
      // lo ordena, aunque el cliente NO lo dijo. Ese es el caso de produccion.
      const r = await toolCtx.generarPdf({
        name: 'Vanessa', comuna: 'Temuco',
        items: [{ producto_label: 'Corredera SLIDING H80', product: 'Corredera SLIDING H80',
          measures: '1500x1200', color: 'Blanco', qty: 1, unit_price: PRECIO.Blanco,
          glass_label: '4+12+4' }],
      });
      return {
        reply: r.message,
        history: [{ role: 'user', content: userText }, { role: 'assistant', content: r.message || '' }],
        toolCalls: [{ name: 'generar_pdf_cotizacion', result: r }],
        state: { ...state },
      };
    },
  };
  return { deps, spy };
}

async function correr(opts) {
  const { deps, spy } = armar(opts);
  const fetchOriginal = global.fetch;
  const envPrevio = {
    url: process.env.SALES_OS_URL, tok: process.env.SALES_OS_OPERATOR_TOKEN,
    pausa: process.env.OLIVER_PRESENCIA_HUMANA, anticipo: process.env.PROPUESTA_ANTICIPO_MS,
  };
  process.env.SALES_OS_URL = 'https://sales-os.test';
  process.env.SALES_OS_OPERATOR_TOKEN = 'test-token';
  process.env.OLIVER_PRESENCIA_HUMANA = 'false';   // sin pausas de tipeo: aca se mide logica
  process.env.PROPUESTA_ANTICIPO_MS = '1';
  global.fetch = async (url) => {
    if (String(url).includes('/internal/quotes/next-number')) {
      return { ok: true, json: async () => ({ quote_number: 'CM-FR-004-2026-0392' }) };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  };
  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
  } finally {
    global.fetch = fetchOriginal;
    for (const [k, v] of [['SALES_OS_URL', envPrevio.url], ['SALES_OS_OPERATOR_TOKEN', envPrevio.tok],
      ['OLIVER_PRESENCIA_HUMANA', envPrevio.pausa], ['PROPUESTA_ANTICIPO_MS', envPrevio.anticipo]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
  return spy;
}

/* ========================================================================= */

test('🔴 sin color: salen TRES propuestas, con TRES folios distintos', async () => {
  const spy = await correr();
  assert.deepEqual(spy.documentos, [
    'CM-FR-004-2026-0392', 'CM-FR-004-2026-0392-B', 'CM-FR-004-2026-0392-C',
  ], `documentos entregados: ${JSON.stringify(spy.documentos)}`);
  // Un solo correlativo ISO quemado: las otras dos son LETRAS.
  assert.equal(new Set(spy.documentos.map((n) => n.replace(/-[A-Z]$/, ''))).size, 1);
});

test('🔴 A = New Black, B = Nogal, C = Blanco, cada una con SU precio del motor', async () => {
  // [2026-08-31] DEL MAS CARO AL MAS ECONOMICO. Este test tenia el orden al reves y
  // consagraba una version que contradecia al dueno. Su decision es de ANCLAJE: mostrar
  // primero el caro deja al blanco leyendose como "la economica", no como la referencia.
  const spy = await correr();
  const porNumero = Object.fromEntries(spy.pdfs.map((p) => [p.numero, p]));
  const esperado = [
    ['CM-FR-004-2026-0392', 'A', 'New Black'],
    ['CM-FR-004-2026-0392-B', 'B', 'Nogal'],
    ['CM-FR-004-2026-0392-C', 'C', 'Blanco'],
  ];
  for (const [numero, letra, color] of esperado) {
    const p = porNumero[numero];
    assert.ok(p, `no se genero el PDF ${numero}`);
    assert.equal(p.color, color, `${numero} tiene que ser ${color}`);
    // ⛔ El precio de un Nogal NO se deriva del blanco: se le pide al motor. Un documento
    // formal con la etiqueta de un color y el precio de otro es peor que no mandarlo.
    assert.equal(p.unit_price, PRECIO[color], `${numero} lleva el precio de otro color`);
    // Y el PDF se identifica SOLO: el cliente lo abre y ve de que color es sin volver al chat.
    assert.ok(p.opcion, `${numero} no lleva el rotulo de opcion en el documento`);
    assert.equal(p.opcion.letra, letra);
    assert.equal(p.opcion.color, color);
  }
});

test('🔴💰 UNA sola conversion: tres quote_sent por un cliente le mienten al algoritmo', async () => {
  const spy = await correr();
  const sent = spy.quoteEvents.filter((e) => e.status === 'sent');
  const alt  = spy.quoteEvents.filter((e) => e.status === 'alternativa');
  assert.equal(sent.length, 1, `debe haber UNA sola conversion, hubo ${sent.length}`);
  assert.equal(sent[0].quote_number, 'CM-FR-004-2026-0392', 'la conversion es la de la opcion A');
  assert.equal(sent[0].amount_total, PRECIO.Blanco, 'y con el mismo valor que tenia la blanca de antes');
  assert.equal(alt.length, 2, 'las otras dos quedan registradas, sin disparar conversion');
  // 'alternativa' NO esta en el statusMap de fireConversion (sales-os/src/server.js:539), asi
  // que guarda la fila y no reporta nada. Si alguien lo cambia a 'sent', esto se pone rojo.
  for (const e of alt) {
    assert.ok(/-[BC]$/.test(e.quote_number), 'la alternativa lleva su propia letra');
    assert.ok(e.variante && e.variante.color, 'y dice de que variante es');
    assert.equal(e.variante.motivo, 'cliente_no_declaro_color');
    assert.ok(!e.gclid && !e.fbclid && !e.ctwa_clid && !e.ttclid,
      'sin click-ids: no dispara conversion y no debe invitar a que alguien la dispare');
  }
});

test('🔴 cada propuesta cae en SU FILA de `quotes` (el pisado del caso Paula no vuelve)', async () => {
  const spy = await correr();
  const numeros = spy.quoteEvents.map((e) => e.quote_number);
  assert.equal(new Set(numeros).size, numeros.length,
    `dos eventos con el mismo numero: la fila se busca por (tenant_id, quote_number) y el segundo pisa al primero — ${numeros.join(', ')}`);
  // Y cada fila guarda su color, que es lo que hacia falta para poder respaldar despues la
  // cotizacion que el cliente tiene en la mano.
  for (const e of spy.quoteEvents) {
    assert.ok(e.items?.[0]?.color, `${e.quote_number} no guarda el color de lo cotizado`);
  }
});

test('🔴 el mensaje le dice al cliente CUAL ES CUAL', async () => {
  const spy = await correr();
  const todo = spy.textos.join('\n---\n');
  for (const c of ['Blanco', 'Nogal', 'New Black']) {
    assert.ok(todo.includes(c), `el cliente no se entera de la opcion ${c}`);
  }
  for (const n of ['CM-FR-004-2026-0392-B', 'CM-FR-004-2026-0392-C']) {
    assert.ok(todo.includes(n), `no se nombra el folio ${n}: es como distingue los archivos`);
  }
  assert.match(todo, /color cambia el precio/i, 'y que el color cambia el precio');
  // [2026-08-31] El texto que el dueno APROBO TEXTUAL rotula "A — New Black", no
  // "Opcion A". Este assert pedia el formato viejo. Lo que importa no es la palabra
  // "Opcion" sino que cada letra este pegada a SU color, que es el pedido explicito:
  // "le decimos a cliente cual es cada una".
  for (const [letra, color] of [['A', 'New Black'], ['B', 'Nogal'], ['C', 'Blanco']]) {
    assert.match(todo, new RegExp(`${letra}\\s*[\\u2014-]\\s*${color}`),
      `la letra ${letra} tiene que decir que es ${color}`);
  }
  // ⛔ REGLA #13: ningun monto suelto en el chat. Se comprueba sobre TODO lo que salio.
  assert.doesNotMatch(todo, /\$\s?\d{1,3}(?:[.,]\d{3})+/, 'un precio se coló al chat');
});

test('🛟 si UNA falla, las otras salen igual y queda registrado cual fallo', async () => {
  // Instruccion explicita: el cliente nunca se queda sin nada por un error parcial.
  const spy = await correr({ entrega: (n) => !n.endsWith('-B') });
  assert.deepEqual(spy.documentos, ['CM-FR-004-2026-0392', 'CM-FR-004-2026-0392-C'],
    'la C tiene que salir aunque la B se haya caido');
  const b = spy.quoteEvents.find((e) => e.quote_number.endsWith('-B'));
  assert.ok(b, 'la B se emitio: tiene folio y tiene que quedar en el registro');
  assert.equal(b.variante.pdf_sent, false, 'y queda registrado que NO se entrego');
  // Y no se le promete al cliente un archivo que no le llego.
  const todo = spy.textos.join('\n');
  assert.ok(!todo.includes('CM-FR-004-2026-0392-B'), 'no se nombra la propuesta que no salio');
  // 🔴 EL HUECO QUE ESTE TEST CAZO: el aviso PREVIO le anuncia los tres colores antes de
  // mandarlos (no puede adivinar cual va a fallar), asi que el cliente queda esperando el
  // Nogal. El cierre tiene que ofrecerselo — si no, es una promesa rota.
  const cierre = spy.textos[spy.textos.length - 1] || '';
  assert.match(cierre, /prefiere[^.]*Nogal/i,
    'si el Nogal no salio, el cierre tiene que ofrecerlo: se lo habiamos anunciado');
});

test('🛟 si el motor no cotiza los otros colores, sale la A sola y CON aviso', async () => {
  // Nunca un documento con la etiqueta de un color y el precio de otro. Y el cliente no puede
  // quedarse con una blanca sin enterarse de que el color no lo eligio el: ahi vuelve el aviso.
  const spy = await correr({ motorCaido: true });
  assert.deepEqual(spy.documentos, ['CM-FR-004-2026-0392'], 'solo la A');
  assert.equal(spy.quoteEvents.filter((e) => e.status === 'alternativa').length, 0,
    'no se registra una propuesta que nunca se emitio');
  const todo = spy.textos.join('\n');
  assert.match(todo, /Blanco/, 'se le dice que va en Blanco');
  assert.match(todo, /recotiz/i, 'y que se puede cambiar sin costo');
});

test('🔒 si el cliente SI dijo el color, sale UNA sola — como siempre', async () => {
  const { deps, spy } = armar();
  deps.parseInbound = () => ({
    ok: true, from: `5691111${String(2000 + (_telefonos += 1))}`, type: 'text',
    text: 'quiero una ventana corredera NOGAL de 1500x1200',
    msgId: `wamid.NOGAL.${Math.random()}`,
  });
  deps.handleTurn = async ({ userText, state, toolCtx }) => {
    const r = await toolCtx.generarPdf({
      name: 'Vanessa', comuna: 'Temuco',
      items: [{ producto_label: 'Corredera SLIDING H80', product: 'Corredera SLIDING H80',
        measures: '1500x1200', color: 'Nogal', qty: 1, unit_price: PRECIO.Nogal, glass_label: '4+12+4' }],
    });
    return { reply: r.message, history: [{ role: 'user', content: userText }],
      toolCalls: [{ name: 'generar_pdf_cotizacion', result: r }], state: { ...state } };
  };
  const fetchOriginal = global.fetch;
  const prev = { url: process.env.SALES_OS_URL, pausa: process.env.OLIVER_PRESENCIA_HUMANA };
  process.env.SALES_OS_URL = 'https://sales-os.test';
  process.env.OLIVER_PRESENCIA_HUMANA = 'false';
  global.fetch = async (url) => (String(url).includes('/internal/quotes/next-number')
    ? { ok: true, json: async () => ({ quote_number: 'CM-FR-004-2026-0393' }) }
    : { ok: true, json: async () => ({ ok: true }) });
  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
  } finally {
    global.fetch = fetchOriginal;
    if (prev.url === undefined) delete process.env.SALES_OS_URL; else process.env.SALES_OS_URL = prev.url;
    if (prev.pausa === undefined) delete process.env.OLIVER_PRESENCIA_HUMANA; else process.env.OLIVER_PRESENCIA_HUMANA = prev.pausa;
  }
  assert.equal(spy.documentos.length, 1, `una propuesta con el color correcto es mejor que tres: ${spy.documentos.join(', ')}`);
  assert.equal(spy.quoteEvents.filter((e) => e.status === 'alternativa').length, 0);
  assert.ok(!spy.pdfs[0].opcion, 'y el documento sale sin rotulo de opcion, como siempre');
});

test('🔴💰 TRIDENTE/Copilot: si el motor no cotiza el color de la A, la A NO sale con el precio de otro', async () => {
  // Lo encontro Copilot atacando el arreglo anterior: cuando el motor fallaba SOLO para el
  // color de la opcion A, el `try/catch` dejaba pasar el precio que ya venia y el PDF salia
  // rotulado "New Black" con el precio del Blanco ($300.000 en vez de $465.000). O sea el
  // mismo defecto que se acababa de arreglar, volviendo por la puerta del error.
  // Las opciones B y C ya se descartaban solas en ese caso; la A era la unica excepcion.
  // Ahora la A rota al primer color que el motor SI sepa cotizar.
  const spy = await correr({ colorSinPrecio: 'New Black' });
  const porNumero = Object.fromEntries(spy.pdfs.map((p) => [p.numero, p]));
  const a = porNumero['CM-FR-004-2026-0392'];
  assert.ok(a, 'la propuesta principal tiene que salir igual: nunca se frena al cliente');
  assert.notEqual(a.color, 'New Black', 'el color que el motor no supo cotizar NO puede salir');
  assert.equal(a.unit_price, PRECIO[a.color],
    `la A salio rotulada ${a.color} con el precio de otro color`);
  // Y ningun documento puede llevar una etiqueta que no cuadre con su precio.
  for (const p of spy.pdfs) {
    assert.equal(p.unit_price, PRECIO[p.color], `${p.numero}: etiqueta ${p.color} con precio de otro`);
  }
  // El color que no se pudo cotizar tampoco se le promete al cliente.
  const todo = spy.textos.join(String.fromCharCode(10));
  assert.doesNotMatch(todo, /New Black/, 'no se nombra un color que no se pudo cotizar');
});
