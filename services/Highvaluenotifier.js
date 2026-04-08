// services/highValueNotifier.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════
// ACTIVA — Notificador de Leads de Alto Valor
// ═══════════════════════════════════════════════════════════════════
// DETECTA clientes high-ticket en TIEMPO REAL mientras el bot conversa.
// ENVÍA alerta rica a Marcelo con contexto completo.
// PUSH al dashboard Sales-OS para visibilidad inmediata.
// ═══════════════════════════════════════════════════════════════════

const OWNER_PHONE = process.env.OWNER_NOTIFICATION_PHONE || process.env.ESCALATION_PHONE || "";
const HIGH_VALUE_THRESHOLD = parseInt(process.env.HIGH_VALUE_THRESHOLD || "800000", 10); // CLP
const MEDIUM_VALUE_THRESHOLD = parseInt(process.env.MEDIUM_VALUE_THRESHOLD || "300000", 10);

// Palabras que indican cliente de alto valor
const HIGH_VALUE_KEYWORDS = [
  "proyecto", "constructor", "constructora", "edificio", "condominio",
  "departamento", "departamentos", "casa nueva", "obra gruesa",
  "licitación", "licitacion", "presupuesto completo", "toda la casa",
  "todas las ventanas", "remodelación completa", "remodelacion completa",
  "arquitecto", "ingeniero", "inmobiliaria", "negocio", "local comercial",
  "20 ventanas", "30 ventanas", "15 ventanas", "10 ventanas",
  "segundo piso", "ampliación", "ampliacion",
];

// Palabras que indican urgencia
const URGENCY_KEYWORDS = [
  "urgente", "lo antes posible", "para mañana", "esta semana",
  "necesito ya", "cuanto antes", "rápido", "rapido", "apurado",
  "inmediato", "hoy mismo",
];

// Cooldown para no spam a Marcelo (1 alert por cliente cada 2 horas)
const alertCooldown = new Map();
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 horas

/**
 * Evalúa si un lead es de alto valor basado en múltiples señales
 */
function evaluateLeadValue(session) {
  const d = session.data || {};
  const history = session.history || [];
  const score = { value: 0, signals: [], tier: "standard" };

  // 1. Por monto de cotización
  const total = d.grand_total || 0;
  if (total >= HIGH_VALUE_THRESHOLD) {
    score.value += 40;
    score.signals.push(`💰 Cotización $${Number(total).toLocaleString("es-CL")}`);
  } else if (total >= MEDIUM_VALUE_THRESHOLD) {
    score.value += 20;
    score.signals.push(`💵 Cotización $${Number(total).toLocaleString("es-CL")}`);
  }

  // 2. Por cantidad de items
  const itemCount = (d.items || []).length;
  if (itemCount >= 5) {
    score.value += 25;
    score.signals.push(`📦 ${itemCount} items en cotización`);
  } else if (itemCount >= 3) {
    score.value += 15;
    score.signals.push(`📦 ${itemCount} items`);
  }

  // 3. Por keywords en conversación
  const allText = history.filter(m => m.role === "user").map(m => m.content).join(" ").toLowerCase();
  
  for (const kw of HIGH_VALUE_KEYWORDS) {
    if (allText.includes(kw.toLowerCase())) {
      score.value += 15;
      score.signals.push(`🔑 Mencionó "${kw}"`);
      break; // solo contar una vez
    }
  }

  // 4. Por urgencia
  for (const kw of URGENCY_KEYWORDS) {
    if (allText.includes(kw.toLowerCase())) {
      score.value += 10;
      score.signals.push(`⚡ Urgencia: "${kw}"`);
      break;
    }
  }

  // 5. Por comuna (Temuco tiene mayor margen)
  if (d.comuna && d.comuna.toLowerCase().includes("temuco")) {
    score.value += 5;
    score.signals.push("📍 Temuco (zona fábrica)");
  }

  // 6. Si ya tiene nombre = lead más comprometido
  if (d.name && d.name.length > 2) {
    score.value += 10;
    score.signals.push(`👤 ${d.name}`);
  }

  // 7. Si llegó a etapa de cotización formal
  if (d.stageKey === "cotizacion_enviada" || d.stageKey === "formal_sent") {
    score.value += 15;
    score.signals.push("📄 Cotización ya enviada");
  }

  // Determinar tier
  if (score.value >= 60) score.tier = "HIGH";
  else if (score.value >= 35) score.tier = "MEDIUM";
  else score.tier = "STANDARD";

  return score;
}

/**
 * Genera resumen de conversación para el handoff
 */
function generateConversationSummary(session) {
  const d = session.data || {};
  const history = session.history || [];
  const lines = [];

  lines.push(`══════════════════════════`);
  lines.push(`📋 RESUMEN CONVERSACIÓN`);
  lines.push(`══════════════════════════`);
  
  if (d.name) lines.push(`👤 Cliente: ${d.name}`);
  if (d.comuna) lines.push(`📍 Comuna: ${d.comuna}`);
  if (d.zona_termica) lines.push(`🌡️ Zona térmica: ${d.zona_termica}`);
  
  if (d.items && d.items.length > 0) {
    lines.push(`\n📦 ITEMS (${d.items.length}):`);
    d.items.forEach((it, i) => {
      const precio = it.unit_price ? `$${Number(it.unit_price).toLocaleString("es-CL")}` : "sin precio";
      lines.push(`  ${i+1}. ${it.qty || 1}× ${it.product} ${it.measures || ""} [${it.color || "blanco"}] → ${precio}`);
    });
  }

  if (d.grand_total) {
    lines.push(`\n💰 TOTAL: $${Number(d.grand_total).toLocaleString("es-CL")} + IVA`);
  }

  // Últimos 5 mensajes del cliente
  const userMsgs = history.filter(m => m.role === "user").slice(-5);
  if (userMsgs.length > 0) {
    lines.push(`\n💬 ÚLTIMOS MENSAJES:`);
    userMsgs.forEach(m => {
      const text = m.content.length > 80 ? m.content.substring(0, 80) + "..." : m.content;
      lines.push(`  → "${text}"`);
    });
  }

  lines.push(`\n🔗 Dashboard: ops.activalabs.ai`);
  
  return lines.join("\n");
}

/**
 * Envía alerta de alto valor a Marcelo
 * @param {Function} waSendFn - función waSend del bot
 * @param {string} customerPhone - teléfono del cliente
 * @param {object} session - sesión completa del cliente
 * @param {string} reason - razón de la alerta
 */
async function notifyHighValue(waSendFn, customerPhone, session, reason = "auto") {
  if (!OWNER_PHONE) {
    console.log("[highValueNotifier] OWNER_NOTIFICATION_PHONE no configurado");
    return { sent: false, reason: "no_owner_phone" };
  }

  // Cooldown check
  const cooldownKey = `${customerPhone}:${reason}`;
  const lastAlert = alertCooldown.get(cooldownKey);
  if (lastAlert && (Date.now() - lastAlert) < COOLDOWN_MS) {
    return { sent: false, reason: "cooldown" };
  }

  const score = evaluateLeadValue(session);
  
  // Solo alertar si es HIGH o MEDIUM
  if (score.tier === "STANDARD" && reason === "auto") {
    return { sent: false, reason: "standard_lead", score };
  }

  const d = session.data || {};
  const emoji = score.tier === "HIGH" ? "🔴" : "🟡";
  const tierLabel = score.tier === "HIGH" ? "ALTO VALOR" : "VALOR MEDIO";
  
  const alertMsg = [
    `${emoji} LEAD ${tierLabel} ${emoji}`,
    ``,
    `📞 Cliente: ${customerPhone}`,
    d.name ? `👤 Nombre: ${d.name}` : "",
    d.comuna ? `📍 Comuna: ${d.comuna}` : "",
    d.grand_total ? `💰 Cotización: $${Number(d.grand_total).toLocaleString("es-CL")} + IVA` : "",
    `📦 Items: ${(d.items || []).length}`,
    ``,
    `📊 SEÑALES:`,
    ...score.signals.map(s => `  ${s}`),
    ``,
    `🤖 Estado: ${d.stageKey || "diagnostico"}`,
    reason !== "auto" ? `⚡ Motivo: ${reason}` : "",
    ``,
    `👉 Tomar control: ops.activalabs.ai → Conversaciones → TOMAR`,
    `📱 O responde directo al ${customerPhone}`,
  ].filter(Boolean).join("\n");

  try {
    await waSendFn(OWNER_PHONE, alertMsg);
    alertCooldown.set(cooldownKey, Date.now());
    console.log(`[highValueNotifier] Alerta ${tierLabel} enviada para ${customerPhone}`);
    return { sent: true, score, tier: score.tier };
  } catch (e) {
    console.error("[highValueNotifier] Error enviando alerta:", e.message);
    return { sent: false, error: e.message };
  }
}

/**
 * Envía resumen completo cuando se escala a humano
 */
async function notifyHandoff(waSendFn, customerPhone, session, reason) {
  if (!OWNER_PHONE) return { sent: false };

  const summary = generateConversationSummary(session);
  
  const handoffMsg = [
    `🚨 ESCALACIÓN A HUMANO 🚨`,
    ``,
    `📞 Cliente: ${customerPhone}`,
    `⚡ Motivo: ${reason}`,
    ``,
    summary,
    ``,
    `👉 El bot se detuvo. El cliente espera respuesta humana.`,
    `📱 Escríbele directamente al ${customerPhone}`,
  ].join("\n");

  try {
    await waSendFn(OWNER_PHONE, handoffMsg);
    console.log(`[highValueNotifier] Handoff alert enviada para ${customerPhone}`);
    return { sent: true };
  } catch (e) {
    console.error("[highValueNotifier] Error en handoff alert:", e.message);
    return { sent: false, error: e.message };
  }
}

/**
 * Chequeo periódico de conversaciones sin respuesta
 * Llamar desde un setInterval en index.js
 */
function checkStaleHighValue(sessions, waSendFn) {
  const now = Date.now();
  const STALE_MS = 30 * 60 * 1000; // 30 minutos sin respuesta

  for (const [waId, session] of sessions) {
    const d = session.data || {};
    const lastActivity = session.lastActivity || session.updated || 0;
    const timeSince = now - lastActivity;

    // Si lleva más de 30 min sin respuesta y es alto valor
    if (timeSince > STALE_MS && timeSince < STALE_MS * 2) {
      const score = evaluateLeadValue(session);
      if (score.tier === "HIGH") {
        notifyHighValue(waSendFn, waId, session, "⏰ 30 min sin respuesta - lead alto valor");
      }
    }
  }
}

export {
  evaluateLeadValue,
  notifyHighValue,
  notifyHandoff,
  generateConversationSummary,
  checkStaleHighValue,
  HIGH_VALUE_THRESHOLD,
  MEDIUM_VALUE_THRESHOLD,
};
