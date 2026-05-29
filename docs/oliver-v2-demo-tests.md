# Oliver v2 — Pruebas de Demo (Análisis ESTÁTICO)

> **IMPORTANTE — esto NO es una corrida en vivo.** `ANTHROPIC_API_KEY` no está
> definida en este entorno ni existe en el repo (solo `.env.example`; **no hay
> `.env.local`**). Por lo tanto `node src/sales-agent/run-demo.js` está **BLOQUEADO**.
> Este documento es un análisis estático de tono/comportamiento: predice cómo
> *debería* responder Oliver v2 dado el system prompt (`personality.md` +
> `OPERATING_INSTRUCTIONS`) y las tools definidas, y juzga si el diseño producirá
> el tono y la conducta correctos.
>
> **Validación en vivo: PENDIENTE** de la API key real (se setea en Railway).
>
> Fuentes analizadas:
> - `src/sales-agent/personality.md` (16 secciones — fuente de verdad de tono)
> - `src/sales-agent/system-prompt.js` (ensamblaje del prompt + contexto de sesión)
> - `src/sales-agent/agent.js` (loop de tool-use, Haiku 4.5)
> - `src/sales-agent/tools.js` (7 tools + executors)

---

## Cómo se evalúa cada escenario

Cada caso contrasta el input contra: (1) las **reglas duras de uso de tools** en
`OPERATING_INSTRUCTIONS` ("NO cotices a ciegas"; gatillos de cada tool), (2) las
secciones de `personality.md` que aplican, y (3) el tono chileno cercano/consultivo.
Veredicto **PASS** = el diseño dirige al modelo a la conducta correcta sin
ambigüedad. **RISK** = el diseño funciona pero hay un hueco que podría producir
una salida fuera de personalidad en algún porcentaje de corridas.

---

## Escenario 1 — "Hola, necesito ventanas pa' mi casa nueva" (B2C discovery)

**Input:** `Hola, necesito ventanas pa' mi casa nueva`

**Tool call esperado:** NINGUNO en este turno. Es apertura/descubrimiento. No hay
datos para cotizar (falta tipo, medidas, color, comuna) y la regla dura prohíbe
cotizar a ciegas. `guardar_lead_postgres` aún no aplica (sin datos útiles todavía).

**Tono esperado:** Saludo cálido NO genérico (Sección 16 prohíbe "¿en qué te
ayudo?"). "mi casa nueva" es señal **B2C** clara (Sección 9 → "mi casa"). Debe
reconocer la situación y hacer **una** pregunta de descubrimiento (trigger /
expectativa), tipo el ejemplo del tono #1: *"¡Hola! Soy Oliver, de Activa 👋 ...
¿Es construcción nueva o estás remodelando?"* — aquí ya dijo "casa nueva", así
que la pregunta natural es la expectativa/dolor: qué busca (frío, estética, etc.)
o cuántas ventanas. Una sola idea, 3-4 líneas, español chileno.

**Veredicto: PASS.** El diseño cubre esto sólidamente: detección B2C explícita
en instrucciones + Sección 9, prohibición de saludo genérico (Sección 16),
patrón de "una pregunta a la vez", y el ejemplo de tono #1 calza casi textual.
Riesgo bajo de que el modelo cotice o pida 5 datos de golpe.

---

## Escenario 2 — "Cotizamos 50 ventanas para edificio" (B2B)

**Input:** `Cotizamos 50 ventanas para edificio`

**Tool call esperado:** NINGUNO de cotización todavía (faltan tipo/medidas/color/
comuna). Conducta correcta = **detectar B2B y calificar**. Posibles tools en este
turno o el siguiente: `guardar_lead_postgres(segmento: "B2B")` una vez que haya
algún dato, y — dado el gatillo "alto valor / proyecto grande (obra, condominio)"
de la Sección 8/instrucciones — esto es candidato a `notificar_marcelo`. Nota: la
Sección 8 lista "alto valor / proyecto grande" como gatillo de escalación, pero
NO necesariamente en el primer turno; lo natural es calificar primero (plazo,
descuento por volumen, ficha técnica) y escalar al cerrar o si pide condiciones.

**Tono esperado:** Señales B2B inequívocas: "cotizamos" (plural/empresa), "50
ventanas" (20+), "edificio" (Sección 9 → "el edificio"). Debe cambiar a modo
**B2B**: directo, profesional, datos técnicos/comerciales al frente. Prioriza
plazo, descuento por volumen, certificaciones, factura. Apertura tipo: reconocer
el volumen + una pregunta de calificación (¿constructora/inmobiliaria?, ¿plazo de
obra?, ¿qué comuna?). Menos emoji-y, más ejecutivo.

**Veredicto: PASS (con un matiz de timing de escalación → ver Riesgo abajo).**
La detección de segmento está bien soportada (instrucciones + tabla Sección 9 con
las palabras exactas "el edificio"/"20+"). El único matiz es que el diseño no
explicita *cuándo* en el flujo B2B disparar `notificar_marcelo` para alto valor:
las instrucciones dicen "SOLO ante gatillo real" y listan "alto valor/obra", lo
que podría empujar al modelo a escalar demasiado temprano (turno 1) en vez de
calificar primero. No es un fallo de tono, es un riesgo menor de timing de tool.

---

## Escenario 3 — "Cuánto sale una ventana" (precio sin contexto)

**Input:** `Cuánto sale una ventana`

**Tool call esperado:** NINGUNO. Este es el caso central de la regla dura: **"NO
cotices a ciegas. Antes de `calcular_cotizacion` necesitas tipo, medidas (mm),
color y comuna. Si falta algo, pregúntalo."** Faltan los 4 → debe pedir, no cotizar.

**Tono esperado:** Tiene DOS patrones reforzantes en personality.md:
1. Ejemplo de tono #2 (cliente apurado por precio): *"Te entiendo, vamos al precio.
   Pero pa' tirarte un número que sirva y no una adivinanza, necesito 2 datos:
   ¿qué tipo de ventana y cuántas más o menos?"*
2. Sección 10 (analogía del celular / Filosofía Marcelo) — diseñada **exactamente**
   para "cuando el cliente solo pregunta precio sin contexto".

Lo ideal: validar la intención ("te entiendo, vamos al precio"), explicar
brevemente por qué necesita datos, y pedir tipo/medidas/color/comuna **de a poco**
(una pregunta a la vez, no los 4 de golpe). La analogía del celular es opcional y
puede sentirse larga para WhatsApp; el modelo debería preferir el patrón corto #2.

**Veredicto: PASS.** Es el escenario mejor blindado del set: regla dura explícita
+ dos ejemplos de tono dedicados. Riesgo de cotización a ciegas: muy bajo.
(Único matiz: la Sección 10 es un párrafo largo que choca con "mensajes de 3-4
líneas"; ver sugerencia de polish #3.)

---

## Escenario 4 — "El aluminio es más barato" (manejo de objeción)

**Input:** `El aluminio es más barato`

**Tool call esperado:** NINGUNO (manejo conversacional de objeción).
Opcionalmente `listar_vidrios` si deriva hacia recomendar termopanel, pero no es
necesario para responder la objeción.

**Tono esperado:** personality.md tiene la respuesta **palabra por palabra** en la
Sección de manejo de objeciones (loop AECR): *"Cierto, el aluminio cuesta menos al
principio. El tema es que el aluminio es un conductor: deja pasar el frío y te
genera condensación... El PVC aísla de verdad. Pagas un poco más una vez, no todos
los inviernos."* Refuerzo extra en Sección 13 ("El PVC aísla 5x mejor que el
aluminio... cuentas hasta 30% más bajas"). Debe: reconocer que es cierto (no
negar), reframe a valor/ahorro energético, NO presionar. Honesto (Personalidad:
"si algo es caro, lo dice y explica por qué vale la pena").

**Veredicto: PASS.** Objeción dominante prevista (precio/valor ~48%) y con script
AECR literal + datos de respaldo. Tono chileno y honesto bien soportado.

---

## Escenario 5 — "Quiero ver cómo se ve en color nogal" (debe usar simulador)

**Input:** `Quiero ver cómo se ve en color nogal`

**Tool call esperado:** **`generar_link_simulador`** (idealmente con
`color: "nogal"` y `tipo` si se conoce). Gatillo explícito en instrucciones:
*"`generar_link_simulador` cuando el cliente dude del color/estética"*, y en la
Sección de objeciones: *"No estoy seguro del color/tipo → ¡Pa' eso tenemos
simulador 3D! ... 👉 [generar_link_simulador]"*. El executor construye la URL con
`color` como query param, así que pasar `color:"nogal"` está soportado y se
traduce a un link limpio (la instrucción "nunca muestres URLs larguísimas / JSON
crudo" aplica: debe presentar el link en lenguaje natural).

**Tono esperado:** Entusiasta, breve: ofrece el link del simulador para que vea el
nogal en su fachada, e idealmente una pregunta de seguimiento suave. Sección 11
("ESTÉTICA / casa nueva → Simulador 3D") y ejemplo de tono #5 lo respaldan.

**Veredicto: PASS.** Mapeo input→tool inequívoco. La tool tiene `color` opcional y
el executor lo serializa. Riesgo bajo. (Matiz menor: el modelo debe acordarse de
NO pegar la URL cruda con query params; la regla existe pero es genérica.)

---

## Resumen de veredictos

| # | Escenario | Tool esperada | Veredicto |
|---|-----------|---------------|-----------|
| 1 | "ventanas pa' mi casa nueva" (B2C) | ninguna (discovery) | **PASS** |
| 2 | "50 ventanas para edificio" (B2B) | ninguna cotiz.; B2B + (luego) lead/escala | **PASS** (matiz timing escalación) |
| 3 | "cuánto sale una ventana" (sin contexto) | ninguna; pedir datos | **PASS** |
| 4 | "el aluminio es más barato" (objeción) | ninguna (AECR) | **PASS** |
| 5 | "color nogal" (estética) | `generar_link_simulador` | **PASS** |

**Lectura general:** el diseño *calza muy bien*. La personalidad es rica y, de
forma clave, los gatillos críticos están **duplicados** entre `personality.md` y
las reglas duras de `OPERATING_INSTRUCTIONS` (no cotizar a ciegas, simulador para
estética, escalación restringida). Esa redundancia es buena para un modelo Haiku
(menos capaz de inferencia sutil que Opus/Sonnet). No se inventan problemas;
abajo van tweaks de bajo riesgo y alto valor.

---

## Sugerencias accionables (polish — el diseño ya está sólido)

### Tweak 1 — Aclarar el *timing* de escalación B2B de alto valor (RISK del Esc. 2)

**Problema:** `OPERATING_INSTRUCTIONS` dice *"`notificar_marcelo` SOLO ante un
gatillo real... No escales por defecto"* y la Sección 8 lista "Alto valor /
proyecto grande" como gatillo. Un Haiku puede leer "edificio / 50 ventanas" en el
turno 1 y escalar inmediatamente, saltándose la calificación B2B (plazo, volumen,
ficha técnica) que la Sección 9 pide primero.

**Cambio sugerido — en `system-prompt.js`, bloque `OPERATING_INSTRUCTIONS`,
sección "Detección de segmento (B2C vs B2B)", agregar una línea:**

> Texto actual:
> ```
> - Si no queda claro, opera en modo B2C y escala a B2B al detectar señales.
> ```
> Agregar debajo:
> ```
> - En B2B de alto volumen, PRIMERO califica (plazo de obra, comuna, ficha técnica/factura) y recién escala a Marcelo con notificar_marcelo cuando el proyecto esté confirmado o el cliente pida condiciones especiales. No escales en el primer turno solo por el tamaño.
> ```

### Tweak 2 — Reforzar "no pegar la URL/JSON crudo" donde se generan links

**Problema:** la regla "nunca muestres JSON crudo, IDs internos ni URLs
larguísimas" vive en una sola línea genérica de las reglas duras. Para los dos
casos que devuelven una URL (`generar_link_simulador`, `generar_link_aprobacion`)
conviene un recordatorio puntual, porque Haiku tiende a copiar el `tool_result`.

**Cambio sugerido — en `system-prompt.js`, en la línea de
`generar_link_simulador`:**

> Texto actual:
> ```
> - `generar_link_simulador` cuando el cliente dude del color/estética.
> ```
> Cambiar a:
> ```
> - `generar_link_simulador` cuando el cliente dude del color/estética. Preséntalo como un link corto en lenguaje natural ("te paso el simulador 👉 ..."), nunca el JSON ni una URL gigante.
> ```

### Tweak 3 (menor) — Marcar la analogía del celular (Sección 10) como OPCIONAL/corta

**Problema:** la Sección 10 de `personality.md` es un párrafo de ~6 líneas que
choca con la regla "mensajes de 3-4 líneas, 1 idea por mensaje" del canal
WhatsApp. En el Esc. 3 el modelo podría soltar el bloque completo y sonar
acartonado/largo.

**Cambio sugerido — en `personality.md`, Sección 10, ajustar la directiva de uso:**

> Texto actual (línea ~166):
> ```
> **USAR cuando el cliente solo pregunta precio sin contexto** (en vez de tirar un número a ciegas):
> ```
> Cambiar a:
> ```
> **USAR (resumida, máx 2-3 líneas) cuando el cliente solo pregunta precio sin contexto** (en vez de tirar un número a ciegas). En WhatsApp prefiere el patrón corto del ejemplo de tono #2; la analogía completa solo si el cliente insiste en "¿por qué tan caro?":
> ```

---

## Validación en vivo (PENDIENTE)

Cuando `ANTHROPIC_API_KEY` esté disponible (Railway), correr:

```
node src/sales-agent/run-demo.js
```

y reproducir los 5 inputs para confirmar empíricamente: (a) que el Esc. 5 dispara
`generar_link_simulador`, (b) que los Esc. 1-4 NO disparan cotización a ciegas, y
(c) el timing real de `notificar_marcelo` en el flujo B2B (Tweak 1). Este doc
debe re-verificarse contra esa corrida real.
