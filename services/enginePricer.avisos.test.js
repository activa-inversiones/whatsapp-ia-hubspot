// services/enginePricer.avisos.test.js
//
// 🔴 LO QUE EL MOTOR AVISA, EL CLIENTE LO TIENE QUE LEER.
//
// El motor de precio devuelve `avisos` cuando cambia o estira lo que le pidieron: una hoja que
// no existe en ese color, una medida bajo el minimo del perfil. El bot NUNCA leyo ese campo —
// solo llenaba `price_warning` cuando la cotizacion FALLABA. Asi que un aviso sobre una
// cotizacion EXITOSA se perdia entero, y al cliente le llegaba el precio limpio.
//
// Importa desde el 19-sep, que el dueño ordeno cotizar TODA medida ("coticemoslas todas sean
// grandes o pequeñas; despues, cuando hablemos con el cliente, recien vemos esto"). Sin este
// puente, una ventana imposible cotiza con un numero de aspecto normal y sin una palabra de
// advertencia. MEDIDO en el motor con precios uniformes:
//   1 mm de ancho        -> $258.766
//   4 hojas en 600 mm    -> $468.831  (MAS CARA que una normal de 1600x1200, $355.727)
// Lo levanto Gemini en la compuerta cruzada: *"el aviso se va a perder silenciosamente en el
// bot... el cliente recibira la cotizacion limpia, como si fuera firme y aprobada"*.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('./enginePricer.js', import.meta.url), 'utf8');

test('🔴 los avisos del motor se copian a price_warning, que es lo que el bot muestra', () => {
  // El puente va en la rama de EXITO. Si estuviera en la de error no serviria de nada: el caso
  // que importa es justamente el de una cotizacion que SALE BIEN pero con una advertencia.
  const i = SRC.indexOf('item.confidence = "high";');
  assert.ok(i > 0, 'no se encontro la rama de cotizacion exitosa');
  const bloque = SRC.slice(i, i + 1400);
  assert.match(bloque, /Array\.isArray\(r\.avisos\)/,
    'la rama de exito tiene que mirar r.avisos del motor');
  assert.match(bloque, /item\.price_warning = r\.avisos\.join/,
    'el aviso tiene que ir a price_warning: es el unico campo que el bot le muestra al cliente');
});

test('🔒 el puente no pisa un price_warning que ya existia', () => {
  // Los warnings previos (medidas ambiguas, fuera de alcance) se escriben ANTES y hacen
  // `return`: nunca llegan a esta rama. El puente solo escribe si el motor mando avisos.
  const i = SRC.indexOf('Array.isArray(r.avisos)');
  const bloque = SRC.slice(i, i + 220);
  assert.match(bloque, /r\.avisos\.length/,
    'sin este chequeo, un array vacio pisaria el warning con una cadena vacia');
});

// El contrato del otro lado: el bot arma el texto del cliente desde price_warning.
test('🔴 el bot efectivamente muestra price_warning al cliente', () => {
  const idx = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const usos = [...idx.matchAll(/priceInfo = it\.price_warning/g)];
  assert.ok(usos.length >= 1,
    'si el bot deja de leer price_warning, este puente se vuelve decorativo y hay que rehacerlo');
});
