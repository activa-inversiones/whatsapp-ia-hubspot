import test from 'node:test';
import assert from 'node:assert/strict';
import { nombreDelMensaje } from './normalizers.js';

/* =========================================================================
 * 🔴 TERCERA VEZ QUE EL DUEÑO RECLAMA LO MISMO (2026-09-19)
 * Textual: *"Oliver me volvió a pedir nombre, color, comuna cuando yo ya la había entregado"*.
 *
 * El color y la comuna se arreglaron antes. El NOMBRE no, y la causa es distinta:
 * `extractName()` (services/oliverName.js) DESCARTA el mensaje entero si contiene palabras de
 * pedido —'necesito', 'color', 'blanco', 'ventana'—. Esta hecha para contestar la pregunta
 * "¿cual es su nombre?", donde el mensaje trae SOLO el nombre. Pero el cliente de verdad dice
 * el nombre PEGADO al pedido, en el mismo mensaje:
 *
 *     "soy a nombre de MARIO GREY comuna de vilcul y color blanco necesito lo siguiente"
 *
 * MEDIDO: `extractName(...)` de ese texto devuelve null. Y `agent.js` ni siquiera la llamaba.
 * ========================================================================= */

test('🔴 el mensaje REAL del cliente entrega el nombre', () => {
  assert.equal(
    nombreDelMensaje('soy a nombre de MARIO GREY comuna de vilcul y color blanco necesito lo siguiente'),
    'Mario Grey',
  );
});

test('🔒 las formas en que un cliente se presenta, con el pedido pegado', () => {
  for (const [t, e] of [
    ['a nombre de Juan Pérez, necesito 3 ventanas', 'Juan Pérez'],
    ['mi nombre es Ana María Soto y quiero cotizar', 'Ana María Soto'],
    ['me llamo Pedro, vivo en Temuco', 'Pedro'],
    ['hola soy Carlos Muñoz necesito termopanel', 'Carlos Muñoz'],
    ['la factura va a nombre de Constructora Andes', 'Constructora Andes'],
  ]) assert.equal(nombreDelMensaje(t), e, t);
});

test('🔒 NO inventa un nombre donde no lo hay', () => {
  for (const t of [
    'necesito cotizar 3 ventanas',
    'hola',
    'buenos días',
    'quiero ventanas de pvc',
    'comuna de Temuco y color blanco',
    'soy de Temuco',            // "soy DE" es procedencia, no nombre
    '',
    null,
  ]) assert.equal(nombreDelMensaje(t), null, String(t));
});

test('🔒 no se queda con media frase de pedido', () => {
  // El corte tiene que caer ANTES de la comuna, el color y el pedido.
  const n = nombreDelMensaje('a nombre de MARIO GREY comuna de vilcul y color blanco');
  assert.equal(n, 'Mario Grey');
  assert.ok(!/vilcul|blanco|comuna|color/i.test(n || ''), 'no puede arrastrar el resto del mensaje');
});

/* =========================================================================
 * 🔗 LA CADENA COMPLETA: los TRES datos salen del primer mensaje del cliente.
 * Es exactamente lo que el dueño reclamo tres veces: *"me volvió a pedir nombre, color, comuna
 * cuando yo ya la había entregado"*.
 * ========================================================================= */

test('🔴 del PRIMER mensaje del cliente salen nombre, comuna y color, los tres', async () => {
  const { extractComuna, extraerColor } = await import('./normalizers.js');
  const real = 'soy a nombre de MARIO GREY comuna de vilcul y color blanco necesito lo siguiente';
  assert.equal(nombreDelMensaje(real), 'Mario Grey', 'el nombre');
  assert.equal(extractComuna(real), 'Vilcún', 'la comuna, aunque escriba "vilcuL"');
  assert.equal(extraerColor(real), 'BLANCO', 'y el color');
});

test('🔒 el nombre del cliente llega al contexto que lee Oliver, marcado como DEFINITIVO', async () => {
  const { buildSessionContext } = await import('./system-prompt.js');
  const ctx = buildSessionContext({
    nombre: 'Mario Grey', name: 'Mario Grey', comuna: 'Vilcún', color: 'BLANCO',
    lockedData: { nombre: 'Mario Grey', comuna: 'Vilcún', color: 'BLANCO' },
  });
  assert.match(ctx, /Nombre del cliente: Mario Grey/);
  assert.match(ctx, /Comuna: Vilcún/);
  assert.match(ctx, /NO volver a preguntar/);
  assert.match(ctx, /color=BLANCO/);
});

/* =========================================================================
 * 🔱 LOS ONCE QUE CAZO CODEX. Textual: *"intercambia repeticion molesta por corrupcion
 * silenciosa de identidad"*. Todos medidos: la primera version fallaba en los once.
 * ========================================================================= */

test('🔴 un OFICIO o un ROL no es el nombre del cliente', () => {
  // Un PDF formal emitido a nombre de "Arquitecto" es peor que volver a preguntar.
  for (const t of [
    'soy arquitecto', 'soy constructor', 'soy maestro', 'soy vecino', 'soy cliente nuevo',
    'soy el dueño de casa', 'soy la hermana de Juan',
  ]) assert.equal(nombreDelMensaje(t), null, t);
});

test('🔴 "habla con Marcelo" es pedir hablar con alguien, no presentarse', () => {
  assert.equal(nombreDelMensaje('habla con Marcelo'), null);
  assert.equal(nombreDelMensaje('quiero hablar con Marcelo'), null);
});

test('🔴 las formas que se PERDIAN y hacian que Oliver volviera a preguntar', () => {
  assert.equal(nombreDelMensaje('soy Juan Pérez, de Temuco'), 'Juan Pérez');
  assert.equal(nombreDelMensaje('mi nombre es: Juan Pérez'), 'Juan Pérez');
  assert.equal(nombreDelMensaje('a nombre de: Ana Soto'), 'Ana Soto');
  assert.equal(nombreDelMensaje('mi nombre es Juan\nnecesito ventanas'), 'Juan',
    'el cliente escribe en varias lineas');
});

test('🔴 una RAZON SOCIAL se conserva tal cual: es la que va en la factura', () => {
  // "SpA" no puede volverse "Spa", y "Constructora Andes" no puede descartarse por la palabra
  // "constructora" — lo que descarta es que TODAS las palabras sean genericas.
  assert.equal(nombreDelMensaje('a nombre de Constructora Andes SpA'), 'Constructora Andes SpA');
  assert.equal(nombreDelMensaje('la factura va a nombre de Constructora Andes'), 'Constructora Andes');
});

/* =========================================================================
 * 🔱 LO QUE CAZO GEMINI: nombres chilenos REALES, en un documento formal.
 * Textual: *"es impresentable emitir una propuesta tecnico-economica de $5.000.000 CLP
 * mutilando la razon social de la factura"*. Cinco de sus seis casos fallaban, medidos.
 * ========================================================================= */

test('🔴 los apellidos con particula NO se mutilan', () => {
  // "de", "del" y "y" cortaban a secas: el apellido quedaba a la mitad en el PDF.
  assert.equal(nombreDelMensaje('hola soy Juan de la Fuente'), 'Juan de la Fuente');
  assert.equal(nombreDelMensaje('soy Sofía del Campo'), 'Sofía del Campo');
  assert.equal(nombreDelMensaje('me llamo Pedro San Martín'), 'Pedro San Martín');
});

test('🔴 la RAZON SOCIAL completa: es la que va en la factura', () => {
  assert.equal(nombreDelMensaje('a nombre de Constructora Gómez y Compañía'), 'Constructora Gómez y Compañía');
  assert.equal(nombreDelMensaje('a nombre de Constructora Andes SpA'), 'Constructora Andes SpA');
});

test('🔴 un nombre CORTO no se escribe en minuscula', () => {
  // La regla vieja dejaba en minuscula todo lo de 2 letras o menos (para "de"/"la").
  assert.equal(nombreDelMensaje('soy Ed Wu'), 'Ed Wu');
  assert.equal(nombreDelMensaje('me llamo Max Fu'), 'Max Fu');
});

test('🔴 una INICIAL con punto no parte el nombre en dos', () => {
  // "me llamo Ma. Jose Catrileo" devolvia "ma".
  assert.equal(nombreDelMensaje('me llamo Ma. Jose Catrileo'), 'Ma. Jose Catrileo');
});

test('🔒 los apellidos mapuche salen enteros', () => {
  assert.equal(nombreDelMensaje('soy José Huenchullán'), 'José Huenchullán');
  assert.equal(nombreDelMensaje('a nombre de Ana Millapán'), 'Ana Millapán');
});

test('🔒 un apellido que tambien es un color del catalogo sigue siendo un apellido', () => {
  assert.equal(nombreDelMensaje('soy Claudio Blanco'), 'Claudio Blanco');
  assert.equal(nombreDelMensaje('me llamo Andrés Roble'), 'Andrés Roble');
});

test('🔒 pero "de" SI corta cuando lo que sigue es una comuna', () => {
  assert.equal(nombreDelMensaje('soy Juan de Temuco'), 'Juan');
  assert.equal(nombreDelMensaje('mi nombre es Ana María Soto y quiero cotizar'), 'Ana María Soto');
});
