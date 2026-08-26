// services/dibujoVentana.js — elevación 2D de la ventana para el PDF de cotización.
//
// Por qué existe como módulo aparte: el dibujo estaba embebido en quotePdf.js y no se podía
// probar sin generar un PDF entero. Acá la geometría se calcula en funciones puras (testeables)
// y el pintado con pdfkit queda en una sola función al final.
//
// COLORES: los hex son los REALES de Winart (GET /api/winart/colors, verificado 2026-08-09),
// no aproximaciones a ojo. El PDF venía dibujando grafito como #3C4856 cuando el real es #1c1c1c.
//
// SIMBOLOGÍA: se usa la convención de plano de arquitectura — líneas de trazo que convergen
// en el lado de las bisagras. Un cliente que muestra el PDF a su maestro tiene que poder leer
// hacia dónde abre cada hoja; una hoja dibujada sin símbolo es indistinguible de un paño fijo.
//
// [2026-08-25] LA COMPUESTA YA SE DIBUJA COMO UNA SOLA VENTANA. El límite que este comentario
// declaraba desde el 08-ago ("se cotiza como dos ítems ⇒ no se puede dibujar como una sola")
// murió: el motor tiene el tipo COMPUESTA y devuelve `compuesta.partes` con el tipo y el ancho
// REAL de cada paño. Acá se usa ese dato para poner el travesaño donde de verdad va y marcar
// cuál paño abre — antes salía como un paño único, que es lo que Codex marcó en la compuerta.
//
// 📐 QUÉ SE APRENDIÓ DE WINART, y por qué se dibuja así: el modelo real de una compuesta
// (proyecto 56570, medido 25-ago) son DOS MARCOS COMPLETOS acoplados por el perfil ACOPLE MINI
// (`PI-CMP-ACM`), no un marco único con poste. Por eso el dibujo NO lleva un marco exterior
// con divisiones adentro: lleva UN MARCO COMPLETO POR PAÑO, pegados por la junta del acople.

// Paleta real de Winart. `f` = relleno del perfil, `e` = color de línea.
// Blanco y roble/nogal traen lineHexa #000000; grafito y new black traen #4F4F4F.
const COLORES = {
  blanco:    { f: "#FFFFFF", e: "#000000", nombre: "Blanco" },
  roble:     { f: "#A64A14", e: "#000000", nombre: "Roble" },
  nogal:     { f: "#885728", e: "#000000", nombre: "Nogal" },
  grafito:   { f: "#1c1c1c", e: "#4F4F4F", nombre: "Grafito" },
  newblack:  { f: "#000000", e: "#4F4F4F", nombre: "New Black" },
};

// Tinte del vidrio según categoría. Winart los expone en glassCategory.hexa; acá se mapea
// por etiqueta porque la cotización de Oliver trae texto ("DVH 4+12+4"), no el id de Winart.
const VIDRIOS = {
  incoloro:  "#DEEBF7",  // DVH Incoloro (hexa real de Winart)
  bronce:    "#D9C4A0",
  gris:      "#C8CCD0",
  satinado:  "#E8ECEF",
};

function claveColor(c) {
  const t = String(c || "").toLowerCase();
  if (t.includes("roble")) return "roble";
  if (t.includes("nogal") || t.includes("madera")) return "nogal";
  if (t.includes("black") || t.includes("negro")) return "newblack";
  if (t.includes("grafito") || t.includes("gris") || t.includes("antracita")) return "grafito";
  return "blanco";
}

function claveVidrio(v) {
  const t = String(v || "").toLowerCase();
  if (t.includes("bronce")) return "bronce";
  if (t.includes("satin") || t.includes("acid") || t.includes("esmeril")) return "satinado";
  if (t.includes("gris") || t.includes("grey")) return "gris";
  return "incoloro";
}

// Acepta "1.2x1.5", "1200x1500", "1,2 X 1,5". Los valores <= 6 se leen como metros.
function medidas(m) {
  const mm = String(m || "").match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i);
  if (!mm) return { ancho: 1000, alto: 1000 };
  let a = parseFloat(mm[1].replace(",", ".")), b = parseFloat(mm[2].replace(",", "."));
  if (a <= 6) a *= 1000;
  if (b <= 6) b *= 1000;
  return { ancho: Math.round(a), alto: Math.round(b) };
}

// Los tipos que el bot puede emitir están en index.js:3530 (enum de la tool de cotización):
// CORREDERA · PROYECTANTE · ABATIBLE · OSCILOBATIENTE · MARCO_FIJO · PUERTA_1H · PUERTA_DOBLE.
// Las PUERTAS estaban cayendo al default y se dibujaban como paño fijo: una puerta salía en la
// cotización como un vidrio sin apertura. Van primero porque "PUERTA_DOBLE" no contiene ninguna
// de las otras palabras, pero el orden importa para no depender de eso.
function tipoDe(it) {
  const p = String(it?.product || it?.producto_label || "").toUpperCase();
  // [2026-08-25] COMPUESTA PRIMERO: su label es "Ventana compuesta: Fijo 1200mm +
  // Proyectante 800mm" — contiene las palabras de los otros tipos y cualquier rama de abajo
  // se la robaba (salia dibujada como una proyectante de un solo paño).
  if (p.includes("COMPUESTA")) return "COMPUESTA";
  if (p.includes("PUERTA")) return p.includes("DOBLE") || p.includes("2H") ? "PUERTA_DOBLE" : "PUERTA";
  if (p.includes("CORREDERA") || p.includes("SLIDING")) return "CORREDERA";
  if (p.includes("OSCILO")) return "OSCILOBATIENTE";
  if (p.includes("PROYECT")) return "PROYECTANTE";
  if (p.includes("ABAT") || p.includes("BATIENTE")) return "BATIENTE";
  return "FIJA";
}

// El tipo de UN paño de la compuesta (lo que devuelve el motor en compuesta.partes[].tipo).
// FIJA/PROYECTANTE/BATIENTE/OSCILOBATIENTE — los cuatro que el motor acepta como paño.
function tipoDeParte(t) {
  const s = String(t || "").toUpperCase();
  if (s.includes("OSCILO")) return "OSCILOBATIENTE";
  if (s.includes("PROYECT")) return "PROYECTANTE";
  if (s.includes("ABAT") || s.includes("BATIENTE")) return "BATIENTE";
  return "FIJA";
}

/**
 * Reparte un ancho total entre los paños según su ancho REAL (no en partes iguales),
 * dejando una separación entre medio. Un fijo de 1200 y un proyectante de 800 tienen que
 * verse 60/40 en el dibujo: el cliente compara la proporción con el hueco de su casa.
 * @param {Array<{ancho_mm:number}>} partes
 * @param {number} montante  separación en px entre paño y paño
 */
function repartirPorPartes(x, y, w, h, partes, montante, vertical = false) {
  // La compuesta VERTICAL (proyectante arriba + fijo abajo) es la MISMA ventana rotada 90
  // grados — medido en Winart el 25-ago: las versiones 66979 y 66943 devuelven la misma
  // estructura (dos marcos completos + Connector ACOPLE_MINI de 2 mm), solo cambia el eje.
  // Por eso se reparte por un eje parametrizado en vez de escribir la funcion dos veces.
  const medidas = partes.map((pt) => Math.max(1, Number(vertical ? pt.alto_mm : pt.ancho_mm) || 1));
  const suma = medidas.reduce((a, b) => a + b, 0);
  const largo = vertical ? h : w;
  const util = Math.max(1, largo - montante * (partes.length - 1));
  let cursor = vertical ? y : x;
  return partes.map((pt, idx) => {
    const t = util * (medidas[idx] / suma);
    const r = vertical
      ? { x, y: cursor, w, h: t, idx }
      : { x: cursor, y, w: t, h, idx };
    cursor += t + montante;
    return r;
  });
}

function hojasDe(it) {
  if (it?.corredera?.hojas) return Math.max(1, Number(it.corredera.hojas) || 1);
  const m = String(it?.product || "").toLowerCase().match(/(\d)\s*hoja/);
  if (m) return Math.max(1, Number(m[1]));
  const t = tipoDe(it);
  if (t === "PUERTA_DOBLE") return 2;
  return t === "CORREDERA" ? 2 : 1;
}

// Encaja el rectángulo ancho×alto dentro de la caja disponible SIN deformarlo.
// La escala tiene que ser la misma en x e y: una ventana de 2000×500 debe verse chata,
// porque el cliente compara la proporción con el hueco de su casa.
function encajar(ancho, alto, cajaW, cajaH) {
  const escala = Math.min(cajaW / ancho, cajaH / alto);
  const w = ancho * escala, h = alto * escala;
  return { w, h, escala, dx: (cajaW - w) / 2, dy: (cajaH - h) / 2 };
}

// Reparte el ancho interior en n hojas iguales, devolviendo el rect de cada una.
function repartirHojas(x, y, w, h, n) {
  const paso = w / n;
  return Array.from({ length: n }, (_, i) => ({ x: x + i * paso, y, w: paso, h, idx: i }));
}

// Símbolo de apertura, en coordenadas relativas al paño.
// Devuelve una lista de segmentos [{x1,y1,x2,y2}] a trazar con línea discontinua.
// Convención: las diagonales CONVERGEN en el lado donde están las bisagras.
function simboloApertura(tipo, r, manoDerecha = true) {
  const { x, y, w, h } = r;
  const izq = x, der = x + w, arr = y, aba = y + h;
  switch (tipo) {
    case "PROYECTANTE":
      // Bisagra ARRIBA: el vértice va al centro del borde inferior.
      return [
        { x1: izq, y1: arr, x2: x + w / 2, y2: aba },
        { x1: der, y1: arr, x2: x + w / 2, y2: aba },
      ];
    case "PUERTA":
    case "PUERTA_DOBLE":
    case "BATIENTE": {
      // Bisagra a un costado: vértice en el centro del borde opuesto.
      const bx = manoDerecha ? izq : der;
      const vx = manoDerecha ? der : izq;
      return [
        { x1: bx, y1: arr, x2: vx, y2: y + h / 2 },
        { x1: bx, y1: aba, x2: vx, y2: y + h / 2 },
      ];
    }
    case "OSCILOBATIENTE": {
      // Dos aperturas: batiente lateral + oscilante (bisagra abajo, vértice arriba).
      const bx = manoDerecha ? izq : der;
      const vx = manoDerecha ? der : izq;
      return [
        { x1: bx, y1: arr, x2: vx, y2: y + h / 2 },
        { x1: bx, y1: aba, x2: vx, y2: y + h / 2 },
        { x1: izq, y1: aba, x2: x + w / 2, y2: arr },
        { x1: der, y1: aba, x2: x + w / 2, y2: arr },
      ];
    }
    default:
      return []; // FIJA y CORREDERA no llevan diagonales (la corredera lleva flecha).
  }
}

// Plano completo: todo lo que hay que pintar, ya resuelto en coordenadas.
// Separado del pintado para poder testearlo sin pdfkit.
function planoDeVentana(it, caja) {
  const { ancho, alto } = medidas(it?.measures);
  const tipo = tipoDe(it);
  const n = hojasDe(it);
  const color = COLORES[claveColor(it?.color)] || COLORES.blanco;
  const vidrio = VIDRIOS[claveVidrio(it?.glass_label)] || VIDRIOS.incoloro;

  const { w, h, escala, dx, dy } = encajar(ancho, alto, caja.w, caja.h);
  const x = caja.x + dx, y = caja.y + dy;

  // Marco y hoja a escala real: 60 mm de marco y 40 mm de hoja son medidas de perfil PVC.
  // Con mínimos en px para que una ventana chica no quede con el marco invisible.
  const marco = Math.max(2.5, 60 * escala);
  const perfilHoja = Math.max(1.8, 40 * escala);
  // 🔴 [2026-08-25, correccion del dueño contra el plano de Winart] EL JUNQUILLO NO ES LA
  // HOJA. El junquillo es la varilla fina que sujeta el vidrio (~15 mm); la hoja es el perfil
  // grueso del bastidor que ABRE (~40 mm). Se estaban dibujando iguales, y por eso todo salia
  // con un borde gordo de mas. Textual del dueño: *"el junquillo es mucho mas delgado en la
  // original de Winart"*. En un paño FIJO ni siquiera hay hoja — el vidrio va directo al
  // marco con su junquillo, que es lo que se ve en el F1 de su plano.
  const junquillo = Math.max(0.9, 15 * escala);

  const intX = x + marco, intY = y + marco;
  const intW = Math.max(1, w - 2 * marco), intH = Math.max(1, h - 2 * marco);

  // ── COMPUESTA: DOS VENTANAS COMPLETAS ACOPLADAS, no una con divisiones ───────
  // 🔴 [2026-08-25, corrección del dueño sobre el dibujo] La primera versión dibujaba UN
  // marco exterior con los paños adentro compartiendo los lados. Eso NO es la ventana:
  // el dueño lo cazó comparando con el plano de Winart — *"quedaron unidas y deben ser
  // como separadas, ahí va la unión mini que le sacaste"*.
  // La compuesta se FABRICA como dos ventanas terminadas, cada una con sus cuatro lados de
  // marco, unidas por el perfil ACOPLE MINI (`PI-CMP-ACM`) — que es justamente el que el
  // motor cobra aparte por cada unión. Por eso acá se dibuja UN MARCO COMPLETO POR PAÑO y
  // entre ellos la junta del acople. La banda ancha del medio no se dibuja a mano: aparece
  // sola, porque son dos perfiles de marco vecinos. Dibujarla de otra forma le mostraría al
  // cliente un producto que no es el que se le fabrica ni el que se le cobra.
  const partes = (tipo === "COMPUESTA" && Array.isArray(it?.compuesta?.partes) && it.compuesta.partes.length >= 2)
    ? it.compuesta.partes : null;
  if (partes) {
    // El acople real mide ~2 mm (la cota "2" del plano de Winart). A escala se vería como
    // nada, así que lleva un piso en px para que la junta se distinga en el papel.
    const acople = Math.max(1, 2 * escala);
    // La orientacion viene del motor. Sin ella se asume horizontal, que es como salieron
    // todas las compuestas hasta hoy: una cotizacion vieja no cambia de dibujo.
    const esVertical = String(it?.compuesta?.orientacion || '').toLowerCase() === 'vertical';
    const marcosC = repartirPorPartes(x, y, w, h, partes, acople, esVertical);
    const hojasC = marcosC.map((r, i) => {
      const tp = tipoDeParte(partes[i].tipo);
      // Cada paño tiene su PROPIO marco de los 4 lados: la hoja arranca adentro de él.
      const mx = Math.min(marco, r.w / 3), my = Math.min(marco, r.h / 3);
      const hoja = {
        x: r.x + mx, y: r.y + my,
        w: Math.max(0.5, r.w - 2 * mx), h: Math.max(0.5, r.h - 2 * my),
        idx: i,
      };
      // Un FIJO no tiene bastidor: el vidrio se apoya en el marco con el junquillo. Un paño
      // que ABRE si lleva su hoja, y adentro de ella el junquillo.
      const perfil = tp === "FIJA" ? junquillo : perfilHoja;
      const insetX = Math.min(perfil, hoja.w / 3);
      const insetY = Math.min(perfil, hoja.h / 3);
      const vidrioRect = {
        x: hoja.x + insetX, y: hoja.y + insetY,
        w: Math.max(0, hoja.w - 2 * insetX), h: Math.max(0, hoja.h - 2 * insetY),
      };
      return {
        ...hoja, vidrioRect, manoDerecha: true, tipo: tp,
        // `sinBastidor` le dice al pintado que NO trace el rectangulo de la hoja: en el plano
        // real ese contorno no existe, y dibujarlo hace parecer que el fijo tambien abre.
        sinBastidor: tp === "FIJA",
        // Un paño FIJO no lleva símbolo: es justamente lo que lo distingue del que abre.
        simbolo: tp === "FIJA" ? [] : simboloApertura(tp, vidrioRect, true),
        flecha: 0,
      };
    });
    return {
      tipo, ancho, alto, escala, color, vidrio,
      // Sin marco exterior único: `marcos` son los marcos completos, uno por paño.
      marcoRect: null,
      marcos: marcosC.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
      marco, perfilHoja, junquillo, hojas: hojasC,
      compuesta: {
        orientacion: esVertical ? 'vertical' : 'horizontal',
        partes: partes.map((pt, i) => ({ tipo: tipoDeParte(pt.tipo), ancho_mm: pt.ancho_mm, alto_mm: pt.alto_mm, idx: i })),
        acople,
      },
      etiqueta: `${ancho}×${alto} mm`,
    };
  }

  const hojas = repartirHojas(intX, intY, intW, intH, n).map((r) => {
    // El perfil de la hoja NO puede ser más grueso que la hoja misma. Con un piso fijo en el
    // ancho del vidrio (max(0.5, …)) pero la posición corrida por el perfil, una hoja angosta
    // dejaba el vidrio dibujado FUERA de su hoja, derramado sobre el marco. Se ve en una
    // ventana alta y angosta de 3 hojas. (Bug cazado por Codex; mi test usaba una ventana
    // ancha y por eso pasaba.) Se acota el perfil a un tercio de la hoja en cada eje.
    // Mismo criterio que en la compuesta: una ventana FIJA no tiene hoja, solo junquillo.
    const perfil = tipo === "FIJA" ? junquillo : perfilHoja;
    const insetX = Math.min(perfil, r.w / 3);
    const insetY = Math.min(perfil, r.h / 3);
    const vidrioRect = {
      x: r.x + insetX, y: r.y + insetY,
      w: Math.max(0, r.w - 2 * insetX), h: Math.max(0, r.h - 2 * insetY),
    };
    // En una corredera las hojas alternan el sentido de deslizamiento.
    // En batiente/oscilo, con 2 hojas se abren simétricas hacia afuera (bisagras a los extremos).
    const manoDerecha = n === 1 ? true : r.idx % 2 === 0;
    return {
      ...r, vidrioRect, manoDerecha, sinBastidor: tipo === "FIJA",
      simbolo: simboloApertura(tipo, vidrioRect, manoDerecha),
      flecha: tipo === "CORREDERA" ? (r.idx % 2 === 0 ? 1 : -1) : 0,
    };
  });

  return {
    tipo, ancho, alto, escala, color, vidrio,
    marcoRect: { x, y, w, h },
    marco, perfilHoja, junquillo, hojas,
    etiqueta: `${ancho}×${alto} mm`,
  };
}

// ── Pintado con pdfkit ────────────────────────────────────────────────────────
function dibujarVentana(doc, caja, it) {
  const p = planoDeVentana(it, { x: caja.x, y: caja.y, w: caja.w, h: caja.h - 10 });
  doc.save();

  // Marco(s) exterior(es). La compuesta trae UNO POR PAÑO (son ventanas acopladas, no
  // una ventana dividida); el resto de los tipos, uno solo.
  for (const m of (p.marcos || [p.marcoRect])) {
    doc.rect(m.x, m.y, m.w, m.h).lineWidth(0.7).fillAndStroke(p.color.f, p.color.e);
    // INGLETE: los perfiles de PVC se cortan a 45 grados y se sueldan en la esquina. Winart
    // lo dibuja y es lo que hace que el marco se lea como un marco y no como un rectangulo
    // pintado. Cuatro lineas, y el plano pasa a parecerse al que el cliente ya conoce.
    const g = Math.min(p.marco, m.w / 2, m.h / 2);
    if (g > 0.4) {
      doc.save().lineWidth(0.35).strokeColor(p.color.e);
      doc.moveTo(m.x, m.y).lineTo(m.x + g, m.y + g).stroke();
      doc.moveTo(m.x + m.w, m.y).lineTo(m.x + m.w - g, m.y + g).stroke();
      doc.moveTo(m.x, m.y + m.h).lineTo(m.x + g, m.y + m.h - g).stroke();
      doc.moveTo(m.x + m.w, m.y + m.h).lineTo(m.x + m.w - g, m.y + m.h - g).stroke();
      doc.restore();
    }
  }

  for (const hoja of p.hojas) {
    // El bastidor solo existe donde hay una hoja que abre. En un fijo, dibujarlo es mentir.
    if (!hoja.sinBastidor) {
      doc.rect(hoja.x, hoja.y, hoja.w, hoja.h).lineWidth(0.5).fillAndStroke(p.color.f, p.color.e);
    }
    const v = hoja.vidrioRect;
    doc.rect(v.x, v.y, v.w, v.h).lineWidth(0.4).fillAndStroke(p.vidrio, p.color.e);

    // Diagonales de apertura, en trazo discontinuo como en plano.
    if (hoja.simbolo.length) {
      doc.save().lineWidth(0.45).dash(1.6, { space: 1.4 }).strokeColor("#6B7B8D");
      for (const s of hoja.simbolo) doc.moveTo(s.x1, s.y1).lineTo(s.x2, s.y2).stroke();
      doc.undash().restore();
    }

    // Flecha de deslizamiento (corredera), centrada en su propia hoja.
    if (hoja.flecha) {
      const cy = v.y + v.h / 2, cx = v.x + v.w / 2, d = hoja.flecha;
      const a = Math.min(5, v.w * 0.14);
      doc.polygon(
        [cx - a * d, cy - 1.8], [cx + a * 0.25 * d, cy - 1.8], [cx + a * 0.25 * d, cy - 3.6],
        [cx + a * 1.05 * d, cy], [cx + a * 0.25 * d, cy + 3.6], [cx + a * 0.25 * d, cy + 1.8],
        [cx - a * d, cy + 1.8]
      ).lineWidth(0.4).fillAndStroke("#FFFFFF", "#1A2332");
    }
  }

  doc.fillColor("#6B7B8D").fontSize(6.5).font("Helvetica")
     .text(p.etiqueta, caja.x, caja.y + caja.h - 8, { width: caja.w, align: "center" });
  doc.restore();
  return p;
}

export {
  dibujarVentana, planoDeVentana,
  medidas, tipoDe, tipoDeParte, hojasDe, claveColor, claveVidrio, encajar, repartirHojas, repartirPorPartes, simboloApertura,
  COLORES, VIDRIOS,
};
