# DISEÑO #778 v3 — la invariante que faltaba
Fecha: 2026-09-15 · v1 NO APTO · v2 APTO CON CAMBIOS (Kimi) / APTO CON CAMBIOS (Gemini)

## LA INVARIANTE (esto es lo que faltaba, y es la regla del dueño hecha código)

> **Una fila que salió de `pending` NUNCA vuelve a `pending` automáticamente.**
> `claimed` solo puede ir a `meta_accepted`, `dudoso` o `failed`. **NUNCA a `pending`.**
> Ningún proceso reenvía jamás una fila cuyo resultado de envío es desconocido.

Los dos revisores, por caminos distintos, encontraron el MISMO agujero en la v2: el proceso envía,
Meta acepta, el proceso muere antes de anotar el `wamid`, y **otro worker retoma la fila vencida y
reenvía**. Eso duplica.

La causa real no es el fencing ni el lease: es que **la v2 no prohibía explícitamente el re-claim
para envío**. El fencing protege el ESTADO, no el ENVÍO — textual de Kimi, y tiene razón.

Con la invariante, el lease sirve para UNA sola cosa: mover `claimed` viejo → `dudoso` (que es un
estado de atención humana), nunca devolverlo a la cola. Se pierde reintento automático; se gana
que el cliente jamás reciba dos veces lo mismo. **Ese es exactamente el intercambio que eligió el
dueño**, textual: *"2 veces la misma no se puede, es una falta de respeto al cliente"*.

## Los 5 bloqueantes de Kimi, resueltos

**B1 · El claim no tenía fencing declarado.** (Era omisión de mi documento, no del diseño.)
```sql
UPDATE entrega_outbox
   SET estado='claimed', claimed_at=now(), instance_id=$1, intentos=intentos+1
 WHERE id=$2 AND estado='pending'
RETURNING *;
```
Sin fila devuelta ⇒ otro la tomó ⇒ no se hace NADA. Y por la invariante, esta es la **única**
transición que puede terminar en un envío.

**B2 · Nadie vigilaba `claimed` envejecido.** El worker ahora lo mira:
`claimed` con más de N minutos ⇒ `dudoso` + **notificación**. Y también alerta por `pending`
envejecido (worker caído). Era, textual, *"el bug original con otro nombre"*.

**B3 · 🔴 `dudoso → delivered` era INALCANZABLE.** Hallazgo de Kimi y es un error mío:
`dudoso` = sin `wamid`, y el acuse de Meta viene indexado POR `wamid`. Esa transición no podía
ocurrir nunca. **Se elimina del diseño.**
→ En su lugar, la conciliación le da al dueño la evidencia que sí existe y que se verifica en
5 segundos: **teléfono, folio y hora exacta del intento**. Abre el chat del cliente y ve si el PDF
está o no. Un humano resuelve eso mejor que cualquier heurística nuestra, y sin riesgo de duplicar.

**B4 · La transacción única con PDFs de MB.** Se parte en dos, como pidieron los dos revisores:
1. los PDFs se guardan ANTES, fuera de la transacción, y quedan referenciados por `media_id`
2. la transacción es **corta**: solo las N filas de outbox + `batch_id`
Un PDF guardado sin fila de outbox es un huérfano barato (lo barre un job); una fila de outbox sin
PDF sería una deuda impagable. Por eso el orden es ese y no al revés.
Se declara tope: máximo N piezas y M MB por tanda.

**B5 · La semántica del reenvío sobre `dudoso`, antes de que llegue el primero.**
Queda definida así, y es lo que va a la pregunta del dueño: **el sistema NUNCA reenvía un
`dudoso`.** Solo un humano puede, y al hacerlo queda registrado quién y por qué.

## Lo que los dos revisores también levantaron y se incorpora

- **¿Quién vigila al vigilante?** (Kimi) La alerta al dueño sale por el mismo WhatsApp/Meta que
  puede estar caído. ⇒ la conciliación **también** queda visible en el cockpit, que no depende de
  Meta. La notificación es el empujón, no el único canal.
- **Acciones humanas sin guarda** (Kimi): la resolución manual también lleva
  `WHERE estado=<esperado>`. Humano y worker compiten igual que dos workers.
- **¿Dónde se incrementa `intentos`?** (Kimi) En el claim. Y como por la invariante un `claimed`
  no vuelve a `pending`, `intentos` en la práctica solo puede valer 1 en el camino automático:
  el tope N de K11 queda para el reenvío manual, no para quemar intentos sin envío real.
- **Folios y períodos** (Kimi): el correlativo ISO de ACTIVA incluye el año
  (`CM-FR-004-2026-NNNN`), así que la UNIQUE no choca entre períodos. VERIFICADO contra
  `quoteCorrelativo.js`: el año va en el número.
- **777 MB en `bytea`** (los dos): queda como pendiente aparte. Este diseño **no lo empeora**
  porque los PDF ya se guardan ahí hoy; sacarlos a storage externo es otro trabajo.
- **El mutex sin lease**: sigue fuera de alcance, declarado.

## El precio de la invariante — esto lo decide el dueño
Sin reintento automático, **cada muerte del proceso entre "Meta aceptó" y "lo anoté" genera un caso
de revisión manual** en vez de un reenvío. En 30 días medidos hubo 272 folios y **1 caso** de este
tipo (Katy). Si la tasa se mantiene, es ~1 revisión manual al mes, de 5 segundos.
**A cambio: cero posibilidad de que un cliente reciba dos veces la misma propuesta.**

## Lo que se les pide (ronda 3)
1. Con la invariante escrita, **¿queda algún camino de duplicación automática?**
2. ¿Queda algún camino de silencio total?
3. ¿B4 (PDF fuera de la transacción) abre algún agujero nuevo?
4. ¿Qué sigue sin ver nadie?
Veredicto **APTO / APTO CON CAMBIOS / NO APTO**.
