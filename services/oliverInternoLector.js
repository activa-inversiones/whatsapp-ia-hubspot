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
export async function leerYCotizar({ texto, comuna = '', color = '', nombre = '', deps = {} } = {}) {
  const handleTurn = deps.handleTurn || handleTurnReal;
  const engine = deps.engine || { ...engineReal, orchestratorPass2: async () => '' };
  const exec = soloCotizar(deps.runTool || runToolReal);

  const lockedData = {};
  if (comuna) lockedData.comuna = comuna;
  if (color) lockedData.color = color;
  const state = { ...lockedData, lockedData };
  if (nombre) { state.nombre = nombre; state.name = nombre; }

  const turn = await handleTurn({
    history: [],
    userText: String(texto || ''),
    state,
    toolCtx: { textoCliente: String(texto || ''), runTool: exec, engine },
  });

  const lineas = (turn.toolCalls || [])
    .filter((c) => HERRAMIENTAS_DE_PRECIO.includes(c.name))
    .map((c, i) => ({ n: i + 1, herramienta: c.name, pedido: c.input, resultado: c.result }));

  const base = { lineas, bloqueadas: exec.bloqueadas, sospechosas: exec.sospechosas, respuesta: String(turn.reply || '') };
  if (!lineas.length) return { ok: false, error: 'oliver_no_cotizo', ...base };
  return { ok: true, ...base };
}

export default { leerYCotizar, soloCotizar, HERRAMIENTAS_DE_PRECIO, TOPE_CANTIDAD_TEXTO_LIBRE };
