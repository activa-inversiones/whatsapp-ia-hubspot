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

// Paleta CALIBRADA CONTRA LAS MUESTRAS FISICAS del dueño (foto 2026-08-26, textual: *"estos
// colores son reales y con el relieve que tienen"*). Antes venia de los hex de la API de
// Winart (2026-08-09), y la muestra real desmintio uno grande: el GRAFITO ANTRACITA fisico
// es un gris azulado medio — el #1c1c1c de la API es casi negro y en el PDF grafito y negro
// se veian iguales. La muestra manda sobre el hex del sistema: es lo que el cliente compara
// en la mano.
// `f` = relleno del perfil · `e` = linea · `veta` = tono del RELIEVE (la veta de la folia en
// roble/nogal, el grano en negro); null = folia lisa.
// [2026-08-26, segunda pasada con el muestrario en la mano] Cada folia declara ademas su
// TEXTURA y su BRILLO — pedido textual del dueno sobre la foto de las muestras: "debes darle
// el relieve veteado a los colores bien brillosos todos con su textura". Lo que se ve en las
// muestras fisicas: roble dorado y nogal con veta de madera marcada y MUY brillosos; el
// grafito antracita con grano fino tipo gofrado; el negro con granulado que destella; el
// blanco liso con puro brillo. `textura`: "madera" (hebras onduladas) / "grano" (motas
// cortas claras y oscuras) / "liso" (solo el brillo). `brillo` = factor de la hebra especular.
import { esMonorrielPorForma } from "./formaMonorriel.js";
import { esquinaDesdeLabel } from "./formaEsquina.js";

const COLORES = {
  blanco:    { f: "#F4F4F1", e: "#000000", nombre: "Blanco", veta: null, textura: "liso", brillo: 1.08 },
  roble:     { f: "#9A5B1E", e: "#000000", nombre: "Roble", veta: "#6E3C12", textura: "madera", brillo: 1.30 },   // roble dorado
  nogal:     { f: "#7C4A22", e: "#000000", nombre: "Nogal", veta: "#573112", textura: "madera", brillo: 1.26 },
  grafito:   { f: "#474C54", e: "#2A2D33", nombre: "Grafito", veta: "#383D45", textura: "grano", brillo: 1.16 },  // antracita real, gofrado fino
  newblack:  { f: "#26262A", e: "#4F4F4F", nombre: "New Black", veta: "#101014", textura: "grano", brillo: 1.55 }, // granulado con destello
};

/** Mezcla multiplicativa de un hex (misma matematica que el `tinte` del isometrico). */
function tono(hex, f) {
  const m = String(hex || "").match(/^#?([0-9a-f]{6})$/i);
  if (!m) return "#8A8F96";
  const n = parseInt(m[1], 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Pinta la TEXTURA y el BRILLO de la folia sobre UNA banda de perfil ya rellenada.
 *
 * Por que por banda y no sobre el rectangulo entero: la folia envuelve el perfil, asi que la
 * veta corre A LO LARGO de cada tramo — vertical en las jambas, horizontal en el cabezal. Una
 * veta vertical cruzando el travesano de arriba delataria el dibujo al primer vistazo.
 *
 * Determinista a proposito: la semilla sale de la geometria de la banda, asi el MISMO plano
 * dibuja las MISMAS hebras en cada corrida (los tests comparan corridas y los PDF re-emitidos
 * no cambian por azar). Nada de Math.random.
 *
 * Todo con la superficie pdfkit que los dobles de test ya conocen (save/rect/clip/moveTo/
 * lineTo/stroke) — sin opacity ni gradientes, que no estan en todos lados.
 */
function pintarTexturaBanda(doc, bnd, color, horizontal) {
  const g = horizontal ? bnd.h : bnd.w;            // grosor visible de la banda
  const largo = horizontal ? bnd.w : bnd.h;
  if (!(g > 1.4) || !(largo > 3)) return;          // no hay lugar ni para una hebra
  const textura = color.textura || (color.veta ? "madera" : "liso");
  const brillo = tono(color.f, color.brillo || 1.14);
  let sem = (Math.abs(Math.round(bnd.x * 7 + bnd.y * 13 + bnd.w * 31 + bnd.h * 57)) % 2147483645) + 1;
  const rnd = () => (sem = (sem * 48271) % 2147483647) / 2147483647;
  const linea = (off, ancho, colorHebra, ondula) => {
    doc.lineWidth(ancho).strokeColor(colorHebra);
    const tramos = ondula ? 4 : 1;
    if (horizontal) {
      const y = bnd.y + off;
      doc.moveTo(bnd.x + 0.3, y);
      for (let i = 1; i <= tramos; i++) {
        doc.lineTo(bnd.x + (bnd.w * i) / tramos - 0.3, y + (ondula ? (rnd() - 0.5) * g * 0.22 : 0));
      }
    } else {
      const x = bnd.x + off;
      doc.moveTo(x, bnd.y + 0.3);
      for (let i = 1; i <= tramos; i++) {
        doc.lineTo(x + (ondula ? (rnd() - 0.5) * g * 0.22 : 0), bnd.y + (bnd.h * i) / tramos - 0.3);
      }
    }
    doc.stroke();
  };
  doc.save().rect(bnd.x, bnd.y, bnd.w, bnd.h).clip();
  // El BRILLO: la hebra especular de la folia, corrida hacia un borde (la luz nunca pega en
  // el centro), mas una sombra fina en el borde opuesto. Es lo que la hace verse "brillosa".
  linea(g * 0.28, Math.min(0.7, g * 0.22), brillo, false);
  if (g > 3) linea(g * 0.88, 0.25, tono(color.f, 0.8), false);
  if (textura === "madera" && color.veta) {
    // La VETA: hebras onduladas a lo largo, gruesas y finas alternadas, como la muestra.
    const n = Math.max(1, Math.min(4, Math.floor(g / 2.4)));
    for (let i = 0; i < n; i++) {
      linea(g * (0.15 + 0.72 * rnd()), rnd() < 0.35 ? 0.3 : 0.18, color.veta, true);
      if (g > 5 && rnd() < 0.5) linea(g * (0.15 + 0.72 * rnd()), 0.14, tono(color.f, 1.14), true);
    }
  } else if (textura === "grano" && color.veta) {
    // El GRANO: motas cortas repartidas, oscuras y claras mezcladas — el gofrado del grafito
    // y el destello del negro salen de la misma receta con distinto `brillo`.
    const motas = Math.max(6, Math.min(70, Math.round((bnd.w * bnd.h) / 12)));
    for (let i = 0; i < motas; i++) {
      const mx = bnd.x + rnd() * (bnd.w - 0.8) + 0.3;
      const my = bnd.y + rnd() * (bnd.h - 0.8) + 0.3;
      const lm = 0.35 + rnd() * 0.55;
      doc.lineWidth(0.28).strokeColor(rnd() < 0.42 ? brillo : color.veta);
      doc.moveTo(mx, my).lineTo(mx + (horizontal ? lm : 0), my + (horizontal ? 0 : lm)).stroke();
    }
  }
  doc.restore();
}

/**
 * La textura de un PERFIL EN MARCO (4 bandas: cabezal, umbral y las dos jambas), para el
 * marco exterior y el bastidor de la hoja. `grosor` = ancho visible del perfil en px.
 */
export function pintarTexturaPerfil(doc, r, grosor, color) {
  const g = Math.max(0, Math.min(grosor, r.w / 2, r.h / 2));
  if (!(g > 1.4)) return;
  pintarTexturaBanda(doc, { x: r.x, y: r.y, w: r.w, h: g }, color, true);
  pintarTexturaBanda(doc, { x: r.x, y: r.y + r.h - g, w: r.w, h: g }, color, true);
  pintarTexturaBanda(doc, { x: r.x, y: r.y + g, w: g, h: r.h - 2 * g }, color, false);
  pintarTexturaBanda(doc, { x: r.x + r.w - g, y: r.y + g, w: g, h: r.h - 2 * g }, color, false);
}

// Tinte del vidrio según categoría. Winart los expone en glassCategory.hexa; acá se mapea
// por etiqueta porque la cotización de Oliver trae texto ("DVH 4+12+4"), no el id de Winart.
const VIDRIOS = {
  incoloro:  "#DEEBF7",  // DVH Incoloro (hexa real de Winart)
  bronce:    "#D9C4A0",
  gris:      "#C8CCD0",
  // 🔴 [2026-08-31, correccion del dueno] EL SATEN NO SE VE COMO VIDRIO NORMAL.
  // Textual: "a saten colocale un vidrio color saten, que es un vidrio que no deja ver en
  // ninguna de las 2 direcciones, porque en la cotizacion se ve como si fuera vidrio normal".
  // El valor anterior (#E8ECEF) era casi el mismo celeste del incoloro (#DEEBF7): en el PDF
  // no se distinguian. Ahora es el gris plata mate de la muestra que mando el dueno.
  satinado:  "#C6CACE",
};

function claveColor(c) {
  const t = String(c || "").toLowerCase();
  if (t.includes("roble")) return "roble";
  if (t.includes("nogal") || t.includes("madera")) return "nogal";
  if (t.includes("black") || t.includes("negro")) return "newblack";
  if (t.includes("grafito") || t.includes("gris") || t.includes("antracita")) return "grafito";
  return "blanco";
}

function claveVidrio(v, ambiente) {
  // 🔴 [2026-08-31] SE QUITAN LAS TILDES ANTES DE COMPARAR. El vidrio del bano se rotula
  // "saten" CON TILDE ("Termopanel DVH 4+12+4 saten (bano)") y aca se buscaba "satin" sin
  // tilde, asi que NO calzaba: caia a incoloro y se dibujaba transparente. Un defecto de una
  // sola letra que le mostraba al cliente un bano con vidrio que se ve.
  const t = String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (t.includes("bronce")) return "bronce";
  // "satinado" y "saten" son el mismo vidrio; "mate", "opaco" y "translucido" son como lo
  // nombra el cliente. Todos van al mismo dibujo: el que NO se ve para ningun lado.
  if (t.includes("satin") || t.includes("saten") || t.includes("acid") || t.includes("esmeril")
      || t.includes("mate") || t.includes("opaco") || t.includes("transluc")) return "satinado";
  if (t.includes("gris") || t.includes("grey")) return "gris";
  // 🔴 [2026-08-31, regla del dueno] SI ES BANO, VA SATEN. Textual: "con o sin tilde debe ser
  // ingresado asi; si dice bano ponerle [saten], porque el cliente puede decir o escribir de
  // cualquier manera". El motor ya cotiza el bano con saten, pero el DIBUJO dependia de que
  // el rotulo del vidrio lo dijera. Esta es la red: el ambiente manda igual. Se compara sin
  // tildes y sin la enie, asi "bano", "baNo", "BAÑO" y "wc" caen todos en el mismo lugar.
  const amb = String(ambiente || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/\u00f1/g, "n");
  if (/\bbanos?\b|\bwc\b|\btoilet|\bbanera|\bducha/.test(amb)) return "satinado";
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
/**
 * Es un MONORRIEL? = una sola via: UNA hoja que corre + UN paño FIJO, en UN marco.
 *
 * 🔴 [2026-09-11] Se generalizo desde `esAmericana`, que hacia lo mismo pero atado al nombre de
 * una sola linea. El dueño pidio que el dibujo se parezca AL MATERIAL QUE LLEVA DE VERDAD, y el
 * listado de materiales de Winart del monorriel ANDES (v69117, 1080x1500, ANDES-MONORIEL_HOJA_66)
 * lo dice sin ambiguedad:
 *     PI-SLA-MMC   MARCO MONORRIEL ....... 1 Pza    <- UN marco, no dos
 *     PI-SLA-A66   HOJA CORREDERA ........ 1 Pza    <- UNA hoja movil
 *     PI-SLA-TA66  TRASLAPO .............. 1 Pza
 *     HI-MLA-FNX   MANILLA ............... 1 Pza
 * O sea NO es una "ventana compuesta" (dos ventanas completas acopladas, cada una con su marco y
 * un acople de 2 mm entre medio). Es UNA ventana con dos paños. Dibujarla como compuesta le
 * muestra al cliente un producto que no es el que se le va a fabricar.
 */
function esMonorriel(it) {
  // 🔴 [2026-09-23] SE AGREGA `producto`, Y SOLO `producto`: asi se llama el campo en el item
  // que llega al PDF (webhook lo arma como `producto: it.producto_label`) y en el que se guarda
  // en la tabla `quotes`. Sin el, el dibujo no veia el texto de la ventana. Es el mismo agujero
  // que ya se habia tapado en `tipoDe` el 18-sep, en este mismo archivo.
  //
  // ⛔ NO AGREGAR `descripcion` NI NINGUN CAMPO DE TEXTO LIBRE. Estuvo puesto una hora y lo
  // volteo la compuerta cruzada (Gemini, 23-sep) con un caso que no tiene vuelta:
  //     { product: "FIJA", descripcion: "ventana fija de baño, abajo de la corredera
  //       monorriel del living" }
  // La palabra "monorriel" de OTRA ventana secuestraba esta, y como `tipoDe` consulta el
  // monorriel primero, una FIJA salia dibujada como corredera con flecha y manilla: se cobra
  // una ventana y se dibuja otra, que es exactamente el defecto que este commit viene a cerrar.
  // Es el mismo motivo por el que `enginePricer` mira SOLO el texto del item y nunca
  // `texto_cliente`. MEDIDO antes de sacarlo: el item que llega al PDF NO trae `descripcion`,
  // asi que el campo no aportaba nada y solo abria la puerta.
  const t = `${it?.product || ""} ${it?.producto_label || ""} ${it?.label || ""} ${it?.producto || ""}`;
  // 🔴 SEÑAL FUERTE: LA DECIDE `esMonorrielPorForma`, QUE ES LA UNICA FUENTE (formaMonorriel.js).
  // Antes aca vivia una copia propia, mas debil, y el 23-sep le mostro a un cliente real una
  // corredera SLIDING de dos hojas moviles sobre un monorriel que se le habia COTIZADO BIEN
  // (CM-FR-004-2026-0515, $193.891 = "Corredera ANDES 54 Monorriel"). La copia exigia un
  // conector "+" o "y" entre las palabras, y el label que sale de verdad dice "Corredera CON
  // paño fijo". La canonica ya cubria ese caso, con negaciones y conteo de hojas encima.
  // ⚠️ NO volver a escribir regex de monorriel en este archivo: se agregan alla y las dos
  // puntas —el precio y el dibujo— quedan de acuerdo por construccion.
  if (esMonorrielPorForma(t)) return true;
  // SEÑAL DEBIL: la sola palabra "americana". La linea AMERICANA es monorriel y nada mas, PERO
  // 🔴 en este repo "americana" TAMBIEN es un ambiente de la casa (cocina americana) — hay tests
  // que lo distinguen. Sin guardia, "Proyectante S60 cocina americana" se dibujaba como
  // CORREDERA. El `esAmericana` viejo no tenia el problema porque no decidia el TIPO: solo el
  // bastidor y la flecha de una ventana que YA era corredera. (Lo cazo Codex.)
  // ⚠️ La guardia va SOLO sobre la señal debil, no sobre la fuerte: si tapara las dos, un
  // "Corredera monorriel para salida a puerta de terraza" quedaba descartado por la palabra
  // "puerta" de una descripcion y se dibujaba con DOS hojas moviles en vez de una. (Lo cazo
  // Gemini en la segunda pasada.)
  if (/american[ao]/i.test(t) && !/proyect|oscilo|abat|batiente|puerta/i.test(t)) return true;
  return false;
}

function tipoDe(it) {
  // 🔴 [2026-08-26] SE MIRAN LOS DOS CAMPOS, no `product` con precedencia: segun el camino
  // (tool del LLM, pending_quote, pdf determinista) el tipo real puede venir en cualquiera
  // de los dos, y con que UNO diga "compuesta" alcanza. Con precedencia, un product generico
  // tapaba un label correcto y la ventana se dibujaba de otro tipo.
  // [2026-09-18] Se suma `producto`: asi se llama el campo en el item que se guarda en la tabla
  // `quotes` (medido en CM-FR-004-2026-0478). Si ese item llega aca, sin esto `tipoDe` no ve la
  // palabra "Corredera" y devuelve FIJA — una corredera dibujada como pano fijo.
  const p = `${String(it?.product || "")} ${String(it?.producto_label || "")} ${String(it?.producto || "")}`.toUpperCase();
  // [2026-08-25] COMPUESTA PRIMERO: su label es "Ventana compuesta: Fijo 1200mm +
  // Proyectante 800mm" — contiene las palabras de los otros tipos y cualquier rama de abajo
  // se la robaba (salia dibujada como una proyectante de un solo paño).
  // 🔴 EL MONORRIEL VA ANTES QUE COMPUESTA. Un "Fija+Corredera" tiene UN marco y UNA hoja
  // (medido en el listado de materiales de Winart): es una corredera de una via, no dos
  // ventanas acopladas. Cayendo en COMPUESTA se dibujaba con dos marcos — y peor: como el
  // buscador de paños no conocia la palabra "corredera", terminaba INVENTANDO una PROYECTANTE
  // con su triangulo punteado. Reclamo del dueño sobre una propuesta real:
  // *"PUSISTE LA FORMA DE PROYECTANTE DEBE SER LA FIGURA DE CORREDERA"*.
  if (esMonorriel(it)) return "CORREDERA";
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
// Piso en PIXELES, no en mm: a la escala de la propuesta los 120 mm reales daban ~7 px y la
// manilla no se leia. No toca el tamaño real ni nada que se fabrique o se cobre — es lo mismo
// que ya declaraba el comentario de arriba: la manilla esta para que se vea como lo que es.
const MANILLA_MIN_LARGO_PX = 13;
const MANILLA_MIN_GRUESO_PX = 3.2;

/**
 * 🔩 [2026-08-26, 2ª correccion del dueño: "una manilla mas real, la otra se ve muy falsa"]
 * Las FORMAS de una manilla de cremona real, dentro del rectangulo `q` que ya calculo
 * manillaDe(): ROSETA compacta en el extremo del pivote + CUELLO + PALANCA LIBRE en voladizo
 * con punta redondeada. El intento anterior dibujaba la roseta ocupando el largo COMPLETO
 * con la palanca adentro — leia como una calcomania, no como algo que se toma con la mano.
 * Devuelve null si no hay lugar ni para leerla (se cae al pill simple).
 */
export function manillaFormas(q) {
  if (!q) return null;
  const horiz = q.w >= q.h;
  const g = horiz ? q.h : q.w;              // grosor visible
  if (g < 2.4 || Math.max(q.w, q.h) < 7) return null;
  if (horiz) {
    // Cerrada apunta al costado: roseta a la IZQUIERDA, palanca hacia la derecha.
    const roseta = { x: q.x, y: q.y, w: Math.min(g * 0.95, q.w * 0.28), h: q.h, r: g * 0.3 };
    const ph = g * 0.58;
    const px = roseta.x + roseta.w * 0.45;
    const palanca = { x: px, y: q.y + (q.h - ph) / 2, w: (q.x + q.w) - px, h: ph, r: ph / 2 };
    const cl = g * 0.44;
    const cuello = { x: roseta.x + roseta.w / 2 - cl / 2, y: q.y + q.h / 2 - cl / 2, w: cl, h: cl, r: cl / 2 };
    return { horiz, roseta, palanca, cuello };
  }
  // Vertical: cerrada apunta hacia ABAJO — roseta ARRIBA, palanca colgando.
  const roseta = { x: q.x, y: q.y, w: q.w, h: Math.min(g * 0.95, q.h * 0.28), r: g * 0.3 };
  const pw = g * 0.58;
  const py = roseta.y + roseta.h * 0.45;
  const palanca = { x: q.x + (q.w - pw) / 2, y: py, w: pw, h: (q.y + q.h) - py, r: pw / 2 };
  const cl = g * 0.44;
  const cuello = { x: q.x + q.w / 2 - cl / 2, y: roseta.y + roseta.h / 2 - cl / 2, w: cl, h: cl, r: cl / 2 };
  return { horiz, roseta, palanca, cuello };
}

/**
 * Pinta la manilla realista en `origen` (las formas de manillaFormas, opcionalmente
 * desplazadas). El acabado es lo que la vende: palanca clara con HEBRA DE LUZ arriba y
 * sombra fina abajo (cilindro), roseta un tono mas abajo (la palanca queda ENCIMA), cuello
 * mas oscuro (esta en sombra bajo la palanca).
 */
export function pintarManilla(doc, f, dx = 0, dy = 0) {
  const R = (r) => doc.roundedRect(r.x + dx, r.y + dy, r.w, r.h, Math.min(r.r, r.w / 2, r.h / 2));
  // Degradado solo si el pdfkit real lo trae: los dobles de prueba no lo implementan, y una
  // manilla sin degradado es la de antes, no un PDF roto.
  const conDegradado = typeof doc.linearGradient === 'function';
  const grad = (x1, y1, x2, y2, paradas) => {
    const g = doc.linearGradient(x1, y1, x2, y2);
    paradas.forEach(([t, c]) => g.stop(t, c));
    return g;
  };

  // ── ROSETA: dos anillos concentricos. Una roseta de un solo tono se lee como un sticker;
  // las de verdad son una pieza torneada con un rebaje.
  R(f.roseta).lineWidth(0.32).fillAndStroke('#C9CFD6', '#46515C');
  const m = Math.min(f.roseta.w, f.roseta.h) * 0.22;
  const interior = {
    x: f.roseta.x + m, y: f.roseta.y + m,
    w: f.roseta.w - m * 2, h: f.roseta.h - m * 2, r: Math.max(0.4, f.roseta.r - m),
  };
  if (interior.w > 0.8 && interior.h > 0.8) {
    R(interior).lineWidth(0.22).fillAndStroke('#EDF0F3', '#8A939C');
  }

  // ── PALANCA CONICA. Una barra de ancho constante es lo que la hacia ver ordinaria: las
  // manillas reales se afinan hacia la punta y rematan redondeadas.
  const p = f.palanca;
  const px = p.x + dx, py = p.y + dy;
  const AFINA = 0.66;                       // grosor de la punta respecto de la base
  // La punta se arma con `polygon` y no con curvas: los dobles de prueba del repo no
  // implementan quadraticCurveTo, y no se le agrega una dependencia a un test ajeno por el
  // remate de una manilla de 6 pt. Tres segmentos alcanzan: a este tamano no se distingue.
  doc.save();
  if (f.horiz) {
    const hb = p.h, ht = p.h * AFINA;
    const yb0 = py, yb1 = py + hb;
    const yt0 = py + (hb - ht) / 2, yt1 = yt0 + ht, ym = py + hb / 2;
    const xt = px + p.w;
    doc.polygon(
      [px, yb0], [xt - ht * 0.55, yt0], [xt - ht * 0.16, yt0 + ht * 0.13], [xt, ym],
      [xt - ht * 0.16, yt1 - ht * 0.13], [xt - ht * 0.55, yt1], [px, yb1]
    );
    if (conDegradado) {
      doc.lineWidth(0.3).fillAndStroke(grad(px, yb0, px, yb1,
        [[0, '#FAFBFC'], [0.32, '#E7EAEE'], [0.62, '#C4CAD1'], [1, '#9AA2AA']]), '#46515C');
    } else {
      doc.lineWidth(0.3).fillAndStroke('#E7EAEE', '#46515C');
    }
  } else {
    const wb = p.w, wt = p.w * AFINA;
    const xb0 = px, xb1 = px + wb;
    const xt0 = px + (wb - wt) / 2, xt1 = xt0 + wt, xm = px + wb / 2;
    const yt = py + p.h;
    doc.polygon(
      [xb0, py], [xt0, yt - wt * 0.55], [xt0 + wt * 0.13, yt - wt * 0.16], [xm, yt],
      [xt1 - wt * 0.13, yt - wt * 0.16], [xt1, yt - wt * 0.55], [xb1, py]
    );
    if (conDegradado) {
      doc.lineWidth(0.3).fillAndStroke(grad(xb0, py, xb1, py,
        [[0, '#FAFBFC'], [0.32, '#E7EAEE'], [0.62, '#C4CAD1'], [1, '#9AA2AA']]), '#46515C');
    } else {
      doc.lineWidth(0.3).fillAndStroke('#E7EAEE', '#46515C');
    }
  }
  doc.restore();

  // ── CUELLO: va ENCIMA de la roseta y DEBAJO de la palanca, en sombra.
  R(f.cuello).lineWidth(0.28).fillAndStroke('#AAB2BA', '#46515C');

  // Hebra de luz: una sola, fina y corta. Sin degradado es lo unico que da volumen; con
  // degradado remata el brillo del metal.
  const largo = f.horiz ? p.w : p.h;
  doc.lineWidth(Math.max(0.2, (f.horiz ? p.h : p.w) * 0.11)).strokeColor('#FFFFFF');
  if (f.horiz) {
    doc.moveTo(px + p.r, py + p.h * 0.27).lineTo(px + largo * 0.82, py + p.h * 0.27).stroke();
  } else {
    doc.moveTo(px + p.w * 0.27, py + p.r).lineTo(px + p.w * 0.27, py + largo * 0.82).stroke();
  }
}

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
  // [2026-09-18] La hoja corredera FIJADA (la del medio en el doble riel de 3 hojas) tiene su
  // bastidor como cualquier otra, pero no se abre: no lleva manilla. Cierran contra ella las
  // dos laterales, que son las que la llevan.
  if (hoja.fijaEnSitio) return null;
  // 🔴 [2026-09-18, correccion del dueño] LA HOJA DEL CENTRO NO LLEVA MANILLA, aunque corra.
  // Textual, mirando el triple riel renderizado: *"la del centro es sin manilla"*.
  // MEDIDO contra los cuatro listados de materiales de 3 hojas: Winart factura `HI-MLA-FNX` x2
  // en TODOS — v69621 y v69623 (central fija) y tambien v69622 y v69624 (TRIPLE RIEL, donde las
  // tres corren). Dos manillas, no tres. Es coherente con las cremonas, que tambien son 2.
  // La razon fisica: la manilla cierra contra la JAMBA, y la del medio no toca ninguna.
  if (hoja.sinManilla) return null;
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

  // 🔴 [2026-09-18, correccion del dueño] LA MANILLA VA EN EL LADO DEL MARCO.
  // Textual: *"las manillas van en el lado del marco"*, con la figura al lado: flecha hacia la
  // derecha, manilla a la IZQUIERDA. Y es lo fisico: la manilla vive en el montante que cierra
  // contra la jamba, no en el traslapo donde se encuentran dos hojas — ahi no habria como
  // agarrarla ni donde poner el cerradero. Es tambien lo que muestran los planos de Winart
  // (v69621/69622: las manillas en los dos bordes exteriores de la ventana).
  // El lado sale de la FLECHA: si la hoja corre hacia la derecha, cerrada queda a la izquierda,
  // asi que la manilla va a la izquierda. `manoDerecha` (par/impar) queda solo para lo que no
  // es corredera, donde no hay flecha que consultar.
  const enDerecha = Number.isFinite(hoja.flecha) && hoja.flecha !== 0
    ? hoja.flecha < 0
    : !hoja.manoDerecha;
  const banda = enDerecha ? (hoja.x + hoja.w) - (v.x + v.w) : v.x - hoja.x;
  if (banda <= 0) return null;
  // 🔴 [2026-09-11 · CORREGIDO POR EL DUEÑO, 2a vez] LA CORREDERA SI LLEVA MANILLA QUE GIRA.
  //   Textual: *"pero SIEMPRE usa manilla que gira LARGA, nunca de embutir"*.
  //   Yo habia puesto una manilla de EMBUTIR (barra angosta hundida) asumiendo que la
  //   FORNAX del listado (HI-MLA-FNX) era de ese tipo — por el codigo del herraje, no por
  //   haberlo visto. Estaba mal y alcanzo a llegar a produccion. Vuelve a la de siempre:
  //   roseta + palanca, LARGA. Es el mismo error de siempre: deducir una pieza fisica del
  //   nombre de su codigo en vez de preguntar.
  // [2026-09-18] MANILLA MAS GRANDE. Pedido del dueño: *"ademas poner manilla grande para que
  // se vea mejor"*. A la escala de la propuesta (una ventana de 2,7 m en una caja de 156 px) los
  // 120 mm reales daban ~7 px: la manilla existia pero no se leia, y es lo que le dice al cliente
  // por donde se abre su ventana. Se sube el PISO en pixeles, no el tamaño en mm: a escala
  // grande (el plano 2D) sigue saliendo del tamaño real y nada cambia; solo crece donde era
  // invisible. El largo se sigue acotando al paño para que nunca se salga de su hoja.
  const largo = Math.min(Math.max(MANILLA_MIN_LARGO_PX, MANILLA_LARGO_MM * esc), v.h * 0.7);
  // El grueso puede pasarse de la banda del perfil: una manilla de verdad SOBRESALE del montante.
  // Lo que no puede es taparle el vidrio a la hoja, asi que se acota a un quinto del paño.
  const grueso = Math.min(
    Math.max(MANILLA_MIN_GRUESO_PX, MANILLA_ANCHO_MM * esc, banda * 0.75),
    Math.max(banda, v.w / 5),
  );
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
  // 🔴 [2026-09-11, correccion del dueño] LA CORREDERA FALTABA y caia al `return "FIJA"`:
  // el paño que corre se dibujaba como un paño fijo, sin flecha y sin manilla.
  // Textual: *"PUSISTE LA FORMA DE PROYECTANTE DEBE SER LA FIGURA DE CORREDERA"*.
  if (s.includes("CORRED") || s.includes("SLIDING")) return "CORREDERA";
  return "FIJA";
}

/**
 * 🛟 ULTIMA RED DEL DIBUJO: si una COMPUESTA llega SIN `compuesta.partes`, la composicion se
 * deriva DEL PROPIO LABEL que ve el cliente.
 *
 * [2026-08-26] Por que existe: la propuesta 0358 de Paula salio con las compuestas dibujadas
 * como UN PAÑO UNICO **con el dato correcto en todas partes menos en el item que llego al
 * dibujo**. El label del motor ya dice todo — "Proyectante 1100mm (arriba) + Fijo 1100mm
 * (abajo)" — asi que el dibujo puede reconstruir los paños de ahi, venga el item del camino
 * que venga (tool del LLM, pending_quote viejo, pdf determinista). Preferimos derivar del
 * label VISIBLE que mostrarle al cliente una ventana que no es la suya.
 *
 * Devuelve null si el label no es de compuesta o no se puede leer con confianza.
 */
export function partesDesdeLabel(it, ancho_mm, alto_mm) {
  // 🔴 [2026-08-31] NO SE CONCATENAN SI SON EL MISMO TEXTO. Antes se pegaban `product` y
  // `producto_label` siempre, y cuando los dos traian la misma descripcion de la compuesta
  // el buscador de panos la encontraba DOS VECES: una ventana de "proyectante arriba + fija
  // abajo" se dibujaba con CUATRO panos (proyectante, fija, proyectante, fija). Reclamo del
  // dueno sobre la propuesta 0395-B: "esa solo debio tener una proyectante arriba y una fija
  // abajo". El precio estaba BIEN; lo que mentia era el dibujo, que es lo que el cliente mira.
  const _a = String(it?.product || "").trim();
  const _b = String(it?.producto_label || "").trim();
  const label = (_a && _b && _a === _b) ? _a : `${_a} ${_b}`;
  if (!/compuesta/i.test(label)) return null;
  // 🔴 [Gemini, compuerta e0631c4] LA PALABRA SOLA NO ALCANZA: un label que menciona
  // "compuesta" de pasada ("Ventana Fija — no confundir con la compuesta de ayer") derivaba
  // dos paños para una ventana de UNO. Se exige señal ESTRUCTURAL de composicion ademas de
  // la palabra: el "+" de los paños, "mitad", el eje, o las posiciones. Todos los labels
  // reales del motor la tienen; una mencion suelta, no. Sin señal → null → dibujo simple.
  // Señal estructural O el nombre del producto: 'ventana compuesta' / un label que EMPIEZA
  // con 'compuesta' es el producto, no una mencion ('...con la compuesta de ayer' no pasa).
  const senial = /[+]|mitad|vertical|horizontal|superior|inferior|arriba|abajo/i.test(label)
    || /ventanas?\s+compuestas?/i.test(label)
    || /^\s*compuesta/i.test(String(it?.producto_label || it?.product || ""));
  if (!senial) return null;
  const vertical = /vertical|arriba|abajo|superior|inferior/i.test(label);

  // 1) El caso rico: el label trae cada paño con su medida — "Proyectante 1100mm (arriba)".
  const conMedida = [...label.matchAll(/(fij[ao]|proyectante|abatible|oscilobatiente|corredera|corrediza)[^\d+]{0,12}(\d+(?:[.,]\d+)?)\s*mm/gi)]
    .map((m) => ({ tipo: m[1].toUpperCase().startsWith('FIJ') ? 'FIJA'
                     : /^CORRED/i.test(m[1]) ? 'CORREDERA' : m[1].toUpperCase(),
                   mm: parseFloat(m[2].replace(',', '.')) }));
  if (conMedida.length >= 2) {
    // 🔴 [2026-08-31] LOS PANOS TIENEN QUE SUMAR LA VENTANA. Es la comprobacion que caza
    // cualquier lectura de mas, no solo la duplicacion de arriba: si los panos leidos suman
    // MUCHO mas que la medida real, se leyo de mas. Se prueba quedandose con la primera
    // mitad (que es exactamente el caso de la duplicacion) y, si tampoco cierra, se cae a
    // null: mejor un dibujo simple que uno que no es la ventana del cliente.
    const _total = vertical ? Number(alto_mm) : Number(ancho_mm);
    const _suma = (arr) => arr.reduce((s, x) => s + (Number(x.mm) || 0), 0);
    let _panos = conMedida;
    if (_total > 0) {
      const _cierra = (arr) => arr.length >= 2 && Math.abs(_suma(arr) - _total) <= Math.max(20, _total * 0.04);
      if (!_cierra(_panos)) {
        const _mitad = _panos.slice(0, Math.floor(_panos.length / 2));
        if (_cierra(_mitad)) _panos = _mitad;
        else return null;
      }
    }
    return {
      orientacion: vertical ? 'vertical' : 'horizontal',
      partes: _panos.map((p) => vertical
        ? { tipo: p.tipo, alto_mm: p.mm, ancho_mm }
        : { tipo: p.tipo, ancho_mm: p.mm, alto_mm }),
      derivado_de: 'label_con_medidas',
    };
  }

  // 2) El caso pobre: solo se sabe que es compuesta y que aperturas lleva — mitad y mitad,
  //    que es el default del dueño. Orden: en vertical el que ABRE va arriba.
  const tipos = [];
  if (/proyectante/i.test(label)) tipos.push('PROYECTANTE');
  if (/abatible/i.test(label)) tipos.push('BATIENTE');
  if (/oscilobatiente/i.test(label)) tipos.push('OSCILOBATIENTE');
  // 🔴 [2026-09-11] LA CORREDERA NO SE BUSCABA ACA, Y ESE ERA EL BUG QUE VIO EL DUEÑO.
  // Un label "Ventana compuesta Fija+Corredera" solo encontraba 'FIJA' => tipos.length < 2
  // => se disparaba el default de abajo y la ventana se dibujaba PROYECTANTE + FIJA.
  // O sea: la corredera desaparecia y en su lugar se INVENTABA una proyectante, con su
  // triangulo punteado y todo. El precio estaba bien; mentia el dibujo, que es lo que el
  // cliente mira. Textual: *"PUSISTE LA FORMA DE PROYECTANTE DEBE SER LA FIGURA DE CORREDERA"*.
  if (/corrediza|corredera/i.test(label)) tipos.push('CORREDERA');
  if (/fij[ao]/i.test(label)) tipos.push('FIJA');
  if (tipos.length < 2) tipos.splice(0, tipos.length, 'PROYECTANTE', 'FIJA');
  const eje = vertical ? alto_mm : ancho_mm;
  const mitad = Math.max(1, (eje - 3) / 2);
  return {
    orientacion: vertical ? 'vertical' : 'horizontal',
    partes: tipos.slice(0, 2).map((t) => vertical
      ? { tipo: t, alto_mm: mitad, ancho_mm }
      : { tipo: t, ancho_mm: mitad, alto_mm }),
    derivado_de: 'label_mitades',
  };
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
  // 🔴 El motor manda `hojas: 1` en un monorriel y tiene razon: es UNA hoja MOVIL. Pero el
  // DIBUJO tiene dos paños — el que corre y el fijo —, que es lo que ve el cliente y lo que
  // muestra el plano de Winart. Respetar el 1 dibujaria media ventana.
  // Un monorriel se ve con DOS paños como minimo. Si alguien declara mas (un label raro tipo
  // "monorriel 4 hojas"), se respeta lo declarado: nunca se dibujan MENOS paños de los que el
  // cliente escribio, solo se impide dibujar medio monorriel.
  if (esMonorriel(it)) return Math.max(2, Number(it?.corredera?.hojas) || 0,
    Number((String(it?.product || it?.producto_label || "").toLowerCase().match(/(\d)\s*hoja/) || [])[1]) || 0);
  if (it?.corredera?.hojas) return Math.max(1, Number(it.corredera.hojas) || 1);
  // 🔴 [2026-08-25] LEIA SOLO `product` Y EL MOTOR EMITE `producto_label`. Una corredera de
  // 3 o 4 hojas caia al default de 2 y se dibujaba con dos: el cliente veia una ventana que
  // no era la suya. `tipoDe` ya miraba los dos campos; esto se habia quedado atras.
  // 🔴 [2026-09-18] SE DIBUJABAN DOS HOJAS EN UNA VENTANA DE TRES, OTRA VEZ, POR DOS MOTIVOS
  // ENCADENADOS. Medido contra la propuesta REAL CM-FR-004-2026-0478 (Mario Grey), leyendo el
  // item tal como quedo guardado en la tabla `quotes`:
  //     { uw, color, vidrio, medidas, ambiente, cantidad, producto, unitario, referencial }
  //   1. NO viene `corredera` — el bloque que trae el nº de hojas del motor se pierde antes del
  //      PDF. Asi que la unica fuente que queda es el texto.
  //   2. El texto vive en `producto` (asi se llama el campo ahi), y esta funcion miraba
  //      `product` y `producto_label`. Dos nombres parecidos, ninguno el correcto.
  //   Y aunque lo hubiera mirado, decia "Triple hoja" EN PALABRA y el regex pedia un DIGITO.
  // El precio salio bien ($759.729, el de 3 hojas): lo unico equivocado era la figura, que es
  // justo lo que el cliente mira. Textual del dueño: *"la figura deberia tener 3 hojas reales"*.
  // 🔴 SE CONCATENAN TODOS LOS CAMPOS, NO SE ELIGE UNO. Con `a || b` gana el PRIMERO que no
  // este vacio, y en la propuesta real `product` vale "CORREDERA" (el tipo, sin el nº de hojas)
  // mientras el nº vive en `producto_label`. Con la cadena de OR, "CORREDERA" tapaba el label y
  // la de 3 hojas seguia saliendo con 2 — MEDIDO generando el PDF, no leyendo el codigo.
  // Es el MISMO error que este archivo ya tenia anotado en `tipoDe` ("SE MIRAN LOS DOS CAMPOS,
  // no `product` con precedencia"), repetido acá.
  const txt = [it?.product, it?.producto_label, it?.producto, it?.label, it?.descripcion]
    .filter(Boolean).join(' ')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const md = txt.match(/(\d)\s*hoja/);
  if (md) return Math.max(1, Number(md[1]));
  const PAL = { una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
  const mp = txt.match(/\b(una|dos|tres|cuatro|cinco|seis)\s+hojas?\b/);
  if (mp) return PAL[mp[1]];
  if (/\btriple\s+hoja/.test(txt)) return 3;
  if (/\bcuadruple\s+hoja/.test(txt)) return 4;
  const t = tipoDe(it);
  if (t === "PUERTA_DOBLE") return 2;
  return t === "CORREDERA" ? 2 : 1;
}

/**
 * ¿La hoja del MEDIO va fija? (corredera de 3 hojas en doble riel, modelo
 * S75_DOBLERIEL_TRES_HOJA_98 de Winart).
 *
 * El dibujo tiene que mostrarlo: la del centro SIN flecha y SIN manilla, rotulada F1, y las dos
 * laterales corriendo hacia ella. Dibujar las tres con flecha le muestra al cliente una ventana
 * que no es la que se le va a fabricar — es el mismo error que el paño fijo del monorriel.
 */
/**
 * ¿Es un TRIPLE RIEL? Tres vias, una hoja por via, todas corriendo hacia el mismo lado.
 * Es el otro modelo de 3 hojas de Winart (S75_TRIPLERIEL_TRES_HOJA_98) y cuesta $99.364 mas de
 * material que el de central fija: no son dos dibujos del mismo producto, son dos productos.
 */
function tripleRielDe(it) {
  const t = [it?.product, it?.producto_label, it?.producto, it?.label, it?.descripcion]
    .filter(Boolean).join(' ')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /\btriple\s+riel\b/.test(t) || /\briel\s+triple\b/.test(t)
    || /\b(?:3|tres)\s+rieles?\b/.test(t);
}

/**
 * 📐 LA COTA DEL VIDRIO, para el dibujo.
 *
 * Pedido del dueño (18-sep). Le pregunte si queria la medida del paño en la figura y contesto,
 * textual: *"a seria prudente para que cliente asocie eso"*. El punto es ese: el informe de
 * resistencia al viento habla del PAÑO (770x1747), no de la ventana (2710x1995). Si el cliente
 * no ve ese numero en el dibujo, no tiene como atar una cosa con la otra.
 *
 * Sale de `pano_vidrio`, que es lo que calcula el motor con los descuentos reales de marco y
 * hoja — el MISMO dato que se le manda al motor de vientos. Si no viene (ANDES/S60, que todavia
 * no lo exponen, o una linea sin calcular) NO se dibuja nada: una medida de vidrio inventada en
 * un plano es peor que ninguna.
 */
/**
 * TIPO de vidrio para rotular CADA pano del dibujo. Pedido del dueno (25-sep): *"deberian
 * tener el tipo de termopanel en cada vidrio que coloquemos"*.
 *
 * Sale del vidrio REAL de la partida, nunca de un default: el catalogo tiene 18 vidrios
 * SIMPLES cotizables (monolitico, laminado, espejo) y rotular uno de esos como "termopanel"
 * seria mentirle al cliente en la figura que esta mirando. Mismo criterio que
 * `etiquetaVidrioDe`, que ya lo tenia resuelto para la medida.
 *
 * Sin dato devuelve null y no se dibuja nada.
 */
export function tipoVidrioDe(it) {
  const crudo = String((it && (it.glass_label || it.glass_code || it.vidrio)) || '').trim();
  if (!crudo) return null;
  const composicion = crudo.match(/(\d+(?:\.\d+)?)\s*[+/-]\s*(\d+(?:\.\d+)?)\s*[+/-]\s*(\d+(?:\.\d+)?)/);
  const esTermopanel = !!composicion || /termopanel|dvh/i.test(crudo);
  if (!esTermopanel) return [crudo.length > 22 ? `${crudo.slice(0, 21)}…` : crudo];
  // DOS lineas: la palabra arriba y la composicion abajo. Pedido del dueno (25-sep):
  // *"termopanel debe quedar arriba de 4+12+4"*. Asi se lee como la especificacion de un
  // plano y no como una frase suelta dentro del vidrio.
  // El separador se normaliza a "+", que es como se escribe un DVH en Chile y como lo
  // escribio el dueno. El dato de origen puede venir con "/" o "-".
  if (!composicion) return ['Termopanel', 'DVH'];
  // El acabado NO se pierde: un termopanel saten en un bano es otra cosa que uno transparente,
  // y el cliente lo tiene que ver en el pano, no solo en la linea de descripcion. Medido en la
  // base viva: 17 de 280 informes traen "saten (bano)".
  const acabado = crudo.match(/(sat[eé]n|acidado|esmerilado|opaco|bronce|gris|reflectivo)/i);
  const linea2 = `${composicion[1]}+${composicion[2]}+${composicion[3]}`;
  return ['Termopanel', acabado ? `${linea2} ${acabado[1].toLowerCase()}` : linea2];
}

function etiquetaVidrioDe(it) {
  const p = it && it.pano_vidrio;
  const a = Number(p && p.ancho_mm);
  const h = Number(p && p.alto_mm);
  if (!(a > 0 && h > 0)) return null;
  // 🔴 [2026-09-18, correccion del dueño] DICE "TERMOPANEL", NO "VIDRIO". Textual: *"donde dice
  // vidrio deberia decir termopanel porque confundiria al cliente: si lee vidrio podria pensar
  // que no es termopanel"*. Tiene razon — el termopanel es LO QUE SE VENDE, y ponerle al lado la
  // palabra generica le siembra la duda justo en la figura que esta mirando.
  // ⚠️ PERO NO SE MIENTE AL REVES: hay 18 vidrios SIMPLES cotizables en el catalogo (monolitico,
  // laminado, espejo). En esos dice "vidrio", que es lo que son. La palabra sale del vidrio REAL
  // de la partida, no de un default: un monolitico rotulado "termopanel" seria peor que la duda.
  const etiquetaVidrio = String((it && (it.glass_label || it.glass_code || it.vidrio)) || '');
  const esTermopanel = /(\d+(?:\.\d+)?)\s*[+/-]\s*(\d+(?:\.\d+)?)\s*[+/-]\s*(\d+(?:\.\d+)?)/.test(etiquetaVidrio)
    || /termopanel|dvh/i.test(etiquetaVidrio);
  const palabra = esTermopanel ? 'termopanel' : 'vidrio';
  return `${palabra} ${Math.round(a)}×${Math.round(h)} mm`;
}

function centralFijaDe(it) {
  // Mismo criterio que hojasDe: se concatena, no se elige. Ver el comentario de alla.
  const t = [it?.product, it?.producto_label, it?.producto, it?.label, it?.descripcion]
    .filter(Boolean).join(' ')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /\bcentral\s+fij[ao]\b/.test(t)
    || /\bcentro\s+fij[ao]\b/.test(t)
    || /\b(?:hoja|pano|panel)\s+(?:central|del\s+centro|del\s+medio)\s+fij[ao]\b/.test(t);
}

// Encaja el rectángulo ancho×alto dentro de la caja disponible SIN deformarlo.
// La escala tiene que ser la misma en x e y: una ventana de 2000×500 debe verse chata,
// porque el cliente compara la proporción con el hueco de su casa.
/** Escala natural de una ventana en una caja, sin dibujarla. La usa quotePdf para calcular
 *  la escala COMUN de toda la propuesta: el minimo de todas. */
export function escalaNatural(it, caja) {
  const { ancho, alto } = medidas(it && it.measures);
  if (!(ancho > 0 && alto > 0 && caja.w > 0 && caja.h > 0)) return null;
  return Math.min(caja.w / ancho, caja.h / alto);
}

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
function repartirHojas(x, y, w, h, n, corre = false, traslape = 0, mono = false) {
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
      // 🔴 [2026-09-11] EN UN MONORRIEL HAY UNA SOLA VIA. La hoja que corre va ADELANTE y el
      // paño FIJO no esta sobre ningun riel: va al ras, dentro del marco. Con la regla de la
      // corredera de dos hojas (par atras / impar adelante) pasaba al reves — el paño FIJO se
      // dibujaba mas saliente que la hoja movil, y su canto quedaba como un POSTE grueso en
      // medio de la ventana que no existe en el plano de Winart. Reclamo del dueño mirando el
      // dibujo al lado del de Winart: *"LA IMAGEN DEBE PARECER MONORRIEL"*.
      // ⚠️ SUPUESTO DECLARADO: en el monorriel la hoja que CORRE es la IZQUIERDA (i === 0).
      // Es lo que muestran los dos planos de Winart que tenemos (v69117 y v69118: A2 movil a la
      // izquierda, A1 fijo a la derecha) y lo mismo que ya asumia la flecha desde antes. NO es
      // una medicion de que no exista el caso espejo: hoy nada en el pedido dice de que lado
      // corre, asi que no hay con que decidirlo. Si algun dia llega esa data, se cambia ACA y en
      // la flecha, que son los dos unicos lugares que lo asumen. (Lo levanto Gemini.)
      riel: !corre ? null : (mono ? (i === 0 ? 1 : null) : (i % 2 === 0 ? 0 : 1)),
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

// ═══════════════════════════════════════════════════════════════════════════════════════
// CATALOGO DE PERFILES POR LINEA — FUENTE UNICA DEL DIBUJO
// ═══════════════════════════════════════════════════════════════════════════════════════
// 🔴 [2026-09-11] POR QUE EXISTE ESTA TABLA. Reclamo del dueño, textual:
//   *"no quiero crear motores aparte ni soluciones parche como lo has venido haciendo,
//    quiero solucion real"*. Y tenia razon: para que el dibujo se pareciera a su plano fui
//   tapando sintomas uno por uno, y termine con DIECISEIS lugares distintos decidiendo lo
//   mismo — constantes sueltas, un ternario en el pisado, el parseo del label, una lectura
//   del webccExport. Cada arreglo tapaba un caso y dejaba los otros afuera.
//
// La regla ahora es una sola: CADA LINEA TIENE SUS MEDIDAS, EN UN SOLO LUGAR, CON SU FUENTE.
// Todo lo que dibuja lee de aca. Si un numero esta mal, se corrige UNA vez.
//
// CADA CAMPO LLEVA DE DONDE SALIO. Un numero sin fuente es un supuesto, y los supuestos de
// este archivo ya costaron una tarde entera: ver ANDES_DOBLE y SLIDING, que siguen con los
// numeros del S75 porque NO tenemos su ficha. Eso se declara, no se rellena.
//   marco     = frente del marco en elevacion (mm)
//   marcoFijo = idem para un paño fijo, cuando la linea usa otro perfil
//   hoja      = frente del bastidor de la hoja (mm); null = se toma del label o del item
//   junquillo = frente del junquillo (mm)
//   pisa      = cuanto monta la hoja SOBRE el marco (mm); 0 si no monta
const PERFILES = {
  // ✅ MEDIDO: ficha tecnica HAUSTEK "ANDES MONORRIEL", corte acotado (la mando el dueño).
  //    Sus tres cotas cierran solas y son la prueba del dibujo:
  //        marco 50 · hoja 66 · y del conjunto: 34 y 100
  //        34 + 66 = 100  =>  quedan 34 mm de marco A LA VISTA  =>  la hoja PISA 50-34 = 16
  //    ⚠️ El junquillo NO viene acotado en esa ficha: se usa el generico de 18,5 (#719).
  ANDES_MONORRIEL: { marco: 50, marcoFijo: 50, hoja: 66, junquillo: 18.5, pisa: 16,
    fuente: "ficha HAUSTEK ANDES MONORRIEL (corte acotado) — junquillo no acotado" },

  // ⏳ SIN FICHA. Conserva los numeros del S75 que habia antes. NO se le aplicaron los del
  //    monorriel: son otro perfil y suponerlo es justo el error que se quiere dejar de cometer.
  ANDES_DOBLE: { marco: 48, marcoFijo: 48, hoja: null, junquillo: 18.5, pisa: 8,
    fuente: "SIN FICHA — hereda S75 hasta que el dueño mande la del ANDES DOBLE RIEL (#719)" },

  // ✅ MEDIDO sobre el DXF Ventana_Corredera_80_S75.dxf, seccion A-A (26-ago): jamba del marco
  //    48,00 de frente · 75,00 de profundidad · hoja 80,10. La hoja sale del label (H80/H98).
  SLIDING: { marco: 48, marcoFijo: 48, hoja: null, junquillo: 18.5, pisa: 8,
    fuente: "DXF Ventana_Corredera_80_S75 seccion A-A" },

  // ⏳ SIN FICHA. AMERICANA es monorriel pero es otra linea, con su propio perfil.
  AMERICANA: { marco: 48, marcoFijo: 48, hoja: null, junquillo: 18.5, pisa: 8,
    fuente: "SIN FICHA — hereda S75 (#719)" },

  // ✅ MEDIDO en el modelo de Winart version 66979 (campo `ps` y `fm.ew` de cada Frame):
  //    marco del paño que ABRE 40 · marco del paño FIJO 48 · hoja 58 · junquillo 18,5.
  //    El fijo lleva marco MAS ANCHO que el que abre, y no lleva bastidor.
  S60: { marco: 40, marcoFijo: 48, hoja: 58, junquillo: 18.5, pisa: 0,
    fuente: "webccExport Winart v66979" },
};

/**
 * Que linea es esta ventana. Una sola funcion decide, y todo el dibujo la consulta.
 * El orden importa: lo mas especifico primero.
 */
function lineaDe(it, tipo) {
  const t = `${it?.product || ""} ${it?.producto_label || ""} ${it?.label || ""}`.toUpperCase();
  if (tipo !== "CORREDERA") return "S60";
  if (t.includes("AMERICANA")) return "AMERICANA";
  if (t.includes("SLIDING")) return "SLIDING";
  // Un monorriel es ANDES salvo que diga otra linea: decision del dueño — "mitad fija mitad
  // corredera" ES ANDES. Una corredera ANDES que no sea monorriel es la de doble riel.
  if (esMonorriel(it)) return "ANDES_MONORRIEL";
  if (t.includes("ANDES")) return "ANDES_DOBLE";
  return "SLIDING";
}

/**
 * Las medidas de perfil que le tocan a ESTA ventana, ya resueltas. Es lo unico que el dibujo
 * necesita saber sobre perfiles. Prioridad, de mayor a menor:
 *   1. lo que traiga el propio item (hoja_mm) — el motor sabe que hoja cotizo;
 *   2. el numero escrito en el label (H80/H98 de SLIDING);
 *   3. la tabla de arriba.
 * ⚠️ NO se lee del `webccExport` de Winart: lo intente y sus campos `ps.f`/`ps.sa` NO son el
 * frente en elevacion. Daban iguales en cuatro versiones y por eso me convencieron — cuatro
 * mediciones consistentes del campo equivocado dan cuatro veces el numero equivocado.
 */
function perfilesDe(it, tipo) {
  const base = PERFILES[lineaDe(it, tipo)] || PERFILES.S60;
  const delItem = Number(it?.hoja_mm ?? it?.hojaMm ?? it?.perfil_hoja_mm);
  const hoja = Number.isFinite(delItem) && delItem > 0 ? delItem
    : (base.hoja ?? hojaDelLabel(it) ?? (tipo === "CORREDERA" ? 80 : 58));
  return { ...base, hoja };
}

/** El frente de la hoja escrito en la etiqueta: "SLIDING H98" -> 98. null si no dice. */
function hojaDelLabel(it) {
  const t = `${it?.product || ""} ${it?.producto_label || ""} ${it?.label || ""}`;
  const mH = t.match(/[^A-Z]H ?(80|98)(?![0-9])/i);
  if (mH) return Number(mH[1]);
  const mJ = t.match(/hoja ?(d{2,3}) ?mm/i);
  if (mJ) return Number(mJ[1]);
  return null;
}



/**
 * `opciones.escala` fuerza una escala COMUN a todas las ventanas de la propuesta, en vez de
 * que cada una se ajuste sola a su caja. Reclamo del dueno (25-sep): *"los marcos deberian
 * estar hechos a escala... el perfil S60 se ve como si fuera mas grande de lo que es... la
 * idea es que todas las imagenes esten en la misma escala"*. Tenia razon: ajustando cada una
 * por separado, una ventana de 1000x1200 y una de 1500x1200 salian del MISMO tamano en la
 * hoja, y el mismo perfil de 40 mm se dibujaba mas grueso en la chica.
 * Nunca AMPLIA sobre lo que cabe: se toma el minimo con la escala natural de la caja, o la
 * ventana se saldria del recuadro.
 */
function planoDeVentana(it, caja, opciones) {
  const { ancho, alto } = medidas(it?.measures);
  const tipo = tipoDe(it);
  const n = hojasDe(it);
  const color = COLORES[claveColor(it?.color)] || COLORES.blanco;
  const vidrio = VIDRIOS[claveVidrio(it?.glass_label, it?.ambiente)] || VIDRIOS.incoloro;

  const natural = encajar(ancho, alto, caja.w, caja.h);
  const forzada = Number(opciones && opciones.escala);
  const esc = forzada > 0 ? Math.min(forzada, natural.escala) : natural.escala;
  const escala = esc;
  const w = ancho * esc, h = alto * esc;
  const dx = (caja.w - w) / 2, dy = (caja.h - h) / 2;
  const x = caja.x + dx, y = caja.y + dy;

  // Marco y hoja a escala real: 60 mm de marco y 40 mm de hoja son medidas de perfil PVC.
  // Con mínimos en px para que una ventana chica no quede con el marco invisible.
  // 📏 Las medidas del perfil salen de la TABLA UNICA `PERFILES` (arriba del archivo),
  // resueltas por linea. Antes esto eran dieciseis decisiones desparramadas.
  const P = perfilesDe(it, tipo);
  const anchoHojaMm = P.hoja;
  const marcoDe = (t) => Math.max(2, (t === "FIJA" ? P.marcoFijo : P.marco) * escala);
  const marco = marcoDe(tipo);
  const perfilHoja = Math.max(1.8, anchoHojaMm * escala);
  const junquillo = Math.max(0.9, P.junquillo * escala);

  const intX = x + marco, intY = y + marco;
  const intW = Math.max(1, w - 2 * marco), intH = Math.max(1, h - 2 * marco);

  // ── ESQUINA / BOW WINDOW: N VENTANAS UNIDAS POR UN CONECTOR ─────────────────
  // 🔴 [2026-09-24 · #883] Pedido del dueño sobre la bow window que estaba cotizando. Hasta
  // hoy el motor la COTIZABA (#722, #882) y el PDF no la dibujaba: salia partida en ventanas
  // sueltas, una al lado de la otra, que es lo que el dueño no quiere ver.
  // Textual: *"todas las ventanas por separado existen solo las unimos a traves de
  // conectores"* y *"colocarle las medidas ... y unidas para que se vea mas formal"*.
  //
  // ⚠️ NO SE ESCRIBE UN CAMINO NUEVO. Es la COMPUESTA horizontal con tres diferencias, y las
  // tres salen de reglas del dueño que ya estaban escritas:
  //   1. Los paños van PEGADOS (la compuesta deja el acople de 2 mm a la vista). El poste
  //      de esquina NO SE DIBUJA — regla del 11-sep: *"la ventana desde adentro no se ve ese
  //      perfil, se ve desde afuera"*, y el cliente la mira desde adentro.
  //   2. Un paño de la esquina puede ser EL MISMO una compuesta (el lateral mitad fijo mitad
  //      proyectante de #882). Se reparte su propio rectangulo con la misma funcion.
  //   3. Los paños de los EXTREMOS se dibujan mas angostos: estan girados hacia el muro y se
  //      ven en escorzo. El dueño lo pidio asi — *"que se mueva un poquito"*.
  //      🔴 ESCORZO_LATERAL es una CONVENCION DE DIBUJO, no una medida. No sale de ninguna
  //      ficha: es cuanto se acorta un paño girado para que se lea que gira. Por eso la COTA
  //      SIGUE DICIENDO LOS MILIMETROS REALES (400), no los dibujados: el cliente tiene que
  //      leer su medida, no la del papel.
  // 🛟 ULTIMA RED DE LA ESQUINA: reconstruirla desde la ETIQUETA.
  // 🔴 [2026-09-24 · #886 r2] POR QUE HACE FALTA, medido en la propuesta 0539:
  // el LLM reconstruye los items del PDF con un esquema FIJO (producto_label, measures,
  // color, qty, unit_price, glass_label, ambiente) que NO lleva geometria, y la sonda que
  // re-cotiza para el color arma sus items desde esos — o sea `measures` ya resuelto a un PAR.
  // Resultado: `esquina` se perdia en TRES sitios distintos y la bow window salia con el
  // precio correcto y dibujada como una ventana cualquiera.
  // Lo unico que sobrevive el viaje entero es la ETIQUETA, y la etiqueta lo dice todo:
  //   "Ventana en esquina (3 paños, union 90°): Compuesto 400mm (Proyectante 750mm (arriba)
  //    + Fijo 750mm (abajo)) + Fijo 2000mm + Compuesto 400mm (...)"
  // Es la MISMA red que ya existe para la compuesta (`partesDesdeLabel`, 26-ago) y por la
  // misma razon: perseguir el dato por cada camino nuevo no escala; la etiqueta siempre llega.
  // ⚠️ Se marca `derivado_de: "label"` — un dato derivado no se hace pasar por uno medido.
  const _esqLabel = esquinaDesdeLabel(it);
  const _esq = (Array.isArray(it?.esquina?.partes) && it.esquina.partes.length >= 2)
    ? it.esquina
    : _esqLabel;
  void 0;
  if (_esq) {
    const partesE = _esq.partes;
    const n = partesE.length;
    // 🔴 [2026-09-24 · #886 r2] SIN ESCORZO: LA VENTANA VA DE FRENTE, EN PROPORCION REAL.
    // Decision del dueño mirando los dos renders, textual: *"mejor la dejas de frente ... los
    // 400 que pusiste es muy pequeño para los 2000 es solo 5 veces y con lo que le pusiste se
    // ve muy pequeña, de mentira"*. Tenia razon y la cuenta lo dice: 400 contra 2000 es 1 a 5,
    // y con el escorzo de 0,52 quedaba 1 a 9,6 — el lateral se veia la mitad de lo que es.
    // ⚠️ SE INTENTO DOS VECES (0,72 y 0,52) y las dos se veian mal. El problema no era el
    // numero: era la idea. Fingir un giro acortando el ancho MIENTE sobre la proporcion, que
    // es lo unico que el cliente puede verificar contra su muro. Entre sugerir el angulo y
    // respetar la medida, manda la medida.
    // Queda en 1 a proposito y con nombre, en vez de borrar la variable: deja dicho que se
    // evaluo y se descarto, para que nadie lo "arregle" de nuevo dentro de un mes.
    // ⏭️ La perspectiva de verdad —el lateral girado con su cara en angulo— necesita dibujar
    // el perfil en 3D, y para eso estan los DWG/DXF de los perfiles que ya tenemos (el dueño
    // lo recordo en la misma conversacion). Eso es otro trabajo, no un factor.
    const ESCORZO_LATERAL = 1;
    // Los anchos DIBUJADOS: los extremos acortados, el resto tal cual. Se reparte sobre estos
    // para que el conjunto siga llenando la caja.
    const partesDibujo = partesE.map((pt, i) => ({
      ...pt,
      ancho_mm: Math.max(1, Number(pt.ancho_mm) || 1) * ((i === 0 || i === n - 1) ? ESCORZO_LATERAL : 1),
    }));
    // Pegados: una junta de medio pixel, solo para que se vea la linea entre marcos vecinos.
    const marcosE = repartirPorPartes(x, y, w, h, partesDibujo, 0.5, false);

    const hojasE = [];
    const marcosPubE = [];
    marcosE.forEach((r, i) => {
      const sub = (Array.isArray(partesE[i]?.compuesta?.partes) && partesE[i].compuesta.partes.length >= 2)
        ? partesE[i].compuesta.partes : null;
      // Un paño compuesto se reparte por DENTRO de su propio rectangulo, con la misma
      // funcion y el mismo acople de 2 mm que usa una compuesta suelta: es la misma ventana.
      const celdas = sub
        ? repartirPorPartes(r.x, r.y, r.w, r.h, sub, Math.max(1, 2 * escala), true)
        : [{ ...r, idx: 0 }];
      const tiposCelda = sub ? sub.map((pt) => tipoDeParte(pt.tipo)) : [tipoDeParte(partesE[i].tipo)];
      celdas.forEach((c, j) => {
        const tp = tiposCelda[j];
        const marcoP = marcoDe(tp);
        const mx = Math.min(marcoP, c.w / 3), my = Math.min(marcoP, c.h / 3);
        const hoja = { x: c.x + mx, y: c.y + my,
          w: Math.max(0.5, c.w - 2 * mx), h: Math.max(0.5, c.h - 2 * my), idx: hojasE.length };
        const perfil = tp === "FIJA" ? junquillo : perfilHoja;
        const insetX = Math.min(perfil, hoja.w / 3), insetY = Math.min(perfil, hoja.h / 3);
        const vidrioRect = { x: hoja.x + insetX, y: hoja.y + insetY,
          w: Math.max(0, hoja.w - 2 * insetX), h: Math.max(0, hoja.h - 2 * insetY) };
        hojasE.push({
          ...hoja, vidrioRect,
          junquilloRect: rectJunquillo(vidrioRect, Math.min(junquillo, insetX, insetY)),
          manoDerecha: true, tipo: tp,
          sinBastidor: tp === "FIJA",
          simbolo: tp === "FIJA" ? [] : simboloApertura(tp, vidrioRect, true),
          flecha: 0,
          // `pano` dice a que paño de la esquina pertenece. Lo usa el pintado para saber
          // cual va girado, sin tener que adivinarlo por la posicion.
          pano: i,
        });
        marcosPubE.push({ x: c.x, y: c.y, w: c.w, h: c.h, marco: marcoP, pano: i });
      });
    });
    hojasE.forEach((hj) => { hj.manilla = manillaDe(hj, escala); });

    // Las cotas: la de cada paño dice su medida REAL, sobre el marco dibujado en escorzo.
    // Se usa un marco por PAÑO (no por celda): el cliente cota la ventana, no sus mitades.
    const marcoPorPano = marcosE.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
    return {
      tipo: "ESQUINA", ancho, alto, escala, color, vidrio, glassCode: codigoVidrio(it),
      cotas: cotasDe({ x, y, w, h, ancho, alto, marcos: marcoPorPano, partes: partesE, vertical: false }),
      marcoRect: null,
      marcos: marcosPubE,
      marco, perfilHoja, junquillo, hojas: hojasE,
      esquina: {
        // Si la composicion NO vino del motor sino de la etiqueta, queda DECLARADO: un dato
        // derivado no se hace pasar por uno medido (misma regla que la compuesta).
        ...(_esq.derivado_de ? { derivado_de: _esq.derivado_de } : {}),
        uniones: n - 1,
        escorzo_lateral: ESCORZO_LATERAL,
        // Declarado a proposito: el poste existe y se COBRA, pero no se dibuja.
        poste_dibujado: false,
        partes: partesE.map((pt, i) => ({
          tipo: tipoDeParte(pt.tipo), ancho_mm: pt.ancho_mm, idx: i,
          girado: i === 0 || i === n - 1,
          // [#887] Si este paño se completo con un default (label sin detalle), queda dicho.
          ...(pt.derivado_de ? { derivado_de: pt.derivado_de } : {}),
        })),
      },
      etiqueta: `${ancho}×${alto} mm`,
      etiquetaVidrio: etiquetaVidrioDe(it),
    };
  }

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
  // La composicion: el dato del motor manda; si no vino, se deriva del label (ultima red).
  let _cmp = (Array.isArray(it?.compuesta?.partes) && it.compuesta.partes.length >= 2)
    ? it.compuesta : null;
  if (!_cmp && tipo === "COMPUESTA") {
    _cmp = partesDesdeLabel(it, ancho, alto);
    if (_cmp) it = { ...it, compuesta: _cmp };
  }
  const partes = _cmp ? _cmp.partes : null;
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
        // 🔴 [2026-09-11] En una compuesta la flecha estaba clavada en 0, asi que un paño
        // CORREDERA quedaba sin la unica señal que dice hacia donde corre. `simboloApertura`
        // ya devuelve [] para CORREDERA (no lleva diagonales): sin flecha no llevaba NADA.
        // La corredera de una compuesta corre hacia el paño fijo, que es el que tiene al lado.
        flecha: tp === "CORREDERA" ? (i === 0 ? 1 : -1) : 0,
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
        // Si la composicion NO vino del motor sino del label, queda declarado: un dato
        // derivado no puede hacerse pasar por un dato medido (regla de la casa).
        ...(_cmp && _cmp.derivado_de ? { derivado_de: _cmp.derivado_de } : {}),
      },
      etiqueta: `${ancho}×${alto} mm`,
      etiquetaVidrio: etiquetaVidrioDe(it),
    };
  }

  // El traslape es el perfil de encuentro de las dos hojas, y mide lo mismo que la hoja:
  // Winart lo trae como `il` (interlock) con el mismo valor que `sa` (sash). Por eso sigue al
  // ancho de hoja del modelo — una H98 traslapa mas que una H80.
  const TRASLAPE_MM = anchoHojaMm;
  const corre = tipo === "CORREDERA";
  // 🔴 [2026-08-27, correccion del dueño con el plano de Winart] LA AMERICANA MONORRIEL TIENE
  // UN PAÑO FIJO: "un lado no tiene hoja". Una hoja CORRE (bastidor + flecha + manilla) y la
  // otra es vidrio FIJO en el marco (sin bastidor). No es una corredera de dos hojas moviles.
  // [2026-09-11] Era `esAmericana`: el mismo dibujo sirve para CUALQUIER monorriel (ANDES
  // incluido), no solo para esa linea. Ver esMonorriel().
  const esMono = esMonorriel(it);
  // 🔴 LA HOJA NO APOYA AL RAS DEL MARCO: LO PISA. Dueño: *"la hoja no queda encima del
  // perfil al tiro, sino traspasa el perfil... como cuatro, cinco, seis o siete milimetros
  // sobre el marco"*. Se toma 6 mm, el medio del rango que dio. Sin esto la hoja queda
  // dibujada adentro del hueco y el conjunto se ve mas chico de lo que es.
  // ✅ MEDIDO: 8,00 mm exactos. El borde interior del marco cae en x=3134,98 y el borde
  // exterior de la hoja en x=3126,98. El dueño lo habia estimado en "cuatro, cinco, seis o
  // siete"; yo habia puesto 6 por ser el medio de su rango. La medicion da 8,00.
  // 🔴 [2026-09-11] EN ANDES MONORRIEL EL PISADO ES 16 mm, Y SALE DE LA FICHA, NO DE UN AJUSTE.
  // El dueño mando el corte acotado de HAUSTEK y dijo: *"la imagen es exactamente como queda la
  // hoja sobre el marco"*. Las cotas de ese corte cierran solas:
  //     marco 50 · hoja 66 · y las dos cotas del conjunto: 34 y 100
  //     34 + 66 = 100  =>  del marco quedan 34 mm A LA VISTA  =>  la hoja PISA 50 - 34 = 16 mm
  // Con los 8 mm que usabamos (medidos sobre el DXF de una SLIDING S75, otra linea) quedaban 42
  // de marco visible en vez de 34, y por eso el marco se veia mas gordo de lo que es.
  // ⏳ Para SLIDING se conservan los 8 mm medidos en SU dxf: cada linea con su dato (#719).
  const PISA_MARCO_MM = P.pisa;
  // En una corredera las hojas arrancan ANTES del borde interior del marco, porque lo pisan.
  const pisa = corre ? Math.min(PISA_MARCO_MM * escala, marco * 0.8) : 0;
  // Cuál paño va fijo: el del medio, y solo si son impares y el pedido lo dice. Con -1 no hay
  // ninguno fijo y todo se dibuja exactamente como antes.
  const idxFija = (corre && !esMono && n >= 3 && n % 2 === 1 && centralFijaDe(it)) ? (n - 1) / 2 : -1;
  // 🔴 [2026-09-18, correccion del dueño] EL TRIPLE RIEL TIENE TRES VIAS, NO DOS. Textual:
  // *"te quedo como 2 rieles, las hojas se desplazan sobre rieles diferentes, todas las flechas
  // ademas hacia el mismo lado"*. Es su propia regla de negocio del 18-sep: *"si quiere mover
  // las tres hacia un lado es triple riel y se mueven las 3 en tres rieles diferentes"*, y es el
  // modelo S75_TRIPLERIEL_TRES_HOJA_98 de Winart (version de referencia 69622).
  // `repartirHojas` alterna par/impar porque asume DOS vias — correcto para el doble riel, que
  // es lo unico que existia hasta hoy. Con tres hojas sobre tres rieles cada una va a su propia
  // profundidad y TODAS corren hacia el mismo lado: se apilan juntas contra un costado.
  const esTripleRiel = corre && !esMono && n >= 3 && idxFija < 0 && tripleRielDe(it);
  const hojas = repartirHojas(
    intX - pisa, intY - pisa, intW + 2 * pisa, intH + 2 * pisa, n, corre, TRASLAPE_MM * escala, esMono,
  ).map((r) => {
    // El perfil de la hoja NO puede ser más grueso que la hoja misma. Con un piso fijo en el
    // ancho del vidrio (max(0.5, …)) pero la posición corrida por el perfil, una hoja angosta
    // dejaba el vidrio dibujado FUERA de su hoja, derramado sobre el marco. Se ve en una
    // ventana alta y angosta de 3 hojas. (Bug cazado por Codex; mi test usaba una ventana
    // ancha y por eso pasaba.) Se acota el perfil a un tercio de la hoja en cada eje.
    // Mismo criterio que en la compuesta: una ventana FIJA no tiene hoja, solo junquillo.
    // 🔴 [2026-09-11, correccion del dueño] EL PAÑO FIJO NO LLEVA EL ANCHO DEL BASTIDOR.
    // Textual: *"el marco se ve el doble que la hoja vista de elevacion, o sea vista de frente"*.
    // MEDIDO: el lado fijo daba 108 mm de banda contra los 66 de la hoja — el doble, tal cual.
    // La causa: aca se miraba el tipo de la VENTANA (`tipo === "FIJA"`) y no el del PAÑO, asi que
    // el paño fijo de un monorriel —que no tiene hoja— se metia el vidrio 66 mm adentro como si
    // la tuviera. Sumado al marco daba 42 + 66 = 108. Lo correcto es marco + junquillo.
    // Es el mismo descuido que el contorno fantasma de hace un rato: la geometria sabia que el
    // fijo no tiene bastidor (`sinBastidor`), pero este calculo no lo consultaba.
    // [2026-09-18] LA HOJA DEL MEDIO, CUANDO VA FIJA. En la corredera de 3 hojas en doble riel
    // (modelo S75_DOBLERIEL_TRES_HOJA_98 de Winart) la del centro NO corre: va fija, y las dos
    // laterales cierran contra ella. El motor ya lo cobra asi desde hoy (4 carros, no 6).
    //
    // 🔴 PERO SIGUE SIENDO UNA HOJA CORREDERA, CON SU BASTIDOR. Correccion del dueño sobre el
    // primer intento, textual: *"debe quedar con hoja corredera, quedo solo termopanel"*. Y el
    // BOM real de Winart (v69621) le da la razon sin ambiguedad: factura `PI-SLD-H98` x3 —tres
    // perfiles de hoja, uno por pano, incluido el fijo— y la pieza que lo inmoviliza se llama
    // literalmente `HL-SUP-HCF-MA` = "SUPLE HOJA CORREDERA A FIJA". Es una hoja corredera
    // FIJADA, no un vidrio pegado al marco. Dibujarla sin bastidor mostraba un producto que no
    // se fabrica y, de paso, contradecia el listado de materiales que ya se cobra.
    // Por eso NO se le cambia el tipo (seguiria el camino del pano fijo, que no lleva hoja):
    // se marca `fijaEnSitio`, que quita SOLO la flecha y la manilla.
    const fijaEnSitio = r.idx === idxFija;
    const tipoPano = tipo;
    const sinB = tipoPano === "FIJA" || (esMono && r.idx >= 1);
    const perfil = sinB ? junquillo : perfilHoja;
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
      manoDerecha,
      // Americana: el paño derecho (idx>=1) es FIJO — no lleva bastidor (manillaDe le devuelve
      // null solo por eso) ni flecha. El izquierdo corre hacia el fijo.
      sinBastidor: sinB,
      tipo: tipoPano,
      fijaEnSitio,
      // La del medio no cierra contra ninguna jamba, asi que no lleva manilla — lo factura asi
      // Winart en las cuatro anclas de 3 hojas (2 manillas, no 3). Solo se aplica con un numero
      // IMPAR de hojas, que es donde hay un "medio": en 2 y 4 hojas no se toca nada, y ahi la
      // calibracion dice 2 y 3 manillas respectivamente.
      sinManilla: corre && n >= 3 && n % 2 === 1 && r.idx === (n - 1) / 2,
      // 🔴 [2026-09-18, 2a correccion del dueño] LA HOJA FIJADA VA EN EL OTRO RIEL, POR FUERA.
      // Textual: *"me gustaria que quedara en el otro riel o sea por fuera"*. Ademas de como se
      // ve, es lo que hace que la ventana FUNCIONE: las dos laterales tienen que poder correr
      // POR DELANTE de la fija, y para eso la fija no puede compartir su via. Por defecto
      // `repartirHojas` alterna par/impar y le tocaba el riel interior (adelante), justo el que
      // necesitan las que se mueven. Convencion de la casa: riel 1 = interior = adelante.
      ...(idxFija >= 0 ? { riel: fijaEnSitio ? 0 : 1 } : null),
      // Triple riel: cada hoja en SU via. riel 0 = la mas exterior (atras), riel n-1 = interior
      // (adelante). El pintado ordena por riel, asi que quedan escalonadas de verdad.
      ...(esTripleRiel ? { riel: r.idx } : null),
      simbolo: simboloApertura(tipoPano, vidrioRect, manoDerecha),
      // La hoja fijada no lleva flecha, y las laterales corren HACIA ella: la de la izquierda
      // hacia la derecha y la de la derecha hacia la izquierda, como en el dibujo de Winart.
      flecha: esMono
        ? (r.idx === 0 ? 1 : 0)
        : (tipoPano !== "CORREDERA" || fijaEnSitio ? 0
          // Triple riel: TODAS al mismo lado — se apilan juntas contra un costado.
          : esTripleRiel ? 1
            : (idxFija >= 0 ? (r.idx < idxFija ? 1 : -1) : (r.idx % 2 === 0 ? 1 : -1))),
    };
  });

  // 🔴 [Gemini, compuerta] LOS ROTULOS VAN ANTES DE ORDENAR. Estaban despues, asi que en una
  // corredera se asignaban en orden de PINTADO y no de izquierda a derecha: la hoja A1 podia
  // terminar rotulada A2. En una cotizacion eso manda a fabricar la manilla en la hoja
  // equivocada. El orden visual manda para el rotulo; el de riel, solo para pintar.
  // Los rotulos salen del tipo de CADA paño, no del de la ventana: con la central fija, el del
  // medio es F1 y los laterales A1/A2, igual que los rotula Winart.
  const rotulos = etiquetasDePanos(hojas.map((hj) => hj.tipo || tipo));
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
    etiquetaVidrio: etiquetaVidrioDe(it),
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
    pintarTexturaPerfil(doc, m, g, p.color);   // la folia, antes del inglete (que va encima)
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
      // El bastidor tambien es folia: mismo tratamiento que el marco.
      const gB = ((hoja.junquilloRect || hoja.vidrioRect || {}).x ?? hoja.x) - hoja.x;
      pintarTexturaPerfil(doc, hoja, gB, p.color);
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
      const f = manillaFormas(q);
      if (f) {
        pintarManilla(doc, f);
      } else {
        // Sin lugar para el detalle: el pill simple de siempre, mejor que nada ilegible.
        doc.roundedRect(q.x, q.y, q.w, q.h, Math.min(q.w, q.h) / 2)
           .lineWidth(0.35).fillAndStroke("#F2F4F7", "#5A6672");
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
