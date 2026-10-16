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
// [2026-10-16 · #702 etapa 2] + 'connect' = LLAMAR al cliente (llamada saliente, BUSINESS_INITIATED). Es la única
// acción que no lleva call_id (lo crea Meta) y la única que lleva `to`: se valida aparte, más abajo.
export const ACCIONES_LLAMADA = Object.freeze(['pre_accept', 'accept', 'reject', 'terminate', 'connect']);
export const RUTA_PERMISO_LLAMADA = '/internal/llamadas/permiso';
// [2026-10-16 · #702 etapa 2] El texto de la solicitud de permiso lo fija el BOT, no el navegador ni la plataforma:
// es un mensaje al cliente con la marca de Oliver y no tiene por qué poder escribirlo cualquiera que tenga el token.
export const TEXTO_PEDIR_PERMISO = '¿Podemos llamarte por WhatsApp para resolver tu cotización?';

/**
 * [2026-10-16 · #702 etapa 2] Teléfono del cliente para LLAMAR: solo dígitos, largo E.164 (10 a 15, con código de
 * país). Una llamada saliente cuesta plata (Meta la cobra por minuto si contesta), así que un `to` raro no sale.
 * Devuelve los dígitos o null.
 */
export function telefonoParaLlamar(t) {
  const raw = String(t || '').trim();
  if (!raw || /[^\d\s+()-]/.test(raw)) return null;   // letras u otros símbolos: no es un teléfono
  const dig = raw.replace(/\D/g, '');
  return dig.length >= 10 && dig.length <= 15 ? dig : null;
}

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
 * [2026-10-16 · #702 etapa 2] LLAMAR (connect): solo con un teléfono válido y una SDP OFERTA (la arma el navegador).
 * Un `call_id` en un connect se rechaza: connect es SOLO para llamadas salientes nuevas; nunca sirve para «re-conectar»
 * una llamada entrante ajena. Devuelve {http, body}.
 */
async function conectarSaliente(b, llamarMeta, log) {
  if (b.call_id) return { http: 400, body: { ok: false, error: 'connect_solo_saliente' } };
  const to = telefonoParaLlamar(b.to);
  if (!to) return { http: 400, body: { ok: false, error: 'telefono_invalido' } };
  const sdp = String(b.sdp || '');
  if (!sdp.startsWith('v=0')) return { http: 400, body: { ok: false, error: 'sdp_invalida' } };
  const r = await llamarMeta({ messaging_product: 'whatsapp', to, action: 'connect', session: { sdp_type: 'offer', sdp } });
  const nuevo = r && r.ok && r.data && Array.isArray(r.data.calls) && r.data.calls[0] && r.data.calls[0].id;
  if (!nuevo) {
    log('error', 'llamada.connect', `…${to.slice(-4)}: ${r && (r.error || r.status || 'sin call_id')}`);
    return { http: 502, body: { ok: false, error: (r && r.error) || 'meta_sin_call_id', detalle: r && r.detalle } };
  }
  return { http: 200, body: { ok: true, call_id: String(nuevo), action: 'connect', to } };
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
      const action = String(b.action || '').trim();
      if (!ACCIONES_LLAMADA.includes(action)) return res.status(400).json({ ok: false, error: 'accion_no_permitida', permitidas: ACCIONES_LLAMADA });
      if (action === 'connect') { const r = await conectarSaliente(b, llamarMeta, log); return res.status(r.http).json(r.body); }
      const callId = String(b.call_id || '').trim();
      if (!callId) return res.status(400).json({ ok: false, error: 'call_id_requerido' });
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

// ════════════════════════════════════════════════════════════════════════════
// [2026-10-16 · #702 etapa 2] PERMISO DEL CLIENTE PARA LLAMARLO.
// Meta no deja llamar a nadie que no haya dado permiso (sin él, el connect vuelve con el error 138006). Tres piezas:
//   1. consultar: GET /{PHONE_ID}/call_permissions?user_wa_id=… → permission.status (no_permission | temporary |
//      permanent) + actions (si se puede pedir / llamar y cuánto queda del límite).
//   2. pedir: un mensaje interactive `call_permission_request`. Es mensaje LIBRE ⇒ solo llega dentro de la ventana
//      de 24 h (la plataforma lo verifica antes de pedirlo). Límite de Meta: 1 por día y 2 por semana por cliente.
//   3. la respuesta del cliente llega al webhook de MENSAJES como interactive `call_permission_reply`. NO es texto del
//      cliente: si llegara a Oliver, el LLM recibiría un JSON como si el cliente lo hubiera escrito. Se intercepta
//      antes, igual que los avisos de llamada, y se le reenvía a la plataforma.
// ════════════════════════════════════════════════════════════════════════════

const esRespuestaPermiso = (m) => Boolean(m && m.type === 'interactive' && m.interactive && m.interactive.type === 'call_permission_reply');

/** Las respuestas de permiso de un body de webhook, normalizadas. [] si no hay. */
export function respuestasPermisoLlamada(body) {
  const out = [];
  for (const entry of (body && Array.isArray(body.entry) ? body.entry : [])) {
    for (const ch of (Array.isArray(entry && entry.changes) ? entry.changes : [])) {
      if (!ch || ch.field !== 'messages') continue;
      for (const m of (Array.isArray(ch.value && ch.value.messages) ? ch.value.messages : [])) {
        if (!esRespuestaPermiso(m)) continue;
        // Meta la anida en interactive.call_permission_reply; se acepta también plana por si cambia el formato.
        const r = m.interactive.call_permission_reply || m.interactive;
        const exp = Number(r.expiration_timestamp);
        out.push({
          msg_id: String(m.id || ''),
          telefono: String(m.from || '').replace(/\D/g, ''),
          respuesta: String(r.response || '').toLowerCase() === 'accept' ? 'accept' : 'reject',
          permanente: r.is_permanent === true,
          expira_ts: Number.isFinite(exp) && exp > 0 ? exp : null,
          origen: r.response_source ? String(r.response_source) : null,
          ts: m.timestamp ? Number(m.timestamp) : null,
        });
      }
    }
  }
  return out;
}

/** true si el body trae SOLO respuestas de permiso (ni otro mensaje, ni estados): recién ahí el webhook puede
 * contestar y salir. Con cualquier otra cosa al lado, esa otra cosa sigue al flujo de Oliver. */
export function soloRespuestasPermiso(body) {
  const entradas = body && Array.isArray(body.entry) ? body.entry : [];
  return entradas.length > 0 && entradas.every((en) => Array.isArray(en && en.changes) && en.changes.length > 0
    && en.changes.every((ch) => {
      const v = (ch && ch.value) || {};
      const msgs = Array.isArray(v.messages) ? v.messages : [];
      const sts = Array.isArray(v.statuses) ? v.statuses : [];
      return ch && ch.field === 'messages' && msgs.length > 0 && sts.length === 0 && msgs.every(esRespuestaPermiso);
    }));
}

/**
 * El mismo body SIN las respuestas de permiso. 🔴 Nunca se pierde un mensaje del cliente: se quitan SOLO los mensajes
 * de tipo call_permission_reply; si en el mismo cambio venía otro mensaje o un estado, el cambio queda con eso. Un
 * cambio solo se va si quedó vacío (sin mensajes ni estados).
 */
export function quitarRespuestasPermiso(body) {
  if (!body || !Array.isArray(body.entry)) return body;
  return { ...body, entry: body.entry
    .map((en) => ({ ...en, changes: (Array.isArray(en && en.changes) ? en.changes : []).map((ch) => {
      if (!ch || ch.field !== 'messages' || !ch.value || !Array.isArray(ch.value.messages)) return ch;
      const msgs = ch.value.messages.filter((m) => !esRespuestaPermiso(m));
      if (msgs.length === ch.value.messages.length) return ch;
      const sts = Array.isArray(ch.value.statuses) ? ch.value.statuses : [];
      if (!msgs.length && !sts.length) return null;
      return { ...ch, value: { ...ch.value, messages: msgs } };
    }).filter(Boolean) }))
    .filter((en) => en.changes.length > 0) };
}

/** Reenvía las respuestas de permiso a la plataforma. Nunca lanza. */
export async function reenviarRespuestasPermiso(respuestas, { fetchImpl = globalThis.fetch, url = '', token = '', timeoutMs = 8000 } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  if (!base || !token) return { ok: false, error: 'sales_os_no_configurado' };
  try {
    const r = await fetchImpl(`${base}/internal/llamadas/permiso-respuesta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': token },
      body: JSON.stringify({ tenant_id: 'activa', respuestas }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: Boolean(r && r.ok), status: r && r.status };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

/** La respuesta de Meta a call_permissions, en lo que la plataforma necesita. */
export function normalizarPermiso(data) {
  const p = (data && data.permission) || {};
  const status = ['no_permission', 'temporary', 'permanent'].includes(p.status) ? p.status : 'desconocido';
  const exp = Number(p.expiration_time);
  const acciones = {};
  for (const a of (Array.isArray(data && data.actions) ? data.actions : [])) {
    if (!a || !a.action_name) continue;
    acciones[String(a.action_name)] = {
      puede: a.can_perform_action !== false,
      limites: (Array.isArray(a.limits) ? a.limits : []).map((l) => ({
        periodo: String(l.time_period || ''), max: Number(l.max_allowed), usados: Number(l.current_usage),
        vence_ts: Number.isFinite(Number(l.limit_expiration_time)) ? Number(l.limit_expiration_time) : null,
      })),
    };
  }
  return { status, expira_ts: Number.isFinite(exp) && exp > 0 ? exp : null, acciones };
}

/** El mensaje interactive que le pide permiso al cliente (formato de Meta, calling/user-call-permissions). */
export function mensajePedirPermiso(to) {
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'interactive',
    interactive: { type: 'call_permission_request', action: { name: 'call_permission_request' }, body: { text: TEXTO_PEDIR_PERMISO } },
  };
}

/**
 * POST /internal/llamadas/permiso (token interno; lo llama la plataforma): {phone, accion: 'consultar' | 'pedir'}.
 * `consultarMeta(phone)` y `enviarMeta(body)` se inyectan (index.js usa el cliente de Graph de Oliver). La ventana de
 * 24 h y el límite 1/día-2/semana los controla la plataforma ANTES de pedir; Meta igual los vuelve a aplicar.
 */
export function registrarRutaPermisoLlamada(app, { validInternalOperatorToken, consultarMeta, enviarMeta, json = null, log = () => {} } = {}) {
  if (typeof validInternalOperatorToken !== 'function') throw new Error('registrarRutaPermisoLlamada: falta validInternalOperatorToken');
  if (typeof consultarMeta !== 'function' || typeof enviarMeta !== 'function') throw new Error('registrarRutaPermisoLlamada: faltan consultarMeta/enviarMeta');
  const handler = async (req, res) => {
    try {
      if (!validInternalOperatorToken(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
      const b = req.body || {};
      const tel = telefonoParaLlamar(b.phone);
      if (!tel) return res.status(400).json({ ok: false, error: 'telefono_invalido' });
      if (b.accion === 'consultar') {
        const r = await consultarMeta(tel);
        if (!r || !r.ok) return res.status(502).json({ ok: false, error: (r && r.error) || 'meta_rechazo' });
        return res.json({ ok: true, ...normalizarPermiso(r.data) });
      }
      if (b.accion === 'pedir') {
        const r = await enviarMeta(mensajePedirPermiso(tel));
        // [AGENTS.md] un 200 sin messages[0].id no prueba nada: sin id, no se da por pedido.
        const id = r && r.ok && r.data && Array.isArray(r.data.messages) && r.data.messages[0] && r.data.messages[0].id;
        if (!id) {
          log('error', 'llamada.permiso', `pedir …${tel.slice(-4)}: ${r && (r.error || r.status || 'sin message_id')}`);
          return res.status(502).json({ ok: false, error: (r && r.error) || 'meta_sin_message_id' });
        }
        return res.json({ ok: true, message_id: String(id), texto: TEXTO_PEDIR_PERMISO });
      }
      return res.status(400).json({ ok: false, error: 'accion_no_permitida', permitidas: ['consultar', 'pedir'] });
    } catch (e) {
      log('error', 'llamada.permiso', (e && e.message) || e);
      return res.status(500).json({ ok: false, error: 'error_interno' });
    }
  };
  if (json) app.post(RUTA_PERMISO_LLAMADA, json, handler); else app.post(RUTA_PERMISO_LLAMADA, handler);
}

/**
 * [2026-10-16 · #702 etapa 2] Lo que hace el webhook con las respuestas de permiso (vive acá para poder probarlo):
 *  - sin respuestas → {accion:'seguir', body} intacto;
 *  - SOLO respuestas → espera a que la plataforma las guarde y contesta 200, o 500 para que Meta reintente (mismo
 *    criterio que los avisos de llamada: un 200 antes de guardar perdía el aviso si la plataforma estaba caída);
 *  - mezcladas con otra cosa → se reenvían sin esperar y el resto sigue a Oliver SIN las respuestas.
 */
export async function interceptarRespuestasPermiso(body, { reenviar }) {
  const resp = respuestasPermisoLlamada(body);
  if (!resp.length) return { accion: 'seguir', body, respuestas: resp };
  const envio = Promise.resolve().then(() => reenviar(resp)).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  if (soloRespuestasPermiso(body)) {
    const r = await envio;
    return { accion: 'responder', status: r && r.ok ? 200 : 500, respuestas: resp };
  }
  return { accion: 'seguir', body: quitarRespuestasPermiso(body), respuestas: resp };
}
