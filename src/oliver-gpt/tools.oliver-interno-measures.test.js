// [2026-10-12 · #1500-A] El resultado de `calcular_cotizacion` lleva las MEDIDAS que cotizó el motor.
//
// Por qué: el Oliver interno (sales-os) ya no lee el texto con su propio parser; le pide la lectura
// al bot y guarda en el borrador lo que el bot cotizó. El resultado de la tool traía precio, label,
// vidrio y serie, pero no las medidas normalizadas (`it.measures`, las que de verdad fueron al
// motor: con unidad resuelta y, si hizo falta, alto×ancho dadas vuelta). Sin ese campo, el borrador
// tenía que inventarlas desde `medidas_texto` del LLM, que es lo que el vendedor ESCRIBIÓ y no lo
// que se COTIZÓ. Hermético: `fetch` se reemplaza por un motor falso, como en los demás tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTool } from './tools.js';

test('[#1500-A] calcular_cotizacion devuelve `measures` = las medidas que fueron al motor', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, opts) => {
    bodies.push({ url: String(url), body: JSON.parse(opts.body) });
    const payload = { ok: true, total_clp: 250000, producto_label: 'Fija S60', serie: 'S60' };
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
    assert.equal(Number(motor.body.ancho_mm), 1200);
    assert.equal(Number(motor.body.alto_mm), 1000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
