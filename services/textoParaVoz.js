// services/textoParaVoz.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// [2026-08-31] NORMALIZADOR DE TEXTO PARA TTS (nota de voz de Oliver).
//
// QUE RESUELVE (reclamo textual del dueno, hoy):
//   "QUE DIGA CIENTOS MILES MILLONES CUANDO NOMBRE EL NUMERO, SE PIERDE,
//    LOS DICE UNO POR UNO CUANDO SON MILLONES"
// El texto iba CRUDO a ElevenLabs (services/voiceBridge.js). Un monto como
// "$6.200.000" se sintetizaba leyendo digitos sueltos en vez de
// "seis millones doscientos mil pesos".
//
// FILOSOFIA — CONSERVADORA A PROPOSITO:
//   Es MEJOR no convertir algo dudoso que convertir mal un telefono. Solo se
//   convierten a palabras los MONTOS EN PESOS. Todo lo demas que parezca
//   telefono / RUT / medida / folio / hora / fecha / URL se BLINDA con un
//   marcador antes de tocar nada, y se restituye tal cual al final.
//
// FORMATO CHILENO: el punto es separador de MILES y la coma es DECIMAL.
//
// TILDES: la salida lleva tildes correctas ("millon" -> "millón",
//   "veintitres" -> "veintitrés"). No es cosmetico: la tilde es la que le dice
//   al TTS donde va el acento. Sin ella "millon" se lee grave ("MI-llon").
//   Los tests comprueban las dos formas: la acentuada y, sin tildes, el texto
//   literal que pidio el dueno.
//
// FUNCION PURA: no toca red, ni disco, ni env. Entra string, sale string.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0.0';

// ───────────────────────────────────────────────────────────────────────────
// 1) NUMERO -> PALABRAS (castellano, con las formas irregulares)
// ───────────────────────────────────────────────────────────────────────────

const UNIDADES = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete',
  'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés',
  'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
];

// Apocope: delante de sustantivo masculino "uno" -> "un", "veintiuno" -> "veintiún".
const APOCOPE = { uno: 'un', veintiuno: 'veintiún' };

const DECENAS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];

const CENTENAS = [
  '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos',
];

// n en [0, 999]. apocope=true para "un peso" / "veintiún mil" / "treinta y un mil".
function menorMil(n, apocope) {
  if (n === 0) return '';
  if (n === 100) return 'cien'; // 100 es "cien"; 101 ya es "ciento uno"
  if (n < 30) {
    const w = UNIDADES[n];
    return apocope && APOCOPE[w] ? APOCOPE[w] : w;
  }
  if (n < 100) {
    const d = Math.floor(n / 10);
    const u = n % 10;
    return u === 0 ? DECENAS[d] : `${DECENAS[d]} y ${menorMil(u, apocope)}`;
  }
  const c = Math.floor(n / 100);
  const r = n % 100;
  return r === 0 ? CENTENAS[c] : `${CENTENAS[c]} ${menorMil(r, apocope)}`;
}

// n en [0, 999999]. "mil" (no "un mil"), "doscientos mil", "veintiún mil".
function bajoMillon(n, apocope) {
  if (n === 0) return '';
  const miles = Math.floor(n / 1000);
  const resto = n % 1000;
  let out = '';
  if (miles === 1) out = 'mil';
  else if (miles > 1) out = `${menorMil(miles, true)} mil`;
  if (resto > 0) out = out ? `${out} ${menorMil(resto, apocope)}` : menorMil(resto, apocope);
  return out;
}

/**
 * Numero entero a palabras. Devuelve null si no es convertible (NaN, negativo,
 * no entero, o tan grande que no vale la pena arriesgarse).
 */
export function numeroAPalabras(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0 || num > 999999999999) return null;
  if (num === 0) return 'cero';
  const millones = Math.floor(num / 1000000);
  const resto = num % 1000000;
  let out = '';
  if (millones === 1) out = 'un millón';
  else if (millones > 1) out = `${bajoMillon(millones, true)} millones`;
  if (resto > 0) out = out ? `${out} ${bajoMillon(resto, true)}` : bajoMillon(resto, true);
  return out;
}

/**
 * Monto en pesos a palabras, listo para decir en voz alta.
 *   1000000 -> "un millón de pesos"   (los millones redondos llevan "de")
 *   6200000 -> "seis millones doscientos mil pesos"
 *   2500    -> "dos mil quinientos pesos"
 * centavos: string opcional de 1-2 digitos (decimal chileno, rarisimo).
 */
export function montoAPalabras(entero, centavos = null) {
  const palabras = numeroAPalabras(entero);
  if (palabras === null) return null;
  const num = Number(entero);
  // "un millón DE pesos" / "dos millones DE pesos": solo cuando es millon redondo.
  const conDe = num >= 1000000 && num % 1000000 === 0;
  let out = `${palabras} ${conDe ? 'de pesos' : 'pesos'}`;
  if (centavos) {
    const c = numeroAPalabras(Number(String(centavos).padEnd(2, '0')));
    if (c) out += ` con ${c}`;
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// 2) LIMPIEZA DE MARKDOWN / EMOJIS / VINETAS
//    Todo esto hoy se lee en voz alta y ensucia la nota de voz.
// ───────────────────────────────────────────────────────────────────────────

function limpiarFormato(s) {
  let t = String(s);

  // Emojis y modificadores (tono de piel, variation selector, keycap).
  t = t.replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{20E3}]/gu, '');

  // Markdown / WhatsApp: **negrita**, *negrita*, _cursiva_, ~tachado~, `codigo`.
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  t = t.replace(/\*([^*\n]+)\*/g, '$1');
  t = t.replace(/(?<![A-Za-zÀ-ÿ0-9])_([^_\n]+)_(?![A-Za-zÀ-ÿ0-9])/g, '$1');
  t = t.replace(/~([^~\n]+)~/g, '$1');
  t = t.replace(/`+/g, '');

  // Links [texto](url) -> texto
  t = t.replace(/\[([^\]\n]+)\]\((?:[^)\s]+)\)/g, '$1');

  // Encabezados, citas y vinetas al inicio de linea.
  t = t.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  t = t.replace(/^[ \t]*>[ \t]?/gm, '');
  t = t.replace(/^[ \t]*[-*•·–—][ \t]+/gm, '');

  // Saltos de linea -> pausa hablada.
  t = t.replace(/\r/g, '');
  t = t.replace(/\n+/g, '. ');

  // Puntuacion duplicada que quedo del paso anterior (":." , ".." , ",.").
  t = t.replace(/([.:;,!?¡¿])\s*\.\s*/g, '$1 ');
  t = t.replace(/\s{2,}/g, ' ');

  return t.trim();
}

// ───────────────────────────────────────────────────────────────────────────
// 3) BLINDAJE: lo que NO se convierte nunca
//    Se saca del texto con un marcador SIN DIGITOS (para que ningun regex
//    posterior lo confunda con un monto) y se restituye literal al final.
//    El marcador es visible a proposito: un caracter invisible en el fuente
//    es imposible de revisar.
// ───────────────────────────────────────────────────────────────────────────

const ABRE = '«VOZ';
const CIERRA = 'VOZ»';
const LETRAS = 'ABCDEFGHIJ';

function marcador(i) {
  return ABRE + String(i).split('').map((d) => LETRAS[Number(d)]).join('') + CIERRA;
}

// ORDEN IMPORTANTE: lo mas especifico primero.
const BLINDADOS = [
  // URLs y correos (adentro puede haber cualquier numero).
  /\b(?:https?:\/\/|www\.)\S+/gi,
  /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g,

  // RUT chileno: 76.123.456-7 · 12.345.678-K · 12345678-9
  /\b\d{1,3}(?:\.\d{3})*-[\dkK]\b/g,

  // Folio de cotizacion: "N° 0392" · "Nº 392" · "folio 0392" · "0392-B"
  /\bfolios?\s*[N°º]?\s*\d+(?:-[A-Za-z])?\b/gi,
  /\bN[°º]\s*\d+(?:-[A-Za-z])?\b/gi,
  /\b\d{3,5}-[A-Za-z]\b/g,
  // Numero con cero a la izquierda: es un codigo, nunca un monto ("0392").
  // El lookbehind/lookahead es CRITICO: sin el, "016" de "$323.016" se blindaba
  // como si fuera un folio y el monto quedaba partido ("...veintitres pesos.016").
  /(?<![\d.,])0\d+(?![\d.,])/g,

  // Hora 9:33 / 15:00:20
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,

  // Fecha 31/08 · 31-08-2026 · 2026-08-31
  /\b\d{4}-\d{1,2}-\d{1,2}\b/g,
  /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g,

  // Medida de ventana: 1500x1200 · 1,50 x 1,20 m · 1.500 X 1.200
  /\b\d{1,3}(?:[.\s]?\d{3})*(?:,\d+)?\s*[xX×]\s*\d{1,3}(?:[.\s]?\d{3})*(?:,\d+)?\s*(?:mm|cm|m)?\b/g,

  // Numero con unidad: 34 mm · 1,50 m · 12 m2 · 15% · 8 kg
  // [2026-08-31] El lookbehind impide que el blindaje arranque a MITAD de un monto, y el
  // lookahead unicode impide que la 'm' de \"mas\" (con tilde) cuente como unidad: en JS \b
  // es ASCII, asi que entre la m y la a-tilde hay frontera de palabra. Sin esto,
  // "$6.200.000 mas IVA" se blindaba como "200.000 m" y salia "seis pesos.200.000".
  /(?<![\d.,])\d+(?:[.,]\d+)?\s*(?:mm|cm|m²|m2|kg|%|m)(?![\p{L}\p{N}])/gu,

  // Perfiles WinHouse: S70, S60, S-70
  /\bS-?\s?\d{2,3}\b/g,

  // Telefonos chilenos: +56957296035 · 56 9 5729 6035 · 9 5729 6035
  /\+\s?\d[\d\s().-]{6,}\d/g,
  /\b(?:56)?\s?9\s?\d{4}\s?\d{4}\b/g,

  // Cualquier corrida larga de digitos SIN puntos de miles = codigo/telefono/ID,
  // nunca un monto escrito a la chilena.
  /\b\d{7,}\b/g,
];

function blindar(texto) {
  const guardados = [];
  let t = texto;
  for (const re of BLINDADOS) {
    t = t.replace(re, (m) => {
      guardados.push(m);
      return marcador(guardados.length - 1);
    });
  }
  return { texto: t, guardados };
}

function restituir(texto, guardados) {
  return texto.replace(/«VOZ([A-J]+)VOZ»/g, (_m, letras) => {
    const i = Number(letras.split('').map((c) => LETRAS.indexOf(c)).join(''));
    return guardados[i] !== undefined ? guardados[i] : '';
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 4) MONTOS -> PALABRAS
// ───────────────────────────────────────────────────────────────────────────

// "1.234.567" (formato chileno) -> 1234567. Devuelve null si no cuadra.
function aEntero(str) {
  const limpio = String(str).replace(/\./g, '');
  if (!/^\d+$/.test(limpio)) return null;
  return Number(limpio);
}

function convertirMontos(texto) {
  let t = texto;

  // (a) Con signo peso: "$6.200.000" · "$ 323.016" · "$2.500,50" · "$6.200.000 pesos"
  //     El "pesos" opcional del final se consume para no decirlo dos veces.
  t = t.replace(
    /\$\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?(?:\s*(?:pesos?|CLP))?/gi,
    (m, num, dec) => {
      const n = aEntero(num);
      if (n === null) return m;
      const w = montoAPalabras(n, dec || null);
      return w === null ? m : w;
    }
  );

  // (b) Sin signo pero con la palabra: "6.200.000 pesos" · "323016 CLP"
  t = t.replace(
    /\b(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*(?:pesos?|CLP)\b/gi,
    (m, num, dec) => {
      const n = aEntero(num);
      if (n === null) return m;
      const w = montoAPalabras(n, dec || null);
      return w === null ? m : w;
    }
  );

  // (c) Sin signo y sin palabra, pero con forma de MILLONES a la chilena
  //     ("6.200.000" = dos o mas grupos de miles). Aca NO se agrega "pesos":
  //     no sabemos que unidad es; solo se arregla que se lea como numero.
  t = t.replace(/\b\d{1,3}(?:\.\d{3}){2,}\b/g, (m) => {
    const n = aEntero(m);
    if (n === null) return m;
    const w = numeroAPalabras(n);
    return w === null ? m : w;
  });

  return t;
}

// ───────────────────────────────────────────────────────────────────────────
// 5) API PUBLICA
// ───────────────────────────────────────────────────────────────────────────

/**
 * Deja el texto listo para mandarselo a un TTS.
 * Limpia formato, blinda lo que no se debe tocar y pasa los montos a palabras.
 * Nunca lanza: ante cualquier problema devuelve el texto original.
 */
export function textoParaVoz(texto) {
  if (texto === null || texto === undefined) return '';
  const base = String(texto);
  try {
    const limpio = limpiarFormato(base);
    if (!limpio) return '';
    const { texto: blindado, guardados } = blindar(limpio);
    const convertido = convertirMontos(blindado);
    return restituir(convertido, guardados).replace(/\s{2,}/g, ' ').trim();
  } catch {
    return base.trim();
  }
}

export default textoParaVoz;
