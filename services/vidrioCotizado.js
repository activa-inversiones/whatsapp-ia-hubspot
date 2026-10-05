// vidrioCotizado.js — [2026-10-05] EL VIDRIO LO DECIDE EL MOTOR, como el precio y el Uw.
//
// `enginePricer.js` elige el vidrio de cada ventana (`pickGlassId`, por area y ambiente) y con
// ESE vidrio cobra y calcula el Uw. Una sola regla para WhatsApp (webhook.js) e IG/FB
// (channel-agent.js), y para las opciones A, B y C. Caso que la origino: propuesta 0588.
// Ramas probadas en vidrioCotizado.test.js.

import { vidrioDesdeEtiqueta } from './vientosThermal.js';
import { dicePalabraSaten, esAmbienteBano, sinTildes } from './vidrioSatinado.js';
import { fueraDeVentana24h } from '../src/sales-agent/errorMeta.js'; // [r7] módulo puro: la UNICA lista de códigos de Meta

/** Lo que se imprime cuando nadie sabe el vidrio (ni el LLM ni el motor). */
export const VIDRIO_RESPALDO = 'Termopanel DVH';

const _plano = sinTildes;

/**
 * Satén, esmerilado, acidado, mate, opaco, translúcido o baño: el vidrio que NO se ve a traves.
 * [r5] Es la MISMA definicion que `dibujoVentana.claveVidrio` (ambos importan ./vidrioSatinado.js):
 * antes esta era una lista aparte (solo saten|bano|esmeril) que decia ser «la misma» y no cubria
 * satinado, acidado, mate, opaco ni translucido.
 */
const esBano = (t) => dicePalabraSaten(t) || esAmbienteBano(t);

/**
 * Los dos termopaneles CLAROS que el motor elige por AREA (`enginePricer.pickGlassId`, umbral 2 m²:
 * <2 m² ⇒ 4+12+4, ≥2 m² ⇒ 5+12+5; los rotula asi en enginePricer.js, `item.glass_label`).
 * Cambiar de uno a otro es la regla de area del motor, no un producto distinto.
 */
const CLAROS_POR_AREA = new Set(['4,12,4', '5,12,5']);
const _espesores = (v) => `${v.ext_mm},${v.camara_mm},${v.int_mm}`;

/** Productos que el motor NO cotiza: si la etiqueta decia uno de estos, reemplazarla es borrarle al cliente lo que pidio. */
const OTRO_PRODUCTO = /low[\s-]?e|lamin|control\s*solar|asimetric|monolitic|selective|templad|tintad|bronce|\bgris\b|\bverde\b|reflect|catedral/;

/** ¿El termopanel de la etiqueta tiene OTROS espesores que el del motor? Sin espesor legible en alguno, no hay con que comparar. */
function otroEspesor(etiqueta, vidrioMotor) {
  const a = vidrioDesdeEtiqueta(etiqueta);
  const b = vidrioDesdeEtiqueta(vidrioMotor);
  if (!a || !b) return false;
  if (_espesores(a) === _espesores(b)) return false;
  // [r5 · Thermos BAJO] 4+12+4 ↔ 5+12+5 es la regla de AREA del motor (ver CLAROS_POR_AREA), no otro producto.
  if (CLAROS_POR_AREA.has(_espesores(a)) && CLAROS_POR_AREA.has(_espesores(b))) return false;
  return true;
}

const esOtroProducto = (etiqueta, vidrioMotor) =>
  OTRO_PRODUCTO.test(_plano(etiqueta)) || otroEspesor(etiqueta, vidrioMotor);

/** ¿El motor cotizo esta ventana? Mismo criterio que las sondas de color (sirve en `.every`). */
export function motorCotizo(cotizado) {
  return Boolean(cotizado) && Number(cotizado.unit_price) > 0 && cotizado.confidence === 'high';
}

/** El vidrio con que el motor cotizo, o null si no la cotizo o no trae vidrio. */
export function vidrioDelMotor(cotizado) {
  if (!motorCotizo(cotizado)) return null;
  return String(cotizado.glass_label || '').trim() || null;
}

/**
 * SOLO para el bloque del Uw de webhook.js, que recotiza con los datos del PDF: ¿el precio que
 * se imprime es el que el motor calculo ahora? Si no, salio de otro calculo (p. ej. con un
 * ambiente "baño" que el PDF perdio) y el vidrio de esta recotizacion no es el cobrado.
 */
export function precioCoincide(cotizado, precioImpreso) {
  if (!cotizado) return false;
  return Math.round(Number(precioImpreso)) === Math.round(Number(cotizado.unit_price));
}

/**
 * Que vidrio va al documento. `aviso` es para el log (va al tablero, no cambia nada):
 *  · 'vidrio.bano_perdido': la etiqueta dice satén/baño/esmerilado y el motor no ⇒ NO se reemplaza.
 *  · 'vidrio.producto_distinto': la etiqueta reemplazada describia otro producto (low-e, laminado,
 *    templado, tintado, otros espesores...) que el motor no cotiza.
 * `mismoPrecio` (default true, el default vive SOLO aca): false ⇒ el vidrio del motor no es el
 * cobrado en el precio que se imprime, asi que queda lo que venia.
 */
export function elegirVidrio(etiqueta, vidrioMotor, { mismoPrecio = true } = {}) {
  const actual = String(etiqueta || '').trim();
  if (!vidrioMotor) return { vidrio: actual, aviso: null };
  if (esBano(actual) && !esBano(vidrioMotor)) return { vidrio: actual, aviso: 'vidrio.bano_perdido' };
  if (!mismoPrecio) return { vidrio: actual, aviso: null };
  return { vidrio: vidrioMotor, aviso: esOtroProducto(actual, vidrioMotor) ? 'vidrio.producto_distinto' : null };
}

/** Aplica `elegirVidrio` sobre el item y junta el aviso en `avisos` (obligatorio: sin el, un aviso se perderia). */
export function aplicarVidrio(item, vidrioMotor, { avisos, mismoPrecio } = {}) {
  if (!Array.isArray(avisos)) throw new TypeError('aplicarVidrio: `avisos` es obligatorio (un arreglo donde juntar los avisos)');
  const original = String(item.glass_label || '').trim();
  const { vidrio, aviso } = elegirVidrio(original, vidrioMotor, { mismoPrecio });
  if (vidrio && vidrio !== original) item.glass_label = vidrio;
  if (aviso) avisos.push({ aviso, original, motor: vidrioMotor });
}

/**
 * El texto para el dueño: la etiqueta dice satén/baño/esmerilado y se cotizó con vidrio claro.
 * Mismo folio + mismas etiquetas ⇒ mismo texto, y el cooldown de highValueNotifier (clave:
 * telefono + motivo) lo manda UNA sola vez por folio. No cambiar el texto entre llamadas.
 */
export function textoBanoPerdido(folio, etiquetas) {
  const dice = etiquetas.map((e) => `"${e}"`).join(' y ');
  return `La propuesta ${folio} dice ${dice} pero se cotizó con vidrio claro; revisar precio.`;
}

/**
 * Por qué el aviso al dueño NO salió, en una frase para el log; `null` si no hay falla que declarar.
 * `r` es lo que devuelve `notifyHighValue` (a traves de `safe()`, que devuelve null si el notificador lanzo).
 * `cooldown` NO es falla: es «ya se le aviso» de este folio (el aviso es uno por folio, a proposito).
 */
function motivoSinAviso(r) {
  if (r && r.sent === true) return null;
  if (r && r.reason === 'cooldown') return null;
  if (r === null || r === undefined) return 'excepcion';
  const partes = [r.reason, r.code != null ? `code=${r.code}` : null, r.error ? String(r.error).slice(0, 200) : null].filter(Boolean);
  return partes.join(' ') || 'sin_confirmacion';
}

/**
 * [r7] «UNA VEZ» de los respaldos, por folio y etiquetas (estado del PROCESO, como el `alertCooldown` de
 * highValueNotifier: un redeploy lo borra y, en el peor caso, el dueño recibe un aviso repetido, nunca uno menos).
 * TTL_PLANTILLA = el cooldown del texto (2 h); TTL_PANEL = la deduplicacion del evento de la escalacion #888 (6 h).
 */
const MARCAS = new Map();
const TTL_PLANTILLA_MS = 2 * 60 * 60 * 1000;
const TTL_PANEL_MS = 6 * 60 * 60 * 1000;

function marcaVigente(clave) {
  const hasta = MARCAS.get(clave);
  if (hasta === undefined) return false;
  if (hasta > Date.now()) return true;
  MARCAS.delete(clave);
  return false;
}

function marcar(clave, ttlMs) {
  if (MARCAS.size > 500) {
    const ahora = Date.now();
    for (const [k, hasta] of MARCAS) if (hasta <= ahora) MARCAS.delete(k); // backstop de memoria
  }
  MARCAS.set(clave, Date.now() + ttlMs);
}

/**
 * Loguea los avisos juntados, UNA vez cada uno, con el folio del documento. Y si hay satén
 * perdido, llama UNA vez a `avisarDueno(texto)` (el canal de avisos del bot, de quien llama) con
 * el folio y todas las etiquetas. El precio no se toca: eso es carril plata y va a propuesta.
 *
 * [r5 · Thermos MEDIO-BAJO] Si `avisarDueno` devuelve una promesa, SE MIRA lo que resuelve: el
 * aviso que no salio (Meta lo rechazo, no hay telefono del dueño, el notificador lanzo) queda en el
 * log como `vidrio.aviso_no_salio` con el folio. Antes se tiraba a la basura y un satén perdido
 * podia quedar sin ningun rastro. Devuelve esa promesa (que NUNCA rechaza) para poder esperarla
 * en un test; los llamadores no necesitan esperarla. Un `avisarDueno` que no devuelve promesa
 * (los de antes) sigue andando igual.
 *
 * [r7] EL TEXTO LIBRE MUERE FUERA DE LA VENTANA DE 24 H, Y ESO TAMBIEN HAY QUE CUBRIRLO. Si el dueño no le
 * escribio al bot en las ultimas 24 h Meta rechaza el texto (131047) y, tras r5, eso quedaba SOLO como una
 * linea de log que nadie lee. `respaldo` (opcional) le da al aviso lo que ya tienen las escalaciones (#888):
 *   · `plantilla(etiquetas) → {ok}` : el MISMO aviso por la plantilla aprobada, que SI pasa la ventana. Se usa
 *     solo ante un rechazo CONOCIDO de ventana (`envio_fallido` + 131047, errorMeta.fueraDeVentana24h): un
 *     timeout (`envio_dudoso`) pudo haber llegado y reenviarlo duplicaria el aviso al dueño. UNA vez por
 *     folio y etiquetas (el folio se reusa en una correccion; el texto lo cubre el cooldown de
 *     highValueNotifier, la plantilla no pasa por ahi). Una plantilla que FALLO no marca nada: el reintento sale.
 *   · `alPanel({body, metadata}) → void` : si la plantilla TAMBIEN fallo, un evento visible en la conversacion
 *     (el panel; un console.log en Railway se pierde entre miles de lineas), con `metadata.aviso_fallido`,
 *     igual que la escalacion #888. Uno por folio: el mismo problema no se repite en cada reintento.
 * Sin `respaldo` todo sigue como en r5 (solo el log). Las demas fallas (sin telefono del dueño, excepcion...)
 * tampoco pasan por la plantilla: quedan en el log como antes.
 */
export function avisarVidrio(avisos, folio, logWarn, avisarDueno = null, respaldo = null) {
  const vistos = new Set();
  const etiquetasBano = [];
  for (const a of avisos || []) {
    const k = `${a.aviso}|${a.original}|${a.motor}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    logWarn(a.aviso, `${folio}: etiqueta "${a.original}" · vidrio del motor "${a.motor}"`);
    if (a.aviso === 'vidrio.bano_perdido' && !etiquetasBano.includes(a.original)) etiquetasBano.push(a.original);
  }
  if (!etiquetasBano.length || typeof avisarDueno !== 'function') return undefined;

  // La misma granularidad que el cooldown del texto: su clave lleva el folio Y las etiquetas (van en el motivo).
  const claveAviso = `${folio}|${etiquetasBano.join('|')}`;
  if (marcaVigente(`plantilla|${claveAviso}`)) return undefined; // ya salio por plantilla: el dueño esta avisado

  const salida = avisarDueno(textoBanoPerdido(folio, etiquetasBano));
  if (!salida || typeof salida.then !== 'function') return undefined;
  const declarar = (motivo) => {
    if (!motivo) return;
    try {
      logWarn('vidrio.aviso_no_salio', `${folio}: el aviso al dueño por el satén NO salió (${motivo}) — revisar el precio de esta propuesta a mano`);
    } catch { /* declarar no puede romper la entrega de la propuesta */ }
  };

  const porPlantilla = async (motivoTexto) => {
    let rp;
    if (typeof respaldo.plantilla !== 'function') rp = { ok: false, error: 'sin_plantilla' };
    else {
      try { rp = await respaldo.plantilla([...etiquetasBano]); } catch (err) { rp = { ok: false, error: `excepcion: ${err?.message || err}` }; }
    }
    if (rp && rp.ok === true) {
      marcar(`plantilla|${claveAviso}`, TTL_PLANTILLA_MS);
      try {
        logWarn('vidrio.aviso_por_plantilla', `${folio}: el texto al dueño lo rechazó Meta (${motivoTexto}); el aviso por el satén salió por la plantilla`);
      } catch { /* informativo */ }
      return;
    }
    // `null` = el envio lanzo y `safe()` lo trago; `{}` = respondio sin decir ok. Nunca un motivo vacio.
    const motivoPlantilla = String(rp?.error ?? rp?.reason ?? (rp === null || rp === undefined ? 'excepcion' : 'sin_confirmacion')).slice(0, 200);
    declarar(`${motivoTexto}; plantilla: ${motivoPlantilla}`);
    if (typeof respaldo.alPanel !== 'function' || marcaVigente(`panel|${claveAviso}`)) return;
    try {
      await respaldo.alPanel({
        body: `⚠️ La propuesta ${folio} dice ${etiquetasBano.map((e) => `"${e}"`).join(' y ')} pero se cotizó con vidrio claro, y el aviso a Marcelo NO salió `
          + '(ni por texto ni por plantilla). Hay que revisar el precio de esta propuesta a mano.',
        metadata: { aviso_fallido: true, vidrio_bano_perdido: true, folio, etiquetas: [...etiquetasBano], motivo_notify: motivoTexto, motivo_plantilla: motivoPlantilla },
      });
      marcar(`panel|${claveAviso}`, TTL_PANEL_MS);
    } catch { /* el evento es el ultimo recurso: si tambien falla, queda el log de arriba */ }
  };

  const resolver = async (r) => {
    try {
      const motivo = motivoSinAviso(r);
      if (!motivo) return;
      if (respaldo && r && r.sent === false && r.reason === 'envio_fallido' && fueraDeVentana24h(r)) await porPlantilla(motivo);
      else declarar(motivo);
    } catch { /* la promesa de esta funcion NUNCA rechaza */ }
  };
  return salida.then(resolver, (err) => declarar(`excepcion: ${err?.message || err}`));
}
