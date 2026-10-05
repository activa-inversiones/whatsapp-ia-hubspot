// vidrioCotizado.js — [2026-10-05] EL VIDRIO LO DECIDE EL MOTOR, como el precio y el Uw.
//
// `enginePricer.js` elige el vidrio de cada ventana (`pickGlassId`, por area y ambiente) y con
// ESE vidrio cobra y calcula el Uw. Una sola regla para WhatsApp (webhook.js) e IG/FB
// (channel-agent.js), y para las opciones A, B y C. Caso que la origino: propuesta 0588.
// Ramas probadas en vidrioCotizado.test.js; el aviso al dueño (`avisarVidrio`), en avisarVidrio.test.js.
// [r8] Sin estado propio: el almacén de «ya avisado» lo inyecta el llamador (como `deps.leerEstado`).

import { vidrioDesdeEtiqueta } from './vientosThermal.js';
import { dicePalabraSaten, esAmbienteBano, sinTildes } from './vidrioSatinado.js';
import { claveAviso, tocaAvisar } from './avisoEntregaDudosa.js';  // [r8] el molde de deduplicación del repo (módulo puro)
import { COOLDOWN_MS } from './highValueNotifier.js';              // [r8] UNA ventana de «ya se le avisó» para el texto y la plantilla

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
 * [r8] La frase que dice el problema, UNA sola vez para los tres lugares que la muestran (el texto al dueño,
 * el evento del panel y el parámetro de la plantilla, escalation.js): la etiqueta dice satén/baño/esmerilado y
 * se cotizó con vidrio claro. Cada uno le agrega lo suyo. `etiquetas` ya viene recortada por quien la muestra.
 */
export function fraseBanoPerdido(etiquetas) {
  return `dice ${etiquetas.map((e) => `"${e}"`).join(' y ')} pero se cotizó con vidrio claro`;
}

/**
 * El texto para el dueño: la etiqueta dice satén/baño/esmerilado y se cotizó con vidrio claro.
 * Mismo folio + mismas etiquetas ⇒ mismo texto, y el cooldown de highValueNotifier (clave:
 * telefono + motivo) lo manda UNA sola vez por folio. No cambiar el texto entre llamadas.
 */
export function textoBanoPerdido(folio, etiquetas) {
  return `La propuesta ${folio} ${fraseBanoPerdido(etiquetas)}; revisar precio.`;
}

/**
 * [r8] El porqué de un envío que no salió, en una frase para el log y el panel. Sirve a los DOS canales:
 *  · texto: lo que devuelve `notifyHighValue` ({sent:false, reason, code?, error?}).
 *  · plantilla: lo que devuelve `sendAvisoVidrioTemplate`. /admin/send-template contesta {ok, template, phone,
 *    result} y el error de Meta vive en `result.error` (index.js:5280); el fallo propio de escalation.js
 *    ({ok:false, error}) lo trae arriba. Por eso `error || result.error`.
 * `||` y no `??`: un `error: ''` no puede dejar el motivo vacío. `null`/`undefined` = el envío lanzó y el `safe()`
 * del llamador lo tragó; `{}` = respondió sin decir nada.
 */
export function motivoDeEnvio(r) {
  if (r === null || r === undefined) return 'excepcion';
  const detalle = r.error || r.result?.error;
  const partes = [r.reason, r.code != null ? `code=${r.code}` : null, detalle ? String(detalle).slice(0, 200) : null].filter(Boolean);
  return partes.join(' ') || 'sin_confirmacion';
}

/**
 * Cada cuánto se puede repetir el aviso del MISMO folio: la ventana del cooldown del texto (highValueNotifier),
 * UNA constante importada. Si fuera menor, vencería la marca y volvería a salir la plantilla mientras el texto
 * sigue en cooldown.
 */
export const AVISO_VIDRIO_REPETIR_MS = COOLDOWN_MS;
/** Cuánto vive la reserva «en vuelo» si nadie la suelta (el proceso muere a mitad del envío). */
const RESERVA_EN_VUELO_SEG = 120;

const LLEGO = 'llego';
const DUDOSO = 'dudoso';
const FALLO = 'fallo';

/** El texto (notifyHighValue): llegó si salió o ya salió antes (`cooldown`); dudoso si fue un timeout (`envio_dudoso`). */
function estadoDelTexto(r) {
  if (r && (r.sent === true || r.reason === 'cooldown')) return LLEGO;
  if (r && r.reason === 'envio_dudoso') return DUDOSO;
  return FALLO;
}

/** La plantilla (/admin/send-template): llegó con `ok:true` (salvo `sent:false`); el abort por timeout es dudoso. */
function estadoDeLaPlantilla(r) {
  if (r && r.ok === true && r.sent !== false) return LLEGO;
  if (r && r.timedOut === true) return DUDOSO;
  return FALLO;
}

/** Corre un canal; si LANZA (o rechaza su promesa) devuelve un resultado de fallo con el motivo, nunca revienta. */
async function intentar(canal) {
  try {
    return await canal();
  } catch (err) {
    return { ok: false, sent: false, reason: 'excepcion', error: err?.message || String(err) };
  }
}

/**
 * El aviso al dueño cuando la propuesta dice satén/baño/esmerilado y se cotizó con vidrio claro. El precio no se
 * toca (carril plata: va a propuesta); lo que se garantiza es que el dueño SE ENTERE. Loguea cada aviso del
 * vidrio UNA vez con el folio y, si hay satén perdido, avisa por los tres `canales` (que vienen SIEMPRE completos,
 * de `crearCanalesAvisoVidrio`): `texto(texto)`, `plantilla({folio, etiquetas})` y `panel({body, metadata})`.
 *
 * ── TEXTO Y PLANTILLA, SIEMPRE, UNA VEZ POR FOLIO (r8; igual que la escalación #888, webhook.js:1810-1876) ──
 * r7 mandaba la plantilla solo si el texto era rechazado de forma síncrona con 131047. Pero AGENTS.md:15-19
 * (medido el 05-sep): fuera de la ventana de 24 h Meta ACEPTA el texto con 200 y lo marca `failed` después, por
 * webhook ⇒ `notifyHighValue` devuelve `sent:true`, el aviso se daba por entregado y la plantilla nunca salía. Y el
 * bot no sabe cuándo le escribió el dueño por última vez, así que no puede elegir canal: salen los dos.
 *  · avisado = el texto salió (o ya había salido: cooldown) O la plantilla salió. Se escribe la marca de «ya
 *    avisado» y, si un canal falló por algo real, queda dicho en el log (`vidrio.canal_degradado`).
 *  · DUDOSO = ninguno salió y alguno hizo timeout (la request ya salió: pudo llegar). NO se reenvía (se escribe
 *    la marca) y el panel dice «dudoso, mirá el chat». `vidrio.aviso_dudoso`.
 *  · ninguno salió, por el motivo que sea (sin teléfono del dueño, excepción, códigos de Meta): `vidrio.aviso_no_salio`
 *    y UN evento visible en la conversación (el panel; un log en Railway se pierde entre miles de líneas), con
 *    `metadata.aviso_fallido` como la escalación #888. Sin marca: el reintento vuelve a intentar los dos canales.
 *
 * ── DEDUPLICACIÓN: el molde del repo (avisarEntregaDudosa / avisarCerebroDeRespaldo, webhook.js ~917-996) ──
 * `estado` = {reservar, liberar, leer, escribir}, lo inyecta el llamador (este módulo no guarda estado).
 * `reservar` es atómico en memoria y va PRIMERO: dos llamadas casi simultáneas del mismo folio mandaban dos
 * plantillas porque la marca se fijaba después del await. `leer`/`escribir` son el KV durable (sobrevive al
 * redeploy) y `tocaAvisar(ultimo.at, ahora, repetirMs)` decide. La marca se escribe SOLO si el aviso llegó o es dudoso.
 * ⚠️ Se desvía del molde en UNA cosa, a propósito: la reserva y la marca viven en CLAVES DISTINTAS. El molde usa
 * una sola, y `estadoPersistente.reservar()` hace `escribir(clave, token)` (memoria + PUT a Postgres): tras un
 * redeploy ese PUT PISA la marca durable y el `leer()` siguiente pega en la memoria (el token) ⇒ el «sobrevive
 * al redeploy» no existe. Con dos claves, `leer(marca)` sí llega a Postgres.
 *
 * Devuelve SIEMPRE una Promise<void> que NUNCA rechaza (los llamadores no la esperan: corre suelta, con el mutex
 * del teléfono tomado). El log del tablero sale sincrónico, antes del primer await.
 *
 * @param {object} p
 * @param {Array}  p.avisos    los que juntó `aplicarVidrio`
 * @param {string} p.folio     el folio del documento: ESTA función es dueña de él (los canales lo reciben, no lo capturan)
 * @param {(aviso: string, texto: string) => void} p.logWarn
 * @param {{texto: Function, plantilla: Function, panel: Function}} p.canales
 * @param {{reservar: Function, liberar: Function, leer: Function, escribir: Function}} p.estado
 * @param {() => number} [p.ahora]       reloj inyectable (los tests lo adelantan)
 * @param {number} [p.repetirMs]
 */
export async function avisarVidrio({ avisos, folio, logWarn, canales, estado, ahora = Date.now, repetirMs = AVISO_VIDRIO_REPETIR_MS }) {
  const decir = (aviso, texto) => {
    try { logWarn(aviso, texto); } catch { /* el log no puede romper la entrega de la propuesta */ }
  };
  const vistos = new Set();
  const etiquetas = [];
  for (const a of avisos || []) {
    const k = `${a.aviso}|${a.original}|${a.motor}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    decir(a.aviso, `${folio}: etiqueta "${a.original}" · vidrio del motor "${a.motor}"`);
    if (a.aviso === 'vidrio.bano_perdido' && !etiquetas.includes(a.original)) etiquetas.push(a.original);
  }
  if (!etiquetas.length) return;

  const kMarca = claveAviso('vidrio', folio);
  const kPanel = claveAviso('vidrio_panel', folio);
  const kVuelo = claveAviso('vidrio_en_vuelo', folio);
  const ttlSeg = Math.ceil(repetirMs / 1000);

  // La reserva va PRIMERO (atómica): corta la carrera entre dos llamadas del mismo folio. Si el almacén lanzara
  // (no lo hace), ante la duda se avisa igual: un aviso de más molesta, uno de menos deja un satén sin revisar.
  let token = null;
  let sinReserva = false;
  try { token = estado.reservar(kVuelo, RESERVA_EN_VUELO_SEG); } catch { sinReserva = true; }
  if (!token && !sinReserva) return;                       // ya hay un aviso de este folio en vuelo

  const escribirMarca = (via) => {
    try { estado.escribir(kMarca, { at: ahora(), via }, ttlSeg); } catch { /* solo se pierde el throttle */ }
  };

  // El evento en el panel: uno por folio, y la marca de «ya puesto» SOLO si quedó escrito de verdad (el puente
  // nunca lanza: devuelve {ok:false} o {ok:false, skipped:true} si la ingesta está apagada).
  const eventoAlPanel = async ({ dudoso, motivoTexto, motivoPlantilla }) => {
    let ultimo = null;
    try { ultimo = await estado.leer(kPanel); } catch { /* ante la duda, avisa */ }
    if (!tocaAvisar(ultimo?.at ?? null, ahora(), repetirMs)) return;
    const cuerpo = dudoso
      ? `⚠️ La propuesta ${folio} ${fraseBanoPerdido(etiquetas)}. El aviso a Marcelo quedó SIN CONFIRMAR (dudoso: pudo haber llegado, por eso no se reenvía). `
        + 'Mirá el chat de Marcelo y, si no lo ves, revisá el precio de esta propuesta a mano.'
      : `⚠️ La propuesta ${folio} ${fraseBanoPerdido(etiquetas)}, y el aviso a Marcelo NO salió (ni por texto ni por plantilla). `
        + 'Hay que revisar el precio de esta propuesta a mano.';
    const r = await intentar(() => canales.panel({
      body: cuerpo,
      metadata: {
        aviso_fallido: true, vidrio_bano_perdido: true, dudoso, folio, etiquetas,
        motivo_notify: motivoTexto, motivo_template: motivoPlantilla,
      },
    }));
    if (r && r.ok === true) {
      try { estado.escribir(kPanel, { at: ahora() }, ttlSeg); } catch { /* solo se pierde el throttle */ }
    }
  };

  try {
    // La marca durable cubre lo que la memoria no (un redeploy en medio del episodio) y las correcciones de IG
    // que reusan el folio. Si no se puede leer, se sigue: la reserva ya protege de la carrera.
    let ultimo = null;
    try { ultimo = await estado.leer(kMarca); } catch { /* ante la duda, avisa */ }
    if (!tocaAvisar(ultimo?.at ?? null, ahora(), repetirMs)) return;

    // Los dos canales SIEMPRE, en orden: nadie sabe si la ventana de 24 h del dueño está abierta.
    const texto = await intentar(() => canales.texto(textoBanoPerdido(folio, etiquetas)));
    const plantilla = await intentar(() => canales.plantilla({ folio, etiquetas }));
    const estadoTexto = estadoDelTexto(texto);
    const estadoPlantilla = estadoDeLaPlantilla(plantilla);
    const motivoTexto = motivoDeEnvio(texto);
    const motivoPlantilla = motivoDeEnvio(plantilla);

    if (estadoTexto === LLEGO || estadoPlantilla === LLEGO) {
      escribirMarca([estadoTexto === LLEGO && 'texto', estadoPlantilla === LLEGO && 'plantilla'].filter(Boolean).join('+'));
      // Como #888 (`escalate.canal_degradado`): el canal roto no queda invisible porque el otro salvó la situación.
      for (const [canal, estadoCanal, motivo] of [['texto', estadoTexto, motivoTexto], ['plantilla', estadoPlantilla, motivoPlantilla]]) {
        if (estadoCanal === FALLO) decir('vidrio.canal_degradado', `${folio}: aviso por satén entregado, pero el canal de ${canal} falló (${motivo}) — hay que mirarlo`);
      }
      return;
    }

    const dudoso = estadoTexto === DUDOSO || estadoPlantilla === DUDOSO;
    if (dudoso) {
      escribirMarca('dudoso');                              // pudo haber llegado: NO se reenvía
      decir('vidrio.aviso_dudoso', `${folio}: el aviso al dueño por el satén quedó SIN CONFIRMAR (texto: ${motivoTexto}; plantilla: ${motivoPlantilla}) — no se reenvía; mirar el chat y revisar el precio de esta propuesta a mano`);
    } else {
      decir('vidrio.aviso_no_salio', `${folio}: el aviso al dueño por el satén NO salió (texto: ${motivoTexto}; plantilla: ${motivoPlantilla}) — revisar el precio de esta propuesta a mano`);
    }
    await eventoAlPanel({ dudoso, motivoTexto, motivoPlantilla });
  } catch { /* la promesa de esta función NUNCA rechaza */ } finally {
    if (token) { try { estado.liberar(kVuelo, token); } catch { /* la reserva vence sola */ } }
  }
}
