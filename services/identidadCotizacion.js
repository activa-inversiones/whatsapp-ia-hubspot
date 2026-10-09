// services/identidadCotizacion.js — DE QUIÉN es lo que se registra en un turno de Oliver.
//
// 📌 REGLA (decisión del dueño 30-sep, vendedores cotizan a nombre del cliente):
//   · turno.quienEscribe (= `from`)  → SOLO el chat: envíos de WhatsApp, acuses, sesión, mensajes.
//   · turno.cliente                  → TODO registro: lead, cotización, informes, archivos (media),
//                                      espejos de documentos, Deal, entregas.
//   Sin atribución son el mismo número y todo queda como siempre.
//
// resolverTurno() se llama UNA vez, apenas el turno toma el lock por teléfono (la atribución es una
// FOTO: nadie la relee durante el turno). Los payloads se arman con los builders de este módulo.

import { digitos, ult9, normalizarChileno } from './telefono.js';
import { perfilEquipo, textoCorteVendedor } from './internosEquipo.js';
import { obtener } from './atribucionStore.js';

const CLICK_IDS = ['fbclid', 'gclid', 'ttclid', 'ctwa_clid', 'ad_id'];

/**
 * Click-ids a mandar. Con atribución TODOS null: los de la sesión son de quien escribe
 * (vendedor/dueño), no del cliente. `landing_ref` sale de `landing_lead_id` de la sesión.
 */
export function clickIdsDe(src, atribucion) {
  const s = (!atribucion && src && typeof src === 'object') ? src : {};
  const out = {};
  for (const k of CLICK_IDS) out[k] = s[k] || null;
  out.landing_ref = s.landing_lead_id || null;
  return out;
}

/**
 * Identidad de la cotización. Sin atribución: el cliente ES quien escribe (sin cotizado_por, sin
 * extras). `cotizado_por` (últimos 9 de quien cotizó) va en la RAÍZ de cada objeto que se ingesta:
 * en el quote-event (sales-os guarda la raíz en quotes.payload) y en el lead (lead_events.payload).
 */
export function identidadCotizacion(from, atribucion) {
  if (!atribucion || !atribucion.phone) {
    return { telefonoCliente: from, externalId: from, claveCot: from, cotizadoPor: null, atribuida: false, extraLead: {} };
  }
  const cotizadoPor = ult9(from) || null;
  // [r10] Normaliza ADENTRO: nadie de afuera tiene que acordarse de pasar el teléfono limpio.
  const cliente = normalizarChileno(atribucion.phone);
  return {
    telefonoCliente: cliente,
    externalId: cliente,
    claveCot: `${from}:${cliente}`,
    cotizadoPor,
    atribuida: true,
    // no_pisar: si el cliente ya es lead, sales-os solo completa lo vacío. source = lo cargó el equipo.
    extraLead: { cotizado_por: cotizadoPor, no_pisar: true, source: 'vendedor_equipo' },
  };
}

/**
 * TODAS las claves de estado de una cotización. Del CLIENTE (informes, letras, entregas, deal,
 * reset): dueño y vendedor sobre el mismo cliente se ven, y el reset del dueño destraba. Del PAR
 * quien-escribe+cliente (quotesig, emisión): no emitir dos veces en la misma conversación.
 */
export function clavesCotizacion({ from, telefonoCliente, claveCot }) {
  const cli = digitos(telefonoCliente || from);
  const cot = digitos(claveCot || from);
  return {
    informeTermico: (huella) => (huella ? `informe_termico:${cli}:${huella}` : `informe_termico:${cli}`),
    informeVientos: (huella) => (huella ? `informe_vientos:${cli}:${huella}` : `informe_vientos:${cli}`),
    letraTermico: `informe_letra:${cli}:termico`,
    letraVientos: `informe_letra:${cli}:vientos`,
    reset: `informe_reset:${cli}`,
    deal: `deal:${cli}`,
    cliente: cli,
    quotesig: `quotesig:${cot}`,
    emision: (huella) => `quote_emision:${cot}:${huella}`,
  };
}

/**
 * La FOTO del turno. Una sola lectura de rol y atribución, tomada tras el lock.
 * @returns {{quienEscribe:string, cliente:string, perfil:object, rol:string|null, esDuenio:boolean,
 *   esVendedor:boolean, atribucion:object|null, claveCot:string, claves:object, cotizadoPor:string|null,
 *   externalId:string, extraLead:object, clickIds:(src:object)=>object, puedeEmitir:boolean,
 *   _trasEmitirHecho:boolean}}
 */
export function resolverTurno(from, ahora = Date.now(), { perfil = perfilEquipo, leerAtribucion = obtener, tsMensaje = null } = {}) {
  const p = perfil(from, ahora);
  const conPermiso = p.rol === 'duenio' || p.rol === 'vendedor';
  // [M2 r10] La atribución que regía cuando se MANDÓ el mensaje (hora WhatsApp), no la de ahora.
  const atribucion = conPermiso ? leerAtribucion(from, { tsMensaje }) : null;
  const id = identidadCotizacion(from, atribucion);
  const esVendedor = p.rol === 'vendedor' || p.rol === 'vendedor_ambiguo';
  return {
    quienEscribe: from,
    cliente: id.telefonoCliente,
    perfil: p,
    rol: p.rol,
    esDuenio: p.rol === 'duenio',
    esVendedor,
    atribucion,
    claveCot: id.claveCot,
    claves: clavesCotizacion({ from, telefonoCliente: id.telefonoCliente, claveCot: id.claveCot }),
    cotizadoPor: id.cotizadoPor,
    externalId: id.externalId,
    extraLead: id.extraLead,
    clickIds: (src) => clickIdsDe(src, atribucion),
    // Un vendedor (o un número ambiguo del equipo) sin cliente fijado NO emite nada a su nombre.
    puedeEmitir: !(esVendedor && !atribucion),
    _trasEmitirHecho: false,
  };
}

/**
 * Lead dentro de un quote-event. `datos` trae los campos propios de cada camino (nombre, comuna,
 * estado, click-ids…); external_id sale de la identidad y los extras de atribución van al final.
 */
export function payloadLeadCotizacion(turno, datos = {}) {
  return {
    source: 'oliver_gpt',
    channel: 'whatsapp',
    ...datos,
    external_id: turno.externalId || null,
    ...turno.extraLead,
    // [01-oct] Esto ES una cotización: con atribución, un lead PERDIDO se reabre («si alguien le
    // cotiza, está vivo»). Solo acá; saveLead (sin cotización) completa vacíos y no reabre.
    ...(turno.atribucion ? { reabrir: true } : {}),
  };
}

/**
 * Quote-event. cotizado_por en la raíz. Con `clickSrc`, los click-ids se calculan UNA vez
 * (turno.clickIds: null con atribución) y el builder los pone en los tres lugares donde sales-os
 * los lee hoy (raíz, lead y payload) — mismo formato de cable que antes; ningún llamador los esparce.
 */
export function payloadQuote(turno, base = {}, { clickSrc } = {}) {
  const ck = clickSrc ? turno.clickIds(clickSrc) : null;
  const out = { ...base };
  if (ck) {
    Object.assign(out, ck);
    if (base.lead) out.lead = { ...base.lead, ...ck };
    if (base.payload) out.payload = { ...base.payload, ...ck };
  }
  if (turno.cotizadoPor) out.cotizado_por = turno.cotizadoPor;
  return out;
}

/** Nombre del borrador: el del comando CLIENTE manda; si no, el de la sesión, el de perfil o ''. */
export function nombreBorrador(turno, state = {}, pushName = '') {
  return turno.atribucion?.name || state.name || pushName || '';
}

/**
 * Lead de saveLead. Excepción documentada: SIN atribución no lleva external_id (saveLead nunca lo
 * mandó y agregarlo cambiaría el lead_events.payload de todo cliente normal).
 */
export function payloadSaveLead(turno, leadState = {}, state = {}) {
  const a = turno.atribucion;
  return {
    phone: turno.cliente,
    channel: 'whatsapp',
    name: a?.name || leadState.name || state.name || '',   // el nombre del comando manda
    comuna: leadState.comuna || state.comuna || '',
    stage: leadState.stageKey || 'oliver_gpt',
    items: leadState.items || [],
    value: leadState.grand_total || null,
    // Con atribución NO viajan click-ids (son de quien escribe). Lo del leadState manda sobre la sesión.
    ...turno.clickIds({
      ctwa_clid: leadState.ctwa_clid || state.ctwa_clid,
      ad_id: leadState.ad_id || state.ad_id,
      gclid: leadState.gclid || state.gclid,
      fbclid: leadState.fbclid || state.fbclid,
      ttclid: leadState.ttclid || state.ttclid,
      landing_lead_id: leadState.landing_ref || leadState.landing_lead_id || state.landing_lead_id,
    }),
    ...(a ? { external_id: turno.externalId } : {}),
    ...turno.extraLead,
    metadata: a
      ? { source: 'oliver_gpt', atribuido_por: turno.cotizadoPor, atribuido_at: new Date().toISOString(), via: 'comando_CLIENTE' }
      : { source: 'oliver_gpt', ref_status: state.ref_status || null },   // [#966]
  };
}

/**
 * [r11 #1 · Codex] El turno V1 (index.js, respaldo ante una excepción de Oliver GPT) NO entiende la
 * atribución: cotizaría a nombre de quien escribe. Si quien escribe tiene un cliente fijado —o es un
 * vendedor, con o sin cliente— V1 no lo atiende. [Fase 0, 09-oct] El dueño sin cliente fijado TAMPOCO: se le pide CLIENTE.
 */
export const TEXTO_V1_CON_ATRIBUCION = 'Tuve un problema procesando tu mensaje, reenvíalo en un minuto.';
export const TEXTO_V1_DUENIO_SIN_CLIENTE = 'Antes de cotizar dime para qué cliente es: CLIENTE Nombre Apellido +569XXXXXXXX (o reenvía tu mensaje en un minuto si era una prueba).';
/**
 * @returns {string|null} el texto a responder si V1 NO debe atender este mensaje; null si puede.
 *  · [r13 #3] el dueño con un comando admin (parseAdminCmd) pasa: esos comandos no cotizan.
 *  · [r13 #3/#4] un vendedor (o vendedor_ambiguo) SIN cliente recibe la causa real
 *    (textoCorteVendedor), no un «reenvíalo» que lo dejaría en bucle.
 */
export function v1Rechazo(waId, tsMensaje = null, { esComandoAdmin = false, deps } = {}) {
  const t = resolverTurno(waId, Date.now(), { ...(deps || {}), tsMensaje });
  if (t.esDuenio && esComandoAdmin) return null;
  // 🔴 [2026-10-09 · Fase 0, Codex r1 ALTO #3] DA VUELTA «dueño para sí: V1 normal». La V1 (respaldo cuando Oliver GPT
  // falla o no enruta) era la puerta lateral: cotizaba a nombre del dueño sin cliente. Sin atribución, la V1 no le
  // cotiza: se le pide CLIENTE (PRUEBA vive en el camino principal; la V1 no la conoce, y no hace falta).
  if (t.esDuenio && !t.atribucion) return TEXTO_V1_DUENIO_SIN_CLIENTE;
  if (t.esVendedor && !t.atribucion) return textoCorteVendedor(t.perfil);
  if (t.atribucion || t.esVendedor) return TEXTO_V1_CON_ATRIBUCION;
  return null;
}

// [r11 #6] leadDeAtribucion se BORRÓ: el lead del cliente ya no se crea al fijar CLIENTE sino al
// cotizar (el `lead` del quote-event, payloadLeadCotizacion, con no_pisar).
