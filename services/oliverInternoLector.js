// [2026-10-12 · #1500-A] EL LECTOR DEL OLIVER INTERNO ES EL CEREBRO DEL BOT, NO OTRO PARSER.
//
// 🔴 POR QUÉ EXISTE — HECHO DEL NEGOCIO (dueño, 12-oct 02:58, textual): *«definimos que sea el
// mismo Oliver porque el vendedor y yo no podemos cotizar en este; lo agregamos solo para que
// quede documentado en el mismo chat del cliente y no en otro, que teníamos los problemas de que
// hacíamos cotizaciones que se perdían o sumaban y agregaban valores a nuestras estadísticas»*.
//
// MEDIDO el 12-oct 02:53: la frase «1 bow window 2500x1500x500 mm, laterales mitad proyectante
// arriba y mitad fija abajo, unión a 90 grados, vidrio 5+12+5, color nogal» el bot la arma como
// 1 × bow de 3 paños; el piloto del interno (parser `itemsDesdeTexto` de sales-os, pensado para
// «corredera 1200x1000, 2 unidades») leyó el «500» de los laterales como CANTIDAD y retuvo un
// borrador de $266.257.355. Dos lectores = dos resultados. Acá queda UNO: `handleTurn` (el LLM
// con la herramienta `calcular_cotizacion`) + `priceAllEngine`, los mismos del WhatsApp.
//
// Lo que cambia respecto del chat: (1) solo corren las herramientas de PRECIO — nada se guarda,
// nada se envía, ninguna tool del puente MCP —; (2) una cantidad > 50 leída de texto libre NO se
// cotiza (fail-closed: es el guardia del caso de los $266M); (3) la segunda pasada del LLM (la
// respuesta conversacional) no se pide cuando el motor es el real: acá nadie la lee.
import { handleTurn as handleTurnReal } from '../src/oliver-gpt/agent.js';
import { runTool as runToolReal } from '../src/oliver-gpt/tools.js';
import * as engineReal from '../src/oliver-gpt/engine.js';

export const HERRAMIENTAS_DE_PRECIO = Object.freeze(['calcular_cotizacion', 'calcular_por_area']);
export const TOPE_CANTIDAD_TEXTO_LIBRE = 50;

/**
 * Envuelve al ejecutor de herramientas del bot: deja pasar SOLO las de precio y frena cualquier
 * cantidad implausible. Función pura (no toca red): lo que rechaza queda en `exec.bloqueadas` /
 * `exec.sospechosas` para que el canal interno se lo muestre al vendedor.
 */
export function soloCotizar(runTool) {
  const bloqueadas = [];
  const sospechosas = [];
  let n = 0;
  const exec = async (name, input = {}, ctx = {}) => {
    if (!HERRAMIENTAS_DE_PRECIO.includes(name)) {
      bloqueadas.push(name);
      return { ok: false, error: `herramienta '${name}' no disponible en el canal interno` };
    }
    n += 1;
    const cantidad = Number(input && input.cantidad);
    if (Number.isFinite(cantidad) && cantidad > TOPE_CANTIDAD_TEXTO_LIBRE) {
      sospechosas.push({ n, cantidad });
      return {
        ok: false,
        cantidad_sospechosa: cantidad,
        error: `cantidad ${cantidad} leída de texto libre supera ${TOPE_CANTIDAD_TEXTO_LIBRE}: no se cotiza hasta confirmarla`,
      };
    }
    return runTool(name, input, ctx);
  };
  exec.bloqueadas = bloqueadas;
  exec.sospechosas = sospechosas;
  return exec;
}

/**
 * Lee un texto del vendedor con el cerebro del bot y devuelve las líneas que Oliver cotizó.
 *
 * @returns {Promise<{ok:boolean, lineas:Array<{n:number, herramienta:string, pedido:object, resultado:object}>,
 *   bloqueadas:string[], sospechosas:Array<{n:number,cantidad:number}>, respuesta:string, error?:string}>}
 */
/**
 * [r4 · Thermos DEFECTO 1] El motor SIN segunda pasada. La respuesta conversacional cuesta una llamada al LLM que
 * acá nadie lee… salvo cuando Oliver PREGUNTA en vez de cotizar: esa pregunta viene en el `content` de la primera
 * pasada (handleTurn la empuja a `messages` como assistant pero solo devuelve lo de pass2). Este stub devuelve el
 * último content del assistant sin llamar al LLM: la pantalla muestra qué pidió Oliver, y no cuesta una pasada.
 */
export function motorSinPass2(engine) {
  return {
    ...engine,
    async orchestratorPass2({ messages = [] } = {}) {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const m = messages[i];
        if (m && m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) return m.content.trim();
      }
      return '';
    },
  };
}

/** Lo que el handler colgó NO enumerable (`_interno`, ver tools.js conBolsaInterna) se expone como `interno`. */
function resultadoConInterno(result) {
  if (!result || typeof result !== 'object') return result;
  const bolsa = Object.getOwnPropertyDescriptor(result, '_interno');
  return bolsa && bolsa.value ? { ...result, interno: bolsa.value } : { ...result };
}

export async function leerYCotizar({ texto, comuna = '', color = '', nombre = '', deps = {} } = {}) {
  const handleTurn = deps.handleTurn || handleTurnReal;
  const engine = deps.engine || motorSinPass2(engineReal);
  const exec = soloCotizar(deps.runTool || runToolReal);

  const lockedData = {};
  if (comuna) lockedData.comuna = comuna;
  if (color) lockedData.color = color;
  // [r4 · Thermos] MODO INTERNO: le escribe un vendedor del equipo (services/internosEquipo.js). Sin esto el prompt
  // trata al vendedor como cliente frío (reglas de calificación: segmento, presupuesto) y pregunta en vez de cotizar.
  const state = { ...lockedData, lockedData, modo_interno: true };
  if (nombre) { state.nombre = nombre; state.name = nombre; }

  const turn = await handleTurn({
    history: [],
    userText: String(texto || ''),
    state,
    // [#1522] orientacionConfiable: el vendedor escribe ancho × alto; no se aplica la regla de WhatsApp que
    // gira la lista cuando hay un alto > 2400 (giraba un fijo 400×2500 a 2500×400).
    toolCtx: { textoCliente: String(texto || ''), runTool: exec, engine, orientacionConfiable: true },
  });

  // [r5 · Codex r2 NO APTO] NADA SE DESCARTA. En r4 se fusionaban las llamadas idénticas (sugerencia de Thermos:
  // «el LLM repite la línea tras una tool bloqueada»), pero dos llamadas iguales con cantidad 1 pueden ser DOS
  // ventanas reales y sales-os retenía la mitad del total. La clave no distingue «reintento» de «segunda unidad»:
  // ante la duda, todas las líneas van al borrador (el vendedor las ve) y solo se cuenta la repetición para avisar.
  // 🔴 [#1522 · 14-oct] PERO UN REINTENTO SÍ SE PUEDE DISTINGUIR: POR EL TOTAL DE UNIDADES DE LA NOTA.
  // Medido en el borrador 70a138c1: 15 renglones (32 unidades) y 18 llamadas (36 unidades): la corredera
  // 2560×2390 tres veces y el fijo 2500×400 dos, agregadas al final.
  // [Codex post-despliegue · P0] La 1ª versión comparaba la DESCRIPCIÓN que escribe el LLM contra los renglones,
  // y eso falla: si el LLM normaliza «Ventana fija S60 1000x1000» y «Fijo S60 1000x1000» al mismo texto, borraba
  // una ventana REAL (subcobro del 50 %). Regla nueva, que no lee textos del LLM:
  //   · se suman las unidades de la NOTA (renglones con medida; «N ×» al inicio, si no 1);
  //   · solo si las llamadas suman MÁS que la nota, se descartan llamadas IDÉNTICAS a una anterior (mismo
  //     pedido exacto), desde la última, y solo mientras el total no baje de la nota.
  // Nunca puede quedar por debajo de lo que pidió el vendedor. Si la nota no tiene medidas legibles, no se toca.
  const RE_RENGLON_MEDIDA = /\d{2,5}(?:[.,]\d+)?\s*(?:mm|cm)?\s*[x×X*]\s*\d{2,5}/;
  // SOLO EN FORMATO DE LISTA: cada renglón con medida empieza con «N ×». En texto libre («necesito 2 ventanas
  // 1000x1000») la cantidad no se puede leer con seguridad, y dos llamadas iguales pueden ser dos ventanas reales
  // (guardia #1500-A r5): ahí no se descarta nada.
  const conMedida = String(texto || '').split(/\r?\n/).filter((r) => RE_RENGLON_MEDIDA.test(r));
  const RE_CANT = /^\s*(\d{1,3})\s*[x×X*]\s/;
  const esLista = conMedida.length > 0 && conMedida.every((r) => RE_CANT.test(r));
  const unidadesNota = esLista ? conMedida.reduce((s, r) => s + Number(r.match(RE_CANT)[1]), 0) : 0;
  const llamadas = (turn.toolCalls || []).filter((c) => HERRAMIENTAS_DE_PRECIO.includes(c.name));
  const unidades = (c) => Math.max(1, Number(c?.input?.cantidad) || 1);
  const claveDe = (c) => `${c.name}|${JSON.stringify(c.input || {})}`;
  let exceso = unidadesNota > 0 ? llamadas.reduce((s, c) => s + unidades(c), 0) - unidadesNota : 0;
  const sobran = new Set();
  for (let i = llamadas.length - 1; i > 0 && exceso > 0; i -= 1) {
    const k = claveDe(llamadas[i]);
    const hayAnterior = llamadas.slice(0, i).some((c, j) => !sobran.has(j) && claveDe(c) === k);
    if (hayAnterior && unidades(llamadas[i]) <= exceso) { sobran.add(i); exceso -= unidades(llamadas[i]); }
  }

  const vistos = new Set();
  let repetidas = 0;
  const lineas = [];
  llamadas.forEach((c, i) => {
    if (sobran.has(i)) return;
    const clave = claveDe(c);
    if (vistos.has(clave)) repetidas += 1; else vistos.add(clave);
    lineas.push({ n: lineas.length + 1, herramienta: c.name, pedido: c.input, resultado: resultadoConInterno(c.result) });
  });
  const base = { lineas, repetidas, reintentos_descartados: sobran.size, bloqueadas: exec.bloqueadas, sospechosas: exec.sospechosas, respuesta: String(turn.reply || '') };
  if (!lineas.length) return { ok: false, error: 'oliver_no_cotizo', ...base };
  return { ok: true, ...base };
}

export const RUTA_LECTOR = '/internal/oliver-interno/leer';
/** Mismo tope que el cuadro de sales-os (20.000): una lista larga pegada no se rechaza entera [Codex r1]. */
export const TOPE_TEXTO = 20000;

/**
 * [r3 · Thermos] La ruta vive acá, no en index.js (6.800 líneas). index.js solo la registra:
 * `registrarRutaLector(app, { validInternalOperatorToken })`. Auth: el mismo token interno que operator-send.
 * `leer` y `json` se inyectan para los tests.
 */
export function registrarRutaLector(app, { validInternalOperatorToken, leer = leerYCotizar, json = null } = {}) {
  if (typeof validInternalOperatorToken !== 'function') throw new Error('registrarRutaLector: falta validInternalOperatorToken');
  const handler = async (req, res) => {
    try {
      if (!validInternalOperatorToken(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
      const texto = String((req.body && req.body.texto) || '').trim();
      if (!texto) return res.status(400).json({ ok: false, error: 'texto_requerido' });
      if (texto.length > TOPE_TEXTO) return res.status(400).json({ ok: false, error: 'texto_demasiado_largo', tope: TOPE_TEXTO });
      // [r4 · Thermos] Tope por campo: entran crudos al contexto del LLM (system-prompt), no son texto libre.
      const campo = (k) => String((req.body && req.body[k]) || '').trim().slice(0, 80);
      const out = await leer({ texto, comuna: campo('comuna'), color: campo('color'), nombre: campo('nombre') });
      return res.json(out);
    } catch (e) {
      console.error('[oliver-interno/leer] error:', e && e.message ? e.message : e);
      return res.status(500).json({ ok: false, error: 'lector_fallo', detalle: String(e && e.message ? e.message : e).slice(0, 200) });
    }
  };
  if (json) app.post(RUTA_LECTOR, json, handler); else app.post(RUTA_LECTOR, handler);
}

export default { leerYCotizar, soloCotizar, registrarRutaLector, HERRAMIENTAS_DE_PRECIO, TOPE_CANTIDAD_TEXTO_LIBRE, RUTA_LECTOR, TOPE_TEXTO };
