// services/receptorCliente.js — [2026-08-30]
//
// CAPTURA del RECEPTOR de los documentos: a nombre de quién van, y con qué RUT.
//
// POR QUÉ EXISTE: pedido del dueño el 30-ago, textual: *"un cliente quiere que le agreguen
// el rut de la empresa o rut persona; normalmente piden rut empresa con nombre de rut
// empresa o nombre de la persona que la pide"*. Nace del caso de Alfredo Arias Luengo
// (conv 56952077379), que reclamó CUATRO veces por lo mismo. El fix del 28-ago
// (pdf-intent.js:300) evitó que el LLM ROMPIERA el texto del RUT en el chat; el documento
// seguía sin tener dónde ponerlo.
//
// ⛔ ESTE MÓDULO NO VALIDA RUT: importa `services/rutChile.js`, que es el único módulo 11 del
//    repo. Su cabecera lo pide con nombre y apellido ("cuando otro frente necesite validar
//    RUT debe IMPORTAR ESTE ARCHIVO, no escribir el suyo"), y el propio repo ya aprendió que
//    dos copias paralelas de una regla se desincronizan (normalizers.js:384).
//
// ⛔ NO INVENTA NADA. Extrae lo que el cliente ESCRIBIÓ y lo valida. Si el RUT no cierra por
//    módulo 11 devuelve el rechazo con su motivo para que Oliver lo vuelva a pedir; jamás
//    "corrige" un dígito ni deriva una razón social de un nombre. Un RUT inventado en un
//    documento formal es un problema legal, no un detalle de presentación.
//
// VOCABULARIO: el mismo de `bloqueIdentidadPdf.identificarCliente` y de la tabla
// `terreno_ot_contrato` de la BD viva (`cliente_tipo` 'empresa'|'particular', y luego
// cli_nombre/cli_rut o emp_razon/emp_rut). No se inventó un shape nuevo.
//
// ESM, funciones puras → testeable sin red ni pdfkit.

import { validarRut } from './rutChile.js';

/* =========================================================================
 * PATRONES — todos calibrados contra mensajes REALES de conversation_messages
 * (7 conversaciones de 782 pidieron RUT o factura; sus 6 formas están en el test).
 * ========================================================================= */

/** Guiones que llegan al pegar desde Word, iOS o Excel. */
const GUIONES = /[-‐‑‒–—−]/g;

/** Token con forma de RUT: "77.448.504-K", "4.998.123-6", "77448504-3". */
const RX_CON_GUION = /(\d{1,2}(?:\.\d{3}){1,2}|\d{6,9})\s*[-‐‑‒–—−]\s*([0-9kK])/g;

/**
 * El RUT escrito de corrido, sin guion: "mi rut es 774485043" / "77448504K".
 * Solo se mira cerca de la palabra RUT: un número de 9 dígitos suelto puede ser cualquier cosa.
 */
const RX_SIN_GUION = /\b(\d{5,8}[0-9kK])\b/g;

/**
 * "rut", "r.u.t.", "rut:", "rut.", "rol único tributario" antes del número. El grupo 1 es lo
 * que quedó EN MEDIO: hace falta porque el cliente no siempre pega la palabra al número
 * ("perdón, el rut correcto es 76.486.825-0" mete 13 caracteres entremedio).
 */
const RX_ETIQUETA_RUT = /(?:\brut\b|\br\.?\s?u\.?\s?t\.?|rol\s+[uú]nico\s+tributario)([^0-9]{0,25})$/i;

/**
 * Si entre la palabra RUT y el número aparece una palabra de PLATA, no es un RUT.
 * Cierra el hueco que abre la ventana de 25 caracteres: "mi rut se lo paso después, el total
 * es 1.200.000 - 3 cuotas" tiene la palabra "rut" en la frase y un monto detrás.
 */
const RX_PLATA_EN_MEDIO =
  /\b(?:total|precio|valor|monto|pesos?|clp|abonos?|cuotas?|descuentos?|pagos?|anticipos?|presupuesto)\b/i;

/** ¿El número que empieza en `index` viene rotulado como RUT por el propio cliente? */
function vieneRotuladoComoRut(texto, index) {
  const antes = texto.slice(Math.max(0, index - 46), index);
  const m = RX_ETIQUETA_RUT.exec(antes);
  return Boolean(m) && !RX_PLATA_EN_MEDIO.test(m[1] || '');
}

/**
 * Formas societarias INEQUÍVOCAS. Conservadora a propósito: "sa" suelta no entra (aparece
 * dentro de demasiadas palabras y en apellidos chilenos).
 */
const RX_FORMA_SOCIETARIA =
  /\b(?:spa|s\.\s?p\.\s?a\.?|ltda\.?|limitada|e\.?\s?i\.?\s?r\.?\s?l\.?|s\.\s?a\.?|sociedad|comercializadora|constructora|inmobiliaria)\b/i;

/** Cómo presenta el cliente a quién va dirigido el documento. */
const RX_A_NOMBRE =
  /(?:a\s+nombre\s+(?:de|del)|facturar\s+a(?:\s+nombre\s+de)?|raz[oó]n\s+social|factura\s+a)\s*:?\s*([^\n,;]{2,70})/i;

/* =========================================================================
 * 1) EXTRACCIÓN DEL RUT
 * ========================================================================= */

/**
 * Busca en el texto un RUT que el CLIENTE haya declarado.
 *
 * CONSERVADOR A PROPÓSITO (el objetivo es cero falsos positivos): un número con separadores
 * y guion se toma por RUT solo si (a) viene precedido por la palabra RUT, o (b) el mensaje
 * ES ese número y nada más (el cliente contestando "¿me confirma su RUT?"). Sin esto,
 * "quedamos en 1.200.000 - 3 cuotas" entraría como RUT y el cliente recibiría un "ese RUT no
 * me cuadra" por una frase sobre plata — el error simétrico exacto del que obligó a parchar
 * `stripMontos` el 28-ago.
 *
 * @param {string} texto
 * @returns {{ok:true, rut:string, crudo:string} | {ok:false, motivo:string, crudo:string} | null}
 *          null = el cliente no habló de RUT en este mensaje (el caso normal).
 */
export function extraerRutDeTexto(texto) {
  const t = String(texto || '');
  if (!t.trim()) return null;

  // ¿El mensaje ES ese número? Se mide sacando el token y viendo si queda algo con
  // letras o dígitos. Un umbral de largo ("mensajes cortos") ya se probó y fallaba:
  // "quedamos en 1.200.000 - 3 cuotas" mide 32 caracteres.
  const esElMensajeCompleto = (index, largo) => {
    const resto = t.slice(0, index) + t.slice(index + largo);
    return !/[0-9A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(resto);
  };

  const candidatos = [];
  let m;

  RX_CON_GUION.lastIndex = 0;
  while ((m = RX_CON_GUION.exec(t)) !== null) {
    const etiquetado = vieneRotuladoComoRut(t, m.index);
    if (etiquetado || esElMensajeCompleto(m.index, m[0].length)) {
      candidatos.push({ crudo: `${m[1]}-${m[2]}`, etiquetado });
    }
  }

  if (!candidatos.length) {
    RX_SIN_GUION.lastIndex = 0;
    while ((m = RX_SIN_GUION.exec(t)) !== null) {
      if (vieneRotuladoComoRut(t, m.index)) candidatos.push({ crudo: m[1], etiquetado: true });
    }
  }

  if (!candidatos.length) return null;

  // Gana el primero que VALIDE. Si ninguno valida se reporta el primero etiquetado, con su
  // texto original, para poder repreguntar mostrándole al cliente lo que él escribió.
  for (const c of candidatos) {
    const v = validarRut(c.crudo);
    if (v.valido) return { ok: true, rut: v.formateado, crudo: c.crudo };
  }
  const primero = candidatos.find((c) => c.etiquetado) || candidatos[0];
  return { ok: false, motivo: validarRut(primero.crudo).motivo, crudo: primero.crudo };
}

/* =========================================================================
 * 2) NOMBRE / RAZÓN SOCIAL
 * ========================================================================= */

/**
 * Limpia lo capturado tras "a nombre de". NO lo completa ni lo corrige: solo recorta.
 * @returns {string} '' si lo capturado no parece un nombre.
 */
export function limpiarNombreReceptor(bruto) {
  let n = String(bruto || '').replace(GUIONES, '-').trim();
  // Corta donde empieza el RUT: "Maya Mapu Spa rut 77.1..." → "Maya Mapu Spa".
  n = n.split(/\b(?:con\s+)?(?:rut|r\.\s?u\.\s?t)\b/i)[0];
  // Los suspensivos del caso real "CLOVEL S. A...Rut 4.99X.XXX-6" dejan puntos colgando.
  // Se recorta DE MENOS a propósito: quitar un carácter que el cliente escribió es seguro;
  // agregar uno que no escribió sería inventar.
  n = n.replace(/\.{2,}.*$/, '').replace(/\s{2,}/g, ' ').trim();
  n = n.replace(/[,;:\-\s]+$/, '').trim();
  if (n.length < 2 || n.length > 70) return '';
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]{2}/.test(n)) return '';          // "a nombre de 12345" no es un nombre
  const digitos = (n.match(/\d/g) || []).length;
  const letras = (n.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length;
  if (digitos >= letras) return '';                            // un RUT mal cortado, no un nombre
  return n;
}

/**
 * ¿EMPRESA o PERSONA NATURAL? Las dos formas que pidió el dueño.
 *
 * Orden (la señal explícita del cliente le gana a la heurística numérica):
 *   1. El nombre trae forma societaria (SpA, Ltda, EIRL, S.A.) → empresa. Hace falta: en los
 *      datos reales está "CLOVEL S. A." con un RUT de 7 dígitos, o sea una sociedad ANTIGUA
 *      con RUT en el rango de personas. La banda numérica sola se equivoca ahí.
 *   2. Cuerpo ≥ 50.000.000 → empresa (las personas van hoy por ~28 millones).
 *   3. Cualquier otro caso → particular.
 *
 * ⚠️ Es una CLASIFICACIÓN, no un dato del SII: decide la etiqueta impresa y el
 * customer_sub_type de Zoho. Equivocarla es cosmético; el NÚMERO —lo único con efecto
 * tributario— se imprime validado igual.
 *
 * @returns {'empresa'|'particular'}
 */
export function clasificarTipoCliente(nombre, rut) {
  if (nombre && RX_FORMA_SOCIETARIA.test(String(nombre))) return 'empresa';
  const v = validarRut(rut);
  if (v.valido && Number(v.cuerpo) >= 50000000) return 'empresa';
  return 'particular';
}

/* =========================================================================
 * 3) CAPTURA COMPLETA
 * ========================================================================= */

/**
 * El RUT + a nombre de quién, en las dos formas.
 *
 * ⚠️ En 4 de los 6 casos reales medidos, el nombre del RUT NO es el del chat (perfil
 * "Mjose" pidiendo a nombre de Bayron; "Don Lito" a nombre de Clovel S.A.). Por eso el
 * receptor es un objeto APARTE y jamás pisa `state.name`.
 *
 * @param {string} texto  lo que escribió el cliente en este turno.
 * @param {{ahora?:number, previo?:object}} [opts] - `previo`: receptor ya guardado, para
 *        fusionar cuando el cliente da la razón social en un mensaje y el RUT en otro.
 * @returns {{ok:true, receptor:object} | {ok:false, motivo:string, crudo:string} | null}
 */
export function extraerReceptor(texto, opts = {}) {
  const hallazgo = extraerRutDeTexto(texto);
  if (!hallazgo) return null;
  if (!hallazgo.ok) return hallazgo;

  const mNombre = RX_A_NOMBRE.exec(String(texto || ''));
  const capturado = mNombre ? limpiarNombreReceptor(mNombre[1]) : '';
  const tipo = clasificarTipoCliente(capturado, hallazgo.rut);

  const nuevo = {
    clienteTipo: tipo,
    // EMPRESA → lo capturado es la razón social; la persona del chat queda de contacto.
    // PARTICULAR → lo capturado es el nombre de la persona.
    razonSocial: tipo === 'empresa' ? capturado : '',
    nombre: tipo === 'empresa' ? '' : capturado,
    rut: hallazgo.rut,                 // ya formateado y validado
    origen: 'cliente',                 // procedencia, mismo patrón que color_lo_dijo_el_cliente
    at: Number(opts.ahora) || Date.now(),
  };

  return { ok: true, receptor: fusionarReceptor(opts.previo, nuevo) };
}

/**
 * Fusiona lo ya guardado con lo nuevo. El dato NUEVO manda cuando viene; el viejo sobrevive
 * cuando el turno nuevo no lo trae (el cliente escribe la razón social en un mensaje y el
 * RUT en el siguiente, que es como pasa de verdad).
 */
export function fusionarReceptor(previo, nuevo) {
  const p = (previo && typeof previo === 'object') ? previo : {};
  const n = (nuevo && typeof nuevo === 'object') ? nuevo : {};
  const razonSocial = n.razonSocial || p.razonSocial || '';
  const nombre = n.nombre || p.nombre || '';
  const rut = n.rut || p.rut || '';
  return {
    // Si en algún turno se supo que era empresa, un turno posterior sin razón social no lo
    // degrada a particular: el cliente no "deja de ser" una empresa entre dos mensajes.
    clienteTipo: (n.clienteTipo === 'empresa' || p.clienteTipo === 'empresa')
      ? 'empresa'
      : (n.clienteTipo || p.clienteTipo || clasificarTipoCliente(razonSocial || nombre, rut)),
    razonSocial,
    nombre,
    rut,
    origen: n.origen || p.origen || 'cliente',
    at: n.at || p.at || Date.now(),
  };
}

/* =========================================================================
 * 4) SALIDA — la última puerta antes del papel, de la BD y de Zoho
 * ========================================================================= */

/**
 * NORMALIZA UN RECEPTOR VENGA DE DONDE VENGA y lo deja listo para
 * `bloqueIdentidadPdf.identificarCliente` y para las opciones de los dos informes.
 *
 * 🔴 Vuelve a pasar el RUT por módulo 11. Todo receptor que llegue desde el LLM (parámetro
 * de la tool) pasa por acá: el modelo puede escribir un RUT con un dígito cambiado sin
 * ninguna señal de que lo hizo, y el módulo 11 sí lo ve. Si no valida, el RUT sale VACÍO y
 * el documento se emite sin él — que es correcto — en vez de con uno falso, que no tiene
 * arreglo una vez que el cliente lo llevó a facturar.
 *
 * @param {object} receptor  { clienteTipo?, nombre?, razonSocial?, rut? }
 * @param {{nombreFallback?:string}} [opts]  nombre de la conversación (el contacto).
 * @returns {{nombre:string, razonSocial:string, rut:string, clienteTipo:string} | null}
 */
export function receptorParaDocumento(receptor, opts = {}) {
  if (!receptor || typeof receptor !== 'object') return null;
  const v = validarRut(receptor.rut);
  let razonSocial = String(receptor.razonSocial || '').trim().slice(0, 70);

  // 🔴 [2026-08-30 · compuerta] PROCEDENCIA, NO SOLO FORMA. El módulo 11 dice si un RUT está
  // BIEN ESCRITO, no si el cliente lo dijo: 1 de cada 11 números al azar lo pasa, y un LLM
  // tiende a repetir RUT y razones sociales que vio en su entrenamiento. El revisor lo
  // demostró punta a punta: con el cliente escribiendo "hola, cotízame algo", al PDF llegaba
  // "Constructora Los Andes SpA / 77.448.504-K". Un RUT ajeno en un documento que el cliente
  // lleva a facturar no tiene arreglo después.
  // REGLA: si el dato NO vino del texto del cliente (origen !== 'cliente'), tiene que APARECER
  // en lo que el cliente escribió. Si no aparece, se cae — el documento sale sin él, que es
  // exactamente lo que hay que hacer cuando no se sabe.
  const declarado = String(opts.textoCliente || '');
  const debeVerificarse = receptor.origen !== 'cliente' && declarado.trim() !== '';
  let rutVerificado = v.valido;
  if (debeVerificarse) {
    const soloDigitos = (x) => String(x || '').replace(/[^0-9kK]/g, '').toUpperCase();
    const rutEnTexto = soloDigitos(declarado).includes(soloDigitos(v.formateado)) && soloDigitos(v.formateado).length >= 8;
    if (!rutEnTexto) rutVerificado = false;
    if (razonSocial) {
      const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
      if (!norm(declarado).includes(norm(razonSocial))) razonSocial = '';
    }
  }

  // 🔴 [2026-08-30 · compuerta] EL NOMBRE DEL PERFIL DE WHATSAPP NO ES EL RECEPTOR FISCAL.
  // Medido: en 4 de 6 casos quien escribe NO es quien factura. Usarlo de relleno producía
  // documentos con el nombre de una persona y el RUT de otra, sin ninguna señal. Ahora el
  // fallback viaja aparte como CONTACTO (bloqueIdentidadPdf ya sabe mostrarlo así) y nunca
  // se cuelga del RUT.
  const nombre = String(receptor.nombre || '').trim().slice(0, 70);
  const contacto = String(opts.nombreFallback || '').trim().slice(0, 70);
  // Sin RUT válido Y sin razón social no hay nada que agregar al documento: se devuelve null
  // y el llamador sigue exactamente como antes de este cambio.
  if (!rutVerificado && !razonSocial) return null;
  const clienteTipo = receptor.clienteTipo === 'empresa' || receptor.clienteTipo === 'particular'
    ? receptor.clienteTipo
    : clasificarTipoCliente(razonSocial || nombre, receptor.rut);
  // El RUT sale VACÍO si no se pudo verificar: el documento se emite sin él, nunca con uno dudoso.
  return { nombre: nombre || contacto, contacto, razonSocial, rut: rutVerificado ? v.formateado : '', clienteTipo };
}

/** ¿Este receptor tiene un RUT que se puede imprimir? Guard corto para los llamadores. */
export function tieneRutValido(receptor) {
  return Boolean(receptor && validarRut(receptor.rut).valido);
}

export default {
  extraerRutDeTexto,
  extraerReceptor,
  fusionarReceptor,
  limpiarNombreReceptor,
  clasificarTipoCliente,
  receptorParaDocumento,
  tieneRutValido,
};
