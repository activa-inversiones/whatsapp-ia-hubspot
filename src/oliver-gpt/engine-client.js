// engine-client.js — Cliente HTTP del ACTIVA Engine para Oliver GPT
//
// Contrato (plan maestro secciones 1.5 #92-104 y 2.4):
//   - calcularCotizacion: POST /api/quotes/calculate
//       'tipo' es la APERTURA de la ventana (enum cerrado), NO el vidrio.
//       glass_id es obligatorio. NUNCA se acepta 'TERMOPANEL' como 'tipo'
//       (el termopanel es una familia de vidrio que se elige por glass_id).
//   - calcularPorArea: POST /api/quotes/calculate-by-area
//       campo 'area_m2' (NO 'm2'); glass_id obligatorio.
//   - listarVidrios: GET /api/engine/glasses?tipo=TERMOPANEL|MONOLITICO
//       aqui 'tipo' SI es la familia de vidrio. Devuelve glasses con id=glass_id.
//   - generarLinkAprobacion: POST /api/quotes/:id/share con quote_payload en el
//       body + header Authorization: Bearer ACTIVA_ENGINE_KEY.
//
// ESM, fetch nativo (Node 18+).

import { detectarProductoFueraDeAlcance } from '../../services/productoFueraDeAlcance.js';

const BASE_URL = () =>
  (process.env.ACTIVA_ENGINE_URL || 'https://ops.activalabs.ai').trim().replace(/\/+$/, ''); // .trim(): robusto a espacios/tabs en la var de Railway

const DEFAULT_TIMEOUT_MS = 15000;

// Aperturas validas para el campo 'tipo' de /calculate y /calculate-by-area.
// TERMOPANEL NO esta aqui a proposito: es un vidrio, no una apertura.
// [Ronda 3 2026-07-20] + PUERTAS ABATIBLES: el motor las cotiza desde junio (BOM real
// clonado de Winart v58692-97, quoteEngine S60_BOM_TYPES + limites 800-1970x1500-2400)
// pero este enum las dejaba inalcanzables — verificado en vivo: PUERTA 900x2100 y
// PUERTA_DOBLE 1400x2100 cotizan con BOM completo. Dato confirmado por el dueno.
export const APERTURAS = Object.freeze([
  'CORREDERA',
  'PROYECTANTE',
  'FIJA',
  'BATIENTE',
  'OSCILOBATIENTE',
  // [2026-08-25] "Mitad fija + mitad proyectante, unidas" — UNA ventana, la que mas se
  // vende (decision del dueño, PROPUESTA-COMPUESTA). El motor reparte el vano 50/50 por
  // defecto; con `partes` explicitas se respetan los anchos del cliente.
  'COMPUESTA',
  'PUERTA',           // abatible exterior con zapata, 1 hoja (default del motor)
  'PUERTA_INTERIOR',  // abatible interior, 1 hoja
  'PUERTA_DOBLE',     // abatible 2 hojas con zapata
]);

// Familias de vidrio validas para listarVidrios.
export const FAMILIAS_VIDRIO = Object.freeze(['TERMOPANEL', 'MONOLITICO']);

// [2026-06-14] ALLOWLIST DE VIDRIOS — Oliver SOLO cotiza estos 3 termopaneles DVH
// (separador Thermoflex), que son los que Activa tiene configurados y vende:
//   34 = TP-M-4+12+4   (DVH 4+12+4)        $42.679/m2
//   38 = TP-M-4+12+4S  (DVH 4+12+4 saten)  $50.000/m2
//   61 = TP-M-5+12+5   (DVH 5+12+5)        $54.306/m2
// Guard DURO en exigirGlassId(): cualquier otro glass_id se rechaza → el LLM jamas
// cotiza con un vidrio fuera de catalogo, aunque alucine un id. Editar aqui para cambiar.
export const ALLOWED_GLASS_IDS = Object.freeze([34, 38, 61]);

class EngineError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'EngineError';
    this.status = status;
    this.body = body;
  }
}

function normalizarApertura(tipo) {
  if (tipo === undefined || tipo === null || tipo === '') {
    throw new EngineError("El campo 'tipo' (apertura) es obligatorio.");
  }
  const t = String(tipo).trim().toUpperCase();
  // FIX TERMOPANEL: el termopanel es un vidrio, jamas una apertura.
  if (t === 'TERMOPANEL') {
    throw new EngineError(
      "'TERMOPANEL' es una familia de vidrio, no una apertura. " +
        "Use 'tipo' con una apertura valida {CORREDERA, PROYECTANTE, FIJA, BATIENTE, OSCILOBATIENTE} " +
        'y seleccione el termopanel con glass_id (vea listarVidrios).'
    );
  }
  if (!APERTURAS.includes(t)) {
    throw new EngineError(
      `Apertura desconocida: '${tipo}'. Valores validos: ${APERTURAS.join(', ')}.`
    );
  }
  return t;
}

function exigirGlassId(glass_id) {
  if (glass_id === undefined || glass_id === null || glass_id === '') {
    throw new EngineError('glass_id es obligatorio.');
  }
  const n = Number(glass_id);
  if (!Number.isFinite(n) || n <= 0) {
    throw new EngineError(`glass_id invalido: '${glass_id}'.`);
  }
  // [2026-06-14] Guard duro: solo los 3 termopaneles DVH configurados.
  if (!ALLOWED_GLASS_IDS.includes(n)) {
    throw new EngineError(
      `glass_id ${n} no permitido. Activa solo cotiza 3 termopaneles DVH: ` +
      `34 (4+12+4), 38 (4+12+4 saten), 61 (5+12+5).`
    );
  }
  return n;
}

async function httpJson(url, { method = 'GET', body, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new EngineError(`Fallo de red al llamar al Engine: ${err.message}`, {});
  }
  clearTimeout(timer);

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && (data.error || data.message)) ||
      `Engine respondio ${res.status}`;
    throw new EngineError(msg, { status: res.status, body: data });
  }
  return data;
}

// [2026-06-24] Normaliza el color que diga el cliente al valor REAL del catálogo que el
// motor reconoce (quoteEngine COLOR_SFX: BLANCO/NOGAL/ROBLE DORADO/GRAFITO/NEW BLACK).
// Sin esto, "café"/"gris"/"negro" no matchean → el motor cae a Blanco (precio/visual erróneo).
// Catálogo real (foto del dueño): Blanco · Nogal · Roble Dorado · Grafito Antracita · Negro.
const COLOR_CATALOGO = {
  cafe: 'NOGAL', café: 'NOGAL', marron: 'NOGAL', marrón: 'NOGAL', nogal: 'NOGAL',
  'madera oscura': 'NOGAL', amaderado: 'NOGAL', madera: 'NOGAL',
  roble: 'ROBLE DORADO', 'roble dorado': 'ROBLE DORADO', dorado: 'ROBLE DORADO',
  'madera clara': 'ROBLE DORADO', 'roble claro': 'ROBLE DORADO',
  gris: 'GRAFITO', grafito: 'GRAFITO', antracita: 'GRAFITO', plomo: 'GRAFITO',
  'gris antracita': 'GRAFITO', 'grafito antracita': 'GRAFITO',
  negro: 'NEW BLACK', 'new black': 'NEW BLACK', black: 'NEW BLACK', 'grafito oscuro': 'NEW BLACK',
  blanco: 'BLANCO', white: 'BLANCO',
};
function normalizeColor(c) {
  if (c === undefined || c === null || c === '') return c;
  const k = String(c).trim().toLowerCase().replace(/\s+/g, ' ');
  return COLOR_CATALOGO[k] || c; // si no matchea, pasa tal cual (el motor cae a BL)
}

/**
 * Cotiza una ventana puntual.
 * @param {object} params
 * @param {string} params.tipo - Apertura (enum APERTURAS). NUNCA 'TERMOPANEL'.
 * @param {number} params.ancho_mm - Obligatorio.
 * @param {number} params.alto_mm - Obligatorio.
 * @param {number} params.glass_id - Obligatorio.
 * @param {string} [params.serie]
 * @param {string} [params.color]
 * @param {string} [params.comuna]
 * @param {number} [params.cantidad]
 * @returns {Promise<{ok:boolean,total?:number,...}>}
 */
export async function calcularCotizacion(params = {}) {
  const { tipo, ancho_mm, alto_mm, glass_id, serie, color, comuna, cantidad, hojas, partes } = params;
  const fueraDeAlcance = detectarProductoFueraDeAlcance('', { tipo, serie });
  if (fueraDeAlcance.fueraDeAlcance) {
    throw new EngineError(fueraDeAlcance.razon, { body: fueraDeAlcance });
  }
  const apertura = normalizarApertura(tipo);
  const gid = exigirGlassId(glass_id);

  if (ancho_mm === undefined || ancho_mm === null) {
    throw new EngineError('ancho_mm es obligatorio.');
  }
  if (alto_mm === undefined || alto_mm === null) {
    throw new EngineError('alto_mm es obligatorio.');
  }

  const payload = {
    tipo: apertura,
    ancho_mm: Number(ancho_mm),
    alto_mm: Number(alto_mm),
    glass_id: gid,
  };
  if (serie !== undefined) payload.serie = serie;
  if (hojas !== undefined) payload.hojas = Number(hojas);
  // [2026-08-25] Los paños de una COMPUESTA (si el cliente dio los anchos). Sin esto el
  // motor reparte el vano mitad fija + mitad proyectante (el default del dueño).
  if (Array.isArray(partes) && partes.length) payload.partes = partes;
  if (color !== undefined) payload.color = normalizeColor(color);
  if (comuna !== undefined) payload.comuna = comuna;
  if (cantidad !== undefined) payload.cantidad = Number(cantidad);

  return httpJson(`${BASE_URL()}/api/quotes/calculate`, { method: 'POST', body: payload });
}

/**
 * Cotiza por area.
 * @param {object} params
 * @param {string} params.tipo - Apertura (enum APERTURAS). NUNCA 'TERMOPANEL'.
 * @param {number} params.area_m2 - Obligatorio (campo 'area_m2', NO 'm2').
 * @param {number} params.glass_id - Obligatorio.
 * @param {string} [params.proporcion]
 * @param {string} [params.color]
 * @param {string} [params.comuna]
 */
export async function calcularPorArea(params = {}) {
  const { tipo, area_m2, glass_id, proporcion, color, comuna } = params;
  const fueraDeAlcance = detectarProductoFueraDeAlcance('', { tipo });
  if (fueraDeAlcance.fueraDeAlcance) {
    throw new EngineError(fueraDeAlcance.razon, { body: fueraDeAlcance });
  }
  const apertura = normalizarApertura(tipo);
  const gid = exigirGlassId(glass_id);

  if (area_m2 === undefined || area_m2 === null) {
    throw new EngineError("El campo 'area_m2' es obligatorio.");
  }

  const payload = {
    tipo: apertura,
    area_m2: Number(area_m2),
    glass_id: gid,
  };
  if (proporcion !== undefined) payload.proporcion = proporcion;
  if (color !== undefined) payload.color = normalizeColor(color);
  if (comuna !== undefined) payload.comuna = comuna;

  return httpJson(`${BASE_URL()}/api/quotes/calculate-by-area`, {
    method: 'POST',
    body: payload,
  });
}

/**
 * Lista vidrios por familia. Aqui 'tipo' SI es familia de vidrio.
 * @param {string} [tipoVidrio] - 'TERMOPANEL' | 'MONOLITICO' (opcional).
 * @returns {Promise<object>} glasses con id (=glass_id).
 */
export async function listarVidrios(tipoVidrio) {
  let qs = '';
  if (tipoVidrio !== undefined && tipoVidrio !== null && tipoVidrio !== '') {
    const fam = String(tipoVidrio).trim().toUpperCase();
    if (!FAMILIAS_VIDRIO.includes(fam)) {
      throw new EngineError(
        `Familia de vidrio desconocida: '${tipoVidrio}'. Valores validos: ${FAMILIAS_VIDRIO.join(', ')}.`
      );
    }
    qs = `?tipo=${encodeURIComponent(fam)}`;
  }
  return httpJson(`${BASE_URL()}/api/engine/glasses${qs}`, { method: 'GET' });
}

/**
 * Genera el link de aprobacion del cliente para una cotizacion.
 * @param {string|number} quoteId
 * @param {object} quotePayload - Output completo de calculate (va en el body).
 * @returns {Promise<object>}
 */
export async function generarLinkAprobacion(quoteId, quotePayload) {
  if (quoteId === undefined || quoteId === null || quoteId === '') {
    throw new EngineError('quoteId es obligatorio.');
  }
  if (!quotePayload || typeof quotePayload !== 'object') {
    throw new EngineError('quotePayload es obligatorio (output completo de calculate).');
  }
  const headers = {};
  if (process.env.ACTIVA_ENGINE_KEY) {
    headers.Authorization = `Bearer ${process.env.ACTIVA_ENGINE_KEY}`;
  }
  return httpJson(
    `${BASE_URL()}/api/quotes/${encodeURIComponent(quoteId)}/share`,
    { method: 'POST', body: { quote_payload: quotePayload }, headers }
  );
}

export { EngineError, BASE_URL };
