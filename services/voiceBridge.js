// services/voiceBridge.js
  return VOICE_ENABLED && !!VOICE_TTS_URL;
}

export function shouldSendVoice(userText = "", session = null) {
  if (!voiceEnabled()) return false;

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

export async function synthesizeVoiceBuffer({ text, waId = "", context = {} }) {
  if (!voiceEnabled()) return null;

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
