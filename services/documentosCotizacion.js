// services/documentosCotizacion.js — [2026-09-30]
// ═══════════════════════════════════════════════════════════════════════════
// QUÉ DOCUMENTOS ACOMPAÑAN A ESTA COTIZACIÓN (selector por cotización)
// Pedido del dueño (30-sep): una MODIFICACIÓN de la cotización no le reenvía los informes al
// cliente. La decisión vive en sales-os (`/internal/cotizacion-documentos/decidir`), donde el
// cockpit puede marcar a mano qué va con la próxima versión.
//
// Si sales-os no contesta, se decide LOCAL con la misma regla:
//   · no había cotización previa en la sesión → los tres (lo de siempre);
//   · había cotización previa                 → solo la propuesta.
// La propuesta NUNCA se apaga desde acá (caso #778: salieron informes y no la propuesta).
// ═══════════════════════════════════════════════════════════════════════════

export function decisionLocal({ habiaCotizacionPrevia }) {
  const primera = !habiaCotizacionPrevia;
  return { termico: primera, vientos: primera, propuesta: true,
    origen: primera ? 'local_primera' : 'local_modificacion' };
}

/**
 * @returns {Promise<{termico:boolean, vientos:boolean, propuesta:true, origen:string}>}
 */
export async function decidirDocumentosCotizacion({ telefono, quoteNumber, habiaCotizacionPrevia = false }, {
  fetchImpl = globalThis.fetch,
  url = process.env.SALES_OS_URL || '',
  token = process.env.SALES_OS_OPERATOR_TOKEN || '',
  timeoutMs = 4000,
} = {}) {
  const local = decisionLocal({ habiaCotizacionPrevia });
  const base = String(url).replace(/\/$/, '');
  if (!base || !token || !quoteNumber || typeof fetchImpl !== 'function') return local;
  try {
    const r = await fetchImpl(`${base}/internal/cotizacion-documentos/decidir`, {
      method: 'POST',
      headers: { 'x-api-key': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: 'activa', telefono: String(telefono || ''), quote_number: String(quoteNumber) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r?.ok) return local;
    const j = await r.json();
    if (!j || j.ok !== true || typeof j.termico !== 'boolean' || typeof j.vientos !== 'boolean') return local;
    return { termico: j.termico, vientos: j.vientos, propuesta: true, origen: String(j.origen || 'sales_os') };
  } catch {
    return local;
  }
}
