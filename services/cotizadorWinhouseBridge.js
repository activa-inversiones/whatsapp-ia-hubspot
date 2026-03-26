// services/cotizadorWinhouseBridge.js — v1.2.0
// ESM | Node 18+ (fetch nativo)
// ═══════════════════════════════════════════════════════════════════
// CAMBIOS vs 1.1.0:
//
// [F8] Variables canónicas COTIZADOR_BASE_URL / COTIZADOR_API_KEY
//      → backward compat: acepta COTIZADOR_WINHOUSE_URL / COTIZADOR_WINHOUSE_API_KEY
// [F9] Timeout reducido a 15 s (evita colgar conversaciones)
// [F10] requestId/correlationId en cada log para trazabilidad
// [F11] Mensajes de error explícitos para 401, 5xx/timeout y vars faltantes
// [F12] Nunca se loggea el valor completo de la API key
//
// CAMBIOS vs 1.0.0 — Auditoría gobernanza activalabs (CTRL-005):
//
// [F1] FIX CRÍTICO: API key auth — header X-API-Key en cada request
//      → antes cualquiera con la URL podía cotizar sin autenticación
// [F3] FIX: logging con timestamp ISO, método, path, status, duración ms
//      → antes los errores se perdían silenciosamente
// [F5] FIX: health check mejorado — retorna estructura normalizada
// [F6] MEJORA: retry simple (1 reintento con backoff) para /api/cotizar
// [F7] MEJORA: validación de URL en startup (formato básico)
//
// Riesgos resueltos: endpoint expuesto sin auth, errores silenciosos,
//                    cotización perdida por glitch de red
// ═══════════════════════════════════════════════════════════════════

/* =========================
   ENV — [F8] canónicas con fallback legacy
   ========================= */
const COTIZADOR_WINHOUSE_URL = (
  process.env.COTIZADOR_BASE_URL ||
  process.env.COTIZADOR_WINHOUSE_URL ||
  ""
).replace(/\/$/, "");
const COTIZADOR_WINHOUSE_API_KEY =
  process.env.COTIZADOR_API_KEY ||
  process.env.COTIZADOR_WINHOUSE_API_KEY ||
  ""; // [F1][F8]
// [F9] Timeout reducido a 15 s para no colgar conversaciones
const COTIZADOR_WINHOUSE_TIMEOUT_MS = Number(
  process.env.COTIZADOR_TIMEOUT_MS ||
  process.env.COTIZADOR_WINHOUSE_TIMEOUT_MS ||
  15000
);
const COTIZADOR_RETRY_DELAY_MS = 2000;
const COTIZADOR_MAX_RETRIES = 1;

/* =========================
   LOGGING — [F3][F10]
   ========================= */
// [F10] Genera un ID corto para correlacionar logs de una misma request
function makeRequestId() {
  return Math.random().toString(36).slice(2, 9);
}

function log(level, ctx, msg, meta = {}) {
  const ts = new Date().toISOString();
  const prefix = level === "error" ? "❌" : "ℹ️ ";
  const metaStr = Object.keys(meta).length ? ` | ${JSON.stringify(meta)}` : "";
  const fn = level === "error" ? console.error : console.log;
  fn(`[${ts}] ${prefix} [cotizadorBridge] ${ctx}: ${msg}${metaStr}`);
}

/* =========================
   HELPERS
   ========================= */
function enabled() {
  return !!COTIZADOR_WINHOUSE_URL;
}

// [F7] Validación básica de URL al importar
if (COTIZADOR_WINHOUSE_URL && !COTIZADOR_WINHOUSE_URL.startsWith("http")) {
  log("error", "init", `COTIZADOR_BASE_URL no parece una URL válida: "${COTIZADOR_WINHOUSE_URL}"`);
}

// [F8] Advertencia si falta URL
if (!COTIZADOR_WINHOUSE_URL) {
  log("error", "init", "COTIZADOR_BASE_URL no configurada — cotizador deshabilitado");
}

// [F1][F12] Advertencia si no hay API key (nunca loggear el valor)
if (COTIZADOR_WINHOUSE_URL && !COTIZADOR_WINHOUSE_API_KEY) {
  log("error", "init", "⚠️  COTIZADOR_API_KEY no configurada — requests sin autenticación (esperarán 401)");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* =========================
   REQUEST — con auth + logging + timing [F1][F3][F10][F11][F12]
   ========================= */
async function request(path, { method = "GET", body, timeoutMs, requestId } = {}) {
  if (!enabled()) {
    log("error", "request", "Cotizador no configurado — falta COTIZADOR_BASE_URL o COTIZADOR_API_KEY");
    return { ok: false, skipped: true, reason: "missing COTIZADOR_BASE_URL" };
  }

  const reqId = requestId || makeRequestId(); // [F10]
  const timeout = timeoutMs || COTIZADOR_WINHOUSE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const startMs = Date.now();
  const url = `${COTIZADOR_WINHOUSE_URL}${path}`;

  try {
    // [F1][F12] Headers con autenticación — nunca loggear el valor de la key
    const headers = { "Content-Type": "application/json" };
    if (COTIZADOR_WINHOUSE_API_KEY) {
      headers["X-API-Key"] = COTIZADOR_WINHOUSE_API_KEY;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    const durationMs = Date.now() - startMs;

    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}

    // [F3][F10][F11] Logging estructurado con requestId y mensajes explícitos
    if (res.ok) {
      log("info", "request", `${method} ${path} → ${res.status}`, { reqId, durationMs });
    } else if (res.status === 401) {
      log("error", "request", `${method} ${path} → 401 API key inválida o faltante`, {
        reqId,
        durationMs,
        hint: "Verifica COTIZADOR_API_KEY en Railway",
      });
    } else if (res.status >= 500) {
      log("error", "request", `${method} ${path} → ${res.status} error en el servidor del cotizador`, {
        reqId,
        durationMs,
        body: text.slice(0, 300),
      });
    } else {
      log("error", "request", `${method} ${path} → ${res.status}`, {
        reqId,
        durationMs,
        body: text.slice(0, 300),
      });
    }

    return { ok: res.ok, status: res.status, text, json, reqId };
  } catch (error) {
    const durationMs = Date.now() - startMs;
    const isTimeout = error?.name === "AbortError";
    const errorMsg = isTimeout
      ? `Timeout (${timeout}ms) — cotizador no respondió a tiempo`
      : (error?.message || String(error));

    log("error", "request", `${method} ${path} → FAIL`, {
      reqId,
      durationMs,
      error: errorMsg,
      isTimeout,
    });

    return { ok: false, error: errorMsg, isTimeout, reqId };
  } finally {
    clearTimeout(timer);
  }
}

/* =========================
   REQUEST CON RETRY — [F6] para cotizaciones
   ========================= */
async function requestWithRetry(path, options = {}) {
  let lastResult;
  const requestId = makeRequestId(); // [F10] mismo ID en todos los intentos

  for (let attempt = 0; attempt <= COTIZADOR_MAX_RETRIES; attempt++) {
    lastResult = await request(path, { ...options, requestId });

    // Éxito → retornar inmediato
    if (lastResult.ok) return lastResult;

    // Skipped (no configurado) → no reintentar
    if (lastResult.skipped) return lastResult;

    // Error 4xx (bad request / 401) → no reintentar, es error nuestro
    if (lastResult.status && lastResult.status >= 400 && lastResult.status < 500) {
      log("info", "retry", `No reintento — error ${lastResult.status} es del cliente`, { path, requestId });
      return lastResult;
    }

    // Si quedan reintentos → esperar y reintentar
    if (attempt < COTIZADOR_MAX_RETRIES) {
      const delay = COTIZADOR_RETRY_DELAY_MS * (attempt + 1);
      log("info", "retry", `Reintentando ${path} en ${delay}ms (intento ${attempt + 2}/${COTIZADOR_MAX_RETRIES + 1})`, {
        requestId,
        lastStatus: lastResult.status || "network_error",
      });
      await sleep(delay);
    }
  }

  return lastResult;
}

/* =========================
   EXPORTS
   ========================= */

/**
 * ¿Está configurado el cotizador?
 */
export function cotizadorWinhouseConfigured() {
  return enabled();
}

/**
 * Health check del cotizador — [F5] estructura normalizada
 * Úsese en startup: const h = await cotizadorWinhouseHealth();
 * Retorna: { ok, status, latencyMs, error? }
 */
export async function cotizadorWinhouseHealth() {
  if (!enabled()) {
    return { ok: false, configured: false, reason: "COTIZADOR_WINHOUSE_URL not set" };
  }

  const start = Date.now();
  const res = await request("/api/health", { method: "GET", timeoutMs: 8000 });
  const latencyMs = Date.now() - start;

  return {
    ok: res.ok,
    configured: true,
    status: res.status || null,
    latencyMs,
    error: res.error || null,
    detail: res.json || null,
  };
}

/**
 * Cotizar ventanas/puertas — con retry automático
 * @param {Object} payload - { items: [...], cliente: { nombre, telefono } }
 */
export async function cotizarWinhouse(payload) {
  return requestWithRetry("/api/cotizar", {
    method: "POST",
    body: payload,
  });
}
