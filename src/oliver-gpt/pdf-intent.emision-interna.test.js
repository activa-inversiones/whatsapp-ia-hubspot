// [2026-10-12 · #1500-C] EL GATE DE DATOS NO LE PREGUNTA NADA A UNA EMISIÓN INTERNA.
//
// `quoteDataComplete` mide contra el TEXTO DEL CLIENTE si nombró la apertura y el color (si no, pregunta antes del
// PDF). En una emisión interna el «texto del cliente» es una marca sintética y los ítems vienen YA decididos por el
// vendedor (líneas cotizadas por Oliver en la agenda): el gate pedía la apertura («¿Qué tipo de apertura
// necesita?») y la propuesta no salía (medido en webhook.emision-interna.test.js). Con `input.emision_interna`
// los gates de color y apertura se apagan; los de items/precio/nombre siguen iguales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteDataComplete } from './pdf-intent.js';

const MARCA = '⟦emisión interna desde la agenda⟧';
const ITEMS = [{ producto_label: 'Bow window · 3 paños', measures: '3500x1500', color: 'NOGAL', qty: 1, unit_price: 792902 }];

test('[#1500-C] sin la bandera, la marca sintética hace preguntar la apertura (comportamiento de WhatsApp)', () => {
  const g = quoteDataComplete({ name: 'Claudio', comuna: 'Angol', items: ITEMS }, {}, { textoCliente: MARCA, comuna: 'Angol' });
  assert.equal(g.ok, false);
  assert.ok(g.missing.includes('tipo'), JSON.stringify(g));
});

test('[#1500-C] con input.emision_interna = true no se pregunta ni color ni apertura: el gate pasa', () => {
  const g = quoteDataComplete({ name: 'Claudio', comuna: 'Angol', items: ITEMS, emision_interna: true }, {}, { textoCliente: MARCA, comuna: 'Angol' });
  assert.equal(g.ok, true, JSON.stringify(g));
});

test('[#1500-C r3 · Thermos D-N1] el nombre que puso el VENDEDOR no es «asumido»: no hay aviso «no tengo su nombre» ni pendiente de reemisión', () => {
  const g = quoteDataComplete({ name: 'Claudio Soto', comuna: 'Angol', items: ITEMS, emision_interna: true }, {}, { textoCliente: MARCA, comuna: 'Angol' });
  assert.equal(g.nombre, 'Claudio Soto');
  assert.equal(g.nombreAsumido, false, JSON.stringify(g));
  assert.equal(g.nombreOrigen, 'vendedor');
  // Sin la bandera, el mismo nombre que no aparece en el chat sigue siendo «asumido» (comportamiento de WhatsApp).
  const w = quoteDataComplete({ name: 'Claudio Soto', comuna: 'Angol', items: ITEMS }, {}, { textoCliente: 'hola, quiero una ventana fija', comuna: 'Angol' });
  assert.equal(w.nombreAsumido, true);
});

test('[#1500-C] la bandera NO apaga lo que sí importa: sin precio o sin nombre sigue bloqueando', () => {
  const sinPrecio = quoteDataComplete({ name: 'Claudio', comuna: 'Angol', items: [{ ...ITEMS[0], unit_price: 0 }], emision_interna: true }, {}, { textoCliente: MARCA, comuna: 'Angol' });
  assert.equal(sinPrecio.ok, false);
  assert.ok(sinPrecio.missing.some((m) => /unit_price/.test(m)));
});
