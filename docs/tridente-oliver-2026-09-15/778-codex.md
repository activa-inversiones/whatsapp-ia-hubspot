## VEREDICTO

La causa exacta de Katy sigue en **NO PUEDO SABERLO**. El código actual contradice la explicación fácil: después del video no hay un `return`, un corte por `turnoVigente` ni un `await` productivo sin techo que pueda borrar anticipo y propuesta por dos horas.

- **P‑A: NO APTO** tal como está descrito.
- **P‑B: NO APTO.**
- **P‑C: NO APTO** como solución; sirve sólo como complemento después de rediseñarlo.

## La causa raíz está mal cerrada

- **VERIFICADO — la tool sí se ejecutó.** El folio se obtiene y marca antes de generar el PDF ([webhook.js:2897](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:2897), [webhook.js:2928](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:2928)); luego se genera `pdfBuffer` ([webhook.js:3087](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3087)); recién después existe el copy de promesa ([webhook.js:3439](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3439)). El diagnóstico escrito en `promesaIncumplida.js`, que culpa al LLM por no llamar la tool, es falso ([promesaIncumplida.js:29](C:/Users/mcifu/activa/temp-wa/services/promesaIncumplida.js:29)).

- **VERIFICADO — después del video no existe un retorno que saltee el precio.** El flujo es video → espera precio ([webhook.js:3528](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3528), [webhook.js:3537](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3537)) → anticipo ([webhook.js:3557](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3557)) → upload y envío del PDF ([webhook.js:3588](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3588)). Los `return` de `turnoVigente` viven dentro de video y vientos; no retornan desde `generarPdf` ([webhook.js:3107](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3107), [webhook.js:3184](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3184)).

- **VERIFICADO — no hay un await infinito en esa cola final productiva.** La espera se limita a 90 segundos ([informeTermico.js:307](C:/Users/mcifu/activa/temp-wa/services/informeTermico.js:307)); producción llama al handler sin inyectar un `dormir` alternativo ([index.js:5498](C:/Users/mcifu/activa/temp-wa/index.js:5498)); texto y envío heredan 15 segundos de Axios ([whatsapp-adapter.js:20](C:/Users/mcifu/activa/temp-wa/src/sales-agent/whatsapp-adapter.js:20)); el upload tiene 30 segundos ([whatsapp-adapter.js:363](C:/Users/mcifu/activa/temp-wa/src/sales-agent/whatsapp-adapter.js:363)). Con proceso y event loop vivos, después del video debería intentarse el PDF en minutos, no horas.

- **VERIFICADO — “request abortado” no explica esto.** El webhook responde `200` antes de trabajar y después sigue en el mismo proceso ([webhook.js:790](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:790)). No se propaga ningún `AbortSignal` desde la conexión HTTP hacia la secuencia.

- **VERIFICADO — `proveedorDelTurno()` no participa.** Sólo arma metadata del cerebro y ante error devuelve `{}` ([webhook.js:713](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:713)). No puede cortar anticipo ni propuesta.

- **NO PUEDO SABERLO — qué ocurrió exactamente a las 18:01.** El código actual, los datos citados y la ausencia de logs no alcanzan para reconstruir ese salto. Las 35 pruebas ejecutadas pasaron; 18 cubren la secuencia, incluidos cuelgues de informe, vientos y video. No cubren pérdida de instancia ni desaparición entre video y anticipo.

## Qué sí puede dejar al cliente sin nada y sin tabla

1. **PLAUSIBLE — ambos envíos fallaron, pero la evidencia también falló.** El adapter convierte el fallo del anticipo en `{ok:false}` ([whatsapp-adapter.js:157](C:/Users/mcifu/activa/temp-wa/src/sales-agent/whatsapp-adapter.js:157)); el PDF también absorbe rechazo/excepción ([webhook.js:3588](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3588)). Los rastros posteriores —archivo, espejo y alerta— usan `safe()` o fire-and-forget ([webhook.js:3611](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3611), [webhook.js:3702](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3702), [webhook.js:4181](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:4181)). Una falla encadenada deja sólo consola.

2. **VERIFICADO — `safe()` traga errores que deberían generar deuda durable.** Captura, loguea y devuelve `null` ([webhook.js:662](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:662)); además envuelve todo `generarPdf` ([webhook.js:2232](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:2232)). No crea incidente, reintento ni fila fallida.

3. **VERIFICADO — la “persistencia” usada por los candados tampoco confirma Postgres.** `escribirEstado` guarda en un `Map` y dispara el PUT en segundo plano, tragándose el error ([estadoPersistente.js:92](C:/Users/mcifu/activa/temp-wa/services/estadoPersistente.js:92)). Por eso un `await escribirEstado(...)` no significa “ya quedó en tabla”.

4. **VERIFICADO — el mutex queda tomado si una promesa nunca termina.** `acquireLock` espera sin timeout ni lease ([webhook.js:399](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:399)); sólo libera al llegar al `finally` ([webhook.js:4764](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:4764)). `safe()` no ayuda contra una promesa pendiente: sólo captura rechazos. Existe al menos un await amplio sin techo en la generación del PDF ([webhook.js:3087](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3087), [quotePdf.js:75](C:/Users/mcifu/activa/temp-wa/services/quotePdf.js:75)), aunque ocurre antes de la promesa y no explica a Katy.

5. **PLAUSIBLE — el cron y `eventDispatcher.init` no prueban que sobreviviera la misma instancia.** Lock, turno y dedupe son locales al proceso ([webhook.js:391](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:391), [webhook.js:744](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:744)). Con más de una réplica, otra instancia puede seguir corriendo cron. Sin `instance_id`, esto queda abierto.

## P‑A — NO APTO

“Persistir pendiente y que un worker mande en N minutos” rompe varias cosas:

- **VERIFICADO — no existe un PDF durable antes de la secuencia.** Sólo hay un buffer en memoria ([webhook.js:3087](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3087)); se intenta guardar después del envío ([webhook.js:3606](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3606)). Persistir únicamente folio + pendiente deja al worker sin el documento exacto.

- **VERIFICADO — el dedupe actual sabotea el rescate.** La firma se marca antes de enviar ([webhook.js:2928](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:2928)). Durante dos minutos un reintento retorna `ok:true, pdf_sent:false` sin mandar nada ([webhook.js:2847](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:2847)). Después puede pedir otro correlativo porque `state.last_quote` sólo se escribe mucho más tarde ([webhook.js:4168](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:4168)).

- **VERIFICADO — el worker pierde con cualquiera de las dos estrategias de lock.** Si respeta el mutex local, queda detrás del turno colgado. Si corre aparte, no comparte lock y compite con el turno original. Los `Promise.race` sólo dejan de esperar; no cancelan al perdedor ([webhook.js:3484](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3484)). Puede enviar el worker y luego enviar el turno viejo.

- **VERIFICADO — existe una ventana imposible de resolver con el diseño actual.** Meta puede aceptar el PDF ([webhook.js:3590](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3590)) y el proceso fallar antes de guardar `wamsg` ([webhook.js:3671](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3671)). Reintentar duplica; no reintentar puede perder. El adapter no manda una clave idempotente ([whatsapp-adapter.js:391](C:/Users/mcifu/activa/temp-wa/src/sales-agent/whatsapp-adapter.js:391)).

Para volver a evaluarlo: outbox real con `INSERT` confirmado antes de prometer; PDF/blob o payload canónico versionado; `UNIQUE(sequence_id, folio, variante)`; claim transaccional con lease distribuido; una sola rutina de entrega compartida por turno y worker; estados `pending → claimed → meta_accepted → delivered|failed`; intentos, error e `instance_id`; y tratamiento explícito de A/B/C.

## P‑B — NO APTO

Mandar el precio primero no arregla la obligación del dueño: sólo mueve la cola frágil hacia los informes.

En modo clásico, el térmico se dispara fire-and-forget después del PDF ([webhook.js:3644](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3644)); vientos sólo se llama dentro del modo informe‑primero ([webhook.js:3508](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3508)). Además, un inbound nuevo corta video o vientos ([webhook.js:3107](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3107), [webhook.js:3184](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3184)). Resultado: precio asegurado, informes no asegurados. Sigue incumpliendo “los tres documentos”.

## P‑C — NO APTO

Hoy ni siquiera observa de verdad:

- **VERIFICADO — `promesaIncumplida.js` no está cableado.** El propio archivo dice que un caller externo debe consultar y enviar ([promesaIncumplida.js:37](C:/Users/mcifu/activa/temp-wa/services/promesaIncumplida.js:37)); en el repo sólo lo usan sus tests.

- **VERIFICADO — el monitor antiguo está en V1.** Oliver GPT retorna antes en [index.js:5501](C:/Users/mcifu/activa/temp-wa/index.js:5501); el monitor corre recién en [index.js:6669](C:/Users/mcifu/activa/temp-wa/index.js:6669).

- **VERIFICADO — además confunde total calculado con PDF enviado.** `hasQuote = pdfSent || grand_total` ([stuckLeadMonitor.js:131](C:/Users/mcifu/activa/temp-wa/services/stuckLeadMonitor.js:131)). Una cola muerta después de calcular queda falsamente como `formal_sent`. Y el filtro batch exige al menos cuatro inbound ([stuckLeadMonitor.js:76](C:/Users/mcifu/activa/temp-wa/services/stuckLeadMonitor.js:76)).

- **VERIFICADO — `oliver_events` tampoco está conectado al bridge real.** El webhook sólo escribe si existe `bridge.logOliverEvent` ([webhook.js:4741](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:4741)); `salesOsBridge` no exporta esa función ([salesOsBridge.js:218](C:/Users/mcifu/activa/temp-wa/services/salesOsBridge.js:218), [salesOsBridge.js:244](C:/Users/mcifu/activa/temp-wa/services/salesOsBridge.js:244)).

Como complemento necesitaría un watchdog fuera del webhook, eventos durables por `sequence_id`, dedupe de alertas, ACK y estado basado en acuses `delivered/failed`. “Meta aceptó” no equivale a entrega; el propio código lo reconoce ([webhook.js:853](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:853)).

## La que lo mata

**VERIFICADO — no existe una obligación durable de entrega.** El sistema promete, pero ninguna fila queda como deuda exigible que otro proceso deba completar. Todo depende de que una única continuación async llegue viva hasta `sendWaDocument`.

## LO QUE EL PLAN NO VIO

- La marca `quotesig` previa al envío puede impedir el rescate y devolver un falso éxito sin PDF.
- El PDF no existe durablemente cuando P‑A pretende crear el pendiente.
- La deuda no es una sola propuesta: si falta color, es la tanda A/B/C; B y C recién se generan después de A ([webhook.js:3733](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3733)).
- Se publica `status:'sent'` antes de evaluar `if (!docSent)` ([webhook.js:4059](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:4059), [webhook.js:4166](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:4166)). La propia observabilidad puede mentir.
- La promesa se espeja con `safe()` sin `await` ([webhook.js:1653](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:1653)). P‑C puede quedar ciego al evento que pretende vigilar.
- “Sin rastro” es demasiado absoluto: queda `RECENT_QUOTES` y se intenta persistir `quotesig`. Lo que no existe es persistencia confirmada del estado de entrega.
- Exactamente una entrega no está resuelto. Sin idempotencia de Meta, hay que declarar la semántica real: **at-least-once con duplicado tolerable**, o aceptar que algunos casos seguirán requiriendo conciliación.
