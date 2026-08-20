// burbujas.js — parte una respuesta larga en varias burbujas de WhatsApp. ESM, sin deps.
//
// [2026-08-08] Esta función VIVÍA dentro de index.js (smartSplitForWhatsApp, línea ~1776) y
// solo la usaba el V1. El cerebro que atiende hoy (src/oliver-gpt/webhook.js) mandaba un
// párrafo largo de una sola burbuja — una de las señales por las que un cliente notó que
// hablaba con una IA. Se MUEVE acá (no se copia) para que los dos caminos usen la misma:
// este repo ya se comió un bug caro por tener tres copias del mismo parser.
//
// Lógica intacta respecto del original: párrafos > oraciones > líneas > corte por espacio.

export const MAX_CARACTERES_BURBUJA = Number(process.env.WA_MAX_BUBBLE_CHARS || 320);

// [2026-08-20] TOPE DE BURBUJAS POR TURNO — nace de un cambio de precios de Meta.
// Desde el 1-oct-2026 Meta cobra POR MENSAJE también los de servicio (las respuestas libres
// dentro de la ventana de 24h), que hoy son gratis. O sea: cada burbuja extra pasa a ser
// plata. Medido sobre 30 días de conversaciones reales: 1.711 turnos → 2.719 mensajes
// (1,59 por turno), con turnos de hasta SIETE burbujas.
// El tope no mata la humanidad —2 burbujas siguen sonando a persona, que era el objetivo del
// 08-ago— pero corta la cola larga, que además de cara se lee como spam.
// Se corta re-uniendo las sobrantes en la última, NO tirándolas: perder texto sería peor que
// pagar un mensaje. WA_MAX_BUBBLES=0 desactiva el tope.
export const MAX_BURBUJAS = (() => {
  const v = Number(process.env.WA_MAX_BUBBLES);
  return Number.isFinite(v) && v >= 0 ? v : 2;
})();

// Techo duro de UN mensaje de WhatsApp: la API de Meta rechaza el body sobre 4096 caracteres.
// Se deja margen porque el conteo de Meta no es exactamente el de JS con emojis y acentos.
export const LIMITE_DURO_WA = 3500;

/**
 * Re-une las burbujas que pasan del tope dentro de la última. NUNCA pierde texto.
 *
 * ⚠️ CAMBIA EL CONTRATO DEL MÓDULO, a propósito: hasta hoy TODA burbuja medía
 * ≤ MAX_CARACTERES_BURBUJA (320). Con el tope, la última puede ser más larga, porque entre
 * "un mensaje de 900 caracteres" y "tres mensajes cobrados" preferimos el primero. Lo que NO
 * se negocia es el techo de WhatsApp: si al re-unir se pasaría de LIMITE_DURO_WA, se deja
 * una burbuja más en vez de armar un body que Meta rechazaría. Un mensaje caro es un
 * problema; un mensaje que no se entrega es perder al cliente.
 */
export function aplicarTope(burbujas, tope = MAX_BURBUJAS) {
  if (!Array.isArray(burbujas)) return burbujas;

  // El techo de WhatsApp vale SIEMPRE, incluso cuando no hay nada que re-unir y cuando el
  // tope está desactivado: no es una política de costo, es un límite de entrega. Al escribir
  // los tests de regresión del hallazgo de Copilot apareció que los dos `return` tempranos de
  // acá abajo se saltaban el troceo — aplicarTope(['x'.repeat(5000), 'chica'], 2) tiene
  // largo 2 y tope 2, así que salía por el atajo con el mensaje gigante intacto.
  const algunaSePasa = burbujas.some((b) => typeof b === "string" && b.length > LIMITE_DURO_WA);
  if (tope <= 0 || burbujas.length <= tope) {
    return algunaSePasa ? burbujas.flatMap(trocearSiPasaElTecho) : burbujas;
  }

  const res = burbujas.slice(0, tope - 1);
  let cola = "";
  for (const b of burbujas.slice(tope - 1)) {
    const unido = cola ? cola + "\n\n" + b : b;
    if (cola && unido.length > LIMITE_DURO_WA) {
      res.push(cola);   // esta ya no aguanta más: se cierra y se sigue en otra
      cola = b;
    } else {
      cola = unido;
    }
  }
  if (cola) res.push(cola);
  // [2026-08-20 · hallazgo de la revisión cruzada de Copilot] El bucle de arriba solo corta
  // cuando `cola` YA tiene algo: una burbuja que por sí sola pasa el techo entraba con
  // cola="" y salía intacta. Reproducido: aplicarTope(['x'.repeat(5000)], 2) devolvía un
  // mensaje de 5.000 caracteres, que Meta rechaza. Hoy no pasa por el camino normal
  // —partirEnBurbujas nunca entrega piezas > 320— pero aplicarTope es una función
  // EXPORTADA, y una invariante que depende de quién la llame no es una invariante.
  return res.flatMap(trocearSiPasaElTecho);
}

/** Parte una burbuja que supere el techo de WhatsApp. Corta en espacio; nunca pierde texto. */
function trocearSiPasaElTecho(texto) {
  // [2026-08-20 · 3ª pasada de Copilot] El typeof no es paranoia: `aplicarTope` es exportada
  // y en el camino de re-unión el flatMap corre sobre TODO el arreglo. Con un null adentro,
  // `texto.length` tira TypeError y se cae el envío del mensaje — la telemetría de costos no
  // puede tumbar una conversación, y esto es la misma regla aplicada al texto.
  if (typeof texto !== "string" || texto.length <= LIMITE_DURO_WA) return [texto];
  const partes = [];
  let resto = texto;
  while (resto.length > LIMITE_DURO_WA) {
    let corte = resto.lastIndexOf(" ", LIMITE_DURO_WA);
    if (corte < LIMITE_DURO_WA / 2) corte = LIMITE_DURO_WA;  // sin espacios útiles: corte duro
    partes.push(resto.slice(0, corte));
    resto = resto.slice(corte).replace(/^ /, "");
  }
  if (resto) partes.push(resto);
  return partes;
}

/**
 * @param {string} texto
 * @returns {string[]} una o más burbujas, en orden.
 */
export function partirEnBurbujas(texto) {
  if (!texto || texto.length <= MAX_CARACTERES_BURBUJA) return [texto];

  // 1) Por párrafos (doble salto de línea), re-uniendo los que quedan muy cortos.
  const parrafos = texto.split(/\n\n+/).filter(Boolean);
  if (parrafos.length > 1) {
    const unidos = [];
    let actual = "";
    for (const p of parrafos) {
      if (actual && (actual.length + p.length + 2) > MAX_CARACTERES_BURBUJA) {
        unidos.push(actual.trim());
        actual = p;
      } else {
        actual = actual ? actual + "\n\n" + p : p;
      }
    }
    if (actual.trim()) unidos.push(actual.trim());
    if (unidos.length > 1) return aplicarTope(unidos);
  }

  // 2) Por oraciones.
  const oraciones = texto.match(/[^.!?]+[.!?]+\s*/g);
  if (oraciones && oraciones.length > 1) {
    const res = [];
    let actual = "";
    for (const o of oraciones) {
      if (actual && (actual.length + o.length) > MAX_CARACTERES_BURBUJA) {
        res.push(actual.trim());
        actual = o;
      } else {
        actual += o;
      }
    }
    if (actual.trim()) res.push(actual.trim());
    if (res.length > 1) return aplicarTope(res);
  }

  // 3) Por saltos de línea simples.
  const lineas = texto.split(/\n/).filter(Boolean);
  if (lineas.length > 1) {
    const res = [];
    let actual = "";
    for (const l of lineas) {
      if (actual && (actual.length + l.length + 1) > MAX_CARACTERES_BURBUJA) {
        res.push(actual.trim());
        actual = l;
      } else {
        actual = actual ? actual + "\n" + l : l;
      }
    }
    if (actual.trim()) res.push(actual.trim());
    return aplicarTope(res);
  }

  // 4) Último recurso: cortar en el espacio anterior al límite.
  const res = [];
  let resto = texto;
  while (resto.length > MAX_CARACTERES_BURBUJA) {
    let corte = resto.lastIndexOf(" ", MAX_CARACTERES_BURBUJA);
    if (corte < 100) corte = MAX_CARACTERES_BURBUJA;
    res.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto.trim()) res.push(resto.trim());
  return aplicarTope(res);
}

export default partirEnBurbujas;
