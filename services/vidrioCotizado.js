// vidrioCotizado.js — [2026-10-05] EL VIDRIO LO DECIDE EL MOTOR, como el precio y el Uw.
//
// `enginePricer.js` elige el vidrio de cada ventana (`pickGlassId`, por area y ambiente) y con
// ESE vidrio cobra y calcula el Uw. Una sola regla para WhatsApp (webhook.js) e IG/FB
// (channel-agent.js), y para las opciones A, B y C. Caso que la origino: propuesta 0588.
// Ramas probadas en vidrioCotizado.test.js; el aviso al dueño (`avisarVidrio`), en avisarVidrio.test.js.
// [r8] Sin estado propio: el almacén de «ya avisado» lo inyecta el llamador (como `deps.leerEstado`).

import { createHash } from 'node:crypto';
import { vidrioDesdeEtiqueta } from './vientosThermal.js';
import { dicePalabraSaten, esAmbienteBano, sinTildes } from './vidrioSatinado.js';
import { claveAviso, tocaAvisar } from './avisoEntregaDudosa.js';  // [r8] el molde de deduplicación del repo (módulo puro)
import { FOLIO_REUSO_MS } from './folioReuso.js';

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
 * Para las recotizaciones que se hacen al emitir el documento con los datos del PDF (el bloque del Uw de
 * webhook.js y la sonda de IG/FB cuando el cliente nombró un solo color, en channel-agent.js): ¿el precio que
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
 * Quien decide que un aviso no se repita es la marca de `avisarVidrio` (por folio y vidrio). El cooldown
 * de highValueNotifier (clave: telefono + motivo) es el respaldo en el reintento de un aviso que no llegó,
 * y solo funciona si mismo folio + mismas etiquetas ⇒ mismo texto: no cambiar el texto entre llamadas.
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
 * Cuánto vale un «ya le avisé al dueño de este vidrio en este folio»: lo que vive un folio REUSADO (FOLIO_REUSO_MS, 48 h:
 * una corrección del cliente es una revisión del mismo folio) más 24 h de margen, para que una corrección a las 47 h no
 * coincida con el vencimiento de la marca (relojes del KV y del bot, un redeploy a mitad de episodio) = 72 h.
 * La marca vive más que el folio POR CONSTRUCCIÓN: los dos canales usan la misma `FOLIO_REUSO_MS`.
 * Es mayor que el cooldown de 2 h del notificador (la marca manda: se consulta ANTES de llamarlo) y menor que el tope
 * de 30 días con que /internal/kv corta el TTL.
 * ⚠️ La ventana del folio se RENUEVA con cada revisión (`last_quote.at`), así que un folio corregido cada día puede
 * vivir más de 72 h; en ese caso la marca vence y el dueño recibe UN recordatorio más. Es deliberado: un problema de
 * precio que sigue vivo a los 3 días merece que alguien lo mire otra vez.
 */
export const AVISO_VIDRIO_REPETIR_MS = FOLIO_REUSO_MS + 24 * 3600_000;
/** Cuánto vive la reserva «en vuelo» si nadie la suelta (el proceso muere a mitad del envío). */
const RESERVA_EN_VUELO_SEG = 120;

/**
 * Una etiqueta COMPARABLE: sin tildes, en minúsculas y con los espacios colapsados. «4+12+4 Satén (baño)» y
 * «4+12+4  saten (bano)» son la misma. La escribe un LLM: no se le puede exigir que repita la frase al milímetro.
 */
export const normalizarEtiqueta = (etiqueta) => _plano(etiqueta).replace(/\s+/g, ' ').trim();

/**
 * [#1089] QUÉ VIDRIO ES esta etiqueta, para decidir si ya se avisó de él: la identidad sale del SENTIDO, no del texto.
 * Un LLM que corrige no repite la frase: «4+12+4 satén (baño)», «4+12+4 satinado», «Satén baño» y «Termopanel satén» son el
 * mismo satén (la definición de «satén» es la de siempre, vidrioSatinado.js: la misma que dibuja el PDF). Entonces:
 *  · satén (`esBano`) ⇒ `satinado-<ext>x<cámara>x<int>`, con los espesores de la etiqueta (`vidrioDesdeEtiqueta`) o, si no
 *    los trae, los del vidrio con que cotizó el motor: «Satén baño» cotizado como 4+12+4 es el satén 4+12+4.
 *    Si no hay espesor en ninguno de los dos, `satinado` a secas.
 *  · cualquier otra cosa (hoy no pasa por acá) ⇒ `otro-<huella del texto normalizado>`, para no confundirla con un satén.
 * Un espesor distinto es otro vidrio, y otra clave.
 */
export function identidadDeVidrio(etiqueta, vidrioMotor) {
  if (!esBano(etiqueta)) return `otro-${createHash('sha1').update(normalizarEtiqueta(etiqueta)).digest('hex').slice(0, 12)}`;
  const v = vidrioDesdeEtiqueta(etiqueta) || vidrioDesdeEtiqueta(vidrioMotor);
  return v ? `satinado-${v.ext_mm}x${v.camara_mm}x${v.int_mm}` : 'satinado';
}

const claveDeIdentidad = (tipo, folio, identidad) => claveAviso(tipo, `${folio || 'sin_folio'}:${identidad}`);

/**
 * [#1089] La clave de un aviso de ESTE folio y ESTE vidrio (`identidadDeVidrio`). `tipo` separa la marca durable
 * ('vidrio') de la reserva en vuelo ('vidrio_en_vuelo') y del evento del panel ('vidrio_panel'): claves DISTINTAS
 * (ver la nota de `avisarVidrio`).
 */
export const claveAvisoVidrio = (tipo, folio, etiqueta, vidrioMotor) =>
  claveDeIdentidad(tipo, folio, identidadDeVidrio(etiqueta, vidrioMotor));

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
 * ── TEXTO Y PLANTILLA, SIEMPRE, UNA VEZ POR FOLIO Y VIDRIO (igual que la escalación #888, en webhook.js) ──
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
 * ── DEDUPLICACIÓN: el molde del repo (avisarEntregaDudosa / avisarCerebroDeRespaldo, en webhook.js) ──
 * `estado` = {reservar, liberar, leer, escribir}, lo inyecta el llamador (este módulo no guarda estado).
 * `reservar` es atómico en memoria y va PRIMERO: dos llamadas casi simultáneas del mismo folio mandaban dos
 * plantillas porque la marca se fijaba después del await. `leer`/`escribir` son el KV durable (sobrevive al
 * redeploy) y `tocaAvisar(ultimo.at, ahora, repetirMs)` decide. La marca se escribe SOLO si el aviso llegó o es dudoso.
 * ⚠️ Se desvía del molde en UNA cosa, a propósito: la reserva y la marca viven en CLAVES DISTINTAS. El molde usa
 * una sola, y `estadoPersistente.reservar()` hace `escribir(clave, token)` (memoria + PUT a Postgres): tras un
 * redeploy ese PUT PISA la marca durable y el `leer()` siguiente pega en la memoria (el token) ⇒ el «sobrevive
 * al redeploy» no existe. Con dos claves, `leer(marca)` sí llega a Postgres.
 * [#1089] La unidad de la deduplicación es el VIDRIO DE ESTE FOLIO (`identidadDeVidrio`), no el folio ni el texto de la
 * etiqueta: las tres claves (reserva, marca, evento del panel) salen de ahí. Una corrección del cliente en IG reusa el
 * folio; si trae un vidrio NUEVO se avisa (solo de ese: los ya avisados no se repiten), y el mismo satén con otras
 * palabras, otro orden, otras mayúsculas o sin tildes no es novedad. Las etiquetas de un mismo vidrio que llegan juntas
 * se listan juntas en UN aviso. La reserva también es por vidrio, para que una llamada que ya tiene un satén en vuelo
 * no deje mudo al satén nuevo de otra llamada del mismo folio.
 * La marca vive `AVISO_VIDRIO_REPETIR_MS` (72 h, ver su porqué); el cooldown de 2 h de highValueNotifier es solo el respaldo.
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
  const grupos = new Map();                                // identidad del vidrio → { id, etiquetas: [textos distintos] }
  for (const a of avisos || []) {
    const k = `${a.aviso}|${a.original}|${a.motor}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    decir(a.aviso, `${folio}: etiqueta "${a.original}" · vidrio del motor "${a.motor}"`);
    if (a.aviso !== 'vidrio.bano_perdido') continue;
    const id = identidadDeVidrio(a.original, a.motor);
    const g = grupos.get(id) || { id, etiquetas: [] };
    if (!g.etiquetas.some((x) => normalizarEtiqueta(x) === normalizarEtiqueta(a.original))) g.etiquetas.push(a.original);
    grupos.set(id, g);
  }
  if (!grupos.size) return;

  // Tres claves por vidrio de ESTE folio, y distintas entre sí (ver la nota de claves de arriba).
  const kMarca = (g) => claveDeIdentidad('vidrio', folio, g.id);
  const kPanel = (g) => claveDeIdentidad('vidrio_panel', folio, g.id);
  const kVuelo = (g) => claveDeIdentidad('vidrio_en_vuelo', folio, g.id);
  const ttlSeg = Math.ceil(repetirMs / 1000);
  /** Las etiquetas de varios grupos, sin textos repetidos, para decírselas al dueño. */
  const etiquetasDe = (lista) => [...new Set(lista.flatMap((g) => g.etiquetas))];

  // La reserva va PRIMERO (atómica) y es POR VIDRIO: corta la carrera entre dos llamadas del mismo folio sin dejar
  // mudo a un satén nuevo porque otro estaba en vuelo. Si el almacén lanzara (no lo hace), ante la duda se avisa
  // igual: un aviso de más molesta, uno de menos deja un satén sin revisar.
  const reservas = [];                                     // [{ g, token }] — token null = el almacén lanzó
  for (const g of grupos.values()) {
    try {
      const token = estado.reservar(kVuelo(g), RESERVA_EN_VUELO_SEG);
      if (token) reservas.push({ g, token });              // la tomé; si no, ya hay un aviso de este vidrio en vuelo
    } catch { reservas.push({ g, token: null }); }
  }
  if (!reservas.length) return;                            // todos tienen ya un aviso en vuelo

  /** De `lista`, los vidrios SIN marca vigente bajo `clave`. Si no se puede leer una marca, ese vidrio se avisa. */
  const sinMarcaVigente = async (clave, lista) => {
    const marcas = await Promise.all(lista.map(async (g) => {
      try { return await estado.leer(clave(g)); } catch { return null; }   // ante la duda, avisa
    }));
    return lista.filter((_, i) => tocaAvisar(marcas[i]?.at ?? null, ahora(), repetirMs));
  };
  /** Deja la marca de cada vidrio de `lista` (con sus etiquetas adentro: la clave solo trae la identidad). */
  const marcar = (clave, lista, extra = {}) => {
    for (const g of lista) {
      try { estado.escribir(clave(g), { at: ahora(), ...extra, etiquetas: g.etiquetas }, ttlSeg); } catch { /* solo se pierde el throttle */ }
    }
  };

  // El evento en el panel: uno por folio y vidrio, y la marca de «ya puesto» SOLO si quedó escrito de verdad (el
  // puente nunca lanza: devuelve {ok:false} o {ok:false, skipped:true} si la ingesta está apagada).
  const eventoAlPanel = async (nuevas, { dudoso, motivoTexto, motivoPlantilla }) => {
    const sinEvento = await sinMarcaVigente(kPanel, nuevas);
    if (!sinEvento.length) return;
    const etiquetas = etiquetasDe(sinEvento);
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
    if (r && r.ok === true) marcar(kPanel, sinEvento);
  };

  try {
    // La marca durable cubre lo que la memoria no (un redeploy en medio del episodio) y las correcciones de IG
    // que reusan el folio. Si no se puede leer, se sigue: la reserva ya protege de la carrera. Solo se avisa de los
    // vidrios que NO tienen marca vigente: una corrección con un satén nuevo avisa del nuevo, no repite el viejo.
    const nuevas = await sinMarcaVigente(kMarca, reservas.map((r) => r.g));
    if (!nuevas.length) return;
    const etiquetas = etiquetasDe(nuevas);

    // Los dos canales SIEMPRE, en orden: nadie sabe si la ventana de 24 h del dueño está abierta.
    const texto = await intentar(() => canales.texto(textoBanoPerdido(folio, etiquetas)));
    const plantilla = await intentar(() => canales.plantilla({ folio, etiquetas }));
    const estadoTexto = estadoDelTexto(texto);
    const estadoPlantilla = estadoDeLaPlantilla(plantilla);
    const motivoTexto = motivoDeEnvio(texto);
    const motivoPlantilla = motivoDeEnvio(plantilla);

    if (estadoTexto === LLEGO || estadoPlantilla === LLEGO) {
      marcar(kMarca, nuevas, { via: [estadoTexto === LLEGO && 'texto', estadoPlantilla === LLEGO && 'plantilla'].filter(Boolean).join('+') });
      // Como #888 (`escalate.canal_degradado`): el canal roto no queda invisible porque el otro salvó la situación.
      for (const [canal, estadoCanal, motivo] of [['texto', estadoTexto, motivoTexto], ['plantilla', estadoPlantilla, motivoPlantilla]]) {
        if (estadoCanal === FALLO) decir('vidrio.canal_degradado', `${folio}: aviso por satén entregado, pero el canal de ${canal} falló (${motivo}) — hay que mirarlo`);
      }
      return;
    }

    const dudoso = estadoTexto === DUDOSO || estadoPlantilla === DUDOSO;
    if (dudoso) {
      marcar(kMarca, nuevas, { via: 'dudoso' });            // pudo haber llegado: NO se reenvía
      decir('vidrio.aviso_dudoso', `${folio}: el aviso al dueño por el satén quedó SIN CONFIRMAR (texto: ${motivoTexto}; plantilla: ${motivoPlantilla}) — no se reenvía; mirar el chat y revisar el precio de esta propuesta a mano`);
    } else {
      decir('vidrio.aviso_no_salio', `${folio}: el aviso al dueño por el satén NO salió (texto: ${motivoTexto}; plantilla: ${motivoPlantilla}) — revisar el precio de esta propuesta a mano`);
    }
    await eventoAlPanel(nuevas, { dudoso, motivoTexto, motivoPlantilla });
  } catch { /* la promesa de esta función NUNCA rechaza */ } finally {
    for (const { g, token } of reservas) {
      if (token) { try { estado.liberar(kVuelo(g), token); } catch { /* la reserva vence sola */ } }
    }
  }
}
