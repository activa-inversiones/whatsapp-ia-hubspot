// [2026-10-16 · #1524] «LIBERAR → SOLO LOS INFORMES»: térmico y/o clima y viento, SIN propuesta ni folio de cotización.
//
// 🔴 POR QUÉ EXISTE (dueño, 14-oct, textual): *«solo decir propuesta, informe térmico, informe clima y viento, los 3 por
// separado y listo»*. Las tres casillas ya estaban en la agenda (#1523), pero el bot solo sabía mandar los informes DENTRO de
// la emisión de la propuesta (webhook.js generarPdf: salen solo si el PDF se entregó). Caso que lo originó: la 0646 (cliente
// 937128468) salió sin informes porque ya los tenía de la 0644, y no había forma de mandárselos sin otra propuesta.
//
// Cómo: el MISMO turno interno que «liberar» (`correrTurnoInterno`: inbound sintético con la marca, lock del teléfono, sin
// LLM), con `emisionInterna.soloInformes = {termico, vientos}`. El webhook, al verlo, NO llama a generarPdf: llama a las
// mismas funciones que manda la propuesta (`despacharInforme` y `crearEnviarInformeVientos`) con `forzar: true` (lo pidió una
// persona a mano). Candados, correlativo ISO (CM-FR-006 / CM-FR-007), marcas de entrega y registro ISO son los de siempre.
// La ventana de 24 h de WhatsApp la mira sales-os ANTES de llamar acá (fuera de la ventana un documento no llega).
import { itemsDesdeLineasBot, correrTurnoInterno, TOPE_ESPERA_MS } from './oliverInternoLiberar.js';

export const RUTA_INFORMES = '/internal/oliver-interno/informes';

/** Lo que pidió sales-os: `{termico, vientos}` booleanos estrictos. PURA. */
export function informesPedidos(b) {
  const x = b && typeof b.informes === 'object' && b.informes ? b.informes : {};
  return { termico: x.termico === true, vientos: x.vientos === true };
}

/**
 * Lo que devolvió el turno → la respuesta HTTP. PURA (con sus tests).
 *   · tope vencido                → 504 emision_sin_respuesta (INCIERTO: un informe pudo salir)
 *   · el turno corrió los informes → 200 {ok, solo_informes:true, informes:{termico, vientos}} (ok = salió TODO lo pedido;
 *                                    cada informe dice 'enviado' | 'ya_enviado' | 'en_curso' | 'fallo' | 'sin_datos' | null)
 *   · el turno no llegó a correrlos → 502 con el motivo ('vencida', 'cliente_es_del_equipo', …): no salió nada
 */
export function respuestaInformes(out) {
  if (out && out.timeout) return { http: 504, body: { ok: false, error: 'emision_sin_respuesta' } };
  if (out && out.solo_informes === true && out.informes && typeof out.informes === 'object') {
    const i = out.informes;
    return { http: 200, body: { ok: out.ok === true, solo_informes: true,
      informes: { termico: i.termico == null ? null : String(i.termico), vientos: i.vientos == null ? null : String(i.vientos) } } };
  }
  return { http: 502, body: { ok: false, error: String((out && (out.error || out.reason)) || 'informes_no_corrieron') } };
}

/** Registra `POST /internal/oliver-interno/informes`. Mismo guardia de token que liberar y operator-send. */
export function registrarRutaInformes(app, { validInternalOperatorToken, handleWebhook, json = null, topeEsperaMs = TOPE_ESPERA_MS } = {}) {
  if (typeof validInternalOperatorToken !== 'function') throw new Error('registrarRutaInformes: falta validInternalOperatorToken');
  if (typeof handleWebhook !== 'function') throw new Error('registrarRutaInformes: falta handleWebhook');
  const handler = async (req, res) => {
    try {
      if (!validInternalOperatorToken(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
      const b = req.body || {};
      const phone = String(b.phone || '').replace(/[^0-9]/g, '');
      if (!phone) return res.status(400).json({ ok: false, error: 'phone_requerido' });
      const pedidos = informesPedidos(b);
      if (!pedidos.termico && !pedidos.vientos) return res.status(400).json({ ok: false, error: 'ningun_informe_pedido' });
      const campo = (k) => String(b[k] || '').trim().slice(0, 80);
      // Los datos del BORRADOR (comuna, ventanas, vidrio, Uw del motor): las mismas líneas que usa liberar → items del PDF.
      const items = itemsDesdeLineasBot(b.lineas, campo('color'));
      if (!items.length) return res.status(400).json({ ok: false, error: 'sin líneas cotizadas: el informe no tiene ventanas' });
      if (!campo('comuna')) return res.status(400).json({ ok: false, error: 'comuna_requerida' }); // el informe es DE una comuna
      const out = await correrTurnoInterno({
        handleWebhook, phone, topeEsperaMs,
        emisionInterna: {
          items, nombre: campo('nombre'), comuna: campo('comuna'), operador: campo('operador') || 'Agenda',
          borrador_id: campo('borrador_id') || null, soloInformes: pedidos,
        },
      });
      const r = respuestaInformes(out);
      return res.status(r.http).json(r.body);
    } catch (e) {
      console.error('[oliver-interno/informes] error:', e && e.message ? e.message : e);
      return res.status(500).json({ ok: false, error: 'informes_fallo', detalle: String(e && e.message ? e.message : e).slice(0, 200) });
    }
  };
  if (json) app.post(RUTA_INFORMES, json, handler); else app.post(RUTA_INFORMES, handler);
}

export default { registrarRutaInformes, respuestaInformes, informesPedidos, RUTA_INFORMES };
