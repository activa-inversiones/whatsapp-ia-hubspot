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

test('🔴 #888 las OPCIONES POR COLOR se re-cotizan: tres colores, tres precios', async () => {
  // Reclamo del dueño sobre la propuesta 0542: las tres (Blanco, Nogal, New Black) salieron
  // con el MISMO precio, $503.585. El motor SÍ cobra distinto por color — verificado en vivo:
  //   Blanco $705.287 · Nogal $811.516 · New Black $872.204 c/IVA.
  // La causa era MI PROPIO GUARDIA: la sonda que re-cotiza cada color arma sus items SIN
  // `medidas_texto` (solo `measures`, ya resuelto a un par), así que los tres caían en la
  // escalada de "faltan las tres medidas" y ninguno se re-cotizaba.
  // Ahora la esquina se recupera del propio item o de la etiqueta, que es lo único que
  // sobrevive. El dueño lo dijo más simple: "solo son materiales distintos, no medidas".
  const lbl = 'Bow window · Ventana en esquina (3 paños, union 90°): '
    + 'Compuesto 400mm (Proyectante 750mm (arriba) + Fijo 750mm (abajo)) + Fijo 2000mm + '
    + 'Compuesto 400mm (Proyectante 750mm (arriba) + Fijo 750mm (abajo))';
  const vistos = [];
  for (const color of ['BLANCO', 'NOGAL', 'NEWBLACK']) {
    await conMotorStub(async (enviados) => {
      // EXACTAMENTE la forma que arma la sonda de color: sin medidas_texto.
      const items = [{ product: lbl, measures: '2800x1500mm', color, qty: 1 }];
      await priceAllEngine({ comuna: 'Temuco', items });
      assert.equal(enviados.length, 1, `${color}: tiene que LLAMAR al motor, no escalar`);
      assert.equal(enviados[0].tipo, 'ESQUINA', `${color}: y pedir una esquina`);
      assert.deepEqual(enviados[0].partes.map((p) => p.ancho_mm), [400, 2000, 400]);
      assert.equal(enviados[0].color, color, 'con SU color: es lo único que cambia');
      assert.ok(!items[0].fuera_de_alcance, `${color}: no se escala`);
      // 🔴 Y sin el aviso de tamaño: 2800 es la SUMA de tres paños, no el ancho de uno.
      assert.doesNotMatch(String(items[0].price_warning || ''), /excede l[ií]mite/i);
      vistos.push(color);
    });
  }
  assert.deepEqual(vistos, ['BLANCO', 'NOGAL', 'NEWBLACK']);
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// #947 (26-sep) — LA BOW WINDOW DE 4 PAÑOS DEL DUEÑO: PAÑO POR PAÑO, DESDE LA TOOL REAL
// ══════════════════════════════════════════════════════════════════════════════════════════
// 🔴 MEDIDO EN PRODUCCION (26-sep 10:58-11:01, sesion 56957296035): el dueño pidio
//   "bow windows 4 lados: fija 330x1540, fija 1830x1540, fija 1830x1540, mitad superior
//    proyectante y mitad inferior fija 325x1540 ... angulo en las esquinas 90 grados".
// Oliver la entendio (repitio los 4 paños bien) y NO tenia por donde mandarla: la unica via
// era la notacion de tres medidas, que arma [lateral, central, lateral]. La forzo a eso —
// pending_quote: "Compuesto 325 + Fijo 1830 + Compuesto 325", 2480x1540, $562.564— que es
// OTRA ventana, y al no calzar escalo a Marcelo sin cotizar (10 llamadas al motor en 3 turnos).
const PEDIDO_DUENO = {
  tipo: 'FIJA',
  medidas_texto: 'fija 330x1540 fija 1830x1540 fija 1830x1540 mitad superior proyectante y mitad inferior fija 325x1540',
  descripcion_producto: 'bow windws 4 lados bow windows fija fija fija mitad superior proyectante y mitad inferior fija',
  panos_esquina: [
    { tipo: 'FIJA', ancho_mm: 330 },
    { tipo: 'FIJA', ancho_mm: 1830 },
    { tipo: 'FIJA', ancho_mm: 1830 },
    { tipo: 'COMPUESTA', ancho_mm: 325, arriba: 'PROYECTANTE', abajo: 'FIJA' },
  ],
  angulo_esquina: 90,
  alto_mm: 1540,
  color: 'Blanco', comuna: 'Pucón', cantidad: 1,
};

test('🔴 #947 · desde la TOOL: la bow window de 4 paños llega al motor ENTERA, en orden y de una sola vez', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    const r = await runTool('calcular_cotizacion', PEDIDO_DUENO, {});
    assert.equal(enviados.length, 1, 'UNA llamada: es una ventana, no cuatro ni dos modulos');
    const b = enviados[0];
    assert.equal(b.tipo, 'ESQUINA');
    assert.equal(b.alto_mm, 1540);
    assert.equal(b.angulo, 90);
    assert.equal(b.ancho_mm, 4315, 'la suma directa de los 4 paños, no 2480');
    assert.deepEqual(b.partes.map((p) => p.ancho_mm), [330, 1830, 1830, 325], 'los 4, en el orden del cliente');
    assert.deepEqual(b.partes.map((p) => p.tipo), ['FIJA', 'FIJA', 'FIJA', 'COMPUESTA']);
    assert.deepEqual(b.partes[3].partes.map((p) => p.tipo), ['PROYECTANTE', 'FIJA']);
    assert.equal(b.partes[3].partes.reduce((s, p) => s + p.alto_mm, 0), 1540);
    // El vidrio se elige por el paño MAS GRANDE (1830x1540 = 2,8 m2 -> 5+12+5), igual que en la
    // notacion de tres medidas manda el central. No por el lateral de 330 que va primero.
    assert.equal(b.glass_id, 61);
    assert.equal(r.ok, true);
    // La medida que ve el cliente es la de SU ventana (#887), no la del primer paño.
    assert.equal(r.medidas_resueltas, '4315x1540mm');
    assert.match(r.nota_linea || '', /4 paños/);
    assert.match(r.nota_linea || '', /90/);
  });
});

test('🔒 #947 los paños explicitos del cliente MANDAN sobre la notacion de tres medidas', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    // Si Oliver manda las dos cosas, gana la lista: es lo que el cliente describio paño por paño.
    // (El texto trae los cuatro anchos: con la literalidad estricta un numero que el cliente no
    // escribio se rechaza, asi que la notacion sola ya no alcanza para mandar la lista.)
    await runTool('calcular_cotizacion', { ...PEDIDO_DUENO,
      medidas_texto: 'bow window 1830x1540x330, paños de 330, 1830, 1830 y 325' }, {});
    assert.equal(enviados.length, 1);
    assert.deepEqual(enviados[0].partes.map((p) => p.ancho_mm), [330, 1830, 1830, 325]);
  });
});

test('🔴 #947 el angulo del cliente llega al motor (45), no un 90 fijo', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    await runTool('calcular_cotizacion', { ...PEDIDO_DUENO, angulo_esquina: 45 }, {});
    assert.equal(enviados[0].angulo, 45);
  });
});

test('🔒 #947 un solo paño NO es una esquina: la tool lo dice y NO cotiza', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    const r = await runTool('calcular_cotizacion', { ...PEDIDO_DUENO, panos_esquina: [{ tipo: 'FIJA', ancho_mm: 330 }] }, {});
    assert.equal(r.ok, false);
    assert.match(String(r.error), /entre 2 y 6/);
    assert.equal(enviados.length, 0, 'no se le pide nada al motor');
  });
});

test('🔒 #947 la ventana en esquina NO hereda la frase del monorriel ("corredera de una hoja")', async () => {
  // Defecto latente desde el #884: la tool pegaba la instruccion del monorriel a CUALQUIER
  // nota_linea, y la esquina tiene la suya. Oliver habria dicho que una bow window "quedo
  // cotizada como corredera de una hoja con paño fijo", que es falso.
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async () => {
    for (const input of [PEDIDO_DUENO, {
      tipo: 'FIJA', medidas_texto: '2000x1500x400', color: 'BLANCO', comuna: 'Temuco', cantidad: 1,
      descripcion_producto: 'bow window, laterales mitad superior proyectante mitad inferior marco fijo',
    }]) {
      const r = await runTool('calcular_cotizacion', input, {});
      assert.equal(r.ok, true);
      assert.doesNotMatch(String(r._decir_al_cliente || ''), /corredera de una hoja/i);
      assert.match(String(r._decir_al_cliente || ''), /esquina/i);
    }
  });
});

test('🔴 #947 · el VIDRIO de la esquina es el del paño mayor por los TRES caminos (chat = PDF)', async () => {
  // Tridente (Gemini r1, GRAVE 1), y existia desde el #887: por etiqueta `measures` ya es el
  // TOTAL de la ventana, asi que el area se inflaba y una bow de 400+1200+400 x 1200 (paño
  // mayor 1,44 m2 -> 4+12+4) se re-cotizaba con 5+12+5 en el PDF y en las opciones por color.
  // El PDF salia mas caro que lo que Oliver dijo en el chat.
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    // (1) paño por paño, desde la tool
    await runTool('calcular_cotizacion', {
      tipo: 'FIJA', medidas_texto: 'fija 400x1200, fija 1200x1200, fija 400x1200', descripcion_producto: 'bow window',
      panos_esquina: [{ tipo: 'FIJA', ancho_mm: 400 }, { tipo: 'FIJA', ancho_mm: 1200 }, { tipo: 'FIJA', ancho_mm: 400 }],
      alto_mm: 1200, angulo_esquina: 90, color: 'BLANCO', comuna: 'Temuco', cantidad: 1,
    }, {});
    // (2) notacion triple, desde la tool
    await runTool('calcular_cotizacion', {
      tipo: 'FIJA', medidas_texto: '1200x1200x400', descripcion_producto: 'bow window',
      color: 'BLANCO', comuna: 'Temuco', cantidad: 1,
    }, {});
    // (3) por ETIQUETA, como llega a la sonda de color y al PDF: `measures` es el total.
    await priceAllEngine({ comuna: 'Temuco', items: [{
      measures: '2000x1200mm', qty: 1, color: 'BLANCO',
      product: 'Ventana en esquina (3 paños, union 90°): Fijo 400mm + Fijo 1200mm + Fijo 400mm',
    }] });
    assert.equal(enviados.length, 3);
    for (const [i, b] of enviados.entries()) {
      assert.equal(b.tipo, 'ESQUINA', `camino ${i + 1}`);
      assert.equal(b.glass_id, 34, `camino ${i + 1}: 4+12+4, el del paño mayor (1,44 m2), no el del total (2,4 m2)`);
    }
  });
});

// ── Ronda 2 del tridente (Codex): cinco caminos por los que la esquina explicita cotizaba OTRA cosa ──

test('🔒 #947 · Codex r2 GRAVE 5 · panos_esquina NO convierte una compuesta plana en esquina', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    const r = await runTool('calcular_cotizacion', {
      tipo: 'COMPUESTA', descripcion_producto: 'ventana compuesta, fijo 800 + proyectante 800',
      medidas_texto: '1600x1200', alto_mm: 1200,
      panos_esquina: [{ tipo: 'FIJA', ancho_mm: 800 }, { tipo: 'PROYECTANTE', ancho_mm: 800 }],
      color: 'BLANCO', comuna: 'Temuco', cantidad: 1,
    }, {});
    assert.equal(r.ok, false);
    assert.match(String(r.error), /bow window|en esquina/i);
    assert.equal(enviados.length, 0, 'no sale al motor como ESQUINA con un poste que el cliente no pidio');
  });
});

test('🔒 #947 · Codex r2 GRAVE 1 · el texto manda: un par fuera de rango NO se pisa con el numero del LLM', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    const r = await runTool('calcular_cotizacion', { ...PEDIDO_DUENO, medidas_texto: '330x15400 mm', unidad_confirmada: 'mm' }, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'medidas_fuera_de_rango');
    assert.equal(enviados.length, 0);
  });
});

test('🔴 #947 · Codex r2 GRAVE 3 · lista "alto por ancho": el alto es el que dijo el cliente, no la 2a cifra del par', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    await runTool('calcular_cotizacion', { ...PEDIDO_DUENO,
      medidas_texto: 'alto por ancho, en mm: 1540x330, 1540x1830, 1540x1830, 1540x325', alto_mm: 1540 }, {});
    const b = enviados[0];
    assert.equal(b.tipo, 'ESQUINA');
    assert.equal(b.alto_mm, 1540, 'ni 330 (2a cifra del par) ni 1830 (el pre-pass dio vuelta el par)');
    assert.equal(b.ancho_mm, 4315);
    assert.deepEqual(b.partes.map((p) => p.ancho_mm), [330, 1830, 1830, 325]);
    assert.equal(b.glass_id, 61, 'el vidrio por el paño mayor 1830x1540, no por un par invertido');
  });
});

test('🔴 #947 · Codex r2 GRAVE 2 · el cliente escribio en cm y el LLM copio los numeros: se escalan por el texto', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    await runTool('calcular_cotizacion', {
      tipo: 'FIJA', descripcion_producto: 'bow window de tres paños',
      medidas_texto: '180x150, 200x150 y 180x150, todo en cm', alto_mm: 150, angulo_esquina: 90,
      panos_esquina: [{ tipo: 'FIJA', ancho_mm: 180 }, { tipo: 'FIJA', ancho_mm: 200 }, { tipo: 'FIJA', ancho_mm: 180 }],
      color: 'BLANCO', comuna: 'Temuco', cantidad: 1,
    }, {});
    const b = enviados[0];
    assert.equal(b.alto_mm, 1500);
    assert.deepEqual(b.partes.map((p) => p.ancho_mm), [1800, 2000, 1800]);
    assert.equal(b.ancho_mm, 5600);
  });
});

test('🔒 #947 · sin alto_mm la esquina explicita NO cotiza: lo pide', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    const { alto_mm, ...sinAlto } = PEDIDO_DUENO;
    const r = await runTool('calcular_cotizacion', sinAlto, {});
    assert.equal(r.ok, false);
    assert.match(String(r.error), /alto_mm/);
    assert.equal(enviados.length, 0);
  });
});

test('🔒 #947 · Codex r2 GRAVE 4 · etiqueta con angulos DISTINTOS: se escala, no se re-cotiza a 90', async () => {
  await conMotorStub(async (enviados) => {
    const items = [{ measures: '2700x1000mm', qty: 1, color: 'BLANCO',
      product: 'Ventana en esquina (3 paños, union 90° y 45°): Fijo 450mm + Fijo 1800mm + Fijo 450mm' }];
    await priceAllEngine({ comuna: 'Temuco', items });
    assert.equal(enviados.length, 0, 'no se le manda al motor un angulo adivinado');
    assert.equal(items[0].fuera_de_alcance, true);
    assert.match(String(items[0].price_warning), /ángulos distintos/);
  });
});

test('🔒 #947 panos_esquina y angulo_esquina estan en el schema (additionalProperties:false los exige)', async () => {
  const { TOOL_DEFS } = await import('../src/oliver-gpt/tools.js');
  const def = TOOL_DEFS.find((t) => t.function?.name === 'calcular_cotizacion');
  const props = def.function.parameters.properties;
  assert.ok(props.panos_esquina, 'sin esto el campo se cae antes de salir del LLM (leccion del 25-ago con partes)');
  assert.equal(props.panos_esquina.type, 'array');
  assert.equal(props.panos_esquina.items.additionalProperties, false);
  for (const k of ['tipo', 'ancho_mm', 'arriba', 'abajo']) assert.ok(props.panos_esquina.items.properties[k], k);
  assert.ok(props.angulo_esquina);
  assert.equal(def.function.parameters.additionalProperties, false);
});

// ── Ronda 3 del tridente (Codex): literalidad ESTRICTA contra el texto del CLIENTE ────────────
// Cada ancho, el alto y las alturas de las mitades tienen que ser numeros que el cliente escribio,
// toman la unidad del par donde aparecen, y el alto tiene que ser la medida comun a todos los pares.
const TEXTO_DUENO = 'bow windws 4 lados bow windows fija 330x1540 fija 1830x1540 fija 1830x1540 mitad superior proyectante y mitad inferior fija 325x1540 color blanco nombre marcelo comuna pucon';

test('🔴 #947 · Codex r3 GRAVE 2A · un alto que es un ANCHO del cliente (1830) se rechaza: no es la medida común', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    const r = await runTool('calcular_cotizacion', { ...PEDIDO_DUENO, alto_mm: 1830 }, { textoCliente: TEXTO_DUENO });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /común/);
    assert.equal(enviados.length, 0);
  });
});

test('🔴 #947 · Codex r3 GRAVE 2B · un ancho que el cliente NO escribió (1800 por 1830) se rechaza', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    const panos = PEDIDO_DUENO.panos_esquina.map((p, i) => (i === 2 ? { ...p, ancho_mm: 1800 } : p));
    const r = await runTool('calcular_cotizacion', { ...PEDIDO_DUENO, panos_esquina: panos }, { textoCliente: TEXTO_DUENO });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /1800/);
    assert.match(String(r.error), /NO está escrito/i);
    assert.equal(enviados.length, 0);
  });
});

test('🔴 #947 · Codex r3 GRAVE 3 · el cliente escribió en cm: los números convertidos por el LLM se rechazan, los copiados se escalan', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  const texto = 'bow window, fija 80x50 y fija 100x50, todo en cm';
  const base = { tipo: 'FIJA', descripcion_producto: 'bow window de dos paños', medidas_texto: '80x50 y 100x50 cm',
    angulo_esquina: 90, color: 'BLANCO', comuna: 'Temuco', cantidad: 1 };
  await conMotorStub(async (enviados) => {
    // El LLM "obedece el schema" y convierte: 800/1000 y alto 500 no estan escritos -> NO se cotiza.
    const r1 = await runTool('calcular_cotizacion', { ...base, alto_mm: 500,
      panos_esquina: [{ tipo: 'FIJA', ancho_mm: 800 }, { tipo: 'FIJA', ancho_mm: 1000 }] }, { textoCliente: texto });
    assert.equal(r1.ok, false);
    assert.match(String(r1.error), /NO está escrito/i);
    assert.equal(enviados.length, 0, 'antes salia 1800x5000 mm');
    // Copiando los numeros del cliente, la unidad la pone el texto: 800 + 1000 x 500 mm.
    await runTool('calcular_cotizacion', { ...base, alto_mm: 50,
      panos_esquina: [{ tipo: 'FIJA', ancho_mm: 80 }, { tipo: 'FIJA', ancho_mm: 100 }] }, { textoCliente: texto });
    assert.equal(enviados.length, 1);
    assert.deepEqual(enviados[0].partes.map((p) => p.ancho_mm), [800, 1000]);
    assert.equal(enviados[0].alto_mm, 500);
  });
});

test('🔴 #947 · Codex r3 GRAVE 3 · un texto que MEZCLA cm y mm: cada número lleva la unidad de SU par', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  const texto = 'ventana en esquina: primer paño 180x150 cm; segundo 1800x1500 mm';
  await conMotorStub(async (enviados) => {
    await runTool('calcular_cotizacion', { tipo: 'FIJA', descripcion_producto: 'ventana en esquina', medidas_texto: texto,
      alto_mm: 150, angulo_esquina: 90, color: 'BLANCO', comuna: 'Temuco', cantidad: 1,
      panos_esquina: [{ tipo: 'FIJA', ancho_mm: 180 }, { tipo: 'FIJA', ancho_mm: 1800 }] }, { textoCliente: texto });
    assert.equal(enviados.length, 1);
    assert.deepEqual(enviados[0].partes.map((p) => p.ancho_mm), [1800, 1800], 'antes: 18000 + 18000');
    assert.equal(enviados[0].alto_mm, 1500, '150 cm = 1500 mm, y es comun a los dos pares');
    assert.equal(enviados[0].ancho_mm, 3600);
  });
});

test('🔒 #947 · Codex r3 GRAVE 4 · la guardia mira el texto del CLIENTE, no una descripción del LLM', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    const r = await runTool('calcular_cotizacion', {
      tipo: 'COMPUESTA', descripcion_producto: 'bow window de dos paños',   // alucinada por el LLM
      medidas_texto: '1600x1200', alto_mm: 1200, angulo_esquina: 90,
      panos_esquina: [{ tipo: 'FIJA', ancho_mm: 800 }, { tipo: 'PROYECTANTE', ancho_mm: 800 }],
      color: 'BLANCO', comuna: 'Temuco', cantidad: 1,
    }, { textoCliente: 'ventana compuesta plana, fijo 800 + proyectante 800, de 1600x1200' });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /CLIENTE no la describió/i);
    assert.equal(enviados.length, 0);
  });
});

test('🔒 #947 · Codex r3 MEDIO 6 · sin angulo_esquina NO se cotiza: se pregunta', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    const { angulo_esquina, ...sinAngulo } = PEDIDO_DUENO;
    const r = await runTool('calcular_cotizacion', sinAngulo, { textoCliente: TEXTO_DUENO });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /angulo_esquina/);
    assert.equal(enviados.length, 0);
  });
});

test('🔒 #947 · Codex r3 GRAVE 5A · un paño compuesto sin decir qué abre NO se inventa: se pregunta', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    const panos = PEDIDO_DUENO.panos_esquina.map((p) => (p.tipo === 'COMPUESTA' ? { tipo: 'COMPUESTA', ancho_mm: 325 } : p));
    const r = await runTool('calcular_cotizacion', { ...PEDIDO_DUENO, panos_esquina: panos }, { textoCliente: TEXTO_DUENO });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /ARRIBA/);
    assert.equal(enviados.length, 0);
  });
});

test('🔴 #947 · Codex r3 GRAVE 5B · las mitades DESIGUALES del cliente (400 arriba + 1140 abajo) llegan al motor', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  const texto = 'bow window: fija 330x1540, fija 1830x1540, fija 1830x1540 y el lateral de 325x1540 con la proyectante de 400 arriba y 1140 fija abajo, angulo 90';
  await conMotorStub(async (enviados) => {
    const panos = PEDIDO_DUENO.panos_esquina.map((p) => (p.tipo === 'COMPUESTA'
      ? { ...p, alto_arriba_mm: 400, alto_abajo_mm: 1140 } : p));
    await runTool('calcular_cotizacion', { ...PEDIDO_DUENO, medidas_texto: texto, panos_esquina: panos }, { textoCliente: texto });
    assert.equal(enviados.length, 1);
    const c = enviados[0].partes[3];
    assert.equal(c.tipo, 'COMPUESTA');
    assert.deepEqual(c.partes.map((x) => [x.tipo, x.alto_mm]), [['PROYECTANTE', 400], ['FIJA', 1140]]);
  });
});

test('📌 #947 · Codex r3 GRAVE 1 · DECISIÓN: el vidrio de la esquina va por el paño MAYOR aunque no sea el central', async () => {
  // Antes del #947 la notacion triple elegia el vidrio por el CENTRAL (era el par que resolvia la
  // tool). Con laterales mas anchos que el central ("400x1540x1830") eso daba 4+12+4 para paños de
  // 1830x1540 (2,8 m2). Se decide a proposito: el vidrio se dimensiona por el paño mas grande, que
  // es lo conservador, y es la MISMA regla en los tres caminos. Si el dueño prefiere otra, es un
  // solo lugar (enginePricer 4b). Queda fijado para que no vuelva a cambiar en silencio.
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  await conMotorStub(async (enviados) => {
    await runTool('calcular_cotizacion', { tipo: 'FIJA', medidas_texto: '400x1540x1830', descripcion_producto: 'bow window',
      color: 'BLANCO', comuna: 'Temuco', cantidad: 1 }, {});
    assert.deepEqual(enviados[0].partes.map((p) => p.ancho_mm), [1830, 400, 1830]);
    assert.equal(enviados[0].glass_id, 61, 'por el lateral de 1830x1540, no por el central de 400');
  });
});

// ── Ronda 4 del tridente (Gemini): textos sin pares "AxB", varias ventanas en el mismo mensaje ──

test('🔴 #947 · Gemini r4 GRAVE 1 · paños listados SIN "x" en cm: todos a mm, también el que pasa de 150', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  const texto = 'ventana en esquina, alto 150 cm, paños de 40 cm, 180 cm y 40 cm, angulo 90';
  await conMotorStub(async (enviados) => {
    await runTool('calcular_cotizacion', { tipo: 'FIJA', descripcion_producto: 'ventana en esquina', medidas_texto: texto,
      alto_mm: 150, angulo_esquina: 90, color: 'BLANCO', comuna: 'Temuco', cantidad: 1,
      panos_esquina: [{ tipo: 'FIJA', ancho_mm: 40 }, { tipo: 'FIJA', ancho_mm: 180 }, { tipo: 'FIJA', ancho_mm: 40 }] }, { textoCliente: texto });
    assert.equal(enviados.length, 1);
    assert.deepEqual(enviados[0].partes.map((p) => p.ancho_mm), [400, 1800, 400], 'antes el 180 quedaba en 180 mm');
    assert.equal(enviados[0].alto_mm, 1500);
  });
});

test('🔴 #947 · Gemini r4 GRAVE 2 · otra ventana en el mismo mensaje NO bloquea el alto de la esquina', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  const texto = 'quiero una ventana normal de 150x120 cm y una bow window de 33x154, 183x154, 183x154 y 32x154 cm, la ultima mitad proyectante arriba mitad fija abajo, angulo 90';
  await conMotorStub(async (enviados) => {
    const r = await runTool('calcular_cotizacion', { tipo: 'FIJA', descripcion_producto: 'bow window', medidas_texto: texto,
      alto_mm: 154, angulo_esquina: 90, color: 'BLANCO', comuna: 'Temuco', cantidad: 1,
      panos_esquina: [{ tipo: 'FIJA', ancho_mm: 33 }, { tipo: 'FIJA', ancho_mm: 183 }, { tipo: 'FIJA', ancho_mm: 183 },
        { tipo: 'COMPUESTA', ancho_mm: 32, arriba: 'PROYECTANTE', abajo: 'FIJA' }] }, { textoCliente: texto });
    assert.equal(r.ok, true, String(r.error || ''));
    assert.equal(enviados[0].alto_mm, 1540);
    assert.deepEqual(enviados[0].partes.map((p) => p.ancho_mm), [330, 1830, 1830, 320]);
  });
});

test('🔴 #947 · Gemini r4 MEDIO 3 · la altura de una mitad dicha suelta en un texto en cm no queda en milímetros', async () => {
  const { runTool } = await import('../src/oliver-gpt/tools.js');
  const texto = 'ventana en esquina, alto 150 cm, primer paño de 40 cm y compuesto de 32 con proyectante de 40 arriba y fija abajo, angulo 90';
  await conMotorStub(async (enviados) => {
    const r = await runTool('calcular_cotizacion', { tipo: 'FIJA', descripcion_producto: 'ventana en esquina', medidas_texto: texto,
      alto_mm: 150, angulo_esquina: 90, color: 'BLANCO', comuna: 'Temuco', cantidad: 1,
      panos_esquina: [{ tipo: 'FIJA', ancho_mm: 40 }, { tipo: 'COMPUESTA', ancho_mm: 32, arriba: 'PROYECTANTE', abajo: 'FIJA', alto_arriba_mm: 40 }] }, { textoCliente: texto });
    assert.equal(r.ok, true, String(r.error || ''));
    const c = enviados[0].partes[1];
    assert.deepEqual(c.partes.map((x) => [x.tipo, x.alto_mm]), [['PROYECTANTE', 400], ['FIJA', 1100]], 'antes: 40 mm arriba');
  });
});
