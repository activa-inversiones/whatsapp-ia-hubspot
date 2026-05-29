// engine-client.js — Cliente HTTP del ACTIVA Engine v1.1
// Motor de cotización productivo en https://ops.activalabs.ai (error 0.02% vs Winart)
// ESM | Node 18+ | usa axios (ya en package.json)
//
// Shapes verificados contra el Engine real (2026-05-29):
//   - GET  /api/engine/glasses          -> público (sin auth)
//   - POST /api/quotes/calculate        -> público (sin auth)
//   - POST /api/quotes/calculate-by-area-> público (sin auth)
//   - POST /api/quotes/:id/share        -> REQUIERE auth (401 sin credenciales)
// Sólo el endpoint de share necesita Authorization; los de cálculo/listado son abiertos.

import axios from "axios";

const ENGINE_BASE_URL = process.env.ACTIVA_ENGINE_URL || "https://ops.activalabs.ai";
const ENGINE_API_KEY = process.env.ACTIVA_ENGINE_KEY || "";

const engine = axios.create({
  baseURL: ENGINE_BASE_URL,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

/**
 * POST /api/quotes/calculate
 * Cotización exacta por medidas. Endpoint público (no requiere auth).
 *
 * Request body (verificado):
 *   { tipo:string, ancho_mm:number, alto_mm:number, color:string,
 *     glass_id:number, comuna:string,
 *     serie?:string="S60", cantidad?:number=1, margen?:number=0.3 }
 *   - glass_id es numérico; los IDs vienen de GET /api/engine/glasses.
 *
 * @param {{ tipo:string, ancho_mm:number, alto_mm:number, color:string,
 *           glass_id:number, comuna:string, serie?:string,
 *           cantidad?:number, margen?:number }} params
 * @returns {Promise<object>} Respuesta real del Engine, p.ej.:
 *   {
 *     ok: boolean,
 *     input: { tipo, ancho_mm, alto_mm, serie, glass_id, color, comuna, cantidad, margen },
 *     area_m2: number,
 *     precio_por_m2: number,
 *     geometria: { ancho_m:number, alto_m:number, m2:number, perimetro_m:number },
 *     items: Array<{ tipo:string, codigo:string, descripcion:string,
 *                    cantidad_m?:number, cantidad_m2?:number, cantidad?:number,
 *                    precio_unit_m?:number, precio_unit_m2?:number, precio_unit?:number,
 *                    subtotal:number, lookup_source?:string }>,
 *     materiales: { items: Array<item>, subtotal:number },
 *     mano_obra:   { utv_factor:number, costo_unitario_clp:number, costo_total_clp:number },
 *     instalacion: { utv_factor:number, costo_unitario_clp:number, costo_total_clp:number },
 *     breakdown: { materiales:number, mano_obra:number, instalacion:number,
 *                  subtotal_unidad:number, cantidad:number, subtotal_unidades:number,
 *                  comuna_multiplier:number, subtotal_con_logistica:number,
 *                  margen_pct:number, total_neto_clp:number },
 *     subtotal: number,
 *     margen_pct: number,
 *     total_clp: number,        // neto
 *     total_con_iva: number,    // total con IVA (precio a cliente)
 *     flete_clp: number,
 *     lookups: { marco:string, hoja:string, vidrio:string },
 *     engine_version: string    // "v1.1"
 *   }
 */
export async function calcularCotizacion(params) {
  const body = {
    tipo: params.tipo,
    ancho_mm: params.ancho_mm,
    alto_mm: params.alto_mm,
    color: params.color,
    glass_id: params.glass_id,
    comuna: params.comuna,
  };
  if (params.serie !== undefined) body.serie = params.serie;
  if (params.cantidad !== undefined) body.cantidad = params.cantidad;
  if (params.margen !== undefined) body.margen = params.margen;

  const { data } = await engine.post("/api/quotes/calculate", body);
  return data;
}

/**
 * POST /api/quotes/calculate-by-area
 * Cotización por m² (UX cliente que no sabe medidas exactas). Endpoint público.
 * El Engine deriva ancho/alto desde el área y devuelve `derived_dimensions`.
 *
 * Request body (verificado):
 *   { tipo:string, area_m2:number, color:string, comuna:string, glass_id:number,
 *     serie?:string, cantidad?:number, margen?:number }
 *   - OJO: el campo es `area_m2` (NO `m2`). `glass_id` es obligatorio.
 *
 * @param {{ tipo:string, area_m2:number, color:string, comuna:string,
 *           glass_id:number, serie?:string, cantidad?:number, margen?:number }} params
 * @returns {Promise<object>} Misma forma que calcularCotizacion() más:
 *   {
 *     derived_dimensions: { ancho_mm:number, alto_mm:number, proporcion_resolved:string },
 *     ... (input, area_m2, geometria, items, materiales, mano_obra, instalacion,
 *          breakdown, total_clp, total_con_iva, flete_clp, engine_version, etc.)
 *   }
 */
export async function calcularPorArea(params) {
  const body = {
    tipo: params.tipo,
    area_m2: params.area_m2,
    color: params.color,
    comuna: params.comuna,
    glass_id: params.glass_id,
  };
  if (params.serie !== undefined) body.serie = params.serie;
  if (params.cantidad !== undefined) body.cantidad = params.cantidad;
  if (params.margen !== undefined) body.margen = params.margen;

  const { data } = await engine.post("/api/quotes/calculate-by-area", body);
  return data;
}

/**
 * GET /api/engine/glasses?tipo=TERMOPANEL
 * Lista de vidrios disponibles para un tipo. Endpoint público.
 *
 * @param {string} tipo  p.ej. "TERMOPANEL"
 * @returns {Promise<object>} {
 *   ok: boolean,
 *   count: number,
 *   glasses: Array<{
 *     id: number,                 // <-- id numérico que se pasa como glass_id
 *     code: string,               // p.ej. "TP-M-4+10+4"
 *     description: string,        // p.ej. "DVH Inc. 4mm / Sep. 10mm Mate / Inc. 4mm"
 *     price_m2_clp: number,
 *     thickness_mm: number,
 *     category_name: string,      // p.ej. "DVH Incoloro"
 *     is_termopanel: boolean,
 *     allow_palillos: boolean,
 *     allow_micropersiana: boolean
 *   }>
 * }
 */
export async function listarVidrios(tipo) {
  const { data } = await engine.get("/api/engine/glasses", { params: { tipo } });
  return data;
}

/**
 * POST /api/quotes/:id/share
 * Genera link compartible de la cotización (/q/:uuid).
 * ⚠️ A diferencia de los endpoints de cálculo, ESTE requiere autenticación:
 *    sin credenciales el Engine responde 401 "Authentication required".
 *    Se envía Authorization: Bearer <ACTIVA_ENGINE_KEY>.
 *
 * @param {string} quoteId
 * @returns {Promise<object>} // inferred from /share: { ok:boolean, url:string, uuid?:string }
 */
export async function generarLinkAprobacion(quoteId) {
  const headers = ENGINE_API_KEY
    ? { Authorization: `Bearer ${ENGINE_API_KEY}` }
    : {};
  const { data } = await engine.post(
    `/api/quotes/${encodeURIComponent(quoteId)}/share`,
    {},
    { headers },
  );
  return data;
}

export { ENGINE_BASE_URL };
