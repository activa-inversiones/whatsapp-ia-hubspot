Revisor de la compuerta cruzada de ACTIVA IMPERIUM. NO escribas ni modifiques archivos.

QUINTA PASADA — y sobre un REDISEÑO, no sobre parches. En las cuatro anteriores diste NO
APTO siempre por la misma familia de defectos (ventanas perdidas, duplicadas o tardias).
Se acepto tu diagnostico de fondo y se cambio la arquitectura:

ANTES: el informe se disparaba dentro de `calcular_cotizacion` (una partida por llamada), y
habia que reconstruir el proyecto desde N invocaciones coordinadas por estado compartido:
candado corto, `fusionar` atomico, sello de tanda, barrera de estabilizacion por tiempo.

AHORA: cada llamada REGISTRA su ventana en memoria del turno (sincrono, sin red) y el
informe se despacha UNA vez al cerrar el turno con el proyecto completo. Se BORRARON
`fusionar`, el sello de tanda y la barrera de estabilizacion.

Ademas el PDF ahora se ARCHIVA (adjunto al Deal de Zoho, como la cotizacion), porque no se
guardaba en ninguna parte.

Lo que interesa que ataques:
 · ¿Queda algun camino donde el cliente reciba MAS o MENOS ventanas de las que cotizo?
 · Dos turnos seguidos del mismo cliente: ¿pueden duplicar el informe? ¿el candado corto
   con token sigue siendo suficiente ahora que el disparo es uno por turno?
 · `informeDelTurno` es un objeto por invocacion del handler: ¿puede filtrarse entre
   clientes o entre turnos? ¿que pasa si el turno lanza a mitad?
 · El despacho va DESPUES de responderle al cliente: ¿puede quedar huerfano si el proceso
   muere, o demorar/tumbar el turno?
 · El archivo en Zoho: ¿puede crear Deals duplicados, o bloquear el envio si Zoho se cae?
 · Tests que parezcan verificar y no verifiquen.

REGLAS: prohibido inventar datos de negocio; un Uw ausente jamas se ve como numero ni recibe
veredicto; nada se registra como entregado sin confirmar; un candado no puede dejar a un
cliente sin informe; la cotizacion no puede demorarse ni fallar por el informe.

Devolve: APTO / NO APTO PARA PRODUCCION + hallazgos con severidad, archivo y entrada concreta.

DIFF DEL REDISEÑO (commit 47f62d0):
commit 47f62d0b26b956a1afa1ff7c6c8a1a569efd2eb2
Author: Marcelo Cifuentes <mcifuentes@activaspa.cl>
Date:   Mon Aug 24 18:28:38 2026 -0400

    refactor(termico): el informe se despacha al FINAL del turno, y queda archivado
    
    REDISEÑO. Cuatro pasadas de compuerta cruzada dieron NO APTO, siempre por defectos de la
    misma familia: se perdian ventanas, se duplicaban, o llegaban tarde. Cada arreglo destapaba
    una carrera nueva en otro lado. Eso ya no es una hipotesis fallida, es la arquitectura
    equivocada — la regla de `systematic-debugging` para 3+ fixes fallidos.
    
    LA RAIZ: el informe se disparaba DENTRO de `calcular_cotizacion`, que cotiza UNA partida por
    llamada. Un proyecto de ocho ventanas son ocho disparos, y habia que reconstruirlo desde N
    invocaciones sueltas coordinadas por estado compartido. TODA la maquinaria del lote anterior
    —candado corto, `fusionar` atomico, sello de tanda, barrera de estabilizacion por tiempo—
    existia solo para compensar el lugar del disparo.
    
    AHORA: cada `calcular_cotizacion` REGISTRA su ventana en memoria del turno (sincrono, sin
    red, sin candados) y el informe se despacha UNA vez al cerrar el turno, con el proyecto
    completo. El turno es secuencial y termina en un instante conocido, asi que las carreras no
    se mitigan: dejan de existir. Se BORRAN `fusionar`, el sello de tanda y la barrera de
    estabilizacion — no habia numero correcto para "cuantos segundos esperar a que deje de
    crecer" (3 s de quietud contra una cotizacion que puede tardar 15 s).
    
    Se conservan: el candado de 30 dias, el corto con token (dos turnos seguidos pueden
    duplicar), el espejo al cockpit y el re-chequeo de `leer()` tras el await — este ultimo es un
    defecto propio de `leer`, no de su llamador, asi que sobrevive al rediseño.
    
    EL INFORME AHORA SE ARCHIVA. Reclamo del dueño, textual: *"yo abro el sistema y deberia
    estar guardado... tiene que estar almacenado, al lado de la cotizacion"*. Tenia razon: del
    informe solo quedaba el folio y un sha256, el PDF no se guardaba en NINGUNA parte. Ahora se
    adjunta al Deal de Zoho con el mismo mecanismo que la cotizacion, despues de la entrega
    confirmada y en su propio `safe` (si Zoho se cae, el cliente igual tiene su informe).
    ⚠️ Zoho WorkDrive sigue INERTE: es un stub que espera que el dueño re-autorice OAuth con
    scope WorkDrive.files.CREATE. Por eso ahi no aparece nada, ni del informe ni de la cotizacion.
    
    ⚠️ CORRECCION DE UN DIAGNOSTICO MIO: dije que a dos clientes "si les habia llegado" el
    informe, apoyado en que la BD lo daba por entregado. El dueño mostro el historial y no
    estaba. `envio.ok === true` prueba que Meta acepto la llamada, NO que el cliente recibio el
    documento, y yo lo trate como equivalente. La causa de fondo del desacuerdo es la misma que
    este commit arregla: si el sistema no puede mostrar el documento, no hay forma de responder
    "¿le llego?" sin discutir.
    
    TESTS: 792, 0 fail. 4 mutantes muertos (no despachar al final · el registrador reemplazando
    en vez de sumar · no archivar en Zoho · un pedido explicito que deja de despachar).
    
    Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

diff --git a/services/estadoPersistente.js b/services/estadoPersistente.js
index 59d3cf9..2c69716 100644
--- a/services/estadoPersistente.js
+++ b/services/estadoPersistente.js
@@ -154,25 +154,6 @@ export function liberarReserva(clave, token) {
   return true;
 }
 
-/**
- * LEER-CALCULAR-ESCRIBIR ATOMICO. `calcular(valorActual)` devuelve `{ valor, guardar }`.
- *
- * 🔴 [2026-08-24 · 2a compuerta] Misma leccion que `reservar`, en los DATOS en vez del
- * candado: acumular las ventanas de un proyecto con `await leer()` y despues
- * `escribir()` tiene la carrera de siempre. Cada `calcular_cotizacion` leia la memoria
- * antes de que las hermanas escribieran, veia vacio, y guardaba SU ventana pisando a las
- * demas — el cliente con ocho ventanas terminaba con una.
- *
- * Igual que en `reservar`: LA GARANTIA ES QUE ACA NO HAY UN SOLO `await`. `calcular` debe
- * ser sincrona; si alguien le pasa una funcion async, la atomicidad se pierde en silencio.
- */
-export function fusionar(clave, calcular, ttlSegundos = 3600) {
-  const actual = leerLocal(clave);
-  const { valor, guardar } = calcular(actual) || {};
-  if (guardar && valor !== undefined && valor !== null) escribir(clave, valor, ttlSegundos);
-  return valor === undefined ? actual : valor;
-}
-
 export function borrar(clave) {
   MEMORIA.delete(clave);
   pedir('DELETE', clave).catch(() => {});
@@ -181,4 +162,4 @@ export function borrar(clave) {
 /** Para tests. */
 export function _reset() { MEMORIA.clear(); }
 
-export default { leer, leerLocal, escribir, fusionar, reservar, liberarReserva, borrar, PERSISTENCIA_ACTIVA };
+export default { leer, leerLocal, escribir, reservar, liberarReserva, borrar, PERSISTENCIA_ACTIVA };
diff --git a/services/estadoPersistente.test.js b/services/estadoPersistente.test.js
index 693a550..dd083f8 100644
--- a/services/estadoPersistente.test.js
+++ b/services/estadoPersistente.test.js
@@ -173,35 +173,14 @@ test('liberarReserva sin token o con clave libre no hace nada ni lanza', async (
   assert.equal(mod.liberarReserva('nada', 'token-inventado'), false);
 });
 
-test('🔴 fusionar: acumular tambien necesita ser ATOMICO', async () => {
-  // La misma carrera del candado, en la memoria de datos: dos ejecuciones hacen
-  // `await leer()` antes de que ninguna escriba, las dos ven vacio, y la segunda PISA a
-  // la primera en vez de sumarse. Asi se perdian las ventanas de un proyecto: cada
-  // `calcular_cotizacion` guardaba la suya creyendo que era la unica.
-  const { fetchFalso } = armarBackend();
-  const mod = await cargarModulo(fetchFalso, 'f1');
-  const sumar = (v) => (local) => ({ valor: [...(local || []), v], guardar: true });
-  mod.fusionar('proj', sumar('V1'), 60);
-  mod.fusionar('proj', sumar('V2'), 60);
-  mod.fusionar('proj', sumar('V3'), 60);
-  assert.deepEqual(mod.leerLocal('proj'), ['V1', 'V2', 'V3'], 'las tres, en orden');
-});
-
-test('fusionar: si el calculo dice que no hay nada que guardar, no escribe', async () => {
-  const { fetchFalso } = armarBackend();
-  const mod = await cargarModulo(fetchFalso, 'f2');
-  mod.fusionar('vacio', () => ({ valor: null, guardar: false }), 60);
-  assert.equal(mod.leerLocal('vacio'), null, 'no tiene sentido guardar el vacio');
-});
-
 test('🔴 [Codex 3a] un GET atrasado NO puede pisar lo que se fusiono mientras viajaba', async () => {
-  // EL DEFECTO MAS FINO DE TODO EL LOTE, y `fusionar` por si sola no lo cubria: `leer()`
-  // va a Postgres y, al volver, CACHEA lo que trajo en la memoria local. Si mientras ese
-  // GET viajaba otra ejecucion fusiono ventanas nuevas, la respuesta vieja las pisa.
+  // `leer()` va a Postgres y, al volver, CACHEA lo que trajo en la memoria local. Si
+  // mientras ese GET viajaba alguien escribio, la respuesta vieja pisa lo nuevo — sin
+  // error, en silencio.
   //
-  // Reproduccion de Codex: A fusiona [VIEJA, A]; llega el GET atrasado de B con [VIEJA] y
-  // pisa; B fusiona sobre eso y queda [VIEJA, B]. La ventana de A desaparecio, y nadie se
-  // entera: no hay error, solo un informe con una ventana menos.
+  // Lo encontro Codex sobre el diseño anterior (donde el informe se armaba juntando el
+  // estado entre varias ejecuciones). Ese diseño ya no existe, pero la proteccion se queda:
+  // `leer` es de uso general y esta clase de pisada es un defecto suyo, no de su llamador.
   const { disco, fetchFalso } = armarBackend();
   disco.set('p', ['VIEJA']);
   let soltar;
@@ -219,7 +198,7 @@ test('🔴 [Codex 3a] un GET atrasado NO puede pisar lo que se fusiono mientras
 
   const viaje = mod.leer('p');                        // GET en vuelo
   await new Promise((r) => setTimeout(r, 10));
-  mod.fusionar('p', (local) => ({ valor: [...(local || ['VIEJA']), 'A'], guardar: true }), 60);
+  mod.escribir('p', ['VIEJA', 'A'], 60);                // escritura local mientras el GET viaja
   assert.deepEqual(mod.leerLocal('p'), ['VIEJA', 'A']);
 
   soltar();                                            // ahora vuelve el GET viejo
diff --git a/services/informeTermico.cableado.test.js b/services/informeTermico.cableado.test.js
index 91f513a..0773fbb 100644
--- a/services/informeTermico.cableado.test.js
+++ b/services/informeTermico.cableado.test.js
@@ -53,12 +53,23 @@ function posicionDelPdf(bloque) {
   return i;
 }
 
+// [2026-08-24 · rediseño] El cuerpo del envio ya no vive dentro del objeto `toolCtx`: se
+// extrajo a `despacharInforme`, una funcion del turno que se llama UNA vez al final. El
+// hook `enviarInformeTermico` quedo como un registrador de tres lineas.
 function cuerpoDelHook(src) {
-  const i = src.indexOf('enviarInformeTermico: (comuna,');
-  assert.ok(i > 0, 'no se encontro el hook enviarInformeTermico en webhook.js');
-  const resto = src.slice(i);
-  const m = resto.slice(1).match(/\n {6}[a-zA-Z_$][\w$]*: /);
-  return m ? resto.slice(0, m.index + 1) : resto;
+  const i = src.indexOf('const despacharInforme = (comuna,');
+  assert.ok(i > 0, 'no se encontro despacharInforme en webhook.js');
+  const j = src.indexOf('\n      };', i);
+  assert.ok(j > i, 'no se encontro el cierre de despacharInforme');
+  return src.slice(i, j);
+}
+
+/** El registrador que ven las tools (lo que antes era el hook completo). */
+function registradorDelTurno(src) {
+  const i = src.indexOf('enviarInformeTermico: (comuna, opciones');
+  assert.ok(i > 0, 'no se encontro el hook enviarInformeTermico en toolCtx');
+  const j = src.indexOf('\n      },', i);
+  return src.slice(i, j);
 }
 
 test('calcular_cotizacion DISPARA el informe — es el momento en que el cliente espera', async () => {
@@ -103,7 +114,8 @@ test('el disparo va DESPUES de que la cotizacion salio bien, no antes', async ()
 
 test('webhook.js PROVEE el hook, con candado de una sola vez por cliente', async () => {
   const src = await leer('../src/oliver-gpt/webhook.js');
-  assert.match(src, /enviarInformeTermico: \(comuna, \{ forzar/, 'el hook tiene que estar en toolCtx');
+  assert.match(src, /enviarInformeTermico: \(comuna, opciones/, 'el hook tiene que estar en toolCtx');
+  assert.match(src, /const despacharInforme = \(comuna,/, 'y el envio, en la funcion del turno');
   assert.match(src, /informe_termico:\$\{String\(from\)/, 'el candado va por telefono');
   assert.match(src, /30 \* 24 \* 3600/, 'candado de 30 dias: un informe repetido es spam');
 });
@@ -143,8 +155,13 @@ test('la tool de re-envio existe y SALTA el candado', async () => {
   assert.match(tools, /name: 'enviar_informe_termico'/);
   assert.match(tools, /ctx\.enviarInformeTermico\(input\.comuna \|\| '', \{ forzar: true \}\)/);
   const wh = await leer('../src/oliver-gpt/webhook.js');
-  assert.match(wh, /enviarInformeTermico: \(comuna, \{ forzar = false/, 'el hook acepta forzar');
-  assert.match(wh, /if \(!forzar\) \{/, 'el candado solo aplica al envio automatico');
+  const reg = registradorDelTurno(wh);
+  // [2026-08-24 · rediseño] `forzar` = el cliente lo esta PIDIENDO ahora, asi que se
+  // despacha en el momento en vez de esperar al cierre del turno.
+  assert.match(reg, /if \(opciones\.forzar\) return despacharInforme\(comuna, opciones\);/,
+    'un pedido explicito no espera al final del turno');
+  assert.match(wh, /const despacharInforme = \(comuna, \{ forzar = false/, 'y despacharInforme acepta forzar');
+  assert.match(cuerpoDelHook(wh), /if \(!forzar\) \{/, 'el candado solo aplica al envio automatico');
 });
 
 test('se manda un PDF, no un mensaje de texto', async () => {
@@ -343,12 +360,11 @@ test('🔒 el rescate NO puede pisar los datos frescos de una cotizacion', async
   // La inversion seria silenciosa: el cliente recotiza con un vidrio mejor y el informe le
   // declara el Uw del anterior. Un numero correcto... de otro proyecto.
   const bloque = cuerpoDelHook(await leer('../src/oliver-gpt/webhook.js'));
-  // [2026-08-24] La llamada vive dentro del callback de `fusionar` (leer-calcular-escribir
-  // atomico), pero el orden de los argumentos es lo que se protege acá y no cambio: los
-  // entrantes primero, la memoria como segundo. `local || recordados` es la memoria: lo
-  // que escribieron las cotizaciones hermanas de este mismo turno, o lo que sobrevivio en
-  // Postgres a un redeploy.
-  assert.match(bloque, /datosDelInforme\(\{ glassLabel, uw, producto, ventanas \}, local \|\| recordados\)/,
+  // [2026-08-24 · rediseño] Vuelve a ser una llamada directa: el despacho ocurre UNA vez
+  // por turno, asi que ya no hay cotizaciones hermanas compitiendo por esta clave y no
+  // hace falta el leer-calcular-escribir atomico. Lo que se protege —el orden de los
+  // argumentos, entrantes primero— no cambio nunca.
+  assert.match(bloque, /datosDelInforme\(\{ glassLabel, uw, producto, ventanas \}, recordados\)/,
     'los datos entrantes van PRIMERO en la llamada: son los que mandan');
 });
 
@@ -373,14 +389,15 @@ test('🔒 tramo 1 — la cotizacion manda las 8 ventanas, no items[0]', async (
 
 test('🔒 tramo 2 — el hook recuerda las ventanas y las recupera en el re-envio', async () => {
   const bloque = cuerpoDelHook(await leer('../src/oliver-gpt/webhook.js'));
-  assert.match(bloque, /datosDelInforme\(\{ glassLabel, uw, producto, ventanas \}, local \|\| recordados\)/,
+  assert.match(bloque, /datosDelInforme\(\{ glassLabel, uw, producto, ventanas \}, recordados\)/,
     'sin `ventanas` en la llamada, un re-envio recupera el vidrio pero pierde el proyecto');
-  assert.match(bloque, /\(\{ glassLabel, uw, producto, ventanas \} = datosInforme\)/,
-    'y hay que leer de vuelta lo fusionado, o se usa la variable entrante sin rescate');
-  // [Codex · 2a pasada] La acumulacion tiene que ser ATOMICA: con leer-y-despues-escribir,
-  // las ocho cotizaciones de un proyecto se pisaban entre si y quedaba una sola ventana.
-  assert.match(bloque, /fusionarEstado \|\| fusionarEstado\)\(claveDatos/,
-    'un leer-luego-escribir aca vuelve a perder las ventanas de las cotizaciones hermanas');
+  assert.match(bloque, /\(\{ glassLabel, uw, producto, ventanas \} = elegido\.datos\)/,
+    'y hay que leer de vuelta lo elegido, o se usa la variable entrante sin rescate');
+  // [2026-08-24 · rediseño] El ACUMULADO ya no vive en el estado compartido: se junta en
+  // memoria del turno y llega completo. Lo que se guarda aca es para el RE-ENVIO posterior.
+  const reg = registradorDelTurno(await leer('../src/oliver-gpt/webhook.js'));
+  assert.match(reg, /informeDelTurno\.ventanas\.push\(\.\.\.opciones\.ventanas\)/,
+    'cada cotizacion suma su ventana al proyecto del turno');
 });
 
 test('🔒 tramo 3 — el PDF recibe el proyecto (este es el tramo que faltaba)', async () => {
diff --git a/services/informeTermico.datos.test.js b/services/informeTermico.datos.test.js
index 8a150c3..ab046bf 100644
--- a/services/informeTermico.datos.test.js
+++ b/services/informeTermico.datos.test.js
@@ -24,12 +24,11 @@ const V_VIEJAS = [{ id: 'V1', producto: 'Proyectante S60', vidrio: '4+12+4 low-e
 // [2026-08-24] `ventanasAt` = sello de la tanda. Sin el, la memoria se considera de otro
 // proyecto y las ventanas nuevas REEMPLAZAN en vez de sumarse — que es el comportamiento
 // correcto entre tandas, pero no el que estos tests quieren ejercitar.
-const VIEJO = { glassLabel: '4+12+4 low-e', uw: 1.9, producto: 'Proyectante S60', ventanas: V_VIEJAS, ventanasAt: Date.now() };
+const VIEJO = { glassLabel: '4+12+4 low-e', uw: 1.9, producto: 'Proyectante S60', ventanas: V_VIEJAS };
 
 test('con datos de la cotización se usan ESOS, y se recuerdan', () => {
   const r = datosDelInforme(FRESCO, null);
-  assert.deepEqual({ ...r.datos, ventanasAt: undefined }, { ...FRESCO, ventanasAt: undefined });
-  assert.ok(Number.isFinite(r.datos.ventanasAt), 'y queda sellada la tanda');
+  assert.deepEqual(r.datos, FRESCO);
   assert.equal(r.recordar, true, 'hay que guardarlos para el re-envío que venga después');
 });
 
@@ -72,15 +71,14 @@ test('🔒 un Uw de 0 no cuenta como dato', () => {
   // Mismo criterio que en el PDF: `0` es lo que devuelve `Number(null)`, no una medición.
   // Si contara, un cero espurio pisaría la memoria buena y se declararía en su lugar.
   const r = datosDelInforme({ glassLabel: '', uw: 0, producto: '' }, VIEJO);
-  assert.deepEqual({ ...r.datos, ventanasAt: 0 }, { ...VIEJO, ventanasAt: 0 },
-    'el cero no puede desplazar al dato real recordado');
+  assert.deepEqual(r.datos, VIEJO, 'el cero no puede desplazar al dato real recordado');
 });
 
 test('normaliza los huecos: undefined y cadena vacía entran como null', () => {
   // Lo que se guarda se vuelve a leer más tarde; si se guardaran `undefined`, al volver de
   // la serialización JSON el campo desaparecería y el rescate fallaría en silencio.
   const r = datosDelInforme({ glassLabel: '4+12+4', uw: undefined, producto: undefined }, null);
-  assert.deepEqual({ ...r.datos, ventanasAt: 0 }, { glassLabel: '4+12+4', uw: null, producto: '', ventanas: [], ventanasAt: 0 });
+  assert.deepEqual(r.datos, { glassLabel: '4+12+4', uw: null, producto: '', ventanas: [] });
   assert.equal(JSON.parse(JSON.stringify(r.datos)).uw, null, 'sobrevive al viaje por JSON');
 });
 
@@ -118,111 +116,16 @@ test('🔴 un proyecto SIN NINGÚN Uw se recuerda igual: existe aunque no se pue
   assert.equal(r.datos.ventanas.length, 2);
 });
 
-test('🔴 las ventanas nuevas se SUMAN a las viejas, no las reemplazan', () => {
-  // Este test decia lo contrario y estaba mal. Fijaba que el proyecto recien cotizado
-  // pisara al recordado — que es justo lo que hacia que un cliente con ocho ventanas
-  // recibiera un informe con la ultima. Ver el bloque de abajo para la evidencia.
+test('🔴 el proyecto entrante REEMPLAZA al recordado (cada turno trae el suyo completo)', () => {
   const nuevas = [{ id: 'V1', producto: 'Fijo S60', medidas: '900x900mm', vidrio: '5+12+5', uw: 2.4 }];
   const r = datosDelInforme({ glassLabel: '', uw: null, producto: '', ventanas: nuevas }, VIEJO);
-  assert.equal(r.datos.ventanas.length, V_VIEJAS.length + 1, 'las de antes siguen ahí');
-  assert.deepEqual(r.datos.ventanas.at(-1), nuevas[0], 'y la nueva se agrega al final');
+  assert.deepEqual(r.datos.ventanas, nuevas, 'manda el proyecto recien cotizado');
   assert.equal(r.recordar, true);
 });
 
-// ── 🔴 [2026-08-24 · Codex, 2a pasada] LAS VENTANAS SE ACUMULAN ─────────────────────
-// EL HALLAZGO: `calcular_cotizacion` cotiza UNA partida por llamada (tools.js arma
-// `items: [{...}]`), asi que un cliente con ocho ventanas produce OCHO llamadas, cada una
-// con SU ventana. Si la memoria REEMPLAZA, el informe termina con una sola — que es
-// exactamente el defecto que este lote vino a arreglar, sobreviviendo al arreglo.
-//
-// Asi se lee la evidencia real: los folios 0003 (Uw 2,71) y 0004 (sin Uw) del mismo
-// cliente no eran un informe repetido, eran sus DOS ventanas en documentos separados.
-//
-// Los otros tres campos (vidrio, Uw, producto) siguen la regla vieja —lo entrante manda—
-// porque son el RESUMEN de la ultima cotizacion, no una coleccion.
-
-test('🔴 las ventanas de dos cotizaciones se ACUMULAN, no se reemplazan', () => {
-  const v1 = { id: 'V1', producto: 'Corredera S60', medidas: '2000x1400mm', vidrio: 'DVH 5/12/5', uw: 2.71 };
-  const v2 = { id: 'V2', producto: 'Corredera H98', medidas: '3250x1460mm', vidrio: 'DVH 5/12/5', uw: null };
-  const r = datosDelInforme({ glassLabel: 'DVH 5/12/5', uw: null, producto: 'Corredera H98', ventanas: [v2] },
-    { glassLabel: 'DVH 5/12/5', uw: 2.71, producto: 'Corredera S60', ventanas: [v1], ventanasAt: Date.now() });
-  assert.equal(r.datos.ventanas.length, 2, 'las dos ventanas del proyecto');
-  assert.equal(r.datos.ventanas[0].medidas, '2000x1400mm', 'y en el orden en que se cotizaron');
-  assert.equal(r.datos.ventanas[1].medidas, '3250x1460mm');
-  assert.equal(r.recordar, true, 'hay que volver a guardar el acumulado');
-});
-
-test('🔴 DOS ventanas iguales son dos ventanas — no se deduplican', () => {
-  // El primer intento deduplicaba por producto+medidas+vidrio y estaba mal por una razon
-  // de negocio: un living con dos correderas gemelas es lo mas comun del mundo. Fusionarlas
-  // hacia que el informe declarara una ventana menos de las que el cliente compra, o sea
-  // el mismo defecto que este lote vino a arreglar, con otra cara.
+test('🔴 DOS ventanas iguales del mismo turno son DOS ventanas', () => {
+  // Un living con dos correderas gemelas es lo mas comun del mundo: nada puede fusionarlas.
   const v = { id: 'V1', producto: 'Corredera S60', medidas: '2000x1400mm', vidrio: 'DVH 5/12/5', uw: 2.71 };
-  const r = datosDelInforme({ ventanas: [{ ...v, id: 'V2' }] }, { ventanas: [v], ventanasAt: Date.now() });
-  assert.equal(r.datos.ventanas.length, 2, 'dos correderas gemelas son dos ventanas');
-});
-
-test('las ventanas se acumulan aunque el resto de los datos no cambie', () => {
-  const a = { id: 'V1', producto: 'A', medidas: '1x1', vidrio: 'X', uw: 2.5 };
-  const b = { id: 'V2', producto: 'B', medidas: '2x2', vidrio: 'X', uw: 2.6 };
-  const c = { id: 'V3', producto: 'C', medidas: '3x3', vidrio: 'X', uw: null };
-  const paso1 = datosDelInforme({ ventanas: [b] }, { ventanas: [a], ventanasAt: Date.now() }).datos;
-  const paso2 = datosDelInforme({ ventanas: [c] }, paso1).datos;
-  assert.deepEqual(paso2.ventanas.map((v) => v.producto), ['A', 'B', 'C'],
-    'ocho llamadas tienen que dar ocho ventanas');
-});
-
-test('sin ventanas entrantes se conservan las recordadas', () => {
-  const a = { id: 'V1', producto: 'A', medidas: '1x1', vidrio: 'X', uw: 2.5 };
-  const r = datosDelInforme({ glassLabel: 'Y' }, { glassLabel: 'X', uw: 2.5, producto: 'A', ventanas: [a] });
-  assert.equal(r.datos.ventanas.length, 1, 'el proyecto no se pierde por un dato suelto');
-  assert.equal(r.datos.glassLabel, 'Y', 'pero el vidrio entrante sigue mandando');
-});
-
-// ── 🔴 [2026-08-24 · Gemini, 3a pasada] LA ACUMULACION SE CORTA POR TANDA ────────────
-// EL RIESGO ESPEJO, y Gemini lo cazo con un caso que no habiamos pensado: la memoria vive
-// 30 dias y no tenia ningun corte entre proyectos. Un cliente que cotiza 4 ventanas el
-// lunes y otras 4 el viernes acumulaba OCHO. El candado de 30 dias evita el envio
-// automatico —por eso creiamos que estaba cubierto— pero NO cubre el re-envio con
-// `forzar: true`, que es cuando el cliente PIDE su informe: ahi recibia un documento
-// firmado que mezcla el proyecto viejo, ya descartado, con el nuevo.
-// Peor con la comuna: cotiza en Temuco y despues en Pucon, y el informe de Pucon certifica
-// ventanas de Temuco contra la exigencia equivocada.
-//
-// El corte es por TIEMPO porque es el unico dato que tenemos: no hay id de proyecto ni de
-// tanda. Dentro de la ventana se acumula (son las N llamadas de un mismo pedido); pasada
-// la ventana, la cotizacion nueva REEMPLAZA, que es lo que el cliente quiere ver.
-
-test('🔴 dos tandas separadas en el tiempo NO se mezclan', () => {
-  const lunes = [{ id: 'V1', producto: 'Corredera', medidas: '1x1', vidrio: 'X', uw: 2.5 }];
-  const viernes = { id: 'V1', producto: 'Proyectante', medidas: '2x2', vidrio: 'Y', uw: 2.4 };
-  const t0 = 1_700_000_000_000;
-  const r = datosDelInforme({ ventanas: [viernes] },
-    { ventanas: lunes, ventanasAt: t0 }, t0 + 4 * 24 * 3600 * 1000);
-  assert.equal(r.datos.ventanas.length, 1, 'el proyecto viejo no viaja al informe nuevo');
-  assert.deepEqual(r.datos.ventanas[0], viernes);
-});
-
-test('🔴 dentro de la MISMA tanda se sigue acumulando', () => {
-  // Las 8 llamadas de un proyecto llegan con ms de diferencia: eso es una sola tanda.
-  const t0 = 1_700_000_000_000;
-  const v1 = { id: 'V1', producto: 'A', medidas: '1x1', vidrio: 'X', uw: 2.5 };
-  const v2 = { id: 'V2', producto: 'B', medidas: '2x2', vidrio: 'X', uw: 2.6 };
-  const r = datosDelInforme({ ventanas: [v2] }, { ventanas: [v1], ventanasAt: t0 }, t0 + 300);
-  assert.equal(r.datos.ventanas.length, 2, 'las dos ventanas del mismo pedido');
-});
-
-test('la marca de tiempo de la tanda se guarda para poder compararla', () => {
-  const t0 = 1_700_000_000_000;
-  const r = datosDelInforme({ ventanas: [{ id: 'V1', producto: 'A', medidas: '1x1', vidrio: 'X', uw: 2.5 }] }, null, t0);
-  assert.equal(r.datos.ventanasAt, t0, 'sin el sello no hay forma de saber si es otra tanda');
-});
-
-test('memoria vieja SIN sello: se trata como otra tanda, no se mezcla', () => {
-  // Compatibilidad hacia atras: lo guardado antes de este cambio no tiene `ventanasAt`.
-  // Ante la duda, NO mezclar: mostrar de menos es recuperable, mezclar proyectos no.
-  const viejo = { ventanas: [{ id: 'V1', producto: 'A', medidas: '1x1', vidrio: 'X', uw: 2.5 }] };
-  const nueva = { id: 'V9', producto: 'Z', medidas: '9x9', vidrio: 'Y', uw: 2.2 };
-  const r = datosDelInforme({ ventanas: [nueva] }, viejo, 1_700_000_000_000);
-  assert.deepEqual(r.datos.ventanas, [nueva]);
+  const r = datosDelInforme({ ventanas: [v, { ...v, id: 'V2' }] }, null);
+  assert.equal(r.datos.ventanas.length, 2);
 });
diff --git a/services/informeTermico.js b/services/informeTermico.js
index 80f8c0e..ad6254f 100644
--- a/services/informeTermico.js
+++ b/services/informeTermico.js
@@ -336,14 +336,7 @@ export async function esperarAntesDeEnviar({ dormir = null, ms = DEMORA_MS } = {
  * alternativa —olvidar al cotizar algo sin datos termicos— dejaria sin recuadro a un cliente
  * que si tiene una ventana cotizada, que es peor.
  */
-/**
- * Ventana de agrupacion de una TANDA. Las N llamadas de un mismo pedido llegan con ms de
- * diferencia (medido: 90 y 310 ms); 15 min es holgado para eso y corto para no pegar dos
- * proyectos distintos. Configurable por si el ritmo del bot cambia.
- */
-const TANDA_MS = Number(process.env.INFORME_TANDA_MS || 15 * 60 * 1000);
-
-export function datosDelInforme(entrantes, recordados, ahora = Date.now()) {
+export function datosDelInforme(entrantes, recordados) {
   const VACIO = { glassLabel: '', uw: null, producto: '', ventanas: [] };
   // `Number(d.uw) > 0` y no una simple comprobacion de presencia: un Uw de 0 es lo que
   // produce `Number(null)`, no una medicion. Si contara como dato, un cero espurio
@@ -361,58 +354,23 @@ export function datosDelInforme(entrantes, recordados, ahora = Date.now()) {
     producto: d.producto || '',
     ventanas: Array.isArray(d.ventanas) ? d.ventanas : [],
   });
-  // 🔴 [2026-08-24 · Codex, 2a pasada] LAS VENTANAS SE ACUMULAN; EL RESTO SE REEMPLAZA.
-  // Son dos cosas distintas y por confundirlas el arreglo del proyecto-completo no
-  // arreglaba nada: `calcular_cotizacion` cotiza UNA partida por llamada, asi que ocho
-  // ventanas son ocho llamadas con una ventana cada una. Con la memoria reemplazando, el
-  // informe salia con la ultima y listo.
+  // [2026-08-24 · rediseño] LAS VENTANAS VUELVEN A REEMPLAZARSE, y esta vez es correcto.
   //
-  // `glassLabel`/`uw`/`producto` SI se reemplazan: son el resumen de la ULTIMA cotizacion,
-  // no una coleccion, y ahi lo entrante tiene que ganarle a lo viejo (regla que cazo Codex
-  // en la primera compuerta: si no, se le declara el Uw de un vidrio que ya no es el suyo).
-  // ⚠️ SE ACUMULA SIN DEDUPLICAR, Y ES A PROPOSITO. El primer intento deduplicaba por
-  // producto+medidas+vidrio, y estaba mal por una razon de negocio, no de codigo: DOS
-  // VENTANAS IGUALES SON UN CASO NORMAL — un living con dos correderas gemelas es lo mas
-  // comun del mundo. Deduplicar por contenido las fusionaba y el informe declaraba una
-  // ventana menos de las que el cliente compra. Perder una ventana del proyecto es
-  // exactamente el defecto que este lote vino a arreglar.
+  // Hubo una version intermedia donde esta funcion ACUMULABA, con dedupe y un sello de
+  // tanda para no pegar dos proyectos distintos del mismo telefono. Todo eso existia porque
+  // `calcular_cotizacion` disparaba el informe una vez por ventana y habia que juntar el
+  // proyecto desde N invocaciones sueltas. Ya no: el turno junta sus ventanas en memoria y
+  // manda el proyecto COMPLETO de una sola vez.
   //
-  // ¿Y la recotizacion (el mismo proyecto en color madera, caso real de Vanessa)? No
-  // duplica nada, porque no llega hasta aca: el candado de 30 dias hace que el informe
-  // salga UNA sola vez por cliente. Esta acumulacion solo junta las llamadas de la
-  // primera tanda, que es cuando el cliente lista sus N ventanas.
-  const acumular = (nuevas, viejas) => [
-    ...(Array.isArray(viejas) ? viejas : []),      // primero las de antes: se listan en el
-    ...(Array.isArray(nuevas) ? nuevas : []),      // orden en que se cotizaron
-  ];
-  // 🔴 [2026-08-24 · Gemini, 3a pasada] LA ACUMULACION SE CORTA POR TANDA.
-  // La memoria vive 30 dias y no tenia ningun corte entre proyectos: un cliente que
-  // cotizaba 4 ventanas el lunes y otras 4 el viernes acumulaba OCHO. El candado de 30
-  // dias evita el envio automatico —por eso parecia cubierto— pero NO cubre el re-envio
-  // con `forzar: true`, que es justo cuando el cliente PIDE su informe: recibia un
-  // documento firmado mezclando el proyecto descartado con el nuevo. Y si la segunda
-  // cotizacion es de otra comuna, las ventanas viejas quedan certificadas contra una
-  // exigencia que no les corresponde.
-  //
-  // El corte es POR TIEMPO porque es el unico dato disponible: no hay id de proyecto ni de
-  // tanda. Sin sello (memoria escrita antes de este cambio) se trata como otra tanda:
-  // mostrar de menos es recuperable —el cliente recotiza— y mezclar proyectos no.
-  const selloPrevio = Number(recordados?.ventanasAt);
-  const mismaTanda = Number.isFinite(selloPrevio) && (ahora - selloPrevio) <= TANDA_MS;
-  const traeVentanas = Array.isArray(entrantes?.ventanas) && entrantes.ventanas.length > 0;
-  const ventanas = (traeVentanas && !mismaTanda)
-    ? [...entrantes.ventanas]                       // tanda nueva: reemplaza
-    : acumular(entrantes?.ventanas, recordados?.ventanas);
-  // El sello se renueva con cada ventana que entra; si no entro ninguna, se conserva el
-  // de la tanda que las trajo (un re-envio no puede hacer parecer fresco a un proyecto viejo).
-  const ventanasAt = traeVentanas ? ahora : (Number.isFinite(selloPrevio) ? selloPrevio : null);
-
-  if (hay(entrantes)) return { datos: { ...limpiar(entrantes), ventanas, ventanasAt }, recordar: true };
+  // Con eso, reemplazar es lo que corresponde: cada turno trae su proyecto entero, y lo que
+  // se guarda aca es solo para el RE-ENVIO posterior (cuando el cliente pide el informe y
+  // no viene ninguna ventana en el pedido). Se van tambien los dos problemas que la
+  // acumulacion habia traido: mezclar el proyecto del lunes con el del viernes, y tener que
+  // adivinar cuantos minutos dura una "tanda".
+  if (hay(entrantes)) return { datos: limpiar(entrantes), recordar: true };
   // Aunque no haya datos entrantes, si el acumulado crecio hay que volver a guardarlo.
   if (hay(recordados)) {
-    const rec = limpiar(recordados);
-    const crecio = ventanas.length !== rec.ventanas.length;
-    return { datos: { ...rec, ventanas, ventanasAt }, recordar: crecio };
+    return { datos: limpiar(recordados), recordar: false };
   }
   return { datos: VACIO, recordar: false };
 }
diff --git a/src/oliver-gpt/webhook.informe.test.js b/src/oliver-gpt/webhook.informe.test.js
index 58e7040..ef0c306 100644
--- a/src/oliver-gpt/webhook.informe.test.js
+++ b/src/oliver-gpt/webhook.informe.test.js
@@ -49,7 +49,7 @@ function makeRes() {
  *                  del proyecto de dos ventanas que produjo el duplicado.
  */
 function makeDeps({ disparos = 1, envioOk = true, overrides = {} } = {}) {
-  const spy = { docsEnviados: [], convEvents: [], pdfArgs: [], textos: [] };
+  const spy = { docsEnviados: [], convEvents: [], pdfArgs: [], textos: [], adjuntosZoho: [], notasZoho: [] };
   const estado = new Map();
   let tokenSeq = 0;
   const vigente = (e) => e && (!e.expira || e.expira > Date.now());
@@ -91,6 +91,12 @@ function makeDeps({ disparos = 1, envioOk = true, overrides = {} } = {}) {
     laminasParaInforme: async () => null,
     laminaTermopanel: async () => null,
 
+    upsertZohoDeal: async () => 'deal.777',
+    addZohoNote: async (...a) => { spy.notasZoho.push(a); return { ok: true }; },
+    attachPdfToDeal: async (dealId, buf, filename) => {
+      spy.adjuntosZoho.push({ dealId, bytes: buf?.length || 0, filename });
+      return { ok: true };
+    },
     uploadWaDocument: async () => 'media.1',
     sendWaDocument: async (to, mediaId, filename) => {
       spy.docsEnviados.push({ to, mediaId, filename });
@@ -277,50 +283,95 @@ test('🔒 [Codex · 2a pasada] si Meta rechaza el AVISO, tampoco se registra',
     && e.metadata?.source === 'oliver_gpt_informe_termico'));
 });
 
-// ⚠️ SKIP DELIBERADO — ESTE ES EL LIMITE CONOCIDO DE LA ARQUITECTURA ACTUAL, no un test roto.
-//
-// La barrera de estabilizacion espera a que el total deje de crecer, pero "dejar de crecer"
-// se mide en segundos de quietud (2 lecturas x 1,5 s = 3 s). Una cotizacion puede tardar
-// hasta 15 s (el timeout del engine), asi que una partida lenta todavia puede quedar fuera
-// del PDF. Subir el numero seria adivinar: cualquier N que se elija tiene un caso que lo
-// supera, y mientras tanto el cliente espera.
-//
-// La raiz no es el numero: es que el informe se dispara DENTRO de cada `calcular_cotizacion`
-// y hay que reconstruir el proyecto desde N invocaciones sueltas. Toda la maquinaria de este
-// lote —candado corto, fusion atomica, sello de tanda, esta barrera— existe para compensar
-// eso. Disparando UNA vez al final del turno, el problema desaparece en vez de mitigarse.
+// ── 🔴 [2026-08-24] REDISEÑO: EL INFORME SE DESPACHA AL FINAL DEL TURNO ──────────────
+// Antes se disparaba DENTRO de cada `calcular_cotizacion`, y como esa tool cotiza una
+// partida por llamada, habia que reconstruir el proyecto desde N invocaciones sueltas con
+// memoria compartida. Toda la maquinaria del lote anterior —candado corto, fusion atomica,
+// sello de tanda, barrera de estabilizacion por tiempo— existia solo para compensar eso, y
+// cada arreglo destapaba una carrera nueva en otro lado (4 pasadas de compuerta).
 //
-// Se deja escrito y en skip a proposito: es la especificacion del arreglo que falta, y
-// ponerlo en verde con un timeout mas grande seria tapar el hueco en vez de medirlo.
-test('🔴 [Codex 4a] una ventana que llega TARDE igual entra al informe', { skip: 'limite conocido: la barrera por tiempo no cubre una cotizacion de 15 s — ver nota' }, async () => {
-  // Las tools corren secuencialmente: la ultima partida de un proyecto largo puede
-  // terminar despues de los tiempos humanos. Con una sola foto quedaba afuera del
-  // documento y nadie se enteraba. Ahora se relee hasta que el proyecto deja de crecer.
-  // `dormir` real pero corto: con el instantaneo del resto de los tests, las vueltas de
-  // estabilizacion pasan volando y no le dan tiempo a nadie — el test no probaria nada.
-  const { deps, spy } = makeDeps({ overrides: { dormir: (ms) => new Promise((r) => setTimeout(r, Math.min(ms || 0, 40))) } });
+// El turno es secuencial y termina en un instante conocido. Acumulando en memoria del turno
+// y despachando UNA vez al final, las carreras no se mitigan: dejan de existir.
+
+test('🔴 el informe se despacha UNA vez y DESPUES de que el turno termino', async () => {
+  const { deps, spy } = makeDeps({ disparos: 2 });
+  const original = deps.handleTurn;
+  deps.handleTurn = async (args) => {
+    const r = await original(args);
+    assert.equal(spy.docsEnviados.length, 0,
+      'durante el turno no se manda nada: todavia pueden llegar mas ventanas');
+    return r;
+  };
+  await handleWebhook({ body: {} }, makeRes(), deps);
+  assert.ok(await esperar(() => spy.docsEnviados.length > 0));
+  await new Promise((r) => setTimeout(r, 250));
+  assert.equal(spy.docsEnviados.length, 1, 'un solo informe por turno');
+  assert.deepEqual(spy.pdfArgs.at(-1).ventanas, VENTANAS, 'con las dos ventanas');
+});
+
+test('🔴 una cotizacion LENTA dentro del turno igual entra al informe', async () => {
+  // Este es el caso que la barrera por tiempo no podia cubrir: las tools corren
+  // secuencialmente y una puede tardar hasta 15 s (timeout del engine). Con el despacho al
+  // final del turno el tiempo deja de importar — el turno espera a sus propias tools.
   const tercera = { id: 'V3', producto: 'Fijo S60', medidas: '600x600mm', vidrio: 'DVH 5/12/5', ambiente: 'Baño', cantidad: 1, uw: 2.9 };
+  const { deps, spy } = makeDeps({ disparos: 2 });
   const original = deps.handleTurn;
   deps.handleTurn = async (args) => {
     const r = await original(args);
-    // La cotizacion lenta: llega despues de que el hook ya tomo su primera lectura.
-    setTimeout(() => {
-      args.toolCtx.enviarInformeTermico('Temuco', {
-        glassLabel: tercera.vidrio, uw: tercera.uw, producto: tercera.producto, ventanas: [tercera],
-      });
-      // 300 ms: DESPUES de que el bucle de estabilizacion arranco. Con 60 ms la ventana
-      // llegaba mientras corrian todavia los dos tiempos humanos (2 x 40 ms), o sea antes
-      // de la primera lectura: el test pasaba con UNA sola vuelta y no probaba la barrera.
-      // Lo cazo Codex en la 4a pasada. Un test que pasa por la razon equivocada es peor
-      // que no tenerlo, porque se cuenta como cobertura.
-    }, 300);
+    await new Promise((res) => setTimeout(res, 300));   // la tool lenta
+    args.toolCtx.enviarInformeTermico('Temuco', {
+      glassLabel: tercera.vidrio, uw: tercera.uw, producto: tercera.producto, ventanas: [tercera],
+    });
     return r;
   };
   await handleWebhook({ body: {} }, makeRes(), deps);
   assert.ok(await esperar(() => spy.docsEnviados.length > 0, 6000));
   await new Promise((r) => setTimeout(r, 200));
+  const v = spy.pdfArgs.at(-1).ventanas;
+  assert.equal(v.length, 3, 'las tres ventanas del turno');
+  assert.ok(v.some((x) => x.medidas === tercera.medidas), 'incluida la de la tool lenta');
+});
 
-  const ultimas = spy.pdfArgs[spy.pdfArgs.length - 1].ventanas;
-  assert.ok(ultimas.some((v) => v.medidas === tercera.medidas),
-    'la ventana rezagada tiene que estar en el documento que se mando');
+test('un turno SIN cotizaciones no manda ningun informe', async () => {
+  const { deps, spy } = makeDeps({ disparos: 0 });
+  await handleWebhook({ body: {} }, makeRes(), deps);
+  await new Promise((r) => setTimeout(r, 250));
+  assert.equal(spy.docsEnviados.length, 0);
+});
+
+// ── 🔴 [2026-08-24] EL INFORME SE ARCHIVA, COMO LA COTIZACION ────────────────────────
+// Reclamo del dueño, textual: *"yo abro el sistema y deberia estar guardado... tiene que
+// estar almacenado, al lado de la cotizacion"*. Y tenia razon: del informe solo quedaba un
+// numero de folio y un hash. El PDF no se guardaba en NINGUNA parte — ni adjunto al Deal
+// (como si hace la cotizacion) ni descargable desde el cockpit.
+//
+// Eso convierte "¿le llego el informe?" en una pregunta que el sistema no puede responder,
+// y por lo tanto en una discusion. Un documento firmado que se entrega a un cliente y del
+// que no queda copia tampoco resiste una auditoria ISO.
+
+test('🔴 el PDF del informe queda ADJUNTO al Deal, igual que la cotizacion', async () => {
+  const { deps, spy } = makeDeps();
+  await handleWebhook({ body: {} }, makeRes(), deps);
+  assert.ok(await esperar(() => spy.adjuntosZoho.length > 0), 'tiene que archivarse');
+
+  const adj = spy.adjuntosZoho[0];
+  assert.equal(adj.dealId, 'deal.777');
+  assert.ok(adj.bytes > 0, 'el PDF de verdad, no un puntero');
+  assert.match(adj.filename, /Informe-Termico.*\.pdf$/, 'con nombre distinguible de la propuesta');
+});
+
+test('🔒 se archiva DESPUES de entregar: no se guarda copia de algo que no salio', async () => {
+  const { deps, spy } = makeDeps({ envioOk: false });
+  await handleWebhook({ body: {} }, makeRes(), deps);
+  await new Promise((r) => setTimeout(r, 300));
+  assert.equal(spy.adjuntosZoho.length, 0);
+});
+
+test('🔒 si Zoho falla, el cliente NO pierde su informe', async () => {
+  // El archivo es trazabilidad nuestra; el informe es del cliente. Nunca al reves.
+  const { deps, spy } = makeDeps({
+    overrides: { attachPdfToDeal: async () => { throw new Error('Zoho caido'); } },
+  });
+  await handleWebhook({ body: {} }, makeRes(), deps);
+  assert.ok(await esperar(() => spy.docsEnviados.length > 0), 'el envio no depende de Zoho');
 });
diff --git a/src/oliver-gpt/webhook.js b/src/oliver-gpt/webhook.js
index fade54f..8bc0d13 100644
--- a/src/oliver-gpt/webhook.js
+++ b/src/oliver-gpt/webhook.js
@@ -42,7 +42,7 @@ import {
   normalizar as normalizarTel,
 } from '../../services/atribucionCotizacion.js';
 // [2026-08-08] Estado que sobrevive a un redeploy (respaldo en Postgres). Ver §14b·bis.
-import { leer as leerEstado, escribir as escribirEstado, fusionar as fusionarEstado, reservar as reservarEstado, liberarReserva } from '../../services/estadoPersistente.js';
+import { leer as leerEstado, escribir as escribirEstado, reservar as reservarEstado, liberarReserva } from '../../services/estadoPersistente.js';
 // [2026-08-21] El informe térmico de la comuna, que se manda ANTES de la cotización.
 import { pedirInformeComuna, normalizarComuna, esperarAntesDeEnviar, COMUNA_REFERENCIA, FIRMA, DEMORA_AVISO_MS, datosDelInforme } from '../../services/informeTermico.js';
 import { generarInformeTermicoPdf } from '../../services/informeTermicoPdf.js';
@@ -978,26 +978,24 @@ export async function handleWebhook(req, res, deps = {}) {
       return; // el finally libera el lock
     }
 
-    // ── (6) toolCtx cableado a servicios REALES ──────────────────────────
-    const toolCtx = {
-      telefono: from,
-
-      // ── [2026-08-21] INFORME TÉRMICO ANTES DE LA COTIZACIÓN ──────────────────
-      // Idea del dueño: mandarle al cliente el dato normativo de su comuna JUSTO
-      // cuando Oliver empieza a calcular, "para que lo lea mientras le decimos
-      // preparamos la propuesta". Cuando el precio llega, ya no llega solo.
-      //
-      // Se dispara desde calcular_cotizacion —el momento exacto en que el cliente
-      // queda esperando— y NO desde el PDF, que ya es tarde.
-      //
-      // 🔒 TRES GUARDAS, porque esto le escribe a un cliente real:
-      //   1. UNA SOLA VEZ por teléfono (candado de 30 días). Un informe repetido
-      //      deja de ser un informe y pasa a ser spam.
-      //   2. fire-and-forget: no se espera. La cotización no puede demorarse ni un
-      //      milisegundo por esto — es la regla dura del proyecto.
-      //   3. si THERMAL no responde o no hay dato verificado, NO se manda nada.
-      //      Jamás se inventa un número: son citas normativas.
-      enviarInformeTermico: (comuna, { forzar = false, glassLabel = '', uw = null, producto = '', ventanas = null } = {}) => {
+    // ── 🔴 [2026-08-24] EL INFORME TERMICO SE DESPACHA AL FINAL DEL TURNO ──────────────
+    //
+    // Antes se disparaba DENTRO de `calcular_cotizacion`. Como esa tool cotiza UNA partida
+    // por llamada, un proyecto de ocho ventanas son ocho disparos, y habia que reconstruir
+    // el proyecto desde N invocaciones sueltas con memoria compartida entre ellas. Toda la
+    // maquinaria que eso exigia —candado corto, fusion atomica del estado, sello de tanda,
+    // barrera de estabilizacion por tiempo— existia SOLO para compensar el lugar del
+    // disparo, y cada arreglo destapaba una carrera nueva en otro lado: cuatro pasadas de
+    // compuerta cruzada, cuatro veredictos NO APTO, siempre por lo mismo.
+    //
+    // El turno es secuencial y termina en un instante conocido. Acumulando en memoria del
+    // turno y despachando UNA vez al final, las carreras no se mitigan: DEJAN DE EXISTIR.
+    // No hay dos ejecuciones que coordinar, no hay que adivinar cuantos segundos esperar a
+    // que "deje de crecer", y una tool lenta no puede quedarse afuera porque el turno
+    // espera a sus propias tools.
+    const informeDelTurno = { pedido: false, comuna: '', glassLabel: '', uw: null, producto: '', ventanas: [] };
+
+      const despacharInforme = (comuna, { forzar = false, glassLabel = '', uw = null, producto = '', ventanas = null } = {}) => {
         const clave = `informe_termico:${String(from).replace(/\D/g, '')}`;
         safe('informeTermico', async () => {
           // 🔴 [2026-08-24 · Codex, compuerta cruzada] LA MEMORIA VA ANTES QUE TODO CANDADO.
@@ -1014,21 +1012,17 @@ export async function handleWebhook(req, res, deps = {}) {
           let recordados = null;
           try { recordados = await (deps.leerEstado || leerEstado)(claveDatos); }
           catch { /* sin memoria el informe sale igual, solo sin el recuadro */ }
-          // 🔴 [2026-08-24 · 2a compuerta] LEER-CALCULAR-ESCRIBIR EN UN SOLO PASO ATOMICO.
-          // Antes eran tres pasos con `await` en medio, y tenian la misma carrera que el
-          // candado: las ocho cotizaciones de un proyecto leian la memoria antes de que
-          // ninguna escribiera, cada una se creia la unica y guardaba SU ventana pisando a
-          // las demas. El cliente terminaba con un informe de una ventana.
-          // `fusionar` no tiene ningun await adentro, asi que entre leer y escribir no se
-          // cuela nadie. `recordados` (la ida a Postgres) sirve de semilla cuando la memoria
-          // local esta vacia, que es el caso despues de un redeploy.
-          try {
-            const datosInforme = (deps.fusionarEstado || fusionarEstado)(claveDatos, (local) => {
-              const e = datosDelInforme({ glassLabel, uw, producto, ventanas }, local || recordados);
-              return { valor: e.datos, guardar: e.recordar };
-            }, 30 * 24 * 3600);
-            if (datosInforme) ({ glassLabel, uw, producto, ventanas } = datosInforme);
-          } catch { /* la memoria es un lujo; el informe no depende de ella */ }
+          // [2026-08-24] Escritura simple: el despacho ocurre UNA vez por turno, asi que
+          // no hay dos ejecuciones compitiendo por esta clave. La version anterior usaba un
+          // leer-calcular-escribir atomico (`fusionar`) porque las ocho cotizaciones de un
+          // proyecto escribian aca en paralelo y se pisaban. Ya no escriben aca.
+          const elegido = datosDelInforme({ glassLabel, uw, producto, ventanas }, recordados);
+          ({ glassLabel, uw, producto, ventanas } = elegido.datos);
+          if (elegido.recordar) {
+            try {
+              await (deps.escribirEstado || escribirEstado)(claveDatos, elegido.datos, 30 * 24 * 3600);
+            } catch { /* la memoria es un lujo; el informe no depende de ella */ }
+          }
 
           // `forzar` llega desde la tool enviar_informe_termico: si el cliente lo PIDE, se le
           // manda aunque ya lo tenga. El candado existe para no spamear, no para negarle algo
@@ -1201,49 +1195,10 @@ export async function handleWebhook(req, res, deps = {}) {
             try { if (typeof detenerPuntitos === 'function') detenerPuntitos(); } catch { /* cosmético */ }
           }
 
-          // 🔴 [2026-08-24 · Codex, 2a pasada] SE RELEEN LAS VENTANAS JUSTO ANTES DE ARMAR
-          // EL PDF, no al entrar al hook.
-          //
-          // EL PORQUE: `calcular_cotizacion` cotiza UNA partida por llamada, asi que un
-          // cliente con ocho ventanas dispara ocho veces, con ~100-300 ms entre una y otra
-          // (medido: folios 0003 y 0004). La primera llamada se lleva la reserva y arma el
-          // documento; si tomara la foto en ese instante, el informe saldria con UNA
-          // ventana y las otras siete llegarian tarde. Es el defecto original sobreviviendo
-          // al arreglo.
-          //
-          // Los dos tiempos humanos de arriba —que ya existian para que el informe no
-          // parezca un autoresponder— son la ventana de agrupacion: cuando terminan, las
-          // demas cotizaciones ya escribieron su ventana en la memoria. Un efecto util de
-          // algo que estaba puesto por otra razon, sin agregar ni un segundo de espera.
-          //
-          // 🔴 [Codex · 3a compuerta] Y SE ESPERA A QUE EL PROYECTO DEJE DE CRECER. Una sola
-          // foto no es una barrera: las tools corren SECUENCIALMENTE (agent.js) y cada
-          // cotizacion espera a la anterior, asi que la ultima partida de un proyecto largo
-          // puede terminar despues de los tiempos humanos y quedarse afuera del documento.
-          // El fake de los tests las disparaba todas de una y escondia el escenario.
-          //
-          // Se relee hasta que dos lecturas seguidas dan el mismo total: ahi el proyecto se
-          // estabilizo. Con tope, porque esto corre con el cliente esperando y un informe
-          // con una ventana de menos es mejor que un informe que no llega.
-          const ESPERA_MS = Number(process.env.INFORME_ESTABILIZAR_MS || 1500);
-          const VUELTAS = Number(process.env.INFORME_ESTABILIZAR_VUELTAS || 6);
-          // Se ESPERA PRIMERO y se lee despues: preguntar antes de darle tiempo a nadie
-          // devuelve siempre lo mismo que ya se tenia y el bucle cortaria en la vuelta uno
-          // sin haber esperado nunca. Hacen falta dos lecturas iguales seguidas para
-          // declarar estable el proyecto.
-          let estable = 0;
-          for (let vuelta = 0; vuelta < VUELTAS && estable < 2; vuelta++) {
-            await esperarAntesDeEnviar({ dormir: deps.dormir || null, ms: ESPERA_MS });
-            const antes = ventanas.length;
-            try {
-              const alDia = await (deps.leerEstado || leerEstado)(claveDatos);
-              if (Array.isArray(alDia?.ventanas) && alDia.ventanas.length > ventanas.length) {
-                ventanas = alDia.ventanas;
-              }
-            } catch { /* si la memoria falla se usa lo que ya se tenia */ }
-            estable = ventanas.length === antes ? estable + 1 : 0;
-          }
-
+          // [2026-08-24] Ya no se relee nada aca: las ventanas llegan completas desde el
+          // turno. Lo que habia antes —una barrera que esperaba a que el total "dejara de
+          // crecer"— era una forma de adivinar cuando estaban todas, y no habia numero
+          // correcto: 3 s de quietud contra una cotizacion que puede tardar 15 s.
           const pdfBuf = await (deps.generarInformeTermicoPdf || generarInformeTermicoPdf)(datos, {
             nombre: state.name || '', firma: FIRMA, esReferenciaRegional: esRef, vidrios, laminas, termopanel,
             numeroInforme,
@@ -1305,6 +1260,33 @@ export async function handleWebhook(req, res, deps = {}) {
             },
           }));
 
+          // 🔴 [2026-08-24] EL PDF SE ARCHIVA, COMO LA COTIZACION.
+          // Reclamo del dueño, textual: *"yo abro el sistema y deberia estar guardado...
+          // tiene que estar almacenado, al lado de la cotizacion"*. Tenia razon: del
+          // informe solo quedaba el folio y un sha256. El PDF no se guardaba en ninguna
+          // parte, asi que "¿le llego el informe?" era una pregunta que el sistema no podia
+          // responder — y por eso se volvia una discusion. Un documento firmado entregado a
+          // un cliente del que no queda copia tampoco resiste una auditoria ISO.
+          //
+          // Va DESPUES de la entrega confirmada (no se archiva lo que no salio) y en su
+          // propio `safe`: el archivo es trazabilidad NUESTRA y el informe es del cliente.
+          // Si Zoho esta caido, el cliente ya tiene su documento y eso no se toca.
+          safe('informeTermico.zoho', async () => {
+            const dealId = await upsertZohoDeal({
+              phone: from,
+              name: state.name || '',
+              comuna: datos.comuna || '',
+              stageKey: 'informe_termico',
+            });
+            if (!dealId) return;
+            await addZohoNote(dealId,
+              `Informe térmico entregado: ${numeroInforme}`,
+              `PDF enviado al cliente por WhatsApp.
+Comuna: ${datos.comuna}`
+              + `${esRef ? ' (referencia regional)' : ''}`);
+            await attachPdfToDeal(dealId, pdfBuf, nombreArchivo);
+          });
+
           // [2026-08-24] REGISTRO ISO del informe ENTREGADO — despues del envio, nunca
           // antes (misma regla que el candado: registrar algo que no salio es mentirle a
           // la auditoria). El sha256 identifica el PDF byte a byte: si un dia hay disputa,
@@ -1352,6 +1334,42 @@ export async function handleWebhook(req, res, deps = {}) {
             liberar();
           }
         });
+      };
+
+    // ── (6) toolCtx cableado a servicios REALES ──────────────────────────
+    const toolCtx = {
+      telefono: from,
+
+      // ── [2026-08-21] INFORME TÉRMICO ANTES DE LA COTIZACIÓN ──────────────────
+      // Idea del dueño: mandarle al cliente el dato normativo de su comuna JUSTO
+      // cuando Oliver empieza a calcular, "para que lo lea mientras le decimos
+      // preparamos la propuesta". Cuando el precio llega, ya no llega solo.
+      //
+      // Se dispara desde calcular_cotizacion —el momento exacto en que el cliente
+      // queda esperando— y NO desde el PDF, que ya es tarde.
+      //
+      // 🔒 TRES GUARDAS, porque esto le escribe a un cliente real:
+      //   1. UNA SOLA VEZ por teléfono (candado de 30 días). Un informe repetido
+      //      deja de ser un informe y pasa a ser spam.
+      //   2. fire-and-forget: no se espera. La cotización no puede demorarse ni un
+      //      milisegundo por esto — es la regla dura del proyecto.
+      //   3. si THERMAL no responde o no hay dato verificado, NO se manda nada.
+      //      Jamás se inventa un número: son citas normativas.
+      // El hook que ven las tools. `calcular_cotizacion` REGISTRA su ventana y sigue de
+      // largo —sincrono, sin red, sin candados— y el despacho ocurre al cerrar el turno.
+      // `forzar` viene de la tool `enviar_informe_termico`, o sea el cliente lo esta
+      // pidiendo ahora: eso se despacha en el momento y no espera al final del turno.
+      enviarInformeTermico: (comuna, opciones = {}) => {
+        if (opciones.forzar) return despacharInforme(comuna, opciones);
+        informeDelTurno.pedido = true;
+        if (comuna) informeDelTurno.comuna = comuna;
+        // Los tres campos de resumen son de la ULTIMA cotizacion del turno; las ventanas
+        // se suman. Un array local: sin await en el medio, no hay carrera que resolver.
+        if (opciones.glassLabel) informeDelTurno.glassLabel = opciones.glassLabel;
+        if (opciones.uw !== undefined && opciones.uw !== null) informeDelTurno.uw = opciones.uw;
+        if (opciones.producto) informeDelTurno.producto = opciones.producto;
+        if (Array.isArray(opciones.ventanas)) informeDelTurno.ventanas.push(...opciones.ventanas);
+        return null;
       },
 
       // saveLead → pushLeadEvent (persistencia real del lead).
@@ -2083,6 +2101,19 @@ export async function handleWebhook(req, res, deps = {}) {
       });
     }
 
+    // ── 🔴 (7c) EL INFORME TERMICO, UNA VEZ, CON EL PROYECTO COMPLETO ──────────────
+    // Aca ya corrieron TODAS las tools del turno, asi que `informeDelTurno.ventanas` tiene
+    // el proyecto entero. Es el unico punto del flujo donde eso es cierto sin tener que
+    // adivinar nada. Sigue siendo fire-and-forget: el informe no puede demorar el turno.
+    if (informeDelTurno.pedido && informeDelTurno.ventanas.length) {
+      despacharInforme(informeDelTurno.comuna, {
+        glassLabel: informeDelTurno.glassLabel,
+        uw: informeDelTurno.uw,
+        producto: informeDelTurno.producto,
+        ventanas: informeDelTurno.ventanas,
+      });
+    }
+
     // ── (8) Persistencia POST del turno (inbound + outbound) ────────────
     await safe('persist.inbound', () =>
       bridge.pushConversationEvent({
