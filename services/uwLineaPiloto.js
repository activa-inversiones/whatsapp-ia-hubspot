// services/uwLineaPiloto.js
// ═══════════════════════════════════════════════════════════════════════════
// [2026-10-21] PILOTO: el informe Uw CERTIFICADO de la línea cotizada, al cliente.
//
// Decisión del dueño (21-oct, textual): «Sí: entreguemos el informe Uw/Uf de la línea
// cotizada, primero a una lista chica de clientes para medir el efecto». Y en la misma
// conversación: piloto «Solo mi número primero»; calce SOLO EXACTO de la línea (la
// «Abatible S60» NO recibe el V8H oscilobatiente y la «Puerta abatible exterior con
// zapata S60» NO recibe el V9 Zenia: «No, son distintas»).
// Propuesta: temp-sales-os `_activa-docs/PROPUESTA-INFORMES-AUTOMATICOS-CLIENTE-2026-10-21.md`
// (IMP-CM-FR-027, hueco H5) · tablero #1581 (renumerado desde #1575).
//
// Qué es y qué NO es:
//  - Es el informe que ACTIVA Thermal YA emitió con folio AT-NCH3137-1-… y QR verificable,
//    para la ventana TIPO de cada línea (catálogo fijo). Se descarga de su verificación
//    PÚBLICA `/verificar/{codigo}/pdf`: no pide key, no emite folio nuevo, no calcula nada.
//  - NO es un informe de las ventanas a medida del cliente. El caption lo dice (riesgo que
//    marcó el tridente del 21-oct: que se lea como certificación individual).
//  - Thermal es un PROVEEDOR: si no contesta, no se manda y la propuesta sigue su curso.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';

// Folios VIGENTES tras la reemisión del 20-oct (activa-thermal origin/main,
// tools/informe_nodo/informe_uw.py: VIGENTE + REEMPLAZOS). El código lleva el sufijo que
// pide la verificación pública. 🔴 Si Thermal reemite una ventana, ESTA tabla se actualiza
// con el folio nuevo: el viejo sigue verificable pero dice «reemplazado».
// Las llaves son el rótulo EXACTO que pone el motor (medido en `quotes.payload.items`,
// 120 días, 21-oct). `sha256` = el que publica la verificación pública de cada folio (leído
// 21-oct, igual al del PDF descargado): el bot solo entrega ESE archivo exacto (Thermos r1). Rótulos: «Corredera SLIDING H98 Doble Riel S75» 225 · «Corredera ANDES 66
// Monorriel» 6 · «Corredera SLIDING H98 Triple Riel S75» 3 · Andes 66 doble riel: 0 hoy.
export const CATALOGO_UW_LINEA = Object.freeze({
  'corredera sliding h98 triple riel s75': Object.freeze({
    ventana: 'V1', folio: 'AT-NCH3137-1-2026-000026', codigo: 'AT-NCH3137-1-2026-000026-aa8c17',
    sha256: '462563e72efac4e1f60ee954fc91a3a5efcac3632f66f359183529ae69ffca0f',
    linea: 'Corredera S75 H98 triple riel', archivo: 'Corredera-S75-H98-Triple-Riel',
  }),
  'corredera sliding h98 doble riel s75': Object.freeze({
    ventana: 'V2N', folio: 'AT-NCH3137-1-2026-000027', codigo: 'AT-NCH3137-1-2026-000027-7492c9',
    sha256: '49cd9956631948c374f12b3011606a4667a90165801497e236f934c05fb56bec',
    linea: 'Corredera S75 H98 doble riel', archivo: 'Corredera-S75-H98-Doble-Riel',
  }),
  'corredera andes 66 monorriel': Object.freeze({
    ventana: 'V4N', folio: 'AT-NCH3137-1-2026-000028', codigo: 'AT-NCH3137-1-2026-000028-13ffa7',
    sha256: 'f1c9b7e7769b3d3d27d34e6eb9237f864e1c58c21486d12b4a6981d7482852d0',
    linea: 'Corredera Andes H66 monorriel', archivo: 'Corredera-Andes-H66-Monorriel',
  }),
  'corredera andes 66 doble riel': Object.freeze({
    ventana: 'V5N', folio: 'AT-NCH3137-1-2026-000029', codigo: 'AT-NCH3137-1-2026-000029-034e94',
    sha256: '7afeca8bb6626077fddb8df49da781de93dc56a144ffd6d07259dd2bab2cc428',
    linea: 'Corredera Andes H66 doble riel', archivo: 'Corredera-Andes-H66-Doble-Riel',
  }),
});

// Tope de documentos por proyecto: un proyecto con 4 líneas distintas no recibe 4 PDFs más.
export const MAX_INFORMES_UW = 2;
const MAX_BYTES = 5 * 1024 * 1024;

const normalizar = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Las entradas del catálogo que calzan EXACTO con las líneas cotizadas, sin repetir y en
 *  el orden en que aparecen. Un rótulo con agregados («— Blanco», «3 hojas», «⚠️ Referencial»)
 *  NO calza: es la regla del dueño (solo calce exacto). */
export function elegirInformesUwLinea(items) {
  const vistos = new Set();
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const e = CATALOGO_UW_LINEA[normalizar(it?.producto_label || it?.product || '')];
    if (!e || vistos.has(e.ventana)) continue;
    vistos.add(e.ventana);
    out.push(e);
    if (out.length >= MAX_INFORMES_UW) break;
  }
  return out;
}

// Lista del piloto. Por defecto, SOLO el número del dueño (su elección del 21-oct): así el
// piloto arranca sin tocar Railway y lo primero que se ve es lo que él mismo recibe.
// `UW_LINEA_PILOTO_LISTA` la reemplaza (teléfonos separados por coma, '*' = todos) y
// `UW_LINEA_PILOTO_LISTA=-` lo apaga.
const DUENO = '56957296035';
export function listaPiloto(env = process.env) {
  const crudo = env.UW_LINEA_PILOTO_LISTA;
  if (crudo === undefined || String(crudo).trim() === '') return [DUENO];
  if (String(crudo).trim() === '-') return [];
  return String(crudo).split(',').map((t) => (t.trim() === '*' ? '*' : t.replace(/\D/g, ''))).filter(Boolean);
}

export function enPilotoUwLinea(waId, { lista = listaPiloto() } = {}) {
  if (!Array.isArray(lista) || !lista.length) return false;
  if (lista.includes('*')) return true;
  const tel = String(waId || '').replace(/\D/g, '');
  return Boolean(tel) && lista.includes(tel);
}

/** Descarga el PDF de la verificación PÚBLICA de Thermal. Devuelve un Buffer o lanza. */
export async function descargarInformeUw(codigo, {
  sha256 = null,
  fetchImpl = fetch,
  baseUrl = process.env.THERMAL_API_URL || 'https://activa-thermal-production.up.railway.app',
  timeoutMs = 15_000,
} = {}) {
  if (!/^AT-NCH3137-1-\d{4}-\d{6}-[0-9a-f]{6}$/.test(String(codigo || ''))) {
    throw new Error(`código de verificación inválido: ${codigo}`);
  }
  const url = `${String(baseUrl).replace(/\/$/, '')}/verificar/${codigo}/pdf`;
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`Thermal /verificar → HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`PDF de ${buf.length} bytes, sobre el tope`);
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('la respuesta no es un PDF');
  // Si el catálogo trae el hash, el archivo tiene que ser ESE: un PDF regenerado o cambiado no
  // sale al cliente aunque la verificación siga respondiendo.
  if (sha256 && createHash('sha256').update(buf).digest('hex') !== sha256) {
    throw new Error(`el PDF de ${codigo} no coincide con el sha256 del catálogo`);
  }
  return buf;
}

/** Nombre que ve el cliente. Lleva el folio de Thermal: así sales-os lo archiva en CM-FR-008. */
export const nombreParaCliente = (e) => `Informe-Uw-${e.archivo}-${e.folio}.pdf`;

/** Nombre del archivo ISO de ESTA entrega. El mismo PDF va a muchos clientes y WorkDrive no
 *  sobrescribe (`overwrite:false`): sin un sufijo por entrega, la 2ª copia fallaría al archivar.
 *  [Codex r1] Minuto + 4 dígitos podía repetirse (dos entregas al mismo teléfono en el mismo
 *  minuto): va el id del mensaje de Meta, que es único por envío, y milisegundos de respaldo. */
export function nombreParaArchivo(e, telefono, ahora = new Date(), msgId = '') {
  const tel4 = String(telefono || '').replace(/\D/g, '').slice(-4) || '0000';
  const ts = ahora.toISOString().replace(/[-:T.Z]/g, '').slice(0, 17);
  const id = String(msgId || '').replace(/[^0-9A-Za-z]/g, '').slice(-12);
  return `Informe-Uw-${e.archivo}-${e.folio}-entrega-${ts}-${tel4}${id ? `-${id}` : ''}.pdf`;
}

/** Lo que acompaña al PDF. Dice qué es y qué NO es (tridente 21-oct). Sin siglas sin explicar
 *  (doctrina del dueño del 27-ago: el concepto primero, la sigla como su nombre corto). */
export function captionUwLinea(e) {
  // Sin «certificado» ni «laboratorio»: ACTIVA Thermal es un servicio de cálculo y el
  // documento es un informe técnico con folio verificable. Prometer más es un claim sin respaldo.
  return `Le comparto además el informe técnico de aislación térmica de la línea ${e.linea}: ` +
    `cuánto aísla del frío la ventana completa (la transmitancia térmica, que en el informe aparece como "Uw"), ` +
    `calculada según la norma chilena NCh 3137 por ACTIVA Thermal, nuestro servicio de cálculo térmico. ` +
    `Corresponde a la ventana tipo de esta línea, no a las medidas exactas de sus ventanas. ` +
    `Puede comprobar que es auténtico con el código QR del documento.`;
}

/** Tipo de entrega para el candado que YA usa el selector de documentos
 *  (`documentosCotizacion.js`: `claveEntrega(telefono, tipo)` + `entregaTtlSeg()`), en vez de
 *  un candado paralelo con su propia llave y su propio TTL (Thermos calidad r1, B3). */
export const tipoEntregaUw = (e) => `uw_linea:${e.ventana}`;
