// webhook.vientos.test.js — [2026-10-05]
//
// "SOLO ESTA SALIENDO COTIZACIONES E INFORME TERMICO" — reclamo del dueño, 05-oct. El informe
// de vientos no estaba desconectado: se perdia por TRES caminos, y cada uno tiene su guardia
// aca. Regla del dueño (30-sep): primero los informes, despues la propuesta, sin perder el orden.
//
//   A · el cliente escribe en medio de la secuencia ⇒ el de vientos se cortaba "para el proximo
//       turno", que no existe (propuesta 0590, 04-oct).
//   B · ventanas sin vidrio legible aunque el motor SI lo eligio (propuesta 0588, 03-oct). La
//       regla del vidrio se prueba unitaria en services/vidrioCotizado.test.js; aca, el cableado.
//   C · el de vientos solo se intentaba si el termico salia 'enviado': con el termico 'fallo',
//       'ya_enviado' o 'timeout' no se intentaba aunque el cliente nunca lo hubiera recibido.
//
// Hermetico: `global.fetch` falso (correlativo + MOTOR DE PRECIOS FALSO) y `ACTIVA_ENGINE_URL`
// apuntando a un host de prueba, asi que nada puede salir a produccion aunque algo se escape.

import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook, huellaDelInforme } from './webhook.js';

process.env.ACTIVA_ENGINE_URL = 'http://motor.test';

// El motor FALSO: el precio y el Uw dependen del vidrio que el propio motor elige (por area,
// como `pickGlassId`: 34 = 4+12+4 · 61 = 5+12+5 · 38 = satén), igual que en produccion.
const PRECIO_VIDRIO = { 34: 100000, 38: 120000, 61: 130000 };
const UW_VIDRIO = { 34: 2.68, 38: 2.66, 61: 2.7 };
let motorCaido = false;

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/internal/quotes/next-number')) {
    return { ok: true, status: 200, json: async () => ({ quote_number: 'CM-FR-004-2026-9999' }) };
  }
  if (u.startsWith('http://motor.test/api/quotes/calculate')) {
    if (motorCaido) return { ok: false, status: 503, text: async () => '{}', json: async () => ({}) };
    const b = JSON.parse(opts.body || '{}');
    const g = Number(b.glass_id);
    const cuerpo = { ok: true, total_clp: (PRECIO_VIDRIO[g] || 0) * (Number(b.cantidad) || 1), termico: { uw: UW_VIDRIO[g] } };
    return { ok: true, status: 200, text: async () => JSON.stringify(cuerpo), json: async () => cuerpo };
  }
  return { ok: false, status: 503, text: async () => '{}', json: async () => ({}) };
};

// Las mismas dos ventanas del arnes de la secuencia, con el precio y el vidrio que les da el
// motor falso (las dos pasan los 2 m² ⇒ 5+12+5): asi la regla del vidrio no cambia nada aca.
const VENTANAS = [
  { producto: 'Ventana PVC S60 corredera', medidas: '2000x1400mm', vidrio: '5+12+5', ambiente: 'Living', cantidad: 1, precio: 130000 },
  { producto: 'Ventana PVC H98 corredera 3 hojas', medidas: '3250x1460mm', vidrio: '5+12+5', ambiente: 'Dormitorio', cantidad: 1, precio: 130000 },
];
const itemsDe = (lista) => lista.map((v) => ({
  product: v.producto, producto_label: v.producto, measures: v.medidas, measures_original: v.medidas,
  ...(v.vidrio === undefined ? {} : { glass_label: v.vidrio }), ambiente: v.ambiente || '',
  qty: v.cantidad, unit_price: v.precio, total_price: v.precio * v.cantidad, color: v.color || 'Nogal', pos: v.pos,
}));

let SEQ = 0;
const makeRes = () => ({ sendStatus() { return this; } });

/** Arnes minimo: KV en memoria, envios a una linea de tiempo, THERMAL y PDFs falsos. */
function armar({ informeEnvio = { ok: true, msgId: 'doc.1' }, informeCuelga = false, ventanas = VENTANAS, nombre = 'Dady' } = {}) {
  const telefono = `5697${String(++SEQ).padStart(7, '0')}`;
  const spy = { linea: [], textos: [], propuestas: [], vientos: [] };
  const estado = new Map();
  let tok = 0;
  const vigente = (e) => e && (!e.expira || e.expira > Date.now());
  const poner = (k, v, ttl = 300) => { estado.set(k, { valor: v, expira: Date.now() + ttl * 1000 }); };
  const deps = {
    conv: new Map(), seen: new Set(), locks: new Map(),
    dormir: async () => {},
    secuenciaInformePrimero: () => true,
    seqInformeTimeoutMs: 400,
    leerEstado: async (k) => (vigente(estado.get(k)) ? estado.get(k).valor : null),
    escribirEstado: poner,
    escribirEstadoDurable: async (k, v, ttl) => { poner(k, v, ttl); return { ok: true }; },
    fusionarEstado: (k, calc, ttl = 300) => {
      const e = estado.get(k); const actual = vigente(e) ? e.valor : null;
      const { valor, guardar } = calc(actual) || {};
      if (guardar && valor != null) poner(k, valor, ttl);
      return valor === undefined ? actual : valor;
    },
    reservarEstado: (k, ttl = 300) => { if (vigente(estado.get(k))) return null; const t = `t${++tok}`; poner(k, t, ttl); return t; },
    liberarReserva: (k, t) => { const e = estado.get(k); if (!t || !vigente(e) || e.valor !== t) return false; estado.delete(k); return true; },
    parseInbound: () => ({ ok: true, from: telefono, text: `soy ${nombre}, dos ventanas correderas`, msgId: `wamid.${Math.random()}`, type: 'text' }),
    sendWhatsAppText: async (to, t) => { spy.textos.push(String(t)); spy.linea.push('texto'); return { ok: true, msgId: `m${spy.linea.length}` }; },
    pedirInformeComuna: async () => ({ comuna: 'Temuco', regimen: 'PDA', uw_max_Wm2K: 3.2, zona_termica_NCh1079: 'F', criterio_ref: 'PDA' }),
    generarInformeTermicoPdf: async () => (informeCuelga ? new Promise(() => {}) : Buffer.alloc(1024, 7)),
    laminasParaInforme: async () => null,
    laminaTermopanel: async () => null,
    saveMedia: async () => ({ ok: true }),
    upsertZohoDeal: async () => 'deal.1',
    addZohoNote: async () => ({ ok: true }),
    attachPdfToDeal: async () => ({ ok: true }),
    generatePdf: async (data) => { spy.propuestas.push(data); return Buffer.alloc(2048, 3); },
    uploadWaDocument: async () => 'media.1',
    sendWaDocument: async (to, mediaId, filename) => {
      const tipo = /^Informe-Vientos/.test(filename || '') ? 'vientos' : (/^Informe-Termico/.test(filename || '') ? 'informe' : 'propuesta');
      spy.linea.push(tipo);
      if (tipo === 'informe') return informeEnvio;
      return { ok: true, msgId: `${tipo}.1` };
    },
    mediaIdsDisponibles: async () => ({ presentacion: 'wamedia.video.1' }),
    sendWaVideo: async () => { spy.linea.push('video'); return { ok: true, msgId: 'vid.1' }; },
    pedirVientos: async ({ ventanas: vs }) => {
      spy.vientos.push(vs);
      return {
        ventanas: vs.map((v) => ({ nombre: v.nombre, ancho_mm: v.ancho_mm, alto_mm: v.alto_mm, cantidad: v.cantidad,
          capacidad: { lr_corta_kPa: 1.89 }, veredicto: { evaluable: true, cumple_corta: true } })),
        demanda: { presion_kPa: 0.675 },
      };
    },
    generarInformeVientosPdf: async () => Buffer.alloc(512, 9),
    handleTurn: async ({ state, toolCtx }) => {
      await toolCtx.generarPdf({ items: itemsDe(ventanas), comuna: 'Temuco', name: nombre });
      return { reply: 'Listo', history: [], toolCalls: [], state: { ...state, name: nombre } };
    },
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({ ok: true }),
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async () => ({ ok: true }),
    },
    notifyHighValue: async () => ({ sent: true }),
  };
  return { deps, spy, telefono, estado };
}

async function esperar(cond, ms = 8000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return true;
    await new Promise((r) => { setTimeout(r, 10); });
  }
  return false;
}
const pos = (spy, t) => spy.linea.indexOf(t);
const cuenta = (spy, t) => spy.linea.filter((x) => x === t).length;

/* ── A · el cliente escribe en medio de la secuencia ─────────────────────────────────── */

test('🌬️ A [caso 0590] el cliente ESCRIBE durante la secuencia ⇒ el de vientos sale IGUAL, antes de la propuesta y una sola vez', async () => {
  // 🔁 Da vuelta la mitad de la decision del 03-sep (85a7dd6) que cortaba el de vientos "para
  // el proximo turno": ese turno no existe, el informe solo sale desde `generarPdf`. El VIDEO
  // de cortesia se sigue cortando. Orden del dueño (30-sep): informes antes de la propuesta.
  const { deps, spy, telefono } = armar();
  const textos = ['soy Dady, dos ventanas correderas', 'Usted de donde son'];
  let llegados = 0;
  deps.parseInbound = () => ({ ok: true, from: telefono, text: textos[Math.min(llegados++, 1)], msgId: `wamid.${Math.random()}`, type: 'text' });
  const turnoConPdf = deps.handleTurn;
  let respondioSinPdf = false;
  deps.handleTurn = async (args) => {
    if (!/de donde/i.test(String(args.userText || ''))) return turnoConPdf(args);
    respondioSinPdf = true;   // el turno real: contesta la pregunta y NO emite PDF
    return { reply: 'Somos de Temuco.', history: [], toolCalls: [], state: args.state };
  };
  // El cliente escribe JUSTO cuando le llega el termico: el webhook real numera su mensaje al
  // llegar (antes del lock) y lo deja esperando el lock del turno que esta mandando.
  const enviar = deps.sendWaDocument;
  let segundo = null;
  deps.sendWaDocument = async (to, m, filename, cap) => {
    const r = await enviar(to, m, filename, cap);
    if (!segundo && /^Informe-Termico/.test(filename || '')) segundo = handleWebhook({ body: {} }, makeRes(), deps);
    return r;
  };

  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0), 'la propuesta sale siempre');
  assert.ok(segundo, 'control: el mensaje del cliente llego en medio de la secuencia');
  await segundo;
  assert.ok(await esperar(() => respondioSinPdf), 'control: el turno siguiente corrio y NO pidio PDF');

  assert.equal(cuenta(spy, 'vientos'), 1, `sin informe de vientos para siempre — linea: ${JSON.stringify(spy.linea)}`);
  assert.ok(pos(spy, 'informe') < pos(spy, 'vientos') && pos(spy, 'vientos') < pos(spy, 'propuesta'),
    `termico → vientos → propuesta — linea: ${JSON.stringify(spy.linea)}`);
  assert.equal(cuenta(spy, 'video'), 0, 'el video de cortesia SI se sigue cortando');
});

/* ── B · el vidrio del motor llega a la propuesta y al informe (cableado) ────────────── */

test('🌬️ B [caso 0588] el vidrio con que el MOTOR cotizo llega a la propuesta y al motor de vientos — aunque el LLM no lo mande o mande "Termopanel DVH"', async () => {
  // 0588 (03-oct): el LLM armo el PDF sin `glass_label` ⇒ propuesta "Termopanel DVH", BD
  // `vidrio: null`, vientos `sin_datos`. Y "Termopanel DVH" a secas (el ejemplo de la tool) no
  // dice espesor: tampoco se puede calcular. Las dos variantes, una por ventana.
  const { deps, spy } = armar({ ventanas: [
    { producto: 'Corredera SLIDING H98 Doble Riel S75', medidas: '2000x2000', vidrio: 'Termopanel DVH', cantidad: 2, precio: 130000, color: 'New Black', pos: 1 },
    { producto: 'Corredera SLIDING H80 Doble Riel S75', medidas: '1500x1000', cantidad: 3, precio: 100000, color: 'New Black', pos: 2 },
  ] });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0), 'la propuesta sale');

  const a = spy.propuestas[0];
  assert.deepEqual(a?.items.map((i) => i.glass_label), ['5+12+5', '4+12+4'], 'la propuesta imprime el vidrio que se cobro');
  assert.deepEqual(a?.items.map((i) => i.termico?.uw), [2.7, 2.68], 'control: el Uw impreso es el de ESE vidrio');
  assert.ok(pos(spy, 'vientos') >= 0, `el informe de vientos tiene que salir — linea: ${JSON.stringify(spy.linea)}`);
  const vs = spy.vientos.at(-1) || [];
  assert.deepEqual(vs.map((w) => [w.ventana_ancho_mm, w.vidrio?.ext_mm, w.vidrio?.camara_mm, w.vidrio?.int_mm]),
    [[2000, 5, 12, 5], [1500, 4, 12, 4]], 'al motor de vientos le llega el MISMO vidrio de la propuesta');
});

test('🌬️ B [anti-alucinacion] con el motor CAIDO no se inventa vidrio: la propuesta sale, el de vientos no', async () => {
  motorCaido = true;
  try {
    const { deps, spy } = armar({ ventanas: [
      { producto: 'Corredera SLIDING H98 Doble Riel S75', medidas: '2000x2000', cantidad: 2, precio: 130000, color: 'New Black' },
    ] });
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0), 'la propuesta sale igual');
    assert.equal(spy.vientos.length, 0, 'sin vidrio cotizado no se le pide nada al motor de vientos');
    assert.equal(spy.propuestas[0]?.items[0]?.glass_label, 'Termopanel DVH', 'sin espesor inventado');
  } finally { motorCaido = false; }
});

/* ── C · el de vientos no depende de como le fue al termico ──────────────────────────── */

const huellaUltima = () => huellaDelInforme({ comuna: 'Temuco', producto: VENTANAS.at(-1).producto, glassLabel: VENTANAS.at(-1).vidrio });

for (const [caso, preparar] of [
  ['fallo (Meta rechaza el termico)', () => armar({ informeEnvio: { ok: false, error: 'rechazo', status: 400, code: 131047 } })],
  ['ya_enviado (candado del termico vigente)', () => {
    const x = armar();
    x.deps.escribirEstado(`informe_termico:${x.telefono}:${huellaUltima()}`, { at: Date.now() - 3600_000 }, 3000);
    return x;
  }],
  ['timeout (el termico se cuelga)', () => armar({ informeCuelga: true })],
]) {
  test(`🌬️ C termico '${caso}' y el cliente SIN informe de vientos ⇒ el de vientos sale igual, antes de la propuesta`, async () => {
    // Antes: solo se intentaba si el termico devolvia 'enviado' (o 'no_seleccionado'). Su
    // propio candado y el selector de documentos ya deciden si corresponde; el termico no.
    const { deps, spy } = preparar();
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0), 'la propuesta sale siempre');
    assert.equal(cuenta(spy, 'vientos'), 1, `el de vientos no salio — linea: ${JSON.stringify(spy.linea)}`);
    assert.ok(pos(spy, 'vientos') < pos(spy, 'propuesta'), `informes antes de la propuesta — linea: ${JSON.stringify(spy.linea)}`);
  });
}

test('🌬️ C control: el de vientos YA recibido (su candado vigente) no se repite aunque el termico falle', async () => {
  const x = armar({ informeEnvio: { ok: false, error: 'rechazo', status: 400, code: 131047 } });
  x.deps.escribirEstado(`informe_vientos:${x.telefono}:${huellaUltima()}`, { at: Date.now() - 3600_000 }, 3000);
  await handleWebhook({ body: {} }, makeRes(), x.deps);
  assert.ok(await esperar(() => pos(x.spy, 'propuesta') >= 0));
  assert.equal(cuenta(x.spy, 'vientos'), 0, 'su propio candado manda');
});
