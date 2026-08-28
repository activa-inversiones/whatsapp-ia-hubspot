// informeVientosPdf.js — [2026-08-28]
//
// EL INFORME DE VIENTOS que Oliver entrega en la secuencia (pedido del dueno: *"dale,
// agrega el informe de vientos a la secuencia de Oliver"*).
//
// Misma identidad visual que el informe termico (NAVY + GOLD) y las MISMAS reglas de
// honestidad: cada numero viene del motor de THERMAL (ASTM E1300-16, curvas cosechadas de
// la app del informe real del evaluador), los supuestos se DECLARAN, una ventana sin
// calculo sale como "requiere calculo del especialista" (jamas con un numero inventado), y
// cero guiones largos (doctrina del dueno 27-ago: "se ve falso").
//
// Folio: serie LOCAL propia INF-V-AAAA-NNNN mientras sales-os no tenga la serie CM-FR para
// vientos (tablero #541). Un folio visible y consecutivo local es auditable; disfrazar la
// serie del termico no.

import PDFDocument from 'pdfkit';

const NAVY = '#0B3D6F';
const GOLD = '#C4993B';
const W = 595;   // A4 vertical, mismos margenes que el termico

// Del mas delgado (curva mas baja, tono mas claro) al mas grueso: el ojo lee la
// jerarquia sin leyenda. GOLD queda reservado para las lineas de exigencia legal.
// [Copilot, compuerta] el fallback de un espesor NUEVO es un gris azulado propio, no el
// mismo NAVY del 8 mm: dos curvas del mismo color eran indistinguibles.
const COLOR_ESPESOR = { 4: '#9DB8D6', 5: '#6FA0CC', 6: '#2E6DA4', 8: '#0B3D6F' };
const COLOR_ESPESOR_NUEVO = '#6B7A8C';
const VERDE = '#1F7A43';
const ROJO = '#B4232A';

function dec(x, n = 2) {
  return (x === null || x === undefined || Number.isNaN(Number(x)))
    ? '—'.replace('—', '-')                       // ni aca entra un guion largo
    : Number(x).toFixed(n).replace('.', ',');
}

/**
 * @param {object} datos  respuesta del motor THERMAL /api/v1/vientos (ventanas+demanda)
 * @param {object} opts   { nombre, comuna, numeroInforme, ilegibles, firma }
 * @returns {Promise<Buffer>}
 */
export async function generarInformeVientosPdf(datos, {
  nombre = '', comuna = '', numeroInforme = '', ilegibles = 0, firma = {},
} = {}) {
  if (!datos || !Array.isArray(datos.ventanas) || !datos.ventanas.length) return null;
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Informe de vientos ${numeroInforme}` } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const fin = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  // ── Cabecera de marca (identica al termico) ─────────────────────────────
  doc.rect(0, 0, W, 90).fill(NAVY);
  doc.fillColor('#fff').fontSize(22).font('Helvetica-Bold').text('ACTIVA INVERSIONES', 50, 28);
  doc.fillColor(GOLD).fontSize(10).font('Helvetica').text('Ventanas PVC · Termopanel · Fábrica en Temuco', 50, 56);
  doc.fillColor('#fff').fontSize(9).text('Evaluación energética acreditada MINVU', 50, 72);

  doc.fillColor(NAVY).fontSize(20).font('Helvetica-Bold').text('INFORME DE VIENTOS', 50, 112);
  doc.fillColor(GOLD).fontSize(12).font('Helvetica-Bold')
    .text(comuna ? `Comuna de ${comuna}` : 'Resistencia del vidriado', 50, 138);
  doc.fillColor('#444').fontSize(9).font('Helvetica')
    .text(`Emitido: ${new Date().toLocaleDateString('es-CL')}   ·   Informe N° ${numeroInforme}`
      + `${nombre ? `   ·   Preparado para: ${String(nombre).trim()}` : ''}`, 50, 161);

  doc.rect(50, 178, W - 100, 26).fill('#F7F9FC');
  doc.fillColor('#333').fontSize(8).font('Helvetica')
    .text('Este documento informa la resistencia del vidriado de su proyecto frente a la presión del viento. '
      + 'No es una cotización ni contiene precios: su propuesta económica se envía por separado.', 58, 185, { width: W - 116 });

  const legal = 'DOCUMENTO CONFIDENCIAL: USO EXCLUSIVO DEL DESTINATARIO. Este informe fue preparado '
    + `${nombre ? `para ${String(nombre).trim()} y ` : ''}para el proyecto que lo motivó. Su contenido y cálculos son de `
    + 'Activa Inversiones EIRL, RUT 76.486.825-0. Queda prohibida su reproducción total o parcial y su uso por '
    + 'terceros o para un proyecto distinto sin autorización escrita previa.';
  doc.rect(50, 212, W - 100, 44).fill('#FDF6E9');
  doc.fillColor('#7A5B14').fontSize(8).font('Helvetica').text(legal, 58, 218, { width: W - 116 });

  // ── Tabla de ventanas ───────────────────────────────────────────────────
  let y = 274;
  doc.rect(50, y, W - 100, 22).fill(NAVY);
  doc.fillColor(GOLD).fontSize(9).font('Helvetica-Bold').text('LA RESISTENCIA DE SUS VENTANAS', 58, y + 7);
  doc.fillColor('#cbd5e1').fontSize(8).font('Helvetica')
    .text(`${datos.ventanas.length} ventana(s)`, W - 160, y + 7, { width: 100, align: 'right' });
  y += 30;
  const X = { n: 52, med: 200, lr: 300, fle: 390, ver: 470 };
  doc.fillColor('#666').fontSize(7.5).font('Helvetica-Bold');
  doc.text('VENTANA', X.n, y); doc.text('MEDIDAS · VIDRIO', X.med, y);
  doc.text('RESISTE HASTA', X.lr, y); doc.text('FLECHA EST.', X.fle, y); doc.text('VEREDICTO', X.ver, y);
  y += 12;
  doc.moveTo(50, y).lineTo(W - 50, y).strokeColor('#D8DEE8').lineWidth(0.7).stroke();
  y += 6;
  doc.font('Helvetica').fontSize(8.5);
  for (const v of datos.ventanas) {
    const cap = v.capacidad || {};
    const ver = v.veredicto || {};
    const fle = v.flechas || {};
    const hueco = Boolean(cap._hueco);
    doc.fillColor('#222').text(String(v.nombre || '').slice(0, 34) + (v.cantidad > 1 ? `  (×${v.cantidad})` : ''), X.n, y, { width: 142 });
    // [Copilot, compuerta] Dims con guard: un campo ausente del motor jamas imprime
    // "undefined" en un documento que ve el cliente.
    const dims = (v.ancho_mm && v.alto_mm) ? `${v.ancho_mm}×${v.alto_mm} mm · ` : '';
    doc.fillColor('#444').text(`${dims}${String(v.vidrio || '').replace('DVH ', '')}`, X.med, y, { width: 96 });
    if (hueco) {
      doc.fillColor('#8A6D1C').text('requiere cálculo del especialista', X.lr, y, { width: 180 });
    } else {
      doc.fillColor(NAVY).font('Helvetica-Bold').text(`${dec(cap.lr_corta_kPa)} kPa`, X.lr, y, { width: 80 });
      doc.font('Helvetica').fillColor('#444');
      const w1 = fle?.referencia?.flecha_maxima_mm;
      doc.text(w1 ? `${dec(w1, 1)} mm` : 'baja', X.fle, y, { width: 70 });
      if (ver.evaluable) {
        doc.fillColor(ver.cumple_corta ? '#1F7A43' : '#B4232A').font('Helvetica-Bold')
          .text(ver.cumple_corta ? 'CUMPLE' : 'REVISAR', X.ver, y, { width: 70 });
        doc.font('Helvetica');
      } else {
        doc.fillColor('#666').text('sin demanda', X.ver, y, { width: 70 });
      }
    }
    y += 20;
    if (y > 700) { doc.addPage(); y = 60; }
  }
  if (ilegibles > 0) {
    doc.fillColor('#8A6D1C').fontSize(8)
      .text(`${ilegibles} partida(s) del proyecto no declaran medidas o vidrio legibles y quedaron fuera de este informe: las revisa el especialista.`, 52, y, { width: W - 104 });
    y += 24;
  }

  // ── Que exige el viento (demanda + supuesto declarado) ─────────────────
  // [Copilot, compuerta] Salto de pagina si las secciones que vienen (~270 px con
  // supuesto + metodo + descargo + firma) no caben: sin esto, un proyecto de muchas
  // ventanas empujaba la firma fuera de la hoja.
  if (y > 480) { doc.addPage(); y = 60; }
  y += 8;
  doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold').text('1 · QUÉ EXIGE EL VIENTO EN SU ZONA', 50, y);
  y += 18;
  const d = datos.demanda || {};
  doc.fillColor('#333').fontSize(9).font('Helvetica');
  if (d.presion_kPa) {
    doc.text(`Presión de diseño de referencia: ${dec(d.presion_kPa, 3)} kPa (presión básica ${dec(d.q_basica_kg_m2, 1)} kg/m² `
      + `por factor de forma ${dec(d.factor_forma_C, 1)}), calculada por la norma chilena de cargas de viento, la NCh 432 `
      + 'publicada en el portal de normas técnicas del MINVU, que es la que cita la Ordenanza General de Urbanismo y '
      + 'Construcciones (OGUC).', 50, y, { width: W - 100 });
    y += 44;
    doc.fillColor('#666').fontSize(8)
      .text('Supuesto declarado: elemento a 3 m de altura en entorno de ciudad (primer o segundo piso urbano, el caso '
        + 'típico). Si su proyecto es más alto, está frente al mar o en campo abierto, la exigencia sube y se recalcula. '
        + 'La versión técnica más reciente de la norma es la NCh 432 del año 2025 (basada en el estándar americano '
        + 'ASCE 7-22); este informe usa el carril de la norma publicada por el MINVU y lo dice expresamente.', 50, y, { width: W - 100 });
    y += 48;
  } else {
    doc.text('La demanda de su zona no se pudo calcular en esta pasada: las resistencias de la tabla valen igual y el '
      + 'especialista la compara con la exigencia de su proyecto.', 50, y, { width: W - 100 });
    y += 30;
  }

  // ── Las curvas (pedido del dueno 28-ago: "muchas curvas... las maximas de la ley") ──
  // El bloque viene del motor de THERMAL; si no vino (motor viejo o hueco declarado), el
  // informe sale igual en su version corta y la numeracion no salta.
  const curvas = (datos.curvas && !datos.curvas._hueco
    && Array.isArray(datos.curvas.capacidad_por_espesor)
    && datos.curvas.capacidad_por_espesor.length) ? datos.curvas : null;
  if (curvas) {
    doc.addPage();
    y = dibujarPaginaCurvas(doc, curvas);
  }
  const nCalc = curvas ? '5' : '2';

  // ── Metodo y descargo ───────────────────────────────────────────────────
  // El cierre (texto + descargo + firma) mide ~190 pt; con margen inferior de 50 el
  // ultimo y utilizable es ~600.
  if (y > 600) { doc.addPage(); y = 60; }
  doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold').text(`${nCalc} · CÓMO SE CALCULÓ`, 50, y);
  y += 18;
  doc.fillColor('#333').fontSize(9).font('Helvetica')
    .text('La resistencia de cada vidrio termopanel se determinó con la práctica internacional para vidrio en '
      + 'edificación, el estándar ASTM E1300-16 (la misma metodología del software de cálculo que usa nuestro '
      + 'evaluador), considerando el paño apoyado en sus cuatro bordes y el reparto de carga entre ambos vidrios '
      + 'de la unidad. La flecha estimada es la deformación al centro del vidrio bajo esa presión de referencia: '
      + 'mientras más chica, más firme se siente la ventana.', 50, y, { width: W - 100 });
  y += 62;
  doc.rect(50, y, W - 100, 34).fill('#F7F9FC');
  doc.fillColor('#555').fontSize(8)
    .text('Este informe verifica el VIDRIO de sus ventanas frente al viento y es informativo para su decisión de '
      + 'compra. No constituye el cálculo estructural del edificio ni reemplaza una memoria de cálculo firmada.', 58, y + 6, { width: W - 116 });
  y += 46;
  const f = firma || {};
  doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold')
    .text(String(f.nombre || 'Ing. Marcelo Cifuentes M.'), 50, y);
  doc.fillColor('#555').fontSize(8).font('Helvetica')
    .text(String(f.cargo || 'Evaluador Energético acreditado MINVU · Activa Inversiones'), 50, y + 12);

  doc.end();
  return fin;
}

/**
 * Pagina 2: el grafico de curvas por espesor con las lineas de exigencia legal, la tabla
 * de interseccion (cada ventana con cada vidrio) y lo que dice la ley por comuna.
 * Devuelve la Y donde quedo el cursor para que siga "COMO SE CALCULO".
 */
function dibujarPaginaCurvas(doc, curvas) {
  let y = 56;
  doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold')
    .text('2 · CUÁNTO RESISTE CADA VIDRIO, EN CURVAS', 50, y);
  y += 16;
  const intro = 'La resistencia se mide en kilopascales (kPa): 1 kPa equivale a unos 100 kilos de viento '
    + 'empujando cada metro cuadrado de vidrio. Cada curva es un espesor de termopanel: mientras más '
    + 'grande el paño (eje horizontal, en metros cuadrados), menos presión resiste. Las líneas doradas '
    + 'punteadas son las máximas que indica la ley chilena para distintas ubicaciones: el vidrio de su '
    + 'ventana debe quedar por sobre la línea que corresponde a su ubicación (la referencia de este '
    + 'informe es el caso típico declarado: ciudad, a 3 metros). Una curva pegada al techo del gráfico '
    + 'resiste aún más de lo que el techo muestra.';
  doc.fillColor('#333').fontSize(8.5).font('Helvetica').text(intro, 50, y, { width: W - 100 });
  // El alto del parrafo se MIDE (crecio una linea y piso el eje del grafico una vez).
  y += doc.heightOfString(intro, { width: W - 100 }) + 14;

  // ── Geometria del grafico ────────────────────────────────────────────────
  const cx = 92, cw = 442, ctop = y, ch = 210;
  // [Codex, compuerta] blindaje de SEGUNDO nivel: un [null] adentro de cualquiera de las
  // listas del motor tumbaba el PDF con TypeError; la degradacion debe aguantar tambien
  // un bloque parcial o malformado, no solo la ausencia total.
  const esObj = (x) => Boolean(x) && typeof x === 'object';
  const lineas = (Array.isArray(curvas.demanda_legal) ? curvas.demanda_legal : []).filter(esObj);
  const inter = (Array.isArray(curvas.interseccion_por_ventana) ? curvas.interseccion_por_ventana : []).filter(esObj);
  const curvasEsp = (Array.isArray(curvas.capacidad_por_espesor) ? curvas.capacidad_por_espesor : [])
    .filter((c) => esObj(c) && Number.isFinite(Number(c.espesor_mm)));
  const maxLey = Math.max(0.6, ...lineas.map((l) => Number(l.presion_kPa) || 0));
  const lrPropios = inter
    .map((f) => (Array.isArray(f.por_espesor) ? f.por_espesor : []).filter(esObj)
      .find((pe) => f.espesor_propio_mm != null && Number(pe.espesor_mm) === Number(f.espesor_propio_mm)))
    .map((pe) => (pe && Number.isFinite(Number(pe.lr_corta_kPa)) && Number(pe.lr_corta_kPa)) || 0);
  let yMax = Math.max(2.5, maxLey * 1.8, ...lrPropios.map((v) => v + 0.7));
  yMax = Math.min(6, Math.ceil(yMax * 2) / 2);
  const xMax = 4.7;
  // [Gemini, compuerta] clamp por ABAJO ademas del techo: un valor negativo u hostil del
  // motor jamas dibuja fuera del recuadro, y un NaN se filtra antes de llegar aca.
  const fx = (area) => cx + (Math.max(0, Math.min(area, xMax)) / xMax) * cw;
  const fy = (kpa) => ctop + ch - (Math.max(0, Math.min(kpa, yMax)) / yMax) * ch;

  // Grilla recesiva + ejes
  doc.lineWidth(0.5);
  const pasoY = yMax > 3.5 ? 1.0 : 0.5;
  for (let v = 0; v <= yMax + 0.001; v += pasoY) {
    doc.moveTo(cx, fy(v)).lineTo(cx + cw, fy(v)).strokeColor('#E4E9F1').stroke();
    doc.fillColor('#888').fontSize(6.5).font('Helvetica')
      .text(v.toFixed(1).replace('.', ','), cx - 26, fy(v) - 3, { width: 22, align: 'right' });
  }
  for (let a = 0; a <= xMax; a += 1) {
    doc.moveTo(fx(a), ctop).lineTo(fx(a), ctop + ch).strokeColor('#EDF1F6').stroke();
    doc.fillColor('#888').fontSize(6.5).text(String(a), fx(a) - 3, ctop + ch + 4);
  }
  doc.moveTo(cx, ctop).lineTo(cx, ctop + ch).lineTo(cx + cw, ctop + ch)
    .strokeColor('#B9C2CF').lineWidth(0.8).stroke();
  doc.fillColor('#666').fontSize(7).font('Helvetica-Bold').text('kPa', cx - 26, ctop - 10);
  doc.text('tamaño del vidrio (m²)', cx + cw / 2 - 40, ctop + ch + 14);

  // ── Lineas de la ley (doradas, punteadas) ───────────────────────────────
  for (const l of lineas) {
    const p = Number(l.presion_kPa);
    if (!p || p > yMax) continue;
    const esCiudad = l.entorno === 'ciudad';
    // Sin numerito al borde: con dos lineas separadas 0,02 kPa los textos se pisaban;
    // los valores van completos en la leyenda de abajo.
    doc.save().dash(esCiudad ? 4 : 1.8, { space: 2.4 })
      .moveTo(cx, fy(p)).lineTo(cx + cw, fy(p))
      .strokeColor(esCiudad ? GOLD : '#8A6D1C').lineWidth(1).stroke().restore();
  }

  // ── Curvas de capacidad por espesor ─────────────────────────────────────
  for (const c of curvasEsp) {
    // [Gemini+Codex, compuerta] se filtran AMBOS ejes y los puntos no-objeto: un area
    // corrupta o un [null] metia NaN/TypeError al lineTo y pdfkit corrompe el stream.
    const pts = (Array.isArray(c.puntos) ? c.puntos : [])
      .filter((p) => esObj(p) && Number(p.lr_corta_kPa) > 0 && Number(p.area_m2) > 0);
    if (pts.length < 2) continue;
    const color = COLOR_ESPESOR[Math.round(c.espesor_mm)] || COLOR_ESPESOR_NUEVO;
    doc.save().moveTo(fx(pts[0].area_m2), fy(pts[0].lr_corta_kPa));
    for (const p of pts.slice(1)) doc.lineTo(fx(p.area_m2), fy(p.lr_corta_kPa));
    doc.strokeColor(color).lineWidth(1.6).stroke().restore();
    // Etiqueta ADENTRO del grafico (al 85 % de la curva, donde ya se separaron), en una
    // sola linea: al borde derecho chocaba con las lineas de la ley.
    const pEt = pts[Math.max(0, pts.length - 7)];
    doc.fillColor(color).fontSize(7).font('Helvetica-Bold')
      .text(`${Math.round(c.espesor_mm)} mm`, fx(pEt.area_m2) + 2, fy(pEt.lr_corta_kPa) - 10,
        { lineBreak: false });
  }

  // ── Sus ventanas, marcadas sobre su curva ───────────────────────────────
  inter.forEach((f, i) => {
    // [Gemini, compuerta] Number() en ambos lados: un espesor que llegue como string no
    // puede dejar la ventana del cliente sin su marca en el grafico.
    const pe = (Array.isArray(f.por_espesor) ? f.por_espesor : []).filter(esObj)
      .find((x) => f.espesor_propio_mm != null && Number(x.espesor_mm) === Number(f.espesor_propio_mm));
    const lr = pe && Number(pe.lr_corta_kPa);
    if (!lr || !Number.isFinite(lr) || !(Number(f.area_m2) > 0)) return;
    const px = fx(f.area_m2), py = fy(lr);
    doc.circle(px, py, 3.4).fillAndStroke(GOLD, NAVY);
    doc.fillColor(NAVY).fontSize(6.5).font('Helvetica-Bold').text(`V${i + 1}`, px - 4, py - 12);
  });
  y = ctop + ch + 26;

  // Leyenda de las lineas legales
  // [Copilot, compuerta] la proporcion de trazado se DECLARA: una ventana de proporcion
  // distinta a la del proyecto no cae exacta sobre su curva, y el cliente debe saberlo.
  const razonTxt = Number(curvas.proporcion_alto_ancho)
    ? ` Curvas trazadas para la proporción de sus ventanas (lado mayor/menor ${dec(curvas.proporcion_alto_ancho, 2)}): una ventana de proporción distinta puede quedar levemente fuera de su curva; su valor exacto está en la tabla de abajo.`
    : '';
  doc.fillColor('#666').fontSize(7.5).font('Helvetica')
    .text('Líneas de la ley (norma chilena de viento NCh 432, Tabla 1, con factor de forma 1,2). '
      + 'Trazo largo: ciudad; trazo corto: campo abierto o costa. '
      + lineas.map((l) => `${l.etiqueta}: ${dec(l.presion_kPa, 2)} kPa`).join('  ·  ')
      + razonTxt,
    50, y, { width: W - 100 });
  y += 40;

  // ── 3 · La interseccion: cada ventana con cada vidrio ───────────────────
  doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold')
    .text('3 · SU VENTANA CON CADA VIDRIO', 50, y);
  y += 16;
  const esps = curvasEsp.map((c) => Math.round(c.espesor_mm));
  // [Gemini, compuerta] ancho de columna PROPORCIONAL: si manana la cosecha suma 10 o
  // 12 mm, las columnas se angostan en vez de escribir fuera de la hoja (A4 = 595).
  const col0 = 52, colW = Math.min(66, Math.floor(305 / Math.max(1, esps.length)));
  const colX = (j) => 240 + j * colW;
  const cabeceraInterseccion = () => {
    doc.fillColor('#666').fontSize(7.5).font('Helvetica-Bold').text('VENTANA', col0, y);
    esps.forEach((e, j) => doc.text(`${e} mm`, colX(j), y, { width: colW - 6, align: 'right' }));
    y += 11;
    doc.moveTo(50, y).lineTo(W - 50, y).strokeColor('#D8DEE8').lineWidth(0.7).stroke();
    y += 5;
  };
  cabeceraInterseccion();
  inter.forEach((f, i) => {
    // [Codex, re-pase] el salto se decide ANTES de imprimir la fila: decidirlo despues
    // dejaba una cabecera huerfana en pagina nueva cuando la ULTIMA fila lo gatillaba.
    if (y > 756) { doc.addPage(); y = 60; cabeceraInterseccion(); }
    doc.fillColor('#222').fontSize(8).font('Helvetica')
      .text(`V${i + 1} · ${String(f.nombre || '').slice(0, 24)} (${f.ancho_mm}×${f.alto_mm})`, col0, y, { width: 182 });
    (Array.isArray(f.por_espesor) ? f.por_espesor : []).filter(esObj).forEach((pe) => {
      const j = esps.indexOf(Math.round(pe.espesor_mm));
      if (j < 0) return;
      const propio = f.espesor_propio_mm != null && Number(pe.espesor_mm) === Number(f.espesor_propio_mm);
      doc.font(propio ? 'Helvetica-Bold' : 'Helvetica');
      if (pe.lr_corta_kPa == null) {
        doc.fillColor('#999').text('-', colX(j), y, { width: colW - 6, align: 'right' });
      } else if (pe.cumple === true) {
        doc.fillColor(VERDE).text(dec(pe.lr_corta_kPa, 2), colX(j), y, { width: colW - 6, align: 'right' });
      } else if (pe.cumple === false) {
        doc.fillColor(ROJO).text(`${dec(pe.lr_corta_kPa, 2)} *`, colX(j), y, { width: colW - 6, align: 'right' });
      } else {
        // [Codex, compuerta] cumple null (sin demanda evaluable) NO se pinta verde:
        // numero neutro, sin afirmar cumplimiento que nadie evaluo.
        doc.fillColor('#444').text(dec(pe.lr_corta_kPa, 2), colX(j), y, { width: colW - 6, align: 'right' });
      }
    });
    doc.font('Helvetica');
    y += 14;
  });
  y += 2;
  doc.fillColor('#666').fontSize(7)
    .text('Resistencias en kPa para termopanel simétrico de cada espesor, en el tamaño exacto de su ventana. '
      + 'En negrita: el vidrio cotizado en su propuesta. En verde cumple la exigencia de referencia '
      + '(el caso típico declarado: ciudad, 3 m); con * queda bajo ella; en color neutro no se evaluó. '
      + 'Un guion: ese caso requiere cálculo del especialista.', 50, y, { width: W - 100 });
  y += 28;

  // ── 4 · Lo que dice la ley por comuna ───────────────────────────────────
  if (y > 640) { doc.addPage(); y = 60; }
  doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold')
    .text('4 · LO QUE DICE LA LEY PARA SU COMUNA', 50, y);
  y += 16;
  // [Copilot, compuerta] los textos del motor viajan sin limite: se acotan y se MIDE su
  // alto ANTES de escribir; si no caben, salto de pagina (pdfkit no pagina solo con x,y).
  const base = String(curvas.base_legal || '').trim().slice(0, 900);
  if (base) {
    doc.fontSize(8.5).font('Helvetica');
    if (y + doc.heightOfString(base, { width: W - 100 }) > 770) { doc.addPage(); y = 60; }
    doc.fillColor('#333').text(base, 50, y, { width: W - 100 });
    y += doc.heightOfString(base, { width: W - 100 }) + 8;
  }
  if (curvas.supuesto) {
    const sup = `Supuesto declarado: ${String(curvas.supuesto).slice(0, 500)}.`;
    doc.fontSize(7.5);
    if (y + doc.heightOfString(sup, { width: W - 100 }) > 770) { doc.addPage(); y = 60; }
    doc.fillColor('#666').text(sup, 50, y, { width: W - 100 });
    y += doc.heightOfString(sup, { width: W - 100 }) + 12;
  }
  return y;
}
