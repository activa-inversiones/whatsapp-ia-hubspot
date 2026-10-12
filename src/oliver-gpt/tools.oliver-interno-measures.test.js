// [2026-10-12 · #1500-A] CONTRATO DE LA LÍNEA: lo que `calcular_cotizacion` devuelve y sales-os LEE.
//
// El Oliver interno (sales-os, services/oliverLector.js → detalleDesdeLineas) ya no lee el texto con su
// propio parser: le pide la lectura al bot y guarda en el borrador lo que el bot cotizó. Lee estas claves
// del resultado de la tool: unit_price (neto, > 0), total_neto, cantidad, producto_label, medidas_resueltas,
// glass_label, y las opcionales nota_linea / referencial / revision_ingenieria / pos. Si alguien renombra
// una de las obligatorias en tools.js, ESTE test se pone rojo acá (en el bot), y no en producción con un
// borrador de $0 [Thermos r3]. Hermético: `fetch` se reemplaza por un motor falso, como en los demás tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTool } from './tools.js';

// Las claves OBLIGATORIAS que lee `detalleDesdeLineas` (sales-os). Mantener en los dos repos.
export const CONTRATO_LINEA_OBLIGATORIO = Object.freeze(['unit_price', 'total_neto', 'cantidad', 'producto_label', 'medidas_resueltas', 'glass_label']);

test('[#1500-A] calcular_cotizacion devuelve TODAS las claves obligatorias del contrato de línea, con el precio > 0', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, opts) => {
    bodies.push({ url: String(url), body: JSON.parse(opts.body) });
    const payload = { ok: true, total_clp: 250000, producto_label: 'Fija S60', serie: 'S60',
      avisos: ['Esquinero sin precio en el espejo: el total NO incluye la unión'], aviso_fabricacion: 'hoja proyectante > 1200 mm: se cotiza igual, se avisa' };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  try {
    const r = await runTool('calcular_cotizacion', {
      tipo: 'FIJA', medidas_texto: '1200x1000', cantidad: 1, color: 'BLANCO', descripcion_producto: 'ventana fija',
    }, { textoCliente: 'ventana fija 1200x1000' });
    assert.equal(r.ok, true, JSON.stringify(r));
    const motor = bodies.find((b) => b.url.endsWith('/api/quotes/calculate'));
    assert.ok(motor, 'cotiza por /api/quotes/calculate');
    // MEDIDO al escribir este test (12-oct): el campo YA existía con el nombre `medidas_resueltas`
    // (es el que el LLM copia a `measures` del PDF). No se agrega otro: el canal interno lee ESTE.
    assert.match(String(r.medidas_resueltas || ''), /^1200x1000(mm)?$/, `medidas_resueltas debe venir en el resultado: ${JSON.stringify(r)}`);
    assert.equal(r.glass_label, 'Termopanel 4+12+4', 'el vidrio lo eligió el motor y viaja como etiqueta');
    for (const k of CONTRATO_LINEA_OBLIGATORIO) {
      assert.ok(r[k] !== undefined && r[k] !== null && r[k] !== '', `falta la clave obligatoria «${k}» en el resultado: ${JSON.stringify(r)}`);
    }
    assert.ok(Number(r.unit_price) > 0 && Number(r.total_neto) > 0 && Number(r.cantidad) >= 1, 'precio y cantidad positivos');
    // [r4 · Thermos DEFECTO 2] Lo que el motor AVISA (r.avisos → price_warning), lo que cobra de color y el aviso de
    // fabricación viajan en una bolsa NO enumerable: el LLM del WhatsApp no la ve (JSON.stringify la salta) y el
    // canal interno sí (services/oliverInternoLector.js la expone como `resultado.interno`).
    assert.ok(r._interno, 'existe la bolsa interna');
    assert.equal(Object.prototype.propertyIsEnumerable.call(r, '_interno'), false, 'no enumerable: el LLM no la ve');
    assert.equal(JSON.stringify(r).includes('_interno'), false);
    assert.deepEqual(r._interno.avisos, ['Esquinero sin precio en el espejo: el total NO incluye la unión']);
    assert.equal(r._interno.aviso_fabricacion, 'hoja proyectante > 1200 mm: se cotiza igual, se avisa');
    assert.equal(r._interno.color_cobrado, 'BLANCO');
    assert.equal(Number(motor.body.ancho_mm), 1200);
    assert.equal(Number(motor.body.alto_mm), 1000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
