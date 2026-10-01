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
import { perfilEquipo } from './internosEquipo.js';
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
  return {
    telefonoCliente: atribucion.phone,
    externalId: atribucion.phone,
    claveCot: `${from}:${atribucion.phone}`,
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
export function resolverTurno(from, ahora = Date.now(), { perfil = perfilEquipo, leerAtribucion = obtener } = {}) {
  const p = perfil(from, ahora);
  const conPermiso = p.rol === 'duenio' || p.rol === 'vendedor';
  const atribucion = conPermiso ? leerAtribucion(from) : null;
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
  };
}

/** Quote-event: cotizado_por en la raíz (y solo ahí, en el nivel del quote). */
export function payloadQuote(turno, base = {}) {
  return { ...base, ...(turno.cotizadoPor ? { cotizado_por: turno.cotizadoPor } : {}) };
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

/** Lead mínimo del cliente al fijar la atribución (upsertLead de sales-os lo busca por teléfono). */
export function leadDeAtribucion(quienEscribe, phoneCrudo, name) {
  const phone = normalizarChileno(phoneCrudo);
  const { extraLead, externalId } = identidadCotizacion(digitos(quienEscribe), { phone });
  return {
    phone,
    channel: 'whatsapp',
    name: String(name || '').trim(),
    external_id: externalId,
    ...extraLead,
    metadata: { via: 'comando_CLIENTE', cotizado_por: extraLead.cotizado_por },
  };
}
