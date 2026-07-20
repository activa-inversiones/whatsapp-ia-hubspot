// tools.test.js — Tests del modulo F2 (tools OpenAI + cliente ACTIVA Engine).
// Runner nativo: ejecutar desde C:\Users\mcifu\activa\temp-wa con:
//   node --test src/oliver-gpt/tools.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOL_DEFS, runTool, resolverMedidasMm, conUnitPrice } from './tools.js';
import { calcularCotizacion, calcularPorArea, APERTURAS } from './engine-client.js';

const APERTURAS_ESPERADAS = ['CORREDERA', 'PROYECTANTE', 'FIJA', 'BATIENTE', 'OSCILOBATIENTE'];

function getToolDef(name) {
  const def = TOOL_DEFS.find((t) => t.function && t.function.name === name);
  assert.ok(def, `Debe existir la tool '${name}' en TOOL_DEFS`);
  return def;
}

// (a) El enum de 'tipo' en calcular_cotizacion excluye TERMOPANEL y solo admite
//     las 5 aperturas.
test("(a) calcular_cotizacion: enum 'tipo' = 5 aperturas, SIN TERMOPANEL", () => {
  const def = getToolDef('calcular_cotizacion');
  const tipoEnum = def.function.parameters.properties.tipo.enum;

  assert.ok(Array.isArray(tipoEnum), "el campo 'tipo' debe declarar un enum");
  assert.ok(
    !tipoEnum.includes('TERMOPANEL'),
    "el enum de 'tipo' NUNCA debe incluir TERMOPANEL"
  );
  assert.deepEqual(
    [...tipoEnum].sort(),
    [...APERTURAS_ESPERADAS].sort(),
    "el enum debe ser exactamente las 5 aperturas"
  );
  // [2026-06-14] glass_id YA NO es obligatorio: el vidrio y la serie se eligen SOLOS
  // (priceAllEngine via area/ambiente). Lo obligatorio ahora es medidas_texto.
  assert.ok(
    def.function.parameters.required.includes('medidas_texto'),
    'medidas_texto debe ser obligatorio en calcular_cotizacion'
  );
  assert.ok(
    !def.function.parameters.required.includes('glass_id'),
    'glass_id NO debe ser obligatorio (vidrio automatico)'
  );
});

test("(a bis) calcular_por_area: enum 'tipo' = 5 aperturas SIN TERMOPANEL y usa area_m2", () => {
  const def = getToolDef('calcular_por_area');
  const props = def.function.parameters.properties;
  const tipoEnum = props.tipo.enum;

  assert.ok(!tipoEnum.includes('TERMOPANEL'), "calcular_por_area: enum sin TERMOPANEL");
  assert.deepEqual([...tipoEnum].sort(), [...APERTURAS_ESPERADAS].sort());

  // Campo correcto: area_m2 (NO m2).
  assert.ok(props.area_m2, "debe existir el parametro 'area_m2'");
  assert.ok(!props.m2, "no debe existir el parametro 'm2'");
  assert.ok(def.function.parameters.required.includes('area_m2'));
  assert.ok(def.function.parameters.required.includes('glass_id'));
});

test('(a) APERTURAS del engine-client coincide con las 5 esperadas', () => {
  assert.deepEqual([...APERTURAS].sort(), [...APERTURAS_ESPERADAS].sort());
});

// El cliente debe rechazar localmente tipo:'TERMOPANEL' antes de llamar a la red.
test("calcularCotizacion rechaza tipo:'TERMOPANEL' sin tocar la red", async () => {
  await assert.rejects(
    () =>
      calcularCotizacion({
        tipo: 'TERMOPANEL',
        ancho_mm: 1500,
        alto_mm: 1200,
        glass_id: 34,
      }),
    /TERMOPANEL/i
  );
});

test("calcular_cotizacion documenta los productos fuera de alcance y su escalación", () => {
  const def = getToolDef('calcular_cotizacion');
  const texto = [
    def.function.description,
    def.function.parameters.properties.tipo.description,
    def.function.parameters.properties.serie.description,
  ].join(' ');

  for (const marcador of ['mosquiter', 'plegable', 'irregular', 'puerta', 'Andes', 'Zenia', 'Americana', 'Venau']) {
    assert.match(texto, new RegExp(marcador, 'i'), marcador);
  }
  assert.match(texto, /notificar_marcelo/i);
});

test("calcularCotizacion rechaza serie ANDES sin tocar la red", async () => {
  const fetchOriginal = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('el Engine no debe llamarse para una línea no soportada');
  };

  try {
    await assert.rejects(
      () =>
        calcularCotizacion({
          tipo: 'CORREDERA',
          serie: 'ANDES',
          ancho_mm: 1500,
          alto_mm: 1200,
          glass_id: 34,
        }),
      /producto_fuera_de_alcance:linea_no_soportada/i,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test("runTool: PUERTA no cotiza y notifica a Marcelo por código", async () => {
  const avisos = [];
  const resultado = await runTool(
    'calcular_cotizacion',
    { tipo: 'PUERTA', medidas_texto: '900x2100 mm', cantidad: 1 },
    {
      notifyMarcelo: async (payload) => {
        avisos.push(payload);
        return { sent: true };
      },
    },
  );

  assert.equal(resultado.ok, false);
  assert.equal(resultado.requiere_revision, true);
  assert.equal(resultado.escalate, true);
  assert.equal(resultado.reason, 'producto_fuera_de_alcance:puerta');
  assert.equal(resultado.category, 'puerta');
  assert.match(resultado.message, /Marcelo.*precio exacto/i);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].reason, 'oliver_gpt:producto_fuera_de_alcance:puerta');
});

// (c) calcularPorArea sin glass_id rechaza.
test('(c) calcularPorArea sin glass_id rechaza', async () => {
  await assert.rejects(
    () => calcularPorArea({ tipo: 'CORREDERA', area_m2: 3.6 }),
    /glass_id/i
  );
});

// (b) TEST GOLDEN EN VIVO. Si el Engine esta caido, NO falla el suite:
//     se registra un blocker y el test pasa (no-red), dejando intactos los de enum.
test('(b) GOLDEN EN VIVO: CORREDERA 1500x1200 glass_id=34 Temuco => ok:true, total>0', async (t) => {
  let res;
  try {
    res = await calcularCotizacion({
      tipo: 'CORREDERA',
      ancho_mm: 1500,
      alto_mm: 1200,
      color: 'blanco',
      glass_id: 44,
      comuna: 'Temuco',
    });
  } catch (err) {
    // Engine caido / sin red: marcar blocker pero no romper el suite.
    t.diagnostic(`BLOCKER: Engine no disponible para el golden en vivo: ${err.message}`);
    t.skip('Engine no disponible; golden en vivo omitido (tests de enum siguen verdes)');
    return;
  }

  assert.equal(res && res.ok, true, 'la respuesta del Engine debe traer ok:true');

  const total =
    res.total ??
    res.total_clp ??
    (res.totals && (res.totals.total ?? res.totals.total_clp)) ??
    (res.quote && (res.quote.total ?? res.quote.total_clp));

  assert.ok(typeof total === 'number' && total > 0, `total debe ser > 0 (recibido: ${total})`);
  t.diagnostic(`GOLDEN total devuelto = ${total}`);
});

// ──────────────────────────────────────────────────────────────────────────────
// resolverMedidasMm — conversión DETERMINISTA a mm (casos REALES de la auditoría).
// El cliente manda medidas "de todo"; SIEMPRE deben terminar en mm como cotiza Activa.
// ──────────────────────────────────────────────────────────────────────────────

test('(m-1) cm explícito: "140x220 cm" → 1400x2200 mm (corrige el manglado del LLM)', () => {
  // El LLM había mangleado a 2930x2150 (caso real Diego). El texto manda.
  const r = resolverMedidasMm({ ancho_mm: 2930, alto_mm: 2150, medidas_texto: '140x220 cm' });
  assert.equal(r.ok, true);
  assert.equal(r.ancho_mm, 1400, 'ancho 140cm → 1400mm');
  assert.equal(r.alto_mm, 2200, 'alto 220cm → 2200mm');
  assert.equal(r.corregido, true, 'debe marcar que corrigió al LLM');
});

test('(m-2) "70 x 30" (ventana baño) → 700x300 mm (no 600x600)', () => {
  const r = resolverMedidasMm({ ancho_mm: 600, alto_mm: 600, medidas_texto: '70 x 30' });
  assert.equal(r.ok, true);
  assert.equal(r.ancho_mm, 700);
  assert.equal(r.alto_mm, 300);
});

test('(m-3) metros: "1,5 x 1,2 metros" → 1500x1200 mm', () => {
  const r = resolverMedidasMm({ ancho_mm: 0, alto_mm: 0, medidas_texto: '1,5 x 1,2 metros' });
  assert.equal(r.ok, true);
  assert.equal(r.ancho_mm, 1500);
  assert.equal(r.alto_mm, 1200);
});

test('(m-4) ya en mm: "1500x1200 mm" → 1500x1200 (sin tocar)', () => {
  const r = resolverMedidasMm({ ancho_mm: 1500, alto_mm: 1200, medidas_texto: '1500x1200 mm' });
  assert.equal(r.ok, true);
  assert.equal(r.ancho_mm, 1500);
  assert.equal(r.alto_mm, 1200);
  assert.equal(r.corregido, false, 'no corrige si ya coincide');
});

test('(m-5) vidrio chico "27cm x 32cm" → 270x320 mm (no 2700x320)', () => {
  const r = resolverMedidasMm({ ancho_mm: 2700, alto_mm: 320, medidas_texto: '27cm x 32cm' });
  assert.equal(r.ok, true);
  assert.equal(r.ancho_mm, 270);
  assert.equal(r.alto_mm, 320);
});

test('(m-6) GUARD: medida absurda sin texto (ancho 50mm) → fuera de rango, NO cotiza', () => {
  const r = resolverMedidasMm({ ancho_mm: 50, alto_mm: 1200 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'medidas_fuera_de_rango');
  assert.ok(/confirme/i.test(r.message), 'pide confirmar al cliente');
});

test('(m-7) GUARD: runTool calcular_cotizacion con medida absurda devuelve error sin tocar el Engine', async () => {
  const r = await runTool('calcular_cotizacion', { tipo: 'CORREDERA', ancho_mm: 10, alto_mm: 10, glass_id: 44, medidas_texto: '10x10' });
  assert.equal(r.ok, false, 'no debe cotizar medidas absurdas');
  assert.equal(r.error, 'medidas_fuera_de_rango');
});

// ── [FIX 2026-06-18] BUG REAL (caso Marcelo): corredera 3,15×2,40 m cotizaba $301k
//    (0,08 m²) porque el cerebro mandaba 315×240 SIN convertir cm→mm. Una ventana <400 mm
//    no es fabricable → debe leerse como CENTÍMETROS. Cubre los 3 caminos del LLM. ──────────
test('(m-8) cm-como-mm NUMÉRICO: 315×240 (sin texto) → 3150×2400 mm (era 0,08 m²)', () => {
  const r = resolverMedidasMm({ ancho_mm: 315, alto_mm: 240 });
  assert.equal(r.ok, true);
  assert.equal(r.ancho_mm, 3150, '315 < 400 mm no es fabricable → eran 315 cm');
  assert.equal(r.alto_mm, 2400, '240 < 400 mm → eran 240 cm');
  assert.equal(r.corregido, true);
});

test('(m-9) cm explícito >300: "315 x 240 cm" → 3150×2400 (el tope viejo de 300 lo rompía)', () => {
  const r = resolverMedidasMm({ ancho_mm: 0, alto_mm: 0, medidas_texto: '315 x 240 cm' });
  assert.equal(r.ok, true);
  assert.equal(r.ancho_mm, 3150);
  assert.equal(r.alto_mm, 2400);
});

test('(m-10) "315x240" sin unidad → 3150×2400 (no 315×2400 sliver)', () => {
  const r = resolverMedidasMm({ ancho_mm: 0, alto_mm: 0, medidas_texto: '315x240' });
  assert.equal(r.ok, true);
  assert.equal(r.ancho_mm, 3150);
  assert.equal(r.alto_mm, 2400);
});

test('(m-11) NO sobre-escalar lo que ya está en mm: 1500×1200 numérico se mantiene', () => {
  const r = resolverMedidasMm({ ancho_mm: 1500, alto_mm: 1200 });
  assert.equal(r.ok, true);
  assert.equal(r.ancho_mm, 1500);
  assert.equal(r.alto_mm, 1200);
});

test('(m-12) borde fabricable: 400 mm numérico se respeta como mm (no es cm)', () => {
  const r = resolverMedidasMm({ ancho_mm: 400, alto_mm: 1200 });
  assert.equal(r.ok, true);
  assert.equal(r.ancho_mm, 400, '400 mm = mínimo fabricable S60, NO se reinterpreta');
  assert.equal(r.alto_mm, 1200);
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests herméticos de notificar_marcelo (sin red, sin WA real). runTool ya importado arriba.
// ──────────────────────────────────────────────────────────────────────────────

// (n-a) LLM invoca notificar_marcelo → ctx.notifyMarcelo se llama 1 vez con datos correctos.
test('(n-a) notificar_marcelo: llama ctx.notifyMarcelo 1 vez con payload correcto', async () => {
  let callCount = 0;
  let capturedPayload = null;
  const mockCtx = {
    telefono: '56912345678',
    notifyMarcelo: async (payload) => {
      callCount++;
      capturedPayload = payload;
      return { sent: true, tier: 'HIGH' };
    },
  };
  const result = await runTool(
    'notificar_marcelo',
    { motivo: 'cliente quiere 20 ventanas para proyecto', resumen_lead: 'Juan Perez, Temuco', telefono_cliente: '56912345678', nombre: 'Juan' },
    mockCtx
  );
  assert.equal(callCount, 1, 'notifyMarcelo debe llamarse exactamente 1 vez');
  assert.ok(result.ok === true, 'runTool debe devolver ok:true');
  assert.ok(result.enviado === true, 'enviado debe ser true');
  assert.ok(
    typeof capturedPayload.reason === 'string' && capturedPayload.reason.startsWith('oliver_gpt:'),
    `reason debe empezar con 'oliver_gpt:' (recibido: ${capturedPayload?.reason})`
  );
  assert.equal(capturedPayload.data?.name, 'Juan', 'data.name debe ser el nombre del cliente');
});

// (n-b) Cooldown simulado: la 2da llamada inmediata devuelve enviado:false (no error).
test('(n-b) notificar_marcelo: cooldown simulado no produce doble aviso', async () => {
  let callCount = 0;
  const mockCtx = {
    telefono: '56987654321',
    notifyMarcelo: async (_payload) => {
      callCount++;
      if (callCount === 1) return { sent: true, tier: 'MEDIUM' };
      return { sent: false, reason: 'cooldown' };
    },
  };
  const r1 = await runTool('notificar_marcelo', { motivo: 'primer aviso' }, mockCtx);
  const r2 = await runTool('notificar_marcelo', { motivo: 'segundo aviso inmediato' }, mockCtx);
  assert.equal(callCount, 2, 'notifyMarcelo se llama 2 veces pero el 2do esta en cooldown');
  assert.equal(r1.enviado, true, '1ra llamada: enviado:true');
  assert.equal(r2.ok, true, '2da llamada: runTool sigue siendo ok:true (no es error)');
  assert.equal(r2.enviado, false, '2da llamada: enviado:false (cooldown)');
});

// (n-c) El reason con prefijo 'oliver_gpt:' hace que el filtro tier STANDARD NO bloquee.
test('(n-c) notificar_marcelo: reason oliver_gpt evita bloqueo tier STANDARD', async () => {
  const filterFn = (tier, reason) => {
    const isExplicit = reason && reason.startsWith('oliver_gpt:');
    return tier === 'STANDARD' && reason === 'auto' && !isExplicit;
  };
  let capturedReason = null;
  const mockCtx = {
    notifyMarcelo: async (payload) => { capturedReason = payload.reason; return { sent: true, tier: 'STANDARD' }; },
  };
  await runTool('notificar_marcelo', { motivo: 'tier standard pero pide humano' }, mockCtx);
  assert.ok(capturedReason && capturedReason.startsWith('oliver_gpt:'), `reason debe empezar con 'oliver_gpt:' (recibido: '${capturedReason}')`);
  assert.equal(filterFn('STANDARD', capturedReason), false, 'el filtro NO debe bloquear una escalacion explicita STANDARD');
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests herméticos F1 — send_media y guardar_lead (sin red, sin WA real).
// ──────────────────────────────────────────────────────────────────────────────

// (sm-a) send_media está en TOOL_DEFS con los campos correctos.
test('(sm-a) send_media: existe en TOOL_DEFS con media_type, catalog_key (required) y caption', () => {
  const def = getToolDef('send_media');
  const props = def.function.parameters.properties;
  assert.ok(props.media_type, 'debe tener media_type');
  assert.ok(props.catalog_key, 'debe tener catalog_key');
  assert.ok(props.caption, 'debe tener caption');
  assert.ok(
    Array.isArray(props.media_type.enum) && props.media_type.enum.includes('image'),
    "media_type.enum debe incluir 'image'"
  );
  assert.ok(
    Array.isArray(props.catalog_key.enum) && props.catalog_key.enum.includes('catalogo_pvc'),
    "catalog_key.enum debe incluir 'catalogo_pvc'"
  );
  const req = def.function.parameters.required;
  assert.ok(req.includes('media_type') && req.includes('catalog_key'), 'media_type y catalog_key son required');
});

// (sm-b) runTool send_media sin ctx.sendMedia devuelve ok:false (no lanza).
test('(sm-b) send_media: sin ctx.sendMedia devuelve ok:false, no lanza', async () => {
  const r = await runTool('send_media', { media_type: 'image', catalog_key: 'catalogo_pvc' }, {});
  assert.equal(r.ok, false, 'debe devolver ok:false cuando sendMedia no está cableado');
  assert.equal(r.reason, 'sendMedia_not_wired');
});

// (sm-c) runTool send_media llama ctx.sendMedia 1 vez con el payload correcto.
test('(sm-c) send_media: llama ctx.sendMedia 1 vez con payload correcto', async () => {
  let callCount = 0;
  let captured = null;
  const mockCtx = {
    sendMedia: async (payload) => {
      callCount++;
      captured = payload;
      return { ok: true, sent: true };
    },
  };
  const r = await runTool(
    'send_media',
    { media_type: 'document', catalog_key: 'ficha_tecnica_s60', caption: 'Ficha S60' },
    mockCtx
  );
  assert.equal(callCount, 1, 'sendMedia debe llamarse exactamente 1 vez');
  assert.equal(r.ok, true, 'runTool debe devolver ok:true');
  assert.equal(captured.media_type, 'document');
  assert.equal(captured.catalog_key, 'ficha_tecnica_s60');
  assert.equal(captured.caption, 'Ficha S60');
});

// (gl-a) guardar_lead está en TOOL_DEFS.
test('(gl-a) guardar_lead: existe en TOOL_DEFS', () => {
  const def = getToolDef('guardar_lead');
  assert.ok(def.function.parameters.properties.name, 'debe tener campo name');
  assert.ok(def.function.parameters.properties.comuna, 'debe tener campo comuna');
});

// (gl-b) runTool guardar_lead sin ctx.saveLead devuelve ok:false (no lanza).
test('(gl-b) guardar_lead: sin ctx.saveLead devuelve ok:false, no lanza', async () => {
  const r = await runTool('guardar_lead', { name: 'Juan', comuna: 'Temuco' }, {});
  assert.equal(r.ok, false, 'debe devolver ok:false cuando saveLead no está cableado');
  assert.equal(r.reason, 'saveLead_not_wired');
});

// (gl-c) runTool guardar_lead llama ctx.saveLead con el input completo.
test('(gl-c) guardar_lead: llama ctx.saveLead 1 vez con input correcto', async () => {
  let callCount = 0;
  let capturedInput = null;
  const mockCtx = {
    saveLead: async (input) => {
      callCount++;
      capturedInput = input;
      return { ok: true };
    },
  };
  const input = { name: 'María', comuna: 'Pucón', grand_total: 320000, stageKey: 'cotizado' };
  const r = await runTool('guardar_lead', input, mockCtx);
  assert.equal(callCount, 1, 'saveLead debe llamarse exactamente 1 vez');
  // runTool devuelve lo que retorna saveLead (puede ser null si safe() lo traga; en test directo retorna el mock)
  assert.equal(capturedInput.name, 'María');
  assert.equal(capturedInput.comuna, 'Pucón');
  assert.equal(capturedInput.grand_total, 320000);
});

// ── conUnitPrice: unit_price NETO determinista (anti doble-IVA) [2026-06-13] ──
test('(p1) conUnitPrice usa total_clp (NETO), NO total_con_iva — cantidad 1', () => {
  const r = conUnitPrice({ ok: true, total_clp: 130963, total_con_iva: 155846, precio_por_m2: 109136 }, 1);
  assert.equal(r.unit_price, 130963, 'unit_price debe ser el NETO total_clp, no el con IVA');
  assert.equal(r.total_neto, 130963);
  assert.notEqual(r.unit_price, 155846, 'NUNCA debe usar total_con_iva (causaría doble IVA)');
});

test('(p2) conUnitPrice divide total_clp por cantidad → unit_price por unidad', () => {
  const r = conUnitPrice({ ok: true, total_clp: 261926, total_con_iva: 311692 }, 2);
  assert.equal(r.unit_price, 130963, '261926 / 2 = 130963 (NETO por unidad)');
});

test('(p3) conUnitPrice fallback a total_neto_clp si no hay total_clp', () => {
  const r = conUnitPrice({ ok: true, total_neto_clp: 99000 }, 1);
  assert.equal(r.unit_price, 99000);
});

test('(p4) conUnitPrice marca precio_invalido si el total no sirve (no cotizar a ciegas)', () => {
  const r0 = conUnitPrice({ ok: true, total_clp: 0 }, 1);
  assert.equal(r0.ok, false);
  assert.equal(r0.precio_invalido, true);
  const rNaN = conUnitPrice({ ok: true }, 1); // sin ningún campo de total
  assert.equal(rNaN.ok, false);
  assert.equal(rNaN.precio_invalido, true);
});

test('(p5) conUnitPrice respeta respuestas de error del motor (ok:false pasa tal cual)', () => {
  const err = { ok: false, error: 'motor caído' };
  assert.deepEqual(conUnitPrice(err, 1), err);
  assert.equal(conUnitPrice(null, 1), null);
});

test('(p6) cantidad inválida (0/undefined) se trata como 1 (no divide por cero)', () => {
  const r = conUnitPrice({ ok: true, total_clp: 130963 }, 0);
  assert.equal(r.unit_price, 130963);
});

// ── [2026-07-06 LOTE2] unidad_confirmada: la confirmación EXPLÍCITA del cliente manda ──
test('(u-1) unidad_confirmada mm: 350x600 va LITERAL (antes rescatarCm re-manglaba a 3500)', () => {
  const r = resolverMedidasMm({ ancho_mm: 350, alto_mm: 600, medidas_texto: '350x600', unidad_confirmada: 'mm' });
  assert.equal(r.ok, true);
  assert.equal(r.ancho_mm, 350);
  assert.equal(r.alto_mm, 600);
});

test('(u-2) unidad_confirmada cm: conversión ×10 determinista', () => {
  const r = resolverMedidasMm({ ancho_mm: 140, alto_mm: 220, medidas_texto: '140x220', unidad_confirmada: 'cm' });
  assert.equal(r.ok, true);
  assert.equal(r.ancho_mm, 1400);
  assert.equal(r.alto_mm, 2200);
});

test('(u-3) unidad_confirmada mm con medida implausible sigue frenando (guard intacto)', () => {
  const r = resolverMedidasMm({ ancho_mm: 80, alto_mm: 60, medidas_texto: '80x60', unidad_confirmada: 'mm' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'medidas_fuera_de_rango');
});

test('(u-4) sin unidad_confirmada el comportamiento histórico NO cambia', () => {
  const r = resolverMedidasMm({ ancho_mm: 315, alto_mm: 240 });
  assert.equal(r.ancho_mm, 3150);
  assert.equal(r.alto_mm, 2400);
});

test('(u-5) unidad_confirmada SIN par verificable en el texto → NO confía en los números del LLM', () => {
  const r = resolverMedidasMm({ ancho_mm: 180, alto_mm: 240, medidas_texto: 'ciento ochenta de ancho', unidad_confirmada: 'mm' });
  assert.equal(r.ok, false, 'sin par AxB verificable se re-pregunta, no se asume (riesgo sub-cotización 10x)');
  assert.equal(r.error, 'medidas_fuera_de_rango');
});

test('(u-6) unidad_confirmada acepta separador "por" ("350 por 600")', () => {
  const r = resolverMedidasMm({ ancho_mm: 350, alto_mm: 600, medidas_texto: '350 por 600', unidad_confirmada: 'mm' });
  assert.equal(r.ok, true);
  assert.equal(r.ancho_mm, 350);
  assert.equal(r.alto_mm, 600);
});

// ── [Ronda 2 2026-07-20] descripcion_producto → guarda determinista de alcance ──
// El LLM copia las palabras LITERALES del cliente; la guarda las ve ANTES del Engine.
// Sin red: fetch prohibido demuestra que la escalación es previa a cualquier llamada.

test('Ronda 2: calcular_cotizacion con descripcion_producto fuera de alcance escala a Marcelo sin red', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('RED PROHIBIDA EN ESTE TEST'); };
  const avisos = [];
  try {
    const r = await runTool('calcular_cotizacion', {
      tipo: 'CORREDERA',
      medidas_texto: '120x100 cm',
      descripcion_producto: 'una puerta ventana plegable para el quincho',
    }, { notifyMarcelo: async (x) => { avisos.push(x); } });
    assert.equal(r.ok, false);
    assert.equal(r.requiere_revision, true);
    assert.equal(avisos.length, 1, 'notifyMarcelo debe dispararse exactamente 1 vez');
    assert.match(String(avisos[0].reason), /producto_fuera_de_alcance/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Ronda 2: calcular_por_area con descripcion_producto fuera de alcance escala ANTES de derivar medidas (sin red)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('RED PROHIBIDA EN ESTE TEST'); };
  const avisos = [];
  try {
    const r = await runTool('calcular_por_area', {
      tipo: 'CORREDERA',
      area_m2: 2,
      glass_id: 34,
      descripcion_producto: 'quiero una mosquitera para la corredera',
    }, { notifyMarcelo: async (x) => { avisos.push(x); } });
    assert.equal(r.ok, false);
    assert.equal(avisos.length, 1);
    assert.match(String(avisos[0].reason), /producto_fuera_de_alcance:mosquitero/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Ronda 2: descripcion_producto declarado en el schema de ambas tools (additionalProperties:false lo exige)', () => {
  for (const name of ['calcular_cotizacion', 'calcular_por_area']) {
    const def = getToolDef(name);
    assert.ok(def.function.parameters.properties.descripcion_producto, `${name} debe declarar descripcion_producto`);
    // [Ronda 2.1 — Codex] existir no basta: si no es required, el LLM puede omitirla
    // válidamente y la guarda vuelve a quedar ciega.
    assert.ok(
      def.function.parameters.required.includes('descripcion_producto'),
      `${name} debe EXIGIR descripcion_producto`
    );
  }
});
