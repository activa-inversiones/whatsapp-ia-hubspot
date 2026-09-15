# TRIDENTE #778 — que el cliente SIEMPRE reciba su propuesta
Fecha: 2026-09-15 · Repo: `C:\Users\mcifu\activa\temp-wa` (whatsapp-ia-hubspot, index.js v11.8.1)

## Rol de ustedes
**ABOGADOS DEL DIABLO.** No validen. Su tarea es REFUTAR que esta propuesta convenga.
Esto cambia el flujo de cotización de una empresa real que vende ventanas. Si la propuesta
rompe algo, tiene que salir acá y no en producción.

## El caso, medido (no es hipótesis)
Katy Rossel, conv `36f82b64`, 15-sep-2026. Confirmado por el dueño textual:
*"oliver no entregarte la propuesta técnico económica a katy, se la envié yo calculada en otra plataforma"*.

```
17:58:32  clienta: "Si, me acomoda. Me puede elaborar un presupuesto?"
17:59:36  Oliver: "Mientras le preparo su Propuesta Técnica Económica..."  ← y YA existe folio CM-FR-004-2026-0462
18:00:23  informe térmico  CM-FR-006-2026-0169   ✅
18:00:50  informe vientos  CM-FR-007-2026-0053   ✅
18:01:10  video de cortesía                       ✅
          ── nada más. NUNCA salió el anticipo ni la propuesta ──
20:02:32  el DUEÑO la manda a mano desde otra plataforma, 2 h después
```

Regla de negocio del dueño (textual, hoy): *"a todos los clientes que se le cotiza le llega el
informe térmico, informe de vientos y la cotización"* y *"aunque cliente no confirma igual le
llega la cotización e informes si envían los datos de medidas; si no dice color cotiza blanco,
nogal, negro y se las envía"*.
Katy mandó 5 fotos con medidas y recibió 2 de 3 documentos.

## Lo VERIFICADO en código y datos (refuten esto si está mal)

1. **La tool SÍ se llamó.** El mensaje de promesa se emite DENTRO de `generarPdf`, en modo
   "informe-primero" (`webhook.js:3410` gate, `:3439` el copy). El comentario del propio código
   dice: *"el proyecto ya está completo acá, folio y PDF ya emitidos; cambia el ORDEN de envío"*.
   Confirmado en BD: `informes_termicos` guarda `quote_number = CM-FR-004-2026-0462` para los dos
   informes ⇒ el folio existía antes de los informes.
   ⚠️ Esto REFUTA el diagnóstico inicial ("el LLM no llamó la tool"). No es eso.

2. **La secuencia es un solo turno largo.** Dentro de `generarPdf`:
   informe (techo `SEQ_INFORME_TIMEOUT_MS` = 120 s, `webhook.js:91`) → vientos (techo propio)
   → video (techo propio) → `esperarAntesDeEnviar(SEQ_PRECIO_MS)` → **anticipo** (`:3556`) →
   propuesta. Duración real medida en el caso Katy: 17:59:36 → 18:01:10 y seguía.

3. **Cada paso tiene techo, y el bloque entero tiene try/catch** que declara:
   *"JAMÁS bloquea la propuesta: el peor resultado posible sería un cliente sin precio, y ese
   resultado no existe por diseño"* (`webhook.js:3542`).
   **Y sin embargo ocurrió.** Ese es el punto: el diseño dice que no puede pasar y pasó.

4. **NO fue un reinicio del contenedor.** `oliver_events.eventDispatcher.init`: 12:26, 12:40,
   20:28, 20:43 UTC. Ninguno entre 17:49 y 18:05. Además el cron `checkNewLeads` corrió cada
   minuto sin saltarse uno, siempre en el segundo `:23.78`.
   (Se sospechó de un deploy propio a las ~17:5x; queda DESCARTADO por esta evidencia.)

5. **Nadie avisó.** `stuckLeadMonitor.js:76` exige `inbound_count >= 4`. Katy pidió UNA vez y
   esperó, porque le prometieron el documento. La promesa apaga la señal del monitor.

6. **Escala:** 36 promesas en 8 días, 35 cumplidas, 1 no. Más un caso de 20 h de demora.
   El cerebro que atiende es Oliver GPT (1.018 mensajes en 8 días); V1 solo 15 y todos del
   operador ⇒ V1 no atiende clientes.

7. **NO PUEDO SABERLO:** la causa exacta de la muerte de la secuencia. No hay rastro en ninguna
   tabla y no tengo los logs de Railway de 17:59–18:05.

## La propuesta a refutar

**P-A — Desacoplar la cola de la secuencia del turno del webhook.**
Hoy informe + vientos + video + pausas + anticipo + propuesta viven en UN turno de ~2 min. Cualquier
corte (excepción fuera del try, timeout de plataforma, request abortado, OOM) se lleva la cola, y
lo que se pierde es justo lo último: **el precio**.
Propuesta: persistir "propuesta pendiente de entrega" ANTES de empezar la secuencia (el PDF y el
folio ya existen en ese punto) y que un worker la entregue si el turno no lo hizo en N minutos.

**P-B — Invertir el orden ante la duda.** Si la propuesta es lo que no puede faltar, mandarla
PRIMERO y los informes después. Contradice la decisión del dueño del 27-ago (*"si le entregamos el
precio, el cliente ve precio y no ve nada más"*), así que probablemente NO conviene — pero quiero
que lo refuten explícitamente en vez de descartarlo yo.

**P-C — Solo observabilidad.** Dejar el flujo igual y agregar un evento por paso de la secuencia
(`oliver_events`), más la red ya construida (`services/promesaIncumplida.js`, commit 6c915fc, sin
cablear). Barato, no arregla, pero la próxima vez sabremos la causa en vez de adivinar.

## Lo que se les pide
1. **Refuten con archivo:línea.** ¿La causa raíz está bien leída? ¿Qué puede matar la cola de esa
   secuencia sin dejar rastro y sin reiniciar el proceso?
2. **¿P-A rompe algo?** Entrega duplicada (el worker manda lo que el turno ya mandó), folios
   repetidos, orden alterado, condición de carrera con el candado de tanda.
3. **¿Qué falta que yo no vi?** Especialmente: ¿hay `await` sin techo en la cola? ¿el `safe()`
   traga errores que deberían gritar? ¿el lock/tanda puede quedar tomado?
4. **Veredicto por opción: APTO / APTO CON CAMBIOS / NO APTO**, con el cambio concreto.
5. Marquen **VERIFICADO / PLAUSIBLE / NO PUEDO SABERLO**.

## Reglas duras
SOLO LECTURA. No editar, no crear archivos fuera de su informe, no `git add/commit/push`, no deploy,
no abrir `.env`. Español chileno, sin humo, sin adular. Citar siempre `archivo:línea`.

## Hipótesis que YA se descartaron (no las repitan; refútenlas si la descarté mal)

- **Reinicio del contenedor / deploy propio.** DESCARTADA: `eventDispatcher.init` a las 12:26,
  12:40, 20:28 y 20:43 UTC — ninguno entre 17:49 y 18:05. Y el cron `checkNewLeads` corrió cada
  minuto sin saltarse uno, siempre en el segundo `:23.78`.
- **Reintento de Meta que mata el turno viejo.** DESCARTADA: el dedupe `seen.has(msgId)`
  (`webhook.js:954`) corre ANTES de `anotarLlegada` (`:985`), así que un redelivery del mismo
  msgId no genera turno nuevo.
- **Corte por `turnoVigente` (el bot se detiene si el cliente escribe, `webhook.js:778`).**
  DESCARTADA para este caso: los únicos dos cortes están en `:3107` y `:3184`, ANTES de los
  informes — y a Katy los informes SÍ le llegaron. Además no hay inbound suyo entre 17:58:32 y
  las 20:0x.
- **El modelo no llamó la tool.** DESCARTADA: ver punto 1 de arriba (el folio ya existía).

## Dato de contexto corregido
El cerebro que atiende es **Claude (anthropic): 624 mensajes en 8 días**; OpenAI solo 27 y los 27
marcados `cerebro_respaldo=true`. 410 turnos son deterministas/PDF por código. El módulo se llama
`oliver-gpt` pero el modelo es Claude — no confundan el nombre del archivo con el proveedor.
