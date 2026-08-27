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

/**
 * El cuerpo COMPLETO del hook `enviarInformeTermico`, cortado donde de verdad termina y no
 * a un largo estimado a ojo.
 *
 * 🔴 Las ventanas fijas (`src.slice(i, i + 13000)`) parecian practicas y salieron caras: cada
 * vez que el hook crecia, algun aserto quedaba FUERA de la ventana y el test cambiaba de
 * color sin que nadie tocara lo que probaba. El 24-ago paso tres veces en una sola sesion —y
 * la ultima estuvo a punto de tapar que un parche se habia llevado los DOS candados por
 * delante—. Un test que se rompe cuando crece el archivo de al lado no esta midiendo el
 * codigo: esta midiendo su propio numero magico.
 *
 * El corte va hasta el siguiente miembro de `toolCtx`, que es el unico limite real: dentro
 * del hook todo el codigo esta a 10 espacios o mas, y los miembros del objeto a 6.
 */
/**
 * Corta el trozo que va DESDE un texto HASTA otro. Existe porque en este archivo ya
 * fallaron CUATRO tests por medir la ventana de inspeccion en caracteres a ojo
 * (`i - 140`, `i + 340`, `i + 1400`, y un `indexOf` que devolvia -1): cada vez que alguien
 * agrega un comentario, la linea que se buscaba se corre fuera de la ventana y el test
 * falla o —peor— pasa por accidente.
 *
 * La distancia en caracteres no es una propiedad del codigo; la estructura si. Se corta
 * por el delimitador de cierre, que no se mueve cuando cambia la prosa de al lado.
 */
function trozo(texto, desde, hasta) {
  const i = texto.indexOf(desde);
  assert.ok(i >= 0, `no se encontro el inicio: ${desde}`);
  const j = texto.indexOf(hasta, i + desde.length);
  assert.ok(j > i, `no se encontro el cierre: ${hasta}`);
  return texto.slice(i, j + hasta.length);
}

/** Donde se genera el PDF. Ancla estable: la llamada real quedo inyectable por deps. */
function posicionDelPdf(bloque) {
  const i = bloque.indexOf('const pdfBuf = await');
  assert.ok(i > 0, 'no se encontro la generacion del PDF en el hook');
  return i;
}

// [2026-08-24 · rediseño] El cuerpo del envio ya no vive dentro del objeto `toolCtx`: se
// extrajo a `despacharInforme`, una funcion del turno que se llama UNA vez al final. El
// hook `enviarInformeTermico` quedo como un registrador de tres lineas.
function cuerpoDelHook(src) {
  const i = src.indexOf('const despacharInforme = (comuna,');
  assert.ok(i > 0, 'no se encontro despacharInforme en webhook.js');
  const j = src.indexOf('\n      };', i);
  assert.ok(j > i, 'no se encontro el cierre de despacharInforme');
  return src.slice(i, j);
}

/** El registrador que ven las tools (lo que antes era el hook completo). */
/** El hook de `toolCtx`, que quedo SOLO para el re-envio explicito (una linea). */
function hookDeToolCtx(src) {
  const i = src.indexOf('enviarInformeTermico: (comuna, opciones');
  assert.ok(i > 0, 'no se encontro el hook enviarInformeTermico en toolCtx');
  return src.slice(i, src.indexOf('\n', i) + 1);
}

test('webhook.js PROVEE el hook, con candado de una sola vez por cliente', async () => {
  const src = await leer('../src/oliver-gpt/webhook.js');
  assert.match(src, /enviarInformeTermico: \(comuna, opciones/, 'el hook tiene que estar en toolCtx');
  assert.match(src, /const despacharInforme = \(comuna,/, 'y el envio, en la funcion del turno');
  assert.match(src, /informe_termico:\$\{String\(from\)/, 'el candado va por telefono');
  assert.match(src, /30 \* 24 \* 3600/, 'candado de 30 dias: un informe repetido es spam');
});

test('🔒 el candado se marca DESPUES del envio, no antes', async () => {
  // Si se marcara antes y el envio fallara, el cliente se quedaria sin informe para siempre.
  const src = await leer('../src/oliver-gpt/webhook.js');
  const bloque = cuerpoDelHook(src);
  const iEnvio = bloque.indexOf('sendWaDocument(from, mediaId');
  const iMarca = bloque.indexOf('escribirEstado)(clave, { at: Date.now() }');
  assert.ok(iEnvio > 0, 'no se encontro el envio del PDF');
  assert.ok(iMarca > iEnvio, 'el candado se marca despues de enviar: si falla, se reintenta');
});

test('🔒 sin dato verificado NO se manda nada — son citas normativas', async () => {
  const src = await leer('../src/oliver-gpt/webhook.js');
  const bloque = cuerpoDelHook(src);
  // [2026-08-24] Ambas salidas sueltan la reserva corta antes del `return`: si no, un
  // THERMAL caido dejaria el candado puesto 5 min sin que nadie haya mandado nada.
  assert.match(bloque, /if \(!datos\) \{ liberar\(\); return; \}/, 'sin datos de THERMAL no se emite documento');
  assert.match(bloque, /if \(!pdfBuf\) \{ liberar\(\); return; \}/, 'si el PDF no se pudo armar, no se manda nada');
});

test('la tool de re-envio existe y SALTA el candado', async () => {
  // El candado de 30 dias evita spamear. Pero si el cliente PIDE el informe de nuevo
  // —"no me llego"— negarselo por el candado seria absurdo.
  const tools = await leer('../src/oliver-gpt/tools.js');
  assert.match(tools, /name: 'enviar_informe_termico'/);
  assert.match(tools, /ctx\.enviarInformeTermico\(input\.comuna \|\| '', \{ forzar: true \}\)/);
  const wh = await leer('../src/oliver-gpt/webhook.js');
  // [2026-08-24 · rediseño] El hook de `toolCtx` quedo SOLO para el re-envio explicito: el
  // envio automatico ya no pasa por aca, sale con la propuesta (el unico punto donde el
  // proyecto esta completo). Un pedido del cliente despacha en el momento.
  assert.match(hookDeToolCtx(wh), /=> despacharInforme\(comuna, opciones\)/,
    'un pedido explicito despacha en el momento');
  assert.match(wh, /const despacharInforme = \(comuna, \{ forzar = false/, 'despacharInforme acepta forzar');
  assert.match(cuerpoDelHook(wh), /if \(!forzar\) \{/, 'el candado solo aplica al envio automatico');
});

test('se manda un PDF, no un mensaje de texto', async () => {
  const src = await leer('../src/oliver-gpt/webhook.js');
  const bloque = cuerpoDelHook(src);
  assert.match(bloque, /generarInformeTermicoPdf/);
  assert.match(bloque, /uploadWaDocument\(pdfBuf, nombreArchivo\)/);
  assert.match(bloque, /sendWaDocument\(from, mediaId/);
});

test('el hook usa el nombre del cliente si lo hay', async () => {
  const src = await leer('../src/oliver-gpt/webhook.js');
  assert.match(cuerpoDelHook(src), /nombre: state\.name \|\| ''/);
});

test('🔴 el informe lleva LA VENTANA DEL CLIENTE, no solo el catalogo', async () => {
  // El dueno lo cazo mirando el PDF: "entrego un informe tipo con muchos termopaneles".
  // Tenia razon: con los 10 vidrios y nada suyo, se lee como folleto. Ahora el vidrio y el
  // Uw que ACABAN de salir de la cotizacion viajan al informe y se destacan.
  // [2026-08-24] Los tres campos de resumen salen ahora de la ULTIMA ventana de la
  // propuesta, JUNTOS. Tomarlos por separado dejaba `producto` de una ventana y `uw` de
  // otra, y ese par mentiroso terminaba en el registro ISO.
  const wh = await leer('../src/oliver-gpt/webhook.js');
  const resumen = trozo(wh, 'const ultima = (input.items', 'producto: ultima.producto_label');
  assert.match(resumen, /glassLabel: ultima\.glass_label/, 'el vidrio del cliente tiene que viajar');
  assert.match(resumen, /uw: ultima\.termico\?\.uw/, 'y su Uw calculado');

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
  const bloque = cuerpoDelHook(wh);

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
  const bloque = cuerpoDelHook(wh);
  const iNum = bloque.indexOf('/internal/informes/next-number');
  const iPdf = posicionDelPdf(bloque);
  assert.ok(iNum > 0, 'sin correlativo no hay procedimiento ISO');
  assert.ok(iNum < iPdf, 'el numero se pide ANTES del PDF, igual que la cotizacion');
  assert.ok(bloque.includes('numeroInforme,'), 'y viaja al PDF para quedar impreso');

  const pdf = await leer('./informeTermicoPdf.js');
  assert.ok(pdf.includes('Informe N° '), 'el documento muestra su numero');
});

test('si sales-os no contesta, el fallback se DISTINGUE (INF-LOCAL-), no se disfraza', async () => {
  const wh = await leer('../src/oliver-gpt/webhook.js');
  const bloque = cuerpoDelHook(wh);
  assert.ok(bloque.includes('INF-LOCAL-'),
    'un numero fuera de secuencia tiene que VERSE fuera de secuencia en la auditoria');
});

test('el registro va DESPUES del envio: registrar algo que no salio es mentirle a la auditoria', async () => {
  const wh = await leer('../src/oliver-gpt/webhook.js');
  const bloque = cuerpoDelHook(wh);
  const iEnvio = bloque.indexOf('sendWaDocument(from, mediaId');
  const iCandado = bloque.indexOf('escribirEstado)(clave, { at: Date.now() }');
  const iReg = bloque.indexOf('/internal/informes/registrar');
  assert.ok(iEnvio > 0 && iReg > iEnvio, 'primero sale el documento, despues se registra');
  assert.ok(iReg > iCandado, 'y despues del candado: el registro jamas frena la entrega');
  // el gate ahora vive ANTES (if (!entregado) return) — lo cubre el test del P1 de Codex
  assert.ok(bloque.indexOf('if (!entregado)') < iCandado, 'el gate de entrega corta antes del candado');
});

test('el registro lleva el sha256 del PDF exacto que salio', async () => {
  const wh = await leer('../src/oliver-gpt/webhook.js');
  const bloque = cuerpoDelHook(wh);
  assert.ok(bloque.includes("createHash('sha256').update(pdfBuf).digest('hex')"),
    'el hash identifica el documento byte a byte: es la evidencia');
  assert.ok(bloque.includes('pdf_bytes: pdfBuf.length'));
});

test('si el registro falla se dice EN VOZ ALTA y el cliente NO pierde su informe', async () => {
  const wh = await leer('../src/oliver-gpt/webhook.js');
  const bloque = cuerpoDelHook(wh);
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
  const bloque = cuerpoDelHook(wh);
  const iGate = bloque.indexOf('envio.ok === true');
  const iCandado = bloque.indexOf("escribirEstado)(clave, { at: Date.now() }");
  const iReg = bloque.indexOf('/internal/informes/registrar');
  assert.ok(iGate > 0, 'el gate de entrega existe');
  assert.ok(iGate < iCandado && iGate < iReg, 'candado y registro van DESPUES del gate');
  assert.ok(bloque.includes('if (!entregado)'), 'sin entrega: return, sin candado y sin registro');
});

test('🔴 candado CORTO anti-duplicado: dos cotizaciones seguidas = UN informe', async () => {
  // Medido en produccion 24-ago: 56990704777 recibio DOS informes identicos (folios 0001 y
  // 0002) y 56995420506 otros dos (0003 y 0004).
  //
  // ⚠️ LA PRIMERA EXPLICACION DE ESTE TEST ERA FALSA. Decia que entre el arranque del bloque
  // y el candado definitivo pasan ~40 s de ritmo humano y que ahi entraba la segunda
  // cotizacion. Los timestamps reales la desmienten: 90 ms y 310 ms entre emisiones. No es
  // ritmo humano, es CONCURRENCIA — dos `calcular_cotizacion` del mismo turno, una por
  // ventana del proyecto. Por eso el candado leer-luego-escribir no alcanzaba: cada `await`
  // cede el event loop y las dos ejecuciones lo veian libre.
  //
  // El comportamiento se prueba de verdad en webhook.informe.test.js; aca solo se fija que
  // el candado siga siendo un test-and-set y que nadie lo devuelva al patron con awaits.
  const wh = await leer('../src/oliver-gpt/webhook.js');
  const bloque = cuerpoDelHook(wh);
  const iCorto = bloque.indexOf(':en_curso');
  const iPdf = posicionDelPdf(bloque);
  const iLargo = bloque.indexOf("escribirEstado)(clave, { at: Date.now() }");
  assert.ok(iCorto > 0, 'falta el candado corto');
  assert.ok(iCorto < iPdf, 'el candado corto va ANTES de todo el trabajo');
  assert.ok(iLargo > iCorto, 'el de 30 dias sigue yendo al final, tras entrega confirmada');
  assert.ok(bloque.includes('5 * 60'), 'corto de 5 min: si el envio se cae, vence solo');
  assert.match(bloque, /reservarEstado \|\| reservarEstado\)\(claveEnCurso/,
    'tiene que ser un test-and-set atomico, no leer-y-despues-escribir');
  assert.doesNotMatch(bloque.slice(iCorto - 200, iCorto + 400), /await .*\(claveEnCurso/,
    'un await entre el chequeo y la marca reabre la carrera que produjo los 4 informes');
});

test('🔒 el candado corto NO reemplaza al de 30 dias', async () => {
  // Adelantar el definitivo dejaria al cliente sin informe 30 dias si el envio falla —
  // que es justo el bug que bloqueo a 4 clientes reales hoy.
  const wh = await leer('../src/oliver-gpt/webhook.js');
  const bloque = cuerpoDelHook(wh);
  assert.ok(bloque.includes('30 * 24 * 3600'), 'el candado de 30 dias sigue existiendo');
  const iGate = bloque.indexOf('envio.ok === true');
  const iLargo = bloque.indexOf("escribirEstado)(clave, { at: Date.now() }");
  assert.ok(iGate < iLargo, 'y sigue colgando del gate de entrega');
});

test('🔴 [Codex · compuerta] la MEMORIA se guarda ANTES de todo candado', async () => {
  // EL AGUJERO QUE CAZO CODEX: la memoria estaba despues del candado de 30 dias. Si el
  // cliente YA recibio su informe y despues RECOTIZA con otro vidrio, el `return` del
  // candado cortaba antes de guardar ⇒ la memoria se quedaba con el vidrio VIEJO, y un
  // re-envio posterior le declaraba el Uw de un vidrio que ya no es el suyo. En un
  // documento firmado por un evaluador acreditado.
  //
  // La regla que fija el orden: RECORDAR lo cotizado es un registro y pasa siempre;
  // MANDAR el informe es un envio y tiene candados. Un candado de envio no gobierna un
  // registro.
  const bloque = cuerpoDelHook(await leer('../src/oliver-gpt/webhook.js'));
  const iMemoria = bloque.indexOf(':datos`');
  const iCandado30 = bloque.indexOf('yaSeMando = candadoVigente(');
  const iCandadoCorto = bloque.indexOf(':en_curso`');
  assert.ok(iMemoria > 0, 'no se encontro la memoria de la ultima cotizacion');
  assert.ok(iCandado30 > 0 && iCandadoCorto > 0, 'no se encontraron los dos candados');
  assert.ok(iMemoria < iCandado30,
    'la memoria va ANTES del candado de 30 dias: si no, una recotizacion nunca se registra');
  assert.ok(iMemoria < iCandadoCorto,
    'y antes del corto tambien, que tambien puede cortar con return');
});

test('🔒 el rescate NO puede pisar los datos frescos de una cotizacion', async () => {
  // La inversion seria silenciosa: el cliente recotiza con un vidrio mejor y el informe le
  // declara el Uw del anterior. Un numero correcto... de otro proyecto.
  const bloque = cuerpoDelHook(await leer('../src/oliver-gpt/webhook.js'));
  // [2026-08-24 · rediseño] Vuelve a ser una llamada directa: el despacho ocurre UNA vez
  // por turno, asi que ya no hay cotizaciones hermanas compitiendo por esta clave y no
  // hace falta el leer-calcular-escribir atomico. Lo que se protege —el orden de los
  // argumentos, entrantes primero— no cambio nunca.
  assert.match(bloque, /datosDelInforme\(\{ glassLabel, uw, producto, ventanas \}, recordados\)/,
    'los datos entrantes van PRIMERO en la llamada: son los que mandan');
});

test('🔒 tramo 2 — el hook recuerda las ventanas y las recupera en el re-envio', async () => {
  const bloque = cuerpoDelHook(await leer('../src/oliver-gpt/webhook.js'));
  assert.match(bloque, /datosDelInforme\(\{ glassLabel, uw, producto, ventanas \}, recordados\)/,
    'sin `ventanas` en la llamada, un re-envio recupera el vidrio pero pierde el proyecto');
  assert.match(bloque, /\(\{ glassLabel, uw, producto, ventanas \} = elegido\.datos\)/,
    'y hay que leer de vuelta lo elegido, o se usa la variable entrante sin rescate');
  // [2026-08-24 · rediseño] EL PROYECTO SALE DE LA PROPUESTA. No se junta en el estado ni
  // en el turno: el cliente lista sus ventanas a lo largo de VARIOS mensajes (Alejandro dio
  // diez en cinco), asi que ni una cotizacion ni un turno lo tienen entero. El sistema ya
  // acumula las partidas entre turnos para la propuesta desde jun-2026, y de ahi se toma.
  // Efecto lateral valioso: informe y propuesta declaran SIEMPRE las mismas ventanas.
  const wh2 = await leer('../src/oliver-gpt/webhook.js');
  assert.match(wh2, /const ventanasProyecto = \(input\.items \|\| \[\]\)\.map/,
    'las ventanas salen de los items de la propuesta');
  assert.match(wh2, /if \(docSent\) \{/,
    'y solo si la propuesta se entrego de verdad: no se promete un informe a quien no cotizo');
});

test('🔒 tramo 3 — el PDF recibe el proyecto (este es el tramo que faltaba)', async () => {
  const bloque = cuerpoDelHook(await leer('../src/oliver-gpt/webhook.js'));
  const iPdf = posicionDelPdf(bloque);
  assert.ok(iPdf > 0, 'no se encontro la generacion del PDF');
  assert.match(bloque.slice(iPdf, iPdf + 700), /\bventanas,/,
    'el PDF tiene que recibir `ventanas` o vuelve a dibujar UNA sola ventana');
});

test('🔴 calcular_cotizacion YA NO dispara el informe', async () => {
  // Dejarlo "por las dudas" no es inofensivo: vuelve a tomar los candados antes que el
  // despacho bueno y reproduce el defecto entero. Lo cazo Codex en la revision final.
  const tools = await leer('../src/oliver-gpt/tools.js');
  const bloque = tools.slice(tools.indexOf("case 'calcular_cotizacion'"), tools.indexOf("case 'calcular_por_area'"));
  assert.doesNotMatch(bloque, /ctx\??\.?enviarInformeTermico/,
    'el informe sale con la propuesta; disparar aca deja al cliente con una ventana de diez');
});

test('🔴 el informe se despacha con la PROPUESTA y con el proyecto completo', async () => {
  const wh = await leer('../src/oliver-gpt/webhook.js');
  const bloque = trozo(wh, 'Paso 3a·bis', 'Paso 3b');
  assert.match(bloque, /if \(docSent\) \{/,
    'solo si la propuesta se entrego: no se le promete un informe a quien no cotizo');
  assert.match(bloque, /const ventanasProyecto = \(input\.items \|\| \[\]\)\.map/,
    'las ventanas salen de los items de la propuesta, que es donde esta el proyecto entero');
  assert.match(bloque, /uw: it\.termico\?\.uw \?\? null/,
    'con el Uw que el motor ya calculo para cada una');
  assert.doesNotMatch(bloque, /await despacharInforme/,
    'sin await: el informe no puede demorar el PDF que el cliente esta esperando');
});

test('🔒 la cantidad viaja CRUDA desde el item, sin lavarla', async () => {
  // Un `|| 1` aca convierte un dato ausente en un 1 indistinguible de uno informado, y
  // `resumenVentanas` ya no puede marcarlo como incierto.
  const wh = await leer('../src/oliver-gpt/webhook.js');
  const bloque = trozo(wh, 'const ventanasProyecto', '}));');
  assert.match(bloque, /cantidad: it\.qty,/);
  assert.doesNotMatch(bloque, /cantidad:[^,]*\|\| 1/);
});

test('🔴 [Codex final] el informe NO hace upsert: se cuelga del Deal de la propuesta', async () => {
  // `upsertZohoDeal` arma el nombre del Deal con `items[0].producto_label` y reescribe la
  // descripcion. El informe le pasaba items con otra forma, asi que el nombre caia al
  // generico "Ventanas" y pisaba el bueno — un documento secundario degradando el registro
  // comercial del cliente. Ademas buscar-y-crear no es atomico y podia duplicar el Deal.
  const wh = await leer('../src/oliver-gpt/webhook.js');
  const bloque = trozo(wh, "safe('informeTermico.zoho'", 'attachPdfToDeal(dealId');
  // Se busca la LLAMADA, no la palabra: el comentario de al lado explica por que no se usa
  // y mencionarla ahi no es usarla.
  assert.doesNotMatch(bloque, /await upsertZohoDeal\(/, 'el informe no crea ni actualiza el Deal');
  assert.match(bloque, /leerEstado\)\(`deal:\$\{String\(from\)/, 'lo lee del que dejo la propuesta');
  assert.match(bloque, /if \(!dealId\) return;/, 'y sin Deal no archiva: mejor sin copia que a medias');
});

test('🔴 [#393] el registro ISO manda el FOLIO REAL: state.last_quote, no campos fantasma', async () => {
  // 30 informes seguidos salieron con quote_number NULL porque el payload leia
  // state.quoteNum / state.quote_number — campos que NINGUN camino escribe. El folio vive en
  // state.last_quote (lo escribe generarPdf al entregar la propuesta, un instante antes de
  // despachar el informe: medido en vivo, informe 0030 y quote 0365 en el mismo segundo).
  const src = await leer('../src/oliver-gpt/webhook.js');
  assert.match(src, /quote_number:\s*state\?\.last_quote\?\.quote_number\s*\?\?\s*null/,
    'el payload del registro lee state.last_quote.quote_number');
  assert.ok(!/state\?\.quoteNum/.test(src), 'los campos fantasma quoteNum ya no se leen');
});
