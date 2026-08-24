// informeTermico.cableado.test.js — [2026-08-21]
//
// El modulo informeTermico.js ya tiene sus 26 tests. ESTE prueba otra cosa: que este
// CABLEADO donde tiene que estar. Un modulo perfecto que nadie llama no le sirve a nadie —
// es exactamente lo que paso con el reporte de costo de Oliver, que estuvo tres semanas
// "conectado" sin guardar una sola fila.
//
// Se verifica sobre la fuente porque el cableado son dos puntos de union entre archivos
// (tools.js dispara, webhook.js provee), y no hay forma de observarlos sin levantar el bot.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const leer = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

test('calcular_cotizacion DISPARA el informe — es el momento en que el cliente espera', async () => {
  const src = await leer('../src/oliver-gpt/tools.js');
  const bloque = src.slice(src.indexOf("case 'calcular_cotizacion'"), src.indexOf("case 'calcular_por_area'"));
  assert.match(bloque, /ctx\?\.enviarInformeTermico/,
    'sin esto el informe existe pero nadie lo manda');
  assert.match(bloque, /ctx\.enviarInformeTermico\(input\.comuna \|\| '',/,
    'tiene que pasarle la comuna capturada, no inventar una');
});

test('🔒 el disparo NO puede frenar ni demorar la cotizacion', async () => {
  const src = await leer('../src/oliver-gpt/tools.js');
  const bloque = src.slice(src.indexOf("case 'calcular_cotizacion'"), src.indexOf("case 'calcular_por_area'"));
  // La llamada pasó a ser MULTILÍNEA (lleva el vidrio y el Uw del cliente), así que ya no
  // sirve mirar una sola línea: se inspecciona el trozo completo alrededor.
  const i = bloque.indexOf('ctx.enviarInformeTermico(');
  assert.ok(i > 0, 'no se encontro la llamada');
  const trozo = bloque.slice(Math.max(0, i - 140), i + 340);
  assert.doesNotMatch(trozo, /await ctx\.enviarInformeTermico/,
    'con await, un THERMAL lento demoraria el precio del cliente');
  assert.match(trozo, /try \{/, 'tiene que ir dentro de un try');
  assert.match(trozo, /\} catch \{/, 'una excepcion aca no puede tumbar la cotizacion');
});

test('el disparo va DESPUES de que la cotizacion salio bien, no antes', async () => {
  // Si se disparara antes del guard de `unit_price > 0`, se le mandaria un informe a alguien
  // a quien despues no se le puede cotizar. Prometer y no cumplir es peor que no prometer.
  const src = await leer('../src/oliver-gpt/tools.js');
  const bloque = src.slice(src.indexOf("case 'calcular_cotizacion'"), src.indexOf("case 'calcular_por_area'"));
  const iFallo = bloque.indexOf('return falloDeCotizacion');
  const iInforme = bloque.indexOf('ctx.enviarInformeTermico');
  assert.ok(iFallo > 0 && iInforme > iFallo,
    'el informe tiene que ir despues del guard de fallo de cotizacion');
});

test('webhook.js PROVEE el hook, con candado de una sola vez por cliente', async () => {
  const src = await leer('../src/oliver-gpt/webhook.js');
  assert.match(src, /enviarInformeTermico: \(comuna, \{ forzar/, 'el hook tiene que estar en toolCtx');
  assert.match(src, /informe_termico:\$\{String\(from\)/, 'el candado va por telefono');
  assert.match(src, /30 \* 24 \* 3600/, 'candado de 30 dias: un informe repetido es spam');
});

test('🔒 el candado se marca DESPUES del envio, no antes', async () => {
  // Si se marcara antes y el envio fallara, el cliente se quedaria sin informe para siempre.
  const src = await leer('../src/oliver-gpt/webhook.js');
  const i = src.indexOf('enviarInformeTermico: (comuna,');
  const bloque = src.slice(i, i + 11500);
  const iEnvio = bloque.indexOf('sendWaDocument(from, mediaId');
  const iMarca = bloque.indexOf('escribirEstado)(clave, true');
  assert.ok(iEnvio > 0, 'no se encontro el envio del PDF');
  assert.ok(iMarca > iEnvio, 'el candado se marca despues de enviar: si falla, se reintenta');
});

test('🔒 sin dato verificado NO se manda nada — son citas normativas', async () => {
  const src = await leer('../src/oliver-gpt/webhook.js');
  const i = src.indexOf('enviarInformeTermico: (comuna,');
  const bloque = src.slice(i, i + 11500);
  assert.match(bloque, /if \(!datos\) return;/, 'sin datos de THERMAL no se emite documento');
  assert.match(bloque, /if \(!pdfBuf\) return;/, 'si el PDF no se pudo armar, no se manda nada');
});

test('🔴 el informe se manda SIEMPRE al cotizar — es parte del proceso de venta', async () => {
  // Decision del dueno, textual: "no, siempre debe entregarlo — es parte del proceso de
  // venta". Estuvo un rato como tool a pedido y se revirtio a proposito.
  const src = await leer('../src/oliver-gpt/tools.js');
  const bloque = src.slice(src.indexOf("case 'calcular_cotizacion'"), src.indexOf("case 'calcular_por_area'"));
  assert.match(bloque, /ctx\.enviarInformeTermico\(input\.comuna \|\| '',/,
    'sin esto el informe solo saldria si alguien lo pide, y el dueno lo quiere SIEMPRE');
});

test('la tool de re-envio existe y SALTA el candado', async () => {
  // El candado de 30 dias evita spamear. Pero si el cliente PIDE el informe de nuevo
  // —"no me llego"— negarselo por el candado seria absurdo.
  const tools = await leer('../src/oliver-gpt/tools.js');
  assert.match(tools, /name: 'enviar_informe_termico'/);
  assert.match(tools, /ctx\.enviarInformeTermico\(input\.comuna \|\| '', \{ forzar: true \}\)/);
  const wh = await leer('../src/oliver-gpt/webhook.js');
  assert.match(wh, /enviarInformeTermico: \(comuna, \{ forzar = false/, 'el hook acepta forzar');
  assert.match(wh, /if \(!forzar\) \{/, 'el candado solo aplica al envio automatico');
});

test('se manda un PDF, no un mensaje de texto', async () => {
  const src = await leer('../src/oliver-gpt/webhook.js');
  const i = src.indexOf('enviarInformeTermico: (comuna,');
  const bloque = src.slice(i, i + 11500);
  assert.match(bloque, /generarInformeTermicoPdf/);
  assert.match(bloque, /uploadWaDocument\(pdfBuf, nombreArchivo\)/);
  assert.match(bloque, /sendWaDocument\(from, mediaId/);
});

test('el hook usa el nombre del cliente si lo hay', async () => {
  const src = await leer('../src/oliver-gpt/webhook.js');
  const i = src.indexOf('enviarInformeTermico: (comuna,');
  assert.match(src.slice(i, i + 11500), /nombre: state\.name \|\| ''/);
});

test('🔴 el informe lleva LA VENTANA DEL CLIENTE, no solo el catalogo', async () => {
  // El dueno lo cazo mirando el PDF: "entrego un informe tipo con muchos termopaneles".
  // Tenia razon: con los 10 vidrios y nada suyo, se lee como folleto. Ahora el vidrio y el
  // Uw que ACABAN de salir de la cotizacion viajan al informe y se destacan.
  const tools = await leer('../src/oliver-gpt/tools.js');
  assert.match(tools, /glassLabel: it\.glass_label/, 'el vidrio del cliente tiene que viajar');
  assert.match(tools, /uw: it\.termico\?\.uw/, 'y su Uw calculado');

  const wh = await leer('../src/oliver-gpt/webhook.js');
  assert.match(wh, /suVidrio: glassLabel, suUw: uw, suProducto: producto/);

  const pdf = await leer('./informeTermicoPdf.js');
  assert.match(pdf, /LA VENTANA DE SU COTIZACIÓN/, 'el bloque destacado con sus datos');
  assert.match(pdf, /CUMPLE/, 'el veredicto contra la exigencia de su comuna');
  // [2026-08-24] El catalogo de 10 vidrios MURIO por decision del dueno ("genera
  // desconfianza"): en su lugar va la figura del termopanel calculada por el motor + UNA
  // linea con el vidrio del cliente. El resaltado viejo (esSuVidrio) marcaba tres filas
  // y usaba un caracter que la fuente no dibuja — por eso se fue.
  assert.match(pdf, /mejorVidrio\(\)/, 'el vidrio del cliente se elige UNICO, no por startsWith');
  assert.doesNotMatch(pdf, /esSuVidrio\s*\(/, 'el resaltado triple no puede volver (la mencion en comentarios es historia, el uso no)');
  assert.match(pdf, /ANÁLISIS TÉRMICO DEL BORDE DE SU TERMOPANEL/, 'la seccion nueva existe');
});

test('🔴 RITMO HUMANO: aviso primero, espera larga despues, y recien el PDF', async () => {
  // Correccion del dueno: "no puede ser inmediato, el informe debe verse real". Nadie
  // redacta un informe con citas normativas en 6 segundos; si aparece al toque se lee como
  // autoresponder y se anula el efecto de que lo preparo un profesional.
  const wh = await leer('../src/oliver-gpt/webhook.js');
  const i = wh.indexOf('enviarInformeTermico: (comuna,');
  const bloque = wh.slice(i, i + 11500);

  const iAviso   = bloque.indexOf('ms: DEMORA_AVISO_MS');
  const iMensaje = bloque.indexOf('Deme un momento');
  const iEspera  = bloque.indexOf('await esperarAntesDeEnviar({ dormir: deps.dormir || null });');
  const iPdf     = bloque.indexOf('sendWaDocument(from, mediaId');

  assert.ok(iAviso > 0 && iMensaje > iAviso, 'primero la espera corta, despues el aviso');
  assert.ok(iEspera > iMensaje, 'la espera LARGA va despues del aviso, no antes');
  assert.ok(iPdf > iEspera, 'el PDF va al final de todo');
  assert.match(bloque, /mantenerEscribiendo\(msgId\)/, 'los puntitos vivos durante la espera larga');
  assert.match(bloque, /finally \{/, 'los puntitos se apagan pase lo que pase');
});

test('los dos tiempos son configurables y estan topados', async () => {
  const src = await leer('./informeTermico.js');
  assert.match(src, /INFORME_AVISO_MS \|\| 4000/);
  assert.match(src, /INFORME_DEMORA_MS \|\| 35000/, 'el default tiene que sentirse humano');
  assert.match(src, /Math\.min\(Number\(ms\), 90000\)/,
    'un valor mal escrito no puede dejar a un cliente esperando eternamente');
});

// ── [2026-08-24] REGISTRO ISO del informe entregado (CM-FR-006) ───────────────────────
// Pedido del dueno: "mismo procedimiento de la cotizacion, debe haber registro".

test('el correlativo se pide ANTES de generar el PDF y va estampado', async () => {
  const wh = await leer('../src/oliver-gpt/webhook.js');
  const i = wh.indexOf("enviarInformeTermico: (comuna,");
  const bloque = wh.slice(i, i + 11500);
  const iNum = bloque.indexOf('/internal/informes/next-number');
  const iPdf = bloque.indexOf('generarInformeTermicoPdf(');
  assert.ok(iNum > 0, 'sin correlativo no hay procedimiento ISO');
  assert.ok(iNum < iPdf, 'el numero se pide ANTES del PDF, igual que la cotizacion');
  assert.ok(bloque.includes('numeroInforme,'), 'y viaja al PDF para quedar impreso');

  const pdf = await leer('./informeTermicoPdf.js');
  assert.ok(pdf.includes('Informe N° '), 'el documento muestra su numero');
});

test('si sales-os no contesta, el fallback se DISTINGUE (INF-LOCAL-), no se disfraza', async () => {
  const wh = await leer('../src/oliver-gpt/webhook.js');
  const j = wh.indexOf("enviarInformeTermico: (comuna,");
  const bloque = wh.slice(j, j + 11500);
  assert.ok(bloque.includes('INF-LOCAL-'),
    'un numero fuera de secuencia tiene que VERSE fuera de secuencia en la auditoria');
});

test('el registro va DESPUES del envio: registrar algo que no salio es mentirle a la auditoria', async () => {
  const wh = await leer('../src/oliver-gpt/webhook.js');
  const j = wh.indexOf("enviarInformeTermico: (comuna,");
  const bloque = wh.slice(j, j + 11500);
  const iEnvio = bloque.indexOf('sendWaDocument(from, mediaId');
  const iCandado = bloque.indexOf('escribirEstado)(clave, true');
  const iReg = bloque.indexOf('/internal/informes/registrar');
  assert.ok(iEnvio > 0 && iReg > iEnvio, 'primero sale el documento, despues se registra');
  assert.ok(iReg > iCandado, 'y despues del candado: el registro jamas frena la entrega');
  // el gate ahora vive ANTES (if (!entregado) return) — lo cubre el test del P1 de Codex
  assert.ok(bloque.indexOf('if (!entregado)') < iCandado, 'el gate de entrega corta antes del candado');
});

test('el registro lleva el sha256 del PDF exacto que salio', async () => {
  const wh = await leer('../src/oliver-gpt/webhook.js');
  const j = wh.indexOf("enviarInformeTermico: (comuna,");
  const bloque = wh.slice(j, j + 11500);
  assert.ok(bloque.includes("createHash('sha256').update(pdfBuf).digest('hex')"),
    'el hash identifica el documento byte a byte: es la evidencia');
  assert.ok(bloque.includes('pdf_bytes: pdfBuf.length'));
});

test('si el registro falla se dice EN VOZ ALTA y el cliente NO pierde su informe', async () => {
  const wh = await leer('../src/oliver-gpt/webhook.js');
  const j = wh.indexOf("enviarInformeTermico: (comuna,");
  const bloque = wh.slice(j, j + 11500);
  assert.ok(bloque.includes('SIN registro ISO'),
    'el silencio es la clase de bug que ya costo 3 semanas en costGuard');
  const iReg = bloque.indexOf('/internal/informes/registrar');
  const cola = bloque.slice(iReg);
  assert.ok(cola.includes('} catch (e) {') && cola.includes('el cliente YA tiene su informe'),
    'la falla del registro se captura y se reporta, no tumba nada');
});

test('🔴 [P1 · Codex] mediaId NO prueba entrega: el candado y el registro exigen envio.ok', async () => {
  // sendWaDocument devuelve {ok:false} SIN lanzar cuando Meta rechaza. Antes se marcaba el
  // candado igual: cliente sin documento, sin reintento en 30 dias, y evidencia ISO de algo
  // que nunca salio. Ahora todo lo posterior al envio cuelga de envio.ok === true.
  const wh = await leer('../src/oliver-gpt/webhook.js');
  const j = wh.indexOf("enviarInformeTermico: (comuna,");
  const bloque = wh.slice(j, j + 11000);
  const iGate = bloque.indexOf('envio.ok === true');
  const iCandado = bloque.indexOf("escribirEstado)(clave, true");
  const iReg = bloque.indexOf('/internal/informes/registrar');
  assert.ok(iGate > 0, 'el gate de entrega existe');
  assert.ok(iGate < iCandado && iGate < iReg, 'candado y registro van DESPUES del gate');
  assert.ok(bloque.includes('if (!entregado)'), 'sin entrega: return, sin candado y sin registro');
});
