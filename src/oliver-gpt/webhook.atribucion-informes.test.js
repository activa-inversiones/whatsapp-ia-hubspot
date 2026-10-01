// webhook.atribucion-informes.test.js — [2026-09-30] Tridente r3, hallazgos #1 y #2.
//
// DECISIÓN DEL DUEÑO (30-sep): cuando un vendedor cotiza a nombre de un cliente con el comando
// CLIENTE, TODO lo que se emite es del CLIENTE: la propuesta, y también los informes térmico y de
// vientos (correlativo ISO, registro de entrega, archivo en media_attachments, espejo en el cockpit).
// Lo único que queda con el número del vendedor es el ACUSE del envío (lleva msgId), porque ese sí
// es del chat donde se mandó.
// Arnés hijo de webhook.secuencia-informe.test.js (hermético, sin red).

import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook } from './webhook.js';
import { fijar, _resetAtribuciones } from '../../services/atribucionStore.js';
import { _resetConsentimiento } from '../../services/consentimiento.js';
const resetAtribucion = () => { _resetAtribuciones(); _resetConsentimiento(); };
import { aplicarLista, _reiniciarParaTests } from '../../services/internosEquipo.js';

const VENDEDOR = '56911110000';
const CLIENTE = '56987654321';

// Con URL y token: los correlativos y registros de informe SÍ viajan (al fetch simulado).
process.env.SALES_OS_URL = process.env.SALES_OS_URL || 'https://sales-os.test';
process.env.SALES_OS_OPERATOR_TOKEN = process.env.SALES_OS_OPERATOR_TOKEN || 'test-operator-token';
const CUERPOS = [];
global.fetch = async (url, init) => {
  try { if (typeof init?.body === 'string') CUERPOS.push({ url: String(url), body: JSON.parse(init.body) }); } catch { /* no JSON */ }
  if (String(url).includes('/internal/quotes/next-number')) {
    return { ok: true, status: 200, json: async () => ({ quote_number: 'CM-FR-004-2026-8888' }) };
  }
  if (String(url).includes('/internal/informes/next-number')) {
    return { ok: true, status: 200, json: async () => ({ informe_number: 'CM-FR-006-2026-8888' }) };
  }
  return { ok: false, status: 503, json: async () => ({}) };
};

const DATOS_COMUNA = { comuna: 'Temuco', regimen: 'PDA', uw_max_Wm2K: 3.2, zona_termica_NCh1079: 'F', criterio_ref: 'PDA Temuco art. 27' };
const VENTANAS = [
  { producto: 'Ventana PVC S60 corredera', medidas: '2100x1400mm', vidrio: 'DVH 5/12/5', ambiente: 'Living', cantidad: 1, uw: 2.71 },
];

function makeRes() { return { sendStatus() { return this; } }; }

function makeDeps() {
  const spy = { linea: [], convEvents: [], media: [] };
  const estado = new Map();
  let tokenSeq = 0;
  const vigente = (e) => e && (!e.expira || e.expira > Date.now());
  return { spy, deps: {
    conv: new Map(), seen: new Set(), locks: new Map(),
    dormir: async () => {},
    secuenciaInformePrimero: () => true,
    seqInformeTimeoutMs: 400,
    leerEstado: async (k) => (vigente(estado.get(k)) ? estado.get(k).valor : null),
    escribirEstado: (k, v, ttl = 300) => { estado.set(k, { valor: v, expira: Date.now() + ttl * 1000 }); },
    escribirEstadoDurable: async (k, v, ttl = 300) => { estado.set(k, { valor: v, expira: Date.now() + ttl * 1000 }); return { ok: true }; },
    fusionarEstado: (k, calcular, ttl = 300) => {
      const e = estado.get(k); const actual = vigente(e) ? e.valor : null;
      const { valor, guardar } = calcular(actual) || {};
      if (guardar && valor != null) estado.set(k, { valor, expira: Date.now() + ttl * 1000 });
      return valor === undefined ? actual : valor;
    },
    reservarEstado: (k, ttl = 300) => { if (vigente(estado.get(k))) return null; const t = `t${++tokenSeq}`; estado.set(k, { valor: t, expira: Date.now() + ttl * 1000 }); return t; },
    liberarReserva: (k, token) => { const e = estado.get(k); if (!token || !vigente(e) || e.valor !== token) return false; estado.delete(k); return true; },
    parseInbound: () => ({ ok: true, from: VENDEDOR, text: 'una corredera', msgId: `wamid.${Math.random()}`, type: 'text' }),
    sendWhatsAppText: async () => ({ ok: true, msgId: `m${Math.random()}` }),
    pedirInformeComuna: async () => DATOS_COMUNA,
    generarInformeTermicoPdf: async () => Buffer.alloc(1024, 7),
    laminasParaInforme: async () => null,
    laminaTermopanel: async () => null,
    saveMedia: async (o) => { spy.media.push(o); return { ok: true, media: { id: 1 } }; },
    upsertZohoDeal: async () => 'deal.777',
    addZohoNote: async () => ({ ok: true }),
    attachPdfToDeal: async () => ({ ok: true }),
    generatePdf: async () => Buffer.alloc(2048, 3),
    uploadWaDocument: async () => 'media.1',
    sendWaDocument: async (to, mediaId, filename) => {
      spy.linea.push(/^Informe-Vientos/.test(filename) ? 'vientos' : /^Informe-Termico/.test(filename) ? 'informe' : 'propuesta');
      return { ok: true, msgId: `doc.${spy.linea.length}` };
    },
    mediaIdsDisponibles: async () => ({ presentacion: 'wamedia.video.1' }),
    sendWaVideo: async () => { spy.linea.push('video'); return { ok: true, msgId: 'vid.1' }; },
    pedirVientos: async ({ ventanas }) => ({
      ventanas: ventanas.map((v) => ({
        nombre: v.nombre, ancho_mm: v.ancho_mm, alto_mm: v.alto_mm,
        vidrio: `DVH ${v.vidrio.ext_mm}/${v.vidrio.camara_mm}/${v.vidrio.int_mm} recocido`, cantidad: v.cantidad,
        capacidad: { lr_corta_kPa: 1.89, lr_larga_kPa: 0.82 }, veredicto: { evaluable: true, cumple_corta: true },
        flechas: { referencia: { flecha_maxima_mm: 14.5 } },
      })),
      demanda: { presion_kPa: 0.675, q_basica_kg_m2: 57.3, factor_forma_C: 1.2 },
    }),
    generarInformeVientosPdf: async () => Buffer.alloc(512, 9),
    handleTurn: async ({ state, toolCtx }) => {
      await toolCtx.generarPdf({
        items: VENTANAS.map((v) => ({
          product: v.producto, producto_label: v.producto, measures: v.medidas, measures_original: v.medidas,
          glass_label: v.vidrio, ambiente: v.ambiente, qty: v.cantidad, unit_price: 100000, total_price: 100000,
          color: 'Nogal', termico: { uw: v.uw },
        })),
        comuna: 'Temuco', name: 'Juan Pérez',
      });
      return { reply: 'Listo', history: [], toolCalls: [], state: { ...state } };
    },
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async (p) => { spy.convEvents.push(p); return { ok: true }; },
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async () => ({ ok: true }),
    },
    notifyHighValue: async () => ({ sent: true }),
  } };
}

async function esperar(cond, ms = 8000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (cond()) return true; await new Promise((r) => setTimeout(r, 10)); }
  return false;
}

test('Tridente r3 #1/#2 (30-sep): bajo atribución los informes (correlativo, registro, archivo, espejos) son del CLIENTE', async () => {
  _reiniciarParaTests(); resetAtribucion(); CUERPOS.length = 0;
  aplicarLista({ lista_confiable: true, internos_ult9: ['911110000'], vendedores: [{ ult9: '911110000', telefono: VENDEDOR, oliver_interno: true }] });
  fijar(VENDEDOR, CLIENTE, 'Juan Pérez');
  const { deps, spy } = makeDeps();
  try {
    await handleWebhook({ body: {} }, makeRes(), deps);
    assert.ok(await esperar(() => spy.linea.includes('propuesta') && spy.linea.includes('informe') && spy.linea.includes('vientos')),
      `tienen que salir propuesta, informe y vientos (línea: ${JSON.stringify(spy.linea)})`);
    await new Promise((r) => setTimeout(r, 200));
  } finally { _reiniciarParaTests(); resetAtribucion(); }

  const alVendedor = CUERPOS.filter((x) => !x.body.msgId && (x.body.telefono === VENDEDOR || x.body.phone === VENDEDOR));
  assert.deepEqual(alVendedor.map((x) => x.url), [], 'ningún correlativo ni registro de informe con el teléfono del vendedor');
  assert.deepEqual(spy.media.filter((m) => m.phone === VENDEDOR).map((m) => m.filename), [], 'ningún archivo en la ficha del vendedor');
  const espejos = spy.convEvents.filter((c) => c.direction === 'outbound' && c.external_id === VENDEDOR && c.metadata?.source !== 'oliver_gpt_webhook');
  assert.deepEqual(espejos.map((c) => c.metadata?.source), [], 'ningún espejo de documento/video en la ficha del vendedor');
  assert.ok(spy.media.some((m) => m.phone === CLIENTE), 'y sí quedan en la ficha del cliente');
});
