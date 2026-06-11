// manualConversion.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — registro MANUAL de cotización/venta por el dueño (Marcelo).
//
// CONTEXTO (2026-06-11): Marcelo atiende clientes en su WhatsApp PERSONAL (que el
// sistema NO puede leer = riesgo ban). Para que esas cotizaciones/ventas también
// le lleguen a Meta (atribución) y al pipeline, las ingresa MANUAL escribiéndole a
// Oliver una línea, y Oliver confirma "✅ recibido". Reusa el envío a Meta (CXM)
// que quedó funcionando + upsertLead. NO inventa datos (lo que no se dice, no se manda).
//
// Dos modos (decisión del dueño):
//   - LÍNEA RÁPIDA: "VENTA Juan Pérez +56912345678 1500000"
//   - GUIADO: solo "VENTA" → Oliver pregunta nombre → teléfono → monto → confirma.
// Dos tipos: VENTA (sale_closed) y COTIZÓ (quote_sent).
//
// Módulo PURO (parseo + mensajes + máquina de pasos). 100% testeable.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

// Lookahead acento-seguro (?![a-záéíóúñ]) en vez de \b: el \b no funciona tras "vendí"/"cotizó"
// (la vocal acentuada no es \w). Así "venta" matchea pero "ventana" NO (le sigue letra).
const VENTA_RE = /^\s*(venta|vend[a-záéíóúñ]*|cerr[a-záéíóúñ]*|ganad[ao])(?![a-záéíóúñ])/i;
const COTIZ_RE = /^\s*(cotiz[a-záéíóúñ]*|cotic[eé]|presupuesto|propuesta)(?![a-záéíóúñ])/i;

/** 'venta' | 'cotizacion' | null según la PALABRA inicial. */
export function detectKind(text) {
  const t = String(text || '');
  if (VENTA_RE.test(t)) return 'venta';
  if (COTIZ_RE.test(t)) return 'cotizacion';
  return null;
}

/** ¿es un disparador de registro manual? (palabra inicial venta/cotizó). */
export function isManualConvTrigger(text) {
  return detectKind(text) !== null;
}

/**
 * Extrae un teléfono chileno móvil del texto → formato 569XXXXXXXX, o null.
 * Acepta +56 9 XXXX XXXX, 56912345678, 912345678, con espacios/guiones.
 */
export function extractPhone(text) {
  const raw = String(text || '');
  // Buscar una secuencia de dígitos (con + y separadores) que sea un móvil chileno.
  const m = raw.match(/(\+?56[\s.-]?)?9[\s.-]?\d{4}[\s.-]?\d{4}\b/);
  if (!m) return null;
  let digits = m[0].replace(/[^\d]/g, '');
  if (digits.length === 9 && digits.startsWith('9')) digits = '56' + digits;     // 9XXXXXXXX → 569XXXXXXXX
  if (digits.length === 11 && digits.startsWith('569')) return digits;            // ya canónico
  if (digits.length === 11 && digits.startsWith('56')) return digits;
  if (digits.length === 9) return '56' + digits;
  return digits.length >= 11 ? digits.slice(0, 11) : digits;
}

/**
 * Extrae el MONTO (CLP) del texto. Maneja 1.500.000 / 1500000 / $850.000 /
 * "1,5 millones" / "850 mil". Devuelve número entero o null.
 * Ignora el teléfono (lo quita antes de buscar el monto).
 */
export function extractAmount(text) {
  let t = String(text || '');
  const phone = extractPhone(t);
  if (phone) {
    // quitar la subcadena del teléfono para no confundirla con monto
    const pm = t.match(/(\+?56[\s.-]?)?9[\s.-]?\d{4}[\s.-]?\d{4}\b/);
    if (pm) t = t.replace(pm[0], ' ');
  }
  const low = t.toLowerCase();
  // "1,5 millones" / "2 millones" — SOLO "millón/millones" (no "mil", que se maneja abajo).
  const mill = low.match(/(\d+(?:[.,]\d+)?)\s*mill[oó]n(?:es)?\b/);
  if (mill) {
    const n = parseFloat(mill[1].replace(',', '.'));
    if (!isNaN(n)) return Math.round(n * 1_000_000);
  }
  // "850 mil" / "850mil"
  const milK = low.match(/(\d+(?:[.,]\d+)?)\s*mil\b/);
  if (milK) {
    const n = parseFloat(milK[1].replace(',', '.'));
    if (!isNaN(n)) return Math.round(n * 1_000);
  }
  // Número con separadores de miles (1.500.000) o plano (1500000), opcional $.
  const nums = (t.match(/\$?\s*\d[\d.]*\d|\$?\s*\d+/g) || [])
    .map((s) => parseInt(s.replace(/[^\d]/g, ''), 10))
    .filter((n) => !isNaN(n) && n >= 1000); // descarta cantidades chicas tipo "2 ventanas"
  if (nums.length === 0) return null;
  return Math.max(...nums); // el monto es el número grande
}

/**
 * Quita la palabra-tipo, el teléfono y el monto → lo que queda es el NOMBRE.
 */
export function extractName(text) {
  let t = String(text || '').replace(VENTA_RE, ' ').replace(COTIZ_RE, ' ');
  const pm = t.match(/(\+?56[\s.-]?)?9[\s.-]?\d{4}[\s.-]?\d{4}\b/);
  if (pm) t = t.replace(pm[0], ' ');
  // quitar montos y palabras de moneda
  t = t.replace(/\$?\s*\d[\d.]*\d|\$?\s*\d+/g, ' ')
       .replace(/\b(millones?|mill?|mil|clp|pesos?|por|de|monto|cliente|nombre|tel[eé]fono|fono)\b/gi, ' ')
       // [canal] no es parte del nombre
       .replace(/\b(tik\s*tok|tiktok|instagram|insta|facebook|google|maps|youtube|whats\s*app|whatsapp|wsp|recomendad[oa]|referid[oa]|web)\b/gi, ' ');
  const name = t.replace(/[^\p{L}\s'.-]/gu, ' ').replace(/\s+/g, ' ').trim();
  return name || null;
}

// ── CANALES (activador: atribución DECLARADA cuando no hay click id) ──────────
// El dueño declara por qué canal lo conoció el cliente ("me vio en TikTok y me llamó").
export const CHANNELS = ['tiktok', 'instagram', 'facebook', 'google', 'maps', 'youtube', 'whatsapp', 'referido', 'web', 'otro'];
const CHANNEL_ALIASES = [
  [/tik\s*tok|tiktok/i, 'tiktok'],
  [/instagram|insta\b/i, 'instagram'],
  [/facebook|\bface\b|\bfb\b/i, 'facebook'],
  [/google\s*maps|\bmaps\b|mapa/i, 'maps'],
  [/youtube|you\s*tube|\byt\b/i, 'youtube'],
  [/google|buscador|search/i, 'google'],
  [/whats\s*app|whatsapp|\bwsp\b/i, 'whatsapp'],
  [/recomend|referid|boca a boca|conocid|amig/i, 'referido'],
  [/\bweb\b|sitio|p[aá]gina|landing/i, 'web'],
  [/\botro\b|\botra\b|no s[eé]/i, 'otro'],
];

// Texto → canal canónico (o null si no reconoce).
export function normalizeChannel(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;
  for (const [re, canon] of CHANNEL_ALIASES) if (re.test(t)) return canon;
  return null;
}

// A qué plataforma de ads se reporta la conversión declarada (la regla anti-cross-inject):
// meta-familia → 'meta'; google-familia → 'google'; tiktok → 'tiktok'; referido/web/otro → null.
export function channelToPlatform(channel) {
  const c = String(channel || '').toLowerCase();
  if (['facebook', 'instagram', 'meta', 'whatsapp'].includes(c)) return 'meta';
  if (['google', 'maps', 'youtube'].includes(c)) return 'google';
  if (c === 'tiktok') return 'tiktok';
  return null;
}

/**
 * Parsea una LÍNEA RÁPIDA completa.
 * @returns {{ kind, name, phone, amount, channel, complete }}
 *   complete = tiene kind + name + amount (phone y channel se preguntan si faltan).
 */
export function parseManualConversion(text) {
  const kind = detectKind(text);
  const phone = extractPhone(text);
  const amount = extractAmount(text);
  const channel = normalizeChannel(text);
  const name = extractName(text);
  const complete = !!(kind && name && amount);
  return { kind, name, phone, amount, channel, complete };
}

// ── MODO GUIADO (máquina de pasos) ───────────────────────────────────────────
// state: { kind, step:'name'|'phone'|'amount'|'channel', name, phone, amount, channel }
const STEP_ORDER = ['name', 'phone', 'amount', 'channel'];

export function askForStep(step, kind) {
  const k = kind === 'venta' ? 'la venta' : 'la cotización';
  if (step === 'name')  return `Registrar ${k} 📝 — ¿nombre del cliente?`;
  if (step === 'phone') return `¿Teléfono del cliente? (así se atribuye bien). Si no lo tienes, escribe *no*.`;
  if (step === 'amount')return `¿Monto en pesos? (ej: 1.500.000)`;
  if (step === 'channel')return `¿Por qué canal te conoció? (TikTok · Instagram · Facebook · Google · Maps · YouTube · WhatsApp · Recomendado · Otro)`;
  return '';
}

/**
 * Avanza el flujo guiado con la respuesta del cliente.
 * @returns {{ state, ask?:string, done?:boolean, data?:object }}
 */
export function advanceGuided(state, answer) {
  const s = { ...state };
  const a = String(answer || '').trim();
  if (s.step === 'name') {
    s.name = extractName(a) || a.replace(/[^\p{L}\s'.-]/gu, ' ').replace(/\s+/g, ' ').trim() || null;
    s.step = 'phone';
    return { state: s, ask: askForStep('phone', s.kind) };
  }
  if (s.step === 'phone') {
    s.phone = /^no\b/i.test(a) ? null : extractPhone(a);
    s.step = 'amount';
    return { state: s, ask: askForStep('amount', s.kind) };
  }
  if (s.step === 'amount') {
    s.amount = extractAmount(a);
    if (!s.amount) return { state: s, ask: `No entendí el monto 😅. Escríbelo en pesos, ej: 1500000` };
    s.step = 'channel';
    return { state: s, ask: askForStep('channel', s.kind) };
  }
  if (s.step === 'channel') {
    s.channel = normalizeChannel(a) || 'otro';
    return { state: s, done: true, data: { kind: s.kind, name: s.name, phone: s.phone, amount: s.amount, channel: s.channel } };
  }
  return { state: s };
}

export function startGuided(kind) {
  return { kind, step: 'name', name: null, phone: null, amount: null, channel: null };
}

// Arranca el guiado YA en el paso de canal (para línea rápida completa sin canal).
export function startGuidedAtChannel({ kind, name, phone, amount }) {
  return { kind, step: 'channel', name, phone, amount, channel: null };
}

// ── Mensaje de confirmación ──────────────────────────────────────────────────
export function confirmMessage({ kind, name, phone, amount, channel }, meta = {}) {
  const tipo = kind === 'venta' ? 'VENTA' : 'COTIZACIÓN';
  const montoFmt = '$' + Number(amount || 0).toLocaleString('es-CL');
  const plat = channelToPlatform(channel);
  const platName = plat === 'meta' ? 'Meta' : plat || '';
  let rep;
  if (meta.ok) rep = `reportado a ${platName} ✓`;
  else if (meta.skipped === 'no_phone') rep = '(sin teléfono → no atribuible, igual guardado)';
  else if (meta.skipped === 'channel_pending') rep = `canal ${channel}: guardado (envío a ${platName} se activa en Fase 2)`;
  else if (meta.skipped === 'no_paid_channel') rep = 'guardado en el pipeline (canal no pagado)';
  else if (meta.skipped) rep = 'guardado';
  else rep = 'guardado (se reintenta)';
  const canalTxt = channel ? ` · canal: ${channel}` : '';
  return `✅ Recibido: ${tipo} · ${name || 's/ nombre'} · ${montoFmt}${phone ? ' · ' + phone : ''}${canalTxt} — ${rep} y en el pipeline.`;
}
