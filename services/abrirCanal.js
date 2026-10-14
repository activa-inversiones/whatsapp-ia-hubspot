// ════════════════════════════════════════════════════════════════════════════
// [2026-10-13 · #1514 (2)] ABRIR EL CANAL CON LA PLANTILLA MÁS BARATA, DESDE EL INBOX / LA AGENDA.
//
// Dueño, textual: «si queremos contactar a un cliente deberíamos tener la opción de abrir el canal de
// comunicación con el mensaje más económico que podamos, para después hablarle… que nos diga: no leerá
// el mensaje, envíe plantilla antes». Fuera de la ventana de 24 h de Meta el texto libre se acepta con 200 y
// se marca `failed` después (AGENTS.md); lo único que llega es una PLANTILLA aprobada, y si el cliente
// contesta, la ventana se abre. Medido 13-oct: 215 mensajes humanos a 115 conversaciones en 30 d salieron
// fuera de ventana sin que nadie supiera.
//
// Esta ruta es el gemelo interno (token x-api-key, lo llama sales-os) del `/admin/send-template` (PIN), acotado
// a las plantillas de APERTURA de canal y con el MISMO candado de seguimiento (48 h compartido con la cadencia
// del CXM y el re-engagement): dos motores no le mandan dos plantillas al mismo cliente el mismo día.
// `enviar`, `candado`, `normPhone` se inyectan desde index.js (y desde los tests).
// ════════════════════════════════════════════════════════════════════════════
export const RUTA_ABRIR_CANAL = '/internal/operator-abrir-canal';
/** La única plantilla que esta ruta puede mandar. [Thermos M2] `apertura_por_llamada` NO está en el candado de 48 h
 * (candadoSeguimiento.TEMPLATES_DE_SEGUIMIENTO): permitirla era plantillas ilimitadas y pagas por curl. Si se agrega
 * otra, primero entra al candado. */
export const PLANTILLAS_APERTURA = Object.freeze(['recontacto_lead']);
export const PLANTILLA_POR_DEFECTO = 'recontacto_lead';

/** Decide la plantilla: la pedida si está en la lista; vacío → la por defecto; otra cosa → null (se rechaza). */
export function plantillaDeApertura(pedida) {
  const t = String(pedida || '').trim().toLowerCase();
  if (!t) return PLANTILLA_POR_DEFECTO;
  return PLANTILLAS_APERTURA.includes(t) ? t : null;
}

export function registrarRutaAbrirCanal(app, {
  validInternalOperatorToken, normPhone, enviar, candado, json = null, nombreDeSesion = () => '', log = () => {},
  // [Thermos M1] rastro en la conversación (pushConversationEvent): sin esto el inbox no ve que salió la plantilla,
  // Oliver saluda «como si nada» y el vendedor vuelve a apretar creyendo que no salió. Fire-and-forget: nunca frena.
  registrarEvento = null,
} = {}) {
  for (const [k, v] of Object.entries({ validInternalOperatorToken, normPhone })) {
    if (typeof v !== 'function') throw new Error(`registrarRutaAbrirCanal: falta ${k}`);
  }
  if (!enviar || PLANTILLAS_APERTURA.some((t) => typeof enviar[t] !== 'function')) throw new Error('registrarRutaAbrirCanal: falta enviar[plantilla] para cada plantilla de apertura');
  if (!candado || typeof candado.puedeEnviar !== 'function' || typeof candado.marcarEnviado !== 'function') throw new Error('registrarRutaAbrirCanal: falta candado {puedeEnviar, marcarEnviado, leer, escribir}');

  const handler = async (req, res) => {
    try {
      if (!validInternalOperatorToken(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
      const phone = normPhone((req.body && req.body.phone) || '');
      if (!phone) return res.status(400).json({ ok: false, error: 'phone_required' });
      const template = plantillaDeApertura(req.body && req.body.template);
      if (!template) return res.status(400).json({ ok: false, error: 'plantilla_no_permitida', permitidas: PLANTILLAS_APERTURA });
      const nombre = String((req.body && req.body.customer_name) || nombreDeSesion(phone) || '').trim().slice(0, 120);
      const operador = String((req.body && req.body.operador) || '').trim().slice(0, 80);

      // El MISMO candado que /admin/send-template: si la cadencia o el re-engagement ya le mandaron una
      // plantilla en las últimas 48 h, no se le manda otra: se dice y se espera su respuesta.
      const c = await candado.puedeEnviar({ template, phone }, { leer: candado.leer, onError: (e) => log('warn', 'abrir-canal.candado.leer', e && e.message) });
      if (!c.permitido) {
        log('info', 'abrir-canal.dedupe', `${phone} ${template} ${c.razon}`);
        return res.json({ ok: true, sent: false, template, phone, reason: c.razon,
          detalle: 'Ya se le envió una plantilla en las últimas 48 h (cadencia o re-engagement). Esperá su respuesta antes de insistir.' });
      }
      const result = await enviar[template](phone, nombre);
      if (!result || !result.ok) {
        log('error', 'abrir-canal.envio', `${phone} ${template} ${result && result.error}`);
        return res.status(502).json({ ok: false, error: (result && result.error) || 'envio_fallo', template });
      }
      // [Thermos B2] _sendMetaTemplate devuelve `msgId`; se aceptan las otras formas por si cambia.
      const messageId = result.msgId || result.message_id || result.messageId || null;
      // 🔴 [Codex post-despliegue 14-oct · P1] SIN ID DE META NO SE DICE «ENVIADA» NI SE CIERRA EL CANDADO. Antes un
      // `{ok:true, msgId:null}` respondía sent:true y marcaba el candado: la pantalla decía «✅ Plantilla enviada» y,
      // si Meta la había rechazado después, el vendedor no podía reintentar en 48 h. Ahora se dice que no se pudo
      // confirmar y se deja el reintento libre (la regla del repo: aceptar el HTTP no prueba la entrega).
      if (!messageId) {
        log('warn', 'abrir-canal.sin-id', `${phone} ${template}: Meta no devolvió id del mensaje`);
        return res.json({ ok: true, sent: false, template, phone, reason: 'sin_confirmacion_de_meta',
          detalle: 'Meta no confirmó el envío (no devolvió el id del mensaje). Revisá el chat del cliente antes de reintentar.' });
      }
      if (c.clave) await candado.marcarEnviado(c.clave, { escribir: candado.escribir, onError: (e) => log('warn', 'abrir-canal.candado.escribir', e && e.message) });
      if (typeof registrarEvento === 'function') {
        try {
          registrarEvento({
            channel: 'whatsapp', external_id: phone, customer_name: nombre,
            direction: 'outbound', actor_type: 'operator', actor_name: operador || 'Inbox', message_type: 'template',
            body: `[plantilla ${template} · abrir canal${operador ? ' · por ' + operador : ''}]`,
            metadata: { template, via: 'operator-abrir-canal', message_id: messageId, operador: operador || null },
          });
        } catch (e) { log('warn', 'abrir-canal.rastro', e && e.message); }
      }
      log('info', 'abrir-canal.enviada', `${phone} ${template} por ${operador || 'inbox'}`);
      return res.json({ ok: true, sent: true, template, phone, message_id: messageId });
    } catch (e) {
      log('error', 'abrir-canal.error', e && e.message);
      return res.status(500).json({ ok: false, error: 'abrir_canal_failed' });
    }
  };
  if (json) app.post(RUTA_ABRIR_CANAL, json, handler); else app.post(RUTA_ABRIR_CANAL, handler);
}

export default { RUTA_ABRIR_CANAL, PLANTILLAS_APERTURA, PLANTILLA_POR_DEFECTO, plantillaDeApertura, registrarRutaAbrirCanal };
