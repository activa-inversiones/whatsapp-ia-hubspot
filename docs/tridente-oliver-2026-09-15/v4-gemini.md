Warning: True color (24-bit) support not detected. Using a terminal with true color enabled will result in a better visual experience.
Warning: tools.exclude in settings.json is deprecated and will be removed in 1.0. Migrate to Policy Engine: https://geminicli.com/docs/core/policy-engine/
Ripgrep is not available. Falling back to GrepTool.
Skill "skill-creator" from "C:\Users\mcifu\.agents\skills\skill-creator\SKILL.md" is overriding the built-in skill.
(node:40108) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
(Use `node --trace-deprecation ...` to show where the warning was created)
Aquí está la revisión, como abogado del diablo.

---

### Análisis de Causa Raíz y Diseño v4

#### 1. ¿La causa raíz está bien leída? ¿Qué puede matar la secuencia sin dejar rastro?

La lectura de la causa raíz en `BRIEF-778-cura.md` es sólida.

*   **VERIFICADO:** La tool `generarPdf` sí fue llamada, como evidencia la existencia del folio `CM-FR-004-2026-0462` en los informes. Esto descarta que el LLM haya fallado. El problema está dentro de la ejecución de `generarPdf` en `src/oliver-gpt/webhook.js`.
*   **VERIFICADO:** La secuencia de envío de informes, videos y la propuesta final ocurre en un solo turno largo y secuencial. El código en `src/oliver-gpt/webhook.js` alrededor de la línea 3410 confirma el modo "informe-primero" que mete toda la lógica en una sola ejecución.
*   **PLAUSIBLE:** La causa más probable de la muerte silenciosa es un timeout a nivel de infraestructura que el `try/catch` de la aplicación no puede capturar. Por ejemplo, un timeout de la request HTTP en el balanceador de carga o en la plataforma de hosting (Railway, según `railway.json`). Si la conexión entre el cliente (Meta) y el servidor se corta, el proceso en Node.js podría seguir corriendo un tiempo pero el `res.end()` final nunca llegará. Otra posibilidad es un `process.exit()` escondido en alguna dependencia, o un OOM (Out of Memory) que mata el proceso de forma abrupta. El `safe()` wrapper (`src/oliver-gpt/webhook.js:63`) es un `try/catch` que loguea el error pero no relanza, por lo que podría estar ocultando un error no fatal que de alguna manera corrompe el estado y previene la ejecución de los pasos finales.

El diseño v4 ataca este problema de raíz al no depender de la supervivencia de un solo proceso. Al persistir el *intento* de envío en la base de datos (el "outbox"), la muerte del worker que procesa el webhook ya no implica la pérdida del documento. Un proceso vigilante (el "watchdog") puede detectar el trabajo inconcluso y marcarlo como `dudoso`.

#### 2. ¿El diseño v4 rompe algo? (Riesgos de Duplicidad, Orden, Carreras)

El diseño v4 es robusto, pero su correcta implementación es crítica.

*   **Entrega Duplicada:**
    *   **PLAUSIBLE:** El riesgo principal es un *falso negativo*. El worker envía el PDF a Meta, Meta lo entrega, pero antes de que Meta responda `200 OK`, el worker muere (timeout, deploy, etc.). El watchdog verá el `outbox_item` como `claimed` y lo marcará como `dudoso`. Si un operador humano luego autoriza el reenvío, se produciría un duplicado. El diseño v4 reconoce esto y lo mitiga correctamente al **prohibir el reintento automático** de mensajes `dudosos`. La decisión de reenviar recae en un humano, que se asume verificará el chat con el cliente. Esto es una mitigación, no una prevención completa a nivel de sistema, pero es el trade-off correcto. La regla del dueño sigue siendo el eslabón más débil.

*   **Folios Repetidos:**
    *   **VERIFICADO:** El diseño no genera folios nuevos. La reemisión autorizada (`reenvio_autorizado`) opera sobre el `media_id` existente del documento ya generado y almacenado. El folio es parte del PDF, no del envío. No hay riesgo aquí.

*   **Orden Alterado:**
    *   **VERIFICADO:** El diseño v4 no altera el orden de los documentos (propuesta, informe, etc.) ya que cada uno sería una entrada separada en la tabla `outbox_items` con su propia secuencia, si se aplicara a toda la cadena. El diseño se centra en la entrega atómica de *un* documento, por lo que el orden no es un problema que este diseño introduzca.

*   **Condición de Carrera:**
    *   **PLAUSIBLE:** El diseño se basa en un "claim" (`UPDATE ... SET status='claimed' WHERE status='pending' LIMIT 1`). Esto es atómico a nivel de base de datos y previene que dos workers tomen el mismo ítem. Sin embargo, el `lock` a nivel de aplicación (`src/oliver-gpt/webhook.js:996`, `local-lock`) sigue siendo necesario para prevenir que dos webhooks para el *mismo cliente* corran en paralelo y generen dos propuestas distintas al mismo tiempo. El diseño de la outbox no reemplaza la necesidad de un lock de sesión, y no pretende hacerlo. El punto de falla es si el lock se libera incorrectamente o queda tomado.

#### 3. ¿Qué falta que el diseño v4 no vio?

*   **`await` sin timeout en el transporte:**
    *   **VERIFICADO:** `src/sales-agent/whatsapp-adapter.js:391` (`sendWaDocument`) usa `axios.post`. Por defecto, axios no tiene timeout. **Este es un punto crítico.** Una request a la API de Meta que se queda colgada indefinidamente mantendrá al worker ocupado y podría impedir que se procesen otros mensajes, además de ser una causa probable del problema original de Katy Rossel. La implementación debe incluir un timeout explícito en la llamada de axios, que sea menor al `TIMEOUT_ENVIO` de 30s propuesto en el diseño.

*   **`safe()` traga errores:**
    *   **VERIFICADO:** Sí. El wrapper `safe()` en `webhook.js:63` existe explícitamente para registrar un error y continuar. En el contexto de un webhook que debe responder `200 OK` rápidamente, tiene sentido. Pero en la secuencia larga de `generarPdf`, un error tragado puede ser la causa de que la ejecución no continúe. El diseño v4, al mover la lógica de envío a un worker desacoplado, hace que el `safe()` sea menos peligroso. En el worker, un error durante el envío (`sendWaDocument`) debe ser manejado explícitamente para cambiar el estado del `outbox_item` a `failed`, no simplemente ser logueado y tragado.

*   **El lock/tanda puede quedar tomado:**
    *   **VERIFICADO:** Sí. El lock se libera en un bloque `finally` (`webhook.js:4778`), lo cual es correcto. Sin embargo, si el proceso muere de forma no controlada (OOM, `kill -9`), el `finally` nunca se ejecuta. El lock actual es en memoria (`local-lock`), por lo que moriría con el proceso. Pero si se usara un lock externo (ej. Redis), podría quedar tomado. El diseño v4 no impacta esto directamente, pero la robustez general del sistema depende de ello.

*   **Falta del esquema de BD:**
    *   **NO PUEDO SABERLO:** No encontré los `CREATE TABLE` para `media_attachments` o `quotes`. No puedo verificar si tienen campos como `wa_message_id`, `sent_at`, o `status` que serían cruciales para implementar el outbox. Asumo que la nueva tabla `outbox_items` se creará con todo lo necesario, pero la interacción con las tablas existentes es un punto ciego.

---

### Veredicto por Opción

El `BRIEF` pide un veredicto sobre P-A, P-B, P-C. El diseño v4 es una implementación detallada de P-A.

*   **P-A (Desacoplar la cola):** Es el camino correcto. El diseño v4 lo detalla bien.
*   **P-B (Invertir el orden):** **NO APTO.** Como el mismo brief intuye, viola una regla de negocio explícita del dueño. El precio al final es una decisión estratégica.
*   **P-C (Solo observabilidad):** **NO APTO.** Es una solución pasiva que no previene la recurrencia del error. Saber por qué falló no le devuelve el PDF al cliente.

**Veredicto sobre el Diseño v4:** **APTO CON CAMBIOS**

El diseño es conceptualmente sólido y ataca la causa raíz. Los cambios requeridos son a nivel de implementación para asegurar su robustez.

---

### LO QUE EL DISEÑO NO VIO (o debe enfatizar en la implementación)

1.  **Timeouts en la Capa de Transporte:** El cambio más crítico es agregar un timeout explícito a la llamada `axios` en `whatsapp-adapter.js`. Este timeout debe ser el que determine si el resultado es `CONOCIDO` (si la API responde antes) o `DESCONOCIDO` (si el timeout se activa). Debe ser un timeout de respuesta, no solo de conexión.

2.  **Estado de `media_attachments`:** El diseño no especifica cómo se actualiza la tabla `media_attachments` (o `quotes`) una vez que el `outbox_item` es procesado. Se debe registrar el `message_id` de Meta y el estado final (`delivered`, `failed`, `dudoso`) en la tabla principal del documento para tener una fuente de verdad consolidada. La outbox es una cola, no el registro final.

3.  **El problema del "Falso Negativo" en reintentos manuales:** El diseño depende de un humano para evitar duplicados en casos `dudosos`. Esto es un riesgo. Se podría mitigar más agregando el `message_id` del intento de envío original a la notificación de escalación. Así, el operador podría buscar ese ID en los logs de Meta para confirmar si el mensaje se entregó antes de autorizar un reenvío.

4.  **Back-pressure y Límites de Reintentos:** El diseño no menciona qué pasa si un error sistémico (ej. la API de Meta caída) empieza a llenar la cola de `outbox_items` en estado `failed`. El mecanismo de reintento automático para fallos `CONOCIDOS` debe tener un límite (ej. 3 reintentos con backoff exponencial) antes de pasar a un estado terminal `failed_permanent` y notificar a un humano. De lo contrario, los workers podrían entrar en un loop infinito de reintentos.
GEMINI EXIT: 0 (modelo=gemini-2.5-pro, limite=1800s)
