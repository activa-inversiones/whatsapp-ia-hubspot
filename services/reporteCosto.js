// services/reporteCosto.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// [2026-08-20] EL COSTO DE OLIVER, DE LOS DOS CEREBROS Y SIN SILENCIOS.
//
// POR QUÉ SE REESCRIBE ESTO. El 28-jul se conectó reportarCosto() dentro de
// engine-anthropic.js para que Oliver dejara de ser invisible en
// `ai_cost_tracking`. Medido contra la BD viva el 19-ago, 3 semanas después:
// la tabla tiene 1.737 filas de `landing_v3` y CERO de Oliver. Dos causas,
// las dos reales:
//
//   1. SOLO REPORTABA ANTHROPIC. El camino de OpenAI (engine.js, openaiPass1 y
//      openaiPass2) descarta `r.usage` entero. Y GPT es el RESPALDO que entra
//      justo cuando se agotan los tokens de Anthropic — o sea el momento caro
//      es precisamente el que no se medía.
//   2. FALLABA EN SILENCIO ABSOLUTO. Sin SALES_OS_URL o sin
//      SALES_OS_INGEST_TOKEN, la función hacía return sin una línea de log
//      —a propósito, para no escribir ~75 veces al día— y sin nadie que
//      avisara. Un reporte que no llega y no se queja es indistinguible de uno
//      que funciona: por eso pasaron 3 semanas sin que nadie lo notara.
//
// CÓMO SE ARREGLA EL SILENCIO SIN LLENAR EL LOG: se avisa UNA VEZ por proceso
// (mismo patrón que logModelOnce en engine-anthropic.js) y se llevan contadores
// en memoria que estadoReporteCosto() expone para /health. Así el silencio se
// puede ver sin pagar un log por turno.
//
// 🔒 REGLA DURA QUE NO CAMBIA: esto NUNCA puede afectar la conversación con el
// cliente. Fire-and-forget, timeout corto, catch silencioso, sin await en el
// camino de la respuesta. Si Sales OS está caído, Oliver ni se entera.
//
// Módulo PURO con deps inyectables (igual que candadoSeguimiento.js /
// reengagement.js): se testea sin red y sin env vars.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

// [2026-08-20 · revisión cruzada de Copilot] Los nombres importan acá.
// `disparados` = veces que se llegó a llamar a fetch. `fallidos` es un SUBCONJUNTO de
// disparados (la llamada salió y después falló). Antes se llamaba `enviados`, y como el
// fallo asíncrono incrementa los dos, "enviados" mentía: una llamada que fracasó figuraba
// como enviada. Los contadores no son un ranking, son un desglose.
const contadores = { disparados: 0, sin_configurar: 0, sin_uso: 0, fallidos: 0 };
// [2026-08-20] DOS latches, no uno. El de `sin_configurar` no servía para el otro modo de
// falla: con las env vars puestas pero el token equivocado, la única rama que logueaba era
// inalcanzable y el fallo no dejaba NI UNA LÍNEA. Un contador que nadie mira y que se borra
// en cada deploy no es un detector.
let avisoDado = false;
let avisoFalloDado = false;
let ultimoMotivoFallo = null;

/** Cuenta el fallo y lo grita UNA vez por proceso, con el motivo real. */
function anotarFallo(motivo, log = console.error) {
  contadores.fallidos++;
  ultimoMotivoFallo = motivo;
  if (!avisoFalloDado) {
    avisoFalloDado = true;
    log(`[reporteCosto] el reporte de costo esta FALLANDO (${motivo}). El gasto de IA de Oliver NO se esta registrando. Se avisa una vez por proceso; el detalle vive en /health -> reporte_costo.`);
  }
}

/**
 * Estado para /health.
 *
 * ⚠️ `configurado` es de TRES estados, no dos (hallazgo de la revisión cruzada de Copilot,
 * 20-ago). Antes era `sin_configurar === 0 || enviados > 0`, que al arrancar el proceso
 * —con todos los contadores en 0— daba **true sin que se hubiera intentado nada**. O sea
 * /health decía "configurado" justo en el escenario que este módulo vino a destapar.
 *   null  = todavía no se intentó reportar (no se sabe)
 *   true  = se intentó y había URL + token
 *   false = se intentó y faltaba configuración → el gasto NO se está registrando
 */
export function estadoReporteCosto() {
  const intentos = contadores.disparados + contadores.sin_configurar;
  return {
    ...contadores,
    ok: contadores.disparados - contadores.fallidos,
    intentos,
    configurado: intentos === 0 ? null : contadores.sin_configurar === 0,
    // [2026-08-20] Sin el motivo, /health decia "algo falla" y no que. Con el token
    // equivocado hay que poder distinguir un 401 de un timeout SIN entrar a Railway.
    ultimo_fallo: ultimoMotivoFallo,
    sano: intentos > 0 && contadores.sin_configurar === 0 && contadores.fallidos === 0,
  };
}

/** Solo para tests: vuelve a cero. */
export function _resetReporteCosto() {
  contadores.disparados = 0; contadores.sin_configurar = 0; contadores.sin_uso = 0; contadores.fallidos = 0;
  avisoDado = false; avisoFalloDado = false; ultimoMotivoFallo = null;
}

/**
 * Normaliza el `usage` de cualquiera de los dos SDK a un solo shape.
 * Anthropic: input_tokens / output_tokens / cache_creation_input_tokens / cache_read_input_tokens
 * OpenAI:    prompt_tokens / completion_tokens / prompt_tokens_details.cached_tokens
 * @returns {{input:number,output:number,cacheWrite:number,cacheRead:number,total:number}|null}
 */
export function normalizarUso(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);

  // OpenAI cuenta los tokens cacheados DENTRO de prompt_tokens; Anthropic los cuenta
  // aparte. Se descuentan para que `input` signifique lo mismo en los dos y el precio
  // no se calcule dos veces sobre el mismo token.
  const cacheReadOpenAI = n(usage.prompt_tokens_details?.cached_tokens);
  const esOpenAI = usage.prompt_tokens !== undefined || usage.completion_tokens !== undefined;

  const cacheRead = esOpenAI ? cacheReadOpenAI : n(usage.cache_read_input_tokens);
  const cacheWrite = esOpenAI ? 0 : n(usage.cache_creation_input_tokens);
  const input = esOpenAI ? Math.max(0, n(usage.prompt_tokens) - cacheReadOpenAI) : n(usage.input_tokens);
  const output = esOpenAI ? n(usage.completion_tokens) : n(usage.output_tokens);

  const total = input + output + cacheWrite + cacheRead;
  return total === 0 ? null : { input, output, cacheWrite, cacheRead, total };
}

/**
 * Reporta el costo. NO devuelve promesa que haya que esperar: dispara y sigue.
 * @param {{modulo:string, modelo:string, usage:object, cacheTtl?:string}} datos
 * @param {{url:string, token:string, timeoutMs?:number, fetchFn?:Function, log?:Function}} cfg
 * @returns {'enviado'|'sin_configurar'|'sin_uso'|'fallido'}
 */
export function reportarCosto({ modulo, modelo, modeloApi, proveedor, usage, cacheTtl } = {}, cfg = {}) {
  const { url, token, timeoutMs = 2500, fetchFn = globalThis.fetch, log = console.warn } = cfg;

  const uso = normalizarUso(usage);
  if (!uso) { contadores.sin_uso++; return 'sin_uso'; }

  if (!url || !token) {
    contadores.sin_configurar++;
    // UNA vez por proceso. Antes esto era un return mudo y por eso nadie supo en 3 semanas.
    if (!avisoDado) {
      avisoDado = true;
      log('[reporteCosto] SALES_OS_URL o SALES_OS_INGEST_TOKEN sin definir: el costo de Oliver NO se esta registrando en ai_cost_tracking. Se avisa una sola vez por proceso; el contador vive en /health.');
    }
    return 'sin_configurar';
  }

  let timer = null;
  try {
    const ctrl = new AbortController();
    timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // [2026-08-20 · 2ª pasada de Copilot] Contar el intento ANTES de llamar a fetch.
    // Estaba después, así que si fetchFn tiraba sincrónicamente el catch sumaba `fallidos`
    // sin que `disparados` se hubiera sumado nunca: `ok = disparados - fallidos` daba -1.
    // Un contador negativo en /health no es un detalle estético: es la señal de salud
    // mintiendo justo cuando algo se rompió.
    contadores.disparados++;
    // Sin await a propósito: la respuesta al cliente no espera a la telemetría.
    Promise.resolve(fetchFn(`${String(url).replace(/\/+$/, '')}/api/ingest/ai-cost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': token, 'x-api-key': token },
      body: JSON.stringify({
        module: modulo,
        model: modelo || 'desconocido',
        // [2026-08-20] El proveedor viaja EXPLICITO. Sin esto el sales-os lo adivinaba y
        // guardaba engine='anthropic' para TODO, incluido el respaldo GPT: la tabla no podia
        // cortar por proveedor, que es justo la pregunta que el dueno quiere responder
        // ("cuanto me cuesta cada cerebro"). Ademas OpenAI cobra el cache read a 0,50x y
        // Anthropic a 0,10x: sin proveedor, el respaldo GPT se valoraba 5 veces mas barato.
        provider: proveedor || null,
        model_api: modeloApi || null,
        input_tokens: uso.input,
        output_tokens: uso.output,
        cache_creation_input_tokens: uso.cacheWrite,
        cache_read_input_tokens: uso.cacheRead,
        cache_ttl: cacheTtl || null,
        status: 'ok',
      }),
      signal: ctrl.signal,
    }))
      // 🔴 [2026-08-20] ACÁ EL MÓDULO REINSTALABA EL SILENCIO QUE VINO A MATAR.
      // Solo había `.catch()`, y **fetch NO rechaza ante un error HTTP**: un 401, un 404 o
      // un 500 RESUELVEN. Así que el catch no corría, `fallidos` quedaba en 0 y
      // `ok = disparados - fallidos` contaba todas como buenas.
      // REPRODUCIDO con fetch real contra un servidor real que devuelve 401: /health decía
      // `ok:20, fallidos:0, configurado:true` con CERO filas guardadas en ai_cost_tracking.
      // Eso es peor que el bug original: antes el silencio era ausencia de señal; así había
      // una señal afirmando activamente que todo funcionaba. Un verde falso engaña.
      // El escenario NO es exótico: SALES_OS_INGEST_TOKEN (bot) e INGEST_TOKEN (sales-os)
      // son dos nombres distintos en dos servicios de Railway, y ya hubo una rotación.
      .then((r) => {
        // El receptor devuelve HTTP 200 con {ok:false} a propósito cuando falla el INSERT
        // (temp-sales-os/src/server.js:1505). Mirar solo el status dejaría pasar eso.
        if (r && r.ok === false) { anotarFallo(`HTTP ${r.status}`); return; }
        if (r && typeof r.json === 'function') {
          return r.json().then((j) => { if (j && j.ok === false) anotarFallo(`receptor: ${j.error || 'ok:false'}`); })
            .catch(() => { /* body no-JSON con status 2xx: se da por bueno */ });
        }
      })
      .catch((e) => anotarFallo(e?.name === 'AbortError' ? 'timeout' : (e?.message || 'error de red')))
      .finally(() => clearTimeout(timer));
    return 'enviado';
  } catch {
    // Armar la llamada falló (fetchFn rompió, AbortController no existe, etc.). Es un FALLO,
    // no un "no había nada que reportar": devolver 'sin_uso' acá escondía el problema.
    // [2026-08-20 · Copilot] Limpiar el timer también acá: si fetchFn tira sincrónicamente,
    // el `.finally` nunca corre y quedaba un setTimeout huérfano por cada fallo, que 2,5 s
    // después aborta un controller ya muerto. Inofensivo pero es basura acumulándose en un
    // proceso que vive semanas.
    if (timer) clearTimeout(timer);
    anotarFallo('fallo al armar la llamada');
    return 'fallido';
  }
}

export default { reportarCosto, normalizarUso, estadoReporteCosto, _resetReporteCosto, VERSION };
