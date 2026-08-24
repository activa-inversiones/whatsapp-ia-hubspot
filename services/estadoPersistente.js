// estadoPersistente.js — estado del bot que SOBREVIVE a un redeploy. ESM, sin deps.
//
// [2026-08-08] Por qué existe:
// Pregunta del dueño: *"¿solucionaste el tema de cuando deployamos algo se pierde
// información?"*. Las conversaciones ya sobrevivían (session-store.js → Postgres), pero
// había tres cosas en memoria del proceso que Railway borra en cada deploy, y cada una
// tiene consecuencia sobre un cliente de verdad:
//
//   1. La marca "cargado a mano y nunca nos escribió" (comando CLIENTE). Al perderse, el
//      re-enganche podía mandarle una plantilla a alguien que NO consintió que le
//      escribiéramos — problema legal (Ley 21.719) y de calificación con Meta.
//   2. El candado de 24 h del re-enganche. Al perderse, el mismo cliente podía recibir dos
//      mensajes seguidos.
//   3. El dedupe de mensajes. Al perderse, un reintento de Meta generaba respuesta duplicada.
//
// DISEÑO: memoria primero, Postgres detrás.
//   · Leer y escribir van a un Map local: el turno NUNCA espera a la red.
//   · La escritura a Postgres es fire-and-forget.
//   · La lectura solo va a Postgres si el dato NO está en memoria — o sea, básicamente
//     después de un reinicio, que es justo el caso que esto viene a cubrir.
//   · Si sales-os no responde, se degrada al comportamiento anterior (memoria sola). Nunca
//     rompe un turno: perder una marca es malo, pero dejar a un cliente sin respuesta es peor.
//
// No crea tabla nueva: usa `simple_cache` de la plataforma vía /internal/kv (§14b·bis).

const SALES_OS_URL = process.env.SALES_OS_URL || '';
const TOKEN =
  process.env.SALES_OS_OPERATOR_TOKEN ||
  process.env.INTERNAL_OPERATOR_TOKEN ||
  '';
const TIMEOUT_MS = Number(process.env.ESTADO_PERSISTENTE_TIMEOUT_MS || 2500);

export const PERSISTENCIA_ACTIVA = !!(SALES_OS_URL && TOKEN);

const MEMORIA = new Map(); // clave -> { valor, expira }
let SEQ = 0;               // parte del token de dueño de `reservar` (ver mas abajo)

const vigente = (e) => e && (!e.expira || e.expira > Date.now());

async function pedir(metodo, clave, cuerpo) {
  if (!PERSISTENCIA_ACTIVA) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    const r = await fetch(`${SALES_OS_URL}/internal/kv/${encodeURIComponent(clave)}`, {
      method: metodo,
      headers: { 'x-api-key': TOKEN, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch {
    return null; // sales-os caído / timeout → se sigue con la memoria local
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lee. Primero memoria; si no está, va a Postgres y cachea lo que encuentre.
 * @returns {Promise<any|null>}
 */
export async function leer(clave) {
  const e = MEMORIA.get(clave);
  if (vigente(e)) return e.valor;
  if (e) MEMORIA.delete(clave);
  const j = await pedir('GET', clave);
  const valor = j && Object.prototype.hasOwnProperty.call(j, 'valor') ? j.valor : null;
  // 🔴 [2026-08-24 · Codex, 3a compuerta] SE RE-CHEQUEA LA MEMORIA DESPUES DEL AWAIT.
  // El GET tarda, y mientras viaja otra ejecucion pudo escribir. Al volver, esto cacheaba
  // la respuesta encima sin mirar: A fusionaba [VIEJA, A], llegaba el GET atrasado con
  // [VIEJA] y lo pisaba, y B terminaba guardando [VIEJA, B]. La ventana de A desaparecia
  // sin ningun error — un informe con una ventana menos y nadie enterado.
  //
  // Lo que hay en memoria es siempre MAS NUEVO que una respuesta que venia en camino: se
  // devuelve eso y no se toca el cache.
  const yaEnMemoria = MEMORIA.get(clave);
  if (vigente(yaEnMemoria)) return yaEnMemoria.valor;
  if (valor !== null && valor !== undefined) MEMORIA.set(clave, { valor, expira: null });
  return valor ?? null;
}

/** Lee SOLO memoria — para caminos calientes donde no se puede pagar una ida a la red. */
export function leerLocal(clave) {
  const e = MEMORIA.get(clave);
  if (!vigente(e)) { if (e) MEMORIA.delete(clave); return null; }
  return e.valor;
}

/**
 * Escribe: memoria al instante, Postgres en segundo plano.
 * @param {number} ttlSegundos  vida del dato. Tope de 30 días del lado del servidor.
 */
export function escribir(clave, valor, ttlSegundos = 3600) {
  MEMORIA.set(clave, { valor, expira: Date.now() + ttlSegundos * 1000 });
  // Fire-and-forget a propósito: el turno del cliente no espera a la base.
  pedir('PUT', clave, { valor, ttl_segundos: ttlSegundos }).catch(() => {});
  return valor;
}

/**
 * TEST-AND-SET ATOMICO. Devuelve true si la reserva se otorga, false si ya estaba tomada.
 *
 * 🔴 [2026-08-24] Existe por un duplicado MEDIDO: los dos clientes del 24-ago recibieron
 * su informe termico DOS veces (folios 0001/0002 y 0003/0004), separados por 90 y 310 ms.
 * El candado de entonces hacia `await leer(clave)` y despues `await escribir(clave)`, y
 * cada `await` cede el event loop: dos `calcular_cotizacion` del mismo turno —una por
 * ventana del proyecto— leian \libre\ antes de que ninguna marcara, y las dos mandaban.
 *
 * La garantia es simple y depende de UNA regla: ACA ADENTRO NO PUEDE HABER UN `await`.
 * Node corre un solo hilo, asi que sin puntos de suspension nadie se cuela entre el
 * chequeo y la marca. Si alguien agrega un await aca, el candado deja de existir en
 * silencio — por eso esto es una funcion aparte y no un patron repetido en cada llamador.
 *
 * Alcance honesto: la atomicidad es POR PROCESO (el Map local). Cubre exactamente el caso
 * que produjo el defecto —concurrencia dentro del mismo turno— y no pretende ser un lock
 * distribuido. Contra reinicios y repeticiones a lo largo del tiempo sigue mandando el
 * candado largo de 30 dias, que vive en Postgres.
 *
 * Devuelve el TOKEN DEL DUEÑO (string) si la reserva se otorga, o `null` si ya esta tomada.
 * El token no es decorativo: sin el, `liberarReserva` no puede distinguir "suelto la mia"
 * de "borro la de otro" — ver el comentario de esa funcion.
 *
 * @param {number} ttlSegundos  cuanto dura la reserva si nadie la libera.
 */
export function reservar(clave, ttlSegundos = 300) {
  const e = MEMORIA.get(clave);
  if (vigente(e)) return null;
  const token = `${Date.now().toString(36)}-${++SEQ}`;
  escribir(clave, token, ttlSegundos);   // sincrono a memoria; el PUT va fire-and-forget
  return token;
}

/**
 * Suelta una reserva, PERO SOLO SI SEGUIS SIENDO EL DUEÑO.
 *
 * 🔴 [2026-08-24 · Codex, compuerta cruzada] La primera version era un `borrar()` pelado, y
 * Codex encontro la secuencia que lo rompe: A reserva · pasan los 5 min y su reserva vence ·
 * B toma una reserva nueva y valida · recien ahi A falla y suelta *la de B*. Con la llave
 * libre, C reserva tambien ⇒ dos envios, o sea justo el duplicado que el candado vino a
 * matar, ahora causado por el propio mecanismo de liberacion.
 *
 * La regla: una reserva vencida ya no es tuya, aunque vos la hayas pedido.
 *
 * @returns {boolean} true solo si se solto de verdad.
 */
export function liberarReserva(clave, token) {
  if (!token) return false;
  const e = MEMORIA.get(clave);
  if (!vigente(e) || e.valor !== token) return false;
  borrar(clave);
  return true;
}

/**
 * LEER-CALCULAR-ESCRIBIR ATOMICO. `calcular(valorActual)` devuelve `{ valor, guardar }`.
 *
 * 🔴 [2026-08-24 · 2a compuerta] Misma leccion que `reservar`, en los DATOS en vez del
 * candado: acumular las ventanas de un proyecto con `await leer()` y despues
 * `escribir()` tiene la carrera de siempre. Cada `calcular_cotizacion` leia la memoria
 * antes de que las hermanas escribieran, veia vacio, y guardaba SU ventana pisando a las
 * demas — el cliente con ocho ventanas terminaba con una.
 *
 * Igual que en `reservar`: LA GARANTIA ES QUE ACA NO HAY UN SOLO `await`. `calcular` debe
 * ser sincrona; si alguien le pasa una funcion async, la atomicidad se pierde en silencio.
 */
export function fusionar(clave, calcular, ttlSegundos = 3600) {
  const actual = leerLocal(clave);
  const { valor, guardar } = calcular(actual) || {};
  if (guardar && valor !== undefined && valor !== null) escribir(clave, valor, ttlSegundos);
  return valor === undefined ? actual : valor;
}

export function borrar(clave) {
  MEMORIA.delete(clave);
  pedir('DELETE', clave).catch(() => {});
}

/** Para tests. */
export function _reset() { MEMORIA.clear(); }

export default { leer, leerLocal, escribir, fusionar, reservar, liberarReserva, borrar, PERSISTENCIA_ACTIVA };
