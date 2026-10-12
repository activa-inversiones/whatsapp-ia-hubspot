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
import { itemsDesdeLineasBot, registrarRutaLiberar, RUTA_LIBERAR, MARCA_EMISION_INTERNA, TOPE_ESPERA_MS } from './oliverInternoLiberar.js';

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
const BODY_OK = { phone: '56941380749', nombre: 'Claudio', comuna: 'Angol', lineas: [LINEA_BOW], operador: 'Mary', documentos_elegidos: { termico: true, vientos: false } };

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
  assert.deepEqual(ei.documentos, { termico: true, vientos: false });
  assert.equal(ei.items.length, 1);
  assert.equal(ei.items[0].unit_price, 792902);
  assert.equal(res.codigo, 200, JSON.stringify(res.cuerpo));
  assert.deepEqual(res.cuerpo, { ok: true, deduped: false, quote_number: 'CM-FR-004-2026-0800', message: 'Listo ✅', pdf_sent: true });
  assert.ok(Number(ei.deadline) > Date.now(), 'lleva plazo (deadline): el webhook no emite después del tope');
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
  assert.deepEqual(res.cuerpo, { ok: true, deduped: true, quote_number: 'CM-FR-004-2026-0800', message: null, pdf_sent: false });
});

test('[#1500-C] si el webhook no contesta (se cuelga) → 504 emision_sin_respuesta; si contesta ok:false → 502 con el motivo', async () => {
  const colgado = await pedir({ body: BODY_OK, topeMs: 30, webhook: async (_req, res) => { res.sendStatus(200); /* nunca llama onResultado */ } });
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
