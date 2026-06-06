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

const BASE_URL = () =>
  (process.env.ACTIVA_ENGINE_URL || 'https://ops.activalabs.ai').trim().replace(/\/+$/, ''); // .trim(): robusto a espacios/tabs en la var de Railway

const DEFAULT_TIMEOUT_MS = 15000;

// Aperturas validas para el campo 'tipo' de /calculate y /calculate-by-area.
// TERMOPANEL NO esta aqui a proposito: es un vidrio, no una apertura.
export const APERTURAS = Object.freeze([
  'CORREDERA',
  'PROYECTANTE',
  'FIJA',
  'BATIENTE',
  'OSCILOBATIENTE',
]);

// Familias de vidrio validas para listarVidrios.
export const FAMILIAS_VIDRIO = Object.freeze(['TERMOPANEL', 'MONOLITICO']);

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
  const { tipo, ancho_mm, alto_mm, glass_id, serie, color, comuna, cantidad } = params;
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
  if (color !== undefined) payload.color = color;
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
  if (color !== undefined) payload.color = color;
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
