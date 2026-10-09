// src/envio/waEnvio.js — [2026-10-09] el resultado REAL de un envío de texto por WhatsApp.
//
// POR QUÉ EXISTE. `waSend` (index.js) se tragaba cualquier error de Meta y devolvía undefined, y
// /internal/operator-send contestaba {ok:true, sent:true} igual. Medido 09-oct (investigación de la
// compuerta del piloto Oliver interno, Codex NO APTO): un "enviado" en sales-os NO probaba ni que Meta
// lo hubiera aceptado, y además NUNCA traía el id del mensaje (wamid), así que ningún acuse se podía cruzar.
// Le pega a todo lo que manda la plataforma: el inbox, «liberar» cotizaciones y los avisos al dueño
// (notificarDueno creía el ok:true y no usaba su respaldo por Cloud API).
//
// Contrato: NUNCA lanza (index.js tiene ~30 llamadores que no esperan excepción).
//   { ok: true,  wamid }                       Meta aceptó (aceptar ≠ entregar: eso llega por el acuse)
//   { ok: false, error, codigo, ambiguo:false } Meta CONTESTÓ que no → seguro que no salió
//   { ok: false, error, codigo:null, ambiguo:true } Meta no contestó (timeout/red) → PUDO haber salido

export async function enviarTextoWA(http, phoneId, to, body, { logErr } = {}) {
  try {
    const r = await http.post(`/${phoneId}/messages`, {
      messaging_product: 'whatsapp', to, type: 'text', text: { body },
    });
    return { ok: true, wamid: r?.data?.messages?.[0]?.id || null };
  } catch (e) {
    try { logErr?.('waSend', e); } catch { /* el log no puede romper el envío */ }
    const err = e?.response?.data?.error;
    return {
      ok: false,
      error: String(err?.message || e?.message || 'meta_error'),
      codigo: err?.code ?? null,
      ambiguo: !e?.response,
    };
  }
}

/** Respuesta HTTP de /internal/operator-send según el envío (WhatsApp). */
export function respuestaOperatorSend(envio, phone) {
  if (envio && envio.ok === false) {
    return { http: 502, body: {
      ok: false,
      error: envio.ambiguo ? 'meta_sin_respuesta' : 'meta_rechazo',
      ambiguo: !!envio.ambiguo,
      detalle: envio.error || null,
      codigo: envio.codigo ?? null,
    } };
  }
  return { http: 200, body: { ok: true, sent: true, phone, message_id: envio?.wamid || null } };
}
