// services/salesOsBridge.js
// ESM

const SALES_OS_URL = (process.env.SALES_OS_URL || "").replace(/\/$/, "");
const SALES_OS_INGEST_TOKEN = process.env.SALES_OS_INGEST_TOKEN || process.env.INGEST_TOKEN || "";
const SALES_OS_OPERATOR_TOKEN = process.env.SALES_OS_OPERATOR_TOKEN || process.env.OPERATOR_API_TOKEN || "";

function enabled() {
  return !!(SALES_OS_URL && SALES_OS_INGEST_TOKEN);
}

async function request(path, { method = "POST", body, token, timeoutMs = 10000 } = {}) {
  if (!SALES_OS_URL) return { ok: false, skipped: true, reason: "missing SALES_OS_URL" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(`${SALES_OS_URL}${path}`, {
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

export async function pushConversationEvent(payload) {
  if (!enabled()) return { ok: false, skipped: true };
  return request("/api/ingest/conversation-event", {
    method: "POST",
    body: payload,
    token: SALES_OS_INGEST_TOKEN,
  });
}

export async function pushLeadEvent(payload) {
  if (!enabled()) return { ok: false, skipped: true };
  return request("/api/ingest/lead", {
    method: "POST",
    body: payload,
    token: SALES_OS_INGEST_TOKEN,
  });
}

export async function pushQuoteEvent(payload) {
  if (!enabled()) return { ok: false, skipped: true };
  return request("/api/ingest/quote-event", {
    method: "POST",
    body: payload,
    token: SALES_OS_INGEST_TOKEN,
  });
}

export async function getConversationControl(externalId) {
  if (!SALES_OS_URL || !SALES_OS_OPERATOR_TOKEN || !externalId) {
    return { ai_paused: false, operator_status: "ai" };
  }

  const res = await request(`/internal/conversation-control/${encodeURIComponent(externalId)}`, {
    method: "GET",
    token: SALES_OS_OPERATOR_TOKEN,
  });

  if (!res.ok) return { ai_paused: false, operator_status: "ai" };
  return res.json?.control || { ai_paused: false, operator_status: "ai" };
}

export function salesOsConfigured() {
  return enabled();
}
