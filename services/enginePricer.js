// services/enginePricer.js — Cotizador ACTIVA Engine para Oliver GPT
//
// Migración del cotizador V1 al ACTIVA Engine, gated por PRICER_MODE=engine.
// Respeta EXACTAMENTE el contrato de retorno de priceAll (index.js):
//   { ok, total, source:'activa_engine', escalate, reason?, error?, partial? }
// y setea en cada d.items[i] los mismos campos que
// applyCotizadorResultToSessionItems: unit_price, total_price, source,
// confidence, price_warning.
//
// Contrato del Engine (vía src/oliver-gpt/engine-client.js):
//   POST /api/quotes/calculate con
//     { tipo (APERTURA), ancho_mm, alto_mm, color, glass_id, comuna, cantidad }
//   Devuelve { ok, total_clp, total_con_iva, items, ... }.
//   NUNCA tipo:'TERMOPANEL' (es vidrio, va por glass_id).
//
// ESM, Node 18+.

import { calcularCotizacion } from "../src/oliver-gpt/engine-client.js";
import { detectarProductoFueraDeAlcance } from "./productoFueraDeAlcance.js";

// glass_id por defecto (termopanel). Configurable por env.
const DEFAULT_GLASS_ID = Number(process.env.ACTIVA_ENGINE_DEFAULT_GLASS_ID) || 44;

// ── Selección de vidrio por ÁREA + AMBIENTE (regla del dueño 2026-06-06) ──────
//   < 2 m²  → 4+12+4 claro (id 34)
//   ≥ 2 m²  → 5+12+5 claro (id 61)
//   Baño/WC → 4+12+4 satén (id 38)  [detección por nombre del ambiente]
// IDs configurables por env por si cambian en el catálogo del motor.
const GLASS_STD     = Number(process.env.GLASS_ID_STD)            || 34;
const GLASS_LARGE   = Number(process.env.GLASS_ID_LARGE)          || 61;
const GLASS_BANO    = Number(process.env.GLASS_ID_BANO)           || 38;
const GLASS_AREA_M2 = Number(process.env.GLASS_AREA_THRESHOLD_M2) || 2;
function pickGlassId(ancho_mm, alto_mm, ambiente) {
  const amb = String(ambiente || '').toLowerCase();
  if (/ba[ñn]o|wc|w\/c|water/.test(amb)) return GLASS_BANO;   // baño → satén
  const area = (Number(ancho_mm) / 1000) * (Number(alto_mm) / 1000);
  return area >= GLASS_AREA_M2 ? GLASS_LARGE : GLASS_STD;
}

// Aperturas válidas del Engine (enum cerrado). TERMOPANEL NUNCA está aquí.
const APERTURAS_ENGINE = new Set([
  "CORREDERA",
  "PROYECTANTE",
  "FIJA",
  "BATIENTE",
  "OSCILOBATIENTE",
]);

/**
 * Réplica local de normTipoApertura (index.js) — NO exportada desde index.
 * Devuelve la familia coloquial, o **null si el texto NO nombra ninguna apertura**.
 *
 * 🔴 [2026-08-25] Antes esto devolvía "CORREDERA" cuando no reconocía nada, y ese default
 * era INDISTINGUIBLE de un cliente que pidió corredera de verdad. Separar "no dijo" de
 * "dijo corredera" es lo único que permite preguntar en vez de suponer. El default sigue
 * existiendo (`normTipoAperturaLocal`, abajo): lo que cambia es que ahora se puede saber
 * que se aplicó.
 */
function detectarAperturaLocal(text) {
  const t = String(text || "").toLowerCase();
  // [Ronda 3 2026-07-20 · afinada 3.1 por revisión Codex] PUERTAS ABATIBLES — PRIMERO
  // (antes del check "abatible": una "puerta abatible" es PUERTA, no ventana BATIENTE).
  // Guardas de la rama:
  //  (a) negación: "no quiero una puerta, necesito una ventana fija" NO es puerta;
  //  (b) sustantivo-primero: si "ventana(l)" aparece ANTES que "puerta" en la frase
  //      ("ventana para la puerta de la cocina"), el producto es la VENTANA;
  //      "puerta ventana" (puerta primero) sí es puerta;
  //  (c) deslizantes: corredera/corrediza/deslizante/sliding → ramo CORREDERA/SLIDING.
  // [Ronda 3.2 — Codex] Limpiar FRASES NEGADAS COMPLETAS (sustantivo + SUS MODIFICADORES)
  // y usar el texto limpio en TODAS las ramas: antes "no quiero puerta DOBLE, necesito
  // puerta simple" dejaba vivo el "doble" (→ PUERTA_DOBLE mal) y "no quiero puerta
  // ABATIBLE, necesito ventana corredera" dejaba vivo "abatible" (→ BATIENTE mal).
  // [3.3] La negación también viene POSPUESTA en chileno: "…, no puerta doble" (sin
  // verbo) y "puerta doble no; puerta simple sí" (negación después del sustantivo).
  const MODS = '(?:\\s+(?:abatibles?|dobles?|simples?|interior(?:es)?|exterior(?:es)?|correderas?|corredizas?|deslizantes?|fij[ao]s?|batientes?|oscilobatientes?|proyectantes?|compuestas?|basculantes?|plegables?|de\\s+(?:una|dos|1|2)\\s+hojas?))*';
  const tl = t
    .replace(
      new RegExp(`\\b(?:no\\s+(?:quiero|necesito|busco)|no|sin|que\\s+no\\s+sea)\\s+(?:(?:una?|la|el)\\s+)?(?:puertas?|ventanas?|ventanal(?:es)?|compuestas?|correderas?|corredizas?)${MODS}\\b`, 'g'),
      " "
    )
    .replace(
      new RegExp(`\\b(?:puertas?|ventanas?|ventanal(?:es)?)${MODS}[\\s,;]*\\b(?:no|tampoco)\\b`, 'g'),
      " "
    )
      const iPuerta = tl.indexOf("puerta");
  const iVentana = tl.search(/ventan/);
  // "cambiar/reemplazar X POR Y": el producto pedido es Y aunque aparezca después
  // ("reemplazar la ventana por una puerta abatible" ES una puerta — regresión Codex).
  const porPuerta = /\b(?:por|hacia)\s+(?:una?\s+|la\s+)?puertas?\b/.test(tl);
  const porVentana = /\b(?:por|hacia)\s+(?:una?\s+|la\s+)?ventan/.test(tl);
  if (iPuerta >= 0 && !porVentana &&
      (porPuerta || iVentana < 0 || iPuerta < iVentana) &&
      !/corredera|corrediz|deslizant|desliza|sliding/.test(tl)) {
    if (tl.includes("interior")) return "PUERTA_INTERIOR";
    if (tl.includes("doble") || /\b(?:2|dos)\s*hojas?\b/.test(tl)) return "PUERTA_DOBLE";
    return "PUERTA";
  }
  // [2026-08-25] LA COMPUESTA PRIMERO: "mitad fija mitad proyectante" contiene las
  // palabras "fija" y "proyectante" — cualquier otra rama se la robaria. Es la ventana
  // que mas se vende (dueño) y ahora es UN tipo del motor, no dos items.
  // [Gemini, compuerta] "una fija y una proyectante" son DOS ventanas, no una compuesta:
  // la conjuncion sola no basta. Se exige señal de UNION: "mitad", el signo +, o
  // "unidas/juntas/en una (sola) ventana". Sin esa señal, cada una sigue su camino.
  if (/mitad\s+fij[ao]|mitad\s+proyectante|fij[ao]\s*\+\s*proyectante|proyectante\s*\+\s*fij[ao]|(?:fij[ao][^.]{0,30}proyectante|proyectante[^.]{0,30}fij[ao])[^.]{0,25}\b(?:unid[ao]s|juntas|en\s+una(?:\s+sola)?(?:\s+ventana)?)\b|ventana\s+compuesta|\bcompuestas?\b/.test(tl)) return "COMPUESTA";
  if (tl.includes("abatible") || tl.includes("abatir")) return "ABATIBLE";
  if (tl.includes("oscilobatiente") || tl.includes("oscilo")) return "OSCILOBATIENTE";
  if (tl.includes("proyectante") || tl.includes("proy")) return "PROYECTANTE";
  // 🔴 [2026-09-18] "FIJA" PUEDE SER UNA HOJA, NO LA VENTANA. Va ANTES de la rama FIJO.
  // El dueno mando una lista real y las triple hoja salieron en el PDF como "Ventana
  // Compuesta: Fijo 1383,5 mm + Proyectante". Textual: "error tras error".
  // La causa estaba ACA: "CORREDERA DOBLE RIEL TRIPLE HOJA, LA DEL MEDIO FIJA" contiene la
  // palabra "FIJA", la rama de abajo la agarraba primero y devolvia FIJA -> un pano fijo
  // serie S60. Toda la deteccion de riel y central fija que vive mas abajo en este archivo
  // funcionaba perfecto y NUNCA SE EJECUTABA, porque el tipo ya venia decidido mal.
  //
  // ⚠️ NO se invierte el orden a lo bruto: la rama FIJO esta antes a proposito desde el
  // 2026-06-24, porque "FIJA"/"BATIENTE" caian al fallback CORREDERA y se cotizaban al DOBLE
  // (casos 0064/0065/0066). Por eso esta regla es ANGOSTA: la corredera gana solo si el texto
  // NOMBRA la corredera Y la fija esta descrita como UNA HOJA de ella —"hoja fija", o la
  // central/del medio—. Un "pano fijo" suelto NO alcanza: eso sigue siendo una ventana fija.
  // ⚠️ [Codex, compuerta, 2 vueltas] TRES DEFECTOS MIOS, TODOS MEDIDOS:
  //  1. AUTOGOL: el ejemplo que yo mismo escribi en el prompt —"pano central fijo y los
  //     laterales CORREN"— caia en FIJA, porque no dice la palabra "corredera". El cliente
  //     nombra la corredera por el VERBO tanto como por el sustantivo.
  //  2. SEGUNDO AUTOGOL, peor: "doble riel triple hoja la del medio fija" —la frase textual
  //     de la lista del cliente, que tambien puse en el prompt— NO tiene sustantivo NI verbo.
  //     Lo que la delata es la ESTRUCTURA: hablar de RIELES y de N HOJAS ya es hablar de una
  //     corredera; ninguna otra apertura tiene rieles.
  //  3. NEGACION: "no quiero corredera, quiero hoja fija" devolvia CORREDERA (regresion que
  //     introduje yo). Y sin \b, "inmoviles" activaba el verbo "moviles" y "recorren" el
  //     verbo "corren".
  const _corredoraNombrada =
    /corredera|corrediz|sliding|deslizan/.test(tl)
    // el verbo, con limites de palabra y sin el "no corren" del cliente que aclara que son fijas
    || (/\b(?:corren|corran|m[oó]viles|moviles)\b|\bse\s+mueven\b/.test(tl)
        && !/\bno\s+(?:corren|corran|se\s+mueven)\b/.test(tl))
    // la estructura: rieles y conteo de hojas. Solo la corredera tiene rieles.
    || /\b(?:doble|triple|dos|tres|2|3)\s+riel(?:es)?\b|\briel(?:es)?\s+(?:doble|triple)\b/.test(tl);
  // Un REEMPLAZO explicito hacia lo fijo desactiva la guardia ("cambiar la corredera POR una
  // hoja fija"), igual que ya se hacia con "por una puerta". Se exige el VERBO de sustitucion:
  // un "por" suelto no alcanza (lo pidio Codex, y tiene razon: "por" aparece por todos lados).
  const _cambioAFija =
    /\b(?:cambiar|cambio|reemplaz|sustitu|convertir|convierta|dejar|pasar)\w*\b[^.]{0,40}\b(?:por|a|en)\s+(?:una?\s+|la\s+|el\s+)?(?:hojas?\s+|pa[ñn]os?\s+)?fij[ao]s?\b/.test(tl);
  // ⚠️ [Gemini, compuerta semantica] LA GUARDIA ERA DEMASIADO ANGOSTA Y SEGUIA SUBCOBRANDO.
  // Gemini la ataco desde el lenguaje real del cliente chileno y 6 de sus 9 ejemplos fallaban
  // de verdad (medidos). TODAS estas eran correderas y devolvian FIJA —o sea, se cotizaba un
  // pano fijo en vez de una corredera: subcobro de ~50%—:
  //     "corredera con un pano fijo"          <- "pano" es la palabra mas usada en Chile
  //     "corredera de dos hojas, una fija"    <- el caso mas tipico de todos
  //     "corredera 3 hojas, lateral fijo"
  //     "corredera de dos hojas, la derecha fija"
  //     "corredera de 3 hojas, 1 fija"
  // La guardia solo miraba "hoja fija" PEGADO, o la central. Basta una coma o un "una" para
  // romper la contiguidad, y el cliente escribe asi siempre.
  //
  // Y al reves, un SOBRECOBRO que tambien cazo:
  //     "necesito el precio de la hoja fija, de la corredera ya lo tengo"  -> daba CORREDERA
  //
  // LO QUE RESUELVE LAS DOS PUNTAS ES EL ORDEN. Cuando el cliente pide una corredera y despues
  // describe sus hojas, la corredera va PRIMERO; cuando habla de una fija y despues menciona
  // otra ventana, la fija va primero. Asi que la fija-como-parte solo cuenta si la senal de
  // corredera viene ANTES. La central/del medio se exceptua: esa es inequivocamente una hoja
  // de una corredera de 3, venga donde venga ("pano central fijo y los laterales corren").
  //
  // 🔴 LIMITE DECLARADO, NO TAPADO: esto sigue siendo un clasificador de UNA apertura sobre un
  // texto que puede traer VARIAS ventanas. "3 fijas y 2 correderas" o "pano fijo y una
  // corredera" son DOS productos y aca se devuelve uno solo (hoy: FIJA, por el orden). No se
  // resuelve con otra regex —lo dijeron Codex y Gemini por separado— sino segmentando el
  // pedido por ventana. Tablero #797.
  const _iCorr = tl.search(/corredera|corrediz|sliding|deslizan|\b(?:doble|triple|dos|tres|2|3)\s+riel(?:es)?\b|\briel(?:es)?\s+(?:doble|triple)\b|\b(?:corren|corran|m[oó]viles|moviles)\b|\bse\s+mueven\b/);
  const _iFija = tl.search(/\bfij[ao]s?\b/);
  // La fija descrita como UNA PARTE de la ventana: una hoja, un pano, "una", "1", un lateral,
  // la derecha/izquierda. Un "pano fijo" suelto SIN corredera delante sigue siendo una ventana
  // fija: el orden de la rama FIJO existe desde 2026-06-24 porque FIJA/BATIENTE caian al
  // fallback CORREDERA y cotizaban al DOBLE (casos 0064/0065/0066).
  const _fijaEsParte =
    /\b(?:hojas?|pa[ñn]os?|una|uno|1|dos|2|tres|3|lateral(?:es)?|derech[ao]|izquierd[ao])\b[^.]{0,14}\bfij[ao]s?\b/.test(tl)
    || /\bfij[ao]s?\b[^.]{0,14}\b(?:hojas?|pa[ñn]os?|lateral(?:es)?)\b/.test(tl);
  const _fijaEsLaCentral =
    /\b(?:central(?:es)?|del\s+medio|del\s+centro)\b[^.]{0,25}\bfij[ao]s?\b/.test(tl)
    || /\bfij[ao]s?\b[^.]{0,20}\b(?:central(?:es)?|del\s+medio|del\s+centro)\b/.test(tl);
  if (_corredoraNombrada && !_cambioAFija
      && (_fijaEsLaCentral || (_fijaEsParte && _iCorr >= 0 && _iFija >= 0 && _iCorr < _iFija))) {
    return "CORREDERA";
  }
  // [FIX 2026-06-24 — BUG RAÍZ COTIZADOR] El enum real del bot es "FIJA"/"BATIENTE", pero antes
  // solo se matcheaba "fijo"/"abatible" → "FIJA" y "BATIENTE" caían al fallback CORREDERA y se
  // cotizaban (y rotulaban serie SLIDING) como CORREDERA: precio ~2x. Explica el caso 0064/0065/0066.
  // Probado: _test-apertura-bug.mjs (RED→GREEN). Ahora cubre fija/fijas/fijo/fijos y batiente.
  if (/\bfij[ao]s?\b/.test(tl) || tl.includes("marco fijo")) return "FIJO";
  if (tl.includes("corredera") || tl.includes("corrediz") || tl.includes("sliding") || tl.includes("deslizan")) return "CORREDERA";
  if (tl.includes("batiente")) return "ABATIBLE"; // (oscilobatiente ya capturado arriba)
  if (tl.includes("basculante")) return "BASCULANTE";
  if (tl.includes("plegable")) return "PLEGABLE";
  return null; // el texto no nombra ninguna apertura
}

/** Familia coloquial CON el default histórico. Mismo comportamiento de siempre. */
function normTipoAperturaLocal(text) {
  return detectarAperturaLocal(text) || "CORREDERA"; // más común
}

/**
 * ¿El cliente NOMBRÓ la apertura, o se la estamos poniendo nosotros?
 *
 * Nació de un reclamo del dueño (2026-08-25), textual: *"siempre está enviando imágenes
 * que igual le cotizamos corredera"*. El mecanismo era este archivo: cualquier texto que
 * no dijera una apertura —"ventana", "V1 | NO ESPECIFICADO | 2000x1450" que devuelve la
 * visión cuando no la ve— caía a CORREDERA **en silencio**, y el cliente recibía el precio
 * de una corredera sin que nadie le avisara. Es el mismo defecto del color, que costó que
 * TODAS las cotizaciones salieran blancas.
 *
 * Solo REPORTA. No cambia ni un peso del cálculo: quién pregunta es el gate del PDF.
 */
export function aperturaFueExplicita(text) {
  return detectarAperturaLocal(text) !== null;
}

/**
 * Mapea el producto del item a una APERTURA válida del Engine.
 * default CORREDERA si no se reconoce; NUNCA TERMOPANEL.
 * @param {string} product
 * @returns {'CORREDERA'|'PROYECTANTE'|'FIJA'|'BATIENTE'|'OSCILOBATIENTE'}
 */
export function mapAperturaToEngine(product) {
  const fueraDeAlcance = detectarProductoFueraDeAlcance(product);
  if (fueraDeAlcance.fueraDeAlcance) {
    throw new TypeError(fueraDeAlcance.razon);
  }
  const norm = normTipoAperturaLocal(product);
  switch (norm) {
    case "COMPUESTA":
      return "COMPUESTA";
    case "PROYECTANTE":
      return "PROYECTANTE";
    case "OSCILOBATIENTE":
      return "OSCILOBATIENTE";
    case "ABATIBLE":
      return "BATIENTE";
    case "FIJO":
      return "FIJA";
    case "CORREDERA":
      return "CORREDERA";
    // [Ronda 3 2026-07-20] Puertas abatibles: el motor las cotiza con BOM real S60
    // (verificado en vivo). Pasan tal cual — mapSerieToEngine las manda a S60.
    case "PUERTA":
      return "PUERTA";
    case "PUERTA_INTERIOR":
      return "PUERTA_INTERIOR";
    case "PUERTA_DOBLE":
      return "PUERTA_DOBLE";
    // BASCULANTE, PLEGABLE y cualquier otro → default seguro
    default:
      return "CORREDERA";
  }
}

/**
 * Mapea la apertura del Engine a la SERIE de perfiles.
 * Corredera = SLIDING (el motor elige hoja H80/H98 por área y riel por nº hojas);
 * el resto de aperturas = S60. Antes NO se mandaba serie → el motor asumía S60 y la
 * corredera cotizaba con perfiles equivocados (precio inventado). FIX 2026-06-06.
 * @param {'CORREDERA'|'PROYECTANTE'|'FIJA'|'BATIENTE'|'OSCILOBATIENTE'} tipoEngine
 * @returns {'SLIDING'|'S60'}
 */
export function mapSerieToEngine(tipoEngine) {
  return tipoEngine === "CORREDERA" ? "SLIDING" : "S60";
}

// [2026-08-27] Linea AMERICANA (SILTEK): se detecta por el texto del item. Solo la corredera
// existe en esta linea. El dueño la abrio CON TOPE DE TAMAÑO: hasta 2,5 m por lado el motor la
// cotiza (calibrada contra el BOM real de Winart v67152); mas grande escala a Marcelo, porque
// el escalado de barras a tamaños grandes no esta medido y podria cobrar de menos.
export const AMERICANA_MAX_MM = 2500;
export function esLineaAmericana(item) {
  // Se unen con " | " (no con espacio): pegar el enum del producto ("CORREDERA") justo detras
  // de la descripcion creaba adyacencias falsas — "...cocina americana | CORREDERA" ya NO matchea
  // "americana corredera" (lo cazo el test de la cocina americana).
  const t = [item?.descripcion, item?.product, item?.label, item?.producto].filter(Boolean).join(" | ")
    .replace(/_/g, " ")   // [Codex 2a vuelta] el "_" rompe \b y \s+: "SISTEMA_AMERICANA" evadia el CTX; se normaliza como en productoFueraDeAlcance.
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // [compuerta cruzada] americana ES una LINEA de ventanas: se detecta PEGADA a un sustantivo
  // de ventana/apertura/linea, NO como adjetivo suelto. "cocina americana" (un ambiente, no el
  // producto) NO debe enrutar a la linea y cobrar de menos — lo cazaron Codex y Gemini.
  const CTX = '(?:linea|serie|sistema|modelo|estilo|ventanas?|ventanal(?:es)?|correderas?|corredizas?|deslizantes?|proyectantes?|batientes?|abatibles?|fijas?|oscilobatientes?)';
  return new RegExp(`\\b${CTX}\\s+(?:de\\s+)?american[ao]s?\\b`).test(t)
      || new RegExp(`\\bamerican[ao]s?\\s+${CTX}\\b`).test(t);
}

// [2026-08-27] Línea ANDES: sólo el envelope CALIBRADO contra Winart (decisión del dueño) — doble
// riel, 2 hojas, hoja 66 (ventanas ≥ 3,5 m²), hasta 2,5 m/lado. Todo lo demás (hoja 54 chica,
// monorriel, 3-4 hojas, más grande) ESCALA: no está contrastado y podría cobrar mal.
export const ANDES_MAX_MM = 2500;
export const ANDES_MIN_AREA_M2 = 3.5;   // bajo esto el motor usa hoja 54, que NO está calibrada.

// 🔴 KILL-SWITCH (2026-08-27, decisión del dueño). El auto-cotizado de ANDES está APAGADO: toda
// Andes ESCALA a revisión manual, como antes de abrirla.
// POR QUÉ: un barrido adversarial de 98 entradas de cliente chilenas midió que 96 se colaban al
// envelope de 2 hojas siendo de 3-4 hojas o llevando paño fijo. Ejemplos reales que evadían:
// "3 hojitas" (el diminutivo rompe el regex), "3 luces", "4 postigos", "dividida en 4 partes",
// "2 hojas y un vidrio pegado que queda quieto", "un lado muerto", "XOX". Subcobro medido en la
// clase peor (4 hojas cotizadas como 2, vano 2200×2000): $139.000–$155.000 por ventana (12–14%).
// CAUSA RAÍZ: el nº de hojas se ADIVINA con regex sobre el texto libre del cliente; no existe un
// campo estructurado. Ampliar la lista de sinónimos es un pozo sin fondo (cada vuelta de compuerta
// encontró uno nuevo).
// CÓMO SE REABRE: cuando el LLM DECLARE hojas y paño fijo en un campo estructurado y el envelope
// exija esa confirmación positiva (hojas === 2 && sin fijos) en vez de inferirla del texto. Recién
// ahí poner true, con la compuerta cruzada completa. NO reabrir sólo agregando palabras al regex.
export const ANDES_AUTO_COTIZA = false;
export function esLineaAndesTexto(texto) {
  const t = String(texto || "")
    .replace(/_/g, " ").normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Mismo criterio de contexto que la americana: "andes" pegado a un sustantivo de ventana/línea.
  // Así "línea andes"/"corredera andes" matchean pero la COMUNA "Los Andes" no.
  const CTX = '(?:linea|serie|sistema|modelo|estilo|ventanas?|ventanal(?:es)?|correderas?|corredizas?|deslizantes?)';
  // [Codex 2026-08-27] El patrón INVERTIDO ("andes" + sustantivo) daba falso positivo con la comuna
  // cuando el sustantivo venía después: "despacho a Los Andes línea americana" matcheaba "andes linea"
  // y escalaba una AMERICANA perfectamente cotizable. El lookbehind descarta el "los" de la comuna.
  // Solo "los": la comuna es "Los Andes", nunca "Las Andes" — excluir "las" abría un hueco sin motivo.
  // [Codex 4a] "línea de Los Andes" es el PRODUCTO, no la comuna: cuando hay un sustantivo de
  // producto delante, el "los" ya no delata a la comuna. Se acepta el "los" opcional ahí.
  return new RegExp(`\\b${CTX}\\s+(?:de\\s+)?(?:los\\s+)?andes\\b`).test(t)
      || new RegExp(`(?<!\\blos\\s)\\bandes\\s+${CTX}\\b`).test(t);
}

export function esLineaAndes(item) {
  return esLineaAndesTexto([item?.descripcion, item?.product, item?.label, item?.producto].filter(Boolean).join(" | "));
}

/**
 * [Codex 2026-08-27] Mientras el auto-cotizado de ANDES está APAGADO, alcanza con que la palabra
 * "andes" aparezca para mandar el pedido a revisión: un `descripcion_producto: "Andes"` a secas no
 * matcheaba el patrón con contexto y se cotizaba como SLIDING — otra línea, producto equivocado.
 * Única excepción: la COMUNA "Los Andes" (precedida de "los"), que es un despacho, no un producto.
 * Sobre-escalar acá no cuesta plata; cotizar la línea equivocada sí.
 */
export function mencionaAndes(texto) {
  const t = String(texto || "")
    .replace(/_/g, " ").normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /(?<!\blos\s)\bandes\b/.test(t);
}

/**
 * Detecta nº de hojas si el cliente/foto lo indica ("3 hojas", "tres hojas", "triple").
 * Si no se sabe → undefined (el motor usa su default = 2 hojas / doble riel).
 * [Codex 3a vuelta] Se toma el MÁXIMO de todas las menciones "N hoja(s)" (dígito o palabra):
 * si el texto dice "2 y 3 hojas" no puede cotizar la de 2 (subcobro). La palabra-número solo
 * cuenta PEGADA a "hoja" — "una corredera grande" NO es 1 hoja (lo fija el test chileno).
 */
export function detectHojas(product) {
  const t = String(product || "").toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const NUMP = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4 };
  let max;
  const re = /(\d+|una|uno|un|dos|tres|cuatro)\s*hojas?/g;
  let m;
  while ((m = re.exec(t))) {
    const v = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMP[m[1]];
    if (Number.isFinite(v) && v >= 1) max = Math.max(max ?? 0, v);
  }
  if (max) return max;
  if (/\btriple\b/.test(t)) return 3;
  if (/\bcuadruple\b/.test(t)) return 4;
  return undefined;
}

/**
 * CONFIG DE CORREDERA: el lenguaje del cliente -> el modelo REAL de Winart.
 *
 * Instruccion del dueno (2026-09-18, textual): *"cualquier lenguaje de cliente que indique que
 * la central fija es de doble riel; si quiere mover las tres hacia un lado es triple riel y se
 * mueven las 3 en tres rieles diferentes"*.
 *
 * NO es una interpretacion: es la taxonomia de modelos de Winart, leida de su propia API
 * (GET /models, 2026-09-18). Las dos familias de 3 hojas existen y son productos DISTINTOS:
 *     S75_DOBLERIEL_TRES_HOJA_98   <- 3 hojas en 2 rieles: la del centro va FIJA
 *     S75_TRIPLERIEL_TRES_HOJA_98  <- 3 hojas en 3 rieles: las 3 corren y se apilan a un lado
 * Las dos versiones de referencia que dejo el dueno (2710x1995): v69621 doble / v69622 triple.
 * Estan separadas por $99.364 de MATERIAL. Equivocarse de familia no es un detalle de nombre.
 *
 * 🔴 SEGUNDA VUELTA — LA COMPUERTA CRUZADA LA RECHAZO, Y TENIA RAZON (2026-09-18).
 * La v1 fallaba 9 de 15 frases chilenas reales. Kimi (NIM) y Gemini, por separado, cazaron:
 *   · NO cazaba: "la de al medio no se abre" - "solo se mueven las de los lados" -
 *     "el pano central es fijo" - "que corran las tres" - "se abren las 3" -
 *     "las corro todas para la derecha" - "corren todas pa un lado" - "riel triple" -
 *     "fija al centro".
 *   · Y peor: NO MIRABA LA NEGACION. "no quiero triple riel, quiero doble" devolvia TRIPLE,
 *     y "tres rieles no, dos" tambien: el cliente pedia una cosa y se le cotizaba la otra.
 *
 * ⚖️ POR ESO ACA NO SE ADIVINA. Cuando las senales se contradicen, o cuando el cliente descarta
 * una configuracion sin dejar claro cual quiere, se devuelve `ambiguo: true` y NINGUN riel: el
 * pedido escala a Marcelo en vez de salir cotizado a ciegas. Es el mismo criterio que ya usa la
 * rama ANDES en este archivo ("si hay mencion pero no se confirma, se escala"), y es lo correcto
 * cuando el error vale $99.364: entre cotizar mal y preguntar, se pregunta. Adivinar es lo que
 * produjo el incidente que esto viene a cerrar.
 *
 * Devuelve { riel, activos, centralFija, ambiguo, motivo }. Los campos van undefined cuando el
 * texto no los define, para que el motor aplique su default calibrado y no una adivinanza.
 */
export function detectConfigCorredera(texto, hojas) {
  const t = String(texto || "").toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Vocabulario chileno de "la hoja del medio". Incluye pano/panel/cuerpo/seccion, que es como
  // le dice buena parte de los clientes, y el typo "ojas". (Gemini + Kimi, 18-sep.)
  const MEDIO = '(?:central|centro|del\\s+centro|del\\s+medio|de\\s+al\\s+medio|al\\s+medio|en\\s+el\\s+medio|al\\s+centro|en\\s+el\\s+centro)';
  const PIEZA = '(?:hoja|oja|pano|panel|cuerpo|seccion|tramo|vidrio|ventana)';
  // "no se abre" es sinonimo de fija tanto como "no se mueve": lo cazo Gemini.
  const NO_ABRE = '(?:no\\s+(?:se\\s+)?(?:mueve|corre|abre|desliza))';

  // 🔴 [3a VUELTA, 18-sep, PROBADO POR EL DUENO EN EL CHAT REAL] LO ULTIMO QUE DICE EL CLIENTE
  // MANDA SOBRE LO ANTERIOR.
  //
  // La 2a version leia el texto como si fuera UN pedido, y `texto_cliente` es en realidad TODOS
  // los mensajes del cliente pegados en orden (ver textoDelCliente en normalizers.js). En una
  // conversacion de verdad el cliente CAMBIA DE IDEA, y ahi los dos indicios conviven:
  //     "...corredera triple hoja en 2 rieles central fija laterales corredera"   (4:20)
  //     "si quiero triple riel"                                                    (4:22)
  // La guardia de contradiccion se disparaba con el texto acumulado y escalaba PARA SIEMPRE:
  // el cliente pedia el triple riel y no recibia nada. Medido en el chat del dueno.
  //
  // La diferencia que hay que hacer, y que la 2a version no hacia: CONTRADECIRSE no es lo mismo
  // que CAMBIAR DE IDEA. Se resuelve por POSICION — gana el indicio que aparece mas tarde — y
  // solo se declara ambiguo cuando los dos vienen en la MISMA frase ("la del medio fija pero que
  // corran las tres"), que ahi si es una contradiccion de verdad.
  const ultimoIndice = (patrones) => {
    let max = -1;
    for (const re of patrones) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let m;
      while ((m = g.exec(t)) !== null) {
        if (m.index > max) max = m.index;
        if (m.index === g.lastIndex) g.lastIndex++;   // guarda contra match vacio
      }
    }
    return max;
  };
  // Un "segmento" es una frase o un mensaje distinto. textoDelCliente pega los mensajes con dos
  // espacios; dentro de un mensaje separan el punto, el punto y coma y el salto de linea.
  const segmentoDe = (idx) => (idx < 0 ? -1
    : (t.slice(0, idx).match(/(?:\s{2,}|[.;\n!?])/g) || []).length);

  const RE_FIJA = [
    new RegExp(`\\b(?:${PIEZA}\\s+)?${MEDIO}\\s+(?:es\\s+|va\\s+|queda\\s+|sale\\s+)?fij[ao]\\b`),
    new RegExp(`\\bfij[ao]\\s+(?:la\\s+|el\\s+)?(?:${PIEZA}\\s+)?${MEDIO}\\b`),
    new RegExp(`\\b(?:la\\s+|el\\s+)?(?:${PIEZA}\\s+)?${MEDIO}\\s+${NO_ABRE}\\b`),
    // "solo se mueven las de los lados" = la del medio es fija, dicho al reves (Gemini).
    /\bsolo\s+(?:se\s+)?(?:mueven|corren|abren)\s+(?:las\s+)?(?:de\s+)?(?:los\s+)?(?:lados|laterales|extremos|costados)\b/,
    /\b(?:laterales|de\s+los\s+lados)\s+corred(?:eras?|izas?)\b/,
  ];

  // "las 3 corren". Se aceptan las conjugaciones que usa el cliente (corran/corren/se abren/se
  // mueven), el "pa" chileno, y "para la derecha/izquierda" ademas de "a un lado".
  const LADO = '(?:un\\s+(?:solo\\s+)?lado|el\\s+mismo\\s+lado|la\\s+derecha|la\\s+izquierda|un\\s+costado)';
  const HACIA = '(?:hacia|para|pa|a)';
  const RE_TRIPLE = [
    /\b(?:las\s+)?(?:3|tres)\s+(?:hojas?\s+)?(?:corren|corran|corredizas|se\s+mueven|se\s+abren|moviles|deslizan)\b/,
    /\b(?:corran|corren|se\s+mueven|se\s+abren|abren|mover|correr|abrir)\s+(?:todas\s+)?(?:las\s+)?(?:3|tres)\b/,
    new RegExp(`\\b(?:corro|corren|corran|mover|mueven|van|se\\s+van)\\s+(?:todas|las\\s+3|las\\s+tres)\\s+${HACIA}\\s+${LADO}\\b`),
    new RegExp(`\\b(?:todas|las\\s+3|las\\s+tres)\\s+(?:se\\s+)?(?:corren|mueven|van)?\\s*${HACIA}\\s+${LADO}\\b`),
    /\b(?:tres|3)\s+riel(?:es)?\b/,
    // 🔴 [2026-09-18] LAS DOS PALABRAS DEL MEDIO NO SON UNA TERCERA DECLARACION.
    // Un cliente mando "CORREDERA DOBLE RIEL TRIPLE HOJA, LA DEL MEDIO FIJA" y Oliver ESCALO
    // en vez de cotizar. El texto no tiene nada de ambiguo; lo que pasa es que hay tres
    // candidatos SUPERPUESTOS, y el del medio roba una palabra a cada lado:
    //     DOBLE RIEL TRIPLE HOJA
    //     [doble riel]                 <- lo que el cliente dijo del riel
    //            [riel triple]         <- CASUALIDAD: no lo dijo nadie
    //                  [triple hoja]   <- lo que el cliente dijo de las hojas
    // El candidato del medio se leia como un segundo pedido de riel, chocaba con la central
    // fija y se declaraba contradiccion. O sea: la guardia anti-adivinanza se disparo con un
    // texto perfectamente claro — el mismo sintoma que este archivo vino a arreglar, por otra
    // puerta.
    //
    // El dueno confirmo que "riel triple" SI es sinonimo de "triple riel", asi que el patron se
    // conserva. Lo que se descarta es la COINCIDENCIA QUE PISA a otro atributo ya dicho:
    // si la palabra "riel" ya venia con su cantidad adelante ("doble riel", "dos rieles"),
    // entonces ese "riel" ya esta hablado y no puede volver a contar.
    //
    // ⚠️ La primera version de este fix miraba al OTRO lado —prohibia "riel triple" cuando le
    // seguia "hoja"— y Codex la refuto con razon: eso mata al cliente que escribe
    // "riel triple, hojas al mismo lado", que SI esta pidiendo triple riel. La evidencia que
    // resuelve el caso esta a la IZQUIERDA, no a la derecha.
    // El "doble" del cliente viene mal escrito seguido: en la lista real decia "DOBRE RIEL".
    // Por eso la cantidad del riel se reconoce con tolerancia a esa familia de erratas
    // (doble/dobre/doble/dobe) en vez de enumerar typos uno por uno — enumerar es volver a
    // escalar la proxima vez que alguien escriba distinto.
    /(?<!\b(?:d[oó]b?[lr]?e|dos|2|simple|mono|monorriel)\s)\briel\s+triple\b/,
    // ⚠️ NO SE LE PONE EL GUARD ESPEJO A "triple riel", y esto es una correccion mia.
    // Habia agregado /(?<!hojas?)triple riel(?! doble)/ por simetria, para el caso
    // "HOJA TRIPLE RIEL DOBLE". Codex lo refuto y lo MEDI: ese guard deja en undefined a
    // "corredera tres hojas triple riel" y "ventana 3 hojas triple riel", que es como habla
    // un cliente normal. O sea arreglaba un caso que NADIE mando nunca y rompia uno que si
    // llega. El caso real medido es UNO SOLO —"doble riel" + "triple hoja"— y solo ese se
    // parchea. Simetria no es evidencia.
    /\btriple\s+riel\b/,
  ];
  // "la central NO es fija, TODAS corren": el cliente describe el triple riel sin decir el
  // numero. "todas" solo se lee asi cuando YA sabemos que son 3 hojas; en una de 2 seria un
  // TRIPLE inventado, o sea sobrecobro. (Gemini + Kimi, 2a vuelta.)
  const RE_TRIPLE_SIN_NUMERO = Number(hojas) === 3 ? [
    /\btodas\s+(?:se\s+)?(?:corren|corran|mueven|abren|deslizan)\b/,
    /\btodas\s+(?:son\s+)?corred(?:eras?|izas?)\b/,
  ] : [];

  const posFija = ultimoIndice(RE_FIJA);
  const posTriple = ultimoIndice([...RE_TRIPLE, ...RE_TRIPLE_SIN_NUMERO]);
  const centralFija = posFija >= 0;
  const todasCorren = posTriple >= 0;

  const dosRielesLiteral = /\b(?:2|dos)\s+rieles?\b/.test(t) || /\bdoble\s+riel\b/.test(t) || /\briel\s+doble\b/.test(t);

  // 🔴 NEGACION. "no quiero triple riel", "tres rieles no", "en vez de triple", "nada de".
  // Sin esto, la frase que NIEGA un producto lo terminaba PIDIENDO. (Kimi, 18-sep.)
  const NEG = '(?:no\\s+(?:quiero\\s+|es\\s+|sea\\s+|son\\s+|va\\s+|vaya\\s+|me\\s+sirve\\s+)?(?:de\\s+|con\\s+)?|sin\\s+|nada\\s+de\\s+|en\\s+vez\\s+de\\s+|en\\s+lugar\\s+de\\s+)';
  const niegaTriple = new RegExp(`\\b${NEG}(?:triple|tres\\s+rieles?|3\\s+rieles?)`).test(t)
    || /\b(?:triple\s+riel|tres\s+rieles?|3\s+rieles?)\s*,?\s+no\b/.test(t);
  const niegaFija = new RegExp(`\\b${MEDIO}\\s+no\\s+(?:es\\s+|va\\s+|sea\\s+)?fij[ao]\\b`).test(t)
    || new RegExp(`\\b${NEG}(?:${PIEZA}\\s+)?${MEDIO}\\s+fij[ao]`).test(t);

  // [Kimi 2a vuelta] "no quiero triple riel, quiero DOBLE": el cliente dice "doble" a secas, sin
  // repetir "riel". Esa palabra sola solo cuenta como riel cuando viene JUNTO al descarte del
  // triple; suelta no significa nada ("doble vidrio", "doble ventana" son otra cosa).
  const dosRieles = dosRielesLiteral || (niegaTriple && /\bdoble\b/.test(t));

  // Una senal NEGADA no cuenta como pedido.
  const quiereFija = centralFija && !niegaFija;
  const quiereTriple = todasCorren && !niegaTriple;

  // ⚖️ AMBIGUO SOLO SI SE CONTRADICE EN LA MISMA FRASE. Si los dos indicios estan en frases o
  // mensajes distintos, no hay contradiccion: el cliente cambio de idea y manda el ultimo.
  const mismaFrase = quiereFija && quiereTriple
    && segmentoDe(posFija) === segmentoDe(posTriple);
  if (mismaFrase) {
    return {
      riel: undefined, activos: undefined, centralFija: true, ambiguo: true,
      motivo: 'el pedido dice a la vez que la hoja del medio va fija y que las tres corren: son dos ventanas distintas',
    };
  }
  // El otro caso que sigue escalando: descarta una configuracion y no deja claro cual quiere.
  const descartaSinReemplazo = (niegaTriple && todasCorren && !quiereFija && !dosRieles)
    || (niegaFija && centralFija && !quiereTriple && !dosRieles);
  if (descartaSinReemplazo) {
    return {
      riel: undefined, activos: undefined, centralFija: quiereFija, ambiguo: true,
      motivo: 'el pedido descarta una configuracion pero no deja claro cual quiere',
    };
  }

  // GANA EL ULTIMO. Con un solo indicio, ese; con los dos en frases distintas, el mas tardio.
  const mandaFija = quiereFija && (!quiereTriple || posFija > posTriple);
  const mandaTriple = quiereTriple && (!quiereFija || posTriple > posFija);

  let riel;
  // La CENTRAL FIJA es el modelo doble riel de Winart, aunque el cliente haya escrito "triple"
  // (que ahi significa TRES HOJAS, no tres rieles). Ese es exactamente el pedido que se cotizo
  // mal el 18-sep: "triple hoja ... central fija en 2 rieles".
  // Un "doble" DICHO EXPLICITO gana sobre un "tres" suelto cuando ademas se nego el triple.
  if (mandaFija) riel = 'DOBLE';
  else if (dosRieles && niegaTriple) riel = 'DOBLE';
  else if (mandaTriple) riel = 'TRIPLE';
  else if (dosRieles) riel = 'DOBLE';

  // Hojas que CIERRAN: con la central fija, cierran las 2 laterales contra ella.
  const activos = (mandaFija && Number(hojas) === 3) ? 2 : undefined;
  return { riel, activos, centralFija: mandaFija, ambiguo: false, motivo: undefined };
}

/**
 * 🏭 ES UN MONORRIEL? = UNA hoja movil + UN paño FIJO, en UN marco.
 *
 * HECHO DEL NEGOCIO (dueño, textual 2026-09-18): *"una corredera un hoja paño fijo es andes
 * monorriel"*. Ya estaba escrito en el mallado desde el 11-sep y no se consulto:
 *   DIBUJO-VENTANAS-ACTIVA.md:57  "Monorriel = 1 hoja movil + 1 paño FIJO, en UN marco."
 *   DIBUJO-VENTANAS-ACTIVA.md:65  "'Mitad fija mitad corredera' = monorriel = ANDES."
 * Lo dice el listado de materiales de Winart del monorriel ANDES (v69117): UN marco
 * (PI-SLA-MMC), UNA hoja corredera (PI-SLA-A66), UN traslapo, UNA manilla.
 *
 * POR QUE VIVE ACA Y NO SOLO EN EL DIBUJO: el monorriel es linea ANDES, y `ANDES_AUTO_COTIZA`
 * esta en false ⇒ va a Marcelo. Pero la rama ANDES solo se activaba con la palabra "andes", y
 * el cliente NUNCA la escribe: describe la FORMA ("corredera con un paño fijo"). Resultado
 * medido: se cotizaba como ventana FIJA (producto equivocado) y, tras el fix de apertura del
 * 18-sep, habria pasado a SLIDING 2 hojas doble riel — otro producto equivocado, y encima
 * SLIDING no tiene monorriel (el motor responde `monorriel_no_disponible_en_sliding`).
 *
 * ⚠️ LA FRONTERA, Y ES DE PLATA: monorriel = UNA hoja MOVIL. La corredera de 3 hojas con la
 * central fija tiene DOS moviles ⇒ NO es monorriel, es SLIDING doble riel, y esa SI esta
 * calibrada contra Winart (v69621). Mandarla a escalar seria apagar la ventana que el dueño
 * acaba de pedir que se cotice.
 *
 * Hermano de `esMonorriel()` en services/dibujoVentana.js, que resuelve lo mismo para el DIBUJO
 * pero solo mira el label del item ya cotizado. Este mira el pedido del cliente.
 */
export function esMonorrielPorForma(texto) {
  const t = String(texto || "").normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Negacion: "que NO sea monorriel" no es monorriel (mismo criterio que la rama ANDES).
  if (/\b(?:no|sin|que\s+no)\s+(?:sea\s+|es\s+)?(?:monorriel|mono\s*-?\s*riel|un\s*riel)\b/.test(t)) return false;
  // La PALABRA es inequivoca: si el cliente dice "monorriel", es monorriel y no hay que contar.
  if (/\bmono\s*-?\s*r?riel\b/.test(t)) return true;
  // ⚠️ [Codex, compuerta] ACA ESTABA EL BLOCKER: las señales de forma hacian `return true` ANTES
  // de contar, asi que un label como "Corredera 3 hojas (1 fija + 2 correderas)" apagaba la
  // ventana de 3 hojas que el dueño acaba de pedir que se cotice. Textual de Codex: *"el
  // comentario afirma que la cantidad de hojas decide, pero el flujo ejecutable dice lo
  // contrario"*. Tenia razon. Ahora el conteo manda sobre TODAS las señales de forma.
  const _fijaMasCorredera =
    /\bfij[ao][^+]{0,14}[+y][^+]{0,14}corred/.test(t)
    || /\bcorred[^+]{0,14}[+y][^+]{0,14}fij[ao]/.test(t)
    || /\bmitad\s+fij[ao][\s\S]{0,24}mitad\s+corred/.test(t)
    || /\bmitad\s+corred[\s\S]{0,24}mitad\s+fij[ao]/.test(t);
  // La corredera puede venir nombrada o dicha con VERBO ("una corre y la otra queda fija"),
  // que es como habla el cliente de verdad. Lo pidio Codex y es correcto.
  const _corrPorForma = /corredera|corrediz|sliding|deslizan/.test(t)
    || /\b(?:corre|corren|corran)\b/.test(t);
  const _hayFija =
    /\b(?:hojas?|pa[nñ]os?|una|uno|1|lado|lateral(?:es)?|derech[ao]|izquierd[ao]|otra|otro)\b[^.]{0,20}\b(?:fij[ao]s?|no\s+abre)\b/.test(t)
    || /\bfij[ao]s?\b[^.]{0,14}\b(?:hojas?|pa[nñ]os?|lateral(?:es)?)\b/.test(t);
  if (!_fijaMasCorredera && !(_corrPorForma && _hayFija)) return false;
  // 🔴 EL CONTEO DECIDE, Y ES DE PLATA. `detectHojas` cuenta hojas TOTALES (en "corredera 3
  // hojas la del medio fija" devuelve 3, de las cuales 2 son moviles). Con 3 o mas paños quedan
  // 2+ moviles: eso es SLIDING doble riel, calibrado contra Winart v69621, y NO se escala.
  // Sin conteo declarado, una corredera con un paño fijo son 2 paños = 1 sola movil.
  const n = detectHojas(t);
  return n === undefined || n <= 2;
}

/**
 * [Codex/Gemini 4a vuelta] ¿El texto trae ALGÚN indicio de un nº de hojas que detectHojas podría
 * no resolver limpio? Dígito o palabra pegada a "hoja" AUNQUE el separador no sea espacio
 * ("3-hojas", "hojas: 3"), doble/triple/cuádruple, o una corrección ("sino"). Se usa en el envelope
 * Andes: si hay mención pero no se confirma 2, se escala (anti-subcobro), en vez de perseguir frases.
 */
export function mencionaConteoHojas(texto) {
  const t = String(texto || "").toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const NUMS = '(?:\\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doble|triple|cuadruple|multiple)';
  // [Gemini 5ª/6ª vuelta] El sustantivo cubre TODO el vocabulario chileno de "sección de ventana"
  // + el typo común "oja" (hoja sin h). hoja · paño · cuerpo · sección · división · tramo · módulo.
  // NO se incluye "riel/carril" a propósito: "doble riel" es la descripción del config VÁLIDO.
  const NOUN = '(?:hojas?|panos?|ojas?|cuerpos?|secciones?|seccion|divisiones?|division|tramos?|modulos?)';
  // [Gemini 7ª vuelta] Entre el número y el sustantivo puede haber adjetivos ("3 grandes hojas",
  // "tres amplias secciones"): se permiten hasta 3 palabras intermedias. El límite de 3 evita ligar
  // números lejanos no relacionados ("3 dormitorios con ventana de 2 hojas" NO liga el 3 con hojas).
  const GAP = '(?:[\\s\\-–—,]+(?:\\w+[\\s\\-–—,]+){0,3})?';
  return new RegExp(`\\b${NUMS}\\b${GAP}${NOUN}\\b`).test(t)
      || new RegExp(`\\b${NOUN}${GAP}${NUMS}\\b`).test(t)
      || /\b(?:triple|cuadruple)\b/.test(t)
      || /\bsino\b/.test(t);
}

/**
 * Réplica local de normColor (index.js) — NO exportada desde index.
 * Catálogo: BLANCO | NOGAL | GRAFITO | NEWBLACK.
 */
function normColorLocal(text) {
  if (!text) return "BLANCO";
  const t = String(text).toLowerCase().trim();
  if (t.includes("blanco") || t.includes("white")) return "BLANCO";
  if (t.includes("nogal") || t.includes("roble") || t.includes("madera") || t.includes("dorado")) return "NOGAL";
  if (t.includes("grafito") || t.includes("antracita") || t.includes("gris") || t.includes("plomo")) return "GRAFITO";
  if (t.includes("negro") || t.includes("black") || t.includes("new black") || t.includes("newblack")) return "NEWBLACK";
  return "BLANCO";
}

/**
 * Réplica local de normMeasures (index.js) — NO exportada desde index.
 * Devuelve { ancho_mm, alto_mm } o null.
 */
export function normMeasuresLocal(raw) { // [LOTE2] export para test del sufijo mm (antes solo interna)
  const s = String(raw || "");

  // [2026-07-06 LOTE2] Formato INTERNO "AxBmm" (enteros pegados, sin espacios) = medidas YA resueltas
  // por calcular_cotizacion (incluida la confirmación de unidad del cliente) → tomar LITERAL, sin
  // heurísticas. Sin esto, este re-parseo re-manglaba lo ya confirmado (350x600 confirmado → ×10 →
  // 3500x600, caso real proyectante de baño 2026-07-06). El anclaje ^$ ESTRICTO evita falsos positivos
  // con texto de clientes ("140x100 mm" con espacio o "1,40x1,00 mm" con decimales → heurística, como
  // siempre). Bounds [50,6000] = defensa en profundidad (escéptico L2); validate/clamps deciden el resto.
  const mmExplicit = s.match(/^\s*(\d+)x(\d+)mm\s*$/i);
  if (mmExplicit) {
    const a = Number(mmExplicit[1]);
    const b = Number(mmExplicit[2]);
    if (a >= 50 && a <= 6000 && b >= 50 && b <= 6000) return { ancho_mm: a, alto_mm: b };
  }

  const dimMatch =
    s.match(/(\d+([.,]\d+)?)\s*[x×X]\s*(\d+([.,]\d+)?)/) ||
    s.match(/(\d+([.,]\d+)?)\s+por\s+(\d+([.,]\d+)?)/i);

  if (dimMatch) {
    let a = parseFloat(dimMatch[1].replace(",", "."));
    let b = parseFloat(dimMatch[3].replace(",", "."));
    if (a <= 6) a *= 1000;
    if (b <= 6) b *= 1000;
    if (a >= 7 && a < 400) a *= 10;   // [FIX 2026-06-18] cm→mm hasta <400 (antes <=300, sub-cotizaba grandes)
    if (b >= 7 && b < 400) b *= 10;
    return { ancho_mm: Math.round(a), alto_mm: Math.round(b) };
  }

  const nums = s.match(/(\d+([.,]\d+)?)/g);
  if (!nums || nums.length < 2) return null;

  const allNums = nums.map((n) => parseFloat(n.replace(",", ".")));
  const candidates = allNums.filter((n) => {
    if (n > 20) return true;
    if (!Number.isInteger(n) && n > 0) return true;
    return false;
  });

  if (candidates.length < 2) {
    const sorted = [...allNums].sort((a, b) => b - a);
    if (sorted.length < 2) return null;
    candidates.length = 0;
    candidates.push(sorted[0], sorted[1]);
  }

  let a = candidates[0];
  let b = candidates[1];
  if (a <= 6) a *= 1000;
  if (b <= 6) b *= 1000;
  if (a >= 7 && a < 400) a *= 10;   // [FIX 2026-06-19 COB-01] fallback faltaba: cm→mm hasta <400 (el replace_all del 18-jun no lo agarró por indentación)
  if (b >= 7 && b < 400) b *= 10;
  return { ancho_mm: Math.round(a), alto_mm: Math.round(b) };
}

export const FABRICATION_LIMITS = {
  S60: {
    ventana: { minAncho: 400, maxAncho: 1930, minAlto: 400, maxAlto: 1930 },
    puerta: { minAncho: 800, maxAncho: 1970, minAlto: 1500, maxAlto: 2400 },
  },
  SLIDING: {
    H98: { minAncho: 500, maxAncho: 2930, minAlto: 500, maxAlto: 2150 },
    H80: { minAncho: 500, maxAncho: 3000, minAlto: 500, maxAlto: 2150 },
  },
};

/**
 * Réplica local de validateDimensions (index.js) — NO exportada desde index.
 * Devuelve null si OK, o { message, escalate, suggest? } si excede.
 */
/**
 * ¿La compuesta va APILADA (proyectante arriba + fijo abajo) en vez de lado a lado?
 *
 * [2026-08-25] Pedida por el dueño. Se detecta por como habla el cliente: "arriba/abajo",
 * "encima", "superior/inferior". Sin ninguna de esas señales se asume HORIZONTAL, que es la
 * que mas se vende y la que ya estaba calibrada — asi ninguna conversacion vieja cambia.
 *
 * ⚠️ NO alcanza con que el texto diga "arriba": "la ventana de arriba del living" es una
 * UBICACION, no una composicion. Por eso se exige que el arriba/abajo aparezca pegado a un
 * tipo de paño ("proyectante arriba", "arriba la proyectante").
 */
export function esCompuestaVertical(texto) {
  const t = String(texto || "").toLowerCase();
  // 🔴 [2026-08-26] AGUANTA COMO ESCRIBE LA GENTE, NO COMO LO ESCRIBE EL DICCIONARIO.
  // Caso real y medido: Paula escribio, DOS VECES, *"MITAD PROYECTACTE SUPERIOR MITAD FIJA
  // INFERIR"*. Falta una N en "proyectante" y la R final de "inferior" — y con eso el
  // detector no reconocia la ventana vertical, la cotizaba horizontal, el alto se pasaba del
  // maximo y las 3 ventanas terminaban escaladas a Marcelo con un aviso de PROPUESTA PARCIAL.
  // Un cliente por WhatsApp escribe con una mano y sin corregir: exigirle la ortografia
  // exacta es exigirle que use nuestro vocabulario.
  //
  // ⚠️ `proyect\w*` matchea tambien "proyecto", que en este rubro es una palabra COMUN ("el
  // proyecto de la casa"). Se excluye explicitamente: sin ese lookahead, "el proyecto de
  // arriba" se leeria como una ventana vertical.
  const TIPO = "(?:fij[ao]s?|proyect(?!os?" + String.fromCharCode(92) + "b)" + String.fromCharCode(92) + "w*|abatib" + String.fromCharCode(92) + "w*|oscilobat" + String.fromCharCode(92) + "w*)";
  const POS = "(?:arriba|abajo|encima|superi" + String.fromCharCode(92) + "w*|inferi" + String.fromCharCode(92) + "w*)";
  return (
    new RegExp(`\\b${TIPO}\\s{1,3}(?:(?:la|el|un[ao]?|los|las|de|del|en|por|va|ir[ao]|queda|ponemos?|pongo)\\s{1,3}){0,2}${POS}\\b`).test(t) ||
    new RegExp(`\\b${POS}\\s{1,3}(?:(?:la|el|un[ao]?|los|las|de|del|en|por|va|ir[ao]|queda|ponemos?|pongo)\\s{1,3}){0,2}${TIPO}\\b`).test(t) ||
    new RegExp(`\\b(?:apilad[ao]s?|vertical(?:es|mente)?)\\b`).test(t) ||
    new RegExp(`\\buna\\s+(?:encima|sobre)\\s+(?:de\\s+)?(?:la\\s+)?otra\\b`).test(t)
  );
}

export function validateDimensionsLocal(product, ancho_mm, alto_mm) {
  const p = String(product || "").toUpperCase();

  if (p.includes("CORREDERA")) {
    const lim = FABRICATION_LIMITS.SLIDING.H98;
    if (ancho_mm > lim.maxAncho || alto_mm > lim.maxAlto) {
      // [2026-06-10 FIX #C/GT-06] ANTES escalate:true → grand_total=null → PDF NUNCA salía aunque
      // el cliente confirmara (correderas piso-cielo >2150mm son comunísimas; caso Dalia).
      //
      // 🔴 [2026-08-25] EL CLAMP DEL PRECIO SE ELIMINO — cobraba de menos, mucho y en silencio.
      // "Las grandes cotizarlas igual, solo avisar" (el dueño, caso Dalia) se habia implementado
      // como "cobrarlas COMO SI midieran el maximo estandar": una corredera de 5560×2160 roble
      // se cotizo como si midiera 2930×2150 → salio ~$930 mil cuando el motor con las medidas
      // REALES da $1.343.048 (caso Martin, CM-FR-004-2026-0341: $413 mil de menos en UNA
      // ventana). Reclamo del dueño, textual: *"no se esta cobrando el real de la corredera
      // desde cierto tamaño hacia arriba… cotizar en 2 hojas como se hizo PERO A UN PRECIO
      // REAL"*. El motor escala bien con las medidas reales (medido 2000→6000 mm): se le mandan
      // TAL CUAL, y el aviso referencial (visita tecnica) se mantiene.
      return {
        message: `La corredera de ${ancho_mm}×${alto_mm} mm supera el máximo estándar (${lim.maxAncho}×${lim.maxAlto} mm); precio referencial sujeto a confirmación en la visita técnica.`,
        referencial: true,
        // [Codex 2a pasada] Una medida MIXTA (5560×400: ancho gigante, alto enano) entraba
        // por esta rama y el return temprano se saltaba el clamp-UP del minimo. El minimo
        // viaja junto: fabricar bajo el minimo cuesta lo del minimo, tambien en las mixtas.
        clampMinAncho: ancho_mm < lim.minAncho ? lim.minAncho : 0,
        clampMinAlto: alto_mm < lim.minAlto ? lim.minAlto : 0,
      };
    }
    // [2026-07-06 LOTE2] Bajo el mínimo → REFERENCIAL clamp-UP (pedido del dueño: cotizar igual por
    // tamaño/materiales; fabricar bajo el mínimo cuesta lo mismo que el mínimo). NUNCA escalate (GT-06).
    if (ancho_mm < lim.minAncho || alto_mm < lim.minAlto) {
      return {
        message: `La corredera de ${ancho_mm}×${alto_mm} mm está bajo el mínimo estándar (${lim.minAncho}×${lim.minAlto} mm); precio referencial del mínimo de fabricación.`,
        referencial: true,
        clampMinAncho: ancho_mm < lim.minAncho ? lim.minAncho : 0,
        clampMinAlto: alto_mm < lim.minAlto ? lim.minAlto : 0,
      };
    }
    return null;
  }

  if (p.includes("PUERTA")) {
    const lim = FABRICATION_LIMITS.S60.puerta;
    if (ancho_mm > lim.maxAncho || alto_mm > lim.maxAlto) {
      // [2026-08-25] Mismo defecto y mismo arreglo que la corredera de arriba: el clamp del
      // precio cobraba una puerta gigante como si midiera 1970×2400. Aviso si, clamp no.
      return {
        message: `La puerta de ${ancho_mm}×${alto_mm} mm supera el máximo estándar (${lim.maxAncho}×${lim.maxAlto} mm); precio referencial sujeto a confirmación en la visita técnica.`,
        referencial: true,
        clampMinAncho: ancho_mm < lim.minAncho ? lim.minAncho : 0,
        clampMinAlto: alto_mm < lim.minAlto ? lim.minAlto : 0,
      };
    }
    // [2026-07-06 LOTE2] Puerta bajo mínimo (800×1500): mismo criterio referencial clamp-up. El PDF
    // muestra la medida pedida (measures_original) y el precio referencial se valida en visita técnica.
    if (ancho_mm < lim.minAncho || alto_mm < lim.minAlto) {
      return {
        message: `La puerta de ${ancho_mm}×${alto_mm} mm está bajo el mínimo estándar (${lim.minAncho}×${lim.minAlto} mm); precio referencial del mínimo de fabricación.`,
        referencial: true,
        clampMinAncho: ancho_mm < lim.minAncho ? lim.minAncho : 0,
        clampMinAlto: alto_mm < lim.minAlto ? lim.minAlto : 0,
      };
    }
    return null;
  }

  // 🔴 [2026-08-25 · Codex] LA COMPUESTA TIENE SUS PROPIOS LIMITES. Sin esta rama caia al
  // branch de ventana S60 (max 1930 de ancho) y el resultado era absurdo: la Pos.1 del dueño
  // (2002 mm) recibia "sugerencia: ventana corredera", y la Pos.2 (3250 mm) ESCALABA y no se
  // cotizaba nunca. El ancho de una compuesta es la SUMA de sus paños: lo que tiene que caber
  // en el limite es CADA PAÑO, y de eso ya se encarga el motor (calculateCompuestaQuote valida
  // paño por paño y rechaza con su motivo). Aca solo se valida el ALTO, comun a todos los paños.
  if (p.includes("COMPUESTA")) {
    // 🔃 [2026-08-25] EN VERTICAL EL EJE COMUN ES EL OTRO. Los paños se apilan: el motor
    // reparte el ALTO y lo que comparten todos pasa a ser el ANCHO. Validar el alto aca
    // rechazaria la ventana del dueño (1200x2002: el total supera el maximo de un paño S60,
    // pero ningun paño mide eso — miden 1000 cada uno y entran de sobra).
    if (esCompuestaVertical(product)) {
      const limV = FABRICATION_LIMITS.S60.ventana;
      if (ancho_mm > limV.maxAncho) {
        return {
          message: `La ventana compuesta de ${ancho_mm} mm de ancho supera el máximo estándar (${limV.maxAncho} mm); precio referencial sujeto a confirmación en la visita técnica.`,
          referencial: true,
        };
      }
      return null;   // el alto lo valida el motor, paño por paño
    }
    const limC = FABRICATION_LIMITS.S60.ventana;
    if (alto_mm > limC.maxAlto) {
      return {
        message: `La ventana compuesta de ${alto_mm} mm de alto supera el máximo estándar (${limC.maxAlto} mm); precio referencial sujeto a confirmación en la visita técnica.`,
        referencial: true,
      };
    }
    if (alto_mm < limC.minAlto) {
      return {
        message: `La ventana compuesta de ${alto_mm} mm de alto está bajo el mínimo estándar (${limC.minAlto} mm); precio referencial del mínimo de fabricación.`,
        referencial: true, clampMinAlto: limC.minAlto,
      };
    }
    return null;   // el ancho lo valida el motor, paño por paño
  }

  const lim = FABRICATION_LIMITS.S60.ventana;
  if (ancho_mm > lim.maxAncho || alto_mm > lim.maxAlto) {
    const slidingLim = FABRICATION_LIMITS.SLIDING.H98;
    if (ancho_mm <= slidingLim.maxAncho && alto_mm <= slidingLim.maxAlto) {
      return {
        message: `Medida ${ancho_mm}×${alto_mm} excede límite S60 (máx ${lim.maxAncho}×${lim.maxAlto}). Sugerencia: ventana corredera.`,
        suggest: "CORREDERA",
        escalate: false,
      };
    }
    return {
      message: `Medida ${ancho_mm}×${alto_mm} excede todos los límites de fabricación.`,
      escalate: true,
    };
  }
  // [2026-07-06 LOTE2] Ventana bajo el mínimo S60 (400×400) → REFERENCIAL clamp-UP y COTIZAR (caso real:
  // proyectante de baño 350×600 confirmada en mm era RECHAZADA; el dueño ordenó cotizar igual el valor
  // que corresponde por materiales = el del mínimo de fabricación). NUNCA escalate (regresión GT-06).
  if (ancho_mm < lim.minAncho || alto_mm < lim.minAlto) {
    return {
      message: `La ventana de ${ancho_mm}×${alto_mm} mm está bajo el mínimo estándar (${lim.minAncho}×${lim.minAlto} mm); precio referencial del mínimo de fabricación.`,
      referencial: true,
      clampMinAncho: ancho_mm < lim.minAncho ? lim.minAncho : 0,
      clampMinAlto: alto_mm < lim.minAlto ? lim.minAlto : 0,
    };
  }
  return null;
}

/**
 * Cotiza todos los items vía ACTIVA Engine.
 * Mismo contrato de retorno que priceAll de index.js.
 *
 * @param {object} d - sesión { items, comuna, default_color, ... }
 * @param {string} [customer_id]
 * @returns {Promise<{ok:boolean,total?:number,source?:string,escalate:boolean,reason?:string,error?:string,partial?:boolean}>}
 */
/**
 * ¿El cliente DIJO en que orden manda las medidas?
 *
 * 🔴 [2026-08-26] NACIO DE UN ERROR QUE LE COSTO PLATA AL DUEÑO. Paula escribio, textual:
 * *"LAS MEDIDAS ESTAN ALTO POR ANCHO — 1 DE 220 x 200 CORREDERA..."* y se le cotizo al
 * reves: 2200 de ancho x 2000 de alto, cuando pedia 2000 de ancho x 2200 de alto. Una
 * corredera con esas dos medidas cambiadas NO vale lo mismo ni se fabrica igual.
 *
 * La regla que habia deducia la orientacion por FISICA: si algun alto pasaba los 2400 mm,
 * la tabla venia al reves. Con 2200 de maximo nunca se disparo. La deduccion es un buen
 * respaldo, pero cuando el cliente lo dice con todas las letras, **lo que dice manda**.
 *
 * @returns {'alto_ancho'|'ancho_alto'|null}
 */
export function orientacionDeclarada(texto) {
  const t = String(texto || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");   // "están" y "estan" son lo mismo
  const SEP = "(?:por|x|\\*|/|,|-)";
  // [Gemini] "altura/anchura" es igual de comun que "alto/ancho" al dictar medidas.
  const ALTO = "alt(?:o|ura)";
  const ANCHO = "anch(?:o|as|ura)";
  if (new RegExp(`\\b${ALTO}\\s*${SEP}\\s*${ANCHO}\\b`).test(t)) return "alto_ancho";
  if (new RegExp(`\\b${ANCHO}\\s*${SEP}\\s*${ALTO}\\b`).test(t)) return "ancho_alto";
  // "primero el alto" / "el alto va primero" / "empiezan por el alto"
  if (new RegExp(`\\b(?:primero|empiezan?\\s+(?:por|con)|va\\s+primero)\\s+(?:el\\s+)?alto\\b`).test(t)
   || new RegExp(`\\balto\\s+(?:va|viene|esta)\\s+primero\\b`).test(t)) return "alto_ancho";
  if (new RegExp(`\\b(?:primero|empiezan?\\s+(?:por|con)|va\\s+primero)\\s+(?:el\\s+)?ancho\\b`).test(t)
   || new RegExp(`\\bancho\\s+(?:va|viene|esta)\\s+primero\\b`).test(t)) return "ancho_alto";
  return null;
}

/**
 * Los pares ancho|alto que el cliente ESCRIBIO en su texto, normalizados, para resolver el
 * swap alto/ancho POR PAR (y no con un volteo global que revierte lo ya corregido).
 *
 * 🔴 [2026-08-26 · Codex NO-APTO, defecto 3] El regex original exigia el separador PEGADO al
 * numero: "2200 mm x 2000 mm" no matcheaba NADA, el set quedaba vacio y el fallback global
 * re-invertia una medida ya corregida — exactamente lo que este mecanismo vino a impedir, y
 * los clientes escriben la unidad todo el tiempo. Ahora tolera mm/cm/m/mt/metros (con o sin
 * punto) entre el numero y el separador.
 */
export function paresDeclaradosEnTexto(texto) {
  const pares = new Set();
  const re = /(\d+(?:[.,]\d+)?)\s*(?:mm|cms?|mts?|metros?|m)?\.?\s*(?:[x×]|por)\s*(\d+(?:[.,]\d+)?)/gi;
  for (const m of String(texto || "").matchAll(re)) {
    const nm = normMeasuresLocal(`${m[1]}x${m[2]}`);
    if (nm) pares.add(`${Math.round(nm.ancho_mm)}|${Math.round(nm.alto_mm)}`);
  }
  return pares;
}

export async function priceAllEngine(d, customer_id = "") {
  if (!d || !Array.isArray(d.items) || d.items.length === 0) {
    return { ok: false, error: "No hay items para cotizar.", escalate: false };
  }

  let grandTotal = 0;
  let escaladas = 0;

  // ── PRE-PASS: orientación GLOBAL de las medidas (regla del dueño 2026-06-06) ──
  // El cliente manda TODA la lista en el MISMO orden (alto×ancho o ancho×alto), no mezclado.
  // Regla física: el ALTO de una ventana ≤ ~2400 mm (techo piso-cielo 2,4 m). Si CUALQUIER
  // item quedó con alto > 2400 mm, TODA la tabla vino alto×ancho → se intercambia ANCHO/ALTO
  // en TODOS los items (consistente, no solo en algunos). Así "210/270, 150/185, 50/190..."
  // se corrige completa (V16 50/190 → ancho 1900/alto 500), no solo las grandes.
  const measured = d.items.map((it) => normMeasuresLocal(it.measures || ""));
  // 🔴 [2026-08-26] LO QUE EL CLIENTE DICE MANDA SOBRE LO QUE NOSOTROS DEDUCIMOS.
  // La regla de los 2400 mm es una DEDUCCION (ninguna ventana es mas alta que el techo), y
  // como toda deduccion falla en los casos que no previo: con la lista de Paula, cuyo maximo
  // era 2200, no se disparo — y ella habia escrito "ESTAN ALTO POR ANCHO". Se le cotizaron
  // las ventanas dadas vuelta. Ahora la frase del cliente decide, y la fisica queda de
  // respaldo para cuando no dice nada.
  const _declarado = orientacionDeclarada([
    d.texto_cliente,
    ...d.items.map((it) => [it.descripcion, it.product, it.ambiente].filter(Boolean).join(" ")),
  ].filter(Boolean).join(" \n "));
  const tableIsAltoAncho = _declarado
    ? _declarado === "alto_ancho"
    : measured.some((mm) => mm && mm.alto_mm > 2400);
  if (_declarado) d.orientacion_declarada = _declarado;   // para el aviso al cliente

  // 🔴 [2026-08-26] EL DOBLE-SWAP MUERE ACA. El riesgo era conocido y HOY se midio: si el
  // LLM ya manda la medida CORREGIDA (2000x2200) y el texto del cliente declara "alto por
  // ancho", el swap global la daba vuelta DE NUEVO — una medida correcta terminaba invertida
  // en el PDF. La declaracion habla de COMO ESCRIBIO EL CLIENTE, no de como vienen los items.
  //
  // La resolucion es POR PAR, contra lo que el cliente escribio de verdad:
  //   · el par del item aparece en el texto EN ESE ORDEN  → viene crudo → se da vuelta;
  //   · aparece en el orden INVERSO                        → ya fue corregido → NO se toca;
  //   · no aparece (o aparece en ambos)                    → manda la declaracion global.
  const _paresTexto = paresDeclaradosEnTexto(d.texto_cliente);
  if (tableIsAltoAncho) {
    for (const mm of measured) {
      if (!mm) continue;
      const crudo = `${Math.round(mm.ancho_mm)}|${Math.round(mm.alto_mm)}`;
      const inverso = `${Math.round(mm.alto_mm)}|${Math.round(mm.ancho_mm)}`;
      const talCual = _paresTexto.has(crudo);
      const yaCorregido = _paresTexto.has(inverso) && !talCual;
      if (yaCorregido) continue;                      // el LLM ya lo dio vuelta: no tocar
      const _t = mm.ancho_mm; mm.ancho_mm = mm.alto_mm; mm.alto_mm = _t;
    }
  }

  // [2026-06-10] FIX pedidos grandes (18 ventanas): cotizar cada ítem es INDEPENDIENTE y
  // TOLERANTE a fallo. ANTES: si UN ítem fallaba (timeout/engine/total inválido) se hacía
  // `return` y se perdía TODA la cotización. AHORA: un ítem que falla se marca como escalada
  // y NO mata al resto. Además se cotiza con CONCURRENCIA ACOTADA (lotes) para no encadenar
  // 18 latencias en serie. La reducción (suma) se hace después, secuencial → sin race.
  const priceOneItem = async (i) => {
    const item = d.items[i];

    // 0) Alcance real del catálogo automático. Esta guarda corre ANTES de
    // normalizar apertura, validar medidas o llamar al Engine: nunca convierte
    // silenciosamente un producto desconocido en una ventana CORREDERA.
    // [Ronda 2 2026-07-20] item.descripcion = palabras LITERALES del cliente (llegan del
    // tool vía descripcion_producto). Sin esto la guarda solo veía el enum ya colapsado
    // (CORREDERA/...) y era inalcanzable para mosquitero/plegable/forma irregular/líneas
    // en el camino GPT (hallazgo confirmado por revisión cruzada Codex+workflow).
    const fueraDeAlcance = detectarProductoFueraDeAlcance(
      [item.product, item.descripcion].filter(Boolean).join(' '),
      { tipo: item.tipo, serie: item.serie }
    );
    if (fueraDeAlcance.fueraDeAlcance) {
      item.price_warning = fueraDeAlcance.mensajeCliente;
      item.source = "activa_engine";
      item.confidence = "manual";
      item.out_of_scope_category = fueraDeAlcance.categoria;
      return { escalada: true, fueraDeAlcance };
    }

    // 1) Medidas (normalizadas + orientación corregida en el pre-pass)
    const m = measured[i];
    if (tableIsAltoAncho && m) {
      // 🔴 [2026-08-26] LA MEDIDA CORREGIDA TIENE QUE QUEDAR EN EL ITEM, NO SOLO EN EL PRECIO.
      // Hasta hoy el pre-pass daba vuelta las medidas para COTIZAR pero dejaba `item.measures`
      // con el texto original del cliente. Resultado medido en la propuesta de Paula: se cobro
      // una ventana de 2000x2200 y el PDF le mostro 2200x2000. Es peor que cualquiera de los
      // dos errores por separado — si el cliente aprueba ESE PDF, fabrica construye la ventana
      // equivocada y el error se descubre instalando.
      // Se guarda tambien la original: el cliente escribio eso y tiene que poder rastrearse.
      // ⚠️ NO se usa `measures_original`: ese campo YA tiene otro dueño y otro significado —
      // la rama "referencial" (mas abajo) lo escribe con la medida PEDIDA antes del recorte, y
      // pisaria esto. Dos significados en un mismo campo es como se pierde un dato sin que
      // nadie se entere. Este tiene el suyo, con nombre que dice lo que es.
      item.measures_swapped = true;
      item.measures_texto_cliente = item.measures_texto_cliente || item.measures;
      item.measures = `${Math.round(m.ancho_mm)}x${Math.round(m.alto_mm)}`;
    }
    if (!m) {
      item.price_warning = "No pude normalizar medidas para el cotizador.";
      item.source = "activa_engine"; item.confidence = "manual";
      return { escalada: true };
    }

    // 2a) [Ronda 3.2 — Codex] Resolver el TIPO (con cinturón de descripción) ANTES de
    // validar medidas: una puerta 900x2200 con product=CORREDERA se clampaba al máximo
    // de VENTANA (2150) y después se cotizaba como PUERTA — límites equivocados.
    let tipo = mapAperturaToEngine(item.product);
    // Cinturón asimétrico LA DESCRIPCIÓN MANDA (solo hacia puerta): si el LLM contradijo
    // el prompt (tipo de ventana + descripción "puerta abatible"), se corrige al BOM de
    // puerta. Nunca al revés (normTipoAperturaLocal ya trae negación + sustantivo-primero
    // + regla "por X" + deslizantes).
    if (item.descripcion && !String(tipo).startsWith("PUERTA")) {
      try {
        const tipoDesc = mapAperturaToEngine(item.descripcion);
        if (String(tipoDesc).startsWith("PUERTA")) tipo = tipoDesc;
      } catch { /* descripción fuera de alcance: la guarda del paso 0 ya la habría cazado */ }
    }

    // 2) Validación de fabricación (igual que priceAll → marca y escala) — con el TIPO
    // resuelto, no con el texto crudo (límites de puerta ≠ límites de ventana).
    // 🔴 [2026-08-26] LA VALIDACION TIENE QUE VER EL MISMO TEXTO QUE EL DETECTOR. Recibia
    // solo `tipo` ("COMPUESTA"), donde las palabras "superior/inferior" no aparecen: creia
    // que la ventana era horizontal, validaba el ALTO contra el maximo de un paño S60 y
    // marcaba REFERENCIAL una compuesta vertical perfectamente fabricable. Con el texto del
    // cliente al lado, la rama vertical se activa y valida el eje correcto.
    // 🔴 [2026-08-26] Y SI EL ITEM NO TRAE LA SEÑAL, SE MIRA LO QUE ESCRIBIO EL CLIENTE.
    // Medido en la propuesta 0354: las tres compuestas salieron `referencial: true` porque
    // aca solo llegaba el tipo ("COMPUESTA") — las palabras "superior/inferior" viven en el
    // mensaje de la clienta, no en el item. El validador creia horizontal, comparaba el ALTO
    // contra el maximo de un paño y marcaba fuera de estandar una ventana fabricable.
    // El texto del ITEM manda; el del cliente es el respaldo. ⚠️ Es un texto de la LISTA
    // completa: si un pedido mezclara una compuesta horizontal con una vertical, las dos se
    // leerian iguales. Hoy no pasa (o son todas o ninguna) y solo afecta a las COMPUESTAS.
    const _textoParaEje = `${tipo} ${item.descripcion || ""} ${item.product || ""}`;
    const dim = validateDimensionsLocal(
      esCompuestaVertical(_textoParaEje) ? _textoParaEje : `${_textoParaEje} ${d.texto_cliente || ""}`,
      m.ancho_mm, m.alto_mm);
    if (dim && dim.escalate) {
      item.price_warning = dim.message;
      item.source = "activa_engine"; item.confidence = "manual";
      return { escalada: true };
    }
    // [2026-06-10 FIX #C/GT-06] Fuera de rango pero REFERENCIAL: acotar al máx y COTIZAR (no escalar)
    // → grand_total tiene valor → el PDF SÍ sale (antes: escalate → null → sin PDF). Marcelo valida la medida exacta.
    if (dim && dim.referencial) {
      item.referencial = true;
      item.measures_original = `${m.ancho_mm}x${m.alto_mm}`;
      item.price_warning = dim.message;
      // Acotar SOLO la dimensión que excede (Math.min) — no sobre-cotizar la que sí cabe.
      // [2026-08-25] Los clamp de MAXIMO ya no existen (cobraban de menos en silencio — caso
      // Martin 0341). Los de MINIMO quedan: fabricar bajo el minimo cuesta lo del minimo.
      // [2026-07-06 LOTE2] Bajo mínimo → clamp-UP solo en la dimensión que falta (precio del mínimo).
      if (dim.clampMinAncho) m.ancho_mm = Math.max(m.ancho_mm, dim.clampMinAncho);
      if (dim.clampMinAlto)  m.alto_mm  = Math.max(m.alto_mm,  dim.clampMinAlto);
    }

    // 3) Serie de perfiles + nº hojas (el tipo ya quedó resuelto en 2a)
    let serie = mapSerieToEngine(tipo);     // CORREDERA→SLIDING, resto→S60
    // [2026-08-27] LINEA AMERICANA con tope de tamaño. Se decide sobre CUALQUIER apertura
    // detectada como americana: si no es una corredera dentro del tope, se ESCALA — NO se
    // cotiza como otra línea. (Antes una "proyectante americana" caía a S60: producto
    // equivocado; lo cazó la compuerta cruzada.)
    if (esLineaAmericana(item)) {
      if (tipo === "CORREDERA" && m.ancho_mm <= AMERICANA_MAX_MM && m.alto_mm <= AMERICANA_MAX_MM) {
        serie = "AMERICANA";
      } else {
        const razon = tipo !== "CORREDERA"
          ? `La línea Americana solo tiene corredera; una "${tipo}" americana no existe en catálogo.`
          : `Ventana Americana ${m.ancho_mm}×${m.alto_mm} mm supera el máximo cotizable automático (${AMERICANA_MAX_MM} mm por lado).`;
        item.price_warning = `${razon} La revisa Marcelo para darte el precio exacto.`;
        item.source = "activa_engine"; item.confidence = "manual"; item.fuera_de_alcance = true;
        return { escalada: true };
      }
    }
    // 🏭 [2026-09-18] MONORRIEL = ANDES, Y ANDES LO COTIZA MARCELO.
    // Hecho del negocio (dueño, textual): *"una corredera un hoja paño fijo es andes
    // monorriel"*. Ya estaba en DIBUJO-VENTANAS-ACTIVA.md desde el 11-sep.
    // La rama ANDES de abajo solo se activa con la PALABRA "andes", y el cliente nunca la
    // escribe: describe la FORMA. Por eso una "corredera con un paño fijo" se colaba —antes
    // como ventana FIJA, y tras el fix de apertura del 18-sep habria pasado a SLIDING de 2
    // hojas doble riel: otro producto equivocado, y encima SLIDING no tiene monorriel.
    // Se escala con el nombre del PRODUCTO, no de la linea: el cliente pidio "una corredera
    // con un paño fijo", no "una Andes", y no tiene por que aprender nuestro catalogo.
    // 🔴 SOLO EL TEXTO DEL ITEM. `d.texto_cliente` es el mensaje ENTERO del cliente: en una lista
    // de 17 ventanas, con que UNA fuera monorriel escalarian LAS 17. Es la misma trampa que ya
    // esta advertida arriba para `_textoParaEje`, y aca costaria el flujo completo. La copia
    // literal del pedido vive en `descripcion_producto` (asi lo exige el schema), que es de este
    // item y de ningun otro.
    // 🔴 [dueño, 2026-09-18, en produccion] LA AMERICANA ES LA EXCEPCION Y SE COTIZA.
    // Textual: *"conoce corredera una de las hojas fija, con eso es monorriel, A NO SER QUE
    // PIDA DIRECTAMENTE AMERICANA"*. La linea AMERICANA tambien es monorriel —es lo unico que
    // tiene— pero esa SI la cotiza el motor hasta 2,5 m por lado (calibrada contra Winart
    // v67152). Sin este `serie !== "AMERICANA"`, una americana descrita con su hoja fija
    // —que es como se describe NATURALMENTE— se escalaba a Marcelo pudiendo cotizarse sola.
    // Defecto que introduje yo el mismo dia y que llego a produccion.
    // Si la americana estaba FUERA del tope, el bloque de arriba ya retorno escalando.
    if (tipo === "CORREDERA" && serie !== "AMERICANA" && !ANDES_AUTO_COTIZA && esMonorrielPorForma(
      `${item.descripcion || ""} ${item.product || ""} ${item.label || ""} ${item.producto || ""}`)) {
      item.price_warning = "La corredera de una hoja con paño fijo (monorriel) la cotiza "
        + "Marcelo directamente para darte el precio exacto.";
      item.source = "activa_engine"; item.confidence = "manual"; item.fuera_de_alcance = true;
      return { escalada: true };
    }
    // [2026-08-27] LINEA ANDES: sólo el envelope CALIBRADO contra Winart (doble riel · 2 hojas ·
    // hoja 66, ≥3,5 m², ≤2,5 m/lado). Fuera de eso (hoja 54 chica, monorriel, 3-4 hojas, grande)
    // ESCALA: esos configs no están contrastados y podrían cobrar mal (decisión del dueño).
    // [Codex 2026-08-27] Se mira el texto del ITEM y el del CLIENTE. Mientras ANDES está apagado la
    // detección es AMPLIA (mencionaAndes: basta la palabra, salvo la comuna "Los Andes"): un
    // `descripcion_producto:"Andes"` a secas se colaba al motor como SLIDING — otra línea, producto
    // equivocado. Cuando se reabra con el campo estructurado, volver al criterio con contexto.
    const _txtAndes = `${item.descripcion || ""} | ${item.product || ""} | ${item.label || ""} | ${item.producto || ""} | ${d.texto_cliente || ""}`;
    if (esLineaAndes(item) || esLineaAndesTexto(d.texto_cliente || "")
        || (!ANDES_AUTO_COTIZA && mencionaAndes(_txtAndes))) {
      // [Codex 3a vuelta] Se leen los MISMOS campos que esLineaAndes (incluido item.producto en
      // español): si la ruta se activó por "línea Andes 3 hojas" en item.producto, ese "3 hojas"
      // tiene que contarse aquí también, o cotiza 3 como 2 (subcobro real que cazó Codex).
      const _txt = `${item.descripcion || ""} ${item.product || ""} ${item.label || ""} ${item.producto || ""} ${d.texto_cliente || ""}`;
      const _areaM2 = (m.ancho_mm / 1000) * (m.alto_mm / 1000);
      // [compuerta] nº de hojas y riel se leen de TODO el texto (incluido el del cliente): un
      // "3 hojas" ahí no puede terminar cotizado como 2 (subcobro real, lo cazó Codex).
      // [Codex/Gemini 4a vuelta] El envelope calibrado es de EXACTAMENTE 2 hojas. Regla robusta
      // anti-subcobro, en vez de perseguir cada frase: se cotiza SOLO si el texto confirma 2, o si
      // NO dice NADA del nº de hojas (default calibrado = 2). Cualquier mención que no resuelva
      // limpio a 2 — otro número, palabra ("tres"), guión ("3-hojas"), corrección/negación ("no de
      // dos hojas", "sino de 3") — ESCALA. Los revisores cazaron esas tres variantes, una por una.
      const _conteo = detectHojas(_txt);                      // dígito o palabra pegada a "hoja", o undefined
      const _mencionaHojas = mencionaConteoHojas(_txt);       // ¿hay ALGÚN indicio de un nº de hojas?
      const _negacionHojas = /\bno\s+(?:de\s+|es\s+|sea\s+|son\s+)?(?:\d+|un|uno|una|dos|tres|cuatro)\s*hojas?\b/i.test(_txt)
        || /\bsino\b/i.test(_txt);
      const _dosHojasOk = !_negacionHojas && (_conteo === 2 || (_conteo === undefined && !_mencionaHojas));
      // monorriel, salvo NEGACIÓN ("que NO sea monorriel"): no escalar algo que sí es cotizable.
      const _esMono = /\b(?:monorriel|mono\s*riel|un\s*riel)\b/i.test(_txt)
        && !/\b(?:no|sin|que\s+no)\s+(?:sea\s+|es\s+)?(?:monorriel|mono\s*riel|un\s*riel)\b/i.test(_txt);
      // hoja 54 (chica, sin calibrar): si el cliente la pide explícito, se escala (no se fuerza 66).
      const _pideHoja54 = /\bhoja\s*54\b|\bh\s*54\b|\b54\s*mm\b/i.test(_txt);
      // [Codex 6a/8a vuelta] Config COMPUESTO: el envelope válido es 2 hojas corredizas LIMPIAS y se
      // describe solo con "hojas"/"doble riel"/medidas. Cualquier otra palabra señala un 2+1, 3 paños,
      // triple riel, etc. — más perfiles que lo calibrado ⇒ subcobro. Se escala ante:
      //  · un sustantivo de sección distinto de "hoja" (paño/cuerpo/sección/división/tramo/módulo),
      //  · un elemento FIJO por palabra ("fija/fijo") o por descripción ("sin apertura", "no abre"),
      //  · 3+ rieles ("tres rieles", "3 rieles", "triple/cuádruple riel"). "doble riel"/"2 rieles" NO.
      const _txtN = _txt.normalize('NFD').replace(/[̀-ͯ]/g, '');
      // [Gemini 9a] "panel/paneles" es sección (boundary seguro ante "termopanel"). "vidrio" NO se
      // incluye: es el CRISTAL, no una hoja — casi toda cotización lo menciona ("5+12+5","termopanel")
      // y escalar por eso rompería el auto-quote. "3 vidrios" = triple vidriado, no 3 hojas.
      const _configCompuesto =
        /\b(?:panos?|paneles?|panel|cuerpos?|secciones?|seccion|divisiones?|division|tramos?|modulos?)\b/i.test(_txtN)
        || /\bfij[ao]s?\b/i.test(_txtN)
        || /\bsin\s+apertura\b|\bno\s+abren?\b/i.test(_txtN)
        || /\b(?:tres|cuatro|cinco|seis|siete|ocho|nueve|[3-9])\s+rieles?\b/i.test(_txtN)
        || /\b(?:triple|cuadruple)\s+riel/i.test(_txtN);
      const _enEnvelope = ANDES_AUTO_COTIZA
        && tipo === "CORREDERA" && _dosHojasOk && !_esMono && !_pideHoja54 && !_configCompuesto
        && _areaM2 >= ANDES_MIN_AREA_M2 && m.ancho_mm <= ANDES_MAX_MM && m.alto_mm <= ANDES_MAX_MM;
      if (_enEnvelope) {
        serie = "ANDES";
      } else {
        const razon = !ANDES_AUTO_COTIZA ? `La línea Andes la cotiza Marcelo directamente.`
          : tipo !== "CORREDERA" ? `La línea Andes solo tiene corredera.`
          : _esMono ? `El Andes monorriel todavía no está en el cotizador automático.`
          : _configCompuesto ? `Esa Andes no es una corredera simple de 2 hojas (lleva paño fijo, más secciones o riel distinto); la reviso con Marcelo para el precio exacto.`
          : !_dosHojasOk ? (_conteo && _conteo !== 2
              ? `El Andes de ${_conteo} hojas todavía no está en el cotizador automático.`
              : `No me quedó claro el número de hojas; lo reviso con Marcelo para darte el precio exacto.`)
          : _pideHoja54 ? `El Andes hoja 54 (económica) todavía no está en el cotizador automático.`
          : _areaM2 < ANDES_MIN_AREA_M2 ? `Esa ventana Andes es de las chicas (hoja 54), que reviso aparte.`
          : `Ventana Andes ${m.ancho_mm}×${m.alto_mm} mm supera el máximo cotizable automático (${ANDES_MAX_MM} mm por lado).`;
        item.price_warning = `${razon} La revisa Marcelo para darte el precio exacto.`;
        item.source = "activa_engine"; item.confidence = "manual"; item.fuera_de_alcance = true;
        return { escalada: true };
      }
    }
    // 🔴 [2026-09-18] EL No DE HOJAS SE LEIA SOLO DE `item.product`, y ahi casi nunca esta.
    // Caso real CM-FR-004-2026-0477 (Mario Grey, 18-sep): el cliente escribio "1 unidad de
    // 2710x1995 corredera TRIPLE HOJA en 2 rieles central fija laterales corredera". Salio
    // cotizada de DOS hojas: $878.714. El real de 3 hojas es $893.149 (medido contra el motor
    // en vivo, los dos valores) => $14.435 de subcobro, y ademas el dibujo del PDF mostro 2
    // panos cuando el cliente habia pedido 3. El texto del cliente NUNCA se miraba.
    // La rama ANDES de mas arriba ya leia TODO el texto por esta misma razon; SLIDING no.
    //
    // ⚠️ EL TEXTO DEL CLIENTE SOLO SE USA CON UN UNICO ITEM. Con varias ventanas en un mismo
    // mensaje (la foto del cuaderno con 17 ventanas es el caso tipico), un "3 hojas" dicho para
    // UNA se le aplicaria a las 17. El texto libre no dice a cual ventana pertenece.
    const _unicoItem = Array.isArray(d.items) && d.items.length === 1;
    const _txtItem = `${item.descripcion || ""} ${item.product || ""} ${item.producto_label || ""} ${item.label || ""} ${item.producto || ""}`;
    const _txtCfg = _unicoItem ? `${_txtItem} ${d.texto_cliente || ""}` : _txtItem;
    const hojas = detectHojas(_txtCfg);
    // Config de corredera segun la regla del dueno, que es la taxonomia de Winart:
    // central fija = DOBLE riel - las 3 corren a un lado = TRIPLE riel. Ver detectConfigCorredera.
    const _cfgCorr = tipo === "CORREDERA" ? detectConfigCorredera(_txtCfg, hojas) : {};

    // Si el pedido se contradice (pide la central fija Y que las tres corran), son dos
    // ventanas distintas separadas por $99.364 de material: NO se elige una a la suerte.
    // Escala a Marcelo, igual que hace la rama ANDES cuando el config no se confirma.
    if (_cfgCorr.ambiguo) {
      item.price_warning = `No me quedo claro como quiere las hojas (${_cfgCorr.motivo}). `
        + `Lo reviso con Marcelo para darle el precio exacto.`;
      item.source = "activa_engine"; item.confidence = "manual"; item.fuera_de_alcance = true;
      return { escalada: true };
    }

    // 4) Color / glass_id / comuna / cantidad
    const color = normColorLocal(item.color || d.default_color || "");
    const glass_id = pickGlassId(m.ancho_mm, m.alto_mm, item.ambiente); // por área + baño
    item.glass_label = glass_id === GLASS_BANO ? "4+12+4 satén (baño)"
                     : glass_id === GLASS_LARGE ? "5+12+5"
                     : "4+12+4";
    const comuna = d.comuna || "";
    const cantidad = Math.max(1, Number(item.qty) || 1);

    // 5) Llamada al Engine — el fallo de ESTE ítem NO mata el resto (se marca y sigue)
    let r;
    try {
      r = await calcularCotizacion({
        tipo, serie, hojas,
        // [2026-09-18] El riel y las hojas que cierran salen del pedido del cliente, no
        // de un default. Con la central fija son DOS las que cierran (las laterales,
        // contra la del medio): asi lo factura Winart en la version 69621 de referencia.
        riel: _cfgCorr.riel, activos: _cfgCorr.activos,
        // La hoja del medio FIJA hay que DECLARARLA: el motor no la puede adivinar, y de ella
        // dependen los carros (van por hoja que corre, no por hoja) y el suple de hoja fija.
        // Sin declararla el BOM es el de siempre, que es lo que queremos en todo lo demas.
        hojas_fijas: _cfgCorr.centralFija ? 1 : undefined,
        ancho_mm: m.ancho_mm, alto_mm: m.alto_mm,
        color, glass_id, comuna, cantidad,
        // [2026-08-25 · Codex] El eslabon que faltaba: sin esto los anchos de paño del
        // cliente morian en el pricer y toda compuesta salia 50/50.
        partes: Array.isArray(item.partes) && item.partes.length ? item.partes : undefined,
        // [2026-08-25] El eje. `item.orientacion` gana (el LLM la leyo del pedido); si no
        // viene, se mira como lo pidio el cliente. Sin señal: horizontal, como siempre.
        // El eje: lo que diga el item manda; si no dice nada, lo que escribio el cliente.
        orientacion: item.orientacion
          || (tipo === "COMPUESTA"
            && esCompuestaVertical(
              `${item.descripcion || ""} ${item.label || ""} ${item.producto || ""} ${item.product || ""} ${d.texto_cliente || ""}`)
            ? "vertical" : undefined),
      });
    } catch (err) {
      item.price_warning = "No se pudo cotizar automáticamente (motor); lo revisa un especialista.";
      item.source = "activa_engine"; item.confidence = "manual";
      return { escalada: true };
    }

    if (!r || r.ok === false) {
      item.price_warning = (r && (r.error || r.message)) || "No se pudo cotizar automáticamente; lo revisa un especialista.";
      item.source = "activa_engine"; item.confidence = "manual";
      return { escalada: true };
    }

    // 6) Totales: usar NETO (total_clp). El flujo del bot (resumen + PDF) AGREGA
    //    IVA 19% sobre el subtotal, así que los items deben ir SIN IVA. Usar
    //    total_con_iva acá causaba doble IVA (cobrar ~19% de más). FIX.
    // [FIX 2026-06-19 COB-02] total_con_iva ELIMINADO del fallback (el comentario decía FIX pero seguía ahí). Si el motor solo da con IVA → escalar, no cobrar 19% de más.
    const lineTotal = Number(r.total_clp ?? r.total_neto_clp ?? 0);
    if (!Number.isFinite(lineTotal) || lineTotal <= 0) {
      item.price_warning = "Total inválido del motor; lo revisa un especialista.";
      item.source = "activa_engine"; item.confidence = "manual";
      return { escalada: true };
    }

    const unit = Math.round(lineTotal / cantidad);
    item.unit_price = unit;
    item.total_price = lineTotal;
    item.source = "activa_engine";
    item.confidence = "high";
    // Persistir especificación para el PDF/etiqueta (antes se perdía): serie + hoja + riel
    item.serie = serie;
    if (r.producto_label) item.producto_label = r.producto_label;
    if (r.corredera) item.corredera = r.corredera;
    // [2026-09-18] El PAÑO de vidrio con los descuentos de marco y hoja ya aplicados. Lo usa el
    // informe de vientos: el vidrio resiste segun SU tamaño, no el de la ventana. Antes se le
    // mandaba la ventana completa y el veredicto de resistencia no salia.
    if (r.pano_vidrio) item.pano_vidrio = r.pano_vidrio;
    // [2026-08-25 · Codex #4] La composicion de la compuesta se descartaba y el PDF la
    // dibujaba como UN paño solo. Con esto viaja: cada paño con su tipo y su ancho real,
    // que es lo que el dibujo necesita para poner el travesaño donde va y marcar cual abre.
    if (r.compuesta) item.compuesta = r.compuesta;
    if (r.termico) item.termico = r.termico; // [thermal] hoja Uw (aditivo; null en H98/sin match → no se muestra)
    if (dim && dim.suggest) item.price_warning = dim.message;

    return { lineTotal };
  };

  // Cotizar en lotes de concurrencia acotada (no 18 en serie, no 18 de golpe)
  const CONC = 6;
  const results = new Array(d.items.length);
  for (let start = 0; start < d.items.length; start += CONC) {
    const idxs = [];
    for (let i = start; i < Math.min(start + CONC, d.items.length); i++) idxs.push(i);
    const settled = await Promise.all(idxs.map((i) =>
      priceOneItem(i).catch((e) => {
        console.error("[enginePricer] item", i, "error:", e?.message || e);
        if (d.items[i]) { d.items[i].source = "activa_engine"; d.items[i].confidence = "manual"; d.items[i].price_warning = "No se pudo cotizar automáticamente; lo revisa un especialista."; }
        return { escalada: true };
      })
    ));
    settled.forEach((res, k) => { results[idxs[k]] = res; });
  }
  // Reducción secuencial (sin race con la concurrencia de arriba)
  for (const res of results) {
    if (!res || res.escalada) { escaladas++; continue; }
    if (Number.isFinite(res.lineTotal)) grandTotal += res.lineTotal;
  }

  d.grand_total = grandTotal || null;

  if (escaladas > 0) {
    const fueraDeAlcance = results.find((res) => res?.fueraDeAlcance)?.fueraDeAlcance;
    return {
      ok: false,
      error: fueraDeAlcance?.mensajeCliente || "La cotización requiere revisión de especialista.",
      partial: true,
      total: d.grand_total,
      source: "activa_engine",
      escalate: true,
      reason: fueraDeAlcance?.razon || "partial_cotization",
      ...(fueraDeAlcance ? {
        category: fueraDeAlcance.categoria,
        customer_message: fueraDeAlcance.mensajeCliente,
      } : {}),
    };
  }

  return {
    ok: true,
    total: d.grand_total,
    source: "activa_engine",
    escalate: false,
  };
}

export { DEFAULT_GLASS_ID };
