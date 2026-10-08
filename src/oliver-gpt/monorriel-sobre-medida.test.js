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
import { fraseRevisionIngenieria, itemsFromQuoteCalls } from './pdf-intent.js';

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
    assert.ok(enviados.some((e) => e.riel === 'MONORRIEL' && e.alto_mm === 2370), 'se cotiza lo que pidio el cliente');

    assert.match(r.nota_linea || '', /ingenier[ií]a/i, 'la frase de ingenieria viaja al LLM');
    assert.doesNotMatch(r.nota_linea || '', /andes|monorriel|economic/i);
    assert.match(r._decir_al_cliente || '', /ingenier/i, 'y se le pide decirla');
    // referencial=true es lo que dispara el aviso interno "REVISION DE INGENIERIA" a Marcelo
    // (webhook, al emitir el PDF). Sin esto la ventana se cotiza pero nadie de adentro se entera.
    assert.equal(r.referencial, true, 'Marcelo tiene que quedar avisado por dentro');
    assert.equal(r.revision_ingenieria, true, 'la marca viaja al pending_quote y al mensaje del PDF');
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

test('🔴 aunque el cliente diga "linea ANDES", el monorriel se cotiza (Codex, tridente 08-oct)', async () => {
  await conMotorStub(async (enviados) => {
    const r = await runTool('calcular_cotizacion', {
      tipo: 'CORREDERA', medidas_texto: '4000x2400', cantidad: 1, comuna: 'Temuco',
      descripcion_producto: 'línea ANDES monorriel, una corredera y un paño fijo',
    }, { textoCliente: 'línea ANDES monorriel, una corredera y un paño fijo 4000x2400' });
    assert.equal(r.ok, true, 'antes: producto_fuera_de_alcance:linea_no_soportada, cero llamadas al motor');
    const mono = enviados.find((e) => e.riel === 'MONORRIEL');
    assert.equal(mono?.serie, 'ANDES');
  });
});

test('🔒 pero Zenia sigue fuera de alcance (la excepcion es SOLO del monorriel ANDES)', async () => {
  await conMotorStub(async (enviados) => {
    const r = await runTool('calcular_cotizacion', {
      tipo: 'CORREDERA', medidas_texto: '1500x1200', cantidad: 1, comuna: 'Temuco',
      descripcion_producto: 'línea Zenia, una corredera y un paño fijo',
    }, {});
    assert.notEqual(r.ok, true);
    assert.equal(enviados.length, 0);
  });
});

test('🔴 la frase al cliente la pone el SISTEMA al entregar el PDF, no depende del LLM', async () => {
  await conMotorStub(async () => {
    const r = await cotizar('2540x2370');
    const items = itemsFromQuoteCalls([{ name: 'calcular_cotizacion', input: {}, result: r }]);
    assert.equal(items[0].revision_ingenieria, true, 'sobrevive al pending_quote');
    assert.match(fraseRevisionIngenieria(items), /ingenier[ií]a/i);
    assert.doesNotMatch(fraseRevisionIngenieria(items), /andes|monorriel|economic/i);
    assert.equal(fraseRevisionIngenieria([{ revision_ingenieria: false }]), '');
  });
});

test('🔒 Zenia por el campo ESTRUCTURADO serie tampoco se cuela como ANDES monorriel (Codex r2)', async () => {
  const { priceAllEngine } = await import('../../services/enginePricer.js');
  await conMotorStub(async (enviados) => {
    for (const serie of ['ZENIA', 'VENAU']) {
      const items = [{ measures: '1500x1200mm', product: 'CORREDERA', serie, descripcion: 'una corredera y un paño fijo', qty: 1 }];
      await priceAllEngine({ comuna: 'Temuco', items });
      assert.ok(!(Number(items[0].unit_price) > 0), `${serie} no se cotiza`);
    }
    assert.equal(enviados.length, 0);
  });
});

test('🔴 por AREA tambien: "linea ANDES monorriel" se cotiza y Zenia no (Codex r3)', async () => {
  await conMotorStub(async (enviados) => {
    const r = await runTool('calcular_por_area', { tipo: 'CORREDERA', area_m2: 6, cantidad: 1, comuna: 'Temuco',
      descripcion_producto: 'línea ANDES monorriel, una corredera y un paño fijo' }, {});
    assert.notEqual(r.reason, 'producto_fuera_de_alcance:linea_no_soportada', JSON.stringify(r).slice(0, 300));
    const z = await runTool('calcular_por_area', { tipo: 'CORREDERA', area_m2: 2, cantidad: 1, comuna: 'Temuco',
      descripcion_producto: 'línea Zenia, una corredera y un paño fijo' }, {});
    assert.notEqual(z.ok, true, 'Zenia sigue fuera');
    assert.ok(enviados.every((e) => e.serie !== 'ZENIA'));
  });
});

test('🔴 alternativa C (dueño 08-oct): corredera doble riel de 2100 + fijo arriba, solo si se pasa de ALTO', async () => {
  const { cotizarAlternativaC } = await import('../../services/enginePricer.js');
  await conMotorStub(async (enviados) => {
    const alt = await cotizarAlternativaC({ ancho_mm: 2540, alto_mm: 2370, qty: 3, color: 'nogal', comuna: 'Villarrica' });
    assert.deepEqual(alt.piezas.map((x) => x.measures), ['2540x2100', '2540x270']);
    assert.match(alt.nota, /visita t[eé]cnica/);
    // la pieza corredera NUNCA vuelve a monorriel (SIN_MONORRIEL privado del pricer)
    assert.deepEqual(enviados.map((e) => `${e.tipo}/${e.riel || '-'}/${e.hojas || '-'}`), ['CORREDERA/DOBLE/2', 'FIJA/-/-']);
    assert.equal(alt.piezas[1].referencial, true, 'el fijo de 2540x270 esta fuera del S60: aviso a Marcelo');
    assert.equal(await cotizarAlternativaC({ ancho_mm: 3200, alto_mm: 2000 }), null, 'ancho de mas no se arregla bajando la hoja');
  });
});

test('🔴 un monorriel MUY alto (1500x5000) nunca se cotiza con una medida y se rotula con otra (Codex)', async () => {
  const { cotizarAlternativaC } = await import('../../services/enginePricer.js');
  await conMotorStub(async (enviados) => {
    const alt = await cotizarAlternativaC({ ancho_mm: 1500, alto_mm: 5000 });
    for (const e of enviados) assert.equal(e.ancho_mm, 1500, `se le pregunto al motor ${e.ancho_mm}x${e.alto_mm}`);
    if (alt) assert.deepEqual(alt.piezas.map((x) => x.measures), ['1500x2100', '1500x2900']);
  });
});
