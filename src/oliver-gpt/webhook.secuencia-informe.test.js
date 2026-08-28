// webhook.secuencia-informe.test.js — [2026-08-27]
//
// LA SECUENCIA INFORME-PRIMERO (Variante B · tablero #524). Pedido del dueño, textual:
// *"¿por qué aún estamos entregando cotización a cliente y no lo que se aprobó desde el
// principio? … primero optimicemos todo lo ya ganado de los informes"*.
//
// Lo que estos tests miden es el ORDEN DE ENVÍO, que es exactamente lo que el dueño vio
// mal en producción (caso Dady, 27-ago: propuesta 0368 primero, informe 0033 después):
//
//   clásico (flag OFF):        propuesta → informe → video      (lo de siempre, intacto)
//   informe-primero (flag ON): valor → informe → video → propuesta
//
// Y la condición NO NEGOCIABLE de la propuesta aprobada: el cliente JAMÁS se queda sin
// su PDF de precio — informe caído, colgado o ya-enviado ⇒ la propuesta sale igual.
//
// Hermético: `global.fetch` se anula y todo lo que toca red se inyecta (mismo patrón que
// webhook.informe.test.js, del que este arnés es hijo).

import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook, secuenciaInformePrimero } from './webhook.js';

global.fetch = async (url) => {
  if (String(url).includes('/internal/quotes/next-number')) {
    return { ok: true, status: 200, json: async () => ({ quote_number: 'CM-FR-004-2026-9999' }) };
  }
  if (String(url).includes('/internal/informes/next-number')) {
    return { ok: true, status: 200, json: async () => ({ informe_number: 'CM-FR-006-2026-9999' }) };
  }
  return { ok: false, status: 503, json: async () => ({}) };
};

const DATOS_COMUNA = {
  comuna: 'Temuco', regimen: 'PDA', uw_max_Wm2K: 3.2,
  zona_termica_NCh1079: 'F', criterio_ref: 'PDA Temuco art. 27',
};

const VENTANAS = [
  { producto: 'Ventana PVC S60 corredera', medidas: '2000x1400mm', vidrio: 'DVH 5/12/5', ambiente: 'Living', cantidad: 1, uw: 2.71 },
  { producto: 'Ventana PVC H98 corredera 3 hojas', medidas: '3250x1460mm', vidrio: 'DVH 5/12/5', ambiente: 'Dormitorio', cantidad: 1, uw: null },
];

let SECUENCIA = 0;

function makeRes() {
  return { sentStatus: undefined, sendStatus(c) { this.sentStatus = c; return this; } };
}

/**
 * Arnés con LÍNEA DE TIEMPO: cada envío al cliente (texto, documento, video) se anota en
 * `spy.linea` en el orden REAL en que salió. El orden es el objeto de estos tests.
 */
function makeDeps({ modoOn = true, informeEnvioOk = true, informeCuelga = false, overrides = {} } = {}) {
  const telefono = `5698${String(++SECUENCIA).padStart(7, '0')}`;
  const spy = { linea: [], textos: [], pdfArgs: [], convEvents: [] };
  const estado = new Map();
  let tokenSeq = 0;
  const vigente = (e) => e && (!e.expira || e.expira > Date.now());

  const deps = {
    conv: new Map(), seen: new Set(), locks: new Map(),
    dormir: async () => {},                       // sin esperas humanas en test

    // El gate se inyecta: el flag real vive en env de Railway y acá se prueba la SECUENCIA,
    // no la lectura de env (esa se prueba abajo, unitaria, sobre secuenciaInformePrimero).
    secuenciaInformePrimero: () => modoOn,
    seqInformeTimeoutMs: 400,                     // techo corto: el test del cuelgue no puede esperar 120 s

    leerEstado: async (k) => (vigente(estado.get(k)) ? estado.get(k).valor : null),
    escribirEstado: (k, v, ttl = 300) => { estado.set(k, { valor: v, expira: Date.now() + ttl * 1000 }); },
    fusionarEstado: (k, calcular, ttl = 300) => {
      const e = estado.get(k);
      const actual = vigente(e) ? e.valor : null;
      const { valor, guardar } = calcular(actual) || {};
      if (guardar && valor != null) estado.set(k, { valor, expira: Date.now() + ttl * 1000 });
      return valor === undefined ? actual : valor;
    },
    reservarEstado: (k, ttl = 300) => {
      if (vigente(estado.get(k))) return null;
      const token = `t${++tokenSeq}`;
      estado.set(k, { valor: token, expira: Date.now() + ttl * 1000 });
      return token;
    },
    liberarReserva: (k, token) => {
      const e = estado.get(k);
      if (!token || !vigente(e) || e.valor !== token) return false;
      estado.delete(k); return true;
    },

    parseInbound: () => ({ ok: true, from: telefono, text: 'dos ventanas correderas', msgId: `wamid.${Math.random()}`, type: 'text' }),
    sendWhatsAppText: async (to, text) => {
      spy.textos.push(text);
      spy.linea.push({ tipo: 'texto', detalle: String(text).slice(0, 60) });
      return { ok: true, msgId: `m${spy.linea.length}` };
    },

    pedirInformeComuna: async () => DATOS_COMUNA,
    generarInformeTermicoPdf: async (datos, opts) => {
      if (informeCuelga) return new Promise(() => {});   // nunca resuelve: el techo decide
      spy.pdfArgs.push(opts);
      return Buffer.alloc(1024, 7);
    },
    laminasParaInforme: async () => null,
    laminaTermopanel: async () => null,
    saveMedia: async () => ({ ok: true, media: { id: 1 } }),

    upsertZohoDeal: async () => 'deal.777',
    addZohoNote: async () => ({ ok: true }),
    attachPdfToDeal: async () => ({ ok: true }),
    generatePdf: async () => Buffer.alloc(2048, 3),
    uploadWaDocument: async () => 'media.1',
    sendWaDocument: async (to, mediaId, filename) => {
      const esInforme = /^Informe-Termico/.test(filename || '');
      spy.linea.push({ tipo: esInforme ? 'informe' : 'propuesta', detalle: filename });
      if (!esInforme) return { ok: true, msgId: 'prop.1' };
      return informeEnvioOk ? { ok: true, msgId: 'doc.1' } : { ok: false, error: 'Meta rechazo' };
    },
    // El video de cortesía: un id cargado alcanza para medir DÓNDE cae en la línea.
    mediaIdsDisponibles: async () => ({ presentacion: 'wamedia.video.1' }),
    sendWaVideo: async (to, mediaId, caption) => {
      spy.linea.push({ tipo: 'video', detalle: String(caption).slice(0, 40) });
      return { ok: true, msgId: 'vid.1' };
    },

    handleTurn: async ({ state, toolCtx }) => {
      await toolCtx.generarPdf({
        items: VENTANAS.map((v) => ({
          product: v.producto, producto_label: v.producto, measures: v.medidas,
          measures_original: v.medidas, glass_label: v.vidrio, ambiente: v.ambiente,
          qty: v.cantidad, unit_price: 100000, total_price: 100000,
          color: 'Nogal',
          termico: v.uw === null ? null : { uw: v.uw },
        })),
        comuna: 'Temuco', name: 'Dady',
      });
      return { reply: 'Listo', history: [], toolCalls: [], state: { ...state, name: 'Dady' } };
    },

    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async (p) => { spy.convEvents.push(p); return { ok: true }; },
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async () => ({ ok: true }),
    },
    notifyHighValue: async () => ({ sent: true }),
  };
  Object.assign(deps, overrides);
  return { deps, spy };
}

async function esperar(cond, ms = 8000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

const tipos = (spy) => spy.linea.map((e) => e.tipo);
const pos = (spy, tipo) => tipos(spy).indexOf(tipo);

/* =========================================================================
 * EL GATE (unitario): quién entra al piloto y quién no
 * ========================================================================= */

test('gate: flag OFF ⇒ nadie, aunque la lista tenga el teléfono', () => {
  assert.equal(secuenciaInformePrimero('56911111111', { flag: false, lista: ['56911111111'] }), false);
});

test('gate: flag ON con lista VACÍA ⇒ nadie (sin lista no hay piloto)', () => {
  assert.equal(secuenciaInformePrimero('56911111111', { flag: true, lista: [] }), false);
});

test('gate: flag ON + teléfono en lista ⇒ entra; fuera de lista ⇒ no', () => {
  const lista = ['56922222222'];
  assert.equal(secuenciaInformePrimero('56922222222', { flag: true, lista }), true);
  assert.equal(secuenciaInformePrimero('+56 9 2222 2222', { flag: true, lista }), true, 'normaliza el formato');
  assert.equal(secuenciaInformePrimero('56933333333', { flag: true, lista }), false);
});

test('gate: comodín * ⇒ todos (rollout, decisión del dueño)', () => {
  assert.equal(secuenciaInformePrimero('56944444444', { flag: true, lista: ['*'] }), true);
});

/* =========================================================================
 * LA SECUENCIA (comportamiento): el orden que el dueño pidió
 * ========================================================================= */

test('🔴 modo informe-primero: valor → informe → video → propuesta, en ESE orden', async () => {
  const { deps, spy } = makeDeps({ modoOn: true });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0), 'la propuesta tiene que salir');

  // El detalle de la línea se recorta a 60 chars, así que se busca por el ARRANQUE del
  // copy aprobado ("Perfecto, {nombre}. Mientras le preparo su Propuesta…").
  const iValor = spy.linea.findIndex((e) => e.tipo === 'texto' && /^Perfecto.*Mientras le preparo/.test(e.detalle));
  assert.ok(iValor >= 0, `el mensaje de valor tiene que salir (línea: ${JSON.stringify(tipos(spy))})`);
  assert.ok(pos(spy, 'informe') >= 0, 'el informe tiene que salir');
  assert.ok(pos(spy, 'video') >= 0, 'el video tiene que salir');
  assert.ok(iValor < pos(spy, 'informe'), 'el mensaje de valor va ANTES del informe');
  assert.ok(pos(spy, 'informe') < pos(spy, 'video'), 'el informe va ANTES del video');
  assert.ok(pos(spy, 'video') < pos(spy, 'propuesta'),
    `el video va ANTES de la propuesta — línea real: ${JSON.stringify(tipos(spy))}`);

  // [Codex, compuerta] CONTEOS EXACTOS, no solo primeras posiciones: un duplicado
  // posterior daba verde igual. Un informe, una propuesta, a lo más un video.
  await new Promise((r) => setTimeout(r, 200));
  const cuenta = (t) => tipos(spy).filter((x) => x === t).length;
  assert.equal(cuenta('informe'), 1, 'exactamente UN informe');
  assert.equal(cuenta('propuesta'), 1, 'exactamente UNA propuesta');
  assert.ok(cuenta('video') <= 1, 'a lo más UN video');

  // [Gemini, compuerta] El aviso clásico ("Deme un momento…") SOBRA cuando el mensaje
  // de valor ya anunció el informe: dos anuncios seguidos delatan al bot.
  assert.ok(!spy.textos.some((t) => /Deme un momento/.test(String(t))),
    'con mensaje de valor NO va el aviso clásico redundante');

  // [Dueño, en caliente 27-ago] Sus tres exigencias del copy, amarradas:
  const textoValor = String(spy.textos.find((t) => /Mientras le preparo/.test(String(t))) || '');
  assert.match(textoValor, /informe térmico/, 'dice TÉRMICO (así se llama el documento), no "técnico"');
  assert.doesNotMatch(textoValor, /informe técnico/, 'el "informe técnico" quedó prohibido');
  assert.match(textoValor, /zona térmica F según la NCh 1079/,
    'nombra la zona térmica de la comuna, el mismo dato que imprime el PDF');
  assert.equal(spy.pdfArgs.at(-1)?.nombre, 'Dady',
    'el informe sale "Preparado para" el cliente aunque state.name aún no exista');
});

test('🔴 el video se CUELGA ⇒ su techo lo corta y la propuesta sale igual (P1 de Codex)', async () => {
  const { deps, spy } = makeDeps({
    modoOn: true,
    overrides: {
      seqVideoTimeoutMs: 300,
      sendWaVideo: () => new Promise(() => {}),   // nunca resuelve: el techo decide
    },
  });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0),
    `un video colgado JAMÁS puede dejar al cliente sin precio — línea: ${JSON.stringify(tipos(spy))}`);
});

test('🔴 el gate LANZA ⇒ se degrada al modo clásico y la propuesta sale (P2 de Codex)', async () => {
  const { deps, spy } = makeDeps({
    modoOn: true,
    overrides: { secuenciaInformePrimero: () => { throw new Error('gate roto'); } },
  });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0),
    `el gate roto no puede tumbar la propuesta — línea: ${JSON.stringify(tipos(spy))}`);
});

test('🔴 modo clásico (flag OFF): la propuesta sigue saliendo PRIMERO, como siempre', async () => {
  const { deps, spy } = makeDeps({ modoOn: false });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'informe') >= 0), 'el informe sale (después)');

  assert.ok(pos(spy, 'propuesta') >= 0);
  assert.ok(pos(spy, 'propuesta') < pos(spy, 'informe'),
    `clásico = propuesta antes del informe — línea real: ${JSON.stringify(tipos(spy))}`);
});

test('🔴 el informe FALLA (Meta rechaza) ⇒ recuperación honesta y la propuesta sale IGUAL', async () => {
  const { deps, spy } = makeDeps({ modoOn: true, informeEnvioOk: false });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0),
    `el cliente JAMÁS se queda sin su PDF — línea real: ${JSON.stringify(tipos(spy))}`);
  // [Codex/Gemini, compuerta] Se le PROMETIÓ el informe (mensaje de valor) y Meta lo
  // rechazó: al cliente se le dice, no se le desaparece la promesa.
  assert.ok(spy.textos.some((t) => /más de lo esperado/.test(String(t))),
    'tras prometer el informe y fallar, va la línea de recuperación');
  // Y si el video llegara a salir (candado de tanda mediante), va DESPUÉS del precio,
  // nunca colado entre la promesa rota y la propuesta.
  if (pos(spy, 'video') >= 0) {
    assert.ok(pos(spy, 'propuesta') < pos(spy, 'video'), 'video solo después de la propuesta');
  }
});

test('🔴 el informe se CUELGA ⇒ el techo lo corta y la propuesta sale igual', async () => {
  const { deps, spy } = makeDeps({ modoOn: true, informeCuelga: true });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0),
    `con el informe colgado el techo (400 ms en test) libera la propuesta — línea: ${JSON.stringify(tipos(spy))}`);
});

test('el informe declara las MISMAS ventanas que la propuesta (paridad de documentos)', async () => {
  const { deps, spy } = makeDeps({ modoOn: true });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.pdfArgs.length > 0));
  const medidas = (vs) => (vs || []).map((v) => String(v.medidas || '').replace(/mm$/, ''));
  assert.deepEqual(medidas(spy.pdfArgs.at(-1).ventanas), medidas(VENTANAS));
});
