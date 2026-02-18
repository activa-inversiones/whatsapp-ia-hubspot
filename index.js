// index.js — WhatsApp IA + Zoho CRM
// Ferrari 8.1 — PRODUCTION READY
// Node 18+ | Railway | ESM

import express      from "express";
import axios        from "axios";
import dotenv       from "dotenv";
import crypto       from "crypto";
import FormData     from "form-data";
import PDFDocument  from "pdfkit";
import OpenAI       from "openai";
import { toFile }   from "openai/uploads";
import { createRequire } from "module";
import fs           from "fs";

dotenv.config();
const require  = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const app = express();
app.use(express.json({
  limit: "20mb",
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

/* ================================================================
   1.  LOGGING
   ================================================================ */
function logErr(ctx, e) {
  if (e.response)
    console.error(`❌ ${ctx} [${e.response.status}]: ${JSON.stringify(e.response.data).slice(0, 300)}`);
  else if (e.request)
    console.error(`❌ ${ctx} [NET]: Sin respuesta`);
  else
    console.error(`❌ ${ctx}: ${e.message}`);
}

/* ================================================================
   2.  ENV
   ================================================================ */
const PORT = process.env.PORT || 8080;
const TZ   = process.env.TZ   || "America/Santiago";

const META = {
  VER:      process.env.META_GRAPH_VERSION   || "v22.0",
  TOKEN:    process.env.WHATSAPP_TOKEN,
  PHONE_ID: process.env.PHONE_NUMBER_ID,
  VERIFY:   process.env.VERIFY_TOKEN,
  SECRET:   process.env.APP_SECRET || "",
};

const OPENAI_KEY = process.env.OPENAI_API_KEY  || "";
const AI_MODEL   = process.env.AI_MODEL_OPENAI || "gpt-4o-mini";
const STT_MODEL  = process.env.AI_MODEL_STT    || "whisper-1";

const REQUIRE_ZOHO = String(process.env.REQUIRE_ZOHO || "true") === "true";
const ZOHO = {
  CLIENT_ID:     process.env.ZOHO_CLIENT_ID,
  CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET,
  REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN,
  API:           process.env.ZOHO_API_DOMAIN      || "https://www.zohoapis.com",
  ACCOUNTS:      process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.com",
  DEAL_PHONE:    process.env.ZOHO_DEAL_PHONE_FIELD     || "WhatsApp_Phone",
  DEAL_PROFILE:  process.env.ZOHO_DEAL_PROFILE_FIELD   || "",
  DEFAULT_ACCT:  process.env.ZOHO_DEFAULT_ACCOUNT_NAME || "Clientes WhatsApp IA",
};

const COMPANY = {
  NAME:    process.env.COMPANY_NAME    || "Activa Inversiones",
  PHONE:   process.env.COMPANY_PHONE   || "+56 9 1234 5678",
  EMAIL:   process.env.COMPANY_EMAIL   || "ventas@activa.cl",
  ADDRESS: process.env.COMPANY_ADDRESS || "Temuco, La Araucanía, Chile",
  WEBSITE: process.env.COMPANY_WEBSITE || "www.activa.cl",
  RUT:     process.env.COMPANY_RUT     || "76.XXX.XXX-X",
};

const STAGES = {
  diagnostico:  process.env.ZOHO_STAGE_DIAGNOSTICO  || "Diagnóstico y Perfilado",
  siembra:      process.env.ZOHO_STAGE_SIEMBRA      || "Siembra de Confianza + Marco Normativo",
  propuesta:    process.env.ZOHO_STAGE_PROPUESTA     || "Presentación de Propuesta",
  objeciones:   process.env.ZOHO_STAGE_OBJECIONES    || "Incubadora de Objeciones",
  validacion:   process.env.ZOHO_STAGE_VALIDACION    || "Validación Técnica y Normativa",
  cierre:       process.env.ZOHO_STAGE_CIERRE        || "Cierre y Negociación",
  ganado:       process.env.ZOHO_STAGE_GANADO        || "Cerrado ganado",
  perdido:      process.env.ZOHO_STAGE_PERDIDO       || "Cerrado perdido",
  competencia:  process.env.ZOHO_STAGE_COMPETENCIA   || "Perdido para la competencia",
};

/* ================================================================
   3.  ENV VALIDATION
   ================================================================ */
(function assertEnv() {
  const m = [];
  if (!META.TOKEN)    m.push("WHATSAPP_TOKEN");
  if (!META.PHONE_ID) m.push("PHONE_NUMBER_ID");
  if (!META.VERIFY)   m.push("VERIFY_TOKEN");
  if (!OPENAI_KEY)    m.push("OPENAI_API_KEY");
  if (m.length) { console.error("[FATAL] Faltan:", m.join(", ")); process.exit(1); }
})();

const openai = new OpenAI({ apiKey: OPENAI_KEY });

/* ================================================================
   4.  UTILIDADES
   ================================================================ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function strip(s) {
  return String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function normPhone(raw) {
  const s = String(raw || "").replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("+"))                      return s;
  if (s.startsWith("569") && s.length === 11) return `+${s}`;
  if (s.startsWith("56"))                     return `+${s}`;
  if (s.startsWith("9")  && s.length === 9)   return `+56${s}`;
  return `+${s}`;
}

function parseQty(text) {
  const t = strip(text).toLowerCase();
  const pats = [
    /(?:x|\*)\s*(\d{1,3})\b/,
    /\b(\d{1,3})\s*(?:unidades?|uds?|pzas?|piezas?|ventanas?|puertas?)\b/,
    /\b(?:son|necesito|quiero|cotizar|tengo)\s+(\d{1,3})\b/,
    /\bpor\s+(\d{1,3})\b/,
  ];
  for (const re of pats) {
    const m = t.match(re);
    if (m?.[1]) { const n = parseInt(m[1], 10); if (n >= 1 && n <= 200) return n; }
  }
  return null;
}

/* ================================================================
   5.  ZONAS TÉRMICAS  (OGUC Art. 4.1.10)
   ================================================================ */
const ZONA_COMUNAS = {
  // — Zona 1: Litoral desértico norte —
  arica:1,iquique:1,tocopilla:1,mejillones:1,
  // — Zona 2: Litoral centro-norte —
  antofagasta:2,"la serena":2,coquimbo:2,valparaiso:2,
  "vina del mar":2,"con con":2,quintero:2,
  "san antonio":2,"santo domingo":2,
  // — Zona 3: Interior norte —
  copiapo:3,calama:3,ovalle:3,illapel:3,
  "san felipe":3,"los andes":3,
  // — Zona 4: Central —
  santiago:4,providencia:4,"las condes":4,vitacura:4,
  "lo barnechea":4,nunoa:4,"la reina":4,penalolen:4,
  macul:4,"la florida":4,"puente alto":4,"san bernardo":4,
  maipu:4,quilicura:4,huechuraba:4,independencia:4,
  recoleta:4,conchali:4,renca:4,"quinta normal":4,
  "estacion central":4,cerrillos:4,
  "pedro aguirre cerda":4,"san miguel":4,"la cisterna":4,
  "el bosque":4,"la granja":4,"san ramon":4,"la pintana":4,
  colina:4,lampa:4,buin:4,paine:4,talagante:4,
  melipilla:4,penaflor:4,pirque:4,"lo prado":4,
  "cerro navia":4,pudahuel:4,
  rancagua:4,machali:4,"san fernando":4,
  curico:4,talca:4,linares:4,chillan:4,
  "los angeles":4,concepcion:4,talcahuano:4,
  "san pedro de la paz":4,hualpen:4,coronel:4,
  tome:4,penco:4,lota:4,
  // — Zona 5: Sur (Araucanía, Los Ríos) —
  temuco:5,"padre las casas":5,freire:5,vilcun:5,
  lautaro:5,"nueva imperial":5,carahue:5,pitrufquen:5,
  gorbea:5,perquenco:5,victoria:5,angol:5,collipulli:5,
  traiguen:5,puren:5,lumaco:5,cunco:5,melipeuco:5,
  villarrica:5,pucon:5,curacautin:5,lonquimay:5,
  valdivia:5,"la union":5,panguipulli:5,"rio bueno":5,
  mariquina:5,"los lagos":5,lanco:5,
  // — Zona 6: Los Lagos, Chiloé —
  osorno:6,"puerto montt":6,"puerto varas":6,frutillar:6,
  llanquihue:6,calbuco:6,castro:6,ancud:6,dalcahue:6,
  quellon:6,chonchi:6,
  // — Zona 7: Austral —
  coyhaique:7,"puerto aysen":7,"chile chico":7,cochrane:7,
  "punta arenas":7,"puerto natales":7,porvenir:7,
};

function getZona(comunaRaw) {
  if (!comunaRaw) return null;
  const c = strip(comunaRaw).toLowerCase().trim();
  if (ZONA_COMUNAS[c] !== undefined) return ZONA_COMUNAS[c];
  for (const [name, z] of Object.entries(ZONA_COMUNAS)) {
    if (c.includes(name) || name.includes(c)) return z;
  }
  return null;
}

function zonaInfo(z) {
  if (!z) return { glass: "TP4+12+4", note: "" };
  if (z <= 2) return { glass: "TP4+12+4", note: "Zona costera norte: DVH estándar cumple OGUC." };
  if (z <= 4) return { glass: "TP4+12+4", note: "Zona central: DVH estándar cumple. 5+12+5 mejora confort y CES." };
  if (z === 5) return { glass: "TP5+12+5", note: "Zona 5 (Sur): DVH 5+12+5 recomendado para cumplir RT y mejor confort." };
  if (z === 6) return { glass: "TP5+12+5", note: "Zona 6: DVH 5+12+5 mínimo. Considerar Low-E para CES." };
  return { glass: "TP5+12+5", note: "Zona austral: DVH 5+12+5 + Low-E + argón recomendado." };
}

/* ================================================================
   6.  MOTOR DE PRECIOS
   ================================================================ */

// Placeholder correcciones — PENDIENTE CALIBRAR
const CORRECTIONS = {
  CORREDERA_80: 1.00,   // ~7% error detectado. Ajustar con datos reales
  CORREDERA_98: 1.00,
};

function loadCoeffs() {
  const p = process.env.PRICE_COEFFS_PATH || "./coefficients_v3.json";
  try {
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, "utf-8"));
      console.log(`✅ COEFFS: ${p} (${Object.keys(j).length} keys)`);
      return j;
    }
    console.log(`⚠️ No existe ${p}`);
  } catch (e) { logErr("loadCoeffs", e); }
  return {};
}
const COEFFS = loadCoeffs();

/** Verifica si existe coeficiente para esta combinación */
function hasCoeffs(product, color, glass) {
  return !!COEFFS[`${product}::${color}::${glass}`];
}

function normMeasures(raw) {
  const nums = String(raw || "").match(/(\d+([.,]\d+)?)/g);
  if (!nums || nums.length < 2) return null;
  let a = parseFloat(nums[0].replace(",", "."));
  let b = parseFloat(nums[1].replace(",", "."));
  if (a <= 6)                  a *= 1000;   // metros
  if (b <= 6)                  b *= 1000;
  if (a >= 7  && a <= 300)     a *= 10;     // centímetros
  if (b >= 7  && b <= 300)     b *= 10;
  return { ancho_mm: Math.round(a), alto_mm: Math.round(b) };
}

function normColor(text = "") {
  const s = strip(text).toUpperCase();
  if (/ANTRAC|GRAF|NEGR/.test(s)) return "NEGRO";
  if (/ROBLE|NOGAL|MADER/.test(s)) return "NOGAL";
  return "BLANCO";
}

function normProduct(raw = "") {
  const s = strip(raw).toUpperCase();
  if (s.includes("PUERTA") && /DOBLE|2\s*HOJ|DOS\s*HOJ/.test(s)) return "PUERTA_DOBLE";
  if (s.includes("PUERTA"))      return "PUERTA_1H";
  if (s.includes("PROYEC"))      return "PROYECTANTE";
  if (/MARCO|FIJO|PA[NÑ]O/.test(s)) return "MARCO_FIJO";
  if (s.includes("OSCILO"))      return "OSCILOBATIENTE";
  if (s.includes("ABAT"))        return "ABATIBLE";
  if (s.includes("CORREDERA") && s.includes("98")) return "CORREDERA_98";
  if (s.includes("CORREDERA"))   return "CORREDERA_80";
  return "";
}

function normGlass(raw = "", fallback = "TP4+12+4") {
  const s = strip(raw).toUpperCase();
  if (/5.*12.*5/.test(s)) return "TP5+12+5";
  if (/4.*12.*4/.test(s)) return "TP4+12+4";
  return fallback;
}

function calcPrice(c, W, H) {
  return Math.max(0, Math.round(
    c.a + c.b * W + c.c * H + c.d * W * H + c.e * W * W + c.f * H * H
  ));
}

function resolveKey({ product, colorText, glass, W, H }) {
  let model = product;
  const COLOR = normColor(colorText);
  let GLASS = glass;
  const rules = [];

  if (!model) return { ok: false, reason: "Producto no reconocido" };

  // ── Límites de fabricación ──
  if (model === "PROYECTANTE" && (W > 1400 || H > 1400))
    return { ok: false, reason: "Proyectante: máximo 1400 × 1400 mm." };

  // Marco fijo grande → TP5+12+5 si hay coeficiente
  if (model === "MARCO_FIJO" && W >= 1000 && H >= 2000) {
    if (hasCoeffs("MARCO_FIJO", COLOR, "TP5+12+5")) {
      GLASS = "TP5+12+5";
      rules.push("Marco fijo ≥1000×2000 → TP5+12+5");
    }
  }

  // Puertas
  if (model === "PUERTA_1H") {
    if (W <= 1200 && H <= 2400) {
      rules.push("Puerta 1 hoja (≤1200×2400)");
    } else if (W <= 2400 && H <= 2400) {
      model = "PUERTA_DOBLE";
      rules.push("Ancho >1200 → doble hoja automática");
    } else {
      return { ok: false, reason: "Puerta 1H máx 1200×2400. Doble máx 2400×2400." };
    }
    GLASS = "TP5+12+5";
    rules.push("Puerta → TP5+12+5 obligatorio");
  }
  if (model === "PUERTA_DOBLE") {
    if (W > 2400 || H > 2400) return { ok: false, reason: "Puerta doble máx 2400×2400 mm." };
    GLASS = "TP5+12+5";
    rules.push("Puerta doble → TP5+12+5 obligatorio");
  }

  // Correderas
  if (model === "CORREDERA_80") {
    if (W < 400 || H < 400) return { ok: false, reason: "Corredera 80 mín 400×400 mm." };
    if (W >= 2001 || H >= 2001) {
      model = "CORREDERA_98";
      rules.push("Medida ≥2001 → Corredera 98 automática");
    }
  }
  if (model === "CORREDERA_98") {
    if (W > 4000 || H > 3000) return { ok: false, reason: "Corredera 98 máx 4000×3000 mm." };
  }

  const key = `${model}::${COLOR}::${GLASS}`;
  return { ok: true, model, color: COLOR, glass: GLASS, key, rules };
}

function quoteEngine({ productText, glassText, measuresText, colorText, qty }) {
  const m = normMeasures(measuresText);
  if (!m) return { ok: false, reason: "No pude interpretar medidas. Ej: 1200×1200 mm" };

  const { ancho_mm: W, alto_mm: H } = m;
  const product = normProduct(productText);
  const glass   = normGlass(glassText || "", "TP4+12+4");
  const r = resolveKey({ product, colorText: `${productText} ${colorText}`, glass, W, H });
  if (!r.ok) return { ...r, measures: m };

  const coeffs = COEFFS[r.key];
  if (!coeffs)
    return { ok: false, reason: `Sin datos de precio para ${r.key}`, resolved: r, measures: m };

  let unit = calcPrice(coeffs, W, H);

  // Corrección (placeholder)
  const corr = CORRECTIONS[r.model] || 1;
  if (corr !== 1) {
    unit = Math.round(unit * corr);
    r.rules.push(`Corrección ${r.model}: ×${corr}`);
  }

  const q     = Math.max(1, Number(qty) || 1);
  const total = Math.round(unit * q);

  return { ok: true, unit_price: unit, total_price: total, qty: q,
           mode: "equation", resolved: r, measures: m };
}

/** Determina el mejor vidrio para un producto/color según zona
 *  Retorna el glass que SÍ existe en coeficientes */
function bestGlassForZona(product, colorText, zona) {
  const pNorm = normProduct(product);
  const cNorm = normColor(colorText);
  if (!pNorm) return "TP4+12+4";

  // Puertas siempre 5+12+5
  if (pNorm === "PUERTA_1H" || pNorm === "PUERTA_DOBLE") return "TP5+12+5";

  // Zona >= 5 recomienda 5+12+5, pero solo si hay coeficientes
  if (zona && zona >= 5) {
    if (hasCoeffs(pNorm, cNorm, "TP5+12+5")) return "TP5+12+5";
    // No hay → queda en 4+12+4 (informar al cliente)
  }

  return "TP4+12+4";
}

/* ================================================================
   7.  WHATSAPP CLOUD API
   ================================================================ */
const waUrl = () => `https://graph.facebook.com/${META.VER}`;

async function waTyping(to) {
  try {
    await axios.post(
      `${waUrl()}/${META.PHONE_ID}/messages`,
      { messaging_product: "whatsapp", recipient_type: "individual",
        to, type: "text", typing_indicator: { type: "text" } },
      { headers: { Authorization: `Bearer ${META.TOKEN}` }, timeout: 5000 }
    );
  } catch { /* ok */ }
}

function startTypingLoop(to, ms = 3500) {
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
    await axios.post(
      `${waUrl()}/${META.PHONE_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "text", text: { body } },
      { headers: { Authorization: `Bearer ${META.TOKEN}` }, timeout: 20000 }
    );
  } catch (e) { logErr("waSend", e); }
}

async function waSendH(to, text, skipTyp = false) {
  const stop = skipTyp ? null : startTypingLoop(to);
  try { await sleep(humanMs(text)); await waSend(to, text); }
  finally { stop?.(); }
}

async function waSendMultiH(to, msgs, skipTyp = false) {
  const stop = skipTyp ? null : startTypingLoop(to);
  try {
    for (const m of msgs) {
      if (!m?.trim()) continue;
      await sleep(humanMs(m));
      await waSend(to, m);
      await sleep(300 + Math.random() * 400);
    }
  } finally { stop?.(); }
}

async function waRead(msgId) {
  try {
    await axios.post(
      `${waUrl()}/${META.PHONE_ID}/messages`,
      { messaging_product: "whatsapp", status: "read", message_id: msgId },
      { headers: { Authorization: `Bearer ${META.TOKEN}` }, timeout: 8000 }
    );
  } catch { /* ok */ }
}

async function waUploadPdf(buf, fname = "Cotizacion.pdf") {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buf, { filename: fname, contentType: "application/pdf" });
  const { data } = await axios.post(
    `${waUrl()}/${META.PHONE_ID}/media`, form,
    { headers: { Authorization: `Bearer ${META.TOKEN}`, ...form.getHeaders() },
      maxBodyLength: Infinity }
  );
  return data.id;
}

async function waSendPdf(to, mid, caption, fname) {
  try {
    await axios.post(
      `${waUrl()}/${META.PHONE_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "document",
        document: { id: mid, filename: fname, caption } },
      { headers: { Authorization: `Bearer ${META.TOKEN}` } }
    );
  } catch (e) { logErr("waSendPdf", e); }
}

async function waMediaUrl(id) {
  const { data } = await axios.get(
    `${waUrl()}/${id}`,
    { headers: { Authorization: `Bearer ${META.TOKEN}` } }
  );
  return data;
}

async function waDownload(url) {
  const { data, headers } = await axios.get(url, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${META.TOKEN}` },
  });
  return { buffer: Buffer.from(data), mime: headers["content-type"] || "application/octet-stream" };
}

function verifySig(req) {
  if (!META.SECRET) return true;
  const sig = req.get("X-Hub-Signature-256") || req.get("x-hub-signature-256");
  if (!sig || !req.rawBody) return false;
  const exp = "sha256=" + crypto.createHmac("sha256", META.SECRET).update(req.rawBody).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp)); }
  catch { return false; }
}

/* ================================================================
   8.  MEDIA PROCESSING
   ================================================================ */
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
          { type: "text",
            text: "Describe la imagen brevemente. Extrae: producto (ventana/puerta), tipo, color, medidas, cantidad, ubicación." },
          { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
        ],
      }],
      max_tokens: 250,
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

/* ================================================================
   9.  SESIONES
   ================================================================ */
const sessions    = new Map();
const SESSION_TTL = 6 * 3_600_000;
const MAX_HIST    = 30;

function emptyData() {
  return {
    name: "", product: "", color: "", qty: 1,
    measures: "", address: "", comuna: "",
    glass: "", install: "", wants_pdf: false,
    notes: "", project_type: "",
    profile: "", stageKey: "diagnostico",
    zona_termica: null,
    unit_price: null, total_price: null,
    price_mode: "", price_key: "",
    price_rules: [], price_warning: "",
  };
}

function getSession(waId) {
  if (!sessions.has(waId))
    sessions.set(waId, {
      lastAt: Date.now(), data: emptyData(),
      history: [], pdfSent: false,
      quoteNum: null, zohoDealId: null,
    });
  return sessions.get(waId);
}

function saveSession(waId, s) {
  s.lastAt = Date.now();
  if (s.history.length > MAX_HIST) s.history = s.history.slice(-MAX_HIST);
  sessions.set(waId, s);
}

setInterval(() => {
  const cut = Date.now() - SESSION_TTL;
  for (const [id, s] of sessions) if ((s.lastAt || 0) < cut) sessions.delete(id);
}, 3_600_000);

/* ================================================================
   10.  DEDUP, RATE, LOCK
   ================================================================ */
const seen = new Map();
function isDup(id) {
  if (!id) return false;
  if (seen.has(id)) return true;
  seen.set(id, Date.now());
  return false;
}
setInterval(() => {
  const cut = Date.now() - 7_200_000;
  for (const [id, ts] of seen) if (ts < cut) seen.delete(id);
}, 600_000);

const rateM = new Map();
function rateOk(waId) {
  const now = Date.now();
  if (!rateM.has(waId)) rateM.set(waId, { n: 0, r: now + 60_000 });
  const r = rateM.get(waId);
  if (now >= r.r) { r.n = 0; r.r = now + 60_000; }
  r.n++;
  return r.n > 15
    ? { ok: false, msg: "Estás escribiendo muy rápido 😅 Dame unos segundos." }
    : { ok: true };
}

// FIFO lock (fix race-condition)
const locks = new Map();
async function acquireLock(waId) {
  const prev = locks.get(waId) || Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  locks.set(waId, next);
  await prev;
  return () => { release(); if (locks.get(waId) === next) locks.delete(waId); };
}

/* ================================================================
   11.  EXTRACT MESSAGE
   ================================================================ */
function extractMsg(body) {
  const val = body?.entry?.[0]?.changes?.[0]?.value;
  if (val?.statuses?.length) return { ok: false };
  const msg = val?.messages?.[0];
  if (!msg) return { ok: false };

  const type = msg.type;
  let text = "";
  if (type === "text")             text = msg.text?.body || "";
  else if (type === "button")      text = msg.button?.text || "";
  else if (type === "interactive") text = JSON.stringify(msg.interactive || {});
  else text = `[${type}]`;

  return {
    ok: true, waId: msg.from, msgId: msg.id, type, text,
    audioId: msg.audio?.id    || null,
    imageId: msg.image?.id    || null,
    docId:   msg.document?.id || null,
    docMime: msg.document?.mime_type || null,
  };
}

/* ================================================================
   12.  BUSINESS HELPERS
   ================================================================ */
function nextMissing(d) {
  if (!d.product)              return "producto";
  if (!d.measures)             return "medidas";
  if (!d.color)                return "color";
  if (!d.comuna && !d.address) return "comuna";
  return "";
}

function isComplete(d) {
  return !!(d.product && d.color && d.measures && (d.address || d.comuna));
}

/* ================================================================
   13.  SYSTEM PROMPT & TOOLS
   ================================================================ */
const SYSTEM_PROMPT = `
Eres un ASESOR ESPECIALISTA EN VENTANAS Y PUERTAS DE PVC CON TERMOPANEL de ${COMPANY.NAME}, ubicada en ${COMPANY.ADDRESS}.

═══ TU PERSONALIDAD ═══
• Hablas como profesional chileno: cercano, cálido, confiable.
• NO eres formulario. Eres asesor que CONVERSA y ESCUCHA.
• Preguntas de a uno. Jamás bombardees al cliente.
• Si comenta algo personal, responde humanamente antes de seguir.
• Si no sabes algo, dilo con honestidad y ofrece consultar.
• Usas "tú" salvo que el cliente use "usted".

═══ CONOCIMIENTO TÉCNICO CHILENO ═══

NORMATIVA OGUC (Ordenanza General de Urbanismo y Construcciones):
• Art. 4.1.10: Acondicionamiento térmico OBLIGATORIO en viviendas nuevas, ampliaciones y remodelaciones.
• Chile tiene 7 zonas térmicas. Cada zona exige transmitancia térmica (valor U) máxima para ventanas, muros, techumbre y pisos.
• Las ventanas son el elemento MÁS crítico de la envolvente: por ellas se pierde hasta el 40% del calor.

REGLAMENTACIÓN TÉRMICA (RT):
• Zona 1-2: U ventanas ≤ 6.0 W/m²K → DVH estándar cumple.
• Zona 3-4: U ventanas ≤ 3.6 W/m²K → DVH estándar cumple. 5+12+5 mejora.
• Zona 5:   U ventanas ≤ 3.0 W/m²K → DVH 5+12+5 recomendado.
• Zona 6:   U ventanas ≤ 2.8 W/m²K → DVH 5+12+5 mínimo. Low-E ideal.
• Zona 7:   U ventanas ≤ 2.4 W/m²K → DVH Low-E + argón necesario.

NCh 2485: Aislación térmica en edificaciones.
NCh 888: Vidrios de seguridad (templado/laminado según altura y uso).

CERTIFICACIÓN CES (Certificación Edificio Sustentable):
• Evalúa eficiencia energética, agua, ambiente interior, materiales.
• Ventanas PVC + DVH aportan puntos significativos en la categoría "Envolvente".
• PVC tiene mejor aislación térmica que aluminio (no conduce calor).
• Si el cliente menciona CES o edificio sustentable, explica cómo nuestros productos contribuyen.

VENTAJAS DEL PVC:
• No conductor térmico (vs aluminio que es puente térmico).
• Resistente a corrosión costera (ideal zonas 1-2).
• No requiere mantenimiento, no se pinta, no se oxida.
• Material reciclable. Vida útil +40 años.
• Reduce condensación en vidrios.
• Aislación acústica superior (~35 dB de reducción).

═══ PRODUCTOS DISPONIBLES ═══
• Corredera 80 mm — hasta 2000×2000. Medidas mayores → Corredera 98 automática.
• Corredera 98 mm — para vanos grandes.
• Proyectante — máx 1400×1400 mm. Ventilación superior.
• Abatible — apertura lateral clásica.
• Oscilobatiente — apertura dual: abatir + oscilar. Ideal dormitorios.
• Marco Fijo / Paño Fijo — máxima luminosidad, sin apertura.
• Puerta 1 hoja — máx 1200×2400. Ancho >1200 → doble hoja.
• Puerta doble hoja — máx 2400×2400.

═══ REGLAS OBLIGATORIAS ═══
• Vidrio SIEMPRE es Termopanel (DVH). NO preguntes tipo de vidrio.
• Puertas siempre DVH 5+12+5.
• El sistema calcula precios automáticamente. TÚ NO inventas precios.
• Si el cliente dice cantidad (ej: "necesito 6"), guárdala como qty.

═══ FLUJO NATURAL DE CONVERSACIÓN ═══
1. Saluda con calidez. Pregunta qué necesita.
2. Identifica producto (tipo de ventana/puerta).
3. Pregunta medidas (ancho × alto).
4. Pregunta color (blanco, negro/antracita, nogal).
5. Pregunta comuna → zona térmica → valida RT.
6. Con datos completos, el SISTEMA calcula precio.
7. Tú presentas el precio naturalmente y ofreces PDF.

═══ CÓMO PRESENTAR PRECIOS ═══
Cuando el sistema te pase el precio calculado:
• Preséntalo naturalmente: "Tu ventana corredera de 1500×1500 en blanco te queda en $XXX.XXX + IVA"
• Si hay varias unidades: "Cada una queda en $XXX.XXX, y las 6 unidades suman $XXX.XXX + IVA"
• Menciona que incluye Termopanel.
• Si la comuna está en zona 5+, destaca el cumplimiento normativo.
• Ofrece generar cotización formal en PDF.

═══ CUANDO NO HAY PRECIO ═══
• Si el sistema dice que falta ecuación → "Déjame verificar ese modelo con el equipo técnico"
• Si hay advertencia de precio → transmítela con naturalidad.
• NUNCA inventes un número.

═══ PERFIL DEL CLIENTE ═══
Al final de CADA respuesta agrega exactamente 1 tag (el cliente NO lo ve):
<PROFILE:PRECIO>    — enfocado en costo, compara, busca ofertas.
<PROFILE:CALIDAD>   — valora durabilidad, garantía, materiales premium.
<PROFILE:TECNICO>   — pregunta specs, normativa, certificaciones, U-value.
<PROFILE:AFINIDAD>  — valora cercanía, confianza, relación humana.
`.trim();

const tools = [{
  type: "function",
  function: {
    name: "update_customer_data",
    description:
      "Actualiza datos del cliente. Llamar SIEMPRE que el cliente dé información nueva.",
    parameters: {
      type: "object",
      properties: {
        name:         { type: "string",  description: "Nombre del cliente" },
        product:      { type: "string",  description: "Tipo: corredera, proyectante, abatible, oscilobatiente, marco fijo, puerta" },
        color:        { type: "string",  description: "Color: blanco, negro/antracita, nogal" },
        qty:          { type: "number",  description: "Cantidad de unidades" },
        measures:     { type: "string",  description: "Medidas ancho×alto" },
        address:      { type: "string",  description: "Dirección de instalación" },
        comuna:       { type: "string",  description: "Comuna" },
        install:      { type: "string",  description: "¿Necesita instalación? sí/no/por ver" },
        wants_pdf:    { type: "boolean", description: "true si quiere cotización formal PDF" },
        notes:        { type: "string",  description: "Observaciones" },
        project_type: { type: "string",  description: "obra nueva / remodelación / ampliación / reposición" },
      },
    },
  },
}];

/* ================================================================
   14.  RUN AI
   ================================================================ */
async function runAI(session, userText) {
  const d       = session.data;
  const missing = nextMissing(d);
  const done    = isComplete(d);

  const status = [];
  if (done) status.push("DATOS COMPLETOS. Calcula precio y/o ofrece PDF.");
  else      status.push(`FALTA: "${missing}". Pídelo amablemente, de a uno.`);

  if (d.zona_termica) status.push(`Zona térmica: ${d.zona_termica}. ${zonaInfo(d.zona_termica).note}`);

  if (d.unit_price)
    status.push(`PRECIO CALCULADO — Unitario: $${d.unit_price.toLocaleString("es-CL")} +IVA | Total (${d.qty}u): $${d.total_price.toLocaleString("es-CL")} +IVA. Preséntalo naturalmente.`);
  if (d.price_warning)
    status.push(`AVISO: ${d.price_warning}`);

  const msgs = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: status.join("\n") },
    { role: "system", content: `Memoria:\n${JSON.stringify(d, null, 2)}` },
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
      temperature: 0.35,
      max_tokens: 500,
    });
    const ai = r.choices?.[0]?.message;
    if (ai?.content) {
      const pm = ai.content.match(/<PROFILE:(\w+)>/i);
      if (pm) {
        const p = pm[1].toUpperCase();
        if (["PRECIO","CALIDAD","TECNICO","AFINIDAD"].includes(p)) d.profile = p;
      }
    }
    return ai;
  } catch (e) {
    logErr("runAI", e);
    return { role: "assistant", content: "Dame un segundo, estoy revisando… 🔍" };
  }
}

/* ================================================================
   15.  PDF
   ================================================================ */
function dateCL(d = new Date()) {
  return d.toLocaleDateString("es-CL", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function genQuoteNum() {
  const n = new Date();
  return `COT-${String(n.getFullYear()).slice(-2)}${String(n.getMonth()+1).padStart(2,"0")}${String(n.getDate()).padStart(2,"0")}-${Math.random().toString(36).substring(2,6).toUpperCase()}`;
}

async function buildPdf(data, qn) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];
      doc.on("data", c => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      const P = "#1a365d";
      const S = "#4a5568";
      const L = "#f7fafc";

      // ── Header ──
      doc.rect(0, 0, 612, 108).fill(P);
      doc.fillColor("#fff").fontSize(24).font("Helvetica-Bold")
         .text(COMPANY.NAME.toUpperCase(), 50, 25);
      doc.fontSize(10).font("Helvetica")
         .text("Ventanas y Puertas de PVC con Termopanel", 50, 53);
      doc.fontSize(9)
         .text(`${COMPANY.PHONE}  •  ${COMPANY.EMAIL}`, 50, 69)
         .text(`${COMPANY.ADDRESS}`, 50, 83);

      doc.fontSize(18).font("Helvetica-Bold")
         .text("COTIZACIÓN", 380, 28, { align: "right", width: 180 });
      doc.fontSize(10).font("Helvetica")
         .text(qn, 380, 53, { align: "right", width: 180 })
         .text(`Fecha: ${dateCL()}`, 380, 69, { align: "right", width: 180 })
         .text(`Válida: 15 días`, 380, 83, { align: "right", width: 180 });

      // ── Cliente ──
      let y = 128;
      doc.fillColor(P).fontSize(12).font("Helvetica-Bold").text("CLIENTE", 50, y);
      y += 18;
      doc.fillColor(S).fontSize(10).font("Helvetica");
      if (data.name)    { doc.text(`Nombre: ${data.name}`, 50, y); y += 15; }
      if (data.comuna || data.address) {
        doc.text(`Ubicación: ${data.address || data.comuna}`, 50, y); y += 15;
      }
      if (data.zona_termica) {
        doc.text(`Zona Térmica OGUC: ${data.zona_termica}`, 50, y); y += 15;
      }
      if (data.project_type) {
        doc.text(`Tipo proyecto: ${data.project_type}`, 50, y); y += 15;
      }

      // ── Detalle Producto ──
      y += 8;
      doc.fillColor(P).fontSize(12).font("Helvetica-Bold").text("DETALLE DEL PRODUCTO", 50, y);
      y += 18;
      const boxTop = y;
      doc.rect(50, boxTop, 512, 110).fill(L);
      doc.fillColor(S).fontSize(10).font("Helvetica");
      doc.text(`Producto:     ${data.product || "Por confirmar"}`,  65, boxTop + 10);
      doc.text(`Color:        ${data.color || "Por confirmar"}`,    65, boxTop + 28);
      doc.text(`Cantidad:     ${data.qty || 1}`,                    65, boxTop + 46);
      doc.text(`Medidas:      ${data.measures || "Por confirmar"}`, 65, boxTop + 64);
      doc.text(`Vidrio:       ${data.glass || "Termopanel DVH"}`,   65, boxTop + 82);
      if (data.install) doc.text(`Instalación:  ${data.install}`,  330, boxTop + 10);
      y = boxTop + 125;

      // ── Precio ──
      doc.fillColor(P).fontSize(12).font("Helvetica-Bold").text("VALOR ESTIMADO", 50, y);
      y += 18;
      const uTxt = data.unit_price ? `$ ${Number(data.unit_price).toLocaleString("es-CL")}` : "—";
      const tTxt = data.total_price ? `$ ${Number(data.total_price).toLocaleString("es-CL")}` : "Por confirmar";
      const priceY = y;
      doc.rect(50, priceY, 512, 60).fill(L);
      doc.fillColor(S).fontSize(11).font("Helvetica")
         .text(`Precio unitario: ${uTxt} + IVA`, 65, priceY + 12);
      doc.fillColor(P).fontSize(15).font("Helvetica-Bold")
         .text(`TOTAL: ${tTxt} + IVA`, 65, priceY + 35);
      y = priceY + 75;

      // ── Normativa ──
      y += 5;
      doc.fillColor(P).fontSize(11).font("Helvetica-Bold").text("CUMPLIMIENTO NORMATIVO", 50, y);
      y += 16;
      doc.fillColor(S).fontSize(9).font("Helvetica");
      const norms = [
        "✓  OGUC Art. 4.1.10 — Acondicionamiento térmico obligatorio",
        "✓  NCh 2485 — Aislación térmica en edificaciones",
        "✓  NCh 888 — Vidrios de seguridad según aplicación",
        "✓  Compatible con Certificación CES (Edificio Sustentable)",
        "✓  Perfil PVC sin puente térmico — Superior a aluminio",
        "✓  DVH reduce pérdida térmica hasta 50% vs vidrio simple",
      ];
      if (data.zona_termica) {
        norms.push(`✓  ${zonaInfo(data.zona_termica).note}`);
      }
      for (const line of norms) {
        doc.text(line, 55, y); y += 13;
      }

      // ── Footer ──
      y += 10;
      doc.moveTo(50, y).lineTo(562, y).strokeColor("#cbd5e0").lineWidth(0.5).stroke();
      y += 8;
      doc.fillColor(S).fontSize(8).font("Helvetica");
      doc.text("Precios en CLP + IVA  |  Sujeto a visita técnica  |  Instalación no incluida salvo indicación", 50, y);
      y += 12;
      doc.text(`${COMPANY.NAME}  •  RUT ${COMPANY.RUT}  •  ${COMPANY.WEBSITE}`, 50, y);

      doc.end();
    } catch (e) { reject(e); }
  });
}

/* ================================================================
   16.  ZOHO CRM
   ================================================================ */
let zh = { token: "", exp: 0 };
let zhP = null;

async function zhRefresh() {
  const params = new URLSearchParams({
    refresh_token: ZOHO.REFRESH_TOKEN,
    client_id: ZOHO.CLIENT_ID,
    client_secret: ZOHO.CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  const { data } = await axios.post(
    `${ZOHO.ACCOUNTS}/oauth/v2/token`, params.toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  zh = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 - 60_000 };
  return zh.token;
}

async function zhToken() {
  if (!REQUIRE_ZOHO) return "";
  if (zh.token && Date.now() < zh.exp) return zh.token;
  if (zhP) return zhP;
  zhP = zhRefresh().finally(() => { zhP = null; });
  return zhP;
}

const zhH = async () => ({ Authorization: `Zoho-oauthtoken ${await zhToken()}` });

async function zhCreate(mod, rec) {
  try {
    const { data } = await axios.post(
      `${ZOHO.API}/crm/v2/${mod}`,
      { data: [rec], trigger: ["workflow"] },
      { headers: await zhH() }
    );
    return data?.data?.[0]?.details?.id || null;
  } catch (e) { logErr(`zhCreate ${mod}`, e); return null; }
}

async function zhUpdate(mod, id, rec) {
  try {
    await axios.put(
      `${ZOHO.API}/crm/v2/${mod}/${id}`,
      { data: [rec], trigger: ["workflow"] },
      { headers: await zhH() }
    );
  } catch (e) { logErr(`zhUpdate ${mod}`, e); }
}

async function zhNote(mod, id, title, body) {
  try {
    await axios.post(
      `${ZOHO.API}/crm/v2/${mod}/${id}/Notes`,
      { data: [{ Note_Title: title, Note_Content: body }] },
      { headers: await zhH() }
    );
  } catch (e) { logErr("zhNote", e); }
}

async function zhDefaultAcct() {
  try {
    const h = await zhH();
    const name = ZOHO.DEFAULT_ACCT;
    const r = await axios.get(
      `${ZOHO.API}/crm/v2/Accounts/search?criteria=(Account_Name:equals:${encodeURIComponent(name)})`,
      { headers: h }
    );
    if (r.data?.data?.[0]) return r.data.data[0].id;
    const c = await axios.post(
      `${ZOHO.API}/crm/v2/Accounts`,
      { data: [{ Account_Name: name }] },
      { headers: h }
    );
    return c.data?.data?.[0]?.details?.id || null;
  } catch (e) { logErr("zhDefaultAcct", e); return null; }
}

async function zhFindDeal(phone) {
  if (!REQUIRE_ZOHO) return null;
  const h = await zhH();

  // Search API con campos candidatos
  for (const f of [ZOHO.DEAL_PHONE, "Phone", "Mobile"].filter(Boolean)) {
    try {
      const { data } = await axios.get(
        `${ZOHO.API}/crm/v2/Deals/search?criteria=(${f}:equals:${encodeURIComponent(phone)})`,
        { headers: h }
      );
      if (data?.data?.[0]) return data.data[0];
    } catch (e) {
      if (e.response?.status === 204) continue;
      if (e.response?.data?.code === "INVALID_QUERY") continue;
      logErr(`zhFind(${f})`, e);
      return null;
    }
  }

  // Fallback COQL
  try {
    const q = `select id, Deal_Name, Stage from Deals where Description like '%${phone}%' limit 1`;
    const { data } = await axios.post(
      `${ZOHO.API}/crm/v2/coql`, { select_query: q }, { headers: h }
    );
    return data?.data?.[0] || null;
  } catch { return null; }
}

function computeStage(d, ses) {
  if (ses.pdfSent)      return "propuesta";
  if (isComplete(d))    return "validacion";
  if (d.product || d.measures) return "siembra";
  return "diagnostico";
}

function buildDesc(d) {
  const L = [];
  L.push(`Producto: ${d.product || "—"}`);
  L.push(`Color: ${d.color || "—"}`);
  L.push(`Cantidad: ${d.qty || 1}`);
  L.push(`Medidas: ${d.measures || "—"}`);
  L.push(`Vidrio: ${d.glass || "Termopanel"}`);
  L.push(`Proyecto: ${d.project_type || "—"}`);
  if (d.zona_termica) L.push(`Zona Térmica: ${d.zona_termica}`);
  if (d.unit_price)   L.push(`Unitario: $${d.unit_price.toLocaleString("es-CL")} +IVA`);
  if (d.total_price)  L.push(`Total: $${d.total_price.toLocaleString("es-CL")} +IVA (${d.qty}u)`);
  if (d.price_mode)   L.push(`Modo: ${d.price_mode}`);
  if (d.price_key)    L.push(`Key: ${d.price_key}`);
  if (d.price_rules?.length) L.push(`Reglas: ${d.price_rules.join(" | ")}`);
  if (d.price_warning) L.push(`Aviso: ${d.price_warning}`);
  if (d.profile)      L.push(`Perfil: ${d.profile}`);
  return L.join("\n");
}

async function zhUpsert(ses, waId) {
  if (!REQUIRE_ZOHO) return;
  const d = ses.data;
  const phone = normPhone(waId);
  d.stageKey = computeStage(d, ses);

  const deal = {
    Deal_Name: `${d.product || "Ventanas"} ${d.color || ""} [WA …${String(waId).slice(-4)}]`.trim(),
    Stage: STAGES[d.stageKey] || STAGES.diagnostico,
    Closing_Date: addDays(new Date(), 30).toISOString().split("T")[0],
    Description: buildDesc(d),
  };
  if (ZOHO.DEAL_PHONE) deal[ZOHO.DEAL_PHONE] = phone;
  if (d.profile && ZOHO.DEAL_PROFILE) deal[ZOHO.DEAL_PROFILE] = d.profile;
  if (d.total_price) deal.Amount = d.total_price;

  const existing = await zhFindDeal(phone);
  if (existing?.id) {
    ses.zohoDealId = existing.id;
    await zhUpdate("Deals", existing.id, deal);
  } else {
    const accId = await zhDefaultAcct();
    if (accId) deal.Account_Name = { id: accId };
    ses.zohoDealId = await zhCreate("Deals", deal);
  }
}

/* ================================================================
   17.  WEBHOOK
   ================================================================ */
app.get("/health", (_req, res) => res.json({
  ok: true, v: "8.1",
  coeffs: Object.keys(COEFFS).length,
  comunas: Object.keys(ZONA_COMUNAS).length,
  products: [...new Set(Object.keys(COEFFS).map(k => k.split("::")[0]))],
}));

app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === META.VERIFY) return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  if (!verifySig(req)) return;

  const inc = extractMsg(req.body);
  if (!inc.ok) return;

  const { waId, msgId, type } = inc;
  if (isDup(msgId)) return;

  const rc = rateOk(waId);
  if (!rc.ok) return waSend(waId, rc.msg);

  const release  = await acquireLock(waId);
  const stopType = startTypingLoop(waId, 3500);

  try {
    const ses = getSession(waId);
    ses.lastAt = Date.now();
    await waRead(msgId);

    let userText = inc.text;

    // ── Media ──
    if (type === "audio" && inc.audioId) {
      const meta = await waMediaUrl(inc.audioId);
      const { buffer, mime } = await waDownload(meta.url);
      const t = await stt(buffer, mime);
      userText = t ? `[Audio]: ${t}` : "[Audio no reconocido]";
    }
    if (type === "image" && inc.imageId) {
      const meta = await waMediaUrl(inc.imageId);
      const { buffer, mime } = await waDownload(meta.url);
      userText = `[Imagen]: ${await vision(buffer, mime)}`;
    }
    if (type === "document" && inc.docId && inc.docMime === "application/pdf") {
      const meta = await waMediaUrl(inc.docId);
      const { buffer } = await waDownload(meta.url);
      const t = await readPdf(buffer);
      userText = t ? `[PDF]: ${t}` : "[PDF sin texto]";
    }

    // ── Qty directo ──
    const qd = parseQty(userText);
    if (qd) ses.data.qty = qd;

    // ── Reset ──
    if (/^reset|nueva cotizaci[oó]n|empezar de nuevo/i.test(userText)) {
      ses.data = emptyData();
      ses.pdfSent = false;
      await waSendH(waId, "🔄 Perfecto, empecemos de cero.\n¿Qué tipo de ventana o puerta necesitas?", true);
      saveSession(waId, ses);
      return;
    }

    ses.history.push({ role: "user", content: userText });

    // ── AI ──
    const ai = await runAI(ses, userText);
    if (!ai) {
      await waSendH(waId, "Perdona, tuve un problema técnico. ¿Me repites? 🙏", true);
      saveSession(waId, ses);
      return;
    }

    // ── TOOL CALLS ──
    if (ai.tool_calls?.length) {
      for (const tc of ai.tool_calls) {
        if (tc.function?.name !== "update_customer_data") continue;
        let args;
        try { args = JSON.parse(tc.function.arguments || "{}"); }
        catch (pe) {
          console.error("⚠️ tool args parse error:", pe.message);
          continue;
        }
        for (const [k, v] of Object.entries(args)) {
          if (v != null && v !== "") ses.data[k] = v;
        }
      }

      const d = ses.data;

      // ── Zona térmica ──
      if (d.comuna && !d.zona_termica) {
        const zt = getZona(d.comuna);
        if (zt) d.zona_termica = zt;
      }

      // ── Vidrio inteligente ──
      const pNorm = normProduct(d.product);

      // Puertas: siempre 5+12+5
      if (pNorm === "PUERTA_1H" || pNorm === "PUERTA_DOBLE") {
        d.glass = "TP5+12+5";
      }
      // Zona >= 5: upgrade SOLO si existen coeficientes
      else if (d.zona_termica && d.zona_termica >= 5 && d.product && d.color) {
        d.glass = bestGlassForZona(d.product, d.color, d.zona_termica);
      }
      // Default
      else if (!d.glass) {
        d.glass = "TP4+12+4";
      }

      // ── Precio ──
      if (isComplete(d) || d.wants_pdf) {
        const q = quoteEngine({
          productText:  d.product,
          glassText:    d.glass,
          measuresText: d.measures,
          colorText:    d.color,
          qty:          d.qty || 1,
        });

        if (q.ok) {
          d.unit_price    = q.unit_price;
          d.total_price   = q.total_price;
          d.qty           = q.qty;
          d.price_mode    = q.mode;
          d.price_key     = q.resolved?.key || "";
          d.price_rules   = q.resolved?.rules || [];
          d.price_warning = "";
        } else {
          d.unit_price    = null;
          d.total_price   = null;
          d.price_mode    = "";
          d.price_key     = q.resolved?.key || "";
          d.price_rules   = q.resolved?.rules || [];
          d.price_warning = q.reason || "No se pudo cotizar";
        }
      }

      // ── ¿PDF? ──
      const wantsPdf = isComplete(d) &&
        (d.wants_pdf || /pdf|cotiza|cotizaci[oó]n/i.test(userText));

      if (wantsPdf && !ses.pdfSent) {
        await waSendH(waId, "Perfecto, te preparo la cotización formal… 📄", true);
        const qn = genQuoteNum();
        ses.quoteNum = qn;

        try {
          const buf = await buildPdf(d, qn);
          const mid = await waUploadPdf(buf, `Cotizacion_${qn}.pdf`);
          await waSendPdf(waId, mid, `Cotización ${qn} — ${COMPANY.NAME}`, `Cotizacion_${qn}.pdf`);
          ses.pdfSent = true;

          // Zoho
          zhUpsert(ses, waId)
            .then(() => {
              if (ses.zohoDealId)
                zhNote("Deals", ses.zohoDealId, `Cotización ${qn}`, buildDesc(d));
            })
            .catch(() => {});

        } catch (e) {
          logErr("PDF", e);
          await waSendH(waId, "Tuve un problema con el PDF. Te lo mando manualmente 🙏", true);
        }

      } else {
        // ── Follow-up con contexto ──
        const toolRes = ai.tool_calls.map(tc => ({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({
            ok: true,
            price_available: !!d.unit_price,
            unit_price: d.unit_price,
            total_price: d.total_price,
            qty: d.qty,
            zona: d.zona_termica,
            zona_note: d.zona_termica ? zonaInfo(d.zona_termica).note : "",
            glass_applied: d.glass,
            missing: nextMissing(d),
            warning: d.price_warning || "",
          }),
        }));

        const follow = await openai.chat.completions.create({
          model: AI_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...ses.history.slice(-12),
            ai,
            ...toolRes,
          ],
          temperature: 0.4,
          max_tokens: 450,
        });

        const reply = (follow.choices?.[0]?.message?.content || "")
          .replace(/<PROFILE:\w+>/gi, "").trim();

        const parts = reply.split(/\n\n+/).filter(Boolean);
        if (parts.length > 1) await waSendMultiH(waId, parts, true);
        else await waSendH(waId, reply || "¿Me confirmas las medidas y el color?", true);

        ses.history.push({ role: "assistant", content: reply });
        zhUpsert(ses, waId).catch(() => {});
      }

    } else {
      // ── Sin tool calls ──
      const reply = (ai.content || "").replace(/<PROFILE:\w+>/gi, "").trim()
        || "No te entendí bien, ¿me repites? 🤔";

      const parts = reply.split(/\n\n+/).filter(Boolean);
      if (parts.length > 1) await waSendMultiH(waId, parts, true);
      else await waSendH(waId, reply, true);

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

/* ================================================================
   18.  STARTUP VALIDATION
   ================================================================ */
(function validateCoeffs() {
  const products = new Set();
  const colors   = new Set();
  const glasses  = new Set();

  for (const key of Object.keys(COEFFS)) {
    const [p, c, g] = key.split("::");
    products.add(p);
    colors.add(c);
    glasses.add(g);
  }

  console.log(`📦 Productos: ${[...products].join(", ")}`);
  console.log(`🎨 Colores:   ${[...colors].join(", ")}`);
  console.log(`🪟 Vidrios:   ${[...glasses].join(", ")}`);

  // Verificar combinaciones faltantes conocidas
  const expected5 = ["CORREDERA_80", "CORREDERA_98", "OSCILOBATIENTE", "ABATIBLE"];
  for (const p of expected5) {
    for (const c of colors) {
      if (!COEFFS[`${p}::${c}::TP5+12+5`]) {
        console.log(`ℹ️  ${p}::${c} — solo TP4+12+4 (zona ≥5 NO upgradea vidrio)`);
      }
    }
  }
})();

app.listen(PORT, () =>
  console.log(`🚀 Ferrari 8.1 ACTIVO — port=${PORT} coeffs=${Object.keys(COEFFS).length} comunas=${Object.keys(ZONA_COMUNAS).length}`)
);
