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


// ── [2026-08-27] LÍNEA ANDES — AUTO-COTIZADO APAGADO (decisión del dueño) ─────────────
// El envelope de 2 hojas se abrió y se APAGÓ el mismo día: un barrido adversarial de 98 entradas
// de cliente chilenas midió que 96 se colaban como "2 hojas" siendo de 3-4 hojas o con paño fijo.
// Subcobro medido en la clase peor (4 hojas cotizadas como 2, 2200x2000): $139.000-$155.000.
// Causa raíz: el nº de hojas se ADIVINA por regex del texto libre. Se reabre cuando el LLM lo
// DECLARE en un campo estructurado. Estos tests fijan que, hasta entonces, TODA Andes escala.
import { esLineaAndes, ANDES_MAX_MM, ANDES_MIN_AREA_M2, ANDES_AUTO_COTIZA, detectHojas, mencionaConteoHojas } from './enginePricer.js';

test('esLineaAndes detecta la línea, NO la comuna Los Andes', () => {
  assert.equal(esLineaAndes({ descripcion: 'corredera línea andes' }), true);
  assert.equal(esLineaAndes({ descripcion: 'despacho a Los Andes' }), false);
  assert.equal(ANDES_MAX_MM, 2500); assert.equal(ANDES_MIN_AREA_M2, 3.5);
});

test('KILL-SWITCH: el auto-cotizado de ANDES está APAGADO', () => {
  assert.equal(ANDES_AUTO_COTIZA, false,
    'Si esto es true, el envelope volvió a cotizar por regex: exigir que el nº de hojas venga DECLARADO.');
});

// Toda Andes escala: no se manda nada al motor y queda marcada para revisión manual.
async function assertEscalaAndes(descripcion, texto_cliente) {
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', texto_cliente: texto_cliente || '', items: [{ measures: '2200x2000mm', product: 'CORREDERA', descripcion, qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0, 'NO debe cotizar automatico: ' + descripcion);
    assert.equal(d.items[0].confidence, 'manual', 'debe quedar para revision manual: ' + descripcion);
  });
}

test('el caso que ANTES cotizaba (canónico 2 hojas doble riel) ahora ESCALA', async () => {
  await assertEscalaAndes('corredera línea andes doble riel');
  await assertEscalaAndes('corredera línea andes 2 hojas');
  await assertEscalaAndes('línea andes');
});

test('[barrido adversarial] las frases que evadían el envelope ahora TODAS escalan', async () => {
  // Muestra representativa de las 96 evasiones medidas (3 hojas, 4 hojas y paño fijo encubierto).
  const EVASIONES = [
    'corredera andes de 3 hojitas corredizas, doble riel',        // el diminutivo rompia el regex
    'ventana línea andes de 3 luces, corredera',                  // sinonimo de vidrieria
    'corredera andes con 4 postigos que corren',                  // chilenismo
    'corredera andes dividida en 4 partes',                       // "parte" no estaba en la lista
    'línea andes, 3 panitos que corren en doble riel',            // diminutivo de "pano"
    'corredera andes en XOX',                                     // notacion de instalador
    'corredera andes, dos que corren y un lado muerto',           // fijo sin la palabra "fijo"
    'corredera andes de 2 hojas y al lado un vidrio pegado que queda quieto',
    'línea andes 2 hojas corredizas y una parte de vidrio que no se abre',
    'corredera andes de 3 modulitos, doble riel',
    'necesito línea andes de 4 carros corredizos',
    'corredera andes con banderola arriba',
  ];
  for (const frase of EVASIONES) await assertEscalaAndes(frase);
});

test('🔴 [Codex] la COMUNA "Los Andes" no escala una AMERICANA cotizable (falso positivo)', async () => {
  // "despacho a Los Andes línea americana" matcheaba el patrón invertido "andes linea" y escalaba
  // una americana perfectamente cotizable. El lookbehind descarta el "los/las" de la comuna.
  assert.equal(esLineaAndes({ descripcion: 'despacho a Los Andes linea americana' }), false);
  assert.equal(esLineaAndes({ descripcion: 'vivo en los andes' }), false);
  // pero la línea real se sigue cazando, en los dos órdenes
  assert.equal(esLineaAndes({ descripcion: 'corredera linea andes' }), true);
  assert.equal(esLineaAndes({ descripcion: 'andes linea' }), true);
  await conMotorStub(async (enviados) => {
    await priceAllEngine({ comuna: 'Los Andes', items: [{ measures: '2200x2000mm', product: 'CORREDERA', descripcion: 'despacho a Los Andes linea americana', qty: 1 }] });
    assert.ok(enviados.some((b) => b.serie === 'AMERICANA'), 'la americana debe cotizar igual');
  });
});

test('🔴 [Codex] la línea Andes pedida SOLO en el texto del cliente también escala (no se cuela a SLIDING)', async () => {
  // Antes: si el LLM no copiaba "andes" al item, se cotizaba como SLIDING — otra línea. Sobrecobra,
  // pero es el producto equivocado y contradice el apagado.
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', texto_cliente: 'quiero una linea andes por favor', items: [{ measures: '2200x2000mm', product: 'CORREDERA', descripcion: 'corredera', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0, 'no cotiza ninguna serie');
    assert.equal(d.items[0].confidence, 'manual');
  });
  // ...pero una corredera normal (sin andes) sigue cotizando como SLIDING
  await conMotorStub(async (enviados) => {
    await priceAllEngine({ comuna: 'Temuco', texto_cliente: 'quiero una corredera grande', items: [{ measures: '2200x2000mm', product: 'CORREDERA', descripcion: 'corredera', qty: 1 }] });
    assert.ok(enviados.some((b) => b.serie === 'SLIDING'), 'SLIDING normal no se toca');
  });
});

test('🔴 [Codex] la palabra "Andes" a secas tampoco se cuela a SLIDING (última ruta)', async () => {
  // descripcion_producto:"Andes" no matcheaba el patrón con contexto y cotizaba como SLIDING: otra
  // línea. Con el apagado la detección es amplia — basta la palabra, salvo la comuna "Los Andes".
  await conMotorStub(async (enviados) => {
    const d = { comuna: 'Temuco', items: [{ measures: '2200x2000mm', product: 'CORREDERA', descripcion: 'Andes', qty: 1 }] };
    await priceAllEngine(d);
    assert.equal(enviados.length, 0, 'no cotiza ninguna serie');
    assert.equal(d.items[0].confidence, 'manual');
  });
  // ...pero la COMUNA no es un producto: una americana con despacho a Los Andes sigue cotizando
  await conMotorStub(async (enviados) => {
    await priceAllEngine({ comuna: 'Los Andes', items: [{ measures: '2200x2000mm', product: 'CORREDERA', descripcion: 'despacho a Los Andes linea americana', qty: 1 }] });
    assert.ok(enviados.some((b) => b.serie === 'AMERICANA'), 'la americana cotiza igual');
  });
  // ...y una corredera normal sigue yendo a SLIDING
  await conMotorStub(async (enviados) => {
    await priceAllEngine({ comuna: 'Temuco', items: [{ measures: '2200x2000mm', product: 'CORREDERA', descripcion: 'corredera', qty: 1 }] });
    assert.ok(enviados.some((b) => b.serie === 'SLIDING'), 'SLIDING intacta');
  });
});

test('detectHojas entiende dígitos, palabras y toma el MÁXIMO (se usará en el fix estructurado)', () => {
  assert.equal(detectHojas('corredera de 3 hojas'), 3);
  assert.equal(detectHojas('corredera línea andes tres hojas'), 3);
  assert.equal(detectHojas('ventana de cuatro hojas'), 4);
  assert.equal(detectHojas('2 fijas y 3 hojas corredizas'), 3);
  assert.equal(detectHojas('una corredera grande'), undefined);
});

test('mencionaConteoHojas reconoce sinónimos, pero NO "doble riel" ni el vidrio', () => {
  assert.equal(mencionaConteoHojas('3 grandes hojas'), true);
  assert.equal(mencionaConteoHojas('3 paños'), true);
  assert.equal(mencionaConteoHojas('3 cuerpos'), true);
  assert.equal(mencionaConteoHojas('doble riel'), false);
  assert.equal(mencionaConteoHojas('corredera termopanel 4+12+4'), false);
});
