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
    doc.fillColor('#444').text(`${v.ancho_mm}×${v.alto_mm} mm · ${String(v.vidrio || '').replace('DVH ', '')}`, X.med, y, { width: 96 });
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

  // ── Metodo y descargo ───────────────────────────────────────────────────
  doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold').text('2 · CÓMO SE CALCULÓ', 50, y);
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
