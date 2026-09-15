Warning: True color (24-bit) support not detected. Using a terminal with true color enabled will result in a better visual experience.
Warning: tools.exclude in settings.json is deprecated and will be removed in 1.0. Migrate to Policy Engine: https://geminicli.com/docs/core/policy-engine/
Ripgrep is not available. Falling back to GrepTool.
Skill "skill-creator" from "C:\Users\mcifu\.agents\skills\skill-creator\SKILL.md" is overriding the built-in skill.
(node:28556) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
(Use `node --trace-deprecation ...` to show where the warning was created)
## Informe de Revisión · ABOGADO DEL DIABLO (Gemini)
**FECHA:** 2026-09-15
**DISEÑO:** `DISENO-778-outbox-v3.md`

### Veredicto General
**APTO.**

El diseño v3 es robusto. La introducción de la "invariante" (`pending` → `claimed` → nunca más a `pending` por vía automática) cierra el camino de duplicación que invalidó las versiones anteriores. El costo de pasar a revisión manual los casos de fallo post-envío es explícito y, según la data provista (1 caso en 272), aceptable para el negocio.

---

### Análisis de Verificación de Código

*   **Schema de `media_attachments` y `quotes`:**
    *   **NO PUEDO SABERLO.** No encontré migraciones ni `CREATE TABLE` en el repo. Infiero la estructura de `media_attachments` a partir de `mediaStore.js:40-52`: el payload de `saveMedia` sugiere columnas como `phone`, `direction`, `media_type`, `wa_media_id` y `media_base64`. La presencia de `media_base64` confirma que el binario del PDF se guarda en la base, sosteniendo la preocupación "777 MB en `bytea`" que el diseño hereda.

*   **`src/sales-agent/whatsapp-adapter.js:363, 391`:**
    *   **VERIFICADO.** Las funciones `uploadWaDocument` y `sendWaDocument` existen. Confirman que la capa de WhatsApp ya soporta el flujo de dos pasos (subir buffer → obtener `mediaId` → enviar por `mediaId`) que el bloqueante B4 necesita.

*   **`services/estadoPersistente.js`:**
    *   **VERIFICADO.** La función `reservar` (línea 131) implementa un candado atómico **sincrónico, dentro del proceso**. Sus comentarios son claros: previene carreras entre dos operaciones del *mismo* turno (ej: dos `calcular_cotizacion`), pero no es un lock distribuido entre instancias. Esto es clave: la garantía del diseño contra duplicados entre *workers* distintos no descansa en `reservar`, sino en la atomicidad del `UPDATE ... WHERE estado='pending'` en la base de datos.

*   **`src/oliver-gpt/webhook.js` (múltiples líneas):**
    *   **VERIFICADO.** El código es consistente con el diseño.
        *   La gestión de estados de documentos (informes, propuestas) usa `estadoPersistente.js` para candados y rastros (ej: `despacharInforme` L:1680-2023).
        *   Se manejan los acuses de Meta para detectar fallos de entrega (`parseStatuses` y su uso en L:1003).
        *   Los envíos de documentos efectivamente usan el flujo `upload` → `send` de `whatsapp-adapter.js`.

---

### Respuestas a las Preguntas (Ronda 3)

#### 1. Con la invariante escrita, ¿queda algún camino de duplicación automática?
**PLAUSIBLE, PERO IMPROBABLE.**

El diseño cierra el camino obvio (worker A envía → muere → worker B re-envía). La única forma de que ocurra una duplicación automática ahora sería por un bug en la lógica de estados o un fallo exótico a nivel de base de datos.

Un escenario posible, aunque muy remoto:
1.  Worker A ejecuta el `UPDATE ... SET estado='claimed' ... RETURNING *`.
2.  La base de datos **ejecuta el `UPDATE` y lo commitea**, pero la conexión se corta **antes** de que la cláusula `RETURNING` devuelva la fila al worker A.
3.  El worker A cree que el `claim` falló (no obtuvo la fila de vuelta) y no envía.
4.  El lease del `claimed` expira, un worker B lo ve, pero la nueva regla lo pasa a `dudoso`.

En este escenario, **la invariante funciona y no hay duplicación automática**. El caso se convierte en revisión manual. El diseño resiste incluso este fallo de red. La duplicación automática requeriría que el estado `dudoso` fuera re-procesado automáticamente, pero el diseño lo prohíbe explícitamente.

#### 2. ¿Queda algún camino de silencio total?
**PLAUSIBLE, PERO IMPROBABLE.**

Silencio total = el sistema cree que envió, el cliente no recibe nada y nadie se entera.
El diseño mitiga esto de dos formas:
1.  **Acuses de Meta:** El webhook escucha los webhooks de `statuses` (`webhook.js:1003`). Si Meta reporta `failed`, se genera un evento en el cockpit y una alerta al dueño (`webhook.js:1058-1087`).
2.  **Monitor de `claimed` envejecidos:** Un worker debe mover los `claimed` viejos a `dudoso` y notificar.

El agujero estaría si:
a) El envío falla de una forma que Meta **no reporta** con un `failed` (ej. bug de Meta).
b) El proceso muere justo después del `claim` y **antes** del envío, y el monitor que debe pasar de `claimed` a `dudoso` falla o no corre.

El diseño reconoce (B2) que un `claimed` envejecido es "el bug original con otro nombre" y le asigna un vigilante. Mientras ese vigilante funcione, no hay silencio. El riesgo se traslada a la robustez de ese monitor.

#### 3. ¿B4 (PDF fuera de la transacción) abre algún agujero nuevo?
**VERIFICADO, SÍ.**

Abre dos, pero el diseño los maneja correctamente:

1.  **PDF Huérfano:** Si se sube el PDF a `media_attachments` (o donde sea que se guarden) y la transacción posterior para crear la fila en `entrega_outbox` falla, queda un PDF almacenado que nunca se usará. El diseño lo reconoce: *"Un PDF guardado sin fila de outbox es un huérfano barato (lo barre un job)"*. Esto es un costo de almacenamiento, no un error de cara al cliente. **Aceptable.**

2.  **Desconexión PDF-Outbox:** El PDF se guarda y se obtiene un `media_id`. Ese `media_id` se pasa a la transacción que inserta la fila en `entrega_outbox`. Si en esa transacción no se guarda correctamente el `media_id`, la fila de `entrega_outbox` apuntará a un PDF incorrecto o a ninguno. El riesgo es bajo si se usa un `INSERT` simple, pero es un punto de fallo a vigilar.

El orden propuesto (primero PDF, luego transacción) es el correcto. El inverso (transacción y luego PDF) sería peor: una fila de outbox sin su PDF es una "promesa rota" al cliente; un PDF sin su fila de outbox es basura interna.

#### 4. ¿Qué sigue sin ver nadie?
*Ver la sección de abajo.*

---

### LO QUE EL DISEÑO NO VIO

1.  **La resolución manual de `dudoso` es un punto de error humano.** El diseño confía en que un humano "abre el chat del cliente y ve si el PDF está o no". ¿Qué pasa si el humano se equivoca?
    *   **Caso A:** El PDF SÍ llegó, pero el humano no lo ve y marca `reenviar`. **Resultado: DUPLICADO**, esta vez por vía manual. La regla del dueño se rompe.
    *   **Caso B:** El PDF NO llegó, pero el humano cree que sí y marca `enviado`. **Resultado: SILENCIO TOTAL.** El cliente nunca recibe el documento y el sistema lo da por cerrado.
    El diseño debería proponer guardas en la UI de resolución: mostrar un screenshot del chat, pedir doble confirmación, etc. El riesgo se movió de la máquina al humano, pero no desapareció.

2.  **La unicidad del `instance_id` para el fencing.** El diseño asume que cada worker tiene un `instance_id` único para el "fencing" del `UPDATE`. No se especifica cómo se genera este ID. Si dos workers arrancan con el mismo ID (ej: un string fijo en la config, o un hostname que no es único en un entorno contenedor), el `claim` deja de ser seguro. El `UPDATE ... WHERE id=$2 AND estado='pending'` sigue protegiendo contra el re-claim del mismo `id`, pero otras lógicas que pudieran depender del `instance_id` serían vulnerables.

3.  **El "Vigilante del vigilante" sigue centralizado.** El diseño mejora la alerta del vigilante (casos `dudoso`/`pending` viejos) mostrándola también en el cockpit, por si WhatsApp/Meta está caído. Pero la lógica que genera esa alerta sigue viviendo en el mismo pool de workers. Si el *proceso worker completo* está caído o colgado (ej: una fuga de memoria masiva), el vigilante tampoco corre, y no hay alerta en ningún canal. Una solución más robusta sería un health-check externo y minimalista (un "dead man's switch") que alerte si los workers no reportan actividad en X tiempo.

### Veredicto Final
## **APTO**
GEMINI EXIT: 0 (modelo=gemini-2.5-pro, limite=1800s)
