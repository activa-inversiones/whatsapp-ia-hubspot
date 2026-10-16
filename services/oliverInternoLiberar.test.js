// [2026-10-12 · #1500-C] LIBERAR DESDE LA AGENDA = LA MISMA PROPUESTA QUE MANDA OLIVER POR WHATSAPP.
//
// Pedido del dueño (12-oct 09:20, textual): «debemos entregarle LA PROPUESTA TÉCNICO ECONÓMICA, además debo ver
// si le entregamos con algún selector el informe térmico, informe de vientos y clima o solo la actualización de
// precio». Decisión A (dueño, 09:50): entrar por el MISMO camino sin LLM que usa el webhook cuando el cliente
// dice «sí» a la propuesta (`pdf.deterministic`): mismo folio, mismo PDF premium, mismo envío, Zoho, ISO,
// informes y marcas de entrega. Este módulo es la puerta: `POST /internal/oliver-interno/liberar` arma un
// turno interno para el teléfono del cliente y le pide a `handleWebhook` que emita (deps.emisionInterna).
// Hermético: app, auth y handleWebhook se inyectan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemsDesdeLineasBot, registrarRutaLiberar, clasificarResultadoEmision, RUTA_LIBERAR, MARCA_EMISION_INTERNA, TOPE_ESPERA_MS } from './oliverInternoLiberar.js';

// [#1500-C r4 · Codex r2] LA CLASIFICACIÓN DEL RESULTADO DEL PIPELINE ES UNA FUNCIÓN PURA (y por eso testeable sin montar
// el webhook): lo que `toolCtx.generarPdf` devuelve → lo que sales-os necesita decidir sin reintentar a ciegas.
test('[#1500-C r4] clasificarResultadoEmision: enviado / duplicada CON folio / en vuelo SIN folio / folio sin PDF (dudoso o rechazado) / sin folio / null', () => {
  const c = clasificarResultadoEmision;
  assert.deepEqual(c({ ok: true, quote_number: 'X-1', pdf_sent: true, message: 'Listo' }), { ok: true, deduped: false, eleccion: false, quote_number: 'X-1', pdf_sent: true, error: null, message: 'Listo' });
  assert.deepEqual(c({ ok: true, quote_number: 'X-1', pdf_sent: false, deduped: true }), { ok: true, deduped: true, eleccion: false, quote_number: 'X-1', pdf_sent: false, error: null, message: null });
  // Codex r2 DEFECTO 2: «emisión idéntica EN VUELO» viene como deduped SIN folio: NO es éxito (la primera puede fallar).
  assert.deepEqual(c({ ok: true, pdf_sent: false, deduped: true, message: 'ya la estoy preparando' }), { ok: false, deduped: false, eleccion: false, quote_number: null, pdf_sent: false, error: 'emision_en_vuelo', message: 'ya la estoy preparando' });
  assert.deepEqual(c({ ok: true, quote_number: 'X-2', pdf_sent: false, entrega_dudosa: true, message: 'Tuve un problema…' }), { ok: false, deduped: false, eleccion: false, quote_number: 'X-2', pdf_sent: false, error: 'pdf_dudoso', message: 'Tuve un problema…' });
  assert.deepEqual(c({ ok: true, quote_number: 'X-3', pdf_sent: false, entrega_dudosa: false, message: 'Meta lo rechazó' }), { ok: false, deduped: false, eleccion: false, quote_number: 'X-3', pdf_sent: false, error: 'pdf_no_entregado', message: 'Meta lo rechazó' });
  assert.deepEqual(c({ ok: false, reason: 'datos_incompletos', message: '¿Qué tipo de apertura?' }), { ok: false, deduped: false, eleccion: false, quote_number: null, pdf_sent: false, error: 'datos_incompletos', message: '¿Qué tipo de apertura?' });
  assert.deepEqual(c(null), { ok: false, deduped: false, eleccion: false, quote_number: null, pdf_sent: false, error: 'no_emitida', message: null });
});

// [#1500-C r5 · NIM 12-oct, verificado en webhook.js:3636 + propuestas-color.js opcionYaEntregada] LA OPCIÓN DE LA TERNA YA ENTREGADA.
// Si el cliente recibió por WhatsApp una terna de colores A/B/C (<48 h, mismo proyecto) y el vendedor libera desde la agenda
// ese mismo proyecto con UNO de esos colores, generarPdf no emite nada nuevo: devuelve {ok:true, pdf_sent:false, eleccion:true}
// con el folio de esa opción (opcionYaEntregada matchea por color aunque el texto del cliente sea ''). Eso es «ya la tiene»,
// no «Meta rechazó el PDF»: r4 lo rotulaba pdf_no_entregado y el vendedor veía un rechazo falso con la cotización incierta.
test('[#1500-C r5] clasificarResultadoEmision: la opción de la terna ya entregada (eleccion:true) es «ya la tiene», con eleccion:true, no pdf_no_entregado', () => {
  const r = clasificarResultadoEmision({ ok: true, quote_number: '0353-B', pdf_sent: false, eleccion: true, message: 'Perfecto: se queda con la opción B — Nogal, N° 0353-B.' });
  assert.deepEqual(r, { ok: true, deduped: true, eleccion: true, quote_number: '0353-B', pdf_sent: false, error: null, message: 'Perfecto: se queda con la opción B — Nogal, N° 0353-B.' });
  // Sin folio no hay opción que «ya tenga»: no se inventa un éxito.
  assert.equal(clasificarResultadoEmision({ ok: true, pdf_sent: false, eleccion: true }).ok, false);
});

const LINEA_BOW = {
  n: 1, herramienta: 'calcular_cotizacion',
  pedido: { tipo: 'FIJA', medidas_texto: '2500x1500x500 mm', cantidad: 1, color: 'NOGAL', comuna: 'Angol' },
  resultado: { ok: true, unit_price: 792902, total_neto: 792902, cantidad: 1, glass_label: 'Termopanel 5+12+5',
    producto_label: 'Bow window · ventana en esquina (3 paños, union 90°): Compuesto 500mm + Fijo 2500mm + Compuesto 500mm',
    medidas_resueltas: '3500x1500mm' },
};

test('[#1500-C] itemsDesdeLineasBot: las líneas del borrador vuelven a ser los items del PDF con la MISMA función que usa WhatsApp (itemsFromQuoteCalls)', () => {
  const items = itemsDesdeLineasBot([LINEA_BOW, { n: 2, herramienta: 'calcular_cotizacion', pedido: {}, resultado: { ok: false, error: 'x' } }]);
  assert.equal(items.length, 1, 'una línea sin resultado ok no entra al PDF');
  assert.equal(items[0].producto_label, LINEA_BOW.resultado.producto_label);
  assert.equal(items[0].unit_price, 792902);
  assert.equal(items[0].qty, 1);
  assert.equal(items[0].measures, '3500x1500');
  assert.equal(items[0].color, 'NOGAL');
  assert.equal(items[0].glass_label, 'Termopanel 5+12+5');
});

function appFalsa() {
  const rutas = {};
  return { rutas, post: (p, ...fns) => { rutas[p] = fns.at(-1); } };
}
function resFalsa() {
  const r = { codigo: 200, cuerpo: null };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  return r;
}
const BODY_OK = { phone: '56941380749', nombre: 'Claudio', comuna: 'Angol', lineas: [LINEA_BOW], operador: 'Mary', documentos_elegidos: { termico: true, vientos: false }, borrador_id: 'q-sales-os-1' };

async function pedir({ auth = true, body, webhook, topeMs }) {
  const app = appFalsa();
  const llamadas = [];
  registrarRutaLiberar(app, {
    validInternalOperatorToken: () => auth,
    handleWebhook: async (req, res, deps) => { llamadas.push({ req, deps }); return webhook ? webhook(req, res, deps) : undefined; },
    ...(topeMs ? { topeEsperaMs: topeMs } : {}),
  });
  const h = app.rutas[RUTA_LIBERAR];
  assert.ok(h, `registra ${RUTA_LIBERAR}`);
  const res = resFalsa();
  await h({ body, get: () => '' }, res);
  return { res, llamadas };
}

test('[#1500-C r2 · Thermos B1] el color que eligió el vendedor (body.color) es el color por defecto de los ítems cuando el LLM no lo puso en el pedido', async () => {
  const sinColor = { ...LINEA_BOW, pedido: { ...LINEA_BOW.pedido, color: undefined } };
  const { llamadas } = await pedir({
    body: { ...BODY_OK, color: 'NOGAL', lineas: [sinColor] },
    webhook: async (_req, res, deps) => { res.sendStatus(200); deps.emisionInterna.onResultado({ ok: true, quote_number: 'X' }); },
  });
  assert.equal(llamadas[0].deps.emisionInterna.items[0].color, 'NOGAL', 'sin color en el pedido, manda el del vendedor');
  const conColor = await pedir({
    body: { ...BODY_OK, color: 'BLANCO' },
    webhook: async (_req, res, deps) => { res.sendStatus(200); deps.emisionInterna.onResultado({ ok: true, quote_number: 'X' }); },
  });
  assert.equal(conColor.llamadas[0].deps.emisionInterna.items[0].color, 'NOGAL', 'con color en el pedido (NOGAL), ese manda sobre el default');
});

test('[#1500-C] sin token interno → 401; sin teléfono o sin líneas cotizadas → 400 y no se emite nada', async () => {
  assert.equal((await pedir({ auth: false, body: BODY_OK })).res.codigo, 401);
  const sinTel = await pedir({ body: { ...BODY_OK, phone: '' } });
  assert.equal(sinTel.res.codigo, 400);
  assert.equal(sinTel.llamadas.length, 0);
  const sinLineas = await pedir({ body: { ...BODY_OK, lineas: [{ n: 1, herramienta: 'calcular_cotizacion', pedido: {}, resultado: { ok: false } }] } });
  assert.equal(sinLineas.res.codigo, 400);
  assert.match(sinLineas.res.cuerpo.error, /sin líneas cotizadas/);
});

test('[#1500-C] arma el turno interno: inbound sintético del teléfono del cliente con la MARCA, y deps.emisionInterna con items, nombre, comuna, documentos y operador', async () => {
  const { res, llamadas } = await pedir({
    body: BODY_OK,
    webhook: async (_req, res, deps) => {
      res.sendStatus(200);
      deps.emisionInterna.onResultado({ ok: true, quote_number: 'CM-FR-004-2026-0800', message: 'Listo ✅', pdf_sent: true });
    },
  });
  assert.equal(llamadas.length, 1);
  const { deps } = llamadas[0];
  const inbound = deps.parseInbound({});
  assert.equal(inbound.ok, true);
  assert.equal(inbound.from, '56941380749');
  assert.equal(inbound.type, 'text');
  assert.equal(inbound.text, MARCA_EMISION_INTERNA);
  assert.match(String(inbound.msgId), /^interno-/);
  const ei = deps.emisionInterna;
  assert.equal(ei.nombre, 'Claudio');
  assert.equal(ei.comuna, 'Angol');
  assert.equal(ei.operador, 'Mary');
  assert.equal(ei.borrador_id, 'q-sales-os-1', '[#1504 r5] el id del borrador viaja al pipeline y vuelve en el quote-event');
  assert.deepEqual(ei.documentos, { termico: true, vientos: false });
  assert.equal(ei.items.length, 1);
  assert.equal(ei.items[0].unit_price, 792902);
  assert.equal(res.codigo, 200, JSON.stringify(res.cuerpo));
  assert.deepEqual(res.cuerpo, { ok: true, deduped: false, eleccion: false, quote_number: 'CM-FR-004-2026-0800', message: 'Listo ✅', pdf_sent: true });
  assert.ok(Number(ei.deadline) > Date.now(), 'lleva plazo (deadline): el webhook no emite después del tope');
});

test('[#1500-C r5] la opción de la terna ya entregada viaja en el 200: deduped:true y eleccion:true (sales-os lo explica distinto de una duplicada de 2 minutos)', async () => {
  const { res } = await pedir({ body: BODY_OK, webhook: async (_req, res, deps) => { res.sendStatus(200);
    deps.emisionInterna.onResultado({ ok: true, deduped: true, eleccion: true, quote_number: 'CM-FR-004-2026-0800-B', pdf_sent: false, message: 'Perfecto: se queda con la opción B.' }); } });
  assert.equal(res.codigo, 200);
  assert.deepEqual(res.cuerpo, { ok: true, deduped: true, eleccion: true, quote_number: 'CM-FR-004-2026-0800-B', message: 'Perfecto: se queda con la opción B.', pdf_sent: false });
});

test('[#1500-C r3 · Thermos] el fallo con folio viaja entero: 502 con error y quote_number, y `detalle` es texto (no un objeto)', async () => {
  const { res } = await pedir({ body: BODY_OK, webhook: async (_req, res, deps) => { res.sendStatus(200);
    deps.emisionInterna.onResultado({ ok: false, quote_number: 'CM-FR-004-2026-0801', pdf_sent: false, error: 'pdf_dudoso', message: 'Tuve un problema para adjuntar…' }); } });
  assert.equal(res.codigo, 502);
  assert.deepEqual(res.cuerpo, { ok: false, error: 'pdf_dudoso', quote_number: 'CM-FR-004-2026-0801', detalle: 'Tuve un problema para adjuntar…' });
});

test('[#1500-C r3 · Thermos D-N3] una emisión DUPLICADA (el cliente ya la tiene) es 200 ok con deduped:true y pdf_sent:false', async () => {
  const { res } = await pedir({ body: BODY_OK, webhook: async (_req, res, deps) => { res.sendStatus(200);
    deps.emisionInterna.onResultado({ ok: true, deduped: true, quote_number: 'CM-FR-004-2026-0800', pdf_sent: false, message: null }); } });
  assert.equal(res.codigo, 200);
  assert.deepEqual(res.cuerpo, { ok: true, deduped: true, eleccion: false, quote_number: 'CM-FR-004-2026-0800', message: null, pdf_sent: false });
});

test('[#1500-C] si el webhook no contesta (se cuelga) → 504 emision_sin_respuesta; si contesta ok:false → 502 con el motivo', async () => {
  // ⚠️ [2026-10-16 · #1524] Se le agregó el `setInterval` y ACÁ QUEDA POR QUÉ. Medido el 16-oct sobre `main` (sin tocar nada):
  // este test y el siguiente salían CANCELADOS («Promise resolution is still pending but the event loop has already
  // resolved»). El tope de la ruta es un timer `unref` A PROPÓSITO (no puede sostener el proceso: ver correrTurnoInterno);
  // con el webhook colgado no queda NADA vivo en el loop y node --test corta antes de que venza. En el servidor el loop lo
  // sostiene Express. Lo que se prueba no cambia (504 al vencer el tope): solo se sostiene el loop mientras se espera.
  // La orden: «npm test completo… ningún rojo» (tarea programada #1524 del dueño, 15/16-oct).
  const vivo = setInterval(() => {}, 10);
  let colgado;
  try {
    colgado = await pedir({ body: BODY_OK, topeMs: 30, webhook: async (_req, res) => { res.sendStatus(200); /* nunca llama onResultado */ } });
  } finally { clearInterval(vivo); }
  assert.equal(colgado.res.codigo, 504);
  assert.equal(colgado.res.cuerpo.error, 'emision_sin_respuesta');
  assert.equal(TOPE_ESPERA_MS, 150000, 'el tope por defecto cubre folio + PDF + envío + informes');

  const fallo = await pedir({ body: BODY_OK, webhook: async (_req, res, deps) => { res.sendStatus(200); deps.emisionInterna.onResultado({ ok: false, error: 'sin_folio' }); } });
  assert.equal(fallo.res.codigo, 502);
  assert.equal(fallo.res.cuerpo.ok, false);
  assert.equal(fallo.res.cuerpo.error, 'sin_folio');
});

test('[#1500-C] si handleWebhook explota, 500 lector_fallo (no un 200 vacío ni una promesa colgada)', async () => {
  const { res } = await pedir({ body: BODY_OK, webhook: async () => { throw new Error('se cayó'); } });
  assert.equal(res.codigo, 500);
  assert.match(res.cuerpo.detalle, /se cayó/);
});
