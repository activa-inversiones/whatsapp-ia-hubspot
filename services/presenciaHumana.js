// presenciaHumana.js — "escribiendo…" y pausa antes de responder. ESM.
//
// [2026-08-08] Por qué existe:
// Un cliente le dijo al dueño que se dio cuenta de que hablaba con una IA porque
// "no le aparecieron los puntitos y le contestaron en el mismo momento". Tenía razón.
//
// El V1 del bot (index.js) SÍ tenía esto: startTypingLoop() + humanMs(). Pero el cerebro
// que atiende hoy es src/oliver-gpt/webhook.js, que hace return ANTES de llegar a ese
// código. La función existía y quedó varada en un camino que ya nadie recorre — el mismo
// patrón del bug de las reacciones del mismo día.
//
// LÍMITE DE META (verificado 2026-08-08 en developers.facebook.com/docs/whatsapp/cloud-api/
// typing-indicators): el único tipo soportado es "text" → "escribiendo…". NO existe un
// indicador de "grabando audio". Cuando Oliver manda una nota de voz no hay forma oficial
// de mostrar el micrófono; se muestra "escribiendo…" igual, que es lo más cercano.
//
// Efecto secundario útil: el mismo POST lleva status:"read" ⇒ le deja el doble check azul.
// Meta lo apaga solo a los 25 s, o cuando mandás el mensaje.

const META = {
  VER: process.env.META_GRAPH_VERSION || "v22.0",
  TOKEN: process.env.WHATSAPP_TOKEN,
  PHONE_ID: process.env.PHONE_NUMBER_ID,
};

// Interruptor para el dueño: apagar sin redeploy de código.
export const PRESENCIA_ACTIVA = process.env.OLIVER_PRESENCIA_HUMANA !== "false";

// Cuánto "tarda en escribir". Un humano escribe ~40 palabras/min en el celular; esto va
// bastante más rápido a propósito — no queremos que el cliente espere de verdad, queremos
// que no sea instantáneo. Números en env para que se calibren sin tocar código.
const MS_POR_CARACTER = Number(process.env.OLIVER_MS_POR_CARACTER || 22);
const PAUSA_MINIMA_MS = Number(process.env.OLIVER_PAUSA_MIN_MS || 900);
const PAUSA_MAXIMA_MS = Number(process.env.OLIVER_PAUSA_MAX_MS || 6500);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Cuánto esperar antes de mandar `texto`. Con un poco de azar: un valor fijo por
 * carácter es tan delator como no tener pausa (siempre exactamente 3,4 s = robot).
 * @returns {number} milisegundos
 */
export function pausaPara(texto) {
  const largo = String(texto || "").length;
  const base = PAUSA_MINIMA_MS + largo * MS_POR_CARACTER;
  const conAzar = base * (0.8 + Math.random() * 0.4); // ±20 %
  return Math.round(Math.min(conAzar, PAUSA_MAXIMA_MS));
}

/**
 * Le muestra "escribiendo…" al cliente y marca su mensaje como leído.
 * Nunca lanza: es cosmético, jamás puede tumbar una respuesta.
 * @param {string} msgId  El wamid del mensaje ENTRANTE del cliente.
 */
export async function mostrarEscribiendo(msgId) {
  if (!PRESENCIA_ACTIVA || !msgId || !META.TOKEN || !META.PHONE_ID) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/${META.VER}/${META.PHONE_ID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${META.TOKEN}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: msgId,
        typing_indicator: { type: "text" },
      }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Mantiene el "escribiendo…" vivo mientras el LLM piensa. Meta lo apaga a los 25 s,
 * así que se refresca antes. Un turno con cotización + PDF pasa de 25 s tranquilo.
 * @returns {() => void} llamar para cortar (siempre en un finally).
 */
export function mantenerEscribiendo(msgId, cadaMs = 18000) {
  if (!PRESENCIA_ACTIVA || !msgId) return () => {};
  let vivo = true;
  mostrarEscribiendo(msgId);
  const id = setInterval(() => { if (vivo) mostrarEscribiendo(msgId); }, cadaMs);
  if (typeof id.unref === "function") id.unref(); // no retener el proceso
  return () => { vivo = false; clearInterval(id); };
}

/**
 * Envuelve una función de envío para que espere lo que tardaría un humano en escribir
 * ese texto. Un solo wrap cubre TODOS los puntos de envío del handler.
 *
 * @param {(to:string, body:string, ...resto:any)=>Promise<any>} enviar
 * @returns {(to:string, body:string, ...resto:any)=>Promise<any>}
 */
export function conPausaHumana(enviar) {
  if (!PRESENCIA_ACTIVA) return enviar;
  return async function (to, body, ...resto) {
    try {
      await dormir(pausaPara(body));
    } catch {
      // Una pausa que falla no puede impedir que el cliente reciba la respuesta.
    }
    return enviar(to, body, ...resto);
  };
}

export default { mostrarEscribiendo, mantenerEscribiendo, conPausaHumana, pausaPara, PRESENCIA_ACTIVA };
