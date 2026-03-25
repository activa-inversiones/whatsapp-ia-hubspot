// services/voiceBridge.js
// Node 18+ (ESM). Usa fetch global.

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

async function synthesizeViaElevenLabs({ text, waId = "" }) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    ELEVENLABS_VOICE_ID
  )}?output_format=${encodeURIComponent(ELEVENLABS_OUTPUT_FORMAT)}`;

  const body = {
    text: String(text || "").trim(),
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
    throw new Error(`ElevenLabs failed [${res.status}] ${err}`);
  }

  const arr = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arr),
    mime: "audio/ogg",
    filename: `reply_${waId || "wa"}.ogg`,
  };
}

export async function synthesizeVoiceBuffer({ text, waId = "", context = {} }) {
  if (!voiceEnabled()) return null;

  const p = resolveProvider();
  if (p === "elevenlabs") return synthesizeViaElevenLabs({ text, waId, context });
  if (p === "bridge") return synthesizeViaBridge({ text, waId, context });

  return null;
}
