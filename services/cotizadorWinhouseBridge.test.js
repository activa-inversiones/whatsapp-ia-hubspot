// services/cotizadorWinhouseBridge.test.js
// Tests unitarios del cliente cotizador-winhouse
// Ejecutar: node --test services/cotizadorWinhouseBridge.test.js
// ─────────────────────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Simula una respuesta de fetch.
 * @param {number} status
 * @param {object|null} body
 * @returns {object} fake Response
 */
function makeFetchResponse(status, body = null) {
  const text = body !== null ? JSON.stringify(body) : "";
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  };
}

/**
 * Carga el módulo con un entorno simulado y un fetch stub.
 * Usa un sub-proceso de evaluación para aislar las vars de entorno.
 */
async function loadBridgeWithEnv({ baseUrl, apiKey, fetchStub }) {
  // Parchamos globalThis.fetch antes de importar para que el módulo lo use
  globalThis.fetch = fetchStub;

  // Ajustamos process.env temporalmente
  const prev = {
    COTIZADOR_BASE_URL: process.env.COTIZADOR_BASE_URL,
    COTIZADOR_API_KEY: process.env.COTIZADOR_API_KEY,
    COTIZADOR_WINHOUSE_URL: process.env.COTIZADOR_WINHOUSE_URL,
    COTIZADOR_WINHOUSE_API_KEY: process.env.COTIZADOR_WINHOUSE_API_KEY,
    COTIZADOR_TIMEOUT_MS: process.env.COTIZADOR_TIMEOUT_MS,
  };

  if (baseUrl !== undefined) process.env.COTIZADOR_BASE_URL = baseUrl;
  else delete process.env.COTIZADOR_BASE_URL;

  if (apiKey !== undefined) process.env.COTIZADOR_API_KEY = apiKey;
  else delete process.env.COTIZADOR_API_KEY;

  // Limpiar legacy para no interferir
  delete process.env.COTIZADOR_WINHOUSE_URL;
  delete process.env.COTIZADOR_WINHOUSE_API_KEY;
  process.env.COTIZADOR_TIMEOUT_MS = "5000";

  // Restaurar después de cada test
  return { prev };
}

function restoreEnv(prev) {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete globalThis.fetch;
}

// ─── tests ───────────────────────────────────────────────────────────────────

test("cotizarWinhouse — envía X-API-Key y Content-Type correctos", async () => {
  let capturedRequest = null;

  const fakeApiKey = "test_key_abc123";
  const fakeResponse = makeFetchResponse(200, {
    id: "abc",
    resumen: { subtotal_neto: 100000, iva: 19000, total_con_iva: 119000 },
  });

  const fetchStub = async (url, options) => {
    capturedRequest = { url, options };
    return fakeResponse;
  };

  const { prev } = await loadBridgeWithEnv({
    baseUrl: "https://example.cotizador.test",
    apiKey: fakeApiKey,
    fetchStub,
  });

  try {
    // Re-import con cache bust para forzar re-evaluación de env
    const mod = await import(
      `./cotizadorWinhouseBridge.js?t=${Date.now()}`
    );
    await mod.cotizarWinhouse({ items: [{ serie: "S60" }] });

    assert.ok(capturedRequest, "fetch debe haberse llamado");
    assert.equal(
      capturedRequest.options.headers["X-API-Key"],
      fakeApiKey,
      "debe enviar X-API-Key con el valor de COTIZADOR_API_KEY"
    );
    assert.equal(
      capturedRequest.options.headers["Content-Type"],
      "application/json",
      "debe enviar Content-Type: application/json"
    );
    assert.equal(
      capturedRequest.options.method,
      "POST",
      "debe usar método POST"
    );
    assert.ok(
      capturedRequest.url.endsWith("/api/cotizar"),
      "debe llamar a /api/cotizar"
    );
    assert.ok(
      capturedRequest.url.startsWith("https://example.cotizador.test/"),
      "debe usar COTIZADOR_BASE_URL"
    );
  } finally {
    restoreEnv(prev);
  }
});

test("cotizarWinhouse — skipped cuando falta COTIZADOR_BASE_URL", async () => {
  const fetchStub = async () => {
    throw new Error("fetch no debe llamarse");
  };

  const { prev } = await loadBridgeWithEnv({
    baseUrl: undefined,
    apiKey: undefined,
    fetchStub,
  });

  try {
    const mod = await import(
      `./cotizadorWinhouseBridge.js?t=${Date.now()}`
    );
    const result = await mod.cotizarWinhouse({ items: [] });

    assert.equal(result.ok, false, "debe retornar ok: false");
    assert.equal(result.skipped, true, "debe retornar skipped: true");
  } finally {
    restoreEnv(prev);
  }
});

test("cotizadorWinhouseConfigured — true cuando COTIZADOR_BASE_URL está presente", async () => {
  const fetchStub = async () => makeFetchResponse(200, { status: "ok" });
  const { prev } = await loadBridgeWithEnv({
    baseUrl: "https://example.cotizador.test",
    apiKey: "some_key",
    fetchStub,
  });

  try {
    const mod = await import(
      `./cotizadorWinhouseBridge.js?t=${Date.now()}`
    );
    assert.equal(
      mod.cotizadorWinhouseConfigured(),
      true,
      "debe reportarse como configurado"
    );
  } finally {
    restoreEnv(prev);
  }
});

test("cotizadorWinhouseConfigured — false cuando falta COTIZADOR_BASE_URL", async () => {
  const fetchStub = async () => {
    throw new Error("no debería llamarse");
  };
  const { prev } = await loadBridgeWithEnv({
    baseUrl: undefined,
    apiKey: undefined,
    fetchStub,
  });

  try {
    const mod = await import(
      `./cotizadorWinhouseBridge.js?t=${Date.now()}`
    );
    assert.equal(
      mod.cotizadorWinhouseConfigured(),
      false,
      "debe reportarse como no configurado"
    );
  } finally {
    restoreEnv(prev);
  }
});

test("cotizarWinhouse — no loggea el valor de COTIZADOR_API_KEY", async () => {
  const secretKey = "super_secret_key_never_log";
  const loggedMessages = [];
  const origLog = console.log;
  const origError = console.error;

  try {
    console.log = (...args) => loggedMessages.push(args.join(" "));
    console.error = (...args) => loggedMessages.push(args.join(" "));

    const fakeResponse = makeFetchResponse(401, { error: "API key inválida o faltante" });
    const fetchStub = async () => fakeResponse;

    const { prev } = await loadBridgeWithEnv({
      baseUrl: "https://example.cotizador.test",
      apiKey: secretKey,
      fetchStub,
    });

    try {
      const mod = await import(
        `./cotizadorWinhouseBridge.js?t=${Date.now()}`
      );
      await mod.cotizarWinhouse({ items: [] });

      const allLogs = loggedMessages.join("\n");
      assert.ok(
        !allLogs.includes(secretKey),
        "el valor de COTIZADOR_API_KEY no debe aparecer en los logs"
      );
    } finally {
      restoreEnv(prev);
    }
  } finally {
    console.log = origLog;
    console.error = origError;
  }
});

test("fallback: acepta COTIZADOR_WINHOUSE_URL y COTIZADOR_WINHOUSE_API_KEY legacy", async () => {
  let capturedHeaders = null;
  const legacyKey = "legacy_key_xyz";
  const fetchStub = async (url, options) => {
    capturedHeaders = options.headers;
    return makeFetchResponse(200, { resumen: { subtotal_neto: 50000 } });
  };

  const prevEnv = {
    COTIZADOR_BASE_URL: process.env.COTIZADOR_BASE_URL,
    COTIZADOR_API_KEY: process.env.COTIZADOR_API_KEY,
    COTIZADOR_WINHOUSE_URL: process.env.COTIZADOR_WINHOUSE_URL,
    COTIZADOR_WINHOUSE_API_KEY: process.env.COTIZADOR_WINHOUSE_API_KEY,
    COTIZADOR_TIMEOUT_MS: process.env.COTIZADOR_TIMEOUT_MS,
  };

  delete process.env.COTIZADOR_BASE_URL;
  delete process.env.COTIZADOR_API_KEY;
  process.env.COTIZADOR_WINHOUSE_URL = "https://legacy.cotizador.test";
  process.env.COTIZADOR_WINHOUSE_API_KEY = legacyKey;
  process.env.COTIZADOR_TIMEOUT_MS = "5000";
  globalThis.fetch = fetchStub;

  try {
    const mod = await import(
      `./cotizadorWinhouseBridge.js?t=${Date.now()}`
    );
    await mod.cotizarWinhouse({ items: [{ serie: "S60" }] });

    assert.ok(capturedHeaders, "fetch debe haberse llamado");
    assert.equal(
      capturedHeaders["X-API-Key"],
      legacyKey,
      "debe usar COTIZADOR_WINHOUSE_API_KEY como fallback"
    );
  } finally {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete globalThis.fetch;
  }
});
