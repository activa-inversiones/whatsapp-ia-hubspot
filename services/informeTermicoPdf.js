// services/informeTermicoPdf.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// EL INFORME TÉRMICO, EN PDF FIRMADO.
//
// El dueño lo pidió así, textual: *"esperaba un archivo de PDF más formal"*. Tenía razón
// y la primera versión (un mensaje de WhatsApp) era la decisión equivocada para este caso:
// un mensaje se pierde en el scroll, un PDF firmado se GUARDA y se REENVÍA — al marido, al
// arquitecto, al maestro. Y ese reenvío es exactamente lo que se busca.
//
// MISMA IDENTIDAD VISUAL que la propuesta (index.js generateLocalQuotePdf): navy + dorado,
// para que el cliente reciba dos documentos que se ven de la misma casa.
//
// ⚠️ NO ES LA COTIZACIÓN. Va ANTES, no lleva precios, y lo dice explícitamente. Es un
// informe de la NORMA que aplica en su comuna — la propuesta llega después.
//
// ⚠️ LECCIÓN APLICADA (2026-08-20): la paginación automática de pdfkit metía 3 páginas en
// blanco en TODAS las cotizaciones, porque la función posiciona con coordenadas absolutas y
// cualquier `y` bajo el margen inferior se leía como desborde. Acá se apaga desde el
// principio y los saltos son explícitos. No repetir ese bug.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.1.0';

/**
 * El pie de cada lámina, EN CASTELLANO DE CLIENTE. THERMAL trae una descripción técnica
 * ("Corte vertical: isotermas cada 1 grado C y elementos que ve el solver") que le sirve a
 * un ingeniero y no le dice nada a quien está comprando ventanas. Acá se explica QUÉ MIRAR
 * y POR QUÉ IMPORTA — sin agregar ni un dato que la figura no respalde.
 */
const PIES_LAMINA = Object.freeze({
  // ── LOS NUDOS CON PANEL: lo que el dueño pidió ver ───────────────────────────────────
  // [2026-08-24] Textual: *"sería mejor presentarlos por separador superior e inferior con
  // panel, mejor para que se vean las isotermas, porque a esta le falta todo"*, sobre los
  // cortes completos (01 y 02). Tenía razón en el uso que les estábamos dando: un corte
  // entero a escala chica no deja ver el borde, que es justo donde pasa lo que importa.
  // Los nudos 03/04 son los que traen el termopanel extendido 190 mm —la sustitución por
  // panel que exige la norma— y ahí las isotermas del borde se leen de verdad.
  '04': 'Nudo SUPERIOR: el encuentro entre el marco de arriba y el termopanel, con el panel extendido '
      + '190 mm como exige el método normativo. Cada línea une los puntos que están a la misma '
      + 'temperatura. Mientras las líneas se mantengan separadas y lejos de la cara interior, el calor '
      + 'no está encontrando un camino fácil para salir.',
  '03': 'Nudo INFERIOR, el mismo encuentro abajo. Es el punto más exigido de la ventana: el aire frío se '
      + 'acumula en la parte baja del vidrio y por eso, si algo se va a empañar, empieza por ahí. Acá se '
      + 've cuánto alcanza a subir el frío desde el borde.',
  '07': 'El MISMO nudo inferior, resuelto con separador de ALUMINIO. El aluminio conduce muchísimo '
      + '(λ 160 frente a 0,135 del warm-edge): mire cómo las líneas frías trepan pegadas al canto del '
      + 'vidrio. Es el caso desfavorable, y es el que traen la mayoría de los termopaneles del mercado.',
  '08': 'El mismo nudo con separador WARM-EDGE. Comparándolo con la figura anterior se ve la diferencia '
      + 'sin necesidad de leer un número: las líneas frías se retiran del canto. Esa distancia es todo lo '
      + 'que separa un borde que aguanta de uno que no.',
  '01': 'Corte vertical del marco y el termopanel. El rojo es el lado de adentro (calefaccionado) y el '
      + 'azul el de afuera. Las cámaras de aire del PVC son las que frenan el paso del frío: por eso la '
      + 'transición es gradual y no hay un salto brusco hacia el interior.',
  '02': 'El mismo corte, visto en horizontal. Sirve para ver el encuentro entre la hoja y el marco, que '
      + 'es donde una ventana mal resuelta pierde más calor.',
  // [P1 · Gemini] Se corrigieron DOS cosas de este pie, y las dos importan porque el
  // documento va firmado por un evaluador acreditado:
  //   · "el aluminio conduce el frío" es físicamente incorrecto — lo que pasa es que deja
  //     ESCAPAR el calor. En un informe técnico esa frase sola le baja la credibilidad.
  //   · "es la diferencia entre un termopanel que amanece empañado y uno que no" es una
  //     promesa ABSOLUTA. La condensación depende también de la humedad interior y de la
  //     ventilación de la casa: con una estufa a gas y sin ventilar, condensa igual.
  //     Prometerlo en un documento firmado es regalarle al cliente el respaldo para un
  //     reclamo de garantía. Se mantiene la fuerza comercial, se saca la garantía implícita.
  //   · Tercera pasada [P1 · Codex]: seguia AFIRMANDO un resultado de condensacion, y una
  //     figura ilustrativa no puede respaldar eso.
  //   · 🔴 CUARTA Y DEFINITIVA [2026-08-24], y esta no la pidio un revisor sino EL PROPIO
  //     MOTOR DE ACTIVA. La lamina del termopanel que genera THERMAL
  //     (tools/lamina_termopanel_separadores.py) reporta, para Temuco a 65 % de HR interior:
  //           borde ALUMINIO   θsi =  9,2 °C  -> CONDENSA
  //           borde THERMOFLEX θsi = 11,8 °C  -> CONDENSA
  //           centro de vidrio θsi = 13,3 °C  -> no condensa
  //     y el umbral que devuelve la API para Temuco es 12,28 °C a 65 % (14,47 °C a 75 %).
  //     O sea: EN TEMUCO EL BORDE CONDENSA CON LOS DOS SEPARADORES. El warm-edge cierra casi
  //     toda la brecha (9,2 → 11,8) pero NO la cruza. Cualquier texto que insinue que con
  //     warm-edge "no se empaña" contradice al motor de la propia empresa, en un documento
  //     que ella misma firma. Eso no es una imprecision de redaccion: es entregarle al
  //     cliente el papel con el que reclamar.
  //     ⛔ Y NO se transcriben esos numeros al PDF: salen de LEER UNA FIGURA, que es
  //     exactamente lo que el contrato con THERMAL prohibe. El dato declarable es el umbral
  //     calculado, que ya vive en la seccion de condensacion de este mismo informe.
  '10': 'ESTA es la que conviene mirar dos veces: el mismo perfil con separador de ALUMINIO (izquierda) y '
      + 'con separador WARM-EDGE (derecha). El aluminio actúa como puente térmico y deja escapar el calor '
      + 'por el borde del vidrio: por eso se ve la franja fría pegada al canto, mucho más marcada que con '
      + 'el warm-edge. El warm-edge sube bastante la temperatura de ese borde, y esa diferencia es real y '
      + 'medible. Ahora, siendo francos: en las mañanas más frías el BORDE del termopanel puede alcanzar '
      + 'igual la temperatura de condensación, con uno u otro separador — el centro del vidrio es el que '
      + 'se mantiene seco. La temperatura exacta a la que eso ocurre en su comuna está calculada en la '
      + 'sección de condensación de este informe.',
});

/** Tope de megapíxeles por figura. Ver el comentario largo en `laminasThermal.js`. */
const MAX_MPX_FIGURA = Number(process.env.THERMAL_LAMINA_MAX_MPX || 8);

/** Ancho y alto de un PNG leyendo su cabecera IHDR. null si no es un PNG. */
function medirPng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) return null;
  const ancho = buf.readUInt32BE(16);
  const alto = buf.readUInt32BE(20);
  return ancho > 0 && alto > 0 ? { ancho, alto } : null;
}

const NAVY = '#0B3D6F';
const GOLD = '#C4993B';
const GRAY = '#6B7B8D';
const DARK = '#1A2332';

const dec = (n, d = 1) => Number(n).toFixed(d).replace('.', ',');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Arma el PDF del informe térmico de una comuna.
 * @param {object} datos       respuesta de /api/v1/exigencia
 * @param {object} opts        { nombre, firma, esReferenciaRegional }
 * @returns {Promise<Buffer|null>}  null si no hay un solo dato duro que reportar
 */
export async function generarInformeTermicoPdf(datos, { nombre = '', firma = {}, esReferenciaRegional = false, vidrios = null, suVidrio = '', suUw = null, suProducto = '', laminas = null } = {}) {
  if (!datos || !datos.comuna) return null;

  const cond = datos.condensacion;
  const uw = num(datos.uw_max_Wm2K);
  const tienePDA = datos.regimen === 'PDA' && uw > 0;
  const tE = num(cond?.clima?.theta_e_C);
  const hE = num(cond?.clima?.phi_e);
  const t65 = num(cond?.f_rsi_minimo?.['0.65']?.theta_si_min_C);
  const t75 = num(cond?.f_rsi_minimo?.['0.75']?.theta_si_min_C);
  const tieneCond = tE !== null && hE !== null && t65 !== null;

  // Anti-alucinación: sin un solo dato verificado no se emite documento.
  if (!tienePDA && !tieneCond) return null;

  // El glass_label del motor viene como "5+12+5" o "4+12+4 saten (bano)"; las claves del
  // catalogo son "DVH_5-12-5". Se comparan solo los digitos, que es lo unico estable.
  const digitos = (x) => String(x || '').replace(/[^0-9]/g, '');
  const esSuVidrio = (codigo) => {
    const a3 = digitos(suVidrio); const b3 = digitos(codigo);
    return a3.length >= 3 && b3.startsWith(a3);
  };
  const uwCliente = num(suUw);

  const { default: PDFDocument } = await import('pdfkit');

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
      // Ver la lección de la cabecera: los saltos se deciden acá, no los inventa pdfkit.
      doc.page.margins.bottom = 0;
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width;

      // ── ENCABEZADO ──────────────────────────────────────────────────────
      doc.rect(0, 0, W, 90).fill(NAVY);
      doc.fillColor('#fff').fontSize(22).font('Helvetica-Bold').text('ACTIVA INVERSIONES', 50, 28);
      doc.fillColor(GOLD).fontSize(10).font('Helvetica').text('Ventanas PVC · Termopanel · Fábrica en Temuco', 50, 56);
      doc.fillColor('#fff').fontSize(9).text('Evaluación energética acreditada MINVU', 50, 72);

      doc.fillColor(DARK).fontSize(17).font('Helvetica-Bold')
        .text('INFORME TÉRMICO', 50, 118);
      doc.fillColor(GOLD).fontSize(12)
        .text(esReferenciaRegional ? 'Referencia regional — La Araucanía' : `Comuna de ${datos.comuna}`, 50, 142);
      doc.fillColor(GRAY).fontSize(9).font('Helvetica')
        .text(`Emitido: ${new Date().toLocaleDateString('es-CL')}${nombre ? `  ·  Preparado para: ${String(nombre).trim()}` : ''}`, 50, 161);

      // Aclaración de alcance ARRIBA, no en la letra chica: este documento NO es la propuesta.
      doc.rect(50, 178, W - 100, 26).fill('#F7F9FC');
      doc.fillColor(GRAY).fontSize(8).font('Helvetica')
        .text('Este documento informa la exigencia normativa vigente en su comuna. No es una cotización '
          + 'ni contiene precios: su propuesta económica se envía por separado.', 58, 185, { width: W - 116 });

      // ── AVISO LEGAL ─────────────────────────────────────────────────────
      // Pedido del dueño (2026-08-24): *"debería decir que el informe no se puede enviar,
      // copiar, transgredir... es exclusivo para quien lo recibe o se podrían tomar acciones
      // legales"*. Y sacar la palabra "preliminar" del título, que ya se hizo arriba.
      //
      // ⚠️ SE LE ADVIRTIÓ LA TENSIÓN Y DECIDIÓ IGUAL: el motivo declarado por el que esto es
      // un PDF y no un mensaje fue que *se reenvíe* — al marido, al arquitecto, al maestro
      // (ver la cabecera de este archivo). Por eso la redacción NO prohíbe que el cliente lo
      // comparta con quien lo asesora: prohíbe el USO POR TERCEROS —presentarlo como propio,
      // reproducirlo, o usar sus valores ante una autoridad sin ser el destinatario—, que es
      // lo que de verdad hay que proteger. Prohibir el reenvío liso y llano habría matado el
      // efecto que motivó el formato.
      //
      // ⛔ NO SE INVENTA LA RAZÓN SOCIAL NI EL RUT. Se usa el nombre comercial que ya figura
      // en el encabezado, y `EMISOR_RAZON_SOCIAL` permite poner el nombre legal exacto sin
      // tocar código. Poner un "SpA" o un RUT a ojo en un aviso legal sería inventar un dato
      // — justo lo que la regla del proyecto prohíbe, y encima en el párrafo que pretende
      // tener valor jurídico.
      const razonSocial = String(process.env.EMISOR_RAZON_SOCIAL || 'Activa Inversiones').trim();
      const destinatario = String(nombre || '').trim();
      const legal = 'DOCUMENTO CONFIDENCIAL — USO EXCLUSIVO DEL DESTINATARIO. '
        + `Este informe fue preparado${destinatario ? ` para ${destinatario}` : ''} y para el proyecto que lo motivó. `
        + `Su contenido, cálculos y figuras son de ${razonSocial} y están protegidos por la legislación de `
        + 'propiedad intelectual vigente. Su entrega no transfiere derechos sobre el contenido. '
        + 'Queda prohibida su reproducción total o parcial, su alteración, y su uso por terceros o para un '
        + 'proyecto distinto —incluido presentarlo, o los valores que contiene, ante terceros o autoridades '
        + 'por quien no es el destinatario— sin autorización escrita previa. El uso no autorizado podrá dar '
        + 'lugar a las acciones legales que correspondan.';
      doc.fontSize(7).font('Helvetica');
      const altoLegal = doc.heightOfString(legal, { width: W - 116 });
      doc.rect(50, 208, W - 100, altoLegal + 14).fill('#FDF6E9')
        .strokeColor(GOLD).lineWidth(0.5).rect(50, 208, W - 100, altoLegal + 14).stroke();
      doc.fillColor('#7A5B14').fontSize(7).font('Helvetica')
        .text(legal, 58, 215, { width: W - 116, align: 'justify' });

      let y = 208 + altoLegal + 26;

      // ── SU COTIZACIÓN ───────────────────────────────────────────────────
      // [2026-08-21] Esto es lo primero que ve el cliente, y es lo que separa un informe de
      // un folleto: sus datos, no el catálogo. Solo se dibuja si de verdad los tenemos.
      if (uwCliente !== null || suVidrio) {
        const cumple = uwCliente !== null && uw !== null ? uwCliente <= uw : null;
        doc.rect(50, y, W - 100, 54).fill('#0B3D6F');
        doc.fillColor(GOLD).fontSize(8).font('Helvetica-Bold')
          .text('LA VENTANA DE SU COTIZACIÓN', 60, y + 8);
        doc.fillColor('#fff').fontSize(9).font('Helvetica')
          .text(String(suProducto || 'Ventana PVC termopanel').slice(0, 58), 60, y + 22, { width: 260 });
        if (suVidrio) {
          doc.fillColor('#cbd5e1').fontSize(8)
            .text(`Vidrio: ${suVidrio}`, 60, y + 36, { width: 260 });
        }
        if (uwCliente !== null) {
          doc.fillColor('#fff').fontSize(8).font('Helvetica').text('Uw calculado', 340, y + 12, { width: 90 });
          doc.fillColor(cumple === false ? '#fca5a5' : '#86efac').fontSize(20).font('Helvetica-Bold')
            .text(`${dec(uwCliente, 2)}`, 340, y + 24, { width: 90 });
          doc.fillColor('#cbd5e1').fontSize(7).font('Helvetica').text('W/m²K', 393, y + 33);
        }
        if (cumple !== null) {
          doc.fillColor(cumple ? '#86efac' : '#fca5a5').fontSize(10).font('Helvetica-Bold')
            .text(cumple ? '✓ CUMPLE' : '✗ NO CUMPLE', W - 175, y + 20, { width: 115, align: 'right' });
          doc.fillColor('#cbd5e1').fontSize(7).font('Helvetica')
            .text(`exigencia ${dec(uw)} W/m²K`, W - 175, y + 36, { width: 115, align: 'right' });
        }
        y += 68;
      }

      const seccion = (titulo) => {
        saltoSiNoCabe(60);
        doc.moveTo(50, y).lineTo(W - 50, y).strokeColor(GOLD).lineWidth(1).stroke();
        y += 10;
        doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold').text(titulo, 50, y);
        y += 20;
      };
      const parrafo = (txt, { bold = false, color = DARK, size = 10 } = {}) => {
        saltoSiNoCabe(size * 3);
        doc.fillColor(color).fontSize(size).font(bold ? 'Helvetica-Bold' : 'Helvetica');
        doc.text(txt, 50, y, { width: W - 100, align: 'justify' });
        y = doc.y + 8;
      };
      // [2026-08-21] El dueno pidio el informe COMPLETO: "entregale el informe real, no importa
      // si son varias hojas". Asi que se deja de pelear por entrar en una pagina y se agrega un
      // salto explicito. La paginacion automatica sigue APAGADA — los cortes los decidimos acá.
      const saltoSiNoCabe = (alto) => {
        if (y + alto <= doc.page.height - 70) return;
        doc.addPage();
        doc.page.margins.bottom = 0;
        y = 60;
      };
      const dato = (etiqueta, valor) => {
        saltoSiNoCabe(26);
        doc.fillColor(GRAY).fontSize(9).font('Helvetica').text(etiqueta, 55, y + 6, { width: 230 });
        doc.fillColor(DARK).fontSize(12).font('Helvetica-Bold').text(valor, 290, y + 3, { width: W - 345, align: 'right' });
        y += 25;
      };

      // ═══ GRÁFICOS ═══════════════════════════════════════════════════════
      // [2026-08-21] Pedido del dueño: "pensé que tendría gráficas para que se vea
      // impresionante". Se dibujan con primitivas de pdfkit (rect + text): sin librerías,
      // sin imágenes externas, sin peso extra.
      // ⚠️ TODO SALE DE DATOS VERIFICADOS DE THERMAL. No hay ni una comparación inventada
      // —nada de "el aluminio da 5,8"— porque ese número no lo tenemos medido y este
      // documento va firmado. Se grafica lo que la API entrega y nada más.

      /** Escala de temperatura: dónde tiene que mantenerse la cara interior del vidrio. */
      const graficoCondensacion = () => {
        const alto = 96;
        saltoSiNoCabe(alto + 20);
        const x0 = 60, ancho = W - 120, yBar = y + 30, hBar = 20;
        // El rango se arma con los datos reales, con un margen a cada lado.
        const min = Math.floor(tE - 2);
        const max = 21;
        const px = (t) => x0 + ((t - min) / (max - min)) * ancho;

        // Zona de condensación (desde el mínimo hasta el umbral de 65 %) en rojo suave.
        doc.rect(x0, yBar, px(t65) - x0, hBar).fill('#f3d0cd');
        // Zona segura.
        doc.rect(px(t65), yBar, x0 + ancho - px(t65), hBar).fill('#d6ecd9');
        doc.rect(x0, yBar, ancho, hBar).strokeColor('#cbd5e1').lineWidth(0.5).stroke();

        const marca = (t, etiqueta, color, arriba) => {
          const xx = px(t);
          doc.moveTo(xx, yBar - (arriba ? 8 : 0)).lineTo(xx, yBar + hBar + (arriba ? 0 : 8))
            .strokeColor(color).lineWidth(1.5).stroke();
          doc.fillColor(color).fontSize(7).font('Helvetica-Bold');
          doc.text(etiqueta, xx - 45, arriba ? yBar - 20 : yBar + hBar + 10, { width: 90, align: 'center' });
        };
        marca(tE, `Exterior ${dec(tE)} °C`, '#2563eb', true);
        marca(t65, `Condensa bajo ${dec(t65)} °C`, '#b91c1c', false);
        if (t75 !== null) marca(t75, `Con 75 % HR: ${dec(t75)} °C`, '#c2410c', true);
        marca(19, 'Interior 19 °C', '#0a7d33', false);

        doc.fillColor('#b91c1c').fontSize(7).font('Helvetica-Bold')
          .text('CONDENSA', x0 + 4, yBar + 6);
        doc.fillColor('#0a7d33')
          .text('SIN CONDENSACIÓN', px(t65) + 6, yBar + 6);
        y += alto;
      };

      /** Barras horizontales de Ug: cuanto más corta, mejor aísla. */
      const graficoVidrios = (entradas) => {
        const filas = entradas.slice(0, 10);
        const alto = filas.length * 15 + 34;
        saltoSiNoCabe(alto);
        const x0 = 175, ancho = W - 235;
        const maxUg = Math.max(...filas.map(([, v]) => num(v.Ug) || 0), 3);
        doc.fillColor(GRAY).fontSize(7).font('Helvetica')
          .text('Ug en W/m²K — barra más corta = aísla mejor', x0, y, { width: ancho });
        y += 12;
        for (const [cod, v] of filas) {
          const ug = num(v.Ug);
          if (ug === null) continue;
          const largo = Math.max(6, (ug / maxUg) * ancho);
          const bueno = ug <= 1.4;
          const suyo = esSuVidrio(cod);
          // El vidrio del cliente va resaltado: entre 10 filas, tiene que encontrar la suya.
          if (suyo) doc.rect(50, y - 2, W - 100, 13).fill('#fff7e6');
          doc.fillColor(suyo ? '#92400e' : DARK).fontSize(7).font(suyo ? 'Helvetica-Bold' : 'Helvetica')
            .text((suyo ? '\u25B6 ' : '') + String(cod).replace(/_/g, ' ').slice(0, 28), 55, y + 2, { width: 115 });
          doc.rect(x0, y, largo, 9).fill(bueno ? '#0a7d33' : (ug <= 2 ? '#C4993B' : '#94a3b8'));
          doc.fillColor(DARK).fontSize(7).font('Helvetica-Bold')
            .text(dec(ug, 2), x0 + largo + 4, y + 1, { width: 40 });
          y += 15;
        }
        y += 8;
      };

      // ── 1. EXIGENCIA ────────────────────────────────────────────────────
      seccion('1 · QUÉ EXIGE LA NORMA EN SU COMUNA');
      if (esReferenciaRegional) {
        parrafo(`No contamos aún con su comuna, así que este informe toma ${datos.comuna} como referencia `
          + 'por ser la capital regional. Al confirmarnos su comuna se emite el informe exacto: la '
          + 'exigencia cambia de una comuna a otra.', { color: GRAY, size: 9 });
      }
      if (tienePDA) {
        dato('Régimen aplicable', 'Plan de Descontaminación (PDA)');
        dato('Transmitancia máxima admisible (Uw)', `${dec(uw)} W/m²K`);
        dato('Zona térmica (NCh 1079)', String(datos.zona_termica_NCh1079 || '—'));
        y += 2;
        parrafo(esReferenciaRegional
          ? `En ${datos.comuna} este tope es obligatorio por decreto. En otras comunas de la región no `
            + 'rige, aunque las condiciones de frío sean equivalentes.'
          : 'Este tope no es una recomendación: es una exigencia por elemento establecida por decreto. '
            + 'Una ventana que lo supere no cumple la norma vigente en su comuna.');
        if (datos.criterio_ref) parrafo(`Referencia: ${datos.criterio_ref}`, { color: GRAY, size: 8 });
      } else {
        dato('Régimen aplicable', 'Reglamentación Térmica (OGUC 4.1.10)');
        dato('Zona térmica (NCh 1079)', String(datos.zona_termica_NCh1079 || '—'));
        y += 4;
        parrafo('En su comuna no rige un tope de transmitancia por ventana; la exigencia opera sobre el '
          + 'porcentaje máximo de superficie vidriada. Las condiciones de frío y humedad, sin embargo, '
          + 'son las mismas que en las comunas con Plan de Descontaminación.');
      }

      // ── 2. CONDENSACIÓN ─────────────────────────────────────────────────
      if (tieneCond) {
        y += 6;
        seccion('2 · RIESGO DE CONDENSACIÓN');
        parrafo('La condensación —el agua que aparece en el vidrio— ocurre cuando la superficie interior '
          + 'baja de cierta temperatura. Ese umbral depende del clima de su comuna y de la humedad '
          + 'dentro de la vivienda.');
        y += 2;
        dato(`Clima exterior de referencia — ${datos.comuna}`, `${dec(tE)} °C  ·  ${Math.round(hE * 100)} % HR`);
        dato('Temperatura interior considerada', '19 °C');
        dato('Umbral con 65 % de humedad interior', `${dec(t65)} °C`);
        if (t75 !== null) dato('Umbral con 75 % de humedad interior', `${dec(t75)} °C`);
        y += 2;
        parrafo(`Con 19 °C interiores y 65 % de humedad, si la cara interior del vidrio baja de `
          + `${dec(t65)} °C se produce condensación.`
          + (t75 !== null
            ? ` En recintos con más humedad —cocina, baño, ropa secándose— el umbral sube a ${dec(t75)} °C, `
              + 'es decir, condensa más fácil.'
            : ''), { bold: true });
        y += 4;
        graficoCondensacion();
        if (cond?.metodo) parrafo(`Método: ${cond.metodo}`, { color: GRAY, size: 8 });
      }

      // ── 3. CATÁLOGO DE VIDRIOS ──────────────────────────────────────────
      // Es la seccion que el cliente REENVIA: le permite comparar peras con peras cuando
      // otro proveedor le pasa un precio sin decirle que vidrio lleva.
      const lista = vidrios && typeof vidrios === 'object' ? Object.entries(vidrios) : [];
      if (lista.length) {
        y += 6;
        seccion('3 · VIDRIOS Y SU TRANSMITANCIA (Ug)');
        parrafo('Buena parte de la diferencia entre una ventana y otra está en el vidrio. Estos son '
          + 'los vidriados con Ug documentado. A menor Ug, menos calor se escapa.', { size: 9, color: GRAY });
        y += 4;

        const filaVidrio = (cod, x, cabecera = false) => {
          saltoSiNoCabe(22);
          if (cabecera) {
            doc.rect(50, y, W - 100, 18).fill(NAVY);
            doc.fillColor('#fff').fontSize(8).font('Helvetica-Bold');
            doc.text('VIDRIO', 56, y + 5, { width: 150 });
            doc.text('Ug (W/m²K)', 210, y + 5, { width: 60, align: 'right' });
            doc.text('RESPALDO', 285, y + 5, { width: 70 });
            doc.text('DESCRIPCIÓN', 360, y + 5, { width: W - 415 });
            y += 18;
            return;
          }
          doc.fillColor(DARK).fontSize(8).font('Helvetica');
          doc.text(String(cod).replace(/_/g, ' '), 56, y + 4, { width: 150 });
          doc.fillColor(num(x.Ug) !== null && num(x.Ug) <= 1.4 ? '#0a7d33' : DARK).font('Helvetica-Bold');
          doc.text(num(x.Ug) !== null ? dec(x.Ug, 2) : '—', 210, y + 4, { width: 60, align: 'right' });
          doc.fillColor(String(x.estado).toUpperCase() === 'CERTIFICADO' ? '#0a7d33' : GRAY).font('Helvetica');
          doc.text(String(x.estado || '—').toLowerCase(), 285, y + 4, { width: 70 });
          doc.fillColor(GRAY);
          doc.text(String(x.desc || '').slice(0, 74), 360, y + 4, { width: W - 415 });
          y += 17;
        };

        const ordenados = lista
          .filter(([, x]) => num(x.Ug) !== null)
          .sort((a2, b2) => num(a2[1].Ug) - num(b2[1].Ug));
        graficoVidrios(ordenados);

        filaVidrio(null, null, true);
        // Mismo orden que el gráfico: el mejor arriba, que es como se compara.
        ordenados.forEach(([cod, x]) => filaVidrio(cod, x));

        y += 4;
        if (suVidrio) {
          parrafo('\u25B6 La fila resaltada es el vidrio considerado en su cotización.', { size: 8, color: '#92400e', bold: true });
        }
        parrafo('«Certificado» significa que el Ug proviene de un informe de ensayo del fabricante. '
          + '«Tabulado» significa que proviene de ficha técnica. Ambos son datos de origen, no estimaciones '
          + 'nuestras.', { size: 8, color: GRAY });
      }

      // ── 4. QUÉ SIGNIFICA ────────────────────────────────────────────────
      y += 6;
      seccion(`${lista.length ? '4' : '3'} · QUÉ SIGNIFICA PARA SU PROYECTO`);
      parrafo('Una ventana de PVC con termopanel mantiene la cara interior del vidrio por encima de esos '
        + 'umbrales, incluso en las noches más frías. Un perfil de aluminio sin rotura de puente térmico, '
        + 'o un vidrio simple, no lo consigue: por eso amanecen mojados. En la propuesta que recibirá a '
        + 'continuación se indica la transmitancia (Uw) calculada para sus ventanas y si cumple.');

      // ── 5. ISOTERMAS DEL CORTE REAL (FEM de ACTIVA THERMAL) ─────────────
      //
      // [2026-08-24] Pedido del dueño: *"tan pequeño sabiendo que puedes pasarle el FEM al
      // termopanel para ver la isoterma"*. El informe pesaba 9 KB mientras THERMAL ya tenía
      // 7 figuras del corte real con las isotermas cada 1 °C, aprobadas y firmadas.
      //
      // 🔴 CÓMO SE ROTULAN, Y POR QUÉ NO ES NEGOCIABLE. Cada PNG viaja con la cabecera
      // `X-No-Declarable: true` y THERMAL lo dice en su propia respuesta: *"figuras
      // ilustrativas; los valores declarables salen del cálculo"*. Entonces:
      //   · se nombra EL PERFIL que se está mostrando (hoy el único con láminas es el
      //     S60 proyectante) — dejar que el cliente asuma que es SU ventana sería
      //     afirmarle algo que el proveedor no respalda;
      //   · se dice explícitamente que el número sale del cálculo, no de mirar la figura.
      // Sacar cualquiera de las dos cosas convierte un argumento técnico en una promesa
      // falsa, y es exactamente lo que la regla anti-alucinación del proyecto prohíbe.
      const figuras = Array.isArray(laminas?.laminas) ? laminas.laminas.filter((l) => l && l.png) : [];
      // 🔴 [P0 · hallazgo de Gemini, 24-ago] EL NOMBRE DEL PERFIL ES CONDICIÓN, NO ADORNO.
      // Antes el bloque se dibujaba con `if (figuras.length)` y la advertencia colgaba de un
      // `if (laminas?.nombre)` aparte: si THERMAL devolvía un perfil con los nombres vacíos,
      // las isotermas salían SIN ROTULAR dentro de un informe firmado por un evaluador
      // acreditado MINVU. Tres cortes térmicos a color y ni una línea que los relativice ⇒
      // el cliente asume que le simularon SU ventana.
      // Se prefiere un informe SIN figuras a un informe con figuras que induzcan a error:
      // si no podemos decir QUÉ estamos mostrando, no se muestra.
      // [P1 · Codex] `.trim()` y cae al id del perfil: un nombre de solo espacios pasaba el
      // truthy y salia 'Corte del sistema   ' — rotulo vacio es lo mismo que sin rotulo.
      const idPerfil = String(laminas?.nombre || '').trim() || String(laminas?.perfil || '').trim();
      if (figuras.length && idPerfil) {
        const nSec = lista.length ? '5' : '4';
        seccion(`${nSec} · CÓMO SE COMPORTA EL PERFIL POR DENTRO`);
        parrafo('Estas figuras salen del cálculo por elementos finitos del perfil: cada línea une los '
          + 'puntos que están a la misma temperatura. Donde las líneas se juntan, el calor escapa más '
          + 'rápido; donde se separan, el perfil aísla.');
        {
          // [P1 · Gemini] SE DICE QUÉ TIPO DE VENTANA ES LA DE LA FIGURA.
          // Hoy THERMAL publica láminas de UN solo sistema (S60 proyectante) y el producto
          // más vendido es la corredera. Decir solo "figura ilustrativa" no alcanza: el
          // cliente que cotizó una corredera necesita saber que el corte que está viendo
          // no es el de su tipo de ventana. Se declara el hecho —qué sistema se ilustra—
          // sin afirmar nada comparativo sobre el rendimiento de un tipo frente al otro,
          // porque eso no lo respalda esta figura.
          // [P2 · Codex] Los campos vienen de una API ajena: se ACOTAN. Un `nombre` de 1000
          // caracteres empujaba el rotulo varias lineas y la imagen se dibujaba encima.
          const corto = (x, n) => String(x || '').trim().slice(0, n);
          const aviso = `Corte del sistema ${corto(idPerfil, 80)}`
            + `${corto(laminas.aprobadoPor, 60) ? ` · modelo aprobado por ${corto(laminas.aprobadoPor, 60)}` : ''}`
            + `${corto(laminas.fecha, 20) ? ` (${corto(laminas.fecha, 20)})` : ''}. `
            + 'Figuras ILUSTRATIVAS de cómo se comporta el PVC con termopanel: corresponden al sistema '
            + 'indicado y NO son la simulación de su ventana en particular. Si su cotización incluye otro '
            + 'tipo de apertura —por ejemplo corredera— el perfil de su ventana no es el de estas figuras. '
            + 'Los valores declarables (Uw) de su proyecto salen del cálculo normativo, no de leer un '
            + 'color en la figura.';
          doc.fillColor(GRAY).fontSize(8).font('Helvetica');
          // El alto REAL del rotulo, con la fuente ya fijada en 8 (heightOfString usa la
          // fuente actual del documento; pasarle `fontSize` como opcion no hace nada).
          const altoAviso = doc.heightOfString(aviso, { width: W - 100 });
          saltoSiNoCabe(altoAviso + 20);
          doc.text(aviso, 50, y, { width: W - 100 });
          y += altoAviso + 18;
        }

        for (const f of figuras) {
          const pie = PIES_LAMINA[f.id] || '';
          // Se mide la imagen para reservar el alto EXACTO antes de decidir el salto de
          // página: la paginación automática está apagada a propósito en este documento.
          const dim = medirPng(f.png);
          // 🔴 [hallazgo de Codex, medido] TOPE POR MEGAPÍXELES, también acá.
          // `laminasThermal` ya lo filtra, pero esta función acepta `laminas` de cualquier
          // llamador y el costo de equivocarse no es un PDF feo: un PNG de 10000x10000 RGBA
          // entra bajo cualquier techo de bytes y se come ~1,4 GB al decodificarse ⇒ mata el
          // proceso del bot y se cae la atención de TODOS los clientes, no solo este informe.
          // Medido: 3000x3000 RGBA = 34 KB en disco → +129 MB de RSS.
          if (dim && (dim.ancho * dim.alto) / 1e6 > MAX_MPX_FIGURA) continue;
          const anchoUtil = W - 100;
          const alto = dim ? Math.min(Math.round(anchoUtil * (dim.alto / dim.ancho)), 430) : 300;
          saltoSiNoCabe(alto + (pie ? 40 : 16));
          try {
            doc.image(f.png, 50, y, { fit: [anchoUtil, alto], align: 'center' });
          } catch {
            // Una figura que no se puede dibujar NO puede costarle el informe al cliente.
            continue;
          }
          y += alto + 8;
          if (pie) {
            doc.fillColor(GRAY).fontSize(8).font('Helvetica').text(pie, 50, y, { width: anchoUtil });
            y += doc.heightOfString(pie, { width: anchoUtil }) + 14;
          }
        }
      }

      // ── ALCANCE ─────────────────────────────────────────────────────────
      // Decir QUE NO cubre el informe es lo que lo vuelve creible. Un documento que promete
      // todo se lee como folleto; uno que declara sus limites se lee como informe tecnico.
      // El texto sale de la propia API (`que_NO_verifica`), no se inventa.
      const noCubre = []
        .concat(Array.isArray(datos.que_NO_verifica) ? datos.que_NO_verifica : [])
        .concat(Array.isArray(cond?.que_NO_verifica) ? cond.que_NO_verifica : [])
        .map((x) => String(x).split(' (usar ')[0].split(': ver ')[0].trim())
        .filter((x) => x && x.length < 130)
        .slice(0, 6);
      if (noCubre.length) {
        y += 6;
        seccion(`${lista.length ? '5' : '4'} · ALCANCE DE ESTE INFORME`);
        parrafo('Este documento cubre la exigencia aplicable a las VENTANAS. No verifica:', { size: 9 });
        doc.fillColor(GRAY).fontSize(8).font('Helvetica');
        for (const item of noCubre) {
          saltoSiNoCabe(14);
          doc.text(`•  ${item}`, 55, y, { width: W - 110 });
          y = doc.y + 3;
        }
        y += 4;
        parrafo('La evaluación completa de la envolvente (muros, techumbre, pisos) y la acreditación '
          + 'ante el permiso de edificación se realizan por separado. Consúltenos si su proyecto lo requiere.',
        { size: 8, color: GRAY });
      }

      // ── FIRMA ───────────────────────────────────────────────────────────
      // El bloque de firma mide ~95 px (separador + nombre + cargo + resolución + teléfono) y
      // el pie arranca en height-52. Reservar 210 como antes mandaba la firma a una segunda
      // página VACÍA de contenido — el mismo síntoma del bug de las cotizaciones, medido acá:
      // 2 páginas donde la 2ª solo tenía la firma. Un informe preliminar entra en una hoja.
      saltoSiNoCabe(110);
      y += 12;
      doc.moveTo(50, y).lineTo(W - 50, y).strokeColor(GOLD).lineWidth(1).stroke();
      y += 16;
      doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold')
        .text(firma.nombre || 'Ing. Marcelo Cifuentes Méndez', 50, y);
      y = doc.y + 2;
      doc.fillColor(GRAY).fontSize(9).font('Helvetica')
        .text(firma.cargo || 'Evaluador Energético Externo acreditado MINVU', 50, y, { width: W - 100 });
      y = doc.y + 1;
      if (firma.resolucion) {
        doc.fillColor(GRAY).fontSize(9).text(firma.resolucion, 50, y, { width: W - 100 });
        y = doc.y + 1;
      }
      doc.fillColor(GRAY).fontSize(8)
        .text('Consultas técnicas: +56 9 5729 6035', 50, y + 4);

      // ── PIE EN TODAS LAS PÁGINAS ────────────────────────────────────────
      // Con varias hojas, un pie solo en la última deja las anteriores sin identificar. Se
      // recorre el buffer de páginas al final, que es la forma que soporta pdfkit.
      const pie = { align: 'center', width: W - 100, lineBreak: false };
      const rango = doc.bufferedPageRange();
      for (let i = rango.start; i < rango.start + rango.count; i++) {
        doc.switchToPage(i);
        doc.page.margins.bottom = 0;
        doc.rect(0, doc.page.height - 52, W, 52).fill(NAVY);
        doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold')
          .text('Activa Inversiones · Fábrica de Ventanas y Puertas PVC · Temuco', 50, doc.page.height - 42, pie);
        doc.fillColor(GOLD).fontSize(8).font('Helvetica')
          .text(`www.activaspa.cl  ·  Informe preliminar sin costo  ·  Página ${i - rango.start + 1} de ${rango.count}`,
            50, doc.page.height - 26, pie);
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

export default { generarInformeTermicoPdf, VERSION };
