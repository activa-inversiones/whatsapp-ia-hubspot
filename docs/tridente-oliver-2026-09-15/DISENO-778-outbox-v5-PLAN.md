# DISEÑO #778 v5 — el plan por fases, anclado al código real
Fecha: 2026-09-15 · v1 NO APTO · v2/v3/v4 convergieron · **verificación contra código: agente interno**

## Lo que cambió: el diseño era correcto, el orden estaba mal

La v4 daba por existente algo que **no existe**. Verificado en código:

| La v4 asumía | La realidad | Dónde |
|---|---|---|
| clasificar por status HTTP 4xx/5xx | **el status nunca se captura**; el catch aplasta todo a string | `whatsapp-adapter.js:168-175` |
| un timeout se distingue de un rechazo | **salen idénticos**: `{ok:false, error:"<string>"}` | idem |
| `TIMEOUT_ENVIO = 30 s` | es **15 s**, y hay **tres** distintos (send 15 s, upload doc 30 s, video 120 s) | `:25`, `:374`, `:333` |
| el acuse puede arbitrar un dudoso | los acuses `sent/delivered/read` **se tiran**: `if (!ac.fallo) continue;` | `webhook.js:865` |
| el `wamid` queda guardado | `escribirEstado` es **fire-and-forget** sobre caché con TTL 3 días | `estadoPersistente.js:96-101` |
| un TRIGGER se aplica en producción | **no hay runner de migraciones**; el patrón es `CREATE TABLE IF NOT EXISTS` al arranque, y ya hubo drift documentado | `leadService.js:120` |
| `uploadWaDocument` devuelve error | **LANZA**, sin try/catch propio | `:363-379` |

⚠️ **Consecuencia dura:** si se implementaba la v4 tal cual, los timeouts se habrían clasificado
como "fallo conocido" y **reintentado automáticamente** — exactamente el caso que duplica. El
diseño habría producido el daño que juraba evitar.

## Y el cambio bloqueante de Kimi, que ahora es doblemente obligatorio
> *"La clasificación no es por status HTTP, es por whitelist de códigos de error verificados como
> 'no procesado'. Todo 5xx y todo código desconocido ⇒ dudoso, no reintento."*
> Razón: un 5xx de Meta es **ambiguo** — puede haber aceptado el mensaje internamente y fallado al
> responder. Hay entregas documentadas tras respuesta de error.

No hay ninguna whitelist de códigos de WhatsApp en el repo (la única lista existente,
`multiChannelHandler.js:193`, es de Instagram/Facebook). Hay que escribirla desde cero y **parte
vacía**: al principio TODO va a `dudoso` salvo lo que se verifique contra la documentación de Meta.

---

## EL PLAN POR FASES

### FASE 0 — Sin esto, nada de lo demás es implementable
**0.1 · Error estructurado en el adapter.** `sendWhatsAppText`, `sendWaDocument` y
`uploadWaDocument` devuelven `{ ok, wamid, status, code, error_subcode, timedOut, raw }` en vez de
aplastar a string. `uploadWaDocument` deja de lanzar y devuelve el mismo contrato.
→ Es lo que habilita la distinción CONOCIDO/DESCONOCIDO. **Valor propio inmediato**: hoy en los
logs un timeout y un rechazo de Meta son indistinguibles.
**0.2 · Dejar de tirar los acuses.** `webhook.js:865` deja de descartar `sent/delivered/read`.
**0.3 · `wamid` durable.** Deja de depender de la caché con TTL: se escribe síncrono y confirmado.
(0.2 y 0.3 se vuelven útiles recién con la Fase 1, pero 0.3 es requisito del árbitro.)

### FASE 1 — El outbox
Tabla `entrega_outbox` con la UNIQUE, la máquina de estados y el TRIGGER de la invariante.
⚠️ Como no hay runner de migraciones, el trigger va en un `ensureX()` idempotente
(`DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`) siguiendo el patrón ya usado en
`quoteCorrelativo.js:26-36`, **más un chequeo de arranque que grite si el trigger no existe** —
porque, como marcó el agente, el argumento "te la rompe un pasante con psql" se debilita si el
trigger mismo puede faltar en producción y nadie se entera.

### FASE 2 — El vigilante
Se cuelga de `actionWorker.js` (`temp-sales-os`), que ya es cola+worker+reintentos con
`setInterval(…, 60_000)` y control de concurrencia.
⚠️ **NO** usar `node-cron`: dos archivos del repo anotan que no protege contra solapes
(`candadoChat.js:445`, `leadTtlEngine.js:404`). Dos instancias marcando `dudoso` la misma fila en
paralelo es justo lo que no puede pasar.

### FASE 3 — El árbitro por acuses
Un `delivered` resuelve un `dudoso` sin humano. Depende de 0.2 + 0.3.

---

## Números corregidos (KA de la v4 estaba mal)
El peor caso de una propuesta es **upload (30 s) + send (15 s) = 45 s**, no 30 s.
→ `LEASE_VIGILANTE = 300 s` (más de 6× el peor caso acumulado).
→ El vigilante nunca toca una fila con `claimed_at` de menos de 150 s.

## Lo que sigue sin resolverse y hay que decirlo
- **NO PUEDO SABERLO**: el comportamiento real de Meta por código de error. Sale de su
  documentación o de logs reales, no del repo. La whitelist no se puede escribir "de memoria".
- El `error_subcode` **no se extrae** hoy del acuse (`whatsapp-adapter.js:72-73`); una whitelist
  por código+subcódigo lo necesita.
- Los 777 MB de PDFs en `bytea` y el mutex por teléfono sin lease siguen fuera de alcance.

## Estado de revisión
- v4: Gemini **APTO CON CAMBIOS** · Kimi **APTO CON CAMBIOS** (1 bloqueante: la whitelist)
- v5 (este plan): **sin revisar**. Nace de la verificación contra código, no de opinión.
- Codex: **no vio ninguna versión**.
