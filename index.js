// index.js — WhatsApp IA + Zoho CRM
// Ferrari 9.0 — MULTI-ITEM ARCHITECTURE
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
   3.  VALIDATION
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

/* ================================================================
   5.  ZONAS TÉRMICAS (OGUC Art. 4.1.10)
   ================================================================ */
const ZONA_COMUNAS = {
  arica:1,iquique:1,tocopilla:1,mejillones:1,
  antofagasta:2,"la serena":2,coquimbo:2,valparaiso:2,
  "vina del mar":2,"con con":2,quintero:2,"san antonio":2,
  copiapo:3,calama:3,ovalle:3,illapel:3,"san felipe":3,"los andes":3,
  santiago:4,providencia:4,"las condes":4,vitacura:4,"lo barnechea":4,
  nunoa:4,"la reina":4,penalolen:4,macul:4,"la florida":4,
  "puente alto":4,"san bernardo":4,maipu:4,quilicura:4,huechuraba:4,
  independencia:4,recoleta:4,conchali:4,renca:4,"quinta normal":4,
  "estacion central":4,cerrillos:4,"san miguel":4,"la cisterna":4,
  "el bosque":4,"la granja":4,"san ramon":4,"la pintana":4,
  colina:4,lampa:4,buin:4,paine:4,talagante:4,melipilla:4,
  penaflor:4,pirque:4,"lo prado":4,"cerro navia":4,pudahuel:4,
  rancagua:4,machali:4,"san fernando":4,curico:4,talca:4,
  linares:4,chillan:4,"los angeles":4,concepcion:4,talcahuano:4,
  "san pedro de la paz":4,hualpen:4,coronel:4,tome:4,penco:4,lota:4,
  temuco:5,"padre las casas":5,freire:5,vilcun:5,lautaro:5,
  "nueva imperial":5,carahue:5,pitrufquen:5,gorbea:5,perquenco:5,
  victoria:5,angol:5,collipulli:5,traiguen:5,puren:5,lumaco:5,
  cunco:5,melipeuco:5,villarrica:5,pucon:5,curacautin:5,lonquimay:5,
  valdivia:5,"la union":5,panguipulli:5,"rio bueno":5,
  mariquina:5,"los lagos":5,lanco:5,
  osorno:6,"puerto montt":6,"puerto varas":6,frutillar:6,
  llanquihue:6,calbuco:6,castro:6,ancud:6,dalcahue:6,quellon:6,chonchi:6,
  coyhaique:7,"puerto aysen":7,"chile chico":7,cochrane:7,
  "punta arenas":7,"puerto natales":7,porvenir:7,
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
  if (!z) return { glass: "TP4+12+4", note: "" };
  if (z <= 2) return { glass: "TP4+12+4", note: "Zona costera: DVH estándar cumple OGUC." };
  if (z <= 4) return { glass: "TP4+12+4", note: "Zona central: DVH estándar cumple. 5+12+5 mejora confort." };
  if (z === 5) return { glass: "TP5+12+5", note: "Zona 5 (Sur): DVH 5+12+5 recomendado." };
  if (z === 6) return { glass: "TP5+12+5", note: "Zona 6: DVH 5+12+5 mínimo. Low-E ideal." };
  return { glass: "TP5+12+5", note: "Zona austral: DVH 5+12+5 + Low-E recomendado." };
}

/* ================================================================
   6.  MOTOR DE PRECIOS
   ================================================================ */
const CORRECTIONS = { CORREDERA_80: 1.00, CORREDERA_98: 1.00 };

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

function hasCoeffs(prod, color, glass) {
  return !!COEFFS[`${prod}::${color}::${glass}`];
}

function normMeasures(raw) {
  const nums = String(raw || "").match(/(\d+([.,]\d+)?)/g);
  if (!nums || nums.length < 2) return null;
  let a = parseFloat(nums[0].replace(",", "."));
  let b = parseFloat(nums[1].replace(",", "."));
  if (a <= 6)  a *= 1000;
  if (b <= 6)  b *= 1000;
  if (a >= 7  && a <= 300) a *= 10;
  if (b >= 7  && b <= 300) b *= 10;
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

function normGlass(raw = "", fb = "TP4+12+4") {
  const s = strip(raw).toUpperCase();
  if (/5.*12.*5/.test(s)) return "TP5+12+5";
  if (/4.*12.*4/.test(s)) return "TP4+12+4";
  return fb;
}

function calcPrice(c, W, H) {
  return Math.max(0, Math.round(
    c.a + c.b * W + c.c * H + c.d * W * H + c.e * W * W + c.f * H * H
  ));
}

function bestGlass(product, colorText, zona) {
  const p = normProduct(product);
  const c = normColor(colorText);
  if (!p) return "TP4+12+4";
  if (p === "PUERTA_1H" || p === "PUERTA_DOBLE") return "TP5+12+5";
  if (zona && zona >= 5 && hasCoeffs(p, c, "TP5+12+5")) return "TP5+12+5";
  return "TP4+12+4";
}

function resolveKey({ product, colorText, glass, W, H }) {
  let model = product;
  const COLOR = normColor(colorText);
  let GLASS = glass;
  const rules = [];

  if (!model) return { ok: false, reason: "Producto no reconocido" };

  if (model === "PROYECTANTE" && (W > 1400 || H > 1400))
    return { ok: false, reason: "Proyectante máx 1400×1400 mm" };

  if (model === "MARCO_FIJO" && W >= 1000 && H >= 2000 &&
      hasCoeffs("MARCO_FIJO", COLOR, "TP5+12+5")) {
    GLASS = "TP5+12+5"; rules.push("Marco ≥1000×2000→TP5+12+5");
  }

  if (model === "PUERTA_1H") {
    if (W <= 1200 && H <= 2400) rules.push("Puerta 1H");
    else if (W <= 2400 && H <= 2400) { model = "PUERTA_DOBLE"; rules.push("→doble hoja"); }
    else return { ok: false, reason: "Puerta 1H máx 1200×2400" };
    GLASS = "TP5+12+5"; rules.push("Puerta→TP5+12+5");
  }
  if (model === "PUERTA_DOBLE") {
    if (W > 2400 || H > 2400) return { ok: false, reason: "Puerta doble máx 2400×2400" };
    GLASS = "TP5+12+5"; rules.push("Puerta doble→TP5+12+5");
  }

  if (model === "CORREDERA_80") {
    if (W < 400 || H < 400) return { ok: false, reason: "Corredera 80 mín 400×400" };
    if (W >= 2001 || H >= 2001) { model = "CORREDERA_98"; rules.push("→Corredera 98"); }
  }

  const key = `${model}::${COLOR}::${GLASS}`;
  return { ok: true, model, color: COLOR, glass: GLASS, key, rules };
}

function quoteEngine({ productText, glassText, measuresText, colorText, qty }) {
  const m = normMeasures(measuresText);
  if (!m) return { ok: false, reason: "Medidas no interpretables" };

  const { ancho_mm: W, alto_mm: H } = m;
  const product = normProduct(productText);
  const glass   = normGlass(glassText || "", "TP4+12+4");
  const r = resolveKey({ product, colorText: `${productText} ${colorText}`, glass, W, H });
  if (!r.ok) return { ...r, measures: m };

  const coeffs = COEFFS[r.key];
  if (!coeffs)
    return { ok: false, reason: `Sin ecuación para ${r.key}`, resolved: r, measures: m };

  let unit = calcPrice(coeffs, W, H);
  const corr = CORRECTIONS[r.model] || 1;
  if (corr !== 1) { unit = Math.round(unit * corr); r.rules.push(`Corrección ×${corr}`); }

  const q = Math.max(1, Number(qty) || 1);
  return { ok: true, unit_price: unit, total_price: Math.round(unit * q),
           qty: q, resolved: r, measures: m };
}

/* ================================================================
   6B. CÁLCULO MULTI-ITEM
   ================================================================ */
function calculateItemPrice(item, defaultColor, zona) {
  const color = item.color || defaultColor;
  if (!item.product || !item.measures || !color) {
    item.unit_price = null; item.total_price = null;
    item.glass = ""; item.price_warning = "Faltan datos";
    return false;
  }

  const glass = bestGlass(item.product, color, zona);
  const result = quoteEngine({
    productText: item.product, glassText: glass,
    measuresText: item.measures, colorText: color,
    qty: item.qty || 1,
  });

  if (result.ok) {
    item.glass         = result.resolved.glass;
    item.unit_price    = result.unit_price;
    item.total_price   = result.total_price;
    item.qty           = result.qty;
    item.price_key     = result.resolved.key;
    item.price_rules   = result.resolved.rules;
    item.price_warning = "";
    return true;
  } else {
    item.glass         = glass;
    item.unit_price    = null;
    item.total_price   = null;
    item.price_warning = result.reason || "Error";
    return false;
  }
}

function calculateAllPrices(d) {
  if (!d.items.length) return false;
  let total = 0;
  let allOk = true;

  for (const item of d.items) {
    const ok = calculateItemPrice(item, d.default_color, d.zona_termica);
    if (ok) total += item.total_price;
    else allOk = false;
  }

  d.grand_total = total > 0 ? total : null;
  return allOk;
}

/* ================================================================
   7.  WHATSAPP CLOUD API
   ================================================================ */
const waUrl = () => `https://graph.facebook.com/${META.VER}`;

async function waTyping(to) {
  try {
    await axios.post(`${waUrl()}/${META.PHONE_ID}/messages`,
      { messaging_product: "whatsapp", recipient_type: "individual",
        to, type: "text", typing_indicator: { type: "text" } },
      { headers: { Authorization: `Bearer ${META.TOKEN}` }, timeout: 5000 });
  } catch { /* ok */ }
}

function startTypingLoop(to, ms = 3500) {
  let on = true;
  const t = async () => { if (on) await waTyping(to); };
  t(); const id = setInterval(t, ms);
  return () => { on = false; clearInterval(id); };
}

function humanMs(text) {
  const w = String(text || "").trim().split(/\s+/).length;
  return Math.round((1200 + Math.min(6500, w * 170)) * (0.85 + Math.random() * 0.35));
}

async function waSend(to, body) {
  try {
    await axios.post(`${waUrl()}/${META.PHONE_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "text", text: { body } },
      { headers: { Authorization: `Bearer ${META.TOKEN}` }, timeout: 20000 });
  } catch (e) { logErr("waSend", e); }
}

async function waSendH(to, text, skip = false) {
  const stop = skip ? null : startTypingLoop(to);
  try { await sleep(humanMs(text)); await waSend(to, text); }
  finally { stop?.(); }
}

async function waSendMultiH(to, msgs, skip = false) {
  const stop = skip ? null : startTypingLoop(to);
  try {
    for (const m of msgs) {
      if (!m?.trim()) continue;
      await sleep(humanMs(m));
      await waSend(to, m);
      await sleep(300 + Math.random() * 400);
    }
  } finally { stop?.(); }
}

async function waRead(id) {
  try { await axios.post(`${waUrl()}/${META.PHONE_ID}/messages`,
    { messaging_product: "whatsapp", status: "read", message_id: id },
    { headers: { Authorization: `Bearer ${META.TOKEN}` }, timeout: 8000 });
  } catch { /* ok */ }
}

async function waUploadPdf(buf, fn = "Cotizacion.pdf") {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buf, { filename: fn, contentType: "application/pdf" });
  const { data } = await axios.post(`${waUrl()}/${META.PHONE_ID}/media`, form,
    { headers: { Authorization: `Bearer ${META.TOKEN}`, ...form.getHeaders() },
      maxBodyLength: Infinity });
  return data.id;
}

async function waSendPdf(to, mid, caption, fn) {
  try { await axios.post(`${waUrl()}/${META.PHONE_ID}/messages`,
    { messaging_product: "whatsapp", to, type: "document",
      document: { id: mid, filename: fn, caption } },
    { headers: { Authorization: `Bearer ${META.TOKEN}` } });
  } catch (e) { logErr("waSendPdf", e); }
}

async function waMediaUrl(id) {
  const { data } = await axios.get(`${waUrl()}/${id}`,
    { headers: { Authorization: `Bearer ${META.TOKEN}` } });
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
   8.  MEDIA — VISION ESPECIALIZADO
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
          { type: "text", text: `Analiza esta imagen (plano, croquis, planilla, cotización, o foto de ventanas/puertas).

EXTRAE ABSOLUTAMENTE TODOS los productos que identifiques. Para CADA uno indica:
1. Tipo: puerta corredera, ventana corredera, proyectante, fijo/marco fijo/paño fijo, abatible, oscilobatiente, puerta 1 hoja, puerta doble
2. Medidas: ancho × alto (en la unidad que aparezca: mm, cm o metros)
3. Cantidad
4. Color si se indica
5. Ubicación en plano o notas

IMPORTANTE:
- Si hay medidas DIFERENTES del mismo tipo → son items SEPARADOS
- Si hay una tabla, extrae CADA fila
- NO omitas ningún item
- Sé preciso con números y medidas
- Si no puedes leer algo, indícalo claramente` },
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

/* ================================================================
   9.  SESIONES — MULTI-ITEM
   ================================================================ */
const sessions    = new Map();
const SESSION_TTL = 6 * 3_600_000;
const MAX_HIST    = 30;

function emptyData() {
  return {
    name: "",
    comuna: "",
    address: "",
    project_type: "",
    install: "",
    default_color: "",
    zona_termica: null,
    profile: "",
    stageKey: "diagnostico",
    wants_pdf: false,
    notes: "",
    items: [],          // ★ ARRAY de productos
    grand_total: null,  // ★ suma de todos los items
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
function isDup(id) { if (!id) return false; if (seen.has(id)) return true; seen.set(id, Date.now()); return false; }
setInterval(() => { const c = Date.now()-7_200_000; for(const[id,ts]of seen)if(ts<c)seen.delete(id); }, 600_000);

const rateM = new Map();
function rateOk(waId) {
  const now = Date.now();
  if (!rateM.has(waId)) rateM.set(waId, { n: 0, r: now + 60_000 });
  const r = rateM.get(waId);
  if (now >= r.r) { r.n = 0; r.r = now + 60_000; }
  r.n++;
  return r.n > 15 ? { ok: false, msg: "Escribes muy rápido 😅 Dame unos segundos." } : { ok: true };
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

/* ================================================================
   11.  EXTRACT MSG
   ================================================================ */
function extractMsg(body) {
  const val = body?.entry?.[0]?.changes?.[0]?.value;
  if (val?.statuses?.length) return { ok: false };
  const msg = val?.messages?.[0];
  if (!msg) return { ok: false };
  const type = msg.type;
  let text = "";
  if (type === "text") text = msg.text?.body || "";
  else if (type === "button") text = msg.button?.text || "";
  else if (type === "interactive") text = JSON.stringify(msg.interactive || {});
  else text = `[${type}]`;
  return {
    ok: true, waId: msg.from, msgId: msg.id, type, text,
    audioId: msg.audio?.id || null, imageId: msg.image?.id || null,
    docId: msg.document?.id || null, docMime: msg.document?.mime_type || null,
  };
}

/* ================================================================
   12.  BUSINESS HELPERS — MULTI-ITEM
   ================================================================ */
function nextMissing(d) {
  if (!d.items.length) return "productos (tipo de ventana/puerta, medidas y cantidad)";
  const noProduct  = d.items.some(i => !i.product);
  const noMeasures = d.items.some(i => !i.measures);
  if (noProduct || noMeasures) return "completar datos de algunos productos";
  if (!d.default_color && d.items.some(i => !i.color)) return "color";
  if (!d.comuna && !d.address) return "comuna";
  return "";
}

function isComplete(d) {
  if (!d.items.length) return false;
  const hasColor = d.default_color || d.items.every(i => i.color);
  const hasLocation = d.comuna || d.address;
  const allItems = d.items.every(i => i.product && i.measures);
  return !!(hasColor && hasLocation && allItems);
}

function canCalcPrices(d) {
  if (!d.items.length) return false;
  const hasColor = d.default_color || d.items.every(i => i.color);
  return d.items.every(i => i.product && i.measures) && hasColor;
}

/* ================================================================
   13.  SYSTEM PROMPT & TOOLS — MULTI-ITEM
   ================================================================ */
const SYSTEM_PROMPT = `
Eres un ASESOR ESPECIALISTA EN VENTANAS Y PUERTAS DE PVC CON TERMOPANEL de ${COMPANY.NAME}, en ${COMPANY.ADDRESS}.

═══ PERSONALIDAD ═══
• Profesional chileno: cercano, cálido, confiable.
• NO eres formulario. CONVERSAS y ESCUCHAS.
• Preguntas de a uno cuando faltan datos sueltos.
• Si el cliente comenta algo personal, responde humanamente.

═══ CAPACIDAD MULTI-PRODUCTO ═══
★ IMPORTANTE: Los clientes frecuentemente envían imágenes o listas con MÚLTIPLES ventanas/puertas de diferentes tipos y medidas.
★ Cuando recibas una imagen o lista, DEBES extraer TODOS los productos y enviarlos como items en UNA sola llamada a update_quote.
★ NUNCA proceses los productos de a uno. Siempre envíalos TODOS juntos.

═══ NORMATIVA CHILENA ═══
• OGUC Art. 4.1.10: Acondicionamiento térmico obligatorio.
• Chile: 7 zonas térmicas con transmitancia (U) máxima por zona.
• NCh 2485: Aislación térmica. NCh 888: Vidrios de seguridad.
• CES: Ventanas PVC+DVH aportan puntos en envolvente.
• PVC: no conductor térmico, reciclable, +40 años vida útil, sin mantenimiento.

═══ ZONAS TÉRMICAS ═══
• Z1-3: DVH 4+12+4 cumple.
• Z4: DVH 4+12+4 cumple. 5+12+5 mejora.
• Z5: DVH 5+12+5 recomendado.
• Z6: DVH 5+12+5 mínimo.
• Z7: DVH Low-E + argón.

═══ PRODUCTOS ═══
Corredera 80 (hasta 2000×2000) | Corredera 98 (vanos grandes) | Proyectante (máx 1400×1400) | Abatible | Oscilobatiente | Marco Fijo | Puerta 1H (máx 1200×2400) | Puerta doble (máx 2400×2400).

═══ REGLAS ═══
• Vidrio SIEMPRE Termopanel (DVH). NO preguntes tipo de vidrio.
• Puertas siempre DVH 5+12+5.
• TÚ NO CALCULAS PRECIOS. El sistema lo hace automáticamente.
• NUNCA digas "$XXX.XXX" ni "voy a calcular". Si el precio está calculado, úsalo. Si no, di qué falta.

═══ FLUJO ═══
1. Saluda y pregunta qué necesita.
2. Si manda imagen/lista → extrae TODOS los items de una vez con update_quote.
3. Pregunta color (si no lo dijo).
4. Pregunta comuna (para zona térmica).
5. Con datos completos el sistema calcula TODOS los precios.
6. Presenta la cotización completa con TODOS los precios.
7. Ofrece PDF.

═══ PRESENTAR COTIZACIÓN MULTI-PRODUCTO ═══
Cuando el sistema te pase precios calculados, preséntalo así:
"Tu cotización:
1. 2× Corredera 2000×2000 negro → $XXX.XXX c/u → $XXX.XXX
2. 4× Fijo 2000×700 negro → $XXX.XXX c/u → $XXX.XXX
3. ...
*TOTAL: $X.XXX.XXX + IVA*
¿Te genero el PDF formal?"

═══ PERFIL ═══
Al final de CADA respuesta agrega 1 tag (invisible al cliente):
<PROFILE:PRECIO> <PROFILE:CALIDAD> <PROFILE:TECNICO> <PROFILE:AFINIDAD>
`.trim();

const tools = [{
  type: "function",
  function: {
    name: "update_quote",
    description: `Actualiza la cotización. Incluir SOLO campos que cambian.
Si se incluye 'items', enviar la lista COMPLETA de productos (reemplaza anteriores).
Si NO se incluye 'items', los productos existentes se mantienen.
IMPORTANTE: Cuando el cliente envía imagen/lista con múltiples productos, extraer TODOS como items en UNA sola llamada.`,
    parameters: {
      type: "object",
      properties: {
        name:          { type: "string",  description: "Nombre del cliente" },
        default_color: { type: "string",  description: "Color preferido global: blanco, negro/antracita, nogal" },
        comuna:        { type: "string",  description: "Comuna de instalación" },
        address:       { type: "string",  description: "Dirección" },
        project_type:  { type: "string",  description: "obra nueva/remodelación/ampliación/reposición" },
        install:       { type: "string",  description: "¿Necesita instalación?" },
        wants_pdf:     { type: "boolean", description: "true si quiere PDF formal" },
        notes:         { type: "string",  description: "Observaciones" },
        items: {
          type: "array",
          description: "Lista COMPLETA de productos a cotizar. Cada cambio debe incluir TODOS los items.",
          items: {
            type: "object",
            properties: {
              product:  { type: "string", description: "Tipo: corredera, proyectante, abatible, oscilobatiente, marco fijo/fijo, puerta, puerta doble" },
              measures: { type: "string", description: "Medidas ancho×alto ej: 2000x2000, 1.5x1.2, 150x70" },
              qty:      { type: "number", description: "Cantidad" },
              color:    { type: "string", description: "Color específico de este item (opcional)" },
            },
            required: ["product", "measures", "qty"],
          },
        },
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

  // Items resumen
  if (d.items.length) {
    status.push(`ITEMS EN MEMORIA (${d.items.length}):`);
    for (const [i, it] of d.items.entries()) {
      const c = it.color || d.default_color || "SIN COLOR";
      const price = it.unit_price
        ? `$${it.unit_price.toLocaleString("es-CL")} c/u → $${it.total_price.toLocaleString("es-CL")}`
        : (it.price_warning || "pendiente");
      status.push(`  ${i+1}. ${it.qty}× ${it.product} ${it.measures} [${c}] → ${price}`);
    }
    if (d.grand_total) status.push(`GRAN TOTAL: $${d.grand_total.toLocaleString("es-CL")} + IVA`);
  }

  if (done) status.push("DATOS COMPLETOS → presenta precios y ofrece PDF.");
  else      status.push(`FALTA: "${missing}". Pídelo amablemente.`);

  if (d.zona_termica) status.push(`Zona térmica: ${d.zona_termica}. ${zonaInfo(d.zona_termica).note}`);

  const msgs = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: status.join("\n") },
    ...session.history.slice(-12),
    { role: "user", content: userText },
  ];

  try {
    const r = await openai.chat.completions.create({
      model: AI_MODEL, messages: msgs, tools,
      tool_choice: "auto", parallel_tool_calls: false,
      temperature: 0.35, max_tokens: 600,
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
   15.  PDF — MULTI-LINE QUOTE
   ================================================================ */
function dateCL(d = new Date()) {
  return d.toLocaleDateString("es-CL", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function genQN() {
  const n = new Date();
  return `COT-${String(n.getFullYear()).slice(-2)}${String(n.getMonth()+1).padStart(2,"0")}${String(n.getDate()).padStart(2,"0")}-${Math.random().toString(36).substring(2,6).toUpperCase()}`;
}

function fmtPrice(n) {
  return n != null ? `$${Number(n).toLocaleString("es-CL")}` : "—";
}

async function buildPdf(data, qn) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];
      doc.on("data", c => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      const P = "#1a365d", S = "#4a5568", L = "#f7fafc";

      // ── Header ──
      doc.rect(0, 0, 612, 108).fill(P);
      doc.fillColor("#fff").fontSize(22).font("Helvetica-Bold")
         .text(COMPANY.NAME.toUpperCase(), 50, 25);
      doc.fontSize(10).font("Helvetica")
         .text("Ventanas y Puertas de PVC con Termopanel", 50, 52);
      doc.fontSize(9)
         .text(`${COMPANY.PHONE}  •  ${COMPANY.EMAIL}`, 50, 68)
         .text(COMPANY.ADDRESS, 50, 82);

      doc.fontSize(16).font("Helvetica-Bold")
         .text("COTIZACIÓN", 380, 28, { align: "right", width: 180 });
      doc.fontSize(10).font("Helvetica")
         .text(qn, 380, 50, { align: "right", width: 180 })
         .text(`Fecha: ${dateCL()}`, 380, 66, { align: "right", width: 180 })
         .text("Válida: 15 días", 380, 80, { align: "right", width: 180 });

      // ── Cliente ──
      let y = 125;
      doc.fillColor(P).fontSize(11).font("Helvetica-Bold").text("CLIENTE", 50, y); y += 16;
      doc.fillColor(S).fontSize(9).font("Helvetica");
      if (data.name) { doc.text(`Nombre: ${data.name}`, 50, y); y += 14; }
      if (data.comuna || data.address) {
        doc.text(`Ubicación: ${data.address || data.comuna}`, 50, y); y += 14;
      }
      if (data.zona_termica) {
        doc.text(`Zona Térmica OGUC: ${data.zona_termica}`, 50, y); y += 14;
      }
      if (data.project_type) {
        doc.text(`Proyecto: ${data.project_type}`, 50, y); y += 14;
      }

      // ── Tabla de Productos ──
      y += 8;
      doc.fillColor(P).fontSize(11).font("Helvetica-Bold").text("DETALLE DE PRODUCTOS", 50, y);
      y += 18;

      // Header de tabla
      const cols = [
        { x: 52,  w: 25,  label: "#" },
        { x: 77,  w: 135, label: "Producto" },
        { x: 212, w: 85,  label: "Medida (mm)" },
        { x: 297, w: 50,  label: "Vidrio" },
        { x: 347, w: 30,  label: "Qty" },
        { x: 377, w: 85,  label: "Unitario" },
        { x: 462, w: 95,  label: "Subtotal" },
      ];

      doc.rect(50, y, 512, 20).fill(P);
      doc.fillColor("#fff").fontSize(8).font("Helvetica-Bold");
      for (const col of cols) doc.text(col.label, col.x, y + 6, { width: col.w });
      y += 20;

      // Filas
      for (const [i, item] of data.items.entries()) {
        const bg = i % 2 === 0 ? L : "#ffffff";
        const rowH = 18;
        doc.rect(50, y, 512, rowH).fill(bg);
        doc.fillColor(S).fontSize(8).font("Helvetica");

        const color = item.color || data.default_color || "";
        const mNorm = normMeasures(item.measures);
        const mTxt  = mNorm ? `${mNorm.ancho_mm}×${mNorm.alto_mm}` : item.measures;

        doc.text(String(i + 1),                        cols[0].x, y + 5, { width: cols[0].w });
        doc.text(`${item.product || ""} ${color}`.trim(), cols[1].x, y + 5, { width: cols[1].w });
        doc.text(mTxt,                                 cols[2].x, y + 5, { width: cols[2].w });
        doc.text(item.glass || "DVH",                  cols[3].x, y + 5, { width: cols[3].w });
        doc.text(String(item.qty || 1),                cols[4].x, y + 5, { width: cols[4].w });
        doc.text(fmtPrice(item.unit_price),            cols[5].x, y + 5, { width: cols[5].w });
        doc.text(fmtPrice(item.total_price),           cols[6].x, y + 5, { width: cols[6].w });
        y += rowH;
      }

      // Gran Total
      y += 4;
      doc.rect(50, y, 512, 28).fill(L);
      doc.fillColor(P).fontSize(13).font("Helvetica-Bold")
         .text(`TOTAL: ${fmtPrice(data.grand_total)} + IVA`, 65, y + 7);
      y += 40;

      // ── Normativa ──
      doc.fillColor(P).fontSize(10).font("Helvetica-Bold").text("CUMPLIMIENTO NORMATIVO", 50, y);
      y += 15;
      doc.fillColor(S).fontSize(8).font("Helvetica");
      const norms = [
        "✓  OGUC Art. 4.1.10 — Acondicionamiento térmico obligatorio",
        "✓  NCh 2485 — Aislación térmica en edificaciones",
        "✓  NCh 888 — Vidrios de seguridad según aplicación",
        "✓  Compatible con Certificación CES (Edificio Sustentable)",
        "✓  Perfil PVC sin puente térmico — superior a aluminio",
      ];
      if (data.zona_termica) norms.push(`✓  ${zonaInfo(data.zona_termica).note}`);
      for (const l of norms) { doc.text(l, 55, y); y += 12; }

      // ── Footer ──
      y += 8;
      doc.moveTo(50, y).lineTo(562, y).strokeColor("#cbd5e0").lineWidth(0.5).stroke();
      y += 6;
      doc.fillColor(S).fontSize(7).font("Helvetica");
      doc.text("Precios en CLP + IVA  |  Sujeto a visita técnica  |  Instalación no incluida salvo indicación", 50, y);
      y += 10;
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
    refresh_token: ZOHO.REFRESH_TOKEN, client_id: ZOHO.CLIENT_ID,
    client_secret: ZOHO.CLIENT_SECRET, grant_type: "refresh_token",
  });
  const { data } = await axios.post(`${ZOHO.ACCOUNTS}/oauth/v2/token`, params.toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
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
    const { data } = await axios.post(`${ZOHO.API}/crm/v2/${mod}`,
      { data: [rec], trigger: ["workflow"] }, { headers: await zhH() });
    return data?.data?.[0]?.details?.id || null;
  } catch (e) { logErr(`zhCreate ${mod}`, e); return null; }
}

async function zhUpdate(mod, id, rec) {
  try { await axios.put(`${ZOHO.API}/crm/v2/${mod}/${id}`,
    { data: [rec], trigger: ["workflow"] }, { headers: await zhH() });
  } catch (e) { logErr(`zhUpdate ${mod}`, e); }
}

async function zhNote(mod, id, title, body) {
  try { await axios.post(`${ZOHO.API}/crm/v2/${mod}/${id}/Notes`,
    { data: [{ Note_Title: title, Note_Content: body }] }, { headers: await zhH() });
  } catch (e) { logErr("zhNote", e); }
}

async function zhDefaultAcct() {
  try {
    const h = await zhH();
    const name = ZOHO.DEFAULT_ACCT;
    const r = await axios.get(
      `${ZOHO.API}/crm/v2/Accounts/search?criteria=(Account_Name:equals:${encodeURIComponent(name)})`,
      { headers: h });
    if (r.data?.data?.[0]) return r.data.data[0].id;
    const c = await axios.post(`${ZOHO.API}/crm/v2/Accounts`,
      { data: [{ Account_Name: name }] }, { headers: h });
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
        { headers: h });
      if (data?.data?.[0]) return data.data[0];
    } catch (e) {
      if (e.response?.status === 204 || e.response?.data?.code === "INVALID_QUERY") continue;
      logErr(`zhFind(${f})`, e); return null;
    }
  }
  try {
    const q = `select id, Deal_Name from Deals where Description like '%${phone}%' limit 1`;
    const { data } = await axios.post(`${ZOHO.API}/crm/v2/coql`,
      { select_query: q }, { headers: h });
    return data?.data?.[0] || null;
  } catch { return null; }
}

function computeStage(d, s) {
  if (s.pdfSent) return "propuesta";
  if (isComplete(d)) return "validacion";
  if (d.items.length) return "siembra";
  return "diagnostico";
}

function buildDesc(d) {
  const L = [];
  L.push(`Color: ${d.default_color || "—"}`);
  L.push(`Comuna: ${d.comuna || "—"}`);
  if (d.zona_termica) L.push(`Zona: ${d.zona_termica}`);
  L.push(`Proyecto: ${d.project_type || "—"}`);
  L.push("");
  L.push("ITEMS:");
  for (const [i, it] of d.items.entries()) {
    const c = it.color || d.default_color || "—";
    const p = it.total_price ? `$${it.total_price.toLocaleString("es-CL")}` : "pendiente";
    L.push(`${i+1}. ${it.qty}× ${it.product} ${it.measures} [${c}] ${it.glass||""} → ${p}`);
  }
  if (d.grand_total) L.push(`\nGRAN TOTAL: $${d.grand_total.toLocaleString("es-CL")} +IVA`);
  if (d.profile) L.push(`Perfil: ${d.profile}`);
  return L.join("\n");
}

async function zhUpsert(ses, waId) {
  if (!REQUIRE_ZOHO) return;
  const d = ses.data;
  const phone = normPhone(waId);
  d.stageKey = computeStage(d, ses);

  const mainProduct = d.items[0]?.product || "Ventanas";
  const deal = {
    Deal_Name: `${mainProduct} ${d.default_color||""} [WA …${String(waId).slice(-4)}]`.trim(),
    Stage: STAGES[d.stageKey] || STAGES.diagnostico,
    Closing_Date: addDays(new Date(), 30).toISOString().split("T")[0],
    Description: buildDesc(d),
  };
  if (ZOHO.DEAL_PHONE) deal[ZOHO.DEAL_PHONE] = phone;
  if (d.profile && ZOHO.DEAL_PROFILE) deal[ZOHO.DEAL_PROFILE] = d.profile;
  if (d.grand_total) deal.Amount = d.grand_total;

  const existing = await zhFindDeal(phone);
  if (existing?.id) { ses.zohoDealId = existing.id; await zhUpdate("Deals", existing.id, deal); }
  else { const accId = await zhDefaultAcct(); if (accId) deal.Account_Name = { id: accId }; ses.zohoDealId = await zhCreate("Deals", deal); }
}

/* ================================================================
   17.  WEBHOOK
   ================================================================ */
app.get("/health", (_req, res) => res.json({
  ok: true, v: "9.0",
  coeffs: Object.keys(COEFFS).length,
  comunas: Object.keys(ZONA_COMUNAS).length,
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
      userText = t ? `[Audio transcrito]: ${t}` : "[Audio no reconocido]";
    }
    if (type === "image" && inc.imageId) {
      const meta = await waMediaUrl(inc.imageId);
      const { buffer, mime } = await waDownload(meta.url);
      const extracted = await vision(buffer, mime);
      userText = extracted
        ? `[IMAGEN - Extracción de productos]:\n${extracted}\n\nIMPORTANTE: Extrae TODOS los items de la imagen y envíalos con update_quote en UNA sola llamada.`
        : "[Imagen no legible]";
    }
    if (type === "document" && inc.docId && inc.docMime === "application/pdf") {
      const meta = await waMediaUrl(inc.docId);
      const { buffer } = await waDownload(meta.url);
      const t = await readPdf(buffer);
      userText = t
        ? `[PDF - Contenido]:\n${t}\n\nIMPORTANTE: Extrae TODOS los productos del PDF y envíalos con update_quote.`
        : "[PDF sin texto]";
    }

    // ── Reset ──
    if (/^reset|nueva cotizaci[oó]n|empezar de nuevo/i.test(userText)) {
      ses.data = emptyData();
      ses.pdfSent = false;
      await waSendH(waId, "🔄 Perfecto, empecemos de cero.\n¿Qué ventanas o puertas necesitas?", true);
      saveSession(waId, ses);
      return;
    }

    ses.history.push({ role: "user", content: userText });

    // ── AI ──
    const ai = await runAI(ses, userText);
    if (!ai) {
      await waSendH(waId, "Perdona, tuve un problema. ¿Me repites? 🙏", true);
      saveSession(waId, ses);
      return;
    }

    // ── TOOL CALLS ──
    if (ai.tool_calls?.length) {
      for (const tc of ai.tool_calls) {
        if (tc.function?.name !== "update_quote") continue;

        let args;
        try { args = JSON.parse(tc.function.arguments || "{}"); }
        catch (pe) { console.error("⚠️ tool parse:", pe.message); continue; }

        const d = ses.data;

        // Merge campos simples
        const simples = ["name","default_color","comuna","address","project_type","install","notes"];
        for (const k of simples) {
          if (args[k] != null && args[k] !== "") d[k] = args[k];
        }
        if (args.wants_pdf === true) d.wants_pdf = true;

        // Items: REEMPLAZAR si viene array
        if (Array.isArray(args.items) && args.items.length > 0) {
          d.items = args.items.map((it, i) => ({
            id: i + 1,
            product:       it.product  || "",
            measures:      it.measures || "",
            qty:           it.qty      || 1,
            color:         it.color    || "",
            glass:         "",
            unit_price:    null,
            total_price:   null,
            price_key:     "",
            price_rules:   [],
            price_warning: "",
          }));
        }

        // Zona térmica
        if (d.comuna && !d.zona_termica) {
          const zt = getZona(d.comuna);
          if (zt) d.zona_termica = zt;
        }

        // ── CALCULAR PRECIOS DE TODOS LOS ITEMS ──
        if (canCalcPrices(d)) {
          calculateAllPrices(d);
        }
      }

      const d = ses.data;

      // ── ¿PDF? ──
      const wantsPdf = isComplete(d) && d.grand_total &&
        (d.wants_pdf || /pdf|cotiza|cotizaci[oó]n/i.test(userText));

      if (wantsPdf && !ses.pdfSent) {
        await waSendH(waId, "Perfecto, te preparo la cotización formal con todos los productos… 📄", true);
        const qn = genQN();
        ses.quoteNum = qn;

        try {
          const buf = await buildPdf(d, qn);
          const mid = await waUploadPdf(buf, `Cotizacion_${qn}.pdf`);
          await waSendPdf(waId, mid, `Cotización ${qn} — ${COMPANY.NAME}`, `Cotizacion_${qn}.pdf`);
          ses.pdfSent = true;
          zhUpsert(ses, waId)
            .then(() => { if (ses.zohoDealId) zhNote("Deals", ses.zohoDealId, `Cotización ${qn}`, buildDesc(d)); })
            .catch(() => {});
        } catch (e) {
          logErr("PDF", e);
          await waSendH(waId, "Tuve un problema con el PDF. Te lo mando manualmente 🙏", true);
        }
      } else {
        // ── Follow-up con TODOS los precios calculados ──
        const itemsSummary = d.items.map((it, i) => ({
          num: i + 1,
          product: it.product,
          measures: it.measures,
          qty: it.qty,
          color: it.color || d.default_color || "sin color",
          glass: it.glass,
          unit_price: it.unit_price,
          total_price: it.total_price,
          warning: it.price_warning || "",
        }));

        const toolRes = ai.tool_calls.map(tc => ({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({
            ok: true,
            items_count: d.items.length,
            items: itemsSummary,
            grand_total: d.grand_total,
            all_prices_ok: d.items.length > 0 && d.items.every(i => i.unit_price != null),
            zona: d.zona_termica,
            zona_note: d.zona_termica ? zonaInfo(d.zona_termica).note : "",
            missing: nextMissing(d),
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
          max_tokens: 700,
        });

        const reply = (follow.choices?.[0]?.message?.content || "")
          .replace(/<PROFILE:\w+>/gi, "").trim();

        const parts = reply.split(/\n\n+/).filter(Boolean);
        if (parts.length > 1) await waSendMultiH(waId, parts, true);
        else await waSendH(waId, reply || "¿Me confirmas los datos?", true);

        ses.history.push({ role: "assistant", content: reply });
        zhUpsert(ses, waId).catch(() => {});
      }

    } else {
      // Sin tool calls
      const reply = (ai.content || "").replace(/<PROFILE:\w+>/gi, "").trim()
        || "No te entendí, ¿me repites? 🤔";
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
   18.  STARTUP
   ================================================================ */
(function validate() {
  const products = new Set();
  const colors = new Set();
  const glasses = new Set();
  for (const key of Object.keys(COEFFS)) {
    const [p, c, g] = key.split("::");
    products.add(p); colors.add(c); glasses.add(g);
  }
  console.log(`📦 Productos: ${[...products].join(", ")}`);
  console.log(`🎨 Colores:   ${[...colors].join(", ")}`);
  console.log(`🪟 Vidrios:   ${[...glasses].join(", ")}`);
})();

app.listen(PORT, () =>
  console.log(`🚀 Ferrari 9.0 MULTI-ITEM — port=${PORT} coeffs=${Object.keys(COEFFS).length} comunas=${Object.keys(ZONA_COMUNAS).length}`)
);
