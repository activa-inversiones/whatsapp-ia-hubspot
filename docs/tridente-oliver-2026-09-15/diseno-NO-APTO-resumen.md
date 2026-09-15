# DISEÑO #778 — VEREDICTO: NO APTO (15-sep-2026)

Revisores: **Gemini 2.5-pro** (vía wrapper) → APTO · **Kimi K3** (NVIDIA NIM, sustituto) → NO APTO.
Codex: sin cuota de uso hasta las 23:09. Copilot: sin cuota mensual.
⚠️ TRIDENTE INCOMPLETO. Gana Kimi: sus hallazgos son verificables contra el material y Gemini no los vio.

## Tres formas de DUPLICAR (viola la regla innegociable del dueño)

1. **El huérfano del Promise.race.** El race gana el timeout pero la llamada a Meta SIGUE VIVA;
   Meta entrega igual. La fila queda `dudoso`, el dueño la reenvía a mano → el cliente la recibe
   dos veces. Mi D5 asumía que "proceso muerto" era la única ambigüedad. Falso: el proceso puede
   estar vivo y haber perdido el control de la llamada.
2. **Lease vencido con llamada en vuelo.** El worker marca `dudoso` mientras el envío sigue en el
   aire. El UPDATE posterior no está protegido por `WHERE estado='claimed' AND instance_id=$propio`.
3. **Escritor zombie sin fencing.** `instance_id` está en el schema pero el diseño NUNCA lo usa
   como fencing token. Textual de Kimi: **"columna decorativa"**.

⇒ En los tres, **el vector de duplicación es el humano**, y el diseño le entrega una lista SIN el
dato mínimo (wamid) para decidir bien.

## Dos formas de reproducir EL MISMO BUG que vino a arreglar

4. **El dedupe que miente.** La firma se marca antes de enviar y un reintento devuelve `ok:true`
   sin mandar nada. Si `entregarPendiente` la reusa, marca `meta_accepted` sin wamid; el worker
   (D6) NUNCA toca `meta_accepted` ⇒ cliente sin PDF y sistema convencido de que lo mandó.
   Textual: **"es el bug original con mejor packaging"**.
   Y ataca a D3: "una sola rutina" es justamente lo que propaga el veneno a turno y worker.
5. **El pozo de `meta_accepted`.** Si el acuse de Meta se pierde, la fila queda ahí para siempre.
   No hay alerta por `meta_accepted` viejo sin `delivered`.
6. **`failed` huérfano.** El worker toma `pending` y `claimed` vencidos. **Nadie toma `failed`.**
7. **La lista de dudosos sin notificación** es, textual, **"un /dev/null con UI"**. El caso Katy se
   resolvió porque el dueño se enteró de casualidad; el diseño no cierra ese agujero.

## La tanda A/B/C

8. Los 6 INSERT (3 PDF + 3 filas) **no están declarados como una sola transacción**.
9. **La unidad de entrega no está definida**: ¿la fila o la tanda? El claim es por fila, así que el
   worker puede entregar A y morir antes de B y C. Si el dueño reenvía "la tanda" → **A duplicada**.
10. 🔴 **`variante` está sobrecargada y esto pega directo en la regla del dueño.** Hoy significa el
    color (A/B/C). Pero el dueño dijo *"si él la modifica, otra"*. Si la versión modificada reusa
    `folio+variante`, choca con la UNIQUE o se la traga el dedupe ⇒ **el cliente NUNCA recibe su
    propuesta corregida y el sistema cree que sí.** Hay que separar color de versión.

## Otros

11. **El mutex sin lease sigue ahí.** El diseño arregla la entrega pero no el candado por teléfono:
    una promesa colgada bloquea ese teléfono para siempre. El cliente recibe el PDF por el worker
    pero NO PUEDE VOLVER A CONVERSAR.
12. **Regresión de estado por doble escritor.** El acuse y el flujo síncrono escriben la misma fila;
    sin guarda `WHERE estado = <esperado>` en cada transición, la fila puede retroceder.

## Qué falta antes de volver a intentarlo
- Máquina de estados con guarda explícita en CADA transición.
- `instance_id` como fencing token real en todo UPDATE post-Meta.
- Nunca abandonar una llamada a Meta por timeout sin drenar su resultado.
- `entregarPendiente` NO puede pasar por el dedupe por firma.
- Alertas por `failed`, por `meta_accepted` viejo y por la lista de dudosos.
- La tanda como entidad, con transacción única.
- Separar `variante` (color) de `version` (corrección pedida por el cliente).
