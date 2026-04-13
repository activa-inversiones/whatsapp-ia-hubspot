// index.js — WhatsApp IA + Zoho Books PDF (Ferrari 10.2.2-prod)
// Railway | Node 18+ | ESM
// ═══════════════════════════════════════════════════════════════════
// CAMBIOS vs 9.4.0 — Fixes producción real (captura WhatsApp):
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
  evaluateLeadValue,
  notifyHighValue,
  notifyHandoff,
  checkStaleHighValue,
} from "./services/highValueNotifier.js";
import {
  detectChannel,
  normalizeIncoming,
  sendMessage as multiSend,
  buildLeadPayload as buildMultiChannelPayload,
  registerMultiChannelRoutes,
} from "./services/multiChannelHandler.js";
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
  let serie = "SLIDING";
  let apertura = "corredera";
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

/* ─── [ADMIN] Merge multi-hoja tablas de precios ────────────────── */
function mergeTablePages(pages) {
  if (!pages || pages.length === 0) return null;
  if (pages.length === 1) return pages[0];
  const base = JSON.parse(JSON.stringify(pages[0]));
  for (let p = 1; p < pages.length; p++) {
    const page = pages[p];
    if (!base.modelo && page.modelo) base.modelo = page.modelo;
    if (!base.color && page.color) base.color = page.color;
    if (!base.vidrio && page.vidrio) base.vidrio = page.vidrio;
    const altosMatch = base.altos.length === page.altos.length &&
      base.altos.every((a, i) => a === page.altos[i]);
    if (altosMatch) {
      for (let c = 0; c < page.anchos.length; c++) {
        const ancho = page.anchos[c];
        if (!base.anchos.includes(ancho)) {
          base.anchos.push(ancho);
          for (let r = 0; r < base.precios.length; r++) {
            base.precios[r].push(page.precios[r]?.[c] ?? null);
          }
        }
      }
    } else {
      for (let r = 0; r < page.altos.length; r++) {
        const alto = page.altos[r];
        if (!base.altos.includes(alto)) {
          base.altos.push(alto);
          base.precios.push(new Array(base.anchos.length).fill(null));
        }
        for (let c = 0; c < page.anchos.length; c++) {
          const ancho = page.anchos[c];
          if (!base.anchos.includes(ancho)) {
            base.anchos.push(ancho);
            for (let er = 0; er < base.precios.length; er++) base.precios[er].push(null);
          }
          const ri = base.altos.indexOf(alto);
          const ci = base.anchos.indexOf(ancho);
          if (ri >= 0 && ci >= 0 && page.precios[r]?.[c] != null) base.precios[ri][ci] = page.precios[r][c];
        }
      }
    }
  }
  const ao = base.anchos.map((a, i) => ({ a, i })).sort((x, y) => x.a - y.a);
  base.anchos = ao.map(x => x.a);
  base.precios = base.precios.map(row => ao.map(x => row[x.i]));
  const ho = base.altos.map((a, i) => ({ a, i })).sort((x, y) => x.a - y.a);
  base.altos = ho.map(x => x.a);
  base.precios = ho.map(x => base.precios[x.i]);
  return base;
}
const ESCALATION_PHONE = process.env.ESCALATION_PHONE || "";
const OWNER_NOTIFICATION_PHONE = process.env.OWNER_NOTIFICATION_PHONE || ESCALATION_PHONE;
const ESCALATION_EMAIL = process.env.ESCALATION_EMAIL || "";
// ═══════════════════════════════════════════════════════════════════
// [ADMIN] OLIVER MODE — Control remoto + Cubicación Automática
// ═══════════════════════════════════════════════════════════════════
const ADMIN_PHONE = process.env.ADMIN_PHONE || "+56957296035";
const ADMIN_PIN = process.env.ADMIN_PIN || "1976";

// ═══ Reglas dinámicas admin (editables desde WhatsApp) ═══
const adminDynamicRules = [];

function getAdminRulesText() {
  if (adminDynamicRules.length === 0) return "";
  return "\n\n═══ INSTRUCCIONES DEL ADMINISTRADOR (prioridad máxima) ═══\n" +
    adminDynamicRules.map((r, i) => `${i + 1}. ${r}`).join("\n");
}

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
  if (s.startsWith("ADMIN PRECIO ")) return { type: "admin_precio", query: text.slice(13).trim() };
  if (s === "ADMIN TABLAS") return { type: "admin_tablas" };
  if (s === "ADMIN VOICE CONFIG") return { type: "admin_voice_config" };
  if (s === "ADMIN TABLA LISTA") return { type: "admin_table_ready" };
  if (s === "ADMIN APLICAR TABLA") return { type: "admin_apply_table" };
  if (s === "ADMIN CANCELAR") return { type: "admin_cancel" };
  if (s.startsWith("ADMIN REGLA ")) return { type: "admin_add_rule", rule: text.slice(12).trim() };
  if (s === "ADMIN VER REGLAS") return { type: "admin_list_rules" };
  if (s.startsWith("ADMIN BORRAR REGLA ")) return { type: "admin_del_rule", ruleNum: parseInt(s.slice(19)) };
  
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
                
                // Enviar PDF — un solo mensaje con caption, sin duplicados
                await waSendPdf(waId, pdfBuf, `COT-${Date.now()}.pdf`, 
                  `Propuesta lista. Si quiere ajustar algo, me avisa.`);
                
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
// Check leads de alto valor sin respuesta cada 15 minutos
setInterval(() => {
  try {
    checkStaleHighValue(sessions, waSend);
  } catch (e) {
    logErr("staleHighValue.check", e);
  }
}, 15 * 60 * 1000);


async function sendEscalationAlert(reason, customerPhone, sessionData) {
  const d = sessionData || {};
  const itemsSummary = (d.items || []).map((it, i) =>
    `${i + 1}. ${it.qty || 1}× ${it.product} ${it.measures} ${it.color || d.default_color || ""} ${it.dim_warning || ""}`
  ).join("\n");
  const alertMsg = `⚠️ ESCALACIÓN — ${reason}\n\nCliente: ${d.name || "Sin nombre"}\nTeléfono: ${customerPhone}\nComuna: ${d.comuna || "?"}\n\nItems:\n${itemsSummary}\n\nMotivo: ${reason}\n\nResponder desde Sales OS → ops.activalabs.ai`;
  if (ESCALATION_PHONE) {
    try {
      await waSend(ESCALATION_PHONE, alertMsg);
      logInfo("escalation", `Alerta enviada a ${ESCALATION_PHONE}: ${reason}`);
    } catch (e) {
      logErr("escalation.whatsapp", e);
    }
  }
  const session = sessions.get(customerPhone) || sessions.get(normPhone(customerPhone));
  if (session) {
    await notifyHandoff(waSend, customerPhone, session, reason);
  }
  try {
    await pushLeadEvent({
      phone: customerPhone,
      name: d.name || "",
      stage: "escalado_humano",
      priority: "HIGH",
      reason,
      items: d.items || [],
      value: d.grand_total || 0,
    });
  } catch (e) {
    logErr("escalation.salesOs", e);
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
let _lastMsgId = null;

async function waTyping(to) {
  if (!_lastMsgId) return;
  try {
    await axiosWA.post(`/${META.PHONE_ID}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: _lastMsgId,
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

/* =========================
   9c) ORCHESTRATOR 2-PASS GPT — Fase 2
   Paso 1: GPT extrae intención + tool calls (NO genera texto al cliente)
   Paso 2: Backend ejecuta acciones (cotizar, PDF, etc.)
   Paso 3: GPT genera texto final SOLO después de las acciones
   ========================= */

function buildStatusContext(session) {
  const d = session.data;
  const status = [];
  status.push(`Proveedor: ${d.supplier}`);
  if (d.zona_termica) status.push(zonaInfo(d.zona_termica).note);
  if (d.items.length) {
    status.push(`═══ ${d.items.length} ITEMS ═══`);
    for (const [i, it] of d.items.entries()) {
      const c = it.color || d.default_color || "SIN COLOR";
      let priceInfo = "pendiente";
      if (it.unit_price) {
        priceInfo = `$${Number(it.unit_price).toLocaleString("es-CL")} c/u`;
      } else if (it.price_warning) {
        priceInfo = it.price_warning;
      }
      status.push(`${i + 1}. ${it.qty}× ${it.product} ${it.measures} [${c}] → ${priceInfo}`);
    }
    if (d.grand_total) status.push(`★ TOTAL: $${Number(d.grand_total).toLocaleString("es-CL")} + IVA`);
  }
  const missing = nextMissing(d);
  if (missing) status.push(`FALTA: "${missing}"`);
  return status.join("\n");
}

// Paso 1: GPT decide acciones (tool calling only)
async function orchestratorPass1(session, userText) {
  if (necesitaHumano(userText)) {
    session.data.stageKey = "escalado_humano";
    return { handoff: true, content: `Entiendo, le conecto con nuestro equipo directamente.\n📱 ${COMPANY.PHONE}\n⏰ Lun-Vie 9:00-18:00 | Sáb 9:00-13:00` };
  }

  const perfil = detectarPerfil(userText, session);
  const statusCtx = buildStatusContext(session);

  const msgs = [
    { role: "system", content: SYSTEM_PROMPT + getAdminRulesText() },
    { role: "system", content: statusCtx + `\n\nPERFIL CLIENTE: ${perfil} (tecnico=${session.perfilAcumulado?.tecnico || 0} / emocional=${session.perfilAcumulado?.emocional || 0})` },
    ...session.history.slice(-20),
    { role: "user", content: userText },
  ];

  try {
    const r = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: msgs,
      tools,
      tool_choice: "auto",
      parallel_tool_calls: false,
      temperature: 0.3,
      max_tokens: 500,
    });
    const msg = r.choices?.[0]?.message;
    return {
      handoff: false,
      tool_calls: msg?.tool_calls || [],
      content: msg?.content || "",
    };
  } catch (e) {
    logErr("orchestratorPass1", e);
    return { handoff: false, tool_calls: [], content: "Dame un segundo… 🔍" };
  }
}

// Paso 2: GPT genera texto final DESPUÉS de las acciones ejecutadas
async function orchestratorPass2(session, userText, actionsResult) {
  const perfil = detectarPerfil(userText, session);
  const statusCtx = buildStatusContext(session);

  const contextInfo = [
    `ESTADO ACTUAL: ${statusCtx}`,
    `ACCIONES EJECUTADAS: ${JSON.stringify(actionsResult)}`,
    `PDF ENVIADO: ${session.pdfSent ? "SÍ, ya fue enviado al cliente" : "NO"}`,
    `NOMBRE CLIENTE: ${session.data?.name || "desconocido"}`,
    `COMUNA: ${session.data?.comuna || "desconocida"}`,
    session.data?.name ? `IMPORTANTE: Ya conoces a este cliente. Salúdalo por su nombre si vuelve.` : "",
  ].filter(Boolean).join("\n");

  const msgs = [
    { role: "system", content: SYSTEM_PROMPT + getAdminRulesText() },
    { role: "system", content: `${contextInfo}\n\nPERFIL: ${perfil}\n\nINSTRUCCIÓN: Genera SOLO el texto de respuesta al cliente. NO prometas enviar nada. Si el PDF ya fue enviado, no lo menciones de nuevo. Si faltan datos, pregunta. Sé breve (2-3 líneas máx).` },
    ...session.history.slice(-14),
    { role: "user", content: userText },
  ];

  try {
    const r = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: msgs,
      temperature: 0.4,
      max_tokens: 350,
    });
    return (r.choices?.[0]?.message?.content || "").replace(/<PROFILE:\w+>/gi, "").trim();
  } catch (e) {
    logErr("orchestratorPass2", e);
    return "Listo, ¿en qué más le ayudo?";
  }
}

/* =========================
   9d) VOICE NOTE — Conversión MP3→OGG Opus + envío como nota de voz
   Si ffmpeg no está instalado, envía como audio MP3 adjunto (fallback)
   ========================= */

let _ffmpegAvailable = null;

async function checkFfmpeg() {
  if (_ffmpegAvailable !== null) return _ffmpegAvailable;
  try {
    const { execSync } = await import("child_process");
    execSync("ffmpeg -version", { stdio: "ignore" });
    _ffmpegAvailable = true;
    logInfo("ffmpeg", "ffmpeg disponible — notas de voz OGG Opus habilitadas");
  } catch {
    _ffmpegAvailable = false;
    logInfo("ffmpeg", "ffmpeg NO disponible — audio se envía como MP3 adjunto");
  }
  return _ffmpegAvailable;
}

async function convertToOggOpus(mp3Buffer) {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  const ts = Date.now();
  const mp3Path = `/tmp/voice_${ts}.mp3`;
  const oggPath = `/tmp/voice_${ts}.ogg`;
  
  fs.writeFileSync(mp3Path, mp3Buffer);
  await execAsync(`ffmpeg -i ${mp3Path} -c:a libopus -b:a 32k -ac 1 -ar 48000 ${oggPath} -y`);
  const oggBuf = fs.readFileSync(oggPath);
  
  // Cleanup
  try { fs.unlinkSync(mp3Path); } catch {}
  try { fs.unlinkSync(oggPath); } catch {}
  
  return oggBuf;
}

async function sendVoiceOrAudio(to, text, incomingType = "text") {
  if (!shouldSendVoice(incomingType)) return false;

  try {
    await waTyping(to);
    const audioBuf = await ttsElevenlabs(text);
    
    const hasFfmpeg = await checkFfmpeg();
    
    if (hasFfmpeg) {
      // Nota de voz real (OGG Opus + voice: true)
      const oggBuf = await convertToOggOpus(audioBuf);
      const mediaId = await waUploadAudio(oggBuf, "audio/ogg; codecs=opus", `voice_${Date.now()}.ogg`);
      await axiosWA.post(`/${META.PHONE_ID}/messages`, {
        messaging_product: "whatsapp",
        to,
        type: "audio",
        audio: { id: mediaId, voice: true },
      });
      logInfo("TTS", `🎙️ nota de voz OGG enviada a ${to}`);
    } else {
      // Fallback: audio MP3 adjunto (siempre funciona)
      const { mime, ext } = elevenLabsMimeInfo();
      const mediaId = await waUploadAudio(audioBuf, mime, `reply_${Date.now()}.${ext}`);
      await waSendAudio(to, mediaId);
      logInfo("TTS", `🔊 audio MP3 enviado a ${to}`);
    }
    return true;
  } catch (e) {
    logErr("sendVoiceOrAudio", e);
    return false;
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
const SESSION_TTL = 48 * 3_600_000; // 48 horas — el bot recuerda al cliente por 2 días
const MAX_HIST = 50; // Más historial = bot recuerda mejor la conversación

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
   15) SYSTEM PROMPT — Ferrari 10.2 VENDEDOR CONSULTIVO + ORCHESTRATOR
   ========================= */
const SYSTEM_PROMPT = `
Eres MARCELO CIFUENTES, asesor técnico-comercial de ventanas y puertas de ${COMPANY.NAME} (${COMPANY.ADDRESS}).
Consultor certificado MINVU Resolución 266/2025. Evaluador energético de envolventes térmicos.
8 años asesorando en la Araucanía. Hablas por WhatsApp como un profesional chileno real: cálido, respetuoso (siempre de "usted") y directo.

═══ REGLA #1 — CERO REPETICIONES Y MENSAJES CORTOS (CRÍTICO) ═══
MÁXIMO 2-3 líneas por mensaje. Esto es WhatsApp.
NUNCA repitas el mismo mensaje o estado. Revisa el historial:
- Si ya avisaste que vas a generar la propuesta, NO lo repitas.
- Si el cliente ya recibió la propuesta, NO le vuelvas a decir "Propuesta lista". Avanza: pregúntale qué le pareció o si tiene dudas.

═══ REGLA #2 — PROHIBIDO PROMETER ADJUNTOS FALSOS (CRÍTICO) ═══
Tú eres la IA, tú NO envías el PDF directamente. El PDF lo envía el sistema DESPUÉS de que uses update_quote.
NUNCA digas "le adjunto", "aquí tiene", "se la envié", "le mando la propuesta" a menos que ya veas en el historial que el PDF fue generado.
Cuando vayas a cotizar, di SOLAMENTE: "Deme un segundito, voy a ingresar los datos al sistema para armar su propuesta."
Solo cuando el sistema confirme el envío, el cliente recibirá el PDF automáticamente.

═══ REGLA #3 — CORRECCIONES = EJECUTAR HERRAMIENTA (CRÍTICO) ═══
Si el cliente pide modificar la cotización ("cámbialo a corredera", "el ancho es 1500", "agrega otra ventana"):
ESTÁS OBLIGADO a ejecutar update_quote con la lista COMPLETA de items actualizada.
NUNCA respondas "listo, lo corregí" sin haber ejecutado la herramienta.

═══ REGLA #4 — TIPO DE VENTANA POR DEFECTO (CRÍTICO) ═══
Si el cliente da medidas pero NO especifica tipo de apertura:
ASUME SIEMPRE que es CORREDERA (product: "CORREDERA").
NUNCA asumas MARCO_FIJO a menos que diga "paño fijo", "que no se abra" o "vitrina".
Puedes validar: "Consideré ventanas de corredera, que es lo más habitual. ¿Buscaba otro tipo?"

═══ TU MISIÓN — VENDER CON VALOR ═══
No vendes ventanas. Vendes confort, protección y ahorro para la familia.
Una ventana protege a quienes amas: hogar cálido, silencioso y eficiente.
Una buena ventana dura más de 20 años y se paga sola en ahorro de calefacción.
TU TRABAJO es que el cliente ENTIENDA esto antes de hablar de precio.

═══ TONO Y CONEXIÓN HUMANA ═══
Tratas de "usted" siempre. Eres cercano, cálido y confiable.
Usa analogías: "una ventana es como el abrigo de su casa".
SIEMPRE muestra interés genuino por su situación antes de vender.
Ejemplos buenos:
  "¿Qué le molesta más en su casa hoy? ¿El frío, el ruido, la humedad?"
  "Con esas medidas le va a quedar espectacular, va a notar la diferencia altiro."
Ejemplos MALOS (nunca):
  "Le ofrecemos soluciones integrales de fenestración..."
  "Nuestro sistema cuenta con 4 cámaras de aislación..."

═══ FLUJO DE CONVERSACIÓN ═══
1. SALUDO — Usa el saludo correcto según la hora de Chile:
   Antes de 12:00 → "Buenos días"
   12:00 a 20:00 → "Buenas tardes"
   Después de 20:00 → "Buenas noches"
   Presentación PRIMERA VEZ: "[saludo], soy Marcelo Cifuentes, Ing. Consultor externo del MINVU, Resolución 266/2025 en eficiencia energética. ¿En qué puedo ayudarle?"
   Si el cliente ya dio datos (medidas, tipo, etc.) en su PRIMER mensaje, no hagas preguntas genéricas. Di: "[saludo], soy Marcelo Cifuentes. Voy a preparar su propuesta con los datos que me envía."
   SIEMPRE habla de "propuesta" (no cotización, no presupuesto).
2. ESCUCHAR: ¿Frío? ¿Ruido? ¿Proyecto nuevo? UNA pregunta, ESPERA respuesta.
3. CONECTAR: Reformula su necesidad.
4. EDUCAR: "¿Sabía que con termopanel reduce el frío hasta un 50%?"
5. DATOS MÍNIMOS — OBLIGATORIO antes de ejecutar update_quote:
   a) NOMBRE: Si no lo tienes, pregunta: "¿Con quién tengo el gusto?" — SIEMPRE antes de cotizar.
   b) PRODUCTOS: tipo, medidas y cantidad.
   c) COLOR: Si no dice, pregunta: "¿Tiene algún color en mente? Tenemos blanco, nogal, roble, grafito y negro."
   d) COMUNA: "¿En qué comuna está?" — NUNCA pidas dirección.
   REGLA DURA: Si falta CUALQUIERA de estos 4 datos, PREGUNTA antes de llamar update_quote.
   NUNCA ejecutes update_quote sin nombre del cliente.
   NUNCA saltes directo a cotizar sin preguntar los datos que faltan.
6. COTIZAR: Solo cuando tengas los 4 datos. Avisa "Voy a ingresar los datos al sistema" y ejecuta update_quote.
7. CERRAR: Visita técnica gratuita sin compromiso.

═══ INSTALACIÓN — REGLA ABSOLUTA ═══
NUNCA preguntes si quiere instalación. SIEMPRE va incluida.
Sin instalación profesional pierden la garantía (5 años estructura, 1 año herrajes).

═══ DETECCIÓN DE PERFIL (interno, JAMÁS decirle al cliente) ═══
EMOCIONAL: frío, ruido, familia, confort → "su familia va a estar más cómoda"
TÉCNICO: Uw, OGUC, DVH, normas → datos duros breves
MIXTO: beneficio emocional primero, dato técnico después.

═══ ARGUMENTOS DE VALOR ═══
CONFORT: "Temperatura estable, sin corrientes. Zona de confort todo el año."
AHORRO: "30-50% menos en calefacción. Se paga sola en pocos años."
SALUD: "Menos condensación, menos hongos."
DURABILIDAD: "Más de 20 años. Colores que no se descascaran (Renolit)."
NORMATIVA: "Cumplimos OGUC 4.1.10 desde 2025."
GARANTÍA: "5 años estructura, 1 año herrajes."
CERTIFICACIÓN: "Evaluadores certificados MINVU Resolución 266/2025."

═══ MANEJO DE OBJECIONES ═══
"Es caro" → "Dura 20+ años y ahorra 30-50% en calefacción. El PVC barato dura 6-8."
"Lo pienso" → "¿Qué dato le falta para sentirse seguro?"
"Vi más barato" → "¿Qué marca? Le explico la diferencia técnica."
"Solo precio" → "Le preparo la propuesta. ¿Qué le molesta de sus ventanas actuales?"

═══ TIPOS DE PRODUCTO EN update_quote ═══
  "corredera"/"sliding"/sin especificar → product: "CORREDERA"
  "proyectante" → product: "PROYECTANTE"
  "abatible" → product: "ABATIBLE"
  "fijo"/"paño fijo" → product: "MARCO_FIJO"
  "puerta" → product: "PUERTA_1H"
  "oscilobatiente" → product: "OSCILOBATIENTE"
Si modifica items, envía lista COMPLETA con update_quote.

═══ LENGUAJE AL CLIENTE ═══
NUNCA "S60", "Sliding", "S75". Di "PVC línea europea".
NUNCA precios en chat. Solo en PDF.
NUNCA pedir dirección. Solo COMUNA.
NUNCA preguntar por instalación.

═══ PRODUCTOS (info interna) ═══
Proyectantes/abatibles: 4 cámaras, 60mm, DVH. Máx 1930×1930mm.
Correderas: 2 cámaras, doble/triple riel. Hasta 2930×2150mm.
COLORES: Blanco, Nogal, Roble, Grafito, New Black.

═══ AUDIO Y VOZ ═══
Si el cliente manda audio, responde normal. El sistema envía audio automáticamente.
NUNCA "solo puedo responder por texto". Si no puede leer: "Le mando por audio."

═══ REGLAS DURAS ═══
Solo WinHouse PVC y Sodal Aluminio.
update_quote UNA vez con todos los items.
NUNCA ejecutes update_quote sin tener el NOMBRE del cliente. Si no lo tienes, pregunta primero.
Visita técnica gratuita sin compromiso.
Si no sabes → "Lo verifico y le confirmo hoy mismo."
No descuentes sin autorización. No inventes datos técnicos.
NUNCA repitas el mismo mensaje. Si ya lo dijiste, avanza.
`.trim();

const tools = [
  {
    type: "function",
    function: {
      name: "update_quote",
      description:
        "Crea o actualiza la cotización. REGLA: Si el cliente pide modificar ALGO (tipo, medida, color, cantidad), ESTÁS OBLIGADO a enviar el array 'items' COMPLETO con la corrección aplicada. NUNCA digas 'lo corrijo' sin ejecutar esta herramienta.",
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
                  description: "OBLIGATORIO. Tipo de apertura. REGLA: Si el cliente NO especifica el tipo, SIEMPRE usar 'CORREDERA'. NUNCA usar 'MARCO_FIJO' a menos que diga 'paño fijo', 'vitrina' o 'que no se abra'. Si dice 'ventana' sin más, usar CORREDERA.",
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
  session.data.stageKey = "escalado_humano";
  
  // Enviar alerta con contexto completo al owner
  fireAndForget("handoff.notify", async () => {
    await notifyHandoff(waSend, normPhone(session.waId || ""), session, "Cliente solicitó hablar con humano");
  });
  
  return {
    role: "assistant",
    content: `Entiendo, le conecto con nuestro equipo directamente. En este momento le estoy enviando toda la información de su consulta a nuestro especialista.\n\n📱 ${COMPANY.PHONE}\n⏰ Lun-Vie 9:00-18:00 | Sáb 9:00-13:00\n\nUn momento por favor, ya le contactamos.`,
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
    { role: "system", content: SYSTEM_PROMPT + getAdminRulesText() },
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
/* =========================
   17) QUOTE APPLY — SOLO COTIZADOR WINHOUSE, ESCALAR SI FALLA
   ========================= */
async function priceAll(d, customer_id = "") {
  if (!ALLOWED_SUPPLIERS.includes(d.supplier)) d.supplier = "WINHOUSE_PVC";
  d.items = sortItemsForCotizador(d.items);

  if (!d.items.length) {
    return { ok: false, error: "No hay items para cotizar.", escalate: false };
  }

  // Solo WinHouse PVC con cotizador automático
  if (d.supplier !== "WINHOUSE_PVC") {
    return {
      ok: false,
      error: "La línea de aluminio requiere validación manual.",
      escalate: true,
      reason: "supplier_manual",
    };
  }

  // Si no está configurado el cotizador → escalar
  if (!cotizadorWinhouseConfigured()) {
    return {
      ok: false,
      error: "El cotizador automático no está disponible en este momento.",
      escalate: true,
      reason: "cotizador_not_configured",
    };
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
    return {
      ok: false,
      error: "Uno o más ítems requieren validación manual.",
      escalate: true,
      reason: "unsupported_items",
    };
  }

  const payload = {
    items: mapped.map((x) => x.payload),
    cliente: {
      nombre: d.name || "Cliente WhatsApp",
      telefono: customer_id || "",
    },
  };

  const r = await cotizarWinhouse(payload);

  // Si el cotizador no respondió o falló → escalar
  if (!r.ok || !r.json) {
    return {
      ok: false,
      error: r.json?.error || r.error || "Cotizador WinHouse no disponible.",
      escalate: true,
      reason: r.isTimeout ? "cotizador_timeout" : "cotizador_error",
    };
  }

  const applied = applyCotizadorResultToSessionItems(d.items, r.json);
  d.grand_total = Number(r.json?.resumen?.subtotal_neto || applied.total || 0) || null;

  if (applied.escaladas > 0) {
    return {
      ok: false,
      error: "La cotización requiere revisión de especialista.",
      partial: true,
      total: d.grand_total,
      escalate: true,
      reason: "partial_cotization",
    };
  }

  return {
    ok: true,
    total: d.grand_total,
    source: "cotizador_winhouse",
    escalate: false,
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
        it.descripcion || `${tipo} | Color: ${color} | Medidas: ${measures}mm | Vidrio: ${glass} | Perfiles certificados IFT Rosenheim | Laminado Renolit | Cumple OGUC 4.1.10 | Instalación profesional incluida | Garantía 5 años estructura + 1 año herrajes`;
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
    v: "10.2.2-prod",
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
// Multi-channel routes (Instagram DM + Facebook Messenger)
registerMultiChannelRoutes(app, {
  processMessage: async ({ channel, senderId, senderName, text, msgId, sendFn }) => {
    // Enviar el mensaje al pipeline de Sales-OS para tracking
    try {
      const payload = buildMultiChannelPayload(channel, senderId, senderName, text, "inbound", "customer");
      await pushLeadEvent(payload);
    } catch (e) {
      logErr("multiChannel.push", e);
    }
 
    // Respuesta automática del bot (mismo flujo que WhatsApp)
    // Para IG/FB usamos una respuesta simplificada con IA
    try {
      const systemPrompt = `Eres el asistente de Activa Inversiones, fábrica de ventanas PVC termopanel en Temuco.
Servicios: ventanas, puertas, cierres de terraza, cortinas de cristal, muros cortina, tabiques.
Comunas: Temuco, Villarrica, Pucón, Padre Las Casas.
Responde brevemente y amable. Si el cliente quiere cotizar, pídele que nos escriba por WhatsApp al +56 9 8441 2961 para una cotización detallada con nuestro sistema automatizado.
Si es una consulta simple, responde directamente.`;
 
      const aiResp = await openai.chat.completions.create({
        model: process.env.AI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        max_tokens: 300,
      });
 
      const reply = aiResp.choices?.[0]?.message?.content || "Gracias por contactarnos. Escríbenos al +56 9 8441 2961 por WhatsApp para una atención personalizada.";
 
      await sendFn(senderId, reply);
 
      // Trackear respuesta del bot
      const outPayload = buildMultiChannelPayload(channel, senderId, senderName, reply, "outbound", "assistant");
      await pushLeadEvent(outPayload);
    } catch (e) {
      logErr("multiChannel.aiReply", e);
      // Fallback: respuesta genérica
      try {
        await sendFn(senderId, "¡Hola! Gracias por contactarnos. Para una cotización personalizada, escríbenos por WhatsApp al +56 9 8441 2961. ¡Te esperamos!");
      } catch (e2) {
        logErr("multiChannel.fallback", e2);
      }
    }
  },
  waSend,
  logInfo,
  logErr,
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
  _lastMsgId = msgId;

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
      const imgMeta = await waMediaUrl(inc.imageId);
      const { buffer, mime } = await waDownload(imgMeta.url);

      // ADMIN: imagen = hoja de tabla de precios
      if (ses.adminMode === true) {
        try {
          const b64 = buffer.toString("base64");
          const vr = await openai.chat.completions.create({
            model: AI_MODEL,
            messages: [{
              role: "user",
              content: [
                { type: "text", text: "Analiza esta tabla de precios de ventanas PVC. La primera columna son ALTOS (mm), la primera fila son ANCHOS (mm). Donde se intersectan está el PRECIO (entero sin separadores). Extrae en JSON: { \"modelo\": \"\", \"color\": \"\", \"vidrio\": \"\", \"anchos\": [], \"altos\": [], \"precios\": [[]], \"metadata\": {} }. Si no puedes leer un valor usa null. Responde SOLO JSON." },
                { type: "image_url", image_url: { url: `data:${mime};base64,${b64}`, detail: "high" } },
              ],
            }],
            max_tokens: 4096,
          });
          let raw = (vr.choices?.[0]?.message?.content || "").trim();
          raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
          let parsed;
          try { parsed = JSON.parse(raw); } catch {
            await waSendH(waId, "❌ No pude leer la tabla. Intente con mejor resolución.", true);
            return;
          }
          if (!parsed.anchos?.length || !parsed.altos?.length || !parsed.precios?.length) {
            await waSendH(waId, "❌ No parece una tabla de precios válida.", true);
            return;
          }
          if (!ses.pendingTablePages) ses.pendingTablePages = [];
          ses.pendingTablePages.push(parsed);
          const pageNum = ses.pendingTablePages.length;
          const merged = mergeTablePages(ses.pendingTablePages);
          saveSession(waId, ses);
          const safeColor = typeof parsed.color === "string" ? parsed.color : (typeof parsed.color === "object" ? JSON.stringify(parsed.color) : String(parsed.color || "?"));
          const safeModelo = typeof parsed.modelo === "string" ? parsed.modelo : String(parsed.modelo || "?");
          await waSendH(waId, `📊 HOJA ${pageNum} RECIBIDA ✅\n\nModelo: ${safeModelo}\nColor: ${safeColor}\nEsta hoja: ${parsed.anchos.length} anchos × ${parsed.altos.length} altos\n\nACUMULADO: ${merged.anchos.length} anchos × ${merged.altos.length} altos\n\n¿Más hojas? Envíe imagen.\nSi ya están todas → ADMIN TABLA LISTA`, true);
          return;
        } catch (e) {
          logErr("admin.vision_table", e);
          await waSendH(waId, `❌ Error: ${e.message}`, true);
          return;
        }
      }

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

      if (adminCmd.type === "admin_tablas") {
        await waSendH(waId, `📊 Cotizador: ${cotizadorWinhouseConfigured() ? "✅ Online" : "❌ Offline"}\n\nPara actualizar precios:\n1. Envíe imagen de tabla\n2. El sistema analiza con IA\n3. Escriba ADMIN TABLA LISTA\n4. Confirme con ADMIN APLICAR TABLA`, true);
        return;
      }

      if (adminCmd.type === "admin_precio") {
        const q = adminCmd.query;
        const m = normMeasures(q);
        const colorMatch = q.match(/\b(blanco|nogal|roble|grafito|newblack|negro)\b/i);
        const tipoMatch = q.match(/\b(corredera|proyectante|abatible|puerta|fijo)\b/i);
        if (!m) {
          await waSendH(waId, "❌ Formato: ADMIN PRECIO corredera 1500x1200 blanco", true);
          return;
        }
        const testItem = {
          tipo: "ventana",
          serie: (tipoMatch?.[1] || "").toLowerCase().includes("corredera") ? "SLIDING" : "S60",
          apertura: (tipoMatch?.[1] || "proyectante").toLowerCase(),
          color: normColor(colorMatch?.[1] || "blanco").toLowerCase(),
          ancho: m.ancho_mm,
          alto: m.alto_mm,
          cantidad: 1,
          hoja: "98",
          vidrio: process.env.DEFAULT_GLASS || "DVH 4+12+4 CL",
        };
        try {
          const r = await cotizarWinhouse({ items: [testItem], cliente: { nombre: "Test Admin" } });
          if (r.ok && r.json?.items?.[0]) {
            const it = r.json.items[0];
            const precio = it.precio_unitario || it.total || "N/A";
            const metodo = it.metodo || "desconocido";
            const tabla = it.tabla_usada || "?";
            const notas = (it.notas || []).join("\n") || "Sin notas";
            await waSendH(waId, `💰 PRECIO TEST\n\n${testItem.apertura} ${m.ancho_mm}×${m.alto_mm} ${testItem.color}\n\nPrecio: $${Number(precio).toLocaleString("es-CL")}\nMétodo: ${metodo}\nTabla: ${tabla}\n\n${notas}`, true);
          } else {
            await waSendH(waId, `⚠️ ${r.json?.escalaciones?.[0]?.razon || r.error || "No cotizable"}`, true);
          }
        } catch (e) {
          await waSendH(waId, `❌ Error: ${e.message}`, true);
        }
        return;
      }

      if (adminCmd.type === "admin_voice_config") {
        const vc = {
          enabled: VOICE_ENABLED,
          provider: VOICE_TTS_PROVIDER,
          mode: VOICE_SEND_MODE,
          elevenlabs_key: ELEVENLABS_API_KEY ? "✅ configurada" : "❌ falta",
          elevenlabs_voice: ELEVENLABS_VOICE_ID ? `✅ ...${ELEVENLABS_VOICE_ID.slice(-8)}` : "❌ falta",
          format: ELEVENLABS_OUTPUT_FORMAT,
        };
        await waSendH(waId, `🎙️ VOZ CONFIG\n\n${Object.entries(vc).map(([k,v]) => `${k}: ${v}`).join("\n")}`, true);
        return;
      }

      if (adminCmd.type === "admin_table_ready") {
        if (!ses.pendingTablePages || ses.pendingTablePages.length === 0) {
          await waSendH(waId, "❌ No hay hojas pendientes. Envíe imágenes primero.", true);
          return;
        }
        const merged = mergeTablePages(ses.pendingTablePages);
        const totalPages = ses.pendingTablePages.length;
        ses.pendingTableUpdate = merged;
        ses.pendingTablePages = null;
        saveSession(waId, ses);
        const totalCells = merged.anchos.length * merged.altos.length;
        const nullCells = merged.precios.flat().filter(p => p === null).length;
        const quality = Math.round(((totalCells - nullCells) / totalCells) * 100);
        const allPrices = merged.precios.flat().filter(p => p !== null && !isNaN(p));
        const minPrice = allPrices.length ? Math.min(...allPrices) : 0;
        const maxPrice = allPrices.length ? Math.max(...allPrices) : 0;

        // Preview detallado: mostrar altos, anchos y muestra de precios
        const altosStr = merged.altos.slice(0, 8).join(", ") + (merged.altos.length > 8 ? ` ...+${merged.altos.length - 8} más` : "");
        const anchosStr = merged.anchos.slice(0, 8).join(", ") + (merged.anchos.length > 8 ? ` ...+${merged.anchos.length - 8} más` : "");

        // Muestra de precios: esquinas de la tabla
        const fmt = (v) => v != null && !isNaN(v) ? `$${Number(v).toLocaleString("es-CL")}` : "—";
        const lastRow = merged.precios.length - 1;
        const lastCol = merged.anchos.length - 1;
        const samplePrices = [
          `${merged.altos[0]}×${merged.anchos[0]}: ${fmt(merged.precios[0]?.[0])}`,
          `${merged.altos[0]}×${merged.anchos[lastCol]}: ${fmt(merged.precios[0]?.[lastCol])}`,
          `${merged.altos[lastRow]}×${merged.anchos[0]}: ${fmt(merged.precios[lastRow]?.[0])}`,
          `${merged.altos[lastRow]}×${merged.anchos[lastCol]}: ${fmt(merged.precios[lastRow]?.[lastCol])}`,
        ].join("\n");

        // Primer mensaje: resumen
        await waSendH(waId, `📊 TABLA UNIDA — ${totalPages} hoja(s)\n\nModelo: ${String(merged.modelo || "?")}\nColor: ${String(merged.color || "?")}\n\n${merged.anchos.length} anchos × ${merged.altos.length} altos\n${totalCells} celdas (${quality}% con precio)\n\nRango: ${fmt(minPrice)} — ${fmt(maxPrice)}`, true);
        
        // Segundo mensaje: preview de datos
        await waSendH(waId, `📐 ALTOS (columna izquierda):\n${altosStr}\n\n📏 ANCHOS (fila superior):\n${anchosStr}\n\n💰 MUESTRA DE PRECIOS (alto×ancho):\n${samplePrices}\n\n→ ADMIN APLICAR TABLA para confirmar\n→ ADMIN CANCELAR para descartar`, true);
        return;
      }

      if (adminCmd.type === "admin_apply_table") {
        if (!ses.pendingTableUpdate) {
          await waSendH(waId, "❌ No hay tabla pendiente. Envíe imágenes y luego ADMIN TABLA LISTA.", true);
          return;
        }
        try {
          const parsed = ses.pendingTableUpdate;
          const modelo = (parsed.modelo || "tabla").toLowerCase().replace(/\s+/g, "_");
          const color = (parsed.color || "blanco").toLowerCase();
          const tableId = `${modelo}_${color}`;
          const cotizadorUrl = process.env.COTIZADOR_BASE_URL || "";
          const adminKey = process.env.ADMIN_API_KEY || process.env.COTIZADOR_API_KEY || "";
          const r = await fetch(`${cotizadorUrl}/api/tablas/upload`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-Key": adminKey },
            body: JSON.stringify({ tabla_id: tableId, ...parsed }),
          });
          if (r.ok) {
            ses.pendingTableUpdate = null;
            saveSession(waId, ses);
            await waSendH(waId, `✅ Tabla "${tableId}" aplicada.\n\nPruebe: ADMIN PRECIO corredera 1500x1200 blanco`, true);
          } else {
            const err = await r.text();
            await waSendH(waId, `❌ Error: ${err.slice(0, 200)}`, true);
          }
        } catch (e) {
          await waSendH(waId, `❌ Error: ${e.message}`, true);
        }
        return;
      }

      if (adminCmd.type === "admin_cancel") {
        ses.pendingTableUpdate = null;
        ses.pendingTablePages = null;
        saveSession(waId, ses);
        await waSendH(waId, "✅ Operación cancelada.", true);
        return;
      }

      if (adminCmd.type === "admin_add_rule") {
        const rule = adminCmd.rule;
        if (!rule || rule.length < 5) {
          await waSendH(waId, "❌ Regla muy corta. Ejemplo:\nADMIN REGLA nunca preguntes por instalación, siempre incluirla", true);
          return;
        }
        adminDynamicRules.push(rule);
        await waSendH(waId, `✅ Regla #${adminDynamicRules.length} agregada:\n"${rule}"\n\nEl bot ya la aplica desde ahora.`, true);
        logInfo("admin_rules", `Regla agregada: ${rule}`);
        return;
      }

      if (adminCmd.type === "admin_list_rules") {
        if (adminDynamicRules.length === 0) {
          await waSendH(waId, "📋 No hay reglas admin activas.\n\nPara agregar:\nADMIN REGLA [instrucción]", true);
          return;
        }
        const list = adminDynamicRules.map((r, i) => `${i + 1}. ${r}`).join("\n\n");
        await waSendH(waId, `📋 REGLAS ACTIVAS (${adminDynamicRules.length}):\n\n${list}\n\nPara borrar: ADMIN BORRAR REGLA [número]`, true);
        return;
      }

      if (adminCmd.type === "admin_del_rule") {
        const n = adminCmd.ruleNum;
        if (isNaN(n) || n < 1 || n > adminDynamicRules.length) {
          await waSendH(waId, `❌ Regla ${n} no existe. Hay ${adminDynamicRules.length} reglas.`, true);
          return;
        }
        const removed = adminDynamicRules.splice(n - 1, 1)[0];
        await waSendH(waId, `✅ Regla #${n} eliminada:\n"${removed}"`, true);
        logInfo("admin_rules", `Regla eliminada: ${removed}`);
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

      // === RESET ===
    if (/^reset|nueva cotizaci[oó]n|empezar de nuevo/i.test(userText)) {
      ses.data = emptyData();
      ses.pdfSent = false;
      ses.followupEnviado = false;
      ses.perfilAcumulado = { tecnico: 0, emocional: 0 };
      await waSendH(waId, "Listo, empecemos de cero.\n¿Qué ventanas o puertas necesita?", true);
      saveSession(waId, ses);
      return;
    }

    // === LÓGICA ANTI-BUCLE + ESCALACIÓN INTELIGENTE A MARCELO ===
    // === LÓGICA ANTI-BUCLE + ESCALACIÓN POR PRODUCTO (VERSIÓN LIMPIA Y ORDENADA) ===
    const t = userText.toLowerCase().trim();

    // 1. Productos que SIEMPRE se escalan (no son PVC europea)
    const specialProductKeywords = [
      "templado", "vidrio templado", "mampara", "cierre de terraza", 
      "cierre terraza", "celosia", "celosía", "aluminio", "cortina", 
      "reja", "reja de seguridad"
    ];
    const isSpecialProduct = specialProductKeywords.some(kw => t.includes(kw));

    // 2. Frustración del cliente
    const frustradoKeywords = ["ya", "chao", "basta", "mal humor", "repetis", "me tiene harto", "no amigo", "ya te dije", "ya envié", "ya mandé", "ya te lo", "perder el tiempo", "pierdo el tiempo", "me voy", "adiós", "adios", "frustrado", "hartó", "me cansé", "olvídelo"];
    const isFrustrated = frustradoKeywords.some(word => t.includes(word));

    // 3. Escalación (producto especial o frustración)
    if (isSpecialProduct || isFrustrated) {
      const agente = process.env.AGENT_NAME || "Marcelo Cifuentes";
      
      await waSendH(waId, `✅ Entendido. Te voy a pasar directamente con nuestro ingeniero especialista ${agente} ahora mismo para que te atienda personalmente.`, true);
      
      // Videos mientras espera
      await waSendH(waId, `Mientras tanto te envío estos videos de nuestra fábrica y oficina:\n\n🏭 Video Planta: ${process.env.PLANT_VIDEO_URL}\n🏢 Video Oficina: ${process.env.OFFICE_VIDEO_URL}`, true);
      
      // Resumen para ti + Zoho CRM
      const summary = buildEscalationSummary(ses, userText);
      await sendEscalationAlert(summary, normPhone(process.env.ESCALATION_PHONE || process.env.OWNER_NOTIFICATION_PHONE), ses.data);
      
      return;
    }

    // 4. Cliente ya envió medidas (flujo normal PVC)
    if (t.includes("adjunto") || t.includes("envié") || t.includes("mandé") || t.includes("ya te lo") || t.includes("fb.me") || t.includes("medidas")) {
      ses.data.medidasEnviadas = true;
      await waSendH(waId, `✅ Recibí tus medidas. Gracias!\n\nAhora dime:\n• Color (blanco, nogal, grafito, negro)\n• Comuna`, true);
      saveSession(waId, ses);
      return;
    }

    // 5. Normalizar tipo de apertura (todos los modelos WinHouse son válidos)
    if (t.includes("normal") || t.includes("normales") || 
        t.includes("abatible") || t.includes("oscilobatiente") || t.includes("proyectante") || 
        t.includes("fijo") || t.includes("corredera") || t.includes("sliding") || 
        t.includes("basculante") || t.includes("plegable")) {
      ses.data.default_tipo = normTipoApertura(userText);
    }

    // 6. Avance directo si ya tiene medidas
    if (ses.data.medidasEnviadas && 
        (t.includes("blanco") || t.includes("nogal") || t.includes("roble") || t.includes("dorado") ||
         t.includes("grafito") || t.includes("antracita") || t.includes("gris") || t.includes("plomo") ||
         t.includes("negro") || t.includes("new black") || t.includes("color"))) {
      ses.data.default_color = normColor(userText);
      await procesarCotizacionCompleta(waId, ses);
      return;
    }

    // 7. Lógica normal (todas las ventanas y puertas PVC)
    ses.history.push({ role: "user", content: userText });

    // ═══ ORCHESTRATOR 2-PASS — Fase 2 ═══
    // Paso 1: GPT decide acciones (tool calls)
    const pass1 = await orchestratorPass1(ses, userText);

    // Handoff humano
    if (pass1.handoff) {
      await waSendH(waId, pass1.content, false);
      ses.history.push({ role: "assistant", content: pass1.content });
      saveSession(waId, ses);
      return;
    }

    // Paso 2: Ejecutar acciones (update_quote, cotizar, PDF)
    const actionsResult = { quoted: false, pdfSent: false, escalated: false, errors: [] };

    if (pass1.tool_calls?.length) {
      for (const tc of pass1.tool_calls) {
        if (tc.function?.name !== "update_quote") continue;
        let args = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch { continue; }

        const d = ses.data;
        if (args.supplier && ALLOWED_SUPPLIERS.includes(args.supplier)) d.supplier = args.supplier;
        else d.supplier = detectSupplier(userText + " " + safeJson(args));

        for (const k of ["name", "default_color", "comuna", "address", "project_type", "install", "notes"]) {
          if (args[k] != null && args[k] !== "") d[k] = args[k];
        }
        if (args.wants_pdf === true) d.wants_pdf = true;

        if (Array.isArray(args.items) && args.items.length > 0) {
          ses.pdfSent = false;
          d.wants_pdf = false;
          d.items = args.items.map((it, i) => ({
            id: i + 1,
            product: it.product || "",
            measures: it.measures || "",
            qty: Math.max(1, Number(it.qty) || 1),
            color: it.color || "",
            unit_price: null, total_price: null, price_warning: "", source: null, confidence: null,
          }));

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

        // Cotizar si tenemos datos completos
        if (canQuote(d)) {
          const qr = await priceAll(d, "");
          if (qr.ok && qr.total) {
            d.grand_total = qr.total;
            actionsResult.quoted = true;
            try {
              const hvResult = await notifyHighValue(waSend, normPhone(waId), session, "auto");
              if (hvResult.sent) {
                logInfo("highValue", `Alerta ${hvResult.tier} enviada para ${normPhone(waId)}`);
              }
            } catch (e) {
              logErr("highValue.check", e);
            }
          } else {
            for (const it of d.items) it.price_warning = qr.error || "No pude cotizar";
            d.grand_total = qr.total || null;
            if (qr.escalate) {
              actionsResult.escalated = true;
              fireAndForget("escalation.cotizador", sendEscalationAlert(
                `Cotización escalada: ${qr.reason || qr.error}`, normPhone(waId), d
              ));
            }
          }
        }

        // Detectar problemas de fabricación
        const needsEscalation = d.items.some(it => it.needs_escalation);
        const hasSuggestions = d.items.filter(it => it.suggested_product);

        if (hasSuggestions.length > 0 && !needsEscalation) {
          const sugMsgs = hasSuggestions.map(it => {
            const m = normMeasures(it.measures);
            return `La medida ${m?.ancho_mm}×${m?.alto_mm} es grande para ${it.product}. Le recomiendo corredera para esa medida.`;
          });
          await waSendSmartMultiH(waId, sugMsgs, false, { incomingType: type });
          await waSendSmartH(waId, "¿Le parece si ajusto la cotización con corredera?", false, { incomingType: type });
          ses.history.push({ role: "assistant", content: sugMsgs.join("\n") + "\n¿Ajusto con corredera?" });
          saveSession(waId, ses);
          try { await zhUpsert(ses, waId); } catch (e) { logErr("zhUpsert-suggestion", e); }
          return;
        }

        if (needsEscalation) {
          actionsResult.escalated = true;
          const reasons = d.items.filter(it => it.needs_escalation).map(it => it.dim_warning).join("; ");
          await waSendH(waId, "Algunas medidas necesitan validación técnica. Le paso con nuestro equipo.", false);
          fireAndForget("escalation.dimensions", sendEscalationAlert(`Medidas fuera de rango: ${reasons}`, normPhone(waId), d));
          ses.history.push({ role: "assistant", content: "Medidas necesitan validación técnica." });
          saveSession(waId, ses);
          try { await zhUpsert(ses, waId); } catch (e) { logErr("zhUpsert-escalation", e); }
          return;
        }
      }
    }

    // Paso 2b: Generar y enviar PDF si corresponde
    const d = ses.data;
    const shouldSendPdf = isComplete(d) && d.grand_total && !ses.pdfSent &&
      !d.items.some(it => it.source === "cotizador_manual" || it.needs_escalation) &&
      (d.wants_pdf || actionsResult.quoted || /pdf|cotiza|cotizaci[oó]n|formal|env[ií]a|manda|propuesta/i.test(userText));

    if (shouldSendPdf) {
      const qn = `COT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      ses.quoteNum = qn;
      d.quote_num = qn;

      // Resumen breve
      const resumenLines = ["📋 Le preparo su propuesta con lo siguiente:"];
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
      await waSendH(waId, resumenLines.join("\n"), true);
      await sleep(800);
      await waSendH(waId, "Generando su propuesta… 📄 Mientras le preparo el documento, le comparto un poco de nuestra empresa.", true);

      // Enviar videos de la empresa mientras se genera el PDF
      const videoSources = [
        { url: process.env.VIDEO_PLANTA, label: "🏭 Nuestra planta de producción" },
        { url: process.env.VIDEO_OFICINA, label: "🏢 Nuestras oficinas" },
        { url: process.env.VIDEO_OFICINA2, label: "🏢 Recorrido por nuestras instalaciones" },
        { url: process.env.VIDEO_INSTALACIONES, label: "🏠 Proyectos terminados" },
        { url: process.env.VIDEO_INSTALACIONES2, label: "🏠 Más trabajos realizados" },
        { url: process.env.VIDEO_PLANTA2, label: "🏭 Proceso de fabricación" },
      ].filter(v => v.url);
      // Enviar máximo 3 videos para no saturar
      for (const v of videoSources.slice(0, 3)) {
        await waSend(waId, `${v.label}\n${v.url}`);
        await sleep(600);
      }

      try {
        const estimate = await zhBooksCreateEstimate(d, d.name || "Cliente WhatsApp", normPhone(waId));
        if (estimate?.estimate_id) {
          ses.zohoEstimateId = estimate.estimate_id;
          cubicacionPendientes.delete(waId);
          
          const pdfBuf = await zhBooksDownloadEstimatePdf(estimate.estimate_id);
          await waSendPdf(waId, pdfBuf, `${qn}.pdf`, `Propuesta ${qn} — Si quiere ajustar algo, me avisa.`);
          
          ses.pdfSent = true;
          d.stageKey = "propuesta";
          actionsResult.pdfSent = true;

          try {
            await zhUpsert(ses, waId);
            if (ses.zohoDealId && estimate.estimate_number) {
              logInfo("pdf_sent_tracking", `PDF enviado a ${waId} | ${ses.data.name || "Sin nombre"} | ${estimate.estimate_number}`);
              await zhNote("Deals", ses.zohoDealId, `Cotización ${qn}`, `Estimate: ${estimate.estimate_number}\nTotal: $${Number(d.grand_total).toLocaleString("es-CL")} +IVA`);
            }
          } catch (e) { logErr("zhUpsert-post-pdf", e); }

          fireAndForget("trackQuoteEvent.formal", trackQuoteEvent(buildQuotePayload(ses, waId, {
            status: "formal_sent", zoho_estimate_id: estimate.estimate_id,
            zoho_estimate_url: estimate.estimate_url || "", quote_number: qn,
          })));
        }
      } catch (e) {
        logErr("Estimate", e);
        actionsResult.errors.push("pdf_generation_failed");
        await waSendH(waId, "Tuve un problema generando la propuesta. Se la preparo manual y se la envío en breve 🙏", true);
        fireAndForget("escalation.pdf-fail", sendEscalationAlert(`Fallo PDF para ${d.name || "cliente"}`, normPhone(waId), d));
      }
    }

    // Paso 3: GPT genera texto final DESPUÉS de las acciones
    // Solo si NO enviamos PDF (para no duplicar mensajes)
    if (!actionsResult.pdfSent) {
      let reply = "";
      
      // Si hubo tool calls, usar pass2 para generar respuesta contextualizada
      if (pass1.tool_calls?.length) {
        reply = await orchestratorPass2(ses, userText, actionsResult);
      } else {
        // Sin tool calls, usar el contenido de pass1 (respuesta conversacional)
        reply = (pass1.content || "").replace(/<PROFILE:\w+>/gi, "").trim();
      }

      if (!reply) {
        if (!isComplete(d)) {
          reply = `Perfecto, para avanzar necesito: ${nextMissing(d)}.`;
        } else if (!d.grand_total) {
          const hasManual = d.items.some(it => it.source === "cotizador_manual" || it.price_warning);
          reply = hasManual
            ? "Hay una validación técnica pendiente. Le derivaré con un especialista."
            : "Ya tengo los datos. Hubo un tema con el cotizador, en breve le confirmo.";
        } else {
          reply = "Listo, ¿en qué más le puedo ayudar?";
        }
      }

      // Enviar como voz o texto según contexto
      const voiceSent = await sendVoiceOrAudio(waId, reply, type);
      if (!voiceSent) {
        const parts = smartSplitForWhatsApp(reply);
        if (parts.length > 1) await waSendSmartMultiH(waId, parts, false, { incomingType: type });
        else await waSendSmartH(waId, parts[0], false, { incomingType: type });
      }

      ses.history.push({ role: "assistant", content: reply });
      try { await zhUpsert(ses, waId); } catch (e) { logErr("zhUpsert-inline", e); }
    } else {
      // PDF enviado — no enviar texto adicional, el caption del PDF es suficiente
      ses.history.push({ role: "assistant", content: `[PDF enviado: ${ses.quoteNum}]` });
    }

    saveSession(waId, ses);
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
function buildEscalationSummary(ses, lastMessage) {
  let summary = `🚨 ESCALACIÓN - Cliente frustrado\n\n`;
  summary += `📱 Teléfono: ${normPhone ? normPhone(ses.waId || '') : 'Desconocido'}\n`;
  summary += `👤 Nombre: ${ses.data?.name || 'No dijo'}\n`;
  summary += `🏠 Comuna: ${ses.data?.comuna || 'No dijo'}\n`;
  summary += `📏 Medidas: ${ses.data?.items ? JSON.stringify(ses.data.items) : 'No guardadas aún'}\n`;
  summary += `🎨 Color: ${ses.data?.default_color || 'No dijo'}\n`;
  summary += `🔄 Tipo: ${ses.data?.default_tipo || 'CORREDERA (por defecto)'}\n`;
  summary += `💬 Último mensaje del cliente: "${lastMessage}"\n\n`;
  summary += `📋 Estado actual: ${ses.data?.medidasEnviadas ? 'Medidas enviadas' : 'Sin medidas'}`;
  return summary;
}
function normColor(text) {
  if (!text) return "BLANCO";
  const t = text.toLowerCase().trim();

  if (t.includes("blanco") || t.includes("white")) return "BLANCO";
  if (t.includes("nogal") || t.includes("roble") || t.includes("madera") || t.includes("dorado")) return "NOGAL";
  if (t.includes("grafito") || t.includes("antracita") || t.includes("gris") || t.includes("plomo")) return "GRAFITO";
  if (t.includes("negro") || t.includes("black") || t.includes("new black")) return "NEGRO";

  return "BLANCO"; // default
}

function normTipoApertura(text) {
  const t = text.toLowerCase();
  if (t.includes("abatible") || t.includes("abatir")) return "ABATIBLE";
  if (t.includes("oscilobatiente") || t.includes("oscilo")) return "OSCILOBATIENTE";
  if (t.includes("proyectante") || t.includes("proy")) return "PROYECTANTE";
  if (t.includes("fijo") || t.includes("marco fijo")) return "FIJO";
  if (t.includes("corredera") || t.includes("sliding")) return "CORREDERA";
  if (t.includes("basculante")) return "BASCULANTE";
  if (t.includes("plegable")) return "PLEGABLE";
  return "CORREDERA"; // más común
}
app.listen(PORT, () => {
  console.log(
    `🚀 Ferrari 10.2.2-prod — Marcelo Cifuentes MINVU — port=${PORT} pricer=${PRICER_MODE} cotizador=${cotizadorWinhouseConfigured() ? "OK" : "NO"} zoho_books=${ZOHO.ORG_ID ? "OK" : "NO"} escalation=${ESCALATION_PHONE ? "ON" : "OFF"} voice=${VOICE_ENABLED ? VOICE_TTS_PROVIDER : "OFF"} ffmpeg=checking`
  );
});
