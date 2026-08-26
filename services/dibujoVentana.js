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

/**
 * El CODIGO del vidrio tal como lo rotula la fabrica ("TP-M-4+12+4").
 *
 * [2026-08-25] Va adentro de cada paño, como en el plano de WinPerfil. No es decoracion:
 * es lo que hace que el cliente, el vendedor y el taller esten hablando del mismo vidrio.
 * Si no viene un codigo reconocible NO se inventa uno: el paño queda sin rotulo.
 */
function codigoVidrio(it) {
  const crudo = String(it?.glass_code || it?.glass_label || it?.vidrio || "");
  const m = crudo.match(/\b[A-Z]{2,}(?:-[A-Z0-9]+)*-\d+(?:\+\d+)+\b/i);
  return m ? m[0].toUpperCase() : null;
}

/**
 * La ETIQUETA de cada paño: A1, A2… para los que abren; F1, F2… para los fijos.
 * Es la nomenclatura de Winart/WinPerfil, y la que ya usa el taller.
 */
function etiquetasDePanos(tipos) {
  let a = 0, f = 0;
  return tipos.map((t) => (t === "FIJA" ? `F${++f}` : `A${++a}`));
}

// Tamaño de la manilla, en mm.
// ⚠️ NO SALE DE WINART: es el tamaño real aproximado de una manilla de cremona, puesto para
// que se vea como lo que es — algo que se agarra con la mano. No alimenta nada que se
// fabrique ni se cobre. Si algun dia hace falta la medida exacta, se saca del modelo.
const MANILLA_LARGO_MM = 120;
const MANILLA_ANCHO_MM = 26;

/**
 * La MANILLA del paño que abre.
 *
 * 🔴 [2026-08-25, correccion del dueño] VA SOBRE LA HOJA, NO SOBRE EL VIDRIO. Estaba centrada
 * en el borde del vidrio, o sea montada sobre el junquillo — textual: *"la colocaste sobre el
 * junquillo y va sobre la hoja de la ventana"*. Y salia corta: una manilla se toma con la
 * mano, mide unos 120 mm, no un puñado de pixeles proporcionales al paño.
 *
 * Ahora se apoya en la BANDA de perfil de la hoja (lo que queda entre el vidrio y el borde
 * exterior del bastidor), que es donde va atornillada en la ventana real:
 *  · proyectante → en el travesaño de ABAJO, al centro (las bisagras van arriba);
 *  · el resto con hoja → en el montante del costado, del lado contrario a las bisagras.
 * Un fijo no lleva: no se toma de ningun lado.
 *
 * @param {object} hoja
 * @param {number} escala  px por mm, para que la manilla tenga su tamaño real
 */
function manillaDe(hoja, escala) {
  if (hoja.sinBastidor) return null;
  const v = hoja.vidrioRect;
  if (!(v.w > 0 && v.h > 0)) return null;
  const esc = Number(escala) > 0 ? Number(escala) : 0.05;

  if (hoja.tipo === "PROYECTANTE") {
    // La banda de perfil de abajo: entre el borde inferior del vidrio y el de la hoja.
    const banda = (hoja.y + hoja.h) - (v.y + v.h);
    if (banda <= 0) return null;
    const largo = Math.max(3, Math.min(MANILLA_LARGO_MM * esc, v.w * 0.7));
    const grueso = Math.max(1.2, Math.min(MANILLA_ANCHO_MM * esc, banda * 0.75));
    return {
      x: v.x + v.w / 2 - largo / 2,
      y: (v.y + v.h) + (banda - grueso) / 2,   // centrada EN la banda, no encima del vidrio
      w: largo, h: grueso,
    };
  }

  // Montante vertical del lado que se abre.
  const enDerecha = !hoja.manoDerecha;
  const banda = enDerecha ? (hoja.x + hoja.w) - (v.x + v.w) : v.x - hoja.x;
  if (banda <= 0) return null;
  const largo = Math.max(3, Math.min(MANILLA_LARGO_MM * esc, v.h * 0.7));
  const grueso = Math.max(1.2, Math.min(MANILLA_ANCHO_MM * esc, banda * 0.75));
  return {
    x: enDerecha ? (v.x + v.w) + (banda - grueso) / 2 : hoja.x + (banda - grueso) / 2,
    y: v.y + v.h / 2 - largo / 2,
    w: grueso, h: largo,
  };
}

/**
 * Las COTAS del plano: el total afuera, y la medida de cada paño pegada a la ventana.
 *
 * Es como acota WinPerfil y por que importa: el cliente compara "1000 arriba, 1000 abajo"
 * con el hueco de su casa. Un total de 2002 solo no le sirve para eso.
 */
function cotasDe({ x, y, w, h, ancho, alto, marcos, partes, vertical }) {
  const c = [];
  // Medida de cada paño, en el eje por el que se reparte (la fila interior).
  if (Array.isArray(marcos) && Array.isArray(partes) && marcos.length === partes.length) {
    marcos.forEach((m, i) => {
      const mm = Math.round(Number(vertical ? partes[i].alto_mm : partes[i].ancho_mm) || 0);
      if (!mm) return;
      c.push(vertical
        ? { lado: "izq", desde: m.y, hasta: m.y + m.h, fila: 0, texto: String(mm) }
        : { lado: "sup", desde: m.x, hasta: m.x + m.w, fila: 0, texto: String(mm) });
    });
  }
  // Los totales, en la fila de afuera.
  c.push({ lado: "sup", desde: x, hasta: x + w, fila: 1, texto: String(ancho) });
  c.push({ lado: "izq", desde: y, hasta: y + h, fila: 1, texto: String(alto) });
  return c;
}

/**
 * El contorno del JUNQUILLO: el vidrio crecido por el ancho de la varilla.
 *
 * 🔴 [2026-08-25, segunda correccion del dueño] *"no se ve el junquillo"*. Tenia razon:
 * estaba en el CALCULO (el vidrio se separaba del marco lo justo) pero no en el DIBUJO — la
 * banda quedaba del mismo color que el marco y sin una linea que la separara, asi que era
 * invisible. En el plano de Winart el junquillo se lee como una linea fina alrededor del
 * vidrio. Eso es lo que devuelve esta funcion.
 */
function rectJunquillo(v, j) {
  return {
    x: v.x - j, y: v.y - j,
    w: Math.max(0, v.w + 2 * j), h: Math.max(0, v.h + 2 * j),
  };
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
  // 🔴 [2026-08-25] LEIA SOLO `product` Y EL MOTOR EMITE `producto_label`. Una corredera de
  // 3 o 4 hojas caia al default de 2 y se dibujaba con dos: el cliente veia una ventana que
  // no era la suya. `tipoDe` ya miraba los dos campos; esto se habia quedado atras.
  const m = String(it?.product || it?.producto_label || "").toLowerCase().match(/(\d)\s*hoja/);
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
/**
 * Reparte el hueco interior entre n hojas.
 *
 * 🔴 [2026-08-25, correccion del dueño] EN UNA CORREDERA LAS HOJAS NO ESTAN EN EL MISMO PLANO.
 * Textual: *"la corredera tiene 2 rieles donde corren las hojas, las estas colocando sobre el
 * mismo riel y eso no es posible para que puedan deslizarse"*. Correcto: iban pegadas una al
 * lado de la otra, tocandose — asi chocarian. Van en rieles distintos (una adelante y otra
 * atras) y se TRASLAPAN en el encuentro, que es lo que permite que una pase por delante de la
 * otra y que no quede una rendija abierta al cerrar.
 *
 * @param {boolean} corre  true en una corredera: aplica traslape y asigna riel
 * @param {number}  traslape  ancho del traslape en px (el perfil de encuentro)
 */
function repartirHojas(x, y, w, h, n, corre = false, traslape = 0) {
  const paso = w / n;
  return Array.from({ length: n }, (_, i) => {
    // Cada hoja se estira hacia sus vecinas por medio traslape: la primera y la ultima no se
    // estiran hacia afuera, porque ahi no hay vecina — ahi topan contra el marco.
    const haciaIzq = corre && i > 0 ? traslape / 2 : 0;
    const haciaDer = corre && i < n - 1 ? traslape / 2 : 0;
    return {
      x: x + i * paso - haciaIzq,
      y,
      w: paso + haciaIzq + haciaDer,
      h,
      idx: i,
      // 🔴 RIEL, Y CUAL SE VE ADELANTE (dueño, 2026-08-26): *"la hoja INTERIOR va adelante
      // tapando a la exterior"*. Todas nuestras ventanas se dibujan VISTAS DESDE ADENTRO
      // —por eso se ve el junquillo—, asi que la hoja que corre por el riel interior es la
      // que queda a la vista. riel 1 = INTERIOR = adelante; riel 0 = exterior = atras.
      // Es una convencion declarada, no una medicion: si un modelo invierte los rieles, se
      // cambia aca y en un solo lugar.
      riel: corre ? (i % 2 === 0 ? 0 : 1) : null,
    };
  });
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
  // 📏 [2026-08-25] MEDIDAS REALES DEL PERFIL S60, LEIDAS DE WINART — no estimadas.
  // El dueño pregunto si el dibujo estaba a escala. No lo estaba: se usaba marco 60 / hoja 40,
  // o sea el marco MAS GRUESO que la hoja, cuando en la ventana real es al reves. Los valores
  // salen del modelo de la version 66979 (campo `ps` y `fm.ew` de cada Frame):
  //   marco del paño que ABRE .... 40 mm      (ps.f = 40, ew [40,40,40,40])
  //   marco del paño FIJO ........ 48 mm      (ps.f = 48 — el fijo lleva marco mas ancho)
  //   hoja / bastidor ............ 58 mm      (ps.sa = 58, ew [58,58,58,58])
  //   junquillo (Bead) ........... 18,5 mm    (ps.b = 18.5, en los dos paños)
  // Winart tambien confirma lo que ya habiamos deducido del plano: en el paño FIJO el vidrio
  // cuelga del marco con su Bead y NO hay sash. La estructura del dibujo era correcta; lo que
  // estaba mal eran los gruesos.
  const MARCO_ABRE_MM = 40, MARCO_FIJO_MM = 48, HOJA_MM = 58, JUNQUILLO_MM = 18.5;
  // 🔴 [2026-08-25, dato del dueño] LA HOJA DE UNA CORREDERA NO MIDE LO MISMO QUE LA DE UNA
  // S60. Textual: *"la hoja tiene distintas alturas, por ejemplo 80 mm, 98 mm, depende del
  // modelo"*. Son las mismas opciones que ya cotiza el motor (H80 economica / H98 reforzada,
  // y en Andes H54 / H66): el dibujo tiene que mostrar la que se le cotizo, no una fija.
  // Si el item no dice cual, se usa la H80 — que es la que el motor toma por defecto en las
  // hojas de menos de 900 mm, o sea la corredera tipica.
  const HOJA_CORREDERA_DEFAULT_MM = 80;
  // 🔴 [2026-08-26, correccion del dueño] LOS 70/75 SON PROFUNDIDAD, NO ALTO DE FRENTE.
  // Textual: *"ese setenta o setenta y cinco que es el marco, que es la PROFUNDIDAD, o sea
  // desde el exterior hacia el interior... si es de setenta tiene una altura mas alta de
  // frente, y si es de setenta y cinco tiene una altura mas baja"*. Yo estaba por dibujar
  // un marco de 70 mm de frente, que habria salido gordisimo.
  // El alto de frente sale de la MISMA cota del catalogo de WinHouse, que trae los dos
  // numeros juntos: "Marco doble riel corredera: 70 · 54" → 70 de fondo, 54 DE FRENTE.
  // (Cotas del proyectista, leidas del DWG original — ver activa-thermal
  //  data/cotas_catalogo_sliding.json.)
  // ✅ MEDIDO EN EL DWG, no estimado (2026-08-26). El dueño pregunto derecho: *"lo calculaste
  // con el dwg o solo lo hiciste al ojo sin calcular nada"*. Era al ojo. Se midio.
  // Sobre Ventana_Corredera_80_S75.dxf, seccion A-A, separando la geometria del MARCO de los
  // bloques 'Hoja 80' y acotando cada uno:
  //     jamba del marco ... 48,00 mm de frente · 75,00 mm de profundidad
  //     hoja ............... 80,10 mm
  // Los 75,00 confirman el "S75" y los 80,10 la H80: el dibujo devuelve sus propios nominales
  // clavados, que es la mejor señal de que la medida esta bien tomada.
  const MARCO_CORREDERA_FRENTE_MM = 48;
  const hojaDelItem = Number(it?.hoja_mm ?? it?.hojaMm ?? it?.perfil_hoja_mm);
  const anchoHojaMm = tipo === "CORREDERA"
    ? (Number.isFinite(hojaDelItem) && hojaDelItem > 0 ? hojaDelItem : HOJA_CORREDERA_DEFAULT_MM)
    : (Number.isFinite(hojaDelItem) && hojaDelItem > 0 ? hojaDelItem : HOJA_MM);
  const marcoDe = (t) => Math.max(2, (
    tipo === "CORREDERA" ? MARCO_CORREDERA_FRENTE_MM
      : t === "FIJA" ? MARCO_FIJO_MM : MARCO_ABRE_MM) * escala);
  const marco = marcoDe(tipo);
  const perfilHoja = Math.max(1.8, anchoHojaMm * escala);
  const junquillo = Math.max(0.9, JUNQUILLO_MM * escala);

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
      // Cada paño es una ventana completa y lleva SU marco: 48 mm el fijo, 40 mm el que abre.
      const marcoP = marcoDe(tp);
      const mx = Math.min(marcoP, r.w / 3), my = Math.min(marcoP, r.h / 3);
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
        ...hoja, vidrioRect, junquilloRect: rectJunquillo(vidrioRect, Math.min(junquillo, insetX, insetY)),
        manoDerecha: true, tipo: tp,
        // `sinBastidor` le dice al pintado que NO trace el rectangulo de la hoja: en el plano
        // real ese contorno no existe, y dibujarlo hace parecer que el fijo tambien abre.
        sinBastidor: tp === "FIJA",
        // Un paño FIJO no lleva símbolo: es justamente lo que lo distingue del que abre.
        simbolo: tp === "FIJA" ? [] : simboloApertura(tp, vidrioRect, true),
        flecha: 0,
      };
    });
    const tiposC = partes.map((pt) => tipoDeParte(pt.tipo));
    const rotulosC = etiquetasDePanos(tiposC);
    hojasC.forEach((hj, i) => { hj.rotulo = rotulosC[i]; hj.manilla = manillaDe(hj, escala); });
    const marcosPub = marcosC.map((r, i) => ({ x: r.x, y: r.y, w: r.w, h: r.h, marco: marcoDe(tiposC[i]) }));
    return {
      tipo, ancho, alto, escala, color, vidrio, glassCode: codigoVidrio(it),
      cotas: cotasDe({ x, y, w, h, ancho, alto, marcos: marcosPub, partes, vertical: esVertical }),
      // Sin marco exterior único: `marcos` son los marcos completos, uno por paño.
      marcoRect: null,
      // Cada marco viaja con su propio grosor: lo usa el pintado para el inglete.
      marcos: marcosPub,
      marco, perfilHoja, junquillo, hojas: hojasC,
      compuesta: {
        orientacion: esVertical ? 'vertical' : 'horizontal',
        partes: partes.map((pt, i) => ({ tipo: tipoDeParte(pt.tipo), ancho_mm: pt.ancho_mm, alto_mm: pt.alto_mm, idx: i })),
        acople,
      },
      etiqueta: `${ancho}×${alto} mm`,
    };
  }

  // El traslape es el perfil de encuentro de las dos hojas, y mide lo mismo que la hoja:
  // Winart lo trae como `il` (interlock) con el mismo valor que `sa` (sash). Por eso sigue al
  // ancho de hoja del modelo — una H98 traslapa mas que una H80.
  const TRASLAPE_MM = anchoHojaMm;
  const corre = tipo === "CORREDERA";
  // 🔴 LA HOJA NO APOYA AL RAS DEL MARCO: LO PISA. Dueño: *"la hoja no queda encima del
  // perfil al tiro, sino traspasa el perfil... como cuatro, cinco, seis o siete milimetros
  // sobre el marco"*. Se toma 6 mm, el medio del rango que dio. Sin esto la hoja queda
  // dibujada adentro del hueco y el conjunto se ve mas chico de lo que es.
  // ✅ MEDIDO: 8,00 mm exactos. El borde interior del marco cae en x=3134,98 y el borde
  // exterior de la hoja en x=3126,98. El dueño lo habia estimado en "cuatro, cinco, seis o
  // siete"; yo habia puesto 6 por ser el medio de su rango. La medicion da 8,00.
  const PISA_MARCO_MM = 8;
  // En una corredera las hojas arrancan ANTES del borde interior del marco, porque lo pisan.
  const pisa = corre ? Math.min(PISA_MARCO_MM * escala, marco * 0.8) : 0;
  const hojas = repartirHojas(
    intX - pisa, intY - pisa, intW + 2 * pisa, intH + 2 * pisa, n, corre, TRASLAPE_MM * escala,
  ).map((r) => {
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
      ...r, vidrioRect, junquilloRect: rectJunquillo(vidrioRect, Math.min(junquillo, insetX, insetY)),
      manoDerecha, sinBastidor: tipo === "FIJA",
      simbolo: simboloApertura(tipo, vidrioRect, manoDerecha),
      flecha: tipo === "CORREDERA" ? (r.idx % 2 === 0 ? 1 : -1) : 0,
    };
  });

  // 🔴 [Gemini, compuerta] LOS ROTULOS VAN ANTES DE ORDENAR. Estaban despues, asi que en una
  // corredera se asignaban en orden de PINTADO y no de izquierda a derecha: la hoja A1 podia
  // terminar rotulada A2. En una cotizacion eso manda a fabricar la manilla en la hoja
  // equivocada. El orden visual manda para el rotulo; el de riel, solo para pintar.
  const rotulos = etiquetasDePanos(hojas.map(() => tipo));
  hojas.forEach((hj, i) => { hj.tipo = hj.tipo || tipo; hj.rotulo = rotulos[i]; hj.manilla = manillaDe(hj, escala); });
  // Recien ahora se ordena para pintar: primero las del riel de ATRAS. Al reves, la de atras
  // taparia a la de adelante justo en el traslape y se veria como no esta armada la ventana.
  if (corre) hojas.sort((a, b) => (a.riel || 0) - (b.riel || 0));
  return {
    tipo, ancho, alto, escala, color, vidrio, glassCode: codigoVidrio(it),
    cotas: cotasDe({ x, y, w, h, ancho, alto }),
    marcoRect: { x, y, w, h },
    marco, perfilHoja, junquillo, hojas,
    etiqueta: `${ancho}×${alto} mm`,
  };
}

// ── Pintado con pdfkit ────────────────────────────────────────────────────────
// Cuanto espacio se le reserva a las cotas alrededor del dibujo (izquierda y arriba).
// Dos filas: la de los paños pegada a la ventana, y la del total mas afuera.
const COTA_FILA = 9;
const COTA_MARGEN = COTA_FILA * 2 + 4;

function dibujarVentana(doc, caja, it) {
  // 📏 [2026-08-25] La ventana se achica para dejarle lugar a las cotas. Sin esto el plano
  // ocupaba toda la caja y las medidas se dibujaban encima del titulo de al lado.
  const p = planoDeVentana(it, {
    x: caja.x + COTA_MARGEN, y: caja.y + COTA_MARGEN,
    w: Math.max(20, caja.w - COTA_MARGEN), h: Math.max(20, caja.h - 10 - COTA_MARGEN),
  });
  doc.save();

  // ── COTAS: el total afuera, la medida de cada paño pegada a la ventana ──────
  // Asi acota WinPerfil, y el cliente compara cada paño con el hueco de su casa: un total
  // de "2002" solo no le sirve para eso.
  const refX = p.marcoRect ? p.marcoRect.x : Math.min(...p.marcos.map((m) => m.x));
  const refY = p.marcoRect ? p.marcoRect.y : Math.min(...p.marcos.map((m) => m.y));
  doc.save().lineWidth(0.3).strokeColor("#9AA7B4").fillColor("#6B7B8D").font("Helvetica").fontSize(5.2);
  for (const c of (p.cotas || [])) {
    const largo = Math.abs(c.hasta - c.desde);
    if (largo < 6) continue;                       // no se rotula lo que no se lee
    const t = Math.max(1.4, COTA_FILA * 0.28);     // largo de las patitas de la cota
    if (c.lado === "sup") {
      const yy = refY - COTA_FILA * (c.fila + 1);
      doc.moveTo(c.desde, yy).lineTo(c.hasta, yy).stroke();
      doc.moveTo(c.desde, yy - t).lineTo(c.desde, yy + t).stroke();
      doc.moveTo(c.hasta, yy - t).lineTo(c.hasta, yy + t).stroke();
      doc.text(c.texto, c.desde, yy - 6.4, { width: largo, align: "center" });
    } else {
      const xx = refX - COTA_FILA * (c.fila + 1);
      doc.moveTo(xx, c.desde).lineTo(xx, c.hasta).stroke();
      doc.moveTo(xx - t, c.desde).lineTo(xx + t, c.desde).stroke();
      doc.moveTo(xx - t, c.hasta).lineTo(xx + t, c.hasta).stroke();
      // El texto vertical se rota sobre el centro de la cota, como en el plano de la fabrica.
      const cy = (c.desde + c.hasta) / 2;
      doc.save().rotate(-90, { origin: [xx, cy] })
         .text(c.texto, xx - largo / 2, cy - 7.4, { width: largo, align: "center" })
         .restore();
    }
  }
  doc.restore();

  // Marco(s) exterior(es). La compuesta trae UNO POR PAÑO (son ventanas acopladas, no
  // una ventana dividida); el resto de los tipos, uno solo.
  for (const m of (p.marcos || [p.marcoRect])) {
    doc.rect(m.x, m.y, m.w, m.h).lineWidth(0.7).fillAndStroke(p.color.f, p.color.e);
    // INGLETE: los perfiles de PVC se cortan a 45 grados y se sueldan en la esquina. Winart
    // lo dibuja y es lo que hace que el marco se lea como un marco y no como un rectangulo
    // pintado. Cuatro lineas, y el plano pasa a parecerse al que el cliente ya conoce.
    const g = Math.min(m.marco || p.marco, m.w / 2, m.h / 2);
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
    // El bastidor solo existe donde hay una hoja que abre. En un fijo NO se rellena — pero
    // SI se traza su contorno: es el borde interior del marco, y sin esa linea el junquillo
    // se funde con el marco y desaparece (lo que el dueño vio: "no se ve el junquillo").
    if (hoja.sinBastidor) {
      doc.rect(hoja.x, hoja.y, hoja.w, hoja.h).lineWidth(0.45).stroke(p.color.e);
    } else {
      doc.rect(hoja.x, hoja.y, hoja.w, hoja.h).lineWidth(0.5).fillAndStroke(p.color.f, p.color.e);
    }
    // El junquillo: la varilla fina que aprieta el vidrio. Se dibuja como su propio contorno,
    // que es exactamente como se lee en el plano de Winart.
    const j = hoja.junquilloRect;
    if (j && j.w > 0 && j.h > 0) {
      doc.rect(j.x, j.y, j.w, j.h).lineWidth(0.35).stroke(p.color.e);
    }
    const v = hoja.vidrioRect;
    doc.rect(v.x, v.y, v.w, v.h).lineWidth(0.4).fillAndStroke(p.vidrio, p.color.e);

    // Diagonales de apertura, en trazo discontinuo como en plano.
    if (hoja.simbolo.length) {
      doc.save().lineWidth(0.45).dash(1.6, { space: 1.4 }).strokeColor("#6B7B8D");
      for (const s of hoja.simbolo) doc.moveTo(s.x1, s.y1).lineTo(s.x2, s.y2).stroke();
      doc.undash().restore();
    }

    // ── MANILLA del paño que abre ──────────────────────────────────────────
    // Un fijo no lleva: no se toma de ningun lado. Es una señal mas de cual abre.
    if (hoja.manilla) {
      // 🔴 [2026-08-26, correccion del dueño con la foto de su manilla] NO ES UN BLOQUE.
      // Es una ROSETA alargada con la PALANCA adentro, corrida hacia un extremo. Dibujada
      // como un rectangulo lleno parecia un tirador de mueble; asi se lee como lo que es.
      const q = hoja.manilla;
      const horiz = q.w >= q.h;
      doc.roundedRect(q.x, q.y, q.w, q.h, Math.min(q.w, q.h) / 2)
         .lineWidth(0.35).fillAndStroke("#F2F4F7", "#5A6672");
      // La palanca: mas corta que la roseta y pegada al extremo por donde se toma.
      const m = Math.min(q.w, q.h) * 0.26;
      const pl = horiz
        ? { x: q.x + q.w * 0.30, y: q.y + m, w: q.w * 0.62, h: Math.max(0.4, q.h - 2 * m) }
        : { x: q.x + m, y: q.y + q.h * 0.30, w: Math.max(0.4, q.w - 2 * m), h: q.h * 0.62 };
      if (pl.w > 0.4 && pl.h > 0.4) {
        doc.roundedRect(pl.x, pl.y, pl.w, pl.h, Math.min(pl.w, pl.h) / 2)
           .lineWidth(0.3).fillAndStroke("#C8CDD3", "#5A6672");
      }
    }

    // ── ROTULO del paño: A1 / F1, y debajo el codigo del vidrio ─────────────
    // La nomenclatura del taller. Sin esto, "la de arriba" es la unica forma de referirse
    // a un paño, y por telefono eso se presta a equivocaciones caras.
    if (hoja.rotulo) {
      const v = hoja.vidrioRect;
      const hayCodigo = !!p.glassCode;
      const alto = hayCodigo ? 12 : 6;
      if (v.w > 14 && v.h > alto + 4) {
        doc.fillColor("#44515E").font("Helvetica-Bold").fontSize(5.6)
           .text(hoja.rotulo, v.x, v.y + v.h / 2 - alto / 2, { width: v.w, align: "center" });
        if (hayCodigo) {
          doc.font("Helvetica").fontSize(4.6).fillColor("#6B7B8D")
             .text(p.glassCode, v.x, v.y + v.h / 2 - alto / 2 + 6.2, { width: v.w, align: "center" });
        }
      }
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
