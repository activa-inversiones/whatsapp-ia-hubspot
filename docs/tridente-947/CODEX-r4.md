# Tridente #947 · Codex · ronda 4 (diff r4 pegado)

VEREDICTO: NO APTO

HALLAZGOS:

1. [GRAVE] [src/oliver-gpt/tools.js:907](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/tools.js:907) — La guardia se contamina con esquinas mencionadas anteriormente.

   `textoAutoridad` contiene todos los mensajes, y `esBowPorForma()` acepta el ítem actual si cualquier mensaje anterior decía “bow window”.

   Reproducción: conversación: `“Primero una bow window fija 1000x1500 + fija 800x1500, ángulo 90. Ahora una compuesta plana fija 1000x1500 + proyectante 800x1500”`. Para el segundo ítem, el LLM manda por error `panos_esquina:[FIJA 1000, PROYECTANTE 800]`.

   Esperado: rechazo; el ítem actual es plano.

   Obtenido: la mención histórica autoriza la guardia y sale al motor como `tipo:"ESQUINA"`, otro producto y otro precio.

2. [GRAVE] [services/formaEsquina.js:294](C:/Users/mcifu/activa/temp-wa/services/formaEsquina.js:294) — El cierre de literalidad sigue incompleto: valida pertenencia al conjunto de números, no orden, multiplicidad ni correspondencia con cada paño.

   Reproducción con el pedido real: texto `330x1540, 1830x1540, 1830x1540, 325x1540`; tool manda anchos `[330,1830,1830,1830]`.

   Esperado: rechazo porque el cuarto ancho era `325`.

   Obtenido: todos los números aparecen en el texto, por lo que pasa y se cotizan `5820 mm` totales en vez de `4315 mm`.

   La apertura tampoco se contrasta: texto `fija 1000x1500 + fija 800x1500`, pero `panos_esquina:[FIJA,PROYECTANTE]`, también pasa y cotiza una apertura que el cliente no pidió.

3. [GRAVE] [src/oliver-gpt/tools.js:923](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/tools.js:923) — Hacer obligatorio el campo no demuestra que se preguntó el ángulo.

   Reproducción: cliente: `“bow window fija 1000x1500 y fija 800x1500”`, sin ángulo; el LLM manda `angulo_esquina:90`.

   Esperado: error “pregúntele”.

   Obtenido: solo se comprueba que el campo esté presente; se cotiza a 90°. El supuesto cierre de ronda 3 sigue permitiendo inventar la geometría.

4. [GRAVE] [services/formaEsquina.js:190](C:/Users/mcifu/activa/temp-wa/services/formaEsquina.js:190) — Un ángulo exacto no soportado se reemplaza silenciosamente por otro.

   Reproducción: cliente dice `ángulo 74°`; tool manda `angulo_esquina:74`.

   Esperado: rechazo o confirmación, porque el contrato medido aportado acepta únicamente 45 o 90.

   Obtenido: `anguloFabricable(74)` devuelve `45`; motor, nota y etiqueta reciben 45°. Lo mismo ocurre con todo el intervalo 20–74 y 75–105.

5. [GRAVE] [services/formaEsquina.js:214](C:/Users/mcifu/activa/temp-wa/services/formaEsquina.js:214) — Las unidades declaradas antes o después de una lista se ignoran y pueden producir dimensiones 10×.

   Reproducción: `“bow window, todo en mm: fija 200x450 y fija 300x450”`, con valores estructurados `200`, `300`, alto `450`.

   Esperado: partes `[200,300]`, alto `450`, total `500 mm`.

   Obtenido: como `mm` no está inmediatamente después de cada par, ambos caen en el umbral `≤600 → cm`: partes `[2000,3000]`, alto `4500`, total `5000 mm`. Este repo intenta cotizar ese payload.

6. [GRAVE] [services/enginePricer.js:1389](C:/Users/mcifu/activa/temp-wa/services/enginePricer.js:1389) — La recotización por etiqueta vuelve a perder el alto cuando el cliente escribió “alto por ancho”.

   Reproducción: etiqueta de cuatro paños, `measures:"4315x1540mm"` y `texto_cliente:"alto por ancho: 1540x330, 1540x1830, 1540x1830, 1540x325"`.

   Esperado: motor con `alto_mm:1540`; medida visible `4315x1540mm`.

   Obtenido: el pre-pass global intercambia el par total porque no aparece entre los pares originales; la rama de etiqueta toma `m.alto_mm`, quedando `alto_mm:4315` y `measures:"4315x4315mm"`. La sonda de color puede cambiar vidrio y precio respecto del chat.

7. [MEDIO] [src/oliver-gpt/tools.js:303](C:/Users/mcifu/activa/temp-wa/src/oliver-gpt/tools.js:303) — El schema se contradice con la literalidad estricta.

   La descripción de `panos_esquina` ordena convertir a milímetros “si la sabes”, mientras `ancho_mm` ordena copiar el número sin convertir; `alto_mm` sigue descrito como milímetros.

   Reproducción: cliente escribe `180x150 cm`; el LLM sigue la primera instrucción y manda ancho `1800`, alto `1500`.

   Esperado: una representación inequívoca aceptada por la tool.

   Obtenido: rechazo porque `1800/1500` no aparecen literalmente. Esto induce llamadas fallidas y repreguntas aunque el cliente ya entregó todos los datos.

NO PUEDO SABERLO:

- El monto exacto en CLP de cada diferencia: el motor vive en otro repo.
- Si el motor rechaza los payloads 10× por límites internos o llega a valorizarlos.
- Si todos los caminos reales del PDF conservan `texto_cliente`; confirmé el riesgo en el pricer y que la sonda de color sí lo pasa.
- No demostré una regresión adicional para ventanas no-esquina: en los caminos visibles, `item.esquina` nace en la tool explícita o se transporta desde una cotización anterior.
- No verifiqué la suite completa. La única ejecución autorizada terminó con 56 pass / 0 fail, no 213.
