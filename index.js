// index.js — WhatsApp IA + Zoho CRM (Ferrari 9.2)
// Railway | Node 18+ | ESM
// - Mantiene: keep-alive, typing loop, dedup, rate-limit, locks, vision, STT, PDF, Zoho upsert
// - Agrega: POST /quote (endpoint público para cotizar)
// - Nuevo: Motor de precios via WINPERFIL (tu PC vía túnel) con fallback opcional
// - Restricción: SOLO Winhouse PVC y Sodal Aluminio
// - Zonas: sin recomendación de 5+12+5 (solo nota normativa)

import express from "express";
import axios from "axios";
import http from "http";
import https from "https";
import dotenv from "dotenv";
import crypto from "crypto";
import FormData from "form-data";
import PDFDocument from "pdfkit";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { createRequire } from "module";
import fs from "fs";

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
   1) LOGGING
   ========================= */
function logErr(ctx, e) {
  if (e?.response) {
    console.error(
      `❌ ${ctx} [${e.response.status}]: ${JSON.stringify(e.response.data).slice(0, 400)}`
    );
  } else if (e?.request) {
    console.error(`❌ ${ctx} [NET]: Sin respuesta`);
  } else {
    console.error(`❌ ${ctx}: ${e?.message || String(e)}`);
  }
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

// Precios
// PRICER_MODE:
// - "winperfil" = llama a tu PC por túnel
// - "coeffs"    = usa ecuaciones locales (fallback/dev)
const PRICER_MODE = (process.env.PRICER_MODE || "winperfil").toLowerCase();
const WINPERFIL_API_BASE = (process.env.WINPERFIL_API_BASE || "").replace(/\/$/, "");
const WINPERFIL_API_KEY = process.env.WINPERFIL_API_KEY || ""; // opcional (para proteger tu bridge)

// Zoho
const REQUIRE_ZOHO = String(process.env.REQUIRE_ZOHO || "true") === "true";
const ZOHO = {
  CLIENT_ID: process.env.ZOHO_CLIENT_ID,
  CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET,
  REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN,
  API: process.env.ZOHO_API_DOMAIN || "https://www.zohoapis.com",
  ACCOUNTS: process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.com",
  DEAL_PHONE: process.env.ZOHO_DEAL_PHONE_FIELD || "WhatsApp_Phone",
  DEAL_PROFILE: process.env.ZOHO_DEAL_PROFILE_FIELD || "",
  DEFAULT_ACCT: process.env.ZOHO_DEFAULT_ACCOUNT_NAME || "Clientes WhatsApp IA",
};

const COMPANY = {
  NAME: process.env.COMPANY_NAME || "Activa Inversiones",
  PHONE: process.env.COMPANY_PHONE || "+56 9 1234 5678",
  EMAIL: process.env.COMPANY_EMAIL || "ventas@activa.cl",
  ADDRESS: process.env.COMPANY_ADDRESS || "Temuco, La Araucanía, Chile",
  WEBSITE: process.env.COMPANY_WEBSITE || "www.activa.cl",
  RUT: process.env.COMPANY_RUT || "76.XXX.XXX-X",
};

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
  try {
    return JSON.stringify(x);
  } catch {
    return "{}";
  }
}

/* =========================
   6) ZONAS TÉRMICAS (OGUC Art. 4.1.10)
   - SIN sugerir 5+12+5
   ========================= */
const ZONA_COMUNAS = {
  temuco: 5,
  "padre las casas": 5,
  // ... (puedes mantener tu mapa completo; lo recorté aquí por espacio)
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
   7) RESTRICCIÓN CATÁLOGO: SOLO 2 PROVEEDORES
   - PVC Winhouse
   - Aluminio Sodal
   ========================= */
const ALLOWED_SUPPLIERS = ["WINHOUSE_PVC", "SODAL_ALUMINIO"];

// Clasificación simple: si el texto menciona aluminio => SODAL_ALUMINIO, si no => WINHOUSE_PVC
function detectSupplier(text) {
  const s = strip(text).toLowerCase();
  if (/\baluminio\b|sodal|muro cortina/.test(s)) return "SODAL_ALUMINIO";
  return "WINHOUSE_PVC";
}

// Normaliza productos “de conversación” a categorías que Winperfil puede entender (ajusta a tu naming real)
function normProduct(raw = "") {
  const s = strip(raw).toUpperCase();
  if (s.includes("PUERTA") && /DOBLE|2\s*HOJ|DOS\s*HOJ/.test(s)) return "PUERTA_DOBLE";
  if (s.includes("PUERTA")) return "PUERTA_1H";
  if (s.includes("PROYEC")) return "PROYECTANTE";
  if (/MARCO|FIJO|PA[NÑ]O/.test(s)) return "MARCO_FIJO";
  if (s.includes("OSCILO")) return "OSCILOBATIENTE";
  if (s.includes("ABAT")) return "ABATIBLE";
  if (s.includes("CORREDERA") && s.includes("98")) return "CORREDERA_98";
  if (s.includes("CORREDERA")) return "CORREDERA_80";
  return "";
}

function normMeasures(raw) {
  const nums = String(raw || "").match(/(\d+([.,]\d+)?)/g);
  if (!nums || nums.length < 2) return null;
  let a = parseFloat(nums[0].replace(",", "."));
  let b = parseFloat(nums[1].replace(",", "."));
  // heurísticas
  if (a <= 6) a *= 1000;
  if (b <= 6) b *= 1000;
  if (a >= 7 && a <= 300) a *= 10;
  if (b >= 7 && b <= 300) b *= 10;
  return { ancho_mm: Math.round(a), alto_mm: Math.round(b) };
}

function normColor(text = "") {
  const s = strip(text).toUpperCase();
  if (/ANTRAC|GRAF|NEGR/.test(s)) return "NEGRO";
  if (/ROBLE|NOGAL|MADER/.test(s)) return "NOGAL";
  return "BLANCO";
}

/* =========================
   8) MOTOR DE PRECIOS (WINPERFIL o COEFFS fallback)
   ========================= */
// COEFFS opcional (fallback/dev)
function loadCoeffs() {
  const p = process.env.PRICE_COEFFS_PATH || "./coefficients_v3.json";
  try {
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, "utf-8"));
      console.log(`✅ COEFFS: ${p} (${Object.keys(j).length} keys)`);
      return j;
    }
  } catch (e) {
    logErr("loadCoeffs", e);
  }
  return {};
}
const COEFFS = PRICER_MODE === "coeffs" ? loadCoeffs() : {};

function calcPrice(c, W, H) {
  return Math.max(
    0,
    Math.round(c.a + c.b * W + c.c * H + c.d * W * H + c.e * W * W + c.f * H * H)
  );
}

function quoteByCoeffs({ supplier, product, color, measures, qty }) {
  const m = normMeasures(measures);
  if (!m) return { ok: false, error: "Medidas no interpretables" };

  const p = normProduct(product);
  if (!p) return { ok: false, error: "Producto no reconocido" };

  // key simple (ajusta a tus keys reales)
  const key = `${supplier}::${p}::${color}`;
  const coeffs = COEFFS[key];
  if (!coeffs) return { ok: false, error: `Sin ecuación: ${key}` };

  const unit = calcPrice(coeffs, m.ancho_mm, m.alto_mm);
  const q = Math.max(1, Number(qty) || 1);
  return { ok: true, unit_price: unit, total_price: unit * q };
}

// Winperfil vía HTTP (tu PC / tunnel)
async function quoteByWinperfil(payload) {
  // payload esperado:
  // {
  //   message: "texto original",                 (opcional)
  //   supplier: "WINHOUSE_PVC"|"SODAL_ALUMINIO",
  //   items: [{ product, measures, qty, color }],
  //   customer_id: "...",                       (opcional)
  //   meta: { comuna, zona_termica }            (opcional)
  // }
  try {
    const headers = { "Content-Type": "application/json" };
    if (WINPERFIL_API_KEY) headers["X-API-Key"] = WINPERFIL_API_KEY;

    const { data } = await axios.post(`${WINPERFIL_API_BASE}/quote`, payload, {
      headers,
      timeout: 30000,
      httpAgent,
      httpsAgent,
    });

    // data recomendado:
    // { ok:true, total:123, estimate_url:"...", items:[{unit_price,total_price,...}] }
    return data;
  } catch (e) {
    logErr("quoteByWinperfil", e);
    return { ok: false, error: "No pude conectar con Winperfil (bridge/túnel)" };
  }
}

/* =========================
   9) WHATSAPP API (typing + keepalive)
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
  } catch {
    // fire-and-forget
  }
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

function humanMs(text) {
  const w = String(text || "").trim().split(/\s+/).length;
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

async function waSendH(to, text, skipTyping = false) {
  const stop = skipTyping ? null : startTypingLoop(to);
  try {
    await sleep(humanMs(text));
    await waSend(to, text);
  } finally {
    stop?.();
  }
}

async function waSendMultiH(to, msgs, skipTyping = false) {
  const stop = skipTyping ? null : startTypingLoop(to);
  try {
    for (const m of msgs) {
      if (!m?.trim()) continue;
      await sleep(humanMs(m));
      await waSend(to, m);
      await sleep(250 + Math.random() * 450);
    }
  } finally {
    stop?.();
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

async function waUploadPdf(buf, fn = "Cotizacion.pdf") {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buf, { filename: fn, contentType: "application/pdf" });

  const { data } = await axiosWA.post(`/${META.PHONE_ID}/media`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
  });
  return data.id;
}

async function waSendPdf(to, mid, caption, fn) {
  try {
    await axiosWA.post(`/${META.PHONE_ID}/messages`, {
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: { id: mid, filename: fn, caption },
    });
  } catch (e) {
    logErr("waSendPdf", e);
  }
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
  return { buffer: Buffer.from(data), mime: headers["content-type"] || "application/octet-stream" };
}

function verifySig(req) {
  if (!META.SECRET) return true;
  const sig = req.get("X-Hub-Signature-256") || req.get("x-hub-signature-256");
  if (!sig || !req.rawBody) return false;
  const exp =
    "sha256=" +
    crypto.createHmac("sha256", META.SECRET).update(req.rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp));
  } catch {
    return false;
  }
}

/* =========================
   10) MEDIA: STT + VISION + PDF TEXT
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
              text:
                `Analiza esta imagen y extrae TODOS los productos de ventanas/puertas.\n` +
                `Para CADA uno indica: tipo, medidas (ancho×alto), cantidad, color si aparece.\n` +
                `Si hay tabla, extrae cada fila. Si algo no se lee, indícalo.`,
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

async function readPdf(buf) {
  try {
    const r = await pdfParse(buf);
    const t = (r?.text || "").trim();
    return t.length > 6000 ? t.slice(0, 6000) + "…" : t;
  } catch {
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

    // nuevo: supplier preferido (default PVC Winhouse)
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
  for (const [id, s] of sessions) {
    if ((s.lastAt || 0) < cut) sessions.delete(id);
  }
}, 3_600_000);

/* =========================
   12) DEDUP + RATE + LOCK
   ========================= */
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
  if (now >= r.r) {
    r.n = 0;
    r.r = now + 60_000;
  }
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
   15) SYSTEM PROMPT + TOOLS
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
- No inventes precios. Si falta info, pregunta 1 cosa a la vez.

OBJETIVO:
1) Capturar items (tipo, medidas, qty)
2) Color
3) Comuna
4) Cotizar (usando el sistema)
5) Ofrecer PDF formal y registrar en Zoho
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
          default_color: { type: "string", description: "blanco, negro, nogal" },
          comuna: { type: "string" },
          address: { type: "string" },
          project_type: { type: "string" },
          install: { type: "string" },
          wants_pdf: { type: "boolean" },
          notes: { type: "string" },

          supplier: {
            type: "string",
            description: "WINHOUSE_PVC o SODAL_ALUMINIO (si no, se asigna automáticamente)",
          },

          items: {
            type: "array",
            description:
              "Lista COMPLETA de productos. Cada item: product, measures, qty, color opcional",
            items: {
              type: "object",
              properties: {
                product: { type: "string" },
                measures: { type: "string", description: "ancho×alto. Ej: 2000x2000" },
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
      const price = it.unit_price
        ? `$${Number(it.unit_price).toLocaleString("es-CL")} c/u → $${Number(
            it.total_price
          ).toLocaleString("es-CL")}`
        : it.price_warning || "pendiente";
      status.push(`${i + 1}. ${it.qty}× ${it.product} ${it.measures} [${c}] → ${price}`);
    }
    if (d.grand_total)
      status.push(`★ TOTAL: $${Number(d.grand_total).toLocaleString("es-CL")} + IVA`);
  }

  if (!done) status.push(`FALTA: "${missing}" (pregunta de a 1).`);

  const msgs = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: status.join("\n") },
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
      max_tokens: 700,
    });

    return r.choices?.[0]?.message;
  } catch (e) {
    logErr("runAI", e);
    return { role: "assistant", content: "Dame un segundo… 🔍" };
  }
}

/* =========================
   17) QUOTE APPLY (Winperfil o Coeffs)
   ========================= */
async function priceAll(d, customer_id = "") {
  // Ajusta supplier automáticamente si el usuario escribió “aluminio…”
  if (!ALLOWED_SUPPLIERS.includes(d.supplier)) d.supplier = "WINHOUSE_PVC";

  // Normaliza colores y productos
  const items = d.items.map((it) => {
    const color = normColor(it.color || d.default_color || "");
    const product = normProduct(it.product || "");
    return {
      product: product || it.product || "",
      measures: it.measures || "",
      qty: Math.max(1, Number(it.qty) || 1),
      color,
    };
  });

  // Si algo no calza, marca warning
  let allOkInputs = true;
  for (const it of items) {
    if (!it.product || !it.measures || !it.color) allOkInputs = false;
  }
  if (!allOkInputs) return { ok: false, error: "Faltan datos en items (producto/medidas/color)" };

  if (PRICER_MODE === "winperfil") {
    const payload = {
      supplier: d.supplier,
      items,
      customer_id: customer_id || "",
      meta: { comuna: d.comuna || "", zona_termica: d.zona_termica || null },
    };
    const r = await quoteByWinperfil(payload);
    return r;
  }

  // coeffs fallback
  let total = 0;
  const priced = [];
  for (const it of items) {
    const r = quoteByCoeffs({
      supplier: d.supplier,
      product: it.product,
      color: it.color,
      measures: it.measures,
      qty: it.qty,
    });
    if (!r.ok) return r;
    priced.push({ ...it, unit_price: r.unit_price, total_price: r.total_price });
    total += r.total_price;
  }
  return { ok: true, supplier: d.supplier, items: priced, total };
}

/* =========================
   18) PDF MULTI-ITEM
   ========================= */
function dateCL(d = new Date()) {
  return d.toLocaleDateString("es-CL", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function genQN() {
  const n = new Date();
  const yy = String(n.getFullYear()).slice(-2);
  const mm = String(n.getMonth() + 1).padStart(2, "0");
  const dd = String(n.getDate()).padStart(2, "0");
  return `COT-${yy}${mm}${dd}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

function fmtP(n) {
  return n != null ? `$${Number(n).toLocaleString("es-CL")}` : "—";
}

async function buildPdf(data, qn) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      const P = "#1a365d",
        S = "#4a5568",
        L = "#f7fafc";

      doc.rect(0, 0, 612, 108).fill(P);
      doc.fillColor("#fff").fontSize(22).font("Helvetica-Bold").text(COMPANY.NAME, 50, 25);
      doc.fontSize(10).font("Helvetica").text("Cotización — Ventanas y Puertas", 50, 52);
      doc.fontSize(9)
        .text(`${COMPANY.PHONE}  •  ${COMPANY.EMAIL}`, 50, 68)
        .text(COMPANY.ADDRESS, 50, 82);

      doc.fontSize(16).font("Helvetica-Bold").text("COTIZACIÓN", 380, 28, {
        align: "right",
        width: 180,
      });
      doc.fontSize(10).font("Helvetica")
        .text(qn, 380, 50, { align: "right", width: 180 })
        .text(`Fecha: ${dateCL()}`, 380, 66, { align: "right", width: 180 })
        .text("Válida: 15 días", 380, 80, { align: "right", width: 180 });

      let y = 125;
      doc.fillColor(P).fontSize(11).font("Helvetica-Bold").text("CLIENTE", 50, y);
      y += 16;

      doc.fillColor(S).fontSize(9).font("Helvetica");
      if (data.name) {
        doc.text(`Nombre: ${data.name}`, 50, y);
        y += 14;
      }
      const loc = data.address || data.comuna;
      if (loc) {
        doc.text(`Ubicación: ${loc}`, 50, y);
        y += 14;
      }
      if (data.zona_termica) {
        doc.text(`Zona Térmica OGUC: Z${data.zona_termica}`, 50, y);
        y += 14;
      }
      doc.text(`Proveedor: ${data.supplier}`, 50, y);
      y += 20;

      doc.fillColor(P).fontSize(11).font("Helvetica-Bold").text("DETALLE", 50, y);
      y += 18;

      const cols = [
        { x: 52, w: 22, label: "#" },
        { x: 74, w: 155, label: "Producto" },
        { x: 229, w: 90, label: "Medida" },
        { x: 319, w: 35, label: "Qty" },
        { x: 354, w: 95, label: "Unitario" },
        { x: 449, w: 110, label: "Subtotal" },
      ];

      doc.rect(50, y, 512, 18).fill(P);
      doc.fillColor("#fff").fontSize(7).font("Helvetica-Bold");
      for (const c of cols) doc.text(c.label, c.x, y + 5, { width: c.w });
      y += 18;

      doc.fillColor(S).fontSize(7).font("Helvetica");
      for (const [i, item] of data.items.entries()) {
        const bg = i % 2 === 0 ? L : "#ffffff";
        doc.rect(50, y, 512, 16).fill(bg);
        const color = item.color || data.default_color || "";
        doc.fillColor(S);
        doc.text(String(i + 1), cols[0].x, y + 4, { width: cols[0].w });
        doc.text(`${item.product} ${color}`.trim(), cols[1].x, y + 4, { width: cols[1].w });
        doc.text(item.measures || "", cols[2].x, y + 4, { width: cols[2].w });
        doc.text(String(item.qty || 1), cols[3].x, y + 4, { width: cols[3].w });
        doc.text(fmtP(item.unit_price), cols[4].x, y + 4, { width: cols[4].w });
        doc.text(fmtP(item.total_price), cols[5].x, y + 4, { width: cols[5].w });
        y += 16;
      }

      y += 8;
      doc.rect(50, y, 512, 26).fill(L);
      doc.fillColor(P).fontSize(13).font("Helvetica-Bold")
        .text(`TOTAL: ${fmtP(data.grand_total)} + IVA`, 65, y + 6);

      y += 44;
      doc.fillColor(P).fontSize(10).font("Helvetica-Bold").text("NORMATIVA", 50, y);
      y += 14;
      doc.fillColor(S).fontSize(8).font("Helvetica");
      const norms = [
        "✓ OGUC Art. 4.1.10 — Acondicionamiento térmico obligatorio",
        "✓ NCh 2485 — Aislación térmica | NCh 888 — Vidrios de seguridad",
      ];
      for (const l of norms) {
        doc.text(l, 55, y);
        y += 11;
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

/* =========================
   19) ZOHO CRM (igual que antes)
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

  const { data } = await axios.post(`${ZOHO.ACCOUNTS}/oauth/v2/token`, p.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    httpsAgent,
    timeout: 30000,
  });

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

const zhH = async () => ({ Authorization: `Zoho-oauthtoken ${await zhToken()}` });

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
      if (e.response?.status === 204 || e.response?.data?.code === "INVALID_QUERY") continue;
      logErr(`zhFind(${f})`, e);
      return null;
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
  const L = [
    `Proveedor: ${d.supplier}`,
    `Color: ${d.default_color || "—"}`,
    `Comuna: ${d.comuna || "—"}`,
  ];
  if (d.zona_termica) L.push(`Zona: Z${d.zona_termica}`);
  L.push("", "ITEMS:");
  for (const [i, it] of d.items.entries()) {
    const c = it.color || d.default_color || "—";
    const p = it.total_price ? fmtP(it.total_price) : "pend";
    L.push(`${i + 1}. ${it.qty}× ${it.product} ${it.measures} [${c}] → ${p}`);
  }
  if (d.grand_total) L.push(`\nTOTAL: ${fmtP(d.grand_total)} +IVA`);
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
}

/* =========================
   20) ENDPOINTS
   ========================= */

// Health
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    v: "9.2",
    pricer_mode: PRICER_MODE,
    winperfil_api: WINPERFIL_API_BASE ? "set" : "missing",
  });
});

// WhatsApp webhook verify
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === META.VERIFY) return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

// ✅ NUEVO: endpoint /quote (para CMD, Zoho Deluge o pruebas)
app.post("/quote", async (req, res) => {
  // Acepta JSON:
  // { message, supplier?, items? }
  // - Si mandas items: cotiza esos
  // - Si mandas message: solo lo reenvía al bridge (si tu bridge parsea)
  try {
    const message = String(req.body?.message || "").trim();
    const supplier = req.body?.supplier || detectSupplier(message);
    const items = Array.isArray(req.body?.items) ? req.body.items : null;

    if (!ALLOWED_SUPPLIERS.includes(supplier)) {
      return res.status(400).json({ ok: false, error: "Proveedor no permitido" });
    }

    const payload = {
      supplier,
      message,
      items: items || [],
      customer_id: String(req.body?.customer_id || ""),
      meta: req.body?.meta || {},
    };

    // Si vienen items vacíos y no hay message, no hay nada que cotizar
    if ((!payload.items || payload.items.length === 0) && !payload.message) {
      return res.status(400).json({ ok: false, error: "Falta message o items" });
    }

    // Si estás en coeffs y no mandas items, no podemos calcular
    if (PRICER_MODE === "coeffs" && (!items || items.length === 0)) {
      return res.status(400).json({ ok: false, error: "Modo coeffs requiere items[]" });
    }

    const r =
      PRICER_MODE === "winperfil"
        ? await quoteByWinperfil(payload)
        : (() => ({ ok: false, error: "Modo coeffs no soporta message-only" }))();

    res.json(r);
  } catch (e) {
    logErr("/quote", e);
    res.status(500).json({ ok: false, error: "Error interno /quote" });
  }
});

// WhatsApp webhook events
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

    // Media -> texto
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

    // Reset
    if (/^reset|nueva cotizaci[oó]n|empezar de nuevo/i.test(userText)) {
      ses.data = emptyData();
      ses.pdfSent = false;
      await waSendH(waId, "🔄 Listo, empecemos de cero.\n¿Qué ventanas o puertas necesitas?", true);
      saveSession(waId, ses);
      return;
    }

    ses.history.push({ role: "user", content: userText });

    // AI
    const ai = await runAI(ses, userText);

    // Tool calls
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

        // supplier
        if (args.supplier && ALLOWED_SUPPLIERS.includes(args.supplier)) d.supplier = args.supplier;
        else d.supplier = detectSupplier(userText + " " + safeJson(args));

        // campos simples
        for (const k of ["name", "default_color", "comuna", "address", "project_type", "install", "notes"]) {
          if (args[k] != null && args[k] !== "") d[k] = args[k];
        }
        if (args.wants_pdf === true) d.wants_pdf = true;

        // items
        if (Array.isArray(args.items) && args.items.length > 0) {
          d.items = args.items.map((it, i) => ({
            id: i + 1,
            product: it.product || "",
            measures: it.measures || "",
            qty: Math.max(1, Number(it.qty) || 1),
            color: it.color || "",
            unit_price: null,
            total_price: null,
            price_warning: "",
          }));
        }

        // zona
        if (d.comuna && !d.zona_termica) {
          const zt = getZona(d.comuna);
          if (zt) d.zona_termica = zt;
        }

        // si ya hay datos, cotiza
        if (canQuote(d)) {
          const customer_id = "";
          const qr = await priceAll(d, customer_id);

          if (qr.ok) {
            // Aplica precios al session
            const pricedItems = qr.items || [];
            if (pricedItems.length === d.items.length) {
              for (let i = 0; i < d.items.length; i++) {
                d.items[i].unit_price = pricedItems[i].unit_price ?? null;
                d.items[i].total_price = pricedItems[i].total_price ?? null;
                d.items[i].color = pricedItems[i].color || d.items[i].color;
                d.items[i].product = pricedItems[i].product || d.items[i].product;
              }
            }
            d.grand_total = qr.total ?? null;
          } else {
            // Marca warnings
            for (const it of d.items) it.price_warning = qr.error || "No pude cotizar";
            d.grand_total = null;
          }
        }
      }

      const d = ses.data;

      // PDF
      const wantsPdf =
        isComplete(d) &&
        d.grand_total &&
        (d.wants_pdf || /pdf|cotiza|cotizaci[oó]n/i.test(userText));

      if (wantsPdf && !ses.pdfSent) {
        await waSendH(waId, "Perfecto. Preparando tu cotización formal… 📄", true);
        const qn = genQN();
        ses.quoteNum = qn;

        try {
          const buf = await buildPdf(d, qn);
          const mid = await waUploadPdf(buf, `Cotizacion_${qn}.pdf`);
          await waSendPdf(waId, mid, `Cotización ${qn} — ${COMPANY.NAME}`, `Cotizacion_${qn}.pdf`);
          ses.pdfSent = true;

          zhUpsert(ses, waId)
            .then(() => {
              if (ses.zohoDealId) return zhNote("Deals", ses.zohoDealId, `Cotización ${qn}`, buildDesc(d));
            })
            .catch(() => {});
        } catch (e) {
          logErr("PDF", e);
          await waSendH(waId, "Tuve un problema con el PDF. Lo preparo manual 🙏", true);
        }
      } else {
        // respuesta final del AI (follow-up)
        const reply = (ai.content || "").replace(/<PROFILE:\w+>/gi, "").trim() || "¿Me confirmas los datos?";

        const parts = reply.split(/\n\n+/).filter(Boolean);
        if (parts.length > 1) await waSendMultiH(waId, parts, true);
        else await waSendH(waId, parts[0], true);

        ses.history.push({ role: "assistant", content: reply });
        zhUpsert(ses, waId).catch(() => {});
      }
    } else {
      const reply = (ai?.content || "").replace(/<PROFILE:\w+>/gi, "").trim() || "No te entendí, ¿me repites? 🤔";
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
   21) START
   ========================= */
app.listen(PORT, () => {
  console.log(`🚀 Ferrari 9.2 — port=${PORT} pricer=${PRICER_MODE} winperfil=${WINPERFIL_API_BASE ? "OK" : "NO"}`);
});
