Warning: True color (24-bit) support not detected. Using a terminal with true color enabled will result in a better visual experience.
Warning: tools.exclude in settings.json is deprecated and will be removed in 1.0. Migrate to Policy Engine: https://geminicli.com/docs/core/policy-engine/
Ripgrep is not available. Falling back to GrepTool.
Skill "skill-creator" from "C:\Users\mcifu\.agents\skills\skill-creator\SKILL.md" is overriding the built-in skill.
Okay, I will start by reading the `BRIEF.md` file to understand the review that is being requested. Then, I will proceed with analyzing the codebase to verify the root causes and claims, and finally generate the requested report.
I have read the brief. I will now proceed to analyze the specified source code files to verify the claims and evaluate the proposed plan. My analysis will be compiled into a single report file.
I have reviewed the initial set of files. To complete the verification of the root causes, specifically points C2 and C3 which reference code in the latter part of `index.js`, I need to read the rest of that file. After that, I will have all the necessary information to compile the final report.
I have completed the analysis of all specified files. I am now ready to compile the final report, providing a verdict for each proposed point and including any additional findings.
Error executing tool write_file: Tool "write_file" not found. Did you mean one of: "read_file", "update_topic", "grep_search"?
# Informe de Revisión Tridente — Oliver (Gemini)

Fecha: 2026-09-15

## Veredicto General
El plan propuesto es sólido y las causas raíz están, en su mayoría, correctamente identificadas. Los cambios propuestos son necesarios y apuntan a mejoras estructurales, no a parches. Se aprueba el plan con algunas observaciones y adiciones detalladas a continuación.

---

## Análisis de Causas Raíz (C1-C4)

### C1 — Sanitizador no cubre tool-calling ni Markdown
**VEREDICTO: VERIFICADO**
- **Evidencia:** `index.js:947` (`function sanitizeForCustomer(text)`).
- **Análisis:** La función efectivamente usa expresiones regulares demasiado específicas que no contemplan la estructura de un `tool_call` (`"name"`, `"arguments"`) ni convierten el formato de `**negrita**` de Markdown a `*negrita*` para WhatsApp. La afirmación del brief es correcta.

### C2 — Rutas de envío que NO pasan por el sanitizador
**VEREDICTO: VERIFICADO**
- **Evidencia:**
    - `index.js:1870` (`waSendH`) sí sanitiza.
    - `index.js:1942` (`waSendMultiH`) llama a `waSend(to, m)` en un bucle, sin sanitizar.
    - `index.js:1685` (`sendEscalationAlert`) llama a `waSend(ESCALATION_PHONE, alertMsg)` directamente, aunque es un mensaje interno.
    - A lo largo de `handleTurn`, existen múltiples llamadas directas a `waSend` que se saltan `waSendH`.
- **Análisis:** Es correcto. El "sanitizador universal" no es universal, dejando varias rutas de salida sin protección.

### C3 — `isLikelyName()` acepta casi cualquier frase corta
**VEREDICTO: VERIFICADO**
- **Evidencia:**
    - `services/oliverName.js`: La función `isLikelyName` y su lista negra `COMMAND_SET`.
    - `index.js:6219`: Lógica de captura de nombre.
    - `index.js:569`: Uso del nombre en `buildQuotePayload`.
- **Análisis:** La causa raíz es 100% correcta. La lógica de `isLikelyName` es una lista negra que no incluye palabras interrogativas comunes ("donde", "estan") ni vocabulario de la industria no listado ("correderas"). Esto, combinado con el flujo de captura en `index.js:6219` (donde tras preguntar el nombre, cualquier respuesta que pase el filtro se toma como nombre), explica perfectamente los `customer_name` basura.

### C4 — El correlativo ISO no tiene deduplicación
**VEREDICTO: VERIFICADO**
- **Evidencia:** `docs/tridente-oliver-2026-09-15/ref-quoteCorrelativo.js`.
- **Análisis:** La sentencia SQL (`INSERT ... ON CONFLICT DO UPDATE SET last_seq = quote_counters.last_seq + 1`) incrementa el contador en cada llamada a `nextQuoteNumber`, sin importar el contenido, monto o cliente. La afirmación es correcta.

---

## Evaluación del Plan Propuesto (P1-P6)

### P1 — `services/salidaSegura.js` (módulo nuevo)
**VEREDICTO: APTO**
- **Análisis:** Centralizar la lógica de sanitización en un módulo puro con tests es la solución correcta y sigue la regla de "mejora permanente". La idea de devolver `{ bloquear: true }` para reintentar el turno en lugar de enviar un mensaje mutilado es excelente y previene una mala experiencia de usuario. Absorber `sanitizeForCustomer` en lugar de duplicarlo es la práctica correcta.

### P2 — Un único embudo de salida
**VEREDICTO: APTO**
- **Análisis:** Es la consecuencia lógica de P1. Para que la nueva `salidaSegura` sea efectiva, todas las rutas de salida (`waSend`, `waSendH`, `waSendMultiH`) deben pasar por ella. La sugerencia de integrarlo directamente en `waSend` es la ideal, ya que hace imposible saltárselo.

### P3 — `oliverName.js` a v2.0.0: validador positivo
**VEREDICTO: APTO CON CAMBIOS**
- **Análisis:** Cambiar de una lista negra a un validador positivo (léxico de nombres/apellidos, morfología) es un cambio estructuralmente correcto y mucho más robusto. Rechazar interrogativos, comunas y vocabulario de catálogo es clave.
- **Cambio Sugerido:** La parte de "pedirlo explícitamente ANTES de emitir folio" es crucial. Esta lógica debe implementarse como un "gate" o paso de validación obligatorio en la función que dispara la generación de PDF. Si `needsName(ses.data)` es `true`, la generación de PDF debe bloquearse y en su lugar se debe pedir el nombre.

### P4 — `quoteCorrelativo.js`: folio idempotente
**VEREDICTO: APTO CON CAMBIOS**
- **Análisis:** La idea de idempotencia por `(conversation_id, amount_total)` es buena, pero puede ser insuficiente. Un cliente podría querer dos cotizaciones distintas por el mismo monto en la misma conversación.
- **Cambio Sugerido:** La clave de idempotencia debería ser `(conversation_id, serialized_items)`. Hashear o serializar el array de ítems (producto, medidas, cantidad) es más preciso que solo usar el monto. Si los ítems son idénticos, se devuelve el mismo folio. Si cambian, incluso con el mismo monto, se genera uno nuevo (o con sufijo -B, -C).

### P5 — Teléfonos internos fuera del correlativo y KPIs
**VEREDICTO: APTO**
- **Análisis:** Es una necesidad básica para mantener la integridad de los datos y la trazabilidad ISO. Un prefijo `TEST-` o similar es una solución estándar y efectiva. Esto debe implementarse a nivel de la API que genera el correlativo, recibiendo un flag `is_test` o detectando el número de teléfono.

### P6 — Drafts sin monto no se persisten
**VEREDICTO: APTO**
- **Análisis:** Correcto. Las cotizaciones `draft` sin monto en la base de datos son ruido y no tienen valor para el seguimiento o KPIs. Un TTL (Time To Live) de 24 horas es una alternativa razonable si se quiere conservar el borrador por un tiempo corto, pero eliminarlos si no tienen monto es más limpio.

---

## LO QUE EL PLAN NO VIO

1.  **Firma de Webhook Insegura (Fail-Open):**
    - **VERIFICADO:** `index.js:2502` (`function verifySig(req)`). La función contiene la línea `if (!META.SECRET) return true;`. Esto significa que si la variable de entorno `APP_SECRET` no está configurada, la validación de la firma se salta y el webhook acepta cualquier petición POST, sea de Meta o no. Esto es un riesgo de seguridad (fail-open) que no fue mencionado. Debería ser fail-closed: si no hay secreto, se rechaza todo.

2.  **Manejo de Reacciones a Mensajes con Emoji:**
    - **VERIFICADO:** `index.js:4645`. La función `extractMsg` llama a `textoDeReaccion(msg)` para las reacciones. Sin embargo, el `SYSTEM_PROMPT` en `index.js:5275` (REGLA #9) instruye al LLM sobre cómo interpretar la reacción, pero el código no parece tener una lógica especial para manejar la semántica de la reacción antes de pasarla al LLM. Esto puede llevar a que el LLM no siempre siga la regla, especialmente con reacciones negativas. Una capa de lógica en el código que identifique una reacción negativa (ej. 👎) y marque un estado en la sesión (ej. `ses.lastReactionWasNegative = true`) sería más robusto.

3.  **Captura de Nombre (`oliverName.js`) y el Contexto de la Pregunta:**
    - **PLAUSIBLE:** El plan P3 mejora mucho la validación del nombre. Sin embargo, la causa raíz C3 tiene un matiz: el problema ocurre cuando el bot *acaba de preguntar el nombre* (`ses.nameAsked=true`) y el cliente responde otra cosa. La función `isLikelyName` opera sin ese contexto. La nueva `esNombreDePersona` debería ser más estricta si `ses.nameAsked` es `true`. Si el bot no ha preguntado el nombre, puede ser más flexible al extraerlo de frases como "soy Juan y necesito una ventana".

4.  **Uso de `waSend` en Plantillas de Meta:**
    - **VERIFICADO:** El brief pregunta si `waSend` se usa en templates donde sanitizar rompería el formato. Sí, las funciones `_sendMetaTemplate` y sus derivadas (ej. `sendTemplateSeguimientoCotizacion` en `index.js:1152`) no usan `waSendH` y construyen el payload directamente. Esto es correcto, ya que el contenido de las plantillas es validado por Meta y no debe ser alterado. Sin embargo, esto refuerza la necesidad de que el nuevo "embudo de salida" (P2) se aplique con cuidado, probablemente dentro de `waSend` pero con un bypass para los payloads de tipo `template`.
GEMINI EXIT: 0 (modelo=gemini-2.5-pro, limite=1800s)
