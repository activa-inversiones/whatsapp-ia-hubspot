// [2026-08-27] Enrutamiento de la línea AMERICANA en el bot (decisión del dueño: abrir con
// tope de tamaño). Prueba de punta a punta con el motor mockeado (fetch stubbeado):
//   · una americana corredera ≤ 2,5 m → se enruta con serie=AMERICANA al motor;
//   · una americana > 2,5 m/lado → se ESCALA a Marcelo, sin llamar al motor (no cobra de menos);
//   · una corredera SIN "americana" → sigue yendo como SLIDING (no se contamina).
import test from 'node:test';
import assert from 'node:assert/strict';
import { priceAllEngine, esLineaAmericana, AMERICANA_MAX_MM } from './enginePricer.js';

test('esLineaAmericana detecta la línea por el texto, sin confundir con Andes/Venau', () => {
  assert.equal(esLineaAmericana({ descripcion: 'línea americana 1000x1000' }), true);
  assert.equal(esLineaAmericana({ product: 'ventana americana' }), true);
  assert.equal(esLineaAmericana({ descripcion: 'corredera sliding' }), false);
  assert.equal(esLineaAmericana({ descripcion: 'línea andes' }), false);
  assert.equal(esLineaAmericana({ descripcion: 'serie venau' }), false);
  // 🔴 [compuerta] "cocina americana" es un AMBIENTE, no la línea → NO enruta (cobraría de menos)
  assert.equal(esLineaAmericana({ descripcion: 'corredera para la cocina americana' }), false);
  assert.equal(esLineaAmericana({ descripcion: 'cocina americana' }), false);
  // pero una apertura + americana SÍ (para poder escalarla si no es corredera)
  assert.equal(esLineaAmericana({ descripcion: 'proyectante americana' }), true);
  // 🔴 [Codex 2ª vuelta] el guion bajo (enum estructurado) no debe evadir la detección
  assert.equal(esLineaAmericana({ product: 'SISTEMA_AMERICANA' }), true);
  assert.equal(AMERICANA_MAX_MM, 2500);
});

// Stub de fetch que captura los payloads enviados al motor y responde una cotización válida.
function conMotorStub(fn) {
  const orig = globalThis.fetch;
  const enviados = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/quotes/calculate')) {
      const body = JSON.parse(opts.body || '{}');
      enviados.push(body);
      return { ok: true, status: 200, async json() {
        return { ok: true, grand_total: 120000, total_clp: 120000, unit_price: 120000,
          producto_label: `Corredera ${body.serie === 'AMERICANA' ? 'AMERICANA Monorriel' : 'SLIDING'}`,
          materiales: { subtotal: 90000 } };
      } };
    }
    return { ok: true, status: 200, async json() { return { ok: true }; } };
  };
  return Promise.resolve(fn(enviados)).finally(() => { globalThis.fetch = orig; });
}

test('🎯 americana ≤ 2,5 m: se enruta con serie=AMERICANA al motor', async () => {
  await conMotorStub(async (enviados) => {
    await priceAllEngine({
      comuna: 'Temuco',
      items: [{ measures: '1000x1000mm', product: 'CORREDERA', descripcion: 'línea americana', qty: 1 }],
    });
    const am = enviados.find((b) => b.serie === 'AMERICANA');
    assert.ok(am, `esperaba una llamada con serie=AMERICANA; llegaron: ${JSON.stringify(enviados.map((e) => e.serie))}`);
    assert.equal(am.ancho_mm, 1000);
    assert.equal(am.tipo, 'CORREDERA');
  });
});

test('🔴 americana > 2,5 m/lado: ESCALA a Marcelo, NO llama al motor (no cobra de menos)', async () => {
  await conMotorStub(async (enviados) => {
    const d = {
      comuna: 'Temuco',
      items: [{ measures: '3000x1800mm', product: 'CORREDERA', descripcion: 'ventana americana grande', qty: 1 }],
    };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0, 'no debe llamar al motor para una americana fuera del tope');
    assert.equal(d.items[0].confidence, 'manual', 'queda para revisión manual');
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('corredera SIN "americana" sigue como SLIDING (no se contamina)', async () => {
  await conMotorStub(async (enviados) => {
    await priceAllEngine({
      comuna: 'Temuco',
      items: [{ measures: '1500x1200mm', product: 'CORREDERA', descripcion: 'corredera termopanel', qty: 1 }],
    });
    assert.ok(enviados.some((b) => b.serie === 'SLIDING'), 'una corredera común va a SLIDING');
    assert.ok(!enviados.some((b) => b.serie === 'AMERICANA'), 'ninguna va a AMERICANA');
  });
});

test('🔴 [compuerta] una americana NO-corredera (proyectante) ESCALA, no cotiza como S60', async () => {
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', items: [{ measures: '1000x1200mm', product: 'PROYECTANTE', descripcion: 'proyectante americana', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0, 'no llama al motor: una proyectante americana no existe');
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('🔴 [compuerta] "corredera para la cocina americana" NO se enruta a AMERICANA (es un ambiente)', async () => {
  await conMotorStub(async (enviados) => {
    await priceAllEngine({ comuna: 'Temuco', items: [{ measures: '1500x1100mm', product: 'CORREDERA', descripcion: 'corredera para la cocina americana', qty: 1 }] });
    assert.ok(enviados.some((b) => b.serie === 'SLIDING'), 'va a SLIDING, no AMERICANA');
    assert.ok(!enviados.some((b) => b.serie === 'AMERICANA'), 'no cobra de menos por un falso positivo');
  });
});


// ── [2026-08-27] Envelope del ANDES (decisión del dueño: solo lo calibrado) ──────────────
import { esLineaAndes, ANDES_MAX_MM, ANDES_MIN_AREA_M2 } from './enginePricer.js';

test('esLineaAndes detecta la línea, NO la comuna Los Andes', () => {
  assert.equal(esLineaAndes({ descripcion: 'corredera línea andes' }), true);
  assert.equal(esLineaAndes({ descripcion: 'despacho a Los Andes' }), false);
  assert.equal(ANDES_MAX_MM, 2500); assert.equal(ANDES_MIN_AREA_M2, 3.5);
});

test('🎯 andes doble riel 2 hojas ≥3,5m² ≤2,5m: enruta a serie=ANDES', async () => {
  await conMotorStub(async (enviados) => {
    await priceAllEngine({ comuna: 'Temuco', items: [{ measures: '2000x2000mm', product: 'CORREDERA', descripcion: 'línea andes', qty: 1 }] });
    assert.ok(enviados.some((b) => b.serie === 'ANDES'), `esperaba serie=ANDES; llegó ${JSON.stringify(enviados.map((e) => e.serie))}`);
  });
});

test('🔴 andes chica (<3,5m², hoja 54 sin calibrar) ESCALA, no cotiza', async () => {
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', items: [{ measures: '1200x1000mm', product: 'CORREDERA', descripcion: 'corredera andes', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0);
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('🔴 andes monorriel (sin calibrar) ESCALA', async () => {
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', items: [{ measures: '2000x2000mm', product: 'CORREDERA', descripcion: 'corredera andes monorriel', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0);
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('🔴 andes de 3 hojas (sin calibrar) ESCALA', async () => {
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', items: [{ measures: '2400x2000mm', product: 'CORREDERA', descripcion: 'corredera andes 3 hojas', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0);
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('🔴 andes más grande que 2,5m/lado ESCALA', async () => {
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', items: [{ measures: '3000x2000mm', product: 'CORREDERA', descripcion: 'línea andes', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0);
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('🔴 [compuerta] "3 hojas" SOLO en texto_cliente escala (no cotiza andes como 2 hojas = subcobro)', async () => {
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', texto_cliente: 'quiero de 3 hojas', items: [{ measures: '2400x2000mm', product: 'CORREDERA', descripcion: 'línea andes', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0, 'no cotiza: 3 hojas no está calibrado');
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('🔴 [compuerta] "que NO sea monorriel" NO escala en falso (es doble riel, cotizable)', async () => {
  await conMotorStub(async (enviados) => {
    await priceAllEngine({ comuna: 'Temuco', texto_cliente: 'que no sea monorriel', items: [{ measures: '2000x2000mm', product: 'CORREDERA', descripcion: 'línea andes', qty: 1 }] });
    assert.ok(enviados.some((b) => b.serie === 'ANDES'), 'la negación no debe frenar un doble riel válido');
  });
});

test('🔴 [compuerta] "hoja 54" explícita escala (perfil chico sin calibrar)', async () => {
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', items: [{ measures: '2000x2000mm', product: 'CORREDERA', descripcion: 'línea andes hoja 54', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0);
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('🔴 [Codex 3a vuelta] "3 hojas" en item.producto (español) escala, no cotiza como 2 (subcobro)', async () => {
  // esLineaAndes lee item.producto; el contador de hojas debe leer el MISMO campo, o la ruta
  // se activa por "3 hojas" pero cotiza 2. Antes de este arreglo, enviados.length era 1 (subcobro).
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', items: [{ measures: '2400x2000mm', product: 'CORREDERA', producto: 'corredera línea Andes 3 hojas', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0, 'no cotiza: 3 hojas en item.producto no está calibrado');
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('🔴 [Codex 3a vuelta] "tres hojas" (palabra) escala, no cotiza como 2 (subcobro)', async () => {
  // detectHojas antes solo leía dígitos: "tres hojas" caía a 2 y cotizaba de menos.
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', items: [{ measures: '2400x2000mm', product: 'CORREDERA', descripcion: 'línea andes tres hojas', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0, 'no cotiza: "tres hojas" no está calibrado');
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('🔴 [Codex 3a vuelta] corrección "no de 2 hojas, sino de 3" escala (conteo ambiguo)', async () => {
  // El "3" va elidido (sin "hoja"); detectHojas se queda con el "2". La guarda de ambigüedad escala.
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', texto_cliente: 'no de 2 hojas, sino de 3', items: [{ measures: '2400x2000mm', product: 'CORREDERA', descripcion: 'línea andes', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0, 'no cotiza: el número de hojas es ambiguo');
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('🔴 [Codex 4a vuelta] "3-hojas" con guión escala (detectHojas no lo parsea, pero se menciona)', async () => {
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', items: [{ measures: '2400x2000mm', product: 'CORREDERA', descripcion: 'línea andes 3-hojas', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0, 'no cotiza: "3-hojas" se menciona pero no confirma 2');
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('🔴 [Gemini 4a vuelta] "no de dos hojas" (palabra negada) escala, no cotiza como 2', async () => {
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', texto_cliente: 'no de dos hojas', items: [{ measures: '2400x2000mm', product: 'CORREDERA', descripcion: 'línea andes', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0, 'no cotiza: negación con palabra-número');
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('🔴 [Gemini 5a vuelta] "3 paños" (sinónimo chileno) escala, no cotiza como 2', async () => {
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', items: [{ measures: '2400x2000mm', product: 'CORREDERA', descripcion: 'corredera andes de 3 paños', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0, 'no cotiza: "3 paños" no confirma 2');
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('🔴 [Gemini 6a vuelta] "3 cuerpos" (sinónimo chileno) escala, no cotiza como 2', async () => {
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', items: [{ measures: '2400x2000mm', product: 'CORREDERA', descripcion: 'corredera línea andes de 3 cuerpos', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0, 'no cotiza: "3 cuerpos" no confirma 2');
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('🔴 [Gemini 7a vuelta] "3 grandes hojas" (adjetivo intermedio) escala, no cotiza como 2', async () => {
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', items: [{ measures: '2400x2000mm', product: 'CORREDERA', descripcion: 'corredera línea andes de 3 grandes hojas', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0, 'no cotiza: "3 grandes hojas" son 3');
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('🔴 [Codex 6a vuelta] "2 hojas + 1 fija" (2+1 = 3 secciones) escala, no cotiza como 2 hojas', async () => {
  // El envelope es 2 hojas CORREDIZAS sin paño fijo; un fijo adicional agrega perfiles ⇒ subcobro.
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', items: [{ measures: '2400x2000mm', product: 'CORREDERA', descripcion: 'corredera línea andes 2 hojas y una fija', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0, 'no cotiza: lleva un paño fijo adicional');
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('🔴 [Gemini 8a vuelta] "tres rieles" (triple riel) escala; "doble riel" NO', async () => {
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', items: [{ measures: '2400x2000mm', product: 'CORREDERA', descripcion: 'corredera línea andes tres rieles', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0, 'no cotiza: tres rieles = 3+ hojas');
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('🔴 [Codex 8a vuelta] paño fijo descrito SIN la palabra "fijo" ("un paño lateral sin apertura") escala', async () => {
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', items: [{ measures: '2400x2000mm', product: 'CORREDERA', descripcion: 'corredera línea andes, dos hojas móviles y un paño lateral sin apertura', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0, 'no cotiza: es un 2+1 (2 corredizas + 1 fijo)');
    assert.equal(d.items[0].fuera_de_alcance, true);
  });
});

test('🔴 [Gemini 9a vuelta] "3 paneles" escala; pero "vidrio termopanel 5+12+5" NO (vidrio ≠ sección)', async () => {
  await conMotorStub(async (enviados) => {
    const d1 = { comuna: 'Temuco', items: [{ measures: '2400x2000mm', product: 'CORREDERA', descripcion: 'corredera línea andes 3 paneles', qty: 1 }] };
    await priceAllEngine(d1);
    assert.equal(d1.items[0].fuera_de_alcance, true, '"3 paneles" escala');
  });
  await conMotorStub(async (enviados) => {
    const d2 = { comuna: 'Temuco', items: [{ measures: '2000x2000mm', product: 'CORREDERA', descripcion: 'corredera línea andes doble riel con vidrio termopanel 5+12+5', qty: 1 }] };
    await priceAllEngine(d2);
    assert.ok(enviados.some((b) => b.serie === 'ANDES'), 'mencionar el vidrio/termopanel NO debe escalar');
  });
});

test('🎯 [Codex 4a vuelta] "línea andes doble riel" (canónico, sin nº de hojas) SÍ enruta al envelope', async () => {
  // "doble riel" no debe leerse como conteo de hojas: es la descripción del config calibrado.
  await conMotorStub(async (enviados) => {
    await priceAllEngine({ comuna: 'Temuco', items: [{ measures: '2000x2000mm', product: 'CORREDERA', descripcion: 'corredera línea andes doble riel', qty: 1 }] });
    assert.ok(enviados.some((b) => b.serie === 'ANDES'), 'el canónico doble riel debe cotizar');
  });
});
