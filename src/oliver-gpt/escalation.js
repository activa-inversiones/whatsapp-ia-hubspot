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

import { fraseBanoPerdido } from '../../services/vidrioCotizado.js'; // [r8] la frase del aviso por satén: UNA sola para texto, panel y plantilla

// [2026-07-07] Link CORTO propio (caso real: cliente "no podía pinchar" el link). La URL de Bookings
// lleva un '@' en el path → WhatsApp la parte como si fuera un email y el tap no abre. Ahora se entrega
// ops.activalabs.ai/agenda (redirige en sales-os al Bookings real; destino configurable allá con
// MARCELO_BOOKINGS_URL). Env NUEVA a propósito: si MARCELO_BOOKINGS_URL quedó seteada en Railway del
// bot con la URL monstruo, NO debe pisar el link corto.
const BOOKINGS_URL = () => process.env.OLIVER_AGENDA_URL || 'https://ops.activalabs.ai/agenda';

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

// Un parámetro de plantilla de Meta no admite saltos de línea, tabuladores ni rachas de espacios (error 132018).
const limpiarParametro = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// Recorta por PUNTO DE CÓDIGO (no por unidad UTF-16: `slice` parte un emoji y deja un par sustituto suelto) y lo dice con «…».
const recortarPuntos = (s, max) => {
  const puntos = [...s];
  return puntos.length > max ? `${puntos.slice(0, max - 1).join('')}…` : s;
};

// [2026-10-05 · r7/r8] NÚCLEO COMPARTIDO de las plantillas al dueño: 'informe_diario' (YA APROBADA, 4 params:
// fecha, resumen, linea3, linea4) por self-call a /admin/send-template. Lo usan la escalación y el aviso del
// satén perdido: una sola copia, para que no se desincronicen (el PIN, el teléfono del dueño, el timeout, y
// ahora la limpieza de parámetros: antes solo la hacía el aviso del satén y el NOMBRE del cliente de la escalación
// llega tal cual de WhatsApp).
// Devuelve lo que contesta el endpoint: `{ok, template, phone, result}` (index.js:5280; el error de Meta vive en
// `result.error`); sin PIN o si el fetch lanza, `{ok:false, error}`. Si lo que lanzó fue el ABORT por timeout (10 s,
// que vence antes que el axios de 20 s del endpoint) se marca `timedOut:true`: la request YA salió y el endpoint
// puede seguir y entregar la plantilla; el llamador debe tratarlo como DUDOSO, no como «no salió».
async function enviarInformeDiario({ resumen, linea3, linea4 }, deps = {}) {
  const fetchFn = deps.fetchFn || fetch;
  const PIN = process.env.ADMIN_PIN || process.env.OLIVER_ADMIN_PIN || '';
  const owner = process.env.OWNER_NOTIFICATION_PHONE || process.env.ESCALATION_PHONE || process.env.MARCELO_PHONE || '56957296035';
  if (!PIN) return { ok: false, error: 'ADMIN_PIN_missing' };
  const base = (process.env.SELF_URL || `http://127.0.0.1:${process.env.PORT || 8080}`).replace(/\/$/, '');
  let fecha = '';
  try { fecha = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago' }); } catch { fecha = new Date().toISOString().slice(0, 10); }
  const body = {
    template: 'informe_diario', phone: owner, fecha,
    resumen: limpiarParametro(resumen), linea3: limpiarParametro(linea3), linea4: limpiarParametro(linea4),
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
    const abortado = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return { ok: false, error: e.message, ...(abortado ? { timedOut: true } : {}) };
  }
}

// Aviso GARANTIZADO al dueño por PLANTILLA de WhatsApp (bypasa la ventana 24h).
// El detalle del lead queda en el cockpit.
export async function sendEscalationTemplate(name, motivo, deps = {}) {
  return enviarInformeDiario({
    resumen: `ESCALACION: ${String(name || 'un cliente').slice(0, 40)} pide hablar contigo AHORA`,
    linea3: String(motivo || 'pide hablar con humano').replace(/[[\]]/g, '').slice(0, 90),
    linea4: 'Revisa/toma el chat en ops.activalabs.ai (Oliver CRM)',
  }, deps);
}

// [2026-10-05 · r7/r8] El aviso al dueño de «la propuesta dice satén y se cotizó con vidrio claro», por la MISMA
// plantilla aprobada de la escalación (`informe_diario`; crear una nueva requiere aprobación de Meta y mientras
// tanto el aviso no sale). Sale SIEMPRE junto al texto libre (que fuera de la ventana de 24 h Meta acepta con 200 y
// falla después: ver `avisarVidrio`). El FOLIO va en `resumen` (corto) y las ETIQUETAS en `linea3`.
// NO es una escalación: no dice que un cliente espera al dueño AHORA.
// [r8 · BAJO-4] Se recortan las ETIQUETAS (por punto de código, máx. 60 cada una y las 5 primeras, con «(+N más)») y
// el sufijo queda COMPLETO: antes un `slice(0, 300)` sobre el texto entero se comía «revisar precio» y podía partir
// un emoji por la mitad. La frase es la de `fraseBanoPerdido`, la misma del texto al dueño y del panel.
const MAX_ETIQUETAS_EN_PLANTILLA = 5;
const MAX_PUNTOS_POR_ETIQUETA = 60;
export async function sendAvisoVidrioTemplate(folio, etiquetas, deps = {}) {
  const todas = (Array.isArray(etiquetas) ? etiquetas : [etiquetas]).map(limpiarParametro).filter(Boolean);
  const vistas = todas.slice(0, MAX_ETIQUETAS_EN_PLANTILLA).map((e) => recortarPuntos(e, MAX_PUNTOS_POR_ETIQUETA));
  const faltan = todas.length - vistas.length;
  return enviarInformeDiario({
    resumen: `AVISO DE PRECIO: propuesta ${recortarPuntos(limpiarParametro(folio), 60)}`,
    linea3: `${fraseBanoPerdido(vistas)}${faltan > 0 ? ` (+${faltan} más)` : ''}; revisar precio`,
    linea4: 'Revisa la propuesta en ops.activalabs.ai (Oliver CRM)',
  }, deps);
}

export default { escalationMessage, isEscalationRequest, sendEscalationTemplate, sendAvisoVidrioTemplate, BOOKINGS_URL };
