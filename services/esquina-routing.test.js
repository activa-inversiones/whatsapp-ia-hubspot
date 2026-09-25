// ENRUTAMIENTO DE LA VENTANA EN ESQUINA / BOW WINDOW (#884).
//
// 🔴 EL DEFECTO QUE CIERRA, medido en produccion el 24-sep sobre un pedido REAL del dueño:
// Oliver recibio una bow window y la partio en ITEMS SUELTOS (un fijo de 2000x1500 + dos
// compuestos de 400x1500), **sin los postes de esquina**, que son un producto que se compra y
// se instala. Tres ventanas que no se unen en angulo.
// Y si el cliente usaba la notacion del dueño —"2000x1500x400"— era peor: `medidas()` leia
// {2000, 1500} y **el tercer numero se descartaba EN SILENCIO**.
import test from 'node:test';
import assert from 'node:assert/strict';
import { priceAllEngine } from './enginePricer.js';

function conMotorStub(fn) {
  const orig = globalThis.fetch;
  const enviados = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/quotes/calculate')) {
      const body = JSON.parse(opts.body || '{}');
      enviados.push(body);
      // ⚠️ `text()` NO es decorativo: el cliente del motor lee el cuerpo con res.text() y
      // despues lo parsea. Sin esto el doble tira "res.text is not a function", la llamada
      // se cuenta igual en `enviados` (por eso los tests que solo miran el payload pasaban)
      // pero el item vuelve SIN PRECIO. Un doble incompleto deja pasar medio camino.
      const _cuerpo = JSON.stringify({ ok: true, grand_total: 700000, total_clp: 594397,
        unit_price: 594397, producto_label: 'Ventana en esquina (3 paños, union 90°)',
        materiales: { subtotal: 527184 } });
      return { ok: true, status: 200, headers: { get: () => 'application/json' },
        async text() { return _cuerpo; }, async json() { return JSON.parse(_cuerpo); } };
    }
    return { ok: false, status: 404, async json() { return {}; } };
  };
  return Promise.resolve(fn(enviados)).finally(() => { globalThis.fetch = orig; });
}

test('🔴 #884 la notacion 2000x1500x400 se cotiza como UNA ventana en esquina', async () => {
  await conMotorStub(async (enviados) => {
    const items = [{ measures: '2000x1500x400', product: 'VENTANA',
      descripcion: 'bow window, laterales mitad fijo mitad proyectante', qty: 1 }];
    await priceAllEngine({ comuna: 'Temuco', items });

    assert.equal(enviados.length, 1, 'UNA sola llamada: es una ventana, no tres');
    const b = enviados[0];
    assert.equal(b.tipo, 'ESQUINA');
    assert.equal(b.alto_mm, 1500);
    assert.equal(b.angulo, 90, 'el poste que describio el dueño');
    assert.equal(b.partes.length, 3);
    // 🔴 EL TERCER NUMERO NO SE PIERDE: es todo el punto de este ticket.
    assert.deepEqual(b.partes.map((p) => p.ancho_mm), [400, 2000, 400]);
    assert.equal(b.partes[1].tipo, 'FIJA', 'el central');
    // Laterales mitad y mitad, porque el cliente lo dijo.
    assert.equal(b.partes[0].tipo, 'COMPUESTA');
    assert.deepEqual(b.partes[0].partes.map((p) => p.tipo), ['PROYECTANTE', 'FIJA']);
    assert.equal(b.partes[0].partes.reduce((s, p) => s + p.alto_mm, 0), 1500,
      'las dos mitades tienen que sumar el alto, sin perder un milimetro por el redondeo');
    // Y al cliente se le dice QUE se le cotizo, para que pueda corregirlo.
    assert.match(items[0].nota_linea || '', /esquina/i);
  });
});

test('🔴 #884 en centimetros tambien, que es como el dueño la escribio primero', async () => {
  await conMotorStub(async (enviados) => {
    await priceAllEngine({ comuna: 'Temuco', items: [
      { measures: '200x150x40', product: 'VENTANA', descripcion: 'bow window', qty: 1 }] });
    assert.deepEqual(enviados[0].partes.map((p) => p.ancho_mm), [400, 2000, 400]);
    assert.equal(enviados[0].alto_mm, 1500);
  });
});

test('🔴 #884 sin decir la apertura NO se inventa: laterales fijos, y se le avisa', async () => {
  // Regla anti-alucinacion del cotizador: lo que el cliente no dijo no se rellena en silencio.
  // Se cotiza lo conservador y la nota le pide que confirme, en vez de suponerle una apertura.
  await conMotorStub(async (enviados) => {
    const items = [{ measures: '2000x1500x400', product: 'VENTANA', descripcion: 'bow window', qty: 1 }];
    await priceAllEngine({ comuna: 'Temuco', items });
    assert.equal(enviados[0].partes[0].tipo, 'FIJA');
    assert.match(items[0].nota_linea || '', /laterales fijos/i);
    assert.match(items[0].nota_linea || '', /se abran/i, 'y se le ofrece cambiarlo');
  });
});

test('🔴 #884 nombra la bow window pero no da las tres medidas -> ESCALA, no adivina', async () => {
  // El ancho de cada paño lo define donde cae el muro. El motor se niega a suponerlo
  // (`partes_invalidas`) y aca se escala pidiendo exactamente lo que falta.
  await conMotorStub(async (enviados) => {
    const items = [{ measures: '2800x1500', product: 'VENTANA', descripcion: 'quiero una bow window', qty: 1 }];
    await priceAllEngine({ comuna: 'Temuco', items });
    assert.equal(enviados.length, 0, 'no se llama al motor con un reparto inventado');
    assert.ok(items[0].fuera_de_alcance, 'se escala a Marcelo');
    assert.match(items[0].price_warning || '', /2000x1500x400|lateral/i, 'y se pide lo que falta');
  });
});

test('🔒 #884 una ventana NORMAL no se toca', async () => {
  await conMotorStub(async (enviados) => {
    await priceAllEngine({ comuna: 'Temuco', items: [
      { measures: '1420x900', product: 'CORREDERA', descripcion: 'corredera 2 hojas', qty: 1 }] });
    assert.notEqual(enviados[0].tipo, 'ESQUINA');
    assert.equal(enviados[0].ancho_mm, 1420);
  });
});

test('🔒 #884 "la ventana de la esquina del living" es UBICACION, no tipologia', async () => {
  // Mismo caso que la *cocina* americana, que ya mordio a este repo: una palabra que en Chile
  // sirve para dos cosas. Si esto se rompe, una corredera comun sale cotizada como esquina.
  await conMotorStub(async (enviados) => {
    await priceAllEngine({ comuna: 'Temuco', items: [
      { measures: '1420x900', product: 'CORREDERA', descripcion: 'la ventana de la esquina del living', qty: 1 }] });
    assert.notEqual(enviados[0].tipo, 'ESQUINA');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// #884 r3 — LA PRUEBA QUE FALTÓ LAS DOS PRIMERAS VECES: DESDE LA TOOL REAL
// ══════════════════════════════════════════════════════════════════════════════════════════
// 🔴 POR QUÉ EXISTE, y es una lección de método que costó dos intentos en PRODUCCIÓN:
// Los tests de arriba pasaban y Oliver seguía sin cotizar la bow window (24-sep, 20:38 y
// 20:54). El motivo: esos tests le pasan al pricer un item YA ARMADO con las tres medidas.
// En producción ese item no existía — la tool construye `measures` con el ancho y alto YA
// RESUELTOS (`${ancho}x${alto}mm`), o sea SIEMPRE un par, y el tercer número moría ahí.
//
// ⚠️ UN TEST QUE CONSTRUYE SU PROPIA ENTRADA NO PRUEBA QUE LA ENTRADA EXISTA.
// Este entra por `runTool`, que es por donde entra Oliver de verdad.
test('🔴 #884 r3 · desde la TOOL: medidas_texto "2000x1500x400" llega al motor como ESQUINA', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    await runTool('calcular_cotizacion', {
      tipo: 'FIJA',
      medidas_texto: '2000x1500x400',
      descripcion_producto: 'bow window, laterales mitad superior proyectante mitad inferior marco fijo',
      color: 'BLANCO', comuna: 'Temuco', cantidad: 1,
    }, {});
    assert.equal(enviados.length, 1, 'UNA llamada al motor: es una ventana, no tres');
    const b = enviados[0];
    assert.equal(b.tipo, 'ESQUINA', 'la tool tiene que terminar pidiendo una ESQUINA');
    // 🔴 EL TERCER NÚMERO SOBREVIVE EL VIAJE ENTERO. Es todo el punto.
    assert.deepEqual(b.partes.map((p) => p.ancho_mm), [400, 2000, 400]);
    assert.equal(b.alto_mm, 1500);
    assert.equal(b.angulo, 90);
    // Y la apertura sale de lo que dijo el cliente, no de un default.
    assert.equal(b.partes[0].tipo, 'COMPUESTA');
  });
});

test('🔒 #884 r3 · una ventana NORMAL por la misma tool no se convierte en esquina', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    await runTool('calcular_cotizacion', {
      tipo: 'CORREDERA', medidas_texto: '1420x900',
      descripcion_producto: 'corredera de 2 hojas',
      color: 'BLANCO', comuna: 'Temuco', cantidad: 1,
    }, {});
    assert.equal(enviados[0].tipo, 'CORREDERA');
    assert.equal(enviados[0].ancho_mm, 1420);
  });
});

test('🔴 #887 la medida que ve el cliente es la de SU ventana, no la del paño central', async () => {
  // Reclamo del dueño sobre la propuesta 0541: la descripción decía "2000x1500 mm" —el paño
  // CENTRAL— cuando la ventana mide 2800x1500. El cliente compara ese número contra su muro,
  // así que mostrarle el central es mostrarle otra ventana.
  // El total es la SUMA DIRECTA (regla del dueño, 11-sep): 400 + 2000 + 400 = 2800.
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    const r = await runTool('calcular_cotizacion', {
      tipo: 'FIJA', medidas_texto: '2000x1500x400',
      descripcion_producto: 'bow window, laterales mitad superior proyectante mitad inferior fija',
      color: 'BLANCO', comuna: 'Temuco', cantidad: 1,
    }, {});
    // `medidas_resueltas` es lo que el prompt le manda copiar al PDF como `measures`.
    assert.match(String(r.medidas_resueltas || ''), /^2800x1500/,
      `el cliente tiene que leer 2800x1500, no el paño central; salió "${r.medidas_resueltas}"`);
    // Y el MOTOR sigue recibiendo los paños por `partes`: la medida que se muestra no mueve
    // ni un peso del precio.
    assert.deepEqual(enviados[0].partes.map((p) => p.ancho_mm), [400, 2000, 400]);
  });
});
