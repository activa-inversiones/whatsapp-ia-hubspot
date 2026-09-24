// FORMA ESQUINA / BOW WINDOW — leer la notacion del dueño sin perder nada.
//
// 🔴 POR QUE EXISTE (2026-09-24, instruccion del dueño, textual):
//   *"cuando te pidan una ventana bow window 200x150x40, la primera medida es fija, la segunda
//    es la altura y la tercera es los laterales"* y despues, con el caso real:
//   *"2000X1500X400 LO QUE QUIERE DECIR 2000MM DE ANCHO CENTRAL 1500 EL ALTO Y LOS LATERALES
//    DE 400X1500 ... Y EL POSTE DE UNION ES 90 GRADOS"*.
//
// 🔴 EL DEFECTO QUE VIENE A CERRAR, MEDIDO ANTES DE ESCRIBIR NADA: hoy `medidas()` lee
// "2000x1500x400" y devuelve {ancho:2000, alto:1500}. **El tercer numero se descarta EN
// SILENCIO**: los laterales desaparecen y se cotiza otra ventana, sin aviso y sin error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { leerMedidaTriple, esBowPorForma } from './formaEsquina.js';

test('lee la notacion del dueño: central x alto x lateral', () => {
  assert.deepEqual(leerMedidaTriple('2000x1500x400'),
    { central_mm: 2000, alto_mm: 1500, lateral_mm: 400 });
  // Como lo escribe un humano: con espacios, con la equis de multiplicar, en mayuscula.
  assert.deepEqual(leerMedidaTriple('2000 X 1500 X 400'),
    { central_mm: 2000, alto_mm: 1500, lateral_mm: 400 });
  assert.deepEqual(leerMedidaTriple('2000 × 1500 × 400'),
    { central_mm: 2000, alto_mm: 1500, lateral_mm: 400 });
});

test('🔴 acepta los CENTIMETROS, que es como el dueño la escribio la primera vez', () => {
  // *"bow windows 200x150x40"*. Sin esto saldria una ventana de 200 mm — un vidrio de 20 cm.
  // El criterio es el MISMO que ya usa `medidas()` para dos numeros: bajo cierto umbral no
  // son milimetros. Aca el umbral es 6 metros expresado en cm, o sea 600.
  assert.deepEqual(leerMedidaTriple('200x150x40'),
    { central_mm: 2000, alto_mm: 1500, lateral_mm: 400 });
});

test('🔴 NO inventa una tercera medida donde no la hay', () => {
  // Una ventana normal tiene DOS medidas y tiene que seguir siendo una ventana normal.
  assert.equal(leerMedidaTriple('2000x1500'), null);
  assert.equal(leerMedidaTriple('1420x900'), null);
  assert.equal(leerMedidaTriple(''), null);
  assert.equal(leerMedidaTriple(null), null);
  // Y una medida imposible NO se corrige: se devuelve null y el humano decide.
  assert.equal(leerMedidaTriple('2000x1500x0'), null);
  assert.equal(leerMedidaTriple('0x1500x400'), null);
});

test('reconoce la bow window por su nombre, en el idioma del cliente', () => {
  for (const t of ['bow window', 'BOW WINDOW', 'bowindow', 'ventana en esquina',
    'ventana esquinera', 'ventana en L', 'ventanal en esquina']) {
    assert.equal(esBowPorForma(t), true, t);
  }
});

test('🔴 y NO la confunde con lo que solo menciona una esquina', () => {
  // "va en la esquina del living" es UBICACION, no tipologia. Es el mismo error que la
  // "cocina americana" que ya mordio una vez a este repo: una palabra que en Chile sirve
  // para dos cosas distintas.
  for (const t of ['corredera para la esquina del living', 'la ventana de la esquina de la casa',
    'proyectante esquina nororiente', 'fija 1000x1000']) {
    assert.equal(esBowPorForma(t), false, t);
  }
});
