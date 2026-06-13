// services/zohoCommercial.js — Zoho CRM para el cerebro GPT (F3a).
//
// Expone SOLO lo que necesita la tool generar_pdf_cotizacion:
//   upsertZohoDeal(params) → string|null  (devuelve dealId o null)
//   addZohoNote(dealId, title, body)      → void
//
// Fuente de la lógica: monolito index.js (zhUpsert ~L3921, zhNote ~L3834,
// zhFindDeal, zhCreate, zhUpdate, zhDefaultAcct).
// El monolito queda INTACTO con su copia. Esta deuda de duplicación se retira
// cuando se apague el V1 (decisión del dueño ya documentada en ESTADO-ACTIVA.md).
//
// IMPORTANTE: este módulo no importa index.js (arrastra side-effects y el
// servidor completo). Reimplementa SOLO las 4 funciones necesarias con axios.
// Usa las mismas env vars del monolito (sin renombrar).
//
// ESM | Node 18+ | axios (ya en package.json de temp-wa)

import axios from 'axios';
import https from 'https';

/* =======================================================
 * CONFIG — mismas env vars que el monolito
 * ======================================================= */
const REQUIRE_ZOHO = String(process.env.REQUIRE_ZOHO || 'true') === 'true';
const ZOHO = {
  CLIENT_ID:     process.env.ZOHO_CLIENT_ID,
  CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET,
  REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN,
  API:           process.env.ZOHO_API_DOMAIN     || 'https://www.zohoapis.com',
  ACCOUNTS:      process.env.ZOHO_ACCOUNTS_DOMAIN || 'https://accounts.zoho.com',
  DEAL_PHONE:    process.env.ZOHO_DEAL_PHONE_FIELD || 'WhatsApp_Phone',
  DEFAULT_ACCT:  process.env.ZOHO_DEFAULT_ACCOUNT_NAME || 'Clientes WhatsApp IA',
};

// Stages en español (configurables por env, igual que el monolito).
const STAGES = {
  diagnostico: process.env.ZOHO_STAGE_DIAGNOSTICO || 'Diagnóstico y Perfilado',
  siembra:     process.env.ZOHO_STAGE_SIEMBRA     || 'Siembra de Confianza + Marco Normativo',
  validacion:  process.env.ZOHO_STAGE_VALIDACION  || 'Validación Técnica y Propuesta',
  propuesta:   process.env.ZOHO_STAGE_PROPUESTA   || 'Propuesta Formal Enviada',
  cierre:      process.env.ZOHO_STAGE_CIERRE      || 'En Cierre',
  ganado:      process.env.ZOHO_STAGE_GANADO      || 'Ganado',
  perdido:     process.env.ZOHO_STAGE_PERDIDO     || 'Perdido',
};

// httpsAgent igual que el monolito (rejectUnauthorized según env, defecto true).
const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
});

/* =======================================================
 * TOKEN OAUTH — caché en memoria (igual que monolito zhToken)
 * ======================================================= */
const _zh = { token: null, exp: 0 };
let _zhP = null;

async function zhToken() {
  if (!REQUIRE_ZOHO) return '';
  if (_zh.token && Date.now() < _zh.exp) return _zh.token;
  if (_zhP) return _zhP;
  _zhP = (async () => {
    const { data } = await axios.post(
      `${ZOHO.ACCOUNTS}/oauth/v2/token`,
      new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     ZOHO.CLIENT_ID,
        client_secret: ZOHO.CLIENT_SECRET,
        refresh_token: ZOHO.REFRESH_TOKEN,
      }),
      { httpsAgent, timeout: 15000 }
    );
    _zh.token = data.access_token;
    _zh.exp   = Date.now() + (Number(data.expires_in || 3600) - 120) * 1000;
    return _zh.token;
  })().finally(() => { _zhP = null; });
  return _zhP;
}

async function zhH() {
  const tok = await zhToken();
  return { Authorization: `Zoho-oauthtoken ${tok}`, 'Content-Type': 'application/json' };
}

/* =======================================================
 * HELPERS INTERNOS
 * ======================================================= */
function normPhone(raw) {
  const s = String(raw || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (s.startsWith('56') && s.length === 11) return `+${s}`;
  if (s.length === 9 && s.startsWith('9')) return `+56${s}`;
  return s;
}

async function zhCreate(mod, rec) {
  try {
    const r = await axios.post(
      `${ZOHO.API}/crm/v2/${mod}`,
      { data: [rec], trigger: ['workflow'] },
      { headers: await zhH(), httpsAgent, timeout: 20000 }
    );
    return r.data?.data?.[0]?.details?.id || null;
  } catch (e) {
    console.error(`[zohoCommercial] zhCreate ${mod}:`, e.response?.data || e.message);
    return null;
  }
}

async function zhUpdate(mod, id, rec) {
  try {
    await axios.put(
      `${ZOHO.API}/crm/v2/${mod}/${id}`,
      { data: [rec], trigger: ['workflow'] },
      { headers: await zhH(), httpsAgent, timeout: 20000 }
    );
  } catch (e) {
    console.error(`[zohoCommercial] zhUpdate ${mod}:`, e.response?.data || e.message);
  }
}

async function zhFindDeal(phone) {
  if (!REQUIRE_ZOHO) return null;
  const h = await zhH();
  for (const f of [ZOHO.DEAL_PHONE, 'Phone', 'Mobile'].filter(Boolean)) {
    try {
      const { data } = await axios.get(
        `${ZOHO.API}/crm/v2/Deals/search?criteria=(${f}:equals:${encodeURIComponent(phone)})`,
        { headers: h, httpsAgent, timeout: 15000 }
      );
      if (data?.data?.[0]) return data.data[0];
    } catch (e) {
      if (e.response?.status === 204 || e.response?.data?.code === 'INVALID_QUERY') continue;
      console.error(`[zohoCommercial] zhFindDeal(${f}):`, e.response?.data || e.message);
      return null;
    }
  }
  return null;
}

async function zhDefaultAcct() {
  try {
    const h = await zhH();
    const n = ZOHO.DEFAULT_ACCT;
    const r = await axios.get(
      `${ZOHO.API}/crm/v2/Accounts/search?criteria=(Account_Name:equals:${encodeURIComponent(n)})`,
      { headers: h, httpsAgent, timeout: 15000 }
    );
    if (r.data?.data?.[0]) return r.data.data[0].id;
    const c = await axios.post(
      `${ZOHO.API}/crm/v2/Accounts`,
      { data: [{ Account_Name: n }] },
      { headers: h, httpsAgent, timeout: 15000 }
    );
    return c.data?.data?.[0]?.details?.id || null;
  } catch (e) {
    console.error('[zohoCommercial] zhDefaultAcct:', e.response?.data || e.message);
    return null;
  }
}

/* =======================================================
 * WORKDRIVE — INERTE (no-bloqueante)
 * El dueño debe re-autorizar OAuth con scope WorkDrive.files.CREATE.
 * Hasta entonces esta función loguea y retorna sin hacer nada.
 * ======================================================= */
export async function archivarEnWorkDrive(pdfBuffer, filename) {
  // TODO: cuando el dueño agregue scope WorkDrive al refresh_token,
  // descomentar el upload real y actualizar ZOHO_WORKDRIVE_FOLDER_ID en Railway.
  const folderId = process.env.ZOHO_WORKDRIVE_FOLDER_ID || null;
  if (!folderId) {
    console.log('[zohoCommercial] WorkDrive: ZOHO_WORKDRIVE_FOLDER_ID no configurado — archivo pendiente re-autorización OAuth');
    return { ok: false, skipped: true, reason: 'workdrive_scope_pending' };
  }
  // Stub del upload real — se activa cuando el dueño regenere el refresh_token.
  console.log(`[zohoCommercial] WorkDrive: upload inerte de ${filename} a carpeta ${folderId}`);
  return { ok: false, skipped: true, reason: 'workdrive_stub' };
}

/* =======================================================
 * EXPORTS
 * ======================================================= */

/**
 * Crea o actualiza un Deal en Zoho CRM para el lead del PDF.
 * Espeja zhUpsert de index.js ~L3921 adaptado al contexto del cerebro GPT.
 *
 * @param {{ phone, name, comuna, items, grand_total, stageKey, quote_number }} params
 * @returns {Promise<string|null>} dealId (Zoho) o null si Zoho está deshabilitado/falla.
 */
export async function upsertZohoDeal({ phone, name, comuna, items = [], grand_total, stageKey = 'propuesta', quote_number }) {
  if (!REQUIRE_ZOHO) return null;
  const normalizedPhone = normPhone(phone);
  const mp = items[0]?.producto_label || items[0]?.product || 'Ventanas';
  const deal = {
    Deal_Name:    `${mp} [WA…${String(phone).slice(-4)}]`.trim(),
    Stage:        STAGES[stageKey] || STAGES.propuesta,
    Closing_Date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    Description:  [
      `Cliente: ${name || '—'} · ${normalizedPhone} · ${comuna || 'Temuco'}`,
      quote_number ? `Cotización ISO: ${quote_number}` : '',
      grand_total  ? `Total: $${Number(grand_total).toLocaleString('es-CL')} CLP` : '',
      '',
      'ITEMS:',
      ...items.map((it, i) =>
        `${i + 1}. ${it.qty || 1}× ${it.producto_label || it.product || '?'} ${it.measures || ''} → $${Number(it.unit_price || 0).toLocaleString('es-CL')}`
      ),
    ].filter((l) => l !== undefined).join('\n'),
  };
  if (ZOHO.DEAL_PHONE) deal[ZOHO.DEAL_PHONE] = normalizedPhone;
  if (grand_total)     deal.Amount = grand_total;

  try {
    const existing = await zhFindDeal(normalizedPhone);
    if (existing?.id) {
      await zhUpdate('Deals', existing.id, deal);
      return existing.id;
    }
    const acctId = await zhDefaultAcct();
    if (acctId) deal.Account_Name = { id: acctId };
    return await zhCreate('Deals', deal);
  } catch (e) {
    console.error('[zohoCommercial] upsertZohoDeal:', e.response?.data || e.message);
    return null;
  }
}

/**
 * Agrega una nota a un Deal de Zoho CRM.
 * Espeja zhNote de index.js ~L3834.
 *
 * @param {string} dealId   - ID del Deal en Zoho.
 * @param {string} title    - Título de la nota.
 * @param {string} body     - Contenido de la nota.
 */
export async function addZohoNote(dealId, title, body) {
  if (!REQUIRE_ZOHO || !dealId) return;
  try {
    await axios.post(
      `${ZOHO.API}/crm/v2/Deals/${dealId}/Notes`,
      { data: [{ Note_Title: title, Note_Content: body }] },
      { headers: await zhH(), httpsAgent, timeout: 15000 }
    );
  } catch (e) {
    console.error('[zohoCommercial] addZohoNote:', e.response?.data || e.message);
  }
}
