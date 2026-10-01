// atribucionCotizacion.js — cotizar A NOMBRE DE OTRO. ESM, sin dependencias.
//
// [2026-08-08] Por qué existe:
// El dueño lo pidió textual: *"esas cotizaciones que hago son de personas que me hablan
// directo a mí y yo le cotizo a Oliver para enviar una cotización; ¿cómo debería
// cotizársela para que quede como lead y no sea yo a quien le carguen la cotización?"*
//
// Hasta hoy no había forma: `guardar_lead` toma el teléfono de quien conversa, así que un
// cliente que llegó por recomendación quedaba registrado con el teléfono del dueño. Eso
// rompía tres cosas, ninguna cosmética:
//   1) el seguimiento automático nunca le llegaba al cliente (apuntaba al dueño),
//   2) la atribución de ads se ensuciaba (canal = WhatsApp del dueño),
//   3) en /mi-agenda ese cliente no aparecía como cliente: aparecía el dueño.
//
// 🔒 SOLO EL DUEÑO — y desde 2026-09-30 también los vendedores que el dueño autorizó en
// /equipo con modo interno (ver puedeUsarComandoCliente). Si cualquiera pudiera atribuir cotizaciones a terceros, se abre a que
// alguien cargue una cotización a nombre de otra persona.
//
// Vive en memoria a propósito: es una intención de minutos ("ahora estoy cotizando para
// Juan"), no un dato de negocio. Si el proceso reinicia se pierde y el dueño vuelve a
// escribir el comando — preferible a inventar una tabla para algo que dura una charla.
// Mismo criterio que CONV/RATE_MAP en webhook.js.

import {
  leer as leerEstado,
  leerLocal as leerEstadoLocal,
  escribir as escribirEstado,
  borrar as borrarEstado,
} from './estadoPersistente.js';
import { ultimos9, esDelEquipoParaCliente, esVendedorConfirmado, puedeComandoCliente } from './internosEquipo.js'; // una sola copia en el bot
export { ultimos9 };

const ATRIBUCIONES = new Map(); // telefonoDelDuenio -> { phone, name, ts, gen }
let _GEN = 0;                   // versión de cada fijación (compare-and-delete en limpiarSiMisma)

// Se vence sola: si el dueño fijó un cliente hace 3 horas y se olvidó, lo que cotice
// después NO debe irse al cliente equivocado. Ese error es peor que pedirle que repita
// el comando.
export const VIGENCIA_MS = Number(process.env.ATRIBUCION_VIGENCIA_MS || 2 * 60 * 60 * 1000);

const soloDigitos = (s) => String(s || '').replace(/\D/g, '');

/**
 * Parsea "CLIENTE Juan Pérez +56 9 1234 5678" (o al revés).
 * @returns {{ok:true, phone:string, name:string}|{ok:false, error:string}}
 */
export function parseComandoCliente(texto) {
  const t = String(texto || '').trim();
  // \b y no \s+: "CLIENTE" a secas también entra, para responder la ayuda en vez de un
  // "no_es_comando" que el dueño vería en pantalla sin entender nada. index.js intercepta
  // con el mismo criterio (/^\s*cliente\b/i), así que ambos tienen que coincidir.
  const m = /^\s*cliente\b\s*(.*)$/i.exec(t);
  if (!m) return { ok: false, error: 'no_es_comando' };
  const resto = m[1].trim();
  if (!resto) return { ok: false, error: 'Falta el nombre y el teléfono. Ej: CLIENTE Juan Pérez +56912345678' };

  if (/^(off|no|ninguno|salir|listo|fin)$/i.test(resto)) return { ok: true, limpiar: true };

  // El teléfono es el bloque de dígitos más largo (tolera +, espacios y guiones).
  // [Tridente r4 #7] Un RUT escrito como RUT (12.345.678-9 / 56789012-3) no es un teléfono: se
  // saca antes de buscar números (queda en el texto del nombre, como estaba escrito).
  const sinRut = resto.replace(RUT_RE, ' ');
  const candidatos = sinRut.match(/[+\d][\d\s.-]{7,}/g) || [];
  // [Tridente r3 #5, 30-sep] Con dos bloques de 9+ dígitos (p. ej. RUT + celular) "el más largo"
  // es una adivinanza: un RUT de 9 dígitos y un celular de 9 empatan. Si alguno empieza con
  // 56/+56 se toma ESE; si no, se rechaza y se pide el formato inequívoco.
  const elegido = elegirTelefono(candidatos);
  if (!elegido.ok && elegido.motivo === 'formato') {
    return { ok: false, error: 'Ese número no es un celular chileno. Escribe el WhatsApp del cliente así: ' +
      'CLIENTE Juan Pérez +56912345678' };
  }
  if (!elegido.ok) {
    return { ok: false, error: 'Hay más de un número en el mensaje y no sé cuál es el WhatsApp. ' +
      'Escríbelo solo, con el código de país: CLIENTE Juan Pérez +56912345678' };
  }
  const crudo = elegido.crudo;
  const phone = soloDigitos(crudo);
  // ⚠️ 9 dígitos mínimo, NO 8. La primera versión aceptaba 8 y les anteponía "569" sola:
  // un typo se convertía en el teléfono de OTRA persona, y la cotización le llegaba a un
  // desconocido. Es exactamente la regla anti-alucinación del proyecto: si falta un dato,
  // se pide — no se rellena en silencio. (Lo marcó Codex en la compuerta del 08-ago.)
  if (phone.length < 9) {
    return {
      ok: false,
      error: 'Ese teléfono no me cuadra. Escribilo completo, con los 9 dígitos: ' +
             'CLIENTE Juan Pérez +56912345678',
    };
  }
  const name = resto.replace(crudo, ' ').replace(/\s+/g, ' ').trim();
  // El nombre es obligatorio: sin él, el PDF formal salía con el nombre del DUEÑO tomado
  // de su propia sesión — una propuesta con identidad equivocada. (Codex, misma pasada.)
  if (!name || name.length < 2) {
    return {
      ok: false,
      error: 'Me falta el nombre del cliente. Va en la propuesta formal, así que no lo puedo inventar: ' +
             'CLIENTE Juan Pérez +56912345678',
    };
  }
  return { ok: true, phone: normalizar(phone), name };
}

/**
 * [Tridente r3 #5 / Thermos r6] Elige el teléfono entre los bloques de dígitos del comando. Pura.
 *  · Un bloque de MÁS de 12 dígitos no es un teléfono: son dos números que la tolerancia a
 *    espacios ("+56 9 1234 5678") juntó — se rechaza SIEMPRE, empiece o no con 56
 *    ("+56912345678 987654321" son 20 dígitos).
 *  · Con dos o más bloques de 9+ dígitos (RUT + celular), solo vale si exactamente uno empieza
 *    con 56/+56; si no, es ambiguo.
 *  · Con uno solo, el más largo (como siempre).
 * @returns {{ok:true, crudo:string}|{ok:false}}
 */
export function elegirTelefono(candidatos = []) {
  if (candidatos.some((c) => soloDigitos(c).length > 12)) return { ok: false, motivo: 'ambiguo' };
  const largos = candidatos.filter((c) => soloDigitos(c).length >= 9);
  // [Tridente r4 #7] Solo un CELULAR CHILENO puede ganar (56 9 + 8 dígitos, o 9 dígitos que
  // empiezan con 9). Un "56…" que no lo es (p. ej. el RUT 56.789.012-3) no gana por empezar con 56.
  const validos = largos.filter(esCelularChileno);
  // Con otros bloques largos al lado, el celular solo gana si viene con 56/+56 (inequívoco).
  if (validos.length === 1 && (largos.length === 1 || /^\+?\s*56/.test(validos[0].trim()))) return { ok: true, crudo: validos[0] };
  if (validos.length >= 1) return { ok: false, motivo: 'ambiguo' };
  if (largos.length) return { ok: false, motivo: 'formato' };
  // Ningún bloque de 9+: se devuelve el más largo para que parseComandoCliente pida "los 9 dígitos".
  let crudo = '';
  for (const c of candidatos) if (soloDigitos(c).length > soloDigitos(crudo).length) crudo = c;
  return { ok: true, crudo };
}

/** RUT chileno escrito con guion (con o sin puntos): 12.345.678-9, 56789012-3, 9.876.543-K. */
const RUT_RE = /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g;

/** Celular chileno: 56 9 + 8 dígitos (o 9 dígitos que empiezan con 9, que normalizar completa). */
export function esCelularChileno(v) {
  return /^569\d{8}$/.test(normalizar(soloDigitos(v)));
}

/**
 * Normaliza a formato chileno sin +: 912345678 → 56912345678.
 * No inventa países: si ya trae 56 o mide más de 9 dígitos, se respeta tal cual.
 */
export function normalizar(raw) {
  const d = soloDigitos(raw);
  if (!d) return '';
  if (d.length === 9 && d.startsWith('9')) return '56' + d;   // celular chileno sin código
  // ⚠️ El caso de 8 dígitos ("569" + d) se ELIMINÓ: adivinaba el número de otra persona a
  // partir de un typo. Ahora parseComandoCliente rechaza menos de 9 y pide que lo escriba
  // completo. Ver el comentario de allá.
  return d;
}

/**
 * ¿Este texto es de verdad el comando, o el dueño solo está escribiendo la palabra
 * "cliente" en una frase normal?
 *
 * [2026-08-08] Codex encontró que interceptar todo lo que empieza con "cliente" se comía
 * mensajes reales: "Cliente me pidió otra medida" nunca llegaba a Oliver, y el dueño no
 * tenía forma de saber por qué. Se intercepta SOLO si trae un teléfono largo o si es la
 * forma corta exacta (CLIENTE / CLIENTE OFF). Cualquier otra cosa sigue de largo al bot.
 */
export function pareceComando(texto) {
  const t = String(texto || '').trim();
  if (!/^\/?\s*cliente\b/i.test(t)) return false;
  const resto = t.replace(/^\/?\s*cliente\b/i, '').trim();
  if (!resto) return true;                                  // "CLIENTE" a secas → ayuda
  if (/^(off|no|ninguno|salir|listo|fin)$/i.test(resto)) return true;
  return soloDigitos(resto).length >= 8;                    // trae algo que parece teléfono
}

/** 🔒 El llamador DEBE haber verificado que es el dueño. */
export function fijar(telefonoDuenio, phone, name) {
  const key = soloDigitos(telefonoDuenio);
  if (!key || !phone) return null;
  // [2026-09-30 · E] `gen` = versión de ESTA fijación. Quien la consume (al aceptarse el envío del PDF) solo la borra
  // si sigue siendo la misma: si entre medio entró "CLIENTE Pedro", la de Pedro no se toca.
  const dato = { phone: normalizar(phone), name: String(name || '').trim(), ts: Date.now(), gen: ++_GEN };
  ATRIBUCIONES.set(key, dato);
  return dato;
}

/**
 * @returns {{phone:string,name:string,gen:number}|null} null si no hay o si ya venció.
 * [2026-09-30 · «Cliente explícito»] Vence a las VIGENCIA_MS desde que se FIJÓ (usarla no la
 * renueva); además se consume cuando Meta acepta el envío del PDF (limpiarSiMisma), con otro
 * CLIENTE o con CLIENTE OFF.
 */
export function obtener(telefonoDuenio) {
  const key = soloDigitos(telefonoDuenio);
  const d = ATRIBUCIONES.get(key);
  if (!d) return null;
  if (Date.now() - d.ts > VIGENCIA_MS) { ATRIBUCIONES.delete(key); return null; }
  return { phone: d.phone, name: d.name, gen: d.gen };
}

export function limpiar(telefonoDuenio) {
  return ATRIBUCIONES.delete(soloDigitos(telefonoDuenio));
}

/** [E] Borra la atribución SOLO si sigue siendo la versión `gen` (compare-and-delete). */
export function limpiarSiMisma(telefonoDuenio, gen) {
  const key = soloDigitos(telefonoDuenio);
  const d = ATRIBUCIONES.get(key);
  if (!d || d.gen !== gen) return false;
  return ATRIBUCIONES.delete(key);
}

// ── Consentimiento de contacto ───────────────────────────────────────────────
// [2026-08-08] Teléfonos cargados con el comando CLIENTE que NUNCA le escribieron al bot.
// A esa gente no se le puede mandar una plantilla de re-enganche: no consintió que le
// escribiéramos (Ley 21.719, vigente 2026-12-01) y Meta baja la calificación del número
// por mandar plantillas sin opt-in.
// Que su ficha exista es otra cosa y sí es legítimo: pidió una cotización.
// La marca se borra SOLA en cuanto esa persona escribe al bot por primera vez — ahí ya
// hay conversación iniciada por ella y el re-enganche pasa a ser normal.
// [2026-08-08] Se respalda en Postgres: es lo ÚNICO de este módulo que no puede perderse
// en un redeploy. Si se pierde, el re-enganche le manda una plantilla a alguien que nunca
// consintió — y eso no se arregla después. La atribución, en cambio, dura minutos: si se
// pierde, el dueño repite el comando y no pasa nada.
const SIN_CONSENTIMIENTO = new Set();
const CLAVE_CONSENT = (p) => `consent:${p}`;
const TTL_CONSENT_S = 180 * 24 * 3600; // 180 días: dura lo que dure el lead

const ESCRIBIERON = new Set();
const CLAVE_ESCRIBIO = (p) => `escribio:${p}`;

/**
 * [F1 · 30-sep] ¿Este número le escribió alguna vez al bot? Es la ÚNICA excepción para no
 * marcarlo "sin consentimiento" al fijar CLIENTE (que exista como lead NO es consentimiento).
 * Ante error de red, false ⇒ se marca (lado seguro de la Ley 21.719).
 */
export async function yaNosEscribio(phone, leer = leerEstado) {
  const p = normalizar(phone);
  if (!p) return false;
  if (ESCRIBIERON.has(p)) return true;
  try { return (await leer(CLAVE_ESCRIBIO(p))) === true; } catch { return false; }
}

export function marcarSinConsentimiento(phone) {
  const p = normalizar(phone);
  if (!p) return p;
  SIN_CONSENTIMIENTO.add(p);
  escribirEstado(CLAVE_CONSENT(p), true, TTL_CONSENT_S);
  return p;
}

/** Se llama cuando entra un mensaje: si esa persona nos habló, ya hay consentimiento. */
export function registrarQueNosEscribio(phone) {
  const p = normalizar(phone);
  // [2026-09-30 · F1] Además queda registrado QUE ESCRIBIÓ (una vez por proceso, para no
  // escribir a Postgres en cada mensaje): el comando CLIENTE lo consulta para no marcar
  // "sin consentimiento" a quien sí inició una conversación.
  if (p && !ESCRIBIERON.has(p)) {
    ESCRIBIERON.add(p);
    try { escribirEstado(CLAVE_ESCRIBIO(p), true, TTL_CONSENT_S); } catch { /* nunca tumba el turno */ }
  }
  const habia = SIN_CONSENTIMIENTO.delete(p);
  // Se borra siempre, no solo si estaba en memoria: tras un redeploy la marca vive en
  // Postgres y no en este Set, y esa es justamente la que hay que levantar.
  borrarEstado(CLAVE_CONSENT(p));
  return habia;
}

/** Síncrono, para el camino caliente del webhook. */
export function sinConsentimiento(phone) {
  const p = normalizar(phone);
  return SIN_CONSENTIMIENTO.has(p) || leerEstadoLocal(CLAVE_CONSENT(p)) === true;
}

/**
 * Versión que SÍ consulta Postgres. La usa el re-enganche, que corre por cron y puede
 * pagar la ida a la red — y es el único lugar donde equivocarse tiene costo real.
 * Tras un redeploy, la marca está en la base y no en memoria: sin esto, el guardarraíl
 * no serviría justo cuando más se necesita.
 */
export async function sinConsentimientoAsync(phone) {
  const p = normalizar(phone);
  if (SIN_CONSENTIMIENTO.has(p)) return true;
  return (await leerEstado(CLAVE_CONSENT(p))) === true;
}

// ── [2026-09-30] Vendedores del equipo (decisión del dueño, 30-sep) ─────────────────────
// Pedido del dueño: el teléfono del VENDEDOR lo carga solo el admin en /equipo (sales-os).
// Cuando un vendedor con «Cotizar con Oliver en modo interno» cotiza por WhatsApp, puede
// ratificar el teléfono del CLIENTE con el mismo comando CLIENTE; si el cliente no existe
// como lead se crea, y la cotización cuenta al CLIENTE (no al vendedor), con su folio ISO.
// Por eso el candado deja de ser "solo el dueño": pasa a ser "el dueño o un número que el
// dueño autorizó en /equipo con modo interno". Cualquier otro número sigue sin poder.

/**
 * ¿Este número puede usar el comando CLIENTE?
 * @param {string} waId
 * @param {{adminPhone?:string, esInterno?:(p:string)=>boolean}} [opciones] esInterno DEBE comparar
 *   el número COMPLETO (internosEquipo.puedeComandoCliente), no los últimos 9.
 */
export function puedeUsarComandoCliente(waId, opciones = {}) {
  return rolCotizador(waId, opciones) !== null;
}

/** El ÚNICO literal del número del dueño en el bot; index.js lo importa de acá. */
export const DUENIO_DEFAULT = '+56957296035';

/**
 * [Tridente r4 #5] ¿Se le acepta a este número este comando CLIENTE? Terminar (CLIENTE OFF) basta
 * con ser vendedor según la última lista conocida; FIJAR un cliente nuevo exige además que la
 * lista no tenga más de 30 min (puedeComandoCliente). El dueño, siempre.
 */
export function autorizaComandoCliente(waId, texto, { adminPhone = telefonoDuenio() } = {}) {
  const esOff = parseComandoCliente(texto || '').limpiar === true;
  return puedeUsarComandoCliente(waId, { adminPhone, esInterno: esOff ? esVendedorConfirmado : puedeComandoCliente });
}

/**
 * Teléfono del dueño (solo dígitos): UNA sola regla para index.js y webhook.js. Mismo orden que
 * usaba index.js para el comando CLIENTE: ADMIN_PHONE, y si no está, el número por defecto.
 */
export function telefonoDuenio() {
  return soloDigitos(process.env.ADMIN_PHONE || DUENIO_DEFAULT);
}

/**
 * ¿Quién cotiza? 'duenio' · 'vendedor' (de /equipo con modo interno) · null (cualquier otro).
 * @param {string} waId
 * @param {{adminPhone?:string, esInterno?:(p:string)=>boolean}} [o]
 */
export function rolCotizador(waId, { adminPhone = telefonoDuenio(), esInterno = () => false } = {}) {
  const w = soloDigitos(waId);
  if (!w) return null;
  const a = soloDigitos(adminPhone);
  if (a && w === a) return 'duenio';
  try { return esInterno(w) === true ? 'vendedor' : null; } catch { return null; }
}


const CLICK_IDS = ['fbclid', 'gclid', 'ttclid', 'ctwa_clid', 'ad_id'];

/**
 * Click-ids a mandar. Con atribución TODOS null: los de la sesión son de quien escribe
 * (vendedor/dueño), no del cliente — criterio de saveLead desde el 08-ago.
 * `landing_ref` sale de `landing_lead_id` de la sesión.
 */
export function clickIdsDe(src, atribucion) {
  const s = (!atribucion && src && typeof src === 'object') ? src : {};
  const out = {};
  for (const k of CLICK_IDS) out[k] = s[k] || null;
  out.landing_ref = s.landing_lead_id || null;
  return out;
}

/**
 * De quién es la cotización de este turno. FUENTE ÚNICA para todos los payloads.
 * Sin atribución: el cliente ES quien escribe (idéntico a antes: sin cotizado_por, sin extras).
 * `cotizado_por` va en la RAÍZ del objeto que se ingesta: sales-os guarda la raíz entera en
 * `quotes.payload` (quoteService.upsertQuote) y en `lead_events.payload` (leadService.upsertLead).
 */
export function identidadCotizacion(from, atribucion) {
  if (!atribucion || !atribucion.phone) {
    return { telefonoCliente: from, externalId: from, claveCot: from, cotizadoPor: null, atribuida: false, extraLead: {} };
  }
  const cotizadoPor = ultimos9(from) || null;
  return {
    telefonoCliente: atribucion.phone,
    // [r3 #6] los payloads de lead lo toman de acá, no de un spread. Excepción documentada:
    // saveLead lo manda SOLO con atribución (sin ella nunca lo mandó; ver webhook saveLead).
    externalId: atribucion.phone,
    claveCot: `${from}:${atribucion.phone}`,
    cotizadoPor,
    atribuida: true,
    // no_pisar: si el cliente ya es lead, sales-os solo completa lo vacío (no cambia su
    // origen, canal ni score). source marca que lo cargó alguien del equipo.
    extraLead: { cotizado_por: cotizadoPor, no_pisar: true, source: 'vendedor_equipo' },
  };
}

/**
 * [2026-09-30] TODAS las claves de estado de una cotización, en UN lugar (antes estaban
 * repartidas en ~10 template strings de webhook.js y cada ronda se escapaba una).
 * Decisión: lo que es del CLIENTE (candados y letras de informes, entregas, deal, reset) va por
 * `telefonoCliente` — así dueño y vendedor sobre el mismo cliente se ven, y el reset del dueño
 * destraba. Lo que evita emitir DOS VECES en la misma conversación (quotesig, emisión) va por
 * `claveCot` (quien escribe + cliente). Sin atribución, todo es `from`, como siempre.
 */
export function clavesCotizacion({ from, telefonoCliente, claveCot }) {
  const cli = soloDigitos(telefonoCliente || from);
  const cot = soloDigitos(claveCot || from);
  return {
    informeTermico: (huella) => (huella ? `informe_termico:${cli}:${huella}` : `informe_termico:${cli}`),
    informeVientos: (huella) => (huella ? `informe_vientos:${cli}:${huella}` : `informe_vientos:${cli}`),
    letraTermico: `informe_letra:${cli}:termico`,
    letraVientos: `informe_letra:${cli}:vientos`,
    reset: `informe_reset:${cli}`,
    deal: `deal:${cli}`,
    cliente: cli,                       // dígitos del cliente (entregas locales, logs, informe_valor)
    quotesig: `quotesig:${cot}`,
    emision: (huella) => `quote_emision:${cot}:${huella}`,
  };
}

/** Lead mínimo del cliente al fijar la atribución (upsertLead de sales-os deduplica por teléfono). */
export function leadDeAtribucion(waIdVendedor, phone, name) {
  const p = normalizar(phone);
  const { extraLead, externalId } = identidadCotizacion(soloDigitos(waIdVendedor), { phone: p });
  return {
    phone: p,
    channel: 'whatsapp',
    name: String(name || '').trim(),
    external_id: externalId,
    ...extraLead,
    metadata: { via: 'comando_CLIENTE', cotizado_por: extraLead.cotizado_por },
  };
}

// La carpeta por cliente vive en services/sesionCarpetas.js.

/**
 * [2026-09-30] El comando CLIENTE entero, fuera de index.js (antes vivía inline allá).
 * index.js solo verifica firma/tipo/quién escribe e intercepta; esto decide y arma la respuesta.
 * @param {{waId:string, texto:string, pushLead:(p:object)=>Promise<any>,
 *          escribio?:(p:string)=>Promise<boolean>, marcar?:(p:string)=>any, logErr?:Function}} o
 * @returns {Promise<string>} el mensaje para quien mandó el comando
 */
export async function procesarComandoCliente({ waId, texto, pushLead, escribio = yaNosEscribio, marcar = marcarSinConsentimiento, logErr = () => {}, esDelEquipo = esDelEquipoParaCliente }) {
  const r = parseComandoCliente(texto || '');
  if (!r.ok) return `⚠️ ${r.error}`;
  if (r.limpiar) {
    limpiar(waId);
    return '✅ Listo. Lo que cotices ahora vuelve a quedar a tu nombre.';
  }
  // [5 · 30-sep] El cliente no puede ser quien escribe, el dueño ni nadie del equipo: eso sería
  // cargarle una cotización a un número interno (y que cuente como venta de un cliente que no es).
  const cli = normalizar(r.phone);
  let esInterno = false;
  try { esInterno = esDelEquipo(cli) === true; } catch { esInterno = false; }
  if (cli === soloDigitos(waId) || cli === telefonoDuenio() || esInterno) {
    return '⚠️ Ese número es tuyo o de alguien del equipo, no de un cliente. Escribe el WhatsApp del cliente: ' +
      'CLIENTE Juan Pérez +56912345678';
  }
  fijar(waId, r.phone, r.name);
  // Si el cliente no existe como lead, se crea (sales-os lo busca por teléfono; no_pisar: si
  // existía, no se le cambia nada). Fire-and-forget: un fallo no rompe el comando.
  try {
    Promise.resolve(pushLead(leadDeAtribucion(waId, r.phone, r.name)))
      .catch((e) => { try { logErr('cliente_atribucion_lead', e); } catch { /* */ } });
  } catch (e) { try { logErr('cliente_atribucion_lead', e); } catch { /* */ } }
  // Consentimiento (08-ago; F1 30-sep): se marca SIEMPRE, salvo que ese número le haya escrito
  // al bot alguna vez (ser lead NO es consentimiento). Ante error de red, se marca.
  let _escribio = false;
  try { _escribio = await escribio(r.phone); } catch { _escribio = false; }
  if (!_escribio) { try { marcar(r.phone); } catch { /* */ } }
  return `✅ Cotizando para *${r.name}* (+${r.phone}).\n\n` +
    'Lo que cotices desde ahora queda a su nombre: el lead, el seguimiento y el CRM. ' +
    'El PDF te llega a vos para que se lo mandes.\n\n' +
    'Vale para UNA propuesta: cuando se envíe el PDF vuelve a tu nombre (para corregirla, manda ' +
    `de nuevo este mismo comando). Para cancelar antes: *CLIENTE OFF*. Vence a las ${Math.round(VIGENCIA_MS / 3600000)} h.` +
    (_escribio ? '' :
      '\n\n⚠️ Como nunca escribió al bot, el seguimiento automático NO le va a llegar ' +
      'hasta que él te escriba por acá. Es a propósito: no podemos mandarle mensajes ' +
      'sin que él haya iniciado la conversación.');
}

/**
 * «Cliente explícito» (dueño, 30-sep): al aceptarse el envío del PDF, la atribución se CONSUME. Se le dice a quien
 * cotiza cómo volver a ese cliente para corregir (re-fijarlo restaura su carpeta y su folio).
 */
export function mensajeTrasPdf(atribucion) {
  if (!atribucion?.phone) return '';
  const nombre = atribucion.name || 'el cliente';
  return `✅ Propuesta de *${nombre}* emitida. Para corregirla manda CLIENTE ${atribucion.name || 'Nombre'} +${atribucion.phone}`;
}

/** Para tests. */
export function _reset() { ATRIBUCIONES.clear(); SIN_CONSENTIMIENTO.clear(); ESCRIBIERON.clear(); }

export default { parseComandoCliente, fijar, obtener, limpiar, normalizar, VIGENCIA_MS };
