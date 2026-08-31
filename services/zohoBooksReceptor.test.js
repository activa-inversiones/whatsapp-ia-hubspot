// services/zohoBooksReceptor.test.js — [2026-08-30]
//
// Lo que se le manda a Zoho Books con el RUT del cliente, y sobre QUÉ contacto se escribe.
// Los dos riesgos que cubre esta red son de plata y de papeles, no de estilo:
//   1. Meter el RUT en un campo equivocado de Zoho (tax_id) rompería la cotización.
//   2. Escribir el RUT sobre el contacto EQUIVOCADO haría facturar mal a otra persona.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mismoTelefono, contactoEsElMismo, camposContactoReceptor,
  necesitaActualizarContacto, rutViajaAZohoBooks,
} from './zohoBooksReceptor.js';

const RECEPTOR_EMPRESA = {
  clienteTipo: 'empresa', razonSocial: 'Maya Mapu Spa', nombre: 'Jorge Barriga', rut: '77.448.504-K',
};
const RECEPTOR_PERSONA = {
  clienteTipo: 'particular', razonSocial: '', nombre: 'Bayron Reyes', rut: '20.712.345-5',
};

/* ── Campos confirmados de la API ─────────────────────────────────────────── */

test('EMPRESA: la razón social va a company_name y el tipo a customer_sub_type=business', () => {
  const c = camposContactoReceptor(RECEPTOR_EMPRESA, {});
  assert.equal(c.company_name, 'Maya Mapu Spa');
  assert.equal(c.customer_sub_type, 'business');
});

test('PERSONA NATURAL: customer_sub_type=individual y sin company_name inventado', () => {
  const c = camposContactoReceptor(RECEPTOR_PERSONA, {});
  assert.equal(c.customer_sub_type, 'individual');
  assert.equal('company_name' in c, false, 'una persona natural NO tiene razón social');
});

test('⛔ NUNCA se manda tax_id: en Zoho ese campo es el id de una TASA de impuesto', () => {
  // Ponerle el RUT ahí es el error clásico y rompería la cotización — este repo ya usa
  // ZOHO.TAX_ID con su semántica real (tax_id de línea, index.js).
  for (const env of [{}, { ZOHO_BOOKS_RUT_LABEL: 'RUT' }, { ZOHO_BOOKS_RUT_FIELD_ID: '99' }]) {
    const c = camposContactoReceptor(RECEPTOR_EMPRESA, env);
    assert.equal('tax_id' in c, false);
    assert.equal('tax_reg_no' in c, false, 'gateado a gcc/mx/ke/za, no aplica a Chile');
    assert.equal('legal_name' in c, false, 'es un campo de México');
  }
});

/* ── El campo NO confirmado va detrás de env var ──────────────────────────── */

test('🔴 SIN la variable del dueño, el RUT NO viaja: no se inventa un nombre de campo', () => {
  const c = camposContactoReceptor(RECEPTOR_EMPRESA, {});
  assert.equal('custom_fields' in c, false);
  assert.equal(rutViajaAZohoBooks({}), false, 'y el sistema lo puede REPORTAR como pendiente');
  // Lo confirmado sí viaja igual: no se bloquea todo por lo que falta.
  assert.equal(c.company_name, 'Maya Mapu Spa');
});

test('CON el label que configure el dueño, el RUT viaja como custom_field', () => {
  const c = camposContactoReceptor(RECEPTOR_EMPRESA, { ZOHO_BOOKS_RUT_LABEL: 'RUT' });
  assert.deepEqual(c.custom_fields, [{ label: 'RUT', value: '77.448.504-K' }]);
  assert.equal(rutViajaAZohoBooks({ ZOHO_BOOKS_RUT_LABEL: 'RUT' }), true);
});

test('con el ID del campo (más robusto: sobrevive a que renombre la etiqueta)', () => {
  const c = camposContactoReceptor(RECEPTOR_EMPRESA, { ZOHO_BOOKS_RUT_FIELD_ID: '8137430000000123' });
  assert.deepEqual(c.custom_fields, [{ customfield_id: '8137430000000123', value: '77.448.504-K' }]);
});

test('sin RUT válido no se manda custom_field aunque la variable esté puesta', () => {
  // `receptorParaDocumento` deja rut:'' cuando no pasa módulo 11: acá se comprueba que ese
  // vacío NO se convierta en un custom field con valor en blanco.
  const c = camposContactoReceptor({ clienteTipo: 'particular', rut: '' }, { ZOHO_BOOKS_RUT_LABEL: 'RUT' });
  assert.equal('custom_fields' in c, false);
});

test('camposContactoReceptor tolera basura y devuelve {} (el llamador no toca nada)', () => {
  assert.deepEqual(camposContactoReceptor(null, {}), {});
  assert.deepEqual(camposContactoReceptor(undefined, {}), {});
  assert.deepEqual(camposContactoReceptor({}, {}), {});
  assert.deepEqual(camposContactoReceptor('texto', {}), {});
});

/* ── 🔴 Identidad antes de escribir — el riesgo legal ──────────────────────── */

test('confirma identidad por teléfono aunque venga con o sin el 56 del país', () => {
  assert.equal(mismoTelefono('56952077379', '952077379'), true);
  assert.equal(mismoTelefono('+56 9 5207 7379', '56952077379'), true);
  assert.equal(mismoTelefono('56952077379', '56957296035'), false);
  assert.equal(mismoTelefono('', '56952077379'), false, 'sin dato no se afirma identidad');
  assert.equal(mismoTelefono('123', '123'), false, 'demasiado corto para afirmar nada');
});

test('🔴 NO escribe sobre un contacto que no se pudo confirmar', () => {
  // Zoho busca por `phone` con semántica "contiene" y el código se queda con contacts[0]:
  // perfectamente puede devolver a OTRO cliente. Escribirle un RUT ajeno es el problema
  // legal que la regla anti-alucinación busca evitar, y encima silencioso.
  const otro = { contact_id: '1', contact_name: 'Otra Persona', phone: '56911112222' };
  assert.equal(contactoEsElMismo(otro, { phone: '56952077379', contactName: 'Alfredo Arias' }), false);
  assert.equal(contactoEsElMismo(null, { phone: '56952077379' }), false);
  assert.equal(contactoEsElMismo({}, { phone: '56952077379' }), false);
  assert.equal(contactoEsElMismo({ contact_name: '' }, { contactName: '' }), false,
    'dos vacíos NO son una coincidencia');
});

test('confirma identidad por teléfono de la persona de contacto, o por nombre exacto', () => {
  const porContactPerson = { contact_id: '2', contact_name: 'X', contact_persons: [{ phone: '952077379' }] };
  assert.equal(contactoEsElMismo(porContactPerson, { phone: '56952077379' }), true);
  const porNombre = { contact_id: '3', contact_name: 'Alfredo Arias Luengo', phone: '' };
  assert.equal(contactoEsElMismo(porNombre, { phone: '56999999999', contactName: 'alfredo arias luengo' }), true);
});

/* ── No gastar API reescribiendo lo mismo ─────────────────────────────────── */

test('actualiza solo cuando de verdad falta algo', () => {
  const campos = camposContactoReceptor(RECEPTOR_EMPRESA, { ZOHO_BOOKS_RUT_LABEL: 'RUT' });
  const sinNada = { contact_id: '1', company_name: '', custom_fields: [] };
  assert.equal(necesitaActualizarContacto(sinNada, campos), true, 'contacto viejo creado sin RUT');

  const yaCompleto = {
    contact_id: '1',
    company_name: 'Maya Mapu Spa',
    customer_sub_type: 'business',
    custom_fields: [{ label: 'RUT', value: '77.448.504-K' }],
  };
  assert.equal(necesitaActualizarContacto(yaCompleto, campos), false, 'nada que escribir → no se gasta un PUT');
});

test('sin campos que mandar nunca se dispara un PUT', () => {
  assert.equal(necesitaActualizarContacto({ contact_id: '1' }, {}), false);
  assert.equal(necesitaActualizarContacto({ contact_id: '1' }, null), false);
  assert.equal(necesitaActualizarContacto(null, { company_name: 'X' }), true, 'sin contacto previo, hay que escribir');
});
