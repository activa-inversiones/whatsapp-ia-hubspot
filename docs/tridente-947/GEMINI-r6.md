> ⚠️ El wrapper terminó con EXIT 9 (snapshot de `git status` distinto antes/después): la diferencia fue **mi propio commit `222451a`** durante su corrida, no una escritura de Gemini (verificado: repo intacto, 0 archivos perdidos). Igual, por regla, **este veredicto NO cuenta como evidencia**; sus dos hallazgos se tomaron por baratos y correctos.

# Tridente #947 · Gemini · ronda 6 (diff incremental del 2º commit)

VEREDICTO: APTO

El diff incremental de la ronda r6 es sumamente robusto y cierra de manera limpia las vulnerabilidades de la ronda anterior (especialmente la exención de la esquina frente al chequeo local de fabricación y el swap global de medidas). No se abren regresiones de precio ni discrepancias de vidrios entre el chat y el PDF.

Sin embargo, como **Abogado del Diablo**, identifico dos hallazgos (uno de robustez matemática y otro lingüístico que persiste) que deben declararse y solucionarse para garantizar un comportamiento 100% libre de fallas en producción.

---

### HALLAZGOS

#### 1. [MEDIO] `services/enginePricer.js:1379-1380` · Fragilidad en la detección del alto de la etiqueta ante ediciones manuales en el CRM (Railway)

*   **Por qué ocurre:** La fórmula matemática para deducir el alto de la etiqueta (`_altoLabel`) cuando hay swap global activo (`tableIsAltoAncho = true`) depende de una holgadura rígida de `1 mm`:
    ```javascript
    const _sumaLabel = _porLabel.partes.reduce((a, pt) => a + (Number(pt.ancho_mm) || 0), 0);
    const _altoLabel = Math.abs(m.ancho_mm - _sumaLabel) <= 1 ? m.alto_mm
      : (Math.abs(m.alto_mm - _sumaLabel) <= 1 ? m.ancho_mm : m.alto_mm);
    ```
    Si un ejecutivo o el dueño edita el ancho en el campo `measures` del ítem en Railway para aplicar un descuento o ajuste menor (por ejemplo, cambiar el total de `4315 mm` a `4310 mm` para descontar un poste de acople), la diferencia absoluta con `_sumaLabel` (4315) será de `5 mm`.
    Al re-cotizar con swap activo, ambas condiciones fallarán (`5 > 1` y `2775 > 1`), por lo que caerá en el default `: m.alto_mm` que vale `4310` (el ancho total). La esquina quedará cotizada con altura de `4310 mm` en vez de `1540 mm`, duplicando o triplicando el precio real del ítem.
*   **Cómo reproducirlo (caso hipotético de edición):**
    *   **Input:** Ítem con `measures: '4310x1540mm'` (con el ajuste de 5mm), `producto_label: 'Bow window ... Fijo 330mm + Fijo 1830mm + Fijo 1830mm + Compuesto 325mm'`.
    *   **Mensaje del cliente:** `"alto por ancho: 1200x1500"` (dispara `tableIsAltoAncho = true` global).
    *   **Salida obtenida:** `_altoLabel` evalúa a `4310 mm`.
    *   **Salida esperada:** `_altoLabel` de `1540 mm`.
*   **Solución propuesta:** Reemplazar el ternario rígido por una deducción basada en la mayor distancia absoluta. La altura real siempre será la dimensión del par que esté **más alejada** de la suma total de paños de la esquina (que es matemáticamente infalible y tolerante a cualquier diferencia de milímetros por descuento):
    ```javascript
    const _altoLabel = Math.abs(m.ancho_mm - _sumaLabel) > Math.abs(m.alto_mm - _sumaLabel) ? m.ancho_mm : m.alto_mm;
    ```

---

#### 2. [MENOR-MEDIO] `services/enginePricer.js:1464-1465` · Inconsistencia lingüística de tono y lenguaje (voseo argentino) en propuesta PDF y prompt del LLM

*   **Por qué ocurre:** Aunque el primer commit `bad95f1` ya cerró la filtración del monorriel hacia la nota de esquina, el texto de la nota de esquina para el camino de la notación triple (`_triple`) que persiste en `enginePricer.js` incluye voseo argentino explícito:
    ```javascript
    item.nota_linea = _mitadYMitad
      ? `Ventana en esquina: paño central de ${_triple.central_mm} mm y dos laterales de ...`
      : `Ventana en esquina: paño central de ${_triple.central_mm} mm y dos laterales fijos de `
        + `${_triple.lateral_mm} mm. Si querés que los laterales se abran, decímelo y lo ajusto.`;
    ```
    Las palabras `"querés"` y `"decímelo"` corresponden a voseo argentino, prohibido estrictamente por el test de integración `system-prompt.test.js` y las directrices generales de tono del bot (que exigen tuteo chileno profesional o trato de usted).
    Al quedar registrado esto en `item.nota_linea`:
    1.  El texto viaja directo al PDF de cotización, el cual es un documento de cobro formal que verá el cliente de Temuco (donde se lee muy informal). El PDF no pasa por la red defensiva del chat de WhatsApp.
    2.  Se inyecta al LLM a través de `notaDeLineaParaElLLM` como contexto de su input, pudiendo inducir al modelo a responder con voseo al cliente en el chat.
*   **Cómo reproducirlo:** Cotizar una bow window por notación triple sin que se abran los laterales (ej: `"un bow de 2000x1500x400"`).
    *   **Salida obtenida en PDF:** `"Si querés que los laterales se abran, decímelo y lo ajusto."`
    *   **Salida esperada:** `"Si quieres que los laterales se abran, dímelo y lo ajusto."` o `"Si quiere que los laterales se abran, dígame y lo ajusto."`

---

### NO PUDE SABERLO

1.  **Si el motor de producción (sales-os) valida de forma exitosa los límites de esbeltez de paños individuales cuando la validación local `dim.escalate` se salta:** No tengo acceso al código vivo del motor para auditar sus rangos mínimos/máximos de validación por paño en el motor de cotizaciones (`calculateBowQuote`). Sin embargo, confío en la veracidad del comentario que indica que el motor sí los valida.
2.  **Si el archivo `services/esquina-routing.test.js` pasa en su totalidad con la suite completa:** Dado que estoy operando en Plan Mode, no tengo una herramienta habilitada para ejecutar `run_shell_command` o correr el test de node de manera directa. He comprobado la corrección sintáctica y la presencia de variables como `PEDIDO_DUENO` y `TEXTO_DUENO` estáticamente.
GEMINI EXIT: 0 (modelo=gemini-2.5-flash, limite=1800s)

🔴🔴 GEMINI MODIFICO EL REPO PESE A LAS RESTRICCIONES — REVERTIDO AUTOMATICAMENTE 🔴🔴
Diff de estado detectado:
    1,4d0
    <  M services/enginePricer.js
    <  M services/esquina-routing.test.js
    <  M services/formaEsquina.js
    <  M src/oliver-gpt/tools.js
    8,11d3
    < ?? docs/tridente-947/CODEX-r4.md
    < ?? docs/tridente-947/GEMINI-r5.md
    < ?? docs/tridente-947/RESIDUALES.md
    < ?? docs/tridente-947/diff-947-r6.txt
El veredicto de esta corrida NO cuenta (P-08): revisar por que la guardia 1 no alcanzo.
