// color.test.js — [2026-08-25]
//
// 🔴 EL COLOR NUNCA LLEGABA AL MOTOR, ASI QUE **TODAS** LAS COTIZACIONES SALIAN BLANCAS.
//
// Lo reporto el dueño —*"revisé las cotizaciones y todas las entregas blancas sin importar
// el color que quiera el cliente"*— y se confirmo contra la BD viva: `default_color` estaba
// null o vacio en las 10 sesiones de las ultimas 20 h. En su propia prueba escribio "nogal"
// explicito y llego vacio.
//
// TOCA PLATA: el perfil en color cuesta mas que el blanco. Cotizar blanco y entregar nogal
// significa recotizar (y quedar mal) o comerse la diferencia.
//
// LA CADENA, cuatro eslabones y basta uno para que se pierda:
//   1. `color` es opcional en el schema de la tool: el LLM puede omitirlo.
//   2. `state.default_color` se LEIA en cuatro lugares y no se ESCRIBIA en ninguno.
//   3. `default_color: items[0].color || state.default_color || ''` → cadena vacia.
//   4. `quoteDataComplete` —el gate que frena el PDF por datos incompletos— validaba
//      nombre, medidas y precio, pero NO el color.
//
// El motor recibia vacio y caia a su valor por defecto: blanco. En silencio, siempre.

import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteDataComplete } from './pdf-intent.js';
import { recordarColor } from './normalizers.js';
import { COLORES_PROPUESTA } from './propuestas-color.js';

/* =========================================================================
 * 🔴 [2026-08-31] LO QUE CAMBIO, Y POR QUE ESTE ARCHIVO SE REESCRIBIO A MEDIAS
 *
 * DECISION DEL DUEÑO, textual: *"cuando cliente no entrega color entreguemosle blanco, nogal
 * y negro"* + *"entregar 3 propuestas tecnica economicas una blanco, nogal y new black"*.
 *
 * Hasta el 30-ago este gate tenia DOS salidas cuando faltaba el color, y las dos costaban:
 *   · FRENAR el PDF (`missing:['color']`) hasta que el cliente contestara. El plazo de gracia
 *     es PASIVO —solo se re-evalua cuando el cliente vuelve a escribir— asi que el que
 *     pregunta, no contesta y se va NO RECIBE NADA. Y sin PDF no sale el evento de cotizacion:
 *     Google Ads deja de recibir la conversion (webhook.click-ids.test.js lo prueba).
 *   · Pasado el plazo, emitir UNA BLANCA (`colorAsumido`). Mejor que nada, pero es un color
 *     que el cliente no eligio y el foliado vale 69-88 % mas.
 * Ninguna de las dos hace falta con tres propuestas rotuladas: ni se inventa ni se frena.
 *
 * QUE SE CONSERVA INTACTO (y sigue probado mas abajo): que el Blanco que rellena el LLM NO
 * cuenta como eleccion del cliente. Eso NO se relajo — cambia lo que se HACE al detectarlo:
 * antes se frenaba, ahora salen las tres. La deteccion es la misma y sigue siendo el corazon
 * de todo esto.
 * ========================================================================= */

/** Atajo: ¿la respuesta del gate es "salen las tres"? */
function terna(r) {
  return Array.isArray(r.coloresPropuestos) ? r.coloresPropuestos : null;
}

const itemOk = (extra = {}) => ({
  product: 'Corredera S60', measures: '1500x1200mm', unit_price: 250000, qty: 1, ...extra,
});

/* =========================================================================
 * EL GATE AHORA EXIGE COLOR
 * ========================================================================= */

test('🔴 sin color en ninguna parte: NO se cotiza blanco en silencio — salen TRES', () => {
  // [2026-08-31] Antes esto era `ok:false` + `missing:['color']`. Lo que el test defiende
  // sigue siendo lo mismo —que un Blanco que nadie pidio no pase por bueno— y lo que cambio
  // es el desenlace: en vez de frenar la propuesta, se emiten las tres rotuladas.
  const r = quoteDataComplete({ name: 'Vanessa', items: [itemOk()] }, {});
  assert.equal(r.ok, true, 'ya no se frena al cliente por un dato que no dio');
  assert.ok(!r.missing.includes('color'), `el color no puede seguir bloqueando: ${r.missing.join(', ')}`);
  // [2026-08-31] El orden se compara contra la CONSTANTE, no escrito a mano: es lo mismo
  // que exige el test de abajo ("el ORDEN sale de la constante, no del gate"). Escrito a
  // mano quedaba congelado el orden viejo (Blanco primero) y el dueno lo cambio ese dia a
  // del mas caro al mas economico.
  assert.deepEqual(terna(r), COLORES_PROPUESTA,
    'y no se cotiza blanco en silencio: van las tres del dueño, en SU orden');
  assert.equal(r.colorAsumido, false, 'no se ASUME ningun color: se PROPONEN tres');
});

test('🔒 los tres colores y su ORDEN salen de la constante, no del gate', () => {
  // El orden es A/B/C y el dueño puede querer cambiarlo (ancla el precio). Si alguien
  // reordena la constante, el gate tiene que seguirla sin tocar este archivo.
  const r = quoteDataComplete({ name: 'V', items: [itemOk()] }, {});
  assert.deepEqual(terna(r), COLORES_PROPUESTA);
  assert.notEqual(terna(r), COLORES_PROPUESTA, 'y va una COPIA: nadie puede mutar la constante');
});

test('con el color en el item, pasa', () => {
  const r = quoteDataComplete({ name: 'Vanessa', items: [itemOk({ color: 'Nogal' })] }, {});
  assert.equal(r.ok, true, r.missing.join(', '));
});

test('🔴 con el color recordado de la conversacion, pasa', () => {
  // El cliente dice "nogal" una vez, al principio. No hay por que volver a preguntarle en
  // cada ventana: el color queda en la sesion.
  const r = quoteDataComplete({ name: 'Vanessa', items: [itemOk()] }, { default_color: 'Nogal' });
  assert.equal(r.ok, true, r.missing.join(', '));
});

test('🔴 si UN item quedo sin color, tampoco pasa (PEDIDO MIXTO: el cliente SI eligio)', () => {
  // Un proyecto mitad nogal y mitad "no sé" es justamente el caso donde hay que preguntar.
  // [2026-08-31] Y ES EL UNICO CASO DE COLOR QUE SIGUE BLOQUEANDO, a proposito: a quien ya
  // eligio Nogal no se le proponen tres colores — se le completa lo que falta. La terna es
  // para el que no eligio NADA.
  const r = quoteDataComplete({
    name: 'Vanessa', items: [itemOk({ color: 'Nogal' }), itemOk()],
  }, {});
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes('color'));
  assert.equal(terna(r), null, 'no se le proponen tres colores a quien ya eligio uno');
});

test('un color en blanco o de relleno NO cuenta como color informado', () => {
  for (const malo of ['', '  ', null, undefined]) {
    const r = quoteDataComplete({ name: 'V', items: [itemOk({ color: malo })] }, {});
    // [2026-08-31] Sigue sin contar como color informado — pero ahora eso significa "van las
    // tres", no "se frena". Lo que NO puede pasar nunca es que salga UNA sola en silencio.
    assert.deepEqual(terna(r), COLORES_PROPUESTA, `"${malo}" no es un color`);
  }
});

test('🔒 el gate sigue exigiendo lo de antes (no se relajo nada)', () => {
  const conColor = { color: 'Blanco' };
  assert.ok(quoteDataComplete({ items: [itemOk(conColor)] }, {}).missing.includes('name'));
  assert.ok(quoteDataComplete({ name: 'V', items: [] }, {}).missing.includes('items'));
  assert.ok(quoteDataComplete({ name: 'V', items: [itemOk({ ...conColor, unit_price: 0 })] }, {})
    .missing.some((m) => m.includes('unit_price')));
});

/* =========================================================================
 * EL COLOR SE RECUERDA EN LA CONVERSACION
 * ========================================================================= */

test('🔴 un color dicho en una cotizacion queda recordado para las siguientes', () => {
  // La raiz del defecto: `state.default_color` se leia en cuatro lugares y NADIE lo
  // escribia. El cliente lista sus ventanas en varios mensajes y el color lo dice una vez.
  const state = {};
  recordarColor(state, [{ color: 'Nogal' }, { color: '' }]);
  assert.equal(state.default_color, 'Nogal');
});

test('el color se normaliza al catalogo real', () => {
  // Los 5 del catalogo: Blanco · Nogal · Roble Dorado · Grafito Antracita · Negro.
  const state = {};
  recordarColor(state, [{ color: '  nogal  ' }]);
  assert.equal(state.default_color, 'Nogal', 'sin espacios y con la capitalizacion del catalogo');
});

test('🔒 un color nuevo REEMPLAZA al anterior: el cliente cambio de opinion', () => {
  const state = { default_color: 'Blanco' };
  recordarColor(state, [{ color: 'Negro' }]);
  assert.equal(state.default_color, 'Negro');
});

test('🔒 sin color, NO se pisa el que ya estaba recordado', () => {
  const state = { default_color: 'Nogal' };
  recordarColor(state, [{ color: '' }, {}]);
  assert.equal(state.default_color, 'Nogal', 'una cotizacion sin color no borra la memoria');
});

test('recordarColor no rompe con basura', () => {
  const state = {};
  for (const basura of [null, undefined, 'texto', 42, [{ color: null }]]) {
    assert.doesNotThrow(() => recordarColor(state, basura));
  }
  assert.equal(state.default_color, undefined, 'y no inventa un color');
});

/* =========================================================================
 * CUANDO FALTA EL COLOR, OLIVER PREGUNTA — Y PREGUNTA EL COLOR
 * ========================================================================= */

test('🔴 el mensaje del gate NOMBRA el color y ofrece los 5 del catalogo', async () => {
  // Con el gate exigiendo color aparece un riesgo nuevo: si Oliver no sabe QUE preguntar,
  // el cliente queda esperando una propuesta que nunca sale. El mensaje generico —"necesito
  // confirmar un detalle de las ventanas, ya te pregunto"— no le sirve a nadie: no dice que
  // falta y promete una pregunta que quizas no llega.
  const { readFile } = await import('node:fs/promises');
  const wh = await readFile(new URL('./webhook.js', import.meta.url), 'utf8');
  // Se corta por ESTRUCTURA (del gate hasta su `return`), no por el primer renglon vacio:
  // en cuanto alguien agrega un comentario con una linea en blanco, ese corte deja el
  // mensaje afuera y el test falla mirando codigo correcto. Ya paso cuatro veces hoy.
  // [2026-08-25] Ancla por PREFIJO: el gate recibio un tercer argumento (el texto del
  // cliente, para la apertura) y el ancla exacta con `);` dejo de existir ⇒ este test
  // fallaba mirando codigo correcto. Es la cuarta vez que un ancla literal hace eso.
  const i = wh.indexOf('const _gate = quoteDataComplete(input, state');
  assert.ok(i > 0, 'no se encontro el gate');
  const fin = wh.indexOf("reason: 'datos_incompletos'", i);
  assert.ok(fin > i, 'no se encontro el return del gate');
  const bloque = wh.slice(i, fin);

  // [2026-08-25] Se afirma que el color tiene SU PROPIA RAMA, sin fijar como se escribe la
  // condicion: cuando la cascada paso de `missing.includes('color')` a `_falta === 'color'`
  // (para no tener dos listas paralelas) este test fallaba mirando codigo correcto. La
  // intencion es que exista la rama y que su mensaje sea el del color, no su sintaxis.
  assert.match(bloque, /'color'/, 'el color tiene su propia rama en la cascada');
  for (const c of ['Blanco', 'Nogal', 'Roble Dorado', 'Grafito Antracita', 'Negro']) {
    assert.ok(bloque.includes(c), `el mensaje ofrece ${c}`);
  }
  // [2026-08-25] Se acota a LA RAMA DEL COLOR. Antes se cortaba desde `includes('color')`
  // hasta el final del bloque, asi que arrastraba el mensaje generico de la ultima rama —el
  // que SI dice "Ya te pregunto"— y bastaba que apareciera una rama nueva despues (la de la
  // apertura) para que el test fallara mirando codigo correcto. Lo que se quiere afirmar es
  // que el color no promete una pregunta, no que la palabra no exista en el archivo.
  // El corte termina donde EMPIEZA la rama siguiente (la apertura). Se ancla en 'tipo', que es
  // el nombre del dato y no cambia con la sintaxis de la condicion — ya paso dos veces que el
  // ancla fuera la forma del `if` y el test fallara mirando codigo correcto.
  const ramaColor = bloque.split("'color'").pop().split("'tipo'")[0];
  assert.doesNotMatch(ramaColor, /Ya te pregunto/,
    'nada de prometer una pregunta: se pregunta ahi mismo');
  assert.match(ramaColor, /En qué color las quiere/, 'y la rama recortada es de verdad la del color');
});

/* =========================================================================
 * SI EL CLIENTE NO CONTESTA EL COLOR, NO SE PIERDE LA VENTA
 * ========================================================================= */
// Instruccion del dueño: *"si cliente no dice el color, nosotros le decimos después de un
// minuto o algo así que le preparamos mientras una de color blanco"*.
//
// Equilibra las dos cosas que importan: NO cotizar blanco en silencio (el defecto que
// costaba plata) y NO dejar al cliente sin propuesta por esperar un dato. Se pregunta
// primero; si no contesta, sale la blanca CON el aviso de que es blanca y que se recotiza
// sin costo. Lo que nunca vuelve a pasar es que se entregue blanco sin decirlo.

test('🔴 la PRIMERA vez sin color: NO se frena la propuesta, salen las tres', () => {
  // [2026-08-31] Antes: `ok:false` + se preguntaba y se esperaba. El problema medido es que
  // ese plazo es PASIVO —solo corre si el cliente vuelve a escribir— asi que el que se va no
  // recibe nada, y Google Ads tampoco recibe la conversion. Con tres propuestas no hay motivo
  // para frenar: se le pregunta el color EN el mismo mensaje que lleva las tres.
  const r = quoteDataComplete({ name: 'V', items: [itemOk()] }, {});
  assert.equal(r.ok, true, 'el cliente que no contesta el color no puede quedarse sin propuesta');
  assert.ok(!r.missing.includes('color'));
  assert.deepEqual(terna(r), COLORES_PROPUESTA);
});

test('🔒 el reloj del color ya no cambia el resultado: con o sin plazo, salen las tres', () => {
  // Se prueban los dos extremos del plazo viejo. Antes uno daba `ok:false` (esperando) y el
  // otro `colorAsumido:true` (una blanca). Ahora los dos dan lo mismo, y eso ES el arreglo:
  // el desenlace deja de depender de un reloj que en produccion nunca se escribio
  // (medido 29-ago: `color_preguntado_at` en 0 de 852 sesiones).
  for (const hace of [5_000, 61_000]) {
    const r = quoteDataComplete({ name: 'V', items: [itemOk()] }, { color_preguntado_at: Date.now() - hace });
    assert.equal(r.ok, true, `con el reloj de hace ${hace} ms la propuesta tiene que salir`);
    assert.deepEqual(terna(r), COLORES_PROPUESTA);
    assert.equal(r.colorAsumido, false, 'ya no se ASUME una blanca: se proponen tres');
  }
});

test('🔒 si contesta el color, no se asume nada', () => {
  const state = { color_preguntado_at: Date.now() - 120_000, default_color: 'Nogal' };
  const r = quoteDataComplete({ name: 'V', items: [itemOk()] }, state);
  assert.equal(r.ok, true);
  assert.ok(!r.colorAsumido, 'dijo Nogal: no hay nada que asumir');
});

test('🔴 el aviso de "va en blanco" existe y ofrece recotizar', async () => {
  const { readFile } = await import('node:fs/promises');
  const wh = await readFile(new URL('./webhook.js', import.meta.url), 'utf8');
  assert.match(wh, /colorAsumido/, 'el webhook tiene que reaccionar al color asumido');
  const i = wh.indexOf('_gate.colorAsumido');
  assert.ok(i > 0, 'no se encontro el manejo del color asumido');
  const bloque = wh.slice(i, i + 700);
  assert.match(bloque, /[Bb]lanco/, 'le dice que va en blanco');
  assert.match(bloque, /recotiz|sin costo|cambio/i, 'y que se puede cambiar');

  // 🔴 Y EL AVISO TIENE QUE LLEGARLE AL CLIENTE. Se construia en una variable que nadie
  // usaba: el cliente recibia su propuesta en blanco sin enterarse, que es justo el defecto
  // que este arreglo vino a cerrar. Un mensaje que no se manda no existe.
  assert.match(wh, /\) \+ _avisoColor/, 'el aviso se concatena al mensaje de la propuesta');
});

/* =========================================================================
 * 🔴 [2026-08-29] EL BLANCO QUE NADIE PIDIO
 *
 * El gate de arriba caza el color VACIO. Este caza el otro caso, que es el que de verdad
 * pasa en produccion: el system-prompt le ORDENA al modelo rellenar "Blanco", asi que el
 * item llega CON color y el gate lo deja pasar. Medido: el gate del color se desplego el
 * 25-ago con tests verdes y fue codigo muerto cuatro dias — no disparo ni una vez en 852
 * sesiones. Se mide en lo que escribio el CLIENTE, no en lo que escribio el modelo.
 * ========================================================================= */

test('🔴 un Blanco que el cliente NUNCA nombro no pasa por bueno: salen las tres', () => {
  const r = quoteDataComplete(
    { name: 'Vanessa', items: [itemOk({ color: 'Blanco' })] },
    {},
    { textoCliente: 'hola, quiero cotizar una ventana corredera de 1500x1200' },
  );
  // [2026-08-31] LA DETECCION NO SE RELAJO — sigue siendo el corazon de todo esto. Lo que
  // cambio es que detectarlo ya no FRENA la propuesta: dispara las tres. Si algun dia esto
  // devuelve `coloresPropuestos: null`, volvimos a cotizar blanco en silencio.
  assert.deepEqual(terna(r), COLORES_PROPUESTA,
    'ese Blanco no lo eligio el cliente: no puede salir UNA blanca en silencio');
  assert.equal(r.ok, true, 'pero tampoco se le frena la propuesta');
});

test('🔒 si el cliente SI nombro el blanco, es su eleccion y sale UNA sola', () => {
  // El lado caro del error seria este al reves: mandarle tres a quien ya dijo cual quiere.
  const r = quoteDataComplete(
    { name: 'Vanessa', items: [itemOk({ color: 'Blanco' })] },
    {},
    { textoCliente: 'quiero una ventana corredera blanca de 1500x1200' },
  );
  assert.equal(terna(r), null, 'lo dijo el: no hay nada que proponerle');
  assert.equal(r.ok, true);
});

test('🔴 un Blanco HEREDADO del modelo tampoco cuenta como eleccion del cliente', () => {
  const r = quoteDataComplete(
    { name: 'Vanessa', items: [itemOk()] },
    { default_color: 'Blanco' },
    { textoCliente: 'necesito otra ventana de 1000x1000' },
  );
  assert.deepEqual(terna(r), COLORES_PROPUESTA,
    'un Blanco heredado del modelo no es una eleccion del cliente');
  // El color ya no bloquea. (Este pedido igual queda `ok:false`, pero por la APERTURA: el
  // texto no nombra ninguna — ese gate SI sigue bloqueando, y a proposito.)
  assert.ok(!r.missing.includes('color'), `el color no puede bloquear: ${r.missing.join(', ')}`);
  assert.ok(r.missing.includes('tipo'), 'y la apertura sigue preguntandose, intacta');
});

/* =========================================================================
 * 🎨 [2026-08-31] IG/FB TAMBIEN CAZA EL BLANCO QUE NADIE PIDIO — SIN RIESGO
 *
 * Hasta hoy los dos gates (color y apertura) compartian `textoCliente`, asi que IG/FB no podia
 * activar uno sin activar el otro — y activarle el de la APERTURA esta VETADO por la compuerta
 * cruzada (Codex, 2a pasada): ese gate SI bloquea y en IG/FB no hay rama de pregunta ni reloj,
 * o sea PDFs bloqueados con el mensaje generico y para siempre.
 *
 * Como el gate del color ya no bloquea nada, activarlo en IG/FB no puede costar un PDF. Por eso
 * se separo `textoColor`: es la unica forma de darle coherencia de COLOR a los dos canales sin
 * tocar el veto de la apertura.
 * ========================================================================= */

test('🔴 IG/FB: con `textoColor` caza el Blanco del modelo y propone las tres', () => {
  const r = quoteDataComplete(
    { name: 'Vanessa', items: [itemOk({ color: 'Blanco' })] },
    {},
    { textoColor: 'hola, quiero cotizar una ventana de 1500x1200' },
  );
  assert.deepEqual(terna(r), COLORES_PROPUESTA);
  assert.equal(r.ok, true);
});

test('🔒 …y `textoColor` NO despierta el gate de la APERTURA (el que si bloquea)', () => {
  // El texto no nombra ninguna apertura. Con `textoCliente` esto pediria 'tipo' y bloquearia;
  // con `textoColor` no, que es exactamente el veto que hay que respetar.
  const conColor = quoteDataComplete(
    { name: 'V', items: [itemOk({ color: 'Nogal' })] }, {}, { textoColor: 'quiero una ventana nogal' });
  assert.equal(conColor.ok, true, conColor.missing.join(', '));
  assert.ok(!conColor.missing.includes('tipo'), 'IG/FB no puede bloquear por la apertura');
  assert.equal(conColor.tipoAsumido, false, 'y tampoco puede ASUMIR corredera en silencio');

  // El mismo pedido por WhatsApp (con `textoCliente`) SI pregunta la apertura: el gate de la
  // apertura queda intacto donde siempre estuvo.
  const wa = quoteDataComplete(
    { name: 'V', items: [itemOk({ color: 'Nogal' })] }, {}, { textoCliente: 'quiero una ventana nogal' });
  assert.ok(wa.missing.includes('tipo'), 'en WhatsApp la apertura sigue preguntandose');
});
