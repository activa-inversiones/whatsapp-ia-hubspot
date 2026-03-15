// index.js — WhatsApp IA + Zoho Books PDF (Ferrari 9.2.3)
// Railway | Node 18+ | ESM
// CAMBIOS vs 9.2.2:
// - PDF generado en Zoho Books (no local)
// - Prompt optimizado (pregunta más eficiente)
// - Validación de source (exact/estimated)
// - Preparado para ISO (logs trazables)

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

const REQUIRE_ZOHO = String(process.env.REQUIRE_ZOHO || "true") === "true";
const ZOHO = {
  CLIENT_ID: process.env.ZOHO_CLIENT_ID,
  CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET,
  REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN,
  API: process.env.ZOHO_API_DOMAIN || "https://books.zoho.com/api/v3",  // correcto
  ACCOUNTS: process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.com",
  ORG_ID: process.env.ZOHO_ORG_ID,
  DEAL_PHONE: process.env.ZOHO_DEAL_PHONE_FIELD || "WhatsApp_Phone",
  DEFAULT_ACCT: process.env.ZOHO_DEFAULT_ACCOUNT_NAME || "Clientes WhatsApp IA",
  DEFAULT_ITEM_ID: process.env.ZOHO_DEFAULT_ITEM_ID || ""
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
const AGENT_NAME = process.env.AGENT_NAME || "Asesor ACTIVA";
const INTERNAL_OPERATOR_TOKEN =
  process.env.OPERATOR_API_TOKEN || process.env.SALES_OS_OPERATOR_TOKEN || "";
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

/* =========================
   3) VALIDATION
   ========================= */
(function assertEnv() {
  const m = [];
  if (!META.TOKEN) m.push("WHATSAPP_TOKEN");
  if (!META.PHONE_ID) m.push("PHONE_NUMBER_ID");
  if (!META.VERIFY) m.push("VERIFY_TOKEN");
  if (!OPENAI_KEY) m.push("OPENAI_API_KEY");
  if (PRICER_MODE === "winperfil" && !WINPERFIL_API_BASE) m.push("WINPERFIL_API_BASE");
  if (REQUIRE_ZOHO && (!ZOHO.CLIENT_ID || !ZOHO.REFRESH_TOKEN)) m.push("ZOHO credentials");
  if (m.length) {
    console.error("[FATAL] Faltan:", m.join(", "));
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
  return String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "");
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
  try { return JSON.stringify(x); } catch { return "{}"; }
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
    status: ses.pdfSent ? "quoted" : (isComplete(d) ? "qualified" : "new"),
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
    sessionItems[i].total_price = lineTotal || (sessionItems[i].unit_price * qty);
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
   6) ZONAS TÉRMICAS (OGUC)
   ========================= */
const ZONA_COMUNAS = {
  temuco: 5,
  "padre las casas": 5,
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

function normMeasures(raw) {
  const nums = String(raw || "").match(/(\d+([.,]\d+)?)/g);
  if (!nums || nums.length < 2) return null;
  let a = parseFloat(nums[0].replace(",", "."));
  let b = parseFloat(nums[1].replace(",", "."));
  if (a <= 6) a *= 1000;
  if (b <= 6) b *= 1000;
  if (a >= 7 && a <= 300) a *= 10;
  if (b >= 7 && b <= 300) b *= 10;
  return { ancho_mm: Math.round(a), alto_mm: Math.round(b) };
}

function normColor(text = "") {
  const s = strip(text).toUpperCase();
  if (/NOGAL|MADERA/.test(s)) return "NOGAL";
  if (/ROBLE|DORADO/.test(s)) return "ROBLE";
  if (/GRAFITO|ANTRAC/.test(s)) return "GRAFITO";
  if (/NEGR/.test(s)) return "NEGRO";
  if (/GRIS|ANODIZ/.test(s)) return "GRIS";
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
      headers, timeout: 30000, httpAgent, httpsAgent,
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
      messaging_product: "whatsapp", recipient_type: "individual", to,
      type: "text", typing_indicator: { type: "text" },
    });
  } catch {}
}

function startTypingLoop(to, ms = 8000) {
  let on = true;
  const t = async () => { if (on) await waTyping(to); };
  t();
  const id = setInterval(t, ms);
  return () => { on = false; clearInterval(id); };
}

function humanMs(text) {
  const w = String(text || "").trim().split(/\s+/).length;
  return Math.round((1200 + Math.min(6500, w * 170)) * (0.85 + Math.random() * 0.35));
}

async function waSend(to, body) {
  try {
    await axiosWA.post(`/${META.PHONE_ID}/messages`, {
      messaging_product: "whatsapp", to, type: "text", text: { body },
    });
  } catch (e) { logErr("waSend", e); }
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
  } finally { stop?.(); }
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
  } finally { stop?.(); }
}
// @patch:sales-os:send:end
async function waRead(id) {
  try {
    await axiosWA.post(`/${META.PHONE_ID}/messages`, {
      messaging_product: "whatsapp", status: "read", message_id: id,
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
    httpsAgent, timeout: 30000,
  });
  return { buffer: Buffer.from(data), mime: headers["content-type"] || "application/octet-stream" };
}

function verifySig(req) {
  if (!META.SECRET) return true;
  const sig = req.get("X-Hub-Signature-256") || req.get("x-hub-signature-256");
  if (!sig || !req.rawBody) return false;
  const exp = "sha256=" + crypto.createHmac("sha256", META.SECRET).update(req.rawBody).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp)); } catch { return false; }
}

/* =========================
   10) MEDIA
   ========================= */
async function stt(buf, mime) {
  try {
    const file = await toFile(buf, "audio.ogg", { type: mime });
    const r = await openai.audio.transcriptions.create({ model: STT_MODEL, file, language: "es" });
    return (r.text || "").trim();
  } catch (e) { logErr("STT", e); return ""; }
}

async function vision(buf, mime) {
  try {
    const b64 = buf.toString("base64");
    const r = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Analiza esta imagen y extrae TODOS los productos de ventanas/puertas.\nPara CADA uno indica: tipo, medidas, cantidad, color." },
          { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
        ],
      }],
      max_tokens: 900,
    });
    return (r.choices?.[0]?.message?.content || "").trim();
  } catch (e) { logErr("Vision", e); return ""; }
}

async function readPdf(buf) {
  try {
    const r = await pdfParse(buf);
    const t = (r?.text || "").trim();
    return t.length > 6000 ? t.slice(0, 6000) + "…" : t;
  } catch { return ""; }
}

/* =========================
   11) SESIONES
   ========================= */
const sessions = new Map();
const SESSION_TTL = 6 * 3_600_000;
const MAX_HIST = 30;

function emptyData() {
  return {
    name: "", comuna: "", address: "", project_type: "", install: "",
    default_color: "", zona_termica: null, supplier: "WINHOUSE_PVC",
    profile: "", stageKey: "diagnostico", wants_pdf: false, notes: "",
    items: [], grand_total: null,
  };
}

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      lastAt: Date.now(), data: emptyData(), history: [],
      pdfSent: false, quoteNum: null, zohoDealId: null, zohoEstimateId: null,
    });
  }
  return sessions.get(waId);
}

function saveSession(waId, s) {
  s.lastAt = Date.now();
  if (s.history.length > MAX_HIST) s.history = s.history.slice(-MAX_HIST);
  sessions.set(waId, s);
}

setInterval(() => {
  const cut = Date.now() - SESSION_TTL;
  for (const [id, s] of sessions) { if ((s.lastAt || 0) < cut) sessions.delete(id); }
}, 3_600_000);

/* =========================
   12) DEDUP + RATE + LOCK
   ========================= */
const seen = new Map();
function isDup(id) {
  if (!id) return false;
  if (seen.has(id)) return true;
  seen.set(id, Date.now()); return false;
}

const rateM = new Map();
function rateOk(waId) {
  const now = Date.now();
  if (!rateM.has(waId)) rateM.set(waId, { n: 0, r: now + 60_000 });
  const r = rateM.get(waId);
  if (now >= r.r) { r.n = 0; r.r = now + 60_000; }
  r.n++;
  return r.n > 18 ? { ok: false, msg: "Escribes muy rápido 😅 Dame 10 seg." } : { ok: true };
}

const locks = new Map();
async function acquireLock(waId) {
  const prev = locks.get(waId) || Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  locks.set(waId, next);
  await prev;
  return () => { release(); if (locks.get(waId) === next) locks.delete(waId); };
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
    ok: true, waId: msg.from, msgId: msg.id, type, text,
    audioId: msg.audio?.id || null, imageId: msg.image?.id || null,
    docId: msg.document?.id || null, docMime: msg.document?.mime_type || null,
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
   15) SYSTEM PROMPT + TOOLS (★ MEJORADO)
   ========================= */
const SYSTEM_PROMPT = `
Eres un ASESOR DE CLASE MUNDIAL en venta consultiva de VENTANAS y PUERTAS.
Empresa: ${COMPANY.NAME} (${COMPANY.ADDRESS}).

REGLAS IMPORTANTES:
- SOLO trabajamos con 2 líneas:
  1) PVC: WINHOUSE
  2) ALUMINIO: SODAL
  Si el cliente pide otra marca (Rehau u otras), indicas que por ahora cotizamos Winhouse/Sodal y ofreces alternativa equivalente.
- No hables de recomendaciones de espesores (NO sugerir 5+12+5). Solo "termopanel" y cumplimiento OGUC.
- Habla en el idioma del cliente (si escribe en inglés, responde en inglés; si escribe en español, español).
- Extrae TODOS los productos cuando vengan en lista/imagen/PDF y envíalos en UNA sola llamada a update_quote.
- No inventes precios. Si falta información crítica, pregunta de forma eficiente:
  * Si faltan 2-3 datos relacionados (ej: medidas + color), pregunta ambos en la misma respuesta.
  * Si falta solo 1 dato clave, pregunta solo ese.
  * Prioriza: tipo de producto > medidas > color > comuna.

OBJETIVO:
1) Capturar items (tipo, medidas, qty)
2) Color
3) Comuna
4) Cotizar (usando el sistema)
5) Ofrecer cotización formal en Zoho Books (PDF)
`.trim();

const tools = [
  {
    type: "function",
    function: {
      name: "update_quote",
      description: "Actualiza la cotización completa. Si incluye items, enviar la lista COMPLETA (reemplaza anteriores).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          default_color: { type: "string", description: "blanco, negro, nogal, roble, grafito, gris" },
          comuna: { type: "string" },
          address: { type: "string" },
          project_type: { type: "string" },
          install: { type: "string", description: "Sí o No" },
          wants_pdf: { type: "boolean" },
          notes: { type: "string" },
          supplier: { type: "string", description: "WINHOUSE_PVC o SODAL_ALUMINIO" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                product: { type: "string" },
                measures: { type: "string", description: "ancho×alto. Ej: 2000x1500" },
                qty: { type: "number" },
                color: { type: "string" },
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
   16) RUN AI
   ========================= */
async function runAI(session, userText) {
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
      status.push(`${i + 1}. ${it.qty}× ${it.product} ${it.measures} [${c}] → ${priceInfo}`);
    }
    if (d.grand_total)
      status.push(`★ TOTAL: $${Number(d.grand_total).toLocaleString("es-CL")} + IVA`);
  }

  if (!done) status.push(`FALTA: "${missing}" (pregunta de forma eficiente según contexto).`);

  const msgs = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: status.join("\n") },
    ...session.history.slice(-12),
    { role: "user", content: userText },
  ];

  try {
    const r = await openai.chat.completions.create({
      model: AI_MODEL, messages: msgs, tools, tool_choice: "auto",
      parallel_tool_calls: false, temperature: 0.35, max_tokens: 700,
    });
    return r.choices?.[0]?.message;
  } catch (e) {
    logErr("runAI", e);
    return { role: "assistant", content: "Dame un segundo… 🔍" };
  }
}

/* =========================
   17) QUOTE APPLY (★ MEJORADO: valida source)
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
      return {
        ok: false,
        error: "La línea de aluminio requiere cotización manual. El cotizador online actual cubre Winhouse PVC.",
      };
    }

    if (!cotizadorWinhouseConfigured()) {
      return {
        ok: false,
        error: "Cotizador Winhouse no configurado en Railway.",
      };
    }

    const mapped = d.items.map((it) => mapQuoteItemToCotizador(it, d.default_color || ""));
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
        error: "Uno o más ítems requieren validación manual antes de cotizar.",
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

    if (!r.ok || !r.json) {
      return {
        ok: false,
        error: r.json?.error || r.error || "Cotizador Winhouse no disponible.",
      };
    }

    const applied = applyCotizadorResultToSessionItems(d.items, r.json);
    d.grand_total = Number(r.json?.resumen?.subtotal_neto || applied.total || 0) || null;

    if (applied.escaladas > 0) {
      return {
        ok: false,
        error: "La cotización base quedó armada, pero uno o más ítems requieren validación manual.",
        partial: true,
        total: d.grand_total,
      };
    }

    return {
      ok: true,
      total: d.grand_total,
      source: "cotizador_winhouse",
    };
  }

  if (PRICER_MODE === "winperfil" && WINPERFIL_API_BASE) {
    const payload = {
      supplier: d.supplier,
      message: "",
      items,
      customer_id: customer_id || "",
      meta: { comuna: d.comuna || "", zona_termica: d.zona_termica || null },
    };
    const r = await quoteByWinperfil(payload);
    if (r.ok) {
      if (r.items && r.items.length) {
        for (let i = 0; i < d.items.length && i < r.items.length; i++) {
          d.items[i].unit_price = r.items[i].unit_price;
          d.items[i].total_price = r.items[i].total_price;
          d.items[i].source = r.items[i].source || "unknown";
          d.items[i].confidence = r.items[i].confidence || "unknown";

          if (r.items[i].confidence === "low") {
            d.items[i].price_warning = "⚠️ Precio estimado (histórico limitado). Sujeto a validación.";
          } else if (r.items[i].source === "winperfil_estimated") {
            d.items[i].price_warning = "⚠️ Precio estimado desde histórico Winperfil.";
          }
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
    error: "Cotización automática no disponible por el momento. Sistema operativo en modo manual.",
  };
}

/* =========================
   18) ZOHO CRM + BOOKS
   ========================= */
let _zh = { token: "", exp: 0 };
let _zhP = null;

async function zhRefresh() {
  const p = new URLSearchParams({
    refresh_token: ZOHO.REFRESH_TOKEN, client_id: ZOHO.CLIENT_ID,
    client_secret: ZOHO.CLIENT_SECRET, grant_type: "refresh_token",
  });
  const { data } = await axios.post(`${ZOHO.ACCOUNTS}/oauth/v2/token`, p.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, httpsAgent, timeout: 30000,
  });
  _zh = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 - 60_000 };
  return _zh.token;
}

async function zhToken() {
  if (!REQUIRE_ZOHO) return "";
  if (_zh.token && Date.now() < _zh.exp) return _zh.token;
  if (_zhP) return _zhP;
  _zhP = zhRefresh().finally(() => { _zhP = null; });
  return _zhP;
}

const zhH = async () => ({ Authorization: `Zoho-oauthtoken ${await zhToken()}` });

async function zhCreate(mod, rec) {
  try {
    const { data } = await axios.post(`${ZOHO.API}/crm/v2/${mod}`,
      { data: [rec], trigger: ["workflow"] }, { headers: await zhH(), httpsAgent });
    return data?.data?.[0]?.details?.id || null;
  } catch (e) { logErr(`zhCreate ${mod}`, e); return null; }
}

async function zhUpdate(mod, id, rec) {
  try {
    await axios.put(`${ZOHO.API}/crm/v2/${mod}/${id}`,
      { data: [rec], trigger: ["workflow"] }, { headers: await zhH(), httpsAgent });
  } catch (e) { logErr(`zhUpdate ${mod}`, e); }
}

async function zhNote(mod, id, title, body) {
  try {
    await axios.post(`${ZOHO.API}/crm/v2/${mod}/${id}/Notes`,
      { data: [{ Note_Title: title, Note_Content: body }] }, { headers: await zhH(), httpsAgent });
  } catch (e) { logErr("zhNote", e); }
}

async function zhDefaultAcct() {
  try {
    const h = await zhH();
    const n = ZOHO.DEFAULT_ACCT;
    const r = await axios.get(
      `${ZOHO.API}/crm/v2/Accounts/search?criteria=(Account_Name:equals:${encodeURIComponent(n)})`,
      { headers: h, httpsAgent });
    if (r.data?.data?.[0]) return r.data.data[0].id;
    const c = await axios.post(`${ZOHO.API}/crm/v2/Accounts`,
      { data: [{ Account_Name: n }] }, { headers: h, httpsAgent });
    return c.data?.data?.[0]?.details?.id || null;
  } catch (e) { logErr("zhDefaultAcct", e); return null; }
}

async function zhFindDeal(phone) {
  if (!REQUIRE_ZOHO) return null;
  const h = await zhH();
  for (const f of [ZOHO.DEAL_PHONE, "Phone", "Mobile"].filter(Boolean)) {
    try {
      const { data } = await axios.get(
        `${ZOHO.API}/crm/v2/Deals/search?criteria=(${f}:equals:${encodeURIComponent(phone)})`,
        { headers: h, httpsAgent });
      if (data?.data?.[0]) return data.data[0];
    } catch (e) {
      if (e.response?.status === 204 || e.response?.data?.code === "INVALID_QUERY") continue;
      logErr(`zhFind(${f})`, e); return null;
    }
  }
  return null;
}

function computeStage(d, s) {
  if (s.pdfSent) return "propuesta";
  if (isComplete(d)) return "validacion";
  if (d.items.length) return "siembra";
  return "diagnostico";
}

function buildDesc(d) {
  const L = [`Proveedor: ${d.supplier}`, `Color: ${d.default_color || "—"}`, `Comuna: ${d.comuna || "—"}`];
  if (d.zona_termica) L.push(`Zona: Z${d.zona_termica}`);
  L.push("", "ITEMS:");
  for (const [i, it] of d.items.entries()) {
    const c = it.color || d.default_color || "—";
    const src = it.source === "winperfil_exact" ? "✓ Exacto" : (it.source === "winperfil_estimated" ? "⚠️ Estimado" : "");
    const p = it.total_price ? `$${Number(it.total_price).toLocaleString("es-CL")} ${src}` : "pend";
    L.push(`${i + 1}. ${it.qty}× ${it.product} ${it.measures} [${c}] → ${p}`);
  }
  if (d.grand_total) L.push(`\nTOTAL: $${Number(d.grand_total).toLocaleString("es-CL")} +IVA`);
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
  // @patch:sales-os:lead-event:start
  fireAndForget("trackLeadEvent.zhUpsert", trackLeadEvent(buildLeadPayload(ses, waId)));
  // @patch:sales-os:lead-event:end
}

// ★ NUEVO: Crear Estimate en Zoho Books
async function zhBooksCreateEstimate(data, customer_name, phone) {
  if (!REQUIRE_ZOHO || !ZOHO.ORG_ID) return null;

  try {
    const h = await zhH(); // Headers con token válido

    // 1️⃣ Buscar o crear cliente en Zoho Books
    let customer_id = null;
    try {
      const searchResp = await axios.get(
        `${ZOHO.API}/books/v3/contacts?organization_id=${ZOHO.ORG_ID}&contact_name=${encodeURIComponent(customer_name || "Cliente WhatsApp")}`,
        { headers: h, httpsAgent }
      );
      if (searchResp.data?.contacts?.length) {
        customer_id = searchResp.data.contacts[0].contact_id;
      }
    } catch {}

    if (!customer_id) {
      const createResp = await axios.post(
        `${ZOHO.API}/books/v3/contacts?organization_id=${ZOHO.ORG_ID}`,
        {
          contact_name: customer_name || "Cliente WhatsApp",
          contact_type: "customer",
          contact_persons: [{ first_name: customer_name || "Cliente", phone: phone || "" }],
        },
        { headers: h, httpsAgent }
      );
      customer_id = createResp.data?.contact?.contact_id;
    }

    if (!customer_id) {
      logErr("zhBooksCreateEstimate", new Error("No se pudo crear/encontrar cliente en Books"));
      return null;
    }

    // 2️⃣ Crear line_items usando solo item_id y quantity
    const line_items = data.items.map((it) => ({
      item_id: ZOHO.DEFAULT_ITEM_ID, // Solo item_id
      quantity: Number(it.qty || 1),
    }));

    // 3️⃣ Payload del estimate
    const estimatePayload = {
      customer_id,
      reference_number: data.quote_num || "",
      line_items,
      notes: `Generado automáticamente vía WhatsApp IA.\nProveedor: ${data.supplier}\n${data.zona_termica ? `Zona térmica: Z${data.zona_termica}` : ""}`,
      terms: "Válida por 15 días. Sujeta a rectificación técnica en terreno.\nCumplimiento OGUC 4.1.10 (acondicionamiento térmico).",
    };

    // 4️⃣ Crear estimate en Zoho Books
    const { data: estResp } = await axios.post(
      `${ZOHO.API}/books/v3/estimates?organization_id=${ZOHO.ORG_ID}`,
      estimatePayload,
      { headers: h, httpsAgent }
    );

    logInfo("zhBooksCreateEstimate", `Estimate creado: ${estResp.estimate?.estimate_id}`);
    return estResp.estimate;

  } catch (e) {
    console.error("ZOHO STATUS:", e?.response?.status);
    console.error("ZOHO DATA:", JSON.stringify(e?.response?.data || {}, null, 2));
    console.error("ZOHO MESSAGE:", e?.message || String(e));
    logErr("zhBooksCreateEstimate", e);
    return null;
  }
}


/* =========================
   19) ENDPOINTS
   ========================= */
app.get("/health", async (_req, res) => {
  const cotizadorStatus = cotizadorWinhouseConfigured() ? "configured" : "disabled";

  res.json({
    ok: true,
    v: "9.2.3_m6c",
    pricer_mode: PRICER_MODE,
    winperfil_api: WINPERFIL_API_BASE ? "set" : "missing",
    cotizador_winhouse: cotizadorStatus,
    zoho_books: ZOHO.ORG_ID ? "enabled" : "disabled",
    sales_os_bridge: salesOsConfigured() ? "enabled" : "disabled",
    internal_operator_bridge: INTERNAL_OPERATOR_TOKEN ? "enabled" : "missing",
  });
});

app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === META.VERIFY) return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/quote", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const supplier = req.body?.supplier || detectSupplier(message);
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!ALLOWED_SUPPLIERS.includes(supplier))
      return res.status(400).json({ ok: false, error: "Proveedor no permitido" });
    const payload = {
      supplier, message, items: items || [],
      customer_id: String(req.body?.customer_id || ""), meta: req.body?.meta || {},
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
    if (!validInternalOperatorToken(req)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

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

    // @patch:sales-os:inbound-track:start
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
    if (control?.ai_paused || control?.operator_status === "human") {
      ses.history.push({ role: "user", content: userText });
      saveSession(waId, ses);
      logInfo("takeover", `AI en pausa para ${waId}`);
      return;
    }
    // @patch:sales-os:inbound-track:end
    if (/^reset|nueva cotizaci[oÃ³]n|empezar de nuevo/i.test(userText)) {
      ses.data = emptyData();
      ses.pdfSent = false;
      await waSendH(
        waId,
        "ðŸ”„ Listo, empecemos de cero.\nÂ¿QuÃ© ventanas o puertas necesitas?",
        true,
        { customer_name: "" }
      );
      saveSession(waId, ses);
      return;
    }

    ses.history.push({ role: "user", content: userText });
    const ai = await runAI(ses, userText);

    if (ai?.tool_calls?.length) {
      for (const tc of ai.tool_calls) {
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
          d.items = args.items.map((it, i) => ({
            id: i + 1, product: it.product || "", measures: it.measures || "",
            qty: Math.max(1, Number(it.qty) || 1), color: it.color || "",
            unit_price: null, total_price: null, price_warning: "", source: null, confidence: null,
          }));
        }

        if (d.comuna && !d.zona_termica) {
          const zt = getZona(d.comuna);
          if (zt) d.zona_termica = zt;
        }

        if (canQuote(d)) {
          const qr = await priceAll(d, "");
          if (qr.ok && qr.total) {
            d.grand_total = qr.total;
          } else {
            for (const it of d.items) it.price_warning = qr.error || "No pude cotizar";
            d.grand_total = null;
          }
        }
      }

      const d = ses.data;
      const wantsPdf = isComplete(d) && d.grand_total && (d.wants_pdf || /pdf|cotiza|cotizaci[oó]n/i.test(userText));

      if (wantsPdf && !ses.pdfSent) {
        await waSendH(waId, "Perfecto. Preparando tu cotización formal en Zoho Books… 📄", true);
        const qn = `COT-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        ses.quoteNum = qn;
        d.quote_num = qn;

        try {
          const estimate = await zhBooksCreateEstimate(d, d.name || "Cliente WhatsApp", normPhone(waId));
          if (estimate?.estimate_id) {
            ses.zohoEstimateId = estimate.estimate_id;
            ses.pdfSent = true;

            // Enviar link del estimate (o PDF si Zoho lo permite descargar)
            const estimateUrl = estimate.estimate_url || `${ZOHO.API}/books/v3/estimates/${estimate.estimate_id}`;
            await waSendH(waId, `✅ Tu cotización ${qn} está lista.\n\n📎 Link: ${estimateUrl}\n\n(PDF descargable desde Zoho Books)`, true);

            zhUpsert(ses, waId).then(() => {
              if (ses.zohoDealId && estimate.estimate_number) {
                return zhNote("Deals", ses.zohoDealId, `Cotización ${qn}`, `Estimate generado: ${estimate.estimate_number}\nTotal: $${Number(d.grand_total).toLocaleString("es-CL")} +IVA`);
              }
            }).catch(() => {});

            // @patch:sales-os:quote-event:start
            fireAndForget(
              "trackQuoteEvent.formal",
              trackQuoteEvent(
                buildQuotePayload(ses, waId, {
                  status: "formal_sent",
                  zoho_estimate_id: estimate.estimate_id,
                  zoho_estimate_url: estimateUrl,
                  quote_number: qn,
                })
              )
            );
            // @patch:sales-os:quote-event:end
          } else {
            throw new Error("No se pudo crear estimate en Zoho Books");
          }
        } catch (e) {
          logErr("Zoho Books Estimate", e);
          await waSendH(waId, "Tuve un problema generando la cotización en Zoho Books. Lo preparo manual 🙏", true);
        }
      } else {
        let reply = (ai.content || "").replace(/<PROFILE:\w+>/gi, "").trim();
        if (!reply) {
          if (!isComplete(d)) {
            reply = `Perfecto, para avanzar necesito: ${nextMissing(d)}.`;
          } else if (!d.grand_total) {
            const err = d.items[0]?.price_warning || "tu sistema local está apagado";
            reply = `Ya tengo los datos, pero hubo un problema conectando a la fábrica para el cálculo (${err}). ¡En breve te lo confirmo!`;
          } else {
            reply = "¡Todo listo! ¿Deseas que te envíe la cotización formal en Zoho Books?";
          }
        }
        const parts = reply.split(/\n\n+/).filter(Boolean);
        if (parts.length > 1) await waSendMultiH(waId, parts, true);
        else await waSendH(waId, parts[0], true);
        ses.history.push({ role: "assistant", content: reply });
        zhUpsert(ses, waId).catch(() => {});
      }
    } else {
      let reply = (ai?.content || "").replace(/<PROFILE:\w+>/gi, "").trim();
      if (!reply) reply = "No te entendí, ¿me repites? 🤔";
      const parts = reply.split(/\n\n+/).filter(Boolean);
      if (parts.length > 1) await waSendMultiH(waId, parts, true);
      else await waSendH(waId, parts[0], true);
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
   20) START
   ========================= */
app.listen(PORT, () => {
  console.log(`🚀 Ferrari 9.2.3 — port=${PORT} pricer=${PRICER_MODE} winperfil=${WINPERFIL_API_BASE ? "OK" : "NO"} zoho_books=${ZOHO.ORG_ID ? "OK" : "NO"}`);
});


