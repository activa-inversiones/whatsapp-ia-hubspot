// services/documentosCotizacion.js — [2026-09-30, rediseñado tras la compuerta cruzada]
// ═══════════════════════════════════════════════════════════════════════════
// QUÉ DOCUMENTOS ACOMPAÑAN A ESTA COTIZACIÓN (selector por cotización)
// Pedido del dueño (30-sep): una MODIFICACIÓN de la cotización no le reenvía los informes al
// cliente. La decisión vive en sales-os (`/internal/cotizacion-documentos/decidir`), con la
// regla "¿este cliente YA RECIBIÓ este informe?" (registro ISO de entregas) y la marca manual
// del cockpit.
//
// Si sales-os no contesta (o tarda más de 4 s), se decide LOCAL con la MISMA regla, usando lo
// que este bot sabe: las marcas `docs_entregado:<tipo>:<últimos 9>` que deja al ENTREGAR cada
// informe (después del ok de Meta, nunca al intentar). Un informe que falló no deja marca ⇒
// el próximo envío lo manda. (Antes el respaldo era "¿había cotización en la sesión?", que
// repetía el defecto: un primer informe fallido no salía nunca más.)
// La propuesta NUNCA se apaga desde acá (caso #778: salieron informes y no la propuesta).
// ═══════════════════════════════════════════════════════════════════════════

// MISMA variable y MISMO default que sales-os (cotizacionDocumentos.ventanaDias): si alguien la
// cambia en Railway, el respaldo local no se queda con otra ventana.
export const ventanaDias = () => {
  const n = Number(process.env.COTIZACION_DOCS_VENTANA_DIAS);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 90;
};
export const entregaTtlSeg = () => ventanaDias() * 24 * 3600;
const ult9 = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-9) : ''; };
export const claveEntrega = (telefono, tipo) => `docs_entregado:${tipo}:${ult9(telefono)}`;

/** Deja constancia local de que el informe `tipo` LLEGÓ a este cliente. */
export async function marcarEntregaLocal(telefono, tipo, escribirEstado) {
  if (!ult9(telefono) || typeof escribirEstado !== 'function') return;
  await escribirEstado(claveEntrega(telefono, tipo), { at: Date.now() }, entregaTtlSeg());
}

/** Lo que el bot sabe de sus propias entregas. Ante error: "no lo sé" = no entregado. */
export async function leerEntregasLocales(telefono, leerEstado) {
  const leer = async (tipo) => {
    try { return Boolean(ult9(telefono) && typeof leerEstado === 'function' && await leerEstado(claveEntrega(telefono, tipo))); }
    catch { return false; }
  };
  return { termicoEntregado: await leer('termico'), vientosEntregado: await leer('vientos') };
}

export function decisionLocal({ termicoEntregado = false, vientosEntregado = false } = {}) {
  const termico = !termicoEntregado; const vientos = !vientosEntregado;
  return { termico, vientos, propuesta: true,
    origen: termico && vientos ? 'local_primera' : (termico || vientos ? 'local_falta_informe' : 'local_modificacion') };
}

/**
 * @returns {Promise<{termico:boolean, vientos:boolean, propuesta:true, origen:string}>}
 */
export async function decidirDocumentosCotizacion({ telefono, quoteNumber, termicoEntregado = false, vientosEntregado = false }, {
  fetchImpl = globalThis.fetch,
  url = process.env.SALES_OS_URL || '',
  token = process.env.SALES_OS_OPERATOR_TOKEN || '',
  timeoutMs = 4000,
} = {}) {
  const local = decisionLocal({ termicoEntregado, vientosEntregado });
  const base = String(url).replace(/\/$/, '');
  if (!base || !token || !quoteNumber || typeof fetchImpl !== 'function') return local;
  try {
    const r = await fetchImpl(`${base}/internal/cotizacion-documentos/decidir`, {
      method: 'POST',
      headers: { 'x-api-key': token, 'Content-Type': 'application/json' },
      // docs_entregado: lo que ESTE bot sabe que entregó (marcas locales). sales-os lo suma (OR)
      // a su registro de entregas, por si la fila 'entregado' no alcanzó a quedar en la BD.
      body: JSON.stringify({ tenant_id: 'activa', telefono: String(telefono || ''), quote_number: String(quoteNumber),
        docs_entregado: { termico: Boolean(termicoEntregado), vientos: Boolean(vientosEntregado) } }),
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
