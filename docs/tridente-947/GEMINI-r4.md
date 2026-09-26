# Tridente #947 · Gemini · ronda 4 (gemini-2.5-flash, wrapper read-only, diff r4)

**VEREDICTO: NO APTO**

---

### HALLAZGOS

1. **[GRAVE] services/formaEsquina.js:901-945 · El salvavidas de centímetros rompe paños grandes si el cliente no escribe en formato de par "X"**
   * **Por qué:** Si el cliente lista los paños por separado sin usar un separador `"x"` o `"por"` (por ejemplo: `"alto 150 cm, paños de 40 cm, 180 cm y 40 cm"`), `paresDelTexto` no detectará ningún par y devolverá `[]`. Al estar vacío `ps`, `factorSuelto` se define como `1`. El código calcula `anchosMm` como `[40, 180, 40]`. Luego, el "salvavidas" hace:
     `anchosMm = anchosMm.map((a) => (a > 0 && a < 150 ? a * 10 : a))`
     * `40 < 150` → se multiplica por 10 dando `400` mm.
     * `180 >= 150` → **NO se escala** (queda en `180` mm).
     Esto hace que el paño de 180 cm se cotice silenciosamente como de **18 cm** de ancho. El ancho total de la ventana pasa a ser `980 mm` en vez de `2.600 mm` (una subcotización brutal de casi 3 veces menos perfil y vidrio, sin emitir ningún error ni aviso).
   * **Cómo reproducirlo:**
     * **Input en `runTool`:**
       ```json
       {
         "panos_esquina": [
           { "tipo": "FIJA", "ancho_mm": 40 },
           { "tipo": "FIJA", "ancho_mm": 180 },
           { "tipo": "FIJA", "ancho_mm": 40 }
         ],
         "alto_mm": 150,
         "angulo_esquina": 90,
         "medidas_texto": "alto 150 cm, paños de 40 cm, 180 cm y 40 cm"
       }
       ```
       con `ctx.textoCliente` = `"alto 150 cm, paños de 40 cm, 180 cm y 40 cm"`.
     * **Salida esperada:** Alto `1500` mm, anchos `[400, 1800, 400]` mm.
     * **Salida obtenida:** Alto `1500` mm, anchos `[400, 180, 400]` mm (ancho total: `980` mm), sin alertas.

2. **[GRAVE] services/formaEsquina.js:922-928 · Falsos positivos de reincorporación de altura común bloquean mensajes con múltiples ventanas**
   * **Por qué:** El código de validación literal estricta (`exigir_literal: true`) exige que el alto enviado por la tool sea común a todos los pares que aparecen en `ctx.textoCliente` (que contiene el historial de mensajes del cliente en ese turno):
     `const comun = ps.every((p) => casi(p.a * p.factor, altoMm) || casi(p.b * p.factor, altoMm))`
     Si el cliente pide una bow window y *cualquier otra ventana plana diferente* en el mismo mensaje (por ejemplo: `"quiero una ventana normal de 150x120 cm y una bow window de 33x154, 183x154, 183x154 y 32x154 cm"`), `ps` incluirá el par `{a: 150, b: 120, factor: 10}`. Como el alto de la bow window (`1540` mm) no coincide con `1500` ni con `1200` mm de la ventana plana, la validación `comun` falla. La tool aborta inmediatamente y devuelve el error `"El alto 154 no es la medida común de los paños que escribió el cliente"`, bloqueando la automatización de pedidos multi-ventana en el chat.
   * **Cómo reproducirlo:**
     * **Input en `runTool`:**
       ```json
       {
         "panos_esquina": [
           { "tipo": "FIJA", "ancho_mm": 33 },
           { "tipo": "FIJA", "ancho_mm": 183 },
           { "tipo": "FIJA", "ancho_mm": 183 },
           { "tipo": "COMPUESTA", "ancho_mm": 32, "arriba": "PROYECTANTE", "abajo": "FIJA" }
         ],
         "alto_mm": 154,
         "angulo_esquina": 90,
         "medidas_texto": "una de 150x120 cm y la bow window de 33x154, 183x154, 183x154, 32x154 cm"
       }
       ```
       con `ctx.textoCliente` = `"una de 150x120 cm y la bow window de 33x154, 183x154, 183x154, 32x154 cm"`.
     * **Salida esperada:** Cotización exitosa de la bow window de `4315x1540 mm`.
     * **Salida obtenida:** Error de validación: `"El alto 154 no es la medida común de los paños..."` abortando la cotización.

3. **[MEDIO] services/formaEsquina.js:988-1002 · Las mitades de compuestos se encogen 10 veces si el cliente especifica su altura de forma aislada**
   * **Por qué:** Si el cliente define la altura de una mitad de forma aislada (por ejemplo: `"mitad proyectante de 40 arriba"`), ese número no es detectado por `paresDelTexto` (ya que no forma un par del tipo `"A x B"`). Al no estar en `ps`, `factorDe(40)` devuelve `{ factor: null }` y `fh` hereda `factorSuelto` que es `1` (si no hay más pares). La mitad de arriba se escala a `40` mm (4 cm). Como no hay ninguna validación que exija un mínimo físico a las alturas de las mitades de los compuestos (solo que sumen el alto de la ventana, y `40 + 1460 = 1500` cumple perfectamente), la ventana se cotiza de forma incorrecta y silenciosa con una proyectante de sólo 4 cm de alto.
   * **Cómo reproducirlo:**
     * **Input en `runTool`:**
       ```json
       {
         "panos_esquina": [
           { "tipo": "FIJA", "ancho_mm": 40 },
           { "tipo": "COMPUESTA", "ancho_mm": 32, "arriba": "PROYECTANTE", "abajo": "FIJA", "alto_arriba_mm": 40 }
         ],
         "alto_mm": 150,
         "angulo_esquina": 90,
         "medidas_texto": "alto 150 cm, primer paño de 40 cm y compuesto de 32 con proyectante de 40 arriba"
       }
       ```
       con `ctx.textoCliente` = `"alto 150 cm, primer paño de 40 cm y compuesto de 32 con proyectante de 40 arriba"`.
     * **Salida esperada:** Un compuesto con proyectante de `400 mm` arriba y fija de `1100 mm` abajo.
     * **Salida obtenida:** Un compuesto con proyectante de `40 mm` arriba y fija de `1460 mm` abajo, sin alertas.

---

### NO PUDE SABERLO

- No tengo acceso al entorno de ejecución real de producción (Railway/base de datos viva) para comprobar el comportamiento físico exacto de `pickGlassId` con un `glass_id` dinámico fuera del motor stubbeado.
GEMINI EXIT: 0 (modelo=gemini-2.5-flash, limite=1800s)
