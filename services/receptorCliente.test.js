// services/receptorCliente.test.js — RED de la CAPTURA del receptor (RUT + a nombre de quién).
//
// Este módulo decide qué número se imprime en un documento formal y qué se le manda a Zoho.
// La red cubre las dos direcciones, que pesan distinto:
//   · que NO deje pasar un RUT inválido  → un RUT malo en una cotización es un problema legal
//   · que NO lea un RUT donde no lo hay   → decirle "ese RUT no me cuadra" a quien habló de
//     plata es el error simétrico del que obligó a parchar stripMontos el 28-ago
//
// ⚠️ Los RUT de los tests son números de prueba calculados con el propio módulo 11 (rutChile.js),
// NO datos de clientes reales. La excepción es 76.486.825-0, el RUT PÚBLICO de Activa
// Inversiones EIRL que ya vive en el aviso legal del informe térmico.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extraerRutDeTexto, extraerReceptor, fusionarReceptor,
  limpiarNombreReceptor, clasificarTipoCliente,
  receptorParaDocumento, tieneRutValido,
} from './receptorCliente.js';
import { validarRut } from './rutChile.js';

/* ── Los RUT de prueba, calculados acá mismo para que nadie los tome por reales ── */
const RUT_EMPRESA = '77.448.504-K';   // DV K → cubre el caso resto=10
const RUT_PERSONA = '20.712.345-5';
const RUT_ANTIGUO = '4.998.123-6';    // 7 dígitos, como el que apareció en el corpus real
const RUT_ACTIVA = '76.486.825-0';    // público, emisor

test('los RUT de este archivo son válidos de verdad (si no, todo lo demás mide humo)', () => {
  for (const r of [RUT_EMPRESA, RUT_PERSONA, RUT_ANTIGUO, RUT_ACTIVA]) {
    assert.equal(validarRut(r).valido, true, `${r} debería ser válido`);
  }
});

/* ── CAPTURA: las 6 formas reales medidas en conversation_messages ────────── */

test('captura el RUT en las formas reales en que los clientes lo escribieron', () => {
  const casos = [
    [`Obras J&N  Rut ${RUT_EMPRESA}`, RUT_EMPRESA],
    [`a nombre de Maya Mapu Spa, rut ${RUT_EMPRESA.toLowerCase()}`, RUT_EMPRESA],
    ['Servicio agricola y construcción Rut 77448504-K', RUT_EMPRESA],
    [`A NOMBRE DE CLOVEL S. A...Rut ${RUT_ANTIGUO}`, RUT_ANTIGUO],
    [`Bayron R. V. Rut ${RUT_PERSONA} Melipeuco`, RUT_PERSONA],
    ['Laura C. A., rut. 8.412.345-5', '8.412.345-5'],
  ];
  for (const [texto, esperado] of casos) {
    const r = extraerRutDeTexto(texto);
    assert.ok(r && r.ok, `debería capturar el RUT en: ${texto}`);
    assert.equal(r.rut, esperado, 'y devolverlo ya formateado');
  }
});

test('captura el RUT sin puntos y sin guion cuando el cliente dice la palabra RUT', () => {
  assert.equal(extraerRutDeTexto('mi rut es 77448504K').rut, RUT_EMPRESA);
  assert.equal(extraerRutDeTexto('rut 207123455 gracias').rut, RUT_PERSONA);
});

test('captura el RUT solo, sin la palabra RUT, cuando el mensaje ES el número', () => {
  // El cliente contestando "¿me confirma su RUT?".
  const r = extraerRutDeTexto(RUT_PERSONA);
  assert.ok(r && r.ok);
  assert.equal(r.rut, RUT_PERSONA);
});

test('🔴 NO confunde un MONTO con un RUT — el error simétrico del fix del 28-ago', () => {
  const montos = [
    'quedamos en 1.200.000 - 3 cuotas',
    'el total fue 2.400.000 -10% de descuento',
    'me sale 1.850.000 - 2 pagos, ¿eso incluye la instalación o va aparte?',
    // Con la palabra RUT en la MISMA frase: el rótulo no alcanza si en medio hay plata.
    'mi rut se lo paso después, el total es 1.200.000 - 3 cuotas',
    'para el rut espere, el valor de 2.400.000 -10% ya está?',
  ];
  for (const t of montos) assert.equal(extraerRutDeTexto(t), null, `NO debe leer un RUT en: ${t}`);
});

test('🔴 NO lee un RUT en medidas, folios ni teléfonos', () => {
  assert.equal(extraerRutDeTexto('las ventanas son 1500x1200 y 2400-1200 mm'), null);
  assert.equal(extraerRutDeTexto('recibí la propuesta N° 0365-2, gracias, quedo atento'), null);
  assert.equal(extraerRutDeTexto('mi número es 56957296035 por si acaso, llámeme cuando pueda'), null);
});

test('sin mención de RUT devuelve null — no molesta a quien no lo pidió', () => {
  assert.equal(extraerRutDeTexto('quiero cotizar 3 ventanas de 1500x1200 en Temuco'), null);
  assert.equal(extraerRutDeTexto(''), null);
  assert.equal(extraerRutDeTexto(null), null);
  assert.equal(extraerRutDeTexto(undefined), null);
});

/* ── RECHAZO: el RUT malo se reporta, nunca se arregla ────────────────────── */

test('⛔ un RUT con el dígito verificador cambiado se RECHAZA y se conserva lo que escribió', () => {
  const r = extraerRutDeTexto('mi rut es 76.486.825-1');   // el DV correcto es 0
  assert.ok(r);
  assert.equal(r.ok, false, 'jamás debe darse por bueno');
  assert.equal(r.motivo, 'dv');
  assert.equal(r.crudo, '76.486.825-1', 'conserva el original para poder repreguntar');
});

test('⛔ un RUT con un dígito del CUERPO cambiado también se rechaza (el tipeo más común)', () => {
  assert.equal(extraerRutDeTexto('rut 76.486.826-0').ok, false);
  assert.equal(extraerRutDeTexto('rut 76.846.825-0').ok, false, 'dos dígitos transpuestos');
});

test('si el cliente escribe dos números, gana el que VALIDA', () => {
  const r = extraerRutDeTexto(`rut 76.486.825-1 perdón, el correcto es rut ${RUT_PERSONA}`);
  assert.ok(r && r.ok);
  assert.equal(r.rut, RUT_PERSONA);
});

/* ── LAS DOS FORMAS: empresa y persona natural ────────────────────────────── */

test('EMPRESA: razón social + RUT de la empresa (el caso normal cuando piden factura)', () => {
  const r = extraerReceptor(`por favor a nombre de Maya Mapu Spa, rut ${RUT_EMPRESA}`);
  assert.ok(r && r.ok);
  assert.equal(r.receptor.clienteTipo, 'empresa');
  assert.equal(r.receptor.razonSocial, 'Maya Mapu Spa');
  assert.equal(r.receptor.nombre, '', 'la persona del chat NO se mete como razón social');
  assert.equal(r.receptor.rut, RUT_EMPRESA);
  assert.equal(r.receptor.origen, 'cliente');
});

test('EMPRESA ANTIGUA: la forma societaria le gana a la banda numérica', () => {
  // CLOVEL S. A. con RUT de 7 dígitos: por número parecería persona; el "S. A." decide.
  const r = extraerReceptor(`A NOMBRE DE CLOVEL S. A...Rut ${RUT_ANTIGUO}`);
  assert.ok(r && r.ok);
  assert.equal(r.receptor.clienteTipo, 'empresa');
  // Se pierde el punto final: en "S. A...Rut" los tres puntos son a la vez el de la
  // abreviatura y unos suspensivos. Se recorta de menos a propósito — quitar un carácter que
  // el cliente escribió es seguro; AGREGAR uno que no escribió sería inventar.
  assert.equal(r.receptor.razonSocial, 'CLOVEL S. A');
});

test('PERSONA NATURAL: nombre + RUT de la persona', () => {
  const r = extraerReceptor(`a nombre de Bayron Reyes, rut ${RUT_PERSONA}`);
  assert.ok(r && r.ok);
  assert.equal(r.receptor.clienteTipo, 'particular');
  assert.equal(r.receptor.nombre, 'Bayron Reyes');
  assert.equal(r.receptor.razonSocial, '');
});

test('sin "a nombre de" captura el RUT y deja el nombre VACÍO — no lo inventa', () => {
  const r = extraerReceptor(`mi rut es ${RUT_PERSONA}`);
  assert.ok(r && r.ok);
  assert.equal(r.receptor.nombre, '', 'el nombre lo resuelve quien llama; acá no se sintetiza');
  assert.equal(r.receptor.rut, RUT_PERSONA);
});

test('un "a nombre de" que no trae un nombre no produce razón social basura', () => {
  const r = extraerReceptor(`a nombre de 12345, rut ${RUT_PERSONA}`);
  assert.ok(r && r.ok);
  assert.equal(r.receptor.nombre, '');
  assert.equal(r.receptor.razonSocial, '');
});

test('limpiarNombreReceptor recorta, nunca completa', () => {
  assert.equal(limpiarNombreReceptor('Maya Mapu Spa rut 77.448.504-K'), 'Maya Mapu Spa');
  assert.equal(limpiarNombreReceptor('Constructora del Sur, '), 'Constructora del Sur');
  assert.equal(limpiarNombreReceptor('  '), '');
  assert.equal(limpiarNombreReceptor('123456'), '', 'un número no es un nombre');
});

test('clasificarTipoCliente: forma societaria primero, banda numérica después', () => {
  assert.equal(clasificarTipoCliente('', RUT_EMPRESA), 'empresa', 'cuerpo ≥ 50 millones');
  assert.equal(clasificarTipoCliente('', RUT_PERSONA), 'particular');
  assert.equal(clasificarTipoCliente('Constructora del Sur', RUT_PERSONA), 'empresa');
  assert.equal(clasificarTipoCliente('Bayron Reyes', RUT_PERSONA), 'particular');
});

/* ── FUSIÓN ENTRE TURNOS ──────────────────────────────────────────────────── */

test('el cliente da la razón social en un mensaje y el RUT en otro: no se pierde nada', () => {
  const primero = extraerReceptor(`a nombre de Maya Mapu Spa, rut ${RUT_EMPRESA}`).receptor;
  // Segundo turno: corrige SOLO el RUT.
  const segundo = extraerReceptor(`perdón, el rut correcto es ${RUT_ACTIVA}`, { previo: primero });
  assert.ok(segundo && segundo.ok);
  assert.equal(segundo.receptor.rut, RUT_ACTIVA, 'el dato nuevo manda');
  assert.equal(segundo.receptor.razonSocial, 'Maya Mapu Spa', 'y el viejo sobrevive');
  assert.equal(segundo.receptor.clienteTipo, 'empresa');
});

test('una vez empresa, un turno posterior sin razón social no lo degrada a particular', () => {
  const previo = { clienteTipo: 'empresa', razonSocial: 'Obras J&N', rut: RUT_EMPRESA };
  const r = fusionarReceptor(previo, { clienteTipo: 'particular', rut: RUT_PERSONA });
  assert.equal(r.clienteTipo, 'empresa');
  assert.equal(r.razonSocial, 'Obras J&N');
  assert.equal(r.rut, RUT_PERSONA);
});

test('fusionarReceptor tolera basura sin lanzar', () => {
  assert.equal(fusionarReceptor(null, null).rut, '');
  assert.equal(fusionarReceptor(undefined, { rut: RUT_PERSONA }).rut, RUT_PERSONA);
});

/* ── ÚLTIMA PUERTA ANTES DEL PAPEL / DE ZOHO ──────────────────────────────── */

test('🔴 receptorParaDocumento RE-VALIDA: un RUT alucinado por el LLM no llega al documento', () => {
  // El DV correcto de 10.047.794 es 7 (caso Alfredo, pdf-intent.test.js:58). Con un 9 no cierra.
  const r = receptorParaDocumento({ clienteTipo: 'particular', nombre: 'Alfredo Arias', rut: '10.047.794-9' });
  assert.equal(r, null, 'sin razón social y con RUT inválido no hay nada que agregar');

  // Y si además viene una razón social, el bloque sale PERO SIN RUT — nunca con uno falso.
  const conEmpresa = receptorParaDocumento({ clienteTipo: 'empresa', razonSocial: 'Obras J&N', rut: '10.047.794-9' });
  assert.ok(conEmpresa);
  assert.equal(conEmpresa.rut, '', 'el RUT inválido se descarta, la razón social se conserva');
  assert.equal(conEmpresa.razonSocial, 'Obras J&N');
});

test('receptorParaDocumento entrega exactamente las opciones que esperan los informes', () => {
  const r = receptorParaDocumento(
    { clienteTipo: 'empresa', razonSocial: 'Maya Mapu Spa', rut: '77448504K' },
    { nombreFallback: 'Jorge Barriga' }
  );
  // [2026-08-30] `contacto` es nuevo y es a proposito: la persona del chat viaja en SU PROPIO
  // campo en vez de colarse como titular fiscal. Medido por el revisor: en 4 de 6 casos quien
  // escribe no es quien factura, y usarlo de relleno producia documentos con el nombre de una
  // persona y el RUT de otra.
  assert.deepEqual(Object.keys(r).sort(), ['clienteTipo', 'contacto', 'nombre', 'razonSocial', 'rut']);
  assert.equal(r.rut, RUT_EMPRESA, 'normaliza el formato aunque venga sin puntos');
  assert.equal(r.contacto, 'Jorge Barriga', 'la persona del chat queda de CONTACTO, no de titular');
  assert.equal(r.razonSocial, 'Maya Mapu Spa');
  assert.equal(r.clienteTipo, 'empresa');
});

test('receptorParaDocumento tolera basura sin lanzar', () => {
  assert.equal(receptorParaDocumento(null), null);
  assert.equal(receptorParaDocumento(undefined), null);
  assert.equal(receptorParaDocumento({}), null);
  assert.equal(receptorParaDocumento('20.712.345-5'), null, 'un string no es un receptor');
  assert.equal(receptorParaDocumento({ rut: 'no-es-un-rut' }), null);
});

test('tieneRutValido es un guard booleano estricto', () => {
  assert.equal(tieneRutValido({ rut: RUT_ACTIVA }), true);
  assert.equal(tieneRutValido({ rut: '76.486.825-1' }), false);
  assert.equal(tieneRutValido(null), false);
  assert.equal(tieneRutValido({}), false);
});

/* =========================================================================
 * [2026-08-30 · compuerta] PROCEDENCIA: el módulo 11 dice si un RUT está bien ESCRITO,
 * no si el cliente lo DIJO. El revisor demostró que con "hola, cotízame algo" llegaba al PDF
 * "Constructora Los Andes SpA / 77.448.504-K" — inventado por el LLM y formalmente válido.
 * ========================================================================= */
import { receptorParaDocumento as _rpd } from './receptorCliente.js';

test('RUT del LLM que el cliente NUNCA dijo: no llega al documento', () => {
  const r = _rpd(
    { rut: '77.448.504-K', razonSocial: 'Constructora Los Andes SpA', origen: 'llm' },
    { textoCliente: 'hola, cotízame algo para mi casa' });
  assert.equal(r, null, 'un receptor 100% inventado debe caerse entero');
});

test('RUT del LLM que el cliente SÍ dijo: pasa', () => {
  const r = _rpd(
    { rut: '20.708.686-K', origen: 'llm' },
    { textoCliente: 'Bayron Rivera Vasquez / Rut 20.708.686-K / Melipeuco' });
  assert.ok(r && r.rut, 'un RUT que el cliente escribió debe poder imprimirse');
});

test('razón social inventada se cae, aunque el RUT sea real del cliente', () => {
  const r = _rpd(
    { rut: '20.708.686-K', razonSocial: 'Inmobiliaria Fantasma SpA', origen: 'llm' },
    { textoCliente: 'mi rut es 20.708.686-K' });
  assert.ok(r, 'el RUT declarado sobrevive');
  assert.equal(r.razonSocial, '', 'la razón social que el cliente no dijo NO se imprime');
});

test('lo extraído del propio texto del cliente (origen cliente) no necesita re-verificación', () => {
  const r = _rpd({ rut: '20.708.686-K', origen: 'cliente' }, {});
  assert.ok(r && r.rut, 'el camino conservador sigue funcionando igual');
});

test('el nombre del perfil de WhatsApp NO se vuelve el titular fiscal junto a un RUT ajeno', () => {
  const r = _rpd({ rut: '20.708.686-K', origen: 'cliente' }, { nombreFallback: 'Rubí - Lar' });
  assert.equal(r.contacto, 'Rubí - Lar', 'el nombre del perfil viaja como CONTACTO');
});
