# Tridente #947 · Codex · ronda 2 (codex exec --sandbox read-only, diff final r2 pegado, exploración acotada)

VEREDICTO: NO APTO

HALLAZGOS:

1. [GRAVE] [src/oliver-gpt/tools.js:888](</C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/tools.js:888>) — Un error de medidas se descarta y se reemplaza por lo que inventó/corrigió el LLM.

   `resolverMedidasMm` puede devolver `ok:false`, pero si existe `panos_esquina`, el código usa igualmente `input.alto_mm` y luego fabrica un `med` con `ok:true`.

   Reproducción:

   - Input: `medidas_texto:"330x15400 mm"`, `unidad_confirmada:"mm"`, `alto_mm:1540`, cuatro paños válidos.
   - Esperado: `medidas_fuera_de_rango`; no llamar al motor.
   - Obtenido: se ignora el alto textual 15400, se acepta silenciosamente el `alto_mm:1540` del LLM y se envía la esquina al motor.

   Esto rompe la regla de que el texto original manda y permite cotizar una altura corregida 10× sin confirmación del cliente.

2. [GRAVE] [services/formaEsquina.js:104](</C:/Users/mcifu/activa/temp-wa/services/formaEsquina.js:104>) — La detección de centímetros falla cuando todos los paños miden al menos 150 cm.

   `escalaAnchos` multiplica por diez solamente si algún ancho es menor que 150. No distingue “150 mm” de “150 cm”.

   Reproducción:

   - Cliente confirma centímetros: paños de `180`, `200`, `180`; alto `150 cm`.
   - El LLM manda esos anchos en cm y el alto queda resuelto en `1500 mm`.
   - Esperado: `[1800, 2000, 1800]`, total `5600 mm`; vidrio calculado con paño de `2000×1500`.
   - Obtenido: `[180, 200, 180]`, total `560 mm`; vidrio calculado con `200×1500`.

   Es una subcotización potencial de orden 10× en perfiles y además puede elegir un vidrio más barato. Es un caso realista para paños grandes.

3. [GRAVE] [src/oliver-gpt/tools.js:899](</C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/tools.js:899>) y [services/enginePricer.js:1340](</C:/Users/mcifu/activa/temp-wa/services/enginePricer.js:1340>) — Las listas declaradas `alto × ancho` pierden el alto común y pueden cotizar otra dimensión.

   La tool toma como alto la segunda cifra del primer par. Después sustituye el ancho de `measures` por el paño mayor, pero no conserva `esq.alto_mm` dentro de `item.esquina`. El pre-pass global intenta invertir ese par artificial y `_yaArmada` termina usando el alto resultante.

   Reproducción:

   - Texto: `alto por ancho, en mm: 1540x330, 1540x1830, 1540x1830, 1540x325`.
   - `panos_esquina`: anchos `[330,1830,1830,325]`.
   - Esperado: motor recibe `alto_mm:1540`, total `4315×1540`.
   - Obtenido por el flujo estático: la tool toma inicialmente alto `330`; arma `measures:"1830x330mm"`; el pre-pass lo invierte y `_yaArmada` usa `alto_mm:1830`. El motor recibe `4315×1830`.

   La notación triple no sufre esto porque conserva `_triple.alto_mm`; es una regresión exclusiva del camino nuevo.

4. [GRAVE] [services/formaEsquina.js:295](</C:/Users/mcifu/activa/temp-wa/services/formaEsquina.js:295>) y [services/enginePricer.js:1378](</C:/Users/mcifu/activa/temp-wa/services/enginePricer.js:1378>) — Una etiqueta con ángulos distintos dice “no adivinar”, pero el pricer adivina 90°.

   `esquinaDesdeLabel` devuelve `angulo:undefined` cuando encuentra `90° y 45°`. Inmediatamente después, `enginePricer` aplica `|| 90`.

   Reproducción:

   - Etiqueta: `Ventana en esquina (3 paños, union 90° y 45°): Fijo 450mm + Fijo 1800mm + Fijo 450mm`.
   - Esperado: escalar; el motor solo acepta un ángulo y no puede representar ambas uniones.
   - Obtenido: re-cotización completa con `angulo:90`, alterando potencialmente el precio ya emitido.

   Esto afecta precisamente los caminos por etiqueta: PDF, sonda de color e informe térmico.

5. [GRAVE] [src/oliver-gpt/tools.js:898](</C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/tools.js:898>) — `panos_esquina` fuerza una ESQUINA sin verificar que el producto sea realmente una esquina.

   Cualquier array no vacío activa `esquinaDesdePanos`; luego `_yaArmada` gana por precedencia incluso si la descripción dice que es una compuesta plana.

   Reproducción:

   - Input válido para el schema: `tipo:"COMPUESTA"`, `descripcion_producto:"ventana compuesta, fijo 800 + proyectante 800"`, `medidas_texto:"1600x1200"`, `panos_esquina:[{FIJA,800},{PROYECTANTE,800}]`.
   - Esperado: cotizar una `COMPUESTA` plana o rechazar la contradicción.
   - Obtenido: llamada al motor con `tipo:"ESQUINA"` y poste a 90°.

   Sí existe, por tanto, un camino donde una ventana no esquina cambia de producto y precio por este diff.

6. [MEDIO] [services/formaEsquina.js:174](</C:/Users/mcifu/activa/temp-wa/services/formaEsquina.js:174>) — Se aceptan ángulos que el contrato suministrado dice que el motor rechaza.

   La función admite todo valor entre 20° y 105° y lo envía sin normalizar.

   Reproducción:

   - Input: esquina válida con `angulo_esquina:40`.
   - Esperado: normalizar explícitamente a 45° cuando corresponda o rechazar antes de llamar.
   - Obtenido: se envía `angulo:40`; según el contexto medido, el motor solo acepta 45 o 90 y rechaza la cotización.

   El test nuevo incluso fija que 40 “viaja tal cual”, por lo que consolida el defecto.

No encontré un cambio directo de precio para ventanas normales cuando `panos_esquina` está ausente. `notaDeLineaParaElLLM` tampoco pierde el monorriel con los asignadores actuales: las únicas `nota_linea` del repo son monorriel y esquina.

NO PUEDO SABERLO:

- NO PUEDO SABERLO: el precio exacto producido por cada payload defectuoso sin ejecutar el motor del otro repositorio.
- NO PUEDO SABERLO: si existen cotizaciones históricas con etiquetas mixtas `90° y 45°`; el código y el test contemplan ese formato, pero no se entregó el corpus de producción.
- NO PUEDO SABERLO: si todas las etiquetas históricas conservan anchos exactos cuya suma coincide con `measures`.
- La única corrida autorizada de tests fue lanzada, pero su resultado quedó oculto al fallar en paralelo el comando local de CodeGraph —no instalado—. No la repetí.
