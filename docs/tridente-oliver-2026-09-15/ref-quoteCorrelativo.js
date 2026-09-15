// src/services/quoteCorrelativo.js
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA IMPERIUM — Correlativo ISO de cotizaciones (trazabilidad ISO 9001 §7.5)
// ───────────────────────────────────────────────────────────────────────────
// Genera un número de cotización SECUENCIAL y trazable (no aleatorio), formato
// COT-AAAA-NNNN reiniciando cada año. Atómico vía contador en Postgres:
// dos turnos simultáneos NUNCA reciben el mismo número (UPDATE ... RETURNING).
//
// Reemplaza el quote_number aleatorio del monolito (COT-fecha-XXXX) que NO
// permitía auditar la secuencia (no se podía saber si faltaba una cotización).
//
// Endpoint: POST /internal/quotes/next-number  → { ok, quote_number, seq, year }
// ═══════════════════════════════════════════════════════════════════════════

import { pool } from '../db/client.js';

const TENANT = process.env.DEFAULT_TENANT_ID || 'activa';
// Correlativo ISO: el prefijo es el CÓDIGO del documento en el SGI (control documental).
// CM-FR-004 = "Cotización / Propuesta Comercial" (área Comercial, registro). NO inventado:
// dado de alta en el SGI con la nomenclatura ÁREA-TIPO-NNN del sistema. Override por env.
const PREFIX = process.env.QUOTE_CORRELATIVO_PREFIX || 'CM-FR-004';

function log(m) { console.log(`[quoteCorrelativo] ${m}`); }

// Migración idempotente: tabla contador por (tenant, año).
async function ensureCounterTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quote_counters (
        tenant_id text NOT NULL,
        year      int  NOT NULL,
        last_seq  int  NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tenant_id, year)
      )`);
  } catch (e) { log(`ensureCounterTable: ${e.message}`); }
}

/**
 * Devuelve el SIGUIENTE correlativo de forma ATÓMICA. Concurrencia segura:
 * el INSERT ... ON CONFLICT DO UPDATE ... RETURNING incrementa y devuelve en
 * una sola sentencia (sin race conditions).
 * @param {string} [tenantId]
 * @returns {Promise<{ quote_number: string, seq: number, year: number }>}
 */
export async function nextQuoteNumber(tenantId = TENANT) {
  const year = new Date().getFullYear();
  const { rows } = await pool.query(
    `INSERT INTO quote_counters (tenant_id, year, last_seq)
       VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, year)
       DO UPDATE SET last_seq = quote_counters.last_seq + 1, updated_at = NOW()
     RETURNING last_seq`,
    [tenantId, year]
  );
  const seq = rows[0].last_seq;
  const quote_number = `${PREFIX}-${year}-${String(seq).padStart(4, '0')}`;
  return { quote_number, seq, year };
}

// ── Registro del endpoint interno (mismo patrón que registerAgendaRoutes) ──
export function registerQuoteCorrelativo(app, { requireToken, requireAnyToken, operatorToken, operatorApiToken }) {
  // El bot (cerebro) manda SALES_OS_OPERATOR_TOKEN. En sales-os ese valor puede
  // coincidir con env.operatorToken O con env.operatorApiToken (sesiones usan este
  // último y están probadas). Aceptar AMBOS garantiza que el correlativo ISO no
  // caiga a fallback por un mismatch de token. // NO TOCA: dominio interno de confianza.
  const validTokens = [operatorToken, operatorApiToken].filter(Boolean);
  const auth = requireAnyToken
    ? (req, res, next) => requireAnyToken(req, res, next, validTokens)
    : (req, res, next) => requireToken(req, res, next, operatorToken);
  ensureCounterTable().catch(e => log(`ensure arranque: ${e.message}`));
  // El bot (cerebro GPT) pide el correlativo al generar el PDF de cotización.
  app.post('/internal/quotes/next-number', auth, async (req, res) => {
    try {
      const tenantId = (req.body && req.body.tenant_id) || TENANT;
      const r = await nextQuoteNumber(tenantId);
      // [2026-06-24] Adjuntar el descuento de mercado vigente → el bot lo muestra en el
      // PDF para que el CLIENTE lo vea (y el dueño confirme que está aplicado). El motor ya
      // lo aplica a los precios; esto es solo para mostrarlo. try-catch: si falla, no rompe el correlativo.
      let descuento_cliente_pct = 0;
      try {
        const dq = await pool.query(`SELECT value FROM activa_engine_config WHERE key='descuento_cliente_pct' LIMIT 1`);
        if (dq.rows[0]) descuento_cliente_pct = Number(dq.rows[0].value) || 0;
      } catch (e) { log(`descuento read: ${e.message}`); }
      res.json({ ok: true, ...r, descuento_cliente_pct });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}
