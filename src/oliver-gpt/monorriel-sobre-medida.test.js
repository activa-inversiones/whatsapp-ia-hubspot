// 🔴 GUARDIA DE UNA DECISION DEL DUEÑO (2026-10-08). Textual: *"cuando cliente cotice monorriel
// entregue la cotización independiente del tamaño, la idea es explicarle después a cliente, pero
// que diga sutilmente que debe ser revisada con área de ingeniería de la empresa pero las cotice
// todas"*. Caso que la origino: CM-FR-004-2026-0611, 4 monorrieles fuera del PDF.
// Lo que NO puede volver: (1) que el monorriel grande se escale en vez de cotizarse; (2) que el
// prompt vuelva a decir que el monorriel lo cotiza Marcelo; (3) que se le oculte al cliente.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runTool } from './tools.js';
import { buildSystemBlocks } from './system-prompt.js';

function conMotorStub(fn) {
  const orig = globalThis.fetch;
  const enviados = [];
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('/quotes/calculate')) {
      const body = JSON.parse(opts.body || '{}');
      enviados.push(body);
      const data = { ok: true, grand_total: 900000, total_clp: 900000, unit_price: 900000,
        producto_label: `Corredera ${body.serie} ${body.riel || ''}`, materiales: { subtotal: 700000 } };
      return { ok: true, status: 200, async json() { return data; }, async text() { return JSON.stringify(data); } };
    }
    return { ok: false, status: 404, async json() { return {}; }, async text() { return '{}'; } };
  };
  return Promise.resolve(fn(enviados)).finally(() => { globalThis.fetch = orig; });
}

const cotizar = (medidas) => runTool('calcular_cotizacion', {
  tipo: 'CORREDERA', medidas_texto: medidas, cantidad: 3, color: 'nogal', comuna: 'Villarrica',
  descripcion_producto: 'Una fija y una corredera (monorriel)',
}, { textoCliente: `V1 3 ${medidas} Una fija y una corredera (monorriel)` });

test('🔴 el monorriel MAS GRANDE que lo estandar se cotiza (V1 real: 2540x2370) y se avisa sutil', async () => {
  await conMotorStub(async (enviados) => {
    const r = await cotizar('2540x2370');
    assert.equal(r.ok, true, 'se cotiza, no se escala: ' + JSON.stringify(r).slice(0, 300));
    assert.ok(r.unit_price > 0);
    assert.equal(enviados.at(-1)?.riel, 'MONORRIEL', 'se cotiza lo que pidio el cliente');
    assert.match(r.nota_linea || '', /ingenier[ií]a/i, 'la frase de ingenieria viaja al LLM');
    assert.doesNotMatch(r.nota_linea || '', /andes|monorriel|economic/i);
    assert.match(r._decir_al_cliente || '', /ingenier/i, 'y se le pide decirla');
    assert.doesNotMatch(r._nota_referencial || '', /NO se lo menciones/i,
      'la instruccion de referencial no puede ordenar ocultarselo al cliente');
  });
});

test('🔒 el de medida normal se cotiza sin aviso de ingenieria', async () => {
  await conMotorStub(async () => {
    const r = await cotizar('2000x2100');
    assert.equal(r.ok, true);
    assert.doesNotMatch(r.nota_linea || '', /ingenier/i);
  });
});

test('🔴 el prompt no vuelve a decir que el monorriel lo cotiza Marcelo', () => {
  const txt = String(buildSystemBlocks()).replace(/\s+/g, ' ');
  assert.doesNotMatch(txt, /ANDES, que cotiza Marcelo/i);
  assert.doesNotMatch(txt, /monorriel \(Marcelo\)/i);
  assert.match(txt, /MONORRIEL SE COTIZA SIEMPRE/);
});
