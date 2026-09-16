# VEREDICTO — NO APTO

No prendás `OUTBOX_ENABLED`.

El sistema sigue sin tener una obligación durable de entrega: los módulos existen, pero no están conectados al arranque, no hay `INSERT INTO entrega_outbox`, no hay worker de envío y la propuesta continúa saliendo directamente desde el bot. El bug de Katy no está cerrado; sólo tiene más código alrededor.

## 1. ¿Puede recibir dos veces el mismo documento?

Sí.

### Camino A — informe reintentado después de un timeout ambiguo

**VERIFICADO en código / PLAUSIBLE que Meta complete el primer envío.**

1. `sendWaDocument` manda a Meta con timeout de 15 segundos ([whatsapp-adapter.js:24](C:/Users/mcifu/activa/temp-wa/src/sales-agent/whatsapp-adapter.js:24)).
2. Un timeout vuelve como `{ok:false, timedOut:true}` ([whatsapp-adapter.js:190](C:/Users/mcifu/activa/temp-wa/src/sales-agent/whatsapp-adapter.js:190)).
3. `errorMeta` correctamente dice que un timeout es `DESCONOCIDO` ([errorMeta.js:85](C:/Users/mcifu/activa/temp-wa/src/sales-agent/errorMeta.js:85)).
4. Pero ningún código productivo importa ni llama ese clasificador. Está usado sólo por sus tests.
5. El informe térmico mira exclusivamente `envio.ok` ([webhook.js:1901](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:1901)).
6. Ante timeout lo declara fallido, libera la reserva ([webhook.js:1908](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:1908)) y deja que “el próximo turno reintenta” ([webhook.js:1905](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:1905)).
7. Si Meta alcanzó a aceptar el primer POST, el próximo turno manda el mismo informe nuevamente.

La whitelist quedó bien escrita como función pura, pero está muerta en producción.

### Camino B — propuesta reenviada manualmente tras un timeout

**VERIFICADO en código / PLAUSIBLE la doble entrega.**

1. La propuesta se manda directamente desde el webhook ([webhook.js:3633](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3633)).
2. Un timeout ambiguo deja `docSent=false` porque sólo se mira `sendRes.ok` ([webhook.js:3635](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3635)).
3. El bot ordena a Marcelo “enviarlo desde el inbox” ([webhook.js:4269](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:4269)).
4. Si el POST original terminó aceptado por Meta después del timeout, el reenvío manual duplica la propuesta.

### Camino C — el trigger se puede rodear

**VERIFICADO.**

El trigger sólo actúa `BEFORE UPDATE` ([entregaOutbox.js:143](C:/Users/mcifu/activa/temp-sales-os/src/services/entregaOutbox.js:143)) y retorna inmediatamente si el estado no cambia ([entregaOutbox.js:113](C:/Users/mcifu/activa/temp-sales-os/src/services/entregaOutbox.js:113)).

Por lo tanto:

1. Una fila `delivered` cambia `folio`, `variante` o `version`, manteniendo `estado='delivered'`.
2. El trigger retorna antes de aplicar la terminalidad.
3. La llave UNIQUE original queda libre.
4. Se inserta otra fila `pending` con la identidad anterior.
5. Esa fila puede enviarse nuevamente.

`DELETE + INSERT` logra lo mismo. El trigger tampoco cubre `INSERT`, así que se puede crear directamente una fila `reenvio_autorizado` sin `autorizado_por` ni `motivo`.

## 2. ¿Puede volver a ocurrir Katy sin que nadie se entere?

Sí. Hay varios caminos.

### Outbox inexistente en runtime

**VERIFICADO.**

La búsqueda completa encontró:

- `ensureOutbox()` sólo donde se define ([entregaOutbox.js:152](C:/Users/mcifu/activa/temp-sales-os/src/services/entregaOutbox.js:152)).
- `startVigilante()` sólo donde se define ([entregaVigilante.js:191](C:/Users/mcifu/activa/temp-sales-os/src/services/entregaVigilante.js:191)).
- Cero `INSERT INTO entrega_outbox`.
- El startup real no importa ni inicia nada del outbox ([server.js:5437](C:/Users/mcifu/activa/temp-sales-os/src/server.js:5437)).

Prender el flag no crea tabla, no verifica trigger, no crea deuda, no arranca vigilante y no manda documentos.

### HTTP 2xx sin `wamid`

**VERIFICADO el camino / PLAUSIBLE la respuesta externa.**

El adapter devuelve `{ok:true}` aunque `messages[0].id` no exista ([whatsapp-adapter.js:438](C:/Users/mcifu/activa/temp-wa/src/sales-agent/whatsapp-adapter.js:438)). El clasificador sabe que eso es `DESCONOCIDO`, pero no se usa.

El webhook:

- marca `docSent=true`;
- no registra `wamsg` ni evento durable porque exige `waDocMsgId` ([webhook.js:3714](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3714));
- no ejecuta la alerta de fallo;
- guarda la propuesta como enviada.

Es el patrón Katy: estado feliz, cero correlación y cero alarma.

### Propuestas B/C sin rastreo

**VERIFICADO.**

Las opciones B/C descartan el `msgId`; sólo guardan un booleano `ok` ([webhook.js:3931](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3931)). No escriben `wamsg` ni `documento_enviado`.

Si Meta acepta y luego informa `failed`, el handler no encuentra rastro y retorna en silencio ([webhook.js:911](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:911)). El cockpit puede seguir diciendo “enviada”.

### El registro “durable” no cierra la carrera

**VERIFICADO.**

`documento_enviado` se registra después del envío y puede:

- quedar `skipped` por configuración o circuit breaker;
- perder una carrera de seis segundos;
- terminar después con `{ok:false}` sin que nadie observe el resultado.

Eso ocurre en [webhook.js:3750](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3750) y se excluye expresamente de alarma en [webhook.js:3759](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3759).

Además, cuando llega el acuse, el webhook no consulta ese evento durable: sólo consulta `wamsg:<wamid>`. Si el rastro local/KV desapareció, el acuse se ignora.

### El vigilante también puede silenciar casos

Incluso después de cablearlo:

- no selecciona `wamid`, por lo que el árbitro nunca obtiene coincidencia exacta ([entregaVigilante.js:49](C:/Users/mcifu/activa/temp-sales-os/src/services/entregaVigilante.js:49), [entregaArbitro.js:75](C:/Users/mcifu/activa/temp-sales-os/src/services/entregaArbitro.js:75));
- los 200 casos antiguos pueden dejar fuera para siempre toda deuda nueva;
- el mensaje muestra máximo 10 dudosos y 5 restantes ([entregaVigilanteReglas.js:142](C:/Users/mcifu/activa/temp-sales-os/src/services/entregaVigilanteReglas.js:142)), pero marca `alertado_at` para todos ([entregaVigilante.js:173](C:/Users/mcifu/activa/temp-sales-os/src/services/entregaVigilante.js:173));
- `startVigilante()` permite arrancar sin función `avisar`;
- si el primer aviso falla, la fila ya pasó a `dudoso` y no vuelve a alertar hasta seis horas después.

## 3. ¿Está bien el trigger?

No.

**PLAUSIBLE:** la sintaxis PL/pgSQL parece válida.

**NO PUEDO SABERLO:** si compila, existe o está habilitado en la base productiva. Los tests no ejecutan Postgres y no consulté producción.

**VERIFICADO:** no implementa la invariante completa.

Problemas:

- Sólo cubre `UPDATE`, no `INSERT`, `DELETE` ni `TRUNCATE`.
- Permite cambiar identidad y contenido manteniendo el mismo estado.
- No hay `CHECK` para estados válidos.
- `reenvio_autorizado` no exige humano, motivo ni fecha.
- La UNIQUE usa `(tenant_id,tipo,folio,variante,version)` ([entregaOutbox.js:99](C:/Users/mcifu/activa/temp-sales-os/src/services/entregaOutbox.js:99)); no incluye teléfono ni `content_hash`.
- El mismo PDF puede pasar con otro folio, versión, variante, mayúsculas o espacios.

El DDL idempotente sí puede quedar sin aplicar silenciosamente:

1. `DROP TRIGGER` y `CREATE TRIGGER` son consultas independientes, sin transacción ([entregaOutbox.js:155](C:/Users/mcifu/activa/temp-sales-os/src/services/entregaOutbox.js:155)).
2. Si falla después del `DROP`, queda sin trigger.
3. El error se convierte en `{ok:false}` y no aborta el proceso ([entregaOutbox.js:163](C:/Users/mcifu/activa/temp-sales-os/src/services/entregaOutbox.js:163)).
4. Nadie llama la función ni consume ese retorno.
5. `verificarInvariante()` sólo busca el nombre del trigger globalmente ([entregaOutbox.js:178](C:/Users/mcifu/activa/temp-sales-os/src/services/entregaOutbox.js:178)); acepta uno homónimo, deshabilitado, viejo o instalado sobre otra tabla.

## 4. ¿Fase 0 rompió lo que funcionaba?

### Adapter

**VERIFICADO:** la forma principal `{ok,error,msgId}` quedó compatible y `wamid` es aditivo. No encontré consumidores que dependan de las propiedades nuevas.

Hay una diferencia menor: si `response.data` es string, ahora `JSON.stringify` agrega comillas ([whatsapp-adapter.js:196](C:/Users/mcifu/activa/temp-wa/src/sales-agent/whatsapp-adapter.js:196)). No encontré comparaciones exactas contra ese texto.

El problema no es compatibilidad: es que el nuevo contrato seguro no se usa.

### `logOliverEvent`

**VERIFICADO — regresión real.**

Agregar la función activó ramas que antes estaban muertas. Cada turno de WhatsApp ahora hace `await logOliverEvent('turn_completed')` ([webhook.js:4830](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:4830)) antes de persistir la sesión ([webhook.js:4840](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:4840)) y liberar el mutex.

Con el retry actual puede retener el turno aproximadamente 21,5 segundos ([salesOsBridge.js:183](C:/Users/mcifu/activa/temp-wa/services/salesOsBridge.js:183)). La misma regresión existe para otros canales en [channel-agent.js:1219](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/channel-agent.js:1219).

### Rama nueva de acuses

**VERIFICADO — insuficiente y con pérdida posible.**

- Se responde 200 a Meta antes de procesar el status ([webhook.js:790](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:790)). Un crash posterior pierde el acuse sin reentrega.
- `documento_entregado` es fire-and-forget y sólo tiene `.catch`; el bridge normalmente resuelve `{ok:false}` en vez de rechazar, por lo que el fallo queda invisible ([webhook.js:897](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:897)).
- Sólo `delivered` se registra; un `read` que llegó sin `delivered` se ignora aunque implique entrega.
- Dos `failed` concurrentes pueden leer el mismo rastro antes de borrarlo y emitir dos avisos.
- Si un payload contiene acuses y además un mensaje entrante en otra entrada, el handler procesa los acuses y retorna en [webhook.js:989](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:989). **PLAU­SIBLE:** el mensaje del cliente puede perderse si Meta agrupa ambos.

## 5. ¿Es seguro prender?

No.

Antes de prender, como mínimo:

1. Crear la deuda `pending` antes del envío, en el mismo flujo que emite/promete la propuesta.
2. Tener un solo remitente. El envío directo actual debe ser reemplazado, no coexistir con el worker.
3. Cablear `ensureOutbox()` y una verificación exacta al startup, con fallo cerrado.
4. Ejecutar DDL en una transacción y conexión reservada; verificar tabla, función, trigger habilitado e índice real.
5. Conectar `errorMeta.clasificar()` al único sender. Timeout, 5xx, `ok` sin `wamid` y resultado raro deben quedar `dudoso`, nunca liberar reintento.
6. Corregir el vigilante: seleccionar `wamid`, `tipo`, `variante`, `version`; eliminar starvation; avisar todos los casos que marca; validar `{ok:true}` del canal.
7. Usar una misma conexión para tomar y liberar el advisory lock. Hoy ambos `pool.query()` pueden usar sesiones distintas ([entregaVigilante.js:125](C:/Users/mcifu/activa/temp-sales-os/src/services/entregaVigilante.js:125), [entregaVigilante.js:186](C:/Users/mcifu/activa/temp-sales-os/src/services/entregaVigilante.js:186)).
8. Registrar y consumir durablemente tanto `delivered/read` como `failed`, incluyendo opciones B/C.
9. Probar crashes en cada frontera: antes de enviar, después de enviar, antes del `wamid`, después del ACK y durante autorización humana.

## 6. Lo que no vieron los revisores anteriores

Los puntos nuevos que rompen el diseño son:

- El outbox entero está huérfano: no existe integración runtime ni enqueue.
- La whitelist es código muerto.
- El árbitro no recibe `wamid`; sus tests inventan filas más completas que las que entrega el runner.
- El advisory lock de sesión está usado con conexiones del pool no fijadas.
- El throttle marca como avisados casos truncados que nunca aparecieron en el mensaje.
- `LIMIT 200 ORDER BY created_at ASC` permite starvation permanente.
- Las opciones B/C no tienen rastreo de acuses.
- `logOliverEvent` volvió bloqueante el final de cada turno.
- Los tests nuevos de sales-os son `.test.js`, pero `npm test` sólo ejecuta `.test.mjs` ([package.json:8](C:/Users/mcifu/activa/temp-sales-os/package.json:8)).
- `A_FALLIDO` está probado en la función pura, pero es código muerto: el runner sólo consulta `documento_entregado`.
- La “evidencia” temporal usa `Math.abs`, por lo que un acuse de informe anterior puede presentarse como “probablemente esta propuesta”, especialmente en un caso como Katy donde sí salieron otros documentos.

## Estado de las correcciones anteriores

| Corrección | Estado |
|---|---|
| Trigger Postgres | **MAL RESUELTO**: no se instala, es rodeable y no es transaccional. |
| `variante` separada de `version` | **PARCIAL**: schema separado, pero runner/avisos no cargan esos campos. |
| Sin `Promise.race` alrededor de Meta | **MAL RESUELTO**: siguen existiendo races que envuelven funciones que internamente envían informes ([webhook.js:3529](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:3529)). |
| Whitelist de errores | **INERTE**: ningún consumidor productivo. |
| Piso de 150 s | **IMPLEMENTADO**, pero el vigilante no arranca. |
| `alertado_at` | **MAL RESUELTO**: silencia alertas nuevas y casos no mostrados. |
| Reloj de base | **IMPLEMENTADO**, pero sin runner operativo. |
| Advisory lock | **MAL RESUELTO**: lock/unlock pueden usar sesiones distintas. |
| Wamid desconocido no cierra | **BIEN en la regla pura**, roto en integración: falta el wamid exacto y la evidencia se pierde. |

Verificación ejecutada en sólo lectura:

- Fase 0 dirigida: **32 pass, 0 fail**.
- Outbox/vigilante/árbitro dirigidos: **58 pass, 0 fail**.
- Sintaxis de los nueve archivos: sin errores.
- Esos verdes no cubren Postgres, startup, worker, locks, canal de alertas ni carreras.
- No modifiqué archivos. Los archivos no rastreados de `temp-wa` ya estaban presentes.
