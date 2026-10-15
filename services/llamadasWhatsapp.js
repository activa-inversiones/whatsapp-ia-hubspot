// ════════════════════════════════════════════════════════════════════════════
// [2026-10-14 · #702] LLAMADAS DE WHATSAPP POR EL NÚMERO DE OLIVER (Calling API de Meta, Cloud API).
//
// Dueño, textual: «podríamos llamar y enviar a cliente en vez de WhatsApp llamarlos por teléfono, WhatsApp será
// más genial» · «ok proceder». Etapa 1: el cliente LLAMA al número de Oliver y se contesta desde el navegador
// (inbox). Las llamadas que hace el cliente son gratis (Meta, Calling API Pricing).
//
// Cómo funciona (documentación de Meta, calling/user-initiated-calls):
//   1. Meta manda al webhook un cambio con field = 'calls': event 'connect', direction USER_INITIATED y la SDP
//      OFERTA (WebRTC). Hay ~30-60 s para contestar.
//   2. El navegador arma la SDP RESPUESTA y se le manda a Meta con POST /{PHONE_ID}/calls action 'pre_accept' y
//      luego 'accept' (la MISMA SDP en las dos). Media: WebRTC (ICE, DTLS, SRTP), audio OPUS.
//   3. Al cortar llega event 'terminate' (COMPLETED/FAILED, con duración si se habló). Colgar desde acá =
//      action 'terminate' (Meta pide mandarlo aunque ya haya BYE en la media, por la facturación).
//
// Este bot es el ÚNICO que habla con Meta (tiene el token). La plataforma (sales-os) guarda las llamadas y el
// navegador las ve por ella: acá solo (a) se reconocen los avisos y se le reenvían, y (b) se ejecutan las acciones.
// ════════════════════════════════════════════════════════════════════════════

export const RUTA_ACCION_LLAMADA = '/internal/llamadas/accion';
export const ACCIONES_LLAMADA = Object.freeze(['pre_accept', 'accept', 'reject', 'terminate']);

/**
 * Los avisos de llamada de un body de webhook de Meta, normalizados. [] si no hay ninguno (el webhook sigue su
 * camino normal intacto). Lee `calls` (connect/terminate) y `statuses` de tipo 'call' (RINGING/ACCEPTED/...).
 */
export function eventosDeLlamada(body) {
  const out = [];
  for (const entry of (body && Array.isArray(body.entry) ? body.entry : [])) {
    for (const ch of (Array.isArray(entry && entry.changes) ? entry.changes : [])) {
      if (!ch || ch.field !== 'calls') continue;
      const v = ch.value || {};
      for (const c of (Array.isArray(v.calls) ? v.calls : [])) {
        if (!c || !c.id) continue;
        out.push({
          call_id: String(c.id),
          evento: String(c.event || ''),
          direccion: String(c.direction || ''),
          desde: String(c.from || ''),
          hacia: String(c.to || ''),
          sdp_tipo: c.session && c.session.sdp_type ? String(c.session.sdp_type) : null,
          sdp: c.session && c.session.sdp ? String(c.session.sdp) : null,
          estado: c.status ? String(c.status) : null,
          duracion_s: Number.isFinite(Number(c.duration)) ? Number(c.duration) : null,
          ts: c.timestamp ? Number(c.timestamp) : null,
        });
      }
      for (const s of (Array.isArray(v.statuses) ? v.statuses : [])) {
        if (!s || !s.id || s.type !== 'call') continue;
        out.push({ call_id: String(s.id), evento: 'status', direccion: null, desde: null, hacia: String(s.recipient_id || ''),
          sdp_tipo: null, sdp: null, estado: s.status ? String(s.status) : null, duracion_s: null, ts: s.timestamp ? Number(s.timestamp) : null });
      }
    }
  }
  return out;
}

/** true si el body trae SOLO avisos de llamada (nada de mensajes ni estados de mensajes): solo entonces el webhook
 * puede contestar 200 y salir sin pasar por el flujo de Oliver. */
export function soloAvisosDeLlamada(body) {
  const entradas = body && Array.isArray(body.entry) ? body.entry : [];
  return entradas.length > 0 && entradas.every((en) => Array.isArray(en && en.changes) && en.changes.length > 0
    && en.changes.every((ch) => ch && ch.field === 'calls'));
}

/** El mismo body SIN los cambios de llamada (para que el flujo de mensajes lea el mensaje del cliente en changes[0]). */
export function quitarAvisosDeLlamada(body) {
  if (!body || !Array.isArray(body.entry)) return body;
  return { ...body, entry: body.entry
    .map((en) => ({ ...en, changes: (Array.isArray(en && en.changes) ? en.changes : []).filter((ch) => !(ch && ch.field === 'calls')) }))
    .filter((en) => en.changes.length > 0) };
}

/** Reenvía los avisos a la plataforma. Nunca lanza: devuelve {ok, status|error}. */
export async function reenviarEventosLlamada(eventos, { fetchImpl = globalThis.fetch, url = '', token = '', timeoutMs = 8000 } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  if (!base || !token) return { ok: false, error: 'sales_os_no_configurado' };
  try {
    const r = await fetchImpl(`${base}/internal/llamadas/evento`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': token },
      body: JSON.stringify({ tenant_id: 'activa', eventos }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: Boolean(r && r.ok), status: r && r.status };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

/**
 * POST /internal/llamadas/accion (token interno; lo llama la plataforma): {call_id, action, sdp?} → Meta.
 * `llamarMeta(body)` se inyecta (index.js usa el cliente de Graph con el token y el PHONE_ID de Oliver).
 */
export function registrarRutaAccionLlamada(app, { validInternalOperatorToken, llamarMeta, json = null, log = () => {} } = {}) {
  if (typeof validInternalOperatorToken !== 'function') throw new Error('registrarRutaAccionLlamada: falta validInternalOperatorToken');
  if (typeof llamarMeta !== 'function') throw new Error('registrarRutaAccionLlamada: falta llamarMeta');
  const handler = async (req, res) => {
    try {
      if (!validInternalOperatorToken(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
      const b = req.body || {};
      const callId = String(b.call_id || '').trim();
      const action = String(b.action || '').trim();
      if (!callId) return res.status(400).json({ ok: false, error: 'call_id_requerido' });
      if (!ACCIONES_LLAMADA.includes(action)) return res.status(400).json({ ok: false, error: 'accion_no_permitida', permitidas: ACCIONES_LLAMADA });
      const cuerpo = { messaging_product: 'whatsapp', call_id: callId, action };
      if (action === 'pre_accept' || action === 'accept') {
        const sdp = String(b.sdp || '');
        if (!sdp.startsWith('v=0')) return res.status(400).json({ ok: false, error: 'sdp_invalida' });
        cuerpo.session = { sdp_type: 'answer', sdp };
      }
      const r = await llamarMeta(cuerpo);
      if (!r || !r.ok) {
        log('error', 'llamada.accion', `${action} ${callId}: ${r && (r.error || r.status)}`);
        return res.status(502).json({ ok: false, error: (r && r.error) || 'meta_rechazo', detalle: r && r.detalle });
      }
      return res.json({ ok: true, call_id: callId, action });
    } catch (e) {
      log('error', 'llamada.accion', (e && e.message) || e);
      return res.status(500).json({ ok: false, error: 'error_interno' });
    }
  };
  if (json) app.post(RUTA_ACCION_LLAMADA, json, handler); else app.post(RUTA_ACCION_LLAMADA, handler);
}
