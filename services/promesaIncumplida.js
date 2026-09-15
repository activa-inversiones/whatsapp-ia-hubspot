// promesaIncumplida.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — "Te dije que te la preparaba y nunca te la mandé."
//
// CASO REAL QUE LO ORIGINA (Katy Rossel, 15-sep-2026, conv 36f82b64):
//   17:58  la clienta: "Si, me acomoda. Me puede elaborar un presupuesto?"
//   17:59  Oliver: "Mientras le preparo su Propuesta Técnica Económica…"
//          └─ y reserva el folio CM-FR-004-2026-0462
//   18:00  ✅ informe térmico  CM-FR-006-2026-0169
//   18:00  ✅ informe de vientos CM-FR-007-2026-0053
//   18:01  ✅ video de presentación
//          ❌ la Propuesta Técnica Económica NUNCA salió
//   20:02  el DUEÑO, dos horas después, la manda a mano calculada en otra
//          plataforma ("4561 KATY ROSSEL … Presu1-DA.pdf")
// Confirmado por el dueño, textual: *"oliver no entregarte la propuesta técnico
// económica a katy, se la envié yo calculada en otra plataforma"*.
// Regla de negocio del dueño: *"a todos los clientes que se le cotiza le llega el
// informe térmico, informe de vientos Y la cotización"*. Katy recibió dos de tres.
//
// ── POR QUÉ NADIE AVISÓ ─────────────────────────────────────────────────────
// `stuckLeadMonitor.js` existe para exactamente esta clase de falla (caso Dalia),
// pero exige `inbound_count >= 4` (stuckLeadMonitor.js:76): que el cliente INSISTA.
// Katy pidió el presupuesto UNA vez y se quedó esperando — porque le habían dicho
// que ya se lo preparaban.
//   ⇒ LA PROMESA APAGA LA SEÑAL QUE EL MONITOR NECESITA.
// Un cliente que confía deja de insistir. El monitor de insistencia es ciego
// justo con los clientes que mejor se portaron.
//
// ── POR QUÉ PASA ────────────────────────────────────────────────────────────
// La promesa la emite el CÓDIGO, de forma determinista (webhook.js:3439,
// `mensajeValor`, dentro del flujo del informe térmico). La entrega, en cambio,
// depende de que el LLM decida llamar a `generar_pdf_cotizacion` (webhook.js:4483).
//   Promesa determinista + cumplimiento probabilístico = esta falla.
// Si el modelo no llama la tool y el cliente no vuelve a escribir, no hay turno
// siguiente y la promesa muere en silencio: sin PDF, sin aviso, sin rastro.
//
// Este módulo NO arregla la causa (que el LLM llame la tool): pone la RED. Nadie
// se entera hoy; con esto, el dueño se entera en minutos en vez de en dos horas.
//
// Módulo PURO: sin red, sin BD, sin env. El caller hace la query y el envío.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

/** Minutos de gracia por defecto. La entrega normal medida tarda 1-3 min. */
export const MINUTOS_GRACIA = 15;

/** Techo por defecto: más allá, ya no es "recién pasó" y avisar es ruido. */
export const MINUTOS_TECHO = 2880; // 48 h

/**
 * Detecta promesas de Propuesta Técnica Económica que NO se cumplieron.
 *
 * A diferencia de `detectStuckLeads`, acá **no importa cuántas veces escribió el
 * cliente**: importa que el bot se comprometió. Esa es toda la diferencia, y es
 * la que dejó pasar el caso Katy.
 *
 * Se marca cuando se cumplen TODAS:
 *   1. hay promesa (`promesa_at`)                → el bot se comprometió
 *   2. no hay PTE posterior (`pte_at` nulo)      → no la cumplió
 *   3. pasaron más de `minutosGracia` minutos    → no es que esté saliendo ahora
 *   4. no pasaron más de `minutosTecho`          → sigue siendo accionable
 *   5. no la tomó un humano                      → si hay alguien a cargo, está bien
 *
 * @param {Array<object>} filas  { id, customer_name, phone, promesa_at, pte_at,
 *                                 minutos_desde_promesa, ai_paused, operator_status,
 *                                 quote_number }
 * @param {{minutosGracia?: number, minutosTecho?: number}} [opts]
 * @returns {Array<object>} subconjunto incumplido, con `motivo` legible
 */
export function detectarPromesasIncumplidas(filas, opts = {}) {
  if (!Array.isArray(filas)) return [];

  const gracia = opts.minutosGracia ?? MINUTOS_GRACIA;
  const techo = opts.minutosTecho ?? MINUTOS_TECHO;
  const out = [];

  for (const f of filas) {
    if (!f || typeof f !== 'object') continue;

    // 1. hubo promesa
    if (!f.promesa_at) continue;

    // 2. no se cumplió. `pte_at` con valor = la PTE salió → no avisar.
    if (f.pte_at) continue;

    // 5. un humano ya es dueño del caso (mismo criterio que stuckLeadMonitor)
    if (f.ai_paused === true) continue;
    if (f.operator_status === 'human') continue;

    // 3 y 4. ventana accionable
    const min = Number(f.minutos_desde_promesa);
    if (!Number.isFinite(min)) continue;
    if (min < gracia) continue;
    if (min > techo) continue;

    out.push({
      ...f,
      motivo: f.quote_number
        ? `prometida hace ${formatearEspera(min)} · folio ${f.quote_number} reservado y sin documento`
        : `prometida hace ${formatearEspera(min)} · sin folio`,
    });
  }

  // El que lleva más tiempo esperando va primero: es el que más arriesga.
  return out.sort((a, b) => Number(b.minutos_desde_promesa) - Number(a.minutos_desde_promesa));
}

/** "18 minutos" / "2 h 5 min" — para que el dueño dimensione sin hacer cuentas. */
export function formatearEspera(minutos) {
  const m = Math.floor(Number(minutos) || 0);
  if (m < 60) return `${m} minutos`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/**
 * Mensaje de WhatsApp para el DUEÑO. NO inventa precios ni datos de negocio.
 * Devuelve '' si no hay nada que avisar (el caller no debe mandar mensajes vacíos).
 *
 * @param {Array<object>} incumplidas  resultado de detectarPromesasIncumplidas()
 * @returns {string}
 */
export function mensajePromesasIncumplidas(incumplidas) {
  if (!Array.isArray(incumplidas) || incumplidas.length === 0) return '';

  const n = incumplidas.length;
  const cab = n === 1
    ? '⚠️ *Le prometimos una propuesta y no salió*'
    : `⚠️ *Le prometimos una propuesta a ${n} clientes y no salió*`;

  const lineas = incumplidas.slice(0, 10).map((f) => {
    const quien = String(f.customer_name || '').trim() || f.phone || 'cliente sin nombre';
    return `• *${quien}* — ${f.motivo}`;
  });

  const resto = n > 10 ? `\n…y ${n - 10} más.` : '';

  return `${cab}\n\n${lineas.join('\n')}${resto}\n\n` +
    'Recibieron el informe térmico y el de vientos, pero NO la Propuesta Técnica Económica.';
}

export default detectarPromesasIncumplidas;
