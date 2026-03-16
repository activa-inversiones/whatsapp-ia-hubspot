// services/salesOsBridge.js — v1.1.0
// ESM | Node 18+ (fetch nativo)
// ═══════════════════════════════════════════════════════════════════
// CAMBIOS vs 1.0.0 — Auditoría gobernanza activalabs (CTRL-005):
//
// [F2] FIX CRÍTICO: getConversationControl timeout reducido 10s → 3s
//      → antes cada mensaje del bot esperaba hasta 10s si Sales-OS lento
//      → ahora falla rápido y el bot sigue respondiendo
// [F3] FIX: logging con timestamp ISO, método, path, status, duración ms
//      → antes los errores se perdían silenciosamente
// [F4] FIX: env vars separadas sin fallback cruzado
//      → SALES_OS_INGEST_TOKEN solo para ingest
//      → SALES_OS_OPERATOR_TOKEN solo para operator
//      → eliminados fallbacks que podían mezclar permisos
// [F6] MEJORA: circuit breaker simple para Sales-OS
//      → si falla 3 veces seguidas, skip 60s — no bloquea al bot
// [F7] MEJORA: retry para push events (1 reintento, solo 5xx/network)
//      → un glitch de red no pierde el lead o el evento
//
// Riesgos resueltos: bot bloqueado por Sales-OS lento, tokens cruzados,
//                    eventos perdidos por glitch de red, errores silenciosos
// ═══════════════════════════════════════════════════════════════════

/* =========================
   ENV — [F4] tokens separados sin fallback cruzado
   ========================= */
const SALES_OS_URL = (process.env.SALES_OS_URL || "").replace(/\/$/, "");
const SALES_OS_INGEST_TOKEN = process.env.SALES_OS_INGEST_TOKEN || "";
const SALES_OS_OPERATOR_TOKEN = process.env.SALES_OS_OPERATOR_TOKEN || "";

// Timeouts diferenciados por criticidad
const TIMEOUT_INGEST_MS = Number(process.env.SALES_OS_INGEST_TIMEOUT_MS || 10000);
const TIMEOUT_CONTROL_MS = Number(process.env.SALES_OS_CONTROL_TIMEOUT_MS || 3000); // [F2]
const RETRY_DELAY_MS = 1500;
const MAX_RETRIES = 1;

/* =========================
   LOGGING — [F3]
   ========================= */
function log(level, ctx, msg, meta = {}) {
  const ts = new Date().toISOString();
  const prefix = level === "error" ? "❌" : "ℹ️ ";
  const metaStr = Object.keys(meta).length ? ` | ${JSON.stringify(meta)}` : "";
  const fn = level === "error" ? console.error : console.log;
  fn(`[${ts}] ${prefix} [salesOsBridge] ${ctx}: ${msg}${metaStr}`);
}

/* =========================
   CIRCUIT BREAKER — [F6]
   Si Sales-OS falla 3 veces seguidas → skip por 60s
   El bot no se bloquea esperando un servicio caído
   ========================= */
const CB_THRESHOLD = 3;
const CB_COOLDOWN_MS = 60_000;

const circuitBreaker = {
  failures: 0,
  openUntil: 0,

  recordSuccess() {
    this.failures = 0;
    this.openUntil = 0;
  },

  recordFailure() {
    this.failures++;
    if (this.failures >= CB_THRESHOLD) {
      this.openUntil = Date.now() + CB_COOLDOWN_MS;
      log("error", "circuitBreaker", `ABIERTO — ${CB_THRESHOLD} fallos seguidos, skip por ${CB_COOLDOWN_MS / 1000}s`);
    }
  },

  isOpen() {
    if (Date.now() >= this.openUntil) {
      // Cooldown pasó → half-open, permitir un intento
      if (this.failures >= CB_THRESHOLD) {
        log("info", "circuitBreaker", "Half-open — permitiendo un intento");
        this.failures = CB_THRESHOLD - 1; // un fallo más lo abre de nuevo
      }
      return false;
    }
    return true;
  },
};

/* =========================
   HELPERS
   ========================= */
function ingestEnabled() {
  return !!(SALES_OS_URL && SALES_OS_INGEST_TOKEN);
}

function operatorEnabled() {
  return !!(SALES_OS_URL && SALES_OS_OPERATOR_TOKEN);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [F4] Validaciones al importar
if (SALES_OS_URL && !SALES_OS_URL.startsWith("http")) {
  log("error", "init", `SALES_OS_URL no parece válida: "${SALES_OS_URL}"`);
}
if (SALES_OS_URL && !SALES_OS_INGEST_TOKEN) {
  log("error", "init", "⚠️  SALES_OS_INGEST_TOKEN no configurada — ingest deshabilitado");
}
if (SALES_OS_URL && !SALES_OS_OPERATOR_TOKEN) {
  log("error", "init", "⚠️  SALES_OS_OPERATOR_TOKEN no configurada — conversation control deshabilitado");
}

/* =========================
   REQUEST — con auth + logging + timing
   ========================= */
async function request(path, { method = "POST", body, token, timeoutMs = TIMEOUT_INGEST_MS } = {}) {
  if (!SALES_OS_URL) {
    return { ok: false, skipped: true, reason: "missing SALES_OS_URL" };
  }

  // [F6] Circuit breaker — skip si está abierto (excepto control que tiene su propio manejo)
  if (circuitBreaker.isOpen() && !path.includes("conversation-control")) {
    log("info", "request", `SKIP ${method} ${path} — circuit breaker abierto`);
    return { ok: false, skipped: true, reason: "circuit_breaker_open" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startMs = Date.now();
  const url = `${SALES_OS_URL}${path}`;

  try {
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

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
      circuitBreaker.recordSuccess();
    } else {
      log("error", "request", `${method} ${path} → ${res.status}`, {
        durationMs,
        body: text.slice(0, 300),
      });
      if (res.status >= 500) circuitBreaker.recordFailure();
    }

    return { ok: res.ok, status: res.status, text, json };
  } catch (error) {
    const durationMs = Date.now() - startMs;
    const isTimeout = error?.name === "AbortError";
    const errorMsg = isTimeout ? `Timeout (${timeoutMs}ms)` : (error?.message || String(error));

    log("error", "request", `${method} ${path} → FAIL`, {
      durationMs,
      error: errorMsg,
      isTimeout,
    });

    circuitBreaker.recordFailure();
    return { ok: false, error: errorMsg, isTimeout };
  } finally {
    clearTimeout(timer);
  }
}

/* =========================
   REQUEST CON RETRY — [F7] para push events
   ========================= */
async function requestWithRetry(path, options = {}) {
  let lastResult;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    lastResult = await request(path, options);

    // Éxito o skip → retornar
    if (lastResult.ok || lastResult.skipped) return lastResult;

    // Error 4xx → no reintentar (error nuestro)
    if (lastResult.status && lastResult.status >= 400 && lastResult.status < 500) {
      log("info", "retry", `No reintento — error ${lastResult.status} es del cliente`, { path });
      return lastResult;
    }

    // Si quedan reintentos → esperar
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * (attempt + 1);
      log("info", "retry", `Reintentando ${path} en ${delay}ms (intento ${attempt + 2}/${MAX_RETRIES + 1})`, {
        lastStatus: lastResult.status || "network_error",
      });
      await sleep(delay);
    }
  }

  return lastResult;
}

/* =========================
   EXPORTS — INGEST (con retry)
   ========================= */

/**
 * Push conversation event (mensaje entrante/saliente)
 */
export async function pushConversationEvent(payload) {
  if (!ingestEnabled()) return { ok: false, skipped: true };
  return requestWithRetry("/api/ingest/conversation-event", {
    method: "POST",
    body: payload,
    token: SALES_OS_INGEST_TOKEN,
    timeoutMs: TIMEOUT_INGEST_MS,
  });
}

/**
 * Push lead event (nuevo lead o actualización)
 */
export async function pushLeadEvent(payload) {
  if (!ingestEnabled()) return { ok: false, skipped: true };
  return requestWithRetry("/api/ingest/lead", {
    method: "POST",
    body: payload,
    token: SALES_OS_INGEST_TOKEN,
    timeoutMs: TIMEOUT_INGEST_MS,
  });
}

/**
 * Push quote event (cotización creada/enviada)
 */
export async function pushQuoteEvent(payload) {
  if (!ingestEnabled()) return { ok: false, skipped: true };
  return requestWithRetry("/api/ingest/quote-event", {
    method: "POST",
    body: payload,
    token: SALES_OS_INGEST_TOKEN,
    timeoutMs: TIMEOUT_INGEST_MS,
  });
}

/* =========================
   EXPORTS — OPERATOR (sin retry, timeout agresivo)
   ========================= */

/**
 * Consulta si la IA debe pausarse para un contacto
 * [F2] Timeout 3s — NO puede bloquear el bot
 * Si falla → retorna default seguro (ai sigue respondiendo)
 */
export async function getConversationControl(externalId) {
  // Sin config o sin ID → default seguro
  if (!operatorEnabled() || !externalId) {
    return { ai_paused: false, operator_status: "ai" };
  }

  const res = await request(
    `/internal/conversation-control/${encodeURIComponent(externalId)}`,
    {
      method: "GET",
      token: SALES_OS_OPERATOR_TOKEN,
      timeoutMs: TIMEOUT_CONTROL_MS, // [F2] 3s máximo
    }
  );

  // Cualquier error → default seguro (bot sigue)
  if (!res.ok) {
    return { ai_paused: false, operator_status: "ai" };
  }

  return res.json?.control || { ai_paused: false, operator_status: "ai" };
}

/**
 * ¿Está configurado Sales-OS?
 */
export function salesOsConfigured() {
  return ingestEnabled();
}
