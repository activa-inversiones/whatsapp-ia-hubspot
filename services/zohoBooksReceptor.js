// services/zohoBooksReceptor.js — [2026-08-30]
//
// EL RUT DEL CLIENTE HACIA ZOHO BOOKS. Decide QUÉ campos se le mandan al contacto y CUÁNDO
// es seguro escribir sobre un contacto que ya existe.
//
// Módulo puro (cero I/O, cero axios) a propósito: `zhBooksCreateEstimate` vive dentro de
// index.js, un monolito de ~7.000 líneas que no se puede importar en un test sin levantar el
// servidor. La decisión —que es la parte que puede hacer daño— se prueba acá.
//
// ═══════════════════════════════════════════════════════════════════════════
// QUÉ ESTÁ CONFIRMADO Y QUÉ NO (leído del OpenAPI oficial de Zoho Books,
// https://www.zoho.com/books/api/v3/contacts/contacts.yml, HTTP 200):
//
//  ✅ `company_name`      — "Legal or registered contact's company name. Used for legal
//                           documents and formal communications. Max-length [200]".
//                           SIN `x-node_available_in` ⇒ disponible en TODA edición. Es la
//                           casa correcta de la RAZÓN SOCIAL.
//  ✅ `customer_sub_type` — enum 'individual' | 'business'. Distingue las dos formas que
//                           pidió el dueño (empresa / persona natural).
//  🔴 `custom_fields`     — existe como array de {index, value, label}, pero el LABEL de un
//                           campo RUT depende de lo que el dueño haya creado en SU panel.
//                           NO SE PUDO CONFIRMAR ⇒ va detrás de variable de entorno y NO se
//                           manda nada mientras esa variable no exista. Ver PENDIENTE abajo.
//
//  ⛔ NO USAR `tax_id` PARA EL RUT. La spec dice que es "unique identifier for the tax or tax
//     group assigned to the contact", o sea el id interno de una TASA DE IMPUESTO — y este
//     mismo repo ya usa esa semántica (index.js, `ZOHO.TAX_ID` como tax_id de línea). Meter
//     un RUT ahí es el error clásico y rompería la cotización.
//  ⛔ `tax_reg_no` está gateado a las ediciones gcc/mx/ke/za; `legal_name` es de México;
//     `vat_treatment` es de UK. Ninguno aplica a Chile.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 PENDIENTE DEL DUEÑO — 5 minutos en el panel, y recién ahí el RUT viaja a Books:
//   1. Zoho Books → Settings (⚙) → Preferences → Customers and Vendors → Field Customisation
//      → «+ New Custom Field». Data type: Text. Label: RUT. Marcar «Show in PDF».
//   2. Copiar el LABEL exacto que quedó y ponerlo en la variable de entorno
//      ZOHO_BOOKS_RUT_LABEL (o el id del campo en ZOHO_BOOKS_RUT_FIELD_ID, que es más
//      robusto porque no se rompe si después renombra la etiqueta).
//   3. NO VERIFICADO y hay que mirarlo en el panel: si «Show in PDF» basta por sí solo, o si
//      además hay que insertar el placeholder en Settings → Preferences → Customers and
//      Vendors → «Insert Placeholders» del formato de dirección. La spec y el artículo de
//      ayuda de Zoho se contradicen en apariencia y esto NO se puede resolver desde el
//      código. Se comprueba emitiendo un estimate de prueba y mirando el PDF.
//
// ⚠️ CONTEXTO QUE HAY QUE TENER A LA VISTA: hoy este camino NO SE USA. Medido contra la BD
// viva el 30-ago: 612 cotizaciones en 30 días, CERO con `zoho_estimate_id`; el último
// estimate es del 13-jun. El camino vivo es el PDF propio (services/quotePdf.js), que ya
// lleva el RUT. Esto deja Books LISTO para el día que se reactive, sin quedar a medias.

/** Solo dígitos. */
function soloDigitos(v) {
  return String(v === 0 ? '0' : (v || '')).replace(/\D/g, '');
}

/**
 * ¿Dos teléfonos son el mismo? Se comparan los ÚLTIMOS 8 dígitos: en Chile el móvil son 9
 * dígitos (9XXXXXXXX) y según de dónde venga el dato trae o no el 56 del país y el 9 inicial.
 * Comparar en crudo daría "distinto" para el mismo número.
 */
export function mismoTelefono(a, b) {
  const x = soloDigitos(a);
  const y = soloDigitos(b);
  if (x.length < 8 || y.length < 8) return false;
  return x.slice(-8) === y.slice(-8);
}

/**
 * 🔴 ¿ES SEGURO ESCRIBIR EL RUT SOBRE ESTE CONTACTO DE ZOHO?
 *
 * Existe por un defecto REAL y latente de `zhBooksCreateEstimate` (index.js): busca el
 * contacto con `GET /contacts?phone=...` y se queda con `contacts[0]` SIN comprobar que el
 * teléfono devuelto coincida y SIN filtrar por contact_type. El parámetro `phone` de Zoho
 * matchea "el teléfono de la persona de contacto principal" y admite variantes de tipo
 * "contiene". Mientras solo se leía un id para colgarle una cotización, eso era cosmético.
 * Con un RUT en juego deja de serlo: escribirle el RUT de un cliente al contacto EQUIVOCADO
 * es exactamente el problema legal que la regla anti-alucinación busca evitar, y encima
 * silencioso (nadie se entera hasta que alguien factura mal).
 *
 * Regla: se escribe solo si la identidad se puede confirmar por teléfono O por nombre exacto.
 *
 * @param {object} contacto  el contacto tal cual lo devolvió Zoho
 * @param {{phone?:string, contactName?:string}} esperado  con qué se lo buscó
 * @returns {boolean}
 */
export function contactoEsElMismo(contacto, esperado = {}) {
  if (!contacto || typeof contacto !== 'object') return false;
  const telZoho = contacto.phone || contacto.mobile || contacto.contact_persons?.[0]?.phone || '';
  if (esperado.phone && mismoTelefono(telZoho, esperado.phone)) return true;
  const nombreZoho = String(contacto.contact_name || '').trim().toLowerCase();
  const nombreEsperado = String(esperado.contactName || '').trim().toLowerCase();
  if (nombreZoho && nombreEsperado && nombreZoho === nombreEsperado) return true;
  return false;
}

/**
 * Los campos del contacto que llevan la identidad del receptor.
 *
 * @param {object} receptor  { clienteTipo, nombre, razonSocial, rut } ya VALIDADO por
 *                           receptorCliente.receptorParaDocumento (RUT vacío si no cerró).
 * @param {object} [env]     process.env inyectable para poder probarlo.
 * @returns {object} {} si no hay nada que mandar (entonces el llamador no toca nada).
 */
export function camposContactoReceptor(receptor, env = process.env) {
  const r = (receptor && typeof receptor === 'object') ? receptor : {};
  const campos = {};

  // RAZÓN SOCIAL → company_name. Campo estándar, sin gate de edición. Máx 200 por la spec.
  const razon = String(r.razonSocial || '').trim().slice(0, 200);
  if (razon) campos.company_name = razon;

  // EMPRESA vs PERSONA NATURAL → customer_sub_type. Enum de la spec: individual | business.
  if (r.clienteTipo === 'empresa') campos.customer_sub_type = 'business';
  else if (r.clienteTipo === 'particular') campos.customer_sub_type = 'individual';

  // EL RUT. 🔴 Detrás de env var A PROPÓSITO: el nombre del campo personalizado NO se pudo
  // confirmar (depende del panel del dueño) y este proyecto prohíbe inventar nombres de campo
  // de una API ajena. Sin la variable, el RUT simplemente no viaja a Books — y no pasa nada,
  // porque el documento que hoy recibe el cliente es el PDF propio, que sí lo lleva.
  const rut = String(r.rut || '').trim();
  const label = String(env?.ZOHO_BOOKS_RUT_LABEL || '').trim();
  const fieldId = String(env?.ZOHO_BOOKS_RUT_FIELD_ID || '').trim();
  if (rut && (label || fieldId)) {
    // La spec acepta las dos formas; `customfield_id` es la robusta (sobrevive a que el dueño
    // renombre la etiqueta). Si están las dos, se mandan juntas: Zoho resuelve por id.
    const campo = {};
    if (fieldId) campo.customfield_id = fieldId;
    if (label) campo.label = label;
    campo.value = rut;
    campos.custom_fields = [campo];
  }

  return campos;
}

/**
 * ¿Hay que hacer el PUT? Solo si tenemos algo que agregar Y el contacto de Zoho no lo tiene
 * ya con ese mismo valor. Sin esto se dispararía un PUT por cada cotización de cada cliente
 * repetido, gastando cuota de API para reescribir lo mismo.
 *
 * @param {object} contacto  el contacto que devolvió Zoho
 * @param {object} campos    lo que devolvió camposContactoReceptor
 * @returns {boolean}
 */
export function necesitaActualizarContacto(contacto, campos) {
  if (!campos || !Object.keys(campos).length) return false;
  const c = (contacto && typeof contacto === 'object') ? contacto : {};
  if (campos.company_name && String(c.company_name || '').trim() !== campos.company_name) return true;
  if (campos.customer_sub_type && String(c.customer_sub_type || '').trim() !== campos.customer_sub_type) return true;
  if (campos.custom_fields) {
    const nuevo = campos.custom_fields[0];
    const yaEsta = (Array.isArray(c.custom_fields) ? c.custom_fields : []).some((f) => (
      String(f?.value || '').trim() === String(nuevo.value || '').trim()
      && (!nuevo.customfield_id || String(f?.customfield_id || '') === nuevo.customfield_id)
    ));
    if (!yaEsta) return true;
  }
  return false;
}

/** ¿El RUT llegará de verdad a Books, o falta que el dueño configure el campo? */
export function rutViajaAZohoBooks(env = process.env) {
  return Boolean(String(env?.ZOHO_BOOKS_RUT_LABEL || '').trim()
    || String(env?.ZOHO_BOOKS_RUT_FIELD_ID || '').trim());
}

export default {
  mismoTelefono,
  contactoEsElMismo,
  camposContactoReceptor,
  necesitaActualizarContacto,
  rutViajaAZohoBooks,
};
