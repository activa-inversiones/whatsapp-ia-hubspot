// services/sesionCarpetas.js — CARPETA POR CLIENTE (decisión del dueño 30-sep; rediseño tras el
// NO APTO del tridente). ESM, sin dependencias de red propias: leer/escribir se inyectan.
//
// La sesión de Oliver vive por el número de quien ESCRIBE. Cuando un vendedor (o el dueño) cotiza
// para distintos clientes con el comando CLIENTE, cada cliente tiene su CARPETA: al cambiar el
// cliente activo se GUARDA la sesión entera (estado + historial) en la carpeta del anterior y se
// RESTAURA la del nuevo (o vacía). Sin atribución = carpeta "propia" de quien escribe.
// Así nada se pierde (volver a Juan recupera su trabajo) y nada se filtra (Pedro nunca ve el
// folio, el nombre ni las medidas de Juan). Las carpetas viven en estadoPersistente
// (`sesion_cliente:<quien9>:<cliente9|propia>`), NO dentro del blob de sesión.
//
// 🔒 Durabilidad: si guardar la carpeta SALIENTE falla, NO se toca el estado activo: el cambio
// se aborta ('error') y quien llama avisa. Vaciar sin haber guardado es perder trabajo.

import { ultimos9 } from './internosEquipo.js';

const soloDigitos = (s) => String(s || '').replace(/\D/g, '');

/**
 * Claves de INFRAESTRUCTURA: son de quien escribe, no del cliente, y no se mudan de carpeta.
 * Exportada para que un test documente la lista: agregar algo acá es decidir que se comparte
 * entre clientes.
 */
export const CLAVES_INFRA_SESION = Object.freeze([
  'telefono', 'fecha', 'lastMessageAt', 'carpeta_activa',
  // atribución de anuncios de QUIEN ESCRIBE (con atribución a un cliente no viaja: clickIdsDe)
  'ctwa_clid', 'ad_id', 'gclid', 'fbclid', 'ttclid', 'ctwaCaptured',
  'landing_lead_id', 'landingRefCaptured', 'ref_status',
]);
export const CARPETA_PROPIA = 'propia';
export const TTL_CARPETA_S = 30 * 24 * 3600;

export function claveCarpeta(from, carpeta) {
  const quien = ultimos9(from) || soloDigitos(from);
  const de = carpeta === CARPETA_PROPIA ? CARPETA_PROPIA : (ultimos9(carpeta) || soloDigitos(carpeta));
  return `sesion_cliente:${quien}:${de}`;
}

const itemsPendientes = (s) => (Array.isArray(s?.pending_quote?.items) ? s.pending_quote.items : []);
const clave = (it) => `${it?.product ?? it?.producto_label ?? ''}|${it?.measures ?? ''}|${it?.color ?? ''}|${Number(it?.qty) || 1}`;
const tieneTrabajo = (c) => !!c && ((c.state && Object.keys(c.state).length > 0) || (Array.isArray(c.history) && c.history.length > 0));

/** Une ítems sin duplicar los idénticos (producto+medidas+color+cantidad). */
export function fusionarItems(base = [], extra = []) {
  const out = [...base];
  const vistos = new Set(base.map(clave));
  let agregados = 0;
  for (const it of extra) if (!vistos.has(clave(it))) { vistos.add(clave(it)); out.push(it); agregados++; }
  return { items: out, agregados };
}

/** Una escritura cuenta como fallida si lanza o si dice que no quedó (salvo persistencia apagada, que es memoria local). */
async function guardar(escribir, k, v) {
  const r = await escribir(k, structuredClone(v), TTL_CARPETA_S);
  if (r && r.ok === false && r.motivo !== 'persistencia_apagada') throw new Error(`carpeta no guardada: ${r.motivo || 'sin_motivo'}`);
}

/**
 * Cambia de carpeta si el cliente activo cambió. Muta `state` y `history` en el lugar.
 * @param {{from:string, state:object, history:Array, cliente:string|null,
 *          leer:(k)=>Promise<any>, escribir:(k,v,ttl)=>any}} o  cliente = teléfono normalizado o null
 * @returns {Promise<{mov:'igual'|'cambio'|'adopcion'|'fusion'|'error', agregados?:number, error?:string}>}
 */
export async function cambiarCarpeta({ from, state, history, cliente, leer, escribir }) {
  const nueva = cliente || CARPETA_PROPIA;
  const previa = state.carpeta_activa || CARPETA_PROPIA;
  if (nueva === previa) return { mov: 'igual' };

  const infra = {};
  for (const k of CLAVES_INFRA_SESION) if (k in state) infra[k] = state[k];
  const soloCliente = () => {
    const out = {};
    for (const [k, v] of Object.entries(state)) if (!CLAVES_INFRA_SESION.includes(k)) out[k] = v;
    return out;
  };
  const reemplazar = (nuevoState, nuevoHistory) => {
    const s = structuredClone(nuevoState || {});
    const h = structuredClone(Array.isArray(nuevoHistory) ? nuevoHistory : []);
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, s, infra);
    history.splice(0, history.length, ...h);
    state.carpeta_activa = nueva;
  };

  try {
    let guardada = null;
    if (nueva !== CARPETA_PROPIA || previa !== CARPETA_PROPIA) {
      try { guardada = await leer(claveCarpeta(from, nueva)); } catch { guardada = null; }
    }

    // [B] ADOPCIÓN: se cotizó SIN cliente (carpeta propia con ventanas pendientes) y recién
    // ahora se dice para quién es. Ese trabajo ES del cliente. El folio propio NO viaja.
    const pendientes = itemsPendientes(state);
    if (previa === CARPETA_PROPIA && nueva !== CARPETA_PROPIA && pendientes.length) {
      const propio = { state: state.last_quote ? { last_quote: state.last_quote } : {}, history: [] };
      if (!tieneTrabajo(guardada)) {
        await guardar(escribir, claveCarpeta(from, CARPETA_PROPIA), propio);
        delete state.last_quote;
        state.carpeta_activa = nueva;
        return { mov: 'adopcion' };
      }
      // El cliente YA tenía carpeta: no se pisa. Se restaura la suya y se le AGREGAN las
      // ventanas nuevas (sin duplicar idénticas); quien llama avisa al vendedor.
      await guardar(escribir, claveCarpeta(from, CARPETA_PROPIA), propio);
      reemplazar(guardada.state, guardada.history);
      const { items, agregados } = fusionarItems(itemsPendientes(state), pendientes);
      state.pending_quote = { ...(state.pending_quote || {}), items, at: Date.now() };
      return { mov: 'fusion', agregados };
    }

    await guardar(escribir, claveCarpeta(from, previa), { state: soloCliente(), history: [...history] });
    reemplazar(guardada?.state, guardada?.history);
    return { mov: 'cambio' };
  } catch (e) {
    // No se tocó el estado activo si falló el guardado: quien llama avisa y sigue en la previa.
    return { mov: 'error', error: e?.message || String(e) };
  }
}
