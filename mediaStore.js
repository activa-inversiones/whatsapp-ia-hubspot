/**
 * mediaStore.js — Servicio almacenamiento multimedia para Oliver
 * v5.3.1 — Guarda imágenes, audios, PDFs, videos en Postgres
 *
 * [v5.3.1 FIX 2026-04-21] El server.js (requireToken) busca el token en
 * 'x-api-key' / '?token=' / 'Authorization: Bearer'. Antes lo mandábamos como
 * 'x-operator-token' y siempre daba 401. Ahora lo mandamos en los 3 headers
 * que sí lee el server para máxima compatibilidad.
 *
 * USO EN BOT:
 *   const { saveMedia, getMediaByPhone } = require('./mediaStore');
 *   await saveMedia({ phone, type:'image', buffer, mime, filename, transcription, aiDescription });
 */

const SALES_OS_URL = process.env.SALES_OS_URL || '';
const OPERATOR_TOKEN = process.env.SALES_OS_OPERATOR_TOKEN || process.env.INTERNAL_OPERATOR_TOKEN || '';
const MEDIA_ENABLED = !!(SALES_OS_URL && OPERATOR_TOKEN);

// [v5.3.1 FIX] Helper: headers compatibles con requireToken() del server
function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-api-key': OPERATOR_TOKEN,
    'Authorization': `Bearer ${OPERATOR_TOKEN}`,
    'x-operator-token': OPERATOR_TOKEN, // compatibilidad, por si en el futuro el server lo lee
  };
}

/**
 * Guarda un archivo multimedia en la BD vía Sales-OS API
 * @param {Object} opts
 * @param {string} opts.phone - Teléfono del cliente (waId)
 * @param {string} opts.direction - 'inbound' o 'outbound'
 * @param {string} opts.mediaType - 'image','audio','video','document','sticker'
 * @param {string} opts.mimeType - MIME (image/jpeg, audio/ogg, etc)
 * @param {string} opts.filename - Nombre archivo
 * @param {Buffer} opts.buffer - Contenido binario del archivo
 * @param {string} opts.waMediaId - ID de WhatsApp Media
 * @param {string} opts.transcription - Transcripción (para audios)
 * @param {string} opts.aiDescription - Descripción IA (para imágenes)
 */
async function saveMedia(opts) {
  if (!MEDIA_ENABLED) {
    console.log('[MediaStore] Disabled (no SALES_OS_URL)');
    return null;
  }

  try {
    const payload = {
      phone: opts.phone,
      direction: opts.direction || 'inbound',
      media_type: opts.mediaType,
      mime_type: opts.mimeType || '',
      filename: opts.filename || `${opts.mediaType}_${Date.now()}`,
      wa_media_id: opts.waMediaId || '',
      transcription: opts.transcription || '',
      ai_description: opts.aiDescription || '',
      // Enviar buffer como base64
      media_base64: opts.buffer ? opts.buffer.toString('base64') : '',
      file_size: opts.buffer ? opts.buffer.length : 0
    };

    const resp = await fetch(`${SALES_OS_URL}/api/v5/media/store`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    if (!resp.ok) {
      console.error(`[MediaStore] HTTP ${resp.status} storing ${opts.mediaType} for ${opts.phone}`);
      return null;
    }

    const result = await resp.json();
    console.log(`[MediaStore] ✅ Saved ${opts.mediaType} for ${opts.phone} (${opts.buffer?.length || 0} bytes)`);
    return result;
  } catch (err) {
    // Fire-and-forget: no crashear el bot si falla storage
    console.error(`[MediaStore] Error storing ${opts.mediaType}: ${err.message}`);
    return null;
  }
}

/**
 * Registra actividad en pipeline (llamada, nota, etc)
 */
async function logActivity(opts) {
  if (!MEDIA_ENABLED) return null;

  try {
    const resp = await fetch(`${SALES_OS_URL}/api/v5/pipeline/activity`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        phone: opts.phone,
        activity_type: opts.type,
        description: opts.description || '',
        duration_seconds: opts.duration || 0,
        created_by: opts.by || 'oliver'
      }),
      signal: AbortSignal.timeout(5000)
    });
    return resp.ok;
  } catch (err) {
    console.error(`[MediaStore] Activity log error: ${err.message}`);
    return false;
  }
}

/**
 * Notifica cotización enviada (para que el CEO reciba script de ventas)
 */
async function notifyQuoteSent(opts) {
  if (!MEDIA_ENABLED) return null;

  try {
    const resp = await fetch(`${SALES_OS_URL}/api/v5/quote-alerts/notify`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        phone: opts.phone,
        client_name: opts.clientName || '',
        quote_value: opts.quoteValue || 0,
        items_summary: opts.itemsSummary || '',
        comuna: opts.comuna || ''
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (resp.ok) {
      console.log(`[MediaStore] ✅ Quote alert sent for ${opts.phone} ($${opts.quoteValue})`);
    }
    return resp.ok;
  } catch (err) {
    console.error(`[MediaStore] Quote alert error: ${err.message}`);
    return false;
  }
}

export { saveMedia, logActivity, notifyQuoteSent, MEDIA_ENABLED };
