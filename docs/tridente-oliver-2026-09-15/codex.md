# Informe técnico — Tridente Oliver

## Veredicto ejecutivo

| Punto | Veredicto | Resultado |
|---|---|---|
| P1 | **APTO CON CAMBIOS** | **VERIFICADO:** hace falta un módulo único, pero no debe duplicar el límite ya implementado ni reejecutar tools al reintentar. |
| P2 | **APTO CON CAMBIOS** | **VERIFICADO:** el embudo debe cubrir tres cerebros, TTS y captions; moverlo sólo a `waSend` deja rutas abiertas. |
| P3 | **NO APTO** | **VERIFICADO:** un léxico positivo de nombres y el bloqueo obligatorio contradicen flujos reales, B2B y la política actual del PDF. |
| P4 | **NO APTO** | **VERIFICADO:** `(conversation_id, amount_total)` no identifica un documento. Colapsaría alternativas distintas con igual monto. |
| P5 | **APTO CON CAMBIOS** | **VERIFICADO:** hay que separar pruebas, pero respetando las cotizaciones reales que el dueño hace por terceros. |
| P6 | **APTO CON CAMBIOS** | **VERIFICADO:** los drafts nulos tienen una causa concreta de contrato de datos; borrarlos o ponerles TTL solamente escondería el problema. |

## Alcance y pruebas

- **VERIFICADO:** el brief dice `index.js v11.7`, pero el archivo real se identifica como `v11.8.1`. El brief quedó desfasado respecto del código que audita. [BRIEF.md:2](/C:/Users/mcifu/activa/temp-wa/docs/tridente-oliver-2026-09-15/BRIEF.md:2), [index.js:1](/C:/Users/mcifu/activa/temp-wa/index.js:1).

- **VERIFICADO:** `node --test services/oliverName.test.js` terminó con **17/17** tests aprobados y cero fallos.

- **VERIFICADO:** la suite dirigida de burbujas, folios, alternativas y reemisión terminó con **83/83** tests aprobados y cero fallos:
  `node --test services/burbujas.test.js src/oliver-gpt/numero-documento.test.js src/oliver-gpt/propuestas-color.test.js src/oliver-gpt/webhook.propuestas-abc.test.js src/oliver-gpt/webhook.nombre-tardio.test.js src/oliver-gpt/webhook.test.js`.

- **VERIFICADO:** un probe inline contra los seis nombres basura del brief devolvió `isLikelyName=true` y `extractName` no nulo para los seis.

- **NO PUEDO SABERLO:** no validé los conteos de Postgres, la configuración desplegada ni cuál feature flag estaba activo en la conversación filtrada. No se abrió `.env`, por instrucción expresa.

## Revisión de causas raíz

### C1 — sanitizador incompleto

- **VERIFICADO:** C1 está bien leída. Las reglas JSON sólo reconocen claves acotadas; no incluyen `name` ni `arguments`. Tampoco existen reglas para `<tool_call>`, `<tool_response>`, `**negrita**` ni un límite de largo. [index.js:956](/C:/Users/mcifu/activa/temp-wa/index.js:956), [index.js:960](/C:/Users/mcifu/activa/temp-wa/index.js:960), [index.js:963](/C:/Users/mcifu/activa/temp-wa/index.js:963), [index.js:972](/C:/Users/mcifu/activa/temp-wa/index.js:972).

- **PLAUSIBLE:** ese defecto basta para explicar la fuga si el mensaje pasó por `waSendH`.

- **NO PUEDO SABERLO:** no es posible adjudicar el incidente específico sólo a C1, porque existen cerebros y rutas que nunca llaman al sanitizador.

### C2 — embudo no universal

- **VERIFICADO:** `waSend` envía el body directamente y además traga el error sin devolver resultado. [index.js:1852](/C:/Users/mcifu/activa/temp-wa/index.js:1852), [index.js:1858](/C:/Users/mcifu/activa/temp-wa/index.js:1858), [index.js:1860](/C:/Users/mcifu/activa/temp-wa/index.js:1860).

- **VERIFICADO:** `waSendH` sí limpia y registra `safeText`, pero `waSendMultiH` envía y registra `m` crudo. [index.js:1866](/C:/Users/mcifu/activa/temp-wa/index.js:1866), [index.js:1868](/C:/Users/mcifu/activa/temp-wa/index.js:1868), [index.js:1934](/C:/Users/mcifu/activa/temp-wa/index.js:1934), [index.js:1946](/C:/Users/mcifu/activa/temp-wa/index.js:1946).

- **VERIFICADO:** además de las rutas listadas en el brief, existe un envío crudo al cliente para el rate limit. [index.js:5542](/C:/Users/mcifu/activa/temp-wa/index.js:5542).

- **VERIFICADO:** el cerebro Oliver GPT se enruta por feature flags desde `index.js`, pero su respuesta termina en `sendWhatsAppText`, que manda `String(body)` directamente a Meta. [index.js:5479](/C:/Users/mcifu/activa/temp-wa/index.js:5479), [index.js:5496](/C:/Users/mcifu/activa/temp-wa/index.js:5496), [webhook.js:4559](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:4559), [whatsapp-adapter.js:132](/C:/Users/mcifu/activa/temp-wa/src/sales-agent/whatsapp-adapter.js:132), [whatsapp-adapter.js:145](/C:/Users/mcifu/activa/temp-wa/src/sales-agent/whatsapp-adapter.js:145).

- **VERIFICADO:** el piloto Oliver v2 constituye otra ruta: sólo aplica su filtro de chilenización y después llama el mismo adaptador crudo. [index.js:5507](/C:/Users/mcifu/activa/temp-wa/index.js:5507), [agent.js:154](/C:/Users/mcifu/activa/temp-wa/src/sales-agent/agent.js:154), [agent.js:211](/C:/Users/mcifu/activa/temp-wa/src/sales-agent/agent.js:211).

- **VERIFICADO:** `waSend` no se usa para templates. `_sendMetaTemplate` construye un payload `type:"template"` y llama directamente a Meta. Limpiar dentro de `waSend` no rompe su estructura porque nunca pasa por ahí. [index.js:1061](/C:/Users/mcifu/activa/temp-wa/index.js:1061), [index.js:1069](/C:/Users/mcifu/activa/temp-wa/index.js:1069), [index.js:1076](/C:/Users/mcifu/activa/temp-wa/index.js:1076).

### C3 — nombres basura

- **VERIFICADO:** C3 se confirma. `isLikelyName` acepta entre una y cuatro palabras, permite guiones y apóstrofos, y sólo rechaza las palabras incluidas en `COMMAND_SET`. [oliverName.js:157](/C:/Users/mcifu/activa/temp-wa/services/oliverName.js:157), [oliverName.js:167](/C:/Users/mcifu/activa/temp-wa/services/oliverName.js:167), [oliverName.js:172](/C:/Users/mcifu/activa/temp-wa/services/oliverName.js:172), [oliverName.js:175](/C:/Users/mcifu/activa/temp-wa/services/oliverName.js:175).

- **VERIFICADO:** corrección menor al brief: no acepta solamente “letras/espacios”; también acepta guiones y apóstrofos. Eso explica directamente `Padre-las-casas`. [BRIEF.md:35](/C:/Users/mcifu/activa/temp-wa/docs/tridente-oliver-2026-09-15/BRIEF.md:35), [oliverName.js:168](/C:/Users/mcifu/activa/temp-wa/services/oliverName.js:168).

- **VERIFICADO:** una vez guardado `Correderas`, `needsName({name:"Correderas"})` devuelve `false`, porque sólo conoce siete nombres genéricos. [oliverName.js:29](/C:/Users/mcifu/activa/temp-wa/services/oliverName.js:29), [oliverName.js:47](/C:/Users/mcifu/activa/temp-wa/services/oliverName.js:47).

- **VERIFICADO:** la captura usa `ses.nameAsked || presentación`, luego exige `isLikelyName(userText)` y guarda el resultado como `ses.data.name`. [index.js:6218](/C:/Users/mcifu/activa/temp-wa/index.js:6218), [index.js:6220](/C:/Users/mcifu/activa/temp-wa/index.js:6220), [index.js:6222](/C:/Users/mcifu/activa/temp-wa/index.js:6222).

- **VERIFICADO:** `customer_name` toma ese mismo `d.name`. [index.js:569](/C:/Users/mcifu/activa/temp-wa/index.js:569).

- **VERIFICADO:** corrección de trazabilidad: la línea 569 no alimenta el PDF directamente. El quote-event y el PDF comparten la misma fuente `d.name`; el generador imprime `data.name` por su propio camino. [index.js:6573](/C:/Users/mcifu/activa/temp-wa/index.js:6573), [quotePdf.js:119](/C:/Users/mcifu/activa/temp-wa/services/quotePdf.js:119), [quotePdf.js:122](/C:/Users/mcifu/activa/temp-wa/services/quotePdf.js:122).

- **VERIFICADO:** hay además una inconsistencia no cubierta por las pruebas: `extractName("me llamo José Luis Martínez")` funciona, pero el wiring real lo rechaza antes porque `isLikelyName` cuenta también “me llamo” y supera cuatro palabras. [oliverName.test.js:43](/C:/Users/mcifu/activa/temp-wa/services/oliverName.test.js:43), [index.js:6220](/C:/Users/mcifu/activa/temp-wa/index.js:6220).

### C4 — correlativo

- **VERIFICADO:** C4 es correcta si se limita al endpoint. La referencia sólo recibe `tenantId`, incrementa siempre el contador y no conoce conversación, monto, teléfono ni idempotency key. [ref-quoteCorrelativo.js:46](/C:/Users/mcifu/activa/temp-wa/docs/tridente-oliver-2026-09-15/ref-quoteCorrelativo.js:46), [ref-quoteCorrelativo.js:49](/C:/Users/mcifu/activa/temp-wa/docs/tridente-oliver-2026-09-15/ref-quoteCorrelativo.js:49), [ref-quoteCorrelativo.js:73](/C:/Users/mcifu/activa/temp-wa/docs/tridente-oliver-2026-09-15/ref-quoteCorrelativo.js:73), [ref-quoteCorrelativo.js:75](/C:/Users/mcifu/activa/temp-wa/docs/tridente-oliver-2026-09-15/ref-quoteCorrelativo.js:75).

- **VERIFICADO:** C4 está incompleta como afirmación del sistema completo. Oliver GPT ya calcula una firma con producto, medidas, color, cantidad, precio y total; evita duplicados idénticos y respalda el estado fuera de memoria. [webhook.js:2710](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:2710), [webhook.js:2716](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:2716), [webhook.js:2831](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:2831), [webhook.js:2848](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:2848).

- **VERIFICADO:** también existe una política implementada de corrección versus alternativa y sufijos `-B/-C`. [webhook.js:254](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:254), [webhook.js:262](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:262), [webhook.js:273](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:273).

- **NO PUEDO SABERLO:** sin revisar los tres PDFs/payloads de `0454`, no se puede afirmar que sean duplicados sólo porque tengan el mismo monto. Igual monto no implica igual documento.

## P1 — salida segura

**VERIFICADO — APTO CON CAMBIOS.**

Cambio concreto:

1. **VERIFICADO:** hacer que la función devuelva siempre un contrato explícito, por ejemplo `{ texto, bloquear, motivos, truncado }`; no mezclar a veces string y a veces objeto.

2. **PLAUSIBLE:** no usar una regex genérica para “cualquier JSON con `name/arguments`”. Con JSON anidado puede quedar texto parcial, y también puede borrar contenido legítimo. Detectar primero tags/tool artifacts completos y clasificar el resultado.

3. **VERIFICADO:** reutilizar `partirEnBurbujas` para el techo de transporte. Ya existe límite duro de 3.500 caracteres y una suite que comprueba que no se pierda contenido. [burbujas.js:39](/C:/Users/mcifu/activa/temp-wa/services/burbujas.js:39), [burbujas.js:53](/C:/Users/mcifu/activa/temp-wa/services/burbujas.js:53), [burbujas.js:110](/C:/Users/mcifu/activa/temp-wa/services/burbujas.js:110).

4. **PLAUSIBLE:** si el objetivo comercial es máximo 900 caracteres, regenerar una versión breve antes de truncar. Cortar por frase puede eliminar la pregunta de cierre, condiciones o advertencias.

5. **VERIFICADO:** el reintento debe repetir solamente la generación final usando los tool results ya obtenidos. Reejecutar el turno completo puede volver a cotizar, pedir folio y mandar PDF, porque las tools se ejecutan antes del texto final. [agent.js:73](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/agent.js:73), [agent.js:101](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/agent.js:101), [agent.js:151](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/agent.js:151).

6. **PLAUSIBLE:** limitar a un reintento; después enviar fallback determinista y levantar alerta. Un retry ilimitado convierte una fuga en loop.

## P2 — embudo único

**VERIFICADO — APTO CON CAMBIOS.**

Cambio concreto:

- **VERIFICADO:** crear un gateway superior, por ejemplo `enviarTextoCliente`, usado por V1, Oliver GPT y Oliver v2. No basta con meter el filtro dentro de `index.js:waSend`.

- **VERIFICADO:** el gateway debe alimentar con el mismo texto limpio tanto a Meta como a `pushConversationEvent`; hoy Oliver GPT envía por el adaptador y persiste `reply` crudo por separado. [webhook.js:4559](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:4559), [webhook.js:4620](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:4620), [webhook.js:4631](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:4631).

- **VERIFICADO:** separar explícitamente `cliente` de `interno`. Sanitizar globalmente `waSend` borraría diagnósticos útiles en alertas a Marcelo. [index.js:1680](/C:/Users/mcifu/activa/temp-wa/index.js:1680), [index.js:1688](/C:/Users/mcifu/activa/temp-wa/index.js:1688).

- **VERIFICADO:** captions de PDF, imagen, video y documento son texto visible y hoy van directo a Meta. También deben pasar por el gateway, con límites propios. [index.js:4392](/C:/Users/mcifu/activa/temp-wa/index.js:4392), [index.js:4411](/C:/Users/mcifu/activa/temp-wa/index.js:4411), [index.js:4441](/C:/Users/mcifu/activa/temp-wa/index.js:4441), [index.js:4501](/C:/Users/mcifu/activa/temp-wa/index.js:4501).

- **PLAUSIBLE:** TTS puede verbalizar el JSON filtrado. El filtro V1 sólo elimina los caracteres `<` y `>`; el contenido de los tags queda. Oliver GPT también sintetiza desde `reply`. Sólo sería exposición real si voz está habilitada. [index.js:1967](/C:/Users/mcifu/activa/temp-wa/index.js:1967), [index.js:2000](/C:/Users/mcifu/activa/temp-wa/index.js:2000), [webhook.js:4565](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:4565).

- **VERIFICADO:** templates deben quedar fuera del limpiador de payloads. Sólo corresponde validar y acotar cada parámetro dinámico; cantidad y orden son parte del contrato aprobado por Meta. [index.js:1091](/C:/Users/mcifu/activa/temp-wa/index.js:1091), [index.js:1101](/C:/Users/mcifu/activa/temp-wa/index.js:1101).

## P3 — nombres

**VERIFICADO — NO APTO.**

- **PLAUSIBLE:** un léxico de nombres chilenos produciría falsos negativos con nombres raros, migrantes, mapuche, abreviaciones y perfiles comerciales. No hay corpus etiquetado en el repo para calibrar ese clasificador.

- **VERIFICADO:** exigir exclusivamente un nombre de persona tampoco representa todos los documentos: el PDF ya distingue persona, empresa, razón social y RUT. [quotePdf.js:24](/C:/Users/mcifu/activa/temp-wa/services/quotePdf.js:24), [quotePdf.js:32](/C:/Users/mcifu/activa/temp-wa/services/quotePdf.js:32), [quotePdf.js:42](/C:/Users/mcifu/activa/temp-wa/services/quotePdf.js:42).

- **VERIFICADO:** bloquear siempre antes del folio contradice el flujo actual. `quoteDataComplete` deliberadamente no bloquea por nombre y usa perfil, `Cliente de <comuna>` o `Cliente`, dejando la reemisión posterior. [pdf-intent.js:160](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/pdf-intent.js:160), [pdf-intent.js:183](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/pdf-intent.js:183), [pdf-intent.js:188](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/pdf-intent.js:188).

Cambio sustituto:

- **VERIFICADO:** separar `contact_name`, `document_recipient` y `name_source`.
- **PLAUSIBLE:** capturar automáticamente sólo presentaciones explícitas; para respuesta directa a `nameAsked`, rechazar preguntas/intenciones y confirmar los casos ambiguos.
- **VERIFICADO:** agregar estado `validated/assumed/pending`, porque mantener `needsName` exactamente igual deja todos los nombres basura históricos como válidos.
- **VERIFICADO:** agregar tests con los seis casos reales, empresas, nombres poco comunes y un test de wiring completo `nameAsked → captura → PDF`; la suite actual prueba funciones aisladas, no ese recorrido. [oliverName.test.js:65](/C:/Users/mcifu/activa/temp-wa/services/oliverName.test.js:65), [oliverName.test.js:80](/C:/Users/mcifu/activa/temp-wa/services/oliverName.test.js:80).

## P4 — idempotencia del folio

**VERIFICADO — NO APTO.**

- **VERIFICADO:** conversación+monto no identifica contenido. Dos propuestas pueden tener igual total y cambiar producto, medidas, color, cantidad, receptor o condiciones.

- **VERIFICADO:** el sistema vigente trata las alternativas como documentos distintos y les reserva letras aun cuando pertenecen al mismo proyecto. [propuestas-color.js:72](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/propuestas-color.js:72), [propuestas-color.js:83](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/propuestas-color.js:83), [propuestas-color.js:118](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/propuestas-color.js:118).

Cambio sustituto:

- **VERIFICADO:** idempotencia por `tenant_id + idempotency_key` de la operación de emisión.
- **VERIFICADO:** guardar además `content_hash`, `base_quote`, `revision/variant`, `status` y el hash del PDF.
- **PLAUSIBLE:** una repetición de la misma operación devuelve el mismo folio; un contenido distinto exige una decisión explícita `corrección`, `alternativa` o `nueva propuesta`. El monto no toma esa decisión.
- **VERIFICADO:** contador y registro de emisión deben quedar en una misma transacción. Si el PDF o Meta fallan después de reservar, el folio debe quedar como `voided/failed`, con causa, no desaparecer.

### ISO 9001 §7.5

- **VERIFICADO:** la cláusula 7.5 exige identificación/descripción apropiada, control de cambios, almacenamiento, acceso, retención y disposición. No establece expresamente una secuencia “sin huecos”. [Guía oficial ISO/TC 176 sobre información documentada](https://www.iso.org/files/live/sites/isoorg/files/standards/docs/en/iso_9001_2015_guidance_documented_information.pdf).

- **NO PUEDO SABERLO:** el SGI interno de Activa podría imponer correlativo continuo. Ese procedimiento no estaba entre los archivos entregados.

- **VERIFICADO:** el flujo actual ya puede reservar folio antes de la generación/entrega y luego fallar. Por tanto, “cero huecos” no está garantizado hoy; la solución auditable es conservar el folio fallido con estado y causa. [webhook.js:2898](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:2898), [webhook.js:2929](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:2929), [webhook.js:4168](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:4168).

- **VERIFICADO:** V1 además cae a un folio aleatorio `COT-*` cuando el servicio ISO no responde. Eso rompe la política uniforme antes que P4. [index.js:6503](/C:/Users/mcifu/activa/temp-wa/index.js:6503), [index.js:6521](/C:/Users/mcifu/activa/temp-wa/index.js:6521).

## P5 — teléfonos internos

**VERIFICADO — APTO CON CAMBIOS.**

- **VERIFICADO:** el dueño se detecta, pero esa condición sólo activa atribución. Si no hay atribución vigente, `telefonoCliente` queda igual al número del dueño; no existe exclusión antes de pedir correlativo. [webhook.js:1103](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:1103), [webhook.js:1108](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:1108), [webhook.js:1110](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:1110).

Cambio concreto:

- **VERIFICADO:** marcar `is_test/test_run_id` en la conversación y propagarlo a quote, conversión, Zoho, follow-up y métricas.
- **VERIFICADO:** usar contador o tenant separado de pruebas; el prefijo visual por sí solo no evita consumo del contador productivo.
- **VERIFICADO:** si el dueño activó atribución `CLIENTE`, la propuesta pertenece al tercero y debe conservar folio productivo. No se puede excluir todo lo originado desde su teléfono.
- **PLAUSIBLE:** el modo test debe derivarse server-side desde actor, sesión y atribución; aceptar un `is_test` libre del request permitiría sacar cotizaciones reales de los KPIs.
- **NO PUEDO SABERLO:** el query del brief 7AM vive fuera del código revisado, por lo que no pude comprobar su filtro actual.

## P6 — drafts nulos

**VERIFICADO — APTO CON CAMBIOS.**

- **VERIFICADO:** existe una incompatibilidad exacta: el draft busca `quote.total || quote.grand_total`, pero las tools reales devuelven `total_neto`. [webhook.js:4656](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:4656), [tools.js:851](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/tools.js:851), [tools.js:854](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/tools.js:854).

- **VERIFICADO:** el test no detecta el contrato roto porque inventa un resultado `{total:321593}`, distinto del resultado de la tool real. [webhook.test.js:238](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.test.js:238), [webhook.test.js:247](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.test.js:247).

- **VERIFICADO:** `extractQuote` toma solamente la primera cotización del turno. Mapear `total_neto` directamente todavía dejaría un monto parcial en pedidos con varios ítems. [webhook.js:684](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:684), [webhook.js:692](/C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/webhook.js:692).

Cambio concreto:

- **VERIFICADO:** crear un DTO canónico de cotización agregada y persistir sólo cuando tenga `items` y `amount_total > 0`.
- **PLAUSIBLE:** guardar borradores en tabla/entidad separada, con upsert por conversación y TTL; `quotes` debe reservarse para propuestas identificables.
- **VERIFICADO:** `quote_number` debe seguir nulo mientras sea borrador; aparece al emitir el documento.
- **VERIFICADO:** agregar un contract test que alimente `pushQuoteEvent` con la forma real devuelta por `runTool`, no con una fixture inventada.

## LO QUE EL PLAN NO VIO

1. **VERIFICADO:** hay tres cerebros posibles y dos implementaciones de transporte; el brief sólo siguió el V1 de `index.js`.

2. **VERIFICADO:** voz, captions y persistencia del mensaje son superficies de salida. Limpiar únicamente el POST de texto no garantiza que el cliente no escuche el tool-call ni que el cockpit deje de almacenar la versión cruda.

3. **VERIFICADO:** `waSend` traga errores. Un sistema que pretende bloquear, reintentar y auditar necesita resultado `{ok,msgId,error}` o excepción; hoy V1 no puede distinguir aceptación de fallo. [index.js:1852](/C:/Users/mcifu/activa/temp-wa/index.js:1852), [index.js:1860](/C:/Users/mcifu/activa/temp-wa/index.js:1860).

4. **VERIFICADO:** ya existe una máquina de folios con firmas, revisiones, alternativas, persistencia temporal y reemisión. P4 propone una segunda semántica incompatible en vez de llevar la existente al servidor.

5. **VERIFICADO:** la política actual permite emitir sin nombre y corregir después. P3 cambia una decisión comercial, no sólo un validador técnico.

6. **VERIFICADO:** los drafts nulos no son simplemente “basura”: hay un contrato roto entre `tools.js`, `webhook.js` y su test. Un TTL no corrige eso.

7. **NO PUEDO SABERLO:** sin configuración desplegada, payloads de los tres PDFs y consultas reales de Postgres no se puede atribuir cada métrica a una rama específica ni declarar resuelto el incidente de producción.

8. **VERIFICADO:** no se editaron ni crearon archivos, no se ejecutó Git de escritura ni deploy, y `.env` no fue abierto. El `git status --short` final mostró únicamente `?? docs/tridente-oliver-2026-09-15/`, directorio que ya contenía el brief entregado al iniciar la revisión.
