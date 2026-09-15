# TRIDENTE — Auditoría Oliver 7 días · plan de mejora permanente
Fecha: 2026-09-15 · Repo: `C:\Users\mcifu\activa\temp-wa` (whatsapp-ia-hubspot, index.js v11.7, 340.909 bytes)
Repo hermano: `C:\Users\mcifu\activa\temp-sales-os` (activa-sales-os)

## Regla de esta ronda
El dueño dijo: **"no se parcha nada, todo tiene que ser mejora permanente para producción"**.
Nada de hotfix, nada de regex pegado al vuelo. Módulo puro + tests + wiring en el flujo real + deploy.

## Evidencia medida (Postgres producción, 8–15 sep 2026)
- 1.657 mensajes / 112 conversaciones. 919 salientes de IA, 595 entrantes.
- 1 mensaje (0,1%) filtró al cliente el bloque crudo `<tool_call>{"name":"calcular_cotizacion","arguments":{...}}` + `<tool_response>{"ok":true,"folio_temp":"TMP-2067","serie":"SLIDING_2H_1R",...}` — 2.120 chars. conv `4d16c6ca`, 14-sep 22:34.
- 35 mensajes (3,8%) con `**negrita**` Markdown, que WhatsApp NO renderiza (usa `*simple*`).
- 37 mensajes (4%) > 900 chars; máx 2.120.
- 6 de 114 conversaciones con `customer_name` basura: "Donde Estan Ubicados", "Ay Le Estaré Avisando", "O Proyectante", "Padre-las-casas", "Correderas", "Hermosa". Ese nombre **se imprime en el PDF de la Propuesta Técnica Económica**.
- 74 folios CM-FR-004 emitidos en 7 días sobre 27 conversaciones = 2,7 por cliente. CM-...-0454, -0454-B y -0454-C salieron los tres por **$2.520.791 exactos** (folio nuevo, cero cambio de precio).
- conv `94088040` tiene `external_id = 56957296035` = **CEO_WHATSAPP del dueño**. Generó 172 mensajes y 15 folios reales = 21% de la semana. Contamina correlativo ISO y KPIs.
- 90 de 164 filas de `quotes` (55%) quedaron `status='draft'` con `quote_number`, `amount_total`, `total_clp` en NULL.

## Causa raíz VERIFICADA en código (citar archivo:línea al refutar)

**C1 — el sanitizador no cubre tool-calling ni Markdown.**
`index.js:956 sanitizeForCustomer()`. Sus regex de JSON exigen nombres de campo específicos
(`id|product|measures|qty|color|unit_price|total_price|source|confidence`). El bloque filtrado usaba
`"name"` y `"arguments"` → no matchea. Las etiquetas `<tool_call>` / `<tool_response>` no se tocan en
ninguna de las 5 reglas. Tampoco hay conversión `**` → `*` ni tope de largo.

**C2 — hay rutas de envío que NO pasan por el sanitizador.**
`index.js:1866 waSendH()` sí sanitiza (línea 1868). Pero:
- `index.js:1934` dentro de `waSendMultiH()` llama `await waSend(to, m)` **crudo**.
- `index.js:6560` llama `await waSend(waId, ...)` crudo.
- `index.js:1688` `waSend(ESCALATION_PHONE, alertMsg)` (interno, menos grave).
O sea el "SANITIZADOR UNIVERSAL" de v11.3-4 no es universal.

**C3 — `isLikelyName()` acepta casi cualquier frase corta.**
`services/oliverName.js` v1.0.0. `isLikelyName()` solo exige: sin `?`, sin dígitos, solo letras/espacios,
1–4 palabras, y que ninguna palabra esté en `COMMAND_SET`. Esa lista negra no contiene interrogativos
("donde", "cuándo", "dónde"), ni "estan/ubicados", ni "correderas" (tiene "ventana/ventanas" pero no
"corredera/correderas"), ni comunas (tiene "ciudad/sector/commune" pero ningún nombre de comuna), ni
adjetivos sueltos ("hermosa"), ni sufijos de razón social (Spa, Ltda, SpA, E.I.R.L.).
El captador está en `index.js:6217-6223`, guardado por `needsName(ses.data) && (ses.nameAsked || /soy|me llamo|.../) && isLikelyName(userText)`.
El agujero real: cuando el bot pregunta el nombre (`ses.nameAsked=true`), el cliente responde otra cosa
("donde estan ubicados") y eso pasa el filtro y queda como nombre. Después `index.js:569` lo copia a
`customer_name: d.name || "Cliente WhatsApp"` y de ahí al PDF.

**C4 — el correlativo ISO no tiene deduplicación ni exclusión de pruebas.**
`temp-sales-os/src/services/quoteCorrelativo.js` → `nextQuoteNumber()` hace
`INSERT ... ON CONFLICT DO UPDATE SET last_seq = last_seq + 1 RETURNING`, expuesto en
`POST /internal/quotes/next-number`. Incrementa SIEMPRE que el bot pide número, sin mirar si el monto
cambió ni de qué teléfono viene. No hay noción de "versión de la misma cotización".

## Plan propuesto (lo que el tridente debe adjudicar)

**P1 — `services/salidaSegura.js` (módulo nuevo, puro, con tests).**
Una sola función `limpiarParaCliente(texto)` que: (a) borra bloques `<tool_call>…</tool_call>` y
`<tool_response>…</tool_response>` y cualquier JSON con `"name"`/`"arguments"`; (b) convierte `**x**` → `*x*`;
(c) corta a N chars con corte por frase. Si tras limpiar queda vacío o el texto ERA principalmente un
tool-call, devuelve `{ bloquear: true }` para que el turno se reintente en vez de mandar un mensaje mutilado.
Se absorbe `sanitizeForCustomer` (índice.js:956) dentro del módulo, no se duplica.

**P2 — un único embudo de salida.** Que `waSendH`, `waSendMultiH` y los `waSend` sueltos de 6560/1688
pasen todos por `limpiarParaCliente`. Idealmente sanitizar dentro de `waSend` mismo para que sea
imposible saltárselo.

**P3 — `oliverName.js` a v2.0.0: validador positivo, no lista negra.**
`esNombreDePersona(texto)` que exige estructura de nombre (léxico de nombres/apellidos chilenos comunes +
morfología) y rechaza: interrogativos, vocabulario de catálogo cargado del propio engine, las 32 comunas
de La Araucanía, razón social (Spa/Ltda/SpA/EIRL/E.I.R.L.). Además `nombreParaDocumento(ses)` que decide
qué va al PDF: si no hay nombre de persona válido → pedirlo explícitamente ANTES de emitir folio, nunca
imprimir basura. Mantener retrocompatibilidad de `extractName`/`needsName` (ya tienen test suite).

**P4 — `quoteCorrelativo.js`: folio idempotente por (conversación, monto).**
`POST /internal/quotes/next-number` recibe `conversation_id` + `amount_total`; si ya existe folio para
esa conversación con el mismo monto, devuelve **el mismo** en vez de quemar uno nuevo. Cambio de monto
→ sufijo de versión (-B, -C) que ya se usa, o folio nuevo, a decidir.

**P5 — teléfonos internos fuera del correlativo y de los KPIs.**
`CEO_WHATSAPP` / `OWNER_PHONE` → folio con prefijo `TEST-` y exclusión en los conteos del brief 7AM.

**P6 — drafts sin monto no se persisten** (o TTL 24h) en `quotes`.

## Lo que se pide a cada uno de ustedes
1. **Refutar con evidencia.** Si una causa raíz está mal leída, citar `archivo:línea` que lo desmiente.
2. **Cazar lo que falta.** ¿Qué rompe este plan en producción? ¿Qué otra ruta de salida al cliente existe
   que no listé? ¿`waSend` se usa en templates de Meta donde sanitizar rompería el formato?
3. **Veredicto por punto: APTO / NO APTO / APTO CON CAMBIOS**, y el cambio concreto.
4. **Riesgo de regresión**: `oliverName.js` tiene `oliverName.test.js` con casos vivos. ¿Subir a v2.0.0
   rompe algo? ¿P4 rompe la trazabilidad ISO 9001 §7.5 (secuencia sin huecos)?
5. Marcar cada afirmación como **VERIFICADO** (leíste el archivo) / **PLAUSIBLE** / **NO PUEDO SABERLO**.

## Reglas duras
SOLO LECTURA. No editar, no crear archivos fuera de tu propio informe, no `git add/commit/push`, no deploy.
Español chileno, sin humo, sin adular. Citar siempre `archivo:línea` o el comando que corriste.
No imprimir secretos (`.env` existe en el repo: NO lo abras ni lo cites).
