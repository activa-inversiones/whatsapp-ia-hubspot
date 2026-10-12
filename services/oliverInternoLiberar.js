// [2026-10-12 · #1500-C] LIBERAR DESDE LA AGENDA = LA MISMA PROPUESTA QUE OLIVER MANDA POR WHATSAPP.
//
// 🔴 POR QUÉ EXISTE (dueño, 12-oct 09:20, textual): *«debemos entregarle LA PROPUESTA TÉCNICO ECONÓMICA, además debo
// ver si le entregamos con algún selector el informe térmico, informe de vientos y clima o solo la actualización de
// precio»*. Hasta hoy «Liberar» en la agenda mandaba un TEXTO con la línea y el precio, y la cotización quedaba sin
// folio. Decisión A del dueño (09:50): no se duplica el pipeline de ~1.450 líneas del webhook (folio, PDF premium,
// envío, Zoho, registro ISO, informes térmico/vientos, marcas de entrega); se ENTRA por él, por el mismo camino sin
// LLM que usa cuando el cliente dice «sí» a la propuesta (`pdf.deterministic` en webhook.js).
//
// Cómo: sales-os pega acá con las líneas CRUDAS del borrador (las mismas que devolvió `leerYCotizar`: herramienta +
// pedido + resultado). Se vuelven items del PDF con `itemsFromQuoteCalls` —la MISMA función que arma `pending_quote`
// en WhatsApp— y se corre `handleWebhook` con un turno interno: `deps.parseInbound` entrega un inbound sintético del
// teléfono del cliente (con una MARCA que ningún regex del webhook reconoce) y `deps.emisionInterna` lleva items,
// nombre, comuna, operador y la promesa `onResultado`. El webhook, al ver `emisionInterna`, salta el LLM y llama a
// `toolCtx.generarPdf` (ver webhook.js «EMISIÓN INTERNA»). El selector de informes NO viaja por acá: sales-os deja
// la marca «próxima» (cotizacion_documentos_proxima) que el pipeline ya consume al decidir qué documentos acompañan.
import { itemsFromQuoteCalls } from '../src/oliver-gpt/pdf-intent.js';

export const RUTA_LIBERAR = '/internal/oliver-interno/liberar';
export const MARCA_EMISION_INTERNA = '⟦emisión interna desde la agenda⟧';
/** Folio + PDF + envío + Zoho + ISO + informes: en WhatsApp el turno tarda 20-90 s. Con margen. */
export const TOPE_ESPERA_MS = 150000;

/** Las líneas del borrador (herramienta/pedido/resultado) → items del PDF, con la misma función que WhatsApp. */
export function itemsDesdeLineasBot(lineas, defaultColor = '') {
  const calls = (Array.isArray(lineas) ? lineas : []).map((l) => ({ name: l && l.herramienta, input: (l && l.pedido) || {}, result: (l && l.resultado) || null }));
  return itemsFromQuoteCalls(calls, defaultColor);
}

/**
 * Registra `POST /internal/oliver-interno/liberar`. `handleWebhook` se inyecta (index.js lo importa tarde);
 * `validInternalOperatorToken` es el mismo guardia que operator-send.
 */
export function registrarRutaLiberar(app, { validInternalOperatorToken, handleWebhook, json = null, topeEsperaMs = TOPE_ESPERA_MS } = {}) {
  if (typeof validInternalOperatorToken !== 'function') throw new Error('registrarRutaLiberar: falta validInternalOperatorToken');
  if (typeof handleWebhook !== 'function') throw new Error('registrarRutaLiberar: falta handleWebhook');
  const handler = async (req, res) => {
    try {
      if (!validInternalOperatorToken(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
      const b = req.body || {};
      const phone = String(b.phone || '').replace(/[^0-9]/g, '');
      if (!phone) return res.status(400).json({ ok: false, error: 'phone_requerido' });
      const campo = (k) => String(b[k] || '').trim().slice(0, 80);
      const items = itemsDesdeLineasBot(b.lineas, campo('color'));
      if (!items.length) return res.status(400).json({ ok: false, error: 'sin líneas cotizadas: nada que emitir' });
      // `documentos_elegidos` es TRAZA (queda en el evento del chat): el efecto real viaja por la marca «próxima» de
      // documentos que sales-os deja ANTES de pedir y que generarPdf consume al decidir (cotizacion-documentos/decidir).
      const de = b.documentos_elegidos && typeof b.documentos_elegidos === 'object' ? b.documentos_elegidos : null;
      const documentos = de ? { termico: Boolean(de.termico), vientos: Boolean(de.vientos) } : null;

      let resolver;
      const resultado = new Promise((r) => { resolver = r; });
      const emisionInterna = {
        items, nombre: campo('nombre'), comuna: campo('comuna'), operador: campo('operador') || 'Agenda', documentos,
        // [Thermos E-1] Si el webhook recién llega a emitir después del tope (candado del cliente tomado), no emite.
        deadline: Date.now() + topeEsperaMs,
        onResultado: (r) => resolver(r || { ok: false, error: 'sin_resultado' }),
      };
      const msgId = `interno-${phone}-${Date.now()}`;
      const parseInbound = () => ({ ok: true, from: phone, type: 'text', text: MARCA_EMISION_INTERNA, msgId, enviadoAt: Date.now() });
      // El webhook contesta 200 a su `res` apenas entra (ACK de Meta) y sigue trabajando: acá se le da un `res` mudo y
      // se espera el resultado real por la promesa.
      const resMudo = { sendStatus: () => {}, status: () => ({ json: () => {}, send: () => {} }), json: () => {}, send: () => {} };
      const corrida = handleWebhook({ body: {}, headers: {}, query: {} }, resMudo, { parseInbound, emisionInterna });
      // El temporizador no sostiene el proceso (unref) y se limpia al resolver: medido con node --test, el timer de
      // 150 s mantenía vivo el event loop y el archivo de tests «fallaba» por tiempo con sus 5 casos en verde.
      let timerTope = null;
      const tope = new Promise((r) => {
        timerTope = setTimeout(() => r({ ok: false, error: 'emision_sin_respuesta', timeout: true }), topeEsperaMs);
        if (timerTope && typeof timerTope.unref === 'function') timerTope.unref();
      });
      // Si el webhook explota ANTES de resolver, la promesa de la corrida rechaza: se devuelve 500 con el motivo.
      let out;
      try {
        out = await Promise.race([resultado, tope, corrida.then(() => resultado)]);
      } finally {
        if (timerTope) clearTimeout(timerTope);
      }
      if (out && out.timeout) return res.status(504).json({ ok: false, error: 'emision_sin_respuesta' });
      // [Thermos r3] El folio viaja también en el fallo ('pdf_dudoso' / 'pdf_no_entregado' traen quote_number: el folio
      // existe, sales-os no debe quemar otro) y `detalle` es texto, no un objeto (E-4).
      if (!out || out.ok !== true) {
        return res.status(502).json({ ok: false, error: String((out && out.error) || 'no_emitida'), quote_number: (out && out.quote_number) || null,
          detalle: out && out.message ? String(out.message).slice(0, 300) : null });
      }
      return res.json({ ok: true, deduped: out.deduped === true, quote_number: out.quote_number || null, message: out.message || null, pdf_sent: out.pdf_sent === true });
    } catch (e) {
      console.error('[oliver-interno/liberar] error:', e && e.message ? e.message : e);
      return res.status(500).json({ ok: false, error: 'lector_fallo', detalle: String(e && e.message ? e.message : e).slice(0, 200) });
    }
  };
  if (json) app.post(RUTA_LIBERAR, json, handler); else app.post(RUTA_LIBERAR, handler);
}

export default { itemsDesdeLineasBot, registrarRutaLiberar, RUTA_LIBERAR, MARCA_EMISION_INTERNA, TOPE_ESPERA_MS };
