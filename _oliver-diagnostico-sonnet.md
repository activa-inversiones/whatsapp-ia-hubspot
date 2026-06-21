# Reporte ejecutivo — Bot Oliver (6 diagnosticos)

**Para:** Marcelo Cifuentes · **De:** Liderazgo tecnico · **Fecha:** 2026-06-20
**Veredicto en una linea:** El bot perdio capacidades despues de migrar el cerebro a Claude Sonnet (commit `68b6dce`). Tres de los seis problemas son **regresiones directas de esa migracion** y golpean el corazon de la venta (cotizar + mandar PDF + entender audios). Se arreglan con cambios quirurgicos, todos reversibles con `AI_PROVIDER`.

---

## 1) Tabla priorizada — por severidad e impacto en VENTAS

Orden = cuanto dinero hace perder HOY. Las 6 son severidad ALTA; lo que las separa es el impacto directo en cierre.

| # | Problema (sintoma que ve el dueno) | Causa raiz (archivo:linea) | Fix | Antes -> Despues |
|---|---|---|---|---|
| 1 | **Loops / cliente colgado >2h / "pidieron cotizar y nunca cotizo"** | Sonnet corre con `effort:'low'` por defecto y re-emite el mismo tool sin converger (`engine-anthropic.js:28`, inyectado en `:131,144`). La rama Anthropic NO pasa por `withRetry` (`engine.js:103,132` vs OpenAI que si). `max_tokens:1000` trunca el JSON del tool y `agent.js:104-109` cae a `input={}` | A) `EFFORT` default `'medium'` en pass1 (`engine-anthropic.js:28`). B) Envolver Anthropic en `withRetry` + reconocer `529` (`engine.js:103,132`; `withRetry` :82). C) `max_tokens` pass1 a 1500-2000 (`engine-anthropic.js:142`) y descartar tool_use con JSON truncado | Bot se repite o no responde por horas; cotiza vacio -> **Sonnet ejecuta la tool una vez por ventana, corta limpio, reintenta ante overload, cotiza con datos reales** |
| 2 | **Manda el PRECIO en texto en vez del PDF** ("precio neto $761.322" suelto -> cliente dice "no gracias") | NO hay red determinista que mande el PDF en el turno de la cotizacion ni que borre el precio del texto. La unica red (`webhook.js:875-902`, `channel-agent.js:521-546`) actua el turno SIGUIENTE. Sonnet con `effort low` no encadena `calcular_cotizacion -> generar_pdf` y pass2 narra el `unit_price` que vio (`engine-anthropic.js:152-167`). Defensa solo por prompt (`system-prompt.js:362-368`) | A) **Entrega determinista mismo turno**: si hubo items y el LLM no llamo `generar_pdf`, llamarla en codigo (`webhook.js` ~929, antes de `:935`; `channel-agent.js` ~565). B) **Guard anti-precio**: sanitizar `reply` antes de enviar (`webhook.js:943`) y reemplazar montos por el mensaje de entrega del PDF. C) subir effort (cruza con #1) | El precio se filtra en texto, no sale PDF, se cae la venta -> **PDF SIEMPRE sale por codigo, el monto nunca se publica suelto** |
| 3 | **No escucha las notas de voz** ("pidale que escriba por texto") | El STT quedo cableado duro a OpenAI (`getClient()` en `engine.js:40-49`) y la migracion no lo conmuto. Al dejar de financiar `OPENAI_API_KEY` (creyendo que "ya es Claude"), `transcribeAudio` (`webhook.js:216-226`) lanza, el catch lo traga en silencio (`webhook.js:271-273`) y cae al texto fijo | A) Cliente OpenAI dedicado `getSttClient()` independiente de `AI_PROVIDER`. B) **Mantener `OPENAI_API_KEY` con saldo en Railway** (STT/Vision siguen en OpenAI; Anthropic no tiene Whisper). C) Avisar a Marcelo con `notifyHighValue` en vez de tragar el error. D) Fix env var: leer `AI_MODEL_STT` (`webhook.js:73`) | Lead de voz se pierde sin rastro -> **Audio se transcribe con Whisper, Claude responde al contenido real; si STT cae, se escala a Marcelo** |
| 4 | **Vision: "Oliver dio unas medidas y pidio el resto"** | Prompt de vision DEBIL en produccion (`webhook.js:196-201`) extrae solo algunas filas; el path V1 ya probado tiene prompt estricto fila-por-fila (`index.js:2186-2203`). Ademas `system-prompt.js` no obliga a usar lo que ya vino en la imagen | A) Reemplazar prompt de `describeImage` por el estricto fila-por-fila de `index.js` (todas las filas, V1/V2/V3, "NO ESPECIFICADO" sin borrar filas). B) Regla en `system-prompt.js`: "si la vision ya entrego medidas, USALAS, no re-pidas". C) Blindar adaptador `engine-anthropic.js:71-72` para vision nativa futura | Transcribe parcial, re-pide, friccion, lead perdido -> **Transcribe el plano completo y cotiza con todo lo que vino, sin re-pedir** |
| 5 | **Marcelo no ve las fotos/audios/PDF del cliente en la consola** (404 "not found") | El path GPT activo NO persiste media ENTRANTE: `resolveUserText` baja el buffer y lo descarta sin `saveMedia` (`webhook.js:234-284`, imagen :242, audio :268). El PDF entrante ni se procesa (no hay rama 'document'). El legacy `index.js` si guarda (`:4767,4831,4848`). Server OK | Espejar lo de `index.js`: `import { saveMedia }`, disparar `saveMedia` fire-and-forget tras bajar el buffer (imagen, audio) + agregar rama 'document'. Todo en `safe()/.catch()` (nunca tumba el turno) | Consola sin fotos del cliente (404) -> **Cada media entrante queda en `media_attachments` y visible en el cockpit** |
| 6 | **Zoho: el Deal no tiene NINGUN adjunto** (ni el PDF ni lo que mando el cliente) | `archivarEnWorkDrive()` es un STUB inerte (`zohoCommercial.js:167-178`); no existe NINGUNA llamada a `/crm/v2/Deals/{id}/Attachments` en el repo. El buffer entrante se descarta (`webhook.js:234-284`) | A) `attachPdfToDeal(dealId, buffer, filename)` -> POST multipart a `/crm/v2/Deals/{id}/Attachments` (scope CRM YA disponible, sin re-OAuth) en `webhook.js` Paso 4 y `channel-agent.js`. B) Subir tambien adjuntos entrantes del cliente. C) WorkDrive opcional cuando re-autoricen | Deal solo con texto, cero trazabilidad -> **PDF y archivos del cliente colgados del Deal en Zoho** |

---

## 2) Cuales son REGRESIONES de la migracion a Sonnet ("esta peor que antes")

Estas tres **funcionaban con GPT-4o y se rompieron al migrar** (`commit 68b6dce`). Son lo que el dueno percibe como "esta peor que antes":

| # | Regresion | Por que GPT-4o lo hacia bien y Sonnet no | Donde |
|---|---|---|---|
| 1 | **Loops / hangs / no cotiza** | GPT-4o iba con `parallel_tool_calls:false` + `withRetry`; el adaptador Anthropic corre `effort low`, sin `withRetry`, con `max_tokens` que trunca | `engine-anthropic.js:28,142`; `engine.js:103,132` |
| 2 | **PDF no sale / precio cantado** | GPT-4o encadenaba `calcular -> generar_pdf` por el loop de `agent.js`; Sonnet en low se queda "conversando" el precio | `engine-anthropic.js:136-149`; `webhook.js:935-939` |
| 3 | **No transcribe audios** | El STT siempre fue OpenAI; al migrar "el cerebro a Claude" se dejo de financiar `OPENAI_API_KEY` y reviento el STT en silencio | `engine.js:40-49`; `webhook.js:216-226,271-273` |

**NO son regresiones de Sonnet** (bugs preexistentes, independientes del modelo — conviene aclararlo para no echarle la culpa a la migracion):
- **#4 Vision** (prompt debil en produccion, problema viejo del path F4).
- **#5 Media en cockpit** (el path GPT nunca guardo inbound; ya estaba documentado en `ESTADO-ACTIVA.md:91`).
- **#6 Zoho adjuntos** (el stub de WorkDrive y la ausencia de Attachments existen desde antes).

Nota clave para el dueno: la migracion a Sonnet toco SOLO `engine.js` + `engine-anthropic.js`. No adapto `agent/webhook/channel-agent`, que es justo donde vivian las protecciones deterministas. Por eso "se rompio lo que el cerebro ya no sostiene solo".

---

## 3) Orden de fixes recomendado (frenar la perdida de ventas primero)

Secuencia pensada para **detener la hemorragia de ventas con el menor riesgo y esfuerzo**, respetando VERIFICAR -> SIMULAR -> PROD.

**FASE 0 — Mitigacion inmediata HOY (minutos, sin tocar codigo):**
1. **Setear `AI_EFFORT=medium` en Railway** — mata gran parte del loop (#1) y ayuda al encadenado del PDF (#2) sin deploy.
2. **Confirmar `OPENAI_API_KEY` con saldo en Railway** — revive audios (#3) y refuerza vision (#4) de inmediato. Si esta vacia, ese es el gatillo del #3.

**FASE 1 — Para la sangria de cierre (cambios de codigo, alto impacto en venta):**
3. **#1 Loops/hangs** — `withRetry` + `529` + `max_tokens` 1500-2000. Es la base: sin esto, el bot ni llega a cotizar. (`engine.js`, `engine-anthropic.js`)
4. **#2 PDF determinista + guard anti-precio** — el golpe directo al cierre: el cliente recibe la propuesta formal y nunca un monto suelto. (`webhook.js`, `channel-agent.js`)
5. **#3 STT desacoplado** (`getSttClient`) + escalar a Marcelo si cae — recupera el canal de voz y deja de perder leads en silencio.

**FASE 2 — Recupera leads que hoy llegan a medias:**
6. **#4 Vision** — prompt estricto fila-por-fila + regla "usa lo que ya vino". Sube conversion de planos.

**FASE 3 — Trazabilidad y CRM (no frenan venta, pero la documentan):**
7. **#5 Media inbound al cockpit** — Marcelo ve lo que manda el cliente.
8. **#6 Zoho Attachments** — PDF + archivos del cliente colgados del Deal.

**Logica del orden:** Fase 0 recupera ventas hoy mismo a costo casi cero (solo variables de entorno). Fase 1 ataca los tres puntos donde literalmente se cae el cierre (no responde / no manda PDF / no escucha). Fase 2 recupera el lead que llega incompleto. Fase 3 es trazabilidad: importante para CRM/auditoria, pero no detiene ventas, por eso va al final.

**Regla de oro antes de cada push:** simular con `AI_PROVIDER=anthropic` en `sim-scenarios.mjs` / `webhook.test.js` / `engine-anthropic.test.js` (caso "2 ventanas + PDF" y "audio entrante"), validar que NO loopea, que sale 1 PDF consolidado y NINGUN monto en texto, y que el multi-ventana no spamea PDF (Regla #18). Todo es reversible: `AI_PROVIDER!=anthropic` vuelve a GPT-4o intacto.

---

**Archivos criticos a tocar (referencia rapida):**
- `C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/engine-anthropic.js` (#1,#2,#4)
- `C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/engine.js` (#1,#3)
- `C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js` (#2,#3,#4,#5,#6)
- `C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/channel-agent.js` (#2,#6)
- `C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/system-prompt.js` (#2,#4)
- `C:/Users/mcifu/activa/temp-wa/services/zohoCommercial.js` (#6)
- `C:/Users/mcifu/activa/temp-wa/index.js` (referencia path legacy: #4,#5)