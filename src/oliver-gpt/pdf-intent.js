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
    .map(t => ({
      product: t.result.producto_label || t.input?.tipo || 'Ventana',
      producto_label: t.result.producto_label || t.input?.tipo || 'Ventana',
      measures: t.input?.medidas_texto || t.input?.measures || t.result?.medidas_derivadas ||
        ((t.input?.ancho_mm && t.input?.alto_mm) ? `${t.input.ancho_mm}x${t.input.alto_mm}` : ''),
      color: t.input?.color || defaultColor || '',
      qty: Number(t.result.cantidad) || Number(t.input?.cantidad) || 1,
      unit_price: Number(t.result.unit_price) || 0,
      glass_label: t.result.glass_label || 'Termopanel DVH',
      ambiente: t.input?.ambiente || '',
    }))
    .filter(it => Number(it.unit_price) > 0);
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
  const RX = /\$\s?\d{1,3}(?:\.\d{3})+(?:\s?(?:CLP|clp|pesos?))?|\d{1,3}(?:\.\d{3})+\s?(?:CLP|clp|pesos?)|\d{1,3}(?:\.\d{3}){2,}/g;
  const out = text.replace(RX, '(valor en la propuesta formal)');
  return out === text ? text : out.replace(/\s{2,}/g, ' ').trim();
}
