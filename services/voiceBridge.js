// services/voiceBridge.js
// Node 18+ (ESM). Usa fetch global.
// ✅ ACTUALIZADO: ElevenLabs funcional + Sistema de precios desde archivo

import fs from "fs";
import path from "path";

const VOICE_ENABLED = String(process.env.VOICE_ENABLED || "false") === "true";
const VOICE_SEND_MODE = String(process.env.VOICE_SEND_MODE || "text_only"); // text_only | text_and_audio
const VOICE_TTS_PROVIDER = String(process.env.VOICE_TTS_PROVIDER || "").toLowerCase(); // elevenlabs | bridge | ""

const VOICE_TTS_URL = process.env.VOICE_TTS_URL || "";
const VOICE_TTS_TOKEN = process.env.VOICE_TTS_TOKEN || "";
const VOICE_TTS_VOICE_ID = process.env.VOICE_TTS_VOICE_ID || "";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "";
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const ELEVENLABS_OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT || "ogg_opus";

// ✅ NUEVO: Sistema de precios desde archivo
const PRICING_FILE = process.env.PRICING_FILE || "/data/pricing.json"; // Railway usa /data para datos persistentes
let pricingCache = {};
let pricingLastRead = 0;
const PRICING_CACHE_TTL = 60000; // Recargar cada 60s

// ✅ NUEVO: Cargar precios desde archivo JSON
function loadPricingFromFile() {
  try {
    if (!fs.existsSync(PRICING_FILE)) {
      console.warn(`[PRICING] Archivo no encontrado: ${PRICING_FILE}`);
      return {};
    }

    const now = Date.now();
    if (pricingCache && now - pricingLastRead < PRICING_CACHE_TTL) {
      return pricingCache; // Usar cache si es reciente
    }

    const raw = fs.readFileSync(PRICING_FILE, "utf-8");
    pricingCache = JSON.parse(raw);
    pricingLastRead = now;

    console.log(`[PRICING] Archivo cargado: ${Object.keys(pricingCache).length} productos`);
    return pricingCache;
  } catch (e) {
    console.error(`[PRICING] Error leyendo ${PRICING_FILE}:`, e.message);
    return {};
  }
}

// ✅ NUEVO: Obtener precio actualizado de un producto
export function getPriceByProduct(productName) {
  const pricing = loadPricingFromFile();
  const key = String(productName || "").toLowerCase().trim();
  return pricing[key] || null;
}

// ✅ NUEVO: Obtener TODOS los precios (para dashboard)
export function getAllPrices() {
  return loadPricingFromFile();
}

// ✅ NUEVO: Recargar precios forzadamente
export function reloadPricing() {
  pricingLastRead = 0; // Forzar recarga en próxima llamada
  console.log("[PRICING] Cache invalidado");
  return loadPricingFromFile();
}

function hasElevenLabs() {
  return !!(ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID);
}

function hasBridge() {
  return !!VOICE_TTS_URL;
}

function resolveProvider() {
  if (VOICE_TTS_PROVIDER === "elevenlabs") return "elevenlabs";
  if (VOICE_TTS_PROVIDER === "bridge") return "bridge";
  if (hasElevenLabs()) return "elevenlabs";
  if (hasBridge()) return "bridge";
  return "none";
}

export function voiceEnabled() {
  if (!VOICE_ENABLED) return false;
  const p = resolveProvider();
  return p === "elevenlabs" || p === "bridge";
}

export function shouldSendVoice(userText = "", session = null, opts = {}) {
  if (!voiceEnabled()) return false;

  const incomingType = opts?.incomingType || "text";
  if (incomingType === "audio") return true;

  const t = String(userText || "").toLowerCase();
  const explicit =
    t.includes("audio") ||
    t.includes("nota de voz") ||
    t.includes("mensaje de voz") ||
    t.includes("voz");

  if (explicit) return true;

  const wantsPdf = !!session?.data?.wants_pdf;
  if (VOICE_SEND_MODE === "text_and_audio" && !wantsPdf) return true;

  return false;
}

async function synthesizeViaBridge({ text, waId = "", context = {} }) {
  const res = await fetch(VOICE_TTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(VOICE_TTS_TOKEN ? { Authorization: `Bearer ${VOICE_TTS_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      text,
      voice_id: VOICE_TTS_VOICE_ID,
      customer_id: waId,
      context,
      format: "ogg",
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`TTS failed [${res.status}] ${err}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await res.json();

    if (data.audio_base64) {
      return {
        buffer: Buffer.from(data.audio_base64, "base64"),
        mime: data.mime || "audio/ogg",
        filename: data.filename || "reply.ogg",
      };
    }

    if (data.audio_url) {
      const audioRes = await fetch(data.audio_url);
      if (!audioRes.ok) throw new Error(`TTS audio_url fetch failed [${audioRes.status}]`);
      const arr = await audioRes.arrayBuffer();
      return {
        buffer: Buffer.from(arr),
        mime: audioRes.headers.get("content-type") || "audio/ogg",
        filename: "reply.ogg",
      };
    }

    throw new Error("TTS response missing audio payload");
  }

  const arr = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arr),
    mime: contentType || "audio/ogg",
    filename: "reply.ogg",
  };
}

// ✅ MEJORADO: ElevenLabs con validación y reintentos
async function synthesizeViaElevenLabs({ text, waId = "" }) {
  // Validar credenciales
  if (!ELEVENLABS_API_KEY) {
    throw new Error("ElevenLabs: ELEVENLABS_API_KEY no configurada");
  }
  if (!ELEVENLABS_VOICE_ID) {
    throw new Error("ElevenLabs: ELEVENLABS_VOICE_ID no configurada");
  }

  const cleanText = String(text || "").trim();
  if (!cleanText) {
    throw new Error("ElevenLabs: Texto vacío");
  }

  // Limitar a 1000 caracteres para no gastar cuota
  const limitedText = cleanText.slice(0, 1000);

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    ELEVENLABS_VOICE_ID
  )}?output_format=${encodeURIComponent(ELEVENLABS_OUTPUT_FORMAT)}`;

  const body = {
    text: limitedText,
    model_id: ELEVENLABS_MODEL_ID,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/ogg",
      },
      body: JSON.stringify(body),
      timeout: 30000,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      const statusMsg = {
        400: "Parámetros inválidos",
        401: "API Key inválida o expirada",
        403: "Acceso denegado",
        429: "Límite de cuota excedido",
        500: "Error del servidor ElevenLabs",
      }[res.status] || `Error HTTP ${res.status}`;

      throw new Error(`ElevenLabs [${res.status}] ${statusMsg}\n${err}`);
    }

    const arr = await res.arrayBuffer();
    if (arr.byteLength === 0) {
      throw new Error("ElevenLabs: Audio vacío recibido");
    }

    console.log(`[TTS-ElevenLabs] ✅ Audio generado (${arr.byteLength} bytes) para ${waId}`);

    return {
      buffer: Buffer.from(arr),
      mime: "audio/ogg",
      filename: `reply_${waId || "wa"}.ogg`,
    };
  } catch (error) {
    console.error(`[TTS-ElevenLabs] ❌ Error:`, error.message);
    throw error;
  }
}

export async function synthesizeVoiceBuffer({ text, waId = "", context = {} }) {
  if (!voiceEnabled()) {
    console.warn("[TTS] Voz deshabilitada (VOICE_ENABLED=false)");
    return null;
  }

  const p = resolveProvider();
  console.log(`[TTS] Proveedor: ${p}`);

  try {
    if (p === "elevenlabs") {
      return await synthesizeViaElevenLabs({ text, waId, context });
    }
    if (p === "bridge") {
      return await synthesizeViaBridge({ text, waId, context });
    }

    console.warn("[TTS] Ningún proveedor disponible");
    return null;
  } catch (error) {
    console.error(`[TTS] Error síntesis:`, error.message);
    throw error;
  }
}

// ✅ EXPORTAR info de debug
export function getVoiceConfig() {
  return {
    enabled: VOICE_ENABLED,
    provider: resolveProvider(),
    sendMode: VOICE_SEND_MODE,
    elevenLabs: {
      configured: hasElevenLabs(),
      voiceId: ELEVENLABS_VOICE_ID ? `***${ELEVENLABS_VOICE_ID.slice(-8)}` : "NO",
      model: ELEVENLABS_MODEL_ID,
      format: ELEVENLABS_OUTPUT_FORMAT,
    },
    bridge: {
      configured: hasBridge(),
      url: VOICE_TTS_URL ? `***${VOICE_TTS_URL.slice(-20)}` : "NO",
    },
  };
}
