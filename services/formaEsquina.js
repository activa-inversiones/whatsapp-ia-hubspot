// ---------------------------------------------------------------------------
// FORMA ESQUINA / BOW WINDOW — la FUENTE UNICA de "¿esto es una ventana en esquina?"
// ---------------------------------------------------------------------------
// 🔴 POR QUE EXISTE (2026-09-24, instruccion del dueño, textual):
//   *"cuando te pidan una ventana bow window 200x150x40, la primera medida es fija, la segunda
//    es la altura y la tercera es los laterales"*, y con el caso real de ese dia:
//   *"2000X1500X400 ... 2000MM DE ANCHO CENTRAL, 1500 EL ALTO Y LOS LATERALES DE 400X1500"*.
//
// 🔴 EL DEFECTO QUE CIERRA, MEDIDO ANTES DE ESCRIBIRLO: `medidas("2000x1500x400")` devuelve
// {ancho:2000, alto:1500}. **El tercer numero se descarta EN SILENCIO.** Los laterales
// desaparecen, se cotiza otra ventana, y no hay error ni aviso. Perder una medida que el
// cliente SI escribio es peor que no entenderla: si no se entiende, alguien pregunta.
//
// ⚠️ Vive en su propio archivo por la misma razon que `formaMonorriel.js` (#880): la pregunta
// se contesta en UN solo lugar, y lo leen tanto el que COTIZA como el que DIBUJA. Cuando la
// misma pregunta se contesta en dos lados, los dos se contradicen — ya paso, y el cliente vio
// una ventana que no era la que se le cobro.

/**
 * Lee la notacion de tres medidas del dueño. Devuelve {central_mm, alto_mm, lateral_mm} o null.
 *
 * `null` significa "esto NO es una notacion triple", no "hubo un error": una ventana normal
 * tiene dos medidas y tiene que seguir su camino de siempre.
 */
export function leerMedidaTriple(texto) {
  const t = String(texto || '');
  // Las tres medidas SEGUIDAS. El ancla `(?![\s]*[x×])` evita comerse una cuarta.
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i);
  if (!m) return null;
  const n = (s) => parseFloat(String(s).replace(',', '.'));
  let [a, b, c] = [n(m[1]), n(m[2]), n(m[3])];
  if (![a, b, c].every((v) => Number.isFinite(v) && v > 0)) return null;
  // UNIDAD: el mismo criterio que ya usa `medidas()` para dos numeros, extendido a tres.
  //  · <= 6      -> metros  (2 x 1,5 x 0,4)
  //  · <= 600    -> centimetros (200x150x40, que es como el dueño la escribio primero)
  //  · el resto  -> milimetros (2000x1500x400)
  // 🔴 LA CONVERSION ES DE LAS TRES O DE NINGUNA. Convertir solo la que "parece chica"
  // mezclaria unidades dentro de la misma ventana — un lateral de 400 mm junto a un central
  // de 2.000 mm es normal, y ahi el 400 NO son centimetros.
  const esc = (Math.max(a, b, c) <= 6) ? 1000 : (Math.max(a, b, c) <= 600 ? 10 : 1);
  [a, b, c] = [a * esc, b * esc, c * esc];
  return { central_mm: Math.round(a), alto_mm: Math.round(b), lateral_mm: Math.round(c) };
}

/**
 * [2026-09-26 · #947] LAS DOS FORMAS DEL PAÑO COMPUESTO, UNIFICADAS PARA EL DIBUJO.
 *
 * 🔴 EL DEFECTO, MEDIDO RENDERIZANDO la bow window de 4 paños del dueño (v70490 de Winart):
 * el lateral de 325 "mitad proyectante arriba, mitad fija abajo" salia dibujado como UN FIJO
 * ENTERO, mientras Winart lo muestra partido (A1 770 arriba + F4 770 abajo). El dibujante busca
 * las mitades en `compuesta.partes` —la forma que produce `esquinaDesdeLabel`— pero el pricer y
 * el motor traen la forma del MOTOR: `{tipo:"COMPUESTA", orientacion, partes:[{tipo, alto_mm}]}`.
 * Con `it.esquina` presente (todos los caminos del chat desde el #884), la etiqueta ni se mira
 * y el lateral pierde su mitad que abre. El #887 arreglo la etiqueta; este es el otro camino.
 * Aca se devuelve cada paño con LAS DOS formas, para que quien lea cualquiera de las dos vea
 * lo mismo. Funcion pura.
 */
export function partesEsquinaNormalizadas(partes) {
  if (!Array.isArray(partes)) return partes;
  return partes.map((pt) => {
    if (!pt || String(pt.tipo || "").toUpperCase() !== "COMPUESTA") return pt;
    const sub = Array.isArray(pt.partes) && pt.partes.length >= 2 ? pt.partes
      : (Array.isArray(pt.compuesta?.partes) && pt.compuesta.partes.length >= 2 ? pt.compuesta.partes : null);
    if (!sub) return pt;
    const orientacion = pt.orientacion || pt.compuesta?.orientacion || "vertical";
    return { ...pt, orientacion, partes: sub, compuesta: { ...(pt.compuesta || {}), orientacion, partes: sub } };
  });
}

// La tipologia dicha por su nombre. "bow window" y sus deformaciones, y como se dice en Chile.
// [#947] Tambien en plural y con el typo real del dueño ("bow windws 4 lados bow windows"):
// `\bwindow\b` no casaba con "windows" y el pedido del 26-sep no se reconocia por el nombre.
const NOMBRE = /\bbow\s*-?\s*windo?ws?\b|\bbowindows?\b/i;
// "ventana/ventanal EN esquina", "esquinera", "en L", "paños en angulo". La preposicion
// importa: es lo que separa la TIPOLOGIA de la UBICACION.
const FORMA = /\bventanal?\s+(?:en\s+)?(?:esquina|esquinera|esquinada|l)\b|\b(?:ventanal?|pa[ñn]os?)\s+en\s+[aá]ngulo\b/i;

/**
 * ¿El texto describe una ventana EN ESQUINA (tipologia), o solo menciona una esquina (lugar)?
 *
 * 🔴 LA TRAMPA, Y YA MORDIO UNA VEZ EN ESTE REPO: "esquina" en Chile es tambien un lugar
 * ("la ventana de la esquina del living", "proyectante esquina nororiente"). Es el mismo caso
 * de la *cocina* americana, que hacia que una proyectante se cotizara como corredera. Por eso
 * no alcanza con que aparezca la palabra: tiene que estar pegada a "ventana"/"ventanal", o
 * venir el nombre en ingles, que no es ambiguo.
 */
export function esBowPorForma(texto) {
  const t = String(texto || '');
  if (NOMBRE.test(t)) return true;
  // "ventana de la esquina" / "ventana de esquina de la casa" = ubicacion. "de la" la delata.
  if (/\bventanal?\s+de\s+la\s+esquina\b/i.test(t)) return false;
  return FORMA.test(t);
}


// ---------------------------------------------------------------------------
// [2026-09-26 · #947] LA ESQUINA PAÑO POR PAÑO — cuando el cliente describe CADA paño.
// ---------------------------------------------------------------------------
// 🔴 POR QUE EXISTE, medido en el chat del dueño (26-sep 10:58-11:01): *"bow windows 4 lados:
// fija 330x1540, fija 1830x1540, fija 1830x1540, mitad superior proyectante y mitad inferior
// fija 325x1540 ... angulo en las esquinas 90 grados"*. Cuatro paños, anchos distintos y
// aperturas distintas. La notacion de tres medidas (`leerMedidaTriple`) arma SIEMPRE
// [lateral, central, lateral]: es para la simetrica y solo para ella. Oliver, sin otro camino,
// la forzo —cotizo "Compuesto 325 + Fijo 1830 + Compuesto 325", una ventana de 2.480 mm que
// no es la del cliente (4.315 mm)— y despues la escalo sin cotizar.
// El motor SI la acepta (2 a 6 paños, `partes[]` explicitas, `calculateBowQuote` en sales-os):
// lo que faltaba era un camino desde la tool hasta el pricer que no perdiera ni el orden ni la
// apertura de cada paño. Este es ese camino, y por eso vive en la FUENTE UNICA de la esquina.

// Los mismos limites que el motor (quoteEngine.js: BOW_MIN_PANOS / BOW_MAX_PANOS). Se copian
// a proposito con el nombre del motor al lado: si alla cambian, un grep los encuentra aca.
export const BOW_MIN_PANOS = 2;
export const BOW_MAX_PANOS = 6;

// El tipo de un paño DECLARADO por el LLM. A diferencia de `tipoDeParte` (que lee una etiqueta
// que el motor ya valido), aca lo desconocido se RECHAZA: "CORREDERA" no puede degradarse a
// FIJA en silencio, que es exactamente el error caro (cotizar otra ventana sin aviso).
const TIPOS_PANO = Object.freeze({
  FIJA: "FIJA", FIJO: "FIJA",
  PROYECTANTE: "PROYECTANTE",
  BATIENTE: "BATIENTE", ABATIBLE: "BATIENTE",
  OSCILOBATIENTE: "OSCILOBATIENTE",
  COMPUESTA: "COMPUESTA", COMPUESTO: "COMPUESTA", MIXTA: "COMPUESTA", MIXTO: "COMPUESTA",
});
const TIPOS_MITAD = Object.freeze(["FIJA", "PROYECTANTE", "BATIENTE", "OSCILOBATIENTE"]);
function tipoDeclarado(t) {
  const s = String(t || "").trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return TIPOS_PANO[s] || null;
}

// UNIDAD DE LOS ANCHOS: se decide sobre el CONJUNTO y se escalan TODOS o ninguno. Escalar solo
// los que "parecen chicos" mezclaria unidades dentro de la misma ventana (un lateral de 325 mm
// junto a un central de 1.830 mm es normal, y ahi el 325 NO son centimetros).
// ⚠️ NO es el umbral de `leerMedidaTriple` (maximo <= 600 -> cm). Alla el ALTO entra en el
// maximo y salva a la bow chica ("40x150x40": el 150 manda). Aca el alto viene aparte, y con
// ese umbral una bow de 400/600/400 mm se leia como centimetros y salia de 4/6/4 METROS.
// Se usa un hecho fisico en vez de un umbral: ningun paño de ventana mide menos de 15 cm, asi
// que si ALGUN ancho baja de 150 el cliente escribio en centimetros (33/183/183/32), y si
// ninguno baja, en milimetros (330/1830/1830/325 · 400/600/400).
const ANCHO_MINIMO_MM = 150;
const escalaAnchos = (nums) => (nums.some((a) => a < ANCHO_MINIMO_MM) ? 10 : 1);
// UNIDAD DEL ALTO (solo cuando NO viene resuelto por la tool): un numero solo, el mismo criterio
// que `medidas()` para un par: hasta 600 son centimetros.
const escalaCm = (nums) => (Math.max(...nums) <= 600 ? 10 : 1);
const num = (v) => (typeof v === "string" ? parseFloat(v.replace(",", ".")) : Number(v));
const vacio = (v) => v === undefined || v === null || v === "";

/**
 * ¿Este numero lo ESCRIBIO el cliente? Se busca tal cual en su texto (entero o con decimal por
 * punto o coma), sin pegarse a otros digitos: "330" esta en "330x1540" y no en "1330".
 * Es la base de la regla de unidades de abajo: lo que el cliente escribio lleva la unidad del
 * texto; lo que NO escribio lo convirtio el LLM y ya viene en milimetros.
 */
export function numeroEscritoPorElCliente(n, texto) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return false;
  const t = String(texto || "");
  const entero = Number.isInteger(v) ? String(v) : null;
  const decimal = Number.isInteger(v) ? null : String(v).replace(".", "[.,]");
  const cuerpo = entero || decimal;
  return new RegExp(`(?<![\\d.,])${cuerpo}(?![\\d])`).test(t);
}

/**
 * El factor con que el texto del cliente se paso a milimetros: 1 (mm), 10 (cm) o 1000 (m).
 * Sale de comparar el PRIMER par del texto con el par que resolvio `resolverMedidasMm`, probando
 * los dos ordenes (el resolutor puede haber dado vuelta el par). Si no hay par, o el cociente no
 * es uno de los tres, se devuelve 1: no se inventa una unidad.
 * @param {string} medidas_texto - lo que escribio el cliente
 * @param {{ancho_mm:number, alto_mm:number}} resuelto - el par ya en mm
 */
export function factorDelTexto(medidas_texto, resuelto) {
  const m = String(medidas_texto || "").match(/(\d+(?:[.,]\d+)?)\s*(?:[x×X\/]|por)\s*(\d+(?:[.,]\d+)?)/);
  if (!m || !resuelto) return 1;
  const a = parseFloat(m[1].replace(",", ".")), b = parseFloat(m[2].replace(",", "."));
  const ra = Number(resuelto.ancho_mm), rb = Number(resuelto.alto_mm);
  const cerca = (x, f) => Number.isFinite(x) && Math.abs(x / f - 1) <= 0.01;
  for (const f of [1, 10, 1000]) {
    if ((cerca(ra / a, f) && cerca(rb / b, f)) || (cerca(ra / b, f) && cerca(rb / a, f))) return f;
  }
  return 1;
}

/**
 * El angulo de una union, llevado al esquinero que WinHouse FABRICA (mismas bandas que
 * `anguloEsquinero` en el motor): 75-105 -> 90 · 20-75 -> 45 · fuera -> null (no se fabrica).
 * Se normaliza ACA para que la nota al cliente y la etiqueta del motor digan lo mismo
 * ("uniones a 45°"), y para rechazar lo no fabricable con texto en vez de con un error tecnico.
 */
export function anguloFabricable(grados) {
  let g = Number(grados);
  if (!Number.isFinite(g)) return null;
  // [tridente #947, Gemini r3] El cliente puede decir el angulo INTERIOR del bay ("135 grados"),
  // que es el suplementario de la desviacion del poste (180 - 135 = 45). Un angulo abierto de
  // mas de 105 se lee asi; sin esto se rechazaba y escalaba una esquina de 45 perfectamente
  // fabricable.
  if (g > 105 && g < 180) g = 180 - g;
  if (g >= 75 && g <= 105) return 90;
  if (g >= 20 && g < 75) return 45;
  return null;
}

/**
 * [tridente #947, Codex r3] LOS PARES "A x B" DEL TEXTO DEL CLIENTE, CADA UNO CON SU FACTOR A MM.
 * Un texto puede mezclar unidades ("180x150 cm" y despues "1800x1500 mm"): un solo factor para
 * todo el texto convertia el segundo par a 18.000 mm. La unidad se decide POR PAR ENTERO, nunca
 * numero por numero: el sufijo explicito (mm / cm / m) manda; sin sufijo, el mismo umbral que
 * usa `leerMedidaTriple`: hasta 6 son metros, hasta 600 centimetros, el resto milimetros.
 * ⚠️ NO se usa `normMeasures` aca a proposito: esa funcion rescata numero por numero (un 330
 * junto a un 1540 lo lee como 33 cm) y un lateral de bow window de 330 mm es normal.
 * Funcion pura.
 * @returns {Array<{a:number, b:number, factor:number, crudo:string}>}
 */
export function paresDelTexto(texto) {
  const t = String(texto || "");
  const re = /(\d+(?:[.,]\d+)?)\s*(?:[x×X]|por)\s*(\d+(?:[.,]\d+)?)(?:\s*(mm|cm|mts?|m)\b)?/g;
  const unidadGlobal = /\bcm\b/i.test(t) && !/\bmm\b/i.test(t) ? 10 : (/\bmm\b/i.test(t) && !/\bcm\b/i.test(t) ? 1 : null);
  const pares = [];
  for (const m of t.matchAll(re)) {
    const a = num(m[1]), b = num(m[2]);
    if (!(a > 0 && b > 0)) continue;
    const u = String(m[3] || "").toLowerCase();
    // [Codex r4] La unidad NOMBRADA en el texto ("todo en mm", "en cm") vale para los pares que
    // no llevan sufijo pegado: sin esto "todo en mm: fija 200x450" caia en el umbral (<= 600 -> cm).
    const factor = u === "mm" ? 1 : u === "cm" ? 10 : (u === "m" || u === "mt" || u === "mts") ? 1000
      : (unidadGlobal !== null ? unidadGlobal
      : (Math.max(a, b) <= 6 ? 1000 : Math.max(a, b) <= 600 ? 10 : 1));
    pares.push({ a, b, factor, crudo: m[0] });
  }
  return pares;
}

const casi = (x, y) => Math.abs(x - y) <= 1;

/**
 * Arma una ventana en esquina desde la lista de paños que describio el cliente, EN ORDEN.
 *
 * @param {Array<{tipo:string, ancho_mm:number, arriba?:string, abajo?:string,
 *                alto_arriba_mm?:number, alto_abajo_mm?:number}>} panos
 * @param {object} [opts]
 *   · alto_mm: el alto comun a todos los paños (el motor modela la esquina con un solo alto).
 *   · angulo: el de las uniones, uno para todas. Se lleva al esquinero fabricable (45 o 90).
 *   · exigir_literal (la TOOL lo pone en true): cada ancho, el alto y las alturas de las mitades
 *     tienen que ser numeros que el CLIENTE ESCRIBIO en `texto_cliente`, tal cual, y toman la
 *     unidad del par del texto donde aparecen (`pares`, de `paresDelTexto`). El alto tiene que ser
 *     ademas el valor COMUN a todos los pares. Lo que el LLM convirtio, redondeo o invento se
 *     rechaza con un texto para que copie los numeros del cliente. Es la respuesta al tridente
 *     (Codex r2/r3): decidir la unidad por tamaño o por un factor global adivinaba.
 *   · Sin exigir_literal (otros llamadores): alto_resuelto / factor_texto / texto_cliente como
 *     antes, con el salvavidas de 150 mm.
 * @returns {{partes, uniones, angulo, alto_mm, ancho_total_mm, ancho_max_mm, derivado_de} | {error}}
 */
export function esquinaDesdePanos(panos, {
  alto_mm, alto_resuelto = false, angulo, texto_cliente = "", factor_texto = 1,
  exigir_literal = false, pares = [],
} = {}) {
  const lista = Array.isArray(panos) ? panos : [];
  if (lista.length < BOW_MIN_PANOS || lista.length > BOW_MAX_PANOS) {
    return { error: `Una ventana en esquina lleva entre ${BOW_MIN_PANOS} y ${BOW_MAX_PANOS} paños `
      + `(recibidos: ${lista.length}). Con un solo paño es una ventana normal o una compuesta; `
      + "con más de seis, confírmelo con Marcelo." };
  }
  const tipos = [];
  const anchos = [];
  for (let i = 0; i < lista.length; i++) {
    const p = lista[i] || {};
    const tipo = tipoDeclarado(p.tipo);
    if (!tipo) {
      return { error: `El paño ${i + 1} es "${p.tipo}" y ese tipo no va en una ventana en esquina. `
        + "Cada paño puede ser FIJA, PROYECTANTE, BATIENTE, OSCILOBATIENTE o COMPUESTA (mitad y mitad). "
        + "Si un paño CORRE, no es una bow window: consúltelo con Marcelo." };
    }
    const a = num(p.ancho_mm);
    if (!Number.isFinite(a) || a <= 0) {
      return { error: `Falta el ancho del paño ${i + 1} (${tipo}). Pídale al cliente el ancho de cada paño: no se puede suponer.` };
    }
    tipos.push(tipo);
    anchos.push(a);
  }
  let alto = num(alto_mm);
  if (!Number.isFinite(alto) || alto <= 0) {
    return { error: "Falta el alto de la ventana en esquina (es el mismo para todos los paños). Pídaselo al cliente." };
  }

  // ── La unidad de cada numero, y que el numero sea del cliente ─────────────────────────────
  let anchosMm;
  const ps = Array.isArray(pares) ? pares : [];
  // [Gemini r4] SOLO LOS PARES DE ESTA VENTANA. `texto_cliente` trae TODA la conversacion, y el
  // cliente puede haber pedido otra ventana en el mismo mensaje ("una de 150x120 y la bow window
  // de 33x154, 183x154..."): los pares que no contienen ningun ancho de la lista son de otra
  // ventana y no pueden mandar sobre el alto de esta.
  const relevantes = ps.filter((p) => anchos.some((a) => casi(p.a, a) || casi(p.b, a)));
  const conjunto = relevantes.length ? relevantes : ps;
  // La unidad escrita AL LADO de un numero suelto ("40 cm", "1540 mm") manda sobre todo.
  const unidadJunto = (raw) => {
    const s = Number.isInteger(raw) ? String(raw) : String(raw).replace(".", "[.,]");
    const m = new RegExp(`(?<![\\d.,])${s}(?![\\d])\\s*(mm|cm|mts?|m)\\b`, "i").exec(String(texto_cliente || ""));
    if (!m) return null;
    const u = m[1].toLowerCase();
    return u === "mm" ? 1 : u === "cm" ? 10 : 1000;
  };
  // El factor "del texto" cuando un numero no esta dentro de ningun par ni lleva unidad al lado:
  // (1) el unico factor que usan los pares de esta ventana; (2) si no hay pares, la unidad que el
  // cliente nombro en el texto ("todo en cm"); (3) si tampoco, el umbral de la notacion triple
  // sobre TODOS los numeros de esta ventana, alto incluido: hasta 600 son centimetros.
  // [Gemini r4] Sin el paso (3), "alto 150 cm, paños de 40, 180 y 40" dejaba el 180 en milimetros.
  const factoresTexto = [...new Set(conjunto.map((p) => p.factor))];
  const menciona = (re) => re.test(String(texto_cliente || ""));
  const unidadGlobal = menciona(/\bcm\b/i) && !menciona(/\bmm\b/i) ? 10 : (menciona(/\bmm\b/i) && !menciona(/\bcm\b/i) ? 1 : null);
  const factorSuelto = factoresTexto.length === 1 ? factoresTexto[0]
    : (unidadGlobal ?? (Math.max(...anchos, alto) <= 600 ? 10 : 1));
  // Los pares donde aparece un numero crudo, y el factor con que se lee ahi.
  const factorDe = (raw) => {
    const fs = [...new Set(ps.filter((p) => casi(p.a, raw) || casi(p.b, raw)).map((p) => p.factor))];
    if (fs.length > 1) return { error: `El número ${raw} aparece en el texto con dos unidades distintas; confirme con el cliente.` };
    return { factor: fs.length === 1 ? fs[0] : null };
  };
  const factorDelNumero = (raw) => {
    const junto = unidadJunto(raw);
    if (junto !== null) return { factor: junto };
    const f = factorDe(raw);
    if (f.error) return f;
    return { factor: f.factor ?? factorSuelto };
  };
  if (exigir_literal) {
    anchosMm = [];
    for (let i = 0; i < anchos.length; i++) {
      const raw = anchos[i];
      if (!numeroEscritoPorElCliente(raw, texto_cliente)) {
        return { error: `El ancho ${raw} del paño ${i + 1} NO está escrito por el cliente. Copie sus números tal cual `
          + "(sin convertir ni redondear): la unidad la resuelve el sistema con el texto del cliente." };
      }
      const f = factorDelNumero(raw);
      if (f.error) return { error: f.error };
      anchosMm.push(raw * f.factor);
    }
    // [Codex r4] MULTIPLICIDAD: si el cliente escribio un par por paño, un ancho no puede
    // aparecer en la lista mas veces que en sus pares ([330,1830,1830,1830] con "330x1540,
    // 1830x1540, 1830x1540, 325x1540" cotizaba 5820 mm en vez de 4315).
    // Solo cuando el cliente escribio al menos un par por paño: "dos de 1830x1540" (un par, dos
    // paños) no se puede contar y no se bloquea.
    if (ps.length >= anchos.length) {
      for (const x of new Set(anchos)) {
        const enLista = anchos.filter((a) => casi(a, x)).length;
        const enTexto = ps.filter((p) => casi(p.a, x) || casi(p.b, x)).length;
        if (enTexto === 0) continue;
        if (enLista > enTexto) {
          return { error: `El ancho ${x} aparece ${enLista} veces en la lista de paños pero el cliente lo escribió ${enTexto}. `
            + "Copie los paños tal como los escribió, en orden." };
        }
      }
    }
    // El alto: escrito por el cliente, y COMUN a todos los pares de ESTA ventana (en mm, para
    // textos que mezclan unidades).
    if (!numeroEscritoPorElCliente(alto, texto_cliente)) {
      return { error: `El alto ${alto} NO está escrito por el cliente. Copie el alto tal cual lo escribió: es el mismo para todos los paños.` };
    }
    const fa = factorDelNumero(alto);
    if (fa.error) return { error: fa.error };
    const altoMm = alto * fa.factor;
    if (relevantes.length >= 1) {
      const comun = relevantes.every((p) => casi(p.a * p.factor, altoMm) || casi(p.b * p.factor, altoMm));
      if (!comun) {
        return { error: `El alto ${alto} no es la medida común de los paños que escribió el cliente `
          + `(${relevantes.map((p) => p.crudo.trim()).join(", ")}). El alto de una esquina es el mismo en todos los paños: copie ese.` };
      }
    }
    alto = altoMm;
  } else {
    const f = Number(factor_texto) > 0 ? Number(factor_texto) : 1;
    anchosMm = anchos.map((a) => (f !== 1 && numeroEscritoPorElCliente(a, texto_cliente) ? a * f : a));
    if (f === 1) {
      const escA = escalaAnchos(anchosMm);
      anchosMm = anchosMm.map((a) => a * escA);
    }
    if (!alto_resuelto) alto = alto * escalaCm([alto]);
  }
  // Salvavidas por paño (Gemini r3): un ancho bajo 150 mm no existe, solo puede ser centimetros.
  anchosMm = anchosMm.map((a) => (a > 0 && a < ANCHO_MINIMO_MM ? a * 10 : a)).map((a) => Math.round(a));
  alto = Math.round(alto);

  const ang = vacio(angulo) ? 90 : num(angulo);
  if (!Number.isFinite(ang) || ang <= 0) {
    return { error: `El ángulo de las uniones no se entendió ("${angulo}"). Pídalo en grados: lo usual es 90, y WinHouse fabrica 90 y 45.` };
  }
  const angFab = anguloFabricable(ang);
  if (angFab === null) {
    return { error: `Una unión a ${ang}° no se fabrica: WinHouse tiene esquinero de 90° y de 45° `
      + "(se aceptan ángulos entre 20° y 160°; más de 105° se lee como ángulo interior). Confirme el ángulo con el cliente." };
  }

  // ── El paño compuesto, APILADO: que abre arriba y que va abajo, y cuanto mide cada mitad ──
  // [Codex r3] Las aperturas NO se inventan: si el paño es compuesto, el LLM tiene que decir que
  // va arriba y que abajo (lo dijo el cliente). Las alturas, si el cliente las dio, se respetan
  // (400 arriba + 1100 abajo); si no, mitad y mitad sin perder un milimetro (771 + 770).
  const partes = [];
  for (let i = 0; i < tipos.length; i++) {
    if (tipos[i] !== "COMPUESTA") { partes.push({ tipo: tipos[i], ancho_mm: anchosMm[i] }); continue; }
    const p = lista[i] || {};
    if (exigir_literal && (vacio(p.arriba) || vacio(p.abajo))) {
      return { error: `El paño ${i + 1} es compuesto: diga qué va ARRIBA y qué va ABAJO (arriba/abajo: FIJA, PROYECTANTE, `
        + "BATIENTE u OSCILOBATIENTE), tal como lo describió el cliente. No se supone." };
    }
    const arriba = vacio(p.arriba) ? "PROYECTANTE" : tipoDeclarado(p.arriba);
    const abajo = vacio(p.abajo) ? "FIJA" : tipoDeclarado(p.abajo);
    if (!TIPOS_MITAD.includes(arriba) || !TIPOS_MITAD.includes(abajo)) {
      return { error: `El paño ${i + 1} es compuesto y sus mitades ("${p.arriba}" arriba, "${p.abajo}" abajo) `
        + "no se entendieron. Cada mitad es FIJA, PROYECTANTE, BATIENTE u OSCILOBATIENTE." };
    }
    let hArr = vacio(p.alto_arriba_mm) ? null : num(p.alto_arriba_mm);
    let hAba = vacio(p.alto_abajo_mm) ? null : num(p.alto_abajo_mm);
    if (hArr !== null || hAba !== null) {
      for (const [nombre, v] of [["arriba", hArr], ["abajo", hAba]]) {
        if (v === null) continue;
        if (!(v > 0)) return { error: `La altura de la mitad de ${nombre} del paño ${i + 1} no es válida (${v}).` };
        if (exigir_literal && !numeroEscritoPorElCliente(v, texto_cliente)) {
          return { error: `La altura ${v} de la mitad de ${nombre} del paño ${i + 1} NO está escrita por el cliente. Copie su número tal cual.` };
        }
      }
      // [Gemini r4] La altura de una mitad dicha suelta ("proyectante de 40 arriba", en un texto
      // en cm) lleva la unidad de su numero, igual que los anchos; y una mitad bajo 150 mm no
      // existe: solo puede ser centimetros.
      const fDe = (v) => (exigir_literal ? factorDelNumero(v) : { factor: 1 });
      if (hArr !== null) { const f = fDe(hArr); if (f.error) return { error: f.error }; hArr = hArr * f.factor; if (hArr < ANCHO_MINIMO_MM) hArr *= 10; hArr = Math.round(hArr); }
      if (hAba !== null) { const f = fDe(hAba); if (f.error) return { error: f.error }; hAba = hAba * f.factor; if (hAba < ANCHO_MINIMO_MM) hAba *= 10; hAba = Math.round(hAba); }
      if (hArr === null) hArr = alto - hAba;
      if (hAba === null) hAba = alto - hArr;
      if (!casi(hArr + hAba, alto) || hArr <= 0 || hAba <= 0) {
        return { error: `Las mitades del paño ${i + 1} (${hArr} arriba + ${hAba} abajo) no suman el alto ${alto}. Confirme las alturas con el cliente.` };
      }
    } else {
      hArr = Math.round(alto / 2);
      hAba = alto - hArr;
    }
    partes.push({ tipo: "COMPUESTA", ancho_mm: anchosMm[i], orientacion: "vertical",
      partes: [{ tipo: arriba, alto_mm: hArr }, { tipo: abajo, alto_mm: hAba }] });
  }
  return {
    partes,
    uniones: partes.length - 1,
    angulo: angFab,
    alto_mm: alto,
    // La SUMA DIRECTA: regla del dueño (11-sep), el poste queda por fuera y el cliente mide
    // por dentro. Y el paño MAS GRANDE aparte: de el sale el vidrio.
    ancho_total_mm: anchosMm.reduce((s, a) => s + a, 0),
    ancho_max_mm: Math.max(...anchosMm),
    derivado_de: "panos_del_cliente",
  };
}


// El tipo de UN paño, normalizado a lo que entienden el motor Y el dibujo. Vive aca porque
// `esquinaDesdeLabel` es el unico que lo necesita desde los dos lados (precio y figura).
function tipoDeParte(t) {
  const s = String(t || "").toUpperCase();
  if (s.includes("OSCILO")) return "OSCILOBATIENTE";
  if (s.includes("PROYECT")) return "PROYECTANTE";
  if (s.includes("ABAT") || s.includes("BATIENTE")) return "BATIENTE";
  if (s.startsWith("COMPUEST")) return "COMPUESTA";
  return "FIJA";
}

/**
 * Lee la composicion de una VENTANA EN ESQUINA desde la etiqueta que arma el motor.
 * Devuelve {partes:[...]} o null si la etiqueta no es de una esquina.
 *
 * El formato lo produce `calculateBowQuote`:
 *   "Ventana en esquina (N paños, union 90°): <paño> + <paño> + <paño>"
 * y cada paño es "Fijo 2000mm" o "Compuesto 400mm (Proyectante 750mm (arriba) + Fijo 750mm (abajo))".
 * El separador de PAÑOS es " + " a nivel 0: el " + " de adentro del parentesis pertenece al
 * paño compuesto, asi que se corta contando parentesis en vez de con split (un split partia
 * "Compuesto 400mm (Proyectante 750mm" por la mitad y dejaba media ventana).
 */
export function esquinaDesdeLabel(it) {
  const label = String(it?.producto_label || it?.product || it?.producto || "");
  // [#887] Se acepta el nombre nuevo ("Bow window · ventana en esquina (...)") y el viejo:
  // hay propuestas ya emitidas con el anterior y tienen que seguir dibujandose igual.
  const m = label.match(/(?:bow\s*-?\s*window|ventana\s+en\s+esquina)[^:]*:\s*([\s\S]+)$/i);
  if (!m) return null;
  const trozos = [];
  let nivel = 0, actual = "";
  for (let i = 0; i < m[1].length; i++) {
    const ch = m[1][i];
    if (ch === "(") nivel++;
    else if (ch === ")") nivel = Math.max(0, nivel - 1);
    if (ch === "+" && nivel === 0) { trozos.push(actual); actual = ""; continue; }
    actual += ch;
  }
  if (actual.trim()) trozos.push(actual);
  const partes = [];
  for (const t of trozos) {
    const cab = t.trim().match(/^([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\s+(\d+(?:[.,]\d+)?)\s*mm/i);
    if (!cab) return null;                       // formato inesperado: NO se adivina
    const tipo = tipoDeParte(cab[1]);
    const ancho_mm = parseFloat(cab[2].replace(",", "."));
    if (!Number.isFinite(ancho_mm) || ancho_mm <= 0) return null;
    // Un paño COMPUESTO trae sus mitades entre parentesis.
    const sub = [...t.matchAll(/([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\s+(\d+(?:[.,]\d+)?)\s*mm\s*\((?:arriba|abajo|izquierda|derecha)\)/gi)];
    // 🔴 [2026-09-24 · #887] UN PAÑO "Compuesto" SIN DETALLE SIGUE SIENDO COMPUESTO.
    // Reclamo del dueño sobre la propuesta 0541: *"no puso la ventana proyectante a los lados
    // de las bow windows"*. La etiqueta que llega al PDF a veces viene SIN los sub-paños
    // ("... Compuesto 400mm + Fijo 2000mm + Compuesto 400mm") y el lateral salia dibujado
    // como un paño fijo entero — justo lo contrario de lo que el cliente pidio.
    // Dibujar un "Compuesto" como FIJO no es prudencia: es afirmar que NO abre, que es una
    // afirmacion mas fuerte que la que evita. Sin detalle se usa el default del motor de
    // compuestas —mitad proyectante arriba + mitad fija abajo—, que es el que el motor aplica
    // cuando el cliente no desglosa, asi que el dibujo coincide con lo que se COTIZO.
    // Queda declarado aparte de `label` para que se vea que aca hubo un default.
    if (/^compuest/i.test(cab[1]) && sub.length < 2) {
      partes.push({
        tipo: "COMPUESTA", ancho_mm, derivado_de: "label_sin_detalle",
        compuesta: { orientacion: "vertical", partes: [{ tipo: "PROYECTANTE" }, { tipo: "FIJA" }] },
      });
      continue;
    }
    if (/^compuest/i.test(cab[1]) && sub.length >= 2) {
      partes.push({
        tipo: "COMPUESTA", ancho_mm,
        compuesta: {
          orientacion: "vertical",
          partes: sub.map((x) => ({ tipo: tipoDeParte(x[1]), alto_mm: parseFloat(x[2].replace(",", ".")) })),
        },
      });
    } else {
      partes.push({ tipo, ancho_mm });
    }
  }
  if (partes.length < 2) return null;
  // [2026-09-26 · #947] EL ANGULO TAMBIEN VIENE EN LA ETIQUETA ("union 90°"). Uno solo -> se
  // devuelve; dos distintos ("union 90° y 45°", como en la referencia del dueño) -> no se sabe
  // cual va en cada union y NO se adivina: se marca `angulo_ambiguo` y el que cotiza ESCALA
  // (tridente, Codex r2 GRAVE 4: antes el pricer le ponia 90 por defecto, o sea adivinaba).
  // Sin esto, una esquina de 45° se re-cotizaba a 90° cada vez que se volvia a armar desde la
  // etiqueta (la sonda de color del #888 y el PDF lo hacen).
  const mu = label.match(/uni[oó]n\s+([^)]*)/i);
  const angs = mu
    ? [...new Set([...mu[1].matchAll(/(\d+(?:[.,]\d+)?)\s*°/g)].map((x) => parseFloat(x[1].replace(",", "."))))]
    : [];
  return { partes, uniones: partes.length - 1, derivado_de: "label",
    ...(angs.length === 1 && Number.isFinite(angs[0]) ? { angulo: angs[0] } : {}),
    ...(angs.length >= 2 ? { angulo_ambiguo: true } : {}) };
}
