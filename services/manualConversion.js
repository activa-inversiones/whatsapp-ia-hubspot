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
       .replace(/\b(millones?|mill?|mil|clp|pesos?|por|de|monto|cliente|nombre|tel[eé]fono|fono)\b/gi, ' ');
  const name = t.replace(/[^\p{L}\s'.-]/gu, ' ').replace(/\s+/g, ' ').trim();
  return name || null;
}

/**
 * Parsea una LÍNEA RÁPIDA completa.
 * @returns {{ kind, name, phone, amount, complete }}
 *   complete = tiene kind + name + amount (phone opcional pero recomendado).
 */
export function parseManualConversion(text) {
  const kind = detectKind(text);
  const phone = extractPhone(text);
  const amount = extractAmount(text);
  const name = extractName(text);
  const complete = !!(kind && name && amount);
  return { kind, name, phone, amount, complete };
}

// ── MODO GUIADO (máquina de pasos) ───────────────────────────────────────────
// state: { kind, step:'name'|'phone'|'amount', name, phone, amount }
const STEP_ORDER = ['name', 'phone', 'amount'];

export function askForStep(step, kind) {
  const k = kind === 'venta' ? 'la venta' : 'la cotización';
  if (step === 'name')  return `Registrar ${k} 📝 — ¿nombre del cliente?`;
  if (step === 'phone') return `¿Teléfono del cliente? (así Meta lo atribuye bien). Si no lo tienes, escribe *no*.`;
  if (step === 'amount')return `¿Monto en pesos? (ej: 1.500.000)`;
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
    return { state: s, done: true, data: { kind: s.kind, name: s.name, phone: s.phone, amount: s.amount } };
  }
  return { state: s };
}

export function startGuided(kind) {
  return { kind, step: 'name', name: null, phone: null, amount: null };
}

// ── Mensaje de confirmación ──────────────────────────────────────────────────
export function confirmMessage({ kind, name, phone, amount }, meta = {}) {
  const tipo = kind === 'venta' ? 'VENTA' : 'COTIZACIÓN';
  const montoFmt = '$' + Number(amount || 0).toLocaleString('es-CL');
  const metaLine = meta.ok
    ? 'reportado a Meta ✓'
    : meta.skipped
      ? '(sin teléfono → Meta no atribuible, igual guardado)'
      : 'guardado (Meta reintenta luego)';
  return `✅ Recibido: ${tipo} · ${name || 's/ nombre'} · ${montoFmt}${phone ? ' · ' + phone : ''} — ${metaLine} y guardado en el pipeline.`;
}
