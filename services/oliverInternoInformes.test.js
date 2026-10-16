// [2026-10-16 · #1524] La ruta interna de «solo informes»: token, qué pide, qué contesta. Sin red ni webhook real: el
// `handleWebhook` es falso y contesta por `onResultado` como el de verdad. El cableado con el webhook real está en
// src/oliver-gpt/webhook.solo-informes1524.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrarRutaInformes, respuestaInformes, informesPedidos, RUTA_INFORMES } from './oliverInternoInformes.js';

const LINEA = { herramienta: 'calcular_cotizacion', pedido: { tipo: 'corredera', ancho_mm: 2000, alto_mm: 1400, color: 'NOGAL' },
  resultado: { ok: true, product: 'Ventana PVC S60 corredera', measures: '2000x1400', unit_price: 130000, total_price: 130000, glass_label: '5+12+5', termico: { uw: 2.7 } } };

function montar({ resultado = { ok: true, solo_informes: true, informes: { termico: 'enviado', vientos: null } }, tokenOk = true, topeEsperaMs } = {}) {
  let handler = null;
  const llamadas = [];
  const app = { post: (ruta, ...h) => { assert.equal(ruta, RUTA_INFORMES); handler = h.at(-1); } };
  const handleWebhook = async (_req, _res, deps) => {
    llamadas.push(deps);
    if (resultado !== 'nunca') deps.emisionInterna.onResultado(resultado);
  };
  registrarRutaInformes(app, { validInternalOperatorToken: () => tokenOk, handleWebhook, ...(topeEsperaMs ? { topeEsperaMs } : {}) });
  const pedir = async (body) => {
    const out = { status: 200, body: null };
    const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
    await handler({ body }, res);
    return out;
  };
  return { pedir, llamadas };
}
const BODY = { phone: '+56 9 3712 8468', nombre: 'Claudio', comuna: 'Angol', operador: 'Mary', lineas: [LINEA], informes: { termico: true, vientos: false }, borrador_id: 'q-1' };

test('[#1524] sin token interno → 401 y el webhook NO corre', async () => {
  const { pedir, llamadas } = montar({ tokenOk: false });
  const r = await pedir(BODY);
  assert.equal(r.status, 401);
  assert.equal(llamadas.length, 0);
});

test('[#1524] sin ningún informe marcado → 400 y NO se manda nada (no hay «modo por defecto» que mande algo)', async () => {
  const { pedir, llamadas } = montar();
  const r = await pedir({ ...BODY, informes: { termico: false, vientos: false } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'ningun_informe_pedido');
  assert.equal(llamadas.length, 0);
  // «true» como texto no cuenta: solo booleanos de verdad.
  assert.deepEqual(informesPedidos({ informes: { termico: 'true', vientos: 1 } }), { termico: false, vientos: false });
});

test('[#1524] sin líneas del borrador o sin comuna → 400: el informe no tiene ventanas ni comuna que declarar', async () => {
  const { pedir, llamadas } = montar();
  assert.equal((await pedir({ ...BODY, lineas: [] })).status, 400);
  assert.equal((await pedir({ ...BODY, comuna: '' })).status, 400);
  assert.equal(llamadas.length, 0);
});

test('[#1524] el turno interno lleva soloInformes con los datos del BORRADOR (teléfono, comuna, ventanas con su Uw) y la marca de siempre', async () => {
  const { pedir, llamadas } = montar();
  const r = await pedir(BODY);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, solo_informes: true, informes: { termico: 'enviado', vientos: null } });
  const ei = llamadas[0].emisionInterna;
  assert.deepEqual(ei.soloInformes, { termico: true, vientos: false });
  assert.equal(ei.comuna, 'Angol');
  assert.equal(ei.operador, 'Mary');
  assert.equal(ei.borrador_id, 'q-1');
  assert.equal(ei.items.length, 1);
  assert.equal(ei.items[0].termico.uw, 2.7, 'el Uw que calculó el motor al retener viaja al informe');
  assert.ok(Number(ei.deadline) > Date.now(), 'con tope: si el lock del cliente demora, no sale a destiempo');
  const inbound = llamadas[0].parseInbound();
  assert.equal(inbound.from, '56937128468');
  assert.equal(inbound.text, '⟦emisión interna desde la agenda⟧', 'la misma marca que liberar: ningún regex del webhook la reconoce');
});

test('[#1524] el bot no alcanzó a terminar (tope) → 504 INCIERTO, nunca «enviado»', async () => {
  const { pedir } = montar({ resultado: 'nunca', topeEsperaMs: 30 });
  // El tope usa un timer `unref` (no sostiene el proceso: ver correrTurnoInterno). En el servidor el loop vive por Express;
  // acá se lo sostiene a mano mientras dura la espera.
  const vivo = setInterval(() => {}, 10);
  let r;
  try { r = await pedir(BODY); } finally { clearInterval(vivo); }
  assert.equal(r.status, 504);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.error, 'emision_sin_respuesta');
});

test('[#1524] respuestaInformes: informe que no salió = ok:false con el detalle; turno que no corrió = 502 con el motivo', () => {
  assert.deepEqual(respuestaInformes({ ok: false, solo_informes: true, informes: { termico: 'enviado', vientos: 'fallo' } }),
    { http: 200, body: { ok: false, solo_informes: true, informes: { termico: 'enviado', vientos: 'fallo' } } });
  assert.deepEqual(respuestaInformes({ ok: false, error: 'vencida' }), { http: 502, body: { ok: false, error: 'vencida' } });
  assert.deepEqual(respuestaInformes(null), { http: 502, body: { ok: false, error: 'informes_no_corrieron' } });
  // Un «ok» sin la forma de solo informes NO pasa por éxito (p. ej. un bot viejo que emitió otra cosa).
  assert.equal(respuestaInformes({ ok: true, pdf_sent: true }).http, 502);
});
