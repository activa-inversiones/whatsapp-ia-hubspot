// services/agendaVoz.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// [2026-07-07 ZL-F3] Motor Zero-Leaks — Agenda por voz del CEO.
// ACTIVA / Oliver — parser determinista de intención de agenda para el CEO Assistant.
//
// QUÉ RESUELVE: el dueño le habla a Oliver por audio ("Oliver, agéndame a Pérez el
// jueves") y hoy esa transcripción cae completa al cerebro LLM (handleCeoAssistant),
// que solo ACONSEJA — nunca escribe en la agenda real. Este módulo intenta parsear
// la intención de agenda ANTES de llamar al LLM: si matchea, se ejecuta inmediato
// contra la agenda de seguimiento (mismos endpoints que ya usa parseAdminCmd/
// handleAgendaCommand en index.js — NO se duplica lógica de API aquí).
//
// FUNCIÓN PURA: parseAgendaVoz(texto, ahora?) no llama red ni toca I/O — recibe el
// texto (ya transcrito si venía de audio) y opcionalmente un Date de referencia
// (para tests deterministas; default = ahora real). Devuelve:
//   { type: 'agenda_add',    name: string, days: number, dayLabel: string } |
//   { type: 'agenda_done',   query: string } |
//   { type: 'agenda_snooze', query: string, days: number } |
//   null   (no se detectó intención de agenda → el llamador sigue el flujo normal)
//
// ZONA HORARIA: día-de-semana / "mañana" / "pasado mañana" se resuelven contra
// America/Santiago (mismo patrón que buildRealtimeContext en index.js ~797-829),
// para que "el jueves" a las 23:50 en Chile no calcule mal por usar TZ del server.
//
// A PROPÓSITO ESTRICTO: el parser exige que el CEO use un verbo/patrón de agenda
// explícito (agenda/agéndame/anota/recuérdame/listo/ya hablé/posterga/corre). Frases
// sueltas como "agenda una visita" (sin nombre/día reconocible) o pedidos genéricos
// ("¿qué tengo hoy?") devuelven null a propósito — quedan para el LLM asesor. Este
// módulo SOLO se invoca ya filtrado para el número del CEO (index.js lo gatea).
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

// Quita tildes para matchear "miércoles"/"miercoles", "sábado"/"sabado", etc.
function sinTildes(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Devuelve { year, month, day, weekdayIdx } de "ahora" en America/Santiago.
 * weekdayIdx: 0=domingo .. 6=sábado (coincide con DIAS_SEMANA).
 */
function partesChile(ahora) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const parts = fmt.formatToParts(ahora).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    weekdayIdx: WD[parts.weekday],
  };
}

/** Fecha (medianoche Chile aprox, solo para calcular día-de-semana destino) + N días. */
function fechaChileMasDias(ahora, dias) {
  const { year, month, day } = partesChile(ahora);
  // Construir a mediodía UTC del día Chile para evitar corrimientos por DST al sumar días.
  const base = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + dias);
  return base;
}

/** Etiqueta legible "jueves 10/7" para la fecha resultante (día calculado + N días). */
function etiquetaFecha(ahora, dias) {
  const target = fechaChileMasDias(ahora, dias);
  const fmt = new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'numeric' });
  const parts = fmt.formatToParts(target).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const wd = parts.weekday ? parts.weekday.charAt(0).toUpperCase() + parts.weekday.slice(1) : '';
  return `${wd} ${parts.day}/${parts.month}`;
}

/**
 * Convierte una expresión de tiempo en español chileno a número de días desde hoy.
 * Devuelve null si no reconoce ninguna expresión de tiempo (ej: agenda_add "hoy" = 0).
 */
function resolverDias(expresion, ahora) {
  const e = sinTildes(String(expresion || '').trim().toLowerCase());
  if (!e) return null;

  if (/^hoy\b/.test(e)) return 0;
  if (/^manana\b/.test(e)) return 1; // "mañana"
  if (/^pasado\s+manana\b/.test(e)) return 2;

  // "en N dias" / "en N dia"
  const enN = e.match(/^en\s+(\d+)\s+dias?\b/);
  if (enN) return parseInt(enN[1], 10);

  // "N dias" suelto (sin "en")
  const nDias = e.match(/^(\d+)\s+dias?\b/);
  if (nDias) return parseInt(nDias[1], 10);

  // día de la semana: "el jueves", "jueves", "este jueves", "próximo/proximo lunes"
  const diaM = e.match(/^(?:el\s+|este\s+|proximo\s+|próximo\s+)?(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/);
  if (diaM) {
    const targetIdx = DIAS_SEMANA.indexOf(diaM[1]);
    const { weekdayIdx } = partesChile(ahora);
    let delta = targetIdx - weekdayIdx;
    if (delta <= 0) delta += 7; // "el jueves" siempre refiere al PRÓXIMO jueves (si hoy es jueves → en 7 días)
    return delta;
  }

  return null;
}

// Verbos/patrones de agenda_add: agenda, agéndame, agenda, anota(me), recuérdame, agendá.
// OJO: "agéndame" es agend-É-name (tilde en la e del medio, no en la a) — variante propia,
// distinta de "agend[aá](me)?" que solo cubre "agenda"/"agendá"/"agendame"/"agendáme".
const RE_ADD = /^(?:oliver[,:.\s]*)?(?:agenda(?:me)?|agend[aá](?:me)?|ag[eé]ndame|anota(?:me)?|recu[eé]rdame|apunta(?:me)?)\b[,:]?\s+(.+)$/i;
// Verbos de agenda_done: "listo <x>", "ya hable con <x>", "ya llame a <x>", "ya hablé con <x>"
const RE_DONE_LISTO = /^listo\b[,:]?\s+(.+)$/i;
const RE_DONE_HABLE = /^ya\s+(?:habl[eé]|llam[eé])\s+(?:con\s+|a\s+)?(.+)$/i;
// Verbos de agenda_snooze: "posterga <x> N dias", "corre a <x> N dias", "pospon <x>"
const RE_SNOOZE = /^(?:posterg(?:a|ame)|pospon(?:e|me)?|corre)\b[,:]?\s+(?:a\s+)?(.+)$/i;

// Sufijo de tiempo al final de la frase de agenda_add: "... el jueves", "... en 3 días", "... mañana"
const RE_TIEMPO_SUFIJO = /\s+(?:para\s+)?(hoy|mañana|manana|pasado\s+mañana|pasado\s+manana|en\s+\d+\s+d[ií]as?|\d+\s+d[ií]as?|(?:el\s+|este\s+|pr[oó]ximo\s+)?(?:domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado))\s*$/i;

/**
 * Parser determinista de intención de agenda por voz/texto del CEO.
 * @param {string} texto — transcripción (audio→STT) o texto ya sin el wake-word "oliver".
 * @param {Date} [ahora] — referencia de tiempo, default = new Date(). Para tests.
 * @returns {{type:string,name?:string,query?:string,days?:number,dayLabel?:string}|null}
 */
export function parseAgendaVoz(texto, ahora = new Date()) {
  const original = String(texto || '').trim();
  if (!original) return null;

  // ── agenda_done: "listo Juan" / "ya hablé con la señora Ximena" ──
  let m = original.match(RE_DONE_LISTO);
  if (m) {
    const query = m[1].replace(/[.!?¡¿\s]+$/, '').trim();
    if (query) return { type: 'agenda_done', query };
  }
  m = original.match(RE_DONE_HABLE);
  if (m) {
    const query = m[1].replace(/[.!?¡¿\s]+$/, '').trim();
    if (query) return { type: 'agenda_done', query };
  }

  // ── agenda_snooze: "posterga a Pérez 3 días" / "corre a Juan 2 días" ──
  m = original.match(RE_SNOOZE);
  if (m) {
    let rest = m[1].replace(/[.!?¡¿\s]+$/, '').trim();
    // Tomar días al final: "Pérez 3 días" / "Pérez en 3 días"
    const diasMatch = rest.match(/\s+(?:en\s+)?(\d+)\s+d[ií]as?\s*$/i);
    let days = 7;
    let query = rest;
    if (diasMatch) {
      days = parseInt(diasMatch[1], 10);
      query = rest.slice(0, diasMatch.index).trim();
    }
    if (query) return { type: 'agenda_snooze', query, days };
  }

  // ── agenda_add: "agéndame a Pérez el jueves" / "agenda llamar a la señora Ximena en 3 días" ──
  m = original.match(RE_ADD);
  if (m) {
    let rest = m[1].replace(/[.!?¡¿\s]+$/, '').trim();
    if (!rest) return null;

    let days = 0;
    let dayLabel = 'hoy';
    const sufM = rest.match(RE_TIEMPO_SUFIJO);
    if (sufM) {
      const resuelto = resolverDias(sufM[1], ahora);
      if (resuelto !== null) {
        days = resuelto;
        rest = rest.slice(0, sufM.index).trim();
      }
    }

    // Quitar "a"/"para" inicial pegado al verbo: "agéndame A Pérez" → "Pérez"
    rest = rest.replace(/^(?:a|para)\s+/i, '').trim();
    if (!rest) return null;

    dayLabel = etiquetaFecha(ahora, days);
    return { type: 'agenda_add', name: rest, days, dayLabel };
  }

  return null;
}
