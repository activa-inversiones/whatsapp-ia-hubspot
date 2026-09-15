# VEREDICTO TRIDENTE — Oliver 2026-09-15

**Rótulo honesto: TRIDENTE INCOMPLETO (2 de 3).** Copilot no adjudicó — cuota mensual agotada.
Revisores válidos: **Codex** (gpt-5.6, `--sandbox read-only`) + **Gemini** (gemini-2.5-pro, vía
`~/.activa-bin/gemini-review.sh`, guardias 1 y 2 verificadas).
⚠️ Una corrida previa de Gemini se hizo DIRECTA con `--approval-mode plan`, prohibido por la
lección #25. No escribió nada (`git status` limpio, medido), pero su informe **no cuenta** y quedó
archivado como `_INVALIDO-gemini-directo-lec25.md`.

## Tabla de veredictos

| Punto | Gemini | Codex | Resultado |
|---|---|---|---|
| P1 salida segura (módulo) | APTO | APTO CON CAMBIOS | **APTO CON CAMBIOS** |
| P2 embudo único | APTO | APTO CON CAMBIOS | **APTO CON CAMBIOS** |
| P3 validador de nombre v2 | APTO CON CAMBIOS | **NO APTO** | **NO APTO — rehacer** |
| P4 folio idempotente | APTO CON CAMBIOS | **NO APTO** | **NO APTO — rehacer** |
| P5 teléfono del dueño fuera | APTO | APTO CON CAMBIOS | **APTO CON CAMBIOS** |
| P6 drafts sin monto | APTO | APTO CON CAMBIOS | **APTO CON CAMBIOS (causa distinta)** |

Donde discrepan, **gana Codex**: abrió `src/oliver-gpt/*` y `src/sales-agent/*`, que Gemini no tocó.

## El error de fondo del BRIEF (y de la auditoría previa)

**VERIFICADO — el brief auditó UN cerebro de TRES.**
- V1 → `index.js` (`waSendH` / `waSendMultiH` / `waSend`)
- Oliver GPT → `src/oliver-gpt/webhook.js:4559` → `src/sales-agent/whatsapp-adapter.js:132,145`
  (`sendWhatsAppText` manda `String(body)` directo a Meta)
- Oliver v2 piloto → `src/sales-agent/agent.js:154,211` (solo filtro de chilenización)

Se enrutan por feature flags desde `index.js:5479,5507`.
⇒ **Sanitizar dentro de `waSend` NO cierra la fuga.** Mi afirmación anterior de que `waSend` era
"el embudo real de todo mensaje de texto" era **FALSA**. El arreglo correcto es un gateway superior
`enviarTextoCliente` que usen los tres cerebros.

Otros datos corregidos:
- El repo NO está en `index.js v11.7` sino en **v11.8.1** (`index.js:1`). La ficha de la skill está desfasada.
- `isLikelyName` no acepta "solo letras/espacios": también guiones y apóstrofos — **eso explica exactamente `Padre-las-casas`** (`oliverName.js:168`).
- `index.js:569` NO alimenta el PDF directamente; PDF y quote-event comparten la fuente `d.name` (`quotePdf.js:119,122`).

## P3 — NO APTO. Por qué, y qué va en su lugar

Codex, con evidencia: **la política actual permite emitir sin nombre a propósito.**
`quoteDataComplete` deliberadamente no bloquea por nombre y usa perfil, `Cliente de <comuna>` o
`Cliente`, dejando la reemisión posterior (`src/oliver-gpt/pdf-intent.js:160,183,188`).
Y el PDF **ya distingue** persona, empresa, razón social y RUT (`services/quotePdf.js:24,32,42`).
⇒ Mi P3 cambiaba una **decisión comercial del dueño**, no un validador técnico. Eso no lo decide el asistente.
Además un léxico positivo de nombres chilenos daría falsos negativos con nombres mapuche, migrantes
y abreviaciones, sin corpus para calibrarlo.

**Sustituto (ambos revisores coinciden en el fondo):**
1. Separar `contact_name` · `document_recipient` · `name_source`, con estado `validated/assumed/pending`.
   Mantener `needsName` igual deja los nombres basura históricos como válidos.
2. Captura automática SOLO en presentaciones explícitas. Ante `nameAsked=true`, rechazar preguntas
   e intenciones y **confirmar** los ambiguos, en vez de asumir.
3. Tests con los 6 casos reales + empresas + un test de **wiring completo** `nameAsked → captura → PDF`.
   La suite actual (17/17 verde) prueba funciones aisladas y por eso no cazó nada.

**BUG NUEVO, no estaba en el plan (VERIFICADO por Codex y reproducido):**
`extractName("me llamo José Luis Martínez")` funciona, pero el wiring lo **rechaza antes**, porque
`isLikelyName` cuenta también "me llamo" y supera 4 palabras (`index.js:6220`).
⇒ Oliver no solo guarda basura: **también descarta nombres reales.**

## P4 — NO APTO. Por qué, y qué va en su lugar

1. **`(conversation_id, amount_total)` no identifica un documento.** Dos propuestas con el mismo
   total pueden diferir en producto, medidas, color, cantidad, receptor o condiciones. El sistema
   vigente trata las alternativas como documentos distintos y les reserva letras a propósito
   (`src/oliver-gpt/propuestas-color.js:72,83,118`).
2. **Ya existe la máquina que yo proponía inventar.** Oliver GPT calcula una firma con producto,
   medidas, color, cantidad, precio y total, evita duplicados idénticos y persiste fuera de memoria
   (`webhook.js:2710,2716,2831,2848`), con política corrección-vs-alternativa y sufijos `-B/-C`
   (`webhook.js:254,262,273`). P4 metía una **segunda semántica incompatible**.
3. **Los 3 folios de $2.520.791 NO están probados como duplicados.** Igual monto ≠ igual documento.
   Mi informe de la mañana afirmó que sí. **Esa afirmación queda retirada** hasta ver los 3 payloads.

**Sustituto:** idempotencia por `tenant_id + idempotency_key` de la operación de emisión; guardar
`content_hash`, `base_quote`, `revision/variant`, `status` y hash del PDF; contador y registro de
emisión en **una misma transacción**; si el PDF o Meta fallan tras reservar, el folio queda
`voided/failed` con causa — no desaparece.

**ISO 9001 §7.5 — dato corregido:** la cláusula exige identificación, control de cambios,
almacenamiento, acceso, retención y disposición. **No exige secuencia "sin huecos"**
(guía oficial ISO/TC 176). Y hoy los huecos ya pueden ocurrir: se reserva folio antes de generar
y entregar (`webhook.js:2898,2929,4168`). Si el SGI interno de ACTIVA sí exige correlativo continuo,
ese procedimiento no estaba entre los archivos → **lo tiene que decir el dueño.**

**Hallazgo que rompe la política ANTES que P4:** V1 cae a un folio **aleatorio `COT-*`** cuando el
servicio ISO no responde (`index.js:6503,6521`).

## P6 — la causa real no era "basura"

**VERIFICADO por Codex y reproducido por mí en el código:**
- La tool devuelve `total_neto` (`src/oliver-gpt/tools.js:851`)
- El draft lee `quote.total || quote.grand_total` (`src/oliver-gpt/webhook.js:4656`)
⇒ **`amount_total` sale NULL siempre.** Ese es el origen de los 90 drafts nulos (55% de la tabla).
- El test no lo caza porque **inventa** un fixture `{total:321593}` distinto del retorno real de la
  tool (`webhook.test.js:238,247`).
- `extractQuote` toma **solo la primera** cotización del turno (`webhook.js:684,692`): mapear
  `total_neto` a secas todavía dejaría monto parcial en pedidos de varios ítems.

Un TTL habría escondido el bug. **Se arregla el contrato**, se crea un DTO canónico agregado, se
persiste solo con `items` y `amount_total > 0`, y se agrega un **contract test** alimentado con la
forma real de `runTool`, no con fixture inventado.

## P1 / P2 / P5 — aptos, con estos cambios

**P1:** contrato explícito `{texto, bloquear, motivos, truncado}` (no a veces string, a veces objeto) ·
**reutilizar `partirEnBurbujas`**, que ya tiene tope de 3.500 y suite que prueba que no se pierde
contenido (`services/burbujas.js:39,53,110`) · el reintento debe repetir **solo la generación final**
con los tool results ya obtenidos — reejecutar el turno entero vuelve a cotizar, pedir folio y mandar
PDF (`src/oliver-gpt/agent.js:73,101,151`) · máximo **un** reintento, luego fallback determinista + alerta.

**P2:** gateway `enviarTextoCliente` sobre los tres cerebros · separar `cliente` de `interno`
(sanitizar global borraría diagnósticos de las alertas a Marcelo, `index.js:1680,1688`) ·
**captions** de PDF/imagen/video son texto visible y hoy van directo a Meta
(`index.js:4392,4411,4441,4501`) · **TTS puede verbalizar el JSON**: el filtro V1 solo saca `<` y `>`,
el contenido queda (`index.js:1967,2000`) · templates **fuera** del limpiador (contrato aprobado por
Meta; `_sendMetaTemplate` nunca pasa por `waSend`, `index.js:1061,1069,1076`) · el gateway debe
alimentar con el **mismo texto limpio** a Meta y a `pushConversationEvent` — hoy Oliver GPT persiste
`reply` crudo por separado (`webhook.js:4559,4620,4631`), así que el cockpit guarda la versión sucia.

**P5:** `is_test/test_run_id` en la conversación, propagado a quote, conversión, Zoho, follow-up y
métricas · contador o tenant **separado** (el prefijo visual no evita consumir el correlativo
productivo) · **excepción obligatoria:** si el dueño activó atribución `CLIENTE`, la propuesta es de
un tercero real y conserva folio productivo (`webhook.js:1103,1108,1110`) · el flag se deriva
server-side, nunca se acepta del request.

## Hallazgo de seguridad (fuera del alcance de esta auditoría)

**Gemini, VERIFICADO:** `index.js:2502` `verifySig()` tiene `if (!META.SECRET) return true;`.
Sin `APP_SECRET` configurada, **la firma del webhook no se valida y se acepta cualquier POST**.
Es fail-open donde corresponde fail-closed. Falta medir si `APP_SECRET` está seteada en Railway
para saber si está expuesto ahora o solo latente. **No se toca sin decisión del dueño.**

## Qué queda en pie para construir

Aptos para implementar con sus cambios: **P1, P2, P5, P6**.
A rehacer antes de escribir una línea: **P3, P4** — y ambos tocan decisiones comerciales
(¿se emite sin nombre? ¿el correlativo admite huecos?) que **no las decide el asistente**.
