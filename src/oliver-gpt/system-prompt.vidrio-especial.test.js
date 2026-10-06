// src/oliver-gpt/system-prompt.vidrio-especial.test.js
// Runner nativo: node --test src/oliver-gpt/system-prompt.vidrio-especial.test.js
//
// [2026-10-05] VIDRIO ESPECIAL (#1092) y BAÑO (#1105) — decisiones del dueño, ~20:30 de ese día.
//
// EL DEFECTO (medido en 90 días, propuesta de plata con MEDICION): Oliver ofreció o afirmó Low-E en
// 10 conversaciones y 9 terminaron en una propuesta con vidrio ESTÁNDAR. Frases reales: «fabricamos
// ventanas PVC termopanel con vidrio Low-E», «ya tengo listas ambas propuestas: la estándar y la
// versión con vidrio Low-E» (esa segunda NO existía), «Sí, trabajamos con termopanel Low-E».
// La causa estaba ESCRITA en este prompt desde el 03-jun: mandaba recomendar Low-E por el frío y
// enseñaba que la «L» de TP-M-5+8+6L indica Low-E (en el catálogo esos ids dicen «Lam. 6mm»:
// laminado) con una mejora «30-40 %» sin fuente. Además `listar_vidrios` se mandaba usar mientras
// tools.js (calcular_cotizacion) decía «el vidrio se elige solo; NO uses listar_vidrios».
//
// DECISIÓN DEL DUEÑO (textual): «Low-E: sí, lo conseguimos». Cuando el cliente lo pregunta o lo pide,
// Oliver dice que SÍ se hace y que se cotiza APARTE; la propuesta automática va con el termopanel
// estándar y se lo dice; Oliver avisa a Marcelo con el folio (notificar_marcelo). Nunca afirma una
// propuesta con Low-E ni da porcentajes. Templado, control solar y demás especiales NO están
// confirmados: «lo consulto con el Ing. Marcelo» + aviso. El motor cotizará Low-E más adelante (otro
// frente, en sales-os): NO se hace acá.
// Y «baño: preguntar solo cuando aplica»: con varias ventanas Oliver pregunta cuál va en el baño y a
// ESA le pone ambiente «baño»; con una sola no pregunta.
//
// ⚠️ LÍMITE DE ESTOS TESTS, dicho de frente: la conducta del LLM no se puede testear de forma
// determinística. Lo primero (A) FIJA EL CONTRATO DEL PROMPT: que el texto que Oliver lee no vuelva a
// enseñarle lo falso ni a contradecir a tools.js, y que la regla del dueño esté escrita. Lo segundo
// (B) prueba el CAMINO TÉCNICO: que `ambiente:"baño"` llegue al motor como vidrio satén, por ventana.
// Que el modelo OBEDEZCA queda sin probar (lo mide la muestra de conversaciones reales, no un test).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSystemBlocks } from './system-prompt.js';
import { TOOL_DEFS, runTool } from './tools.js';
import { itemsFromQuoteCalls } from './pdf-intent.js';

/** El texto desde `ancla` hasta `fin` (o `largo` caracteres): el bloque de UNA regla, no todo el prompt. */
function bloque(sys, ancla, { fin = null, largo = 2600 } = {}) {
  const i = sys.indexOf(ancla);
  assert.ok(i >= 0, `falta el bloque «${ancla}» en el prompt`);
  const resto = sys.slice(i, i + largo);
  if (!fin) return resto;
  const j = resto.indexOf(fin);
  return j > 0 ? resto.slice(0, j) : resto;
}

/**
 * Afirma que `re` NO calza en `texto`. En vez de assert.doesNotMatch porque este imprime el prompt ENTERO (~60 KB)
 * en cada fallo: acá el mensaje trae solo el fragmento que calzó.
 */
function noHay(texto, re, mensaje) {
  const m = texto.match(re);
  assert.ok(!m, `${mensaje} — calzó: «${m && m[0].replace(/\s+/g, ' ').slice(0, 160)}»`);
}

const getToolDef = (name) => {
  const def = TOOL_DEFS.find((t) => t.function && t.function.name === name);
  assert.ok(def, `Debe existir la tool '${name}' en TOOL_DEFS`);
  return def;
};

/* =========================================================================
 * A) EL CONTRATO DEL PROMPT
 * ========================================================================= */

test('🔴 A1 el prompt NO enseña que la "L" del código de vidrio indica Low-E (es LAMINADO en el catálogo)', () => {
  const sys = buildSystemBlocks();
  noHay(sys, /la\s+["“”«']?L["“”»']?\s+indica\s+Low-?E/i,
    'falso: en el catálogo TP-M-5+8+6L y TP-M-6+10+6L dicen «Lam. 6mm» (laminado), no Low-E');
  noHay(sys, /TP-M-\d+\+\d+\+\d+L\b/,
    'los códigos de vidrio laminado no pueden figurar en el prompt como si fueran Low-E');
});

test('🔴 A2 el prompt NO inventa porcentajes ni cifras de mejora para Low-E ni para los vidrios especiales', () => {
  const sys = buildSystemBlocks();
  noHay(sys, /30\s*[-–]\s*40\s*%/, 'la cifra «30-40 %» no tiene fuente que alguien haya encontrado');
  // Ninguna cifra de % ni de dB a menos de ~120 caracteres de un vidrio especial (control solar «~40 %»,
  // laminado «98 % de UV», asimétrico «35 dB»): el dueño NO confirmó que esos vidrios se hagan.
  const cifra = /(?:low-?e|control solar|asim[eé]trico|laminad|selective)[^]{0,120}?\d+\s*(?:[-–]\s*\d+\s*)?(?:%|dB)/i;
  const hit = sys.match(cifra);
  assert.equal(hit, null, `cifra de mejora de un vidrio especial en el prompt: «${hit && hit[0].replace(/\s+/g, ' ')}»`);
});

test('🔴 A3 el prompt NO manda recomendar Low-E por el frío, ni ofrecerlo como opción, ni darlo por incluido', () => {
  const sys = buildSystemBlocks();
  noHay(sys, /opci[oó]n\s+Low-?E/i, 'Área 10: «Termopanel base + opción Low-E» (frío) es la fuente de la promesa');
  noHay(sys, /una cara con Low-?E/i, 'la frase modelo que ofrecía «sumarle una cara con Low-E»');
  noHay(sys, /fr[ií]o\s*(?:→|->)\s*Low-?E/i, 'Operativas: «frío→Low-E»');
  noHay(sys, /Educar si aplica \(Low-?E/i, 'Área 15 paso 4: educar con Low-E / Control Solar como si estuvieran');
});

test('✅ A4 la regla del dueño está escrita: Low-E SÍ se hace, se cotiza APARTE, la propuesta va estándar y se avisa a Marcelo con el folio', () => {
  const regla = bloque(buildSystemBlocks(), 'REGLA DE VIDRIOS ESPECIALES', { fin: '\n\n' });
  assert.match(regla, /Low-?E/);
  assert.match(regla, /S[ÍI] se hace/i, 'al cliente se le dice que SÍ se hace (el dueño: «lo conseguimos»)');
  assert.match(regla, /\bAPARTE\b/, 'se cotiza APARTE');
  assert.match(regla, /est[aá]ndar/i, 'la propuesta automática va con el termopanel estándar y el cliente lo sabe');
  assert.match(regla, /notificar_marcelo/, 'el aviso usa la herramienta que ya existe');
  assert.match(regla, /folio/i, 'el aviso lleva el folio para que el dueño ponga el precio');
  assert.match(regla, /NUNCA[^.\n]*(?:propuesta|versi[oó]n)[^.\n]*Low-?E/i,
    'NUNCA afirma que hizo una propuesta con Low-E (caso 13d08925: «ya tengo listas ambas propuestas»)');
  assert.match(regla, /NUNCA[^.\n]*(?:porcentaj|cifra)/i, 'NUNCA da porcentajes de mejora inventados');
  assert.match(regla, /NO ofrezca ni recomiende[^.\n]*iniciativa propia/i, 'NO lo recomienda por iniciativa propia');
});

test('✅ A5 templado, control solar y demás especiales NO están confirmados: se consultan con Marcelo, no se prometen', () => {
  const regla = bloque(buildSystemBlocks(), 'REGLA DE VIDRIOS ESPECIALES', { fin: '\n\n' });
  assert.match(regla, /templado/i);
  assert.match(regla, /control solar/i);
  assert.match(regla, /NO ha confirmado/i, 'el prompt dice por qué: el dueño no los confirmó');
  assert.match(regla, /lo consulto con el Ing\. Marcelo/i);
  assert.match(regla, /no los prometa/i);
});

test('✅ A6 el aviso reusa notificar_marcelo, que existe y exige solo el motivo', () => {
  const def = getToolDef('notificar_marcelo');
  assert.ok(def.function.parameters.required.includes('motivo'));
  assert.ok(def.function.parameters.properties.resumen_lead, 'el folio puede viajar en resumen_lead además del motivo');
});

test('🔴 A7 no hay contradicción con tools.js: el prompt NUNCA manda usar listar_vidrios', () => {
  const sys = buildSystemBlocks();
  const re = /listar_vidrios/g;
  let m;
  let n = 0;
  while ((m = re.exec(sys))) {
    n += 1;
    const antes = sys.slice(Math.max(0, m.index - 12), m.index);
    assert.match(antes, /\bNO\s+(?:uses?|usar)\s+$/i,
      `el prompt manda usar listar_vidrios (tools.js: «el vidrio se elige solo; NO uses listar_vidrios»): «…${antes}${m[0]}…»`);
  }
  assert.ok(n >= 1, 'el prompt tiene que PROHIBIR listar_vidrios al menos una vez (Área 6)');
  // Ancla de la autoridad: si tools.js suelta la prohibición, este test avisa que la contradicción puede volver.
  assert.match(getToolDef('calcular_cotizacion').function.description, /NO uses listar_vidrios/);
});

test('🔴 A8 no hay contradicción con tools.js: el prompt no exige glass_id para calcular_cotizacion', () => {
  const sys = buildSystemBlocks();
  noHay(sys, /tenga tipo, medidas y glass_id/i, 'Operativas :1052 mandaba esperar un glass_id');
  noHay(sys, /calcular_cotizacion requiere[^.\n]*glass_id/i, 'Operativas :1057 lo daba por obligatorio');
  const def = getToolDef('calcular_cotizacion');
  assert.ok(!def.function.parameters.required.includes('glass_id'), 'la herramienta no lo exige (vidrio automático)');
});

test('🚿 A9 la regla del baño está en el prompt: se pregunta cuál ventana SOLO si hay varias, y el ambiente va POR VENTANA', () => {
  const regla = bloque(buildSystemBlocks(), 'REGLA DEL BAÑO', { fin: '⛔ "CAMBIAR EL TERMOPANEL' });
  assert.match(regla, /¿Cu[aá]l de las ventanas va en el ba[ñn]o\?/i, 'la pregunta exacta que pidió el dueño');
  assert.match(regla, /ambiente:\s*["“]ba[ñn]o/i, 'el campo que llega al motor');
  assert.match(regla, /UNA sola ventana[^\n]*sin preguntar/i, 'con una sola ventana NO pregunta');
  assert.match(regla, /VARIAS ventanas/i);
  assert.match(regla, /SOLO en esa/i, 'solo a esa ventana');
  // [06-oct, tras Codex] Antes decía «NUNCA marque todas»; ahora la regla es más estricta: una mención suelta
  // («al lado del baño») no marca NADA y tampoco dispara la pregunta (Codex: preguntaba de más).
  assert.match(regla, /menci[oó]n suelta[^\n]*no pregunte ni marque nada/i, 'una mención suelta («al lado del baño») ni pregunta ni marca');
  assert.match(regla, /generar_pdf_cotizacion/, 'el ambiente se repite en el ítem del PDF (el PDF re-cotiza con él)');
});

/* =========================================================================
 * B) EL CAMINO TÉCNICO DEL BAÑO — caracterización: confirmar, no suponer
 *    calcular_cotizacion({ambiente:'baño'}) → priceAllEngine → pickGlassId → glass_id 1609 en el POST al motor.
 *    Estos tests están en VERDE desde el principio (el camino ya existía): no prueban código nuevo, FIJAN
 *    el camino para que un refactor no lo corte (ver la prueba de mutación en el informe).
 * ========================================================================= */

const GLASS_CLARO = 1607;   // 4+12+4 (< 2 m²)
const GLASS_SATEN = 1609;   // 4+12+4S (baño)

/** Corre runTool con un fetch espía y devuelve los bodies que el bot le mandó al motor. */
async function cotizarEspiando(llamadas) {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, opts) => {
    bodies.push(JSON.parse(opts.body));
    const payload = { ok: true, total_clp: 100000, producto_label: 'Proyectante S60', serie: 'S60' };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  try {
    const resultados = [];
    for (const input of llamadas) resultados.push(await runTool('calcular_cotizacion', input));
    return { bodies, resultados };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const VENTANA = { tipo: 'PROYECTANTE', medidas_texto: '60x50 cm', descripcion_producto: 'ventana proyectante', cantidad: 1 };

test('🚿 B1 calcular_cotizacion acepta `ambiente` en su esquema', () => {
  const props = getToolDef('calcular_cotizacion').function.parameters.properties;
  assert.equal(props.ambiente?.type, 'string');
  assert.match(props.ambiente.description, /ba[ñn]o/i);
});

test('🚿 B2 ambiente "baño" llega al motor como vidrio SATÉN (glass_id 1609); sin ambiente, claro (1607)', async () => {
  const { bodies, resultados } = await cotizarEspiando([
    { ...VENTANA, ambiente: 'baño' },
    { ...VENTANA },
  ]);
  assert.equal(resultados[0].ok, true, `debe cotizar: ${JSON.stringify(resultados[0])}`);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].glass_id, GLASS_SATEN, 'la ventana del baño va con el satén');
  assert.equal(bodies[1].glass_id, GLASS_CLARO, 'la misma ventana SIN ambiente va con el vidrio claro: el ambiente es lo único que cambia');
});

test('🚿 B3 el ambiente es POR VENTANA: no se filtra a la llamada siguiente ni lo activan otros recintos', async () => {
  const { bodies } = await cotizarEspiando([
    { ...VENTANA, ambiente: 'Baño' },          // mayúscula del cliente
    { ...VENTANA, ambiente: 'living' },        // otra ventana: NO es baño
    { ...VENTANA },                            // sin ambiente
    { ...VENTANA, ambiente: 'baño de visitas' },
  ]);
  assert.deepEqual(bodies.map((b) => b.glass_id), [GLASS_SATEN, GLASS_CLARO, GLASS_CLARO, GLASS_SATEN]);
});

test('🚿 B4 el ambiente de cada ventana viaja al PDF por ítem (itemsFromQuoteCalls), que re-cotiza con él', () => {
  const llamada = (input) => ({
    name: 'calcular_cotizacion',
    input,
    result: { ok: true, unit_price: 125062, cantidad: 1, producto_label: 'Proyectante S60', glass_label: '4+12+4', medidas_resueltas: '500x450mm' },
  });
  const items = itemsFromQuoteCalls([
    llamada({ ...VENTANA, ambiente: 'baño' }),
    llamada({ ...VENTANA }),
  ], 'Blanco');
  assert.equal(items.length, 2);
  assert.equal(items[0].ambiente, 'baño', 'la ventana del baño conserva su ambiente hasta el PDF');
  assert.equal(items[1].ambiente, '', 'la otra no lo hereda');
});
