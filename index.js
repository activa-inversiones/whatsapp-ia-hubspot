// index.js — WhatsApp IA + Zoho Books PDF (Ferrari 9.5.1-prod)
// Railway | Node 18+ | ESM
// ═══════════════════════════════════════════════════════════════════
// CAMBIOS vs 9.4.0 — Fixes producción real (captura WhatsApp):
//
// [P7] FIX CRÍTICO: Loop "¿Desea envíe propuesta Zoho Books?" 
//      → pdfSent se resetea cuando items cambian → permite re-cotizar
// [P8] FIX: Eliminado "Zoho Books" de todos los mensajes al cliente
// [P9] FEAT: Resumen de cotización ANTES de enviar PDF (precios + beneficios)
// [P10] FEAT: Validación de medidas vs límites fabricación WinHouse
//       → S60 máx 1930×1930 | SLIDING máx 2930×2150 | Puerta máx 1970×2400
//       → Si excede S60 pero cabe en SLIDING → sugiere corredera al cliente
//       → Si excede todo → escala al equipo técnico
// [P11] FEAT: Escalación automática vía WhatsApp al equipo técnico
//       → ESCALATION_PHONE env var para recibir alertas
// [P12] FEAT: Cierre post-PDF con oferta visita técnica gratuita
// [P13] FIX: regex wantsPdf ampliado (formal, envía, manda, propuesta)
//
// Riesgos resueltos: loop infinito post-cotización, cotización de 
// ventanas imposibles de fabricar, cliente sin resumen de precios,
// equipo técnico sin visibilidad de escalaciones
// ═══════════════════════════════════════════════════════════════════

import express from "express";
import axios from "axios";
import http from "http";
import https from "https";
import dotenv from "dotenv";
import crypto from "crypto";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { createRequire } from "module";
import fs from "fs";
// @patch:sales-os:imports:start
import {
  pushConversationEvent,
  pushLeadEvent,
  pushQuoteEvent,
  getConversationControl,
  salesOsConfigured,
} from "./services/salesOsBridge.js";
// @patch:sales-os:imports:end
import {
  cotizadorWinhouseConfigured,
  cotizadorWinhouseHealth,
  cotizarWinhouse,
} from "./services/cotizadorWinhouseBridge.js";

dotenv.config();
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

/* =========================
   0) APP
   ========================= */
const app = express();
app.use(
  express.json({
    limit: "25mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

/* =========================
   1) LOGGING (ISO-ready)
   ========================= */
function logErr(ctx, e) {
  const ts = new Date().toISOString();
  if (e?.response) {
    console.error(
      `[${ts}] ❌ ${ctx} [${e.response.status}]: ${JSON.stringify(e.response.data).slice(0, 400)}`
    );
  } else if (e?.request) {
    console.error(`[${ts}] ❌ ${ctx} [NET]: Sin respuesta`);
  } else {
    console.error(`[${ts}] ❌ ${ctx}: ${e?.message || String(e)}`);
  }
}

function logInfo(ctx, msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ℹ️  ${ctx}: ${msg}`);
}

/* =========================
   2) ENV
   ========================= */
const PORT = process.env.PORT || 8080;
const TZ = process.env.TZ || "America/Santiago";

const META = {
  VER: process.env.META_GRAPH_VERSION || "v22.0",
  TOKEN: process.env.WHATSAPP_TOKEN,
  PHONE_ID: process.env.PHONE_NUMBER_ID,
  VERIFY: process.env.VERIFY_TOKEN,
  SECRET: process.env.APP_SECRET || "",
};

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL_OPENAI || "gpt-4o-mini";
const STT_MODEL = process.env.AI_MODEL_STT || "whisper-1";

const PRICER_MODE = (process.env.PRICER_MODE || "winperfil").toLowerCase();
const WINPERFIL_API_BASE = (process.env.WINPERFIL_API_BASE || "").replace(/\/$/, "");
const WINPERFIL_API_KEY = process.env.WINPERFIL_API_KEY || "";
const QUOTE_API_KEY = process.env.QUOTE_API_KEY || "";
const REQUIRE_ZOHO = String(process.env.REQUIRE_ZOHO || "true") === "true";
const ZOHO = {
  CLIENT_ID: process.env.ZOHO_CLIENT_ID,
  CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET,
  REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN,
  API: process.env.ZOHO_API_DOMAIN || "https://www.zohoapis.com",
  BOOKS_API: "https://www.zohoapis.com/books/v3",
  ACCOUNTS: process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.com",
  ORG_ID: process.env.ZOHO_ORG_ID,
  DEAL_PHONE: process.env.ZOHO_DEAL_PHONE_FIELD || "WhatsApp_Phone",
  DEFAULT_ACCT: process.env.ZOHO_DEFAULT_ACCOUNT_NAME || "Clientes WhatsApp IA",
  DEFAULT_ITEM_ID: process.env.ZOHO_DEFAULT_ITEM_ID || "",
  TAX_ID: process.env.ZOHO_TAX_ID || "",
};

const COMPANY = {
  NAME: process.env.COMPANY_NAME || "Activa Inversiones",
  PHONE: process.env.COMPANY_PHONE || "+56 9 1234 5678",
  EMAIL: process.env.COMPANY_EMAIL || "ventas@activa.cl",
  ADDRESS: process.env.COMPANY_ADDRESS || "Temuco, La Araucanía, Chile",
  WEBSITE: process.env.COMPANY_WEBSITE || "www.activa.cl",
  RUT: process.env.COMPANY_RUT || "76.XXX.XXX-X",
};

// @patch:sales-os:config:start
const AGENT_NAME = process.env.AGENT_NAME || "Marcelo Cifuentes";
// [F4] Token unificado — solo SALES_OS_OPERATOR_TOKEN, sin fallback cruzado
const INTERNAL_OPERATOR_TOKEN = process.env.SALES_OS_OPERATOR_TOKEN || "";
// @patch:sales-os:config:end

const STAGES = {
  diagnostico: process.env.ZOHO_STAGE_DIAGNOSTICO || "Diagnóstico y Perfilado",
  siembra: process.env.ZOHO_STAGE_SIEMBRA || "Siembra de Confianza + Marco Normativo",
  propuesta: process.env.ZOHO_STAGE_PROPUESTA || "Presentación de Propuesta",
  objeciones: process.env.ZOHO_STAGE_OBJECIONES || "Incubadora de Objeciones",
  validacion: process.env.ZOHO_STAGE_VALIDACION || "Validación Técnica y Normativa",
  cierre: process.env.ZOHO_STAGE_CIERRE || "Cierre y Negociación",
  ganado: process.env.ZOHO_STAGE_GANADO || "Cerrado ganado",
  perdido: process.env.ZOHO_STAGE_PERDIDO || "Cerrado perdido",
  competencia: process.env.ZOHO_STAGE_COMPETENCIA || "Perdido para la competencia",
};

// Voice / TTS config — controlado por Railway env vars
const VOICE_ENABLED = String(process.env.VOICE_ENABLED || "false") === "true";
const VOICE_SEND_MODE = (process.env.VOICE_SEND_MODE || "audio_if_inbound_audio").toLowerCase();
const VOICE_TTS_PROVIDER = (process.env.VOICE_TTS_PROVIDER || "elevenlabs").toLowerCase();
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "";
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const ELEVENLABS_OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128";
// Legacy TTS bridge (backward compat — not used if VOICE_TTS_PROVIDER=elevenlabs)
const VOICE_TTS_URL = process.env.VOICE_TTS_URL || "";
const VOICE_TTS_TOKEN = process.env.VOICE_TTS_TOKEN || "";
const VOICE_TTS_VOICE_ID = process.env.VOICE_TTS_VOICE_ID || "";

/* =========================
   3) VALIDATION — [F4] validación de formato mejorada
   ========================= */
(function assertEnv() {
  const m = [];
  if (!META.TOKEN) m.push("WHATSAPP_TOKEN");
  if (!META.PHONE_ID) m.push("PHONE_NUMBER_ID");
  if (!META.VERIFY) m.push("VERIFY_TOKEN");
  if (!OPENAI_KEY) m.push("OPENAI_API_KEY");
  if (META.TOKEN && META.TOKEN.length < 20) m.push("WHATSAPP_TOKEN (formato inválido — muy corto)");
  if (OPENAI_KEY && !OPENAI_KEY.startsWith("sk-")) m.push("OPENAI_API_KEY (formato inválido — debe iniciar con sk-)");
  if (PRICER_MODE === "winperfil" && !WINPERFIL_API_BASE) m.push("WINPERFIL_API_BASE");
  if (REQUIRE_ZOHO && (!ZOHO.CLIENT_ID || !ZOHO.REFRESH_TOKEN)) m.push("ZOHO credentials");
  if (REQUIRE_ZOHO && ZOHO.REFRESH_TOKEN && ZOHO.REFRESH_TOKEN.length < 10) m.push("ZOHO_REFRESH_TOKEN (formato inválido)");
  if (m.length) {
    console.error("[FATAL] Faltan o inválidas:", m.join(", "));
    process.exit(1);
  }
})();

const openai = new OpenAI({ apiKey: OPENAI_KEY });

/* =========================
   4) HTTP KEEP-ALIVE
   ========================= */
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 15 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 25 });

const axiosWA = axios.create({
  baseURL: `https://graph.facebook.com/${META.VER}`,
  headers: { Authorization: `Bearer ${META.TOKEN}` },
  httpsAgent,
  timeout: 20000,
});

/* =========================
   5) UTILIDADES
   ========================= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function strip(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function normPhone(raw) {
  const s = String(raw || "").replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("569") && s.length === 11) return `+${s}`;
  if (s.startsWith("56")) return `+${s}`;
  if (s.startsWith("9") && s.length === 9) return `+56${s}`;
  return `+${s}`;
}

function safeJson(x) {
  try {
    return JSON.stringify(x);
  } catch {
    return "{}";
  }
}

// @patch:sales-os:helpers:start
function fireAndForget(label, promise) {
  Promise.resolve(promise).catch((e) => logErr(label, e));
}

function buildLeadPayload(ses, waId) {
  const d = ses.data || emptyData();
  return {
    source: "whatsapp_ai",
    channel: "whatsapp",
    lead_name: d.name || "",
    name: d.name || "",
    phone: normPhone(waId),
    comuna: d.comuna || "",
    city: d.comuna || "",
    project_type: d.project_type || "",
    product_interest: d.items?.[0]?.product || d.supplier || "ventanas",
    windows_qty: d.items?.length
      ? String(d.items.reduce((acc, it) => acc + (Number(it.qty) || 1), 0))
      : "",
    budget: d.grand_total ? String(d.grand_total) : "",
    message: d.notes || buildDesc(d),
    status: ses.pdfSent ? "quoted" : isComplete(d) ? "qualified" : "new",
    zoho_deal_id: ses.zohoDealId || "",
    external_id: waId,
  };
}

function buildQuotePayload(ses, waId, extras = {}) {
  const d = ses.data || emptyData();
  return {
    phone: normPhone(waId),
    channel: "whatsapp",
    customer_name: d.name || "Cliente WhatsApp",
    quote_number: ses.quoteNum || extras.quote_number || null,
    status: extras.status || (ses.pdfSent ? "formal_sent" : "draft"),
    amount_total: d.grand_total || null,
    currency: "CLP",
    zoho_estimate_id: ses.zohoEstimateId || extras.zoho_estimate_id || null,
    zoho_estimate_url: extras.zoho_estimate_url || null,
    lead: buildLeadPayload(ses, waId),
    payload: {
      supplier: d.supplier || "",
      comuna: d.comuna || "",
      items: d.items || [],
      notes: d.notes || "",
    },
  };
}

async function trackConversationEvent(payload) {
  const r = await pushConversationEvent(payload);
  if (!r?.ok && !r?.skipped) {
    throw new Error(r?.error || `conversation_event_failed_${r?.status || "unknown"}`);
  }
}

async function trackLeadEvent(payload) {
  const r = await pushLeadEvent(payload);
  if (!r?.ok && !r?.skipped) {
    throw new Error(r?.error || `lead_event_failed_${r?.status || "unknown"}`);
  }
}

async function trackQuoteEvent(payload) {
  const r = await pushQuoteEvent(payload);
  if (!r?.ok && !r?.skipped) {
    throw new Error(r?.error || `quote_event_failed_${r?.status || "unknown"}`);
  }
}

function validInternalOperatorToken(req) {
  const token = req.get("x-api-key") || req.get("X-API-Key") || "";
  return !!(INTERNAL_OPERATOR_TOKEN && token && token === INTERNAL_OPERATOR_TOKEN);
}
// @patch:sales-os:helpers:end

function sortItemsForCotizador(items = []) {
  return [...items].sort((a, b) => {
    const pa = String(a.product || "");
    const pb = String(b.product || "");
    const ma = normMeasures(a.measures || "");
    const mb = normMeasures(b.measures || "");
    const wa = ma?.ancho_mm || 0;
    const wb = mb?.ancho_mm || 0;
    const ha = ma?.alto_mm || 0;
    const hb = mb?.alto_mm || 0;
    return pa.localeCompare(pb) || ha - hb || wa - wb;
  });
}

function mapQuoteItemToCotizador(item, fallbackColor = "") {
  const m = normMeasures(item.measures || "");
  if (!m) {
    return { unsupported: true, reason: "No pude normalizar medidas para el cotizador.", raw: item };
  }

  const p = String(item.product || "").toUpperCase();
  const color = String(normColor(item.color || fallbackColor || "BLANCO") || "BLANCO").toLowerCase();

  let tipo = "ventana";
  let serie = "S60";
  let apertura = "proyectante";
  let hoja = "98";

  if (p.includes("PUERTA_DOBLE")) {
    return { unsupported: true, reason: "Puerta doble requiere validación manual.", raw: item };
  }

  if (p.includes("PUERTA")) {
    tipo = "puerta";
    serie = "S60";
    apertura = "abatir";
  } else if (p.includes("MARCO_FIJO")) {
    tipo = "ventana";
    serie = "S60";
    apertura = "fijo";
  } else if (p.includes("OSCILO")) {
    tipo = "ventana";
    serie = "S60";
    apertura = "abatir";
  } else if (p.includes("ABAT")) {
    tipo = "ventana";
    serie = "S60";
    apertura = "abatir";
  } else if (p.includes("CORREDERA_98")) {
    tipo = "ventana";
    serie = "SLIDING";
    apertura = "corredera";
    hoja = "98";
  } else if (p.includes("CORREDERA")) {
    tipo = "ventana";
    serie = "SLIDING";
    apertura = "corredera";
    hoja = "98";
  } else if (p.includes("PROYECT")) {
    tipo = "ventana";
    serie = "S60";
    apertura = "proyectante";
  }

  return {
    unsupported: false,
    payload: {
      tipo,
      serie,
      apertura,
      color,
      ancho: m.ancho_mm,
      alto: m.alto_mm,
      cantidad: Math.max(1, Number(item.qty) || 1),
      hoja,
      vidrio: process.env.DEFAULT_GLASS || "DVH 4+12+4 CL",
    },
  };
}

function applyCotizadorResultToSessionItems(sessionItems, apiResult) {
  const resultItems = apiResult?.items || [];
  let total = 0;
  let escaladas = 0;

  for (let i = 0; i < sessionItems.length; i++) {
    const src = resultItems[i];
    if (!src) {
      sessionItems[i].price_warning = "Sin respuesta del cotizador para este ítem.";
      sessionItems[i].source = "cotizador_missing";
      continue;
    }
    if (src.escalado) {
      sessionItems[i].price_warning = src.razon_escalacion || "Requiere validación manual.";
      sessionItems[i].source = "cotizador_manual";
      sessionItems[i].confidence = "manual";
      escaladas++;
      continue;
    }
    const qty = Math.max(1, Number(sessionItems[i].qty) || 1);
    const unit = Number(src.precio_unitario || 0);
    const lineTotal = Number(src.total || 0);
    sessionItems[i].unit_price = unit || (lineTotal > 0 ? Math.round(lineTotal / qty) : 0);
    sessionItems[i].total_price = lineTotal || sessionItems[i].unit_price * qty;
    sessionItems[i].descripcion = src.descripcion || "";
    sessionItems[i].source = "cotizador_winhouse";
    sessionItems[i].confidence = "high";
    if (src.split) {
      sessionItems[i].price_warning = "Ítem dividido automáticamente por regla de fabricación.";
    }
    total += sessionItems[i].total_price;
  }
  return { total, escaladas };
}

/* =========================
   6) ZONAS TÉRMICAS (OGUC) — [F7] ampliado Araucanía
   Fuente: NCh 1079 / OGUC Art. 4.1.10
   NOTA: verificar contra tabla oficial vigente si se agregan más comunas
   ========================= */
const ZONA_COMUNAS = {
  // ── Araucanía — Zona 5 (valle central / depresión intermedia) ──
  temuco: 5,
  "padre las casas": 5,
  lautaro: 5,
  victoria: 5,
  vilcun: 5,
  freire: 5,
  pitrufquen: 5,
  gorbea: 5,
  loncoche: 5,
  tolten: 5,
  "teodoro schmidt": 5,
  saavedra: 5,
  carahue: 5,
  "nueva imperial": 5,
  cholchol: 5,
  galvarino: 5,
  perquenco: 5,
  angol: 5,
  collipulli: 5,
  renaico: 5,
  "los sauces": 5,
  puren: 5,
  ercilla: 5,
  lumaco: 5,
  traiguen: 5,
  // ── Araucanía — Zona 6 (precordillera / lacustre) ──
  cunco: 6,
  villarrica: 6,
  pucon: 6,
  curarrehue: 6,
  melipeuco: 6,
  curacautin: 6,
  // ── Araucanía — Zona 7 (cordillera) ──
  lonquimay: 7,
};

function getZona(raw) {
  if (!raw) return null;
  const c = strip(raw).toLowerCase().trim();
  if (ZONA_COMUNAS[c] !== undefined) return ZONA_COMUNAS[c];
  for (const [name, z] of Object.entries(ZONA_COMUNAS)) {
    if (c.includes(name) || name.includes(c)) return z;
  }
  return null;
}

function zonaInfo(z) {
  if (!z) return { note: "" };
  return { note: `Zona térmica OGUC: Z${z}. Cumplimos OGUC 4.1.10 (acondicionamiento térmico).` };
}

/* ─── [PROD] Validación de medidas vs fabricación WinHouse ─────────
   Límites reales verificados en cotizador-winhouse/src/rules.js
   Si la medida excede el límite → sugiere producto alternativo o escala
   ────────────────────────────────────────────────────────────── */
const FABRICATION_LIMITS = {
  S60: {
    ventana: { minAncho: 400, maxAncho: 1930, minAlto: 400, maxAlto: 1930 },
    puerta:  { minAncho: 800, maxAncho: 1970, minAlto: 1500, maxAlto: 2400 },
  },
  SLIDING: {
    H98: { minAncho: 500, maxAncho: 2930, minAlto: 500, maxAlto: 2150 },
    H80: { minAncho: 500, maxAncho: 3000, minAlto: 500, maxAlto: 2150 },
  },
};

function validateDimensions(product, ancho_mm, alto_mm) {
  const p = String(product || "").toUpperCase();

  // Correderas → SLIDING limits
  if (p.includes("CORREDERA")) {
    const lim = FABRICATION_LIMITS.SLIDING.H98;
    if (ancho_mm > lim.maxAncho || alto_mm > lim.maxAlto) {
      return { message: `Corredera ${ancho_mm}×${alto_mm} excede límite fabricación (máx ${lim.maxAncho}×${lim.maxAlto}).`, escalate: true };
    }
    return null; // OK
  }

  // Puertas → S60 puerta limits
  if (p.includes("PUERTA")) {
    const lim = FABRICATION_LIMITS.S60.puerta;
    if (ancho_mm > lim.maxAncho || alto_mm > lim.maxAlto) {
      return { message: `Puerta ${ancho_mm}×${alto_mm} excede límite (máx ${lim.maxAncho}×${lim.maxAlto}).`, escalate: true };
    }
    return null;
  }

  // Todas las demás (proyectante, abatible, oscilobatiente, fijo) → S60 ventana limits
  const lim = FABRICATION_LIMITS.S60.ventana;
  if (ancho_mm > lim.maxAncho || alto_mm > lim.maxAlto) {
    // Si cabe en SLIDING → sugerir corredera
    const slidingLim = FABRICATION_LIMITS.SLIDING.H98;
    if (ancho_mm <= slidingLim.maxAncho && alto_mm <= slidingLim.maxAlto) {
      return {
        message: `Medida ${ancho_mm}×${alto_mm} excede límite S60 (máx ${lim.maxAncho}×${lim.maxAlto}). Sugerencia: ventana corredera.`,
        suggest: "CORREDERA",
        escalate: false,
      };
    }
    return { message: `Medida ${ancho_mm}×${alto_mm} excede todos los límites de fabricación.`, escalate: true };
  }
  return null; // OK
}

/* ─── [PROD] Escalación — notificar al equipo técnico ─────────────
   Envía alerta por WhatsApp al número del equipo cuando:
   - Medidas fuera de rango de fabricación
   - Items requieren validación manual
   - Cliente pide algo que el bot no puede resolver
   ────────────────────────────────────────────────────────────── */
const ESCALATION_PHONE = process.env.ESCALATION_PHONE || "";
const ESCALATION_EMAIL = process.env.ESCALATION_EMAIL || "";
// ═══════════════════════════════════════════════════════════════════
// [ADMIN] OLIVER MODE — Control remoto + Cubicación Automática
// ═══════════════════════════════════════════════════════════════════
const ADMIN_PHONE = process.env.ADMIN_PHONE || "+56957296035";
const ADMIN_PIN = process.env.ADMIN_PIN || "1976";

// Normalizar el waId para comparación
function normalizeWaId(waId) {
  return String(waId || "").replace(/[^\d]/g, "");
}

function normalizeAdminPhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

// Map de cubicaciones pendientes por entrega automática en 60s
const cubicacionPendientes = new Map(); // { waId: { items, timestamp, tries } }

function adminCheckAuth(phone, pin) {
  const phoneNorm = normalizeWaId(phone);
  const adminNorm = normalizeAdminPhone(ADMIN_PHONE);
  return phoneNorm === adminNorm && pin === ADMIN_PIN;
}

// Parser minimalista de comandos admin
function parseAdminCmd(text) {
  const s = String(text || "").trim().toUpperCase();
  
  // OLIVER IN 1976 | OLIVER OFF 1976
  if (/^OLIVER\s+(IN|ON)\s+(\d+)/.test(s)) {
    const m = s.match(/^OLIVER\s+(IN|ON)\s+(\d+)/);
    return { type: "admin_in", pin: m[2] };
  }
  if (/^OLIVER\s+OFF\s+(\d+)/.test(s)) {
    const m = s.match(/^OLIVER\s+OFF\s+(\d+)/);
    return { type: "admin_off", pin: m[1] };
  }
  if (s === "ADMIN STATUS") return { type: "admin_status" };
  if (s === "ADMIN LAST CUBICACION") return { type: "admin_last_cubi" };
  if (s === "ADMIN FORCE PDF") return { type: "admin_force_pdf" };
  
  return null;
}

// Dispatcher de cubicación pendiente — revisar cada 15s, enviar a los 60s
setInterval(() => {
  const now = Date.now();
  for (const [waId, pending] of cubicacionPendientes) {
    if (now - pending.timestamp >= 60_000) {
      fireAndForget(
        "cubicacion_dispatcher",
        (async () => {
          const ses = getSession(waId);
          const d = ses.data;
          try {
            // Intentar cotizar
            const priced = await priceAll(d, waId);
            if (!priced.ok && !priced.partial) {
              await waSendH(waId, `❌ No pude cotizar: ${priced.error}`, true);
              cubicacionPendientes.delete(waId);
              return;
            }
            
            // Crear Estimate en Zoho Books
            const estimate = await zhBooksCreateEstimate(d, d.name || "Cliente", normPhone(waId));
            if (estimate?.estimate_id) {
              try {
                const pdfBuf = await zhBooksDownloadEstimatePdf(estimate.estimate_id);
                ses.zohoEstimateId = estimate.estimate_id;
                ses.pdfSent = true;
                d.stageKey = "propuesta";
                
                // Enviar PDF
                await waSendPdf(waId, pdfBuf, `COT-${Date.now()}.pdf`, 
                  `✅ Propuesta lista. Si quiere ajustar algo, me avisa.`);
                
                // Mensaje post-PDF
                await waSendH(waId, 
                  `Se adjunta Propuesta Técnico Comercial con presupuesto y especificaciones.\n\nConfort térmico y acústico garantizado.\n\n¿Desea una visita técnica gratuita?`, 
                  true
                );
                
                logInfo("cubicacion_dispatcher", `PDF automático enviado a ${waId}`);
              } catch (pdfErr) {
                logErr("cubicacion_dispatcher.pdf", pdfErr);
              }
            }
            
            cubicacionPendientes.delete(waId);
            saveSession(waId, ses);
          } catch (e) {
            logErr("cubicacion_dispatcher", e);
            pending.tries = (pending.tries || 0) + 1;
            if (pending.tries >= 3) {
              cubicacionPendientes.delete(waId);
            }
          }
        })()
      );
    }
  }
}, 15_000);

async function sendEscalationAlert(reason, customerPhone, sessionData) {
  const d = sessionData || {};
  const itemsSummary = (d.items || []).map((it, i) =>
    `${i + 1}. ${it.qty || 1}× ${it.product} ${it.measures} ${it.color || d.default_color || ""} ${it.dim_warning || ""}`
  ).join("\n");

  const alertMsg = `⚠️ ESCALACIÓN — ${reason}\n\nCliente: ${d.name || "Sin nombre"}\nTeléfono: ${customerPhone}\nComuna: ${d.comuna || "?"}\n\nItems:\n${itemsSummary}\n\nMotivo: ${reason}\n\nResponder desde Sales OS → ops.activalabs.ai`;

  // Enviar al teléfono de escalación via WhatsApp
  if (ESCALATION_PHONE) {
    try {
      await waSend(ESCALATION_PHONE, alertMsg);
      logInfo("escalation", `Alerta enviada a ${ESCALATION_PHONE}: ${reason}`);
    } catch (e) {
      logErr("escalation.whatsapp", e);
    }
  }

  logInfo("escalation", `ESCALACIÓN: ${reason} | cliente=${customerPhone}`);
}

/* =========================
   7) CATÁLOGO
   ========================= */
const ALLOWED_SUPPLIERS = ["WINHOUSE_PVC", "SODAL_ALUMINIO"];

function detectSupplier(text) {
  const s = strip(text).toLowerCase();
  if (/\baluminio\b|sodal|muro cortina/.test(s)) return "SODAL_ALUMINIO";
  return "WINHOUSE_PVC";
}

function normProduct(raw = "") {
  const s = strip(raw).toUpperCase();
  if (s.includes("PUERTA") && /DOBLE|2\s*HOJ|DOS\s*HOJ/.test(s)) return "PUERTA_DOBLE";
  if (s.includes("PUERTA")) return "PUERTA_1H";
  if (s.includes("PROYEC")) return "PROYECTANTE";
  if (/MARCO|FIJO|PA[NÑ]O/.test(s)) return "MARCO_FIJO";
  if (s.includes("OSCILO")) return "OSCILOBATIENTE";
  if (s.includes("ABAT")) return "ABATIBLE";
  if (s.includes("CORREDERA") && s.includes("98")) return "CORREDERA_98";
  if (s.includes("CORREDERA") || s.includes("VENTANA")) return "CORREDERA";
  return "CORREDERA";
}

/* ─── [F2] normMeasures corregido ─────────────────────────────────
   ANTES: "3 ventanas 1500x1200" → extraía [3, 1500] → 3000×1500 ✗
   AHORA: busca patrón NxN primero → extrae 1500×1200 ✓
   Si no hay NxN, toma los dos mayores números (ignora cantidades)
   ────────────────────────────────────────────────────────────── */
function normMeasures(raw) {
  const s = String(raw || "");

  // 1) Patrón explícito: "1500x1200", "1.5 x 1.2", "150×120", "1500 por 1200"
  const dimMatch = s.match(
    /(\d+([.,]\d+)?)\s*[x×X]\s*(\d+([.,]\d+)?)/
  ) || s.match(
    /(\d+([.,]\d+)?)\s+por\s+(\d+([.,]\d+)?)/i
  );

  if (dimMatch) {
    let a = parseFloat(dimMatch[1].replace(",", "."));
    let b = parseFloat(dimMatch[3].replace(",", "."));
    if (a <= 6) a *= 1000;
    if (b <= 6) b *= 1000;
    if (a >= 7 && a <= 300) a *= 10;
    if (b >= 7 && b <= 300) b *= 10;
    return { ancho_mm: Math.round(a), alto_mm: Math.round(b) };
  }

  // 2) Fallback: extraer todos los números, filtrar cantidades pequeñas
  const nums = s.match(/(\d+([.,]\d+)?)/g);
  if (!nums || nums.length < 2) return null;

  const allNums = nums.map((n) => parseFloat(n.replace(",", ".")));

  // Filtrar: enteros ≤ 20 probablemente son cantidades, no medidas
  // EXCEPTO si son decimales (ej: 1.5 = metros)
  const candidates = allNums.filter((n) => {
    if (n > 20) return true;                    // claramente medida
    if (!Number.isInteger(n) && n > 0) return true; // decimal = metros
    return false;
  });

  if (candidates.length < 2) {
    // Si no hay suficientes candidatos, tomar los 2 más grandes
    const sorted = [...allNums].sort((a, b) => b - a);
    if (sorted.length < 2) return null;
    candidates.length = 0;
    candidates.push(sorted[0], sorted[1]);
  }

  let a = candidates[0];
  let b = candidates[1];
  if (a <= 6) a *= 1000;
  if (b <= 6) b *= 1000;
  if (a >= 7 && a <= 300) a *= 10;
  if (b >= 7 && b <= 300) b *= 10;
  return { ancho_mm: Math.round(a), alto_mm: Math.round(b) };
}

/* ─── [F5] normColor — solo 5 colores stock WinHouse ──────────────
   CATÁLOGO REAL: BLANCO | NOGAL | ROBLE | GRAFITO | NEWBLACK
   Mapeo coloquial chileno → color más cercano en catálogo
   ANTES: retornaba "GRIS" que NO existe → rompía cotización
   ────────────────────────────────────────────────────────────── */
function normColor(text = "") {
  const s = strip(text).toUpperCase();

  // NOGAL — todo lo que suene a "madera" oscura
  if (/NOGAL|MADERA|CASTANO|RAULI|CEREZO|CAOBA|CAFE|MARRON|CHOCOLATE|TABACO|WENGUE|ALERCE/.test(s))
    return "NOGAL";

  // ROBLE — tonos madera clara / dorada
  if (/ROBLE|DORADO|MIEL|HAYA|PINO|CLARO/.test(s))
    return "ROBLE";

  // GRAFITO — todo lo que suene a gris (GRIS no es stock)
  if (/GRAFITO|ANTRAC|GRIS|PLOMO|CENIZA|HUMO|TITANIO|ANODIZ/.test(s))
    return "GRAFITO";

  // NEWBLACK — negro y variantes oscuras
  if (/NEGR|BLACK|OSCUR|CARBON|EBANO/.test(s))
    return "NEWBLACK";

  // DEFAULT → BLANCO (blanco, crema, marfil, sin color)
  return "BLANCO";
}

/* =========================
   8) MOTOR DE PRECIOS
   ========================= */
async function quoteByWinperfil(payload) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (WINPERFIL_API_KEY) headers["X-API-Key"] = WINPERFIL_API_KEY;
    const { data } = await axios.post(`${WINPERFIL_API_BASE}/quote`, payload, {
      headers,
      timeout: 30000,
      httpAgent,
      httpsAgent,
    });
    return data;
  } catch (e) {
    logErr("quoteByWinperfil", e);
    return { ok: false, error: "No pude conectar con Winperfil (bridge/túnel)" };
  }
}

/* =========================
   9) WHATSAPP API
   ========================= */
async function waTyping(to) {
  try {
    await axiosWA.post(`/${META.PHONE_ID}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      typing_indicator: { type: "text" },
    });
  } catch {}
}

function startTypingLoop(to, ms = 8000) {
  let on = true;
  const t = async () => {
    if (on) await waTyping(to);
  };
  t();
  const id = setInterval(t, ms);
  return () => {
    on = false;
    clearInterval(id);
  };
}

/* ─── [PROD] Smart WhatsApp Message Split ─────────────────────────
   Divide respuestas largas en burbujas de WhatsApp legibles.
   Máx ~300 chars por burbuja (2-3 líneas en móvil).
   Prioridad: párrafos > oraciones > largo forzado.
   ────────────────────────────────────────────────────────────── */
const WA_MAX_BUBBLE_CHARS = 320;

function smartSplitForWhatsApp(text) {
  if (!text || text.length <= WA_MAX_BUBBLE_CHARS) return [text];

  // 1) Split por párrafos (doble newline)
  const paragraphs = text.split(/\n\n+/).filter(Boolean);
  if (paragraphs.length > 1) {
    // Re-merge paragraphs that are too short
    const merged = [];
    let current = "";
    for (const p of paragraphs) {
      if (current && (current.length + p.length + 2) > WA_MAX_BUBBLE_CHARS) {
        merged.push(current.trim());
        current = p;
      } else {
        current = current ? current + "\n\n" + p : p;
      }
    }
    if (current.trim()) merged.push(current.trim());
    if (merged.length > 1) return merged;
  }

  // 2) Split por oraciones
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g);
  if (sentences && sentences.length > 1) {
    const result = [];
    let current = "";
    for (const s of sentences) {
      if (current && (current.length + s.length) > WA_MAX_BUBBLE_CHARS) {
        result.push(current.trim());
        current = s;
      } else {
        current += s;
      }
    }
    if (current.trim()) result.push(current.trim());
    if (result.length > 1) return result;
  }

  // 3) Split por salto de línea simple
  const lines = text.split(/\n/).filter(Boolean);
  if (lines.length > 1) {
    const result = [];
    let current = "";
    for (const l of lines) {
      if (current && (current.length + l.length + 1) > WA_MAX_BUBBLE_CHARS) {
        result.push(current.trim());
        current = l;
      } else {
        current = current ? current + "\n" + l : l;
      }
    }
    if (current.trim()) result.push(current.trim());
    return result;
  }

  // 4) Fallback: cortar en el último espacio antes del límite
  const result = [];
  let remaining = text;
  while (remaining.length > WA_MAX_BUBBLE_CHARS) {
    let cut = remaining.lastIndexOf(" ", WA_MAX_BUBBLE_CHARS);
    if (cut < 100) cut = WA_MAX_BUBBLE_CHARS;
    result.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining.trim()) result.push(remaining.trim());
  return result;
}

function humanMs(text) {
  const w = String(text || "")
    .trim()
    .split(/\s+/).length;
  return Math.round((1200 + Math.min(6500, w * 170)) * (0.85 + Math.random() * 0.35));
}

async function waSend(to, body) {
  try {
    await axiosWA.post(`/${META.PHONE_ID}/messages`, {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    });
  } catch (e) {
    logErr("waSend", e);
  }
}

// @patch:sales-os:send:start
async function waSendH(to, text, skipTyping = false, meta = {}) {
  const stop = skipTyping ? null : startTypingLoop(to);
  try {
    await sleep(humanMs(text));
    await waSend(to, text);
    if (meta.track !== false) {
      fireAndForget(
        "trackConversationEvent.outbound",
        trackConversationEvent({
          channel: "whatsapp",
          external_id: to,
          customer_name: meta.customer_name || "",
          direction: "outbound",
          actor_type: meta.actor_type || "assistant",
          actor_name: meta.actor_name || AGENT_NAME,
          message_type: meta.message_type || "text",
          body: text,
          metadata: meta.metadata || { source: "whatsapp_ia" },
          quote_status: meta.quote_status,
          unread_count: 0,
        })
      );
    }
  } finally {
    stop?.();
  }
}

async function waSendMultiH(to, msgs, skipTyping = false, meta = {}) {
  const stop = skipTyping ? null : startTypingLoop(to);
  try {
    for (const m of msgs) {
      if (!m?.trim()) continue;
      await sleep(humanMs(m));
      await waSend(to, m);
      if (meta.track !== false) {
        fireAndForget(
          "trackConversationEvent.outbound_multi",
          trackConversationEvent({
            channel: "whatsapp",
            external_id: to,
            customer_name: meta.customer_name || "",
            direction: "outbound",
            actor_type: meta.actor_type || "assistant",
            actor_name: meta.actor_name || AGENT_NAME,
            message_type: meta.message_type || "text",
            body: m,
            metadata: meta.metadata || { source: "whatsapp_ia" },
            quote_status: meta.quote_status,
            unread_count: 0,
          })
        );
      }
      await sleep(250 + Math.random() * 450);
    }
  } finally {
    stop?.();
  }
}
// @patch:sales-os:send:end

/* =========================
   9b) VOICE / TTS — ElevenLabs
   ========================= */

const TTS_MAX_CHARS = 1000; // Limitar input a TTS para evitar costos/timeouts

function sanitizeForTts(text) {
  return String(text || "")
    .replace(/[<>]/g, "")                       // strip angle brackets (elimina cualquier tag o patrón similar)
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, "$1") // strip markdown bold/italic
    .replace(/_([^_\n]+)_/g, "$1")              // strip italic _text_
    .replace(/`[^`\n]*`/g, "")                  // strip inline code
    .replace(/#{1,6}\s+/g, "")                  // strip markdown headers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")   // strip links → solo texto ancla
    .replace(/[^\S\n]+/g, " ")                  // colapsar espacios horizontales
    .replace(/\n{3,}/g, "\n\n")                 // máx 2 newlines consecutivos
    .trim()
    .slice(0, TTS_MAX_CHARS);
}

function shouldSendVoice(incomingType) {
  if (!VOICE_ENABLED) return false;
  if (VOICE_TTS_PROVIDER !== "elevenlabs") return false;
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) return false;
  const mode = VOICE_SEND_MODE;
  if (mode === "text") return false;
  if (mode === "audio" || mode === "both") return true;
  // audio_if_inbound_audio (default seguro)
  return String(incomingType || "") === "audio";
}

function elevenLabsMimeInfo() {
  const f = (ELEVENLABS_OUTPUT_FORMAT || "").toLowerCase();
  if (f.startsWith("mp3")) return { mime: "audio/mpeg", ext: "mp3" };
  if (f.startsWith("ogg") || f.startsWith("opus")) return { mime: "audio/ogg; codecs=opus", ext: "ogg" };
  return { mime: "audio/mpeg", ext: "mp3" }; // fallback seguro
}

async function ttsElevenlabs(text) {
  const clean = sanitizeForTts(text);
  if (!clean) throw new Error("ttsElevenlabs: texto vacío tras sanitizar");
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(ELEVENLABS_VOICE_ID)}?output_format=${encodeURIComponent(ELEVENLABS_OUTPUT_FORMAT)}`;
  const { data } = await axios.post(
    url,
    { text: clean, model_id: ELEVENLABS_MODEL_ID },
    {
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "*/*",
      },
      responseType: "arraybuffer",
      timeout: 30000,
      httpsAgent,
    }
  );
  return Buffer.from(data);
}

async function waUploadAudio(audioBuffer, mimeType, filename) {
  const FormData = (await import("form-data")).default;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "audio");
  form.append("file", audioBuffer, { filename, contentType: mimeType });
  const resp = await axiosWA.post(`/${META.PHONE_ID}/media`, form, {
    headers: form.getHeaders(),
    timeout: 30000,
  });
  const mediaId = resp.data?.id;
  if (!mediaId) throw new Error("waUploadAudio: no se obtuvo media ID de WhatsApp");
  return mediaId;
}

async function waSendAudio(to, mediaId) {
  await axiosWA.post(`/${META.PHONE_ID}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: "audio",
    audio: { id: mediaId },
  });
}

// Envío inteligente: texto, audio o ambos según VOICE_SEND_MODE
async function waSendSmartH(to, text, skipTyping = false, meta = {}) {
  const incomingType = meta.incomingType || "text";
  const sendVoice = shouldSendVoice(incomingType);
  const mode = VOICE_SEND_MODE;

  // Enviar texto siempre, excepto si el modo es "audio" (solo audio)
  if (!sendVoice || mode !== "audio") {
    await waSendH(to, text, skipTyping, meta);
  }

  if (sendVoice) {
    try {
      const { mime, ext } = elevenLabsMimeInfo();
      const audioBuf = await ttsElevenlabs(text);
      const mediaId = await waUploadAudio(audioBuf, mime, `reply_${Date.now()}.${ext}`);
      await waSendAudio(to, mediaId);
      logInfo("TTS", `audio enviado modo=${mode} provider=elevenlabs to=${to}`);
    } catch (e) {
      logErr("TTS", e);
      // Fallback: si el modo era "audio" y falló TTS, enviar texto
      if (mode === "audio") {
        await waSendH(to, text, skipTyping, meta);
      }
    }
  }
}

// Envío inteligente multi-burbuja: texto + un solo audio TTS con texto combinado
async function waSendSmartMultiH(to, msgs, skipTyping = false, meta = {}) {
  const incomingType = meta.incomingType || "text";
  const sendVoice = shouldSendVoice(incomingType);
  const mode = VOICE_SEND_MODE;

  // Enviar burbujas de texto siempre, excepto si el modo es "audio"
  if (!sendVoice || mode !== "audio") {
    await waSendMultiH(to, msgs, skipTyping, meta);
  }

  if (sendVoice) {
    const combined = msgs.filter(Boolean).join(". ");
    try {
      const { mime, ext } = elevenLabsMimeInfo();
      const audioBuf = await ttsElevenlabs(combined);
      const mediaId = await waUploadAudio(audioBuf, mime, `reply_${Date.now()}.${ext}`);
      await waSendAudio(to, mediaId);
      logInfo("TTS", `audio multi enviado modo=${mode} provider=elevenlabs to=${to}`);
    } catch (e) {
      logErr("TTS", e);
      // Fallback: si el modo era "audio" y falló TTS, enviar texto
      if (mode === "audio") {
        await waSendMultiH(to, msgs, skipTyping, meta);
      }
    }
  }
}

async function waRead(id) {
  try {
    await axiosWA.post(`/${META.PHONE_ID}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: id,
    });
  } catch {}
}

async function waMediaUrl(id) {
  const { data } = await axiosWA.get(`/${id}`);
  return data;
}

async function waDownload(url) {
  const { data, headers } = await axios.get(url, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${META.TOKEN}` },
    httpsAgent,
    timeout: 30000,
  });
  return {
    buffer: Buffer.from(data),
    mime: headers["content-type"] || "application/octet-stream",
  };
}

function verifySig(req) {
  if (!META.SECRET) return true;
  const sig = req.get("X-Hub-Signature-256") || req.get("x-hub-signature-256");
  if (!sig || !req.rawBody) return false;
  const exp =
    "sha256=" + crypto.createHmac("sha256", META.SECRET).update(req.rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp));
  } catch {
    return false;
  }
}

/* =========================
   10) MEDIA — [F9] pdfParse con timeout
   ========================= */
async function stt(buf, mime) {
  try {
    const file = await toFile(buf, "audio.ogg", { type: mime });
    const r = await openai.audio.transcriptions.create({
      model: STT_MODEL,
      file,
      language: "es",
    });
    return (r.text || "").trim();
  } catch (e) {
    logErr("STT", e);
    return "";
  }
}

async function vision(buf, mime) {
  try {
    const b64 = buf.toString("base64");
    const r = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analiza esta imagen y extrae TODOS los productos de ventanas/puertas.\nPara CADA uno indica: tipo, medidas, cantidad, color.",
            },
            {
              type: "image_url",
              image_url: { url: `data:${mime};base64,${b64}` },
            },
          ],
        },
      ],
      max_tokens: 900,
    });
    return (r.choices?.[0]?.message?.content || "").trim();
  } catch (e) {
    logErr("Vision", e);
    return "";
  }
}

// [F9] timeout wrapper para pdfParse — evita CPU hang con PDFs maliciosos
const PDF_PARSE_TIMEOUT_MS = 15000;

async function readPdf(buf) {
  try {
    const result = await Promise.race([
      pdfParse(buf),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("pdfParse timeout")), PDF_PARSE_TIMEOUT_MS)
      ),
    ]);
    const t = (result?.text || "").trim();
    return t.length > 6000 ? t.slice(0, 6000) + "…" : t;
  } catch (e) {
    logErr("readPdf", e);
    return "";
  }
}

/* =========================
   11) SESIONES
   ========================= */
const sessions = new Map();
const SESSION_TTL = 6 * 3_600_000;
const MAX_HIST = 30;

function emptyData() {
  return {
    name: "",
    comuna: "",
    address: "",
    project_type: "",
    install: "",
    default_color: "",
    zona_termica: null,
    supplier: "WINHOUSE_PVC",
    profile: "",
    stageKey: "diagnostico",
    wants_pdf: false,
    notes: "",
    items: [],
    grand_total: null,
  };
}

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      lastAt: Date.now(),
      data: emptyData(),
      history: [],
      pdfSent: false,
      quoteNum: null,
      zohoDealId: null,
      zohoEstimateId: null,
      perfilAcumulado: { tecnico: 0, emocional: 0 },
      followupEnviado: false,
    });
  }
  return sessions.get(waId);
}

function saveSession(waId, s) {
  s.lastAt = Date.now();
  s.lastActivity = Date.now();
  if (s.history.length > MAX_HIST) s.history = s.history.slice(-MAX_HIST);
  sessions.set(waId, s);
}

// Cleanup de sesiones expiradas
setInterval(() => {
  const cut = Date.now() - SESSION_TTL;
  for (const [id, s] of sessions) {
    if ((s.lastAt || 0) < cut) sessions.delete(id);
  }
}, 3_600_000);

/* =========================
   12) DEDUP + RATE + LOCK — [F1] cleanup para seen y rateM
   ========================= */
const seen = new Map();
function isDup(id) {
  if (!id) return false;
  if (seen.has(id)) return true;
  seen.set(id, Date.now());
  return false;
}

const rateM = new Map();
function rateOk(waId) {
  const now = Date.now();
  if (!rateM.has(waId)) rateM.set(waId, { n: 0, r: now + 60_000 });
  const r = rateM.get(waId);
  if (now >= r.r) {
    r.n = 0;
    r.r = now + 60_000;
  }
  r.n++;
  return r.n > 18 ? { ok: false, msg: "Escribes muy rápido 😅 Dame 10 seg." } : { ok: true };
}

// [F1] Cleanup interval — purga seen (>2min) y rateM (>5min) cada 5 minutos
// Resuelve memory leak: sin esto, seen crece ~500/día = 15.000/mes sin purge
const SEEN_TTL = 2 * 60_000;    // 2 min
const RATE_TTL = 5 * 60_000;    // 5 min
const CLEANUP_INTERVAL = 5 * 60_000; // cada 5 min

setInterval(() => {
  const now = Date.now();
  let seenPurged = 0;
  let ratePurged = 0;
  for (const [id, ts] of seen) {
    if (now - ts > SEEN_TTL) { seen.delete(id); seenPurged++; }
  }
  for (const [id, r] of rateM) {
    if (now - r.r > RATE_TTL) { rateM.delete(id); ratePurged++; }
  }
  if (seenPurged || ratePurged) {
    logInfo("cleanup", `Purged seen=${seenPurged} rate=${ratePurged} | seen.size=${seen.size} rate.size=${rateM.size}`);
  }
}, CLEANUP_INTERVAL);

const locks = new Map();
async function acquireLock(waId) {
  const prev = locks.get(waId) || Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  locks.set(waId, next);
  await prev;
  return () => {
    release();
    if (locks.get(waId) === next) locks.delete(waId);
  };
}

/* =========================
   13) EXTRACT MESSAGE
   ========================= */
function extractMsg(body) {
  const val = body?.entry?.[0]?.changes?.[0]?.value;
  if (val?.statuses?.length) return { ok: false };
  const msg = val?.messages?.[0];
  if (!msg) return { ok: false };
  const type = msg.type;
  let text = "";
  if (type === "text") text = msg.text?.body || "";
  else if (type === "button") text = msg.button?.text || "";
  else if (type === "interactive") text = safeJson(msg.interactive || {});
  else text = `[${type}]`;
  return {
    ok: true,
    waId: msg.from,
    msgId: msg.id,
    type,
    text,
    audioId: msg.audio?.id || null,
    imageId: msg.image?.id || null,
    docId: msg.document?.id || null,
    docMime: msg.document?.mime_type || null,
  };
}

/* =========================
   14) BUSINESS HELPERS
   ========================= */
function nextMissing(d) {
  if (!d.items.length) return "productos (tipo, medidas y cantidad)";
  const noP = d.items.some((i) => !i.product);
  const noM = d.items.some((i) => !i.measures);
  if (noP || noM) return "completar datos de algunos items";
  if (!d.default_color && d.items.some((i) => !i.color)) return "color";
  if (!d.comuna && !d.address) return "comuna";
  return "";
}

function isComplete(d) {
  if (!d.items.length) return false;
  const hasColor = d.default_color || d.items.every((i) => i.color);
  const hasLoc = d.comuna || d.address;
  const allItems = d.items.every((i) => i.product && i.measures);
  return !!(hasColor && hasLoc && allItems);
}

function canQuote(d) {
  if (!d.items.length) return false;
  const hasColor = d.default_color || d.items.every((i) => i.color);
  return d.items.every((i) => i.product && i.measures) && hasColor;
}

/* =========================
   15) SYSTEM PROMPT — Ferrari 9.3.2 EJECUTIVO
   ========================= */
const SYSTEM_PROMPT = `
Eres MARCELO CIFUENTES, asesor de ventanas y puertas de ${COMPANY.NAME} (${COMPANY.ADDRESS}).
8 años en la Araucanía vendiendo PVC y aluminio. Hablas por WhatsApp.

═══ REGLA #1 — MENSAJES CORTOS ═══
MÁXIMO 2-3 líneas por mensaje. Esto es WhatsApp, NO un email.
Si necesitas decir más, el sistema enviará mensajes separados.
NUNCA hagas listas con guiones ni viñetas. Habla como persona.
NUNCA mandes un párrafo largo. Si pasa de 3 líneas, CORTA.

═══ TONO Y LENGUAJE ═══
Tratas de "usted" siempre. Eres cercano pero respetuoso.
Hablas como un profesional chileno real, no como catálogo.
Ejemplos de cómo SÍ hablar:
  "Hola, buenas tardes. ¿En qué le puedo ayudar con sus ventanas?"
  "Perfecto, ¿me cuenta qué problema tiene hoy? ¿Entra frío, ruido?"
  "Con esas medidas le puedo armar una propuesta altiro."
  "Le va a quedar espectacular, ese color queda muy bien en madera."
Ejemplos de cómo NO hablar:
  "Le ofrecemos soluciones integrales de fenestración con perfiles europeos certificados..."
  "Nuestro sistema cuenta con 4 cámaras de aislación térmica y burletes TPE termofusionados..."
  "A continuación le detallo las características técnicas..."

═══ FLUJO DE CONVERSACIÓN ═══
1. SALUDO: Breve, cálido. Pregunta qué necesita.
2. DIAGNÓSTICO: ¿Qué le molesta? ¿Frío, ruido, estética, proyecto nuevo?
   Haz UNA pregunta a la vez. Espera respuesta.
3. SOLUCIÓN: Recomienda 1-2 productos. Lenguaje simple.
4. DATOS: Cuando ya hay confianza, pide medidas + color + comuna.
   Puedes pedir varios datos juntos si el cliente está enganchado.
5. COTIZACIÓN: Cuando tengas todo → llama update_quote.
   NUNCA le digas el precio al cliente en el chat. El precio va SOLO en la propuesta PDF.
   En vez de precio, destaca ventajas: durabilidad, aislación, garantía, diseño.
6. OBJECIONES: Responde breve y directo:
   "caro" → "WinHouse dura 15 años, el PVC barato 6-8. Sale más económico a la larga."
   "lo pienso" → "¿Qué dato le falta para sentirse seguro?"
   "vi más barato" → "¿Qué marca era? Le explico la diferencia."
   "quiero ver" → "Hacemos visita técnica gratis, sin compromiso. ¿Le viene esta semana?"
7. CIERRE: Visita gratuita + agenda instalación.

═══ REGLA CRÍTICA — TIPOS DE PRODUCTO EN update_quote ═══
Cuando llames update_quote, usa EXACTAMENTE estos códigos en "product":
  Si el cliente dice "corredera" o "sliding" → product: "CORREDERA"
  Si dice "proyectante" → product: "PROYECTANTE"
  Si dice "abatible" o "de abrir" → product: "ABATIBLE"
  Si dice "fijo" o "paño fijo" → product: "MARCO_FIJO"
  Si dice "puerta" → product: "PUERTA_1H"
  Si dice "oscilobatiente" → product: "OSCILOBATIENTE"
  Si NO especifica tipo → product: "CORREDERA" (es lo más común en Chile)
NO MEZCLES: si el cliente pide "2 correderas", NO las pongas como PROYECTANTE.
Si el cliente modifica items, envía la lista COMPLETA actualizada con TODOS los items.

═══ REGLA CRÍTICA — LENGUAJE AL CLIENTE ═══
NUNCA digas "S60", "Sliding", "S75", "Andes", "Zenia" al cliente.
Siempre di "PVC línea europea" o "ventana de PVC".
Ejemplo correcto: "Le cotizo 2 ventanas correderas de PVC línea europea en roble."
Ejemplo INCORRECTO: "Le cotizo 2 ventanas Sliding S75 en roble."

NUNCA menciones precios en el chat. NUNCA digas "$547.000" ni ningún número de precio.
Los precios van SOLO en la propuesta formal PDF.
En vez de precio, di las ventajas: "Son PVC línea europea, con termopanel DVH, aislación térmica y acústica, garantía de fábrica, y colores que no se descascaran."

═══ PERFIL DEL CLIENTE (interno, JAMÁS decirle al cliente) ═══
TÉCNICO: menciona Uw, OGUC, DVH, normas, certificaciones → dale datos duros pero en lenguaje breve.
EMOCIONAL: menciona frío, ruido, familia, diseño → habla de resultados en su vida.
MIXTO: beneficio primero, dato técnico después.
Si no sabes el perfil, pregunta: "¿Le preocupa más el tema técnico-normativo o el confort de su hogar?"

═══ PRODUCTOS (info interna, NO usar nombres técnicos con el cliente) ═══
Proyectantes/abatibles: Para frío extremo. 4 cámaras, perfil 60mm, termopanel DVH. Certificadas. Máx 1930×1930mm.
Correderas: Alto desempeño. 2 cámaras, doble/triple riel. Para ventanas grandes hasta 2930×2150mm.
Si el cliente pide medida > 1930mm en proyectante → sugerir corredera.
COLORES STOCK: Blanco, Nogal, Roble, Grafito, New Black (laminados Renolit).
VIDRIO: Termopanel DVH estándar en todas las líneas.
"Softline 82" NO EXISTE. No inventes especificaciones.

═══ SINÓNIMOS DE COLOR (mapea al real) ═══
madera/castaño/café/cerezo → NOGAL | dorado/miel/pino → ROBLE
gris/plomo/antracita → GRAFITO | negro/oscuro → NEW BLACK | blanco/crema → BLANCO

═══ AUTORIDAD TÉCNICA (solo con perfil TÉCNICO, no al inicio) ═══
Consultor acreditado MINVU, Resolución 266/2025. Evaluador energético de envolventes.
Úsalo como cierre de autoridad, no como apertura.

═══ REGLAS DURAS ═══
Solo WinHouse PVC y Sodal Aluminio.
update_quote UNA vez con todos los items completos.
NUNCA publicar precios en el chat — solo en la propuesta PDF.
Siempre decir "PVC línea europea", nunca "S60" ni "Sliding" al cliente.
Visita técnica siempre gratuita y sin compromiso.
Si no sabes → "Lo verifico y le confirmo hoy mismo."
No descuentes sin autorización.
No inventes datos técnicos.
`.trim();

const tools = [
  {
    type: "function",
    function: {
      name: "update_quote",
      description:
        "Actualiza la cotización completa. Si incluye items, enviar la lista COMPLETA (reemplaza anteriores).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          default_color: {
            type: "string",
            description: "blanco, nogal, roble, grafito, newblack",
          },
          comuna: { type: "string" },
          address: { type: "string" },
          project_type: { type: "string" },
          install: { type: "string", description: "Sí o No" },
          wants_pdf: { type: "boolean" },
          notes: { type: "string" },
          supplier: {
            type: "string",
            description: "WINHOUSE_PVC o SODAL_ALUMINIO",
          },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                product: {
                  type: "string",
                  enum: ["CORREDERA", "PROYECTANTE", "ABATIBLE", "OSCILOBATIENTE", "MARCO_FIJO", "PUERTA_1H", "PUERTA_DOBLE"],
                  description: "Tipo de ventana/puerta. CORREDERA para correderas/sliding. PROYECTANTE para proyectantes. ABATIBLE para abatibles. IMPORTANTE: si el cliente dice 'corredera', usar CORREDERA, no PROYECTANTE.",
                },
                measures: {
                  type: "string",
                  description: "ancho×alto en mm. Ej: 2000x1500",
                },
                qty: { type: "number" },
                color: { type: "string", description: "blanco, nogal, roble, grafito, newblack" },
              },
              required: ["product", "measures", "qty"],
            },
          },
        },
      },
    },
  },
];

/* =========================
   15b) PERFIL ACUMULATIVO + HANDOFF
   ========================= */
function detectarPerfil(text, session) {
  if (!session.perfilAcumulado) session.perfilAcumulado = { tecnico: 0, emocional: 0 };
  const t = (
    text
      .toLowerCase()
      .match(
        /(uw|transmitancia|w\/m|db|oguc|perfil|c[aá]mara|camaras|sellos|norma|envolvente|dvh|minvu|certificad|zona.t[eé]rmic)/g
      ) || []
  ).length;
  const e = (
    text
      .toLowerCase()
      .match(
        /(ruido|fr[ií]o|calor|confort|descanso|elegante|tranquil|familia|dise[ñn]o|lindo|bonito|dormitorio|seguridad|silencio|revalori)/g
      ) || []
  ).length;
  session.perfilAcumulado.tecnico += t;
  session.perfilAcumulado.emocional += e;
  const tot = session.perfilAcumulado;
  if (tot.tecnico > tot.emocional + 1) return "TECNICO";
  if (tot.emocional > tot.tecnico + 1) return "EMOCIONAL";
  return "MIXTO";
}

const ESCALADA_KW = [
  "hablar con persona",
  "hablar con alguien",
  "quiero hablar",
  "llameme",
  "llámeme",
  "no entiendo",
  "muy confuso",
  "enojado",
  "molesto",
  "pesimo",
  "pésimo",
  "mal servicio",
];
function necesitaHumano(text) {
  return ESCALADA_KW.some((k) => text.toLowerCase().includes(k));
}

/* =========================
   16) RUN AI — [F10] unificado: usa solo d.stageKey, no ses.stage
   ========================= */
async function runAI(session, userText) {
  // ── Handoff humano ───────────────────────────────────────────
  if (necesitaHumano(userText)) {
    // [F10] usar d.stageKey en vez de ses.stage
    session.data.stageKey = "escalado_humano";
    return {
      role: "assistant",
      content: `Entiendo, le conecto con nuestro equipo directamente.\n📱 ${COMPANY.PHONE}\n⏰ Lun-Vie 9:00-18:00 | Sáb 9:00-13:00`,
    };
  }

  const d = session.data;
  const missing = nextMissing(d);
  const done = isComplete(d);

  const status = [];
  status.push(`Proveedor actual: ${d.supplier}`);
  if (d.zona_termica) status.push(zonaInfo(d.zona_termica).note);

  if (d.items.length) {
    status.push(`═══ ${d.items.length} ITEMS ═══`);
    for (const [i, it] of d.items.entries()) {
      const c = it.color || d.default_color || "SIN COLOR";
      let priceInfo = "pendiente";
      if (it.unit_price) {
        const src = it.source === "winperfil_exact" ? "✓ Precio exacto" : "⚠️ Estimado";
        priceInfo = `$${Number(it.unit_price).toLocaleString("es-CL")} c/u → $${Number(it.total_price).toLocaleString("es-CL")} (${src})`;
      } else if (it.price_warning) {
        priceInfo = it.price_warning;
      }
      status.push(
        `${i + 1}. ${it.qty}× ${it.product} ${it.measures} [${c}] → ${priceInfo}`
      );
    }
    if (d.grand_total)
      status.push(
        `★ TOTAL: $${Number(d.grand_total).toLocaleString("es-CL")} + IVA`
      );
  }

  if (!done) status.push(`FALTA: "${missing}" (pregunta de forma eficiente según contexto).`);

  // ── Perfil acumulativo ──────────────────────────────────────
  const perfil = detectarPerfil(userText, session);

  const msgs = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content:
        status.join("\n") +
        `\n\nPERFIL CLIENTE: ${perfil} (tecnico=${session.perfilAcumulado?.tecnico || 0} / emocional=${session.perfilAcumulado?.emocional || 0})`,
    },
    ...session.history.slice(-12),
    { role: "user", content: userText },
  ];

  try {
    const r = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: msgs,
      tools,
      tool_choice: "auto",
      parallel_tool_calls: false,
      temperature: 0.4,
      max_tokens: 400,
    });
    return r.choices?.[0]?.message;
  } catch (e) {
    logErr("runAI", e);
    return { role: "assistant", content: "Dame un segundo… 🔍" };
  }
}

/* =========================
   17) QUOTE APPLY
   ========================= */
async function priceAll(d, customer_id = "") {
  if (!ALLOWED_SUPPLIERS.includes(d.supplier)) d.supplier = "WINHOUSE_PVC";
  d.items = sortItemsForCotizador(d.items);

  const items = d.items.map((it) => {
    const color = normColor(it.color || d.default_color || "");
    const product = normProduct(it.product || "");
    const m = normMeasures(it.measures);
    return {
      product: product || it.product || "",
      measures: it.measures || "",
      ancho_mm: m ? m.ancho_mm : 1500,
      alto_mm: m ? m.alto_mm : 1200,
      qty: Math.max(1, Number(it.qty) || 1),
      color,
    };
  });

  let allOkInputs = true;
  for (const it of items) {
    if (!it.product || !it.measures || !it.color) allOkInputs = false;
  }
  if (!allOkInputs) return { ok: false, error: "Faltan datos en items (producto/medidas/color)" };

  if (PRICER_MODE === "cotizador_winhouse") {
    if (d.supplier !== "WINHOUSE_PVC") {
      return { ok: false, error: "La línea de aluminio requiere cotización manual." };
    }
    if (!cotizadorWinhouseConfigured()) {
      return { ok: false, error: "Cotizador Winhouse no configurado en Railway." };
    }
    const mapped = d.items.map((it) =>
      mapQuoteItemToCotizador(it, d.default_color || "")
    );
    const unsupported = mapped.filter((x) => x.unsupported);
    if (unsupported.length > 0) {
      for (const u of unsupported) {
        const target = d.items.find((it) => it === u.raw);
        if (target) {
          target.price_warning = u.reason;
          target.source = "cotizador_manual";
          target.confidence = "manual";
        }
      }
      return { ok: false, error: "Uno o más ítems requieren validación manual." };
    }
    const payload = {
      items: mapped.map((x) => x.payload),
      cliente: {
        nombre: d.name || "Cliente WhatsApp",
        telefono: customer_id || "",
      },
    };
    const r = await cotizarWinhouse(payload);
    if (!r.ok || !r.json)
      return {
        ok: false,
        error: r.json?.error || r.error || "Cotizador Winhouse no disponible.",
      };
    const applied = applyCotizadorResultToSessionItems(d.items, r.json);
    d.grand_total = Number(r.json?.resumen?.subtotal_neto || applied.total || 0) || null;
    if (applied.escaladas > 0)
      return {
        ok: false,
        error:
          "La cotización base quedó armada, pero uno o más ítems requieren validación manual.",
        partial: true,
        total: d.grand_total,
      };
    return { ok: true, total: d.grand_total, source: "cotizador_winhouse" };
  }

  if (PRICER_MODE === "winperfil" && WINPERFIL_API_BASE) {
    const payload = {
      supplier: d.supplier,
      message: "",
      items,
      customer_id: customer_id || "",
      meta: {
        comuna: d.comuna || "",
        zona_termica: d.zona_termica || null,
      },
    };
    const r = await quoteByWinperfil(payload);
    if (r.ok) {
      if (r.items && r.items.length) {
        for (let i = 0; i < d.items.length && i < r.items.length; i++) {
          d.items[i].unit_price = r.items[i].unit_price;
          d.items[i].total_price = r.items[i].total_price;
          d.items[i].source = r.items[i].source || "unknown";
          d.items[i].confidence = r.items[i].confidence || "unknown";
          if (r.items[i].confidence === "low")
            d.items[i].price_warning =
              "⚠️ Precio estimado (histórico limitado). Sujeto a validación.";
          else if (r.items[i].source === "winperfil_estimated")
            d.items[i].price_warning = "⚠️ Precio estimado desde histórico Winperfil.";
        }
      } else if (r.total) {
        const unitEach = Math.round(r.total / d.items.length);
        for (const it of d.items) {
          it.unit_price = unitEach;
          it.total_price = unitEach * it.qty;
          it.source = "unknown";
        }
      }
      d.grand_total = r.total;
    }
    return r;
  }

  return {
    ok: false,
    error: "Cotización automática no disponible. Sistema operativo en modo manual.",
  };
}

/* =========================
   18) ZOHO CRM + BOOKS — [F3] retry en zhBooksCreateEstimate
   ========================= */
let _zh = { token: "", exp: 0 };
let _zhP = null;

async function zhRefresh() {
  const p = new URLSearchParams({
    refresh_token: ZOHO.REFRESH_TOKEN,
    client_id: ZOHO.CLIENT_ID,
    client_secret: ZOHO.CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  const { data } = await axios.post(
    `${ZOHO.ACCOUNTS}/oauth/v2/token`,
    p.toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      httpsAgent,
      timeout: 30000,
    }
  );
  _zh = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 - 60_000 };
  return _zh.token;
}

async function zhToken() {
  if (!REQUIRE_ZOHO) return "";
  if (_zh.token && Date.now() < _zh.exp) return _zh.token;
  if (_zhP) return _zhP;
  _zhP = zhRefresh().finally(() => {
    _zhP = null;
  });
  return _zhP;
}

const zhH = async () => ({
  Authorization: `Zoho-oauthtoken ${await zhToken()}`,
});

async function zhCreate(mod, rec) {
  try {
    const { data } = await axios.post(
      `${ZOHO.API}/crm/v2/${mod}`,
      { data: [rec], trigger: ["workflow"] },
      { headers: await zhH(), httpsAgent }
    );
    return data?.data?.[0]?.details?.id || null;
  } catch (e) {
    logErr(`zhCreate ${mod}`, e);
    return null;
  }
}

async function zhUpdate(mod, id, rec) {
  try {
    await axios.put(
      `${ZOHO.API}/crm/v2/${mod}/${id}`,
      { data: [rec], trigger: ["workflow"] },
      { headers: await zhH(), httpsAgent }
    );
  } catch (e) {
    logErr(`zhUpdate ${mod}`, e);
  }
}

async function zhNote(mod, id, title, body) {
  try {
    await axios.post(
      `${ZOHO.API}/crm/v2/${mod}/${id}/Notes`,
      { data: [{ Note_Title: title, Note_Content: body }] },
      { headers: await zhH(), httpsAgent }
    );
  } catch (e) {
    logErr("zhNote", e);
  }
}

async function zhDefaultAcct() {
  try {
    const h = await zhH();
    const n = ZOHO.DEFAULT_ACCT;
    const r = await axios.get(
      `${ZOHO.API}/crm/v2/Accounts/search?criteria=(Account_Name:equals:${encodeURIComponent(n)})`,
      { headers: h, httpsAgent }
    );
    if (r.data?.data?.[0]) return r.data.data[0].id;
    const c = await axios.post(
      `${ZOHO.API}/crm/v2/Accounts`,
      { data: [{ Account_Name: n }] },
      { headers: h, httpsAgent }
    );
    return c.data?.data?.[0]?.details?.id || null;
  } catch (e) {
    logErr("zhDefaultAcct", e);
    return null;
  }
}

async function zhFindDeal(phone) {
  if (!REQUIRE_ZOHO) return null;
  const h = await zhH();
  for (const f of [ZOHO.DEAL_PHONE, "Phone", "Mobile"].filter(Boolean)) {
    try {
      const { data } = await axios.get(
        `${ZOHO.API}/crm/v2/Deals/search?criteria=(${f}:equals:${encodeURIComponent(phone)})`,
        { headers: h, httpsAgent }
      );
      if (data?.data?.[0]) return data.data[0];
    } catch (e) {
      if (e.response?.status === 204 || e.response?.data?.code === "INVALID_QUERY")
        continue;
      logErr(`zhFind(${f})`, e);
      return null;
    }
  }
  return null;
}

function computeStage(d, s) {
  if (d.stageKey === "escalado_humano") return "escalado_humano"; // [F10]
  if (s.pdfSent) return "propuesta";
  if (isComplete(d)) return "validacion";
  if (d.items.length) return "siembra";
  return "diagnostico";
}

function buildDesc(d) {
  const L = [
    `Proveedor: ${d.supplier}`,
    `Color: ${d.default_color || "—"}`,
    `Comuna: ${d.comuna || "—"}`,
  ];
  if (d.zona_termica) L.push(`Zona: Z${d.zona_termica}`);
  L.push("", "ITEMS:");
  for (const [i, it] of d.items.entries()) {
    const c = it.color || d.default_color || "—";
    const src =
      it.source === "winperfil_exact"
        ? "✓ Exacto"
        : it.source === "winperfil_estimated"
          ? "⚠️ Estimado"
          : "";
    const p = it.total_price
      ? `$${Number(it.total_price).toLocaleString("es-CL")} ${src}`
      : "pend";
    L.push(`${i + 1}. ${it.qty}× ${it.product} ${it.measures} [${c}] → ${p}`);
  }
  if (d.grand_total)
    L.push(`\nTOTAL: $${Number(d.grand_total).toLocaleString("es-CL")} +IVA`);
  return L.join("\n");
}

async function zhUpsert(ses, waId) {
  if (!REQUIRE_ZOHO) return;
  const d = ses.data;
  const phone = normPhone(waId);
  d.stageKey = computeStage(d, ses);
  const mp = d.items[0]?.product || "Ventanas";
  const deal = {
    Deal_Name: `${mp} ${d.default_color || ""} [WA…${String(waId).slice(-4)}]`.trim(),
    Stage: STAGES[d.stageKey] || STAGES.diagnostico,
    Closing_Date: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
    Description: buildDesc(d),
  };
  if (ZOHO.DEAL_PHONE) deal[ZOHO.DEAL_PHONE] = phone;
  if (d.grand_total) deal.Amount = d.grand_total;
  const ex = await zhFindDeal(phone);
  if (ex?.id) {
    ses.zohoDealId = ex.id;
    await zhUpdate("Deals", ex.id, deal);
  } else {
    const a = await zhDefaultAcct();
    if (a) deal.Account_Name = { id: a };
    ses.zohoDealId = await zhCreate("Deals", deal);
  }
  fireAndForget("trackLeadEvent.zhUpsert", trackLeadEvent(buildLeadPayload(ses, waId)));
}

// [F3] Retry helper con backoff — 1 reintento
async function withRetry(fn, label, maxRetries = 1, delayMs = 2000) {
  let lastErr;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      logErr(`${label} (intento ${i + 1}/${maxRetries + 1})`, e);
      if (i < maxRetries) await sleep(delayMs * (i + 1));
    }
  }
  throw lastErr;
}

// [F3] zhBooksCreateEstimate con retry
async function zhBooksCreateEstimate(data, customer_name, phone) {
  if (!REQUIRE_ZOHO || !ZOHO.ORG_ID) return null;

  return withRetry(async () => {
    const h = await zhH();
    let customer_id = null;
    // [PROD] Buscar primero por teléfono (más confiable que nombre)
    if (phone) {
      try {
        const phoneSearch = await axios.get(
          `${ZOHO.BOOKS_API}/contacts?organization_id=${ZOHO.ORG_ID}&phone=${encodeURIComponent(phone)}`,
          { headers: h, httpsAgent, timeout: 20000 }
        );
        if (phoneSearch.data?.contacts?.length)
          customer_id = phoneSearch.data.contacts[0].contact_id;
      } catch {}
    }
    // Fallback: buscar por nombre
    if (!customer_id) {
      try {
        const searchResp = await axios.get(
          `${ZOHO.BOOKS_API}/contacts?organization_id=${ZOHO.ORG_ID}&contact_name=${encodeURIComponent(customer_name || "Cliente WhatsApp")}`,
          { headers: h, httpsAgent, timeout: 20000 }
        );
        if (searchResp.data?.contacts?.length)
          customer_id = searchResp.data.contacts[0].contact_id;
      } catch {}
    }

    if (!customer_id) {
      const createResp = await axios.post(
        `${ZOHO.BOOKS_API}/contacts?organization_id=${ZOHO.ORG_ID}`,
        {
          contact_name: customer_name || "Cliente WhatsApp",
          contact_type: "customer",
          phone: phone || "",
          notes: `Contacto creado automáticamente vía WhatsApp IA — ${COMPANY.NAME}`,
          contact_persons: [
            {
              first_name: customer_name || "Cliente",
              phone: phone || "",
              is_primary_contact: true,
            },
          ],
        },
        { headers: h, httpsAgent, timeout: 20000 }
      );
      customer_id = createResp.data?.contact?.contact_id;
    }

    if (!customer_id) {
      throw new Error("No se pudo crear/encontrar cliente en Books");
    }

    const line_items = data.items.map((it) => {
      const prod = it.product || "Ventana";
      const color = it.color || data.default_color || "Blanco";
      const measures = it.measures || "";
      const glass = process.env.DEFAULT_GLASS || "Termopanel DVH estándar";
      let tipo = "Ventana PVC Línea Europea";
      const p = prod.toUpperCase();
      if (p.includes("PUERTA")) tipo = "Puerta PVC Línea Europea";
      else if (p.includes("CORREDERA")) tipo = "Ventana Corredera PVC Línea Europea";
      else if (p.includes("PROYECT")) tipo = "Ventana Proyectante PVC Línea Europea";
      else if (p.includes("OSCILO")) tipo = "Ventana Oscilobatiente PVC Línea Europea";
      else if (p.includes("ABAT")) tipo = "Ventana Abatible PVC Línea Europea";
      else if (p.includes("MARCO") || p.includes("FIJO")) tipo = "Marco Fijo PVC Línea Europea";
      const desc =
        it.descripcion || `${tipo} | Color: ${color} | Medidas: ${measures}mm | Vidrio: ${glass} | Perfiles certificados IFT Rosenheim | Laminado Renolit`;
      const lineItem = {
        name: tipo,
        description: desc,
        rate: Number(it.unit_price) || 1,
        quantity: Number(it.qty || 1),
      };
      // [PROD] Solo agregar item_id si está configurado (evita error Zoho "invalid item")
      if (ZOHO.DEFAULT_ITEM_ID) lineItem.item_id = ZOHO.DEFAULT_ITEM_ID;
      // [PROD] Solo agregar tax_id si está configurado y no vacío
      if (ZOHO.TAX_ID && ZOHO.TAX_ID.length > 2) lineItem.tax_id = ZOHO.TAX_ID;
      return lineItem;
    });

    const estimatePayload = {
      customer_id,
      subject: "Propuesta Técnico Comercial — Ventanas PVC Línea Europea",
      line_items,
      reference_number: data.quote_num || "",
      notes: `Propuesta generada por ${COMPANY.NAME}.\nVentanas PVC Línea Europea con termopanel DVH, aislación térmica y acústica.\nComuna: ${data.comuna || ""}\n${data.zona_termica ? `Zona térmica OGUC: Z${data.zona_termica} — Cumplimiento normativo garantizado.` : ""}`.trim(),
      terms:
        "Válida por 15 días hábiles. Precios netos + IVA.\nSujeta a rectificación técnica en terreno.\nCumplimiento OGUC 4.1.10 (acondicionamiento térmico).",
    };

    const { data: estResp } = await axios.post(
      `${ZOHO.BOOKS_API}/estimates?organization_id=${ZOHO.ORG_ID}`,
      estimatePayload,
      { headers: h, httpsAgent, timeout: 30000 }
    );
    logInfo(
      "zhBooksCreateEstimate",
      `Estimate creado: ${estResp.estimate?.estimate_id}`
    );
    return estResp.estimate;
  }, "zhBooksCreateEstimate", 1, 3000);
}

/* =========================
   19) ENDPOINTS
   ========================= */
async function zhBooksDownloadEstimatePdf(estimateId) {
  const h = await zhH();
  const url = `${ZOHO.BOOKS_API}/estimates/${estimateId}?organization_id=${ZOHO.ORG_ID}&accept=pdf`;
  const { data } = await axios.get(url, {
    headers: h,
    httpsAgent,
    responseType: "arraybuffer",
    timeout: 30000,
  });
  return Buffer.from(data);
}

async function waSendPdf(to, pdfBuffer, filename, caption) {
  const FormData = (await import("form-data")).default;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "document");
  form.append("file", pdfBuffer, {
    filename,
    contentType: "application/pdf",
  });
  const uploadResp = await axiosWA.post(`/${META.PHONE_ID}/media`, form, {
    headers: form.getHeaders(),
    timeout: 30000,
  });
  const mediaId = uploadResp.data?.id;
  if (!mediaId) throw new Error("No se pudo subir PDF a WhatsApp");
  await axiosWA.post(`/${META.PHONE_ID}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: { id: mediaId, filename, caption: caption || "" },
  });
}

app.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    v: "9.5.1-prod",
    agent: AGENT_NAME,
    pricer_mode: PRICER_MODE,
    winperfil_api: WINPERFIL_API_BASE ? "set" : "missing",
    cotizador_winhouse: cotizadorWinhouseConfigured() ? "configured" : "disabled",
    zoho_books: ZOHO.ORG_ID ? "enabled" : "disabled",
    sales_os_bridge: salesOsConfigured() ? "enabled" : "disabled",
    internal_operator_bridge: INTERNAL_OPERATOR_TOKEN ? "enabled" : "missing",
    voice_tts: VOICE_ENABLED
      ? `enabled/${VOICE_SEND_MODE}`
      : "disabled",
    voice_provider: VOICE_ENABLED ? VOICE_TTS_PROVIDER : "n/a",
    voice_elevenlabs: VOICE_ENABLED && ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID
      ? "configured"
      : "not_configured",
    // [F1] memory stats
    sessions_active: sessions.size,
    seen_size: seen.size,
    rate_size: rateM.size,
  });
});

app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === META.VERIFY)
    return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/quote", async (req, res) => {
  try {
        const key = req.get("x-api-key") || req.get("X-API-Key") || "";

    if (!QUOTE_API_KEY) {
      return res.status(500).json({ ok: false, error: "QUOTE_API_KEY missing" });
    }
    if (key !== QUOTE_API_KEY) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    const message = String(req.body?.message || "").trim();
    const supplier = req.body?.supplier || detectSupplier(message);
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!ALLOWED_SUPPLIERS.includes(supplier))
      return res.status(400).json({ ok: false, error: "Proveedor no permitido" });
    const payload = {
      supplier,
      message,
      items: items || [],
      customer_id: String(req.body?.customer_id || ""),
      meta: req.body?.meta || {},
    };
    if ((!payload.items || payload.items.length === 0) && !payload.message)
      return res.status(400).json({ ok: false, error: "Falta message o items" });
    const r = await quoteByWinperfil(payload);
    res.json(r);
  } catch (e) {
    logErr("/quote", e);
    res.status(500).json({ ok: false, error: "Error interno /quote" });
  }
});

// @patch:sales-os:operator-route:start
app.post("/internal/operator-send", async (req, res) => {
  try {
    if (!validInternalOperatorToken(req))
      return res.status(401).json({ ok: false, error: "unauthorized" });
    const phone = normPhone(req.body?.phone || "");
    const text = String(req.body?.text || "").trim();
    const operatorName =
      String(req.body?.operator_name || "Operador").trim() || "Operador";
    if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });
    if (!text) return res.status(400).json({ ok: false, error: "text_required" });
    const ses = getSession(phone);
    ses.history.push({ role: "assistant", content: text });
    saveSession(phone, ses);
    await waSendH(phone, text, true, {
      actor_type: "operator",
      actor_name: operatorName,
      customer_name: ses.data?.name || "",
      metadata: { source: "sales_os_operator" },
      quote_status: ses.data?.stageKey || undefined,
      track: false,
    });
    res.json({ ok: true, sent: true, phone });
  } catch (e) {
    logErr("/internal/operator-send", e);
    res.status(500).json({ ok: false, error: "internal_operator_send_failed" });
  }
});
// @patch:sales-os:operator-route:end

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  if (!verifySig(req)) return;

  const inc = extractMsg(req.body);
  if (!inc.ok) return;

  const { waId, msgId, type } = inc;
  if (isDup(msgId)) return;

  const rc = rateOk(waId);
  if (!rc.ok) return waSend(waId, rc.msg);

  const release = await acquireLock(waId);
  const stopType = startTypingLoop(waId, 8000);

  try {
    const ses = getSession(waId);
    await waRead(msgId);

    let userText = inc.text || "";

    if (type === "audio" && inc.audioId) {
      const meta = await waMediaUrl(inc.audioId);
      const { buffer, mime } = await waDownload(meta.url);
      const t = await stt(buffer, mime);
      userText = t ? `[Audio]: ${t}` : "[Audio no reconocido]";
    }

    if (type === "image" && inc.imageId) {
      const meta = await waMediaUrl(inc.imageId);
      const { buffer, mime } = await waDownload(meta.url);
      const ext = await vision(buffer, mime);
      userText = ext
        ? `[IMAGEN ANALIZADA — Productos detectados]:\n${ext}\n\nINSTRUCCIÓN: extrae TODOS los items y envíalos con update_quote en UNA sola llamada.`
        : "[Imagen no legible]";
    }

    if (type === "document" && inc.docId && inc.docMime === "application/pdf") {
      const meta = await waMediaUrl(inc.docId);
      const { buffer } = await waDownload(meta.url);
      const t = await readPdf(buffer);
      userText = t
        ? `[PDF ANALIZADO]:\n${t}\n\nINSTRUCCIÓN: extrae TODOS los items y envíalos con update_quote.`
        : "[PDF sin texto]";
    }

    fireAndForget(
      "trackConversationEvent.inbound",
      trackConversationEvent({
        channel: "whatsapp",
        external_id: waId,
        customer_name: ses.data?.name || "",
        direction: "inbound",
        actor_type: "customer",
        actor_name: "Cliente",
        message_type: type || "text",
        body: userText,
        metadata: { source: "whatsapp_webhook", msg_id: msgId, raw_type: type },
        quote_status: ses.data?.stageKey || undefined,
        unread_count: 1,
      })
    );

    const control = await getConversationControl(waId);
        // [ADMIN] Chequear comando OLIVER IN/OFF o admin
    const adminCmd = parseAdminCmd(userText);
        // [DEBUG] Log del número para ver formato
    if (userText.includes("OLIVER") || userText.includes("ADMIN")) {
      logInfo("ADMIN_DEBUG", `waId=${waId}, ADMIN_PHONE=${ADMIN_PHONE}, Match=${waId === ADMIN_PHONE}`);
    }
    if (adminCmd) {
      if (adminCmd.type === "admin_in" || adminCmd.type === "admin_off") {
        if (!adminCheckAuth(waId, adminCmd.pin)) {
          await waSendH(waId, "❌ PIN inválido o teléfono no autorizado.", true);
          return;
        }
        if (adminCmd.type === "admin_in") {
          ses.adminMode = true;
          await waSendH(waId, "✅ Modo admin ACTIVADO.", true);
        } else {
          ses.adminMode = false;
          await waSendH(waId, "✅ Modo admin DESACTIVADO.", true);
        }
        saveSession(waId, ses);
        return;
      }
      
      // Comandos admin (solo si está en modo admin)
      if (ses.adminMode !== true && waId !== ADMIN_PHONE) {
        await waSendH(waId, "❌ No autorizado.", true);
        return;
      }
      
      if (adminCmd.type === "admin_status") {
        const active = cubicacionPendientes.size;
        const msg = `📊 ADMIN STATUS\n\nSesión: ${waId}\nItems: ${ses.data.items.length}\nPendientes: ${active}\nPDF: ${ses.pdfSent ? "✓" : "✗"}\nZoho: ${ses.zohoDealId || "—"}`;
        await waSendH(waId, msg, true);
        return;
      }
      
      if (adminCmd.type === "admin_last_cubi") {
        const pending = cubicacionPendientes.get(waId);
        const msg = pending 
          ? `⏳ Pendiente hace ${Math.round((Date.now() - pending.timestamp) / 1000)}s`
          : `✅ Sin pendientes`;
        await waSendH(waId, msg, true);
        return;
      }
      
      if (adminCmd.type === "admin_force_pdf") {
        if (ses.data.items.length === 0) {
          await waSendH(waId, "❌ Sin items.", true);
          return;
        }
        const priced = await priceAll(ses.data, waId);
        if (!priced.ok) {
          await waSendH(waId, `❌ ${priced.error}`, true);
          return;
        }
        const estimate = await zhBooksCreateEstimate(ses.data, ses.data.name || "Cliente", normPhone(waId));
        if (estimate?.estimate_id) {
          const pdfBuf = await zhBooksDownloadEstimatePdf(estimate.estimate_id);
          await waSendPdf(waId, pdfBuf, `PropuestaManual_${Date.now()}.pdf`, "PDF enviado manualmente");
          ses.zohoEstimateId = estimate.estimate_id;
          ses.pdfSent = true;
          saveSession(waId, ses);
          await waSendH(waId, "✅ PDF reenviado.", true);
        }
        return;
      }
      
      return;
    }
    if (control?.ai_paused || control?.operator_status === "human") {
      ses.history.push({ role: "user", content: userText });
      saveSession(waId, ses);
      logInfo("takeover", `AI en pausa para ${waId}`);
      return;
    }

    if (/^reset|nueva cotizaci[oó]n|empezar de nuevo/i.test(userText)) {
      ses.data = emptyData();
      ses.pdfSent = false;
      ses.followupEnviado = false;
      ses.perfilAcumulado = { tecnico: 0, emocional: 0 };
      await waSendH(waId, "Listo, empecemos de cero.\n¿Qué ventanas o puertas necesita?", true, {
        customer_name: "",
      });
      saveSession(waId, ses);
      return;
    }

    ses.history.push({ role: "user", content: userText });
    const ai = await runAI(ses, userText);

    // [F10] Handoff humano detectado en runAI — usa d.stageKey
    if (ses.data.stageKey === "escalado_humano" && ai?.content) {
      await waSendH(waId, ai.content, true);
      saveSession(waId, ses);
      return;
    }

    if (ai?.tool_calls?.length) {
      for (const tc of ai.tool_calls) {
        if (tc.function?.name !== "update_quote") continue;
        let args = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          continue;
        }

        const d = ses.data;
        if (args.supplier && ALLOWED_SUPPLIERS.includes(args.supplier))
          d.supplier = args.supplier;
        else d.supplier = detectSupplier(userText + " " + safeJson(args));

        for (const k of [
          "name",
          "default_color",
          "comuna",
          "address",
          "project_type",
          "install",
          "notes",
        ]) {
          if (args[k] != null && args[k] !== "") d[k] = args[k];
        }
        if (args.wants_pdf === true) d.wants_pdf = true;

        if (Array.isArray(args.items) && args.items.length > 0) {
          // [PROD-FIX] Resetear pdfSent cuando los items cambian
          // Esto permite re-cotizar cuantas veces quiera el cliente
          ses.pdfSent = false;
          d.wants_pdf = false;

          d.items = args.items.map((it, i) => ({
            id: i + 1,
            product: it.product || "",
            measures: it.measures || "",
            qty: Math.max(1, Number(it.qty) || 1),
            color: it.color || "",
            unit_price: null,
            total_price: null,
            price_warning: "",
            source: null,
            confidence: null,
          }));

          // [PROD-FIX] Validar medidas vs límites reales de fabricación WinHouse
          for (const it of d.items) {
            const m = normMeasures(it.measures);
            if (!m) continue;
            const p = normProduct(it.product || "");
            const warn = validateDimensions(p, m.ancho_mm, m.alto_mm);
            if (warn) {
              it.dim_warning = warn.message;
              if (warn.suggest) it.suggested_product = warn.suggest;
              if (warn.escalate) it.needs_escalation = true;
            }
          }
        }

        if (d.comuna && !d.zona_termica) {
          const zt = getZona(d.comuna);
          if (zt) d.zona_termica = zt;
        }

        if (canQuote(d)) {
                  // Si hay items nuevos en la cubicación → iniciar timer automático
        if (Array.isArray(args.items) && args.items.length > 0 && canQuote(ses.data)) {
          cubicacionPendientes.set(waId, {
            items: args.items,
            timestamp: Date.now(),
            tries: 0,
          });
          logInfo("cubicacion_timer", `Timer iniciado para ${waId}, PDF en 60s`);
        }
          const qr = await priceAll(d, "");
          if (qr.ok && qr.total) {
            d.grand_total = qr.total;
          } else {
            for (const it of d.items)
              it.price_warning = qr.error || "No pude cotizar";
            d.grand_total = null;
          }
        }
      }

      const d = ses.data;

      // [PROD-FIX] Flag para saltar el flujo PDF si se detectan problemas de fabricación
      let earlyExit = false;

      // [PROD-FIX] Detectar items con problemas de fabricación
      const dimWarnings = d.items.filter(it => it.dim_warning);
      const needsEscalation = d.items.some(it => it.needs_escalation);
      const hasSuggestions = d.items.filter(it => it.suggested_product);

      // [PROD-FIX] Si hay sugerencias de producto (ej: proyectante → corredera), informar al cliente
      if (hasSuggestions.length > 0 && !needsEscalation) {
        const sugMsgs = hasSuggestions.map(it => {
          const m = normMeasures(it.measures);
          return `La medida ${m?.ancho_mm}×${m?.alto_mm} es grande para ${it.product}. Le recomiendo una ventana corredera para esa medida, queda mucho mejor y es más práctica.`;
        });
        await waSendSmartMultiH(waId, sugMsgs, true, { incomingType: type });
        await waSendSmartH(waId, "¿Le parece si ajusto la cotización con corredera en esos items?", true, { incomingType: type });
        ses.history.push({ role: "assistant", content: sugMsgs.join("\n") + "\n¿Le parece si ajusto la cotización con corredera?" });
        saveSession(waId, ses);
        try { await zhUpsert(ses, waId); } catch (e) { logErr("zhUpsert-suggestion", e); }
        earlyExit = true;
      }

      // [PROD-FIX] Si necesita escalación técnica → avisar al cliente y al equipo
      if (!earlyExit && needsEscalation) {
        const escalationReasons = dimWarnings.filter(it => it.needs_escalation).map(it => it.dim_warning).join("; ");
        await waSendH(waId, "Algunas medidas que me indica necesitan validación técnica. Le paso con nuestro equipo para confirmar la mejor solución.", true);
        fireAndForget("escalation.dimensions", sendEscalationAlert(
          `Medidas fuera de rango: ${escalationReasons}`,
          normPhone(waId), d
        ));
        ses.history.push({ role: "assistant", content: "Medidas necesitan validación técnica, paso con el equipo." });
        saveSession(waId, ses);
        try { await zhUpsert(ses, waId); } catch (e) { logErr("zhUpsert-escalation", e); }
        earlyExit = true;
      }

      if (!earlyExit) {
        const wantsPdf =
          isComplete(d) &&
          d.grand_total &&
          (d.wants_pdf || /pdf|cotiza|cotizaci[oó]n|formal|env[ií]a|manda|propuesta/i.test(userText));

        if (wantsPdf && !ses.pdfSent) {
          // [PROD-FIX] Resumen SIN precios — describe productos y ventajas
          const resumenLines = [];
          resumenLines.push("📋 Le preparo su propuesta con lo siguiente:");
          for (const it of d.items) {
            const c = it.color || d.default_color || "blanco";
            const prod = normProduct(it.product || "");
            let tipoDesc = "Ventana PVC línea europea";
            if (prod.includes("CORREDERA")) tipoDesc = "Ventana corredera PVC línea europea";
            else if (prod.includes("PUERTA")) tipoDesc = "Puerta PVC línea europea";
            else if (prod.includes("PROYECT")) tipoDesc = "Ventana proyectante PVC línea europea";
            else if (prod.includes("ABAT")) tipoDesc = "Ventana abatible PVC línea europea";
            else if (prod.includes("FIJO")) tipoDesc = "Marco fijo PVC línea europea";
            else if (prod.includes("OSCILO")) tipoDesc = "Ventana oscilobatiente PVC línea europea";
            resumenLines.push(`${it.qty}× ${tipoDesc} de ${it.measures} en ${c}`);
          }
          resumenLines.push("\nTodas con termopanel DVH, aislación térmica y acústica, perfiles certificados y garantía de fábrica. Los colores son laminados Renolit que no se descascaran.");
          await waSendH(waId, resumenLines.join("\n"), true);
          await sleep(800);

          await waSendH(waId, "Preparando su propuesta formal… 📄", true);

          const qn = `COT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
          ses.quoteNum = qn;
          d.quote_num = qn;

          try {
            const estimate = await zhBooksCreateEstimate(
              d,
              d.name || "Cliente WhatsApp",
              normPhone(waId)
            );
            if (estimate?.estimate_id) {
              ses.zohoEstimateId = estimate.estimate_id;
              ses.pdfSent = true;
              d.stageKey = "propuesta";
              try {
                const pdfBuf = await zhBooksDownloadEstimatePdf(estimate.estimate_id);
                await waSendPdf(
                  waId,
                  pdfBuf,
                  `${qn}.pdf`,
                  `✅ Propuesta ${qn} lista. Si quiere ajustar algo, me avisa y la actualizo.`
                );
              } catch (pdfErr) {
                logErr("waSendPdf", pdfErr);
                const estimateUrl = estimate.estimate_url || "";
                await waSendH(
                  waId,
                  `✅ Propuesta ${qn} lista.\n📎 Link: ${estimateUrl}`,
                  true
                );
              }
              // Follow-up de cierre
              await sleep(1500);
                            // Follow-up de cierre — SOLO confirmación
              await sleep(1500);
              await waSendH(waId, "✅ Propuesta lista. Si quiere ajustar algo o tiene preguntas, me avisa.", true);

                     try {
                 await zhUpsert(ses, waId);
                 if (ses.zohoDealId && estimate.estimate_number) {
                   // [FEATURE] Log para dashboard
                   logInfo(
                     "pdf_sent_tracking",
                     `PDF enviado a ${waId} | Nombre: ${ses.data.name || "Sin nombre"} | Estimate: ${estimate.estimate_number} | Esperando revisión...`
                   );
                   await zhNote(
                     "Deals",
                     ses.zohoDealId,
                     `Cotización ${qn}`,
                     `Estimate: ${estimate.estimate_number}\nTotal: $${Number(d.grand_total).toLocaleString("es-CL")} +IVA`
                   );
                 }
               } catch (e) {
                 logErr("zhUpsert/zhNote-post-pdf", e);
               }
              fireAndForget(
                "trackQuoteEvent.formal",
                trackQuoteEvent(
                  buildQuotePayload(ses, waId, {
                    status: "formal_sent",
                    zoho_estimate_id: estimate.estimate_id,
                    zoho_estimate_url: estimate.estimate_url || "",
                    quote_number: qn,
                  })
                )
              );
            } else {
              throw new Error("No se pudo crear propuesta");
            }
          } catch (e) {
            logErr("Estimate", e);
            await waSendH(
              waId,
              "Tuve un problema generando la propuesta. Se la preparo manual y se la envío en breve 🙏",
              true
            );
            fireAndForget("escalation.pdf-fail", sendEscalationAlert(
              `Fallo generando PDF para ${d.name || "cliente"} — preparar propuesta manual`,
              normPhone(waId), d
            ));
          }
        } else {
          let reply = (ai.content || "").replace(/<PROFILE:\w+>/gi, "").trim();
          if (!reply) {
            if (!isComplete(d)) {
              reply = `Perfecto, para avanzar necesito: ${nextMissing(d)}.`;
            } else if (!d.grand_total) {
              reply = `Ya tengo los datos. Hubo un tema conectando al cotizador, pero en breve le confirmo el precio.`;
            } else {
              // [PROD-FIX] Sin precios en chat — solo beneficios
              reply = `Tengo todo listo para armarle la propuesta. Son ventanas PVC línea europea con termopanel, aislación térmica y acústica, y garantía de fábrica. ¿Le envío la propuesta formal en PDF?`;
            }
          }
          const parts = smartSplitForWhatsApp(reply);
          if (parts.length > 1) await waSendSmartMultiH(waId, parts, true, { incomingType: type });
          else await waSendSmartH(waId, parts[0], true, { incomingType: type });
          ses.history.push({ role: "assistant", content: reply });
          try { await zhUpsert(ses, waId); } catch (e) { logErr("zhUpsert-inline", e); }
        }
      } // end !earlyExit
    } else {
      let reply = (ai?.content || "").replace(/<PROFILE:\w+>/gi, "").trim();
      if (!reply) reply = "No le entendí, ¿me repite? 🤔";
      // [PROD] Smart split para burbujas WhatsApp cortas
      const parts = smartSplitForWhatsApp(reply);
      if (parts.length > 1) await waSendSmartMultiH(waId, parts, true, { incomingType: type });
      else await waSendSmartH(waId, parts[0], true, { incomingType: type });
      ses.history.push({ role: "assistant", content: reply });
    }

    saveSession(waId, ses);
  } catch (e) {
    logErr("WEBHOOK", e);
  } finally {
    stopType();
    release();
  }
});

/* =========================
   20) FOLLOW-UP AUTOMÁTICO 2H
   ========================= */
setInterval(async () => {
  for (const [waId, ses] of sessions.entries()) {
    const inactMin =
      (Date.now() - (ses.lastActivity || ses.lastAt || Date.now())) / 60000;
    if (
      inactMin > 120 &&
      !ses.followupEnviado &&
      ses.data.stageKey === "propuesta" // [F10] unificado
    ) {
      try {
        await waSendH(
          waId,
          `Hola${ses.data?.name ? " " + ses.data.name : ""}, ¿pudo revisar la propuesta que le preparé? Si tiene dudas de medidas o materiales con gusto le ayudo 🏠`,
          true
        );
        ses.followupEnviado = true;
        logInfo("followup", `Enviado a ${waId}`);
      } catch (e) {
        logErr("followup", e);
      }
    }
  }
}, 30 * 60 * 1000);

/* =========================
   21) START
   ========================= */
app.listen(PORT, () => {
  console.log(
    `🚀 Ferrari 9.5.1-prod — Marcelo Cifuentes MINVU — port=${PORT} pricer=${PRICER_MODE} cotizador=${cotizadorWinhouseConfigured() ? "OK" : "NO"} zoho_books=${ZOHO.ORG_ID ? "OK" : "NO"} escalation=${ESCALATION_PHONE ? "ON" : "OFF"}`
  );
});
