// src/oliver-gpt/webhook.js
//
// HANDLER DE PRODUCCIÓN AISLADO — Oliver GPT (plan F4).
// ─────────────────────────────────────────────────────────────────────────
// Reúsa la tubería probada de Oliver GPT (agent.handleTurn) y la capa de
// WhatsApp de Oliver v2 (whatsapp-adapter), cableándolas a la persistencia
// REAL (salesOsBridge) y a la escalación REAL (highValueNotifier).
//
// NO toca el flujo de V1: es un módulo nuevo, sin estado compartido con
// index.js. El routing (montar este handler en una ruta Express) lo conecta
// el integrador; aquí solo se exporta handleWebhook(req, res).
//
// CONTRATO FAIL-SAFE:
//   1) res.sendStatus(200) se envía SIEMPRE e INMEDIATAMENTE (ack a Meta).
//      Meta reintenta si no recibe 200 rápido; el 200 corta los reintentos.
//   2) Absolutamente todo lo demás corre dentro de try/catch. Después del
//      200 NUNCA se relanza un error: se loguea y se traga. Un fallo en
//      cualquier servicio (control, IA, persistencia, WhatsApp) degrada
//      con gracia y jamás tumba el proceso ni dispara un 500 a Meta.
//   3) getConversationControl falla a "ai" (default seguro): ante error del
//      control NO se bloquea al bot. El takeover humano solo se respeta
//      cuando el control responde explícitamente que la IA está pausada.
//
// DEUDA TÉCNICA EXPLÍCITA (piloto):
//   · Historial in-memory (Map<from, {history, state}>). NO persiste entre
//     redeploys. TODO F5: reconstruir el contexto largo desde
//     conversation_messages al hidratar una sesión fría.
//   · persistSession es un placeholder (log). TODO F5: PUT a whatsapp_sessions
//     (ver index.js persistSessionToStore ~2281 como referencia).
//
// ESM, Node 18+.

import { handleTurn as realHandleTurn } from './agent.js';
// [2026-08-08] Quien contesto el turno (Claude o GPT) — ver engine.js ultimoProveedor().
import { ultimoProveedor } from './engine.js';
import { mantenerEscribiendo, conPausaHumana, enviarComoPersona } from '../../services/presenciaHumana.js';
// [2026-08-08] Cotizar a nombre de un cliente que le hablo directo al duenio.
import {
  obtener as obtenerAtribucion,
  limpiar as limpiarAtribucion,
  registrarQueNosEscribio,
  normalizar as normalizarTel,
} from '../../services/atribucionCotizacion.js';
// [2026-08-08] Estado que sobrevive a un redeploy (respaldo en Postgres). Ver §14b·bis.
import { leer as leerEstado, escribir as escribirEstado, reservar as reservarEstado, liberarReserva, borrar as borrarEstado } from '../../services/estadoPersistente.js';
// [2026-08-21] El informe térmico de la comuna, que se manda ANTES de la cotización.
import { pedirInformeComuna, normalizarComuna, esperarAntesDeEnviar, COMUNA_REFERENCIA, FIRMA, DEMORA_AVISO_MS, datosDelInforme } from '../../services/informeTermico.js';
import { generarInformeTermicoPdf } from '../../services/informeTermicoPdf.js';
import { laminasParaInforme, laminaTermopanel } from '../../services/laminasThermal.js';   // [2026-08-24] isotermas del FEM
import { getClient as realGetClient } from './engine.js';
import { parseExcelWindows } from './parseExcel.js';
import { recordarColor, anticipoDeLoCotizado, textoDelCliente } from './normalizers.js';   // [2026-08-25/28] color recordado + anticipo de la propuesta · [2026-08-31] lo que dijo el cliente
// 🔴 [2026-08-30] A NOMBRE DE QUIEN VAN LOS DOCUMENTOS (RUT + razon social o persona).
// Pedido del dueño a partir del caso de Alfredo Arias Luengo (conv 56952077379, CUATRO
// reclamos). La captura es DETERMINISTA —no depende de que el LLM la pase— por la misma
// razon por la que `extractComuna` lo es: medido contra la BD viva, de 249 sesiones activas
// en 20 dias solo 6 tenian `data.name`, y la de Alfredo NO lo tenia aunque el lo escribio
// tres veces. Un dato que depende del modelo se pierde.
import { extraerReceptor, receptorParaDocumento, fusionarReceptor } from '../../services/receptorCliente.js';
import { elegirVideo, mensajeDelVideo, mediaIdsDisponibles } from '../../services/videosFabrica.js';   // [2026-08-25] video de fabrica tras la propuesta
// [2026-08-28] INFORME DE VIENTOS en la secuencia (pedido del dueno: "dale, agrega el
// informe de vientos a la secuencia de Oliver"). THERMAL calcula (se pide por HTTP, regla
// de la casa), Oliver arma el PDF y lo entrega como 2o documento.
import { pedirVientos, ventanasParaVientos } from '../../services/vientosThermal.js';
import { generarInformeVientosPdf } from '../../services/informeVientosPdf.js';

// Cuanto se espera antes de mandar el video. Cae DESPUES del informe termico (4 s + 35 s)
// para no encimarle tres mensajes seguidos al cliente: propuesta → informe → video.
const DEMORA_VIDEO_MS = Number(process.env.INFORME_VIDEO_MS || 50_000);

// ── [2026-08-27] SECUENCIA INFORME-PRIMERO (Variante B · tablero #524) ──────────────
// Pedido del dueño, textual: *"¿por qué aún estamos entregando cotización a cliente y no
// lo que se aprobó desde el principio? … primero optimicemos todo lo ya ganado de los
// informes"*. El orden aprobado INVIERTE el envío (mensaje de valor → informe → video →
// recién ahí la propuesta con el precio) sin mover el instante de decisión: el proyecto
// se decide completo en el mismo punto de siempre.
// Piloto: flag default OFF + lista blanca de teléfonos. '*' en la lista habilita a todos
// (rollout final, decisión del dueño). Sin lista, el flag prendido no habilita a nadie.
const SEQ_INFORME_PRIMERO_ON = /^(1|true|on)$/i.test(String(process.env.SEQUENCE_INFORME_PRIMERO || '').trim());
const SEQ_INFORME_LISTA = String(process.env.SEQUENCE_INFORME_PRIMERO_LISTA || '')
  .split(',').map((t) => (t.trim() === '*' ? '*' : t.replace(/\D/g, ''))).filter(Boolean);
// Techo duro de espera del informe ANTES de la propuesta: si el informe tarda más que
// esto (o falla), la propuesta sale igual. El cliente JAMÁS se queda sin su PDF por
// esta secuencia — es la condición no negociable de la propuesta aprobada.
// [Codex, compuerta 28-ago] Env numérica BLINDADA: un typo ("45s") daba NaN y apagaba
// el piso o volvía un techo inmediato, en silencio. Inválido o negativo ⇒ default.
const msEnv = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : def;
};
const SEQ_INFORME_TIMEOUT_MS = msEnv(process.env.SEQUENCE_INFORME_TIMEOUT_MS, 120_000);
// [Dueño, 28-ago, textual: *"la idea es que se vea más natural secuencial la información"*
// — medido en su prueba: térmico→vientos 8 s, imposible de hojear.] PISO de ritmo entre
// el mensaje de valor y el informe térmico: si el motor contesta rápido, se espera igual
// hasta cumplir el piso; si tarda más, no se agrega nada. Regulable sin deploy.
const SEQ_TERMICO_MS = msEnv(process.env.SEQUENCE_TERMICO_MS, 45_000);
// Pausa humana entre el informe y el video cuando el video cae ENTRE documentos.
const SEQ_VIDEO_MS = msEnv(process.env.SEQUENCE_VIDEO_MS, 20_000);
// [2026-08-28] Pausa humana antes del informe de VIENTOS (2o documento de la secuencia).
// 6 s originales → 25 s por la misma orden de ritmo del dueño.
const SEQ_VIENTOS_MS = msEnv(process.env.SEQUENCE_VIENTOS_MS, 25_000);
// [Dueño, 28-ago] Pausa entre el ANTICIPO de la propuesta (qué contiene, con ancho y
// alto nombrados) y el PDF: tiempo para leerlo antes de que caiga el documento.
const ANTICIPO_MS = msEnv(process.env.PROPUESTA_ANTICIPO_MS, 8_000);
// [Dueño, 27-ago: "dale pausa"] Aire entre el informe (y su video) y el PRECIO. Medido en
// la prueba real: sin esto, del informe al precio pasaban 9 segundos — el cliente recién
// abría el informe y ya le caía la propuesta. 35 s deja mirar; regulable sin deploy.
const SEQ_PRECIO_MS = Number(process.env.SEQUENCE_PRECIO_MS || 35_000);

export function secuenciaInformePrimero(waId, { flag = SEQ_INFORME_PRIMERO_ON, lista = SEQ_INFORME_LISTA } = {}) {
  if (!flag) return false;
  if (!Array.isArray(lista) || !lista.length) return false;
  if (lista.includes('*')) return true;
  const tel = String(waId || '').replace(/\D/g, '');
  return Boolean(tel) && lista.includes(tel);
}
import {
  parseInbound as realParseInbound,
  parseStatuses as realParseStatuses,
  sendWhatsAppText as realSendWhatsAppText,
  sendWhatsAppImageUrl as realSendImageUrl,
  sendWhatsAppVideoUrl as realSendVideoUrl,
  sendWaVideo as realSendWaVideo,
  sendWhatsAppDocumentUrl as realSendDocumentUrl,
  uploadWaAudio as realUploadWaAudio,
  sendWaAudio as realSendWaAudio,
  uploadWaDocument as realUploadWaDocument,
  sendWaDocument as realSendWaDocument,
} from '../sales-agent/whatsapp-adapter.js';
import { generatePremiumQuotePdf as realGeneratePdf } from '../../services/quotePdf.js';
import { priceAllEngine, detectHojas } from '../../services/enginePricer.js'; // [2026-06-24] blindaje label↔precio en generarPdf
import { saveMedia } from '../../mediaStore.js'; // [#5] persistir media ENTRANTE (foto/audio/plano) para el cockpit
import { upsertZohoDeal as realUpsertZohoDeal, addZohoNote as realAddZohoNote, attachPdfToDeal as realAttachPdfToDeal, attachInboundToDeal } from '../../services/zohoCommercial.js';
import {
  shouldSendVoice as realShouldSendVoice,
  synthesizeVoiceBuffer as realSynthesizeVoiceBuffer,
} from '../../services/voiceBridge.js'; // [F4] voz saliente
import * as realBridge from '../../services/salesOsBridge.js';
import { notifyHighValue as realNotifyHighValue } from '../../services/highValueNotifier.js';
import { isPdfAffirmative, lastAssistantOfferedPdf, itemsFromQuoteCalls, stripMontos, stripAccionesFalsas, quoteDataComplete, datoQuePregunta, preguntaVigente } from './pdf-intent.js'; // [PDF-01] PDF determinista compartido con channel-agent · [Ronda 4] anti acciones-falsas
// [2026-08-31] LAS TRES PROPUESTAS A/B/C POR COLOR — compartidas con channel-agent.js (IG/FB)
// para que los dos canales roten igual, usen las MISMAS letras del folio y le digan al
// cliente lo mismo. `LETRAS_ALTERNATIVA` es ademas la fuente unica del sufijo ISO: antes el
// literal 'BCDEF…' estaba escrito dos veces en este mismo archivo.
import { LETRAS_ALTERNATIVA, foliosDeOpciones, letrasReservadas, textoDeOpciones, avisoPrevioOpciones } from './propuestas-color.js';
import { toFile as realToFile } from 'openai/uploads';
import {
  loadSession as realLoadSession,
  persistSession as realPersistSession,
  resetIfInactive,
} from './session-store.js';
import { parseReferral, buildCtwaLeadPayload } from '../../services/ctwaReferral.js'; // [F3b] CTWA
import { saludoForReferral } from '../../services/ctwaSaludos.js'; // [2026-07-18] saludo por ángulo Ronda 1
import { parseLandingRef, buildLandingLeadPayload } from '../../services/landingRefParser.js'; // [2026-07-02] atribución orgánica landing→WA
import { isVisionUnreadable } from '../../services/oliverVision.js'; // [F3b] detector imagen ilegible
import { isEscalationRequest, escalationMessage, sendEscalationTemplate } from './escalation.js'; // [2026-06-18] escalación determinista compartida

/* =========================================================================
 * CONFIG
 * ========================================================================= */

// [2026-06-24] Deriva UNA apertura clara del texto de un label de producto (o null si no hay
// exactamente una). Mismo criterio que el guard de agent.js. Se usa para el blindaje label↔precio
// del PDF: solo validamos ítems cuya apertura es inequívoca (si no, no tocamos → conservador).
function aperturaFromLabel(text) {
  const t = String(text || '').toLowerCase();
  // 🔴 [2026-08-26] LA COMPUESTA VA PRIMERO, Y POR ESO SE ESCAPABA DEL BLINDAJE.
  // Este blindaje re-cotiza en el motor y CORRIGE el precio si no corresponde al label. Solo
  // actuaba sobre items con una apertura inequivoca... y el label de una compuesta —
  // "Proyectante (arriba) + Fija (abajo)"— tiene DOS aperturas, asi que caia a null y el item
  // quedaba FUERA de la revision. La compuesta era el unico producto cuyo precio nadie
  // verificaba contra el motor.
  // Costo medido: en la propuesta 0356-C/-D las dos compuestas salieron $130.000 MAS BARATAS
  // cada una que lo que dice el motor ($277.725 contra $407.060). Un error asi no se ve
  // mirando el PDF — el numero parece razonable.
  // Una compuesta NO es ambigua: es una COMPUESTA. Se declara como tal y entra a la revision.
  if (/\bcompuestas?\b/.test(t)) return 'COMPUESTA';
  const f = new Set();
  if (/\boscilo\s?batient/.test(t)) f.add('OSCILOBATIENTE');
  if (/\bproyectant/.test(t)) f.add('PROYECTANTE');
  if (/\bcorrediz/.test(t) || /\bcorrederas?\b/.test(t) || /\bdeslizant/.test(t) || /\bsliding\b/.test(t)) f.add('CORREDERA');
  if (/\bbatient/.test(t) && !/\boscilo/.test(t)) f.add('BATIENTE');
  if (/\bfij[ao]s?\b/.test(t)) f.add('FIJA');
  return f.size === 1 ? [...f][0] : null;
}

const META = {
  VER: process.env.META_GRAPH_VERSION || 'v22.0',
  TOKEN: process.env.WHATSAPP_TOKEN,
};
const VISION_MODEL = () => process.env.AI_MODEL_OPENAI || 'gpt-4o';
const STT_MODEL = () => process.env.STT_MODEL || 'whisper-1';

// Tope de elementos guardados por conversación (bound de tokens del piloto).
const MAX_HISTORY = 40;

// [2026-07-06 LOTE2] Tope GLOBAL de alertas a Marcelo por respuesta vacía: si el fallo es sistémico
// (proveedor caído), 20 clientes mudos NO pueden ser 20 WhatsApp al dueño (abogado del diablo). Máx 3/h.
const REPLY_EMPTY_ALERTS = { windowStart: 0, count: 0 };
function replyEmptyAlertAllowed() {
  const now = Date.now();
  if (now - REPLY_EMPTY_ALERTS.windowStart > 3600000) { REPLY_EMPTY_ALERTS.windowStart = now; REPLY_EMPTY_ALERTS.count = 0; }
  REPLY_EMPTY_ALERTS.count += 1;
  return REPLY_EMPTY_ALERTS.count <= 3;
}

/* =========================================================================
 * ESTADO IN-MEMORY (piloto)
 *  · CONV: Map<from, {history, state}>  → contexto conversacional.
 *  · SEEN: Set<msgId>                   → idempotencia (dedupe).
 * Ambos son aceptables para el piloto de un número único. NO persisten entre
 * reinicios del proceso. TODO F5: mover a Postgres / Redis.
 * ========================================================================= */
const CONV = new Map();
const SEEN = new Set();
// Cota defensiva del Set de dedupe para no crecer sin límite en un proceso
// de larga vida. Al superar el tope se vacía (riesgo aceptable en piloto:
// a lo sumo se reprocesaría un id muy viejo, improbable de reaparecer).
const SEEN_MAX = 5000;

/* =========================================================================
 * RATE-LIMIT — 18 mensajes por minuto por waId.
 * Porteado de index.js rateOk (~L2525). Map<waId, { n, resetAt }>.
 * ========================================================================= */
const RATE_MAP = new Map();
// [2026-06-14] Anti-duplicado de cotización: phone → { quote_number, at }.
/**
 * Que numero le toca a ESTE documento: el mismo folio, una letra, o ninguno (folio nuevo).
 *
 * 🔴 [2026-08-26] Pura y aparte a proposito: decide el numero de un documento ISO, y eso tiene
 * que poder probarse sin levantar medio webhook.
 *
 * LA REGLA, en una linea: una CORRECCION conserva el numero; una ALTERNATIVA lleva letra.
 *
 * Nacio de un caso medido. Paula pidio dos cotizaciones, *"una de color negro y la otra de
 * color blanco"*. Las dos salieron con el folio 0353 y, como la fila se guarda POR NUMERO,
 * la segunda PISO a la primera: creada 16:21:08, actualizada 16:21:10, y quedo solo el
 * blanco. La cotizacion negra que la clienta tiene en la mano NO EXISTE en el registro.
 *
 * Regla del dueño: *"agregarle A B C D al final si hay, asi sera mas facil"*.
 *   0353 = el primero (equivale a la A) · 0353-B = la segunda · 0353-C = la tercera.
 * Como el numero cambia, cada documento cae en su propia fila y el pisado desaparece solo.
 *
 * ⚠️ Solo lleva letra si el anterior YA SE ENTREGO y el contenido es DISTINTO. Corregir una
 * medida sobre una propuesta que el cliente todavia no recibio sigue siendo la MISMA — eso se
 * arreglo el 08-ago (caso Jessica: 3 correlativos quemados en 5 minutos) y no se rompe.
 *
 * @returns {{numero:string|null, motivo:string}} numero null = pedir correlativo nuevo
 */
export function numeroDeDocumento({ lastQuote, sig, ventanaMs, ahora = Date.now() } = {}) {
  // [2026-08-31] Las letras salen de `propuestas-color.js`: la terna A/B/C compone folios con
  // las MISMAS y dos copias del alfabeto se desincronizan igual que dos copias de una regla.
  const LETRAS = LETRAS_ALTERNATIVA;
  const lq = lastQuote;
  if (!lq || !lq.quote_number) return { numero: null, motivo: 'sin_folio_previo' };
  if (!(ahora - (lq.at || 0) < ventanaMs)) return { numero: null, motivo: 'folio_vencido' };

  const base = String(lq.quote_base || lq.quote_number).replace(/-[A-Z]$/, '');
  const esOtroDocumento = lq.pdf_sent === true && !!lq.sig && lq.sig !== sig;
  if (!esOtroDocumento) {
    return { numero: lq.quote_number, motivo: lq.pdf_sent === true ? 'revision' : 'mismo_folio' };
  }
  const usadas = Number(lq.alternativas || 0);   // 0 = solo salio la primera
  if (usadas >= LETRAS.length) {
    // 26 alternativas para un mismo cliente no es un caso real; si pasa, se avisa y se reusa
    // el folio base en vez de inventar una numeracion que nadie sabria leer.
    return { numero: base, motivo: 'sin_letras' };
  }
  return { numero: `${base}-${LETRAS[usadas]}`, motivo: 'alternativa' };
}

/**
 * Cuantas letras de alternativa quedan CONSUMIDAS tras ENTREGAR el documento `quoteNumber`.
 *
 * 🔴 [2026-08-26 · Codex NO-APTO, defecto 2] El contador sumaba +1 en CADA entrega con letra:
 * reenviar la 0353-B (mismo contenido, motivo 'revision') volvia a sumar, y la proxima
 * alternativa salia 0353-D saltandose la C — y un salto en la numeracion, en ISO, hay que
 * poder explicarlo. La letra YA dice cuantas van: se deriva de ella, y el reenvio queda
 * idempotente. Math.max por si el rastro previo viniera mas adelantado que la letra.
 */
export function alternativasEntregadas(quoteNumber, previas = 0) {
  const letra = (String(quoteNumber || '').match(/-([A-Z])$/) || [])[1];
  const base = Number(previas) || 0;
  return letra ? Math.max(base, LETRAS_ALTERNATIVA.indexOf(letra) + 1) : base;
}

/**
 * ¿El candado de 30 dias del informe sigue valiendo, dado el ultimo RESET del telefono?
 *
 * 🔴 [2026-08-26, caso 0364 medido en BD] El dueño probo un "cliente nuevo" (Andres Pereira)
 * desde su telefono de siempre, tras un RESET — y el informe no salio: la huella
 * temuco|proyectantes60|termopaneldvh4124 ya tenia candado de las pruebas de Paula (14:11).
 * El candado hacia SU trabajo (mismo telefono + mismo proyecto = un informe cada 30 dias),
 * pero RESET limpiaba la conversacion SIN soltar los candados del informe: imposible probar
 * dos "clientes" seguidos desde un mismo numero. Reclamo textual: "FALTO EL INFORME TERMICO".
 *
 * El arreglo NO borra candados (las huellas no se pueden enumerar en el KV): RESET deja un
 * MARCADOR con su timestamp, y un candado solo vale si es POSTERIOR al ultimo RESET.
 * Compatibilidad: los candados viejos guardan `true` (sin fecha). Sin marcador de RESET
 * siguen valiendo como siempre; con un RESET posterior, quedan sueltos — que es exactamente
 * lo que el RESET pide.
 */
export function candadoVigente(candado, resetAt = 0) {
  if (!candado) return false;
  const puestoEn = candado === true ? 0 : Number(candado?.at || 0);
  return Number(resetAt) > 0 ? puestoEn > Number(resetAt) : true;
}

/**
 * La HUELLA de un informe termico: que tiene que cambiar para que sea OTRO informe.
 *
 * 🔴 [2026-08-26, regla del dueño] El candado de 30 dias existe para no mandarle al mismo
 * cliente el mismo informe una y otra vez. Pero miraba SOLO el telefono, y con eso bloqueaba
 * informes que si corresponden. Textual:
 *
 *   *"Es de sentido comun que si el cliente coloca que es de la comuna de Temuco al principio,
 *    despues se equivoca y dice «en realidad yo soy de Cunco», claramente debemos entregarle
 *    la propuesta nueva con la reglamentacion termica de esa comuna... Lo de los treinta dias
 *    es solo para si el cliente NO sufre modificaciones."*
 *
 * Caso medido: Paula tiene el informe CM-FR-006-2026-0008 emitido para CUNCO y hoy esta en
 * TEMUCO. Dos comunas, dos exigencias, y el candado la dejaba con la equivocada hasta el 24
 * de septiembre.
 *
 * QUE CAMBIA EL INFORME, y por que estos tres:
 *   · COMUNA  — define la exigencia normativa. Es el caso del dueño.
 *   · PRODUCTO — *"mejor necesito correderas en este proyecto, o proyectante en este otro, o
 *     puertas en este otro: todas van a tener termicas diferentes"*.
 *   · VIDRIO  — el Uw sale de ahi. Ya lo habia cazado Codex el 24-ago por otro camino.
 *
 * QUE **NO** LO CAMBIA: las medidas ni la cantidad de ventanas. Un proyecto de ocho ventanas
 * es UN informe, y agregarle una novena no lo convierte en otro. Por eso las medidas no
 * entran en la huella — si entraran, cada ventana nueva dispararia un informe.
 */
export function huellaDelInforme({ comuna = '', producto = '', glassLabel = '' } = {}) {
  const norm = (v) => String(v || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // "cunco" y "Cuncó" son la misma comuna
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40);
  const partes = [norm(comuna), norm(producto), norm(glassLabel)];
  // Sin ningun dato la huella queda vacia: se cae al candado por telefono de siempre, que es
  // el comportamiento viejo. Degradar al anterior es preferible a inventar una huella.
  return partes.every((x) => !x) ? '' : partes.join('|');
}

// Evita quemar un correlativo ISO nuevo por doble "confirmo", reintentos o
// re-cálculo por pérdida de estado (el bug que generó 0003 y 0004 en el mismo chat).
const RECENT_QUOTES = new Map();
const QUOTE_DEDUP_MS = 120000; // 2 min
const CONTROL_CACHE = new Map(); // [FIX 2026-06-19 CON-02] último control conocido por waId → fail-closed hacia el operador si sales-os cae

/**
 * Comprueba si el waId está dentro del límite de 18 msg/min.
 * @param {string} waId
 * @param {Map} [rateMap] — inyectable para tests.
 * @returns {{ ok: boolean, msg?: string }}
 */
function rateOk(waId, rateMap = RATE_MAP) {
  const now = Date.now();
  if (!rateMap.has(waId)) rateMap.set(waId, { n: 0, resetAt: now + 60_000 });
  const r = rateMap.get(waId);
  if (now >= r.resetAt) {
    r.n = 0;
    r.resetAt = now + 60_000;
  }
  r.n++;
  return r.n > 18
    ? { ok: false, msg: 'Escribes muy rápido 😅 Dame 10 seg.' }
    : { ok: true };
}

/* =========================================================================
 * MUTEX — serializa mensajes concurrentes del mismo waId (doble-tap).
 * Porteado de index.js acquireLock (~L2558).
 * Map<waId, Promise> — la promesa encadenada actúa como cola FIFO de 1.
 * ========================================================================= */
const LOCKS = new Map();

/**
 * Adquiere el lock para waId. Retorna una función release().
 * @param {string} waId
 * @param {Map} [locks] — inyectable para tests.
 * @returns {Promise<Function>}
 */
async function acquireLock(waId, locks = LOCKS) {
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

/* =========================================================================
 * MEDIA — Resolución de imagen/audio entrantes a userText útil.
 *
 * parseInbound NO expone el media id (devuelve "[image]" / "[audio]"); el id
 * vive en el mensaje crudo de Meta, así que lo extraemos de req.body aquí.
 * Esto RESUELVE la ceguera de V2 ante adjuntos.
 * ========================================================================= */

// Extrae el mensaje crudo de Meta (mismo path que parseInbound).
function rawMessage(body) {
  return body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] || null;
}

// Descarga el binario de un media id de WhatsApp (2 pasos: URL firmada → blob).
async function downloadWaMedia(mediaId, deps) {
  const fetchFn = deps.fetchFn || fetch;
  const ver = META.VER;
  const token = META.TOKEN;
  // 1) Resolver la URL temporal del media.
  const metaRes = await fetchFn(`https://graph.facebook.com/${ver}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(12000), // [FIX 2026-06-19 VIS-01] sin timeout, un cuelgue de Meta bloqueaba el lock del cliente
  });
  if (!metaRes.ok) throw new Error(`media_meta_${metaRes.status}`);
  const meta = await metaRes.json();
  const url = meta?.url;
  const mime = meta?.mime_type || 'application/octet-stream';
  if (!url) throw new Error('media_url_missing');
  // 2) Descargar el binario (requiere el mismo Bearer).
  const blobRes = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  if (!blobRes.ok) throw new Error(`media_blob_${blobRes.status}`);
  const buf = Buffer.from(await blobRes.arrayBuffer());
  return { buffer: buf, mime };
}

// Vision: describe la imagen (productos/medidas) → userText útil. Espeja el
// patrón de index.js ~2127.
async function describeImage(buffer, mime, deps) {
  const client = (deps.getClient || realGetClient)();
  const b64 = buffer.toString('base64');
  const r = await client.chat.completions.create({
    model: VISION_MODEL(),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Eres un lector experto de planos y listados de ventanas/puertas. Extrae TODAS las filas, sin omitir ninguna. ' +
              'Para CADA ventana/puerta lista una línea con: identificador (V1, V2… si aparece), tipo de apertura ' +
              '(corredera/fija/proyectante/abatir/oscilobatiente), medidas ancho x alto TAL CUAL aparezcan (mm o cm), ' +
              'cantidad y color. Si un dato no aparece, escribe "NO ESPECIFICADO" pero NO borres la fila. ' +
              'Formato por ítem: <id> | <tipo> | <ancho>x<alto> | cant <n> | <color>. ' +
              'NO resumas ni agrupes: lista cada ítem por separado. Responde solo con las filas, en español.',
          },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}`, detail: 'high' } },
        ],
      },
    ],
    max_tokens: 4096,
  }, { timeout: 30000 }); // [FIX 2026-06-19 VIS-01] si la visión cuelga, no bloquea el lock del cliente
  const raw = (r.choices?.[0]?.message?.content || '').trim();
  // [F3b] Si la visión devolvió rechazo / vacío / sin medidas → marcar ilegible.
  // Evita que el orquestador confirme medidas que nunca llegaron (anti-alucinación).
  if (isVisionUnreadable(raw)) {
    // [2026-07-06 OBS] Log del crudo para diagnosticar rachas de ilegibles (caso Flavio: 15/15 en 2 min,
    // sin saber si fue rechazo del modelo o texto sin medidas). Solo observabilidad, cero cambio de flujo.
    try { log('warn', 'vision.unreadable', { len: raw.length, snippet: raw.slice(0, 180) }); } catch {}
    return '[Imagen no legible]';
  }
  return raw;
}

// STT: transcribe el audio → userText. Espeja index.js ~2112.
async function transcribeAudio(buffer, mime, deps) {
  const client = (deps.getClient || realGetClient)();
  const toFileFn = deps.toFile || realToFile;
  const file = await toFileFn(buffer, 'audio.ogg', { type: mime || 'audio/ogg' });
  const r = await client.audio.transcriptions.create({
    model: STT_MODEL(),
    file,
    language: 'es',
  }, { timeout: 25000 }); // [FIX 2026-06-19 VIS-01] timeout STT — evita lock colgado
  return (r.text || '').trim();
}

/**
 * Resuelve el userText efectivo de un inbound, manejando media.
 * @returns {Promise<{ userText:string, mediaResolved:boolean }>}
 *   mediaResolved=true cuando convertimos un adjunto en texto útil.
 *   Si el adjunto no se pudo resolver, devuelve un mensaje pidiendo texto.
 */
async function resolveUserText(inbound, body, deps) {
  const { type, text } = inbound;

  if (type === 'image') {
    const raw = rawMessage(body);
    const mediaId = raw?.image?.id;
    if (!mediaId) return { userText: text, mediaResolved: false };
    try {
      const { buffer, mime } = await downloadWaMedia(mediaId, deps);
      // [#5-robustez 2026-06-21] La visión puede fallar (ej: sin saldo OPENAI_API_KEY). Aislamos el
      // describe en su propio try → así el saveMedia de abajo SIEMPRE corre (el operador ve la foto
      // aunque la IA esté caída, que es justo cuando MÁS lo necesita).
      let desc = '';
      try { desc = await (deps.describeImage || describeImage)(buffer, mime, deps); }
      catch (e) { log('error', 'media.image.vision', e); }
      // [#5] Persistir la imagen ENTRANTE (aunque sea ilegible o la visión falle) para que el operador la vea. Fire-and-forget.
      saveMedia({ phone: raw?.from, direction: 'inbound', mediaType: 'image', mimeType: mime,
        filename: `inbound_${raw?.from || 'wa'}_${mediaId}.jpg`, buffer, waMediaId: mediaId,
        aiDescription: (desc && desc !== '[Imagen no legible]') ? desc : '[imagen recibida]' }).catch(() => {});
      // [B1 2026-06-25] Adjuntar la imagen al Deal de Zoho CRM si ya existe (no force-crea). Fire-and-forget.
      attachInboundToDeal(raw?.from, buffer, `inbound_${raw?.from || 'wa'}_${mediaId}.jpg`, mime).catch(() => {});
      // [F3b] '[Imagen no legible]' NO es contenido válido → cae al fallback que pide
      // describir por texto (evita pasar una no-descripción como medidas reales).
      if (desc && desc !== '[Imagen no legible]') {
        return {
          userText: `[El cliente envió una imagen. Contenido detectado]: ${desc}`,
          mediaResolved: true,
        };
      }
    } catch (err) {
      log('error', 'media.image', err);
    }
    return {
      userText:
        'El cliente envió una imagen que no se pudo procesar. Pídale, de forma amable, ' +
        'que describa por texto el tipo de ventana, las medidas, la cantidad y el color.',
      mediaResolved: false,
    };
  }

  if (type === 'audio') {
    const raw = rawMessage(body);
    const mediaId = raw?.audio?.id;
    if (!mediaId) return { userText: text, mediaResolved: false };
    try {
      const { buffer, mime } = await downloadWaMedia(mediaId, deps);
      // [#5-robustez 2026-06-21] STT puede fallar (ej: sin saldo OPENAI_API_KEY). Aislamos la
      // transcripción → el saveMedia de abajo SIEMPRE corre (el operador escucha el audio aunque la IA esté caída).
      let transcript = '';
      try { transcript = await (deps.transcribeAudio || transcribeAudio)(buffer, mime, deps); }
      catch (e) { log('error', 'media.audio.stt', e); }
      // [#5] Persistir el audio ENTRANTE + su transcripción para el cockpit. Fire-and-forget.
      saveMedia({ phone: raw?.from, direction: 'inbound', mediaType: 'audio', mimeType: mime,
        filename: `inbound_${raw?.from || 'wa'}_${mediaId}.ogg`, buffer, waMediaId: mediaId,
        transcription: transcript || '', aiDescription: transcript || '[audio recibido]' }).catch(() => {});
      // [B1 2026-06-25] Adjuntar el audio al Deal de Zoho CRM si ya existe (no force-crea). Fire-and-forget.
      attachInboundToDeal(raw?.from, buffer, `inbound_${raw?.from || 'wa'}_${mediaId}.ogg`, mime).catch(() => {});
      if (transcript) return { userText: transcript, mediaResolved: true };
    } catch (err) {
      log('error', 'media.audio', err);
    }
    return {
      userText:
        'El cliente envió un audio que no se pudo transcribir. Pídale, de forma amable, ' +
        'que escriba su consulta por texto.',
      mediaResolved: false,
    };
  }

  // [#5] Documento entrante: persistir para el cockpit. Si es EXCEL con lista de ventanas → LEERLO y cotizar.
  if (type === 'document') {
    const raw = rawMessage(body);
    const mediaId = raw?.document?.id;
    const fn = raw?.document?.filename || `inbound_${raw?.from || 'wa'}_${mediaId}.bin`;
    if (mediaId) {
      try {
        const { buffer, mime } = await downloadWaMedia(mediaId, deps);
        saveMedia({ phone: raw?.from, direction: 'inbound', mediaType: 'document', mimeType: mime,
          filename: fn, buffer, waMediaId: mediaId, aiDescription: `Documento/plano entrante: ${fn}` }).catch(() => {});
        // [B1 2026-06-25] Adjuntar el documento al Deal de Zoho CRM si ya existe (no force-crea). Fire-and-forget.
        attachInboundToDeal(raw?.from, buffer, fn, mime).catch(() => {});
        // [2026-06-22 FIX] Si es Excel, LEER la lista de ventanas y cotizar (antes: pedía reescribir a mano → se perdían clientes).
        const esExcel = /\.xlsx?$/i.test(fn) || /spreadsheet|excel/i.test(mime || '');
        if (esExcel && buffer) {
          try {
            const parsed = parseExcelWindows(buffer);
            if (parsed.ok && parsed.items.length) {
              log('info', 'media.document.excel', `parseadas ${parsed.items.length} ventanas de ${fn}`);
              return { userText: parsed.promptText, mediaResolved: true };
            }
            log('info', 'media.document.excel', `no se pudo extraer lista (${parsed.reason || 'desconocido'}) — fallback a pedir texto`);
          } catch (e) { log('error', 'media.document.excel', e); }
        }
      } catch (err) { log('error', 'media.document', err); }
    }
    return {
      userText:
        'El cliente envió un documento/plano. Pídale, de forma amable, que confirme por texto el tipo de ventana, ' +
        'las medidas (ancho x alto), la cantidad y el color de cada una para poder cotizar.',
      mediaResolved: false,
    };
  }

  // text / button / interactive → ya viene resuelto por parseInbound.
  return { userText: text, mediaResolved: false };
}

/* =========================================================================
 * LOGGING simple (no rompe nunca).
 * ========================================================================= */
function log(level, ctx, msg) {
  const fn = level === 'error' ? console.error : console.log;
  const detail = msg && msg.stack ? msg.stack : msg;
  fn(`[oliver-gpt/webhook] ${ctx}:`, detail);
}

/* =========================================================================
 * Helpers de persistencia (cableado REAL a salesOsBridge).
 * Cada uno traga su propio error: la persistencia NUNCA debe tumbar el turno.
 * ========================================================================= */
async function safe(label, fn) {
  try {
    return await fn();
  } catch (err) {
    log('error', label, err);
    return null;
  }
}

const ATTRIBUTION_STATE_KEYS = [
  'ctwa_clid', 'ad_id', 'gclid', 'fbclid', 'ttclid',
  'landing_lead_id', 'landingRefCaptured', 'ctwaCaptured',
];

// Copia solo valores presentes: un fetch parcial nunca borra atribucion ya persistida.
function copyAttributionState(target, source) {
  if (!target || typeof target !== 'object' || !source || typeof source !== 'object') return target;
  for (const key of ATTRIBUTION_STATE_KEYS) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') target[key] = value;
  }
  return target;
}

// Extrae la primera cotización calculada de los toolCalls del turno (si la hay).
function extractQuote(toolCalls = []) {
  for (const tc of toolCalls) {
    if (
      (tc.name === 'calcular_cotizacion' || tc.name === 'calcular_por_area') &&
      tc.result &&
      tc.result.ok !== false
    ) {
      return tc.result;
    }
  }
  return null;
}

/* =========================================================================
 * HANDLER PRINCIPAL
 * ========================================================================= */

/**
 * handleWebhook — Entrypoint del webhook de WhatsApp para Oliver GPT.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {object} [deps] - Dependencias inyectables (tests herméticos). Cada
 *   una cae a la implementación real si no se provee:
 *   { parseInbound, sendWhatsAppText, handleTurn, bridge, notifyHighValue,
 *     getClient, describeImage, transcribeAudio, toFile, fetchFn,
 *     loadSession, persistSession,
 *     conv (Map), seen (Set), rateMap (Map), locks (Map) }.
 */
/**
 * [2026-08-08] Datos del cerebro que respondió, listos para meter en metadata.
 * Se lee JUSTO después del turno. Si no hay dato (el turno no llamó al modelo: comando
 * determinista, takeover, PDF por código), devuelve {} y la metadata queda como antes.
 */
function proveedorDelTurno() {
  try {
    const p = ultimoProveedor();
    if (!p || !p.proveedor) return {};
    return {
      cerebro: p.proveedor,
      cerebro_respaldo: p.fue_respaldo === true,
      ...(p.fue_respaldo && p.motivo ? { cerebro_motivo: p.motivo } : {}),
    };
  } catch { return {}; }
}

export async function handleWebhook(req, res, deps = {}) {
  // ── (1) ACK INMEDIATO a Meta. Nada antes de esto puede lanzar. ──────────
  try {
    res.sendStatus(200);
  } catch (err) {
    // Si ni siquiera podemos ackear, logueamos y seguimos: no hay 500 útil.
    log('error', 'ack', err);
  }

  // ── (2..9) Todo el procesamiento envuelto: NUNCA relanza tras el 200. ───
  // releaseLock declarado AQUÍ (fuera del try) para que el finally lo libere
  // SIEMPRE, ante cualquier return intermedio o excepción (ajuste abogado).
  let releaseLock = null;
  // [2026-08-08] Mismo motivo que releaseLock: declarado FUERA del try para que el finally
  // corte el "escribiendo…" ante cualquier return intermedio o excepción. Si no, el cliente
  // ve a Oliver "escribiendo" hasta que Meta lo apaga a los 25 s — peor que no mostrarlo.
  let _detenerEscribiendo = () => {};
  // [2026-08-08] Mismo motivo que releaseLock: el finally tiene que verlas. Si el turno se
  // cae después de emitir el PDF, la atribución ya se gastó y hay que borrarla igual — si
  // no, la cotización siguiente se le carga al cliente equivocado.
  let atribucionConsumida = false;
  let _fromParaAtribucion = '';
  try {
    const parseInbound    = deps.parseInbound    || realParseInbound;
    // [2026-08-08] conPausaHumana: espera lo que un humano tardaría en tipear ese texto
    // antes de mandarlo. Se envuelve ACÁ, en la constante local, porque los ~15 puntos de
    // envío del handler pasan todos por ella — un solo wrap los cubre a todos.
    // Un cliente notó que era IA "porque contestaron en el mismo momento". Ver
    // services/presenciaHumana.js. Apagable con OLIVER_PRESENCIA_HUMANA=false.
    const sendWhatsAppText = conPausaHumana(deps.sendWhatsAppText || realSendWhatsAppText);
    // [2026-08-08] SIN pausa: para lo que NO va a un cliente. Las alertas de
    // notifyHighValue van al celular de Marcelo (OWNER_PHONE, ver
    // services/highValueNotifier.js:241) — simular que un humano las tipea le retrasa
    // 5-6 s un aviso urgente sin engañar a nadie. (P2 de Codex, 2026-08-08.)
    const enviarSinPausa = deps.sendWhatsAppText || realSendWhatsAppText;
    const uploadWaAudio   = deps.uploadWaAudio   || realUploadWaAudio;
    const sendWaAudio     = deps.sendWaAudio     || realSendWaAudio;
    const uploadWaDocument = deps.uploadWaDocument || realUploadWaDocument;
    const sendWaDocument   = deps.sendWaDocument   || realSendWaDocument;
    const generatePdf      = deps.generatePdf      || realGeneratePdf;
    // [2026-08-31] El pricer, INYECTABLE. Las tres propuestas por color exigen re-cotizar en
    // el motor una vez por color (el precio de un Nogal NO se puede derivar del blanco), y sin
    // poder inyectarlo esa rama no se podia probar sin pegarle a produccion. Los dos usos
    // viejos (blindaje label↔precio y termico) se dejan como estaban a proposito: son codigo
    // que cobra y no necesitan el cambio.
    const priceAllFn       = deps.priceAllEngine   || priceAllEngine;
    const upsertZohoDeal   = deps.upsertZohoDeal   || realUpsertZohoDeal;
    const addZohoNote      = deps.addZohoNote      || realAddZohoNote;
    const attachPdfToDeal  = deps.attachPdfToDeal  || realAttachPdfToDeal;
    const shouldSendVoice = deps.shouldSendVoice || realShouldSendVoice;
    const synthesizeVoiceBuffer = deps.synthesizeVoiceBuffer || realSynthesizeVoiceBuffer;
    const handleTurn      = deps.handleTurn      || realHandleTurn;
    const bridge          = deps.bridge          || realBridge;
    const notifyHighValue = deps.notifyHighValue  || realNotifyHighValue;
    const loadSession     = deps.loadSession     || realLoadSession;
    const persistSessionFn = deps.persistSession  || realPersistSession;
    const conv  = deps.conv  || CONV;
    const seen  = deps.seen  || SEEN;
    const rateMap = deps.rateMap || RATE_MAP;
    const locks   = deps.locks   || LOCKS;

    // ── (2) Parse + validación + idempotencia ───────────────────────────
    const inbound = parseInbound(req.body);
    // ── 🔴 (2b) LOS ACUSES DE META ─────────────────────────────────────────
    // Meta responde 200 cuando ACEPTA el envio, no cuando el cliente lo recibe. El
    // resultado real llega aca despues: sent → delivered → read, o `failed` con el motivo.
    // Se descartaban sin leerlos, asi que el sistema no podia distinguir un documento
    // entregado de uno rechazado — y la base decia "entregado" con hora mientras el
    // cliente no tenia nada.
    //
    // Solo se actua sobre los DOCUMENTOS (propuesta e informe), que son los que importan y
    // los unicos que dejamos rastreados: un texto suelto que falla lo arregla el proximo
    // mensaje, un PDF que no llego no se arregla solo.
    const acuses = (deps.parseStatuses || realParseStatuses)(req.body);
    if (acuses.length) {
      for (const ac of acuses) {
        if (!ac.fallo) continue;
        await safe('acuse.fallo', async () => {
          const rastro = await (deps.leerEstado || leerEstado)(`wamsg:${ac.msgId}`);
          if (!rastro) return;               // no lo rastreabamos: no hay nada que decir

          // 🔴 [Codex, revision final] EL ACUSE TIENE QUE SER DEL MISMO DESTINATARIO.
          // Se buscaba por msgId y despues se confiaba en el telefono guardado. Un acuse
          // cruzado actuaba sobre los candados y la conversacion de un cliente que no era.
          // Meta dice a quien fue en `recipient_id`: se compara.
          const soloDigitos = (x) => String(x || '').replace(/\D/g, '');
          if (ac.telefono && rastro.telefono
              && soloDigitos(ac.telefono) !== soloDigitos(rastro.telefono)) return;

          // 🔴 [Codex, revision final] EL RASTRO SE CONSUME. Meta reintrega los webhooks,
          // asi que el mismo `failed` llega varias veces; sin consumirlo, cada copia
          // generaba su evento, su aviso a Marcelo y su borrado de candado. Se borra ANTES
          // de actuar: repetir un aviso es ruido, pero repetir el borrado del candado le
          // manda un segundo informe al cliente.
          try { (deps.borrarEstado || borrarEstado)(`wamsg:${ac.msgId}`); }
          catch { /* si no se puede consumir, el peor caso es un aviso repetido */ }

          // 🔴 [Codex, revision final] Y NO SE TOCA EL CANDADO DE UN ENVIO MAS NUEVO.
          // Secuencia real: falla el envio A, se reintenta, el B SI llega y deja su candado
          // puesto, y recien ahi aparece el acuse tardio de A. Borrar el candado por ese
          // fallo viejo le manda un segundo informe al cliente. Solo actua el acuse del
          // ULTIMO envio registrado.
          let esElVigente = true;   // ¿este envio sigue siendo el ultimo, o ya fue reemplazado?
          if (rastro.telefono) {
            try {
              const ultimo = await (deps.leerEstado || leerEstado)(
                `${rastro.tipo}:${String(rastro.telefono).replace(/\D/g, '')}:ultimo_msg`);
              if (ultimo && ultimo !== ac.msgId) esElVigente = false;
            } catch { /* sin dato se asume vigente: es el caso normal */ }
          }
          // 🔴 [Codex, revision final] Si el envio YA FUE REEMPLAZADO por uno posterior, no
          // se avisa nada: el evento y el aviso decian "reenviarlo" y Marcelo terminaba
          // mandando de nuevo un documento que el cliente ya tenia.
          if (!esElVigente) {
            log('info', 'acuse.obsoleto', `acuse tardio de ${rastro.folio || ac.msgId}: ya fue reemplazado`);
            return;
          }

          const que = rastro.tipo === 'informe_termico' ? 'Informe térmico' : 'Propuesta';
          const detalle = ac.motivo || `código ${ac.codigo ?? 'desconocido'}`;

          // 1. Que se vea en la conversacion, al lado del "enviado" que quedo mintiendo.
          await safe('acuse.espejo', () => bridge.pushConversationEvent({
            channel: 'whatsapp', external_id: rastro.telefono || ac.telefono,
            direction: 'outbound', actor_type: 'system', actor_name: 'WhatsApp',
            message_type: 'text',
            body: `⚠️ ${que} ${rastro.folio || ''} NO se entregó al cliente — ${detalle}`.replace(/\s+/g, ' '),
            metadata: { source: 'oliver_gpt_acuse', tipo: rastro.tipo, folio: rastro.folio || null,
              codigo: ac.codigo, motivo: ac.motivo, msg_id: ac.msgId },
          }));

          // 2. Si era el INFORME, soltar el candado de 30 dias. Sin esto el cliente queda
          //    un mes sin informe por un envio que nunca llego — el mismo bug que ya dejo
          //    a 4 clientes bloqueados.
          // Se sueltan LOS DOS candados: si solo se soltara el de 30 dias, el reintento
          // caeria dentro de los 5 min del corto, se descartaria, y no queda programado
          // para despues — el cliente igual se queda sin informe.
          if (rastro.tipo === 'informe_termico' && rastro.telefono && esElVigente) {
            // Se usa la clave que dejo el envio; si el rastro es viejo y no la trae, se cae a
            // la de siempre. Un rastro sin clave es de antes de este cambio, no un error.
            const base = rastro.clave
              || `informe_termico:${String(rastro.telefono).replace(/\D/g, '')}`;
            for (const k of [base, `${base}:en_curso`]) {
              try { (deps.borrarEstado || borrarEstado)(k); } catch { /* vence solo */ }
            }
          }

          // 3. Avisarle a Marcelo: un documento que no llego es una venta detenida.
          await safe('acuse.aviso', () => notifyHighValue(
            deps.sendWhatsAppText || realSendWhatsAppText, rastro.telefono || ac.telefono,
            { data: { telefono: rastro.telefono, folio: rastro.folio }, history: [] },
            `[whatsapp] ${que} ${rastro.folio || ''} NO se entregó (${detalle}) — reenviarlo desde el inbox`));

          log('warn', 'acuse.fallo', `${que} ${rastro.folio || ac.msgId} rechazado por Meta: ${detalle}`);
        });
      }
      return;   // un acuse no es un mensaje: nunca dispara un turno del bot
    }

    if (!inbound || !inbound.ok || !inbound.from) return;

    const { from, msgId, push_name } = inbound; // push_name = nombre de perfil WhatsApp (fallback de nombre del cliente)

    if (msgId) {
      if (seen.has(msgId)) {
        log('info', 'dedupe', `msgId repetido ignorado: ${msgId}`);
        return;
      }
      // [2026-08-08] El dedupe vivía SOLO en memoria y Railway lo borra en cada deploy:
      // si Meta reintregaba un mensaje justo después (lo hace durante varios minutos), el
      // cliente recibía la respuesta DUPLICADA. Se consulta el respaldo en Postgres solo
      // cuando el id no está en memoria — o sea, prácticamente solo tras un reinicio.
      // Fail-safe: si sales-os no responde, se degrada al comportamiento anterior.
      // Inyectable como todo lo demás en este handler: meterlo como global escondido rompió
      // 7 tests que comparten proceso y reusan el mismo msgId — y una dependencia que los
      // tests no pueden sustituir es una dependencia que nadie puede verificar.
      const leerEstadoFn = deps.leerEstado || leerEstado;
      let repetidoTrasReinicio = false;
      try { repetidoTrasReinicio = (await leerEstadoFn(`msg:${msgId}`)) === true; } catch { /* red caída */ }
      if (repetidoTrasReinicio) {
        log('info', 'dedupe', `msgId repetido tras redeploy, ignorado: ${msgId}`);
        return;
      }
      if (seen.size >= SEEN_MAX) seen.clear();
      seen.add(msgId);
      // 15 min cubre de sobra la ventana de reintentos de Meta sin llenar la tabla.
      (deps.escribirEstado || escribirEstado)(`msg:${msgId}`, true, 15 * 60);
    }

    // ── (2b) MUTEX — adquirir lock antes de cualquier I/O. Serializa ─────
    // mensajes concurrentes del mismo número (doble-tap). El release se llama
    // siempre en el bloque finally al final del handler.
    releaseLock = await acquireLock(from, locks);

    // ── (2c) RATE-LIMIT — 18 msg/min por waId ───────────────────────────
    const rate = rateOk(from, rateMap);
    if (!rate.ok) {
      log('info', 'rate_limit', `Rate exceeded para ${from}`);
      // Aviso amigable al cliente; no procesa el turno.
      await safe('rate.send', () => sendWhatsAppText(from, rate.msg));
      return; // el finally libera el lock
    }

    // ── (3) Conversation control — respetar takeover humano ──────────────
    // Default seguro: ante fallo del control, getConversationControl ya
    // devuelve { ai_paused:false } (no bloquea). Solo pausamos si lo dice
    // explícitamente.
    const control = await safe('control', () => bridge.getConversationControl(from, 'whatsapp'));
    // [FIX 2026-06-19 CON-02] Fail-CLOSED hacia el operador: si la lectura del control falló
    // (sales-os caído / _error) y la última vez vimos takeover humano, NO respondemos encima del
    // operador (antes: fail-OPEN → el bot pisaba la negociación y arruinaba el cierre). Idéntico a channel-agent.js.
    let effectiveControl = control;
    if (!control || control._error) {
      const cached = CONTROL_CACHE.get(from);
      if (cached && (cached.ai_paused === true || (cached.operator_status && cached.operator_status !== 'ai'))) {
        effectiveControl = { ai_paused: true, operator_status: cached.operator_status || 'human', _fromCache: true };
        log('info', 'control.failclosed', `control no disponible; respeto takeover cacheado para ${from}`);
      }
    } else {
      CONTROL_CACHE.set(from, { ai_paused: control.ai_paused === true, operator_status: control.operator_status || 'ai' });
      if (CONTROL_CACHE.size > 5000) CONTROL_CACHE.clear();
    }
    const aiPaused =
      !!effectiveControl &&
      (effectiveControl.ai_paused === true ||
        (effectiveControl.operator_status && effectiveControl.operator_status !== 'ai'));

    if (aiPaused) {
      // Persistir el inbound para que el operador humano lo vea, y salir SIN
      // invocar a la IA (respetamos el takeover).
      await safe('control.persistInbound', () =>
        bridge.pushConversationEvent({
          channel: 'whatsapp',
          external_id: from,
          direction: 'inbound',
          actor_type: 'customer',
          actor_name: 'Cliente',
          message_type: inbound.type || 'text',
          body: inbound.text || '',
          metadata: { source: 'oliver_gpt_webhook', msg_id: msgId, ai_paused: true },
        })
      );
      // [FIX 2026-06-25 MEDIA-PAUSE] Capturar TAMBIÉN el adjunto cuando la IA está pausada (takeover humano).
      // BUG: este return salía ANTES de resolveUserText (↓ línea ~569) → downloadWaMedia + saveMedia NUNCA
      // corrían → el archivo del cliente se PERDÍA justo cuando un humano atiende (caso Nicolle: documento
      // mostrado como "no vinculable" en el cockpit). NO invoca la IA (respeta el takeover): solo descarga el
      // binario y lo persiste para que el operador lo vea. El ACK a Meta ya se envió arriba (res.sendStatus 200).
      // [REVISIÓN 2026-06-25] FIRE-AND-FORGET (SIN await): descargar el media puede tardar hasta ~27s (CDN Meta);
      // con await se retendría el lock del cliente y el operador vería sus mensajes siguientes con retraso. Se
      // dispara en background con su propio try/catch (safe) + los timeouts internos de downloadWaMedia.
      if (inbound.type === 'image' || inbound.type === 'audio' || inbound.type === 'document') {
        safe('control.captureMedia', async () => {
          const raw = rawMessage(req.body);
          const node = raw?.[inbound.type];            // raw.image / raw.audio / raw.document
          const mediaId = node?.id;
          if (!mediaId) return;
          const { buffer, mime } = await downloadWaMedia(mediaId, deps);
          const ext = inbound.type === 'image' ? 'jpg' : inbound.type === 'audio' ? 'ogg' : 'bin';
          const filename = node?.filename || `inbound_${from}_${mediaId}.${ext}`;
          await saveMedia({
            phone: from, direction: 'inbound', mediaType: inbound.type, mimeType: mime,
            filename, buffer, waMediaId: mediaId,
            aiDescription: `Adjunto recibido con IA pausada (operador): ${filename}`,
          });
          // [B1 2026-06-25] Adjuntar al Deal de Zoho CRM si ya existe (operador atendiendo un deal activo).
          attachInboundToDeal(from, buffer, filename, mime).catch(() => {});
        });
      }
      // [Ronda 2 2026-07-20] Capturar la atribución CTWA TAMBIÉN durante takeover: el primer
      // contacto pagado mientras un humano atiende salía por este return ANTES del bloque (4b)
      // y el ctwa_clid se perdía para siempre. Solo ingesta el lead (leads.ctwa_clid vía
      // COALESCE en sales-os); NO toca la sesión ni invoca la IA (respeta el takeover).
      // [Ronda 2.1 — Codex] CON await: fire-and-forget antes de un return podía morir con
      // un redeploy/crash inmediato y perder la captura (el ACK a Meta ya se envió arriba).
      // [Ronda 2.2 — Codex] tope de 5s: sin él, los retries del bridge retenían el mutex
      // del teléfono hasta ~21,5s y el operador veía el mensaje SIGUIENTE con retraso.
      // El POST típico cierra <1s; si excede el tope, el envío SIGUE en background (safe
      // no se cancela) y solo se libera el lock — degrada al comportamiento anterior.
      {
        const _capture = safe('control.ctwaCapture', () => {
          const _raw = rawMessage(req.body);
          const _ref = _raw ? (deps.parseReferral || parseReferral)(_raw) : null;
          if (_ref && _ref.isCtwaAd) {
            const _bridge = deps.bridge || realBridge;
            return _bridge.pushLeadEvent(
              (deps.buildCtwaLeadPayload || buildCtwaLeadPayload)(from, _ref, { name: '' })
            );
          }
        });
        let _capTimer = null;
        await Promise.race([
          _capture,
          new Promise((resolve) => { _capTimer = setTimeout(resolve, 5000); }),
        ]).finally(() => { if (_capTimer) clearTimeout(_capTimer); });
      }
      log('info', 'control', `IA pausada (takeover humano) para ${from}; inbound persistido`);
      return;
    }

    // ── (3a·bis) ¿ESTA COTIZACIÓN ES PARA OTRO? ─────────────────────────
    // [2026-08-08] Si el dueño escribió antes "CLIENTE Juan Pérez +569…", el lead y la
    // cotización de este turno se atribuyen a Juan, no a él. La CONVERSACIÓN sigue siendo
    // suya (pasó de verdad con él): lo que cambia es de quién es el cliente y la venta.
    // Solo aplica a su propio número; para cualquier otro es null y no cambia nada.
    const esDuenio = normalizarTel(from) === normalizarTel(process.env.OWNER_PHONE || process.env.ADMIN_PHONE || '56957296035');
    const atribucion = esDuenio ? obtenerAtribucion(from) : null;
    const telefonoCliente = atribucion?.phone || from;
    if (atribucion) {
      log('info', 'atribucion', `cotización atribuida a ${atribucion.phone} (${atribucion.name || 'sin nombre'}) en vez de ${from}`);
    }
    // [2026-08-08] La atribución se CONSUME al emitirse la propuesta formal, y recién ahí
    // se borra. Las 2 h quedan solo como tope de arriba.
    // Por qué: Gemini marcó que un plazo fijo es una trampa cuando el dueño atiende a tres
    // clientes en paralelo — cotiza para Juan, lo interrumpe Pedro, y la cotización de
    // Pedro se le carga a Juan. Consumir al cotizar hace que el comando valga para UNA
    // cotización, que es como el dueño lo va a usar de verdad.
    // No se borra al primer turno porque cotizar lleva varios (medidas, color, vidrio):
    // se borra cuando sale el PDF, que es el momento en que la cotización existe.
    _fromParaAtribucion = from;

    // [2026-08-08] Si esta persona estaba marcada como "cargada por el dueño y nunca nos
    // escribió", el hecho de que ESTÉ ESCRIBIENDO AHORA levanta la restricción: ya hay una
    // conversación iniciada por ella y el re-enganche pasa a ser normal. Sin esto, un
    // cliente cargado a mano quedaría bloqueado para siempre aunque después nos hablara.
    try { registrarQueNosEscribio(from); } catch { /* nunca puede tumbar el turno */ }

    // ── (3b) "escribiendo…" + doble check azul ──────────────────────────
    // [2026-08-08] Arranca ACÁ y no antes, a propósito: recién en este punto sabemos que
    // la IA VA a responder. Puesto antes del chequeo de takeover, un cliente atendido por
    // Marcelo veía a Oliver "escribiendo…" y el doble check azul, y no llegaba nada nunca
    // — peor que no mostrar nada. (P1 de Codex, 2026-08-08.)
    // Meta lo apaga solo a los 25 s; el loop lo refresca cada 18. El stop() va en el
    // finally del handler y aborta también cualquier POST en vuelo.
    // Nota: el mismo POST lleva status:"read" ⇒ también le deja el doble check azul.
    try { _detenerEscribiendo = mantenerEscribiendo(msgId); } catch { /* cosmético */ }

    // ── (4) HIDRATACIÓN DE SESIÓN — cache in-memory o Postgres ──────────
    //
    // Orden de prioridad:
    //   1) Cache caliente (conv.get(from)) si existe y tiene historial.
    //   2) Postgres vía GET /internal/wa-sessions/{from} (loadSession).
    //   3) Estado vacío si ambos fallan (fail-safe).
    //
    // Después de hidratar se aplica resetIfInactive: si el último mensaje
    // tiene >7 días, se limpia lockedData para evitar contaminación de
    // cotizaciones anteriores (F2-2).
    let cached = conv.get(from);
    if (!cached || !Array.isArray(cached.history) || cached.history.length === 0) {
      // Cache frío — intentar hidratar desde Postgres.
      const remote = await loadSession(from, deps);
      if (remote) {
        cached = remote;
        conv.set(from, cached); // poblar cache para el siguiente turno
        log('info', 'session.hydrated', `Sesión hidratada desde Postgres para ${from}`);
      }
    }
    const safeCache = cached || { history: [], state: {} };
    const history   = Array.isArray(safeCache.history) ? safeCache.history : [];
    const rawState  = safeCache.state && typeof safeCache.state === 'object' ? safeCache.state : {};
    // Reset por inactividad: limpia lockedData si >7 días sin actividad.
    const baseState  = resetIfInactive({ ...rawState, lastMessageAt: rawState.lastMessageAt || 0 });
    const state = {
      ...baseState,
      telefono: from,
      fecha: new Date().toISOString(),
      ctwa_clid: baseState.ctwa_clid || null,
      ad_id: baseState.ad_id || null,
      gclid: baseState.gclid || null,
      fbclid: baseState.fbclid || null,
      ttclid: baseState.ttclid || null,
    };
    // [Ronda 2 2026-07-20] Higiene: el flag one-shot del saludo JAMÁS debe venir hidratado
    // de Postgres (vive en variable local este turno). Si una versión vieja lo persistió,
    // se descarta acá — mata el "saludo tardío fantasma" señalado en revisión cruzada.
    delete state.ctwa_saludo_pending;

    // ── (4b) CTWA — Captura atribución Meta Ads (Click-to-WhatsApp). ────────
    // Solo en el primer mensaje con referral de la sesión (flag ctwaCaptured,
    // ya hidratado en state). Fire-and-forget vía safe(): no bloquea ni tumba.
    // Espeja index.js ~L4901-4913 usando el bridge probado (pushLeadEvent).
    // [tribunal 2026-07-18] El saludo por ángulo vive en variable LOCAL hasta justo
    // antes de handleTurn: así ningún early-return determinista (escalación, img-loop,
    // PDF) puede persistir el flag y resucitar el saludo en un turno posterior.
    let _ctwaSaludoTurn = null;
    try {
      const _rawMsg = rawMessage(req.body);
      if (_rawMsg) {
        const _ref = (deps.parseReferral || parseReferral)(_rawMsg);
        // [Ronda 2 2026-07-20] Re-atribución: un cliente que VUELVE clickeando OTRO anuncio
        // (ctwa_clid o ad_id distinto) refresca la atribución — antes ctwaCaptured congelaba
        // el click viejo para siempre y la cotización nueva se atribuía al anuncio antiguo
        // (hallazgo cruzado Codex). El saludo sigue gateado por history vacío más abajo:
        // el cliente antiguo NUNCA recibe re-saludo, solo se actualiza la atribución.
        const _refNuevo = _ref && _ref.isCtwaAd && (
          !state.ctwaCaptured ||
          (_ref.ctwaClid && _ref.ctwaClid !== state.ctwa_clid) ||
          (_ref.adId && String(_ref.adId) !== String(state.ad_id || ''))
        );
        if (_refNuevo) {
          state.ctwaCaptured = true;
          // [Ronda 2.1 — Codex] PRESERVAR el ID previo cuando el referral nuevo no lo trae:
          // un referral con solo ad_id nuevo NO debe pisar un ctwa_clid bueno con null
          // (regresión bloqueante reproducida en la revisión cruzada).
          state.ctwa_clid = _ref.ctwaClid || state.ctwa_clid || null;
          state.ad_id = _ref.adId || state.ad_id || null;
          const _bridge = deps.bridge || realBridge;
          const _payload = (deps.buildCtwaLeadPayload || buildCtwaLeadPayload)(
            from, _ref, { name: state.name || '' }
          );
          safe('ctwa.ingest', () => _bridge.pushLeadEvent(_payload));
          log('info', 'ctwa_attribution',
            `Lead CTWA capturado tel=${from} ad=${_ref.adId || '?'} clid=${_ref.ctwaClid ? 'sí' : 'no'}`);
          // [2026-07-18] Saludo por ángulo del anuncio (Ronda 1): Oliver abre coherente
          // con el anuncio que el cliente clickeó (anuncio→saludo→cotización).
          // Sin match/killswitch → saludo normal, cero cambio.
          // [tribunal] SOLO conversación NUEVA (history vacío): un cliente antiguo que
          // clickea el anuncio (retargeting) NO recibe el saludo frío a mitad de hilo
          // (violaría la ⛔ ANTI-RE-SALUDO). La atribución de arriba se captura igual.
          const _sal = (deps.saludoForReferral || saludoForReferral)(_ref);
          if (_sal) {
            state.ctwa_angle = _sal.angle; // persiste siempre: análisis/coherencia futura
            if (history.length === 0) {
              _ctwaSaludoTurn = _sal.saludo; // local: entra al state recién antes de handleTurn
              log('info', 'ctwa_saludo', `Saludo por ángulo '${_sal.angle}' para ${from}`);
            }
          }
        }
      }
    } catch (e) {
      log('error', 'ctwa.capture', e);
    }

    // ── (4c) LANDING REF — Atribución ORGÁNICA (landing V3 → wa.me con [Ref:uuid]). ──
    // [2026-07-02] El espejo del bloque CTWA de arriba, para SEO: las landings YA agregan el tag
    // al link de WhatsApp (injectRef v5.1.0) pero este tramo nunca se codeó → 0 leads orgánicos
    // atribuibles en toda la BD (auditoría). El tag se QUITA del texto ANTES de armar userText:
    // ni el cliente, ni el operador, ni el LLM lo ven jamás. El GET se comparte con los
    // consumidores de atribución; los POST auxiliares siguen fire-and-forget y fail-safe.
    let landingAttributionReady = Promise.resolve();
    try {
      if (inbound?.text && !state.landingRefCaptured) {
        const _lref = (deps.parseLandingRef || parseLandingRef)(inbound.text);
        if (_lref.hasRef) {
          state.landingRefCaptured = true;
          state.landing_lead_id = _lref.leadId;
          inbound.text = _lref.cleanText; // strip: el resto del pipeline no ve el tag
          const _bridge = deps.bridge || realBridge;
          const _cxmBase = (process.env.UNIFIED_CXM_BASE_URL || 'https://unified-cxm-ads-flow-production.up.railway.app').replace(/\/$/, '');
          const _apiKey = process.env.DASHBOARD_API_KEY || process.env.UNIFIED_CXM_DASHBOARD_API_KEY || '';
          landingAttributionReady = safe('landing_ref.context', async () => {
            // 1) contexto de la landing (slug/servicio/comuna) desde el collector del CXM
            let ctx = { lead_id: _lref.leadId };
            if (_apiKey) {
              try {
                const r = await fetch(`${_cxmBase}/api/lead-event/ref/${encodeURIComponent(_lref.leadId)}`, {
                  headers: { 'x-api-key': _apiKey }, signal: AbortSignal.timeout(4000),
                });
                if (r.ok) { const j = await r.json(); if (j?.lead || j?.ok) ctx = { ...ctx, ...(j.lead || j) }; }
              } catch (e) { log('error', 'landing_ref.fetch', e); }
            }
            copyAttributionState(state, ctx);
            safe('landing_ref.ingest', async () => {
              // 2) evento quote_started en landing_events (mismo collector público del beacon):
              //    "el lead ESCRIBIÓ a Oliver desde esta landing" — cierra leads_count por slug.
              try {
                await fetch(`${_cxmBase}/api/lead-event`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    lead_id: _lref.leadId, event_name: 'quote_started',
                    event_id: `oliver_wa_${_lref.leadId}`,
                    landing_slug: ctx.landing_slug || null,
                    landing_servicio: ctx.service || ctx.landing_servicio || null,
                    landing_comuna: ctx.comuna || ctx.landing_comuna || null,
                  }),
                  signal: AbortSignal.timeout(4000),
                });
              } catch (e) { log('error', 'landing_ref.event', e); }
              // 3) lead en sales-os con source=landing_organic (mismo bridge probado del CTWA)
              await _bridge.pushLeadEvent(
                (deps.buildLandingLeadPayload || buildLandingLeadPayload)(from, ctx, { name: state.name || '' })
              );
            });
          });
          log('info', 'landing_ref_attribution', `Lead ORGÁNICO capturado tel=${from} lead_id=${_lref.leadId}`);
        }
      }
    } catch (e) {
      log('error', 'landing_ref.capture', e);
    }

    // ── (5) MEDIA → userText útil (vision / STT). Resuelve la ceguera V2. ─
    const { userText, mediaResolved } = await resolveUserText(inbound, req.body, deps);
    if (!userText) {
      await landingAttributionReady;
      // [Ronda 2 2026-07-20] También persistir cuando la captura fue CTWA (antes solo
      // landing-ref): un primer mensaje de anuncio SIN texto útil (imagen sin caption con
      // visión caída) perdía el ctwa_clid recién capturado — reproducido en revisión cruzada.
      if (state.landingRefCaptured || state.ctwaCaptured) {
        const attributionOnly = { history, state: { ...state, lastMessageAt: Date.now() } };
        conv.set(from, attributionOnly);
        persistSessionFn(from, attributionOnly, deps);
      }
      return;
    }

    // ── (5a) [FIX 2026-06-19] Comando RESET — paridad con IG/FB (channel-agent.js). Limpia la
    //    sesión (cache + Postgres) → la próxima conversación arranca limpia, SIN re-saludo heredado.
    //    Antes WhatsApp NO tenía este comando → "reset" caía al cerebro y re-saludaba (visto en test en vivo).
    if (/^\s*reset(ear)?\s*$/i.test(userText)) {
      conv.delete(from);
      persistSessionFn(from, { history: [], state: {} }, deps);
      // [2026-08-26] RESET tambien suelta los candados del INFORME TERMICO (caso 0364: el
      // dueño probaba un "cliente nuevo" y el informe no salia por el candado de la prueba
      // anterior). No se borran claves (las huellas no se pueden enumerar): se deja un
      // marcador con fecha y `candadoVigente` ignora todo candado anterior a el.
      await safe('reset.informes', () => escribirEstado(
        `informe_reset:${String(from).replace(/\D/g, '')}`, Date.now(), 30 * 24 * 3600));
      const resetMsg = 'Listo, partimos de cero 🙌 ¿En qué te ayudo con tus ventanas?';
      await safe('reset.send', () => sendWhatsAppText(from, resetMsg));
      await safe('reset.persistIn', () => bridge.pushConversationEvent({
        channel: 'whatsapp', external_id: from, direction: 'inbound', actor_type: 'customer',
        actor_name: 'Cliente', message_type: inbound.type || 'text', body: userText,
        metadata: { source: 'oliver_gpt_webhook', msg_id: msgId, command: 'reset' },
      }));
      log('info', 'reset', `sesión ${from} reiniciada por comando del cliente`);
      return; // el finally libera el lock
    }

    // ── (5a1) [2026-08-30] RUT DEL RECEPTOR — captura DETERMINISTA ───────
    // Pedido del dueño: *"un cliente quiere que le agreguen el rut de la empresa o rut
    // persona; normalmente piden rut empresa con nombre de rut empresa o nombre de la
    // persona que la pide"*. Caso Alfredo Arias Luengo (conv 56952077379): reclamo CUATRO
    // veces y el PDF nunca tuvo donde ponerlo.
    //
    // VA ACA, ANTES DE TODO, por dos razones medidas:
    //  1. `state` es lo que leen `toolCtx.generarPdf` y la secuencia de informes DURANTE el
    //     turno. Si se capturara despues de handleTurn, el cliente que escribe "agregale mi
    //     RUT 77.448.504-K" recibiria la propuesta de ESTE turno todavia sin el RUT y habria
    //     que pedirle que la pidiera de nuevo — exactamente lo que enojo a Alfredo.
    //  2. Determinista y no via LLM: de 249 sesiones con actividad en 20 dias, solo 6 tenian
    //     `data.name` (el dato que hoy depende del modelo). Si el RUT se modelara como el
    //     nombre, correria la misma suerte.
    //
    // ⛔ NO MOLESTA A QUIEN NO LO PIDIO: `extraerReceptor` devuelve null cuando el cliente no
    // hablo de RUT, que es el 99 % de los mensajes (medido: 7 conversaciones de 782).
    // ⛔ Un RUT que no pasa modulo 11 NO se guarda: queda la marca `receptor_rechazado` para
    // que Oliver lo vuelva a pedir, y ningun documento lo ve nunca.
    {
      const _rut = extraerReceptor(userText, { previo: state.receptor });
      if (_rut && _rut.ok) {
        state.receptor = _rut.receptor;
        // Vive en el NIVEL SUPERIOR del state a proposito: `resetIfInactive` limpia
        // `lockedData` a los 7 dias y conserva el resto. El espejo en lockedData es para que
        // el prompt no lo vuelva a preguntar; que ese espejo caduque no borra el dato.
        state.lockedData = { ...(state.lockedData || {}), rut: _rut.receptor.rut };
        delete state.receptor_rechazado;
        log('info', 'receptor.rut', `RUT capturado para ${from} (${_rut.receptor.clienteTipo})`);
      } else if (_rut) {
        state.receptor_rechazado = { crudo: _rut.crudo, motivo: _rut.motivo, at: Date.now() };
        log('warn', 'receptor.rut', `RUT rechazado para ${from}: motivo=${_rut.motivo}`);
      }
    }

    // ── (5a2) [2026-07-06 LOTE2] ANTI-LOOP de imágenes ilegibles ─────────
    // Caso real (Flavio, 15 fotos en 2 min): la visión falló en TODAS y Oliver repitió ~14 veces
    // "no me llegan" (FALSO: sí llegan y quedan en el panel vía saveMedia). Determinista, antes del
    // cerebro. Racha: 1ª = flujo normal (el cerebro pide texto); 2ª = escalar UNA vez a Marcelo y
    // avisar honesto (la promesa "se las paso a Marcelo" SOLO si la escalación realmente salió —
    // notifyHighValue retorna {sent}); 3ª+ = acuse breve cada 5, silencio el resto (ya avisamos).
    // El lock por cliente serializa la ráfaga → el contador no corre riesgo de carrera.
    const esImagenIlegible = inbound.type === 'image' && mediaResolved === false;
    state.unreadable_streak = esImagenIlegible ? (Number(state.unreadable_streak) || 0) + 1 : 0;
    if (esImagenIlegible && state.unreadable_streak >= 2) {
      // [escéptico L2] SIEMPRE persistir el inbound en el timeline del panel (como reset/escalación) —
      // sin esto, las fotos de los turnos silenciosos desaparecen del hilo que el operador reconstruye.
      await safe('imgloop.persistIn', () => bridge.pushConversationEvent({
        channel: 'whatsapp', external_id: from, direction: 'inbound', actor_type: 'customer',
        actor_name: 'Cliente', message_type: 'image', body: '[imagen no legible por IA]',
        metadata: { source: 'oliver_gpt_webhook', msg_id: msgId, img_unreadable_streak: state.unreadable_streak },
      }));
      let imgLoopMsg = null;
      if (state.unreadable_streak === 2) {
        const esc = await safe('imgloop.notify', () =>
          notifyHighValue(enviarSinPausa, from, { data: { ...state }, history },
            'oliver_gpt:imagenes_ilegibles — el cliente mandó varias fotos que la IA no pudo leer; las fotos SÍ están guardadas en el panel (media), cotizar desde ahí'));
        imgLoopMsg = (esc && esc.sent)
          ? 'Sus fotos SÍ quedaron guardadas de mi lado 👍. Se las paso a Marcelo para que le prepare la propuesta desde ahí. Si prefiere avanzar al tiro, también puede escribirme las medidas por texto (ancho × alto y tipo).'
          : 'Sus fotos quedaron guardadas 👍. Para avanzar de inmediato, ¿me escribe las medidas por texto? (ancho × alto, tipo de ventana y cantidad).';
      } else if (state.unreadable_streak % 5 === 0) {
        imgLoopMsg = 'Recibida 👍, también quedó guardada para Marcelo.';
      }
      if (imgLoopMsg) {
        await safe('imgloop.send', () => sendWhatsAppText(from, imgLoopMsg));
        await safe('imgloop.persistOut', () => bridge.pushConversationEvent({
          channel: 'whatsapp', external_id: from, direction: 'outbound', actor_type: 'ai',
          actor_name: 'Oliver IA', message_type: 'text', body: imgLoopMsg,
          metadata: { source: 'oliver_gpt_webhook', img_unreadable_streak: state.unreadable_streak },
        }));
      }
      // Persistir el contador SIN pasar por el cerebro (el turno termina acá; el finally libera el lock).
      // [escéptico L2 — BLOQUEANTE] conv.set es OBLIGATORIO: el cache caliente gana sobre Postgres en el
      // próximo webhook — sin esto la racha se congelaba en 2 y se repetía el mensaje en cada foto
      // (el MISMO síntoma que este bloque arregla). + lastMessageAt como en el guardado normal.
      await landingAttributionReady;
      state.lastMessageAt = Date.now();
      conv.set(from, { history, state });
      persistSessionFn(from, { history, state }, deps);
      log('warn', 'imgloop', `racha de imágenes ilegibles=${state.unreadable_streak} para ${from}${imgLoopMsg ? '' : ' (silencio deliberado)'}`);
      return;
    }

    // ── (5b) ESCALACIÓN DETERMINISTA (no depende del LLM) ────────────────
    // [2026-06-18] Paridad con IG/FB (channel-agent.js): si el cliente pide humano/Marcelo
    // o está molesto, avisamos SIEMPRE + mensaje fijo correcto. En prod el LLM a veces NO
    // escalaba o respondía 'notificar_marcelo' como texto. La escalación es plata/reputación:
    // se maneja en CÓDIGO, no en el LLM. Mismo módulo compartido que IG/FB.
    const escalationTemplateFn = deps.sendEscalationTemplate || sendEscalationTemplate;
    if (isEscalationRequest(userText)) {
      await safe('escalate.notify', () =>
        notifyHighValue(enviarSinPausa, from, { data: { ...state }, history },
          'cliente pidió hablar con un humano / molesto'));
      await safe('escalate.template', () =>
        escalationTemplateFn(state.name || '', 'cliente pide hablar con humano'));
      const escMsg = escalationMessage();
      await safe('escalate.send', () => sendWhatsAppText(from, escMsg));
      await safe('escalate.persistIn', () => bridge.pushConversationEvent({
        channel: 'whatsapp', external_id: from, direction: 'inbound', actor_type: 'customer',
        actor_name: 'Cliente', message_type: inbound.type || 'text', body: inbound.text || userText,
        metadata: { source: 'oliver_gpt_webhook', msg_id: msgId, escalation: true },
      }));
      await safe('escalate.persistOut', () => bridge.pushConversationEvent({
        channel: 'whatsapp', external_id: from, direction: 'outbound', actor_type: 'ai',
        actor_name: 'Oliver', message_type: 'text', body: escMsg,
        metadata: { source: 'oliver_gpt_webhook', escalation: true },
      }));
      await landingAttributionReady;
      const escHist = [...history, { role: 'user', content: userText }, { role: 'assistant', content: escMsg }];
      const escStore = { history: escHist.length > MAX_HISTORY ? escHist.slice(-MAX_HISTORY) : escHist,
                         state: { ...state, lastMessageAt: Date.now() } };
      conv.set(from, escStore);
      persistSessionFn(from, escStore, deps);
      log('info', 'escalate', `escalación determinista para ${from}`);
      return; // el finally libera el lock
    }

    // ── 🔴 [2026-08-24] EL INFORME TERMICO SE DESPACHA AL FINAL DEL TURNO ──────────────
    //
    // Antes se disparaba DENTRO de `calcular_cotizacion`. Como esa tool cotiza UNA partida
    // por llamada, un proyecto de ocho ventanas son ocho disparos, y habia que reconstruir
    // el proyecto desde N invocaciones sueltas con memoria compartida entre ellas. Toda la
    // maquinaria que eso exigia —candado corto, fusion atomica del estado, sello de tanda,
    // barrera de estabilizacion por tiempo— existia SOLO para compensar el lugar del
    // disparo, y cada arreglo destapaba una carrera nueva en otro lado: cuatro pasadas de
    // compuerta cruzada, cuatro veredictos NO APTO, siempre por lo mismo.
    //
    // El turno es secuencial y termina en un instante conocido. Acumulando en memoria del
    // turno y despachando UNA vez al final, las carreras no se mitigan: DEJAN DE EXISTIR.
    // No hay dos ejecuciones que coordinar, no hay que adivinar cuantos segundos esperar a
    // que "deje de crecer", y una tool lenta no puede quedarse afuera porque el turno
    // espera a sus propias tools.

      // [2026-08-27 · #524] Devuelve una promesa con el RESULTADO ('enviado' | 'ya_enviado' |
      // 'en_curso' | 'fallo' | null si algo lanzó): la secuencia informe-primero necesita
      // saber qué pasó para decidir si manda el video y cuándo suelta la propuesta. Los
      // llamadores fire-and-forget existentes no leen el retorno y no cambian en nada.
      // `mensajePrevio`: el mensaje de valor de la Variante B — solo se envía si el informe
      // VA a salir (pasó candados y comuna verificada); anunciar un informe que no viene
      // sería mentirle al cliente.
      const despacharInforme = (comuna, { forzar = false, glassLabel = '', uw = null, producto = '', ventanas = null, mensajePrevio = '', mensajePrevioCorto = '', quoteNumber = null, nombre = '', noDespuesDe = 0 } = {}) => {
        // 🔴 La clave del candado incluye la HUELLA del proyecto: mismo cliente + mismo
        // proyecto = un solo informe en 30 dias; cambia la comuna, el producto o el vidrio =
        // proyecto distinto y le corresponde el suyo.
        const _tel = String(from).replace(/\D/g, '');
        const _huella = huellaDelInforme({ comuna, producto, glassLabel });
        const clave = _huella ? `informe_termico:${_tel}:${_huella}` : `informe_termico:${_tel}`;
        return safe('informeTermico', async () => {
          // 🔴 [2026-08-24 · Codex, compuerta cruzada] LA MEMORIA VA ANTES QUE TODO CANDADO.
          // Primer intento la puse despues, y Codex cazo el agujero: si el cliente YA recibio
          // su informe (candado de 30 dias puesto) y despues RECOTIZA con otro vidrio, el
          // `return` del candado cortaba antes de guardar — la memoria se quedaba con el
          // vidrio VIEJO. Cuando ese cliente pidiera el informe de nuevo, se le declararia el
          // Uw de un vidrio que ya no es el suyo, en un documento firmado.
          //
          // El orden correcto sale de separar dos cosas que no son la misma: RECORDAR lo que
          // se cotizo es un registro, y ocurre siempre; MANDAR el informe es un envio, y
          // tiene candados. Un candado de envio no puede gobernar un registro.
          const claveDatos = `${clave}:datos`;
          let recordados = null;
          try { recordados = await (deps.leerEstado || leerEstado)(claveDatos); }
          catch { /* sin memoria el informe sale igual, solo sin el recuadro */ }
          // [2026-08-24] Escritura simple: el despacho ocurre UNA vez por turno, asi que
          // no hay dos ejecuciones compitiendo por esta clave. La version anterior usaba un
          // leer-calcular-escribir atomico (`fusionar`) porque las ocho cotizaciones de un
          // proyecto escribian aca en paralelo y se pisaban. Ya no escriben aca.
          const elegido = datosDelInforme({ glassLabel, uw, producto, ventanas }, recordados);
          ({ glassLabel, uw, producto, ventanas } = elegido.datos);
          if (elegido.recordar) {
            try {
              await (deps.escribirEstado || escribirEstado)(claveDatos, elegido.datos, 30 * 24 * 3600);
            } catch { /* la memoria es un lujo; el informe no depende de ella */ }
          }

          // `forzar` llega desde la tool enviar_informe_termico: si el cliente lo PIDE, se le
          // manda aunque ya lo tenga. El candado existe para no spamear, no para negarle algo
          // a alguien que lo esta pidiendo.
          let yaSeMando = false;
          if (!forzar) {
            try {
              const _candado = await (deps.leerEstado || leerEstado)(clave);
              const _resetAt = Number(await (deps.leerEstado || leerEstado)(`informe_reset:${_tel}`)) || 0;
              yaSeMando = candadoVigente(_candado, _resetAt);
            } catch { /* si el estado no se puede leer, se sigue */ }
          }
          if (yaSeMando) return 'ya_enviado';

          // 🔴 [2026-08-24] CANDADO CORTO CONTRA EL DUPLICADO. Medido en produccion: el
          // cliente 56990704777 recibio DOS informes identicos en el mismo minuto, y quedaron
          // dos folios (CM-FR-006-2026-0001 y -0002) del mismo segundo. La causa: entre que
          // arranca este bloque y que se marca el candado definitivo pasan ~40 s (el ritmo
          // humano), y en esa ventana una segunda cotizacion dispara el flujo de nuevo.
          //
          // El candado definitivo NO puede adelantarse: si se marcara antes del envio y el
          // envio fallara, el cliente se quedaria sin informe por 30 dias — que es
          // exactamente el bug que dejo a 4 clientes bloqueados hoy. Entonces van DOS:
          //   · este, CORTO (5 min): tapa la ventana del duplicado y, si el envio se cae,
          //     vence solo y el proximo turno reintenta;
          //   · el de 30 dias, que se sigue marcando SOLO tras entrega confirmada.
          //
          // 🔴 [2026-08-24 · SEGUNDA VUELTA] LA PRIMERA VERSION DE ESTE CANDADO NO SERVIA, Y
          // SE MIDIO: hacia `await leer(...)` y despues `await escribir(...)`. Cada `await`
          // cede el event loop, asi que las dos ejecuciones leian "libre" antes de que
          // ninguna marcara — y las dos mandaban. Los 4 informes de hoy (0001/0002 a un
          // cliente, 0003/0004 a otro) salieron por ese hueco, con 90 y 310 ms de diferencia:
          // ni cerca de los ~40 s de ritmo humano que el comentario de arriba suponia.
          //
          // La causa real no era el tiempo: son DOS `calcular_cotizacion` del MISMO turno,
          // una por ventana del proyecto. Se arregla con un test-and-set sin await adentro
          // (`reservar`), no alargando el TTL.
          const claveEnCurso = `${clave}:en_curso`;
          let tokenReserva = null;
          if (!forzar) {
            // 🔴 [Codex · 5a pasada] DOS NIVELES, porque `reservar` solo es atomico DENTRO
            // del proceso (su Map local). Durante un deploy conviven dos instancias y las
            // dos podian pasar el candado largo antes de que ninguna entregara.
            //
            // Este chequeo va al estado COMPARTIDO (Postgres) antes de la reserva local. No
            // es un lock distribuido —dos instancias que lean en el mismo instante siguen
            // pasando— pero reduce la ventana de los ~40 s que dura el envio al ida y vuelta
            // del KV. Se dice sin adornos: lo que garantiza el "una sola vez" a lo largo del
            // tiempo es el candado de 30 dias, no este.
            //
            // ⚠️ SOLO SE LEE, NO SE ESCRIBE. El primer intento marcaba `true` aca y despues
            // llamaba a `reservar`, que veia la clave ocupada... por uno mismo, y cortaba
            // SIEMPRE. Ocho tests en rojo y ningun informe saliendo. `reservar` ya persiste
            // su token en el KV compartido, asi que la marca compartida existe sin ayuda.
            try {
              if (await (deps.leerEstado || leerEstado)(claveEnCurso)) return 'en_curso';
            } catch { /* si el estado compartido no responde, manda la reserva local */ }
            try {
              tokenReserva = (deps.reservarEstado || reservarEstado)(claveEnCurso, 5 * 60) || null;
              if (!tokenReserva) return 'en_curso';
            } catch { /* si el estado no se puede reservar, se sigue: mejor duplicar que no mandar */ }
          }
          // [2026-08-27 · Codex/Gemini, compuerta #524] Si el mensaje de valor YA salio y el
          // informe despues se cae, hay que decirselo al cliente (no prometer y desaparecer).
          // [Copilot, re-pase] CON ESPEJO AL COCKPIT, como todo texto que sale a Meta: una
          // promesa rota que el operador no puede ver es el mismo defecto que motivo el
          // espejo del informe original.
          let valorEnviado = false;
          // Cuándo salió el mensaje de valor: ancla del PISO de ritmo (SEQ_TERMICO_MS).
          let valorEnviadoEn = 0;
          const avisarRecuperacion = () => safe('informeTermico.recuperacion', async () => {
            if (!valorEnviado) return;
            const rec = 'El informe me está tomando más de lo esperado; se lo hago llegar apenas esté listo. Mientras tanto, le dejo su propuesta.';
            const recEnviado = await enviarSinPausa(from, rec);
            if (recEnviado?.ok === true) {
              safe('informeTermico.espejo.recuperacion', () => bridge.pushConversationEvent({
                channel: 'whatsapp', external_id: from, direction: 'outbound',
                actor_type: 'ai', actor_name: 'Oliver', message_type: 'text',
                body: rec,
                metadata: { source: 'oliver_gpt_secuencia_informe' },
              }));
            }
          });
          // Si algo corta entre aca y el envio, la reserva se suelta: un candado que no se
          // puede soltar deja al cliente sin informe hasta que venza el TTL.
          //
          // 🔴 [Codex · compuerta] SE SUELTA CON TOKEN, no con un `borrar` pelado. La
          // secuencia que rompia el borrado ciego: esta ejecucion reserva · pasan los 5 min
          // y su reserva vence · OTRA cotizacion toma una reserva nueva y valida · recien
          // ahi esta falla y borra *la de la otra*, dejando la llave libre para una tercera.
          // El mecanismo de liberacion causaba el duplicado que el candado vino a matar.
          const liberar = () => {
            if (!tokenReserva) return;
            const mio = tokenReserva;
            tokenReserva = null;
            try { (deps.liberarReserva || liberarReserva)(claveEnCurso, mio); } catch { /* nada que hacer */ }
          };

          // 🔴 [Codex · compuerta] DE ACA PARA ABAJO, TODO VA EN try/finally. Las salidas por
          // `return` ya soltaban la reserva, pero una EXCEPCION no: si THERMAL, pdfkit o el
          // envio lanzaban, el candado quedaba puesto sin que nadie hubiera mandado nada —
          // cliente sin informe y reintento bloqueado hasta que venciera el TTL. Es el mismo
          // error que dejo a 4 clientes trabados 30 dias, en version corta.
          try {
          // Se pide la comuna del cliente; si THERMAL no la reconoce (pasa con los SECTORES:
          // Labranza, Cajon, Metrenco…) se cae a la referencia regional, anunciada como tal.
          const norm = normalizarComuna(comuna);
          // [2026-08-24] Inyectables: sin esto, TODO este camino —el que le manda un
          // documento firmado a un cliente— solo se podia probar leyendo el codigo fuente
          // con expresiones regulares. Un test de fuente ve si una linea existe; no ve si
          // el envio ocurre una vez, ninguna o dos, que es exactamente lo que fallo hoy.
          const pedirComunaFn = deps.pedirInformeComuna || pedirInformeComuna;
          let datos = norm ? await pedirComunaFn(norm) : null;
          let esRef = false;
          if (!datos) { datos = await pedirComunaFn(COMUNA_REFERENCIA); esRef = true; }
          if (!datos) { liberar(); return 'fallo'; }   // sin dato verificado no hay informe

          // [2026-08-27 · #524] EL MENSAJE DE VALOR (paso 3 de la Variante B). Va acá y no
          // antes: recién en este punto los candados pasaron y la comuna está verificada,
          // así que el informe VA a intentarse de verdad. El copy llega del llamador tal
          // cual fue aprobado (pasó el guardián de claims en la propuesta) — acá no se
          // redacta nada. El cliente lo lee mientras corren las consultas a THERMAL.
          // 🔴 [Codex, compuerta] Llega como FUNCIÓN de `esRef`: si la comuna cayó a la
          // referencia regional (Labranza, Cajón…), el copy NO puede prometer "el límite
          // para {comuna}" — el PDF va a declarar una referencia regional, y el mensaje
          // tiene que decir lo mismo que el documento.
          if (mensajePrevio) {
            // [Dueño, 28-ago — cazado en SU prueba de Toltén, textual: *"le dijo 2 veces lo
            // mismo al cliente cuando le agregué una ventana"*] Si el discurso completo ya
            // salió hace poco para este teléfono, va la VARIANTE CORTA que manda el llamador
            // (acá no se redacta copy). El registro vive en el KV compartido con TTL: un
            // cambio de proyecto a los 4 minutos no puede repetir el speech entero.
            const claveValor = `informe_valor:${_tel}`;
            // [Copilot+Codex, deuda ACEPTADA y declarada] leer-y-escribir no es atómico
            // entre DOS instancias (deploy conviviendo): en esa ventana el discurso
            // completo puede repetirse UNA vez. Dentro del proceso lo serializa el mutex
            // por teléfono del webhook. El costo del caso raro es texto repetido (el bug
            // de hoy), no candados ni documentos: no amerita un lock distribuido.
            let valorReciente = false;
            try { valorReciente = Boolean(await (deps.leerEstado || leerEstado)(claveValor)); }
            catch { /* sin memoria compartida: va el completo, que nunca es incorrecto */ }
            const fuenteValor = (valorReciente && mensajePrevioCorto) ? mensajePrevioCorto : mensajePrevio;
            // [Dueño, en caliente 27-ago] La función recibe TAMBIÉN los datos verificados de
            // la comuna: así el mensaje puede nombrar la zona térmica NCh 1079 — el mismo
            // dato que el PDF imprime, de la misma fuente.
            const textoValor = typeof fuenteValor === 'function' ? fuenteValor(esRef, datos) : fuenteValor;
            const mvEnviado = textoValor ? await enviarSinPausa(from, textoValor) : null;
            if (mvEnviado?.ok === true) {
              valorEnviado = true;
              valorEnviadoEn = Date.now();
              // La marca se pone tras CUALQUIER variante enviada: también la corta renueva
              // la ventana (dos cambios seguidos tampoco repiten el discurso largo).
              try { await (deps.escribirEstado || escribirEstado)(claveValor, { at: Date.now() }, 12 * 3600); }
              catch { /* sin marca, el peor caso es repetir el speech: el bug de hoy, no uno nuevo */ }
              safe('informeTermico.espejo.valor', () => bridge.pushConversationEvent({
                channel: 'whatsapp', external_id: from, direction: 'outbound',
                actor_type: 'ai', actor_name: 'Oliver', message_type: 'text',
                body: textoValor,
                metadata: { source: 'oliver_gpt_secuencia_informe' },
              }));
            }
          }

          // El catálogo de vidrios enriquece el informe, pero NO es obligatorio: si falla,
          // el informe sale igual sin esa sección.
          let vidrios = null;
          try {
            const rv = await fetch(`${process.env.THERMAL_API_URL || 'https://activa-thermal-production.up.railway.app'}/api/v1/vidrios`,
              { signal: AbortSignal.timeout(3000) });
            if (rv.ok) vidrios = (await rv.json())?.vidrios || null;
          } catch { /* opcional */ }

          // [2026-08-24] LAS ISOTERMAS DEL FEM. Pedido del dueño: *"tan pequeño sabiendo que
          // puedes pasarle el FEM al termopanel para ver la isoterma"*. THERMAL ya tenia las
          // figuras del corte real (isotermas cada 1 grado) aprobadas y firmadas, y no se
          // estaban usando. Tampoco es obligatorio: si THERMAL no contesta, van [] y el
          // informe sale sin figuras. Dos niveles de degradacion y ninguno rompe la venta.
          let laminas = null;
          try { laminas = await (deps.laminasParaInforme || laminasParaInforme)(); } catch { /* opcional */ }
          // [2026-08-24] La figura del TERMOPANEL (aluminio vs warm-edge): reemplaza al
          // catalogo de vidrios, que el dueno bajo ("genera desconfianza"). Hasta que
          // THERMAL deployee el perfil nuevo devuelve null y el informe sale sin ella.
          let termopanel = null;
          try { termopanel = await (deps.laminaTermopanel || laminaTermopanel)({ glassLabel }); } catch { /* opcional */ }

          // [2026-08-24] CORRELATIVO ISO (CM-FR-006), pedido ANTES de generar el PDF y
          // ESTAMPADO en el documento — el mismo procedimiento que la cotizacion (CM-FR-004).
          // Pedido del dueno, textual: "mismo procedimiento de la cotizacion, debe haber
          // registro". Si sales-os no contesta, fallback LOCAL con marca visible: un numero
          // fuera de secuencia se distingue en la auditoria, no se disfraza de correlativo.
          let numeroInforme = '';
          try {
            const sosUrl = (process.env.SALES_OS_URL || '').replace(/\/$/, '');
            const sosTok = process.env.SALES_OS_OPERATOR_TOKEN || '';
            if (sosUrl && sosTok) {
              const rn = await fetch(`${sosUrl}/internal/informes/next-number`, {
                method: 'POST',
                headers: { 'x-api-key': sosTok, 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenant_id: 'activa', telefono: String(from) }),
                // [P2 · Codex] 5 s, no 8: este tiempo corre ANTES del aviso, con el cliente
                // esperando en silencio. En el caso normal la llamada tarda <300 ms; el
                // timeout solo importa con sales-os caido, y ahi 3 s menos de mudez valen
                // mas que 3 s mas de esperanza.
                signal: AbortSignal.timeout(5000),
              });
              if (rn.ok) numeroInforme = (await rn.json())?.informe_number || '';
            }
          } catch { /* el fallback de abajo cubre */ }
          if (!numeroInforme) {
            // [P2 · Codex] fecha + reloj en base36 + 4 aleatorios: dos envios el mismo dia
            // no pueden colisionar ni con Math.random repetido.
            numeroInforme = `INF-LOCAL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString(36).toUpperCase().slice(-4)}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
          }

          // [2026-08-21] RITMO HUMANO, EN DOS TIEMPOS. Corrección del dueño: *"no olvidar que
          // hay que ser más humano, no puede ser inmediato — el informe debe verse real"*.
          // Nadie redacta un informe con citas normativas en seis segundos. Si aparece al
          // toque, se lee como autoresponder y se anula todo el trabajo de que parezca
          // preparado por un profesional.
          // Esto NO demora el precio: todo el bloque es fire-and-forget y la cotización
          // sigue su camino en paralelo.
          const nom = String(state.name || '').trim().split(/\s+/)[0];

          // TIEMPO 1 — el aviso. Explica la espera, que es lo que la vuelve tolerable: un
          // silencio largo sin explicación se lee como que el bot se colgó.
          // 🔴 [Gemini, compuerta #524] SI EL MENSAJE DE VALOR YA SALIÓ, EL AVISO SOBRA:
          // dos anuncios seguidos del mismo informe (el mensaje de valor y el aviso
          // clásico de abajo) delatan al bot. Se conserva el RITMO (las esperas y los
          // puntitos siguen igual); se calla solo el texto redundante.
          await esperarAntesDeEnviar({ dormir: deps.dormir || null, ms: DEMORA_AVISO_MS });
          const avisoTxt = `Deme un momento${nom ? `, ${nom}` : ''}: reviso qué exige la norma en `
            + `${esRef ? 'su zona' : datos.comuna} y le armo el informe.`;
          const avisoEnviado = valorEnviado ? null : await enviarSinPausa(from, avisoTxt);
          // 🔴 [2026-08-24] ESPEJO AL COCKPIT. `enviarSinPausa` habla con Meta pero NO
          // registra nada: este texto salia hacia el cliente y no existia para el operador.
          // Sin el, el documento de mas abajo aparece solo, sin la frase que lo anuncia.
          //
          // [Codex · 2a pasada] SOLO SI SALIO. La primera version ignoraba el resultado y
          // registraba igual: con Meta rechazando el texto, el operador veia en el cockpit
          // un mensaje que el cliente nunca recibio. Es el mismo error que ya se corrigio
          // para el documento, en el mensaje de al lado.
          // [Codex · 3a] `ok === true` y nada mas. Antes `undefined`/`null` contaban como
          // exito "por las dudas", y la regla del proyecto dice lo contrario: nada se
          // registra sin confirmacion. El emisor real siempre devuelve {ok:boolean}.
          if (avisoEnviado?.ok === true) {
          safe('informeTermico.espejo.aviso', () => bridge.pushConversationEvent({
            channel: 'whatsapp', external_id: from, direction: 'outbound',
            actor_type: 'ai', actor_name: 'Oliver', message_type: 'text',
            body: avisoTxt,
            metadata: { source: 'oliver_gpt_informe_termico', informe_number: numeroInforme },
          }));
          }

          // TIEMPO 2 — la elaboración, con los puntitos de "escribiendo…" vivos para que el
          // cliente VEA que hay alguien trabajando en vez de mirar una pantalla muerta.
          let detenerPuntitos = null;
          try { detenerPuntitos = mantenerEscribiendo(msgId); } catch { /* cosmético */ }
          try {
            await esperarAntesDeEnviar({ dormir: deps.dormir || null });
          } finally {
            try { if (typeof detenerPuntitos === 'function') detenerPuntitos(); } catch { /* cosmético */ }
          }

          // [2026-08-24] Ya no se relee nada aca: las ventanas llegan completas desde el
          // turno. Lo que habia antes —una barrera que esperaba a que el total "dejara de
          // crecer"— era una forma de adivinar cuando estaban todas, y no habia numero
          // correcto: 3 s de quietud contra una cotizacion que puede tardar 15 s.
          // [Dueño, en caliente 27-ago] "En el informe tampoco está el nombre del cliente":
          // en la secuencia informe-primero este bloque corre ANTES de que el turno persista
          // state.name — el nombre viaja por opción desde el llamador (el mismo clientName de
          // la propuesta). state.name queda de fallback para el camino clásico.
          // [2026-08-30] EL RUT DEL DESTINATARIO tambien en el informe. Hasta hoy el documento
          // identificaba al EMISOR (Activa Inversiones EIRL, RUT 76.486.825-0, en el aviso
          // legal) pero no al receptor: un informe "de uso exclusivo del destinatario" que no
          // puede decir quien es ese destinatario protege menos de lo que promete.
          // Ya validado por modulo 11; `{...{}}` no agrega nada ⇒ sin RUT el informe sale
          // identico a como salia antes de este cambio.
          // ⚠️ Se resuelve ACA ARRIBA y no dentro de la llamada a proposito: el bloque de
          // opciones lo vigila un test de FUENTE (informeTermico.cableado.test.js, "tramo 3")
          // que exige ver `ventanas,` cerca de la llamada. Un comentario largo metido en medio
          // lo empuja fuera de la ventana y pone el test en rojo sin que el codigo este mal.
          const _rcpInforme = receptorParaDocumento(state.receptor,
            { nombreFallback: nombre || state.name || '' }) || {};
          const pdfBuf = await (deps.generarInformeTermicoPdf || generarInformeTermicoPdf)(datos, {
            nombre: nombre || state.name || '', ..._rcpInforme,
            firma: FIRMA, esReferenciaRegional: esRef, vidrios, laminas, termopanel,
            numeroInforme,
            // Lo que hace que el informe sea de SU proyecto y no un catalogo.
            suVidrio: glassLabel, suUw: uw, suProducto: producto,
            // 🔴 [2026-08-24] EL PROYECTO ENTERO. Sin esta linea el hook recibia las ocho
            // ventanas y las tiraba: el PDF volvia a dibujar UNA sola, en singular.
            ventanas,
          });
          if (!pdfBuf) {
            liberar();
            // [Codex/Gemini, compuerta #524] Se prometió y no salió: se dice, no se desaparece.
            await avisarRecuperacion();
            return 'fallo';
          }


          // [Dueño, 28-ago: *"me entregó el informe térmico en el mismo momento... la idea
          // es que se vea más natural secuencial"*] PISO DE RITMO: entre el mensaje de
          // valor y el documento pasan al menos SEQ_TERMICO_MS. Solo agrega la espera que
          // FALTE (si generar ya tomó más que el piso, no suma nada), y solo en la
          // secuencia (valorEnviado): el camino clásico conserva su ritmo propio.
          // [Codex, re-pase] Y ACOTADO por el deadline del llamador (`noDespuesDe`): sin
          // el tope, un arranque lento + piso completo podía cruzar el techo de 120 s y
          // el térmico caía DESPUÉS del precio — el orden que la secuencia jura.
          if (valorEnviado && valorEnviadoEn) {
            const pisoMs = Number(deps.seqTermicoMs ?? SEQ_TERMICO_MS);
            const tope = Number(noDespuesDe) > 0 ? Number(noDespuesDe) - Date.now() : Infinity;
            const falta = Math.min(pisoMs - (Date.now() - valorEnviadoEn), tope);
            if (falta > 0) await esperarAntesDeEnviar({ dormir: deps.dormir || null, ms: falta });
          }

          // Reusa el mismo par upload+send que ya usa el PDF de la propuesta: subir el
          // documento a Meta y mandarlo por su media_id. Cero maquinaria nueva.
          const nombreArchivo = `Informe-Termico-${String(datos.comuna).replace(/\s+/g, '-')}.pdf`;
          const mediaId = await uploadWaDocument(pdfBuf, nombreArchivo);
          // 🔴 [P1 · Codex, compuerta 24-ago] `mediaId` NO prueba entrega: `sendWaDocument`
          // devuelve {ok:false} SIN lanzar cuando Meta rechaza. La version anterior marcaba
          // el candado y registraba la entrega igual — el cliente sin documento, el candado
          // puesto (sin reintento en 30 dias) y la "evidencia" ISO de algo que nunca salio.
          // Ahora TODO lo posterior exige envio.ok === true.
          let envio = null;
          if (mediaId) envio = await sendWaDocument(from, mediaId, nombreArchivo, `Informe térmico de ${datos.comuna}`);
          const entregado = Boolean(mediaId && envio && envio.ok === true);
          if (!entregado) {
            log('warn', 'informeTermico.envio',
              `el informe ${numeroInforme} NO se entrego (${envio?.error || 'sin mediaId'}) — sin candado y sin registro: el proximo turno reintenta`);
            // Se suelta la reserva corta: si no, el reintento que este log promete no
            // podria ocurrir hasta dentro de 5 minutos.
            liberar();
            // [Codex/Gemini, compuerta #524] Idem: el cliente ya leyó la promesa del
            // informe — si Meta lo rechazó, se le avisa antes de que llegue el precio.
            await avisarRecuperacion();
            return 'fallo';
          }
          // Se marca DESPUÉS de que salió DE VERDAD: si el envío falla, el próximo turno reintenta.
          // Con fecha: el candado solo vale si es posterior al ultimo RESET (candadoVigente).
          try { await (deps.escribirEstado || escribirEstado)(clave, { at: Date.now() }, 30 * 24 * 3600); }
          catch { /* no bloquea: el mensaje ya llegó */ }

          // El informe SALIO. Se suelta el token sin liberar la reserva: si el `finally` la
          // soltara ahora, se reabriria la ventana del duplicado justo despues de mandar.
          // De aca en adelante manda el candado de 30 dias.
          tokenReserva = null;

          // 🔴 [2026-08-24] RASTRO PARA EL ACUSE DE META. Meta contesta 200 al aceptar el
          // envio, no al entregarlo; el resultado real llega despues por el webhook con
          // este mismo `msgId`. Sin guardar a que documento corresponde, ese acuse no se
          // puede interpretar y un `failed` pasa desapercibido — que es como un informe
          // termino figurando "entregado" con hora mientras el cliente no tenia nada.
          try {
            await (deps.escribirEstado || escribirEstado)(`wamsg:${envio.msgId}`, {
              msgId: envio.msgId, tipo: 'informe_termico', folio: numeroInforme, telefono: String(from),
              // La clave viaja con el rastro: sin esto, un acuse de fallo intentaria soltar
              // `informe_termico:{tel}` y dejaria puesto el candado real (que ahora lleva
              // huella) — el cliente quedaria un mes sin informe por un envio que no llego.
              clave,
            }, 3 * 24 * 3600);              // 3 dias: los acuses de Meta llegan en minutos
            // Cual es el envio VIGENTE, para que un acuse tardio de uno anterior no suelte
            // el candado de este.
            await (deps.escribirEstado || escribirEstado)(
              `informe_termico:${String(from).replace(/\D/g, '')}:ultimo_msg`, envio.msgId, 3 * 24 * 3600);
          } catch { /* sin rastro solo se pierde el diagnostico, no el informe */ }

          // 🔴 [2026-08-24] ESPEJO AL COCKPIT — EL DEFECTO QUE HIZO PREGUNTAR "¿POR QUE NO
          // LLEGO EL INFORME?". Habia llegado: Meta acepto los PDF y la BD los tenia como
          // entregados. Pero `conversation_messages` no tenia NI UNA FILA del informe, asi
          // que en el cockpit no existia. La propuesta (CM-FR-004) si se ve, porque en
          // junio le pusieron este mismo espejo por el mismo motivo ("no está en ninguna
          // parte"); el informe nunca lo tuvo.
          //
          // Va DESPUES de confirmar la entrega, nunca antes: mostrarle al operador un
          // documento que Meta rechazo es la version cockpit de mentirle a la auditoria.
          safe('informeTermico.espejo', () => bridge.pushConversationEvent({
            channel: 'whatsapp', external_id: from, direction: 'outbound',
            actor_type: 'ai', actor_name: 'Oliver', message_type: 'document',
            body: `📄 Informe térmico ${numeroInforme} (${datos.comuna}) enviado al cliente`,
            metadata: {
              source: 'oliver_gpt_informe_termico',
              informe_number: numeroInforme, filename: nombreArchivo,
              media_id: mediaId, comuna: datos.comuna, es_referencia_regional: esRef,
            },
          }));

          // 🔴 [2026-08-25] EL INFORME ENTRA AL REGISTRO DE MEDIOS — QUE ES LO QUE LO ARCHIVA.
          //
          // La propuesta hace esto desde jun-2026 (mas abajo, en `generarPdf.storeMedia`) y por
          // eso termina en la carpeta COTIZACIONES de WorkDrive: `server.js` engancha el
          // archivado al INSERT de `media_attachments`, no al envio. Medido 2026-08-25 contra la
          // BD viva: 149 documentos salientes archivados desde que ese hook existe (07-ago), y
          // NINGUNO es un informe termico — porque el informe nunca pasaba por aca.
          //
          // Se entrego, se dejo nota en el Deal... y de la copia no quedaba nada: ni en Drive,
          // ni como adjunto del cliente en el cockpit. El bot tenia ademas su propio
          // `archivarEnWorkDrive`, que nunca subio un byte y hacia parecer que el tema estaba
          // resuelto; se elimino en este mismo commit para que no vuelva a confundir.
          //
          // ⚠️ `direction` y `mediaType` NO son decorativos: `isOutboundArchivable` (sales-os)
          // solo acepta 'document', y el hook solo mira `direction === 'outbound'`. Con otro
          // valor la fila entra a la BD y se queda ahi marcada 'skip:no-es-registro'.
          //
          // Va DESPUES de la entrega confirmada y en su propio `safe`: si sales-os no contesta,
          // el cliente ya tiene su informe y eso no se toca.
          safe('informeTermico.registro', async () => {
            // 🔴 EL NOMBRE DEL ARCHIVO LLEVA EL CORRELATIVO, Y NO ES UN DETALLE.
            // Al cliente se le manda `Informe-Termico-Temuco.pdf`, que se lee bien en el
            // telefono — pero ese nombre NO identifica nada: TODOS los informes de Temuco se
            // llaman igual. En la carpeta COTIZACIONES conviven con las cotizaciones, que si
            // son unicas (`${quoteNumber}.pdf`), y se suben con `override-name-exist:false`:
            // el segundo informe de Temuco quedaria indistinguible del primero, o directamente
            // no entraria. Un registro ISO que no se puede atribuir a un cliente no es registro.
            // Se le agrega el correlativo (CM-FR-006-2026-XXXX), que ya va impreso en la portada.
            // Lo que recibe el cliente NO cambia.
            const nombreParaElArchivo = numeroInforme
              ? nombreArchivo.replace(/\.pdf$/i, `-${numeroInforme}.pdf`)
              : nombreArchivo;
            await (deps.saveMedia || saveMedia)({
              phone:         from,
              direction:     'outbound',
              mediaType:     'document',
              mimeType:      'application/pdf',
              filename:      nombreParaElArchivo,
              buffer:        pdfBuf,
              // El mismo id con el que se envio: sin el, el link /api/v5/media/{id} del
              // cockpit da "not found" y el operador no puede abrir el PDF. Es el mismo
              // motivo por el que se le agrego a la propuesta en jun-2026.
              waMediaId:     mediaId,
              aiDescription: `Informe térmico ${numeroInforme} de ${datos.comuna}`,
            });
          });

          // 🔴 [2026-08-24] EL PDF SE ARCHIVA, COMO LA COTIZACION.
          // Reclamo del dueño, textual: *"yo abro el sistema y deberia estar guardado...
          // tiene que estar almacenado, al lado de la cotizacion"*. Tenia razon: del
          // informe solo quedaba el folio y un sha256. El PDF no se guardaba en ninguna
          // parte, asi que "¿le llego el informe?" era una pregunta que el sistema no podia
          // responder — y por eso se volvia una discusion. Un documento firmado entregado a
          // un cliente del que no queda copia tampoco resiste una auditoria ISO.
          //
          // Va DESPUES de la entrega confirmada (no se archiva lo que no salio) y en su
          // propio `safe`: el archivo es trazabilidad NUESTRA y el informe es del cliente.
          // Si Zoho esta caido, el cliente ya tiene su documento y eso no se toca.
          safe('informeTermico.zoho', async () => {
            // 🔴 [Codex, revision final] EL INFORME NO CREA NI ACTUALIZA EL DEAL: SE CUELGA
            // DEL QUE YA HIZO LA PROPUESTA.
            //
            // `upsertZohoDeal` arma el nombre con `items[0].producto_label` y reescribe la
            // descripcion. El informe le pasaba items con OTRA forma ({producto, medidas,
            // cantidad}), asi que el nombre caia al generico "Ventanas" y pisaba el bueno:
            // un documento secundario degradando el registro comercial del cliente. Ademas
            // buscar-y-crear no es atomico y podia terminar creando un Deal duplicado.
            //
            // Si la propuesta no dejo Deal, NO se archiva. Mejor sin copia que con un
            // registro a medias: el cliente ya tiene su informe igual.
            let dealId = null;
            try { dealId = await (deps.leerEstado || leerEstado)(`deal:${String(from).replace(/\D/g, '')}`); }
            catch { /* sin Deal no se archiva */ }
            if (!dealId) return;
            await addZohoNote(dealId,
              `Informe térmico entregado: ${numeroInforme}`,
              `PDF enviado al cliente por WhatsApp.
Comuna: ${datos.comuna}`
              + `${esRef ? ' (referencia regional)' : ''}`);
            await attachPdfToDeal(dealId, pdfBuf, nombreArchivo);
          });

          // [2026-08-24] REGISTRO ISO del informe ENTREGADO — despues del envio, nunca
          // antes (misma regla que el candado: registrar algo que no salio es mentirle a
          // la auditoria). El sha256 identifica el PDF byte a byte: si un dia hay disputa,
          // el archivo del telefono del cliente se contrasta contra el hash. Si el registro
          // falla se dice EN VOZ ALTA (la clase de silencio que ya nos costo 3 semanas en
          // costGuard), pero no se reintenta ni bloquea: el cliente ya tiene su informe.
          {
            try {
              const { createHash } = await import('node:crypto');
              const sosUrl = (process.env.SALES_OS_URL || '').replace(/\/$/, '');
              const sosTok = process.env.SALES_OS_OPERATOR_TOKEN || '';
              if (sosUrl && sosTok) {
                const rr = await fetch(`${sosUrl}/internal/informes/registrar`, {
                  method: 'POST',
                  headers: { 'x-api-key': sosTok, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    tenant_id: 'activa',
                    informe_number: numeroInforme,
                    telefono: String(from),
                    nombre: state.name || '',
                    comuna: datos.comuna,
                    es_referencia_regional: esRef,
                    vidrio: glassLabel,
                    uw,
                    producto,
                    perfil_lamina: termopanel?.perfil || null,
                    laminas_ids: Array.isArray(laminas?.laminas) ? laminas.laminas.map((l) => l.id).join(',') : null,
                    pdf_bytes: pdfBuf.length,
                    pdf_sha256: createHash('sha256').update(pdfBuf).digest('hex'),
                    // 🔴 [2026-08-26 · #393 del tablero] 30 informes seguidos salieron con
                    // quote_number NULL: este campo leia state.quoteNum / state.quote_number,
                    // que NO EXISTEN en ningun camino. El folio vive en state.last_quote
                    // (el rastro que escribe generarPdf al entregar la propuesta, un instante
                    // antes de despachar este informe). Medido en vivo: el informe 0030 se
                    // emitio en el MISMO segundo en que la quote 0365 ya estaba en la tabla.
                    // [Codex, compuerta #524] En la secuencia informe-primero el informe corre
                    // ANTES de que la propuesta escriba state.last_quote: el folio llega por
                    // opción desde el llamador (que ya lo tiene emitido). El fallback cubre
                    // el camino clásico, donde el rastro ya existe.
                    quote_number: quoteNumber ?? state?.last_quote?.quote_number ?? null,
                  }),
                  signal: AbortSignal.timeout(8000),
                });
                if (!rr.ok) log('warn', 'informeTermico.registro', `sales-os respondio ${rr.status}: el informe ${numeroInforme} salio SIN registro ISO`);
              } else {
                log('warn', 'informeTermico.registro', `sin SALES_OS_URL/token: el informe ${numeroInforme} salio SIN registro ISO`);
              }
            } catch (e) {
              log('warn', 'informeTermico.registro', `fallo el registro de ${numeroInforme}: ${e.message} — el cliente YA tiene su informe`);
            }
          }
          // [Codex, compuerta #524] 'enviado' = Meta ACEPTÓ el envío — el MISMO estándar
          // que usa docSent para la propuesta. La entrega real llega después por el acuse
          // (webhook de statuses) y su manejo ya existe (rastro wamsg + suelta de candado).
          return 'enviado';
          } finally {
            // Idempotente: si el informe se entrego, `tokenReserva` ya es null y esto no
            // hace nada. Solo actua cuando se salio sin haber mandado.
            liberar();
          }
        });
      };

    // ── (6) toolCtx cableado a servicios REALES ──────────────────────────
    const toolCtx = {
      telefono: from,

      // 🔴 [2026-08-26] LAS PALABRAS DEL CLIENTE VIAJAN HASTA EL MOTOR. Sin esto el motor
      // solo veia numeros y tenia que ADIVINAR si "220 x 200" era ancho x alto o al reves.
      // Paula lo habia escrito ("LAS MEDIDAS ESTAN ALTO POR ANCHO") y se le cotizo dado
      // vuelta igual, porque esa frase no llegaba a donde se decide.
      //
      // ⚠️ [Gemini, compuerta] SOLO EL PEDIDO ACTUAL, NO TODA LA CONVERSACION. Mandar el
      // historial completo abria un bug peor que el que arregla: si el cliente declaro
      // "alto por ancho" en una cotizacion de la semana pasada, una lista NUEVA que viene
      // en orden normal se daria vuelta por una frase vieja. Se toman los ULTIMOS 3
      // mensajes del cliente — alcanza para el caso real en que la declaracion va en un
      // mensaje y la lista en el siguiente, y no arrastra tandas anteriores.
      textoCliente: [
        ...(history || []).filter((m) => m && m.role === 'user').slice(-2).map((m) => String(m.content || '')),
        String(userText || ''),
      ].join('  '),

      // ── [2026-08-21] INFORME TÉRMICO ANTES DE LA COTIZACIÓN ──────────────────
      // Idea del dueño: mandarle al cliente el dato normativo de su comuna JUSTO
      // cuando Oliver empieza a calcular, "para que lo lea mientras le decimos
      // preparamos la propuesta". Cuando el precio llega, ya no llega solo.
      //
      // Se dispara desde calcular_cotizacion —el momento exacto en que el cliente
      // queda esperando— y NO desde el PDF, que ya es tarde.
      //
      // 🔒 TRES GUARDAS, porque esto le escribe a un cliente real:
      //   1. UNA SOLA VEZ por teléfono (candado de 30 días). Un informe repetido
      //      deja de ser un informe y pasa a ser spam.
      //   2. fire-and-forget: no se espera. La cotización no puede demorarse ni un
      //      milisegundo por esto — es la regla dura del proyecto.
      //   3. si THERMAL no responde o no hay dato verificado, NO se manda nada.
      //      Jamás se inventa un número: son citas normativas.
      // La tool `enviar_informe_termico` (el cliente lo PIDE) sigue teniendo su hook.
      // `calcular_cotizacion` ya NO dispara nada: el informe sale con la propuesta, que es
      // el unico punto donde el proyecto esta completo.
      // 🔴 [Codex · compuerta #524] SIN return: `execTool` hace await de lo que la tool
      // devuelva, y devolver la promesa convertia este camino manual en BLOQUEANTE (el
      // turno entero esperando los ~40s de ritmo humano del informe). Fire-and-forget,
      // como fue siempre. La secuencia informe-primero llama a despacharInforme directo
      // y ELLA si lee el resultado.
      enviarInformeTermico: (comuna, opciones = {}) => { despacharInforme(comuna, opciones); },

      // saveLead → pushLeadEvent (persistencia real del lead).
      saveLead: (leadState = {}) =>
        safe('saveLead', async () => {
          await landingAttributionReady;
          return bridge.pushLeadEvent({
            // [2026-08-08] telefonoCliente, no `from`: si el dueño fijó "CLIENTE Juan
            // +569…", el lead es de Juan. Sin atribución activa, telefonoCliente === from
            // y esto se comporta exactamente igual que antes.
            phone: telefonoCliente,
            channel: 'whatsapp',
            // El nombre del comando manda: el dueño lo escribió a propósito.
            name: atribucion?.name || leadState.name || state.name || '',
            comuna: leadState.comuna || state.comuna || '',
            stage: leadState.stageKey || 'oliver_gpt',
            items: leadState.items || [],
            value: leadState.grand_total || null,
            // [2026-08-08] Con atribución activa NO se copian los click-id de la sesión.
            // Son del DUEÑO —de cómo llegó él a su propio chat—, no del cliente. Pegárselos
            // al lead de un recomendado le atribuiría esa venta a un anuncio que nunca vio,
            // y el ROAS con el que se decide el gasto quedaría inflado.
            // Es el problema opuesto al que este comando vino a resolver. (Codex, 08-ago.)
            ctwa_clid: atribucion ? null : (leadState.ctwa_clid || state.ctwa_clid || null),
            ad_id: atribucion ? null : (leadState.ad_id || state.ad_id || null),
            gclid: atribucion ? null : (leadState.gclid || state.gclid || null),
            fbclid: atribucion ? null : (leadState.fbclid || state.fbclid || null),
            ttclid: atribucion ? null : (leadState.ttclid || state.ttclid || null),
            landing_ref: atribucion ? null : (leadState.landing_ref || leadState.landing_lead_id || state.landing_lead_id || null),
            // [2026-08-08] Trazabilidad ISO: queda escrito que este lead lo cargó el dueño
            // a nombre del cliente, y desde qué número. Sin esto, dentro de un mes nadie
            // sabría por qué hay un lead sin conversación asociada.
            metadata: atribucion
              ? { source: 'oliver_gpt', atribuido_por: from, atribuido_at: new Date().toISOString(), via: 'comando_CLIENTE' }
              : { source: 'oliver_gpt' },
          });
        }),

      // notifyMarcelo → escalación REAL (highValueNotifier a ESCALATION_PHONE).
      // highValueNotifier.notifyHighValue(waSendFn, customerPhone, session, reason).
      notifyMarcelo: (payload = {}) =>
        safe('notifyMarcelo', () =>
          notifyHighValue(
            // [2026-08-08] enviarSinPausa: esto termina en el celular de Marcelo
            // (ESCALATION_PHONE/OWNER_PHONE). Se le escapó a la primera corrección — los
            // otros 6 llamados sí se cambiaron y este quedó (P2 de Codex, 2ª pasada).
            enviarSinPausa, // waSendFn(to, body) — firma compatible
            from,
            {
              data: { ...state, ...(payload.data || {}) },
              history,
            },
            payload.reason || 'oliver_gpt_escalation'
          )
        ),

      // persistSession → no-op DELIBERADO [tribunal 2026-07-18]. agent.js llama
      // toolCtx.persistSession(nextState) con el STATE PLANO (sin {history,state}):
      // persistSessionFn leía undefined/undefined y hacía PUT {history:[],data:{}} →
      // BORRABA la sesión remota a mitad de turno; si el persist final (9) fallaba o
      // Railway redeployaba en esa ventana, amnesia total del cliente. El webhook YA
      // persiste el estado completo al final de cada camino (precedente idéntico:
      // channel-agent.js). NO "arreglar" el shape acá: persistiría ctwa_saludo_pending
      // a mitad de turno (antes del delete one-shot) y reviviría el saludo.
      persistSession: () => Promise.resolve(),

      // sendMedia → envío REAL de catálogos/fotos/videos por WhatsApp.
      // Resuelve la catalog_key a URL desde env vars y despacha con el helper correcto.
      sendMedia: ({ media_type, catalog_key, caption = '' } = {}) =>
        safe('sendMedia', async () => {
          const sendImageUrl = deps.sendImageUrl || realSendImageUrl;
          const sendVideoUrl = deps.sendVideoUrl || realSendVideoUrl;
          const sendDocumentUrl = deps.sendDocumentUrl || realSendDocumentUrl;
          // resolveCatalogUrl vive en tools.js; la replicamos aquí inline para no
          // crear una dependencia circular. Misma fuente de verdad: env vars.
          const CATALOG_MAP = {
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
          const url = CATALOG_MAP[catalog_key] || null;
          if (!url) {
            log('error', 'sendMedia', `catalog_key '${catalog_key}' sin URL configurada`);
            return { ok: false, error: `catalog_not_configured: ${catalog_key}` };
          }
          if (media_type === 'image') {
            return sendImageUrl(from, url, caption);
          } else if (media_type === 'video') {
            return sendVideoUrl(from, url, caption);
          } else if (media_type === 'document') {
            return sendDocumentUrl(from, url, `${catalog_key}.pdf`, caption);
          }
          return { ok: false, error: `media_type_invalido: ${media_type}` };
        }),

      // generarPdf → orquesta los 6 pasos del PDF ISO:
      //   1) correlativo ISO (POST sales-os /internal/quotes/next-number)
      //   2) generar PDF premium (quotePdf.js)
      //   3) enviar al cliente vía WA (uploadWaDocument + sendWaDocument)
      //   4) registrar Deal/Note en Zoho CRM (zohoCommercial.js)
      //   5) archivar en WorkDrive (NO-BLOQUEANTE, inerte hasta re-autorización OAuth)
      //   6) disparar conversión multicanal (bridge.pushQuoteEvent → server fireConversion → CXM)
      //
      // ANTI-CROSS-INJECT: solo se envía al canal del click_id capturado en F3b.
      // Los unit_price de input.items DEBEN venir de calcular_cotizacion (nunca del LLM).
      generarPdf: (input = {}) =>
        safe('generarPdf', async () => {
          // ── GUARDIA ANTI-ALUCINACIÓN DE PRECIOS (regla del dueño: marcar/pedir, NUNCA rellenar) ──
          // Si algún ítem no trae unit_price>0 (que DEBE venir de calcular_cotizacion), NO se genera
          // el PDF ni se quema un correlativo ISO. Convierte la defensa de "solo prompt" a "prompt+código".
          const itemsBad = (input.items || []).filter((it) => !(Number(it.unit_price) > 0));
          if (!input.items?.length || itemsBad.length) {
            log('error', 'generarPdf.guard',
              `PDF abortado: ${itemsBad.length}/${input.items?.length || 0} ítems sin unit_price>0 (posible alucinación de precios)`);
            return { ok: false, reason: 'precios_no_validados', detail: 'unit_price debe venir de calcular_cotizacion, no inventado' };
          }

          // ── [PDF-RACE 2026-07-01] GUARD de COMPLETITUD: PDF formal SOLO con datos confirmados ──
          // Casos reales BD: 0081/0085/0086 (Ximena), 0060 (Vivi), 0090 (Julio) — el PDF salía ANTES
          // de que el cliente respondiera nombre/color/tipo. Sin nombre real o ítems incompletos:
          // NO se quema folio ISO; se devuelve message para que Oliver pida el dato que falta.
          // 🔴 [2026-08-25] LO QUE DIJO EL CLIENTE, para poder saber si la apertura la eligió
          // él o se la pusimos nosotros. Se juntan sus mensajes (incluido el texto que la
          // visión sacó de sus imágenes, que entra al historial como mensaje del cliente) y
          // el del turno actual. NO se mira lo que escribió Oliver: si él dice "corredera"
          // ofreciéndola, eso no es que el cliente la haya pedido.
          // [2026-08-31] El armado vive en `normalizers.textoDelCliente`: IG/FB tiene que medir
          // EXACTAMENTE lo mismo para que el gate del color se comporte igual en los dos canales.
          const _textoCliente = textoDelCliente(history, userText);
          const _gate = quoteDataComplete(input, state, { textoCliente: _textoCliente });
          if (!_gate.ok) {
            log('error', 'generarPdf.gate', `PDF bloqueado por datos incompletos: ${_gate.missing.join(', ')}`);
            // 🔴 [2026-08-25] EL COLOR TIENE SU PROPIA PREGUNTA, y se hace ACÁ.
            //
            // Al empezar a exigir el color apareció un riesgo nuevo: si Oliver no sabe qué
            // preguntar, el cliente queda esperando una propuesta que nunca sale. El mensaje
            // genérico —"necesito confirmar un detalle de las ventanas, ya te pregunto"— no
            // le sirve a nadie: no dice qué falta y promete una pregunta que quizás no llega.
            // Pedido del dueño: *"debemos ser más humanos"*. Se ofrecen los 5 del catálogo y
            // se avisa que el color cambia el precio, que es la verdad y evita el disgusto
            // después.
            // Se anota CUANDO se pregunto el color: pasado el minuto, la proxima vez sale
            // la blanca con aviso en vez de dejar al cliente sin propuesta.
            //
            // 🔴 [2026-08-25] DEFECTO MEDIDO Y AISLADO — ESTA EN EL GATE DE LA APERTURA (abajo),
            // NO EN ESTE. Se deja escrito acá porque las dos lineas comparten el mecanismo.
            //
            // El reloj se reescribe mientras el dato siga faltando. Un cliente que conteste MAS
            // rapido que el plazo lo empuja hacia adelante en cada mensaje y el plazo NO vence:
            // se queda sin cotizacion. No hace falta que escriba cualquier cosa — basta que
            // conteste algo fuera del catalogo ("gris", "no se", "el mas barato").
            //
            // AISLADO con `webhook.gate-espera.test.js`, cliente contestando cada 60 ms con un
            // plazo de 150 ms:
            //     los dos sin arreglar          → SIN cotizacion
            //     arreglando solo el color      → SIN cotizacion   ⇒ no es esta linea
            //     arreglando solo el tipo       → recibe            ⇒ es la de abajo
            //     arreglando los dos            → recibe
            // ⇒ el gate del COLOR solo (lo que hay hoy en produccion) NO produce el bucle: el
            //   color deja de faltar despues del primer turno y el gate no vuelve a esa rama.
            //
            // EL ARREGLO, cuando se haga: anotar la PRIMERA vez (`&& !state.X_preguntado_at`) y
            // marcar SOLO el dato que la cadena de abajo pregunta de verdad — es excluyente, y
            // hoy se marcan los dos, asi que se puede asumir corredera sin haberla preguntado
            // nunca (2o hallazgo de la compuerta, aun sin test).
            // 🔴 [2026-08-25 · compuerta cruzada] EL RELOJ ARRANCA UNA VEZ, Y SOLO EL DEL DATO
            // QUE DE VERDAD SE PREGUNTA. Dos defectos que Codex y Gemini cazaron por separado:
            //
            //  1. EL CLIENTE ENGANCHADO SE QUEDABA SIN COTIZACION. El sello se reescribia en
            //     CADA turno mientras el dato faltara, y se reescribia DESPUES de evaluarlo:
            //     el que tarda mas que el plazo cobra su propuesta, pero el que contesta rapido
            //     empuja el vencimiento hacia adelante con cada mensaje y no llega NUNCA. El que
            //     mas ganas tiene de comprar era el unico que se quedaba sin cotizacion, y le
            //     bastaba contestar algo fuera del catalogo ("gris", "no se", "el mas barato").
            //     Aislado en webhook.gate-espera.test.js: 7 turnos cada 60 ms con plazo de 150 ms.
            //
            //  2. SE ASUMIA UN DATO QUE NUNCA SE PREGUNTO. La cadena de abajo pregunta UNO solo
            //     (nombre > color > apertura), pero aca se marcaban los dos relojes. El del dato
            //     no preguntado vencia igual y se asumia CORREDERA sin habersela preguntado
            //     jamas — el defecto que este gate vino a cerrar, entrando por la puerta de atras.
            //
            // Por eso se calcula PRIMERO cual se va a preguntar, con el mismo orden que el
            // mensaje, y solo ese reloj arranca. `!state.…` es lo que impide reiniciarlo.
            // La decision vive en `datoQuePregunta` (pdf-intent.js), no aca: el mensaje de
            // abajo y este reloj TIENEN que estar de acuerdo sobre cual dato se pregunta, y
            // dos copias de esa regla se desincronizan — que es como nacio el defecto 2.
            const _falta = datoQuePregunta(_gate.missing);
            // `!preguntaVigente(...)` y NO `!state.…`, y la diferencia es un bucle:
            //   · mientras la pregunta esta VIGENTE el reloj no se reinicia (defecto 1);
            //   · si es de otra conversacion (vencida), se reinicia — porque se le esta
            //     preguntando DE NUEVO. Con `!state.…` un reloj viejo bloqueaba el reinicio,
            //     la pregunta nunca volvia a ser vigente y el plazo no vencia jamas: el mismo
            //     bucle de antes, entrando por el reloj rancio.
            if (_falta === 'color' && !preguntaVigente(state.color_preguntado_at)) state.color_preguntado_at = Date.now();
            if (_falta === 'tipo' && !preguntaVigente(state.tipo_preguntado_at)) state.tipo_preguntado_at = Date.now();
            if (_falta === 'hojas' && !preguntaVigente(state.hojas_preguntado_at)) state.hojas_preguntado_at = Date.now();
            // [2026-08-25 · Codex] La pregunta usa EL MISMO `_falta` que el reloj. Tenia su
            // propia cascada paralela: hoy los dos ordenes coincidian, pero el dia que alguien
            // cambie la prioridad en una sola se arranca el reloj de un dato y se pregunta otro
            // — el defecto 2 reintroducido por la puerta de atras. Dos listas paralelas se
            // desincronizan; por eso `datoQuePregunta` existe.
            const _pregunta = _falta === 'name'
              ? '¿A nombre de quién emito la Propuesta Técnica Económica? Con eso te la envío al tiro.'
              : _falta === 'color'
                // Los nombres de color NO se parten entre lineas: un "Grafito " + "Antracita"
                // se lee igual en el chat pero rompe cualquier verificacion sobre la fuente.
                ? '¿En qué color las quiere? Tenemos Blanco, Nogal, Roble Dorado, Grafito Antracita y Negro.'
                  + ' Se lo pregunto porque el color cambia el precio y prefiero cotizarle el que de verdad quiere.'
                : _falta === 'tipo'
                  // 🔴 [2026-08-25] LA APERTURA SE PREGUNTA, NO SE SUPONE. El cliente manda la
                  // foto de una proyectante y hasta hoy recibía el precio de una corredera.
                  // Se nombran las cuatro con una explicación de una línea: mucha gente no sabe
                  // que "proyectante" es la que se abre hacia afuera, y no puede elegir lo que
                  // no entiende.
                  ? '¿Qué tipo de apertura necesita? Corredera (se abre deslizando), proyectante'
                    + ' (se abre hacia afuera), fija (no se abre), abatible, o mitad fija y mitad'
                    + ' proyectante, que es la más pedida y suele salir más conveniente.'
                    + ' Se lo pregunto porque la apertura cambia el precio y prefiero cotizarle la que de verdad quiere.'
                  : _falta === 'hojas'
                    // 🔴 [2026-08-25] CORREDERA MAS ANCHA QUE EL ESTANDAR: SE PREGUNTAN LAS HOJAS.
                    // Instruccion del dueño (caso Martin 0341, corredera de 5560 mm): por el
                    // tamaño hay que preguntar 3 o 4 hojas; si no contesta, sale de 2 con aviso.
                    ? 'Por el ancho de esa corredera, ¿la quiere de 3 o de 4 hojas? También se puede de 2,'
                      + ' pero las hojas quedan más grandes y pesadas.'
                      + ' Se lo pregunto porque el número de hojas cambia el precio.'
                    : 'Antes de emitir la propuesta formal necesito confirmar un detalle de las ventanas. Ya te pregunto.';
            return { ok: false, reason: 'datos_incompletos', missing: _gate.missing, message: _pregunta };
          }

          // 🔴 [2026-08-25] EL COLOR SE ASUMIO PORQUE EL CLIENTE NO CONTESTO.
          // Instruccion del dueño: *"si cliente no dice el color, nosotros le decimos
          // después de un minuto o algo así que le preparamos mientras una de color blanco"*.
          // Sale la propuesta en Blanco, pero SE LO DECIMOS. Lo que no vuelve a pasar es
          // entregar blanco sin avisar: eso es lo que costaba recotizaciones y disgustos.
          let _avisoColor = '';
          // 🎨 [2026-08-31 · DECISION DEL DUEÑO] TRES PROPUESTAS, UNA POR COLOR.
          // Textual: *"cuando cliente no entrega color entreguemosle blanco, nogal y negro"*.
          // La OPCION A viaja por el camino de siempre (este mismo `generarPdf`, con todo lo
          // que cuelga de el: Zoho, informe termico, video, conversion). Las otras dos salen
          // en el Paso 3b·bis, mas abajo, cada una aislada de la otra.
          // ⛔ NO se escribe `state.default_color`: el cliente NO eligio ninguno. Guardarlo
          // seria repetir el defecto del 29-ago —el Blanco inventado quedaba marcado como una
          // eleccion del cliente y apagaba el gate para siempre—. Si el cliente responde cual
          // quiere, `recordarColor` lo guarda entonces, que es cuando de verdad lo eligio.
          let _coloresTerna = null;
          // Cuantas letras del folio quedan RESERVADAS por la terna. Variable local (no
          // `state`): `agent.handleTurn` saca la foto del estado al empezar, asi que esto no
          // sobreviviria el turno de todos modos — y no tiene por que: solo tiene que llegar
          // hasta el `state.last_quote` del final de esta misma llamada.
          let _letrasTerna = 0;
          if (_gate.coloresPropuestos && _gate.coloresPropuestos.length > 1) {
            _coloresTerna = _gate.coloresPropuestos.slice();
            const _colorA = _coloresTerna[0];
            (input.items || []).forEach((it) => { it.color = _colorA; });
            log('info', 'generarPdf.color',
              `${from}: sin color del cliente → ${_coloresTerna.length} propuestas (${_coloresTerna.join(' / ')})`);
          } else if (_gate.colorAsumido) {
            // Pedido MIXTO (el cliente eligio un color para unas ventanas y no para otras):
            // no se le proponen tres colores a quien ya eligio uno. Se completa con Blanco y
            // se le avisa — el comportamiento de siempre, intacto.
            (input.items || []).forEach((it) => { if (!String(it.color || '').trim()) it.color = 'Blanco'; });
            state.default_color = state.default_color || 'Blanco';
            _avisoColor = '\n\n🎨 Se la preparé en *Blanco* mientras me confirma el color. '
              + 'Si prefiere Nogal, Roble Dorado, Grafito Antracita o Negro, me avisa y se la '
              + 'recotizo sin costo; el color cambia el precio, por eso se lo digo.';
            log('info', 'generarPdf.color', `color asumido Blanco para ${from}: el cliente no contesto`);
          }

          // 🔴 [2026-08-25] LA APERTURA SE ASUMIO PORQUE EL CLIENTE NO CONTESTO.
          // Mismo trato que el color y por lo mismo: no cotizar en silencio, pero tampoco
          // perder la venta esperando un dato que no dio. Sale la corredera —que es la mas
          // pedida— pero SE LO DECIMOS, y se le nombra la alternativa que suele ser mas
          // barata en la misma medida.
          let _avisoTipo = '';
          if (_gate.tipoAsumido) {
            _avisoTipo = '\n\n🪟 Se la preparé como *corredera* mientras me confirma la apertura. '
              + 'Si la quiere proyectante, fija o abatible me avisa y se la recotizo sin costo; '
              + 'la apertura cambia el precio.';
            log('info', 'generarPdf.tipo', `apertura asumida CORREDERA para ${from}: el cliente no la nombro`);
          }

          // 🔴 [2026-08-25] LAS HOJAS SE ASUMIERON (2, el default del motor) PORQUE NO CONTESTO.
          // Con las medidas REALES — el clamp que cobraba una 5560 como si fuera 2930 ya no
          // existe (enginePricer). Se avisa igual que color y apertura: nunca en silencio.
          // 🔴 [2026-08-25 · Codex 2a pasada] LA ELECCION DE HOJAS VIAJA AL PRECIO EN CODIGO.
          // El pricer manda `hojas` al motor solo si el LABEL del item las trae ("Corredera 3
          // hojas"), y eso dependia de que el LLM las copiara: el cliente decia "de 3 hojas",
          // el label salia "Corredera SLIDING" y el motor cobraba 2. Determinista: si el chat
          // eligio hojas y el item corredera grande no las tiene, se le escriben al label.
          // Solo con UN item en el pedido — con varios, un "2 hojas" de la puerta de al lado
          // contaminaria a la corredera (mismo criterio que el gate en pdf-intent).
          if ((input.items || []).length === 1) {
            const _hojasTexto = detectHojas(_textoCliente);
            const _it0 = input.items[0];
            const _esCorrGrande = /corredera|sliding/i.test(String(_it0.producto_label || _it0.product || ''))
              && !detectHojas(String(_it0.producto_label || _it0.product || ''));
            if (_hojasTexto >= 2 && _hojasTexto <= 4 && _esCorrGrande) {
              _it0.product = `${_it0.product || 'Corredera'} ${_hojasTexto} hojas`;
              _it0.producto_label = `${_it0.producto_label || _it0.product} ${_hojasTexto} hojas`.replace(/(\d hojas) \d hojas$/, '$1');
              log('info', 'generarPdf.hojas', `hojas del chat inyectadas al item: ${_hojasTexto}`);
            }
          }

          let _avisoHojas = '';
          if (_gate.hojasAsumido) {
            _avisoHojas = '\n\n🪟 Por el ancho, se la coticé de *2 hojas* (quedan grandes y pesadas). '
              + 'Si la prefiere de 3 o de 4 me avisa y se la recotizo sin costo; '
              + 'el número de hojas cambia el precio.';
            log('info', 'generarPdf.hojas', `hojas asumidas (2) para ${from}: corredera sobre el estandar sin eleccion del cliente`);
          }

          // ── [2026-07-06 LOTE2] Medidas RESUELTAS: "AxBmm" es el transporte INTERNO de la confirmación
          // de unidad. Acá se separa en campos numéricos (los guards de abajo re-cotizan EXACTO, sin
          // re-parsear heurísticas) + string limpio para display (Zoho/PDF/alertas ven "350x600").
          (input.items || []).forEach((it) => {
            const _mres = String(it.measures || '').match(/^\s*(\d+)x(\d+)mm\s*$/i);
            if (_mres) {
              it.ancho_mm = Number(it.ancho_mm) || Number(_mres[1]);
              it.alto_mm  = Number(it.alto_mm)  || Number(_mres[2]);
              it.measures = `${_mres[1]}x${_mres[2]}`;
            }
          });
          const _measuresForEngine = (it) =>
            (Number(it.ancho_mm) > 0 && Number(it.alto_mm) > 0) ? `${it.ancho_mm}x${it.alto_mm}mm` : (it.measures || '');

          // ── BLINDAJE label↔precio (2026-06-24) — INVARIANTE: el precio DEBE corresponder a la
          // apertura que el cliente VE en el label. Causa raíz del bug 0064/0065/0066: una FIJA salía
          // con precio de CORREDERA (~2x). Aquí, en el ÚNICO punto de salida del PDF (cubre LLM,
          // entrega determinista y pending_quote viejo de antes de un deploy), re-cotizamos en el
          // MOTOR la apertura del label y, si el precio recibido no corresponde, lo CORREGIMOS al del
          // motor (NUNCA inventado). Conservador: solo ítems con apertura inequívoca; si el motor
          // falla, NO bloquea (el PDF sale con el precio que vino). Soporta pedido mixto (ítem×ítem).
          try {
            const _val = (input.items || [])
              .map((it) => ({ it, ap: aperturaFromLabel(it.producto_label || it.product || '') }))
              .filter((x) => x.ap);
            if (_val.length) {
              const _probe = {
                items: _val.map((x) => ({
                  product:  x.it.producto_label || x.it.product,  // label completo → conserva variantes (hojas/riel)
                  measures: _measuresForEngine(x.it), // [LOTE2] resueltas exactas si existen (sin re-mangle ×10)
                  color:    x.it.color || '',
                  qty:      Number(x.it.qty) || 1,
                  ambiente: x.it.ambiente || '',
                  // Sin la descripcion ni la orientacion, una compuesta VERTICAL se re-cotizaba
                  // horizontal y el "precio del motor" con el que se compara seria el de otra
                  // ventana. La revision quedaria peor que no tenerla.
                  descripcion: x.it.descripcion || '',
                  orientacion: x.it.compuesta?.orientacion || x.it.orientacion || undefined,
                  partes: Array.isArray(x.it.compuesta?.partes) ? x.it.compuesta.partes : undefined,
                })),
                comuna: input.comuna || state.comuna || '',
                texto_cliente: _textoCliente,
              };
              await priceAllEngine(_probe);
              _val.forEach((x, k) => {
                const expected = Number(_probe.items[k]?.unit_price) || 0;
                const got = Number(x.it.unit_price) || 0;
                if (expected > 0 && Math.abs(expected - got) > Math.max(500, expected * 0.02)) {
                  log('error', 'generarPdf.guard.apertura',
                    `PRECIO CORREGIDO label='${x.ap}' recibido=${got} motor=${expected} (${x.it.producto_label || x.it.product})`);
                  x.it.unit_price = expected; // precio REAL del motor para la apertura del label → coherente
                }
              });
            }
          } catch (e) {
            log('error', 'generarPdf.guard.apertura.err', e?.message || e); // no bloquear el PDF si el motor no responde
          }


          // ⛔ [2026-08-31] LA OPCION A TAMBIEN SE COTIZA PARA SU COLOR.
          // No alcanza con cambiarle la etiqueta arriba: el precio que trae `input.items` lo
          // compuso el turno anterior con el color por DEFECTO, y las opciones B/C SI se
          // re-cotizan (paso 3b·bis). Mientras la A fue el Blanco coincidia por casualidad;
          // al pasar el orden a "del mas caro al mas economico" (decision del dueno) la A
          // quedo rotulada New Black CON EL PRECIO DEL BLANCO — un documento formal con la
          // etiqueta de un color y el precio de otro, que es justo lo que el resto de este
          // archivo prohibe.
          // La guardia de apertura de arriba NO cubre esto: solo corre para labels que
          // `aperturaFromLabel` reconoce, y ademas usa el motor importado, no el inyectado.
          // Va DESPUES de ella a proposito: el precio del color es el que tiene que quedar.
          // Si el motor no responde, se sigue con lo que habia: nunca se frena al cliente.
          if (_coloresTerna && _coloresTerna.length > 1) {
            try {
              const _colorA = _coloresTerna[0];
              const _sondaA = {
                items: (input.items || []).map((it) => ({
                  product:     it.producto_label || it.product || 'Ventana',
                  measures:    _measuresForEngine(it),
                  color:       _colorA,
                  qty:         Number(it.qty) || 1,
                  ambiente:    it.ambiente || '',
                  descripcion: it.descripcion || it.ambiente || '',
                  orientacion: it.compuesta?.orientacion || it.orientacion || undefined,
                  partes:      Array.isArray(it.compuesta?.partes) ? it.compuesta.partes : undefined,
                })),
                comuna: input.comuna || state.comuna || '',
                texto_cliente: _textoCliente,
              };
              await priceAllFn(_sondaA);
              _sondaA.items.forEach((x, k) => {
                const _it = (input.items || [])[k];
                if (!_it) return;
                if (Number(x.unit_price) > 0 && x.confidence === 'high') {
                  _it.unit_price  = Number(x.unit_price);
                  _it.total_price = Number(x.total_price) || Number(x.unit_price) * (Number(_it.qty) || 1);
                  _it.source      = x.source || _it.source;
                  _it.confidence  = x.confidence;
                }
              });
            } catch (e) { log('error', 'generarPdf.opcionA.precio', e?.message || e); }
          }

          // ── [thermal 2026-06-25] Uw SIEMPRE del MOTOR, nunca del LLM ───────
          // Re-cotiza CADA ventana en el motor (priceAllEngine → /api/quotes/calculate)
          // y toma su `termico` REAL (Uw certificado). Oliver NO pasa nada térmico:
          // el Uw no puede depender de que el LLM lo copie (como pasó con la 0071).
          // ROBUSTO: todo en try/catch → si el motor falla, termico queda null y el
          // PDF sale igual (NUNCA roto). NO toca precios (solo escribe it.termico).
          // H98 (sin perfil en la API thermal) → motor devuelve termico null → no se muestra.
          try {
            const _therm = {
              items: (input.items || []).map((it) => ({
                product:  it.producto_label || it.product || '',
                measures: _measuresForEngine(it), // [LOTE2] resueltas exactas si existen (sin re-mangle ×10)
                color:    it.color || '',
                qty:      Number(it.qty) || 1,
                ambiente: it.ambiente || '',
                descripcion: it.descripcion || it.ambiente || '',
              })),
              comuna: input.comuna || state.comuna || '',
              // 🔴 [2026-08-26] SIN EL TEXTO DEL CLIENTE, ACA NO SE CORRIGE NADA. Este es el
              // punto por donde sale el PDF, y trabajaba a ciegas: no sabia que la clienta
              // habia escrito "LAS MEDIDAS ESTAN ALTO POR ANCHO".
              texto_cliente: _textoCliente,
            };
            await priceAllEngine(_therm);
            (input.items || []).forEach((it, k) => {
              const _t = _therm.items[k];
              // 🔴 [2026-08-26] LA MEDIDA CORREGIDA VUELVE AL ITEM QUE VE EL CLIENTE.
              // El arreglo anterior escribia la medida dada vuelta en el item... pero ESTE
              // bloque trabaja sobre COPIAS (el .map de arriba), asi que la correccion moria
              // en la copia y el PDF seguia mostrando lo que escribio la clienta.
              // Medido en la propuesta 0354 de Paula: precio de una ventana de 2000x2200
              // (correcto) impreso sobre "2200x2000". Y de ahi salia ademas el
              // `referencial: true` de las tres compuestas — el validador veia 2200 de ancho.
              if (_t && _t.measures_swapped && _t.measures) {
                it.measures_texto_cliente = it.measures_texto_cliente || it.measures;
                it.measures = _t.measures;
                const _mm = String(_t.measures).match(/^(\d+)x(\d+)/);
                if (_mm) { it.ancho_mm = Number(_mm[1]); it.alto_mm = Number(_mm[2]); }
              }
              it.termico = _t?.termico || null; // motor manda; sin termico → null

              // 🔴 [2026-08-26] LA COMPOSICION DE LA VENTANA VIAJA AL DIBUJO. Sin esto el PDF
              // dibujaba las tres compuestas de Paula como UN PAÑO UNICO: el dibujo necesita
              // `compuesta.partes` para saber donde va el travesaño y cual paño abre, y ese
              // dato lo produce el MOTOR — vive en la copia de este bloque, no en el item que
              // llega al PDF. El dueño lo vio de inmediato: *"la imagen de la cotizacion no
              // representa lo que necesitamos que vea el cliente"*.
              if (_t && _t.compuesta) it.compuesta = _t.compuesta;

              // Y el ancho de hoja de una corredera (H80 / H98): el dibujo lo usa para el
              // grueso real del bastidor. Sale del label que devuelve el motor, que es quien
              // sabe que hoja le toco a esa medida.
              if (!Number(it.hoja_mm)) {
                const _h = String((_t && _t.producto_label) || it.producto_label || it.product || '')
                  // ⚠️ Regex LITERAL y sin \b: dentro de una cadena JS, '\b' es el caracter
                  // BACKSPACE, no el limite de palabra — el patron nunca matcheaba y toda
                  // corredera caia al ancho de hoja por defecto. Aca no hace falta: basta
                  // con una H seguida de digitos, y en estos labels eso solo es la hoja.
                  .match(/H(\d{2,3})/i);
                if (_h) it.hoja_mm = Number(_h[1]);
              }
              // [2026-07-07] referencial = medida fuera de estándar (sobre máx o bajo mín). Motor-truth
              // para TODOS los ítems (no depende de que el LLM lo pase) → dispara la escalación de abajo.
              if (_therm.items[k]?.referencial) {
                it.referencial = true;
                it.measures_original = _therm.items[k].measures_original || it.measures_original || it.measures;
              }
            });
          } catch (e) {
            log('error', 'generarPdf.termico.err', e?.message || e); // jamás bloquea el PDF
          }

          // ── GUARD ANTI-DUPLICADO (2026-06-14 · v2 2026-06-15) ─────────────
          // Si ya se generó una cotización IDÉNTICA para este número en los últimos
          // 2 min, NO quemar otro correlativo ISO: devolver la existente. Cubre doble
          // "confirmo" y reintentos. FIX 2026-06-15: ahora compara el CONTENIDO — si el
          // cliente cambió algo (producto, medida, color, total: ej. corredera→abatiente),
          // NO es duplicado → se regenera el PDF corregido (antes el dedup lo bloqueaba).
          const _quoteSig = JSON.stringify({
            items: (input.items || []).map((it) => [
              it.producto_label || it.product || '', it.measures || '',
              it.color || '', Number(it.qty) || 1, Number(it.unit_price) || 0,
            ]),
            total: Number(input.grand_total) || 0,
          });
          //
          // 🔴 [2026-08-26] EL GUARDIA VIVIA SOLO EN MEMORIA, Y ASI NO GUARDA NADA.
          // Caso real: Paula (0346) recibio DOS VECES la misma propuesta y DOS VECES el
          // video de la fabrica. El `Map` se borra en cada deploy de Railway y no se
          // comparte entre instancias, asi que despues de un redeploy el guardia queda
          // ciego y el reintento de Meta pasa derecho.
          // Es EXACTAMENTE el mismo agujero que ya se habia tapado el 08-ago para el
          // dedupe de msgId (arriba, `msg:${msgId}`) — este se habia quedado atras.
          // Mismo remedio y mismo fail-safe: se consulta el respaldo solo cuando la
          // memoria no sabe, y si la red se cae se degrada al comportamiento anterior.
          const _claveQuote = `quotesig:${String(from).replace(/\D/g, '')}`;
          let _prevQuote = RECENT_QUOTES.get(from);
          if (!_prevQuote) {
            try { _prevQuote = (await (deps.leerEstado || leerEstado)(_claveQuote)) || null; }
            catch { /* red caida: se degrada al guardia en memoria */ }
          }
          if (_prevQuote && (Date.now() - _prevQuote.at) < QUOTE_DEDUP_MS && _prevQuote.sig === _quoteSig) {
            log('info', 'generarPdf.dedup',
              `Cotización IDÉNTICA duplicada evitada para ${from}; reusando ${_prevQuote.quote_number}`);
            return { ok: true, quote_number: _prevQuote.quote_number, pdf_sent: false, deduped: true };
          }

          // ── Paso 1: Correlativo ISO ──────────────────────────────────────────
          const SALES_OS_URL = (process.env.SALES_OS_URL || '').replace(/\/$/, '');
          const OPERATOR_TOKEN = process.env.SALES_OS_OPERATOR_TOKEN || '';
          let quoteNumber = null;
          let descuentoMercadoPct = 0; // [2026-06-24] viene del correlativo → se muestra en el PDF
          // [PDF-RACE 2026-07-01] REUSAR el folio de la sesión (ventana 48h): una corrección del
          // cliente = REVISIÓN del MISMO folio, no correlativo nuevo (antes: 0081→0085→0086 en una
          // sola sesión = 3 folios ISO quemados para la misma propuesta).
          const QUOTE_REUSE_MS = 48 * 60 * 60 * 1000;
          // [2026-08-08] esRevision: ¿este PDF es la PRIMERA propuesta o una corrección de
          // una que el cliente YA recibió? Caso real del 08-ago (Jessica, +56965340471): en
          // 5 minutos recibió TRES PDF del folio 0258 —mientras todavía daba las medidas— y
          // los tres decían "Listo ✅ Te envié tu Propuesta N° 0258" como si fuera nueva.
          // Desde afuera se lee como un bot trabado mandando el mismo archivo. El centinela
          // lo reportó como "bot en loop", y tenía razón en el síntoma aunque la causa era ésta.
          // El folio se reusa bien (una corrección es una revisión, no un correlativo nuevo);
          // lo que estaba mal era CONTARLO como envío nuevo.
          //
          // 🔴 [2026-08-26] UNA CORRECCION ES UNA REVISION; UNA ALTERNATIVA ES OTRO DOCUMENTO.
          // La regla de reuso, sola, no distinguia las dos cosas y perdia informacion. Caso
          // real y medido: Paula pidio DOS cotizaciones, *"una de color negro y la otra de
          // color blanco"*. Las dos salieron con el folio 0353 y, como la fila se guarda POR
          // NUMERO DE FOLIO, la segunda PISO a la primera: fila creada 16:21:08, actualizada
          // 16:21:10, y quedo solo el blanco. **La cotizacion negra que recibio la clienta no
          // existe en el registro.** Si mañana la aprueba, no hay con que respaldarla.
          //
          // Regla del dueño: *"agregarle A B C D al final si hay, asi sera mas facil"*.
          //   0353     → el primer documento (equivale a la A)
          //   0353-B   → la segunda alternativa
          //   0353-C   → la tercera
          // Como el NUMERO cambia, cada documento se guarda en su propia fila y el pisado
          // desaparece solo: no hay que tocar como se persiste.
          //
          // CUANDO LLEVA LETRA, y solo entonces: cuando el anterior YA SE ENTREGO y el
          // contenido es DISTINTO. Si el cliente corrige una medida sobre una propuesta que
          // todavia no recibio, sigue siendo la misma y conserva su numero — que es lo que se
          // arreglo el 08-ago con el caso Jessica (3 correlativos quemados en 5 minutos).
          let esRevision = false;
          const _lq = state.last_quote;
          const _dec = numeroDeDocumento({ lastQuote: _lq, sig: _quoteSig, ventanaMs: QUOTE_REUSE_MS });
          if (_dec.numero) {
            quoteNumber = _dec.numero;
            descuentoMercadoPct = Number(_lq.descuento_mercado_pct) || 0;
            esRevision = _dec.motivo === 'revision';
            log(_dec.motivo === 'sin_letras' ? 'warn' : 'info', 'generarPdf.folio',
              `${from}: ${quoteNumber} (${_dec.motivo})`);
          }
          if (!quoteNumber) try {
            const correlativoRes = await fetch(
              `${SALES_OS_URL}/internal/quotes/next-number`,
              {
                method: 'POST',
                headers: { 'x-api-key': OPERATOR_TOKEN, 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenant_id: 'activa' }),
                signal: AbortSignal.timeout(8000),
              }
            );
            if (correlativoRes.ok) {
              const cj = await correlativoRes.json();
              quoteNumber = cj.quote_number || cj.number || null;
              descuentoMercadoPct = Number(cj.descuento_cliente_pct) || 0;
            }
          } catch (err) {
            log('error', 'generarPdf.correlativo', err);
          }
          if (!quoteNumber) {
            // [FIX 2026-06-19 SES-03/PDF-02] El correlativo ISO no respondió. NO emitir un folio
            // FANTASMA (CM-FR-004-...-FALLBACK-XXXX no queda en BD → viola ISO 9001 §7.5 y Zoho/CXM
            // no lo pueden correlacionar). Mejor: NO generar el PDF, avisar a Marcelo, y que el cliente
            // sepa que ya viene. Igual que channel-agent.js (IG/FB).
            log('error', 'generarPdf.correlativo', 'correlativo ISO no disponible — NO se emite PDF, se escala a Marcelo');
            await safe('generarPdf.correlativo.escalate', () =>
              notifyHighValue(enviarSinPausa, from, { data: { ...state }, history },
                '[whatsapp] cliente pidió su Propuesta Técnica Económica pero el correlativo ISO no respondió — emitirla desde el inbox (ops.activalabs.ai)'));
            return { ok: false, requiere_revision: true, reason: 'correlativo_no_disponible',
              message: 'Dame un momentito para emitir tu Propuesta Técnica Económica con su folio; si se demora, Marcelo te la hace llegar enseguida.' };
          }

          // Correlativo quemado → registrar (con firma de contenido) para el guard anti-duplicado.
          const _marcaQuote = { quote_number: quoteNumber, at: Date.now(), sig: _quoteSig };
          RECENT_QUOTES.set(from, _marcaQuote);
          // El respaldo sobrevive al redeploy. TTL corto: solo tiene que cubrir la ventana
          // de reintentos, no la vida del trato.
          try { await (deps.escribirEstado || escribirEstado)(_claveQuote, _marcaQuote, 15 * 60); }
          catch { /* el guardia en memoria sigue cubriendo esta instancia */ }
          if (RECENT_QUOTES.size > 500) RECENT_QUOTES.clear(); // backstop de memoria

          // ── 🎨 [2026-08-31] LOS FOLIOS DE LAS TRES OPCIONES, DE UNA SOLA VEZ ──
          // Un solo correlativo ISO y las variantes por LETRA: 0392 · 0392-B · 0392-C. Es el
          // mismo sufijo que ya existe desde el 26-ago (caso Paula) y esta VERIFICADO contra
          // la BD viva (31-ago): `quote_counters.last_seq = 391` con la fila
          // `CM-FR-004-2026-0391-B` presente ⇒ la letra NO consume correlativo, y cada letra
          // cae en su propia fila de `quotes` (el pisado por numero desaparece solo).
          // Pedir tres `next-number` en cambio quemaria 0392/0393/0394 para un mismo cliente.
          const _folios = _coloresTerna ? foliosDeOpciones(quoteNumber, _coloresTerna.length,
            Number((state.last_quote || {}).alternativas) || 0) : [];
          // Si por lo que sea no se pudieron componer las letras (folio raro, alfabeto
          // agotado), se sigue de largo con UNA sola propuesta: nunca se frena al cliente.
          if (_coloresTerna && _folios.length < 2) {
            log('warn', 'generarPdf.opciones', `${from}: no se pudieron componer las letras sobre ${quoteNumber}; sale una sola`);
            _coloresTerna = null;
          }

          // ── Paso 2: Generar PDF premium ──────────────────────────────────────
          const clientName  = atribucion?.name || input.name  || state.name  || push_name || 'Cliente';
          // [2026-08-08] La atribución del dueño manda por encima de todo: si escribió
          // "CLIENTE Juan +569…", la cotización es de Juan aunque la charla sea con él.
          const clientPhone = atribucion?.phone || input.phone || state.telefono || from;
          const clientComuna = input.comuna || state.comuna || '';

          // 🔴 [2026-08-30 · caso Alfredo, 4 reclamos] A NOMBRE DE QUIEN VA LA PROPUESTA.
          // Dos fuentes, y el orden importa: MANDA lo que capturo el codigo (state.receptor,
          // extraido literal de lo que escribio el cliente) y el LLM solo RELLENA lo que
          // falte —tipicamente la razon social cuando el cliente la dijo en otro mensaje—.
          // `fusionarReceptor(previo, nuevo)` hace ganar al `nuevo`, por eso el determinista
          // va segundo.
          //
          // ⛔ ANTI-ALUCINACION: venga de donde venga, el RUT vuelve a pasar por modulo 11
          // dentro de `receptorParaDocumento`. Si no cierra, sale vacio y el documento se
          // emite SIN RUT. Un RUT inventado por el modelo en una propuesta formal es un
          // problema legal: el cliente la lleva a facturar y no le cuadra.
          // Y por eso viaja `textoCliente`: la compuerta de procedencia exige que un dato de
          // origen 'llm' APAREZCA en lo que el cliente escribio. El modulo 11 dice si un RUT
          // esta bien escrito, no si alguien lo dijo — 1 de cada 11 numeros al azar lo pasa.
          const _receptorLLM = (input.rut || input.razon_social || input.cliente_tipo)
            ? {
              rut: String(input.rut || ''),
              razonSocial: String(input.razon_social || ''),
              clienteTipo: input.cliente_tipo === 'empresa' ? 'empresa'
                : (input.cliente_tipo === 'particular' ? 'particular' : ''),
              origen: 'llm',
            }
            : null;
          const receptorDoc = receptorParaDocumento(
            state.receptor ? fusionarReceptor(_receptorLLM, state.receptor) : _receptorLLM,
            { nombreFallback: clientName, textoCliente: userText }
          );
          // EL RECEPTOR SOBREVIVE AL TURNO. Si la razon social la aporto el LLM (porque el
          // cliente la escribio en un mensaje que el extractor no rotulo), sin esto se
          // perderia: `agent.handleTurn` saca la foto del estado AL EMPEZAR, asi que todo lo
          // que una tool escriba durante el turno queda afuera. Es el mismo defecto que ya
          // costo los relojes de los gates el 25-ago; se cierra igual, con el merge de mas
          // abajo (`if (state.receptor) newState.receptor = state.receptor`).
          if (receptorDoc) {
            state.receptor = fusionarReceptor(state.receptor, {
              clienteTipo: receptorDoc.clienteTipo,
              razonSocial: receptorDoc.razonSocial,
              rut: receptorDoc.rut,          // ya validado por modulo 11 (vacio si no cerro)
            });
          }

          const pdfData = {
            name:    clientName,
            // { nombre, razonSocial, rut, clienteTipo } o null. Sin receptor la propuesta se
            // imprime EXACTAMENTE como antes de este cambio.
            receptor: receptorDoc,
            phone:   clientPhone,
            comuna:  clientComuna,
            address: state.address || '',
            descuento_pct: Number(input.descuento_pct) || 0,   // descuento MANUAL adicional en la propuesta (0 = sin descuento)
            descuento_mercado_pct: descuentoMercadoPct,         // descuento de mercado YA aplicado a los precios (se MUESTRA al cliente)
            is_partial:   Boolean(input.is_partial),            // [2026-07-02 BUG parcial] parte del pedido escaló a Marcelo
            partial_note: String(input.partial_note || '').slice(0, 200),
            // 🎨 [2026-08-31] QUE OPCION ES ESTA — el PDF se identifica SOLO. El cliente abre
            // el archivo y ve "OPCIÓN A · COLOR BLANCO" arriba, sin tener que volver al chat.
            // `undefined` cuando no hay terna ⇒ el documento sale exactamente como siempre.
            opcion: _coloresTerna ? { letra: _folios[0].letra, color: _coloresTerna[0] } : undefined,
            default_color: (input.items?.[0]?.color) || state.default_color || '',
            items:   (input.items || []).map((it) => ({
              product:        it.producto_label || it.product || 'Ventana',
              producto_label: it.producto_label || it.product || 'Ventana',
              measures:       it.measures || '',
              color:          it.color || '',
              qty:            Number(it.qty) || 1,
              unit_price:     Number(it.unit_price) || 0,  // NUNCA inventado: viene del motor
              glass_label:    it.glass_label || 'Termopanel DVH',
              ambiente:       it.ambiente || '',
              termico:        it.termico || null,   // [thermal] Uw aditivo (null = no se muestra)
            })),
            quote_num: quoteNumber,
          };
          const pdfBuffer = await generatePdf(pdfData, quoteNumber);

          // ── 🎥 El video de cortesía, como FUNCIÓN: lo usan las DOS secuencias ─────
          // [2026-08-27 · #524] Antes vivía inline dentro de `if (docSent)` (el tablero lo
          // tenía anotado: "recablear candado, hoy vive dentro de docSent"). Es el MISMO
          // cuerpo, sin cambios de comportamiento: tanda, vistos-antes-de-enviar y
          // descarte de media_id vencido quedan idénticos. Solo cambia quién lo llama y
          // con qué espera.
          let videoCortesiaEnviado = false;
          const enviarVideoCortesia = async (demoraMs) => {
              videoCortesiaEnviado = true;
              const claveVistos = `videos_fabrica:vistos:${String(from).replace(/\D/g, '')}`;
              // Inyectable como todo lo demas: sin esto el caso "no hay ningun video
              // cargado" NO se puede probar. `mediaIdsDisponibles` cae al archivo del repo
              // si el KV viene vacio, asi que desde que `data/videos-media-ids.json` entro
              // (commit c4e3052) SIEMPRE devolvia los 6 ids y el test que cubria ese caso
              // quedo en rojo permanente, midiendo "sin ids en el KV" y no "sin ids".
              const ids = await (deps.mediaIdsDisponibles || mediaIdsDisponibles)(deps.leerEstado || leerEstado);
              const disponibles = Object.keys(ids);
              if (!disponibles.length) return;            // todavia no se subio ninguno

              // 🔴 [2026-08-26] UN VIDEO DE CORTESIA POR TANDA, NO UNO POR PDF. Medido dos
              // veces en la conversacion de Paula: pidio DOS cotizaciones (negra y blanca),
              // salieron dos PDF —los dos correctos— y detras salieron DOS VIDEOS. El bloque
              // vive dentro del envio del PDF, asi que se dispara una vez por documento.
              // Dos propuestas son dos documentos; dos videos de la fabrica son spam.
              const claveTanda = `video_tanda:${String(from).replace(/\D/g, '')}`;
              try {
                if (await (deps.leerEstado || leerEstado)(claveTanda)) return;
                await (deps.escribirEstado || escribirEstado)(claveTanda, true, 10 * 60);
              } catch { /* sin respaldo, el peor caso vuelve a ser el de hoy */ }

              const vistos = (await (deps.leerEstado || leerEstado)(claveVistos)) || [];
              const video = elegirVideo({ vistos, disponibles });
              if (!video) return;                          // ya los vio todos

              // 🔴 SE MARCA ANTES DE MANDAR, NO DESPUES. El orden viejo era leer → elegir →
              // ENVIAR → marcar, y entre el envio y la marca pasan segundos: dos pasadas leian
              // la MISMA lista y elegian EL MISMO video. Es exactamente lo que se midio — no
              // dos videos distintos, el mismo dos veces. Marcar primero invierte el riesgo
              // hacia el lado correcto: en el peor caso el cliente se pierde UN video de
              // cortesia; en el otro recibe dos iguales, que es lo que el dueño reporto.
              try {
                await (deps.escribirEstado || escribirEstado)(
                  claveVistos, [...vistos, video.id], 180 * 24 * 3600);
              } catch { /* sin respaldo queda el riesgo de hoy, no uno peor */ }

              // La espera humana la decide el llamador: 50 s tras la propuesta (secuencia
              // clasica, para no encimar tres mensajes) u 8 s entre informe y propuesta
              // (secuencia informe-primero).
              await esperarAntesDeEnviar({ dormir: deps.dormir || null, ms: demoraMs });
              const env = await (deps.sendWaVideo || realSendWaVideo)(from, ids[video.id], mensajeDelVideo(video));
              if (!env?.ok) {
                // Lo mas probable es un media_id vencido: se descarta para que la proxima
                // carga lo reponga, en vez de reintentar contra un id muerto.
                delete ids[video.id];
                try { await (deps.escribirEstado || escribirEstado)('videos_fabrica:media_ids', ids, 25 * 24 * 3600); } catch { /* se repone al re-subir */ }
                log('warn', 'generarPdf.video', `video ${video.id} no se entrego (${env?.error || 's/detalle'}) — id descartado`);
                return;
              }
              // (la marca ya quedo puesta ANTES del envio — ver arriba)
              safe('generarPdf.video.espejo', () => bridge.pushConversationEvent({
                channel: 'whatsapp', external_id: from, direction: 'outbound',
                actor_type: 'ai', actor_name: 'Oliver', message_type: 'video',
                body: `🎥 Video ${video.id} (${video.titulo}) enviado al cliente`,
                metadata: { source: 'oliver_gpt_video', video: video.id, media_id: ids[video.id] },
              }));
          };

          // ── 🌬️ El informe de VIENTOS (2o documento de la secuencia) ──────────────
          // [2026-08-28 · dueño: "dale, agrega el informe de vientos a la secuencia"].
          // Es un REGALO NO ANUNCIADO: el mensaje de valor no lo promete, así que si
          // THERMAL no tiene la ruta, falla o tarda, la secuencia sigue derecho y el
          // cliente no nota ningún hueco. Candado de 30 días por huella del proyecto
          // (mismo criterio anti-spam que el térmico). Folio serie LOCAL propia INF-V
          // mientras sales-os no tenga la serie CM-FR de vientos (tablero #541).
          const enviarInformeVientos = async () => {
            const _tel = String(from).replace(/\D/g, '');
            const ultimaV = (input.items || []).at(-1) || {};
            const _huellaV = huellaDelInforme({
              comuna: clientComuna, producto: ultimaV.producto_label || ultimaV.product || '',
              glassLabel: ultimaV.glass_label || '',
            });
            const claveV = _huellaV ? `informe_vientos:${_tel}:${_huellaV}` : `informe_vientos:${_tel}`;
            try {
              const _cand = await (deps.leerEstado || leerEstado)(claveV);
              const _resetAt = Number(await (deps.leerEstado || leerEstado)(`informe_reset:${_tel}`)) || 0;
              if (candadoVigente(_cand, _resetAt)) return 'ya_enviado';
            } catch { /* sin estado se sigue: mejor un posible repetido que ninguno */ }
            let tokenV = null;
            try {
              // [Copilot, compuerta] DOS NIVELES, como el térmico (lección de los folios
              // duplicados 0001/0002): primero el estado COMPARTIDO (cubre dos instancias
              // conviviendo en un deploy), después la reserva local atómica.
              if (await (deps.leerEstado || leerEstado)(`${claveV}:en_curso`)) return 'en_curso';
            } catch { /* si el compartido no responde, manda la reserva local */ }
            try {
              tokenV = (deps.reservarEstado || reservarEstado)(`${claveV}:en_curso`, 5 * 60) || null;
              if (!tokenV) return 'en_curso';
            } catch { /* se sigue */ }
            const soltarV = () => {
              if (!tokenV) return;
              const mio = tokenV; tokenV = null;
              try { (deps.liberarReserva || liberarReserva)(`${claveV}:en_curso`, mio); } catch { /* nada */ }
            };
            try {
              const { legibles, ilegibles } = (deps.ventanasParaVientos || ventanasParaVientos)(input.items || []);
              if (!legibles.length) { soltarV(); return 'sin_datos'; }
              const datosV = await (deps.pedirVientos || pedirVientos)({
                comuna: clientComuna, cliente: clientName, ventanas: legibles,
              });
              if (!datosV) { soltarV(); return 'fallo'; }
              // Folio local visible y fuera de banda (declarado, no disfrazado de CM-FR).
              const folioV = `INF-V-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-`
                + `${Date.now().toString(36).toUpperCase().slice(-4)}`;
              const pdfV = await (deps.generarInformeVientosPdf || generarInformeVientosPdf)(datosV, {
                nombre: clientName,
                // [2026-08-30] El mismo receptor que la propuesta: los tres documentos de la
                // tanda salen a nombre de quien corresponde, no dos con RUT y uno sin.
                // `receptorDoc` ya viene validado por modulo 11; si es null, `{...null}` es
                // `{}` y el informe queda identico a como salia antes.
                ...(receptorDoc || {}),
                comuna: clientComuna, numeroInforme: folioV,
                ilegibles, firma: FIRMA,
              });
              if (!pdfV) { soltarV(); return 'fallo'; }
              await esperarAntesDeEnviar({ dormir: deps.dormir || null, ms: SEQ_VIENTOS_MS });
              const archivoV = `Informe-Vientos-${String(clientComuna || 'proyecto').replace(/\s+/g, '-')}.pdf`;
              const mediaV = await uploadWaDocument(pdfV, archivoV);
              let envioV = null;
              // [Codex, compuerta] El caption promete clima SOLO si el bloque vino del motor.
              const traeClimaV = Boolean(datosV.clima && !datosV.clima._hueco);
              if (mediaV) envioV = await sendWaDocument(from, mediaV, archivoV, traeClimaV ? 'Informe de vientos y clima de sus ventanas' : 'Informe de vientos de sus ventanas');
              if (!(mediaV && envioV && envioV.ok === true)) {
                log('warn', 'generarPdf.vientos', `informe de vientos ${folioV} NO se entrego: el proximo proyecto reintenta`);
                soltarV(); return 'fallo';
              }
              try { await (deps.escribirEstado || escribirEstado)(claveV, { at: Date.now() }, 30 * 24 * 3600); }
              catch { /* el candado largo es anti-spam, no entrega */ }
              tokenV = null;   // entregado: la reserva corta muere sola, sin reabrir ventana
              safe('generarPdf.vientos.espejo', () => bridge.pushConversationEvent({
                channel: 'whatsapp', external_id: from, direction: 'outbound',
                actor_type: 'ai', actor_name: 'Oliver', message_type: 'document',
                body: `📄 Informe de vientos ${folioV} (${clientComuna || 'proyecto'}) enviado al cliente`,
                metadata: { source: 'oliver_gpt_informe_vientos', informe_number: folioV,
                            filename: archivoV, media_id: mediaV },
              }));
              safe('generarPdf.vientos.registro', () => (deps.saveMedia || saveMedia)({
                phone: from, direction: 'outbound', mediaType: 'document',
                mimeType: 'application/pdf',
                filename: archivoV.replace(/\.pdf$/i, `-${folioV}.pdf`),
                buffer: pdfV, waMediaId: mediaV,
                aiDescription: `Informe de vientos ${folioV} (${clientComuna || 'proyecto'})`,
              }));
              return 'enviado';
            } catch (e) {                                     // noqa
              log('error', 'generarPdf.vientos', e?.message || e);
              soltarV(); return 'fallo';
            }
          };

          // ── 🧪 SECUENCIA INFORME-PRIMERO (Variante B · #524) — flag + lista blanca ──
          // Orden aprobado por el dueño (27-ago): mensaje de valor → informe → video →
          // recién ahí la propuesta con el precio. *"Si le entregamos el precio, el
          // cliente ve precio y no ve nada más."* El instante de decisión NO cambia (el
          // proyecto ya está completo acá, folio y PDF ya emitidos); cambia el ORDEN de
          // envío. Techo duro SEQ_INFORME_TIMEOUT_MS: informe lento o caído ⇒ la
          // propuesta sale igual — el cliente jamás se queda sin su PDF.
          // 🔴 [Codex, compuerta] El gate va DENTRO de un try propio: si el hook inyectable
          // lanzara, el safe('generarPdf') exterior devolvería null y el cliente se
          // quedaría SIN propuesta — exactamente lo que esta secuencia jura no hacer.
          let modoInformePrimero = false;
          try { modoInformePrimero = Boolean((deps.secuenciaInformePrimero || secuenciaInformePrimero)(from)); }
          catch (e) { log('error', 'generarPdf.secuencia.gate', e?.message || e); }
          if (modoInformePrimero) {
            try {
              const nombreCorto = String(clientName || '').trim().split(/\s+/)[0] || '';
              const comunaValor = clientComuna || 'su comuna';
              // El copy es el APROBADO en PROPUESTA-FLUJO-VENTA-OLIVER-2026-08-27 §2 paso 3
              // (pasó el guardián de claims, incluido el ajuste Codex de condensación).
              // No se redacta acá: se interpola nombre y comuna, nada más.
              // 🔴 Es FUNCIÓN de esRef (Codex, compuerta): si la comuna cae a la referencia
              // regional, el punto 1 no puede prometer "el límite para {comuna}" — el
              // mensaje dice lo mismo que va a decir el PDF, siempre.
              // [Dueño, 27-ago — doctrina, textual] *"Los clientes no saben leer siglas.
              // Tampoco se deben preparar para comprarnos ventanas: NOSOTROS debemos
              // prepararlos para poder venderles."* Y su afinación: *"la idea es que
              // coloques las siglas pero las expliques antes"*. ⇒ REGLA DEL COPY: cada
              // sigla o norma aparece DESPUÉS de su explicación en palabras — el concepto
              // primero, la sigla como su nombre corto. El informe se ENTREGA explicado,
              // no se asigna como tarea.
              const mensajeValor = (esRef, datos) => {
                const zonaNCh = String(datos?.zona_termica_NCh1079 || '').trim();
                const zonaTxt = zonaNCh && !esRef
                  ? `, que está en zona térmica ${zonaNCh} según la clasificación oficial chilena (la norma NCh 1079)`
                  : '';
                // [Dueño, 27-ago] SIN guiones largos ("con esto se ve falso") + los tres
                // titulares en NEGRITA de WhatsApp (*texto*) + el especialista presentado
                // con su credencial formal: ingeniero + Resolución 266/2025 (respaldada en
                // docs; el "EXENTA N°63" NO está verificado y queda fuera, regla del
                // guardián de claims).
                return `Perfecto${nombreCorto ? `, ${nombreCorto}` : ''}. Mientras le preparo su Propuesta Técnica Económica, ` +
                `le adelanto el informe térmico de sus ventanas ${esRef ? 'para su zona' : `en ${comunaValor}`}, ` +
                `para que lo mire con calma. Se lo dejamos explicado en simple:\n` +
                `1) *Cuánto aíslan del frío sus ventanas:* la transmitancia térmica, que en el informe aparece ` +
                `como "Uw" (mientras más bajo, mejor aísla), y lo que exige la norma ` +
                `${esRef ? 'como referencia regional de La Araucanía' : `en su comuna${zonaTxt}`}.\n` +
                // [Dueño, 27-ago] El separador con su credencial (certificación alemana
                // Passive House — dato del dueño, dueño = fuente de los datos de producto)
                // y el MECANISMO explicado: el borde cálido RETIENE la temperatura interior
                // donde el aluminio la pierde. La comparación aluminio vs warm-edge viene
                // dibujada en el propio informe (lámina de THERMAL). Guardián de claims:
                // "probabilidad muy baja EN EL BORDE", jamás "cero condensación".
                `2) *Por qué con una buena ventana la condensación baja muchísimo:* nuestro termopanel usa un ` +
                `separador de borde cálido llamado warm-edge, con certificación del instituto alemán Passive House, ` +
                `que mantiene el borde del vidrio a mayor temperatura interior en vez de perderla, como pasa con el ` +
                `separador de aluminio. Por eso la probabilidad de condensación en el borde queda muy baja, y la ` +
                `comparación entre ambos viene explicada en el mismo informe.\n` +
                `3) *Nuestro especialista:* el ingeniero Marcelo Cifuentes, evaluador energético acreditado por el ` +
                `Ministerio de Vivienda (MINVU) mediante la Resolución 266/2025, responde por cada cálculo. ` +
                `Y las ventanas salen de nuestra propia fábrica en Temuco, no de un revendedor.\n\n` +
                // [Dueño, 27-ago] La puerta abierta, con su redacción textual.
                `Y si quiere que le explique cualquier parte del informe, me comenta por favor, estaré muy atento.`;
              };
              // [Dueño, 28-ago] LA VARIANTE CORTA para cuando el discurso completo ya salió
              // hace poco (cliente que agrega o cambia una ventana minutos después — su
              // prueba de Toltén recibió el speech entero DOS veces en 4 minutos). Misma
              // doctrina: sin siglas nuevas, sin guiones largos, formal pero cercano.
              // [Copilot, compuerta] Sin afirmar continuidad de proyecto (la marca es por
              // TELÉFONO a 12 h: puede ser otro proyecto del mismo número) y sin
              // "enseguida" (la secuencia completa toma ~2 minutos a propósito).
              const mensajeValorCorto = () =>
                `Perfecto${nombreCorto ? `, ${nombreCorto}` : ''}. Le dejo los informes del proyecto al día, ` +
                `para que los compare con calma, y en unos minutos le llega su Propuesta Técnica Económica.`;
              // Las MISMAS ventanas que declara la propuesta (mismo mapeo que el camino
              // clasico de abajo): informe y propuesta tienen que decir lo mismo siempre.
              const ventanasProyecto = (input.items || []).map((it) => ({
                producto: it.producto_label || it.product || '',
                medidas: it.measures_original || it.measures || '',
                vidrio: it.glass_label || '',
                ambiente: it.ambiente || '',
                cantidad: it.qty,
                uw: it.termico?.uw ?? null,
              }));
              const ultima = (input.items || []).at(-1) || {};
              // Inyectable en test (120 s reales harian imposible probar el camino del techo).
              const techoInformeMs = Number(deps.seqInformeTimeoutMs ?? SEQ_INFORME_TIMEOUT_MS);
              let venceTimeout = null;
              const resultadoInforme = await Promise.race([
                despacharInforme(clientComuna || state.comuna || '', {
                  ventanas: ventanasProyecto,
                  glassLabel: ultima.glass_label || '',
                  uw: ultima.termico?.uw ?? null,
                  producto: ultima.producto_label || ultima.product || '',
                  mensajePrevio: mensajeValor,
                  mensajePrevioCorto: mensajeValorCorto,
                  // [Codex, compuerta] El folio YA está emitido acá: viaja al registro ISO
                  // del informe, que en esta secuencia corre antes de que exista last_quote.
                  quoteNumber,
                  // [Dueño, 27-ago] El nombre del cliente al PDF del informe ("Preparado
                  // para:") — en esta secuencia state.name aún no existe.
                  nombre: clientName,
                  // [Codex, re-pase] El deadline del race viaja al despacho: el piso de
                  // ritmo se recorta para no cruzar el techo (15 s de margen para el
                  // upload). Sin esto, el térmico podía caer después del precio.
                  noDespuesDe: Date.now() + Math.max(0, techoInformeMs - 15_000),
                }),
                new Promise((res) => { venceTimeout = setTimeout(() => res('timeout'), techoInformeMs); }),
              ]).finally(() => { if (venceTimeout) clearTimeout(venceTimeout); });
              log('info', 'generarPdf.secuencia', `${from}: informe-primero → ${resultadoInforme || 'sin_resultado'}`);
              if (resultadoInforme === 'enviado') {
                // 🌬️ Paso 5-bis: el INFORME DE VIENTOS, después del térmico y antes del
                // video. Con su propio techo: regalo que jamás retiene el precio.
                // El techo cubre pausa + motor + PDF + envío: con la pausa de ritmo en
                // 25 s, un techo fijo de 30 s la habría convertido en timeout permanente.
                const techoVientosMs = Number(deps.seqVientosTimeoutMs ?? (SEQ_VIENTOS_MS + 30_000));
                let venceVientos = null;
                const resVientos = await Promise.race([
                  safe('generarPdf.vientos.secuencia', () => enviarInformeVientos()),
                  new Promise((res) => { venceVientos = setTimeout(() => res('timeout'), techoVientosMs); }),
                ]).finally(() => { if (venceVientos) clearTimeout(venceVientos); });
                log('info', 'generarPdf.secuencia', `${from}: vientos → ${resVientos || 'sin_resultado'}`);

                // Paso 6 de la secuencia: el video cae ENTRE el informe y la propuesta.
                // 🔴 [Codex P1, compuerta] CON SU PROPIO TECHO. El techo del informe no
                // cubre este await: un sendWaVideo colgado dejaba al cliente SIN PROPUESTA.
                // Si el video se cuelga, se sigue de largo — el candado de tanda ya quedó
                // puesto y en el peor caso el cliente pierde un video de cortesía, no el precio.
                const techoVideoMs = Number(deps.seqVideoTimeoutMs ?? (SEQ_VIDEO_MS + 45_000));
                let venceVideo = null;
                await Promise.race([
                  safe('generarPdf.video.secuencia', () => enviarVideoCortesia(SEQ_VIDEO_MS)),
                  new Promise((res) => { venceVideo = setTimeout(res, techoVideoMs); }),
                ]).finally(() => { if (venceVideo) clearTimeout(venceVideo); });
                // 🔴 [Gemini, compuerta + dueño "dale pausa"] AIRE ANTES DEL PRECIO — con
                // video o sin él. Sin esto, el precio caía 9 s después del informe (medido
                // en la prueba real del 27-ago): el cliente recién abría el documento y ya
                // tenía la propuesta encima. Solo en el camino 'enviado': un informe
                // repetido o caído no gana demora.
                await esperarAntesDeEnviar({ dormir: deps.dormir || null, ms: SEQ_PRECIO_MS });
              }
              // 'ya_enviado' / 'en_curso' / 'timeout' / 'fallo': se sigue derecho a la
              // propuesta. En timeout el informe puede llegar después por su cuenta —
              // ese es el comportamiento clasico de hoy, no un estado nuevo.
            } catch (e) {
              // JAMÁS bloquea la propuesta: el peor resultado posible de esta secuencia
              // sería un cliente sin precio, y ese resultado no existe por diseño.
              log('error', 'generarPdf.secuencia', e?.message || e);
            }
          }

          // ── Paso 2-bis: EL ANTICIPO, antes del documento ─────────────────────
          // [Dueño, 28-ago, textual] *"antes de enviar el archivo al cliente... deberíamos
          // decirle al principio, por ejemplo: esta propuesta considera V1 1200x1000
          // CORREDERA... para que nos corrija el cliente si las medidas están al revés"* +
          // *"que sepa si es corredera, proyectante, oscilobatiente... y el color igual"*.
          // El resumen que vivía pegado al cierre ("Le coticé:") SE MOVIÓ acá, con el
          // ancho y el alto nombrados. Si el envío del texto falla, el PDF sale igual:
          // el anticipo es una cortesía, no una compuerta.
          try {
            let anticipo = anticipoDeLoCotizado(input.items);
            // 🎨 [2026-08-31] Y SI VAN TRES, SE AVISA ANTES DE MANDARLAS. Tres PDF seguidos
            // sin explicacion se leen como un bot trabado (es literalmente lo que paso con
            // Jessica el 08-ago y con Paula el 26-ago). Primero se dice que vienen tres y de
            // que color; el mapeo con folio y letra va en el cierre, cuando ya llegaron.
            if (anticipo && _coloresTerna) {
              const _previo = avisoPrevioOpciones(_coloresTerna);
              if (_previo) anticipo = `${anticipo}\n\n${_previo}`;
            }
            if (anticipo) {
              const antEnv = await enviarSinPausa(from, anticipo);
              if (antEnv?.ok === true) {
                safe('generarPdf.espejo.anticipo', () => bridge.pushConversationEvent({
                  channel: 'whatsapp', external_id: from, direction: 'outbound',
                  actor_type: 'ai', actor_name: 'Oliver', message_type: 'text',
                  body: anticipo,
                  metadata: { source: 'oliver_gpt_anticipo_propuesta', quote_number: quoteNumber },
                }));
                // Aire para LEERLO antes de que el documento tape el mensaje.
                await esperarAntesDeEnviar({ dormir: deps.dormir || null, ms: ANTICIPO_MS });
              }
            }
          } catch (e) { log('error', 'generarPdf.anticipo', e?.message || e); }

          // ── Paso 3: Enviar al cliente vía WhatsApp ───────────────────────────
          const filename = `${quoteNumber}.pdf`;
          const caption  = `Propuesta Técnica Económica N° ${quoteNumber} · Activa Inversiones`;
          let waDocMediaId = null;
          let waDocMsgId = null;   // id de Meta: con el se interpreta el acuse que llega despues
          let docSent = false;   // ← refleja el ENVÍO REAL (sendWaDocument.ok), no solo el upload
          try {
            waDocMediaId = await uploadWaDocument(pdfBuffer, filename);
            const sendRes = await sendWaDocument(from, waDocMediaId, filename, caption);
            // sendWaDocument NO lanza: devuelve {ok:false} si Meta rechaza → hay que leerlo.
            docSent = !!(sendRes && sendRes.ok);
            waDocMsgId = sendRes?.msgId || null;
            if (docSent) {
              // La propuesta formal salió: la atribución ya cumplió su función.
              if (atribucion) atribucionConsumida = true;
              log('info', 'generarPdf.wa', `PDF enviado a ${from} media_id=${waDocMediaId} msgId=${sendRes.msgId || '?'}`);
            } else {
              log('error', 'generarPdf.wa', `Documento NO entregado a ${from}: ${sendRes?.error || 'sin detalle'}`);
            }
          } catch (err) {
            log('error', 'generarPdf.wa', err);
            // No bloqueamos: el CRM/conversión se disparan igualmente.
          }

          // ── Paso 3a: GUARDAR el PDF en sales-os para que el operador lo ABRA desde el cockpit ──
          // [FIX 2026-06-19] Antes el link /api/v5/media/{wa_media_id} daba "not found": el PDF se enviaba a
          // WhatsApp pero NUNCA se guardaba en media_attachments. Ahora lo subimos (base64) con el MISMO
          // wa_media_id que usa el espejo → el cockpit lo encuentra y lo muestra. (PDFs ya enviados antes
          // de este fix no se pueden recuperar; aplica a los nuevos.)
          safe('generarPdf.storeMedia', async () => {
            if (!SALES_OS_URL) return;
            await fetch(`${SALES_OS_URL}/api/v5/media/store`, {
              method: 'POST',
              headers: { 'x-api-key': OPERATOR_TOKEN, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                phone: from, direction: 'outbound', media_type: 'document', mime_type: 'application/pdf',
                filename, wa_media_id: waDocMediaId || '', media_base64: pdfBuffer.toString('base64'),
                file_size: pdfBuffer.length, ai_description: `Propuesta ${quoteNumber}`,
              }),
              signal: AbortSignal.timeout(15000),
            });
          });

          // ── 🔴 Paso 3a·bis: EL INFORME TERMICO, CON EL PROYECTO COMPLETO ─────
          // [2026-08-24] Antes salia desde `calcular_cotizacion`, y despues desde el cierre
          // del turno. Las dos estaban mal por la misma razon: EL CLIENTE ARMA SU PROYECTO A
          // LO LARGO DE VARIOS MENSAJES. Alejandro (24-ago) dio sus 10 ventanas en 5 turnos
          // distintos —living, 3 de 2x60, 4 de 1.50x35, 2 de baño— asi que ni una cotizacion
          // ni un turno tienen el proyecto entero; su informe salio con UNA ventana.
          //
          // La propuesta SI lo tiene: el sistema acumula las partidas entre turnos en
          // `pending_quote.items` desde jun-2026. Y en este punto ya se les calculo el
          // `termico` a TODAS (arriba, con priceAllEngine). Enganchar aca hace ademas que el
          // informe y la propuesta declaren SIEMPRE las mismas ventanas, que es lo que un
          // auditor va a comparar.
          //
          // ⚠️ Revierte la decision del 21-ago ("se dispara al cotizar y NO en el PDF, ya
          // seria tarde"), con el OK del dueño: un informe con una ventana de diez es peor
          // que uno que llega medio minuto despues. Va DESPUES de la entrega confirmada de
          // la propuesta y fire-and-forget: no puede demorar ni tumbar el PDF.
          // [2026-08-27 · #524] En modo informe-primero el despacho ya ocurrió ANTES de la
          // propuesta (y sus candados cubrirían igual un doble disparo): no se repite.
          if (docSent && !modoInformePrimero) {
            try {
              const ventanasProyecto = (input.items || []).map((it) => ({
                producto: it.producto_label || it.product || '',
                medidas: it.measures_original || it.measures || '',
                vidrio: it.glass_label || '',
                ambiente: it.ambiente || '',
                cantidad: it.qty,                 // CRUDA: el supuesto se marca en resumenVentanas
                uw: it.termico?.uw ?? null,
              }));
              const ultima = (input.items || []).at(-1) || {};
              despacharInforme(input.comuna || state.comuna || '', {
                ventanas: ventanasProyecto,
                // El resumen sale de la ULTIMA ventana del proyecto, los tres campos
                // juntos: tomarlos por separado dejaba `producto` de una y `uw` de otra.
                glassLabel: ultima.glass_label || '',
                uw: ultima.termico?.uw ?? null,
                producto: ultima.producto_label || ultima.product || '',
                // [Dueño, 27-ago] El nombre también en el camino clásico: state.name puede
                // venir vacío en el mismo turno en que el cliente recién lo dio.
                nombre: clientName,
              });
            } catch (e) { log('error', 'generarPdf.informeTermico', e?.message || e); }
          }

          // Mismo rastro para la PROPUESTA: un `failed` aca es una venta detenida, y
          // hasta hoy tampoco se veia.
          if (docSent && waDocMsgId) {
            try {
              await (deps.escribirEstado || escribirEstado)(`wamsg:${waDocMsgId}`, {
                msgId: waDocMsgId, tipo: 'propuesta', folio: quoteNumber, telefono: String(from),
              }, 3 * 24 * 3600);
            } catch { /* solo se pierde el diagnostico */ }
          }

          // ── 🎥 Paso 3a·ter: UN VIDEO DE LA FABRICA, PARA QUE NOS CONOZCA ─────
          // Pedido del dueño: *"que Oliver pueda enviar al cliente después de enviar la
          // propuesta y diga algo para que nos conozca"*.
          //
          // 💾 Su condicion —*"que no gaste almacenamiento de nosotros"*— se cumple con el
          // `media_id`: el video se subio UNA vez a Meta (tools/subir-videos-wa.mjs) y aca
          // solo se usa ese id de ~40 caracteres. El archivo lo aloja Meta.
          //
          // Va fire-and-forget y con espera humana: el video es un regalo, la propuesta es
          // la venta. Nunca puede demorarla ni tumbarla. Si el media_id caduco (~30 dias),
          // el envio falla, se descarta ese id y el proximo `subir-videos-wa` lo repone.
          // [2026-08-27 · #524] El cuerpo vive arriba en `enviarVideoCortesia` (lo comparte
          // la secuencia informe-primero). Si esa secuencia YA lo despachó en este turno,
          // acá no se repite — además del candado de tanda, que cubriría igual.
          if (docSent && !videoCortesiaEnviado) {
            safe('generarPdf.video', () => enviarVideoCortesia(DEMORA_VIDEO_MS));
          }

          // ── Paso 3b: ESPEJO al dashboard (visibilidad del PDF) ───────────────
          // FIX 2026-06-15: el dashboard solo reflejaba TEXTO → el operador veía "Te envié
          // el PDF" pero NO el archivo ("no está en ninguna parte"), aunque Meta lo aceptara
          // (msgId en el log). Ahora empujamos un evento message_type:'document' para que el
          // PDF SEA VISIBLE en el CRM (Oliver), con el estado real de entrega.
          safe('generarPdf.mirror', () => bridge.pushConversationEvent({
            channel:      'whatsapp',
            external_id:  from,
            direction:    'outbound',
            actor_type:   'ai',
            actor_name:   'Oliver',
            message_type: 'document',
            body:         docSent
              ? `📄 Propuesta ${filename} enviada al cliente`
              : `⚠️ Propuesta ${filename} NO se pudo entregar al cliente`,
            metadata: { source: 'oliver_gpt_pdf', quote_number: quoteNumber, filename,
                        media_id: waDocMediaId, pdf_sent: docSent },
          }));

          // ── 🎨 Paso 3b·bis: LAS OTRAS DOS PROPUESTAS (opciones B y C) ────────
          // [2026-08-31 · DECISION DEL DUEÑO] *"entregar 3 propuestas tecnica economicas una
          // blanco, nogal y new black"*. La A ya salio por el camino de arriba; aca salen las
          // otras dos. Van DESPUES de la A a proposito: la primera propuesta es la que arrastra
          // todo lo que cuelga de una venta (Zoho, informe termico, video, conversion) y no se
          // le puede agregar latencia por delante.
          //
          // 🛟 CADA UNA AISLADA DE LA OTRA. Instruccion explicita: si una de las tres falla, las
          // otras salen igual y queda registrado cual fallo. Por eso el `try` esta DENTRO del
          // bucle y no alrededor: una excepcion en la B no puede llevarse la C.
          //
          // ⛔ EL PRECIO DE CADA COLOR SE LE PIDE AL MOTOR, NUNCA SE DERIVA. Un Nogal NO es "el
          // blanco mas un porcentaje": es otra cotizacion. Si el motor no devuelve un precio
          // propio para ESE color en TODOS los items, la opcion se descarta entera — antes que
          // emitir un documento formal con la etiqueta de un color y el precio de otro. Es la
          // regla anti-alucinacion del proyecto aplicada al caso: si falta un dato, se marca,
          // no se rellena. Cotizar de nuevo no cuesta plata: el motor es LOCAL (quoteEngine.js).
          const _opcionesEntregadas = [];
          if (_coloresTerna && _folios.length > 1) {
            if (docSent) _opcionesEntregadas.push({ letra: _folios[0].letra, color: _coloresTerna[0], numero: quoteNumber,
              total: (input.items || []).reduce((s, it) => s + (Number(it.unit_price) || 0) * (Number(it.qty) || 1), 0) });
            for (let _i = 1; _i < _folios.length && _i < _coloresTerna.length; _i++) {
              const _colorOp = _coloresTerna[_i];
              const _numOp   = _folios[_i].numero;
              const _letraOp = _folios[_i].letra;
              try {
                // 1) Precio REAL del motor para ESTE color. Mismo shape de sonda que el
                //    blindaje label↔precio de mas arriba (probado), con TODOS los items y con
                //    la composicion/orientacion, para que una compuesta no se re-cotice como
                //    un pano suelto.
                const _sonda = {
                  items: (input.items || []).map((it) => ({
                    product:     it.producto_label || it.product || 'Ventana',
                    measures:    _measuresForEngine(it),
                    color:       _colorOp,
                    qty:         Number(it.qty) || 1,
                    ambiente:    it.ambiente || '',
                    descripcion: it.descripcion || it.ambiente || '',
                    orientacion: it.compuesta?.orientacion || it.orientacion || undefined,
                    partes:      Array.isArray(it.compuesta?.partes) ? it.compuesta.partes : undefined,
                  })),
                  comuna: input.comuna || state.comuna || '',
                  texto_cliente: _textoCliente,
                };
                await priceAllFn(_sonda);
                const _todosConPrecio = _sonda.items.length === (input.items || []).length
                  && _sonda.items.every((x) => Number(x.unit_price) > 0 && x.confidence === 'high');
                if (!_todosConPrecio) {
                  log('error', 'generarPdf.opcion',
                    `${from}: opcion ${_letraOp} (${_colorOp}) DESCARTADA — el motor no cotizo ese color para todos los items; ${_numOp} no se emite`);
                  continue;
                }

                // 2) El documento. Se parte del MISMO `pdfData` de la opcion A (cliente,
                //    receptor/RUT, descuentos, comuna) y solo se cambian color, precios y
                //    folio: asi las tres propuestas son la misma propuesta, no tres distintas.
                const _pdfOp = {
                  ...pdfData,
                  quote_num: _numOp,
                  default_color: _colorOp,
                  opcion: { letra: _letraOp, color: _colorOp },
                  items: (input.items || []).map((it, k) => {
                    const _p = _sonda.items[k] || {};
                    return {
                      product:        _p.producto_label || it.producto_label || it.product || 'Ventana',
                      producto_label: _p.producto_label || it.producto_label || it.product || 'Ventana',
                      // La MEDIDA que ve el cliente sale del item original (ya corregida por el
                      // bloque termico si venia dada vuelta), no del formato interno "AxBmm".
                      measures:       it.measures || '',
                      color:          _colorOp,
                      qty:            Number(it.qty) || 1,
                      unit_price:     Number(_p.unit_price) || 0,   // del motor, para ESTE color
                      glass_label:    _p.glass_label || it.glass_label || 'Termopanel DVH',
                      ambiente:       it.ambiente || '',
                      termico:        _p.termico || null,
                      compuesta:      _p.compuesta || it.compuesta || undefined,
                      hoja_mm:        Number(it.hoja_mm) || undefined,
                    };
                  }),
                };
                const _bufOp = await generatePdf(_pdfOp, _numOp);
                const _fileOp = `${_numOp}.pdf`;
                const _totalOp = _pdfOp.items.reduce((s, it) => s + (Number(it.unit_price) || 0) * (Number(it.qty) || 1), 0);

                // 3) Entrega. Un fallo de envio NO descarta el documento: ya existe, tiene
                //    folio y queda registrado (abajo) como emitido-no-entregado. Lo que si
                //    hace es no nombrarlo en el mensaje: prometerle al cliente un archivo que
                //    no le llego es peor que no mencionarlo.
                let _mediaOp = null;
                let _sentOp = false;
                try {
                  _mediaOp = await uploadWaDocument(_bufOp, _fileOp);
                  const _resOp = await sendWaDocument(from, _mediaOp, _fileOp,
                    `Propuesta Técnica Económica N° ${_numOp} · Opción ${_letraOp} — ${_colorOp} · Activa Inversiones`);
                  _sentOp = !!(_resOp && _resOp.ok);
                } catch (e) { log('error', 'generarPdf.opcion.envio', e?.message || e); }
                if (_sentOp) _opcionesEntregadas.push({ letra: _letraOp, color: _colorOp, numero: _numOp, total: _totalOp });
                else log('error', 'generarPdf.opcion', `${from}: opcion ${_letraOp} (${_colorOp}) ${_numOp} NO se pudo entregar`);

                // 4) Que el operador la vea en el cockpit igual que la A (archivo + espejo).
                safe('generarPdf.opcion.storeMedia', async () => {
                  if (!SALES_OS_URL) return;
                  await fetch(`${SALES_OS_URL}/api/v5/media/store`, {
                    method: 'POST',
                    headers: { 'x-api-key': OPERATOR_TOKEN, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      phone: from, direction: 'outbound', media_type: 'document', mime_type: 'application/pdf',
                      filename: _fileOp, wa_media_id: _mediaOp || '', media_base64: _bufOp.toString('base64'),
                      file_size: _bufOp.length, ai_description: `Propuesta ${_numOp} · opción ${_letraOp} ${_colorOp}`,
                    }),
                    signal: AbortSignal.timeout(15000),
                  });
                });
                safe('generarPdf.opcion.mirror', () => bridge.pushConversationEvent({
                  channel: 'whatsapp', external_id: from, direction: 'outbound',
                  actor_type: 'ai', actor_name: 'Oliver', message_type: 'document',
                  body: _sentOp
                    ? `📄 Propuesta ${_fileOp} (opción ${_letraOp} · ${_colorOp}) enviada al cliente`
                    : `⚠️ Propuesta ${_fileOp} (opción ${_letraOp} · ${_colorOp}) NO se pudo entregar`,
                  metadata: { source: 'oliver_gpt_pdf_opcion', quote_number: _numOp, filename: _fileOp,
                              media_id: _mediaOp, pdf_sent: _sentOp, opcion: _letraOp, color: _colorOp },
                }));

                // 5) SU PROPIA FILA EN `quotes` — trazabilidad ISO. Sin esto pasa lo del caso
                //    Paula: dos documentos con el mismo numero, la fila se busca por
                //    `(tenant_id, quote_number)` y el segundo PISA al primero, asi que la
                //    cotizacion que el cliente tiene en la mano no existe en el registro.
                //
                // 🔴 `status: 'alternativa'` Y NO 'sent', A PROPOSITO — ESTO TOCA PLATA.
                //    `fireConversion` (sales-os/src/server.js:539) mapea SOLO
                //    sent/formal_sent/diagnostico/accepted/won. Cualquier otro estado guarda la
                //    fila y NO dispara conversion. Es exactamente lo que se necesita: **un
                //    cliente que no eligio color es UNA oportunidad, no tres**. Reportarle tres
                //    quote_sent a Meta/Google por un solo lead le enseña al algoritmo que ese
                //    trafico convierte el triple de lo que convierte, y el algoritmo reparte el
                //    presupuesto con eso. La conversion la dispara SOLO la opcion A, en el Paso
                //    6, con el mismo valor que tenia la blanca de antes: para el algoritmo, este
                //    cambio es invisible. Y de yapa, tampoco se triplican el seguimiento
                //    automatico ni el TTL, que cuelgan del mismo 'sent'.
                //
                // ⚠️ ORDEN: estas van ANTES del 'sent' de la opcion A (Paso 6), asi la etapa
                //    del embudo de la conversacion termina en 'sent' y no en 'alternativa'.
                //    Doble red: `upsertConversation` tiene el guardia "el embudo no retrocede"
                //    (conversationService.js:112) y 'alternativa' puntua 0, asi que aunque el
                //    orden se invirtiera nunca podria pisar un 'sent'. Se await a proposito.
                await safe('generarPdf.opcion.registro', () => bridge.pushQuoteEvent({
                  phone:         clientPhone,
                  channel:       'whatsapp',
                  customer_name: clientName,
                  amount_total:  _totalOp,
                  currency:      'CLP',
                  status:        'alternativa',
                  quote_number:  _numOp,
                  receptor:      receptorDoc || null,
                  // Que fue esta fila y de que documento es hermana: sin esto, dentro de un mes
                  // nadie sabe por que hay tres folios seguidos para el mismo cliente.
                  variante: { letra: _letraOp, color: _colorOp, base: _folios[0].numero,
                              motivo: 'cliente_no_declaro_color', pdf_sent: _sentOp },
                  items: _pdfOp.items.map((it) => ({
                    producto: it.producto_label || null,
                    medidas:  it.measures || null,
                    cantidad: Number(it.qty) || 1,
                    unitario: Number(it.unit_price) || null,
                    color:    it.color || null,
                    vidrio:   it.glass_label || null,
                    ambiente: it.ambiente || null,
                    uw:       it.termico?.uw ?? null,
                  })),
                  // El MISMO lead que la opcion A: es un solo cliente. Sin `lead`,
                  // `quoteService.upsertQuote` deja `lead_id` NULL y el JOIN quotes→leads
                  // se rompe para estas filas.
                  lead: {
                    source: 'oliver_gpt', channel: 'whatsapp',
                    lead_name: clientName || null, name: clientName || null,
                    phone: clientPhone || from || null,
                    comuna: clientComuna || null, city: clientComuna || null,
                    status: 'quoted', external_id: from || null,
                  },
                  // ⛔ SIN click-ids. No los necesita (no dispara conversion) y mandarlos
                  // invitaria a que alguien "arregle" el status mañana y triplique el reporte.
                }));
              } catch (e) {
                log('error', 'generarPdf.opcion.err', `${_letraOp} (${_colorOp}) ${_numOp}: ${e?.message || e}`);
              }
            }
            // Las letras quedan CONSUMIDAS aunque una haya fallado: reciclar la B despues
            // pondria dos documentos distintos bajo el mismo numero, que es el pisado que
            // esto vino a cerrar. Un hueco en la numeracion se explica (queda en el log);
            // una colision no se explica de ninguna manera.
            _letrasTerna = letrasReservadas(_folios);
            log('info', 'generarPdf.opciones',
              `${from}: ${_opcionesEntregadas.length}/${_folios.length} propuestas entregadas (${_opcionesEntregadas.map((o) => `${o.letra}=${o.color}`).join(', ') || 'ninguna'})`);
          }

          // 🎨 [2026-08-31] Y AHORA SE LE DICE AL CLIENTE CUAL ES CUAL — pedido EXPLICITO del
          // dueño: *"le decimos a cliente cuel es cada una"*. Se nombran SOLO las que de verdad
          // salieron. Si al final quedo una sola (las otras dos fallaron), el cliente no puede
          // quedarse con una propuesta blanca sin enterarse de que el color no lo eligio el:
          // ahi vuelve el aviso de siempre. Nunca en silencio.
          if (_coloresTerna) {
            if (_opcionesEntregadas.length >= 2) {
              _avisoColor = `\n\n${textoDeOpciones(_opcionesEntregadas)}`;
            } else {
              _avisoColor = '\n\n🎨 Se la preparé en *Blanco* mientras me confirma el color. '
                + 'Si prefiere Nogal, Roble Dorado, Grafito Antracita o Negro, me avisa y se la '
                + 'recotizo sin costo; el color cambia el precio, por eso se lo digo.';
              log('warn', 'generarPdf.opciones', `${from}: la terna quedo en una sola propuesta; sale el aviso de Blanco`);
            }
          }

          // ── Paso 4: Zoho CRM (Deal upsert + Note) ───────────────────────────
          // Fire-and-forget: si Zoho falla no bloquea el resto del flujo.
          // [FIX 2026-06-19 COB-07] SIEMPRE recalcular desde los items (unit_price NETO del motor);
          // ignorar input.grand_total (si el LLM lo alucina con IVA, inflaría el monto a Zoho/CXM).
          const _totalDocA = (input.items || []).reduce((s, it) => s + (Number(it.unit_price) || 0) * (Number(it.qty) || 1), 0);

          // 💰 [2026-08-31] QUE MONTO SE LE REPORTA A META Y GOOGLE CUANDO SALEN TRES.
          // ESTO TOCA PLATA Y ES UNA DECISION DEL DUENO, no del codigo. Queda en UNA linea
          // (`_montoReportado`) justamente para que se pueda cambiar sin tocar nada mas.
          //
          // El cliente recibio tres propuestas y NO eligio ninguna todavia. Los tres precios
          // son distintos (el New Black sale ~44% mas que el Blanco), asi que "cuanto vale
          // esta cotizacion" no tiene una respuesta unica.
          //
          // Se reporta EL MAS BAJO de las que salieron, por dos razones:
          //   1. Es lo que las plataformas reciben HOY: antes la opcion A era el Blanco. Este
          //      cambio de orden es una decision de PRESENTACION al cliente y no tiene por que
          //      mover la senal que entrena el reparto de presupuesto.
          //   2. Es el piso real del negocio: si el cliente elige el mas barato, es lo que hay.
          //      Reportar el mas caro por algo que nadie eligio le ensena al algoritmo que ese
          //      trafico vale mas de lo que se sabe.
          // Cuando el cliente ELIGE, ahi si corresponde reportar lo que eligio — eso todavia
          // no existe (es el defecto B2: el sistema no entiende "quiero la B").
          const _montoReportado = (_opcionesEntregadas && _opcionesEntregadas.length > 1)
            ? Math.min(..._opcionesEntregadas.map((o) => Number(o.total) || Infinity).filter(Number.isFinite))
            : _totalDocA;
          const grandTotal = Number.isFinite(_montoReportado) && _montoReportado > 0 ? _montoReportado : _totalDocA;
          safe('generarPdf.zoho', async () => {
            const dealId = await upsertZohoDeal({
              phone:      clientPhone,
              name:       clientName,
              comuna:     clientComuna,
              items:      input.items || [],
              grand_total: grandTotal,
              stageKey:   'propuesta',
              quote_number: quoteNumber,
              // [2026-08-30] El RUT y la razon social al Deal, en `Description` (campo estandar
              // de texto libre): cuando Marcelo abre el Deal para facturar lo tiene ahi sin
              // ir a buscar el PDF. Ya validado por modulo 11; null si no hay.
              receptor:   receptorDoc,
            });
            if (dealId) {
              await addZohoNote(dealId, `Cotización enviada: ${quoteNumber}`,
                `PDF enviado al cliente por WhatsApp.\nTotal: $${grandTotal.toLocaleString('es-CL')} CLP (IVA incl.)`);
              // [#6] adjuntar el PDF AL Deal (trazabilidad ISO en el registro Zoho)
              await attachPdfToDeal(dealId, pdfBuffer, filename);
              // [2026-08-24] Se publica el dealId para que el INFORME se cuelgue de ESTE
              // Deal en vez de hacer su propio upsert: el suyo iria sin los datos de la
              // propuesta y pisaria el nombre y la descripcion con un payload pobre.
              try { await (deps.escribirEstado || escribirEstado)(`deal:${String(from).replace(/\D/g, '')}`, dealId, 7 * 24 * 3600); }
              catch { /* el informe se las arregla sin archivar */ }
            }
          });

          // ── Paso 5: [ELIMINADO 2026-08-25] el archivado en WorkDrive NO se hace aca ──
          // Lo hace sales-os solo, enganchado al `POST /api/v5/media/store` del Paso 3a de
          // mas arriba: ese INSERT en `media_attachments` dispara la subida a la carpeta
          // COTIZACIONES. Lo que habia aca era `archivarEnWorkDrive`, un stub que no subia
          // nada y duplicaba —en intencion— un camino que ya funcionaba. Ver zohoCommercial.js.

          // ── Paso 6: Conversión multicanal (anti-cross-inject) ────────────────
          // REGLA: solo se envía AL CANAL QUE TRAJO AL LEAD (skill activa-atribucion-multicanal).
          // La atribución se basó en el click_id capturado en F3b (state.ctwa_clid / gclid / ttclid).
          // Se llama bridge.pushQuoteEvent con status 'sent'; el server.js (sales-os) llama
          // fireConversion → CXM /api/conversions/track con el canal correcto.
          await landingAttributionReady;
          safe('generarPdf.conversion', () =>
            bridge.pushQuoteEvent({
              phone:           clientPhone,
              channel:         'whatsapp',
              customer_name:   clientName,
              amount_total:    grandTotal,
              currency:        'CLP',
              status:          'sent',       // server.js lo mapea a 'quote_sent'
              quote_number:    quoteNumber,
              // 🔴 [2026-08-30] A NOMBRE DE QUIEN SE EMITIO. Un documento formal tiene que
              // poder reconstruirse desde la BD: si mañana hay una disputa por una factura,
              // `quotes.payload->'receptor'` dice con que RUT y a que razon social salio esa
              // propuesta. `quoteService.upsertQuote` (sales-os) guarda el payload entero en
              // la columna jsonb, asi que con mandarlo alcanza — cero cambios del servidor.
              // Solo viaja si paso modulo 11: en la BD tampoco entra un RUT inventado.
              receptor:        receptorDoc || null,
              // 🔴 [2026-08-25] #203 — LA COTIZACION GUARDA QUE SE COTIZO, no solo cuanto.
              // Medido contra la BD viva: 343 de 395 cotizaciones de los ultimos 90 dias
              // tienen un `payload` que solo trae atribucion (lead + click-ids) — ni una
              // ventana. Consecuencias reales: la ficha del cliente no puede mostrar el
              // detalle sin re-abrir el PDF, no se puede saber que se vende mas, y una
              // recotizacion arranca de cero. El dato SIEMPRE estuvo acá (`input.items`, que
              // dos lineas mas abajo ya se usa para `product_interest` y `windows_qty`):
              // simplemente no viajaba. `quoteService.upsertQuote` guarda el payload entero,
              // asi que con mandarlo alcanza — cero cambios del lado del servidor.
              // Se manda una version FLACA (lo que describe la venta), no el objeto crudo:
              // el payload va a `quotes.payload` y a `audit_events`, y meter el desglose de
              // materiales de cada ventana ahi hincharia las dos tablas sin que nadie lo lea.
              items: (input.items || []).map((it) => ({
                producto:    it.producto_label || it.product || null,
                medidas:     it.measures_original || it.measures || null,
                cantidad:    Number(it.qty) || 1,
                unitario:    Number(it.unit_price) || null,
                color:       it.color || null,
                vidrio:      it.glass_label || null,
                ambiente:    it.ambiente || null,
                referencial: !!it.referencial,     // fuera de estandar: precio a confirmar
                uw:          it.termico?.uw ?? null,
              })),
              // [ajuste abogado] click-ids a NIVEL RAÍZ: fireConversion (sales-os) los lee de
              // body.fbclid/body.gclid de raíz, NO de payload. Anti-cross-inject: un lead → un canal.
              fbclid:    state.fbclid    || null,
              gclid:     state.gclid     || null,
              ttclid:    state.ttclid    || null,
              ctwa_clid: state.ctwa_clid || null,
              ad_id:     state.ad_id     || null,
              landing_ref: state.landing_lead_id || null,
              // [2026-07-11 FIX lead_id NULL] sin este campo, quoteService.upsertQuote (sales-os)
              // no puede resolver lead_id → JOIN quotes→leads roto (auditoría BD viva confirmada).
              // Réplica de buildLeadPayload (index.js, ruta legacy) con los datos que el flujo
              // GPT v2 (WhatsApp) tiene a mano en este punto; lo no disponible queda null.
              lead: {
                source: 'oliver_gpt',
                channel: 'whatsapp',
                lead_name: clientName || null,
                name: clientName || null,
                phone: clientPhone || from || null,
                comuna: clientComuna || null,
                city: clientComuna || null,
                project_type: null,
                product_interest: (input.items?.[0]?.producto_label || input.items?.[0]?.product) || null,
                windows_qty: (input.items || []).length
                  ? String((input.items || []).reduce((acc, it) => acc + (Number(it.qty) || 1), 0))
                  : null,
                budget: grandTotal ? String(grandTotal) : null,
                message: null,
                status: 'quoted',
                zoho_deal_id: null,
                external_id: from || null,
                fbclid:    state.fbclid    || null,
                gclid:     state.gclid     || null,
                ttclid:    state.ttclid    || null,
                ctwa_clid: state.ctwa_clid || null,
                ad_id:     state.ad_id     || null,
                landing_ref: state.landing_lead_id || null,
              },
              payload: {
                comuna:   clientComuna,
                // Click ids — anti-cross-inject: solo el canal del lead.
                ctwa_clid: state.ctwa_clid || null,
                ad_id:     state.ad_id     || null,
                landing_ref: state.landing_lead_id || null,
                fbclid:    state.fbclid    || null,
                gclid:     state.gclid     || null,
                ttclid:    state.ttclid    || null,
              },
            })
          );

          // ── [2026-07-07] ESCALACIÓN por VENTANA FUERA DE ESTÁNDAR (instrucción del dueño) ──────
          // Toda ventana referencial (sobre el máximo o bajo el mínimo de fábrica) se cotiza IGUAL
          // (no se frena al cliente), pero Marcelo (Evaluador Energético Externo MINVU) DEBE revisar
          // la medida/precio antes de fabricar. Motor-truth (referencial se derivó del motor arriba),
          // no depende del LLM. Best-effort + cooldown 2h por cliente:motivo → no spamea. Corre para
          // ambos caminos (entregado o no) porque la revisión de ingeniería aplica igual.
          const _refItems = (input.items || []).filter((it) => it.referencial);
          if (_refItems.length) {
            const _lista = _refItems
              .map((it) => `• ${it.producto_label || it.product || 'Ventana'} (${it.measures_original || it.measures || 's/medida'})`)
              .join('\n');
            await safe('generarPdf.referencial.escalate', () =>
              notifyHighValue(enviarSinPausa, from,
                { data: { ...state, name: clientName, comuna: clientComuna, quote_number: quoteNumber, grand_total: grandTotal, items: input.items }, history },
                `oliver_gpt:ventana_fuera_estandar — 🔧 REVISIÓN DE INGENIERÍA: ${_refItems.length} ventana(s) fuera del estándar de fábrica en el folio ${quoteNumber}. Confirmar medida y precio final antes de fabricar:\n${_lista}`));
          }

          // [FIX 2026-06-19 CLI-02/CLI-03] si el PDF NO se entregó → AVISAR a Marcelo (no se pierde en silencio)
          // + devolver `message` para que el LLM diga la verdad y NO alucine "ya te lo envié".
          if (!docSent) {
            // [PDF-RACE 2026-07-01] rastro persistente del folio (reuso 48h) + estado real de entrega.
            state.last_quote = { quote_number: quoteNumber, at: Date.now(), pdf_sent: false,
              descuento_mercado_pct: descuentoMercadoPct,
              // La firma y la base viajan con el rastro: sin ellas no se puede saber si el
              // proximo PDF es una correccion de este o un documento distinto.
              sig: _quoteSig,
              quote_base: String(quoteNumber).replace(/-[A-Z]$/, ''),
              // [2026-08-31] `_letrasTerna` = las letras que la terna A/B/C ya reservo. Se
              // cuentan aunque el envio haya fallado: reciclar una letra pondria dos
              // documentos distintos bajo el mismo folio.
              alternativas: Math.max(Number((state.last_quote || {}).alternativas || 0), _letrasTerna) };
            await safe('generarPdf.escalate', () =>
              notifyHighValue(enviarSinPausa, from,
                { data: { ...state, name: clientName, comuna: clientComuna, quote_number: quoteNumber }, history },
                `[whatsapp] PDF ${quoteNumber} no se pudo entregar al cliente — enviarlo desde el inbox (ops.activalabs.ai)`));
            return {
              ok: true, quote_number: quoteNumber, pdf_sent: false, media_id: waDocMediaId,
              // [2026-07-01 Bug#2 paridad] explícito y honesto: Marcelo la envía (no "si no la ves" vago).
              // [Gemini, compuerta 28-ago] En USTED (el resto del flujo habla de usted) y
              // sin guion largo: este texto SÍ le llega al cliente cuando Meta rechaza.
              // 🎨 [2026-08-31] Si la A no se pudo entregar pero las alternativas SI llegaron,
              // el cliente tiene dos PDF en la mano mientras le decimos que no pudimos
              // mandarle nada. Se le nombran las que si recibio. `_avisoColor` ya trae solo lo
              // entregado (la A no entra en la lista cuando docSent es false).
              message: `Su Propuesta Técnica Económica N° ${quoteNumber} está lista ✅ Tuve un problema para adjuntarle el archivo: el Ing. Marcelo Cifuentes se la enviará directamente en un momento. 📲 +56 9 5729 6035`
                + (_opcionesEntregadas.length >= 2 ? _avisoColor : ''),
            };
          }
          // [PDF-RACE 2026-07-01] entrega OK → registrar folio para reuso (revisiones = mismo folio).
          const _base = String(quoteNumber).replace(/-[A-Z]$/, '');
          state.last_quote = { quote_number: quoteNumber, at: Date.now(), pdf_sent: true,
            descuento_mercado_pct: descuentoMercadoPct,
            sig: _quoteSig,
            quote_base: _base,
            // Se cuenta solo cuando el documento SALIO (una alternativa no entregada no
            // consume su letra) y DERIVADO de la letra, no +1 por entrega: reenviar la misma
            // -B no debe quemar la C (Codex, 26-ago).
            // [2026-08-31] …y las que reservo la terna A/B/C de este mismo turno: la B y la C
            // ya tienen dueño aunque el cliente todavia no elija ninguna.
            alternativas: Math.max(
              alternativasEntregadas(quoteNumber, (state.last_quote || {}).alternativas),
              _letrasTerna) };
          return {
            ok: true,
            quote_number: quoteNumber,
            pdf_sent:     docSent,   // ← entrega REAL (sendWaDocument.ok), no solo el upload
            media_id:     waDocMediaId,
            // [2026-08-08] ESTE MENSAJE ES EL MOMENTO MÁS IMPORTANTE DE LA VENTA: el cliente
            // acaba de recibir el precio. Decía "Cualquier duda la vemos", que es exactamente
            // el cierre pasivo que el paso 8 del prompt prohíbe — y el paso 8 NUNCA lo iba a
            // corregir, porque este texto está en CÓDIGO y no pasa por el cerebro.
            // Medido el 08-ago: de las 5 cotizaciones emitidas tras desplegar el paso 8,
            // TRES terminaron con este cierre pasivo, dos de ellas con este texto literal.
            // Ahora ofrece un paso siguiente concreto entre cosas que EXISTEN de verdad:
            // el link de agenda (donde el cliente elige día y hora) o que lo llame Marcelo.
            // No propone horarios: Oliver no tiene calendario y no puede reservar nada.
            // [2026-08-10] Acá se USA `esRevision`, que había quedado declarada y sin usar:
            // media corrección no arregla nada. Si el cliente YA recibió un PDF de este folio,
            // el mensaje dice que es una CORRECCIÓN — no "te envié tu propuesta" de nuevo, que
            // es lo que hizo que Jessica leyera tres envíos iguales como un bot trabado. Y no
            // se le repite la pregunta del cierre: ya se la hicimos hace cinco minutos.
            // [2026-08-25] `_avisoColor` va PEGADO acá. Si se construyera y no se usara, el
            // cliente recibiría su propuesta en Blanco sin enterarse — que es exactamente el
            // defecto que este arreglo vino a cerrar. Un mensaje que no se manda no existe.
            message:      (esRevision
              ? `Le corregí la propuesta N° ${quoteNumber} con esos datos y se la mando acá mismo (PDF). Es la misma propuesta actualizada, no una nueva.`
              // 🔴 [2026-08-25] EL CIERRE PREGUNTA LO QUE IMPORTA AHORA. Instruccion del
              // dueño: *"Oliver debe seguir al cliente después de entregar la cotización
              // porque no hace nada y debería al menos preguntar si la cotización necesita
              // alguna modificación, cuándo la puede contactar nuevamente"*.
              // El cierre anterior solo ofrecia ir a medir, que es un paso MAS ADELANTE en
              // la venta: si el cliente todavia no sabe si la propuesta refleja lo que
              // pidio, ofrecerle una visita tecnica se salta el paso que de verdad importa.
              // [Gemini, compuerta 28-ago] TODO EN USTED: "Te envié tu..." + "¿Necesita...?
              // dígame" mezclaba tú y usted en el mismo párrafo, la falta que la regla de
              // oro del system-prompt prohíbe con nombre y apellido. Y sin re-enumerar
              // "medidas, color o apertura": el ANTICIPO acaba de pedir exactamente esa
              // corrección 40 segundos antes — el eco delataba al bot.
              : `Listo ✅ Le envié su Propuesta Técnica Económica N° ${quoteNumber} acá mismo (PDF).\n\n` +
                '¿Necesita alguna modificación? Me la dice y se la cambio sin problema. '
                + 'Y cuénteme cuándo lo puedo contactar de nuevo para ver qué decidió.'
            // [Dueño, 28-ago] El resumen ("Le coticé:") ya NO va acá: se convirtió en el
            // ANTICIPO y viaja ANTES del documento (Paso 2-bis), que es donde el cliente
            // puede corregir una medida al revés A TIEMPO. Los avisos de ajuste se quedan.
            ) + _avisoColor + _avisoTipo + _avisoHojas,
          };
        }),
    };

    // ── [FIX 2026-06-19 PDF-01] ENTREGA DETERMINISTA DEL PDF (NO depende del LLM) ──
    // Si el cliente CONFIRMA tras una cotización ya lista (state.pending_quote del turno
    // anterior), mandamos el PDF en CÓDIGO. En prod el LLM a veces escribía "[Enlace a la
    // cotización]" como texto sin llamar la tool → el cliente NO recibía el PDF. Portado de channel-agent.js.
    if (state.pending_quote && Array.isArray(state.pending_quote.items) && state.pending_quote.items.length
        && isPdfAffirmative(userText) && lastAssistantOfferedPdf(history)) {
      const pq = state.pending_quote;
      const pdfRes = await safe('pdf.deterministic', () => toolCtx.generarPdf({
        name: state.name || '', phone: state.telefono || from, comuna: state.comuna || '',
        items: pq.items, grand_total: pq.grand_total,
      }));
      // [2026-08-08] El fallback también cierra con paso siguiente. Si sale por acá es
      // porque generarPdf no devolvió mensaje: no puede quedar más flojo que el camino normal.
      const replyMsg = (pdfRes && pdfRes.message) ||
        `Listo ✅ Te preparé tu Propuesta Técnica Económica${pdfRes?.quote_number ? ` N° ${pdfRes.quote_number}` : ''} acá mismo (PDF).\n\n` +
        `Para que los números queden 100% finos lo ideal es ir a medir. ¿Le mando el link para que elija el día que le acomode, o prefiere que lo llame Marcelo y lo coordinan?`;
      await safe('pdf.det.send', () => sendWhatsAppText(from, replyMsg));
      await safe('pdf.det.persistIn', () => bridge.pushConversationEvent({
        channel: 'whatsapp', external_id: from, direction: 'inbound', actor_type: 'customer',
        actor_name: 'Cliente', message_type: 'text', body: userText,
        metadata: { source: 'oliver_gpt_webhook', msg_id: msgId, pdf_confirm: true },
      }));
      await safe('pdf.det.persistOut', () => bridge.pushConversationEvent({
        channel: 'whatsapp', external_id: from, direction: 'outbound', actor_type: 'ai',
        actor_name: 'Oliver', message_type: 'text', body: replyMsg,
        metadata: { source: 'oliver_gpt_webhook', pdf_deterministic: true, quote_number: pdfRes?.quote_number },
      }));
      const histPdf = [...history, { role: 'user', content: userText }, { role: 'assistant', content: replyMsg }];
      await landingAttributionReady;
      const toStorePdf = { history: histPdf.length > MAX_HISTORY ? histPdf.slice(-MAX_HISTORY) : histPdf,
                           state: { ...state, pending_quote: null, lastMessageAt: Date.now() } };
      conv.set(from, toStorePdf);
      persistSessionFn(from, toStorePdf, deps);
      log('info', 'pdf.deterministic', `PDF determinista para ${from} (${pdfRes?.quote_number || 'sin folio'})`);
      return; // 200 ya enviado; el finally libera el lock
    }

    // ── Llamada al cerebro probado ──────────────────────────────────────
    // Si handleTurn lanza, lo captura el try externo → fail-safe (200 ya enviado).
    // [CTWA-SALUDO tribunal] recién AQUÍ el saludo entra al state: todas las salidas
    // deterministas ya pasaron, así que jamás se persiste fuera de este turno. Si el
    // LLM devuelve reply vacío (fallback de (7a)), el saludo se PIERDE — deliberado:
    // preferimos perderlo a un "primer mensaje" tardío; la alerta respuesta_vacia avisa.
    if (_ctwaSaludoTurn) state.ctwa_saludo_pending = _ctwaSaludoTurn;
    const turn = await handleTurn({ history, userText, state, toolCtx });
    let reply = turn?.reply || '';
    const newHistory = Array.isArray(turn?.history) ? turn.history : history;
    const newState = turn?.state && typeof turn.state === 'object' ? turn.state : state;
    const toolCalls = Array.isArray(turn?.toolCalls) ? turn.toolCalls : [];
    copyAttributionState(newState, state);
    // [PDF-RACE 2026-07-01] sin este merge se perdería el last_quote (folio de la sesión, estado
    // real de entrega) que generarPdf escribió DURANTE este turno vía toolCalls del LLM.
    if (state.last_quote) newState.last_quote = state.last_quote;
    // 🔴 [2026-08-25] LOS RELOJES DE LOS GATES, POR LA MISMA RAZON EXACTA QUE `last_quote`.
    // `agent.handleTurn` saca la foto del estado AL EMPEZAR (`{ ...state }`) y el webhook se
    // queda con esa copia, asi que todo lo que una tool escriba DURANTE el turno queda afuera.
    // Los gates marcan `color_preguntado_at` / `tipo_preguntado_at` justo ahi ⇒ se perdian, el
    // turno siguiente los veia en cero y se volvia a preguntar: el plazo de gracia NO VENCIA
    // NUNCA y la propuesta asumida no salia jamas. El cliente que no contesta el dato quedaba
    // en un bucle de preguntas.
    // Medido contra la BD viva: 794 sesiones · 0 con reloj de color · 224 CON `default_color`
    // (ese si persiste porque `recordarColor` escribe sobre la copia, DESPUES del turno).
    // No lo cazaba ningun test porque los `handleTurn` falsos copian el estado DESPUES de
    // llamar la tool — mas indulgentes que produccion. Ver gate-reloj-persiste.test.js.
    // 🔴 [2026-08-30] EL RECEPTOR (RUT + razon social), por la MISMA razon exacta. La captura
    // determinista corre ANTES del turno, asi que ya viaja en la foto; lo que se rescata aca
    // es lo que `generarPdf` haya completado DURANTE el turno con lo que aporto el LLM.
    if (state.receptor) newState.receptor = state.receptor;
    if (state.receptor_rechazado) newState.receptor_rechazado = state.receptor_rechazado;
    else delete newState.receptor_rechazado;   // el RUT bueno del turno borra el rechazo viejo
    if (state.color_preguntado_at) newState.color_preguntado_at = state.color_preguntado_at;
    if (state.tipo_preguntado_at) newState.tipo_preguntado_at = state.tipo_preguntado_at;
    if (state.hojas_preguntado_at) newState.hojas_preguntado_at = state.hojas_preguntado_at;
    // [CTWA-SALUDO 2026-07-18] one-shot: ya viajó en el contexto de ESTE turno → jamás repetir.
    if (newState.ctwa_saludo_pending) delete newState.ctwa_saludo_pending;

    // [FIX 2026-06-19 PDF-01] capturar la cotización del turno → pending_quote, para poder entregar
    // el PDF determinista si el cliente confirma en el próximo turno (bloque de arriba).
    const _qItems = itemsFromQuoteCalls(toolCalls, newState.default_color || state.default_color);
    // 🔴 [2026-08-25] EL COLOR SE RECUERDA. `state.default_color` se leia en cuatro lugares
    // y no se escribia en ninguno: llegaba vacio al motor y **todas** las cotizaciones
    // salian blancas, sin importar lo que pidiera el cliente. El cliente dice el color UNA
    // vez y lista sus ventanas en varios mensajes: tiene que sobrevivir a los turnos.
    recordarColor(newState, _qItems);
    if (_qItems.length) {
      // [FIX 2026-06-19] ACUMULAR ventanas entre turnos: el cliente que lista varias (una por mensaje)
      // debe terminar en UNA sola propuesta con TODAS, no un PDF por ventana. Dedup por producto+medidas+color.
      const _prev = (state.pending_quote && Array.isArray(state.pending_quote.items)) ? state.pending_quote.items : [];
      const _merged = [..._prev];
      for (const it of _qItems) {
        const k = `${it.product}|${it.measures}|${it.color}`;
        if (!_merged.some((m) => `${m.product}|${m.measures}|${m.color}` === k)) _merged.push(it);
      }
      newState.pending_quote = {
        items: _merged,
        grand_total: _merged.reduce((s, it) => s + it.unit_price * (Number(it.qty) || 1), 0),
        at: Date.now(),
      };
    }

    // [FIX 2026-06-19] Si en ESTE turno se generó el PDF, el texto al cliente ES la entrega
    // (usa el message del tool): NUNCA un saludo, NUNCA "no lo puedo enviar", NUNCA "cotización".
    // Mata el re-saludo + la contradicción vistos en el test en vivo. Si hubo PDF, también limpiamos
    // pending_quote (ya se entregó) para no re-disparar la entrega determinista.
    const _pdfCall = toolCalls.find((t) => t.name === 'generar_pdf_cotizacion' && t.result && t.result.message);
    if (_pdfCall) {
      reply = _pdfCall.result.message;                       // entrega exitosa O "dame un momentito" si el folio no salió
      // [Ronda 2 2026-07-20] Primer turno CTWA que ya genera PDF: anteponer el saludo aprobado
      // del anuncio en vez de tragárselo. No viola el anti-re-saludo del [FIX 2026-06-19]:
      // _ctwaSaludoTurn solo existe con history VACÍO (primera interacción de un lead pagado).
      if (_ctwaSaludoTurn) reply = `${_ctwaSaludoTurn}\n\n${reply}`;
      if (_pdfCall.result.ok) newState.pending_quote = null; // solo limpiar si realmente se entregó (si falló, dejar para reintento)
    }

    // [#2 2026-06-21] Blindaje anti precio-suelto (REGLA #13): el monto va SOLO en el PDF. Si el LLM
    // dejó un monto CLP en el texto, lo borra antes de enviar (conservador: no toca medidas/folios).
    const _replyPreFiltros = reply;
    reply = stripMontos(reply);
    // [Ronda 4 2026-07-20] Borrar acciones FALSAS narradas ("[Enlace a la cotización]",
    // "[Calculando...]") — casos reales 16-19 jul: el LLM las escribió pese al ⛔ del prompt.
    reply = stripAccionesFalsas(reply);
    // [Ronda 4.1 — Codex] la HISTORIA persiste lo que el cliente REALMENTE recibió: sin
    // esto el LLM veía su propio "[Enlace...]"/monto sin filtrar en el turno siguiente y
    // daba por enviado un link/precio que jamás llegó. La guarda de identidad protege el
    // caso PDF (ahí la historia guarda el texto del cerebro, no el reply reemplazado).
    if (reply !== _replyPreFiltros) {
      const _lastF = newHistory[newHistory.length - 1];
      if (_lastF && _lastF.role === 'assistant' && _lastF.content === _replyPreFiltros) _lastF.content = reply;
    }

    // ── (7) Enviar respuesta por WhatsApp ───────────────────────────────
    // (7a) Texto: siempre se envía (canal garantizado).
    // [2026-07-06 LOTE2] reply vacío = cliente SIN respuesta (caso real 56940732508: pedido de 11
    // ventanas quedó mudo un viernes noche). Instrumentación (cazar causa raíz en Railway) + FALLBACK
    // CONTEXTUAL. Acá NO hubo PDF en el turno (el branch _pdfCall ya habría sobreescrito reply con un
    // message no-vacío) → nunca duplica la entrega. Si hay cotización acumulada, invitamos el "sí" que
    // dispara la entrega determinista (bloque PDF-01 del próximo turno); si no, repetir + salida humana.
    if (!reply || !String(reply).trim()) {
      try { log('error', 'turn.reply_empty', { from, toolCalls: toolCalls.map((t) => t.name).join(',') || 'ninguno', historyLen: newHistory.length }); } catch {}
      reply = (newState.pending_quote && Array.isArray(newState.pending_quote.items) && newState.pending_quote.items.length)
        ? '¿Le genero la propuesta en PDF con lo que ya cotizamos? Responda *sí* y se la envío al tiro 👍'
        : 'Disculpe, se me trabó la respuesta 😅. ¿Me repite lo último, por favor? Si prefiere, Marcelo también puede atenderlo directo al +56 9 5729 6035.';
      // [escéptico L2 — BLOQUEANTE] El history que se persiste DEBE reflejar el fallback que el cliente
      // recibió (agent.js:163 lo armó con content:''): sin esto, lastAssistantOfferedPdf(history) del
      // turno siguiente ve '' y el "sí" del cliente NO dispara la entrega determinista del PDF.
      const _lastH = newHistory[newHistory.length - 1];
      if (_lastH && _lastH.role === 'assistant' && !String(_lastH.content || '').trim()) _lastH.content = reply;
      if (replyEmptyAlertAllowed()) {
        await safe('replyEmpty.notify', () =>
          notifyHighValue(enviarSinPausa, from, { data: { ...newState }, history: newHistory },
            'oliver_gpt:respuesta_vacia — el cerebro devolvió texto vacío (ver log turn.reply_empty); el cliente recibió un fallback'));
      }
    }
    // [2026-08-08] NO REPETIR LA MISMA FRASE DOS VECES SEGUIDAS.
    // Auditoría del módulo Oliver: en 60 días mandó el mensaje IDÉNTICO al anterior 73
    // veces, a 26 clientes — el 2 % de todos los envíos. El peor caso repitió "Aquí estoy
    // cuando me necesite. 👍" OCHO veces seguidas a un cliente cuyo dictado por voz llegaba
    // como ruido ("Ya. Ahora. Balla. Ojo. Pelea."). Cada repetición es un mensaje de
    // WhatsApp real, cuesta plata y es lo más delator que puede hacer un bot.
    // La REGLA #12 del prompt dice "no mandes otro mensaje hasta que el cliente escriba de
    // nuevo" — y el cliente SÍ escribía, así que la regla se cumplía al pie de la letra
    // mientras el resultado era absurdo. Por eso el freno va acá, en código, y no en el
    // prompt: una instrucción que se cumple y aun así falla necesita un tope determinista.
    // Una persona no repite la misma despedida ocho veces: se calla.
    if (reply && String(reply).trim() && String(reply).trim() === String(state.ultimaRespuesta || '').trim()) {
      log('info', 'anti_repeticion', `respuesta idéntica a la anterior, no se reenvía a ${from}`);
      newState.ultimaRespuesta = state.ultimaRespuesta;
      reply = '';
    } else if (reply && String(reply).trim()) {
      newState.ultimaRespuesta = String(reply).trim();
    }

    if (reply) {
      // [2026-08-08] Cortar el loop de "escribiendo…" JUSTO acá y no recién en el finally:
      // entre este envío y el final del handler todavía corren el TTS y las persistencias,
      // y un refresco podía aterrizar en esa ventana y volver a encender los puntitos
      // DESPUÉS de que el cliente ya recibió la respuesta (P1 de Codex, 2ª pasada).
      // El finally sigue como respaldo: detener dos veces es inofensivo.
      try { _detenerEscribiendo(); } catch { /* ya detenido */ }
      // La respuesta principal va como la mandaría una persona: 2-3 burbujas cortas, con
      // "escribiendo…" entre medio. enviarSinPausa porque el ritmo lo pone esta función.
      await safe('sendWhatsAppText', () => enviarComoPersona(enviarSinPausa, from, reply, msgId));
    }

    // (7b) Voz saliente (F4): si el inbound fue audio Y VOICE_ENABLED, sintetizar
    // y enviar nota de voz ADEMÁS del texto. Fail-safe: si TTS/upload falla, el
    // cliente ya tiene el texto → no se pierde la respuesta.
    if (reply && shouldSendVoice(userText, null, { incomingType: inbound.type })) {
      await safe('voice.send', async () => {
        const audioResult = await synthesizeVoiceBuffer({ text: reply, waId: from });
        if (!audioResult || !audioResult.buffer) {
          log('info', 'voice.send', `TTS no devolvió audio para ${from}; se omite nota de voz`);
          return;
        }
        const mediaId = await uploadWaAudio(
          audioResult.buffer,
          audioResult.mime || 'audio/ogg',
          audioResult.filename || `reply_${Date.now()}.ogg`
        );
        // voice:true (PTT, ícono micrófono) SOLO si es ogg/opus; otros formatos
        // van como audio adjunto normal (ajuste del abogado del diablo).
        const asVoice = (audioResult.mime || '').toLowerCase().includes('ogg');
        await sendWaAudio(from, mediaId, asVoice);
        log('info', 'voice.sent', `nota de voz enviada a ${from} (${audioResult.buffer.length} bytes, voice=${asVoice})`);
      });
    }

    // ── (8) Persistencia POST del turno (inbound + outbound) ────────────
    await safe('persist.inbound', () =>
      bridge.pushConversationEvent({
        channel: 'whatsapp',
        external_id: from,
        customer_name: newState.name || push_name || '',
        direction: 'inbound',
        actor_type: 'customer',
        actor_name: 'Cliente',
        message_type: inbound.type || 'text',
        body: inbound.text || userText,
        // [2026-08-08] enviado_at = hora REAL en que el cliente escribió, según Meta.
        // `created_at` es cuándo guardamos la fila, y el inbound y el outbound del mismo
        // turno se persisten juntos (~50 ms) ⇒ medir la respuesta con created_at daba
        // "mediana 0 s", que no significaba nada. Con esto el SLA se puede medir de verdad.
        metadata: {
          source: 'oliver_gpt_webhook',
          msg_id: msgId,
          resolved_text: userText,
          ...(inbound.enviadoAt ? { enviado_at: inbound.enviadoAt } : {}),
        },
      })
    );

    if (reply) {
      // message_type refleja si se entregó también como nota de voz (F4).
      const outboundType = shouldSendVoice(userText, null, { incomingType: inbound.type })
        ? 'text+voice'
        : 'text';
      await safe('persist.outbound', () =>
        bridge.pushConversationEvent({
          channel: 'whatsapp',
          external_id: from,
          customer_name: newState.name || push_name || '',
          direction: 'outbound',
          actor_type: 'ai',
          actor_name: 'Oliver',
          message_type: outboundType,
          body: reply,
          // [2026-08-08] QUÉ CEREBRO CONTESTÓ ESTE MENSAJE.
          // Pregunta del dueño: "¿pudo pasar a GPT porque se terminó el saldo de Claude?".
          // No se podía responder — nadie lo registraba. Y su razón de fondo es mejor que
          // el diagnóstico: "en algún momento podría ser indistinto quién atienda, y
          // deberían contestar bien ambos, no solo Claude Sonnet".
          // Con esto se puede medir la CALIDAD POR PROVEEDOR: cotizaciones, repeticiones y
          // cierres pasivos de cada uno. Sin el dato, "los dos contestan bien" es una
          // creencia; con el dato, es una consulta.
          metadata: { source: 'oliver_gpt_webhook', ...proveedorDelTurno() },
        })
      );
    }

    // Cotización en el turno → pushQuoteEvent.
    const quote = extractQuote(toolCalls);
    if (quote) {
      await landingAttributionReady;
      copyAttributionState(newState, state);
      await safe('persist.quote', () =>
        bridge.pushQuoteEvent({
          // [2026-08-08] Idem: si hay atribucion activa, el borrador es del cliente.
          phone: telefonoCliente,
          channel: 'whatsapp',
          customer_name: atribucion?.name || newState.name || push_name || 'Cliente WhatsApp',
          amount_total: quote.total || quote.grand_total || null,
          currency: 'CLP',
          status: 'draft',
          fbclid:    newState.fbclid    || null,
          gclid:     newState.gclid     || null,
          ttclid:    newState.ttclid    || null,
          ctwa_clid: newState.ctwa_clid || null,
          ad_id:     newState.ad_id     || null,
          landing_ref: newState.landing_lead_id || null,
          // [2026-07-11 FIX lead_id NULL] sin este campo, quoteService.upsertQuote (sales-os)
          // no puede resolver lead_id → JOIN quotes→leads roto (auditoría BD viva confirmada).
          // Réplica de buildLeadPayload con los datos que este punto del flujo GPT v2 tiene a
          // mano (draft, antes del PDF); lo no disponible queda null.
          lead: {
            source: 'oliver_gpt',
            channel: 'whatsapp',
            lead_name: newState.name || push_name || null,
            name: newState.name || push_name || null,
            phone: from || null,
            comuna: newState.comuna || null,
            city: newState.comuna || null,
            project_type: null,
            product_interest: null,
            windows_qty: null,
            budget: (quote.total || quote.grand_total) ? String(quote.total || quote.grand_total) : null,
            message: null,
            status: 'draft',
            zoho_deal_id: null,
            external_id: from || null,
            fbclid:    newState.fbclid    || null,
            gclid:     newState.gclid     || null,
            ttclid:    newState.ttclid    || null,
            ctwa_clid: newState.ctwa_clid || null,
            ad_id:     newState.ad_id     || null,
            landing_ref: newState.landing_lead_id || null,
          },
          payload: {
            comuna: newState.comuna || '',
            quote,
            ctwa_clid: newState.ctwa_clid || null,
            ad_id: newState.ad_id || null,
            landing_ref: newState.landing_lead_id || null,
            fbclid: newState.fbclid || null,
            gclid: newState.gclid || null,
            ttclid: newState.ttclid || null,
          },
        })
      );
    }

    // Evento de tracking (oliver_events) si el bridge expone el helper.
    if (typeof bridge.logOliverEvent === 'function') {
      await safe('persist.event', () =>
        bridge.logOliverEvent('turn_completed', {
          phone: from,
          tool_calls: toolCalls.map((t) => t.name),
          has_quote: !!quote,
        })
      );
    }

    // ── (9) Guardar el cache actualizado + persistir en Postgres ─────────
    await landingAttributionReady;
    copyAttributionState(newState, state);
    const trimmed =
      newHistory.length > MAX_HISTORY ? newHistory.slice(-MAX_HISTORY) : newHistory;
    const sessionToSave = {
      history: trimmed,
      state: { ...newState, lastMessageAt: Date.now() },
    };
    conv.set(from, sessionToSave);
    // Persistencia remota fire-and-forget (F2-1): no bloquea el turno.
    persistSessionFn(from, sessionToSave, deps);
  } catch (err) {
    // Fail-safe absoluto: el 200 ya se envió; jamás relanzamos.
    log('error', 'handleWebhook', err);
  } finally {
    // Liberar SIEMPRE el lock: cubre returns intermedios (rate-limit, takeover,
    // sin userText) y excepciones. Sin esto un takeover dejaba el lock colgado.
    if (releaseLock) { try { releaseLock(); } catch { /* ya liberado */ } }
    // [2026-08-08] Cortar el "escribiendo…" pase lo que pase. Si el turno se cae, Oliver
    // no puede quedar "escribiendo" un mensaje que nunca va a llegar.
    try { _detenerEscribiendo(); } catch { /* ya detenido */ }
    // [2026-08-08] Consumir la atribución acá y no antes: si el turno se cayó DESPUÉS de
    // mandar el PDF, la atribución igual se gastó (la cotización ya existe y ya es del
    // cliente). Dejarla viva sería peor: la siguiente cotización se le cargaría a él.
    try {
      if (atribucionConsumida && _fromParaAtribucion) {
        limpiarAtribucion(_fromParaAtribucion);
        log('info', 'atribucion', `consumida: la próxima cotización vuelve a nombre del dueño`);
      }
    } catch { /* no puede tumbar el turno */ }
  }
}

export default { handleWebhook };
