Warning: True color (24-bit) support not detected. Using a terminal with true color enabled will result in a better visual experience.
Warning: tools.exclude in settings.json is deprecated and will be removed in 1.0. Migrate to Policy Engine: https://geminicli.com/docs/core/policy-engine/
Ripgrep is not available. Falling back to GrepTool.
Skill "skill-creator" from "C:\Users\mcifu\.agents\skills\skill-creator\SKILL.md" is overriding the built-in skill.
(node:16656) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
(Use `node --trace-deprecation ...` to show where the warning was created)
VEREDICTO DE DISEÑO: #778 (ABOGADO DEL DIABLO)

## Veredicto Final: APTO

El diseño es sólido. Ataca las causas raíz de la falta de durabilidad con mecanismos estándar y probados (tabla de deuda, claim transaccional). Prioriza correctamente la regla del dueño ("a lo sumo una entrega") por sobre la simplicidad, transformando un riesgo de negocio en una decisión de diseño explícita.

---

### 1. ¿Hay un escenario donde el cliente igual reciba dos veces el mismo PDF?

**El diseño sistémico parece inmune al duplicado automático. El riesgo se traslada al proceso humano.**

*   **VERIFICADO:** La combinación de la `UNIQUE (tenant_id, tipo, folio, variante)` en `entrega_outbox` y el claim transaccional de D4 (`UPDATE ... WHERE estado='pending'`) hace criptográficamente difícil que el sistema despache dos veces la *misma obligación*. No pueden existir dos filas para el mismo documento, y una misma fila no puede ser procesada dos veces.

*   **PLAUSIBLE:** El único escenario de duplicado que logro construir es por intervención humana o por un bug en la lógica de acuses de Meta:
    1.  **El Humano Falla:** El sistema marca una entrega como `dudoso` porque el proceso murió después de enviar el PDF a Meta pero antes de registrar el `wamid`. El documento **SÍ LLEGÓ** al cliente. El dueño, en la lista de conciliación, ve el `dudoso` y lo reenvía a mano. Esto es un fallo del proceso de conciliación, no del diseño técnico.
    2.  **El Acuse se Pierde o se Procesa Mal:** Similar al anterior. El sistema manda, muere, queda en `claimed`. El acuse `delivered` de Meta llega, pero un bug en el manejador de `statuses` (`webhook.js:868`) impide que actualice la fila `claimed` a `delivered`. El worker la ve vencida y la marca `dudoso`. El humano la reenvía. El duplicado lo causa el bug en el consumidor de acuses, no el flujo de envío.

El diseño D5 es correcto al aplicar la regla del dueño: ante la duda, no reenviar y escalar a un humano. El diseño en sí no genera duplicados.

### 2. ¿Se puede prometer sin que las filas estén confirmadas? ¿Qué pasa si el INSERT del PDF es lento o falla?

**No. El diseño D2 invierte el orden actual para cerrar este riesgo.**

*   **VERIFICADO:** El diseño exige la secuencia: 1° `INSERT` a `media_attachments` (los bytes del PDF), 2° `INSERT` a `entrega_outbox` (la "deuda"), 3° recién ahí se le promete al cliente.
*   **ANÁLISIS:** Si el `INSERT` del PDF en `media_attachments` falla o es muy lento, la transacción no llega al paso 3. La fila en `entrega_outbox` nunca se crea. Por ende, la promesa al cliente (paso 4) nunca se ejecuta. El sistema no promete lo que no puede registrar como deuda. Esto es una mejora fundamental sobre el flujo actual, donde la promesa ocurre antes de la persistencia (`webhook.js:3087` vs `webhook.js:3671`).

El riesgo se convierte en uno de integridad de datos (un PDF huérfano si el `INSERT` del outbox falla y no hay una transacción que lo revierta), pero no en uno de experiencia de cliente.

### 3. ¿La `UNIQUE KEY` es la correcta?

**Sí, para el problema de la entrega *automática* desatendida. Define un límite que el diseño de reenvío manual debe respetar.**

*   **VERIFICADO:** La llave `(tenant_id, tipo, folio, variante)` define unívocamente un documento generado por el sistema.
*   **ANÁLISIS:** El caso legítimo de reenvío ("mándamela de nuevo, la borré") es un requerimiento de **operación manual**, no de la lógica de negocio automática. La `UNIQUE KEY` correctamente prohíbe que se inserte una *nueva* fila de `pending` para un documento ya manejado.
    *   Un operador humano que necesite reenviar un documento debería tener una herramienta que:
        1.  Busque la fila *existente* en `entrega_outbox` (que estará en `delivered` o `dudoso`).
        2.  La fuerce a un estado `pending_manual_resend`.
        3.  El worker la recogería y la entregaría, usando el `media_id` ya registrado.
    *   Esto evita violar la `UNIQUE KEY` y mantiene la trazabilidad. La llave es correcta porque fuerza a que el reenvío sea una operación consciente sobre un registro existente, no una nueva deuda indistinguible de la original.

### 4. ¿El worker puede pelear con el turno?

**No. El diseño D3 y D4 previene las condiciones de carrera de forma estándar.**

*   **VERIFICADO:** El `UPDATE ... SET estado='claimed' ... WHERE estado='pending' RETURNING *` (D4) es una operación atómica a nivel de base de datos. Si el turno principal y el worker intentan tomar la misma fila `pending` en el mismo nanosegundo, Postgres garantiza que solo uno de ellos recibirá la fila de vuelta. El otro recibirá un conjunto vacío y no hará nada.
*   **VERIFICADO:** Al tener una única rutina de entrega `entregarPendiente(row)` (D3), se elimina la posibilidad de que el turno y el worker usen lógicas distintas que puedan entrar en conflicto. Una vez que una fila es reclamada (`claimed`), el camino para entregarla es uno solo.

Este es el patrón correcto y robusto para implementar una cola de trabajos sobre una tabla de base de datos.

### 5. ¿Qué cuesta de más?

*   **Bytes de PDF en Postgres (costo de almacenamiento):**
    *   **PLAUSIBLE:** El diseño asume una tabla `media_attachments` con una columna `media_data` (tipo `bytea`). No pude verificar el esquema porque no está en este repo, pero es una práctica común. Almacenar binarios en la BD incrementa su tamaño, lo que puede encarecer y ralentizar respaldos y restauraciones. La alternativa es usar almacenamiento de objetos (S3, GCS) y guardar solo la URL, pero eso agrega complejidad. Para el volumen actual del negocio (~272 folios/mes), el costo en la BD es probablemente marginal y aceptable a cambio de la simplicidad.
*   **Latencia antes de la promesa (costo de performance):**
    *   **VERIFICADO:** El flujo actual promete rápido y persiste en segundo plano (`estadoPersistente.js:92` es fire-and-forget). El nuevo diseño agrega dos escrituras bloqueantes a la base de datos (`media_attachments` y `entrega_outbox`) **antes** de responderle al cliente. Esto inevitablemente aumentará la latencia percibida entre que el cliente confirma y Oliver responde "listo, te la preparé". Es el costo ineludible de la fiabilidad. Se cambia velocidad por seguridad, que es la decisión correcta para este problema.

---

## LO QUE EL DISEÑO NO VIO

1.  **Manejo de "Poison Pills":** El diseño tiene una columna `intentos` pero no especifica una política de reintentos máximos. Un documento que falla permanentemente (ej: un `media_id` corrupto que `sendWaDocument` siempre rechaza) podría ser reclamado y fallado por los workers indefinidamente, consumiendo recursos. Se necesita una regla `WHERE intentos < N` en la consulta del worker, y un mecanismo para mover filas que superen `N` a un estado `failed` terminal para análisis humano.
2.  **Lógica del consumidor de acuses (`statuses`):** El diseño menciona que el webhook de `statuses` (`webhook.js:868`) puede mover `meta_accepted -> delivered`. Pero su lógica debe ser más explícita: ¿qué hace si llega un acuse `delivered` para una fila que está en estado `claimed`? ¿La actualiza? Si no lo hace, esa fila podría ser marcada innecesariamente como `dudoso` por el worker, generando trabajo manual evitable. El contrato entre el outbox y el consumidor de acuses debe ser preciso.
3.  **El acoplamiento entre repositorios:** El diseño depende de una tabla (`media_attachments`) y creará una nueva (`entrega_outbox`) en la base de datos de otro servicio (`temp-sales-os`). Esto crea un acoplamiento fuerte. Un cambio de esquema o una caída en `sales-os` impactará directamente la capacidad de este bot para enviar documentos. Si bien puede ser una decisión arquitectónica ya tomada, es un riesgo operativo que el diseño no menciona. La imposibilidad de verificar los esquemas desde este repo es prueba de ello.
4.  **Limpieza y archivado:** Con el tiempo, la tabla `entrega_outbox` crecerá. El diseño no contempla una estrategia de ciclo de vida para estas filas. ¿Se archivan las filas en `delivered` o `failed` después de X meses? ¿Se purgan? Mantener todos los registros para siempre puede degradar el rendimiento de las consultas del worker.
GEMINI EXIT: 0 (modelo=gemini-2.5-pro, limite=1800s)
