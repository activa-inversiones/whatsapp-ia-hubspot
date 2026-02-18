// index.js — WhatsApp IA + Zoho CRM
// Ferrari 7.0 — MOTOR COMPLETO 30 ECUACIONES + TYPING HUMANO + ZOHO MEJORADO
// Node 18+ | Railway | ESM
//
// ────────────────────────────────────────────────────────────
// CHANGELOG
// ─ Ferrari 7.0 (HOY)
//   [1] 30 ecuaciones reales (R²>0.99): Proyectante, Corredera 80/98,
//       Oscilobatiente, Abatible, Marco Fijo, Puerta 1H, Puerta Doble.
//       Colores: Blanco, Negro/Antracita/Grafito, Nogal/Roble Dorado.
//       Vidrios: TP4+12+4 y TP5+12+5.
//   [2] Typing humano: delay progresivo + indicador "escribiendo" visible.
//   [3] Zoho: No actualiza Deals cerrados; crea nuevo si el anterior finalizó.
//   [4] PDF con try/catch específico y mensaje al usuario si falla.
//   [5] Reglas mejoradas: Marco Fijo auto 5+12+5 desde 1000×2000,
//       Puerta flexible (no requiere exactamente 2400 alto para doble),
//       Corredera 80→98 auto, Proyectante max 1400×1400.
//   [6] Vidrio siempre Termopanel (no se pregunta, se informa).
//   [7] Precio NO es fallback: si no hay ecuación, informa al humano.
//
// ─ Ferrari 6.5.0 (anterior)
//   Motor ecuaciones inicial + Stages Zoho auto.
// ────────────────────────────────────────────────────────────

import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import crypto from "crypto";
import FormData from "form-data";
import PDFDocument from "pdfkit";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { createRequire } from "module";

dotenv.config();

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const app = express();

app.use(
  express.json({
    limit: "20mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ============================================================
// HELPER LOGS
// ============================================================
function logError(context, e) {
  if (e.response) {
    console.error(`❌ ${context} [API]: ${e.response.status} - ${JSON.stringify(e.response.data).slice(0, 150)}...`);
  } else if (e.request) {
    console.error(`❌ ${context} [Network]: Sin respuesta.`);
  } else {
    console.error(`❌ ${context} [Code]: ${e.message}`);
  }
}

// ============================================================
// ENV CONFIGURATION
// ============================================================
const PORT = process.env.PORT || 8080;
const TZ = process.env.TZ || "America/Santiago";

const META = {
  GRAPH_VERSION: process.env.META_GRAPH_VERSION || "v22.0",
  TOKEN: process.env.WHATSAPP_TOKEN,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  APP_SECRET: process.env.APP_SECRET || "",
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL_OPENAI || "gpt-4o-mini";
const STT_MODEL = process.env.AI_MODEL_STT || "whisper-1";

const AUTO_SEND_PDF_WHEN_READY = false;

const REQUIRE_ZOHO = String(process.env.REQUIRE_ZOHO || "true") === "true";
const ZOHO = {
  CLIENT_ID: process.env.ZOHO_CLIENT_ID,
  CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET,
  REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN,
  REDIRECT_URI: process.env.ZOHO_REDIRECT_URI,
  API_DOMAIN: process.env.ZOHO_API_DOMAIN || "https://www.zohoapis.com",
  ACCOUNTS_DOMAIN: process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.com",
  LEAD_PROFILE_FIELD: process.env.ZOHO_LEAD_PROFILE_FIELD || "",
  DEAL_PROFILE_FIELD: process.env.ZOHO_DEAL_PROFILE_FIELD || "",
  DEAL_PHONE_FIELD: process.env.ZOHO_DEAL_PHONE_FIELD || "WhatsApp_Phone",
  DEFAULT_ACCOUNT_NAME: process.env.ZOHO_DEFAULT_ACCOUNT_NAME || "Clientes WhatsApp IA",
};

const COMPANY = {
  NAME: process.env.COMPANY_NAME || "Activa Inversiones",
  PHONE: process.env.COMPANY_PHONE || "+56 9 1234 5678",
  EMAIL: process.env.COMPANY_EMAIL || "ventas@activa.cl",
  ADDRESS: process.env.COMPANY_ADDRESS || "Temuco, La Araucanía, Chile",
  WEBSITE: process.env.COMPANY_WEBSITE || "www.activa.cl",
  RUT: process.env.COMPANY_RUT || "76.XXX.XXX-X",
};

const STAGE_MAP = {
  diagnostico: process.env.ZOHO_STAGE_DIAGNOSTICO || "Diagnóstico y Perfilado",
  siembra: process.env.ZOHO_STAGE_SIEMBRA || "Siembra de Confianza + Marco Normativo (OGUC/RT)",
  propuesta: process.env.ZOHO_STAGE_PROPUESTA || "Presentación de Propuesta",
  objeciones: process.env.ZOHO_STAGE_OBJECIONES || "Incubadora de Objeciones",
  validacion: process.env.ZOHO_STAGE_VALIDACION || "Validación Técnica y Normativa",
  cierre: process.env.ZOHO_STAGE_CIERRE || "Cierre y Negociación",
  ganado: process.env.ZOHO_STAGE_GANADO || "Cerrado ganado",
  perdido: process.env.ZOHO_STAGE_PERDIDO || "Cerrado perdido",
  competencia: process.env.ZOHO_STAGE_COMPETENCIA || "Perdido y cerrado para la competencia",
};

// ============================================================
// VALIDACIÓN ENV
// ============================================================
function assertEnv() {
  const missing = [];
  if (!META.TOKEN) missing.push("WHATSAPP_TOKEN");
  if (!META.PHONE_NUMBER_ID) missing.push("PHONE_NUMBER_ID");
  if (!META.VERIFY_TOKEN) missing.push("VERIFY_TOKEN");
  if (!OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (missing.length) {
    console.error("[FATAL] Missing ENV:", missing.join(", "));
    process.exit(1);
  }
}
assertEnv();

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ============================================================
// UTILIDADES
// ============================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeCLPhone(raw) {
  const s = String(raw || "").replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("56")) return `+${s}`;
  return `+${s}`;
}

function stripAccents(s) {
  return String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function normalizeYesNo(v) {
  const s = stripAccents(String(v || "")).trim().toLowerCase();
  if (!s) return "";
  if (["si", "sí", "s", "1", "true", "y", "yes"].includes(s)) return "Sí";
  if (["no", "n", "0", "false"].includes(s)) return "No";
  return "";
}

// ============================================================
// MOTOR DE PRECIOS — Ferrari 7.0 (30 ECUACIONES)
// ============================================================

// 1) Normalizar medidas
function normalizeMeasures(measures) {
  const t = String(measures || "").toLowerCase();
  let nums = t.match(/(\d+([.,]\d+)?)/g);
  if (!nums || nums.length < 2) return null;

  let a = parseFloat(nums[0].replace(",", "."));
  let b = parseFloat(nums[1].replace(",", "."));

  // Convertir m → mm
  if (a < 10) a *= 1000;
  if (b < 10) b *= 1000;
  // Convertir cm → mm
  if (a >= 10 && a < 100) a *= 10;
  if (b >= 10 && b < 100) b *= 10;

  return { ancho_mm: Math.round(a), alto_mm: Math.round(b) };
}

// 2) Normalización color
function normalizeColorFromText(text = "") {
  const s = stripAccents(text).toUpperCase();
  if (s.includes("ANTRAC") || s.includes("GRAF") || s.includes("NEG")) return "NEGRO";
  if (s.includes("ROBLE") || s.includes("NOG")) return "NOGAL";
  return "BLANCO";
}

// 3) Normalización producto
function normalizeProduct(productRaw = "") {
  const s = stripAccents(productRaw).toUpperCase();
  if (s.includes("PUERTA") && s.includes("DOBLE")) return "PUERTA_DOBLE";
  if (s.includes("PUERTA")) return "PUERTA_1H";
  if (s.includes("PROYEC")) return "PROYECTANTE";
  if (s.includes("MARCO") || s.includes("FIJO") || s.includes("PAÑO FIJO")) return "MARCO_FIJO";
  if (s.includes("OSCILO")) return "OSCILOBATIENTE";
  if (s.includes("ABAT")) return "ABATIBLE";
  if (s.includes("CORREDERA") && s.includes("98")) return "CORREDERA_98";
  if (s.includes("CORREDERA") && s.includes("80")) return "CORREDERA_80";
  if (s.includes("CORREDERA")) return "CORREDERA_80";
  return "";
}

// 4) Normalización vidrio — SIEMPRE Termopanel
function normalizeGlass(glassRaw = "", defaultGlass = "TP4+12+4") {
  const s = stripAccents(glassRaw).toUpperCase();
  if (s.includes("5") && s.includes("12") && s.includes("5")) return "TP5+12+5";
  if (s.includes("4") && s.includes("12") && s.includes("4")) return "TP4+12+4";
  return defaultGlass;
}

// 5) Ecuación polinomial cuadrática
function priceFromCoeffs(coeffs, W, H) {
  const { a, b, c, d, e, f } = coeffs;
  const p = a + b * W + c * H + d * W * H + e * W * W + f * H * H;
  return Math.max(0, Math.round(p));
}

// 6) 30 COEFICIENTES REALES (generados por regresión R²>0.99)
const COEFFS = {

  // ── PUERTA 1 HOJA ──
  "PUERTA_1H::BLANCO::TP5+12+5": { a: 140774.582793, b: 18.161109, c: 36.598, d: 0.087093, e: 0.003442, f: -0.000988 },
  "PUERTA_1H::NEGRO::TP5+12+5": { a: 136832.585686, b: 47.770892, c: 66.207826, d: 0.087094, e: 0.003442, f: -0.000988 },
  "PUERTA_1H::NOGAL::TP5+12+5": { a: 137833.638438, b: 36.344893, c: 54.781762, d: 0.087094, e: 0.003442, f: -0.000988 },

  // ── PUERTA DOBLE ──
  "PUERTA_DOBLE::BLANCO::TP5+12+5": { a: 223084.863334, b: 18.232115, c: 55.494761, d: 0.087159, e: 0.001817, f: 0.000216 },
  "PUERTA_DOBLE::NEGRO::TP5+12+5": { a: 218725.942486, b: 43.117996, c: 110.017003, d: 0.087159, e: 0.001817, f: 0.000216 },
  "PUERTA_DOBLE::NOGAL::TP5+12+5": { a: 218922.885265, b: 34.146149, c: 90.007215, d: 0.087159, e: 0.001817, f: 0.000216 },

  // ── PROYECTANTE ──
  "PROYECTANTE::BLANCO::TP4+12+4": { a: 93548.645326, b: -30.823707, c: 68.482926, d: 0.079552, e: 0.019776, f: -0.026583 },
  "PROYECTANTE::BLANCO::TP5+12+5": { a: 108444.380887, b: -44.190236, c: 55.116397, d: 0.09396, e: 0.022492, f: -0.023867 },
  "PROYECTANTE::NEGRO::TP4+12+4": { a: 92245.006628, b: -8.897146, c: 90.409487, d: 0.080084, e: 0.020179, f: -0.02618 },
  "PROYECTANTE::NEGRO::TP5+12+5": { a: 105845.459974, b: -20.96214, c: 78.344493, d: 0.09396, e: 0.022492, f: -0.023867 },
  "PROYECTANTE::NOGAL::TP4+12+4": { a: 81120.764272, b: -0.587106, c: 98.719527, d: 0.063244, e: 0.016374, f: -0.029985 },
  "PROYECTANTE::NOGAL::TP5+12+5": { a: 106430.380887, b: -29.800236, c: 69.506397, d: 0.09396, e: 0.022492, f: -0.023867 },

  // ── CORREDERA 80 ──
  "CORREDERA_80::BLANCO::TP4+12+4": { a: 288644.431252, b: -52.732017, c: -10.077752, d: 0.068299, e: 0.023932, f: 0.01804 },
  "CORREDERA_80::NEGRO::TP4+12+4": { a: 285900.945907, b: -33.286621, c: 21.766293, d: 0.068299, e: 0.023932, f: 0.01804 },
  "CORREDERA_80::NOGAL::TP4+12+4": { a: 285355.906296, b: -34.58202, c: 23.594244, d: 0.068299, e: 0.023931, f: 0.01804 },

  // ── CORREDERA 98 ──
  "CORREDERA_98::BLANCO::TP4+12+4": { a: 200794.930979, b: 25.492856, c: 58.515348, d: 0.085762, e: 0.00143, f: 0.001321 },
  "CORREDERA_98::NEGRO::TP4+12+4": { a: 196881.373936, b: 48.390907, c: 97.360714, d: 0.085762, e: 0.00143, f: 0.001322 },
  "CORREDERA_98::NOGAL::TP4+12+4": { a: 196744.481728, b: 45.642901, c: 95.359865, d: 0.085762, e: 0.00143, f: 0.001322 },

  // ── OSCILOBATIENTE ──
  "OSCILOBATIENTE::BLANCO::TP4+12+4": { a: 185445.942542, b: -11.949828, c: -35.952898, d: 0.079576, e: 0.003727, f: 0.021043 },
  "OSCILOBATIENTE::NEGRO::TP4+12+4": { a: 182993.641254, b: 11.032265, c: -12.970805, d: 0.079576, e: 0.003727, f: 0.021043 },
  "OSCILOBATIENTE::NOGAL::TP4+12+4": { a: 183550.507284, b: 1.346391, c: -22.65668, d: 0.079576, e: 0.003727, f: 0.021043 },

  // ── VENTANA ABATIBLE ──
  "ABATIBLE::BLANCO::TP4+12+4": { a: 185140.969136, b: -27.253272, c: -30.388035, d: 0.079552, e: 0.011874, f: 0.020013 },
  "ABATIBLE::NEGRO::TP4+12+4": { a: 182492.838095, b: -3.899302, c: -7.034065, d: 0.079552, e: 0.011874, f: 0.020013 },
  "ABATIBLE::NOGAL::TP4+12+4": { a: 183076.105732, b: -12.733179, c: -15.867942, d: 0.079552, e: 0.011874, f: 0.020012 },

  // ── MARCO FIJO ──
  "MARCO_FIJO::BLANCO::TP4+12+4": { a: 89814.059277, b: -26.167455, c: -26.108744, d: 0.08151, e: 0.009919, f: 0.009872 },
  "MARCO_FIJO::NEGRO::TP4+12+4": { a: 89372.572681, b: -13.927503, c: -13.868792, d: 0.08151, e: 0.009919, f: 0.009872 },
  "MARCO_FIJO::NOGAL::TP4+12+4": { a: 89361.683792, b: -19.035466, c: -18.976755, d: 0.08151, e: 0.009919, f: 0.009872 },
  "MARCO_FIJO::BLANCO::TP5+12+5": { a: 37445.721826, b: 12.423452, c: 12.412658, d: 0.085223, e: 0.001145, f: 0.001128 },
  "MARCO_FIJO::NEGRO::TP5+12+5": { a: 37028.291129, b: 24.537476, c: 24.526681, d: 0.085223, e: 0.001145, f: 0.001128 },
  "MARCO_FIJO::NOGAL::TP5+12+5": { a: 58741.971131, b: 27.118663, c: 27.107868, d: 0.070598, e: 0.000064, f: 0.000047 },
};

// 7) Reglas de selección dataset
function resolvePricingKey({ product, colorText, glass, W, H }) {
  let model = product;
  let COLOR = normalizeColorFromText(colorText);
  let GLASS = glass;
  const rulesApplied = [];

  if (!model) return { ok: false, reason: "Producto no reconocido" };

  // PROYECTANTE: máximo 1400×1400
  if (model === "PROYECTANTE" && (W > 1400 || H > 1400)) {
    return { ok: false, reason: "PROYECTANTE solo se fabrica hasta 1400×1400 mm. Para medidas mayores, te sugiero Corredera u Oscilobatiente." };
  }

  // MARCO FIJO: auto TP5+12+5 desde 1000×2000
  if (model === "MARCO_FIJO" && (W >= 1000 && H >= 2000)) {
    GLASS = "TP5+12+5";
    rulesApplied.push("MARCO_FIJO auto vidrio TP5+12+5 (>=1000×2000 por seguridad)");
  }

  // PUERTAS: 1 hoja o doble hoja (MEJORADO: más flexible)
  if (model === "PUERTA_1H") {
    if (W <= 1200 && H <= 2400) {
      rulesApplied.push("PUERTA 1 HOJA (ancho ≤1200, alto ≤2400)");
    } else if (W > 1200) {
      model = "PUERTA_DOBLE";
      rulesApplied.push("PUERTA => DOBLE HOJA (ancho >1200mm)");
    } else {
      return { ok: false, reason: "Puerta 1 hoja: máximo 1200mm ancho × 2400mm alto." };
    }
    GLASS = "TP5+12+5";
    rulesApplied.push("PUERTA fuerza vidrio TP5+12+5");
  }

  if (model === "PUERTA_DOBLE") {
    if (W < 600 || W > 2400) return { ok: false, reason: "Puerta doble: ancho entre 600mm y 2400mm." };
    if (H > 2400) return { ok: false, reason: "Puerta doble: alto máximo 2400mm." };
    GLASS = "TP5+12+5";
    rulesApplied.push("PUERTA DOBLE fuerza vidrio TP5+12+5");
  }

  // CORREDERA 80: si supera 2000mm en ambos ejes → 98
  if (model === "CORREDERA_80") {
    if (W < 400 || H < 400) return { ok: false, reason: "CORREDERA 80 mínimo 400×400 mm" };
    if (W > 2000 && H > 2000) {
      model = "CORREDERA_98";
      rulesApplied.push("CORREDERA_80 => CORREDERA_98 (>2000×2000)");
    } else if (W > 2000 || H > 2000) {
      model = "CORREDERA_98";
      rulesApplied.push("CORREDERA_80 => CORREDERA_98 (supera 2000mm)");
    }
  }

  const key = `${model}::${COLOR}::${GLASS}`;
  return { ok: true, model, color: COLOR, glass: GLASS, key, rulesApplied };
}

// 8) Motor de cotización principal
function quotePriceEngine({ productText, glassText, measuresText, colorText }) {
  const m = normalizeMeasures(measuresText);
  if (!m) return { ok: false, reason: "No pude leer las medidas. Ej: 1200×1200 o 1.2×1.2" };

  const W = m.ancho_mm;
  const H = m.alto_mm;

  const product = normalizeProduct(productText);
  // Vidrio por defecto: siempre Termopanel
  const glass = normalizeGlass(glassText || "", "TP4+12+4");
  const fullColorText = `${productText} ${colorText || ""} ${glassText || ""}`;

  const resolved = resolvePricingKey({ product, colorText: fullColorText, glass, W, H });
  if (!resolved.ok) return resolved;

  const coeffs = COEFFS[resolved.key];
  if (coeffs) {
    const price = priceFromCoeffs(coeffs, W, H);
    return { ok: true, price, mode: "equation", resolved, measures: m };
  }

  // SIN ecuación → escalar a humano (NO fallback impreciso)
  return {
    ok: false,
    reason: `No tengo la ecuación exacta para ${resolved.key}. Escalaré a Equipo Alfa para cotización manual.`,
    resolved,
    measures: m,
  };
}

// ============================================================
// ZOHO: Stage automático
// ============================================================
function computeStageKey(d, session) {
  if (d.stageKey === "cierre") return "cierre";
  if (session.pdfSent) return "propuesta";
  const hasProduct = !!d.product;
  const hasMeasures = !!d.measures;
  const hasComuna = !!(d.comuna || d.address);
  const hasGlass = !!d.glass;
  if (hasProduct && hasMeasures && hasComuna && hasGlass) return "validacion";
  if (hasProduct || hasMeasures) return "siembra";
  return "diagnostico";
}

function buildZohoDescription(d) {
  const lines = [];
  lines.push(`Producto: ${d.product || ""}`.trim());
  lines.push(`Color: ${d.color || ""}`.trim());
  lines.push(`Medidas: ${d.measures || ""}`.trim());
  lines.push(`Vidrio: ${d.glass || ""}`.trim());
  if (d.internal_price) lines.push(`Precio: $${Number(d.internal_price).toLocaleString("es-CL")}`);
  if (d.price_mode) lines.push(`Modo precio: ${d.price_mode}`);
  if (d.price_key) lines.push(`Dataset: ${d.price_key}`);
  if (d.price_rules && d.price_rules.length) lines.push(`Reglas: ${d.price_rules.join(" | ")}`);
  if (d.price_warning) lines.push(`Aviso: ${d.price_warning}`);
  return lines.filter(Boolean).join("\n");
}

// ============================================================
// FECHAS / UTILS
// ============================================================
function formatDateZoho(date = new Date()) {
  return date.toISOString().split("T")[0];
}

function formatDateCL(date = new Date()) {
  return date.toLocaleDateString("es-CL", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function generateQuoteNumber() {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = (now.getMonth() + 1).toString().padStart(2, "0");
  const d = now.getDate().toString().padStart(2, "0");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `COT-${y}${m}${d}-${rand}`;
}

// ============================================================
// TYPING HUMANO — Ferrari 7.0 (NUEVO)
// ============================================================
// Calcula delay basado en longitud del texto (simula escritura real)
function humanDelayMs(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  // Mínimo 1.5s, máximo 8s, ~180ms por palabra
  const base = 1500 + Math.min(6500, words * 180);
  // Variación aleatoria ±20% para que no sea predecible
  const jitter = base * (0.8 + Math.random() * 0.4);
  return Math.round(jitter);
}

// Envía typing, espera, envía texto (se siente humano)
async function waSendTextHuman(to, text) {
  // 1) Activar "escribiendo..."
  await waSetTyping(to);
  // 2) Esperar tiempo proporcional al mensaje
  await sleep(humanDelayMs(text));
  // 3) Enviar texto
  await waSendText(to, text);
}

// Envía múltiples mensajes con pausa entre ellos (para respuestas largas)
async function waSendMultipleHuman(to, messages) {
  for (const msg of messages) {
    if (!msg || !msg.trim()) continue;
    await waSetTyping(to);
    await sleep(humanDelayMs(msg));
    await waSendText(to, msg);
    // Pausa entre mensajes consecutivos
    await sleep(400 + Math.random() * 600);
  }
}

// ============================================================
// WHATSAPP HELPERS
// ============================================================
const waBase = () => `https://graph.facebook.com/${META.GRAPH_VERSION}`;

function verifyMetaSignature(req) {
  if (!META.APP_SECRET) return true;
  const sig = req.get("X-Hub-Signature-256") || req.get("x-hub-signature-256");
  if (!sig) return false;
  if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", META.APP_SECRET).update(req.rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function waSendText(to, text) {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  try {
    await axios.post(url, {
      messaging_product: "whatsapp", to, type: "text", text: { body: text },
    }, { headers: { Authorization: `Bearer ${META.TOKEN}` }, timeout: 20000 });
  } catch (e) {
    logError("WA Send Text", e);
  }
}

// Typing indicator dedicado (NUEVO)
async function waSetTyping(to) {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  try {
    await axios.post(url, {
      messaging_product: "whatsapp",
      to,
      typing_indicator: { type: "text" },
    }, { headers: { Authorization: `Bearer ${META.TOKEN}` }, timeout: 5000 });
  } catch {
    // Ignorar silenciosamente
  }
}

async function waMarkRead(messageId) {
  if (!messageId) return;
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  try {
    await axios.post(url, {
      messaging_product: "whatsapp", status: "read", message_id: messageId,
    }, { headers: { Authorization: `Bearer ${META.TOKEN}` } });
  } catch {
    // Ignorar
  }
}

async function waUploadPdf(buffer, filename = "Cotizacion.pdf") {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/media`;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buffer, { filename, contentType: "application/pdf" });
  try {
    const r = await axios.post(url, form, {
      headers: { Authorization: `Bearer ${META.TOKEN}`, ...form.getHeaders() },
      maxBodyLength: Infinity,
    });
    return r.data.id;
  } catch (e) {
    logError("WA Upload PDF", e);
    throw e;
  }
}

async function waSendPdfById(to, mediaId, caption, filename = "Cotizacion.pdf") {
  const url = `${waBase()}/${META.PHONE_NUMBER_ID}/messages`;
  try {
    await axios.post(url, {
      messaging_product: "whatsapp", to, type: "document",
      document: { id: mediaId, filename, caption },
    }, { headers: { Authorization: `Bearer ${META.TOKEN}` } });
  } catch (e) {
    logError("WA Send PDF", e);
  }
}

async function waGetMediaMeta(mediaId) {
  const url = `${waBase()}/${mediaId}`;
  try {
    const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${META.TOKEN}` } });
    return data;
  } catch (e) {
    logError("WA Get Media", e);
    throw e;
  }
}

async function waDownloadMedia(mediaUrl) {
  try {
    const { data, headers } = await axios.get(mediaUrl, {
      responseType: "arraybuffer",
      headers: { Authorization: `Bearer ${META.TOKEN}` },
    });
    return { buffer: Buffer.from(data), mime: headers["content-type"] || "application/octet-stream" };
  } catch (e) {
    logError("WA Download Media", e);
    throw e;
  }
}

// ============================================================
// MEDIA PROCESSING
// ============================================================
async function transcribeAudio(buffer, mime) {
  try {
    const file = await toFile(buffer, "audio.ogg", { type: mime });
    const r = await openai.audio.transcriptions.create({ model: STT_MODEL, file, language: "es" });
    return (r.text || "").trim();
  } catch (e) {
    logError("OpenAI Audio", e);
    return "";
  }
}

async function describeImage(buffer, mime) {
  try {
    const b64 = buffer.toString("base64");
    const dataUrl = `data:${mime};base64,${b64}`;
    const prompt = "Describe brevemente la imagen y extrae datos útiles para cotizar ventanas/puertas: producto, medidas, color, comuna. Responde en español.";
    const resp = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUrl } }] }],
      max_tokens: 250,
    });
    return (resp.choices?.[0]?.message?.content || "").trim();
  } catch (e) {
    logError("OpenAI Vision", e);
    return "";
  }
}

async function parsePdfToText(buffer) {
  try {
    const r = await pdfParse(buffer);
    const text = (r?.text || "").trim();
    return text.length > 6000 ? text.slice(0, 6000) + "\n..." : text;
  } catch {
    return "";
  }
}

// ============================================================
// SESSIONS
// ============================================================
const sessions = new Map();
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

function createEmptySession() {
  return {
    lastUserAt: Date.now(),
    data: {
      name: "",
      product: "",
      color: "",
      measures: "",
      address: "",
      comuna: "",
      glass: "",
      install: "",
      wants_pdf: false,
      notes: "",
      profile: "",
      stageKey: "diagnostico",
      internal_price: null,
      price_mode: "",
      price_key: "",
      price_rules: [],
      price_warning: "",
    },
    history: [],
    pdfSent: false,
    quoteNumber: null,
    zohoLeadId: null,
    zohoDealId: null,
  };
}

function getSession(waId) {
  if (!sessions.has(waId)) sessions.set(waId, createEmptySession());
  return sessions.get(waId);
}

function saveSession(waId, session) {
  session.lastUserAt = Date.now();
  sessions.set(waId, session);
}

function cleanupSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [waId, s] of sessions.entries()) {
    if ((s.lastUserAt || 0) < cutoff) sessions.delete(waId);
  }
}
setInterval(cleanupSessions, 3600000);

// ============================================================
// RATE LIMITING & LOCKS
// ============================================================
const processedMsgIds = new Map();
function isDuplicateMsg(msgId) {
  if (!msgId) return false;
  if (processedMsgIds.has(msgId)) return true;
  processedMsgIds.set(msgId, Date.now());
  return false;
}
setInterval(() => {
  const cutoff = Date.now() - 7200000;
  for (const [id, ts] of processedMsgIds.entries()) if (ts < cutoff) processedMsgIds.delete(id);
}, 600000);

const locks = new Map();
async function acquireLock(waId) {
  if (locks.has(waId)) await locks.get(waId);
  let release;
  const p = new Promise((r) => (release = r));
  locks.set(waId, p);
  return () => { release(); locks.delete(waId); };
}

const rate = new Map();
function checkRate(waId) {
  const now = Date.now();
  if (!rate.has(waId)) rate.set(waId, { count: 1, resetAt: now + 60000 });
  const r = rate.get(waId);
  if (now >= r.resetAt) { r.count = 1; r.resetAt = now + 60000; return { allowed: true }; }
  r.count++;
  return r.count > 15 ? { allowed: false, msg: "Estás escribiendo muy rápido. Dame unos segundos." } : { allowed: true };
}

// ============================================================
// WEBHOOK EXTRACTION
// ============================================================
function extractIncoming(reqBody) {
  const entry = reqBody?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;

  if (value?.statuses?.length) return { ok: false, reason: "status_update" };

  const msg = value?.messages?.[0];
  if (!msg) return { ok: false, reason: "no_message" };

  const waId = msg.from;
  const msgId = msg.id;
  const type = msg.type;

  const audioId = type === "audio" ? msg.audio?.id : null;
  const imageId = type === "image" ? msg.image?.id : null;
  const docId = type === "document" ? msg.document?.id : null;
  const docMime = type === "document" ? msg.document?.mime_type : null;

  let text = "";
  if (type === "text") text = msg.text?.body || "";
  else if (type === "button") text = msg.button?.text || "";
  else if (type === "interactive") text = JSON.stringify(msg.interactive || {});
  else text = `[${type}]`;

  return { ok: true, waId, msgId, type, text, audioId, imageId, docId, docMime };
}

// ============================================================
// LÓGICA DE NEGOCIO
// ============================================================
function nextMissingKey(d) {
  if (!d.product) return "producto";
  if (!d.color) return "color";
  if (!d.measures) return "medidas";
  if (!d.address && !d.comuna) return "comuna";
  return "";
}

function isComplete(d) {
  return !!(d.product && d.color && d.measures && (d.address || d.comuna));
}

// ============================================================
// PROMPT & TOOLS
// ============================================================
const tools = [
  {
    type: "function",
    function: {
      name: "update_customer_data",
      description: "Actualiza datos del cliente. Llama SOLO cuando el cliente proporcione información nueva. El vidrio SIEMPRE es Termopanel (no preguntar).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nombre del cliente" },
          product: { type: "string", description: "Tipo: ventana proyectante, corredera, oscilobatiente, abatible, marco fijo, puerta" },
          color: { type: "string", description: "Color: blanco, negro, antracita, grafito, nogal, roble dorado" },
          measures: { type: "string", description: "Medidas ancho x alto en mm" },
          address: { type: "string", description: "Dirección o comuna" },
          comuna: { type: "string", description: "Comuna" },
          install: { type: "string", description: "Necesita instalación?" },
          wants_pdf: { type: "boolean", description: "Quiere cotización PDF?" },
          notes: { type: "string", description: "Notas adicionales" },
        },
      },
    },
  },
];

const SYSTEM_PROMPT = `
Eres un ASESOR ESPECIALISTA EN SOLUCIONES DE VENTANAS Y CERRAMIENTOS
de ${COMPANY.NAME}.

NO eres un vendedor agresivo. NO empujas ventas. NO presionas decisiones.
Tu rol es acompañar, orientar y ayudar al cliente
a tomar una BUENA decisión técnica y económica.

────────────────────────
ENFOQUE: VENTA POR VALOR
────────────────────────
Las personas compran por confianza, durabilidad,
confort térmico/acústico y respaldo.

────────────────────────
CÓMO TE COMPORTAS
────────────────────────
- Conversas como un asesor experimentado, humano y chileno.
- Escuchas primero, hablas después.
- NUNCA envíes mensajes muy largos. Máximo 3-4 líneas.
- Si necesitas decir más, divide en mensajes cortos.

────────────────────────
VIDRIO TERMOPANEL (REGLA FIJA)
────────────────────────
- SIEMPRE cotizamos con vidrio Termopanel (DVH).
  No preguntes al cliente qué vidrio quiere.
- Si el cliente pregunta, explica: "Trabajamos con Termopanel
  (doble vidrio hermético) que es el estándar para
  aislación térmica y acústica."
- Si pide vidrio monolítico u otra cosa, escala a Equipo Alfa.

────────────────────────
DATOS QUE NECESITAS (pedir de a uno, sin interrogatorio)
────────────────────────
1. Producto (qué tipo de ventana/puerta)
2. Color (blanco, negro/antracita/grafito, nogal/roble dorado)
3. Medidas (ancho × alto en mm o metros)
4. Comuna o dirección

NO preguntes por vidrio (siempre es Termopanel).

────────────────────────
PROCESO NATURAL
────────────────────────
1. Entender el proyecto.
2. Aclarar dudas y proponer soluciones.
3. Solo cuando esté claro o el cliente lo pida: ofrecer cotización formal (PDF).
Si el cliente no está listo para cotizar, NO lo empujes.

────────────────────────
TRASPASO A HUMANOS
────────────────────────
"Si quieres, un consultor del Equipo Alfa puede revisar
contigo los detalles finos del proyecto."

────────────────────────
INSTRUCCIONES TÉCNICAS
────────────────────────
1. Si el cliente entrega datos nuevos, DEBES llamar a update_customer_data.
2. Pide datos faltantes de a uno con lenguaje humano.
3. PERFILADO SILENCIOSO:
   - PRECIO → busca economía
   - CALIDAD → busca estándar alto
   - TECNICO → sabe del tema
   - AFINIDAD → compra por confianza

Al FINAL de cada respuesta, incluye SOLO UNO de estos tags:
<PROFILE:PRECIO>
<PROFILE:CALIDAD>
<PROFILE:TECNICO>
<PROFILE:AFINIDAD>
`.trim();

async function runAI(session, userText) {
  const d = session.data;
  const missingKey = nextMissingKey(d);
  const complete = isComplete(d);

  const statusMsg = complete
    ? "DATOS COMPLETOS. Puedes confirmar si quiere PDF o continuar conversando."
    : `FALTA: "${missingKey}". Pídelo amablemente en la conversación.`;

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: statusMsg },
    { role: "system", content: `Memoria actual:\n${JSON.stringify(d, null, 2)}` },
    ...session.history.slice(-12),
    { role: "user", content: userText },
  ];

  try {
    const resp = await openai.chat.completions.create({
      model: AI_MODEL,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.3,
      max_tokens: 400,
    });

    const aiMsg = resp.choices?.[0]?.message;
    if (aiMsg?.content) {
      const match = aiMsg.content.match(/<PROFILE:(\w+)>/i);
      if (match) {
        const detected = match[1].toUpperCase();
        if (["PRECIO", "CALIDAD", "TECNICO", "AFINIDAD"].includes(detected)) {
          session.data.profile = detected;
        }
      }
    }

    return aiMsg;
  } catch (e) {
    logError("OpenAI Run", e);
    return { role: "assistant", content: "Dame un segundo, reviso la info..." };
  }
}

// ============================================================
// PDF
// ============================================================
async function createQuotePdf(data, quoteNumber) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      const primaryColor = "#1a365d";
      doc.rect(0, 0, 612, 100).fill(primaryColor);
      doc.fillColor("#ffffff").fontSize(24).font("Helvetica-Bold").text(COMPANY.NAME.toUpperCase(), 50, 30);
      doc.fontSize(10).font("Helvetica").text("Ventanas y Puertas Premium", 50, 58);
      doc.fontSize(20).font("Helvetica-Bold").text("COTIZACIÓN", 400, 35, { align: "right", width: 150 });
      doc.fontSize(10).font("Helvetica").text(quoteNumber, 400, 62, { align: "right", width: 150 });

      doc.y = 120;
      doc.fillColor("#4a5568").fontSize(9);
      doc.text(`Fecha: ${formatDateCL()}`, 400, 110, { align: "right", width: 150 });

      doc.y = 160;
      doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("DATOS DEL CLIENTE", 50);
      doc.moveDown(0.5);
      doc.fillColor("#4a5568").fontSize(10).font("Helvetica");
      doc.text(`Nombre: ${data.name || "Por confirmar"}`);
      doc.text(`Contacto: WhatsApp`);

      doc.moveDown(1);
      doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("DETALLE", 50);
      doc.moveDown(0.5);

      const items = [
        ["Producto", data.product],
        ["Color", data.color],
        ["Medidas", data.measures],
        ["Vidrio", data.glass || "Termopanel DVH"],
        ["Instalación", data.install],
        ["Notas", data.notes],
      ];

      let rowY = doc.y;
      doc.font("Helvetica");
      for (const [l, v] of items) {
        if (!v) continue;
        doc.text(l, 50, rowY);
        doc.text(v, 200, rowY, { width: 350 });
        rowY += 20;
      }

      doc.y = rowY + 20;
      doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("VALOR ESTIMADO");
      let precioTexto = "Por confirmar tras visita técnica.";
      if (data.internal_price) precioTexto = `$ ${Number(data.internal_price).toLocaleString("es-CL")} + IVA (Referencial)`;

      doc.rect(50, doc.y + 5, 512, 40).fill("#f7fafc");
      doc.fillColor(primaryColor).fontSize(14).text(precioTexto, 60, doc.y + 18, { align: "center", width: 490 });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ============================================================
// ZOHO CRM — MEJORADO (no toca Deals cerrados)
// ============================================================
let zohoCache = { token: "", expiresAt: 0 };
let tokenRefreshPromise = null;

async function refreshZohoToken() {
  const url = `${ZOHO.ACCOUNTS_DOMAIN}/oauth/v2/token`;
  const params = new URLSearchParams();
  params.append("refresh_token", ZOHO.REFRESH_TOKEN);
  params.append("client_id", ZOHO.CLIENT_ID);
  params.append("client_secret", ZOHO.CLIENT_SECRET);
  params.append("grant_type", "refresh_token");
  try {
    const { data } = await axios.post(url, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    zohoCache.token = data.access_token;
    zohoCache.expiresAt = Date.now() + data.expires_in * 1000 - 60000;
    return zohoCache.token;
  } catch (e) {
    logError("Zoho Refresh Token", e);
    throw e;
  }
}

async function getZohoToken() {
  if (!REQUIRE_ZOHO) return "";
  if (zohoCache.token && Date.now() < zohoCache.expiresAt) return zohoCache.token;
  if (tokenRefreshPromise) return tokenRefreshPromise;
  tokenRefreshPromise = refreshZohoToken();
  try {
    return await tokenRefreshPromise;
  } finally {
    tokenRefreshPromise = null;
  }
}

async function zohoFindLead(phone) {
  const t = await getZohoToken();
  try {
    const r = await axios.get(
      `${ZOHO.API_DOMAIN}/crm/v2/Leads/search?criteria=(Mobile:equals:${encodeURIComponent(phone)})`,
      { headers: { Authorization: `Zoho-oauthtoken ${t}` } }
    );
    return r.data?.data?.[0];
  } catch (e) {
    if (e.response?.status !== 204) logError("Zoho Find Lead", e);
    return null;
  }
}

// MEJORADO: Busca Deal activo (no cerrado)
async function zohoFindActiveDeal(phone) {
  if (!ZOHO.DEAL_PHONE_FIELD) return null;
  const t = await getZohoToken();
  try {
    const r = await axios.get(
      `${ZOHO.API_DOMAIN}/crm/v2/Deals/search?criteria=(${ZOHO.DEAL_PHONE_FIELD}:equals:${encodeURIComponent(phone)})`,
      { headers: { Authorization: `Zoho-oauthtoken ${t}` } }
    );
    const deals = r.data?.data || [];
    // Filtrar: solo Deals que NO estén cerrados
    const closedStages = [
      STAGE_MAP.ganado, STAGE_MAP.perdido, STAGE_MAP.competencia,
      "Cerrado ganado", "Cerrado perdido",
    ];
    const active = deals.find((d) => !closedStages.includes(d.Stage));
    return active || null;
  } catch (e) {
    if (e.response?.status !== 204) logError("Zoho Find Deal", e);
    return null;
  }
}

async function zohoCreate(module, data) {
  const t = await getZohoToken();
  try {
    const r = await axios.post(
      `${ZOHO.API_DOMAIN}/crm/v2/${module}`,
      { data: [data], trigger: ["workflow"] },
      { headers: { Authorization: `Zoho-oauthtoken ${t}` } }
    );
    return r.data?.data?.[0]?.details?.id;
  } catch (e) {
    logError(`Zoho Create ${module}`, e);
    return null;
  }
}

async function zohoUpdate(module, id, data) {
  const t = await getZohoToken();
  try {
    await axios.put(
      `${ZOHO.API_DOMAIN}/crm/v2/${module}/${id}`,
      { data: [data], trigger: ["workflow"] },
      { headers: { Authorization: `Zoho-oauthtoken ${t}` } }
    );
  } catch (e) {
    logError(`Zoho Update ${module}`, e);
  }
}

async function zohoCloseDeal(dealId) {
  if (!REQUIRE_ZOHO || !dealId) return;
  try {
    await zohoUpdate("Deals", dealId, {
      Stage: "Cerrado perdido",
      Description: "Cliente reinició cotización via WhatsApp",
    });
  } catch (e) {
    logError("Zoho Close Deal", e);
  }
}

async function zohoEnsureDefaultAccountId() {
  try {
    const t = await getZohoToken();
    const name = ZOHO.DEFAULT_ACCOUNT_NAME;
    const r = await axios.get(
      `${ZOHO.API_DOMAIN}/crm/v2/Accounts/search?criteria=(Account_Name:equals:${encodeURIComponent(name)})`,
      { headers: { Authorization: `Zoho-oauthtoken ${t}` } }
    );
    if (r.data?.data?.[0]) return r.data.data[0].id;
    const c = await axios.post(
      `${ZOHO.API_DOMAIN}/crm/v2/Accounts`,
      { data: [{ Account_Name: name }] },
      { headers: { Authorization: `Zoho-oauthtoken ${t}` } }
    );
    return c.data?.data?.[0]?.details?.id;
  } catch (e) {
    logError("Zoho Account", e);
    return null;
  }
}

async function zohoUpsertFull(session, phone) {
  if (!REQUIRE_ZOHO) return;
  const d = session.data;
  const phoneE164 = normalizeCLPhone(phone);

  try {
    // Lead
    let lead = await zohoFindLead(phoneE164);
    const leadData = {
      Last_Name: d.name || `Lead WA`,
      Mobile: phoneE164,
      Lead_Source: "WhatsApp IA",
      Description: `Perfil: ${d.profile || ""}`.trim(),
    };
    if (ZOHO.LEAD_PROFILE_FIELD && d.profile) leadData[ZOHO.LEAD_PROFILE_FIELD] = d.profile;

    if (lead) await zohoUpdate("Leads", lead.id, leadData);
    else await zohoCreate("Leads", leadData);

    // Deal — MEJORADO: solo busca Deals activos
    let deal = await zohoFindActiveDeal(phoneE164);

    const stageKey = computeStageKey(d, session);
    d.stageKey = stageKey;

    const dealData = {
      Deal_Name: `${d.product || "Ventanas"} ${d.color || ""} [WA ${phone.slice(-4)}]`.trim(),
      Stage: STAGE_MAP[stageKey] || STAGE_MAP.diagnostico,
      Closing_Date: formatDateZoho(addDays(new Date(), 30)),
      Description: buildZohoDescription(d),
    };

    if (ZOHO.DEAL_PHONE_FIELD) dealData[ZOHO.DEAL_PHONE_FIELD] = phoneE164;

    if (deal) {
      session.zohoDealId = deal.id;
      await zohoUpdate("Deals", deal.id, dealData);
    } else {
      const accId = await zohoEnsureDefaultAccountId();
      if (accId) dealData.Account_Name = { id: accId };
      const newId = await zohoCreate("Deals", dealData);
      session.zohoDealId = newId;
    }
  } catch (e) {
    logError("Zoho Sync", e);
  }
}

// ============================================================
// WEBHOOK — LÓGICA PRINCIPAL
// ============================================================
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === META.VERIFY_TOKEN) return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  if (!verifyMetaSignature(req)) return;

  const incoming = extractIncoming(req.body);
  if (!incoming.ok) return;

  const { waId, msgId, type } = incoming;

  if (isDuplicateMsg(msgId)) return;
  const rateC = checkRate(waId);
  if (!rateC.allowed) return waSendText(waId, rateC.msg);

  const release = await acquireLock(waId);
  try {
    const session = getSession(waId);
    session.lastUserAt = Date.now();

    // Marcar leído inmediatamente
    await waMarkRead(msgId);
    // Mostrar "escribiendo..." inmediatamente
    await waSetTyping(waId);

    let userText = incoming.text;

    // AUDIO
    if (type === "audio" && incoming.audioId) {
      const meta = await waGetMediaMeta(incoming.audioId);
      const { buffer, mime } = await waDownloadMedia(meta.url);
      const transcribed = await transcribeAudio(buffer, mime);
      userText = transcribed ? `[Audio transcrito]: ${transcribed}` : "[Audio no reconocido]";
    }

    // IMAGEN
    if (type === "image" && incoming.imageId) {
      const meta = await waGetMediaMeta(incoming.imageId);
      const { buffer, mime } = await waDownloadMedia(meta.url);
      userText = `[Imagen]: ${await describeImage(buffer, mime)}`;
    }

    // RESET
    if (/^reset|nueva cotizaci[oó]n|empezar de nuevo/i.test(userText)) {
      if (session.zohoDealId) await zohoCloseDeal(session.zohoDealId);
      session.data = createEmptySession().data;
      session.data.name = "Cliente";
      session.zohoDealId = null;
      session.pdfSent = false;

      await waSendTextHuman(waId, "🔄 *Carpeta Nueva Abierta*\n\nHe guardado el historial anterior. Empecemos de cero, cuéntame en qué te puedo ayudar.");
      saveSession(waId, session);
      release();
      return;
    }

    // Señal de "cierre"
    if (/(acepto|confirmo|avancemos|hagamos el pedido|quiero comprar|ok coticemos)/i.test(userText)) {
      session.data.stageKey = "cierre";
    }

    session.history.push({ role: "user", content: userText });

    // Refrescar typing mientras la IA piensa
    const typingInterval = setInterval(() => waSetTyping(waId), 4000);

    const aiMsg = await runAI(session, userText);

    clearInterval(typingInterval);

    // TOOLS
    if (aiMsg?.tool_calls) {
      const tc = aiMsg.tool_calls[0];
      if (tc.function.name === "update_customer_data") {
        const args = JSON.parse(tc.function.arguments);

        // Merge datos
        for (const [k, v] of Object.entries(args)) {
          if (v !== undefined && v !== null && v !== "") {
            session.data[k] = v;
          }
        }

        // Auto-asignar vidrio Termopanel si no hay
        if (!session.data.glass && session.data.product) {
          const prod = normalizeProduct(session.data.product);
          if (["PUERTA_1H", "PUERTA_DOBLE"].includes(prod)) {
            session.data.glass = "Termopanel 5+12+5";
          } else {
            session.data.glass = "Termopanel 4+12+4";
          }
        }

        // ─── PRECIO ───
        if (isComplete(session.data) || args.wants_pdf) {
          const q = quotePriceEngine({
            productText: session.data.product,
            glassText: session.data.glass,
            measuresText: session.data.measures,
            colorText: session.data.color,
          });

          if (q.ok) {
            session.data.internal_price = q.price;
            session.data.price_mode = q.mode;
            session.data.price_key = q.resolved?.key || "";
            session.data.price_rules = q.resolved?.rulesApplied || [];
            session.data.price_warning = "";
          } else {
            session.data.internal_price = null;
            session.data.price_mode = "";
            session.data.price_key = "";
            session.data.price_rules = [];
            session.data.price_warning = q.reason || "No se pudo cotizar";
          }
        }

        const shouldSendPDF = isComplete(session.data) && (args.wants_pdf || /pdf|cotiza/i.test(userText));

        if (shouldSendPDF && !session.pdfSent) {
          await waSetTyping(waId);
          await sleep(1200);
          await waSendText(waId, "Perfecto, te preparo la cotización formal... 📄");
          await waSetTyping(waId);

          // PDF con try/catch específico
          try {
            const qNum = generateQuoteNumber();
            session.quoteNumber = qNum;
            const pdfBuf = await createQuotePdf(session.data, qNum);
            const mediaId = await waUploadPdf(pdfBuf);
            await sleep(1000);
            await waSendPdfById(waId, mediaId, `Cotización ${qNum} - ${COMPANY.NAME}`, `Cotizacion_${qNum}.pdf`);

            await sleep(1500);
            await waSetTyping(waId);
            await sleep(2000);
            await waSendText(waId, "📄 *Cotización Lista*\n\nEl *Equipo Alfa* ya tiene copia para apoyarte si necesitas revisar detalles o ajustar algo.");
            session.pdfSent = true;
          } catch (pdfErr) {
            logError("PDF Generation", pdfErr);
            await waSendTextHuman(waId, "Tuve un inconveniente generando el archivo PDF, pero no te preocupes. Un ejecutivo del *Equipo Alfa* te enviará la cotización manualmente en breve. 🙏");
          }

          await zohoUpsertFull(session, waId);
        } else {
          // Follow-up de la IA después de guardar datos
          await waSetTyping(waId);

          const follow = await openai.chat.completions.create({
            model: AI_MODEL,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              ...session.history.slice(-12),
              aiMsg,
              { role: "tool", tool_call_id: tc.id, content: "Datos guardados correctamente." },
            ],
            temperature: 0.4,
            max_tokens: 300,
          });

          const reply = follow.choices[0].message.content.replace(/<PROFILE:.*?>/gi, "").trim();

          // Dividir respuestas largas en mensajes separados
          const parts = reply.split(/\n\n+/).filter(Boolean);
          if (parts.length > 1) {
            await waSendMultipleHuman(waId, parts);
          } else {
            await waSendTextHuman(waId, reply);
          }
          session.history.push({ role: "assistant", content: reply });

          // Sync Zoho en background
          zohoUpsertFull(session, waId).catch(() => {});
        }
      }
    } else {
      // Respuesta directa sin tool call
      const reply = aiMsg?.content?.replace(/<PROFILE:.*?>/gi, "").trim() || "No te entendí bien, ¿puedes repetir?";

      const parts = reply.split(/\n\n+/).filter(Boolean);
      if (parts.length > 1) {
        await waSendMultipleHuman(waId, parts);
      } else {
        await waSendTextHuman(waId, reply);
      }
      session.history.push({ role: "assistant", content: reply });
    }

    saveSession(waId, session);
  } catch (e) {
    logError("Critical Webhook", e);
  } finally {
    release();
  }
});

app.listen(PORT, () => console.log(`🚀 Ferrari 7.0 ACTIVO — 30 ecuaciones | ${new Date().toLocaleString("es-CL", { timeZone: TZ })}`));
