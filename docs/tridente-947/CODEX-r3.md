# Tridente #947 · Codex · ronda 3 (codex exec --sandbox read-only, diff final r3 pegado)

VEREDICTO: NO APTO

Los 42 tests focalizados pasan, pero no cubren cinco caminos capaces de alterar producto o precio.

HALLAZGOS:

1. [GRAVE] [services/enginePricer.js:1409](C:/Users/mcifu/activa/temp-wa/services/enginePricer.js:1409) — La unificación cambia cotizaciones anteriores por notación triple cuando el lateral supera al central.

   Reproducción: `medidas_texto:"400x1540x1830"`, `descripcion_producto:"bow window"`.

   Esperado según el comportamiento anterior: vidrio por el central, `400×1540`, `glass_id:34`.

   Obtenido: `_panoMayor` selecciona el lateral, `1830×1540`, `glass_id:61`. Cambia el payload y el precio. El comentario afirma que “paño mayor” equivale al central, pero no existe ninguna validación `central >= lateral`.

2. [GRAVE] [src/oliver-gpt/tools.js:920](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/tools.js:920) y [services/formaEsquina.js:258](C:/Users/mcifu/activa/temp-wa/services/formaEsquina.js:258) — Las medidas estructuradas no se validan contra su posición ni contra el valor textual.

   Reproducción A: pedido real `330x1540, 1830x1540, 1830x1540, 325x1540`, pero la tool manda `alto_mm:1830`.

   Esperado: rechazo; 1830 es un ancho y el alto común es 1540.

   Obtenido: como `1830` aparece en cualquier lugar del texto, se acepta y el motor recibe `alto_mm:1830`.

   Reproducción B: el tercer paño llega como `ancho_mm:1800` aunque el texto dice `1830`.

   Esperado: rechazo por desacuerdo.

   Obtenido: se acepta y se cotizan 4285 mm totales en vez de 4315 mm. La “literalidad” solo decide unidades; no verifica valor, orden ni multiplicidad.

3. [GRAVE] [src/oliver-gpt/tools.js:926](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/tools.js:926) y [services/formaEsquina.js:172](C:/Users/mcifu/activa/temp-wa/services/formaEsquina.js:172) — Persisten casos realistas con unidades 10× incorrectas.

   Reproducción: cliente dice `“fija 80x50 y fija 100x50, todo en cm”`; el LLM obedece el schema y manda anchos `800/1000` y `alto_mm:500`.

   Esperado: `1800×500 mm`.

   Obtenido comprobado: `factor=10`; como `500` no aparece literalmente y es `<=600`, se vuelve a multiplicar. El payload queda `1800×5000 mm`.

   Otro caso comprobado: `“primer paño 180x150 cm; segundo 1800x1500 mm”`, con ambos anchos ya convertidos a `1800`. El factor del primer par es 10 y la búsqueda global encuentra `1800` en el segundo; ambos paños terminan en `18000 mm`, total `36000` en vez de `3600`.

4. [GRAVE] [src/oliver-gpt/tools.js:902](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/tools.js:902) — La guardia contra convertir una compuesta plana en esquina se puede autoautorizar con texto generado por el mismo LLM.

   Reproducción: `ctx.textoCliente:"ventana compuesta plana, fijo 800 + proyectante 800"`, pero tool-call con `descripcion_producto:"bow window de dos paños"` y `panos_esquina:[FIJA 800, PROYECTANTE 800]`.

   Esperado: rechazar y confirmar que realmente sea esquina.

   Obtenido comprobado: el texto real por sí solo da `false`, pero `textoBow` incluye la descripción alucinada y da `true`; se arma y cotiza como `ESQUINA`. La guardia no constituye una validación independiente.

5. [GRAVE] [src/oliver-gpt/tools.js:315](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/tools.js:315) y [services/formaEsquina.js:287](C:/Users/mcifu/activa/temp-wa/services/formaEsquina.js:287) — `COMPUESTA` inventa datos faltantes y no permite expresar divisiones desiguales.

   Reproducción A: `“bow window: paño compuesto 600x1500 + fijo 1200x1500”`, sin indicar aperturas.

   Esperado: preguntar qué abre.

   Obtenido: inventa `PROYECTANTE` arriba y `FIJA` abajo, ambas de 750 mm.

   Reproducción B: el cliente sí especifica proyectante superior de 400 mm y fijo inferior de 1100 mm.

   Esperado: partes internas `400/1100`.

   Obtenido: el schema solo admite `arriba/abajo`; `additionalProperties:false` rechaza alturas o subpartes. La única representación aceptada termina forzada a `750/750`, pese a que el camino por etiqueta sí maneja alturas internas.

6. [MEDIO] [src/oliver-gpt/system-prompt.js:864](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/system-prompt.js:864) y [src/oliver-gpt/tools.js:337](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/tools.js:337) — Prompt y schema se contradicen sobre el ángulo faltante.

   Reproducción: bow completa sin ángulo.

   Esperado según la Regla #34: preguntarlo una vez y usar 90 solamente si el cliente no sabe.

   Obtenido permitido por el schema/runtime: omitir `angulo_esquina` y cotizar inmediatamente a 90. No hay estado que demuestre que la pregunta ocurrió.

NO PUEDO SABERLO:

- El monto exacto en CLP de las diferencias: el motor vive en otro repo.
- Si ya existen cotizaciones emitidas con laterales mayores que el central.
- Si el motor rechaza los payloads de 5000/18000 mm o llega a valorizarlos; este repo sí intenta enviarlos así.
- Si algún llamador externo puede colocar `item.esquina` en una ventana normal. En el diff mostrado, las ventanas no-esquina sin ese campo conservan su ruta.
- No verifiqué todos los consumidores reales del PDF y la sonda de color; solo el camino de etiqueta mostrado y sus tests.
- No repetí la suite completa declarada de 1812 pruebas. La única corrida autorizada dio `42 pass / 0 fail`.
