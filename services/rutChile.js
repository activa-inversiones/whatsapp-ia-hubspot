// services/rutChile.js — [2026-08-30]
//
// VALIDACIÓN DE RUT CHILENO POR MÓDULO 11. Módulo PURO (cero dependencias, cero I/O) para
// que cualquier frente lo importe: informes, propuesta, Zoho, terreno.
//
// POR QUÉ EXISTE, y por qué la regla es "valida o no se imprime":
// El dueño pidió el 30-ago que la cotización y los informes lleven el RUT del RECEPTOR, a
// partir del caso real de Alfredo Arias Luengo (conv 56952077379), que reclamó CUATRO veces
// por lo mismo. Un RUT mal escrito impreso en un documento formal es PEOR que no ponerlo:
// el cliente lo lleva a facturar, no le cuadra, y el documento pierde toda su autoridad.
// Por eso la única salida honesta cuando el dígito verificador no calza es NO IMPRIMIRLO y
// pedirlo de nuevo. Nunca "corregirlo" ni completarlo: eso sería inventar un dato tributario
// ajeno, que es exactamente lo que la regla anti-alucinación prohíbe.
//
// EL ALGORITMO NO SE INVENTÓ Y ESTÁ COMPROBADO CONTRA TRES RUT REALES QUE YA VIVEN EN EL
// REPO, cada uno con su fuente:
//   76.486.825-0  emisor Activa Inversiones EIRL (informeTermicoPdf.js:460, dato del dueño) -> DV 0 ✓
//   12.988.375-8  Marcelo Cifuentes             (src/oliver-gpt/system-prompt.js:807)       -> DV 8 ✓
//   10.047.794-7  caso Alfredo                  (src/oliver-gpt/pdf-intent.test.js:58)      -> DV 7 ✓
// Los tres se recalculan en rutChile.test.js: si alguien toca el algoritmo, se cae ahí.
//
// PENDIENTE DE UNIFICACIÓN: al 30-ago NO había validador de RUT en NINGUNO de los 4 repos
// (grep de "modulo 11|dígito verificador|validarRut|formatRut" sobre temp-wa, temp-sales-os,
// temp-cxm y cotizador-winhouse). Éste es el primero. Cuando otro frente necesite validar
// RUT (la propuesta de quotePdf.js, Zoho Books, terreno_ot_contrato) debe IMPORTAR ESTE
// ARCHIVO, no escribir el suyo: dos implementaciones del módulo 11 es exactamente como se
// termina aceptando en un documento un RUT que el otro lado rechaza.

/**
 * Dígito verificador por módulo 11.
 * Se recorre el cuerpo de derecha a izquierda multiplicando por la serie 2,3,4,5,6,7 que se
 * reinicia; resto 11 -> "0", resto 10 -> "K".
 * @param {string} cuerpo  solo dígitos, sin puntos ni DV
 * @returns {string|null}  "0".."9" o "K"; null si el cuerpo no es utilizable
 */
export function dvDeRut(cuerpo) {
  const c = String(cuerpo || '').replace(/[^0-9]/g, '');
  if (!c.length) return null;
  let suma = 0;
  let mult = 2;
  for (let i = c.length - 1; i >= 0; i -= 1) {
    suma += Number(c[i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

/** Deja el RUT en crudo: solo dígitos + DV en mayúscula. */
export function limpiarRut(valor) {
  return String(valor === 0 ? '0' : (valor || ''))
    .toUpperCase()
    .replace(/[^0-9K]/g, '');
}

/** Puntos de miles + guion: (12345678, 9) -> "12.345.678-9". */
function conPuntos(cuerpo, dv) {
  return `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
}

// RANGO ACEPTADO (decisión de este cambio, no un dato heredado: al 30-ago las tablas con
// columna RUT de la BD viva estaban VACÍAS de datos reales — terreno_ot_contrato tenía una
// sola fila con 'TEST-123' y municipal_permits.owner_rut, cero — así que no había formato
// que heredar). Hoy en Chile el RUT/RUN vive entre 6 y 8 dígitos de cuerpo: las personas van
// por los 20 y tantos millones y las empresas por los 77 millones; 9 dígitos (100 millones o
// más) todavía no se emiten. Se aceptan 6 porque existen RUT antiguos cortos, y en el corpus
// real de conversaciones apareció uno de 7 (4.99X.XXX-6). Fuera de ese rango se rechaza: es
// mucho más probable un tipeo que un RUT legítimo.
const CUERPO_MIN = 6;
const CUERPO_MAX = 8;

/**
 * Valida un RUT chileno completo (cuerpo + DV) por módulo 11.
 * NO adivina el DV: si no viene, el RUT no es válido y no se imprime.
 * @param {string} valor  como lo escribió la persona: "77.123.456-K", "771234567", "12345678-5"
 * @returns {{valido: boolean, formateado: string, cuerpo: string, dv: string, motivo: string}}
 *   motivo: '' si válido | 'vacio' | 'largo' | 'dv' | 'sin_dv'
 */
export function validarRut(valor) {
  const nulo = { valido: false, formateado: '', cuerpo: '', dv: '', motivo: 'vacio' };
  const crudo = limpiarRut(valor);
  if (!crudo) return nulo;
  // Una K solo puede ir al final: "K1234567" no es un RUT, es basura.
  if (crudo.slice(0, -1).includes('K')) return { ...nulo, motivo: 'largo' };
  if (crudo.length < 2) return { ...nulo, motivo: 'sin_dv' };
  const cuerpo = crudo.slice(0, -1);
  const dv = crudo.slice(-1);
  if (cuerpo.length < CUERPO_MIN || cuerpo.length > CUERPO_MAX) {
    return { ...nulo, cuerpo, dv, motivo: 'largo' };
  }
  // Un cuerpo de puros ceros pasa el módulo 11 (DV 0) y no es el RUT de nadie.
  if (!/[1-9]/.test(cuerpo)) return { ...nulo, cuerpo, dv, motivo: 'largo' };
  if (dvDeRut(cuerpo) !== dv) return { ...nulo, cuerpo, dv, motivo: 'dv' };
  return { valido: true, formateado: conPuntos(cuerpo, dv), cuerpo, dv, motivo: '' };
}

/** @returns {boolean} */
export function rutEsValido(valor) {
  return validarRut(valor).valido;
}

/**
 * Formato canónico para imprimir. Devuelve '' si el RUT no valida: quien llame no tiene que
 * acordarse de chequear — si está vacío, no hay nada que poner en el documento.
 * @returns {string}  "12.345.678-9" o ''
 */
export function formatearRut(valor) {
  return validarRut(valor).formateado;
}
