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
// LÍMITE CONOCIDO: el motor cotiza 5 tipos SUELTOS (FIJA/CORREDERA/PROYECTANTE/BATIENTE/
// OSCILOBATIENTE). La ventana COMPUESTA que más se vende ("mitad fija, mitad proyectante,
// unidas", dueño 2026-08-08) hoy se cotiza como dos ítems ⇒ no se puede dibujar como una sola.
// Eso NO se arregla acá: necesita un tipo compuesto en quoteEngine.js (toca precio ⇒ propuesta).

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

function tipoDe(it) {
  const p = String(it?.product || it?.producto_label || "").toUpperCase();
  if (p.includes("CORREDERA") || p.includes("SLIDING")) return "CORREDERA";
  if (p.includes("OSCILO")) return "OSCILOBATIENTE";
  if (p.includes("PROYECT")) return "PROYECTANTE";
  if (p.includes("ABAT") || p.includes("BATIENTE")) return "BATIENTE";
  return "FIJA";
}

function hojasDe(it) {
  if (it?.corredera?.hojas) return Math.max(1, Number(it.corredera.hojas) || 1);
  const m = String(it?.product || "").toLowerCase().match(/(\d)\s*hoja/);
  if (m) return Math.max(1, Number(m[1]));
  return tipoDe(it) === "CORREDERA" ? 2 : 1;
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

  const intX = x + marco, intY = y + marco;
  const intW = Math.max(1, w - 2 * marco), intH = Math.max(1, h - 2 * marco);
  const hojas = repartirHojas(intX, intY, intW, intH, n).map((r) => {
    const vidrioRect = {
      x: r.x + perfilHoja, y: r.y + perfilHoja,
      w: Math.max(0.5, r.w - 2 * perfilHoja), h: Math.max(0.5, r.h - 2 * perfilHoja),
    };
    // En una corredera las hojas alternan el sentido de deslizamiento.
    // En batiente/oscilo, con 2 hojas se abren simétricas hacia afuera (bisagras a los extremos).
    const manoDerecha = n === 1 ? true : r.idx % 2 === 0;
    return {
      ...r, vidrioRect, manoDerecha,
      simbolo: simboloApertura(tipo, vidrioRect, manoDerecha),
      flecha: tipo === "CORREDERA" ? (r.idx % 2 === 0 ? 1 : -1) : 0,
    };
  });

  return {
    tipo, ancho, alto, escala, color, vidrio,
    marcoRect: { x, y, w, h },
    marco, perfilHoja, hojas,
    etiqueta: `${ancho}×${alto} mm`,
  };
}

// ── Pintado con pdfkit ────────────────────────────────────────────────────────
function dibujarVentana(doc, caja, it) {
  const p = planoDeVentana(it, { x: caja.x, y: caja.y, w: caja.w, h: caja.h - 10 });
  doc.save();

  // Marco exterior.
  doc.rect(p.marcoRect.x, p.marcoRect.y, p.marcoRect.w, p.marcoRect.h)
     .lineWidth(0.7).fillAndStroke(p.color.f, p.color.e);

  for (const hoja of p.hojas) {
    doc.rect(hoja.x, hoja.y, hoja.w, hoja.h).lineWidth(0.5).fillAndStroke(p.color.f, p.color.e);
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
  medidas, tipoDe, hojasDe, claveColor, claveVidrio, encajar, repartirHojas, simboloApertura,
  COLORES, VIDRIOS,
};
