// index.js — WhatsApp IA Oliver v11.8.1 (FIX template informe_diario 4 params)
// Railway | Node 18+ | ESM
// ═══════════════════════════════════════════════════════════════════
// CAMBIOS v11.8 vs v11.7 — 20 Mayo 2026 (consolidación auditoría 4 IAs):
//
// [V11.8-1] REGLA #23 AMPLIADA — Autoridad Marcelo + Envolvente Térmica
//           Preserva las 6 credenciales originales (NUNCA borradas) y agrega:
//           - Stack técnico WinHouse (EN 12608, Renolit alemán)
//           - 3 mercados que firma Marcelo: particular, subsidio SERVIU, arquitecto/DOM
//           - Contexto OGUC 4.1.10 vigente desde 28/11/2025
//           - 5 escenarios contextuales (vs 4 originales)
//
// [V11.8-2] REGLA #25 NUEVA — Seguimiento Proactivo Post-Propuesta
//           Secuencia obligatoria: 2-4h / 24h / 72h / 7 días.
//           Resuelve el problema crítico: 1 cierre de 53 cotizaciones (tasa 0%).
//
// [V11.8-3] REGLA #26 NUEVA — Escalación Caliente a Marcelo
//           6 triggers: alto valor, subsidio/DOM, señales cierre, fricción,
//           volumen alto, silencio post-PDF lead caliente. Marcelo llama y cierra.
//
// [V11.8-4] REGLA #27 NUEVA — Contención + Detección de Fuga + Postventa
//           Detecta competencia (Sodimac/DVP/Euromas/Habitissimo/Winko).
//           Postventa día 1/7/30/90. NPS con rama por nota (promoter/pasivo/detractor).
//
// [V11.8-5] REGLA #28 NUEVA — Segmentación Temprana Obligatoria
//           Pregunta de perfilamiento en turno 2. 3 árboles de decisión:
//           particular / subsidio SERVIU / arquitecto-DOM. Flujos distintos.
//
// [V11.8-6] REGLA #29 NUEVA — Formato 2026 + Balance Consultivo-Urgencia
//           Mensajes 3-4 líneas. Micro-resumen post-PDF. Urgencia REAL, no inventada.
//
// [V11.8-7] REGLA #30 NUEVA — Protocolo Handoff Humano (+56957296035)
//           Comandos /test, /humano, /bot_on. Diferencia pruebas internas
//           vs clientes reales escalados. Regla de oro: en duda → cliente real.
//
// [V11.8-8] REGLA #31 NUEVA — Prueba Social con Reseñas Google
//           4 momentos clave para compartir link de 24 reseñas 5 estrellas:
//           desconfianza, comparación precios, post-PDF, "lo pienso".
//           URL real Google Maps + Place ID configurados.
//           Datos dinámicos desde BD vía googleReviewsScanner (cron mensual).
//
// [V11.8-9] FLUJO DE CONVERSACIÓN — Agregado paso 3.5 SEGMENTAR
//           Entre CONECTAR y EDUCAR. Ramificación temprana por mercado.
//
// [V11.8-10] ARGUMENTOS DE VALOR — Ampliados de 7 a 10
//            +DOCUMENTO TÉCNICO (diferenciador único Marcelo)
//            +URGENCIA REAL (peak invierno Araucanía)
//            +REFERIDOS (programa fidelización)
//
// [V11.8-11] MANEJO DE OBJECIONES — Ampliado de 4 a 8
//            +"El subsidio no cubre eso"
//            +"Mi arquitecto tiene proveedor"
//            +"Sodimac me da garantía igual"
//            +"Quiero pensarlo con mi pareja/socio"
//            Reforzados: "Vi más barato" + "Lo pienso" con link reseñas y Marcelo
//
// [V11.8-12] COMPANY config — Google Reviews dinámicas
//            GOOGLE_REVIEWS_URL: URL real Google Maps de Activa
//            GOOGLE_REVIEWS_COUNT: 24 (fallback si BD vacía)
//            GOOGLE_REVIEWS_RATING: 5.0
//            GOOGLE_PLACE_ID: ChIJVaYXb1bVFJYR-3OFwAJ_mPg
//
// PRESERVADO 100% (suma, no resta):
//   ✓ Reglas #1 al #22 íntegras
//   ✓ Regla #24 español chileno íntegra
//   ✓ TU MISIÓN, INSTALACIÓN, DETECCIÓN DE PERFIL
//   ✓ TIPOS DE PRODUCTO, LENGUAJE AL CLIENTE, AUDIO Y VOZ, REGLAS DURAS
//   ✓ Las 6 credenciales de Marcelo (Ingeniero, MBA, Magíster, Diplomado, etc.)
//   ✓ 14 endpoints HTTP (operator-send, image, video, document, voice, audio, etc.)
//   ✓ Funciones críticas: canGeneratePdf, detectNegation, getLockedData,
//     buildLockedDataContext, trackConversationEvent, validateDimensions, etc.
//
// AUDITORÍA CONSOLIDADA: Claude + Gemini + GPT-4o + Perplexity
// META: tasa cierre 0% → 15% en 60 días
// ═══════════════════════════════════════════════════════════════════
// CAMBIOS v11.7 vs v11.6 — 22 Abril 2026 (diferenciador MINVU):
//
// [V11.7-1] NUEVA REGLA #23 — CEV EXPERT
//           Marcelo es Evaluador Energético Acreditado MINVU (Resolución 266/2025
//           EXENTA, N°63 Resuelvo 2). El bot activa tono de autoridad cuando
//           detecta keywords: eficiencia, CEV, MINVU, subsidio, aislación, etc.
//           No vende CEV aparte — lo usa como credencial de respaldo técnico.
//
// ═══════════════════════════════════════════════════════════════════
// CAMBIOS v11.6 vs v11.5 — 21 Abril 2026 (feature: audio grabado por operador):
// Railway | Node 18+ | ESM
// ═══════════════════════════════════════════════════════════════════
// CAMBIOS v11.6 vs v11.5 — 21 Abril 2026 (feature: audio grabado por operador):
//
// [V11.6-1] NUEVO endpoint /internal/operator-send-audio-recording
//           Recibe audio grabado (base64) desde el inbox, lo sube a Meta y lo
//           envía al cliente como nota de voz. Guarda en media_attachments
//           con direction=outbound para que aparezca en el inbox.
//           Complementa a operator-send-voice (texto→ElevenLabs) con
//           operator-send-audio-recording (voz real del operador → WhatsApp).
//
// ═══════════════════════════════════════════════════════════════════
// CAMBIOS v11.5 vs v11.4 — 21 Abril 2026 (release ENTERPRISE: 10 mejoras profesionales):
//
// [V11.5-1] PLANTILLAS META — 7 funciones sendTemplate*() + endpoint admin
//           Funciones: sendTemplateRecontactoLead, sendTemplateSeguimientoCotizacion,
//                      sendTemplateConfirmacionCotizacion, sendTemplateEnvioCotizacion,
//                      sendTemplateBienvenidaActiva, sendTemplateEscalamientoMarcelo,
//                      sendTemplateInformeDiario.
//           Endpoint: POST /admin/send-template?pin=XXXX&template=NAME&phone=569...
//           Permite reactivar leads dormidos (>24h) bypaseando ventana WhatsApp.
//
// [V11.5-2] DETECTOR DE AUDIOS ESPURIOS (audio bombing / TikTok forwards)
//           detectSpamAudio() identifica "amara.org / mamá / chao / outro / próximo
//           video / subtítulos comunidad". Si llegan 3+ audios espurios consecutivos
//           el bot pide texto educadamente y deja de procesar audios hasta texto.
//
// [V11.5-3] RESUMEN CONSOLIDADO AUTOMÁTICO cada 5 turnos (Regla 22 ahora activa)
//           ses.turnsSinceConsolidation cuenta turnos. A los 5 → inyecta instrucción
//           obligatoria al LLM para que resuma estado y pida confirmación.
//
// [V11.5-4] PROMPT OVERRIDES desde Postgres (tabla oliver_prompt_overrides ya creada)
//           loadPromptOverrides() lee al arranque + cada 5 min. Append al SYSTEM_PROMPT.
//           Permite cambiar reglas sin redeploy desde el dashboard.
//
// [V11.5-5] COMANDO ADMIN STATS por WhatsApp
//           Si vos (MARCELO_PHONE) escribís "STATS" o "STATUS", recibís:
//           PDFs hoy / leads activos / gates bloqueados / sesiones / version.
//
// [V11.5-6] AUTO RE-ANCLAJE POST-GHOSTING (Regla 17 ahora activa cron)
//           Cron interno cada 30 min revisa sesiones con last_msg > 4h pero < 48h.
//           Marca ses.needsReanchor=true → próximo turno bot re-ancla automático.
//
// [V11.5-7] DETECTOR DE LOOP DE CLIENTE
//           Si el cliente repite el MISMO mensaje 3 veces seguidas → escalación
//           inmediata con disculpa porque el bot no entiende. Distinto a frustración.
//
// [V11.5-8] MEMORIA EXTENDIDA — TTL aumentado de 60min → 7 días para leads con
//           ses.data.name. Clientes anónimos siguen con TTL corto (anti-spam).
//
// [V11.5-9] update_quote con flag confirmed_by_client (gate quirúrgico extra)
//           Sumado al rate-limit por tiempo. Doble candado.
//
// [V11.5-10] Logging estructurado de eventos clave para Optimizer Etapa 2B
//           Cada evento crítico → tabla oliver_events vía bridge. Sirve de input
//           al Claude API analyzer semanal.
//
// ═══════════════════════════════════════════════════════════════════
// CAMBIOS v11.4 vs v11.3 — 21 Abril 2026 (cierre 100% del bot, sin pendientes):
//
// [V11.4-1] GATE canGeneratePdf() ENCHUFADO al handler real de update_quote
//           (línea ~4018). Antes solo estaba definido pero no se llamaba.
//           Ahora bloquea generación PDF si:
//             - Hay <180 seg desde último PDF
//             - Cliente acaba de negar algo (ses.lastWasNegation)
//             - Turno actual contiene negación (detectNegation)
//
// [V11.4-2] PRE-PROCESADOR DE NEGACIÓN cross-turno
//           Antes del flujo principal, detectNegation() corre sobre userText.
//           Si detecta negación: setea ses.lastWasNegation=true + countdown=2.
//           Cada turno sin negación decrementa countdown. Llega a 0 → libera.
//           Esto hace que el gate funcione 2 turnos después de la negación.
//
// [V11.4-3] LOGGING de bloqueos. logInfo("pdf_gate_blocked", ...) cada vez
//           que el gate bloquea, con razón y contador. Para auditoría.
//
// ═══════════════════════════════════════════════════════════════════
// CAMBIOS v11.3 vs v11.2 — 21 Abril 2026 (pack BEAST: fixes estructurales en código, no solo prompt)
//
// [V11.3-1] STATE MACHINE REAL en código vía getLockedData(ses)
//           Helper que retorna {nombre, comuna, color, tipo, items} ya confirmados.
//           El LLM recibe esto pre-procesado y NO puede repreguntar datos lockeados.
//
// [V11.3-2] GATE ANTI-PDF-AVALANCHA vía canGeneratePdf(ses, userText)
//           Hard rate limit: 1 PDF cada 180 seg, NO generar tras negación del cliente,
//           NO generar si hay correcciones sin confirmar. Usado pre-update_quote.
//
// [V11.3-3] DETECTOR DE NEGACIÓN en código vía detectNegation(userText)
//           Regex patterns: "no", "sin X", "X no", "no quiero X", "cambio a X".
//           Pre-procesa ANTES de llegar al LLM. Si detecta, marca ses.lastWasNegation
//           y bloquea generación de PDF por 2 turnos.
//
// [V11.3-4] SANITIZADOR UNIVERSAL vía sanitizeForCustomer(text)
//           Hook en waSendH(): elimina JSON crudo, URLs SharePoint largas,
//           llaves {}, corchetes [] vacíos, campos internos. Nunca llega basura al cliente.
//
// [V11.3-5] FIX LOOP "Generando su propuesta…"
//           Flag ses.pdfStatusSent: se setea al primer envío. Nunca más duplicado en sesión.
//
// [V11.3-6] FIX BUG URLs VIDEOS CRUDAS (línea 4006 v11.2)
//           Segunda aparición del bug tipo-SharePoint: mandaba VIDEO_PLANTA/OFICINA etc
//           como URLs crudas al cliente. Ahora se omiten si son URLs largas (>80 chars).
//
// ═══════════════════════════════════════════════════════════════════
// CAMBIOS v11.2 vs v11.1 — 21 Abril 2026 (pack consenso multi-IA: Claude+Grok+Gemini+Perplexity+ChatGPT):
//
// [V11.2-1] 5 reglas nuevas al SYSTEM_PROMPT basadas en CHAT REAL OMAR (56931260340)
//           19 minutos, 6 PDFs generados, 10 veces preguntó comuna ya dada,
//           cliente terminó diciendo "Un fiasco el asistente virtual":
//           → Regla #18: PDF rate-limit (un PDF por sesión hasta confirmación)
//           → Regla #19: LOCK de datos (dato dado = inmutable, prohibido repreguntar)
//           → Regla #20: Detector de negación ("no", "sin X", "X no")
//           → Regla #21: Detector de frustración progresiva (no esperar a "fiasco")
//           → Regla #22: Resumen consolidado cada 4-5 turnos (anti-loop)
//
// [V11.2-2] Detector frustración (línea 3674) ampliado con: "fiasco", "pésimo", 
//           "horrible", "inútil", "no sirve", "mal hecho", "un asco", "que mal"
//
// [V11.2-3] FIX BUG URLs SharePoint en escalación (línea 3681): cumplir Regla #8
//           que el propio código violaba mandando PLANT_VIDEO_URL/OFFICE_VIDEO_URL
//           crudas. Ahora ofrece enviar videos por separado.
//
// [V11.2-4] FIX JSON crudo expuesto al cliente (líneas 3725, 4057): reemplaza
//           JSON.stringify(items) por descripción legible en español.
//
// [V11.2-5] FIX Mensaje "Generando su propuesta…" — solo 1 vez por sesión vía
//           flag pdfStatusSent en sesión.
//
// ═══════════════════════════════════════════════════════════════════
// CAMBIOS v11.1 vs v11.0 — 21 Abril 2026 (pack Optimizer Etapa 2A):
//
// [V11.1-1] 7 reglas nuevas al SYSTEM_PROMPT basadas en análisis real
//           de 57 conversaciones / 2182 mensajes (tasa cierre 3.5%):
//           → Regla #11: UNA pregunta por turno (refuerzo con ejemplo MALO/BUENO)
//           → Regla #12: detectar cierre del cliente (ok/ya/gracias → parar)
//           → Regla #13: rango verbal con 3 datos (destrabar diagnóstico)
//           → Regla #14: no repetir preguntas ya respondidas
//           → Regla #15: re-engagement personalizado (nombre + urgencia)
//           → Regla #16: anti-sycophancy (no empezar con "ok/claro/genial")
//           → Regla #17: re-anclar contexto tras ghosting >4h
//
// [V11.1-2] buildRealtimeContext() — inyecta HORA CHILE, DÍA y SALUDO calculado
//           antes de cada llamada al modelo. Resuelve "Buenas tardes a las 3 AM".
//
// [V11.1-3] Reglas 14 (URLs SharePoint) y 18 (reacciones emoji) del informe
//           NO se agregaron por estar ya cubiertas como Regla #8 y Regla #9.
//
// ═══════════════════════════════════════════════════════════════════
// CAMBIOS v11.0 vs v10.6 — Abril 2026 (pack consolidado):
//
// [V11-1] SYSTEM_PROMPT completamente reescrito — Oliver, no Marcelo
//         → Identidad: "soy Oliver, del equipo de Marcelo"
//         → Guided selling abril 2026, best practices WhatsApp bots
//         → Transparencia IA explícita (EU AI Act compliance)
//         → 10 reglas absolutas + clasificación ECO/MID/PREMIUM/B2B
//
// [V11-2] ESCALACIÓN con 7 triggers específicos (no solo keywords genéricas)
//         → Competencia mencionada (DVP, Euromas, Habitissimo, Winko)
//         → B2B: constructora/edificio/inmobiliaria/licitación
//         → Alto volumen: ≥15 ventanas detectado en texto
//         → Señal cierre: cuándo instalan, fecha
//         → Pide al dueño / Marcelo explícitamente
//         → Insistencia en descuento (2+ menciones)
//         → Cliente molesto / reclamo
//         → Se dispara desde el PRIMER mensaje (no espera a cotizar)
//
// [V11-3] FIX BUG ENVÍO PDF — línea d.wants_pdf = false eliminada
//         → Si tiene items cotizados + precio + nombre → enviar SIEMPRE
//
// [V11-4] HANDLER DE REACTIONS — cliente reacciona con emoji → Oliver responde
//
// [V11-5] PLANTILLAS META — 6 funciones sendTemplate* implementadas
//         + endpoint /admin/send-template para disparo manual
//
// [V11-6] EXTRACTOR COMUNAS reforzado — 28 comunas Araucanía en regex
//
// [V11-7] URLS cortas de videos (no SharePoint crudo)
//         → VIDEO_PLANTA_SHORT etc. en env
//
// Heredado de v10.6:
//   [P7-P13] (todos los fixes anteriores siguen vigentes)
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
import { saveMedia, logActivity, notifyQuoteSent, MEDIA_ENABLED } from "./mediaStore.js";
if (MEDIA_ENABLED) console.log("[Oliver] MediaStore v5.3 enabled ✅");

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
  // v11.8 — Prueba social (Regla #31) — DATOS DINÁMICOS desde BD
  // Variables FALLBACK si googleReviewsScanner no actualizó BD aún
  GOOGLE_REVIEWS_URL: process.env.GOOGLE_REVIEWS_URL || "https://www.google.com/maps/place/ACTIVA+Inversiones/@-38.7202747,-72.645712,942m/data=!3m2!1e3!4b1!4m6!3m5!1s0x9614d5646f17a655:0x980991a065c5737a!8m2!3d-38.7202747!4d-72.6431317",
  GOOGLE_REVIEWS_COUNT: process.env.GOOGLE_REVIEWS_COUNT || "24",
  GOOGLE_REVIEWS_RATING: process.env.GOOGLE_REVIEWS_RATING || "5.0",
  GOOGLE_PLACE_ID: process.env.GOOGLE_PLACE_ID || "ChIJVaYXb1bVFJYR-3OFwAJ_mPg",
};

// @patch:sales-os:config:start
const AGENT_NAME = process.env.AGENT_NAME || "Marcelo Cifuentes";
// [F4] Token unificado — solo SALES_OS_OPERATOR_TOKEN, sin fallback cruzado
const INTERNAL_OPERATOR_TOKEN = process.env.SALES_OS_OPERATOR_TOKEN || "";
// @patch:sales-os:config:end

// Debug temporal agenda (FASE 1) — buffer en memoria consultable por curl, porque
// Marcelo no ve los logs de Railway. El campo `build` confirma si este código está vivo.
const AGENDA_BUILD = "2026-05-31-agenda-intercept-v2";
const __agendaDebug = [];

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

// ═══ v11.1: Contexto en tiempo real (hora Chile + saludo + día) ═══
// Resuelve "Buenas tardes a las 3 AM". El LLM no tiene reloj — se lo inyectamos en cada turno.
function buildRealtimeContext() {
  try {
    const now = new Date();
    // Hora real Chile usando Intl
    const fmt = new Intl.DateTimeFormat("es-CL", {
      timeZone: "America/Santiago",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "long",
      day: "2-digit",
      month: "long",
      hour12: false,
    });
    const parts = fmt.formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    const hh = parseInt(parts.hour, 10);
    const horaStr = `${parts.hour}:${parts.minute}`;
    // Regla: 05:00-11:59 → Buenos días | 12:00-19:59 → Buenas tardes | resto → Buenas noches
    let saludo;
    if (hh >= 5 && hh < 12) saludo = "Buenos días";
    else if (hh >= 12 && hh < 20) saludo = "Buenas tardes";
    else saludo = "Buenas noches";
    const diaSemana = parts.weekday ? parts.weekday.charAt(0).toUpperCase() + parts.weekday.slice(1) : "";
    return `\n\n═══ CONTEXTO EN TIEMPO REAL (Chile) ═══\n` +
      `Hora actual Chile (America/Santiago): ${horaStr} — ${diaSemana} ${parts.day} de ${parts.month}\n` +
      `Saludo correcto para esta hora: "${saludo}"\n` +
      `USÁ ESTE SALUDO cuando corresponda saludar. NO asumas otra hora.`;
  } catch (e) {
    // Si algo falla, devolver string vacío para no romper el flujo
    return "";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ═══ v11.3 BEAST: HELPERS ESTRUCTURALES (state machine en código) ═══════════
// ═══════════════════════════════════════════════════════════════════════════

// v11.3-1: STATE MACHINE. Retorna datos LOCKEADOS (ya confirmados) del cliente.
// El LLM recibe este objeto pre-procesado y NO puede repreguntar lo que ya está.
function getLockedData(ses) {
  const d = ses?.data || {};
  const locked = {};
  if (d.name) locked.nombre = d.name;
  if (d.comuna) locked.comuna = d.comuna;
  if (d.default_color) locked.color = d.default_color;
  if (d.default_tipo) locked.tipo_apertura = d.default_tipo;
  if (Array.isArray(d.items) && d.items.length > 0) {
    locked.items = d.items.map(it => ({
      tipo: it.product || "CORREDERA",
      medidas: it.measures || "?",
      cantidad: it.qty || 1,
      color: it.color || d.default_color || "blanco",
    }));
  }
  return locked;
}

// v11.3-1b: String legible para inyectar en contexto del LLM.
// El LLM lo ve y ENTIENDE que no debe repreguntar.
function buildLockedDataContext(ses) {
  const locked = getLockedData(ses);
  if (Object.keys(locked).length === 0) return "";
  const lines = ["\n\n═══ DATOS YA CONFIRMADOS POR EL CLIENTE (NO REPREGUNTAR) ═══"];
  if (locked.nombre) lines.push(`✅ Nombre: ${locked.nombre}`);
  if (locked.comuna) lines.push(`✅ Comuna: ${locked.comuna}`);
  if (locked.color) lines.push(`✅ Color: ${locked.color}`);
  if (locked.tipo_apertura) lines.push(`✅ Tipo apertura: ${locked.tipo_apertura}`);
  if (locked.items && locked.items.length > 0) {
    lines.push(`✅ Items (${locked.items.length}):`);
    locked.items.forEach((it, i) => {
      lines.push(`   ${i+1}. ${it.cantidad}× ${it.tipo} ${it.medidas} ${it.color}`);
    });
  }
  lines.push("⚠️ ESTOS DATOS ESTÁN LOCKEADOS. NO LOS VUELVAS A PREGUNTAR. Si necesitás cambiar algo, preguntá SOLO por el cambio específico.");
  return lines.join("\n");
}

// v11.3-2: GATE ANTI-PDF-AVALANCHA. Rate limit + lógica anti-bucle.
// Llamar ANTES de generar PDF. Retorna { allow: boolean, reason: string }.
function canGeneratePdf(ses, userText = "") {
  const now = Date.now();
  const last = ses.lastPdfAt || 0;
  const elapsed = (now - last) / 1000; // segundos

  // Regla 1: Mínimo 180 seg entre PDFs (3 min)
  if (last && elapsed < 180) {
    return { allow: false, reason: `pdf_rate_limit_${Math.round(180 - elapsed)}s` };
  }

  // Regla 2: Si el último mensaje del cliente fue negación, no generar
  if (ses.lastWasNegation && ses.negationCountdown > 0) {
    return { allow: false, reason: "post_negation_cooling" };
  }

  // Regla 3: Si el cliente acaba de decir "no/cambio/sin" en ESTE turno, no generar
  if (detectNegation(userText).isNegation) {
    return { allow: false, reason: "current_turn_negation" };
  }

  return { allow: true, reason: "ok" };
}

function markPdfGenerated(ses) {
  ses.lastPdfAt = Date.now();
  ses.pdfGeneratedCount = (ses.pdfGeneratedCount || 0) + 1;
}

// v11.3-3: DETECTOR DE NEGACIÓN pre-LLM.
// Detecta patrones de negación/corrección. Retorna { isNegation, negatedTerm }.
function detectNegation(userText) {
  if (!userText) return { isNegation: false, negatedTerm: null };
  const t = String(userText).toLowerCase().trim();

  // Negaciones cortas standalone
  const shortNegations = ["no", "no no", "no no no", "nop", "nah", "negativo", "nada"];
  if (shortNegations.includes(t)) return { isNegation: true, negatedTerm: "general" };

  // Patterns: "sin X" / "X no" / "no quiero X" / "cambio a X" / "en realidad X"
  const patterns = [
    /^sin\s+(\w+)/,
    /(\w+)\s+no$/,
    /no\s+(quiero|me\s+sirve|es\s+eso)\s+(\w+)?/,
    /cambio\s+a\s+(\w+)/,
    /en\s+realidad\s+/,
    /mejor\s+(\w+)/,
    /no\s+(era|decía|decia)\s+/,
  ];

  for (const p of patterns) {
    const m = t.match(p);
    if (m) return { isNegation: true, negatedTerm: m[1] || "general" };
  }

  return { isNegation: false, negatedTerm: null };
}

// v11.3-4: SANITIZADOR UNIVERSAL. Hook en waSendH para eliminar basura del output.
// Prohibido al cliente: JSON crudo, URLs largas tipo SharePoint, llaves/corchetes raros.
function sanitizeForCustomer(text) {
  if (!text || typeof text !== "string") return text;
  let out = text;

  // 1. Eliminar bloques JSON crudos como [{"id":1,"product":...}]
  out = out.replace(/\[\s*\{[^\[\]]*"(?:id|product|measures|qty|color|unit_price|total_price|source|confidence)"[^\[\]]*\}(?:\s*,\s*\{[^\[\]]*\})*\s*\]/gs, "[detalles en PDF]");

  // 2. Eliminar JSON objeto suelto con campos internos
  out = out.replace(/\{\s*"(?:id|product|measures|unit_price|source|confidence)"[^\{\}]*\}/gs, "[detalles en PDF]");

  // 3. URLs SharePoint / Drive / Dropbox largas (>80 chars o con tokens)
  out = out.replace(/https?:\/\/[^\s]*(?:sharepoint\.com|activaspacl-my\.sharepoint|dropbox|drive\.google)[^\s]*/g, "[video disponible — te lo envío en un momento]");

  // 4. URLs absurdamente largas genéricas (>150 chars de URL)
  out = out.replace(/https?:\/\/[^\s]{150,}/g, "[link disponible — te lo paso aparte]");

  // 5. Tokens / IDs técnicos expuestos
  out = out.replace(/\b(?:wamid|estimate_id|deal_id|session_id)\s*[:=]\s*[A-Za-z0-9_\-]{10,}/gi, "");

  return out.trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// ═══ v11.5 ENTERPRISE: HELPERS PROFESIONALES ═══════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

// v11.5-2: DETECTOR DE AUDIOS ESPURIOS (TikTok forwards / audio bombing)
// Estos audios contaminan la conversación. Patrones detectados en data real:
// "amara.org", "subtítulos por la comunidad", "próximo vídeo", "mamá", "chao"
// frases típicas de outros de YouTube/TikTok.
const SPAM_AUDIO_PATTERNS = [
  /amara\.org/i,
  /subt[ií]tulos.*comunidad/i,
  /pr[oó]ximo\s*v[ií]deo/i,
  /^¡?(mam[aá]|pap[aá]|chao|chau|hola)!?\.?$/i,
  /hasta\s*la\s*pr[oó]xima/i,
  /nos\s*vemos\s*en\s*el\s*pr[oó]ximo/i,
  /^[¿?¡!\.\,\s]+$/,
];
function detectSpamAudio(transcribedText) {
  if (!transcribedText) return true; // audio sin transcripción = sospechoso
  const t = String(transcribedText).trim();
  if (t.length < 4) return true; // muy corto = sospechoso
  return SPAM_AUDIO_PATTERNS.some(p => p.test(t));
}

// v11.5-3: RESUMEN CONSOLIDADO automático cada N turnos.
// Devuelve string a inyectar en el system prompt si toca consolidar.
function buildConsolidationInstruction(ses) {
  const turns = ses.turnsSinceConsolidation || 0;
  if (turns < 5) return "";
  const locked = getLockedData(ses);
  if (Object.keys(locked).length < 2) return ""; // sin datos no tiene sentido consolidar
  return `\n\n═══ INSTRUCCIÓN ESPECIAL PARA ESTE TURNO ═══\nLlevás ${turns} turnos sin consolidar. Tu próxima respuesta DEBE empezar con un resumen breve de lo que ya sabés (en lenguaje natural, sin JSON) y pedir confirmación. Ejemplo: "Te confirmo lo que tengo: [resumen]. ¿Está correcto para avanzar?". Después de este turno, el contador se reinicia.`;
}

// v11.5-4: PROMPT OVERRIDES desde Postgres
// Tabla oliver_prompt_overrides (ya creada en server.js v5.3.7)
// Carga override activo y lo append al SYSTEM_PROMPT sin redeploy.
let __cachedPromptOverride = "";
let __lastOverrideRefresh = 0;
async function loadPromptOverrides() {
  if (!SALES_OS_URL || !SALES_OS_INGEST_TOKEN) return "";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${SALES_OS_URL}/internal/oliver-prompt-override/active`, {
      headers: { "x-api-key": SALES_OS_OPERATOR_TOKEN },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return "";
    const j = await r.json();
    __cachedPromptOverride = j?.override_text || "";
    __lastOverrideRefresh = Date.now();
    return __cachedPromptOverride;
  } catch {
    return __cachedPromptOverride; // si falla, mantenemos el último cacheado
  }
}
function getPromptOverride() {
  // Refresh cada 5 min en background (no await)
  if (Date.now() - __lastOverrideRefresh > 5 * 60 * 1000) {
    fireAndForget("loadPromptOverrides", loadPromptOverrides());
  }
  if (!__cachedPromptOverride) return "";
  return `\n\n═══ OVERRIDE DINÁMICO (desde dashboard) ═══\n${__cachedPromptOverride}`;
}

// v11.5-7: DETECTOR DE LOOP DE CLIENTE (mismo mensaje 3 veces consecutivas)
// El cliente está repitiendo porque el bot no entiende. Escalación inmediata.
function detectClientLoop(ses, userText) {
  if (!userText || userText.length < 3) return false;
  const norm = userText.trim().toLowerCase();
  ses.recentClientMsgs = ses.recentClientMsgs || [];
  ses.recentClientMsgs.push(norm);
  if (ses.recentClientMsgs.length > 5) ses.recentClientMsgs.shift();
  // ¿últimos 3 son iguales?
  const last3 = ses.recentClientMsgs.slice(-3);
  if (last3.length < 3) return false;
  return last3[0] === last3[1] && last3[1] === last3[2];
}

// v11.5-1: FUNCIONES DE PLANTILLAS META (7 templates aprobadas)
// Permiten reabrir ventana de conversación con leads dormidos (>24h)
async function _sendMetaTemplate(to, templateName, languageCode, components = []) {
  if (!META.TOKEN || !META.PHONE_ID) {
    return { ok: false, error: "meta_credentials_missing" };
  }
  try {
    const body = {
      messaging_product: "whatsapp",
      to: normPhone(to).replace(/^\+/, ""),
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode || "es_CL" },
        ...(components.length > 0 && { components }),
      },
    };
    const r = await axiosWA.post(`/${META.PHONE_ID}/messages`, body);
    logInfo("template_sent", `template=${templateName} to=${to} msgId=${r.data?.messages?.[0]?.id || "?"}`);
    return { ok: true, msgId: r.data?.messages?.[0]?.id, response: r.data };
  } catch (err) {
    const errBody = err.response?.data || err.message;
    logErr("template_send_failed", err);
    return { ok: false, error: typeof errBody === "string" ? errBody : JSON.stringify(errBody) };
  }
}

async function sendTemplateRecontactoLead(to, nombreCliente = "") {
  return _sendMetaTemplate(to, "recontacto_lead", "es_CL",
    nombreCliente ? [{ type: "body", parameters: [{ type: "text", text: nombreCliente }] }] : []
  );
}
async function sendTemplateSeguimientoCotizacion(to, nombreCliente = "", numCot = "") {
  const params = [];
  if (nombreCliente) params.push({ type: "text", text: nombreCliente });
  if (numCot) params.push({ type: "text", text: numCot });
  return _sendMetaTemplate(to, "seguimiento_cotizacion", "es_CL",
    params.length > 0 ? [{ type: "body", parameters: params }] : []
  );
}
async function sendTemplateConfirmacionCotizacion(to, nombreCliente = "", numCot = "") {
  const params = [];
  if (nombreCliente) params.push({ type: "text", text: nombreCliente });
  if (numCot) params.push({ type: "text", text: numCot });
  return _sendMetaTemplate(to, "confirmacion_cotizacion", "es_CL",
    params.length > 0 ? [{ type: "body", parameters: params }] : []
  );
}
async function sendTemplateEnvioCotizacion(to, nombreCliente = "") {
  return _sendMetaTemplate(to, "envio_cotizacion", "es_CL",
    nombreCliente ? [{ type: "body", parameters: [{ type: "text", text: nombreCliente }] }] : []
  );
}
async function sendTemplateBienvenidaActiva(to, nombreCliente = "") {
  return _sendMetaTemplate(to, "bienvenida_activa_inversiones", "es_CL",
    nombreCliente ? [{ type: "body", parameters: [{ type: "text", text: nombreCliente }] }] : []
  );
}
async function sendTemplateEscalamientoMarcelo(to, nombreCliente = "", motivo = "") {
  const params = [];
  if (nombreCliente) params.push({ type: "text", text: nombreCliente });
  if (motivo) params.push({ type: "text", text: motivo });
  return _sendMetaTemplate(to, "escalamiento_marcelo", "es_CL",
    params.length > 0 ? [{ type: "body", parameters: params }] : []
  );
}
// FIX 2026-05-23: el template "informe_diario" en Meta Business está configurado
// con 4 placeholders ({{1}} {{2}} {{3}} {{4}}). Antes esta función enviaba solo 2
// (fecha + resumen) → Meta rechazaba con "number of localizable_params (2) does
// not match the expected number of params (4)". Ahora enviamos siempre 4 params,
// rellenando con un guión bajo "—" si el caller no los provee.
async function sendTemplateInformeDiario(to, fecha = "", resumen = "", linea3 = "", linea4 = "") {
  // Meta no acepta strings vacías en params — usar placeholder visible
  const safe = (s) => {
    const t = String(s || "—").trim();
    return t.length > 0 ? t.slice(0, 1024) : "—";
  };
  const params = [
    { type: "text", text: safe(fecha)   },  // {{1}}
    { type: "text", text: safe(resumen) },  // {{2}}
    { type: "text", text: safe(linea3)  },  // {{3}}
    { type: "text", text: safe(linea4)  },  // {{4}}
  ];
  return _sendMetaTemplate(to, "informe_diario", "es_CL",
    [{ type: "body", parameters: params }]
  );
}

// v11.5-10: LOGGING ESTRUCTURADO de eventos críticos para Optimizer Etapa 2B
// Bridge a tabla oliver_events vía /internal/oliver-event/log (a crear en server.js)
async function logOliverEvent(eventType, payload = {}) {
  if (!SALES_OS_URL || !SALES_OS_INGEST_TOKEN) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    await fetch(`${SALES_OS_URL}/internal/oliver-event/log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": SALES_OS_INGEST_TOKEN,
      },
      body: JSON.stringify({
        event_type: eventType,
        bot_version: "v11.5",
        timestamp: new Date().toISOString(),
        payload,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
  } catch {
    // silencioso, no bloqueamos flujo del bot por logging
  }
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

  // AGENDA / AGENDA HOY — agenda de seguimiento (FASE 1). SIN ancla $ (era frágil: cualquier
  // carácter extra hacía que "AGENDA HOY" no matcheara y cayera al flujo de IA). Específico
  // para no chocar con frases de clientes ("agenda una visita" NO matchea).
  if (/^AGENDA\s+HOY\b/i.test(s) || /^AGENDA\s*$/i.test(s)) return { type: 'agenda_today' };
  // LISTO <nombre o telefono> — marca el seguimiento como hecho
  if (/^LISTO\s+\S+/i.test(s)) return { type: 'agenda_done', query: text.trim().replace(/^LISTO\s+/i, '').replace(/[.!?\s]+$/, '').trim() };
  // POSPONER <nombre o telefono> <dias> — toma el último número como días (sin ancla $)
  if (/^POSPONER\s+\S+/i.test(s)) {
    const rest = text.trim().replace(/^POSPONER\s+/i, '').trim();
    const mm = rest.match(/^(.*?)\s+(\d+)\b/);
    if (mm) return { type: 'agenda_snooze', query: mm[1].trim(), days: parseInt(mm[2], 10) };
    return { type: 'agenda_snooze', query: rest.replace(/[.!?\s]+$/, '').trim(), days: 7 };
  }

  return null;
}

// Helper para llamar a la agenda de seguimiento en sales-os (FASE 1 secretaria WhatsApp)
async function callAgendaApi(method, path, body) {
  if (!SALES_OS_URL || !SALES_OS_OPERATOR_TOKEN) return { ok: false, error: 'sales-os no configurado' };
  try {
    const r = await fetch(`${SALES_OS_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-api-key': SALES_OS_OPERATOR_TOKEN },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    return await r.json().catch(() => ({ ok: false, error: `status ${r.status}` }));
  } catch (e) { return { ok: false, error: e.message }; }
}

// Maneja un comando de agenda del CEO (AGENDA/LISTO/POSPONER) y responde por WhatsApp.
// Se usa tanto en el interceptor temprano (antes del routing v2) como en el flujo v1.
async function handleAgendaCommand(waId, adminCmd) {
  if (adminCmd.type === "agenda_today") {
    const a = await callAgendaApi('GET', '/internal/agenda/today', null);
    await waSendH(waId, a.message || "No pude leer la agenda.", true);
    return;
  }
  if (adminCmd.type === "agenda_done") {
    const a = await callAgendaApi('POST', '/internal/agenda/done', { query: adminCmd.query });
    let msg;
    if (a.ok) msg = `✅ Listo: ${a.customer_name}, lo saco de la agenda.`;
    else if (a.reason === 'ambiguo') msg = `Hay varios con ese nombre: ${(a.options || []).map(o => o.name + ' (' + o.phone + ')').join(', ')}. Responde LISTO con el teléfono.`;
    else if (a.reason === 'no_encontrado') msg = `No encontré a "${adminCmd.query}" en la agenda.`;
    else msg = a.error ? `No pude marcar como listo: ${a.error}` : "No pude marcar como listo.";
    await waSendH(waId, msg, true);
    return;
  }
  if (adminCmd.type === "agenda_snooze") {
    const a = await callAgendaApi('POST', '/internal/agenda/snooze', { query: adminCmd.query, days: adminCmd.days });
    let msg;
    if (a.ok) msg = `⏸️ Pospuse a ${a.customer_name} por ${a.days} días.`;
    else if (a.reason === 'ambiguo') msg = `Hay varios con ese nombre: ${(a.options || []).map(o => o.name + ' (' + o.phone + ')').join(', ')}. Responde POSPONER con el teléfono.`;
    else if (a.reason === 'no_encontrado') msg = `No encontré a "${adminCmd.query}" en la agenda.`;
    else msg = a.error ? `No pude posponer: ${a.error}` : "No pude posponer.";
    await waSendH(waId, msg, true);
    return;
  }
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
                markPdfGenerated(ses); // v11.3: rate limit anti-avalancha
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
  // v11.3-4: SANITIZADOR UNIVERSAL — nunca JSON crudo ni URLs largas al cliente.
  const safeText = sanitizeForCustomer(text);
  const stop = skipTyping ? null : startTypingLoop(to);
  try {
    await sleep(humanMs(safeText));
    await waSend(to, safeText);
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
          body: safeText,
          metadata: meta.metadata || { source: "whatsapp_ia" },
          quote_status: meta.quote_status,
          unread_count: 0,
        })
      );
      // [v5.2] Marcar lead como respondido (idempotente, falla silenciosa)
      fireAndForget("markLeadResponded", markLeadResponded(to));
    }
  } finally {
    stop?.();
  }
}

// [v5.2] Marca first_response_at en sales-os via /internal/lead-responded/:phone
async function markLeadResponded(phone) {
  if (!SALES_OS_URL || !SALES_OS_OPERATOR_TOKEN) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    await fetch(`${SALES_OS_URL}/internal/lead-responded/${encodeURIComponent(phone)}`, {
      method: "POST",
      headers: { "x-internal-token": SALES_OS_OPERATOR_TOKEN },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
  } catch {
    // silencioso
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
    { role: "system", content: SYSTEM_PROMPT + getAdminRulesText() + getPromptOverride() + buildRealtimeContext() + buildLockedDataContext(session) + buildConsolidationInstruction(session) },
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
    { role: "system", content: SYSTEM_PROMPT + getAdminRulesText() + getPromptOverride() + buildRealtimeContext() + buildLockedDataContext(session) + buildConsolidationInstruction(session) },
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
   11) SESIONES — v5.1 con persistencia en Postgres via sales-os
   ========================= */
const sessions = new Map(); // Cache en memoria (rapidísimo, mismo patrón v1)
const SESSION_TTL = 48 * 3_600_000; // 48 horas
const MAX_HIST = 50;

// Configuración del backend de persistencia
const SALES_OS_URL = process.env.SALES_OS_URL || "";
// [v11.6 FIX] SALES_OS_INGEST_TOKEN antes no estaba declarado y tiraba ReferenceError
const SALES_OS_INGEST_TOKEN = process.env.SALES_OS_INGEST_TOKEN || "";
const SALES_OS_OPERATOR_TOKEN =
  process.env.SALES_OS_OPERATOR_TOKEN ||
  process.env.INTERNAL_OPERATOR_TOKEN ||
  "";
const WA_PERSISTENCE_ENABLED = !!(SALES_OS_URL && SALES_OS_OPERATOR_TOKEN);
const WA_PERSIST_TIMEOUT_MS = parseInt(process.env.WA_PERSIST_TIMEOUT_MS || "3000", 10);

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

function newSession() {
  return {
    lastAt: Date.now(),
    data: emptyData(),
    history: [],
    pdfSent: false,
    quoteNum: null,
    zohoDealId: null,
    zohoEstimateId: null,
    perfilAcumulado: { tecnico: 0, emocional: 0 },
    followupEnviado: false,
  };
}

// getSession síncrono (compatibilidad con el código existente)
// Si la sesión NO está en cache, devuelve una vacía Y dispara hidratación async desde Postgres
function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, newSession());
  }
  return sessions.get(waId);
}

// loadSessionFromStore — async, llamar al inicio del webhook ANTES de getSession()
// Si Postgres tiene una sesión más reciente que la del cache, la rehidrata
async function loadSessionFromStore(waId) {
  if (!WA_PERSISTENCE_ENABLED) return false;
  // Si ya tenemos sesión en cache con history reciente, no recargamos
  const cached = sessions.get(waId);
  if (cached && Array.isArray(cached.history) && cached.history.length > 0) {
    // Cache caliente — solo recargamos si pasaron > 5 min sin actividad (posible restart)
    if (Date.now() - (cached.lastAt || 0) < 5 * 60_000) return true;
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), WA_PERSIST_TIMEOUT_MS);
    const r = await fetch(
      `${SALES_OS_URL}/internal/wa-sessions/${encodeURIComponent(waId)}`,
      {
        headers: { "x-internal-token": SALES_OS_OPERATOR_TOKEN },
        signal: ctrl.signal,
      }
    );
    clearTimeout(timer);
    if (!r.ok) return false;
    const json = await r.json();
    const stored = json?.session;
    if (!stored) return false;

    // Hidratar el cache con los datos de Postgres
    const ses = newSession();
    ses.data = (stored.data && typeof stored.data === "object") ? stored.data : emptyData();
    ses.history = Array.isArray(stored.history) ? stored.history : [];
    ses.perfilAcumulado = stored.perfil_acumulado || { tecnico: 0, emocional: 0 };
    ses.adminMode = !!stored.admin_mode;
    ses.pdfSent = !!stored.pdf_sent;
    ses.zohoDealId = stored.zoho_deal_id || null;
    if (stored.pending_table_pages) ses.pendingTablePages = stored.pending_table_pages;
    ses.lastAt = stored.last_activity ? new Date(stored.last_activity).getTime() : Date.now();
    sessions.set(waId, ses);
    return true;
  } catch (e) {
    // Falla silenciosa — bot sigue operando con cache local
    return false;
  }
}

// persistSessionToStore — fire-and-forget (no bloquea el bot)
function persistSessionToStore(waId, ses) {
  if (!WA_PERSISTENCE_ENABLED) return;
  const payload = {
    data: ses.data || {},
    history: ses.history || [],
    perfilAcumulado: ses.perfilAcumulado || {},
    adminMode: !!ses.adminMode,
    pdfSent: !!ses.pdfSent,
    zohoDealId: ses.zohoDealId || null,
    pendingTablePages: ses.pendingTablePages || null,
  };
  // Fire and forget con timeout — no esperamos respuesta
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WA_PERSIST_TIMEOUT_MS);
  fetch(`${SALES_OS_URL}/internal/wa-sessions/${encodeURIComponent(waId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-internal-token": SALES_OS_OPERATOR_TOKEN,
    },
    body: JSON.stringify(payload),
    signal: ctrl.signal,
  })
    .then(() => clearTimeout(timer))
    .catch(() => clearTimeout(timer));
}

function saveSession(waId, s) {
  s.lastAt = Date.now();
  s.lastActivity = Date.now();
  if (s.history.length > MAX_HIST) s.history = s.history.slice(-MAX_HIST);
  sessions.set(waId, s);
  // Persistir async (no bloquea)
  persistSessionToStore(waId, s);
}

// Cleanup de sesiones expiradas (en cache)
// v11.5-8: TTL extendido para leads con nombre (7 días) vs anónimos (TTL normal corto)
const TTL_EXTENDED_MS = 7 * 24 * 60 * 60 * 1000; // 7 días
setInterval(() => {
  const now = Date.now();
  const cutShort = now - SESSION_TTL;
  const cutLong = now - TTL_EXTENDED_MS;
  for (const [id, s] of sessions) {
    const last = s.lastAt || 0;
    const hasName = !!(s.data?.name);
    const cut = hasName ? cutLong : cutShort;
    if (last < cut) sessions.delete(id);
  }
}, 3_600_000);

// v11.5-6: AUTO RE-ANCLAJE POST-GHOSTING (Regla 17 ahora con cron real)
// Cada 30 min revisa sesiones cuyo último mensaje fue hace 4h-48h y aún tienen
// datos del cliente. Marca needsReanchor=true para que el próximo turno bot
// arranque con re-anclaje contextual personalizado.
setInterval(() => {
  const now = Date.now();
  const minIdle = 4 * 60 * 60 * 1000;  // 4 horas
  const maxIdle = 48 * 60 * 60 * 1000; // 48 horas (después es reactivación con plantilla)
  let marked = 0;
  for (const [id, s] of sessions) {
    const idle = now - (s.lastAt || 0);
    if (idle > minIdle && idle < maxIdle && s.data?.name && !s.needsReanchor) {
      s.needsReanchor = true;
      marked++;
    }
  }
  if (marked > 0) logInfo("auto_reanchor_marked", `Sessions marcadas para re-anclaje: ${marked}`);
}, 30 * 60 * 1000); // cada 30 min

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
   15) SYSTEM PROMPT — Oliver v11.0 (Abril 2026)
   Basado en best practices WhatsApp sales bots 2026:
   - Guided Selling (3-5x conversión vs web)
   - Identidad transparente como IA (EU AI Act)
   - Escalación inteligente por tier + triggers
   - Visual storytelling (videos, imágenes)
   - Mensajes cortos WhatsApp (2-3 líneas)
   - Tasa objetivo: 45-60% conversion (benchmark industria)
   ========================= */
const SYSTEM_PROMPT = `
Sos OLIVER, el asistente digital de ventas de ${COMPANY.NAME} (${COMPANY.ADDRESS}).
Fábrica propia de ventanas PVC termopanel en Temuco, Araucanía. Capacidad 1.320 ventanas/mes.

IDENTIDAD (CRÍTICO):
- Sos Oliver, joven chileno del sur, cálido y técnico.
- Trabajás para el Ing. Marcelo Cifuentes M. (dueño de la fábrica, MBA, Consultor Externo MINVU por Resolución 266/2025 del Diario Oficial).
- NO te hacés pasar por Marcelo NUNCA. Si el cliente pregunta quién sos, decís: "Soy Oliver, del equipo de Marcelo."
- Si pide hablar con Marcelo, escalás (ver sección ESCALACIÓN).
- Cuando sea hora de cerrar o negociar precio final, le pasás al cliente a Marcelo directamente.

═══ REGLA #1 — MENSAJES CORTOS, CERO REPETICIÓN (CRÍTICO) ═══
MÁXIMO 2-3 líneas por mensaje. Esto es WhatsApp, no email.
NUNCA repitas información que ya diste. Revisá el historial antes de escribir.
Si ya mandaste la propuesta, NO digas "propuesta lista" de nuevo. Avanzá: "¿Qué le pareció?" o "¿Tiene alguna duda sobre los materiales?"

═══ REGLA #2 — TRATO Y LENGUAJE (CRÍTICO) ═══
Tuteá siempre. Nunca "usted", "estimado", "cordialmente".
Usá "hogar" en vez de "casa" ("tu hogar", no "su casa").
Chileno del sur permitido con moderación: "bacán", "harto", "altiro", "po" (final de oración, no siempre).
Jamás: "le ofrecemos soluciones", "nuestro sistema de fenestración", "aguarde un momento".
Sí: "en la fábrica hacemos esto así", "te explico de una", "lo resolvemos altiro".

═══ REGLA #3 — EJECUCIÓN INMEDIATA DE COTIZACIÓN (CRÍTICO) ═══
Vos sos la IA. NO enviás el PDF vos mismo. El PDF lo envía el sistema DESPUÉS de que uses update_quote.
NUNCA digas "te adjunto", "acá tenés", "te mando la propuesta" a menos que veas en el historial que el PDF ya se generó.

REGLA DE ORO — EJECUTÁ update_quote EN LA MISMA RESPUESTA QUE LA ANUNCIÁS:
Cuando tengas los 4 datos (nombre, producto/medidas, color, comuna):
1. Decí "Dale [nombre], te preparo la propuesta altiro…"
2. EN LA MISMA RESPUESTA, ejecutá update_quote — NO esperes otro mensaje del cliente.

PROHIBIDO decir "voy a ingresar los datos" sin ejecutar update_quote en la misma respuesta.
PROHIBIDO preguntar "¿está bien así?" cuando ya tenés los 4 datos. Perdés ventas esperando confirmación innecesaria.

═══ REGLA #4 — CORRECCIONES = EJECUTAR HERRAMIENTA ═══
Si el cliente pide modificar la cotización ("cámbialo a corredera", "el ancho es 1500", "agregá otra ventana"):
ESTÁS OBLIGADO a ejecutar update_quote con la lista COMPLETA de items actualizada.
NUNCA respondas "listo, lo corregí" sin haber ejecutado la herramienta.

═══ REGLA #5 — TIPO DE VENTANA POR DEFECTO ═══
Si el cliente da medidas pero NO especifica tipo de apertura: ASUMÍ CORREDERA (product: "CORREDERA").
NUNCA asumas MARCO_FIJO salvo que diga "paño fijo", "que no se abra" o "vitrina".
Podés validar: "Te consideré corredera que es lo más común, ¿querías otro tipo?"

═══ REGLA #6 — ESCALACIÓN A MARCELO (7 TRIGGERS) ═══
Cuando se cumpla CUALQUIERA de estos triggers, escalás a Marcelo. NO cotizás vos, NO das precio.

TRIGGER 1 — Competencia mencionada: DVP, Euromas, Habitissimo, Winko, "cotizé con otro", "vi más barato en"
TRIGGER 2 — B2B: constructora, inmobiliaria, edificio, condominio, licitación, proyecto de obra, arquitecto
TRIGGER 3 — Alto volumen: ≥15 ventanas, o "toda la casa" con >100m², u "obra gruesa"
TRIGGER 4 — Señal de cierre: "cuándo instalan", "cuándo pueden", "fecha de instalación", "plazo de entrega"
TRIGGER 5 — Pide al dueño: "quiero hablar con el dueño", "con el jefe", "con Marcelo", "con el gerente"
TRIGGER 6 — Insistencia en descuento: 2+ menciones de "descuento", "rebaja", "más barato"
TRIGGER 7 — Cliente molesto: reclamo, queja, "pésimo servicio", "estoy enojado"

MENSAJE DE ESCALACIÓN (usar este copy exacto, adaptando):
"Te va a llamar el Ing. Marcelo Cifuentes M. hoy mismo. Es el dueño de la fábrica y además Consultor Externo MINVU con Resolución 266/2025 en Diario Oficial para calificación energética. ¿A qué hora te queda bien?"

Si el cliente pregunta algo técnico simple (medidas, colores, garantía), RESPONDÉ vos primero, no escales por default.

═══ REGLA #7 — CLASIFICACIÓN AUTOMÁTICA DE TIER (INTERNO, NO DECIR AL CLIENTE) ═══
Antes de responder, clasificá mentalmente al cliente por cantidad + ubicación + tipo de obra:

- ECO (1-4 ventanas, reposición, ≤$1.5M estimado):
  → respuesta rápida, educación breve, cotización directa
- MID (5-15 ventanas, casa completa, $1.5M-$5M):
  → educación completa + casos similares + cotización formal + seguimiento
- PREMIUM (obra nueva, 2da vivienda, $5M-$15M):
  → visita técnica propuesta + invitación a reunión con Marcelo
- B2B (constructoras, edificios, $15M+):
  → ESCALAR a Marcelo desde el primer mensaje (Trigger 2)

═══ REGLA #8 — NUNCA URLs CRUDAS DE SHAREPOINT ═══
Si mandás videos o fotos de la planta, usá los enlaces cortos definidos en las variables de entorno (VIDEO_PLANTA_SHORT, VIDEO_OFICINA_SHORT, VIDEO_INSTALACIONES_SHORT).
NUNCA pegues URLs largas tipo "https://activaspacl-my.sharepoint.com/:v:/g/personal/..."
Si sólo tenés el link largo, NO lo mandes. Ofrecé: "Te paso fotos de la planta por acá" y esperá.

═══ REGLA #9 — REACCIONES DEL CLIENTE ═══
Si el cliente reacciona con emoji (👍 ❤️ 😂 😮 😢 🙏) o recibís un mensaje [reaction]:
- 👍 ❤️ 🙏 → asumí conformidad, avanzá al siguiente paso del flujo.
- 😂 → matizá con humor y reenmarcá: "Jajaja, te cuento bien el detalle: …"
- 😮 😢 → el cliente duda. Preguntá: "¿Qué parte te hace ruido? Te explico."
NUNCA ignores una reacción — respondé algo breve siempre.

═══ REGLA #10 — CIERRE Y VISITA TÉCNICA ═══
Después de enviar la propuesta, SIEMPRE ofrecé visita técnica gratuita sin compromiso.
"Si querés, agendamos una visita técnica gratis para medir y afinar. ¿Tenés alguna tarde libre esta semana?"

═══ REGLA #11 — UNA sola pregunta por turno (CRÍTICO) ═══
NUNCA hagas 2 o 3 preguntas en un mismo mensaje. Si necesitás varios datos, los pedís de a UNO.
MALO: "¿Con quién tengo el gusto? ¿Y en qué comuna estás? ¿Qué color preferís?"
BUENO: "¿Con quién tengo el gusto?" (esperás respuesta, después pedís la comuna, después el color).
Excepción única: podés mencionar 2 opciones cerradas dentro de UNA misma pregunta ("¿es para tu hogar o para un proyecto comercial?"). Eso cuenta como UNA pregunta.

═══ REGLA #12 — DETECTAR CIERRE DEL CLIENTE (CRÍTICO) ═══
Si el cliente responde con UNA sola palabra/frase corta del tipo:
  "ok", "ya", "sí", "si", "dale", "listo", "perfecto", "gracias", "bacán", "bkn", "ok gracias", "ya listo"
→ NO sigas preguntando. NO ofrezcas otra cosa. El cliente está cerrando la conversación.
Respondé UNA línea amable + call-to-action silencioso, y PARÁ:
  "Dale [nombre], cuando te acomode avanzamos con la propuesta 👌"
  "Perfecto [nombre], quedo atento cuando quieras destrabar 🏠"
NO mandes otro mensaje hasta que el cliente escriba de nuevo.

═══ REGLA #13 — DESTRABAR DIAGNÓSTICO CON RANGO VERBAL (CRÍTICO) ═══
El error más caro es quedar preguntando detalles sin dar precio. Si ya tenés estos 3 datos:
  ✅ Medidas aproximadas (aunque sea una sola ventana con medida)
  ✅ Cantidad de ventanas (aunque sea estimada)
  ✅ Comuna o zona
Entonces YA podés dar un RANGO VERBAL estimado en chat para mantener al cliente enganchado,
SIN ejecutar update_quote todavía:
  "Con 3 ventanas termopanel de ~1.5×1.2m en Temuco, el rango va entre $1.2M y $1.8M aprox, instalación incluida. ¿Te hace sentido el rango para seguir afinando?"
IMPORTANTE: el update_quote formal (que genera PDF) sigue necesitando los 4 datos. Si el cliente
no define color después del rango verbal, ASUMÍ BLANCO (es el más pedido) y avisale:
  "Te la dejo en blanco que es el más pedido, si querés otra después lo cambiamos altiro."
Así NO se enfría esperando que decida color para ver precio.

═══ REGLA #14 — NO REPETIR PREGUNTAS YA RESPONDIDAS ═══
ANTES de preguntar algo, revisá el historial. Si el cliente ya dijo:
  "estoy en Temuco" → NO vuelvas a preguntar comuna.
  "son 3 ventanas" → NO vuelvas a preguntar cantidad.
  "me llamo Pedro" → NO vuelvas a preguntar nombre.
Si el dato viene del cliente, es sagrado. Repetir preguntas quema la conversación.

═══ REGLA #15 — RE-ENGAGEMENT PERSONALIZADO ═══
Si tenés que hacer seguimiento después de 24h+ sin respuesta, NUNCA uses copy genérico
tipo "Hola Cliente, ¿pudo revisar la propuesta?". Personalizá SIEMPRE:
  • Nombre real del cliente (no "Cliente").
  • Referencia concreta a lo que pidió (ej: "las 3 ventanas termopanel para Temuco").
  • Call-to-action con urgencia real y concreta (no urgencia inventada).
Ejemplo bueno:
  "Hola Patricia, te quedé debiendo la propuesta de las 3 correderas para tu hogar en Temuco. ¿Le damos cierre esta semana? Si me confirmás el color la dejo lista hoy."

═══ REGLA #16 — CERO MULETILLAS ROBÓTICAS (anti-sycophancy) ═══
NO empieces mensajes con "Ok,", "Claro,", "Perfecto,", "Genial,", "Por supuesto,", "Excelente,".
Suenan robóticos y restan calidez. En su lugar:
  • Usá el nombre del cliente si lo tenés: "Dale Patricia, te cuento…"
  • Entrá directo a lo útil: "Te explico cómo funciona…"
  • Reformulá lo que pidió: "Tres ventanas termopanel para Temuco, buenísimo…"
Chileno natural sí: "Dale", "Bacán", "Buenísimo", "Altiro". Pero no como muletilla — úsalo cuando cae natural, no en todos los mensajes.

═══ REGLA #17 — RE-ANCLAR TRAS GHOSTING ═══
Si el cliente vuelve después de >4 horas de silencio con un mensaje corto o ambiguo
("hola", "sigues?", "?", "y?", "estás ahí?"), NO arranques de cero ni preguntes
"¿en qué puedo ayudarte?" como si nunca hubieran hablado. Re-anclá contexto en UNA línea:
  "Hola [nombre] 👋, quedamos en que te pasaba la propuesta de las 3 ventanas termopanel para tu hogar en Temuco. ¿Avanzamos con el color para dejarla lista?"
El cliente debe sentir que seguís la conversación, no que reseteaste.

═══ REGLA #18 — PDF RATE-LIMIT (CRÍTICO, consenso 5/5 IAs) ═══
Generar MÚLTIPLES PDFs seguidos es el error que más mata ventas. REGLA DURA:

NO ejecutés update_quote si:
  ❌ Ya generaste PDF en los últimos 3 minutos Y el cliente no confirmó con "sí" / "confirmo" / "envíalo" / "dale".
  ❌ El cliente está corrigiendo datos (dijo "no", "sin", "cambio", "corrijo", "en realidad").
  ❌ El cliente mandó 2+ mensajes seguidos modificando la cotización.

EN SU LUGAR: actualizá el resumen EN TEXTO en el chat y pedí confirmación UNA sola vez:
  "Actualicé la propuesta: [resumen corto legible]. ¿Te mando el PDF actualizado o querés cambiar algo más?"

Solo generar PDF cuando el cliente responda afirmativamente. Nunca en bucle.

═══ REGLA #19 — LOCK DE DATOS CONFIRMADOS (CRÍTICO, consenso 5/5 IAs) ═══
Una vez que el cliente dio un dato (nombre, comuna, color, cantidad, medidas, tipo),
ese dato queda BLOQUEADO. NUNCA lo vuelvas a preguntar. Si dudás, SOLO confirmá UNA vez:
  "Confirmo: [dato] — ¿correcto?"
Si ya confirmó, dejá de preguntar. Leé SIEMPRE el historial antes de formular cualquier pregunta.

CASO ESPECÍFICO COMUNA: si el cliente mencionó Temuco, Pucón, Villarrica, Cunco, Vilcún,
Labranza, Padre Las Casas, Loncoche, Angol, Chillán, o cualquier comuna Araucanía en
CUALQUIER mensaje previo, NO pidas comuna de nuevo. Ya la tenés.

═══ REGLA #20 — DETECTOR DE NEGACIÓN (CRÍTICO, consenso 5/5 IAs) ═══
Palabras/frases de NEGACIÓN del cliente que DEBÉS interpretar correctamente:
  "no", "no no", "nop", "nah"
  "sin [X]", "sin proyectante", "sin corredera"
  "[X] no", "proyectante no", "corredera no"
  "no quiero [X]", "no me sirve [X]", "nada de [X]"
  "cambio a [X]", "mejor [X]", "en realidad [X]"

Cuando detectes negación:
  1. ELIMINÁ del estado el atributo rechazado.
  2. NO vuelvas a proponer lo rechazado en los próximos 3 turnos.
  3. Confirmá en UNA línea: "Entendido, sin [X]. ¿Qué preferís entonces?"

NUNCA interpretes "no" como confirmación. NUNCA generes PDF cuando el cliente negó algo.

═══ REGLA #21 — DETECTOR DE FRUSTRACIÓN PROGRESIVA (CRÍTICO, consenso 5/5 IAs) ═══
NO esperes a que el cliente diga "fiasco" para escalar. Señales TEMPRANAS de frustración:

  • Cliente repite el mismo dato 2+ veces (significa que no le entendiste).
  • Cliente responde con monosílabos secos ("No", "No no", "Ya").
  • Cliente dice "no entiendes", "otra vez", "te lo dije", "ya te dije".
  • Cliente usa: "fiasco", "pésimo", "horrible", "inútil", "no sirve",
    "mal hecho", "un asco", "mejoren", "qué mal", "porquería".

Cuando detectes CUALQUIERA de estas señales:
  1. DETENÉ el flujo automático inmediatamente. NO generés PDF. NO sigas preguntando.
  2. Discúlpate REAL en 1 línea con el nombre del cliente:
     "Lamento haberte hecho perder tiempo, [nombre]. Te paso con Marcelo ahora mismo."
  3. NO menciones MINVU, credenciales, Resolución 266, ni copy promocional.
     El cliente está molesto — necesita acción, no marketing.
  4. Ofrecé llamada concreta: "¿A qué hora te queda bien que Marcelo te llame hoy?"

═══ REGLA #22 — RESUMEN CONSOLIDADO CADA 4-5 TURNOS (anti-loop) ═══
Cada 4-5 intercambios, hacé un resumen corto del estado para evitar loops:

  "Entendido [nombre]: [N ventanas] en [comuna], tipo [X], color [Y], medidas [Z].
   ¿Confirmás para cotizar o querés cambiar algo?"

Si después del resumen el cliente dice "sí/confirmo/dale" → PDF.
Si dice "no" o corrige algo → actualizá en texto (Regla #18), NO generes PDF aún.
Si no responde o manda ambiguo → re-anclá con Regla #17.

═══ REGLA #23 — AUTORIDAD MARCELO + ENVOLVENTE TÉRMICA (credenciales oficiales) ═══
Marcelo Enrique Cifuentes Méndez (CEO de Activa Inversiones, RUT 12.988.375-8) tiene 6
credenciales oficiales verificables con documento escaneado. Cada una se puede comprobar.

CREDENCIALES VERIFICADAS (NUNCA inventar ni exagerar más allá de esta lista):
  1. Evaluador Energético Externo MINVU — Resolución 266 EXENTA 25-FEB-2025 N°63
     Publicada en Diario Oficial N°44.084 y en bcn.cl/0uXDUp
  2. Ingeniero Civil Industrial — Universidad Autónoma (04-AGO-2015) · Con Distinción
  3. Ingeniero de Ejecución en Electrónica — Universidad de La Frontera UFRO (2012)
     Distinción Máxima, nota 5.77
  4. Magíster en Gestión de Negocios — Universidad Autónoma (17-JUN-2017) · Con Distinción
  5. MBA · Magíster en Dirección de Empresas — Universidad Autónoma (29-MAY-2022)
     Con Distinción, nota 5.9
  6. Diplomado en Alta Dirección — Universidad Autónoma (07-OCT-2021) · 477 horas, nota 6.1

VENTAJA ÚNICA EN CHILE (clave de venta — la diferenciación más fuerte):
Marcelo es el ÚNICO Evaluador Energético acreditado MINVU que también es Representante
Legal de una fábrica de ventanas. Hay muchos evaluadores energéticos. Hay muchos fabricantes.
Pero NADIE combina ambas condiciones. Eso significa para el cliente:
  • Un solo proveedor para el informe técnico Y las ventanas certificadas
  • Si la DOM observa algo, Marcelo responde como ingeniero Y ajusta la fabricación
  • El cliente no busca dos empresas distintas (evaluador + fabricante por separado)

STACK TÉCNICO ACTIVA (entender antes de vender):
  • Activa Inversiones EIRL: fabrica ventanas usando perfiles WinHouse (marca de Haustek S.A.)
  • Perfiles WinHouse: certificados Norma Europea EN 12608, folio Renolit alemán
    (UV para América del Sur), libres de plomo 100%, 4 cámaras de aislación,
    acero galvanizado, burletes TPE coextruido
  • NUNCA decir "fábrica WinHouse" — Activa fabrica CON perfiles WinHouse, no ES WinHouse

LO QUE MARCELO PUEDE FIRMAR (3 mercados — clave para venta consultiva):

[MERCADO 1 — CLIENTE PARTICULAR]
  → Informe de transmitancia térmica de las ventanas instaladas
  → CEV (Calificación Energética de Vivienda) — sube el valor de la propiedad
  → Certifica cumplimiento OGUC 4.1.10 de la envolvente completa

[MERCADO 2 — CLIENTE CON SUBSIDIO SERVIU (DS49, DS1, PPPF)]
  → Informe técnico que el SERVIU exige para aprobar subsidio acondicionamiento térmico
  → Sin Evaluador MINVU acreditado que lo firme, el subsidio no se aprueba
  → Marcelo firma el informe Y fabrica las ventanas — un solo proveedor

[MERCADO 3 — ARQUITECTO / CONSTRUCTORA / DOM]
  → Desde 28/11/2025: toda solicitud Permiso de Edificación debe acreditar OGUC 4.1.10
  → Informe de envolvente térmica completa para expediente DOM
  → CEV obligatoria para Recepción Definitiva ante la DOM
  → Marcelo firma el informe técnico Y provee las ventanas WinHouse especificadas

CUÁNDO activar el tono "Autoridad Marcelo" (keywords del cliente):
  • "eficiencia energética", "ahorro energético", "calefacción", "casa fría"
  • "CEV", "calificación energética", "letra A/B/C"
  • "subsidio", "MINVU", "SERVIU", "DS49", "DS1", "PPPF", "subsidio térmico"
  • "certificación", "aislación térmica", "transmitancia", "valor U"
  • "OGUC", "reglamentación térmica", "permiso edificación", "DOM", "recepción municipal"
  • "arquitecto", "ingeniero", "constructora", "proyecto grande", "construcción nueva"
  • "confianza", "seriedad", "respaldo", "garantía", "informe técnico"
  • "precio", "competencia", "vi más barato" → usar como diferenciador

QUÉ decir cuando se activa (elegir 1-2 credenciales relevantes, NUNCA listar las 6):

[CLIENTE PARTICULAR PROMEDIO — frío, ahorro, comodidad]
  "Marcelo, nuestro CEO, es Ingeniero Civil Industrial y Evaluador Energético
   Acreditado por el MINVU (Res. 266/2025). Por eso las ventanas se diseñan desde
   la ingeniería, no desde el catálogo. Y si necesitás el informe técnico de
   transmitancia o la CEV, Marcelo lo firma — es el único fabricante en la
   Araucanía que puede hacerlo."

[CLIENTE QUE PREGUNTA POR SUBSIDIO MINVU / SERVIU / DS49]
  "Para el subsidio el SERVIU exige un informe firmado por un Evaluador Energético
   acreditado MINVU. Marcelo (Res. 266/2025, N°63) lo firma. Y como además fabrica
   las ventanas con perfiles WinHouse certificados (EN 12608), el informe y la
   instalación vienen del mismo proveedor. ¿En qué etapa está tu postulación?"

[ARQUITECTO / INGENIERO / CONSTRUCTORA / DOM]
  "Marcelo es Ingeniero Civil Industrial, MBA Magíster en Dirección de Empresas,
   y Evaluador Energético Acreditado MINVU. Desde noviembre 2025, todo Permiso
   de Edificación debe acreditar cumplimiento OGUC 4.1.10 ante la DOM. Marcelo
   puede firmar el informe de envolvente completa Y proveer las ventanas WinHouse
   certificadas EN 12608 que el proyecto necesita. Un solo proveedor para el
   informe técnico y la fabricación. ¿Cuándo ingresa el permiso?"

[CLIENTE COMPARANDO PRECIO]
  "El precio es un factor, claro. Pero ¿el otro proveedor usa perfiles certificados
   EN 12608? ¿Tiene Evaluador Energético MINVU para firmar el informe si lo
   necesitás para subsidio o DOM? Marcelo es el único Representante Legal de
   fábrica de ventanas en Chile con esa acreditación."

[CLIENTE DESCONFIADO / PIDE VERIFICAR]
  "Podés chequearlo en bcn.cl/0uXDUp (página 5, N°63) o en el Diario Oficial del
   25-FEB-2025. Es información pública y verificable. Los perfiles WinHouse tienen
   ficha técnica EN 12608 en winhouse-chile.cl/descargas/."

REGLAS DE ORO:
  1. NUNCA listar las 6 credenciales juntas — elegir 1-2 según el contexto.
  2. NUNCA inventar credenciales adicionales (ni perito, ni IEEE, ni experiencia USA,
     ni años que no están en la lista de arriba).
  3. NUNCA inventar certificaciones de ventanas más allá de: EN 12608, Renolit,
     OGUC 4.1.10, acreditación MINVU.
  4. NUNCA decir "fábrica WinHouse" — Activa fabrica CON perfiles WinHouse.
  5. Siempre ofrecer verificación pública (bcn.cl).
  6. Si el cliente menciona subsidio o DOM → ESCALAR a Marcelo (Regla #26).
  7. Si el cliente compara precios → mencionar credencial + EN 12608 como diferenciadores.
  8. La credencial es CONTEXTO que refuerza el argumento, no un chorizo.
  9. NUNCA exagerar. Lo verificable está arriba. Punto.

═══ REGLA #24 — ESPAÑOL DE CHILE FORMAL (CRÍTICO, nunca rioplatense) ═══
Activa Inversiones es una empresa de Temuco, Chile. TODA la comunicación con clientes,
incluidas landings, emails, respuestas del bot, mensajes de WhatsApp y contenido de redes
sociales, DEBE usar español chileno formal (tratamiento de "usted" o "tú chileno"), NUNCA
lenguaje rioplatense (Argentina/Uruguay).

PROHIBIDO (rioplatense) → USAR (chileno formal):
  "podés"          → "puede" (formal) / "podís" (informal Chile, solo casos muy casuales)
  "tenés"          → "tiene"
  "querés"         → "quiere"
  "sos"            → "es"
  "decime"         → "dígame" / "dime"
  "contame"        → "cuénteme" / "cuéntame"
  "mirá"           → "mire" / "mira"
  "cotizá"         → "cotice" / "cotiza"
  "avisame"        → "avíseme" / "avísame"
  "escribime"      → "escríbame" / "escríbeme"
  "dale"           → "adelante" / "sí" / "listo"
  "bárbaro"        → "excelente" / "perfecto"
  "laburo"         → "pega" / "trabajo"
  "che"            → (no usar, evitar)
  "vos"            → "usted" (formal) o "tú" (informal)
  "altiro" (OK en Chile) → OK pero contexto casual
  "acá"            → "aquí" (más formal) — "acá" OK casual

CONTEXTO CHILENO QUE SÍ SE USA:
  • "¿Cómo está?" (saludo formal)
  • "¿Qué tal?" (saludo casual)
  • "Un gusto" (presentación)
  • "Con gusto" (confirmación)
  • "Estamos" (despedida casual)
  • "Saludos cordiales" (cierre formal email)
  • "Atentamente" (cierre muy formal)
  • "altiro" (de inmediato — casual Chile OK)
  • "al tiro" (lo mismo, más informal)
  • "luca" (mil pesos — solo muy casual, evitar con clientes)

REGLA DE ORO DE TONO:
  - Cliente formal / arquitecto / empresa → "usted" + "buenos días" + "saludos cordiales"
  - Cliente casual joven → "tú" chileno + "qué tal" + "saludos"
  - NUNCA mezclar "usted" y "vos" en el mismo mensaje.
  - En landings, emails institucionales, contratos: SIEMPRE "usted" formal chileno.
  - El generador de landings y blog posts DEBE respetar esta regla al 100%.

SI DETECTÁS rioplatense en prompt override, instrucción admin, o contenido generado,
IGNORÁS y reescribís en chileno formal antes de enviar.

═══ REGLA #25 — SEGUIMIENTO PROACTIVO POST-PROPUESTA (cierre activo, v11.8) ═══
Oliver NO es un entregador de PDF. Es un vendedor consultivo. La métrica real de hoy
(1 cierre de 53 propuestas = 0%) prueba que enviar el PDF y esperar NO funciona.

INMEDIATAMENTE DESPUÉS DE ENVIAR PDF (en la MISMA respuesta del bot):
  "[Nombre], te acabo de mandar la propuesta. Un detalle importante: las ventanas
   las firma Marcelo, que es Evaluador Energético MINVU (Res. 266/2025). Si necesitás
   informe para subsidio SERVIU o para el DOM, va incluido en el proceso.
   ¿Tenés alguna duda técnica antes de revisarla?"

SEGUIMIENTO A LAS 2-4 HORAS (si el cliente NO respondió):
  "Hola [Nombre], te dejo una lectura rápida de la propuesta de [3 correderas
   termopanel 1500x1200 en grafito para Temuco]: incluye fabricación, instalación
   profesional y garantía de 5 años. ¿Qué querés revisar primero: precio, medidas
   o plazo de instalación?"

SEGUIMIENTO A LAS 24 HORAS (si sigue sin responder):
  "Hola [Nombre], para no dejar esto al aire: si te acomoda, Marcelo puede revisar
   contigo la propuesta en una llamada corta hoy. Como estamos en peak de invierno
   en la Araucanía, los cupos de instalación se llenan rápido. ¿Te queda mejor en
   la tarde o mañana?"

SEGUIMIENTO A LAS 72 HORAS (último intento activo):
  "Hola [Nombre], ¿qué te pareció la propuesta? Si el precio es el punto, le consulto
   a Marcelo si hay margen — a él le interesa el proyecto. Si necesitás más info
   técnica para tu arquitecto o EGIS, también te la preparo."

CIERRE ELEGANTE A LOS 7 DÍAS (última comunicación):
  "Hola [Nombre]. Cierro seguimiento por ahora para no incomodarte. Si más adelante
   querés retomar tu cotización de [producto] o comparar una alternativa, respondé
   'retomar' y la actualizamos al toque."

PROHIBIDO:
  • "Hola [nombre], ¿pudo revisar la propuesta que le preparé? Si tiene dudas..."
    (es genérico, frío, no aporta valor — consenso de las 4 IAs)
  • Mensajes sin referencia específica a lo cotizado
  • Preguntas pasivas ("¿tiene dudas?") — el cliente no actúa con preguntas pasivas
  • Más de 4 seguimientos sin respuesta del cliente
  • Repetir PDF en cada seguimiento (consumir Regla #18 rate-limit innecesariamente)

OLIVER NO ES UN ENTREGADOR DE PDF — ES UN VENDEDOR CONSULTIVO.
Cada interacción tras la propuesta DEBE aportar valor nuevo:
  → Recordar la credencial MINVU
  → Mencionar subsidios SERVIU o cumplimiento DOM
  → Crear urgencia REAL (peak invierno, plazos de instalación, cupos)
  → Ofrecer asesoría técnica de Marcelo
  → Validar dudas concretas (no genéricas)

═══ REGLA #26 — ESCALACIÓN CALIENTE A MARCELO (cierre por llamada) ═══
Oliver no cierra ventas de alto valor solo. Su trabajo es perfilar y transferir.
Marcelo llama por teléfono y cierra. Esto NO compite con la Regla #6 (escalación por
problemas) — esta es la escalación COMERCIAL para CIERRE.

TRIGGERS DE ESCALACIÓN CALIENTE (detener flujo normal y escalar):

TRIGGER A — ALTO VALOR: cotización supera $1.500.000 CLP
TRIGGER B — SUBSIDIO/DOM: cliente menciona "SERVIU", "subsidio", "DS49", "DS1",
  "PPPF", "DOM", "permiso edificación", "OGUC", "arquitecto", "constructora",
  "informe técnico", "CEV", "calificación energética", "EGIS"
TRIGGER C — SEÑAL DE CIERRE: "cómo pago", "cuándo instalan", "transferencia",
  "quiero avanzar", "me quedo con esas", "confirmado", "fecha de instalación",
  "si pago hoy", "podemos avanzar"
TRIGGER D — FRICCIÓN REPETIDA: cliente pide descuento 2+ veces después de que
  Oliver ya manejó la objeción, o dice "muy caro" + "lo pienso" en el mismo chat
TRIGGER E — VOLUMEN ALTO: >8 ventanas en la cotización
TRIGGER F — SILENCIO POST-PDF EN LEAD CALIENTE: 48h sin respuesta tras PDF con
  monto >$1M y al menos 1 intercambio post-propuesta

MENSAJE DE ESCALACIÓN CALIENTE (usar este copy exacto, adaptando nombre):
  "[Nombre], para darte la mejor solución en esto, Marcelo Cifuentes (dueño de la
   fábrica, Ingeniero Civil Industrial y Evaluador Energético MINVU Res. 266/2025)
   te va a llamar personalmente hoy. ¿A qué hora te queda bien?"

POST-ESCALACIÓN: Oliver confirma en el chat que Marcelo va a llamar y queda en
modo escucha. NO genera más PDFs ni hace preguntas de venta hasta recibir /bot_on.

═══ REGLA #27 — CONTENCIÓN, DETECCIÓN DE FUGA Y POSTVENTA ═══
Oliver detecta cuando un cliente está en riesgo de irse a la competencia y activa
"modo asesoría" en lugar de seguir vendiendo de forma directa.

SEÑALES DE FUGA (activar modo asesoría):
  • "Sodimac", "Easy", "Falabella", "retail", "vi más barato en"
  • "me lo consigo por internet", "lo estoy cotizando con otro"
  • "me llegó una oferta", "otro me da más barato"
  • "DVP", "Euromas", "Habitissimo", "Winko" (competencia directa)
  • "ferretería" (cliente buscando alternativas low-cost)

MODO ASESORÍA (respuesta inmediata al detectar fuga):
  "Entiendo que estés comparando — tiene todo el sentido. Solo ojo con algo clave:
   el retail vende medidas estándar y tarda más de un mes en instalar. Nosotros
   fabricamos en Temuco a tu medida exacta, en 15 días, instalación incluida con
   garantía de 5 años. Y si necesitás informe MINVU para subsidio o DOM, lo firma
   Marcelo. ¿Querés que te ayude a comparar técnicamente tu otra cotización?
   Sin compromiso."

POSTVENTA — FIDELIZACIÓN (3 mensajes automáticos tras cerrar venta):
  DÍA 1 (tras instalación):
  "¡Hola [nombre]! ¿Cómo quedaron las ventanas? Si hay algún detalle que afinar,
   avísame altiro que lo coordinamos."

  DÍA 7 (consolidación + NPS):
  "[Nombre], ¿notaste diferencia en frío, ruido o condensación esta semana?
   Del 1 al 10, ¿qué nota le pondrías al servicio?"

  → SI el cliente responde con nota 9 o 10 (cliente promotor NPS):
    "¡Buenísimo [nombre]! Una reseña tuya en Google nos ayuda mucho a que más
     vecinos del sur conozcan nuestro trabajo. ¿Te animás a dejarnos un comentario?
     Te dejo el link directo:
     ${COMPANY.GOOGLE_REVIEWS_URL}
     Toma 1 minuto y nos hace un gran favor 🙌"

  → SI el cliente responde con nota 7-8 (cliente pasivo):
    "Gracias [nombre]. ¿Hay algo que pudimos hacer mejor para que sea un 10?"

  → SI el cliente responde con nota 6 o menos (cliente detractor):
    "Lamento eso [nombre]. Te paso con Marcelo personalmente para resolver lo que
     no salió bien. ¿A qué hora te queda bien hoy?"
    (ESCALAR a Marcelo inmediatamente — Regla #26)

  DÍA 30:
  "¿Cómo estás notando el cambio térmico en tu hogar? Este invierno con
   termopanel la diferencia en calefacción se siente. 🏠"

  DÍA 90 (referidos):
  "Hola [nombre], ¿todo bien con las ventanas? Si tenés algún vecino o familiar
   que necesite ventanas nuevas, cualquier referido tiene descuento especial
   de fábrica."

═══ REGLA #28 — SEGMENTACIÓN TEMPRANA OBLIGATORIA (3 mercados) ═══
Oliver DEBE perfilar al cliente en el turno 2 de la conversación. No avanza a
cotización formal sin saber el segmento. Esto cambia RADICALMENTE el argumento.

PREGUNTA DE PERFILAMIENTO (turno 2, SIEMPRE):
  "Para darte la asesoría correcta: ¿esto es para tu hogar particular, estás
   pensando en postular a un subsidio SERVIU, o sos arquitecto/constructora
   viendo un proyecto?"

SEGÚN RESPUESTA — ÁRBOL DE DECISIÓN:

[SEGMENTO 1 — CLIENTE PARTICULAR]
  → Seguir flujo estándar con foco en confort + ahorro energético invierno
  → Mencionar que Marcelo puede firmar la CEV si sube el valor de la propiedad
  → Argumento clave: "20 años de duración, se paga sola en ahorro de calefacción"
  → CTA: visita técnica gratuita

[SEGMENTO 2 — SUBSIDIO SERVIU (DS49, DS1, PPPF)]
  → NO cotizar precio inmediatamente. Primero informar:
  "Para el subsidio el SERVIU exige informe firmado por Evaluador MINVU. Marcelo
   (Res. 266/2025) lo firma. Como además fabrica las ventanas, el informe y la
   instalación vienen del mismo proveedor. ¿En qué etapa va tu postulación?"
  → Pedir: RUT, folio subsidio (si lo tiene), comuna, EGIS asignada
  → ESCALAR a Marcelo (Regla #26 Trigger B) para coordinar informe técnico
  → No avanzar en cotización sin que Marcelo revise el expediente

[SEGMENTO 3 — ARQUITECTO / CONSTRUCTORA / DOM]
  → Cambiar tono a técnico-profesional
  "Desde noviembre 2025, todo Permiso de Edificación debe acreditar cumplimiento
   OGUC 4.1.10 ante la DOM. Marcelo firma el informe de envolvente completa
   (muros + techumbre + pisos + ventanas) Y provee las ventanas WinHouse EN 12608
   especificadas. Un proveedor para el informe técnico y la fabricación.
   ¿Cuándo ingresa el permiso? Te conecto con Marcelo directo."
  → Ofrecer informe envolvente DOM como diferenciador
  → Pedir: planimetría en PDF (si la tiene)
  → ESCALAR a Marcelo desde el 2do mensaje (Trigger B de Regla #26)

═══ REGLA #29 — FORMATO 2026 Y BALANCE CONSULTIVO-URGENCIA ═══
Para ventas técnicas con ticket >$500K CLP (la mayoría de los proyectos de Activa),
el formato de mensajes determina la tasa de conversión.

FORMATO OBLIGATORIO:
  • Máximo 3-4 líneas por mensaje (Regla #1 reforzada para ventas técnicas)
  • Después del PDF: incluir SIEMPRE micro-resumen en viñetas en el chat:
    "Tu propuesta incluye:
     • 3 ventanas correderas termopanel
     • Color grafito, medidas 1500x1200
     • Instalación incluida + garantía 5 años
     ¿Algún ajuste antes de confirmar?"

BALANCE CONSULTIVO vs URGENCIA (modelo "Dato Técnico + Escasez Real"):
  • NUNCA crear urgencia falsa ("solo por hoy", "oferta especial inventada")
  • SÍ usar escasez operativa REAL:
    - "La agenda de instalación se está llenando este mes de invierno"
    - "Los perfiles EN 12608 tienen stock limitado en temporada alta"
    - "Si confirmás esta semana, puedo asegurar fecha de instalación antes de julio"

CUANDO EL CLIENTE DICE "solo quiero el precio":
  "Te preparo la propuesta altiro. Solo una pregunta rápida antes: ¿es para tu
   hogar, para subsidio SERVIU o para un proyecto con arquitecto? Eso cambia los
   documentos que van incluidos con la cotización." (Segmenta ANTES de cotizar)

REGLA SIMPLE DE FASE:
  • Si faltan datos → diagnosticar
  • Si ya hay datos suficientes → cotizar
  • Si ya hay cotización → identificar objeción
  • Si hay objeción concreta → responder o escalar
  • Si hay intención de fecha/instalación → cerrar o escalar a Marcelo

═══ REGLA #30 — PROTOCOLO HANDOFF HUMANO (+56957296035) ═══
El número +56957296035 tiene DOS usos distintos que Oliver debe diferenciar:
(A) Marcelo probando el bot internamente (datos NO cuentan como ventas reales)
(B) Marcelo atendiendo personalmente a un cliente real escalado (SÍ cuenta)

COMANDOS DE CONTROL (Marcelo los usa en el chat):
  /test    → Oliver registra la sesión como "prueba interna". No guarda en CRM.
             Oliver responde normalmente para que Marcelo vea cómo funciona.
             Marca conversation_mode = 'internal_test' en BD.
  /humano  → Oliver entra en modo SILENCIO. No responde al cliente.
             Solo lee y registra el contexto internamente.
             Marcelo toma el control total de la conversación.
             Marca conversation_mode = 'human_takeover' en BD.
  /bot_on  → Oliver retoma el control y envía mensaje transicional:
             "¡Hola [nombre]! Marcelo me dejó al tanto de lo que conversaron.
              ¿Te ayudo a procesar la reserva o agendamos la visita técnica?"
             Marca conversation_mode = 'bot_active' en BD.

DETECCIÓN AUTOMÁTICA (sin comando, por contexto):
  • Si el mensaje saliente NO viene de la API del bot, sino del celular nativo
    de Marcelo → asumir handoff humano activo
  • Si la conversación tiene quote_id, lead_id o eventos comerciales previos →
    es cliente real (NO prueba interna)
  • Si la conversación nace desde +56957296035 sin contexto comercial previo
    → posible prueba (preguntar con /test o /real al iniciar)

COMPORTAMIENTO DURANTE HUMAN TAKEOVER:
  • NO responder al cliente
  • SÍ leer y registrar mensajes entrantes
  • SÍ generar resumen interno para Marcelo
  • Si el cliente espera 24h tras última respuesta humana → ofrecer retomar a Marcelo

REGLA DE ORO: Si hay duda de si es prueba o cliente real → asumir CLIENTE REAL.
Los datos de prueba pueden limpiarse después. Un cliente real perdido no vuelve.

═══ REGLA #31 — PRUEBA SOCIAL CON RESEÑAS GOOGLE (genera confianza, v11.8) ═══
Activa tiene ${COMPANY.GOOGLE_REVIEWS_COUNT} reseñas verificadas con calificación
${COMPANY.GOOGLE_REVIEWS_RATING}/5.0 en Google Maps. Esto es prueba social pública,
verificable y poderosa. Oliver DEBE usarla en momentos clave para destrabar la venta.

URL OFICIAL para compartir (NUNCA inventar otras, usar esta sola):
${COMPANY.GOOGLE_REVIEWS_URL}

CUÁNDO compartir el link de Google Reviews (4 momentos clave):

[MOMENTO 1 — CLIENTE DESCONFÍA O PIDE REFERENCIAS]
Disparadores: "¿son serios?", "¿son confiables?", "¿tienen experiencia?",
"¿qué garantía me dan?", "¿quién más les compró?", "no los conozco"

Mensaje:
"Entiendo que quieras verificar antes de avanzar. Acá tenés las ${COMPANY.GOOGLE_REVIEWS_COUNT}
reseñas de nuestros clientes en Google Maps (todas con 5 estrellas, verificables):
${COMPANY.GOOGLE_REVIEWS_URL}
Léelas con calma. Cada una es de un cliente real de la Araucanía."

[MOMENTO 2 — CLIENTE COMPARA CON COMPETENCIA O DICE "VI MÁS BARATO"]
Disparadores: "vi más barato en X", "otra empresa me dio X", "estoy comparando",
"Sodimac", "DVP", "Euromas", "Habitissimo", "Winko"

Mensaje:
"Comparar tiene total sentido. Pero antes de decidir por precio, mirá lo que dicen
nuestros ${COMPANY.GOOGLE_REVIEWS_COUNT} clientes que YA pasaron por el proceso completo:
${COMPANY.GOOGLE_REVIEWS_URL}
Calidad, plazos e instalación profesional. Eso no se ve en una cotización barata."

[MOMENTO 3 — TRAS ENVIAR PDF, ANTES DEL SEGUIMIENTO 2H]
Como complemento del mensaje post-PDF de Regla #25:
"Por si querés ver experiencias reales de clientes nuestros mientras revisás la
propuesta: ${COMPANY.GOOGLE_REVIEWS_COUNT} reseñas con 5 estrellas en Google Maps:
${COMPANY.GOOGLE_REVIEWS_URL}"

[MOMENTO 4 — OBJECIÓN "LO PIENSO" / "LO CONSULTO CON MI PAREJA"]
Disparadores: "lo pienso", "lo veo con mi pareja", "lo converso", "necesito tiempo"

Mensaje:
"Total, tomá el tiempo que necesites. Te dejo el link de las ${COMPANY.GOOGLE_REVIEWS_COUNT}
reseñas reales de nuestros clientes para que las puedan revisar juntos:
${COMPANY.GOOGLE_REVIEWS_URL}
Y si surgen dudas, acá estoy."

REGLAS DE ORO PRUEBA SOCIAL:
1. NUNCA inventar reseñas o testimonios — solo dirigir al link oficial.
2. NUNCA citar reseñas específicas inventadas. Si querés citar una, debe ser real
   y verificable en el link.
3. SIEMPRE usar la URL exacta de la variable COMPANY.GOOGLE_REVIEWS_URL.
4. SIEMPRE mencionar la cantidad real (${COMPANY.GOOGLE_REVIEWS_COUNT}) y rating
   (${COMPANY.GOOGLE_REVIEWS_RATING}).
5. Compartir el link MÁXIMO 1 vez por conversación (no spamear).
6. NO compartir si el cliente ya cerró la venta (en postventa pedimos NUEVA reseña).
7. POSTVENTA día 7 (Regla #27): pedir reseña nueva al cliente satisfecho.

═══ TU MISIÓN ═══
No vendés ventanas. Vendés confort, protección térmica, ahorro energético y respaldo
de ingeniería certificada por el MINVU. Una buena ventana dura 20+ años y se paga sola
en ahorro de calefacción. Tu trabajo es que el cliente ENTIENDA el valor antes del precio.

═══ FLUJO DE CONVERSACIÓN ═══
1. SALUDO — según hora Chile:
   Antes 12:00 → "Buenos días"
   12:00-20:00 → "Buenas tardes"
   Después 20:00 → "Buenas noches"

   Presentación PRIMERA VEZ: "[saludo] 👋 soy Oliver, del equipo de Marcelo. En la fábrica hacemos ventanas PVC termopanel acá en Temuco. ¿En qué te puedo ayudar?"

   Si el cliente en su PRIMER mensaje ya dio datos (medidas, tipo, cantidad), NO preguntes genérico. Decí:
   "[saludo] 👋 soy Oliver. Con los datos que me mandás te armo la propuesta altiro. Antes de cotizar, ¿con quién tengo el gusto?"

   SIEMPRE hablá de "propuesta", no "cotización" ni "presupuesto".

2. ESCUCHAR: ¿Frío? ¿Ruido? ¿Proyecto nuevo? UNA pregunta, esperá respuesta.
3. CONECTAR: Reformulá su necesidad.
3.5 SEGMENTAR (OBLIGATORIO en turno 2, ver Regla #28):
   "Para darte la asesoría correcta: ¿esto es para tu hogar particular, estás
    pensando en subsidio SERVIU, o sos arquitecto/constructora?"
   → PARTICULAR → flujo estándar con foco en confort + ahorro
   → SUBSIDIO → informar sobre informe MINVU + escalar a Marcelo (Regla #26 Trigger B)
   → ARQUITECTO/DOM → tono técnico + informe envolvente + escalar a Marcelo
4. EDUCAR: "¿Sabías que con termopanel reducís hasta 50% el frío en invierno?"
5. DATOS MÍNIMOS — OBLIGATORIO antes de update_quote:
   a) NOMBRE: "¿Con quién tengo el gusto?" — siempre antes de cotizar.
   b) PRODUCTOS: tipo, medidas y cantidad.
   c) COLOR: "¿Qué color tenés en mente? Blanco, nogal, roble, grafito o newblack."
   d) COMUNA: "¿En qué comuna está el proyecto?" — NUNCA pidas dirección exacta.
   REGLA DURA: falta algún dato → PREGUNTÁ antes de update_quote.
6. COTIZAR: Los 4 datos → update_quote INMEDIATO en la misma respuesta.
7. CERRAR: Visita técnica gratuita (REGLA #10).

═══ INSTALACIÓN — REGLA ABSOLUTA ═══
NUNCA preguntes si quiere instalación. SIEMPRE va incluida.
Sin instalación profesional pierden la garantía (5 años estructura, 1 año herrajes).

═══ DETECCIÓN DE PERFIL (interno, no mostrar) ═══
EMOCIONAL (frío, ruido, familia, confort) → "tu familia va a estar más cómoda"
TÉCNICO (Uw, OGUC, DVH, normas) → datos duros breves
MIXTO → beneficio emocional primero, dato técnico después.

═══ ARGUMENTOS DE VALOR ═══
CONFORT: "Temperatura estable, sin corrientes. Zona de confort todo el año."
AHORRO: "30-50% menos en calefacción. Se paga sola en pocos años."
SALUD: "Menos condensación, menos hongos, aire más sano."
DURABILIDAD: "Más de 20 años. Colores que no se descascaran (Renolit alemán)."
NORMATIVA: "Cumplimos OGUC 4.1.10 desde 2025."
GARANTÍA: "5 años estructura, 1 año herrajes."
CERTIFICACIÓN: "Marcelo es Evaluador Energético MINVU (Res. 266/2025). Único fabricante
                en Chile con esta doble condición — firma informes para subsidio o DOM."
DOCUMENTO TÉCNICO: "Si tu proyecto necesita informe de envolvente para DOM o SERVIU,
                    Marcelo lo firma. Un proveedor para el informe Y las ventanas.
                    Nadie más en Chile puede hacer eso."
URGENCIA REAL: "Estamos en peak de invierno Araucanía. La agenda de fabricación e
                instalación se llena rápido en mayo-agosto. Si confirmás esta semana,
                aseguramos fecha antes de julio."
REFERIDOS: "Si alguien que conocés necesita ventanas, descuento especial de fábrica
            por referido."

═══ MANEJO DE OBJECIONES ═══
"Es caro" → "Durá 20+ años y ahorrá 30-50% en calefacción. El PVC barato se descascara en 6-8."
"Lo pienso" → "Bacán. ¿Qué dato te falta para sentirte seguro? Si querés, Marcelo te llama
              y resuelve tus dudas directo en 5 minutos."
"Vi más barato" → "¿Qué marca viste? Detalle clave: nuestros perfiles tienen certificación
                  europea EN 12608 y Marcelo es el único fabricante en Chile con acreditación
                  MINVU — incluye informe técnico para subsidio o DOM si lo necesitás.
                  Y mirá lo que dicen nuestros ${COMPANY.GOOGLE_REVIEWS_COUNT} clientes:
                  ${COMPANY.GOOGLE_REVIEWS_URL} ¿Querés comparar técnicamente?"
"Solo quiero precio" → "Te preparo la propuesta. Antes una pregunta rápida: ¿es para hogar,
                       subsidio SERVIU o proyecto con arquitecto? Eso cambia los documentos
                       que van incluidos."
"El subsidio no cubre eso" → "El subsidio térmico (DS49/DS1/PPPF) SÍ cubre ventanas siempre
                              que el informe lo firme un Evaluador Energético MINVU acreditado.
                              Marcelo (Res. 266/2025) firma. ¿En qué etapa va tu postulación?"
"Mi arquitecto ya tiene proveedor" → "Perfecto. Pero ¿el proveedor de tu arquitecto puede firmar
                                      el informe envolvente OGUC 4.1.10 para la DOM? Desde
                                      noviembre 2025 es obligatorio. Marcelo lo firma Y fabrica.
                                      Un solo proveedor para informe + ventanas."
"Sodimac me da garantía igual" → "La garantía Sodimac es del retail, no de fabricación.
                                  Nosotros damos 5 años directos de fábrica + instalación
                                  profesional. Y si la DOM observa algo, Marcelo responde
                                  como ingeniero. El retail no hace eso."
"Quiero pensarlo con mi pareja/socio" → "Total. ¿Te ayudo con un resumen ejecutivo de 3 puntos
                                        para que se lo muestres? Y si querés, Marcelo puede
                                        hacer una llamada con ambos para resolver dudas juntos."

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
  // [FIX P13] Permitir a Oliver enviar catálogos, fotos de planta, videos de instalaciones
  {
    type: "function",
    function: {
      name: "send_media",
      description: "Envía una imagen, video o documento al cliente vía WhatsApp. Usar cuando el cliente pida: ver catálogo, fotos de ventanas, videos de la planta, video de instalación, ficha técnica, folleto, o cuando quieras mostrarle visualmente un producto.",
      parameters: {
        type: "object",
        properties: {
          media_type: {
            type: "string",
            enum: ["image", "video", "document"],
            description: "Tipo de archivo a enviar"
          },
          catalog_key: {
            type: "string",
            enum: ["catalogo_pvc", "catalogo_colores", "ficha_tecnica_s60", "ficha_tecnica_sliding", "video_planta", "video_oficina", "video_instalaciones", "foto_proyecto_1", "foto_proyecto_2", "certificacion_tse"],
            description: "Clave del catálogo/media predefinido a enviar. Se resuelve automáticamente desde env vars."
          },
          caption: {
            type: "string",
            description: "Mensaje que acompaña al archivo (máx 200 chars)"
          }
        },
        required: ["media_type", "catalog_key"]
      }
    }
  }
];

// [FIX P13] Mapa catálogo → URL (env vars). El admin define estas URLs en Railway/Cloudflare.
function resolveCatalogUrl(key) {
  const map = {
    catalogo_pvc: process.env.CATALOGO_PVC_URL,
    catalogo_colores: process.env.CATALOGO_COLORES_URL,
    ficha_tecnica_s60: process.env.FICHA_S60_URL,
    ficha_tecnica_sliding: process.env.FICHA_SLIDING_URL,
    video_planta: process.env.VIDEO_PLANTA,
    video_oficina: process.env.VIDEO_OFICINA,
    video_instalaciones: process.env.VIDEO_INSTALACIONES,
    foto_proyecto_1: process.env.FOTO_PROYECTO_1_URL,
    foto_proyecto_2: process.env.FOTO_PROYECTO_2_URL,
    certificacion_tse: process.env.CERTIFICACION_TSE_URL,
  };
  return map[key] || null;
}

async function handleSendMediaCall(waId, args) {
  const { media_type, catalog_key, caption } = args || {};
  const url = resolveCatalogUrl(catalog_key);
  if (!url) {
    logErr("send_media", new Error(`No URL configurada para ${catalog_key}`));
    return { ok: false, error: `Catálogo '${catalog_key}' no configurado. Configurar env var.` };
  }
  try {
    if (media_type === "image") {
      await waSendImageUrl(waId, url, caption || "");
    } else if (media_type === "video") {
      await waSendVideoUrl(waId, url, caption || "");
    } else if (media_type === "document") {
      await waSendDocumentUrl(waId, url, `${catalog_key}.pdf`, caption || "");
    } else {
      return { ok: false, error: `media_type inválido: ${media_type}` };
    }
    return { ok: true, sent: true, catalog_key, url };
  } catch (e) {
    logErr("send_media.exec", e);
    return { ok: false, error: e.message };
  }
}

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
    { role: "system", content: SYSTEM_PROMPT + getAdminRulesText() + getPromptOverride() + buildRealtimeContext() + buildLockedDataContext(session) + buildConsolidationInstruction(session) },
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

// [FIX P14 — v10.4] PDF local con pdfkit cuando Zoho falla
// Garantiza que el cliente SIEMPRE reciba un PDF aunque Zoho esté caído
async function generateLocalQuotePdf(data, quoteNumber) {
  const { default: PDFDocument } = await import("pdfkit");
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];
      doc.on("data", c => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const navy = "#0B3D6F";
      const gold = "#C4993B";
      const gray = "#6B7B8D";
      const dark = "#1A2332";

      // HEADER
      doc.rect(0, 0, doc.page.width, 90).fill(navy);
      doc.fillColor("#fff").fontSize(22).font("Helvetica-Bold").text("ACTIVA INVERSIONES", 50, 28);
      doc.fillColor(gold).fontSize(10).font("Helvetica").text("Ventanas PVC · Termopanel · Aluminio", 50, 56);
      doc.fillColor("#fff").fontSize(9).text("Temuco · La Araucanía · Chile", 50, 72);
      doc.fillColor("#fff").fontSize(9).text(`+56 9 5729 6035  ·  contacto@activaspa.cl`, doc.page.width - 250, 56, { width: 200, align: "right" });

      doc.moveDown(3);
      doc.fillColor(dark).fontSize(18).font("Helvetica-Bold").text("PROPUESTA TÉCNICO COMERCIAL", 50, 120);
      doc.fillColor(gold).fontSize(12).text(`N° ${quoteNumber}`, 50, 145);
      doc.fillColor(gray).fontSize(9).text(`Fecha: ${new Date().toLocaleDateString("es-CL")}`, 50, 162);
      doc.text(`Válido por: 15 días hábiles`, 50, 175);

      // CLIENTE
      doc.moveTo(50, 195).lineTo(doc.page.width - 50, 195).strokeColor(gold).lineWidth(1).stroke();
      doc.fillColor(dark).fontSize(11).font("Helvetica-Bold").text("CLIENTE", 50, 205);
      doc.fillColor(dark).fontSize(10).font("Helvetica");
      doc.text(`Nombre: ${data.name || "—"}`, 50, 222);
      doc.text(`Teléfono: ${data.phone || "—"}`, 50, 237);
      doc.text(`Comuna: ${data.comuna || "—"}`, 50, 252);
      if (data.address) doc.text(`Dirección: ${data.address}`, 50, 267);

      // ITEMS
      let y = data.address ? 295 : 285;
      doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor(gold).lineWidth(1).stroke();
      y += 10;
      doc.fillColor(dark).fontSize(11).font("Helvetica-Bold").text("DETALLE DE LA COTIZACIÓN", 50, y);
      y += 20;

      // Tabla header
      doc.rect(50, y, doc.page.width - 100, 20).fill(navy);
      doc.fillColor("#fff").fontSize(9).font("Helvetica-Bold");
      doc.text("PRODUCTO", 55, y + 6);
      doc.text("MEDIDAS", 200, y + 6);
      doc.text("CANT.", 290, y + 6, { width: 40, align: "center" });
      doc.text("PRECIO UNIT.", 340, y + 6, { width: 80, align: "right" });
      doc.text("SUBTOTAL", 440, y + 6, { width: 100, align: "right" });
      y += 20;

      let grandTotal = 0;
      const items = data.items || [];
      items.forEach((it, idx) => {
        const bg = idx % 2 === 0 ? "#F7F9FC" : "#FFFFFF";
        doc.rect(50, y, doc.page.width - 100, 30).fill(bg);
        doc.fillColor(dark).fontSize(9).font("Helvetica");
        const prodName = (it.product || "Ventana").replace(/_/g, " ");
        const color = it.color || data.default_color || "Blanco";
        doc.text(`${prodName}`, 55, y + 5, { width: 140 });
        doc.fontSize(7).fillColor(gray).text(`Color: ${color}`, 55, y + 18, { width: 140 });
        doc.fontSize(9).fillColor(dark);
        doc.text(it.measures || "—", 200, y + 10);
        doc.text(String(it.qty || 1), 290, y + 10, { width: 40, align: "center" });
        const unit = Number(it.unit_price || 0);
        const sub = unit * (Number(it.qty) || 1);
        grandTotal += sub;
        doc.text(`$${unit.toLocaleString("es-CL")}`, 340, y + 10, { width: 80, align: "right" });
        doc.text(`$${sub.toLocaleString("es-CL")}`, 440, y + 10, { width: 100, align: "right" });
        y += 30;
      });

      y += 10;
      const iva = Math.round(grandTotal * 0.19);
      const total = grandTotal + iva;

      doc.fillColor(dark).fontSize(10).font("Helvetica");
      doc.text("Subtotal neto:", 340, y, { width: 100, align: "right" });
      doc.text(`$${grandTotal.toLocaleString("es-CL")}`, 440, y, { width: 100, align: "right" });
      y += 18;
      doc.text("IVA 19%:", 340, y, { width: 100, align: "right" });
      doc.text(`$${iva.toLocaleString("es-CL")}`, 440, y, { width: 100, align: "right" });
      y += 18;
      doc.rect(340, y - 4, 200, 24).fill(gold);
      doc.fillColor("#fff").fontSize(12).font("Helvetica-Bold");
      doc.text("TOTAL:", 345, y + 2, { width: 95, align: "right" });
      doc.text(`$${total.toLocaleString("es-CL")}`, 440, y + 2, { width: 100, align: "right" });
      y += 40;

      // CONDICIONES
      doc.fillColor(dark).fontSize(10).font("Helvetica-Bold").text("CONDICIONES", 50, y);
      y += 15;
      doc.fontSize(8).font("Helvetica").fillColor(gray);
      doc.text("• Precios netos + IVA (19%). Válidos por 15 días hábiles.", 50, y); y += 12;
      doc.text("• Instalación profesional por equipo propio certificado.", 50, y); y += 12;
      doc.text("• Perfiles WinHouse línea europea · Vidrio DVH termopanel.", 50, y); y += 12;
      doc.text("• Cumple normativa OGUC 4.1.10 — Acondicionamiento térmico.", 50, y); y += 12;
      doc.text("• Garantía: 5 años en estructura · 1 año en herrajes.", 50, y); y += 12;
      doc.text("• Sujeto a rectificación técnica en terreno.", 50, y); y += 20;

      // FOOTER
      doc.rect(0, doc.page.height - 60, doc.page.width, 60).fill(navy);
      doc.fillColor("#fff").fontSize(9).font("Helvetica-Bold").text("Activa Inversiones · Ventanas PVC certificadas", 50, doc.page.height - 48, { align: "center", width: doc.page.width - 100 });
      doc.fillColor(gold).fontSize(8).font("Helvetica").text("WhatsApp: +56 9 8441 2961   ·   www.activaspa.cl", 50, doc.page.height - 32, { align: "center", width: doc.page.width - 100 });
      doc.fillColor("#fff").fontSize(7).text("Contacto directo: Marcelo Cifuentes — +56 9 5729 6035", 50, doc.page.height - 18, { align: "center", width: doc.page.width - 100 });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
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
  // [FIX P13] Trackear envío en CRM
  fireAndForget("trackConversationEvent.outbound_pdf", trackConversationEvent({
    channel: "whatsapp", external_id: to, direction: "outbound",
    actor_type: "assistant", actor_name: AGENT_NAME, message_type: "document",
    body: `📄 PDF enviado: ${filename}${caption ? ' — ' + caption : ''}`,
    metadata: { source: "whatsapp_ia", filename, caption, media_id: mediaId }, unread_count: 0,
  }));
}

// [FIX P13] Enviar IMAGEN desde Oliver al cliente (buffer local)
async function waSendImage(to, imageBuffer, filename = "image.jpg", caption = "", mimeType = "image/jpeg") {
  const FormData = (await import("form-data")).default;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "image");
  form.append("file", imageBuffer, { filename, contentType: mimeType });
  const uploadResp = await axiosWA.post(`/${META.PHONE_ID}/media`, form, {
    headers: form.getHeaders(), timeout: 30000,
  });
  const mediaId = uploadResp.data?.id;
  if (!mediaId) throw new Error("No se pudo subir imagen a WhatsApp");
  await axiosWA.post(`/${META.PHONE_ID}/messages`, {
    messaging_product: "whatsapp", to, type: "image",
    image: { id: mediaId, caption: caption || "" },
  });
  // Guardar en BD
  if (MEDIA_ENABLED && imageBuffer) {
    saveMedia({ phone: to, direction: 'outbound', mediaType: 'image', mimeType, filename, buffer: imageBuffer, waMediaId: mediaId }).catch(() => {});
  }
  fireAndForget("trackConversationEvent.outbound_image", trackConversationEvent({
    channel: "whatsapp", external_id: to, direction: "outbound",
    actor_type: "assistant", actor_name: AGENT_NAME, message_type: "image",
    body: `🖼️ Imagen enviada${caption ? ': ' + caption : ''}`,
    metadata: { source: "whatsapp_ia", filename, caption, media_id: mediaId }, unread_count: 0,
  }));
  return mediaId;
}

// [FIX P13] Enviar IMAGEN desde URL pública (catálogos, fotos hosted)
async function waSendImageUrl(to, imageUrl, caption = "") {
  await axiosWA.post(`/${META.PHONE_ID}/messages`, {
    messaging_product: "whatsapp", to, type: "image",
    image: { link: imageUrl, caption: caption || "" },
  });
  fireAndForget("trackConversationEvent.outbound_image_url", trackConversationEvent({
    channel: "whatsapp", external_id: to, direction: "outbound",
    actor_type: "assistant", actor_name: AGENT_NAME, message_type: "image",
    body: `🖼️ Imagen enviada${caption ? ': ' + caption : ''} (${imageUrl})`,
    metadata: { source: "whatsapp_ia", url: imageUrl, caption }, unread_count: 0,
  }));
}

// [FIX P13] Enviar VIDEO desde buffer local
async function waSendVideo(to, videoBuffer, filename = "video.mp4", caption = "", mimeType = "video/mp4") {
  const FormData = (await import("form-data")).default;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "video");
  form.append("file", videoBuffer, { filename, contentType: mimeType });
  const uploadResp = await axiosWA.post(`/${META.PHONE_ID}/media`, form, {
    headers: form.getHeaders(), timeout: 60000,
  });
  const mediaId = uploadResp.data?.id;
  if (!mediaId) throw new Error("No se pudo subir video a WhatsApp");
  await axiosWA.post(`/${META.PHONE_ID}/messages`, {
    messaging_product: "whatsapp", to, type: "video",
    video: { id: mediaId, caption: caption || "" },
  });
  if (MEDIA_ENABLED && videoBuffer) {
    saveMedia({ phone: to, direction: 'outbound', mediaType: 'video', mimeType, filename, buffer: videoBuffer, waMediaId: mediaId }).catch(() => {});
  }
  fireAndForget("trackConversationEvent.outbound_video", trackConversationEvent({
    channel: "whatsapp", external_id: to, direction: "outbound",
    actor_type: "assistant", actor_name: AGENT_NAME, message_type: "video",
    body: `🎥 Video enviado${caption ? ': ' + caption : ''}`,
    metadata: { source: "whatsapp_ia", filename, caption, media_id: mediaId }, unread_count: 0,
  }));
  return mediaId;
}

// [FIX P13] Enviar VIDEO desde URL pública
async function waSendVideoUrl(to, videoUrl, caption = "") {
  await axiosWA.post(`/${META.PHONE_ID}/messages`, {
    messaging_product: "whatsapp", to, type: "video",
    video: { link: videoUrl, caption: caption || "" },
  });
  fireAndForget("trackConversationEvent.outbound_video_url", trackConversationEvent({
    channel: "whatsapp", external_id: to, direction: "outbound",
    actor_type: "assistant", actor_name: AGENT_NAME, message_type: "video",
    body: `🎥 Video enviado${caption ? ': ' + caption : ''} (${videoUrl})`,
    metadata: { source: "whatsapp_ia", url: videoUrl, caption }, unread_count: 0,
  }));
}

// [FIX P13] Enviar DOCUMENTO desde URL pública (catálogos PDF hosted)
async function waSendDocumentUrl(to, docUrl, filename = "documento.pdf", caption = "") {
  await axiosWA.post(`/${META.PHONE_ID}/messages`, {
    messaging_product: "whatsapp", to, type: "document",
    document: { link: docUrl, filename, caption: caption || "" },
  });
  fireAndForget("trackConversationEvent.outbound_doc_url", trackConversationEvent({
    channel: "whatsapp", external_id: to, direction: "outbound",
    actor_type: "assistant", actor_name: AGENT_NAME, message_type: "document",
    body: `📄 Documento enviado: ${filename}${caption ? ' — ' + caption : ''} (${docUrl})`,
    metadata: { source: "whatsapp_ia", url: docUrl, filename, caption }, unread_count: 0,
  }));
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

// [FIX P13] Endpoints para que el CRM Oliver envíe media al cliente
// POST /internal/operator-send-image { phone, image_url, caption }
app.post("/internal/operator-send-image", async (req, res) => {
  try {
    if (!validInternalOperatorToken(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
    const phone = normPhone(req.body?.phone || "");
    const url = String(req.body?.image_url || "").trim();
    const caption = String(req.body?.caption || "").trim();
    if (!phone || !url) return res.status(400).json({ ok: false, error: "phone_and_image_url_required" });
    await waSendImageUrl(phone, url, caption);
    res.json({ ok: true, sent: true, phone });
  } catch (e) {
    logErr("/internal/operator-send-image", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /internal/operator-send-video { phone, video_url, caption }
app.post("/internal/operator-send-video", async (req, res) => {
  try {
    if (!validInternalOperatorToken(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
    const phone = normPhone(req.body?.phone || "");
    const url = String(req.body?.video_url || "").trim();
    const caption = String(req.body?.caption || "").trim();
    if (!phone || !url) return res.status(400).json({ ok: false, error: "phone_and_video_url_required" });
    await waSendVideoUrl(phone, url, caption);
    res.json({ ok: true, sent: true, phone });
  } catch (e) {
    logErr("/internal/operator-send-video", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /internal/operator-send-document { phone, doc_url, filename, caption }
app.post("/internal/operator-send-document", async (req, res) => {
  try {
    if (!validInternalOperatorToken(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
    const phone = normPhone(req.body?.phone || "");
    const url = String(req.body?.doc_url || "").trim();
    const filename = String(req.body?.filename || "documento.pdf").trim();
    const caption = String(req.body?.caption || "").trim();
    if (!phone || !url) return res.status(400).json({ ok: false, error: "phone_and_doc_url_required" });
    await waSendDocumentUrl(phone, url, filename, caption);
    res.json({ ok: true, sent: true, phone });
  } catch (e) {
    logErr("/internal/operator-send-document", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /internal/operator-send-voice { phone, text }  → TTS ElevenLabs y envía como nota de voz
app.post("/internal/operator-send-voice", async (req, res) => {
  try {
    if (!validInternalOperatorToken(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
    const phone = normPhone(req.body?.phone || "");
    const text = String(req.body?.text || "").trim();
    if (!phone || !text) return res.status(400).json({ ok: false, error: "phone_and_text_required" });
    await sendVoiceOrAudio(phone, text, "audio");
    fireAndForget("trackConversationEvent.operator_voice", trackConversationEvent({
      channel: "whatsapp", external_id: phone, direction: "outbound",
      actor_type: "operator", actor_name: req.body?.operator_name || "Operador",
      message_type: "audio", body: `🎤 Nota de voz: ${text.slice(0,120)}${text.length>120?'…':''}`,
      metadata: { source: "sales_os_operator", tts: true }, unread_count: 0,
    }));
    res.json({ ok: true, sent: true, phone });
  } catch (e) {
    logErr("/internal/operator-send-voice", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// [FIX P14] Endpoint que recibe archivo en BASE64 y lo envía al cliente vía WhatsApp
// Usado por el Sales OS cuando el operador sube un archivo desde el CRM
app.post("/internal/operator-upload-media", async (req, res) => {
  try {
    if (!validInternalOperatorToken(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
    const { phone, kind, filename, mime_type, file_base64, caption, operator_name } = req.body || {};
    if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });
    if (!file_base64) return res.status(400).json({ ok: false, error: "file_base64_required" });
    if (!["image", "video", "document"].includes(kind)) return res.status(400).json({ ok: false, error: "invalid_kind" });

    const buffer = Buffer.from(file_base64, "base64");
    const cleanPhone = normPhone(phone);
    const cap = caption || "";

    let mediaId;
    if (kind === "image") {
      mediaId = await waSendImage(cleanPhone, buffer, filename || "image.jpg", cap, mime_type || "image/jpeg");
    } else if (kind === "video") {
      mediaId = await waSendVideo(cleanPhone, buffer, filename || "video.mp4", cap, mime_type || "video/mp4");
    } else if (kind === "document") {
      await waSendPdf(cleanPhone, buffer, filename || "documento.pdf", cap);
      mediaId = "document-sent";
    }

    res.json({ ok: true, sent: true, phone: cleanPhone, media_id: mediaId });
  } catch (e) {
    logErr("/internal/operator-upload-media", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// [v11.6 2026-04-21] Nota de voz GRABADA por el operador (NO TTS)
// Recibe audio grabado en base64 desde el inbox y lo envía directo a WhatsApp
// como nota de voz. Compatible con MediaRecorder web (webm/ogg/mp4).
app.post("/internal/operator-send-audio-recording", async (req, res) => {
  try {
    if (!validInternalOperatorToken(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
    const { phone, audio_base64, mime_type, operator_name } = req.body || {};
    if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });
    if (!audio_base64) return res.status(400).json({ ok: false, error: "audio_base64_required" });

    const cleanPhone = normPhone(phone);
    const buffer = Buffer.from(audio_base64, "base64");
    const mime = mime_type || "audio/ogg";
    // WhatsApp acepta: audio/aac, audio/mp4, audio/mpeg, audio/amr, audio/ogg (codecs=opus)
    const ext = mime.includes("webm") ? "webm" : mime.includes("mp4") ? "m4a" : mime.includes("mpeg") ? "mp3" : "ogg";
    const filename = `rec_${Date.now()}.${ext}`;

    let mediaId;
    try {
      mediaId = await waUploadAudio(buffer, mime, filename);
      await waSendAudio(cleanPhone, mediaId);
    } catch (e) {
      logErr("operator-send-audio-recording.upload", e);
      return res.status(502).json({ ok: false, error: "whatsapp_upload_failed", detail: e.message });
    }

    // Registrar en inbox como outbound (audio grabado)
    fireAndForget("trackConversationEvent.operator_recording", trackConversationEvent({
      channel: "whatsapp", external_id: cleanPhone, direction: "outbound",
      actor_type: "operator", actor_name: operator_name || "Marcelo",
      message_type: "audio", body: `🎙️ Nota de voz grabada (${Math.round(buffer.length/1024)} KB)`,
      metadata: { source: "sales_os_operator", recording: true, mime_type: mime, size_bytes: buffer.length },
      unread_count: 0,
    }));

    // Guardar en media_attachments vía mediaStore para que aparezca en el inbox
    if (MEDIA_ENABLED) {
      saveMedia({
        phone: cleanPhone, direction: 'outbound', mediaType: 'audio',
        mimeType: mime, filename, buffer, waMediaId: mediaId,
      }).catch(() => {});
    }

    logInfo("operator-recording", `🎙️ audio grabado enviado a ${cleanPhone} (${buffer.length} bytes)`);
    res.json({ ok: true, sent: true, phone: cleanPhone, media_id: mediaId, size_bytes: buffer.length });
  } catch (e) {
    logErr("/internal/operator-send-audio-recording", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// [FIX P14] Resolver de catálogo: el Sales OS manda catalog_key (ej "catalogo_pvc")
// y este endpoint busca la URL en env vars y la envía
// Debug temporal agenda — devuelve los últimos comandos vistos en runtime.
app.get("/internal/agenda-debug", (req, res) => {
  if (!validInternalOperatorToken(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  res.json({
    ok: true,
    build: AGENDA_BUILD,
    admin_phone: ADMIN_PHONE,
    norm_admin: normalizeAdminPhone(ADMIN_PHONE),
    count: __agendaDebug.length,
    last: __agendaDebug.slice(-20),
  });
});

app.post("/internal/operator-send-catalog", async (req, res) => {
  try {
    if (!validInternalOperatorToken(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
    const { phone, catalog_key, media_type, caption } = req.body || {};
    if (!phone || !catalog_key) return res.status(400).json({ ok: false, error: "phone_and_catalog_key_required" });

    const url = resolveCatalogUrl(catalog_key);
    if (!url) return res.status(404).json({ ok: false, error: `catalog_not_configured: ${catalog_key}` });

    const cleanPhone = normPhone(phone);
    if (media_type === "image") {
      await waSendImageUrl(cleanPhone, url, caption || "");
    } else if (media_type === "video") {
      await waSendVideoUrl(cleanPhone, url, caption || "");
    } else if (media_type === "document") {
      await waSendDocumentUrl(cleanPhone, url, `${catalog_key}.pdf`, caption || "");
    } else {
      return res.status(400).json({ ok: false, error: "invalid_media_type" });
    }

    res.json({ ok: true, sent: true, phone: cleanPhone, catalog_key, url });
  } catch (e) {
    logErr("/internal/operator-send-catalog", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══ v11.5-1 ENDPOINT: enviar plantilla Meta a un teléfono ═══
// POST /admin/send-template?pin=XXXX
// body: { template: "recontacto_lead", phone: "569XXXXXXXX", customer_name: "Pedro", quote_num: "COT-..." }
app.post("/admin/send-template", express.json(), async (req, res) => {
  try {
    const pin = req.query.pin || req.body?.pin;
    if (pin !== ADMIN_PIN) return res.status(401).json({ ok: false, error: "invalid_pin" });

    const { template, phone, customer_name, quote_num, motivo, fecha, resumen, linea3, linea4 } = req.body || {};
    if (!template || !phone) return res.status(400).json({ ok: false, error: "template_and_phone_required" });

    let result;
    switch (String(template).toLowerCase()) {
      case "recontacto_lead":
        result = await sendTemplateRecontactoLead(phone, customer_name);
        break;
      case "seguimiento_cotizacion":
        result = await sendTemplateSeguimientoCotizacion(phone, customer_name, quote_num);
        break;
      case "confirmacion_cotizacion":
        result = await sendTemplateConfirmacionCotizacion(phone, customer_name, quote_num);
        break;
      case "envio_cotizacion":
        result = await sendTemplateEnvioCotizacion(phone, customer_name);
        break;
      case "bienvenida_activa_inversiones":
      case "bienvenida":
        result = await sendTemplateBienvenidaActiva(phone, customer_name);
        break;
      case "escalamiento_marcelo":
        result = await sendTemplateEscalamientoMarcelo(phone, customer_name, motivo);
        break;
      case "informe_diario":
        // FIX 2026-05-23: pasar los 4 params requeridos por Meta
        result = await sendTemplateInformeDiario(phone, fecha, resumen, linea3, linea4);
        break;
      default:
        return res.status(400).json({ ok: false, error: "unknown_template", available: ["recontacto_lead","seguimiento_cotizacion","confirmacion_cotizacion","envio_cotizacion","bienvenida_activa_inversiones","escalamiento_marcelo","informe_diario"] });
    }

    fireAndForget("logOliverEvent.template_sent", logOliverEvent("template_sent_admin", { phone, template, ok: result.ok }));
    res.json({ ok: result.ok, template, phone, result });
  } catch (e) {
    logErr("/admin/send-template", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══ v11.5-1b ENDPOINT BULK: enviar plantilla a varios teléfonos ═══
// POST /admin/send-template-bulk?pin=XXXX
// body: { template: "recontacto_lead", recipients: [{ phone, customer_name, quote_num }, ...] }
app.post("/admin/send-template-bulk", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const pin = req.query.pin || req.body?.pin;
    if (pin !== ADMIN_PIN) return res.status(401).json({ ok: false, error: "invalid_pin" });

    const { template, recipients } = req.body || {};
    if (!template || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ ok: false, error: "template_and_recipients_required" });
    }
    if (recipients.length > 100) return res.status(400).json({ ok: false, error: "max_100_per_bulk" });

    const results = [];
    for (const r of recipients) {
      // Anti rate-limit Meta: 200ms entre envíos
      await sleep(200);
      let single;
      switch (String(template).toLowerCase()) {
        case "recontacto_lead": single = await sendTemplateRecontactoLead(r.phone, r.customer_name); break;
        case "seguimiento_cotizacion": single = await sendTemplateSeguimientoCotizacion(r.phone, r.customer_name, r.quote_num); break;
        case "confirmacion_cotizacion": single = await sendTemplateConfirmacionCotizacion(r.phone, r.customer_name, r.quote_num); break;
        case "envio_cotizacion": single = await sendTemplateEnvioCotizacion(r.phone, r.customer_name); break;
        case "bienvenida_activa_inversiones":
        case "bienvenida": single = await sendTemplateBienvenidaActiva(r.phone, r.customer_name); break;
        default: single = { ok: false, error: "unknown_template" };
      }
      results.push({ phone: r.phone, ok: single.ok, error: single.error });
    }

    const sentOk = results.filter(x => x.ok).length;
    fireAndForget("logOliverEvent.template_bulk", logOliverEvent("template_bulk_sent", { template, total: recipients.length, ok: sentOk }));
    res.json({ ok: true, template, total: recipients.length, sent_ok: sentOk, results });
  } catch (e) {
    logErr("/admin/send-template-bulk", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// [FIX P14] Aumentar límite del body parser del bot para archivos base64 hasta 25MB
// (ya debería estar configurado, pero forzamos)
app.post("/webhook", async (req, res) => {
  // [AGENDA FASE 1] Interceptar comandos de agenda del CEO (AGENDA/LISTO/POSPONER) ANTES del
  // routing a Oliver v2. El número CEO está en OLIVER_V2_NUMBERS y v2 NO tiene estos comandos
  // → sin esto la agenda nunca engancha para Marcelo. Solo aplica al número CEO + texto que
  // matchea un comando de agenda; cualquier otra cosa cae al flujo normal (v2/v1) intacta.
  try {
    const _agInc = extractMsg(req.body);
    if (_agInc?.ok && _agInc.type === "text" && verifySig(req) &&
        normalizeWaId(_agInc.waId) === normalizeAdminPhone(ADMIN_PHONE)) {
      const _agCmd = parseAdminCmd(_agInc.text || "");
      if (_agCmd && (_agCmd.type === "agenda_today" || _agCmd.type === "agenda_done" || _agCmd.type === "agenda_snooze")) {
        __agendaDebug.push({ ts: new Date().toISOString(), stage: "early_intercept", waId: _agInc.waId, esCEO: true, adminCmd: _agCmd.type, text: (_agInc.text || "").slice(0, 60), build: AGENDA_BUILD });
        if (__agendaDebug.length > 20) __agendaDebug.shift();
        res.sendStatus(200);
        if (!isDup(_agInc.msgId)) {
          try { await handleAgendaCommand(_agInc.waId, _agCmd); } catch (e) { try { logErr("agenda_intercept", e); } catch {} }
        }
        return;
      }
    }
  } catch (e) { try { logErr("agenda_intercept_outer", e); } catch {} }

  // [Oliver v2 pilot] feature-flag routing — falls through to v1 on any error
  try {
    const v2Enabled = process.env.OLIVER_V2_ENABLED === "true";
    if (v2Enabled) {
      const norm = (s) => (s || "").replace(/\D/g, "");
      const v2Numbers = (process.env.OLIVER_V2_NUMBERS || "")
        .split(",")
        .map(norm)
        .filter(Boolean);
      const _inc = extractMsg(req.body);
      const from = _inc?.ok ? norm(_inc.waId) : "";
      if (from && v2Numbers.includes(from)) {
        // Verifica la firma de Meta ANTES de rutear a v2 (misma garantía que v1).
        if (!verifySig(req)) { res.sendStatus(200); return; }
        const { handleWebhook } = await import("./src/sales-agent/agent.js");
        return handleWebhook(req, res);
      }
    }
  } catch (e) {
    try {
      logErr("oliver_v2_flag", e);
    } catch {}
    // fall through to v1
  }
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
    // [v5.1] Hidratar sesión desde Postgres si el cache está frío (sobrevive a redeploys)
    await loadSessionFromStore(waId);

    const ses = getSession(waId);
    ses.waId = waId;
    await waRead(msgId);

    let userText = inc.text || "";
    // [FIX P12] displayText = lo que se muestra en el CRM. userText = prompt interno a la IA
    let displayText = inc.text || "";

    if (type === "audio" && inc.audioId) {
      const meta = await waMediaUrl(inc.audioId);
      const { buffer, mime } = await waDownload(meta.url);
      const t = await stt(buffer, mime);
      userText = t ? `[Audio]: ${t}` : "[Audio no reconocido]";
      displayText = t ? `🎤 Audio: ${t}` : "🎤 Audio recibido (no transcribible)";

      // v11.5-2: DETECTOR DE AUDIOS ESPURIOS (TikTok forwards / outros de YouTube)
      const ses = getSession(waId);
      if (detectSpamAudio(t || "")) {
        ses.spamAudioCount = (ses.spamAudioCount || 0) + 1;
        logInfo("spam_audio_detected", `tel=${waId} count=${ses.spamAudioCount} text="${t || "vacío"}"`);
        // Si lleva 3+ audios espurios, pedir texto y NO procesar como input válido
        if (ses.spamAudioCount >= 3) {
          if (!ses.spamAudioReplied) {
            await waSendH(waId, "Disculpá, me llegan audios cortados o reenviados. ¿Me podés escribir tu consulta? Así te ayudo más rápido 🙏", true);
            ses.spamAudioReplied = true;
            saveSession(waId, ses);
          }
          fireAndForget("logOliverEvent.spam_audio_skip", logOliverEvent("spam_audio_skip", { phone: waId, count: ses.spamAudioCount }));
          return res.sendStatus(200);
        }
      } else {
        // Audio válido, resetear contador
        ses.spamAudioCount = 0;
        ses.spamAudioReplied = false;
      }

      // v5.3: Guardar audio en BD
      if (MEDIA_ENABLED && buffer) {
        saveMedia({ phone: waId, direction: 'inbound', mediaType: 'audio', mimeType: mime || 'audio/ogg', filename: `audio_${waId}_${Date.now()}.ogg`, buffer, waMediaId: inc.audioId, transcription: t || '' }).catch(() => {});
      }
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
      // [FIX P12] Separamos: userText = prompt interno a la IA | displayText = lo que se guarda en CRM
      userText = ext
        ? `[IMAGEN ANALIZADA — Productos detectados]:\n${ext}\n\nINSTRUCCIÓN: extrae TODOS los items y envíalos con update_quote en UNA sola llamada.`
        : "[Imagen no legible]";
      displayText = ext
        ? `📷 Imagen enviada — ${ext.length > 120 ? ext.slice(0,120).replace(/\n/g, ' ') + '…' : ext.replace(/\n/g, ' ')}`
        : "📷 Imagen enviada (no legible)";
      // v5.3: Guardar imagen en BD
      if (MEDIA_ENABLED && buffer) {
        saveMedia({ phone: waId, direction: 'inbound', mediaType: 'image', mimeType: mime || 'image/jpeg', filename: `img_${waId}_${Date.now()}.jpg`, buffer, waMediaId: inc.imageId, aiDescription: ext || '' }).catch(() => {});
      }
    }

    if (type === "document" && inc.docId && inc.docMime === "application/pdf") {
      const meta = await waMediaUrl(inc.docId);
      const { buffer } = await waDownload(meta.url);
      const t = await readPdf(buffer);
      // [FIX P12] Separamos prompt interno vs display CRM
      userText = t
        ? `[PDF ANALIZADO]:\n${t}\n\nINSTRUCCIÓN: extrae TODOS los items y envíalos con update_quote.`
        : "[PDF sin texto]";
      displayText = t
        ? `📄 PDF enviado — ${t.length > 120 ? t.slice(0,120).replace(/\n/g, ' ') + '…' : t.replace(/\n/g, ' ')}`
        : "📄 PDF enviado (sin texto extraíble)";
      // v5.3: Guardar PDF en BD
      if (MEDIA_ENABLED && buffer) {
        saveMedia({ phone: waId, direction: 'inbound', mediaType: 'document', mimeType: 'application/pdf', filename: `doc_${waId}_${Date.now()}.pdf`, buffer, waMediaId: inc.docId, transcription: t || '' }).catch(() => {});
      }
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
        // [FIX P12] En CRM guardamos displayText (limpio), no el prompt interno a la IA
        body: displayText || userText,
        metadata: { source: "whatsapp_webhook", msg_id: msgId, raw_type: type },
        quote_status: ses.data?.stageKey || undefined,
        unread_count: 1,
      })
    );

    const control = await getConversationControl(waId);
        // [ADMIN] Chequear comando OLIVER IN/OFF o admin
    const adminCmd = parseAdminCmd(userText);
        // [DEBUG] Log del número para ver formato
    if (/^(OLIVER|ADMIN|AGENDA|LISTO|POSPONER)/i.test((userText || "").trim())) {
      const __dbg = {
        ts: new Date().toISOString(),
        waId,
        norm_waId: normalizeWaId(waId),
        norm_admin: normalizeAdminPhone(ADMIN_PHONE),
        esCEO: normalizeWaId(waId) === normalizeAdminPhone(ADMIN_PHONE),
        adminCmd: adminCmd ? adminCmd.type : null,
        text: (userText || "").slice(0, 60),
        build: AGENDA_BUILD,
      };
      logInfo("ADMIN_DEBUG", JSON.stringify(__dbg));
      __agendaDebug.push(__dbg);
      if (__agendaDebug.length > 20) __agendaDebug.shift();
    }
    if (adminCmd) {
      // Agenda de seguimiento (FASE 1) — SIN PIN, solo el número CEO. Silencioso si no es Marcelo.
      if (adminCmd.type === "agenda_today" || adminCmd.type === "agenda_done" || adminCmd.type === "agenda_snooze") {
        if (normalizeWaId(waId) !== normalizeAdminPhone(ADMIN_PHONE)) {
          return; // no autorizado: ignorar silencioso para no filtrar la existencia del comando
        }
        if (adminCmd.type === "agenda_today") {
          const a = await callAgendaApi('GET', '/internal/agenda/today', null);
          await waSendH(waId, a.message || "No pude leer la agenda.", true);
          return;
        }
        if (adminCmd.type === "agenda_done") {
          const a = await callAgendaApi('POST', '/internal/agenda/done', { query: adminCmd.query });
          let msg;
          if (a.ok) msg = `✅ Listo: ${a.customer_name}, lo saco de la agenda.`;
          else if (a.reason === 'ambiguo') msg = `Hay varios con ese nombre: ${(a.options || []).map(o => o.name + ' (' + o.phone + ')').join(', ')}. Responde LISTO con el teléfono.`;
          else if (a.reason === 'no_encontrado') msg = `No encontré a "${adminCmd.query}" en la agenda.`;
          else msg = a.error ? `No pude marcar como listo: ${a.error}` : "No pude marcar como listo.";
          await waSendH(waId, msg, true);
          return;
        }
        if (adminCmd.type === "agenda_snooze") {
          const a = await callAgendaApi('POST', '/internal/agenda/snooze', { query: adminCmd.query, days: adminCmd.days });
          let msg;
          if (a.ok) msg = `⏸️ Pospuse a ${a.customer_name} por ${a.days} días.`;
          else if (a.reason === 'ambiguo') msg = `Hay varios con ese nombre: ${(a.options || []).map(o => o.name + ' (' + o.phone + ')').join(', ')}. Responde POSPONER con el teléfono.`;
          else if (a.reason === 'no_encontrado') msg = `No encontré a "${adminCmd.query}" en la agenda.`;
          else msg = a.error ? `No pude posponer: ${a.error}` : "No pude posponer.";
          await waSendH(waId, msg, true);
          return;
        }
      }

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
        const qnLocal = `COT-${Date.now()}`;
        try {
          const estimate = await zhBooksCreateEstimate(ses.data, ses.data.name || "Cliente", normPhone(waId));
          if (estimate?.estimate_id) {
            const pdfBuf = await zhBooksDownloadEstimatePdf(estimate.estimate_id);
            await waSendPdf(waId, pdfBuf, `PropuestaManual_${Date.now()}.pdf`, "PDF enviado manualmente");
            ses.zohoEstimateId = estimate.estimate_id;
            ses.pdfSent = true;
            saveSession(waId, ses);
            await waSendH(waId, "✅ PDF reenviado (Zoho).", true);
            return;
          }
        } catch (zhErr) {
          logErr("admin_force_pdf.zoho", zhErr);
        }
        // Fallback: PDF local
        try {
          const pdfBuf = await generateLocalQuotePdf({ ...ses.data, phone: normPhone(waId), quote_num: qnLocal }, qnLocal);
          await waSendPdf(waId, pdfBuf, `${qnLocal}.pdf`, `Propuesta manual ${qnLocal}`);
          ses.pdfSent = true;
          saveSession(waId, ses);
          await waSendH(waId, "✅ PDF generado localmente y enviado.", true);
        } catch (localErr) {
          logErr("admin_force_pdf.local", localErr);
          await waSendH(waId, `❌ Error generando PDF: ${localErr.message}`, true);
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

    // === LÓGICA INTELIGENTE CON GPT + CONFIRMACIÓN (VERSIÓN FINAL) ===
    const t = userText.toLowerCase().trim();

    // ═══ v11.5-5 COMANDO ADMIN STATS por WhatsApp ═══
    // Solo MARCELO_PHONE puede pedir stats. Devuelve métricas en vivo.
    const marceloPhone = String(process.env.MARCELO_PHONE || "").replace(/[^\d]/g, "");
    const callerPhone = String(waId || "").replace(/[^\d]/g, "");
    if (callerPhone === marceloPhone && (t === "stats" || t === "status" || t === "estado")) {
      const totalSesiones = sessions.size;
      let pdfsGeneradosTotal = 0;
      let gatesBlocked = 0;
      for (const [_, s] of sessions) {
        pdfsGeneradosTotal += s.pdfGeneratedCount || 0;
        if (s.lastWasNegation) gatesBlocked += 1;
      }
      const stats = `📊 OLIVER STATS (v11.5)\n\n` +
        `🟢 Sesiones activas: ${totalSesiones}\n` +
        `📄 PDFs generados (total cache): ${pdfsGeneradosTotal}\n` +
        `🛑 Gates bloqueando ahora: ${gatesBlocked}\n` +
        `⏰ Hora Chile: ${new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" })}\n` +
        `🔧 Override activo: ${__cachedPromptOverride ? "SÍ" : "NO"}\n\n` +
        `Comandos: STATS / STATUS / ESTADO`;
      await waSendH(waId, stats, true);
      return;
    }

    // ═══ v11.4 PRE-PROCESADOR DE NEGACIÓN (cross-turno) ═══
    // Trackea negaciones del cliente para que canGeneratePdf() las vea por 2 turnos.
    const neg = detectNegation(userText);
    if (neg.isNegation) {
      ses.lastWasNegation = true;
      ses.negationCountdown = 2; // bloquea PDF por los próximos 2 turnos
      ses.lastNegatedTerm = neg.negatedTerm;
      logInfo("negation_detected", `tel=${waId} term=${neg.negatedTerm} countdown=2`);
      fireAndForget("logOliverEvent.negation", logOliverEvent("negation_detected", { phone: waId, term: neg.negatedTerm }));
    } else if (ses.negationCountdown > 0) {
      ses.negationCountdown -= 1;
      if (ses.negationCountdown === 0) ses.lastWasNegation = false;
    }

    // ═══ v11.5-7 DETECTOR DE LOOP DE CLIENTE (mismo mensaje 3x consecutivas) ═══
    if (detectClientLoop(ses, userText)) {
      logInfo("client_loop_detected", `tel=${waId} text="${userText.substring(0, 50)}"`);
      fireAndForget("logOliverEvent.client_loop", logOliverEvent("client_loop_detected", { phone: waId, repeated: userText.substring(0, 100) }));
      const nombre = ses.data?.name ? `, ${ses.data.name}` : "";
      const agente = process.env.AGENT_NAME || "Marcelo Cifuentes";
      await waSendH(waId, `Disculpá${nombre}, parece que no estoy entendiendo bien lo que necesitás. Te paso directo con ${agente} para que te ayude mejor. ¿A qué hora te queda bien que te llame hoy?`, true);
      const summary = buildEscalationSummary(ses, userText);
      await sendEscalationAlert(summary, normPhone(process.env.ESCALATION_PHONE || process.env.OWNER_NOTIFICATION_PHONE), ses.data);
      ses.recentClientMsgs = []; // reset para no escalar 2 veces seguidas
      saveSession(waId, ses);
      return;
    }

    // ═══ v11.5-3 INCREMENTO contador de turnos para resumen consolidado ═══
    ses.turnsSinceConsolidation = (ses.turnsSinceConsolidation || 0) + 1;
    if (ses.turnsSinceConsolidation >= 5) {
      // Reset acá. La instrucción ya viajó al LLM en buildConsolidationInstruction()
      // que se invoca en cada inyección del prompt.
      ses.turnsSinceConsolidation = 0;
    }

    // 1. Productos especiales que SIEMPRE se escalan
    const specialProductKeywords = ["templado", "vidrio templado", "mampara", "cierre de terraza", "cierre terraza", "celosia", "celosía", "aluminio", "cortina", "reja"];
    const isSpecialProduct = specialProductKeywords.some(kw => t.includes(kw));

    // 2. Frustración del cliente (v11.2: ampliado con "fiasco" y variantes que faltaban)
    const frustradoKeywords = ["ya", "chao", "basta", "mal humor", "repetis", "me tiene harto", "no amigo", "ya te dije", "ya envié", "ya mandé", "ya te lo", "perder el tiempo", "pierdo el tiempo", "me voy", "adiós", "adios", "frustrado", "hartó", "me cansé", "olvídelo", "fiasco", "pésimo", "pesimo", "horrible", "inútil", "inutil", "no sirve", "no sirven", "mal hecho", "un asco", "qué mal", "que mal", "mejoren", "no entiendes", "no entiende", "porquería", "porqueria"];
    const isFrustrated = frustradoKeywords.some(word => t.includes(word));

    // 3. Escalación inmediata
    if (isSpecialProduct || isFrustrated) {
      const agente = process.env.AGENT_NAME || "Marcelo Cifuentes";
      // v11.2: ANTES mandaba URLs SharePoint crudas violando Regla #8.
      // Ahora pide disculpa real (si fue por frustración) y ofrece llamada concreta.
      if (isFrustrated) {
        const nombre = ses.data?.name ? `, ${ses.data.name}` : "";
        await waSendH(waId, `Lamento haberte hecho perder tiempo${nombre}. Te paso directo con ${agente} ahora — él lo resuelve en una llamada de 5 minutos. ¿A qué hora te queda bien que te llame hoy?`, true);
      } else {
        await waSendH(waId, `✅ Entendido. Te voy a pasar directamente con nuestro ingeniero especialista ${agente} ahora mismo.`, true);
      }

      const summary = buildEscalationSummary(ses, userText);
      await sendEscalationAlert(summary, normPhone(process.env.ESCALATION_PHONE || process.env.OWNER_NOTIFICATION_PHONE), ses.data);
      return;
    }

    // 4. Corrección de medidas por el cliente
    if (t.includes("no decia") || t.includes("no era") || t.includes("no 3000") || t.includes("300x300") || t.includes("300 × 300")) {
      delete ses.data.items;
      ses.data.medidasEnviadas = true;
      await waSendH(waId, `✅ Entendido, corregí las medidas a 300×300 mm. ¿Qué color prefieres?`, true);
      saveSession(waId, ses);
      return;
    }

    // 5. Cliente ya envió medidas
    if (t.includes("adjunto") || t.includes("envié") || t.includes("mandé") || t.includes("ya te lo") || t.includes("fb.me") || t.includes("medidas")) {
      ses.data.medidasEnviadas = true;
      await waSendH(waId, `✅ Recibí tus medidas. Gracias!\n\nAhora dime:\n• Color (blanco, nogal, grafito, negro)\n• Comuna`, true);
      saveSession(waId, ses);
      return;
    }

    // 6. Normalizar tipo de apertura
    if (t.includes("normal") || t.includes("normales") || 
        t.includes("abatible") || t.includes("oscilobatiente") || t.includes("proyectante") || 
        t.includes("fijo") || t.includes("corredera") || t.includes("sliding") || 
        t.includes("basculante") || t.includes("plegable")) {
      ses.data.default_tipo = normTipoApertura(userText);
    }

    // 7. AVANCE AUTOMÁTICO + CONFIRMACIÓN (lo más importante)
    if (ses.data.medidasEnviadas && 
        (t.includes("blanco") || t.includes("nogal") || t.includes("roble") || t.includes("dorado") ||
         t.includes("grafito") || t.includes("antracita") || t.includes("gris") || t.includes("plomo") ||
         t.includes("negro") || t.includes("new black") || t.includes("color"))) {

      ses.data.default_color = normColor(userText);

      // v11.2: SIN JSON crudo. Formato legible humano.
      const resumen = `✅ **Resumen de tu cotización:**\n\n` +
        `• Tipo: ${ses.data.default_tipo || "CORREDERA"}\n` +
        `• Color: ${ses.data.default_color}\n` +
        `• Medidas: ${formatItemsHumano(ses.data.items)}\n` +
        `• Comuna: ${ses.data.comuna || "Pendiente"}\n\n` +
        `¿Está todo correcto? Responde **SÍ** o **CONFIRMO** para generar la cotización definitiva.`;

      await waSendH(waId, resumen, true);
      return;
    }

    // 8. Lógica normal
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
        // [FIX P13] Procesar send_media tool (catálogos, fotos, videos)
        if (tc.function?.name === "send_media") {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch { continue; }
          const mediaResult = await handleSendMediaCall(waId, args);
          if (mediaResult.ok) {
            logInfo("send_media", `${args.media_type} ${args.catalog_key} → ${waId}`);
          } else {
            logErr("send_media", new Error(mediaResult.error));
            actionsResult.errors.push(`send_media_failed: ${mediaResult.error}`);
          }
          continue;
        }
        if (tc.function?.name !== "update_quote") continue;

        // ═══ v11.4 GATE: bloquear avalancha de PDFs ═══
        const gate = canGeneratePdf(ses, userText);
        if (!gate.allow) {
          logInfo("pdf_gate_blocked", `tel=${waId} reason=${gate.reason} pdfCount=${ses.pdfGeneratedCount || 0}`);
          actionsResult.pdfBlocked = true;
          actionsResult.pdfBlockReason = gate.reason;
          // No llamamos a update_quote, pero el LLM va a generar texto en pass2 igual.
          // El texto debe explicar que no regenera el PDF aún. Pasamos al siguiente tool call.
          continue;
        }

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
          // [V11-3 FIX]: NO resetear wants_pdf acá. Si el modelo lo pasó como true,
          // lo dejamos. Si no, la condición de envío del paso 2b se encarga.
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
              const hvResult = await notifyHighValue(waSend, normPhone(waId), ses, "auto");
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
    // [V11-3 FIX]: si tenemos items con precio real + datos del cliente completos
    // → ENVIAR el PDF SIEMPRE. No depender de regex frágiles ni de wants_pdf reseteado.
    // El wants_pdf y la regex quedan como caminos alternativos por compat.
    const allItemsPriced = d.items?.length > 0 && d.items.every(it => it.unit_price > 0);
    const someItemEscalates = d.items?.some(it => it.source === "cotizador_manual" || it.needs_escalation);
    const shouldSendPdf = isComplete(d) && d.grand_total && !ses.pdfSent &&
      !someItemEscalates &&
      (allItemsPriced || d.wants_pdf || actionsResult.quoted || /pdf|cotiza|cotizaci[oó]n|formal|env[ií]a|manda|propuesta/i.test(userText));

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
      // v11.3-5: FIX LOOP. Solo mandar status la PRIMERA vez por sesión.
      if (!ses.pdfStatusSent) {
        await waSendH(waId, "Generando su propuesta… 📄 Mientras le preparo el documento, le comparto un poco de nuestra empresa.", true);
        ses.pdfStatusSent = true;

        // v11.3-6: FIX URLs videos crudas. Solo mandar si la URL es CORTA (<80 chars).
        // URLs largas tipo SharePoint quemaban credibilidad. Si son largas → omitir.
        const videoSources = [
          { url: process.env.VIDEO_PLANTA, label: "🏭 Nuestra planta de producción" },
          { url: process.env.VIDEO_OFICINA, label: "🏢 Nuestras oficinas" },
          { url: process.env.VIDEO_OFICINA2, label: "🏢 Recorrido por nuestras instalaciones" },
          { url: process.env.VIDEO_INSTALACIONES, label: "🏠 Proyectos terminados" },
          { url: process.env.VIDEO_INSTALACIONES2, label: "🏠 Más trabajos realizados" },
          { url: process.env.VIDEO_PLANTA2, label: "🏭 Proceso de fabricación" },
        ].filter(v => v.url && v.url.length < 80 && !v.url.includes("sharepoint.com"));
        // Enviar máximo 3 videos para no saturar
        for (const v of videoSources.slice(0, 3)) {
          await waSend(waId, `${v.label}\n${v.url}`);
          await sleep(600);
        }
      }

      try {
        const estimate = await zhBooksCreateEstimate(d, d.name || "Cliente WhatsApp", normPhone(waId));
        if (estimate?.estimate_id) {
          ses.zohoEstimateId = estimate.estimate_id;
          cubicacionPendientes.delete(waId);
          
          const pdfBuf = await zhBooksDownloadEstimatePdf(estimate.estimate_id);
          await waSendPdf(waId, pdfBuf, `${qn}.pdf`, `Propuesta ${qn} — Si quiere ajustar algo, me avisa.`);
          
          ses.pdfSent = true;
          markPdfGenerated(ses); // v11.3: rate limit anti-avalancha PDFs
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
        // [FIX P14 — v10.4] Si Zoho falla → generar PDF LOCAL y enviarlo al cliente
        logErr("Estimate", e);
        actionsResult.errors.push("zoho_failed_using_local_pdf");
        try {
          // Enriquecer data con items precificados del cotizador
          const localData = {
            ...d,
            phone: normPhone(waId),
            quote_num: qn,
          };
          const localPdf = await generateLocalQuotePdf(localData, qn);
          await waSendPdf(waId, localPdf, `${qn}.pdf`, `Propuesta ${qn} — ${d.name || "su proyecto"}. Si quiere ajustar algo, me avisa.`);

          ses.pdfSent = true;
          d.stageKey = "propuesta";
          actionsResult.pdfSent = true;
          logInfo("local_pdf_sent", `PDF LOCAL enviado a ${waId} | ${d.name || "Sin nombre"} | ${qn}`);

          fireAndForget("trackQuoteEvent.local", trackQuoteEvent(buildQuotePayload(ses, waId, {
            status: "formal_sent_local", quote_number: qn,
          })));
        } catch (pdfErr) {
          // Si hasta el PDF local falla, avisamos y escalamos
          logErr("local_pdf_failed", pdfErr);
          await waSendH(waId, "Tuve un problema generando la propuesta. Marcelo la revisa personalmente y se la envía en minutos 🙏", true);
          fireAndForget("escalation.pdf-fail", sendEscalationAlert(`Fallo TOTAL PDF (Zoho + Local) para ${d.name || "cliente"}: ${pdfErr.message}`, normPhone(waId), d));
        }
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
// v11.2: Helper para mostrar items SIN JSON crudo. Texto humano legible.
function formatItemsHumano(items) {
  if (!items || !Array.isArray(items) || items.length === 0) return "Las que mencionaste";
  return items.map((it) => {
    const tipo = (it.product || it.tipo || "ventana").toLowerCase();
    const med = it.measures || it.medidas || "?";
    const color = (it.color || "blanco").toLowerCase();
    const qty = it.qty || it.cantidad || 1;
    return `${qty}× ${tipo} ${med} ${color}`;
  }).join(" | ");
}

function buildEscalationSummary(ses, lastMessage) {
  let summary = `🚨 ESCALACIÓN - Cliente frustrado\n\n`;
  summary += `📱 Teléfono: ${normPhone ? normPhone(ses.waId || '') : 'Desconocido'}\n`;
  summary += `👤 Nombre: ${ses.data?.name || 'No dijo'}\n`;
  summary += `🏠 Comuna: ${ses.data?.comuna || 'No dijo'}\n`;
  summary += `📏 Medidas: ${formatItemsHumano(ses.data?.items)}\n`;
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
  if (t.includes("negro") || t.includes("black") || t.includes("new black") || t.includes("newblack")) return "NEWBLACK";

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
    `🚀 Oliver v11.8.1 (FIX template informe_diario 4 params) — Activa Imperium — port=${PORT} pricer=${PRICER_MODE} cotizador=${cotizadorWinhouseConfigured() ? "OK" : "NO"} zoho_books=${ZOHO.ORG_ID ? "OK" : "NO"} escalation=${ESCALATION_PHONE ? "ON" : "OFF"} voice=${VOICE_ENABLED ? VOICE_TTS_PROVIDER : "OFF"} identity=${process.env.OLIVER_IDENTITY || "default"} marcelo=${process.env.MARCELO_PHONE ? "SET" : "MISSING"} ffmpeg=checking`
  );
  // v11.5-4: cargar prompt overrides desde DB al arranque (no bloqueante)
  loadPromptOverrides().then(text => {
    if (text) console.log(`📋 Prompt override activo cargado (${text.length} chars)`);
    else console.log(`📋 Prompt override: ninguno activo`);
  }).catch(() => console.log(`📋 Prompt override: error al cargar (no crítico)`));
});
