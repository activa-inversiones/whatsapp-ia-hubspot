# DISEÑO #778 v4 — la distinción que salva el reintento
Fecha: 2026-09-15 · v1 NO APTO · v2 APTO CON CAMBIOS · v3: Gemini **APTO** / Kimi **APTO CON CAMBIOS**

## El problema que encontró Kimi en la v3, y que yo no vi

> *"Mataste el reintento ante fallas transitorias, y las transitorias son el caso común. Meta
> devuelve 503 un martes a las 15:00 durante 20 minutos. Antes: se arregla solo. Ahora: cada envío
> de esa ventana es un dudoso manual."*

Tenía razón, y mi cálculo de "1 revisión al mes" era optimista: sirve para las caídas de proceso,
no para una caída de Meta. En un outage de 20 minutos podrían ser decenas de casos manuales.

## LA DISTINCIÓN (v4) — y con esto el canje deja de doler

La v3 trataba todos los fallos igual. Son dos cosas distintas:

| | ¿Sabemos si llegó? | Qué se hace |
|---|---|---|
| **Fallo CONOCIDO** — Meta respondió con error (4xx/5xx), o el socket se cerró SIN respuesta del servidor | **SÍ: sabemos que NO llegó** | **Reintento automático**. No hay riesgo de duplicar lo que Meta rechazó. |
| **Resultado DESCONOCIDO** — timeout sin respuesta, proceso muerto, conexión cortada después de mandar el request | **NO sabemos** | `dudoso`. **NUNCA se reenvía solo.** |

**La invariante se afina así:**
> Una fila **cuyo resultado de envío es DESCONOCIDO** nunca vuelve a la cola automáticamente.
> Una fila con **fallo CONOCIDO** (Meta dijo que no) sí puede reintentarse: no hay nada que duplicar.

Un 503 de Meta es una respuesta explícita: el mensaje NO se entregó. Reintentar eso no puede
duplicar nada. Con esto se recupera el reintento automático **sin tocar la regla del dueño**.

## Los 5 cambios exigidos por Kimi

**KA · `timeout_envio < lease_vigilante`, con números.**
El caso que describió es real: Meta lento (40 s), lease de 30 s, el vigilante marca `dudoso`
mientras el HTTP sigue en vuelo, el humano reenvía, y a los 45 s Meta confirma el original ⇒
**duplicado fabricado por el propio sistema**.
→ `TIMEOUT_ENVIO = 30 s` (en el cliente HTTP, con `AbortSignal.timeout`)
→ `LEASE_VIGILANTE = 180 s` (6× el timeout, margen amplio)
→ Regla escrita: el vigilante NUNCA toca una fila cuyo `claimed_at` sea más reciente que
`TIMEOUT_ENVIO × 3`.

**KB · El mecanismo del reenvío humano, especificado.**
El humano NO crea fila nueva ni dispara la cola. Sobre la MISMA fila:
`dudoso → reenvio_autorizado` (con `autorizado_por` y `motivo`), y solo esa transición habilita
UN envío, con la misma guarda de estado. No hay "botón que la máquina toma y hace el resto":
es una transición explícita, registrada y de un solo uso.
Kimi tenía razón: sin esto, *"el sistema nunca reenvía" era verdad técnica y mentira práctica*.

**KC · 🔴 La invariante deja de ser un cartel y pasa a ser la base.**
Textual de Kimi: *"tu 'corazón de la v3' es un cartel de 'no pasar'… te la rompe un pasante con
psql"*. ⇒ **TRIGGER en Postgres** que rechaza toda transición prohibida, en especial
`claimed → pending` y `dudoso → pending`. Una migración futura, un script de mantenimiento o un
UPDATE manual de emergencia **no pueden** reactivar la duplicación.

**KD · Semántica de `failed`.**
`failed` = fallo CONOCIDO que agotó los reintentos. Es terminal para el automatismo. Un humano
puede revivirlo con la misma transición explícita de KB (`failed → reenvio_autorizado`), porque
un fallo conocido significa que NO llegó: revivirlo no duplica.

**KE · Escalamiento de dudosos no atendidos.**
Un `dudoso` sin resolver a las N horas escala (segundo aviso + marca en el brief 7AM). El cockpit
es pasivo: que el caso esté visible no garantiza que alguien lo mire.

## Lo de Gemini que también entra
- **Guarda en la resolución manual** (su punto a): la pantalla muestra la hora exacta y pide
  confirmación explícita de "miré el chat del cliente". El riesgo se movió de la máquina al humano
  y hay que tratarlo como riesgo, no como solución.
- **`instance_id`** (b): uuid v4 generado al arrancar el proceso, nunca hostname ni constante.
- **Dead man's switch** (c): un chequeo externo que avise si el worker deja de reportar actividad.
  Si el worker entero se cae, hoy no hay alerta por ningún canal.

## Lo que queda declarado como fuera de alcance
- El mutex por teléfono sin lease.
- Los 777 MB de PDFs en `bytea` (este diseño no lo empeora: ya se guardan ahí).
- `intentos` en el camino automático: con la distinción de la v4 vuelve a ser un campo útil
  (cuenta reintentos de fallos conocidos), ya no decorativo.

## Estado
- Gemini: v3 **APTO**
- Kimi: v3 **APTO CON CAMBIOS** → los 5 cambios están en esta v4
- Codex: sin cuota de uso desde ~21:30; vuelve 23:09. **NO HA VISTO NINGUNA VERSIÓN.**

⚠️ Esta v4 **no fue revisada por nadie todavía**.
