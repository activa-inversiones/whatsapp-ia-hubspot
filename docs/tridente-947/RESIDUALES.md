# Tridente #947 · lo que NO se cerró con código, y por qué

Codex r4 (`CODEX-r4.md`) dejó 6 graves + 1 medio. Cuatro eran baratos y reales y se cerraron con test
(multiplicidad de los anchos · unidad global "todo en mm/cm" para los pares sin sufijo · el alto de la
re-cotización por etiqueta con "alto por ancho" · texto del schema). Tres quedan como **riesgo residual
declarado**: no se pueden verificar mecánicamente sin inventar otra guardia que adivine.

| # | hallazgo | por qué no se cierra con código | qué lo mitiga |
|---|---|---|---|
| r4-1 | Un "bow window" mencionado ANTES en la conversación autoriza la guardia para un ítem posterior que es una compuesta plana, si el LLM manda `panos_esquina` por error. | `ctx.textoCliente` es toda la conversación; separar "el ítem actual" del historial es NLP, no una regla. Restringir al último mensaje rompería el caso normal (el cliente describe la esquina en dos mensajes). | Requiere DOS errores del LLM a la vez (usar `panos_esquina` en una compuesta Y con la lista de esa compuesta). La literalidad exige que los números estén en el texto. La nota al cliente dice "ventana en esquina de N paños": el cliente lo ve antes del PDF. |
| r4-3 | Hacer obligatorio `angulo_esquina` no prueba que Oliver preguntó el ángulo. | Un estado "se preguntó" viviría en la sesión y sería otra fuente de verdad que el LLM podría no marcar. | REGLA #34 lo ordena ("pregúntelo UNA vez; 90 solo si no sabe"); el tool_result lo repite. La nota al cliente dice el ángulo cotizado. |
| r4-4 | 74° se cotiza como 45° sin avisar. | Es la regla del dueño del 11-sep ("cerca de 40 → el de 45; 90 → el de 90") y las MISMAS bandas del motor (`anguloEsquinero`: 20–75 → 45, 75–105 → 90). Rechazar 74 sería contradecir al motor y al dueño. | La nota al cliente dice "uniones a 45°", igual que la etiqueta del motor. |

Y una **observación de método** que sale de esta ronda: el chequeo duro de fabricación del pricer corre
ANTES del bloque de la esquina y medía el total (4315 mm) como si fuera un paño. La ventana real del
dueño **no se re-cotizaba por etiqueta** (opciones por color, informe térmico) — lo cazó el caso de
Codex, no un test previo. Ahora la esquina está exenta del swap "alto por ancho" y del chequeo duro
(cada paño se valida en 4b y en el motor), con test.

Gemini r5 (`GEMINI-r5.md`): APTO, 2 menores sin efecto (una mitad de exactamente 150 mm en el camino
sin literalidad estricta; el formato "union 90°" de la etiqueta del motor como acoplamiento entre repos).
