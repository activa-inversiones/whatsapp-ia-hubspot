# Veredicto: NO APTO

## Hallazgos bloqueantes

1. **VERIFICADO — Si el cliente no responde el nombre, no recibe el PDF.**

`shouldSendPdf` ya está listo en [index.js:6489](/C:/Users/mcifu/activa/temp-wa/index.js:6489), pero al faltar nombre el código:

- marca `nameAsked`,
- manda la pregunta,
- guarda la sesión,
- hace `return`.

Está en [index.js:6499](/C:/Users/mcifu/activa/temp-wa/index.js:6499). La generación y envío recién ocurren después, en [index.js:6519](/C:/Users/mcifu/activa/temp-wa/index.js:6519) y [index.js:6590](/C:/Users/mcifu/activa/temp-wa/index.js:6590).

Si el cliente no contesta, no existe un turno siguiente y el PDF nunca se emite. Si responde cualquier cosa, puede continuar porque `nameAsked` sigue en `true`, pero eso no cumple “aunque no conteste”.

El diff no introdujo ese `return`; dejó vigente un bloqueo preexistente incompatible con la decisión del dueño. Según tu criterio, esto por sí solo obliga a **NO APTO**.

2. **VERIFICADO — El LLM todavía tiene prohibido cotizar sin nombre.**

El prompt declara el nombre obligatorio antes de `update_quote` en [index.js:3497](/C:/Users/mcifu/activa/temp-wa/index.js:3497), ordena preguntar si falta cualquier dato en [index.js:3502](/C:/Users/mcifu/activa/temp-wa/index.js:3502) y repite “NUNCA ejecutes update_quote sin tener el NOMBRE” en [index.js:3587](/C:/Users/mcifu/activa/temp-wa/index.js:3587).

**PLAUSIBLE:** dependiendo de cómo obedezca el modelo, el flujo puede bloquearse incluso antes de calcular `shouldSendPdf`.

3. **VERIFICADO — `update_quote` salta completamente el validador nuevo.**

Después de ejecutar `decidirCaptura`, el código copia directamente `args.name` producido por el LLM:

[index.js:6347](/C:/Users/mcifu/activa/temp-wa/index.js:6347)

```js
if (args[k] != null && args[k] !== "") d[k] = args[k];
```

Por esa vía todavía pueden entrar “Oliver”, “Activa Inversiones” u otra basura sin pasar por `esNombreDePersona` ni `esRazonSocial`.

Además, `decidirCaptura` corta si `needsName` dice que ya existe nombre, en [oliverNombreCliente.js:153](/C:/Users/mcifu/activa/temp-wa/services/oliverNombreCliente.js:153). El `needsName` antiguo no incluye “Oliver” ni “Activa Inversiones” entre sus genéricos ([oliverName.js:29](/C:/Users/mcifu/activa/temp-wa/services/oliverName.js:29), [oliverName.js:47](/C:/Users/mcifu/activa/temp-wa/services/oliverName.js:47)).

Sonda directa verificada:

- `data.name="Oliver"` → `needsName=false`.
- `data.name="Activa Inversiones"` → `needsName=false`.
- En ambos casos `decidirCaptura` devuelve `motivo:"ya_tiene_nombre"`.

Por lo tanto, el defecto medido no queda cerrado en todas sus entradas.

## Falsos negativos verificados

El validador rechazó estas entradas legítimas en una ejecución directa:

- Chilenos/mapuche: `Lautaro Huenchumilla`, `Galvarino Curamil`, `Victoria Millaleo`.
- Nombres/apellidos que chocan con vocabulario: `Marcos Freire`, `Ana María Casas`, `Blanca Soto`, `José de la Puerta`.
- Compuesto largo: `María del Pilar González Rojas`.
- Migrantes/Unicode: `João da Silva`, `François Joseph`, `محمد علي`.
- Presentación con intención: `Hola, soy Juan Pérez y quiero cotizar una ventana`.
- Presentación con más información: `me llamo José Luis Martínez, necesito dos ventanas`.

Las causas son:

- Máximo cuatro palabras: [oliverName.js:170](/C:/Users/mcifu/activa/temp-wa/services/oliverName.js:170).
- Alfabeto limitado a caracteres españoles: [oliverName.js:167](/C:/Users/mcifu/activa/temp-wa/services/oliverName.js:167).
- Comunas rechazadas completas y también palabra por palabra: [oliverNombreCliente.js:81](/C:/Users/mcifu/activa/temp-wa/services/oliverNombreCliente.js:81), [oliverNombreCliente.js:117](/C:/Users/mcifu/activa/temp-wa/services/oliverNombreCliente.js:117).
- Vocabulario que contiene nombres reales como `marcos`, `blanca` y apellidos posibles: [oliverNombreCliente.js:65](/C:/Users/mcifu/activa/temp-wa/services/oliverNombreCliente.js:65).
- `extractName` rechaza el mensaje completo si contiene palabras como “quiero”, “cotizar” o “ventana”, antes de extraer el nombre: [oliverName.js:102](/C:/Users/mcifu/activa/temp-wa/services/oliverName.js:102).

## Contrato

**VERIFICADO — Consumo estructural correcto, consumo semántico parcial.**

En [index.js:6233](/C:/Users/mcifu/activa/temp-wa/index.js:6233):

- `captura` controla la escritura.
- `nombre` va a `data.name`.
- `tipo` va a `data.name_tipo`.
- `motivo` va a `data.name_source`.

No hay incompatibilidad de forma con `{captura, nombre, tipo, motivo}`.

Pero `name_tipo` y `name_source` no tienen ningún otro consumidor en el código. El PDF documenta y usa `name`/`receptor`, no `name_tipo` ([quotePdf.js:5](/C:/Users/mcifu/activa/temp-wa/services/quotePdf.js:5), [quotePdf.js:42](/C:/Users/mcifu/activa/temp-wa/services/quotePdf.js:42)). Por eso el comentario “el PDF ya los distingue” en [index.js:6236](/C:/Users/mcifu/activa/temp-wa/index.js:6236) no está respaldado por el wiring.

## Pruebas

**VERIFICADO:**

- `services/oliverName.test.js` sigue verde.
- Ambas suites de nombre: **34/34 pasan**.
- Suite completa: **1.427 tests, 1.424 pasan, 3 omitidos, 0 fallos**.
- `node --check index.js`: correcto.
- `git diff --check HEAD`: sin errores.

El primer `npm test` no ejecutó por la política de PowerShell sobre `npm.ps1`; `npm.cmd test` ejecutó la suite completa correctamente.

## Quedó sin cubrir

- El test de “no bloquear” sólo comprueba que el resultado no tenga una propiedad `bloquear`; no ejecuta el `return` de `index.js`: [oliverNombreCliente.test.js:107](/C:/Users/mcifu/activa/temp-wa/services/oliverNombreCliente.test.js:107).
- No hay prueba integrada “PDF listo + sin nombre + cliente no responde”.
- No se prueba `args.name` entrando mediante `update_quote`.
- Los casos “Oliver” y “Activa Inversiones” se prueban como respuesta con `data.name` vacío, no como valor ya persistido: [oliverNombreCliente.test.js:14](/C:/Users/mcifu/activa/temp-wa/services/oliverNombreCliente.test.js:14), [oliverNombreCliente.test.js:34](/C:/Users/mcifu/activa/temp-wa/services/oliverNombreCliente.test.js:34).
- Siguen existiendo falsos positivos verificados: captura `Voy saliendo`, `Mañana te confirmo`, `Puerto Montt` y `Las Condes` como personas; `Codelco` como persona; y `me dicen Pancho` como nombre literal `Me Dicen Pancho`.
- **NO PUEDO SABERLO:** no verifiqué la BD ni el despliegue productivo; los folios y nombres productivos se consideran contexto entregado por ustedes.
- CodeGraph estaba indexado pero ni su CLI ni su MCP estaban disponibles; la revisión se hizo directamente sobre fuente, diff y pruebas.
