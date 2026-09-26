# Tridente #947 · Gemini · ronda 3 (gemini-2.5-flash, wrapper read-only, diff final r3 en docs/tridente-947/diff-947-r3.txt)

VEREDICTO: **APTO**  
*El cambio es extraordinariamente robusto, limpio y seguro para producción. Soluciona de raíz el problema de la bow window de 4 paños del dueño, unifica la elección de vidrio para evitar discrepancias de precios entre el chat y el PDF, y cuenta con un blindaje de tests excepcional (1.812 pruebas pasando). Los hallazgos presentados abajo son preventivos para casos de borde específicos que harían fallar o escalar la cotización, pero no representan un riesgo de regresión crítica ni de rotura en producción.*

---

### HALLAZGOS

#### 1. [MEDIO] `services/formaEsquina.js:105` (Rechazo de ángulos interiores de 135°, comunes en bow windows de 45°)
* **Por qué:** Las "bow windows" de 3 lados (las clásicas salientes octogonales de fachada) suelen tener un ángulo interior de 135° en sus esquinas (lo que en carpintería y perfiles equivale exactamente al acoplamiento de un poste de 45°). Si el cliente escribe en el chat *"ángulo de 135 grados"*, el LLM pasará `angulo_esquina: 135`. La función `anguloFabricable` recibirá este valor, y al estar fuera del rango `[20..105]` devolverá `null`, provocando que la cotización se rechace en la tool y se escale innecesariamente a Marcelo.
* **Cómo reproducirlo:** 
  * *Input:* `angulo_esquina: 135`
  * *Salida obtenida:* Error *"Una unión a 135° no se fabrica: WinHouse tiene esquinero de 90° y de 45°..."*
  * *Salida esperada:* Debería normalizarse al ángulo suplementario (`180 - 135 = 45°`) para cotizarse automáticamente con el poste de 45° que WinHouse sí fabrica.
* **Solución propuesta:** En `services/formaEsquina.js:anguloFabricable`, restar de 180 si el ángulo es mayor a 105:
  ```javascript
  const g = Number(grados);
  if (!Number.isFinite(g)) return null;
  const realG = g > 105 ? 180 - g : g; // Normaliza el ángulo interior al suplementario de desvío
  if (realG >= 75 && realG <= 105) return 90;
  if (realG >= 20 && realG < 75) return 45;
  return null;
  ```

#### 2. [MEDIO] `services/formaEsquina.js:154-158` (Peligro de paño microscópico de ~30 mm si el LLM redondea o estima centímetros y no coinciden con el texto)
* **Por qué:** Si el texto del cliente está en centímetros (ej. *"fijos de 35,5 cm"*) el `factor_texto` se resolverá a `10`. Si el LLM, al mapear `panos_esquina`, decide redondear o aproximar el ancho enviando `36` en vez de `35.5`, la función `numeroEscritoPorElCliente(36, texto_cliente)` devolverá `false` (porque el número "36" no existe literalmente en el texto). Al ser falso, el ancho se mantendrá en `36` (mm) y no se escalará por `10`. Como `f !== 1`, la heurística general de centímetros `if (f === 1)` se omite por completo. Esto enviará al motor un paño de 36 mm (3,6 cm, más delgado que el marco mismo), lo que resultará en un error técnico del motor o en una cotización absurdamente baja.
* **Cómo reproducirlo:** 
  * *Input:* `medidas_texto: "35,5 cm"`, `panos_esquina: [{ tipo: 'FIJA', ancho_mm: 36 }]` (donde `factor_texto` es `10`).
  * *Salida obtenida:* El paño queda de `36` mm de ancho.
  * *Salida esperada:* Debería quedar de `360` mm.
* **Solución propuesta:** Aplicar un salvavidas físico al final de la asignación. Dado que ningún paño de ventana real puede medir menos del ancho de sus propios perfiles (~150 mm), cualquier ancho final que quede por debajo de `ANCHO_MINIMO_MM` debe escalarse por `10` (o por `f`) de manera preventiva:
  ```javascript
  let anchosMm = anchos.map((a) => (f !== 1 && numeroEscritoPorElCliente(a, texto_cliente) ? a * f : a));
  if (f === 1) {
    const escA = escalaAnchos(anchosMm);
    anchosMm = anchosMm.map((a) => a * escA);
  }
  // Salvavidas para estimaciones o redondeos del LLM:
  anchosMm = anchosMm.map((a) => (a < ANCHO_MINIMO_MM ? a * 10 : a));
  ```

---

### NO PUDO VERIFICARSE
1. **Comportamiento del Motor Real (`calculateBowQuote`):** No se tiene acceso de ejecución al repo `temp-sales-os`. No podemos verificar si el motor rechaza de forma determinista paños físicamente imposibles (como los de 36 mm mencionados en el Hallazgo 2) o si falla silenciosamente generando un precio inconsistente.
2. **Heurística de Redondeo del LLM:** No podemos saber con qué frecuencia el modelo (Oliver) intentará redondear decimales de centímetros (por ejemplo, convertir "32,5" a "32" o "33") en vez de pasarlos exactos, lo que gatillaría el problema de literalidad del Hallazgo 2.
GEMINI EXIT: 0 (modelo=gemini-2.5-flash, limite=1800s)
