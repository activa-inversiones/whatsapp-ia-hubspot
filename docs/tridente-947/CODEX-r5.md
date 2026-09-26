# Tridente #947 · Codex · ronda 5 (diff incremental del 2º commit)

VEREDICTO: NO APTO

HALLAZGOS:

1. [GRAVE] `services/formaEsquina.js:342-345` — la multiplicidad confunde el alto común con un ancho. `enTexto` cuenta ambas coordenadas (`p.a || p.b`), por lo que un ancho inventado igual al alto queda “validado” por todos los pares.

   Cómo reproducirlo: cliente escribe `300x1500, 400x1500, 500x1500`; el LLM manda paños `[300,1500,1500]`, alto `1500`. Esperado: rechazo; los anchos correctos suman 1200 mm. Obtenido: `runTool` devuelve `ok:true` y manda al motor `[300,1500,1500]`, total 3300 mm. Se cotiza otra ventana.

2. [GRAVE] `services/formaEsquina.js:217,225-227` — cualquier aparición de `mm` o `cm` en toda la conversación se interpreta como unidad global, aunque corresponda a otro atributo.

   Cómo reproducirlo: `bow window con vidrio de 4 mm: fija 200x150, fija 180x150 y fija 200x150, ángulo 90`; paños raw `[200,180,200]`, alto `150`. Esperado según la heurística existente para pares sin sufijo: `[2000,1800,2000] × 1500 mm`. Obtenido: `runTool` manda al motor `[200,180,200] × 150 mm`, total `580×150`; la geometría queda 10× menor y pasa la guarda local de 150 mm.

3. [MEDIO] `services/enginePricer.js:979-981` — la detección temprana no contempla `item.medidas`, aunque el armador autoritativo de 4b sí lo lee en `services/enginePricer.js:1303-1304`.

   Cómo reproducirlo: `{measures:'4315x1540mm', medidas:'1831x1540x1242', product:'FIJA'}`. Esperado: reconocer la triple y armar `1831 + 1242 + 1242 = 4315`. Obtenido: `_esBowTemprano=false`; escala por “excede todos los límites” antes de 4b y realiza cero llamadas al motor.

NO PUEDO SABERLO:

- Si el motor del otro repo acepta o rechaza los payloads incorrectos de los hallazgos 1 y 2, ni cuál sería su precio real. Este repo sí los construye y envía.
- Si producción todavía genera items con la propiedad heredada `medidas`; no encontré un productor inequívoco, aunque 4b declara soportarla.
- No verifiqué el render final del PDF fuera del flujo del pricer.
- Corrí únicamente la suite autorizada: 63 pass / 0 fail. No ejecuté la suite completa de 1784 tests.
