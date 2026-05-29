// engine-client.js — Cliente HTTP del ACTIVA Engine v1.1
// Motor de cotización productivo en https://ops.activalabs.ai (error 0.02% vs Winart)
// ESM | Node 18+ | usa axios (ya en package.json)
//
// ⚠️ TODO(schema): Los shapes exactos de request/response están INFERIDOS de los
//    endpoints conocidos. Confirmar contra el Engine real y ajustar los campos
//    marcados con TODO antes de producción.

import axios from "axios";

const ENGINE_BASE_URL = process.env.ACTIVA_ENGINE_URL || "https://ops.activalabs.ai";
const ENGINE_API_KEY = process.env.ACTIVA_ENGINE_KEY || ""; // TODO(auth): confirmar si el Engine requiere API key/Bearer

const engine = axios.create({
  baseURL: ENGINE_BASE_URL,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
    // TODO(auth): si el Engine usa Bearer/API-Key, descomentar:
    // Authorization: `Bearer ${ENGINE_API_KEY}`,
  },
});

/**
 * POST /api/quotes/calculate
 * Cotización exacta por medidas.
 * @param {{ tipo:string, ancho_mm:number, alto_mm:number, color:string, glass_id:string, comuna:string }} params
 * @returns {Promise<object>} TODO(schema): forma real de la respuesta (precio, id, desglose…)
 */
export async function calcularCotizacion(params) {
  const { data } = await engine.post("/api/quotes/calculate", {
    tipo: params.tipo,
    ancho_mm: params.ancho_mm,
    alto_mm: params.alto_mm,
    color: params.color,
    glass_id: params.glass_id,
    comuna: params.comuna,
    // TODO(schema): ¿el Engine espera `cantidad`, `items[]`, u otros campos?
  });
  return data;
}

/**
 * POST /api/quotes/calculate-by-area
 * Cotización por m² (UX cliente que no sabe medidas exactas).
 * @param {{ tipo:string, m2:number, color:string, comuna:string }} params
 * @returns {Promise<object>}
 */
export async function calcularPorArea(params) {
  const { data } = await engine.post("/api/quotes/calculate-by-area", {
    tipo: params.tipo,
    m2: params.m2,
    color: params.color,
    comuna: params.comuna,
  });
  return data;
}

/**
 * GET /api/engine/glasses?tipo=TERMOPANEL
 * Lista de vidrios disponibles para un tipo.
 * @param {string} tipo
 * @returns {Promise<object>} TODO(schema): array de { glass_id, nombre, descripcion, ... }
 */
export async function listarVidrios(tipo) {
  const { data } = await engine.get("/api/engine/glasses", { params: { tipo } });
  return data;
}

/**
 * POST /api/quotes/:id/share
 * Genera link compartible de la cotización (/q/:uuid).
 * @param {string} quoteId
 * @returns {Promise<object>} TODO(schema): { url } o { uuid } — confirmar
 */
export async function generarLinkAprobacion(quoteId) {
  const { data } = await engine.post(`/api/quotes/${encodeURIComponent(quoteId)}/share`);
  return data;
}

export { ENGINE_BASE_URL };
