// services/quotePdf.js — PDF PREMIUM de cotización (pdfkit, vectores nativos, sin Chromium)
// Dibuja cada ventana a escala (color real + flechas corredera + medidas) + tabla + totales.
// Exporta generatePremiumQuotePdf(data, quoteNumber) -> Promise<Buffer>.
//
// data: { name, phone, comuna, address, default_color, items:[{ product, producto_label,
//         measures, color, qty, unit_price, glass_label, ambiente }], quote_num }
// NO inventa precios: usa it.unit_price tal cual viene del motor.

const NAVY = "#0B3D6F", GOLD = "#C4993B", GRAY = "#6B7B8D", DARK = "#1A2332", LINE = "#E2E8F0";

const COLORS = {
  blanco:  { f: "#EEF1F4", e: "#C2CCD6", name: "Blanco" },
  nogal:   { f: "#7A4A20", e: "#3F2410", name: "Nogal" },
  roble:   { f: "#B88F53", e: "#7D5E34", name: "Roble" },
  grafito: { f: "#3C4856", e: "#222A35", name: "Grafito" },
  newblack:{ f: "#1F2024", e: "#0B0C0E", name: "New Black" },
  gris:    { f: "#3C4856", e: "#222A35", name: "Grafito" },
};
function colKey(c) {
  const t = String(c || "").toLowerCase();
  if (t.includes("nogal") || t.includes("roble") || t.includes("madera")) return t.includes("roble") ? "roble" : "nogal";
  if (t.includes("grafito") || t.includes("gris") || t.includes("antracita")) return "grafito";
  if (t.includes("negro") || t.includes("black")) return "newblack";
  return "blanco";
}
function parseMeasures(m) {
  const s = String(m || "");
  const mm = s.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i);
  if (!mm) return { ancho: 1000, alto: 1000 };
  let a = parseFloat(mm[1].replace(",", ".")), b = parseFloat(mm[2].replace(",", "."));
  if (a <= 6) a *= 1000; if (b <= 6) b *= 1000;
  return { ancho: Math.round(a), alto: Math.round(b) };
}
function tipoFrom(it) {
  const p = String(it.product || it.producto_label || "").toUpperCase();
  if (p.includes("CORREDERA") || p.includes("SLIDING")) return "CORREDERA";
  if (p.includes("PROYECT")) return "PROYECTANTE";
  if (p.includes("OSCILO")) return "OSCILOBATIENTE";
  if (p.includes("ABAT") || p.includes("BATIENTE")) return "BATIENTE";
  return "FIJA";
}
function hojasFrom(it) {
  if (it.corredera && it.corredera.hojas) return Number(it.corredera.hojas);
  const m = String(it.product || "").toLowerCase().match(/(\d)\s*hoja/);
  if (m) return Number(m[1]);
  return tipoFrom(it) === "CORREDERA" ? 2 : 1;
}

// Dibuja la ventana (elevación 2D a escala) dentro del rect (bx,by,bw,bh)
function drawWindow(doc, bx, by, bw, bh, it) {
  const { ancho, alto } = parseMeasures(it.measures);
  const col = COLORS[colKey(it.color)] || COLORS.blanco;
  const tipo = tipoFrom(it), n = Math.max(1, hojasFrom(it));
  const ratio = ancho / alto;
  let dw = bw - 8, dh = dw / ratio;
  if (dh > bh - 18) { dh = bh - 18; dw = dh * ratio; }
  const x = bx + (bw - dw) / 2, y = by + 2;
  const fr = Math.max(3, dw * 0.05);
  doc.save();
  // marco
  doc.rect(x, y, dw, dh).fillAndStroke(col.f, col.e);
  const iw = dw - 2 * fr, pw = iw / n, ih = dh - 2 * fr;
  for (let i = 0; i < n; i++) {
    const px = x + fr + i * pw, sf = Math.max(2, pw * 0.08);
    doc.rect(px, y + fr, pw, ih).lineWidth(0.5).fillAndStroke(col.f, col.e);
    doc.rect(px + sf, y + fr + sf, pw - 2 * sf, ih - 2 * sf).fillAndStroke("#BCDCF3", col.e);
    if (tipo === "CORREDERA") {
      const cy = y + dh / 2, cx = px + pw / 2, d = i % 2 === 0 ? 1 : -1;
      const a = Math.min(5, pw * 0.14);   // flecha CHICA, centrada en su hoja (no llega al centro)
      doc.polygon([cx - a * d, cy - 1.8], [cx + a * 0.25 * d, cy - 1.8], [cx + a * 0.25 * d, cy - 3.6],
                  [cx + a * 1.05 * d, cy], [cx + a * 0.25 * d, cy + 3.6], [cx + a * 0.25 * d, cy + 1.8], [cx - a * d, cy + 1.8])
         .fillAndStroke("#FFFFFF", DARK);
    }
  }
  doc.fillColor(GRAY).fontSize(6.5).font("Helvetica").text(`${ancho}×${alto} mm`, bx, by + bh - 8, { width: bw, align: "center" });
  doc.restore();
}

function fmt(n) { return "$" + Math.round(Number(n) || 0).toLocaleString("es-CL"); }

function header(doc, quoteNumber) {
  doc.rect(0, 0, doc.page.width, 90).fill(NAVY);
  doc.fillColor("#fff").fontSize(22).font("Helvetica-Bold").text("ACTIVA INVERSIONES", 50, 26);
  doc.fillColor(GOLD).fontSize(10).font("Helvetica").text("Ventanas PVC · Termopanel · Alta Eficiencia Energética", 50, 54);
  doc.fillColor("#fff").fontSize(9).text("Temuco · La Araucanía · Chile", 50, 70);
  doc.fillColor("#fff").fontSize(9).text(`Propuesta N° ${quoteNumber}`, doc.page.width - 250, 40, { width: 200, align: "right" });
  doc.fillColor(GOLD).fontSize(8).text(`+56 9 5729 6035 · activaspa.cl`, doc.page.width - 250, 56, { width: 200, align: "right" });
  doc.rect(0, 90, doc.page.width, 4).fill(GOLD);
}
function tableHead(doc, y) {
  doc.rect(50, y, doc.page.width - 100, 22).fill(NAVY);
  doc.fillColor("#fff").fontSize(8.5).font("Helvetica-Bold");
  doc.text("VENTANA", 56, y + 7);
  doc.text("DESCRIPCIÓN", 165, y + 7);
  doc.text("CANT", 360, y + 7, { width: 36, align: "center" });
  doc.text("UNITARIO", 398, y + 7, { width: 70, align: "right" });
  doc.text("SUBTOTAL", 470, y + 7, { width: 75, align: "right" });
  return y + 22;
}

async function generatePremiumQuotePdf(data, quoteNumber) {
  const { default: PDFDocument } = await import("pdfkit");
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];
      doc.on("data", c => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      header(doc, quoteNumber);
      doc.fillColor(GRAY).fontSize(9).font("Helvetica").text(`Fecha: ${new Date().toLocaleDateString("es-CL")} · Válida 15 días`, 50, 104);

      let y = 120;
      // [2026-07-02 BUG parcial] Aviso PROPUESTA PARCIAL — visible y no opcional cuando parte del
      // pedido escaló a Marcelo (evita que el cliente lea el total parcial como el total del proyecto).
      if (data.is_partial) {
        doc.rect(50, y, doc.page.width - 100, 22).fill("#FDECEA");
        doc.fillColor("#B3261E").fontSize(9).font("Helvetica-Bold")
          .text(`PROPUESTA PARCIAL${data.partial_note ? " — " + data.partial_note : " — no incluye todos los ítems solicitados; el resto lo cotiza Marcelo directamente"}`,
            58, y + 6, { width: doc.page.width - 116 });
        y += 30;
      }

      // Cliente
      doc.fillColor(DARK).fontSize(10).font("Helvetica-Bold").text("CLIENTE", 50, y);
      doc.font("Helvetica").fontSize(9).fillColor(DARK);
      doc.text(`${data.name || "Cliente"}  ·  ${data.phone || ""}  ·  ${data.comuna || "Temuco"}${data.address ? "  ·  " + data.address : ""}`, 110, y);
      y += 22;

      y = tableHead(doc, y);

      const items = data.items || [];
      let neto = 0;
      const rowH = 60; // [thermal] +4px de aire para la línea Uw bajo la descripción (sin apretar)
      items.forEach((it, idx) => {
        if (y + rowH > doc.page.height - 90) {           // salto de página
          doc.addPage(); header(doc, quoteNumber); y = 110; y = tableHead(doc, y);
        }
        const bg = idx % 2 === 0 ? "#F7F9FC" : "#FFFFFF";
        doc.rect(50, y, doc.page.width - 100, rowH).fill(bg);
        // dibujo ventana
        drawWindow(doc, 54, y + 4, 100, rowH - 8, it);
        // descripción
        const col = COLORS[colKey(it.color)] || COLORS.blanco;
        const label = it.producto_label || (it.product || "Ventana").replace(/_/g, " ");
        const ms = parseMeasures(it.measures);
        const m2 = ((ms.ancho / 1000) * (ms.alto / 1000)).toFixed(2);
        const vidrio = it.glass_label || "Termopanel DVH";
        doc.fillColor(DARK).fontSize(9).font("Helvetica-Bold").text(`V${idx + 1} · ${label}`, 165, y + 7, { width: 190 });
        doc.fillColor(GRAY).fontSize(7.5).font("Helvetica")
           .text(`${ms.ancho}×${ms.alto} mm · ${m2} m² · ${col.name} · ${vidrio}`, 165, y + 22, { width: 190 });
        // [thermal] Uw discreto bajo la descripción — SOLO si vino del motor (null=H98 → nada)
        if (it.termico && Number(it.termico.uw) > 0) {
          doc.fillColor(GRAY).fontSize(6.8).font("Helvetica-Oblique")
             .text(`Uw = ${Number(it.termico.uw).toFixed(2)} W/m²K · ISO 10077-1`, 165, y + 34, { width: 190 });
        }
        doc.fillColor("#1E96F7").fontSize(7).font("Helvetica").text("Ver en 3D / probar en tu pared", 165, y + 46, { width: 190 });
        // números
        const qty = Number(it.qty) || 1, unit = Number(it.unit_price) || 0, sub = unit * qty;
        neto += sub;
        doc.fillColor(DARK).fontSize(9).font("Helvetica");
        doc.text(String(qty), 360, y + 22, { width: 36, align: "center" });
        doc.text(fmt(unit), 398, y + 22, { width: 70, align: "right" });
        doc.font("Helvetica-Bold").text(fmt(sub), 470, y + 22, { width: 75, align: "right" });
        y += rowH;
        doc.moveTo(50, y).lineTo(doc.page.width - 50, y).lineWidth(0.5).strokeColor(LINE).stroke();
      });

      // Totales (con DESCUENTO opcional — data.descuento_pct, ej. 10 = 10%)
      if (y + 150 > doc.page.height - 90) { doc.addPage(); header(doc, quoteNumber); y = 110; }
      y += 12;
      const descPct = Math.max(0, Math.min(50, Number(data.descuento_pct) || 0)); // descuento al cliente, 0–50%
      const desc = Math.round(neto * descPct / 100);
      const netoFinal = neto - desc;
      const iva = Math.round(netoFinal * 0.19), total = netoFinal + iva;
      doc.fillColor(DARK).fontSize(10).font("Helvetica");
      // [2026-06-24] DESCUENTO DE MERCADO (global, ya aplicado a los precios por el motor).
      // Se MUESTRA para que el cliente vea el ahorro. 'neto' YA viene descontado → la lista
      // (precio sin descuento) se back-calcula: lista = neto / (1 - pct). pct es FRACCIÓN (0.2 = 20%).
      const mPct = Math.max(0, Math.min(0.5, Number(data.descuento_mercado_pct) || 0));
      if (mPct > 0) {
        const lista = Math.round(neto / (1 - mPct));
        const descMerc = lista - neto;
        doc.text("Precio lista:", 360, y, { width: 105, align: "right" }); doc.text(fmt(lista), 470, y, { width: 75, align: "right" }); y += 17;
        doc.fillColor("#1E96F7").text(`Descuento ${Math.round(mPct * 100)}%:`, 360, y, { width: 105, align: "right" }); doc.text(`- ${fmt(descMerc)}`, 470, y, { width: 75, align: "right" }); y += 17;
        doc.fillColor(DARK);
      }
      doc.text("Subtotal neto:", 360, y, { width: 105, align: "right" }); doc.text(fmt(neto), 470, y, { width: 75, align: "right" }); y += 17;
      if (desc > 0) {
        doc.fillColor("#1E96F7").text(`Descuento ${descPct}%:`, 360, y, { width: 105, align: "right" }); doc.text(`- ${fmt(desc)}`, 470, y, { width: 75, align: "right" }); y += 17;
        doc.fillColor(DARK).font("Helvetica-Bold").text("Subtotal c/dcto:", 360, y, { width: 105, align: "right" }); doc.text(fmt(netoFinal), 470, y, { width: 75, align: "right" }); doc.font("Helvetica"); y += 17;
      }
      doc.fillColor(DARK).text("IVA 19%:", 360, y, { width: 105, align: "right" }); doc.text(fmt(iva), 470, y, { width: 75, align: "right" }); y += 19;
      doc.rect(360, y - 4, 185, 26).fill(GOLD);
      doc.fillColor("#fff").fontSize(13).font("Helvetica-Bold");
      doc.text("TOTAL:", 365, y + 3, { width: 100, align: "right" }); doc.text(fmt(total), 470, y + 3, { width: 70, align: "right" });
      y += 42;

      // Incluye / garantías
      doc.fillColor(DARK).fontSize(9.5).font("Helvetica-Bold").text("INCLUYE", 50, y); y += 14;
      doc.font("Helvetica").fontSize(8).fillColor(GRAY);
      ["• Perfiles PVC WinHouse certificados (IFT Rosenheim) · termopanel DVH.",
       "• Instalación profesional por equipo propio. Sellado incluido.",
       "• Cumple OGUC 4.1.10 (acondicionamiento térmico). Evaluador MINVU Res. 266/2025.",
       "• Garantía 5 años estructura · 1 año herrajes. Sujeto a rectificación en terreno."]
       .forEach(t => { doc.text(t, 50, y); y += 12; });

      // Footer
      doc.rect(0, doc.page.height - 54, doc.page.width, 54).fill(NAVY);
      doc.fillColor("#fff").fontSize(9).font("Helvetica-Bold").text("Activa Inversiones · Ventanas PVC certificadas · Temuco", 50, doc.page.height - 42, { align: "center", width: doc.page.width - 100 });
      doc.fillColor(GOLD).fontSize(8).font("Helvetica").text("WhatsApp +56 9 5729 6035 · activaspa.cl · Cada ventana se puede ver en 3D y probar en tu pared", 50, doc.page.height - 26, { align: "center", width: doc.page.width - 100 });

      doc.end();
    } catch (e) { reject(e); }
  });
}

export { generatePremiumQuotePdf };
