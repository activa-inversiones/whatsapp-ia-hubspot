# Tridente #947 · Gemini · ronda 1 (gemini-2.5-flash, wrapper read-only, diff en docs/tridente-947/diff-947.txt)

> Revisó el diff ANTERIOR a la corrección de unidades (la regla 'máximo ≤ 600 → cm' ya había sido reemplazada por 'algún ancho < 150 → cm' antes de que terminara).

VEREDICTO: **NO APTO**

El cambio propuesto presenta **dos vulnerabilidades graves de diseño** que alteran los precios de producción y rompen la cotización de bow windows pequeñas, comunes en la realidad de ACTIVA. Si este código se sube a producción, habrá discrepancias de precio entre el chat y el PDF, y fallas de 10× en dimensiones de ventanas estándar de cocina o baño.

---

### HALLAZGOS

#### 1. 🔴 [GRAVE] Discrepancia de vidrio y precio entre chat y PDF (re-cotización por etiqueta)
* **Archivo:Línea:** `services/enginePricer.js:1269` y `services/enginePricer.js:1409-1411`
* **Por qué:** 
  En la cotización inicial del chat, la tool `runTool` pasa temporalmente `measures` con la medida del **paño más grande de la esquina** (`esq.ancho_max_mm` × `esq.alto_mm`) a `priceAllEngine`. El pricer calcula el `glass_id` en la línea 1269 usando esta medida individual de vidrio. Esto es correcto: el vidrio se calcula por paño.
  Sin embargo, más adelante, el pricer pisa `item.measures` con el **ancho total de la esquina** (`_anchoTotal` × `_bow.alto_mm`) y se guarda así en la base de datos.
  Al re-cotizar el ítem por etiqueta (para generar el PDF final o al usar la sonda de color), `priceAllEngine` resuelve `m` a partir de `item.measures` guardado (el ancho total). Por ende, en la línea 1269, calcula el área del vidrio con el ancho de **toda** la ventana. Esto infla el área artificialmente y causa que una ventana que originalmente usaba vidrio normal de 4 mm (`GLASS_STD` = 34) en el chat, se re-cotice con vidrio pesado de 5 mm (`GLASS_LARGE` = 61) en el PDF, cambiando el precio de forma inconsistente.
* **Cómo reproducirlo:**
  1. El cliente pide una bow window simétrica de: `lateral 400 mm + central 1200 mm + lateral 400 mm` con alto `1200 mm` (ancho total: 2000 mm).
  2. En el chat, el paño mayor es `1200x1200mm`. Área del paño = $1,44\text{ m}^2 < 2\text{ m}^2$. Se cotiza con vidrio estándar `4+12+4` (id 34). El precio del chat será barato.
  3. El ítem se guarda con `measures` = `2000x1200mm`.
  4. Al emitir el PDF, se re-cotiza de la etiqueta. El pricer calcula el área del vidrio como $2,0 \times 1,2 = 2,4\text{ m}^2 \ge 2\text{ m}^2$.
  5. Se le asigna vidrio `5+12+5` (id 61). **El PDF saldrá más caro que el precio que Oliver le prometió al cliente en el chat.**

#### 2. 🔴 [GRAVE] Distorsión de unidades de 10× en paños pequeños en milímetros
* **Archivo:Línea:** `services/formaEsquina.js:101-103` (y su relación con `src/oliver-gpt/tools.js` schema)
* **Por qué:**
  La función `esquinaDesdePanos` aplica `escalaCm` sobre los anchos de los paños enviados por el LLM. La función `escalaCm` asume que si el valor máximo de la lista es $\le 600$, las unidades están en centímetros y las multiplica por 10.
  Sin embargo, el schema de la tool en `tools.js` exige explícitamente que la propiedad se llame `ancho_mm` y dice *"Ancho de ESTE paño en milímetros"*.
  Si el LLM obedece estrictamente al schema y envía las medidas en milímetros de paños reales pequeños ($\le 600\text{ mm}$, por ejemplo en ventanas pequeñas de cocina o baño), el backend asumirá erróneamente que son centímetros y los multiplicará por 10. Las medidas resultantes serán 10 veces más grandes, rompiendo los límites de fabricación y forzando una escalación innecesaria a Marcelo.
* **Cómo reproducirlo:**
  1. Se solicita una esquina pequeña de cocina: `450 mm fijo + 500 mm fijo + 450 mm fijo` (alto 1200 mm).
  2. El LLM envía en `panos_esquina`: `[{ancho_mm: 450, ...}, {ancho_mm: 500, ...}, {ancho_mm: 450, ...}]`.
  3. El backend calcula el máximo: 500. Como $500 \le 600$, les aplica $\times 10$.
  4. Los anchos quedan en: `4500 mm`, `5000 mm` y `4500 mm` (ancho total: 14 metros).
  5. La ventana excede todo límite, la cotización automática falla y se escala a Marcelo con advertencia de medidas inválidas.

#### 3. 🟡 [MENOR] Falta de validación estricta para ángulos no soportados por el motor
* **Archivo:Línea:** `services/formaEsquina.js:171`
* **Por qué:**
  La función `esquinaDesdePanos` acepta y valida como correcto cualquier ángulo mayor a 0 (p. ej. 120 o 60 grados). No obstante, el motor de cotización real en producción (`sales-os`) solo soporta ángulos de 90 y 45 grados, rechazando todos los demás. Dejar pasar ángulos inválidos provocará una falla de API de motor directa en vez de un rechazo local temprano con un mensaje limpio y amigable que le pida corregir el ángulo al cliente.
* **Cómo reproducirlo:**
  1. El LLM envía `angulo_esquina: 120`.
  2. `esquinaDesdePanos` lo aprueba sin problemas.
  3. Al cotizar en producción, el motor explota y devuelve error técnico, abortando la cotización.

#### 4. 🟡 [MENOR] Falso positivo potencial de regex en nota de línea de monorriel
* **Archivo:Línea:** `src/oliver-gpt/tools.js:793`
* **Por qué:**
  `notaDeLineaParaElLLM` evalúa si el ítem es esquina con: `if (it.esquina || /esquina/i.test(String(it.nota_linea)))`. Dado que `it.esquina` siempre estará presente al cotizarse una esquina real en la tool, el check por regex sobre `nota_linea` es redundante y peligroso.
  Si el cliente pide una ventana corredera de un paño (que califica como monorriel económico) y menciona en su texto de ubicación la palabra "esquina" (ej. "corredera para la esquina del living"), y esta palabra se propaga por el backend a `nota_linea`, el ítem caerá en la rama de esquina de la tool. El monorriel **perderá su instrucción de venta económica**, afectando la persuasión del bot.

---

### NO PUDE SABERLO
* El código interno del motor de cotización real de producción (el archivo `calculateBowQuote` en el repositorio hermano `temp-sales-os`) no está disponible en este entorno, por lo que no puedo asegurar si hay validaciones extra de área de vidrio que se ejecuten directamente en el servidor y actúen como mitigación antes del subcobro, aunque la asimetría de envío de parámetros desde el pricer es real y verificada en el diff.
GEMINI EXIT: 0 (modelo=gemini-2.5-flash, limite=1800s)
