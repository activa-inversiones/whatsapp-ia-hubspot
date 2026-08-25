// tipo-apertura.test.js — [2026-08-25]
//
// 🔴 SI EL CLIENTE NO NOMBRABA LA APERTURA, SE LE COTIZABA CORREDERA EN SILENCIO.
//
// Reclamo del dueño, textual: *"si el cliente pide proyectante se le debe cotizar porque
// siempre está enviando imágenes que igual le cotizamos corredera"*.
//
// EL MECANISMO, medido: `enginePricer.js` terminaba en `return "CORREDERA"; // más común`.
// Cualquier texto que no nombrara una apertura caia ahi: "ventana" a secas, y tambien el
// "NO ESPECIFICADO" que la propia visión escribe cuando no ve el tipo en la foto. El
// cliente recibia el precio de una corredera sin que nadie se lo dijera.
//
// TOCA PLATA en las dos direcciones: una proyectante y una corredera de la misma medida no
// valen lo mismo, y la corredera suele ser la CARA. Cotizar la cara sin preguntar espanta
// ventas que se habrian cerrado con la otra.
//
// ⚠️ POR QUE SE MIRA EL TEXTO DEL CLIENTE Y NO EL ITEM: para cuando el item existe, la
// apertura ya se resolvio — `producto_label` dice "Corredera SLIDING H98" tanto si el
// cliente la pidio como si nadie la nombro jamas. Mirar ahi da siempre verde.
//
// El trato es el mismo que se aprobo para el color: se PREGUNTA una vez; si el cliente no
// contesta, sale la corredera CON el aviso de que es corredera y de que se recotiza sin
// costo. Nunca mas en silencio.

import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteDataComplete, datoQuePregunta } from './pdf-intent.js';
import { aperturaFueExplicita } from '../../services/enginePricer.js';

const itemOk = (extra = {}) => ({
  product: 'Corredera S60', measures: '1500x1200mm', unit_price: 250000, qty: 1,
  color: 'Blanco', ...extra,
});
const base = { name: 'Juan Carlos', items: [itemOk()] };

/* =========================================================================
 * SABER SI LA APERTURA LA ELIGIO EL CLIENTE
 * ========================================================================= */

test('🔴 reconoce las aperturas que el cliente nombra', () => {
  for (const t of ['quiero una proyectante', 'ventana fija de 1x1', 'que sea corredera',
                   'abatible por favor', 'oscilobatiente', 'proyectantes para el baño']) {
    assert.equal(aperturaFueExplicita(t), true, `deberia reconocer: ${t}`);
  }
});

test('🔴 NO inventa apertura cuando el cliente no la dijo', () => {
  for (const t of ['', 'hola buenas tardes consulta',
                   'una ventana de 2x2 cuál sería el valor',    // el caso real de Juan Carlos
                   'V1 | NO ESPECIFICADO | 2000x1450 | cant 1', // lo que devuelve la visión
                   'necesito 3 ventanas para la pieza']) {
    assert.equal(aperturaFueExplicita(t), false, `no deberia inventar apertura en: ${t}`);
  }
});

test('🔒 "que se abran" NO es una apertura — lo dijo el cliente real y no alcanza', () => {
  // Caso CM-FR-004-2026-0337 (24-ago): el cliente dijo "lo que salga más económico, que se
  // abran". Eso NO elige apertura: proyectante y corredera se abren las dos.
  assert.equal(aperturaFueExplicita('Lo k salga más económico k se abran sip'), false);
});

/* =========================================================================
 * EL GATE: SE PREGUNTA PRIMERO, SE ASUME DESPUES Y AVISANDO
 * ========================================================================= */

test('🔴 la PRIMERA vez sin apertura: se bloquea y se pregunta', () => {
  const r = quoteDataComplete(base, {}, { textoCliente: 'una ventana de 2x2, cuánto sale' });
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes('tipo'), 'el dato que falta es la apertura');
  assert.ok(!r.tipoAsumido, 'todavia no se asume nada: recien se pregunta');
});

test('🔴 si ya se pregunto y paso el minuto, sale la CORREDERA con aviso', () => {
  const state = { tipo_preguntado_at: Date.now() - 61_000 };
  const r = quoteDataComplete(base, state, { textoCliente: 'una ventana de 2x2' });
  assert.equal(r.ok, true, 'no se deja al cliente sin propuesta por un dato que no dio');
  assert.equal(r.tipoAsumido, true, 'pero queda marcado que la apertura se asumio');
});

test('🔒 antes del minuto NO se asume: se le da tiempo de contestar', () => {
  const state = { tipo_preguntado_at: Date.now() - 5_000 };
  const r = quoteDataComplete(base, state, { textoCliente: 'una ventana de 2x2' });
  assert.equal(r.ok, false, 'cinco segundos no es "no contesto"');
});

test('🔒 si el cliente SI dijo la apertura, no se pregunta ni se asume nada', () => {
  const r = quoteDataComplete(base, {}, { textoCliente: 'quiero 3 proyectantes de 1500x1000' });
  assert.equal(r.ok, true);
  assert.ok(!r.missing.includes('tipo'));
  assert.ok(!r.tipoAsumido, 'la dijo el: no hay nada que asumir');
});

test('🔒 sin texto del cliente (IG/FB, que todavia no lo pasa) se comporta como antes', () => {
  // Un llamador que no manda `textoCliente` NO puede quedar bloqueando PDFs por un dato
  // que nunca recibio. Degradar a lo de antes es preferible a romperle el canal.
  const r = quoteDataComplete(base, {});
  assert.equal(r.ok, true);
  assert.ok(!r.missing.includes('tipo'));
});

/* =========================================================================
 * QUE LA PREGUNTA Y EL AVISO EXISTAN DE VERDAD — Y SE MANDEN
 * ========================================================================= */

test('🔴 el mensaje del gate NOMBRA las cuatro aperturas', async () => {
  const { readFile } = await import('node:fs/promises');
  const wh = await readFile(new URL('./webhook.js', import.meta.url), 'utf8');
  const i = wh.indexOf('const _gate = quoteDataComplete(input, state');
  assert.ok(i > 0, 'no se encontro el gate');
  const fin = wh.indexOf("reason: 'datos_incompletos'", i);
  assert.ok(fin > i, 'no se encontro el return del gate');
  const bloque = wh.slice(i, fin);

  assert.match(bloque, /missing\.includes\('tipo'\)/, 'la apertura tiene su propio mensaje');
  for (const a of ['orredera', 'royectante', 'ija', 'batible']) {
    assert.ok(bloque.includes(a), `el mensaje ofrece ${a}`);
  }
});

test('🔴 se pregunta UN dato por vez, y el orden es nombre > color > apertura', () => {
  // 🔴 [2026-08-25 · compuerta cruzada] Antes esto se decidia en DOS lugares —el mensaje por
  // un lado, los relojes del plazo por otro— y se marcaban color y apertura a la vez aunque
  // se preguntaba uno solo. El reloj del dato NO preguntado vencia igual y se asumia
  // CORREDERA sin habersela preguntado nunca: el defecto que este gate vino a cerrar,
  // entrando por la puerta de atras. Ahora hay UNA respuesta y esta acá.
  assert.equal(datoQuePregunta(['name', 'color', 'tipo']), 'name');
  assert.equal(datoQuePregunta(['color', 'tipo']), 'color', 'con los dos, se pregunta el color');
  assert.equal(datoQuePregunta(['tipo']), 'tipo');
  assert.equal(datoQuePregunta([]), null, 'no falta nada: no se pregunta nada');
  assert.equal(datoQuePregunta(), null, 'sin lista tampoco inventa una pregunta');
});

test('🔴 NUNCA se asume un dato que no se pregunto', () => {
  // El invariante que faltaba: si en este turno se pregunta el COLOR, el reloj de la apertura
  // no puede arrancar — porque al cliente nadie le pregunto todavia por la apertura.
  const falta = ['color', 'tipo'];
  assert.notEqual(datoQuePregunta(falta), 'tipo',
    'con color y apertura faltando, la apertura NO es lo que se pregunta ⇒ su reloj no arranca');
});

test('🔴 una foto ILEGIBLE no es "dijo corredera": se pregunta igual', () => {
  // ⚠️ "no lo pasa" y "lo pasa vacio" no son lo mismo. Una cotizacion pedida con una sola foto
  // que la vision no pudo leer llegaba con el texto vacio, el gate se apagaba y salia corredera
  // sin preguntar ni avisar — el reclamo del dueño intacto, por otro camino.
  const r = quoteDataComplete(base, {}, { textoCliente: '' });
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes('tipo'), 'texto vacio = no nombro la apertura');
});

test('🔴 el aviso de "va corredera" existe, ofrece recotizar Y SE MANDA', async () => {
  // El defecto que cazo el test del color: `_avisoColor` se construia y no se usaba, o sea
  // el defecto original intacto debajo de su arreglo. Un mensaje que no se manda no existe.
  const { readFile } = await import('node:fs/promises');
  const wh = await readFile(new URL('./webhook.js', import.meta.url), 'utf8');
  const i = wh.indexOf('_gate.tipoAsumido');
  assert.ok(i > 0, 'el webhook tiene que reaccionar a la apertura asumida');
  const bloque = wh.slice(i, i + 700);
  assert.match(bloque, /corredera/i, 'le dice que va corredera');
  assert.match(bloque, /recotiz|sin costo/i, 'y que se puede cambiar');
  assert.match(wh, /\+ _avisoTipo,/, 'el aviso se concatena al mensaje de la propuesta');
});
