# DISEÑO #778 v2 — obligación durable de entrega, SIN duplicados
Fecha: 2026-09-15 · v1 fue **NO APTO** (Kimi K3). Esta v2 responde sus 12 puntos uno por uno.

## Rol de ustedes
**ABOGADOS DEL DIABLO.** Rompan la v2. La v1 se cayó por tres caminos de duplicación y dos que
reproducían el bug original; si la v2 sigue teniendo uno solo, no sirve.

## LA REGLA DEL DUEÑO (innegociable)
> *"debemos enviarle una sola y si él la modifica otra, o los colores que quiera, pero 2 veces la
> misma no se puede: es una falta de respeto al cliente por el poco cuidado que le colocamos a él"*

Semántica: **a lo sumo UNA entrega automática**. Ante la duda NO se reenvía.
⚠️ Y la otra mitad, que la v1 rompía: **una propuesta MODIFICADA sí debe poder salir.**

## Qué cambia respecto de la v1 (los 12 puntos de Kimi)

**K1 · El huérfano del `Promise.race`.**
→ **Se prohíbe el `Promise.race` alrededor del envío a Meta.** El timeout vive DENTRO del cliente
HTTP (`AbortSignal.timeout`, que sí cancela la request), nunca como carrera externa. Una llamada
abandonada que igual entrega es la causa #1 de duplicado.

**K2 · Lease vencido con la llamada en vuelo.**
→ Toda transición post-Meta lleva **guarda de estado + fencing**:
```sql
UPDATE entrega_outbox SET estado='meta_accepted', wamid=$1, meta_accepted_at=now()
 WHERE id=$2 AND estado='claimed' AND instance_id=$3 AND intentos=$4
RETURNING *;
```
Sin fila devuelta ⇒ otro tomó la fila ⇒ **no se envía nada y se registra el conflicto**.

**K3 · `instance_id` "columna decorativa".**
→ Pasa a ser fencing token real: aparece en el `WHERE` de cada UPDATE post-claim (ver K2).

**K4 · El dedupe que miente.**
→ `entregarPendiente()` **NO pasa por el dedupe por firma** (`quotesig`). La única barrera
anti-duplicado es la UNIQUE del outbox + el estado de la fila. El `quotesig` queda solo para el
camino legacy y **no decide envíos** del outbox.
→ Además: **sin `wamid` NO se transiciona a `meta_accepted`.** Si el envío "salió ok" pero no
devolvió id, la fila queda `dudoso`, nunca `meta_accepted`.

**K5 · El pozo de `meta_accepted`.**
→ Alerta por `meta_accepted` con más de N horas sin `delivered`. El worker SÍ los mira (solo para
alertar; nunca los reenvía).

**K6 · `failed` huérfano.**
→ El worker levanta `failed` y alerta. `failed` es terminal para el automatismo, **no para la
atención**: entra en la lista de conciliación.

**K7 · "Un /dev/null con UI".**
→ La conciliación **NOTIFICA** (WhatsApp al dueño), no espera a que alguien mire una pantalla. Y
cada caso llega **con su evidencia**: si hay `wamid`, si hubo acuse, el `last_error` y la hora.
Sin evidencia el humano duplica, y el humano es hoy el vector de duplicación.

**K8 · Los 6 INSERT no eran una transacción.**
→ **Una sola transacción** para la tanda completa: N PDFs + N filas de outbox + `batch_id`.
Si algo falla, no queda ni PDF huérfano ni fila parcial, y **no se le promete nada al cliente**.

**K9 · Unidad de entrega indefinida.**
→ El claim sigue siendo por fila (para no bloquear la tanda entera por un PDF), pero existe
`batch_id` y la conciliación muestra **la tanda completa con el estado de cada pieza**. El dueño
nunca ve "media tanda" sin saber qué falta.

**K10 · 🔴 `variante` sobrecargada — el que rompía la regla del dueño.**
→ Se separan dos conceptos que la v1 mezclaba:
  - `variante` = **color** (`''`/`B`/`C`) — la tanda blanco/nogal/new black
  - `version` = **corrección pedida por el cliente** (1, 2, 3…)
→ `UNIQUE (tenant_id, tipo, folio, variante, version)`.
Así la propuesta corregida SÍ puede salir (`version=2`) sin chocar con la original, y sigue siendo
imposible mandar dos veces **la misma** (mismo folio+variante+version).

**K11 · Poison pill.**
→ `WHERE intentos < N` en la consulta del worker. Al superar N ⇒ `failed` terminal + alerta.

**K12 · Regresión de estado por doble escritor.**
→ Máquina de estados con **guarda explícita en cada transición** (ver K2). El acuse solo puede
`meta_accepted → delivered` y `dudoso → delivered`; nunca al revés.

**Extra · El mutex sin lease sigue existiendo y NO lo arregla este diseño.** Queda declarado como
límite conocido: el outbox garantiza la ENTREGA, no que el cliente pueda volver a CONVERSAR si el
candado de su teléfono quedó tomado. Es un pendiente aparte, no se tapa con esto.

**Extra · Reenvío pedido por el cliente** ("la borré, mándamela de nuevo"): NO crea fila nueva. Se
toma la fila existente y se la marca `reenvio_manual` con quién lo pidió. ⚠️ **PREGUNTA ABIERTA
PARA EL DUEÑO**, todavía sin respuesta: ¿reenvío del mismo documento, o se emite una nueva con su
propio folio? Mientras no conteste, el diseño NO implementa esa rama.

## Lo que se les pide
1. **¿Queda ALGÚN camino de duplicación?** Paso a paso. Es la pregunta que importa.
2. **¿Queda algún camino donde el cliente no reciba nada y nadie se entere?**
3. ¿La transacción única de K8 es realista con PDFs de varios MB en `bytea` sobre una tabla que ya
   pesa 777 MB? ¿Qué se rompe si esa transacción es lenta?
4. ¿`UNIQUE (tenant_id, tipo, folio, variante, version)` tiene algún caso legítimo que bloquee?
5. ¿Qué NO vieron ni Kimi ni Gemini?
Veredicto **APTO / APTO CON CAMBIOS / NO APTO**.

## Reglas duras
SOLO LECTURA. No editar, no crear archivos, no git, no deploy, no abrir `.env`.
Español chileno, sin humo, sin adular. VERIFICADO / PLAUSIBLE / NO PUEDO SABERLO.
