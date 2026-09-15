# Informe de Auditoría TRIDENTE — Oliver

## 1. Verificación de Causas Raíz

*   **C1 (Sanitizador ineficaz): VERIFICADO.** Leí `index.js:956` (`sanitizeForCustomer`). Las regex solo buscan objetos JSON muy específicos con campos como `id|product|measures|...` y URLs largas. No hay ninguna regla para atrapar `<tool_call>`, `<tool_response>` ni para limpiar formato `**`.
*   **C2 (Rutas sin sanitizar): VERIFICADO.** Leí `index.js`. Mientras que `waSendH` (~1866) invoca el sanitizador, `waSendMultiH` (~1934) itera y llama a `await waSend(to, m)` **en crudo**. Las notificaciones de escalación (ej. ~1688) también le pegan directo a `waSend`, saltándose cualquier filtro.
*   **C3 (isLikelyName coladero): VERIFICADO.** Leí `services/oliverName.js` (v1.0.0). El `COMMAND_SET` carece de interrogativos (dónde, cuándo) y palabras clave (correderas, comunas, ubicados). En `index.js:6217-6223`, si el bot está esperando el nombre (`ses.nameAsked`), un texto como "donde estan ubicados" pasa perfecto el filtro porque tiene 3 palabras, ni un dígito y no choca con la pobre lista negra. Luego, en `index.js:569`, eso entra directo a `customer_name` y de ahí al PDF.
*   **C4 (Correlativo ciego): VERIFICADO.** Leí `docs/tridente-oliver-2026-09-15/ref-quoteCorrelativo.js`. La query hace `INSERT ... ON CONFLICT DO UPDATE SET last_seq = last_seq + 1 RETURNING` incondicionalmente, sin mirar si la cotización corresponde a un reintento del mismo monto, quemando folios reales a la basura.

## 2. Veredictos del Plan

### P1 — services/salidaSegura.js
**APTO.** Mover la lógica de limpieza a un módulo puro y aislarlo de la bola de barro de `index.js` es lo correcto. Que devuelva `{ bloquear: true }` cuando el mensaje se desintegre es clave.

### P2 — Un único embudo de salida
**APTO CON CAMBIOS.** El plan propone *"Idealmente sanitizar dentro de waSend mismo para que sea imposible saltárselo"*. **Pésima idea.** 
*Cambio concreto:* Si sanitizas dentro de `waSend` y devuelves un bloqueo, la función (que es pasiva) simplemente se traga el error, el bot queda en silencio y el cliente se queda colgado esperando una respuesta. El bloqueo debe ocurrir en el orquestador (Fase 2) o en funciones que manejen el ciclo del LLM. Además, `waSend` se usa para avisos internos al CEO (`ESCALATION_PHONE` en `index.js:1688`); no quieres que el sanitizador mutile una alerta técnica porque le pareció que era JSON crudo.

### P3 — oliverName.js a v2.0.0 (Validador positivo)
**APTO CON CAMBIOS.** 
*Riesgo de regresión:* Leí `services/oliverName.test.js`. El test suite **exige** que un nombre de una sola palabra pase limpio (ej. `assert.equal(isLikelyName('Dalia'), true)`). Si la v2.0 exige una estructura rígida de "Nombre + Apellido", los tests van a fallar y los clientes que responden un simple "Juan" quedarán atrapados en un bucle preguntándoles el nombre otra vez.
*Cambio concreto:* La validación positiva debe ser lo bastante inteligente (diccionario, morfología) para seguir aceptando un solo nombre de pila sin chillar.

### P4 — quoteCorrelativo.js idempotente
**APTO.** 
*Riesgo de regresión:* Ninguno respecto a la ISO 9001 §7.5. La norma pide trazabilidad y control de registros, no prohíbe versionar documentos con sufijos (-B, -C). Es una práctica mil veces mejor que saltar la secuencia porque un cliente pidió un cambio de color 3 veces.

### P5 — Teléfonos internos fuera del correlativo
**APTO.** Aislar al dueño (`ADMIN_PHONE` / `CEO_WHATSAPP`) del conteo productivo cortará el 21% de ruido en los KPIs al tiro.

### P6 — Drafts sin monto no se persisten
**APTO.** Nada que discutir, basura en BD genera reportes basura.

## 3. LO QUE EL PLAN NO VIO

1. **Riesgo en las plantillas de Meta (PLAUSIBLE resuelto a VERIFICADO):** Al meter el sanitizador universal, la preocupación inicial era que rompiera las plantillas preaprobadas por Meta (que rechazan cualquier cosa si alteras los placeholders). Pero leyendo el código, `_sendMetaTemplate` en `index.js:1185` usa `axiosWA.post` directamente. **Nunca** pasa por `waSend`. Así que el embudo de `salidaSegura` no romperá el flujo automático de recordatorios o PDFs.
2. **Ciclo de reintento del orquestador (PLAUSIBLE):** Si P1 (`salidaSegura.js`) devuelve `{ bloquear: true }`, ¿quién ataja eso? Si `index.js` no captura esa señal para inyectar un mensaje de sistema al LLM tipo "Tu mensaje fue bloqueado porque enviaste tool_calls crudos, regenera tu respuesta", el bot se va a quedar mudo. Hay que asegurar que el orquestador sepa reintentar cuando el sanitizador bloquea.
