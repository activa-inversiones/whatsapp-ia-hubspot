// services/cotizadorWinhouseBridge.js — v1.1.0
// ESM | Node 18+ (fetch nativo)
// ═══════════════════════════════════════════════════════════════════
// CAMBIOS vs 1.0.0 — Auditoría gobernanza activalabs (CTRL-005):
//
// [F1] FIX CRÍTICO: API key auth — header X-API-Key en cada request
//      → antes cualquiera con la URL podía cotizar sin autenticación
//      → env var: COTIZADOR_WINHOUSE_API_KEY
// [F3] FIX: logging con timestamp ISO, método, path, status, duración ms
//      → antes los errores se perdían silenciosamente
// [F5] FIX: health check mejorado — retorna estructura normalizada
//      → listo para llamar desde startup del index.js
// [F6] MEJORA: retry simple (1 reintento con backoff) para /api/cotizar
//      → un glitch de red ya no pierde la cotización del cliente
// [F7] MEJORA: validación de URL en startup (formato básico)
//
// Riesgos resueltos: endpoint expuesto sin auth, errores silenciosos,
//                    cotización perdida por glitch de red
// ═══════════════════════════════════════════════════════════════════

/* =========================
   ENV
   ========================= */
const COTIZADOR_WINHOUSE_URL = (process.env.COTIZADOR_WINHOUSE_URL || "").replace(/\/$/, "");
const COTIZADOR_WINHOUSE_API_KEY = process.env.COTIZADOR_WINHOUSE_API_KEY || ""; // [F1]
const COTIZADOR_WINHOUSE_TIMEOUT_MS = Number(process.env.COTIZADOR_WINHOUSE_TIMEOUT_MS || 30000);
const COTIZADOR_RETRY_DELAY_MS = 2000;
const COTIZADOR_MAX_RETRIES = 1;

/* =========================
   LOGGING — [F3]
   ========================= */
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
  log("error", "init", `COTIZADOR_WINHOUSE_URL no parece una URL válida: "${COTIZADOR_WINHOUSE_URL}"`);
}

// [F1] Advertencia si no hay API key configurada
if (COTIZADOR_WINHOUSE_URL && !COTIZADOR_WINHOUSE_API_KEY) {
  log("error", "init", "⚠️  COTIZADOR_WINHOUSE_API_KEY no configurada — requests sin autenticación");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* =========================
   REQUEST — con auth + logging + timing
   ========================= */
async function request(path, { method = "GET", body, timeoutMs } = {}) {
  if (!enabled()) {
    return { ok: false, skipped: true, reason: "missing COTIZADOR_WINHOUSE_URL" };
  }

  const timeout = timeoutMs || COTIZADOR_WINHOUSE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const startMs = Date.now();
  const url = `${COTIZADOR_WINHOUSE_URL}${path}`;

  try {
    // [F1] Headers con autenticación
    const headers = {};
    if (COTIZADOR_WINHOUSE_API_KEY) {
      headers["X-API-Key"] = COTIZADOR_WINHOUSE_API_KEY;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
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

    // [F3] Logging
    if (res.ok) {
      log("info", "request", `${method} ${path} → ${res.status}`, { durationMs });
    } else {
      log("error", "request", `${method} ${path} → ${res.status}`, {
        durationMs,
        body: text.slice(0, 300),
      });
    }

    return { ok: res.ok, status: res.status, text, json };
  } catch (error) {
    const durationMs = Date.now() - startMs;
    const isTimeout = error?.name === "AbortError";
    const errorMsg = isTimeout ? `Timeout (${timeout}ms)` : (error?.message || String(error));

    log("error", "request", `${method} ${path} → FAIL`, {
      durationMs,
      error: errorMsg,
      isTimeout,
    });

    return { ok: false, error: errorMsg, isTimeout };
  } finally {
    clearTimeout(timer);
  }
}

/* =========================
   REQUEST CON RETRY — [F6] para cotizaciones
   ========================= */
async function requestWithRetry(path, options = {}) {
  let lastResult;

  for (let attempt = 0; attempt <= COTIZADOR_MAX_RETRIES; attempt++) {
    lastResult = await request(path, options);

    // Éxito → retornar inmediato
    if (lastResult.ok) return lastResult;

    // Skipped (no configurado) → no reintentar
    if (lastResult.skipped) return lastResult;

    // Error 4xx (bad request) → no reintentar, es error nuestro
    if (lastResult.status && lastResult.status >= 400 && lastResult.status < 500) {
      log("info", "retry", `No reintento — error ${lastResult.status} es del cliente`, { path });
      return lastResult;
    }

    // Si quedan reintentos → esperar y reintentar
    if (attempt < COTIZADOR_MAX_RETRIES) {
      const delay = COTIZADOR_RETRY_DELAY_MS * (attempt + 1);
      log("info", "retry", `Reintentando ${path} en ${delay}ms (intento ${attempt + 2}/${COTIZADOR_MAX_RETRIES + 1})`, {
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
