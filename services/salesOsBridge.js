const SALES_OS_URL = process.env.SALES_OS_URL;
const SALES_OS_INGEST_TOKEN = process.env.SALES_OS_INGEST_TOKEN;
const SALES_OS_OPERATOR_TOKEN = process.env.SALES_OS_OPERATOR_TOKEN;

async function salesOsFetch(path, body, token = SALES_OS_INGEST_TOKEN) {
  if (!SALES_OS_URL || !token) return null;

  try {
    const res = await fetch(`${SALES_OS_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text };
  } catch (error) {
    console.error('[SalesOSBridge] request failed:', error.message);
    return null;
  }
}

async function pushConversationEvent(payload) {
  return salesOsFetch('/ingest/conversation', payload);
}

async function pushLeadEvent(payload) {
  return salesOsFetch('/ingest/lead', payload);
}

async function pushQuoteEvent(payload) {
  return salesOsFetch('/ingest/quote', payload);
}

async function getConversationControl(externalId) {
  if (!SALES_OS_URL || !SALES_OS_OPERATOR_TOKEN) {
    return { ai_paused: false };
  }

  try {
    const res = await fetch(
      `${SALES_OS_URL}/api/operator/conversation-control?external_id=${encodeURIComponent(externalId)}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${SALES_OS_OPERATOR_TOKEN}`
        }
      }
    );

    if (!res.ok) return { ai_paused: false };
    return await res.json();
  } catch (error) {
    console.error('[SalesOSBridge] control fetch failed:', error.message);
    return { ai_paused: false };
  }
}

module.exports = {
  pushConversationEvent,
  pushLeadEvent,
  pushQuoteEvent,
  getConversationControl
};
