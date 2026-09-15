# DISEÑO #778 — obligación durable de entrega, SIN duplicados
Fecha: 2026-09-15 · repos: `temp-wa` (bot) + `temp-sales-os` (Postgres)

## Rol de ustedes
**ABOGADOS DEL DIABLO.** Este diseño nace de que ustedes declararon NO APTO a las tres
opciones anteriores. No lo validen: rómpanlo. Si tiene un agujero, tiene que salir acá.

## LA REGLA DEL DUEÑO (decidida hoy, textual)
> *"debemos enviarle una sola y si él la modifica otra, o los colores que quiera, pero
> 2 veces la misma no se puede: es una falta de respeto al cliente por el poco cuidado
> que le colocamos a él"*

⇒ **Semántica elegida: A LO SUMO UNA entrega automática por documento.**
Ante la duda NO se reenvía: el caso va a una lista de conciliación humana.
Esto NO es una limitación técnica aceptada a regañadientes: es la decisión del dueño, y
cualquier diseño que pueda duplicar queda descalificado aunque sea más simple.
(La otra rama —at-least-once con duplicado tolerable— queda DESCARTADA por el dueño.)

## El problema, ya adjudicado por ustedes
> *"No existe una obligación durable de entrega. El sistema promete, pero ninguna fila
> queda como deuda exigible que otro proceso deba completar."* (Codex, 15-sep)

Caso Katy (conv `36f82b64`): folio `CM-FR-004-2026-0462` emitido, informes térmico y de
vientos entregados, video entregado, **propuesta nunca enviada**, cero filas, cero alertas.
El dueño la mandó a mano 2 h después desde otra plataforma.

## Restricciones que ustedes mismos levantaron (el diseño las tiene que cumplir)
1. **No hay PDF durable** antes de la secuencia: solo un buffer en memoria (`webhook.js:3087`).
2. **El dedupe sabotea el rescate**: `quotesig` se marca ANTES de enviar (`:2928`); un reintento
   devuelve `ok:true, pdf_sent:false` sin mandar nada (`:2847`).
3. **`escribirEstado` no confirma Postgres**: guarda en un `Map` y dispara el PUT en segundo
   plano tragándose el error (`estadoPersistente.js:92`). Un `await` ahí no prueba persistencia.
4. **El mutex no tiene lease**: `acquireLock` espera sin timeout (`webhook.js:399`) y solo suelta
   en el `finally` (`:4764`). Una promesa colgada lo deja tomado para siempre.
5. **`Promise.race` no cancela al perdedor** (`:3484`): el worker podría mandar y después mandar
   también el turno viejo.
6. **Ventana sin cierre**: Meta acepta el PDF (`:3590`) y el proceso muere antes de guardar
   `wamsg` (`:3671`). El adapter no manda clave idempotente (`whatsapp-adapter.js:391`).
7. **La deuda no es un documento, es una tanda**: sin color van A/B/C, y B y C se generan
   después de A (`:3733`).
8. **`status:'sent'` se publica antes de `if (!docSent)`** (`:4059` vs `:4166`).
   ⚠️ Medido igual: 272 folios en 30 días, 272 con PDF real en `media_attachments`, 0 sin.
   Es bomba sin estallar, no problema activo — pero el diseño no debe apoyarse en ese campo.
9. **`instance_id` no existe**: lock, turno y dedupe son Maps locales (`:391`, `:744`). No se
   puede afirmar que no haya más de una réplica.

## EL DISEÑO

### D1 — Tabla `entrega_outbox` (Postgres, en sales-os)
```
id                uuid pk
tenant_id         text
conversation_id   text
phone             text
tipo              text     -- propuesta | informe_termico | informe_vientos | video | anticipo
folio             text     -- CM-FR-004-2026-0462
variante          text     -- '' | B | C  (la tanda de colores)
media_id          uuid     -- FK al PDF ya guardado (ver D2). NULL para textos.
content_hash      text     -- sha256 del payload canónico
estado            text     -- pending|claimed|meta_accepted|delivered|failed|dudoso
intentos          int default 0
instance_id       text
wamid             text
last_error        text
created_at, claimed_at, meta_accepted_at, delivered_at, updated_at
UNIQUE (tenant_id, tipo, folio, variante)
```
La UNIQUE es la que hace imposible la segunda entrega del MISMO documento: no hay dos filas
para el mismo (tipo, folio, variante), y la fila solo se entrega si está `pending`.

### D2 — El PDF se guarda ANTES de prometer nada
`media_attachments` ya guarda bytes (`media_data`). Secuencia obligatoria:
1. generar `pdfBuffer`
2. **INSERT confirmado** del PDF en `media_attachments` → `media_id`
3. **INSERT confirmado** de las filas de outbox (una por variante A/B/C) en estado `pending`
4. **recién entonces** se le escribe al cliente la promesa

Si 2 o 3 fallan, no se promete nada. Hoy se promete primero y se persiste después — al revés.

### D3 — Una sola rutina de entrega, usada por el turno y por el worker
`entregarPendiente(row)`. Nadie más llama a `sendWaDocument` para estos documentos.
Elimina el riesgo de "dos caminos que mandan lo mismo".

### D4 — Claim transaccional con lease
```sql
UPDATE entrega_outbox
   SET estado='claimed', claimed_at=now(), instance_id=$1, intentos=intentos+1
 WHERE id=$2 AND estado='pending'
RETURNING *;
```
Sin fila devuelta ⇒ otro la tomó ⇒ no se hace nada. Es el candado real, en la BD, no un Map.

### D5 — La ventana de Meta, resuelta por la regla del dueño
- antes de llamar a Meta: la fila ya está `claimed` (persistido, confirmado)
- Meta responde ok ⇒ `meta_accepted` + `wamid`
- **el proceso muere entre medio ⇒ la fila queda `claimed` con lease vencido y sin `wamid`**

Ese es el único caso ambiguo, y acá manda la regla del dueño:
**NO se reenvía.** El worker la marca `dudoso` y la pone en la lista de conciliación con su
folio, su cliente y su hora. El dueño mira y decide. Nunca sale una segunda copia sola.
- el webhook de `statuses` que ya existe (`webhook.js:868`, rastro `wamsg`) mueve
  `meta_accepted → delivered`, y además puede rescatar un `dudoso` si el acuse llega.

### D6 — El worker
Cron cada minuto: toma `pending` con `created_at < now()-90s` (el turno normal tarda 1-3 min),
y `claimed` con lease vencido → `dudoso`. Nunca toca `meta_accepted` ni `delivered`.

### D7 — Qué se hace con lo viejo
`quotesig` (`:2928`) deja de ser la barrera anti-duplicado: esa función pasa a la UNIQUE del
outbox. Se mantiene por compatibilidad pero ya no decide si se envía.

## Lo que se les pide
1. **Rompan D5.** ¿Hay un escenario donde el cliente igual reciba dos veces el mismo PDF?
2. **Rompan D2.** ¿Se puede prometer sin que las filas estén confirmadas? ¿Qué pasa si el
   INSERT del PDF (bytes, puede ser MB) es lento o falla a mitad?
3. **¿La UNIQUE es la correcta?** ¿`(tenant_id, tipo, folio, variante)` alcanza, o hay un caso
   legítimo donde el MISMO folio+variante deba re-enviarse (cliente que pide "mándamela de
   nuevo, la borré")? Ojo: eso lo pediría el cliente, no el sistema.
4. **¿El worker puede pelear con el turno?** Con D3+D4, ¿queda alguna carrera?
5. **¿Qué cuesta de más?** ¿Bytes de PDF en Postgres, latencia agregada antes de la promesa?
6. Veredicto **APTO / APTO CON CAMBIOS / NO APTO** con el cambio concreto, y
   **"LO QUE EL DISEÑO NO VIO"**.

## Reglas duras
SOLO LECTURA. No editar, no crear archivos fuera de su informe, no `git add/commit/push`, no
deploy, no abrir `.env`. Español chileno, sin humo, sin adular. Citar `archivo:línea`.
Marcar VERIFICADO / PLAUSIBLE / NO PUEDO SABERLO.
