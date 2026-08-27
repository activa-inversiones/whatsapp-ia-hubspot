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
