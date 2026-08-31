// services/bloqueIdentidadPdf.js — [2026-08-30]
//
// A NOMBRE DE QUIÉN VA EL DOCUMENTO. El bloque que identifica al RECEPTOR (razón social o
// persona, + su RUT) en los informes que Oliver entrega.
//
// POR QUÉ EXISTE: pedido del dueño el 30-ago, textual: *"un cliente quiere que le agreguen
// el rut de la empresa o rut persona; normalmente piden rut empresa con nombre de rut
// empresa o nombre de la persona que la pide; así que corrige eso en la cotización y informe
// térmico y el de clima y vientos"*. Nace del caso real de Alfredo Arias Luengo (conv
// 56952077379), que reclamó CUATRO veces por lo mismo.
//
// POR QUÉ ES UN MÓDULO COMPARTIDO Y NO CÓDIGO COPIADO EN CADA INFORME: los dos informes
// están escritos para verse "de la misma casa" (informeTermicoPdf.js:11). El bloque que dice
// a nombre de quién va el documento es justo donde una divergencia se nota y duele — que el
// térmico muestre el RUT y el de vientos no sería peor que no tenerlo en ninguno. Acá se
// dibuja UNA vez y cada informe le pasa su propia paleta.
//
// LAS DOS FORMAS, tal como las escriben los clientes de verdad (medido sobre los inbound de
// conversation_messages, 7 conversaciones de 782 pidiendo RUT o factura):
//   EMPRESA  -> razón social + RUT de la empresa ("a nombre de Maya Mapu Spa, rut 77.1XX.XXX-0")
//   PERSONA  -> nombre + RUT de la persona
// El par tipo + (nombre|razón social) NO se inventó: es el mismo shape que ya usa el contrato
// ISO en la BD viva, terreno_ot_contrato (cliente_tipo 'particular'|'empresa', y luego
// cli_nombre/cli_rut o emp_razon/emp_rut).
//
// REGLAS DURAS DE ESTE BLOQUE:
//  1. El RUT se imprime SOLO si pasa módulo 11 (services/rutChile.js). Un RUT con el dígito
//     verificador cambiado, impreso en un documento formal, es peor que no ponerlo.
//  2. SIN DATO el documento sale exactamente como salía antes: sin rótulos vacíos, sin
//     "undefined", sin líneas en blanco. Ése es hoy el caso más común y no puede empeorar.
//  3. Nada se completa ni se adivina: si falta la razón social se usa el nombre, y si falta
//     todo no hay bloque. Jamás se deriva una razón social de un nombre ni al revés.

import { validarRut } from './rutChile.js';

// Nombres que NO identifican a nadie: son el relleno con que llega la conversación cuando el
// cliente todavía no dijo cómo se llama (webhook.js:2436 cae a 'Cliente'). Un documento
// formal que declara en negrita "Preparado para: Cliente" se ve roto; con estos se mantiene
// la línea chica de siempre en la cabecera y no se abre bloque.
const GENERICOS = new Set(['cliente', 'clienta', 'client', 'sin nombre', 'sin_nombre', 'n/a', 'na', 'nn', '-', '--', 'usuario', 'contacto']);

/**
 * Deja el texto en caracteres que las fuentes estándar del PDF (Helvetica/WinAnsi) SÍ pueden
 * dibujar. Los nombres llegan del perfil de WhatsApp y traen emojis y comillas tipográficas;
 * un carácter que la fuente no puede dibujar dentro del documento "genera desconfianza"
 * (lección del dueño del 24-ago, informeTermicoPdf.js). Los guiones largos se degradan a
 * guion normal por la doctrina del dueño del 27-ago ("se ve falso"), nunca se borran: borrar
 * un separador pega dos palabras.
 */
export function limpiarTextoPdf(valor) {
  return String(valor === 0 ? '0' : (valor || ''))
    .replace(/[   ]/g, ' ')
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E¡-ÿ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decide a nombre de quién sale el documento. No dibuja nada: es pura decisión, para poder
 * probarla sin generar un PDF.
 *
 * @param {object} opts
 * @param {string} opts.nombre        nombre de la persona (el que ya venía de siempre)
 * @param {string} opts.rut           RUT del receptor, como lo escribió el cliente
 * @param {string} opts.razonSocial   razón social, si la factura va a una empresa
 * @param {string} opts.clienteTipo   'empresa' | 'particular' (mismo vocabulario que
 *                                    terreno_ot_contrato.cliente_tipo); opcional
 * @returns {{titular: string, contacto: string, rut: string, hayBloque: boolean,
 *            rutRechazado: boolean, motivoRut: string, esEmpresa: boolean}}
 *   titular       a nombre de quién va (razón social o persona), ya limpio
 *   contacto      la persona que la pidió, SOLO cuando el titular es una empresa distinta
 *   rut           formateado "77.123.456-K", o '' si no validó (entonces NO se imprime)
 *   hayBloque     false => el documento se dibuja igual que antes de este cambio
 *   rutRechazado  llegó un RUT y no pasó módulo 11: hay que volver a pedírselo al cliente
 */
export function identificarCliente({ nombre = '', rut = '', razonSocial = '', clienteTipo = '' } = {}) {
  const persona = limpiarTextoPdf(nombre);
  const empresa = limpiarTextoPdf(razonSocial);
  const tipo = String(clienteTipo || '').trim().toLowerCase();
  // El tipo manda si vino; si no vino, la presencia de razón social es la señal. Nunca al
  // revés: tener tipo 'empresa' sin razón social NO autoriza a inventarle una.
  const esEmpresa = tipo === 'empresa' ? true
    : ((tipo === 'particular' || tipo === 'persona' || tipo === 'natural') ? false : Boolean(empresa));

  const titular = esEmpresa ? (empresa || persona) : (persona || empresa);
  const contacto = (titular && persona && persona.toLowerCase() !== titular.toLowerCase()) ? persona : '';

  const v = validarRut(rut);
  const entregoRut = Boolean(String(rut === 0 ? '0' : (rut || '')).trim());
  const titularReal = (titular && !GENERICOS.has(titular.toLowerCase())) ? titular : '';

  return {
    titular,                       // incluye el genérico: el párrafo legal lo usa igual que antes
    titularVisible: titularReal,   // lo que se muestra en negrita; '' si es relleno
    contacto: titularReal ? contacto : '',
    rut: v.formateado,
    rutRechazado: entregoRut && !v.valido,
    motivoRut: v.motivo,
    esEmpresa,
    hayBloque: Boolean(titularReal || v.valido),
  };
}

/** Recorta al ancho disponible en la fuente/tamaño que el doc tiene puestos AHORA. */
function recortar(doc, texto, ancho) {
  const t = String(texto || '');
  if (ancho <= 0) return '';
  if (doc.widthOfString(t) <= ancho) return t;
  let corte = t;
  while (corte.length > 1 && doc.widthOfString(`${corte}...`) > ancho) corte = corte.slice(0, -1);
  return `${corte.trim()}...`;
}

/**
 * Dibuja el bloque del receptor en la COLUMNA DERECHA de la cabecera y devuelve la `y` donde
 * terminó. Si no hay nada que identificar devuelve 0 y no toca el documento: el informe queda
 * idéntico a como salía antes, que es hoy el caso más frecuente.
 *
 * POR QUÉ A LA DERECHA Y NO DEBAJO DEL "Emitido", que era lo natural: MEDIDO. Metido abajo,
 * el bloque empujaba 22 px todo el cuerpo del documento, y el informe de vientos corto —el
 * que el dueño quiere de UNA página— se pasaba a dos (su paginación automática sigue
 * encendida y el contenido ya terminaba pegado al margen inferior). La franja a la derecha
 * del título, entre la banda navy y la caja de alcance, está VACÍA en los dos informes: ahí
 * el bloque cabe entero sin correr un solo píxel de lo que viene después. Es además donde un
 * documento formal pone a su destinatario.
 *
 * Molde visual: el mismo de la propuesta (index.js:4190-4197, bloque CLIENTE) — rótulo chico
 * en gris arriba, el titular en negrita abajo. Separador "·", nunca guion largo.
 *
 * ⚠️ MEDIDAS DE LA FRANJA, comprobadas con pdfkit (medir con la fuente real, no a ojo):
 *   - el título más ancho de los dos informes es "INFORME DE VIENTOS Y CLIMA" (20 pt bold) y
 *     termina en x = 352; la columna arranca en 370, o sea con 18 px de aire.
 *   - el bloque completo, con razón social de dos líneas Y línea de contacto, termina en
 *     y = 175, todavía por encima de la caja de alcance de los dos informes (178).
 * Si alguien mueve la cabecera, esto se mueve con ella: lo defiende informePdf.cliente.test.js.
 *
 * @param {PDFDocument} doc
 * @param {object} id      lo que devuelve identificarCliente()
 * @param {object} opts    { xDerecha, y, ancho, colorEtiqueta, colorTitular, colorSecundario }
 * @returns {number} la `y` donde terminó de dibujar (0 si no dibujó nada)
 */
export function dibujarIdentidadCliente(doc, id, {
  xDerecha = 545, y = 114, ancho = 175,
  colorEtiqueta = '#485A6B', colorTitular = '#1A2332', colorSecundario = '#485A6B',
} = {}) {
  if (!id || !id.hayBloque) return 0;
  const x = xDerecha - ancho;
  const derecha = { width: ancho, align: 'right' };

  doc.fillColor(colorEtiqueta).fontSize(7).font('Helvetica-Bold')
    .text('PREPARADO PARA', x, y, { ...derecha, lineBreak: false, characterSpacing: 0.7 });

  // Sin nombre real (llegó el RUT y todavía no el nombre), el RUT ocupa la línea principal:
  // se rotula, no se deja suelto.
  doc.fontSize(10.5).font('Helvetica-Bold').fillColor(colorTitular);
  // Una razón social larga NO se recorta si puede caber en dos líneas: el documento va a
  // facturación y "Servicio Agricola y Construccion Limi..." no le sirve a nadie. Recién si
  // no entra en dos líneas se corta, y el nombre completo igual queda en el párrafo legal.
  const titular = id.titularVisible ? aDosLineas(doc, id.titularVisible, ancho) : '';
  const texto = titular || `RUT ${id.rut}`;
  const altoTitular = doc.heightOfString(texto, derecha);
  doc.text(texto, x, y + 10, derecha);

  let cursor = y + 12 + altoTitular;
  if (titular && id.rut) {
    doc.fillColor(colorSecundario).fontSize(9).font('Helvetica')
      .text(`RUT ${id.rut}`, x, cursor, { ...derecha, lineBreak: false });
    cursor += 13;
  }
  // El contacto SOLO entra si el titular cupo en una línea. MEDIDO: con razón social de dos
  // líneas, esta línea cae en y = 169, o sea a la altura de la línea "Emitido" de la izquierda
  // — y con un folio largo (el código admite hasta 40 caracteres) las dos se cruzan. Entre
  // perder el nombre del contacto y que el documento salga con dos textos encimados, se pierde
  // el contacto: la razón social y el RUT, que son los que van a facturación, quedan siempre.
  if (id.contacto && altoTitular <= 16) {
    doc.fillColor(colorSecundario).fontSize(7.5).font('Helvetica');
    doc.text(`Contacto: ${recortar(doc, id.contacto, ancho - 42)}`, x, cursor, { ...derecha, lineBreak: false });
    cursor += 10;
  }
  return cursor;
}

/** Deja el texto en dos líneas como máximo; si no cabe ni así, recorta la segunda. */
function aDosLineas(doc, texto, ancho) {
  if (doc.heightOfString(texto, { width: ancho }) <= 30) return texto;
  const palabras = String(texto).split(' ');
  let corte = palabras.length - 1;
  while (corte > 1) {
    const prueba = palabras.slice(0, corte).join(' ');
    if (doc.heightOfString(prueba, { width: ancho }) <= 30) return `${prueba}...`;
    corte -= 1;
  }
  return recortar(doc, texto, ancho);
}

/**
 * El trozo que se le cuelga a la línea "Emitido: …" cuando NO hay bloque. Es exactamente lo
 * que hacía el informe antes de este cambio, para que el caso sin datos no cambie ni un px.
 * @returns {string} '' o 'Preparado para: Fulano' (sin el separador, lo pone el llamador)
 */
export function textoInlineReceptor(id) {
  if (!id || id.hayBloque || !id.titular) return '';
  return `Preparado para: ${id.titular}`;
}

/**
 * Cómo se nombra al receptor DENTRO del párrafo legal ("Este informe fue preparado para …").
 * Ahí sí entra el nombre genérico, porque ese párrafo ya lo usaba antes.
 * @returns {string} '' | 'Fulano' | 'Fulano, RUT 12.345.678-9'
 */
export function destinatarioLegal(id) {
  if (!id || !id.titular) return id && id.rut ? `RUT ${id.rut}` : '';
  return `${id.titular}${id.rut ? `, RUT ${id.rut}` : ''}`;
}
