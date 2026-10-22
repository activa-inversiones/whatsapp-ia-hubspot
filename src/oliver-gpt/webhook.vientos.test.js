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
//   C · el de vientos solo se intentaba si el termico salia 'enviado': con el termico 'fallo'
//       o 'ya_enviado' no se intentaba aunque el cliente nunca lo hubiera recibido. Excepciones
//       (decision del coordinador, 05-oct): termico en 'timeout' (sigue corriendo de fondo) o
//       rechazado por Meta POR EL DESTINATARIO ⇒ no se intenta en ese turno.
//
// Hermetico: `global.fetch` falso (correlativo + MOTOR DE PRECIOS FALSO) y `ACTIVA_ENGINE_URL`
// apuntando a un host de prueba, asi que nada puede salir a produccion aunque algo se escape.

import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook, huellaDelInforme } from './webhook.js';
import { capturarLogs } from './capturarLogs.testutil.js';
import { claveAvisoVidrio } from '../../services/vidrioCotizado.js';

process.env.ACTIVA_ENGINE_URL = 'http://motor.test';

// El motor FALSO: el precio y el Uw dependen del vidrio que el propio motor elige (por area,
// como `pickGlassId`: 1607 = 4+12+4 · 1608 = 5+12+5 · 1609 = satén), igual que en produccion.
const PRECIO_VIDRIO = { 1607: 100000, 1609: 120000, 1608: 130000 };
const UW_VIDRIO = { 1607: 2.68, 1609: 2.66, 1608: 2.7 };
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
function armar({ informeEnvio = { ok: true, msgId: 'doc.1' }, informeCuelga = false, thermalCaido = false, ventanas = VENTANAS, nombre = 'Dady' } = {}) {
  const telefono = `5697${String(++SEQ).padStart(7, '0')}`;
  const spy = { linea: [], textos: [], propuestas: [], vientos: [], alertas: [], eventos: [], plantillas: [] };
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
    // [2026-10-22] Misma semántica que `estadoPersistente.borrarSi` / `actualizarSi`: comparan y
    // escriben en un paso sobre el mismo almacén del arnés.
    borrarEstadoSi: async (k, cond) => {
      const e = estado.get(k); const v = vigente(e) ? e.valor : null;
      if (v == null) return { borrado: false, motivo: 'no_existe' };
      if (!cond(v)) return { borrado: false, motivo: 'no_coincide' };
      estado.delete(k); return { borrado: true };
    },
    actualizarEstadoSi: async (k, cond, nuevo, ttl) => {
      const e = estado.get(k); const v = vigente(e) ? e.valor : null;
      if (v == null) return { actualizado: false, motivo: 'no_existe' };
      if (!cond(v)) return { actualizado: false, motivo: 'no_coincide' };
      const n = nuevo(v); poner(k, n, ttl); return { actualizado: true, valor: n };
    },
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
    pedirInformeComuna: async () => (thermalCaido ? null
      : { comuna: 'Temuco', regimen: 'PDA', uw_max_Wm2K: 3.2, zona_termica_NCh1079: 'F', criterio_ref: 'PDA' }),
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
      const tipo = /^Informe-Vientos/.test(filename || '') ? 'vientos'
        : /^Informe-Termico/.test(filename || '') ? 'informe'
          : /^Informe-Uw/.test(filename || '') ? 'uw' : 'propuesta';   // [#1581] piloto Uw de la línea
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
      pushConversationEvent: async (p) => { spy.eventos.push(p); return { ok: true }; },
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async () => ({ ok: true }),
    },
    // El canal de avisos al dueño (highValueNotifier): (envio, telefono del cliente, sesion, motivo).
    notifyHighValue: async (envio, cliente, sesion, motivo) => { spy.alertas.push({ cliente, motivo: String(motivo) }); return { sent: true }; },
    // [r8] La plantilla al dueño (escalation.js → /admin/send-template), con la FORMA REAL de la respuesta del
    // endpoint (index.js:5280): {ok, template, phone, result}. Por defecto sale bien y no toca ninguna red: la suite
    // corre sin ADMIN_PIN. El almacén (reserva + marca de «ya avisado») es el `estado` de este mismo arnés, por test.
    sendAvisoVidrioTemplate: async (folio, etiquetas) => {
      spy.plantillas.push({ folio, etiquetas });
      return { ok: true, template: 'informe_diario', phone: '56900000009', result: { ok: true, msgId: 'wamid.T1' } };
    },
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
  // [2026-10-11 · orden del dueño: «BAÑO ES BAÑO DE TERMOPANEL SATEN»] El rótulo que lee el cliente
  // lleva la palabra Termopanel: «4+12+4» a secas se lee como vidrio simple, que es otro producto.
  assert.deepEqual(a?.items.map((i) => i.glass_label), ['Termopanel 5+12+5', 'Termopanel 4+12+4'],
    'la propuesta imprime el vidrio que se cobro, y lo nombra como lo que es');
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

// [2026-10-06] la huella incluye las ventanas del proyecto (opcion 2 del dueño)
const huellaUltima = () => huellaDelInforme({ comuna: 'Temuco', producto: VENTANAS.at(-1).producto, glassLabel: VENTANAS.at(-1).vidrio, ventanas: VENTANAS });

const rechazoMeta = (code) => ({ informeEnvio: { ok: false, error: 'rechazo', status: 400, code } });

for (const [caso, preparar] of [
  ['fallo de THERMAL (no hay datos de la comuna)', () => armar({ thermalCaido: true })],
  ['ya_enviado (candado del termico vigente)', () => {
    const x = armar();
    x.deps.escribirEstado(`informe_termico:${x.telefono}:${huellaUltima()}`, { at: Date.now() - 3600_000 }, 3000);
    return x;
  }],
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

for (const [caso, preparar, motivo] of [
  // [M1] El termico sigue corriendo de fondo: mandar el de vientos sumaba hasta 55 s al precio y
  // podia dejar el orden vientos → propuesta → termico.
  ['timeout (el termico sigue corriendo de fondo)', () => armar({ informeCuelga: true }), 'omitido_timeout_termico'],
  // [B2] Meta rechazo AL DESTINATARIO: el de vientos fallaria igual y quemaria un folio CM-FR-007
  // sin registro.
  ['rechazado por Meta: fuera de la ventana de 24 h (131047)', () => armar(rechazoMeta(131047)), 'omitido_rechazo_destinatario'],
  ['rechazado por Meta: numero no entregable (131026)', () => armar(rechazoMeta(131026)), 'omitido_rechazo_destinatario'],
]) {
  test(`🌬️ C termico '${caso}' ⇒ el de vientos NO se intenta en este turno y queda registrado por que`, async () => {
    const { deps, spy } = preparar();
    const logs = await capturarLogs(async () => {
      await handleWebhook({ body: {} }, makeRes(), deps);
      assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0), 'la propuesta sale siempre');
    });
    assert.equal(cuenta(spy, 'vientos'), 0, `linea: ${JSON.stringify(spy.linea)}`);
    assert.equal(spy.vientos.length, 0, 'ni siquiera se le pide al motor de vientos');
    assert.ok(logs.some((l) => l.includes(`vientos → ${motivo}`)), `falta el registro "${motivo}"`);
  });
}

test('🌬️ C control: el de vientos YA recibido (su candado vigente) no se repite aunque el termico falle', async () => {
  const x = armar({ thermalCaido: true });
  x.deps.escribirEstado(`informe_vientos:${x.telefono}:${huellaUltima()}`, { at: Date.now() - 3600_000 }, 3000);
  await handleWebhook({ body: {} }, makeRes(), x.deps);
  assert.ok(await esperar(() => pos(x.spy, 'propuesta') >= 0));
  assert.equal(cuenta(x.spy, 'vientos'), 0, 'su propio candado manda');
});

/* ── B3/B4 · lo que el reemplazo del vidrio NO debe callar ──────────────────────────── */

test('🌬️ B3/B4 satén con el baño perdido NO se reemplaza; otro producto SI, y los dos quedan avisados con el folio', async () => {
  // B3: la etiqueta dice satén y la recotizacion del PDF (sin ambiente) eligio claro ⇒ queda el
  // rastro del recinto + warn `vidrio.bano_perdido`. B4: "low-e" no es lo que se cobra ⇒ se
  // reemplaza (como siempre desde la r2) + warn `vidrio.producto_distinto` con la etiqueta original.
  const { deps, spy } = armar({ ventanas: [
    { producto: 'Corredera SLIDING H80 Doble Riel S75', medidas: '1500x1000', vidrio: '4+12+4 satén (baño)', cantidad: 1, precio: 100000 },
    { producto: 'Corredera SLIDING H80 Doble Riel S75', medidas: '1400x1000', vidrio: 'DVH 4/12/4 low-e', cantidad: 1, precio: 100000 },
  ] });
  const logs = await capturarLogs(async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0), 'la propuesta sale');
  });
  // [2026-10-11] el primero NO cambia: lo trae el LLM tal cual se lo dio el motor en el turno anterior;
  // el segundo lo rotula el pricer ahora, y por eso dice Termopanel.
  assert.deepEqual(spy.propuestas[0]?.items.map((i) => i.glass_label), ['4+12+4 satén (baño)', 'Termopanel 4+12+4']);
  const linea = (aviso) => logs.find((l) => l.includes(aviso)) || '';
  assert.match(linea('vidrio.bano_perdido'), /CM-FR-004-2026-9999.*satén/, `logs: ${logs.filter((l) => /vidrio\./.test(l))}`);
  assert.match(linea('vidrio.producto_distinto'), /CM-FR-004-2026-9999.*DVH 4\/12\/4 low-e/);
});

const alertasDeVidrio = (spy) => spy.alertas.filter((a) => /revisar precio/.test(a.motivo));

/* ── B3 · r8: el CABLEADO de WhatsApp hacia los tres canales del aviso ─────────────────────────────────
 * La lógica (texto Y plantilla siempre, una vez por folio, qué cuenta como «avisado») se prueba en
 * services/avisarVidrio.test.js y services/avisoVidrio.integracion.test.js. Acá solo se verifica que
 * webhook.js conecta cada canal a donde corresponde: el cliente del turno, el prefijo, el folio, el KV. */

const SATEN_1500 = [{ producto: 'Corredera SLIDING H80 Doble Riel S75', medidas: '1500x1000', vidrio: '4+12+4 satén (baño)', cantidad: 1, precio: 100000 }];
const FOLIO_DEL_TEST = 'CM-FR-004-2026-9999';
const eventosDeAvisoFallido = (spy) => spy.eventos.filter((e) => e?.metadata?.aviso_fallido === true);
const vaciar = () => new Promise((r) => { setImmediate(r); });   // sin timers falsos: deja correr las cadenas de promesas
/** El notificador del dueño con el resultado que se le diga (el real devuelve `{sent:false,...}` y no lanza). */
const conResultadoDeAviso = (deps, spy, resultado) => {
  deps.notifyHighValue = async (_envio, cliente, _sesion, motivo) => { spy.alertas.push({ cliente, motivo: String(motivo) }); return resultado; };
};
/** Corre el turno y espera POR CONDICIÓN a que la propuesta salga y el aviso (texto y plantilla) se haya intentado. */
async function correrYEsperarAviso({ deps, spy }) {
  await capturarLogs(async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0), 'la propuesta sale igual: nunca se frena al cliente');
    assert.ok(await esperar(() => alertasDeVidrio(spy).length > 0 && spy.plantillas.length > 0), `falta el aviso: ${JSON.stringify({ a: spy.alertas, p: spy.plantillas })}`);
    await vaciar();
  });
}

test('🔔 B3 satén perdido ⇒ texto Y plantilla (un solo mensaje de cada uno aunque haya dos satenes), al cliente del turno y con el folio; el precio NO se toca', async () => {
  const x = armar({ ventanas: [
    { producto: 'Corredera SLIDING H80 Doble Riel S75', medidas: '1500x1000', vidrio: '4+12+4 satén (baño)', cantidad: 1, precio: 100000 },
    { producto: 'Corredera SLIDING H80 Doble Riel S75', medidas: '1400x1000', vidrio: 'Termopanel 4+12+4 esmerilado', cantidad: 1, precio: 100000 },
    { producto: 'Corredera SLIDING H80 Doble Riel S75', medidas: '1300x1000', vidrio: 'DVH 4/12/4 low-e', cantidad: 1, precio: 100000 },
  ] });
  await correrYEsperarAviso(x);
  const { spy, telefono } = x;
  // TEXTO: por el notificador, con el prefijo del canal y el cliente del turno (su cooldown es del cliente).
  const alertas = alertasDeVidrio(spy);
  assert.equal(alertas.length, 1, `un aviso por folio, no uno por ventana: ${JSON.stringify(alertas)}`);
  assert.match(alertas[0].motivo, /^\[whatsapp\] /, 'mismo molde que las otras escalaciones del canal');
  assert.equal(alertas[0].cliente, telefono);
  assert.match(alertas[0].motivo, /CM-FR-004-2026-9999/);
  assert.match(alertas[0].motivo, /"4\+12\+4 satén \(baño\)"/);
  assert.match(alertas[0].motivo, /"Termopanel 4\+12\+4 esmerilado"/);
  assert.doesNotMatch(alertas[0].motivo, /low-e/, 'el otro producto va al tablero, no al celular del dueño');
  // PLANTILLA: sale AUNQUE el texto salió (sent:true): ver services/avisarVidrio.test.js (causa raíz de r7).
  assert.deepEqual(spy.plantillas, [{ folio: FOLIO_DEL_TEST, etiquetas: ['4+12+4 satén (baño)', 'Termopanel 4+12+4 esmerilado'] }]);
  // Llegó ⇒ nada que gritar en el panel, y la marca de «ya avisado» quedó en el KV que inyecta el llamador.
  assert.deepEqual(eventosDeAvisoFallido(spy), []);
  // [#1089] La marca es por folio + VIDRIO: las dos etiquetas son el mismo satén 4+12+4, así que comparten UNA marca.
  assert.ok(x.estado.get(claveAvisoVidrio('vidrio', FOLIO_DEL_TEST, '4+12+4 satén (baño)', '4+12+4'))?.valor?.at > 0, 'la marca quedó escrita con deps.escribirEstado');
  assert.equal(x.estado.get(claveAvisoVidrio('vidrio', FOLIO_DEL_TEST, 'Termopanel 4+12+4 esmerilado', '4+12+4'))?.valor?.at,
    x.estado.get(claveAvisoVidrio('vidrio', FOLIO_DEL_TEST, '4+12+4 satén (baño)', '4+12+4'))?.valor?.at, 'y es la misma para las dos etiquetas');
  assert.deepEqual(spy.propuestas[0]?.items.map((i) => i.unit_price), [100000, 100000, 100000], 'el precio no cambia: es carril plata');
});

test('🔔 B4 solo otro producto (sin satén perdido) ⇒ NO se avisa al dueño: ni texto ni plantilla ni evento', async () => {
  const { deps, spy } = armar({ ventanas: [
    { producto: 'Corredera SLIDING H80 Doble Riel S75', medidas: '1400x1000', vidrio: 'DVH 4/12/4 low-e', cantidad: 1, precio: 100000 },
  ] });
  await capturarLogs(async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0), 'la propuesta sale');
    await vaciar();
  });
  assert.deepEqual([alertasDeVidrio(spy), spy.plantillas, eventosDeAvisoFallido(spy)], [[], [], []]);
});

test('🔔 B3 ninguno de los dos canales salió ⇒ UN evento de sistema en la conversación del CLIENTE (como la escalación #888); la propuesta sale igual', async () => {
  const x = armar({ ventanas: SATEN_1500 });
  conResultadoDeAviso(x.deps, x.spy, { sent: false, reason: 'envio_fallido', code: 131047, error: '{"error":{"code":131047}}' });
  x.deps.sendAvisoVidrioTemplate = async (folio, etiquetas) => {
    x.spy.plantillas.push({ folio, etiquetas });
    return { ok: false, template: 'informe_diario', phone: '56900000009', result: { ok: false, error: 'meta_credentials_missing' } };
  };
  await correrYEsperarAviso(x);
  const eventos = eventosDeAvisoFallido(x.spy);
  assert.equal(eventos.length, 1, JSON.stringify(x.spy.eventos));
  assert.equal(eventos[0].channel, 'whatsapp');
  assert.equal(eventos[0].external_id, x.telefono, 'en la conversación del cliente del turno, que es donde se mira');
  assert.equal(eventos[0].direction, 'outbound');
  assert.equal(eventos[0].actor_type, 'system');
  assert.equal(eventos[0].metadata.source, 'oliver_gpt_webhook');
  assert.equal(eventos[0].metadata.folio, FOLIO_DEL_TEST);
  assert.match(String(eventos[0].metadata.motivo_template), /meta_credentials_missing/);
  assert.equal(x.estado.has(claveAvisoVidrio('vidrio', FOLIO_DEL_TEST, '4+12+4 satén (baño)', '4+12+4')), false, 'no llegó ⇒ SIN marca: el reintento tiene que poder salir');
});

/* ── el plazo EFECTIVO del folio reusado sigue siendo 48 h (una sola constante: services/folioReuso.js) ───────────────
 * Los dos canales y la marca del aviso de satén leen `FOLIO_REUSO_MS`; estas pruebas fijan el comportamiento de
 * WhatsApp a ambos lados del borde (el de IG/FB está en channel-agent.paridad-abc-rut.test.js). */

for (const [horas, reusa] of [[47, true], [49, false]]) {
  test(`📎 WhatsApp: la cotización anterior de hace ${horas} h ${reusa ? 'SE REUSA (revisión del mismo folio)' : 'ya NO se reusa: folio nuevo'}`, async () => {
    const FOLIO_PREVIO = 'CM-FR-004-2026-0300';
    const x = armar();
    x.deps.conv.set(x.telefono, {
      history: [{ role: 'user', content: 'hola' }],
      state: { lastMessageAt: Date.now(), last_quote: { quote_number: FOLIO_PREVIO, at: Date.now() - horas * 3600_000, pdf_sent: true } },
    });
    await handleWebhook({ body: {} }, makeRes(), x.deps);
    assert.ok(await esperar(() => pos(x.spy, 'propuesta') >= 0), 'la propuesta sale');
    assert.equal(x.spy.propuestas[0]?.quote_num, reusa ? FOLIO_PREVIO : FOLIO_DEL_TEST);
  });
}

/* ── D · la pausa antes del precio, si se mando ALGUN informe (decision 4, r4) ───────── */

const PAUSA_PRECIO_MS = Number(process.env.SEQUENCE_PRECIO_MS || 35_000);
/** Lo que paso entre el ULTIMO informe entregado y la propuesta (las pausas quedan en la linea de tiempo). */
const entreInformesYPropuesta = (spy) => {
  const ultimo = Math.max(pos(spy, 'informe'), pos(spy, 'vientos'));
  return spy.linea.slice(ultimo + 1, pos(spy, 'propuesta'));
};
const conPausasEnLaLinea = (x) => {
  x.deps.dormir = async (ms) => { x.spy.linea.push(`dormir:${ms}`); };
  return x;
};

test('⏸️ D solo salio el de VIENTOS (el termico fallo) ⇒ igual hay pausa antes de la propuesta', async () => {
  // Antes la pausa solo estaba en el camino "termico enviado": con el termico caido, el de
  // vientos y el precio caian pegados.
  const x = conPausasEnLaLinea(armar({ thermalCaido: true }));
  await handleWebhook({ body: {} }, makeRes(), x.deps);
  assert.ok(await esperar(() => pos(x.spy, 'propuesta') >= 0), 'la propuesta sale');
  assert.equal(cuenta(x.spy, 'informe'), 0, 'control: el termico no salio');
  assert.equal(cuenta(x.spy, 'vientos'), 1, 'control: el de vientos si');
  assert.ok(entreInformesYPropuesta(x.spy).includes(`dormir:${PAUSA_PRECIO_MS}`),
    `falta la pausa antes del precio — linea: ${JSON.stringify(x.spy.linea)}`);
});

test('⏸️ D salieron los DOS informes ⇒ la pausa antes de la propuesta se hace UNA vez (y el video sigue entre medio)', async () => {
  const x = conPausasEnLaLinea(armar());
  await handleWebhook({ body: {} }, makeRes(), x.deps);
  assert.ok(await esperar(() => pos(x.spy, 'propuesta') >= 0), 'la propuesta sale');
  const entre = entreInformesYPropuesta(x.spy);
  assert.equal(entre.filter((e) => e === `dormir:${PAUSA_PRECIO_MS}`).length, 1, `linea: ${JSON.stringify(x.spy.linea)}`);
  assert.equal(cuenta(x.spy, 'video'), 1, 'el video de cortesia acompaña a la secuencia completa');
  assert.ok(pos(x.spy, 'video') < pos(x.spy, 'propuesta'));
});

test('⏸️ D ningun informe salio (los dos ya recibidos) ⇒ NO hay pausa antes del precio', async () => {
  const x = conPausasEnLaLinea(armar());
  x.deps.escribirEstado(`informe_termico:${x.telefono}:${huellaUltima()}`, { at: Date.now() - 3600_000 }, 3000);
  x.deps.escribirEstado(`informe_vientos:${x.telefono}:${huellaUltima()}`, { at: Date.now() - 3600_000 }, 3000);
  await handleWebhook({ body: {} }, makeRes(), x.deps);
  assert.ok(await esperar(() => pos(x.spy, 'propuesta') >= 0), 'la propuesta sale');
  assert.equal(cuenta(x.spy, 'informe') + cuenta(x.spy, 'vientos'), 0, 'control: no salio ningun informe');
  assert.ok(!x.spy.linea.includes(`dormir:${PAUSA_PRECIO_MS}`), `pausa de mas — linea: ${JSON.stringify(x.spy.linea)}`);
});

/* ── D · [#1581, 21-oct] PILOTO: el informe Uw de la LÍNEA cotizada ──────────────────────
 * Decisión del dueño: «entreguemos el informe Uw/Uf de la línea cotizada, primero a una
 * lista chica de clientes»; piloto «Solo mi número primero»; solo calce EXACTO de línea.
 * Va después de vientos y ANTES del precio, con su propio techo: nunca retiene la propuesta. */

const H98 = [{ producto: 'Corredera SLIDING H98 Doble Riel S75', medidas: '2000x1400mm', vidrio: '5+12+5', ambiente: 'Living', cantidad: 1, precio: 130000 }];
function conPiloto(lista, fn) {
  const previo = process.env.UW_LINEA_PILOTO_LISTA;
  process.env.UW_LINEA_PILOTO_LISTA = lista;
  return fn().finally(() => {
    if (previo === undefined) delete process.env.UW_LINEA_PILOTO_LISTA; else process.env.UW_LINEA_PILOTO_LISTA = previo;
  });
}
function armarUw(opts = {}) {
  const a = armar({ ventanas: H98, ...opts });
  a.spy.descargas = []; a.spy.medios = [];
  a.deps.descargarInformeUw = async (codigo) => { a.spy.descargas.push(codigo); return Buffer.from('%PDF-1.7 uw'); };
  a.deps.saveMedia = async (m) => { a.spy.medios.push(m); return { ok: true }; };
  return a;
}

// 🔁 [2026-10-22] D1 y D6 SE DIERON VUELTA A PROPÓSITO. Antes fijaban que el archivo ISO y el
// candado de 90 días se escribían apenas Meta ACEPTABA el envío. Comentario de Codex en
// whatsapp-ia-hubspot#14 (P1, «Wait for `delivered` before recording Uw delivery») y encargo del
// 22-oct: HTTP 200 no prueba entrega (AGENTS.md) ⇒ al aceptar queda PENDIENTE; el evento y el
// archivo se escriben con el acuse `delivered` de ESE msgId.
const deliveredUw = (telefono, msgId = 'uw.1') => ({ entry: [{ changes: [{ value: { statuses: [{
  id: msgId, status: 'delivered', recipient_id: telefono,
}] } }] }] });
const archivosUw = (spy) => spy.medios.filter((m) => /^Informe-Uw/.test(m.filename || ''));

test('📐 D1 en el piloto y con calce exacto: térmico → vientos → Uw de la línea → propuesta; el archivo ISO llega con el delivered', async () => {
  const { deps, spy, telefono } = armarUw();
  await conPiloto(telefono, async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0), 'la propuesta sale siempre');
  });
  assert.equal(cuenta(spy, 'uw'), 1, `linea: ${JSON.stringify(spy.linea)}`);
  assert.ok(pos(spy, 'vientos') < pos(spy, 'uw') && pos(spy, 'uw') < pos(spy, 'propuesta'),
    `vientos → uw → propuesta — linea: ${JSON.stringify(spy.linea)}`);
  assert.deepEqual(spy.descargas, ['AT-NCH3137-1-2026-000027-7492c9'], 'H98 doble riel = V2N vigente');
  await new Promise((r) => { setTimeout(r, 50); });
  assert.deepEqual(archivosUw(spy), [], 'aceptado por Meta NO es entregado: todavía no se archiva');
  assert.ok(!spy.eventos.some((e) => /Informe Uw/.test(e.body || '')), 'ni se anuncia como entregado');
  // Llega el `delivered` de ESE envío
  await handleWebhook({ body: deliveredUw(telefono) }, makeRes(), deps);
  assert.ok(await esperar(() => archivosUw(spy).length === 1),
    `registro ISO con nombre por entrega — ${JSON.stringify(spy.medios.map((m) => m.filename))}`);
  assert.match(archivosUw(spy)[0].filename, /^Informe-Uw-.*-AT-NCH3137-1-2026-000027-entrega-\d{17}-\d{4}-[0-9A-Za-z]+\.pdf$/);
  assert.ok(spy.eventos.some((e) => /Informe Uw.*ENTREGADO/.test(e.body || '')), 'y el evento dice ENTREGADO');
});

test('📐 D2 FUERA del piloto no sale (la lista por defecto es solo el número del dueño)', async () => {
  const { deps, spy } = armarUw();
  await conPiloto('', async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
  });
  assert.equal(cuenta(spy, 'uw'), 0);
  assert.deepEqual(spy.descargas, []);
});

test('📐 D3 en el piloto pero SIN calce exacto (H80) no sale nada', async () => {
  const { deps, spy, telefono } = armarUw({ ventanas: [{ ...H98[0], producto: 'Corredera SLIDING H80 Doble Riel S75' }] });
  await conPiloto(telefono, async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
  });
  assert.equal(cuenta(spy, 'uw'), 0);
  assert.deepEqual(spy.descargas, []);
});

test('📐 D4 Thermal no contesta: la propuesta sale igual (techo propio), sin informe Uw', async () => {
  const { deps, spy, telefono } = armarUw();
  deps.descargarInformeUw = () => new Promise(() => {});   // cuelga para siempre
  deps.seqUwLineaTimeoutMs = 200;
  await conPiloto(telefono, async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0), 'la propuesta jamás espera al informe Uw');
  });
  assert.equal(cuenta(spy, 'uw'), 0);
});

test('📐 D5 un cliente que YA recibió el Uw de esa línea (candado de 90 días) no lo recibe de nuevo', async () => {
  // El bot no emite dos propuestas iguales en 2 minutos (guardia anti-doble-folio), así que el
  // «ya lo recibió» se prueba con la marca que deja la primera entrega.
  const { deps, spy, telefono, estado } = armarUw();
  estado.set(`docs_entregado:uw_linea:V2N:${telefono.slice(-9)}`, { valor: { at: Date.now() }, expira: Date.now() + 3_600_000 });
  await conPiloto(telefono, async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
  });
  assert.equal(cuenta(spy, 'uw'), 0, `linea: ${JSON.stringify(spy.linea)}`);
  assert.deepEqual(spy.descargas, [], 'ni siquiera se descarga');
});

test('📐 D6 el envío aceptado deja candado PENDIENTE (3 días) + rastro; el delivered lo pasa al TTL del selector (90)', async () => {
  const { deps, spy, telefono, estado } = armarUw();
  const ttls = new Map();
  const escribir = deps.escribirEstado;
  deps.escribirEstado = (k, v, ttl) => { ttls.set(k, ttl); return escribir(k, v, ttl); };
  await conPiloto(telefono, async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
  });
  assert.equal(cuenta(spy, 'uw'), 1);
  const clave = `docs_entregado:uw_linea:V2N:${telefono.slice(-9)}`;
  const marca = estado.get(clave);
  assert.ok(marca && marca.valor?.folio === 'AT-NCH3137-1-2026-000027' && marca.valor?.pendiente === true, `marca: ${JSON.stringify(marca)}`);
  assert.equal(ttls.get(clave), 3 * 24 * 3600, 'pendiente: vive lo mismo que el rastro; sin acuse vence y se reintenta');
  // [Codex r1] `ok` de Meta no es entrega: queda el rastro para que el `delivered` o el `failed` cierren.
  const rastro = estado.get('wamsg:uw.1');
  assert.ok(rastro && rastro.valor?.tipo === 'uw_linea' && rastro.valor?.clave === clave && rastro.valor?.codigo,
    `rastro: ${JSON.stringify(rastro)}`);
  await handleWebhook({ body: deliveredUw(telefono) }, makeRes(), deps);
  assert.ok(await esperar(() => estado.get(clave)?.valor?.pendiente === false), `marca: ${JSON.stringify(estado.get(clave))}`);
  const resta = estado.get(clave).expira - Date.now();
  assert.ok(resta > 89 * 24 * 3600 * 1000 && resta <= 90 * 24 * 3600 * 1000,
    `entregado: el TTL del selector (COTIZACION_DOCS_VENTANA_DIAS, 90 por defecto) — quedan ${Math.round(resta / 86_400_000)} días`);
});

test('📐 D8 con selección MANUAL del cockpit el Uw no se agrega (ni el primero: nadie lo eligió)', async () => {
  const { deps, spy, telefono } = armarUw();
  deps.decidirDocumentosCotizacion = async () => ({ termico: true, vientos: true, propuesta: true, origen: 'manual' });
  await conPiloto(telefono, async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
  });
  assert.equal(cuenta(spy, 'uw'), 0, `linea: ${JSON.stringify(spy.linea)}`);
});

test('📐 D7 Thermal contesta TARDE (después del techo): el Uw NO llega después de la propuesta', async () => {
  const { deps, spy, telefono } = armarUw();
  deps.seqUwLineaTimeoutMs = 100;
  deps.descargarInformeUw = async () => { await new Promise((r) => { setTimeout(r, 400); }); return Buffer.from('%PDF-1.7 tarde'); };
  await conPiloto(telefono, async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
    await new Promise((r) => { setTimeout(r, 700); });   // deja terminar la descarga tardía
  });
  assert.equal(cuenta(spy, 'uw'), 0, `nada después del precio — linea: ${JSON.stringify(spy.linea)}`);
});

test('📐 D9 el «reset» del cliente suelta también el candado del Uw (como térmico y vientos)', async () => {
  const { deps, spy, telefono, estado } = armarUw();
  estado.set(`docs_entregado:uw_linea:V2N:${telefono.slice(-9)}`, { valor: { at: Date.now() - 60_000 }, expira: Date.now() + 3_600_000 });
  estado.set(`informe_reset:${telefono}`, { valor: Date.now() - 1_000, expira: Date.now() + 3_600_000 });
  await conPiloto(telefono, async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
  });
  assert.equal(cuenta(spy, 'uw'), 1, `después del reset vuelve a salir — linea: ${JSON.stringify(spy.linea)}`);
});

test('📐 D10 Meta no confirma (sin id de mensaje): NO cuenta como enviado, queda «dudoso» y no se reintenta solo', async () => {
  const { deps, spy, telefono, estado } = armarUw();
  const enviar = deps.sendWaDocument;
  deps.sendWaDocument = async (to, m, filename, cap) => {
    const r = await enviar(to, m, filename, cap);
    return /^Informe-Uw/.test(filename || '') ? { ok: true } : r;   // 200 sin wamid
  };
  await conPiloto(telefono, async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
  });
  const marca = estado.get(`docs_entregado:uw_linea:V2N:${telefono.slice(-9)}`);
  assert.equal(marca?.valor?.dudoso, true, `marca: ${JSON.stringify(marca)}`);
  assert.ok(!spy.medios.some((m) => /^Informe-Uw/.test(m.filename)), 'lo no confirmado NO se archiva como entregado');
});

test('📐 D11 Meta repite el delivered (1-3 veces): el archivo ISO y el evento salen UNA sola vez', async () => {
  const { deps, spy, telefono } = armarUw();
  await conPiloto(telefono, async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
  });
  for (let i = 0; i < 3; i++) await handleWebhook({ body: deliveredUw(telefono) }, makeRes(), deps);
  await new Promise((r) => { setTimeout(r, 100); });
  assert.equal(archivosUw(spy).length, 1, JSON.stringify(spy.medios.map((m) => m.filename)));
  assert.equal(spy.eventos.filter((e) => /Informe Uw.*ENTREGADO/.test(e.body || '')).length, 1);
});

test('📐 D12 el delivered de un envío que ya NO es el del candado (otro msgId) no registra nada', async () => {
  const { deps, spy, telefono, estado } = armarUw();
  await conPiloto(telefono, async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
  });
  const clave = `docs_entregado:uw_linea:V2N:${telefono.slice(-9)}`;
  estado.set(clave, { valor: { ...estado.get(clave).valor, msgId: 'uw.OTRO' }, expira: Date.now() + 3_600_000 });
  await handleWebhook({ body: deliveredUw(telefono) }, makeRes(), deps);
  await new Promise((r) => { setTimeout(r, 100); });
  assert.deepEqual(archivosUw(spy), []);
  assert.equal(estado.get(clave).valor.msgId, 'uw.OTRO', 'el candado del otro envío no se toca');
});

// [2026-10-22 · Codex r1] P2 con RESERVA: un POST de Uw arranca solo si cabe entero antes del techo.
const conPostLento = (deps, ms) => {
  const enviar = deps.sendWaDocument;
  deps.sendWaDocument = async (to, m, filename, cap) => {
    if (/^Informe-Uw/.test(filename || '')) await new Promise((r) => { setTimeout(r, ms); });
    return enviar(to, m, filename, cap);
  };
};

test('📐 D13 el POST del Uw cabe en la reserva: llega ANTES del precio, sin pasar el techo', async () => {
  const { deps, spy, telefono } = armarUw();
  deps.seqUwLineaTimeoutMs = 600; deps.seqUwLineaReservaMs = 400;
  conPostLento(deps, 250);
  await conPiloto(telefono, async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
  });
  assert.equal(cuenta(spy, 'uw'), 1, `linea: ${JSON.stringify(spy.linea)}`);
  assert.ok(pos(spy, 'uw') < pos(spy, 'propuesta'), `linea: ${JSON.stringify(spy.linea)}`);
});

test('📐 D13b ya no queda tiempo para un POST entero: el Uw NO arranca (nada después del precio)', async () => {
  const { deps, spy, telefono } = armarUw();
  deps.seqUwLineaTimeoutMs = 600; deps.seqUwLineaReservaMs = 400;
  deps.descargarInformeUw = async () => { await new Promise((r) => { setTimeout(r, 300); }); return Buffer.from('%PDF-1.7 uw'); };
  await conPiloto(telefono, async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
    await new Promise((r) => { setTimeout(r, 600); });
  });
  assert.equal(cuenta(spy, 'uw'), 0, `linea: ${JSON.stringify(spy.linea)}`);
});

test('📐 D13c un adaptador que se pasa de su timeout: el techo da el seguro corto y el Uw igual llega antes del precio', async () => {
  const { deps, spy, telefono } = armarUw();
  deps.seqUwLineaTimeoutMs = 500; deps.seqUwLineaReservaMs = 300; deps.seqUwLineaEnvioMaxMs = 400;
  conPostLento(deps, 650);   // arranca a tiempo, termina 150 ms después del techo (dentro del seguro)
  await conPiloto(telefono, async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
  });
  assert.equal(cuenta(spy, 'uw'), 1, `linea: ${JSON.stringify(spy.linea)}`);
  assert.ok(pos(spy, 'uw') < pos(spy, 'propuesta'), `linea: ${JSON.stringify(spy.linea)}`);
});

test('📐 D14 el POST en vuelo se cuelga más allá del tope: la propuesta sale igual (nunca se pierde)', async () => {
  const { deps, spy, telefono } = armarUw();
  deps.seqUwLineaTimeoutMs = 300; deps.seqUwLineaReservaMs = 100;
  deps.seqUwLineaEnvioMaxMs = 150;
  const enviar = deps.sendWaDocument;
  deps.sendWaDocument = (to, m, filename, cap) => (/^Informe-Uw/.test(filename || '') ? new Promise(() => {}) : enviar(to, m, filename, cap));
  await conPiloto(telefono, async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0), 'la propuesta no se pierde');
  });
});

test('📐 D15 el archivo ISO falla en el delivered: el próximo acuse (read) lo REPARA, sin duplicar el evento', async () => {
  const { deps, spy, telefono, estado } = armarUw();
  await conPiloto(telefono, async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
  });
  const guardar = deps.saveMedia;
  let fallar = true;
  deps.saveMedia = async (m) => { if (fallar && /^Informe-Uw/.test(m.filename || '')) throw new Error('sales-os caído'); return guardar(m); };
  await handleWebhook({ body: deliveredUw(telefono) }, makeRes(), deps);
  const clave = `docs_entregado:uw_linea:V2N:${telefono.slice(-9)}`;
  assert.ok(await esperar(() => estado.get(clave)?.valor?.archivo === 'fallo'), `marca: ${JSON.stringify(estado.get(clave))}`);
  assert.deepEqual(archivosUw(spy), []);
  fallar = false;
  const read = { entry: [{ changes: [{ value: { statuses: [{ id: 'uw.1', status: 'read', recipient_id: telefono }] } }] }] };
  await handleWebhook({ body: read }, makeRes(), deps);
  assert.ok(await esperar(() => archivosUw(spy).length === 1), 'el read reparó el archivo');
  assert.equal(estado.get(clave).valor.archivo, 'si');
  await handleWebhook({ body: read }, makeRes(), deps);
  await new Promise((r) => { setTimeout(r, 100); });
  assert.equal(archivosUw(spy).length, 1, 'y no se duplica');
  assert.equal(spy.eventos.filter((e) => /Informe Uw.*ENTREGADO/.test(e.body || '')).length, 1, 'el evento sale una sola vez');
});

test('📐 D16 un READ sin delivered previo también registra la entrega', async () => {
  const { deps, spy, telefono } = armarUw();
  await conPiloto(telefono, async () => {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
  });
  const read = { entry: [{ changes: [{ value: { statuses: [{ id: 'uw.1', status: 'read', recipient_id: telefono }] } }] }] };
  await handleWebhook({ body: read }, makeRes(), deps);
  assert.ok(await esperar(() => archivosUw(spy).length === 1));
});
