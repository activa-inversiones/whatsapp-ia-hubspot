# Auditoría Oliver — Reporte de Hallazgos Confirmados
> Generado: 2026-06-19 · Solo hallazgos VERIFICADOS contra código real

---

## Resumen Ejecutivo

### Conteo por Severidad

| Severidad | Cantidad |
|-----------|----------|
| CRITICA   | 1        |
| ALTA      | 23       |
| MEDIA     | 16       |
| BAJA      | 10       |
| No aplica | 1        |
| **TOTAL** | **51**   |

> Nota: 3 hallazgos originalmente clasificados ALTA fueron re-clasificados MEDIA por el verificador tras revisar el código real. 3 hallazgos clasificados BAJA fueron re-clasificados ALTA. 2 hallazgos originalmente ALTA fueron re-clasificados BAJA. Ver campo `corrected_severity` en detalle.

### Conteo por Categoría

| Categoría       | Total | CRITICA | ALTA | MEDIA | BAJA |
|-----------------|-------|---------|------|-------|------|
| confiabilidad   | 10    | 1       | 6    | 1     | 2    |
| cobra-mal       | 10    | 0       | 4    | 4     | 2    |
| pierde-cliente  | 14    | 0       | 9    | 2     | 3    |
| prompt          | 7     | 0       | 4    | 3     | 0    |
| pdf             | 6     | 0       | 1    | 3     | 2    |
| sesion          | 4     | 0       | 1    | 2     | 1    |
| contexto        | 2     | 0       | 0    | 2     | 0    |
| canal           | 5     | 0       | 3    | 0     | 2    |
| vision_voz      | 3     | 0       | 1    | 1     | 1    |
| ruteo_alertas   | 5     | 1       | 1    | 0     | 3    |
| precio          | 1     | 0       | 0    | 1     | 0    |

---

## CRITICA

### [CON-01] ADMIN_PIN hardcodeado '<pin-viejo>' en prod: cualquiera puede disparar plantillas o escalaciones falsas
> ✅ 2026-07-25 (#134): fallback eliminado — `ADMIN_PIN` ahora es fail-closed desde env (index.js:788 + guard en adminCheckAuth y /admin/send-template[-bulk]). La rotación del PIN vivo en Railway queda a cargo del dueño (#67/#135).
- **Archivo:** `C:/Users/mcifu/activa/temp-wa/index.js:780`
- **Evidencia:** `const ADMIN_PIN = process.env.ADMIN_PIN || "<pin-viejo>";`
- **Impacto:** El PIN por defecto '<pin-viejo>' es fijo y conocible. Permite a cualquiera con la URL pública llamar `POST /admin/send-template?pin=<pin-viejo>` y enviar plantillas WhatsApp a cualquier número (recontacto, escalación, informe diario). Sin restricción de IP, sin middleware, sin rate-limit — solo el check `pin !== ADMIN_PIN`. Si el PIN de producción NO fue sobreescrito en Railway, el endpoint admin está completamente abierto. Riesgo de ban de cuenta Meta y responsabilidad legal.
- **Fix:** Verificar en Railway que `ADMIN_PIN` esté seteado con valor secreto fuerte. Agregar alerta de arranque: `if (!process.env.ADMIN_PIN) console.error('[CRITICO] ADMIN_PIN no configurado, usando default inseguro');`
- **Confianza:** Alta. Verificado directamente en código de producción. Los endpoints `/admin/send-template` (L4505-4508) y `/admin/send-template-bulk` (L4557-4560) son públicamente alcanzables en `https://whatsapp-ia-hubspot-production.up.railway.app`. Los callers internos V2 (`escalation.js:46-48`) usan correctamente `|| ''` con guard, por lo que el riesgo real está en el HTTP endpoint V1.

---

## ALTA

### [CON-02] WhatsApp takeover fail-OPEN: bot responde encima del operador cuando sales-os está caído
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\webhook.js:399-426`
- **Evidencia:** `safe('control', ...)` devuelve `null` ante excepción/timeout → `aiPaused = !!null && ... = false` → bot sigue respondiendo. `channel-agent.js` tiene `CONTROL_CACHE` (L152-166 y 244-253) con fail-closed.
- **Impacto:** Durante una caída de `sales-os` (incluso parcial, 3s de timeout), si Marcelo tiene el takeover activo en WhatsApp, Oliver sigue respondiendo encima del operador. Puede contradecir una negociación en curso y arruinar un cierre real.
- **Fix:** Portar `CONTROL_CACHE` idéntico al de `channel-agent.js` (líneas 152-166 y 244-253) a `webhook.js`. Fail-closed = no responde si el último estado conocido era takeover humano.
- **Confianza:** Alta. `webhook.js` no contiene `CONTROL_CACHE` (búsqueda exhaustiva: cero resultados). El comentario en `channel-agent.js:155` documenta explícitamente: "WhatsApp mantiene su fail-open".

### [CON-03] SEEN.clear() ciego antes del mutex: ventana de doble-proceso de msgId en burst
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\webhook.js:376-388`
- **Evidencia:** `if (seen.size >= SEEN_MAX) seen.clear(); seen.add(msgId); ... await acquireLock(...)` — el `clear()` sincrónico ocurre ANTES del `await`, destruyendo todos los msgIds del Set incluyendo el recién añadido.
- **Impacto:** En ráfaga con muchos mensajes de distintos números, Thread A limpia el set completo justo antes de que Thread B verifique `seen.has(msgId_B)`. Un retry de Meta que llegue en la ventana post-`clear()` bypasea el dedup y procesa el mensaje dos veces: doble respuesta al cliente, doble llamada al motor de cotización.
- **Fix:** Reemplazar `clear()` con evicción FIFO o por antigüedad (`Map<msgId, timestamp>` + delete entries > 10 min).
- **Confianza:** Media (re-clasificado a MEDIA por verificador — ver versión final abajo). Node.js es single-threaded; el race real es via event loop, requiere SEEN_MAX=5000 mensajes activos. Ver [SES-04] abajo para la clasificación correcta.

### [PDF-01] PDF determinista (pending_quote) ausente en WhatsApp — LLM puede omitir generar_pdf_cotizacion
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\webhook.js:800-805`
- **Evidencia:** No existe bloque equivalente al de `channel-agent.js:521-548` (`pending_quote` + `isPdfAffirmative` + `lastAssistantOfferedPdf`). `webhook.js` depende 100% del LLM para llamar `generar_pdf_cotizacion`.
- **Impacto:** En WhatsApp (canal principal), cuando el LLM no llama la tool (falla conocida en producción: escribía `[Enlace a la cotización]` como texto), el cliente nunca recibe el PDF formal. La cotización se pierde sin folio ISO. IG/FB tienen la protección; WhatsApp no.
- **Fix:** Portar el bloque `pending_quote` de `channel-agent.js:517-548` a `webhook.js` antes del `handleTurn`. Incluir captura de items post-turno (`itemsFromQuoteCalls → newState.pending_quote`).
- **Confianza:** Alta. `grep pending_quote` en `webhook.js` = cero resultados. Falla confirmada en historial de producción.

### [COB-01] normMeasuresLocal fallback path aún usa <=300 (debería ser <400)
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\services\enginePricer.js:169-170`
- **Evidencia:** `if (a >= 7 && a <= 300) a *= 10;` — el fix cm→mm de 2026-06-18 se aplicó solo al branch `dimMatch` (línea 143-144) pero el fallback conserva el umbral viejo.
- **Impacto:** Si el cliente escribe medidas sin separador explícito ('x'), ej. `315 215` (cm), el fallback lee 315 y 215, los deja sin convertir (>300 en el test), y cotiza 315×215 mm (0,07 m²) en vez de 3150×2150 mm. Precio resultante ~3-4× más bajo de lo real. `normalizers.js` ya tiene `<400` en ambos paths.
- **Fix:** Cambiar `enginePricer.js:169-170` de `a <= 300` → `a < 400` y `b <= 300` → `b < 400`.
- **Confianza:** Alta. Verificado en código real. `normalizers.js` tiene `< 400` en AMBOS paths (dimMatch L251-252 y fallback L282-283); `enginePricer.js` tiene `<= 300` en el fallback.

### [COB-02] total_con_iva como último fallback en enginePricer: riesgo de doble IVA silencioso
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\services\enginePricer.js:338`
- **Evidencia:** `const lineTotal = Number(r.total_clp ?? r.total_neto_clp ?? r.total_con_iva ?? 0);` — el comentario en L335-337 dice explícitamente "Usar total_con_iva acá causaba doble IVA. FIX." pero el "fix" aún incluye `total_con_iva` como tercer fallback. Mismo patrón en `tools.js:448`.
- **Impacto:** Si el motor devuelve solo `total_con_iva` (posible en cambio de versión de API), el pricer lo usa como neto y agrega 19% encima → cliente recibe precio ~19% más alto. Es una bomba silenciosa; hoy no se dispara porque el motor siempre devuelve `total_clp`.
- **Fix:** Eliminar `total_con_iva` del fallback: `r.total_clp ?? r.total_neto_clp ?? 0`. Si ninguno está presente, caer al guard `lineTotal <= 0` → escalada. Igual en `conUnitPrice`.
- **Confianza:** Alta. Verificado en dos archivos. El comentario en el código documenta explícitamente el riesgo pero el fix está incompleto.

### [COB-03] IG/FB no captura atribución CTWA/ads — conversiones de Meta Ads no se atribuyen
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\channel-agent.js:296-314`
- **Evidencia:** `webhook.js:456-478` lee `rawMessage`, llama `parseReferral` y hace `bridge.pushLeadEvent` con fbclid/ctwa_clid. `channel-agent.js` no tiene ninguna referencia a `parseReferral`, `ctwa_clid`, `fbclid`, ni `ad_id`. `multiChannelHandler.js` descarta `imageId`/`audioId` antes de pasar a `handleChannelTurn`.
- **Impacto:** Leads de Click-to-Instagram-DM no se atribuyen. `bridge.pushQuoteEvent` se llama con todos los clids en null. ROAS cero en dashboard y Meta Ads Manager para campañas de IG/FB.
- **Fix:** Pasar `rawMsg` en la cadena `multiChannelHandler → processMessage → handleChannelTurn` y agregar el bloque `parseReferral` que ya tiene `webhook.js:455-478`.
- **Confianza:** Alta. Confirmado en cadena completa: `multiChannelHandler.js:423/460` descarta los campos; `channel-agent.js:199-200` no acepta `imageId`/`audioId`; `channel-agent.js:495-498` referencia campos que siempre son null.

### [CLI-01] IG/FB no procesa imágenes ni audio — visión y STT solo en WhatsApp
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\channel-agent.js:199-203`
- **Evidencia:** `webhook.js` tiene `resolveUserText()`, `downloadWaMedia()`, `describeImage()`, `transcribeAudio()`. `channel-agent.js` recibe solo `text = ''`; imágenes llegan como `'[image]'`. El comentario en `channel-agent.js:27` admite: "voz/visión/STT de adjuntos ENTRANTES: TODO".
- **Impacto:** Cliente de Instagram que manda foto de ventana para cotizar → Oliver recibe `[image]` → responde pidiendo medidas cuando ya estaban en la foto. Pierde lead por fricción. El fix de visión "YA ARREGLADO HOY" aplica solo a WhatsApp.
- **Fix:** Extender `normalizeIncoming` o `processMessage` para descargar adjuntos y pasarlos a `channel-agent`. `normalizeIncoming:340-341` ya extrae `imageId` y `audioId` pero los descarta en la cadena.
- **Confianza:** Alta. Confirmado en cadena completa: `multiChannelHandler.js:423` descarta imageId; `index.js:4182/4199` no los propaga; `channel-agent.js:199-200` no los acepta.

### [CLI-02] No hay alerta a Marcelo si el PDF falla la entrega WA
- **Archivo:** `C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:697-711, 790-795`
- **Evidencia:** `webhook.js` captura `docSent` y lo loguea pero NO escala a Marcelo si `!docSent`. `channel-agent.js:503-509` tiene el bloque explícito: `if (!pdfSent) { await safe('generarPdf.escalate', () => notifyHighValue(...)) }`.
- **Impacto:** Si Meta rechaza el documento (token expirado, ventana 24h cerrada, error de red), el cliente no recibe el PDF, el bot no lo sabe, Marcelo no es alertado. Canal principal = WhatsApp = máximo tráfico.
- **Fix:** Agregar después del bloque de envío (L710): `if (!docSent) { await safe('generarPdf.escalate', () => notifyHighValue(..., 'PDF '+quoteNumber+' no entregado a WA — enviar desde ops.activalabs.ai')); }`. `notifyHighValue` ya está importada en `webhook.js:53`.
- **Confianza:** Alta. `notifyHighValue` importada pero no usada en este path. El hueco es confirmado.

### [CLI-03] LLM no recibe instrucción sobre qué decir cuando pdf_sent:false — puede alucinar éxito
- **Archivo:** `C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/system-prompt.js:574-609`
- **Evidencia:** `webhook.js:790-795` retorna `{ ok:true, quote_number, pdf_sent:docSent, media_id }` sin campo `message`. `channel-agent.js:508-509` sí incluye `message: "Te preparé tu cotización...Si no la ves acá en un momento, Marcelo te la hace llegar enseguida."` para el caso fallo. `system-prompt.js` no contiene ninguna mención de `pdf_sent`.
- **Impacto:** El LLM puede decirle al cliente "Listo, te envié la propuesta" cuando el PDF nunca llegó. Cliente espera documento inexistente, pierde confianza y abandona.
- **Fix:** Agregar `message` al return de `webhook.js:790-795` para la rama `pdf_sent:false` y añadir regla al system-prompt: si el tool result trae `pdf_sent:false`, decir "Si en un momento no ves el archivo, Marcelo te lo envía directamente" y NO decir "ya te lo envié".
- **Confianza:** Alta. Asimetría `channel-agent.js` vs `webhook.js` verificada línea por línea.

### [CLI-04] Lista de N ventanas distintas: solo se cotiza la 1ª (MAX_TOOL_ITERATIONS=3 insuficiente para N≥2 + PDF en el mismo turno)
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\agent.js:34,75-126`
- **Evidencia:** `MAX_TOOL_ITERATIONS = 3` + `parallel_tool_calls: false` (engine.js L102). Para N=3 ventanas: iter1→calc(v1), iter2→calc(v2), iter3→calc(v3) → loop agotado sin posibilidad de llamar `generar_pdf_cotizacion`. Viola Regla #13 (cotización+PDF en el mismo turno).
- **Impacto:** Con 3+ ventanas distintas, el PDF nunca se genera en el mismo turno. Con N=2 + cualquier tool intermedia (ej. `listar_vidrios`), también falla.
- **Fix:** Subir `MAX_TOOL_ITERATIONS` a 6. O instruir al LLM para que agrupe ventanas en un solo array `items[]` en `calcular_cotizacion` (requiere cambio de tool schema).
- **Confianza:** Alta. Aritmética verificada en código. `parallel_tool_calls: false` confirmado en `engine.js:102`. Regla #13 (`system-prompt.js:353-354`) exige calcular+PDF en el mismo turno.

### [CLI-05] Pass2 max_tokens=350 trunca respuestas complejas: cotización multi-ítem + disclaimer + cierre quedan cortados
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\engine.js:121-130`
- **Evidencia:** `max_tokens: 350` hardcodeado en `orchestratorPass2`. No hay chequeo de `finish_reason` en ningún archivo (`grep finish_reason` = cero resultados).
- **Impacto:** Respuesta con 2-3 ítems cotizados + aviso referencial + precio con IVA + cierre supera fácilmente 350 tokens. OpenAI trunca sin lanzar excepción → cliente recibe mensaje cortado a mitad de frase. Especialmente grave si el truncado cae en el precio o en el disclaimer.
- **Fix:** Subir a 600-700 tokens. Agregar chequeo: `if (r.choices[0].finish_reason === 'length')` → loguear warn + fallback reply.
- **Confianza:** Alta. `max_tokens: 350` confirmado en L121-130. `finish_reason` ausente en todo `src/oliver-gpt/`.

### [COB-04] Pass1 max_tokens=500: JSON de tool_call para generar_pdf_cotizacion con items[] múltiples puede truncarse → input se parsea como {} silenciosamente
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\engine.js:95-112`
- **Evidencia:** `max_tokens: 500` en `orchestratorPass1` + `try { input = JSON.parse(call.function.arguments) } catch { input = {}; }` en `agent.js:106-108`. JSON de `generar_pdf_cotizacion` con 3+ items puede superar 500 tokens.
- **Impacto:** Si OpenAI trunca, JSON.parse lanza → `input = {}` → sin `items` → PDF no se genera. El LLM en Pass2 no sabe del fallo y puede anunciar envío exitoso.
- **Fix:** Subir `max_tokens` de Pass1 a 900-1000. Agregar log cuando `input = {}` tras catch para detectar truncados en producción.
- **Confianza:** Alta. Esquema de `generar_pdf_cotizacion` con 7 campos por ítem verificado en `tools.js:362-391`. Catch silencioso confirmado en `agent.js:105-109`.

### [PRO-01] Preguntas de financiamiento/crédito no tienen guion: el LLM improvisa y puede dar información incorrecta
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\system-prompt.js:179-191`
- **Evidencia:** `grep` en todo `src/oliver-gpt/` por `financiamiento`, `crédito`, `cuotas`, `financiar` = cero resultados en bloques de instrucciones. Solo aparece `financ.` como prioridad B2C en Área 8 L183.
- **Impacto:** "¿Tienen financiamiento?" es una de las primeras preguntas B2C en Temuco. Sin guion, el LLM puede inventar un plan de cuotas inexistente o dar respuesta vaga que no cierra la venta.
- **Fix:** Agregar en ÁREA 5 o ÁREA 7 un guion explícito con la política real de Activa (si tiene: citar opciones; si no: escalar a Marcelo para negociación directa). Confirmar datos reales con el dueño.
- **Confianza:** Alta. Ausencia total confirmada por búsqueda exhaustiva en todos los archivos de `src/oliver-gpt/`.

### [PRO-02] glass_id: ÁREA 6 dice 'NO pases glass_id' pero OPERATING_INSTRUCTIONS dice que es requerido
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\system-prompt.js:152-163 vs 584-589`
- **Evidencia:** ÁREA 6 L152: "glass_id obligatorio". L163: "NO pases glass_id ni serie a calcular_cotizacion". OPERATING_INSTRUCTIONS L584: "ejecutar cuando tenga tipo, medidas y glass_id". L589: "calcular_cotizacion requiere... y glass_id". En `tools.js:161-163`: glass_id marcado "IGNORADO".
- **Impacto:** LLM recibe instrucciones contradictorias. Puede esperar/pedir un glass_id que no necesita (añade fricción y turno extra) o pasar un glass_id de `listar_vidrios` anterior (aunque el engine lo ignore, agrega ruido).
- **Fix:** En ÁREA 6 L152 cambiar "glass_id obligatorio" por "glass_id IGNORADO (el vidrio se elige automático)". En OPERATING_INSTRUCTIONS L584 y L589 eliminar referencias a glass_id como requerido para `calcular_cotizacion`.
- **Confianza:** Alta. Contradicción verificada en código real. `tools.js` es ground truth: `required` de `calcular_cotizacion` no lista `glass_id` (solo `calcular_por_area` lo tiene).

### [PRO-03] Área 14 enseña precio en texto — contradice Regla #13 NUNCA PRECIO SUELTO EN TEXTO
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\system-prompt.js:253-255 vs 352-358`
- **Evidencia:** ÁREA 14 L254-255 (ejemplo DESPUÉS, marcado como modelo correcto): "Mire, esta corredera de 1.5×1.2 m en blanco con termopanel le queda en $321.593." Regla #13 L355: "PROHIBIDO dar el precio suelto en texto ('le quedaría en $X') como antesala del PDF".
- **Impacto:** Los LLM toman los ejemplos como anchors conductuales más fuertes que las reglas abstractas. Oliver aprenderá a dar precios en texto, saltándose el PDF. Pérdida de formalidad comercial y trazabilidad ISO.
- **Fix:** Reemplazar el precio concreto en el ejemplo de ÁREA 14 por: "Mire, esta corredera de 1.5×1.2 m en blanco con termopanel ya la calculé. Acá tiene la propuesta formal con todos los detalles. ¿Le calza con su proyecto?" — eliminando el precio suelto.
- **Confianza:** Alta. Contradicción presente y verificada entre L254-255 y L355 del mismo archivo.

### [PRO-04] Timing de escalación B2B contradictorio entre Regla #6, Regla #7 y Regla #28
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\system-prompt.js:312 vs 328 vs 444`
- **Evidencia:** Regla #6 T2 L312: "arquitecto" → escalar al instante (no especifica mensaje). Regla #7 L328: "B2B (constructoras, edificios, $15M+): escalar a Marcelo desde el primer mensaje." Regla #28 L444: "ARQUITECTO/DOM → escale a Marcelo desde el 2do mensaje."
- **Impacto:** Oliver no sabe si escalar en el mensaje 1 o el 2. Escalar en mensaje 1 a un arquitecto que recién saludó = cliente siente que lo pasan sin escucharlo. Escalar tarde = pierde momentum. Inconsistencia quema confianza en leads de alto valor.
- **Fix:** Unificar en una sola regla: B2B/arquitecto/DOM → Oliver escucha el primer mensaje y hace UNA pregunta de calificación; en el segundo turno entrega el contacto de Marcelo y notifica. Eliminar la referencia a "primer mensaje" de Regla #7 y alinear con Regla #28.
- **Confianza:** Alta. Los tres textos verificados en las líneas citadas. La tensión es real y reproducible.

### [CAN-01] IG/FB no tiene rate-limit por sender (WhatsApp tiene 18 msg/min, IG/FB tienen cero)
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\channel-agent.js:1-681`
- **Evidencia:** `webhook.js:95-119` define `RATE_MAP` y `rateOk()` (guard 18 msg/min). `channel-agent.js`: no existe `RATE_MAP` ni `rateOk`. Solo hay mutex (serializa, no throttlea).
- **Impacto:** Actor malicioso o cliente con burst puede enviar 100+ mensajes por IG/FB quemando tokens de OpenAI sin límite. Sin serialización de saturación, múltiples mensajes rápidos pueden escapar el mutex y generar respuestas cruzadas.
- **Fix:** Mover `rateOk()` a un módulo compartido y aplicarla en `handleChannelTurn` después de `acquireLock` y antes de la llamada al cerebro.
- **Confianza:** Alta. Confirmado: `webhook.js:95-120` tiene la función; `channel-agent.js` no tiene equivalente en ninguna forma.

### [VIS-01] Vision y STT sin timeout — lock colgado bloquea al cliente
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\webhook.js:183-210, 213-223, 161-179`
- **Evidencia:** `downloadWaMedia()` (L161-179): dos `fetch` sin `signal`. `describeImage()` (L183-210): `client.chat.completions.create()` sin `signal`. `transcribeAudio()` (L213-223): `client.audio.transcriptions.create()` sin `signal`. `acquireLock` se adquiere en L388, antes de todo el pipeline, y se libera en `finally` de L914.
- **Impacto:** Si Meta CDN u OpenAI (vision o STT) cuelga, el lock del cliente se mantiene durante todo el stall. Los mensajes siguientes del cliente encolan detrás del lock y quedan sin respuesta hasta que se resuelve el hang.
- **Fix:** Envolver con `Promise.race` contra `AbortSignal.timeout()`. Valores sugeridos: `downloadWaMedia` 10s, STT 20s, vision 25s.
- **Confianza:** Alta. Único uso de `AbortSignal.timeout` en el archivo (L647) es para endpoint de sales-os, no para media/vision/STT.

### [RUT-01] V1 fallback activo: excepción en oliver_gpt_flag silenciosamente degrada al V1 monolito
- **Archivo:** `C:/Users/mcifu/activa/temp-wa/index.js:4643-4666`
- **Evidencia:** El bloque `catch` en `oliver_gpt_flag` llama solo `logErr` pero no alerta a Marcelo ni responde "mantenimiento". V1 fallback tiene 5956 líneas con su propio pricer y escalación parcialmente desconectada.
- **Impacto:** Si `webhook.js` lanza en el import o primera línea, el mensaje cae silenciosamente a V1. En V1 la ruta `pass1.handoff` envía texto genérico sin alertar a Marcelo. Cliente recibe respuesta de baja calidad y Marcelo no se entera.
- **Fix:** En el `catch`, disparar `sendEscalationAlert('oliver_gpt_flag crash', ...)`. O responder "estamos en mantenimiento" en vez de silenciosamente degradar.
- **Confianza:** Alta. Catch verificado en L4643-4666. En V1 el path `pass1.handoff` (L5441-5446) solo llama `waSendH` con texto plano.

### [RUT-02] sendEscalationTemplate usa SELF_URL=http://127.0.0.1 como fallback: plantilla de escalación puede fallar silenciosamente
- **Archivo:** `C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/escalation.js:46-49`
- **Evidencia:** `const base = (process.env.SELF_URL || \`http://127.0.0.1:${process.env.PORT || 8080}\`).replace(/\/$/, '');` — `SELF_URL` ausente en `.env.example`.
- **Impacto:** La plantilla de escalación garantizada (que bypasea la ventana 24h de Meta) hace un self-call HTTP a `/admin/send-template`. Si `SELF_URL` no está seteado en Railway, el fallback `127.0.0.1` puede no resolver al mismo proceso. La llamada falla silenciosamente (error se traga en `safe()`), Marcelo NO recibe la plantilla.
- **Fix:** Setear `SELF_URL=https://whatsapp-ia-hubspot-production.up.railway.app` en las env vars de Railway. Agregar alerta de arranque si `SELF_URL` no está configurado. Considerar invocar directamente la función en vez del round-trip HTTP.
- **Confianza:** Alta. `SELF_URL` ausente de `.env.example` confirmado. El self-call HTTP en L49 verificado. El error se traga en `safe()` sin alerta secundaria.

### [CLI-06] Re-saludo/cold-start cuando cliente responde a plantilla proactiva con sesión V2 vacía
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\webhook.js:438-453`
- **Evidencia:** `if (!cached || !Array.isArray(cached.history) || cached.history.length === 0) { const remote = await loadSession(from, deps); }` — cuando lead nuevo recibe template proactivo y responde, si la sesión V2 en Postgres está vacía (lead importado desde CRM, primer contacto via template), `history=[]` y `state={}` → Oliver re-saluda.
- **Impacto:** Cliente que ya fue calificado, recibió cotización y recibió template de seguimiento responde y Oliver lo trata como extraño: re-saluda, vuelve a pedir comuna y medidas.
- **Nota del verificador:** El bug es real pero más estrecho que lo descrito. Solo afecta leads con ZERO historial en Postgres (importados de CRM externo, primer contacto via template). Leads con historial existente se hidratan correctamente post-fix del 2026-06-14. Severidad correcta: MEDIA.
- **Fix:** Al enviar template proactivo, persistir en Postgres registro mínimo de contexto para ese waId (`last_template_sent`, `name`, `comuna`, etc.). Agregar instrucción explícita en `buildSessionContext` para no re-saludar si `last_template_sent` reciente.
- **Confianza:** Media (re-clasificado a MEDIA por el verificador).

---

## MEDIA

### [SES-01] RECENT_QUOTES.clear() ciego en webhook.js: expone ventana de doble-folio ISO en burst
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\webhook.js:666-667`
- **Evidencia:** `RECENT_QUOTES.set(from, { ... }); if (RECENT_QUOTES.size > 500) RECENT_QUOTES.clear();` — el `clear()` se ejecuta inmediatamente después del `set()`. Si el insert disparó el tope, la entrada recién añadida queda borrada.
- **Impacto:** En una jornada con 500+ cotizaciones, se borra el guard anti-duplicado para todos los números activos, abriendo ventana de ~2s donde cualquier doble-confirm o reintento quema un segundo folio ISO.
- **Fix:** Reemplazar con la misma lógica de `channel-agent.js:446-448`: evicción por antigüedad en lugar de `clear()` ciego.
- **Confianza:** Alta.

### [SES-02] channel-agent.js RECENT_QUOTES dedup sin firma de contenido: bloquea cotización corregida en IG/FB
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\channel-agent.js:411-416`
- **Evidencia:** `prevQ = RECENT_QUOTES.get(dedupKey); if (prevQ && (Date.now() - prevQ.at) < QUOTE_DEDUP_MS)` — no hay comparación de contenido. `webhook.js:630` exige `_prevQuote.sig === _quoteSig` para permitir dedup.
- **Impacto:** Cliente de IG/FB que corrige su pedido dentro de 2 minutos (cambia tipo, medidas o color) recibe el folio y PDF de la cotización original sin regenerar. Cobra mal en silencio.
- **Fix:** Agregar firma de contenido igual que `webhook.js`: `const sig = JSON.stringify({items:..., total:...}); if (prevQ && ... && prevQ.sig===sig)`. Guardar `sig` junto con `quote_number` y `at`.
- **Confianza:** Alta.

### [SES-03] Correlativo ISO FALLBACK quemado en Postgres sin trazabilidad: asimetría con channel-agent
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\webhook.js:657-663`
- **Evidencia:** `quoteNumber = \`CM-FR-004-${yr}-FALLBACK-${seq}\`` cuando sales-os no responde en 8s. `channel-agent.js:432-442` tiene el fix: NO emite PDF si el correlativo falla, escala a Marcelo y devuelve `{ ok: false, reason: 'correlativo_no_disponible' }`.
- **Impacto:** Cliente de WhatsApp recibe PDF con folio fantasma (`CM-FR-004-2026-FALLBACK-8472`) no registrado en BD. Viola ISO 9001 §7.5 (control de documentos). Asimetría de comportamiento entre WA e IG/FB.
- **Nota del verificador:** La colisión con folios reales descrita en el hallazgo es incorrecta (los strings son estructuralmente distintos: `FALLBACK-XXXX` vs secuencia numérica pura). El impacto real es de trazabilidad ISO, no colisión.
- **Fix:** Alinear `webhook.js` con `channel-agent.js`: si el correlativo no responde, NO emitir PDF, escalar a Marcelo.
- **Confianza:** Alta.

### [SES-04] SEEN.clear() ciego (real severity: MEDIA, no ALTA)
- **Ver [CON-03] arriba.** El verificador re-clasifica a MEDIA: `SEEN_MAX=5000` hace que el trigger sea prácticamente imposible en producción de Activa (una empresa de ventanas en Temuco). El race existe pero el umbral hace que el riesgo operativo inmediato sea bajo.

### [PDF-02] Correlativo fallback (FALLBACK-XXXX) quema un número que no está en la secuencia ISO
- **Archivo:** `C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:657-663`
- **Evidencia:** `quoteNumber = 'CM-FR-004-'+yr+'-FALLBACK-'+String(Date.now()).slice(-4)` — folio no registrado en BD, aparece en PDF, Zoho y evento de conversión.
- **Impacto:** PDF oficial ISO con folio inválido. Si la cotización avanza, Zoho y BD no pueden correlacionarla.
- **Fix:** Si el correlativo falla, NO generar PDF en ese turno. Devolver `{ ok:false, reason:'correlativo_unavailable' }` y alertar a Marcelo para envío manual.
- **Confianza:** Alta. Confirmado en código. `channel-agent.js` ya tiene el fix correcto (L413-442); solo falta portarlo a `webhook.js`.

### [PDF-03] RECENT_QUOTES (dedup) es in-memory global — se borra en cada redeploy de Railway
- **Archivo:** `C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:99-100, 666-667`
- **Evidencia:** `const RECENT_QUOTES = new Map()` — puro in-memory. `persistSession` no escribe `last_quote_sig` ni `last_quote_number`. `grep last_quote` = cero matches fuera de metadatos CRM.
- **Impacto:** Tras redeploy, si el cliente vuelve a pedir la misma cotización dentro de la ventana de 2 min, el guard está vacío y se quema un segundo folio ISO.
- **Fix:** Agregar `last_quote_sig` y `last_quote_number` a la sesión persistida en Postgres.
- **Confianza:** Alta.

### [PDF-04] La ventana de 24h de WhatsApp no se detecta ni se informa en webhook.js
- **Archivo:** `C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:697-711`
- **Evidencia:** `channel-agent.js:476` detecta `outsideWindow` desde el error code de Meta y lo incluye en la alerta a Marcelo. `webhook.js` no inspecciona el error 131047 ni tiene campo `outsideWindow`.
- **Impacto:** Cliente que vuelve >24h después no recibe PDF. Marcelo no es alertado con contexto 24h. La cotización se pierde.
- **Fix:** Inspeccionar el error de Meta en el catch de `sendWaDocument`: si código es 131047 o el mensaje contiene '24 hours', marcar `outsideWindow=true` y escalar a Marcelo con ese contexto.
- **Confianza:** Alta.

### [COB-05] calcular_por_area ignora cantidad: siempre cotiza qty=1
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\tools.js:531, 545`
- **Evidencia:** `items: [{ ..., qty: 1, ... }]` hardcodeado. El schema de `calcular_por_area` no expone el parámetro `cantidad`.
- **Impacto:** Si el cliente quiere 3 ventanas de igual área, el LLM recibe `unit_price` correcto pero `cantidad:1`. Depende de que el LLM multiplique manualmente. Si no, el `grand_total` en el PDF y Zoho es 1/3 del real.
- **Fix:** Agregar parámetro `cantidad` (integer, opcional, default 1) al schema de `calcular_por_area` y propagarlo al item `qty`.
- **Confianza:** Alta. Contrastar con `calcular_cotizacion` que sí define `cantidad` en schema L171.

### [CON-04] extractQuote (webhook.js) solo persiste la PRIMERA cotización del turno
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\webhook.js:306-317`
- **Evidencia:** `function extractQuote(toolCalls) { for (const tc of toolCalls) { if (calcular_cotizacion...) { return tc.result; } } }` — `for...return` sale en el primero.
- **Impacto:** En turno con 3 ventanas distintas, `pushQuoteEvent` recibe solo el monto del primer ítem. Cockpit de Marcelo ve cotización draft con monto parcial. Posible lead mal priorizado.
- **Fix:** Acumular todos los items y sumar totales, o disparar `pushQuoteEvent` desde el resultado de `generar_pdf_cotizacion` que ya tiene el `grand_total` completo.
- **Confianza:** Alta.

### [CTX-01] Historial de 40 entradas: tool_calls + tool_results no persistidos — divergencia historial real vs efectivo
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\agent.js:70-71,88-124,140`
- **Evidencia:** `newHistory = [...history, { role:'user', content:userText }, { role:'assistant', content:reply }]` — solo se persiste texto limpio. Tool calls y results van solo a `workingMessages` (in-memory del turno).
- **Impacto:** Decisión arquitectónica deliberada (documentada). Riesgo real: si Pass2 falla y `reply` queda vacío, los resultados del motor (precio, medidas) se pierden sin rastro. El LLM en el siguiente turno no puede ver qué llamadas hizo.
- **Fix:** Tradeoff aceptable. Asegurar que el system-prompt instruya a Oliver a confirmar datos cotizados en texto visible al cliente.
- **Confianza:** Alta.

### [CTX-02] T4 de Regla #6 escala 'plazo de entrega' — pregunta rutinaria que Oliver puede responder
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\system-prompt.js:314 vs 173-174 vs 234`
- **Evidencia:** Regla #6 T4 L314: escalar "cuándo instalan", "plazo de entrega". Pero ÁREA 12 L234 ya da la respuesta: "Plazo estándar: 10-15 días hábiles." Y L322: "Si la pregunta es técnica simple, responda usted primero."
- **Impacto:** Cliente que pregunta "¿cuánto demoran?" no está cerrando, está calificando. Escalarlo satura a Marcelo y hace esperar al cliente.
- **Fix:** En Regla #6 T4, reemplazar "plazo de entrega"/"cuándo instalan" por "ha agendado visita técnica o confirmado pago". Oliver responde plazos estándar directamente; solo escala si pregunta por fecha específica comprometida.
- **Confianza:** Alta (re-clasificado a MEDIA por verificador).

### [PRO-05] Regla #3 y Regla #13 definen distintos 'datos mínimos' para ejecutar calcular_cotizacion
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\system-prompt.js:296 vs 353`
- **Evidencia:** Regla #3 L296: "4 datos mínimos (tipo, medidas, **color**, comuna)". Regla #13 L353: "Cuando tenga tipo + medidas + **cantidad** + comuna". Color sin default en #3; cantidad sin default en #13; #13 L356 dice "El color NO es bloqueante: asumir BLANCO".
- **Impacto:** Oliver puede esperar el color antes de cotizar (bloqueante innecesario) o cotizar sin cantidad. Genera demoras o cotizaciones con datos incorrectos.
- **Fix:** Unificar en UNA sola definición: "Datos mínimos = tipo + medidas_texto + comuna. Cantidad default=1. Color default=BLANCO. No esperes color ni cantidad para cotizar." Eliminar la lista de Regla #3 y apuntar a Regla #13 como definición canónica.
- **Confianza:** Alta.

### [PRO-06] Límite de líneas contradictorio: Regla #1 dice 2-3 líneas, Regla #29 dice 3-4 líneas
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\system-prompt.js:284 vs 447`
- **Evidencia:** Regla #1 L284: "Máximo 2-3 líneas por mensaje." OPERATING_INSTRUCTIONS L578: "Máximo 2-3 líneas." Regla #29 L447: "Máximo 3-4 líneas. Tras el PDF, incluya micro-resumen en viñetas." Ninguna de las primeras dos reconoce la excepción post-PDF.
- **Impacto:** Ambigüedad real. Si el LLM aplica 2-3 post-PDF, los resúmenes quedan demasiado cortos. Si aplica 3-4 en toda la conversación, los mensajes de discovery se vuelven largos.
- **Fix:** "Mensajes de conversación/discovery: máximo 2-3 líneas. Mensaje de entrega del PDF (post-cotización): hasta 4 líneas con micro-resumen. Siempre UNA sola idea por mensaje."
- **Confianza:** Alta.

### [COB-06] Política de pago ausente del playbook — Oliver improvisa ante "¿cómo pago?"
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\system-prompt.js` (ausencia total)
- **Evidencia:** `grep` en `system-prompt.js` por pago/anticipo/cuota/transferencia/débito = cero hits relevantes. Solo aparece "financ." en tabla B2C L183 y "No descuente sin autorización" L607.
- **Impacto:** Sin guion de pago, el LLM puede inventar condiciones (cuotas inexistentes, porcentaje de anticipo) — anti-alucinación no cubre términos de pago. Puede frenar el cierre.
- **Fix:** Agregar en ÁREA 12 o como Regla #32 un bloque de condiciones de pago con método estándar, anticipo/saldo, opciones de financiamiento y qué decir si pide cuotas ("Lo coordino con Marcelo para evaluarlo"). Confirmar datos reales con Marcelo.
- **Confianza:** Alta.

### [CAN-02] Dedup de cotización en IG/FB NO compara contenido — posible folio fantasma al cambiar producto
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\channel-agent.js:407-449`
- **Evidencia:** `channel-agent.js:411-416` bloquea cualquier segunda llamada dentro de `QUOTE_DEDUP_MS` sin comparar contenido. `webhook.js:622-666` tiene el fix `sig === _quoteSig` (backport del 2026-06-15). `channel-agent.js:444` guarda `{ quote_number, at }` sin `sig`.
- **Impacto:** En IG/FB: cliente que corrige tipo de ventana en <2 min recibe cotización antigua (precio incorrecto) sin que se genere nuevo folio.
- **Fix:** Copiar el patrón `sig` de `webhook.js:622-666` a `channel-agent.js`.
- **Confianza:** Alta.

### [CAN-03] IG/FB no tiene voz saliente (TTS/PTT) — WhatsApp sí
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\channel-agent.js:575-582`
- **Evidencia:** `webhook.js:816-834` tiene el bloque completo de síntesis de voz. `channel-agent.js` no tiene ninguna referencia a `synthesizeVoiceBuffer`, `shouldSendVoice`, `uploadWaAudio`.
- **Impacto:** Bajo — Meta no soporta PTT nativo en IG DM ni Messenger. Deuda técnica a documentar.
- **Fix:** Documentar en DEUDA TÉCNICA de `channel-agent.js`. Pendiente hasta que Meta soporte PTT en IG/FB.
- **Confianza:** Alta.

### [VIS-02] detail:'high' forzado en visión — costo y latencia innecesarios en fotos de clientes
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\webhook.js:199`
- **Evidencia:** `{ type: 'image_url', image_url: { url: ..., detail: 'high' } }` con `max_tokens:4096`. `detail:'high'` aplica a TODA imagen sin distinción.
- **Impacto:** Cada foto de cliente quema 1.5-11× más tokens. Para fotos de fachada/ventana no se necesita alta resolución.
- **Fix:** Cambiar a `detail:'auto'`. Si se necesita OCR en planos, detectar primero con prompt liviano si la imagen tiene texto y aplicar `'high'` condicionalmente. Reducir `max_tokens` a 1024 para fotos descriptivas.
- **Confianza:** Alta.

### [RUT-03] checkStaleHighValue corre en V1 (setInterval) pero leads de V2/GPT nunca aparecen en ese Map
- **Archivo:** `C:/Users/mcifu/activa/temp-wa/index.js:1440-1447`
- **Evidencia:** `setInterval(() => { checkStaleHighValue(sessions, waSend); }, ...)` usa solo el Map `sessions` de V1. V2/GPT usa `CONV` en `webhook.js:84` — module-private, nunca exportado. `grep checkStaleHighValue` en `src/` = cero matches.
- **Impacto:** Lead de alto valor inactivo 30 min en V2 NO dispara alerta de stale. Marcelo no recibe aviso de leads calientes que se enfriaron.
- **Fix:** Exponer el Map `CONV` de `webhook.js` como getter y pasarlo al `checkStaleHighValue`, o implementar el cron stale dentro de `webhook.js`.
- **Confianza:** Alta.

### [RUT-04] Escalación en V2 (webhook.js) no llama persistHandoff: bot puede reanudarse tras escalación
- **Archivo:** `C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:484-515`
- **Evidencia:** El bloque de escalación construye `escStore = { history: escHist, state: { ...state, lastMessageAt: Date.now() } }` sin `handoffActive: true`. `grep handoffActive` en `src/oliver-gpt/` = cero resultados.
- **Impacto:** Al próximo mensaje del cliente post-escalación, si `getConversationControl` falla (sales-os caído), `aiPaused=false` y el bot V2 reanuda la conversación como si nada.
- **Fix:** Antes de `conv.set()` en el bloque de escalación: `escStore.state.handoffActive = true` y asegurar que `persistSessionFn` persiste ese campo en el jsonb de `whatsapp_sessions`.
- **Confianza:** Alta.

---

## BAJA

### [CON-05] Dedup SEEN cubre solo mensajes con msgId: mensajes sin msgId procesan siempre sin idempotencia
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\webhook.js:376-383`
- **Evidencia:** `if (msgId) { if (seen.has(msgId)) return; ... seen.add(msgId); }` — si `msgId` es falsy, el bloque se salta completo.
- **Impacto:** Bajo. Meta incluye `wamid` en casi todos los tipos de mensajes. Status/delivery webhooks ya se filtran antes. El riesgo es teórico.
- **Fix:** Construir id sintético `${from}:${Date.now()}:${type}` con ventana corta para cubrir reintentos sin msgId. O loguear warning cuando msgId está ausente.
- **Confianza:** Alta (pero riesgo operativo inmediato bajo).

### [CON-06] conUnitPrice exportada pero nunca invocada en el camino caliente
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\tools.js:445-456`
- **Evidencia:** `conUnitPrice` solo aparece en `tools.test.js`. El hot path usa `priceAllEngine` que ya aplica la misma lógica internamente.
- **Impacto:** No hay bug hoy. Código muerto que crea confusión y podría llevar a futuros desarrolladores a reusar la función en un path que sí añada doble IVA.
- **Fix:** Documentar explícitamente que es el adaptador para llamadas DIRECTAS a `calcularCotizacion` (bypass de `priceAllEngine`). O remover y consolidar en `priceAllEngine`.
- **Confianza:** Alta.

### [PRE-01] validateDimensions de normalizers.js diverge de validateDimensionsLocal: CORREDERA escalate vs referencial+clamp
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\normalizers.js:171-176`
- **Evidencia:** `normalizers.js:171-176` retorna `{ escalate: true }` para corredera grande. `enginePricer.js:192-214` retorna `{ referencial: true, clampAncho, clampAlto }` (fix correcto del 2026-06-10).
- **Impacto:** `validateDimensions` de `normalizers.js` no está en el camino caliente de V2. Riesgo solo si alguien la importa en el futuro — re-introduciría el bug del caso Dalia.
- **Fix:** Sincronizar con `validateDimensionsLocal` de `enginePricer.js` o eliminar y re-exportar desde `enginePricer.js`.
- **Confianza:** Alta (pero riesgo actual es cero).

### [COB-07] grand_total enviado al LLM puede ser IVA-incluido si el LLM pasa total_con_iva
- **Archivo:** `C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:734-735`
- **Evidencia:** `const grandTotal = Number(input.grand_total) || reduce(items)` — si el LLM pasa `input.grand_total`, se usa sin validar.
- **Impacto:** El PDF (computado directamente desde `unit_price * qty`) siempre es correcto. El impacto es solo en Zoho y CXM (monto inflado ~19%). Requiere que el LLM alucine el campo.
- **Fix:** Ignorar `input.grand_total` y recalcular siempre desde items: `(input.items||[]).reduce((s,it)=>s+(Number(it.unit_price)||0)*(Number(it.qty)||1),0)`.
- **Confianza:** Alta (riesgo requiere alucinación del LLM, no es determinístico).

### [PRO-07] El prompt usa 'cotización' internamente pese a que Regla #16 prohíbe el término
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\system-prompt.js:379-380 vs 106, 141, 145`
- **Evidencia:** Regla #16 L379 y OPERATING_INSTRUCTIONS L608 prohíben "cotización". Pero L106: "Le dejo la cotización guardada"; L141: "Una vez confirmada la cotización"; L145: "Le dejo la cotización guardada" (scripts de objeciones).
- **Impacto:** Inconsistencia de marca menor. Los 4 scripts de objeciones con "cotización" llegan al cliente ocasionalmente.
- **Fix:** Reemplazar "cotización" por "propuesta" en los scripts de Área 3 (L106, L110), Área 5 (L141, L145) donde el texto llega directamente al cliente. Los nombres de tool (`calcular_cotizacion`) pueden quedarse.
- **Confianza:** Alta.

### [VIS-03] transcribeAudio usa filename fijo 'audio.ogg' independiente del mime real
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\webhook.js:216`
- **Evidencia:** `await toFileFn(buffer, 'audio.ogg', { type: mime || 'audio/ogg' })` — filename siempre `audio.ogg`.
- **Impacto:** El SDK usa el campo `type` (mime real) para Whisper, no el filename. No hay casos confirmados de fallo. Inconsistencia menor.
- **Fix:** Derivar la extensión del filename del mime real: `audio/mp4 → mp4`, `audio/aac → aac`, `audio/amr → amr`, default `ogg`.
- **Confianza:** Alta.

### [CLI-07] extractComuna solo cubre Araucanía (31 comunas): clientes de otras regiones pierden la detección
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\src\oliver-gpt\normalizers.js:29-138`
- **Evidencia:** `ZONA_COMUNAS` solo contiene 31 comunas de La Araucanía. `extractComuna` devuelve `null` para Santiago, Concepción, Valdivia, etc.
- **Impacto:** Bajo — el negocio real de Activa es Temuco/Araucanía. El LLM puede leer la comuna del contexto sin pre-procesador. La re-pregunta no es garantizada, solo posible en casos edge.
- **Fix:** Ampliar `ZONA_COMUNAS` con comunas frecuentes fuera de Araucanía (Valdivia, Osorno, Santiago, Concepción).
- **Confianza:** Alta (pero severidad baja por foco geográfico real del negocio).

### [RUT-05] Cooldown de alertas de alto valor (2h) puede bloquear escalación real si se repite el mismo motivo
- **Archivo:** `C:/Users/mcifu/activa/temp-wa/services/highValueNotifier.js:33-34, 165-171`
- **Evidencia:** `const cooldownKey = \`${customerPhone}:${reason}\`` — razones distintas no se bloquean entre sí, pero el mismo motivo exacto en <2h sí.
- **Impacto:** Bajo. Las escalaciones de emergencia reales (handoff) van por `notifyHandoff` que no tiene cooldown. El comportamiento antiSpam es intencional.
- **Fix:** Aceptable tal como está. Documentar que escalaciones de emergencia usan `notifyHandoff` sin cooldown.
- **Confianza:** Alta.

### [RUT-06] orchestratorPass1 (V1 cold-standby) escalación humana no avisa a Marcelo
- **Archivo:** `C:/Users/mcifu/activa/temp-wa/index.js:1957-1961, 5440-5445`
- **Evidencia:** El bloque `if (pass1.handoff)` llama solo `waSendH` + `saveSession`. No hay `sendEscalationAlert`, `notifyHighValue`, ni `persistHandoff`.
- **Impacto:** Bajo en producción actual — con `OLIVER_GPT_ENABLED=true` + `OLIVER_GPT_ALL=true`, V1 solo se activa si `webhook.js` falla catastróficamente. Latente, no activo.
- **Fix:** En el bloque `if (pass1.handoff)` (~L5440): agregar `await sendEscalationAlert(...)` y `await persistHandoff(...)`.
- **Confianza:** Alta (severidad re-clasificada de ALTA a BAJA por verificador: V1 no atiende clientes vivos en producción actual).

### [CON-07] Fix de visión 2026-06-18 (fotos de ventanas sin tabla) CONFIRMADO y correcto
- **Archivo:** `C:\Users\mcifu\activa\temp-wa\services\oliverVision.js:56-64`
- **Evidencia:** Regla #4 en `isVisionUnreadable` presente y correctamente integrada. `webhook.js:61` importa y `webhook.js:208` llama la función.
- **Impacto:** No es un bug — confirmación de que el fix del caso Villa Ferroviaria (4 fotos rechazadas) está correctamente integrado. No requiere acción.
- **Confianza:** Alta. Severidad: no aplica.

---

## Lista Priorizada: Qué Arreglar Primero

### Prioridad 1 — Arreglar HOY (CRITICA + ALTA de seguridad/dinero)

1. **[CON-01] ADMIN_PIN=<pin-viejo>** — Verificar Railway + agregar alerta de arranque. Máximo 10 minutos.
2. **[COB-01] normMeasuresLocal <=300 → <400** — 1 línea de cambio en `enginePricer.js:169-170`. Cotiza 3-4× más barato en fallback. Máximo 5 minutos.
3. **[CLI-05] Pass2 max_tokens=350** — Subir a 600-700 + check `finish_reason`. Trunca respuestas complejas al cliente. 10 minutos.
4. **[COB-04] Pass1 max_tokens=500** — Subir a 900-1000 + log en catch de JSON.parse. 5 minutos.
5. **[RUT-02] SELF_URL ausente en Railway** — Setear env var `SELF_URL=https://whatsapp-ia-hubspot-production.up.railway.app`. 2 minutos.

### Prioridad 2 — Esta semana (ALTA de pierde-cliente en WhatsApp, canal principal)

6. **[PDF-01] pending_quote ausente en WhatsApp** — Portar bloque de `channel-agent.js:517-548` a `webhook.js`.
7. **[CLI-02] Sin alerta a Marcelo si PDF falla** — Agregar `if (!docSent) notifyHighValue(...)` en `webhook.js`.
8. **[CLI-03] LLM alucina éxito en pdf_sent:false** — Agregar `message` al return + regla en system-prompt.
9. **[CON-02] Takeover fail-OPEN en WhatsApp** — Portar `CONTROL_CACHE` de `channel-agent.js` a `webhook.js`.
10. **[CLI-04] MAX_TOOL_ITERATIONS=3 insuficiente** — Subir a 6 en `agent.js:34`.
11. **[COB-02] total_con_iva en fallback de lineTotal** — Eliminar del fallback chain en `enginePricer.js:338` y `tools.js:448`.

### Prioridad 3 — Esta semana (ALTA de prompt/coherencia)

12. **[PRO-01] Sin guion de financiamiento** — Agregar política con Marcelo antes de escribir.
13. **[PRO-03] Área 14 enseña precio en texto** — Reemplazar `$321.593` por placeholder que apunte al PDF.
14. **[PRO-02] glass_id contradictorio** — Editar ÁREA 6 L152 y OPERATING_INSTRUCTIONS L584/L589.
15. **[PRO-04] Timing de escalación B2B** — Unificar Regla #6 T2 + Regla #7 + Regla #28.

### Prioridad 4 — Próxima semana (ALTA de IG/FB, canal secundario)

16. **[COB-03] IG/FB sin atribución CTWA/ads** — Pasar `rawMsg` en cadena y agregar `parseReferral`.
17. **[CLI-01] IG/FB sin visión/STT** — Propagar `imageId`/`audioId` desde `normalizeIncoming`.
18. **[CAN-01] IG/FB sin rate-limit** — Mover `rateOk()` a módulo compartido.
19. **[VIS-01] Vision/STT sin timeout** — Agregar `AbortSignal.timeout()` en `downloadWaMedia`, `describeImage`, `transcribeAudio`.

### Prioridad 5 — Backlog (MEDIA)

20. **[SES-01/02] RECENT_QUOTES dedup** — clear() ciego en WA + sin firma de contenido en IG/FB.
21. **[SES-03/PDF-02] Correlativo FALLBACK** — Portar fix de `channel-agent.js` a `webhook.js`.
22. **[PDF-03] RECENT_QUOTES in-memory** — Persistir `last_quote_sig` en Postgres.
23. **[PDF-04] Ventana 24h no detectada** — Parsear error 131047 y escalar.
24. **[COB-05] calcular_por_area ignora qty** — Agregar parámetro `cantidad` al schema.
25. **[CON-04] extractQuote toma solo primer item** — Acumular items o disparar desde `generar_pdf_cotizacion`.
26. **[PRO-05/06] Datos mínimos contradictorios + límite de líneas** — Unificar Regla #3 con Regla #13; unificar límite de líneas.
27. **[COB-06] Sin política de pago** — Agregar guion con Marcelo.
28. **[RUT-03] checkStaleHighValue ciego a V2** — Exponer `CONV` o mover cron a `webhook.js`.
29. **[RUT-04] persistHandoff ausente en V2** — Setear `handoffActive=true` en `escStore.state`.
30. **[CAN-02] Dedup sin firma en IG/FB** — Copiar patrón `sig` de `webhook.js`.
31. **[VIS-02] detail:'high' forzado** — Cambiar a `detail:'auto'`.

### Prioridad 6 — Nice to have (BAJA)

32. **[CON-05/06] SEEN dedup sin msgId + conUnitPrice muerta** — Defensivo.
33. **[PRE-01] validateDimensions desincronizada** — Sync o eliminar.
34. **[COB-07] grand_total no validado** — Recalcular siempre desde items.
35. **[PRO-07] 'cotización' en scripts de objeciones** — Reemplazar por 'propuesta' en L106/L141/L145.
36. **[VIS-03] Filename 'audio.ogg' fijo** — Derivar extensión del mime real.
37. **[CLI-07] extractComuna solo Araucanía** — Ampliar con comunas secundarias.
38. **[RUT-05/06] Cooldown alertas + V1 handoff sin alerta** — Documentar / fix defensivo.
