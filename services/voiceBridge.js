// services/voiceBridge.js
// Node 18+ (ESM). Usa fetch global.
// ✅ LIMPIO: Solo TTS/voz. Sin pricing (usa cotizadorWinhouseBridge para precios).
 
const VOICE_ENABLED = String(process.env.VOICE_ENABLED || "false") === "true";
const VOICE_SEND_MODE = String(process.env.VOICE_SEND_MODE || "text_only"); // text_only | text_and_audio | audio_if_inbound_audio
const VOICE_TTS_PROVIDER = String(process.env.VOICE_TTS_PROVIDER || "").toLowerCase(); // elevenlabs | bridge | ""
 
const VOICE_TTS_URL = process.env.VOICE_TTS_URL || "";
const VOICE_TTS_TOKEN = process.env.VOICE_TTS_TOKEN || "";
const VOICE_TTS_VOICE_ID = process.env.VOICE_TTS_VOICE_ID || "";
 
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "";
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const ELEVENLABS_OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT || "ogg_opus";
 
// ═══════════════════════════════════════════════════════════════════
// Detección de proveedores
// ═══════════════════════════════════════════════════════════════════
 
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
 
// ═══════════════════════════════════════════════════════════════════
// API pública
// ═══════════════════════════════════════════════════════════════════
 
export function voiceEnabled() {
  if (!VOICE_ENABLED) return false;
  const p = resolveProvider();
  return p === "elevenlabs" || p === "bridge";
}
 
export function shouldSendVoice(userText = "", session = null, opts = {}) {
  if (!voiceEnabled()) return false;
 
  // Si el cliente mandó audio, SIEMPRE responder con audio
  const incomingType = opts?.incomingType || "text";
  if (incomingType === "audio") return true;
 
  // Si el texto menciona "audio" / "nota de voz" / "voz"
  const t = String(userText || "").toLowerCase();
  const explicit =
    t.includes("audio") ||
    t.includes("nota de voz") ||
    t.includes("mensaje de voz") ||
    t.includes("voz");
  if (explicit) return true;
 
  // Modo "text_and_audio" = siempre audio (salvo si quiere PDF)
  const wantsPdf = !!session?.data?.wants_pdf;
  if (VOICE_SEND_MODE === "text_and_audio" && !wantsPdf) return true;
 
  // Modo "audio_if_inbound_audio" = solo si el inbound fue audio (ya cubierto arriba)
  return false;
}
 
// ═══════════════════════════════════════════════════════════════════
// Síntesis de voz — Bridge personalizado
// ═══════════════════════════════════════════════════════════════════
 
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
    throw new Error(`TTS Bridge failed [${res.status}] ${err}`);
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
 
// ═══════════════════════════════════════════════════════════════════
// Síntesis de voz — ElevenLabs (mejorado con validación + logs)
// ═══════════════════════════════════════════════════════════════════
 
async function synthesizeViaElevenLabs({ text, waId = "" }) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error("ElevenLabs: ELEVENLABS_API_KEY no configurada en variables de entorno");
  }
  if (!ELEVENLABS_VOICE_ID) {
    throw new Error("ElevenLabs: ELEVENLABS_VOICE_ID no configurada en variables de entorno");
  }
 
  const cleanText = String(text || "").trim();
  if (!cleanText) {
    throw new Error("ElevenLabs: texto vacío, no se puede sintetizar");
  }
 
  // Limitar a 1000 caracteres para controlar cuota de ElevenLabs
  const limitedText = cleanText.length > 1000 ? cleanText.slice(0, 1000) : cleanText;
 
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    ELEVENLABS_VOICE_ID
  )}?output_format=${encodeURIComponent(ELEVENLABS_OUTPUT_FORMAT)}`;
 
  const body = {
    text: limitedText,
    model_id: ELEVENLABS_MODEL_ID,
  };
 
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/ogg",
    },
    body: JSON.stringify(body),
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
 
    throw new Error(`ElevenLabs [${res.status}] ${statusMsg} — ${err}`);
  }
 
  const arr = await res.arrayBuffer();
  if (arr.byteLength === 0) {
    throw new Error("ElevenLabs: audio vacío recibido (0 bytes)");
  }
 
  console.log(`[TTS-ElevenLabs] ✅ Audio generado (${arr.byteLength} bytes) para ${waId || "desconocido"}`);
 
  return {
    buffer: Buffer.from(arr),
    mime: "audio/ogg",
    filename: `reply_${waId || "wa"}.ogg`,
  };
}
 
// ═══════════════════════════════════════════════════════════════════
// Síntesis principal — elige proveedor automáticamente
// ═══════════════════════════════════════════════════════════════════
 
export async function synthesizeVoiceBuffer({ text, waId = "", context = {} }) {
  if (!voiceEnabled()) {
    console.warn("[TTS] Voz deshabilitada (VOICE_ENABLED=false o sin proveedor configurado)");
    return null;
  }
 
  const p = resolveProvider();
  console.log(`[TTS] Proveedor seleccionado: ${p} | waId: ${waId}`);
 
  try {
    if (p === "elevenlabs") {
      return await synthesizeViaElevenLabs({ text, waId, context });
    }
    if (p === "bridge") {
      return await synthesizeViaBridge({ text, waId, context });
    }
 
    console.warn("[TTS] Ningún proveedor disponible (ni ElevenLabs ni Bridge)");
    return null;
  } catch (error) {
    console.error(`[TTS] ❌ Error en síntesis (${p}):`, error.message);
    // No relanzar — el bot puede seguir respondiendo texto si falla voz
    return null;
  }
}
 
// ═══════════════════════════════════════════════════════════════════
// Debug / health check
// ═══════════════════════════════════════════════════════════════════
 
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
