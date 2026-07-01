// src/oliver-gpt/escalation.js
//
// ESCALACIÓN DETERMINISTA — módulo COMPARTIDO por todos los canales de Oliver
// (webhook.js = WhatsApp, channel-agent.js = Instagram/Facebook).
// ─────────────────────────────────────────────────────────────────────────
// POR QUÉ COMPARTIDO (2026-06-18): la escalación nació en channel-agent.js (IG/FB)
// pero webhook.js (WhatsApp, el canal que más cobra) quedó SIN ella → escalaba solo
// vía tool del LLM, que en prod a veces respondía 'notificar_marcelo' como texto o
// directamente NO avisaba. La escalación es plata/reputación: NO puede depender del LLM.
// Al vivir en UN solo módulo, ambos canales escalan idéntico y no se desincronizan nunca más.
//
// Detecta en CÓDIGO el pedido de humano / molestia y maneja siempre igual:
//   (1) aviso al dueño (highValueNotifier) + (2) aviso GARANTIZADO por plantilla Meta
//   (bypasa la ventana 24h) + (3) mensaje fijo correcto al cliente (nombre+cargo+nº+agenda).
//
// ESM, Node 18+.

const BOOKINGS_URL = () => process.env.MARCELO_BOOKINGS_URL ||
  'https://outlook.office.com/bookwithme/user/35f7b8685a9041ae951cdb858eea458b@activaspa.cl/meetingtype/oi8VUtFlrEOffOOfJQCRiw2?anonymous&ismsaljsauthenabled&ep=mlink';

// Mensaje fijo al cliente cuando se escala (idéntico en todos los canales).
export function escalationMessage() {
  return 'Te entiendo 🙌 Prefiero que te atienda directamente un experto.\n' +
    'Le avisé al Ing. Marcelo Cifuentes Méndez — Ingeniero Civil Industrial, Gerente de Ingeniería de Activa y ' +
    'Evaluador Energético acreditado MINVU (Res. 266/2025). Te contacta personalmente.\n' +
    '📲 WhatsApp directo: +56 9 5729 6035\n' +
    '📅 O agenda tú mismo una hora: ' + BOOKINGS_URL();
}

// Detección determinista (regex, NO LLM) del pedido de humano / molestia.
export function isEscalationRequest(text) {
  const t = String(text || '').toLowerCase();
  if (/hablar con (marcelo|un? (humano|persona|asesor|vendedor|ejecutivo)|el? (due[ñn]o|jefe|gerente))/.test(t)) return true;
  if (/(p[aá]same|comun[ií]came|conect[aá]me) .{0,15}(marcelo|humano|persona|asesor|vendedor|due[ñn]o)/.test(t)) return true;
  if (/\bescal(a|ar|en|o|ame)\b/.test(t) && /(marcelo|humano|persona|alguien)/.test(t)) return true;
  if (/(estoy|muy|tan|s[uú]per) (enojad|molest|furios|indignad|frustrad)/.test(t)) return true;
  if (/\b(reclamo|p[eé]simo servicio|p[eé]sima atenci|estafa)\b/.test(t)) return true;
  return false;
}

// Aviso GARANTIZADO al dueño por PLANTILLA de WhatsApp (bypasa la ventana 24h).
// Usa 'informe_diario' (plantilla YA APROBADA) por self-call a /admin/send-template.
// 4 params: fecha, resumen, linea3, linea4. El detalle del lead queda en el cockpit.
export async function sendEscalationTemplate(name, motivo, deps = {}) {
  const fetchFn = deps.fetchFn || fetch;
  const PIN = process.env.ADMIN_PIN || process.env.OLIVER_ADMIN_PIN || '';
  const owner = process.env.OWNER_NOTIFICATION_PHONE || process.env.ESCALATION_PHONE || process.env.MARCELO_PHONE || '56957296035';
  if (!PIN) return { ok: false, error: 'ADMIN_PIN_missing' };
  const base = (process.env.SELF_URL || `http://127.0.0.1:${process.env.PORT || 8080}`).replace(/\/$/, '');
  let fecha = '';
  try { fecha = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago' }); } catch { fecha = new Date().toISOString().slice(0, 10); }
  const body = {
    template: 'informe_diario',
    phone: owner,
    fecha,
    resumen: `ESCALACION: ${String(name || 'un cliente').slice(0, 40)} pide hablar contigo AHORA`,
    linea3: String(motivo || 'pide hablar con humano').replace(/[\[\]]/g, '').slice(0, 90),
    linea4: 'Revisa/toma el chat en ops.activalabs.ai (Oliver CRM)',
  };
  try {
    const r = await fetchFn(`${base}/admin/send-template?pin=${encodeURIComponent(PIN)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return await r.json().catch(() => ({ ok: r.ok }));
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export default { escalationMessage, isEscalationRequest, sendEscalationTemplate, BOOKINGS_URL };
