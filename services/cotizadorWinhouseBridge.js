// services/cotizadorWinhouseBridge.js
const COTIZADOR_WINHOUSE_URL = (process.env.COTIZADOR_WINHOUSE_URL || "").replace(/\/$/, "");
const COTIZADOR_WINHOUSE_TIMEOUT_MS = Number(process.env.COTIZADOR_WINHOUSE_TIMEOUT_MS || 30000);

function enabled() {
  return !!COTIZADOR_WINHOUSE_URL;
}

async function request(path, { method = "GET", body } = {}) {
  if (!enabled()) return { ok: false, skipped: true, reason: "missing COTIZADOR_WINHOUSE_URL" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COTIZADOR_WINHOUSE_TIMEOUT_MS);

  try {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(`${COTIZADOR_WINHOUSE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}

    return { ok: res.ok, status: res.status, text, json };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export function cotizadorWinhouseConfigured() {
  return enabled();
}

export async function cotizadorWinhouseHealth() {
  return request("/api/health", { method: "GET" });
}

export async function cotizarWinhouse(payload) {
  return request("/api/cotizar", {
    method: "POST",
    body: payload,
  });
}
