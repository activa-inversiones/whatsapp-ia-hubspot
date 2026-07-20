// pdf-intent.js — Detección de intención de PDF + captura de cotización (COMPARTIDO)
// ─────────────────────────────────────────────────────────────────────────────
// Extraído de channel-agent.js (idéntico) para que WhatsApp (webhook.js) e IG/FB
// (channel-agent.js) usen la MISMA lógica del PDF determinista y no se desincronicen.
// [2026-06-19 PDF-01] Antes solo IG/FB tenía la red de seguridad; WhatsApp (canal
// principal) dependía 100% de que el LLM llamara la tool → a veces escribía
// "[Enlace a la cotización]" como texto y el cliente NO recibía el PDF.

/** ¿El cliente está afirmando que quiere el PDF? (incluye afirmaciones cortas). */
export function isPdfAffirmative(text) {
  const t = String(text || '').trim().toLowerCase();
  if (/\b(env[ií]a(mela|melo|la|lo)?|m[aá]nda(mela|melo|la|lo)?|quiero (el|la|mi) (pdf|cotiza|propuesta)|el pdf|la propuesta formal)\b/.test(t)) return true;
  // afirmación corta — solo cuenta si el bot venía OFRECIENDO el PDF (ver lastAssistantOfferedPdf).
  return /^(s[ií]|ok(ey)?|dale|ya|perfecto|listo|de acuerdo|claro|por ?fa(vor)?|bueno|obvio|as[ií] es|s[ií]\s*por ?favor)[\s.!👍🙌✅]*$/.test(t);
}

/** ¿El último mensaje del asistente venía ofreciendo el PDF/propuesta formal? */
export function lastAssistantOfferedPdf(history) {
  for (let i = (history || []).length - 1; i >= 0; i--) {
    const m = history[i];
    if (m && m.role === 'assistant') {
      return /\bpdf\b|propuesta formal|propuesta t[eé]cnica|cotizaci[oó]n formal|te (la |lo )?env[ií]o|enviar(te)? (la|el)|¿te (gustar[ií]a|env[ií]o)|mando la propuesta|(te|se|le) la preparo|prepar(o|amos|o la propuesta)|misma propuesta|se la preparo con/i.test(String(m.content || ''));
    }
  }
  return false;
}

/** Extrae los items cotizados de las tool calls del turno (para pending_quote). */
export function itemsFromQuoteCalls(toolCalls, defaultColor) {
  return (toolCalls || [])
    .filter(t => (t.name === 'calcular_cotizacion' || t.name === 'calcular_por_area') && t.result && t.result.ok && Number(t.result.unit_price) > 0)
    .map(t => {
      // [2026-07-06 LOTE2] PRIORIDAD: medidas RESUELTAS por el tool ("AxBmm" — sobreviven la confirmación
      // de unidad). Se separan en CAMPOS NUMÉRICOS (ancho_mm/alto_mm: las re-cotizaciones del PDF usan
      // esto exacto, sin re-parsear) + string LIMPIO para display (Zoho/PDF/alertas ven "350x600").
      // Antes, el texto crudo del cliente ("350x600") se re-manglaba ×10 al re-cotizar en generarPdf.
      const _res = String(t.result?.medidas_resueltas || '').match(/^(\d+)x(\d+)mm$/i);
      return {
        product: t.result.producto_label || t.input?.tipo || 'Ventana',
        producto_label: t.result.producto_label || t.input?.tipo || 'Ventana',
        measures: _res ? `${_res[1]}x${_res[2]}`
          : (t.input?.medidas_texto || t.input?.measures || t.result?.medidas_derivadas ||
            ((t.input?.ancho_mm && t.input?.alto_mm) ? `${t.input.ancho_mm}x${t.input.alto_mm}` : '')),
        ancho_mm: _res ? Number(_res[1]) : undefined,
        alto_mm: _res ? Number(_res[2]) : undefined,
        color: t.input?.color || defaultColor || '',
        qty: Number(t.result.cantidad) || Number(t.input?.cantidad) || 1,
        unit_price: Number(t.result.unit_price) || 0,
        glass_label: t.result.glass_label || 'Termopanel DVH',
        ambiente: t.input?.ambiente || '',
        termico: t.result?.termico || null,   // [thermal] Uw → PDF (camino determinista)
        referencial: !!t.result?.referencial, // [2026-07-07] fuera de estándar → escalación a Marcelo (revisión ingeniería)
      };
    })
    .filter(it => Number(it.unit_price) > 0);
}

/**
 * [PDF-RACE 2026-07-01] Guard de COMPLETITUD antes de quemar folio ISO / emitir el PDF (COMPARTIDO).
 * Evidencia BD: PDFs emitidos 9-13 seg ANTES de que el cliente respondiera nombre/color/tipo
 * (folios 0081/0085/0086 Ximena, 0060/0061 Vivi, 0090 Julio — causalidad invertida probada).
 * Regla del dueño: PDF formal SOLO con datos confirmados; el NOMBRE se obtiene ANTES del PDF.
 * NO exige color (política REGLA #13: BLANCO por defecto) para no bloquear PDFs legítimos.
 */
export function quoteDataComplete(input = {}, state = {}) {
  const missing = [];
  const name = String(input.name || state.name || '').trim();
  if (!name || /^cliente$/i.test(name)) missing.push('name');
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) missing.push('items');
  items.forEach((it, i) => {
    if (!String(it.producto_label || it.product || '').trim()) missing.push(`items[${i}].product`);
    if (!String(it.measures || '').trim()) missing.push(`items[${i}].measures`);
    if (!(Number(it.unit_price) > 0)) missing.push(`items[${i}].unit_price`);
  });
  return { ok: missing.length === 0, missing };
}

/**
 * [#2 2026-06-21] Anti "precio suelto" (REGLA #13): el monto va SOLO en el PDF formal, NUNCA en el
 * texto del chat. Si el LLM dejó un monto CLP en la respuesta (desobedeció), lo reemplaza por un
 * redirect a la propuesta. El PDF se entrega por el flujo determinista (mismo/próximo turno).
 * CONSERVADOR a propósito (cero falsos positivos): solo dispara con (a) "$" + miles agrupados,
 * (b) miles agrupados + "pesos/CLP", o (c) ≥2 grupos de miles (≥ 1.000.000). NO toca medidas
 * "1.20 m" / "120x150" / "2.400 mm", cantidades "2 ventanas", folios "N° 0021", ni teléfonos.
 */
export function stripMontos(text) {
  if (!text) return text;
  // [Ronda 4 2026-07-20] Separador [.,]: el LLM escribió "$291,158 c/u" (coma gringa) y
  // el regex solo entendía punto chileno → el precio LLEGÓ al cliente (caso real 07-19,
  // conversation_messages, reportado por el dueño). Mismo diseño conservador: la coma
  // exige grupo de EXACTAMENTE 3 dígitos, así "1,5 metros" / "120x150" no se tocan.
  const RX = /\$\s?\d{1,3}(?:[.,]\d{3})+(?:\s?(?:CLP|clp|pesos?))?|\d{1,3}(?:[.,]\d{3})+\s?(?:CLP|clp|pesos?)|\d{1,3}(?:[.,]\d{3}){2,}/g;
  const out = text.replace(RX, '(valor en la propuesta formal)');
  return out === text ? text : out.replace(/\s{2,}/g, ' ').trim();
}

/**
 * [Ronda 4 2026-07-20] Borra ACCIONES FALSAS que el LLM narra en vez de ejecutar:
 * "[Enlace a la cotización]", "[Calculando propuesta...]", "[PDF adjunto]" — casos
 * reales del 16-19 jul (el prompt las prohíbe pero el modelo las escribió igual).
 * Determinista y conservador: solo corchetes que EMPIEZAN con esos verbos/sustantivos.
 * Si el reply queda vacío, el fallback de respuesta-vacía existente toma el control.
 */
export function stripAccionesFalsas(text) {
  if (!text) return text;
  const RX = /\[\s*(?:enlace|link|url|calculando|generando|preparando|procesando|adjunto|pdf|documento|descarga)[^\]\n]*\]/gi;
  const out = text.replace(RX, '');
  return out === text ? text : out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
